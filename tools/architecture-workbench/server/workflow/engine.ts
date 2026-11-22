import { all, id, now, one, run } from "../db.js";

export type WorkflowAction =
  | "start_analysis"
  | "submit_for_review"
  | "request_changes"
  | "accept"
  | "reject"
  | "more_analysis"
  | "close";

type ActionRule = {
  from: string[];
  to: string;
  permission: string;
  allowRequestor?: boolean;
  allowAdmin?: boolean;
  allowManager?: boolean;
  requiresArtifact?: boolean;
};

const rules: Record<WorkflowAction,ActionRule> = {
  start_analysis: { from:["draft"], to:"analysis", permission:"contribute", allowRequestor:true, allowAdmin:true },
  submit_for_review: { from:["analysis","changes_requested"], to:"in_review", permission:"contribute", allowRequestor:true, allowAdmin:true, requiresArtifact:true },
  request_changes: { from:["in_review"], to:"changes_requested", permission:"review", allowAdmin:true },
  accept: { from:["in_review"], to:"accepted", permission:"decide", allowAdmin:true },
  reject: { from:["in_review"], to:"rejected", permission:"decide", allowAdmin:true },
  more_analysis: { from:["in_review"], to:"analysis", permission:"decide", allowAdmin:true },
  close: { from:["accepted","rejected"], to:"closed", permission:"decide", allowAdmin:true, allowManager:true }
};

export const workflowStepDefinitions = [
  { key:"draft", title:"提交请求", description:"Requestor 提交业务需求和目标" },
  { key:"analysis", title:"分析与方案", description:"整理上下文、方案和架构产物" },
  { key:"in_review", title:"专业评审", description:"相关人员提交独立 Review 意见" },
  { key:"decision", title:"正式决定", description:"Decision Authority 记录正式决定" },
  { key:"closed", title:"关闭", description:"事项完成并保留完整记录" }
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

function canPerform(rule:ActionRule,workItemId:string,actorId:string):boolean {
  const permissions=getWorkItemPermissions(workItemId,actorId);
  if (rule.allowAdmin && isGlobalAdmin(actorId)) return true;
  const item=one<{requestor_id:string|null}>("SELECT requestor_id FROM work_items WHERE id=?",workItemId);
  if (rule.allowRequestor && item?.requestor_id===actorId) return true;
  if (rule.allowManager && (permissions.includes("manage") || item?.requestor_id===actorId)) return true;
  return permissions.includes(rule.permission);
}

export function validateWorkflowTransition(workItemId:string,actorId:string,action:WorkflowAction) {
  const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",workItemId);
  if (!item) return { ok:false as const, statusCode:404, error:"Work Item not found" };
  const rule=rules[action];
  if (!rule) return { ok:false as const, statusCode:400, error:"Unsupported workflow action" };
  if (!rule.from.includes(item.status)) {
    return { ok:false as const, statusCode:409, error:`Workflow action ${action} is not valid from status ${item.status}.` };
  }
  if (!canPerform(rule,workItemId,actorId)) {
    return { ok:false as const, statusCode:403, error:"The current principal is not authorized for this workflow action." };
  }
  if (rule.requiresArtifact) {
    const count=one<{n:number}>("SELECT COUNT(*) AS n FROM artifacts WHERE work_item_id=?",workItemId)?.n || 0;
    if (count===0) return { ok:false as const, statusCode:409, error:"At least one architecture artifact is required before submitting for review." };
  }
  return { ok:true as const, from:item.status, to:rule.to, rule };
}

export function transitionWorkItem(workItemId:string,actorId:string,action:WorkflowAction,reason="") {
  const validation=validateWorkflowTransition(workItemId,actorId,action);
  if (!validation.ok) return validation;
  const timestamp=now();
  if (action==="submit_for_review") {
    run("UPDATE review_cycles SET status='closed' WHERE work_item_id=? AND status='active'",workItemId);
    const baseline=all<{id:string;version:number}>(
      "SELECT a.id,a.version FROM artifacts a WHERE a.work_item_id=? AND NOT EXISTS (SELECT 1 FROM artifacts newer WHERE newer.work_item_id=a.work_item_id AND COALESCE(newer.code,newer.id)=COALESCE(a.code,a.id) AND newer.version>a.version)",
      workItemId
    );
    const round=one<{n:number}>("SELECT COUNT(*) AS n FROM review_cycles WHERE work_item_id=?",workItemId)?.n || 0;
    run("INSERT INTO review_cycles(id,work_item_id,name,baseline_json,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      id("cycle"),workItemId,"Architecture Review · Round "+(round+1),JSON.stringify(baseline),"active",actorId,timestamp);
  }
  run("UPDATE work_items SET status=?,context_version=context_version+1,updated_at=? WHERE id=?",validation.to,timestamp,workItemId);
  run("INSERT INTO workflow_transitions(id,work_item_id,from_status,to_status,action,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
    id("wf"),workItemId,validation.from,validation.to,action,reason,actorId,timestamp);
  run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id("evt"),workItemId,actorId,"workflow_transition","work_item",workItemId,
    "Workflow: "+validation.from+" → "+validation.to,JSON.stringify({action,reason}),timestamp);
  return { ok:true as const, from:validation.from, to:validation.to };
}

function currentStep(status:string) {
  if (status==="draft") return 0;
  if (status==="analysis" || status==="changes_requested") return 1;
  if (status==="in_review") return 2;
  if (status==="accepted" || status==="rejected") return 3;
  if (status==="closed") return 4;
  return 1;
}

export function getWorkflowProjection(workItemId:string,actorId:string) {
  const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",workItemId);
  if (!item) return null;
  const status=item.status;
  const activeStep=currentStep(status);
  const history=all<{id:string;from_status:string;to_status:string;action:string;reason:string;actor_name:string;created_at:string}>(
    "SELECT t.id,t.from_status,t.to_status,t.action,t.reason,p.display_name AS actor_name,t.created_at FROM workflow_transitions t JOIN people p ON p.id=t.actor_id WHERE t.work_item_id=? ORDER BY t.created_at DESC LIMIT 20",
    workItemId
  );
  const availableActions=(Object.keys(rules) as WorkflowAction[]).filter(action=>validateWorkflowTransition(workItemId,actorId,action).ok);
  return {
    status,
    currentStep:activeStep,
    visualStatus:status==="changes_requested" || status==="rejected" ? "error" : status==="accepted" || status==="closed" ? "finish" : "process",
    steps:workflowStepDefinitions.map((step,index)=>({
      title:index===1 && status==="changes_requested" ? "待补充修改" : index===3 && status==="rejected" ? "已拒绝" : index===3 && status==="accepted" ? "已接受" : step.title,
      description:index===1 && status==="changes_requested" ? "评审意见要求补充或修改" : step.description,
      status:index<activeStep ? "finish" : index===activeStep ? (status==="changes_requested" || status==="rejected" ? "error" : "process") : "wait"
    })),
    availableActions,
    history
  };
}
