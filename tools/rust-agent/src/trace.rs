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

const MAX_TRACE_LOG_BYTES: u64 = 32 * 1024 * 1024;
const TRACE_LOG_BACKUPS: usize = 3;
static NEXT_TRACE_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

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
        if let Some(parent) = path.parent() {
            ensure_real_directory(parent)?;
        }
        ensure_regular_file_or_missing(&path)?;
        let supplied_trace_id = trace_id.into();
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let instance = NEXT_TRACE_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        let trace_id = format!("{supplied_trace_id}-{}-{nonce:x}-{instance:x}", std::process::id());
        Ok(Self { path, trace_id, session_id: session_id.into(),
            sequence: Arc::new(AtomicU64::new(1)), write_lock: Arc::new(Mutex::new(())) })
    }

    pub fn append(&self, event: &str, tool: Option<&str>, details: Value) -> Result<TraceRecord, AgentError> {
        let _guard = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        let record = TraceRecord {
            schema_version: 1, timestamp_ms: now_ms(), trace_id: self.trace_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            session_id: self.session_id.clone(), event: event.to_owned(),
            tool: tool.map(str::to_owned), details: sanitize_details(&details),
        };
        let lock = lock_trace_file(&self.path)?;
        rotate_trace_log(&self.path)?;
        ensure_regular_file_or_missing(&self.path)?;
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&self.path)?;
        let mut line = serde_json::to_vec(&record)?;
        line.push(b'\n');
        file.write_all(&line)?;
        lock.unlock()?;
        Ok(record)
    }

    pub fn append_runtime_event(&self, event: &RuntimeEvent) -> Result<TraceRecord, AgentError> {
        let _guard = self.write_lock.lock().unwrap_or_else(|p| p.into_inner());
        let record = TraceRecord {
            schema_version: 1, timestamp_ms: now_ms(), trace_id: self.trace_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            session_id: event.session_id.clone(), event: event.name.clone(),
            tool: event.tool.clone(), details: sanitize_details(&event.details),
        };
        let lock = lock_trace_file(&self.path)?;
        rotate_trace_log(&self.path)?;
        ensure_regular_file_or_missing(&self.path)?;
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&self.path)?;
        let mut line = serde_json::to_vec(&record)?;
        line.push(b'\n');
        file.write_all(&line)?;
        lock.unlock()?;
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

fn rotate_trace_log(path: &Path) -> Result<(), AgentError> {
    ensure_regular_file_or_missing(path)?;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() < MAX_TRACE_LOG_BYTES { return Ok(()); }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("log");
    for generation in (1..=TRACE_LOG_BACKUPS).rev() {
        let source = if generation == 1 {
            path.to_path_buf()
        } else {
            path.with_extension(format!("{extension}.{}", generation - 1))
        };
        let destination = path.with_extension(format!("{extension}.{generation}"));
        ensure_regular_file_or_missing(&source)?;
        ensure_regular_file_or_missing(&destination)?;
        match fs::remove_file(&destination) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        match fs::rename(&source, &destination) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn lock_trace_file(path: &Path) -> Result<fs::File, AgentError> {
    let lock_path = path.with_extension("lock");
    ensure_regular_file_or_missing(&lock_path)?;
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(lock_path)?;
    file.lock()?;
    Ok(file)
}

fn ensure_real_directory(path: &Path) -> Result<(), AgentError> {
    if let Some(parent) = path.parent() {
        match fs::symlink_metadata(parent) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(AgentError::InvalidAction("trace directory parent must be a real directory".into()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(AgentError::InvalidAction("trace directory must be a real directory".into()));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(path)?,
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

fn ensure_regular_file_or_missing(path: &Path) -> Result<(), AgentError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(AgentError::InvalidAction("trace file must be a regular file, not a symbolic link".into()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn sanitize_details(value: &Value) -> Value {
    const SAFE_STRING_KEYS: &[&str] = &[
        "model", "agent_type", "agent_profile_id", "task_id", "parent_session_id",
        "attachment_id", "content_type", "mode",
    ];
    match value {
        Value::Object(object) => {
            let mut sanitized = serde_json::Map::new();
            for (key, item) in object {
                if matches!(key.as_str(), "delta" | "content" | "output" | "arguments" | "prompt" | "input" | "error" | "path" | "filename") {
                    continue;
                }
                match item {
                    Value::String(text) if SAFE_STRING_KEYS.contains(&key.as_str()) => {
                        sanitized.insert(key.clone(), Value::String(text.clone()));
                    }
                    Value::String(_) | Value::Array(_) | Value::Object(_) => {
                        let nested = sanitize_details(item);
                        if !nested.is_null() { sanitized.insert(key.clone(), nested); }
                    }
                    _ => { sanitized.insert(key.clone(), item.clone()); }
                }
            }
            Value::Object(sanitized)
        }
        Value::Array(items) => Value::Array(items.iter().map(sanitize_details).collect()),
        Value::String(_) => Value::Null,
        other => other.clone(),
    }
}

fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trace_logs_rotate_only_after_the_configured_size_limit() {
        let path = std::env::temp_dir().join(format!(
            "rust-agent-trace-rotate-{}.jsonl", std::process::id()
        ));
        fs::write(&path, vec![b'x'; (MAX_TRACE_LOG_BYTES + 1) as usize]).unwrap();
        rotate_trace_log(&path).unwrap();
        assert!(!path.exists());
        assert_eq!(
            fs::metadata(path.with_extension("jsonl.1")).unwrap().len(),
            MAX_TRACE_LOG_BYTES + 1
        );
        let _ = fs::remove_file(path.with_extension("jsonl.1"));
    }

    #[test]
    fn runtime_trace_redacts_freeform_payloads() {
        let details = json!({"delta": "private model output", "path": "/private/file", "length": 42, "model": "model-x"});
        let sanitized = sanitize_details(&details);
        assert!(sanitized.get("delta").is_none());
        assert!(sanitized.get("path").is_none());
        assert_eq!(sanitized["length"], 42);
        assert_eq!(sanitized["model"], "model-x");
    }

    #[test]
    fn appends_correlated_jsonl_events_with_sequence_numbers() {
        let path = std::env::temp_dir().join(format!("rust-agent-trace-{}.jsonl", now_ms()));
        let store = TraceStore::new(path.clone(), "session-1", "trace-1").unwrap();
        let other_store = TraceStore::new(path.clone(), "session-2", "trace-1").unwrap();
        let first = store.append("turn.start", None, json!({"input_length": 10})).unwrap();
        let second = store.append("tool.complete", Some("read_file"), json!({"ok": true})).unwrap();
        let other = other_store.append("turn.start", None, json!({"input_length": 5})).unwrap();
        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
        assert_eq!(other.sequence, 1);
        assert_ne!(first.trace_id, other.trace_id);
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content.lines().count(), 3);
        for line in content.lines() {
            serde_json::from_str::<TraceRecord>(line).expect("each trace append must be one valid JSONL record");
        }
        let _ = fs::remove_file(path);
    }
}
