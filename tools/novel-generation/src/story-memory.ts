// Long-term narrative memory: retain reusable tacit patterns, never chapter facts or transient state.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, basename, relative } from "node:path";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { listStoryMemories, recordStoryMemoryCandidates, type StoryMemoryType } from "./database.js";
import { runAgentText } from "./generate.js";

const CandidateSchema = z.object({
  type: z.enum(["narrative", "creative", "operational"]),
  content: z.string().min(24).max(600),
  scope: z.string().max(120).optional(),
  evidence: z.string().min(12).max(500)
});
const OutputSchema = z.object({ memories: z.array(CandidateSchema).max(3) });

function memoryId(type: StoryMemoryType, content: string): string {
  const normalized = content.toLocaleLowerCase().replace(/\s+/gu, "").replace(/[，。！？；：、“”‘’]/gu, "");
  return createHash("sha256").update(type + ":" + normalized).digest("hex").slice(0, 24);
}

function terms(value: string): Set<string> {
  const compact = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const result = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) result.add(compact.slice(i, i + 2));
  return result;
}

/** Only repeated, evidence-backed experience is offered as optional inspiration. */
export function buildNarrativeMemoryContext(worldDir: string, worldId: string, query: string, maxChars = 1800): string {
  if (!query.trim()) return "";
  const queryTerms = terms(query);
  const selected = listStoryMemories(worldDir, worldId, "active")
    .map(memory => {
      const own = terms(memory.content);
      let score = 0;
      for (const term of queryTerms) if (own.has(term)) score++;
      return { memory, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.occurrences - a.memory.occurrences)
    .slice(0, 5)
    .map(({ memory }) => "- " + memory.content + "（适用范围：" + memory.scope + "；独立创作记录：" + memory.occurrences + " 次）");
  if (!selected.length) return "";
  const text = [
    "以下是从多次创作中提炼的经验，仅供当前创作参考，不是规则、要求或验收清单。可以忽略、改造或有意识地突破；不要为了体现这些经验而牺牲人物真实感、意外性或文学表达。",
    ...selected
  ].join("\n");
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

/** Dreaming over one completed run. Facts, summaries and transient character states are explicitly out of scope. */
export async function dreamOnCompletedRun(input: {
  worldId: string; worldDir: string; runDir: string; model?: string; timeoutMs?: number;
}): Promise<{ recorded: number; candidates: number }> {
  const chapterPath = resolve(input.runDir, "chapter.md");
  const chapter = await readFile(chapterPath, "utf8");
  const files = await readdir(input.runDir);
  const reviewFiles = files.filter(name => /review|reader|literary|revision/i.test(name) && /\.(md|txt|json)$/i.test(name)).slice(0, 5);
  const reviews = await Promise.all(reviewFiles.map(async name => {
    const value = await readFile(resolve(input.runDir, name), "utf8");
    return "\n\n## " + name + "\n" + value.slice(0, 5000);
  }));
  const evidenceSource = chapter.slice(0, 26000) + reviews.join("").slice(0, 10000);
  const runId = basename(resolve(input.runDir));
  const prompt = [
    "你是小说项目的离线记忆整理器（Dreaming），不是剧情总结器。",
    "从本次已完成章节及其审核/修改记录中，最多提炼 3 条未来创作仍有价值的隐性经验。",
    "严格区分：不要记章节发生了什么、人物当前状态/位置/关系、装备、时间线、具体事件、伏笔状态或剧情事实；这些属于易变 Canon，应由故事数据库和原文检索提供。",
    "只考虑可复用但不僵化的经验，例如人物在特定压力下呈现出的复杂行为倾向、人物互动产生张力的方式、有效的叙事处理、创意探索方向，或经审核证实的生成流程经验。",
    "不要把观察改写成必须遵守的写作规则，不要发明固定 Prompt、人物模板或风格配额。经验应允许反例、变化和主动突破。",
    "没有真正值得长期保留的经验时返回空数组。宁可不记，不要为了填满数量而总结。",
    "每条 evidence 必须是下方材料中的连续逐字片段，用来说明这条经验从何而来。不要输出正文摘要。",
    "只输出 JSON：{memories:[{type:'narrative'|'creative'|'operational',content:string,scope?:string,evidence:string}]}",
    "材料：\n" + evidenceSource
  ].join("\n\n");
  const raw = await runAgentText(prompt, input.model, input.timeoutMs ?? 120000, undefined, true, {
    attempts: [], context: { worldId: input.worldId, runId, kind: "memory-dreaming", stage: "consolidation" }
  });
  const parsed = OutputSchema.parse(JSON.parse(jsonrepair(raw)));
  const candidates = parsed.memories.flatMap(memory => {
    if (!evidenceSource.includes(memory.evidence)) return [];
    const type = memory.type as StoryMemoryType;
    return [{
      memoryId: memoryId(type, memory.content), memoryType: type, content: memory.content,
      scope: memory.scope ?? "world",
      evidence: { runId, quote: memory.evidence, source: relative(process.cwd(), chapterPath) }
    }];
  });
  const recorded = recordStoryMemoryCandidates(input.worldDir, input.worldId, candidates);
  return { recorded, candidates: candidates.length };
}
