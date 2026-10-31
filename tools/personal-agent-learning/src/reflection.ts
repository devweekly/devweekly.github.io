import { CopilotClient } from '@github/copilot-sdk';
import {
  CopilotAgentRuntime,
} from '@saga/copilot-agent-runtime';
import {
  CodeBuddyAgentRuntime,
  resolveCodeBuddyStructuredOutput,
} from '@saga/codebuddy-agent-runtime';
import { AgentTraceRecorder, SqliteTraceStore } from '@saga/agent-tracing';
import { z } from 'zod';
import { loadConfig, type LearningConfig } from './config.js';
import { newId } from './security.js';
import { LearningStore } from './store.js';
import type { PreferenceCandidate, Provider } from './types.js';

const candidateSchema = z.object({
  candidates: z.array(z.object({
    dimension: z.string().min(2).max(120),
    direction: z.enum(['prefer', 'avoid', 'require', 'discourage']),
    statement: z.string().min(10).max(600),
    scope: z.object({
      agent: z.string().optional(),
      project: z.string().optional(),
      taskType: z.string().optional(),
      provider: z.enum(['copilot', 'codebuddy']).optional(),
    }).strict(),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().min(1)).min(1).max(20),
    counterEvidenceIds: z.array(z.string().min(1)).max(20).optional(),
    rationale: z.string().min(10).max(1000),
  }).strict()).max(12),
}).strict();

const candidateJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dimension: { type: 'string' },
          direction: { type: 'string', enum: ['prefer', 'avoid', 'require', 'discourage'] },
          statement: { type: 'string' },
          scope: {
            type: 'object',
            additionalProperties: false,
            properties: {
              agent: { type: 'string' },
              project: { type: 'string' },
              taskType: { type: 'string' },
              provider: { type: 'string', enum: ['copilot', 'codebuddy'] },
            },
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidenceIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
          counterEvidenceIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          rationale: { type: 'string' },
        },
        required: ['dimension', 'direction', 'statement', 'scope', 'confidence', 'evidenceIds', 'rationale'],
      },
    },
  },
  required: ['candidates'],
} as const;

export interface ReflectionOptions {
  provider?: Provider;
  days?: number;
  model?: string;
}

export interface ReflectionResult {
  reflectionRunId: string;
  provider: Provider;
  model: string;
  examinedLearningEvents: number;
  examinedTraceEvents: number;
  savedCandidates: number;
  candidateIds: string[];
  note: string;
}

const REFLECTOR_SYSTEM_PROMPT = [
  'You are a conservative personal-agent preference analyst.',
  'Analyze explicit user feedback and operational metadata to propose scoped preferences for the user\'s own local agents.',
  'Never infer approval from silence, lack of edits, task completion, or the absence of complaints.',
  'Do not store secrets, credentials, private prompts, model reasoning, tool argument values, or tool output contents.',
  'Operational trace metadata may explain what happened, but only learning event IDs from explicit feedback/outcome/delivery records may be cited as candidate evidence.',
  'A candidate should represent a stable, reusable behavior preference, not a one-off task instruction.',
  'Require evidence from multiple independent sessions for general preferences. Narrow scope to the project/task/agent if evidence is local.',
  'Call out contradictory evidence in counterEvidenceIds; do not average away a real preference change.',
  'Do not propose permissions, security boundaries, destructive-action policies, or deterministic engineering gates as preferences.',
  'Prefer no candidate over a speculative one. Return an empty candidates array when evidence is insufficient.',
  'Return only the requested JSON object.',
].join('\n');

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86_400_000).toISOString();
}

function stringify(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value);
  return text.length > maxChars ? text.slice(0, maxChars) + '…[truncated]' : text;
}

async function readReflectionInput(config: LearningConfig, days: number) {
  const store = new LearningStore(config.learningDatabase);
  const trace = new AgentTraceRecorder(new SqliteTraceStore({ filename: config.traceDatabase }));
  try {
    const since = isoDaysAgo(days);
    const learningEvents = store.listEvents({ since, limit: config.maxLearningEvents });
    const traceEvents = await trace.query({ since, limit: config.maxTraceEvents });
    const allowedEvidenceIds = new Set(learningEvents
      .filter((event) => event.kind === 'feedback')
      .map((event) => event.id));
    return {
      learningEvents,
      traceEvents,
      allowedEvidenceIds,
      since,
    };
  } finally {
    store.close();
    await trace.close();
  }
}

function buildPrompt(input: Awaited<ReturnType<typeof readReflectionInput>>, days: number): string {
  const feedback = input.learningEvents.map((event) => ({
    id: event.id,
    timestamp: event.occurredAt,
    kind: event.kind,
    provider: event.provider,
    agentId: event.agentId,
    project: event.project,
    taskType: event.taskType,
    sessionId: event.sessionId,
    text: event.text,
    metadata: event.metadata,
    scope: event.scope,
  }));
  const traces = input.traceEvents.map((event) => ({
    id: event.id,
    timestamp: event.timestamp,
    provider: event.provider,
    agentId: event.agentId,
    model: event.model,
    sessionId: event.sessionId,
    turnId: event.turnId,
    category: event.category,
    type: event.type,
    status: event.status,
    durationMs: event.durationMs,
    usage: event.usage,
    data: event.data,
    metadata: event.metadata,
  }));
  return [
    `Review the previous ${days} days of local personal-agent activity.`,
    'Produce only justified, scoped, reusable behavior preferences.',
    'Evidence IDs may only come from explicit feedback events below. Do not cite trace event IDs.',
    'Trace metadata is context for diagnosing repeated friction, not evidence that a user liked an outcome.',
    'Candidate confidence is a calibrated qualitative estimate, not a measured probability.',
    'Do not propose candidates for one-off task requirements unless the scope explicitly limits them to that project/task.',
    '',
    'EXPLICIT LEARNING EVENTS:',
    stringify(feedback, 32_000),
    '',
    'OPERATIONAL TRACE METADATA:',
    stringify(traces, 48_000),
    '',
    'Return JSON matching this shape: {"candidates":[{"dimension":"interaction.clarification","direction":"avoid","statement":"...","scope":{"agent":"coding-agent","taskType":"code_change"},"confidence":0.82,"evidenceIds":["learn_..."],"counterEvidenceIds":[],"rationale":"..."}]}',
  ].join('\n');
}

async function runCodeBuddyReflector(
  config: LearningConfig,
  prompt: string,
  model: string,
): Promise<unknown> {
  const runtime = new CodeBuddyAgentRuntime();
  const result = await runtime.run({
    prompt,
    systemPrompt: REFLECTOR_SYSTEM_PROMPT,
    model,
    cwd: config.home,
    timeoutMs: 180_000,
    maxTurns: 3,
    thinking: { type: 'adaptive' },
    effort: 'medium',
    schema: candidateJsonSchema,
  });
  return resolveCodeBuddyStructuredOutput(result.structuredOutput, result.text);
}

async function runCopilotReflector(
  _config: LearningConfig,
  prompt: string,
  model: string,
): Promise<unknown> {
  const runtime = new CopilotAgentRuntime({
    createClient: () => new CopilotClient({ mode: 'empty' }),
  });
  try {
    const session = await runtime.createSession({
      model,
      streaming: true,
    });
    const turn = await runtime.runTurn({
      turnId: newId('reflect-turn'),
      lockKey: session.sessionId,
      session,
      prompt: REFLECTOR_SYSTEM_PROMPT + '\n\n' + prompt,
      timeoutMs: 180_000,
    });
    return JSON.parse(turn.content) as unknown;
  } finally {
    await runtime.stop();
  }
}

export async function runReflection(
  options: ReflectionOptions = {},
  config: LearningConfig = loadConfig(),
): Promise<ReflectionResult> {
  const provider = options.provider ?? config.reflectorProvider;
  const days = options.days ?? config.lookbackDays;
  const model = options.model || (provider === 'copilot' ? config.copilotModel : config.codeBuddyModel);
  if (!model.trim()) {
    throw new Error(provider === 'copilot'
      ? '没有配置 Copilot Reflector 模型。请设置 --model 或 config.json 中的 copilotModel。'
      : '没有配置 CodeBuddy Reflector 模型。请设置 --model 或 config.json 中的 codeBuddyModel。');
  }

  const input = await readReflectionInput(config, days);
  if (!input.learningEvents.some((event) => event.kind === 'feedback')) {
    return {
      reflectionRunId: newId('reflect'),
      provider,
      model,
      examinedLearningEvents: input.learningEvents.length,
      examinedTraceEvents: input.traceEvents.length,
      savedCandidates: 0,
      candidateIds: [],
      note: '最近没有显式反馈事件，本次不调用模型，也不会从日志沉默中推断偏好。',
    };
  }

  const prompt = buildPrompt(input, days);
  const raw = provider === 'copilot'
    ? await runCopilotReflector(config, prompt, model)
    : await runCodeBuddyReflector(config, prompt, model);
  const parsed = candidateSchema.parse(raw);
  const allowed = input.allowedEvidenceIds;
  const candidates: PreferenceCandidate[] = parsed.candidates.filter((candidate) => {
    const evidenceIds = [...candidate.evidenceIds, ...(candidate.counterEvidenceIds ?? [])];
    return candidate.evidenceIds.every((id) => allowed.has(id))
      && (candidate.counterEvidenceIds ?? []).every((id) => allowed.has(id))
      && evidenceIds.length <= 40;
  }).map((candidate) => ({
    dimension: candidate.dimension,
    direction: candidate.direction,
    statement: candidate.statement,
    scope: candidate.scope,
    confidence: candidate.confidence,
    evidenceIds: candidate.evidenceIds,
    ...(candidate.counterEvidenceIds ? { counterEvidenceIds: candidate.counterEvidenceIds } : {}),
    rationale: candidate.rationale,
  }));

  const store = new LearningStore(config.learningDatabase);
  const reflectionRunId = newId('reflect');
  try {
    const saved = store.saveCandidates(
      candidates,
      reflectionRunId,
      allowed,
      config.minDistinctSessions,
    );
    return {
      reflectionRunId,
      provider,
      model,
      examinedLearningEvents: input.learningEvents.length,
      examinedTraceEvents: input.traceEvents.length,
      savedCandidates: saved.length,
      candidateIds: saved.map((item) => item.id),
      note: saved.length
        ? '候选已进入本地审核队列，没有任何偏好被自动启用。'
        : '模型没有提出满足证据和范围要求的候选；这属于正常结果。',
    };
  } finally {
    store.close();
  }
}
