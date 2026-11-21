use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{context::terms, error::AgentError};

const MEMORY_SCHEMA_VERSION: u32 = 1;
const MAX_MEMORY_TEXT: usize = 16_000;
const MAX_MEMORY_SOURCE: usize = 1_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind { Working, Session, LongTerm, Procedural }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope { Global, Project, Session, Task }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryRecord {
    pub schema_version: u32,
    pub id: String,
    pub kind: MemoryKind,
    pub scope: MemoryScope,
    pub scope_id: Option<String>,
    pub content: String,
    pub source: String,
    pub confidence: u8,
    pub created_at_ms: u128,
    pub updated_at_ms: u128,
    pub expires_at_ms: Option<u128>,
}

#[derive(Debug, Clone)]
pub struct MemoryQuery {
    pub query: String,
    pub session_id: Option<String>,
    pub project_id: Option<String>,
    pub limit: usize,
}

#[derive(Clone)]
pub struct MemoryStore { directory: PathBuf }

impl MemoryStore {
    pub fn new(workspace: &Path) -> Result<Self, AgentError> {
        let directory = workspace.join(".rust-agent").join("memory");
        Self::ensure_directory(&directory)?;
        Ok(Self { directory })
    }

    fn ensure_directory(path: &Path) -> Result<(), AgentError> {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() =>
                return Err(AgentError::InvalidAction("memory storage must be a real directory".into())),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(path)?;
            }
            Err(error) => return Err(error.into()),
        }
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }

    fn validate_id(id: &str) -> Result<(), AgentError> {
        if id.is_empty() || id.len() > 128
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(AgentError::InvalidAction("memory ID contains unsupported characters".into()));
        }
        Ok(())
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, AgentError> {
        Self::validate_id(id)?;
        Ok(self.directory.join(format!("{id}.json")))
    }

    pub fn remember(
        &self,
        kind: MemoryKind,
        scope: MemoryScope,
        scope_id: Option<String>,
        content: &str,
        source: &str,
        confidence: u8,
        expires_at_ms: Option<u128>,
    ) -> Result<MemoryRecord, AgentError> {
        let content = content.trim();
        let source = source.trim();
        if content.is_empty() || content.len() > MAX_MEMORY_TEXT
            || source.len() > MAX_MEMORY_SOURCE || confidence > 100 {
            return Err(AgentError::InvalidAction("memory content/source/confidence is outside configured limits".into()));
        }
        if matches!(scope, MemoryScope::Global) && scope_id.is_some() {
            return Err(AgentError::InvalidAction("global memory must not have a scope ID".into()));
        }
        if !matches!(scope, MemoryScope::Global) && scope_id.as_deref().is_none_or(str::is_empty) {
            return Err(AgentError::InvalidAction("non-global memory requires a scope ID".into()));
        }
        let now = now_ms();
        let id = new_id(now);
        let record = MemoryRecord {
            schema_version: MEMORY_SCHEMA_VERSION, id: id.clone(), kind, scope, scope_id,
            content: content.to_owned(), source: source.to_owned(), confidence,
            created_at_ms: now, updated_at_ms: now, expires_at_ms,
        };
        self.save(&record)?;
        Ok(record)
    }

    pub fn get(&self, id: &str) -> Result<MemoryRecord, AgentError> {
        let bytes = fs::read(self.path_for(id)?)?;
        let record: MemoryRecord = serde_json::from_slice(&bytes)?;
        if record.schema_version != MEMORY_SCHEMA_VERSION || record.id != id {
            return Err(AgentError::InvalidAction("memory record schema or ID mismatch".into()));
        }
        Ok(record)
    }

    pub fn update(&self, id: &str, content: &str, source: Option<&str>, confidence: Option<u8>) -> Result<MemoryRecord, AgentError> {
        let content = content.trim();
        if content.is_empty() || content.len() > MAX_MEMORY_TEXT || confidence.is_some_and(|v| v > 100) {
            return Err(AgentError::InvalidAction("memory update is outside configured limits".into()));
        }
        let mut record = self.get(id)?;
        record.content = content.to_owned();
        if let Some(source) = source {
            if source.len() > MAX_MEMORY_SOURCE { return Err(AgentError::InvalidAction("memory source exceeds limit".into())); }
            record.source = source.to_owned();
        }
        if let Some(confidence) = confidence { record.confidence = confidence; }
        record.updated_at_ms = now_ms();
        self.save(&record)?;
        Ok(record)
    }

    pub fn forget(&self, id: &str) -> Result<(), AgentError> {
        let path = self.path_for(id)?;
        let meta = fs::symlink_metadata(&path)?;
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(AgentError::InvalidAction("memory entry must be a regular file".into()));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<MemoryRecord>, AgentError> {
        let mut records = Vec::new();
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() || entry.path().extension().and_then(|v| v.to_str()) != Some("json") { continue; }
            let bytes = fs::read(entry.path())?;
            let record: MemoryRecord = serde_json::from_slice(&bytes)?;
            if record.schema_version != MEMORY_SCHEMA_VERSION { continue; }
            records.push(record);
        }
        records.sort_by_key(|r| r.updated_at_ms);
        Ok(records)
    }

    pub fn retrieve(&self, query: &MemoryQuery) -> Result<Vec<MemoryRecord>, AgentError> {
        let query_terms = terms(&query.query);
        if query_terms.is_empty() { return Ok(Vec::new()); }
        let now = now_ms();
        let mut ranked = Vec::new();
        for record in self.list()? {
            if record.expires_at_ms.is_some_and(|expiry| expiry <= now) { continue; }
            let in_scope = match record.scope {
                MemoryScope::Global => true,
                MemoryScope::Project => query.project_id.as_deref() == record.scope_id.as_deref(),
                MemoryScope::Session => query.session_id.as_deref() == record.scope_id.as_deref(),
                MemoryScope::Task => false,
            };
            if !in_scope { continue; }
            let record_terms = terms(&record.content);
            let overlap = query_terms.intersection(&record_terms).count();
            if overlap == 0 { continue; }
            let score = overlap.saturating_mul(100) / query_terms.len().max(1)
                + usize::from(record.confidence) / 10;
            ranked.push((score, record));
        }
        ranked.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.updated_at_ms.cmp(&a.1.updated_at_ms)));
        Ok(ranked.into_iter().take(query.limit.clamp(1, 100)).map(|(_, r)| r).collect())
    }

    fn save(&self, record: &MemoryRecord) -> Result<(), AgentError> {
        let path = self.path_for(&record.id)?;
        let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
        let bytes = serde_json::to_vec_pretty(record)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(temporary, path)?;
        Ok(())
    }
}

fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
fn new_id(now: u128) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("mem-{now:x}-{:x}", NEXT.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn workspace() -> PathBuf {
        let path = std::env::temp_dir().join(format!("rust-agent-memory-{}", now_ms()));
        fs::create_dir_all(&path).unwrap(); path
    }

    #[test]
    fn persists_retrieves_updates_and_forgets_scoped_memory() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let record = store.remember(MemoryKind::LongTerm, MemoryScope::Global, None,
            "Prefers Rust implementations and minimal dependencies", "explicit user preference", 95, None).unwrap();
        let results = store.retrieve(&MemoryQuery { query: "Rust minimal dependencies".into(), session_id: None, project_id: None, limit: 5 }).unwrap();
        assert_eq!(results[0].id, record.id);
        assert!(store.update(&record.id, "Prefers Rust with few dependencies", None, Some(90)).is_ok());
        assert!(store.forget(&record.id).is_ok());
        assert!(store.get(&record.id).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn expired_memories_are_not_retrieved() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let record = store.remember(MemoryKind::Session, MemoryScope::Session, Some("s1".into()),
            "temporary context phrase", "test", 100, Some(now_ms().saturating_sub(Duration::from_secs(1).as_millis()))).unwrap();
        let results = store.retrieve(&MemoryQuery { query: "temporary context".into(), session_id: Some("s1".into()), project_id: None, limit: 5 }).unwrap();
        assert!(results.is_empty());
        let _ = store.forget(&record.id);
        let _ = fs::remove_dir_all(root);
    }
}
