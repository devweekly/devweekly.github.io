use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
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

#[derive(Debug, Clone, Deserialize)]
pub struct DreamingOutput {
    pub reviewed_through: i64,
    #[serde(default)]
    pub notes: Vec<DreamingNote>,
    #[serde(default)]
    pub pages: Vec<DreamingPage>,
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
    pub transcripts_reviewed: usize,
    pub notes_created: usize,
    pub notes_updated: usize,
    pub notes_disputed: usize,
    pub notes_marked_stale: usize,
    pub pages_created: usize,
    pub pages_updated: usize,
    pub reviewed_through: i64,
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
            );",
        )?;

        ensure_memory_column(&connection, "status", "TEXT NOT NULL DEFAULT 'consolidated'")?;
        ensure_memory_column(&connection, "importance", "INTEGER NOT NULL DEFAULT 70")?;
        ensure_memory_column(&connection, "source_refs_json", "TEXT NOT NULL DEFAULT '[]'")?;
        ensure_memory_column(&connection, "access_count", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_memory_column(&connection, "last_accessed_at_ms", "INTEGER")?;
        ensure_column(&connection, "transcripts", "project_id", "TEXT")?;
        ensure_column(&connection, "transcripts", "task_id", "TEXT")?;
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
        self.conn()?.execute(
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
        let changed = self.conn()?.execute(
            "UPDATE memories
             SET content=?2, source=COALESCE(?3,source),
                 confidence=COALESCE(?4,confidence), updated_at_ms=?5
             WHERE id=?1",
            params![id, content, source, confidence, to_i64(now_ms())?],
        )?;
        if changed == 0 {
            return Err(AgentError::InvalidAction(format!("memory record not found: {id}")));
        }
        self.get(id)
    }

    pub fn set_status(&self, id: &str, status: MemoryStatus) -> Result<MemoryRecord, AgentError> {
        Self::validate_id(id)?;
        let changed = self.conn()?.execute(
            "UPDATE memories SET status=?2, updated_at_ms=?3 WHERE id=?1",
            params![id, status.as_str(), to_i64(now_ms())?],
        )?;
        if changed == 0 {
            return Err(AgentError::InvalidAction(format!("memory record not found: {id}")));
        }
        self.get(id)
    }

    pub fn forget(&self, id: &str) -> Result<(), AgentError> {
        Self::validate_id(id)?;
        if self.conn()?.execute("DELETE FROM memories WHERE id=?1", [id])? == 0 {
            return Err(AgentError::InvalidAction(format!("memory record not found: {id}")));
        }
        Ok(())
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
        drop(connection);

        let mut ranked = Vec::new();
        for record in records {
            if !scope_matches(record.scope, record.scope_id.as_deref(), query) {
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

    pub fn count(&self) -> Result<usize, AgentError> {
        let count: i64 = self.conn()?.query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))?;
        usize::try_from(count)
            .map_err(|_| AgentError::InvalidAction("memory count out of range".into()))
    }

    pub fn delete_expired(&self) -> Result<usize, AgentError> {
        Ok(self.conn()?.execute(
            "DELETE FROM memories WHERE expires_at_ms IS NOT NULL AND expires_at_ms<=?1",
            [to_i64(now_ms())?],
        )?)
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
                self.record_transcript(session_id, project_id, None, &message.role, &message.content)?;
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
             WHERE session_id=?1
                OR (?2 IS NOT NULL AND project_id=?2
                    AND ((?3 IS NULL AND task_id IS NULL) OR task_id=?3))
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
        let visible = entry.session_id == session_id
            || (project_id.is_some() && entry.project_id.as_deref() == project_id
                && ((task_id.is_none() && entry.task_id.is_none()) || entry.task_id.as_deref() == task_id));
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
        self.conn()?.query_row(
            "SELECT id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
             FROM memory_pages WHERE id=?1",
            [id],
            row_page,
        ).optional()?.ok_or_else(|| AgentError::InvalidAction(format!("memory page not found: {id}")))
    }

    pub fn list_pages(&self, limit: usize) -> Result<Vec<MemoryPage>, AgentError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            "SELECT id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
             FROM memory_pages ORDER BY updated_at_ms DESC,id LIMIT ?1",
        )?;
        Ok(statement.query_map([limit.clamp(1, 200)], row_page)?
            .collect::<Result<Vec<_>, _>>()?)
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

    /// Apply an offline consolidation pass as one SQLite transaction.
    /// Every new or changed note/page must cite a transcript or an existing memory.
    pub fn apply_dreaming(&self, output: DreamingOutput) -> Result<DreamingReport, AgentError> {
        if output.notes.len() > 32 || output.pages.len() > 16 {
            return Err(AgentError::InvalidAction("dreaming output exceeds operation limits".into()));
        }
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let previous_cursor = transaction.query_row(
            "SELECT value FROM memory_meta WHERE key='last_dreamed_transcript_id'",
            [],
            |row| row.get::<_, String>(0),
        ).optional()?.and_then(|value| value.parse::<i64>().ok()).unwrap_or(0);
        let max_transcript: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(id),0) FROM transcripts",
            [],
            |row| row.get(0),
        )?;
        if output.reviewed_through < previous_cursor || output.reviewed_through > max_transcript {
            return Err(AgentError::InvalidAction("dreaming transcript cursor is outside the available range".into()));
        }

        let mut report = DreamingReport {
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
                    validate_evidence_in_transaction(&transaction, &note.evidence)?;
                    if note.evidence.is_empty() {
                        return Err(AgentError::InvalidAction("dreaming notes require source evidence".into()));
                    }
                    let now = to_i64(now_ms())?;
                    let refs = serde_json::to_string(&note.evidence)?;
                    let status = if note.confidence >= 70 { MemoryStatus::Consolidated } else { MemoryStatus::Proposed };
                    if note.action == "create" {
                        if transaction.query_row(
                            "SELECT EXISTS(SELECT 1 FROM memories WHERE lower(content)=lower(?1) AND scope=?2 AND COALESCE(scope_id,'')=COALESCE(?3,''))",
                            params![note.content.trim(), scope.as_str(), note.scope_id],
                            |row| row.get::<_, bool>(0),
                        )? {
                            continue;
                        }
                        transaction.execute(
                            "INSERT INTO memories (
                                id,schema_version,kind,scope,scope_id,content,source,confidence,
                                created_at_ms,updated_at_ms,expires_at_ms,status,importance,
                                source_refs_json,access_count,last_accessed_at_ms
                            ) VALUES (?1,?2,?3,?4,?5,?6,'dreaming',?7,?8,?8,NULL,?9,?10,?11,0,NULL)",
                            params![
                                new_id(now as u128),
                                SCHEMA_VERSION,
                                kind.as_str(),
                                scope.as_str(),
                                note.scope_id,
                                note.content.trim(),
                                note.confidence,
                                now,
                                status.as_str(),
                                note.importance,
                                refs
                            ],
                        )?;
                        report.notes_created += 1;
                    } else {
                        let id = note.id.as_deref().ok_or_else(|| AgentError::InvalidAction("dreaming update is missing memory ID".into()))?;
                        MemoryStore::validate_id(id)?;
                        let changed = transaction.execute(
                            "UPDATE memories SET kind=?2,scope=?3,scope_id=?4,content=?5,
                                confidence=?6,importance=?7,source='dreaming',source_refs_json=?8,
                                status=?9,updated_at_ms=?10 WHERE id=?1",
                            params![
                                id,kind.as_str(),scope.as_str(),note.scope_id,note.content.trim(),
                                note.confidence,note.importance,refs,status.as_str(),now
                            ],
                        )?;
                        if changed == 0 {
                            return Err(AgentError::InvalidAction(format!("dreaming update references missing memory: {id}")));
                        }
                        report.notes_updated += 1;
                    }
                }
                "dispute" | "stale" => {
                    let id = note.id.as_deref().ok_or_else(|| AgentError::InvalidAction("dreaming review is missing memory ID".into()))?;
                    MemoryStore::validate_id(id)?;
                    validate_evidence_in_transaction(&transaction, &note.evidence)?;
                    if note.evidence.is_empty() {
                        return Err(AgentError::InvalidAction("dreaming reviews require source evidence".into()));
                    }
                    let status = if note.action == "dispute" { MemoryStatus::Disputed } else { MemoryStatus::Stale };
                    let changed = transaction.execute(
                        "UPDATE memories SET status=?2,updated_at_ms=?3 WHERE id=?1",
                        params![id,status.as_str(),to_i64(now_ms())?],
                    )?;
                    if changed == 0 {
                        return Err(AgentError::InvalidAction(format!("dreaming review references missing memory: {id}")));
                    }
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
            validate_evidence_in_transaction(&transaction, &page.evidence)?;
            if page.evidence.is_empty() {
                return Err(AgentError::InvalidAction(format!("dreaming page {} has no source evidence", page.id)));
            }
            for link in &page.links {
                validate_page_id(link)?;
            }
            let refs = serde_json::to_string(&page.evidence)?;
            let links = serde_json::to_string(&page.links)?;
            let now = to_i64(now_ms())?;
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM memory_pages WHERE id=?1)",
                [&page.id],
                |row| row.get(0),
            )?;
            transaction.execute(
                "INSERT INTO memory_pages (
                    id,title,summary,content,scope,scope_id,source_refs_json,links_json,updated_at_ms,revision
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,summary=excluded.summary,content=excluded.content,
                    scope=excluded.scope,scope_id=excluded.scope_id,
                    source_refs_json=excluded.source_refs_json,links_json=excluded.links_json,
                    updated_at_ms=excluded.updated_at_ms,revision=memory_pages.revision+1",
                params![page.id,page.title.trim(),page.summary.trim(),page.content.trim(),page.scope.as_str(),
                    page.scope_id,refs,links,now],
            )?;
            if exists { report.pages_updated += 1; } else { report.pages_created += 1; }
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

fn validate_evidence_in_transaction(transaction: &Transaction<'_>, refs: &[String]) -> Result<(), AgentError> {
    validate_evidence_refs(refs)?;
    for reference in refs {
        let Some((kind, id)) = reference.split_once(':') else {
            return Err(AgentError::InvalidAction(format!("invalid memory evidence reference: {reference}")));
        };
        let exists = match kind {
            "transcript" => {
                let Ok(id) = id.parse::<i64>() else { return Err(AgentError::InvalidAction(format!("invalid transcript reference: {reference}"))); };
                transaction.query_row("SELECT EXISTS(SELECT 1 FROM transcripts WHERE id=?1)", [id], |row| row.get::<_, bool>(0))?
            }
            "memory" => {
                MemoryStore::validate_id(id)?;
                transaction.query_row("SELECT EXISTS(SELECT 1 FROM memories WHERE id=?1)", [id], |row| row.get::<_, bool>(0))?
            }
            _ => return Err(AgentError::InvalidAction(format!("unsupported evidence reference: {reference}"))),
        };
        if !exists {
            return Err(AgentError::InvalidAction(format!("memory evidence does not exist: {reference}")));
        }
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
    fn transcripts_are_searchable_and_cursor_is_monotonic() {
        let root = workspace();
        let store = MemoryStore::new(&root).unwrap();
        let first = store.record_transcript("s1", "user", "Use a bounded context window").unwrap();
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
        };
        let report = store.apply_dreaming(output).unwrap();
        assert_eq!(report.notes_created, 1);
        assert_eq!(report.pages_created, 1);
        assert_eq!(store.last_dreamed_transcript_id().unwrap(), transcript);
        assert_eq!(store.get_page("workspace-policy").unwrap().revision, 1);
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
