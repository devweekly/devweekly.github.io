import { useEffect, useState } from "react";
import { Alert, Button, Card, Collapse, Empty, Input, InputNumber, Modal, Progress, Select, Space, Tag, Typography, message } from "antd";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
const { Title, Text, Paragraph } = Typography;
type Run = { id:string; storyUnitId?:string; kind?:string; status:string; createdAt:string; updatedAt:string; error?:string; outputDir?:string; chapterPath?:string; previousChapterPath?:string };
type Preview = { storyArc:string; chapterPlan:string; chapter:string };
type StoryExecution = {id:string;worldId:string;storyUnitId?:string;storyUnitTitle:string;mode:"complete_story"|"fixed_batch";targetChapterCount?:number;status:"queued"|"running"|"paused"|"completed"|"failed"|"cancelled"|"stalled";createdAt:string;updatedAt:string;completedAt?:string;currentRunId?:string;completedChapters:Array<{runId:string;chapterPath:string;completedAt:string}>;events?:Array<{at:string;type:string;message:string;runId?:string}>;lastAssessment?:string;nextDirection?:string;error?:string;brief:string;resumeCount:number};
type StoryUnit = { id?:string; execution:{status:"not_started"|"in_progress"|"completed";completedChapterIds:string[];lastAssessment?:string;nextDirection?:string;assessedAt?:string;completedAt?:string}; title:string; storyCore:string; readerExperience:string; openingSituation:string; centralConflict:string; fruitOrSetting:{name:string;premise:string;abilitiesAndRules:string[];costsAndLimits:string[];historicalContext:string;geographyAndDailyLife:string;powerAndSocialRelations:string}; cultureAndFolklore:Array<{name:string;practice:string;originOrBelief:string;socialFunction:string;storyUse:string}>; taboosAndGhostStories:Array<{name:string;versions:string[];underlyingTruthOptions:string[];consequences:string;scenePotential:string}>; cast:Array<{name:string;role:string;status:string;desire:string;fearOrSecret:string;relationships:string[];possibleDevelopment:string[]}>; relationshipDynamics:string[]; storySpine:Array<{title:string;function:string;causalChange:string;involvedCharacters:string[];possibleArcs:string[]}>; subplots:string[]; climax:string; endingAndAftermath:string; unresolvedQuestions:string[]; creativePossibilities:string[] };
type Universe = { id:string; sourceWorldId:string; name:string; type:string; entryChapter:string; entryChapterId?:string; entryOrdinal?:number; brief:string; createdAt:string; parentUniverseId?:string; forkPoint?:string; archivedAt?:string };
type ForkableRun = { id:string; chapterTitle:string; createdAt:string };
type KnowledgeBuild = { worldId:string; status:"queued"|"running"|"completed"|"partial"|"failed"; currentStep?:string; updatedAt:string; completedAt?:string; steps:Array<{name:string;status:"running"|"completed"|"failed"|"skipped";exitCode?:number|null;output?:string;error?:string}> };
async function api<T>(url:string, init?:RequestInit):Promise<T>{const response=await fetch(url,{headers:{"Content-Type":"application/json",...(init?.headers??{})},...init});const body=await response.json();if(!response.ok)throw new Error(body.error??response.statusText);return body as T;}
const emptyPreview:Preview={storyArc:"",chapterPlan:"",chapter:""};
export default function ChapterStudio({worldId}:{worldId:string}){
 const [activeWorldId,setActiveWorldId]=useState(worldId);
 const [universes,setUniverses]=useState<Universe[]>([]);
 const [sourceChapters,setSourceChapters]=useState<Array<{id:number;title:string;label:string}>>([]);
 const [entryChapterIndex,setEntryChapterIndex]=useState<number|undefined>();
 const [createOpen,setCreateOpen]=useState(false);
 const [universeName,setUniverseName]=useState("");
 const [entryChapter,setEntryChapter]=useState("");
 const [universeBrief,setUniverseBrief]=useState("");
 const [universeType,setUniverseType]=useState("free");
 const [creatingUniverse,setCreatingUniverse]=useState(false);
 const [forkOpen,setForkOpen]=useState(false);
 const [forkName,setForkName]=useState("");
 const [forkRunId,setForkRunId]=useState<string>();
 const [forkableRuns,setForkableRuns]=useState<ForkableRun[]>([]);
 const [forking,setForking]=useState(false);
 const [run,setRun]=useState<Run|null>(null);
 const [chapterRuns,setChapterRuns]=useState<Run[]>([]);
 const [batchCount,setBatchCount]=useState<number>(5);
 const [starting,setStarting]=useState(false);
 const [loading,setLoading]=useState(false);
 const [preview,setPreview]=useState<Preview>(emptyPreview);
 const [activeArc,setActiveArc]=useState("");
 const [notice,setNotice]=useState("");
 const [knowledgeBuild,setKnowledgeBuild]=useState<KnowledgeBuild|null>(null);
 const [storyUnit,setStoryUnit]=useState<StoryUnit|null>(null);
 const [storyUnits,setStoryUnits]=useState<Array<{id:string;title:string;updatedAt:string}>>([]);
 const [selectedStoryUnitId,setSelectedStoryUnitId]=useState<string|undefined>();
 const [storyExecution,setStoryExecution]=useState<StoryExecution|null>(null);
 const [startingStoryExecution,setStartingStoryExecution]=useState(false);
 const [generatingStoryUnit,setGeneratingStoryUnit]=useState(false);
 const [startingKnowledgeBuild,setStartingKnowledgeBuild]=useState(false);
 const busy=run?.status==="queued"||run?.status==="running";
 const batchRunning=storyExecution?.mode==="fixed_batch"&&["queued","running"].includes(storyExecution.status);
 const storyTaskBlocksWrites=Boolean(storyExecution&&["queued","running","paused","failed","stalled"].includes(storyExecution.status));
 const batchProgress={completed:storyExecution?.completedChapters.length??0,total:storyExecution?.targetChapterCount??0};
 const refresh=async()=>{
  if(!activeWorldId)return;setLoading(true);
  try{
   const [runs,arc]=await Promise.all([
    api<{runs:Run[]}>("/api/worlds/"+activeWorldId+"/runs"),
    api<{storyArc:string}>("/api/worlds/"+activeWorldId+"/story-arc")
   ]);
   setActiveArc(arc.storyArc);
   const chapters=runs.runs.filter(x=>x.kind==="chapter"&&(!selectedStoryUnitId||x.storyUnitId===selectedStoryUnitId)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
   setChapterRuns(chapters);
   const latest=chapters.at(-1)??null;setRun(latest);
   if(latest){const p=await api<Preview>("/api/runs/"+latest.id+"/preview?worldId="+activeWorldId);setPreview(p);}
   else setPreview(emptyPreview);
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setLoading(false);}
 };
 useEffect(()=>{setActiveWorldId(worldId);setRun(null);setPreview(emptyPreview);void refresh();void Promise.all([api<{universes:Universe[]}>("/api/worlds/"+worldId+"/universes"),api<{chapters:Array<{id:number;title:string;label:string}>}>("/api/worlds/"+worldId+"/source-chapters")]).then(([u,c])=>{setUniverses(u.universes);setSourceChapters(c.chapters);}).catch(()=>{setUniverses([]);setSourceChapters([]);setStoryUnit(null);});},[worldId]);
 useEffect(()=>{void refresh();},[activeWorldId,selectedStoryUnitId]);
 useEffect(()=>{if(!activeWorldId)return;void Promise.all([
  api<{storyUnits:Array<{id:string;title:string;updatedAt:string}>}>("/api/worlds/"+activeWorldId+"/story-units"),
  api<{executions:StoryExecution[]}>("/api/worlds/"+activeWorldId+"/story-executions")
 ]).then(([units,tasks])=>{
   setStoryUnits(units.storyUnits);
   const chosen=selectedStoryUnitId&&units.storyUnits.some(x=>x.id===selectedStoryUnitId)?selectedStoryUnitId:units.storyUnits[0]?.id;
   setSelectedStoryUnitId(chosen);
   setStoryExecution(tasks.executions.find(x=>x.storyUnitId===chosen)??null);
   if(chosen)void api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/"+chosen).then(x=>setStoryUnit(x.storyUnit));
   else setStoryUnit(null);
  }).catch(()=>{setStoryUnit(null);setStoryUnits([]);setSelectedStoryUnitId(undefined);setStoryExecution(null);});},[activeWorldId,selectedStoryUnitId]);
 useEffect(()=>{
  if(!activeWorldId||!storyExecution||!["queued","running"].includes(storyExecution.status))return;
  const timer=window.setInterval(()=>void api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/story-executions/"+storyExecution.id)
   .then(result=>{setStoryExecution(result.execution);if(["completed","failed","paused","cancelled","stalled"].includes(result.execution.status)){void refresh();if(selectedStoryUnitId)void api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/"+selectedStoryUnitId).then(x=>setStoryUnit(x.storyUnit));}})
   .catch(()=>{}),2500);
  return()=>window.clearInterval(timer);
 },[activeWorldId,selectedStoryUnitId,storyExecution?.id,storyExecution?.status]);
 useEffect(()=>{
  if(!busy||!run)return;
  const timer=window.setInterval(()=>{
   void Promise.all([
    api<{run:Run}>("/api/runs/"+run.id+"?worldId="+activeWorldId),
    api<Preview>("/api/runs/"+run.id+"/preview?worldId="+activeWorldId)
   ]).then(([r,p])=>{setRun(r.run);setPreview(p);if(r.run.status==="completed"||r.run.status==="failed"){void Promise.all([api<{storyArc:string}>("/api/worlds/"+activeWorldId+"/story-arc"),api<{runs:Run[]}>("/api/worlds/"+activeWorldId+"/runs")]).then(([arc,runs])=>{setActiveArc(arc.storyArc);setChapterRuns(runs.runs.filter(x=>x.kind==="chapter").sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));});}}).catch(()=>{});
  },2000);
  return()=>window.clearInterval(timer);
 },[busy,run?.id,activeWorldId]);
 const selectChapter=async(id:string)=>{
  const selected=chapterRuns.find(item=>item.id===id);if(!selected)return;
  setRun(selected);
  try{setPreview(await api<Preview>("/api/runs/"+selected.id+"/preview?worldId="+activeWorldId));}
  catch(e){message.error(e instanceof Error?e.message:String(e));}
 };
 const moveChapter=(offset:number)=>{
  if(!run)return;const ordered=chapterRuns.filter(item=>item.status==="completed"||item.id===run.id);
  const index=ordered.findIndex(item=>item.id===run.id);const target=ordered[index+offset];if(target)void selectChapter(target.id);
 };
 const generate=async()=>{
  setNotice("");setStarting(true);
  try{const data=await api<{run:Run}>("/api/worlds/"+activeWorldId+"/chapters/generate",{method:"POST",body:"{}"});setRun(data.run);message.success("已启动：自动检查、滚动规划、续写、终审和状态更新。");}
  catch(e){const text=e instanceof Error?e.message:String(e);setNotice(text);message.error(text);}
  finally{setStarting(false);}
 };
 const generateBatch=async()=>{
  if(batchRunning||busy)return;
  setStartingStoryExecution(true);
  try{
   const result=await api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/chapter-batches",{method:"POST",body:JSON.stringify({chapterCount:batchCount,storyUnitId:selectedStoryUnitId})});
   setStoryExecution(result.execution);
   message.success("连续生成任务已交给服务端；刷新或关闭页面不会中断。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setStartingStoryExecution(false);}
 };
 const activeUniverse=universes.find(item=>item.id===activeWorldId);
 useEffect(()=>{
  let disposed=false;
  if(!activeUniverse){setKnowledgeBuild(null);return;}
  const load=()=>api<{build:KnowledgeBuild|null}>("/api/worlds/"+activeWorldId+"/knowledge-build")
   .then(result=>{if(!disposed)setKnowledgeBuild(result.build);}).catch(()=>{});
  void load();
  const timer=window.setInterval(load,2000);
  return()=>{disposed=true;window.clearInterval(timer);};
 },[activeWorldId,activeUniverse?.id]);
 const generateStoryUnit=async()=>{
  setGeneratingStoryUnit(true);
  try{
   const result=await api<{storyUnit:StoryUnit}>("/api/worlds/"+activeWorldId+"/story-units/generate",{method:"POST",body:JSON.stringify({storyUnitId:selectedStoryUnitId})});
   setStoryUnit(result.storyUnit);if(result.storyUnit.id)setSelectedStoryUnitId(result.storyUnit.id);void api<{storyUnits:Array<{id:string;title:string;updatedAt:string}>}>("/api/worlds/"+activeWorldId+"/story-units").then(x=>setStoryUnits(x.storyUnits));message.success("完整故事单元设计已生成并保存。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setGeneratingStoryUnit(false);}
 };
 const startCompleteStory=async()=>{
  setStartingStoryExecution(true);
  try{
   const result=await api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/story-executions",{method:"POST",body:JSON.stringify({storyUnitId:selectedStoryUnitId})});
   setStoryExecution(result.execution);message.success("完整故事已交给服务端执行；关闭页面不会中断任务。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setStartingStoryExecution(false);}
 };
 const controlStoryExecution=async(action:"pause"|"resume"|"cancel")=>{
  if(!storyExecution)return;
  try{
   const result=await api<{execution:StoryExecution}>("/api/worlds/"+activeWorldId+"/story-executions/"+storyExecution.id+"/"+action,{method:"POST",body:"{}"});
   setStoryExecution(result.execution);
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
 };
 const startKnowledgeBuild=async()=>{
  setStartingKnowledgeBuild(true);
  try{
   const result=await api<{build:KnowledgeBuild}>("/api/worlds/"+activeWorldId+"/knowledge-build",{method:"POST",body:"{}"});
   setKnowledgeBuild(result.build);
   message.success("知识构建任务已在后台启动。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setStartingKnowledgeBuild(false);}
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
   const result=await api<{universe:Universe}>("/api/worlds/"+worldId+"/universes",{method:"POST",body:JSON.stringify({name:universeName,entryChapter,entryChapterIndex,brief:universeBrief,type:universeType})});
   setUniverses(current=>[...current,result.universe]);setActiveWorldId(result.universe.id);setCreateOpen(false);
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
    {activeWorldId!==worldId&&!activeUniverse?.archivedAt&&<Button onClick={()=>void openFork()}>从本宇宙分叉</Button>}
    {activeUniverse&&(activeUniverse.archivedAt?<Button onClick={()=>void changeArchive(false)}>恢复宇宙</Button>:<Button danger onClick={()=>void changeArchive(true)} disabled={Boolean(busy)}>归档当前宇宙</Button>)}
    <Button type="primary" size="large" className="chapter-action" icon={<PlayCircleOutlined/>} loading={starting||Boolean(busy)} disabled={!activeWorldId||Boolean(busy)||batchRunning||storyTaskBlocksWrites||Boolean(activeUniverse?.archivedAt)} onClick={()=>void generate()}>生成下一章</Button>
    <Space.Compact><InputNumber min={1} value={batchCount} onChange={value=>setBatchCount(value??1)} disabled={batchRunning||Boolean(busy)||storyTaskBlocksWrites} style={{width:76}}/><Button loading={batchRunning||startingStoryExecution&&storyExecution?.mode==="fixed_batch"} disabled={!activeWorldId||Boolean(busy)||batchRunning||storyTaskBlocksWrites||startingStoryExecution||Boolean(activeUniverse?.archivedAt)} onClick={()=>void generateBatch()}>连续生成多章</Button></Space.Compact>
    <Button icon={<ReloadOutlined/>} loading={loading} onClick={()=>void refresh()}>刷新状态</Button>
    {busy&&<Tag color="processing">正在自动创作</Tag>}
    {batchRunning&&<Tag color="processing">批量进度 {batchProgress.completed}/{batchProgress.total}</Tag>}
   </Space>
  </section>
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
     <Tag color={knowledgeBuild?.status==="completed"?"success":knowledgeBuild?.status==="failed"?"error":knowledgeBuild?.status==="partial"?"warning":knowledgeBuild?.status==="running"||knowledgeBuild?.status==="queued"?"processing":"default"}>
      {knowledgeBuild?.status==="completed"?"已完成":knowledgeBuild?.status==="failed"?"构建失败":knowledgeBuild?.status==="partial"?"部分完成":knowledgeBuild?.status==="running"?"正在构建":knowledgeBuild?.status==="queued"?"排队中":"尚未构建"}
     </Tag>
     {knowledgeBuild?.currentStep&&<Text type="secondary">当前步骤：{knowledgeBuild.currentStep}</Text>}
     {knowledgeBuild?.updatedAt&&<Text type="secondary">更新于 {new Date(knowledgeBuild.updatedAt).toLocaleString()}</Text>}
    </Space>
    <Button onClick={()=>void startKnowledgeBuild()} loading={startingKnowledgeBuild} disabled={startingKnowledgeBuild||knowledgeBuild?.status==="queued"||knowledgeBuild?.status==="running"}>
     {knowledgeBuild?.status==="failed"||knowledgeBuild?.status==="partial"?"重新构建知识资料":"构建知识资料"}
    </Button>
    {knowledgeBuild && knowledgeBuild.steps.length > 0 && <Space direction="vertical" style={{width:"100%"}} size="small">
     {knowledgeBuild.steps.map(step=><div key={step.name} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
      <Tag color={step.status==="completed"?"success":step.status==="failed"?"error":step.status==="running"?"processing":"default"}>{step.status==="completed"?"完成":step.status==="failed"?"失败":step.status==="running"?"执行中":"跳过"}</Tag>
      <div style={{flex:1,minWidth:0}}>
       <Text>{step.name}</Text>
       {step.error&&<Paragraph type="danger" style={{fontSize:12,whiteSpace:"pre-wrap",marginBottom:4}}>{step.error}</Paragraph>}
      </div>
     </div>)}
    </Space>}
    {knowledgeBuild?.status==="partial"&&<Alert type="warning" showIcon message="部分资料未能构建" description="已成功的分析结果仍可使用；修复失败步骤后可重新构建。"/>}
    {knowledgeBuild?.status==="failed"&&<Alert type="error" showIcon message="知识构建未完成" description="章节写作仍可继续；修复失败步骤后可重新构建。"/>}
   </Space>
  </Card>}
  {notice&&<Alert type="warning" showIcon message="本次任务未能启动" description={notice} style={{marginBottom:18}}/>}
  <Card title="完整故事单元" style={{marginBottom:18}}>
   <Space wrap style={{marginBottom:14}}><Text strong>当前故事单元</Text><Select allowClear style={{minWidth:280}} value={selectedStoryUnitId} placeholder="选择故事单元" options={storyUnits.map(x=>({value:x.id,label:x.title}))} onChange={value=>{setSelectedStoryUnitId(value);setStoryExecution(null);setRun(null);setPreview(emptyPreview);}}/><Button onClick={()=>{setSelectedStoryUnitId(undefined);setStoryUnit(null);void generateStoryUnit();}} disabled={generatingStoryUnit||Boolean(busy)}>新建故事单元</Button></Space>
   <Space wrap style={{marginBottom:14}}><Text strong>当前故事单元</Text><Select style={{minWidth:280}} value={selectedStoryUnitId} placeholder="选择故事单元" options={storyUnits.map(x=>({value:x.id,label:x.title}))} onChange={value=>{setSelectedStoryUnitId(value);setStoryExecution(null);setRun(null);setPreview(emptyPreview);}}/><Button onClick={()=>{setSelectedStoryUnitId(undefined);setStoryUnit(null);void generateStoryUnit();}} disabled={generatingStoryUnit||Boolean(busy)}>新建故事单元</Button></Space>
   {!storyUnit?<Space direction="vertical" style={{width:"100%"}}><Empty description="尚未建立完整故事单元。先生成果实/场景、文化民俗、怪谈、人物群像与完整故事因果设计。"/><Button type="primary" onClick={()=>void generateStoryUnit()} loading={generatingStoryUnit} disabled={generatingStoryUnit||Boolean(busy)||Boolean(activeUniverse?.archivedAt)}>生成完整故事设计</Button></Space>:<Space direction="vertical" style={{width:"100%"}} size="middle">
    <Title level={4}>{storyUnit.title}</Title>
    <Paragraph>{storyUnit.storyCore}</Paragraph>
    <Paragraph type="secondary">核心矛盾：{storyUnit.centralConflict}</Paragraph>
    <Collapse items={[
     {key:"world",label:"果实、场景与社会生活",children:<div><Paragraph>{storyUnit.fruitOrSetting.premise}</Paragraph><Paragraph>历史：{storyUnit.fruitOrSetting.historicalContext}</Paragraph><Paragraph>地理与日常：{storyUnit.fruitOrSetting.geographyAndDailyLife}</Paragraph><Paragraph>社会关系：{storyUnit.fruitOrSetting.powerAndSocialRelations}</Paragraph><Paragraph>规则：{storyUnit.fruitOrSetting.abilitiesAndRules.join("；")}</Paragraph><Paragraph>代价：{storyUnit.fruitOrSetting.costsAndLimits.join("；")}</Paragraph></div>},
     {key:"folk",label:"地方文化、民俗、禁忌与怪谈",children:<div>{storyUnit.cultureAndFolklore.map((x,i)=><div key={i}><Text strong>{x.name}</Text><Paragraph>{x.practice}。由来：{x.originOrBelief}。社会作用：{x.socialFunction}。剧情入口：{x.storyUse}</Paragraph></div>)}{storyUnit.taboosAndGhostStories.map((x,i)=><div key={"ghost"+i}><Text strong>{x.name}</Text><Paragraph>传说：{x.versions.join("；")}。可能解释：{x.underlyingTruthOptions.join("；")}。后果：{x.consequences}。场景：{x.scenePotential}</Paragraph></div>)}</div>},
     {key:"people",label:"已出场人物与新人物",children:<div>{storyUnit.cast.map((x,i)=><div key={i}><Space><Text strong>{x.name}</Text><Tag>{x.status==="existing"?"已出场":"新人物"}</Tag></Space><Paragraph>{x.role}。欲望：{x.desire}。秘密/恐惧：{x.fearOrSecret}。关系：{x.relationships.join("；")}。发展可能：{x.possibleDevelopment.join("；")}</Paragraph></div>)}<Paragraph>{storyUnit.relationshipDynamics.join("；")}</Paragraph></div>},
     {key:"spine",label:"从开端到高潮与结局",children:<div>{storyUnit.storySpine.map((x,i)=><div key={i}><Text strong>{i+1}. {x.title}</Text><Paragraph>{x.function}。因果变化：{x.causalChange}。人物：{x.involvedCharacters.join("、")}。发展可能：{x.possibleArcs.join("；")}</Paragraph></div>)}<Paragraph>支线：{storyUnit.subplots.join("；")}</Paragraph><Paragraph>高潮：{storyUnit.climax}</Paragraph><Paragraph>结局与余韵：{storyUnit.endingAndAftermath}</Paragraph></div>}
    ]}/>
    <Space wrap>
     <Tag color={storyUnit.execution.status==="completed"?"success":storyUnit.execution.status==="in_progress"?"processing":"default"}>{storyUnit.execution.status==="completed"?"故事已收束":storyUnit.execution.status==="in_progress"?"正在执行":"尚未执行"}</Tag>
     <Text type="secondary">已完成 {storyUnit.execution.completedChapterIds.length} 章；章节数由故事发展决定</Text>
     <Button onClick={()=>void generateStoryUnit()} loading={generatingStoryUnit} disabled={generatingStoryUnit||storyExecution?.status==="running"||storyExecution?.status==="queued"}>重新推演故事设计</Button>
     <Button type="primary" onClick={()=>void startCompleteStory()} loading={startingStoryExecution} disabled={startingStoryExecution||batchRunning||busy||!["not_started","in_progress"].includes(storyUnit.execution.status)||["queued","running","paused","failed","stalled"].includes(storyExecution?.status??"")||Boolean(activeUniverse?.archivedAt)}>自动完成整个故事</Button>
    </Space>
   </Space>}
  </Card>
  {storyExecution&&<Card title={storyExecution.mode==="fixed_batch"?"连续生成任务":"完整故事执行任务"} style={{marginBottom:18}}>
   <Space direction="vertical" style={{width:"100%"}} size="middle">
    <Space wrap><Tag color={storyExecution.status==="completed"?"success":storyExecution.status==="failed"||storyExecution.status==="stalled"?"error":storyExecution.status==="running"?"processing":"default"}>{storyExecution.mode==="fixed_batch"&&storyExecution.status==="completed"?"批量章节完成":({queued:"排队中",running:storyExecution.mode==="fixed_batch"?"连续生成中":"执行中",paused:"已暂停",completed:"自然收束",failed:"执行失败",cancelled:"已取消",stalled:"推进停滞"})[storyExecution.status]}</Tag><Text type="secondary">任务 {storyExecution.id.slice(0,8)} · 已完成 {storyExecution.completedChapters.length}{storyExecution.mode==="fixed_batch"?" / "+storyExecution.targetChapterCount:""} 章 · 恢复 {storyExecution.resumeCount} 次{storyExecution.currentRunId?" · 当前章节任务 "+storyExecution.currentRunId.slice(0,8):""}</Text></Space>
    {storyExecution.status==="running"&&<Progress percent={undefined} status="active" showInfo={false}/>}
    {storyExecution.lastAssessment&&<Paragraph>最近进展判断：{storyExecution.lastAssessment}</Paragraph>}
    {storyExecution.nextDirection&&<Paragraph type="secondary">下一步：{storyExecution.nextDirection}</Paragraph>}
    {storyExecution.error&&<Alert type={storyExecution.status==="stalled"?"warning":"error"} showIcon message={storyExecution.error}/>}
    {!!storyExecution.events?.length&&<Collapse size="small" items={[{key:"timeline",label:"执行时间线（"+storyExecution.events.length+" 条）",children:<Space direction="vertical" style={{width:"100%"}}>{[...storyExecution.events].reverse().map((event,index)=><div key={event.at+event.type+index}><Text type="secondary">{new Date(event.at).toLocaleString()}</Text><Text strong style={{marginLeft:8}}>{({created:"创建任务",resumed:"恢复执行",chapter_started:"章节开始",chapter_completed:"章节完成",assessment:"故事进展评估",paused:"已暂停",completed:storyExecution.mode==="fixed_batch"?"批次完成":"故事收束",failed:"执行失败",cancelled:"已取消",stalled:"推进停滞"} as Record<string,string>)[event.type]??event.type}</Text><div>{event.message}</div>{event.runId&&<Text type="secondary">Run: {event.runId}</Text>}</div>)}</Space>}]}/>}
    <Space wrap>
     {["queued","running"].includes(storyExecution.status)&&<Button onClick={()=>void controlStoryExecution("pause")}>暂停（当前章节结束后生效）</Button>}
     {["paused","failed","stalled"].includes(storyExecution.status)&&<Button type="primary" onClick={()=>void controlStoryExecution("resume")}>从检查点恢复</Button>}
     {["queued","running","paused"].includes(storyExecution.status)&&<Button danger onClick={()=>void controlStoryExecution("cancel")}>取消任务</Button>}
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
  <Card title="章节历史" style={{marginBottom:18}}>
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
  <Modal title="创建独立故事宇宙" open={createOpen} onCancel={()=>setCreateOpen(false)} onOk={()=>void createUniverse()} confirmLoading={creatingUniverse} okText="创建宇宙">
   <Space direction="vertical" style={{width:"100%"}} size="middle">
    <Input placeholder="宇宙名称" value={universeName} onChange={e=>setUniverseName(e.target.value)} />
    <Select showSearch optionFilterProp="label" style={{width:"100%"}} placeholder="选择原文起始章节" value={entryChapterIndex} onChange={index=>{setEntryChapterIndex(index);setEntryChapter(sourceChapters.find(chapter=>chapter.id===index)?.title??"");}} options={sourceChapters.map(chapter=>({value:chapter.id,label:chapter.label+" · "+chapter.title}))} notFoundContent="原文目录为空，请先导入并建立原文索引。" />
    <Select style={{width:"100%"}} value={universeType} onChange={setUniverseType} options={[{value:"mainline",label:"原著主线延续"},{value:"side-story",label:"原著支线扩展"},{value:"character",label:"人物独立故事"},{value:"parallel",label:"平行发展"},{value:"free",label:"自由续写"}]} />
    <Input.TextArea rows={3} placeholder="创作方向（可选）：人物、支线、关键事件或希望探索的剧情" value={universeBrief} onChange={e=>setUniverseBrief(e.target.value)} />
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
