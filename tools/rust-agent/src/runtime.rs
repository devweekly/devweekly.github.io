use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{info, warn};

use crate::{
    action::{ModelTurn, ToolAction},
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

Tool rules:
- Paths are relative to the configured workspace.
- read_file, list_dir, and search_files are read-only.
- search_files searches workspace files natively, respects hidden-file and Git ignore rules, and supports literal or regular-expression matching.
- write_file changes a workspace file and always requires explicit user approval.
- There is no shell, process execution, arbitrary network tool, or access outside the workspace.
- Never claim a tool succeeded unless its result says it succeeded.
- If a task cannot be completed with these tools, explain the limitation."#;

const SESSION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct RuntimeOptions {
    pub session_dir: Option<PathBuf>,
    pub session_id: Option<String>,
    pub continue_session: bool,
    pub audit_file: Option<PathBuf>,
    pub max_tool_calls_per_turn: usize,
    pub max_history_messages: usize,
    pub system_prompt: Option<String>,
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
        }
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
        fs::write(&temporary, bytes)?;
        fs::rename(&temporary, &path)?;
        fs::write(&self.latest_pointer, &record.session_id)?;
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
                messages: vec![system_message(options.system_prompt.as_deref())],
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

    pub fn start_new_session(&mut self) -> Result<(), AgentError> {
        let now = now_ms();
        self.session = SessionRecord {
            schema_version: SESSION_SCHEMA_VERSION,
            session_id: new_session_id(now),
            parent_session_id: None,
            created_at_ms: now,
            updated_at_ms: now,
            messages: vec![system_message(None)],
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
                ModelTurn::ToolCall { tool, arguments } => {
                    let action = ToolAction { name: tool, arguments };
                    match policy::evaluate(&action) {
                        PolicyDecision::Deny => {
                            warn!(tool = %action.name, "tool call denied by policy");
                            self.audit("policy.deny", Some(&action.name), json!({}));
                            self.push_tool_result(false, "Denied by local policy");
                        }
                        PolicyDecision::RequireApproval => {
                            self.audit("policy.require_approval", Some(&action.name), json!({}));
                            if self.request_approval(&action)? {
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

    fn compact_history(&mut self) {
        let non_system_count = self.messages.len().saturating_sub(1);
        if non_system_count <= self.max_history_messages {
            return;
        }
        let remove_count = non_system_count - self.max_history_messages;
        self.messages.drain(1..=remove_count);
        self.audit("context.windowed", None, json!({
            "removed_messages": remove_count,
            "retained_messages": self.messages.len().saturating_sub(1)
        }));
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
        let Some(path) = &self.audit_file else { return };
        let result = (|| -> Result<(), AgentError> {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut file = OpenOptions::new().create(true).append(true).open(path)?;
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
    format!("{now}-{}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::{SessionStore, new_session_id, now_ms};

    #[test]
    fn session_ids_are_safe_file_names() {
        let id = new_session_id(now_ms());
        assert!(SessionStore::validate_id(&id).is_ok());
        assert!(SessionStore::validate_id("../outside").is_err());
        assert!(SessionStore::validate_id("with spaces").is_err());
    }
}
