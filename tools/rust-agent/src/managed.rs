use std::{path::PathBuf, sync::Arc};

use crate::{
    context::{ContextManager, ContextReport},
    error::AgentError,
    memory::{MemoryInput, MemoryQuery, MemoryRecord, MemoryStore},
    provider::OpenAiCompatibleProvider,
    runtime::{AgentRuntime, CancellationHandle, RuntimeEvent, RuntimeHook, RuntimeOptions},
    trace::{TraceHook, TraceStore},
};

/// Higher-level host facade that composes the existing native runtime with
/// explicit memory retrieval, context budgeting, lifecycle hooks and tracing.
pub struct ManagedRuntime {
    runtime: AgentRuntime,
    memory: MemoryStore,
    context: ContextManager,
    hooks: Vec<Arc<dyn ManagedHook>>,
    project_id: Option<String>,
    task_id: Option<String>,
    last_context_report: Option<ContextReport>,
}

pub trait ManagedHook: Send + Sync {
    fn before_turn(&self, _session_id: &str, _input: &str) -> Result<(), String> { Ok(()) }
    fn on_runtime_event(&self, _event: &RuntimeEvent) {}
    fn before_tool(&self, _action: &crate::action::ToolAction) -> Result<(), String> { Ok(()) }
    fn after_turn(&self, _session_id: &str, _result: &Result<String, String>) {}
}

struct ManagedHookBridge { hooks: Vec<Arc<dyn ManagedHook>> }

impl RuntimeHook for ManagedHookBridge {
    fn on_event(&self, event: &RuntimeEvent) {
        for hook in &self.hooks { hook.on_runtime_event(event); }
    }
    fn before_tool(&self, action: &crate::action::ToolAction) -> Result<(), String> {
        // Existing Rust policy remains authoritative. Managed hooks can only deny.
        for hook in &self.hooks {
            hook.before_tool(action)?;
        }
        Ok(())
    }
}

impl ManagedRuntime {
    pub fn new(
        provider: OpenAiCompatibleProvider,
        workspace: PathBuf,
        mut options: RuntimeOptions,
        context: ContextManager,
        project_id: Option<String>,
        hooks: Vec<Arc<dyn ManagedHook>>,
    ) -> Result<Self, AgentError> {
        let memory = MemoryStore::new(&workspace)?;
        let session_hint = options.session_id.clone().unwrap_or_else(|| "new-session".into());
        let trace_path = workspace.join(".rust-agent").join("traces.jsonl");
        let trace = TraceStore::new(trace_path, session_hint, new_trace_id())?;
        options.hooks.push(Box::new(TraceHook::new(trace)));
        options.hooks.push(Box::new(ManagedHookBridge { hooks: hooks.clone() }));
        let runtime = AgentRuntime::new(provider, workspace, options)?;
        Ok(Self { runtime, memory, context, hooks, project_id, task_id: None, last_context_report: None })
    }

    pub fn runtime(&self) -> &AgentRuntime { &self.runtime }
    pub fn runtime_mut(&mut self) -> &mut AgentRuntime { &mut self.runtime }
    pub fn last_context_report(&self) -> Option<&ContextReport> { self.last_context_report.as_ref() }
    pub fn set_task_scope(&mut self, task_id: Option<String>) { self.task_id = task_id; }

    /// Persisting memory is explicit. The runtime never silently promotes model output
    /// or tool results into durable user memory.
    pub fn remember(&self, input: MemoryInput) -> Result<MemoryRecord, AgentError> {
        self.memory.remember(input)
    }

    pub fn update_memory(&self, id: &str, content: &str, source: Option<&str>, confidence: Option<u8>) -> Result<MemoryRecord, AgentError> {
        self.memory.update(id, content, source, confidence)
    }
    pub fn forget_memory(&self, id: &str) -> Result<(), AgentError> { self.memory.forget(id) }
    pub fn list_memories(&self) -> Result<Vec<MemoryRecord>, AgentError> { self.memory.list() }

    pub fn retrieve_memories(&self, query: &str, limit: usize) -> Result<Vec<MemoryRecord>, AgentError> {
        self.memory.retrieve(&MemoryQuery {
            query: query.to_owned(), session_id: Some(self.runtime.session_id().to_owned()),
            project_id: self.project_id.clone(), task_id: self.task_id.clone(), limit,
        })
    }

    pub async fn run_turn(&mut self, input: &str) -> Result<String, AgentError> {
        self.run_turn_with_cancellation(input, &CancellationHandle::new()).await
    }

    pub async fn run_turn_with_cancellation(
        &mut self,
        input: &str,
        cancellation: &CancellationHandle,
    ) -> Result<String, AgentError> {
        let session_id = self.runtime.session_id().to_owned();
        for hook in &self.hooks {
            hook.before_turn(&session_id, input).map_err(AgentError::InvalidAction)?;
        }
        let memories = self.retrieve_memories(input, 12)?;
        let memory_text = memories.iter().map(|record| record.content.clone()).collect::<Vec<_>>();
        let (composed, report) = self.context.compose(input, &memory_text);
        self.last_context_report = Some(report);
        let result = self.runtime.run_turn_with_cancellation(&composed, cancellation).await;
        let hook_result = result.as_ref().map(Clone::clone).map_err(ToString::to_string);
        for hook in &self.hooks { hook.after_turn(&session_id, &hook_result); }
        result
    }
}

fn new_trace_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    format!("trace-{:x}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos())
}
