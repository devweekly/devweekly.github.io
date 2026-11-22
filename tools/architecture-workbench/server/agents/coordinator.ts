import { createHash } from "node:crypto";
import { all, id, now, one, run } from "../db.js";
import { getWorkItemPermissions, isGlobalAdmin } from "../workflow/engine.js";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "cancelled";

export const agentProfiles = [
  { key:"business-analyst", name:"Business Analyst", description:"Clarifies business outcomes, stakeholders, requirements and acceptance criteria.", skillName:"business-analysis" },
  { key:"solution-architect", name:"Solution Architect", description:"Develops solution options, system boundaries and architecture trade-offs.", skillName:"solution-architecture" },
  { key:"data-architect", name:"Data Architect", description:"Analyses data ownership, flows, persistence, integration and governance.", skillName:"data-architecture" },
  { key:"security-reviewer", name:"Security Reviewer", description:"Identifies security risks, control gaps and residual risks.", skillName:"security-review" },
  { key:"architecture-reviewer", name:"Architecture Reviewer", description:"Independently reviews a fixed Artifact version against requirements and quality attributes.", skillName:"architecture-review" },
  { key:"decision-analyst", name:"Decision Analyst", description:"Prepares evidence-based options and decision briefs without recording a formal decision.", skillName:"decision-preparation" },
  { key:"request-coordinator", name:"Request Coordinator", description:"Coordinates specialist work, dependencies, hand-offs and human intervention.", skillName:"request-coordination" }
] as const;

export type AgentKey = typeof agentProfiles[number]["key"];

function requirePermission(workItemId:string,actorId:string,permission:string) {
  if (!one("SELECT id FROM work_items WHERE id=?",workItemId)) {
    throw new Error("Work Item not found.");
  }
  const grants=getWorkItemPermissions(workItemId,actorId);
  if (!grants.includes("read")) throw new Error("The current principal cannot access this Work Item.");
  if (!grants.includes(permission)) throw new Error("The current principal does not have "+permission+" permission.");
}

function appendEvent(runId:string,actorType:string,actorId:string|null,eventType:string,details:unknown={}) {
  run("INSERT INTO agent_run_events(id,run_id,actor_type,actor_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?,?)",
    id("arevt"),runId,actorType,actorId,eventType,JSON.stringify(details),now());
}

function appendActivity(workItemId:string,actorId:string,action:string,targetId:string,summary:string,metadata:unknown={}) {
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id("evt"),workItemId,actorId,action,"agent_run",targetId,summary,JSON.stringify(metadata),now());
}

function getRun(runId:string) {
  return one<{
    id:string; work_item_id:string; task_id:string|null; agent_key:string; skill_name:string;
    objective:string; requested_by:string; claimed_by:string|null; status:AgentRunStatus;
    handoff_reason:string; result_artifact_id:string|null; error_message:string;
    created_at:string; updated_at:string; started_at:string|null; finished_at:string|null;
  }>("SELECT * FROM agent_runs WHERE id=?",runId);
}

export function requestAgentRun(input:{
  workItemId:string; actorId:string; agentKey:AgentKey; objective:string; taskId?:string;
}) {
  requirePermission(input.workItemId,input.actorId,"contribute");
  const profile=agentProfiles.find(agent=>agent.key===input.agentKey);
  if (!profile) throw new Error("Unknown Agent profile.");
  if (!input.objective.trim()) throw new Error("A run objective is required.");
  const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",input.workItemId);
  if (item && ["closed","rejected"].includes(item.status)) {
    throw new Error("A new Agent run cannot be started for a closed or rejected Request.");
  }
  if (input.taskId) {
    const task=one<{id:string;status:string}>("SELECT id,status FROM tasks WHERE id=? AND work_item_id=?",input.taskId,input.workItemId);
    if (!task) throw new Error("The selected Task does not belong to this Work Item.");
    if (["done","cancelled"].includes(task.status)) throw new Error("A completed or cancelled Task cannot be assigned to a new Agent run.");
  }
  const runId=id("run");
  const timestamp=now();
  run("INSERT INTO agent_runs(id,work_item_id,task_id,agent_key,skill_name,objective,requested_by,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    runId,input.workItemId,input.taskId || null,input.agentKey,profile.skillName,input.objective.trim(),input.actorId,"queued",timestamp,timestamp);
  appendEvent(runId,"human",input.actorId,"queued",{agentKey:profile.key,skillName:profile.skillName,taskId:input.taskId || null});
  appendActivity(input.workItemId,input.actorId,"agent_run_requested",runId,"Requested "+profile.name+" run",{skillName:profile.skillName,taskId:input.taskId || null});
  return {run:getRun(runId),profile};
}

export function claimNextAgentRun(input:{actorId:string;agentKey:AgentKey}) {
  const candidates=all<{id:string;work_item_id:string}>(
    "SELECT id,work_item_id FROM agent_runs WHERE status='queued' AND agent_key=? ORDER BY created_at,id LIMIT 50",
    input.agentKey
  );
  for (const candidate of candidates) {
    const grants=getWorkItemPermissions(candidate.work_item_id,input.actorId);
    if (!grants.includes("read") || !grants.includes("contribute")) continue;
    const timestamp=now();
    const result=run("UPDATE agent_runs SET status='running',claimed_by=?,started_at=?,updated_at=?,handoff_reason='',error_message='' WHERE id=? AND status='queued' AND agent_key=?",
      input.actorId,timestamp,timestamp,candidate.id,input.agentKey);
    if (Number(result.changes)!==1) continue;
    appendEvent(candidate.id,"agent",input.actorId,"claimed",{agentKey:input.agentKey,claimMode:"next"});
    appendActivity(candidate.work_item_id,input.actorId,"agent_run_started",candidate.id,"Agent run started",{agentKey:input.agentKey,claimMode:"next"});
    return getRun(candidate.id);
  }
  return null;
}

export function claimAgentRun(input:{runId:string;actorId:string;agentKey:AgentKey}) {
  const current=getRun(input.runId);
  if (!current) throw new Error("Agent run not found.");
  requirePermission(current.work_item_id,input.actorId,"contribute");
  if (current.agent_key!==input.agentKey) throw new Error("This run is assigned to a different Agent profile.");
  if (current.status!=="queued") throw new Error("Only queued Agent runs can be claimed.");
  const timestamp=now();
  const result=run("UPDATE agent_runs SET status='running',claimed_by=?,started_at=?,updated_at=?,handoff_reason='',error_message='' WHERE id=? AND status='queued'",
    input.actorId,timestamp,timestamp,input.runId);
  if (Number(result.changes)!==1) throw new Error("The Agent run was claimed or changed by another worker.");
  appendEvent(input.runId,"agent",input.actorId,"claimed",{agentKey:input.agentKey});
  appendActivity(current.work_item_id,input.actorId,"agent_run_started",input.runId,"Agent run started",{agentKey:input.agentKey});
  return getRun(input.runId);
}

function requireClaimedRun(runId:string,actorId:string) {
  const current=getRun(runId);
  if (!current) throw new Error("Agent run not found.");
  requirePermission(current.work_item_id,actorId,"contribute");
  if (current.status!=="running") throw new Error("The Agent run is not currently running.");
  if (current.claimed_by!==actorId) throw new Error("Only the principal that claimed this run may complete or hand it off.");
  return current;
}

export function completeAgentRun(input:{
  runId:string; actorId:string; artifactTitle:string; artifactType:string; artifactCode?:string;
  summary?:string; content:string;
}) {
  const current=requireClaimedRun(input.runId,input.actorId);
  if (!input.artifactTitle.trim() || !input.content.trim()) throw new Error("Artifact title and content are required.");
  const code=input.artifactCode?.trim() || null;
  const latest=code ? one<{version:number}>("SELECT MAX(version) AS version FROM artifacts WHERE work_item_id=? AND code=?",current.work_item_id,code) : undefined;
  const version=(latest?.version || 0)+1;
  const artifactId=id("art");
  const timestamp=now();
  const contentHash=createHash("sha256").update(input.content,"utf8").digest("hex");
  run("INSERT INTO artifacts(id,work_item_id,type,code,title,version,status,summary,content,submitted_by,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    artifactId,current.work_item_id,input.artifactType,code,input.artifactTitle.trim(),version,"draft",input.summary || "",input.content,input.actorId,contentHash,timestamp);
  run("UPDATE work_items SET context_version=context_version+1,updated_at=? WHERE id=?",timestamp,current.work_item_id);
  run("UPDATE agent_runs SET status='completed',result_artifact_id=?,updated_at=?,finished_at=? WHERE id=? AND status='running' AND claimed_by=?",
    artifactId,timestamp,timestamp,input.runId,input.actorId);
  appendEvent(input.runId,"agent",input.actorId,"completed",{artifactId,artifactCode:code,artifactVersion:version});
  appendActivity(current.work_item_id,input.actorId,"agent_run_completed",input.runId,"Agent run completed and produced draft "+input.artifactTitle,{artifactId,version});
  return {run:getRun(input.runId),artifact:{id:artifactId,code,version,title:input.artifactTitle,status:"draft"}};
}

export function handoffAgentRun(input:{runId:string;actorId:string;reason:string;questions:string[];recommendedActions:string[]}) {
  const current=requireClaimedRun(input.runId,input.actorId);
  if (!input.reason.trim()) throw new Error("A hand-off reason is required.");
  const timestamp=now();
  run("UPDATE agent_runs SET status='waiting_for_human',handoff_reason=?,updated_at=? WHERE id=? AND status='running' AND claimed_by=?",
    input.reason.trim(),timestamp,input.runId,input.actorId);
  appendEvent(input.runId,"agent",input.actorId,"human_handoff",{
    reason:input.reason.trim(),questions:input.questions,recommendedActions:input.recommendedActions
  });
  appendActivity(current.work_item_id,input.actorId,"agent_handoff_requested",input.runId,"Agent requested Human input",{reason:input.reason.trim()});
  return getRun(input.runId);
}

export function failAgentRun(input:{runId:string;actorId:string;errorMessage:string}) {
  const current=requireClaimedRun(input.runId,input.actorId);
  const timestamp=now();
  const message=input.errorMessage.trim().slice(0,4000) || "Agent execution failed.";
  run("UPDATE agent_runs SET status='failed',error_message=?,updated_at=?,finished_at=? WHERE id=? AND status='running' AND claimed_by=?",
    message,timestamp,timestamp,input.runId,input.actorId);
  appendEvent(input.runId,"agent",input.actorId,"failed",{message});
  appendActivity(current.work_item_id,input.actorId,"agent_run_failed",input.runId,"Agent run failed",{message});
  return getRun(input.runId);
}

export function resumeAgentRun(input:{runId:string;actorId:string;additionalContext:string}) {
  const current=getRun(input.runId);
  if (!current) throw new Error("Agent run not found.");
  requirePermission(current.work_item_id,input.actorId,"read");
  if (current.status!=="waiting_for_human") throw new Error("Only runs waiting for Human input can be resumed.");
  const requestor=one<{requestor_id:string|null}>("SELECT requestor_id FROM work_items WHERE id=?",current.work_item_id);
  if (current.requested_by!==input.actorId && requestor?.requestor_id!==input.actorId && !isGlobalAdmin(input.actorId)) {
    throw new Error("Only the run requester, the Work Item Requestor or a Workbench Admin can resume this Agent run.");
  }
  const timestamp=now();
  run("UPDATE agent_runs SET status='queued',claimed_by=NULL,started_at=NULL,finished_at=NULL,handoff_reason='',error_message='',updated_at=? WHERE id=? AND status='waiting_for_human'",
    timestamp,input.runId);
  appendEvent(input.runId,"human",input.actorId,"resumed",{additionalContext:input.additionalContext});
  appendActivity(current.work_item_id,input.actorId,"agent_run_resumed",input.runId,"Agent run returned to the execution queue");
  return getRun(input.runId);
}

export function listAgentRuns(workItemId:string,actorId:string) {
  requirePermission(workItemId,actorId,"read");
  const runs=all(
    "SELECT r.id,r.work_item_id,r.task_id,r.agent_key,r.skill_name,r.objective,r.status,r.handoff_reason,r.result_artifact_id,r.error_message,r.created_at,r.updated_at,r.started_at,r.finished_at,requestor.display_name AS requested_by_name,claimer.display_name AS claimed_by_name FROM agent_runs r JOIN people requestor ON requestor.id=r.requested_by LEFT JOIN people claimer ON claimer.id=r.claimed_by WHERE r.work_item_id=? ORDER BY r.created_at DESC",
    workItemId
  );
  return runs;
}

export function getAgentRunEvents(runId:string,actorId:string) {
  const current=getRun(runId);
  if (!current) throw new Error("Agent run not found.");
  requirePermission(current.work_item_id,actorId,"read");
  return all("SELECT id,actor_type,actor_id,event_type,details_json,created_at FROM agent_run_events WHERE run_id=? ORDER BY created_at",runId);
}
