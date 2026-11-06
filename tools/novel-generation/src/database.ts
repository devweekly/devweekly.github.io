import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StoryState } from "./story-state.js";
export interface DatabaseStatus { path:string; schemaVersion:number; statePath:string; stateSchemaVersion:number; annotations:number; entities:number; entityMentions:number; characters:number; canonFacts:number; events:number; plotThreads:number; storyAnalysis:number; novelChapters:number; novelCharacters:number; novelMentions:number; novelThreads:number; novelForeshadowings:number; novelBeats:number; novelRelations:number; novelArcs:number; novelCharacterProfiles:number; }
/** Concurrent shards and reader processes compete for the write lock; wait instead of failing. */
function retryBusy<T>(work:()=>T,attempts=40):T{
 for(let attempt=0;;attempt++){
  try{return work();}
  catch(error){
   const message=String((error as Error).message??error);
   if(!/database is locked|SQLITE_BUSY|database table is locked/i.test(message)||attempt>=attempts-1)throw error;
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
  }
 }
}
function execWithRetry(db:DatabaseSync,sql:string):void{ retryBusy(()=>db.exec(sql)); }

const KNOWLEDGE_DATABASE_FILE="novel.db";
const STATE_DATABASE_FILE="story.db";
/** 知识库结构版本：只有 ingest / analyze 会改它。 */
const KNOWLEDGE_SCHEMA_VERSION=7;
/** v6 之前的库把分片文本整份复制进来，与 library/index.json 重复；升级时删掉。 */
const LEGACY_CHUNK_TABLES=["library_chunks"];
/** 图谱是快照 `storyGraph` 的规范化副本，只被写入、没有任何读者；v7 起只保留快照里的那份。 */
const LEGACY_GRAPH_TABLES=["story_graph_nodes","story_graph_edges"];
/** 写作状态结构版本：与知识库分开演进。 */
const STATE_SCHEMA_VERSION=1;
/** v4 之前状态表与知识表同库，迁移时按这个顺序搬。 */
const LEGACY_STATE_TABLES=["story_state","characters","canon_facts","story_events","plot_threads","continuity_notes"];

/** 写作状态（story.db）：每写一章都会重写，体积保持在几十 KB。 */
const STATE_TABLES =
 "CREATE TABLE IF NOT EXISTS world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS story_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),updated_at TEXT NOT NULL,payload_json TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS characters(name TEXT PRIMARY KEY,status TEXT NOT NULL,location TEXT,profile_json TEXT,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_characters_location ON characters(location);"+
 "CREATE TABLE IF NOT EXISTS canon_facts(id TEXT PRIMARY KEY,fact TEXT NOT NULL,confidence TEXT NOT NULL,source TEXT);"+
 "CREATE TABLE IF NOT EXISTS story_events(id TEXT PRIMARY KEY,summary TEXT NOT NULL,position TEXT NOT NULL,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_story_events_position ON story_events(position);"+
 "CREATE TABLE IF NOT EXISTS plot_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,last_updated TEXT NOT NULL,notes TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_plot_threads_status ON plot_threads(status);"+
 "CREATE TABLE IF NOT EXISTS continuity_notes(ordinal INTEGER PRIMARY KEY,note TEXT NOT NULL);";

function tableExists(db:DatabaseSync,name:string):boolean{
 return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

/**
 * 旧库里状态表与知识表同库：首次创建 story.db 时把行搬过来，搬完删掉旧表。
 * 留下旧表会让「状态到底存在哪」变成两个答案，之后读到的可能是过期副本。
 */
function adoptLegacyState(worldDir:string,target:DatabaseSync):void{
 const legacyPath=join(worldDir,KNOWLEDGE_DATABASE_FILE);
 if(!existsSync(legacyPath))return;
 let legacy:DatabaseSync;
 try{legacy=new DatabaseSync(legacyPath);}catch{return;}
 try{
  if(!tableExists(legacy,"story_state"))return;
  const rows=(table:string)=>tableExists(legacy,table)?legacy.prepare("SELECT * FROM "+table).all() as Array<Record<string,unknown>>:[];
  const stateRows=rows("story_state"),characterRows=rows("characters"),factRows=rows("canon_facts"),
        eventRows=rows("story_events"),threadRows=rows("plot_threads"),noteRows=rows("continuity_notes");
  transaction(target,()=>{
   for(const row of stateRows)target.prepare("INSERT INTO story_state(singleton,updated_at,payload_json) VALUES(?,?,?) ON CONFLICT(singleton) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json").run(Number(row.singleton),String(row.updated_at),String(row.payload_json));
   const qc=target.prepare("INSERT OR REPLACE INTO characters(name,status,location,profile_json,payload_json) VALUES(?,?,?,?,?)");
   for(const row of characterRows)qc.run(String(row.name),String(row.status),row.location==null?null:String(row.location),row.profile_json==null?null:String(row.profile_json),String(row.payload_json));
   const qf=target.prepare("INSERT OR REPLACE INTO canon_facts(id,fact,confidence,source) VALUES(?,?,?,?)");
   for(const row of factRows)qf.run(String(row.id),String(row.fact),String(row.confidence),row.source==null?null:String(row.source));
   const qe=target.prepare("INSERT OR REPLACE INTO story_events(id,summary,position,payload_json) VALUES(?,?,?,?)");
   for(const row of eventRows)qe.run(String(row.id),String(row.summary),String(row.position),String(row.payload_json));
   const qp=target.prepare("INSERT OR REPLACE INTO plot_threads(id,title,status,last_updated,notes) VALUES(?,?,?,?,?)");
   for(const row of threadRows)qp.run(String(row.id),String(row.title),String(row.status),String(row.last_updated),String(row.notes));
   const qn=target.prepare("INSERT OR REPLACE INTO continuity_notes(ordinal,note) VALUES(?,?)");
   for(const row of noteRows)qn.run(Number(row.ordinal),String(row.note));
  });
  for(const table of LEGACY_STATE_TABLES)legacy.exec("DROP TABLE IF EXISTS "+table);
  console.log("[database] 已把写作状态从 "+KNOWLEDGE_DATABASE_FILE+" 迁到 "+STATE_DATABASE_FILE+"（"+stateRows.length+" 份状态快照）");
 }catch(error){
  // 迁移失败不能让章节写不进去：保留旧表，下次打开再试。
  console.warn("[database] 旧状态表迁移未完成："+String(error));
 }finally{legacy.close();}
}

function openStateDatabase(worldDir:string,worldId:string):DatabaseSync {
 mkdirSync(worldDir,{recursive:true});
 const path=join(worldDir,STATE_DATABASE_FILE);
 const fresh=!existsSync(path);
 const db=new DatabaseSync(path);
 execWithRetry(db,"PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
 execWithRetry(db,STATE_TABLES);
 const version=Number((db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version);
 if(version>STATE_SCHEMA_VERSION){db.close();throw new Error("Story state database schema is newer than this application supports: "+version);}
 const stored=db.prepare("SELECT value FROM world_meta WHERE key='world_id'").get() as {value:string}|undefined;
 if(stored&&stored.value!==worldId){db.close();throw new Error("Story state database world mismatch: expected "+worldId+", found "+stored.value);}
 if(version<STATE_SCHEMA_VERSION)retryBusy(()=>db.exec("PRAGMA user_version="+STATE_SCHEMA_VERSION));
 if(!stored)retryBusy(()=>db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?)").run(worldId));
 if(fresh)adoptLegacyState(worldDir,db);
 return db;
}
function openKnowledgeDatabase(worldDir:string,worldId:string):DatabaseSync {
 mkdirSync(worldDir,{recursive:true}); const db=new DatabaseSync(join(worldDir,KNOWLEDGE_DATABASE_FILE));
 execWithRetry(db,"PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
 execWithRetry(db,"CREATE TABLE IF NOT EXISTS world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS annotations(chunk_id TEXT PRIMARY KEY,source TEXT NOT NULL,chapter TEXT NOT NULL,extracted_at TEXT NOT NULL,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_annotations_source ON annotations(source);"+
 "CREATE TABLE IF NOT EXISTS entities(entity_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,aliases_json TEXT NOT NULL,mention_count INTEGER NOT NULL,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name); CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities(type,name);"+
 "CREATE TABLE IF NOT EXISTS entity_mentions(entity_id TEXT NOT NULL,chunk_id TEXT NOT NULL,source TEXT NOT NULL,chapter TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(entity_id,chunk_id,evidence),FOREIGN KEY(entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_entity_mentions_chunk ON entity_mentions(chunk_id);"+
 
 
 
 
 
 
 "CREATE TABLE IF NOT EXISTS story_analysis(singleton INTEGER PRIMARY KEY CHECK(singleton=1),world_id TEXT NOT NULL,source_hash TEXT NOT NULL,analyzed_at TEXT NOT NULL,payload_json TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS novel_kb_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS novel_chapters(chapter_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,ordinal INTEGER NOT NULL,volume INTEGER NOT NULL,printed_number INTEGER,title TEXT NOT NULL,label TEXT NOT NULL,start_line INTEGER,char_count INTEGER NOT NULL,chunk_start INTEGER NOT NULL,chunk_end INTEGER NOT NULL);"+
 "CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_chapters_ordinal ON novel_chapters(ordinal);CREATE INDEX IF NOT EXISTS idx_novel_chapters_volume ON novel_chapters(volume);"+
 "CREATE TABLE IF NOT EXISTS novel_characters(character_id TEXT PRIMARY KEY,name TEXT NOT NULL,aliases_json TEXT NOT NULL,role TEXT NOT NULL DEFAULT '',bio TEXT NOT NULL DEFAULT '',voice TEXT NOT NULL DEFAULT '',personality_json TEXT NOT NULL DEFAULT '[]',desires_json TEXT NOT NULL DEFAULT '[]',contradictions_json TEXT NOT NULL DEFAULT '[]',arc_json TEXT NOT NULL DEFAULT '[]',first_chapter INTEGER,last_chapter INTEGER,chapters_seen INTEGER NOT NULL DEFAULT 0,mention_total INTEGER NOT NULL DEFAULT 0,source_refs_json TEXT NOT NULL DEFAULT '[]',source TEXT NOT NULL);"+
 "CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_characters_name ON novel_characters(name);"+
 "CREATE TABLE IF NOT EXISTS novel_mentions(chapter_id TEXT NOT NULL,name TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(chapter_id,name),FOREIGN KEY(chapter_id) REFERENCES novel_chapters(chapter_id) ON DELETE CASCADE);CREATE INDEX IF NOT EXISTS idx_novel_mentions_name ON novel_mentions(name);"+
 "CREATE TABLE IF NOT EXISTS novel_plot_threads(thread_id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT '未能判断',summary TEXT NOT NULL DEFAULT '',key_turns_json TEXT NOT NULL DEFAULT '[]',unresolved_json TEXT NOT NULL DEFAULT '[]',first_chapter INTEGER,last_chapter INTEGER,source_refs_json TEXT NOT NULL DEFAULT '[]');"+
 "CREATE TABLE IF NOT EXISTS novel_foreshadowings(clue_id TEXT PRIMARY KEY,clue TEXT NOT NULL,first_appearance TEXT NOT NULL DEFAULT '',meaning TEXT NOT NULL DEFAULT '',payoffs_json TEXT NOT NULL DEFAULT '[]',confidence TEXT NOT NULL DEFAULT '不确定',status TEXT NOT NULL DEFAULT '未判断',chapter_ordinal INTEGER,source_refs_json TEXT NOT NULL DEFAULT '[]');CREATE INDEX IF NOT EXISTS idx_novel_foreshadowings_status ON novel_foreshadowings(status);"+
 "CREATE TABLE IF NOT EXISTS novel_beats(beat_id TEXT PRIMARY KEY,chapter_id TEXT NOT NULL,chapter_ordinal INTEGER,summary TEXT NOT NULL,actors_json TEXT NOT NULL DEFAULT '[]',source_refs_json TEXT NOT NULL DEFAULT '[]');CREATE INDEX IF NOT EXISTS idx_novel_beats_chapter ON novel_beats(chapter_ordinal);"+
 "CREATE TABLE IF NOT EXISTS novel_relations(relation_id TEXT PRIMARY KEY,from_name TEXT NOT NULL,to_name TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL DEFAULT '',chapter_ordinal INTEGER);CREATE INDEX IF NOT EXISTS idx_novel_relations_from ON novel_relations(from_name);"+
 "CREATE TABLE IF NOT EXISTS novel_character_profiles(character_id TEXT PRIMARY KEY,name TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',stages_json TEXT NOT NULL DEFAULT '[]',traits_json TEXT NOT NULL DEFAULT '[]',contradictions_json TEXT NOT NULL DEFAULT '[]',arc_json TEXT NOT NULL DEFAULT '[]',observation_count INTEGER NOT NULL DEFAULT 0,model TEXT NOT NULL DEFAULT '',generated_at TEXT NOT NULL);"+
 "CREATE INDEX IF NOT EXISTS idx_novel_character_profiles_name ON novel_character_profiles(name);"+
 "CREATE TABLE IF NOT EXISTS novel_arcs(volume INTEGER PRIMARY KEY,title TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',key_turns_json TEXT NOT NULL DEFAULT '[]',characters_json TEXT NOT NULL DEFAULT '[]',generated_at TEXT NOT NULL);");
 const version=Number((db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version);
 if(version>KNOWLEDGE_SCHEMA_VERSION){db.close();throw new Error("Novel database schema is newer than this application supports: "+version);}
 const stored=db.prepare("SELECT value FROM world_meta WHERE key='world_id'").get() as {value:string}|undefined;
 if(stored&&stored.value!==worldId){db.close();throw new Error("SQLite database world mismatch: expected "+worldId+", found "+stored.value);}
 if(version<KNOWLEDGE_SCHEMA_VERSION)retryBusy(()=>transaction(db,()=>{
  // 分片唯一来源是 library/index.json；库里的副本是同一份文本，删掉不影响检索。
  for(const table of LEGACY_CHUNK_TABLES)db.exec("DROP TABLE IF EXISTS "+table);
  for(const table of LEGACY_GRAPH_TABLES)db.exec("DROP TABLE IF EXISTS "+table);
  db.exec("PRAGMA user_version="+KNOWLEDGE_SCHEMA_VERSION);
 }));
 if(!stored)retryBusy(()=>db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?)").run(worldId));
 return db;
}
export function openWorldDatabase(worldDir:string,worldId:string):DatabaseSync{return openKnowledgeDatabase(worldDir,worldId);}
/** 写作状态库（story.db）：查错和导出 schema 时单独打开。 */
export function openStoryStateDatabase(worldDir:string,worldId:string):DatabaseSync{return openStateDatabase(worldDir,worldId);}
function transaction<T>(db:DatabaseSync,work:()=>T):T{retryBusy(()=>db.exec("BEGIN IMMEDIATE"));try{const x=work();retryBusy(()=>db.exec("COMMIT"));return x;}catch(e){try{db.exec("ROLLBACK");}catch{/* 提交失败时事务可能已结束 */}throw e;}}
/**
 * 语料变更后，按旧文本算出来的章节切分与分析全部作废。
 * 只清派生数据，不动 novel.db 里那份权威快照之外的任何东西。
 */
export function invalidateDerivedAnalysis(worldDir:string,worldId:string):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  db.exec("DELETE FROM story_analysis; DELETE FROM novel_chapters;");
  clearNovelAnalysis(db);
 });}finally{db.close();}
}
type AnnotationRow={chunkId:string;source:string;chapter?:string;extractedAt?:string};
type RegistryData={entities:Array<{id:string;name:string;type:string;aliases:string[];mentions:Array<{chunkId:string;source:string;chapter:string;evidence:string}>}>};
export function syncAnnotations(worldDir:string,worldId:string,annotations:AnnotationRow[],registry?:RegistryData|null):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{db.exec("DELETE FROM annotations; DELETE FROM entity_mentions; DELETE FROM entities;");
 const qa=db.prepare("INSERT INTO annotations(chunk_id,source,chapter,extracted_at,payload_json) VALUES(?,?,?,?,?)");
 for(const a of annotations)qa.run(a.chunkId,a.source,a.chapter??"",a.extractedAt??"",JSON.stringify(a));
 if(registry){const qe=db.prepare("INSERT INTO entities(entity_id,name,type,aliases_json,mention_count,payload_json) VALUES(?,?,?,?,?,?)");const qm=db.prepare("INSERT OR IGNORE INTO entity_mentions(entity_id,chunk_id,source,chapter,evidence) VALUES(?,?,?,?,?)");
 for(const e of registry.entities){qe.run(e.id,e.name,e.type,JSON.stringify(e.aliases),e.mentions.length,JSON.stringify(e));for(const m of e.mentions)qm.run(e.id,m.chunkId,m.source,m.chapter,m.evidence);}}
 });}finally{db.close();}
}
export function readAnnotationsByChunkIds(worldDir:string,worldId:string,ids:string[]):Map<string,Record<string,unknown>>{
 const result=new Map<string,Record<string,unknown>>();if(!ids.length)return result;
 const probe=openKnowledgeDatabase(worldDir,worldId);let annotationCount:number;
 try{annotationCount=Number((probe.prepare("SELECT COUNT(*) AS count FROM annotations").get() as {count:number}).count);}finally{probe.close();}
 if(annotationCount===0){
  try{
   const legacy=JSON.parse(readFileSync(join(worldDir,"library","annotations.json"),"utf8")) as {annotations?:AnnotationRow[]};
   let registry:RegistryData|null=null;
   try{registry=JSON.parse(readFileSync(join(worldDir,"library","entities.json"),"utf8")) as RegistryData;}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
   if(legacy.annotations?.length||registry?.entities.length)syncAnnotations(worldDir,worldId,legacy.annotations??[],registry);
  }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 }
 const db=openKnowledgeDatabase(worldDir,worldId);
 try{const q=db.prepare("SELECT chunk_id,payload_json FROM annotations WHERE chunk_id=?");for(const id of ids){const row=q.get(id) as {chunk_id:string;payload_json:string}|undefined;if(row)result.set(row.chunk_id,JSON.parse(row.payload_json) as Record<string,unknown>);}return result;}
 finally{db.close();}
}
export function syncStoryState(worldDir:string,state:StoryState):void{
 // 同时校验知识库的世界归属：两个文件必须属于同一个世界
 openKnowledgeDatabase(worldDir,state.worldId).close();
 const db=openStateDatabase(worldDir,state.worldId);try{transaction(db,()=>{
 db.prepare("INSERT INTO story_state(singleton,updated_at,payload_json) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json").run(state.updatedAt,JSON.stringify(state));
 db.exec("DELETE FROM characters; DELETE FROM canon_facts; DELETE FROM story_events; DELETE FROM plot_threads; DELETE FROM continuity_notes;");
 const qc=db.prepare("INSERT INTO characters(name,status,location,profile_json,payload_json) VALUES(?,?,?,?,?)");for(const x of state.characters)qc.run(x.name,x.status,x.location??null,x.profile?JSON.stringify(x.profile):null,JSON.stringify(x));
 const qf=db.prepare("INSERT INTO canon_facts(id,fact,confidence,source) VALUES(?,?,?,?)");for(const x of state.canonFacts)qf.run(x.id,x.fact,x.confidence,x.source??null);
 const qe=db.prepare("INSERT INTO story_events(id,summary,position,payload_json) VALUES(?,?,?,?)");for(const x of state.events)qe.run(x.id,x.summary,x.position,JSON.stringify(x));
 const qp=db.prepare("INSERT INTO plot_threads(id,title,status,last_updated,notes) VALUES(?,?,?,?,?)");for(const x of state.plotThreads)qp.run(x.id,x.title,x.status,x.lastUpdated,x.notes);
 const qn=db.prepare("INSERT INTO continuity_notes(ordinal,note) VALUES(?,?)");state.continuityNotes.forEach((x,i)=>qn.run(i,x));
 });}finally{db.close();}
}
export function readStoryState(worldDir:string,worldId:string):StoryState|undefined{
 const db=openStateDatabase(worldDir,worldId);try{const row=db.prepare("SELECT payload_json FROM story_state WHERE singleton=1").get() as {payload_json:string}|undefined;return row?JSON.parse(row.payload_json) as StoryState:undefined;}finally{db.close();}
}

export interface StoryAnalysisSnapshot {
  worldId: string;
  sourceHash: string;
  analyzedAt: string;
  analysisVersion?: number;
  complete: boolean;
  batches: number;
  characters: Array<Record<string, unknown>>;
  plotThreads: Array<Record<string, unknown>>;
  foreshadowings: Array<Record<string, unknown>>;
  developmentPossibilities: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
  storyCore?: Record<string, unknown>;
  storyCoreObservations?: Array<Record<string, unknown>>;
  macguffins?: Array<Record<string, unknown>>;
  storyGraph?: {nodes:Array<{id:string;type:string;label:string;data:Record<string,unknown>;sourceRefs?:unknown[]}>;edges:Array<{id:string;from:string;to:string;type:string;label:string;data:Record<string,unknown>;sourceRefs?:unknown[]}>};
}
export function saveStoryAnalysis(worldDir:string,worldId:string,snapshot:StoryAnalysisSnapshot):void {
 const db=openKnowledgeDatabase(worldDir,worldId);
 try {
  if(snapshot.worldId!==worldId) throw new Error("Story analysis world mismatch: "+worldId);
  transaction(db,()=>{
   db.prepare("INSERT INTO story_analysis(singleton,world_id,source_hash,analyzed_at,payload_json) VALUES(1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET world_id=excluded.world_id,source_hash=excluded.source_hash,analyzed_at=excluded.analyzed_at,payload_json=excluded.payload_json")
    .run(worldId,snapshot.sourceHash,snapshot.analyzedAt,JSON.stringify(snapshot));
  });
 } finally { db.close(); }
}
export function readStoryAnalysis(worldDir:string,worldId:string):StoryAnalysisSnapshot|undefined {
 const db=openKnowledgeDatabase(worldDir,worldId);
 try {
  const row=db.prepare("SELECT payload_json FROM story_analysis WHERE singleton=1 AND world_id=?").get(worldId) as {payload_json:string}|undefined;
  return row?JSON.parse(row.payload_json) as StoryAnalysisSnapshot:undefined;
 } finally { db.close(); }
}

export function databaseStatus(worldDir:string,worldId:string):DatabaseStatus{
 const knowledge=openKnowledgeDatabase(worldDir,worldId);
 const state=openStateDatabase(worldDir,worldId);
 try{
  const count=(db:DatabaseSync,table:string)=>Number((db.prepare("SELECT COUNT(*) AS count FROM "+table).get() as {count:number}).count);
  const version=(db:DatabaseSync)=>Number((db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version);
  return {path:join(worldDir,KNOWLEDGE_DATABASE_FILE),schemaVersion:version(knowledge),
   statePath:join(worldDir,STATE_DATABASE_FILE),stateSchemaVersion:version(state),
   annotations:count(knowledge,"annotations"),entities:count(knowledge,"entities"),entityMentions:count(knowledge,"entity_mentions"),
   storyAnalysis:count(knowledge,"story_analysis"),novelChapters:count(knowledge,"novel_chapters"),novelCharacters:count(knowledge,"novel_characters"),novelMentions:count(knowledge,"novel_mentions"),novelThreads:count(knowledge,"novel_plot_threads"),novelForeshadowings:count(knowledge,"novel_foreshadowings"),novelBeats:count(knowledge,"novel_beats"),novelRelations:count(knowledge,"novel_relations"),novelArcs:count(knowledge,"novel_arcs"),novelCharacterProfiles:count(knowledge,"novel_character_profiles"),
   characters:count(state,"characters"),canonFacts:count(state,"canon_facts"),events:count(state,"story_events"),plotThreads:count(state,"plot_threads")};
 }finally{knowledge.close();state.close();}
}
export function databaseWorldDirFromLibrary(libraryDir:string):string{return dirname(libraryDir);}

/** Corpus knowledge base rows. These describe the finished novel, not the writing state. */
export interface NovelSourceRef { chunkId?:string; chapterId?:string; source?:string; chapter?:string; volume?:number }
export interface NovelChapterRow { chapterId:string; ordinal:number; volume:number; printedNumber:number|null; title:string; label:string; startLine:number|null; charCount:number; chunkStart:number; chunkEnd:number; }
export interface NovelCharacterRow { characterId:string; name:string; aliases:string[]; role:string; bio:string; voice:string; personality:string[]; desires:string[]; contradictions:string[]; arc:string[]; firstChapter:number|null; lastChapter:number|null; sourceRefs:NovelSourceRef[]; source:string; }
export interface NovelThreadRow { threadId:string; title:string; status:string; summary:string; keyTurns:string[]; unresolved:string[]; firstChapter:number|null; lastChapter:number|null; sourceRefs:NovelSourceRef[]; }
export interface NovelForeshadowingRow { clueId:string; clue:string; firstAppearance:string; meaning:string; payoffs:string[]; confidence:string; status:string; chapterOrdinal:number|null; sourceRefs:NovelSourceRef[]; }
export interface NovelBeatRow { beatId:string; chapterId:string; chapterOrdinal:number|null; summary:string; actors:string[]; sourceRefs:NovelSourceRef[]; }
export interface NovelRelationRow { relationId:string; fromName:string; toName:string; label:string; evidence:string; chapterOrdinal:number|null; }

function clearNovelAnalysis(db:DatabaseSync):void{
 db.exec("DELETE FROM novel_characters; DELETE FROM novel_mentions; DELETE FROM novel_plot_threads; DELETE FROM novel_foreshadowings; DELETE FROM novel_beats; DELETE FROM novel_relations; DELETE FROM novel_kb_meta;");
}

export function syncNovelChapters(worldDir:string,worldId:string,chapters:NovelChapterRow[]):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  db.exec("DELETE FROM novel_chapters;");
  const q=db.prepare("INSERT INTO novel_chapters(chapter_id,world_id,ordinal,volume,printed_number,title,label,start_line,char_count,chunk_start,chunk_end) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  for(const c of chapters)q.run(c.chapterId,worldId,c.ordinal,c.volume,c.printedNumber,c.title,c.label,c.startLine,c.charCount,c.chunkStart,c.chunkEnd);
 });}finally{db.close();}
}

export function syncNovelMentions(worldDir:string,worldId:string,mentions:Array<{chapterId:string;name:string;count:number}>):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  db.exec("DELETE FROM novel_mentions;");
  const q=db.prepare("INSERT OR REPLACE INTO novel_mentions(chapter_id,name,count) VALUES(?,?,?)");
  for(const m of mentions)if(m.count>0)q.run(m.chapterId,m.name,m.count);
  db.exec("UPDATE novel_characters SET chapters_seen=(SELECT COUNT(*) FROM novel_mentions m WHERE m.name=novel_characters.name),mention_total=(SELECT COALESCE(SUM(m.count),0) FROM novel_mentions m WHERE m.name=novel_characters.name),first_chapter=(SELECT MIN(c.ordinal) FROM novel_mentions m JOIN novel_chapters c ON c.chapter_id=m.chapter_id WHERE m.name=novel_characters.name),last_chapter=(SELECT MAX(c.ordinal) FROM novel_mentions m JOIN novel_chapters c ON c.chapter_id=m.chapter_id WHERE m.name=novel_characters.name);");
 });}finally{db.close();}
}

export function syncNovelCharacters(worldDir:string,worldId:string,characters:NovelCharacterRow[],relations:NovelRelationRow[]):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  db.exec("DELETE FROM novel_characters; DELETE FROM novel_relations;");
  const q=db.prepare("INSERT INTO novel_characters(character_id,name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,first_chapter,last_chapter,source_refs_json,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(const c of characters)q.run(c.characterId,c.name,JSON.stringify(c.aliases),c.role,c.bio,c.voice,JSON.stringify(c.personality),JSON.stringify(c.desires),JSON.stringify(c.contradictions),JSON.stringify(c.arc),c.firstChapter,c.lastChapter,JSON.stringify(c.sourceRefs),c.source);
  const qr=db.prepare("INSERT INTO novel_relations(relation_id,from_name,to_name,label,evidence,chapter_ordinal) VALUES(?,?,?,?,?,?)");
  for(const r of relations)qr.run(r.relationId,r.fromName,r.toName,r.label,r.evidence,r.chapterOrdinal);
 });}finally{db.close();}
}

/** Seeds keep the roster usable before corpus analysis; analysis rows always win. */
export function upsertSeedCharacters(worldDir:string,worldId:string,entries:Array<{name:string;aliases:string[]}>):number{
 const db=openKnowledgeDatabase(worldDir,worldId);let inserted=0;
 try{transaction(db,()=>{const q=db.prepare("INSERT INTO novel_characters(character_id,name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,first_chapter,last_chapter,chapters_seen,mention_total,source_refs_json,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING");
  for(const entry of entries){const result=q.run("seed:"+entry.name,entry.name,JSON.stringify(entry.aliases),"","","","[]","[]","[]","[]",null,null,0,0,"[]","seed");inserted+=Number(result.changes);}
 });}finally{db.close();}
 return inserted;
}

export function syncNovelThreads(worldDir:string,worldId:string,threads:NovelThreadRow[]):void{ const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  db.exec("DELETE FROM novel_plot_threads;");
  const q=db.prepare("INSERT INTO novel_plot_threads(thread_id,title,status,summary,key_turns_json,unresolved_json,first_chapter,last_chapter,source_refs_json) VALUES(?,?,?,?,?,?,?,?,?)");
  for(const t of threads)q.run(t.threadId,t.title,t.status,t.summary,JSON.stringify(t.keyTurns),JSON.stringify(t.unresolved),t.firstChapter,t.lastChapter,JSON.stringify(t.sourceRefs));
 });}finally{db.close();}
}

export function syncNovelForeshadowings(worldDir:string,worldId:string,items:NovelForeshadowingRow[]):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  db.exec("DELETE FROM novel_foreshadowings;");
  const q=db.prepare("INSERT INTO novel_foreshadowings(clue_id,clue,first_appearance,meaning,payoffs_json,confidence,status,chapter_ordinal,source_refs_json) VALUES(?,?,?,?,?,?,?,?,?)");
  for(const f of items)q.run(f.clueId,f.clue,f.firstAppearance,f.meaning,JSON.stringify(f.payoffs),f.confidence,f.status,f.chapterOrdinal,JSON.stringify(f.sourceRefs));
 });}finally{db.close();}
}

export function syncNovelBeats(worldDir:string,worldId:string,beats:NovelBeatRow[]):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  db.exec("DELETE FROM novel_beats;");
  const q=db.prepare("INSERT INTO novel_beats(beat_id,chapter_id,chapter_ordinal,summary,actors_json,source_refs_json) VALUES(?,?,?,?,?,?)");
  for(const b of beats)q.run(b.beatId,b.chapterId,b.chapterOrdinal,b.summary,JSON.stringify(b.actors),JSON.stringify(b.sourceRefs));
 });}finally{db.close();}
}

export function writeNovelKbMeta(worldDir:string,worldId:string,meta:Record<string,string>):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{const q=db.prepare("INSERT INTO novel_kb_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");for(const [k,v] of Object.entries(meta))q.run(k,v);});}finally{db.close();}
}
export function readNovelKbMeta(worldDir:string,worldId:string):Record<string,string>{
 const db=openKnowledgeDatabase(worldDir,worldId);try{const rows=db.prepare("SELECT key,value FROM novel_kb_meta").all() as Array<{key:string;value:string}>;return Object.fromEntries(rows.map(r=>[r.key,r.value]));}finally{db.close();}
}
export interface NovelCharacterSummary { characterId:string; name:string; aliases:string[]; role:string; bio:string; voice:string; chaptersSeen:number; mentionTotal:number; firstChapter:number|null; lastChapter:number|null; }
export interface NovelCharacterObservationRow { characterId:string; name:string; aliases:string[]; role:string; bio:string; firstChapter:number|null; lastChapter:number|null; mentionTotal:number; personality:string[]; desires:string[]; contradictions:string[]; arc:string[]; }

/** 逐批抽取的原始观察，用于合并成档案；量很大，只给分析用。 */
export function listNovelCharacterObservations(worldDir:string,worldId:string,options:{limit?:number;minMentions?:number}={}):NovelCharacterObservationRow[]{
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const limit=options.limit??30;const minMentions=options.minMentions??1;
  const rows=db.prepare("SELECT character_id AS characterId,name,aliases_json,role,bio,first_chapter AS firstChapter,last_chapter AS lastChapter,mention_total AS mentionTotal,personality_json,desires_json,contradictions_json,arc_json FROM novel_characters WHERE mention_total>=? ORDER BY mention_total DESC, name LIMIT ?").all(minMentions,limit) as Array<Record<string,unknown> & {aliases_json:string;personality_json:string;desires_json:string;contradictions_json:string;arc_json:string}>;
  const parse=(value:string)=>{try{const parsed=JSON.parse(value) as unknown;return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==="string"):[];}catch{return [];}};
  return rows.map(row=>({...row,aliases:parse(row.aliases_json),personality:parse(row.personality_json),desires:parse(row.desires_json),contradictions:parse(row.contradictions_json),arc:parse(row.arc_json),aliases_json:undefined,personality_json:undefined,desires_json:undefined,contradictions_json:undefined,arc_json:undefined} as unknown as NovelCharacterObservationRow));
 }finally{db.close();}
}

export interface NovelCharacterProfileRow { characterId:string; name:string; summary:string; stages:string[]; traits:string[]; contradictions:string[]; arc:string[]; observationCount:number; model:string; generatedAt:string; }

export function syncNovelCharacterProfiles(worldDir:string,worldId:string,profiles:NovelCharacterProfileRow[]):void{
 const db=openKnowledgeDatabase(worldDir,worldId);try{transaction(db,()=>{
  const q=db.prepare("INSERT INTO novel_character_profiles(character_id,name,summary,stages_json,traits_json,contradictions_json,arc_json,observation_count,model,generated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(character_id) DO UPDATE SET name=excluded.name,summary=excluded.summary,stages_json=excluded.stages_json,traits_json=excluded.traits_json,contradictions_json=excluded.contradictions_json,arc_json=excluded.arc_json,observation_count=excluded.observation_count,model=excluded.model,generated_at=excluded.generated_at");
  for(const profile of profiles)q.run(profile.characterId,profile.name,profile.summary,JSON.stringify(profile.stages),JSON.stringify(profile.traits),JSON.stringify(profile.contradictions),JSON.stringify(profile.arc),profile.observationCount,profile.model,profile.generatedAt);
 });}finally{db.close();}
}

/** 观察太少、不足以合并时不写档案；已有档案也要能删掉。 */
export function deleteNovelCharacterProfiles(worldDir:string,worldId:string,names:string[]):number{
 if(!names.length)return 0;
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const statement=db.prepare("DELETE FROM novel_character_profiles WHERE name=?");
  let removed=0;
  transaction(db,()=>{for(const name of names)removed+=Number(statement.run(name).changes);});
  return removed;
 }finally{db.close();}
}

export function listNovelCharacterProfiles(worldDir:string,worldId:string):Map<string,NovelCharacterProfileRow>{
 const result=new Map<string,NovelCharacterProfileRow>();
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const rows=db.prepare("SELECT character_id AS characterId,name,summary,stages_json,traits_json,contradictions_json,arc_json,observation_count AS observationCount,model,generated_at AS generatedAt FROM novel_character_profiles ORDER BY observation_count DESC").all() as Array<Record<string,unknown> & {stages_json:string;traits_json:string;contradictions_json:string;arc_json:string}>;
  for(const row of rows){
   const parse=(value:string)=>{try{const parsed=JSON.parse(value) as unknown;return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==="string"):[];}catch{return [];}};
   result.set(String(row.name),{characterId:String(row.characterId),name:String(row.name),summary:String(row.summary),stages:parse(row.stages_json),traits:parse(row.traits_json),contradictions:parse(row.contradictions_json),arc:parse(row.arc_json),observationCount:Number(row.observationCount),model:String(row.model),generatedAt:String(row.generatedAt)});
  }
  return result;
 }finally{db.close();}
}

export function listNovelCharacters(worldDir:string,worldId:string,options:{query?:string;limit?:number}={}):NovelCharacterSummary[]{
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const limit=options.limit??50;const like="%"+((options.query??"").trim())+"%";
  const rows=db.prepare("SELECT character_id AS characterId,name,aliases_json,role,bio,voice,chapters_seen AS chaptersSeen,mention_total AS mentionTotal,first_chapter AS firstChapter,last_chapter AS lastChapter FROM novel_characters WHERE (?='%%' OR name LIKE ? OR aliases_json LIKE ?) ORDER BY mention_total DESC, chapters_seen DESC, name LIMIT ?").all(like,like,like,limit) as Array<Record<string,unknown> & {aliases_json:string}>;
  return rows.map(row=>({...row,aliases:JSON.parse(row.aliases_json) as string[],aliases_json:undefined} as unknown as NovelCharacterSummary));
 }finally{db.close();}
}
export function listNovelThreads(worldDir:string,worldId:string,options:{limit?:number;status?:string;query?:string}={}):Array<Record<string,unknown> & {keyTurns:string[];unresolved:string[]}>{
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const limit=options.limit??50;const like="%"+((options.query??"").trim())+"%";
  const rows=db.prepare("SELECT thread_id AS threadId,title,status,summary,key_turns_json,unresolved_json,first_chapter AS firstChapter,last_chapter AS lastChapter,COALESCE(last_chapter,0)-COALESCE(first_chapter,0) AS span FROM novel_plot_threads WHERE (?='' OR status=?) AND (?='%%' OR title LIKE ? OR summary LIKE ?) ORDER BY span DESC, first_chapter LIMIT ?").all(options.status??"",options.status??"",like,like,like,limit) as Array<Record<string,unknown> & {key_turns_json:string;unresolved_json:string}>;
  return rows.map(row=>({...row,keyTurns:JSON.parse(row.key_turns_json) as string[],unresolved:JSON.parse(row.unresolved_json) as string[],key_turns_json:undefined,unresolved_json:undefined}));
 }finally{db.close();}
}
export function listNovelForeshadowings(worldDir:string,worldId:string,options:{limit?:number;status?:string;query?:string}={}):Array<Record<string,unknown> & {payoffs:string[]}>{
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const limit=options.limit??100;const like="%"+((options.query??"").trim())+"%";
  const rows=db.prepare("SELECT clue_id AS clueId,clue,first_appearance AS firstAppearance,meaning,payoffs_json,confidence,status,chapter_ordinal AS chapterOrdinal FROM novel_foreshadowings WHERE (?='' OR status=?) AND (?='%%' OR clue LIKE ?) ORDER BY chapter_ordinal LIMIT ?").all(options.status??"",options.status??"",like,like,limit) as Array<Record<string,unknown> & {payoffs_json:string}>;
  return rows.map(row=>({...row,payoffs:JSON.parse(row.payoffs_json) as string[],payoffs_json:undefined}));
 }finally{db.close();}
}
export interface NovelKnowledgeSnapshot {
 schemaVersion: 1; worldId: string; exportedAt: string; meta: Record<string,string>;
 arcs: Array<Record<string,unknown>>; characters: Array<Record<string,unknown>>;
 threads: Array<Record<string,unknown>>; foreshadowings: Array<Record<string,unknown>>; beats: Array<Record<string,unknown>>;
 characterProfiles: Array<Record<string,unknown>>;
}
/** Portable excerpt without the source text, which lives in library/index.json. */
export function exportNovelKnowledge(worldDir:string,worldId:string):NovelKnowledgeSnapshot{
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const parse=(value:unknown,fallback:unknown)=>{try{return JSON.parse(String(value));}catch{return fallback;}};
  const characters=(db.prepare("SELECT character_id AS characterId,name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,first_chapter AS firstChapter,last_chapter AS lastChapter,chapters_seen AS chaptersSeen,mention_total AS mentionTotal,source FROM novel_characters ORDER BY mention_total DESC").all() as Array<Record<string,unknown>>).map(row=>({...row,aliases:parse(row.aliases_json,[]),personality:parse(row.personality_json,[]),desires:parse(row.desires_json,[]),contradictions:parse(row.contradictions_json,[]),arc:parse(row.arc_json,[]),aliases_json:undefined,personality_json:undefined,desires_json:undefined,contradictions_json:undefined,arc_json:undefined}));
  const threads=(db.prepare("SELECT thread_id AS threadId,title,status,summary,key_turns_json,unresolved_json,first_chapter AS firstChapter,last_chapter AS lastChapter FROM novel_plot_threads ORDER BY first_chapter").all() as Array<Record<string,unknown>>).map(row=>({...row,keyTurns:parse(row.key_turns_json,[]),unresolved:parse(row.unresolved_json,[]),key_turns_json:undefined,unresolved_json:undefined}));
  const foreshadowings=(db.prepare("SELECT clue_id AS clueId,clue,first_appearance AS firstAppearance,meaning,payoffs_json,confidence,status,chapter_ordinal AS chapterOrdinal FROM novel_foreshadowings ORDER BY chapter_ordinal").all() as Array<Record<string,unknown>>).map(row=>({...row,payoffs:parse(row.payoffs_json,[]),payoffs_json:undefined}));
  const beats=(db.prepare("SELECT chapter_id AS chapterId,chapter_ordinal AS chapterOrdinal,summary,actors_json FROM novel_beats ORDER BY chapter_ordinal").all() as Array<Record<string,unknown>>).map(row=>({...row,actors:parse(row.actors_json,[]),actors_json:undefined}));
  const arcs=db.prepare("SELECT volume,title,summary,key_turns_json,characters_json FROM novel_arcs ORDER BY volume").all() as Array<Record<string,unknown>>;
  const characterProfiles=db.prepare("SELECT character_id AS characterId,name,summary,stages_json,traits_json,contradictions_json,arc_json,observation_count AS observationCount,model,generated_at AS generatedAt FROM novel_character_profiles ORDER BY observation_count DESC").all() as Array<Record<string,unknown>>;
  return {schemaVersion:1,worldId,exportedAt:new Date().toISOString(),meta:readNovelKbMeta(worldDir,worldId),characterProfiles:characterProfiles.map(row=>({...row,stages:parse(row.stages_json,[]),traits:parse(row.traits_json,[]),contradictions:parse(row.contradictions_json,[]),arc:parse(row.arc_json,[]),stages_json:undefined,traits_json:undefined,contradictions_json:undefined,arc_json:undefined})),arcs:arcs.map(row=>({...row,keyTurns:parse(row.key_turns_json,[]),characters:parse(row.characters_json,[]),key_turns_json:undefined,characters_json:undefined})),characters,threads,foreshadowings,beats};
 }finally{db.close();}
}
export function novelKnowledgeOverview(worldDir:string,worldId:string):Record<string,unknown>{
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const one=(sql:string,...params:Array<string|number>)=>Number((db.prepare(sql).get(...params) as {count:number}).count);
  const volumes=db.prepare("SELECT volume,COUNT(*) AS chapters,SUM(char_count) AS chars FROM novel_chapters GROUP BY volume ORDER BY volume").all();
  const threadStatus=db.prepare("SELECT status,COUNT(*) AS count FROM novel_plot_threads GROUP BY status ORDER BY count DESC").all();
  const foreshadowStatus=db.prepare("SELECT status,COUNT(*) AS count FROM novel_foreshadowings GROUP BY status ORDER BY count DESC").all();
  const topCharacters=db.prepare("SELECT name,mention_total AS mentions,chapters_seen AS chapters FROM novel_characters ORDER BY mention_total DESC LIMIT 10").all();
  const longThreads=db.prepare("SELECT title,status,first_chapter AS firstChapter,last_chapter AS lastChapter,COALESCE(last_chapter,0)-COALESCE(first_chapter,0) AS span FROM novel_plot_threads ORDER BY span DESC LIMIT 8").all();
  return {chapters:one("SELECT COUNT(*) AS count FROM novel_chapters"),characters:one("SELECT COUNT(*) AS count FROM novel_characters"),
   charactersWithoutMentions:one("SELECT COUNT(*) AS count FROM novel_characters WHERE mention_total=0"),
   threads:one("SELECT COUNT(*) AS count FROM novel_plot_threads"),foreshadowings:one("SELECT COUNT(*) AS count FROM novel_foreshadowings"),
   beats:one("SELECT COUNT(*) AS count FROM novel_beats"),relations:one("SELECT COUNT(*) AS count FROM novel_relations"),
   chaptersWithBeats:one("SELECT COUNT(DISTINCT chapter_ordinal) AS count FROM novel_beats"),
   volumes,threadStatus,foreshadowStatus,topCharacters,longThreads,meta:readNovelKbMeta(worldDir,worldId)};
 }finally{db.close();}
}
export function listNovelBeats(worldDir:string,worldId:string,options:{from?:number;to?:number;limit?:number;latest?:boolean}={}):Array<Record<string,unknown> & {actors:string[]}>{
 const db=openKnowledgeDatabase(worldDir,worldId);try{
  const from=options.from??0;const to=options.to??Number.MAX_SAFE_INTEGER;const limit=options.limit??200;
  const order=options.latest?"DESC":"ASC";
  const rows=db.prepare("SELECT beat_id AS beatId,chapter_id AS chapterId,chapter_ordinal AS chapterOrdinal,summary,actors_json FROM novel_beats WHERE chapter_ordinal>=? AND chapter_ordinal<=? ORDER BY chapter_ordinal "+order+" LIMIT ?").all(from,to,limit) as Array<Record<string,unknown> & {actors_json:string}>;
  return rows.map(row=>({...row,actors:JSON.parse(row.actors_json) as string[],actors_json:undefined}));
 }finally{db.close();}
}
