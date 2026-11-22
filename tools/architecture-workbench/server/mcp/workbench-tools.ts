import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { all, id, now, one, run } from "../db.js";
import { getWorkItemPermissions, isGlobalAdmin, getWorkflowProjection } from "../workflow/engine.js";
import {
  agentProfiles,
  claimAgentRun,
  claimNextAgentRun,
  getAgentPlanContext,
  listAgentPlans,
  completeAgentRun,
  failAgentRun,
  heartbeatAgentRun,
  getAgentRunEvents,
  handoffAgentRun,
  listAgentRuns,
  requestAgentRun,
  requestAgentPlan,
  resumeAgentRun,
  type AgentKey
} from "../agents/coordinator.js";
import { agentRuntimeAdapter } from "../agents/runtime.js";

type ToolContext = { http?: { req?: Request } };

function actorId(ctx:ToolContext):string {
  return ctx.http?.req?.headers.get("x-demo-user-id")?.trim() || "u-sa";
}

function ok(value:unknown) {
  return {content:[{type:"text" as const,text:JSON.stringify(value,null,2)}]};
}

function fail(error:unknown) {
  return {
    isError:true,
    content:[{type:"text" as const,text:error instanceof Error ? error.message : "Workbench operation failed."}]
  };
}

function safe<T extends (...args:any[])=>any>(fn:T) {
  return async (...args:Parameters<T>) => {
    try { return ok(await fn(...args)); }
    catch(error) { return fail(error); }
  };
}

function requirePermission(workItemId:string,actor:string,permission:string) {
  if (!one("SELECT id FROM work_items WHERE id=?",workItemId)) throw new Error("Work Item not found.");
  const grants=getWorkItemPermissions(workItemId,actor);
  if (!grants.includes("read")) throw new Error("The current principal cannot access this Work Item.");
  if (!grants.includes(permission)) throw new Error("The current principal does not have "+permission+" permission.");
}

function appendActivity(workItemId:string,actor:string,action:string,targetType:string,targetId:string|null,summary:string,metadata:unknown={}) {
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id("evt"),workItemId,actor,action,targetType,targetId,summary,JSON.stringify(metadata),now());
}

function searchWorkItems(input:{query?:string;status?:string;limit?:number},actor:string) {
  const clauses=["w.type <> 'technical_debt'"];
  const params:unknown[]=[];
  if (input.query?.trim()) {
    clauses.push("(w.code LIKE ? OR w.title LIKE ? OR w.description LIKE ?)");
    const term="%"+input.query.trim()+"%";
    params.push(term,term,term);
  }
  if (input.status) {
    clauses.push("w.status=?");
    params.push(input.status);
  }
  if (!isGlobalAdmin(actor)) {
    clauses.push("EXISTS (SELECT 1 FROM participations access WHERE access.work_item_id=w.id AND access.person_id=? AND access.permissions_json LIKE '%\"read\"%')");
    params.push(actor);
  }
  params.push(Math.max(1,Math.min(input.limit || 20,50)));
  return all(
    "SELECT w.id,w.code,w.type,w.title,w.description,w.status,w.priority,w.owner_id,w.requestor_id,w.target_date,w.context_version,w.updated_at,owner.display_name AS owner_name,requestor.display_name AS requestor_name FROM work_items w JOIN people owner ON owner.id=w.owner_id LEFT JOIN people requestor ON requestor.id=w.requestor_id WHERE "+clauses.join(" AND ")+" ORDER BY w.updated_at DESC LIMIT ?",
    ...params
  );
}

function getWorkItem(workItemId:string,actor:string) {
  requirePermission(workItemId,actor,"read");
  const workItem=one(
    "SELECT w.id,w.code,w.type,w.title,w.description,w.status,w.priority,w.owner_id,w.requestor_id,w.target_date,w.context_version,w.created_at,w.updated_at,owner.display_name AS owner_name,requestor.display_name AS requestor_name FROM work_items w JOIN people owner ON owner.id=w.owner_id LEFT JOIN people requestor ON requestor.id=w.requestor_id WHERE w.id=?",
    workItemId
  );
  const participants=all(
    "SELECT p.id,p.display_name,p.title,pt.role_key,pt.role_label,pt.permissions_json FROM participations pt JOIN people p ON p.id=pt.person_id WHERE pt.work_item_id=? ORDER BY p.display_name",
    workItemId
  );
  const tasks=all(
    "SELECT t.id,t.title,t.kind,t.status,t.assignee_id,p.display_name AS assignee_name,t.due_date,t.relates_to,t.created_at,t.updated_at FROM tasks t LEFT JOIN people p ON p.id=t.assignee_id WHERE t.work_item_id=? ORDER BY t.created_at DESC",
    workItemId
  );
  const artifacts=all(
    "SELECT a.id,a.type,a.code,a.title,a.version,a.status,a.summary,a.content_hash,a.submitted_by,p.display_name AS submitter_name,a.created_at FROM artifacts a JOIN people p ON p.id=a.submitted_by WHERE a.work_item_id=? ORDER BY a.created_at DESC",
    workItemId
  );
  const reviews=all(
    "SELECT r.id,r.discipline,r.outcome,r.summary,r.findings_json,r.artifact_version,r.created_at,p.display_name AS reviewer_name,a.title AS artifact_title,a.code AS artifact_code FROM reviews r JOIN review_cycles c ON c.id=r.cycle_id JOIN artifacts a ON a.id=r.artifact_id JOIN people p ON p.id=r.reviewer_id WHERE c.work_item_id=? ORDER BY r.created_at DESC",
    workItemId
  );
  const decisions=all(
    "SELECT d.id,d.subject_type,d.subject_id,d.outcome,d.rationale,d.conditions,d.policy_ref,d.created_at,p.display_name AS decision_maker_name FROM decisions d JOIN people p ON p.id=d.decision_maker_id WHERE d.work_item_id=? ORDER BY d.created_at DESC",
    workItemId
  );
  const externalResources=all(
    "SELECT r.provider,r.resource_type,r.external_id,r.external_key,r.title,r.url,l.relation_type,l.confluence_template_key,l.confluence_template_name FROM work_item_external_links l JOIN external_resource_refs r ON r.id=l.resource_id WHERE l.work_item_id=? ORDER BY r.provider,r.resource_type,r.title",
    workItemId
  );
  return {
    workItem,participants,tasks,artifacts,reviews,decisions,externalResources,
    workflow:getWorkflowProjection(workItemId,actor),
    permissions:getWorkItemPermissions(workItemId,actor)
  };
}

function getContextCapsule(workItemId:string,actor:string) {
  requirePermission(workItemId,actor,"read");
  const workItem=one(
    "SELECT id,code,type,title,description,status,priority,target_date,context_version,created_at,updated_at FROM work_items WHERE id=?",
    workItemId
  );
  const participants=all(
    "SELECT p.display_name,p.title,pt.role_label,pt.permissions_json FROM participations pt JOIN people p ON p.id=pt.person_id WHERE pt.work_item_id=? ORDER BY p.display_name",
    workItemId
  );
  const artifacts=all(
    "SELECT id,type,code,title,version,status,summary,content_hash,created_at FROM artifacts WHERE work_item_id=? ORDER BY created_at DESC LIMIT 20",
    workItemId
  );
  const tasks=all(
    "SELECT id,title,kind,status,assignee_id,due_date,relates_to,created_at,updated_at FROM tasks WHERE work_item_id=? ORDER BY created_at DESC LIMIT 50",
    workItemId
  );
  const reviews=all(
    "SELECT r.discipline,r.outcome,r.summary,r.findings_json,r.artifact_version,r.created_at,p.display_name AS reviewer_name,a.code,a.title AS artifact_title FROM reviews r JOIN review_cycles c ON c.id=r.cycle_id JOIN artifacts a ON a.id=r.artifact_id JOIN people p ON p.id=r.reviewer_id WHERE c.work_item_id=? ORDER BY r.created_at DESC",
    workItemId
  );
  const externalResources=all(
    "SELECT r.provider,r.resource_type,r.external_id,r.external_key,r.title,r.url,l.relation_type,l.confluence_template_key,l.confluence_template_name FROM work_item_external_links l JOIN external_resource_refs r ON r.id=l.resource_id WHERE l.work_item_id=?",
    workItemId
  );
  const comments=all(
    "SELECT c.body,c.created_at,p.display_name AS author_name FROM comments c JOIN people p ON p.id=c.author_id WHERE c.work_item_id=? ORDER BY c.created_at DESC LIMIT 20",
    workItemId
  );
  return {
    workItem,participants,tasks,artifacts,reviews,externalResources,comments,
    workflow:getWorkflowProjection(workItemId,actor),
    generatedAt:now(),
    externalContextNote:"External resources are references only. The Agent Host must retrieve source-system content using its own authorized MCP/API connections and retain source citations and retrieval timestamps."
  };
}

function getArtifact(artifactId:string,actor:string) {
  const artifact=one("SELECT id,work_item_id,type,code,title,version,status,summary,content,content_hash,submitted_by,created_at FROM artifacts WHERE id=?",artifactId);
  if (!artifact) throw new Error("Artifact not found.");
  requirePermission(String((artifact as {work_item_id:string}).work_item_id),actor,"read");
  return artifact;
}

function createTask(input:{workItemId:string;title:string;kind?:string;assigneeId?:string;dueDate?:string;relatesTo?:string},actor:string) {
  requirePermission(input.workItemId,actor,"contribute");
  if (input.assigneeId && !one("SELECT id FROM participations WHERE work_item_id=? AND person_id=?",input.workItemId,input.assigneeId)) {
    throw new Error("Task assignee must be a participant of this Work Item.");
  }
  const taskId=id("task");
  const timestamp=now();
  run("INSERT INTO tasks(id,work_item_id,title,kind,status,assignee_id,due_date,relates_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    taskId,input.workItemId,input.title.trim(),input.kind || "analysis","open",input.assigneeId || null,input.dueDate || null,input.relatesTo || null,timestamp,timestamp);
  appendActivity(input.workItemId,actor,"created","task",taskId,"Created Task: "+input.title);
  return {id:taskId,status:"open"};
}

function updateTask(input:{taskId:string;status?:string;assigneeId?:string|null;dueDate?:string|null},actor:string) {
  const task=one<{id:string;work_item_id:string;assignee_id:string|null}>("SELECT id,work_item_id,assignee_id FROM tasks WHERE id=?",input.taskId);
  if (!task) throw new Error("Task not found.");
  const grants=getWorkItemPermissions(task.work_item_id,actor);
  const canManage=grants.includes("contribute");
  const isAssignee=task.assignee_id===actor;
  if (!canManage && !isAssignee) throw new Error("Only the Task assignee or a Work Item contributor can update this Task.");
  if (!canManage && (input.assigneeId!==undefined || input.dueDate!==undefined)) throw new Error("Assignees may update Task status only.");
  const statuses=["open","in_progress","blocked","done","cancelled"];
  if (input.status && !statuses.includes(input.status)) throw new Error("Unsupported Task status.");
  if (input.assigneeId && !one("SELECT id FROM participations WHERE work_item_id=? AND person_id=?",task.work_item_id,input.assigneeId)) {
    throw new Error("Task assignee must be a participant of this Work Item.");
  }
  const timestamp=now();
  run("UPDATE tasks SET status=COALESCE(?,status),assignee_id=CASE WHEN ?=1 THEN ? ELSE assignee_id END,due_date=CASE WHEN ?=1 THEN ? ELSE due_date END,updated_at=? WHERE id=?",
    input.status || null,input.assigneeId!==undefined?1:0,input.assigneeId ?? null,input.dueDate!==undefined?1:0,input.dueDate ?? null,timestamp,input.taskId);
  appendActivity(task.work_item_id,actor,"updated","task",input.taskId,"Updated Task",{status:input.status,assigneeId:input.assigneeId,dueDate:input.dueDate});
  return one("SELECT id,title,status,assignee_id,due_date,updated_at FROM tasks WHERE id=?",input.taskId);
}

function createArtifactDraft(input:{workItemId:string;title:string;type:string;content:string;code?:string;summary?:string},actor:string) {
  requirePermission(input.workItemId,actor,"contribute");
  if (!input.title.trim() || !input.content.trim()) throw new Error("Artifact title and content are required.");
  const code=input.code?.trim() || null;
  const latest=code ? one<{version:number}>("SELECT MAX(version) AS version FROM artifacts WHERE work_item_id=? AND code=?",input.workItemId,code) : undefined;
  const version=(latest?.version || 0)+1;
  const artifactId=id("art");
  const timestamp=now();
  const hash=createHash("sha256").update(input.content,"utf8").digest("hex");
  run("INSERT INTO artifacts(id,work_item_id,type,code,title,version,status,summary,content,submitted_by,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    artifactId,input.workItemId,input.type,code,input.title.trim(),version,"draft",input.summary || "",input.content,actor,hash,timestamp);
  run("UPDATE work_items SET context_version=context_version+1,updated_at=? WHERE id=?",timestamp,input.workItemId);
  appendActivity(input.workItemId,actor,"agent_artifact_draft","artifact",artifactId,"Created Agent draft: "+input.title,{code,version});
  return {id:artifactId,code,version,status:"draft",contentHash:hash};
}

function addComment(workItemId:string,body:string,actor:string) {
  requirePermission(workItemId,actor,"comment");
  if (!body.trim()) throw new Error("Comment body is required.");
  const commentId=id("comment");
  run("INSERT INTO comments(id,work_item_id,author_id,body,created_at) VALUES(?,?,?,?,?)",commentId,workItemId,actor,body.trim(),now());
  appendActivity(workItemId,actor,"commented","comment",commentId,"Added an Agent discussion message");
  return {id:commentId};
}

export function registerWorkbenchTools(server:McpServer,skillUriForName:(skillName:string)=>string) {
  server.registerTool("workbench_search_work_items",{
    description:"Search only the Work Items visible to the current principal. Returns summary fields, not hidden records.",
    inputSchema:z.object({
      query:z.string().optional().describe("Optional code, title or description search"),
      status:z.enum(["draft","analysis","in_review","changes_requested","accepted","rejected","closed"]).optional(),
      limit:z.number().int().min(1).max(50).optional()
    })
  },async (input,ctx)=>safe(()=>searchWorkItems(input,actorId(ctx)))());

  server.registerTool("workbench_get_work_item",{
    description:"Read a Work Item, its participants, tasks, artifacts, reviews, decisions, external references and workflow projection. Requires read permission.",
    inputSchema:z.object({workItemId:z.string().min(1)})
  },async ({workItemId},ctx)=>safe(()=>getWorkItem(workItemId,actorId(ctx)))());

  server.registerTool("workbench_get_artifact",{
    description:"Read the complete content of one Artifact after checking read permission on its parent Work Item.",
    inputSchema:z.object({artifactId:z.string().min(1)})
  },async ({artifactId},ctx)=>safe(()=>getArtifact(artifactId,actorId(ctx)))());

  server.registerTool("workbench_get_context_capsule",{
    description:"Read the participant-scoped analysis context, including Artifact content and external resource pointers. External systems are not fetched by Workbench.",
    inputSchema:z.object({workItemId:z.string().min(1)})
  },async ({workItemId},ctx)=>safe(()=>getContextCapsule(workItemId,actorId(ctx)))());

  server.registerTool("workbench_get_workflow_state",{
    description:"Read current workflow status, available actions and transition history. This tool does not change workflow state.",
    inputSchema:z.object({workItemId:z.string().min(1)})
  },async ({workItemId},ctx)=>safe(()=>{
    const actor=actorId(ctx);
    requirePermission(workItemId,actor,"read");
    return getWorkflowProjection(workItemId,actor);
  })());

  server.registerTool("workbench_list_my_tasks",{
    description:"List active and completed Tasks assigned to the current principal, limited to Work Items they can read.",
    inputSchema:z.object({includeCompleted:z.boolean().optional().default(false)})
  },async ({includeCompleted},ctx)=>safe(()=>{
    const actor=actorId(ctx);
    return all(
      "SELECT t.id,t.work_item_id,t.title,t.kind,t.status,t.assignee_id,t.due_date,t.relates_to,t.updated_at,w.code AS work_item_code,w.title AS work_item_title,w.status AS work_item_status FROM tasks t JOIN work_items w ON w.id=t.work_item_id WHERE t.assignee_id=? AND (?=1 OR t.status NOT IN ('done','cancelled')) AND (?=1 OR EXISTS (SELECT 1 FROM participations access WHERE access.work_item_id=w.id AND access.person_id=?)) ORDER BY t.due_date,t.updated_at DESC",
      actor,includeCompleted?1:0,isGlobalAdmin(actor)?1:0,actor
    );
  })());

  server.registerTool("workbench_create_task",{
    description:"Create an executable Task under a Work Item. The actor needs contribute permission and any human assignee must already be a participant.",
    inputSchema:z.object({
      workItemId:z.string().min(1),
      title:z.string().min(1).max(300),
      kind:z.enum(["analysis","design","implementation","review_follow_up","decision_follow_up","other"]).optional(),
      assigneeId:z.string().optional(),
      dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      relatesTo:z.string().optional()
    })
  },async (input,ctx)=>safe(()=>createTask(input,actorId(ctx)))());

  server.registerTool("workbench_update_task",{
    description:"Update a Task. Assignees may update status; Work Item contributors may also reassign or change due date.",
    inputSchema:z.object({
      taskId:z.string().min(1),
      status:z.enum(["open","in_progress","blocked","done","cancelled"]).optional(),
      assigneeId:z.string().nullable().optional(),
      dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
    })
  },async (input,ctx)=>safe(()=>updateTask(input,actorId(ctx)))());

  server.registerTool("workbench_create_artifact_draft",{
    description:"Create a versioned draft Artifact under a Work Item. Agent output remains draft and cannot become a formal Review outcome or Decision.",
    inputSchema:z.object({
      workItemId:z.string().min(1),
      title:z.string().min(1).max(300),
      type:z.enum(["analysis","architecture","adr","data_architecture","security_review","review_report","decision_brief","diagram","other"]),
      code:z.string().max(80).optional(),
      summary:z.string().max(4000).optional(),
      content:z.string().min(1).max(500000)
    })
  },async (input,ctx)=>safe(()=>createArtifactDraft(input,actorId(ctx)))());

  server.registerTool("workbench_add_comment",{
    description:"Add a discussion note to a Work Item. Requires comment permission. This is not a formal Review or Decision.",
    inputSchema:z.object({workItemId:z.string().min(1),body:z.string().min(1).max(10000)})
  },async ({workItemId,body},ctx)=>safe(()=>addComment(workItemId,body,actorId(ctx)))());

  server.registerTool("agent_list_profiles",{
    description:"List the Workbench's role-oriented Agent profiles and their required Skills. Profiles do not represent a particular model provider.",
    inputSchema:z.object({})
  },async ()=>ok({profiles:agentProfiles,runtime:agentRuntimeAdapter.describe()}));

  server.registerTool("agent_request_run",{
    description:"Queue a role-specific Agent run for a Work Item. The Coordinator records the run and the Agent Host later claims it through MCP.",
    inputSchema:z.object({
      workItemId:z.string().min(1),
      agentKey:z.enum(["business-analyst","solution-architect","data-architect","security-reviewer","architecture-reviewer","decision-analyst","request-coordinator"]),
      objective:z.string().min(1).max(4000),
      taskId:z.string().optional()
    })
  },async (input,ctx)=>safe(()=>{
    const requested=requestAgentRun({...input,actorId:actorId(ctx)});
    return {
      ...requested,
      skillUri:skillUriForName(requested.profile.skillName),
      nextAction:"The Agent Host should load the declared Skill, claim this run, read the Work Item context and produce a draft or request Human input."
    };
  })());


  server.registerTool("agent_request_plan",{
    description:"Create a multi-role Agent Plan. Specialist nodes may run in parallel or depend on earlier nodes. Workbench adds a final decision-analyst synthesis node that waits for every specialist node to complete.",
    inputSchema:z.object({
      workItemId:z.string().min(1),
      name:z.string().min(1).max(200),
      objective:z.string().min(1).max(4000),
      taskId:z.string().optional(),
      nodes:z.array(z.object({
        key:z.string().min(2).max(48),
        agentKey:z.enum(["business-analyst","solution-architect","data-architect","security-reviewer","architecture-reviewer","decision-analyst","request-coordinator"]),
        objective:z.string().max(4000).optional(),
        dependsOn:z.array(z.string().min(2).max(48)).max(8).optional()
      })).min(1).max(8)
    })
  },async (input,ctx)=>safe(()=>requestAgentPlan({...input,actorId:actorId(ctx)}))());

  server.registerTool("agent_list_plans",{
    description:"List multi-role Agent Plans and their execution nodes for a Work Item. Includes node dependencies, status and result Artifact references.",
    inputSchema:z.object({workItemId:z.string().min(1)})
  },async ({workItemId},ctx)=>safe(()=>listAgentPlans(workItemId,actorId(ctx)))());

  server.registerTool("agent_get_plan_context",{
    description:"Read completed specialist outputs for a claimed synthesis node. Only the Host that claimed the plan's decision-analyst synthesis node can access the aggregate context.",
    inputSchema:z.object({runId:z.string().min(1),claimToken:z.string().min(32)})
  },async ({runId,claimToken},ctx)=>safe(()=>getAgentPlanContext({runId,claimToken,actorId:actorId(ctx)}))());

  server.registerTool("agent_claim_next_run",{
    description:"Poll and atomically claim the oldest queued run for an Agent profile that this Host is authorized to execute. Returns null when no eligible run is available. After a Human resume, read agent_get_run_events to retrieve the supplied context.",
    inputSchema:z.object({agentKey:z.enum(["business-analyst","solution-architect","data-architect","security-reviewer","architecture-reviewer","decision-analyst","request-coordinator"])}),
  },async ({agentKey},ctx)=>safe(()=>{
    const actor=actorId(ctx);
    const claimed=claimNextAgentRun({actorId:actor,agentKey});
    if (!claimed) return null;
    return {run:claimed,skillUri:skillUriForName(claimed.skill_name),requiredNextSteps:["Load the Skill URI and verify its resources","Read the Work Item Context Capsule","Read only the Artifact bodies needed for the task","Use Workbench Tools to save a draft or request Human input"]};
  })());

  server.registerTool("agent_claim_run",{
    description:"Claim one queued run assigned to the selected Agent profile. Claiming is atomic; a run can be claimed only once.",
    inputSchema:z.object({
      runId:z.string().min(1),
      agentKey:z.enum(["business-analyst","solution-architect","data-architect","security-reviewer","architecture-reviewer","decision-analyst","request-coordinator"])
    })
  },async (input,ctx)=>safe(()=>claimAgentRun({...input,actorId:actorId(ctx)}))());

  server.registerTool("agent_heartbeat_run",{
    description:"Renew the server-owned lease for a currently claimed Agent Run. The claim token and current Participation are revalidated on every heartbeat.",
    inputSchema:z.object({runId:z.string().min(1),claimToken:z.string().min(32)})
  },async ({runId,claimToken},ctx)=>safe(()=>heartbeatAgentRun({runId,claimToken,actorId:actorId(ctx)}))());

  server.registerTool("agent_complete_run",{
    description:"Complete a claimed Agent run by saving its output as a draft Artifact. This never submits a formal Review or Decision.",
    inputSchema:z.object({
      runId:z.string().min(1),
      claimToken:z.string().min(32),
      artifactTitle:z.string().min(1).max(300),
      artifactType:z.enum(["analysis","architecture","adr","data_architecture","security_review","review_report","decision_brief","diagram","other"]),
      artifactCode:z.string().max(80).optional(),
      summary:z.string().max(4000).optional(),
      content:z.string().min(1).max(500000)
    })
  },async (input,ctx)=>safe(()=>completeAgentRun({...input,actorId:actorId(ctx)}))());

  server.registerTool("agent_request_human_handoff",{
    description:"Pause a claimed Agent run and record why Human input is required, including questions and suggested next actions. Does not change the Request workflow.",
    inputSchema:z.object({
      runId:z.string().min(1),
      claimToken:z.string().min(32),
      reason:z.string().min(1).max(4000),
      questions:z.array(z.string().max(1000)).max(20).default([]),
      recommendedActions:z.array(z.string().max(1000)).max(20).default([])
    })
  },async (input,ctx)=>safe(()=>handoffAgentRun({...input,actorId:actorId(ctx)}))());

  server.registerTool("agent_fail_run",{
    description:"Mark a claimed Agent run as failed and persist its error summary.",
    inputSchema:z.object({runId:z.string().min(1),claimToken:z.string().min(32),errorMessage:z.string().max(4000)})
  },async (input,ctx)=>safe(()=>failAgentRun({...input,actorId:actorId(ctx)}))());

  server.registerTool("agent_resume_run",{
    description:"Requeue a run waiting for Human input. Only the original Requestor or a Workbench Admin may resume it.",
    inputSchema:z.object({runId:z.string().min(1),additionalContext:z.string().max(8000).default("")})
  },async (input,ctx)=>safe(()=>resumeAgentRun({...input,actorId:actorId(ctx)}))());

  server.registerTool("agent_list_runs",{
    description:"List Agent runs for a Work Item, including status, assigned profile, output Artifact and Human hand-off reason.",
    inputSchema:z.object({workItemId:z.string().min(1)})
  },async ({workItemId},ctx)=>safe(()=>listAgentRuns(workItemId,actorId(ctx)))());

  server.registerTool("agent_get_run_events",{
    description:"Read the append-only lifecycle event history for an Agent run. Requires read permission to its Work Item.",
    inputSchema:z.object({runId:z.string().min(1)})
  },async ({runId},ctx)=>safe(()=>getAgentRunEvents(runId,actorId(ctx)))());
}
