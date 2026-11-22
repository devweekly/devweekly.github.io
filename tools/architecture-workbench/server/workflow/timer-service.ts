import { all, db, id, now, one, run } from "../db.js";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function startWorkflowTimerService() {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let running = false;

  async function armNextTimer() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const next=one<{due_at:string}>(
      "SELECT due_at FROM workflow_timers WHERE status='scheduled' ORDER BY due_at LIMIT 1"
    );
    if (!next) return;
    const delay=Math.max(0,Date.parse(next.due_at)-Date.now());
    timer=setTimeout(()=>{ void runDueTimers(); },Math.min(delay,MAX_TIMEOUT_MS));
    timer.unref?.();
  }

  function transitionByTimer(timerId:string) {
    const timestamp=now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const task=one<{id:string;work_item_id:string;cycle_id:string|null;clarification_id:string|null;timer_type:string;status:string}>(
        "SELECT id,work_item_id,cycle_id,clarification_id,timer_type,status FROM workflow_timers WHERE id=?",timerId
      );
      if (!task || task.status!=="processing") { db.exec("COMMIT"); return; }
      const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",task.work_item_id);
      let from:string|null=null;
      if (task.timer_type==="review_deadline" && item?.status==="discussion_review" && task.cycle_id) {
        const cycle=one<{status:string;submission_id:string|null}>("SELECT status,submission_id FROM review_cycles WHERE id=?",task.cycle_id);
        const current=one<{id:string|null}>("SELECT submission_id AS id FROM review_cycles WHERE work_item_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",task.work_item_id);
        if (cycle?.status==="active" && current?.id===cycle.submission_id) {
          from="discussion_review";
          run("UPDATE review_cycles SET status='closed' WHERE id=?",task.cycle_id);
          run("UPDATE workflow_timers SET status='cancelled',updated_at=? WHERE cycle_id=? AND id<>? AND status IN ('scheduled','processing')",timestamp,task.cycle_id,timerId);
          run("UPDATE work_items SET status='decision_meeting',updated_at=? WHERE id=?",timestamp,task.work_item_id);
        }
      } else if (task.timer_type==="clarification_deadline" && task.clarification_id && item?.status==="waiting_requestor") {
        const clarification=one<{status:string;cycle_id:string}>(
          "SELECT status,cycle_id FROM clarification_requests WHERE id=?",task.clarification_id
        );
        if (clarification?.status==="requested") {
          run("UPDATE clarification_requests SET status='unanswered' WHERE id=?",task.clarification_id);
          run("UPDATE review_cycles SET status='closed' WHERE id=?",clarification.cycle_id);
          run("UPDATE workflow_timers SET status='cancelled',updated_at=? WHERE cycle_id=? AND id<>? AND status IN ('scheduled','processing')",timestamp,clarification.cycle_id,timerId);
          from="waiting_requestor";
          run("UPDATE work_items SET status='decision_meeting',updated_at=? WHERE id=?",timestamp,task.work_item_id);
        }
      }
      const admin=one<{id:string}>("SELECT id FROM people WHERE is_admin=1 ORDER BY id LIMIT 1");
      if (from && admin) {
        run("INSERT INTO workflow_transitions(id,work_item_id,from_status,to_status,action,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
          id("wf"),task.work_item_id,from,"decision_meeting","timer_expired",task.timer_type==="review_deadline"?"Review deadline expired.":"Clarification response deadline expired.",admin.id,timestamp);
        run("INSERT INTO activity_events(id,work_item_id,actor_id,action,target_type,target_id,summary,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          id("evt"),task.work_item_id,admin.id,"workflow_timer_expired","work_item",task.work_item_id,"Deadline reached; Request moved to Decision Meeting",JSON.stringify({timerType:task.timer_type,clarificationId:task.clarification_id}),timestamp);
      }
      run("UPDATE workflow_timers SET status='completed',lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?",timestamp,timerId);
      db.exec("COMMIT");
    } catch(error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async function runDueTimers() {
    if (stopped || running) return;
    running=true;
    try {
      for (let count=0;count<100;count++) {
        const timestamp=now();
        db.exec("BEGIN IMMEDIATE");
        let claimed:string|undefined;
        try {
          const task=one<{id:string}>(
            "SELECT id FROM workflow_timers WHERE due_at<=? AND (status='scheduled' OR (status='processing' AND lease_until<=?)) ORDER BY due_at LIMIT 1",
            timestamp,timestamp
          );
          if (task) {
            run("UPDATE workflow_timers SET status='processing',lease_until=?,attempt_count=attempt_count+1,updated_at=? WHERE id=?",
              new Date(Date.now()+LEASE_MS).toISOString(),timestamp,task.id);
            claimed=task.id;
          }
          db.exec("COMMIT");
        } catch(error) { db.exec("ROLLBACK"); throw error; }
        if (!claimed) break;
        try {
          transitionByTimer(claimed);
        } catch(error) {
          const current=one<{attempt_count:number}>("SELECT attempt_count FROM workflow_timers WHERE id=?",claimed);
          const attempts=current?.attempt_count || MAX_ATTEMPTS;
          const nextStatus=attempts>=MAX_ATTEMPTS?"dead_letter":"scheduled";
          const retryAt=new Date(Date.now()+Math.min(60_000,1000*2**Math.max(0,attempts-1))).toISOString();
          run("UPDATE workflow_timers SET status=?,due_at=?,lease_until=NULL,last_error=?,updated_at=? WHERE id=?",
            nextStatus,retryAt,error instanceof Error?error.message:"Unknown timer processing error",now(),claimed);
        }
      }
    } finally {
      running=false;
      await armNextTimer();
    }
  }

  function wake() { void armNextTimer(); }
  function stop() {
    stopped=true;
    if (timer) clearTimeout(timer);
  }

  run("UPDATE workflow_timers SET status='scheduled',lease_until=NULL,updated_at=? WHERE status='processing'",now());
  void runDueTimers();
  return {wake,stop,runDueTimers};
}
