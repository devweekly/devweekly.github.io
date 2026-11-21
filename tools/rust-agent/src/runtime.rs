use std::{
    future::Future,
    pin::Pin,
    fs::{self, OpenOptions},
    io::{self, Write},
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Notify;
use tracing::{info, warn};

use crate::{
    action::{ModelTurn, ToolAction, UserQuestion},
    attachments::{AttachmentMetadata, AttachmentStore},
    context::{ContextManager, ContextReport},
    error::AgentError,
    memory::{MemoryInput, MemoryQuery, MemoryRecord, MemoryStore},
    policy::{self, PolicyDecision},
    provider::{ChatMessage, CompletionUsage, OpenAiCompatibleProvider},
    tools::ToolExecutor,
    trace::{TraceHook, TraceStore},
};

const SYSTEM_PROMPT: &str = r#"You are a local coding and research assistant. You can use only the tools listed below.
Return exactly one JSON object, without Markdown fences:
{"type":"final","content":"..."}
or
{"type":"tool_call","tool":"read_file","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"read_attachment","arguments":{"id":"attachment-id"}}
or
{"type":"tool_call","tool":"list_dir","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"write_file","arguments":{"path":"relative/path","content":"..."}}
or
{"type":"tool_call","tool":"search_files","arguments":{"path":"relative/path","query":"text","regex":false,"case_sensitive":true,"glob":"*.rs","max_results":200}}
or
{"type":"ask_user","questions":[{"question":"...","header":"...","options":[{"label":"...","description":"..."}],"multi_select":false}]}
or
{"type":"tool_call","tool":"delegate_task","arguments":{"name":"reviewer","task":"Inspect the authentication implementation for security and correctness issues.","agent":"profile-id-from-available-list"}}
or
{"type":"tool_call","tool":"start_background_task","arguments":{"name":"repository audit","task":"Inspect the repository architecture and identify the highest-risk design issues.","agent":"profile-id-from-available-list"}}

Tool rules:
- Paths are relative to the configured workspace.
- read_file, read_attachment, list_dir, and search_files are read-only.
- read_attachment reads UTF-8 text supplied by the embedding Host.
- search_files searches workspace files natively, respects hidden-file and Git ignore rules, and supports literal or regular-expression matching.
- write_file changes a workspace file and always requires explicit user approval.
- Use ask_user when a material requirement or decision is ambiguous. Ask concise questions and provide useful options when possible.
- delegate_task runs a bounded read-only subagent in the current turn. The optional agent argument selects a configured Custom Agent profile.
- start_background_task starts independent, durable read-only work when an investigation can run while you continue the current task. It returns a task ID immediately; the optional agent argument selects a configured Custom Agent profile.
- Background tasks cannot write files, ask the user questions, delegate, or start additional tasks.
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
    pub approval_handler: Option<Arc<dyn ApprovalHandler>>,
    pub context_manager: ContextManager,
    pub project_id: Option<String>,
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
            approval_handler: None,
            context_manager: ContextManager::default(),
            project_id: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    Default,
    Plan,
}

#[derive(Clone)]
pub struct CancellationHandle {
    inner: Arc<CancellationInner>,
}

struct CancellationInner {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancellationHandle {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(CancellationInner {
                cancelled: AtomicBool::new(false),
                notify: Notify::new(),
            }),
        }
    }

    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::Release);
        self.inner.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::Acquire)
    }

    async fn cancelled(&self) {
        loop {
            let notified = self.inner.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

impl Default for CancellationHandle {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeEvent {
    pub session_id: String,
    pub name: String,
    pub tool: Option<String>,
    pub details: Value,
}

pub trait ApprovalHandler: Send + Sync {
    fn request_approval<'a>(
        &'a self,
        action: &'a ToolAction,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AgentError>> + Send + 'a>>;
}

pub trait RuntimeHook: Send + Sync {
    fn before_turn(&self, _session_id: &str, _input: &str) -> Result<(), String> { Ok(()) }
    fn after_turn(&self, _session_id: &str, _result: &Result<String, String>) {}
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


const BACKGROUND_TASK_SCHEMA_VERSION: u32 = 1;
const MAX_ACTIVE_BACKGROUND_TASKS: usize = 8;
const MAX_BACKGROUND_TASK_STEPS: usize = 12;
const MAX_BACKGROUND_TASK_RESULT_CHARS: usize = 24_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundTaskStatus {
    Queued,
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}

impl BackgroundTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Cancelling => "cancelling",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct UsageTotals {
    pub requests: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub requests_without_usage: u64,
    pub duration_ms: u64,
    pub tool_calls: u64,
}
impl UsageTotals {
    fn add_completion(&mut self, usage: &CompletionUsage, duration_ms: u64) {
        self.requests = self.requests.saturating_add(1);
        self.prompt_tokens = self.prompt_tokens.saturating_add(usage.prompt_tokens.unwrap_or(0));
        self.completion_tokens = self.completion_tokens.saturating_add(usage.completion_tokens.unwrap_or(0));
        self.total_tokens = self.total_tokens.saturating_add(usage.total_tokens.unwrap_or(0));
        if usage.total_tokens.is_none() { self.requests_without_usage = self.requests_without_usage.saturating_add(1); }
        self.duration_ms = self.duration_ms.saturating_add(duration_ms);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundTaskRecord {
    schema_version: u32,
    pub task_id: String,
    pub name: String,
    pub parent_session_id: String,
    pub model: String,
    pub status: BackgroundTaskStatus,
    pub step: usize,
    pub created_at_ms: u128,
    pub updated_at_ms: u128,
    pub result: Option<String>,
    pub error: Option<String>,
    pub delivered_at_ms: Option<u128>,
    #[serde(default)]
    pub agent_profile: Option<AgentProfile>,
    #[serde(default)]
    pub usage: UsageTotals,
    messages: Vec<ChatMessage>,
}

#[derive(Clone)]
struct BackgroundTaskStore {
    directory: PathBuf,
}

impl BackgroundTaskStore {
    fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn validate_id(task_id: &str) -> Result<(), AgentError> {
        if task_id.is_empty()
            || task_id.len() > 128
            || !task_id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        {
            return Err(AgentError::InvalidAction("background task ID contains unsupported characters".into()));
        }
        Ok(())
    }

    fn path_for(&self, task_id: &str) -> Result<PathBuf, AgentError> {
        Self::validate_id(task_id)?;
        Ok(self.directory.join(format!("{task_id}.json")))
    }

    fn load(&self, task_id: &str) -> Result<BackgroundTaskRecord, AgentError> {
        let bytes = fs::read(self.path_for(task_id)?)?;
        let record: BackgroundTaskRecord = serde_json::from_slice(&bytes)?;
        if record.schema_version != BACKGROUND_TASK_SCHEMA_VERSION || record.task_id != task_id {
            return Err(AgentError::InvalidAction(
                "background task file has an unsupported schema or mismatched ID".into(),
            ));
        }
        Ok(record)
    }

    fn save(&self, record: &BackgroundTaskRecord) -> Result<(), AgentError> {
        fs::create_dir_all(&self.directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))?;
        }
        let path = self.path_for(&record.task_id)?;
        let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
        let bytes = serde_json::to_vec_pretty(record)?;
        write_private_file(&temporary, &bytes, false)?;
        fs::rename(&temporary, &path)?;
        Ok(())
    }

    fn list(&self) -> Result<Vec<BackgroundTaskRecord>, AgentError> {
        if !self.directory.exists() {
            return Ok(Vec::new());
        }
        let mut records = Vec::new();
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            if !entry.file_type()?.is_file()
                || entry.path().extension().and_then(|value| value.to_str()) != Some("json")
            {
                continue;
            }
            let bytes = fs::read(entry.path())?;
            let record: BackgroundTaskRecord = serde_json::from_slice(&bytes)?;
            if record.schema_version != BACKGROUND_TASK_SCHEMA_VERSION {
                return Err(AgentError::InvalidAction(format!(
                    "unsupported background task schema in {}",
                    entry.path().display()
                )));
            }
            Self::validate_id(&record.task_id)?;
            records.push(record);
        }
        records.sort_by(|left, right| {
            left.created_at_ms.cmp(&right.created_at_ms).then(left.task_id.cmp(&right.task_id))
        });
        Ok(records)
    }
}


const MAX_AGENT_PROFILE_STEPS: usize = 12;
const MAX_AGENT_PROFILE_PROMPT_BYTES: usize = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub model: Option<String>,
    pub system_prompt: String,
    pub allowed_tools: Vec<String>,
    pub max_steps: usize,
}

impl AgentProfile {
    fn validate(&self) -> Result<(), AgentError> {
        AgentProfileStore::validate_id(&self.id)?;
        if self.name.trim().is_empty() || self.name.len() > 80 {
            return Err(AgentError::InvalidAction("agent profile name must contain 1–80 bytes".into()));
        }
        if self.description.len() > 1_000 {
            return Err(AgentError::InvalidAction("agent profile description must not exceed 1000 bytes".into()));
        }
        if self.system_prompt.trim().is_empty() || self.system_prompt.len() > MAX_AGENT_PROFILE_PROMPT_BYTES {
            return Err(AgentError::InvalidAction(format!(
                "agent profile system_prompt must contain 1–{MAX_AGENT_PROFILE_PROMPT_BYTES} bytes"
            )));
        }
        if self.model.as_deref().is_some_and(|model| model.trim().is_empty() || model.len() > 200) {
            return Err(AgentError::InvalidAction("agent profile model must contain 1–200 bytes when specified".into()));
        }
        if !(1..=MAX_AGENT_PROFILE_STEPS).contains(&self.max_steps) {
            return Err(AgentError::InvalidAction(format!(
                "agent profile max_steps must be between 1 and {MAX_AGENT_PROFILE_STEPS}"
            )));
        }
        if self.allowed_tools.len() > 4 {
            return Err(AgentError::InvalidAction("agent profile may allow at most four read-only tools".into()));
        }
        let mut unique = std::collections::HashSet::new();
        for tool in &self.allowed_tools {
            if !is_custom_agent_read_tool(tool) || !unique.insert(tool) {
                return Err(AgentError::InvalidAction(format!(
                    "agent profile contains an unsupported or duplicate tool: {tool}"
                )));
            }
        }
        Ok(())
    }

    fn allows_tool(&self, tool: &str) -> bool {
        self.allowed_tools.iter().any(|allowed| allowed == tool)
    }

    fn default_subagent() -> Self {
        Self {
            id: "default-subagent".into(),
            name: "Read-only subagent".into(),
            description: "A bounded read-only delegated investigation.".into(),
            model: None,
            system_prompt: "You are a delegated read-only subagent. Complete the assigned task and cite relevant file paths.".into(),
            allowed_tools: default_read_only_tools(),
            max_steps: 6,
        }
    }

    fn default_background() -> Self {
        Self {
            id: "default-background".into(),
            name: "Background researcher".into(),
            description: "A durable, bounded read-only background investigation.".into(),
            model: None,
            system_prompt: "You are an independent background research agent. Complete the assigned task and cite relevant file paths.".into(),
            allowed_tools: default_read_only_tools(),
            max_steps: MAX_BACKGROUND_TASK_STEPS,
        }
    }

    fn system_message(&self) -> ChatMessage {
        ChatMessage {
            role: "system".into(),
            content: compose_agent_system_prompt(self),
        }
    }
}

fn default_read_only_tools() -> Vec<String> {
    vec!["read_file".into(), "read_attachment".into(), "list_dir".into(), "search_files".into()]
}

fn is_custom_agent_read_tool(name: &str) -> bool {
    matches!(name, "read_file" | "read_attachment" | "list_dir" | "search_files")
}

fn compose_agent_system_prompt(profile: &AgentProfile) -> String {
    let mut specifications = Vec::new();
    for tool in &profile.allowed_tools {
        let specification = match tool.as_str() {
            "read_file" => r#"{"type":"tool_call","tool":"read_file","arguments":{"path":"relative/path"}}"#,
            "read_attachment" => r#"{"type":"tool_call","tool":"read_attachment","arguments":{"id":"attachment-id"}}"#,
            "list_dir" => r#"{"type":"tool_call","tool":"list_dir","arguments":{"path":"relative/path"}}"#,
            "search_files" => r#"{"type":"tool_call","tool":"search_files","arguments":{"path":"relative/path","query":"text","regex":false,"case_sensitive":true,"glob":"*","max_results":100}}"#,
            _ => continue,
        };
        specifications.push(specification);
    }
    format!(
        "{}\n\nAgent protocol:\n\
         Return exactly one JSON object, without Markdown fences:\n\
         {{\"type\":\"final\",\"content\":\"...\"}}\n\
         or one of these tool calls:\n{}\n\
         Paths must be relative to the configured workspace. You may use only the tools listed above. \
         Do not write files, ask the user questions, delegate, start background tasks, execute commands, \
         or access arbitrary network resources.",
        profile.system_prompt,
        specifications.join("\n")
    )
}

#[derive(Clone)]
struct AgentProfileStore {
    directory: PathBuf,
}

impl AgentProfileStore {
    fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn validate_id(id: &str) -> Result<(), AgentError> {
        if id.is_empty() || id.len() > 64
            || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        {
            return Err(AgentError::InvalidAction(
                "agent profile ID must use 1–64 ASCII letters, digits, '-' or '_'".into(),
            ));
        }
        Ok(())
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, AgentError> {
        Self::validate_id(id)?;
        Ok(self.directory.join(format!("{id}.json")))
    }

    fn ensure_safe_directories(&self, create: bool) -> Result<bool, AgentError> {
        let state_directory = self.directory.parent().ok_or_else(|| {
            AgentError::InvalidAction("agent profile directory has no parent".into())
        })?;
        let workspace = state_directory.parent().ok_or_else(|| {
            AgentError::InvalidAction("agent profile directory is outside a workspace".into())
        })?;

        for path in [state_directory, self.directory.as_path()] {
            match fs::symlink_metadata(path) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(AgentError::InvalidAction(
                            "agent profile directories must be real directories, not symbolic links".into(),
                        ));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                    fs::create_dir(path)?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(error) => return Err(error.into()),
            }
        }

        let canonical_workspace = workspace.canonicalize()?;
        let canonical_directory = self.directory.canonicalize()?;
        if !canonical_directory.starts_with(&canonical_workspace) {
            return Err(AgentError::InvalidAction(
                "agent profile directory resolves outside the configured workspace".into(),
            ));
        }
        Ok(true)
    }

    fn load(&self, id: &str) -> Result<AgentProfile, AgentError> {
        if !self.ensure_safe_directories(false)? {
            return Err(AgentError::InvalidAction("agent profile directory does not exist".into()));
        }
        let path = self.path_for(id)?;
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(AgentError::InvalidAction(
                "agent profile files must be regular files, not symbolic links".into(),
            ));
        }
        let bytes = fs::read(&path)?;
        let profile: AgentProfile = serde_json::from_slice(&bytes)?;
        if profile.id != id {
            return Err(AgentError::InvalidAction("agent profile ID does not match its file name".into()));
        }
        profile.validate()?;
        Ok(profile)
    }

    fn save(&self, profile: &AgentProfile) -> Result<(), AgentError> {
        profile.validate()?;
        self.ensure_safe_directories(true)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))?;
        }
        let path = self.path_for(&profile.id)?;
        let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
        let bytes = serde_json::to_vec_pretty(profile)?;
        write_private_file(&temporary, &bytes, false)?;
        fs::rename(&temporary, &path)?;
        Ok(())
    }

    fn remove(&self, id: &str) -> Result<(), AgentError> {
        if !self.ensure_safe_directories(false)? {
            return Err(AgentError::InvalidAction("agent profile directory does not exist".into()));
        }
        let path = self.path_for(id)?;
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(AgentError::InvalidAction(
                "agent profile files must be regular files, not symbolic links".into(),
            ));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    fn list(&self) -> Result<Vec<AgentProfile>, AgentError> {
        if !self.ensure_safe_directories(false)? {
            return Ok(Vec::new());
        }
        let mut profiles = Vec::new();
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() || entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let path = entry.path();
            let id = path.file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| AgentError::InvalidAction("agent profile file name is not valid UTF-8".into()))?;
            profiles.push(self.load(id)?);
        }
        profiles.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(profiles)
    }
}

#[derive(Clone)]
struct BackgroundTaskControl {
    cancellation: CancellationHandle,
    notify: Arc<Notify>,
}

type SharedTaskControls = Arc<Mutex<HashMap<String, BackgroundTaskControl>>>;

pub struct AgentRuntime {
    provider: OpenAiCompatibleProvider,
    workspace: PathBuf,
    executor: ToolExecutor,
    attachment_store: AttachmentStore,
    pending_attachments: Vec<AttachmentMetadata>,
    messages: Vec<ChatMessage>,
    session: SessionRecord,
    store: SessionStore,
    audit_file: Option<PathBuf>,
    usage_file: PathBuf,
    max_tool_calls_per_turn: usize,
    max_history_messages: usize,
    permission_mode: PermissionMode,
    system_prompt: String,
    hooks: Vec<Box<dyn RuntimeHook>>,
    approval_handler: Option<Arc<dyn ApprovalHandler>>,
    background_task_store: BackgroundTaskStore,
    background_task_controls: SharedTaskControls,
    agent_profile_store: AgentProfileStore,
    memory_store: MemoryStore,
    context_manager: ContextManager,
    context_report: Option<ContextReport>,
    project_id: Option<String>,
    task_scope: Option<String>,
}

impl AgentRuntime {
    pub fn new(
        provider: OpenAiCompatibleProvider,
        workspace: PathBuf,
        mut options: RuntimeOptions,
    ) -> Result<Self, AgentError> {
        let session_directory = options
            .session_dir
            .unwrap_or_else(|| workspace.join(".rust-agent").join("sessions"));
        let store = SessionStore::new(session_directory);

        let configured_system_prompt = options.system_prompt.clone().unwrap_or_else(|| SYSTEM_PROMPT.to_owned());
        let mut hooks = std::mem::take(&mut options.hooks);
        let approval_handler = options.approval_handler;
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
        let background_task_store = BackgroundTaskStore::new(
            workspace.join(".rust-agent").join("tasks"),
        );
        let background_task_controls = Arc::new(Mutex::new(HashMap::new()));
        let agent_profile_store = AgentProfileStore::new(
            workspace.join(".rust-agent").join("agents"),
        );
        let usage_file = workspace.join(".rust-agent").join("usage.jsonl");
        let memory_store = MemoryStore::new(&workspace)?;
        let trace_store = TraceStore::new(workspace.join(".rust-agent").join("traces.jsonl"), session.session_id.clone(), new_trace_id())?;
        hooks.push(Box::new(TraceHook::new(trace_store)));
        let mut runtime = Self {
            provider,
            executor: ToolExecutor::new(workspace.clone()),
            attachment_store: AttachmentStore::new(workspace.clone())?,
            pending_attachments: Vec::new(),
            workspace,
            messages,
            session,
            store,
            audit_file: options.audit_file,
            usage_file,
            max_tool_calls_per_turn: options.max_tool_calls_per_turn.clamp(1, 64),
            max_history_messages: options.max_history_messages.clamp(4, 2_000),
            permission_mode: PermissionMode::Default,
            system_prompt: configured_system_prompt,
            hooks,
            approval_handler,
            background_task_store,
            background_task_controls,
            agent_profile_store,
            memory_store,
            context_manager: options.context_manager,
            context_report: None,
            project_id: options.project_id,
            task_scope: None,
        };
        runtime.persist()?;
        runtime.audit("session.start", None, json!({"resumed": options.session_id.is_some() || options.continue_session}));
        if tokio::runtime::Handle::try_current().is_ok() {
            runtime.resume_background_tasks()?;
        }
        Ok(runtime)
    }

    pub fn workspace(&self) -> &Path { &self.workspace }

    pub fn context_report(&self) -> Option<&ContextReport> { self.context_report.as_ref() }
    pub fn memory_store(&self) -> &MemoryStore { &self.memory_store }
    pub fn set_task_scope(&mut self, task_id: Option<String>) { self.task_scope = task_id; }
    pub fn remember(&self, input: MemoryInput) -> Result<MemoryRecord, AgentError> { self.memory_store.remember(input) }
    pub fn update_memory(&self, id: &str, content: &str, source: Option<&str>, confidence: Option<u8>) -> Result<MemoryRecord, AgentError> {
        self.memory_store.update(id, content, source, confidence)
    }
    pub fn forget_memory(&self, id: &str) -> Result<(), AgentError> { self.memory_store.forget(id) }
    pub fn list_memories(&self) -> Result<Vec<MemoryRecord>, AgentError> { self.memory_store.list() }
    pub fn retrieve_memories(&self, query: &str, limit: usize) -> Result<Vec<MemoryRecord>, AgentError> {
        self.memory_store.retrieve(&MemoryQuery {
            query: query.to_owned(), session_id: Some(self.session.session_id.clone()),
            project_id: self.project_id.clone(), task_id: self.task_scope.clone(), limit,
        })
    }

    /// Accept bytes supplied by an embedding Host and associate the attachment with the next user turn.
    /// Attach a regular file whose canonical path is inside the configured workspace.
    pub fn attach_workspace_file(&mut self, relative_path: &str) -> Result<AttachmentMetadata, AgentError> {
        let path = self.workspace.join(relative_path);
        let canonical = path.canonicalize()?;
        if !canonical.starts_with(&self.workspace) || !canonical.is_file() {
            return Err(AgentError::InvalidAction("attachment source must be a regular file inside the workspace".into()));
        }
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || metadata.len() > AttachmentStore::MAX_BYTES {
            return Err(AgentError::InvalidAction("attachment source is a symlink or exceeds the 20 MiB limit".into()));
        }
        let bytes = fs::read(&canonical)?;
        let filename = canonical.file_name().and_then(|name| name.to_str()).unwrap_or("attachment");
        self.attach_bytes(filename, "application/octet-stream", &bytes)
    }

    pub fn attach_bytes(&mut self, filename: &str, content_type: &str, bytes: &[u8]) -> Result<AttachmentMetadata, AgentError> {
        let attachment = self.attachment_store.store(filename, content_type, bytes)?;
        self.pending_attachments.push(attachment.clone());
        self.audit("attachment.stored", None, json!({"attachment_id": attachment.id, "size_bytes": attachment.size_bytes, "content_type": attachment.content_type}));
        Ok(attachment)
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



    fn messages_with_agent_catalog(&self) -> Vec<ChatMessage> {
        let mut messages = self.messages.clone();
        let Ok(profiles) = self.agent_profile_store.list() else {
            return messages;
        };
        if profiles.is_empty() {
            return messages;
        }
        let catalog = profiles.iter().map(|profile| {
            format!(
                "- {}: {} — {} (model={}, tools={}, max_steps={})",
                profile.id,
                profile.name,
                profile.description,
                profile.model.as_deref().unwrap_or("inherit"),
                profile.allowed_tools.join(","),
                profile.max_steps
            )
        }).collect::<Vec<_>>().join("\n");

        if let Some(system) = messages.first_mut().filter(|message| message.role == "system") {
            system.content.push_str(
                "\n\nAvailable custom agent profiles. Pass one of these IDs as the optional \
                 agent argument to delegate_task or start_background_task:\n"
            );
            system.content.push_str(&catalog);
        }
        messages
    }

    pub fn list_agent_profiles(&self) -> Result<Vec<AgentProfile>, AgentError> {
        self.agent_profile_store.list()
    }

    pub fn get_agent_profile(&self, profile_id: &str) -> Result<AgentProfile, AgentError> {
        self.agent_profile_store.load(profile_id)
    }

    pub fn save_agent_profile(&self, profile: &AgentProfile) -> Result<(), AgentError> {
        self.agent_profile_store.save(profile)?;
        self.audit("agent_profile.saved", None, json!({
            "profile_id": profile.id,
            "name": profile.name,
            "allowed_tools": profile.allowed_tools,
            "max_steps": profile.max_steps
        }));
        Ok(())
    }

    pub fn delete_agent_profile(&self, profile_id: &str) -> Result<(), AgentError> {
        self.agent_profile_store.remove(profile_id)?;
        self.audit("agent_profile.deleted", None, json!({"profile_id": profile_id}));
        Ok(())
    }

    fn resolve_agent_profile(&self, profile_id: Option<&str>, default: AgentProfile) -> Result<AgentProfile, AgentError> {
        match profile_id.map(str::trim).filter(|id| !id.is_empty()) {
            Some(id) => self.agent_profile_store.load(id),
            None => Ok(default),
        }
    }

    pub fn usage_summary(&self) -> Result<UsageTotals, AgentError> {
        let mut totals = UsageTotals::default();
        if self.usage_file.exists() {
            for line in fs::read_to_string(&self.usage_file)?.lines() {
                let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
                match event["event"].as_str() {
                    Some("model.usage") => {
                        totals.requests = totals.requests.saturating_add(1);
                        totals.prompt_tokens = totals.prompt_tokens.saturating_add(event["prompt_tokens"].as_u64().unwrap_or(0));
                        totals.completion_tokens = totals.completion_tokens.saturating_add(event["completion_tokens"].as_u64().unwrap_or(0));
                        totals.total_tokens = totals.total_tokens.saturating_add(event["total_tokens"].as_u64().unwrap_or(0));
                        if event["total_tokens"].is_null() { totals.requests_without_usage = totals.requests_without_usage.saturating_add(1); }
                        totals.duration_ms = totals.duration_ms.saturating_add(event["duration_ms"].as_u64().unwrap_or(0));
                    }
                    Some("tool.call") => totals.tool_calls = totals.tool_calls.saturating_add(1),
                    _ => {}
                }
            }
        }
        for task in self.background_task_store.list()? {
            totals.requests = totals.requests.saturating_add(task.usage.requests);
            totals.prompt_tokens = totals.prompt_tokens.saturating_add(task.usage.prompt_tokens);
            totals.completion_tokens = totals.completion_tokens.saturating_add(task.usage.completion_tokens);
            totals.total_tokens = totals.total_tokens.saturating_add(task.usage.total_tokens);
            totals.requests_without_usage = totals.requests_without_usage.saturating_add(task.usage.requests_without_usage);
            totals.duration_ms = totals.duration_ms.saturating_add(task.usage.duration_ms);
            totals.tool_calls = totals.tool_calls.saturating_add(task.usage.tool_calls);
        }
        Ok(totals)
    }

    fn record_tool_call(&self, tool: &str) {
        let result = (|| -> Result<(), AgentError> {
            if let Some(parent) = self.usage_file.parent() { fs::create_dir_all(parent)?; }
            let mut options = OpenOptions::new();
            options.create(true).append(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&self.usage_file)?;
            serde_json::to_writer(&mut file, &json!({
                "timestamp_ms": now_ms(), "event": "tool.call",
                "session_id": self.session.session_id, "tool": tool
            }))?;
            file.write_all(b"\n")?;
            Ok(())
        })();
        if let Err(error) = result { warn!(%error, "failed to write tool usage event"); }
    }

    pub fn list_background_tasks(&self) -> Result<Vec<BackgroundTaskRecord>, AgentError> {
        self.background_task_store.list()
    }

    pub fn get_background_task(&self, task_id: &str) -> Result<BackgroundTaskRecord, AgentError> {
        self.background_task_store.load(task_id)
    }

    pub fn start_background_task(&self, name: &str, task: &str) -> Result<String, AgentError> {
        self.start_background_task_with_profile(name, task, None)
    }

    pub fn start_background_task_with_profile(
        &self,
        name: &str,
        task: &str,
        profile_id: Option<&str>,
    ) -> Result<String, AgentError> {
        if tokio::runtime::Handle::try_current().is_err() {
            return Err(AgentError::InvalidAction(
                "background tasks must be started from inside a Tokio runtime".into(),
            ));
        }
        let name = name.trim();
        let task = task.trim();
        if name.is_empty() || name.len() > 80 || task.is_empty() || task.len() > 10_000 {
            return Err(AgentError::InvalidAction(
                "background task requires a 1–80 byte name and a 1–10000 byte task".into(),
            ));
        }

        let profile = self.resolve_agent_profile(profile_id, AgentProfile::default_background())?;
        profile.validate()?;
        let mut task_provider = self.provider.clone();
        if let Some(model) = profile.model.as_deref() {
            task_provider.set_model(model.to_owned())?;
        }

        let records = self.background_task_store.list()?;
        let active_count = records.iter()
            .filter(|record| matches!(
                record.status,
                BackgroundTaskStatus::Queued | BackgroundTaskStatus::Running | BackgroundTaskStatus::Cancelling
            ))
            .count();
        if active_count >= MAX_ACTIVE_BACKGROUND_TASKS {
            return Err(AgentError::InvalidAction(format!(
                "at most {MAX_ACTIVE_BACKGROUND_TASKS} background tasks may be active"
            )));
        }

        let now = now_ms();
        let task_id = new_session_id(now);
        let record = BackgroundTaskRecord {
            schema_version: BACKGROUND_TASK_SCHEMA_VERSION,
            task_id: task_id.clone(),
            name: name.to_owned(),
            parent_session_id: self.session.session_id.clone(),
            model: task_provider.model().to_owned(),
            status: BackgroundTaskStatus::Queued,
            step: 0,
            created_at_ms: now,
            updated_at_ms: now,
            result: None,
            error: None,
            delivered_at_ms: None,
            agent_profile: Some(profile.clone()),
            usage: UsageTotals::default(),
            messages: vec![
                profile.system_message(),
                ChatMessage {
                    role: "user".into(),
                    content: task.to_owned(),
                },
            ],
        };
        self.background_task_store.save(&record)?;
        self.spawn_background_task(record)?;
        self.audit("background_task.started", Some("start_background_task"), json!({
            "task_id": task_id,
            "name": name,
            "agent_profile_id": profile.id,
            "model": task_provider.model(),
            "task_length": task.len()
        }));
        Ok(task_id)
    }

    /// Requeues durable tasks left queued or running by a previous process.
    pub fn resume_background_tasks(&self) -> Result<usize, AgentError> {
        if tokio::runtime::Handle::try_current().is_err() {
            return Err(AgentError::InvalidAction(
                "background tasks must be resumed from inside a Tokio runtime".into(),
            ));
        }

        let records = self.background_task_store.list()?;
        let mut resumed = 0usize;
        for mut record in records {
            if record.status == BackgroundTaskStatus::Cancelling {
                record.status = BackgroundTaskStatus::Cancelled;
                record.updated_at_ms = now_ms();
                self.background_task_store.save(&record)?;
                continue;
            }
            if !matches!(record.status, BackgroundTaskStatus::Queued | BackgroundTaskStatus::Running) {
                continue;
            }
            let already_active = self.background_task_controls
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .contains_key(&record.task_id);
            if already_active {
                continue;
            }
            if record.status == BackgroundTaskStatus::Running {
                record.status = BackgroundTaskStatus::Queued;
                record.updated_at_ms = now_ms();
                self.background_task_store.save(&record)?;
            }
            self.spawn_background_task(record)?;
            resumed += 1;
        }
        Ok(resumed)
    }

    fn spawn_background_task(&self, mut record: BackgroundTaskRecord) -> Result<(), AgentError> {
        if tokio::runtime::Handle::try_current().is_err() {
            return Err(AgentError::InvalidAction(
                "background tasks must be started from inside a Tokio runtime".into(),
            ));
        }
        let mut provider = self.provider.clone();
        provider.set_model(record.model.clone())?;
        let profile = record.agent_profile.clone()
            .unwrap_or_else(AgentProfile::default_background);
        profile.validate()?;
        let task_id = record.task_id.clone();
        let cancellation = CancellationHandle::new();
        let notify = Arc::new(Notify::new());
        let control = BackgroundTaskControl {
            cancellation: cancellation.clone(),
            notify: notify.clone(),
        };

        {
            let mut controls = self.background_task_controls
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if controls.contains_key(&task_id) {
                return Ok(());
            }
            let current = self.background_task_store.load(&task_id)?;
            if current.status.is_terminal() || current.status == BackgroundTaskStatus::Cancelling {
                return Ok(());
            }
            record = current;
            controls.insert(task_id.clone(), control);
            record.status = BackgroundTaskStatus::Running;
            record.updated_at_ms = now_ms();
            if let Err(error) = self.background_task_store.save(&record) {
                controls.remove(&task_id);
                return Err(error);
            }
        }

        let executor = self.executor.clone();
        let store = self.background_task_store.clone();
        let controls = Arc::clone(&self.background_task_controls);
        tokio::spawn(async move {
            let outcome = execute_background_task(
                &mut record,
                &provider,
                &executor,
                &store,
                &cancellation,
                &controls,
                &profile,
            ).await;

            let mut active_controls = controls
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let cancellation_requested = store.load(&task_id)
                .map(|current| current.status == BackgroundTaskStatus::Cancelling)
                .unwrap_or(false);

            if cancellation_requested || matches!(&outcome, Err(AgentError::Cancelled)) {
                record.status = BackgroundTaskStatus::Cancelled;
                record.result = None;
                record.error = None;
            } else {
                match outcome {
                    Ok(result) => {
                        record.status = BackgroundTaskStatus::Completed;
                        record.result = Some(result);
                        record.error = None;
                    }
                    Err(error) => {
                        record.status = BackgroundTaskStatus::Failed;
                        record.error = Some(error.to_string());
                    }
                }
            }
            record.updated_at_ms = now_ms();
            if let Err(error) = store.save(&record) {
                warn!(task_id = %task_id, %error, "failed to persist background task result");
            }

            let completed_control = active_controls.remove(&task_id);
            drop(active_controls);
            if let Some(control) = completed_control {
                control.notify.notify_waiters();
            } else {
                notify.notify_waiters();
            }
        });
        Ok(())
    }

    pub fn cancel_background_task(&self, task_id: &str) -> Result<bool, AgentError> {
        let controls = self.background_task_controls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut record = self.background_task_store.load(task_id)?;
        if record.status.is_terminal() {
            return Ok(false);
        }

        if let Some(control) = controls.get(task_id) {
            record.status = BackgroundTaskStatus::Cancelling;
            record.updated_at_ms = now_ms();
            self.background_task_store.save(&record)?;
            control.cancellation.cancel();
        } else {
            record.status = BackgroundTaskStatus::Cancelled;
            record.updated_at_ms = now_ms();
            record.error = None;
            self.background_task_store.save(&record)?;
        }
        drop(controls);
        self.audit("background_task.cancel_requested", Some("cancel_background_task"), json!({
            "task_id": task_id
        }));
        Ok(true)
    }

    pub async fn wait_background_task(
        &self,
        task_id: &str,
    ) -> Result<BackgroundTaskRecord, AgentError> {
        self.wait_background_task_with_cancellation(task_id, &CancellationHandle::new()).await
    }

    pub async fn wait_background_task_with_cancellation(
        &self,
        task_id: &str,
        cancellation: &CancellationHandle,
    ) -> Result<BackgroundTaskRecord, AgentError> {
        let initial = self.background_task_store.load(task_id)?;
        if initial.status.is_terminal() {
            return Ok(initial);
        }

        let notify = self.background_task_controls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(task_id)
            .map(|control| Arc::clone(&control.notify));
        let Some(notify) = notify else {
            let current = self.background_task_store.load(task_id)?;
            if current.status.is_terminal() {
                return Ok(current);
            }
            return Err(AgentError::InvalidAction(
                "background task has no active worker; call resume_background_tasks".into(),
            ));
        };

        loop {
            let notified = notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();

            let record = self.background_task_store.load(task_id)?;
            if record.status.is_terminal() {
                return Ok(record);
            }
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Err(AgentError::Cancelled),
                _ = notified => {
                    let current = self.background_task_store.load(task_id)?;
                    if current.status.is_terminal() {
                        return Ok(current);
                    }
                    let worker_active = self.background_task_controls
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .contains_key(task_id);
                    if !worker_active {
                        return Err(AgentError::InvalidAction(
                            "background worker stopped before persisting a terminal task status".into(),
                        ));
                    }
                }
            }
        }
    }

    pub fn deliver_background_task(&mut self, task_id: &str) -> Result<(), AgentError> {
        let mut record = self.background_task_store.load(task_id)?;
        if record.status != BackgroundTaskStatus::Completed {
            return Err(AgentError::InvalidAction(
                "only completed background tasks can be delivered".into(),
            ));
        }
        if record.parent_session_id != self.session.session_id {
            return Err(AgentError::InvalidAction(
                "background task belongs to a different parent session".into(),
            ));
        }
        let marker = format!("Background task result [{}]", task_id);
        if self.messages.iter().any(|message| message.content.starts_with(&marker)) {
            record.delivered_at_ms.get_or_insert_with(now_ms);
            self.background_task_store.save(&record)?;
            return Ok(());
        }

        let result = record.result.as_deref().unwrap_or("Task completed without a result.");
        self.messages.push(ChatMessage {
            role: "user".into(),
            content: format!(
                "{marker}:\n{}",
                result.chars().take(MAX_BACKGROUND_TASK_RESULT_CHARS).collect::<String>()
            ),
        });
        self.persist()?;
        record.delivered_at_ms = Some(now_ms());
        self.background_task_store.save(&record)?;
        self.audit("background_task.delivered", Some("deliver_background_task"), json!({
            "task_id": task_id,
            "result_length": result.len()
        }));
        Ok(())
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
        self.run_turn_with_cancellation(input, &CancellationHandle::new()).await
    }

    /// Runs one turn with a host-controlled cancellation handle.
    /// Cancelling stops in-flight provider requests; already completed local tool
    /// operations are not rolled back.
    pub async fn run_turn_with_cancellation(
        &mut self,
        input: &str,
        cancellation: &CancellationHandle,
    ) -> Result<String, AgentError> {
        if cancellation.is_cancelled() {
            return Err(AgentError::Cancelled);
        }

        let session_id = self.session.session_id.clone();
        for hook in &self.hooks {
            hook.before_turn(&session_id, input).map_err(AgentError::InvalidAction)?;
        }
        self.emit_event("turn.start", None, json!({"input_length": input.len()}));
        let result = self.run_turn_inner(input, cancellation).await;
        self.emit_event("turn.end", None, json!({"ok": result.is_ok()}));
        if matches!(&result, Err(AgentError::Cancelled)) {
            self.messages.push(ChatMessage {
                role: "assistant".into(),
                content: json!({
                    "type": "final",
                    "content": "This turn was cancelled. Do not assume an incomplete tool action was executed."
                }).to_string(),
            });
            self.audit("turn.cancelled", None, json!({}));
            self.persist()?;
        }
        let hook_result = result.as_ref().map(Clone::clone).map_err(ToString::to_string);
        for hook in &self.hooks { hook.after_turn(&session_id, &hook_result); }
        result
    }

    async fn run_turn_inner(
        &mut self,
        input: &str,
        cancellation: &CancellationHandle,
    ) -> Result<String, AgentError> {
        let memories = self.retrieve_memories(input, 12)?;
        let memory_text = memories.iter().map(|record| record.content.clone()).collect::<Vec<_>>();
        let (composed_input, context_report) = self.context_manager.compose(input, &memory_text);
        self.context_report = Some(context_report.clone());
        self.emit_event("context.assembled", None, json!({
            "estimated_input_tokens": context_report.estimated_input_tokens,
            "max_input_tokens": context_report.max_input_tokens,
            "included_memories": context_report.included_memories,
            "omitted_memories": context_report.omitted_memories
        }));
        let mut user_content = composed_input;
        if !self.pending_attachments.is_empty() {
            user_content.push_str("\n\nAttachments supplied with this turn (use read_attachment with the ID to inspect UTF-8 text files):");
            for attachment in self.pending_attachments.drain(..) {
                user_content.push_str(&format!("\n- id={} filename={:?} content_type={} size_bytes={}", attachment.id, attachment.filename, attachment.content_type, attachment.size_bytes));
            }
        }
        self.messages.push(ChatMessage {
            role: "user".into(),
            content: user_content,
        });
        self.compact_history();
        self.audit("prompt.submit", None, json!({"prompt_length": input.len()}));
        self.persist()?;

        for step in 0..self.max_tool_calls_per_turn {
            let provider = &self.provider;
            let request_messages = self.messages_with_agent_catalog();
            let hooks = &self.hooks;
            let session_id = self.session.session_id.clone();
            let mut streamed_bytes = 0usize;
            let stream_result = tokio::select! {
                biased;
                _ = cancellation.cancelled() => None,
                result = provider.complete_streaming_with_usage(&request_messages, |delta| {
                    streamed_bytes = streamed_bytes.saturating_add(delta.len());
                    let event = RuntimeEvent {
                        session_id: session_id.clone(),
                        name: "model.output.delta".into(),
                        tool: None,
                        details: json!({"delta": delta, "length": delta.len()}),
                    };
                    for hook in hooks {
                        hook.on_event(&event);
                    }
                }) => Some(result),
            };
            let completion = match stream_result {
                None => {
                    self.emit_event("model.output.aborted", None, json!({
                        "step": step + 1,
                        "partial_bytes": streamed_bytes,
                        "partial_output_discarded": true
                    }));
                    return Err(AgentError::Cancelled);
                }
                Some(result) => result?,
            };
            self.record_usage("primary", None, &completion.model, &completion.usage, completion.duration_ms);
            let raw = completion.content;
            if cancellation.is_cancelled() {
                self.emit_event("model.output.aborted", None, json!({
                    "step": step + 1,
                    "partial_bytes": streamed_bytes,
                    "partial_output_discarded": true
                }));
                return Err(AgentError::Cancelled);
            }
            self.emit_event("model.output.complete", None, json!({"step": step + 1, "length": raw.len()}));
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
                    if cancellation.is_cancelled() {
                        self.push_tool_result(false, "Question interaction was cancelled before input.");
                        return Err(AgentError::Cancelled);
                    }
                    if questions.is_empty() {
                        self.push_tool_result(false, "ask_user requires at least one question");
                    } else {
                        let answers = self.request_user_answers(&questions)?;
                        if cancellation.is_cancelled() {
                            self.push_tool_result(false, "Question interaction was cancelled by the host.");
                            return Err(AgentError::Cancelled);
                        }
                        self.audit("user_question.answered", None, json!({
                            "question_count": questions.len(),
                            "answer_count": answers.as_object().map_or(0, |object| object.len())
                        }));
                        self.push_tool_result(true, &format!("User answers: {answers}"));
                    }
                    self.persist()?;
                }
                ModelTurn::ToolCall { tool, arguments } => {
                    if cancellation.is_cancelled() {
                        self.push_tool_result(false, "Tool dispatch was cancelled before execution.");
                        return Err(AgentError::Cancelled);
                    }
                    let action = ToolAction { name: tool, arguments };
                    self.record_tool_call(&action.name);
                    let hook_denial = self.hooks.iter()
                        .find_map(|hook| hook.before_tool(&action).err());
                    if let Some(reason) = hook_denial {
                        self.audit("hook.tool_denied", Some(&action.name), json!({"reason": reason}));
                        self.push_tool_result(false, &format!("Denied by runtime hook: {reason}"));
                    } else if action.name == "start_background_task" {
                        let name = action.arguments.get("name").and_then(Value::as_str).unwrap_or("background task");
                        let task = action.arguments.get("task").and_then(Value::as_str).unwrap_or("");
                        let profile_id = action.arguments.get("agent").and_then(Value::as_str);
                        match self.start_background_task_with_profile(name, task, profile_id) {
                            Ok(task_id) => self.push_tool_result(true, &format!("Background task started. Task ID: {task_id}. Use /tasks and /wait {task_id} to inspect and collect its result.")),
                            Err(error) => self.push_tool_result(false, &error.to_string()),
                        }
                    } else if action.name == "delegate_task" {
                        match self.run_subagent(&action, cancellation).await {
                            Ok(output) => self.push_tool_result(true, &output),
                            Err(AgentError::Cancelled) => {
                                self.push_tool_result(false, "Delegated task was cancelled by the host.");
                                self.persist()?;
                                return Err(AgentError::Cancelled);
                            },
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
                                } else {
                                    let approved = tokio::select! {
                                        biased;
                                        _ = cancellation.cancelled() => {
                                            return Err(AgentError::Cancelled);
                                        }
                                        result = self.request_approval(&action) => result?,
                                    };
                                    if cancellation.is_cancelled() {
                                        self.push_tool_result(false, "Write approval was cancelled by the host.");
                                        return Err(AgentError::Cancelled);
                                    }
                                    if approved {
                                        self.audit("policy.approve", Some(&action.name), json!({}));
                                        self.execute_and_record(&action);
                                    } else {
                                        self.audit("policy.user_denied", Some(&action.name), json!({}));
                                        self.push_tool_result(false, "User declined the operation");
                                    }
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

            if cancellation.is_cancelled() {
                return Err(AgentError::Cancelled);
            }
        }

        if cancellation.is_cancelled() {
            return Err(AgentError::Cancelled);
        }
        self.audit("turn.limit_reached", None, json!({"limit": self.max_tool_calls_per_turn}));
        Ok(format!(
            "Stopped after reaching the per-turn tool-call limit ({}).",
            self.max_tool_calls_per_turn
        ))
    }

    async fn run_subagent(
        &self,
        action: &ToolAction,
        cancellation: &CancellationHandle,
    ) -> Result<String, AgentError> {
        let task = action.arguments.get("task").and_then(Value::as_str)
            .filter(|task| !task.trim().is_empty())
            .ok_or_else(|| AgentError::InvalidAction("delegate_task requires a non-empty task".into()))?;
        let requested_name = action.arguments.get("name").and_then(Value::as_str);
        if task.len() > 10_000 || requested_name.is_some_and(|name| name.len() > 80) {
            return Err(AgentError::InvalidAction("subagent name or task exceeds the configured limit".into()));
        }

        let profile_id = action.arguments.get("agent").and_then(Value::as_str);
        let profile = self.resolve_agent_profile(profile_id, AgentProfile::default_subagent())?;
        profile.validate()?;
        let name = requested_name.unwrap_or(&profile.name);

        let mut provider = self.provider.clone();
        if let Some(model) = profile.model.as_deref() {
            provider.set_model(model.to_owned())?;
        }

        self.audit("subagent.start", Some("delegate_task"), json!({
            "name": name,
            "agent_profile_id": profile.id,
            "model": provider.model(),
            "task_length": task.len(),
            "max_turns": profile.max_steps,
            "allowed_tools": profile.allowed_tools
        }));

        let mut messages = vec![
            profile.system_message(),
            ChatMessage { role: "user".into(), content: task.to_owned() },
        ];

        for step in 0..profile.max_steps {
            let completion = tokio::select! {
                biased;
                _ = cancellation.cancelled() => None,
                result = provider.complete_with_usage(&messages) => Some(result),
            };
            let completion = match completion {
                None => {
                    self.audit("subagent.cancelled", Some("delegate_task"), json!({"name": name, "step": step + 1}));
                    return Err(AgentError::Cancelled);
                }
                Some(result) => result?,
            };
            self.record_usage("subagent", Some(&profile.id), &completion.model, &completion.usage, completion.duration_ms);
            let raw = completion.content;
            if cancellation.is_cancelled() {
                self.audit("subagent.cancelled", Some("delegate_task"), json!({
                    "name": name, "step": step + 1
                }));
                return Err(AgentError::Cancelled);
            }
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
                        "name": name,
                        "agent_profile_id": profile.id,
                        "tool_calls": step,
                        "result_length": content.len()
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
                    self.record_tool_call(&sub_action.name);
                    let hook_denial = self.hooks.iter()
                        .find_map(|hook| hook.before_tool(&sub_action).err());
                    let result = if let Some(reason) = hook_denial {
                        crate::action::ToolResult {
                            ok: false,
                            output: format!("Denied by runtime hook: {reason}"),
                        }
                    } else if !profile.allows_tool(&sub_action.name)
                        || !is_subagent_read_tool(&sub_action.name)
                        || !matches!(policy::evaluate(&sub_action), PolicyDecision::Allow) {
                        crate::action::ToolResult {
                            ok: false,
                            output: "Tool is not included in this Agent profile's read-only allow-list".into(),
                        }
                    } else {
                        match self.executor.execute(&sub_action) {
                            Ok(result) => result,
                            Err(error) => crate::action::ToolResult {
                                ok: false,
                                output: error.to_string(),
                            },
                        }
                    };
                    self.audit("subagent.tool", Some(&sub_action.name), json!({
                        "name": name,
                        "agent_profile_id": profile.id,
                        "ok": result.ok,
                        "step": step + 1
                    }));
                    let output: String = result.output.chars().take(12_000).collect();
                    messages.push(ChatMessage {
                        role: "user".into(),
                        content: format!("Tool result (ok={}): {}", result.ok, output),
                    });
                }
            }

            if cancellation.is_cancelled() {
                self.audit("subagent.cancelled", Some("delegate_task"), json!({
                    "name": name, "step": step + 1
                }));
                return Err(AgentError::Cancelled);
            }
        }

        if cancellation.is_cancelled() {
            self.audit("subagent.cancelled", Some("delegate_task"), json!({"name": name}));
            return Err(AgentError::Cancelled);
        }
        self.audit("subagent.limit_reached", Some("delegate_task"), json!({
            "name": name,
            "agent_profile_id": profile.id,
            "limit": profile.max_steps
        }));
        Ok(format!(
            "Subagent stopped after reaching its {}-step limit.",
            profile.max_steps
        ))
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

    async fn request_approval(&self, action: &ToolAction) -> Result<bool, AgentError> {
        self.emit_event("approval.requested", Some(&action.name), json!({
            "path": action.arguments.get("path").and_then(Value::as_str)
        }));
        let approved = if let Some(handler) = &self.approval_handler {
            handler.request_approval(action).await?
        } else {
            let path = action.arguments.get("path").and_then(Value::as_str).unwrap_or("<invalid path>").to_owned();
            tokio::task::spawn_blocking(move || {
                print!("Approve write_file to '{path}'? Type 'yes' to continue: ");
                io::stdout().flush()?;
                let mut answer = String::new();
                io::stdin().read_line(&mut answer)?;
                Ok::<bool, std::io::Error>(answer.trim().eq_ignore_ascii_case("yes"))
            }).await.map_err(|error| AgentError::InvalidAction(format!("approval prompt task failed: {error}")))??
        };
        self.emit_event("approval.resolved", Some(&action.name), json!({"approved": approved}));
        Ok(approved)
    }

    fn persist(&mut self) -> Result<(), AgentError> {
        self.session.updated_at_ms = now_ms();
        self.session.messages = self.messages.clone();
        self.store.save(&self.session)
    }

    fn emit_event(&self, name: &str, tool: Option<&str>, details: Value) {
        let event = RuntimeEvent {
            session_id: self.session.session_id.clone(),
            name: name.to_owned(),
            tool: tool.map(ToOwned::to_owned),
            details,
        };
        for hook in &self.hooks {
            hook.on_event(&event);
        }
    }

    fn record_usage(&self, agent_type: &str, profile_id: Option<&str>, model: &str, usage: &CompletionUsage, duration_ms: u64) {
        let result = (|| -> Result<(), AgentError> {
            if let Some(parent) = self.usage_file.parent() { fs::create_dir_all(parent)?; }
            let mut options = OpenOptions::new();
            options.create(true).append(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&self.usage_file)?;
            let event = json!({
                "timestamp_ms": now_ms(),
                "event": "model.usage",
                "session_id": self.session.session_id,
                "agent_type": agent_type,
                "agent_profile_id": profile_id,
                "model": model,
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.total_tokens,
                "duration_ms": duration_ms
            });
            serde_json::to_writer(&mut file, &event)?;
            file.write_all(b"\n")?;
            Ok(())
        })();
        if let Err(error) = result { warn!(%error, "failed to write usage event"); }
        self.audit("model.usage", None, json!({
            "agent_type": agent_type, "agent_profile_id": profile_id, "model": model,
            "prompt_tokens": usage.prompt_tokens, "completion_tokens": usage.completion_tokens,
            "total_tokens": usage.total_tokens, "duration_ms": duration_ms
        }));
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


async fn execute_background_task(
    record: &mut BackgroundTaskRecord,
    provider: &OpenAiCompatibleProvider,
    executor: &ToolExecutor,
    store: &BackgroundTaskStore,
    cancellation: &CancellationHandle,
    controls: &SharedTaskControls,
    profile: &AgentProfile,
) -> Result<String, AgentError> {
    for step in record.step..profile.max_steps {
        if cancellation.is_cancelled() {
            return Err(AgentError::Cancelled);
        }
        let completion = tokio::select! {
            biased;
            _ = cancellation.cancelled() => None,
            result = provider.complete_with_usage(&record.messages) => Some(result),
        };
        let completion = match completion {
            None => return Err(AgentError::Cancelled),
            Some(result) => result?,
        };
        record.usage.add_completion(&completion.usage, completion.duration_ms);
        record.updated_at_ms = now_ms();
        store.save(record)?;
        let raw = completion.content;
        if cancellation.is_cancelled() {
            return Err(AgentError::Cancelled);
        }
        record.messages.push(ChatMessage {
            role: "assistant".into(),
            content: raw.clone(),
        });

        let turn = serde_json::from_str::<ModelTurn>(&raw)
            .map_err(|error| AgentError::InvalidAction(format!(
                "background task returned invalid action JSON: {error}"
            )))?;

        match turn {
            ModelTurn::Final { content } => {
                return Ok(content.chars().take(MAX_BACKGROUND_TASK_RESULT_CHARS).collect());
            }
            ModelTurn::AskUser { .. } => {
                return Err(AgentError::InvalidAction(
                    "background tasks cannot ask the user questions".into(),
                ));
            }
            ModelTurn::ToolCall { tool, arguments } => {
                let action = ToolAction { name: tool, arguments };
                record.usage.tool_calls = record.usage.tool_calls.saturating_add(1);
                let tool_result = if profile.allows_tool(&action.name) && is_custom_agent_read_tool(&action.name)
                    && matches!(policy::evaluate(&action), PolicyDecision::Allow)
                {
                    match executor.execute(&action) {
                        Ok(result) => result,
                        Err(error) => crate::action::ToolResult {
                            ok: false,
                            output: error.to_string(),
                        },
                    }
                } else {
                    crate::action::ToolResult {
                        ok: false,
                        output: "Background tasks are restricted to read-only workspace tools".into(),
                    }
                };
                let output: String = tool_result.output.chars().take(12_000).collect();
                record.messages.push(ChatMessage {
                    role: "user".into(),
                    content: format!(
                        "Tool result (ok={}): {}",
                        tool_result.ok,
                        output
                    ),
                });
                record.step = step + 1;
                record.updated_at_ms = now_ms();
                {
                    let _active_controls = controls
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if cancellation.is_cancelled() {
                        return Err(AgentError::Cancelled);
                    }
                    store.save(record)?;
                }

                if cancellation.is_cancelled() {
                    return Err(AgentError::Cancelled);
                }
            }
        }
    }

    Err(AgentError::InvalidAction(format!(
        "background task reached its {}-step limit",
        profile.max_steps
    )))
}

fn is_subagent_read_tool(name: &str) -> bool {
    matches!(name, "read_file" | "list_dir" | "search_files")
}

fn system_message(custom: Option<&str>) -> ChatMessage {
    ChatMessage {
        role: "system".into(),
        content: custom.unwrap_or(SYSTEM_PROMPT).to_owned(),
    }
}

fn new_trace_id() -> String { format!("trace-{:x}", now_ms()) }

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
    use super::{
        AgentProfile, AgentProfileStore, BackgroundTaskRecord, BackgroundTaskStatus,
        BackgroundTaskStore, CancellationHandle, ChatMessage, CompletionUsage, UsageTotals, MAX_AGENT_PROFILE_STEPS,
        SessionStore, is_custom_agent_read_tool, new_session_id, now_ms,
    };

    #[test]
    fn subagents_are_restricted_to_read_only_tools() {
        assert!(super::is_subagent_read_tool("read_file"));
        assert!(super::is_subagent_read_tool("list_dir"));
        assert!(super::is_subagent_read_tool("search_files"));
        assert!(!super::is_subagent_read_tool("write_file"));
        assert!(!super::is_subagent_read_tool("delegate_task"));
    }

    #[tokio::test]
    async fn cancellation_handle_wakes_waiters_and_is_idempotent() {
        let cancellation = CancellationHandle::new();
        let waiter_handle = cancellation.clone();
        let waiter = tokio::spawn(async move {
            waiter_handle.cancelled().await;
        });

        cancellation.cancel();
        cancellation.cancel();
        waiter.await.expect("cancellation waiter should complete");
        assert!(cancellation.is_cancelled());
    }

    #[tokio::test]
    async fn cancellation_handle_returns_immediately_when_already_cancelled() {
        let cancellation = CancellationHandle::new();
        cancellation.cancel();
        cancellation.cancelled().await;
        assert!(cancellation.is_cancelled());
    }


    #[test]
    fn default_agent_profiles_are_valid_and_read_only() {
        let subagent = AgentProfile::default_subagent();
        let background = AgentProfile::default_background();
        assert!(subagent.validate().is_ok());
        assert!(background.validate().is_ok());
        let mut tool_free = AgentProfile::default_subagent();
        tool_free.id = "reasoning-only".into();
        tool_free.allowed_tools.clear();
        assert!(tool_free.validate().is_ok());
        assert!(subagent.allowed_tools.iter().all(|tool| is_custom_agent_read_tool(tool)));
        assert!(background.allowed_tools.iter().all(|tool| is_custom_agent_read_tool(tool)));
    }

    #[test]
    fn custom_agent_profiles_reject_write_tools_and_invalid_limits() {
        let mut profile = AgentProfile::default_subagent();
        profile.id = "security-reviewer".into();
        profile.allowed_tools = vec!["read_file".into(), "write_file".into()];
        assert!(profile.validate().is_err());

        let mut profile = AgentProfile::default_subagent();
        profile.id = "too-many-steps".into();
        profile.max_steps = MAX_AGENT_PROFILE_STEPS + 1;
        assert!(profile.validate().is_err());

        let mut profile = AgentProfile::default_subagent();
        profile.id = "../outside".into();
        assert!(profile.validate().is_err());
    }

    #[test]
    fn agent_profile_store_round_trips_profiles() {
        let directory = std::env::temp_dir().join(format!(
            "rust-agent-profile-store-{}",
            new_session_id(now_ms())
        ));
        let store = AgentProfileStore::new(directory.clone());
        let mut profile = AgentProfile::default_subagent();
        profile.id = "security-reviewer".into();
        profile.name = "Security reviewer".into();
        profile.allowed_tools = vec!["read_file".into(), "search_files".into()];
        profile.max_steps = 9;

        store.save(&profile).expect("profile should save");
        let loaded = store.load("security-reviewer").expect("profile should load");
        assert_eq!(loaded.id, profile.id);
        assert_eq!(loaded.allowed_tools, profile.allowed_tools);
        assert_eq!(loaded.max_steps, 9);
        assert_eq!(store.list().expect("profiles should list").len(), 1);

        store.remove("security-reviewer").expect("profile should delete");
        assert!(store.list().expect("empty list should load").is_empty());
        std::fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn background_task_ids_are_safe_file_names() {
        assert!(BackgroundTaskStore::validate_id("task-123_abc").is_ok());
        assert!(BackgroundTaskStore::validate_id("../outside").is_err());
        assert!(BackgroundTaskStore::validate_id("task with spaces").is_err());
    }

    #[test]
    fn background_task_statuses_are_stable_snake_case_values() {
        assert_eq!(
            serde_json::to_string(&BackgroundTaskStatus::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&BackgroundTaskStatus::Cancelling).unwrap(),
            "\"cancelling\""
        );
        assert!(BackgroundTaskStatus::Completed.is_terminal());
        assert!(BackgroundTaskStatus::Failed.is_terminal());
        assert!(BackgroundTaskStatus::Cancelled.is_terminal());
        assert!(!BackgroundTaskStatus::Queued.is_terminal());
        assert!(!BackgroundTaskStatus::Running.is_terminal());
        assert!(!BackgroundTaskStatus::Cancelling.is_terminal());
    }

    #[test]
    fn usage_totals_accumulate_provider_usage_and_unknown_responses() {
        let mut totals = UsageTotals::default();
        totals.add_completion(&CompletionUsage {
            prompt_tokens: Some(10),
            completion_tokens: Some(5),
            total_tokens: Some(15),
        }, 120);
        totals.add_completion(&CompletionUsage::default(), 80);
        assert_eq!(totals.requests, 2);
        assert_eq!(totals.prompt_tokens, 10);
        assert_eq!(totals.completion_tokens, 5);
        assert_eq!(totals.total_tokens, 15);
        assert_eq!(totals.requests_without_usage, 1);
        assert_eq!(totals.duration_ms, 200);
    }

    #[test]
    fn background_task_store_round_trips_durable_state() {
        let directory = std::env::temp_dir().join(format!(
            "rust-agent-task-store-{}",
            new_session_id(now_ms())
        ));
        let store = BackgroundTaskStore::new(directory.clone());
        let record = BackgroundTaskRecord {
            schema_version: super::BACKGROUND_TASK_SCHEMA_VERSION,
            task_id: "task-round-trip".into(),
            name: "round trip".into(),
            parent_session_id: "parent-session".into(),
            model: "test-model".into(),
            status: BackgroundTaskStatus::Queued,
            step: 2,
            created_at_ms: 1,
            updated_at_ms: 2,
            result: None,
            error: None,
            delivered_at_ms: None,
            agent_profile: Some(AgentProfile::default_background()),
            usage: UsageTotals::default(),
            messages: vec![
                ChatMessage { role: "system".into(), content: "system".into() },
                ChatMessage { role: "user".into(), content: "task".into() },
            ],
        };

        store.save(&record).expect("task should be persisted");
        let loaded = store.load("task-round-trip").expect("task should load");
        assert_eq!(loaded.task_id, record.task_id);
        assert_eq!(loaded.parent_session_id, record.parent_session_id);
        assert_eq!(loaded.status, BackgroundTaskStatus::Queued);
        assert_eq!(loaded.step, 2);
        assert_eq!(
            loaded.agent_profile.as_ref().map(|profile| profile.id.as_str()),
            Some("default-background")
        );
        assert_eq!(store.list().expect("tasks should list").len(), 1);

        let mut legacy_value = serde_json::to_value(&record).expect("task should serialize");
        legacy_value.as_object_mut().expect("task object").remove("agent_profile");
        legacy_value.as_object_mut().expect("task object").remove("usage");
        let legacy: BackgroundTaskRecord =
            serde_json::from_value(legacy_value).expect("legacy task without profile should load");
        assert!(legacy.agent_profile.is_none());
        assert_eq!(legacy.usage, UsageTotals::default());

        std::fs::remove_dir_all(directory).expect("test task directory should be removed");
    }

    #[test]
    fn session_ids_are_safe_file_names() {
        let id = new_session_id(now_ms());
        assert!(SessionStore::validate_id(&id).is_ok());
        assert!(SessionStore::validate_id("../outside").is_err());
        assert!(SessionStore::validate_id("with spaces").is_err());
    }
}
