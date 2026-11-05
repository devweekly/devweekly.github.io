import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LibraryChunk } from "./library.js";
import type { StoryState } from "./story-state.js";
export interface DatabaseStatus { path:string; schemaVersion:number; chunks:number; annotations:number; entities:number; entityMentions:number; characters:number; canonFacts:number; events:number; plotThreads:number; }
function openDatabase(worldDir:string,worldId:string):DatabaseSync {
 mkdirSync(worldDir,{recursive:true}); const db=new DatabaseSync(join(worldDir,"novel.db"));
 db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
 db.exec("CREATE TABLE IF NOT EXISTS world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS library_chunks(id TEXT PRIMARY KEY,source TEXT NOT NULL,chapter TEXT NOT NULL,chunk_index INTEGER NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,source_hash TEXT,chapter_start INTEGER,text TEXT NOT NULL);"+
 "CREATE INDEX IF NOT EXISTS idx_chunks_source ON library_chunks(source); CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON library_chunks(chapter);"+
 "CREATE TABLE IF NOT EXISTS annotations(chunk_id TEXT PRIMARY KEY,source TEXT NOT NULL,chapter TEXT NOT NULL,extracted_at TEXT NOT NULL,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_annotations_source ON annotations(source);"+
 "CREATE TABLE IF NOT EXISTS entities(entity_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,aliases_json TEXT NOT NULL,mention_count INTEGER NOT NULL,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name); CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities(type,name);"+
 "CREATE TABLE IF NOT EXISTS entity_mentions(entity_id TEXT NOT NULL,chunk_id TEXT NOT NULL,source TEXT NOT NULL,chapter TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(entity_id,chunk_id,evidence),FOREIGN KEY(entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_entity_mentions_chunk ON entity_mentions(chunk_id);"+
 "CREATE TABLE IF NOT EXISTS story_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),updated_at TEXT NOT NULL,payload_json TEXT NOT NULL);"+
 "CREATE TABLE IF NOT EXISTS characters(name TEXT PRIMARY KEY,status TEXT NOT NULL,location TEXT,profile_json TEXT,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_characters_location ON characters(location);"+
 "CREATE TABLE IF NOT EXISTS canon_facts(id TEXT PRIMARY KEY,fact TEXT NOT NULL,confidence TEXT NOT NULL,source TEXT);"+
 "CREATE TABLE IF NOT EXISTS story_events(id TEXT PRIMARY KEY,summary TEXT NOT NULL,position TEXT NOT NULL,payload_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_story_events_position ON story_events(position);"+
 "CREATE TABLE IF NOT EXISTS plot_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,last_updated TEXT NOT NULL,notes TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_plot_threads_status ON plot_threads(status);"+
 "CREATE TABLE IF NOT EXISTS continuity_notes(ordinal INTEGER PRIMARY KEY,note TEXT NOT NULL);");
 const version=Number((db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version);
 if(version>1){db.close();throw new Error("Novel database schema is newer than this application supports: "+version);}
 const stored=db.prepare("SELECT value FROM world_meta WHERE key='world_id'").get() as {value:string}|undefined;
 if(stored&&stored.value!==worldId){db.close();throw new Error("SQLite database world mismatch: expected "+worldId+", found "+stored.value);}
 db.exec("PRAGMA user_version=1"); db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(worldId); return db;
}
function transaction<T>(db:DatabaseSync,work:()=>T):T{db.exec("BEGIN IMMEDIATE");try{const x=work();db.exec("COMMIT");return x;}catch(e){db.exec("ROLLBACK");throw e;}}
export function syncLibraryChunks(worldDir:string,worldId:string,chunks:LibraryChunk[]):void{
 const db=openDatabase(worldDir,worldId);try{transaction(db,()=>{db.exec("DELETE FROM library_chunks");const q=db.prepare("INSERT INTO library_chunks(id,source,chapter,chunk_index,start_offset,end_offset,source_hash,chapter_start,text) VALUES(?,?,?,?,?,?,?,?,?)");for(const c of chunks)q.run(c.id,c.source,c.chapter,c.chunkIndex,c.start,c.end,c.sourceHash??null,c.chapterStart??null,c.text);});}finally{db.close();}
}
export function readLibraryChunks(worldDir:string,worldId:string):LibraryChunk[]{
 const db=openDatabase(worldDir,worldId);try{return db.prepare("SELECT id,source,chapter,chunk_index AS chunkIndex,start_offset AS start,end_offset AS end,source_hash AS sourceHash,chapter_start AS chapterStart,text FROM library_chunks ORDER BY source,chapter,chunk_index").all() as unknown as LibraryChunk[];}finally{db.close();}
}
type AnnotationRow={chunkId:string;source:string;chapter?:string;extractedAt?:string};
type RegistryData={entities:Array<{id:string;name:string;type:string;aliases:string[];mentions:Array<{chunkId:string;source:string;chapter:string;evidence:string}>}>};
export function syncAnnotations(worldDir:string,worldId:string,annotations:AnnotationRow[],registry?:RegistryData|null):void{
 const db=openDatabase(worldDir,worldId);try{transaction(db,()=>{db.exec("DELETE FROM annotations; DELETE FROM entity_mentions; DELETE FROM entities;");
 const qa=db.prepare("INSERT INTO annotations(chunk_id,source,chapter,extracted_at,payload_json) VALUES(?,?,?,?,?)");
 for(const a of annotations)qa.run(a.chunkId,a.source,a.chapter??"",a.extractedAt??"",JSON.stringify(a));
 if(registry){const qe=db.prepare("INSERT INTO entities(entity_id,name,type,aliases_json,mention_count,payload_json) VALUES(?,?,?,?,?,?)");const qm=db.prepare("INSERT INTO entity_mentions(entity_id,chunk_id,source,chapter,evidence) VALUES(?,?,?,?,?)");
 for(const e of registry.entities){qe.run(e.id,e.name,e.type,JSON.stringify(e.aliases),e.mentions.length,JSON.stringify(e));for(const m of e.mentions)qm.run(e.id,m.chunkId,m.source,m.chapter,m.evidence);}}
 });}finally{db.close();}
}
export function readAnnotationsByChunkIds(worldDir:string,worldId:string,ids:string[]):Map<string,Record<string,unknown>>{
 const result=new Map<string,Record<string,unknown>>();if(!ids.length)return result;const db=openDatabase(worldDir,worldId);
 try{const n=Number((db.prepare("SELECT COUNT(*) AS count FROM annotations").get() as {count:number}).count);
 if(n===0){try{const legacy=JSON.parse(readFileSync(join(worldDir,"library","annotations.json"),"utf8")) as {annotations?:AnnotationRow[]};if(legacy.annotations?.length)syncAnnotations(worldDir,worldId,legacy.annotations,null);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
 const q=db.prepare("SELECT chunk_id,payload_json FROM annotations WHERE chunk_id=?");for(const id of ids){const row=q.get(id) as {chunk_id:string;payload_json:string}|undefined;if(row)result.set(row.chunk_id,JSON.parse(row.payload_json) as Record<string,unknown>);}return result;
 }finally{db.close();}
}
export function syncStoryState(worldDir:string,state:StoryState):void{
 const db=openDatabase(worldDir,state.worldId);try{transaction(db,()=>{
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
 const db=openDatabase(worldDir,worldId);try{const row=db.prepare("SELECT payload_json FROM story_state WHERE singleton=1").get() as {payload_json:string}|undefined;return row?JSON.parse(row.payload_json) as StoryState:undefined;}finally{db.close();}
}
export function databaseStatus(worldDir:string,worldId:string):DatabaseStatus{
 const db=openDatabase(worldDir,worldId);try{const count=(t:string)=>Number((db.prepare("SELECT COUNT(*) AS count FROM "+t).get() as {count:number}).count);return {path:join(worldDir,"novel.db"),schemaVersion:Number((db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version),chunks:count("library_chunks"),annotations:count("annotations"),entities:count("entities"),entityMentions:count("entity_mentions"),characters:count("characters"),canonFacts:count("canon_facts"),events:count("story_events"),plotThreads:count("plot_threads")};}finally{db.close();}
}
export function databaseWorldDirFromLibrary(libraryDir:string):string{return dirname(libraryDir);}
