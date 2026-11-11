import { z } from "zod";
import { runAgentText } from "./generate.js";
import { parseJsonObject } from "./model-json.js";
import { DEFAULT_AGENT_TIMEOUT_MS } from "./constants.js";
import { readTaskProfiles } from "./task-profiles.js";
import type { StoryState } from "./story-state.js";

const PersonSchema = z.object({
  name: z.string().min(1), role: z.string().default(""), status: z.enum(["existing", "new"]).default("new"),
  desire: z.string().default(""), fearOrSecret: z.string().default(""), relationships: z.array(z.string()).default([]),
  possibleDevelopment: z.array(z.string()).default([])
}).strict();
const CultureSchema = z.object({
  name: z.string().min(1), practice: z.string().default(""), originOrBelief: z.string().default(""),
  socialFunction: z.string().default(""), storyUse: z.string().default("")
}).strict();
const BeatSchema = z.object({
  title: z.string().min(1), function: z.string().default(""), causalChange: z.string().default(""),
  involvedCharacters: z.array(z.string()).default([]), possibleArcs: z.array(z.string()).default([]),
  status: z.enum(["planned", "in_progress", "completed", "replaced"]).default("planned")
}).strict();

const StoryUnitSchema = z.object({
  id: z.string().uuid().optional(),
  schemaVersion: z.literal(1), worldId: z.string().min(1), updatedAt: z.string().min(1),
  title: z.string().min(1), storyCore: z.string().min(1), readerExperience: z.string().default(""),
  openingSituation: z.string().default(""), centralConflict: z.string().default(""),
  canonTypeFit: z.object({
    worldIdentity: z.string().default(""), supernaturalEngine: z.string().default(""),
    causalNecessity: z.string().default(""), removalTest: z.string().default("")
  }).strict().default({ worldIdentity: "", supernaturalEngine: "", causalNecessity: "", removalTest: "" }),
  supernaturalEngine: z.object({
    phenomenon: z.string().default(""), rules: z.array(z.string()).default([]),
    boundaries: z.array(z.string()).default([]), cost: z.array(z.string()).default([]),
    observableEvidence: z.string().default(""), causalRole: z.string().default("")
  }).strict().default({ phenomenon: "", rules: [], boundaries: [], cost: [], observableEvidence: "", causalRole: "" }),
  fruitOrSetting: z.object({
    name: z.string().default(""), premise: z.string().default(""), abilitiesAndRules: z.array(z.string()).default([]),
    costsAndLimits: z.array(z.string()).default([]), historicalContext: z.string().default(""),
    geographyAndDailyLife: z.string().default(""), powerAndSocialRelations: z.string().default("")
  }).strict(),
  cultureAndFolklore: z.array(CultureSchema).default([]),
  taboosAndGhostStories: z.array(z.object({
    name: z.string().min(1), versions: z.array(z.string()).default([]), underlyingTruthOptions: z.array(z.string()).default([]),
    consequences: z.string().default(""), scenePotential: z.string().default("")
  }).strict()).default([]),
  cast: z.array(PersonSchema).default([]),
  relationshipDynamics: z.array(z.string()).default([]),
  storySpine: z.array(BeatSchema).min(4),
  subplots: z.array(z.string()).default([]),
  climax: z.string().min(1), endingAndAftermath: z.string().min(1),
  unresolvedQuestions: z.array(z.string()).default([]), creativePossibilities: z.array(z.string()).default([]),
  execution: z.object({ status: z.enum(["not_started", "in_progress", "completed"]).default("not_started"), completedChapterIds: z.array(z.string()).default([]), lastUnresolvedCoreThreads: z.array(z.string()).default([]), idleChapterCount: z.number().int().nonnegative().default(0), lastAssessedChapterId: z.string().optional(), lastAssessment: z.string().optional(), nextDirection: z.string().optional(), cumulativeStorySummary: z.string().max(12000).default(""), assessedAt: z.string().optional(), completedAt: z.string().optional(), characterArcHistory: z.array(z.object({ chapterId: z.string(), name: z.string(), observedChange: z.string(), futurePossibilities: z.array(z.string()), recordedAt: z.string() }).strict()).default([]) }).default({ status: "not_started", completedChapterIds: [], lastUnresolvedCoreThreads: [], idleChapterCount: 0, cumulativeStorySummary: "", characterArcHistory: [] })
}).strict();

export type StoryUnit = z.infer<typeof StoryUnitSchema>;

export function validateStoryUnit(value: unknown, worldId?: string): StoryUnit {
  const unit = StoryUnitSchema.parse(value);
  if (worldId && unit.worldId !== worldId) throw new Error("Story Unit world mismatch.");
  return unit;
}

export async function generateStoryUnit(input: {
  worldId: string; worldBible: string; state: StoryState; storyAnalysisContext?: string;
  previous?: StoryUnit; brief?: string; model?: string;
  trace?: import("./generate.js").AgentTextTrace;
}): Promise<StoryUnit> {
  const shape = {
    title: "故事单元标题", storyCore: "独立而完整的故事核心", readerExperience: "希望读者经历的情绪与阅读体验",
    openingSituation: "故事开端的具体局面", centralConflict: "核心矛盾",
    canonTypeFit: { worldIdentity: "为什么这是《从姑获鸟开始》世界中的故事", supernaturalEngine: "不可替代的超凡机制", causalNecessity: "超凡机制怎样改变事件因果与人物选择", removalTest: "移除超凡机制后哪些关键因果链必然断裂" },
    supernaturalEngine: { phenomenon: "客观存在的异常现象", rules: ["可验证的规则"], boundaries: ["明确边界"], cost: ["真实代价"], observableEvidence: "人物能够观察或验证的证据", causalRole: "该机制直接推动的关键事件" },
    fruitOrSetting: { name: "果实/场景名称", premise: "独特情境", abilitiesAndRules: ["规则"], costsAndLimits: ["代价"], historicalContext: "历史背景", geographyAndDailyLife: "地理与日常生活", powerAndSocialRelations: "权力与社会关系" },
    cultureAndFolklore: [{ name: "习俗", practice: "具体做法", originOrBelief: "由来/信念", socialFunction: "社会作用", storyUse: "如何进入人物生活与剧情" }],
    taboosAndGhostStories: [{ name: "禁忌或怪谈", versions: ["民间不同版本"], underlyingTruthOptions: ["可能解释"], consequences: "后果", scenePotential: "场景潜力" }],
    cast: [{ name: "人物", role: "角色位置", status: "existing", desire: "欲望", fearOrSecret: "恐惧或秘密", relationships: ["关系"], possibleDevelopment: ["发展可能"] }],
    relationshipDynamics: ["人物关系变化可能"],
    storySpine: [{ title: "阶段", function: "叙事功能", causalChange: "因果变化", involvedCharacters: ["人物"], possibleArcs: ["人物变化可能"], status: "planned" }],
    subplots: ["支线"], climax: "高潮", endingAndAftermath: "结局与余韵",
    unresolvedQuestions: ["有意保留的问题"], creativePossibilities: ["可探索但不强制的创意方向"]
  };
  const prompt = [
    "你是具有文学判断力的长篇小说总构思编辑。请为一个独立完整的故事单元建立可供持续创作的故事设计，不写章节正文。",
    "只输出符合下列结构的 JSON，不要 Markdown：", JSON.stringify(shape, null, 2),
    "最高原则：文学性、文笔、艺术风格高于其他一切。设计必须具体、可写、有人间烟火和真实社会关系，不要空泛堆设定；但真实生活质感不能替代本作的超凡叙事引擎。",
    "类型硬约束：这是《从姑获鸟开始》同一世界观中的故事，不是借用年代、民俗、地域和人物关系写一篇现实主义小说。原作的超凡世界、异常规则、果实/副本/天门等设定及其叙事气质，必须真正进入本故事的因果链，具体形式可以创新，不要求每篇都机械出现同一种元素。",
    "必须设计一个客观存在、能够影响现实并可被事件验证的超凡机制。写清异常现象、规则、边界、代价、可观察证据，以及它如何迫使人物行动、改变利益关系或造成不可逆后果。不能只把工艺流程、职业规矩、民俗禁忌、心理暗示、传说或象征意象改名为超凡规则。",
    "反事实类型检查：明确回答如果删掉超凡机制，哪些关键事件不会发生、哪些人物选择不再成立、哪条核心因果链会断裂。如果删掉它以后故事仍能原样成立，说明故事方向偏离本作类型，必须重新构思，不得用解释性文字掩盖。",
    "递进要求：异常机制要从具体现象进入人物生活，逐步暴露规则与边界，迫使人物作出选择，并使代价和冲突升级；不要求固定打怪、闯关或三幕套路，也不要求每篇都采用相同节奏。文学性和人物生命力优先于公式。",
    "现实历史、生产生活、地方风俗和社会关系是超凡事件发生的具体土壤，应保留其真实细节；但不能让现实利益纠纷独占主线，把超凡设定降为装饰或留在背景。",
    "若故事围绕果实/副本，必须设计其独特规则、代价、历史社会背景、地方地理、生产生活、习俗、仪式、禁忌和怪谈。民俗必须说明由来、社会功能、不同人群如何理解，以及如何自然进入具体场景和人物冲突；不要把民俗当设定词条清单。",
    "人物既包括原文/当前故事已经出场的人物，也包括有必要引入的新人物。status 字段只能填写 existing 或 new。说明人物各自欲望、利益、认知边界、秘密、关系和可能变化。人物弧光只能是可能性，允许反复、矛盾、意外转向，不得将人物固定为标签或强制兑现路线。",
    "故事脊柱必须形成完整因果推进：开端、局面展开、冲突升级、关键转折、高潮、结局与余韵。至少四个阶段，但不要按固定三幕模板硬套。支线必须与人物或核心冲突发生真实联系。",
    "不要预设章节数量。之后会根据故事复杂度动态拆成若干 Story Arc 和章节；不得把 30 章当作目标或上限。结尾必须能使核心故事获得有意义的收束，同时允许留白、开放问题和更大世界的后续空间。",
    "区分已发生事实与创作可能性。不要编造原著事实；未知内容可以作为多种可能性保留。避免套路化反转、宏大阴谋和为伏笔而伏笔。",
    "世界设定：", input.worldBible,
    "当前故事状态（已发生事实）：", JSON.stringify(input.state),
    input.storyAnalysisContext || "暂无可用的原著故事分析资料。",
    input.brief ? "本次故事方向补充：" + input.brief : "",
    input.previous ? "上一版故事设计（保留仍有效部分，按已发生事实修订）： " + JSON.stringify(input.previous) : "首次建立故事设计。"
  ].filter(Boolean).join("\n\n");
  const raw = await runAgentText(prompt, input.model, DEFAULT_AGENT_TIMEOUT_MS, readTaskProfiles().plot, true, input.trace);
  const parsed = parseJsonObject(raw) as Record<string, unknown>;
  const unit = StoryUnitSchema.parse({ ...parsed, ...(input.previous ? { execution: input.previous.execution } : {}), schemaVersion: 1, worldId: input.worldId, updatedAt: new Date().toISOString() });
  const contract = unit.canonTypeFit;
  const engine = unit.supernaturalEngine;
  const required = [
    ["世界类型定位", contract.worldIdentity, 20], ["超凡机制", contract.supernaturalEngine, 16],
    ["因果必要性", contract.causalNecessity, 20], ["反事实检查", contract.removalTest, 20],
    ["异常现象", engine.phenomenon, 8], ["可观察证据", engine.observableEvidence, 8],
    ["机制因果作用", engine.causalRole, 16]
  ] as const;
  const missing: string[] = required.filter(([, value, min]) => value.trim().length < min).map(([name]) => name);
  if (engine.rules.length === 0 || engine.boundaries.length === 0 || engine.cost.length === 0) {
    missing.push("规则、边界或代价");
  }
  if (missing.length) throw new Error("Story Unit 类型一致性检查未通过，缺少可执行的超凡因果设计：" + missing.join("、") + "。请重新生成，不能以民俗/工艺/心理规矩代替超凡机制。");
  return unit;
}

/** 供章节写作检索与上下文使用的紧凑故事方向；不把创作可能性转成强制任务。 */

const StoryProgressAssessmentSchema = z.object({
  coreConflictResolved: z.boolean(), endingFeelsNatural: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  unresolvedCoreThreads: z.array(z.string()), unrealizedMajorBeats: z.array(z.string()), remainingStoryWork: z.array(z.string()),
  nextDirection: z.string(), rationale: z.string(),
  meaningfulProgress: z.boolean().default(false), progressEvidence: z.string().default(""),
  cumulativeStorySummary: z.string().max(12000).default(""),
  revisedStorySpine: z.array(BeatSchema).default([]),
  characterArcUpdates: z.array(z.object({ name: z.string().min(1), observedChange: z.string().default(""), futurePossibilities: z.array(z.string()).default([]) }).strict()).default([])
}).strict();
export type StoryProgressAssessment = z.infer<typeof StoryProgressAssessmentSchema>;

export function mergeStorySpinePreservingCompleted(
  previous: StoryUnit["storySpine"], proposed: StoryUnit["storySpine"]
): StoryUnit["storySpine"] {
  if (proposed.length < 4) return previous;
  const merged = proposed.map(beat => {
    const prior = previous.find(item => item.title === beat.title);
    return prior?.status === "completed" ? { ...beat, status: "completed" as const } : beat;
  });
  const omittedCompleted = previous.filter(item =>
    item.status === "completed" && !merged.some(beat => beat.title === item.title)
  );
  return [...omittedCompleted, ...merged];
}

export function hasVerifiableStoryProgress(assessment: StoryProgressAssessment, chapterText: string): boolean {
  const evidence = assessment.progressEvidence.trim();
  return assessment.meaningfulProgress && evidence.length >= 4 && chapterText.includes(evidence);
}

export function isStoryUnitNaturallyComplete(assessment: StoryProgressAssessment): boolean {
  // remainingStoryWork is the editor's explicit list of narrative work still required.
  // It must be empty as well: otherwise a model could mark the central conflict resolved
  // while leaving essential consequences, character choices, or closure unwritten.
  return assessment.coreConflictResolved && assessment.endingFeelsNatural && assessment.confidence === "high" &&
    assessment.unresolvedCoreThreads.length === 0 &&
    assessment.unrealizedMajorBeats.length === 0 &&
    assessment.remainingStoryWork.length === 0;
}

/** Judge narrative closure from actual completed text and committed story state, never chapter count. */
export async function assessStoryUnitProgress(input: {
  unit: StoryUnit; chapterText: string; chapterTitle: string; completedChapterCount: number;
  storyState: StoryState; model?: string; trace?: import("./generate.js").AgentTextTrace;
}): Promise<StoryProgressAssessment> {
  const prompt = [
    "你是长篇小说的责任编辑，判断当前完整故事是否真正写完。只输出 JSON。",
    "最高原则：文学性、文笔、艺术风格高于其他一切。不要为了结构完整强迫人物或剧情。",
    "这不是章节数量判断。章节数没有固定目标、上限或完成阈值。不要因为出现高潮、反派暂时失败、章节有收尾感就判定故事结束。",
    "只有当本 Story Unit 的核心戏剧问题已得到有意义的回答、主要因果冲突已解决或完成有意的开放式收束、人物关键选择产生了后果、结尾自然成立，并且没有仍需本故事回答的核心问题时，才可把 coreConflictResolved 和 endingFeelsNatural 都设为 true。",
    "允许保留世界谜团、余韵和明确属于后续故事的问题；不要把这些误判为本故事未完成。区分核心故事线与可留白的世界设定。",
    "逐项对照 storySpine：若任何重要阶段尚未发生，也没有被正文中更好的叙事发展自然替代，列入 unrealizedMajorBeats 并判定未完成。不要机械兑现细节，但必须确认故事从开端到主要冲突升级、关键转折、高潮和收束已经真正发生。",
    "每章结束后必须做滚动重规划：返回 revisedStorySpine，重新审视后续阶段。已经在正文中发生的阶段标记 completed；正在展开的标记 in_progress；尚未发生的标记 planned；若实际剧情自然产生了更好的发展，可以将原阶段标记 replaced，并新增更贴合当前因果的阶段。至少保留完整的开端—发展—高潮—收束结构，但不得让原计划凌驾于已发生正文。",
    "返回 characterArcUpdates：只记录正文和 Story State 有证据支持的人物变化，并提出开放的后续可能，不强制人物必须按某条弧光发展。不得虚构未发生的心理变化。",

    "若证据不足，必须保守判定 false。completedChapterCount 只是上下文，不得作为完成条件或最低章数门槛。",
    "判断本章是否产生了可验证的实质推进：只有核心冲突、人物选择及代价、利益格局、关系或因果局面确有变化才 meaningfulProgress=true；必须提供本章正文中的连续原文 progressEvidence（至少 4 字），不能引用泛泛描写。没有推进则为 false、证据留空。",
    "每章更新 cumulativeStorySummary：在既有摘要基础上增量维护已发生的关键事件、因果变化、人物选择及后果、人物认知与关系变化、仍有效的冲突。只写正文和已提交 Story State 能支持的事实，明确保留不确定性；不要变成剧情复述或设定百科，建议控制在 3000 中文字以内。",
    "JSON 结构：",
    JSON.stringify({ coreConflictResolved: false, endingFeelsNatural: false, confidence: "medium", unresolvedCoreThreads: ["尚未收束的核心线"], unrealizedMajorBeats: ["尚未发生的主要故事阶段"], remainingStoryWork: ["下一步具体需要写的内容"], nextDirection: "下一章最自然的推进方向", rationale: "依据实际正文说明", meaningfulProgress: true, progressEvidence: "本章正文中的连续原文", cumulativeStorySummary: "截至本章的累计故事事实与因果摘要", revisedStorySpine: [], characterArcUpdates: [] }, null, 2),
    "故事单元：", JSON.stringify(input.unit),
    "已完成章节数（仅供上下文，不作阈值）：", String(input.completedChapterCount),
    "刚完成章节标题：", input.chapterTitle,
    "刚完成章节正文：", input.chapterText.slice(-18000),
    "此前累计故事记忆：", input.unit.execution.cumulativeStorySummary || "尚无累计摘要，这是第一章。",
    "已提交 Story State：", JSON.stringify(input.storyState),
    "请在 revisedStorySpine 中输出重规划后的完整阶段列表；如果没有必要改变结构，可返回原列表并更新 status。"
  ].join("\n\n");
  const raw = await runAgentText(prompt, input.model, DEFAULT_AGENT_TIMEOUT_MS, readTaskProfiles().plot, true, input.trace);
  return StoryProgressAssessmentSchema.parse(parseJsonObject(raw));
}

export function formatStoryUnit(unit: StoryUnit | undefined): string {
  if (!unit) return "";
  const lines = [
    "当前完整故事单元（活的创作方向，不是剧情合同；已发生事实和正文优先）：",
    "标题：" + unit.title,
    "故事核心：" + unit.storyCore,
    "开端：" + unit.openingSituation,
    "核心矛盾：" + unit.centralConflict,
    "果实/场景：" + unit.fruitOrSetting.name + "；" + unit.fruitOrSetting.premise,
    "历史与社会：" + unit.fruitOrSetting.historicalContext + "；" + unit.fruitOrSetting.geographyAndDailyLife + "；" + unit.fruitOrSetting.powerAndSocialRelations,
    "原作类型定位：" + unit.canonTypeFit.worldIdentity + "；超凡机制：" + unit.canonTypeFit.supernaturalEngine + "；因果必要性：" + unit.canonTypeFit.causalNecessity + "；移除机制后的断裂点：" + unit.canonTypeFit.removalTest,
    "客观异常：" + unit.supernaturalEngine.phenomenon + "；可验证规则：" + unit.supernaturalEngine.rules.join("；") + "；边界：" + unit.supernaturalEngine.boundaries.join("；") + "；代价：" + unit.supernaturalEngine.cost.join("；") + "；观察证据：" + unit.supernaturalEngine.observableEvidence + "；因果作用：" + unit.supernaturalEngine.causalRole,
    "规则及代价：" + [...unit.fruitOrSetting.abilitiesAndRules, ...unit.fruitOrSetting.costsAndLimits].join("；"),
    "文化民俗：" + unit.cultureAndFolklore.map(x => x.name + "：" + x.practice + "；" + x.storyUse).join(" / "),
    "禁忌怪谈：" + unit.taboosAndGhostStories.map(x => x.name + "：" + x.versions.join("、") + "；场景潜力：" + x.scenePotential).join(" / "),
    "人物群像：" + unit.cast.map(x => x.name + (x.status === "existing" ? "（已出场）" : "（新人物）") + "：" + x.role + "；欲望：" + x.desire + "；关系：" + x.relationships.join("、") + "；发展可能：" + x.possibleDevelopment.join("、")).join(" / "),
    "人物关系变化可能：" + unit.relationshipDynamics.join("；"),
    "执行状态：" + unit.execution.status + "；已完成章节：" + unit.execution.completedChapterIds.length,
    unit.execution.lastAssessment ? "最近进展判断：" + unit.execution.lastAssessment : "",
    unit.execution.cumulativeStorySummary ? "截至目前的累计故事事实与因果记忆：" + unit.execution.cumulativeStorySummary : "",
    unit.execution.characterArcHistory.length ? "人物发展记录：" + unit.execution.characterArcHistory.slice(-20).map(x => x.name + "（" + x.chapterId + "）：" + x.observedChange + "；后续可能：" + x.futurePossibilities.join("、")).join(" / ") : "",
    unit.execution.nextDirection ? "下一步自然推进方向：" + unit.execution.nextDirection : "",
    "完整故事因果脊柱：" + unit.storySpine.map((x, i) => (i + 1) + "." + x.title + "：" + x.function + "；" + x.causalChange).join(" / "),
    "支线：" + unit.subplots.join("；"),
    "高潮方向：" + unit.climax,
    "结局与余韵方向：" + unit.endingAndAftermath,
    "开放问题：" + unit.unresolvedQuestions.join("；"),
    "创作可能性仅供启发，可根据人物行动和正文自然调整；不得为了兑现规划而牺牲人物生命力和文学表达。"
  ];
  return lines.join("\n").slice(0, 16000);
}
