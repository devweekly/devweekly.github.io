import { all, id, now, one, run } from "./db.js";

export function seed() {
  if (all("SELECT id FROM people LIMIT 1").length === 0) {
    const created = now();
    const people = [
      ["u-sa","Aiko Tanaka","Solution Architect","aiko@example.test","#4567a8"],
      ["u-ea","Kenji Sato","Enterprise Architect","kenji@example.test","#6b8f71"],
      ["u-sec","Mina Ito","Security Architect","mina@example.test","#9970a8"],
      ["u-sme","Yuki Mori","Solution SME","yuki@example.test","#b17b52"],
      ["u-dev","Ryo Nakamura","Development Manager","ryo@example.test","#628f9f"],
      ["u-chair","Haru Watanabe","Architecture Decision Owner","haru@example.test","#9e755d"],
      ["u-agent","Workbench Agent Service","Agent Service Principal","agent-service@example.test","#557c85"]
    ];
    for (const p of people) run("INSERT INTO people(id,display_name,title,email,avatar_color,created_at) VALUES(?,?,?,?,?,?)", ...p, created);
  }
  const servicePrincipal=one<{id:string}>("SELECT id FROM people WHERE id='u-agent'");
  if (!servicePrincipal) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
    "u-agent","Workbench Agent Service","Agent Service Principal","agent-service@example.test","#557c85","Architecture Platform","Local","Dedicated non-admin identity for remote Agent Host operations. Grant it only the Work Item Participation permissions required for its assigned work.",JSON.stringify(["Agent execution","Draft artifact preparation","Task coordination"]),"Asia/Tokyo",now());
  const admin=one<{id:string}>("SELECT id FROM people WHERE id='u-admin'");
  if (!admin) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)",
    "u-admin","Workbench Administrator","Platform Administrator","admin@example.test","#344b70","Architecture Office","Tokyo","Administers people, workflow and workspace access.",JSON.stringify(["Workflow administration","People administration","Architecture governance"]),"Asia/Tokyo",now());
  run("UPDATE people SET is_admin=1 WHERE id='u-admin'");
  const profiles:Record<string,{department:string;location:string;bio:string;expertise:string[]}> = {
    "u-sa":{department:"Solution Architecture",location:"Tokyo",bio:"Owns solution architecture, system boundaries and delivery alignment.",expertise:["Solution Architecture","Integration","API Design","Cloud"]},
    "u-ea":{department:"Enterprise Architecture",location:"Tokyo",bio:"Connects solution decisions with enterprise standards and target architecture.",expertise:["Enterprise Architecture","Capability Mapping","Standards","Technology Strategy"]},
    "u-sec":{department:"Cyber Security",location:"Tokyo",bio:"Reviews security architecture, controls, identity and data protection.",expertise:["Security Architecture","IAM","Threat Modeling","Data Protection"]},
    "u-sme":{department:"Business",location:"Tokyo",bio:"Provides business process and domain knowledge for architecture decisions.",expertise:["Business Process","Domain Knowledge","Requirements"]},
    "u-dev":{department:"Engineering",location:"Tokyo",bio:"Owns delivery feasibility, engineering quality and operational readiness.",expertise:["Software Engineering","Delivery","Operations","Reliability"]},
    "u-chair":{department:"Architecture Governance",location:"Tokyo",bio:"Makes formal architecture decisions and accepts or rejects recommendations.",expertise:["Architecture Governance","Decision Making","Risk Acceptance"]},
    "u-admin":{department:"Architecture Office",location:"Tokyo",bio:"Administers people, workflow and workspace access.",expertise:["Workflow Administration","People Administration","Architecture Governance"]},
    "u-agent":{department:"Architecture Platform",location:"Local",bio:"Dedicated non-admin identity for Agent Host operations. Grant only explicit, Work Item-scoped permissions.",expertise:["Agent Execution","Draft Artifact Preparation","Task Coordination"]}
  };
  for (const [personId,profile] of Object.entries(profiles)) {
    run("UPDATE people SET department=CASE WHEN department='' THEN ? ELSE department END,location=CASE WHEN location='' THEN ? ELSE location END,bio=CASE WHEN bio='' THEN ? ELSE bio END,expertise_json=CASE WHEN expertise_json='[]' THEN ? ELSE expertise_json END WHERE id=?",
      profile.department,profile.location,profile.bio,JSON.stringify(profile.expertise),personId);
  }
  run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
  if (all("SELECT id FROM work_items LIMIT 1").length > 0) {
    seedExternalReferences();
    return;
  }
  const created = now();
  const wi = "wi-arch-001";
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    wi,"ARC-2026-014","architecture_review","客户数据平台现代化方案","统一客户主数据与交易数据访问层。当前方案需要评审 API 边界、数据隔离、遗留批处理兼容和分阶段迁移策略。","in_review","high","u-sa","2026-12-08",4,created,created);
  const participants = [
    ["u-sa","solution_architect","Solution Architect",["read","contribute","comment"]],
    ["u-ea","enterprise_architect","Enterprise Architect",["read","review","comment","contribute"]],
    ["u-sec","security_architect","Security Architect",["read","review","comment"]],
    ["u-sme","solution_sme","Solution SME",["read","comment","contribute"]],
    ["u-dev","development_manager","Development Manager",["read","review","comment","contribute"]],
    ["u-chair","decision_authority","Decision Authority",["read","review","comment","contribute","decide","manage"]]
  ];
  for (const p of participants) run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)", id("part"),wi,p[0],p[1],p[2],JSON.stringify(p[3]),created);
  const artifacts = [
    ["adr-101","ADR","ADR-001","API Gateway 与领域服务的边界","accepted","统一入口由 API Gateway 提供，领域服务保留业务授权与数据访问控制。","Decision\nKeep business authorization in domain services.\n\nOptions\nA. Centralize all policy in the gateway.\nB. Keep business authorization close to domain services.\n\nConsequences\nThe gateway handles edge controls; domain services enforce resource-level policy."],
    ["adr-102","ADR","ADR-002","客户敏感数据的隔离策略","proposed","区分租户隔离、字段级保护和审计要求。","Context\nCustomer records include sensitive attributes.\n\nProposal\nUse tenant-scoped access policies, field-level protection for selected attributes, and immutable access audit."],
    ["adr-103","ADR","ADR-003","遗留批处理的过渡兼容方案","proposed","第一阶段保留适配器，后续替换为事件驱动处理。","Context\nThe current batch interface cannot be replaced before the next release window.\n\nProposal\nKeep a translation adapter for one release, measure operational impact, and create a remediation item."],
    ["doc-101","Architecture Overview",null,"目标架构与迁移路线","submitted","分阶段迁移：数据接入、统一访问层、消费者切换。","Target state\nA shared customer data access layer with domain-owned controls.\n\nMigration\n1. Establish canonical customer identifiers.\n2. Introduce API façade and data contracts.\n3. Migrate consumers by business capability."]
  ];
  for (const a of artifacts) run("INSERT INTO artifacts(id,work_item_id,type,code,title,version,status,summary,content,submitted_by,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    a[0],wi,a[1],a[2],a[3],1,a[4],a[5],a[6],"u-sa","seed-"+a[0],created);
  const reviewBaseline=[
    {id:"adr-101",version:1,code:"ADR-001",type:"ADR",title:"API Gateway 与领域服务的边界",content_hash:"seed-adr-101"},
    {id:"adr-102",version:1,code:"ADR-002",type:"ADR",title:"客户敏感数据的隔离策略",content_hash:"seed-adr-102"},
    {id:"adr-103",version:1,code:"ADR-003",type:"ADR",title:"遗留批处理的过渡兼容方案",content_hash:"seed-adr-103"},
    {id:"doc-101",version:1,code:null,type:"Architecture Overview",title:"目标架构与迁移路线",content_hash:"seed-doc-101"}
  ];
  run("INSERT INTO submissions(id,work_item_id,sequence,purpose,manifest_json,context_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
    "sub-101",wi,1,"review",JSON.stringify(reviewBaseline),4,"u-sa",created);
  run("INSERT INTO review_cycles(id,work_item_id,submission_id,name,baseline_json,status,due_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "cycle-101",wi,"sub-101","Review · Submission 1",JSON.stringify(reviewBaseline),"active","2026-11-27","u-sa",created);
  const reviews = [
    ["rev-101","adr-101","u-ea","Enterprise Architecture","approve","边界清晰，建议补充 API 生命周期与标准目录的关联。",["补充 API 版本治理","明确领域服务的标准责任"]],
    ["rev-102","adr-102","u-sec","Security","request_changes","整体方向可行，但字段级保护与审计留存要求需要明确。",["给出敏感字段分类依据","说明审计保留周期与查询权限"]],
    ["rev-103","adr-103","u-dev","Delivery","comment","过渡适配器可降低交付风险，但必须定义退出条件。",["补充移除适配器的目标版本","说明失败重放和监控责任"]]
  ];
  for (const r of reviews) run("INSERT INTO reviews(id,cycle_id,artifact_id,artifact_version,reviewer_id,discipline,outcome,summary,findings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    r[0],"cycle-101",r[1],1,r[2],r[3],r[4],r[5],JSON.stringify(r[6]),created);
  const tasks = [
    ["task-101","补充 ADR-002 敏感字段分类与审计要求","revision","in_progress","u-sa","u-sa","2026-11-25","adr-102"],
    ["task-102","确认批处理适配器退出条件","analysis","open","u-sa","u-sme","2026-11-28","adr-103"],
    ["task-103","准备架构评审决策材料","decision_prep","open","u-sa","u-chair","2026-11-27",null]
  ];
  for (const t of tasks) run("INSERT INTO tasks(id,work_item_id,title,kind,status,owner_id,assignee_id,due_date,relates_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",t[0],wi,t[1],t[2],t[3],t[4],t[5],t[6],t[7],created,created);
  run("INSERT INTO comments(id,work_item_id,author_id,body,created_at) VALUES(?,?,?,?,?)","comment-101",wi,"u-sme","业务侧确认：首期必须兼容现有日终批处理窗口，不能要求所有消费者同步切换。",created);
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",id("evt"),wi,"u-sa","submitted","work_item",wi,"提交架构方案与 3 份 ADR，进入第一轮评审。","{}",created);
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",id("evt"),wi,"u-sec","reviewed","artifact","adr-102","Security Reviewer 提交修改意见。","{}",created);
  const second = "wi-change-002";
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",second,"CHG-2026-021","change_assessment","支付对账服务弹性改造","评估重试策略、批量补偿与运行时隔离的变更影响。","analysis","normal","u-dev","2026-12-15",2,created,created);
  for (const p of [["u-dev","delivery_owner","Delivery Owner",["read","contribute","comment"]],["u-sa","architect","Architect",["read","review","comment"]],["u-chair","decision_authority","Decision Authority",["read","decide","manage"]]]) {
    run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),second,p[0],p[1],p[2],JSON.stringify(p[3]),created);
  }
  run("INSERT INTO tasks(id,work_item_id,title,kind,status,owner_id,assignee_id,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)","task-201",second,"梳理当前失败重试与补偿路径","analysis","in_progress","u-dev","u-dev","2026-11-29",created,created);
  const debt = "wi-debt-001";
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",debt,"DEBT-2026-006","technical_debt","移除客户数据平台遗留批处理适配器","当前 ADR-003 接受的阶段性 workaround。目标是在消费者迁移完成后移除适配器。","open","high","u-dev","2027-03-31",1,created,created);
  run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),debt,"u-dev","debt_owner","Debt Owner",JSON.stringify(["read","contribute","comment","manage"]),created);
  run("INSERT INTO debt_details(work_item_id,severity,priority,target_state,remediation_plan,status,due_date) VALUES(?,?,?,?,?,?,?)",debt,"medium","high","所有消费者切换至事件驱动接口，不再依赖批处理适配器。","每次迁移一个消费者；保留双轨指标；连续两个发布窗口无调用后移除适配器。","open","2027-03-31");
  run("INSERT INTO work_item_relations(id,source_work_item_id,target_work_item_id,relation_type,created_at) VALUES(?,?,?,?,?)",id("rel"),wi,debt,"generated_technical_debt",created);
  run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
  seedWorkflowHistory(wi,created);
  seedExternalReferences();
}

function seedWorkflowHistory(workItemId:string,created:string) {
  if ((one<{n:number}>("SELECT COUNT(*) AS n FROM workflow_transitions WHERE work_item_id=?",workItemId)?.n || 0) > 0) return;
  run("INSERT INTO workflow_transitions(id,work_item_id,from_status,to_status,action,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
    "wf-seed-analysis",workItemId,"draft","analysis","start_analysis","Request created and analysis started.","u-sa",created);
  const reviewCreated=new Date(Date.parse(created)+1000).toISOString();
  run("INSERT INTO workflow_transitions(id,work_item_id,from_status,to_status,action,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
    "wf-seed-review",workItemId,"analysis","in_review","submit_for_review","Architecture artifacts submitted for the first review round.","u-sa",reviewCreated);
}

function seedExternalReferences() {
  const created = now();
  const resources = [
    ["ref-jira-story-1","jira","Story","100412","DATA-412","Expose customer profile read API","https://jira.example.test/browse/DATA-412"],
    ["ref-jira-story-2","jira","Story","100418","DATA-418","Define tenant-scoped customer data policy","https://jira.example.test/browse/DATA-418"],
    ["ref-jira-story-3","jira","Story","100521","PAY-521","Introduce idempotent reconciliation retries","https://jira.example.test/browse/PAY-521"],
    ["ref-conf-adr","confluence","Page","785001","ADR-002","ADR-002 · Customer Data Protection","https://confluence.example.test/wiki/spaces/ARCH/pages/785001"],
    ["ref-conf-review","confluence","Page","785010","ARC-014-REVIEW","Customer Data Platform · Architecture Review","https://confluence.example.test/wiki/spaces/ARCH/pages/785010"],
    ["ref-conf-pay","confluence","Page","785120","PAY-021-DESIGN","Payment Reconciliation Design Notes","https://confluence.example.test/wiki/spaces/PAY/pages/785120"],
    ["ref-github-repo","github","Repository","repo-771","customer-data-platform","example/customer-data-platform","https://github.com/example/customer-data-platform"],
    ["ref-github-pay","github","Repository","repo-818","payment-reconciliation","example/payment-reconciliation","https://github.com/example/payment-reconciliation"],
    ["ref-leanix-app","leanix","Application","lx-app-201","APP-CRM-001","Customer Master Platform","https://leanix.example.test/factsheet/lx-app-201"],
    ["ref-leanix-int-1","leanix","Interface","lx-int-331","INT-CRM-LEDGER","Customer Platform → Ledger Interface","https://leanix.example.test/factsheet/lx-int-331"],
    ["ref-leanix-int-2","leanix","Interface","lx-int-417","INT-PAY-LEDGER","Payment Reconciliation → Ledger Interface","https://leanix.example.test/factsheet/lx-int-417"],
    ["ref-leanix-app-2","leanix","Application","lx-app-244","APP-PAY-014","Payment Reconciliation Service","https://leanix.example.test/factsheet/lx-app-244"]
  ];  for (const r of resources) {
    run("INSERT OR IGNORE INTO external_resource_refs(id,provider,resource_type,external_id,external_key,title,url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      r[0],r[1],r[2],r[3],r[4],r[5],r[6],created,created);
  }
  const link = (workItemId:string, resourceId:string, relationType:string, templateKey?:string, templateName?:string) => {
    const resource = one<{id:string}>("SELECT id FROM external_resource_refs WHERE id=?",resourceId);
    if (!resource) return;
    run("INSERT OR IGNORE INTO work_item_external_links(id,work_item_id,resource_id,relation_type,confluence_template_key,confluence_template_name,linked_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      id("extlink"),workItemId,resource.id,relationType,templateKey || null,templateName || null,"u-sa",created);
  };
  const requests = all<{id:string;code:string}>("SELECT id,code FROM work_items WHERE type <> 'technical_debt'");
  const arch = requests.find(r=>r.code==="ARC-2026-014")?.id;
  const payment = requests.find(r=>r.code==="CHG-2026-021")?.id;
  if (arch) {
    link(arch,"ref-jira-story-1","implements");
    link(arch,"ref-jira-story-2","implements");
    link(arch,"ref-conf-adr","decision_record","architecture-decision-record","Architecture Decision Record");
    link(arch,"ref-conf-review","review_evidence","architecture-review","Architecture Review Record");
    link(arch,"ref-github-repo","implementation_repository");
    link(arch,"ref-leanix-app","impacted_application");
    link(arch,"ref-leanix-int-1","impacted_interface");
  }
  if (payment) {
    link(payment,"ref-jira-story-3","implements");
    link(payment,"ref-conf-pay","solution_design","solution-design","Solution Design");
    link(payment,"ref-github-pay","implementation_repository");
    link(payment,"ref-github-repo","shared_component");
    link(payment,"ref-leanix-app-2","impacted_application");
    link(payment,"ref-leanix-int-1","dependency");
    link(payment,"ref-leanix-int-2","impacted_interface");
  }
}
