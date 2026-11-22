import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const dbPath = resolve(process.env.DATABASE_PATH || "./data/architecture-workbench.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec([
  "CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, title TEXT NOT NULL, email TEXT NOT NULL, avatar_color TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', expertise_json TEXT NOT NULL DEFAULT '[]', timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo', is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS work_items (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal', owner_id TEXT NOT NULL REFERENCES people(id), requestor_id TEXT REFERENCES people(id), target_date TEXT, context_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS participations (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id), role_key TEXT NOT NULL, role_label TEXT NOT NULL, permissions_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, UNIQUE(work_item_id, person_id, role_key));",
  "CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, type TEXT NOT NULL, code TEXT, title TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', submitted_by TEXT NOT NULL REFERENCES people(id), content_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(work_item_id, code, version));",
  "CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT 'review', manifest_json TEXT NOT NULL, context_version INTEGER, created_by TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL, UNIQUE(work_item_id,sequence));",
  "CREATE TABLE IF NOT EXISTS review_cycles (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, submission_id TEXT REFERENCES submissions(id), name TEXT NOT NULL, baseline_json TEXT NOT NULL, status TEXT NOT NULL, due_date TEXT, created_by TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE, artifact_id TEXT NOT NULL REFERENCES artifacts(id), artifact_version INTEGER NOT NULL, reviewer_id TEXT NOT NULL REFERENCES people(id), discipline TEXT NOT NULL, outcome TEXT NOT NULL, summary TEXT NOT NULL, findings_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, owner_id TEXT REFERENCES people(id), assignee_id TEXT REFERENCES people(id), due_date TEXT, relates_to TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, subject_type TEXT NOT NULL, subject_id TEXT, outcome TEXT NOT NULL, rationale TEXT NOT NULL, conditions TEXT NOT NULL DEFAULT '', decision_maker_id TEXT NOT NULL REFERENCES people(id), policy_ref TEXT NOT NULL DEFAULT 'default-v1', created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS work_item_relations (id TEXT PRIMARY KEY, source_work_item_id TEXT NOT NULL REFERENCES work_items(id), target_work_item_id TEXT NOT NULL REFERENCES work_items(id), relation_type TEXT NOT NULL, decision_id TEXT REFERENCES decisions(id), created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS debt_details (work_item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE, severity TEXT NOT NULL, priority TEXT NOT NULL, target_state TEXT NOT NULL, remediation_plan TEXT NOT NULL, status TEXT NOT NULL, source_decision_id TEXT REFERENCES decisions(id), due_date TEXT);",
  "CREATE TABLE IF NOT EXISTS external_resource_refs (id TEXT PRIMARY KEY, provider TEXT NOT NULL, resource_type TEXT NOT NULL, external_id TEXT NOT NULL, external_key TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider, resource_type, external_id));",
  "CREATE TABLE IF NOT EXISTS work_item_external_links (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, resource_id TEXT NOT NULL REFERENCES external_resource_refs(id) ON DELETE CASCADE, relation_type TEXT NOT NULL DEFAULT 'related_to', confluence_template_key TEXT, confluence_template_name TEXT, linked_by TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL, UNIQUE(work_item_id, resource_id, relation_type));",
  "CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, object_key TEXT NOT NULL, object_uri TEXT NOT NULL, original_name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, uploaded_by TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES people(id), body TEXT NOT NULL, created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS activity_events (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES people(id), action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, summary TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status, updated_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_artifacts_item ON artifacts(work_item_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_reviews_cycle ON reviews(cycle_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_submissions_item ON submissions(work_item_id, sequence DESC);",
  "CREATE INDEX IF NOT EXISTS idx_external_resource_refs_lookup ON external_resource_refs(provider, resource_type, external_key);",
  "CREATE INDEX IF NOT EXISTS idx_external_links_item ON work_item_external_links(work_item_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_external_links_resource ON work_item_external_links(resource_id);",
  "CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(work_item_id, created_at DESC);",
  "CREATE TABLE IF NOT EXISTS workflow_transitions (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, from_status TEXT NOT NULL, to_status TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', actor_id TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_activity_item ON activity_events(work_item_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_debt_status ON debt_details(status, due_date);",
  "CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, agent_key TEXT NOT NULL, skill_name TEXT NOT NULL, objective TEXT NOT NULL, requested_by TEXT NOT NULL REFERENCES people(id), claimed_by TEXT REFERENCES people(id), status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_for_human','completed','failed','cancelled')), handoff_reason TEXT NOT NULL DEFAULT '', result_artifact_id TEXT REFERENCES artifacts(id), error_message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, heartbeat_at TEXT, lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3);",
  "CREATE TABLE IF NOT EXISTS agent_run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, actor_type TEXT NOT NULL, actor_id TEXT REFERENCES people(id), event_type TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_agent_runs_item ON agent_runs(work_item_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_agent_runs_queue ON agent_runs(status, agent_key, created_at);",
  "CREATE TABLE IF NOT EXISTS agent_plans (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, name TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_for_human','completed','failed','cancelled')), created_by TEXT NOT NULL REFERENCES people(id), result_artifact_id TEXT REFERENCES artifacts(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_agent_plans_item ON agent_plans(work_item_id, created_at DESC);",
  "CREATE TABLE IF NOT EXISTS agent_run_dependencies (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, depends_on_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(run_id,depends_on_run_id), CHECK(run_id <> depends_on_run_id));",
  "CREATE INDEX IF NOT EXISTS idx_agent_run_dependencies_target ON agent_run_dependencies(depends_on_run_id);"
].join("\n"));
export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}
export function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}
export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...(params as never[]));
}
export function id(prefix: string) { return prefix + "_" + randomUUID().slice(0, 8); }
export function now() { return new Date().toISOString(); }


function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(" + table + ")").all() as {name:string}[];
  if (!columns.some(item => item.name === column)) {
    db.exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
  }
}

// Additive migrations keep existing local prototype databases usable.
ensureColumn("people","department","TEXT NOT NULL DEFAULT ''");
ensureColumn("people","location","TEXT NOT NULL DEFAULT ''");
ensureColumn("people","bio","TEXT NOT NULL DEFAULT ''");
ensureColumn("people","expertise_json","TEXT NOT NULL DEFAULT '[]'");
ensureColumn("people","timezone","TEXT NOT NULL DEFAULT 'Asia/Tokyo'");
ensureColumn("people","is_admin","INTEGER NOT NULL DEFAULT 0");
ensureColumn("work_items","requestor_id","TEXT REFERENCES people(id)");
ensureColumn("review_cycles","submission_id","TEXT REFERENCES submissions(id)");
ensureColumn("tasks","owner_id","TEXT REFERENCES people(id)");
ensureColumn("agent_runs","plan_id","TEXT REFERENCES agent_plans(id)");
ensureColumn("agent_runs","node_key","TEXT NOT NULL DEFAULT 'root'");
ensureColumn("agent_runs","claim_token","TEXT");
ensureColumn("agent_runs","heartbeat_at","TEXT");
ensureColumn("agent_runs","lease_expires_at","TEXT");
ensureColumn("agent_runs","attempt_count","INTEGER NOT NULL DEFAULT 0");
ensureColumn("agent_runs","max_attempts","INTEGER NOT NULL DEFAULT 3");
run("CREATE INDEX IF NOT EXISTS idx_agent_runs_lease ON agent_runs(status,lease_expires_at)");
run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
run("UPDATE tasks SET owner_id=COALESCE(assignee_id,(SELECT owner_id FROM work_items WHERE work_items.id=tasks.work_item_id)) WHERE owner_id IS NULL");

// Normalize stored Artifact fingerprints to a full SHA-256 digest.
for (const artifact of all<{id:string;content:string;content_hash:string}>("SELECT id,content,content_hash FROM artifacts WHERE length(content_hash)<>64 OR content_hash GLOB '*[^0-9a-f]*'")) {
  const digest=createHash("sha256").update(artifact.content).digest("hex");
  if (artifact.content_hash!==digest) run("UPDATE artifacts SET content_hash=? WHERE id=?",digest,artifact.id);
}

// Preserve existing review baselines as immutable legacy Submission records.
for (const cycle of all<{id:string;work_item_id:string;baseline_json:string;created_by:string;created_at:string}>(
  "SELECT id,work_item_id,baseline_json,created_by,created_at FROM review_cycles WHERE submission_id IS NULL ORDER BY created_at"
)) {
  const sequence=(one<{n:number}>("SELECT COALESCE(MAX(sequence),0) AS n FROM submissions WHERE work_item_id=?",cycle.work_item_id)?.n || 0)+1;
  const submissionId=id("sub");
  run("INSERT INTO submissions(id,work_item_id,sequence,purpose,manifest_json,context_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
    submissionId,cycle.work_item_id,sequence,"review",cycle.baseline_json,null,cycle.created_by,cycle.created_at);
  run("UPDATE review_cycles SET submission_id=? WHERE id=?",submissionId,cycle.id);
}

// Bring legacy and pre-SHA seed Submission manifests up to the current fingerprint format.
for (const submission of all<{id:string;manifest_json:string}>("SELECT id,manifest_json FROM submissions")) {
  let manifest:unknown;
  try { manifest=JSON.parse(submission.manifest_json); } catch { continue; }
  if (!Array.isArray(manifest)) continue;
  let changed=false;
  const normalized=manifest.map((entry:unknown)=>{
    if (!entry || typeof entry!=="object") return entry;
    const row=entry as {id?:string;version?:number;content_hash?:string;code?:string|null;type?:string;title?:string};
    if (!row.id || !row.version) return entry;
    if (row.content_hash && /^[0-9a-f]{64}$/.test(row.content_hash) &&
        "code" in row && "type" in row && "title" in row) return entry;
    const artifact=one<{code:string|null;type:string;title:string;content_hash:string}>(
      "SELECT code,type,title,content_hash FROM artifacts WHERE id=? AND version=?",row.id,row.version
    );
    if (!artifact) return entry;
    if (row.content_hash===artifact.content_hash && "code" in row && "type" in row && "title" in row) return entry;
    changed=true;
    return {...row,code:artifact.code,type:artifact.type,title:artifact.title,content_hash:artifact.content_hash};
  });
  if (changed) run("UPDATE submissions SET manifest_json=? WHERE id=?",JSON.stringify(normalized),submission.id);
}



// Request lifecycle and durable timer migrations (additive; existing records remain readable).
ensureColumn("work_items","chairman_id","TEXT REFERENCES people(id)");
ensureColumn("work_items","decision_outcome","TEXT");
ensureColumn("work_items","request_package_json","TEXT NOT NULL DEFAULT '{}'");
ensureColumn("submissions","submission_message","TEXT NOT NULL DEFAULT ''");
ensureColumn("submissions","package_json","TEXT NOT NULL DEFAULT '{}'");
ensureColumn("submissions","assisted_by_run_id","TEXT REFERENCES agent_runs(id)");
ensureColumn("submissions","source_submission_id","TEXT REFERENCES submissions(id)");
ensureColumn("submissions","submitted_by","TEXT REFERENCES people(id)");
ensureColumn("review_cycles","review_deadline_at","TEXT");
ensureColumn("review_cycles","remaining_review_ms","INTEGER");
ensureColumn("review_cycles","paused_at","TEXT");
ensureColumn("review_cycles","reviewer_snapshot_json","TEXT NOT NULL DEFAULT '[]'");
ensureColumn("decisions","meeting_id","TEXT");

db.exec(`
  CREATE TABLE IF NOT EXISTS clarification_requests (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    cycle_id TEXT NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
    submission_id TEXT REFERENCES submissions(id),
    requested_by TEXT NOT NULL REFERENCES people(id),
    artifact_id TEXT REFERENCES artifacts(id),
    question TEXT NOT NULL,
    response_due_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('requested','answered','unanswered','cancelled')),
    answer TEXT,
    answered_by TEXT REFERENCES people(id),
    answered_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_clarifications_item ON clarification_requests(work_item_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_clarifications_due ON clarification_requests(status,response_due_at);
  CREATE TABLE IF NOT EXISTS decision_meetings (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    cycle_id TEXT REFERENCES review_cycles(id),
    submission_id TEXT REFERENCES submissions(id),
    chairman_id TEXT NOT NULL REFERENCES people(id),
    meeting_at TEXT NOT NULL,
    minutes TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL CHECK(outcome IN ('approved','needs_work','rejected')),
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(cycle_id)
  );
  CREATE INDEX IF NOT EXISTS idx_decision_meetings_item ON decision_meetings(work_item_id,meeting_at DESC);
  CREATE TABLE IF NOT EXISTS workflow_timers (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    cycle_id TEXT REFERENCES review_cycles(id) ON DELETE CASCADE,
    submission_id TEXT REFERENCES submissions(id),
    clarification_id TEXT REFERENCES clarification_requests(id) ON DELETE CASCADE,
    timer_type TEXT NOT NULL CHECK(timer_type IN ('review_deadline','clarification_deadline')),
    due_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('scheduled','processing','completed','cancelled','dead_letter')),
    lease_until TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workflow_timers_due ON workflow_timers(status,due_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_timers_cycle ON workflow_timers(cycle_id,status);
`);

// Agent Package Draft was removed; discard only unsubmitted suggestions from older prototypes.
db.exec("DROP TABLE IF EXISTS request_package_drafts");

// Early versions made clarification targets Artifact-only. Rebuild the table so
// a reviewer can also ask a question about the Request Package itself.
const clarificationColumns=all<{name:string;notnull:number}>("PRAGMA table_info(clarification_requests)");
if (clarificationColumns.find(column=>column.name==="artifact_id")?.notnull===1) {
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE clarification_requests_new (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        cycle_id TEXT NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
        submission_id TEXT REFERENCES submissions(id),
        requested_by TEXT NOT NULL REFERENCES people(id),
        artifact_id TEXT REFERENCES artifacts(id),
        question TEXT NOT NULL,
        response_due_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('requested','answered','unanswered','cancelled')),
        answer TEXT,
        answered_by TEXT REFERENCES people(id),
        answered_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO clarification_requests_new
        (id,work_item_id,cycle_id,submission_id,requested_by,artifact_id,question,response_due_at,status,answer,answered_by,answered_at,created_at)
      SELECT id,work_item_id,cycle_id,submission_id,requested_by,artifact_id,question,response_due_at,status,answer,answered_by,answered_at,created_at
      FROM clarification_requests;
      DROP TABLE clarification_requests;
      ALTER TABLE clarification_requests_new RENAME TO clarification_requests;
      CREATE INDEX IF NOT EXISTS idx_clarifications_item ON clarification_requests(work_item_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_clarifications_due ON clarification_requests(status,response_due_at);
    `);
    db.exec("COMMIT");
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}


run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
run("UPDATE submissions SET submitted_by=created_by WHERE submitted_by IS NULL");

for (const cycle of all<{id:string;work_item_id:string;reviewer_snapshot_json:string}>(
  "SELECT id,work_item_id,reviewer_snapshot_json FROM review_cycles"
)) {
  if (!cycle.reviewer_snapshot_json || cycle.reviewer_snapshot_json==="[]") {
    const requestor=one<{requestor_id:string|null}>("SELECT requestor_id FROM work_items WHERE id=?",cycle.work_item_id);
    const candidates=all<{person_id:string;display_name:string;role_key:string;permissions_json:string}>(
      "SELECT p.person_id,people.display_name,p.role_key,p.permissions_json FROM participations p JOIN people ON people.id=p.person_id WHERE p.work_item_id=? AND p.person_id<>COALESCE(?, '') AND p.person_id<>(SELECT chairman_id FROM work_items WHERE id=?) AND p.role_key NOT IN ('chairman','decision_authority') ORDER BY people.display_name",
      cycle.work_item_id,requestor?.requestor_id || "",cycle.work_item_id
    );
    const reviewers=candidates
      .filter(person=>(JSON.parse(person.permissions_json) as string[]).includes("review"))
      .map(({person_id,display_name,role_key})=>({person_id,display_name,role_key}));
    run("UPDATE review_cycles SET reviewer_snapshot_json=? WHERE id=?",JSON.stringify(reviewers),cycle.id);
  }
}
run("UPDATE work_items SET chairman_id=NULL WHERE chairman_id=requestor_id");
for (const item of all<{id:string;requestor_id:string|null}>("SELECT id,requestor_id FROM work_items WHERE chairman_id IS NULL")) {
  const candidates=all<{person_id:string;role_key:string;permissions_json:string}>(
    "SELECT person_id,role_key,permissions_json FROM participations WHERE work_item_id=? AND person_id<>COALESCE(?, '') ORDER BY CASE role_key WHEN 'chairman' THEN 0 ELSE 1 END",
    item.id,item.requestor_id
  );
  const chairman=candidates.find(candidate=>
    ["chairman","decision_authority"].includes(candidate.role_key) &&
    (JSON.parse(candidate.permissions_json) as string[]).includes("decide")
  );
  if (chairman) run("UPDATE work_items SET chairman_id=? WHERE id=? AND chairman_id IS NULL",chairman.person_id,item.id);
}
const chairmanPermissions=JSON.stringify(["read","decide"]);
run("UPDATE participations SET role_key='chairman',role_label='Chairman',permissions_json=? WHERE role_key='decision_authority' AND EXISTS (SELECT 1 FROM work_items w WHERE w.id=participations.work_item_id AND w.chairman_id=participations.person_id)",chairmanPermissions);
run("UPDATE participations SET role_label='Chairman',permissions_json=? WHERE role_key='chairman' AND EXISTS (SELECT 1 FROM work_items w WHERE w.id=participations.work_item_id AND w.chairman_id=participations.person_id)",chairmanPermissions);

run("UPDATE work_items SET status='discussion_review' WHERE status='in_review'");
run("UPDATE work_items SET status='requestor_revision' WHERE status IN ('analysis','changes_requested')");
run("UPDATE work_items SET status='approved_pending_close',decision_outcome='approved' WHERE status='accepted'");
run("UPDATE work_items SET status='rejected_pending_close',decision_outcome='rejected' WHERE status='rejected'");

for (const cycle of all<{id:string;work_item_id:string;submission_id:string|null;status:string;due_date:string|null;review_deadline_at:string|null;created_at:string}>(
  "SELECT c.id,c.work_item_id,c.submission_id,c.status,c.due_date,c.review_deadline_at,c.created_at FROM review_cycles c"
)) {
  if (!cycle.review_deadline_at && cycle.status==="active") {
    const parsed=cycle.due_date ? Date.parse(cycle.due_date.length===10 ? cycle.due_date+"T23:59:59.000Z" : cycle.due_date) : Date.parse(cycle.created_at)+5*86400000;
    const deadline=new Date(Number.isFinite(parsed)?parsed:Date.now()).toISOString();
    run("UPDATE review_cycles SET review_deadline_at=? WHERE id=?",deadline,cycle.id);
  }
  const item=one<{status:string}>("SELECT status FROM work_items WHERE id=?",cycle.work_item_id);
  const deadline=one<{review_deadline_at:string|null}>("SELECT review_deadline_at FROM review_cycles WHERE id=?",cycle.id)?.review_deadline_at;
  if (cycle.status==="active" && item?.status==="discussion_review" && deadline &&
      !one("SELECT id FROM workflow_timers WHERE cycle_id=? AND timer_type='review_deadline' AND status IN ('scheduled','processing','completed')",cycle.id)) {
    const timestamp=now();
    run("INSERT INTO workflow_timers(id,work_item_id,cycle_id,submission_id,clarification_id,timer_type,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id("wt"),cycle.work_item_id,cycle.id,cycle.submission_id,null,"review_deadline",deadline,"scheduled",timestamp,timestamp);
  }
}
