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
  const part = one<{permissions_json:string}>("SELECT permissions_json FROM participations WHERE work_item_id=? AND person_id=?",workItemId,actor);
  return part ? JSON.parse(part.permissions_json) as string[] : [];
}
function can(workItemId: string, actor: string, permission: string) {
  const granted = permissions(workItemId,actor);
  return granted.includes(permission) || granted.includes("manage");
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
  const workItems = all("SELECT w.*,p.display_name AS owner_name,(SELECT COUNT(*) FROM artifacts a WHERE a.work_item_id=w.id) AS artifact_count,(SELECT COUNT(*) FROM tasks t WHERE t.work_item_id=w.id AND t.status NOT IN ('done','cancelled')) AS open_task_count FROM work_items w JOIN people p ON p.id=w.owner_id WHERE w.type <> 'technical_debt' ORDER BY w.updated_at DESC");
  const debts = all("SELECT w.id,w.code,w.title,w.status,w.owner_id,w.target_date,w.priority,p.display_name AS owner_name,d.severity,d.target_state,d.remediation_plan,d.status AS debt_status,d.source_decision_id FROM work_items w JOIN debt_details d ON d.work_item_id=w.id JOIN people p ON p.id=w.owner_id ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,w.target_date");
  const counts = {
    openWorkItems: one<{n:number}>("SELECT COUNT(*) AS n FROM work_items WHERE type <> 'technical_debt' AND status NOT IN ('closed','rejected')")?.n || 0,
    awaitingReview: one<{n:number}>("SELECT COUNT(*) AS n FROM work_items WHERE type <> 'technical_debt' AND status='in_review'")?.n || 0,
    activeDebts: one<{n:number}>("SELECT COUNT(*) AS n FROM debt_details WHERE status IN ('open','in_progress')")?.n || 0,
    myTasks: one<{n:number}>("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled')",actor)?.n || 0
  };
  res.json({actorId:actor,people,workItems,debts,counts});
});
app.get("/api/work-items",(_req,res)=>res.json(all("SELECT w.*,p.display_name AS owner_name,(SELECT COUNT(*) FROM artifacts a WHERE a.work_item_id=w.id) AS artifact_count,(SELECT COUNT(*) FROM tasks t WHERE t.work_item_id=w.id AND t.status NOT IN ('done','cancelled')) AS open_task_count FROM work_items w JOIN people p ON p.id=w.owner_id WHERE w.type <> 'technical_debt' ORDER BY w.updated_at DESC")));

app.post("/api/work-items",(req,res)=>{
  const actor = actorId(req); const body = req.body || {};
  if (!body.title || !body.type) return res.status(400).json({error:"title and type are required"});
  const workItemId = id("wi"); const code = "WI-"+new Date().getFullYear()+"-"+Math.floor(Date.now()/1000).toString().slice(-6); const timestamp=now();
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,target_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",workItemId,code,body.type,String(body.title),String(body.description || ""),"draft",body.priority || "normal",actor,body.targetDate || null,timestamp,timestamp);
  run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",id("part"),workItemId,actor,"owner","Work Item Owner",JSON.stringify(["read","contribute","comment","review","manage"]),timestamp);
  logActivity(workItemId,actor,"created","work_item",workItemId,"Created Work Item "+code);
  res.status(201).json({id:workItemId,code});
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
  res.json({workItem,participants,artifacts,cycles,reviews,tasks,decisions,comments,activity,permissions:permissions(workItemId,actor)});
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
  const artifact=one<{id:string;version:number;title:string}>("SELECT id,version,title FROM artifacts WHERE id=? AND work_item_id=?",body.artifactId,workItemId);
  if (!artifact) return res.status(400).json({error:"Review target does not belong to this Work Item."});
  let cycle=one<{id:string}>("SELECT id FROM review_cycles WHERE work_item_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",workItemId);
  if (!cycle) {
    const cycleId=id("cycle");
    run("INSERT INTO review_cycles(id,work_item_id,name,baseline_json,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)",cycleId,workItemId,"Review round",JSON.stringify([{id:artifact.id,version:artifact.version}]),"active",actor,now());
    cycle={id:cycleId};
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
  const taskId=id("task"); const timestamp=now();
  run("INSERT INTO tasks(id,work_item_id,title,kind,status,assignee_id,due_date,relates_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",taskId,workItemId,body.title,body.kind || "analysis","open",body.assigneeId || null,body.dueDate || null,body.relatesTo || null,timestamp,timestamp);
  logActivity(workItemId,actor,"created","task",taskId,"Created task: "+body.title);
  res.status(201).json({id:taskId});
});

app.post("/api/work-items/:id/decisions",(req,res)=>{
  const workItemId=String(req.params.id); const actor=actorId(req);
  if (!requirePermission(res,workItemId,actor,"decide")) return;
  const body=req.body || {}; const outcomes=["accepted","rejected","more_analysis","accepted_with_conditions"];
  if (!outcomes.includes(body.outcome)) return res.status(400).json({error:"Unsupported decision outcome"});
  if (!body.rationale) return res.status(400).json({error:"A rationale is required"});
  const decisionId=id("dec");
  run("INSERT INTO decisions(id,work_item_id,subject_type,subject_id,outcome,rationale,conditions,decision_maker_id,policy_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",decisionId,workItemId,body.subjectType || "work_item",body.subjectId || null,body.outcome,body.rationale,body.conditions || "",actor,"prototype-policy-v1",now());
  logActivity(workItemId,actor,"decided","decision",decisionId,"Decision recorded: "+body.outcome,{subjectType:body.subjectType || "work_item",subjectId:body.subjectId || null});
  if (body.outcome==="more_analysis") {
    const taskId=id("task");
    run("INSERT INTO tasks(id,work_item_id,title,kind,status,assignee_id,due_date,relates_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",taskId,workItemId,body.followUpTitle || "Complete additional analysis","analysis","open",body.followUpOwnerId || null,body.followUpDueDate || null,body.subjectId || null,now(),now());
  }
  let debtId: string | null=null;
  if (body.technicalDebt && body.outcome==="accepted_with_conditions") {
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
  res.json({workItem,participants,artifacts,reviews,generatedAt:now(),note:"Context projection for the current participant. Include full artifact content only through separately authorized reads."});
});

app.post("/api/uploads",upload.single("file"),async(req,res)=>{
  if (!req.file) return res.status(400).json({error:"file is required"});
  try { const stored=await objectStore.put(req.file.originalname,req.file.buffer,req.file.mimetype || "application/octet-stream"); res.status(201).json(stored); }
  catch (error) { res.status(500).json({error:error instanceof Error ? error.message : "Upload failed"}); }
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
