use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::{
    context::terms,
    error::AgentError,
    provider::ChatMessage,
};

const SCHEMA_VERSION: u32 = 3;
const MAX_TEXT: usize = 16_000;
const MAX_SOURCE: usize = 1_000;
const MAX_EVIDENCE_REFS: usize = 32;
const MAX_PAGE_LINKS: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Working,
    Session,
    LongTerm,
    Procedural,
}

impl MemoryKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::Session => "session",
            Self::LongTerm => "long_term",
            Self::Procedural => "procedural",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "working" => Ok(Self::Working),
            "session" => Ok(Self::Session),
            "long_term" => Ok(Self::LongTerm),
            "procedural" => Ok(Self::Procedural),
            _ => Err(conversion_error(
                2,
                rusqlite::types::Type::Text,
                format!("invalid memory kind: {value}"),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    Global,
    Project,
    Session,
    Task,
}

impl MemoryScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Project => "project",
            Self::Session => "session",
            Self::Task => "task",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "global" => Ok(Self::Global),
            "project" => Ok(Self::Project),
            "session" => Ok(Self::Session),
            "task" => Ok(Self::Task),
            _ => Err(conversion_error(
                3,
                rusqlite::types::Type::Text,
                format!("invalid memory scope: {value}"),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryStatus {
    Proposed,
    Consolidated,
    Disputed,
    Stale,
}

impl MemoryStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Consolidated => "consolidated",
            Self::Disputed => "disputed",
            Self::Stale => "stale",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "proposed" => Ok(Self::Proposed),
            "consolidated" => Ok(Self::Consolidated),
            "disputed" => Ok(Self::Disputed),
            "stale" => Ok(Self::Stale),
            _ => Err(conversion_error(
                11,
                rusqlite::types::Type::Text,
                format!("invalid memory status: {value}"),
            )),
        }
    }
}

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
    pub importance: u8,
    pub status: MemoryStatus,
    pub source_refs: Vec<String>,
    pub access_count: u64,
    pub last_accessed_at_ms: Option<u128>,
    pub created_at_ms: u128,
    pub updated_at_ms: u128,
    pub expires_at_ms: Option<u128>,
}

#[derive(Debug, Clone)]
pub struct MemoryInput {
    pub kind: MemoryKind,
    pub scope: MemoryScope,
    pub scope_id: Option<String>,
    pub content: String,
    pub source: String,
    pub confidence: u8,
    pub expires_at_ms: Option<u128>,
}

#[derive(Debug, Clone)]
pub struct MemoryQuery {
    pub query: String,
    pub session_id: Option<String>,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub id: i64,
    pub session_id: String,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub role: String,
    pub content: String,
    pub created_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryPage {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub scope: MemoryScope,
    pub scope_id: Option<String>,
    pub source_refs: Vec<String>,
    pub links: Vec<String>,
    pub updated_at_ms: u128,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRevision {
    pub revision_id: i64,
    pub memory_id: String,
    pub revision: u64,
    pub action: String,
    pub before: Option<MemoryRecord>,
    pub after: Option<MemoryRecord>,
    pub reason: String,
    pub evidence_refs: Vec<String>,
    pub created_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryPageRevision {
    pub revision_id: i64,
    pub page_id: String,
    pub revision: u64,
    pub action: String,
    pub before: Option<MemoryPage>,
    pub after: Option<MemoryPage>,
    pub reason: String,
    pub evidence_refs: Vec<String>,
    pub created_at_ms: u128,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DreamingOutput {
    pub reviewed_through: i64,
    #[serde(default)]
    pub notes: Vec<DreamingNote>,
    #[serde(default)]
    pub pages: Vec<DreamingPage>,
    #[serde(default)]
    pub delete_pages: Vec<DreamingPageDeletion>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DreamingPageDeletion {
    pub id: String,
    #[serde(default)]
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DreamingRunMetrics {
    pub model: String,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DreamingNote {
    pub action: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub kind: Option<MemoryKind>,
    #[serde(default)]
    pub scope: Option<MemoryScope>,
    #[serde(default)]
    pub scope_id: Option<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default = "default_confidence")]
    pub confidence: u8,
    #[serde(default = "default_importance")]
    pub importance: u8,
    #[serde(default)]
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DreamingPage {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub scope: MemoryScope,
    #[serde(default)]
    pub scope_id: Option<String>,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub links: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DreamingReport {
    pub run_id: Option<i64>,
    pub transcripts_reviewed: usize,
    pub notes_created: usize,
    pub notes_updated: usize,
    pub notes_disputed: usize,
    pub notes_marked_stale: usize,
    pub pages_created: usize,
    pub pages_updated: usize,
    pub reviewed_through: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DreamingRunRecord {
    pub id: i64,
    pub trigger: String,
    pub status: String,
    pub cursor_from: i64,
    pub cursor_to: Option<i64>,
    pub transcript_count: usize,
    pub model: Option<String>,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
    pub started_at_ms: u128,
    pub completed_at_ms: Option<u128>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DreamingStatus {
    pub transcript_cursor: i64,
    pub pending_transcripts: usize,
    pub active_run_id: Option<i64>,
    pub lease_until_ms: Option<u128>,
    pub next_retry_at_ms: Option<u128>,
    pub consecutive_failures: u64,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct MemoryStore {
    connection: Arc<Mutex<Connection>>,
    database_path: PathBuf,
}

impl MemoryStore {
    /// Open the workspace-local embedded SQLite database.
    pub fn new(workspace: &Path) -> Result<Self, AgentError> {
        let directory = workspace.join(".rust-agent");
        ensure_private_dir(&directory)?;
        Self::open(&directory.join("memory.sqlite3"))
    }

    /// Open a memory database at an explicit path. SQLite is bundled in the executable.
    pub fn open(path: &Path) -> Result<Self, AgentError> {
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        ensure_real_dir(parent)?;
        match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(AgentError::InvalidAction(
                    "memory database must be a regular file".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY NOT NULL,
                schema_version INTEGER NOT NULL,
                kind TEXT NOT NULL,
                scope TEXT NOT NULL,
                scope_id TEXT,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                expires_at_ms INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);
            CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_memories_expiry ON memories(expires_at_ms);
            CREATE TABLE IF NOT EXISTS transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                project_id TEXT,
                task_id TEXT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id, id);
            CREATE TABLE IF NOT EXISTS memory_pages (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                scope TEXT NOT NULL,
                scope_id TEXT,
                source_refs_json TEXT NOT NULL,
                links_json TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                revision INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memory_pages_scope ON memory_pages(scope, scope_id);
            CREATE TABLE IF NOT EXISTS memory_meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS memory_revisions (
                revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
                memory_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                action TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                reason TEXT NOT NULL,
                evidence_refs_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                UNIQUE(memory_id, revision)
            );
            CREATE INDEX IF NOT EXISTS idx_memory_revisions_memory
                ON memory_revisions(memory_id, revision DESC);
            CREATE TABLE IF NOT EXISTS memory_page_revisions (
                revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                action TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                reason TEXT NOT NULL,
                evidence_refs_json TEXT NOT NULL DEFAULT '[]',
                created_at_ms INTEGER NOT NULL,
                UNIQUE(page_id, revision)
            );
            CREATE INDEX IF NOT EXISTS idx_memory_page_revisions_page
                ON memory_page_revisions(page_id, revision DESC);
            CREATE TABLE IF NOT EXISTS dreaming_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trigger TEXT NOT NULL,
                status TEXT NOT NULL,
                cursor_from INTEGER NOT NULL,
                cursor_to INTEGER,
                transcript_count INTEGER NOT NULL,
                model TEXT,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                total_tokens INTEGER,
                duration_ms INTEGER,
                started_at_ms INTEGER NOT NULL,
                completed_at_ms INTEGER,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_dreaming_runs_started
                ON dreaming_runs(started_at_ms DESC);
            CREATE TABLE IF NOT EXISTS dreaming_control (
                id INTEGER PRIMARY KEY CHECK(id=1),
                current_run_id INTEGER,
                lease_until_ms INTEGER,
                next_retry_at_ms INTEGER,
                failure_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            );
            CREATE TABLE IF NOT EXISTS background_task_leases (
                task_id TEXT PRIMARY KEY NOT NULL,
                owner_id TEXT NOT NULL,
                lease_until_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_background_task_leases_expiry
                ON background_task_leases(lease_until_ms);
            INSERT OR IGNORE INTO dreaming_control(id) VALUES (1);",
        )?;

        ensure_memory_column(&connection, "status", "TEXT NOT NULL DEFAULT 'consolidated'")?;
        ensure_memory_column(&connection, "importance", "INTEGER NOT NULL DEFAULT 70")?;
        ensure_memory_column(&connection, "source_refs_json", "TEXT NOT NULL DEFAULT '[]'")?;
        ensure_memory_column(&connection, "access_count", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_memory_column(&connection, "last_accessed_at_ms", "INTEGER")?;
        ensure_column(&connection, "transcripts", "project_id", "TEXT")?;
        ensure_column(&connection, "transcripts", "task_id", "TEXT")?;
        ensure_column(&connection, "memory_page_revisions", "evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'")?;
        connection.execute(
            "UPDATE memories SET schema_version = ?1 WHERE schema_version < ?1",
            [SCHEMA_VERSION],
        )?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            database_path: path.to_path_buf(),
        })
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    /// Atomically claim a task lease and one of the bounded active-worker slots.
    /// SQLite's IMMEDIATE transaction serializes claims across Runtime instances/processes.
    pub fn acquire_background_task_lease(
        &self,
        task_id: &str,
        owner_id: &str,
        lease_ms: u64,
        max_active: usize,
    ) -> Result<bool, AgentError> {
        if task_id.is_empty() || task_id.len() > 128 || owner_id.is_empty() || owner_id.len() > 128 {
            return Err(AgentError::InvalidAction("invalid background task lease identity".into()));
        }
        let mut connection = self.conn()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now = to_i64(now_ms())?;
        transaction.execute(
            "DELETE FROM background_task_leases WHERE lease_until_ms<=?1",
            [now],
        )?;
        let already_claimed: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM background_task_leases WHERE task_id=?1)",
            [task_id],
            |row| row.get(0),
        )?;
        if already_claimed {
            transaction.commit()?;
            return Ok(false);
        }
        let active: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM background_task_leases WHERE lease_until_ms>?1",
            [now],
            |row| row.get(0),
        )?;
        if active >= i64::try_from(max_active).unwrap_or(i64::MAX) {
            transaction.commit()?;
            return Ok(false);
        }
        let lease_duration = lease_ms.clamp(30_000, 300_000);
        let lease_until = now.saturating_add(i64::try_from(lease_duration).unwrap_or(i64::MAX));
        transaction.execute(
            "INSERT INTO background_task_leases(task_id,owner_id,lease_until_ms)
             VALUES (?1,?2,?3)",
            params![task_id, owner_id, lease_until],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn renew_background_task_lease(
        &self,
        task_id: &str,
        owner_id: &str,
        lease_ms: u64,
    ) -> Result<bool, AgentError> {
        let now = to_i64(now_ms())?;
        let lease_duration = lease_ms.clamp(30_000, 300_000);
        let lease_until = now.saturating_add(i64::try_from(lease_duration).unwrap_or(i64::MAX));
        let changed = self.conn()?.execute(
            "UPDATE background_task_leases SET lease_until_ms=?3
             WHERE task_id=?1 AND owner_id=?2 AND lease_until_ms>?4",
            params![task_id, owner_id, lease_until, now],
        )?;
        Ok(changed == 1)
    }

    pub fn has_active_background_task_lease(&self, task_id: &str) -> Result<bool, AgentError> {
        let now = to_i64(now_ms())?;
        Ok(self.conn()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM background_task_leases
             WHERE task_id=?1 AND lease_until_ms>?2)",
            params![task_id, now],
            |row| row.get(0),
        )?)
    }

    pub fn release_background_task_lease(
        &self,
        task_id: &str,
        owner_id: &str,
    ) -> Result<(), AgentError> {
        self.conn()?.execute(
            "DELETE FROM background_task_leases WHERE task_id=?1 AND owner_id=?2",
            params![task_id, owner_id],
        )?;
        Ok(())
    }

    fn conn(&self) -> Result<MutexGuard<'_, Connection>, AgentError> {
        self.connection
            .lock()
            .map_err(|_| AgentError::InvalidAction("memory database lock poisoned".into()))
    }

    fn validate_id(id: &str) -> Result<(), AgentError> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
        {
            return Err(AgentError::InvalidAction(
                "memory ID contains unsupported characters".into(),
            ));
        }
        Ok(())
    }

    pub fn remember(&self, input: MemoryInput) -> Result<MemoryRecord, AgentError> {
        self.insert_memory(
            input,
            MemoryStatus::Consolidated,
            70,
            Vec::new(),
        )
    }

    /// Save an in-session observation as a proposal. Proposed notes are never injected.
    pub fn propose(
        &self,
        input: MemoryInput,
        importance: u8,
        source_refs: Vec<String>,
    ) -> Result<MemoryRecord, AgentError> {
        self.insert_memory(input, MemoryStatus::Proposed, importance, source_refs)
    }

    fn insert_memory(
        &self,
        input: MemoryInput,
        status: MemoryStatus,
        importance: u8,
        source_refs: Vec<String>,
    ) -> Result<MemoryRecord, AgentError> {
        validate_memory_input(&input)?;
        validate_evidence_refs(&source_refs)?;
        let now = now_ms();
        let timestamp = to_i64(now)?;
        let expires = input.expires_at_ms.map(to_i64).transpose()?;
        let record = MemoryRecord {
            schema_version: SCHEMA_VERSION,
            id: new_id(now),
            kind: input.kind,
            scope: input.scope,
            scope_id: input.scope_id,
            content: input.content.trim().to_owned(),
            source: input.source.trim().to_owned(),
            confidence: input.confidence,
            importance,
            status,
            source_refs,
            access_count: 0,
            last_accessed_at_ms: None,
            created_at_ms: now,
            updated_at_ms: now,
            expires_at_ms: input.expires_at_ms,
        };
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO memories (
                id, schema_version, kind, scope, scope_id, content, source,
                confidence, created_at_ms, updated_at_ms, expires_at_ms,
                status, importance, source_refs_json, access_count, last_accessed_at_ms
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0,NULL)",
            params![
                record.id,
                record.schema_version,
                record.kind.as_str(),
                record.scope.as_str(),
                record.scope_id,
                record.content,
                record.source,
                record.confidence,
                timestamp,
                timestamp,
                expires,
                record.status.as_str(),
                record.importance,
                serde_json::to_string(&record.source_refs)?
            ],
        )?;
        insert_memory_revision(&transaction, &record.id, "created", None, Some(&record),
            if status == MemoryStatus::Proposed { "agent proposal" } else { "host memory write" },
            &record.source_refs)?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn get(&self, id: &str) -> Result<MemoryRecord, AgentError> {
        Self::validate_id(id)?;
        self.conn()?
            .query_row(
                MEMORY_SELECT_BY_ID,
                [id],
                row_memory,
            )
            .optional()?
            .ok_or_else(|| AgentError::InvalidAction(format!("memory record not found: {id}")))
    }

    pub fn update(
        &self,
        id: &str,
        content: &str,
        source: Option<&str>,
        confidence: Option<u8>,
    ) -> Result<MemoryRecord, AgentError> {
        Self::validate_id(id)?;
        let content = content.trim();
        if content.is_empty()
            || content.len() > MAX_TEXT
            || source.is_some_and(|value| value.len() > MAX_SOURCE)
            || confidence.is_some_and(|value| value > 100)
        {
            return Err(AgentError::InvalidAction(
                "memory update is outside configured limits".into(),
            ));
        }
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let before = load_memory(&transaction, id)?
            .ok_or_else(|| AgentError::InvalidAction(format!("memory record not found: {id}")))?;
        transaction.execute(
            "UPDATE memories
             SET content=?2, source=COALESCE(?3,source),
                 confidence=COALESCE(?4,confidence), updated_at_ms=?5
             WHERE id=?1",
            params![id, content, source, confidence, to_i64(now_ms())?],
        )?;
        let after = load_memory(&transaction, id)?.expect("updated memory must exist");
        insert_memory_revision(&transaction, id, "updated", Some(&before), Some(&after),
            "host memory update", &after.source_refs)?;
        transaction.commit()?;
        Ok(after)
    }

    pub fn set_status(&self, id: &str, status: MemoryStatus) -> Result<MemoryRecord, AgentError> {
        Self::validate_id(id)?;
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let before = load_memory(&transaction, id)?
            .ok_or_else(|| AgentError::InvalidAction(format!("memory record not found: {id}")))?;
        if status == MemoryStatus::Consolidated {
            validate_evidence_scope_in_transaction(
                &transaction,
                &before.source_refs,
                before.scope,
                before.scope_id.as_deref(),
            )?;
        }
        transaction.execute(
            "UPDATE memories SET status=?2, updated_at_ms=?3 WHERE id=?1",
            params![id, status.as_str(), to_i64(now_ms())?],
        )?;
        let after = load_memory(&transaction, id)?.expect("updated memory must exist");
        insert_memory_revision(&transaction, id, "status_changed", Some(&before), Some(&after),
            "host status review", &after.source_refs)?;
        transaction.commit()?;
        Ok(after)
    }

    pub fn forget(&self, id: &str) -> Result<(), AgentError> {
        self.forget_with_sources(id).map(|_| ())
    }

    /// Forget a memory and return exclusive transcript source rows so the Runtime
    /// can redact the corresponding persisted conversation messages as well.
    pub fn forget_with_sources(&self, id: &str) -> Result<Vec<TranscriptEntry>, AgentError> {
        Self::validate_id(id)?;
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        load_memory(&transaction, id)?
            .ok_or_else(|| AgentError::InvalidAction(format!("memory record not found: {id}")))?;

        let memory_rows = {
            let mut statement = transaction.prepare("SELECT id,source_refs_json FROM memories")?;
            statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?
        };
        let memory_revisions = {
            let mut statement = transaction.prepare(
                "SELECT memory_id,evidence_refs_json,before_json,after_json FROM memory_revisions"
            )?;
            statement.query_map([], |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            )))?.collect::<Result<Vec<_>, _>>()?
        };

        let snapshot_mentions_memory = |snapshot: &Option<String>, ids: &HashSet<String>| -> Result<bool, AgentError> {
            let Some(snapshot) = snapshot else { return Ok(false); };
            let value: Value = serde_json::from_str(snapshot)?;
            Ok(value.get("source_refs").and_then(Value::as_array).is_some_and(|refs| {
                refs.iter().filter_map(Value::as_str).any(|reference| {
                    reference.strip_prefix("memory:").is_some_and(|id| ids.contains(id))
                })
            }))
        };

        let mut deleted_memories = HashSet::from([id.to_owned()]);
        loop {
            let mut changed = false;
            for (memory_id, refs_json) in &memory_rows {
                if deleted_memories.contains(memory_id) { continue; }
                let refs: Vec<String> = serde_json::from_str(refs_json)?;
                if refs.iter().any(|reference| reference.strip_prefix("memory:")
                    .is_some_and(|source_id| deleted_memories.contains(source_id)))
                {
                    changed |= deleted_memories.insert(memory_id.clone());
                }
            }
            for (memory_id, evidence_json, before, after) in &memory_revisions {
                if deleted_memories.contains(memory_id) { continue; }
                let evidence: Vec<String> = serde_json::from_str(evidence_json)?;
                let references_deleted_memory = evidence.iter().any(|reference| {
                    reference.strip_prefix("memory:").is_some_and(|source_id| deleted_memories.contains(source_id))
                }) || snapshot_mentions_memory(before, &deleted_memories)?
                    || snapshot_mentions_memory(after, &deleted_memories)?;
                if references_deleted_memory {
                    changed |= deleted_memories.insert(memory_id.clone());
                }
            }
            if !changed { break; }
        }

        let page_rows = {
            let mut statement = transaction.prepare(
                "SELECT id,source_refs_json,links_json,content FROM memory_pages"
            )?;
            statement.query_map([], |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            )))?.collect::<Result<Vec<_>, _>>()?
        };
        let page_revisions = {
            let mut statement = transaction.prepare(
                "SELECT page_id,evidence_refs_json,before_json,after_json FROM memory_page_revisions"
            )?;
            statement.query_map([], |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            )))?.collect::<Result<Vec<_>, _>>()?
        };

        let snapshot_links_to_deleted_page = |snapshot: &Option<String>, ids: &HashSet<String>| -> Result<bool, AgentError> {
            let Some(snapshot) = snapshot else { return Ok(false); };
            let value: Value = serde_json::from_str(snapshot)?;
            let mut links = value.get("links").and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::to_owned).collect::<Vec<_>>())
                .unwrap_or_default();
            if let Some(content) = value.get("content").and_then(Value::as_str) {
                links.extend(markdown_page_links(content));
            }
            Ok(links.iter().any(|link| ids.contains(link)))
        };

        let mut deleted_pages = HashSet::new();
        let mut redact_index = false;
        for (page_id, refs_json, _, _) in &page_rows {
            let refs: Vec<String> = serde_json::from_str(refs_json)?;
            let dependent = refs.iter().any(|reference| reference.strip_prefix("memory:")
                .is_some_and(|source_id| deleted_memories.contains(source_id)));
            if dependent {
                if page_id == "index" { redact_index = true; }
                else { deleted_pages.insert(page_id.clone()); }
            }
        }
        for (page_id, evidence_json, before, after) in &page_revisions {
            let evidence: Vec<String> = serde_json::from_str(evidence_json)?;
            let dependent = evidence.iter().any(|reference| reference.strip_prefix("memory:")
                .is_some_and(|source_id| deleted_memories.contains(source_id)))
                || snapshot_mentions_memory(before, &deleted_memories)?
                || snapshot_mentions_memory(after, &deleted_memories)?;
            if dependent {
                if page_id == "index" { redact_index = true; }
                else { deleted_pages.insert(page_id.clone()); }
            }
        }

        // Cascading page deletion preserves wiki link integrity. The protected index
        // is redacted and rebuilt rather than removed.
        loop {
            let mut changed = false;
            for (page_id, _, links_json, content) in &page_rows {
                if page_id == "index" || deleted_pages.contains(page_id) { continue; }
                let links: Vec<String> = serde_json::from_str(links_json)?;
                let points_to_deleted = links.iter().any(|link| deleted_pages.contains(link))
                    || markdown_page_links(content).iter().any(|link| deleted_pages.contains(link));
                let mut historical_link = false;
                for (revision_page_id, _, before, after) in &page_revisions {
                    if revision_page_id != page_id { continue; }
                    if snapshot_links_to_deleted_page(before, &deleted_pages)?
                        || snapshot_links_to_deleted_page(after, &deleted_pages)?
                    {
                        historical_link = true;
                        break;
                    }
                }
                if points_to_deleted || historical_link {
                    if page_id == "index" { redact_index = true; }
                    else { changed |= deleted_pages.insert(page_id.clone()); }
                }
            }
            if !changed { break; }
        }
        if page_rows.iter().any(|(page_id, _, links_json, content)| {
            page_id == "index" && (
                serde_json::from_str::<Vec<String>>(links_json).unwrap_or_default().iter().any(|link| deleted_pages.contains(link))
                || markdown_page_links(content).iter().any(|link| deleted_pages.contains(link))
            )
        }) {
            redact_index = true;
        }

        let mut transcript_refs = HashSet::new();

        for (memory_id, refs_json) in &memory_rows {
            if deleted_memories.contains(memory_id) { collect_transcript_refs_from_json(refs_json, &mut transcript_refs)?; }
        }
        for (memory_id, evidence_json, before, after) in &memory_revisions {
            if deleted_memories.contains(memory_id) {
                collect_transcript_refs_from_json(evidence_json, &mut transcript_refs)?;
                collect_transcript_refs_from_snapshot(before, &mut transcript_refs)?;
                collect_transcript_refs_from_snapshot(after, &mut transcript_refs)?;
            }
        }
        for (page_id, refs_json, _, _) in &page_rows {
            if deleted_pages.contains(page_id) || (redact_index && page_id == "index") {
                collect_transcript_refs_from_json(refs_json, &mut transcript_refs)?;
            }
        }
        for (page_id, evidence_json, before, after) in &page_revisions {
            if deleted_pages.contains(page_id) || (redact_index && page_id == "index") {
                collect_transcript_refs_from_json(evidence_json, &mut transcript_refs)?;
                collect_transcript_refs_from_snapshot(before, &mut transcript_refs)?;
                collect_transcript_refs_from_snapshot(after, &mut transcript_refs)?;
            }
        }

        for memory_id in &deleted_memories {
            transaction.execute("DELETE FROM memory_revisions WHERE memory_id=?1", [memory_id])?;
            transaction.execute("DELETE FROM memories WHERE id=?1", [memory_id])?;
        }
        for page_id in &deleted_pages {
            transaction.execute("DELETE FROM memory_page_revisions WHERE page_id=?1", [page_id])?;
            transaction.execute("DELETE FROM memory_pages WHERE id=?1", [page_id])?;
        }
        if redact_index {
            if let Some(mut index) = load_page(&transaction, "index")? {
                transaction.execute("DELETE FROM memory_page_revisions WHERE page_id='index'", [])?;
                index.title = "Knowledge Index".into();
                index.summary = "Index of retained knowledge pages".into();
                index.content = "The knowledge index will be rebuilt from retained pages.".into();
                index.source_refs.clear();
                index.links.clear();
                index.updated_at_ms = now_ms();
                index.revision = 1;
                write_page_record(&transaction, &index)?;
                insert_page_revision(
                    &transaction, "index", "redacted", None, Some(&index),
                    "redacted after forgetting a source memory", &[],
                )?;
            }
        }

        let mut removed_sources = Vec::new();
        for reference in transcript_refs {
            let transcript_id = reference.strip_prefix("transcript:")
                .and_then(|value| value.parse::<i64>().ok())
                .ok_or_else(|| AgentError::InvalidAction(format!("invalid transcript evidence reference: {reference}")))?;
            if transcript_is_referenced_in_transaction(&transaction, &reference)? { continue; }
            let source = transaction.query_row(
                "SELECT id,session_id,project_id,task_id,role,content,created_at_ms
                 FROM transcripts WHERE id=?1",
                [transcript_id],
                row_transcript,
            ).optional()?;
            if let Some(source) = source {
                transaction.execute("DELETE FROM transcripts WHERE id=?1", [transcript_id])?;
                removed_sources.push(source);
            }
        }
        transaction.commit()?;
        Ok(removed_sources)
    }

    /// Remove old transcript rows that are no longer referenced by any live or
    /// revisioned memory/page. The newest 1,000 transcript rows are always retained.
    /// This is explicit maintenance; Runtime startup never deletes user history.
    pub fn prune_transcripts(&self, older_than_ms: u128, max_delete: usize) -> Result<usize, AgentError> {
        if max_delete == 0 { return Ok(0); }
        let cutoff = to_i64(older_than_ms)?;
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let oldest_retained: Option<i64> = transaction.query_row(
            "SELECT id FROM transcripts ORDER BY id DESC LIMIT 1 OFFSET 999",
            [],
            |row| row.get(0),
        ).optional()?;
        let Some(oldest_retained) = oldest_retained else {
            transaction.commit()?;
            return Ok(0);
        };
        let candidates = {
            let mut statement = transaction.prepare(
                "SELECT id FROM transcripts
                 WHERE created_at_ms<?1 AND id<?2
                 ORDER BY id ASC LIMIT ?3"
            )?;
            statement.query_map(
                params![cutoff, oldest_retained, i64::try_from(max_delete.saturating_mul(20)).unwrap_or(i64::MAX)],
                |row| row.get::<_, i64>(0),
            )?.collect::<Result<Vec<_>, _>>()?
        };
        let mut deleted = 0usize;
        for id in candidates {
            if deleted >= max_delete { break; }
            let reference = format!("transcript:{id}");
            if !transcript_is_referenced_in_transaction(&transaction, &reference)? {
                transaction.execute("DELETE FROM transcripts WHERE id=?1", [id])?;
                deleted += 1;
            }
        }
        transaction.commit()?;
        Ok(deleted)
    }

    pub fn list(&self) -> Result<Vec<MemoryRecord>, AgentError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare(&format!("{MEMORY_SELECT} ORDER BY updated_at_ms DESC,id"))?;
        Ok(statement.query_map([], row_memory)?.collect::<Result<Vec<_>, _>>()?)
    }

    /// Retrieve only consolidated notes visible in the supplied scope.
    /// Access statistics are updated for the selected notes.
    pub fn retrieve(&self, query: &MemoryQuery) -> Result<Vec<MemoryRecord>, AgentError> {
        let query_terms = terms(&query.query);
        if query_terms.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.conn()?;
        let mut statement = connection.prepare(&format!(
            "{MEMORY_SELECT}
             WHERE status='consolidated'
               AND (expires_at_ms IS NULL OR expires_at_ms>?1)"
        ))?;
        let records = statement
            .query_map([to_i64(now_ms())?], row_memory)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        let mut ranked = Vec::new();
        for record in records {
            if !scope_matches(record.scope, record.scope_id.as_deref(), query)
                || validate_evidence_scope_recursive(
                    &connection,
                    &record.source_refs,
                    record.scope,
                    record.scope_id.as_deref(),
                    &mut HashSet::new(),
                ).is_err()
            {
                // A once-consolidated note is no longer retrievable when its evidence
                // chain has since expired, been disputed, or been removed.
                continue;
            }
            let record_terms = terms(&record.content);
            let overlap = query_terms.intersection(&record_terms).count();
            if overlap == 0 {
                continue;
            }
            let lexical = overlap.saturating_mul(100) / query_terms.len().max(1);
            let recency = if record.updated_at_ms > 0
                && now_ms().saturating_sub(record.updated_at_ms) < 30 * 24 * 60 * 60 * 1000
            {
                5
            } else {
                0
            };
            let score = lexical
                + usize::from(record.confidence) / 10
                + usize::from(record.importance) / 20
                + recency;
            ranked.push((score, record));
        }
        ranked.sort_by(|left, right| {
            right.0.cmp(&left.0)
                .then(right.1.access_count.cmp(&left.1.access_count))
                .then(right.1.updated_at_ms.cmp(&left.1.updated_at_ms))
        });
        let selected = ranked
            .into_iter()
            .take(query.limit.clamp(1, 100))
            .map(|(_, record)| record)
            .collect::<Vec<_>>();
        if !selected.is_empty() {
            let now = to_i64(now_ms())?;
            let mut connection = self.conn()?;
            let transaction = connection.transaction()?;
            for record in &selected {
                transaction.execute(
                    "UPDATE memories SET access_count=access_count+1,last_accessed_at_ms=?2 WHERE id=?1",
                    params![record.id, now],
                )?;
            }
            transaction.commit()?;
        }
        Ok(selected)
    }

    pub fn list_page_revisions(&self, page_id: &str, limit: usize) -> Result<Vec<MemoryPageRevision>, AgentError> {
        validate_page_id(page_id)?;
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            "SELECT revision_id,page_id,revision,action,before_json,after_json,reason,evidence_refs_json,created_at_ms
             FROM memory_page_revisions WHERE page_id=?1 ORDER BY revision DESC LIMIT ?2"
        )?;
        Ok(statement.query_map(params![page_id, limit.clamp(1, 200)], row_memory_page_revision)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn restore_page_revision(&self, page_id: &str, revision: u64) -> Result<MemoryPage, AgentError> {
        validate_page_id(page_id)?;
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let (before_json, after_json): (Option<String>, Option<String>) = transaction.query_row(
            "SELECT before_json,after_json FROM memory_page_revisions WHERE page_id=?1 AND revision=?2",
            params![page_id, revision],
            |row| Ok((row.get(0)?,row.get(1)?)),
        ).optional()?.ok_or_else(|| AgentError::InvalidAction("knowledge page revision not found".into()))?;
        let snapshot = after_json.or(before_json)
            .ok_or_else(|| AgentError::InvalidAction("knowledge page revision has no restorable snapshot".into()))?;
        let mut restored: MemoryPage = serde_json::from_str(&snapshot)?;
        let previous = load_page(&transaction, page_id)?;
        restored.revision = next_page_revision(&transaction, page_id)?;
        restored.updated_at_ms = now_ms();
        write_page_record(&transaction, &restored)?;
        let current = load_page(&transaction, page_id)?.expect("restored page must exist");
        insert_page_revision(&transaction, page_id, "restored", previous.as_ref(), Some(&current),
            &format!("restored revision {revision}"), &current.source_refs)?;
        transaction.commit()?;
        Ok(current)
    }

    pub fn list_revisions(&self, memory_id: &str, limit: usize) -> Result<Vec<MemoryRevision>, AgentError> {
        Self::validate_id(memory_id)?;
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            "SELECT revision_id,memory_id,revision,action,before_json,after_json,reason,evidence_refs_json,created_at_ms
             FROM memory_revisions WHERE memory_id=?1 ORDER BY revision DESC LIMIT ?2"
        )?;
        Ok(statement.query_map(params![memory_id, limit.clamp(1, 200)], row_memory_revision)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn restore_revision(&self, memory_id: &str, revision: u64) -> Result<MemoryRecord, AgentError> {
        Self::validate_id(memory_id)?;
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let (before_json, after_json): (Option<String>, Option<String>) = transaction.query_row(
            "SELECT before_json,after_json FROM memory_revisions WHERE memory_id=?1 AND revision=?2",
            params![memory_id, revision],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?.ok_or_else(|| AgentError::InvalidAction("memory revision not found".into()))?;
        let snapshot = after_json.or(before_json)
            .ok_or_else(|| AgentError::InvalidAction("memory revision has no restorable snapshot".into()))?;
        let restored: MemoryRecord = serde_json::from_str(&snapshot)?;
        let previous = load_memory(&transaction, memory_id)?;
        write_memory_record(&transaction, &restored)?;
        let current = load_memory(&transaction, memory_id)?.expect("restored memory must exist");
        insert_memory_revision(&transaction, memory_id, "restored", previous.as_ref(), Some(&current),
            &format!("restored revision {revision}"), &current.source_refs)?;
        transaction.commit()?;
        Ok(current)
    }

    pub fn count(&self) -> Result<usize, AgentError> {
        let count: i64 = self.conn()?.query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))?;
        usize::try_from(count)
            .map_err(|_| AgentError::InvalidAction("memory count out of range".into()))
    }

    pub fn delete_expired(&self) -> Result<usize, AgentError> {
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let now = to_i64(now_ms())?;
        let ids = {
            let mut statement = transaction.prepare(
                "SELECT id FROM memories WHERE expires_at_ms IS NOT NULL AND expires_at_ms<=?1"
            )?;
            statement.query_map([now], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        for id in &ids {
            transaction.execute("DELETE FROM memory_revisions WHERE memory_id=?1", [id])?;
            transaction.execute("DELETE FROM memories WHERE id=?1", [id])?;
        }
        transaction.commit()?;
        Ok(ids.len())
    }

    /// Append a durable transcript event. Session JSON remains the conversation snapshot.
    pub fn record_transcript(
        &self,
        session_id: &str,
        project_id: Option<&str>,
        task_id: Option<&str>,
        role: &str,
        content: &str,
    ) -> Result<i64, AgentError> {
        if session_id.is_empty() || session_id.len() > 128 || role.is_empty() || role.len() > 32 {
            return Err(AgentError::InvalidAction("invalid transcript session or role".into()));
        }
        if content.is_empty() {
            return Ok(0);
        }
        let content = content.chars().take(12_000).collect::<String>();
        let connection = self.conn()?;
        connection.execute(
            "INSERT INTO transcripts(session_id,project_id,task_id,role,content,created_at_ms)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![session_id, project_id, task_id, role, content, to_i64(now_ms())?],
        )?;
        Ok(connection.last_insert_rowid())
    }

    /// Index an existing session snapshot once when upgrading an older workspace.
    pub fn backfill_transcript(
        &self,
        session_id: &str,
        project_id: Option<&str>,
        messages: &[ChatMessage],
    ) -> Result<usize, AgentError> {
        let existing: i64 = self.conn()?.query_row(
            "SELECT COUNT(*) FROM transcripts WHERE session_id=?1",
            [session_id],
            |row| row.get(0),
        )?;
        if existing > 0 {
            return Ok(0);
        }
        let mut inserted = 0;
        for message in messages.iter().filter(|message| message.role != "system") {
            if !message.content.is_empty() {
                // Chat Completions represents tool results as user messages. Recover the
                // original source classification instead of backfilling them as user input.
                let role = if message.content.starts_with("Tool result (ok=") {
                    "tool"
                } else if message.content.starts_with("Background task result [") {
                    "assistant"
                } else {
                    message.role.as_str()
                };
                self.record_transcript(session_id, project_id, None, role, &message.content)?;
                inserted += 1;
            }
        }
        Ok(inserted)
    }

    pub fn latest_transcript_id(&self, session_id: &str) -> Result<Option<i64>, AgentError> {
        Ok(self.conn()?.query_row(
            "SELECT MAX(id) FROM transcripts WHERE session_id=?1",
            [session_id],
            |row| row.get(0),
        )?)
    }

    /// Capture evidence produced by the current user turn, excluding assistant-generated claims.
    pub fn latest_turn_evidence_refs(
        &self,
        session_id: &str,
        project_id: Option<&str>,
        task_id: Option<&str>,
        include_tool_results: bool,
    ) -> Result<Vec<String>, AgentError> {
        let connection = self.conn()?;
        let latest_user_id: Option<i64> = connection.query_row(
            "SELECT MAX(id) FROM transcripts
             WHERE session_id=?1
               AND ((?2 IS NULL AND project_id IS NULL) OR project_id=?2)
               AND ((?3 IS NULL AND task_id IS NULL) OR task_id=?3)
               AND role='user'",
            params![session_id,project_id,task_id],
            |row| row.get(0),
        )?;
        let Some(latest_user_id) = latest_user_id else {
            return Ok(Vec::new());
        };
        let mut statement = connection.prepare(
            "SELECT id FROM transcripts
             WHERE id>=?1 AND session_id=?2
               AND ((?3 IS NULL AND project_id IS NULL) OR project_id=?3)
               AND ((?4 IS NULL AND task_id IS NULL) OR task_id=?4)
               AND (role='user' OR (?5=1 AND role='tool'))
             ORDER BY id DESC LIMIT 16"
        )?;
        let mut ids = statement.query_map(
            params![latest_user_id,session_id,project_id,task_id,include_tool_results],
            |row| row.get::<_, i64>(0),
        )?.collect::<Result<Vec<_>, _>>()?;
        ids.reverse();
        Ok(ids.into_iter().map(|id| format!("transcript:{id}")).collect())
    }

    pub fn transcripts_after(&self, cursor: i64, limit: usize) -> Result<Vec<TranscriptEntry>, AgentError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            "SELECT id,session_id,project_id,task_id,role,content,created_at_ms
             FROM transcripts WHERE id>?1 ORDER BY id LIMIT ?2",
        )?;
        Ok(statement.query_map(
            params![cursor.max(0), limit.clamp(1, 200)],
            row_transcript,
        )?.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn search_transcripts(
        &self,
        query: &str,
        session_id: Option<&str>,
        project_id: Option<&str>,
        task_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<TranscriptEntry>, AgentError> {
        let query_terms = terms(query);
        if query_terms.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            "SELECT id,session_id,project_id,task_id,role,content,created_at_ms FROM transcripts
             WHERE (
                    (session_id=?1 AND ((?2 IS NULL AND project_id IS NULL) OR project_id=?2))
                    OR (?2 IS NOT NULL AND project_id=?2)
               )
               AND ((?3 IS NULL AND task_id IS NULL) OR task_id=?3)
             ORDER BY id DESC LIMIT 1000",
        )?;
        let records = statement.query_map(params![session_id, project_id, task_id], row_transcript)?
            .collect::<Result<Vec<_>, _>>()?;
        let mut ranked = records.into_iter().filter_map(|entry| {
            let content_terms = terms(&entry.content);
            let overlap = query_terms.intersection(&content_terms).count();
            (overlap > 0).then_some((overlap, entry))
        }).collect::<Vec<_>>();
        ranked.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.id.cmp(&left.1.id)));
        Ok(ranked.into_iter().take(limit.clamp(1, 100)).map(|(_, entry)| entry).collect())
    }

    pub fn get_transcript(&self, id: i64) -> Result<TranscriptEntry, AgentError> {
        self.conn()?.query_row(
            "SELECT id,session_id,project_id,task_id,role,content,created_at_ms FROM transcripts WHERE id=?1",
            [id],
            row_transcript,
        ).optional()?.ok_or_else(|| AgentError::InvalidAction(format!("transcript entry not found: {id}")))
    }

    pub fn get_transcript_scoped(
        &self,
        id: i64,
        session_id: &str,
        project_id: Option<&str>,
        task_id: Option<&str>,
    ) -> Result<TranscriptEntry, AgentError> {
        let entry = self.get_transcript(id)?;
        let task_matches = (task_id.is_none() && entry.task_id.is_none())
            || entry.task_id.as_deref() == task_id;
        let project_matches = match project_id {
            Some(project_id) => entry.project_id.as_deref() == Some(project_id),
            None => entry.project_id.is_none(),
        };
        let visible = task_matches
            && project_matches
            && (entry.session_id == session_id
                || (project_id.is_some() && entry.project_id.as_deref() == project_id));
        if !visible {
            return Err(AgentError::InvalidAction("transcript entry is outside the current scope".into()));
        }
        Ok(entry)
    }

    pub fn last_dreamed_transcript_id(&self) -> Result<i64, AgentError> {
        let value: Option<String> = self.conn()?.query_row(
            "SELECT value FROM memory_meta WHERE key='last_dreamed_transcript_id'",
            [],
            |row| row.get(0),
        ).optional()?;
        Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
    }

    pub fn get_page(&self, id: &str) -> Result<MemoryPage, AgentError> {
        validate_page_id(id)?;
        let connection = self.conn()?;
        let page = connection.query_row(
            "SELECT id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
             FROM memory_pages WHERE id=?1",
            [id],
            row_page,
        ).optional()?.ok_or_else(|| AgentError::InvalidAction(format!("memory page not found: {id}")))?;
        validate_evidence_scope_recursive(
            &connection, &page.source_refs, page.scope, page.scope_id.as_deref(), &mut HashSet::new()
        )?;
        Ok(page)
    }

    pub fn list_pages(&self, limit: usize) -> Result<Vec<MemoryPage>, AgentError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            "SELECT id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
             FROM memory_pages ORDER BY updated_at_ms DESC,id LIMIT ?1",
        )?;
        let pages = statement.query_map([limit.clamp(1, 200)], row_page)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        Ok(pages.into_iter().filter(|page| {
            validate_evidence_scope_recursive(
                &connection, &page.source_refs, page.scope, page.scope_id.as_deref(), &mut HashSet::new()
            ).is_ok()
        }).collect())
    }

    pub fn search_pages(&self, query: &str, limit: usize) -> Result<Vec<MemoryPage>, AgentError> {
        let query_terms = terms(query);
        if query_terms.is_empty() {
            return Ok(Vec::new());
        }
        let pages = self.list_pages(200)?;
        let mut ranked = pages.into_iter().filter_map(|page| {
            let searchable = format!("{} {} {}", page.title, page.summary, page.content);
            let page_terms = terms(&searchable);
            let overlap = query_terms.intersection(&page_terms).count();
            (overlap > 0).then_some((overlap, page))
        }).collect::<Vec<_>>();
        ranked.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.updated_at_ms.cmp(&left.1.updated_at_ms)));
        Ok(ranked.into_iter().take(limit.clamp(1, 50)).map(|(_, page)| page).collect())
    }

    pub fn start_dreaming_run(
        &self,
        minimum_transcripts: usize,
        lease_ms: u64,
        trigger: &str,
    ) -> Result<Option<(i64, i64)>, AgentError> {
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let cursor = last_dreamed_cursor(&transaction)?;
        let max_id: i64 = transaction.query_row("SELECT COALESCE(MAX(id),0) FROM transcripts", [], |row| row.get(0))?;
        let pending: i64 = transaction.query_row("SELECT COUNT(*) FROM transcripts WHERE id>?1", [cursor], |row| row.get(0))?;
        if pending < i64::try_from(minimum_transcripts).unwrap_or(i64::MAX) {
            return Ok(None);
        }
        let (current_run, lease_until, next_retry): (Option<i64>, Option<i64>, Option<i64>) =
            transaction.query_row(
                "SELECT current_run_id,lease_until_ms,next_retry_at_ms FROM dreaming_control WHERE id=1",
                [],
                |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
            )?;
        let now = to_i64(now_ms())?;
        if lease_until.is_some_and(|until| until > now)
            || next_retry.is_some_and(|next| next > now)
        {
            return Ok(None);
        }
        if let Some(previous_run) = current_run {
            transaction.execute(
                "UPDATE dreaming_runs SET status='abandoned',completed_at_ms=?2,
                    error='Dreaming worker lease expired before completion' WHERE id=?1 AND status='running'",
                params![previous_run,now],
            )?;
        }
        let transcript_count = pending.min(200);
        transaction.execute(
            "INSERT INTO dreaming_runs(trigger,status,cursor_from,cursor_to,transcript_count,started_at_ms)
             VALUES (?1,'running',?2,?3,?4,?5)",
            params![trigger,cursor,max_id,transcript_count,now],
        )?;
        let run_id = transaction.last_insert_rowid();
        transaction.execute(
            "UPDATE dreaming_control SET current_run_id=?1,lease_until_ms=?2 WHERE id=1",
            params![run_id, now.saturating_add(i64::try_from(lease_ms).unwrap_or(i64::MAX))],
        )?;
        transaction.commit()?;
        Ok(Some((run_id,cursor)))
    }

    pub fn fail_dreaming_run(&self, run_id: i64, error: &str, retry_after_ms: u64) -> Result<(), AgentError> {
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let now = to_i64(now_ms())?;
        transaction.execute(
            "UPDATE dreaming_runs SET status='failed',completed_at_ms=?2,error=?3 WHERE id=?1 AND status='running'",
            params![run_id,now,error.chars().take(2_000).collect::<String>()],
        )?;
        transaction.execute(
            "UPDATE dreaming_control SET current_run_id=NULL,lease_until_ms=NULL,
                next_retry_at_ms=?1,failure_count=failure_count+1,last_error=?2 WHERE id=1 AND current_run_id=?3",
            params![now.saturating_add(i64::try_from(retry_after_ms).unwrap_or(i64::MAX)),
                error.chars().take(2_000).collect::<String>(),run_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn abort_dreaming_run(&self, run_id: i64, reason: &str) -> Result<(), AgentError> {
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let now = to_i64(now_ms())?;
        transaction.execute(
            "UPDATE dreaming_runs SET status='interrupted',completed_at_ms=?2,error=?3
             WHERE id=?1 AND status='running'",
            params![run_id,now,reason.chars().take(2_000).collect::<String>()],
        )?;
        transaction.execute(
            "UPDATE dreaming_control SET current_run_id=NULL,lease_until_ms=NULL,
                next_retry_at_ms=NULL,last_error=NULL WHERE id=1 AND current_run_id=?1",
            [run_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn pending_transcript_count(&self) -> Result<usize, AgentError> {
        Ok(self.dreaming_status()?.pending_transcripts)
    }

    pub fn dreaming_status(&self) -> Result<DreamingStatus, AgentError> {
        let connection = self.conn()?;
        let cursor = last_dreamed_cursor(&connection)?;
        let pending: i64 = connection.query_row(
            "SELECT COUNT(*) FROM transcripts WHERE id>?1", [cursor], |row| row.get(0)
        )?;
        let (active_run_id, lease_until, next_retry, failures, last_error):
            (Option<i64>,Option<i64>,Option<i64>,i64,Option<String>) = connection.query_row(
                "SELECT current_run_id,lease_until_ms,next_retry_at_ms,failure_count,last_error
                 FROM dreaming_control WHERE id=1",
                [],
                |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
            )?;
        Ok(DreamingStatus {
            transcript_cursor: cursor,
            pending_transcripts: usize::try_from(pending)
                .map_err(|_| AgentError::InvalidAction("transcript count out of range".into()))?,
            active_run_id,
            lease_until_ms: lease_until.map(|value| from_i64(value, 1)).transpose()?,
            next_retry_at_ms: next_retry.map(|value| from_i64(value, 2)).transpose()?,
            consecutive_failures: u64::try_from(failures)
                .map_err(|_| AgentError::InvalidAction("Dreaming failure count out of range".into()))?,
            last_error,
        })
    }

    pub fn list_dreaming_runs(&self, limit: usize) -> Result<Vec<DreamingRunRecord>, AgentError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            "SELECT id,trigger,status,cursor_from,cursor_to,transcript_count,model,prompt_tokens,
                    completion_tokens,total_tokens,duration_ms,started_at_ms,completed_at_ms,error
             FROM dreaming_runs ORDER BY id DESC LIMIT ?1"
        )?;
        Ok(statement.query_map([i64::try_from(limit.clamp(1, 100)).unwrap_or(100)], row_dreaming_run)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Apply an offline consolidation pass as one SQLite transaction.
    /// Every new or changed note/page must cite a transcript or an existing memory.
    pub fn apply_dreaming(&self, output: DreamingOutput) -> Result<DreamingReport, AgentError> {
        self.apply_dreaming_inner(output, None)
    }

    pub fn apply_dreaming_run(
        &self,
        run_id: i64,
        output: DreamingOutput,
        metrics: DreamingRunMetrics,
    ) -> Result<DreamingReport, AgentError> {
        self.apply_dreaming_inner(output, Some((run_id, metrics)))
    }

    fn apply_dreaming_inner(
        &self,
        output: DreamingOutput,
        run: Option<(i64, DreamingRunMetrics)>,
    ) -> Result<DreamingReport, AgentError> {
        if output.notes.len() > 32 || output.pages.len() > 16 || output.delete_pages.len() > 16 {
            return Err(AgentError::InvalidAction("dreaming output exceeds operation limits".into()));
        }
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let previous_cursor = last_dreamed_cursor(&transaction)?;
        if let Some((run_id, _)) = run.as_ref() {
            let active_run: Option<i64> = transaction.query_row(
                "SELECT current_run_id FROM dreaming_control WHERE id=1",
                [],
                |row| row.get(0),
            )?;
            if active_run != Some(*run_id) {
                return Err(AgentError::InvalidAction(
                    "Dreaming lease was lost before the consolidation result could be committed".into(),
                ));
            }
        }
        let max_transcript: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(id),0) FROM transcripts",
            [],
            |row| row.get(0),
        )?;
        if output.reviewed_through < previous_cursor || output.reviewed_through > max_transcript {
            return Err(AgentError::InvalidAction("dreaming transcript cursor is outside the available range".into()));
        }

        let mut report = DreamingReport {
            run_id: run.as_ref().map(|value| value.0),
            reviewed_through: output.reviewed_through,
            ..DreamingReport::default()
        };
        for note in output.notes {
            match note.action.as_str() {
                "create" | "update" => {
                    let kind = note.kind.ok_or_else(|| AgentError::InvalidAction("dreaming note is missing kind".into()))?;
                    let scope = note.scope.ok_or_else(|| AgentError::InvalidAction("dreaming note is missing scope".into()))?;
                    validate_scope(scope, note.scope_id.as_deref())?;
                    validate_note_content(&note.content)?;
                    if note.confidence > 100 || note.importance > 100 {
                        return Err(AgentError::InvalidAction("dreaming confidence or importance exceeds 100".into()));
                    }
                    validate_evidence_scope_in_transaction(
                        &transaction, &note.evidence, scope, note.scope_id.as_deref()
                    )?;
                    if note.evidence.is_empty() {
                        return Err(AgentError::InvalidAction("dreaming notes require source evidence".into()));
                    }
                    let now = to_i64(now_ms())?;
                    let refs = serde_json::to_string(&note.evidence)?;
                    let status = if note.confidence >= 70 { MemoryStatus::Consolidated } else { MemoryStatus::Proposed };
                    if note.action == "create" {
                        let duplicate_id: Option<String> = transaction.query_row(
                            "SELECT id FROM memories WHERE lower(content)=lower(?1)
                             AND scope=?2 AND COALESCE(scope_id,'')=COALESCE(?3,'')
                             ORDER BY updated_at_ms DESC LIMIT 1",
                            params![note.content.trim(),scope.as_str(),note.scope_id],
                            |row| row.get(0),
                        ).optional()?;
                        if let Some(id) = duplicate_id {
                            let before = load_memory(&transaction, &id)?.expect("duplicate memory must exist");
                            let mut merged_refs = before.source_refs.clone();
                            for reference in &note.evidence {
                                if !merged_refs.contains(reference) {
                                    merged_refs.push(reference.clone());
                                }
                            }
                            if merged_refs.len() > MAX_EVIDENCE_REFS {
                                merged_refs.drain(0..merged_refs.len() - MAX_EVIDENCE_REFS);
                            }
                            let merged_json = serde_json::to_string(&merged_refs)?;
                            transaction.execute(
                                "UPDATE memories SET confidence=MAX(confidence,?2),
                                    importance=MAX(importance,?3),source_refs_json=?4,updated_at_ms=?5
                                 WHERE id=?1",
                                params![id,note.confidence,note.importance,merged_json,now],
                            )?;
                            let after = load_memory(&transaction, &id)?.expect("merged memory must exist");
                            insert_memory_revision(&transaction, &id, "evidence_merged", Some(&before), Some(&after),
                                "dreaming merged duplicate observations", &note.evidence)?;
                            report.notes_updated += 1;
                            continue;
                        }
                        let id = new_id(now as u128);
                        transaction.execute(
                            "INSERT INTO memories (
                                id,schema_version,kind,scope,scope_id,content,source,confidence,
                                created_at_ms,updated_at_ms,expires_at_ms,status,importance,
                                source_refs_json,access_count,last_accessed_at_ms
                            ) VALUES (?1,?2,?3,?4,?5,?6,'dreaming',?7,?8,?8,NULL,?9,?10,?11,0,NULL)",
                            params![
                                id,SCHEMA_VERSION,kind.as_str(),scope.as_str(),note.scope_id,
                                note.content.trim(),note.confidence,now,status.as_str(),note.importance,refs
                            ],
                        )?;
                        let after = load_memory(&transaction, &id)?.expect("created memory must exist");
                        insert_memory_revision(&transaction, &id, "created", None, Some(&after),
                            "dreaming extracted a durable observation", &note.evidence)?;
                        report.notes_created += 1;
                    } else {
                        let id = note.id.as_deref().ok_or_else(|| AgentError::InvalidAction("dreaming update is missing memory ID".into()))?;
                        MemoryStore::validate_id(id)?;
                        let before = load_memory(&transaction, id)?
                            .ok_or_else(|| AgentError::InvalidAction(format!("dreaming update references missing memory: {id}")))?;
                        if before.scope != scope || before.scope_id != note.scope_id {
                            return Err(AgentError::InvalidAction(
                                "Dreaming cannot move an existing memory across scopes; create a scoped note instead".into(),
                            ));
                        }
                        let mut merged_refs = before.source_refs.clone();
                        for reference in &note.evidence {
                            if !merged_refs.contains(reference) {
                                merged_refs.push(reference.clone());
                            }
                        }
                        if merged_refs.len() > MAX_EVIDENCE_REFS {
                            merged_refs.drain(0..merged_refs.len() - MAX_EVIDENCE_REFS);
                        }
                        let refs = serde_json::to_string(&merged_refs)?;
                        transaction.execute(
                            "UPDATE memories SET kind=?2,scope=?3,scope_id=?4,content=?5,
                                confidence=?6,importance=?7,source='dreaming',source_refs_json=?8,
                                status=?9,updated_at_ms=?10 WHERE id=?1",
                            params![
                                id,kind.as_str(),scope.as_str(),note.scope_id,note.content.trim(),
                                note.confidence,note.importance,refs,status.as_str(),now
                            ],
                        )?;
                        let after = load_memory(&transaction, id)?.expect("updated memory must exist");
                        insert_memory_revision(&transaction, id, "updated", Some(&before), Some(&after),
                            "dreaming corrected or consolidated a memory", &note.evidence)?;
                        report.notes_updated += 1;
                    }
                }
                "dispute" | "stale" => {
                    let id = note.id.as_deref().ok_or_else(|| AgentError::InvalidAction("dreaming review is missing memory ID".into()))?;
                    MemoryStore::validate_id(id)?;
                    if note.evidence.is_empty() {
                        return Err(AgentError::InvalidAction("dreaming reviews require source evidence".into()));
                    }
                    let before = load_memory(&transaction, id)?
                        .ok_or_else(|| AgentError::InvalidAction(format!("dreaming review references missing memory: {id}")))?;
                    validate_evidence_scope_in_transaction(
                        &transaction, &note.evidence, before.scope, before.scope_id.as_deref()
                    )?;
                    let status = if note.action == "dispute" { MemoryStatus::Disputed } else { MemoryStatus::Stale };
                    transaction.execute(
                        "UPDATE memories SET status=?2,updated_at_ms=?3 WHERE id=?1",
                        params![id,status.as_str(),to_i64(now_ms())?],
                    )?;
                    let after = load_memory(&transaction, id)?.expect("reviewed memory must exist");
                    insert_memory_revision(&transaction, id, note.action.as_str(), Some(&before), Some(&after),
                        "dreaming review", &note.evidence)?;
                    if status == MemoryStatus::Disputed {
                        report.notes_disputed += 1;
                    } else {
                        report.notes_marked_stale += 1;
                    }
                }
                "keep" => {}
                action => return Err(AgentError::InvalidAction(format!("unsupported dreaming note action: {action}"))),
            }
        }

        let mut pending_page_links = Vec::new();
        for page in output.pages {
            validate_page_id(&page.id)?;
            if page.title.trim().is_empty() || page.title.len() > 160
                || page.summary.trim().is_empty() || page.summary.len() > 800
                || page.content.trim().is_empty() || page.content.len() > MAX_TEXT
                || page.links.len() > MAX_PAGE_LINKS
            {
                return Err(AgentError::InvalidAction(format!("dreaming page {} is outside configured limits", page.id)));
            }
            validate_scope(page.scope, page.scope_id.as_deref())?;
            validate_evidence_scope_in_transaction(
                &transaction, &page.evidence, page.scope, page.scope_id.as_deref()
            )?;
            let before = load_page(&transaction, &page.id)?;
            if before.as_ref().is_some_and(|existing| {
                existing.scope != page.scope || existing.scope_id != page.scope_id
            }) {
                return Err(AgentError::InvalidAction(format!(
                    "knowledge page ID {} is already owned by a different scope", page.id
                )));
            }
            if page.evidence.is_empty() {
                return Err(AgentError::InvalidAction(format!("dreaming page {} has no source evidence", page.id)));
            }
            for link in &page.links {
                validate_page_id(link)?;
            }
            let mut validated_links = page.links.clone();
            validated_links.extend(markdown_page_links(&page.content));
            validated_links.sort();
            validated_links.dedup();
            for link in &validated_links {
                validate_page_id(link)?;
            }
            let refs = serde_json::to_string(&page.evidence)?;
            let links = serde_json::to_string(&page.links)?;
            let now = to_i64(now_ms())?;
            let revision = next_page_revision(&transaction, &page.id)?;
            let exists = before.is_some();
            transaction.execute(
                "INSERT INTO memory_pages (
                    id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,summary=excluded.summary,content=excluded.content,
                    scope=excluded.scope,scope_id=excluded.scope_id,
                    source_refs_json=excluded.source_refs_json,links_json=excluded.links_json,
                    updated_at_ms=excluded.updated_at_ms,revision=excluded.revision",
                params![page.id,page.title.trim(),page.summary.trim(),page.content.trim(),page.scope.as_str(),
                    page.scope_id,refs,links,now,revision],
            )?;
            let after = load_page(&transaction, &page.id)?.expect("upserted page must exist");
            insert_page_revision(&transaction, &page.id,
                if exists { "updated" } else { "created" },
                before.as_ref(), Some(&after), "dreaming wiki maintenance", &page.evidence)?;
            pending_page_links.push((page.id.clone(), page.scope, page.scope_id.clone(), validated_links));
            if exists { report.pages_updated += 1; } else { report.pages_created += 1; }
        }
        for (source_id, source_scope, source_scope_id, links) in pending_page_links {
            for target_id in links {
                let target = load_page(&transaction, &target_id)?.ok_or_else(|| {
                    AgentError::InvalidAction(format!(
                        "knowledge page {source_id} links to missing page {target_id}"
                    ))
                })?;
                let same_scope = target.scope == source_scope && target.scope_id == source_scope_id;
                if target.scope != MemoryScope::Global && !same_scope {
                    return Err(AgentError::InvalidAction(format!(
                        "knowledge page {source_id} links outside its scope to {target_id}"
                    )));
                }
            }
        }

        for deletion in output.delete_pages {
            validate_page_id(&deletion.id)?;
            if deletion.id == "index" {
                return Err(AgentError::InvalidAction("the global knowledge index cannot be deleted".into()));
            }
            if deletion.evidence.is_empty() {
                return Err(AgentError::InvalidAction(format!(
                    "knowledge page deletion {} requires source evidence", deletion.id
                )));
            }
            let before = load_page(&transaction, &deletion.id)?
                .ok_or_else(|| AgentError::InvalidAction(format!(
                    "knowledge page to delete was not found: {}", deletion.id
                )))?;
            validate_evidence_scope_in_transaction(
                &transaction, &deletion.evidence, before.scope, before.scope_id.as_deref()
            )?;
            let remaining_pages = {
                let mut statement = transaction.prepare(
                    "SELECT id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
                     FROM memory_pages WHERE id<>?1"
                )?;
                statement.query_map([&deletion.id], row_page)?
                    .collect::<Result<Vec<_>, _>>()?
            };
            if remaining_pages.iter().any(|page| {
                page.links.iter().any(|link| link == &deletion.id)
                    || markdown_page_links(&page.content).iter().any(|link| link == &deletion.id)
            }) {
                return Err(AgentError::InvalidAction(format!(
                    "knowledge page {} is still referenced; update incoming links before deleting it",
                    deletion.id
                )));
            }
            insert_page_revision(&transaction, &deletion.id, "deleted", Some(&before), None,
                "dreaming removed an obsolete knowledge page", &deletion.evidence)?;
            transaction.execute("DELETE FROM memory_pages WHERE id=?1", [&deletion.id])?;
        }

        let reviewed_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM transcripts WHERE id>?1 AND id<=?2",
            params![previous_cursor, output.reviewed_through],
            |row| row.get(0),
        )?;
        report.transcripts_reviewed = usize::try_from(reviewed_count).unwrap_or(0);
        transaction.execute(
            "INSERT INTO memory_meta(key,value) VALUES ('last_dreamed_transcript_id',?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [output.reviewed_through.to_string()],
        )?;
        if let Some((run_id, metrics)) = run {
            let now = to_i64(now_ms())?;
            transaction.execute(
                "UPDATE dreaming_runs SET status='completed',cursor_to=?2,transcript_count=?3,
                    model=?4,prompt_tokens=?5,completion_tokens=?6,total_tokens=?7,duration_ms=?8,
                    completed_at_ms=?9,error=NULL WHERE id=?1 AND status='running'",
                params![run_id,output.reviewed_through,report.transcripts_reviewed,metrics.model,
                    metrics.prompt_tokens,metrics.completion_tokens,metrics.total_tokens,metrics.duration_ms,now],
            )?;
            transaction.execute(
                "UPDATE dreaming_control SET current_run_id=NULL,lease_until_ms=NULL,
                    next_retry_at_ms=NULL,failure_count=0,last_error=NULL
                 WHERE id=1 AND current_run_id=?1",
                [run_id],
            )?;
        }
        transaction.commit()?;
        Ok(report)
    }
}

const MEMORY_SELECT: &str = "SELECT schema_version,id,kind,scope,scope_id,content,source,
    confidence,created_at_ms,updated_at_ms,expires_at_ms,status,importance,
    source_refs_json,access_count,last_accessed_at_ms FROM memories";
const MEMORY_SELECT_BY_ID: &str = "SELECT schema_version,id,kind,scope,scope_id,content,source,
    confidence,created_at_ms,updated_at_ms,expires_at_ms,status,importance,
    source_refs_json,access_count,last_accessed_at_ms FROM memories WHERE id=?1";

fn ensure_memory_column(connection: &Connection, name: &str, definition: &str) -> Result<(), AgentError> {
    ensure_column(connection, "memories", name, definition)
}

fn ensure_column(connection: &Connection, table: &str, name: &str, definition: &str) -> Result<(), AgentError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|column| column == name) {
        connection.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {definition}"))?;
    }
    Ok(())
}


/// Extract local knowledge-page links from Markdown. External URLs and anchors are not
/// wiki references; local links must resolve to a valid page ID.
fn markdown_page_links(content: &str) -> Vec<String> {
    let Ok(pattern) = regex::Regex::new(r"\[[^\]]*\]\(([^)]+)\)") else {
        return Vec::new();
    };
    pattern.captures_iter(content)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str().trim().to_owned()))
        .filter_map(|target| {
            if target.is_empty()
                || target.starts_with('#')
                || target.starts_with('/')
                || target.contains("://")
                || target.starts_with("mailto:")
            {
                return None;
            }
            let target = target.split('#').next().unwrap_or_default().trim();
            let target = target.strip_prefix("./").unwrap_or(target);
            let target = target.strip_suffix(".md").unwrap_or(target);
            (!target.is_empty()).then(|| target.to_owned())
        })
        .collect()
}

fn collect_transcript_refs_from_json(
    encoded: &str,
    output: &mut HashSet<String>,
) -> Result<(), AgentError> {
    let refs: Vec<String> = serde_json::from_str(encoded)?;
    output.extend(refs.into_iter().filter(|reference| reference.starts_with("transcript:")));
    Ok(())
}

fn collect_transcript_refs_from_snapshot(
    snapshot: &Option<String>,
    output: &mut HashSet<String>,
) -> Result<(), AgentError> {
    if let Some(snapshot) = snapshot {
        let value: Value = serde_json::from_str(snapshot)?;
        if let Some(refs) = value.get("source_refs").and_then(Value::as_array) {
            output.extend(refs.iter().filter_map(Value::as_str)
                .filter(|reference| reference.starts_with("transcript:"))
                .map(str::to_owned));
        }
    }
    Ok(())
}

fn transcript_is_referenced_in_transaction(
    transaction: &Transaction<'_>,
    reference: &str,
) -> Result<bool, AgentError> {
    for sql in [
        "SELECT source_refs_json FROM memories",
        "SELECT source_refs_json FROM memory_pages",
        "SELECT evidence_refs_json FROM memory_revisions",
        "SELECT evidence_refs_json FROM memory_page_revisions",
    ] {
        let values = {
            let mut statement = transaction.prepare(sql)?;
            let mapped = statement.query_map([], |row| row.get::<_, String>(0))?;
            mapped.collect::<Result<Vec<_>, _>>()?
        };
        for encoded in values {
            let refs: Vec<String> = serde_json::from_str(&encoded)?;
            if refs.iter().any(|item| item == reference) { return Ok(true); }
        }
    }

    let revision_snapshots = {
        let mut statement = transaction.prepare(
            "SELECT before_json,after_json FROM memory_revisions
             UNION ALL
             SELECT before_json,after_json FROM memory_page_revisions"
        )?;
        statement.query_map([], |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (before, after) in revision_snapshots {
        for snapshot in [before, after].into_iter().flatten() {
            let value: Value = serde_json::from_str(&snapshot)?;
            if value.get("source_refs")
                .and_then(Value::as_array)
                .is_some_and(|refs| refs.iter().any(|item| item.as_str() == Some(reference)))
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn validate_memory_input(input: &MemoryInput) -> Result<(), AgentError> {
    if input.content.trim().is_empty()
        || input.content.len() > MAX_TEXT
        || input.source.trim().len() > MAX_SOURCE
        || input.confidence > 100
    {
        return Err(AgentError::InvalidAction("memory content/source/confidence is outside configured limits".into()));
    }
    validate_scope(input.scope, input.scope_id.as_deref())
}

fn validate_note_content(content: &str) -> Result<(), AgentError> {
    if content.trim().is_empty() || content.len() > MAX_TEXT {
        return Err(AgentError::InvalidAction("memory note content must contain 1–16000 bytes".into()));
    }
    Ok(())
}

fn validate_scope(scope: MemoryScope, scope_id: Option<&str>) -> Result<(), AgentError> {
    if (scope == MemoryScope::Global && scope_id.is_some())
        || (scope != MemoryScope::Global && scope_id.is_none_or(str::is_empty))
    {
        return Err(AgentError::InvalidAction("memory scope ID does not match its scope".into()));
    }
    if scope_id.is_some_and(|id| id.len() > 128 || id.chars().any(char::is_control)) {
        return Err(AgentError::InvalidAction("memory scope ID is outside configured limits".into()));
    }
    Ok(())
}

fn validate_evidence_refs(refs: &[String]) -> Result<(), AgentError> {
    if refs.len() > MAX_EVIDENCE_REFS || refs.iter().any(|item| item.len() > 160) {
        return Err(AgentError::InvalidAction("memory evidence references exceed configured limits".into()));
    }
    Ok(())
}


fn scope_matches(scope: MemoryScope, scope_id: Option<&str>, query: &MemoryQuery) -> bool {
    match scope {
        MemoryScope::Global => true,
        MemoryScope::Project => query.project_id.as_deref() == scope_id,
        MemoryScope::Session => query.session_id.as_deref() == scope_id,
        MemoryScope::Task => query.task_id.as_deref() == scope_id,
    }
}

fn last_dreamed_cursor(connection: &Connection) -> Result<i64, AgentError> {
    let value: Option<String> = connection.query_row(
        "SELECT value FROM memory_meta WHERE key='last_dreamed_transcript_id'",
        [],
        |row| row.get(0),
    ).optional()?;
    Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
}

fn load_page(connection: &Connection, id: &str) -> Result<Option<MemoryPage>, AgentError> {
    Ok(connection.query_row(
        "SELECT id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
         FROM memory_pages WHERE id=?1",
        [id],
        row_page,
    ).optional()?)
}

fn write_page_record(transaction: &Transaction<'_>, page: &MemoryPage) -> Result<(), AgentError> {
    transaction.execute(
        "INSERT INTO memory_pages (
            id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,
            content=excluded.content,scope=excluded.scope,scope_id=excluded.scope_id,
            source_refs_json=excluded.source_refs_json,links_json=excluded.links_json,
            updated_at_ms=excluded.updated_at_ms,revision=excluded.revision",
        params![page.id,page.title,page.summary,page.content,page.scope.as_str(),page.scope_id,
            serde_json::to_string(&page.source_refs)?,serde_json::to_string(&page.links)?,
            to_i64(page.updated_at_ms)?,page.revision],
    )?;
    Ok(())
}

fn next_page_revision(transaction: &Transaction<'_>, page_id: &str) -> Result<u64, AgentError> {
    let revision: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(revision),0)+1 FROM memory_page_revisions WHERE page_id=?1",
        [page_id],
        |row| row.get(0),
    )?;
    u64::try_from(revision)
        .map_err(|_| AgentError::InvalidAction("knowledge page revision out of range".into()))
}

fn insert_page_revision(
    transaction: &Transaction<'_>,
    page_id: &str,
    action: &str,
    before: Option<&MemoryPage>,
    after: Option<&MemoryPage>,
    reason: &str,
    evidence_refs: &[String],
) -> Result<(), AgentError> {
    let revision: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(revision),0)+1 FROM memory_page_revisions WHERE page_id=?1",
        [page_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "INSERT INTO memory_page_revisions(page_id,revision,action,before_json,after_json,reason,evidence_refs_json,created_at_ms)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![page_id,revision,action,before.map(serde_json::to_string).transpose()?,
            after.map(serde_json::to_string).transpose()?,reason,
            serde_json::to_string(evidence_refs)?,to_i64(now_ms())?],
    )?;
    Ok(())
}

fn row_memory_page_revision(row: &Row<'_>) -> rusqlite::Result<MemoryPageRevision> {
    let before: Option<String> = row.get(4)?;
    let after: Option<String> = row.get(5)?;
    let evidence: String = row.get(7)?;
    Ok(MemoryPageRevision {
        revision_id: row.get(0)?,
        page_id: row.get(1)?,
        revision: row.get(2)?,
        action: row.get(3)?,
        before: before.map(|value| serde_json::from_str(&value)).transpose()
            .map_err(|error| conversion_error(4, rusqlite::types::Type::Text, error.to_string()))?,
        after: after.map(|value| serde_json::from_str(&value)).transpose()
            .map_err(|error| conversion_error(5, rusqlite::types::Type::Text, error.to_string()))?,
        reason: row.get(6)?,
        evidence_refs: serde_json::from_str(&evidence)
            .map_err(|error| conversion_error(7, rusqlite::types::Type::Text, error.to_string()))?,
        created_at_ms: from_i64(row.get(8)?, 8)?,
    })
}

fn validate_evidence_scope_in_transaction(
    transaction: &Connection,
    refs: &[String],
    target_scope: MemoryScope,
    target_scope_id: Option<&str>,
) -> Result<(), AgentError> {
    validate_evidence_scope_recursive(transaction, refs, target_scope, target_scope_id, &mut HashSet::new())
}

fn validate_evidence_scope_recursive(
    transaction: &Connection,
    refs: &[String],
    target_scope: MemoryScope,
    target_scope_id: Option<&str>,
    visited: &mut HashSet<String>,
) -> Result<(), AgentError> {
    validate_evidence_refs(refs)?;
    for reference in refs {
        let (kind, id) = reference.split_once(':').expect("evidence reference format was validated");
        let allowed = match kind {
            "transcript" => {
                let transcript_id = id.parse::<i64>()
                    .map_err(|_| AgentError::InvalidAction(format!("invalid transcript reference: {reference}")))?;
                let (session_id, project_id, task_id, role): (String, Option<String>, Option<String>, String) =
                    transaction.query_row(
                        "SELECT session_id,project_id,task_id,role FROM transcripts WHERE id=?1",
                        [transcript_id],
                        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
                    ).optional()?.ok_or_else(|| AgentError::InvalidAction(format!(
                        "memory evidence does not exist: {reference}"
                    )))?;
                let trusted_role = matches!(role.as_str(), "user" | "tool");
                trusted_role && match target_scope {
                    MemoryScope::Global => role == "user" && task_id.is_none(),
                    MemoryScope::Project => project_id.as_deref() == target_scope_id && task_id.is_none(),
                    MemoryScope::Session => session_id == target_scope_id.unwrap_or_default(),
                    MemoryScope::Task => task_id.as_deref() == target_scope_id,
                }
            }
            "memory" => {
                MemoryStore::validate_id(id)?;
                let row: Option<(String, Option<String>, String, Option<i64>, String)> = transaction.query_row(
                    "SELECT scope,scope_id,status,expires_at_ms,source_refs_json FROM memories WHERE id=?1",
                    [id],
                    |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
                ).optional()?;
                let Some((scope_name, scope_id, status, expires_at, source_refs_json)) = row else {
                    return Err(AgentError::InvalidAction(format!("memory evidence does not exist: {reference}")));
                };
                let source_scope = MemoryScope::parse(&scope_name)?;
                let valid_status = status == MemoryStatus::Consolidated.as_str()
                    && expires_at.is_none_or(|expiry| expiry > to_i64(now_ms()).unwrap_or(i64::MAX));
                let visible_scope = source_scope == MemoryScope::Global
                    || (source_scope == target_scope && scope_id.as_deref() == target_scope_id);
                if !valid_status || !visible_scope {
                    false
                } else {
                    if !visited.insert(id.to_owned()) {
                        return Err(AgentError::InvalidAction(format!(
                            "memory evidence chain contains a cycle at {reference}"
                        )));
                    }
                    let nested_refs: Vec<String> = serde_json::from_str(&source_refs_json)?;
                    let nested = validate_evidence_scope_recursive(
                        transaction,
                        &nested_refs,
                        source_scope,
                        scope_id.as_deref(),
                        visited,
                    );
                    visited.remove(id);
                    nested?;
                    true
                }
            }
            _ => false,
        };
        if !allowed {
            return Err(AgentError::InvalidAction(format!(
                "memory evidence {reference} does not belong to the target {:?} scope or its source chain is not valid",
                target_scope
            )));
        }
    }
    Ok(())
}

fn load_memory(connection: &Connection, id: &str) -> Result<Option<MemoryRecord>, AgentError> {
    Ok(connection.query_row(MEMORY_SELECT_BY_ID, [id], row_memory).optional()?)
}

fn insert_memory_revision(
    transaction: &Transaction<'_>,
    memory_id: &str,
    action: &str,
    before: Option<&MemoryRecord>,
    after: Option<&MemoryRecord>,
    reason: &str,
    evidence_refs: &[String],
) -> Result<(), AgentError> {
    let revision: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(revision),0)+1 FROM memory_revisions WHERE memory_id=?1",
        [memory_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "INSERT INTO memory_revisions(memory_id,revision,action,before_json,after_json,reason,evidence_refs_json,created_at_ms)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            memory_id,
            revision,
            action,
            before.map(serde_json::to_string).transpose()?,
            after.map(serde_json::to_string).transpose()?,
            reason,
            serde_json::to_string(evidence_refs)?,
            to_i64(now_ms())?
        ],
    )?;
    Ok(())
}

fn write_memory_record(transaction: &Transaction<'_>, record: &MemoryRecord) -> Result<(), AgentError> {
    transaction.execute(
        "INSERT INTO memories (
            id,schema_version,kind,scope,scope_id,content,source,confidence,
            created_at_ms,updated_at_ms,expires_at_ms,status,importance,
            source_refs_json,access_count,last_accessed_at_ms
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
         ON CONFLICT(id) DO UPDATE SET
            schema_version=excluded.schema_version,kind=excluded.kind,scope=excluded.scope,
            scope_id=excluded.scope_id,content=excluded.content,source=excluded.source,
            confidence=excluded.confidence,created_at_ms=excluded.created_at_ms,
            updated_at_ms=excluded.updated_at_ms,expires_at_ms=excluded.expires_at_ms,
            status=excluded.status,importance=excluded.importance,
            source_refs_json=excluded.source_refs_json,access_count=excluded.access_count,
            last_accessed_at_ms=excluded.last_accessed_at_ms",
        params![
            record.id,record.schema_version,record.kind.as_str(),record.scope.as_str(),
            record.scope_id,record.content,record.source,record.confidence,
            to_i64(record.created_at_ms)?,to_i64(record.updated_at_ms)?,
            record.expires_at_ms.map(to_i64).transpose()?,record.status.as_str(),
            record.importance,serde_json::to_string(&record.source_refs)?,
            record.access_count,record.last_accessed_at_ms.map(to_i64).transpose()?
        ],
    )?;
    Ok(())
}

fn row_dreaming_run(row: &Row<'_>) -> rusqlite::Result<DreamingRunRecord> {
    let started: i64 = row.get(11)?;
    let completed: Option<i64> = row.get(12)?;
    let transcript_count: i64 = row.get(5)?;
    Ok(DreamingRunRecord {
        id: row.get(0)?,
        trigger: row.get(1)?,
        status: row.get(2)?,
        cursor_from: row.get(3)?,
        cursor_to: row.get(4)?,
        transcript_count: usize::try_from(transcript_count)
            .map_err(|error| conversion_error(5, rusqlite::types::Type::Integer, error.to_string()))?,
        model: row.get(6)?,
        prompt_tokens: row.get(7)?,
        completion_tokens: row.get(8)?,
        total_tokens: row.get(9)?,
        duration_ms: row.get(10)?,
        started_at_ms: from_i64(started, 11)?,
        completed_at_ms: completed.map(|value| from_i64(value, 12)).transpose()?,
        error: row.get(13)?,
    })
}

fn row_memory_revision(row: &Row<'_>) -> rusqlite::Result<MemoryRevision> {
    let before: Option<String> = row.get(4)?;
    let after: Option<String> = row.get(5)?;
    let evidence: String = row.get(7)?;
    Ok(MemoryRevision {
        revision_id: row.get(0)?,
        memory_id: row.get(1)?,
        revision: row.get(2)?,
        action: row.get(3)?,
        before: before.map(|value| serde_json::from_str(&value)).transpose()
            .map_err(|error| conversion_error(4, rusqlite::types::Type::Text, error.to_string()))?,
        after: after.map(|value| serde_json::from_str(&value)).transpose()
            .map_err(|error| conversion_error(5, rusqlite::types::Type::Text, error.to_string()))?,
        reason: row.get(6)?,
        evidence_refs: serde_json::from_str(&evidence)
            .map_err(|error| conversion_error(7, rusqlite::types::Type::Text, error.to_string()))?,
        created_at_ms: from_i64(row.get(8)?, 8)?,
    })
}

fn row_memory(row: &Row<'_>) -> rusqlite::Result<MemoryRecord> {
    let created: i64 = row.get(8)?;
    let updated: i64 = row.get(9)?;
    let expiry: Option<i64> = row.get(10)?;
    let last_accessed: Option<i64> = row.get(15)?;
    let source_refs_json: String = row.get(13)?;
    let source_refs = serde_json::from_str(&source_refs_json).map_err(|error| {
        conversion_error(13, rusqlite::types::Type::Text, error.to_string())
    })?;
    Ok(MemoryRecord {
        schema_version: row.get(0)?,
        id: row.get(1)?,
        kind: MemoryKind::parse(&row.get::<_, String>(2)?)?,
        scope: MemoryScope::parse(&row.get::<_, String>(3)?)?,
        scope_id: row.get(4)?,
        content: row.get(5)?,
        source: row.get(6)?,
        confidence: row.get(7)?,
        created_at_ms: from_i64(created, 8)?,
        updated_at_ms: from_i64(updated, 9)?,
        expires_at_ms: expiry.map(|value| from_i64(value, 10)).transpose()?,
        status: MemoryStatus::parse(&row.get::<_, String>(11)?)?,
        importance: row.get(12)?,
        source_refs,
        access_count: row.get(14)?,
        last_accessed_at_ms: last_accessed.map(|value| from_i64(value, 15)).transpose()?,
    })
}

fn row_transcript(row: &Row<'_>) -> rusqlite::Result<TranscriptEntry> {
    Ok(TranscriptEntry {
        id: row.get(0)?,
        session_id: row.get(1)?,
        project_id: row.get(2)?,
        task_id: row.get(3)?,
        role: row.get(4)?,
        content: row.get(5)?,
        created_at_ms: from_i64(row.get(6)?, 6)?,
    })
}

fn row_page(row: &Row<'_>) -> rusqlite::Result<MemoryPage> {
    let refs: String = row.get(6)?;
    let links: String = row.get(7)?;
    Ok(MemoryPage {
        id: row.get(0)?,
        title: row.get(1)?,
        summary: row.get(2)?,
        content: row.get(3)?,
        scope: MemoryScope::parse(&row.get::<_, String>(4)?)?,
        scope_id: row.get(5)?,
        source_refs: serde_json::from_str(&refs).map_err(|error| conversion_error(6, rusqlite::types::Type::Text, error.to_string()))?,
        links: serde_json::from_str(&links).map_err(|error| conversion_error(7, rusqlite::types::Type::Text, error.to_string()))?,
        updated_at_ms: from_i64(row.get(8)?, 8)?,
        revision: row.get(9)?,
    })
}

fn from_i64(value: i64, index: usize) -> rusqlite::Result<u128> {
    u128::try_from(value).map_err(|error| conversion_error(index, rusqlite::types::Type::Integer, error.to_string()))
}

fn conversion_error(index: usize, kind: rusqlite::types::Type, message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, kind, message.into())
}

fn validate_page_id(id: &str) -> Result<(), AgentError> {
    if id.is_empty()
        || id.len() > 80
        || !id.chars().all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-' || character == '_')
    {
        return Err(AgentError::InvalidAction("memory page ID must be a lowercase slug".into()));
    }
    Ok(())
}

fn to_i64(value: u128) -> Result<i64, AgentError> {
    i64::try_from(value).map_err(|_| AgentError::InvalidAction("memory timestamp exceeds SQLite integer range".into()))
}

fn ensure_real_dir(path: &Path) -> Result<(), AgentError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(AgentError::InvalidAction("memory database parent must be a real directory".into()));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => std::fs::create_dir_all(path)?,
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

fn ensure_private_dir(path: &Path) -> Result<(), AgentError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(AgentError::InvalidAction("memory storage path must be a real directory".into()));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => std::fs::create_dir_all(path)?,
        Err(error) => return Err(error.into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

fn new_id(now: u128) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("mem-{now:x}-{:x}", NEXT.fetch_add(1, Ordering::Relaxed))
}

fn default_confidence() -> u8 { 70 }
fn default_importance() -> u8 { 50 }

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn workspace() -> PathBuf {
        static NEXT_TEST: AtomicU64 = AtomicU64::new(1);
        let path = std::env::temp_dir().join(format!(
            "rust-agent-memory-{}-{}",
            now_ms(),
            NEXT_TEST.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn input(scope: MemoryScope, scope_id: Option<&str>, content: &str) -> MemoryInput {
        MemoryInput {
            kind: MemoryKind::LongTerm,
            scope,
            scope_id: scope_id.map(str::to_owned),
            content: content.into(),
            source: "test".into(),
            confidence: 95,
            expires_at_ms: None,
        }
    }

    #[test]
    fn transcript_search_and_read_never_cross_project_boundaries() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let a = store.record_transcript("shared-session", Some("project-a"), None, "user", "Project A secret").unwrap();
        store.record_transcript("shared-session", Some("project-b"), None, "user", "Project B secret").unwrap();

        let found = store.search_transcripts("secret", Some("shared-session"), Some("project-a"), None, 10).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, a);
        assert!(store.get_transcript_scoped(a, "shared-session", Some("project-b"), None).is_err());
        assert!(store.get_transcript_scoped(a, "another-session", Some("project-a"), None).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transcript_backfill_classifies_tool_and_background_messages_as_non_user() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let messages = vec![
            ChatMessage { role: "user".into(), content: "Explicit user request".into() },
            ChatMessage { role: "user".into(), content: "Tool result (ok=true): private file data".into() },
            ChatMessage { role: "user".into(), content: "Background task result [task-1]: generated summary".into() },
        ];
        assert_eq!(store.backfill_transcript("session-1", Some("project-a"), &messages).unwrap(), 3);
        let records = store.transcripts_after(0, 10).unwrap();
        assert_eq!(records.iter().map(|record| record.role.as_str()).collect::<Vec<_>>(), vec!["user", "tool", "assistant"]);
        let refs = store.latest_turn_evidence_refs("session-1", Some("project-a"), None, true).unwrap();
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[1], format!("transcript:{}", records[1].id));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn memory_evidence_must_be_consolidated_and_unexpired() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let proposed = store.propose(
            input(MemoryScope::Global, None, "Unreviewed observation"),
            70,
            Vec::new(),
        ).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Evidence source").unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![DreamingNote {
                action: "create".into(), id: None,
                kind: Some(MemoryKind::LongTerm), scope: Some(MemoryScope::Global),
                scope_id: None, content: "A derived note".into(), confidence: 80,
                importance: 60, evidence: vec![format!("memory:{}", proposed.id)],
            }],
            pages: vec![], delete_pages: vec![],
        };
        assert!(store.apply_dreaming(output).is_err());
        store.set_status(&proposed.id, MemoryStatus::Consolidated).unwrap();
        let expired = store.remember({
            let mut value = input(MemoryScope::Global, None, "Expired evidence");
            value.expires_at_ms = Some(now_ms().saturating_sub(1));
            value
        }).unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![DreamingNote {
                action: "create".into(), id: None,
                kind: Some(MemoryKind::LongTerm), scope: Some(MemoryScope::Global),
                scope_id: None, content: "Another derived note".into(), confidence: 80,
                importance: 60, evidence: vec![format!("memory:{}", expired.id)],
            }],
            pages: vec![], delete_pages: vec![],
        };
        assert!(store.apply_dreaming(output).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn memory_evidence_revalidates_the_entire_source_chain() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "The source fact").unwrap();
        let source = store.propose(
            input(MemoryScope::Global, None, "A fact derived from a transcript"),
            80,
            vec![format!("transcript:{transcript}")],
        ).unwrap();
        assert!(store.set_status(&source.id, MemoryStatus::Consolidated).is_ok());
        store.set_status(&source.id, MemoryStatus::Disputed).unwrap();

        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![DreamingNote {
                action: "create".into(), id: None,
                kind: Some(MemoryKind::LongTerm), scope: Some(MemoryScope::Global),
                scope_id: None, content: "A fact derived from another memory".into(),
                confidence: 90, importance: 80,
                evidence: vec![format!("memory:{}", source.id)],
            }],
            pages: vec![],
            delete_pages: vec![],
        };
        assert!(store.apply_dreaming(output).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn forgetting_last_memory_source_removes_its_transcript_but_keeps_shared_evidence() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let shared = store.record_transcript("s1", None, None, "user", "Shared source").unwrap();
        let exclusive = store.record_transcript("s1", None, None, "user", "Exclusive source").unwrap();

        let first = store.remember({
            let mut value = input(MemoryScope::Global, None, "Memory with shared evidence");
            value.source_refs = vec![format!("transcript:{shared}")];
            value
        }).unwrap();
        let second = store.remember({
            let mut value = input(MemoryScope::Global, None, "Memory with exclusive evidence");
            value.source_refs = vec![format!("transcript:{exclusive}")];
            value
        }).unwrap();
        let third = store.remember({
            let mut value = input(MemoryScope::Project, Some("project-a"), "Another use of shared evidence");
            value.source_refs = vec![format!("transcript:{shared}")];
            value
        }).unwrap();

        store.forget(&first.id).unwrap();
        assert!(store.get_transcript(shared).is_ok());
        store.forget(&second.id).unwrap();
        assert!(store.get_transcript(exclusive).is_err());
        store.forget(&third.id).unwrap();
        assert!(store.get_transcript(shared).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transcript_retention_prunes_only_old_unreferenced_rows_and_keeps_recent_floor() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let mut old_ids = Vec::new();
        for index in 0..1_005 {
            old_ids.push(store.record_transcript(
                &format!("s{index}"), None, None, "user", &format!("old transcript {index}")
            ).unwrap());
        }
        let protected = old_ids[0];
        let referenced = old_ids[4];
        store.remember({
            let mut value = input(MemoryScope::Global, None, "Retained source");
            value.source_refs = vec![format!("transcript:{referenced}")];
            value
        }).unwrap();
        let deleted = store.prune_transcripts(now_ms().saturating_add(1), 20).unwrap();
        assert_eq!(deleted, 4);
        assert!(store.get_transcript(protected).is_err());
        assert!(store.get_transcript(referenced).is_ok());
        assert!(store.get_transcript(*old_ids.last().unwrap()).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn derived_memories_stop_retrieving_when_their_source_becomes_disputed() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Original approved fact").unwrap();
        let source = store.propose(
            input(MemoryScope::Global, None, "Source policy fact"),
            90,
            vec![format!("transcript:{transcript}")],
        ).unwrap();
        store.set_status(&source.id, MemoryStatus::Consolidated).unwrap();
        let derived = store.propose(
            input(MemoryScope::Global, None, "Derived policy fact"),
            90,
            vec![format!("memory:{}", source.id)],
        ).unwrap();
        store.set_status(&derived.id, MemoryStatus::Consolidated).unwrap();

        let query = MemoryQuery {
            query: "Derived policy fact".into(),
            session_id: None,
            project_id: None,
            task_id: None,
            limit: 5,
        };
        assert_eq!(store.retrieve(&query).unwrap().len(), 1);
        store.set_status(&source.id, MemoryStatus::Disputed).unwrap();
        assert!(store.retrieve(&query).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn consolidating_a_proposal_requires_valid_source_evidence() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let proposed = store.propose(
            input(MemoryScope::Global, None, "A claim with missing provenance"),
            60,
            vec!["transcript:999999".into()],
        ).unwrap();
        assert!(store.set_status(&proposed.id, MemoryStatus::Consolidated).is_err());
        assert_eq!(store.get(&proposed.id).unwrap().status, MemoryStatus::Proposed);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn markdown_wiki_links_are_extracted_without_external_urls() {
        let links = markdown_page_links("See [Policy](policy-page.md), [Other](./other-page), [external](https://example.com), and [anchor](#top).");
        assert_eq!(links, vec!["policy-page", "other-page"]);
    }

    #[test]
    fn knowledge_page_revision_records_evidence_for_deletion() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Remove obsolete page after review").unwrap();
        let evidence = vec![format!("transcript:{transcript}")];
        store.apply_dreaming(DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![DreamingPage {
                id: "obsolete-page".into(),
                title: "Obsolete".into(),
                summary: "No longer needed".into(),
                content: "Old information".into(),
                scope: MemoryScope::Global,
                scope_id: None,
                evidence: evidence.clone(),
                links: vec![],
            }],
            delete_pages: vec![],
        }).unwrap();
        store.apply_dreaming(DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![],
            delete_pages: vec![DreamingPageDeletion {
                id: "obsolete-page".into(),
                evidence: evidence.clone(),
            }],
        }).unwrap();

        let revisions = store.list_page_revisions("obsolete-page", 10).unwrap();
        let deletion = revisions.iter().find(|revision| revision.action == "deleted").unwrap();
        assert_eq!(deletion.evidence_refs, evidence);
        assert!(store.get_page("obsolete-page").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pages_with_invalidated_source_memory_are_not_retrievable() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "A source requirement").unwrap();
        let source = store.propose(
            input(MemoryScope::Global, None, "A policy requirement"),
            90,
            vec![format!("transcript:{transcript}")],
        ).unwrap();
        store.set_status(&source.id, MemoryStatus::Consolidated).unwrap();
        store.apply_dreaming(DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![DreamingPage {
                id: "policy-page".into(),
                title: "Policy".into(),
                summary: "Policy requirements".into(),
                content: "The project requires a clear policy.".into(),
                scope: MemoryScope::Global,
                scope_id: None,
                evidence: vec![format!("memory:{}", source.id)],
                links: vec![],
            }],
            delete_pages: vec![],
        }).unwrap();
        assert!(store.get_page("policy-page").is_ok());
        store.set_status(&source.id, MemoryStatus::Disputed).unwrap();
        assert!(store.get_page("policy-page").is_err());
        assert!(store.search_pages("policy", 10).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_rejects_missing_markdown_only_wiki_targets() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Link knowledge pages").unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![DreamingPage {
                id: "source-page".into(),
                title: "Source".into(),
                summary: "Page with a Markdown link".into(),
                content: "See [missing](missing-target.md).".into(),
                scope: MemoryScope::Global,
                scope_id: None,
                evidence: vec![format!("transcript:{transcript}")],
                links: vec![],
            }],
            delete_pages: vec![],
        };
        assert!(store.apply_dreaming(output).is_err());
        assert!(store.get_page("source-page").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_cannot_delete_page_referenced_only_by_markdown() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Preserve Markdown references").unwrap();
        let first = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![
                DreamingPage {
                    id: "source-page".into(),
                    title: "Source".into(),
                    summary: "Source page".into(),
                    content: "See [child](child-page.md).".into(),
                    scope: MemoryScope::Global,
                    scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")],
                    links: vec![],
                },
                DreamingPage {
                    id: "child-page".into(),
                    title: "Child".into(),
                    summary: "Child page".into(),
                    content: "Child content".into(),
                    scope: MemoryScope::Global,
                    scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")],
                    links: vec![],
                },
            ],
            delete_pages: vec![],
        };
        store.apply_dreaming(first).unwrap();
        let deletion = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![],
            delete_pages: vec![DreamingPageDeletion {
                id: "child-page".into(),
                evidence: vec![format!("transcript:{transcript}")],
            }],
        };
        assert!(store.apply_dreaming(deletion).is_err());
        assert!(store.get_page("child-page").is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn background_task_leases_are_exclusive_across_sqlite_connections_and_limit_capacity() {
        let root = workspace();
        let first = MemoryStore::new(&root).unwrap();
        let second = MemoryStore::open(&first.database_path().to_path_buf()).unwrap();

        assert!(first.acquire_background_task_lease("task-a", "owner-a", 120_000, 1).unwrap());
        assert!(!second.acquire_background_task_lease("task-a", "owner-b", 120_000, 1).unwrap());
        assert!(!second.acquire_background_task_lease("task-b", "owner-b", 120_000, 1).unwrap());
        assert!(!second.renew_background_task_lease("task-a", "owner-b", 120_000).unwrap());
        assert!(second.renew_background_task_lease("task-a", "owner-a", 120_000).unwrap());
        first.release_background_task_lease("task-a", "owner-a").unwrap();
        assert!(second.acquire_background_task_lease("task-b", "owner-b", 120_000, 1).unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sqlite_persists_memory_and_tracks_access() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let record = store.remember(input(MemoryScope::Global, None, "Prefers Rust and minimal dependencies")).unwrap();
        assert_eq!(record.status, MemoryStatus::Consolidated);
        let results = store.retrieve(&MemoryQuery {
            query: "Rust minimal dependencies".into(),
            session_id: None,
            project_id: None,
            task_id: None,
            limit: 5,
        }).unwrap();
        assert_eq!(results[0].id, record.id);
        let updated = store.update(&record.id, "Prefers Rust with few dependencies", None, Some(90)).unwrap();
        assert_eq!(updated.confidence, 90);
        assert_eq!(store.get(&record.id).unwrap().access_count, 1);
        drop(store);
        let reopened = MemoryStore::new(&root).unwrap();
        assert_eq!(reopened.get(&record.id).unwrap().content, "Prefers Rust with few dependencies");
        reopened.forget(&record.id).unwrap();
        assert_eq!(reopened.count().unwrap(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn proposed_notes_are_not_retrieved_until_consolidated() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript_id = store.record_transcript("session-1", None, None, "user", "Please use Rust for this tool").unwrap();
        let proposed = store.propose(
            input(MemoryScope::Global, None, "Use Rust for this tool"),
            80,
            vec![format!("transcript:{transcript_id}")],
        ).unwrap();
        let query = MemoryQuery { query: "Rust tool".into(), session_id: None, project_id: None, task_id: None, limit: 5 };
        assert!(store.retrieve(&query).unwrap().is_empty());
        store.set_status(&proposed.id, MemoryStatus::Consolidated).unwrap();
        assert_eq!(store.retrieve(&query).unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn turn_evidence_uses_user_and_tool_records_but_not_assistant_claims() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        store.record_transcript("s1", Some("p1"), None, "user", "An older request").unwrap();
        store.record_transcript("s1", Some("p1"), None, "assistant", "An old assistant answer").unwrap();
        let current_user = store.record_transcript("s1", Some("p1"), None, "user", "Keep the write approval requirement").unwrap();
        store.record_transcript("s1", Some("p1"), None, "assistant", "I think approval is needed").unwrap();
        let tool = store.record_transcript("s1", Some("p1"), None, "tool", "Tool result: write was denied without approval").unwrap();
        store.record_transcript("s2", Some("p1"), None, "tool", "Another session tool result").unwrap();
        let refs = store.latest_turn_evidence_refs("s1", Some("p1"), None, true).unwrap();
        assert_eq!(refs, vec![format!("transcript:{current_user}"), format!("transcript:{tool}")]);
        let user_only = store.latest_turn_evidence_refs("s1", Some("p1"), None, false).unwrap();
        assert_eq!(user_only, vec![format!("transcript:{current_user}")]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transcripts_are_searchable_and_cursor_is_monotonic() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let first = store.record_transcript("s1", None, None, "user", "Use a bounded context window").unwrap();
        store.record_transcript("s2", None, None, "assistant", "The database uses SQLite").unwrap();
        assert_eq!(store.transcripts_after(0, 10).unwrap().len(), 2);
        assert_eq!(store.search_transcripts("bounded context", Some("s1"), None, None, 5).unwrap()[0].id, first);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_requires_valid_evidence_and_builds_linked_pages() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "The team prefers explicit approval for writes").unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![DreamingNote {
                action: "create".into(), id: None, kind: Some(MemoryKind::Procedural),
                scope: Some(MemoryScope::Global), scope_id: None,
                content: "Workspace writes require explicit approval".into(), confidence: 90,
                importance: 90, evidence: vec![format!("transcript:{transcript}")],
            }],
            pages: vec![DreamingPage {
                id: "workspace-policy".into(), title: "Workspace policy".into(),
                summary: "Write operations require explicit approval.".into(),
                content: "## Write approval\n\nAll workspace writes require user approval.".into(),
                scope: MemoryScope::Global, scope_id: None,
                evidence: vec![format!("transcript:{transcript}")], links: vec![],
            }],
            delete_pages: vec![],
        };
        let report = store.apply_dreaming(output).unwrap();
        assert_eq!(report.notes_created, 1);
        assert_eq!(report.pages_created, 1);
        assert_eq!(store.last_dreamed_transcript_id().unwrap(), transcript);
        assert_eq!(store.get_page("workspace-policy").unwrap().revision, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transcript_search_and_read_are_project_and_task_scoped() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let first = store.record_transcript("session-a", Some("project-a"), None, "user", "project alpha note").unwrap();
        let second = store.record_transcript("session-b", Some("project-b"), None, "user", "project beta note").unwrap();
        let scoped = store.search_transcripts("project note", Some("session-x"), Some("project-a"), None, 10).unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].id, first);
        assert!(store.get_transcript_scoped(second, "session-x", Some("project-a"), None).is_err());
        assert_eq!(store.get_transcript_scoped(first, "session-a", Some("project-a"), None).unwrap().id, first);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn memory_revisions_can_restore_a_previous_snapshot() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let created = store.remember(input(MemoryScope::Global, None, "Prefer explicit Rust APIs")).unwrap();
        store.update(&created.id, "Prefer explicit and small Rust APIs", None, Some(90)).unwrap();
        let revisions = store.list_revisions(&created.id, 10).unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[1].action, "created");
        let restored = store.restore_revision(&created.id, 1).unwrap();
        assert_eq!(restored.content, "Prefer explicit Rust APIs");
        assert_eq!(store.list_revisions(&created.id, 10).unwrap().len(), 3);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_rejects_assistant_only_fact_evidence() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript(
            "session-a", Some("project-a"), None, "assistant",
            "The project requires a particular architecture",
        ).unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![DreamingNote {
                action: "create".into(), id: None, kind: Some(MemoryKind::Procedural),
                scope: Some(MemoryScope::Project), scope_id: Some("project-a".into()),
                content: "The project requires a particular architecture".into(),
                confidence: 99, importance: 90,
                evidence: vec![format!("transcript:{transcript}")],
            }],
            pages: vec![],
            delete_pages: vec![],
        };
        assert!(store.apply_dreaming(output).is_err());
        assert_eq!(store.last_dreamed_transcript_id().unwrap(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_rejects_evidence_from_a_different_project() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("session-a", Some("project-a"), None, "user", "Use a small project-specific API").unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![DreamingNote {
                action: "create".into(), id: None, kind: Some(MemoryKind::Procedural),
                scope: Some(MemoryScope::Project), scope_id: Some("project-b".into()),
                content: "Project B requires a small API".into(), confidence: 95, importance: 80,
                evidence: vec![format!("transcript:{transcript}")],
            }],
            pages: vec![],
            delete_pages: vec![],
        };
        assert!(store.apply_dreaming(output).is_err());
        assert_eq!(store.last_dreamed_transcript_id().unwrap(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_can_yield_to_user_activity_without_counting_a_failure() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        store.record_transcript("session-a", Some("project-a"), None, "user", "Review this project").unwrap();
        let run = store.start_dreaming_run(1, 60_000, "test").unwrap().unwrap();
        store.abort_dreaming_run(run.0, "new user turn started").unwrap();
        let status = store.dreaming_status().unwrap();
        assert_eq!(status.consecutive_failures, 0);
        assert_eq!(status.pending_transcripts, 1);
        assert!(store.start_dreaming_run(1, 60_000, "resumed").unwrap().is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_lease_prevents_duplicate_workers_and_recovers_after_failure() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        store.record_transcript("session-a", Some("project-a"), None, "user", "Keep the memory compact").unwrap();
        assert_eq!(store.pending_transcript_count().unwrap(), 1);
        let first = store.start_dreaming_run(1, 60_000, "test").unwrap().unwrap();
        assert!(store.start_dreaming_run(1, 60_000, "duplicate").unwrap().is_none());
        store.fail_dreaming_run(first.0, "temporary model failure", 0).unwrap();
        assert!(store.start_dreaming_run(1, 60_000, "retry").unwrap().is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_builds_linked_pages_and_records_page_history() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "The team prefers explicit approval for writes").unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![DreamingNote {
                action: "create".into(), id: None, kind: Some(MemoryKind::Procedural),
                scope: Some(MemoryScope::Global), scope_id: None,
                content: "Workspace writes require explicit approval".into(), confidence: 90,
                importance: 90, evidence: vec![format!("transcript:{transcript}")],
            }],
            pages: vec![
                DreamingPage {
                    id: "workspace-policy".into(), title: "Workspace policy".into(),
                    summary: "Write operations require explicit approval.".into(),
                    content: "## Write approval\n\nAll workspace writes require user approval.".into(),
                    scope: MemoryScope::Global, scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")], links: vec!["approval-workflow".into()],
                },
                DreamingPage {
                    id: "approval-workflow".into(), title: "Approval workflow".into(),
                    summary: "Approval steps for workspace writes.".into(),
                    content: "Ask before writes.".into(),
                    scope: MemoryScope::Global, scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")], links: vec!["workspace-policy".into()],
                },
            ],
            delete_pages: vec![],
        };
        let report = store.apply_dreaming(output).unwrap();
        assert_eq!(report.notes_created, 1);
        assert_eq!(report.pages_created, 2);
        assert_eq!(store.last_dreamed_transcript_id().unwrap(), transcript);
        assert_eq!(store.get_page("workspace-policy").unwrap().revision, 1);
        assert_eq!(store.list_page_revisions("workspace-policy", 10).unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_rejects_broken_knowledge_page_links() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Keep policy pages linked").unwrap();
        let output = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![DreamingPage {
                id: "policy".into(), title: "Policy".into(), summary: "A policy page".into(),
                content: "Policy details".into(), scope: MemoryScope::Global, scope_id: None,
                evidence: vec![format!("transcript:{transcript}")], links: vec!["missing-page".into()],
            }],
            delete_pages: vec![],
        };
        assert!(store.apply_dreaming(output).is_err());
        assert_eq!(store.last_dreamed_transcript_id().unwrap(), 0);
        assert!(store.get_page("policy").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_forget_erases_revision_snapshots() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let created = store.remember(input(MemoryScope::Global, None, "A private preference to forget")).unwrap();
        store.update(&created.id, "A revised private preference to forget", None, None).unwrap();
        assert_eq!(store.list_revisions(&created.id, 10).unwrap().len(), 2);
        store.forget(&created.id).unwrap();
        assert!(store.get(&created.id).is_err());
        assert!(store.list_revisions(&created.id, 10).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn expiry_cleanup_erases_expired_memory_revisions() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let mut expiring = input(MemoryScope::Global, None, "A temporary memory that expires");
        expiring.expires_at_ms = Some(now_ms().saturating_sub(1));
        let created = store.remember(expiring).unwrap();
        assert_eq!(store.list_revisions(&created.id, 10).unwrap().len(), 1);
        assert_eq!(store.delete_expired().unwrap(), 1);
        assert!(store.get(&created.id).is_err());
        assert!(store.list_revisions(&created.id, 10).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_can_delete_an_obsolete_page_after_incoming_links_are_removed() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Keep only useful knowledge pages").unwrap();
        let first = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![
                DreamingPage {
                    id: "root-policy".into(), title: "Root policy".into(),
                    summary: "Current root policy".into(), content: "See [obsolete](obsolete-page).".into(),
                    scope: MemoryScope::Global, scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")], links: vec!["obsolete-page".into()],
                },
                DreamingPage {
                    id: "obsolete-page".into(), title: "Obsolete page".into(),
                    summary: "Old material".into(), content: "This can be removed.".into(),
                    scope: MemoryScope::Global, scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")], links: vec![],
                },
            ],
            delete_pages: vec![],
        };
        store.apply_dreaming(first).unwrap();
        let cleanup = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![DreamingPage {
                id: "root-policy".into(), title: "Root policy".into(),
                summary: "Current root policy".into(), content: "Current policy only.".into(),
                scope: MemoryScope::Global, scope_id: None,
                evidence: vec![format!("transcript:{transcript}")], links: vec![],
            }],
            delete_pages: vec![DreamingPageDeletion {
                id: "obsolete-page".into(),
                evidence: vec![format!("transcript:{transcript}")],
            }],
        };
        store.apply_dreaming(cleanup).unwrap();
        assert!(store.get_page("obsolete-page").is_err());
        let revisions = store.list_page_revisions("obsolete-page", 10).unwrap();
        assert_eq!(revisions[0].action, "deleted");
        assert!(revisions[0].after.is_none());
        let restored = store.restore_page_revision("obsolete-page", 1).unwrap();
        assert_eq!(restored.title, "Obsolete page");
        assert_eq!(restored.revision, 3);
        let recreated = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![DreamingPage {
                id: "obsolete-page".into(), title: "Recreated page".into(),
                summary: "Updated knowledge".into(), content: "Recreated after restoration.".into(),
                scope: MemoryScope::Global, scope_id: None,
                evidence: vec![format!("transcript:{transcript}")], links: vec![],
            }],
            delete_pages: vec![],
        };
        store.apply_dreaming(recreated).unwrap();
        assert_eq!(store.get_page("obsolete-page").unwrap().revision, 4);
        assert_eq!(store.list_page_revisions("obsolete-page", 10).unwrap()[0].revision, 4);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dreaming_cannot_delete_pages_with_incoming_links() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let transcript = store.record_transcript("s1", None, None, "user", "Preserve page references").unwrap();
        let first = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![
                DreamingPage {
                    id: "root-policy".into(), title: "Root policy".into(),
                    summary: "Root policy".into(), content: "Root links to child.".into(),
                    scope: MemoryScope::Global, scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")], links: vec!["child-page".into()],
                },
                DreamingPage {
                    id: "child-page".into(), title: "Child page".into(),
                    summary: "Child".into(), content: "Child page.".into(),
                    scope: MemoryScope::Global, scope_id: None,
                    evidence: vec![format!("transcript:{transcript}")], links: vec![],
                },
            ],
            delete_pages: vec![],
        };
        store.apply_dreaming(first).unwrap();
        let deletion = DreamingOutput {
            reviewed_through: transcript,
            notes: vec![],
            pages: vec![],
            delete_pages: vec![DreamingPageDeletion {
                id: "child-page".into(),
                evidence: vec![format!("transcript:{transcript}")],
            }],
        };
        assert!(store.apply_dreaming(deletion).is_err());
        assert!(store.get_page("child-page").is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn old_memory_schema_is_migrated_without_dropping_records() {
        let root = workspace();
        let directory = root.join(".rust-agent");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("memory.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE memories (
            id TEXT PRIMARY KEY NOT NULL, schema_version INTEGER NOT NULL, kind TEXT NOT NULL,
            scope TEXT NOT NULL, scope_id TEXT, content TEXT NOT NULL, source TEXT NOT NULL,
            confidence INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER
        );
        INSERT INTO memories VALUES ('mem-old','1','long_term','global',NULL,'Existing note','host',90,1,1,NULL);").unwrap();
        drop(connection);
        let store = MemoryStore::new(&root).unwrap();
        let record = store.get("mem-old").unwrap();
        assert_eq!(record.content, "Existing note");
        assert_eq!(record.status, MemoryStatus::Consolidated);
        assert!(record.source_refs.is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
