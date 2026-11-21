use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{error::AgentError, runtime::{RuntimeEvent, RuntimeHook}};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceRecord {
    pub schema_version: u32,
    pub timestamp_ms: u128,
    pub trace_id: String,
    pub sequence: u64,
    pub session_id: String,
    pub event: String,
    pub tool: Option<String>,
    pub details: Value,
}

#[derive(Clone)]
pub struct TraceStore {
    path: PathBuf,
    trace_id: String,
    session_id: String,
    sequence: Arc<AtomicU64>,
    write_lock: Arc<Mutex<()>>,
}

impl TraceStore {
    pub fn new(path: PathBuf, session_id: impl Into<String>, trace_id: impl Into<String>) -> Result<Self, AgentError> {
        if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
        Ok(Self { path, trace_id: trace_id.into(), session_id: session_id.into(),
            sequence: Arc::new(AtomicU64::new(1)), write_lock: Arc::new(Mutex::new(())) })
    }

    pub fn append(&self, event: &str, tool: Option<&str>, details: Value) -> Result<TraceRecord, AgentError> {
        let _guard = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        let record = TraceRecord {
            schema_version: 1, timestamp_ms: now_ms(), trace_id: self.trace_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            session_id: self.session_id.clone(), event: event.to_owned(),
            tool: tool.map(str::to_owned), details,
        };
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&self.path)?;
        serde_json::to_writer(&mut file, &record)?;
        file.write_all(b"\n")?;
        Ok(record)
    }

    pub fn append_runtime_event(&self, event: &RuntimeEvent) -> Result<TraceRecord, AgentError> {
        let _guard = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        let record = TraceRecord {
            schema_version: 1, timestamp_ms: now_ms(), trace_id: self.trace_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            session_id: event.session_id.clone(), event: event.name.clone(),
            tool: event.tool.clone(), details: event.details.clone(),
        };
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&self.path)?;
        serde_json::to_writer(&mut file, &record)?;
        file.write_all(b"\n")?;
        Ok(record)
    }

    pub fn path(&self) -> &Path { &self.path }
}

/// Existing runtime hooks are adapted into a durable trace stream. Payloads are
/// intentionally metadata-only; prompt text and tool contents are not persisted.
pub struct TraceHook { store: TraceStore }

impl TraceHook {
    pub fn new(store: TraceStore) -> Self { Self { store } }
}

impl RuntimeHook for TraceHook {
    fn on_event(&self, event: &RuntimeEvent) {
        if let Err(error) = self.store.append_runtime_event(event) {
            tracing::warn!(%error, "failed to persist runtime trace event");
        }
    }
}

fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn appends_correlated_jsonl_events_with_sequence_numbers() {
        let path = std::env::temp_dir().join(format!("rust-agent-trace-{}.jsonl", now_ms()));
        let store = TraceStore::new(path.clone(), "session-1", "trace-1").unwrap();
        let first = store.append("turn.start", None, json!({"input_length": 10})).unwrap();
        let second = store.append("tool.complete", Some("read_file"), json!({"ok": true})).unwrap();
        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content.lines().count(), 2);
        let _ = fs::remove_file(path);
    }
}
