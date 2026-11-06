import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadStoryPlan, saveStoryPlan, generateStoryPlan } from "./story-plan.js";
import { loadStoryState } from "./story-state.js";
import { readStoryAnalysis, listNovelCharacters, countNovelCharacters, readNovelCharacterWorkbenchDetail } from "./database.js";
import { buildStoryAnalysisContext } from "./story-analysis-context.js";
import { getCandidate, getRun, listCandidates, listRuns, recoverInterruptedRuns, saveCandidate, saveRun, type StoryPlanCandidate, type WorkbenchRun } from "./workbench-store.js";

const app=express();
app.disable("x-powered-by");
app.use((req,res,next)=>{
 const hostname=req.hostname.toLowerCase();
 if(!["127.0.0.1","localhost","::1","[::1]"].includes(hostname))return res.status(403).json({error:"Workbench only accepts loopback Host headers."});
 const origin=req.get("origin");
 if(origin){try{if(new URL(origin).host!==req.get("host"))return res.status(403).json({error:"Cross-origin requests are not allowed."});}catch{return res.status(403).json({error:"Invalid Origin header."});}}
 next();
});
app.use(express.json({limit:"2mb",strict:true}));
function worldIdOf(value:unknown):string{if(typeof value!=="string"||!/^[a-z0-9][a-z0-9-]*$/i.test(value))throw Object.assign(new Error("Invalid world id."),{status:400});return value;}
function recordId(value:unknown):string{if(typeof value!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw Object.assign(new Error("Invalid record id."),{status:400});return value;}
function worldDir(id:string):string{return path.resolve("worlds",id);}
function assertInsideWorld(id:string):void{if(!worldDir(id).startsWith(path.resolve("worlds")+path.sep))throw Object.assign(new Error("Invalid world path."),{status:400});}
async function listWorlds():Promise<Array<{id:string;title:string;hasStoryPlan:boolean}>>{
 const root=path.resolve("worlds");let entries:string[];try{entries=await readdir(root);}catch{return [];}
 const result=[];for(const id of entries.filter(x=>/^[a-z0-9][a-z0-9-]*$/i.test(x))){try{const bible=await readFile(path.join(root,id,"world-bible.md"),"utf8");let plan;try{plan=await loadStoryPlan(path.join(root,id,"story-plan.json"),id);}catch(error){console.warn("[workbench] Invalid Story Plan for "+id,error);}const title=bible.split("\n").find(x=>x.startsWith("# "))?.slice(2).trim()||id;result.push({id,title,hasStoryPlan:Boolean(plan)});}catch{/* Ignore non-world folders and invalid world metadata. */}}
 return result;
}
function sendError(res:Response,error:unknown):void{const status=Number((error as {status?:number})?.status)||500;res.status(status).json({error:error instanceof Error?error.message:String(error)});}
const worldQueues=new Map<string,Promise<void>>();
async function serializeWorld<T>(worldId:string,task:()=>Promise<T>):Promise<T>{
 const previous=worldQueues.get(worldId)??Promise.resolve();let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve;});const tail=previous.then(()=>current);
 worldQueues.set(worldId,tail);await previous;
 try{return await task();}finally{release();if(worldQueues.get(worldId)===tail)worldQueues.delete(worldId);}
}
app.get("/api/health",(_req,res)=>res.json({ok:true,service:"novel-generation-workbench"}));
app.get("/api/worlds",async(_req,res)=>{try{res.json({worlds:await listWorlds()});}catch(e){sendError(res,e);}});
app.get("/api/worlds/:worldId/dashboard",async(req,res)=>{try{const id=worldIdOf(req.params.worldId);assertInsideWorld(id);const [storyPlan,runs,candidates]=await Promise.all([loadStoryPlan(path.join(worldDir(id),"story-plan.json"),id),listRuns(id),listCandidates(id)]);res.json({worldId:id,storyPlan:storyPlan??null,counts:{running:runs.filter(x=>x.status==="queued"||x.status==="running").length,completedRuns:runs.filter(x=>x.status==="completed").length,failedRuns:runs.filter(x=>x.status==="failed").length},recentRuns:runs.slice(0,12),planVersions:candidates.map(candidate=>candidate.status==="pending"||candidate.status==="changes_requested"?{...candidate,status:"superseded"}:candidate).slice(0,20)});}catch(e){sendError(res,e);}});

app.get("/api/worlds/:worldId/characters",async(req,res)=>{try{const id=worldIdOf(req.params.worldId);assertInsideWorld(id);const query=typeof req.query.q==="string"?req.query.q:"";const requested=Number(req.query.limit??1000);const limit=Number.isFinite(requested)?Math.min(Math.max(Math.round(requested),1),5000):1000;const dir=worldDir(id);res.json({characters:listNovelCharacters(dir,id,{query,limit}),total:countNovelCharacters(dir,id)});}catch(e){sendError(res,e);}});
app.get("/api/worlds/:worldId/characters/:name",async(req,res)=>{try{const id=worldIdOf(req.params.worldId);assertInsideWorld(id);const name=decodeURIComponent(req.params.name);const detail=readNovelCharacterWorkbenchDetail(worldDir(id),id,name);if(!detail)return res.status(404).json({error:"Character not found."});res.json(detail);}catch(e){sendError(res,e);}});
app.get("/api/worlds/:worldId/candidates",async(req,res)=>{try{res.json({candidates:await listCandidates(worldIdOf(req.params.worldId))});}catch(e){sendError(res,e);}});
app.get("/api/worlds/:worldId/runs",async(req,res)=>{try{res.json({runs:await listRuns(worldIdOf(req.params.worldId))});}catch(e){sendError(res,e);}});

app.get("/api/candidates/:candidateId",async(req,res)=>{try{const id=worldIdOf(req.query.worldId);const candidate=await getCandidate(id,recordId(req.params.candidateId));if(!candidate)return res.status(404).json({error:"Candidate not found."});res.json({candidate});}catch(e){sendError(res,e);}});
app.get("/api/runs/:runId",async(req,res)=>{try{const id=worldIdOf(req.query.worldId);const run=await getRun(id,recordId(req.params.runId));if(!run)return res.status(404).json({error:"Run not found."});res.json({run});}catch(e){sendError(res,e);}});
app.post("/api/worlds/:worldId/story-plan/generate",async(req,res)=>{
 try{const id=worldIdOf(req.params.worldId);assertInsideWorld(id);const runId=randomUUID();const run:WorkbenchRun={id:runId,worldId:id,kind:"story-plan",status:"queued",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await saveRun(run);res.status(202).json({runId,status:"queued"});
 void serializeWorld(id,async()=>{try{await saveRun({...run,status:"running",updatedAt:new Date().toISOString()});const dir=worldDir(id);const [worldBible,state,previousPlan]=await Promise.all([readFile(path.join(dir,"world-bible.md"),"utf8"),loadStoryState(path.join(dir,"story-state.json"),id),loadStoryPlan(path.join(dir,"story-plan.json"),id)]);const query=[state.currentPosition,...state.plotThreads.map(x=>x.title),...state.characters.slice(0,16).map(x=>x.name)].join("\n");const storyAnalysisContext=buildStoryAnalysisContext(readStoryAnalysis(dir,id),query);const plan=await generateStoryPlan({worldId:id,worldBible,state,storyAnalysisContext,previousPlan,model:typeof req.body?.model==="string"?req.body.model:undefined});const now=new Date().toISOString();const activePlan={...plan,status:"active" as const,updatedAt:now};if(previousPlan){const historyDir=path.join(dir,"story-plan-history");await mkdir(historyDir,{recursive:true});const historyPath=path.join(historyDir,previousPlan.updatedAt.replace(/[^a-zA-Z0-9.-]/g,"_")+".json");await writeFile(historyPath,JSON.stringify(previousPlan,null,2)+"\n",{encoding:"utf8",flag:"wx"}).catch(error=>{if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;});}await saveStoryPlan(path.join(dir,"story-plan.json"),activePlan);const candidate:StoryPlanCandidate={id:randomUUID(),worldId:id,type:"story-plan",status:"applied",createdAt:now,updatedAt:now,baseUpdatedAt:previousPlan?.updatedAt??null,plan:activePlan,runId};await saveCandidate(candidate);await saveRun({...run,status:"completed",candidateId:candidate.id,updatedAt:now});}catch(error){await saveRun({...run,status:"failed",error:error instanceof Error?error.message:String(error),updatedAt:new Date().toISOString()});}});
 }catch(e){sendError(res,e);}
});
app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>sendError(res,error));
export function createApp(){return app;}
export async function recoverWorkbenchRuns():Promise<void>{const worlds=await listWorlds();await Promise.all(worlds.map(x=>recoverInterruptedRuns(x.id)));}
