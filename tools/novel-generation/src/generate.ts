// 唯一调用 @tencent-ai/agent-sdk 的模块：query() 封装 + runAgentText（模型链解析、超时、
// 中断重试与心跳都收在这里）。其他模块一律经 runAgentText 取模型文本，避免各处自建调用策略。
import { query } from "@tencent-ai/agent-sdk";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildQueryOptions, resolveAgentModel } from "./agent-runtime.js";
import { thinkingOption, type TaskProfile } from "./task-profiles.js";
import { GENERATION_DEFAULT_TIMEOUT_MS, HEARTBEAT_AFTER_MS, HEARTBEAT_INTERVAL_MS } from "./constants.js";

export type GenerationMode = "derivative" | "continuation";
export interface GenerateStoryInput {
  brief: string;
  mode: GenerationMode;
  worldId: string;
  worldBible: string;
  sourceText?: string;
  contextText?: string;
  model?: string;
  maxWords: number;
}

function buildPrompt(input: GenerateStoryInput): string {
  const modeInstruction = input.mode === "continuation"
    ? "续写模式：从用户提供且有权使用的材料最后一个有效情节节点继续，保持人物状态、因果关系和时间线。"
    : "原创衍生模式：创作发生在该世界观中的新故事。优先使用新人物、新地点或未展开的历史侧面；不得把原著未确认的内容伪装为正史。";

  return [
    "你是一名严谨的中文类型小说创作 Agent。请创作完整章节。",
    "创作模式：" + modeInstruction,
    "故事构想：" + input.brief,
    "目标篇幅：约 " + input.maxWords + " 个中文字符。以完整场景和情节推进为准，不要重复凑字数。",
    "世界设定资料如下。它是辅助索引，不代表完整原著；未知内容不得伪装成原著事实。",
    input.worldBible,
    input.sourceText ? "用户提供的续写依据：\n" + input.sourceText : "",
    input.contextText ? "前文与连续性摘要：\n" + input.contextText : "",
    "写作要求：",
    "- 以可读的原创叙事完成章节，重视人物动机、场景推进、因果关系和语言自然度。",
    "- 不复制原文段落、标志性句子或大段对白，不以近义词替换改写原文。",
    "- 不把未经核实的角色经历、世界规则、能力体系或时间线写成原著事实。",
    "- 角色行为必须有动机，冲突必须有代价；超凡能力必须有来源、条件和限制。",
    "- 以场景、行动、对话和选择推进故事，避免设定堆砌、套路化总结和机械排比。",
    "- 只输出小说正文，使用 Markdown 章节标题，不输出分析过程或创作说明。"
  ].filter(Boolean).join("\n\n");
}

/**
 * 思考开启时，CLI 会尝试调用工具；工具被禁后，部分模型把工具调用语法直接当正文吐出来。
 * 这类输出不是「文风偏差」，是整章作废，必须在调用层拦住。
 */
export function hasToolLeak(text: string): boolean {
  return /<｜｜DSML｜｜>|<\|?\|?DSML\|?\|?>|<[\w:]*function_calls>|<invoke\s+name=|antml:invoke/.test(text);
}

export interface AgentStreamState {
  text: string;
  messageCount: number;
  firstTextAt?: number;
}

/**
 * 消费单条 SDK 消息。除了 assistant 文本，还要检查 result 的 subtype：
 * CLI 执行失败时可能一条正文都不发，只看文本会把错误误报成「空输出」。
 */
export function applyAgentMessage(message: unknown, state: AgentStreamState): void {
  const raw = (message && typeof message === "object" ? message : {}) as Record<string, any>;
  state.messageCount += 1;
  if (raw.type === "assistant" && Array.isArray(raw.message?.content)) {
    for (const block of raw.message.content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        if (!state.firstTextAt) state.firstTextAt = Date.now();
        state.text += (state.text ? "\n" : "") + block.text;
      }
    }
  }
  if (raw.type === "result" && raw.subtype && raw.subtype !== "success") {
    const detail = Array.isArray(raw.errors) ? raw.errors.join("; ") : String(raw.error?.message ?? raw.error ?? raw.subtype);
    throw new Error(`Agent 执行失败（${raw.subtype}）：${detail}`);
  }
}

/**
 * 一次性调用：逐条消息与超时竞速，超时或异常时 interrupt CLI 并停止本地消费。
 * 只让 Promise.race 拒绝而不收尾，卡住的子进程会在后台继续烧额度。
 */
type AgentMessageObserver = (message: unknown, state: AgentStreamState, previousText: string) => Promise<void>;

async function callOnce(
  prompt: string,
  model: string,
  fallbackModel: string | undefined,
  timeoutMs: number,
  profile?: TaskProfile,
  observeMessage?: AgentMessageObserver
): Promise<string> {
  const abortController = new AbortController();
  const stream = query({
    prompt,
    options: buildQueryOptions(model, {
      cwd: process.cwd(),
      abortController,
      fallbackModel,
      ...(profile ? { thinking: thinkingOption(profile), effort: profile.effort } : {})
    })
  });
  const state: AgentStreamState = { text: "", messageCount: 0 };
  const startedAt = Date.now();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let iterator: AsyncIterator<unknown> | undefined;
  let rejectTimeout!: (error: Error) => void;
  const timeoutError = () => new Error(`调用超时（${timeoutMs}ms），已中断`);
  const timeoutPromise = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const interrupt = (): void => {
    abortController.abort();
    try { void Promise.resolve(stream.interrupt?.()).catch(() => {}); }
    catch { /* 中断失败也要由超时拒绝 */ }
  };

  timer = setTimeout(() => {
    timedOut = true;
    interrupt();
    rejectTimeout(timeoutError());
  }, timeoutMs);
  timer.unref?.();
  if (timeoutMs > HEARTBEAT_AFTER_MS) {
    heartbeat = setInterval(() => {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.error(`[agent] ${model} 已等待 ${seconds}s · 事件 ${state.messageCount} 条 · 已收文本 ${state.text.length} 字`);
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
  }

  try {
    iterator = stream[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), timeoutPromise]);
      if (next.done) break;
      const previousText = state.text;
      try { applyAgentMessage(next.value, state); }
      finally { await observeMessage?.(next.value, state, previousText); }
    }
    if (timedOut) throw timeoutError();
    const output = state.text.trim();
    if (!output) throw new Error("Agent 未返回文本");
    if (hasToolLeak(output)) throw new Error("TOOL_LEAK 输出含工具调用语法，正文无效");
    return output;
  } catch (error) {
    if (timedOut) throw timeoutError();
    interrupt();
    throw new Error(`Agent SDK 调用失败（${model}）：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {});
  }
}

/** 按模型链依次调用；输出泄漏时先关掉思考重试同一个模型，再换链中下一个。 */
export function resolveModelAttempts(model?: string, allowFallback = true): string[] {
  const resolved = resolveAgentModel(model);
  return allowFallback ? [resolved.model, ...resolved.fallbacks] : [resolved.model];
}

export interface AgentTextTrace {
  callId?: string;
  prompt?: string;
  rawResponse?: string;
  context?: { worldId?: string; runId?: string; outputDir?: string; kind?: string; stage?: string };
  attempts: Array<{ model: string; mode: "normal" | "thinking-disabled-retry"; startedAt: string; finishedAt?: string; durationMs?: number; status: "running" | "succeeded" | "failed"; error?: string }>;
}

async function atomicText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicText(path, JSON.stringify(value, null, 2) + "\n");
}

/**
 * Every SDK model call gets a durable local trace, regardless of which feature
 * invoked it. Feature-specific stage artifacts remain useful, but are not a
 * substitute for the exact prompt, raw response, attempt chain and failure data.
 */
export async function runAgentText(
  prompt: string, model?: string, timeoutMs = GENERATION_DEFAULT_TIMEOUT_MS, profile?: TaskProfile, allowFallback = true,
  trace?: AgentTextTrace
): Promise<string> {
  const callId = randomUUID();
  const callDir = resolve(".output", "agent-calls", callId);
  const startedAt = new Date().toISOString();
  if (trace) { trace.callId = callId; trace.prompt = prompt; }
  const resolved = resolveAgentModel(model);
  const attempts = resolveModelAttempts(model, allowFallback);
  const failures: string[] = [];
  const caller = new Error("Agent call origin").stack?.split("\n").slice(2, 9) ?? [];
  const record: Record<string, unknown> = {
    schemaVersion: 1, callId, status: "running", startedAt, updatedAt: startedAt,
    requestedModel: model ?? null, resolvedModel: resolved.model, modelSource: resolved.source,
    modelAttempts: attempts, timeoutMs, allowFallback,
    taskProfile: profile ?? null, context: trace?.context ?? null, caller, cwd: process.cwd(), pid: process.pid,
    nodeVersion: process.version, argv: process.argv.slice(0, 3)
  };
  await mkdir(callDir, { recursive: true });
  await atomicText(resolve(callDir, "prompt.txt"), prompt);
  await atomicJson(resolve(callDir, "run.json"), record);
  await atomicText(resolve(callDir, "model-trace.json"), JSON.stringify({ requestedModel: model ?? null, resolvedModel: resolved.model, modelSource: resolved.source, attempts: [] }, null, 2) + "\n");

  const persistTrace = async (status: "running" | "completed" | "failed", error?: string, result?: string) => {
    const updatedAt = new Date().toISOString();
    const completed = { ...record, status, updatedAt, ...(error ? { error } : {}), ...(result !== undefined ? { responseChars: result.length } : {}) };
    await atomicJson(resolve(callDir, "run.json"), completed);
    await atomicJson(resolve(callDir, "model-trace.json"), {
      requestedModel: model ?? null, resolvedModel: resolved.model, modelSource: resolved.source,
      timeoutMs, allowFallback, taskProfile: profile ?? null, attempts: trace?.attempts ?? attemptRecords
    });
    if (result !== undefined) await atomicText(resolve(callDir, "response.txt"), result);
    if (error) await atomicText(resolve(callDir, "failure.txt"), error);
  };
  const attemptRecords: AgentTextTrace["attempts"] = trace?.attempts ?? [];
  let attemptIndex = 0;
  try {
    for (const candidate of attempts) {
      const fallback = attempts.find(item => item !== candidate);
      const execute = async (mode: "normal" | "thinking-disabled-retry", attemptProfile?: TaskProfile): Promise<string> => {
        attemptIndex += 1;
        const attemptDir = resolve(callDir, "attempt-" + String(attemptIndex).padStart(2, "0"));
        await mkdir(attemptDir, { recursive: true });
        const attempt = {
          model: candidate, fallbackModel: fallback ?? null, mode, taskProfile: attemptProfile ?? null,
          startedAt: new Date().toISOString(), status: "running" as "running" | "succeeded" | "failed"
        };
        attemptRecords.push(attempt);
        await atomicJson(resolve(attemptDir, "attempt.json"), attempt);
        await atomicText(resolve(attemptDir, "partial-response.txt"), "");
        await atomicText(resolve(attemptDir, "events.jsonl"), "");
        let observedLength = 0;
        try {
          const output = await callOnce(prompt, candidate, fallback, timeoutMs, attemptProfile, async (message, state, previousText) => {
            const raw = (message && typeof message === "object" ? message : {}) as Record<string, any>;
            const delta = state.text.length > previousText.length ? state.text.slice(previousText.length) : "";
            const event = {
              at: new Date().toISOString(), type: typeof raw.type === "string" ? raw.type : "unknown",
              subtype: typeof raw.subtype === "string" ? raw.subtype : undefined,
              textDelta: delta || undefined,
              error: raw.type === "result" && raw.subtype !== "success" ? (raw.errors ?? raw.error ?? raw.subtype) : undefined,
              messageCount: state.messageCount
            };
            await appendFile(resolve(attemptDir, "events.jsonl"), JSON.stringify(event) + "\n", "utf8");
            if (delta) {
              await appendFile(resolve(attemptDir, "partial-response.txt"), delta, "utf8");
              observedLength = state.text.length;
            }
          });
          attempt.status = "succeeded";
          Object.assign(attempt, { finishedAt: new Date().toISOString(), durationMs: Date.parse(new Date().toISOString()) - Date.parse(attempt.startedAt) });
          if (trace) trace.rawResponse = output;
          await atomicText(resolve(attemptDir, "raw-response.txt"), output);
          await atomicJson(resolve(attemptDir, "attempt.json"), attempt);
          await atomicJson(resolve(callDir, "model-trace.json"), {
            requestedModel: model ?? null, resolvedModel: resolved.model, modelSource: resolved.source,
            timeoutMs, allowFallback, taskProfile: profile ?? null, attempts: attemptRecords
          });
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          attempt.status = "failed";
          Object.assign(attempt, { finishedAt: new Date().toISOString(), error: message });
          const partial = await readFile(resolve(attemptDir, "partial-response.txt"), "utf8").catch(() => "");
          await atomicText(resolve(attemptDir, "failure.txt"), message);
          await atomicJson(resolve(attemptDir, "attempt.json"), { ...attempt, partialResponseChars: partial.length, observedLength });
          await atomicJson(resolve(callDir, "model-trace.json"), {
            requestedModel: model ?? null, resolvedModel: resolved.model, modelSource: resolved.source,
            timeoutMs, allowFallback, taskProfile: profile ?? null, attempts: attemptRecords
          });
          throw error;
        }
      };
      let output: string | undefined;
      try {
        output = await execute("normal", profile);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${candidate}: ${message}`);
        if (message.includes("TOOL_LEAK") && profile && profile.thinkingMode !== "disabled") {
          try {
            output = await execute("thinking-disabled-retry", { ...profile, thinkingMode: "disabled", effort: "low" });
          } catch (retryError) {
            const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
            failures.push(`${candidate}（关闭思考重试）: ${retryMessage}`);
          }
        }
      }
      if (output !== undefined) {
        await persistTrace("completed", undefined, output);
        return output;
      }
      await persistTrace("running");
    }
    const error = `模型链均失败（${attempts.join(" → ")}，来源 ${resolved.source}）：${failures.join(" | ")}；用 npm run dev -- check-runtime 检查 CLI 登录与模型目录`;
    await persistTrace("failed", error);
    throw new Error(error);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((record.status as string) === "running") await persistTrace("failed", message).catch(persistError => {
      console.error("[agent-trace] 无法写入失败记录 " + callDir + ": " + String(persistError));
    });
    throw error;
  }
}

/**
 * Called once before a CLI/Workbench process begins accepting work. Any call
 * still marked running belongs to a process that died before finalization.
 */
export async function recoverInterruptedAgentCalls(): Promise<number> {
  const root = resolve(".output", "agent-calls");
  let entries: string[];
  try { entries = await readdir(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let recovered = 0;
  for (const entry of entries) {
    const dir = resolve(root, entry);
    try {
      const raw = JSON.parse(await readFile(resolve(dir, "run.json"), "utf8")) as Record<string, unknown>;
      if (raw.status !== "running") continue;
      const at = new Date().toISOString();
      const error = "进程在模型调用完成前退出；已在下次启动时标记为 interrupted。";
      await atomicJson(resolve(dir, "run.json"), { ...raw, status: "interrupted", updatedAt: at, error });
      await atomicText(resolve(dir, "failure.txt"), error);
      const attemptEntries = await readdir(dir, { withFileTypes: true });
      for (const attemptEntry of attemptEntries.filter(item => item.isDirectory() && /^attempt-\d+$/.test(item.name))) {
        const attemptPath = resolve(dir, attemptEntry.name, "attempt.json");
        try {
          const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as Record<string, unknown>;
          if (attempt.status === "running") await atomicJson(attemptPath, { ...attempt, status: "interrupted", finishedAt: at, error });
        } catch (attemptError) {
          if ((attemptError as NodeJS.ErrnoException).code !== "ENOENT") console.error("[agent-trace] 无法恢复尝试记录 " + attemptPath + ": " + String(attemptError));
        }
      }
      recovered += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      console.error("[agent-trace] 无法恢复调用记录 " + dir + ": " + String(error));
    }
  }
  return recovered;
}

export async function generateStory(input: GenerateStoryInput): Promise<string> {
  return runAgentText(buildPrompt(input), input.model);
}
