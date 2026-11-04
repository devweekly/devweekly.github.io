import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderPreferenceInstructions,
  resolveApplicablePreferences,
} from '../src/profile-compiler.js';
import type { PreferenceProfile } from '../src/types.js';

const profile: PreferenceProfile = {
  version: 3,
  updatedAt: '2026-10-31T00:00:00.000Z',
  preferences: [
    {
      id: 'pref-global',
      dimension: 'interaction.response_structure',
      direction: 'prefer',
      statement: 'Give the concrete result first, then explain important trade-offs.',
      scope: { agent: 'coding-agent' },
      confidence: 0.91,
      evidenceIds: ['feedback-1', 'feedback-2'],
      sourceCandidateId: 'candidate-1',
      acceptedAt: '2026-10-30T00:00:00.000Z',
    },
    {
      id: 'pref-project',
      dimension: 'project.workflow',
      direction: 'require',
      statement: 'Run targeted tests after a code change.',
      scope: { agent: 'coding-agent', project: 'repo-a', taskType: 'code_change' },
      confidence: 0.95,
      evidenceIds: ['feedback-3', 'feedback-4'],
      sourceCandidateId: 'candidate-2',
      acceptedAt: '2026-10-30T00:00:00.000Z',
    },
  ],
};

test('compiled preference instructions use actual line breaks', () => {
  const applicable = resolveApplicablePreferences(profile, {
    agent: 'coding-agent',
    provider: 'copilot',
    project: 'repo-a',
    taskType: 'code_change',
  });
  const instructions = renderPreferenceInstructions(profile.version, applicable);
  assert.match(instructions, /Profile version: 3\n/);
  assert.match(instructions, /\n- \[PREFER\]/);
  assert.doesNotMatch(instructions, /\\n/);
});

test('profile resolver applies only matching scope and explicit overrides win', () => {
  const scoped = resolveApplicablePreferences(profile, {
    agent: 'coding-agent',
    provider: 'copilot',
    project: 'repo-b',
    taskType: 'code_change',
  });
  assert.deepEqual(scoped.map((item) => item.id), ['pref-global']);

  const overridden = resolveApplicablePreferences(profile, {
    agent: 'coding-agent',
    provider: 'copilot',
    project: 'repo-a',
    taskType: 'code_change',
  }, ['interaction.response_structure']);
  assert.deepEqual(overridden.map((item) => item.id), ['pref-project']);
});
