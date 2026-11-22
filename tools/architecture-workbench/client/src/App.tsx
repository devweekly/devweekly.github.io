import { useEffect, useMemo, useState } from "react";
import {
  Alert, Avatar, Breadcrumb, Button, Card, Checkbox, Col, DatePicker, Divider, Empty,
  Form, Input, Layout, List, Menu, Modal, Progress, Row, Select, Space,
  Steps, Table, Tabs, Tag, Timeline, Tooltip, Typography, Upload, message
} from "antd";
import type { FormInstance } from "antd";
import {
  AppstoreOutlined, ApartmentOutlined, ArrowLeftOutlined, AuditOutlined,
  CheckCircleOutlined, CloudUploadOutlined, CopyOutlined,
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
  draft:"事项草稿", requestor_revision:"待申请人修改", discussion_review:"讨论与评审中",
  waiting_requestor:"等待申请人答复", decision_meeting:"等待决定会议",
  approved_pending_close:"已批准 · 待关闭", rejected_pending_close:"已拒绝 · 待关闭",
  closed:"已关闭", open:"待处理", in_progress:"处理中", deferred:"已延期", resolved:"已解决",
  cancelled:"已取消", approved:"批准", needs_work:"需要修改", rejected:"拒绝",
  queued:"待领取", running:"执行中", waiting_for_human:"等待人工输入", completed:"已完成",
  failed:"执行失败", blocked:"受阻"
};
const statusColors: Record<string,string> = {
  draft:"default", requestor_revision:"warning", discussion_review:"processing",
  waiting_requestor:"warning", decision_meeting:"processing", approved_pending_close:"success",
  rejected_pending_close:"error", closed:"default", open:"warning", in_progress:"processing",
  deferred:"purple", resolved:"success", cancelled:"default", approved:"success",
  needs_work:"warning", rejected:"error", queued:"default", running:"processing",
  waiting_for_human:"warning", completed:"success", failed:"error", blocked:"error"
};
const roleColors: Record<string,string> = {
  solution_architect:"blue", enterprise_architect:"purple", security_architect:"red",
  solution_sme:"cyan", development_manager:"gold", decision_authority:"green", chairman:"green"
};
const participationRoleOptions = [
  {value:"chairman",label:"会议主席"},
  {value:"solution_architect",label:"解决方案架构师"},
  {value:"enterprise_architect",label:"企业架构师"},
  {value:"data_architect",label:"数据架构师"},
  {value:"security_architect",label:"安全架构师"},
  {value:"solution_sme",label:"业务专家"},
  {value:"development_manager",label:"开发经理"},
  {value:"architecture_reviewer",label:"架构评审员"},
  {value:"reviewer",label:"评审人"},
  {value:"contributor",label:"参与者"},
  {value:"other",label:"其他"}
];
const dateText = (value?: string | null) => value ? dayjs(value).format("YYYY-MM-DD") : "—";

const workItemTypeLabels: Record<string,string> = {
  architecture_review:"架构评审", solution_assessment:"方案评估", change_assessment:"变更评估",
  risk_assessment:"风险评估", technical_debt:"技术债务", other:"其他"
};
const taskKindLabels: Record<string,string> = {
  analysis:"分析", revision:"材料修改", follow_up:"后续整改", decision_prep:"决策准备"
};
const relationTypeLabels: Record<string,string> = {
  related_to:"相关", implements:"实现 / 交付", decision_record:"决策记录", review_evidence:"评审依据",
  solution_design:"方案设计", implementation_repository:"代码仓库", shared_component:"共享组件",
  impacted_application:"涉及的应用", impacted_interface:"涉及的接口", dependency:"依赖",
  generated_technical_debt:"产生的技术债务"
};

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
  const [clarificationOpen,setClarificationOpen] = useState(false);
  const [packageOpen,setPackageOpen] = useState(false);
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
   const [agentPlanOpen,setAgentPlanOpen] = useState(false);
  const [agentResumeOpen,setAgentResumeOpen] = useState(false);
  const [agentResumeRunId,setAgentResumeRunId] = useState<string|null>(null);
  const [editingParticipationId,setEditingParticipationId] = useState<string|null>(null);
  const [profilePersonId,setProfilePersonId] = useState<string|null>(null);
  const [profileOpen,setProfileOpen] = useState(false);
  const [newItemForm] = Form.useForm();
  const [artifactForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [clarificationForm] = Form.useForm();
  const [packageForm] = Form.useForm();
  const [taskForm] = Form.useForm();
  const [decisionForm] = Form.useForm();
  const [debtForm] = Form.useForm();
  const [participantForm] = Form.useForm();
  const [profileForm] = Form.useForm();
  const [externalLinkForm] = Form.useForm();
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
  async function openRelatedDebt(workItemId:string) {
    setPage("work-items"); setSelected(null); setDetail(null);
    writeRoute("work-items",workItemId);
    try { setDetail(await api.detail(workItemId)); }
    catch (error) { message.error(error instanceof Error ? error.message : "无法打开关联技术债务"); }
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
  const selectedParticipant=detail?.participants.find(participant=>participant.id===editingParticipationId);
  const participantRoleChoices=selectedParticipant && !participationRoleOptions.some(option=>option.value===selectedParticipant.role_key)
    ? [...participationRoleOptions,{value:selectedParticipant.role_key,label:selectedParticipant.role_label}]
    : participationRoleOptions;
  const profilePerson=bootstrap?.people.find(person=>person.id===(profilePersonId || actor)) || actorPerson;
  const filteredItems=useMemo(()=>(bootstrap?.workItems || []).filter(item=>
    [item.code,item.title,item.description,item.owner_name].join(" ").toLowerCase().includes(query.toLowerCase())
  ),[bootstrap,query]);
  const menuItems=[
    {key:"my-work",icon:<UnorderedListOutlined />,label:"我的工作"},
    {key:"work-items",icon:<ProjectOutlined />,label:"全部事项"},
    {key:"analytics",icon:<BarChartOutlined />,label:"全局分析"},
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
    {title:"事项",dataIndex:"title",key:"title",render:(_:string,item:WorkItem)=><Space direction="vertical" size={2}><Button type="link" className="table-link" onClick={()=>void openWorkItem(item)}>{item.title}</Button><Text type="secondary" className="small">{item.code} · {workItemTypeLabels[item.type] || item.type}</Text></Space>},
    {title:"负责人",dataIndex:"owner_name",key:"owner_name"},
    {title:"状态",dataIndex:"status",key:"status",render:(v:string)=><Tag color={statusColors[v]}>{statusLabels[v] || v}</Tag>},
    {title:"优先级",dataIndex:"priority",key:"priority",render:(v:string)=><Tag color={v==="high"?"red":v==="normal"?"blue":"default"}>{v==="high"?"高":v==="normal"?"普通":"低"}</Tag>},
    {title:"材料",dataIndex:"artifact_count",key:"artifact_count",width:70},
    {title:"未完成任务",dataIndex:"open_task_count",key:"open_task_count",width:90},
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
      message.success("任务状态已更新");
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

   function openAgentPlanDialog() {
    agentPlanForm.resetFields();
    agentPlanForm.setFieldsValue({
      name:"架构分析",
      agentKeys:["business-analyst","solution-architect","data-architect","security-reviewer"],
      objective:"围绕当前事项检查业务目标、技术方案、数据设计和安全要求。各角色列出发现的问题、判断依据和建议；最后整理不同意见，以及需要负责人决定的问题。"
    });
    setAgentPlanOpen(true);
  }
  function openAgentResumeDialog(run:AgentRun) {
    setAgentResumeRunId(run.id);
    agentResumeForm.resetFields();
    agentResumeForm.setFieldsValue({additionalContext:""});
    setAgentResumeOpen(true);
  }

  async function transitionWorkflow(action:string,extra:Record<string,unknown>={}) {
    if (!selected) return;
    try {
      await api.transitionWorkItem(selected.id,action,extra);
      message.success("事项流程已更新");
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
    const labels:Record<string,string>={
       draft:"事项草稿",requestor_revision:"待申请人修改",discussion_review:"讨论与评审",waiting_requestor:"等待申请人答复",decision_meeting:"决定会议",approved_pending_close:"批准待关闭",rejected_pending_close:"拒绝待关闭",closed:"已关闭",
       analysis:"分析",in_review:"历史评审状态",changes_requested:"历史待修改",accepted:"历史已接受",rejected:"历史已拒绝",approve:"历史认可意见",request_changes:"历史修改意见",block:"历史阻断意见",
       high:"高",normal:"普通",low:"低",architecture_review:"架构评审",change_assessment:"变更评估",solution_assessment:"方案评估",risk_assessment:"风险评估",technical_debt:"技术债务",
       jira:"Jira",confluence:"Confluence",github:"GitHub",leanix:"LeanIX",open:"待处理",in_progress:"处理中",deferred:"已延期",resolved:"已解决",cancelled:"已取消",medium:"中"
     };
    const total=rows.reduce((sum,row)=>sum+row.count,0);
    return <Card title={title} className="panel-card">
      {rows.length===0?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />:<>
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
    const visibleItems=bootstrap?.workItems || [];
    const isOverdue=(item:WorkItem)=>Boolean(item.target_date && dayjs(item.target_date).isBefore(dayjs(),"day") && item.status!=="closed");
    const attentionItems=visibleItems.filter(item=>isOverdue(item) || ["discussion_review","waiting_requestor","decision_meeting","approved_pending_close","rejected_pending_close"].includes(item.status))
      .sort((a,b)=>Number(isOverdue(b))-Number(isOverdue(a)) || String(a.target_date || "9999-12-31").localeCompare(String(b.target_date || "9999-12-31")));
    const attentionLabel=(item:WorkItem)=>{
      if(isOverdue(item)) return "已超过目标日期";
      if(item.status==="discussion_review") return "评审进行中";
      if(item.status==="waiting_requestor") return "等待申请人答复";
      if(item.status==="decision_meeting") return "等待决定会议";
      if(["approved_pending_close","rejected_pending_close"].includes(item.status)) return "等待关闭事项";
      return "需要跟进";
    };
    const debtItems=bootstrap?.debts || [];
    return <div className="page-stack">
      <div className="page-heading"><div><Title level={2}>全局分析</Title><Paragraph type="secondary">查看事项进度、评审安排、外部资源关联情况和技术债务处理情况。</Paragraph></div><Text type="secondary" className="small">更新于 {dateText(analyticsData.generatedAt)}</Text></div>
      <Tabs activeKey={analyticsTab} onChange={key=>{setAnalyticsTab(key);writeRoute("analytics",null,key);}} items={[
        {key:"requests",label:"事项分析",children:<div className="page-stack">
          <Card title={"需要处理的事项 · "+attentionItems.length} className="panel-card" extra={<Button type="link" onClick={()=>navigatePage("work-items")}>全部事项</Button>}>
            <Paragraph type="secondary">列出你有权查看且已逾期或正等待处理的事项。打开事项可查看负责人、任务和相关材料。</Paragraph>
            <Table size="small" rowKey="id" dataSource={attentionItems} pagination={{pageSize:6,hideOnSinglePage:true}} locale={{emptyText:"当前没有需要跟进的事项"}} columns={[
              {title:"事项",dataIndex:"title",render:(value:string,item:WorkItem)=><Button type="link" className="table-link" onClick={()=>void openWorkItem(item)}>{item.code} · {value}</Button>},
              {title:"阶段",dataIndex:"status",render:(value:string)=><Tag color={statusColors[value]}>{statusLabels[value] || value}</Tag>},
              {title:"负责人",dataIndex:"owner_name"},
              {title:"目标日期",dataIndex:"target_date",render:dateText},
              {title:"当前关注",render:(_:unknown,item:WorkItem)=>attentionLabel(item)}
            ]} />
          </Card>
          <Row gutter={[16,16]}>
            <Col xs={24} lg={12}>{breakdownCard("事项创建时长",r.aging)}</Col>
            <Col xs={24} lg={12}>
              <Card title="外部资源关联情况" className="panel-card">
                <Table size="small" rowKey="key" pagination={false} dataSource={r.externalSystems} columns={[
                  {title:"系统",dataIndex:"key",render:(v:string)=><Tag color={v==="jira"?"blue":v==="confluence"?"cyan":v==="github"?"default":"purple"}>{v.toUpperCase()}</Tag>},
                  {title:"关联资源",dataIndex:"count"},
                  {title:"关联事项数",dataIndex:"requestCount"}
                ]} />
              </Card>
            </Col>
          </Row>
        </div>},
        {key:"debt",label:"技术债务分析",children:<div className="page-stack">
          <Row gutter={[16,16]}>
            <Col xs={24} lg={8}>{breakdownCard("按状态",d.byStatus)}</Col>
            <Col xs={24} lg={8}>{breakdownCard("按严重程度",d.bySeverity)}</Col>
            <Col xs={24} lg={8}>{breakdownCard("按优先级",d.byPriority)}</Col>
          </Row>
          <Card title={"尚未解决的技术债务 · "+debtItems.filter(item=>["open","in_progress"].includes(item.debt_status)).length} className="panel-card" extra={<Button type="link" onClick={()=>navigatePage("debts")}>打开技术债务台账</Button>}>
            <Paragraph type="secondary">这里列出尚未解决的技术债务。打开记录可查看负责人、处理计划和目标日期。</Paragraph>
            <Table size="small" rowKey="id" dataSource={debtItems.filter(item=>["open","in_progress"].includes(item.debt_status)).slice(0,8)} pagination={false} locale={{emptyText:"当前没有待处理的技术债务"}} columns={[
              {title:"技术债务",dataIndex:"title",render:(value:string,row:DebtItem)=><div><Text strong>{row.code}</Text><div>{value}</div></div>},
              {title:"严重程度",dataIndex:"severity",render:(value:string)=><Tag color={value==="critical"?"red":value==="high"?"orange":"default"}>{value}</Tag>},
              {title:"状态",dataIndex:"debt_status",render:(value:string)=><Tag>{statusLabels[value] || value}</Tag>},
              {title:"负责人",dataIndex:"owner_name"},
              {title:"目标日期",dataIndex:"target_date",render:dateText}
            ]} />
          </Card>
          <Row gutter={[16,16]}>
            <Col xs={24} lg={12}>{breakdownCard("技术债务登记时长",d.aging)}</Col>
            <Col xs={24} lg={12}><Card title="来源事项" className="panel-card">
              <Table size="small" rowKey="code" pagination={false} dataSource={d.byOriginRequest} columns={[
                {title:"来源事项",dataIndex:"code",render:(v:string,row:{code:string;title:string})=><div><Text strong>{v}</Text><div className="small muted">{row.title}</div></div>},
                {title:"技术债务数",dataIndex:"debt_count"}
              ]} locale={{emptyText:"尚无来源关联"}} />
            </Card></Col>
          </Row>
          <Alert type="info" showIcon message="统计范围" description="只有需要长期跟踪的技术债务才单独登记并计入台账。普通修订、分析和短期整改仍记在原事项的任务中，不会重复统计。" />
        </div>}
      ]} />
    </div>;
  }
  function renderDashboard() {
    if (!bootstrap) return <Card loading />;
    return <div className="page-stack">
      <div className="page-heading"><div><Title level={2}>工作概览</Title><Paragraph type="secondary">最近更新的事项和技术债务。</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>setNewItemOpen(true)}>新建事项</Button></div>
       <Card title="最近事项" extra={<Button type="link" onClick={()=>navigatePage("work-items")}>查看全部</Button>} className="panel-card">
        <Table rowKey="id" columns={itemColumns} dataSource={bootstrap.workItems.slice(0,8)} pagination={false} loading={loading} />
      </Card>
      <Card title="技术债务跟踪" extra={<Button type="link" onClick={()=>setPage("debts")}>打开台账</Button>} className="panel-card">
        <Table rowKey="id" columns={debtColumns} dataSource={bootstrap.debts.slice(0,3)} pagination={false} />
      </Card>
    </div>;
  }

  function renderWorkItems() {
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">事项管理</Text><Title level={2}>业务事项</Title><Paragraph type="secondary">按负责人、状态和目标日期查看事项。</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>setNewItemOpen(true)}>新建事项</Button></div>
      <Card className="panel-card"><div className="table-toolbar"><Input.Search allowClear placeholder="搜索事项、编号或负责人" onSearch={setQuery} onChange={e=>setQuery(e.target.value)} style={{maxWidth:360}} /><Text type="secondary">{filteredItems.length} 个事项</Text></div><Table rowKey="id" columns={itemColumns} dataSource={filteredItems} loading={loading} pagination={{pageSize:8}} /></Card>
    </div>;
  }
  function renderDebts() {
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">技术债务跟踪</Text><Title level={2}>技术债务</Title><Paragraph type="secondary">每项技术债务单独记录负责人、优先级、处理计划和目标日期，并关联产生它的事项和相关决定。</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>{debtForm.setFieldsValue({originWorkItemId:bootstrap?.workItems[0]?.id,priority:"normal",severity:"medium"});setDebtOpen(true);}}>记录技术债务</Button></div>
      <Card className="panel-card"><Table rowKey="id" columns={debtColumns} dataSource={bootstrap?.debts || []} loading={loading} pagination={{pageSize:8}} /></Card>
      <Alert type="info" showIcon message="什么时候需要单独登记" description="能在原事项内完成的修复，直接记为任务。需要长期跟踪、单独安排负责人和优先级的，再登记为技术债务。" />
    </div>;
  }
  function renderMyWork() {
    const mine=(bootstrap?.workItems || []).filter(item=>item.owner_id===actor || item.requestor_id===actor);
    const taskColumns=[
      {title:"任务",dataIndex:"title",render:(value:string)=><Text strong>{value}</Text>},
      {title:"所属事项",dataIndex:"work_item_title",render:(value:string,task:MyTask)=><Button type="link" className="table-link" onClick={()=>{const item=bootstrap?.workItems.find(entry=>entry.id===task.work_item_id);if(item)void openWorkItem(item);}}>{task.work_item_code} · {value}</Button>},
      {title:"负责人",dataIndex:"owner_name",render:(value:string|null)=>value || "—"},
      {title:"执行人",dataIndex:"assignee_name",render:(value:string|null)=>value || "尚未分配"},
       {title:"状态",dataIndex:"status",render:(value:string,task:MyTask)=><Select size="small" value={value} style={{width:120}} onChange={status=>void updateTask(task.id,status)} options={[{value:"open",label:"待处理"},{value:"in_progress",label:"处理中"},{value:"blocked",label:"受阻"},{value:"done",label:"完成"},{value:"cancelled",label:"取消"}]} />},
      {title:"截止日期",dataIndex:"due_date",render:dateText},
     ];
    return <div className="page-stack">
      <div className="page-heading"><div><Title level={2}>我的任务</Title><Paragraph type="secondary">查看分配给你的任务，以及你发起或负责的事项。</Paragraph></div></div>
      <Card title="任务列表" className="panel-card"><Table rowKey="id" columns={taskColumns} dataSource={myTasks} loading={loading} pagination={{pageSize:8}} locale={{emptyText:<Empty description="当前没有分配给你的任务" />}} /></Card>
      <Card title="我发起或负责的事项" className="panel-card"><Table rowKey="id" columns={itemColumns} dataSource={mine} pagination={{pageSize:6}} /></Card>
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
      {title:"角色",dataIndex:"is_admin",render:(value:number)=>value?<Tag color="purple">管理员</Tag>:<Tag>参与者</Tag>}
    ];
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">人员资料</Text><Title level={2}>人员目录</Title><Paragraph type="secondary">统一查看参与者的职责、专业领域和联系方式。个人可以维护自己的资料，管理员可以维护目录中的其他人员。</Paragraph></div></div>
      <Row gutter={[16,16]}>
        <Col xs={24} xl={13}>
          <Card title="人员目录" className="panel-card">
            <Table rowKey="id" size="middle" dataSource={bootstrap.people} columns={columns} pagination={{pageSize:8}}
              onRow={person=>({onClick:()=>setProfilePersonId(person.id),style:{cursor:"pointer",background:person.id===selectedPerson?.id?"#f4f7fb":undefined}})} />
          </Card>
        </Col>
        <Col xs={24} xl={11}>
          {selectedPerson ? <Card className="panel-card" title="个人资料" extra={canEdit?<Button icon={<EditOutlined />} onClick={()=>openProfileEditor(selectedPerson)}>编辑资料</Button>:null}>
            <Space align="start" size={14}>
              <Avatar size={58} style={{background:selectedPerson.avatar_color,fontSize:24}}>{selectedPerson.display_name.slice(0,1)}</Avatar>
              <div><Title level={4} style={{margin:"2px 0 4px"}}>{selectedPerson.display_name}</Title><Text type="secondary">{selectedPerson.title}</Text><div>{selectedPerson.is_admin?<Tag color="purple">管理员</Tag>:null}</div></div>
            </Space>
            <Divider />
            <Row gutter={[12,16]}>
              <Col span={12}><Text type="secondary" className="small">部门</Text><div><Text strong>{selectedPerson.department || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">地点</Text><div><Text strong>{selectedPerson.location || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">邮箱</Text><div><Text strong>{selectedPerson.email || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">时区</Text><div><Text strong>{selectedPerson.timezone || "—"}</Text></div></Col>
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
    const reviewItems=(bootstrap?.workItems || []).filter(item=>["discussion_review","waiting_requestor"].includes(item.status));
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">待评审</Text><Title level={2}>架构与 ADR 评审</Title><Paragraph type="secondary">评审意见对应具体材料版本；相关专业人员可以分别提交意见。</Paragraph></div></div>
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
    const phaseAction:Record<string,string>={
      draft:"完善申请材料并提交评审。",
      requestor_revision:"修改材料后重新提交。",
      discussion_review:"等待评审意见或评审截止。",
      waiting_requestor:"等待申请人答复。",
      decision_meeting:"会议主席记录决定。",
      approved_pending_close:"会议主席或管理员关闭事项。",
      rejected_pending_close:"会议主席或管理员关闭事项。",
      closed:"事项已关闭。"
    };
    const nextAction=detail.workflow.activeClarification
      ? "申请人答复（截止 "+dateText(detail.workflow.activeClarification.response_due_at)+"）。"
      : (phaseAction[item.status] || "根据当前进展继续处理。");
    const requestPackage=(()=>{try{return JSON.parse(item.request_package_json || "{}") as Record<string,unknown>;}catch{return {};}})();
    const canSubmitRequest=item.requestor_id===actor;
    const packageReady=Boolean(String(requestPackage.goal || "").trim() && String(requestPackage.scope || "").trim() && String(requestPackage.decisionQuestions || "").trim() && String(requestPackage.submissionMessage || "").trim());
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
          {permissions.includes("contribute") && <Button icon={<PlusOutlined />} onClick={()=>setArtifactOpen(true)}>添加架构材料</Button>}
          {canSubmitRequest && ["draft","requestor_revision"].includes(item.status) && <Button onClick={()=>{packageForm.setFieldsValue({...requestPackage});setPackageOpen(true);}}>{packageReady?"编辑申请材料":"完善申请材料"}</Button>}
          {canSubmitRequest && detail.workflow.availableActions.includes("submit_request") && packageReady && <Button type="primary" onClick={()=>void transitionWorkflow("submit_request",{submissionMessage:String(requestPackage.submissionMessage),package:requestPackage,assistedByRunId:requestPackage.assistedByRunId ? String(requestPackage.assistedByRunId) : undefined})}>提交评审</Button>}
          {detail.workflow.availableActions.includes("record_decision") && <Button type="primary" onClick={()=>{decisionForm.resetFields();decisionForm.setFieldsValue({outcome:"approved"});setDecisionOpen(true);}}>记录决定会议结论</Button>}
        </Space>
      </div>

      <Card className="workspace-summary" size="small">
        <Row gutter={[20,12]}>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">当前阶段</Text><div><Text strong>{statusLabels[item.status] || item.status}</Text></div></Col>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">事项负责人</Text><div><Text strong>{item.owner_name}</Text></div></Col>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">{detail.workflow.reviewDeadlineAt ? "评审截止" : "会议主席"}</Text><div><Text strong>{detail.workflow.reviewDeadlineAt ? dayjs(detail.workflow.reviewDeadlineAt).format("YYYY-MM-DD HH:mm") : (detail.participants.find(p=>p.person_id===detail.workflow.chairmanId)?.display_name || "待指定")}</Text></div></Col>
          <Col xs={24} md={9}><Text type="secondary" className="workflow-label">下一步</Text><div><Text strong>{nextAction}</Text></div></Col>
        </Row>
      </Card>
      <Card size="small" title="申请内容" className="workspace-section">
        <Row gutter={[20,12]}>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">业务目标</Text><Paragraph>{String(requestPackage.goal || item.description || "尚未填写")}</Paragraph></Col>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">范围</Text><Paragraph>{String(requestPackage.scope || "尚未填写")}</Paragraph></Col>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">约束与风险</Text><Paragraph>{String(requestPackage.constraints || "尚未填写")}</Paragraph></Col>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">初步方案</Text><Paragraph>{String(requestPackage.initialProposal || "未提供")}</Paragraph></Col>
          <Col xs={24}><Text type="secondary" className="workflow-label">需要决定的问题</Text><Paragraph>{String(requestPackage.decisionQuestions || "尚未填写")}</Paragraph></Col>
        </Row>
        {requestPackage.submissionMessage ? <Text type="secondary" className="small">提交说明：{String(requestPackage.submissionMessage)}</Text> : null}
      </Card>

      <Card className="workflow-card" size="small" title="事项进展">
        <Steps current={detail.workflow.currentStep} status={detail.workflow.visualStatus} items={detail.workflow.steps} />
        <Space wrap className="workflow-actions">
          {detail.workflow.availableActions.includes("close") && <Button type="primary" onClick={()=>void transitionWorkflow("close")}>关闭事项</Button>}
        </Space>
        {detail.workflow.activeClarification && <Alert type="warning" showIcon message="等待申请人答复" description={<>{detail.workflow.activeClarification.question}<div className="small muted">答复截止：{dayjs(detail.workflow.activeClarification.response_due_at).format("YYYY-MM-DD HH:mm")}</div></>} action={canSubmitRequest?<Button size="small" onClick={()=>{clarificationForm.resetFields();setClarificationOpen(true);}}>回答澄清</Button>:null} />}
        {detail.workflow.status==="decision_meeting" && <Alert type="info" showIcon message="已进入决定会议" description={"指定会议主席："+(detail.participants.find(p=>p.person_id===detail.workflow.chairmanId)?.display_name || "尚未指定")+"。评审到期或阻断性异议不会自动导致批准或拒绝。"}/>}
        {detail.workflow.status==="approved_pending_close" || detail.workflow.status==="rejected_pending_close" ? <Alert type="warning" showIcon message="决定已记录，等待人工关闭" description="只有指定会议主席或管理员可以关闭事项。"/> : null}
        {detail.workflow.history.length>0 && <details className="workspace-disclosure">
          <summary>查看流程变化记录（{detail.workflow.history.length}）</summary>
          <Timeline items={detail.workflow.history.map(entry=>({children:<><Text strong>{entry.actor_name}</Text><div>{statusLabels[entry.from_status] || entry.from_status} → {statusLabels[entry.to_status] || entry.to_status}</div><Text type="secondary" className="small">{dateText(entry.created_at)} · {entry.reason || entry.action}</Text></>}))} />
        </details>}
      </Card>

      <Card size="small" title="任务" className="workspace-section" extra={permissions.includes("contribute")?<Button size="small" icon={<PlusOutlined />} onClick={()=>{setEditingTaskId(null);taskForm.resetFields();taskForm.setFieldsValue({ownerId:item.owner_id,assigneeId:detail.participants.some(person=>person.person_id===actor)?actor:undefined});setTaskOpen(true);}}>添加任务</Button>:null}>
        {detail.tasks.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有安排的任务" /> : (() => {
          const groups=[
            {key:"in_progress",label:"正在推进"},
            {key:"open",label:"待开始"},
            {key:"blocked",label:"需要协调"},
            {key:"done",label:"已完成"}
          ];
          return <div className="work-progress-groups">{groups.map(group=>{
            const rows=detail.tasks.filter(task=>task.status===group.key);
            if(!rows.length) return null;
            return <section className="work-progress-group" key={group.key}>
              <div className="work-progress-heading"><Text strong>{group.label}</Text><Text type="secondary" className="small">{rows.length}</Text></div>
              <List size="small" dataSource={rows} renderItem={task=><List.Item
                actions={[
                  <Select key="status" size="small" value={task.status} disabled={!permissions.includes("contribute") && task.assignee_id!==actor && task.owner_id!==actor} style={{width:112}} onChange={status=>void updateTask(task.id,status)} options={[{value:"open",label:"待开始"},{value:"in_progress",label:"进行中"},{value:"blocked",label:"需要协调"},{value:"done",label:"已完成"},{value:"cancelled",label:"取消"}]} />,
                  permissions.includes("contribute")?<Button key="edit" size="small" type="link" icon={<EditOutlined />} onClick={()=>editTaskAssignment(task)}>调整</Button>:null
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={<Space wrap><Text strong>{task.title}</Text><Tag>{taskKindLabels[task.kind] || task.kind}</Tag></Space>}
                  description={<Space wrap size={[12,4]}><Text type="secondary" className="small">负责：{task.owner_name || item.owner_name}</Text><Text type="secondary" className="small">执行：{taskExecutor(task)}</Text>{task.due_date?<Text type="secondary" className="small">目标：{dateText(task.due_date)}</Text>:null}</Space>}
                />
              </List.Item>} />
            </section>;
          })}</div>;
        })()}
      </Card>

      <Card size="small" title={"关联资源 · "+detail.externalLinks.length} className="workspace-section" extra={permissions.includes("contribute")?<Button size="small" icon={<LinkOutlined />} onClick={()=>void openExternalLinkDialog()}>添加外部资源</Button>:null}>
        <Paragraph type="secondary" className="small">材料仍保留在 Jira、Confluence、GitHub 和 LeanIX；这里仅保存链接。</Paragraph>
        {detail.externalLinks.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未关联外部资源" /> :
          <List size="small" dataSource={detail.externalLinks} renderItem={link=><List.Item actions={[link.url?<a key="open" href={link.url} target="_blank" rel="noreferrer">打开</a>:null,permissions.includes("contribute")?<Button key="remove" type="link" danger size="small" onClick={()=>void removeExternalLink(link.id)}>移除</Button>:null].filter(Boolean)}>
            <List.Item.Meta
              title={<Space wrap><Tag color={link.provider==="jira"?"blue":link.provider==="confluence"?"purple":link.provider==="github"?"default":"cyan"}>{link.provider.toUpperCase()}</Tag><Text strong>{link.external_key || link.title}</Text></Space>}
              description={<>{link.title}{link.relation_type && link.relation_type!=="related_to"?" · "+(relationTypeLabels[link.relation_type] || link.relation_type):""}</>}
            />
          </List.Item>} />
        }
      </Card>

      <Card size="small" title={"关联技术债务 · "+detail.relatedDebts.length} className="workspace-section">
        {detail.relatedDebts.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联技术债务" /> : <List size="small" dataSource={detail.relatedDebts} renderItem={debt=><List.Item actions={[<Button key="open" type="link" onClick={()=>void openRelatedDebt(debt.id)}>查看</Button>]}>
          <List.Item.Meta
            title={<Space wrap><Text strong>{debt.code} · {debt.title}</Text><Tag color={debt.severity==="high"?"error":debt.severity==="medium"?"warning":"default"}>{debt.severity==="high"?"高严重度":debt.severity==="medium"?"中严重度":"低严重度"}</Tag><Tag color={debt.debt_status==="resolved"?"success":debt.debt_status==="in_progress"?"processing":"default"}>{debt.debt_status==="resolved"?"已解决":debt.debt_status==="in_progress"?"处理中":debt.debt_status==="deferred"?"已延期":"待处理"}</Tag></Space>}
            description={<Space wrap><Text type="secondary" className="small">负责人：{debt.owner_name}</Text>{debt.target_date?<Text type="secondary" className="small">目标：{dateText(debt.target_date)}</Text>:null}<Text type="secondary" className="small">优先级：{debt.priority}</Text></Space>}
          />
        </List.Item>} />}
      </Card>
      
      <Card size="small" title="讨论" className="workspace-section">
        <Space.Compact block><Input value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="补充事实、提出问题或回应讨论..." onPressEnter={()=>void submitComment()} /><Button type="primary" onClick={()=>void submitComment()}>发送</Button></Space.Compact>
        <List className="comment-list" dataSource={detail.comments} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无讨论" />}} renderItem={(comment:Comment)=><List.Item>
          <List.Item.Meta avatar={<Avatar style={{background:comment.avatar_color}}>{comment.author_name.slice(0,1)}</Avatar>} title={<Space><Text strong>{comment.author_name}</Text><Text type="secondary" className="small">{dateText(comment.created_at)}</Text></Space>} description={comment.body} />
        </List.Item>} />
      </Card>

      <details className="advanced-information">
        <summary>更多信息 <Text type="secondary">参与者、评审意见、决定记录、附件和分析记录</Text></summary>
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
            <Text type="secondary" className="small">{currentCycle ? currentCycle.name+" · 本轮评审材料版本" : "尚未启动评审"}</Text>
            {permissions.includes("review") && currentCycle?.status==="active" && item.status==="discussion_review" ? <Button size="small" icon={<PlusOutlined />} onClick={()=>{reviewForm.resetFields();reviewForm.setFieldsValue({artifactId:reviewableArtifacts[0]?.id || "__request_package__",outcome:"comment",discipline:actorPerson?.title || "通用评审"});setReviewOpen(true);}}>提交评审意见</Button>:null}
            <List size="small" dataSource={detail.reviews} locale={{emptyText:"尚无评审意见"}} renderItem={(review:Review)=><List.Item><List.Item.Meta title={<Space wrap><Text strong>{review.reviewer_name}</Text><Tag>{review.discipline}</Tag><Tag color={review.outcome==="objection"?"error":review.outcome==="clarification_requested"?"warning":"default"}>{statusLabels[review.outcome] || review.outcome}</Tag></Space>} description={<>{review.summary}<div className="small muted">{review.artifact_code || review.artifact_title} · v{review.artifact_version} · {dateText(review.created_at)}</div></>} /></List.Item>} />
          </Card>

          <Card size="small" title={"澄清记录 · "+detail.clarifications.length}>
            <List size="small" dataSource={detail.clarifications} locale={{emptyText:"尚无澄清请求"}} renderItem={clarification=><List.Item><List.Item.Meta title={<Space wrap><Text strong>{clarification.question}</Text><Tag color={clarification.status==="answered"?"success":clarification.status==="unanswered"?"error":"warning"}>{clarification.status==="answered"?"已答复":clarification.status==="unanswered"?"未答复":clarification.status==="requested"?"等待答复":"已取消"}</Tag></Space>} description={<>{clarification.requester_name} · {clarification.artifact_title || "Request Package"} · 截止 {dateText(clarification.response_due_at)}{clarification.answer?<div className="small muted">答复：{clarification.answer}</div>:null}</>} /></List.Item>} />
          </Card>

          <Card size="small" title={"正式决定 · "+detail.decisions.length}>
            <List size="small" dataSource={detail.decisions} locale={{emptyText:"尚无正式决定"}} renderItem={decision=><List.Item><List.Item.Meta title={<Space><Tag color={statusColors[decision.outcome]}>{statusLabels[decision.outcome] || decision.outcome}</Tag><Text strong>{decision.decision_maker_name}</Text></Space>} description={<>{decision.rationale}{decision.conditions?<div className="small muted">条件：{decision.conditions}</div>:null}<div className="small muted">{dateText(decision.created_at)}</div></>} /></List.Item>} />
          </Card>
          <Card size="small" title={"决定会议纪要 · "+detail.decisionMeetings.length}>
            <List size="small" dataSource={detail.decisionMeetings} locale={{emptyText:"尚无决定会议"}} renderItem={meeting=><List.Item><List.Item.Meta title={<Space wrap><Tag color={statusColors[meeting.outcome]}>{statusLabels[meeting.outcome] || meeting.outcome}</Tag><Text strong>{meeting.chairman_name}</Text><Text type="secondary">{dayjs(meeting.meeting_at).format("YYYY-MM-DD HH:mm")}</Text></Space>} description={<>{meeting.rationale}{meeting.minutes?<div className="small muted">会议纪要：{meeting.minutes}</div>:null}</>} /></List.Item>} />
          </Card>

          <Card size="small" title={"附件 · "+detail.attachments.length}>
            <List size="small" dataSource={detail.attachments} locale={{emptyText:"尚无附件"}} renderItem={attachment=><List.Item><List.Item.Meta title={attachment.original_name} description={dateText(attachment.created_at)} /></List.Item>} />
          </Card>

          <Card size="small" title="Agent 分析记录" className="advanced-agent-card">
            {permissions.includes("contribute")?<Button size="small" onClick={openAgentPlanDialog}>发起分析</Button>:null}
            <List size="small" dataSource={detail.agentPlans} locale={{emptyText:"尚无多角色分析计划"}} renderItem={plan=><List.Item>
              <List.Item.Meta title={<Space wrap><Text strong>{plan.name}</Text><Tag color={statusColors[plan.status] || "default"}>{statusLabels[plan.status] || plan.status}</Tag></Space>} description={<>{plan.objective}<div className="small muted">已完成 {plan.nodes.filter(node=>node.status==="completed").length}/{plan.nodes.length} 个角色分析</div></>} />
              {plan.result_artifact_id?<Button type="link" size="small" onClick={()=>{const artifact=detail.artifacts.find(entry=>entry.id===plan.result_artifact_id);if(artifact)showArtifact(artifact);}}>查看草案</Button>:null}
            </List.Item>} />
            <List size="small" dataSource={detail.agentRuns} locale={{emptyText:"尚无 Agent 执行记录"}} renderItem={run=><List.Item>
              <List.Item.Meta title={<Space wrap><Text strong>{agentProfiles.find(profile=>profile.key===run.agent_key)?.name || run.agent_key}</Text><Tag color={statusColors[run.status] || "default"}>{statusLabels[run.status] || run.status}</Tag></Space>} description={<>{run.objective}<div className="small muted">发起人：{run.requested_by_name} · {dateText(run.created_at)}</div>{run.handoff_reason?<Text type="warning">等待输入：{run.handoff_reason}</Text>:null}{run.error_message?<Text type="danger">失败：{run.error_message}</Text>:null}</>} />
              {run.result_artifact_id?<Button type="link" size="small" onClick={()=>{const artifact=detail.artifacts.find(entry=>entry.id===run.result_artifact_id);if(artifact)showArtifact(artifact);}}>查看材料</Button>:null}
              {run.status==="waiting_for_human" && (run.requested_by===actor || item.requestor_id===actor || actorPerson?.is_admin===1)?<Button type="link" size="small" onClick={()=>openAgentResumeDialog(run)}>补充信息</Button>:null}
            </List.Item>} />
            <Button type="link" size="small" onClick={async()=>{const capsule=await api.contextCapsule(item.id);await navigator.clipboard.writeText(JSON.stringify(capsule,null,2));message.success("事项资料已复制");}}>复制事项资料</Button>
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
      <div className="workspace-label">工作区</div>
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
    <Modal title="新建事项" open={newItemOpen} onCancel={()=>setNewItemOpen(false)} onOk={()=>void submitForm(newItemForm,async()=>{const v=newItemForm.getFieldsValue();if(v.targetDate)v.targetDate=v.targetDate.format("YYYY-MM-DD");return api.createWorkItem(v);},"事项已创建",()=>setNewItemOpen(false))} confirmLoading={busy} width={640}>
      <Form form={newItemForm} layout="vertical" initialValues={{type:"architecture_review",priority:"normal"}}>
        <Form.Item name="title" label="事项名称" rules={[{required:true}]}><Input placeholder="例如：客户身份平台架构评估" /></Form.Item>
        <Form.Item name="type" label="事项类型"><Select options={[{value:"architecture_review",label:"架构评审"},{value:"solution_assessment",label:"方案评估"},{value:"change_assessment",label:"变更评估"},{value:"risk_assessment",label:"风险评估"},{value:"other",label:"其他"}]} /></Form.Item>
        <Form.Item name="description" label="问题背景" rules={[{required:true}]}><TextArea rows={4} /></Form.Item>
        <Form.Item name="chairmanId" label="会议主席" rules={[{required:true,message:"请选择会议主席"}]}><Select showSearch optionFilterProp="label" options={(bootstrap?.people || []).filter(p=>p.id!==actor).map(p=>({value:p.id,label:p.display_name+" · "+p.title}))} /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="priority" label="优先级"><Select options={[{value:"low",label:"低"},{value:"normal",label:"普通"},{value:"high",label:"高"}]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="targetDate" label="目标日期"><DatePicker style={{width:"100%"}} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>

    <Modal title="编辑申请材料" open={packageOpen} onCancel={()=>setPackageOpen(false)} onOk={()=>void submitForm(packageForm,async()=>api.updateRequestPackage(selected!.id,packageForm.getFieldsValue()),"申请材料已保存",()=>setPackageOpen(false))} confirmLoading={busy} width={720}>
      <Form form={packageForm} layout="vertical">
        <Form.Item name="goal" label="预期结果"><TextArea rows={2}/></Form.Item>
        <Form.Item name="scope" label="范围"><TextArea rows={2}/></Form.Item>
        <Form.Item name="constraints" label="约束与主要风险"><TextArea rows={2}/></Form.Item>
        <Form.Item name="initialProposal" label="初步方案（可选）"><TextArea rows={3}/></Form.Item>
        <Form.Item name="decisionQuestions" label="需要负责人决定的问题"><TextArea rows={2}/></Form.Item>
        <Form.Item name="submissionMessage" label="本次提交说明"><Input/></Form.Item>
        <Text type="secondary" className="small">保存草稿不需要填完这些内容；提交评审前需补齐预期结果、范围、决定问题和提交说明。</Text>
               </Form>
    </Modal>

    <Modal title="添加架构材料 / ADR" open={artifactOpen} onCancel={()=>setArtifactOpen(false)} onOk={()=>void submitForm(artifactForm,async()=>api.createArtifact(selected!.id,artifactForm.getFieldsValue()),"材料已保存",()=>setArtifactOpen(false))} confirmLoading={busy} width={720}>
      <Form form={artifactForm} layout="vertical" initialValues={{type:"ADR",status:"proposed"}}>
        <Row gutter={12}><Col span={8}><Form.Item name="type" label="类型"><Select options={[{value:"ADR",label:"ADR"},{value:"Architecture Overview",label:"架构方案"},{value:"Architecture Diagram",label:"架构图"},{value:"Evidence",label:"证据"}]} /></Form.Item></Col><Col span={8}><Form.Item name="code" label="编号"><Input placeholder="ADR-004" /></Form.Item></Col><Col span={8}><Form.Item name="status" label="状态"><Select options={[{value:"draft",label:"草稿"},{value:"proposed",label:"提议"},{value:"submitted",label:"已提交"}]} /></Form.Item></Col></Row>
        <Form.Item name="title" label="标题" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="summary" label="摘要"><TextArea rows={2} /></Form.Item>
        <Form.Item name="content" label="内容 / 决策记录" rules={[{required:true}]}><TextArea rows={9} placeholder="背景、决策因素、备选方案、决定和影响..." /></Form.Item>
      </Form>
    </Modal>

    <Modal title="提交评审意见" open={reviewOpen} onCancel={()=>setReviewOpen(false)} onOk={()=>void submitForm(reviewForm,async()=>{
      const value=reviewForm.getFieldsValue();
      if(value.responseDueAt) value.responseDueAt=value.responseDueAt.toISOString();
      return api.createReview(selected!.id,value);
    },"评审意见已提交",()=>setReviewOpen(false))} confirmLoading={busy}>
      <Form form={reviewForm} layout="vertical">
        <Form.Item name="artifactId" label="评审对象"><Select options={[{value:"__request_package__",label:"整份申请材料"},...(detail?.cycles[0] ? (JSON.parse(detail.cycles[0].baseline_json) as {id:string;version:number}[]).map(entry=>detail.artifacts.find(a=>a.id===entry.id && a.version===entry.version)).filter(Boolean).map(a=>({value:(a as Artifact).id,label:((a as Artifact).code || (a as Artifact).type)+" · "+(a as Artifact).title+" v"+(a as Artifact).version})) : [])]} /></Form.Item>
        <Form.Item name="discipline" label="专业领域" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="outcome" label="操作类型" rules={[{required:true}]}><Select options={[{value:"comment",label:"评论（不改变流程）"},{value:"clarification_requested",label:"请申请人澄清（暂停评审计时）"},{value:"objection",label:"提出阻断性异议（提前进入决定会议）"}]} /></Form.Item>
        <Form.Item name="summary" label="意见 / 澄清问题" rules={[{required:true}]}><TextArea rows={4} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="clarification_requested" ? <Form.Item name="responseDueAt" label="申请人答复截止时间" rules={[{required:true,message:"请设置答复截止时间"}]}><DatePicker showTime style={{width:"100%"}} /></Form.Item> : null}</Form.Item>
      </Form>
    </Modal>

    <Modal title="回答澄清问题" open={clarificationOpen} onCancel={()=>setClarificationOpen(false)} onOk={()=>void submitForm(clarificationForm,async()=>api.answerClarification(selected!.id,detail!.workflow.activeClarification!.id,String(clarificationForm.getFieldValue("answer") || "")),"澄清答复已提交",()=>setClarificationOpen(false))} confirmLoading={busy}>
      <Form form={clarificationForm} layout="vertical">
        <Form.Item name="answer" label="答复" rules={[{required:true}]}><TextArea rows={5} maxLength={8000} showCount /></Form.Item>
      </Form>
    </Modal>

    <Modal title={editingTaskId ? "编辑任务" : "添加任务"} open={taskOpen} onCancel={()=>{setTaskOpen(false);setEditingTaskId(null);taskForm.resetFields();}} onOk={()=>void submitForm(taskForm,async()=>{
      const v=taskForm.getFieldsValue();
      if(v.dueDate) v.dueDate=v.dueDate.format("YYYY-MM-DD");
      if(editingTaskId) {
        if(v.assigneeId===undefined) v.assigneeId=null;
        if(v.dueDate===undefined) v.dueDate=null;
        return api.updateTask(editingTaskId,v);
      }
      return api.createTask(selected!.id,v);
    },editingTaskId?"任务已更新":"任务已添加",()=>{setTaskOpen(false);setEditingTaskId(null);})} confirmLoading={busy}>
      <Form form={taskForm} layout="vertical">
        <Form.Item name="title" label="工作内容" rules={[{required:true}]}><Input disabled={Boolean(editingTaskId)} /></Form.Item>
        <Form.Item name="kind" label="任务类型"><Select disabled={Boolean(editingTaskId)} options={[{value:"analysis",label:"分析"},{value:"revision",label:"材料修改"},{value:"follow_up",label:"后续整改"},{value:"decision_prep",label:"决策准备"}]} /></Form.Item>
        <Form.Item name="ownerId" label="任务负责人" rules={[{required:true}]}><Select options={(detail?.participants || []).map(p=>({value:p.person_id,label:p.display_name+" · "+p.role_label}))} /></Form.Item>
        <Form.Item name="assigneeId" label="执行人"><Select allowClear options={(detail?.participants || []).map(p=>({value:p.person_id,label:p.display_name+" · "+p.role_label}))} /></Form.Item>
        <Form.Item name="dueDate" label="截止日期"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="Agent 分析" open={agentPlanOpen} onCancel={()=>setAgentPlanOpen(false)} onOk={()=>void submitForm(agentPlanForm,async()=>{
      const value=agentPlanForm.getFieldsValue();
      if(!String(value.name || "").trim() || !String(value.objective || "").trim() || !Array.isArray(value.agentKeys) || value.agentKeys.length===0) throw new Error("请填写分析名称、目标并选择至少一个角色。");
      const nodes=(value.agentKeys as string[]).map(agentKey=>({
        key:agentKey,
        agentKey,
        objective:value.objective
      }));
      return api.requestAgentPlan(selected!.id,{name:value.name,objective:value.objective,taskId:value.taskId,nodes});
    },"分析任务已创建",()=>setAgentPlanOpen(false))} confirmLoading={busy} width={760}>
             <Form form={agentPlanForm} layout="vertical">
        <Form.Item name="name" label="分析名称" rules={[{required:true}]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="agentKeys" label="参与角色" rules={[{required:true,message:"至少选择一个角色"}]}><Select mode="multiple" options={agentProfiles.filter(profile=>profile.key!=="decision-analyst").map(profile=>({value:profile.key,label:profile.name+" · "+profile.description}))} /></Form.Item>
        <Form.Item name="taskId" label="关联任务（可选）"><Select allowClear options={detail?.tasks.filter(task=>!["done","cancelled"].includes(task.status)).map(task=>({value:task.id,label:task.title})) || []} /></Form.Item>
        <Form.Item name="objective" label="分析目标" rules={[{required:true}]}><TextArea rows={5} maxLength={4000} showCount /></Form.Item>
      </Form>
    </Modal>

    <Modal title="继续 Agent 分析" open={agentResumeOpen} onCancel={()=>{setAgentResumeOpen(false);setAgentResumeRunId(null);}} onOk={()=>void submitForm(agentResumeForm,async()=>api.resumeAgentRun(agentResumeRunId!,String(agentResumeForm.getFieldValue("additionalContext") || "")),"Agent 任务已重新加入队列",()=>{setAgentResumeOpen(false);setAgentResumeRunId(null);})} confirmLoading={busy}>
      <Alert type="info" showIcon message="补充信息后，Agent 会继续处理原任务。" className="modal-alert" />
      <Form form={agentResumeForm} layout="vertical"><Form.Item name="additionalContext" label="补充说明 / 回答 Agent 提出的问题"><TextArea rows={5} maxLength={8000} showCount placeholder="补充事实、约束或需要调整的方向。" /></Form.Item></Form>
    </Modal>

    <Modal title="记录决定会议结论" open={decisionOpen} onCancel={()=>setDecisionOpen(false)} onOk={()=>void submitForm(decisionForm,async()=>{
      const value=decisionForm.getFieldsValue();
      if(value.meetingAt) value.meetingAt=value.meetingAt.toISOString();
      if(value.technicalDebt?.dueDate) value.technicalDebt.dueDate=value.technicalDebt.dueDate.format("YYYY-MM-DD");
      if(!value.createTechnicalDebt) delete value.technicalDebt;
      delete value.createTechnicalDebt;
      return api.createDecision(selected!.id,value);
    },"决定会议结论已记录",()=>setDecisionOpen(false))} confirmLoading={busy} width={720}>
      <Alert type="warning" showIcon message="只有会议主席或管理员可以记录正式结论。" className="modal-alert" />
      <Form form={decisionForm} layout="vertical" initialValues={{outcome:"approved",createTechnicalDebt:false}}>
        <Form.Item name="meetingAt" label="会议时间"><DatePicker showTime style={{width:"100%"}} /></Form.Item>
        <Form.Item name="outcome" label="正式结论" rules={[{required:true}]}><Select options={[{value:"approved",label:"批准"},{value:"needs_work",label:"要求修改"},{value:"rejected",label:"拒绝"}]} /></Form.Item>
        <Form.Item name="rationale" label="决定依据" rules={[{required:true}]}><TextArea rows={3} /></Form.Item>
        <Form.Item name="conditions" label="批准条件 / 后续约束"><TextArea rows={2} /></Form.Item>
        <Form.Item name="minutes" label="会议纪要"><TextArea rows={4} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="approved"?<>
          <Divider titlePlacement="start">需要长期跟踪的技术债务（可选）</Divider>
          <Form.Item name="createTechnicalDebt" valuePropName="checked"><Checkbox>将需要长期跟踪的技术债务单独登记</Checkbox></Form.Item>
          {getFieldValue("createTechnicalDebt")?<>
            <Form.Item name={["technicalDebt","title"]} label="技术债务标题" rules={[{required:true}]}><Input/></Form.Item>
            <Form.Item name={["technicalDebt","description"]} label="来源与原因"><TextArea rows={2}/></Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name={["technicalDebt","ownerId"]} label="责任人"><Select options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))}/></Form.Item></Col>
              <Col span={12}><Form.Item name={["technicalDebt","severity"]} label="严重程度"><Select options={[{value:"low",label:"低"},{value:"medium",label:"中"},{value:"high",label:"高"}]}/></Form.Item></Col>
            </Row>
            <Form.Item name={["technicalDebt","targetState"]} label="目标状态"><Input/></Form.Item>
            <Form.Item name={["technicalDebt","remediationPlan"]} label="处理计划"><TextArea rows={2}/></Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name={["technicalDebt","priority"]} label="优先级"><Select options={[{value:"low",label:"低"},{value:"normal",label:"普通"},{value:"high",label:"高"}]}/></Form.Item></Col>
              <Col span={12}><Form.Item name={["technicalDebt","dueDate"]} label="目标完成日期"><DatePicker style={{width:"100%"}}/></Form.Item></Col>
            </Row>
          </>:null}
        </>:null}</Form.Item>
      </Form>
    </Modal>

    <Modal title="添加外部资源" open={externalLinkOpen} onCancel={()=>setExternalLinkOpen(false)} onOk={()=>void submitForm(externalLinkForm,async()=>{
      const value=externalLinkForm.getFieldsValue();
      if(value.existingResourceId) {
        return api.addExternalLink(selected!.id,{resourceId:value.existingResourceId,relationType:value.relationType,templateKey:value.templateKey,templateName:value.templateName});
      }
      delete value.existingResourceId;
      return api.addExternalLink(selected!.id,value);
    },"外部资源已添加",()=>setExternalLinkOpen(false))} confirmLoading={busy} width={760}>
      <Alert type="info" showIcon message="这里只记录外部资源链接，不读取源系统内容。" description="已登记的资源可以关联到多个事项；新资源请填写对应的 ID、Key 和链接。" className="modal-alert" />
      <Form form={externalLinkForm} layout="vertical">
        <Form.Item name="existingResourceId" label="选用已登记的外部资源（可选）">
          <Select allowClear showSearch optionFilterProp="label" placeholder="搜索已登记资源" options={externalReferences.map(r=>({value:r.id,label:r.provider.toUpperCase()+" · "+(r.external_key || r.external_id)+" · "+r.title}))} />
        </Form.Item>
        <Text type="secondary" className="small">仅显示工作台中已经登记的资源。</Text>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>{
          const chosen=externalReferences.find(r=>r.id===getFieldValue("existingResourceId"));
          if (chosen) return <>
            <Alert type="success" showIcon message="已选择已有引用" description={chosen.provider.toUpperCase()+" · "+chosen.resource_type+" · "+(chosen.external_key || chosen.external_id)+" · "+chosen.title} />
            {chosen.provider==="confluence" && chosen.resource_type==="Page"?<>
              <Divider titlePlacement="start">Confluence 页面模板</Divider>
              <Form.Item name="templateKey" label="Template Key / ID" rules={[{required:true,message:"请填写该 Page 使用的 Template 标识"}]}><Input placeholder="例如 architecture-decision-record" /></Form.Item>
              <Form.Item name="templateName" label="Template 名称"><Input placeholder="例如 Architecture Decision Record" /></Form.Item>
              <Text type="secondary" className="small">这里只记录模板标识。</Text>
            </>:null}
          </>;
          return <>
            <Divider titlePlacement="start">添加新的外部资源</Divider>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="provider" label="外部系统" rules={[{required:true}]}><Select options={[{value:"jira",label:"Jira"},{value:"confluence",label:"Confluence"},{value:"github",label:"GitHub"},{value:"leanix",label:"LeanIX"}]} onChange={value=>externalLinkForm.setFieldsValue({resourceType:value==="jira"?"Story":value==="confluence"?"Page":value==="github"?"Repository":"Application",externalId:undefined,externalKey:undefined,title:undefined,url:undefined,templateKey:undefined,templateName:undefined})} /></Form.Item></Col>
              <Col span={12}><Form.Item name="resourceType" label="资源类型" dependencies={["provider"]} rules={[{required:true}]}><Select options={(externalLinkForm.getFieldValue("provider")==="jira"?["Story","Epic","Task","Bug"]:externalLinkForm.getFieldValue("provider")==="confluence"?["Page"]:externalLinkForm.getFieldValue("provider")==="github"?["Repository","PullRequest","Issue","Commit"]:["Application","Interface","ITComponent","DataObject","BusinessCapability","Provider","Project"]).map(value=>({value,label:value}))} /></Form.Item></Col>
            </Row>
            <Row gutter={12}><Col span={12}><Form.Item name="externalId" label="外部资源 ID" rules={[{required:true}]}><Input placeholder="Jira issue ID / Confluence Page ID / LeanIX Fact Sheet ID" /></Form.Item></Col><Col span={12}><Form.Item name="externalKey" label="业务 Key / Identifier"><Input placeholder="DATA-412 / APP-CRM-001 / owner/repository" /></Form.Item></Col></Row>
            <Form.Item name="title" label="资源名称" rules={[{required:true}]}><Input /></Form.Item>
            <Form.Item name="url" label="资源 URL"><Input placeholder="https://..." /></Form.Item>
            {externalLinkForm.getFieldValue("provider")==="confluence" && externalLinkForm.getFieldValue("resourceType")==="Page"?<>
              <Divider titlePlacement="start">Confluence 页面模板</Divider>
              <Form.Item name="templateKey" label="Template Key / ID" rules={[{required:true,message:"请填写该 Page 使用的 Template 标识"}]}><Input placeholder="例如 architecture-decision-record" /></Form.Item>
              <Form.Item name="templateName" label="Template 名称"><Input placeholder="例如 Architecture Decision Record" /></Form.Item>
              <Text type="secondary" className="small">这里只记录模板标识。</Text>
            </>:null}
          </>;
        }}</Form.Item>
        <Form.Item name="relationType" label="与事项的关系" rules={[{required:true}]}><Select options={[
          {value:"related_to",label:"相关"},
          {value:"implements",label:"实现 / 交付"},
          {value:"decision_record",label:"决策记录"},
          {value:"review_evidence",label:"评审材料"},
          {value:"solution_design",label:"方案设计"},
          {value:"implementation_repository",label:"实现代码库"},
          {value:"shared_component",label:"共享组件"},
          {value:"impacted_application",label:"涉及的应用"},
          {value:"impacted_interface",label:"涉及的接口"},
          {value:"dependency",label:"依赖"}
        ]} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="编辑个人资料" open={profileOpen} onCancel={()=>setProfileOpen(false)} onOk={()=>void submitForm(profileForm,async()=>{
      const value=profileForm.getFieldsValue();
      return api.updateProfile(profilePerson!.id,value);
    },"个人资料已更新",()=>setProfileOpen(false))} confirmLoading={busy} width={680}>
      <Form form={profileForm} layout="vertical">
        <Row gutter={12}>
          <Col span={12}><Form.Item name="displayName" label="姓名" rules={[{required:true}]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="title" label="职位 / 专业角色" rules={[{required:true}]}><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="email" label="邮箱" rules={[{required:true,type:"email"}]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="department" label="部门"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="location" label="地点"><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="timezone" label="时区"><Input placeholder="Asia/Tokyo" /></Form.Item>
        <Form.Item name="bio" label="个人简介"><TextArea rows={3} /></Form.Item>
        <Form.Item name="expertise" label="专业领域（逗号分隔）"><Input placeholder="解决方案架构、API 设计、云平台" /></Form.Item>
      </Form>
    </Modal>

    <Modal title={editingParticipationId?"编辑相关人员":"添加相关人员"} open={participantOpen} onCancel={()=>{setParticipantOpen(false);setEditingParticipationId(null);}} onOk={()=>void submitForm(participantForm,async()=>{
      const value=participantForm.getFieldsValue();
      const roleLabel=participantRoleChoices.find(option=>option.value===value.roleKey)?.label || value.roleKey;
      return editingParticipationId
        ? api.updateParticipation(selected!.id,editingParticipationId,{roleKey:value.roleKey,roleLabel,permissions:value.permissions})
        : api.setParticipation(selected!.id,{...value,roleLabel});
    },"相关人员已更新",()=>{setParticipantOpen(false);setEditingParticipationId(null);})} confirmLoading={busy}>
       <Form form={participantForm} layout="vertical">
        <Form.Item name="personId" label="参与者" rules={[{required:true}]}><Select disabled={Boolean(editingParticipationId)} showSearch optionFilterProp="label" options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name+" · "+p.title}))} /></Form.Item>
        <Form.Item name="roleKey" label="职责" rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={participantRoleChoices} onChange={roleKey=>{
          const permissions=participantForm.getFieldValue("permissions") || ["read","comment"];
          participantForm.setFieldsValue({
            roleLabel:participantRoleChoices.find(option=>option.value===roleKey)?.label || roleKey,
            permissions:roleKey==="chairman"?["read","decide"]:permissions.filter((permission:string)=>permission!=="decide")
          });
        }} /></Form.Item>
        <Form.Item name="permissions" label="事项权限" rules={[{required:true}]}><Select mode="multiple" options={[{value:"read",label:"读取"},{value:"contribute",label:"提交材料和管理任务"},{value:"comment",label:"讨论"},{value:"review",label:"评审"},{value:"decide",label:"作出决定"},{value:"manage",label:"管理参与者"}]} /></Form.Item>
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
        <Form.Item name="remediationPlan" label="处理计划"><TextArea rows={3} /></Form.Item>
        <Form.Item name="dueDate" label="目标日期"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>
  </Layout>;
}
