import { createHash } from "node:crypto";
import { all, id, now, one, run } from "./db.js";

export function seed() {
  if (all("SELECT id FROM people LIMIT 1").length === 0) {
    const created = now();
    const people = [
      ["u-sa","Aiko Tanaka","解决方案架构师","aiko@example.test","#4567a8"],
      ["u-ea","Kenji Sato","企业架构师","kenji@example.test","#6b8f71"],
      ["u-sec","Mina Ito","安全架构师","mina@example.test","#9970a8"],
      ["u-sme","Yuki Mori","业务专家","yuki@example.test","#b17b52"],
      ["u-dev","Ryo Nakamura","开发经理","ryo@example.test","#628f9f"],
      ["u-chair","Haru Watanabe","架构评审主席","haru@example.test","#9e755d"],
      ["u-agent","Agent 执行服务","Agent 服务账号","agent-service@example.test","#557c85"]
    ];
    for (const p of people) run("INSERT INTO people(id,display_name,title,email,avatar_color,created_at) VALUES(?,?,?,?,?,?)", ...p, created);
  }
  const servicePrincipal=one<{id:string}>("SELECT id FROM people WHERE id='u-agent'");
  if (!servicePrincipal) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
    "u-agent","Agent 执行服务","Agent 服务账号","agent-service@example.test","#557c85","架构平台","本地","用于执行分配给 Agent 的工作。它不是管理员账号，只能获得具体事项所需的权限。",JSON.stringify(["Agent 任务执行","材料草稿准备","任务协调"]),"Asia/Tokyo",now());
  const admin=one<{id:string}>("SELECT id FROM people WHERE id='u-admin'");
  if (!admin) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)",
    "u-admin","工作台管理员","管理员","admin@example.test","#344b70","架构办公室","Tokyo","维护人员目录、事项流程和工作台设置。",JSON.stringify(["人员管理","流程管理","工作台管理"]),"Asia/Tokyo",now());
  run("UPDATE people SET is_admin=1 WHERE id='u-admin'");
  const profiles:Record<string,{department:string;location:string;bio:string;expertise:string[]}> = {
    "u-sa":{department:"解决方案架构",location:"Tokyo",bio:"负责解决方案设计，协调相关系统和交付团队。",expertise:["解决方案架构","系统集成","API 设计","云平台"]},
    "u-ea":{department:"企业架构",location:"Tokyo",bio:"负责企业架构标准、系统关系和技术路线。",expertise:["企业架构","能力建模","架构标准","技术规划"]},
    "u-sec":{department:"信息安全",location:"Tokyo",bio:"负责安全评审，重点检查身份权限、数据保护和运行风险。",expertise:["安全架构","身份与访问管理","威胁建模","数据保护"]},
    "u-sme":{department:"业务部门",location:"Tokyo",bio:"熟悉客户数据平台和现有业务流程，为方案评审提供业务意见。",expertise:["业务流程","领域知识","需求分析"]},
    "u-dev":{department:"研发",location:"Tokyo",bio:"负责开发排期、技术实现和上线交付。",expertise:["软件开发","项目交付","系统运维","可靠性"]},
    "u-chair":{department:"架构办公室",location:"Tokyo",bio:"主持架构评审会议，记录正式决定和后续要求。",expertise:["架构评审","技术决策","风险评估"]},
    "u-admin":{department:"架构办公室",location:"Tokyo",bio:"维护人员目录、事项流程和工作台设置。",expertise:["人员管理","流程管理","工作台管理"]},
    "u-agent":{department:"架构平台",location:"本地",bio:"用于执行分配给 Agent 的工作。它不是管理员账号，只能获得具体事项所需的权限。",expertise:["Agent 任务执行","材料草稿准备","任务协调"]}
  };
  for (const [personId,profile] of Object.entries(profiles)) {
    run("UPDATE people SET department=CASE WHEN department='' THEN ? ELSE department END,location=CASE WHEN location='' THEN ? ELSE location END,bio=CASE WHEN bio='' THEN ? ELSE bio END,expertise_json=CASE WHEN expertise_json='[]' THEN ? ELSE expertise_json END WHERE id=?",
      profile.department,profile.location,profile.bio,JSON.stringify(profile.expertise),personId);
  }
  run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
  const workflowPrincipal=one<{id:string}>("SELECT id FROM people WHERE id='u-workflow'");
  if (!workflowPrincipal) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
    "u-workflow","流程自动化服务","系统流程账号","workflow@example.test","#667788","架构平台","本地","记录系统自动触发的流程状态变化和截止时间事件。",JSON.stringify(["截止时间处理","流程自动化"]),"Asia/Tokyo",now());
  const existingSeed=one<{id:string}>("SELECT id FROM work_items WHERE id='wi-arch-001'");
  if (existingSeed) {
    run("UPDATE participations SET role_key='chairman',role_label='Chairman',permissions_json=? WHERE work_item_id=? AND person_id='u-chair' AND role_key='decision_authority'",
      JSON.stringify(["read","decide"]),existingSeed.id);
    run("UPDATE work_items SET request_package_json=CASE WHEN request_package_json='{}' THEN ? ELSE request_package_json END WHERE id=?",
      JSON.stringify({goal:"建立统一的客户数据访问方式，避免各系统重复维护客户主数据接口。",scope:"客户主数据、交易数据查询 API，以及现有批处理消费者的迁移。",constraints:"现有日终批处理至少保留到第一阶段结束；客户数据按租户隔离；消费者不能一次性全部切换。",initialProposal:"先统一客户标识和数据契约，再提供查询 API，按系统逐步迁移消费者。",decisionQuestions:"是否采用统一查询 API？租户隔离由哪一层负责？批处理适配器保留到什么时候？",submissionMessage:"提交客户数据平台现代化方案，评审 API 边界、数据隔离和迁移安排。"}),existingSeed.id);
    run("UPDATE submissions SET purpose='request',submission_message=CASE WHEN submission_message='' THEN ? ELSE submission_message END,package_json=CASE WHEN package_json='{}' THEN ? ELSE package_json END,submitted_by=COALESCE(submitted_by,created_by) WHERE work_item_id=? AND sequence=1",
      "提交客户数据平台现代化方案，评审 API 边界、数据隔离和迁移安排。",
      JSON.stringify({goal:"建立统一的客户数据访问方式，避免各系统重复维护客户主数据接口。",scope:"客户主数据、交易数据查询 API，以及现有批处理消费者的迁移。",constraints:"现有日终批处理至少保留到第一阶段结束；客户数据按租户隔离；消费者不能一次性全部切换。",initialProposal:"先统一客户标识和数据契约，再提供查询 API，按系统逐步迁移消费者。",decisionQuestions:"是否采用统一查询 API？租户隔离由哪一层负责？批处理适配器保留到什么时候？"}),
      existingSeed.id);
  }
  if (all("SELECT id FROM work_items LIMIT 1").length > 0) {
    seedExternalReferences();
    snapshotSeedSubmissionExternalReferences("wi-arch-001");
    return;
  }
  const created = now();
  const wi = "wi-arch-001";
  run("UPDATE work_items SET requestor_id=COALESCE(requestor_id,owner_id) WHERE id=?",wi);
  run("UPDATE work_items SET request_package_json=? WHERE id=? AND request_package_json='{}'",
    JSON.stringify({goal:"建立统一的客户数据访问方式，避免各系统重复维护客户主数据接口。",scope:"客户主数据、交易数据查询 API，以及现有批处理消费者的迁移。",constraints:"现有日终批处理至少保留到第一阶段结束；客户数据按租户隔离；消费者不能一次性全部切换。",initialProposal:"先统一客户标识和数据契约，再提供查询 API，按系统逐步迁移消费者。",decisionQuestions:"是否采用统一查询 API？租户隔离由哪一层负责？批处理适配器保留到什么时候？",submissionMessage:"提交客户数据平台现代化方案，评审 API 边界、数据隔离和迁移安排。"}),wi);
  run("UPDATE submissions SET submission_message=?,package_json=? WHERE id='sub-101' AND submission_message=''",
    "提交客户数据平台现代化方案，评审 API 边界、数据隔离和迁移安排。",JSON.stringify({goal:"建立统一的客户数据访问方式，避免各系统重复维护客户主数据接口。",scope:"客户主数据、交易数据查询 API，以及现有批处理消费者的迁移。",constraints:"现有日终批处理至少保留到第一阶段结束；客户数据按租户隔离；消费者不能一次性全部切换。",initialProposal:"先统一客户标识和数据契约，再提供查询 API，按系统逐步迁移消费者。",decisionQuestions:"是否采用统一查询 API？租户隔离由哪一层负责？批处理适配器保留到什么时候？"}));
  const packageValue={goal:"建立统一的客户数据访问方式，避免各系统重复维护客户主数据接口。",scope:"客户主数据、交易数据查询 API，以及现有批处理消费者的迁移。",constraints:"现有日终批处理至少保留到第一阶段结束；客户数据按租户隔离；消费者不能一次性全部切换。",initialProposal:"先统一客户标识和数据契约，再提供查询 API，按系统逐步迁移消费者。",decisionQuestions:"是否采用统一查询 API？租户隔离由哪一层负责？批处理适配器保留到什么时候？",submissionMessage:"提交客户数据平台现代化方案，评审 API 边界、数据隔离和迁移安排。"};
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,requestor_id,chairman_id,request_package_json,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    wi,"ARC-2026-014","architecture_review","客户数据平台现代化方案","统一客户主数据与交易数据访问层。当前方案需要评审 API 边界、数据隔离、遗留批处理兼容和分阶段迁移策略。","discussion_review","high","u-sa","u-sa","u-chair",JSON.stringify(packageValue),"2026-12-08",4,created,created);
  const participants = [
    ["u-sa","solution_architect","解决方案架构师",["read","contribute","comment"]],
    ["u-ea","enterprise_architect","企业架构师",["read","review","comment","contribute"]],
    ["u-sec","security_architect","安全架构师",["read","review","comment"]],
    ["u-sme","solution_sme","业务专家",["read","comment","contribute"]],
    ["u-dev","development_manager","开发经理",["read","review","comment","contribute"]],
    ["u-chair","chairman","会议主席",["read","decide"]]
  ];
  for (const p of participants) run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)", id("part"),wi,p[0],p[1],p[2],JSON.stringify(p[3]),created);
  run("UPDATE work_items SET chairman_id='u-chair' WHERE id=?",wi);
  const artifacts = [
    ["adr-101","ADR","ADR-001","API Gateway 与领域服务的边界","accepted","统一入口由 API Gateway 提供，领域服务保留业务授权与数据访问控制。","决定\n业务授权由领域服务负责。\n\n备选方案\nA. 将所有授权策略集中到 API Gateway。\nB. 由领域服务根据业务资源执行授权。\n\n影响\nAPI Gateway 负责入口层控制；领域服务负责资源级授权。"],
    ["adr-102","ADR","ADR-002","客户敏感数据的隔离策略","proposed","区分租户隔离、字段级保护和审计要求。","背景\n客户记录包含敏感信息，需要区分不同租户的数据访问范围。\n\n方案\n按租户限制数据访问；对指定字段实施保护；记录不可篡改的访问审计。"],
    ["adr-103","ADR","ADR-003","遗留批处理的过渡兼容方案","proposed","第一阶段保留适配器，后续替换为事件驱动处理。","背景\n现有批处理接口在下一个发布窗口前无法替换。\n\n方案\n先保留一版适配器，观察运行情况，并登记后续移除任务。"],
    ["doc-101","Architecture Overview",null,"目标架构与迁移路线","submitted","分阶段迁移：数据接入、统一访问层、消费者切换。","目标架构\n建立统一的客户数据访问层，业务授权仍由各领域服务负责。\n\n迁移步骤\n1. 统一客户标识。\n2. 建立 API 门面和数据契约。\n3. 按业务系统逐步迁移调用方。"]
  ];
  for (const a of artifacts) run("INSERT INTO artifacts(id,work_item_id,type,code,title,version,status,summary,content,submitted_by,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    a[0],wi,a[1],a[2],a[3],1,a[4],a[5],a[6],"u-sa",createHash("sha256").update(String(a[6]),"utf8").digest("hex"),created);
  const reviewBaseline=all<{id:string;version:number;code:string|null;type:string;title:string;content_hash:string}>(
    "SELECT id,version,code,type,title,content_hash FROM artifacts WHERE work_item_id=? ORDER BY id",wi
  );
  run("INSERT INTO submissions(id,work_item_id,sequence,purpose,manifest_json,context_version,created_by,created_at,submission_message,package_json,submitted_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    "sub-101",wi,1,"request",JSON.stringify(reviewBaseline),4,"u-sa",created,
    packageValue.submissionMessage,JSON.stringify(packageValue),"u-sa");
  const seedDeadline="2026-11-27T23:59:59.000Z";
  run("INSERT INTO review_cycles(id,work_item_id,submission_id,name,baseline_json,status,due_date,review_deadline_at,reviewer_snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    "cycle-101",wi,"sub-101","第一轮评审",JSON.stringify(reviewBaseline),"active","2026-11-27",seedDeadline,
    JSON.stringify([{person_id:"u-ea",display_name:"Kenji Sato",role_key:"enterprise_architect"},{person_id:"u-sec",display_name:"Mina Ito",role_key:"security_architect"},{person_id:"u-dev",display_name:"Ryo Nakamura",role_key:"development_manager"}]),"u-sa",created);
  run("INSERT INTO workflow_timers(id,work_item_id,cycle_id,submission_id,timer_type,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "timer-seed-review",wi,"cycle-101","sub-101","review_deadline",seedDeadline,"scheduled",created,created);
  const reviews = [
    ["rev-101","adr-101","u-ea","企业架构","comment","边界清晰，建议补充 API 生命周期与标准目录的关联。",["补充 API 版本管理要求","明确领域服务的责任范围"]],
    ["rev-102","adr-102","u-sec","安全","comment","整体方向可行，但字段级保护与审计留存要求需要明确。",["给出敏感字段分类依据","说明审计保留周期与查询权限"]],
    ["rev-103","adr-103","u-dev","交付","comment","过渡适配器可降低交付风险，但必须定义退出条件。",["补充移除适配器的目标版本","说明失败重放和监控责任"]]
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
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",id("evt"),wi,"u-sec","reviewed","artifact","adr-102","安全评审员提交了修改意见。","{}",created);
  const second = "wi-change-002";
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,requestor_id,chairman_id,request_package_json,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    second,"CHG-2026-021","change_assessment","支付对账服务弹性改造","评估重试策略、批量补偿与运行时隔离的变更影响。","draft","normal","u-dev","u-dev","u-chair",
    JSON.stringify({goal:"减少支付对账任务因临时故障失败后需要人工补数的情况。",scope:"重试策略、批量补偿流程和任务运行隔离。",constraints:"现有结算时间窗口不能延长；重试和补偿必须避免重复入账。",initialProposal:"为可重试错误设置次数和间隔限制，补偿任务采用幂等处理。",decisionQuestions:"哪些错误可以自动重试？补偿任务由谁负责？是否需要独立运行队列？",submissionMessage:"提交支付对账服务改造方案，明确重试范围、补偿责任和运行隔离。"}),
    "2026-12-15",2,created,created);
  for (const p of [["u-dev","delivery_owner","交付负责人",["read","contribute","comment"]],["u-sa","architect","架构师",["read","review","comment"]],["u-chair","chairman","会议主席",["read","decide"]]]) {
    run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),second,p[0],p[1],p[2],JSON.stringify(p[3]),created);
  }
  run("INSERT INTO tasks(id,work_item_id,title,kind,status,owner_id,assignee_id,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)","task-201",second,"梳理当前失败重试与补偿路径","analysis","in_progress","u-dev","u-dev","2026-11-29",created,created);
  const debt = "wi-debt-001";
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",debt,"DEBT-2026-006","technical_debt","移除客户数据平台遗留批处理适配器","当前 ADR-003 采用的临时兼容方案，需要在消费者迁移完成后移除适配器。","open","high","u-dev","2027-03-31",1,created,created);
  run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),debt,"u-dev","debt_owner","技术债务负责人",JSON.stringify(["read","contribute","comment","manage"]),created);
  run("INSERT INTO debt_details(work_item_id,severity,priority,target_state,remediation_plan,status,due_date) VALUES(?,?,?,?,?,?,?)",debt,"medium","high","所有消费者切换至事件驱动接口，不再依赖批处理适配器。","每次迁移一个消费者；保留双轨指标；连续两个发布窗口无调用后移除适配器。","open","2027-03-31");
  run("INSERT INTO work_item_relations(id,source_work_item_id,target_work_item_id,relation_type,created_at) VALUES(?,?,?,?,?)",id("rel"),wi,debt,"generated_technical_debt",created);
  run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
  seedWorkflowHistory(wi,created);
  seedExternalReferences();
  snapshotSeedSubmissionExternalReferences("wi-arch-001");
}

function snapshotSeedSubmissionExternalReferences(workItemId:string) {
  const submission=one<{id:string;package_json:string}>(
    "SELECT id,package_json FROM submissions WHERE work_item_id=? AND sequence=1",workItemId
  );
  if (!submission) return;
  const snapshot=JSON.parse(submission.package_json || "{}") as Record<string,unknown>;
  if (Array.isArray(snapshot.externalReferences)) return;
  const externalReferences=all(
    "SELECT r.provider,r.resource_type,r.external_id,r.external_key,r.title,r.url,l.relation_type,l.confluence_template_key,l.confluence_template_name FROM work_item_external_links l JOIN external_resource_refs r ON r.id=l.resource_id WHERE l.work_item_id=? ORDER BY r.provider,r.resource_type,r.external_key",
    workItemId
  );
  run("UPDATE submissions SET package_json=? WHERE id=?",JSON.stringify({...snapshot,externalReferences}),submission.id);
}

function seedWorkflowHistory(workItemId:string,created:string) {
  if ((one<{n:number}>("SELECT COUNT(*) AS n FROM workflow_transitions WHERE work_item_id=?",workItemId)?.n || 0) > 0) return;
  run("INSERT INTO workflow_transitions(id,work_item_id,from_status,to_status,action,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
    "wf-seed-review",workItemId,"draft","discussion_review","submit_request","申请材料已提交，评审计时开始。","u-sa",created);
}

function seedExternalReferences() {
  const created = now();
  const resources = [
    ["ref-jira-story-1","jira","Story","100412","DATA-412","提供客户资料查询 API","https://jira.example.test/browse/DATA-412"],
    ["ref-jira-story-2","jira","Story","100418","DATA-418","明确客户数据的租户隔离规则","https://jira.example.test/browse/DATA-418"],
    ["ref-jira-story-3","jira","Story","100521","PAY-521","增加支持幂等处理的对账重试","https://jira.example.test/browse/PAY-521"],
    ["ref-conf-adr","confluence","Page","785001","ADR-002","ADR-002 · 客户数据保护","https://confluence.example.test/wiki/spaces/ARCH/pages/785001"],
    ["ref-conf-review","confluence","Page","785010","ARC-014-REVIEW","客户数据平台 · 架构评审","https://confluence.example.test/wiki/spaces/ARCH/pages/785010"],
    ["ref-conf-pay","confluence","Page","785120","PAY-021-DESIGN","支付对账服务设计说明","https://confluence.example.test/wiki/spaces/PAY/pages/785120"],
    ["ref-github-repo","github","Repository","repo-771","customer-data-platform","example/customer-data-platform","https://github.com/example/customer-data-platform"],
    ["ref-github-pay","github","Repository","repo-818","payment-reconciliation","example/payment-reconciliation","https://github.com/example/payment-reconciliation"],
    ["ref-leanix-app","leanix","Application","lx-app-201","APP-CRM-001","客户主数据平台","https://leanix.example.test/factsheet/lx-app-201"],
    ["ref-leanix-int-1","leanix","Interface","lx-int-331","INT-CRM-LEDGER","客户平台 → 总账系统接口","https://leanix.example.test/factsheet/lx-int-331"],
    ["ref-leanix-int-2","leanix","Interface","lx-int-417","INT-PAY-LEDGER","支付对账 → 总账系统接口","https://leanix.example.test/factsheet/lx-int-417"],
    ["ref-leanix-app-2","leanix","Application","lx-app-244","APP-PAY-014","支付对账服务","https://leanix.example.test/factsheet/lx-app-244"]
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
    link(arch,"ref-conf-adr","decision_record","architecture-decision-record","架构决策记录");
    link(arch,"ref-conf-review","review_evidence","architecture-review","架构评审记录");
    link(arch,"ref-github-repo","implementation_repository");
    link(arch,"ref-leanix-app","impacted_application");
    link(arch,"ref-leanix-int-1","impacted_interface");
  }
  if (payment) {
    link(payment,"ref-jira-story-3","implements");
    link(payment,"ref-conf-pay","solution_design","solution-design","解决方案设计");
    link(payment,"ref-github-pay","implementation_repository");
    link(payment,"ref-github-repo","shared_component");
    link(payment,"ref-leanix-app-2","impacted_application");
    link(payment,"ref-leanix-int-1","dependency");
    link(payment,"ref-leanix-int-2","impacted_interface");
  }
}
