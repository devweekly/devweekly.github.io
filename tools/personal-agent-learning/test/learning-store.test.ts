import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LearningStore } from '../src/store.js';
import type { PreferenceCandidate } from '../src/types.js';

function withStore(run: (store: LearningStore) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-learning-test-'));
  const store = new LearningStore(join(directory, 'learning.sqlite'));
  try { run(store); }
  finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('records explicit feedback with secrets redacted', () => {
  withStore((store) => {
    const event = store.record({
      kind: 'feedback',
      agentId: 'coding-agent',
      sessionId: 'session-a',
      text: '以后先跑测试。Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      metadata: { feedbackKind: 'preference' },
    });
    assert.equal(event.kind, 'feedback');
    assert.match(event.text ?? '', /先跑测试/);
    assert.doesNotMatch(event.text ?? '', /abcdefghijklmnopqrstuvwxyz012345/);
    const stored = store.listEvents({ kind: 'feedback' });
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.id, event.id);
  });
});

test('preference candidates require known evidence and independent session evidence', () => {
  withStore((store) => {
    const first = store.record({
      kind: 'feedback',
      agentId: 'coding-agent',
      sessionId: 'session-a',
      text: '修改代码之后，请先执行相关测试，再总结结果。',
      metadata: { feedbackKind: 'correction' },
    });
    const second = store.record({
      kind: 'feedback',
      agentId: 'coding-agent',
      sessionId: 'session-b',
      text: '这次也遗漏了测试。修改之后应该先验证。',
      metadata: { feedbackKind: 'correction' },
    });
    const candidate: PreferenceCandidate = {
      dimension: 'coding.verification',
      direction: 'require',
      statement: '完成代码修改后，应先运行相关测试并说明验证结果。',
      scope: { agent: 'coding-agent', taskType: 'code_change' },
      confidence: 0.84,
      evidenceIds: [first.id, second.id],
      rationale: '用户在两个独立 session 中明确纠正了同一问题。',
    };
    const saved = store.saveCandidates(
      [candidate],
      'reflect-test',
      new Set([first.id, second.id]),
      2,
    );
    assert.equal(saved.length, 1);
    assert.equal(store.listCandidates('pending').length, 1);

    const profile = store.reviewCandidate(saved[0]!.id, 'accept', '这是长期协作偏好。');
    assert.equal(profile.version, 1);
    assert.equal(profile.preferences.length, 1);
    assert.equal(profile.preferences[0]?.dimension, 'coding.verification');
    assert.equal(store.getCandidate(saved[0]!.id)?.status, 'accepted');
  });
});

test('candidate cannot cite unknown evidence and reject never changes profile', () => {
  withStore((store) => {
    const feedback = store.record({
      kind: 'feedback',
      agentId: 'research-agent',
      sessionId: 'session-a',
      text: '给我证据和来源。',
    });
    const candidate: PreferenceCandidate = {
      dimension: 'research.evidence',
      direction: 'require',
      statement: '研究结论应给出可检查的来源。',
      scope: { agent: 'research-agent' },
      confidence: 0.99,
      evidenceIds: [feedback.id, 'invented-event'],
      rationale: '测试无效 Evidence ID 必须被拒绝。',
    };
    const saved = store.saveCandidates([candidate], 'reflect-test', new Set([feedback.id]), 2);
    assert.equal(saved.length, 0);

    const acceptedCandidate = store.saveCandidates(
      [{ ...candidate, evidenceIds: [feedback.id] }],
      'reflect-test',
      new Set([feedback.id]),
      2,
    );
    assert.equal(acceptedCandidate.length, 1);
    const profile = store.reviewCandidate(acceptedCandidate[0]!.id, 'reject', '只是一次任务要求。');
    assert.equal(profile.version, 0);
    assert.equal(profile.preferences.length, 0);
    assert.equal(store.getCandidate(acceptedCandidate[0]!.id)?.status, 'rejected');
  });
});

test('accepted profile updates are versioned and scoped replacements keep history', () => {
  withStore((store) => {
    const makeCandidate = (statement: string, sessionId: string) => {
      const event = store.record({
        kind: 'feedback',
        agentId: 'writing-agent',
        sessionId,
        text: statement,
      });
      const candidate: PreferenceCandidate = {
        dimension: 'writing.detail',
        direction: 'prefer',
        statement,
        scope: { agent: 'writing-agent', taskType: 'writing' },
        confidence: 0.8,
        evidenceIds: [event.id],
        rationale: '单项审核测试。',
      };
      return store.saveCandidates([candidate], 'run-' + sessionId, new Set([event.id]), 1)[0]!;
    };

    const first = makeCandidate('说明要完整，但不要重复解释。', 'session-1');
    const second = makeCandidate('解释完整即可，不要重复展开。', 'session-2');
    const version1 = store.reviewCandidate(first.id, 'accept');
    const version2 = store.reviewCandidate(second.id, 'accept');
    assert.equal(version1.version, 1);
    assert.equal(version2.version, 2);
    assert.equal(version2.preferences.length, 1);
    assert.equal(version2.preferences[0]?.statement, '解释完整即可，不要重复展开。');
  });
});
