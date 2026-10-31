import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LearningConfig } from './config.js';
import { ensurePrivateDirectory } from './config.js';
import { LearningStore } from './store.js';
import type { PreferenceProfile, ProfilePreference } from './types.js';

function markdownEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('\\n', ' ')
    .replaceAll('\\r', ' ');
}

function scopeLabel(item: ProfilePreference): string {
  const entries = Object.entries(item.scope).filter(([, value]) => Boolean(value));
  return entries.length
    ? entries.map(([key, value]) => key + ': ' + String(value)).join(', ')
    : 'all agents / tasks';
}

function renderMarkdown(profile: PreferenceProfile): string {
  const lines = [
    '# Agent Preferences',
    '',
    'This file contains user-reviewed preferences compiled from the local Personal Agent Learning ledger.',
    'Apply a preference only when its scope matches the current agent, project, task type and provider.',
    'Current task instructions override these defaults. These preferences never change permissions or safety policy.',
    '',
    `Profile version: ${profile.version}`,
    `Updated: ${profile.updatedAt}`,
    '',
  ];
  if (!profile.preferences.length) {
    lines.push('No approved preferences yet.', '');
    return lines.join('\n');
  }
  const grouped = new Map<string, ProfilePreference[]>();
  for (const item of profile.preferences) {
    const key = item.scope.agent || 'All agents';
    const values = grouped.get(key) ?? [];
    values.push(item);
    grouped.set(key, values);
  }
  for (const [group, items] of grouped) {
    lines.push('## ' + markdownEscape(group), '');
    for (const item of items) {
      const direction = item.direction.toUpperCase();
      lines.push(`- **[${direction}] ${markdownEscape(item.dimension)}**: ${markdownEscape(item.statement)}`);
      lines.push(`  - Scope: ${markdownEscape(scopeLabel(item))}`);
      lines.push(`  - Confidence: ${item.confidence.toFixed(2)}; evidence: ${item.evidenceIds.length}; source: ${item.sourceCandidateId}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function atomicWrite(filename: string, content: string): void {
  const temporary = filename + '.tmp-' + process.pid;
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

export function compileProfile(config: LearningConfig): {
  profile: PreferenceProfile;
  jsonPath: string;
  markdownPath: string;
} {
  ensurePrivateDirectory(config.profileDirectory);
  mkdirSync(config.profileDirectory, { recursive: true, mode: 0o700 });
  const store = new LearningStore(config.learningDatabase);
  try {
    const profile = store.getProfile();
    const jsonPath = join(config.profileDirectory, 'profile.json');
    const markdownPath = join(config.profileDirectory, 'AGENT-PREFERENCES.md');
    atomicWrite(jsonPath, JSON.stringify(profile, null, 2) + '\n');
    atomicWrite(markdownPath, renderMarkdown(profile));
    return { profile, jsonPath, markdownPath };
  } finally {
    store.close();
  }
}
