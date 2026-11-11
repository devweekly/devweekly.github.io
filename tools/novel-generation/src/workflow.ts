// 普通章节流水线：主线架构师/创意发散并行 → 主编蓝图 → 正文 → 保守局部文学 Patch →
// 一次硬伤终审与最多一轮修复 → 可选 Reader → 状态提交。
// 各阶段按职责裁剪上下文：创意阶段不给逐条证据，对白编辑只看人物状态，只有事实核对类
// 阶段才保留证据材料。每阶段走 stage-cache 指纹缓存；未通过终审不写 Story State。
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { commitStoryStateAndArc, parseStoryStateUpdate, type StoryState } from "./story-state.js";
import { runAgentText, resolveModelAttempts, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { formatReview, parseChapterReview, reviewAndRepair, reviewPrompt, withDeterministicIssues } from "./chapter-review.js";
import { checkIronLaws, ironLawIssues, loadIronLaws } from "./iron-laws.js";
import { loadRunStoryState, runCachedStage } from "./stage-cache.js";
import { parseJsonObject } from "./model-json.js";
import { LONG_CHAPTER_SOURCE_TAIL_CHARS } from "./constants.js";
import { buildRecentEventContinuityContext, buildWorldSituationContext } from "./world-situation.js";
import { CREATIVE_FREEDOM_RULES, LIVING_VOICE_RULES, literaryPatchPrompt, parseLiteraryPatchResult, applyLiteraryPatches, readerExperiencePrompt } from "./literary-edit.js";
/**
 * Build a compact retrospective from body-evidenced character milestones.
 * It is creative context for the rolling planner, never a personality constraint.
 */
export function buildCharacterArcRetrospective(state: StoryState, taskText: string): string {
  const candidates = state.characters
    .filter(character => (character.arcMilestones?.length ?? 0) > 0)
    .filter(character => taskText.includes(character.name));
  const selected = (candidates.length ? candidates : state.characters.filter(character => (character.arcMilestones?.length ?? 0) > 0)).slice(0, 8);
  if (!selected.length) return "";
  const sections = selected.map(character => {
    const rows = (character.arcMilestones ?? []).slice(-8).map(item => [
      "- " + item.chapter + "：" + item.change,
      item.choice ? "选择：" + item.choice : "",
      item.pressure ? "压力：" + item.pressure : "",
      item.cost ? "代价：" + item.cost : "",
      "正文证据：" + item.evidence
    ].filter(Boolean).join("；"));
    return "### " + character.name + "\n" + rows.join("\n");
  });
  return [
    "以下是从已完成章节正文中提取、带原文证据的跨章人物变化记录。请把它们当作理解人物历史的材料，而不是性格模板或后续剧情合同。",
    ...sections,
    "请留意人物行为中的反复、矛盾、转向、关系变化、选择代价和尚未解决的内在张力；可以提出反常但可信的下一步、意外选择或高光时刻，也可以判断人物需要停留、退缩或暂时不发展。不要强行安排成长，不要为了保持一致而禁止改变，更不能把可能性写成已发生事实。"
  ].join("\n\n");
}


export function buildCommonWritingContext(
  input: Pick<WriteWorkflowInput, "worldBible" | "contextText" | "retrievedContext" | "writingBrief" | "storyPlanText" | "storyArcText" | "storyAnalysisContext" | "sourceText" | "styleProfile" | "mode" | "brief">,
  state: StoryState,
  worldSituation: string
): string {
  return [
    "世界设定：", input.worldBible,
    "当前故事状态（已有记录优先；不得擅自改写已确认事实）：", JSON.stringify(state, null, 2),
    worldSituation ? "本章相关人物与局势上下文（用于理解当前局面，不是新增正史）：\n" + worldSituation : "",
    "事实来源说明：canonFacts.confidence=confirmed 表示原著已确认，inferred 表示基于原文的推断，original 表示项目原创。项目原创事实可在续写中承接，但不得伪装成原著事实。",
    input.contextText ? "用户补充的前文摘要：\n" + input.contextText : "",
    input.retrievedContext ? "本地原文检索材料（首先用于核实事实；正文写作时也可观察其中与当前场景相关的叙事方法，如视角距离、信息释放、动作与对白的组织，但不得复制句子、近义改写或把参考片段当作情节模板）：\n" + input.retrievedContext : "",
    input.writingBrief ? "全书知识库（已经写成的事实与未收线，优先于分析参考）：\n" + input.writingBrief : "",
    input.storyPlanText ? input.storyPlanText : "",
    input.storyArcText ? "当前滚动式多章节 Story Arc（优先承接已发生事实；未执行章节可调整）：\n" + input.storyArcText : "",
    input.storyAnalysisContext ? "既有小说分析参考（仅供启发，不是正史或写作清单）：\n" + input.storyAnalysisContext : "",
    input.sourceText ? "用户提供且有权使用的续写材料：\n" + input.sourceText : "",
    input.styleProfile ? "本项目叙事风格参考（仅使用抽象写作特征，不模仿特定作者的独特表达；参考不能凌驾于当前人物、场景需要和文学表达）：\n" + input.styleProfile : "",
    input.mode === "continuation" ? "创作模式：续写。严格承接用户提供的合法文本和当前故事状态。" : "创作模式：原创衍生。不得把项目原创内容伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");
}

export interface WriteWorkflowInput {
  worldId: string;
  /** 世界资料目录，默认 worlds/<worldId>。 */
  worldDir?: string;
  mode: GenerationMode;
  brief: string;
  worldBible: string;
  styleProfile?: string;
  sourceText?: string;
  contextText?: string;
  retrievedContext?: string;
  storyAnalysisContext?: string;
  writingBrief?: string;
  storyPlanText?: string;
  storyArcText?: string;
  model?: string;
  strictModel?: boolean;
  maxWords: number;
  outputDir: string;
  statePath: string;
  storyArcPath?: string;
  applyState: boolean;
  /** Optional blind-reader feedback; disabled in normal one-click chapter generation. */
  readerExperience?: boolean;
}

function extractJson(text: string): unknown {
  try {
    return parseJsonObject(text);
  } catch (error) {
    throw new Error("Model did not return a JSON object for story-state update: " + String(error));
  }
}

function normalizeStateText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
      .replace(/[\s"'“”‘’「」『』，。！？、；：,.!?;:（）()【】\[\]《》]/g, "");
}

export const MAX_ACTIVE_CONTINUITY_NOTES = 40;

export function dedupeContinuityNotes(notes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const note of notes) {
    const normalized = note.normalize("NFKC").toLocaleLowerCase()
      .replace(/[\s"'“”‘’「」『』，。！？、；：,.!?;:（）()【】\[\]《》]/g, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(note.trim());
  }
  // continuityNotes is the active writing snapshot, not an audit history.
  // Keep the newest unique constraints so older notes cannot crowd out current facts.
  return result.slice(-MAX_ACTIVE_CONTINUITY_NOTES);
}

export function mergeStoryState(current: StoryState, update: Partial<StoryState>): StoryState {
  const mergeBy = <T extends object>(oldItems: T[], newItems: T[], key: (item: T) => string): T[] => {
    const map = new Map(oldItems.map(item => [key(item), item]));
    for (const item of newItems) {
      const id = key(item);
      const previous = map.get(id);
      if (previous && typeof previous === "object" && typeof item === "object") {
        const merged = { ...(previous as unknown as Record<string, unknown>), ...(item as unknown as Record<string, unknown>) };
        for (const [field, value] of Object.entries(item as unknown as Record<string, unknown>)) {
          // State fields are snapshots, not append-only logs: a new location, goal or
          // relationship list replaces the previous value. Profile objects merge one level.
          if (field === "arcMilestones" && Array.isArray(value)) {
            const previousMilestones = Array.isArray((previous as unknown as Record<string, unknown>)[field])
              ? (previous as unknown as Record<string, unknown>)[field] as Array<Record<string, unknown>>
              : [];
            const milestones = new Map<string, Record<string, unknown>>();
            for (const milestone of previousMilestones) {
              if (typeof milestone.id === "string") milestones.set(milestone.id, milestone);
            }
            for (const milestone of value as Array<Record<string, unknown>>) {
              if (typeof milestone.id === "string") milestones.set(milestone.id, milestone);
            }
            merged[field] = [...milestones.values()];
          } else if (Array.isArray(value)) merged[field] = [...value];
          else if (value && typeof value === "object" && !Array.isArray(value)) {
            const oldNested = (previous as unknown as Record<string, unknown>)[field];
            merged[field] = { ...(oldNested && typeof oldNested === "object" ? oldNested as object : {}), ...(value as object) };
          }
        }
        map.set(id, merged as unknown as T);
      } else map.set(id, item);
    }
    return [...map.values()];
  };
  return {
    ...current,
    currentPosition: update.currentPosition || current.currentPosition,
    // A fact first introduced by generated prose is project-original. A model
    // cannot promote it to canon merely by returning confidence="confirmed".
    canonFacts: mergeBy(current.canonFacts, (update.canonFacts ?? []).map(item => {
      const previous = current.canonFacts.find(existing => existing.id === item.id);
      return { ...item, confidence: previous && normalizeStateText(previous.fact) === normalizeStateText(item.fact) ? previous.confidence : "original" };
    }), item => item.id),
    characters: mergeBy(current.characters, update.characters ?? [], item => item.name.trim().toLocaleLowerCase()),
    // Preserve provenance for existing events; newly generated events are original.
    events: mergeBy(current.events, (update.events ?? []).map(item => {
      const previous = current.events.find(existing => existing.id === item.id);
      return { ...item, origin: previous && normalizeStateText(previous.summary) === normalizeStateText(item.summary) ? previous.origin : "original" };
    }), item => item.id),
    plotThreads: mergeBy(current.plotThreads, update.plotThreads ?? [], item => item.id),
    // Lifecycle observations are append-only events; stable IDs make resumed runs idempotent.
    foreshadowingUpdates: mergeBy(current.foreshadowingUpdates ?? [], update.foreshadowingUpdates ?? [], item => item.id),
    macguffinUpdates: mergeBy(current.macguffinUpdates ?? [], update.macguffinUpdates ?? [], item => item.id),
    relationshipUpdates: mergeBy(current.relationshipUpdates ?? [], update.relationshipUpdates ?? [], item => item.id),
    // Current active notes are a snapshot, not an append-only history.
    continuityNotes: dedupeContinuityNotes(update.continuityNotes ?? current.continuityNotes),
    updatedAt: new Date().toISOString()
  };
}

async function saveStage(dir: string, name: string, content: string): Promise<void> {
  await writeFile(resolve(dir, name), content.trim() + "\n", "utf8");
}

/** 文风数据仅作为弱参考，不形成写作配额或自动修订目标。 */
export const RHYTHM_RULE = [
  "写作首先服务于人物、情绪、场景和阅读体验。句子可以长、可以短，段落可以舒展、可以急促，按当前叙事需要自然决定。",
  "语料统计只是观察到的倾向，不是目标值，不需要刻意接近；不得为调整句长、段落、对白比例或标点而改动原本有感染力的表达。",
  "不要把叙事写成设定说明、剧情摘要或分析报告。让信息从人物行动、交谈、误解、观察和后果中自然出现。",
  "文风修订的任务是提升自然度、画面感、情绪和人物声音；如果原文已经有效，不要为了显示编辑工作而改写。"
].join("\n");

export async function writeChapter(input: WriteWorkflowInput): Promise<string> {
  const state = await loadRunStoryState(input.statePath, input.worldId, input.outputDir, "write");
  const profiles = readTaskProfiles();
  const laws = loadIronLaws(input.worldDir ?? resolve("worlds", input.worldId));
  const call = (stage: StageKey, parts: string[]): Promise<string> => {
    const trace: import("./generate.js").AgentTextTrace = {
      attempts: [], context: { worldId: input.worldId, runId: basename(input.outputDir), outputDir: input.outputDir, kind: "chapter", stage }
    };
    return runAgentText(parts.join("\n\n"), input.model, undefined, profiles[stage], !input.strictModel, trace);
  };
  const cachedCall = (key: string, outputFile: string, stage: StageKey, parts: string[], validate?: (output: string) => void): Promise<string> => {
    const prompt = parts.join("\n\n");
    return runCachedStage({
      dir: input.outputDir, key, outputFile,
      fingerprint: JSON.stringify({ prompt, modelAttempts: resolveModelAttempts(input.model, !input.strictModel), profile: profiles[stage], strictModel: input.strictModel ?? false }),
      execute: () => call(stage, parts),
      validate
    });
  };
  await mkdir(input.outputDir, { recursive: true });
  if (input.retrievedContext) await saveStage(input.outputDir, "00-retrieval.md", input.retrievedContext);
  const situationQuery = [input.brief, state.currentPosition, input.contextText, input.sourceText?.slice(-LONG_CHAPTER_SOURCE_TAIL_CHARS), input.retrievedContext, input.writingBrief, input.storyPlanText, input.storyAnalysisContext].filter(Boolean).join("\n");
  const worldSituation = buildWorldSituationContext(state, situationQuery);
  const recentEventContext = buildRecentEventContinuityContext(state);
  if (worldSituation) await saveStage(input.outputDir, "00-world-situation-context.md", worldSituation);
  if (recentEventContext) await saveStage(input.outputDir, "00-recent-event-context.md", recentEventContext);
  const planningSituation = [worldSituation, recentEventContext].filter(Boolean).join("\n\n");

  const common = buildCommonWritingContext(input, state, planningSituation);

  // 不同阶段只接收完成当前任务所需的上下文。完整事实包仍用于规划、正文和终审；
  // 创意发散不需要逐条原文证据，编辑阶段也不应反复携带整份语料与续写材料。
  const taskText = [input.brief, input.contextText, input.writingBrief, input.storyPlanText, planningSituation].filter(Boolean).join("\n");
  const relevantCharacters = state.characters.filter(character => taskText.includes(character.name));
  const characterArcRetrospective = buildCharacterArcRetrospective(state, taskText);
  const relevantThreads = state.plotThreads.filter(thread =>
    taskText.includes(thread.title) || taskText.includes(thread.id)
  );
  const creativeContext = [
    "世界设定：", input.worldBible,
    input.styleProfile ? "本项目叙事风格参考（仅作抽象创作参考，不模仿特定作者的独特表达；不得压过当前创意与文学表达）：\n" + input.styleProfile : "",
    "当前位置：", state.currentPosition,
    input.contextText ? "前情摘要：\n" + input.contextText : "",
    input.writingBrief ? "相关既成事实、人物和未收线：\n" + input.writingBrief : "",
    input.storyPlanText ? input.storyPlanText : "",
    recentEventContext ? "最近已发生事件（用于避免机械重复，允许有效呼应）：\n" + recentEventContext : "",
    input.storyArcText ? "当前滚动式多章节 Story Arc：\n" + input.storyArcText : "",
    input.brief ? "本次创作任务：\n" + input.brief : ""
  ].filter(Boolean).join("\n\n");
  const dialogueContext = [
    input.styleProfile ? "本项目叙事风格参考（仅作抽象参考，不模仿特定作者的独特表达；人物当下的情绪、关系和场景需要优先）：\n" + input.styleProfile : "",
    "当前位置：", state.currentPosition,
    "本章涉及的人物当前状态：", JSON.stringify(relevantCharacters, null, 2),
    "本章涉及的情节线：", JSON.stringify(relevantThreads, null, 2),
    planningSituation ? "当前局势、已发生事件与重复情节提醒：\n" + planningSituation : "",
    "当前有效连续性备注：", state.continuityNotes.join("\n"),
    input.contextText ? "必要前情：\n" + input.contextText : "",
    input.writingBrief ? "相关人物、关系与既成事实：\n" + input.writingBrief : "",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");
  const voiceContext = [
    input.styleProfile ? "本项目叙事风格参考（仅作抽象参考，不模仿特定作者的独特表达）：\n" + input.styleProfile : "",
    input.contextText ? "必要前情：\n" + input.contextText : "",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  // 主线架构与创意发散并行；主编决定哪些点子能进正文，发散本身不构成正史。
  // 中期 Story Arc 是长期方向与单章蓝图之间的因果层。每次续写滚动校准未来章节，
  // 不把旧计划当合同；已发生正文和事实优先，文学性优先于计划完成率。
  const previousArc = input.storyArcText?.trim() ?? "";
  const storyArc = await cachedCall("story-arc", "00-story-arc.md", "plan", [
    "角色：中期故事架构师。为接下来一段故事设计可调整的方向，跨度由当前情节自然决定；若现有阶段尚未自然结束，延续并修订它，不要无故另起炉灶。",
    "分层展开：如果长期 Story Plan 提供了重大节点，先结合当前已发生事实识别正在推进或最近的未完成节点，只把当前节点及必要的相邻因果展开成近期 Story Arc；更远节点保留方向性摘要，不预先细化成整串章节。若当前剧情已自然偏离某节点，以已提交事实为准，调整未来路径，不得 retcon。",
    common,
    "既有 Story Arc（可能为空）：", previousArc || "尚无中期故事阶段，请从当前局势自然推演。",
    characterArcRetrospective ? "跨章人物弧光回顾（仅供创意启发）：\n" + characterArcRetrospective : "",
    CREATIVE_FREEDOM_RULES,
    "结合已发生事件、人物目标与选择、资源/信息变化、开放情节线，设计一段可供连续写作的故事推进。只记录真正值得预先考虑的少数阶段节点，不要求凑足章节数，也不要求每个节点都包含冲突、关系变化或悬念。可指出哪些人物/伏笔/主线可以暂时不推进、哪些章节可以只是日常或过渡、可能的意外转折空间，以及下一章自然可能从哪里开始。不要强制人物弧光，不要把人物固定为善恶标签，不要预先写死角色选择；节点可以合并、拆分、跳过或被正文发展推翻。",
    "文学性、文笔、艺术风格高于其他。故事规划只为因果连续性服务，不是待完成清单。"
  ], output => { if (!output.trim()) throw new Error("Story Arc is empty."); });
  if (previousArc) await saveStage(input.outputDir, "00-story-arc-previous.md", previousArc);
  await saveStage(input.outputDir, "00-story-arc.md", storyArc);

  const [plotPlan, ideas] = await Promise.all([
    cachedCall("plot", "01-main-plot.md", "plot", [
      "角色：小说构思编辑。理解本章与长篇主线的关系，但不要求本章必须推进主线；不写正文。",
      common,
      "中期 Story Arc：", storyArc,
      "提出有吸引力的章节构想，帮助这一章真正好看、能让人物活起来。可考虑主线、人物关系、冲突、悬念、意外性和后续空间，但不要求每项都出现；允许从一个鲜活场景、一段对话或一个反常细节自然生长。",
      "不要把氛围转化为必须完成的感官清单，不要预先指定气味、湿度、光线、声音、天气、比喻或拟人；只描述场景的叙事作用、人物处境和确实不可改变的事实。具体观察由小说家在人物视角中自然选择。",
      "先结合当前 Story State、人物状态、已发生事件及其因果关系，理解本章涉及的局势。只推演确有叙事价值的少数人物或势力：他们为什么行动、各自知道什么、能调用什么资源、受到什么限制，以及主角不介入时局势是否会变化。势力目标与资源以 World Bible 和已有事实为依据；资料不足时保留未知，不补造组织结构或关系。",
      "如有价值，在输出中用“局势推演（尚未发生）”单独标出一至数项可能发展，再提出本章主线方向；没有有价值的推演时可以省略。推演是待选的创作素材，不是正史，不能把可能性写成已发生事实。人物只能依据自己实际知道的信息行动；不得模拟整个世界、强制 NPC 行动或套用游戏数值和回合规则。",
      CREATIVE_FREEDOM_RULES,
      "行动应有可信原因和可能代价，但不要套用游戏数值、回合制或固定的目标—阻力—选择—后果模板。只标出确实不能改变的已知事实，不要把创意写成分析报告。"
    ]),
    cachedCall("creative", "02-creative-options.md", "creative", [
      "角色：创意发散 Agent。提出不同方向的创作可能性，不负责决定正史，也不要求每个点子都服务主线。",
      CREATIVE_FREEDOM_RULES, creativeContext,
      "优先提出 3 个真正不同的创作方向；差异必须来自不同的事件机制、人物选择、信息差或冲突来源，不能只是同一剧情换措辞。若只有 1～2 个方向确实有价值，就少给，不为凑数制造平庸点子。至少尝试一个不沿着当前大纲最显然路径发展的可能性，但必须符合人物当下的知识、欲望、资源与处境。可以组合、改造或全部否决；不要写正文，不要把建议当作已发生事实。"
    ])
  ]);
  await saveStage(input.outputDir, "01-main-plot.md", plotPlan);
  await saveStage(input.outputDir, "02-creative-options.md", ideas);

  const plan = await cachedCall("plan", "03-chapter-plan.md", "plan", [
    "角色：小说主编。整合中期方向、主线构思和创意备选，提供本章可偏离的创作蓝图，不替小说家决定每个场景的具体走向。",
    "中期 Story Arc：", storyArc,
    common,
    "主线方案：", plotPlan, "创意备选：", ideas,
    CREATIVE_FREEDOM_RULES,
    "选择最有小说感染力的方向，但不要把章节收束成唯一正确的执行方案。蓝图是可偏离的参考，不是逐项验收合同；允许保留未解决的问题、闲笔、生活场景和没有明确结论的段落。只写必须承接的事实与少量重要锚点；场景不必逐一承担目标、阻力、行动、信息变化和结果。人物知识必须受其实际经历和信息来源限制；不得无意违反已确认事实；区分确知内容与新创作。",
    "蓝图只记录场景从哪里开始、人物大致处境，以及确实不能丢失的事实或戏剧锚点。只有本场自然存在时才写欲望、压力、冲突、信息差、选择及后果；允许场景没有明显冲突或结果，也允许纯粹的日常、闲谈、观察、过渡和氛围场景。不要替小说家编排逐帧动作、解释心理或指定句子；其他细节留给正文生成时自然发现。",
    "不要将某种气味、湿度、声音、景物或修辞指定为场景必须出现的素材；氛围只说明读者需要理解的处境，不规定小说家如何描写。",
    "每个场景可以没有戏剧锚点；有锚点时只保留真正不可丢失的部分。不要用“沉默”“停顿”等姿态词机械制造文学感，但也不要因为它们没有推进情节就删除真实、自然的沉默。不要预先规定短句、断行、留白或冷峻语气。",
  ]);
  await saveStage(input.outputDir, "03-chapter-plan.md", plan);

  const initialDraft = await cachedCall("scene", "04-scene-draft.md", "scene", [
    "角色：小说家。根据蓝图与当前人物处境写章节正文，不输出分析。蓝图允许偏离，不要求逐项兑现。",
    CREATIVE_FREEDOM_RULES, LIVING_VOICE_RULES, common, "最终章节蓝图：", plan,
    "目标篇幅约 " + input.maxWords + " 个中文字符，仅作整体预期，不是必须命中的配额。重要事件可以充分展开；日常、过渡和重复过程可以自然概述。不要为了达到字数而添加场景、动作、心理解释或对白。",
    "像小说家一样写，不要像舞台监督一样执行蓝图。蓝图中的建议可以合并、替换、省略或发展出新方向，只要不破坏已发生事实和必要连续性。不是每个场景都要推进情节或制造悬念；不要把普通生活强行解释成伏笔、成长或象征。叙事锋利来自准确选择，不来自每段都要有意义的压力。",
    "同一动作只写到足以让读者看清并感受到后果；不要把准备、迟疑、伸手、触碰、收手拆成一串没有新增信息的句子。不要在对白/动作已呈现潜台词后，再替读者解释一遍。段落可以承担推进、质感、停留、过渡或留白，不要求每段都产生信息增量；不要靠反复否定和静物收束拖长。",
    "原文检索片段是本场景的参考材料：优先学习其叙述距离、信息取舍、动作/对白衔接和场景节奏，不借用原句或独特措辞；若片段与本场景功能不同，只参考通用叙事方法，不强行套用。",
    "避免常见的模型化表达：不要替读者总结刚刚发生的事，不要重复解释人物已通过行动表达的情绪，不要让人物完整说出自己全部动机；避免每段都用对称句、抽象判断或警句式收尾。表达可以直接、粗粝、平实或舒展，不必句句显得漂亮。",
    RHYTHM_RULE
  ]);
  await saveStage(input.outputDir, "04-scene-draft.md", initialDraft);

  // 单次、局部、可验证的文学编辑。默认保留正文，不再运行整章重写、
  // Anti-AI 诊断、整章 Anti-AI 改写和整章复核这四个互相叠加的环节。
  const patchRaw = await cachedCall("literary-patches", "05-literary-patches-raw.json", "voice", [
    literaryPatchPrompt({ brief: input.brief, blueprint: plan, styleProfile: input.styleProfile, chapter: initialDraft })
  ], output => { parseLiteraryPatchResult(output); });
  const patchResult = parseLiteraryPatchResult(patchRaw);
  const patchApplication = applyLiteraryPatches(initialDraft, patchResult.edits);
  const literaryDraft = patchApplication.chapter;
  await saveStage(input.outputDir, "05-literary-patches-applied.json", JSON.stringify({
    decision: patchResult.decision,
    reason: patchResult.reason,
    applied: patchApplication.applied,
    rejected: patchApplication.rejected
  }, null, 2));
  await saveStage(input.outputDir, "05-literary-edited.md", literaryDraft);

  const reviewHistory: string[] = [];
  const reviewed = await reviewAndRepair({
    initialChapter: literaryDraft,
    maxRepairRounds: 1,
    review: async (candidate, correction) => {
      const round = reviewHistory.length + 1;
      let parsed: ReturnType<typeof parseChapterReview> | undefined;
      await cachedCall("quality-review-" + round + (correction ? "-retry" : ""), "07-review-round-" + round + (correction ? "-retry" : "") + "-raw.txt", "review", [
        reviewPrompt({ context: common, blueprint: plan, chapter: candidate, correction })
      ], output => { parsed = parseChapterReview(output, candidate); });
      if (!parsed) throw new Error("Quality review produced no parsed result.");
      // 数值、位阶这类能机器判定的硬约束先于模型意见进入必改项。
      const lawIssues = ironLawIssues(checkIronLaws(candidate, laws));
      return JSON.stringify(withDeterministicIssues(parsed, lawIssues));
    },
    repair: (candidate, issues, round) => cachedCall("quality-repair-" + round, "07-repaired-round-" + round + ".md", "final", [
      "角色：主编修复 Agent。根据结构化审查结果执行最小范围修复，只输出完整章节正文。不得借修复之名增加戏剧性、补齐场景结构或推动原本无需推进的情节。",
      CREATIVE_FREEDOM_RULES, common, "最终章节蓝图：", plan,
      "当前章节正文：", candidate,
      "必须处理的问题：", JSON.stringify(issues, null, 2),
      "本轮为第 " + round + " 次自动修复。只修复 blocker/major，保留无关段落、已经成立的对白和叙事节奏；不采纳主观偏好，不新增未经铺垫的设定、人物行为或反转。修复必须解决证据所指问题。",
      RHYTHM_RULE
    ]),
    onReview: async (round, candidate, report) => {
      const formatted = formatReview(report);
      reviewHistory.push("## 复查轮次 " + (round + 1) + "\n\n" + formatted);
      await saveStage(input.outputDir, "07-continuity-review-round-" + (round + 1) + ".json", JSON.stringify(report, null, 2));
    },
    onFailure: async (chapter, reviews, reason) => {
      await saveStage(input.outputDir, "chapter-blocked.md", chapter);
      await saveStage(input.outputDir, "09-quality-summary.json", JSON.stringify({
        status: "blocked", reason, reviews
      }, null, 2));
      console.error("[write] 终审仍有未解决硬伤，成稿已保留为 chapter-blocked.md；本次运行安全失败，故事状态未更新。");
    }
  });
  const chapter = reviewed.chapter;
  await saveStage(input.outputDir, "07-continuity-review.md", reviewHistory.join("\n\n---\n\n"));
  await saveStage(input.outputDir, "chapter.md", chapter);
  await saveStage(input.outputDir, "09-quality-summary.json", JSON.stringify({
    status: "passed",
    repairRounds: reviewed.repairRounds,
    reviews: reviewed.reviews
  }, null, 2));

  // Blind-reader feedback is useful for deliberate evaluation, but is not required for every chapter.
  if (input.readerExperience) try {
    const readerReport = await cachedCall("reader-experience", "10-reader-experience.md", "reader", [
      readerExperiencePrompt({ brief: input.brief, chapter })
    ], output => { if (!output.trim()) throw new Error("Reader returned an empty report."); });
    await saveStage(input.outputDir, "10-reader-experience.md", readerReport);
  } catch (error) {
    await saveStage(input.outputDir, "10-reader-experience-error.txt", String(error));
    console.error("[write] Reader 体验评估未完成；不影响章节通过与状态提交。");
  }

  const statePrompt = [
    "角色：小说连续性资料管理员。根据旧状态和最终章节提取本章状态变化。",
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
          voice: "distinctive voice",
          boundaries: ["what this character will not easily do"],
          arc: "current long-term character arc"
        },
        status: "current status",
        location: "current location",
        abilities: ["current abilities"],
        knowledge: ["current known information with source/limits when useful"],
        goals: ["current goals"],
        motivation: "why these goals matter now",
        resources: ["currently available means"],
        constraints: ["actual limits"],
        currentPressure: ["pressures currently affecting choices"],
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
    "旧状态：", JSON.stringify(state, null, 2), "最终章节：", chapter,
    "continuityNotes 必须返回章节结束时仍然有效的完整备注集合，不是只列新增项；已经变化、解决或被新事实替代的旧备注不要继续返回。人物 profile 是相对稳定的性格底色、价值观、内在矛盾、语言习惯与行为边界；不要因单次情绪或行为轻易改写。character 的 status/location/abilities/knowledge/goals/motivation/resources/constraints/currentPressure/decisionHistory/relationships 是当前剧情状态，必须反映本章结束时有正文依据的最新快照；数组字段给出完整当前值而非只追加变化项。motivation 说明目标背后的当前原因；resources 只记录实际可调用资源；constraints 记录确实影响行动的限制；currentPressure 记录当前压力；decisionHistory 只保留少量重要决定，不写流水账。人物可以变化、反复、倒退、误判，也可以做出出乎意料的选择；不要把人物锁死成标签。状态提取只记录正文已经发生的事，不得要求正文为了状态字段而解释动机或安排代价。只记录章节明确支持的内容。本次最终章节是项目续写文本，不是原著原文；首次由本章引入的事实必须标为 original，不能因叙述确定就标 confirmed。只有与旧状态中同一事实 ID、同一事实内容相符的原著事实才保留原有来源等级；无法确认的内容不要写入 canonFacts，推断标为 inferred。新事件默认 origin=original；只有明确回指原著资料的事件才标 canon/inferred 并填写 source。人物和情节线只输出本章新增或发生变化的记录。只有正文自然呈现重要转折时才追加 arcMilestones；不要为了填写字段而拔高普通情节或反向要求正文增加解释。伏笔只有在正文确实埋设、强化、误导、揭示、回收或放弃时才追加 foreshadowingUpdates；不要把普通细节过度解释成伏笔，不要为了回收而改写剧情。MacGuffin 只有在重要目标、物件或信息的持有者、位置、可获得性或叙事作用确实变化时才追加 macguffinUpdates。两类更新均须引用最终正文中的逐字证据；没有变化就返回空数组，不要求每章必须有更新。人物关系只有在正文呈现有意义的新互动或信任、依赖、敌意、立场等变化时才追加 relationshipUpdates；不要把每次普通对话都记成关系变化，也不要把关系变化当成必须维持的静态标签；每条更新必须附最终正文中的逐字证据。"
  ].join("\n\n");
  const validateStateUpdate = (output: string) => parseStoryStateUpdate(extractJson(output), chapter);
  let stateText = "";
  let update: Partial<StoryState>;
  try {
    stateText = await cachedCall("state-update", "08-state-update-raw.json", "state", [statePrompt], validateStateUpdate);
    update = validateStateUpdate(stateText);
  } catch (firstError) {
    try {
      stateText = await cachedCall("state-update-retry", "08-state-update-retry-raw.json", "state", [
        "上一次状态提取未通过 JSON 或 schema 校验：" + String(firstError),
        "上一次输出：", stateText,
        "请重新根据旧状态和下面的最终章节全文提取，只输出符合既定 JSON schema 的对象；continuityNotes 必须返回完整的当前有效备注数组；不要添加 Markdown、解释或 schema 外字段。",
        "只返回本章发生变化的部分：不要回传 schemaVersion、worldId、updatedAt 等整份状态字段。",
        "arcMilestones.evidence 必须逐字出现在本章正文中；找不到原文的里程碑不要写入，宁可少记一条。",
        "旧状态：", JSON.stringify(state, null, 2),
        "最终章节全文：", chapter
      ], validateStateUpdate);
      update = validateStateUpdate(stateText);
    } catch (retryError) {
      await saveStage(input.outputDir, "08-state-update-error.txt", "First attempt: " + String(firstError) + "\nRetry: " + String(retryError) + "\n\n" + stateText);
      throw new Error("Chapter was generated, but story-state extraction failed twice. See 08-state-update-error.txt; do not start the next chapter.");
    }
  }
  const nextState = mergeStoryState(state, update);
  try {
    // 默认自动提交状态；仅在显式隔离/试写模式下保留为本次运行提案。
    await saveStage(input.outputDir, "08-state-update.json", JSON.stringify(nextState, null, 2));
    await commitStoryStateAndArc({ statePath: input.statePath, previousState: state, nextState, applyState: input.applyState, storyArcPath: input.storyArcPath, storyArcText: storyArc });
  } catch (error) {
    await saveStage(input.outputDir, "08-state-update-error.txt", String(error) + "\n\n" + stateText);
    throw new Error("Chapter was generated, but story-state persistence failed. See 08-state-update-error.txt; do not start the next chapter.");
  }
  // 不再在硬伤修复后重复启动只读文风审核；硬伤修复范围由 review artifacts 留痕。
  return chapter;
}
