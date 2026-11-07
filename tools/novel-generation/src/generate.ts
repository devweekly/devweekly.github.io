// 唯一调用 @tencent-ai/agent-sdk 的模块：query() 封装 + runAgentText（模型链解析、超时、
// 中断重试与心跳都收在这里）。其他模块一律经 runAgentText 取模型文本，避免各处自建调用策略。
import { query } from "@tencent-ai/agent-sdk";
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
async function callOnce(
  prompt: string,
  model: string,
  fallbackModel: string | undefined,
  timeoutMs: number,
  profile?: TaskProfile
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
      applyAgentMessage(next.value, state);
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

export async function runAgentText(
  prompt: string, model?: string, timeoutMs = GENERATION_DEFAULT_TIMEOUT_MS, profile?: TaskProfile, allowFallback = true
): Promise<string> {
  const resolved = resolveAgentModel(model);
  const attempts = resolveModelAttempts(model, allowFallback);
  const failures: string[] = [];
  for (const candidate of attempts) {
    const fallback = attempts.find(item => item !== candidate);
    try {
      return await callOnce(prompt, candidate, fallback, timeoutMs, profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("TOOL_LEAK") && profile && profile.thinkingMode !== "disabled") {
        try {
          return await callOnce(prompt, candidate, fallback, timeoutMs, { ...profile, thinkingMode: "disabled", effort: "low" });
        } catch (retryError) {
          failures.push(`${candidate}（关闭思考重试）: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
          continue;
        }
      }
      failures.push(`${candidate}: ${message}`);
    }
  }
  throw new Error(`模型链均失败（${attempts.join(" → ")}，来源 ${resolved.source}）：${failures.join(" | ")}；用 npm run dev -- check-runtime 检查 CLI 登录与模型目录`);
}

export async function generateStory(input: GenerateStoryInput): Promise<string> {
  return runAgentText(buildPrompt(input), input.model);
}
