// 两个 SQLite 库的打开、迁移与全部表访问。
// novel.db（小说知识库）只由 ingest / analyze 写入；story.db（写作状态）每章重写。
// 所有写操作必须走 transaction；每个调用方独立 open/close，避免长连接锁库。
import {
  BEATS_DEFAULT_LIMIT,
  SQLITE_BUSY_RETRY_ATTEMPTS,
  SQLITE_BUSY_WAIT_MS,
  KB_DEFAULT_LIMIT,
  KB_FORESHADOWING_DEFAULT_LIMIT,
  OBSERVATIONS_DEFAULT_LIMIT
} from "./constants.js";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StoryState } from "./story-state.js";

export interface DatabaseStatus {
  path: string; schemaVersion: number;
  statePath: string; stateSchemaVersion: number;
  annotations: number; entities: number; entityMentions: number;
  characters: number; canonFacts: number; events: number; plotThreads: number;
  storyAnalysis: number;
  novelChapters: number; novelCharacters: number; novelMentions: number; novelThreads: number;
  novelForeshadowings: number; novelBeats: number; novelRelations: number; novelArcs: number;
  novelCharacterProfiles: number; novelCharacterChapterStates: number;
  storyMemories: number;
}

// ── 并发与事务基础 ────────────────────────────────────────────

/** 分析分片与读者进程会竞争写锁；默认 PRAGMA 之外的冲突按固定节奏重试而不是直接失败。 */
function retryBusy<T>(work: () => T, attempts = SQLITE_BUSY_RETRY_ATTEMPTS): T {
  for (let attempt = 0;; attempt++) {
    try {
      return work();
    } catch (error) {
      const message = String((error as Error).message ?? error);
      if (!/database is locked|SQLITE_BUSY|database table is locked/i.test(message) || attempt >= attempts - 1) throw error;
      // Atomics.wait 是同步让出：db 调用本身是阻塞 API，await sleep 无处安放。
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SQLITE_BUSY_WAIT_MS);
    }
  }
}

function execWithRetry(db: DatabaseSync, sql: string): void {
  retryBusy(() => db.exec(sql));
}

/**
 * IMMEDIATE 事务先取得写保留锁，再执行同步 DB callback。只重试 BEGIN/COMMIT；
 * 不在同一事务里重放 work()，因为它可能已执行部分写入或修改闭包状态。work 失败时
 * 整体回滚并交给调用方处理；需要业务级重试时必须重试整个幂等操作，而不是 callback。
 */
function transaction<T>(db: DatabaseSync, work: () => T): T {
  retryBusy(() => db.exec("BEGIN IMMEDIATE"));
  try {
    const result = work();
    retryBusy(() => db.exec("COMMIT"));
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* 提交失败时事务可能已结束 */ }
    throw error;
  }
}

// ── 数据库身份与结构版本 ─────────────────────────────────────

const KNOWLEDGE_DATABASE_FILE = "novel.db";
const STATE_DATABASE_FILE = "story.db";

/** 知识库结构版本：只有 ingest / analyze 会改它。 */
const KNOWLEDGE_SCHEMA_VERSION = 9;
/** v6 之前的库把分片文本整份复制进来，与 library/index.json 重复；升级时删掉。 */
const LEGACY_CHUNK_TABLES = ["library_chunks"];
/** 图谱是快照 `storyGraph` 的规范化副本，只被写入、没有任何读者；v7 起只保留快照里的那份。 */
const LEGACY_GRAPH_TABLES = ["story_graph_nodes", "story_graph_edges"];
/** 写作状态结构版本：与知识库分开演进。 */
const STATE_SCHEMA_VERSION = 2;
/** v4 之前状态表与知识表同库，迁移时按这个顺序搬。 */
const LEGACY_STATE_TABLES = ["story_state", "characters", "canon_facts", "story_events", "plot_threads", "continuity_notes"];

// 写作状态库（story.db）的建表语句。每章都会整体重写这些表，体积保持在几十 KB。
const STATE_TABLES = [
  "CREATE TABLE IF NOT EXISTS world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS story_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),updated_at TEXT NOT NULL,payload_json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS characters(name TEXT PRIMARY KEY,status TEXT NOT NULL,location TEXT,profile_json TEXT,payload_json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_characters_location ON characters(location)",
  "CREATE TABLE IF NOT EXISTS canon_facts(id TEXT PRIMARY KEY,fact TEXT NOT NULL,confidence TEXT NOT NULL,source TEXT)",
  "CREATE TABLE IF NOT EXISTS story_events(id TEXT PRIMARY KEY,summary TEXT NOT NULL,position TEXT NOT NULL,payload_json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_story_events_position ON story_events(position)",
  "CREATE TABLE IF NOT EXISTS plot_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,last_updated TEXT NOT NULL,notes TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_plot_threads_status ON plot_threads(status)",
  "CREATE TABLE IF NOT EXISTS continuity_notes(ordinal INTEGER PRIMARY KEY,note TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS story_memories(memory_id TEXT PRIMARY KEY,memory_type TEXT NOT NULL,content TEXT NOT NULL,scope TEXT NOT NULL,evidence_json TEXT NOT NULL,occurrences INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_seen_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_story_memories_status_type ON story_memories(status,memory_type)"
].join(";\n") + ";";

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

/**
 * 旧库里状态表与知识表同库：首次创建 story.db 时把行搬过来，搬完删掉旧表。
 * 留下旧表会让「状态到底存在哪」变成两个答案，之后读到的可能是过期副本。
 */
function adoptLegacyState(worldDir: string, target: DatabaseSync): void {
  const legacyPath = join(worldDir, KNOWLEDGE_DATABASE_FILE);
  if (!existsSync(legacyPath)) return;
  let legacy: DatabaseSync;
  try { legacy = new DatabaseSync(legacyPath); } catch { return; }
  try {
    if (!tableExists(legacy, "story_state")) return;
    const rows = (table: string) => tableExists(legacy, table)
      ? legacy.prepare("SELECT * FROM " + table).all() as Array<Record<string, unknown>>
      : [];
    const stateRows = rows("story_state");
    const characterRows = rows("characters");
    const factRows = rows("canon_facts");
    const eventRows = rows("story_events");
    const threadRows = rows("plot_threads");
    const noteRows = rows("continuity_notes");
    transaction(target, () => {
      for (const row of stateRows) {
        target.prepare(
          "INSERT INTO story_state(singleton,updated_at,payload_json) VALUES(?,?,?) "+
          "ON CONFLICT(singleton) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json"
        ).run(Number(row.singleton), String(row.updated_at), String(row.payload_json));
      }
      const qc = target.prepare("INSERT OR REPLACE INTO characters(name,status,location,profile_json,payload_json) VALUES(?,?,?,?,?)");
      for (const row of characterRows) {
        qc.run(
          String(row.name), String(row.status),
          row.location == null ? null : String(row.location),
          row.profile_json == null ? null : String(row.profile_json),
          String(row.payload_json)
        );
      }
      const qf = target.prepare("INSERT OR REPLACE INTO canon_facts(id,fact,confidence,source) VALUES(?,?,?,?)");
      for (const row of factRows) {
        qf.run(String(row.id), String(row.fact), String(row.confidence), row.source == null ? null : String(row.source));
      }
      const qe = target.prepare("INSERT OR REPLACE INTO story_events(id,summary,position,payload_json) VALUES(?,?,?,?)");
      for (const row of eventRows) {
        qe.run(String(row.id), String(row.summary), String(row.position), String(row.payload_json));
      }
      const qp = target.prepare("INSERT OR REPLACE INTO plot_threads(id,title,status,last_updated,notes) VALUES(?,?,?,?,?)");
      for (const row of threadRows) {
        qp.run(String(row.id), String(row.title), String(row.status), String(row.last_updated), String(row.notes));
      }
      const qn = target.prepare("INSERT OR REPLACE INTO continuity_notes(ordinal,note) VALUES(?,?)");
      for (const row of noteRows) qn.run(Number(row.ordinal), String(row.note));
    });
    for (const table of LEGACY_STATE_TABLES) legacy.exec("DROP TABLE IF EXISTS " + table);
    console.log("[database] 已把写作状态从 " + KNOWLEDGE_DATABASE_FILE + " 迁到 " + STATE_DATABASE_FILE + "（" + stateRows.length + " 份状态快照）");
  } catch (error) {
    // 迁移失败不能让章节写不进去：保留旧表，下次打开再试。
    console.warn("[database] 旧状态表迁移未完成：" + String(error));
  } finally {
    legacy.close();
  }
}

function openStateDatabase(worldDir: string, worldId: string): DatabaseSync {
  mkdirSync(worldDir, { recursive: true });
  const path = join(worldDir, STATE_DATABASE_FILE);
  const fresh = !existsSync(path);
  const db = new DatabaseSync(path);
  execWithRetry(db, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  execWithRetry(db, STATE_TABLES);
  const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (version > STATE_SCHEMA_VERSION) {
    db.close();
    throw new Error("Story state database schema is newer than this application supports: " + version);
  }
  const stored = db.prepare("SELECT value FROM world_meta WHERE key='world_id'").get() as { value: string } | undefined;
  if (stored && stored.value !== worldId) {
    db.close();
    throw new Error("Story state database world mismatch: expected " + worldId + ", found " + stored.value);
  }
  if (version < STATE_SCHEMA_VERSION) retryBusy(() => db.exec("PRAGMA user_version=" + STATE_SCHEMA_VERSION));
  if (!stored) retryBusy(() => db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?)").run(worldId));
  if (fresh) adoptLegacyState(worldDir, db);
  return db;
}

// 知识库（novel.db）的建表语句。一条 exec 一次性执行，保证结构升级的原子观感；
// 语句按表分组书写，新增结构版本时在对应分组追加并递增 KNOWLEDGE_SCHEMA_VERSION。
const KNOWLEDGE_TABLES = [
  // 世界归属
  "CREATE TABLE IF NOT EXISTS world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  // 逐片段人物/事件/关系候选标注（analyze 的三态断点续跑存 annotations.json，这里存交付态）
  "CREATE TABLE IF NOT EXISTS annotations(chunk_id TEXT PRIMARY KEY,source TEXT NOT NULL,chapter TEXT NOT NULL,extracted_at TEXT NOT NULL,payload_json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_annotations_source ON annotations(source)",
  // 实体注册表与逐片段证据
  "CREATE TABLE IF NOT EXISTS entities(entity_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,aliases_json TEXT NOT NULL,mention_count INTEGER NOT NULL,payload_json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)",
  "CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities(type,name)",
  "CREATE TABLE IF NOT EXISTS entity_mentions(entity_id TEXT NOT NULL,chunk_id TEXT NOT NULL,source TEXT NOT NULL,chapter TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(entity_id,chunk_id,evidence),FOREIGN KEY(entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_entity_mentions_chunk ON entity_mentions(chunk_id)",
  // 全书分析快照（v6）：单行整份 JSON，图谱等派生视图都在 payload 里
  "CREATE TABLE IF NOT EXISTS story_analysis(singleton INTEGER PRIMARY KEY CHECK(singleton=1),world_id TEXT NOT NULL,source_hash TEXT NOT NULL,analyzed_at TEXT NOT NULL,payload_json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS novel_kb_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  // 章节目录
  "CREATE TABLE IF NOT EXISTS novel_chapters(chapter_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,ordinal INTEGER NOT NULL,volume INTEGER NOT NULL,printed_number INTEGER,title TEXT NOT NULL,label TEXT NOT NULL,start_line INTEGER,char_count INTEGER NOT NULL,chunk_start INTEGER NOT NULL,chunk_end INTEGER NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_chapters_ordinal ON novel_chapters(ordinal)",
  "CREATE INDEX IF NOT EXISTS idx_novel_chapters_volume ON novel_chapters(volume)",
  // 人物与小传
  "CREATE TABLE IF NOT EXISTS novel_characters(character_id TEXT PRIMARY KEY,name TEXT NOT NULL,aliases_json TEXT NOT NULL,role TEXT NOT NULL DEFAULT '',bio TEXT NOT NULL DEFAULT '',voice TEXT NOT NULL DEFAULT '',personality_json TEXT NOT NULL DEFAULT '[]',desires_json TEXT NOT NULL DEFAULT '[]',contradictions_json TEXT NOT NULL DEFAULT '[]',arc_json TEXT NOT NULL DEFAULT '[]',first_chapter INTEGER,last_chapter INTEGER,chapters_seen INTEGER NOT NULL DEFAULT 0,mention_total INTEGER NOT NULL DEFAULT 0,source_refs_json TEXT NOT NULL DEFAULT '[]',source TEXT NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_characters_name ON novel_characters(name)",
  "CREATE TABLE IF NOT EXISTS novel_mentions(chapter_id TEXT NOT NULL,name TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(chapter_id,name),FOREIGN KEY(chapter_id) REFERENCES novel_chapters(chapter_id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_novel_mentions_name ON novel_mentions(name)",
  // 主线/支线、伏笔、章级事件、人物关系
  "CREATE TABLE IF NOT EXISTS novel_plot_threads(thread_id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT '未能判断',summary TEXT NOT NULL DEFAULT '',key_turns_json TEXT NOT NULL DEFAULT '[]',unresolved_json TEXT NOT NULL DEFAULT '[]',first_chapter INTEGER,last_chapter INTEGER,source_refs_json TEXT NOT NULL DEFAULT '[]')",
  "CREATE TABLE IF NOT EXISTS novel_foreshadowings(clue_id TEXT PRIMARY KEY,clue TEXT NOT NULL,first_appearance TEXT NOT NULL DEFAULT '',meaning TEXT NOT NULL DEFAULT '',payoffs_json TEXT NOT NULL DEFAULT '[]',confidence TEXT NOT NULL DEFAULT '不确定',status TEXT NOT NULL DEFAULT '未判断',chapter_ordinal INTEGER,source_refs_json TEXT NOT NULL DEFAULT '[]')",
  "CREATE INDEX IF NOT EXISTS idx_novel_foreshadowings_status ON novel_foreshadowings(status)",
  "CREATE TABLE IF NOT EXISTS novel_beats(beat_id TEXT PRIMARY KEY,chapter_id TEXT NOT NULL,chapter_ordinal INTEGER,summary TEXT NOT NULL,actors_json TEXT NOT NULL DEFAULT '[]',source_refs_json TEXT NOT NULL DEFAULT '[]')",
  "CREATE INDEX IF NOT EXISTS idx_novel_beats_chapter ON novel_beats(chapter_ordinal)",
  "CREATE TABLE IF NOT EXISTS novel_relations(relation_id TEXT PRIMARY KEY,from_name TEXT NOT NULL,to_name TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL DEFAULT '',chapter_ordinal INTEGER)",
  "CREATE INDEX IF NOT EXISTS idx_novel_relations_from ON novel_relations(from_name)",
  // 逐批观察合并后的人物档案
  "CREATE TABLE IF NOT EXISTS novel_character_profiles(character_id TEXT PRIMARY KEY,name TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',stages_json TEXT NOT NULL DEFAULT '[]',traits_json TEXT NOT NULL DEFAULT '[]',contradictions_json TEXT NOT NULL DEFAULT '[]',arc_json TEXT NOT NULL DEFAULT '[]',observation_count INTEGER NOT NULL DEFAULT 0,model TEXT NOT NULL DEFAULT '',generated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_novel_character_profiles_name ON novel_character_profiles(name)",
  // 原著人物逐章状态快照
  "CREATE TABLE IF NOT EXISTS novel_character_chapter_states(character_id TEXT NOT NULL,name TEXT NOT NULL,chapter_id TEXT NOT NULL,chapter_ordinal INTEGER NOT NULL,chapter_title TEXT NOT NULL,volume INTEGER NOT NULL,source_hash TEXT NOT NULL,model TEXT NOT NULL,generated_at TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(character_id,chapter_id))",
  "CREATE INDEX IF NOT EXISTS idx_character_chapter_states_chapter ON novel_character_chapter_states(chapter_ordinal)",
  // 卷级梗概
  "CREATE TABLE IF NOT EXISTS novel_arcs(volume INTEGER PRIMARY KEY,title TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',key_turns_json TEXT NOT NULL DEFAULT '[]',characters_json TEXT NOT NULL DEFAULT '[]',generated_at TEXT NOT NULL)"
].join(";\n") + ";";

/**
 * Older novel.db files may contain a minimal novel_chapters table created
 * before stable catalog IDs and full chapter provenance were introduced.
 * CREATE TABLE IF NOT EXISTS does not evolve an existing SQLite table, so
 * explicitly add the columns required by the current indexer.
 */
function ensureNovelChapterSchema(db: DatabaseSync, worldId: string): void {
  if (!tableExists(db, "novel_chapters")) return;
  const columns = new Set(
    (db.prepare("PRAGMA table_info(novel_chapters)").all() as Array<{ name: string }>).map(column => column.name)
  );
  const additions: Array<[string, string]> = [
    ["world_id", "TEXT NOT NULL DEFAULT ''"],
    ["printed_number", "INTEGER"],
    ["label", "TEXT NOT NULL DEFAULT ''"],
    ["start_line", "INTEGER"],
    ["char_count", "INTEGER NOT NULL DEFAULT 0"],
    ["chunk_start", "INTEGER NOT NULL DEFAULT 0"],
    ["chunk_end", "INTEGER NOT NULL DEFAULT 0"]
  ];
  for (const [name, declaration] of additions) {
    if (!columns.has(name)) db.exec("ALTER TABLE novel_chapters ADD COLUMN " + name + " " + declaration);
  }
  db.prepare("UPDATE novel_chapters SET world_id=? WHERE world_id IS NULL OR world_id=''").run(worldId);
  if (columns.has("title")) {
    db.exec("UPDATE novel_chapters SET label=title WHERE label IS NULL OR label=''");
  }
}

function openKnowledgeDatabase(worldDir: string, worldId: string): DatabaseSync {
  mkdirSync(worldDir, { recursive: true });
  const db = new DatabaseSync(join(worldDir, KNOWLEDGE_DATABASE_FILE));
  execWithRetry(db, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  execWithRetry(db, KNOWLEDGE_TABLES);
  ensureNovelChapterSchema(db, worldId);
  const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (version > KNOWLEDGE_SCHEMA_VERSION) {
    db.close();
    throw new Error("Novel database schema is newer than this application supports: " + version);
  }
  const stored = db.prepare("SELECT value FROM world_meta WHERE key='world_id'").get() as { value: string } | undefined;
  if (stored && stored.value !== worldId) {
    db.close();
    throw new Error("SQLite database world mismatch: expected " + worldId + ", found " + stored.value);
  }
  if (version < KNOWLEDGE_SCHEMA_VERSION) {
    retryBusy(() => transaction(db, () => {
      // 分片唯一来源是 library/index.json；库里的副本是同一份文本，删掉不影响检索。
      for (const table of LEGACY_CHUNK_TABLES) db.exec("DROP TABLE IF EXISTS " + table);
      for (const table of LEGACY_GRAPH_TABLES) db.exec("DROP TABLE IF EXISTS " + table);
      db.exec("PRAGMA user_version=" + KNOWLEDGE_SCHEMA_VERSION);
    }));
  }
  if (!stored) retryBusy(() => db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?)").run(worldId));
  return db;
}

export function openWorldDatabase(worldDir: string, worldId: string): DatabaseSync {
  return openKnowledgeDatabase(worldDir, worldId);
}

/** 写作状态库（story.db）：查错和导出 schema 时单独打开。 */
export function openStoryStateDatabase(worldDir: string, worldId: string): DatabaseSync {
  return openStateDatabase(worldDir, worldId);
}

/**
 * 语料变更后，按旧文本算出来的章节切分与分析全部作废。
 * 只清派生数据，不动 novel.db 里那份权威快照之外的任何东西。
 */
/** Invalidate corpus-derived analysis while preserving the stable chapter directory. */
export function invalidateStoryAnalysis(worldDir: string, worldId: string): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM story_analysis;");
      clearNovelAnalysis(db);
    });
  } finally {
    db.close();
  }
}

export function invalidateDerivedAnalysis(worldDir: string, worldId: string): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM story_analysis; DELETE FROM novel_chapters;");
      clearNovelAnalysis(db);
    });
  } finally {
    db.close();
  }
}

// ── 标注与实体注册表 ─────────────────────────────────────────

type AnnotationRow = { chunkId: string; source: string; chapter?: string; extractedAt?: string };
type RegistryData = { entities: Array<{ id: string; name: string; type: string; aliases: string[]; mentions: Array<{ chunkId: string; source: string; chapter: string; evidence: string }> }> };

/** 重新导入语料后整体替换标注；注册表（可选）与其逐片段证据一并重建。 */
export function syncAnnotations(worldDir: string, worldId: string, annotations: AnnotationRow[], registry?: RegistryData | null): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM annotations; DELETE FROM entity_mentions; DELETE FROM entities;");
      const qa = db.prepare("INSERT INTO annotations(chunk_id,source,chapter,extracted_at,payload_json) VALUES(?,?,?,?,?)");
      for (const a of annotations) qa.run(a.chunkId, a.source, a.chapter ?? "", a.extractedAt ?? "", JSON.stringify(a));
      if (registry) {
        const qe = db.prepare("INSERT INTO entities(entity_id,name,type,aliases_json,mention_count,payload_json) VALUES(?,?,?,?,?,?)");
        const qm = db.prepare("INSERT OR IGNORE INTO entity_mentions(entity_id,chunk_id,source,chapter,evidence) VALUES(?,?,?,?,?)");
        for (const e of registry.entities) {
          qe.run(e.id, e.name, e.type, JSON.stringify(e.aliases), e.mentions.length, JSON.stringify(e));
          for (const m of e.mentions) qm.run(e.id, m.chunkId, m.source, m.chapter, m.evidence);
        }
      }
    });
  } finally {
    db.close();
  }
}

/**
 * 按 chunk 读取标注。库为空时先用 library/annotations.json 兜底回填，
 * 让尚未跑过 analyze 的世界也能在检索结果上给出证据。
 */
export function readAnnotationsByChunkIds(worldDir: string, worldId: string, ids: string[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  if (!ids.length) return result;
  const probe = openKnowledgeDatabase(worldDir, worldId);
  let annotationCount: number;
  try {
    annotationCount = Number((probe.prepare("SELECT COUNT(*) AS count FROM annotations").get() as { count: number }).count);
  } finally {
    probe.close();
  }
  if (annotationCount === 0) {
    try {
      const legacy = JSON.parse(readFileSync(join(worldDir, "library", "annotations.json"), "utf8")) as { annotations?: AnnotationRow[] };
      let registry: RegistryData | null = null;
      try {
        registry = JSON.parse(readFileSync(join(worldDir, "library", "entities.json"), "utf8")) as RegistryData;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (legacy.annotations?.length || registry?.entities.length) syncAnnotations(worldDir, worldId, legacy.annotations ?? [], registry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const q = db.prepare("SELECT chunk_id,payload_json FROM annotations WHERE chunk_id=?");
    for (const id of ids) {
      const row = q.get(id) as { chunk_id: string; payload_json: string } | undefined;
      if (row) result.set(row.chunk_id, JSON.parse(row.payload_json) as Record<string, unknown>);
    }
    return result;
  } finally {
    db.close();
  }
}

// ── 写作状态库读写 ───────────────────────────────────────────

/** 整体替换 story.db 里的写作状态；knowledge 值库先做一次世界归属校验。 */
export function syncStoryState(worldDir: string, state: StoryState): void {
  // 同时校验知识库的世界归属：两个文件必须属于同一个世界
  openKnowledgeDatabase(worldDir, state.worldId).close();
  const db = openStateDatabase(worldDir, state.worldId);
  try {
    transaction(db, () => {
      db.prepare(
        "INSERT INTO story_state(singleton,updated_at,payload_json) VALUES(1,?,?) "+
        "ON CONFLICT(singleton) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json"
      ).run(state.updatedAt, JSON.stringify(state));
      db.exec("DELETE FROM characters; DELETE FROM canon_facts; DELETE FROM story_events; DELETE FROM plot_threads; DELETE FROM continuity_notes;");
      const qc = db.prepare("INSERT INTO characters(name,status,location,profile_json,payload_json) VALUES(?,?,?,?,?)");
      for (const x of state.characters) qc.run(x.name, x.status, x.location ?? null, x.profile ? JSON.stringify(x.profile) : null, JSON.stringify(x));
      const qf = db.prepare("INSERT INTO canon_facts(id,fact,confidence,source) VALUES(?,?,?,?)");
      for (const x of state.canonFacts) qf.run(x.id, x.fact, x.confidence, x.source ?? null);
      const qe = db.prepare("INSERT INTO story_events(id,summary,position,payload_json) VALUES(?,?,?,?)");
      for (const x of state.events) qe.run(x.id, x.summary, x.position, JSON.stringify(x));
      const qp = db.prepare("INSERT INTO plot_threads(id,title,status,last_updated,notes) VALUES(?,?,?,?,?)");
      for (const x of state.plotThreads) qp.run(x.id, x.title, x.status, x.lastUpdated, x.notes);
      const qn = db.prepare("INSERT INTO continuity_notes(ordinal,note) VALUES(?,?)");
      state.continuityNotes.forEach((x, i) => qn.run(i, x));
    });
  } finally {
    db.close();
  }
}

export function readStoryState(worldDir: string, worldId: string): StoryState | undefined {
  const db = openStateDatabase(worldDir, worldId);
  try {
    const row = db.prepare("SELECT payload_json FROM story_state WHERE singleton=1").get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as StoryState : undefined;
  } finally {
    db.close();
  }
}


export type StoryMemoryType = "narrative" | "creative" | "operational";
export interface StoryMemoryEvidence { runId: string; quote: string; source: string; }
export interface StoryMemoryRow {
  memoryId: string; memoryType: StoryMemoryType; content: string; scope: string;
  evidence: StoryMemoryEvidence[]; occurrences: number; status: "candidate" | "active" | "superseded" | "rejected";
  createdAt: string; updatedAt: string; lastSeenAt: string;
}

/** Store only evidence-backed tacit experience; repeated independent runs promote a candidate. */
export function recordStoryMemoryCandidates(
  worldDir: string, worldId: string,
  candidates: Array<{ memoryId: string; memoryType: StoryMemoryType; content: string; scope?: string; evidence: StoryMemoryEvidence }>
): number {
  const db = openStateDatabase(worldDir, worldId);
  const now = new Date().toISOString();
  let changed = 0;
  try {
    transaction(db, () => {
      const get = db.prepare("SELECT evidence_json,occurrences,status FROM story_memories WHERE memory_id=?");
      const put = db.prepare(
        "INSERT INTO story_memories(memory_id,memory_type,content,scope,evidence_json,occurrences,status,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,1,'candidate',?,?,?) " +
        "ON CONFLICT(memory_id) DO UPDATE SET evidence_json=excluded.evidence_json,occurrences=excluded.occurrences,status=CASE WHEN excluded.occurrences>=2 AND story_memories.status='candidate' THEN 'active' ELSE story_memories.status END,updated_at=excluded.updated_at,last_seen_at=excluded.last_seen_at"
      );
      for (const candidate of candidates) {
        if (!candidate.memoryId || !candidate.content.trim() || !candidate.evidence.quote.trim() || !candidate.evidence.runId.trim()) continue;
        const old = get.get(candidate.memoryId) as { evidence_json: string; occurrences: number; status: string } | undefined;
        const evidence = old ? JSON.parse(old.evidence_json) as StoryMemoryEvidence[] : [];
        if (evidence.some(item => item.runId === candidate.evidence.runId)) continue;
        const next = [...evidence, candidate.evidence];
        const occurrences = next.length;
        if (old) {
          db.prepare("UPDATE story_memories SET evidence_json=?,occurrences=?,status=CASE WHEN ? >= 2 AND status='candidate' THEN 'active' ELSE status END,updated_at=?,last_seen_at=? WHERE memory_id=?")
            .run(JSON.stringify(next), occurrences, occurrences, now, now, candidate.memoryId);
        } else {
          put.run(candidate.memoryId, candidate.memoryType, candidate.content.trim(), candidate.scope?.trim() ?? "world", JSON.stringify(next), now, now, now);
        }
        changed++;
      }
    });
    return changed;
  } finally { db.close(); }
}

/** User review edits tacit knowledge without changing its provenance trail. */
export function updateStoryMemory(
  worldDir: string, worldId: string, memoryId: string,
  update: { content?: string; scope?: string; status?: StoryMemoryRow["status"] }
): StoryMemoryRow | undefined {
  const db = openStateDatabase(worldDir, worldId);
  try {
    const current = db.prepare("SELECT occurrences FROM story_memories WHERE memory_id=?").get(memoryId) as { occurrences: number } | undefined;
    if (!current) return undefined;
    if (update.status === "active" && current.occurrences < 2) throw new Error("A memory needs evidence from at least two independent story executions before activation.");
    const sets: string[] = ["updated_at=?"];
    const values: string[] = [new Date().toISOString()];
    if (update.content !== undefined) { sets.push("content=?"); values.push(update.content.trim()); }
    if (update.scope !== undefined) { sets.push("scope=?"); values.push(update.scope.trim()); }
    if (update.status !== undefined) { sets.push("status=?"); values.push(update.status); }
    values.push(memoryId);
    db.prepare("UPDATE story_memories SET " + sets.join(",") + " WHERE memory_id=?").run(...values);
  } finally { db.close(); }
  return listStoryMemories(worldDir, worldId, "all").find(item => item.memoryId === memoryId);
}

export function listStoryMemories(worldDir: string, worldId: string, status: StoryMemoryRow["status"] | "all" = "active"): StoryMemoryRow[] {
  const db = openStateDatabase(worldDir, worldId);
  try {
    const rows = status === "all"
      ? db.prepare("SELECT * FROM story_memories ORDER BY occurrences DESC,last_seen_at DESC").all()
      : db.prepare("SELECT * FROM story_memories WHERE status=? ORDER BY occurrences DESC,last_seen_at DESC").all(status);
    return (rows as Array<Record<string, unknown>>).map(row => ({
      memoryId: String(row.memory_id), memoryType: String(row.memory_type) as StoryMemoryType,
      content: String(row.content), scope: String(row.scope),
      evidence: JSON.parse(String(row.evidence_json)) as StoryMemoryEvidence[],
      occurrences: Number(row.occurrences), status: String(row.status) as StoryMemoryRow["status"],
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), lastSeenAt: String(row.last_seen_at)
    }));
  } finally { db.close(); }
}

// ── 全书分析快照 ─────────────────────────────────────────────

export interface StoryAnalysisSnapshot {
  worldId: string;
  sourceHash: string;
  analyzedAt: string;
  analysisVersion?: number;
  complete: boolean;
  batches: number;
  /** Reproducibility metadata for the batch cache that produced this snapshot. */
  analysisModel?: string;
  analysisMaxChars?: number;
  analysisPromptTag?: string;
  /** Present when this snapshot is bounded to a historical universe entry. */
  sourceWorldId?: string;
  asOfEntryChapter?: string;
  asOfEntryChapterId?: string;
  asOfEntryOrdinal?: number;
  characters: Array<Record<string, unknown>>;
  plotThreads: Array<Record<string, unknown>>;
  foreshadowings: Array<Record<string, unknown>>;
  developmentPossibilities: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
  storyCore?: Record<string, unknown>;
  storyCoreObservations?: Array<Record<string, unknown>>;
  macguffins?: Array<Record<string, unknown>>;
  storyGraph?: {
    nodes: Array<{ id: string; type: string; label: string; data: Record<string, unknown>; sourceRefs?: unknown[] }>;
    edges: Array<{ id: string; from: string; to: string; type: string; label: string; data: Record<string, unknown>; sourceRefs?: unknown[] }>;
  };
}

export function saveStoryAnalysis(worldDir: string, worldId: string, snapshot: StoryAnalysisSnapshot): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    if (snapshot.worldId !== worldId) throw new Error("Story analysis world mismatch: " + worldId);
    transaction(db, () => {
      db.prepare(
        "INSERT INTO story_analysis(singleton,world_id,source_hash,analyzed_at,payload_json) VALUES(1,?,?,?,?) "+
        "ON CONFLICT(singleton) DO UPDATE SET world_id=excluded.world_id,source_hash=excluded.source_hash,analyzed_at=excluded.analyzed_at,payload_json=excluded.payload_json"
      ).run(worldId, snapshot.sourceHash, snapshot.analyzedAt, JSON.stringify(snapshot));
    });
  } finally {
    db.close();
  }
}

export function readStoryAnalysis(worldDir: string, worldId: string): StoryAnalysisSnapshot | undefined {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const row = db.prepare("SELECT payload_json FROM story_analysis WHERE singleton=1 AND world_id=?").get(worldId) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as StoryAnalysisSnapshot : undefined;
  } finally {
    db.close();
  }
}

// ── 状态汇总 ─────────────────────────────────────────────────

function countRows(db: DatabaseSync, table: string): number {
  return Number((db.prepare("SELECT COUNT(*) AS count FROM " + table).get() as { count: number }).count);
}

function schemaVersionOf(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

export function databaseStatus(worldDir: string, worldId: string): DatabaseStatus {
  const knowledge = openKnowledgeDatabase(worldDir, worldId);
  const state = openStateDatabase(worldDir, worldId);
  try {
    return {
      path: join(worldDir, KNOWLEDGE_DATABASE_FILE),
      schemaVersion: schemaVersionOf(knowledge),
      statePath: join(worldDir, STATE_DATABASE_FILE),
      stateSchemaVersion: schemaVersionOf(state),
      annotations: countRows(knowledge, "annotations"),
      entities: countRows(knowledge, "entities"),
      entityMentions: countRows(knowledge, "entity_mentions"),
      storyAnalysis: countRows(knowledge, "story_analysis"),
      novelChapters: countRows(knowledge, "novel_chapters"),
      novelCharacters: countRows(knowledge, "novel_characters"),
      novelMentions: countRows(knowledge, "novel_mentions"),
      novelThreads: countRows(knowledge, "novel_plot_threads"),
      novelForeshadowings: countRows(knowledge, "novel_foreshadowings"),
      novelBeats: countRows(knowledge, "novel_beats"),
      novelRelations: countRows(knowledge, "novel_relations"),
      novelArcs: countRows(knowledge, "novel_arcs"),
      novelCharacterProfiles: countRows(knowledge, "novel_character_profiles"),
      novelCharacterChapterStates: countRows(knowledge, "novel_character_chapter_states"),
      characters: countRows(state, "characters"),
      canonFacts: countRows(state, "canon_facts"),
      events: countRows(state, "story_events"),
      plotThreads: countRows(state, "plot_threads"),
      storyMemories: countRows(state, "story_memories")
    };
  } finally {
    knowledge.close();
    state.close();
  }
}

export function databaseWorldDirFromLibrary(libraryDir: string): string {
  return dirname(libraryDir);
}

// ── 知识库（novel_*）行类型 ─────────────────────────────────

/** Corpus knowledge base rows. These describe the finished novel, not the writing state. */
export interface NovelSourceRef { chunkId?: string; chapterId?: string; source?: string; chapter?: string; volume?: number }
export interface NovelChapterRow { chapterId: string; ordinal: number; volume: number; printedNumber: number | null; title: string; label: string; startLine: number | null; charCount: number; chunkStart: number; chunkEnd: number; }
/** 典型人物收藏行；数组和来源引用以 JSON 字符串落库，读出时解析。 */
export interface NovelCharacterRow {
  characterId: string; name: string; aliases: string[];
  role: string; bio: string; voice: string;
  personality: string[]; desires: string[]; contradictions: string[]; arc: string[];
  firstChapter: number | null; lastChapter: number | null;
  sourceRefs: NovelSourceRef[]; source: string;
}
export interface NovelThreadRow { threadId: string; title: string; status: string; summary: string; keyTurns: string[]; unresolved: string[]; firstChapter: number | null; lastChapter: number | null; sourceRefs: NovelSourceRef[]; }
export interface NovelForeshadowingRow { clueId: string; clue: string; firstAppearance: string; meaning: string; payoffs: string[]; confidence: string; status: string; chapterOrdinal: number | null; sourceRefs: NovelSourceRef[]; }
export interface NovelBeatRow { beatId: string; chapterId: string; chapterOrdinal: number | null; summary: string; actors: string[]; sourceRefs: NovelSourceRef[]; }
export interface NovelRelationRow { relationId: string; fromName: string; toName: string; label: string; evidence: string; chapterOrdinal: number | null; }

/** 清空全部 novel_* 派生表；语料重新索引与重新分析共用。 */
function clearNovelAnalysis(db: DatabaseSync): void {
  db.exec(
    "DELETE FROM novel_characters; DELETE FROM novel_mentions; DELETE FROM novel_plot_threads; "+
    "DELETE FROM novel_foreshadowings; DELETE FROM novel_beats; DELETE FROM novel_relations; DELETE FROM novel_kb_meta;"
  );
}

export function syncNovelChapters(worldDir: string, worldId: string, chapters: NovelChapterRow[]): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM novel_chapters;");
      const q = db.prepare("INSERT INTO novel_chapters(chapter_id,world_id,ordinal,volume,printed_number,title,label,start_line,char_count,chunk_start,chunk_end) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
      for (const c of chapters) {
        q.run(c.chapterId, worldId, c.ordinal, c.volume, c.printedNumber, c.title, c.label, c.startLine, c.charCount, c.chunkStart, c.chunkEnd);
      }
    });
  } finally {
    db.close();
  }
}

/** 章级人物提拨计数入库，并同步刷新人物的跨度统计（书目首末章 + 总提及量）。 */
export function syncNovelMentions(worldDir: string, worldId: string, mentions: Array<{ chapterId: string; name: string; count: number }>): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM novel_mentions;");
      const q = db.prepare("INSERT OR REPLACE INTO novel_mentions(chapter_id,name,count) VALUES(?,?,?)");
      for (const m of mentions) if (m.count > 0) q.run(m.chapterId, m.name, m.count);
      db.exec(
        "UPDATE novel_characters SET "+
        "chapters_seen=(SELECT COUNT(*) FROM novel_mentions m WHERE m.name=novel_characters.name),"+
        "mention_total=(SELECT COALESCE(SUM(m.count),0) FROM novel_mentions m WHERE m.name=novel_characters.name),"+
        "first_chapter=(SELECT MIN(c.ordinal) FROM novel_mentions m JOIN novel_chapters c ON c.chapter_id=m.chapter_id WHERE m.name=novel_characters.name),"+
        "last_chapter=(SELECT MAX(c.ordinal) FROM novel_mentions m JOIN novel_chapters c ON c.chapter_id=m.chapter_id WHERE m.name=novel_characters.name);"
      );
    });
  } finally {
    db.close();
  }
}

export function syncNovelCharacters(worldDir: string, worldId: string, characters: NovelCharacterRow[], relations: NovelRelationRow[]): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM novel_characters; DELETE FROM novel_relations;");
      const q = db.prepare(
        "INSERT INTO novel_characters(character_id,name,aliases_json,role,bio,voice,personality_json,desires_json,"+
        "contradictions_json,arc_json,first_chapter,last_chapter,source_refs_json,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      );
      for (const c of characters) {
        q.run(
          c.characterId, c.name, JSON.stringify(c.aliases), c.role, c.bio, c.voice,
          JSON.stringify(c.personality), JSON.stringify(c.desires), JSON.stringify(c.contradictions), JSON.stringify(c.arc),
          c.firstChapter, c.lastChapter, JSON.stringify(c.sourceRefs), c.source
        );
      }
      const qr = db.prepare("INSERT INTO novel_relations(relation_id,from_name,to_name,label,evidence,chapter_ordinal) VALUES(?,?,?,?,?,?)");
      for (const r of relations) qr.run(r.relationId, r.fromName, r.toName, r.label, r.evidence, r.chapterOrdinal);
    });
  } finally {
    db.close();
  }
}

/** Seeds keep the roster usable before corpus analysis; analysis rows always win. */
export function upsertSeedCharacters(worldDir: string, worldId: string, entries: Array<{ name: string; aliases: string[] }>): number {
  const db = openKnowledgeDatabase(worldDir, worldId);
  let inserted = 0;
  try {
    transaction(db, () => {
      const q = db.prepare(
        "INSERT INTO novel_characters(character_id,name,aliases_json,role,bio,voice,personality_json,desires_json,"+
        "contradictions_json,arc_json,first_chapter,last_chapter,chapters_seen,mention_total,source_refs_json,source) "+
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING"
      );
      for (const entry of entries) {
        const result = q.run("seed:" + entry.name, entry.name, JSON.stringify(entry.aliases), "", "", "", "[]", "[]", "[]", "[]", null, null, 0, 0, "[]", "seed");
        inserted += Number(result.changes);
      }
    });
  } finally {
    db.close();
  }
  return inserted;
}

export function syncNovelThreads(worldDir: string, worldId: string, threads: NovelThreadRow[]): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM novel_plot_threads;");
      const q = db.prepare("INSERT INTO novel_plot_threads(thread_id,title,status,summary,key_turns_json,unresolved_json,first_chapter,last_chapter,source_refs_json) VALUES(?,?,?,?,?,?,?,?,?)");
      for (const t of threads) {
        q.run(t.threadId, t.title, t.status, t.summary, JSON.stringify(t.keyTurns), JSON.stringify(t.unresolved), t.firstChapter, t.lastChapter, JSON.stringify(t.sourceRefs));
      }
    });
  } finally {
    db.close();
  }
}

export function syncNovelForeshadowings(worldDir: string, worldId: string, items: NovelForeshadowingRow[]): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM novel_foreshadowings;");
      const q = db.prepare("INSERT INTO novel_foreshadowings(clue_id,clue,first_appearance,meaning,payoffs_json,confidence,status,chapter_ordinal,source_refs_json) VALUES(?,?,?,?,?,?,?,?,?)");
      for (const f of items) {
        q.run(f.clueId, f.clue, f.firstAppearance, f.meaning, JSON.stringify(f.payoffs), f.confidence, f.status, f.chapterOrdinal, JSON.stringify(f.sourceRefs));
      }
    });
  } finally {
    db.close();
  }
}

export function syncNovelBeats(worldDir: string, worldId: string, beats: NovelBeatRow[]): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      db.exec("DELETE FROM novel_beats;");
      const q = db.prepare("INSERT INTO novel_beats(beat_id,chapter_id,chapter_ordinal,summary,actors_json,source_refs_json) VALUES(?,?,?,?,?,?)");
      for (const b of beats) q.run(b.beatId, b.chapterId, b.chapterOrdinal, b.summary, JSON.stringify(b.actors), JSON.stringify(b.sourceRefs));
    });
  } finally {
    db.close();
  }
}

export function writeNovelKbMeta(worldDir: string, worldId: string, meta: Record<string, string>): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      const q = db.prepare("INSERT INTO novel_kb_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
      for (const [k, v] of Object.entries(meta)) q.run(k, v);
    });
  } finally {
    db.close();
  }
}

export function readNovelKbMeta(worldDir: string, worldId: string): Record<string, string> {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const rows = db.prepare("SELECT key,value FROM novel_kb_meta").all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } finally {
    db.close();
  }
}

// ── 人物观察与人物档案 ───────────────────────────────────────

export interface NovelCharacterSummary { characterId: string; name: string; aliases: string[]; role: string; bio: string; voice: string; chaptersSeen: number; mentionTotal: number; firstChapter: number | null; lastChapter: number | null; }
export interface NovelCharacterObservationRow { characterId: string; name: string; aliases: string[]; role: string; bio: string; firstChapter: number | null; lastChapter: number | null; mentionTotal: number; personality: string[]; desires: string[]; contradictions: string[]; arc: string[]; }

/** SQLite 库里的数组字段都存 JSON 字符串；解析失败按空数组处理，不让单行坏数据炸查询。 */
function parseStringList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 逐批抽取的原始观察，用于合并成档案；量很大，只给分析用。 */
export function listNovelCharacterObservations(worldDir: string, worldId: string, options: { limit?: number; minMentions?: number } = {}): NovelCharacterObservationRow[] {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const limit = options.limit ?? OBSERVATIONS_DEFAULT_LIMIT;
    const minMentions = options.minMentions ?? 1;
    const rows = db.prepare(
      "SELECT character_id AS characterId,name,aliases_json,role,bio,first_chapter AS firstChapter,last_chapter AS lastChapter,"+
      "mention_total AS mentionTotal,personality_json,desires_json,contradictions_json,arc_json FROM novel_characters "+
      "WHERE mention_total>=? ORDER BY mention_total DESC, name LIMIT ?"
    ).all(minMentions, limit) as Array<Record<string, unknown> & { aliases_json: string; personality_json: string; desires_json: string; contradictions_json: string; arc_json: string }>;
    return rows.map(row => ({
      ...row,
      aliases: parseStringList(row.aliases_json),
      personality: parseStringList(row.personality_json),
      desires: parseStringList(row.desires_json),
      contradictions: parseStringList(row.contradictions_json),
      arc: parseStringList(row.arc_json),
      aliases_json: undefined,
      personality_json: undefined,
      desires_json: undefined,
      contradictions_json: undefined,
      arc_json: undefined
    } as unknown as NovelCharacterObservationRow));
  } finally {
    db.close();
  }
}

// 原著人物逐章状态：不要与续写 Story State 的动态人物状态混用。
export interface NovelCharacterChapterStateRow {
  characterId: string; name: string; chapterId: string; chapterOrdinal: number; chapterTitle: string; volume: number;
  sourceHash: string; contextHash: string; model: string; generatedAt: string;
  behavior: string[]; goals: string[]; knowledge: string[]; relationships: string[]; resources: string[];
  situation: string; changes: string[]; evidence: string[]; uncertainty: string[];
}

export function syncNovelCharacterChapterStates(worldDir: string, worldId: string, rows: NovelCharacterChapterStateRow[]): void {
  if (!rows.length) return;
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      const q = db.prepare(
        "INSERT INTO novel_character_chapter_states(character_id,name,chapter_id,chapter_ordinal,chapter_title,volume,source_hash,model,generated_at,payload_json) "+
        "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(character_id,chapter_id) DO UPDATE SET "+
        "name=excluded.name,chapter_ordinal=excluded.chapter_ordinal,chapter_title=excluded.chapter_title,volume=excluded.volume,"+
        "source_hash=excluded.source_hash,model=excluded.model,generated_at=excluded.generated_at,payload_json=excluded.payload_json"
      );
      for (const row of rows) {
        q.run(row.characterId, row.name, row.chapterId, row.chapterOrdinal, row.chapterTitle, row.volume, row.sourceHash, row.model, row.generatedAt, JSON.stringify(row));
      }
    });
  } finally {
    db.close();
  }
}

/** 人物页逐章状态查询：四个过滤条件都用参数占位，空值条件用比较表达式短路。 */
export function listNovelCharacterChapterStates(worldDir: string, worldId: string, options: { characterId?: string; name?: string; fromOrdinal?: number; toOrdinal?: number; limit?: number } = {}): NovelCharacterChapterStateRow[] {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const characterId = options.characterId ?? "";
    const nameLike = "%" + (options.name ?? "").trim() + "%";
    const fromOrdinal = options.fromOrdinal ?? -1;
    const toOrdinal = options.toOrdinal ?? -1;
    const rows = db.prepare(
      "SELECT payload_json FROM novel_character_chapter_states "+
      "WHERE (?='' OR character_id=?) AND (?='%%' OR name LIKE ?) AND (?<0 OR chapter_ordinal>=?) AND (?<0 OR chapter_ordinal<=?) "+
      "ORDER BY chapter_ordinal DESC LIMIT ?"
    ).all(characterId, characterId, nameLike, nameLike, fromOrdinal, fromOrdinal, toOrdinal, toOrdinal, options.limit ?? 5000) as Array<{ payload_json: string }>;
    return rows.map(row => JSON.parse(row.payload_json) as NovelCharacterChapterStateRow);
  } finally {
    db.close();
  }
}

/** 输入指纹比对用：人物 ID + 章节 ID → 最近一次的正文哈希与上下文哈希。 */
export function listNovelCharacterChapterStateHashes(worldDir: string, worldId: string): Map<string, { sourceHash: string; contextHash: string }> {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const rows = db.prepare("SELECT character_id,chapter_id,source_hash,payload_json FROM novel_character_chapter_states").all() as Array<{ character_id: string; chapter_id: string; source_hash: string; payload_json: string }>;
    return new Map(rows.map(row => {
      let contextHash = "";
      try {
        contextHash = String((JSON.parse(row.payload_json) as { contextHash?: string }).contextHash ?? "");
      } catch {
        /* 旧 payload 缺 contextHash，视为过期，下次重新分析。 */
      }
      return [row.character_id + "\\0" + row.chapter_id, { sourceHash: row.source_hash, contextHash }] as const;
    }));
  } finally {
    db.close();
  }
}

export interface NovelCharacterProfileRow { characterId: string; name: string; summary: string; stages: string[]; traits: string[]; contradictions: string[]; arc: string[]; observationCount: number; model: string; generatedAt: string; }

export function syncNovelCharacterProfiles(worldDir: string, worldId: string, profiles: NovelCharacterProfileRow[]): void {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    transaction(db, () => {
      const q = db.prepare(
        "INSERT INTO novel_character_profiles(character_id,name,summary,stages_json,traits_json,contradictions_json,arc_json,observation_count,model,generated_at) VALUES(?,?,?,?,?,?,?,?,?,?) "+
        "ON CONFLICT(character_id) DO UPDATE SET name=excluded.name,summary=excluded.summary,stages_json=excluded.stages_json,"+
        "traits_json=excluded.traits_json,contradictions_json=excluded.contradictions_json,arc_json=excluded.arc_json,"+
        "observation_count=excluded.observation_count,model=excluded.model,generated_at=excluded.generated_at"
      );
      for (const profile of profiles) {
        q.run(
          profile.characterId, profile.name, profile.summary,
          JSON.stringify(profile.stages), JSON.stringify(profile.traits), JSON.stringify(profile.contradictions), JSON.stringify(profile.arc),
          profile.observationCount, profile.model, profile.generatedAt
        );
      }
    });
  } finally {
    db.close();
  }
}

/** 观察太少、不足以合并时不写档案；已有档案也要能删掉。 */
export function deleteNovelCharacterProfiles(worldDir: string, worldId: string, names: string[]): number {
  if (!names.length) return 0;
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const statement = db.prepare("DELETE FROM novel_character_profiles WHERE name=?");
    let removed = 0;
    transaction(db, () => {
      for (const name of names) removed += Number(statement.run(name).changes);
    });
    return removed;
  } finally {
    db.close();
  }
}

export function listNovelCharacterProfiles(worldDir: string, worldId: string): Map<string, NovelCharacterProfileRow> {
  const result = new Map<string, NovelCharacterProfileRow>();
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const rows = db.prepare(
      "SELECT character_id AS characterId,name,summary,stages_json,traits_json,contradictions_json,arc_json,"+
      "observation_count AS observationCount,model,generated_at AS generatedAt FROM novel_character_profiles ORDER BY observation_count DESC"
    ).all() as Array<Record<string, unknown> & { stages_json: string; traits_json: string; contradictions_json: string; arc_json: string }>;
    for (const row of rows) {
      result.set(String(row.name), {
        characterId: String(row.characterId),
        name: String(row.name),
        summary: String(row.summary),
        stages: parseStringList(row.stages_json),
        traits: parseStringList(row.traits_json),
        contradictions: parseStringList(row.contradictions_json),
        arc: parseStringList(row.arc_json),
        observationCount: Number(row.observationCount),
        model: String(row.model),
        generatedAt: String(row.generatedAt)
      });
    }
    return result;
  } finally {
    db.close();
  }
}

// ── 人物查询 ────────────────────────────────────────────────

/** 人物总数，与搜索/截断无关；列表 Badge 不应把当前加载条数当成总数。 */
export function countNovelCharacters(worldDir: string, worldId: string): number {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    return Number((db.prepare("SELECT COUNT(*) AS count FROM novel_characters").get() as { count: number }).count);
  } finally {
    db.close();
  }
}

export function listNovelCharacters(worldDir: string, worldId: string, options: { query?: string; limit?: number } = {}): NovelCharacterSummary[] {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const limit = options.limit ?? KB_DEFAULT_LIMIT;
    const like = "%" + ((options.query ?? "").trim()) + "%";
    const rows = db.prepare(
      "SELECT character_id AS characterId,name,aliases_json,role,bio,voice,chapters_seen AS chaptersSeen,mention_total AS mentionTotal,"+
      "first_chapter AS firstChapter,last_chapter AS lastChapter FROM novel_characters "+
      "WHERE (?='%%' OR name LIKE ? OR aliases_json LIKE ?) ORDER BY mention_total DESC, chapters_seen DESC, name LIMIT ?"
    ).all(like, like, like, limit) as Array<Record<string, unknown> & { aliases_json: string }>;
    return rows.map(row => ({
      ...row,
      aliases: JSON.parse(row.aliases_json) as string[],
      aliases_json: undefined
    } as unknown as NovelCharacterSummary));
  } finally {
    db.close();
  }
}

export function listNovelThreads(worldDir: string, worldId: string, options: { limit?: number; status?: string; query?: string } = {}): Array<Record<string, unknown> & { keyTurns: string[]; unresolved: string[] }> {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const limit = options.limit ?? KB_DEFAULT_LIMIT;
    const like = "%" + ((options.query ?? "").trim()) + "%";
    const rows = db.prepare(
      "SELECT thread_id AS threadId,title,status,summary,key_turns_json,unresolved_json,first_chapter AS firstChapter,last_chapter AS lastChapter,"+
      "COALESCE(last_chapter,0)-COALESCE(first_chapter,0) AS span FROM novel_plot_threads "+
      "WHERE (?='' OR status=?) AND (?='%%' OR title LIKE ? OR summary LIKE ?) ORDER BY span DESC, first_chapter LIMIT ?"
    ).all(options.status ?? "", options.status ?? "", like, like, like, limit) as Array<Record<string, unknown> & { key_turns_json: string; unresolved_json: string }>;
    return rows.map(row => ({
      ...row,
      keyTurns: JSON.parse(row.key_turns_json) as string[],
      unresolved: JSON.parse(row.unresolved_json) as string[],
      key_turns_json: undefined,
      unresolved_json: undefined
    }));
  } finally {
    db.close();
  }
}

export function listNovelForeshadowings(worldDir: string, worldId: string, options: { limit?: number; status?: string; query?: string } = {}): Array<Record<string, unknown> & { payoffs: string[] }> {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const limit = options.limit ?? KB_FORESHADOWING_DEFAULT_LIMIT;
    const like = "%" + ((options.query ?? "").trim()) + "%";
    const rows = db.prepare(
      "SELECT clue_id AS clueId,clue,first_appearance AS firstAppearance,meaning,payoffs_json,confidence,status,chapter_ordinal AS chapterOrdinal FROM novel_foreshadowings "+
      "WHERE (?='' OR status=?) AND (?='%%' OR clue LIKE ?) ORDER BY chapter_ordinal LIMIT ?"
    ).all(options.status ?? "", options.status ?? "", like, like, limit) as Array<Record<string, unknown> & { payoffs_json: string }>;
    return rows.map(row => ({
      ...row,
      payoffs: JSON.parse(row.payoffs_json) as string[],
      payoffs_json: undefined
    }));
  } finally {
    db.close();
  }
}

// ── 可移植导出与总览 ────────────────────────────────────────

export interface NovelKnowledgeSnapshot {
  schemaVersion: 1; worldId: string; exportedAt: string; meta: Record<string, string>;
  arcs: Array<Record<string, unknown>>; characters: Array<Record<string, unknown>>;
  threads: Array<Record<string, unknown>>; foreshadowings: Array<Record<string, unknown>>; beats: Array<Record<string, unknown>>; characterChapterStates: Array<Record<string, unknown>>;
  characterProfiles: Array<Record<string, unknown>>;
}

/** 解析 JSON 列；导出场景下单行坏数据回落到调用方给的默认值。 */
function parseJsonOr(value: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

/** Portable excerpt without the source text, which lives in library/index.json. */
export function exportNovelKnowledge(worldDir: string, worldId: string): NovelKnowledgeSnapshot {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const characters = (db.prepare(
      "SELECT character_id AS characterId,name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,"+
      "first_chapter AS firstChapter,last_chapter AS lastChapter,chapters_seen AS chaptersSeen,mention_total AS mentionTotal,source FROM novel_characters ORDER BY mention_total DESC"
    ).all() as Array<Record<string, unknown>>).map(row => ({
      ...row,
      aliases: parseJsonOr(row.aliases_json, []),
      personality: parseJsonOr(row.personality_json, []),
      desires: parseJsonOr(row.desires_json, []),
      contradictions: parseJsonOr(row.contradictions_json, []),
      arc: parseJsonOr(row.arc_json, []),
      aliases_json: undefined,
      personality_json: undefined,
      desires_json: undefined,
      contradictions_json: undefined,
      arc_json: undefined
    }));
    const threads = (db.prepare(
      "SELECT thread_id AS threadId,title,status,summary,key_turns_json,unresolved_json,first_chapter AS firstChapter,last_chapter AS lastChapter FROM novel_plot_threads ORDER BY first_chapter"
    ).all() as Array<Record<string, unknown>>).map(row => ({
      ...row,
      keyTurns: parseJsonOr(row.key_turns_json, []),
      unresolved: parseJsonOr(row.unresolved_json, []),
      key_turns_json: undefined,
      unresolved_json: undefined
    }));
    const foreshadowings = (db.prepare(
      "SELECT clue_id AS clueId,clue,first_appearance AS firstAppearance,meaning,payoffs_json,confidence,status,chapter_ordinal AS chapterOrdinal FROM novel_foreshadowings ORDER BY chapter_ordinal"
    ).all() as Array<Record<string, unknown>>).map(row => ({
      ...row,
      payoffs: parseJsonOr(row.payoffs_json, []),
      payoffs_json: undefined
    }));
    const beats = (db.prepare(
      "SELECT chapter_id AS chapterId,chapter_ordinal AS chapterOrdinal,summary,actors_json FROM novel_beats ORDER BY chapter_ordinal"
    ).all() as Array<Record<string, unknown>>).map(row => ({
      ...row,
      actors: parseJsonOr(row.actors_json, []),
      actors_json: undefined
    }));
    const arcs = db.prepare("SELECT volume,title,summary,key_turns_json,characters_json FROM novel_arcs ORDER BY volume").all() as Array<Record<string, unknown>>;
    const characterProfiles = db.prepare(
      "SELECT character_id AS characterId,name,summary,stages_json,traits_json,contradictions_json,arc_json,observation_count AS observationCount,model,generated_at AS generatedAt FROM novel_character_profiles ORDER BY observation_count DESC"
    ).all() as Array<Record<string, unknown>>;
    const characterChapterStates = (db.prepare(
      "SELECT payload_json FROM novel_character_chapter_states ORDER BY chapter_ordinal,character_id"
    ).all() as Array<{ payload_json: string }>).map(row => parseJsonOr(row.payload_json, {}) as Record<string, unknown>);
    return {
      schemaVersion: 1,
      worldId,
      exportedAt: new Date().toISOString(),
      meta: readNovelKbMeta(worldDir, worldId),
      characterProfiles: characterProfiles.map(row => ({
        ...row,
        stages: parseJsonOr(row.stages_json, []),
        traits: parseJsonOr(row.traits_json, []),
        contradictions: parseJsonOr(row.contradictions_json, []),
        arc: parseJsonOr(row.arc_json, []),
        stages_json: undefined,
        traits_json: undefined,
        contradictions_json: undefined,
        arc_json: undefined
      })),
      arcs: arcs.map(row => ({
        ...row,
        keyTurns: parseJsonOr(row.key_turns_json, []),
        characters: parseJsonOr(row.characters_json, []),
        key_turns_json: undefined,
        characters_json: undefined
      })),
      characters, threads, foreshadowings, beats, characterChapterStates
    };
  } finally {
    db.close();
  }
}

/** story-kb overview：卷章规模、状态分布、Top 人物与跨度最长的剧情线。 */
export function novelKnowledgeOverview(worldDir: string, worldId: string): Record<string, unknown> {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const one = (sql: string, ...params: Array<string | number>): number =>
      Number((db.prepare(sql).get(...params) as { count: number }).count);
    return {
      chapters: one("SELECT COUNT(*) AS count FROM novel_chapters"),
      characters: one("SELECT COUNT(*) AS count FROM novel_characters"),
      charactersWithoutMentions: one("SELECT COUNT(*) AS count FROM novel_characters WHERE mention_total=0"),
      threads: one("SELECT COUNT(*) AS count FROM novel_plot_threads"),
      foreshadowings: one("SELECT COUNT(*) AS count FROM novel_foreshadowings"),
      beats: one("SELECT COUNT(*) AS count FROM novel_beats"),
      characterChapterStates: one("SELECT COUNT(*) AS count FROM novel_character_chapter_states"),
      relations: one("SELECT COUNT(*) AS count FROM novel_relations"),
      chaptersWithBeats: one("SELECT COUNT(DISTINCT chapter_ordinal) AS count FROM novel_beats"),
      volumes: db.prepare("SELECT volume,COUNT(*) AS chapters,SUM(char_count) AS chars FROM novel_chapters GROUP BY volume ORDER BY volume").all(),
      threadStatus: db.prepare("SELECT status,COUNT(*) AS count FROM novel_plot_threads GROUP BY status ORDER BY count DESC").all(),
      foreshadowStatus: db.prepare("SELECT status,COUNT(*) AS count FROM novel_foreshadowings GROUP BY status ORDER BY count DESC").all(),
      topCharacters: db.prepare("SELECT name,mention_total AS mentions,chapters_seen AS chapters FROM novel_characters ORDER BY mention_total DESC LIMIT 10").all(),
      longThreads: db.prepare(
        "SELECT title,status,first_chapter AS firstChapter,last_chapter AS lastChapter,"+
        "COALESCE(last_chapter,0)-COALESCE(first_chapter,0) AS span FROM novel_plot_threads ORDER BY span DESC LIMIT 8"
      ).all(),
      meta: readNovelKbMeta(worldDir, worldId)
    };
  } finally {
    db.close();
  }
}

export function listNovelBeats(worldDir: string, worldId: string, options: { from?: number; to?: number; limit?: number; latest?: boolean } = {}): Array<Record<string, unknown> & { actors: string[] }> {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const from = options.from ?? 0;
    const to = options.to ?? Number.MAX_SAFE_INTEGER;
    const limit = options.limit ?? BEATS_DEFAULT_LIMIT;
    const order = options.latest ? "DESC" : "ASC";
    const rows = db.prepare(
      "SELECT beat_id AS beatId,chapter_id AS chapterId,chapter_ordinal AS chapterOrdinal,summary,actors_json FROM novel_beats "+
      "WHERE chapter_ordinal>=? AND chapter_ordinal<=? ORDER BY chapter_ordinal " + order + " LIMIT ?"
    ).all(from, to, limit) as Array<Record<string, unknown> & { actors_json: string }>;
    return rows.map(row => ({
      ...row,
      actors: JSON.parse(row.actors_json) as string[],
      actors_json: undefined
    }));
  } finally {
    db.close();
  }
}

// ── 人物工作台 ──────────────────────────────────────────────

/** 人物工作台：合并人物档案、画像与正文事件时间线；事件只按明确 actors 关联。 */
export function readNovelCharacterWorkbenchDetail(worldDir: string, worldId: string, name: string): Record<string, unknown> | undefined {
  const db = openKnowledgeDatabase(worldDir, worldId);
  try {
    const parse = (value: unknown): unknown[] => {
      try {
        const parsed = JSON.parse(String(value ?? "[]")) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const character = db.prepare(
      "SELECT character_id AS characterId,name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,"+
      "first_chapter AS firstChapter,last_chapter AS lastChapter,chapters_seen AS chaptersSeen,mention_total AS mentionTotal,source FROM novel_characters WHERE name=?"
    ).get(name) as Record<string, unknown> | undefined;
    if (!character) return undefined;
    const profileRow = db.prepare(
      "SELECT summary,stages_json,traits_json,contradictions_json,arc_json,observation_count AS observationCount,model,generated_at AS generatedAt FROM novel_character_profiles WHERE name=?"
    ).get(name) as Record<string, unknown> | undefined;
    // actors_json LIKE 只是粗筛，精确过滤靠内存里的逐字比对。
    const beats = db.prepare(
      "SELECT b.beat_id AS beatId,b.chapter_id AS chapterId,b.chapter_ordinal AS chapterOrdinal,b.summary,b.actors_json AS actors,"+
      "c.volume,c.title AS chapterTitle,c.label AS chapterLabel FROM novel_beats b LEFT JOIN novel_chapters c ON c.chapter_id=b.chapter_id "+
      "WHERE b.actors_json LIKE ? ORDER BY b.chapter_ordinal"
    ).all("%" + name + "%") as Array<Record<string, unknown>>;
    const timeline = beats
      .filter(row => parse(row.actors_json).includes(name))
      .map(row => ({
        beatId: row.beatId,
        chapterId: row.chapterId,
        chapterOrdinal: row.chapterOrdinal,
        volume: row.volume,
        chapterTitle: row.chapterTitle ?? row.chapterId,
        chapterLabel: row.chapterLabel ?? "",
        summary: row.summary,
        actors: parse(row.actors_json)
      }));
    const relations = db.prepare(
      "SELECT from_name AS fromName,to_name AS toName,label,evidence,chapter_ordinal AS chapterOrdinal FROM novel_relations "+
      "WHERE from_name=? OR to_name=? ORDER BY chapter_ordinal"
    ).all(name, name);
    const chapterStates = db.prepare(
      "SELECT payload_json FROM novel_character_chapter_states WHERE character_id=? ORDER BY chapter_ordinal"
    ).all(String(character.characterId)) as Array<{ payload_json: string }>;
    return {
      character: {
        ...character,
        aliases: parse(character.aliases_json),
        personality: parse(character.personality_json),
        desires: parse(character.desires_json),
        contradictions: parse(character.contradictions_json),
        arc: parse(character.arc_json),
        aliases_json: undefined,
        personality_json: undefined,
        desires_json: undefined,
        contradictions_json: undefined,
        arc_json: undefined
      },
      profile: profileRow ? {
        summary: profileRow.summary,
        stages: parse(profileRow.stages_json),
        traits: parse(profileRow.traits_json),
        contradictions: parse(profileRow.contradictions_json),
        arc: parse(profileRow.arc_json),
        observationCount: profileRow.observationCount,
        model: profileRow.model,
        generatedAt: profileRow.generatedAt
      } : null,
      timeline,
      relations,
      chapterStates: chapterStates.map(row => JSON.parse(row.payload_json))
    };
  } finally {
    db.close();
  }
}
