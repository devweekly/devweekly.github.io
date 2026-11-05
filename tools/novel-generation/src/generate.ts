import { query } from "@tencent-ai/agent-sdk";
import { buildQueryOptions, isManagedSession, resolveAgentModel } from "./agent-runtime.js";

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

async function callOnce(prompt: string, model: string, fallbackModel: string | undefined, timeoutMs: number): Promise<string> {
  const abortController = new AbortController();
  const stream = query({
    prompt,
    options: buildQueryOptions(model, { cwd: process.cwd(), abortController, fallbackModel })
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      void stream.interrupt().catch(() => {});
      reject(new Error(`超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const collect = async (): Promise<string> => {
    const chunks: string[] = [];
    for await (const message of stream) {
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) {
        if (block.type === "text") chunks.push(block.text);
      }
    }
    return chunks.join("\n").trim();
  };
  try {
    const output = await Promise.race([collect(), timeout]);
    if (!output) throw new Error("Agent 未返回文本");
    return output;
  } catch (error) {
    if (abortController.signal.aborted) throw new Error(`调用超时（${timeoutMs}ms），已中断`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 按偏好链依次调用模型；单个模型超时或无输出时换下一个。 */
export async function runAgentText(prompt: string, model?: string, timeoutMs = 120_000): Promise<string> {
  const resolved = resolveAgentModel(model);
  const attempts = [resolved.model, ...resolved.fallbacks];
  const failures: string[] = [];
  for (const candidate of attempts) {
    const fallback = attempts.find(item => item !== candidate);
    try {
      return await callOnce(prompt, candidate, fallback, timeoutMs);
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const hint = isManagedSession()
    ? "；当前进程被 IDE/Agent 托管，SDK 启动的 CLI 子进程可能无法正常拉起，请在普通终端重试"
    : "";
  throw new Error(`模型链均失败（${attempts.join(" → ")}，来源 ${resolved.source}）：${failures.join(" | ")}${hint}`);
}

export async function generateStory(input: GenerateStoryInput): Promise<string> {
  return runAgentText(buildPrompt(input), input.model);
}
