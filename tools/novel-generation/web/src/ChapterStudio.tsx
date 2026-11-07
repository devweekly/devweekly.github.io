import { useEffect, useState } from "react";
import { Alert, Button, Card, Collapse, Empty, Input, Modal, Progress, Select, Space, Tag, Typography, message } from "antd";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
const { Title, Text, Paragraph } = Typography;
type Run = { id:string; kind?:string; status:string; createdAt:string; updatedAt:string; error?:string; outputDir?:string; chapterPath?:string; previousChapterPath?:string };
type Preview = { storyArc:string; chapterPlan:string; chapter:string };
type Universe = { id:string; sourceWorldId:string; name:string; type:string; entryChapter:string; brief:string; createdAt:string };
async function api<T>(url:string, init?:RequestInit):Promise<T>{const response=await fetch(url,{headers:{"Content-Type":"application/json",...(init?.headers??{})},...init});const body=await response.json();if(!response.ok)throw new Error(body.error??response.statusText);return body as T;}
const emptyPreview:Preview={storyArc:"",chapterPlan:"",chapter:""};
export default function ChapterStudio({worldId}:{worldId:string}){
 const [activeWorldId,setActiveWorldId]=useState(worldId);
 const [universes,setUniverses]=useState<Universe[]>([]);
 const [createOpen,setCreateOpen]=useState(false);
 const [universeName,setUniverseName]=useState("");
 const [entryChapter,setEntryChapter]=useState("");
 const [universeBrief,setUniverseBrief]=useState("");
 const [universeType,setUniverseType]=useState("free");
 const [creatingUniverse,setCreatingUniverse]=useState(false);
 const [run,setRun]=useState<Run|null>(null);
 const [starting,setStarting]=useState(false);
 const [loading,setLoading]=useState(false);
 const [preview,setPreview]=useState<Preview>(emptyPreview);
 const [activeArc,setActiveArc]=useState("");
 const [notice,setNotice]=useState("");
 const busy=run?.status==="queued"||run?.status==="running";
 const refresh=async()=>{
  if(!activeWorldId)return;setLoading(true);
  try{
   const [runs,arc]=await Promise.all([
    api<{runs:Run[]}>("/api/worlds/"+activeWorldId+"/runs"),
    api<{storyArc:string}>("/api/worlds/"+activeWorldId+"/story-arc")
   ]);
   setActiveArc(arc.storyArc);
   const latest=runs.runs.find(x=>x.kind==="chapter")??null;setRun(latest);
   if(latest){const p=await api<Preview>("/api/runs/"+latest.id+"/preview?worldId="+activeWorldId);setPreview(p);}
   else setPreview(emptyPreview);
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setLoading(false);}
 };
 useEffect(()=>{setActiveWorldId(worldId);setRun(null);setPreview(emptyPreview);void refresh();void api<{universes:Universe[]}>("/api/worlds/"+worldId+"/universes").then(x=>setUniverses(x.universes)).catch(()=>setUniverses([]));},[worldId]);
 useEffect(()=>{void refresh();},[activeWorldId]);
 useEffect(()=>{
  if(!busy||!run)return;
  const timer=window.setInterval(()=>{
   void Promise.all([
    api<{run:Run}>("/api/runs/"+run.id+"?worldId="+activeWorldId),
    api<Preview>("/api/runs/"+run.id+"/preview?worldId="+activeWorldId)
   ]).then(([r,p])=>{setRun(r.run);setPreview(p);if(r.run.status==="completed"||r.run.status==="failed")void api<{storyArc:string}>("/api/worlds/"+activeWorldId+"/story-arc").then(x=>setActiveArc(x.storyArc));}).catch(()=>{});
  },2000);
  return()=>window.clearInterval(timer);
 },[busy,run?.id,activeWorldId]);
 const generate=async()=>{
  setNotice("");setStarting(true);
  try{const data=await api<{run:Run}>("/api/worlds/"+activeWorldId+"/chapters/generate",{method:"POST",body:"{}"});setRun(data.run);message.success("已启动：自动检查、滚动规划、续写、终审和状态更新。");}
  catch(e){const text=e instanceof Error?e.message:String(e);setNotice(text);message.error(text);}
  finally{setStarting(false);}
 };
 const createUniverse=async()=>{
  setCreatingUniverse(true);
  try{
   const result=await api<{universe:Universe}>("/api/worlds/"+worldId+"/universes",{method:"POST",body:JSON.stringify({name:universeName,entryChapter,brief:universeBrief,type:universeType})});
   setUniverses(current=>[...current,result.universe]);setActiveWorldId(result.universe.id);setCreateOpen(false);
   setUniverseName("");setEntryChapter("");setUniverseBrief("");setUniverseType("free");
   message.success("独立故事宇宙已创建。");
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
  finally{setCreatingUniverse(false);}
 };
 return <div className="chapter-studio">
  <section className="chapter-hero">
   <Text type="secondary">ROLLING STORY ARC</Text>
   <Title level={2}>继续写下一章</Title>
   <Paragraph type="secondary">系统先维护一个有因果关系的中期故事阶段，再从中选择下一章。每章完成后自动更新人物、事件和后续计划；正文可以推动计划调整，不需要人工审批。</Paragraph>
   <Space wrap>
    <Select style={{minWidth:220}} value={activeWorldId} onChange={setActiveWorldId} options={[{value:worldId,label:"原文项目（现有续写）"},...universes.map(u=>({value:u.id,label:u.name+" · 从"+u.entryChapter+"开始"}))]} />
    <Button onClick={()=>setCreateOpen(true)}>新建故事宇宙</Button>
    <Button type="primary" size="large" className="chapter-action" icon={<PlayCircleOutlined/>} loading={starting||Boolean(busy)} disabled={!activeWorldId||Boolean(busy)} onClick={()=>void generate()}>生成下一章</Button>
    <Button icon={<ReloadOutlined/>} loading={loading} onClick={()=>void refresh()}>刷新状态</Button>
    {busy&&<Tag color="processing">正在自动创作</Tag>}
   </Space>
  </section>
  {notice&&<Alert type="warning" showIcon message="本次任务未能启动" description={notice} style={{marginBottom:18}}/>}
  <Card title="当前故事阶段" style={{marginBottom:18}}>
   {preview.storyArc||activeArc?<Paragraph style={{whiteSpace:"pre-wrap",marginBottom:0}}>{preview.storyArc||activeArc}</Paragraph>:<Empty description="首次生成时自动推演一个中期故事阶段（约 5–8 章），不需要单独启动规划任务。"/>}
  </Card>
  <Card title="下一章创作蓝图" style={{marginBottom:18}}>
   {preview.chapterPlan?<Paragraph style={{whiteSpace:"pre-wrap",marginBottom:0}}>{preview.chapterPlan}</Paragraph>:<Text type="secondary">生成过程中自动出现。蓝图只供查看，不是审批项。</Text>}
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
    <Input placeholder="原文起始章节（章节编号或标题）" value={entryChapter} onChange={e=>setEntryChapter(e.target.value)} />
    <Select style={{width:"100%"}} value={universeType} onChange={setUniverseType} options={[{value:"mainline",label:"原著主线延续"},{value:"side-story",label:"原著支线扩展"},{value:"character",label:"人物独立故事"},{value:"parallel",label:"平行发展"},{value:"free",label:"自由续写"}]} />
    <Input.TextArea rows={3} placeholder="创作方向（可选）：人物、支线、关键事件或希望探索的剧情" value={universeBrief} onChange={e=>setUniverseBrief(e.target.value)} />
    <Text type="secondary">原文资料作为只读来源；新宇宙从空白续写状态开始，拥有独立的主线、人物状态、伏笔和章节记录。</Text>
   </Space>
  </Modal>
 </div>;
}
