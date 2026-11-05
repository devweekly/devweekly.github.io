import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadStoryState, saveStoryState, type StoryState } from "./story-state.js";
import { runAgentText, type GenerationMode } from "./generate.js";

export interface WriteWorkflowInput {
  worldId: string;
  mode: GenerationMode;
  brief: string;
  worldBible: string;
  styleProfile?: string;
  sourceText?: string;
  contextText?: string;
  retrievedContext?: string;
  model?: string;
  maxWords: number;
  outputDir: string;
  statePath: string;
  applyState: boolean;
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object for story-state update.");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

function mergeState(current: StoryState, update: Partial<StoryState>): StoryState {
  const mergeBy = <T extends object>(oldItems: T[], newItems: T[], key: (item: T) => string): T[] => {
    const map = new Map(oldItems.map(item => [key(item), item]));
    for (const item of newItems) {
      const id = key(item);
      const previous = map.get(id);
      if (previous && typeof previous === "object" && typeof item === "object") {
        const merged = { ...(previous as unknown as Record<string, unknown>), ...(item as unknown as Record<string, unknown>) };
        for (const [field, value] of Object.entries(item as unknown as Record<string, unknown>)) {
          const priorValue = (previous as unknown as Record<string, unknown>)[field];
          if (Array.isArray(value)) merged[field] = [...new Set([...(Array.isArray(priorValue) ? priorValue : []), ...value])];
        }
        map.set(id, merged as unknown as T);
      } else map.set(id, item);
    }
    return [...map.values()];
  };
  return {
    ...current,
    currentPosition: update.currentPosition || current.currentPosition,
    canonFacts: mergeBy(current.canonFacts, update.canonFacts ?? [], item => item.id),
    characters: mergeBy(current.characters, update.characters ?? [], item => item.name),
    events: mergeBy(current.events, update.events ?? [], item => item.id),
    plotThreads: mergeBy(current.plotThreads, update.plotThreads ?? [], item => item.id),
    continuityNotes: [...new Set([...current.continuityNotes, ...(update.continuityNotes ?? [])])],
    updatedAt: new Date().toISOString()
  };
}

async function saveStage(dir: string, name: string, content: string): Promise<void> {
  await writeFile(resolve(dir, name), content.trim() + "\n", "utf8");
}

export async function writeChapter(input: WriteWorkflowInput): Promise<string> {
  const state = await loadStoryState(input.statePath, input.worldId);
  await mkdir(input.outputDir, { recursive: true });
  if (input.retrievedContext) await saveStage(input.outputDir, "00-retrieval.md", input.retrievedContext);

  const common = [
    "世界设定：", input.worldBible,
    "当前故事状态（已有记录优先；不得擅自改写已确认事实）：", JSON.stringify(state, null, 2),
    input.contextText ? "用户补充的前文摘要：\n" + input.contextText : "",
    input.retrievedContext ? "本地资料库证据（用于核实事实，不得整段复制）：\n" + input.retrievedContext : "",
    input.sourceText ? "用户提供且有权使用的续写材料：\n" + input.sourceText : "",
    input.styleProfile ? "本项目叙事风格约束（仅使用抽象写作特征，不模仿特定作者的独特表达）：\n" + input.styleProfile : "",
    input.mode === "continuation" ? "创作模式：续写。严格承接用户提供的合法文本和当前故事状态。" : "创作模式：原创衍生。不得把项目原创内容伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  // The plot architect and creative room work independently. The editor later
  // decides which ideas survive; brainstorming never becomes canon by itself.
  const [plotPlan, ideas] = await Promise.all([
    runAgentText([
      "角色：主线剧情架构师。负责本章主线推进和长篇结构，不写正文。",
      common,
      "输出可执行章节方案：本章主线目标、因果链、场景顺序、关键选择及代价、与长期主线/伏笔的关系、结尾状态。明确哪些事实不可改变。"
    ].join("\n\n"), input.model),
    runAgentText([
      "角色：创意发散 Agent。只负责提出有戏剧价值的备选创意，不负责决定正史。",
      common,
      "提出最多 5 个不同方向的情节/冲突/信息揭示方案。每项说明新鲜点、人物动机、代价、与现有设定的冲突风险。至少给出一个低风险方案和一个高风险方案。不要写正文，不要擅自把建议当作已发生事实。"
    ].join("\n\n"), input.model)
  ]);
  await saveStage(input.outputDir, "01-main-plot.md", plotPlan);
  await saveStage(input.outputDir, "02-creative-options.md", ideas);

  const plan = await runAgentText([
    "角色：主编 Agent。整合主线架构师方案和创意发散建议，决定本章唯一执行方案。",
    common,
    "主线方案：", plotPlan, "创意备选：", ideas,
    "只采纳不破坏人物动机、既有事实和长期主线的创意。输出最终章节蓝图，逐场列出视角、人物、地点、目标、阻力、行动、信息变化和场景结果；区分确定事实与本章新创作。"
  ].join("\n\n"), input.model);
  await saveStage(input.outputDir, "03-chapter-plan.md", plan);

  const initialDraft = await runAgentText([
    "角色：场景小说家。根据最终蓝图写完整章节正文，不输出分析。",
    common, "最终章节蓝图：", plan,
    "目标篇幅约 " + input.maxWords + " 个中文字符。通过场景、行动、选择和后果推进；不要用概述代替关键场景。"
  ].join("\n\n"), input.model);
  await saveStage(input.outputDir, "04-scene-draft.md", initialDraft);

  const dialogueDraft = await runAgentText([
    "角色：人物对话编辑。专门修整人物对白和对白相关动作，不改变剧情事实、场景顺序、人物决定和信息揭示。",
    common, "章节蓝图：", plan, "当前正文：", initialDraft,
    "检查每个人物的词汇、句长、表达习惯、身份关系、情绪和已知信息。删掉解释性过强、所有角色都像同一个人的对白；让潜台词通过停顿、回避、误解和行动体现。输出完整修订正文。"
  ].join("\n\n"), input.model);
  await saveStage(input.outputDir, "05-dialogue-edited.md", dialogueDraft);

  const voiceDraft = await runAgentText([
    "角色：叙事声音与文风编辑。只负责统一全章叙述声音，不负责改剧情。",
    common, "章节蓝图：", plan, "当前正文：", dialogueDraft,
    "统一叙述视角、时态、句长变化、段落节奏、叙述距离、动作/环境/心理描写比例和悬念节奏。保持中文自然、有变化，避免模板化排比、总结句、过度解释和重复修辞。不得复刻任何特定作者的独特句式或标志性表达。输出完整修订正文。"
  ].join("\n\n"), input.model);
  await saveStage(input.outputDir, "06-voice-edited.md", voiceDraft);

  const review = await runAgentText([
    "角色：连续性与剧情审查 Agent。只报告问题，不重写正文。",
    common, "章节蓝图：", plan, "待审正文：", voiceDraft,
    "检查：主线目标是否推进、人物动机/知识/能力是否越界、时间地点是否冲突、因果是否成立、伏笔是否误回收、对白是否泄露未知信息、场景是否有有效变化。每项给出原文证据、严重程度（blocker/major/minor）和最小修复建议。区分事实错误与个人偏好。"
  ].join("\n\n"), input.model);
  await saveStage(input.outputDir, "07-continuity-review.md", review);

  const chapter = await runAgentText([
    "角色：主编终审 Agent。根据审查结果完成最终修订，只输出小说正文。",
    common, "最终章节蓝图：", plan, "当前正文：", voiceDraft, "连续性审查：", review,
    "必须修复 blocker 和有证据支持的 major 问题。不要机械接受主观建议，不要增加未经铺垫的设定或反转。保留已经成立的对白和叙事节奏。"
  ].join("\n\n"), input.model);
  await saveStage(input.outputDir, "chapter.md", chapter);

  const stateText = await runAgentText([
    "角色：小说连续性资料管理员。根据旧状态和最终章节提取本章状态变化。",
    "只输出合法 JSON 对象，不要 Markdown 代码围栏。结构：",
    JSON.stringify({
      currentPosition: "string",
      canonFacts: [{ id: "stable-id", fact: "fact", source: "chapter id", confidence: "confirmed|inferred|original" }],
      characters: [{ name: "name", status: "current status", location: "optional", abilities: ["only changed/new known abilities"], knowledge: ["new knowledge"], goals: ["current goals"], relationships: ["changed relationships"] }],
      events: [{ id: "stable-id", summary: "event", position: "story position", participants: ["name"], consequences: ["consequence"] }],
      plotThreads: [{ id: "stable-id", title: "thread", status: "open|active|resolved|abandoned", lastUpdated: "chapter id", notes: "latest state" }],
      continuityNotes: ["facts future chapters must preserve"]
    }, null, 2),
    "旧状态：", JSON.stringify(state, null, 2), "最终章节：", chapter,
    "只记录章节明确支持的内容。无法确认的内容不要写入 canonFacts；推断必须标为 inferred。人物和情节线只输出本章新增或发生变化的记录。"
  ].join("\n\n"), input.model);

  try {
    const update = extractJson(stateText) as Partial<StoryState>;
    const nextState = mergeState(state, update);
    // 模型提取的状态默认只作为本次运行的工作记录；人工核对后才用它替换正史状态。
    if (input.applyState) await saveStoryState(input.statePath, nextState);
    await saveStage(input.outputDir, "08-state-update.json", JSON.stringify(nextState, null, 2));
  } catch (error) {
    await saveStage(input.outputDir, "08-state-update-error.txt", String(error) + "\n\n" + stateText);
    throw new Error("Chapter was generated, but story-state update failed. See 08-state-update-error.txt; do not start the next chapter until reconciled.");
  }
  return chapter;
}
