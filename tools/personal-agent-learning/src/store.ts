import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  newId,
  redactText,
} from './security.js';
import type {
  LearningEvent,
  LearningEventInput,
  PreferenceCandidate,
  PreferenceProfile,
  ProfilePreference,
  StoredCandidate,
} from './types.js';

export interface LearningEventQuery {
  since?: string;
  until?: string;
  limit?: number;
  kind?: LearningEvent['kind'];
  provider?: LearningEvent['provider'];
  agentId?: string;
  project?: string;
  sessionId?: string;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function parseEvent(row: Record<string, unknown>): LearningEvent {
  return {
    id: String(row.id),
    occurredAt: String(row.occurred_at),
    kind: String(row.kind) as LearningEvent['kind'],
    ...(typeof row.provider === 'string' ? { provider: row.provider as LearningEvent['provider'] } : {}),
    ...(typeof row.agent_id === 'string' ? { agentId: row.agent_id } : {}),
    ...(typeof row.project === 'string' ? { project: row.project } : {}),
    ...(typeof row.task_type === 'string' ? { taskType: row.task_type } : {}),
    ...(typeof row.session_id === 'string' ? { sessionId: row.session_id } : {}),
    ...(typeof row.turn_id === 'string' ? { turnId: row.turn_id } : {}),
    ...(typeof row.text === 'string' ? { text: row.text } : {}),
    metadata: parseJson(row.metadata_json, {}),
    scope: parseJson(row.scope_json, {}),
  };
}

function parseCandidate(row: Record<string, unknown>): StoredCandidate {
  const payload = parseJson<PreferenceCandidate>(row.payload_json, {
    dimension: 'unknown',
    direction: 'prefer',
    statement: 'Invalid stored candidate',
    scope: {},
    confidence: 0,
    evidenceIds: [],
    rationale: 'Stored candidate could not be parsed.',
  });
  return {
    ...payload,
    id: String(row.id),
    createdAt: String(row.created_at),
    status: String(row.status) as StoredCandidate['status'],
    reflectionRunId: String(row.reflection_run_id),
    ...(typeof row.review_note === 'string' ? { reviewNote: row.review_note } : {}),
  };
}

export class LearningStore {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    const absolute = resolve(filename);
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(absolute);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.createSchema();
    try { chmodSync(absolute, 0o600); } catch { /* POSIX file modes are not available on every filesystem. */ }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_events (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider TEXT,
        agent_id TEXT,
        project TEXT,
        task_type TEXT,
        session_id TEXT,
        turn_id TEXT,
        text TEXT,
        metadata_json TEXT NOT NULL,
        scope_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_learning_events_time ON learning_events(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_events_session ON learning_events(session_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_learning_events_agent ON learning_events(agent_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_learning_events_kind ON learning_events(kind, occurred_at);

      CREATE TABLE IF NOT EXISTS preference_candidates (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        reflection_run_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        review_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_status ON preference_candidates(status, created_at);

      CREATE TABLE IF NOT EXISTS profile_versions (
        version INTEGER PRIMARY KEY,
        updated_at TEXT NOT NULL,
        profile_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_history (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_review_candidate ON review_history(candidate_id, decided_at);
    `);
    const existing = this.db.prepare('SELECT profile_json FROM profile_versions ORDER BY version DESC LIMIT 1').get() as
      | { profile_json?: string }
      | undefined;
    if (!existing) {
      const initial: PreferenceProfile = { version: 0, updatedAt: new Date().toISOString(), preferences: [] };
      this.db.prepare('INSERT INTO profile_versions(version, updated_at, profile_json) VALUES(0, ?, ?)').run(
        initial.updatedAt,
        json(initial),
      );
    }
  }

  close(): void {
    this.db.close();
  }

  record(input: LearningEventInput, maxFeedbackChars = 4000): LearningEvent {
    const now = new Date().toISOString();
    const event: LearningEvent = {
      id: newId('learn'),
      occurredAt: now,
      kind: input.kind,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.project ? { project: input.project } : {}),
      ...(input.taskType ? { taskType: input.taskType } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(typeof input.text === 'string' && input.text.trim()
        ? { text: redactText(input.text.trim(), maxFeedbackChars) }
        : {}),
      metadata: input.metadata ?? {},
      scope: input.scope ?? {},
    };
    this.db.prepare(`
      INSERT INTO learning_events
      (id, occurred_at, kind, provider, agent_id, project, task_type, session_id, turn_id, text, metadata_json, scope_json)
      VALUES ($id, $occurred, $kind, $provider, $agent, $project, $task, $session, $turn, $text, $metadata, $scope)
    `).run({
      $id: event.id,
      $occurred: event.occurredAt,
      $kind: event.kind,
      $provider: event.provider ?? null,
      $agent: event.agentId ?? null,
      $project: event.project ?? null,
      $task: event.taskType ?? null,
      $session: event.sessionId ?? null,
      $turn: event.turnId ?? null,
      $text: event.text ?? null,
      $metadata: json(event.metadata),
      $scope: json(event.scope),
    });
    return event;
  }

  listEvents(query: LearningEventQuery = {}): LearningEvent[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (query.since) { clauses.push('occurred_at >= ?'); params.push(query.since); }
    if (query.until) { clauses.push('occurred_at <= ?'); params.push(query.until); }
    if (query.kind) { clauses.push('kind = ?'); params.push(query.kind); }
    if (query.provider) { clauses.push('provider = ?'); params.push(query.provider); }
    if (query.agentId) { clauses.push('agent_id = ?'); params.push(query.agentId); }
    if (query.project) { clauses.push('project = ?'); params.push(query.project); }
    if (query.sessionId) { clauses.push('session_id = ?'); params.push(query.sessionId); }
    const limit = Math.max(1, Math.min(2000, Math.floor(query.limit ?? 300)));
    params.push(limit);
    const rows = this.db.prepare(`
      SELECT * FROM learning_events
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
      ORDER BY occurred_at DESC LIMIT ?
    `).all(...params) as Array<Record<string, unknown>>;
    return rows.reverse().map(parseEvent);
  }

  saveCandidates(
    candidates: readonly PreferenceCandidate[],
    reflectionRunId: string,
    allowedEvidenceIds: ReadonlySet<string>,
    minDistinctSessions = 2,
  ): StoredCandidate[] {
    const output: StoredCandidate[] = [];
    const timestamp = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const candidate of candidates) {
        const confidence = Math.max(0, Math.min(1, candidate.confidence));
        const uniqueEvidence = [...new Set(candidate.evidenceIds)];
        if (!candidate.dimension.trim() || !candidate.statement.trim()) continue;
        if (uniqueEvidence.length === 0 || uniqueEvidence.some((id) => !allowedEvidenceIds.has(id))) continue;
        const evidenceRows = uniqueEvidence.map((id) =>
          this.db.prepare('SELECT session_id FROM learning_events WHERE id = ?').get(id) as
            | { session_id?: string | null }
            | undefined,
        );
        const distinctSessions = new Set(
          evidenceRows.map((row, index) => row?.session_id || 'trace:' + uniqueEvidence[index]),
        );
        if (distinctSessions.size < minDistinctSessions && confidence < 0.9) continue;

        const stored: StoredCandidate = {
          ...candidate,
          id: newId('candidate'),
          createdAt: timestamp,
          status: 'pending',
          reflectionRunId,
          evidenceIds: uniqueEvidence,
        };
        this.db.prepare(`
          INSERT INTO preference_candidates(id, created_at, status, reflection_run_id, payload_json)
          VALUES(?, ?, 'pending', ?, ?)
        `).run(stored.id, stored.createdAt, reflectionRunId, json(candidate));
        output.push(stored);
      }
      this.db.exec('COMMIT');
      return output;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listCandidates(status?: StoredCandidate['status']): StoredCandidate[] {
    const rows = (status
      ? this.db.prepare('SELECT * FROM preference_candidates WHERE status = ? ORDER BY created_at DESC').all(status)
      : this.db.prepare('SELECT * FROM preference_candidates ORDER BY created_at DESC').all()) as Array<Record<string, unknown>>;
    return rows.map(parseCandidate);
  }

  getCandidate(id: string): StoredCandidate | undefined {
    const row = this.db.prepare('SELECT * FROM preference_candidates WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? parseCandidate(row) : undefined;
  }

  getProfile(): PreferenceProfile {
    const row = this.db.prepare('SELECT profile_json FROM profile_versions ORDER BY version DESC LIMIT 1').get() as
      | { profile_json: string }
      | undefined;
    return row ? parseJson<PreferenceProfile>(row.profile_json, { version: 0, updatedAt: new Date().toISOString(), preferences: [] })
      : { version: 0, updatedAt: new Date().toISOString(), preferences: [] };
  }

  reviewCandidate(id: string, decision: 'accept' | 'reject', note = ''): PreferenceProfile {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT * FROM preference_candidates WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new Error('候选偏好不存在：' + id);
      if (row.status !== 'pending') throw new Error('该候选已经审核过，不能重复处理。');
      const candidate = parseCandidate(row);
      const decidedAt = new Date().toISOString();
      const normalizedNote = note.trim() ? redactText(note.trim(), 1000) : undefined;

      if (decision === 'reject') {
        this.db.prepare('UPDATE preference_candidates SET status = ?, review_note = ? WHERE id = ?')
          .run('rejected', normalizedNote ?? null, id);
        this.db.prepare('INSERT INTO review_history(id, candidate_id, decision, decided_at, note) VALUES(?, ?, ?, ?, ?)')
          .run(newId('review'), id, 'reject', decidedAt, normalizedNote ?? null);
        this.db.exec('COMMIT');
        return this.getProfile();
      }

      const current = this.getProfile();
      const sameScope = (left: Record<string, unknown>, right: Record<string, unknown>) =>
        JSON.stringify(Object.fromEntries(Object.entries(left).sort(([a], [b]) => a.localeCompare(b)))) ===
        JSON.stringify(Object.fromEntries(Object.entries(right).sort(([a], [b]) => a.localeCompare(b))));
      const retained = current.preferences.filter((item) =>
        !(item.dimension === candidate.dimension && sameScope(item.scope as Record<string, unknown>, candidate.scope as Record<string, unknown>)),
      );
      const preference: ProfilePreference = {
        id: newId('pref'),
        dimension: candidate.dimension,
        direction: candidate.direction,
        statement: candidate.statement,
        scope: candidate.scope,
        confidence: candidate.confidence,
        evidenceIds: candidate.evidenceIds,
        sourceCandidateId: candidate.id,
        acceptedAt: decidedAt,
      };
      const nextProfile: PreferenceProfile = {
        version: current.version + 1,
        updatedAt: decidedAt,
        preferences: [...retained, preference],
      };

      this.db.prepare('UPDATE preference_candidates SET status = ?, review_note = ? WHERE id = ?')
        .run('accepted', normalizedNote ?? null, id);
      this.db.prepare('INSERT INTO profile_versions(version, updated_at, profile_json) VALUES(?, ?, ?)')
        .run(nextProfile.version, nextProfile.updatedAt, json(nextProfile));
      this.db.prepare('INSERT INTO review_history(id, candidate_id, decision, decided_at, note) VALUES(?, ?, ?, ?, ?)')
        .run(newId('review'), id, 'accept', decidedAt, normalizedNote ?? null);
      this.db.exec('COMMIT');
      return nextProfile;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  counts(): { events: number; candidates: number; pending: number; profileVersion: number } {
    const events = this.db.prepare('SELECT COUNT(*) AS count FROM learning_events').get() as { count: number };
    const candidates = this.db.prepare('SELECT COUNT(*) AS count FROM preference_candidates').get() as { count: number };
    const pending = this.db.prepare("SELECT COUNT(*) AS count FROM preference_candidates WHERE status = 'pending'").get() as { count: number };
    return {
      events: Number(events.count),
      candidates: Number(candidates.count),
      pending: Number(pending.count),
      profileVersion: this.getProfile().version,
    };
  }
}
