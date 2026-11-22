import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

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
  "CREATE TABLE IF NOT EXISTS review_cycles (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, name TEXT NOT NULL, baseline_json TEXT NOT NULL, status TEXT NOT NULL, due_date TEXT, created_by TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE, artifact_id TEXT NOT NULL REFERENCES artifacts(id), artifact_version INTEGER NOT NULL, reviewer_id TEXT NOT NULL REFERENCES people(id), discipline TEXT NOT NULL, outcome TEXT NOT NULL, summary TEXT NOT NULL, findings_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, assignee_id TEXT REFERENCES people(id), due_date TEXT, relates_to TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
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
  "CREATE INDEX IF NOT EXISTS idx_external_resource_refs_lookup ON external_resource_refs(provider, resource_type, external_key);",
  "CREATE INDEX IF NOT EXISTS idx_external_links_item ON work_item_external_links(work_item_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_external_links_resource ON work_item_external_links(resource_id);",
  "CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(work_item_id, created_at DESC);",
  "CREATE TABLE IF NOT EXISTS workflow_transitions (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, from_status TEXT NOT NULL, to_status TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', actor_id TEXT NOT NULL REFERENCES people(id), created_at TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_activity_item ON activity_events(work_item_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_debt_status ON debt_details(status, due_date);"
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
run("UPDATE work_items SET requestor_id=owner_id WHERE requestor_id IS NULL");
