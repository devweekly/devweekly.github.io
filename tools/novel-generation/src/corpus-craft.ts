import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildAnalysisUnits } from "./novel-kb.js";
import { runAgentText } from "./generate.js";

const ANALYSIS_VERSION = 1;
const ANALYSIS_PROMPT_VERSION = "corpus-craft-v1";
const MAX_CONTEXT_CHARS = 9_000;

type EvidenceItem = { evidence: string; [key: string]: unknown };
export interface CorpusCraftChapter {
  schemaVersion: 1;
  worldId: string;
  chapterId: string;
  ordinal: number;
  title: string;
  sourceHash: string;
  model: string;
  analyzedAt: string;
  scenes: Array<EvidenceItem & { summary?: string; characters?: string[]; location?: string; time?: string; pov?: string; goal?: string; conflict?: string; turn?: string; outcome?: string; emotionalShift?: string }>;
  dialogueExemplars: Array<EvidenceItem & { speaker?: string; addressee?: string; emotion?: string; relationship?: string; function?: string }>;
  voiceObservations: Array<EvidenceItem & { character?: string; observation?: string }>;
  causalLinks: Array<EvidenceItem & { cause?: string; effect?: string; relation?: string; confidence?: string }>;
  knowledgeStates: Array<EvidenceItem & { character?: string; knows?: string; sourceOfKnowledge?: string; certainty?: string }>;
  worldDetails: Array<EvidenceItem & { category?: string; detail?: string; context?: string }>;
  narrativeObservations: Array<EvidenceItem & { observation?: string; craftFunction?: string }>;
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function parseJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "").replace(/\s*\u0060\u0060\u0060$/, "");
  return JSON.parse(cleaned);
}
function asItems<T extends EvidenceItem>(value: unknown, source: string): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => Boolean(item && typeof item === "object" && typeof (item as EvidenceItem).evidence === "string" && source.includes((item as EvidenceItem).evidence as string)));
}
function validate(raw: unknown, unit: { chapterId: string; ordinal: number; title: string; text: string }, worldId: string, model: string): CorpusCraftChapter {
  if (!raw || typeof raw !== "object") throw new Error("Corpus craft response must be a JSON object.");
  const value = raw as Record<string, unknown>;
  const source = unit.text;
  return {
    schemaVersion: 1, worldId, chapterId: unit.chapterId, ordinal: unit.ordinal, title: unit.title,
    sourceHash: hash(source), model, analyzedAt: new Date().toISOString(),
    scenes: asItems(value.scenes, source),
    dialogueExemplars: asItems(value.dialogueExemplars, source),
    voiceObservations: asItems(value.voiceObservations, source),
    causalLinks: asItems(value.causalLinks, source),
    knowledgeStates: asItems(value.knowledgeStates, source),
    worldDetails: asItems(value.worldDetails, source),
    narrativeObservations: asItems(value.narrativeObservations, source)
  };
}
function promptFor(unit: { chapterId: string; title: string; text: string }): string {
  return [
    "你是小说续写项目的原文素材整理助手。目标是帮助后续写出更好的小说，不是写文学论文，也不是制定创作规则。",
    "请只分析本章原文，输出严格 JSON，不要 Markdown。字段：",
    "{scenes:[{summary,characters,location,time,pov,goal,conflict,turn,outcome,emotionalShift,evidence}],",
    "dialogueExemplars:[{speaker,addressee,emotion,relationship,function,evidence}],",
    "voiceObservations:[{character,observation,evidence}],",
    "causalLinks:[{cause,effect,relation,confidence,evidence}],",
    "knowledgeStates:[{character,knows,sourceOfKnowledge,certainty,evidence}],",
    "worldDetails:[{category,detail,context,evidence}],",
    "narrativeObservations:[{observation,craftFunction,evidence}]}",
    "要求：",
    "1. evidence 必须是本章原文中连续、逐字、可检索的短引文；没有直接证据的条目不要输出。每条只用一个最能支持结论的证据。",
    "2. 场景按叙事场景划分，不按固定字数切块；只记录真正有助于续写的场景，不必凑数量。",
    "3. 对白范例保留原文中的完整短句或连续对白，speaker 不确定就标“未知”，不得猜说话人。",
    "4. 人物声音观察描述可观察的表达习惯，不要把人物简化成性格标签；不同关系、情绪下的变化要保留。",
    "5. 因果关系必须区分“导致/促成/动机/条件/仅先后发生”；不能把时间先后误判为因果。confidence 用 high/medium/low。",
    "6. 知识状态只记录人物在本章当时确实知道的信息，并指出信息来源；不确定就标明。",
    "7. 世界细节可记录社会习俗、称谓、阶层、组织、交易、器物、民俗、仪式、超自然规则如何进入日常生活；不要补写原文没有的设定。",
    "8. 叙事观察可记录视角、节奏、信息揭示、悬念、留白、动作/对白/心理的叙事作用；绝不输出句长配额或要求续写模仿句式。",
    "9. 允许空数组。少而准，不能为覆盖字段编造内容。所有 evidence 必须能在原文中精确匹配。",
    "章节标识："+unit.chapterId+" / "+unit.title,
    "原文：\n"+unit.text
  ].join("\n\n");
}

export async function analyzeCorpusCraft(worldId: string, options: {
  worldDir?: string; model?: string; timeoutMs?: number; limit?: number;
  shard?: { index: number; count: number }; force?: boolean;
} = {}): Promise<{ total: number; generated: number; cached: number; failed: number; failures: string[] }> {
  const worldDir = options.worldDir ?? resolve("worlds", worldId);
  const { units } = await buildAnalysisUnits(worldId, { worldDir });
  const selected = units.filter(unit => !options.shard || unit.ordinal % options.shard.count === options.shard.index);
  const limited = options.limit ? selected.slice(0, options.limit) : selected;
  const outputDir = resolve("analysis", worldId, "corpus-craft", "chapters");
  await mkdir(outputDir, { recursive: true });
  let generated = 0, cached = 0, failed = 0;
  const failures: string[] = [];
  for (const unit of limited) {
    const path = join(outputDir, unit.chapterId + ".json");
    const sourceHash = hash(unit.text);
    if (!options.force) {
      try {
        const previous = JSON.parse(await readFile(path, "utf8")) as CorpusCraftChapter & { promptVersion?: string };
        if (previous.schemaVersion === 1 && previous.sourceHash === sourceHash && previous.worldId === worldId && previous.promptVersion === ANALYSIS_PROMPT_VERSION) { cached++; continue; }
      } catch { /* absent or invalid cache: regenerate */ }
    }
    try {
      const model = options.model ?? "configured-default";
      const prompt = promptFor(unit);
      let raw: string;
      try { raw = await runAgentText(prompt, options.model, options.timeoutMs); }
      catch (error) { throw error; }
      let parsed: unknown;
      try { parsed = parseJson(raw); }
      catch {
        raw = await runAgentText("只修复以下响应为符合要求的 JSON，不要增加分析内容：\n"+raw, options.model, options.timeoutMs);
        parsed = parseJson(raw);
      }
      const result = validate(parsed, unit, worldId, model);
      const stored = { ...result, promptVersion: ANALYSIS_PROMPT_VERSION };
      await writeFile(path, JSON.stringify(stored, null, 2)+"\n", "utf8");
      generated++;
    } catch (error) {
      failed++;
      failures.push(unit.chapterId+": "+(error instanceof Error ? error.message : String(error)));
    }
  }
  const manifest = {
    schemaVersion: ANALYSIS_VERSION, worldId, promptVersion: ANALYSIS_PROMPT_VERSION,
    updatedAt: new Date().toISOString(), processed: generated+cached, failed,
    totalSelected: limited.length, failures
  };
  await writeFile(resolve("analysis", worldId, "corpus-craft", "manifest.json"), JSON.stringify(manifest, null, 2)+"\n", "utf8");
  return { total: limited.length, generated, cached, failed, failures };
}

function terms(value: string): string[] {
  const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  return [...new Set(normalized.split(/\s+/).filter(token => token.length > 1).flatMap(token => token.length > 4 ? [token, ...Array.from({length:token.length-1},(_,i)=>token.slice(i,i+2))] : [token]))];
}
function scoreDocument(doc: CorpusCraftChapter, queryTerms: string[]): number {
  const text = JSON.stringify(doc).toLocaleLowerCase();
  return queryTerms.reduce((score, term) => score + (text.includes(term) ? (term.length > 2 ? 2 : 1) : 0), 0);
}
export async function buildCorpusCraftContext(worldId: string, query: string, options: { maxChars?: number; maxDocs?: number } = {}): Promise<string> {
  const dir = resolve("analysis", worldId, "corpus-craft", "chapters");
  let files: string[];
  try { files = (await readdir(dir)).filter(file => file.endsWith(".json")); }
  catch { return ""; }
  const queryTerms = terms(query);
  if (!queryTerms.length) return "";
  const ranked: Array<{ score: number; doc: CorpusCraftChapter }> = [];
  for (const file of files) {
    try {
      const doc = JSON.parse(await readFile(join(dir, file), "utf8")) as CorpusCraftChapter;
      if (doc.schemaVersion !== 1 || doc.worldId !== worldId) continue;
      const score = scoreDocument(doc, queryTerms);
      if (score > 0) ranked.push({ score, doc });
    } catch { /* ignore one corrupt chapter artifact */ }
  }
  ranked.sort((a,b)=>b.score-a.score || a.doc.ordinal-b.doc.ordinal);
  const maxChars = options.maxChars ?? MAX_CONTEXT_CHARS;
  const maxDocs = options.maxDocs ?? 8;
  const sections: string[] = [];
  let used = 0;
  for (const {score,doc} of ranked.slice(0,maxDocs)) {
    const selected = {
      chapter: doc.chapterId+" "+doc.title,
      scenes: doc.scenes.slice(0,5),
      dialogueExemplars: doc.dialogueExemplars.slice(0,4),
      voiceObservations: doc.voiceObservations.slice(0,5),
      causalLinks: doc.causalLinks.slice(0,5),
      knowledgeStates: doc.knowledgeStates.slice(0,5),
      worldDetails: doc.worldDetails.slice(0,4),
      narrativeObservations: doc.narrativeObservations.slice(0,3)
    };
    const block = "### "+selected.chapter+"（相关度 "+score+"）\n"+JSON.stringify(selected);
    if (used+block.length>maxChars) continue;
    sections.push(block); used+=block.length;
  }
  return sections.length ? [
    "以下是从原文离线整理、带逐字证据的续写素材。它们用于找回具体场景、人物说话方式、信息差、因果和世界细节，不是正史新增条款或剧情任务。",
    "可以采用、改造或舍弃；人物可以变化，情节可以偏离分析推测。不得为了兑现分析条目牺牲文学性。",
    ...sections
  ].join("\n\n") : "";
}
