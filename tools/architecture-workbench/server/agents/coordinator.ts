import { createHash, randomUUID } from "node:crypto";
import { all, db, id, now, one, run } from "../db.js";
import { getWorkItemPermissions, isGlobalAdmin } from "../workflow/engine.js";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "cancelled";

function boundedInteger(value:string|undefined,fallback:number,min:number,max:number) {
  const parsed=Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(min,Math.min(max,Math.floor(parsed))) : fallback;
}

export const AGENT_RUN_LEASE_MS=boundedInteger(process.env.AGENT_RUN_LEASE_MS,60_000,15_000,300_000);
const AGENT_RUN_LEASE_SWEEP_MS=boundedInteger(process.env.AGENT_RUN_LEASE_SWEEP_MS,10_000,1_000,60_000);

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
    id:string; work_item_id:string; task_id:string|null; plan_id:string|null; node_key:string; agent_key:string; skill_name:string; claim_token:string|null;
    heartbeat_at:string|null; lease_expires_at:string|null; attempt_count:number; max_attempts:number;
    objective:string; requested_by:string; claimed_by:string|null; status:AgentRunStatus;
    handoff_reason:string; result_artifact_id:string|null; error_message:string;
    created_at:string; updated_at:string; started_at:string|null; finished_at:string|null;
  }>("SELECT * FROM agent_runs WHERE id=?",runId);
}


export interface AgentPlanNodeInput {
  key:string;
  agentKey:AgentKey;
  objective?:string;
  dependsOn?:string[];
}

function refreshAgentPlan(planId:string) {
  const statuses=all<{status:AgentRunStatus}>("SELECT status FROM agent_runs WHERE plan_id=?",planId).map(item=>item.status);
  if (!statuses.length) return null;
  const readyQueued=one<{n:number}>(
    "SELECT COUNT(*) AS n FROM agent_runs r WHERE r.plan_id=? AND r.status='queued' AND NOT EXISTS (SELECT 1 FROM agent_run_dependencies d JOIN agent_runs dep ON dep.id=d.depends_on_run_id WHERE d.run_id=r.id AND dep.status<>'completed')",
    planId
  )?.n || 0;
  const next:AgentRunStatus =
    statuses.every(status=>status==="completed") ? "completed" :
    statuses.some(status=>status==="waiting_for_human") ? "waiting_for_human" :
    statuses.some(status=>status==="running") ? "running" :
    readyQueued>0 ? "queued" : "failed";
  run("UPDATE agent_plans SET status=?,updated_at=? WHERE id=?",next,now(),planId);
  return next;
}

function getAgentPlan(planId:string) {
  const plan=one("SELECT p.id,p.work_item_id,p.name,p.objective,p.status,p.created_by,p.result_artifact_id,p.created_at,p.updated_at,creator.display_name AS created_by_name FROM agent_plans p JOIN people creator ON creator.id=p.created_by WHERE p.id=?",planId);
  if (!plan) return null;
  const nodes=all(
    "SELECT r.id,r.node_key,r.agent_key,r.skill_name,r.objective,r.status,r.claimed_by,r.result_artifact_id,r.handoff_reason,r.error_message,r.created_at,r.updated_at,r.started_at,r.finished_at,r.heartbeat_at,r.lease_expires_at,r.attempt_count,r.max_attempts,claimer.display_name AS claimed_by_name FROM agent_runs r LEFT JOIN people claimer ON claimer.id=r.claimed_by WHERE r.plan_id=? ORDER BY CASE WHEN r.node_key='synthesis' THEN 1 ELSE 0 END,r.created_at,r.node_key",
    planId
  );
  const dependencies=all<{run_id:string;depends_on_run_id:string}>(
    "SELECT run_id,depends_on_run_id FROM agent_run_dependencies WHERE run_id IN (SELECT id FROM agent_runs WHERE plan_id=?)",
    planId
  );
  const nodeIds=new Map(nodes.map((node:any)=>[node.id,node.node_key]));
  return {
    ...plan,
    nodes:nodes.map((node:any)=>({
      ...node,
      dependsOn:dependencies.filter(dependency=>dependency.run_id===node.id).map(dependency=>nodeIds.get(dependency.depends_on_run_id))
    }))
  };
}

export function listAgentPlans(workItemId:string,actorId:string) {
  requirePermission(workItemId,actorId,"read");
  const plans=all<{id:string}>("SELECT id FROM agent_plans WHERE work_item_id=? ORDER BY created_at DESC",workItemId);
  return plans.map(plan=>getAgentPlan(plan.id)).filter(Boolean);
}

export function requestAgentPlan(input:{
  workItemId:string; actorId:string; name:string; objective:string; taskId?:string;
  nodes:AgentPlanNodeInput[];
}) {
  requirePermission(input.workItemId,input.actorId,"contribute");
  if (!input.name.trim() || !input.objective.trim()) throw new Error("A plan name and objective are required.");
  if (!Array.isArray(input.nodes) || input.nodes.length<1 || input.nodes.length>8) {
    throw new Error("An Agent Plan must contain between one and eight specialist nodes.");
  }
  const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",input.workItemId);
  if (!item || ["closed","rejected"].includes(item.status)) {
    throw new Error("A new Agent Plan cannot be started for a closed or rejected Request.");
  }
  if (input.taskId) {
    const task=one<{id:string;status:string}>("SELECT id,status FROM tasks WHERE id=? AND work_item_id=?",input.taskId,input.workItemId);
    if (!task || ["done","cancelled"].includes(task.status)) throw new Error("The selected Task is not active in this Work Item.");
  }

  const nodeMap=new Map<string,AgentPlanNodeInput>();
  for (const node of input.nodes) {
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(node.key) || node.key==="synthesis") throw new Error("Node keys must be unique lowercase identifiers; synthesis is reserved.");
    if (nodeMap.has(node.key)) throw new Error("Duplicate Agent Plan node key: "+node.key);
    if (!agentProfiles.some(profile=>profile.key===node.agentKey)) throw new Error("Unknown Agent profile: "+node.agentKey);
    if (node.objective && node.objective.length>4000) throw new Error("A node objective cannot exceed 4,000 characters.");
    nodeMap.set(node.key,node);
  }
  for (const node of input.nodes) {
    const dependencies=node.dependsOn || [];
    if (new Set(dependencies).size!==dependencies.length) throw new Error("Duplicate dependency in node "+node.key);
    for (const dependency of dependencies) {
      if (!nodeMap.has(dependency) || dependency===node.key) throw new Error("Unknown or self dependency in node "+node.key+": "+dependency);
    }
  }

  const visiting=new Set<string>();
  const visited=new Set<string>();
  const visit=(key:string)=>{
    if (visiting.has(key)) throw new Error("Agent Plan dependencies must form a directed acyclic graph.");
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of nodeMap.get(key)?.dependsOn || []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of nodeMap.keys()) visit(key);

  const synthesis:AgentPlanNodeInput={
    key:"synthesis",
    agentKey:"decision-analyst",
    objective:"Synthesize the completed specialist analyses into one coherent decision brief. Compare findings, identify agreements and conflicts, record unresolved assumptions and risks, and recommend next steps. Do not make or record a formal business Decision.",
    dependsOn:[...nodeMap.keys()]
  };
  const allNodes=[...input.nodes,synthesis];
  const planId=id("plan");
  const timestamp=now();
  const runIds=new Map<string,string>();

  db.exec("BEGIN IMMEDIATE");
  try {
    run("INSERT INTO agent_plans(id,work_item_id,name,objective,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      planId,input.workItemId,input.name.trim(),input.objective.trim(),"queued",input.actorId,timestamp,timestamp);
    for (const node of allNodes) {
      const profile=agentProfiles.find(candidate=>candidate.key===node.agentKey)!;
      const runId=id("run");
      runIds.set(node.key,runId);
      run("INSERT INTO agent_runs(id,work_item_id,task_id,plan_id,node_key,agent_key,skill_name,objective,requested_by,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        runId,input.workItemId,input.taskId || null,planId,node.key,node.agentKey,profile.skillName,node.objective?.trim() || input.objective.trim(),input.actorId,"queued",timestamp,timestamp);
    }
    for (const node of allNodes) {
      const runId=runIds.get(node.key)!;
      for (const dependencyKey of node.dependsOn || []) {
        run("INSERT INTO agent_run_dependencies(id,run_id,depends_on_run_id,created_at) VALUES(?,?,?,?)",
          id("dep"),runId,runIds.get(dependencyKey)!,timestamp);
      }
    }
    for (const node of allNodes) {
      const runId=runIds.get(node.key)!;
      appendEvent(runId,"human",input.actorId,"queued",{planId,nodeKey:node.key,agentKey:node.agentKey,skillName:agentProfiles.find(profile=>profile.key===node.agentKey)?.skillName,dependsOn:node.dependsOn || []});
    }
    appendActivity(input.workItemId,input.actorId,"agent_plan_requested",planId,"Requested multi-role Agent Plan: "+input.name,{nodeCount:input.nodes.length,synthesisNode:"synthesis"});
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getAgentPlan(planId);
}

export function getAgentPlanContext(input:{runId:string;actorId:string;claimToken:string}) {
  const current=getRun(input.runId);
  if (!current || !current.plan_id || current.node_key!=="synthesis") throw new Error("Only a plan synthesis node can read the aggregated Agent Plan context.");
  requirePermission(current.work_item_id,input.actorId,"contribute");
  if (current.status!=="running" || current.claimed_by!==input.actorId || current.claim_token!==input.claimToken) throw new Error("The synthesis node must be claimed by the current Host and its current claim token.");
  const plan=getAgentPlan(current.plan_id);
  if (!plan) throw new Error("Agent Plan not found.");
  const outputs=all(
    "SELECT r.node_key,r.agent_key,r.objective,a.id AS artifact_id,a.title AS artifact_title,a.type AS artifact_type,a.summary,a.content,a.content_hash,a.version FROM agent_runs r JOIN artifacts a ON a.id=r.result_artifact_id WHERE r.plan_id=? AND r.node_key<>'synthesis' AND r.status='completed' ORDER BY r.created_at,r.node_key",
    current.plan_id
  );
  return {plan,outputs,aggregationInstruction:"Compare the specialist outputs. Preserve disagreements and uncertainty instead of flattening them. Cite the source node and Artifact for every material conclusion. The output must remain a draft decision brief; do not record a formal Decision."};
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

export function recoverExpiredAgentRunLeases(batchSize=100) {
  const timestamp=now();
  const stale=all<{
    id:string;work_item_id:string;claimed_by:string|null;requested_by:string;plan_id:string|null;
    lease_expires_at:string|null;attempt_count:number;max_attempts:number;
  }>(
    "SELECT id,work_item_id,claimed_by,requested_by,plan_id,lease_expires_at,attempt_count,max_attempts FROM agent_runs WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY updated_at,id LIMIT ?",
    timestamp,Math.max(1,Math.min(500,Math.floor(batchSize)))
  );
  if (!stale.length) return 0;

  let recovered=0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of stale) {
      const exhausted=item.attempt_count>=item.max_attempts;
      const nextStatus=exhausted ? "failed" : "queued";
      const message="Agent Host lease expired after attempt "+item.attempt_count+" of "+item.max_attempts+".";
      const result=exhausted
        ? run("UPDATE agent_runs SET status='failed',claimed_by=NULL,claim_token=NULL,heartbeat_at=NULL,lease_expires_at=NULL,finished_at=?,error_message=?,updated_at=? WHERE id=? AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)",
            timestamp,message,timestamp,item.id,timestamp)
        : run("UPDATE agent_runs SET status='queued',claimed_by=NULL,claim_token=NULL,heartbeat_at=NULL,lease_expires_at=NULL,started_at=NULL,finished_at=NULL,error_message='',updated_at=? WHERE id=? AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)",
            timestamp,item.id,timestamp);
      if (Number(result.changes)!==1) continue;

      appendEvent(item.id,"system",null,"lease_expired",{
        previousWorkerId:item.claimed_by,
        previousLeaseExpiresAt:item.lease_expires_at,
        attemptCount:item.attempt_count,
        maxAttempts:item.max_attempts,
        nextStatus
      });
      appendActivity(
        item.work_item_id,
        item.claimed_by || item.requested_by,
        "agent_run_lease_expired",
        item.id,
        exhausted ? "Agent run failed after exhausting lease recovery attempts" : "Expired Agent run was returned to the execution queue",
        {attemptCount:item.attempt_count,maxAttempts:item.max_attempts,nextStatus}
      );
      if (item.plan_id) refreshAgentPlan(item.plan_id);
      recovered++;
    }
    db.exec("COMMIT");
    return recovered;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function startAgentRunLeaseReaper() {
  const sweep=()=>{
    try {
      const recovered=recoverExpiredAgentRunLeases();
      if (recovered) console.info("Recovered "+recovered+" expired Agent Run lease(s).");
    } catch (error) {
      console.error("Agent Run lease recovery failed:",error);
    }
  };
  sweep();
  const timer=setInterval(sweep,AGENT_RUN_LEASE_SWEEP_MS);
  timer.unref?.();
  return ()=>clearInterval(timer);
}

function newLeaseExpiry(timestamp:string) {
  return new Date(Date.parse(timestamp)+AGENT_RUN_LEASE_MS).toISOString();
}

export function claimNextAgentRun(input:{actorId:string;agentKey:AgentKey}) {
  recoverExpiredAgentRunLeases();
  const candidates=all<{id:string;work_item_id:string}>(
    "SELECT r.id,r.work_item_id FROM agent_runs r WHERE r.status='queued' AND r.agent_key=? AND NOT EXISTS (SELECT 1 FROM agent_run_dependencies d JOIN agent_runs dep ON dep.id=d.depends_on_run_id WHERE d.run_id=r.id AND dep.status<>'completed') ORDER BY r.created_at,r.id LIMIT 50",
    input.agentKey
  );
  for (const candidate of candidates) {
    const grants=getWorkItemPermissions(candidate.work_item_id,input.actorId);
    if (!grants.includes("read") || !grants.includes("contribute")) continue;
    const timestamp=now();
    const expiresAt=newLeaseExpiry(timestamp);
    const claimToken=randomUUID()+randomUUID();
    const result=run("UPDATE agent_runs SET status='running',claimed_by=?,claim_token=?,heartbeat_at=?,lease_expires_at=?,attempt_count=attempt_count+1,started_at=?,updated_at=?,handoff_reason='',error_message='' WHERE id=? AND status='queued' AND agent_key=?",
      input.actorId,claimToken,timestamp,expiresAt,timestamp,timestamp,candidate.id,input.agentKey);
    if (Number(result.changes)!==1) continue;
    const claimed=getRun(candidate.id);
    appendEvent(candidate.id,"agent",input.actorId,"claimed",{
      agentKey:input.agentKey,claimMode:"next",attemptCount:claimed?.attempt_count,
      leaseExpiresAt:expiresAt,leaseDurationMs:AGENT_RUN_LEASE_MS
    });
    appendActivity(candidate.work_item_id,input.actorId,"agent_run_started",candidate.id,"Agent run started",{agentKey:input.agentKey,claimMode:"next",attemptCount:claimed?.attempt_count});
    if (claimed?.plan_id) refreshAgentPlan(claimed.plan_id);
    return claimed ? {...claimed,lease_duration_ms:AGENT_RUN_LEASE_MS} : null;
  }
  return null;
}

export function claimAgentRun(input:{runId:string;actorId:string;agentKey:AgentKey}) {
  recoverExpiredAgentRunLeases();
  const current=getRun(input.runId);
  if (!current) throw new Error("Agent run not found.");
  requirePermission(current.work_item_id,input.actorId,"contribute");
  if (current.agent_key!==input.agentKey) throw new Error("This run is assigned to a different Agent profile.");
  if (current.status!=="queued") throw new Error("Only queued Agent runs can be claimed.");
  const blocked=one<{n:number}>("SELECT COUNT(*) AS n FROM agent_run_dependencies d JOIN agent_runs dep ON dep.id=d.depends_on_run_id WHERE d.run_id=? AND dep.status<>'completed'",input.runId)?.n || 0;
  if (blocked>0) throw new Error("The Agent Run is waiting for prerequisite nodes to complete.");
  const timestamp=now();
  const expiresAt=newLeaseExpiry(timestamp);
  const claimToken=randomUUID()+randomUUID();
  const result=run("UPDATE agent_runs SET status='running',claimed_by=?,claim_token=?,heartbeat_at=?,lease_expires_at=?,attempt_count=attempt_count+1,started_at=?,updated_at=?,handoff_reason='',error_message='' WHERE id=? AND status='queued'",
    input.actorId,claimToken,timestamp,expiresAt,timestamp,timestamp,input.runId);
  if (Number(result.changes)!==1) throw new Error("The Agent run was claimed or changed by another worker.");
  const claimed=getRun(input.runId);
  appendEvent(input.runId,"agent",input.actorId,"claimed",{agentKey:input.agentKey,attemptCount:claimed?.attempt_count,leaseExpiresAt:expiresAt,leaseDurationMs:AGENT_RUN_LEASE_MS});
  appendActivity(current.work_item_id,input.actorId,"agent_run_started",input.runId,"Agent run started",{agentKey:input.agentKey,attemptCount:claimed?.attempt_count});
  if (current.plan_id) refreshAgentPlan(current.plan_id);
  return claimed ? {...claimed,lease_duration_ms:AGENT_RUN_LEASE_MS} : null;
}

function requireClaimedRun(runId:string,actorId:string,claimToken:string) {
  const current=getRun(runId);
  if (!current) throw new Error("Agent run not found.");
  requirePermission(current.work_item_id,actorId,"contribute");
  if (current.status!=="running") throw new Error("The Agent run is not currently running.");
  if (current.claimed_by!==actorId) throw new Error("Only the principal that claimed this run may complete or hand it off.");
  if (!claimToken || !current.claim_token || claimToken!==current.claim_token) throw new Error("The Agent Run claim token is invalid or no longer current.");
  if (!current.lease_expires_at || Date.parse(current.lease_expires_at)<=Date.now()) {
    throw new Error("The Agent Run claim lease has expired; the Host must stop and wait for server-side recovery.");
  }
  return current;
}

export function heartbeatAgentRun(input:{runId:string;actorId:string;claimToken:string}) {
  requireClaimedRun(input.runId,input.actorId,input.claimToken);
  const timestamp=now();
  const expiresAt=newLeaseExpiry(timestamp);
  const result=run("UPDATE agent_runs SET heartbeat_at=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='running' AND claimed_by=? AND claim_token=? AND lease_expires_at>?",
    timestamp,expiresAt,timestamp,input.runId,input.actorId,input.claimToken,timestamp);
  if (Number(result.changes)!==1) {
    throw new Error("The Agent Run lease is no longer valid; another worker may recover this Run.");
  }
  return {runId:input.runId,heartbeat_at:timestamp,lease_expires_at:expiresAt,lease_duration_ms:AGENT_RUN_LEASE_MS};
}

export function completeAgentRun(input:{
  runId:string; actorId:string; claimToken:string; artifactTitle:string; artifactType:string; artifactCode?:string;
  summary?:string; content:string;
}) {
  if (!input.artifactTitle.trim() || !input.content.trim()) throw new Error("Artifact title and content are required.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const current=requireClaimedRun(input.runId,input.actorId,input.claimToken);
    const code=input.artifactCode?.trim() || null;
    const latest=code ? one<{version:number}>("SELECT MAX(version) AS version FROM artifacts WHERE work_item_id=? AND code=?",current.work_item_id,code) : undefined;
    const version=(latest?.version || 0)+1;
    const artifactId=id("art");
    const timestamp=now();
    const contentHash=createHash("sha256").update(input.content,"utf8").digest("hex");
    run("INSERT INTO artifacts(id,work_item_id,type,code,title,version,status,summary,content,submitted_by,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      artifactId,current.work_item_id,input.artifactType,code,input.artifactTitle.trim(),version,"draft",input.summary || "",input.content,input.actorId,contentHash,timestamp);
    run("UPDATE work_items SET context_version=context_version+1,updated_at=? WHERE id=?",timestamp,current.work_item_id);
    const completed=run("UPDATE agent_runs SET status='completed',result_artifact_id=?,claim_token=NULL,heartbeat_at=NULL,lease_expires_at=NULL,updated_at=?,finished_at=? WHERE id=? AND status='running' AND claimed_by=? AND claim_token=? AND lease_expires_at>?",
      artifactId,timestamp,timestamp,input.runId,input.actorId,input.claimToken,timestamp);
    if (Number(completed.changes)!==1) throw new Error("The Agent Run lease expired before the result could be committed.");
    appendEvent(input.runId,"agent",input.actorId,"completed",{artifactId,artifactCode:code,artifactVersion:version});
    appendActivity(current.work_item_id,input.actorId,"agent_run_completed",input.runId,"Agent run completed and produced draft "+input.artifactTitle,{artifactId,version});
    if (current.plan_id && current.node_key==="synthesis") run("UPDATE agent_plans SET result_artifact_id=? WHERE id=?",artifactId,current.plan_id);
    if (current.plan_id) refreshAgentPlan(current.plan_id);
    db.exec("COMMIT");
    return {run:getRun(input.runId),artifact:{id:artifactId,code,version,title:input.artifactTitle,status:"draft"}};
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function handoffAgentRun(input:{runId:string;actorId:string;claimToken:string;reason:string;questions:string[];recommendedActions:string[]}) {
  const current=requireClaimedRun(input.runId,input.actorId,input.claimToken);
  if (!input.reason.trim()) throw new Error("A hand-off reason is required.");
  const timestamp=now();
  const updated=run("UPDATE agent_runs SET status='waiting_for_human',handoff_reason=?,claim_token=NULL,heartbeat_at=NULL,lease_expires_at=NULL,attempt_count=0,updated_at=? WHERE id=? AND status='running' AND claimed_by=? AND claim_token=? AND lease_expires_at>?",
    input.reason.trim(),timestamp,input.runId,input.actorId,input.claimToken,timestamp);
  if (Number(updated.changes)!==1) throw new Error("The Agent Run lease expired before hand-off could be committed.");
  appendEvent(input.runId,"agent",input.actorId,"human_handoff",{
    reason:input.reason.trim(),questions:input.questions,recommendedActions:input.recommendedActions
  });
  appendActivity(current.work_item_id,input.actorId,"agent_handoff_requested",input.runId,"Agent requested Human input",{reason:input.reason.trim()});
  if (current.plan_id) refreshAgentPlan(current.plan_id);
  return getRun(input.runId);
}

export function failAgentRun(input:{runId:string;actorId:string;claimToken:string;errorMessage:string}) {
  const current=requireClaimedRun(input.runId,input.actorId,input.claimToken);
  const timestamp=now();
  const message=input.errorMessage.trim().slice(0,4000) || "Agent execution failed.";
  const updated=run("UPDATE agent_runs SET status='failed',error_message=?,claim_token=NULL,heartbeat_at=NULL,lease_expires_at=NULL,updated_at=?,finished_at=? WHERE id=? AND status='running' AND claimed_by=? AND claim_token=? AND lease_expires_at>?",
    message,timestamp,timestamp,input.runId,input.actorId,input.claimToken,timestamp);
  if (Number(updated.changes)!==1) throw new Error("The Agent Run lease expired before failure could be persisted.");
  appendEvent(input.runId,"agent",input.actorId,"failed",{message});
  appendActivity(current.work_item_id,input.actorId,"agent_run_failed",input.runId,"Agent run failed",{message});
  if (current.plan_id) refreshAgentPlan(current.plan_id);
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
  run("UPDATE agent_runs SET status='queued',claimed_by=NULL,claim_token=NULL,heartbeat_at=NULL,lease_expires_at=NULL,started_at=NULL,finished_at=NULL,handoff_reason='',error_message='',updated_at=? WHERE id=? AND status='waiting_for_human'",
    timestamp,input.runId);
  appendEvent(input.runId,"human",input.actorId,"resumed",{additionalContext:input.additionalContext});
  appendActivity(current.work_item_id,input.actorId,"agent_run_resumed",input.runId,"Agent run returned to the execution queue");
  if (current.plan_id) refreshAgentPlan(current.plan_id);
  return getRun(input.runId);
}

export function listAgentRuns(workItemId:string,actorId:string) {
  requirePermission(workItemId,actorId,"read");
  const runs=all(
    "SELECT r.id,r.work_item_id,r.task_id,r.plan_id,r.node_key,r.agent_key,r.skill_name,r.objective,r.requested_by,r.claimed_by,r.status,r.handoff_reason,r.result_artifact_id,r.error_message,r.created_at,r.updated_at,r.started_at,r.finished_at,r.heartbeat_at,r.lease_expires_at,r.attempt_count,r.max_attempts,requestor.display_name AS requested_by_name,claimer.display_name AS claimed_by_name FROM agent_runs r JOIN people requestor ON requestor.id=r.requested_by LEFT JOIN people claimer ON claimer.id=r.claimed_by WHERE r.work_item_id=? ORDER BY r.created_at DESC",
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
