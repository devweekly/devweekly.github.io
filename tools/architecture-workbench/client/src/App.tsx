import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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

const AnalyticsCharts = lazy(() => import("./AnalyticsCharts"));
const MarkdownContent = lazy(() => import("./MarkdownContent"));

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const statusLabels: Record<string,string> = {
  draft:"Request Draft", requestor_revision:"Changes Requested", discussion_review:"Discussion & Review",
  waiting_requestor:"Awaiting Requestor Response", decision_meeting:"Awaiting Decision Meeting",
  approved_pending_close:"Approved · Pending Closure", rejected_pending_close:"Rejected · Pending Closure",
  closed:"Closed", open:"Open", in_progress:"In Progress", deferred:"Deferred", resolved:"Resolved",
  cancelled:"Cancelled", approved:"Approve", needs_work:"Changes Required", rejected:"Reject",
  queued:"Queued", running:"Running", waiting_for_human:"Waiting for Human Input", completed:"Completed",
  failed:"Failed", blocked:"Blocked"
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
  {value:"chairman",label:"Meeting Chair"},
  {value:"solution_architect",label:"Solution Architect"},
  {value:"enterprise_architect",label:"Enterprise Architect"},
  {value:"data_architect",label:"Data Architect"},
  {value:"security_architect",label:"Security Architect"},
  {value:"solution_sme",label:"Business SME"},
  {value:"development_manager",label:"Development Manager"},
  {value:"architecture_reviewer",label:"Architecture Reviewer"},
  {value:"reviewer",label:"Reviewer"},
  {value:"contributor",label:"Participant"},
  {value:"other",label:"Other"}
];
const dateText = (value?: string | null) => value ? dayjs(value).format("YYYY-MM-DD") : "—";

const workItemTypeLabels: Record<string,string> = {
  architecture_review:"Architecture Review", solution_assessment:"Solution Assessment", change_assessment:"Change Assessment",
  risk_assessment:"Risk Assessment", technical_debt:"Technical Debt", other:"Other"
};
const taskKindLabels: Record<string,string> = {
  analysis:"Analysis", revision:"Artifact Revision", follow_up:"Follow-up Remediation", decision_prep:"Decision Preparation"
};
const relationTypeLabels: Record<string,string> = {
  related_to:"Related", implements:"Implements / Delivers", decision_record:"Decision Record", review_evidence:"Review Evidence",
  solution_design:"Solution Design", implementation_repository:"Code Repository", shared_component:"Shared Component",
  impacted_application:"Impacted Application", impacted_interface:"Impacted Interface", dependency:"Dependency",
  generated_technical_debt:"Resulting Technical Debt"
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
      message.error(error instanceof Error ? error.message : "Failed to load");
    } finally { setLoading(false); }
  }
  async function openWorkItem(item:WorkItem) {
    setSelected(item); setDetail(null); setPage("work-items");
    writeRoute("work-items",item.id);
    try { setDetail(await api.detail(item.id)); }
    catch (error) { message.error(error instanceof Error ? error.message : "Unable to open work item"); }
  }
  async function openRelatedDebt(workItemId:string) {
    setPage("work-items"); setSelected(null); setDetail(null);
    writeRoute("work-items",workItemId);
    try { setDetail(await api.detail(workItemId)); }
    catch (error) { message.error(error instanceof Error ? error.message : "Unable to open related Technical Debt"); }
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
      message.error(error instanceof Error?error.message:"Unable to open work item");
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
        void api.detail(itemId).then(setDetail).catch(error=>message.error(error instanceof Error?error.message:"Unable to open work item"));
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
    {key:"my-work",icon:<UnorderedListOutlined />,label:"My Work"},
    {key:"work-items",icon:<ProjectOutlined />,label:"All Work Items"},
    {key:"analytics",icon:<BarChartOutlined />,label:"Analytics"},
    {key:"debts",icon:<FileProtectOutlined />,label:"Technical Debt"}
  ];

  async function submitForm(form:FormInstance,action:()=>Promise<unknown>,success:string,close:()=>void) {
    setBusy(true);
    try {
      await action(); message.success(success); close(); form.resetFields();
      await reload(); if (selected) await refreshDetail();
    } catch (error) { message.error(error instanceof Error ? error.message : "Operation failed"); }
    finally { setBusy(false); }
  }

  const itemColumns=[
    {title:"Work Item",dataIndex:"title",key:"title",render:(_:string,item:WorkItem)=><Space direction="vertical" size={2}><Button type="link" className="table-link" onClick={()=>void openWorkItem(item)}>{item.title}</Button><Text type="secondary" className="small">{item.code} · {workItemTypeLabels[item.type] || item.type}</Text></Space>},
    {title:"Owner",dataIndex:"owner_name",key:"owner_name"},
    {title:"Status",dataIndex:"status",key:"status",render:(v:string)=><Tag color={statusColors[v]}>{statusLabels[v] || v}</Tag>},
    {title:"Priority",dataIndex:"priority",key:"priority",render:(v:string)=><Tag color={v==="high"?"red":v==="normal"?"blue":"default"}>{v==="high"?"High":v==="normal"?"Normal":"Low"}</Tag>},
    {title:"Artifacts",dataIndex:"artifact_count",key:"artifact_count",width:70},
    {title:"Open Tasks",dataIndex:"open_task_count",key:"open_task_count",width:90},
    {title:"Target Date",dataIndex:"target_date",key:"target_date",render:dateText}
  ];
  const debtColumns=[
    {title:"Technical Debt",dataIndex:"title",key:"title",render:(_:string,debt:DebtItem)=><Space direction="vertical" size={2}><Text strong>{debt.title}</Text><Text type="secondary" className="small">{debt.code}</Text></Space>},
    {title:"Responsible",dataIndex:"owner_name",key:"owner_name"},
    {title:"Severity",dataIndex:"severity",key:"severity",render:(v:string)=><Tag color={v==="high"?"red":v==="medium"?"orange":"blue"}>{v==="high"?"High":v==="medium"?"Medium":"Low"}</Tag>},
    {title:"Status",dataIndex:"debt_status",key:"debt_status",render:(v:string,row:DebtItem)=><Select size="small" value={v} disabled={actor!==row.owner_id} style={{width:112}} onChange={value=>void updateDebt(row,value)} options={[{value:"open",label:"Open"},{value:"in_progress",label:"In Progress"},{value:"deferred",label:"Deferred"},{value:"resolved",label:"Resolved"}]} />},
    {title:"Target Date",dataIndex:"target_date",key:"target_date",render:dateText}
  ];

  async function updateDebt(debt:DebtItem,status:string) {
    try { await api.updateDebt(debt.id,{status}); message.success("Technical debt status updated"); await reload(); }
    catch (error) { message.error(error instanceof Error ? error.message : "Update failed"); }
  }
  async function updateTask(taskId:string,status:string) {
    try {
      await api.updateTask(taskId,{status});
      message.success("Task status updated");
      await reload();
      if (selected) await refreshDetail();
    } catch (error) { message.error(error instanceof Error ? error.message : "Update failed"); }
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
      name:"Architecture Analysis",
      agentKeys:["business-analyst","solution-architect","data-architect","security-reviewer"],
      objective:"Review the business objective, technical approach, data design, and security requirements. Each role documents findings, rationale, and recommendations. Summarize differing views and questions requiring an owner decision."
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
      message.success("Work item workflow updated");
      await reload();
      await refreshDetail();
    } catch (error) { message.error(error instanceof Error ? error.message : "Workflow transition failed"); }
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
      message.success("Participant removed");
      await refreshDetail();
      await reload();
    } catch(error) { message.error(error instanceof Error ? error.message : "Failed to remove participant"); }
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
      message.error(error instanceof Error ? error.message : "Unable to load registered external references");
    }
  }
  async function removeExternalLink(linkId:string) {
    if (!selected) return;
    try { await api.removeExternalLink(selected.id,linkId); message.success("External reference removed"); await refreshDetail(); }
    catch(error) { message.error(error instanceof Error ? error.message : "Failed to remove reference"); }
  }
  async function submitComment() {
    if (!selected || !commentText.trim()) return;
    try { await api.comment(selected.id,commentText.trim()); setCommentText(""); await refreshDetail(); }
    catch (error) { message.error(error instanceof Error ? error.message : "Submission failed"); }
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
      if(isOverdue(item)) return "Past target date";
      if(item.status==="discussion_review") return "Review in progress";
      if(item.status==="waiting_requestor") return "Awaiting Requestor Response";
      if(item.status==="decision_meeting") return "Awaiting Decision Meeting";
      if(["approved_pending_close","rejected_pending_close"].includes(item.status)) return "Awaiting work item closure";
      return "Follow-up required";
    };
    const debtItems=bootstrap?.debts || [];
    return <div className="page-stack">
      <div className="page-heading"><div><Title level={2}>Analytics</Title><Paragraph type="secondary">Explore status, type, priority, cycle time, external references, and technical debt across work items visible to you.</Paragraph></div><Text type="secondary" className="small">Updated {dateText(analyticsData.generatedAt)}</Text></div>
      <Tabs activeKey={analyticsTab} onChange={key=>{setAnalyticsTab(key);writeRoute("analytics",null,key);}} items={[
        {key:"requests",label:"Work ItemAnalysis",children:<div className="page-stack">
          <Card title={"Items Requiring Attention · "+attentionItems.length} className="panel-card" extra={<Button type="link" onClick={()=>navigatePage("work-items")}>All Work Items</Button>}>
            <Table size="small" rowKey="id" dataSource={attentionItems} pagination={{pageSize:6,hideOnSinglePage:true}} locale={{emptyText:"No work items currently require follow-up"}} columns={[
              {title:"Work Item",dataIndex:"title",render:(value:string,item:WorkItem)=><Button type="link" className="table-link" onClick={()=>void openWorkItem(item)}>{item.code} · {value}</Button>},
              {title:"Stage",dataIndex:"status",render:(value:string)=><Tag color={statusColors[value]}>{statusLabels[value] || value}</Tag>},
              {title:"Owner",dataIndex:"owner_name"},
              {title:"Target Date",dataIndex:"target_date",render:dateText},
              {title:"Current Focus",render:(_:unknown,item:WorkItem)=>attentionLabel(item)}
            ]} />
          </Card>
          <Suspense fallback={<Card loading />}>
            <AnalyticsCharts mode="requests" data={r} />
          </Suspense>
        </div>},
        {key:"debt",label:"Technical DebtAnalysis",children:<div className="page-stack">
          <Suspense fallback={<Card loading />}>
            <AnalyticsCharts mode="debt" data={d} />
          </Suspense>
          <Card title={"Unresolved Technical Debt · "+debtItems.filter(item=>["open","in_progress"].includes(item.debt_status)).length} className="panel-card" extra={<Button type="link" onClick={()=>navigatePage("debts")}>Open Technical Debt Register</Button>}>
            <Table size="small" rowKey="id" dataSource={debtItems.filter(item=>["open","in_progress"].includes(item.debt_status)).slice(0,8)} pagination={false} locale={{emptyText:"No open technical debt items"}} columns={[
              {title:"Technical Debt",dataIndex:"title",render:(value:string,row:DebtItem)=><div><Text strong>{row.code}</Text><div>{value}</div></div>},
              {title:"Severity",dataIndex:"severity",render:(value:string)=><Tag color={value==="critical"?"red":value==="high"?"orange":"default"}>{value}</Tag>},
              {title:"Status",dataIndex:"debt_status",render:(value:string)=><Tag>{statusLabels[value] || value}</Tag>},
              {title:"Owner",dataIndex:"owner_name"},
              {title:"Target Date",dataIndex:"target_date",render:dateText}
            ]} />
          </Card>
          <Alert type="info" showIcon message="Scope" description="Only technical debt requiring long-term tracking is registered separately. Routine revisions, analysis, and short-term remediation remain tasks under the original work item and are not counted twice." />
        </div>}
      ]} />
    </div>;
  }
  
  function renderDashboard() {
    if (!bootstrap) return <Card loading />;
    return <div className="page-stack">
      <div className="page-heading"><div><Title level={2}>Overview</Title><Paragraph type="secondary">Recently updated work items and technical debt.</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>setNewItemOpen(true)}>New Work Item</Button></div>
       <Card title="Recent Work Items" extra={<Button type="link" onClick={()=>navigatePage("work-items")}>View All</Button>} className="panel-card">
        <Table rowKey="id" columns={itemColumns} dataSource={bootstrap.workItems.slice(0,8)} pagination={false} loading={loading} />
      </Card>
      <Card title="Technical Debt Tracking" extra={<Button type="link" onClick={()=>setPage("debts")}>Open Register</Button>} className="panel-card">
        <Table rowKey="id" columns={debtColumns} dataSource={bootstrap.debts.slice(0,3)} pagination={false} />
      </Card>
    </div>;
  }

  function renderWorkItems() {
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">Work Item Management</Text><Title level={2}>Business Work Items</Title><Paragraph type="secondary">Browse work items by owner, status, and target date.</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>setNewItemOpen(true)}>New Work Item</Button></div>
      <Card className="panel-card"><div className="table-toolbar"><Input.Search allowClear placeholder="Search work items, IDs, or owners" onSearch={setQuery} onChange={e=>setQuery(e.target.value)} style={{maxWidth:360}} /><Text type="secondary">{filteredItems.length} work items</Text></div><Table rowKey="id" columns={itemColumns} dataSource={filteredItems} loading={loading} pagination={{pageSize:8}} /></Card>
    </div>;
  }
  function renderDebts() {
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">Technical Debt Tracking</Text><Title level={2}>Technical Debt</Title><Paragraph type="secondary">Track each technical debt item with its owner, priority, remediation plan, target date, and links to its originating work item and related decisions.</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={()=>{debtForm.setFieldsValue({originWorkItemId:bootstrap?.workItems[0]?.id,priority:"normal",severity:"medium"});setDebtOpen(true);}}>Register Technical Debt</Button></div>
      <Card className="panel-card"><Table rowKey="id" columns={debtColumns} dataSource={bootstrap?.debts || []} loading={loading} pagination={{pageSize:8}} /></Card>
      <Alert type="info" showIcon message="When to Register Separately" description="Record fixes that can be completed within the original work item as tasks. Register technical debt separately only when it needs long-term tracking, a dedicated owner, and its own priority." />
    </div>;
  }
  function renderMyWork() {
    const mine=(bootstrap?.workItems || []).filter(item=>item.owner_id===actor || item.requestor_id===actor);
    const taskColumns=[
      {title:"Task",dataIndex:"title",render:(value:string)=><Text strong>{value}</Text>},
      {title:"Work Item",dataIndex:"work_item_title",render:(value:string,task:MyTask)=><Button type="link" className="table-link" onClick={()=>{const item=bootstrap?.workItems.find(entry=>entry.id===task.work_item_id);if(item)void openWorkItem(item);}}>{task.work_item_code} · {value}</Button>},
      {title:"Owner",dataIndex:"owner_name",render:(value:string|null)=>value || "—"},
      {title:"Assignee",dataIndex:"assignee_name",render:(value:string|null)=>value || "Unassigned"},
       {title:"Status",dataIndex:"status",render:(value:string,task:MyTask)=><Select size="small" value={value} style={{width:120}} onChange={status=>void updateTask(task.id,status)} options={[{value:"open",label:"Open"},{value:"in_progress",label:"In Progress"},{value:"blocked",label:"Blocked"},{value:"done",label:"Done"},{value:"cancelled",label:"Cancel"}]} />},
      {title:"Due Date",dataIndex:"due_date",render:dateText},
     ];
    return <div className="page-stack">
      <div className="page-heading"><div><Title level={2}>My Tasks</Title><Paragraph type="secondary">View tasks assigned to you and work items you initiated or own.</Paragraph></div></div>
      <Card title="Task List" className="panel-card"><Table rowKey="id" columns={taskColumns} dataSource={myTasks} loading={loading} pagination={{pageSize:8}} locale={{emptyText:<Empty description="No tasks are assigned to you" />}} /></Card>
      <Card title="Work Items I Initiated or Own" className="panel-card"><Table rowKey="id" columns={itemColumns} dataSource={mine} pagination={{pageSize:6}} /></Card>
    </div>;
  }
  function renderPeople() {
    if (!bootstrap) return <Card loading />;
    const selectedPerson=profilePerson;
    const expertise=selectedPerson ? JSON.parse(selectedPerson.expertise_json || "[]") as string[] : [];
    const canEdit=Boolean(selectedPerson && (selectedPerson.id===actor || actorPerson?.is_admin));
    const columns=[
      {title:"Person",dataIndex:"display_name",render:(value:string,person:Person)=><Space><Avatar style={{background:person.avatar_color}}>{value.slice(0,1)}</Avatar><div><Text strong>{value}</Text><div className="small muted">{person.title}</div></div></Space>},
      {title:"Department",dataIndex:"department"},
      {title:"Location",dataIndex:"location"},
      {title:"Role",dataIndex:"is_admin",render:(value:number)=>value?<Tag color="purple">Administrator</Tag>:<Tag>Participant</Tag>}
    ];
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">People</Text><Title level={2}>People Directory</Title><Paragraph type="secondary">View participants' roles, areas of expertise, and contact details. People can maintain their own profiles; administrators can maintain other directory entries.</Paragraph></div></div>
      <Row gutter={[16,16]}>
        <Col xs={24} xl={13}>
          <Card title="People Directory" className="panel-card">
            <Table rowKey="id" size="middle" dataSource={bootstrap.people} columns={columns} pagination={{pageSize:8}}
              onRow={person=>({onClick:()=>setProfilePersonId(person.id),style:{cursor:"pointer",background:person.id===selectedPerson?.id?"#f4f7fb":undefined}})} />
          </Card>
        </Col>
        <Col xs={24} xl={11}>
          {selectedPerson ? <Card className="panel-card" title="Profile" extra={canEdit?<Button icon={<EditOutlined />} onClick={()=>openProfileEditor(selectedPerson)}>Edit Profile</Button>:null}>
            <Space align="start" size={14}>
              <Avatar size={58} style={{background:selectedPerson.avatar_color,fontSize:24}}>{selectedPerson.display_name.slice(0,1)}</Avatar>
              <div><Title level={4} style={{margin:"2px 0 4px"}}>{selectedPerson.display_name}</Title><Text type="secondary">{selectedPerson.title}</Text><div>{selectedPerson.is_admin?<Tag color="purple">Administrator</Tag>:null}</div></div>
            </Space>
            <Divider />
            <Row gutter={[12,16]}>
              <Col span={12}><Text type="secondary" className="small">Department</Text><div><Text strong>{selectedPerson.department || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">Location</Text><div><Text strong>{selectedPerson.location || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">Email</Text><div><Text strong>{selectedPerson.email || "—"}</Text></div></Col>
              <Col span={12}><Text type="secondary" className="small">Time Zone</Text><div><Text strong>{selectedPerson.timezone || "—"}</Text></div></Col>
            </Row>
            <Divider />
            <Text type="secondary" className="small">Bio</Text>
            <Paragraph>{selectedPerson.bio || "No profile bio has been added."}</Paragraph>
            <Text type="secondary" className="small">Discipline</Text>
            <div className="profile-expertise">{expertise.length ? expertise.map(value=><Tag key={value}>{value}</Tag>) : <Text type="secondary">No areas of expertise have been added.</Text>}</div>
          </Card> : <Card className="panel-card"><Empty description="Select a person to view their profile" /></Card>}
        </Col>
      </Row>
    </div>;
  }

  function renderReviews() {
    const reviewItems=(bootstrap?.workItems || []).filter(item=>["discussion_review","waiting_requestor"].includes(item.status));
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">Pending Review</Text><Title level={2}>Architecture & ADR Reviews</Title><Paragraph type="secondary">Reviews are tied to specific artifact versions. Relevant specialists can submit feedback independently.</Paragraph></div></div>
      <Card className="panel-card"><List dataSource={reviewItems} renderItem={item=><List.Item actions={[<Button type="link" onClick={()=>void openWorkItem(item)}>Open Review</Button>]}><List.Item.Meta avatar={<Avatar icon={<AuditOutlined />} />} title={item.title} description={item.code+" · "+item.owner_name} /></List.Item>} locale={{emptyText:<Empty description="No work items are awaiting review" />}} /></Card>
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
      draft:"Complete the request package and submit it for review.",
      requestor_revision:"Revise the artifacts and resubmit.",
      discussion_review:"Await review feedback or the review deadline.",
      waiting_requestor:"Awaiting Requestor Response。",
      decision_meeting:"The meeting chair records the decision.",
      approved_pending_close:"The meeting chair or an administrator closes the work item.",
      rejected_pending_close:"The meeting chair or an administrator closes the work item.",
      closed:"Work ItemClosed。"
    };
    const nextAction=detail.workflow.activeClarification
      ? "Requestor response (due "+dateText(detail.workflow.activeClarification.response_due_at)+"）。"
      : (phaseAction[item.status] || "Continue based on current progress.");
    const requestPackage=(()=>{try{return JSON.parse(item.request_package_json || "{}") as Record<string,unknown>;}catch{return {};}})();
    const canSubmitRequest=item.requestor_id===actor;
    const packageReady=Boolean(String(requestPackage.goal || "").trim() && String(requestPackage.scope || "").trim() && String(requestPackage.decisionQuestions || "").trim() && String(requestPackage.submissionMessage || "").trim());
    const showArtifact=(artifact:Artifact)=>Modal.info({
      title:(artifact.code || artifact.type)+" · "+artifact.title+" · v"+artifact.version,
      width:960,
      content:<Suspense fallback={<div style={{padding:24,textAlign:"center"}}>Loading content renderer…</div>}>
        <div className="agent-artifact-content">
          {artifact.summary ? <MarkdownContent content={artifact.summary} /> : null}
          {artifact.content ? <MarkdownContent content={artifact.content} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No content" />}
        </div>
      </Suspense>
    });
    const taskExecutor=(task:WorkTask)=>{
      const run=detail.agentRuns.find(entry=>entry.task_id===task.id && ["running","queued","waiting_for_human"].includes(entry.status));
      if (run) {
        const profile=agentProfiles.find(entry=>entry.key===run.agent_key);
        return <Space direction="vertical" size={0}><Text>{profile?.name || run.agent_key}</Text><Text type="secondary" className="small">{run.claimed_by_name ? "Execution identity: "+run.claimed_by_name : statusLabels[run.status] || run.status}</Text></Space>;
      }
      return task.assignee_name || "Unassigned";
    };
    return <div className="detail-body work-item-workspace">
      <div className="detail-topline">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={closeItemDrawer}>All Work Items</Button>
        <Breadcrumb items={[{title:"All Work Items"},{title:item.code}]} />
      </div>
      <div className="detail-heading">
        <div className="workspace-title">
          <Space wrap><Text type="secondary">{item.code}</Text><Tag color={statusColors[item.status]}>{statusLabels[item.status] || item.status}</Tag></Space>
          <Title level={2}>{item.title}</Title>
          <Paragraph type="secondary">{item.description || "No work item description has been provided."}</Paragraph>
        </div>
        <Space wrap>
          {permissions.includes("contribute") && <Button icon={<PlusOutlined />} onClick={()=>setArtifactOpen(true)}>Add Architecture Artifacts</Button>}
          {canSubmitRequest && ["draft","requestor_revision"].includes(item.status) && <Button onClick={()=>{packageForm.setFieldsValue({...requestPackage});setPackageOpen(true);}}>{packageReady?"Edit Request Package":"Complete Request Package"}</Button>}
          {canSubmitRequest && detail.workflow.availableActions.includes("submit_request") && packageReady && <Button type="primary" onClick={()=>void transitionWorkflow("submit_request",{submissionMessage:String(requestPackage.submissionMessage),package:requestPackage,assistedByRunId:requestPackage.assistedByRunId ? String(requestPackage.assistedByRunId) : undefined})}>Submit for Review</Button>}
          {detail.workflow.availableActions.includes("record_decision") && <Button type="primary" onClick={()=>{decisionForm.resetFields();decisionForm.setFieldsValue({outcome:"approved"});setDecisionOpen(true);}}>Record Decision Meeting Outcome</Button>}
        </Space>
      </div>

      <Card className="workspace-summary" size="small">
        <Row gutter={[20,12]}>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">Current Stage</Text><div><Text strong>{statusLabels[item.status] || item.status}</Text></div></Col>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">Work ItemOwner</Text><div><Text strong>{item.owner_name}</Text></div></Col>
          <Col xs={12} md={5}><Text type="secondary" className="workflow-label">{detail.workflow.reviewDeadlineAt ? "Review Deadline" : "Meeting Chair"}</Text><div><Text strong>{detail.workflow.reviewDeadlineAt ? dayjs(detail.workflow.reviewDeadlineAt).format("YYYY-MM-DD HH:mm") : (detail.participants.find(p=>p.person_id===detail.workflow.chairmanId)?.display_name || "Not assigned")}</Text></div></Col>
          <Col xs={24} md={9}><Text type="secondary" className="workflow-label">Next Step</Text><div><Text strong>{nextAction}</Text></div></Col>
        </Row>
      </Card>
      <Card size="small" title="Request Details" className="workspace-section">
        <Row gutter={[20,12]}>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">Business Objective</Text><Paragraph>{String(requestPackage.goal || item.description || "Not provided")}</Paragraph></Col>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">Scope</Text><Paragraph>{String(requestPackage.scope || "Not provided")}</Paragraph></Col>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">Constraints & Risks</Text><Paragraph>{String(requestPackage.constraints || "Not provided")}</Paragraph></Col>
          <Col xs={24} md={12}><Text type="secondary" className="workflow-label">Initial Proposal</Text><Paragraph>{String(requestPackage.initialProposal || "Not provided")}</Paragraph></Col>
          <Col xs={24}><Text type="secondary" className="workflow-label">Questions Requiring a Decision</Text><Paragraph>{String(requestPackage.decisionQuestions || "Not provided")}</Paragraph></Col>
        </Row>
        {requestPackage.submissionMessage ? <Text type="secondary" className="small">Submission note: {String(requestPackage.submissionMessage)}</Text> : null}
      </Card>

      <Card className="workflow-card" size="small" title="Work Item Progress">
        <Steps current={detail.workflow.currentStep} status={detail.workflow.visualStatus} items={detail.workflow.steps} />
        <Space wrap className="workflow-actions">
          {detail.workflow.availableActions.includes("close") && <Button type="primary" onClick={()=>void transitionWorkflow("close")}>Close Work Item</Button>}
        </Space>
        {detail.workflow.activeClarification && <Alert type="warning" showIcon message="Awaiting Requestor Response" description={<>{detail.workflow.activeClarification.question}<div className="small muted">Response due: {dayjs(detail.workflow.activeClarification.response_due_at).format("YYYY-MM-DD HH:mm")}</div></>} action={canSubmitRequest?<Button size="small" onClick={()=>{clarificationForm.resetFields();setClarificationOpen(true);}}>Respond to Clarification</Button>:null} />}
        {detail.workflow.status==="decision_meeting" && <Alert type="info" showIcon message="Decision meeting started" description={"Assigned meeting chair: "+(detail.participants.find(p=>p.person_id===detail.workflow.chairmanId)?.display_name || "Not assigned")+". A review deadline or blocking objection does not automatically approve or reject the request."}/>}
        {detail.workflow.status==="approved_pending_close" || detail.workflow.status==="rejected_pending_close" ? <Alert type="warning" showIcon message="Decision recorded; awaiting manual closure" description="Only the assigned meeting chair or an administrator can close this work item."/> : null}
        {detail.workflow.history.length>0 && <details className="workspace-disclosure">
          <summary>View workflow history（{detail.workflow.history.length}）</summary>
          <Timeline items={detail.workflow.history.map(entry=>({children:<><Text strong>{entry.actor_name}</Text><div>{statusLabels[entry.from_status] || entry.from_status} → {statusLabels[entry.to_status] || entry.to_status}</div><Text type="secondary" className="small">{dateText(entry.created_at)} · {entry.reason || entry.action}</Text></>}))} />
        </details>}
      </Card>

      <Card size="small" title="Task" className="workspace-section" extra={permissions.includes("contribute")?<Button size="small" icon={<PlusOutlined />} onClick={()=>{setEditingTaskId(null);taskForm.resetFields();taskForm.setFieldsValue({ownerId:item.owner_id,assigneeId:detail.participants.some(person=>person.person_id===actor)?actor:undefined});setTaskOpen(true);}}>Add Task</Button>:null}>
        {detail.tasks.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tasks have been assigned" /> : (() => {
          const groups=[
            {key:"in_progress",label:"In Progress"},
            {key:"open",label:"Not Started"},
            {key:"blocked",label:"Needs Coordination"},
            {key:"done",label:"Completed"}
          ];
          return <div className="work-progress-groups">{groups.map(group=>{
            const rows=detail.tasks.filter(task=>task.status===group.key);
            if(!rows.length) return null;
            return <section className="work-progress-group" key={group.key}>
              <div className="work-progress-heading"><Text strong>{group.label}</Text><Text type="secondary" className="small">{rows.length}</Text></div>
              <List size="small" dataSource={rows} renderItem={task=><List.Item
                actions={[
                  <Select key="status" size="small" value={task.status} disabled={!permissions.includes("contribute") && task.assignee_id!==actor && task.owner_id!==actor} style={{width:112}} onChange={status=>void updateTask(task.id,status)} options={[{value:"open",label:"Not Started"},{value:"in_progress",label:"In Progress"},{value:"blocked",label:"Needs Coordination"},{value:"done",label:"Completed"},{value:"cancelled",label:"Cancel"}]} />,
                  permissions.includes("contribute")?<Button key="edit" size="small" type="link" icon={<EditOutlined />} onClick={()=>editTaskAssignment(task)}>Edit</Button>:null
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={<Space wrap><Text strong>{task.title}</Text><Tag>{taskKindLabels[task.kind] || task.kind}</Tag></Space>}
                  description={<Space wrap size={[12,4]}><Text type="secondary" className="small">Owner: {task.owner_name || item.owner_name}</Text><Text type="secondary" className="small">Assignee: {taskExecutor(task)}</Text>{task.due_date?<Text type="secondary" className="small">Due: {dateText(task.due_date)}</Text>:null}</Space>}
                />
              </List.Item>} />
            </section>;
          })}</div>;
        })()}
      </Card>

      <Card size="small" title={"Linked Resources · "+detail.externalLinks.length} className="workspace-section" extra={permissions.includes("contribute")?<Button size="small" icon={<LinkOutlined />} onClick={()=>void openExternalLinkDialog()}>Add External Resource</Button>:null}>
        <Paragraph type="secondary" className="small">Original artifacts remain in Jira, Confluence, GitHub, and LeanIX; only references are stored here.</Paragraph>
        {detail.externalLinks.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No external resources linked" /> :
          <List size="small" dataSource={detail.externalLinks} renderItem={link=><List.Item actions={[link.url?<a key="open" href={link.url} target="_blank" rel="noreferrer">Open</a>:null,permissions.includes("contribute")?<Button key="remove" type="link" danger size="small" onClick={()=>void removeExternalLink(link.id)}>Remove</Button>:null].filter(Boolean)}>
            <List.Item.Meta
              title={<Space wrap><Tag color={link.provider==="jira"?"blue":link.provider==="confluence"?"purple":link.provider==="github"?"default":"cyan"}>{link.provider.toUpperCase()}</Tag><Text strong>{link.external_key || link.title}</Text></Space>}
              description={<>{link.title}{link.relation_type && link.relation_type!=="related_to"?" · "+(relationTypeLabels[link.relation_type] || link.relation_type):""}</>}
            />
          </List.Item>} />
        }
      </Card>

      <Card size="small" title={"Related Technical Debt · "+detail.relatedDebts.length} className="workspace-section">
        {detail.relatedDebts.length===0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No related technical debt" /> : <List size="small" dataSource={detail.relatedDebts} renderItem={debt=><List.Item actions={[<Button key="open" type="link" onClick={()=>void openRelatedDebt(debt.id)}>View</Button>]}>
          <List.Item.Meta
            title={<Space wrap><Text strong>{debt.code} · {debt.title}</Text><Tag color={debt.severity==="high"?"error":debt.severity==="medium"?"warning":"default"}>{debt.severity==="high"?"High Severity":debt.severity==="medium"?"Medium Severity":"Low Severity"}</Tag><Tag color={debt.debt_status==="resolved"?"success":debt.debt_status==="in_progress"?"processing":"default"}>{debt.debt_status==="resolved"?"Resolved":debt.debt_status==="in_progress"?"In Progress":debt.debt_status==="deferred"?"Deferred":"Open"}</Tag></Space>}
            description={<Space wrap><Text type="secondary" className="small">Owner: {debt.owner_name}</Text>{debt.target_date?<Text type="secondary" className="small">Due: {dateText(debt.target_date)}</Text>:null}<Text type="secondary" className="small">Priority: {debt.priority}</Text></Space>}
          />
        </List.Item>} />}
      </Card>
      
      <Card size="small" title="Discussion" className="workspace-section">
        <Space.Compact block><Input value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Add facts, ask a question, or respond to the discussion..." onPressEnter={()=>void submitComment()} /><Button type="primary" onClick={()=>void submitComment()}>Send</Button></Space.Compact>
        <List className="comment-list" dataSource={detail.comments} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No discussion yet" />}} renderItem={(comment:Comment)=><List.Item>
          <List.Item.Meta avatar={<Avatar style={{background:comment.avatar_color}}>{comment.author_name.slice(0,1)}</Avatar>} title={<Space><Text strong>{comment.author_name}</Text><Text type="secondary" className="small">{dateText(comment.created_at)}</Text></Space>} description={comment.body} />
        </List.Item>} />
      </Card>

      <details className="advanced-information">
        <summary>More Details <Text type="secondary">Participants, reviews, decisions, attachments, and analysis records</Text></summary>
        <div className="advanced-grid">
          <Card size="small" title={"Participant · "+detail.participants.length}>
            <div className="participant-grid participant-grid-managed">
              {detail.participants.map(participant=><div className="participant" key={participant.id}>
                <Avatar style={{background:participant.avatar_color}}>{participant.display_name.slice(0,1)}</Avatar>
                <div className="participant-main"><Text strong>{participant.display_name}</Text><div><Tag color={roleColors[participant.role_key] || "default"}>{participant.role_label}</Tag>{participant.person_id===item.requestor_id?<Tag>Requestor</Tag>:null}</div><Text type="secondary" className="small">{participant.title}{participant.department?" · "+participant.department:""}</Text></div>
                {detail.canManageParticipants?<Space size={0}><Button type="text" size="small" icon={<EditOutlined />} title="Edit role and permissions" onClick={()=>openParticipantDialog(participant)} />{participant.person_id!==item.requestor_id && participant.person_id!==item.owner_id?<Button type="text" danger size="small" icon={<DeleteOutlined />} title="Remove" onClick={()=>Modal.confirm({title:"Remove this participant?",content:"Existing reviews and activity records will be retained.",onOk:()=>removeParticipant(participant)})} />:null}</Space>:null}
              </div>)}
            </div>
            {detail.canManageParticipants?<Button size="small" icon={<UserAddOutlined />} onClick={()=>openParticipantDialog()}>Add Participant</Button>:null}
          </Card>

          <Card size="small" title={"Review History · "+detail.reviews.length}>
            <Text type="secondary" className="small">{currentCycle ? currentCycle.name+" · Artifacts in this review cycle" : "Review has not started"}</Text>
            {permissions.includes("review") && currentCycle?.status==="active" && item.status==="discussion_review" ? <Button size="small" icon={<PlusOutlined />} onClick={()=>{reviewForm.resetFields();reviewForm.setFieldsValue({artifactId:reviewableArtifacts[0]?.id || "__request_package__",outcome:"comment",discipline:actorPerson?.title || "General Review"});setReviewOpen(true);}}>Submit Review</Button>:null}
            <List size="small" dataSource={detail.reviews} locale={{emptyText:"No reviews yet"}} renderItem={(review:Review)=><List.Item><List.Item.Meta title={<Space wrap><Text strong>{review.reviewer_name}</Text><Tag>{review.discipline}</Tag><Tag color={review.outcome==="objection"?"error":review.outcome==="clarification_requested"?"warning":"default"}>{statusLabels[review.outcome] || review.outcome}</Tag></Space>} description={<>{review.summary}<div className="small muted">{review.artifact_code || review.artifact_title} · v{review.artifact_version} · {dateText(review.created_at)}</div></>} /></List.Item>} />
          </Card>

          <Card size="small" title={"Clarification History · "+detail.clarifications.length}>
            <List size="small" dataSource={detail.clarifications} locale={{emptyText:"No clarification requests"}} renderItem={clarification=><List.Item><List.Item.Meta title={<Space wrap><Text strong>{clarification.question}</Text><Tag color={clarification.status==="answered"?"success":clarification.status==="unanswered"?"error":"warning"}>{clarification.status==="answered"?"Answered":clarification.status==="unanswered"?"Unanswered":clarification.status==="requested"?"Awaiting Response":"Cancelled"}</Tag></Space>} description={<>{clarification.requester_name} · {clarification.artifact_title || "Request Package"} · Due {dateText(clarification.response_due_at)}{clarification.answer?<div className="small muted">Response: {clarification.answer}</div>:null}</>} /></List.Item>} />
          </Card>

          <Card size="small" title={"Formal Decisions · "+detail.decisions.length}>
            <List size="small" dataSource={detail.decisions} locale={{emptyText:"No formal decisions"}} renderItem={decision=><List.Item><List.Item.Meta title={<Space><Tag color={statusColors[decision.outcome]}>{statusLabels[decision.outcome] || decision.outcome}</Tag><Text strong>{decision.decision_maker_name}</Text></Space>} description={<>{decision.rationale}{decision.conditions?<div className="small muted">Conditions: {decision.conditions}</div>:null}<div className="small muted">{dateText(decision.created_at)}</div></>} /></List.Item>} />
          </Card>
          <Card size="small" title={"Decision Meeting Minutes · "+detail.decisionMeetings.length}>
            <List size="small" dataSource={detail.decisionMeetings} locale={{emptyText:"No decision meetings"}} renderItem={meeting=><List.Item><List.Item.Meta title={<Space wrap><Tag color={statusColors[meeting.outcome]}>{statusLabels[meeting.outcome] || meeting.outcome}</Tag><Text strong>{meeting.chairman_name}</Text><Text type="secondary">{dayjs(meeting.meeting_at).format("YYYY-MM-DD HH:mm")}</Text></Space>} description={<>{meeting.rationale}{meeting.minutes?<div className="small muted">Minutes: {meeting.minutes}</div>:null}</>} /></List.Item>} />
          </Card>

          <Card size="small" title={"Attachments · "+detail.attachments.length}>
            <List size="small" dataSource={detail.attachments} locale={{emptyText:"No attachments"}} renderItem={attachment=><List.Item><List.Item.Meta title={attachment.original_name} description={dateText(attachment.created_at)} /></List.Item>} />
          </Card>

          <Card size="small" title="Agent Analysis History" className="advanced-agent-card">
            {permissions.includes("contribute")?<Button size="small" onClick={openAgentPlanDialog}>Start Analysis</Button>:null}
            <List size="small" dataSource={detail.agentPlans} locale={{emptyText:"No multi-role analysis plans"}} renderItem={plan=><List.Item>
              <List.Item.Meta title={<Space wrap><Text strong>{plan.name}</Text><Tag color={statusColors[plan.status] || "default"}>{statusLabels[plan.status] || plan.status}</Tag></Space>} description={<>{plan.objective}<div className="small muted">Completed {plan.nodes.filter(node=>node.status==="completed").length}/{plan.nodes.length}  role analyses</div></>} />
              {plan.result_artifact_id?<Button type="link" size="small" onClick={()=>{const artifact=detail.artifacts.find(entry=>entry.id===plan.result_artifact_id);if(artifact)showArtifact(artifact);}}>View Draft</Button>:null}
            </List.Item>} />
            <List size="small" dataSource={detail.agentRuns} locale={{emptyText:"No Agent runs"}} renderItem={run=><List.Item>
              <List.Item.Meta title={<Space wrap><Text strong>{agentProfiles.find(profile=>profile.key===run.agent_key)?.name || run.agent_key}</Text><Tag color={statusColors[run.status] || "default"}>{statusLabels[run.status] || run.status}</Tag></Space>} description={<>{run.objective}<div className="small muted">Requestor：{run.requested_by_name} · {dateText(run.created_at)}</div>{run.handoff_reason?<Text type="warning">Waiting for input: {run.handoff_reason}</Text>:null}{run.error_message?<Text type="danger">Failed: {run.error_message}</Text>:null}</>} />
              {run.result_artifact_id?<Button type="link" size="small" onClick={()=>{const artifact=detail.artifacts.find(entry=>entry.id===run.result_artifact_id);if(artifact)showArtifact(artifact);}}>View Artifacts</Button>:null}
              {run.status==="waiting_for_human" && (run.requested_by===actor || item.requestor_id===actor || actorPerson?.is_admin===1)?<Button type="link" size="small" onClick={()=>openAgentResumeDialog(run)}>Provide Additional Context</Button>:null}
            </List.Item>} />
            <Button type="link" size="small" onClick={async()=>{const capsule=await api.contextCapsule(item.id);await navigator.clipboard.writeText(JSON.stringify(capsule,null,2));message.success("Work item context copied");}}>Copy Work Item Context</Button>
          </Card>

          <Card size="small" title="Activity & Workflow History">
            <Timeline items={detail.activity.map((entry:Activity)=>({children:<><Text strong>{entry.actor_name}</Text><div>{entry.summary}</div><Text type="secondary" className="small">{dateText(entry.created_at)}</Text></>}))} />
          </Card>
        </div>
      </details>
    </div>;
  }

  return <Layout className="app-shell">
    <Sider width={238} theme="light" className="app-sider" breakpoint="sm" collapsedWidth={72}>
      <div className="brand"><div className="brand-mark">A</div><div><Text strong>Architecture</Text><div><Text type="secondary" className="small">Workbench</Text></div></div></div>
      <div className="workspace-label">Workspace</div>
      <Menu mode="inline" selectedKeys={[page]} items={menuItems} onClick={e=>navigatePage(e.key)} />
      <div className="sider-footer"><div className="sider-version">Prototype · 0.1.0</div></div>
    </Sider>
    <Layout>
      <Header className="app-header"><div><Text type="secondary">Workbench / </Text><Text strong>{menuItems.find(m=>m.key===page)?.label || (page==="people"?"People Directory":"Business Work Items")}</Text></div><Space><Button type="text" onClick={()=>navigatePage("people")}>People Directory</Button><Text type="secondary" className="small">Demo Identity</Text><Select value={actor} onChange={setActorState} style={{width:220}} options={(bootstrap?.people || []).map((p:Person)=>({value:p.id,label:p.display_name+" · "+p.title}))} /><Avatar style={{background:actorPerson?.avatar_color}}>{actorPerson?.display_name.slice(0,1)}</Avatar></Space></Header>
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
    <Modal title="New Work Item" open={newItemOpen} onCancel={()=>setNewItemOpen(false)} onOk={()=>void submitForm(newItemForm,async()=>{const v=newItemForm.getFieldsValue();if(v.targetDate)v.targetDate=v.targetDate.format("YYYY-MM-DD");return api.createWorkItem(v);},"Work item created",()=>setNewItemOpen(false))} confirmLoading={busy} width={640}>
      <Form form={newItemForm} layout="vertical" initialValues={{type:"architecture_review",priority:"normal"}}>
        <Form.Item name="title" label="Work Item Name" rules={[{required:true}]}><Input placeholder="e.g. Customer Identity Platform Architecture Assessment" /></Form.Item>
        <Form.Item name="type" label="Work ItemType"><Select options={[{value:"architecture_review",label:"Architecture Review"},{value:"solution_assessment",label:"Solution Assessment"},{value:"change_assessment",label:"Change Assessment"},{value:"risk_assessment",label:"Risk Assessment"},{value:"other",label:"Other"}]} /></Form.Item>
        <Form.Item name="description" label="Background" rules={[{required:true}]}><TextArea rows={4} /></Form.Item>
        <Form.Item name="chairmanId" label="Meeting Chair" rules={[{required:true,message:"Select a meeting chair"}]}><Select showSearch optionFilterProp="label" options={(bootstrap?.people || []).filter(p=>p.id!==actor).map(p=>({value:p.id,label:p.display_name+" · "+p.title}))} /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="priority" label="Priority"><Select options={[{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"}]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="targetDate" label="Target Date"><DatePicker style={{width:"100%"}} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>

    <Modal title="Edit Request Package" open={packageOpen} onCancel={()=>setPackageOpen(false)} onOk={()=>void submitForm(packageForm,async()=>api.updateRequestPackage(selected!.id,packageForm.getFieldsValue()),"Request package saved",()=>setPackageOpen(false))} confirmLoading={busy} width={720}>
      <Form form={packageForm} layout="vertical">
        <Form.Item name="goal" label="Expected Outcome"><TextArea rows={2}/></Form.Item>
        <Form.Item name="scope" label="Scope"><TextArea rows={2}/></Form.Item>
        <Form.Item name="constraints" label="Constraints and Key Risks"><TextArea rows={2}/></Form.Item>
        <Form.Item name="initialProposal" label="Initial Proposal (Optional)"><TextArea rows={3}/></Form.Item>
        <Form.Item name="decisionQuestions" label="Questions for the Owner to Decide"><TextArea rows={2}/></Form.Item>
        <Form.Item name="submissionMessage" label="Submission Note"><Input/></Form.Item>
        <Text type="secondary" className="small">You do not need to complete every field to save a draft. Before submitting for review, provide the expected outcome, scope, decision questions, and submission note.</Text>
               </Form>
    </Modal>

    <Modal title="Add Architecture Artifacts / ADR" open={artifactOpen} onCancel={()=>setArtifactOpen(false)} onOk={()=>void submitForm(artifactForm,async()=>api.createArtifact(selected!.id,artifactForm.getFieldsValue()),"Artifact saved",()=>setArtifactOpen(false))} confirmLoading={busy} width={720}>
      <Form form={artifactForm} layout="vertical" initialValues={{type:"ADR",status:"proposed"}}>
        <Row gutter={12}><Col span={8}><Form.Item name="type" label="Type"><Select options={[{value:"ADR",label:"ADR"},{value:"Architecture Overview",label:"Architecture Proposal"},{value:"Architecture Diagram",label:"Architecture Diagram"},{value:"Evidence",label:"Evidence"}]} /></Form.Item></Col><Col span={8}><Form.Item name="code" label="ID"><Input placeholder="ADR-004" /></Form.Item></Col><Col span={8}><Form.Item name="status" label="Status"><Select options={[{value:"draft",label:"Draft"},{value:"proposed",label:"Proposed"},{value:"submitted",label:"Submitted"}]} /></Form.Item></Col></Row>
        <Form.Item name="title" label="Title" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="summary" label="Summary"><TextArea rows={2} /></Form.Item>
        <Form.Item name="content" label="Content / Decision Record" rules={[{required:true}]}><TextArea rows={9} placeholder="Context, decision drivers, alternatives, decision, and consequences..." /></Form.Item>
      </Form>
    </Modal>

    <Modal title="Submit Review" open={reviewOpen} onCancel={()=>setReviewOpen(false)} onOk={()=>void submitForm(reviewForm,async()=>{
      const value=reviewForm.getFieldsValue();
      if(value.responseDueAt) value.responseDueAt=value.responseDueAt.toISOString();
      return api.createReview(selected!.id,value);
    },"Review submitted",()=>setReviewOpen(false))} confirmLoading={busy}>
      <Form form={reviewForm} layout="vertical">
        <Form.Item name="artifactId" label="Review Target"><Select options={[{value:"__request_package__",label:"Entire Request Package"},...(detail?.cycles[0] ? (JSON.parse(detail.cycles[0].baseline_json) as {id:string;version:number}[]).map(entry=>detail.artifacts.find(a=>a.id===entry.id && a.version===entry.version)).filter(Boolean).map(a=>({value:(a as Artifact).id,label:((a as Artifact).code || (a as Artifact).type)+" · "+(a as Artifact).title+" v"+(a as Artifact).version})) : [])]} /></Form.Item>
        <Form.Item name="discipline" label="Discipline" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="outcome" label="Action" rules={[{required:true}]}><Select options={[{value:"comment",label:"Comment (does not change workflow)"},{value:"clarification_requested",label:"Request clarification (pauses the review timer)"},{value:"objection",label:"Raise a blocking objection (starts the decision meeting early)"}]} /></Form.Item>
        <Form.Item name="summary" label="Review Comment / Clarification Question" rules={[{required:true}]}><TextArea rows={4} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="clarification_requested" ? <Form.Item name="responseDueAt" label="Requestor Response Deadline" rules={[{required:true,message:"Set a response deadline"}]}><DatePicker showTime style={{width:"100%"}} /></Form.Item> : null}</Form.Item>
      </Form>
    </Modal>

    <Modal title="Respond to Clarification" open={clarificationOpen} onCancel={()=>setClarificationOpen(false)} onOk={()=>void submitForm(clarificationForm,async()=>api.answerClarification(selected!.id,detail!.workflow.activeClarification!.id,String(clarificationForm.getFieldValue("answer") || "")),"Clarification response submitted",()=>setClarificationOpen(false))} confirmLoading={busy}>
      <Form form={clarificationForm} layout="vertical">
        <Form.Item name="answer" label="Response" rules={[{required:true}]}><TextArea rows={5} maxLength={8000} showCount /></Form.Item>
      </Form>
    </Modal>

    <Modal title={editingTaskId ? "Edit Task" : "Add Task"} open={taskOpen} onCancel={()=>{setTaskOpen(false);setEditingTaskId(null);taskForm.resetFields();}} onOk={()=>void submitForm(taskForm,async()=>{
      const v=taskForm.getFieldsValue();
      if(v.dueDate) v.dueDate=v.dueDate.format("YYYY-MM-DD");
      if(editingTaskId) {
        if(v.assigneeId===undefined) v.assigneeId=null;
        if(v.dueDate===undefined) v.dueDate=null;
        return api.updateTask(editingTaskId,v);
      }
      return api.createTask(selected!.id,v);
    },editingTaskId?"Task updated":"Task added",()=>{setTaskOpen(false);setEditingTaskId(null);})} confirmLoading={busy}>
      <Form form={taskForm} layout="vertical">
        <Form.Item name="title" label="Work Description" rules={[{required:true}]}><Input disabled={Boolean(editingTaskId)} /></Form.Item>
        <Form.Item name="kind" label="TaskType"><Select disabled={Boolean(editingTaskId)} options={[{value:"analysis",label:"Analysis"},{value:"revision",label:"Artifact Revision"},{value:"follow_up",label:"Follow-up Remediation"},{value:"decision_prep",label:"Decision Preparation"}]} /></Form.Item>
        <Form.Item name="ownerId" label="TaskOwner" rules={[{required:true}]}><Select options={(detail?.participants || []).map(p=>({value:p.person_id,label:p.display_name+" · "+p.role_label}))} /></Form.Item>
        <Form.Item name="assigneeId" label="Assignee"><Select allowClear options={(detail?.participants || []).map(p=>({value:p.person_id,label:p.display_name+" · "+p.role_label}))} /></Form.Item>
        <Form.Item name="dueDate" label="Due Date"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="Agent Analysis" open={agentPlanOpen} onCancel={()=>setAgentPlanOpen(false)} onOk={()=>void submitForm(agentPlanForm,async()=>{
      const value=agentPlanForm.getFieldsValue();
      if(!String(value.name || "").trim() || !String(value.objective || "").trim() || !Array.isArray(value.agentKeys) || value.agentKeys.length===0) throw new Error("Enter an analysis name and objective, and select at least one role.");
      const nodes=(value.agentKeys as string[]).map(agentKey=>({
        key:agentKey,
        agentKey,
        objective:value.objective
      }));
      return api.requestAgentPlan(selected!.id,{name:value.name,objective:value.objective,taskId:value.taskId,nodes});
    },"Analysis plan created",()=>setAgentPlanOpen(false))} confirmLoading={busy} width={760}>
             <Form form={agentPlanForm} layout="vertical">
        <Form.Item name="name" label="Analysis Name" rules={[{required:true}]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="agentKeys" label="Participating Roles" rules={[{required:true,message:"Select at least one role"}]}><Select mode="multiple" options={agentProfiles.filter(profile=>profile.key!=="decision-analyst").map(profile=>({value:profile.key,label:profile.name+" · "+profile.description}))} /></Form.Item>
        <Form.Item name="taskId" label="Related Task (Optional)"><Select allowClear options={detail?.tasks.filter(task=>!["done","cancelled"].includes(task.status)).map(task=>({value:task.id,label:task.title})) || []} /></Form.Item>
        <Form.Item name="objective" label="Analysis Objective" rules={[{required:true}]}><TextArea rows={5} maxLength={4000} showCount /></Form.Item>
      </Form>
    </Modal>

    <Modal title="Resume Agent Analysis" open={agentResumeOpen} onCancel={()=>{setAgentResumeOpen(false);setAgentResumeRunId(null);}} onOk={()=>void submitForm(agentResumeForm,async()=>api.resumeAgentRun(agentResumeRunId!,String(agentResumeForm.getFieldValue("additionalContext") || "")),"Agent task queued for retry",()=>{setAgentResumeOpen(false);setAgentResumeRunId(null);})} confirmLoading={busy}>
      <Alert type="info" showIcon message="The Agent will resume the original task after you provide additional context." className="modal-alert" />
      <Form form={agentResumeForm} layout="vertical"><Form.Item name="additionalContext" label="Additional Context / Response to Agent Questions"><TextArea rows={5} maxLength={8000} showCount placeholder="Provide facts, constraints, or directions for adjustment." /></Form.Item></Form>
    </Modal>

    <Modal title="Record Decision Meeting Outcome" open={decisionOpen} onCancel={()=>setDecisionOpen(false)} onOk={()=>void submitForm(decisionForm,async()=>{
      const value=decisionForm.getFieldsValue();
      if(value.meetingAt) value.meetingAt=value.meetingAt.toISOString();
      if(value.technicalDebt?.dueDate) value.technicalDebt.dueDate=value.technicalDebt.dueDate.format("YYYY-MM-DD");
      if(!value.createTechnicalDebt) delete value.technicalDebt;
      delete value.createTechnicalDebt;
      return api.createDecision(selected!.id,value);
    },"Decision meeting outcome recorded",()=>setDecisionOpen(false))} confirmLoading={busy} width={720}>
      <Alert type="warning" showIcon message="Only the meeting chair or an administrator can record a formal outcome." className="modal-alert" />
      <Form form={decisionForm} layout="vertical" initialValues={{outcome:"approved",createTechnicalDebt:false}}>
        <Form.Item name="meetingAt" label="Meeting Time"><DatePicker showTime style={{width:"100%"}} /></Form.Item>
        <Form.Item name="outcome" label="Formal Outcome" rules={[{required:true}]}><Select options={[{value:"approved",label:"Approve"},{value:"needs_work",label:"Request Changes"},{value:"rejected",label:"Reject"}]} /></Form.Item>
        <Form.Item name="rationale" label="Decision Rationale" rules={[{required:true}]}><TextArea rows={3} /></Form.Item>
        <Form.Item name="conditions" label="Approval Conditions / Follow-up Constraints"><TextArea rows={2} /></Form.Item>
        <Form.Item name="minutes" label="Meeting Minutes"><TextArea rows={4} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="approved"?<>
          <Divider titlePlacement="start">Technical Debt Requiring Long-term Tracking (Optional)</Divider>
          <Form.Item name="createTechnicalDebt" valuePropName="checked"><Checkbox>Register technical debt requiring long-term tracking separately</Checkbox></Form.Item>
          {getFieldValue("createTechnicalDebt")?<>
            <Form.Item name={["technicalDebt","title"]} label="Technical DebtTitle" rules={[{required:true}]}><Input/></Form.Item>
            <Form.Item name={["technicalDebt","description"]} label="Origin and Rationale"><TextArea rows={2}/></Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name={["technicalDebt","ownerId"]} label="Responsible"><Select options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))}/></Form.Item></Col>
              <Col span={12}><Form.Item name={["technicalDebt","severity"]} label="Severity"><Select options={[{value:"low",label:"Low"},{value:"medium",label:"Medium"},{value:"high",label:"High"}]}/></Form.Item></Col>
            </Row>
            <Form.Item name={["technicalDebt","targetState"]} label="Target Status"><Input/></Form.Item>
            <Form.Item name={["technicalDebt","remediationPlan"]} label="Remediation Plan"><TextArea rows={2}/></Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name={["technicalDebt","priority"]} label="Priority"><Select options={[{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"}]}/></Form.Item></Col>
              <Col span={12}><Form.Item name={["technicalDebt","dueDate"]} label="Target Completion Date"><DatePicker style={{width:"100%"}}/></Form.Item></Col>
            </Row>
          </>:null}
        </>:null}</Form.Item>
      </Form>
    </Modal>

    <Modal title="Add External Resource" open={externalLinkOpen} onCancel={()=>setExternalLinkOpen(false)} onOk={()=>void submitForm(externalLinkForm,async()=>{
      const value=externalLinkForm.getFieldsValue();
      if(value.existingResourceId) {
        return api.addExternalLink(selected!.id,{resourceId:value.existingResourceId,relationType:value.relationType,templateKey:value.templateKey,templateName:value.templateName});
      }
      delete value.existingResourceId;
      return api.addExternalLink(selected!.id,value);
    },"External resource added",()=>setExternalLinkOpen(false))} confirmLoading={busy} width={760}>
      <Alert type="info" showIcon message="This form records external resource references only; it does not read source-system content." description="A registered resource can be linked to multiple work items. For a new resource, provide its ID, key, and URL." className="modal-alert" />
      <Form form={externalLinkForm} layout="vertical">
        <Form.Item name="existingResourceId" label="Select a Registered External Resource (Optional)">
          <Select allowClear showSearch optionFilterProp="label" placeholder="Search registered resources" options={externalReferences.map(r=>({value:r.id,label:r.provider.toUpperCase()+" · "+(r.external_key || r.external_id)+" · "+r.title}))} />
        </Form.Item>
        <Text type="secondary" className="small">Only resources already registered in the Workbench are shown.</Text>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>{
          const chosen=externalReferences.find(r=>r.id===getFieldValue("existingResourceId"));
          if (chosen) return <>
            <Alert type="success" showIcon message="Existing reference selected" description={chosen.provider.toUpperCase()+" · "+chosen.resource_type+" · "+(chosen.external_key || chosen.external_id)+" · "+chosen.title} />
            {chosen.provider==="confluence" && chosen.resource_type==="Page"?<>
              <Divider titlePlacement="start">Confluence Page Template</Divider>
              <Form.Item name="templateKey" label="Template Key / ID" rules={[{required:true,message:"Enter the template identifier used by this page"}]}><Input placeholder="e.g. architecture-decision-record" /></Form.Item>
              <Form.Item name="templateName" label="Template Name"><Input placeholder="e.g. Architecture Decision Record" /></Form.Item>
              <Text type="secondary" className="small">Only the template identifier is stored.</Text>
            </>:null}
          </>;
          return <>
            <Divider titlePlacement="start">Add a New External Resource</Divider>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="provider" label="External System" rules={[{required:true}]}><Select options={[{value:"jira",label:"Jira"},{value:"confluence",label:"Confluence"},{value:"github",label:"GitHub"},{value:"leanix",label:"LeanIX"}]} onChange={value=>externalLinkForm.setFieldsValue({resourceType:value==="jira"?"Story":value==="confluence"?"Page":value==="github"?"Repository":"Application",externalId:undefined,externalKey:undefined,title:undefined,url:undefined,templateKey:undefined,templateName:undefined})} /></Form.Item></Col>
              <Col span={12}><Form.Item name="resourceType" label="Resource Type" dependencies={["provider"]} rules={[{required:true}]}><Select options={(externalLinkForm.getFieldValue("provider")==="jira"?["Story","Epic","Task","Bug"]:externalLinkForm.getFieldValue("provider")==="confluence"?["Page"]:externalLinkForm.getFieldValue("provider")==="github"?["Repository","PullRequest","Issue","Commit"]:["Application","Interface","ITComponent","DataObject","BusinessCapability","Provider","Project"]).map(value=>({value,label:value}))} /></Form.Item></Col>
            </Row>
            <Row gutter={12}><Col span={12}><Form.Item name="externalId" label="External Resource ID" rules={[{required:true}]}><Input placeholder="Jira issue ID / Confluence Page ID / LeanIX Fact Sheet ID" /></Form.Item></Col><Col span={12}><Form.Item name="externalKey" label="Business Key / Identifier"><Input placeholder="DATA-412 / APP-CRM-001 / owner/repository" /></Form.Item></Col></Row>
            <Form.Item name="title" label="Resource Name" rules={[{required:true}]}><Input /></Form.Item>
            <Form.Item name="url" label="Resource URL"><Input placeholder="https://..." /></Form.Item>
            {externalLinkForm.getFieldValue("provider")==="confluence" && externalLinkForm.getFieldValue("resourceType")==="Page"?<>
              <Divider titlePlacement="start">Confluence Page Template</Divider>
              <Form.Item name="templateKey" label="Template Key / ID" rules={[{required:true,message:"Enter the template identifier used by this page"}]}><Input placeholder="e.g. architecture-decision-record" /></Form.Item>
              <Form.Item name="templateName" label="Template Name"><Input placeholder="e.g. Architecture Decision Record" /></Form.Item>
              <Text type="secondary" className="small">Only the template identifier is stored.</Text>
            </>:null}
          </>;
        }}</Form.Item>
        <Form.Item name="relationType" label="Relationship to Work Item" rules={[{required:true}]}><Select options={[
          {value:"related_to",label:"Related"},
          {value:"implements",label:"Implements / Delivers"},
          {value:"decision_record",label:"Decision Record"},
          {value:"review_evidence",label:"Review Evidence"},
          {value:"solution_design",label:"Solution Design"},
          {value:"implementation_repository",label:"Implementation Repository"},
          {value:"shared_component",label:"Shared Component"},
          {value:"impacted_application",label:"Impacted Application"},
          {value:"impacted_interface",label:"Impacted Interface"},
          {value:"dependency",label:"Dependency"}
        ]} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="Edit Profile" open={profileOpen} onCancel={()=>setProfileOpen(false)} onOk={()=>void submitForm(profileForm,async()=>{
      const value=profileForm.getFieldsValue();
      return api.updateProfile(profilePerson!.id,value);
    },"Profile updated",()=>setProfileOpen(false))} confirmLoading={busy} width={680}>
      <Form form={profileForm} layout="vertical">
        <Row gutter={12}>
          <Col span={12}><Form.Item name="displayName" label="Name" rules={[{required:true}]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="title" label="Title / Professional Role" rules={[{required:true}]}><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="email" label="Email" rules={[{required:true,type:"email"}]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="department" label="Department"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="location" label="Location"><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="timezone" label="Time Zone"><Input placeholder="Asia/Tokyo" /></Form.Item>
        <Form.Item name="bio" label="Bio"><TextArea rows={3} /></Form.Item>
        <Form.Item name="expertise" label="Areas of Expertise (comma-separated)"><Input placeholder="Solution Architecture, API Design, Cloud Platforms" /></Form.Item>
      </Form>
    </Modal>

    <Modal title={editingParticipationId?"Edit Participant":"Add Participant"} open={participantOpen} onCancel={()=>{setParticipantOpen(false);setEditingParticipationId(null);}} onOk={()=>void submitForm(participantForm,async()=>{
      const value=participantForm.getFieldsValue();
      const roleLabel=participantRoleChoices.find(option=>option.value===value.roleKey)?.label || value.roleKey;
      return editingParticipationId
        ? api.updateParticipation(selected!.id,editingParticipationId,{roleKey:value.roleKey,roleLabel,permissions:value.permissions})
        : api.setParticipation(selected!.id,{...value,roleLabel});
    },"Participant updated",()=>{setParticipantOpen(false);setEditingParticipationId(null);})} confirmLoading={busy}>
       <Form form={participantForm} layout="vertical">
        <Form.Item name="personId" label="Participant" rules={[{required:true}]}><Select disabled={Boolean(editingParticipationId)} showSearch optionFilterProp="label" options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name+" · "+p.title}))} /></Form.Item>
        <Form.Item name="roleKey" label="Role" rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={participantRoleChoices} onChange={roleKey=>{
          const permissions=participantForm.getFieldValue("permissions") || ["read","comment"];
          participantForm.setFieldsValue({
            roleLabel:participantRoleChoices.find(option=>option.value===roleKey)?.label || roleKey,
            permissions:roleKey==="chairman"?["read","decide"]:permissions.filter((permission:string)=>permission!=="decide")
          });
        }} /></Form.Item>
        <Form.Item name="permissions" label="Work Item Permissions" rules={[{required:true}]}><Select mode="multiple" options={[{value:"read",label:"Read"},{value:"contribute",label:"Contribute Artifacts and Manage Tasks"},{value:"comment",label:"Discussion"},{value:"review",label:"Review"},{value:"decide",label:"Make Decisions"},{value:"manage",label:"Manage Participants"}]} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="Register Technical Debt" open={debtOpen} onCancel={()=>setDebtOpen(false)} onOk={()=>void submitForm(debtForm,async()=>{
      const value=debtForm.getFieldsValue();if(value.dueDate)value.dueDate=value.dueDate.format("YYYY-MM-DD");return api.createDebt(value);
    },"Technical debt registered",()=>setDebtOpen(false))} confirmLoading={busy}>
      <Form form={debtForm} layout="vertical">
        <Form.Item name="originWorkItemId" label="Originating Work Item" rules={[{required:true}]}><Select options={(bootstrap?.workItems || []).map(item=>({value:item.id,label:item.code+" · "+item.title}))} /></Form.Item>
        <Form.Item name="title" label="Technical Debt" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="rationale" label="Rationale" rules={[{required:true}]}><TextArea rows={2} /></Form.Item>
        <Form.Item name="ownerId" label="Responsible"><Select allowClear options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))} /></Form.Item>
        <Row gutter={12}><Col span={12}><Form.Item name="severity" label="Severity"><Select options={[{value:"low",label:"Low"},{value:"medium",label:"Medium"},{value:"high",label:"High"}]} /></Form.Item></Col><Col span={12}><Form.Item name="priority" label="Priority"><Select options={[{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"}]} /></Form.Item></Col></Row>
        <Form.Item name="targetState" label="Target Status"><Input /></Form.Item>
        <Form.Item name="remediationPlan" label="Remediation Plan"><TextArea rows={3} /></Form.Item>
        <Form.Item name="dueDate" label="Target Date"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>
  </Layout>;
}
