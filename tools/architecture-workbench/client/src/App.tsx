import { useEffect, useMemo, useState } from "react";
import {
  Alert, Avatar, Breadcrumb, Button, Card, Checkbox, Col, DatePicker, Divider, Empty,
  Form, Input, Layout, List, Menu, Modal, Progress, Row, Select, Space, Statistic,
  Steps, Table, Tabs, Tag, Timeline, Tooltip, Typography, Upload, message
} from "antd";
import type { FormInstance } from "antd";
import {
  AppstoreOutlined, ApartmentOutlined, ArrowLeftOutlined, AuditOutlined,
  CheckCircleOutlined, ClockCircleOutlined, CloudUploadOutlined, CopyOutlined,
  BarChartOutlined, DeleteOutlined, EditOutlined, FileProtectOutlined, LinkOutlined, PlusOutlined,
  ProjectOutlined, SafetyCertificateOutlined, TeamOutlined, UnorderedListOutlined, UserAddOutlined, UploadOutlined
} from "@ant-design/icons";
import dayjs from "dayjs";
import { api, setActor } from "./api";
import type { Activity, AgentPlan, AgentProfile, AgentRun, Artifact, Bootstrap, Comment, DebtItem, ExternalResourceRef, MyTask, Person, Participation, Review, WorkItem, WorkItemDetail, WorkTask, WorkbenchAnalytics } from "./types";

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const statusLabels: Record<string,string> = {
  draft:"待受理", analysis:"处理中", in_review:"评审与确认中", changes_requested:"待修改",
  accepted:"已接受", rejected:"已拒绝", closed:"已完成", open:"待处理",
  in_progress:"处理中", deferred:"已延期", resolved:"已解决", cancelled:"已取消",
  accepted_with_conditions:"附条件接受", more_analysis:"需要更多分析",
  queued:"待领取", running:"执行中", waiting_for_human:"等待人工输入", completed:"已完成", failed:"执行失败", blocked:"受阻"
};
const statusColors: Record<string,string> = {
  draft:"default", analysis:"processing", in_review:"processing", changes_requested:"warning",
  accepted:"success", rejected:"error", closed:"default", open:"warning", in_progress:"processing",
  deferred:"purple", resolved:"success", cancelled:"default", accepted_with_conditions:"success",
  queued:"default", running:"processing", waiting_for_human:"warning", completed:"success", failed:"error",
  more_analysis:"warning"
};
const roleColors: Record<string,string> = {
  solution_architect:"blue", enterprise_architect:"purple", security_architect:"red",
  solution_sme:"cyan", development_manager:"gold", decision_authority:"green"
};
const dateText = (value?: string | null) => value ? dayjs(value).format("YYYY-MM-DD") : "—";

export default function App() {
  const [bootstrap,setBootstrap] = useState<Bootstrap|null>(null);
  const [actor,setActorState] = useState("u-sa");
  const [page,setPage] = useState(()=>{
    const params=new URLSearchParams(window.location.search);
    return params.get("page") || (params.has("item") ? "work-items" : "my-work");
  });
  const [analyticsTab,setAnalyticsTab] = useState(()=>new URLSearchParams(window.location.search).get("tab") || "requests");
  const [selected,setSelected] = useState<WorkItem|null>(null);
  const [detail,setDetail] = useState<WorkItemDetail|null>(null);
  const [loading,setLoading] = useState(true);
  const [newItemOpen,setNewItemOpen] = useState(false);
  const [artifactOpen,setArtifactOpen] = useState(false);
  const [reviewOpen,setReviewOpen] = useState(false);
  const [taskOpen,setTaskOpen] = useState(false);
  const [editingTaskId,setEditingTaskId] = useState<string|null>(null);
  const [decisionOpen,setDecisionOpen] = useState(false);
  const [debtOpen,setDebtOpen] = useState(false);
  const [participantOpen,setParticipantOpen] = useState(false);
  const [externalLinkOpen,setExternalLinkOpen] = useState(false);
  const [externalReferences,setExternalReferences] = useState<ExternalResourceRef[]>([]);
  const [analyticsData,setAnalyticsData] = useState<WorkbenchAnalytics|null>(null);
  const [myTasks,setMyTasks] = useState<MyTask[]>([]);
  const [agentProfiles,setAgentProfiles] = useState<AgentProfile[]>([]);
  const [agentRunOpen,setAgentRunOpen] = useState(false);
  const [agentPlanOpen,setAgentPlanOpen] = useState(false);
  const [agentResumeOpen,setAgentResumeOpen] = useState(false);
  const [agentResumeRunId,setAgentResumeRunId] = useState<string|null>(null);
  const [editingParticipationId,setEditingParticipationId] = useState<string|null>(null);
  const [profilePersonId,setProfilePersonId] = useState<string|null>(null);
  const [profileOpen,setProfileOpen] = useState(false);
  const [newItemForm] = Form.useForm();
  const [artifactForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [taskForm] = Form.useForm();
  const [decisionForm] = Form.useForm();
  const [debtForm] = Form.useForm();
  const [participantForm] = Form.useForm();
  const [profileForm] = Form.useForm();
  const [externalLinkForm] = Form.useForm();
  const [agentForm] = Form.useForm();
  const [agentPlanForm] = Form.useForm();
  const [agentResumeForm] = Form.useForm();
  const [commentText,setCommentText] = useState("");
  const [query,setQuery] = useState("");
  const [busy,setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [data,analytics,tasks,profiles]=await Promise.all([api.bootstrap(),api.analytics(),api.myTasks(),api.agentProfiles()]);
      setBootstrap(data);
      setAnalyticsData(analytics);
      setMyTasks(tasks);
      setAgentProfiles(profiles.profiles);
      if (!profilePersonId) setProfilePersonId(actor);
      if (selected) {
        const fresh=data.workItems.find(item=>item.id===selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally { setLoading(false); }
  }
  async function openWorkItem(item:WorkItem) {
    setSelected(item); setDetail(null); setPage("work-items");
    writeRoute("work-items",item.id);
    try { setDetail(await api.detail(item.id)); }
    catch (error) { message.error(error instanceof Error ? error.message : "无法打开事项"); }
  }
  async function refreshDetail() {
    if (!selected) return;
    const [fresh,data]=await Promise.all([api.detail(selected.id),api.bootstrap()]);
    setDetail(fresh); setBootstrap(data);
  }
  useEffect(()=>{
    setActor(actor);setProfilePersonId(actor);setDetail(null);setSelected(null);void reload();
    const params=new URLSearchParams(window.location.search);
    const itemId=params.get("item");
    if(itemId) void api.detail(itemId).then(setDetail).catch(error=>{
      message.error(error instanceof Error?error.message:"无法打开事项");
      setPage("work-items");
      const fallback=new URLSearchParams();fallback.set("page","work-items");
      window.history.replaceState({}, "", window.location.pathname+"?"+fallback.toString());
    });
  },[actor]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.has("item")) params.set("page","work-items");
    else if(!params.has("page")) params.set("page",page);
    if(params.get("page")==="analytics") params.set("tab",params.get("tab") || "requests");
    else params.delete("tab");
    window.history.replaceState({}, "", window.location.pathname+"?"+params.toString());
  },[]);

  function writeRoute(nextPage:string,itemId?:string|null,tab?:string) {
    const params=new URLSearchParams();
    params.set("page",nextPage);
    if(itemId) params.set("item",itemId);
    if(nextPage==="analytics") params.set("tab",tab || "requests");
    const queryString=params.toString();
    window.history.pushState({}, "", window.location.pathname+(queryString?"?"+queryString:""));
  }
  function navigatePage(nextPage:string) {
    setPage(nextPage); setSelected(null); setDetail(null);
    if(nextPage==="analytics") setAnalyticsTab("requests");
    writeRoute(nextPage,null,nextPage==="analytics"?"requests":undefined);
  }
  function closeItemDrawer() {
    setSelected(null); setDetail(null); setPage("work-items"); writeRoute("work-items");
  }
  useEffect(()=>{
    const syncFromUrl=()=>{
      const params=new URLSearchParams(window.location.search);
      const itemId=params.get("item");
      const nextPage=params.get("page") || (itemId ? "work-items" : "my-work");
      setPage(nextPage);
      setAnalyticsTab(params.get("tab") || "requests");
      if(itemId) {
        setSelected(null); setDetail(null);
        void api.detail(itemId).then(setDetail).catch(error=>message.error(error instanceof Error?error.message:"无法打开事项"));
      } else {
        setSelected(null); setDetail(null);
      }
    };
    window.addEventListener("popstate",syncFromUrl);
    return ()=>window.removeEventListener("popstate",syncFromUrl);
  },[]);
  useEffect(()=>{if(detail) setSelected(detail.workItem);},[detail]);

  const actorPerson=bootstrap?.people.find(person=>person.id===actor);
  const profilePerson=bootstrap?.people.find(person=>person.id===(profilePersonId || actor)) || actorPerson;
  const filteredItems=useMemo(()=>(bootstrap?.workItems || []).filter(item=>
    [item.code,item.title,item.description,item.owner_name].join(" ").toLowerCase().includes(query.toLowerCase())
  ),[bootstrap,query]);
  const menuItems=[
    {key:"my-work",icon:<UnorderedListOutlined />,label:"我的工作"},
    {key:"work-items",icon:<ProjectOutlined />,label:"全部事项"},
    {key:"analytics",icon:<BarChartOutlined />,label:"Portfolio"},
    {key:"debts",icon:<FileProtectOutlined />,label:"技术债务"}
  ];

  async function submitForm(form:FormInstance,action:()=>Promise<unknown>,success:string,close:()=>void) {
    setBusy(true);
    try {
      await action(); message.success(success); close(); form.resetFields();
      await reload(); if (selected) await refreshDetail();
    } catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  const itemColumns=[
    {title:"事项",dataIndex:"title",key:"title",render:(_:string,item:WorkItem)=><Space direction="vertical" size={2}><Button type="link" className="table-link" onClick={()=>void openWorkItem(item)}>{item.title}</Button><Text type="secondary" className="small">{item.code} · {item.type.replaceAll("_"," ")}</Text></Space>},
    {title:"负责人",dataIndex:"owner_name",key:"owner_name"},
    {title:"状态",dataIndex:"status",key:"status",render:(v:string)=><Tag color={statusColors[v]}>{statusLabels[v] || v}</Tag>},
    {title:"优先级",dataIndex:"priority",key:"priority",render:(v:string)=><Tag color={v==="high"?"red":v==="normal"?"blue":"default"}>{v==="high"?"高":v==="normal"?"普通":"低"}</Tag>},
    {title:"产物",dataIndex:"artifact_count",key:"artifact_count",width:70},
    {title:"待办",dataIndex:"open_task_count",key:"open_task_count",width:70},
    {title:"目标日期",dataIndex:"target_date",key:"target_date",render:dateText}
  ];
  const debtColumns=[
    {title:"技术债务",dataIndex:"title",key:"title",render:(_:string,debt:DebtItem)=><Space direction="vertical" size={2}><Text strong>{debt.title}</Text><Text type="secondary" className="small">{debt.code}</Text></Space>},
    {title:"责任人",dataIndex:"owner_name",key:"owner_name"},
    {title:"严重程度",dataIndex:"severity",key:"severity",render:(v:string)=><Tag color={v==="high"?"red":v==="medium"?"orange":"blue"}>{v==="high"?"高":v==="medium"?"中":"低"}</Tag>},
    {title:"状态",dataIndex:"debt_status",key:"debt_status",render:(v:string,row:DebtItem)=><Select size="small" value={v} disabled={actor!==row.owner_id} style={{width:112}} onChange={value=>void updateDebt(row,value)} options={[{value:"open",label:"待处理"},{value:"in_progress",label:"处理中"},{value:"deferred",label:"已延期"},{value:"resolved",label:"已解决"}]} />},
    {title:"目标日期",dataIndex:"target_date",key:"target_date",render:dateText}
  ];

  async function updateDebt(debt:DebtItem,status:string) {
    try { await api.updateDebt(debt.id,{status}); message.success("技术债务状态已更新"); await reload(); }
    catch (error) { message.error(error instanceof Error ? error.message : "更新失败"); }
  }
  async function updateTask(taskId:string,status:string) {
    try {
      await api.updateTask(taskId,{status});
      message.success("Task 状态已更新");
      await reload();
      if (selected) await refreshDetail();
    } catch (error) { message.error(error instanceof Error ? error.message : "更新失败"); }
  }
  function editTaskAssignment(task:WorkTask) {
    setEditingTaskId(task.id);
    taskForm.setFieldsValue({
      title:task.title,kind:task.kind,ownerId:task.owner_id || itemFallbackOwner(),
      assigneeId:task.assignee_id || undefined,dueDate:task.due_date ? dayjs(task.due_date) : undefined
    });
    setTaskOpen(true);
  }
  function itemFallbackOwner() { return detail?.workItem.owner_id || selected?.owner_id || actor; }

  function openAgentRunDialog() {
    agentForm.resetFields();
    agentForm.setFieldsValue({agentKey:"solution-architect",objective:"根据当前 Request 分析目标、约束、关键方案和待澄清问题。"});
    setAgentRunOpen(true);
  }
  function openAgentPlanDialog() {
    agentPlanForm.resetFields();
    agentPlanForm.setFieldsValue({
      name:"多角色架构评估",
      agentKeys:["business-analyst","solution-architect","data-architect","security-reviewer"],
      objective:"围绕当前 Request 的业务目标、现状约束和外部依赖开展独立分析。每个角色从自己的专业角度给出证据、假设、风险和建议，最后由 Decision Analyst 汇总分歧与决策选项。"
    });
    setAgentPlanOpen(true);
  }
  function openAgentResumeDialog(run:AgentRun) {
    setAgentResumeRunId(run.id);
    agentResumeForm.resetFields();
    agentResumeForm.setFieldsValue({additionalContext:""});
    setAgentResumeOpen(true);
  }

  async function transitionWorkflow(action:string) {
    if (!selected) return;
    try {
      await api.transitionWorkItem(selected.id,action);
      message.success("Request 流程已更新");
      await reload();
      await refreshDetail();
    } catch (error) { message.error(error instanceof Error ? error.message : "流程转换失败"); }
  }

  function openParticipantDialog(participant?:Participation) {
    setEditingParticipationId(participant?.id || null);
    participantForm.resetFields();
    participantForm.setFieldsValue(participant ? {
      personId:participant.person_id,roleKey:participant.role_key,
      roleLabel:participant.role_label,permissions:JSON.parse(participant.permissions_json)
    } : {permissions:["read","comment"]});
    setParticipantOpen(true);
  }
  async function removeParticipant(participant:Participation) {
    if (!selected) return;
    try {
      await api.removeParticipation(selected.id,participant.id);
      message.success("相关人员已移除");
      await refreshDetail();
      await reload();
    } catch(error) { message.error(error instanceof Error ? error.message : "移除人员失败"); }
  }
  function openProfileEditor(person:Person) {
    profileForm.setFieldsValue({
      displayName:person.display_name,title:person.title,email:person.email,
      department:person.department,location:person.location,bio:person.bio,
      expertise:JSON.parse(person.expertise_json || "[]").join(", "),timezone:person.timezone
    });
    setProfileOpen(true);
  }
  async function openExternalLinkDialog() {
    try {
      const references=await api.externalResourceRefs();
      setExternalReferences(references);
      externalLinkForm.resetFields();
      externalLinkForm.setFieldsValue({provider:"jira",resourceType:"Story",relationType:"related_to"});
      setExternalLinkOpen(true);
    } catch(error) {
      message.error(error instanceof Error ? error.message : "无法读取已登记的外部引用");
    }
  }
  async function removeExternalLink(linkId:string) {
    if (!selected) return;
    try { await api.removeExternalLink(selected.id,linkId); message.success("外部关联已移除"); await refreshDetail(); }
    catch(error) { message.error(error instanceof Error ? error.message : "移除关联失败"); }
  }
  async function submitComment() {
    if (!selected || !commentText.trim()) return;
    try { await api.comment(selected.id,commentText.trim()); setCommentText(""); await refreshDetail(); }
    catch (error) { message.error(error instanceof Error ? error.message : "提交失败"); }
  }

  function breakdownCard(title:string,rows:Array<{key:string;count:number;label?:string}>) {
    const max=Math.max(1,...rows.map(row=>row.count));
    const labels:Record<string,string>={draft:"草稿",analysis:"分析中",in_review:"评审中",changes_requested:"待修改",accepted:"已接受",accepted_with_conditions:"附条件接受",rejected:"已拒绝",closed:"已关闭",high:"高",normal:"普通",low:"低",architecture_review:"架构评审",change_assessment:"变更评估",solution_assessment:"Solution 评估",risk_assessment:"风险评估",technical_debt:"技术债务",jira:"Jira",confluence:"Confluence",github:"GitHub",leanix:"LeanIX",open:"待处理",in_progress:"处理中",deferred:"已延期",resolved:"已解决",cancelled:"已取消",medium:"中"};
    const leader=[...rows].sort((a,b)=>b.count-a.count)[0];
    const total=rows.reduce((sum,row)=>sum+row.count,0);
    return <Card title={title} className="panel-card">
      {rows.length===0?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />:<>
        {leader?<Text type="secondary" className="analytics-insight">当前最多：{leader.label || labels[leader.key] || leader.key}，{leader.count} 项（{Math.round(leader.count/Math.max(1,total)*100)}%）。</Text>:null}
        {rows.map(row=><div className="analytics-bar" key={row.key}>
          <div className="analytics-bar-label"><Text>{row.label || labels[row.key] || row.key}</Text><Space size={10}><Text type="secondary" className="small">{Math.round(row.count/Math.max(1,total)*100)}%</Text><Text strong>{row.count}</Text></Space></div>
          <div className="analytics-track"><span style={{width:Math.round(row.count/max*100)+"%"}} /></div>
        </div>)}
      </>}
    </Card>;
  }
  function renderAnalytics() {
    if (!analyticsData) return <Card loading />;
    const r=analyticsData.requests;
    const d=analyticsData.technicalDebt;
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">PORTFOLIO INTELLIGENCE</Text><Title level={2}>Portfolio 分析</Title><Paragraph type="secondary">分别观察 Request 组合、评审负载、外部上下文引用覆盖，以及 Tech Debt 的存量、风险和偿还情况。</Paragraph></div><Text type="secondary" className="small">更新于 {dateText(analyticsData.generatedAt)}</Text></div>
      <Tabs activeKey={analyticsTab} onChange={key=>{setAnalyticsTab(key);writeRoute("analytics",null,key);}} items={[
        {key:"requests",label:"Request 分析",children:<div className="page-stack">
          <Row gutter={[16,16]}>
            <Col xs={12} lg={4}><Card className="metric-card"><Statistic title="Request 总数" value={r.total} /></Card></Col>
            <Col xs={12} lg={4}><Card className="metric-card"><Statistic title="活动中的 Request" value={r.active} /></Card></Col>
            <Col xs={12} lg={4}><Card className="metric-card"><Statistic title="评审中" value={r.inReview} /></Card></Col>
            <Col xs={12} lg={4}><Card className="metric-card"><Statistic title="已逾期" value={r.overdue} valueStyle={{color:r.overdue?"#cf1322":undefined}} /></Card></Col>
            <Col xs={12} lg={4}><Card className="metric-card"><Statistic title="已有关联的 Request" value={r.linked} /></Card></Col>
            <Col xs={12} lg={4}><Card className="metric-card"><Statistic title="外部引用数" value={r.externalReferenceCount} /></Card></Col>
          </Row>
          <Row gutter={[16,16]}>
            <Col xs={24} lg={8}>{breakdownCard("按状态分布",r.byStatus)}</Col>
            <Col xs={24} lg={8}>{breakdownCard("按 Request 类型",r.byType)}</Col>
            <Col xs={24} lg={8}>{breakdownCard("按优先级",r.byPriority)}</Col>
          </Row>
          <Row gutter={[16,16]}>
            <Col xs={24} lg={12}>{breakdownCard("Request Aging",r.aging)}</Col>
            <Col xs={24} lg={12}>
              <Card title="外部上下文引用覆盖" className="panel-card">
                <Table size="small" rowKey="key" pagination={false} dataSource={r.externalSystems} columns={[
                  {title:"系统",dataIndex:"key",render:(v:string)=><Tag color={v==="jira"?"blue":v==="confluence"?"cyan":v==="github"?"default":"purple"}>{v.toUpperCase()}</Tag>},
                  {title:"关联资源",dataIndex:"count"},
                  {title:"覆盖 Request",dataIndex:"requestCount"}
                ]} />
                <Divider />
                <Text type="secondary">有外部上下文引用的 Request：{r.linked}；尚无引用：{r.withoutExternalLinks}。该指标统计登记的引用关系，不代表外部系统已连接或数据已同步。</Text>
              </Card>
            </Col>
          </Row>
        </div>},
        {key:"debt",label:"Tech Debt 分析",children:<div className="page-stack">
          <Row gutter={[16,16]}>
            <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="Tech Debt 总数" value={d.total} /></Card></Col>
            <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="未解决" value={d.active} /></Card></Col>
            <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="已逾期" value={d.overdue} valueStyle={{color:d.overdue?"#cf1322":undefined}} /></Card></Col>
            <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="30 天内到期" value={d.dueNext30Days} /></Card></Col>
          </Row>
          <Row gutter={[16,16]}>
            <Col xs={24} lg={8}>{breakdownCard("按状态",d.byStatus)}</Col>
            <Col xs={24} lg={8}>{breakdownCard("按严重程度",d.bySeverity)}</Col>
            <Col xs={24} lg={8}>{breakdownCard("按优先级",d.byPriority)}</Col>
          </Row>
          <Row gutter={[16,16]}>
            <Col xs={24} lg={12}>{breakdownCard("Tech Debt Aging",d.aging)}</Col>
            <Col xs={24} lg={12}><Card title="来源 Request" className="panel-card">
              <Table size="small" rowKey="code" pagination={false} dataSource={d.byOriginRequest} columns={[
                {title:"Request",dataIndex:"code",render:(v:string,row:{code:string;title:string})=><div><Text strong>{v}</Text><div className="small muted">{row.title}</div></div>},
                {title:"Tech Debt 数",dataIndex:"debt_count"}
              ]} locale={{emptyText:"尚无来源关联"}} />
            </Card></Col>
          </Row>
          <Alert type="info" showIcon message="分析口径" description="Tech Debt 只有被单独登记为长期工作项时才计入台账；普通修订、分析和短期整改仍然是原 Request 下的 Task，不会被重复计入。" />
        </div>}
      ]} />
    </div>;
  }
  function renderDashboard() {
    if (!bootstrap) return <Card loading />;
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">BUSINESS WORK ITEM PLATFORM</Text><Title level={2}>工作概览</Title><Paragraph type="secondary">围绕业务事项组织参与者、工作、材料、评审和正式决策。</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>setNewItemOpen(true)}>新建事项</Button></div>
      <Row gutter={[16,16]}>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="进行中的事项" value={bootstrap.counts.openWorkItems} prefix={<ProjectOutlined />} /></Card></Col>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="等待评审" value={bootstrap.counts.awaitingReview} prefix={<AuditOutlined />} /></Card></Col>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="未解决技术债务" value={bootstrap.counts.activeDebts} prefix={<FileProtectOutlined />} /></Card></Col>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="我的待办" value={bootstrap.counts.myTasks} prefix={<ClockCircleOutlined />} /></Card></Col>
      </Row>
      <Card title="最近业务事项" extra={<Button type="link" onClick={()=>navigatePage("work-items")}>查看全部</Button>} className="panel-card">
        <Table rowKey="id" columns={itemColumns} dataSource={bootstrap.workItems.slice(0,8)} pagination={false} loading={loading} />
      </Card>
      <Card title="技术债务跟踪" extra={<Button type="link" onClick={()=>setPage("debts")}>打开台账</Button>} className="panel-card">
        <Table rowKey="id" columns={debtColumns} dataSource={bootstrap.debts.slice(0,3)} pagination={false} />
      </Card>
    </div>;
  }

  function renderWorkItems() {
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">WORK MANAGEMENT</Text><Title level={2}>业务事项</Title><Paragraph type="secondary">同一事项可由不同团队成员通过网站或外部 Agent 协作完成。</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>setNewItemOpen(true)}>新建事项</Button></div>
      <Card className="panel-card"><div className="table-toolbar"><Input.Search allowClear placeholder="搜索事项、编号或负责人" onSearch={setQuery} onChange={e=>setQuery(e.target.value)} style={{maxWidth:360}} /><Text type="secondary">{filteredItems.length} 个事项</Text></div><Table rowKey="id" columns={itemColumns} dataSource={filteredItems} loading={loading} pagination={{pageSize:8}} /></Card>
    </div>;
  }
  function renderDebts() {
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">FOLLOW-UP GOVERNANCE</Text><Title level={2}>技术债务</Title><Paragraph type="secondary">技术债务作为独立的后续 Work Item 管理，并保留来源事项和来源 Decision 关系。</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>{debtForm.setFieldsValue({originWorkItemId:bootstrap?.workItems[0]?.id,priority:"normal",severity:"medium"});setDebtOpen(true);}}>记录技术债务</Button></div>
      <Card className="panel-card"><Table rowKey="id" columns={debtColumns} dataSource={bootstrap?.debts || []} loading={loading} pagination={{pageSize:8}} /></Card>
      <Alert type="info" showIcon message="模型边界" description="临时整改可以是 Task；需要单独排序、预算、复查或跨项目治理的长期负担，才提升为关联 Work Item。" />
    </div>;
  }
  function renderMyWork() {
    const mine=(bootstrap?.workItems || []).filter(item=>item.owner_id===actor || item.requestor_id===actor);
    const activeTasks=myTasks.filter(task=>!["done","cancelled"].includes(task.status));
    const taskColumns=[
      {title:"任务",dataIndex:"title",render:(value:string,task:MyTask)=><div><Text strong>{value}</Text><div className="small muted">{task.kind}</div></div>},
      {title:"所属事项",dataIndex:"work_item_title",render:(value:string,task:MyTask)=><Button type="link" className="table-link" onClick={()=>{const item=bootstrap?.workItems.find(entry=>entry.id===task.work_item_id);if(item)void openWorkItem(item);}}>{task.work_item_code} · {value}</Button>},
      {title:"任务负责人",dataIndex:"owner_name",render:(value:string|null)=>value || "—"},
      {title:"执行分配",dataIndex:"assignee_name",render:(value:string|null)=>value || "尚未分配"},
      {title:"我的角色",render:(_:unknown,task:MyTask)=>task.owner_id===actor && task.assignee_id===actor?"负责人 / 执行人":task.owner_id===actor?"任务负责人":"执行人"},
      {title:"状态",dataIndex:"status",render:(value:string,task:MyTask)=><Select size="small" value={value} style={{width:120}} onChange={status=>void updateTask(task.id,status)} options={[{value:"open",label:"待处理"},{value:"in_progress",label:"处理中"},{value:"blocked",label:"受阻"},{value:"done",label:"完成"},{value:"cancelled",label:"取消"}]} />},
      {title:"截止日期",dataIndex:"due_date",render:dateText},
      {title:"Requestor",dataIndex:"requestor_name",render:(value:string|null)=>value || "—"}
    ];
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">PERSONAL WORK QUEUE</Text><Title level={2}>我的工作</Title><Paragraph type="secondary">这里汇总你负责或被分配的工作；任务负责人对结果负责，执行分配表示当前由谁处理。</Paragraph></div></div>
      <Row gutter={[16,16]}>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="待完成任务" value={activeTasks.length} /></Card></Col>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="处理中" value={activeTasks.filter(task=>task.status==="in_progress").length} /></Card></Col>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="受阻" value={activeTasks.filter(task=>task.status==="blocked").length} /></Card></Col>
        <Col xs={12} lg={6}><Card className="metric-card"><Statistic title="已完成" value={myTasks.filter(task=>task.status==="done").length} /></Card></Col>
      </Row>
      <Card title="我负责或执行的 Task" className="panel-card"><Table rowKey="id" columns={taskColumns} dataSource={activeTasks} loading={loading} pagination={{pageSize:8}} locale={{emptyText:<Empty description="当前没有你负责或执行的任务" />}} /></Card>
      <Card title="我发起或负责的 Request" className="panel-card"><Table rowKey="id" columns={itemColumns} dataSource={mine} pagination={{pageSize:6}} /></Card>
      <Card title="我的 Person Profile" className="panel-card" extra={<Button type="link" onClick={()=>navigatePage("people")}>查看资料</Button>}>
        <Space><Avatar size={44} style={{background:actorPerson?.avatar_color}}>{actorPerson?.display_name.slice(0,1)}</Avatar><div><Text strong>{actorPerson?.display_name}</Text><div><Text type="secondary">{actorPerson?.title} · {actorPerson?.department}</Text></div></div></Space>
      </Card>
    </div>;
  }
  function renderPeople() {
    if (!bootstrap) return <Card loading />;
    const selectedPerson=profilePerson;
    const expertise=selectedPerson ? JSON.parse(selectedPerson.expertise_json || "[]") as string[] : [];
    const canEdit=Boolean(selectedPerson && (selectedPerson.id===actor || actorPerson?.is_admin));
    const columns=[
      {title:"人员",dataIndex:"display_name",render:(value:string,person:Person)=><Space><Avatar style={{background:person.avatar_color}}>{value.slice(0,1)}</Avatar><div><Text strong>{value}</Text><div className="small muted">{person.title}</div></div></Space>},
      {title:"部门",dataIndex:"department"},
      {title:"地点",dataIndex:"location"},
      {title:"角色",dataIndex:"is_admin",render:(value:number)=>value?<Tag color="purple">Workbench Admin</Tag>:<Tag>Participant</Tag>}
    ];
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">PEOPLE & PROFILES</Text><Title level={2}>人员目录与 Person Profile</Title><Paragraph type="secondary">统一查看参与者的职责、专业领域和联系方式。个人可以维护自己的资料，Workbench Admin 可以维护目录中的其他人员。</Paragraph></div></div>
      <Row gutter={[16,16]}>
        <Col xs={24} xl={13}>
          <Card title="人员目录" className="panel-card">
            <Table rowKey="id" size="middle" dataSource={bootstrap.people} columns={columns} pagination={{pageSize:8}}
              onRow={person=>({onClick:()=>setProfilePersonId(person.id),style:{cursor:"pointer",background:person.id===selectedPerson?.id?"#f4f7fb":undefined}})} />
          </Card>
        </Col>
        <Col xs={24} xl={11}>
          {selectedPerson ? <Card className="panel-card" title="Person Profile" extra={canEdit?<Button icon={<EditOutlined />} onClick={()=>openProfileEditor(selectedPerson)}>编辑资料</Button>:null}>
            <Space align="start" size={14}>
              <Avatar size={58} style={{background:selectedPerson.avatar_color,fontSize:24}}>{selectedPerson.display_name.slice(0,1)}</Avatar>
              <div><Title level={4} style={{margin:"2px 0 4px"}}>{selectedPerson.display_name}</Title><Text type="secondary">{selectedPerson.title}</Text><div>{selectedPerson.is_admin?<Tag color="purple">Workbench Admin</Tag>:null}</div></div>
            </Space>
            <Divider />
            <Row gutter={[12,16]}>
              <Col span={12}><Text type="secondary" className="small">部门</Text><div><Text strong>{selectedPerson.department || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">地点</Text><div><Text strong>{selectedPerson.location || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">Email</Text><div><Text strong>{selectedPerson.email || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">Timezone</Text><div><Text strong>{selectedPerson.timezone || "—"}</Text></div></Col>
            </Row>
            <Divider />
            <Text type="secondary" className="small">简介</Text>
            <Paragraph>{selectedPerson.bio || "尚未填写个人简介。"}</Paragraph>
            <Text type="secondary" className="small">专业领域</Text>
            <div className="profile-expertise">{expertise.length ? expertise.map(value=><Tag key={value}>{value}</Tag>) : <Text type="secondary">尚未添加专业领域。</Text>}</div>
          </Card> : <Card className="panel-card"><Empty description="请选择人员查看资料" /></Card>}
        </Col>
      </Row>
    </div>;
  }

  function renderReviews() {
    const reviewItems=(bootstrap?.workItems || []).filter(item=>item.status==="in_review");
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">REVIEW QUEUE</Text><Title level={2}>架构与 ADR 评审</Title><Paragraph type="secondary">评审意见绑定明确的 Artifact 版本；专业人员可以独立提交意见。</Paragraph></div></div>
      <Card className="panel-card"><List dataSource={reviewItems} renderItem={item=><List.Item actions={[<Button type="link" onClick={()=>void openWorkItem(item)}>打开评审</Button>]}><List.Item.Meta avatar={<Avatar icon={<AuditOutlined />} />} title={item.title} description={item.code+" · "+item.owner_name} /></List.Item>} locale={{emptyText:<Empty description="当前没有待评审事项" />}} /></Card>
    </div>;
  }

  function renderDetailContent() {
    if (!detail) return <Card loading />;
    const item=detail.workItem;
    const permissions=detail.permissions;
    const currentCycle=detail.cycles[0];
    const reviewableArtifacts=currentCycle ? (JSON.parse(currentCycle.baseline_json) as {id:string;version:number}[])
      .map(entry=>detail.artifacts.find(artifact=>artifact.id===entry.id && artifact.version===entry.version))
      .filter((artifact):artifact is Artifact=>Boolean(artifact)) : [];
    const activeTask=detail.tasks.find(task=>task.status==="in_progress")
      || detail.tasks.find(task=>task.status==="blocked")
      || detail.tasks.find(task=>task.status==="open");
    const phaseAction:Record<string,string>={
      draft:"确认目标和范围，由事项负责人受理后开始分析。",
      analysis:"完成当前任务并更新材料；具备评审条件后提交。",
      changes_requested:"逐项处理评审意见，形成新材料版本后重新提交。",
      in_review:"等待独立评审完成，由授权人员记录正式决定。",
      accepted:"落实决定中的后续义务，再关闭事项。",
      rejected:"确认拒绝决定的后续处理，再关闭事项。",
      closed:"事项已完成，材料版本、评审和决定记录仍可查阅。"
    };
    const taskIsNext= ["analysis","changes_requested","accepted","rejected"].includes(item.status) && Boolean(activeTask);
    const nextAction=taskIsNext && activeTask
      ? (activeTask.status==="blocked" ? "解除阻塞："+activeTask.title+"（任务负责人："+(activeTask.owner_name || item.owner_name)+"；执行人："+(activeTask.assignee_name || "待分配")+"）" : "完成当前任务："+activeTask.title+"（任务负责人："+(activeTask.owner_name || item.owner_name)+"；执行人："+(activeTask.assignee_name || "待分配")+"）")
      : (phaseAction[item.status] || "确认下一步工作。");
    const latestArtifacts=detail.artifacts.filter((artifact,index,all)=>all.findIndex(candidate=>(candidate.code || candidate.id)===(artifact.code || artifact.id))===index);
    const manifestEntries=(manifest:string):{id:string;version:number;code?:string|null;type?:string;title?:string;content_hash?:string}[]=>{
      try { const parsed=JSON.parse(manifest); return Array.isArray(parsed)?parsed:[]; }
      catch { return []; }
    };
    const manifestCount=(manifest:string)=>manifestEntries(manifest).length;
    const showArtifact=(artifact:Artifact)=>Modal.info({
      title:(artifact.code || artifact.type)+" · "+artifact.title+" · v"+artifact.version,
      width:820,
      content:<div style={{maxHeight:"65vh",overflow:"auto"}}><Paragraph>{artifact.summary}</Paragraph><Paragraph style={{whiteSpace:"pre-wrap"}}>{artifact.content}</Paragraph></div>
    });
    const taskExecutor=(task:WorkTask)=>{
      const run=detail.agentRuns.find(entry=>entry.task_id===task.id && ["running","queued","waiting_for_human"].includes(entry.status));
      if (run) {
        const profile=agentProfiles.find(entry=>entry.key===run.agent_key);
        return <Space direction="vertical" size={0}><Text>{profile?.name || run.agent_key}</Text><Text type="secondary" className="small">{run.claimed_by_name ? "执行身份："+run.claimed_by_name : statusLabels[run.status] || run.status}</Text></Space>;
      }
      return task.assignee_name || "尚未分配";
    };
    return <div className="detail-body work-item-workspace">
      <div className="detail-topline">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={closeItemDrawer}>全部事项</Button>
        <Breadcrumb items={[{title:"全部事项"},{title:item.code}]} />
      </div>
      <div className="detail-heading">
        <div className="workspace-title">
          <Space wrap><Text type="secondary">{item.code}</Text><Tag color={statusColors[item.status]}>{statusLabels[item.status] || item.status}</Tag></Space>
          <Title level={2}>{item.title}</Title>
          <Paragraph type="secondary">{item.description || "尚未补充事项说明。"}</Paragraph>
        </div>
        <Space wrap>
          {permissions.includes("contribute") && <Button icon={<PlusOutlined />} onClick={()=>setArtifactOpen(true)}>添加材料</Button>}
          {detail.workflow.availableActions.includes("submit_for_review") && <Button type="primary" onClick={()=>void transitionWorkflow("submit_for_review")}>提交评审</Button>}
          {detail.workflow.availableActions.some(action=>["accept","reject","more_analysis"].includes(action)) && <Button type="primary" onClick={()=>setDecisionOpen(true)}>记录正式决定</Button>}
        </Space>
      </div>

      <Card className="workspace-summary" size="small">
        <Row gutter={[20,12]}>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">当前阶段</Text><div><Text strong>{statusLabels[item.status] || item.status}</Text></div></Col>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">事项负责人</Text><div><Text strong>{item.owner_name}</Text></div></Col>
          <Col xs={24} md={14}><Text type="secondary" className="workflow-label">下一步</Text><div><Text strong>{nextAction}</Text></div></Col>
        </Row>
      </Card>

      <Card className="workflow-card" size="small" title="事项进展">
        <Steps current={detail.workflow.currentStep} status={detail.workflow.visualStatus} items={detail.workflow.steps} />
        <Space wrap className="workflow-actions">
          {detail.workflow.availableActions.includes("start_analysis") && <Button type="primary" onClick={()=>void transitionWorkflow("start_analysis")}>开始处理</Button>}

          {detail.workflow.availableActions.includes("close") && <Button onClick={()=>void transitionWorkflow("close")}>关闭事项</Button>}
        </Space>
        {detail.workflow.history.length>0 && <details className="workspace-disclosure">
          <summary>查看流程变化记录（{detail.workflow.history.length}）</summary>
          <Timeline items={detail.workflow.history.map(entry=>({children:<><Text strong>{entry.actor_name}</Text><div>{statusLabels[entry.from_status] || entry.from_status} → {statusLabels[entry.to_status] || entry.to_status}</div><Text type="secondary" className="small">{dateText(entry.created_at)} · {entry.reason || entry.action}</Text></>}))} />
        </details>}
      </Card>

      <Card size="small" title="当前工作" className="workspace-section" extra={permissions.includes("contribute")?<Button size="small" icon={<PlusOutlined />} onClick={()=>{setEditingTaskId(null);taskForm.resetFields();taskForm.setFieldsValue({ownerId:item.owner_id,assigneeId:detail.participants.some(person=>person.person_id===actor)?actor:undefined});setTaskOpen(true);}}>新增任务</Button>:null}>
        {detail.tasks.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待办任务" /> :
          <Table rowKey="id" size="middle" dataSource={detail.tasks} pagination={false} columns={[
            {title:"工作内容",dataIndex:"title",render:(value:string,task:WorkTask)=><Space direction="vertical" size={2}><Text strong>{value}</Text><Text type="secondary" className="small">{task.kind.replaceAll("_"," ")}</Text></Space>},
            {title:"任务负责人",dataIndex:"owner_name",render:(value:string|null)=><Text>{value || item.owner_name}</Text>},
            {title:"执行分配",dataIndex:"assignee_name",render:(_:string|null,task:WorkTask)=>taskExecutor(task)},
            {title:"状态",dataIndex:"status",render:(value:string,task:WorkTask)=><Select size="small" value={value} disabled={!permissions.includes("contribute") && task.assignee_id!==actor && task.owner_id!==actor} style={{width:112}} onChange={status=>void updateTask(task.id,status)} options={[{value:"open",label:"待处理"},{value:"in_progress",label:"处理中"},{value:"blocked",label:"受阻"},{value:"done",label:"完成"},{value:"cancelled",label:"取消"}]} />},
            {title:"目标日期",dataIndex:"due_date",render:dateText},
            {title:"",key:"actions",width:100,render:(_:unknown,task:WorkTask)=>permissions.includes("contribute")?<Button size="small" type="link" icon={<EditOutlined />} onClick={()=>editTaskAssignment(task)}>调整分工</Button>:null}
          ]} />
        }
      </Card>

      <Card size="small" title="交付材料" className="workspace-section" extra={permissions.includes("contribute")?<Button size="small" icon={<PlusOutlined />} onClick={()=>setArtifactOpen(true)}>添加材料</Button>:null}>
        {latestArtifacts.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未提交材料" /> :
          <List dataSource={latestArtifacts} renderItem={artifact=><List.Item actions={[<Button key="view" type="link" onClick={()=>showArtifact(artifact)}>查看</Button>]}>
            <List.Item.Meta avatar={<Avatar icon={<FileProtectOutlined />} />} title={<Space wrap><Text strong>{artifact.title}</Text><Tag>{artifact.code || artifact.type}</Tag><Tag>v{artifact.version}</Tag></Space>} description={<>{artifact.summary || "暂无摘要"}<div className="small muted">{artifact.submitter_name} · {dateText(artifact.created_at)}</div></>} />
          </List.Item>} />
        }
        {detail.submissions.length>0 && <div className="submission-history">
          <Text type="secondary" className="small">正式提交记录</Text>
          <List size="small" dataSource={detail.submissions} renderItem={submission=>{
            const entries=manifestEntries(submission.manifest_json);
            return <List.Item>
              <List.Item.Meta title={"Submission "+submission.sequence+" · "+entries.length+" 份材料"} description={<>
                <div>{submission.created_by_name} · {dateText(submission.created_at)} · Context v{submission.context_version ?? "legacy"}</div>
                <details className="submission-manifest-disclosure">
                  <summary>查看本次提交固定的材料与版本</summary>
                  <List size="small" dataSource={entries} renderItem={entry=><List.Item>
                    <List.Item.Meta title={<Space wrap><Text>{entry.code || entry.type || entry.id}</Text><Text strong>{entry.title || "材料"}</Text><Tag>v{entry.version}</Tag></Space>} description={entry.content_hash ? "SHA-256 · "+entry.content_hash.slice(0,16)+"…" : "历史基线未记录内容指纹"} />
                  </List.Item>} />
                </details>
              </>} />
              {currentCycle?.submission_id===submission.id ? <Tag color="processing">当前评审基线</Tag> : null}
            </List.Item>;
          }} />
        </div>}
        <details className="workspace-disclosure">
          <summary>材料版本历史（{detail.artifacts.length} 个版本）</summary>
          <List size="small" dataSource={detail.artifacts} renderItem={artifact=><List.Item actions={[<Button key="view" type="link" onClick={()=>showArtifact(artifact)}>查看版本</Button>]}>
            <List.Item.Meta title={<Space wrap><Text>{artifact.title}</Text><Tag>{artifact.code || artifact.type}</Tag><Tag>v{artifact.version}</Tag></Space>} description={artifact.submitter_name+" · "+dateText(artifact.created_at)} />
          </List.Item>} />
        </details>
      </Card>

      <Card size="small" title="讨论" className="workspace-section">
        <Space.Compact block><Input value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="补充事实、提出问题或回应讨论..." onPressEnter={()=>void submitComment()} /><Button type="primary" onClick={()=>void submitComment()}>发送</Button></Space.Compact>
        <List className="comment-list" dataSource={detail.comments} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无讨论" />}} renderItem={(comment:Comment)=><List.Item>
          <List.Item.Meta avatar={<Avatar style={{background:comment.avatar_color}}>{comment.author_name.slice(0,1)}</Avatar>} title={<Space><Text strong>{comment.author_name}</Text><Text type="secondary" className="small">{dateText(comment.created_at)}</Text></Space>} description={comment.body} />
        </List.Item>} />
      </Card>

      <details className="advanced-information">
        <summary>更多信息 <Text type="secondary">参与者、评审、决定、外部引用和 Agent 执行记录</Text></summary>
        <div className="advanced-grid">
          <Card size="small" title={"参与者 · "+detail.participants.length}>
            <div className="participant-grid participant-grid-managed">
              {detail.participants.map(participant=><div className="participant" key={participant.id}>
                <Avatar style={{background:participant.avatar_color}}>{participant.display_name.slice(0,1)}</Avatar>
                <div className="participant-main"><Text strong>{participant.display_name}</Text><div><Tag color={roleColors[participant.role_key] || "default"}>{participant.role_label}</Tag>{participant.person_id===item.requestor_id?<Tag>发起人</Tag>:null}</div><Text type="secondary" className="small">{participant.title}{participant.department?" · "+participant.department:""}</Text></div>
                {detail.canManageParticipants?<Space size={0}><Button type="text" size="small" icon={<EditOutlined />} title="编辑职责和权限" onClick={()=>openParticipantDialog(participant)} />{participant.person_id!==item.requestor_id && participant.person_id!==item.owner_id?<Button type="text" danger size="small" icon={<DeleteOutlined />} title="移除" onClick={()=>Modal.confirm({title:"移除此参与者？",content:"既有评审和活动记录会保留。",onOk:()=>removeParticipant(participant)})} />:null}</Space>:null}
              </div>)}
            </div>
            {detail.canManageParticipants?<Button size="small" icon={<UserAddOutlined />} onClick={()=>openParticipantDialog()}>添加参与者</Button>:null}
          </Card>

          <Card size="small" title={"评审记录 · "+detail.reviews.length}>
            <Text type="secondary" className="small">{currentCycle ? currentCycle.name+" · 固定材料基线" : "尚未启动评审"}</Text>
            {permissions.includes("review") && currentCycle?.status==="active" ? <Button size="small" icon={<PlusOutlined />} disabled={reviewableArtifacts.length===0} onClick={()=>{reviewForm.setFieldsValue({artifactId:reviewableArtifacts[0]?.id,outcome:"comment",discipline:actorPerson?.title || "General"});setReviewOpen(true);}}>提交评审意见</Button>:null}
            <List size="small" dataSource={detail.reviews} locale={{emptyText:"尚无评审意见"}} renderItem={(review:Review)=><List.Item><List.Item.Meta title={<Space wrap><Text strong>{review.reviewer_name}</Text><Tag>{review.discipline}</Tag><Tag color={review.outcome==="approve"?"success":review.outcome==="request_changes"?"warning":"default"}>{review.outcome}</Tag></Space>} description={<>{review.summary}<div className="small muted">{review.artifact_code || review.artifact_title} · v{review.artifact_version} · {dateText(review.created_at)}</div></>} /></List.Item>} />
          </Card>

          <Card size="small" title={"正式决定 · "+detail.decisions.length}>
            <List size="small" dataSource={detail.decisions} locale={{emptyText:"尚无正式决定"}} renderItem={decision=><List.Item><List.Item.Meta title={<Space><Tag color={statusColors[decision.outcome]}>{statusLabels[decision.outcome] || decision.outcome}</Tag><Text strong>{decision.decision_maker_name}</Text></Space>} description={<>{decision.rationale}{decision.conditions?<div className="small muted">条件：{decision.conditions}</div>:null}<div className="small muted">{dateText(decision.created_at)}</div></>} /></List.Item>} />
          </Card>

          <Card size="small" title={"外部引用 · "+detail.externalLinks.length}>
            <List size="small" dataSource={detail.externalLinks} locale={{emptyText:"尚无外部引用"}} renderItem={link=><List.Item>
              <List.Item.Meta title={<Space wrap><Tag>{link.provider.toUpperCase()}</Tag><Text strong>{link.external_key || link.external_id}</Text></Space>} description={link.title} />
              <Space>{link.url?<a href={link.url} target="_blank" rel="noreferrer">打开</a>:null}{permissions.includes("manage")?<Button size="small" type="link" danger onClick={()=>void removeExternalLink(link.id)}>移除</Button>:null}</Space>
            </List.Item>} />
            {permissions.includes("contribute")?<Button size="small" icon={<LinkOutlined />} onClick={()=>void openExternalLinkDialog()}>关联外部资源</Button>:null}
          </Card>

          <Card size="small" title={"附件 · "+detail.attachments.length}>
            <List size="small" dataSource={detail.attachments} locale={{emptyText:"尚无附件"}} renderItem={attachment=><List.Item><List.Item.Meta title={attachment.original_name} description={dateText(attachment.created_at)} /></List.Item>} />
          </Card>

          <Card size="small" title="Agent 协作（高级）" className="advanced-agent-card">
            <Space wrap><Text type="secondary" className="small">Agent 只准备草案；正式评审和决定仍由授权人员完成。</Text>{permissions.includes("contribute")?<Button size="small" onClick={openAgentPlanDialog}>发起多角色分析</Button>:null}</Space>
            <List size="small" dataSource={detail.agentPlans} locale={{emptyText:"尚无多角色分析计划"}} renderItem={plan=><List.Item>
              <List.Item.Meta title={<Space wrap><Text strong>{plan.name}</Text><Tag color={statusColors[plan.status] || "default"}>{statusLabels[plan.status] || plan.status}</Tag></Space>} description={<>{plan.objective}<div className="small muted">{plan.nodes.filter(node=>node.status==="completed").length}/{plan.nodes.length} 个执行节点已完成</div></>} />
              {plan.result_artifact_id?<Button type="link" size="small" onClick={()=>{const artifact=detail.artifacts.find(entry=>entry.id===plan.result_artifact_id);if(artifact)showArtifact(artifact);}}>查看草案</Button>:null}
            </List.Item>} />
            <List size="small" dataSource={detail.agentRuns} locale={{emptyText:"尚无 Agent 执行记录"}} renderItem={run=><List.Item>
              <List.Item.Meta title={<Space wrap><Text strong>{agentProfiles.find(profile=>profile.key===run.agent_key)?.name || run.agent_key}</Text><Tag color={statusColors[run.status] || "default"}>{statusLabels[run.status] || run.status}</Tag></Space>} description={<>{run.objective}<div className="small muted">请求人：{run.requested_by_name} · 实际执行身份：{run.claimed_by_name || "尚未领取"} · {dateText(run.created_at)}</div>{run.handoff_reason?<Text type="warning">等待输入：{run.handoff_reason}</Text>:null}{run.error_message?<Text type="danger">失败：{run.error_message}</Text>:null}</>} />
              {run.result_artifact_id?<Button type="link" size="small" onClick={()=>{const artifact=detail.artifacts.find(entry=>entry.id===run.result_artifact_id);if(artifact)showArtifact(artifact);}}>查看产物</Button>:null}
              {run.status==="waiting_for_human" && (run.requested_by===actor || item.requestor_id===actor || actorPerson?.is_admin===1)?<Button type="link" size="small" onClick={()=>openAgentResumeDialog(run)}>补充信息</Button>:null}
            </List.Item>} />
            <Button type="link" size="small" onClick={async()=>{const capsule=await api.contextCapsule(item.id);await navigator.clipboard.writeText(JSON.stringify(capsule,null,2));message.success("Context Capsule 已复制");}}>复制本事项 Context Capsule</Button>
          </Card>

          <Card size="small" title="活动与流程记录">
            <Timeline items={detail.activity.map((entry:Activity)=>({children:<><Text strong>{entry.actor_name}</Text><div>{entry.summary}</div><Text type="secondary" className="small">{dateText(entry.created_at)}</Text></>}))} />
          </Card>
        </div>
      </details>
    </div>;
  }

  return <Layout className="app-shell">
    <Sider width={238} theme="light" className="app-sider" breakpoint="sm" collapsedWidth={72}>
      <div className="brand"><div className="brand-mark">A</div><div><Text strong>Architecture</Text><div><Text type="secondary" className="small">Workbench</Text></div></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <Menu mode="inline" selectedKeys={[page]} items={menuItems} onClick={e=>navigatePage(e.key)} />
      <div className="sider-footer"><div className="sider-version">Prototype · 0.1.0</div></div>
    </Sider>
    <Layout>
      <Header className="app-header"><div><Text type="secondary">Workbench / </Text><Text strong>{menuItems.find(m=>m.key===page)?.label || (page==="people"?"人员目录":"业务事项")}</Text></div><Space><Button type="text" onClick={()=>navigatePage("people")}>人员目录</Button><Text type="secondary" className="small">演示身份</Text><Select value={actor} onChange={setActorState} style={{width:220}} options={(bootstrap?.people || []).map((p:Person)=>({value:p.id,label:p.display_name+" · "+p.title}))} /><Avatar style={{background:actorPerson?.avatar_color}}>{actorPerson?.display_name.slice(0,1)}</Avatar></Space></Header>
      <Content className="app-content">
        {page==="overview" && renderDashboard()}
        {page==="work-items" && (new URLSearchParams(window.location.search).has("item") ? (detail ? renderDetailContent() : <Card loading />) : renderWorkItems())}
        {page==="my-work" && renderMyWork()}
        {page==="reviews" && renderReviews()}
        {page==="debts" && renderDebts()}
        {page==="analytics" && renderAnalytics()}
        {page==="people" && renderPeople()}
      </Content>
    </Layout>
    <Modal title="新建业务事项" open={newItemOpen} onCancel={()=>setNewItemOpen(false)} onOk={()=>void submitForm(newItemForm,async()=>{const v=newItemForm.getFieldsValue();if(v.targetDate)v.targetDate=v.targetDate.format("YYYY-MM-DD");return api.createWorkItem(v);},"业务事项已创建",()=>setNewItemOpen(false))} confirmLoading={busy}>
      <Form form={newItemForm} layout="vertical" initialValues={{type:"architecture_review",priority:"normal"}}>
        <Form.Item name="title" label="事项名称" rules={[{required:true}]}><Input placeholder="例如：客户身份平台架构评估" /></Form.Item>
        <Form.Item name="type" label="事项类型"><Select options={[{value:"architecture_review",label:"架构评审"},{value:"solution_assessment",label:"Solution 评估"},{value:"change_assessment",label:"变更评估"},{value:"risk_assessment",label:"风险评估"},{value:"other",label:"其他"}]} /></Form.Item>
        <Form.Item name="description" label="目标与背景"><TextArea rows={4} /></Form.Item>
        <Form.Item name="priority" label="优先级"><Select options={[{value:"low",label:"低"},{value:"normal",label:"普通"},{value:"high",label:"高"}]} /></Form.Item>
        <Form.Item name="targetDate" label="目标日期"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="添加架构产物 / ADR" open={artifactOpen} onCancel={()=>setArtifactOpen(false)} onOk={()=>void submitForm(artifactForm,async()=>api.createArtifact(selected!.id,artifactForm.getFieldsValue()),"产物已提交",()=>setArtifactOpen(false))} confirmLoading={busy} width={720}>
      <Form form={artifactForm} layout="vertical" initialValues={{type:"ADR",status:"proposed"}}>
        <Row gutter={12}><Col span={8}><Form.Item name="type" label="类型"><Select options={[{value:"ADR",label:"ADR"},{value:"Architecture Overview",label:"架构方案"},{value:"Architecture Diagram",label:"架构图"},{value:"Evidence",label:"证据"}]} /></Form.Item></Col><Col span={8}><Form.Item name="code" label="编号"><Input placeholder="ADR-004" /></Form.Item></Col><Col span={8}><Form.Item name="status" label="状态"><Select options={[{value:"draft",label:"草稿"},{value:"proposed",label:"提议"},{value:"submitted",label:"已提交"}]} /></Form.Item></Col></Row>
        <Form.Item name="title" label="标题" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="summary" label="摘要"><TextArea rows={2} /></Form.Item>
        <Form.Item name="content" label="内容 / 决策记录" rules={[{required:true}]}><TextArea rows={9} placeholder="Context、Decision Drivers、Options、Decision、Consequences..." /></Form.Item>
      </Form>
    </Modal>

    <Modal title="提交独立 Review" open={reviewOpen} onCancel={()=>setReviewOpen(false)} onOk={()=>void submitForm(reviewForm,async()=>api.createReview(selected!.id,reviewForm.getFieldsValue()),"Review 已提交",()=>setReviewOpen(false))} confirmLoading={busy}>
      <Form form={reviewForm} layout="vertical">
        <Form.Item name="artifactId" label="评审对象" rules={[{required:true}]}><Select options={(detail?.cycles[0] ? (JSON.parse(detail.cycles[0].baseline_json) as {id:string;version:number}[]).map(entry=>detail.artifacts.find(a=>a.id===entry.id && a.version===entry.version)).filter(Boolean).map(a=>({value:(a as Artifact).id,label:((a as Artifact).code || (a as Artifact).type)+" · "+(a as Artifact).title+" v"+(a as Artifact).version})) : [])} /></Form.Item>
        <Form.Item name="discipline" label="专业领域" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="outcome" label="意见类型"><Select options={[{value:"approve",label:"认可"},{value:"comment",label:"建议 / 评论"},{value:"request_changes",label:"要求修改"},{value:"block",label:"阻断"}]} /></Form.Item>
        <Form.Item name="summary" label="评审意见" rules={[{required:true}]}><TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>

    <Modal title={editingTaskId ? "调整任务分工" : "创建后续 Task"} open={taskOpen} onCancel={()=>{setTaskOpen(false);setEditingTaskId(null);taskForm.resetFields();}} onOk={()=>void submitForm(taskForm,async()=>{
      const v=taskForm.getFieldsValue();
      if(v.dueDate) v.dueDate=v.dueDate.format("YYYY-MM-DD");
      if(editingTaskId) {
        if(v.assigneeId===undefined) v.assigneeId=null;
        if(v.dueDate===undefined) v.dueDate=null;
        return api.updateTask(editingTaskId,v);
      }
      return api.createTask(selected!.id,v);
    },editingTaskId?"任务分工已更新":"Task 已创建",()=>{setTaskOpen(false);setEditingTaskId(null);})} confirmLoading={busy}>
      <Form form={taskForm} layout="vertical">
        <Form.Item name="title" label="工作内容" rules={[{required:true}]}><Input disabled={Boolean(editingTaskId)} /></Form.Item>
        <Form.Item name="kind" label="工作类型"><Select disabled={Boolean(editingTaskId)} options={[{value:"analysis",label:"分析"},{value:"revision",label:"材料修改"},{value:"follow_up",label:"后续整改"},{value:"decision_prep",label:"决策准备"}]} /></Form.Item>
        <Form.Item name="ownerId" label="任务负责人" rules={[{required:true}]}><Select options={(detail?.participants || []).map(p=>({value:p.person_id,label:p.display_name+" · "+p.role_label}))} /></Form.Item>
        <Form.Item name="assigneeId" label="执行分配"><Select allowClear options={(detail?.participants || []).map(p=>({value:p.person_id,label:p.display_name+" · "+p.role_label}))} /></Form.Item>
        <Form.Item name="dueDate" label="截止日期"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="发起多角色协作计划" open={agentPlanOpen} onCancel={()=>setAgentPlanOpen(false)} onOk={()=>void submitForm(agentPlanForm,async()=>{
      const value=agentPlanForm.getFieldsValue();
      if(!String(value.name || "").trim() || !String(value.objective || "").trim() || !Array.isArray(value.agentKeys) || value.agentKeys.length===0) throw new Error("计划名称、共同目标和至少一个角色均为必填项。");
      const nodes=(value.agentKeys as string[]).map(agentKey=>({
        key:agentKey,
        agentKey,
        objective:value.objective
      }));
      return api.requestAgentPlan(selected!.id,{name:value.name,objective:value.objective,taskId:value.taskId,nodes});
    },"多角色协作计划已创建",()=>setAgentPlanOpen(false))} confirmLoading={busy} width={760}>
      <Alert type="info" showIcon message="系统自动增加最终汇总节点" description="所选专家节点默认并行执行；所有专家节点完成后，Decision Analyst 会领取最终汇总节点，比较观点、保留分歧并形成决策简报草案。" className="modal-alert" />
      <Form form={agentPlanForm} layout="vertical">
        <Form.Item name="name" label="计划名称" rules={[{required:true}]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="agentKeys" label="参与角色" rules={[{required:true,message:"至少选择一个角色"}]}><Select mode="multiple" options={agentProfiles.filter(profile=>profile.key!=="decision-analyst").map(profile=>({value:profile.key,label:profile.name+" · "+profile.description}))} /></Form.Item>
        <Form.Item name="taskId" label="关联 Task（可选）"><Select allowClear options={detail?.tasks.filter(task=>!["done","cancelled"].includes(task.status)).map(task=>({value:task.id,label:task.title})) || []} /></Form.Item>
        <Form.Item name="objective" label="共同目标与分析约束" rules={[{required:true}]}><TextArea rows={5} maxLength={4000} showCount /></Form.Item>
      </Form>
    </Modal>

    <Modal title="发起 Agent Run" open={agentRunOpen} onCancel={()=>setAgentRunOpen(false)} onOk={()=>void submitForm(agentForm,async()=>api.requestAgentRun(selected!.id,agentForm.getFieldsValue()),"Agent Run 已进入队列",()=>setAgentRunOpen(false))} confirmLoading={busy} width={680}>
      <Alert type="info" showIcon message="Agent 只提交分析草案" description="本操作不会提交正式 Review 或 Decision。Agent 输出会以 draft Artifact 保存；正式评审、风险接受和决策仍由具备权限的 Human 完成。" className="modal-alert" />
      <Form form={agentForm} layout="vertical">
        <Form.Item name="agentKey" label="Agent 角色" rules={[{required:true}]}><Select options={agentProfiles.map(profile=>({value:profile.key,label:profile.name+" · "+profile.description}))} /></Form.Item>
        <Form.Item name="taskId" label="关联 Task（可选）"><Select allowClear options={detail?.tasks.filter(task=>!["done","cancelled"].includes(task.status)).map(task=>({value:task.id,label:task.title})) || []} /></Form.Item>
        <Form.Item name="objective" label="本次工作目标" rules={[{required:true,message:"请说明本次 Agent 需要完成的工作"}]}><TextArea rows={5} maxLength={4000} showCount placeholder="说明需要分析的问题、预期输出和需要遵守的限制。" /></Form.Item>
      </Form>
    </Modal>

    <Modal title="补充 Human 上下文并恢复 Agent" open={agentResumeOpen} onCancel={()=>{setAgentResumeOpen(false);setAgentResumeRunId(null);}} onOk={()=>void submitForm(agentResumeForm,async()=>api.resumeAgentRun(agentResumeRunId!,String(agentResumeForm.getFieldValue("additionalContext") || "")),"Agent Run 已重新排队",()=>{setAgentResumeOpen(false);setAgentResumeRunId(null);})} confirmLoading={busy}>
      <Alert type="info" showIcon message="恢复只会重新排队 Agent Run" description="不会改变 Request Workflow 状态，也不会代替正式 Review 或 Decision。" className="modal-alert" />
      <Form form={agentResumeForm} layout="vertical"><Form.Item name="additionalContext" label="补充说明 / 对 Agent 问题的回答"><TextArea rows={5} maxLength={8000} showCount placeholder="提供 Agent 需要的业务事实、约束、澄清或下一步要求。" /></Form.Item></Form>
    </Modal>

    <Modal title="记录正式决定" open={decisionOpen} onCancel={()=>setDecisionOpen(false)} onOk={()=>void submitForm(decisionForm,async()=>{
      const value=decisionForm.getFieldsValue();
      if(value.followUpDueDate)value.followUpDueDate=value.followUpDueDate.format("YYYY-MM-DD");
      if(value.technicalDebt?.dueDate)value.technicalDebt.dueDate=value.technicalDebt.dueDate.format("YYYY-MM-DD");
      if(!value.createTechnicalDebt)delete value.technicalDebt;
      delete value.createTechnicalDebt;
      return api.createDecision(selected!.id,value);
    },"正式决定已记录",()=>setDecisionOpen(false))} confirmLoading={busy} width={720}>
      <Alert type="warning" showIcon message="正式决定由当前 Human 身份提交；Agent 分析或草案不能代替 Decision Authority。" className="modal-alert" />
      <Form form={decisionForm} layout="vertical" initialValues={{subjectType:"work_item",outcome:"more_analysis",createTechnicalDebt:false}}>
        <Form.Item name="subjectType" label="决策对象"><Select options={[{value:"work_item",label:"整个业务事项"},{value:"artifact",label:"某个 ADR / Artifact"}]} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("subjectType")==="artifact"?<Form.Item name="subjectId" label="选择 Artifact"><Select options={(detail?.artifacts || []).map(a=>({value:a.id,label:(a.code || a.type)+" · "+a.title}))} /></Form.Item>:null}</Form.Item>
        <Form.Item name="outcome" label="决定" rules={[{required:true}]}><Select options={[{value:"accepted",label:"接受"},{value:"accepted_with_conditions",label:"附条件接受"},{value:"more_analysis",label:"需要更多分析"},{value:"rejected",label:"拒绝"}]} /></Form.Item>
        <Form.Item name="rationale" label="决定依据" rules={[{required:true}]}><TextArea rows={3} /></Form.Item>
        <Form.Item name="conditions" label="条件 / 限制"><TextArea rows={2} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="more_analysis"?<><Form.Item name="followUpTitle" label="后续分析工作"><Input placeholder="明确要补充的分析" /></Form.Item><Form.Item name="followUpOwnerId" label="责任人"><Select allowClear options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))} /></Form.Item><Form.Item name="followUpDueDate" label="截止日期"><DatePicker style={{width:"100%"}} /></Form.Item></>:null}</Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="accepted_with_conditions"?<>
          <Divider titlePlacement="start">后续义务（按需创建）</Divider>
          <Form.Item name="createTechnicalDebt" valuePropName="checked"><Checkbox>需要单独跟踪长期 Technical Debt</Checkbox></Form.Item>
          {getFieldValue("createTechnicalDebt")?<>
          <Form.Item name={["technicalDebt","title"]} label="技术债务标题" rules={[{required:true,message:"请填写技术债务标题"}]}><Input placeholder="例如：移除过渡适配器" /></Form.Item>
          <Form.Item name={["technicalDebt","description"]} label="来源与原因"><TextArea rows={2} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name={["technicalDebt","ownerId"]} label="责任人"><Select options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))} /></Form.Item></Col><Col span={12}><Form.Item name={["technicalDebt","severity"]} label="严重程度"><Select options={[{value:"low",label:"低"},{value:"medium",label:"中"},{value:"high",label:"高"}]} /></Form.Item></Col></Row>
          <Form.Item name={["technicalDebt","targetState"]} label="目标状态"><Input /></Form.Item>
          <Form.Item name={["technicalDebt","remediationPlan"]} label="偿还计划"><TextArea rows={2} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name={["technicalDebt","priority"]} label="优先级"><Select options={[{value:"low",label:"低"},{value:"normal",label:"普通"},{value:"high",label:"高"}]} /></Form.Item></Col><Col span={12}><Form.Item name={["technicalDebt","dueDate"]} label="目标偿还日期"><DatePicker style={{width:"100%"}} /></Form.Item></Col></Row>
          </>:null}
        </>:null}</Form.Item>
      </Form>
    </Modal>

    <Modal title="登记外部上下文引用" open={externalLinkOpen} onCancel={()=>setExternalLinkOpen(false)} onOk={()=>void submitForm(externalLinkForm,async()=>{
      const value=externalLinkForm.getFieldsValue();
      if(value.existingResourceId) {
        return api.addExternalLink(selected!.id,{resourceId:value.existingResourceId,relationType:value.relationType,templateKey:value.templateKey,templateName:value.templateName});
      }
      delete value.existingResourceId;
      return api.addExternalLink(selected!.id,value);
    },"外部上下文引用已登记",()=>setExternalLinkOpen(false))} confirmLoading={busy} width={760}>
      <Alert type="info" showIcon message="这里只保存外部资源引用，不访问外部系统。" description="Workbench 不直接连接或同步 Jira、Confluence、GitHub、LeanIX。已登记的引用可以在多个 Request 之间复用；新资源需要手工登记 ID/Key/URL。网站 Agent 将来再通过自身配置的 MCP/API 工具读取源系统内容。" className="modal-alert" />
      <Form form={externalLinkForm} layout="vertical">
        <Form.Item name="existingResourceId" label="复用 Workbench 已登记的外部资源（可选）">
          <Select allowClear showSearch optionFilterProp="label" placeholder="按系统、Key 或名称搜索当前身份可见的引用" options={externalReferences.map(r=>({value:r.id,label:r.provider.toUpperCase()+" · "+(r.external_key || r.external_id)+" · "+r.title}))} />
        </Form.Item>
        <Text type="secondary" className="small">此列表只查询 Workbench 已保存的引用，不会发起任何 Jira / Confluence / GitHub / LeanIX 搜索。</Text>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>{
          const chosen=externalReferences.find(r=>r.id===getFieldValue("existingResourceId"));
          if (chosen) return <>
            <Alert type="success" showIcon message="已选择已有引用" description={chosen.provider.toUpperCase()+" · "+chosen.resource_type+" · "+(chosen.external_key || chosen.external_id)+" · "+chosen.title} />
            {chosen.provider==="confluence" && chosen.resource_type==="Page"?<>
              <Divider titlePlacement="start">Confluence Page Template Reference</Divider>
              <Form.Item name="templateKey" label="Template Key / ID" rules={[{required:true,message:"请填写该 Page 使用的 Template 标识"}]}><Input placeholder="例如 architecture-decision-record" /></Form.Item>
              <Form.Item name="templateName" label="Template 名称"><Input placeholder="例如 Architecture Decision Record" /></Form.Item>
              <Text type="secondary" className="small">只记录 Template 引用；未来网站 Agent 通过自身配置的 Confluence MCP/API 工具读取模板定义。</Text>
            </>:null}
          </>;
          return <>
            <Divider titlePlacement="start">登记一个新的外部资源引用</Divider>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="provider" label="外部系统" rules={[{required:true}]}><Select options={[{value:"jira",label:"Jira"},{value:"confluence",label:"Confluence"},{value:"github",label:"GitHub"},{value:"leanix",label:"LeanIX"}]} onChange={value=>externalLinkForm.setFieldsValue({resourceType:value==="jira"?"Story":value==="confluence"?"Page":value==="github"?"Repository":"Application",externalId:undefined,externalKey:undefined,title:undefined,url:undefined,templateKey:undefined,templateName:undefined})} /></Form.Item></Col>
              <Col span={12}><Form.Item name="resourceType" label="资源类型" dependencies={["provider"]} rules={[{required:true}]}><Select options={(externalLinkForm.getFieldValue("provider")==="jira"?["Story","Epic","Task","Bug"]:externalLinkForm.getFieldValue("provider")==="confluence"?["Page"]:externalLinkForm.getFieldValue("provider")==="github"?["Repository","PullRequest","Issue","Commit"]:["Application","Interface","ITComponent","DataObject","BusinessCapability","Provider","Project"]).map(value=>({value,label:value}))} /></Form.Item></Col>
            </Row>
            <Row gutter={12}><Col span={12}><Form.Item name="externalId" label="外部资源 ID" rules={[{required:true}]}><Input placeholder="Jira issue ID / Confluence Page ID / LeanIX Fact Sheet ID" /></Form.Item></Col><Col span={12}><Form.Item name="externalKey" label="业务 Key / Identifier"><Input placeholder="DATA-412 / APP-CRM-001 / owner/repository" /></Form.Item></Col></Row>
            <Form.Item name="title" label="资源名称" rules={[{required:true}]}><Input /></Form.Item>
            <Form.Item name="url" label="资源 URL"><Input placeholder="https://..." /></Form.Item>
            {externalLinkForm.getFieldValue("provider")==="confluence" && externalLinkForm.getFieldValue("resourceType")==="Page"?<>
              <Divider titlePlacement="start">Confluence Page Template Reference</Divider>
              <Form.Item name="templateKey" label="Template Key / ID" rules={[{required:true,message:"请填写该 Page 使用的 Template 标识"}]}><Input placeholder="例如 architecture-decision-record" /></Form.Item>
              <Form.Item name="templateName" label="Template 名称"><Input placeholder="例如 Architecture Decision Record" /></Form.Item>
              <Text type="secondary" className="small">只记录 Template 引用；未来网站 Agent 通过自身配置的 Confluence MCP/API 工具读取模板定义。</Text>
            </>:null}
          </>;
        }}</Form.Item>
        <Form.Item name="relationType" label="与 Request 的关系" rules={[{required:true}]}><Select options={[
          {value:"related_to",label:"相关"},
          {value:"implements",label:"实现 / 交付"},
          {value:"decision_record",label:"决策记录"},
          {value:"review_evidence",label:"评审材料"},
          {value:"solution_design",label:"方案设计"},
          {value:"implementation_repository",label:"实现代码库"},
          {value:"shared_component",label:"共享组件"},
          {value:"impacted_application",label:"受影响 Application"},
          {value:"impacted_interface",label:"受影响 Interface"},
          {value:"dependency",label:"依赖"}
        ]} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="编辑 Person Profile" open={profileOpen} onCancel={()=>setProfileOpen(false)} onOk={()=>void submitForm(profileForm,async()=>{
      const value=profileForm.getFieldsValue();
      return api.updateProfile(profilePerson!.id,value);
    },"个人资料已更新",()=>setProfileOpen(false))} confirmLoading={busy} width={680}>
      <Form form={profileForm} layout="vertical">
        <Row gutter={12}>
          <Col span={12}><Form.Item name="displayName" label="姓名" rules={[{required:true}]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="title" label="职位 / 专业角色" rules={[{required:true}]}><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="email" label="Email" rules={[{required:true,type:"email"}]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="department" label="部门"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="location" label="地点"><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="timezone" label="时区"><Input placeholder="Asia/Tokyo" /></Form.Item>
        <Form.Item name="bio" label="个人简介"><TextArea rows={3} /></Form.Item>
        <Form.Item name="expertise" label="专业领域（逗号分隔）"><Input placeholder="Solution Architecture, API Design, Cloud" /></Form.Item>
      </Form>
    </Modal>

    <Modal title={editingParticipationId?"编辑相关人员":"添加相关人员"} open={participantOpen} onCancel={()=>{setParticipantOpen(false);setEditingParticipationId(null);}} onOk={()=>void submitForm(participantForm,async()=>{
      const value=participantForm.getFieldsValue();
      return editingParticipationId
        ? api.updateParticipation(selected!.id,editingParticipationId,{roleKey:value.roleKey,roleLabel:value.roleLabel,permissions:value.permissions})
        : api.setParticipation(selected!.id,value);
    },"相关人员已更新",()=>{setParticipantOpen(false);setEditingParticipationId(null);})} confirmLoading={busy}>
      <Alert type="info" showIcon message="Requestor 和 Workbench Admin 可以维护相关人员；人员变更只影响当前 Request 的 Participation，不会改变其他 Request 的职责。" className="modal-alert" />
      <Form form={participantForm} layout="vertical">
        <Form.Item name="personId" label="参与者" rules={[{required:true}]}><Select disabled={Boolean(editingParticipationId)} showSearch optionFilterProp="label" options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name+" · "+p.title}))} /></Form.Item>
        <Form.Item name="roleKey" label="Role Key" rules={[{required:true}]}><Input placeholder="security_architect" /></Form.Item>
        <Form.Item name="roleLabel" label="职责名称" rules={[{required:true}]}><Input placeholder="Security Architect" /></Form.Item>
        <Form.Item name="permissions" label="事项权限" rules={[{required:true}]}><Select mode="multiple" options={[{value:"read",label:"读取"},{value:"contribute",label:"提交材料 / Task"},{value:"comment",label:"讨论"},{value:"review",label:"专业评审"},{value:"decide",label:"正式决策"},{value:"manage",label:"管理相关人员"}]} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="登记技术债务" open={debtOpen} onCancel={()=>setDebtOpen(false)} onOk={()=>void submitForm(debtForm,async()=>{
      const value=debtForm.getFieldsValue();if(value.dueDate)value.dueDate=value.dueDate.format("YYYY-MM-DD");return api.createDebt(value);
    },"技术债务已登记",()=>setDebtOpen(false))} confirmLoading={busy}>
      <Form form={debtForm} layout="vertical">
        <Form.Item name="originWorkItemId" label="来源事项" rules={[{required:true}]}><Select options={(bootstrap?.workItems || []).map(item=>({value:item.id,label:item.code+" · "+item.title}))} /></Form.Item>
        <Form.Item name="title" label="技术债务" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="rationale" label="产生原因" rules={[{required:true}]}><TextArea rows={2} /></Form.Item>
        <Form.Item name="ownerId" label="责任人"><Select allowClear options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))} /></Form.Item>
        <Row gutter={12}><Col span={12}><Form.Item name="severity" label="严重程度"><Select options={[{value:"low",label:"低"},{value:"medium",label:"中"},{value:"high",label:"高"}]} /></Form.Item></Col><Col span={12}><Form.Item name="priority" label="优先级"><Select options={[{value:"low",label:"低"},{value:"normal",label:"普通"},{value:"high",label:"高"}]} /></Form.Item></Col></Row>
        <Form.Item name="targetState" label="目标状态"><Input /></Form.Item>
        <Form.Item name="remediationPlan" label="偿还计划"><TextArea rows={3} /></Form.Item>
        <Form.Item name="dueDate" label="目标日期"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>
  </Layout>;
}
