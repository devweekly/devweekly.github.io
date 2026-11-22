export interface Person { id:string; display_name:string; title:string; email:string; avatar_color:string; }
export interface WorkItem { id:string; code:string; type:string; title:string; description:string; status:string; priority:string; owner_id:string; owner_name:string; target_date?:string; context_version:number; artifact_count:number; open_task_count:number; }
export interface DebtItem { id:string; code:string; title:string; status:string; owner_id:string; owner_name:string; target_date?:string; priority:string; severity:string; target_state:string; remediation_plan:string; debt_status:string; }
export interface Artifact { id:string; type:string; code:string|null; title:string; version:number; status:string; summary:string; content:string; submitter_name:string; created_at:string; }
export interface Participation { person_id:string; role_key:string; role_label:string; permissions_json:string; display_name:string; title:string; avatar_color:string; }
export interface Review { id:string; discipline:string; outcome:string; summary:string; findings_json:string; reviewer_name:string; artifact_code:string|null; artifact_title:string; artifact_version:number; created_at:string; }
export interface WorkTask { id:string; title:string; kind:string; status:string; assignee_id:string|null; assignee_name:string|null; due_date:string|null; }
export interface Decision { id:string; subject_type:string; subject_id:string|null; outcome:string; rationale:string; conditions:string; decision_maker_name:string; created_at:string; }
export interface Comment { id:string; body:string; author_name:string; avatar_color:string; created_at:string; }
export interface Activity { id:string; summary:string; actor_name:string; created_at:string; }
export interface WorkItemDetail { workItem:WorkItem; participants:Participation[]; artifacts:Artifact[]; cycles:{id:string;name:string;status:string;due_date:string;baseline_json:string}[]; reviews:Review[]; tasks:WorkTask[]; decisions:Decision[]; comments:Comment[]; activity:Activity[]; attachments:Attachment[]; permissions:string[]; }
export interface Bootstrap { actorId:string; people:Person[]; workItems:WorkItem[]; debts:DebtItem[]; counts:{openWorkItems:number;awaitingReview:number;activeDebts:number;myTasks:number}; }

export interface Attachment { id:string; original_name:string; content_type:string; size_bytes:number; uploaded_by:string; created_at:string; }
