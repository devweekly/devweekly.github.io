// 万字章节流水线：一次规划、逐场成文、分批审校与文风统一。
// 不复用 SDK session；场景之间靠落盘的原文结尾与事实清单显式交接，可逐场重跑。
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStoryStateUpdate, saveStoryState } from "./story-state.js";

import { runAgentText, resolveModelAttempts, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { RHYTHM_RULE, mergeStoryState } from "./workflow.js";
import { searchLibrary } from "./library.js";
import { formatReview, parseChapterReview, reviewAndRepair, reviewPrompt, withDeterministicIssues, type ReviewIssue } from "./chapter-review.js";
import { checkIronLaws, ironLawIssues, loadIronLaws } from "./iron-laws.js";
import { loadRunStoryState, runCachedStage } from "./stage-cache.js";
import { parseJsonObject } from "./model-json.js";
import {
  ACCUMULATED_CONTEXT_TAIL_CHARS,
  BATCH_REVIEW_MAX_ISSUES,
  LONG_CHAPTER_SOURCE_TAIL_CHARS,
  SCENE_SITUATION_BUDGET_CHARS,
  SCENE_WORD_BUDGET_BUFFER,
  WORLD_SITUATION_FIELD_DEFAULT_LIMIT,
  WRITE_LONG_RETRIEVAL_LIMIT
} from "./constants.js";
import { buildWorldSituationContext } from "./world-situation.js";
import { LIVING_VOICE_RULES, antiAiDiagnosticPrompt, antiAiEditPrompt, antiAiVerificationPrompt, parseAntiAiVerification, readerExperiencePrompt } from "./literary-edit.js";
import { buildStyleRegressionPrompt, loadStyleRegressionReferences } from "./style-regression.js";

export interface LongChapterInput {
  worldId: string;
  /** 世界资料目录，默认 worlds/<worldId>。 */
  worldDir?: string;
  mode: GenerationMode;
  brief: string;
  worldBible: string;
  styleProfile?: string;
  sourceText?: string;
  contextText?: string;
  storyAnalysisContext?: string;
  writingBrief?: string;
  storyPlanText?: string;
  model?: string;
  strictModel?: boolean;
  maxWords: number;
  scenes: number;
  timeoutMs: number;
  outputDir: string;
  statePath: string;
  libraryDir?: string;
  retrievalLimit?: number;
  applyState: boolean;
}

/** 只数汉字，与「一万字」的口径一致；标点与空白不计。 */
export function chineseChars(text: string): number {
  return (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length;
}

/** 只记录成稿节奏的离线诊断数据，不用于验收、评分或自动修订。 */
export function rhythmMetrics(text: string): { chars: number; sentences: number; mean: number; short: number; long: number; veryLong: number; dialogueLines: number } {
  const lines = text.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const sentences: string[] = [];
  for (const line of lines) {
    for (const part of line.split(/(?<=[。！？…])/)) {
      if (part.trim()) sentences.push(part.trim());
    }
  }
  const lengths = sentences
    .map(sentence => (sentence.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length)
    .filter(length => length > 0);
  const ratio = (predicate: (length: number) => boolean): number =>
    lengths.length ? Number((lengths.filter(predicate).length / lengths.length).toFixed(3)) : 0;
  return {
    chars: chineseChars(text),
    sentences: lengths.length,
    mean: lengths.length ? Number((lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)) : 0,
    short: ratio(length => length <= 10),
    long: ratio(length => length >= 31),
    veryLong: ratio(length => length >= 60),
    dialogueLines: lines.length ? Number((lines.filter(line => /^["“「]/.test(line)).length / lines.length).toFixed(3)) : 0
  };
}

async function saveStage(dir: string, name: string, content: string): Promise<void> {
  await writeFile(resolve(dir, name), content.trim() + "\n", "utf8");
}

/** 严格解析场景蓝图，格式错误就停止，绝不把整份蓝图重复当作每一场。 */
export function splitScenes(plan: string, expected: number): string[] {
  const headings = [...plan.matchAll(/^##\s*场景\s*(\d+)\b[^\n]*$/gm)];
  if (headings.length < 1 || headings.length > expected) {
    throw new Error(`场景蓝图应包含 1 到 ${expected} 个场景，实际识别到 ${headings.length} 个；请检查 01-scene-blueprint.md 后重试。`);
  }
  const scenes: string[] = [];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!;
    const number = Number(heading[1]);
    if (number !== index + 1) {
      throw new Error(`场景蓝图编号必须连续且从 1 开始：第 ${index + 1} 个标题编号为 ${number}。`);
    }
    const bodyStart = (heading.index ?? 0) + heading[0].length;
    const next = headings[index + 1];
    const bodyEnd = next?.index ?? plan.length;
    const body = plan.slice(bodyStart, bodyEnd).trim();
    if (!body) throw new Error(`场景 ${number} 的蓝图内容为空。`);
    scenes.push(heading[0] + "\n" + body);
  }
  return scenes;
}

function tail(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars ? text : chars.slice(-maxChars).join("");
}

export async function writeLongChapter(input: LongChapterInput): Promise<string> {
  const state = await loadRunStoryState(input.statePath, input.worldId, input.outputDir, "write-long");
  const profiles = readTaskProfiles();
  const laws = loadIronLaws(input.worldDir ?? resolve("worlds", input.worldId));
  await mkdir(input.outputDir, { recursive: true });
  const call = (stage: StageKey, parts: string[]): Promise<string> =>
    runAgentText(parts.join("\n\n"), input.model, input.timeoutMs, profiles[stage], !input.strictModel);
  const cachedCall = (key: string, outputFile: string, stage: StageKey, parts: string[], validate?: (output: string) => void): Promise<string> => {
    const prompt = parts.join("\n\n");
    return runCachedStage({
      dir: input.outputDir, key, outputFile,
      fingerprint: JSON.stringify({ prompt, modelAttempts: resolveModelAttempts(input.model, !input.strictModel), profile: profiles[stage], timeoutMs: input.timeoutMs, strictModel: input.strictModel ?? false }),
      execute: async () => {
        const started = Date.now();
        const startedAt = new Date(started).toISOString();
        const modelAttempts = resolveModelAttempts(input.model, !input.strictModel);
        const record = async (outcome: "success" | "failed", details: Record<string, unknown> = {}) => {
          const entry = {
            timestamp: new Date().toISOString(), event: "stage_call", stage, key,
            startedAt, durationMs: Date.now() - started,
            timeoutMs: input.timeoutMs, requestedModel: input.model ?? null,
            modelAttempts, promptChars: prompt.length, outcome, ...details
          };
          try { await appendFile(resolve(input.outputDir, "stage-calls.jsonl"), JSON.stringify(entry) + "\n", "utf8"); }
          catch (error) { console.error("[write-long] unable to append stage diagnostics: " + String(error)); }
        };
        try {
          const output = await call(stage, parts);
          await record("success", { outputChars: output.length });
          return output;
        } catch (error) {
          await record("failed", { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
      validate
    });
  };

  const facts = [
    ...state.canonFacts.map(fact => {
      const label = fact.confidence === "confirmed" ? "原著已确认" : fact.confidence === "inferred" ? "基于原文的推断" : "项目原创";
      return `[${label}] ${fact.fact}${fact.source ? "（来源：" + fact.source + "）" : ""}`;
    }),
    ...state.continuityNotes.map(note => "[当前连续性备注] " + note)
  ].join("\n");
  const situationQuery = [input.brief, state.currentPosition, input.contextText, input.sourceText?.slice(-LONG_CHAPTER_SOURCE_TAIL_CHARS), input.writingBrief, input.storyPlanText, input.storyAnalysisContext].filter(Boolean).join("\n");
  const worldSituation = buildWorldSituationContext(state, situationQuery);
  if (worldSituation) await saveStage(input.outputDir, "00-world-situation-context.md", worldSituation);
  const writingContext = [
    "世界设定（辅助索引，未知内容不得写成原著事实）：", input.worldBible,
    "当前位置：", state.currentPosition,
    "事实来源与当前连续性信息：", facts,
    worldSituation ? "本章相关人物、已发生事件与局势上下文：\n" + worldSituation : "",
    input.contextText ? "前文与连续性摘要：\n" + input.contextText : "",
    input.writingBrief ? "全书知识库（已经写成的事实与未收线，优先于分析参考）：\n" + input.writingBrief : "",
    input.storyPlanText ? input.storyPlanText : "",
    input.storyAnalysisContext ? "既有小说分析参考（仅供启发，不是正史或写作清单）：\n" + input.storyAnalysisContext : "",
    input.sourceText ? "用户提供且有权使用的续写起点（只用于承接，不得整段复制）：\n" + input.sourceText : "",
    input.styleProfile ? "叙事风格参考：\n" + input.styleProfile + "\n风格参考不能凌驾于当前人物、场景需要和文学表达。" : "",
    input.mode === "continuation" ? "创作模式：续写，严格承接材料最后一个有效情节节点。" : "创作模式：原创衍生，项目原创内容不得伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  const blueprintPrompt = [
    "角色：长篇章节主编。为一万字章节制定唯一执行蓝图，不写正文。",
    writingContext,
    `按情节自然需要划分场景，最多 ${input.scenes} 个；可以少于这个数量，不要为了凑数拆开本来连贯的情节。每个场景用单独一行 "## 场景 N" 开头（N 从 1 开始连续编号）。蓝图只需给小说家足够的创作方向，可按需要提及视角、人物、地点、情境、冲突或悬念；不要求每场填满同一套字段，也不要求每场都埋伏笔、推进主线或安排人物成长。让场景各有自己的气息和功能，允许闲笔、日常、误会、停顿和意外。`,
    "结合上面的当前人物状态、已发生事件和因果关系，判断本章相关局势。人物和势力应有自己的目标与行动理由，并受其知识范围、资源和限制影响。势力信息以 World Bible 和已有事实为准；资料不足时保留未知，不补造组织结构或关系。",
    "如确有叙事价值，可在场景列表之前增加“## 局势推演（尚未发生）”，写一至数项可能的发展或主角不介入时的变化；没有价值时省略。局势推演只是创作参考，不是正史，不能写成已发生事实，不要模拟整个世界或强迫每个 NPC 行动。",
`全章目标篇幅约 ${input.maxWords} 个汉字。不要机械平均分配场景篇幅；根据情节、情绪和场景需要决定每场长短。`,
    "区分原著已确认事实与本章新创作。不得安排新果实、十主完整名单、天母去向的解释、人物提前获知未知信息。",
    RHYTHM_RULE,
    "整章节奏应有场景差异，但不按固定数量分配快慢场景。"
  ];
  let blueprint = await cachedCall("blueprint", "01-scene-blueprint-attempt-0.md", "plan", blueprintPrompt);
  let scenePlans: string[];
  try {
    scenePlans = splitScenes(blueprint, input.scenes);
  } catch (error) {
    await saveStage(input.outputDir, "01-scene-blueprint-rejected.md", blueprint);
    blueprint = await cachedCall("blueprint-repair", "01-scene-blueprint-attempt-1.md", "plan", [
      ...blueprintPrompt,
      "上一次场景蓝图未通过程序格式校验：" + String(error),
      "请修正上一版蓝图：场景数不得超过 " + input.scenes + "，按情节自然需要决定数量（至少 1 场），编号从 1 连续递增，每场内容非空。不要为了满足数量拆分连贯情节。只输出修正后的完整蓝图，不解释。",
      "上一次蓝图：",
      blueprint
    ]);
    scenePlans = splitScenes(blueprint, input.scenes);
  }
  await saveStage(input.outputDir, "01-scene-blueprint.md", blueprint);
  // 终审失败时可能先改蓝图；这里保存逐场蓝图的当前版本。
  let currentPlans = scenePlans;
  const perScene = Math.ceil(input.maxWords / scenePlans.length * SCENE_WORD_BUDGET_BUFFER);
  const sceneTexts: string[] = [];
  for (let index = 0; index < scenePlans.length; index++) {
    // Use the accumulated chapter, not only the immediately preceding scene.
    // The tail keeps prompts bounded while retaining more cross-scene state.
    const previous = sceneTexts.length
      ? tail(sceneTexts.join("\n\n"), 7200)
      : "（本章第一场，无前文）";
    const sceneReference = [input.brief, scenePlans[index]!].join("\n");
    const relevantCharacters = state.characters.filter(character =>
      sceneReference.includes(character.name) || (character.relationships ?? []).some(name => sceneReference.includes(name))
    );
    const sceneSituation = buildWorldSituationContext(state, [input.brief, scenePlans[index]!, previous].join("\n"), 2600);
    if (sceneSituation) await saveStage(input.outputDir, `00-scene-${String(index + 1).padStart(2, "0")}-world-situation.md`, sceneSituation);
    const characterState = relevantCharacters.map(character => [
      character.name + "｜" + character.status,
      character.location ? "位置：" + character.location : "",
      character.knowledge?.length ? "已知：" + character.knowledge.join("；") : "",
      character.goals?.length ? "当前目标：" + character.goals.join("；") : "",
      character.motivation ? "当前动机：" + character.motivation : "",
      character.resources?.length ? "可调用资源：" + character.resources.join("；") : "",
      character.constraints?.length ? "行动限制：" + character.constraints.join("；") : "",
      character.currentPressure?.length ? "当前压力：" + character.currentPressure.join("；") : "",
      character.decisionHistory?.length ? "近期重要决定：" + character.decisionHistory.slice(-WORLD_SITUATION_FIELD_DEFAULT_LIMIT).join("；") : "",
      character.relationships?.length ? "关系：" + character.relationships.join("；") : "",
      character.abilities?.length ? "能力：" + character.abilities.join("；") : "",
      character.profile?.coreTraits?.length ? "性格底色（参考，不是行为限制）：" + character.profile.coreTraits.join("；") : "",
      character.profile?.contradictions?.length ? "内在矛盾：" + character.profile.contradictions.join("；") : ""
    ].filter(Boolean).join("\n")).join("\n\n");
    const sceneRetrieval = input.libraryDir
      ? await searchLibrary(input.libraryDir, [input.brief, scenePlans[index]!, ...state.characters.map(character => character.name)].join("\n"), input.retrievalLimit ?? WRITE_LONG_RETRIEVAL_LIMIT)
      : [];
    const sceneEvidence = sceneRetrieval.map((hit, hitIndex) =>
      `[${hitIndex + 1}, score ${hit.score.toFixed(2)}] ${hit.source} / ${hit.chapter} / offset ${hit.start}-${hit.end}\n${hit.text}`
    ).join("\n\n");
    await saveStage(input.outputDir, `00-scene-${String(index + 1).padStart(2, "0")}-retrieval.md`, sceneEvidence || "本场未检索到额外原文证据。");
    const scenePrompt = [
      `角色：场景小说家。只写第 ${index + 1} 场完整正文，不输出标题、分析或创作说明。`,
      LIVING_VOICE_RULES,
      writingContext,
      "全章蓝图：", blueprint,
      characterState ? "本场相关人物的当前状态（仅帮助承接，不是人物行为边界）：\n" + characterState : "",
      sceneSituation ? "本场相关人物与事件的当前局势（可能性不是正史）：\n" + sceneSituation : "",
      `本场蓝图：`, scenePlans[index]!,
      "本场相关原文证据（只用于核实事实，不得照搬）：", sceneEvidence,
      "上一场正文的连续性上下文（重点承接人物位置、已知信息、关系变化、道具归属、未完成动作与场景结果，不得重复）：", previous,
      `本场篇幅参考约 ${perScene} 个汉字，不是必须命中的配额。写出完整、自然的场景；人物可以行动、闲谈、观察、犹豫或误判，不必套用固定的目标—阻力—选择—后果结构。不要用概述代替真正重要的场面，也不要为了字数添加无用内容。`,
      RHYTHM_RULE,
      "根据本场功能安排长短句、对白和感官细节；推理或交涉可以展开长句，动作和情绪落点可以短句收束。不要为了满足固定字数或清单配额而添加无功能内容。",
      "不复制原文句子，不以近义词替换改写原文；不写「未完待续」「本场结束」等标记。"
    ];
    let text = await cachedCall("scene-" + (index + 1), "02-scene-" + String(index + 1).padStart(2, "0") + ".md", "scene", scenePrompt);
    if (chineseChars(text) < perScene * 0.65) {
      const extra = await cachedCall("scene-expansion-" + (index + 1), "02-scene-" + String(index + 1).padStart(2, "0") + "-expansion.md", "scene", [
        scenePrompt[0]!, LIVING_VOICE_RULES, "已写出的本场正文：", text,
        `当前场景明显偏短。先判断它是否已经自然完成：若确实还缺少必要的动作、对话、情绪或场景收束，请从现有最后一句自然续写；若已经完整，不要为凑字数硬加内容。不得重复或改写已有内容，也不要提前收束全章。`,
        RHYTHM_RULE
      ]);
      text = text.trim() + "\n\n" + extra.trim();
    }
    sceneTexts.push(text.trim());
    await saveStage(input.outputDir, `02-scene-${String(index + 1).padStart(2, "0")}.md`, text);
    console.error(`[write-long] 场景 ${index + 1}/${scenePlans.length} · ${chineseChars(text)} 汉字`);
  }

  const draft = sceneTexts.join("\n\n---\n\n");
  await saveStage(input.outputDir, "03-draft.md", draft);

  // 终审只挑「读者会认为不可能」的硬伤；分两批控制单次输入，合并去重后再交给逐场修订。
  const middle = Math.ceil(sceneTexts.length / 2);
  const halves = [sceneTexts.slice(0, middle), sceneTexts.slice(middle)];
  const found: ReviewIssue[] = [];
  const summaries: string[] = [];
  for (let index = 0; index < halves.length; index++) {
    const slice = halves[index]!;
    if (!slice.length) continue;
    const batchStart = index === 0 ? 1 : middle + 1;
    const batchText = slice.map((scene, localIndex) =>
      `【场景 ${batchStart + localIndex}】\n${scene}`
    ).join("\n\n---\n\n");
    const batchPrompt = reviewPrompt({
      context: writingContext,
      blueprint,
      chapter: batchText,
      sceneCount: sceneTexts.length,
      sceneLabel: `第 ${index + 1} 批，场景 ${batchStart}–${batchStart + slice.length - 1}`
    });
    const validateBatchReview = (output: string) => {
      const report = parseChapterReview(output, batchText, sceneTexts.length);
      const batchEnd = batchStart + slice.length - 1;
      if (report.issues.some(issue => issue.scenes.some(scene => scene < batchStart || scene > batchEnd))) {
        throw new Error(`Batch review ${index + 1} returned a scene outside its assigned range ${batchStart}–${batchEnd}.`);
      }
      return report;
    };
    let raw: string;
    let parsed: ReturnType<typeof parseChapterReview>;
    try {
      raw = await cachedCall("batch-review-" + (index + 1), "04-review-batch-" + (index + 1) + "-raw.txt", "review", [
        batchPrompt
      ], validateBatchReview);
      parsed = validateBatchReview(raw);
    } catch (firstError) {
      raw = await cachedCall("batch-review-" + (index + 1) + "-retry", "04-review-batch-" + (index + 1) + "-retry-raw.txt", "review", [
        batchPrompt,
        "上一次审查结果未通过结构校验：" + String(firstError),
        "请重新审查同一批正文。每条必改问题都必须给出有效的全章场景编号；没有必改项就返回空 issues 和 pass。只输出 schema 对应的 JSON。"
      ], validateBatchReview);
      parsed = validateBatchReview(raw);
    }
    summaries.push(parsed.summary);
    found.push(...parsed.issues);
  }
  const seen = new Set<string>();
  const merged = found.filter(issue => {
    // 只抹掉空白差异；按前 16 字截断会把两条不同硬伤当成重复。
    const normalize = (text: string): string => text.replace(/\s+/g, "");
    const key = issue.scenes.join(",") + "|" + normalize(issue.problem) + "|" + normalize(issue.evidence);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, BATCH_REVIEW_MAX_ISSUES);
  const review = formatReview({
    status: merged.length ? "needs_repair" : "pass",
    summary: summaries.join("；") || "未发现读者会认定不可能的硬伤",
    issues: merged
  });
  await saveStage(input.outputDir, "04-continuity-review.md", review);

  const polished: string[] = [];
  for (let index = 0; index < sceneTexts.length; index++) {
    const text = await cachedCall("polish-" + (index + 1), "05-polish-" + String(index + 1).padStart(2, "0") + ".md", "voice", [
      "角色：人物对话编辑兼叙事声音编辑。以原稿为基础做精修，不重新创作场景。只修订确有问题的对白与叙述表达，不改剧情事实、场景顺序、人物决定和信息揭示。",
      LIVING_VOICE_RULES,
      writingContext, "全章蓝图：", blueprint, "连续性审查（只修有证据支持的问题）：", review,
      `第 ${index + 1} 场当前正文：`, sceneTexts[index]!,
      "校准人物语气与知识边界，删解释性过强、所有人同一腔调的对白；统一视角与叙述距离。",
      RHYTHM_RULE,
      "输出本场完整修订正文。以逐句、逐段编辑为主，不得为了让文字显得更丰富而扩写；不要新增原稿没有的情节节点、人物互动、对白轮次、动作链、背景设定或解释。只有原稿确有表达断裂、读者无法理解或必要情绪落点缺失时才补写。可以精简重复或解释过度的内容，但不能删掉有效动作、信息、人物互动或情绪落点；保留长句、清单与放慢段落，不得把全章改成短促腔。原文已经成立时可以原样保留，不得新增标题或创作说明。"
    ]);
    polished.push(text.trim());
    await saveStage(input.outputDir, `05-polish-${String(index + 1).padStart(2, "0")}.md`, text);
    console.error(`[write-long] 修订 ${index + 1}/${sceneTexts.length} · ${chineseChars(text)} 汉字`);
  }

  const polishDiagnostics = sceneTexts.map((before, index) => {
    const after = polished[index] ?? "";
    const beforeChars = chineseChars(before);
    const afterChars = chineseChars(after);
    return { scene: index + 1, beforeChars, afterChars, deltaChars: afterChars - beforeChars, deltaRatio: beforeChars ? Number(((afterChars - beforeChars) / beforeChars).toFixed(3)) : null };
  });
  await saveStage(input.outputDir, "05-polish-diagnostics.json", JSON.stringify({ scenes: polishDiagnostics, totalBeforeChars: polishDiagnostics.reduce((sum, item) => sum + item.beforeChars, 0), totalAfterChars: polishDiagnostics.reduce((sum, item) => sum + item.afterChars, 0), note: "诊断信息，不是篇幅门槛；扩写或精简都应结合文学效果判断。" }, null, 2));

  const chapterTitle = "# " + (input.mode === "continuation" ? "续写章节" : "衍生章节") + "\n\n";
  const buildChapter = (): string => chapterTitle + polished.join("\n\n---\n\n") + "\n";
  let antiAiChapter = buildChapter();
  let antiAiDiagnosis = "";
  try {
    antiAiDiagnosis = await cachedCall("anti-ai-diagnosis", "06a-anti-ai-diagnosis.md", "antiAi", [
      antiAiDiagnosticPrompt({ brief: input.brief, blueprint, styleProfile: input.styleProfile, chapter: antiAiChapter })
    ], output => { if (!output.trim()) throw new Error("Anti-AI diagnosis returned an empty report."); });
  } catch (error) {
    await saveStage(input.outputDir, "06a-anti-ai-diagnosis-error.txt", String(error));
    console.error("[write-long] Anti-AI 诊断未完成；编辑阶段仍按通用文学原则运行。");
  }
  try {
    antiAiChapter = await cachedCall("anti-ai-edit", "06b-anti-ai-edited.md", "antiAi", [
      antiAiEditPrompt({ brief: input.brief, blueprint, styleProfile: input.styleProfile, diagnosis: antiAiDiagnosis, chapter: antiAiChapter })
    ], output => { if (!output.trim()) throw new Error("Anti-AI editor returned an empty chapter."); });
  } catch (error) {
    await saveStage(input.outputDir, "06b-anti-ai-error.txt", String(error));
    console.error("[write-long] Anti-AI 编辑阶段失败，保留逐场修订稿继续终审。");
  }
  if (antiAiChapter !== buildChapter()) {
    try {
      const originalChapter = buildChapter();
      const verificationRaw = await cachedCall("anti-ai-verification", "06c-anti-ai-verification.json", "antiAi", [
        antiAiVerificationPrompt({ original: originalChapter, edited: antiAiChapter })
      ], output => { parseAntiAiVerification(output); });
      const verification = parseAntiAiVerification(verificationRaw);
      await saveStage(input.outputDir, "06c-anti-ai-verification.json", JSON.stringify(verification, null, 2));
      if (verification.decision === "restore") antiAiChapter = originalChapter;
    } catch (error) {
      await saveStage(input.outputDir, "06c-anti-ai-verification-error.txt", String(error));
      antiAiChapter = buildChapter();
      console.error("[write-long] Anti-AI 复核未能确认编辑收益，恢复原稿。");
    }
  } else {
    await saveStage(input.outputDir, "06c-anti-ai-verification.json", JSON.stringify({ decision: "keep", reason: "编辑阶段未改变正文。" }, null, 2));
  }
  await saveStage(input.outputDir, "06b-anti-ai-edited.md", antiAiChapter);

  const reviewHistory: string[] = [];
  const reviewed = await reviewAndRepair({
    initialChapter: antiAiChapter,
    sceneCount: sceneTexts.length,
    maxRepairRounds: 2,
    review: (candidate, correction) => {
      const round = reviewHistory.length + 1;
      return cachedCall("final-review-" + round + (correction ? "-retry" : ""), "08-final-review-round-" + round + (correction ? "-retry" : "") + "-raw.txt", "review", [
        reviewPrompt({ context: writingContext, blueprint, chapter: candidate, priorReview: review, sceneCount: sceneTexts.length, correction })
      ], output => parseChapterReview(output, candidate, sceneTexts.length)).then(raw => {
        const parsed = parseChapterReview(raw, candidate, sceneTexts.length);
        // 分场做硬约束检查，命中项带场景号，修复阶段才能定位。
        const lawIssues = polished.flatMap((text, index) => ironLawIssues(checkIronLaws(text, laws), [index + 1]));
        return JSON.stringify(withDeterministicIssues(parsed, lawIssues));
      });
    },
    repair: async (_candidate, issues, round) => {
      const affectedScenes = [...new Set(issues.flatMap(issue => issue.scenes))].sort((a, b) => a - b);
      if (!affectedScenes.length) throw new Error("Final review reported must-fix issues without scene locations; refusing to mark an empty repair as complete.");
      // 先在大纲层收敛：正文里改不动的问题，多半是蓝图里的目标、信息差或代价没安排好。
      // 只在第一轮做，且未受影响的场景保持原蓝图，避免越修越偏。
      if (round === 1) {
        const revised = await cachedCall("blueprint-revision", "01-scene-blueprint-revision.md", "plan", [
          "角色：长篇章节主编。终审发现的问题不是句子层面能修好的，先回到蓝图层调整。",
          writingContext,
          "当前全章蓝图：", blueprint,
          "终审必改项：", JSON.stringify(issues, null, 2),
          `只调整受影响场景（${affectedScenes.join("、")}）的目标、人物掌握的信息差、代价与结果安排；其余场景保持原样，不要顺手改写。`,
          `场景数量必须保持 ${scenePlans.length} 个，"## 场景 N" 编号连续从 1 开始。`,
          "输出完整修订蓝图，不解释，不写正文。"
        ]);
        // 蓝图修订是优化路径：格式不合规或改了场景数就退回原蓝图，不能让它拖垮整章。
        let revisedPlans: string[] | undefined;
        try {
          revisedPlans = splitScenes(revised, input.scenes);
        } catch (error) {
          console.warn("[write-long] 蓝图修订未通过格式校验，保留原蓝图：" + String(error));
        }
        if (!revisedPlans || revisedPlans.length !== scenePlans.length) {
          await saveStage(input.outputDir, "01-scene-blueprint-revision-rejected.md", revised);
        } else {
          currentPlans = revisedPlans.map((plan, index) => affectedScenes.includes(index + 1) ? plan : scenePlans[index]!);
          blueprint = currentPlans.join("\n\n");
          await saveStage(input.outputDir, "01-scene-blueprint-revision.md", blueprint);
          console.error("[write-long] 已在大纲层修订蓝图：场景 " + affectedScenes.join("、"));
        }
      }
      for (const sceneNumber of affectedScenes) {
        const sceneIssues = issues.filter(issue => issue.scenes.includes(sceneNumber));
        const index = sceneNumber - 1;
        const currentScene = polished[index];
        if (currentScene === undefined) throw new Error("Review referenced a missing scene: " + sceneNumber);
        const revised = await cachedCall("scene-repair-" + sceneNumber + "-round-" + round, "05-polish-" + String(sceneNumber).padStart(2, "0") + "-repair-" + round + ".md", "voice", [
          "角色：场景修复编辑。只修复指定场景中的实质问题，输出本场完整正文，不得输出解释或标题。",
          writingContext,
          "全章蓝图：", blueprint,
          "本场蓝图（如有修订以修订版为准）：", currentPlans[index] ?? "",
          "原始分场审查：", review,
          "最终全章审查发现：", JSON.stringify(sceneIssues, null, 2),
          "当前场景正文：", currentScene,
          "本轮自动修复：" + round,
          "修复要求：解决列出的问题，保留本场已成立的人物选择、信息揭示和文学表达；不得引入与其他场景冲突的新事实。跨场问题应遵守其他受影响场景已确认的事实。除修复问题外尽量保持原文。"
        ]);
        // Length change alone is not evidence of lost story content; the repair
        // is judged by the subsequent full-chapter review, not a word-count gate.
        polished[index] = revised.trim();
        await saveStage(input.outputDir, "05-polish-" + String(sceneNumber).padStart(2, "0") + "-repair-" + round + ".md", revised);
      }
      return buildChapter();
    },
    onReview: async (round, candidate, report) => {
      reviewHistory.push("## 全章复查轮次 " + (round + 1) + "\n\n" + formatReview(report));
      await saveStage(input.outputDir, "08-final-review-round-" + (round + 1) + ".json", JSON.stringify(report, null, 2));
    },
    onFailure: async (chapter, reviews, reason) => {
      await saveStage(input.outputDir, "chapter-blocked.md", chapter);
      await saveStage(input.outputDir, "08-quality-summary.json", JSON.stringify({
        status: "blocked", reason, reviews
      }, null, 2));
      console.error("[write-long] 终审仍有未解决硬伤，成稿已保留为 chapter-blocked.md；本次运行安全失败，故事状态未更新。");
    }
  });
  const chapter = reviewed.chapter;
  await saveStage(input.outputDir, "chapter.md", chapter);
  await saveStage(input.outputDir, "08-final-review.md", reviewHistory.join("\n\n---\n\n"));
  await saveStage(input.outputDir, "08-quality-summary.json", JSON.stringify({
    status: "passed",
    repairRounds: reviewed.repairRounds,
    reviews: reviewed.reviews
  }, null, 2));
  if (input.styleProfile?.trim()) {
    try {
      const references = await loadStyleRegressionReferences(input.worldDir ?? resolve("worlds", input.worldId));
      const report = await cachedCall("style-regression", "11-style-regression.md", "styleDistill", [
        buildStyleRegressionPrompt({ styleProfile: input.styleProfile, references, candidates: [{ label: "本次最终长章节", text: chapter }] })
      ], output => { if (!output.trim()) throw new Error("Style regression returned an empty report."); });
      await saveStage(input.outputDir, "11-style-regression.md", report);
    } catch (error) {
      await saveStage(input.outputDir, "11-style-regression-error.txt", String(error));
      console.error("[write-long] 风格回归观察未完成；不改动正文，也不影响章节状态提交。");
    }
  }
  try {
    const readerReport = await cachedCall("reader-experience", "10-reader-experience.md", "reader", [
      readerExperiencePrompt({ brief: input.brief, chapter })
    ], output => { if (!output.trim()) throw new Error("Reader returned an empty report."); });
    await saveStage(input.outputDir, "10-reader-experience.md", readerReport);
  } catch (error) {
    await saveStage(input.outputDir, "10-reader-experience-error.txt", String(error));
    console.error("[write-long] Reader 体验评估未完成；不影响章节通过与状态提交。");
  }
  const metrics = { target: input.maxWords, scenes: polished.length, ...rhythmMetrics(chapter) };
  await saveStage(input.outputDir, "06-rhythm-metrics.json", JSON.stringify(metrics, null, 2));
  console.error("[write-long] 成稿 " + metrics.chars + " 汉字 · 均句长 " + metrics.mean + " · 长句 " + (metrics.long * 100).toFixed(1) + "% · 自动修复 " + reviewed.repairRounds + " 轮");

  const statePrompt = [
    "角色：小说连续性资料管理员。根据旧状态和最终章节提取状态变化。",
    "只输出合法 JSON 对象，不要 Markdown 代码围栏。结构：",
    JSON.stringify({
      currentPosition: "string",
      canonFacts: [{ id: "stable-id", fact: "fact", source: "chapter id", confidence: "confirmed|inferred|original" }],
      characters: [{ name: "name", profile: { coreTraits: ["stable traits"], values: ["values"], contradictions: ["internal contradictions"], voice: "distinctive voice", boundaries: ["behavioral boundaries"], arc: "long-term arc" }, status: "current status", location: "current location", abilities: ["current abilities"], knowledge: ["current knowledge with source/limits when useful"], goals: ["current goals"], motivation: "why these goals matter now", resources: ["currently available means"], constraints: ["actual limits"], currentPressure: ["current pressures"], decisionHistory: ["consequential decisions already made"], relationships: ["current relationships"], arcMilestones: [{ id: "stable-milestone-id", chapter: "chapter id", change: "what changed", evidence: "exact excerpt from final chapter", choice: "optional, only if naturally clear", pressure: "optional, only if naturally clear", cost: "optional, only if naturally clear" }] }],
      events: [{ id: "stable-id", summary: "event", position: "story position", participants: ["name"], causes: ["prior event id or concise causal condition"], consequences: ["consequence"], relatedPlotThreads: ["related plot thread id"], origin: "canon|inferred|original", source: "source reference" }],
      plotThreads: [{ id: "stable-id", title: "thread", status: "open|active|resolved|abandoned", lastUpdated: "chapter id", notes: "latest state" }],
      foreshadowingUpdates: [{ id: "stable-clue-id:chapter", clueId: "stable-clue-id", clue: "线索内容", status: "planted|reinforced|misdirected|partially_revealed|revealed|resolved|abandoned|uncertain", chapter: "chapter id", change: "本章对线索生命周期造成的变化", relatedThreadIds: ["plot-thread-id"], evidence: "exact excerpt from final chapter" }],
      macguffinUpdates: [{ id: "stable-macguffin-id:chapter", macguffinId: "stable-macguffin-id", name: "关键物件/目标/信息", status: "introduced|sought|located|held|transferred|lost|destroyed|secured|irrelevant|uncertain", chapter: "chapter id", change: "本章发生的状态变化", holder: "optional current holder", location: "optional current location", relatedThreadIds: ["plot-thread-id"], evidence: "exact excerpt from final chapter" }],
      relationshipUpdates: [{ id: "stable-relation-id:chapter", relationId: "stable-relation-id", from: "人物甲", to: "人物乙", label: "旧友/敌对/师徒等关系类型", chapter: "chapter id", change: "本章真实发生的互动或关系变化", evidence: "exact excerpt from final chapter" }],
      continuityNotes: ["complete current active notes"]
    }, null, 2),
    "旧状态：", JSON.stringify(state, null, 2),
    "最终章节全文（状态提取必须覆盖每一场的人物、事件、事实与情节线变化）：", chapter,
    "continuityNotes 必须返回章节结束时仍然有效的完整备注集合，不是只列新增项；已经变化、解决或被新事实替代的旧备注不要继续返回。profile 记录相对稳定的性格底色、价值观、内在矛盾、语言习惯和行为边界；不要因单次行为轻易改写。其他字段是章节结束时的当前状态快照，数组必须给出完整当前值。 motivation 说明目标背后的当前原因；resources 只记录实际可调用资源；constraints 记录影响行动的限制；currentPressure 记录当前压力；decisionHistory 只保留少量重要决定。人物弧光可以变化、反复、倒退，也可以出现意料之外的选择；不要因为画像或预设弧线限制人物。状态提取只是记录正文已经发生的事，不得反过来要求正文解释人物变化。只有正文自然呈现了重要转折时才追加 arcMilestones；不要为了填写选择、压力、代价字段而补写或拔高剧情。本次最终章节是项目续写文本，不是原著原文。凡首次由本次正文引入的事实一律标为 original；只有能由旧状态中已有的原著事实明确对应的条目才可沿用原有 canon/inferred 来源，不得仅因正文写得确定就标 confirmed。新事件必须标 origin=original；事件如明确回指原著资料，须填写 source。不要把项目原创写进原著正史。伏笔只有在正文确实埋设、强化、误导、揭示、回收或放弃时才追加 foreshadowingUpdates；不要把普通细节过度解释成伏笔，不要为了回收而改写剧情。MacGuffin 只有在重要目标、物件或信息的持有者、位置、可获得性或叙事作用确实变化时才追加 macguffinUpdates。两类更新均须引用最终正文中的逐字证据；没有变化就返回空数组，不要求每章必须有更新。人物关系只有在正文呈现有意义的新互动或信任、依赖、敌意、立场等变化时才追加 relationshipUpdates；不要把每次普通对话都记成关系变化，也不要把关系变化当成必须维持的静态标签；每条更新必须附最终正文中的逐字证据。"
  ].join("\n\n");
  const parseUpdate = (raw: string) => {
    let value: unknown;
    try {
      value = parseJsonObject(raw);
    } catch (error) {
      throw new Error("State agent did not return a JSON object: " + String(error));
    }
    return parseStoryStateUpdate(value, chapter);
  };
  const validateStateUpdate = (output: string) => parseUpdate(output);
  let stateText = "";
  let update: ReturnType<typeof parseStoryStateUpdate>;
  try {
    stateText = await cachedCall("state-update", "07-state-update-raw.json", "state", [statePrompt], validateStateUpdate);
    update = validateStateUpdate(stateText);
  } catch (firstError) {
    try {
      stateText = await cachedCall("state-update-retry", "07-state-update-retry-raw.json", "state", [
        "上一次状态提取未通过 JSON 或 schema 校验：" + String(firstError),
        "上一次输出：", stateText,
        "请重新根据旧状态和下面的最终章节全文提取，只输出符合既定 JSON schema 的对象；continuityNotes 必须返回完整的当前有效备注数组；不要添加 Markdown、解释或 schema 外字段。",
        "旧状态：", JSON.stringify(state, null, 2),
        "最终章节全文：", chapter
      ], validateStateUpdate);
      update = validateStateUpdate(stateText);
    } catch (retryError) {
      await saveStage(input.outputDir, "07-state-update-error.txt", "First attempt: " + String(firstError) + "\nRetry: " + String(retryError) + "\n\n" + stateText);
      throw new Error("Chapter was generated, but story-state extraction failed twice. See 07-state-update-error.txt; do not start the next chapter.");
    }
  }
  const nextState = mergeStoryState(state, update);
  try {
    if (input.applyState) await saveStoryState(input.statePath, nextState);
    await saveStage(input.outputDir, "07-state-update.json", JSON.stringify(nextState, null, 2));
  } catch (error) {
    await saveStage(input.outputDir, "07-state-update-error.txt", String(error) + "\n\n" + stateText);
    throw new Error("Chapter was generated, but story-state persistence failed. See 07-state-update-error.txt; do not start the next chapter.");
  }
  return chapter;
}
