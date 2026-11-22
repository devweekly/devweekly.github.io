import "dotenv/config";
import express from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { all, db, id, now, one, run } from "./db.js";
import { createObjectStore } from "./object-store.js";
import { seed } from "./seed.js";

seed();
const app = express();
const port = Number(process.env.PORT || 4000);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const objectStore = createObjectStore();
app.use(express.json({ limit: "2mb" }));

function actorId(req: express.Request) { return req.header("x-demo-user-id") || "u-sa"; }
function logActivity(workItemId: string, actor: string, action: string, targetType: string, targetId: string | null, summary: string, metadata: unknown = {}) {
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",id("evt"),workItemId,actor,action,targetType,targetId,summary,JSON.stringify(metadata),now());
}
function permissions(workItemId: string, actor: string): string[] {
  const parts = all<{permissions_json:string}>("SELECT permissions_json FROM participations WHERE work_item_id=? AND person_id=?",workItemId,actor);
  return [...new Set(parts.flatMap(part=>JSON.parse(part.permissions_json) as string[]))];
}
function can(workItemId: string, actor: string, permission: string) {
  const granted = permissions(workItemId,actor);
  return granted.includes(permission);
}
function requirePermission(res: express.Response, workItemId: string, actor: string, permission: string) {
  if (!can(workItemId,actor,"read")) { res.status(403).json({error:"You are not a participant of this Work Item."}); return false; }
  if (!can(workItemId,actor,permission)) { res.status(403).json({error:"The current participation does not grant: "+permission}); return false; }
  return true;
}
app.get("/api/health",(_req,res)=>res.json({ok:true,database:"sqlite",storage:process.env.STORAGE_DRIVER || "local"}));

app.get("/api/bootstrap",(req,res)=>{
  const actor = actorId(req);
  const people = all("SELECT id,display_name,title,email,avatar_color FROM people ORDER BY display_name");
  const workItems = all("SELECT w.*,p.display_name AS owner_name,(SELECT COUNT(*) FROM artifacts a WHERE a.work_item_id=w.id) AS artifact_count,(SELECT COUNT(*) FROM tasks t WHERE t.work_item_id=w.id AND t.status NOT IN ('done','cancelled')) AS open_task_count FROM work_items w JOIN people p ON p.id=w.owner_id WHERE w.type <> 'technical_debt' AND EXISTS (SELECT 1 FROM participations mine WHERE mine.work_item_id=w.id AND mine.person_id=?) ORDER BY w.updated_at DESC",actor);
  const debts = all("SELECT w.id,w.code,w.title,w.status,w.owner_id,w.target_date,w.priority,p.display_name AS owner_name,d.severity,d.target_state,d.remediation_plan,d.status AS debt_status,d.source_decision_id FROM work_items w JOIN debt_details d ON d.work_item_id=w.id JOIN people p ON p.id=w.owner_id WHERE EXISTS (SELECT 1 FROM participations mine WHERE mine.work_item_id=w.id AND mine.person_id=?) OR EXISTS (SELECT 1 FROM work_item_relations rel JOIN participations origin_part ON origin_part.work_item_id=rel.source_work_item_id WHERE rel.target_work_item_id=w.id AND origin_part.person_id=?) ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,w.target_date",actor,actor);
  const counts = {
    openWorkItems: one<{n:number}>("SELECT COUNT(*) AS n FROM work_items WHERE type <> 'technical_debt' AND status NOT IN ('closed','rejected')")?.n || 0,
    awaitingReview: one<{n:number}>("SELECT COUNT(*) AS n FROM work_items WHERE type <> 'technical_debt' AND status='in_review'")?.n || 0,
    activeDebts: one<{n:number}>("SELECT COUNT(*) AS n FROM debt_details WHERE status IN ('open','in_progress')")?.n || 0,
    myTasks: one<{n:number}>("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled')",actor)?.n || 0
  };
  res.json({actorId:actor,people,workItems,debts,counts});
});
app.get("/api/analytics",(req,res)=>{
  const actor=actorId(req);
  const requests=all<{id:string;code:string;title:string;type:string;status:string;priority:string;created_at:string;target_date:string|null}>(
    "SELECT w.id,w.code,w.title,w.type,w.status,w.priority,w.created_at,w.target_date FROM work_items w WHERE w.type <> 'technical_debt' AND EXISTS (SELECT 1 FROM participations p WHERE p.work_item_id=w.id AND p.person_id=?)",actor);
  const visibleRequestIds=requests.map(r=>r.id);
  const debts=all<{id:string;code:string;title:string;status:string;priority:string;severity:string;created_at:string;target_date:string|null;owner_name:string}>(
    "SELECT w.id,w.code,w.title,w.status,w.priority,d.severity,w.created_at,COALESCE(d.due_date,w.target_date) AS target_date,p.display_name AS owner_name FROM work_items w JOIN debt_details d ON d.work_item_id=w.id JOIN people p ON p.id=w.owner_id WHERE EXISTS (SELECT 1 FROM participations dp WHERE dp.work_item_id=w.id AND dp.person_id=?) OR EXISTS (SELECT 1 FROM work_item_relations rel JOIN participations op ON op.work_item_id=rel.source_work_item_id WHERE rel.target_work_item_id=w.id AND op.person_id=?)",actor,actor);
  const links=visibleRequestIds.length
    ? all<{provider:string;work_item_id:string}>("SELECT r.provider,l.work_item_id FROM work_item_external_links l JOIN external_resource_refs r ON r.id=l.resource_id WHERE l.work_item_id IN ("+visibleRequestIds.map(()=>"?").join(",")+")",...visibleRequestIds)
    : [];
  const group=(rows:Array<{[key:string]:unknown}>,field:string)=>{
    const counts:Record<string,number>={};
    for(const row of rows){const key=String(row[field] ?? "unknown");counts[key]=(counts[key] || 0)+1;}
    return Object.entries(counts).map(([key,count])=>({key,count})).sort((a,b)=>b.count-a.count);
  };
  const ageDays=(createdAt:string)=>Math.max(0,Math.floor((Date.now()-new Date(createdAt).getTime())/86400000));
  const aging=(rows:Array<{created_at:string}>)=>{
    const buckets=[{key:"0-7",label:"0–7 天",count:0},{key:"8-30",label:"8–30 天",count:0},{key:"31-90",label:"31–90 天",count:0},{key:"90+",label:"90 天以上",count:0}];
    for(const row of rows){const days=ageDays(row.created_at);const index=days<=7?0:days<=30?1:days<=90?2:3;buckets[index].count++;}
    return buckets;
  };
  const today=new Date().toISOString().slice(0,10);
  const soon=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const requestLinkedIds=new Set(links.map(link=>link.work_item_id));
  const providerCoverage=["jira","confluence","github","leanix"].map(provider=>({
    key:provider,count:links.filter(link=>link.provider===provider).length,
    requestCount:new Set(links.filter(link=>link.provider===provider).map(link=>link.work_item_id)).size
  }));
  const origins=debts.length && visibleRequestIds.length
    ? all<{code:string;title:string;debt_count:number}>(
      "SELECT source.code,source.title,COUNT(*) AS debt_count FROM work_item_relations rel JOIN work_items source ON source.id=rel.source_work_item_id JOIN debt_details debt ON debt.work_item_id=rel.target_work_item_id WHERE source.id IN ("+
      visibleRequestIds.map(()=>"?").join(",")+") GROUP BY source.id ORDER BY debt_count DESC",...visibleRequestIds)
    : [];
  res.json({
    generatedAt:now(),
    requests:{
      total:requests.length,
      active:requests.filter(r=>!["accepted","rejected","closed"].includes(r.status)).length,
      inReview:requests.filter(r=>r.status==="in_review").length,
      overdue:requests.filter(r=>r.target_date && r.target_date<today && !["accepted","rejected","closed"].includes(r.status)).length,
      linked:requestLinkedIds.size,
      withoutExternalLinks:requests.length-requestLinkedIds.size,
      byStatus:group(requests as unknown as Array<{[key:string]:unknown}>,"status"),
      byType:group(requests as unknown as Array<{[key:string]:unknown}>,"type"),
      byPriority:group(requests as unknown as Array<{[key:string]:unknown}>,"priority"),
      aging:aging(requests),
      externalSystems:providerCoverage,
      externalReferenceCount:links.length
    },
    technicalDebt:{
      total:debts.length,
      active:debts.filter(d=>!["resolved","cancelled"].includes(d.status)).length,
      overdue:debts.filter(d=>d.target_date && d.target_date<today && !["resolved","cancelled"].includes(d.status)).length,
      dueNext30Days:debts.filter(d=>d.target_date && d.target_date>=today && d.target_date<=soon && !["resolved","cancelled"].includes(d.status)).length,
      byStatus:group(debts as unknown as Array<{[key:string]:unknown}>,"status"),
      bySeverity:group(debts as unknown as Array<{[key:string]:unknown}>,"severity"),
      byPriority:group(debts as unknown as Array<{[key:string]:unknown}>,"priority"),
      aging:aging(debts),
      byOriginRequest:origins
    }
  });
});

app.get("/api/work-items",(req,res)=>res.json(all("SELECT w.*,p.display_name AS owner_name,(SELECT COUNT(*) FROM artifacts a WHERE a.work_item_id=w.id) AS artifact_count,(SELECT COUNT(*) FROM tasks t WHERE t.work_item_id=w.id AND t.status NOT IN ('done','cancelled')) AS open_task_count FROM work_items w JOIN people p ON p.id=w.owner_id WHERE w.type <> 'technical_debt' AND EXISTS (SELECT 1 FROM participations mine WHERE mine.work_item_id=w.id AND mine.person_id=?) ORDER BY w.updated_at DESC",actorId(req))));

app.post("/api/work-items",(req,res)=>{
  const actor = actorId(req); const body = req.body || {};
  if (!body.title || !body.type) return res.status(400).json({error:"title and type are required"});
  const workItemId = id("wi"); const code = "WI-"+new Date().getFullYear()+"-"+Math.floor(Date.now()/1000).toString().slice(-6); const timestamp=now();
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",workItemId,code,body.type,String(body.title),String(body.description || ""),"draft",body.priority || "normal",actor,body.targetDate || null,timestamp,timestamp);
  run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),workItemId,actor,"owner","Work Item Owner",JSON.stringify(["read","contribute","comment","review","manage"]),timestamp);
  logActivity(workItemId,actor,"created","work_item",workItemId,"Created Work Item "+code);
  res.status(201).json({id:workItemId,code});
});

app.post("/api/work-items/:id/participations",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"manage")) return;
  const body=req.body || {};
  const allowed=["read","contribute","comment","review","decide","manage"];
  if (!body.personId || !body.roleKey || !body.roleLabel || !Array.isArray(body.permissions)) return res.status(400).json({error:"personId, roleKey, roleLabel and permissions are required"});
  if (!one("SELECT id FROM people WHERE id=?",body.personId)) return res.status(400).json({error:"Unknown participant"});
  if (body.permissions.some((p:string)=>!allowed.includes(p))) return res.status(400).json({error:"Unsupported permission"});
  if (!body.permissions.includes("read")) return res.status(400).json({error:"Every Participation must include read permission."});
  const existing=one<{id:string}>("SELECT id FROM participations WHERE work_item_id=? AND person_id=? AND role_key=?",workItemId,body.personId,body.roleKey);
  if (existing) {
    run("UPDATE participations SET role_label=?,permissions_json=? WHERE id=?",body.roleLabel,JSON.stringify(body.permissions),existing.id);
  } else {
    run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),workItemId,body.personId,body.roleKey,body.roleLabel,JSON.stringify(body.permissions),now());
  }
  logActivity(workItemId,actor,"participation_updated","participation",body.personId,"Updated participation for "+body.roleLabel);
  res.status(200).json({ok:true});
});

app.get("/api/work-items/:id",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"read")) return;
  const workItem=one("SELECT w.*,p.display_name AS owner_name FROM work_items w JOIN people p ON p.id=w.owner_id WHERE w.id=?",workItemId);
  if (!workItem) return res.status(404).json({error:"Work Item not found"});
  const participants=all("SELECT pt.*,p.display_name,p.title,p.email,p.avatar_color FROM participations pt JOIN people p ON p.id=pt.person_id WHERE pt.work_item_id=? ORDER BY p.display_name",workItemId);
  const artifacts=all("SELECT a.*,p.display_name AS submitter_name FROM artifacts a JOIN people p ON p.id=a.submitted_by WHERE a.work_item_id=? ORDER BY a.created_at DESC",workItemId);
  const cycles=all("SELECT * FROM review_cycles WHERE work_item_id=? ORDER BY created_at DESC",workItemId);
  const reviews=all("SELECT r.*,p.display_name AS reviewer_name,a.code AS artifact_code,a.title AS artifact_title FROM reviews r JOIN people p ON p.id=r.reviewer_id JOIN artifacts a ON a.id=r.artifact_id JOIN review_cycles c ON c.id=r.cycle_id WHERE c.work_item_id=? ORDER BY r.created_at DESC",workItemId);
  const tasks=all("SELECT t.*,p.display_name AS assignee_name FROM tasks t LEFT JOIN people p ON p.id=t.assignee_id WHERE t.work_item_id=? ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,t.due_date",workItemId);
  const decisions=all("SELECT d.*,p.display_name AS decision_maker_name FROM decisions d JOIN people p ON p.id=d.decision_maker_id WHERE d.work_item_id=? ORDER BY d.created_at DESC",workItemId);
  const comments=all("SELECT c.*,p.display_name AS author_name,p.avatar_color FROM comments c JOIN people p ON p.id=c.author_id WHERE c.work_item_id=? ORDER BY c.created_at DESC",workItemId);
  const activity=all("SELECT e.*,p.display_name AS actor_name FROM activity_events e JOIN people p ON p.id=e.actor_id WHERE e.work_item_id=? ORDER BY e.created_at DESC LIMIT 30",workItemId);
  const attachments=all("SELECT id,original_name,content_type,size_bytes,uploaded_by,created_at FROM attachments WHERE work_item_id=? ORDER BY created_at DESC",workItemId);
  const externalLinks=all("SELECT l.id,l.relation_type,l.confluence_template_key,l.confluence_template_name,l.created_at,r.provider,r.resource_type,r.external_id,r.external_key,r.title,r.url FROM work_item_external_links l JOIN external_resource_refs r ON r.id=l.resource_id WHERE l.work_item_id=? ORDER BY r.provider,r.resource_type,r.title",workItemId);
  res.json({workItem,participants,artifacts,cycles,reviews,tasks,decisions,comments,activity,attachments,externalLinks,permissions:permissions(workItemId,actor)});
});

app.post("/api/work-items/:id/artifacts",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"contribute")) return;
  const body=req.body || {};
  if (!body.title || !body.type || !body.content) return res.status(400).json({error:"title, type and content are required"});
  const code=body.code ? String(body.code) : null;
  const latest=code ? one<{version:number}>("SELECT MAX(version) AS version FROM artifacts WHERE work_item_id=? AND code=?",workItemId,code) : undefined;
  const version=(latest?.version || 0)+1; const artifactId=id("art"); const content=String(body.content);
  const hash=Buffer.from(content).toString("base64").slice(0,32);
  run("INSERT INTO artifacts(id,work_item_id,type,code,title,version,status,summary,content,submitted_by,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",artifactId,workItemId,body.type,code,body.title,version,body.status || "draft",body.summary || "",content,actor,hash,now());
  run("UPDATE work_items SET context_version=context_version+1,updated_at=? WHERE id=?",now(),workItemId);
  logActivity(workItemId,actor,"submitted","artifact",artifactId,"Submitted "+(code || body.type)+" v"+version);
  res.status(201).json({id:artifactId,code,version});
});

app.post("/api/work-items/:id/reviews",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"review")) return;
  const body=req.body || {};
  const artifact=one<{id:string;version:number;title:string;submitted_by:string}>("SELECT id,version,title,submitted_by FROM artifacts WHERE id=? AND work_item_id=?",body.artifactId,workItemId);
  if (!artifact) return res.status(400).json({error:"Review target does not belong to this Work Item."});
  if (artifact.submitted_by===actor) return res.status(403).json({error:"Independent review cannot be submitted by the Artifact author."});
  let cycle=one<{id:string;baseline_json:string;name:string}>("SELECT id,baseline_json,name FROM review_cycles WHERE work_item_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",workItemId);
  const baselineEntry={id:artifact.id,version:artifact.version};
  const baseline=cycle ? JSON.parse(cycle.baseline_json) as {id:string;version:number}[] : [];
  if (!cycle || !baseline.some(entry=>entry.id===artifact.id && entry.version===artifact.version)) {
    if (cycle) run("UPDATE review_cycles SET status='closed' WHERE id=?",cycle.id);
    const latest=all<{id:string;version:number}>(
      "SELECT a.id,a.version FROM artifacts a WHERE a.work_item_id=? AND NOT EXISTS (SELECT 1 FROM artifacts newer WHERE newer.work_item_id=a.work_item_id AND COALESCE(newer.code,newer.id)=COALESCE(a.code,a.id) AND newer.version>a.version)",
      workItemId
    );
    const cycleId=id("cycle");
    const roundCount=one<{n:number}>("SELECT COUNT(*) AS n FROM review_cycles WHERE work_item_id=?",workItemId)?.n || 0;
    run("INSERT INTO review_cycles(id,work_item_id,name,baseline_json,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      cycleId,workItemId,"Review round "+(roundCount+1),JSON.stringify(latest.length ? latest : [baselineEntry]),"active",actor,now());
    cycle={id:cycleId,baseline_json:JSON.stringify(latest.length ? latest : [baselineEntry]),name:"Review round "+(roundCount+1)};
  }
  const reviewId=id("rev");
  run("INSERT INTO reviews(id,cycle_id,artifact_id,artifact_version,reviewer_id,discipline,outcome,summary,findings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",reviewId,cycle.id,artifact.id,artifact.version,actor,body.discipline || "General",body.outcome || "comment",body.summary || "",JSON.stringify(body.findings || []),now());
  logActivity(workItemId,actor,"reviewed","artifact",artifact.id,"Submitted "+(body.outcome || "comment")+" review for "+artifact.title);
  res.status(201).json({id:reviewId});
});

app.post("/api/work-items/:id/tasks",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"contribute")) return;
  const body=req.body || {}; if (!body.title) return res.status(400).json({error:"title is required"});
  if (body.assigneeId && !one("SELECT id FROM participations WHERE work_item_id=? AND person_id=?",workItemId,body.assigneeId)) return res.status(400).json({error:"Task assignee must be a participant of this Work Item."});
  const taskId=id("task"); const timestamp=now();
  run("INSERT INTO tasks(id,work_item_id,title,kind,status,assignee_id,due_date,relates_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",taskId,workItemId,body.title,body.kind || "analysis","open",body.assigneeId || null,body.dueDate || null,body.relatesTo || null,timestamp,timestamp);
  logActivity(workItemId,actor,"created","task",taskId,"Created task: "+body.title);
  res.status(201).json({id:taskId});
});

app.patch("/api/tasks/:id",(req,res)=>{
  const taskId=String(req.params.id); const actor=actorId(req);
  const task=one<{work_item_id:string}>("SELECT work_item_id FROM tasks WHERE id=?",taskId);
  if (!task) return res.status(404).json({error:"Task not found"});
  if (!requirePermission(res,task.work_item_id,actor,"contribute")) return;
  const body=req.body || {};
  const statuses=["open","in_progress","blocked","done","cancelled"];
  if (body.status && !statuses.includes(body.status)) return res.status(400).json({error:"Unsupported task status"});
  if (body.assigneeId && !one("SELECT id FROM participations WHERE work_item_id=? AND person_id=?",task.work_item_id,body.assigneeId)) {
    return res.status(400).json({error:"Task assignee must be a participant of this Work Item."});
  }
  run("UPDATE tasks SET status=COALESCE(?,status),assignee_id=COALESCE(?,assignee_id),due_date=COALESCE(?,due_date),updated_at=? WHERE id=?",
    body.status || null,body.assigneeId || null,body.dueDate || null,now(),taskId);
  logActivity(task.work_item_id,actor,"updated","task",taskId,"Task updated",{status:body.status,assigneeId:body.assigneeId});
  res.json({ok:true});
});

app.post("/api/work-items/:id/decisions",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"decide")) return;
  const body=req.body || {}; const outcomes=["accepted","rejected","more_analysis","accepted_with_conditions"];
  if (!outcomes.includes(body.outcome)) return res.status(400).json({error:"Unsupported decision outcome"});
  if (!body.rationale) return res.status(400).json({error:"A rationale is required"});
  if (body.subjectType==="artifact" && !one("SELECT id FROM artifacts WHERE id=? AND work_item_id=?",body.subjectId,workItemId)) {
    return res.status(400).json({error:"Decision subject must be an Artifact in this Work Item."});
  }
  const decisionId=id("dec");
  run("INSERT INTO decisions(id,work_item_id,subject_type,subject_id,outcome,rationale,conditions,decision_maker_id,policy_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",decisionId,workItemId,body.subjectType || "work_item",body.subjectId || null,body.outcome,body.rationale,body.conditions || "",actor,"prototype-policy-v1",now());
  logActivity(workItemId,actor,"decided","decision",decisionId,"Decision recorded: "+body.outcome,{subjectType:body.subjectType || "work_item",subjectId:body.subjectId || null});
  if ((body.subjectType || "work_item")==="work_item") {
    const nextStatus=body.outcome==="more_analysis" ? "analysis" : body.outcome==="rejected" ? "rejected" : "accepted";
    run("UPDATE work_items SET status=?,context_version=context_version+1,updated_at=? WHERE id=?",nextStatus,now(),workItemId);
  }
  if (body.outcome==="more_analysis") {
    const taskId=id("task");
    run("INSERT INTO tasks(id,work_item_id,title,kind,status,assignee_id,due_date,relates_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",taskId,workItemId,body.followUpTitle || "Complete additional analysis","analysis","open",body.followUpOwnerId || null,body.followUpDueDate || null,body.subjectId || null,now(),now());
  }
  let debtId: string | null=null;
  if (body.technicalDebt?.title && body.outcome==="accepted_with_conditions") {
    const debt=body.technicalDebt; debtId=id("wi");
    const debtCode="DEBT-"+new Date().getFullYear()+"-"+Math.floor(Date.now()/1000).toString().slice(-6);
    run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",debtId,debtCode,"technical_debt",debt.title,debt.description || body.conditions || "","open",debt.priority || "normal",debt.ownerId || actor,debt.dueDate || null,now(),now());
    run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),debtId,debt.ownerId || actor,"debt_owner","Technical Debt Owner",JSON.stringify(["read","contribute","comment","manage"]),now());
    run("INSERT INTO debt_details(work_item_id,severity,priority,target_state,remediation_plan,status,source_decision_id,due_date) VALUES(?,?,?,?,?,?,?,?)",debtId,debt.severity || "medium",debt.priority || "normal",debt.targetState || "",debt.remediationPlan || "","open",decisionId,debt.dueDate || null);
    run("INSERT INTO work_item_relations(id,source_work_item_id,target_work_item_id,relation_type,decision_id,created_at) VALUES(?,?,?,?,?,?)",id("rel"),workItemId,debtId,"generated_technical_debt",decisionId,now());
    logActivity(debtId,actor,"created","technical_debt",debtId,"Created from decision "+decisionId);
  }
  res.status(201).json({id:decisionId,technicalDebtId:debtId});
});

app.post("/api/tech-debts",(req,res)=>{
  const actor=actorId(req); const body=req.body || {};
  if (!body.title || !body.originWorkItemId || !body.rationale) return res.status(400).json({error:"title, originWorkItemId and rationale are required"});
  if (!requirePermission(res,body.originWorkItemId,actor,"contribute")) return;
  const debtId=id("wi"); const debtCode="DEBT-"+new Date().getFullYear()+"-"+Math.floor(Date.now()/1000).toString().slice(-6);
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",debtId,debtCode,"technical_debt",body.title,body.rationale,"open",body.priority || "normal",body.ownerId || actor,body.dueDate || null,now(),now());
  run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),debtId,body.ownerId || actor,"debt_owner","Technical Debt Owner",JSON.stringify(["read","contribute","comment","manage"]),now());
  run("INSERT INTO debt_details(work_item_id,severity,priority,target_state,remediation_plan,status,source_decision_id,due_date) VALUES(?,?,?,?,?,?,?,?)",debtId,body.severity || "medium",body.priority || "normal",body.targetState || "",body.remediationPlan || "","open",body.decisionId || null,body.dueDate || null);
  run("INSERT INTO work_item_relations(id,source_work_item_id,target_work_item_id,relation_type,decision_id,created_at) VALUES(?,?,?,?,?,?)",id("rel"),body.originWorkItemId,debtId,"generated_technical_debt",body.decisionId || null,now());
  logActivity(body.originWorkItemId,actor,"linked","technical_debt",debtId,"Recorded technical debt "+debtCode);
  res.status(201).json({id:debtId,code:debtCode});
});

app.patch("/api/tech-debts/:id",(req,res)=>{
  const debtId=String(req.params.id); const actor=actorId(req);
  const debt=one<{work_item_id:string}>("SELECT work_item_id FROM debt_details WHERE work_item_id=?",debtId);
  if (!debt) return res.status(404).json({error:"Technical debt not found"});
  if (!requirePermission(res,debtId,actor,"manage")) return;
  const body=req.body || {}; const status=body.status || "open";
  if (!["open","in_progress","deferred","resolved","cancelled"].includes(status)) return res.status(400).json({error:"Unsupported debt status"});
  run("UPDATE debt_details SET status=?,due_date=COALESCE(?,due_date),remediation_plan=COALESCE(?,remediation_plan) WHERE work_item_id=?",status,body.dueDate || null,body.remediationPlan || null,debtId);
  run("UPDATE work_items SET status=?,updated_at=? WHERE id=?",status,now(),debtId);
  logActivity(debtId,actor,"updated","technical_debt",debtId,"Technical debt status changed to "+status);
  res.json({ok:true});
});

app.post("/api/work-items/:id/comments",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"comment")) return;
  const body=req.body || {}; if (!body.body) return res.status(400).json({error:"body is required"});
  const commentId=id("comment");
  run("INSERT INTO comments(id,work_item_id,author_id,body,created_at) VALUES(?,?,?,?,?)",commentId,workItemId,actor,body.body,now());
  logActivity(workItemId,actor,"commented","comment",commentId,"Added a discussion message");
  res.status(201).json({id:commentId});
});

app.get("/api/work-items/:id/context-capsule",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"read")) return;
  const workItem=one("SELECT id,code,type,title,description,status,context_version FROM work_items WHERE id=?",workItemId);
  if (!workItem) return res.status(404).json({error:"Work Item not found"});
  const participants=all("SELECT p.display_name,pt.role_label FROM participations pt JOIN people p ON p.id=pt.person_id WHERE pt.work_item_id=?",workItemId);
  const artifacts=all("SELECT id,type,code,title,version,status,summary,content_hash FROM artifacts WHERE work_item_id=? ORDER BY created_at DESC",workItemId);
  const reviews=all("SELECT r.discipline,r.outcome,r.summary,a.code,a.title FROM reviews r JOIN review_cycles c ON c.id=r.cycle_id JOIN artifacts a ON a.id=r.artifact_id WHERE c.work_item_id=?",workItemId);
  const externalResources=all("SELECT r.provider,r.resource_type,r.external_id,r.external_key,r.title,r.url,l.relation_type,l.confluence_template_key,l.confluence_template_name FROM work_item_external_links l JOIN external_resource_refs r ON r.id=l.resource_id WHERE l.work_item_id=?",workItemId);
  res.json({workItem,participants,artifacts,reviews,externalResources,generatedAt:now(),note:"These are external resource references, not synchronized data. This application does not call Jira, Confluence, GitHub or LeanIX. An optional Workbench Agent may resolve the references through its own configured MCP/API tools, subject to those systems' access controls."});
});

app.post("/api/work-items/:id/external-links",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"contribute")) return;
  const body=req.body || {};
  const providers=["jira","confluence","github","leanix"];
  if (!providers.includes(body.provider)) return res.status(400).json({error:"Unsupported external provider"});
  const resourceTypes:Record<string,string[]> = {
    jira:["Story","Epic","Task","Bug"],
    confluence:["Page"],
    github:["Repository","PullRequest","Issue","Commit"],
    leanix:["Application","Interface","ITComponent","DataObject","BusinessCapability","Provider","Project"]
  };
  if (!resourceTypes[body.provider].includes(body.resourceType)) return res.status(400).json({error:"Unsupported resource type for "+body.provider});
  if (!body.resourceType || !body.externalId || !body.title) return res.status(400).json({error:"resourceType, externalId and title are required"});
  const relationTypes=["related_to","implements","decision_record","review_evidence","solution_design","implementation_repository","shared_component","impacted_application","impacted_interface","dependency"];
  if (body.relationType && !relationTypes.includes(body.relationType)) return res.status(400).json({error:"Unsupported relationship type"});
  const template = body.provider==="confluence" && body.resourceType==="Page"
    ? {template_key:String(body.templateKey || ""),name:String(body.templateName || "")}
    : undefined;
  if (body.provider==="confluence" && body.resourceType==="Page" && !template?.template_key) {
    return res.status(400).json({error:"Confluence template key is required. The Agent will resolve the actual template through its configured MCP/API tool."});
  }
  const created=now();
  run("INSERT OR IGNORE INTO external_resource_refs(id,provider,resource_type,external_id,external_key,title,url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id("resource"),body.provider,body.resourceType,String(body.externalId),String(body.externalKey || ""),String(body.title),String(body.url || ""),created,created);
  const resource=one<{id:string}>("SELECT id FROM external_resource_refs WHERE provider=? AND resource_type=? AND external_id=?",body.provider,body.resourceType,String(body.externalId));
  if (!resource) return res.status(500).json({error:"Could not persist external resource reference"});
  run("UPDATE external_resource_refs SET external_key=CASE WHEN ?<>'' THEN ? ELSE external_key END,title=?,url=CASE WHEN ?<>'' THEN ? ELSE url END,updated_at=? WHERE id=?",
    String(body.externalKey || ""),String(body.externalKey || ""),String(body.title),String(body.url || ""),String(body.url || ""),created,resource.id);
  run("INSERT OR IGNORE INTO work_item_external_links(id,work_item_id,resource_id,relation_type,confluence_template_key,confluence_template_name,linked_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
    id("extlink"),workItemId,resource.id,body.relationType || "related_to",template?.template_key || null,template?.name || null,actor,created);
  const link=one<{id:string}>("SELECT id FROM work_item_external_links WHERE work_item_id=? AND resource_id=? AND relation_type=?",workItemId,resource.id,body.relationType || "related_to");
  run("UPDATE work_items SET context_version=context_version+1,updated_at=? WHERE id=?",created,workItemId);
  logActivity(workItemId,actor,"linked","external_resource",resource.id,"Recorded external context reference: "+body.provider+" "+body.resourceType+": "+body.title,{relationType:body.relationType || "related_to",templateKey:template?.template_key || null,source:"user_supplied_reference"});
  res.status(201).json({id:link?.id,resourceId:resource.id});
});

app.delete("/api/work-items/:id/external-links/:linkId",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req); const linkId=String(req.params.linkId);
  if (!requirePermission(res,workItemId,actor,"manage")) return;
  const link=one<{resource_id:string;title:string}>("SELECT r.id AS resource_id,r.title FROM work_item_external_links l JOIN external_resource_refs r ON r.id=l.resource_id WHERE l.id=? AND l.work_item_id=?",linkId,workItemId);
  if (!link) return res.status(404).json({error:"External resource link not found"});
  run("DELETE FROM work_item_external_links WHERE id=?",linkId);
  run("UPDATE work_items SET context_version=context_version+1,updated_at=? WHERE id=?",now(),workItemId);
  logActivity(workItemId,actor,"unlinked","external_resource",link.resource_id,"Unlinked external resource: "+link.title);
  res.json({ok:true});
});

app.post("/api/work-items/:id/attachments",upload.single("file"),async(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"contribute")) return;
  if (!req.file) return res.status(400).json({error:"file is required"});
  try {
    const stored=await objectStore.put(req.file.originalname,req.file.buffer,req.file.mimetype || "application/octet-stream");
    const attachmentId=id("file");
    run("INSERT INTO attachments(id,work_item_id,object_key,object_uri,original_name,content_type,size_bytes,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      attachmentId,workItemId,stored.key,stored.uri,req.file.originalname,stored.contentType,stored.size,actor,now());
    logActivity(workItemId,actor,"uploaded","attachment",attachmentId,"Uploaded "+req.file.originalname,{size:stored.size,contentType:stored.contentType});
    res.status(201).json({id:attachmentId,name:req.file.originalname,size:stored.size,contentType:stored.contentType});
  } catch (error) {
    res.status(500).json({error:error instanceof Error ? error.message : "Upload failed"});
  }
});

if (process.env.NODE_ENV==="production" && existsSync(resolve("dist/index.html"))) {
  app.use(express.static(resolve("dist")));
  app.get(/^(?!\/api).*/,(_req,res)=>res.sendFile(resolve("dist/index.html")));
}
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  console.error(error); res.status(500).json({error:error instanceof Error ? error.message : "Internal server error"});
});
app.listen(port,()=>{
  console.log("Architecture Workbench API listening on http://localhost:"+port);
  console.log("SQLite database: "+(process.env.DATABASE_PATH || "./data/architecture-workbench.sqlite"));
});
process.on("SIGINT",()=>{db.close();process.exit(0);});
process.on("SIGTERM",()=>{db.close();process.exit(0);});
