// Long-term narrative memory: retain reusable tacit patterns, never chapter facts or transient state.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, basename, relative } from "node:path";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { listStoryMemories, recordStoryMemoryCandidates, type StoryMemoryType, type StoryMemoryRow } from "./database.js";
import { runAgentText } from "./generate.js";

const CandidateSchema = z.object({
  type: z.enum(["narrative", "creative", "operational"]),
  content: z.string().min(24).max(600),
  scope: z.string().max(120).optional(),
  evidence: z.string().min(12).max(500)
});
const OutputSchema = z.object({ memories: z.array(CandidateSchema).max(3), creativeCompass: z.string().max(1200).optional() });

function memoryId(type: StoryMemoryType, content: string): string {
  const normalized = content.toLocaleLowerCase().replace(/\s+/gu, "").replace(/[，。！？；：、“”‘’]/gu, "");
  return createHash("sha256").update(type + ":" + normalized).digest("hex").slice(0, 24);
}

function terms(value: string): Set<string> {
  const compact = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const result = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) result.add(compact.slice(i, i + 2));
  if (compact.length === 1) result.add(compact);
  return result;
}

function similarity(left: string, right: string): number {
  const a = terms(left);
  const b = terms(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const term of a) if (b.has(term)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function matchingMemory(
  candidate: { memoryType: StoryMemoryType; content: string; scope: string },
  existing: StoryMemoryRow[]
): StoryMemoryRow | undefined {
  let best: { memory: StoryMemoryRow; score: number } | undefined;
  for (const memory of existing) {
    if (memory.memoryType !== candidate.memoryType) continue;
    const contentScore = similarity(candidate.content, memory.content);
    const scopeScore = similarity(candidate.scope, memory.scope);
    const score = contentScore * 0.88 + scopeScore * 0.12;
    if (score >= 0.72 && (!best || score > best.score)) best = { memory, score };
  }
  return best?.memory;
}
function excerpt(value: string, budget: number): string {
  if (value.length <= budget) return value;
  const head = Math.floor(budget * 0.42);
  const tail = Math.floor(budget * 0.42);
  const middle = budget - head - tail;
  const middleStart = Math.max(head, Math.floor((value.length - middle) / 2));
  return [
    value.slice(0, head),
    "\n[中段摘录，省略部分原文]\n",
    value.slice(middleStart, middleStart + middle),
    "\n[结尾摘录，省略部分原文]\n",
    value.slice(-tail)
  ].join("");
}

/** Add a few scene-intent cues so retrieval follows dramatic intent, not only literal word overlap. */
function sceneIntentHints(query: string): string[] {
  const hints: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/对白|交谈|谈判|质问|争执|对话|言语交锋/iu, "人物对白 对峙 谈判"],
    [/冲突|对抗|敌对|威胁|压迫|较量/iu, "人物冲突 利益 选择"],
    [/战斗|厮杀|追逐|逃亡|动作|搏斗/iu, "动作 战斗 危险"],
    [/情绪|悲伤|愤怒|恐惧|动摇|情感|关系变化/iu, "情绪转折 人物关系"],
    [/反转|揭露|真相|秘密|意外|惊讶/iu, "信息揭示 意外 创意"],
    [/转场|过渡|节奏|推进|承接/iu, "叙事节奏 场景转换"],
    [/环境|氛围|街道|城市|历史|风俗|社会|世界观/iu, "环境氛围 社会质感"],
    [/铺垫|悬念|伏笔|高潮|收束/iu, "叙事张力 情节结构"]
  ];
  for (const [pattern, hint] of patterns) if (pattern.test(query)) hints.push(hint);
  return hints;
}

/** Rank by normalized content overlap and scope relevance; avoid rewarding long memories. */
export function buildNarrativeMemoryContext(worldDir: string, worldId: string, query: string, maxChars = 1800): string {
  if (!query.trim()) return "";
  const intentHints = sceneIntentHints(query);
  const retrievalQuery = [query, ...intentHints].join("\n");
  const queryTerms = terms(retrievalQuery);
  if (!queryTerms.size) return "";
  const operationalQuery = /工具|流程|工作流|审核|修订|生成|agent|prompt|pipeline|workflow/iu.test(query);
  const selected = listStoryMemories(worldDir, worldId, "active")
    .map(memory => {
      const own = terms(memory.content);
      const scope = terms(memory.scope);
      let contentHits = 0;
      let scopeHits = 0;
      for (const term of queryTerms) {
        if (own.has(term)) contentHits++;
        if (scope.has(term)) scopeHits++;
      }
      const contentCoverage = contentHits / Math.max(1, own.size);
      const scopeCoverage = scopeHits / Math.max(1, scope.size);
      const typeBonus = operationalQuery && memory.memoryType === "operational" ? 0.12 : 0;
      return { memory, score: contentCoverage + scopeCoverage * 0.65 + typeBonus };
    })
    .filter(item => item.score >= 0.045)
    .sort((a, b) => b.score - a.score || b.memory.occurrences - a.memory.occurrences)
    .slice(0, 5)
    .map(({ memory }) => "- " + memory.content + "（适用范围：" + memory.scope + "；独立创作记录：" + memory.occurrences + " 次）");
  let compass = "";
  try { compass = readFileSync(resolve(worldDir, "story-memory", "creative-compass.md"), "utf8").trim(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!selected.length && !compass) return "";
  const parts = [
    "以下是从多次创作中提炼的经验，仅供当前创作参考，不是规则、要求或验收清单。可以忽略、改造或有意识地突破；不要为了体现这些经验而牺牲人物真实感、意外性或文学表达。"
  ];
  let remaining = Math.max(0, maxChars - parts[0]!.length);
  if (compass && remaining > 100) {
    const compassBudget = Math.min(700, Math.floor(remaining * 0.48));
    const compassPart = "## Creative Compass（派生创作方向，仅供启发）\n" + compass.slice(0, compassBudget);
    parts.push(compassPart);
    remaining -= compassPart.length + 2;
  }
  for (const item of selected) {
    const cost = item.length + 2;
    if (cost > remaining) continue;
    parts.push(item);
    remaining -= cost;
  }
  return parts.join("\n\n");
}

/** Dreaming over one completed run. Facts, summaries and transient character states are explicitly out of scope. */
export async function dreamOnCompletedRun(input: {
  worldId: string; worldDir: string; runDir: string; runDirs?: string[]; memoryRunId?: string; model?: string; timeoutMs?: number;
}): Promise<{ recorded: number; candidates: number; compassUpdated: boolean }> {
  const allRunDirs = [...new Set((input.runDirs?.length ? input.runDirs : [input.runDir]).map(dir => resolve(dir)))];
  // Keep a small arc sample (opening, middle and ending), rather than turning Dreaming
  // into a second transcript store or letting early chapters crowd out the ending.
  const runDirs = allRunDirs.length <= 5 ? allRunDirs : [...new Set([
    allRunDirs[0]!, allRunDirs[Math.floor((allRunDirs.length - 1) / 4)]!,
    allRunDirs[Math.floor((allRunDirs.length - 1) / 2)]!,
    allRunDirs[Math.floor(3 * (allRunDirs.length - 1) / 4)]!, allRunDirs.at(-1)!
  ])];
  const evidenceFiles: Array<{ source: string; content: string; promptContent: string }> = [];
  for (const runDir of runDirs) {
    const chapterPath = resolve(runDir, "chapter.md");
    try {
      const chapter = await readFile(chapterPath, "utf8");
      evidenceFiles.push({
        source: relative(process.cwd(), chapterPath),
        content: chapter,
        // Keep evidence verifiable against the full source while showing the model
        // representative opening, middle and ending passages from long chapters.
        promptContent: excerpt(chapter, 5000)
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const names = await readdir(runDir);
    const reviewFiles = names
      .filter(name => /review|reader|literary|revision/i.test(name) && /\.(md|txt|json)$/i.test(name))
      .sort((a, b) => {
        const rank = (name: string) => /review/i.test(name) ? 0 : /literary/i.test(name) ? 1 : /revision/i.test(name) ? 2 : 3;
        return rank(a) - rank(b) || a.localeCompare(b);
      })
      .slice(0, 1);
    for (const name of reviewFiles) {
      const path = resolve(runDir, name);
      const review = await readFile(path, "utf8");
      evidenceFiles.push({
        source: relative(process.cwd(), path),
        content: review,
        promptContent: excerpt(review, 1800)
      });
    }
  }
  if (!evidenceFiles.some(file => file.source.endsWith("/chapter.md"))) throw new Error("Completed run has no chapter.md evidence.");
  // Bound the prompt without cutting off the final chapter's evidence: each source is
  // excerpted first, and the complete source remains available for exact quote checks.
  const evidenceSource = evidenceFiles.map(file => "## " + file.source + "\n" + file.promptContent).join("\n\n");
  const boundedEvidenceSource = evidenceSource.length <= 36000 ? evidenceSource : evidenceFiles
    .map(file => "## " + file.source + "\n" + excerpt(file.promptContent, Math.max(900, Math.floor(33000 / evidenceFiles.length))))
    .join("\n\n")
    .slice(0, 36000);
  const runId = input.memoryRunId ?? basename(runDirs.at(-1)!);
  const existing = listStoryMemories(input.worldDir, input.worldId, "all");
  let previousCompass = "";
  try { previousCompass = readFileSync(resolve(input.worldDir, "story-memory", "creative-compass.md"), "utf8").trim(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const activeMemoryContext = [
    ...existing.filter(memory => memory.status === "active").slice(0, 12)
      .map(memory => "- [" + memory.memoryType + "] " + memory.content + "（范围：" + memory.scope + "）"),
    previousCompass ? "既有 Creative Compass（请在保留仍有价值内容的基础上修订，不要无故丢弃）：\\n" + previousCompass : ""
  ].filter(Boolean).join("\n");
  const prompt = [
    "你是小说项目的离线记忆整理器（Dreaming），不是剧情总结器。",
    "从本次已完成章节及其审核/修改记录中，最多提炼 3 条未来创作仍有价值的隐性经验。",
    "同时参考已有 active memories，做跨故事单元的经验综合：寻找不同故事中反复出现的文学表现、人物复杂性、叙事优势和创意潜力；也识别表面矛盾但可能体现人物变化或情境差异的经验。不要把差异平均成固定套路。",
    "额外生成 creativeCompass（最多 1200 字）：综合已有记忆与本次材料，概括值得延续的语言气质、人物塑造方式、叙事张力和创意探索方向。它是可修改、可忽略的启发性摘要，不是风格规则，不得规定必须使用的句式、节奏、桥段或人物行为。避免重复记忆，避免总结剧情事实。",
    "严格区分：不要记章节发生了什么、人物当前状态/位置/关系、装备、时间线、具体事件、伏笔状态或剧情事实；这些属于易变 Canon，应由故事数据库和原文检索提供。",
    "只考虑可复用但不僵化的经验，例如人物在特定压力下呈现出的复杂行为倾向、人物互动产生张力的方式、有效的叙事处理、创意探索方向，或经审核证实的生成流程经验。",
    "不要把观察改写成必须遵守的写作规则，不要发明固定 Prompt、人物模板或风格配额。经验应允许反例、变化和主动突破。",
    "没有真正值得长期保留的经验时返回空数组。宁可不记，不要为了填满数量而总结。",
    "每条 evidence 必须是下方材料中的连续逐字片段，用来说明这条经验从何而来。不要输出正文摘要。",
    "罕见但有文学价值的创意、独特人物互动或一次性叙事突破，即使只出现一次，也可以作为 creative candidate 提出；它会保持 candidate 状态，不要求直接晋级 active。不要为了重复次数而忽略独特的创作发现。",
    "已有 active memories（用于跨故事综合，不代表不可修改）：\n" + (activeMemoryContext || "暂无"),
    "只输出 JSON：{memories:[{type:'narrative'|'creative'|'operational',content:string,scope?:string,evidence:string}],creativeCompass?:string}",
    "材料：\n" + boundedEvidenceSource
  ].join("\n\n");
  const raw = await runAgentText(prompt, input.model, input.timeoutMs ?? 120000, undefined, true, {
    attempts: [], context: { worldId: input.worldId, runId, kind: "memory-dreaming", stage: "consolidation" }
  });
  const parsed = OutputSchema.parse(JSON.parse(jsonrepair(raw)));
  const candidates = parsed.memories.flatMap(memory => {
    const source = evidenceFiles.find(file => file.content.includes(memory.evidence))?.source;
    if (!source) return [];
    const type = memory.type as StoryMemoryType;
    const scope = memory.scope ?? "world";
    const match = matchingMemory({ memoryType: type, content: memory.content, scope }, existing);
    return [{
      memoryId: match?.memoryId ?? memoryId(type, memory.content),
      memoryType: type, content: memory.content, scope,
      evidence: { runId, quote: memory.evidence, source }
    }];
  });
  const recorded = recordStoryMemoryCandidates(input.worldDir, input.worldId, candidates);
  let compassUpdated = false;
  if (parsed.creativeCompass?.trim()) {
    const compassDir = resolve(input.worldDir, "story-memory");
    await mkdir(compassDir, { recursive: true });
    await writeFile(resolve(compassDir, "creative-compass.md"), parsed.creativeCompass.trim() + "\n", "utf8");
    compassUpdated = true;
  }
  return { recorded, candidates: candidates.length, compassUpdated };
}
