// 万字章节流水线：一次规划、逐场成文与修订、保守局部文学 Patch、一次全章硬伤终审。
// 不复用 SDK session；场景之间靠落盘的原文结尾与事实清单显式交接，可逐场重跑。
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { commitStoryStateAndArc, parseStoryStateUpdate } from "./story-state.js";

import { runAgentText, resolveModelAttempts, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { RHYTHM_RULE, mergeStoryState } from "./workflow.js";
import { searchLibrary } from "./library.js";
import { formatReview, parseChapterReview, reviewAndRepair, reviewPrompt, withDeterministicIssues } from "./chapter-review.js";
import { checkIronLaws, ironLawIssues, loadIronLaws } from "./iron-laws.js";
import { loadRunStoryState, runCachedStage } from "./stage-cache.js";
import { parseJsonObject } from "./model-json.js";
import {
  ACCUMULATED_CONTEXT_TAIL_CHARS,
  LONG_CHAPTER_SOURCE_TAIL_CHARS,
  SCENE_SITUATION_BUDGET_CHARS,
  WORLD_SITUATION_FIELD_DEFAULT_LIMIT,
  WRITE_LONG_RETRIEVAL_LIMIT
} from "./constants.js";
import { buildRecentEventContinuityContext, buildWorldSituationContext } from "./world-situation.js";
import { CREATIVE_FREEDOM_RULES, LIVING_VOICE_RULES, literaryPatchPrompt, parseLiteraryPatchResult, applyLiteraryPatches, readerExperiencePrompt } from "./literary-edit.js";

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
  storyArcText?: string;
  storyArcPath?: string;
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
  /** Optional blind-reader report; disabled in normal one-click generation. */
  readerExperience?: boolean;
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
  const recentEventContext = buildRecentEventContinuityContext(state);
  if (worldSituation) await saveStage(input.outputDir, "00-world-situation-context.md", worldSituation);
  if (recentEventContext) await saveStage(input.outputDir, "00-recent-event-context.md", recentEventContext);
  const previousArc = input.storyArcText?.trim() ?? "";
  const storyArc = await cachedCall("story-arc", "00-story-arc.md", "plan", [
    "角色：中期故事架构师。为当前故事阶段校准可调整的中期方向；不要把章节计划当成剧情合同。",
    "分层展开：如果长期 Story Plan 提供了重大节点，先结合当前已发生事实识别正在推进或最近的未完成节点，只把当前节点及必要的相邻因果展开成近期 Story Arc；更远节点保留方向性摘要，不预先细化成整串章节。若当前剧情已自然偏离某节点，以已提交事实为准，调整未来路径，不得 retcon。",
    "世界设定：", input.worldBible,
    "当前位置：", state.currentPosition,
    "已有事实与连续性：", facts,
    input.storyPlanText ?? "",
    "既有 Story Arc：", previousArc || "尚无中期故事阶段，请从当前局势自然推演。",
    worldSituation,
    recentEventContext,
    input.storyAnalysisContext ?? "",
    "本次长章节任务：", input.brief,
    "结合已发生正文、人物选择、因果和未解决问题，形成适合连续写作的中期方向。只保留真正值得关注的少数阶段节点；允许日常、过渡、关系戏和暂不推进主线。不得凑章节数、强制人物弧光、预写人物选择或把可能性写成正史。文学性、文笔、艺术风格高于其他一切。"
  ], output => { if (!output.trim()) throw new Error("Story Arc is empty."); });
  if (previousArc) await saveStage(input.outputDir, "00-story-arc-previous.md", previousArc);
  await saveStage(input.outputDir, "00-story-arc.md", storyArc);
  const writingContext = [
    "世界设定（辅助索引，未知内容不得写成原著事实）：", input.worldBible,
    "当前位置：", state.currentPosition,
    "事实来源与当前连续性信息：", facts,
    worldSituation ? "本章相关人物、已发生事件与局势上下文：\n" + worldSituation : "",
    recentEventContext,
    input.contextText ? "前文与连续性摘要：\n" + input.contextText : "",
    input.writingBrief ? "全书知识库（已经写成的事实与未收线，优先于分析参考）：\n" + input.writingBrief : "",
    input.storyPlanText ? input.storyPlanText : "",
    "当前滚动式多章节 Story Arc（方向性参考，可根据正文自然偏离）：\n" + storyArc,
    input.storyAnalysisContext ? "既有小说分析参考（仅供启发，不是正史或写作清单）：\n" + input.storyAnalysisContext : "",
    input.sourceText ? "用户提供且有权使用的续写起点（只用于承接，不得整段复制）：\n" + input.sourceText : "",
    input.styleProfile ? "叙事风格参考：\n" + input.styleProfile + "\n风格参考不能凌驾于当前人物、场景需要和文学表达。" : "",
    input.mode === "continuation" ? "创作模式：续写，严格承接材料最后一个有效情节节点。" : "创作模式：原创衍生，项目原创内容不得伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  const blueprintPrompt = [
    "角色：长篇小说构思编辑。为本章提供可偏离的场景参考，不写正文。",
    writingContext,
    `按情节自然需要划分场景，最多 ${input.scenes} 个；可以少于这个数量，不要为了凑数拆开本来连贯的情节。每个场景用单独一行 "## 场景 N" 开头（N 从 1 开始连续编号）。场景条目只需说明从哪里开始、人物大致处境，以及确实不能丢失的事实或锚点。只有本场自然存在时才写欲望、压力、冲突、信息差、选择和后果；允许日常、闲谈、观察、过渡、氛围或没有明确结果的场景。不要替小说家编排逐帧动作、比喻、心理解释或句子；其他细节留给正文自然发现。`,
    CREATIVE_FREEDOM_RULES,
    "形成蓝图前，先在内部考虑至少两种事件机制或人物选择不同的可能路径，再选最有生命力的一种；不要只沿当前大纲最显然的方向展开。允许组合或改造不同路径，但不要为展示发散过程输出分析报告，也不要强行加入反转。新方向必须符合人物实际知识、欲望、资源和处境。",
    "结合当前人物状态和已发生事件理解局势。人物和势力可以有自己的目标与行动理由，但不必每次都采取有效行动，也不必每个目标都在本章推进；资料不足时保留未知，不补造组织结构或关系。",
    "如确有叙事价值，可在场景列表之前增加“## 局势推演（尚未发生）”，写一至数项可能的发展或主角不介入时的变化；没有价值时省略。局势推演只是创作参考，不是正史，不能写成已发生事实，不要模拟整个世界或强迫每个 NPC 行动。",
`全章目标篇幅约 ${input.maxWords} 个汉字，只是整体预期，不是填充任务。不要机械平均分配场景篇幅；根据情节、情绪和场景需要决定每场长短，场景自然结束时不为字数续写。`,
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
      "本场相关原文参考：先用于核实事实；同时观察其中与本场相近的叙事方法，例如视角距离、信息释放、动作与对白如何衔接、场景如何起落。只学习抽象方法，不复制原句、不做近义改写，也不把参考片段当作必须复现的情节模板：", sceneEvidence,
      "上一场正文的连续性上下文（重点承接人物位置、已知信息、关系变化、道具归属、未完成动作与场景结果，不得重复）：", previous,
      "写出自然完整的场景；人物可以行动、闲谈、观察、犹豫、误判或暂时无所事事。场景不必制造冲突、改变关系或推进主线；如果已经自然结束，就停在最合适的位置。",
      CREATIVE_FREEDOM_RULES,
      RHYTHM_RULE,
      "让句子和段落服从当前场景，不要为了场景之间看起来均衡而调整节奏。",
      "像小说家一样写，不要逐项执行蓝图。允许偏离场景预设，允许人物绕路、闲谈、误判、改变主意或做出当下看来无用的事；不要替每个细节安排象征意义或后续用途。叙事锋利来自准确的信息选择，不来自每段都要有冲突和结果。同一动作不必逐帧拆解，也不要在对白/动作已呈现潜台词后再解释一遍。",
      "避免模型化表达：不要替读者总结刚发生的事，不要重复解释动作已经表达的情绪，不要让人物把全部动机和背景讲清楚；避免每段都用对称句、抽象判断或警句式收尾。语言可以直接、粗粝、平实或舒展，不必句句显得漂亮。",
      "不复制原文句子，不以近义词替换改写原文；不写「未完待续」「本场结束」等标记。"
    ];
    let text = await cachedCall("scene-" + (index + 1), "02-scene-" + String(index + 1).padStart(2, "0") + ".md", "scene", scenePrompt);
    // A short scene is not evidence that it is incomplete; never pad it automatically.
    sceneTexts.push(text.trim());
    await saveStage(input.outputDir, `02-scene-${String(index + 1).padStart(2, "0")}.md`, text);
    console.log(`[write-long] 场景 ${index + 1}/${scenePlans.length} · ${chineseChars(text)} 汉字`);
  }

  const draft = sceneTexts.join("\n\n---\n\n");
  await saveStage(input.outputDir, "03-draft.md", draft);

  const polished: string[] = [];
  for (let index = 0; index < sceneTexts.length; index++) {
    const text = await cachedCall("polish-" + (index + 1), "05-polish-" + String(index + 1).padStart(2, "0") + ".md", "voice", [
      "角色：人物对话编辑兼叙事声音编辑。以原稿为基础做精修，不重新创作场景。只修订确有问题的对白与叙述表达，不改剧情事实、场景顺序、人物决定和信息揭示。",
      CREATIVE_FREEDOM_RULES, LIVING_VOICE_RULES,
      writingContext, "全章蓝图：", blueprint,
      `第 ${index + 1} 场当前正文：`, sceneTexts[index]!,
      "校准人物语气与知识边界，删解释性过强、所有人同一腔调的对白；统一视角与叙述距离。检查全章是否反复使用同一种停顿、否定式收束、动作切片或静物结尾；删并不增加信息/压力/判断的重复动作与解释。检查相邻句是否重复交代同一动作、心理是否被动作和旁白解释两次、对白是否把双方都知道的信息重新讲给读者。不要把“短、冷、克制”当作目标，允许准确的长句、直接判断和粗粝表达。",
      RHYTHM_RULE,
      "输出本场完整修订正文。以逐句、逐段编辑为主，不得为了让文字显得更丰富而扩写；不要新增原稿没有的情节节点、人物互动、对白轮次、动作链、背景设定或解释。只有原稿确有表达断裂、读者无法理解或必要情绪落点缺失时才补写。可以精简重复或解释过度的内容，但不能删掉有效动作、信息、人物互动或情绪落点；保留长句、清单与放慢段落，不得把全章改成短促腔。原文已经成立时可以原样保留，不得新增标题或创作说明。"
    ]);
    polished.push(text.trim());
    await saveStage(input.outputDir, `05-polish-${String(index + 1).padStart(2, "0")}.md`, text);
    console.log(`[write-long] 修订 ${index + 1}/${sceneTexts.length} · ${chineseChars(text)} 汉字`);
  }

  const polishDiagnostics = sceneTexts.map((before, index) => {
    const after = polished[index] ?? "";
    const beforeChars = chineseChars(before);
    const afterChars = chineseChars(after);
    return {
      scene: index + 1,
      beforeChars,
      afterChars,
      deltaChars: afterChars - beforeChars,
      deltaRatio: beforeChars ? Number(((afterChars - beforeChars) / beforeChars).toFixed(3)) : null
    };
  });
  // 逐场字数诊断只作观察记录：篇幅变化本身不构成改稿门槛，判断仍看文学效果。
  const totalBeforeChars = polishDiagnostics.reduce((sum, item) => sum + item.beforeChars, 0);
  const totalAfterChars = polishDiagnostics.reduce((sum, item) => sum + item.afterChars, 0);
  await saveStage(
    input.outputDir,
    "05-polish-diagnostics.json",
    JSON.stringify(
      {
        scenes: polishDiagnostics,
        totalBeforeChars,
        totalAfterChars,
        note: "诊断信息，不是篇幅门槛；扩写或精简都应结合文学效果判断。"
      },
      null,
      2
    )
  );

  const chapterTitle = "# " + (input.mode === "continuation" ? "续写章节" : "衍生章节") + "\n\n";
  const buildChapter = (): string => chapterTitle + polished.join("\n\n---\n\n") + "\n";
  const originalChapter = buildChapter();
  const patchRaw = await cachedCall("literary-patches", "06-literary-patches-raw.json", "voice", [
    literaryPatchPrompt({ brief: input.brief, blueprint, styleProfile: input.styleProfile, chapter: originalChapter })
  ], output => { parseLiteraryPatchResult(output); });
  const patchResult = parseLiteraryPatchResult(patchRaw);
  const patchApplication = applyLiteraryPatches(originalChapter, patchResult.edits);
  const antiAiChapter = patchApplication.chapter;
  await saveStage(input.outputDir, "06-literary-patches-applied.json", JSON.stringify({
    decision: patchResult.decision,
    reason: patchResult.reason,
    applied: patchApplication.applied,
    rejected: patchApplication.rejected
  }, null, 2));
  await saveStage(input.outputDir, "06b-anti-ai-edited.md", antiAiChapter);

  const reviewHistory: string[] = [];
  const reviewed = await reviewAndRepair({
    initialChapter: antiAiChapter,
    sceneCount: sceneTexts.length,
    maxRepairRounds: 1,
    review: async (candidate, correction) => {
      const round = reviewHistory.length + 1;
      let parsed: ReturnType<typeof parseChapterReview> | undefined;
      await cachedCall("final-review-" + round + (correction ? "-retry" : ""), "08-final-review-round-" + round + (correction ? "-retry" : "") + "-raw.txt", "review", [
        reviewPrompt({ context: writingContext, blueprint, chapter: candidate, sceneCount: sceneTexts.length, correction })
      ], output => { parsed = parseChapterReview(output, candidate, sceneTexts.length); });
      if (!parsed) throw new Error("Final review produced no parsed result.");
      // 分场做硬约束检查，命中项带场景号，修复阶段才能定位。
      const lawIssues = polished.flatMap((text, index) => ironLawIssues(checkIronLaws(text, laws), [index + 1]));
      return JSON.stringify(withDeterministicIssues(parsed, lawIssues));
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
          console.log("[write-long] 已在大纲层修订蓝图：场景 " + affectedScenes.join("、"));
        }
      }
      for (const sceneNumber of affectedScenes) {
        const sceneIssues = issues.filter(issue => issue.scenes.includes(sceneNumber));
        const index = sceneNumber - 1;
        const currentScene = polished[index];
        if (currentScene === undefined) throw new Error("Review referenced a missing scene: " + sceneNumber);
        const revised = await cachedCall("scene-repair-" + sceneNumber + "-round-" + round, "05-polish-" + String(sceneNumber).padStart(2, "0") + "-repair-" + round + ".md", "voice", [
          "角色：场景修复编辑。只修复指定场景中的实质问题，输出本场完整正文，不得输出解释或标题。不得借修复之名增加戏剧性、补齐场景结构或推动原本无需推进的情节。",
          CREATIVE_FREEDOM_RULES, writingContext,
          "全章蓝图：", blueprint,
          "本场蓝图（如有修订以修订版为准）：", currentPlans[index] ?? "",
          "本轮最终审查发现的必改项：", JSON.stringify(sceneIssues, null, 2),
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
  if (input.readerExperience) try {
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
  console.log("[write-long] 成稿 " + metrics.chars + " 汉字 · 均句长 " + metrics.mean + " · 长句 " + (metrics.long * 100).toFixed(1) + "% · 自动修复 " + reviewed.repairRounds + " 轮");

  // 状态提取的 JSON 结构示例，发给模型作字段说明；写全每字段的取值约定，避免模型自造含义。
  const statePrompt = [
    "角色：小说连续性资料管理员。根据旧状态和最终章节提取状态变化。",
    "只输出合法 JSON 对象，不要 Markdown 代码围栏。结构：",
    JSON.stringify({
      currentPosition: "string",
      canonFacts: [{
        id: "stable-id", fact: "fact", source: "chapter id",
        confidence: "confirmed|inferred|original"
      }],
      characters: [{
        name: "name",
        profile: {
          coreTraits: ["stable traits"], values: ["values"],
          contradictions: ["internal contradictions"],
          voice: "distinctive voice", boundaries: ["behavioral boundaries"],
          arc: "long-term arc"
        },
        status: "current status",
        location: "current location",
        abilities: ["current abilities"],
        knowledge: ["current knowledge with source/limits when useful"],
        goals: ["current goals"],
        motivation: "why these goals matter now",
        resources: ["currently available means"],
        constraints: ["actual limits"],
        currentPressure: ["current pressures"],
        decisionHistory: ["consequential decisions already made"],
        relationships: ["current relationships"],
        arcMilestones: [{
          id: "stable-milestone-id", chapter: "chapter id",
          change: "what changed", evidence: "exact excerpt from final chapter",
          choice: "optional, only if naturally clear",
          pressure: "optional, only if naturally clear",
          cost: "optional, only if naturally clear"
        }]
      }],
      events: [{
        id: "stable-id", summary: "event", position: "story position",
        participants: ["name"],
        causes: ["prior event id or concise causal condition"],
        consequences: ["consequence"],
        relatedPlotThreads: ["related plot thread id"],
        origin: "canon|inferred|original", source: "source reference"
      }],
      plotThreads: [{
        id: "stable-id", title: "thread", status: "open|active|resolved|abandoned",
        lastUpdated: "chapter id", notes: "latest state"
      }],
      foreshadowingUpdates: [{
        id: "stable-clue-id:chapter", clueId: "stable-clue-id", clue: "线索内容",
        status: "planted|reinforced|misdirected|partially_revealed|revealed|resolved|abandoned|uncertain",
        chapter: "chapter id",
        change: "本章对线索生命周期造成的变化",
        relatedThreadIds: ["plot-thread-id"],
        evidence: "exact excerpt from final chapter"
      }],
      macguffinUpdates: [{
        id: "stable-macguffin-id:chapter", macguffinId: "stable-macguffin-id",
        name: "关键物件/目标/信息",
        status: "introduced|sought|located|held|transferred|lost|destroyed|secured|irrelevant|uncertain",
        chapter: "chapter id",
        change: "本章发生的状态变化",
        holder: "optional current holder",
        location: "optional current location",
        relatedThreadIds: ["plot-thread-id"],
        evidence: "exact excerpt from final chapter"
      }],
      relationshipUpdates: [{
        id: "stable-relation-id:chapter", relationId: "stable-relation-id",
        from: "人物甲", to: "人物乙", label: "旧友/敌对/师徒等关系类型",
        chapter: "chapter id",
        change: "本章真实发生的互动或关系变化",
        evidence: "exact excerpt from final chapter"
      }],
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
    await saveStage(input.outputDir, "07-state-update.json", JSON.stringify(nextState, null, 2));
    await commitStoryStateAndArc({ statePath: input.statePath, previousState: state, nextState, applyState: input.applyState, storyArcPath: input.storyArcPath, storyArcText: storyArc });
  } catch (error) {
    await saveStage(input.outputDir, "07-state-update-error.txt", String(error) + "\n\n" + stateText);
    throw new Error("Chapter was generated, but story-state persistence failed. See 07-state-update-error.txt; do not start the next chapter.");
  }
  return chapter;
}
