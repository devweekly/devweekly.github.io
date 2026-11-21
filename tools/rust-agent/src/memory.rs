use std::{
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex, MutexGuard},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use crate::{context::terms, error::AgentError};

const SCHEMA_VERSION: u32 = 1;
const MAX_TEXT: usize = 16_000;
const MAX_SOURCE: usize = 1_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind { Working, Session, LongTerm, Procedural }
impl MemoryKind {
    fn as_str(self) -> &'static str {
        match self { Self::Working => "working", Self::Session => "session", Self::LongTerm => "long_term", Self::Procedural => "procedural" }
    }
    fn parse(v: &str) -> rusqlite::Result<Self> {
        match v { "working" => Ok(Self::Working), "session" => Ok(Self::Session), "long_term" => Ok(Self::LongTerm), "procedural" => Ok(Self::Procedural),
            _ => Err(conversion_error(2, rusqlite::types::Type::Text, format!("invalid memory kind: {v}"))) }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope { Global, Project, Session, Task }
impl MemoryScope {
    fn as_str(self) -> &'static str {
        match self { Self::Global => "global", Self::Project => "project", Self::Session => "session", Self::Task => "task" }
    }
    fn parse(v: &str) -> rusqlite::Result<Self> {
        match v { "global" => Ok(Self::Global), "project" => Ok(Self::Project), "session" => Ok(Self::Session), "task" => Ok(Self::Task),
            _ => Err(conversion_error(3, rusqlite::types::Type::Text, format!("invalid memory scope: {v}"))) }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryRecord {
    pub schema_version: u32, pub id: String, pub kind: MemoryKind, pub scope: MemoryScope,
    pub scope_id: Option<String>, pub content: String, pub source: String, pub confidence: u8,
    pub created_at_ms: u128, pub updated_at_ms: u128, pub expires_at_ms: Option<u128>,
}
#[derive(Debug, Clone)]
pub struct MemoryInput {
    pub kind: MemoryKind, pub scope: MemoryScope, pub scope_id: Option<String>,
    pub content: String, pub source: String, pub confidence: u8, pub expires_at_ms: Option<u128>,
}
#[derive(Debug, Clone)]
pub struct MemoryQuery {
    pub query: String, pub session_id: Option<String>, pub project_id: Option<String>,
    pub task_id: Option<String>, pub limit: usize,
}
#[derive(Clone)]
pub struct MemoryStore { connection: Arc<Mutex<Connection>>, database_path: PathBuf }

impl MemoryStore {
    /// Open the workspace-local embedded SQLite database.
    pub fn new(workspace: &Path) -> Result<Self, AgentError> {
        let dir = workspace.join(".rust-agent");
        ensure_private_dir(&dir)?;
        Self::open(&dir.join("memory.sqlite3"))
    }
    /// Open a memory database at an explicit path. SQLite is bundled in the executable.
    pub fn open(path: &Path) -> Result<Self, AgentError> {
        let parent = path.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
        ensure_private_dir(parent)?;
        match std::fs::symlink_metadata(path) {
            Ok(m) if m.file_type().is_symlink() || !m.is_file() => return Err(AgentError::InvalidAction("memory database must be a regular file".into())),
            Ok(_) => (), Err(e) if e.kind() == std::io::ErrorKind::NotFound => (), Err(e) => return Err(e.into()),
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch("CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY NOT NULL, schema_version INTEGER NOT NULL,
            kind TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT,
            content TEXT NOT NULL, source TEXT NOT NULL,
            confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
            created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, expires_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);
        CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_expiry ON memories(expires_at_ms);")?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?; }
        Ok(Self { connection: Arc::new(Mutex::new(conn)), database_path: path.to_path_buf() })
    }
    pub fn database_path(&self) -> &Path { &self.database_path }
    fn conn(&self) -> Result<MutexGuard<'_, Connection>, AgentError> {
        self.connection.lock().map_err(|_| AgentError::InvalidAction("memory database lock poisoned".into()))
    }
    fn validate_id(id: &str) -> Result<(), AgentError> {
        if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(AgentError::InvalidAction("memory ID contains unsupported characters".into()));
        } Ok(())
    }
    pub fn remember(&self, input: MemoryInput) -> Result<MemoryRecord, AgentError> {
        let content = input.content.trim(); let source = input.source.trim();
        if content.is_empty() || content.len() > MAX_TEXT || source.len() > MAX_SOURCE || input.confidence > 100 {
            return Err(AgentError::InvalidAction("memory content/source/confidence is outside configured limits".into()));
        }
        if (input.scope == MemoryScope::Global && input.scope_id.is_some())
            || (input.scope != MemoryScope::Global && input.scope_id.as_deref().is_none_or(str::is_empty)) {
            return Err(AgentError::InvalidAction("memory scope ID does not match its scope".into()));
        }
        let now = now_ms();
        let record = MemoryRecord { schema_version: SCHEMA_VERSION, id: new_id(now), kind: input.kind, scope: input.scope,
            scope_id: input.scope_id, content: content.into(), source: source.into(), confidence: input.confidence,
            created_at_ms: now, updated_at_ms: now, expires_at_ms: input.expires_at_ms };
        let ts = to_i64(now)?; let expiry = record.expires_at_ms.map(to_i64).transpose()?;
        self.conn()?.execute("INSERT INTO memories VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![record.id, record.schema_version, record.kind.as_str(), record.scope.as_str(), record.scope_id,
                record.content, record.source, record.confidence, ts, ts, expiry])?;
        Ok(record)
    }
    pub fn get(&self, id: &str) -> Result<MemoryRecord, AgentError> {
        Self::validate_id(id)?;
        self.conn()?.query_row("SELECT schema_version,id,kind,scope,scope_id,content,source,confidence,created_at_ms,updated_at_ms,expires_at_ms FROM memories WHERE id=?1",
            [id], row_record).optional()?.ok_or_else(|| AgentError::InvalidAction(format!("memory record not found: {id}")))
    }
    pub fn update(&self, id: &str, content: &str, source: Option<&str>, confidence: Option<u8>) -> Result<MemoryRecord, AgentError> {
        Self::validate_id(id)?; let content = content.trim();
        if content.is_empty() || content.len() > MAX_TEXT || source.is_some_and(|s| s.len() > MAX_SOURCE) || confidence.is_some_and(|v| v > 100) {
            return Err(AgentError::InvalidAction("memory update is outside configured limits".into()));
        }
        let changed = self.conn()?.execute("UPDATE memories SET content=?2,source=COALESCE(?3,source),confidence=COALESCE(?4,confidence),updated_at_ms=?5 WHERE id=?1",
            params![id, content, source, confidence, to_i64(now_ms())?])?;
        if changed == 0 { return Err(AgentError::InvalidAction(format!("memory record not found: {id}"))); }
        self.get(id)
    }
    pub fn forget(&self, id: &str) -> Result<(), AgentError> {
        Self::validate_id(id)?;
        if self.conn()?.execute("DELETE FROM memories WHERE id=?1", [id])? == 0 {
            return Err(AgentError::InvalidAction(format!("memory record not found: {id}")));
        } Ok(())
    }
    pub fn list(&self) -> Result<Vec<MemoryRecord>, AgentError> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT schema_version,id,kind,scope,scope_id,content,source,confidence,created_at_ms,updated_at_ms,expires_at_ms FROM memories ORDER BY updated_at_ms DESC,id")?;
        Ok(stmt.query_map([], row_record)?.collect::<Result<Vec<_>, _>>()?)
    }
    pub fn retrieve(&self, query: &MemoryQuery) -> Result<Vec<MemoryRecord>, AgentError> {
        let query_terms = terms(&query.query); if query_terms.is_empty() { return Ok(Vec::new()); }
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT schema_version,id,kind,scope,scope_id,content,source,confidence,created_at_ms,updated_at_ms,expires_at_ms FROM memories WHERE expires_at_ms IS NULL OR expires_at_ms>?1")?;
        let records = stmt.query_map([to_i64(now_ms())?], row_record)?.collect::<Result<Vec<_>, _>>()?;
        let mut ranked = Vec::new();
        for record in records {
            let scoped = match record.scope {
                MemoryScope::Global => true,
                MemoryScope::Project => query.project_id.as_deref() == record.scope_id.as_deref(),
                MemoryScope::Session => query.session_id.as_deref() == record.scope_id.as_deref(),
                MemoryScope::Task => query.task_id.as_deref() == record.scope_id.as_deref(),
            };
            if !scoped { continue; }
            let overlap = query_terms.intersection(&terms(&record.content)).count();
            if overlap == 0 { continue; }
            let score = overlap.saturating_mul(100) / query_terms.len().max(1) + usize::from(record.confidence) / 10;
            ranked.push((score, record));
        }
        ranked.sort_by(|a,b| b.0.cmp(&a.0).then(b.1.updated_at_ms.cmp(&a.1.updated_at_ms)));
        Ok(ranked.into_iter().take(query.limit.clamp(1,100)).map(|(_,r)| r).collect())
    }
    pub fn delete_expired(&self) -> Result<usize, AgentError> {
        Ok(self.conn()?.execute("DELETE FROM memories WHERE expires_at_ms IS NOT NULL AND expires_at_ms<=?1", [to_i64(now_ms())?])?)
    }
    pub fn count(&self) -> Result<usize, AgentError> {
        let n: i64 = self.conn()?.query_row("SELECT COUNT(*) FROM memories", [], |r| r.get(0))?;
        usize::try_from(n).map_err(|_| AgentError::InvalidAction("memory count out of range".into()))
    }
}
fn row_record(row: &Row<'_>) -> rusqlite::Result<MemoryRecord> {
    let created: i64 = row.get(8)?; let updated: i64 = row.get(9)?; let expiry: Option<i64> = row.get(10)?;
    Ok(MemoryRecord { schema_version: row.get(0)?, id: row.get(1)?, kind: MemoryKind::parse(&row.get::<_,String>(2)?)?,
        scope: MemoryScope::parse(&row.get::<_,String>(3)?)?, scope_id: row.get(4)?, content: row.get(5)?,
        source: row.get(6)?, confidence: row.get(7)?,
        created_at_ms: u128::try_from(created).map_err(|e| conversion_error(8,rusqlite::types::Type::Integer,e.to_string()))?,
        updated_at_ms: u128::try_from(updated).map_err(|e| conversion_error(9,rusqlite::types::Type::Integer,e.to_string()))?,
        expires_at_ms: expiry.map(|v| u128::try_from(v).map_err(|e| conversion_error(10,rusqlite::types::Type::Integer,e.to_string()))).transpose()? })
}
fn conversion_error(index: usize, ty: rusqlite::types::Type, message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, ty, message.into())
}
fn to_i64(v: u128) -> Result<i64, AgentError> {
    i64::try_from(v).map_err(|_| AgentError::InvalidAction("memory timestamp exceeds SQLite integer range".into()))
}
fn ensure_private_dir(path: &Path) -> Result<(), AgentError> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err(AgentError::InvalidAction("memory storage path must be a real directory".into())),
        Ok(_) => (), Err(e) if e.kind() == std::io::ErrorKind::NotFound => std::fs::create_dir_all(path)?,
        Err(e) => return Err(e.into()),
    }
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(path,std::fs::Permissions::from_mode(0o700))?; }
    Ok(())
}
fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
fn new_id(now: u128) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("mem-{now:x}-{:x}", NEXT.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn workspace() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let p = std::env::temp_dir().join(format!("rust-agent-memory-{}-{}", now_ms(), NEXT.fetch_add(1,Ordering::Relaxed)));
        std::fs::create_dir_all(&p).unwrap(); p
    }
    fn input(scope: MemoryScope, scope_id: Option<&str>, content: &str) -> MemoryInput {
        MemoryInput { kind: MemoryKind::LongTerm, scope, scope_id: scope_id.map(str::to_owned), content: content.into(),
            source: "test".into(), confidence: 95, expires_at_ms: None }
    }
    #[test]
    fn sqlite_persists_crud_and_reopens() {
        let root=workspace(); let store=MemoryStore::new(&root).unwrap();
        let item=store.remember(input(MemoryScope::Global,None,"Prefers Rust and minimal dependencies")).unwrap();
        assert_eq!(store.retrieve(&MemoryQuery{query:"Rust minimal dependencies".into(),session_id:None,project_id:None,task_id:None,limit:5}).unwrap()[0].id,item.id);
        let updated=store.update(&item.id,"Prefers Rust with few dependencies",None,Some(90)).unwrap();
        assert_eq!(updated.confidence,90); assert_eq!(store.count().unwrap(),1);
        drop(store); let reopened=MemoryStore::new(&root).unwrap(); assert_eq!(reopened.get(&item.id).unwrap(),updated);
        reopened.forget(&item.id).unwrap(); assert_eq!(reopened.count().unwrap(),0);
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn scope_and_expiry_are_applied() {
        let root=workspace(); let store=MemoryStore::new(&root).unwrap();
        store.remember(input(MemoryScope::Task,Some("task-1"),"private task decision")).unwrap();
        let query=|task: &str| MemoryQuery{query:"private task decision".into(),session_id:None,project_id:None,task_id:Some(task.into()),limit:5};
        assert_eq!(store.retrieve(&query("task-1")).unwrap().len(),1);
        assert!(store.retrieve(&query("task-2")).unwrap().is_empty());
        let mut expired=input(MemoryScope::Session,Some("s1"),"expired session fact");
        expired.expires_at_ms=Some(now_ms().saturating_sub(1)); store.remember(expired).unwrap();
        assert_eq!(store.delete_expired().unwrap(),1);
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn cloned_store_shares_connection_safely() {
        let root=workspace(); let store=MemoryStore::new(&root).unwrap(); let clone=store.clone();
        let a=std::thread::spawn(move||store.remember(input(MemoryScope::Global,None,"first fact")).unwrap());
        let b=std::thread::spawn(move||clone.remember(input(MemoryScope::Global,None,"second fact")).unwrap());
        a.join().unwrap(); b.join().unwrap(); assert_eq!(MemoryStore::new(&root).unwrap().count().unwrap(),2);
        let _=std::fs::remove_dir_all(root);
    }
}
