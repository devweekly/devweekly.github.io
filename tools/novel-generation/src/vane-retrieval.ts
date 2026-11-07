import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLibraryChunks } from "./library.js";
import type { CorpusCraftChapter } from "./corpus-craft.js";

type VaneCollection = {
  add(docs: Array<{id:string;text:string;vector:number[];meta?:Record<string,string|number|boolean>}>): Promise<unknown>;
  flush(): Promise<unknown>;
  search(query: {text:string;vector?:number[];topK:number;mode:"text"|"hybrid"}): Promise<Array<{id:string;score:number;fields?:Record<string,unknown>}>>;
  delete?(ids:string[]):Promise<unknown>;
};
type VaneDb = { collection(name:string,schema:unknown,options?:unknown):Promise<VaneCollection>; close():Promise<void> };
type VaneModule = { open(path:string,options?:unknown):Promise<VaneDb> };

function stableVector(text:string, dim=8): number[] {
  const bytes=createHash("sha256").update(text).digest();
  return Array.from({length:dim},(_,i)=>((bytes[i%bytes.length]??0)/127.5)-1);
}
async function embed(texts:string[]):Promise<number[][]|undefined> {
  const base=process.env.VANE_EMBEDDING_BASE_URL;
  const model=process.env.VANE_EMBEDDING_MODEL;
  if(!base||!model)return undefined;
  const response=await fetch(base.replace(/\/$/,"")+"/embeddings",{
    method:"POST",headers:{"content-type":"application/json",...(process.env.VANE_EMBEDDING_API_KEY?{authorization:"Bearer "+process.env.VANE_EMBEDDING_API_KEY}:{})},
    body:JSON.stringify({model,input:texts})
  });
  if(!response.ok)throw new Error("Embedding endpoint returned "+response.status);
  const payload=await response.json() as {data?:Array<{embedding?:number[]}>};
  if(!Array.isArray(payload.data)||payload.data.length!==texts.length||payload.data.some(x=>!Array.isArray(x.embedding)))throw new Error("Invalid embeddings response.");
  return payload.data.map(x=>x.embedding as number[]);
}
async function openVane(worldId:string,dim:number):Promise<{db:VaneDb;col:VaneCollection}> {
  let module:VaneModule;
  try { const packageName="@vane-rs/node"; const imported=await import(packageName) as {default?:unknown}; module=(imported.default??imported) as VaneModule; }
  catch { throw new Error("Vane 未安装。请在 tools/novel-generation 运行 npm install @vane-rs/node。"); }
  const dir=resolve("worlds",worldId,"vane-index");
  await mkdir(dir,{recursive:true});
  const db=await module.open(dir,{autoCommit:"off"});
  const col=await db.collection("novel-corpus-"+dim,{
    fields:[{name:"body",type:"text"},{name:"vec",type:"vector",dim,metric:"cosine"},{name:"kind",type:"scalar",kind:"keyword"},{name:"chapter",type:"scalar",kind:"keyword"},{name:"source",type:"scalar",kind:"keyword"}]
  },{tokenizer:"jieba"});
  return {db,col};
}
export async function rebuildVaneIndex(worldId:string,worldDir=resolve("worlds",worldId)):Promise<{documents:number;vectorMode:boolean}> {
  const dim=Number(process.env.VANE_EMBEDDING_DIM??8);
  const {db,col}=await openVane(worldId,dim);
  try {
    const indexDir=resolve(worldDir,"vane-index");
    try {
      const previous=JSON.parse(await readFile(resolve(indexDir,"manifest.json"),"utf8")) as {ids?:string[]};
      if(previous.ids?.length)await col.delete?.(previous.ids);
    }catch{/* first build or missing manifest */}
    const chunks=await loadLibraryChunks(resolve(worldDir,"library"),worldId);
    const docs:Array<{id:string;text:string;vector:number[];meta:Record<string,string|number|boolean>}>=[];
    for(const chunk of chunks)docs.push({
      id:"chunk:"+chunk.id,text:chunk.text,vector:stableVector(chunk.text,Number(process.env.VANE_EMBEDDING_DIM??8)),
      meta:{kind:"original",chapter:chunk.chapter,source:chunk.source}
    });
    const analysisDir=resolve("analysis",worldId,"corpus-craft","chapters");
    try {
      const {readdir}=await import("node:fs/promises");
      for(const file of (await readdir(analysisDir)).filter(x=>x.endsWith(".json"))){
        const item=JSON.parse(await readFile(resolve(analysisDir,file),"utf8")) as CorpusCraftChapter;
        if(item.worldId!==worldId)continue;
        const text=JSON.stringify(item);
        docs.push({id:"craft:"+item.chapterId,text,vector:stableVector(text,Number(process.env.VANE_EMBEDDING_DIM??8)),meta:{kind:"corpus-craft",chapter:item.chapterId}});
      }
    }catch{/* analysis is optional */}
    const vectors=await embed(docs.map(x=>x.text));
    if(vectors){
      const expected=vectors[0]?.length??0;
      if(!expected||vectors.some(v=>v.length!==expected))throw new Error("Embedding dimensions are inconsistent.");
      if(expected!==Number(process.env.VANE_EMBEDDING_DIM??8))throw new Error("Set VANE_EMBEDDING_DIM to "+expected+" before creating the Vane index.");
      vectors.forEach((vector,index)=>{docs[index]!.vector=vector;});
    }
    for(let offset=0;offset<docs.length;offset+=128)await col.add(docs.slice(offset,offset+128));
    await col.flush();
    const {writeFile}=await import("node:fs/promises");
    await writeFile(resolve(indexDir,"manifest.json"),JSON.stringify({worldId,updatedAt:new Date().toISOString(),ids:docs.map(doc=>doc.id),documents:docs.length,vectorMode:Boolean(vectors),embeddingModel:vectors?process.env.VANE_EMBEDDING_MODEL:null,dim},null,2)+"\n","utf8");
    return {documents:docs.length,vectorMode:Boolean(vectors)};
  }finally{await db.close();}
}
export async function searchVane(worldId:string,query:string,limit=6):Promise<Array<{id:string;score:number;text:string}>> {
  try{
    const manifestPath=resolve("worlds",worldId,"vane-index","manifest.json");
    let manifest:{dim?:number;vectorMode?:boolean;embeddingModel?:string|null}|undefined;
    try{manifest=JSON.parse(await readFile(manifestPath,"utf8")) as {dim?:number;vectorMode?:boolean;embeddingModel?:string|null};}catch{/* index not built yet */}
    const dim=manifest?.dim??Number(process.env.VANE_EMBEDDING_DIM??8);
    const {db,col}=await openVane(worldId,dim);
    try{
      const canUseVectors=Boolean(manifest?.vectorMode && manifest.embeddingModel && manifest.embeddingModel===process.env.VANE_EMBEDDING_MODEL);
      const vectors=canUseVectors?await embed([query]):undefined;
      const hits=await col.search({text:query,...(vectors?{vector:vectors[0]}:{}),topK:limit,mode:vectors?"hybrid":"text"});
      return hits.map(hit=>({id:hit.id,score:hit.score,text:String(hit.fields?.body??"")}));
    }finally{await db.close();}
  }catch(error){
    if(String(error).includes("Vane 未安装"))return [];
    throw error;
  }
}
