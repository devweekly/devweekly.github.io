import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { databaseStatus, readAnnotationsByChunkIds, readLibraryChunks, readStoryState, syncAnnotations, syncLibraryChunks, syncStoryState } from "../src/database.js";
import { emptyStoryState, loadStoryState } from "../src/story-state.js";
test("SQLite stores chunks, annotations, entities and normalized story state",async()=>{
 const root=await mkdtemp(join(tmpdir(),"novel-sqlite-"));
 try{const world=join(root,"worlds","test-world");const chunks=[{id:"s:0:0",source:"s.txt",chapter:"第1章",chunkIndex:0,start:0,end:4,text:"测试文本",sourceHash:"a".repeat(64),chapterStart:0}];
 syncLibraryChunks(world,"test-world",chunks);assert.deepEqual(readLibraryChunks(world,"test-world"),chunks);
 const annotation={chunkId:"s:0:0",source:"s.txt",chapter:"第1章",extractedAt:"2026-11-05T00:00:00.000Z",entities:[{name:"李玄"}],events:[],relations:[],coreferences:[],evidenceReviews:[]};
 syncAnnotations(world,"test-world",[annotation],{entities:[{id:"ent_1",name:"李玄",type:"character",aliases:["玄"],mentions:[{chunkId:"s:0:0",source:"s.txt",chapter:"第1章",evidence:"李玄"}]}]});
 assert.equal(readAnnotationsByChunkIds(world,"test-world",["s:0:0"]).get("s:0:0")?.chunkId,"s:0:0");
 const state=emptyStoryState("test-world");state.characters.push({name:"李玄",status:"在旧城",location:"旧城",profile:{coreTraits:["谨慎"]}});
 state.canonFacts.push({id:"f1",fact:"城门在北面",confidence:"confirmed"});state.events.push({id:"e1",summary:"进入旧城",position:"第1章",participants:["李玄"],consequences:[]});
 state.plotThreads.push({id:"p1",title:"寻找密道",status:"open",lastUpdated:"第1章",notes:"尚未解决"});syncStoryState(world,state);
 assert.equal(readStoryState(world,"test-world")?.characters[0]?.name,"李玄");
 const s=databaseStatus(world,"test-world");assert.deepEqual([s.chunks,s.annotations,s.entities,s.entityMentions,s.characters,s.canonFacts,s.events,s.plotThreads],[1,1,1,1,1,1,1,1]);
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
