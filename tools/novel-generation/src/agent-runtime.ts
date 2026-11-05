// CodeBuddy Agent runtime：模型目录读取、偏好解析与 query() 选项。
// 做法参照 vocal-saga/local-agent-service 的 src/agents/modelCatalog.ts 与 workbuddy.ts。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export interface CatalogModel {
  id: string;
  credits: number | null;
}

/** 用户语义的偏好顺序：先 hy4 系列，再 deepseek-v4.1-flash。 */
export const MODEL_PREFERENCE = ["hy4", "deepseek-v4.1-flash"] as const;

/**
 * `hy4` 是系列别名，不是产品目录里的 id。目录里出现过 hy4free / hy4std / hy4-preview-*，
 * 先在目录内按此顺序找可用项，优先免费档；目录读不到时用已确认存在的 hy4free。
 */
export const HY4_MODEL_IDS = [
  "hy4", "hy4free", "hy4std", "hy4-preview-x", "hy4-preview-ctrl",
  "hy4-preview-exp", "hy4preview-exp1", "hy4preview-exp2"
] as const;

export const DEFAULT_MODEL_ID = "hy4free";

export function parseCredits(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = /^x?\s*(-?\d+(?:\.\d+)?)/i.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function modelsFromConfig(raw: unknown): CatalogModel[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { models?: unknown }).models;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown): CatalogModel[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as { id?: unknown; credits?: unknown };
    const id = typeof record.id === "string" ? record.id.trim() : "";
    return id ? [{ id, credits: parseCredits(record.credits) }] : [];
  });
}

/** 产品配置有两种落盘形态：明文 JSON，或 JSON 字符串 → base64 → gzip。 */
export function decodeProductConfig(text: string): CatalogModel[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return []; }
  const direct = modelsFromConfig(parsed);
  if (direct.length) return direct;
  if (typeof parsed !== "string") return [];
  try {
    return modelsFromConfig(JSON.parse(gunzipSync(Buffer.from(parsed, "base64")).toString("utf8")));
  } catch { return []; }
}

function readJsonModels(filePath: string): CatalogModel[] {
  try { return modelsFromConfig(JSON.parse(readFileSync(filePath, "utf8"))); }
  catch { return []; }
}

export interface CatalogOptions {
  localStorageDir?: string;
  userModelsPath?: string;
  projectRoot?: string;
}

/**
 * 读取 CodeBuddy 模型目录。优先 ACC_PRODUCT_CONFIG_PATH，其次按 mtime 扫描
 * ~/.codebuddy/local_storage/*.info；再套用用户级与项目级 models.json 覆盖。
 * 任何一步读不到都返回空表，不抛错，由调用方回退到默认模型。
 */
export function readModelCatalog(options: CatalogOptions = {}): CatalogModel[] {
  const configured = (process.env.ACC_PRODUCT_CONFIG_PATH ?? "").trim();
  const candidates: string[] = configured ? [configured] : [];
  if (!configured) {
    const dir = options.localStorageDir ?? join(homedir(), ".codebuddy", "local_storage");
    try {
      candidates.push(...readdirSync(dir)
        .filter(name => name.endsWith(".info"))
        .map(name => {
          const full = join(dir, name);
          try { return { full, mtime: statSync(full).mtimeMs }; }
          catch { return null; }
        })
        .filter((item): item is { full: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .map(item => item.full));
    } catch { /* 目录不存在 */ }
  }

  let base: CatalogModel[] = [];
  for (const file of candidates) {
    try {
      const models = decodeProductConfig(readFileSync(file, "utf8").trim());
      if (models.length) { base = models; break; }
    } catch { /* 不是产品配置，继续 */ }
  }

  const userModels = readJsonModels(options.userModelsPath ?? join(homedir(), ".codebuddy", "models.json"));
  const projectModels = options.projectRoot
    ? readJsonModels(join(options.projectRoot, ".codebuddy", "models.json"))
    : [];
  const merged = new Map<string, CatalogModel>();
  for (const model of [...base, ...userModels, ...projectModels]) {
    const previous = merged.get(model.id);
    merged.set(model.id, { id: model.id, credits: model.credits ?? previous?.credits ?? null });
  }
  return [...merged.values()];
}

/** 把用户写的 `hy4` 展开为目录里真实存在的模型 id。 */
export function expandModelAlias(requested: string, catalog: readonly CatalogModel[]): string[] {
  const ids = HY4_MODEL_IDS.filter(id => requested === "hy4" || id === requested);
  if (!ids.length) return [requested];
  const available = new Map(catalog.map(model => [model.id, model]));
  if (!available.size) {
    const fallback = ids.find(id => id !== "hy4") ?? DEFAULT_MODEL_ID;
    return [fallback];
  }
  const found = ids
    .map(id => available.get(id))
    .filter((model): model is CatalogModel => model !== undefined)
    .sort((a, b) => (a.credits ?? Number.POSITIVE_INFINITY) - (b.credits ?? Number.POSITIVE_INFINITY));
  return found.length ? found.map(model => model.id) : [];
}

export interface ResolvedModel {
  model: string;
  fallbacks: string[];
  source: string;
}

/**
 * 解析本次调用的模型链。显式 `--model` 或环境变量优先；`auto` 与空值视为未配置。
 * 返回的首选模型交给 query()，其余按偏好顺序作为失败时的重试链。
 */
export function resolveAgentModel(
  explicit?: string,
  catalog: readonly CatalogModel[] = readModelCatalog()
): ResolvedModel {
  const envModel = process.env.NOVEL_AGENT_MODEL ?? process.env.CODEBUDDY_DEFAULT_MODEL ?? "";
  const requested = (explicit ?? envModel).trim();
  // 每个偏好项只取目录里最合适的那一个，重试链控制在两级，避免逐个变体各等一次超时。
  const preferredIds = MODEL_PREFERENCE.map(preference => expandModelAlias(preference, catalog)[0]).filter(
    (id): id is string => Boolean(id)
  );
  if (requested && requested.toLowerCase() !== "auto") {
    const model = expandModelAlias(requested, catalog)[0] ?? requested;
    return {
      model,
      fallbacks: preferredIds.filter(id => id !== model),
      source: "explicit"
    };
  }

  const chain: string[] = [];
  for (const id of preferredIds) {
    if (!chain.includes(id)) chain.push(id);
  }
  if (!chain.length) chain.push(DEFAULT_MODEL_ID, "deepseek-v4.1-flash");
  const model = chain[0] ?? DEFAULT_MODEL_ID;
  return { model, fallbacks: chain.slice(1), source: catalog.length ? "catalog" : "default" };
}

/** 被 IDE / Agent 托管时，SDK fork 的 CLI 子进程常静默退出，调用前可用于提示。 */
export function isManagedSession(): boolean {
  return Boolean(process.env.CODEBUDDY_SESSION_ID || process.env.WORKBUDDY_CONFIG_DIR);
}

export interface QueryOptionsInput {
  cwd: string;
  abortController: AbortController;
  fallbackModel?: string;
}

/** 一次性文本调用的 SDK 选项：禁工具、单轮、关闭宿主配置与会话持久化。 */
export function buildQueryOptions(model: string, input: QueryOptionsInput) {
  return {
    ...(model ? { model } : {}),
    ...(input.fallbackModel ? { fallbackModel: input.fallbackModel } : {}),
    cwd: input.cwd,
    permissionMode: "default" as const,
    settingSources: [],
    persistSession: false,
    thinking: { type: "disabled" as const },
    effort: "low" as const,
    tools: [],
    allowedTools: [],
    maxTurns: 1,
    canUseTool: async (toolName: string) => ({
      behavior: "deny" as const,
      message: "文本分析调用不允许执行工具：" + toolName
    }),
    abortController: input.abortController
  };
}
