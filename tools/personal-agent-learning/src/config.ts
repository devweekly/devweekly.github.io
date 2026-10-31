import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface LearningConfig {
  version: 1;
  home: string;
  traceDatabase: string;
  learningDatabase: string;
  profileDirectory: string;
  reflectorProvider: 'copilot' | 'codebuddy';
  copilotModel: string;
  codeBuddyModel: string;
  lookbackDays: number;
  maxTraceEvents: number;
  maxLearningEvents: number;
  minDistinctSessions: number;
  maxFeedbackChars: number;
  capturePolicy: 'metadata-only' | 'feedback-text-only';
}

function defaultHome(): string {
  return resolve(process.env.PERSONAL_AGENT_LEARNING_HOME || join(homedir(), '.agent-learning'));
}

export function defaultConfig(): LearningConfig {
  const home = defaultHome();
  return {
    version: 1,
    home,
    traceDatabase: join(home, 'agent-traces.sqlite'),
    learningDatabase: join(home, 'learning.sqlite'),
    profileDirectory: join(home, 'profile'),
    reflectorProvider: 'codebuddy',
    copilotModel: process.env.COPILOT_MODEL || '',
    codeBuddyModel: process.env.CODEBUDDY_MODEL || '',
    lookbackDays: 7,
    maxTraceEvents: 800,
    maxLearningEvents: 300,
    minDistinctSessions: 2,
    maxFeedbackChars: 4000,
    capturePolicy: 'feedback-text-only',
  };
}

function validateConfig(value: unknown, defaults: LearningConfig): LearningConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const input = value as Partial<LearningConfig>;
  const provider = input.reflectorProvider === 'copilot' ? 'copilot' : 'codebuddy';
  const positiveInt = (candidate: unknown, fallback: number, max: number) =>
    typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0
      ? Math.min(candidate, max)
      : fallback;
  return {
    ...defaults,
    ...input,
    version: 1,
    home: defaults.home,
    traceDatabase: resolve(String(input.traceDatabase || defaults.traceDatabase)),
    learningDatabase: resolve(String(input.learningDatabase || defaults.learningDatabase)),
    profileDirectory: resolve(String(input.profileDirectory || defaults.profileDirectory)),
    reflectorProvider: provider,
    copilotModel: typeof input.copilotModel === 'string' ? input.copilotModel : defaults.copilotModel,
    codeBuddyModel: typeof input.codeBuddyModel === 'string' ? input.codeBuddyModel : defaults.codeBuddyModel,
    lookbackDays: positiveInt(input.lookbackDays, defaults.lookbackDays, 365),
    maxTraceEvents: positiveInt(input.maxTraceEvents, defaults.maxTraceEvents, 5000),
    maxLearningEvents: positiveInt(input.maxLearningEvents, defaults.maxLearningEvents, 2000),
    minDistinctSessions: positiveInt(input.minDistinctSessions, defaults.minDistinctSessions, 20),
    maxFeedbackChars: positiveInt(input.maxFeedbackChars, defaults.maxFeedbackChars, 20000),
    capturePolicy: input.capturePolicy === 'metadata-only' ? 'metadata-only' : 'feedback-text-only',
  };
}

export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Some filesystems do not support POSIX mode bits.
  }
}

export function initializeConfig(): LearningConfig {
  const config = defaultConfig();
  ensurePrivateDirectory(config.home);
  ensurePrivateDirectory(config.profileDirectory);
  const configPath = join(config.home, 'config.json');
  try {
    readFileSync(configPath, 'utf8');
    return loadConfig();
  } catch {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(configPath, 0o600); } catch { /* platform-dependent */ }
    return config;
  }
}

export function loadConfig(): LearningConfig {
  const defaults = defaultConfig();
  ensurePrivateDirectory(defaults.home);
  const configPath = join(defaults.home, 'config.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    return validateConfig(parsed, defaults);
  } catch {
    return defaults;
  }
}

export function ensureConfigDirectories(config: LearningConfig): void {
  ensurePrivateDirectory(config.home);
  ensurePrivateDirectory(dirname(config.traceDatabase));
  ensurePrivateDirectory(dirname(config.learningDatabase));
  ensurePrivateDirectory(config.profileDirectory);
}
