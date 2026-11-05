// CodeBuddy Agent runtime：模型目录读取、模型选择与 query() 选项。
// 目录读取、auto 语义、显式配置优先与调用选项参照 vocal-saga/local-agent-service 的
// src/agents/modelCatalog.ts、src/agents/workbuddy.ts 与 scripts/check-codebuddy-connectivity.mjs。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

export interface CatalogModel {
  id: string;
  credits: number | null;
}

/** 默认模型。可用 --model、环境变量或 novel-generation.config.json 覆盖。 */
export const DEFAULT_MODEL_ID = "deepseek-v4.1-flash";

/** 失败重试链：默认模型之后退到免费的 hy4 档，每项只取一个。 */
export const MODEL_PREFERENCE = [DEFAULT_MODEL_ID, "hy4free"] as const;

/**
 * `hy4` 是系列别名，不是产品目录里的 id。目录里还有 hy4std / hy4-preview-*，
 * 这里只展开到已确认可用的免费档，避免挑到收费的预览模型。
 */
export const HY4_MODEL_IDS = ["hy4free"] as const;

/** 项目级配置文件的默认位置；NOVEL_AGENT_CONFIG 可指向别处。 */
export const DEFAULT_CONFIG_PATH = "novel-generation.config.json";

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
  let base: CatalogModel[] = [];
  const configured = (process.env.ACC_PRODUCT_CONFIG_PATH ?? "").trim();
  if (configured) {
    try { base = decodeProductConfig(readFileSync(configured, "utf8").trim()); }
    catch { /* 产品配置正在改写或不可读，回落到本地缓存 */ }
  }
  // env 指向的文件没解析出模型时仍要扫缓存；不设固定窗口，避免新写入的
  // 非产品配置缓存把真正的目录挤出候选集。
  if (!base.length) {
    const dir = options.localStorageDir ?? join(homedir(), ".codebuddy", "local_storage");
    let files: string[] = [];
    try {
      files = readdirSync(dir)
        .filter(name => name.endsWith(".info"))
        .map(name => {
          const full = join(dir, name);
          try { return { full, mtime: statSync(full).mtimeMs }; }
          catch { return null; }
        })
        .filter((item): item is { full: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .map(item => item.full);
    } catch { /* 目录不存在 */ }
    for (const file of files) {
      try {
        const models = decodeProductConfig(readFileSync(file, "utf8").trim());
        if (models.length) { base = models; break; }
      } catch { /* 不是产品配置，继续 */ }
    }
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

/** 把用户写的 `hy4` 别名展开为目录里真实存在的模型 id。 */
export function expandModelAlias(requested: string, catalog: readonly CatalogModel[]): string[] {
  const ids = HY4_MODEL_IDS.filter(id => requested === "hy4" || id === requested);
  if (!ids.length) return [requested];
  const available = new Map(catalog.map(model => [model.id, model]));
  if (!available.size) return [HY4_MODEL_IDS[0]];
  const found = ids
    .map(id => available.get(id))
    .filter((model): model is CatalogModel => model !== undefined)
    .sort((a, b) => (a.credits ?? Number.POSITIVE_INFINITY) - (b.credits ?? Number.POSITIVE_INFINITY));
  return found.length ? found.map(model => model.id) : [HY4_MODEL_IDS[0]];
}

export interface ResolvedModel {
  model: string;
  fallbacks: string[];
  source: "explicit" | "env" | "config" | "default";
}

/** `auto` 和空值都表示「没配置」，不能当成模型 id 传给 CLI。 */
function nonAuto(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed && trimmed.toLowerCase() !== "auto" ? trimmed : undefined;
}

/** 项目级配置只认 model 字段；文件缺失或格式不对时由默认模型兜底。 */
export function readConfiguredModel(configPath?: string): string | undefined {
  const path = configPath ?? ((process.env.NOVEL_AGENT_CONFIG ?? "").trim() || resolve(DEFAULT_CONFIG_PATH));
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { model?: unknown };
    return nonAuto(typeof parsed.model === "string" ? parsed.model : undefined);
  } catch { return undefined; }
}

/**
 * 模型优先级：--model > NOVEL_AGENT_MODEL > CODEBUDDY_DEFAULT_MODEL >
 * novel-generation.config.json > DEFAULT_MODEL_ID。`auto` 会继续往下一层找。
 * 返回首选模型与失败时的重试链，链按 MODEL_PREFERENCE 去重，不含主模型。
 */
export function resolveAgentModel(
  explicit?: string,
  catalog: readonly CatalogModel[] = readModelCatalog(),
  configPath?: string
): ResolvedModel {
  const fromExplicit = nonAuto(explicit);
  const fromEnv = nonAuto(process.env.NOVEL_AGENT_MODEL) ?? nonAuto(process.env.CODEBUDDY_DEFAULT_MODEL);
  const requested = fromExplicit ?? fromEnv;
  const configured = requested ? undefined : readConfiguredModel(configPath);
  const chosen = requested ?? configured;
  const source: ResolvedModel["source"] = fromExplicit ? "explicit" : fromEnv ? "env" : configured ? "config" : "default";

  const preferred = MODEL_PREFERENCE
    .map(id => expandModelAlias(id, catalog)[0])
    .filter((id): id is string => Boolean(id));
  const chain = [...new Set(preferred)];
  if (!chain.length) chain.push(DEFAULT_MODEL_ID);
  const model = chosen ? (expandModelAlias(chosen, catalog)[0] ?? chosen) : chain[0]!;
  return { model, fallbacks: chain.filter(id => id !== model), source };
}

/** 被 IDE / Agent 托管时，SDK 子进程会继承宿主服务端口，需要隔离会话环境。 */
export function isManagedSession(): boolean {
  return Boolean(process.env.CODEBUDDY_SESSION_ID || process.env.WORKBUDDY_CONFIG_DIR);
}

export interface QueryOptionsInput {
  cwd: string;
  abortController: AbortController;
  fallbackModel?: string;
}

/**
 * 托管会话里 SDK fork 的 CLI 会继承宿主的服务端口与会话变量，默认监听同一端口后
 * 报 EADDRINUSE 并卡住。子进程改用独立会话环境，端口交给 CLI 自选。
 */
const HOST_SESSION_ENV_KEYS = [
  "CODEBUDDY_SERVICE_PROXY_URL",
  "CODEBUDDY_HOST",
  "CODEBUDDY_SESSION_ID",
  "CODEBUDDY_CONVERSATION_REQUEST_ID",
  "CODEBUDDY_ROOT_REQUEST_ID",
  "WORKBUDDY_CONFIG_DIR",
  "ACC_PRODUCT_CONFIG_PATH"
] as const;

export function detachedCliOptions(): { env: Record<string, string | undefined>; extraArgs: Record<string, string> } {
  const env: Record<string, string | undefined> = {};
  for (const key of HOST_SESSION_ENV_KEYS) env[key] = undefined;
  return { env, extraArgs: { port: "0" } };
}

/**
 * 一次性文本调用的 SDK 选项：禁工具、单轮、关闭宿主配置与会话持久化。
 * 不传 requestTimeoutMs：本机 CLI 收到 --request-timeout-ms 会直接退出，
 * 超时由调用方在本地逐条消息竞速并 interrupt 控制。
 */
export function buildQueryOptions(model: string, input: QueryOptionsInput) {
  return {
    ...(model ? { model } : {}),
    ...(input.fallbackModel ? { fallbackModel: input.fallbackModel } : {}),
    cwd: input.cwd,
    ...(isManagedSession() ? detachedCliOptions() : {}),
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
