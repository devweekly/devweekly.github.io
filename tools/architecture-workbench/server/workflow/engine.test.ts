import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const testDirectory=mkdtempSync(join(tmpdir(),"architecture-workflow-"));
process.env.DATABASE_PATH=join(testDirectory,"workflow.sqlite");
process.env.WORKFLOW_REVIEW_DAYS="2";
process.env.WORKFLOW_CLARIFICATION_DAYS="1";

const {db,run,one,now}=await import("../db.js");
const {
  transitionWorkItem,
  createClarification,
  answerClarification,
  raiseObjection,
  recordFormalDecision
}=await import("./engine.js");
const {startWorkflowTimerService}=await import("./timer-service.js");

function person(id:string,isAdmin=0) {
  run("INSERT OR IGNORE INTO people(id,display_name,title,email,avatar_color,department,location,bio,expertise_json,timezone,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    id,id,"Architect",id+"@example.test","#777","Architecture","Tokyo","","[]","Asia/Tokyo",isAdmin,now());
}

function request(id:string) {
  run("INSERT INTO work_items(id,code,type,title,description,status,priority,owner_id,requestor_id,chairman_id,request_package_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id,"WI-"+id,"architecture_review","Request "+id,"Business background","draft","normal","requestor","requestor","chairman",
    JSON.stringify({goal:"Target outcome",scope:"Platform",decisionQuestions:"Confirm architecture direction.",submissionMessage:"Initial Request Package"}),now(),now());
  const participants=[
    ["requestor","requestor","Requestor",["read","contribute","comment","manage"]],
    ["reviewer","reviewer","Reviewer",["read","comment","review"]],
    ["chairman","chairman","Chairman",["read","review","decide"]],
    ["delegate","decision_authority","Legacy Decision Authority",["read","decide"]],
    ["admin","admin","Workbench Admin",["read","manage"]]
  ] as const;
  for(const [personId,role,label,permissions] of participants) {
    run("INSERT INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",
      "part-"+id+"-"+personId,id,personId,role,label,JSON.stringify(permissions),now());
  }
}

function status(workItemId:string) {
  return one<{status:string;decision_outcome:string|null}>("SELECT status,decision_outcome FROM work_items WHERE id=?",workItemId);
}

test("Request lifecycle freezes submissions, pauses review for clarification and requires Chairman decisions",()=>{
  person("requestor");
  person("reviewer");
  person("chairman");
  person("delegate");
  person("admin",1);
  person("u-workflow");
  request("workflow-one");
  run("INSERT INTO external_resource_refs(id,provider,resource_type,external_id,external_key,title,url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "ref-workflow-one","jira","Issue","external-1","ARCH-101","Identity boundary evidence","https://jira.example.test/browse/ARCH-101",now(),now());
  run("INSERT INTO work_item_external_links(id,work_item_id,resource_id,relation_type,linked_by,created_at) VALUES(?,?,?,?,?,?)",
    "link-workflow-one","workflow-one","ref-workflow-one","evidence","requestor",now());

  const first=transitionWorkItem("workflow-one","requestor","submit_request","Initial submission",{
    submissionMessage:"feat(request): initial platform review package",
    package:{goal:"Platform outcome",scope:"Customer identity",decisionQuestions:"Approve the identity boundary and migration sequence.",submissionMessage:"feat(request): initial platform review package"}
  });
  assert.equal(first.ok,true);
  assert.equal(status("workflow-one")?.status,"discussion_review");
  const firstSubmission=one<{id:string;sequence:number;submitted_by:string;submission_message:string;manifest_json:string;package_json:string}>(
    "SELECT id,sequence,submitted_by,submission_message,manifest_json,package_json FROM submissions WHERE work_item_id=?","workflow-one"
  );
  assert.equal(firstSubmission?.sequence,1);
  assert.equal(firstSubmission?.submitted_by,"requestor");
  assert.equal(firstSubmission?.submission_message,"feat(request): initial platform review package");
  assert.deepEqual(JSON.parse(firstSubmission?.manifest_json || "[]"),[]);
  const firstPackage=JSON.parse(firstSubmission?.package_json || "{}") as {externalReferences?:{external_key:string}[]};
  assert.deepEqual(firstPackage.externalReferences?.map(reference=>reference.external_key),["ARCH-101"]);
  const reviewerSnapshot=one<{reviewer_snapshot_json:string}>("SELECT reviewer_snapshot_json FROM review_cycles WHERE work_item_id=?","workflow-one");
  const reviewerIds=(JSON.parse(reviewerSnapshot?.reviewer_snapshot_json || "[]") as {person_id:string}[]).map(entry=>entry.person_id);
  assert.deepEqual(reviewerIds,["reviewer"]);
  const chairmanClarification=createClarification("workflow-one","chairman",{
    artifactId:null,question:"A Chairman is not automatically a Reviewer.",responseDueAt:new Date(Date.now()+60_000).toISOString()
  });
  assert.equal(chairmanClarification.ok,false);
  const delegateDecision=recordFormalDecision("workflow-one","delegate",{outcome:"needs_work",rationale:"A delegated decide permission is not Chairman assignment."});
  assert.equal(delegateDecision.ok,false);

  const clarification=createClarification("workflow-one","reviewer",{
    artifactId:null,
    question:"Please clarify the target authentication boundary.",
    responseDueAt:new Date(Date.now()+60_000).toISOString()
  });
  assert.equal(clarification.ok,true);
  assert.equal(status("workflow-one")?.status,"waiting_requestor");
  const paused=one<{status:string;remaining_review_ms:number}>(
    "SELECT status,remaining_review_ms FROM review_cycles WHERE work_item_id=?","workflow-one"
  );
  assert.equal(paused?.status,"waiting_requestor");
  assert.ok(paused && paused.remaining_review_ms>0);

  const forbiddenAnswer=answerClarification("workflow-one",clarification.ok?clarification.id:"missing","reviewer","Not the Requestor");
  assert.equal(forbiddenAnswer.ok,false);
  const answered=answerClarification("workflow-one",clarification.ok?clarification.id:"missing","requestor","The Workbench owns orchestration; identity remains in the enterprise IdP.");
  assert.equal(answered.ok,true);
  assert.equal(status("workflow-one")?.status,"discussion_review");

  const firstDecision=recordFormalDecision("workflow-one","chairman",{
    outcome:"needs_work",rationale:"The committee needs a revised trust-boundary explanation."
  });
  assert.equal(firstDecision.ok,false);
  assert.equal(status("workflow-one")?.status,"discussion_review");

  const objection=raiseObjection("workflow-one","reviewer","The trust model has a blocking gap.");
  assert.equal(objection.ok,true);
  assert.equal(status("workflow-one")?.status,"decision_meeting");

  const denied=recordFormalDecision("workflow-one","reviewer",{outcome:"needs_work",rationale:"Not authorized"});
  assert.equal(denied.ok,false);
  const needsWork=recordFormalDecision("workflow-one","chairman",{
    outcome:"needs_work",rationale:"The trust boundary needs a concrete revision.",minutes:"The committee requested a revised package."
  });
  assert.equal(needsWork.ok,true);
  assert.equal(status("workflow-one")?.status,"requestor_revision");
  assert.equal(status("workflow-one")?.decision_outcome,"needs_work");

  run("INSERT INTO external_resource_refs(id,provider,resource_type,external_id,external_key,title,url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "ref-workflow-two","github","PullRequest","external-2","PR-202","Review evidence added after first submission","https://github.com/example/repo/pull/202",now(),now());
  run("INSERT INTO work_item_external_links(id,work_item_id,resource_id,relation_type,linked_by,created_at) VALUES(?,?,?,?,?,?)",
    "link-workflow-two","workflow-one","ref-workflow-two","evidence","requestor",now());
  run("UPDATE work_items SET request_package_json=? WHERE id=?",
    JSON.stringify({goal:"Updated outcome",submissionMessage:"fix(request): clarify trust boundary"}),"workflow-one");
  const second=transitionWorkItem("workflow-one","requestor","submit_request","Revised submission",{
    submissionMessage:"fix(request): clarify trust boundary",
    package:{goal:"Updated outcome",scope:"Customer identity",decisionQuestions:"Approve the revised trust boundary.",submissionMessage:"fix(request): clarify trust boundary"}
  });
  assert.equal(second.ok,true);
  const submissions=one<{count:number}>("SELECT COUNT(*) AS count FROM submissions WHERE work_item_id=?","workflow-one");
  const latest=one<{sequence:number;source_submission_id:string|null;package_json:string}>(
    "SELECT sequence,source_submission_id,package_json FROM submissions WHERE work_item_id=? ORDER BY sequence DESC LIMIT 1","workflow-one"
  );
  assert.equal(submissions?.count,2);
  assert.equal(latest?.sequence,2);
  assert.equal(latest?.source_submission_id,firstSubmission?.id);
  const revisedPackage=JSON.parse(latest?.package_json || "{}") as {externalReferences?:{external_key:string}[]};
  assert.deepEqual(revisedPackage.externalReferences?.map(reference=>reference.external_key).sort(),["ARCH-101","PR-202"]);

  raiseObjection("workflow-one","reviewer","Second round objection");
  const approved=recordFormalDecision("workflow-one","chairman",{
    outcome:"approved",rationale:"The revised Request satisfies the committee conditions.",minutes:"Approved subject to normal delivery controls."
  });
  assert.equal(approved.ok,true);
  assert.equal(status("workflow-one")?.status,"approved_pending_close");
  assert.equal(status("workflow-one")?.decision_outcome,"approved");
  const decisionLink=one<{meeting_id:string;meeting_count:number}>(
    "SELECT d.meeting_id,(SELECT COUNT(*) FROM decision_meetings m WHERE m.id=d.meeting_id) AS meeting_count FROM decisions d WHERE d.id=?",
    approved.ok?approved.id:""
  );
  assert.ok(decisionLink?.meeting_id);
  assert.equal(decisionLink?.meeting_count,1);

  const reviewerClose=transitionWorkItem("workflow-one","reviewer","close");
  assert.equal(reviewerClose.ok,false);
  const closed=transitionWorkItem("workflow-one","chairman","close","Closure confirmed by the Chairman.");
  assert.equal(closed.ok,true);
  assert.equal(status("workflow-one")?.status,"closed");
});

test("persisted review timer advances a Request after its deadline",()=>{
  person("u-workflow");
  request("workflow-timer");
  const submitted=transitionWorkItem("workflow-timer","requestor","submit_request","Timer test",{
    submissionMessage:"test(timer): deadline"
  });
  assert.equal(submitted.ok,true);
  run("UPDATE workflow_timers SET due_at=? WHERE work_item_id=? AND timer_type='review_deadline'",
    new Date(Date.now()-1000).toISOString(),"workflow-timer");
  const scheduler=startWorkflowTimerService();
  try {
    assert.equal(status("workflow-timer")?.status,"decision_meeting");
    const timer=one<{status:string}>("SELECT status FROM workflow_timers WHERE work_item_id=? AND timer_type='review_deadline'","workflow-timer");
    assert.equal(timer?.status,"completed");
  } finally {
    scheduler.stop();
  }
});

test("unanswered clarification deadline moves the Request to the Decision Meeting",()=>{
  person("requestor");
  person("reviewer");
  person("chairman");
  person("u-workflow");
  request("workflow-clarification-timeout");
  assert.equal(transitionWorkItem("workflow-clarification-timeout","requestor","submit_request","Initial package").ok,true);
  const clarification=createClarification("workflow-clarification-timeout","reviewer",{
    artifactId:null,
    question:"Confirm the operational support model.",
    responseDueAt:new Date(Date.now()+60_000).toISOString()
  });
  assert.equal(clarification.ok,true);
  const expired=new Date(Date.now()-1000).toISOString();
  run("UPDATE clarification_requests SET response_due_at=? WHERE id=?",expired,clarification.ok?clarification.id:"");
  run("UPDATE workflow_timers SET due_at=? WHERE work_item_id=? AND timer_type='clarification_deadline'",expired,"workflow-clarification-timeout");
  const scheduler=startWorkflowTimerService();
  try {
    assert.equal(status("workflow-clarification-timeout")?.status,"decision_meeting");
    const clarificationStatus=one<{status:string}>("SELECT status FROM clarification_requests WHERE id=?",clarification.ok?clarification.id:"");
    assert.equal(clarificationStatus?.status,"unanswered");
  } finally {
    scheduler.stop();
  }
});

test.after(()=>{
  db.close();
  rmSync(testDirectory,{recursive:true,force:true});
});
