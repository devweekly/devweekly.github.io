import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentTraceRecorder, SqliteTraceStore } from '@saga/agent-tracing';
import { defaultConfig } from '../src/config.js';
import { AgentObserver } from '../src/observer.js';

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(filename) : [filename];
  });
}

test('CodeBuddy metadata capture omits message and tool content and writes JSONL', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-observer-test-'));
  const config = {
    ...defaultConfig(),
    home: directory,
    traceDatabase: join(directory, 'agent-traces.sqlite'),
    eventDirectory: join(directory, 'events'),
    learningDatabase: join(directory, 'learning.sqlite'),
    profileDirectory: join(directory, 'profile'),
  };
  const observer = new AgentObserver(config);
  const context = observer.createContext({
    provider: 'codebuddy',
    agentId: 'coding-agent',
    project: 'repo-a',
    taskType: 'code_change',
    turnId: 'turn-test',
  });
  const handlers = observer.codeBuddyHandlers(context);
  handlers.onEvent({ type: 'system', session_id: 'session-test' });
  handlers.onEvent({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'SAMPLE_ASSISTANT_BODY' },
        { type: 'thinking', thinking: 'SAMPLE_REASONING_BODY' },
        { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/sample/source.ts', prompt: 'SAMPLE_TOOL_ARGUMENT' } },
        { type: 'tool_result', name: 'Read', content: 'SAMPLE_TOOL_RESULT_BODY' },
      ],
    },
  });
  handlers.onSessionId('session-test');
  handlers.onEvent({
    type: 'result',
    subtype: 'success',
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40 },
    total_cost_usd: 0,
    duration_ms: 250,
    num_turns: 1,
  });
  await observer.flush();
  await observer.close();

  const reader = new AgentTraceRecorder(new SqliteTraceStore({ filename: config.traceDatabase }));
  try {
    const events = await reader.query({ sessionIds: ['session-test'], limit: 100 });
    assert.ok(events.length >= 5);
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /SAMPLE_ASSISTANT_BODY|SAMPLE_REASONING_BODY|SAMPLE_TOOL_ARGUMENT|SAMPLE_TOOL_RESULT_BODY/);
    assert.match(serialized, /Read/);
    assert.match(serialized, /argumentKeys/);
    const resultEvent = events.find((event) => event.type === 'agent.result');
    assert.equal(resultEvent?.usage?.providerCost, 0);
    assert.equal(resultEvent?.usage?.providerCostUnit, 'USD');
  } finally {
    await reader.close();
  }

  try {
    const archives = listFiles(config.eventDirectory).filter((name) => name.endsWith('.jsonl'));
    assert.ok(archives.length > 0);
    const jsonl = archives.map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(jsonl, /SAMPLE_ASSISTANT_BODY|SAMPLE_TOOL_ARGUMENT|SAMPLE_TOOL_RESULT_BODY/);
    assert.ok(jsonl.split('\n').filter(Boolean).every((line) => JSON.parse(line)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Copilot reasoning and streamed message content are not captured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-observer-test-'));
  const config = {
    ...defaultConfig(),
    home: directory,
    traceDatabase: join(directory, 'agent-traces.sqlite'),
    eventDirectory: join(directory, 'events'),
    learningDatabase: join(directory, 'learning.sqlite'),
    profileDirectory: join(directory, 'profile'),
  };
  const observer = new AgentObserver(config);
  const context = observer.createContext({
    provider: 'copilot',
    agentId: 'research-agent',
    sessionId: 'copilot-session',
  });
  const handler = observer.copilotHandlers(context).onEvent;
  handler({ type: 'assistant.reasoning_delta', data: { deltaContent: 'SAMPLE_REASONING_BODY' } });
  handler({ type: 'assistant.message_delta', data: { deltaContent: 'SAMPLE_STREAM_BODY' } });
  handler({ type: 'assistant.message', data: { content: 'SAMPLE_FINAL_BODY' } });
  await observer.flush();
  await observer.close();

  const reader = new AgentTraceRecorder(new SqliteTraceStore({ filename: config.traceDatabase }));
  try {
    const events = await reader.query({ sessionIds: ['copilot-session'], limit: 20 });
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /SAMPLE_REASONING_BODY|SAMPLE_STREAM_BODY|SAMPLE_FINAL_BODY/);
    assert.match(serialized, /assistant.message.completed/);
  } finally {
    await reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
