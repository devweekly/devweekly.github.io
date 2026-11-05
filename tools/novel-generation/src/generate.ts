import { query } from "@tencent-ai/agent-sdk";

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

export async function runAgentText(prompt: string, model?: string): Promise<string> {
  const stream = query({
    prompt,
    options: {
      ...(model ? { model } : {}),
      permissionMode: "bypassPermissions",
      allowedTools: [],
      maxTurns: 1
    }
  });
  const chunks: string[] = [];
  for await (const message of stream) {
    if (message.type !== "assistant") continue;
    for (const block of message.message.content) {
      if (block.type === "text") chunks.push(block.text);
    }
  }
  const output = chunks.join("\n").trim();
  if (!output) throw new Error("CodeBuddy returned no text output.");
  return output;
}

export async function generateStory(input: GenerateStoryInput): Promise<string> {
  return runAgentText(buildPrompt(input), input.model);
}
