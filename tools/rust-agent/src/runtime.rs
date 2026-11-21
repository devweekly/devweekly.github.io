use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    sync::atomic::{AtomicU64, Ordering},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{info, warn};

use crate::{
    action::{ModelTurn, ToolAction, UserQuestion},
    error::AgentError,
    policy::{self, PolicyDecision},
    provider::{ChatMessage, OpenAiCompatibleProvider},
    tools::ToolExecutor,
};

const SYSTEM_PROMPT: &str = r#"You are a local coding and research assistant. You can use only the tools listed below.
Return exactly one JSON object, without Markdown fences:
{"type":"final","content":"..."}
or
{"type":"tool_call","tool":"read_file","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"list_dir","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"write_file","arguments":{"path":"relative/path","content":"..."}}
or
{"type":"tool_call","tool":"search_files","arguments":{"path":"relative/path","query":"text","regex":false,"case_sensitive":true,"glob":"*.rs","max_results":200}}
or
{"type":"ask_user","questions":[{"question":"...","header":"...","options":[{"label":"...","description":"..."}],"multi_select":false}]}
or
{"type":"tool_call","tool":"delegate_task","arguments":{"name":"reviewer","task":"Inspect the authentication implementation for security and correctness issues."}}

Tool rules:
- Paths are relative to the configured workspace.
- read_file, list_dir, and search_files are read-only.
- search_files searches workspace files natively, respects hidden-file and Git ignore rules, and supports literal or regular-expression matching.
- write_file changes a workspace file and always requires explicit user approval.
- Use ask_user when a material requirement or decision is ambiguous. Ask concise questions and provide useful options when possible.
- delegate_task runs a bounded read-only subagent. Use it for an independent investigation or review; it cannot write files or delegate again.
- There is no shell, process execution, arbitrary network tool, or access outside the workspace.
- Never claim a tool succeeded unless its result says it succeeded.
- If a task cannot be completed with these tools, explain the limitation."#;

const SESSION_SCHEMA_VERSION: u32 = 1;

pub struct RuntimeOptions {
    pub session_dir: Option<PathBuf>,
    pub session_id: Option<String>,
    pub continue_session: bool,
    pub audit_file: Option<PathBuf>,
    pub max_tool_calls_per_turn: usize,
    pub max_history_messages: usize,
    pub system_prompt: Option<String>,
    pub hooks: Vec<Box<dyn RuntimeHook>>,
}

impl Default for RuntimeOptions {
    fn default() -> Self {
        Self {
            session_dir: None,
            session_id: None,
            continue_session: false,
            audit_file: None,
            max_tool_calls_per_turn: 8,
            max_history_messages: 80,
            system_prompt: None,
            hooks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    Default,
    Plan,
}

pub struct RuntimeEvent {
    pub session_id: String,
    pub name: String,
    pub tool: Option<String>,
    pub details: Value,
}

pub trait RuntimeHook: Send + Sync {
    fn on_event(&self, _event: &RuntimeEvent) {}

    // Hooks may add a denial, but can never override the Rust policy gate or user approval.
    fn before_tool(&self, _action: &ToolAction) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionRecord {
    schema_version: u32,
    session_id: String,
    parent_session_id: Option<String>,
    created_at_ms: u128,
    updated_at_ms: u128,
    messages: Vec<ChatMessage>,
}

struct SessionStore {
    directory: PathBuf,
    latest_pointer: PathBuf,
}

impl SessionStore {
    fn new(directory: PathBuf) -> Self {
        let latest_pointer = directory.join("latest");
        Self { directory, latest_pointer }
    }

    fn validate_id(session_id: &str) -> Result<(), AgentError> {
        if session_id.is_empty()
            || session_id.len() > 128
            || !session_id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        {
            return Err(AgentError::InvalidAction("session ID contains unsupported characters".into()));
        }
        Ok(())
    }

    fn path_for(&self, session_id: &str) -> Result<PathBuf, AgentError> {
        Self::validate_id(session_id)?;
        Ok(self.directory.join(format!("{session_id}.json")))
    }

    fn load(&self, session_id: &str) -> Result<SessionRecord, AgentError> {
        let path = self.path_for(session_id)?;
        let bytes = fs::read(path)?;
        let record: SessionRecord = serde_json::from_slice(&bytes)?;
        if record.schema_version != SESSION_SCHEMA_VERSION || record.session_id != session_id {
            return Err(AgentError::InvalidAction("session file has an unsupported schema or mismatched ID".into()));
        }
        Ok(record)
    }

    fn load_latest(&self) -> Result<SessionRecord, AgentError> {
        let session_id = fs::read_to_string(&self.latest_pointer)?;
        self.load(session_id.trim())
    }

    fn save(&self, record: &SessionRecord) -> Result<(), AgentError> {
        fs::create_dir_all(&self.directory)?;
        let path = self.path_for(&record.session_id)?;
        let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
        let bytes = serde_json::to_vec_pretty(record)?;
        write_private_file(&temporary, &bytes, false)?;
        fs::rename(&temporary, &path)?;
        write_private_file(&self.latest_pointer, record.session_id.as_bytes(), false)?;
        Ok(())
    }
}

pub struct AgentRuntime {
    provider: OpenAiCompatibleProvider,
    workspace: PathBuf,
    executor: ToolExecutor,
    messages: Vec<ChatMessage>,
    session: SessionRecord,
    store: SessionStore,
    audit_file: Option<PathBuf>,
    max_tool_calls_per_turn: usize,
    max_history_messages: usize,
    permission_mode: PermissionMode,
    system_prompt: String,
    hooks: Vec<Box<dyn RuntimeHook>>,
}

impl AgentRuntime {
    pub fn new(
        provider: OpenAiCompatibleProvider,
        workspace: PathBuf,
        options: RuntimeOptions,
    ) -> Result<Self, AgentError> {
        let session_directory = options
            .session_dir
            .unwrap_or_else(|| workspace.join(".rust-agent").join("sessions"));
        let store = SessionStore::new(session_directory);

        let configured_system_prompt = options.system_prompt.clone().unwrap_or_else(|| SYSTEM_PROMPT.to_owned());
        let hooks = std::mem::take(&mut options.hooks);
        let session = if let Some(session_id) = options.session_id.as_deref() {
            store.load(session_id)?
        } else if options.continue_session {
            store.load_latest()?
        } else {
            let now = now_ms();
            SessionRecord {
                schema_version: SESSION_SCHEMA_VERSION,
                session_id: new_session_id(now),
                parent_session_id: None,
                created_at_ms: now,
                updated_at_ms: now,
                messages: vec![system_message(Some(&configured_system_prompt))],
            }
        };

        let messages = if session.messages.is_empty() {
            vec![system_message(options.system_prompt.as_deref())]
        } else {
            session.messages.clone()
        };
        let mut runtime = Self {
            provider,
            executor: ToolExecutor::new(workspace.clone()),
            workspace,
            messages,
            session,
            store,
            audit_file: options.audit_file,
            max_tool_calls_per_turn: options.max_tool_calls_per_turn.clamp(1, 64),
            max_history_messages: options.max_history_messages.clamp(4, 2_000),
            permission_mode: PermissionMode::Default,
            system_prompt: configured_system_prompt,
            hooks,
        };
        runtime.persist()?;
        runtime.audit("session.start", None, json!({"resumed": options.session_id.is_some() || options.continue_session}));
        Ok(runtime)
    }

    pub fn workspace(&self) -> &Path {
        &self.workspace
    }

    pub fn session_id(&self) -> &str {
        &self.session.session_id
    }

    pub fn model(&self) -> &str {
        self.provider.model()
    }

    pub fn set_model(&mut self, model: String) -> Result<(), AgentError> {
        self.provider.set_model(model)?;
        self.audit("model.changed", None, json!({"model": self.provider.model()}));
        Ok(())
    }

    pub async fn list_models(&self) -> Result<Vec<String>, AgentError> {
        self.provider.list_models().await
    }

    pub fn set_permission_mode(&mut self, mode: PermissionMode) {
        self.permission_mode = mode;
        self.audit("permission_mode.changed", None, json!({
            "mode": match mode {
                PermissionMode::Default => "default",
                PermissionMode::Plan => "plan"
            }
        }));
    }

    pub fn context_message_count(&self) -> usize {
        self.messages.len().saturating_sub(1)
    }

    pub fn compact_context(&mut self) -> Result<usize, AgentError> {
        let removed = self.compact_history();
        self.persist()?;
        self.audit("context.compacted", None, json!({"removed_messages": removed}));
        Ok(removed)
    }

    pub fn start_new_session(&mut self) -> Result<(), AgentError> {
        let now = now_ms();
        self.session = SessionRecord {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: new_session_id(now),
            parent_session_id: None,
            created_at_ms: now,
            updated_at_ms: now,
            messages: vec![system_message(Some(&self.system_prompt))],
        };
        self.messages = self.session.messages.clone();
        self.persist()?;
        self.audit("session.start", None, json!({"new_session": true}));
        Ok(())
    }

    pub fn resume_session(&mut self, session_id: &str) -> Result<(), AgentError> {
        let record = self.store.load(session_id)?;
        self.messages = record.messages.clone();
        self.session = record;
        self.persist()?;
        self.audit("session.resume", None, json!({}));
        Ok(())
    }

    pub fn fork_session(&mut self) -> Result<(), AgentError> {
        let parent_id = self.session.session_id.clone();
        let now = now_ms();
        self.session = SessionRecord {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: new_session_id(now),
            parent_session_id: Some(parent_id.clone()),
            created_at_ms: now,
            updated_at_ms: now,
            messages: self.messages.clone(),
        };
        self.persist()?;
        self.audit("session.fork", None, json!({"parent_session_id": parent_id}));
        Ok(())
    }

    pub async fn run_turn(&mut self, input: &str) -> Result<String, AgentError> {
        self.messages.push(ChatMessage {
            role: "user".into(),
            content: input.to_owned(),
        });
        self.compact_history();
        self.audit("prompt.submit", None, json!({"prompt_length": input.len()}));
        self.persist()?;

        for step in 0..self.max_tool_calls_per_turn {
            let raw = self.provider.complete(&self.messages).await?;
            self.messages.push(ChatMessage {
                role: "assistant".into(),
                content: raw.clone(),
            });
            self.persist()?;

            let turn = match serde_json::from_str::<ModelTurn>(&raw) {
                Ok(turn) => turn,
                Err(_) => {
                    warn!("model response was not valid action JSON; returning it as text");
                    self.audit("turn.invalid_model_output", None, json!({"step": step + 1}));
                    return Ok(raw);
                }
            };

            match turn {
                ModelTurn::Final { content } => {
                    self.audit("turn.complete", None, json!({"tool_calls": step}));
                    self.persist()?;
                    return Ok(content);
                }
                ModelTurn::AskUser { questions } => {
                    if questions.is_empty() {
                        self.push_tool_result(false, "ask_user requires at least one question");
                    } else {
                        let answers = self.request_user_answers(&questions)?;
                        self.audit("user_question.answered", None, json!({
                            "question_count": questions.len(),
                            "answer_count": answers.as_object().map_or(0, |object| object.len())
                        }));
                        self.push_tool_result(true, &format!("User answers: {answers}"));
                    }
                    self.persist()?;
                }
                ModelTurn::ToolCall { tool, arguments } => {
                    let action = ToolAction { name: tool, arguments };
                    let hook_denial = self.hooks.iter()
                        .find_map(|hook| hook.before_tool(&action).err());
                    if let Some(reason) = hook_denial {
                        self.audit("hook.tool_denied", Some(&action.name), json!({"reason": reason}));
                        self.push_tool_result(false, &format!("Denied by runtime hook: {reason}"));
                    } else if action.name == "delegate_task" {
                        match self.run_subagent(&action).await {
                            Ok(output) => self.push_tool_result(true, &output),
                            Err(error) => self.push_tool_result(false, &error.to_string()),
                        }
                    } else {
                        match policy::evaluate(&action) {
                            PolicyDecision::Deny => {
                                warn!(tool = %action.name, "tool call denied by policy");
                                self.audit("policy.deny", Some(&action.name), json!({}));
                                self.push_tool_result(false, "Denied by local policy");
                            }
                            PolicyDecision::RequireApproval => {
                                self.audit("policy.require_approval", Some(&action.name), json!({
                                    "mode": match self.permission_mode {
                                        PermissionMode::Default => "default",
                                        PermissionMode::Plan => "plan"
                                    }
                                }));
                                if self.permission_mode == PermissionMode::Plan {
                                    self.audit("policy.plan_mode_denied", Some(&action.name), json!({}));
                                    self.push_tool_result(false, "Write operations are disabled in plan mode");
                                } else if self.request_approval(&action)? {
                                    self.audit("policy.approve", Some(&action.name), json!({}));
                                    self.execute_and_record(&action);
                                } else {
                                    self.audit("policy.user_denied", Some(&action.name), json!({}));
                                    self.push_tool_result(false, "User declined the operation");
                                }
                            }
                            PolicyDecision::Allow => {
                                self.audit("policy.allow", Some(&action.name), json!({}));
                                self.execute_and_record(&action);
                            }
                        }
                    }
                    self.persist()?;
                }
            }
        }

        self.audit("turn.limit_reached", None, json!({"limit": self.max_tool_calls_per_turn}));
        Ok(format!(
            "Stopped after reaching the per-turn tool-call limit ({}).",
            self.max_tool_calls_per_turn
        ))
    }

    async fn run_subagent(&self, action: &ToolAction) -> Result<String, AgentError> {
        let name = action.arguments.get("name").and_then(Value::as_str).unwrap_or("subagent");
        let task = action.arguments.get("task").and_then(Value::as_str)
            .filter(|task| !task.trim().is_empty())
            .ok_or_else(|| AgentError::InvalidAction("delegate_task requires a non-empty task".into()))?;
        if task.len() > 10_000 || name.len() > 80 {
            return Err(AgentError::InvalidAction("subagent name or task exceeds the configured limit".into()));
        }

        self.audit("subagent.start", Some("delegate_task"), json!({
            "name": name,
            "task_length": task.len(),
            "max_turns": 6
        }));

        let mut messages = vec![
            ChatMessage { role: "system".into(), content: SUBAGENT_SYSTEM_PROMPT.to_owned() },
            ChatMessage { role: "user".into(), content: task.to_owned() },
        ];

        for step in 0..6 {
            let raw = self.provider.complete(&messages).await?;
            messages.push(ChatMessage { role: "assistant".into(), content: raw.clone() });
            let turn = match serde_json::from_str::<ModelTurn>(&raw) {
                Ok(turn) => turn,
                Err(_) => {
                    self.audit("subagent.invalid_model_output", Some("delegate_task"), json!({
                        "name": name, "step": step + 1
                    }));
                    return Ok(raw.chars().take(12_000).collect());
                }
            };

            match turn {
                ModelTurn::Final { content } => {
                    self.audit("subagent.complete", Some("delegate_task"), json!({
                        "name": name, "tool_calls": step, "result_length": content.len()
                    }));
                    return Ok(content.chars().take(12_000).collect());
                }
                ModelTurn::AskUser { .. } => {
                    messages.push(ChatMessage {
                        role: "user".into(),
                        content: "Subagents cannot ask the user questions. Continue with available evidence or report the missing information.".into(),
                    });
                }
                ModelTurn::ToolCall { tool, arguments } => {
                    let sub_action = ToolAction { name: tool, arguments };
                    let hook_denial = self.hooks.iter()
                        .find_map(|hook| hook.before_tool(&sub_action).err());
                    let result = if let Some(reason) = hook_denial {
                        crate::action::ToolResult { ok: false, output: format!("Denied by runtime hook: {reason}") }
                    } else if !is_subagent_read_tool(&sub_action.name)
                        || !matches!(policy::evaluate(&sub_action), PolicyDecision::Allow) {
                        crate::action::ToolResult { ok: false, output: "Subagents are restricted to read-only workspace tools".into() }
                    } else {
                        match self.executor.execute(&sub_action) {
                            Ok(result) => result,
                            Err(error) => crate::action::ToolResult { ok: false, output: error.to_string() },
                        }
                    };
                    self.audit("subagent.tool", Some(&sub_action.name), json!({
                        "name": name, "ok": result.ok, "step": step + 1
                    }));
                    let output: String = result.output.chars().take(12_000).collect();
                    messages.push(ChatMessage {
                        role: "user".into(),
                        content: format!("Tool result (ok={}): {}", result.ok, output),
                    });
                }
            }
        }

        self.audit("subagent.limit_reached", Some("delegate_task"), json!({"name": name}));
        Ok("Subagent stopped after reaching its six-step limit.".into())
    }

    fn compact_history(&mut self) -> usize {
        let mut removed_messages = 0usize;
        while self.messages.len().saturating_sub(1) > self.max_history_messages {
            let next_turn = self.messages.iter().enumerate().skip(2).find_map(|(index, message)| {
                (message.role == "user" && !message.content.starts_with("Tool result (ok="))
                    .then_some(index)
            });
            let Some(next_turn) = next_turn else { break };
            self.messages.drain(1..next_turn);
            removed_messages = removed_messages.saturating_add(next_turn - 1);
        }
        if removed_messages > 0 {
            self.audit("context.windowed", None, json!({
                "removed_messages": removed_messages,
                "retained_messages": self.messages.len().saturating_sub(1)
            }));
        }
        removed_messages
    }

    fn execute_and_record(&mut self, action: &ToolAction) {
        self.audit("tool.start", Some(&action.name), json!({}));
        match self.executor.execute(action) {
            Ok(result) => {
                info!(tool = %action.name, ok = result.ok, "tool execution completed");
                self.audit("tool.complete", Some(&action.name), json!({"ok": result.ok}));
                self.push_tool_result(result.ok, &result.output);
            }
            Err(error) => {
                warn!(tool = %action.name, error = %error, "tool execution failed");
                self.audit("tool.error", Some(&action.name), json!({"error": error.to_string()}));
                self.push_tool_result(false, &error.to_string());
            }
        }
    }

    fn push_tool_result(&mut self, ok: bool, output: &str) {
        self.messages.push(ChatMessage {
            role: "user".into(),
            content: format!(
                "Tool result (ok={ok}):\n{}",
                serde_json::to_string(&json!({"ok": ok, "output": output}))
                    .unwrap_or_else(|_| output.to_owned())
            ),
        });
    }

    fn request_user_answers(&self, questions: &[UserQuestion]) -> Result<Value, AgentError> {
        if questions.len() > 5 {
            return Err(AgentError::InvalidAction("ask_user supports at most five questions per turn".into()));
        }
        let mut answers = serde_json::Map::new();
        for (index, question) in questions.iter().enumerate() {
            if question.question.trim().is_empty() || question.question.len() > 2_000 {
                return Err(AgentError::InvalidAction("question text must contain 1–2000 bytes".into()));
            }
            if question.options.len() > 10 {
                return Err(AgentError::InvalidAction("each question supports at most ten options".into()));
            }
            if question.options.iter().any(|option| option.label.trim().is_empty() || option.label.len() > 200) {
                return Err(AgentError::InvalidAction("option labels must contain 1–200 bytes".into()));
            }
            println!("\n{}. {}: {}", index + 1,
                question.header.as_deref().unwrap_or("Question"), question.question);
            for (option_index, option) in question.options.iter().enumerate() {
                let description = option.description.as_deref()
                    .map(|value| format!(" — {value}")).unwrap_or_default();
                println!("  {}. {}{}", option_index + 1, option.label, description);
            }

            let answer = if question.options.is_empty() {
                print!("Answer: ");
                io::stdout().flush()?;
                let mut input = String::new();
                io::stdin().read_line(&mut input)?;
                input.trim().to_owned()
            } else {
                let hint = if question.multi_select { "number(s), comma-separated" } else { "number" };
                print!("Select {hint}: ");
                io::stdout().flush()?;
                let mut input = String::new();
                io::stdin().read_line(&mut input)?;
                let mut selected = Vec::new();
                for item in input.trim().split(',') {
                    let value = item.trim().parse::<usize>().map_err(|_| {
                        AgentError::InvalidAction("question answer must contain option numbers".into())
                    })?;
                    if value == 0 || value > question.options.len() {
                        return Err(AgentError::InvalidAction("question answer is outside the option range".into()));
                    }
                    let label = question.options[value - 1].label.clone();
                    if !selected.contains(&label) {
                        selected.push(label);
                    }
                }
                if selected.is_empty() || (!question.multi_select && selected.len() != 1) {
                    return Err(AgentError::InvalidAction("select exactly one option".into()));
                }
                if question.multi_select { selected.join(", ") } else { selected.remove(0) }
            };
            answers.insert(question.question.clone(), Value::String(answer));
        }
        Ok(Value::Object(answers))
    }

    fn request_approval(&self, action: &ToolAction) -> Result<bool, AgentError> {
        let path = action.arguments.get("path").and_then(Value::as_str).unwrap_or("<invalid path>");
        print!("Approve write_file to '{path}'? Type 'yes' to continue: ");
        io::stdout().flush()?;

        let mut answer = String::new();
        io::stdin().read_line(&mut answer)?;
        Ok(answer.trim().eq_ignore_ascii_case("yes"))
    }

    fn persist(&mut self) -> Result<(), AgentError> {
        self.session.updated_at_ms = now_ms();
        self.session.messages = self.messages.clone();
        self.store.save(&self.session)
    }

    fn audit(&self, event: &str, tool: Option<&str>, details: Value) {
        let event = RuntimeEvent {
            session_id: self.session.session_id.clone(),
            name: event.to_owned(),
            tool: tool.map(ToOwned::to_owned),
            details: details.clone(),
        };
        for hook in &self.hooks {
            hook.on_event(&event);
        }
        let Some(path) = &self.audit_file else { return };
        let result = (|| -> Result<(), AgentError> {
            if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
                fs::create_dir_all(parent)?;
            }
            let mut options = OpenOptions::new();
            options.create(true).append(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(path)?;
            let mut record = json!({
                "timestamp_ms": now_ms(),
                "session_id": self.session.session_id,
                "event": event,
                "details": details
            });
            if let Some(tool) = tool {
                record["tool"] = Value::String(tool.to_owned());
            }
            serde_json::to_writer(&mut file, &record)?;
            file.write_all(b"\n")?;
            Ok(())
        })();
        if let Err(error) = result {
            warn!(%error, "failed to write audit event");
        }
    }
}

fn is_subagent_read_tool(name: &str) -> bool {
    matches!(name, "read_file" | "list_dir" | "search_files")
}

const SUBAGENT_SYSTEM_PROMPT: &str = r#"You are a delegated read-only subagent. Complete only the assigned task.
Return exactly one JSON object:
{"type":"final","content":"..."}
or
{"type":"tool_call","tool":"read_file","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"list_dir","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"search_files","arguments":{"path":"relative/path","query":"text","regex":false,"case_sensitive":true,"glob":"*","max_results":100}}
You may use only read_file, list_dir, and search_files within the configured workspace.
Do not write files, ask the user questions, or delegate further tasks. Cite relevant file paths and findings. Keep the result focused."#;

fn system_message(custom: Option<&str>) -> ChatMessage {
    ChatMessage {
        role: "system".into(),
        content: custom.unwrap_or(SYSTEM_PROMPT).to_owned(),
    }
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

fn new_session_id(now: u128) -> String {
    static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
    let sequence = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    format!("{now}-{}-{sequence}", std::process::id())
}

fn write_private_file(path: &Path, bytes: &[u8], append: bool) -> Result<(), AgentError> {
    let mut options = OpenOptions::new();
    options.create(true).write(true);
    if append { options.append(true); } else { options.truncate(true); }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{SessionStore, new_session_id, now_ms};

    #[test]
    fn subagents_are_restricted_to_read_only_tools() {
        assert!(super::is_subagent_read_tool("read_file"));
        assert!(super::is_subagent_read_tool("list_dir"));
        assert!(super::is_subagent_read_tool("search_files"));
        assert!(!super::is_subagent_read_tool("write_file"));
        assert!(!super::is_subagent_read_tool("delegate_task"));
    }

    #[test]
    fn session_ids_are_safe_file_names() {
        let id = new_session_id(now_ms());
        assert!(SessionStore::validate_id(&id).is_ok());
        assert!(SessionStore::validate_id("../outside").is_err());
        assert!(SessionStore::validate_id("with spaces").is_err());
    }
}
