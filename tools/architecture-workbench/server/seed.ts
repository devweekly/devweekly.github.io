import { createHash } from "node:crypto";
import { all, id, now, one, run } from "./db.js";

export function seed() {
  if (all("SELECT id FROM people LIMIT 1").length === 0) {
    const created = now();
    const people = [
      ["u-sa","Aiko Tanaka","Solution Architect","aiko@example.test","#4567a8"],
      ["u-ea","Kenji Sato","Enterprise Architect","kenji@example.test","#6b8f71"],
      ["u-sec","Mina Ito","Security Architect","mina@example.test","#9970a8"],
      ["u-sme","Yuki Mori","Business SME","yuki@example.test","#b17b52"],
      ["u-dev","Ryo Nakamura","Development Manager","ryo@example.test","#628f9f"],
      ["u-chair","Haru Watanabe","Architecture Review Chair","haru@example.test","#9e755d"],
      ["u-agent","Agent Execution Service","Agent Service Account","agent-service@example.test","#557c85"]
    ];
    for (const p of people) run("INSERT INTO people(id,display_name,title,email,avatar_color,created_at) VALUES(?,?,?,?,?,?)", ...p, created);
  }
  const servicePrincipal=one<{id:string}>("SELECT id FROM people WHERE id='u-agent'");
  if (!servicePrincipal) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
    "u-agent","Agent Execution Service","Agent Service Account","agent-service@example.test","#557c85","Architecture Platform","Local","用于执行分配给 Agent 的工作。它不是Administrator账号，只能获得具体事项所需的权限。",JSON.stringify(["Agent Task Execution","Artifact Draft Preparation","Task Coordination"]),"Asia/Tokyo",now());
  const admin=one<{id:string}>("SELECT id FROM people WHERE id='u-admin'");
  if (!admin) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)",
    "u-admin","Workbench Administrator","Administrator","admin@example.test","#344b70","Architecture Office","Tokyo","Maintains the people directory, work item workflows, and Workbench settings.",JSON.stringify(["People Management","Workflow Management","Workbench Administration"]),"Asia/Tokyo",now());
  run("UPDATE people SET is_admin=1 WHERE id='u-admin'");
  const profiles:Record<string,{department:string;location:string;bio:string;expertise:string[]}> = {
    "u-sa":{department:"解决方案架构",location:"Tokyo",bio:"Responsible for solution design and coordination across related systems and delivery teams.",expertise:["解决方案架构","System Integration","API Design","Cloud Platforms"]},
    "u-ea":{department:"Enterprise Architecture",location:"Tokyo",bio:"负责Enterprise Architecture标准、系统关系和技术路线。",expertise:["Enterprise Architecture","Capability Modeling","Architecture Standards","Technology Planning"]},
    "u-sec":{department:"Information Security",location:"Tokyo",bio:"Responsible for security reviews, focusing on identity and access, data protection, and operational risk.",expertise:["Security架构","Identity and Access Management","Threat Modeling","Data Protection"]},
    "u-sme":{department:"Business",location:"Tokyo",bio:"Familiar with the customer data platform and existing business processes; provides business input for solution reviews.",expertise:["Business Processes","Domain Knowledge","Requirements Analysis"]},
    "u-dev":{department:"Engineering",location:"Tokyo",bio:"Responsible for development planning, implementation, and production delivery.",expertise:["Software Development","Project Delivery","System Operations","Reliability"]},
    "u-chair":{department:"Architecture Office",location:"Tokyo",bio:"Chairs architecture review meetings and records formal decisions and follow-up requirements.",expertise:["架构评审","Technical Decision-making","Risk Assessment"]},
    "u-admin":{department:"Architecture Office",location:"Tokyo",bio:"Maintains the people directory, work item workflows, and Workbench settings.",expertise:["People Management","Workflow Management","Workbench Administration"]},
    "u-agent":{department:"Architecture Platform",location:"Local",bio:"用于执行分配给 Agent 的工作。它不是Administrator账号，只能获得具体事项所需的权限。",expertise:["Agent Task Execution","Artifact Draft Preparation","Task Coordination"]}
  };
  for (const [personId,profile] of Object.entries(profiles)) {
    run("UPDATE people SET department=CASE WHEN department='' THEN ? ELSE department END,location=CASE WHEN location='' THEN ? ELSE location END,bio=CASE WHEN bio='' THEN ? ELSE bio END,expertise_json=CASE WHEN expertise_json='[]' THEN ? ELSE expertise_json END WHERE id=?",
      profile.department,profile.location,profile.bio,JSON.stringify(profile.expertise),personId);
  }
  run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
  const workflowPrincipal=one<{id:string}>("SELECT id FROM people WHERE id='u-workflow'");
  if (!workflowPrincipal) run("INSERT INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
    "u-workflow","Workflow Automation Service","System Workflow Account","workflow@example.test","#667788","Architecture Platform","Local","Records workflow state changes and deadline events triggered automatically by the system.",JSON.stringify(["Deadline Handling","Workflow Automation"]),"Asia/Tokyo",now());
  const existingSeed=one<{id:string}>("SELECT id FROM work_items WHERE id='wi-arch-001'");
  if (existingSeed) {
    run("UPDATE participations SET role_key='chairman',role_label='Chairman',permissions_json=? WHERE work_item_id=? AND person_id='u-chair' AND role_key='decision_authority'",
      JSON.stringify(["read","decide"]),existingSeed.id);
    run("UPDATE work_items SET request_package_json=CASE WHEN request_package_json='{}' THEN ? ELSE request_package_json END WHERE id=?",
      JSON.stringify({goal:"Establish a unified way to access customer data and avoid duplicate customer master-data interfaces across systems.",scope:"Customer master data, transaction-query APIs, and migration of existing batch consumers.",constraints:"Existing end-of-day batch processing must remain until the end of Phase 1. Customer data must be isolated by tenant, and consumers cannot all migrate at once.",initialProposal:"Standardize customer identifiers and data contracts first, then provide query APIs and migrate consumers incrementally by system.",decisionQuestions:"Should a unified query API be adopted? Which layer owns tenant isolation? How long should the batch adapter remain?",submissionMessage:"Submit the customer data platform modernization proposal for review of API boundaries, data isolation, and migration planning."}),existingSeed.id);
    run("UPDATE submissions SET purpose='request',submission_message=CASE WHEN submission_message='' THEN ? ELSE submission_message END,package_json=CASE WHEN package_json='{}' THEN ? ELSE package_json END,submitted_by=COALESCE(submitted_by,created_by) WHERE work_item_id=? AND sequence=1",
      "Submit the customer data platform modernization proposal for review of API boundaries, data isolation, and migration planning.",
      JSON.stringify({goal:"Establish a unified way to access customer data and avoid duplicate customer master-data interfaces across systems.",scope:"Customer master data, transaction-query APIs, and migration of existing batch consumers.",constraints:"Existing end-of-day batch processing must remain until the end of Phase 1. Customer data must be isolated by tenant, and consumers cannot all migrate at once.",initialProposal:"Standardize customer identifiers and data contracts first, then provide query APIs and migrate consumers incrementally by system.",decisionQuestions:"Should a unified query API be adopted? Which layer owns tenant isolation? How long should the batch adapter remain?"}),
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
    JSON.stringify({goal:"Establish a unified way to access customer data and avoid duplicate customer master-data interfaces across systems.",scope:"Customer master data, transaction-query APIs, and migration of existing batch consumers.",constraints:"Existing end-of-day batch processing must remain until the end of Phase 1. Customer data must be isolated by tenant, and consumers cannot all migrate at once.",initialProposal:"Standardize customer identifiers and data contracts first, then provide query APIs and migrate consumers incrementally by system.",decisionQuestions:"Should a unified query API be adopted? Which layer owns tenant isolation? How long should the batch adapter remain?",submissionMessage:"Submit the customer data platform modernization proposal for review of API boundaries, data isolation, and migration planning."}),wi);
  run("UPDATE submissions SET submission_message=?,package_json=? WHERE id='sub-101' AND submission_message=''",
    "Submit the customer data platform modernization proposal for review of API boundaries, data isolation, and migration planning.",JSON.stringify({goal:"Establish a unified way to access customer data and avoid duplicate customer master-data interfaces across systems.",scope:"Customer master data, transaction-query APIs, and migration of existing batch consumers.",constraints:"Existing end-of-day batch processing must remain until the end of Phase 1. Customer data must be isolated by tenant, and consumers cannot all migrate at once.",initialProposal:"Standardize customer identifiers and data contracts first, then provide query APIs and migrate consumers incrementally by system.",decisionQuestions:"Should a unified query API be adopted? Which layer owns tenant isolation? How long should the batch adapter remain?"}));
  const packageValue={goal:"Establish a unified way to access customer data and avoid duplicate customer master-data interfaces across systems.",scope:"Customer master data, transaction-query APIs, and migration of existing batch consumers.",constraints:"Existing end-of-day batch processing must remain until the end of Phase 1. Customer data must be isolated by tenant, and consumers cannot all migrate at once.",initialProposal:"Standardize customer identifiers and data contracts first, then provide query APIs and migrate consumers incrementally by system.",decisionQuestions:"Should a unified query API be adopted? Which layer owns tenant isolation? How long should the batch adapter remain?",submissionMessage:"Submit the customer data platform modernization proposal for review of API boundaries, data isolation, and migration planning."};
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,requestor_id,chairman_id,request_package_json,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    wi,"ARC-2026-014","architecture_review","Customer Data Platform Modernization","Unify access to customer master data and transaction data. The proposal requires review of API boundaries, data isolation, legacy batch compatibility, and phased migration strategy.","discussion_review","high","u-sa","u-sa","u-chair",JSON.stringify(packageValue),"2026-12-08",4,created,created);
  const participants = [
    ["u-sa","solution_architect","Solution Architect",["read","contribute","comment"]],
    ["u-ea","enterprise_architect","Enterprise Architect",["read","review","comment","contribute"]],
    ["u-sec","security_architect","Security Architect",["read","review","comment"]],
    ["u-sme","solution_sme","Business SME",["read","comment","contribute"]],
    ["u-dev","development_manager","Development Manager",["read","review","comment","contribute"]],
    ["u-chair","chairman","会议主席",["read","decide"]]
  ];
  for (const p of participants) run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)", id("part"),wi,p[0],p[1],p[2],JSON.stringify(p[3]),created);
  run("UPDATE work_items SET chairman_id='u-chair' WHERE id=?",wi);
  const artifacts = [
    ["adr-101","ADR","ADR-001","API Gateway 与领域服务的边界","accepted","The API Gateway provides a unified entry point; domain services retain business authorization and data-access control.","Decision\nBusiness authorization is owned by domain services.\n\nAlternatives\nA. Centralize all authorization policies in the API Gateway.\nB. Let domain services enforce authorization based on business resources.\n\nConsequences\nThe API Gateway handles edge controls; domain services enforce resource-level authorization."],
    ["adr-102","ADR","ADR-002","Customer Sensitive Data Isolation Strategy","proposed","Distinguish tenant isolation, field-level protection, and audit requirements.","Context\nCustomer records contain sensitive information, so data access must be isolated by tenant.\n\nApproach\nRestrict data access by tenant, protect designated fields, and maintain tamper-resistant access audits."],
    ["adr-103","ADR","ADR-003","Transitional Compatibility for Legacy Batch Processing","proposed","Keep the adapter during Phase 1 and replace it with event-driven processing later.","Context\nThe existing batch interface cannot be replaced before the next release window.\n\nApproach\nKeep an adapter temporarily, monitor its operation, and register a follow-up removal task."],
    ["doc-101","Architecture Overview",null,"Target Architecture and Migration Roadmap","submitted","Phased migration: data ingestion, unified access layer, and consumer migration.","Target Architecture\nEstablish a unified customer-data access layer while keeping business authorization in each domain service.\n\nMigration Steps\n1. Standardize customer identifiers.\n2. Establish an API facade and data contracts.\n3. Migrate consumers incrementally by business system."]
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
    "cycle-101",wi,"sub-101","Review Cycle 1",JSON.stringify(reviewBaseline),"active","2026-11-27",seedDeadline,
    JSON.stringify([{person_id:"u-ea",display_name:"Kenji Sato",role_key:"enterprise_architect"},{person_id:"u-sec",display_name:"Mina Ito",role_key:"security_architect"},{person_id:"u-dev",display_name:"Ryo Nakamura",role_key:"development_manager"}]),"u-sa",created);
  run("INSERT INTO workflow_timers(id,work_item_id,cycle_id,submission_id,timer_type,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "timer-seed-review",wi,"cycle-101","sub-101","review_deadline",seedDeadline,"scheduled",created,created);
  const reviews = [
    ["rev-101","adr-101","u-ea","Enterprise Architecture","comment","The boundaries are clear. Consider adding the relationship between the API lifecycle and the standards catalog.",["Add API versioning requirements","Clarify domain-service responsibilities"]],
    ["rev-102","adr-102","u-sec","Security","comment","The overall direction is viable, but field-level protection and audit-retention requirements need clarification.",["Provide the rationale for sensitive-field classification","Specify audit-retention periods and query permissions"]],
    ["rev-103","adr-103","u-dev","Delivery","comment","过渡适配器可降低Delivery风险，但必须定义退出条件。",["Specify the target release for adapter removal","Clarify ownership of failure replay and monitoring"]]
  ];
  for (const r of reviews) run("INSERT INTO reviews(id,cycle_id,artifact_id,artifact_version,reviewer_id,discipline,outcome,summary,findings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    r[0],"cycle-101",r[1],1,r[2],r[3],r[4],r[5],JSON.stringify(r[6]),created);
  const tasks = [
    ["task-101","Add sensitive-field classification and audit requirements to ADR-002","revision","in_progress","u-sa","u-sa","2026-11-25","adr-102"],
    ["task-102","Confirm exit criteria for the batch adapter","analysis","open","u-sa","u-sme","2026-11-28","adr-103"],
    ["task-103","Prepare decision materials for the architecture review","decision_prep","open","u-sa","u-chair","2026-11-27",null]
  ];
  for (const t of tasks) run("INSERT INTO tasks(id,work_item_id,title,kind,status,owner_id,assignee_id,due_date,relates_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",t[0],wi,t[1],t[2],t[3],t[4],t[5],t[6],t[7],created,created);
  run("INSERT INTO comments(id,work_item_id,author_id,body,created_at) VALUES(?,?,?,?,?)","comment-101",wi,"u-sme","Business confirmation: Phase 1 must remain compatible with the existing end-of-day batch window. All consumers cannot be required to switch simultaneously.",created);
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",id("evt"),wi,"u-sa","submitted","work_item",wi,"提交架构方案与 3 份 ADR，进入Review Cycle 1。","{}",created);
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",id("evt"),wi,"u-sec","reviewed","artifact","adr-102","Security评审员提交了修改意见。","{}",created);
  const second = "wi-change-002";
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,requestor_id,chairman_id,request_package_json,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    second,"CHG-2026-021","change_assessment","Payment Reconciliation Service Resilience Improvements","Assess the change impact of retry policies, bulk compensation, and runtime isolation.","draft","normal","u-dev","u-dev","u-chair",
    JSON.stringify({goal:"Reduce the need for manual data correction when payment reconciliation jobs fail due to transient errors.",scope:"Retry policy, bulk compensation workflow, and task execution isolation.",constraints:"The existing settlement window cannot be extended. Retries and compensation must prevent duplicate postings.",initialProposal:"Set retry limits and intervals for retryable errors; make compensation tasks idempotent.",decisionQuestions:"Which errors can be retried automatically? Who owns compensation tasks? Is a dedicated execution queue required?",submissionMessage:"Submit the payment reconciliation service change proposal, defining retry scope, compensation ownership, and runtime isolation."}),
    "2026-12-15",2,created,created);
  for (const p of [["u-dev","delivery_owner","Delivery负责人",["read","contribute","comment"]],["u-sa","architect","Architect",["read","review","comment"]],["u-chair","chairman","会议主席",["read","decide"]]]) {
    run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),second,p[0],p[1],p[2],JSON.stringify(p[3]),created);
  }
  run("INSERT INTO tasks(id,work_item_id,title,kind,status,owner_id,assignee_id,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)","task-201",second,"Map the current failure, retry, and compensation paths","analysis","in_progress","u-dev","u-dev","2026-11-29",created,created);
  const debt = "wi-debt-001";
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,context_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",debt,"DEBT-2026-006","technical_debt","Remove the legacy batch adapter from the customer data platform","The temporary compatibility approach in ADR-003 requires removing the adapter after consumer migration is complete.","open","high","u-dev","2027-03-31",1,created,created);
  run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),debt,"u-dev","debt_owner","Technical Debt Owner",JSON.stringify(["read","contribute","comment","manage"]),created);
  run("INSERT INTO debt_details(work_item_id,severity,priority,target_state,remediation_plan,status,due_date) VALUES(?,?,?,?,?,?,?)",debt,"medium","high","All consumers use event-driven interfaces and no longer depend on the batch adapter.","Migrate one consumer at a time and retain dual-run metrics. Remove the adapter after two consecutive release windows with no calls.","open","2027-03-31");
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
    "wf-seed-review",workItemId,"draft","discussion_review","submit_request","The request package was submitted and the review timer has started.","u-sa",created);
}

function seedExternalReferences() {
  const created = now();
  const resources = [
    ["ref-jira-story-1","jira","Story","100412","DATA-412","Provide customer profile query API","https://jira.example.test/browse/DATA-412"],
    ["ref-jira-story-2","jira","Story","100418","DATA-418","Define tenant-isolation rules for customer data","https://jira.example.test/browse/DATA-418"],
    ["ref-jira-story-3","jira","Story","100521","PAY-521","Add idempotent retries for reconciliation","https://jira.example.test/browse/PAY-521"],
    ["ref-conf-adr","confluence","Page","785001","ADR-002","ADR-002 · 客户Data Protection","https://confluence.example.test/wiki/spaces/ARCH/pages/785001"],
    ["ref-conf-review","confluence","Page","785010","ARC-014-REVIEW","Customer Data Platform · Architecture Review","https://confluence.example.test/wiki/spaces/ARCH/pages/785010"],
    ["ref-conf-pay","confluence","Page","785120","PAY-021-DESIGN","Payment Reconciliation Service Design","https://confluence.example.test/wiki/spaces/PAY/pages/785120"],
    ["ref-github-repo","github","Repository","repo-771","customer-data-platform","example/customer-data-platform","https://github.com/example/customer-data-platform"],
    ["ref-github-pay","github","Repository","repo-818","payment-reconciliation","example/payment-reconciliation","https://github.com/example/payment-reconciliation"],
    ["ref-leanix-app","leanix","Application","lx-app-201","APP-CRM-001","Customer Master Data Platform","https://leanix.example.test/factsheet/lx-app-201"],
    ["ref-leanix-int-1","leanix","Interface","lx-int-331","INT-CRM-LEDGER","Customer Platform → General Ledger Interface","https://leanix.example.test/factsheet/lx-int-331"],
    ["ref-leanix-int-2","leanix","Interface","lx-int-417","INT-PAY-LEDGER","Payment Reconciliation → General Ledger Interface","https://leanix.example.test/factsheet/lx-int-417"],
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
