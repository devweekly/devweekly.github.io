import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Collapse, Empty, Input, InputNumber, Modal, Progress, Select, Space, Tag, Typography, message } from "antd";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { getStoryExecutionActions, selectVisibleStoryExecution, shouldPollStoryExecution } from "./story-execution-state.js";
const { Title, Text, Paragraph } = Typography;
type Run = { id:string; storyUnitId?:string; kind?:string; status:string; createdAt:string; updatedAt:string; error?:string; outputDir?:string; chapterPath?:string; previousChapterPath?:string };
type Preview = { storyArc:string; chapterPlan:string; chapter:string };
type StoryExecution = {id:string;worldId:string;storyUnitId?:string;storyUnitTitle:string;mode:"complete_story"|"fixed_batch";targetChapterCount?:number;status:"queued"|"running"|"paused"|"completed"|"failed"|"cancelled"|"stalled";cancelRequested?:boolean;createdAt:string;updatedAt:string;completedAt?:string;currentRunId?:string;completedChapters:Array<{runId:string;chapterPath:string;completedAt:string}>;events?:Array<{at:string;type:string;message:string;runId?:string}>;lastAssessment?:string;nextDirection?:string;error?:string;brief:string;resumeCount:number};
type StoryUnitGenerationRun = {id:string;status:string;startedAt:string;updatedAt:string;error?:string;storyUnitId?:string|null};
type StoryUnitGenerationDetail = {run:StoryUnitGenerationRun;input:unknown;prompt:string|null;response:string|null;trace:{requestedModel?:string|null;attempts:Array<{model:string;mode:string;status:string;durationMs?:number;error?:string}>}|null;result:unknown;failure:unknown};
type StoryUnit = { id?:string; updatedAt?:string; canonTypeFit:{worldIdentity:string;supernaturalEngine:string;causalNecessity:string;removalTest:string}; supernaturalEngine:{phenomenon:string;rules:string[];boundaries:string[];cost:string[];observableEvidence:string;causalRole:string}; execution:{status:"not_started"|"in_progress"|"completed";completedChapterIds:string[];lastAssessment?:string;nextDirection?:string;assessedAt?:string;completedAt?:string;characterArcHistory?:Array<{chapterId:string;name:string;observedChange:string;futurePossibilities:string[];recordedAt:string}>}; title:string; storyCore:string; readerExperience:string; openingSituation:string; centralConflict:string; fruitOrSetting:{name:string;premise:string;abilitiesAndRules:string[];costsAndLimits:string[];historicalContext:string;geographyAndDailyLife:string;powerAndSocialRelations:string}; cultureAndFolklore:Array<{name:string;practice:string;originOrBelief:string;socialFunction:string;storyUse:string}>; taboosAndGhostStories:Array<{name:string;versions:string[];underlyingTruthOptions:string[];consequences:string;scenePotential:string}>; cast:Array<{name:string;role:string;status:string;desire:string;fearOrSecret:string;relationships:string[];possibleDevelopment:string[]}>; relationshipDynamics:string[]; storySpine:Array<{title:string;function:string;causalChange:string;involvedCharacters:string[];possibleArcs:string[];status?:"planned"|"in_progress"|"completed"|"replaced"}>; subplots:string[]; climax:string; endingAndAftermath:string; unresolvedQuestions:string[]; creativePossibilities:string[] };
type Universe = { id:string; sourceWorldId:string; name:string; type:string; entryChapter:string; entryChapterId?:string; entryOrdinal?:number; brief:string; createdAt:string; parentUniverseId?:string; forkPoint?:string; archivedAt?:string };
type ForkableRun = { id:string; chapterTitle:string; createdAt:string };
type BuildProgress = { current:number; total:number; label:string };
type KnowledgeBuild = { worldId:string; status:"queued"|"running"|"completed"|"partial"|"failed"|"interrupted"|"cancelled"; currentStep?:string; updatedAt:string; completedAt?:string; progress?:BuildProgress; steps:Array<{name:string;status:"running"|"completed"|"failed"|"skipped";exitCode?:number|null;output?:string;error?:string;progress?:BuildProgress}> };
async function api<T>(url:string, init?:RequestInit):Promise<T>{const response=await fetch(url,{headers:{"Content-Type":"application/json",...(init?.headers??{})},...init});const body=await response.json();if(!response.ok)throw new Error(body.error??response.statusText);return body as T;}
const emptyPreview:Preview={storyArc:"",chapterPlan:"",chapter:""};
export default function ChapterStudio({worldId}:{worldId:string}){
 const [activeWorldId,setActiveWorldId]=useState(worldId);
 const [universes,setUniverses]=useState<Universe[]>([]);
 const [sourceChapters,setSourceChapters]=useState<Array<{id:number;title:string;label:string}>>([]);
 const [sourceChapterError,setSourceChapterError]=useState("");
 const [entryChapterIndex,setEntryChapterIndex]=useState<number|undefined>();
 const [createOpen,setCreateOpen]=useState(false);
 const [universeName,setUniverseName]=useState("");
 const [entryChapter,setEntryChapter]=useState("");
 const [universeBrief,setUniverseBrief]=useState("");
 const [universeType,setUniverseType]=useState("free");
 const [creatingUniverse,setCreatingUniverse]=useState(false);
 const [buildKnowledgeOnCreate,setBuildKnowledgeOnCreate]=useState(true);
 const [forkOpen,setForkOpen]=useState(false);
 const [forkName,setForkName]=useState("");
 const [forkRunId,setForkRunId]=useState<string>();
 const [forkableRuns,setForkableRuns]=useState<ForkableRun[]>([]);
 const [forking,setForking]=useState(false);
 const [run,setRun]=useState<Run|null>(null);
 const [chapterRuns,setChapterRuns]=useState<Run[]>([]);
 const [worldActiveChapterRun,setWorldActiveChapterRun]=useState<Run|null>(null);
 const [batchCount,setBatchCount]=useState<number>(5);
 const [starting,setStarting]=useState(false);
 const [loading,setLoading]=useState(false);
 const [preview,setPreview]=useState<Preview>(emptyPreview);
 const [activeArc,setActiveArc]=useState("");
 const [notice,setNotice]=useState("");
 const [knowledgeBuild,setKnowledgeBuild]=useState<KnowledgeBuild|null>(null);
 const [storyUnit,setStoryUnit]=useState<StoryUnit|null>(null);
 const [storyUnitVersions,setStoryUnitVersions]=useState<Array<{versionId:string;createdAt:string;title:string;storyCore:string;centralConflict:string}>>([]);
 const [storyUnitGenerationRuns,setStoryUnitGenerationRuns]=useState<StoryUnitGenerationRun[]>([]);
 const [storyUnitGenerationDetail,setStoryUnitGenerationDetail]=useState<StoryUnitGenerationDetail|null>(null);
 const [storyUnits,setStoryUnits]=useState<Array<{id:string;title:string;updatedAt:string}>>([]);
 const [selectedStoryUnitId,setSelectedStoryUnitId]=useState<string|undefined>();
 const [historyScope,setHistoryScope]=useState<"current"|"legacy">("current");
 const [storyExecution,setStoryExecution]=useState<StoryExecution|null>(null);
 const [storyExecutionHistory,setStoryExecutionHistory]=useState<StoryExecution[]>([]);
 const [worldStoryExecutions,setWorldStoryExecutions]=useState<StoryExecution[]>([]);
 const [startingStoryExecution,setStartingStoryExecution]=useState(false);
 const [generatingStoryUnit,setGeneratingStoryUnit]=useState(false);
 const [startingKnowledgeBuild,setStartingKnowledgeBuild]=useState(false);
 const [cancellingKnowledgeBuild,setCancellingKnowledgeBuild]=useState(false);
 const refreshGeneration=useRef(0);
 const previewGeneration=useRef(0);
 const autoStoryUnitWorlds=useRef(new Set<string>());
 const knowledgeBuildActive=startingKnowledgeBuild||knowledgeBuild?.status==="queued"||knowledgeBuild?.status==="running";
 const storyUnitReady=Boolean(selectedStoryUnitId&&storyUnit?.id);
 const canonContractReady=Boolean(storyUnit&&storyUnit.canonTypeFit?.worldIdentity?.trim()&&storyUnit.canonTypeFit?.supernaturalEngine?.trim()&&storyUnit.canonTypeFit?.causalNecessity?.trim()&&storyUnit.canonTypeFit?.removalTest?.trim()&&storyUnit.supernaturalEngine?.phenomenon?.trim()&&storyUnit.supernaturalEngine?.rules?.length&&storyUnit.supernaturalEngine?.boundaries?.length&&storyUnit.supernaturalEngine?.cost?.length&&storyUnit.supernaturalEngine?.causalRole?.trim());
 const busy=run?.status==="queued"||run?.status==="running"||worldActiveChapterRun?.status==="queued"||worldActiveChapterRun?.status==="running";
 const activeStoryExecution=worldStoryExecutions.find(item=>["queued","running","paused"].includes(item.status));
 const batchRunning=activeStoryExecution?.mode==="fixed_batch"&&["queued","running"].includes(activeStoryExecution.status);
 const storyTaskBlocksWrites=Boolean(activeStoryExecution);
 const batchProgress={completed:activeStoryExecution?.completedChapters.length??0,total:activeStoryExecution?.targetChapterCount??0};
 const visibleStoryExecution=selectVisibleStoryExecution(worldStoryExecutions,storyExecution);
 const visibleStoryExecutionHistory=visibleStoryExecution?[visibleStoryExecution,...storyExecutionHistory.filter(item=>item.id!==visibleStoryExecution.id)]:storyExecutionHistory;
 const generationBlockReason=!activeWorldId?"请选择一个故事宇宙":
  storyTaskBlocksWrites?"存在尚未结束的完整故事任务；请先在页面顶部恢复或取消该任务":
  busy?"当前宇宙有章节任务正在执行，请等待完成":
  generatingStoryUnit?"正在准备完整故事单元":
  selectedStoryUnitId&&storyUnit&&!canonContractReady?"当前故事单元缺少原作类型契约或可验证的超凡因果机制；请先重新推演故事设计":
  activeWorldId!==worldId&&!storyUnitReady?"当前宇宙尚未准备好完整故事单元，系统正在自动创建；若失败，请在下方重新生成":
  storyUnit?.execution.status==="completed"?"当前故事单元已经自然收束，请创建新的故事单元继续":
  universes.find(item=>item.id===activeWorldId)?.archivedAt?"当前宇宙已归档，请先恢复宇宙":"";
 const refresh=async()=>{
  if(!activeWorldId)return;const requestId=++refreshGeneration.current;const previewRequestId=++previewGeneration.current;setLoading(true);
  try{
   const [runs,arc,tasks,allRuns]=await Promise.all([
    api<{runs:Run[]}>("/api/worlds/"+activeWorldId+"/runs?storyUnitId="+(historyScope==="legacy"?"legacy":selectedStoryUnitId??"legacy")),
    api<{storyArc:string}>("/api/worlds/"+activeWorldId+"/story-arc?storyUnitId="+(historyScope==="legacy"?"legacy":selectedStoryUnitId??"legacy")),
    api<{executions:StoryExecution[]}>("/api/worlds/"+activeWorldId+"/story-executions"),
    api<{runs:Run[]}>("/api/worlds/"+activeWorldId+"/runs")
   ]);
   if(requestId!==refreshGeneration.current)return;
   setActiveArc(arc.storyArc);
   setWorldStoryExecutions(tasks.executions);
   setWorldActiveChapterRun(allRuns.runs.find(item=>item.kind==="chapter"&&["queued","running"].includes(item.status))??null);
   const chosen=selectedStoryUnitId;
   const scopedExecutions=tasks.executions.filter(item=>historyScope==="legacy"?!item.storyUnitId:Boolean(chosen)&&item.storyUnitId===chosen);
   setStoryExecutionHistory(scopedExecutions);
   setStoryExecution(current=>current&&scopedExecutions.some(item=>item.id===current.id)?scopedExecutions.find(item=>item.id===current.id)??null:scopedExecutions[0]??null);
   const chapters=runs.runs.filter(x=>x.kind==="chapter").sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
   setChapterRuns(chapters);
   const latest=chapters.at(-1)??null;setRun(latest);
   if(latest){const p=await api<Preview>("/api/runs/"+latest.id+"/preview?worldId="+activeWorldId);if(requestId===refreshGeneration.current&&previewRequestId===previewGeneration.current)setPreview(p);}
   else if(requestId===refreshGeneration.current&&previewRequestId===previewGeneration.current)setPreview(emptyPreview);
  }catch(e){if(requestId===refreshGeneration.current)message.error(e instanceof Error?e.message:String(e));}
  finally{if(requestId===refreshGeneration.current)setLoading(false);}
 };
 useEffect(()=>{let cancelled=false;setActiveWorldId(worldId);setSelectedStoryUnitId(undefined);setStoryUnit(null);setStoryUnitVersions([]);setStoryUnits([]);setHistoryScope("current");setStoryExecution(null);setStoryExecutionHistory([]);setWorldStoryExecutions([]);setWorldActiveChapterRun(null);setRun(null);setPreview(emptyPreview);setUniverses([]);setSourceChapters([]);setSourceChapterError("");setEntryChapterIndex(undefined);setEntryChapter("");++refreshGeneration.current;++previewGeneration.current;
  void api<{universes:Universe[]}>("/api/worlds/"+worldId+"/universes").then(result=>{if(!cancelled)setUniverses(result.universes);}).catch(error=>{if(!cancelled){setUniverses([]);message.error(error instanceof Error?error.message:String(error));}});
  void api<{chapters:Array<{id:number;title:string;label:string}>}>("/api/worlds/"+worldId+"/source-chapters").then(result=>{if(!cancelled){setSourceChapters(result.chapters);setSourceChapterError("");}}).catch(error=>{if(!cancelled){setSourceChapters([]);setSourceChapterError(error instanceof Error?error.message:String(error));}});
  return()=>{cancelled=true;};
 },[worldId]);
 useEffect(()=>{void refresh();},[activeWorldId,selectedStoryUnitId,historyScope]);
 useEffect(()=>{if(!activeWorldId||!storyUnit?.id){setStoryUnitVersions([]);return;}let cancelled=false;fetch("/api/worlds/"+activeWorldId+"/story-units/"+storyUnit.id+"/versions").then(async response=>{const body=await response.json() as {versions?:Array<{versionId:string;createdAt:string;title:string;storyCore:string;centralConflict:string}>;error?:string};if(!response.ok)throw new Error(body.error??response.statusText);if(!cancelled)setStoryUnitVersions(body.versions??[]);}).catch(()=>{if(!cancelled)setStoryUnitVersions([]);});return()=>{cancelled=true;};},[activeWorldId,storyUnit?.id,storyUnit?.updatedAt]);
 useEffect(()=>{if(!activeWorldId){setStoryUnitGenerationRuns([]);return;}let cancelled=false;void api<{runs:StoryUnitGenerationRun[]}>("/api/worlds/"+activeWorldId+"/story-unit-generation-runs").then(result=>{if(!cancelled)setStoryUnitGenerationRuns(result.runs);}).catch(()=>{if(!cancelled)setStoryUnitGenerationRuns([]);});return()=>{cancelled=true;};},[activeWorldId,storyUnit?.id,storyUnit?.updatedAt,generatingStoryUnit]);
 useEffect(()=>{if(!activeWorldId)return;let cancelled=false;void Promise.all([
  api<{storyUnits:Array<{id:string;title:string;updatedAt:string}>}>("/api/worlds/"+activeWorldId+"/story-units"),
  api<{executions:StoryExecution[]}>("/api/worlds/"+activeWorldId+"/story-executions")
 ]).then(async([units,tasks])=>{
   if(cancelled)return;
   setStoryUnits(units.storyUnits);
   if(activeWorldId!==worldId&&units.storyUnits.length===0&&!universes.find(item=>item.id===activeWorldId)?.archivedAt&&!autoStoryUnitWorlds.current.has(activeWorldId)){
     autoStoryUnitWorlds.current.add(activeWorldId);
     setGeneratingStoryUnit(true);
     try{
       const created=await api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/generate",{method:"POST",body:"{}"});
       if(cancelled)return;
       setStoryUnit(created.storyUnit);
       if(created.storyUnit.id)setSelectedStoryUnitId(created.storyUnit.id);
       setStoryUnits([{id:created.storyUnit.id!,title:created.storyUnit.title,updatedAt:created.storyUnit.updatedAt??new Date().toISOString()}]);
     }catch(error){
       autoStoryUnitWorlds.current.delete(activeWorldId);
       if(!cancelled)message.error("自动建立完整故事单元失败："+(error instanceof Error?error.message:String(error)));
     }finally{if(!cancelled)setGeneratingStoryUnit(false);}
     return;
   }
   const chosen=selectedStoryUnitId&&units.storyUnits.some(x=>x.id===selectedStoryUnitId)?selectedStoryUnitId:units.storyUnits[0]?.id;
   if(historyScope==="current"&&chosen!==selectedStoryUnitId){setSelectedStoryUnitId(chosen);return;}
   setWorldStoryExecutions(tasks.executions);
   const scopedExecutions=tasks.executions.filter(item=>historyScope==="legacy"?!item.storyUnitId:Boolean(chosen)&&item.storyUnitId===chosen);
   setStoryExecutionHistory(scopedExecutions);
   setStoryExecution(current=>current&&scopedExecutions.some(item=>item.id===current.id)?scopedExecutions.find(item=>item.id===current.id)??null:scopedExecutions[0]??null);
   if(historyScope==="current"&&chosen){
     try{const result=await api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/"+chosen);if(!cancelled)setStoryUnit(result.storyUnit);}
     catch{if(!cancelled)setStoryUnit(null);}
   }
  }).catch(()=>{if(!cancelled){setStoryUnit(null);setStoryUnits([]);setSelectedStoryUnitId(undefined);setStoryExecution(null);setStoryExecutionHistory([]);setWorldStoryExecutions([]);}});
  return()=>{cancelled=true;};},[activeWorldId,selectedStoryUnitId,historyScope]);
 useEffect(()=>{
  if(!activeWorldId||!activeStoryExecution||!shouldPollStoryExecution(activeStoryExecution.status))return;
  let cancelled=false;
  const executionId=activeStoryExecution.id;
  const timer=window.setInterval(()=>void api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/story-executions/"+executionId)
   .then(result=>{
    if(cancelled)return;
    setStoryExecution(current=>current?.id===executionId?result.execution:current);
    setStoryExecutionHistory(items=>items.map(item=>item.id===executionId?result.execution:item));
    setWorldStoryExecutions(items=>items.map(item=>item.id===executionId?result.execution:item));
    if(["completed","failed","paused","cancelled","stalled"].includes(result.execution.status)){
     const belongsToVisibleScope=historyScope==="legacy"?!result.execution.storyUnitId:result.execution.storyUnitId===selectedStoryUnitId;
     if(belongsToVisibleScope)void refresh();
     if(result.execution.storyUnitId&&result.execution.storyUnitId===selectedStoryUnitId){
      void api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/"+selectedStoryUnitId).then(x=>{if(!cancelled)setStoryUnit(x.storyUnit);});
     }
    }
   }).catch(()=>{}),2500);
  return()=>{cancelled=true;window.clearInterval(timer);};
 },[activeWorldId,selectedStoryUnitId,historyScope,activeStoryExecution?.id,activeStoryExecution?.status]);
 useEffect(()=>{
  if(!activeWorldId||!worldActiveChapterRun)return;
  let cancelled=false;
  const id=worldActiveChapterRun.id;
  const timer=window.setInterval(()=>void api<{run:Run}>("/api/runs/"+id+"?worldId="+activeWorldId)
   .then(result=>{
    if(cancelled)return;
    const active=["queued","running"].includes(result.run.status)?result.run:null;
    setWorldActiveChapterRun(active);
    if(!active)void refresh();
   }).catch(()=>{}),2000);
  return()=>{cancelled=true;window.clearInterval(timer);};
 },[activeWorldId,worldActiveChapterRun?.id,worldActiveChapterRun?.status]);
 useEffect(()=>{
  if(!busy||!run||worldActiveChapterRun?.id!==run.id)return;
  let cancelled=false;
  const timer=window.setInterval(()=>{
   void Promise.all([
    api<{run:Run}>("/api/runs/"+run.id+"?worldId="+activeWorldId),
    api<Preview>("/api/runs/"+run.id+"/preview?worldId="+activeWorldId)
   ]).then(([r,p])=>{if(cancelled)return;setRun(r.run);setPreview(p);if(r.run.status==="completed"||r.run.status==="failed"){void Promise.all([api<{storyArc:string}>("/api/worlds/"+activeWorldId+"/story-arc?storyUnitId="+(historyScope==="legacy"?"legacy":selectedStoryUnitId??"legacy")),api<{runs:Run[]}>("/api/worlds/"+activeWorldId+"/runs?storyUnitId="+(historyScope==="legacy"?"legacy":selectedStoryUnitId??"legacy"))]).then(([arc,runs])=>{if(cancelled)return;setActiveArc(arc.storyArc);setChapterRuns(runs.runs.filter(x=>x.kind==="chapter").sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));if(r.run.storyUnitId&&r.run.storyUnitId===selectedStoryUnitId)void api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/"+selectedStoryUnitId).then(result=>{if(!cancelled)setStoryUnit(result.storyUnit);});});}}).catch(()=>{});
  },2000);
  return()=>{cancelled=true;window.clearInterval(timer);};
 },[busy,run?.id,worldActiveChapterRun?.id,activeWorldId,selectedStoryUnitId,historyScope]);
 const selectChapter=async(id:string)=>{
  const selected=chapterRuns.find(item=>item.id===id);if(!selected)return;
  const requestId=++previewGeneration.current;
  setRun(selected);setPreview(emptyPreview);
  try{const preview=await api<Preview>("/api/runs/"+selected.id+"/preview?worldId="+activeWorldId);if(requestId===previewGeneration.current)setPreview(preview);}
  catch(e){if(requestId===previewGeneration.current)message.error(e instanceof Error?e.message:String(e));}
 };
 const moveChapter=(offset:number)=>{
  if(!run)return;const ordered=chapterRuns.filter(item=>item.status==="completed"||item.id===run.id);
  const index=ordered.findIndex(item=>item.id===run.id);const target=ordered[index+offset];if(target)void selectChapter(target.id);
 };
 const generate=async()=>{
  setHistoryScope(selectedStoryUnitId?"current":"legacy");
  setNotice("");setStarting(true);
  try{const data=await api<{run:Run}>("/api/worlds/"+activeWorldId+"/chapters/generate",{method:"POST",body:JSON.stringify({storyUnitId:selectedStoryUnitId})});setRun(data.run);message.success("已启动：自动检查、滚动规划、续写、终审和状态更新。");}
  catch(e){const text=e instanceof Error?e.message:String(e);setNotice(text);message.error(text);}
  finally{setStarting(false);}
 };
 const generateBatch=async()=>{
  if(batchRunning||busy)return;
  setHistoryScope(selectedStoryUnitId?"current":"legacy");
  setStartingStoryExecution(true);
  try{
   const result=await api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/chapter-batches",{method:"POST",body:JSON.stringify({chapterCount:batchCount,storyUnitId:selectedStoryUnitId})});
   setStoryExecution(result.execution);setStoryExecutionHistory(items=>[result.execution,...items.filter(item=>item.id!==result.execution.id)]);setWorldStoryExecutions(items=>[result.execution,...items.filter(item=>item.id!==result.execution.id)]);
   message.success("连续生成任务已交给服务端；刷新或关闭页面不会中断。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setStartingStoryExecution(false);}
 };
 const activeUniverse=universes.find(item=>item.id===activeWorldId);
 useEffect(()=>{
  let disposed=false;
  if(!activeUniverse){setKnowledgeBuild(null);return;}
  const load=()=>api<{build:KnowledgeBuild|null}>("/api/worlds/"+activeWorldId+"/knowledge-build")
   .then(result=>{if(!disposed){setKnowledgeBuild(result.build);if(result.build?.status==="cancelled")setCancellingKnowledgeBuild(false);}}).catch(()=>{});
  void load();
  const timer=window.setInterval(load,2000);
  return()=>{disposed=true;window.clearInterval(timer);};
 },[activeWorldId,activeUniverse?.id]);
 const generateStoryUnit=async(createNew=false)=>{
  setGeneratingStoryUnit(true);
  try{
   const result=await api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/generate",{method:"POST",body:JSON.stringify({storyUnitId:createNew?undefined:selectedStoryUnitId})});
   setStoryUnit(result.storyUnit);if(result.storyUnit.id)setSelectedStoryUnitId(result.storyUnit.id);void api<{storyUnits:Array<{id:string;title:string;updatedAt:string}>}>("/api/worlds/"+activeWorldId+"/story-units").then(x=>setStoryUnits(x.storyUnits));message.success("完整故事单元设计已生成并保存。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setGeneratingStoryUnit(false);}
 };
 const openStoryUnitGenerationRun=async(runId:string)=>{
  try{const detail=await api<StoryUnitGenerationDetail>("/api/worlds/"+activeWorldId+"/story-unit-generation-runs/"+runId);setStoryUnitGenerationDetail(detail);}
  catch(error){message.error(error instanceof Error?error.message:String(error));}
 };
 const restoreStoryUnitVersion=(versionId:string)=>{
  Modal.confirm({title:"恢复这版故事设计？",content:"当前设计会先自动存为一个新历史版本，之后仍可恢复。执行中的章节或故事任务不能被覆盖。",okText:"恢复版本",cancelText:"取消",onOk:async()=>{
   try{const result=await api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/"+selectedStoryUnitId+"/versions/"+versionId+"/restore",{method:"POST",body:"{}"});setStoryUnit(result.storyUnit);message.success("故事设计已恢复，原设计已另存为历史版本。");}
   catch(e){message.error(e instanceof Error?e.message:String(e));throw e;}
  }});
 };
 const startCompleteStory=async()=>{
  setHistoryScope(selectedStoryUnitId?"current":"legacy");
  setStartingStoryExecution(true);
  try{
   const result=await api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/story-executions",{method:"POST",body:JSON.stringify({storyUnitId:selectedStoryUnitId})});
   setStoryExecution(result.execution);setStoryExecutionHistory(items=>[result.execution,...items.filter(item=>item.id!==result.execution.id)]);setWorldStoryExecutions(items=>[result.execution,...items.filter(item=>item.id!==result.execution.id)]);message.success("完整故事已交给服务端执行；关闭页面不会中断任务。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setStartingStoryExecution(false);}
 };
 const controlStoryExecution=async(action:"pause"|"resume"|"cancel")=>{
   const target=visibleStoryExecution;
   if(!target)return;
   try{
    const result=await api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/story-executions/"+target.id+"/"+action,{method:"POST",body:"{}"});
   setStoryExecution(result.execution);setStoryExecutionHistory(items=>items.map(item=>item.id===result.execution.id?result.execution:item));setWorldStoryExecutions(items=>items.map(item=>item.id===result.execution.id?result.execution:item));
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
 };
 const startKnowledgeBuild=async()=>{
  setStartingKnowledgeBuild(true);
  setCancellingKnowledgeBuild(false);
  try{
   const result=await api<{build:KnowledgeBuild}>("/api/worlds/"+activeWorldId+"/knowledge-build",{method:"POST",body:"{}"});
   setKnowledgeBuild(result.build);
   message.success("知识构建任务已在后台启动。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setStartingKnowledgeBuild(false);}
 };
 const cancelKnowledgeBuild=async()=>{
  setCancellingKnowledgeBuild(true);
  try{
   const result=await api<{build:KnowledgeBuild;cancelling?:boolean}>("/api/worlds/"+activeWorldId+"/knowledge-build/cancel",{method:"POST",body:"{}"});
   setKnowledgeBuild(result.build);
   if(!result.cancelling){setCancellingKnowledgeBuild(false);message.success("知识构建已取消。");}
   else message.info("正在终止当前构建步骤；已完成步骤会保留。");
  }catch(e){setCancellingKnowledgeBuild(false);message.error(e instanceof Error?e.message:String(e));}
 };
 const changeArchive=async(archived:boolean)=>{
  if(!activeUniverse)return;
  try{
   const result=await api<{universe:Universe}>("/api/worlds/"+activeWorldId+"/universe-archive",{method:"PATCH",body:JSON.stringify({archived})});
   setUniverses(current=>current.map(item=>item.id===activeWorldId?result.universe:item));
   message.success(archived?"故事宇宙已归档。":"故事宇宙已恢复。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
 };
 const universeDepth=(item:Universe):number=>{
  let depth=0;let parent=item.parentUniverseId;const seen=new Set<string>();
  while(parent&&!seen.has(parent)&&depth<20){seen.add(parent);const found=universes.find(x=>x.id===parent);if(!found)break;depth++;parent=found.parentUniverseId;}
  return depth;
 };
 const createUniverse=async()=>{
  setCreatingUniverse(true);
  try{
   const result=await api<{universe:Universe;knowledgeBuild?:KnowledgeBuild|null}>("/api/worlds/"+worldId+"/universes",{method:"POST",body:JSON.stringify({name:universeName,entryChapter,entryChapterIndex,brief:universeBrief,type:universeType,buildKnowledge:buildKnowledgeOnCreate})});
   setUniverses(current=>[...current,result.universe]);setKnowledgeBuild(result.knowledgeBuild??null);setActiveWorldId(result.universe.id);setCreateOpen(false);
   setUniverseName("");setEntryChapter("");setEntryChapterIndex(undefined);setUniverseBrief("");setUniverseType("free");
   message.success("独立故事宇宙已创建。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setCreatingUniverse(false);}
 };
 const openFork=async()=>{
  try{
   const data=await api<{chapters:ForkableRun[]}>("/api/worlds/"+activeWorldId+"/forkable-chapters");
   setForkableRuns(data.chapters);setForkRunId(data.chapters[0]?.id);setForkName("");setForkOpen(true);
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
 };
 const createFork=async()=>{
  if(!forkRunId)return;
  setForking(true);
  try{
   const data=await api<{universe:Universe}>("/api/worlds/"+activeWorldId+"/universes/fork",{method:"POST",body:JSON.stringify({name:forkName,chapterRunId:forkRunId})});
   setUniverses(current=>[...current,data.universe]);setActiveWorldId(data.universe.id);setForkOpen(false);
   message.success("已从所选章节创建独立分支宇宙。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setForking(false);}
 };
 return <div className="chapter-studio">
  <section className="chapter-hero">
   <Text type="secondary">ROLLING STORY ARC</Text>
   <Title level={2}>继续写下一章</Title>
   <Paragraph type="secondary">系统先维护一个有因果关系的中期故事阶段，再从中选择下一章。每章完成后自动更新人物、事件和后续计划；正文可以推动计划调整，不需要人工审批。</Paragraph>
   <Space wrap>
    <Select style={{minWidth:220}} value={activeWorldId} onChange={setActiveWorldId} options={[{value:worldId,label:"原文项目（现有续写）"},...universes.map(u=>({value:u.id,label:(u.archivedAt?"[已归档] ":"")+u.name+" · 从"+u.entryChapter+"开始"}))]} />
    <Button onClick={()=>setCreateOpen(true)}>新建故事宇宙</Button>
    {activeWorldId!==worldId&&!activeUniverse?.archivedAt&&<Button onClick={()=>void openFork()} disabled={Boolean(busy)||storyTaskBlocksWrites||knowledgeBuildActive}>从本宇宙分叉</Button>}
    {activeUniverse&&(activeUniverse.archivedAt?<Button onClick={()=>void changeArchive(false)} disabled={storyTaskBlocksWrites||Boolean(busy)||knowledgeBuildActive}>恢复宇宙</Button>:<Button danger onClick={()=>void changeArchive(true)} disabled={Boolean(busy)||storyTaskBlocksWrites||knowledgeBuildActive}>归档当前宇宙</Button>)}
    <Button type="primary" size="large" className="chapter-action" icon={<PlayCircleOutlined/>} loading={starting||Boolean(busy)} disabled={!activeWorldId||Boolean(busy)||batchRunning||storyTaskBlocksWrites||generatingStoryUnit||(activeWorldId!==worldId&&!storyUnitReady)||(Boolean(selectedStoryUnitId)&&!canonContractReady)||storyUnit?.execution.status==="completed"||Boolean(activeUniverse?.archivedAt)} onClick={()=>void generate()}>生成下一章</Button>
    <Space.Compact><InputNumber min={1} value={batchCount} onChange={value=>setBatchCount(value??1)} disabled={batchRunning||Boolean(busy)||storyTaskBlocksWrites||storyUnit?.execution.status==="completed"} style={{width:76}}/><Button loading={batchRunning||startingStoryExecution&&activeStoryExecution?.mode==="fixed_batch"} disabled={!activeWorldId||Boolean(busy)||batchRunning||storyTaskBlocksWrites||generatingStoryUnit||(activeWorldId!==worldId&&!storyUnitReady)||(Boolean(selectedStoryUnitId)&&!canonContractReady)||storyUnit?.execution.status==="completed"||startingStoryExecution||Boolean(activeUniverse?.archivedAt)} onClick={()=>void generateBatch()}>连续生成多章</Button></Space.Compact>
    <Button icon={<ReloadOutlined/>} loading={loading} onClick={()=>void refresh()}>刷新状态</Button>
    {busy&&<Tag color="processing">{worldActiveChapterRun&&worldActiveChapterRun.storyUnitId!==selectedStoryUnitId?"当前宇宙另一故事单元正在生成":"正在自动创作"}</Tag>}
    {batchRunning&&<Tag color="processing">批量进度 {batchProgress.completed}/{batchProgress.total}</Tag>}
   </Space>
  </section>
  {visibleStoryExecution&&["queued","running","paused"].includes(visibleStoryExecution.status)&&<Alert
   style={{marginBottom:18}}
   type={visibleStoryExecution.status==="paused"?"warning":"info"}
   showIcon
   message={visibleStoryExecution.status==="paused"?"故事任务已暂停，当前写入锁由该任务持有":"当前故事任务正在执行，单章和批量写入暂不可启动"}
   description={visibleStoryExecution.status==="paused"
    ?"服务重启后任务已安全停在检查点。可以从检查点恢复，也可以取消残留任务以释放写入锁。知识构建状态与此锁相互独立。"
    :`任务：${visibleStoryExecution.storyUnitTitle} · 已完成 ${visibleStoryExecution.completedChapters.length} 章。可在此暂停或取消。`}
   action={<Space wrap>
    {getStoryExecutionActions(visibleStoryExecution.status).includes("resume")&&<Button size="small" type="primary" onClick={()=>void controlStoryExecution("resume")}>从检查点恢复</Button>}
    {getStoryExecutionActions(visibleStoryExecution.status).includes("pause")&&<Button size="small" onClick={()=>void controlStoryExecution("pause")}>暂停</Button>}
    {getStoryExecutionActions(visibleStoryExecution.status).includes("cancel")&&<Button size="small" danger onClick={()=>void controlStoryExecution("cancel")}>取消并释放写入锁</Button>}
   </Space>}
  />}
  {!visibleStoryExecution&&generationBlockReason&&<Alert style={{marginBottom:18}} type="warning" showIcon message="当前不能启动下一章" description={generationBlockReason}/>}
  <Card title="故事宇宙分支" style={{marginBottom:18}}>
   {universes.length===0?<Empty description="还没有独立故事宇宙。可以从原文项目选择章节创建。"/>:
    <Space direction="vertical" style={{width:"100%"}} size="small">
     {universes.map(item=><div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",paddingLeft:10+universeDepth(item)*22,borderLeft:"2px solid #d9d9d9",background:item.id===activeWorldId?"#f5f7fa":"transparent",borderRadius:4}}>
      <div style={{flex:1,minWidth:0}}>
       <Space wrap size={6}><Text strong>{item.name}</Text>{item.archivedAt&&<Tag>已归档</Tag>}{item.parentUniverseId&&<Tag color="blue">分叉</Tag>}</Space>
       <div><Text type="secondary" style={{fontSize:12}}>起点：{item.entryChapter}{item.forkPoint?" · 分叉点："+item.forkPoint.slice(0,8):""}</Text></div>
      </div>
      <Button size="small" type={item.id===activeWorldId?"primary":"default"} onClick={()=>setActiveWorldId(item.id)}>{item.id===activeWorldId?"当前":"打开"}</Button>
     </div>)}
    </Space>}
  </Card>
  {activeUniverse&&<Card title="原著知识与语料构建" style={{marginBottom:18}}>
   <Space direction="vertical" style={{width:"100%"}} size="middle">
    <Paragraph type="secondary" style={{marginBottom:0}}>优先复用原著已有的离线分析，并按当前宇宙起点过滤；只补齐缺失的人物画像、人物逐章状态、主线与伏笔分析、Corpus Craft 素材和 Vane 检索索引。所有输入均来自该宇宙自己的截断原文资料，不继承起点之后的剧情。此任务在后台运行，不是开始写作的前置条件。</Paragraph>
    <Space wrap>
     <Tag color={knowledgeBuild?.status==="completed"?"success":knowledgeBuild?.status==="failed"?"error":knowledgeBuild?.status==="partial"||knowledgeBuild?.status==="interrupted"?"warning":knowledgeBuild?.status==="running"||knowledgeBuild?.status==="queued"?"processing":"default"}>
      {knowledgeBuild?.status==="completed"?"已完成":knowledgeBuild?.status==="failed"?"构建失败":knowledgeBuild?.status==="partial"?"部分完成":knowledgeBuild?.status==="interrupted"?"已中断（服务重启）":knowledgeBuild?.status==="cancelled"?"已取消":knowledgeBuild?.status==="running"?"正在构建":knowledgeBuild?.status==="queued"?"排队中":"尚未构建"}
     </Tag>
     {knowledgeBuild?.currentStep&&<Text type="secondary">当前步骤：{knowledgeBuild.currentStep}</Text>}
     {knowledgeBuild?.updatedAt&&<Text type="secondary">更新于 {new Date(knowledgeBuild.updatedAt).toLocaleString()}</Text>}
    </Space>
    {knowledgeBuild?.progress&&["queued","running"].includes(knowledgeBuild.status)&&<Progress
     percent={Math.round(knowledgeBuild.progress.current/Math.max(1,knowledgeBuild.progress.total)*100)}
     status="active"
     format={()=>`${knowledgeBuild.progress?.label??"进度"} ${knowledgeBuild.progress?.current??0}/${knowledgeBuild.progress?.total??0}`}
    />}
    <Space wrap>
     <Button onClick={()=>void startKnowledgeBuild()} loading={startingKnowledgeBuild} disabled={startingKnowledgeBuild||knowledgeBuild?.status==="queued"||knowledgeBuild?.status==="running"||cancellingKnowledgeBuild}>
      {knowledgeBuild?.status==="failed"||knowledgeBuild?.status==="partial"||knowledgeBuild?.status==="interrupted"||knowledgeBuild?.status==="cancelled"?"从检查点继续构建":"构建知识资料"}
     </Button>
     {["queued","running","interrupted"].includes(knowledgeBuild?.status??"")&&<Button danger loading={cancellingKnowledgeBuild} disabled={cancellingKnowledgeBuild} onClick={()=>void cancelKnowledgeBuild()}>{knowledgeBuild?.status==="interrupted"?"清理中断任务":"取消构建"}</Button>}
    </Space>
     {knowledgeBuild && knowledgeBuild.steps.length > 0 && <Space direction="vertical" style={{width:"100%"}} size="small">
     {knowledgeBuild.steps.map((step,index)=><div key={step.name+"-"+index} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
      <Tag color={step.status==="completed"?"success":step.status==="failed"?"error":step.status==="running"?"processing":"default"}>{step.status==="completed"?"完成":step.status==="failed"?"失败":step.status==="running"?"执行中":"跳过"}</Tag>
      <div style={{flex:1,minWidth:0}}>
       <Text>{step.name}</Text>
       {step.progress&&<Text type="secondary" style={{fontSize:12}}> · {step.progress.current}/{step.progress.total} {step.progress.label}</Text>}
       {step.error&&<Paragraph type="danger" style={{fontSize:12,whiteSpace:"pre-wrap",marginBottom:4}}>{step.error}</Paragraph>}
      </div>
     </div>)}
    </Space>}
    {knowledgeBuild?.status==="partial"&&<Alert type="warning" showIcon message="部分资料未能构建" description="已成功的分析结果仍可使用；修复失败步骤后可重新构建。"/>}
    {knowledgeBuild?.status==="failed"&&<Alert type="error" showIcon message="知识构建未完成" description="章节写作仍可继续；修复失败步骤后可重新构建。"/>}
    {knowledgeBuild?.status==="interrupted"&&<Alert type="warning" showIcon message="上次构建被服务重启中断" description="已完成步骤会从检查点保留；继续构建只会重试中断步骤及后续未完成步骤。"/>}
    {knowledgeBuild?.status==="cancelled"&&<Alert type="info" showIcon message="知识构建已取消" description="已完成步骤保留；再次启动将从第一个未完成步骤继续。"/>}
   </Space>
  </Card>}
  {notice&&<Alert type="warning" showIcon message="本次任务未能启动" description={notice} style={{marginBottom:18}}/>}
  <Card title="完整故事单元" style={{marginBottom:18}}>
   <Text type="secondary">选择具体故事单元后，完整故事和连续章节任务会使用该单元独立的剧情状态与滚动阶段。单章续写、批量生成和完整故事执行均绑定当前选中的故事单元。</Text>
    <Space wrap style={{marginBottom:14}}><Text strong>当前故事单元</Text><Select allowClear style={{minWidth:280}} value={selectedStoryUnitId} placeholder="选择故事单元" options={storyUnits.map(x=>({value:x.id,label:x.title}))} onChange={value=>{setSelectedStoryUnitId(value);setStoryExecution(null);setStoryExecutionHistory([]);setStoryUnit(null);setRun(null);setPreview(emptyPreview);}}/><Button onClick={()=>{setSelectedStoryUnitId(undefined);setStoryUnit(null);void generateStoryUnit(true);}} disabled={generatingStoryUnit||Boolean(busy)}>新建故事单元</Button></Space>
   {!storyUnit?<Space direction="vertical" style={{width:"100%"}}><Empty description="尚未建立完整故事单元。先生成果实/场景、文化民俗、怪谈、人物群像与完整故事因果设计。"/><Button type="primary" onClick={()=>void generateStoryUnit()} loading={generatingStoryUnit} disabled={generatingStoryUnit||Boolean(busy)||Boolean(activeUniverse?.archivedAt)}>生成完整故事设计</Button></Space>:<Space direction="vertical" style={{width:"100%"}} size="middle">
    <Title level={4}>{storyUnit.title}</Title>
    <Paragraph>{storyUnit.storyCore}</Paragraph>
    <Paragraph type="secondary">核心矛盾：{storyUnit.centralConflict}</Paragraph>
    {!canonContractReady&&<Alert type="warning" showIcon message="旧版故事设计不符合新的原作类型契约" description="当前设计缺少可验证的超凡机制及其因果必要性。为避免继续生成现实主义题材偏移的章节，请先点击“重新推演故事设计”；章节生成与完整故事执行已暂时禁用。"/>}
    <Collapse items={[
     {key:"canon",label:"原作类型契约与超凡机制",children:<div><Paragraph>世界类型定位：{storyUnit.canonTypeFit.worldIdentity}</Paragraph><Paragraph>超凡机制：{storyUnit.canonTypeFit.supernaturalEngine}</Paragraph><Paragraph>因果必要性：{storyUnit.canonTypeFit.causalNecessity}</Paragraph><Paragraph>移除机制后的因果断裂：{storyUnit.canonTypeFit.removalTest}</Paragraph><Paragraph>异常现象：{storyUnit.supernaturalEngine.phenomenon}</Paragraph><Paragraph>规则：{storyUnit.supernaturalEngine.rules.join("；")}</Paragraph><Paragraph>边界：{storyUnit.supernaturalEngine.boundaries.join("；")}</Paragraph><Paragraph>代价：{storyUnit.supernaturalEngine.cost.join("；")}</Paragraph><Paragraph>可观察证据：{storyUnit.supernaturalEngine.observableEvidence}</Paragraph><Paragraph>因果作用：{storyUnit.supernaturalEngine.causalRole}</Paragraph></div>},
     {key:"world",label:"果实、场景与社会生活",children:<div><Paragraph>{storyUnit.fruitOrSetting.premise}</Paragraph><Paragraph>历史：{storyUnit.fruitOrSetting.historicalContext}</Paragraph><Paragraph>地理与日常：{storyUnit.fruitOrSetting.geographyAndDailyLife}</Paragraph><Paragraph>社会关系：{storyUnit.fruitOrSetting.powerAndSocialRelations}</Paragraph><Paragraph>规则：{storyUnit.fruitOrSetting.abilitiesAndRules.join("；")}</Paragraph><Paragraph>代价：{storyUnit.fruitOrSetting.costsAndLimits.join("；")}</Paragraph></div>},
     {key:"folk",label:"地方文化、民俗、禁忌与怪谈",children:<div>{storyUnit.cultureAndFolklore.map((x,i)=><div key={i}><Text strong>{x.name}</Text><Paragraph>{x.practice}。由来：{x.originOrBelief}。社会作用：{x.socialFunction}。剧情入口：{x.storyUse}</Paragraph></div>)}{storyUnit.taboosAndGhostStories.map((x,i)=><div key={"ghost"+i}><Text strong>{x.name}</Text><Paragraph>传说：{x.versions.join("；")}。可能解释：{x.underlyingTruthOptions.join("；")}。后果：{x.consequences}。场景：{x.scenePotential}</Paragraph></div>)}</div>},
     {key:"people",label:"已出场人物与新人物",children:<div>{storyUnit.cast.map((x,i)=><div key={i}><Space><Text strong>{x.name}</Text><Tag>{x.status==="existing"?"已出场":"新人物"}</Tag></Space><Paragraph>{x.role}。欲望：{x.desire}。秘密/恐惧：{x.fearOrSecret}。关系：{x.relationships.join("；")}。发展可能：{x.possibleDevelopment.join("；")}</Paragraph></div>)}<Paragraph>{storyUnit.relationshipDynamics.join("；")}</Paragraph></div>},
     {key:"spine",label:"从开端到高潮与结局",children:<div>{storyUnit.storySpine.map((x,i)=><div key={i}><Space wrap><Text strong>{i+1}. {x.title}</Text><Tag color={x.status==="completed"?"success":x.status==="in_progress"?"processing":x.status==="replaced"?"warning":"default"}>{({planned:"待推进",in_progress:"进行中",completed:"已发生",replaced:"已由剧情发展替代"} as Record<string,string>)[x.status??"planned"]??x.status??"planned"}</Tag></Space><Paragraph>{x.function}。因果变化：{x.causalChange}。人物：{x.involvedCharacters.join("、")}。发展可能：{x.possibleArcs.join("；")}</Paragraph></div>)}<Paragraph>支线：{storyUnit.subplots.join("；")}</Paragraph><Paragraph>高潮：{storyUnit.climax}</Paragraph><Paragraph>结局与余韵：{storyUnit.endingAndAftermath}</Paragraph></div>}
    ]}/>
    {!!storyUnitGenerationRuns.length&&<Collapse size="small" items={[{key:"generation-audit",label:"故事创意生成记录（"+storyUnitGenerationRuns.length+"）",children:<Space direction="vertical" style={{width:"100%"}}>{storyUnitGenerationRuns.map(item=><div key={item.id}><Space wrap><Tag color={item.status==="completed"?"success":item.status==="failed"?"error":"processing"}>{item.status==="completed"?"成功":item.status==="failed"?"失败":item.status}</Tag><Text>{new Date(item.startedAt).toLocaleString()}</Text><Text type="secondary">{item.id}</Text><Button size="small" onClick={()=>void openStoryUnitGenerationRun(item.id)}>查看 Prompt / 原始响应 / 模型重试记录</Button></Space>{item.error&&<Paragraph type="danger">{item.error}</Paragraph>}</div>)}</Space>}]}/>}
    {!!storyUnitVersions.length&&<Collapse size="small" items={[{key:"versions",label:"故事设计历史版本（"+storyUnitVersions.length+"）",children:<div>{storyUnitVersions.map(version=><div key={version.versionId}><Text strong>{version.title}</Text><Text type="secondary"> · {new Date(version.createdAt).toLocaleString()}</Text><Paragraph style={{marginBottom:4}}>{version.storyCore}</Paragraph><Text type="secondary">核心矛盾：{version.centralConflict}</Text><div><Button size="small" onClick={()=>restoreStoryUnitVersion(version.versionId)} disabled={Boolean(activeStoryExecution)||Boolean(busy)}>恢复此版本</Button></div></div>)}</div>}]}/>}
    <Space wrap>
     <Tag color={storyUnit.execution.status==="completed"?"success":storyUnit.execution.status==="in_progress"?"processing":"default"}>{storyUnit.execution.status==="completed"?"故事已收束":storyUnit.execution.status==="in_progress"?"正在执行":"尚未执行"}</Tag>
     <Text type="secondary">已完成 {storyUnit.execution.completedChapterIds.length} 章；章节数由故事发展决定</Text>
     {storyUnit.execution.lastAssessment&&<Paragraph style={{marginBottom:0}}>最近进展判断：{storyUnit.execution.lastAssessment}</Paragraph>}
     {storyUnit.execution.nextDirection&&<Paragraph type="secondary" style={{marginBottom:0}}>下一步自然方向：{storyUnit.execution.nextDirection}</Paragraph>}
      {!!storyUnit.execution.characterArcHistory?.length&&<div><Text strong>人物发展记录</Text>{storyUnit.execution.characterArcHistory.slice(-12).reverse().map((item,index)=><div key={item.chapterId+item.name+index}><Text strong>{item.name}</Text><Text type="secondary"> · {item.chapterId}</Text><div>{item.observedChange}</div>{item.futurePossibilities.length>0&&<Text type="secondary">后续可能：{item.futurePossibilities.join("；")}</Text>}</div>)}</div>}
     <Button onClick={()=>void generateStoryUnit()} loading={generatingStoryUnit} disabled={generatingStoryUnit||Boolean(activeStoryExecution)}>重新推演故事设计</Button>
     <Button type="primary" onClick={()=>void startCompleteStory()} loading={startingStoryExecution} disabled={startingStoryExecution||batchRunning||busy||!canonContractReady||!["not_started","in_progress"].includes(storyUnit.execution.status)||Boolean(activeStoryExecution)||Boolean(activeUniverse?.archivedAt)}>自动完成整个故事</Button>
    </Space>
   </Space>}
  </Card>
  {visibleStoryExecution&&<Card title={visibleStoryExecution.mode==="fixed_batch"?"连续生成任务":"完整故事执行任务"} extra={<Select size="small" style={{minWidth:250}} value={visibleStoryExecution.id} onChange={id=>{const selected=storyExecutionHistory.find(item=>item.id===id);if(selected)setStoryExecution(selected);}} options={visibleStoryExecutionHistory.map(item=>({value:item.id,label:`${item.mode==="fixed_batch"?"批量":"完整故事"} · ${item.storyUnitTitle} · ${new Date(item.createdAt).toLocaleString()} · ${{queued:"排队中",running:"执行中",paused:"已暂停",completed:"已完成",failed:"失败",cancelled:"已取消",stalled:"推进停滞"}[item.status]}`}))}/>} style={{marginBottom:18}}>
   <Space direction="vertical" style={{width:"100%"}} size="middle">
    <Space wrap><Tag color={visibleStoryExecution.status==="completed"?"success":visibleStoryExecution.status==="failed"||visibleStoryExecution.status==="stalled"?"error":visibleStoryExecution.status==="running"?"processing":"default"}>{visibleStoryExecution.mode==="fixed_batch"&&visibleStoryExecution.status==="completed"?"批量章节完成":({queued:"排队中",running:visibleStoryExecution.mode==="fixed_batch"?"连续生成中":"执行中",paused:"已暂停",completed:"自然收束",failed:"执行失败",cancelled:"已取消",stalled:"推进停滞"})[visibleStoryExecution.status]}</Tag><Text type="secondary">任务 {visibleStoryExecution.id.slice(0,8)} · 归属：{visibleStoryExecution.storyUnitId?visibleStoryExecution.storyUnitTitle:"Legacy（旧版）"} · 已完成 {visibleStoryExecution.completedChapters.length}{visibleStoryExecution.mode==="fixed_batch"?" / "+visibleStoryExecution.targetChapterCount:""} 章 · 恢复 {visibleStoryExecution.resumeCount} 次{visibleStoryExecution.currentRunId?" · 当前章节任务 "+visibleStoryExecution.currentRunId.slice(0,8):""}</Text></Space>
    {visibleStoryExecution.status==="running"&&<Progress percent={undefined} status="active" showInfo={false}/>}
    {visibleStoryExecution.lastAssessment&&<Paragraph>最近进展判断：{visibleStoryExecution.lastAssessment}</Paragraph>}
    {visibleStoryExecution.nextDirection&&<Paragraph type="secondary">下一步：{visibleStoryExecution.nextDirection}</Paragraph>}
    {visibleStoryExecution.error&&<Alert type={visibleStoryExecution.status==="stalled"?"warning":"error"} showIcon message={visibleStoryExecution.error}/>}
    {visibleStoryExecution.cancelRequested&&<Alert type="info" showIcon message="正在终止当前章节并回滚未提交状态；已完成章节和检查点会保留。"/>}
    {!!visibleStoryExecution.events?.length&&<Collapse size="small" items={[{key:"timeline",label:"执行时间线（"+visibleStoryExecution.events.length+" 条）",children:<Space direction="vertical" style={{width:"100%"}}>{[...visibleStoryExecution.events].reverse().map((event,index)=><div key={event.at+event.type+index}><Text type="secondary">{new Date(event.at).toLocaleString()}</Text><Text strong style={{marginLeft:8}}>{({created:"创建任务",resumed:"恢复执行",chapter_started:"章节开始",chapter_completed:"章节完成",assessment:"故事进展评估",paused:"已暂停",completed:visibleStoryExecution.mode==="fixed_batch"?"批次完成":"故事收束",failed:"执行失败",cancelled:"已取消",stalled:"推进停滞"} as Record<string,string>)[event.type]??event.type}</Text><div>{event.message}</div>{event.runId&&<Text type="secondary">Run: {event.runId}</Text>}</div>)}</Space>}]}/>}
    <Space wrap>
     {getStoryExecutionActions(visibleStoryExecution.status).includes("pause")&&<Button disabled={Boolean(activeStoryExecution&&activeStoryExecution.id!==visibleStoryExecution.id)} onClick={()=>void controlStoryExecution("pause")}>暂停（当前章节结束后生效）</Button>}
     {getStoryExecutionActions(visibleStoryExecution.status).includes("resume")&&<Button type="primary" disabled={Boolean(activeStoryExecution&&activeStoryExecution.id!==visibleStoryExecution.id)} onClick={()=>void controlStoryExecution("resume")}>从检查点恢复</Button>}
     {getStoryExecutionActions(visibleStoryExecution.status).includes("cancel")&&<Button danger loading={Boolean(visibleStoryExecution.cancelRequested)} disabled={Boolean(visibleStoryExecution.cancelRequested)} onClick={()=>void controlStoryExecution("cancel")}>{visibleStoryExecution.cancelRequested?"正在取消…":"取消任务"}</Button>}
    </Space>
    <Text type="secondary">任务由服务端执行。刷新或关闭浏览器不会中断；服务重启后任务转为暂停状态，可从最后一个已终审并提交状态的章节恢复。章节数没有固定上限，完成依据是故事自然收束。</Text>
   </Space>
  </Card>}
  <Card title="当前故事阶段" style={{marginBottom:18}}>
   {preview.storyArc||activeArc?<Paragraph style={{whiteSpace:"pre-wrap",marginBottom:0}}>{preview.storyArc||activeArc}</Paragraph>:<Empty description="首次生成时自动推演一个中期故事阶段（约 5–8 章），不需要单独启动规划任务。"/>}
  </Card>
  <Card title="下一章创作蓝图" style={{marginBottom:18}}>
   {preview.chapterPlan?<Paragraph style={{whiteSpace:"pre-wrap",marginBottom:0}}>{preview.chapterPlan}</Paragraph>:<Text type="secondary">生成过程中自动出现。蓝图只供查看，不是审批项。</Text>}
  </Card>
  <Card title="章节历史" extra={<Select size="small" value={historyScope} onChange={value=>{setHistoryScope(value);setStoryExecution(null);setStoryExecutionHistory([]);}} options={[{value:"current",label:"当前故事单元"},{value:"legacy",label:"旧版历史（Legacy）"}]}/>} style={{marginBottom:18}}>
   {chapterRuns.length===0?<Empty description="尚无章节历史。"/>:<Space wrap>
    <Button disabled={!run||chapterRuns.filter(x=>x.status==="completed").findIndex(x=>x.id===run.id)<=0} onClick={()=>moveChapter(-1)}>上一章</Button>
    <Select style={{minWidth:300}} value={run?.id} onChange={value=>void selectChapter(value)} options={chapterRuns.map((item,index)=>({value:item.id,label:(index+1)+". "+(item.status==="completed"?"已完成":item.status==="failed"?"失败":item.status==="running"?"生成中":"排队中")+" · "+new Date(item.createdAt).toLocaleString()}))}/>
    <Button disabled={!run||chapterRuns.filter(x=>x.status==="completed").findIndex(x=>x.id===run.id)<0||chapterRuns.filter(x=>x.status==="completed").findIndex(x=>x.id===run.id)>=chapterRuns.filter(x=>x.status==="completed").length-1} onClick={()=>moveChapter(1)}>下一章</Button>
   </Space>}
  </Card>
  <Card title="章节正文" style={{marginBottom:18}}>
   {preview.chapter?<Paragraph style={{whiteSpace:"pre-wrap",marginBottom:0}}>{preview.chapter}</Paragraph>:<Empty description="正文生成后显示在这里。"/>}
  </Card>
  <Card title="运行状态">
   {!run?<Empty description="还没有章节生成记录。点击「生成下一章」开始。"/>:
    <div className="chapter-status">
     <Space wrap>
      <Tag color={run.status==="completed"?"success":run.status==="failed"?"error":busy?"processing":"default"}>{run.status==="completed"?"已完成":run.status==="failed"?"执行失败":run.status==="running"?"正在生成":run.status==="queued"?"排队中":run.status}</Tag>
      <Text type="secondary">任务 {run.id.slice(0,8)} · {new Date(run.createdAt).toLocaleString()}</Text>
     </Space>
     {busy&&<Progress status="active" showInfo={false} style={{marginTop:14}}/>}
     {run.status==="completed"&&<Alert style={{marginTop:14}} type="success" showIcon message="章节、终审与故事状态更新均已完成" description={run.chapterPath??run.outputDir??"成稿已保存。"} />}
     {run.status==="failed"&&<Alert style={{marginTop:14}} type="error" showIcon message="运行未完整完成" description={run.error??"请查看本次运行目录中的阶段日志和 process-result.json。"} />}
     {busy&&<Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>无需停留在本页。计划、编辑和状态更新均自动执行。</Paragraph>}
     {run.outputDir&&<Collapse ghost style={{marginTop:12}} items={[{key:"diagnostics",label:"运行诊断（中间产物与日志）",children:<Text type="secondary">{run.outputDir}。完整过程日志、质量审查、状态更新和阶段缓存均保存在该目录。</Text>}]}/>}
    </div>}
  </Card>
  <Modal title="Story Unit 创意生成审计" open={Boolean(storyUnitGenerationDetail)} onCancel={()=>setStoryUnitGenerationDetail(null)} footer={<Button onClick={()=>setStoryUnitGenerationDetail(null)}>关闭</Button>} width={960}>
   {storyUnitGenerationDetail&&<Space direction="vertical" style={{width:"100%"}} size="middle">
    <Space wrap><Tag color={storyUnitGenerationDetail.run.status==="completed"?"success":"error"}>{storyUnitGenerationDetail.run.status}</Tag><Text type="secondary">{storyUnitGenerationDetail.run.id} · {new Date(storyUnitGenerationDetail.run.startedAt).toLocaleString()}</Text></Space>
    {storyUnitGenerationDetail.failure!==null&&storyUnitGenerationDetail.failure!==undefined&&<Alert type="error" showIcon message="生成失败" description={<pre style={{whiteSpace:"pre-wrap",margin:0}}>{JSON.stringify(storyUnitGenerationDetail.failure,null,2)}</pre>}/>}
    <Collapse items={[
     {key:"input",label:"输入快照（世界设定、Story State、原著分析上下文）",children:<pre style={{whiteSpace:"pre-wrap",maxHeight:280,overflow:"auto"}}>{JSON.stringify(storyUnitGenerationDetail.input,null,2)}</pre>},
     {key:"prompt",label:"完整 Prompt",children:<pre style={{whiteSpace:"pre-wrap",maxHeight:360,overflow:"auto"}}>{storyUnitGenerationDetail.prompt??"无记录"}</pre>},
     {key:"response",label:"模型原始响应",children:<pre style={{whiteSpace:"pre-wrap",maxHeight:420,overflow:"auto"}}>{storyUnitGenerationDetail.response??"无记录"}</pre>},
     {key:"trace",label:"模型调用、重试与耗时",children:<pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(storyUnitGenerationDetail.trace,null,2)}</pre>},
     {key:"result",label:"解析后的 Story Unit",children:<pre style={{whiteSpace:"pre-wrap",maxHeight:360,overflow:"auto"}}>{JSON.stringify(storyUnitGenerationDetail.result,null,2)}</pre>}
    ]}/>
   </Space>}
  </Modal>
  <Modal title="创建独立故事宇宙" open={createOpen} onCancel={()=>setCreateOpen(false)} onOk={()=>void createUniverse()} confirmLoading={creatingUniverse} okButtonProps={{disabled:sourceChapters.length===0||entryChapterIndex===undefined}} okText="创建宇宙">
   <Space direction="vertical" style={{width:"100%"}} size="middle">
    {sourceChapterError&&<Alert type="error" showIcon message="原文目录加载失败" description={sourceChapterError}/>}
    <Input placeholder="宇宙名称" value={universeName} onChange={e=>setUniverseName(e.target.value)} />
    <Select showSearch optionFilterProp="label" style={{width:"100%"}} placeholder="选择原文起始章节" value={entryChapterIndex} onChange={index=>{setEntryChapterIndex(index);setEntryChapter(sourceChapters.find(chapter=>chapter.id===index)?.title??"");}} options={sourceChapters.map(chapter=>({value:chapter.id,label:chapter.label+" · "+chapter.title}))} notFoundContent="原文目录为空，请先导入并建立原文索引。" />
    <Select style={{width:"100%"}} value={universeType} onChange={setUniverseType} options={[{value:"mainline",label:"原著主线延续"},{value:"side-story",label:"原著支线扩展"},{value:"character",label:"人物独立故事"},{value:"parallel",label:"平行发展"},{value:"free",label:"自由续写"}]} />
    <Input.TextArea rows={3} placeholder="创作方向（可选）：人物、支线、关键事件或希望探索的剧情" value={universeBrief} onChange={e=>setUniverseBrief(e.target.value)} />
    <Checkbox checked={buildKnowledgeOnCreate} onChange={e=>setBuildKnowledgeOnCreate(e.target.checked)}>创建后立即构建知识资料（后台运行，耗时较长；取消勾选可稍后手动启动）</Checkbox>
    <Text type="secondary">原文资料作为只读来源；新宇宙从空白续写状态开始，拥有独立的主线、人物状态、伏笔和章节记录。</Text>
   </Space>
  </Modal>
  <Modal title="从历史章节创建分支" open={forkOpen} onCancel={()=>setForkOpen(false)} onOk={()=>void createFork()} confirmLoading={forking} okText="创建分支" okButtonProps={{disabled:!forkRunId||!forkName.trim()}}>
   <Space direction="vertical" style={{width:"100%"}} size="middle">
    <Input placeholder="新宇宙名称" value={forkName} onChange={e=>setForkName(e.target.value)} />
    <Select style={{width:"100%"}} showSearch optionFilterProp="label" placeholder="选择分叉章节" value={forkRunId} onChange={setForkRunId} options={forkableRuns.map(item=>({value:item.id,label:item.chapterTitle+" · "+new Date(item.createdAt).toLocaleString()}))} notFoundContent="当前宇宙还没有可分叉的已完成章节。" />
    <Text type="secondary">新宇宙会恢复所选章节完成时的 Story State 和 Story Arc，并复制截至该章的正文与运行历史。之后的剧情、人物状态和规划独立演进。</Text>
   </Space>
  </Modal>
 </div>;
}
