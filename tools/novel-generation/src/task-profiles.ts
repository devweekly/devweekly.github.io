// 按写作阶段分配思考模式与推理强度。做法参照 vocal-saga/local-agent-service 的
// src/agents/taskProfiles.ts：判断类任务多想，成文类任务快且不被推理痕迹带偏。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG_PATH } from "./agent-runtime.js";
import { DEFAULT_THINKING_BUDGET_TOKENS, MAX_THINKING_BUDGET_TOKENS, MIN_THINKING_BUDGET_TOKENS } from "./constants.js";

export type StageKey =
  | "plot" | "creative" | "plan" | "scene" | "dialogue"
  | "voice" | "antiAi" | "reader" | "styleDistill" | "review" | "final" | "state";

export type ThinkingMode = "disabled" | "adaptive" | "enabled";
export type Effort = "low" | "medium" | "high";

export interface TaskProfile {
  thinkingMode: ThinkingMode;
  thinkingBudgetTokens: number;
  effort: Effort;
}

/** 小说正文、对白和文风修订需要保留适度思考；不把写作阶段降成低推理的机械改写。 */
const DEFAULTS: Record<StageKey, TaskProfile> = {
  plot: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  creative: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  plan: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "high" },
  scene: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  dialogue: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  voice: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  antiAi: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  reader: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  styleDistill: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "high" },
  review: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  final: { thinkingMode: "adaptive", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "medium" },
  state: { thinkingMode: "disabled", thinkingBudgetTokens: DEFAULT_THINKING_BUDGET_TOKENS, effort: "low" }
};

export const STAGE_KEYS = Object.keys(DEFAULTS) as StageKey[];

const MODES = new Set<string>(["disabled", "adaptive", "enabled"]);
const EFFORTS = new Set<string>(["low", "medium", "high"]);

function clampBudget(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(MIN_THINKING_BUDGET_TOKENS, Math.min(MAX_THINKING_BUDGET_TOKENS, Math.round(parsed))) : fallback;
}

/** 把用户配置归一化到完整档案；未知阶段、非法枚举与 auto 都退回默认值。 */
export function normalizeTaskProfile(input: unknown, stage: StageKey): TaskProfile {
  const defaults = DEFAULTS[stage];
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const mode = typeof raw.thinkingMode === "string" && MODES.has(raw.thinkingMode)
    ? raw.thinkingMode as ThinkingMode
    : defaults.thinkingMode;
  const effort = typeof raw.effort === "string" && EFFORTS.has(raw.effort)
    ? raw.effort as Effort
    : defaults.effort;
  return {
    thinkingMode: mode,
    thinkingBudgetTokens: clampBudget(raw.thinkingBudgetTokens, defaults.thinkingBudgetTokens),
    effort
  };
}

/** 从项目配置读 taskProfiles 覆盖项；文件不存在或格式不对时用默认档案。 */
export function readTaskProfiles(configPath?: string): Record<StageKey, TaskProfile> {
  const path = configPath ?? ((process.env.NOVEL_AGENT_CONFIG ?? "").trim() || resolve(DEFAULT_CONFIG_PATH));
  let overrides: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { taskProfiles?: unknown };
    if (parsed.taskProfiles && typeof parsed.taskProfiles === "object" && !Array.isArray(parsed.taskProfiles)) {
      overrides = parsed.taskProfiles as Record<string, unknown>;
    }
  } catch { /* 缺配置时使用默认档案 */ }
  return Object.fromEntries(
    STAGE_KEYS.map(stage => [stage, normalizeTaskProfile(overrides[stage], stage)])
  ) as Record<StageKey, TaskProfile>;
}

/** 转成 SDK 的 thinking 选项；参考项目刻意不用已弃用的 maxThinkingTokens。 */
export function thinkingOption(profile: TaskProfile): { type: "disabled" } | { type: "adaptive" } | { type: "enabled"; budgetTokens: number } {
  if (profile.thinkingMode === "disabled") return { type: "disabled" };
  if (profile.thinkingMode === "enabled") return { type: "enabled", budgetTokens: profile.thinkingBudgetTokens };
  return { type: "adaptive" };
}
