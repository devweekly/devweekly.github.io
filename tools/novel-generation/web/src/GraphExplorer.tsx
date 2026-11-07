import { useEffect,useMemo,useState } from "react";
import { Alert,Button,Card,Empty,Input,Select,Space,Spin,Statistic,Tag,Typography } from "antd";
import { ReloadOutlined,SearchOutlined } from "@ant-design/icons";

type GraphNode={id:string;type:string;label:string;data:Record<string,unknown>;sourceRefs?:unknown[]};
type GraphEdge={id:string;from:string;to:string;type:string;label:string;data:Record<string,unknown>;sourceRefs?:unknown[]};
type GraphResponse={source:string;available:boolean;reason?:string;totalNodes:number;totalEdges:number;matchedNodes:number;returnedNodes:number;returnedEdges:number;truncated:boolean;nodes:GraphNode[];edges:GraphEdge[];analysisVersion?:number;analyzedAt?:string};
const colors:Record<string,string>={character:"#456b91",event:"#8b7355","plot-thread":"#5b8f79",foreshadowing:"#a477a8",macguffin:"#bd8446"};
const labels:Record<string,string>={character:"人物",event:"事件","plot-thread":"剧情线",foreshadowing:"伏笔",macguffin:"关键物件"};
const pretty=(value:unknown)=>typeof value==="string"?value:JSON.stringify(value,null,2)??"";

async function loadGraph(worldId:string,source:string,q:string):Promise<GraphResponse>{
 const response=await fetch(`/api/worlds/${encodeURIComponent(worldId)}/graph?source=${source}&q=${encodeURIComponent(q)}&limit=700`);
 const body=await response.json() as GraphResponse & {error?:string};
 if(!response.ok)throw new Error(body.error??response.statusText);
 return body;
}
export default function GraphExplorer({worldId}:{worldId:string}){
 const [source,setSource]=useState("original");const [query,setQuery]=useState("");const [submitted,setSubmitted]=useState("");
 const [data,setData]=useState<GraphResponse|null>(null);const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [revision,setRevision]=useState(0);
 const [selected,setSelected]=useState<string>("");
 useEffect(()=>{let cancelled=false;setLoading(true);setError("");loadGraph(worldId,source,submitted).then(result=>{if(!cancelled){setData(result);setSelected(result.nodes[0]?.id??"");}}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[worldId,source,submitted,revision]);
 const positions=useMemo(()=>{
  const nodes=data?.nodes??[];const width=960,height=560;const cx=width/2,cy=height/2;
  const radius=Math.min(235,Math.max(100,55+nodes.length*4));
  return new Map(nodes.map((node,index)=>{const angle=(2*Math.PI*index/Math.max(nodes.length,1))-Math.PI/2;return[node.id,{x:cx+radius*Math.cos(angle),y:cy+radius*Math.sin(angle)}] as const;}));
 },[data]);
 const node=data?.nodes.find(x=>x.id===selected)??null;
 const connected=data?.edges.filter(x=>x.from===selected||x.to===selected)??[];
 const counts=Object.entries((data?.nodes??[]).reduce<Record<string,number>>((acc,n)=>{acc[n.type]=(acc[n.type]??0)+1;return acc;},{}));
 const search=()=>setSubmitted(query.trim());
 return <Space direction="vertical" size={16} style={{width:"100%"}}>
  <Card title="故事图谱" extra={<Button icon={<ReloadOutlined/>} onClick={()=>setRevision(x=>x+1)}>刷新</Button>}>
   <Space wrap style={{width:"100%",justifyContent:"space-between"}}>
    <Space wrap>
     <Select value={source} onChange={setSource} style={{width:180}} options={[{value:"original",label:"原著全文图谱"},{value:"sequel",label:"续写动态状态图谱"}]}/>
     <Input.Search value={query} onChange={e=>setQuery(e.target.value)} onSearch={search} allowClear placeholder="搜索人物、事件、伏笔或剧情线" style={{width:320}} enterButton={<SearchOutlined/>}/>
    </Space>
    <Typography.Text type="secondary">搜索命中节点及其一跳关联；留空显示图谱概览</Typography.Text>
   </Space>
   {error?<Alert type="error" showIcon message={error}/>:null}
   {data&&!data.available?<Alert style={{marginTop:12}} type="info" showIcon message="原著图谱尚不可用" description={data.reason}/>:null}
   {data?.available?<><Space wrap style={{marginTop:16}}>
    <Statistic title="节点" value={data.totalNodes}/><Statistic title="关系" value={data.totalEdges}/><Statistic title="当前显示" value={data.returnedNodes}/>
    {counts.map(([type,count])=><Tag key={type} color="default">{labels[type]??type} {count}</Tag>)}
   </Space>
   {data.truncated?<Alert style={{marginTop:12}} type="warning" message="当前结果已截断，请增加搜索条件缩小范围。"/>:null}
   <div style={{overflowX:"auto",marginTop:12,border:"1px solid #edf0f3",borderRadius:8,background:"#fbfcfd"}}>
    <svg viewBox="0 0 960 560" role="img" aria-label="交互式故事关系图" style={{width:"100%",minWidth:650,height:"auto",display:"block"}}>
     {data.edges.map(edge=>{const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)return null;return <g key={edge.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#b8c2cc" strokeWidth={selected&&(edge.from===selected||edge.to===selected)?2.4:1.1} opacity={selected&&(edge.from!==selected&&edge.to!==selected)?0.25:0.8}/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2-5} textAnchor="middle" fontSize="10" fill="#667482">{edge.label}</text></g>;})}
     {data.nodes.map(n=>{const p=positions.get(n.id)!;const active=n.id===selected;return <g key={n.id} onClick={()=>setSelected(n.id)} style={{cursor:"pointer"}}><circle cx={p.x} cy={p.y} r={active?13:10} fill={colors[n.type]??"#778899"} stroke={active?"#172b40":"white"} strokeWidth={active?3:1.5}/><text x={p.x} y={p.y+25} textAnchor="middle" fontSize="12" fontWeight={active?700:500} fill="#243447">{n.label.length>16?n.label.slice(0,15)+"…":n.label}</text></g>;})}
    </svg>
   </div>
   <Typography.Text type="secondary">点击节点查看详情。节点位置用于浏览，不代表时间顺序、因果强度或人物关系权重。</Typography.Text>
   </>:null}
  </Card>
  {data?.available&&node?<Card title={<Space>{node.label}<Tag color="blue">{labels[node.type]??node.type}</Tag></Space>} extra={<Typography.Text type="secondary">{connected.length} 条关联</Typography.Text>}>
   <Typography.Paragraph type="secondary" style={{fontSize:12,wordBreak:"break-all"}}>{node.id}</Typography.Paragraph>
   <Typography.Title level={5}>节点数据</Typography.Title>
   <pre style={{whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:280,overflow:"auto",background:"#f6f8fa",padding:12,borderRadius:6}}>{pretty(node.data)}</pre>
   <Typography.Title level={5}>关联关系</Typography.Title>
   {connected.length?connected.map(edge=><div key={edge.id} style={{padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}><Space wrap><Tag>{edge.label||edge.type}</Tag><Typography.Text>{data.nodes.find(x=>x.id===(edge.from===node.id?edge.to:edge.from))?.label??edge.to}</Typography.Text></Space>{Object.keys(edge.data??{}).length?<pre style={{whiteSpace:"pre-wrap",fontSize:11}}>{pretty(edge.data)}</pre>:null}</div>):<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无显式关联"/>}
  </Card>:null}
  {data?.available&&data.nodes.length===0?<Empty description="没有匹配节点；可清空搜索查看完整图谱"/>:null}
  <Spin spinning={loading} fullscreen={false}/>
 </Space>;
}
