import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface WorkbenchRun { id:string; worldId:string; kind:"story-plan"; status:RunStatus; createdAt:string; updatedAt:string; error?:string; candidateId?:string; }
export interface StoryPlanCandidate { id:string; worldId:string; type:"story-plan"; status:"applied"|"superseded"|"pending"|"approved"|"rejected"|"changes_requested"; createdAt:string; updatedAt:string; baseUpdatedAt:string|null; plan:unknown; runId:string; reviewComment?:string; }
async function readJson<T>(path:string,fallback:T):Promise<T>{try{return JSON.parse(await readFile(path,"utf8")) as T;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return fallback;throw error;}}
async function atomicJson(path:string,value:unknown):Promise<void>{await mkdir(dirname(path),{recursive:true});const temporary=path+"."+process.pid+".tmp";await writeFile(temporary,JSON.stringify(value,null,2)+"\n","utf8");await rename(temporary,path);}
function root(worldId:string):string{return join(process.cwd(),".output",worldId,"workbench");}
function runPath(worldId:string,id:string):string{return join(root(worldId),"runs",id+".json");}
function candidatePath(worldId:string,id:string):string{return join(root(worldId),"candidates",id+".json");}
export async function saveRun(run:WorkbenchRun):Promise<void>{await atomicJson(runPath(run.worldId,run.id),run);}
export async function getRun(worldId:string,id:string):Promise<WorkbenchRun|undefined>{return readJson<WorkbenchRun|undefined>(runPath(worldId,id),undefined);}
export async function listRuns(worldId:string):Promise<WorkbenchRun[]>{const dir=join(root(worldId),"runs");try{const names=await readdir(dir);const rows=await Promise.all(names.filter(x=>x.endsWith(".json")).map(x=>readJson<WorkbenchRun|undefined>(join(dir,x),undefined)));return rows.filter((x):x is WorkbenchRun=>Boolean(x)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}}
export async function saveCandidate(candidate:StoryPlanCandidate):Promise<void>{await atomicJson(candidatePath(candidate.worldId,candidate.id),candidate);}
export async function getCandidate(worldId:string,id:string):Promise<StoryPlanCandidate|undefined>{return readJson<StoryPlanCandidate|undefined>(candidatePath(worldId,id),undefined);}
export async function listCandidates(worldId:string):Promise<StoryPlanCandidate[]>{const dir=join(root(worldId),"candidates");try{const names=await readdir(dir);const rows=await Promise.all(names.filter(x=>x.endsWith(".json")).map(x=>readJson<StoryPlanCandidate|undefined>(join(dir,x),undefined)));return rows.filter((x):x is StoryPlanCandidate=>Boolean(x)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}}
export async function recoverInterruptedRuns(worldId:string):Promise<number>{const runs=await listRuns(worldId);let recovered=0;for(const run of runs){if(run.status==="queued"||run.status==="running"){await saveRun({...run,status:"failed",error:"Server restarted before this run completed. Create a new candidate to retry.",updatedAt:new Date().toISOString()});recovered++;}}return recovered;}
