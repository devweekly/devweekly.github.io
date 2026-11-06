import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { databaseStatus, readAnnotationsByChunkIds, readStoryState, syncAnnotations, syncStoryState } from "../src/database.js";
import { emptyStoryState, loadStoryState } from "../src/story-state.js";
test("SQLite stores annotations, entities and normalized story state",async()=>{
 const root=await mkdtemp(join(tmpdir(),"novel-sqlite-"));
 try{const world=join(root,"worlds","test-world");
 const annotation={chunkId:"s:0:0",source:"s.txt",chapter:"第1章",extractedAt:"2026-11-05T00:00:00.000Z",entities:[{name:"李玄"}],events:[],relations:[],coreferences:[],evidenceReviews:[]};
 syncAnnotations(world,"test-world",[annotation],{entities:[{id:"ent_1",name:"李玄",type:"character",aliases:["玄"],mentions:[{chunkId:"s:0:0",source:"s.txt",chapter:"第1章",evidence:"李玄"}]}]});
 assert.equal(readAnnotationsByChunkIds(world,"test-world",["s:0:0"]).get("s:0:0")?.chunkId,"s:0:0");
 const state=emptyStoryState("test-world");state.characters.push({name:"李玄",status:"在旧城",location:"旧城",profile:{coreTraits:["谨慎"]}});
 state.canonFacts.push({id:"f1",fact:"城门在北面",confidence:"confirmed"});state.events.push({id:"e1",summary:"进入旧城",position:"第1章",participants:["李玄"],consequences:[]});
 state.plotThreads.push({id:"p1",title:"寻找密道",status:"open",lastUpdated:"第1章",notes:"尚未解决"});syncStoryState(world,state);
 assert.equal(readStoryState(world,"test-world")?.characters[0]?.name,"李玄");
 const s=databaseStatus(world,"test-world");assert.deepEqual([s.annotations,s.entities,s.entityMentions,s.characters,s.canonFacts,s.events,s.plotThreads],[1,1,1,1,1,1,1]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("SQLite database rejects cross-world reuse",async()=>{
 const root=await mkdtemp(join(tmpdir(),"novel-sqlite-world-"));try{const world=join(root,"world");syncStoryState(world,emptyStoryState("world-a"));assert.throws(()=>databaseStatus(world,"world-b"),/world mismatch/);}finally{await rm(root,{recursive:true,force:true});}
});
test("legacy story-state JSON migrates into SQLite on first load",async()=>{
 const root=await mkdtemp(join(tmpdir(),"novel-sqlite-migrate-"));try{const world=join(root,"worlds","legacy");await mkdir(world,{recursive:true});const state=emptyStoryState("legacy");state.currentPosition="第七章";
 await writeFile(join(world,"story-state.json"),JSON.stringify(state),"utf8");assert.equal((await loadStoryState(join(world,"story-state.json"),"legacy")).currentPosition,"第七章");assert.equal(readStoryState(world,"legacy")?.currentPosition,"第七章");
 }finally{await rm(root,{recursive:true,force:true});}
});

test("写作状态写入不触碰知识库文件",async()=>{
 const root=await mkdtemp(join(tmpdir(),"novel-split-"));try{
  const world=join(root,"world");
  syncAnnotations(world,"w",[],null);
  const before=readFileSync(join(world,"novel.db"));
  const state=emptyStoryState("w");state.currentPosition="第二章";state.characters.push({name:"李玄",status:"在旧城",location:"旧城",profile:{coreTraits:["谨慎"]}});
  syncStoryState(world,state);
  assert.ok(existsSync(join(world,"story.db")),"story.db 应被创建");
  assert.ok(before.equals(readFileSync(join(world,"novel.db"))),"知识库不应因状态写入而变化");
  assert.equal(readStoryState(world,"w")?.currentPosition,"第二章");
 }finally{await rm(root,{recursive:true,force:true});}
});
test("旧库里同库存储的状态表首次打开时迁移到 story.db",async()=>{
 const root=await mkdtemp(join(tmpdir(),"novel-legacy-state-"));try{
  const world=join(root,"world");
  syncAnnotations(world,"w",[],null);
  const legacy=emptyStoryState("w");legacy.currentPosition="第七章";
  const raw=new DatabaseSync(join(world,"novel.db"));
  raw.exec("CREATE TABLE story_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),updated_at TEXT NOT NULL,payload_json TEXT NOT NULL);"+
   "CREATE TABLE characters(name TEXT PRIMARY KEY,status TEXT NOT NULL,location TEXT,profile_json TEXT,payload_json TEXT NOT NULL);"+
   "CREATE TABLE canon_facts(id TEXT PRIMARY KEY,fact TEXT NOT NULL,confidence TEXT NOT NULL,source TEXT);"+
   "CREATE TABLE story_events(id TEXT PRIMARY KEY,summary TEXT NOT NULL,position TEXT NOT NULL,payload_json TEXT NOT NULL);"+
   "CREATE TABLE plot_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,last_updated TEXT NOT NULL,notes TEXT NOT NULL);"+
   "CREATE TABLE continuity_notes(ordinal INTEGER PRIMARY KEY,note TEXT NOT NULL);");
  raw.prepare("INSERT INTO story_state(singleton,updated_at,payload_json) VALUES(1,?,?)").run(legacy.updatedAt,JSON.stringify(legacy));
  raw.prepare("INSERT INTO characters(name,status,location,profile_json,payload_json) VALUES(?,?,?,?,?)").run("李玄","在旧城","旧城",JSON.stringify({coreTraits:["谨慎"]}),JSON.stringify({name:"李玄"}));
  raw.prepare("INSERT INTO continuity_notes(ordinal,note) VALUES(?,?)").run(0,"旧备注");
  raw.close();

  assert.equal(readStoryState(world,"w")?.currentPosition,"第七章");
  const migrated=new DatabaseSync(join(world,"story.db"));
  try{
   assert.equal(Number((migrated.prepare("SELECT COUNT(*) AS c FROM characters").get() as {c:number}).c),1);
   assert.equal((migrated.prepare("SELECT note FROM continuity_notes WHERE ordinal=0").get() as {note:string}).note,"旧备注");
  }finally{migrated.close();}
  const check=new DatabaseSync(join(world,"novel.db"));
  try{assert.equal(check.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='story_state'").get(),undefined,"旧表应已删除");}
  finally{check.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
