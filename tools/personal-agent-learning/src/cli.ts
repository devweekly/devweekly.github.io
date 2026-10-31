import { AgentTraceRecorder, SqliteTraceStore } from '@saga/agent-tracing';
import { ensureConfigDirectories, initializeConfig, loadConfig } from './config.js';
import { compileProfile } from './profile-compiler.js';
import { runReflection } from './reflection.js';
import { LearningStore } from './store.js';
import type { FeedbackKind, OutcomeStatus, Provider } from './types.js';

type Arguments = { command: string; subcommand?: string; positionals: string[]; flags: Record<string, string | boolean> };

function parseArguments(values: string[]): Arguments {
  const [command = 'help', ...tail] = values;
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let subcommand: string | undefined;
  for (let index = 0; index < tail.length; index += 1) {
    const token = tail[index];
    if (!token) continue;
    if (!token.startsWith('--')) {
      if (!subcommand && (command === 'review')) subcommand = token;
      else positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = tail[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, ...(subcommand ? { subcommand } : {}), positionals, flags };
}

function getString(args: Arguments, key: string, fallback = ''): string {
  const value = args.flags[key];
  return typeof value === 'string' ? value : fallback;
}

function getNumber(args: Arguments, key: string, fallback: number): number {
  const value = Number(getString(args, key, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function providerValue(value: string): Provider | undefined {
  return value === 'copilot' || value === 'codebuddy' ? value : undefined;
}

function printHelp(): void {
  console.log(`Personal Agent Learning — local-first learning ledger

Commands:
  init
  feedback --kind correction|preference|pairwise_choice|accepted|rejected|edit|undo|clarification|friction --text "..."
           [--provider copilot|codebuddy] [--agent ID] [--project ID] [--task TYPE] [--session ID] [--turn ID]
  outcome --status delivered|accepted|reworked|rejected|abandoned|verified [--text "..."] [--provider ...] [--agent ...] [--session ...]
  reflect [--provider copilot|codebuddy] [--days 7] [--model MODEL]
  review list
  review accept CANDIDATE_ID [--note "..."]
  review reject CANDIDATE_ID [--note "..."]
  compile
  report [--days 7]

Environment:
  PERSONAL_AGENT_LEARNING_HOME  Default: ~/.agent-learning
`);
}

function requireFlag(args: Arguments, key: string): string {
  const value = getString(args, key);
  if (!value.trim()) throw new Error('缺少必填参数 --' + key);
  return value.trim();
}

async function run(args: Arguments): Promise<void> {
  if (args.command === 'help' || args.flags.help) {
    printHelp();
    return;
  }

  if (args.command === 'init') {
    const config = initializeConfig();
    ensureConfigDirectories(config);
    const store = new LearningStore(config.learningDatabase);
    store.close();
    const trace = new SqliteTraceStore({ filename: config.traceDatabase });
    await trace.close();
    console.log(JSON.stringify({
      home: config.home,
      traceDatabase: config.traceDatabase,
      learningDatabase: config.learningDatabase,
      profileDirectory: config.profileDirectory,
      initialized: true,
    }, null, 2));
    return;
  }

  const config = loadConfig();
  ensureConfigDirectories(config);

  if (args.command === 'feedback') {
    const kind = requireFlag(args, 'kind') as FeedbackKind;
    const valid: FeedbackKind[] = ['correction', 'preference', 'pairwise_choice', 'accepted', 'rejected', 'edit', 'undo', 'clarification', 'friction'];
    if (!valid.includes(kind)) throw new Error('不支持的反馈类型：' + kind);
    const store = new LearningStore(config.learningDatabase);
    try {
      const event = store.record({
        kind: 'feedback',
        ...(providerValue(getString(args, 'provider')) ? { provider: providerValue(getString(args, 'provider'))! } : {}),
        ...(getString(args, 'agent') ? { agentId: getString(args, 'agent') } : {}),
        ...(getString(args, 'project') ? { project: getString(args, 'project') } : {}),
        ...(getString(args, 'task') ? { taskType: getString(args, 'task') } : {}),
        ...(getString(args, 'session') ? { sessionId: getString(args, 'session') } : {}),
        ...(getString(args, 'turn') ? { turnId: getString(args, 'turn') } : {}),
        text: requireFlag(args, 'text'),
        metadata: { feedbackKind: kind, source: 'cli' },
        scope: {
          ...(getString(args, 'agent') ? { agent: getString(args, 'agent') } : {}),
          ...(getString(args, 'project') ? { project: getString(args, 'project') } : {}),
          ...(getString(args, 'task') ? { taskType: getString(args, 'task') } : {}),
        },
      }, config.maxFeedbackChars);
      console.log(JSON.stringify(event, null, 2));
    } finally {
      store.close();
    }
    return;
  }

  if (args.command === 'outcome') {
    const status = requireFlag(args, 'status') as OutcomeStatus;
    const valid: OutcomeStatus[] = ['delivered', 'accepted', 'reworked', 'rejected', 'abandoned', 'verified'];
    if (!valid.includes(status)) throw new Error('不支持的结果类型：' + status);
    const store = new LearningStore(config.learningDatabase);
    try {
      const event = store.record({
        kind: 'outcome',
        ...(providerValue(getString(args, 'provider')) ? { provider: providerValue(getString(args, 'provider'))! } : {}),
        ...(getString(args, 'agent') ? { agentId: getString(args, 'agent') } : {}),
        ...(getString(args, 'project') ? { project: getString(args, 'project') } : {}),
        ...(getString(args, 'task') ? { taskType: getString(args, 'task') } : {}),
        ...(getString(args, 'session') ? { sessionId: getString(args, 'session') } : {}),
        ...(getString(args, 'turn') ? { turnId: getString(args, 'turn') } : {}),
        ...(getString(args, 'text') ? { text: getString(args, 'text') } : {}),
        metadata: { status, source: 'cli' },
      }, config.maxFeedbackChars);
      console.log(JSON.stringify(event, null, 2));
    } finally {
      store.close();
    }
    return;
  }

  if (args.command === 'reflect') {
    const provider = providerValue(getString(args, 'provider')) ?? config.reflectorProvider;
    const result = await runReflection({
      provider,
      days: getNumber(args, 'days', config.lookbackDays),
      model: getString(args, 'model') || undefined,
    }, config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.command === 'review') {
    const store = new LearningStore(config.learningDatabase);
    try {
      if (args.subcommand === 'list') {
        const candidates = store.listCandidates('pending');
        if (!candidates.length) {
          console.log('当前没有待审核的偏好候选。');
          return;
        }
        for (const candidate of candidates) {
          console.log([
            candidate.id,
            `[${candidate.direction}] ${candidate.dimension}`,
            `confidence=${candidate.confidence.toFixed(2)}`,
            `evidence=${candidate.evidenceIds.length}`,
            `scope=${JSON.stringify(candidate.scope)}`,
            candidate.statement,
            `reason: ${candidate.rationale}`,
          ].join('\n'));
          console.log('');
        }
        return;
      }
      if (args.subcommand === 'accept' || args.subcommand === 'reject') {
        const resolvedId = args.positionals[0];
        if (!resolvedId?.trim()) {
          throw new Error('审核时请提供候选 ID，例如：review accept candidate_xxx');
        }
        const profile = store.reviewCandidate(
          resolvedId,
          args.subcommand,
          getString(args, 'note'),
        );
        console.log(JSON.stringify({
          decision: args.subcommand,
          candidateId: resolvedId,
          profileVersion: profile.version,
          preferenceCount: profile.preferences.length,
        }, null, 2));
        return;
      }
      throw new Error('用法：review list | review accept ID | review reject ID');
    } finally {
      store.close();
    }
  }

  if (args.command === 'compile') {
    const result = compileProfile(config);
    console.log(JSON.stringify({
      version: result.profile.version,
      preferenceCount: result.profile.preferences.length,
      jsonPath: result.jsonPath,
      markdownPath: result.markdownPath,
    }, null, 2));
    return;
  }

  if (args.command === 'report') {
    const store = new LearningStore(config.learningDatabase);
    const trace = new AgentTraceRecorder(new SqliteTraceStore({ filename: config.traceDatabase }));
    try {
      const since = new Date(Date.now() - getNumber(args, 'days', 7) * 86_400_000).toISOString();
      const events = store.listEvents({ since, limit: 2000 });
      const traces = await trace.query({ since, limit: 1000 });
      const counts = store.counts();
      const byKind = Object.fromEntries([...new Set(events.map((event) => event.kind))]
        .map((kind) => [kind, events.filter((event) => event.kind === kind).length]));
      const byProvider = Object.fromEntries([...new Set(traces.map((event) => event.provider ?? 'unknown'))]
        .map((provider) => [provider, traces.filter((event) => (event.provider ?? 'unknown') === provider).length]));
      console.log(JSON.stringify({
        since,
        learning: counts,
        recentLearningEvents: events.length,
        learningEventsByKind: byKind,
        recentTraceEvents: traces.length,
        traceEventsByProvider: byProvider,
      }, null, 2));
    } finally {
      store.close();
      await trace.close();
    }
    return;
  }

  throw new Error('未知命令：' + args.command);
}

const args = parseArguments(process.argv.slice(2));
run(args).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
