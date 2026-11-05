#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
function value(name, fallback) { const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:fallback; }
const world=value("--world","conghuoniao"), source=value("--source"), context=value("--context"), brief=value("--brief");
const models=value("--models","").split(",").map(x=>x.trim()).filter(Boolean);
const maxWords=value("--max-words","3000"), repetitions=Number(value("--repetitions","1"));
if(!source||!brief||models.length<2){console.error('Usage: node scripts/compare-models.mjs --source ./private/previous-chapter.txt --brief "本章任务" --models model-a,model-b [--context file] [--world conghuoniao] [--max-words 3000] [--repetitions 1]');process.exit(2);}
if(!Number.isInteger(repetitions)||repetitions<1||repetitions>3)throw new Error("--repetitions must be 1..3");
const cwd=process.cwd(), runId=new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomUUID().slice(0,8);
const root=resolve(".output","model-comparison",runId); await mkdir(root,{recursive:true});
const mapping=[];let n=0;
for(const model of models)for(let repetition=1;repetition<=repetitions;repetition++){
 const id="candidate-"+String(++n).padStart(2,"0");
 const args=["run","dev","--","write","--world",world,"--mode","continuation","--source",resolve(source),"--brief",brief,"--model",model,"--max-words",maxWords,"--strict-model","--no-apply-state"];
 if(context)args.push("--context",resolve(context));
 const result=spawnSync("npm",args,{cwd,encoding:"utf8",maxBuffer:20*1024*1024});
 const log=(result.stdout??"")+"\n"+(result.stderr??""); await writeFile(resolve(root,id+".log"),log,"utf8");
 if(result.status!==0)throw new Error(model+" failed; inspect "+resolve(root,id+".log"));
 const match=log.match(/Saved chapter:\s*(.+)\s*$/m);if(!match)throw new Error("Cannot locate output path for "+model);
 const out=dirname(resolve(match[1].trim())), dest=resolve(root,id);await mkdir(dest,{recursive:true});
 for(const file of ["chapter.md","01-main-plot.md","02-creative-options.md","03-chapter-plan.md","04-scene-draft.md","05-dialogue-edited.md","06-voice-edited.md","07-continuity-review.md","08-state-update.json"]){
  try{await copyFile(resolve(out,file),resolve(dest,file));}catch(e){if(e.code!=="ENOENT")throw e;}
 }
 mapping.push({candidateId:id,model,repetition,sourceOutputDir:out});console.log(id+" completed ("+model+", "+repetition+"/"+repetitions+")");
}
await writeFile(resolve(root,"MODEL-MAPPING-PRIVATE.json"),JSON.stringify({runId,world,source:resolve(source),context:context?resolve(context):null,brief,maxWords:Number(maxWords),repetitions,candidates:mapping},null,2)+"\n");
console.log("\nCandidates: "+root+"\nPrivate mapping: "+resolve(root,"MODEL-MAPPING-PRIVATE.json")+"\nOnly share candidate-*/chapter.md with blind reviewer.");
