export interface Person {
  id:string; display_name:string; title:string; email:string; avatar_color:string;
  department:string; location:string; bio:string; expertise_json:string; timezone:string; is_admin:number;
}
export interface WorkItem { id:string; code:string; type:string; title:string; description:string; status:string; priority:string; owner_id:string; owner_name:string; requestor_id:string|null; requestor_name:string; target_date?:string; context_version:number; artifact_count:number; open_task_count:number; }
export interface DebtItem { id:string; code:string; title:string; status:string; owner_id:string; owner_name:string; target_date?:string; priority:string; severity:string; target_state:string; remediation_plan:string; debt_status:string; }
export interface Artifact { id:string; type:string; code:string|null; title:string; version:number; status:string; summary:string; content:string; submitter_name:string; created_at:string; }
export interface Participation { id:string; person_id:string; role_key:string; role_label:string; permissions_json:string; display_name:string; title:string; email:string; avatar_color:string; department:string; }
export interface Review { id:string; discipline:string; outcome:string; summary:string; findings_json:string; reviewer_name:string; artifact_code:string|null; artifact_title:string; artifact_version:number; created_at:string; }
export interface WorkTask { id:string; title:string; kind:string; status:string; assignee_id:string|null; assignee_name:string|null; due_date:string|null; }
export interface Decision { id:string; subject_type:string; subject_id:string|null; outcome:string; rationale:string; conditions:string; decision_maker_name:string; created_at:string; }
export interface Comment { id:string; body:string; author_name:string; avatar_color:string; created_at:string; }
export interface Activity { id:string; summary:string; actor_name:string; created_at:string; }
export interface WorkflowStep { title:string; description:string; status:"wait"|"process"|"finish"|"error"; }
export interface WorkflowTransition { id:string; from_status:string; to_status:string; action:string; reason:string; actor_name:string; created_at:string; }
export interface WorkflowProjection {
  status:string; currentStep:number; visualStatus:"wait"|"process"|"finish"|"error";
  steps:WorkflowStep[]; availableActions:string[]; history:WorkflowTransition[];
}
export interface AgentProfile {
  key:string; name:string; description:string; skillName:string;
}
export type AgentRunStatus = "queued"|"running"|"waiting_for_human"|"completed"|"failed"|"cancelled";
export interface AgentRun {
  id:string; work_item_id:string; task_id:string|null; agent_key:string; skill_name:string; objective:string;
  requested_by:string; claimed_by:string|null; status:AgentRunStatus; handoff_reason:string;
  result_artifact_id:string|null; error_message:string; created_at:string; updated_at:string;
  started_at:string|null; finished_at:string|null; requested_by_name:string; claimed_by_name:string|null;
}
export interface WorkItemDetail {
  workItem:WorkItem; participants:Participation[]; artifacts:Artifact[];
  cycles:{id:string;name:string;status:string;due_date:string;baseline_json:string}[];
  reviews:Review[]; tasks:WorkTask[]; decisions:Decision[]; comments:Comment[];
  activity:Activity[]; attachments:Attachment[]; externalLinks:ExternalResourceLink[]; agentRuns:AgentRun[];
  permissions:string[]; canManageParticipants:boolean; workflow:WorkflowProjection;
}
export interface Bootstrap { actorId:string; people:Person[]; workItems:WorkItem[]; debts:DebtItem[]; counts:{openWorkItems:number;awaitingReview:number;activeDebts:number;myTasks:number}; }

export interface Attachment { id:string; original_name:string; content_type:string; size_bytes:number; uploaded_by:string; created_at:string; }

export interface ExternalResourceLink {
  id:string; provider:string; resource_type:string; external_id:string; external_key:string;
  title:string; url:string; relation_type:string; confluence_template_key:string|null;
  confluence_template_name:string|null; created_at:string;
}
export interface AnalyticsBreakdown { key:string; count:number; label?:string; }
export interface RequestAnalytics {
  total:number; active:number; inReview:number; overdue:number; linked:number; withoutExternalLinks:number;
  byStatus:AnalyticsBreakdown[]; byType:AnalyticsBreakdown[]; byPriority:AnalyticsBreakdown[];
  aging:{key:string;label:string;count:number}[];
  externalSystems:{key:string;count:number;requestCount:number}[]; externalReferenceCount:number;
}
export interface TechnicalDebtAnalytics {
  total:number; active:number; overdue:number; dueNext30Days:number;
  byStatus:AnalyticsBreakdown[]; bySeverity:AnalyticsBreakdown[]; byPriority:AnalyticsBreakdown[];
  aging:{key:string;label:string;count:number}[];
  byOriginRequest:{code:string;title:string;debt_count:number}[];
}
export interface WorkbenchAnalytics { generatedAt:string; requests:RequestAnalytics; technicalDebt:TechnicalDebtAnalytics; }

export interface ExternalResourceRef {
  id:string; provider:string; resource_type:string; external_id:string; external_key:string;
  title:string; url:string;
}

export interface MyTask extends WorkTask {
  work_item_id:string; work_item_code:string; work_item_title:string;
  work_item_status:string; requestor_name:string|null; created_at:string; updated_at:string;
}
