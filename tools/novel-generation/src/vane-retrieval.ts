// Vane 本地向量混合检索适配层：把 library 切片与 corpus-craft 分析产物灌入 Vane 索引。
// 未配置真实 embedding 时用 SHA-256 派生的稳定伪向量兜底——索引可用但排序只有词面意义，
// 结果不能当语义检索引用。manifest 记录 embedding 模型与维度；模型不匹配时自动退回
// 纯文本检索，避免新旧向量混入同一索引。
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadLibraryChunks } from "./library.js";
import { buildAnalysisUnits, ensureSourceCanonLibraryIndex } from "./novel-kb.js";
import { ensureBoundedUniverseCanonAssets } from "./canon-source.js";
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
async function embed(
  texts:string[],
  context:{worldId:string;kind:"index-build"|"query";inputIds?:string[]}
):Promise<number[][]|undefined> {
  const base=process.env.VANE_EMBEDDING_BASE_URL;
  const model=process.env.VANE_EMBEDDING_MODEL;
  if(!base||!model)return undefined;
  const runId=randomUUID();
  const runDir=resolve(".output",context.worldId,"vane-embedding-runs",runId);
  const startedAt=new Date().toISOString();
  const endpoint=(()=>{try{const url=new URL(base);return url.origin+url.pathname;}catch{return "configured endpoint";}})();
  const runRecord={runId,worldId:context.worldId,kind:context.kind,status:"running",startedAt,model,endpoint,timeoutMs:Number(process.env.VANE_EMBEDDING_TIMEOUT_MS??30000),inputCount:texts.length};
  await mkdir(runDir,{recursive:true});
  await writeFile(resolve(runDir,"run.json"),JSON.stringify(runRecord,null,2)+"\n","utf8");
  await writeFile(resolve(runDir,"inputs.json"),JSON.stringify(texts.map((text,index)=>({
    id:context.inputIds?.[index]??String(index),text,sha256:createHash("sha256").update(text).digest("hex"),chars:text.length
  })),null,2)+"\n","utf8");
  const results:number[][]=[];
  let activeBatchDir:string|undefined;
  let activeBatchStartedAt:string|undefined;
  try {
    for(let offset=0;offset<texts.length;offset+=32){
      const batch=texts.slice(offset,offset+32);
      const batchNo=Math.floor(offset/32)+1;
      const batchDir=resolve(runDir,"batch-"+String(batchNo).padStart(3,"0"));
      activeBatchDir=batchDir;
      activeBatchStartedAt=new Date().toISOString();
      await mkdir(batchDir,{recursive:true});
      await writeFile(resolve(batchDir,"batch.json"),JSON.stringify({
        batchNo,offset,count:batch.length,status:"running",startedAt:activeBatchStartedAt
      },null,2)+"\n","utf8");
      const timeoutMs=Number(process.env.VANE_EMBEDDING_TIMEOUT_MS??30000);
      if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error("VANE_EMBEDDING_TIMEOUT_MS must be between 1000 and 300000.");
      const response=await fetch(base.replace(/\/$/,"")+"/embeddings",{
        method:"POST",headers:{"content-type":"application/json",...(process.env.VANE_EMBEDDING_API_KEY?{authorization:"Bearer "+process.env.VANE_EMBEDDING_API_KEY}:{})},
        body:JSON.stringify({model,input:batch}),signal:AbortSignal.timeout(timeoutMs)
      });
      if(!response.ok){const errorBody=await response.text();throw new Error("Embedding endpoint returned "+response.status+": "+errorBody.slice(0,4000));}
      const payload=await response.json() as {data?:Array<{embedding?:number[];index?:number}>;usage?:unknown};
      if(!Array.isArray(payload.data)||payload.data.length!==batch.length||payload.data.some(x=>!Array.isArray(x.embedding)))throw new Error("Invalid embeddings response.");
      const ordered=[...payload.data].sort((left,right)=>(left.index??0)-(right.index??0));
      const vectors=ordered.map(item=>item.embedding as number[]);
      await writeFile(resolve(batchDir,"vectors.json"),JSON.stringify({vectors,usage:payload.usage??null},null,2)+"\n","utf8");
      const completedAt=new Date().toISOString();
      await writeFile(resolve(batchDir,"batch.json"),JSON.stringify({
        batchNo,offset,count:batch.length,status:"completed",startedAt:activeBatchStartedAt,
        completedAt,dimensions:vectors[0]?.length??0
      },null,2)+"\n","utf8");
      activeBatchDir=undefined;
      activeBatchStartedAt=undefined;
      results.push(...vectors);
    }
    await writeFile(resolve(runDir,"run.json"),JSON.stringify({
      ...runRecord,status:"completed",updatedAt:new Date().toISOString(),dimensions:results[0]?.length??0
    },null,2)+"\n","utf8");
    return results;
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    if(activeBatchDir)await writeFile(resolve(activeBatchDir,"batch.json"),JSON.stringify({
      status:"failed",startedAt:activeBatchStartedAt,failedAt:new Date().toISOString(),error:message
    },null,2)+"\n","utf8").catch(()=>undefined);
    await writeFile(resolve(runDir,"failure.json"),JSON.stringify({error:message,failedAt:new Date().toISOString()},null,2)+"\n","utf8").catch(()=>undefined);
    await writeFile(resolve(runDir,"run.json"),JSON.stringify({
      ...runRecord,status:"failed",updatedAt:new Date().toISOString(),error:message
    },null,2)+"\n","utf8").catch(()=>undefined);
    throw error;
  }
}
async function openVane(worldId:string,dim:number,indexDir=resolve("worlds",worldId,"vane-index")):Promise<{db:VaneDb;col:VaneCollection}> {
  let module:VaneModule;
  try { const packageName="@vane-rs/node"; const imported=await import(packageName) as {default?:unknown}; module=(imported.default??imported) as VaneModule; }
  catch { throw new Error("Vane 未安装。请在 tools/novel-generation 运行 npm install @vane-rs/node。"); }
  await mkdir(indexDir,{recursive:true});
  const db=await module.open(indexDir,{autoCommit:"off"});
  try {
    const col=await db.collection("novel-corpus-"+dim,{
      fields:[{name:"body",type:"text"},{name:"vec",type:"vector",dim,metric:"cosine"},{name:"kind",type:"scalar",kind:"keyword"},{name:"chapter",type:"scalar",kind:"keyword"},{name:"source",type:"scalar",kind:"keyword"}]
    },{tokenizer:"jieba"});
    return {db,col};
  } catch (error) {
    await db.close().catch(()=>undefined);
    throw error;
  }
}
/** Publish a fully built Vane index directory; preserve the previous index if the switch fails. */
export async function publishVaneIndexDirectory(staging: string, indexDir: string): Promise<void> {
  const backup = indexDir + ".backup-" + process.pid + "-" + Date.now();
  let previousMoved = false;
  try {
    try {
      await rename(indexDir, backup);
      previousMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, indexDir);
    } catch (error) {
      if (previousMoved) {
        await rename(backup, indexDir);
        previousMoved = false;
      }
      throw error;
    }
    if (previousMoved) {
      previousMoved = false;
      await rm(backup, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    if (previousMoved) {
      try { await rename(backup, indexDir); } catch { /* keep backup for manual recovery */ }
    }
  }
}

export async function rebuildVaneIndex(worldId:string,worldDir=resolve("worlds",worldId)):Promise<{documents:number;vectorMode:boolean}> {
  await ensureBoundedUniverseCanonAssets(worldId, { projectRoot: resolve(worldDir, "..", ".."), worldDir });
  await ensureSourceCanonLibraryIndex(worldId, worldDir);
  const dim=Number(process.env.VANE_EMBEDDING_DIM??8);
  if(!Number.isInteger(dim)||dim<1||dim>4096)throw new Error("VANE_EMBEDDING_DIM must be an integer between 1 and 4096.");
  const indexDir=resolve(worldDir,"vane-index");
  await mkdir(dirname(indexDir),{recursive:true});
  const staging=await mkdtemp(join(dirname(indexDir),".vane-index.staging-"));
  let db:VaneDb|undefined;
  try {
    const opened=await openVane(worldId,dim,staging);
    db=opened.db;
    const col=opened.col;
    const chunks=await loadLibraryChunks(resolve(worldDir,"library"),worldId);
    const docs:Array<{id:string;text:string;vector:number[];meta:Record<string,string|number|boolean>}>=[];
    for(const chunk of chunks)docs.push({
      id:"chunk:"+chunk.id,text:chunk.text,vector:stableVector(chunk.text,dim),
      meta:{kind:"original",chapter:chunk.chapter,source:chunk.source}
    });
    const analysisDir=resolve(worldDir,"..","..","analysis",worldId,"corpus-craft","chapters");
    let sourceHashes = new Map<string,string>();
    try {
      const {units}=await buildAnalysisUnits(worldId,{worldDir});
      sourceHashes=new Map(units.map(unit=>[unit.chapterId,createHash("sha256").update(unit.text).digest("hex")]));
    } catch { /* if the bounded chapter catalog is unavailable, index original chunks only */ }
    try {
      const {readdir}=await import("node:fs/promises");
      for(const file of (await readdir(analysisDir)).filter(x=>x.endsWith(".json"))){
        const item=JSON.parse(await readFile(resolve(analysisDir,file),"utf8")) as CorpusCraftChapter;
        if(item.worldId!==worldId||sourceHashes.get(item.chapterId)!==item.sourceHash)continue;
        const text=JSON.stringify(item);
        docs.push({id:"craft:"+item.chapterId,text,vector:stableVector(text,dim),meta:{kind:"corpus-craft",chapter:item.chapterId}});
      }
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    }
    const vectors=await embed(docs.map(x=>x.text),{worldId,kind:"index-build",inputIds:docs.map(x=>x.id)});
    if(vectors){
      const expected=vectors[0]?.length??0;
      if(!expected||vectors.some(v=>v.length!==expected))throw new Error("Embedding dimensions are inconsistent.");
      if(expected!==dim)throw new Error("Set VANE_EMBEDDING_DIM to "+expected+" before creating the Vane index.");
      vectors.forEach((vector,index)=>{docs[index]!.vector=vector;});
    }
    for(let offset=0;offset<docs.length;offset+=128)await col.add(docs.slice(offset,offset+128));
    await col.flush();
    const {writeFile}=await import("node:fs/promises");
    await writeFile(resolve(staging,"manifest.json"),JSON.stringify({
      worldId,updatedAt:new Date().toISOString(),ids:docs.map(doc=>doc.id),
      documents:docs.length,vectorMode:Boolean(vectors),
      embeddingModel:vectors?process.env.VANE_EMBEDDING_MODEL:null,dim
    },null,2)+"\n","utf8");
    await db.close();
    db=undefined;
    await publishVaneIndexDirectory(staging,indexDir);
    return {documents:docs.length,vectorMode:Boolean(vectors)};
  } finally {
    if(db)await db.close().catch(()=>undefined);
    await rm(staging,{recursive:true,force:true});
  }
}

export function isVaneManifestUsable(manifest: unknown, worldId: string): manifest is { worldId: string; dim: number; ids: string[]; vectorMode?: boolean; embeddingModel?: string | null } {
  if (!manifest || typeof manifest !== "object") return false;
  const value = manifest as Record<string, unknown>;
  return value.worldId === worldId &&
    Number.isInteger(value.dim) && Number(value.dim) > 0 &&
    Array.isArray(value.ids) && value.ids.every(id => typeof id === "string");
}

export async function searchVane(worldId:string,query:string,limit=6):Promise<Array<{id:string;score:number;text:string}>> {
  try{
    const manifestPath=resolve("worlds",worldId,"vane-index","manifest.json");
    let rawManifest: unknown;
    try{rawManifest=JSON.parse(await readFile(manifestPath,"utf8")) as unknown;}catch{return [];}
    if (!isVaneManifestUsable(rawManifest, worldId)) return [];
    const manifest = rawManifest;
    const dim=manifest.dim;
    const {db,col}=await openVane(worldId,dim);
    try{
      const canUseVectors=Boolean(manifest?.vectorMode && manifest.embeddingModel && manifest.embeddingModel===process.env.VANE_EMBEDDING_MODEL);
      const vectors=canUseVectors?await embed([query],{worldId,kind:"query",inputIds:["query"]}):undefined;
      const hits=await col.search({text:query,...(vectors?{vector:vectors[0]}:{}),topK:limit,mode:vectors?"hybrid":"text"});
      return hits.map(hit=>({id:hit.id,score:hit.score,text:String(hit.fields?.body??"")}));
    }finally{await db.close();}
  }catch(error){
    if(String(error).includes("Vane 未安装"))return [];
    throw error;
  }
}
