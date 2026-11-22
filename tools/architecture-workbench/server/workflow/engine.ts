import { all, db, id, now, one, run } from "../db.js";

export type WorkflowAction = "submit_request" | "close";

type SubmissionInput = {
  submissionMessage?: string;
  package?: Record<string, unknown>;
  assistedByRunId?: string | null;
};

const REVIEW_DAYS = Math.max(1, Math.min(30, Number(process.env.WORKFLOW_REVIEW_DAYS || 5)));
const CLARIFICATION_DAYS = Math.max(1, Math.min(14, Number(process.env.WORKFLOW_CLARIFICATION_DAYS || 3)));

export const workflowStepDefinitions = [
  { key:"request_package", title:"Request 提交", description:"Requestor 确认目标、背景、范围和初步方案" },
  { key:"discussion_review", title:"讨论与评审", description:"参与者异步讨论；普通评论不阻断，澄清或异议按规则处理" },
  { key:"decision_meeting", title:"决定会议", description:"Chairman / Admin 主持并记录正式结论" },
  { key:"close", title:"关闭", description:"Chairman / Admin 确认关闭并保留完整记录" }
];

export function isGlobalAdmin(actorId: string): boolean {
  return Boolean(one<{is_admin:number}>("SELECT is_admin FROM people WHERE id=?",actorId)?.is_admin);
}

export function getWorkItemPermissions(workItemId:string,actorId:string):string[] {
  if (isGlobalAdmin(actorId)) return ["read","contribute","comment","review","decide","manage"];
  const rows=all<{permissions_json:string}>("SELECT permissions_json FROM participations WHERE work_item_id=? AND person_id=?",workItemId,actorId);
  return [...new Set(rows.flatMap(row=>JSON.parse(row.permissions_json) as string[]))];
}

export function canManageParticipants(workItemId:string,actorId:string):boolean {
  const item=one<{requestor_id:string|null}>("SELECT requestor_id FROM work_items WHERE id=?",workItemId);
  return isGlobalAdmin(actorId) || item?.requestor_id===actorId || getWorkItemPermissions(workItemId,actorId).includes("manage");
}

export function canChair(workItemId:string,actorId:string):boolean {
  if (isGlobalAdmin(actorId)) return true;
  const item=one<{chairman_id:string|null}>("SELECT chairman_id FROM work_items WHERE id=?",workItemId);
  if (item?.chairman_id) return item.chairman_id===actorId;
  return Boolean(one(
    "SELECT id FROM participations WHERE work_item_id=? AND person_id=? AND role_key IN ('chairman','decision_authority') AND permissions_json LIKE '%\\"decide\\"%'",
    workItemId,actorId
  ));
}

function appendTransition(workItemId:string,from:string,to:string,action:string,reason:string,actorId:string,timestamp:string) {
  run("INSERT INTO workflow_transitions(id,work_item_id,from_status,to_status,action,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
    id("wf"),workItemId,from,to,action,reason,actorId,timestamp);
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id("evt"),workItemId,actorId,"workflow_transition","work_item",workItemId,
    "Workflow: "+from+" → "+to,JSON.stringify({action,reason}),timestamp);
}

function cancelCycleTimers(cycleId:string,timestamp:string) {
  run("UPDATE workflow_timers SET status='cancelled',updated_at=? WHERE cycle_id=? AND status IN ('scheduled','processing')",timestamp,cycleId);
}

function snapshotManifest(workItemId:string) {
  return all<{id:string;version:number;code:string|null;type:string;title:string;content_hash:string}>(
    "SELECT a.id,a.version,a.code,a.type,a.title,a.content_hash FROM artifacts a WHERE a.work_item_id=? AND NOT EXISTS (SELECT 1 FROM artifacts newer WHERE newer.work_item_id=a.work_item_id AND COALESCE(newer.code,newer.id)=COALESCE(a.code,a.id) AND newer.version>a.version)",
    workItemId
  );
}

function createRequestSubmission(workItemId:string,actorId:string,input:SubmissionInput,timestamp:string) {
  const item=one<{requestor_id:string|null;context_version:number;request_package_json:string|null}>(
    "SELECT requestor_id,context_version,request_package_json FROM work_items WHERE id=?",workItemId
  );
  if (!item) throw new Error("Work Item not found.");
  if (item.requestor_id!==actorId && !isGlobalAdmin(actorId)) throw new Error("Only the Requestor or a Workbench Admin may submit this Request.");
  if (input.assistedByRunId) {
    const agentRun=one<{work_item_id:string;status:string}>("SELECT work_item_id,status FROM agent_runs WHERE id=?",input.assistedByRunId);
    if (!agentRun || agentRun.work_item_id!==workItemId || agentRun.status!=="completed") {
      throw new Error("The assisting Agent Run must be completed and belong to this Request.");
    }
  }
  const prior=one<{id:string}>("SELECT id FROM submissions WHERE work_item_id=? ORDER BY sequence DESC LIMIT 1",workItemId);
  const sequence=(one<{n:number}>("SELECT COALESCE(MAX(sequence),0) AS n FROM submissions WHERE work_item_id=?",workItemId)?.n || 0)+1;
  const manifest=snapshotManifest(workItemId);
  const packageValue=input.package ?? (item.request_package_json ? JSON.parse(item.request_package_json) : {});
  const message=String(input.submissionMessage || (packageValue as Record<string,unknown>).submissionMessage || "Initial Request Package").trim();
  const submissionId=id("sub");
  run("INSERT INTO submissions(id,work_item_id,sequence,purpose,manifest_json,context_version,created_by,created_at,submission_message,package_json,assisted_by_run_id,source_submission_id,submitted_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    submissionId,workItemId,sequence,"request",JSON.stringify(manifest),item.context_version,actorId,timestamp,message,JSON.stringify(packageValue),input.assistedByRunId || null,prior?.id || null,item.requestor_id || actorId);
  const reviewers=all<{person_id:string;display_name:string;role_key:string}>(
    "SELECT p.person_id,people.display_name,p.role_key FROM participations p JOIN people ON people.id=p.person_id WHERE p.work_item_id=? AND p.person_id<>? AND p.permissions_json LIKE '%\"review\"%' ORDER BY people.display_name",
    workItemId,item.requestor_id || actorId
  );
  const dueAt=new Date(Date.parse(timestamp)+REVIEW_DAYS*86400000).toISOString();
  const cycleId=id("cycle");
  run("INSERT INTO review_cycles(id,work_item_id,submission_id,name,baseline_json,status,due_date,review_deadline_at,remaining_review_ms,reviewer_snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    cycleId,workItemId,submissionId,"Review · Submission "+sequence,JSON.stringify(manifest),"active",dueAt.slice(0,10),dueAt,null,JSON.stringify(reviewers),actorId,timestamp);
  run("INSERT INTO workflow_timers(id,work_item_id,cycle_id,submission_id,clarification_id,timer_type,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    id("wt"),workItemId,cycleId,submissionId,null,"review_deadline",dueAt,"scheduled",timestamp,timestamp);
  return {submissionId,cycleId,dueAt,sequence};
}

function validateWorkflowTransition(workItemId:string,actorId:string,action:WorkflowAction) {
  const item=one<{status:string;requestor_id:string|null}>("SELECT status,requestor_id FROM work_items WHERE id=?",workItemId);
  if (!item) return {ok:false as const,statusCode:404,error:"Work Item not found"};
  if (action==="submit_request") {
    if (!["draft","requestor_revision"].includes(item.status)) {
      return {ok:false as const,statusCode:409,error:"A Request Package can only be submitted from draft or requestor revision."};
    }
    if (item.requestor_id!==actorId && !isGlobalAdmin(actorId)) {
      return {ok:false as const,statusCode:403,error:"Only the Requestor or a Workbench Admin may submit this Request."};
    }
    return {ok:true as const,from:item.status,to:"discussion_review"};
  }
  if (action==="close") {
    if (!["approved_pending_close","rejected_pending_close"].includes(item.status)) {
      return {ok:false as const,statusCode:409,error:"Only an approved or rejected Request can be closed."};
    }
    if (!canChair(workItemId,actorId)) {
      return {ok:false as const,statusCode:403,error:"Only the assigned Chairman or a Workbench Admin may close this Request."};
    }
    return {ok:true as const,from:item.status,to:"closed"};
  }
  return {ok:false as const,statusCode:400,error:"Unsupported workflow action"};
}

export function transitionWorkItem(workItemId:string,actorId:string,action:WorkflowAction,reason="",input:SubmissionInput={}) {
  const validation=validateWorkflowTransition(workItemId,actorId,action);
  if (!validation.ok) return validation;
  const timestamp=now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (action==="submit_request") {
      createRequestSubmission(workItemId,actorId,input,timestamp);
      if (input.package) run("UPDATE work_items SET request_package_json=? WHERE id=?",JSON.stringify(input.package),workItemId);
    } else {
      const cycle=one<{id:string}>("SELECT id FROM review_cycles WHERE work_item_id=? ORDER BY created_at DESC LIMIT 1",workItemId);
      if (cycle) cancelCycleTimers(cycle.id,timestamp);
    }
    const changed=run("UPDATE work_items SET status=?,context_version=context_version+1,updated_at=? WHERE id=? AND status=?",
      validation.to,timestamp,workItemId,validation.from);
    if (Number(changed.changes)!==1) {
      db.exec("ROLLBACK");
      return {ok:false as const,statusCode:409,error:"The Request changed while the action was being processed. Refresh and try again."};
    }
    appendTransition(workItemId,validation.from,validation.to,action,reason,actorId,timestamp);
    db.exec("COMMIT");
    return {ok:true as const,from:validation.from,to:validation.to};
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function raiseObjection(workItemId:string,actorId:string,reason:string) {
  const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",workItemId);
  const cycle=one<{id:string}>("SELECT id FROM review_cycles WHERE work_item_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",workItemId);
  if (item?.status!=="discussion_review" || !cycle) return {ok:false as const,statusCode:409,error:"A blocking objection can only be raised during active discussion and review."};
  const timestamp=now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const itemChanged=run("UPDATE work_items SET status='decision_meeting',updated_at=? WHERE id=? AND status='discussion_review'",timestamp,workItemId);
    const cycleChanged=run("UPDATE review_cycles SET status='closed' WHERE id=? AND status='active'",cycle.id);
    if (Number(itemChanged.changes)!==1 || Number(cycleChanged.changes)!==1) {
      db.exec("ROLLBACK");
      return {ok:false as const,statusCode:409,error:"The review window has already ended. Refresh the Request before raising an objection."};
    }
    cancelCycleTimers(cycle.id,timestamp);
    appendTransition(workItemId,"discussion_review","decision_meeting","raise_objection",reason,actorId,timestamp);
    db.exec("COMMIT");
    return {ok:true as const};
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}

export function createClarification(workItemId:string,actorId:string,input:{artifactId:string|null;question:string;responseDueAt:string}) {
  const item=one<{status:string;requestor_id:string|null}>("SELECT status,requestor_id FROM work_items WHERE id=?",workItemId);
  if (!item || item.status!=="discussion_review") return {ok:false as const,statusCode:409,error:"Clarification can only be requested during discussion and review."};
  const cycle=one<{id:string;submission_id:string|null;baseline_json:string;review_deadline_at:string|null}>(
    "SELECT id,submission_id,baseline_json,review_deadline_at FROM review_cycles WHERE work_item_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",workItemId
  );
  if (!cycle) return {ok:false as const,statusCode:409,error:"No active Review Cycle exists."};
  const artifact=input.artifactId
    ? one<{id:string;version:number;title:string;submitted_by:string}>("SELECT id,version,title,submitted_by FROM artifacts WHERE id=? AND work_item_id=?",input.artifactId,workItemId)
    : null;
  if (input.artifactId && !artifact) return {ok:false as const,statusCode:400,error:"Clarification target must belong to this Request."};
  if (artifact?.submitted_by===actorId) return {ok:false as const,statusCode:403,error:"Independent reviewers cannot request clarification on their own Artifact."};
  const baseline=JSON.parse(cycle.baseline_json) as {id:string;version:number}[];
  if (artifact && !baseline.some(entry=>entry.id===artifact.id && entry.version===artifact.version)) return {ok:false as const,statusCode:409,error:"Clarification target is outside the active Submission baseline."};
  if (one("SELECT id FROM clarification_requests WHERE cycle_id=? AND status='requested'",cycle.id)) return {ok:false as const,statusCode:409,error:"A clarification is already waiting for the Requestor."};
  if (!input.question.trim()) return {ok:false as const,statusCode:400,error:"A clarification question is required."};
  const responseDeadline=Date.parse(input.responseDueAt);
  if (!Number.isFinite(responseDeadline) || responseDeadline<=Date.now()) return {ok:false as const,statusCode:400,error:"Clarification response deadline must be in the future."};
  const dueAt=new Date(responseDeadline).toISOString();
  const timestamp=now();
  const remaining=Math.max(0,Date.parse(cycle.review_deadline_at || timestamp)-Date.now());
  db.exec("BEGIN IMMEDIATE");
  try {
    const clarificationId=id("clar");
    const itemChanged=run("UPDATE work_items SET status='waiting_requestor',updated_at=? WHERE id=? AND status='discussion_review'",timestamp,workItemId);
    const cycleChanged=run("UPDATE review_cycles SET status='waiting_requestor',remaining_review_ms=?,paused_at=? WHERE id=? AND status='active'",remaining,timestamp,cycle.id);
    if (Number(itemChanged.changes)!==1 || Number(cycleChanged.changes)!==1) {
      db.exec("ROLLBACK");
      return {ok:false as const,statusCode:409,error:"The review window has already ended. Refresh the Request before asking for clarification."};
    }
    run("INSERT INTO clarification_requests(id,work_item_id,cycle_id,submission_id,requested_by,artifact_id,question,response_due_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      clarificationId,workItemId,cycle.id,cycle.submission_id,actorId,artifact?.id || null,input.question.trim(),dueAt,"requested",timestamp);
    if (artifact) run("INSERT INTO reviews(id,cycle_id,artifact_id,artifact_version,reviewer_id,discipline,outcome,summary,findings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id("rev"),cycle.id,artifact.id,artifact.version,actorId,"General","clarification_requested",input.question.trim(),"[]",timestamp);
    run("UPDATE workflow_timers SET status='cancelled',updated_at=? WHERE cycle_id=? AND timer_type='review_deadline' AND status IN ('scheduled','processing')",timestamp,cycle.id);
    run("INSERT INTO workflow_timers(id,work_item_id,cycle_id,submission_id,clarification_id,timer_type,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id("wt"),workItemId,cycle.id,cycle.submission_id,clarificationId,"clarification_deadline",dueAt,"scheduled",timestamp,timestamp);
    appendTransition(workItemId,"discussion_review","waiting_requestor","request_clarification",input.question,actorId,timestamp);
    run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      id("evt"),workItemId,actorId,"clarification_requested","clarification",clarificationId,"Requested clarification from Requestor",JSON.stringify({responseDueAt:dueAt,artifactId:artifact.id}),timestamp);
    db.exec("COMMIT");
    return {ok:true as const,id:clarificationId,responseDueAt:dueAt};
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}

export function answerClarification(workItemId:string,clarificationId:string,actorId:string,answer:string) {
  const item=one<{status:string;requestor_id:string|null}>("SELECT status,requestor_id FROM work_items WHERE id=?",workItemId);
  const clarification=one<{id:string;cycle_id:string;status:string;response_due_at:string}>(
    "SELECT id,cycle_id,status,response_due_at FROM clarification_requests WHERE id=? AND work_item_id=?",clarificationId,workItemId
  );
  if (!item || !clarification) return {ok:false as const,statusCode:404,error:"Clarification not found."};
  if (item.requestor_id!==actorId && !isGlobalAdmin(actorId)) return {ok:false as const,statusCode:403,error:"Only the Requestor may answer a clarification."};
  if (item.status!=="waiting_requestor" || clarification.status!=="requested") return {ok:false as const,statusCode:409,error:"This clarification is no longer awaiting an answer."};
  if (Date.parse(clarification.response_due_at)<=Date.now()) return {ok:false as const,statusCode:409,error:"The clarification response deadline has passed; the Request will proceed to the decision meeting."};
  const timestamp=now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const answered=run("UPDATE clarification_requests SET status='answered',answer=?,answered_by=?,answered_at=? WHERE id=? AND status='requested' AND response_due_at>?",answer.trim(),actorId,timestamp,clarificationId,timestamp);
    if (Number(answered.changes)!==1) {
      db.exec("ROLLBACK");
      return {ok:false as const,statusCode:409,error:"The clarification response deadline has passed; the Request will proceed to the decision meeting."};
    }
    run("UPDATE workflow_timers SET status='cancelled',updated_at=? WHERE clarification_id=? AND status IN ('scheduled','processing')",timestamp,clarificationId);
    const pending=one<{n:number}>("SELECT COUNT(*) AS n FROM clarification_requests WHERE cycle_id=? AND status='requested'",clarification.cycle_id)?.n || 0;
    if (pending===0) {
      const cycle=one<{submission_id:string|null;remaining_review_ms:number|null}>("SELECT submission_id,remaining_review_ms FROM review_cycles WHERE id=?",clarification.cycle_id);
      const remaining=Math.max(0,cycle?.remaining_review_ms || 0);
      const deadline=new Date(Date.now()+remaining).toISOString();
      run("UPDATE review_cycles SET status='active',review_deadline_at=?,remaining_review_ms=NULL,paused_at=NULL WHERE id=?",deadline,clarification.cycle_id);
      run("UPDATE work_items SET status='discussion_review',updated_at=? WHERE id=?",timestamp,workItemId);
      run("INSERT INTO workflow_timers(id,work_item_id,cycle_id,submission_id,clarification_id,timer_type,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        id("wt"),workItemId,clarification.cycle_id,cycle?.submission_id || null,null,"review_deadline",deadline,"scheduled",timestamp,timestamp);
      appendTransition(workItemId,"waiting_requestor","discussion_review","answer_clarification","Requestor answered the clarification.",actorId,timestamp);
    }
    run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      id("evt"),workItemId,actorId,"clarification_answered","clarification",clarificationId,"Requestor answered a clarification",JSON.stringify({answer:answer.trim()}),timestamp);
    db.exec("COMMIT");
    return {ok:true as const};
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}

export function recordFormalDecision(workItemId:string,actorId:string,input:{outcome:"approved"|"needs_work"|"rejected";rationale:string;conditions?:string;meetingAt?:string;minutes?:string}) {
  if (!canChair(workItemId,actorId)) return {ok:false as const,statusCode:403,error:"Only the assigned Chairman or a Workbench Admin may record a formal decision."};
  const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",workItemId);
  if (!item) return {ok:false as const,statusCode:404,error:"Work Item not found."};
  if (item.status!=="decision_meeting") return {ok:false as const,statusCode:409,error:"A formal decision can only be recorded from the Decision Meeting stage."};
  if (!input.rationale.trim()) return {ok:false as const,statusCode:400,error:"A decision rationale is required."};
  const nextStatus=input.outcome==="approved"?"approved_pending_close":input.outcome==="rejected"?"rejected_pending_close":"requestor_revision";
  const timestamp=now();
  const cycle=one<{id:string;submission_id:string|null}>("SELECT id,submission_id FROM review_cycles WHERE work_item_id=? ORDER BY created_at DESC LIMIT 1",workItemId);
  db.exec("BEGIN IMMEDIATE");
  try {
    const stateChanged=run("UPDATE work_items SET status=?,decision_outcome=?,updated_at=? WHERE id=? AND status='decision_meeting'",
      nextStatus,input.outcome,timestamp,workItemId);
    if (Number(stateChanged.changes)!==1) {
      db.exec("ROLLBACK");
      return {ok:false as const,statusCode:409,error:"The Decision Meeting has already been completed. Refresh the Request."};
    }
    const decisionId=id("dec");
    run("INSERT INTO decisions(id,work_item_id,subject_type,subject_id,outcome,rationale,conditions,decision_maker_id,policy_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      decisionId,workItemId,"work_item",null,input.outcome,input.rationale,input.conditions || "",actorId,"chairman-meeting-v1",timestamp);
    run("INSERT INTO decision_meetings(id,work_item_id,cycle_id,submission_id,chairman_id,meeting_at,minutes,outcome,rationale,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id("meeting"),workItemId,cycle?.id || null,cycle?.submission_id || null,actorId,input.meetingAt || timestamp,input.minutes || "",input.outcome,input.rationale,timestamp);
    if (cycle) {
      run("UPDATE review_cycles SET status='closed' WHERE id=?",cycle.id);
      cancelCycleTimers(cycle.id,timestamp);
    }
    appendTransition(workItemId,item.status,nextStatus,"record_decision",input.rationale,actorId,timestamp);
    run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      id("evt"),workItemId,actorId,"decision_recorded","decision_meeting",decisionId,"Decision meeting concluded: "+input.outcome,JSON.stringify({outcome:input.outcome,meetingAt:input.meetingAt || timestamp}),timestamp);
    db.exec("COMMIT");
    return {ok:true as const,id:decisionId,to:nextStatus};
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}

function currentStep(status:string) {
  if (status==="draft" || status==="requestor_revision") return 0;
  if (status==="discussion_review" || status==="waiting_requestor") return 1;
  if (status==="decision_meeting") return 2;
  if (status==="approved_pending_close" || status==="rejected_pending_close") return 3;
  if (status==="closed") return 4;
  return 0;
}

export function getWorkflowProjection(workItemId:string,actorId:string) {
  const item=one<{status:string;chairman_id:string|null;decision_outcome:string|null}>("SELECT status,chairman_id,decision_outcome FROM work_items WHERE id=?",workItemId);
  if (!item) return null;
  const status=item.status;
  const cycle=one<{id:string;name:string;status:string;review_deadline_at:string|null;reviewer_snapshot_json:string}>(
    "SELECT id,name,status,review_deadline_at,reviewer_snapshot_json FROM review_cycles WHERE work_item_id=? ORDER BY created_at DESC LIMIT 1",workItemId
  );
  const clarification=one<{id:string;question:string;response_due_at:string;requested_by:string;status:string}>(
    "SELECT id,question,response_due_at,requested_by,status FROM clarification_requests WHERE work_item_id=? AND status='requested' ORDER BY created_at DESC LIMIT 1",workItemId
  );
  const activeStep=currentStep(status);
  const history=all<{id:string;from_status:string;to_status:string;action:string;reason:string;actor_name:string;created_at:string}>(
    "SELECT t.id,t.from_status,t.to_status,t.action,t.reason,p.display_name AS actor_name,t.created_at FROM workflow_transitions t JOIN people p ON p.id=t.actor_id WHERE t.work_item_id=? ORDER BY t.created_at DESC LIMIT 30",
    workItemId
  );
  const availableActions:string[]=[];
  if (validateWorkflowTransition(workItemId,actorId,"submit_request").ok) availableActions.push("submit_request");
  if (validateWorkflowTransition(workItemId,actorId,"close").ok) availableActions.push("close");
  if (status==="decision_meeting" && canChair(workItemId,actorId)) availableActions.push("record_decision");
  return {
    status,
    currentStep:activeStep,
    visualStatus:status==="rejected_pending_close" ? "error" as const : status==="closed" ? "finish" as const : "process" as const,
    decisionOutcome:item.decision_outcome,
    chairmanId:item.chairman_id,
    reviewDeadlineAt:cycle?.status==="active" ? cycle.review_deadline_at : null,
    activeClarification:clarification || null,
    reviewerSnapshot:cycle?.reviewer_snapshot_json ? JSON.parse(cycle.reviewer_snapshot_json) : [],
    steps:workflowStepDefinitions.map((step,index)=>({
      title:index===3 && status==="rejected_pending_close" ? "拒绝后待关闭" : index===0 && status==="requestor_revision" ? "Requestor 修订" : step.title,
      description:index===0 && status==="requestor_revision" ? "根据决定会议要求修订并重新提交新的 Submission" : step.description,
      status:index<activeStep ? "finish" as const : index===activeStep ? (status==="rejected_pending_close" ? "error" as const : "process" as const) : "wait" as const
    })),
    availableActions,
    history
  };
}
