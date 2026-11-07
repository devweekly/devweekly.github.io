// 普通章节多阶段写作流水线：主线架构师/创意发散并行 → 主编蓝图 → 正文 → 对白 → 叙事声音 →
// Living Voice/Anti-AI 编辑 → 终审复查与最多两轮自动修复 → Reader 观察 → 状态提取与提交。
// 各阶段按职责裁剪上下文：创意阶段不给逐条证据，对白编辑只看人物状态，只有事实核对类
// 阶段才保留证据材料。每阶段走 stage-cache 指纹缓存；未通过终审不写 Story State。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStoryStateUpdate, saveStoryState, type StoryState } from "./story-state.js";
import { runAgentText, resolveModelAttempts, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { formatReview, parseChapterReview, reviewAndRepair, reviewPrompt, withDeterministicIssues } from "./chapter-review.js";
import { checkIronLaws, ironLawIssues, loadIronLaws } from "./iron-laws.js";
import { loadRunStoryState, runCachedStage } from "./stage-cache.js";
import { parseJsonObject } from "./model-json.js";
import { LONG_CHAPTER_SOURCE_TAIL_CHARS } from "./constants.js";
import { buildWorldSituationContext } from "./world-situation.js";
import { LIVING_VOICE_RULES, antiAiDiagnosticPrompt, antiAiEditPrompt, antiAiVerificationPrompt, parseAntiAiVerification, postReviewLiteraryCheckPrompt, readerExperiencePrompt, shouldRunAntiAiEdit } from "./literary-edit.js";
import { buildStyleRegressionPrompt, loadStyleRegressionReferences } from "./style-regression.js";
import { buildStyleTrendPrompt, collectStyleRegressionReports, countStyleRegressionReports } from "./style-trend.js";
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
    input.retrievedContext ? "本地资料库证据（用于核实事实，不得整段复制）：\n" + input.retrievedContext : "",
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
  return result;
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
  const call = (stage: StageKey, parts: string[]): Promise<string> =>
    runAgentText(parts.join("\n\n"), input.model, undefined, profiles[stage], !input.strictModel);
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
  if (worldSituation) await saveStage(input.outputDir, "00-world-situation-context.md", worldSituation);

  const common = buildCommonWritingContext(input, state, worldSituation);

  // 不同阶段只接收完成当前任务所需的上下文。完整事实包仍用于规划、正文和终审；
  // 创意发散不需要逐条原文证据，编辑阶段也不应反复携带整份语料与续写材料。
  const taskText = [input.brief, input.contextText, input.writingBrief, input.storyPlanText, worldSituation].filter(Boolean).join("\n");
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
    input.storyArcText ? "当前滚动式多章节 Story Arc：\n" + input.storyArcText : "",
    input.brief ? "本次创作任务：\n" + input.brief : ""
  ].filter(Boolean).join("\n\n");
  const dialogueContext = [
    input.styleProfile ? "本项目叙事风格参考（仅作抽象参考，不模仿特定作者的独特表达；人物当下的情绪、关系和场景需要优先）：\n" + input.styleProfile : "",
    "当前位置：", state.currentPosition,
    "本章涉及的人物当前状态：", JSON.stringify(relevantCharacters, null, 2),
    "本章涉及的情节线：", JSON.stringify(relevantThreads, null, 2),
    worldSituation ? "当前局势与相关事件：\n" + worldSituation : "",
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
    "角色：中期故事架构师。为接下来约 5–8 章设计一个连贯但可调整的故事阶段；若现有阶段尚未自然结束，延续并修订它，不要无故另起炉灶。",
    common,
    "既有 Story Arc（可能为空）：", previousArc || "尚无中期故事阶段，请从当前局势自然推演。",
    characterArcRetrospective ? "跨章人物弧光回顾（仅供创意启发）：\\n" + characterArcRetrospective : "",
    "结合已发生事件、人物目标与选择、资源/信息变化、开放情节线，设计一段可供连续写作的故事推进。输出 Markdown，至少包含：阶段核心冲突与阶段性结果；5–8 个有因果关系的章节节点（每个写清事件推进、关键人物行动/选择、冲突或关系变化、结尾留下的局面）；哪些人物/伏笔/主线可以暂时不推进；可能的意外转折空间；当前下一章应从哪里自然开始。不要强制每章都发生人物弧光，不要把人物固定为善恶标签，不要预先写死角色选择。章节节点可以合并、拆分、跳过或因正文发展而改写。",
    "文学性、文笔、艺术风格高于其他。故事规划只为因果连续性服务，不是待完成清单。"
  ], output => { if (!output.trim() || output.trim().length < 300) throw new Error("Story Arc is empty or implausibly short."); });
  if (previousArc) await saveStage(input.outputDir, "00-story-arc-previous.md", previousArc);
  await saveStage(input.outputDir, "00-story-arc.md", storyArc);
  if (input.worldDir) await writeFile(resolve(input.worldDir, "story-arc.md"), storyArc.trim() + "\n", "utf8");

  const [plotPlan, ideas] = await Promise.all([
    cachedCall("plot", "01-main-plot.md", "plot", [
      "角色：主线剧情架构师。负责本章主线推进和长篇结构，不写正文。",
      common,
      "中期 Story Arc：", storyArc,
      "提出有吸引力的章节构想，帮助这一章真正好看、能让人物活起来。可考虑主线、人物关系、冲突、悬念、意外性和后续空间，但不要求每项都出现；允许从一个鲜活场景、一段对话或一个反常细节自然生长。",
      "先结合当前 Story State、人物状态、已发生事件及其因果关系，理解本章涉及的局势。只推演确有叙事价值的少数人物或势力：他们为什么行动、各自知道什么、能调用什么资源、受到什么限制，以及主角不介入时局势是否会变化。势力目标与资源以 World Bible 和已有事实为依据；资料不足时保留未知，不补造组织结构或关系。",
      "如有价值，在输出中用“局势推演（尚未发生）”单独标出一至数项可能发展，再提出本章主线方向；没有有价值的推演时可以省略。推演是待选的创作素材，不是正史，不能把可能性写成已发生事实。人物只能依据自己实际知道的信息行动；不得模拟整个世界、强制 NPC 行动或套用游戏数值和回合规则。",
      "行动应有可信原因和可能代价，但不要套用游戏数值、回合制或固定的目标—阻力—选择—后果模板。只标出确实不能改变的已知事实，不要把创意写成分析报告。"
    ]),
    cachedCall("creative", "02-creative-options.md", "creative", [
      "角色：创意发散 Agent。只负责提出有戏剧价值的备选创意，不负责决定正史。",
      creativeContext,
      "自由发散若干真正不同、鲜活、有戏剧性的可能性，可以大胆、怪异、温柔、残酷或出人意料。不要为了数量凑点子，也不必把每个点子拆成固定字段。关注它能带来什么人物互动、情绪、冲突或故事惊喜；不要写正文，不要把建议当作已发生事实。"
    ])
  ]);
  await saveStage(input.outputDir, "01-main-plot.md", plotPlan);
  await saveStage(input.outputDir, "02-creative-options.md", ideas);

  const plan = await cachedCall("plan", "03-chapter-plan.md", "plan", [
    "角色：主编 Agent。整合中期 Story Arc、主线架构师方案和创意发散建议，决定本章唯一执行方案。",
    "中期 Story Arc：", storyArc,
    common,
    "主线方案：", plotPlan, "创意备选：", ideas,
    "选出最有小说感染力的方向，形成自然、有变化的章节构想。结合局势推演判断哪些人物行动或冲突值得进入本章，也可以全部舍弃。不要把所有可能性塞进正文；推演不是章节必须兑现的清单。蓝图帮助写作者理解人物处境和故事走向，不是逐项验收的合同；不要求每场都按目标、阻力、行动、信息变化、结果的模板展开。保留人物的意外性、闲笔和情绪空间。人物知识必须受其实际经历和信息来源限制；不得无意违反已确认事实；区分确知内容与新创作。",
    "蓝图只规定场景的戏剧功能、人物当下的欲望/压力、关键冲突、信息差、不可逆选择及其后果，不要替小说家编排逐帧动作。禁止指定停顿几息、先看手再伸手、伸手又收回、推物件几寸、反复看/不看等微动作序列；也不要把比喻、心理解释或句子直接写进蓝图。只有确实影响剧情理解的动作才写入，其他细节留给正文生成时自然发现。",
    "每个场景最多保留一两个不可丢失的戏剧锚点，其余只写功能和可变化空间。不要用“沉默”“停顿”“不再问”“没有人来”等姿态词代替场景推进；它们只有在改变关系、权力或信息时才有意义。不要预先规定短句、断行、留白或冷峻语气。",
  ]);
  await saveStage(input.outputDir, "03-chapter-plan.md", plan);

  const initialDraft = await cachedCall("scene", "04-scene-draft.md", "scene", [
    "角色：场景小说家。根据最终蓝图写完整章节正文，不输出分析。",
    LIVING_VOICE_RULES, common, "最终章节蓝图：", plan,
    "目标篇幅约 " + input.maxWords + " 个中文字符。通过场景、行动、选择和后果推进；不要用概述代替关键场景。",
    "像小说家一样写，不要像舞台监督一样逐项执行蓝图。蓝图中的动作建议可以合并、替换或省略，只要保留场景的戏剧功能与事实连续性。叙事锋利来自准确的信息选择、因果压力、人物判断和行动后果，不来自短句堆叠、逐帧手势、连续停顿或装饰性诗意。",
    "同一动作只写到足以让读者看清并感受到后果；不要把准备、迟疑、伸手、触碰、收手拆成一串没有新增信息的句子。不要在对白/动作已呈现潜台词后，再替读者解释一遍。每段都要有自己的推进或质感，不能靠反复否定和静物收束拖长。",
    RHYTHM_RULE
  ]);
  await saveStage(input.outputDir, "04-scene-draft.md", initialDraft);

  // 对白与叙事声音属于同一轮整体文学编辑：减少一次完整章节重写，
  // 同时检查人物声音、潜台词、叙述距离和节奏，避免两个编辑 Agent 相互覆盖。
  const literaryDraft = await cachedCall("literary-edit", "05-literary-edited.md", "voice", [
    "角色：小说文学编辑。一次性检查并修整人物对白与全章叙事声音；这是整体编辑，不是重写剧情。",
    LIVING_VOICE_RULES, dialogueContext, voiceContext,
    "章节蓝图：", plan, "当前正文：", initialDraft,
    "对白方面：检查人物词汇、句长、表达习惯、身份关系、情绪和已知信息；删掉解释性过强、所有角色都像同一个人的对白，让潜台词通过停顿、回避、误解和行动体现。",
    "叙事方面：统一叙述视角、时态、叙述距离和段落节奏；检查全章是否反复使用同一种停顿、否定式收束、动作切片或静物结尾。删并不增加信息/压力/判断的重复动作与解释，保留真正改变人物关系、信息差和情绪走向的细节。不要把“短、冷、克制”当作风格目标，不要把每个动作写成慢镜头，也不要把读者已经看懂的潜台词再解释一遍。保持句式和段落自然变化，允许准确的长句、直接判断和粗粝表达。",
    "不得改变剧情事实、场景顺序、人物决定和信息揭示；不能删掉有效的人物互动、动作、意象、信息或情绪落点。原文已经成立时可以原样保留。不得复刻特定作者的独特句式。",
    RHYTHM_RULE, "输出完整修订正文。文学表达优先，不以保持字数为目标。"
  ], output => { if (!output.trim()) throw new Error("Literary edit returned an empty chapter."); });
  await saveStage(input.outputDir, "05-literary-edited.md", literaryDraft);
  // 保留旧文件名作为诊断兼容副本，但不再运行第二个独立的 voice Agent。
  await saveStage(input.outputDir, "05-dialogue-edited.md", literaryDraft);
  await saveStage(input.outputDir, "06-voice-edited.md", literaryDraft);
  const voiceDraft = literaryDraft;

  // Anti-AI is a restrained literary edit, never a detector-driven rewrite.
  // If the optional editor call fails, preserve the already valid voice-edited draft.
  let antiAiDraft = voiceDraft;
  let antiAiDiagnosis = "";
  try {
    antiAiDiagnosis = await cachedCall("anti-ai-diagnosis", "06a-anti-ai-diagnosis.md", "antiAi", [
      antiAiDiagnosticPrompt({ brief: input.brief, blueprint: plan, styleProfile: input.styleProfile, chapter: voiceDraft })
    ], output => { if (!output.trim()) throw new Error("Anti-AI diagnosis returned an empty report."); });
  } catch (error) {
    await saveStage(input.outputDir, "06a-anti-ai-diagnosis-error.txt", String(error));
    console.error("[write] Anti-AI 诊断未完成；编辑阶段仍按通用文学原则运行。");
  }
  const needsAntiAiEdit = shouldRunAntiAiEdit(antiAiDiagnosis);
  if (needsAntiAiEdit) {
    try {
      antiAiDraft = await cachedCall("anti-ai-edit", "06b-anti-ai-edited.md", "antiAi", [
        antiAiEditPrompt({ brief: input.brief, blueprint: plan, styleProfile: input.styleProfile, diagnosis: antiAiDiagnosis, chapter: voiceDraft })
      ], output => { if (!output.trim()) throw new Error("Anti-AI editor returned an empty chapter."); });
    } catch (error) {
      await saveStage(input.outputDir, "06b-anti-ai-error.txt", String(error));
      console.error("[write] Anti-AI 编辑阶段失败，保留整体文学编辑稿继续终审。");
    }
  } else {
    await saveStage(input.outputDir, "06b-anti-ai-skipped.json", JSON.stringify({ skipped: true, reason: antiAiDiagnosis.trim() ? "诊断未发现值得修改的问题。" : "诊断不可用，避免无依据改写。" }, null, 2));
  }
  if (antiAiDraft !== voiceDraft) {
    try {
      const verificationRaw = await cachedCall("anti-ai-verification", "06c-anti-ai-verification.json", "antiAi", [
        antiAiVerificationPrompt({ original: voiceDraft, edited: antiAiDraft })
      ], output => { parseAntiAiVerification(output); });
      const verification = parseAntiAiVerification(verificationRaw);
      await saveStage(input.outputDir, "06c-anti-ai-verification.json", JSON.stringify(verification, null, 2));
      if (verification.decision === "restore") antiAiDraft = voiceDraft;
    } catch (error) {
      await saveStage(input.outputDir, "06c-anti-ai-verification-error.txt", String(error));
      antiAiDraft = voiceDraft;
      console.error("[write] Anti-AI 复核未能确认编辑收益，恢复原稿。");
    }
  } else {
    await saveStage(input.outputDir, "06c-anti-ai-verification.json", JSON.stringify({ decision: "keep", reason: "编辑阶段未改变正文。" }, null, 2));
  }
  await saveStage(input.outputDir, "06b-anti-ai-edited.md", antiAiDraft);

  const reviewHistory: string[] = [];
  const reviewed = await reviewAndRepair({
    initialChapter: antiAiDraft,
    maxRepairRounds: 2,
    review: (candidate, correction) => {
      const round = reviewHistory.length + 1;
      return cachedCall("quality-review-" + round + (correction ? "-retry" : ""), "07-review-round-" + round + (correction ? "-retry" : "") + "-raw.txt", "review", [
        reviewPrompt({ context: common, blueprint: plan, chapter: candidate, correction })
      ], output => parseChapterReview(output, candidate)).then(raw => {
        // 数值、位阶这类能机器判定的硬约束先于模型意见进入必改项。
        const parsed = parseChapterReview(raw, candidate);
        const lawIssues = ironLawIssues(checkIronLaws(candidate, laws));
        return JSON.stringify(withDeterministicIssues(parsed, lawIssues));
      });
    },
    repair: (candidate, issues, round) => cachedCall("quality-repair-" + round, "07-repaired-round-" + round + ".md", "final", [
      "角色：主编修复 Agent。根据结构化审查结果执行最小范围修复，只输出完整章节正文。",
      common, "最终章节蓝图：", plan,
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
  // Only inspect post-review prose when a hard-fact repair actually changed it.
  // This is diagnostic-only: never launch another full-chapter rewrite after acceptance.
  if (reviewed.repairRounds > 0) {
    try {
      const report = await cachedCall("post-review-literary-check", "10-post-review-literary-check.md", "antiAi", [
        postReviewLiteraryCheckPrompt({
          beforeReview: antiAiDraft,
          finalChapter: chapter,
          reviewHistory: reviewHistory.join("\n\n---\n\n")
        })
      ], output => { if (!output.trim()) throw new Error("Post-review literary check returned an empty report."); });
      await saveStage(input.outputDir, "10-post-review-literary-check.md", report);
    } catch (error) {
      await saveStage(input.outputDir, "10-post-review-literary-check-error.txt", String(error));
      console.error("[write] 终审后的文风观察未完成；不改动正文，也不影响章节提交。");
    }
  } else {
    await saveStage(input.outputDir, "10-post-review-literary-check-skipped.json", JSON.stringify({
      skipped: true, reason: "终审没有修复正文，无需重复检查文风回归。"
    }, null, 2));
  }
  await saveStage(input.outputDir, "07-continuity-review.md", reviewHistory.join("\n\n---\n\n"));
  await saveStage(input.outputDir, "chapter.md", chapter);
  await saveStage(input.outputDir, "09-quality-summary.json", JSON.stringify({
    status: "passed",
    repairRounds: reviewed.repairRounds,
    reviews: reviewed.reviews
  }, null, 2));

  // Automatic style regression is observational: never rewrites or blocks prose.
  if (input.styleProfile?.trim()) {
    try {
      const references = await loadStyleRegressionReferences(input.worldDir ?? resolve("worlds", input.worldId));
      const report = await cachedCall("style-regression", "11-style-regression.md", "styleDistill", [
        buildStyleRegressionPrompt({ styleProfile: input.styleProfile, references, candidates: [{ label: "本次最终章节", text: chapter }] })
      ], output => { if (!output.trim()) throw new Error("Style regression returned an empty report."); });
      await saveStage(input.outputDir, "11-style-regression.md", report);
      // Every fifth completed chapter produces a lightweight longitudinal review.
      // It is observational only and is isolated from chapter acceptance and prose.
      const trendRoot = resolve(".output", input.worldId);
      const totalStyleReports = await countStyleRegressionReports(trendRoot);
      const trendReports = await collectStyleRegressionReports(trendRoot, 30);
      if (totalStyleReports >= 5 && totalStyleReports % 5 === 0) {
        try {
          const trend = await cachedCall("style-regression-trend", "12-style-regression-trend.md", "styleDistill", [
            buildStyleTrendPrompt({ styleProfile: input.styleProfile, reports: trendReports })
          ], output => { if (!output.trim()) throw new Error("Style trend returned an empty report."); });
          await saveStage(input.outputDir, "12-style-regression-trend.md", trend);
        } catch (trendError) {
          await saveStage(input.outputDir, "12-style-regression-trend-error.txt", String(trendError));
          console.error("[write] 跨章节风格趋势观察未完成；不影响正文与状态提交。");
        }
      }
    } catch (error) {
      await saveStage(input.outputDir, "11-style-regression-error.txt", String(error));
      console.error("[write] 风格回归观察未完成；不改动正文，也不影响章节状态提交。");
    }
  }

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
      await saveStage(input.outputDir, "08-state-update-error.txt", "First attempt: " + String(firstError) + "\\nRetry: " + String(retryError) + "\\n\\n" + stateText);
      throw new Error("Chapter was generated, but story-state extraction failed twice. See 08-state-update-error.txt; do not start the next chapter.");
    }
  }
  const nextState = mergeStoryState(state, update);
  try {
    // 默认自动提交状态；仅在显式隔离/试写模式下保留为本次运行提案。
    if (input.applyState) await saveStoryState(input.statePath, nextState);
    await saveStage(input.outputDir, "08-state-update.json", JSON.stringify(nextState, null, 2));
  } catch (error) {
    await saveStage(input.outputDir, "08-state-update-error.txt", String(error) + "\n\n" + stateText);
    throw new Error("Chapter was generated, but story-state persistence failed. See 08-state-update-error.txt; do not start the next chapter.");
  }
  return chapter;
}
