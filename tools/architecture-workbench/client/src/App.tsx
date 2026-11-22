import { useEffect, useMemo, useState } from "react";
import {
  Alert, Avatar, Breadcrumb, Button, Card, Col, DatePicker, Divider, Drawer, Empty,
  Form, Input, Layout, List, Menu, Modal, Progress, Row, Select, Space, Statistic,
  Table, Tabs, Tag, Timeline, Tooltip, Typography, Upload, message
} from "antd";
import type { FormInstance } from "antd";
import {
  AppstoreOutlined, ApartmentOutlined, ArrowLeftOutlined, AuditOutlined,
  CheckCircleOutlined, ClockCircleOutlined, CloudUploadOutlined, CopyOutlined,
  FileProtectOutlined, PlusOutlined, ProjectOutlined, SafetyCertificateOutlined,
  UnorderedListOutlined, UserAddOutlined, UploadOutlined
} from "@ant-design/icons";
import { Welcome } from "@ant-design/x";
import dayjs from "dayjs";
import { api, setActor } from "./api";
import type { Activity, Artifact, Bootstrap, Comment, DebtItem, Person, Review, WorkItem, WorkItemDetail, WorkTask } from "./types";

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const statusLabels: Record<string,string> = {
  draft:"草稿", analysis:"分析中", in_review:"评审中", changes_requested:"待修改",
  accepted:"已接受", rejected:"已拒绝", closed:"已关闭", open:"待处理",
  in_progress:"处理中", deferred:"已延期", resolved:"已解决", cancelled:"已取消",
  accepted_with_conditions:"附条件接受", more_analysis:"需要更多分析"
};
const statusColors: Record<string,string> = {
  draft:"default", analysis:"processing", in_review:"processing", changes_requested:"warning",
  accepted:"success", rejected:"error", closed:"default", open:"warning", in_progress:"processing",
  deferred:"purple", resolved:"success", cancelled:"default", accepted_with_conditions:"success",
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
  const [page,setPage] = useState("overview");
  const [selected,setSelected] = useState<WorkItem|null>(null);
  const [detail,setDetail] = useState<WorkItemDetail|null>(null);
  const [loading,setLoading] = useState(true);
  const [drawerOpen,setDrawerOpen] = useState(false);
  const [newItemOpen,setNewItemOpen] = useState(false);
  const [artifactOpen,setArtifactOpen] = useState(false);
  const [reviewOpen,setReviewOpen] = useState(false);
  const [taskOpen,setTaskOpen] = useState(false);
  const [decisionOpen,setDecisionOpen] = useState(false);
  const [debtOpen,setDebtOpen] = useState(false);
  const [participantOpen,setParticipantOpen] = useState(false);
  const [newItemForm] = Form.useForm();
  const [artifactForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [taskForm] = Form.useForm();
  const [decisionForm] = Form.useForm();
  const [debtForm] = Form.useForm();
  const [participantForm] = Form.useForm();
  const [activeTab,setActiveTab] = useState("overview");
  const [commentText,setCommentText] = useState("");
  const [query,setQuery] = useState("");
  const [busy,setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const data=await api.bootstrap();
      setBootstrap(data);
      if (selected) {
        const fresh=data.workItems.find(item=>item.id===selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally { setLoading(false); }
  }
  async function openWorkItem(item:WorkItem) {
    setSelected(item); setDrawerOpen(true);
    try { setDetail(await api.detail(item.id)); }
    catch (error) { message.error(error instanceof Error ? error.message : "无法打开事项"); }
  }
  async function refreshDetail() {
    if (!selected) return;
    const [fresh,data]=await Promise.all([api.detail(selected.id),api.bootstrap()]);
    setDetail(fresh); setBootstrap(data);
  }
  useEffect(()=>{setActor(actor);void reload();},[actor]);

  const actorPerson=bootstrap?.people.find(person=>person.id===actor);
  const filteredItems=useMemo(()=>(bootstrap?.workItems || []).filter(item=>
    [item.code,item.title,item.description,item.owner_name].join(" ").toLowerCase().includes(query.toLowerCase())
  ),[bootstrap,query]);
  const menuItems=[
    {key:"overview",icon:<AppstoreOutlined />,label:"工作概览"},
    {key:"my-work",icon:<UnorderedListOutlined />,label:"我的工作"},
    {key:"work-items",icon:<ProjectOutlined />,label:"业务事项"},
    {key:"reviews",icon:<AuditOutlined />,label:"架构与 ADR 评审"},
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
    try { await api.updateTask(taskId,{status}); message.success("Task 状态已更新"); await refreshDetail(); }
    catch (error) { message.error(error instanceof Error ? error.message : "更新失败"); }
  }
  async function submitComment() {
    if (!selected || !commentText.trim()) return;
    try { await api.comment(selected.id,commentText.trim()); setCommentText(""); await refreshDetail(); }
    catch (error) { message.error(error instanceof Error ? error.message : "提交失败"); }
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
      <Row gutter={[16,16]}>
        <Col xs={24} xl={16}>
          <Card title="最近业务事项" extra={<Button type="link" onClick={()=>setPage("work-items")}>查看全部</Button>} className="panel-card">
            <Table rowKey="id" columns={itemColumns} dataSource={bootstrap.workItems.slice(0,5)} pagination={false} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="工作原则" className="panel-card">
            <div className="principle"><CheckCircleOutlined /><div><Text strong>Human-led</Text><Text type="secondary">正式 Review 和 Decision 由有授权的人确认。</Text></div></div>
            <div className="principle"><ApartmentOutlined /><div><Text strong>Work Item-centric</Text><Text type="secondary">事项是业务上下文，Task 和 Session 只是工作过程。</Text></div></div>
            <div className="principle"><SafetyCertificateOutlined /><div><Text strong>Agent-optional</Text><Text type="secondary">支持外部 Agent，但不要求指定 Runtime 或模型。</Text></div></div>
            <Divider />
            <Welcome className="agent-welcome" title="连接你自己的 Agent" description="复制当前事项的 Context Capsule，交给 Copilot、Claude 或其他工具。正式结果仍需提交回业务事项。" />
            <Text type="secondary" className="small">本原型尚未启用模型调用；此处只演示外部 Agent 的接入边界。</Text>
          </Card>
        </Col>
      </Row>
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
    const mine=(bootstrap?.workItems || []).filter(item=>item.owner_id===actor);
    return <div className="page-stack">
      <div className="page-heading"><div><Text type="secondary">PERSONAL WORK QUEUE</Text><Title level={2}>我的工作</Title><Paragraph type="secondary">当前原型按当前演示身份聚合负责人事项；后续扩展为参与关系和任务的统一收件箱。</Paragraph></div></div>
      <Card title="我负责的事项" className="panel-card"><Table rowKey="id" columns={itemColumns} dataSource={mine} pagination={false} /></Card>
      <Card title="当前身份" className="panel-card"><Space><Avatar style={{background:actorPerson?.avatar_color}}>{actorPerson?.display_name.slice(0,1)}</Avatar><div><Text strong>{actorPerson?.display_name}</Text><div><Text type="secondary">{actorPerson?.title}</Text></div></div></Space></Card>
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
    return <div className="detail-body">
      <div className="detail-topline"><Space><Button icon={<ArrowLeftOutlined />} onClick={()=>setDrawerOpen(false)}>返回</Button><Breadcrumb items={[{title:"业务事项"},{title:item.code}]} /></Space><Space><Tag color={statusColors[item.status]}>{statusLabels[item.status] || item.status}</Tag><Tag>{item.type}</Tag></Space></div>
      <div className="detail-heading">
        <div><Text type="secondary">{item.code} · Context v{item.context_version}</Text><Title level={3}>{item.title}</Title><Paragraph type="secondary">{item.description}</Paragraph></div>
        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={async()=>{const capsule=await api.contextCapsule(item.id);await navigator.clipboard.writeText(JSON.stringify(capsule,null,2));message.success("Context Capsule 已复制");}}>复制 Context</Button>
          {permissions.includes("contribute") && <Button icon={<PlusOutlined />} onClick={()=>setArtifactOpen(true)}>添加产物</Button>}
          {permissions.includes("decide") && <Button type="primary" onClick={()=>setDecisionOpen(true)}>记录正式决定</Button>}
        </Space>
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {key:"overview",label:"概览",children:<Row gutter={[16,16]}>
          <Col xs={24} xl={15}>
            <Card title="参与者" size="small" extra={permissions.includes("manage")?<Button size="small" icon={<UserAddOutlined />} onClick={()=>{participantForm.setFieldsValue({permissions:["read","comment"]});setParticipantOpen(true);}}>管理参与者</Button>:null}><div className="participant-grid">{detail.participants.map(p=><div className="participant" key={p.person_id}><Avatar style={{background:p.avatar_color}}>{p.display_name.slice(0,1)}</Avatar><div><Text strong>{p.display_name}</Text><div><Tag color={roleColors[p.role_key] || "default"}>{p.role_label}</Tag></div></div></div>)}</div></Card>
            <Card title="最新产物" size="small" className="nested-card"><List dataSource={detail.artifacts.slice(0,4)} renderItem={a=><List.Item><List.Item.Meta avatar={<Avatar icon={<FileProtectOutlined />} />} title={(a.code || a.type)+" · "+a.title} description={"v"+a.version+" · "+a.submitter_name+" · "+dateText(a.created_at)} /></List.Item>} /></Card>
          </Col>
          <Col xs={24} xl={9}>
            <Card title="当前评审轮次" size="small"><Text strong>{currentCycle?.name || "尚未启动评审"}</Text><div className="spacer" /><Text type="secondary">基线材料：{currentCycle ? JSON.parse(currentCycle.baseline_json).length : 0} 项</Text><div className="spacer" /><Progress percent={detail.reviews.length ? Math.min(100,Math.round(detail.reviews.length/Math.max(1,detail.participants.filter(p=>p.permissions_json.includes("review")).length)*100)) : 0} /></Card>
            <Card title="未完成任务" size="small" className="nested-card"><Statistic value={detail.tasks.filter(t=>!["done","cancelled"].includes(t.status)).length} suffix="项" /></Card>
          </Col>
        </Row>},
        {key:"artifacts",label:"架构产物 / ADR",children:<><Card size="small" title="版本化产物" extra={permissions.includes("contribute")?<Button size="small" icon={<PlusOutlined />} onClick={()=>setArtifactOpen(true)}>添加产物</Button>:null}><Table rowKey="id" dataSource={detail.artifacts} pagination={false} columns={[
          {title:"编号",dataIndex:"code",render:(v:string|null)=>v || "—"},
          {title:"产物",dataIndex:"title",render:(v:string,a:Artifact)=><div><Text strong>{v}</Text><div><Text type="secondary" className="small">{a.type}</Text></div></div>},
          {title:"版本",dataIndex:"version",render:(v:number)=>"v"+v},
          {title:"状态",dataIndex:"status",render:(v:string)=><Tag>{v}</Tag>},
          {title:"提交人",dataIndex:"submitter_name"},
          {title:"",render:(_:unknown,a:Artifact)=><Tooltip title="查看内容"><Button type="link" onClick={()=>Modal.info({title:a.title,content:<Paragraph style={{whiteSpace:"pre-wrap"}}>{a.content}</Paragraph>,width:720})}>查看</Button></Tooltip>}
        ]} /></Card><Card size="small" className="nested-card" title="附件" extra={permissions.includes("contribute")?<Upload showUploadList={false} customRequest={async options=>{try{await api.uploadAttachment(item.id,options.file as File);options.onSuccess?.({});message.success("附件已上传");await refreshDetail();}catch(error){options.onError?.(error as Error);message.error(error instanceof Error?error.message:"附件上传失败");}}}><Button size="small" icon={<UploadOutlined />}>上传文件</Button></Upload>:null}><List dataSource={detail.attachments} locale={{emptyText:"暂无附件"}} renderItem={file=><List.Item><List.Item.Meta avatar={<Avatar icon={<FileProtectOutlined />} />} title={file.original_name} description={file.content_type+" · "+Math.ceil(file.size_bytes/1024)+" KB · "+dateText(file.created_at)} /></List.Item>} /></Card></>},
        {key:"reviews",label:"Review 意见",children:<Card size="small" title="独立专业意见" extra={permissions.includes("review")?<Button size="small" icon={<PlusOutlined />} onClick={()=>{reviewForm.setFieldsValue({artifactId:detail.artifacts[0]?.id,outcome:"comment",discipline:actorPerson?.title || "General"});setReviewOpen(true);}}>提交 Review</Button>:null}><List dataSource={detail.reviews} locale={{emptyText:"尚无评审意见"}} renderItem={(r:Review)=><List.Item><List.Item.Meta avatar={<Avatar icon={<AuditOutlined />} />} title={<Space wrap><Text strong>{r.reviewer_name}</Text><Tag>{r.discipline}</Tag><Tag color={r.outcome==="approve"?"success":r.outcome==="request_changes"?"warning":"default"}>{r.outcome}</Tag></Space>} description={<><Text>{r.summary}</Text><div className="small muted">{r.artifact_code || r.artifact_title} · v{r.artifact_version} · {dateText(r.created_at)}</div></>} /></List.Item>} /></Card>},
        {key:"tasks",label:"Tasks",children:<Card size="small" title="工作与后续行动" extra={permissions.includes("contribute")?<Button size="small" icon={<PlusOutlined />} onClick={()=>{taskForm.setFieldsValue({assigneeId:actor});setTaskOpen(true);}}>创建 Task</Button>:null}><Table rowKey="id" dataSource={detail.tasks} pagination={false} columns={[
          {title:"Task",dataIndex:"title"},{title:"类型",dataIndex:"kind"},{title:"责任人",dataIndex:"assignee_name",render:(v:string|null)=>v || "未分配"},
          {title:"状态",dataIndex:"status",render:(v:string,t:WorkTask)=><Select size="small" value={v} disabled={!permissions.includes("contribute")} style={{width:112}} onChange={value=>void updateTask(t.id,value)} options={[{value:"open",label:"待处理"},{value:"in_progress",label:"处理中"},{value:"blocked",label:"受阻"},{value:"done",label:"完成"},{value:"cancelled",label:"取消"}]} />},{title:"截止日期",dataIndex:"due_date",render:dateText}
        ]} /></Card>},
        {key:"decisions",label:"Decisions",children:<Card size="small" title="正式决策记录" extra={permissions.includes("decide")?<Button type="primary" size="small" onClick={()=>setDecisionOpen(true)}>记录决定</Button>:<Tag color="gold">当前身份无决策权限</Tag>}><List dataSource={detail.decisions} locale={{emptyText:"尚无正式决定"}} renderItem={d=><List.Item><List.Item.Meta avatar={<Avatar icon={<CheckCircleOutlined />} />} title={<Space><Tag color={statusColors[d.outcome]}>{statusLabels[d.outcome] || d.outcome}</Tag><Text strong>{d.decision_maker_name}</Text></Space>} description={<><Paragraph>{d.rationale}</Paragraph>{d.conditions && <Text type="secondary">条件：{d.conditions}</Text>}<div className="small muted">{dateText(d.created_at)}</div></>} /></List.Item>} /></Card>},
        {key:"activity",label:"讨论与活动",children:<Row gutter={[16,16]}><Col xs={24} xl={13}><Card size="small" title="讨论"><Space.Compact block><Input value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="补充信息或回应问题..." onPressEnter={()=>void submitComment()} /><Button type="primary" onClick={()=>void submitComment()}>发送</Button></Space.Compact><List className="comment-list" dataSource={detail.comments} renderItem={(c:Comment)=><List.Item><List.Item.Meta avatar={<Avatar style={{background:c.avatar_color}}>{c.author_name.slice(0,1)}</Avatar>} title={<Space><Text strong>{c.author_name}</Text><Text type="secondary" className="small">{dateText(c.created_at)}</Text></Space>} description={c.body} /></List.Item>} /></Card></Col><Col xs={24} xl={11}><Card size="small" title="活动记录"><Timeline items={detail.activity.map((a:Activity)=>({children:<><Text strong>{a.actor_name}</Text><div>{a.summary}</div><Text type="secondary" className="small">{dateText(a.created_at)}</Text></>}))} /></Card></Col></Row>}
      ]} />
    </div>;
  }

  return <Layout className="app-shell">
    <Sider width={238} theme="light" className="app-sider">
      <div className="brand"><div className="brand-mark">A</div><div><Text strong>Architecture</Text><div><Text type="secondary" className="small">Workbench</Text></div></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <Menu mode="inline" selectedKeys={[page]} items={menuItems} onClick={e=>{setPage(e.key);setDrawerOpen(false);}} />
      <div className="sider-footer"><div className="workspace-label">DESIGN PRINCIPLES</div><div className="sider-note"><SafetyCertificateOutlined /> Human-led decision</div><div className="sider-note"><ApartmentOutlined /> Shared Work Item context</div><div className="sider-note"><CloudUploadOutlined /> External Agent optional</div><div className="sider-version">Prototype · 0.1.0</div></div>
    </Sider>
    <Layout>
      <Header className="app-header"><div><Text type="secondary">业务协作平台 / </Text><Text strong>{menuItems.find(m=>m.key===page)?.label}</Text></div><Space><Text type="secondary" className="small">演示身份</Text><Select value={actor} onChange={setActorState} style={{width:220}} options={(bootstrap?.people || []).map((p:Person)=>({value:p.id,label:p.display_name+" · "+p.title}))} /><Avatar style={{background:actorPerson?.avatar_color}}>{actorPerson?.display_name.slice(0,1)}</Avatar></Space></Header>
      <Content className="app-content">
        {page==="overview" && renderDashboard()}
        {page==="work-items" && renderWorkItems()}
        {page==="my-work" && renderMyWork()}
        {page==="reviews" && renderReviews()}
        {page==="debts" && renderDebts()}
      </Content>
    </Layout>
    <Drawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} placement="right" width="min(1180px, 96vw)" title={null} destroyOnClose={false} styles={{body:{padding:0}}}>{renderDetailContent()}</Drawer>

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
        <Form.Item name="artifactId" label="评审对象" rules={[{required:true}]}><Select options={(detail?.artifacts || []).map(a=>({value:a.id,label:(a.code || a.type)+" · "+a.title+" v"+a.version}))} /></Form.Item>
        <Form.Item name="discipline" label="专业领域" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="outcome" label="意见类型"><Select options={[{value:"approve",label:"认可"},{value:"comment",label:"建议 / 评论"},{value:"request_changes",label:"要求修改"},{value:"block",label:"阻断"}]} /></Form.Item>
        <Form.Item name="summary" label="评审意见" rules={[{required:true}]}><TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="创建后续 Task" open={taskOpen} onCancel={()=>setTaskOpen(false)} onOk={()=>void submitForm(taskForm,async()=>{const v=taskForm.getFieldsValue();if(v.dueDate)v.dueDate=v.dueDate.format("YYYY-MM-DD");return api.createTask(selected!.id,v);},"Task 已创建",()=>setTaskOpen(false))} confirmLoading={busy}>
      <Form form={taskForm} layout="vertical">
        <Form.Item name="title" label="工作内容" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="kind" label="工作类型"><Select options={[{value:"analysis",label:"分析"},{value:"revision",label:"材料修改"},{value:"follow_up",label:"后续整改"},{value:"decision_prep",label:"决策准备"}]} /></Form.Item>
        <Form.Item name="assigneeId" label="责任人"><Select allowClear options={(detail?.participants || []).map(p=>({value:p.person_id,label:p.display_name+" · "+p.role_label}))} /></Form.Item>
        <Form.Item name="dueDate" label="截止日期"><DatePicker style={{width:"100%"}} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="记录正式决定" open={decisionOpen} onCancel={()=>setDecisionOpen(false)} onOk={()=>void submitForm(decisionForm,async()=>{
      const value=decisionForm.getFieldsValue();
      if(value.targetDate)value.technicalDebt={...value.technicalDebt,dueDate:value.targetDate.format("YYYY-MM-DD")};
      return api.createDecision(selected!.id,value);
    },"正式决定已记录",()=>setDecisionOpen(false))} confirmLoading={busy} width={720}>
      <Alert type="warning" showIcon message="正式决定由当前 Human 身份提交；Agent 分析或草案不能代替 Decision Authority。" className="modal-alert" />
      <Form form={decisionForm} layout="vertical" initialValues={{subjectType:"work_item",outcome:"more_analysis"}}>
        <Form.Item name="subjectType" label="决策对象"><Select options={[{value:"work_item",label:"整个业务事项"},{value:"artifact",label:"某个 ADR / Artifact"}]} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("subjectType")==="artifact"?<Form.Item name="subjectId" label="选择 Artifact"><Select options={(detail?.artifacts || []).map(a=>({value:a.id,label:(a.code || a.type)+" · "+a.title}))} /></Form.Item>:null}</Form.Item>
        <Form.Item name="outcome" label="决定" rules={[{required:true}]}><Select options={[{value:"accepted",label:"接受"},{value:"accepted_with_conditions",label:"附条件接受"},{value:"more_analysis",label:"需要更多分析"},{value:"rejected",label:"拒绝"}]} /></Form.Item>
        <Form.Item name="rationale" label="决定依据" rules={[{required:true}]}><TextArea rows={3} /></Form.Item>
        <Form.Item name="conditions" label="条件 / 限制"><TextArea rows={2} /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="more_analysis"?<><Form.Item name="followUpTitle" label="后续分析工作"><Input placeholder="明确要补充的分析" /></Form.Item><Form.Item name="followUpOwnerId" label="责任人"><Select allowClear options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))} /></Form.Item><Form.Item name="followUpDueDate" label="截止日期"><DatePicker style={{width:"100%"}} /></Form.Item></>:null}</Form.Item>
        <Form.Item noStyle shouldUpdate>{({getFieldValue})=>getFieldValue("outcome")==="accepted_with_conditions"?<><Divider orientation="left">可选：记录长期 Tech Debt</Divider>
          <Form.Item name={["technicalDebt","title"]} label="技术债务标题"><Input placeholder="例如：移除过渡适配器" /></Form.Item>
          <Form.Item name={["technicalDebt","description"]} label="来源与原因"><TextArea rows={2} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name={["technicalDebt","ownerId"]} label="责任人"><Select options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name}))} /></Form.Item></Col><Col span={12}><Form.Item name={["technicalDebt","severity"]} label="严重程度"><Select options={[{value:"low",label:"低"},{value:"medium",label:"中"},{value:"high",label:"高"}]} /></Form.Item></Col></Row>
          <Form.Item name={["technicalDebt","targetState"]} label="目标状态"><Input /></Form.Item>
          <Form.Item name={["technicalDebt","remediationPlan"]} label="偿还计划"><TextArea rows={2} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name={["technicalDebt","priority"]} label="优先级"><Select options={[{value:"low",label:"低"},{value:"normal",label:"普通"},{value:"high",label:"高"}]} /></Form.Item></Col><Col span={12}><Form.Item name={["technicalDebt","dueDate"]} label="目标偿还日期"><DatePicker style={{width:"100%"}} /></Form.Item></Col></Row>
        </>:null}</Form.Item>
      </Form>
    </Modal>

    <Modal title="管理事项参与者" open={participantOpen} onCancel={()=>setParticipantOpen(false)} onOk={()=>void submitForm(participantForm,async()=>api.setParticipation(selected!.id,participantForm.getFieldsValue()),"参与关系已更新",()=>setParticipantOpen(false))} confirmLoading={busy}>
      <Alert type="info" showIcon message="职责和 Agent 使用方式分离。此处只配置 Human 在当前事项中的业务职责和动作权限。" className="modal-alert" />
      <Form form={participantForm} layout="vertical">
        <Form.Item name="personId" label="参与者" rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={(bootstrap?.people || []).map(p=>({value:p.id,label:p.display_name+" · "+p.title}))} /></Form.Item>
        <Form.Item name="roleKey" label="Role Key" rules={[{required:true}]}><Input placeholder="security_architect" /></Form.Item>
        <Form.Item name="roleLabel" label="职责名称" rules={[{required:true}]}><Input placeholder="Security Architect" /></Form.Item>
        <Form.Item name="permissions" label="事项权限" rules={[{required:true}]}><Select mode="multiple" options={[{value:"read",label:"读取"},{value:"contribute",label:"提交材料 / Task"},{value:"comment",label:"讨论"},{value:"review",label:"专业评审"},{value:"decide",label:"正式决策"},{value:"manage",label:"管理参与关系"}]} /></Form.Item>
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
