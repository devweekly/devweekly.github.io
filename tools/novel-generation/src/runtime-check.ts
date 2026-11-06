// CodeBuddy 执行链路自检。做法参照 vocal-saga/local-agent-service 的
// scripts/check-codebuddy-connectivity.mjs：配置 → 目录 → CLI → 真实调用 → 日志核对模型。
// 配置文件里写了什么不算证据，CLI 日志里实际发出的 model= 才是。
import { query } from "@tencent-ai/agent-sdk";
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";
import {
  buildQueryOptions, isManagedSession, readModelCatalog, resolveAgentModel,
  DEFAULT_CONFIG_PATH
} from "./agent-runtime.js";
import { applyAgentMessage, type AgentStreamState } from "./generate.js";
import { DEFAULT_PROBE_TIMEOUT_MS } from "./constants.js";

const PROMPT = "只回复两个字：连通。不要解释。";

export interface RuntimeCheckOptions {
  timeoutMs?: number;
  model?: string;
}

export interface RuntimeCheckResult {
  ok: boolean;
  lines: string[];
}

interface LogCursor {
  file: string;
  offset: number;
}

/** 取 cwd 对应的 CLI 日志，记录当前大小，调用后只读新增部分。 */
function markWorkspaceLog(): LogCursor {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const dir = join(homedir(), ".codebuddy", "logs", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  if (!existsSync(dir)) return { file: "", offset: 0 };
  // 日志文件名以 cwd 的目录名开头（本项目是 novel-generation__*.log），
  // 不写死 workspace__，否则换个工作目录就读不到模型请求记录。
  const files = readdirSync(dir)
    .filter(name => name.endsWith(".log"))
    .map(name => {
      const file = join(dir, name);
      try { return { file, name, mtime: statSync(file).mtimeMs }; }
      catch { return null; }
    })
    .filter((item): item is { file: string; name: string; mtime: number } => item !== null)
    .sort((a, b) => b.mtime - a.mtime);
  const prefix = basename(process.cwd()) + "__";
  const file = (files.find(item => item.name.startsWith(prefix)) ?? files[0])?.file ?? "";
  return { file, offset: file ? statSync(file).size : 0 };
}

function readLogDelta(cursor: LogCursor): string {
  if (!cursor.file || !existsSync(cursor.file)) return "";
  const size = statSync(cursor.file).size;
  if (size <= cursor.offset) return "";
  const length = size - cursor.offset;
  const fd = openSync(cursor.file, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, cursor.offset);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function readUsedModels(cursor: LogCursor): Array<{ model: string; count: number }> {
  const counts = new Map<string, number>();
  for (const line of readLogDelta(cursor).split("\n")) {
    if (!line.includes("Sending request")) continue;
    // agent=unknown 是 CLI 自己的轻量探测，不是本次任务发出的模型请求。
    const agent = /agent=([\w-]+)/.exec(line)?.[1];
    if (agent && agent !== "cli") continue;
    const match = /model=([\w.:-]+)/.exec(line);
    if (match) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
  }
  return [...counts].map(([model, count]) => ({ model, count }));
}

function findCli(): string | undefined {
  const configured = process.env.CODEBUDDY_CLI_PATH || process.env.WORKBUDDY_CLI_PATH || "";
  if (configured && existsSync(configured)) return configured;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(dir, "codebuddy");
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * 用与 runAgentText 相同的 query 选项发起一次最小调用，量 TTFT 与总耗时；
 * 再核对 CLI 日志里这一轮实际用的模型，避免 --model 没传到 CLI 却看着正常。
 */
export async function checkRuntime(options: RuntimeCheckOptions = {}): Promise<RuntimeCheckResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const lines: string[] = [];
  const failures: string[] = [];
  const catalog = readModelCatalog({ projectRoot: process.cwd() });
  const resolved = resolveAgentModel(options.model);

  lines.push(`1. 模型：${resolved.model}（来源 ${resolved.source}）；回退 ${resolved.fallbacks.join(" → ") || "无"}`);
  lines.push(`   配置：--model > NOVEL_AGENT_MODEL > CODEBUDDY_DEFAULT_MODEL > ${DEFAULT_CONFIG_PATH}`);

  const free = catalog.filter(model => model.credits === 0);
  const target = catalog.find(model => model.id === resolved.model);
  lines.push(`2. 目录：${catalog.length} 个模型，免费 ${free.length} 个`);
  if (!catalog.length) failures.push("模型目录为空");
  else if (!target) failures.push(`目录里没有 ${resolved.model}`);
  else if (target.credits !== 0) lines.push(`   ! ${target.id} credits=${target.credits}，该模型会计费`);

  lines.push(`3. CLI：${findCli() ?? "PATH 里未找到 codebuddy（SDK 可能自带 CLI）"}`);

  const cursor = markWorkspaceLog();
  const state: AgentStreamState = { text: "", messageCount: 0 };
  const startedAt = Date.now();
  const abortController = new AbortController();
  const stream = query({
    prompt: PROMPT,
    options: buildQueryOptions(resolved.model, { cwd: process.cwd(), abortController })
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout!: (error: Error) => void;
  const timeoutPromise = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  let iterator: AsyncIterator<unknown> | undefined;
  timer = setTimeout(() => {
    abortController.abort();
    try { void Promise.resolve(stream.interrupt?.()).catch(() => {}); } catch { /* 超时仍然生效 */ }
    rejectTimeout(new Error(`调用超时（${timeoutMs}ms）`));
  }, timeoutMs);
  timer.unref?.();

  try {
    iterator = stream[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), timeoutPromise]);
      if (next.done) break;
      applyAgentMessage(next.value, state);
    }
  } catch (error) {
    failures.push("调用失败：" + (error instanceof Error ? error.message : String(error)));
  } finally {
    if (timer) clearTimeout(timer);
    if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {});
  }

  const totalMs = Date.now() - startedAt;
  const ttft = state.firstTextAt ? state.firstTextAt - startedAt : null;
  lines.push(`4. 调用：${state.text ? JSON.stringify(state.text.slice(0, 40)) : "无文本"} · TTFT ${ttft === null ? "未收到" : ttft + "ms"} · 耗时 ${totalMs}ms · 事件 ${state.messageCount} 条`);
  if (!state.text.trim()) failures.push("调用没有返回 assistant 文本");
  if (totalMs > 30_000) lines.push("   ! 最小请求超过 30s，长文任务会明显更慢");

  const used = readUsedModels(cursor);
  lines.push(`5. CLI 日志实际请求模型：${used.length ? used.map(item => `${item.model} ×${item.count}`).join(", ") : "无新增记录"}`);
  if (used.length && !used.some(item => item.model === resolved.model)) {
    failures.push(`日志里没有 ${resolved.model}，模型参数可能没传到 CLI`);
  }
  lines.push(`6. 环境：${isManagedSession() ? "IDE/Agent 托管，子进程已隔离宿主会话与端口" : "普通终端"}`);
  lines.push(failures.length ? "结果：失败 · " + failures.join("；") : "结果：通过");
  return { ok: failures.length === 0, lines };
}
