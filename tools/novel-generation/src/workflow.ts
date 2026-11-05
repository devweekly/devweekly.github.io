import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadStoryState, parseStoryStateUpdate, saveStoryState, type StoryState } from "./story-state.js";
import { runAgentText, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { formatReview, reviewAndRepair, reviewPrompt } from "./chapter-review.js";
import { loadRunStoryState, runCachedStage } from "./stage-cache.js";

export interface WriteWorkflowInput {
  worldId: string;
  mode: GenerationMode;
  brief: string;
  worldBible: string;
  styleProfile?: string;
  styleRhythm?: string;
  sourceText?: string;
  contextText?: string;
  retrievedContext?: string;
  model?: string;
  strictModel?: boolean;
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
          if (Array.isArray(value)) merged[field] = [...value];
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
    canonFacts: mergeBy(current.canonFacts, update.canonFacts ?? [], item => item.id),
    characters: mergeBy(current.characters, update.characters ?? [], item => item.name.trim().toLocaleLowerCase()),
    events: mergeBy(current.events, update.events ?? [], item => item.id),
    plotThreads: mergeBy(current.plotThreads, update.plotThreads ?? [], item => item.id),
    continuityNotes: [...new Set([...current.continuityNotes, ...(update.continuityNotes ?? [])])],
    updatedAt: new Date().toISOString()
  };
}

async function saveStage(dir: string, name: string, content: string): Promise<void> {
  await writeFile(resolve(dir, name), content.trim() + "\n", "utf8");
}

/** 节奏要求同时交给成文、文风修订和终审，避免后两个阶段把长句又改回短句。 */
export const RHYTHM_RULE = [
  "节奏参考基线（按句末标点切句、只计汉字；短句 ≤10 字、长句 ≥31 字、超长句 ≥60 字）。这些数字来自语料抽样，只用于提醒节奏倾向，不是每章、每场必须完成的配额。",
  "交锋与审讯通常允许更长的句子和较高的长句比例；铺陈与制度说明通常比动作场景舒展。先判断当前场景功能，再决定句长，不为了命中平均值硬加长句或删短句。",
  "段落：段落应承担一个叙事拍点；心理反应可以独立成段，也可以融入动作。不要为命中段均句数或单句段落比例拆分、合并段落。",
  "逗号与标点：标点服务于语气、因果和阅读节奏；问号、感叹号、破折号按人物情绪和场景需要使用，不按每千字配额补标点。",
  "长句：在推理、交涉、观察和因果链复杂的场景中允许有信息密度高的长句；动作转折和情绪落点可以用短句。两者都必须有场景功能。",
  "对白：关键人物需要表达复杂立场时允许较长连续对白；寡言、戒备、失态或关系紧张时，短句和停顿同样合理。避免机械要求每个人物都说长段自述。",
  "回声式确认和重复句式应结合人物关系与对话目的判断；统计指标偏离只能触发检查，不能单独触发自动改写。"
].join("\n");

export async function writeChapter(input: WriteWorkflowInput): Promise<string> {
  const state = await loadRunStoryState(input.statePath, input.worldId, input.outputDir);
  const profiles = readTaskProfiles();
  const call = (stage: StageKey, parts: string[]): Promise<string> =>
    runAgentText(parts.join("\n\n"), input.model, undefined, profiles[stage], !input.strictModel);
  const cachedCall = (key: string, outputFile: string, stage: StageKey, parts: string[]): Promise<string> => {
    const prompt = parts.join("\n\n");
    return runCachedStage({
      dir: input.outputDir, key, outputFile,
      fingerprint: JSON.stringify({ prompt, model: input.model ?? null, profile: profiles[stage], strictModel: input.strictModel ?? false }),
      execute: () => call(stage, parts)
    });
  };
  await mkdir(input.outputDir, { recursive: true });
  if (input.retrievedContext) await saveStage(input.outputDir, "00-retrieval.md", input.retrievedContext);

  const common = [
    "世界设定：", input.worldBible,
    "当前故事状态（已有记录优先；不得擅自改写已确认事实）：", JSON.stringify(state, null, 2),
    input.contextText ? "用户补充的前文摘要：\n" + input.contextText : "",
    input.retrievedContext ? "本地资料库证据（用于核实事实，不得整段复制）：\n" + input.retrievedContext : "",
    input.sourceText ? "用户提供且有权使用的续写材料：\n" + input.sourceText : "",
    input.styleProfile ? "本项目叙事风格约束（仅使用抽象写作特征，不模仿特定作者的独特表达）：\n" + input.styleProfile : "",
    input.styleRhythm ? "叙事节奏复核（量化基线与长短句功能）：\n" + input.styleRhythm : "",
    input.mode === "continuation" ? "创作模式：续写。严格承接用户提供的合法文本和当前故事状态。" : "创作模式：原创衍生。不得把项目原创内容伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  // 主线架构与创意发散并行；主编决定哪些点子能进正文，发散本身不构成正史。
  const [plotPlan, ideas] = await Promise.all([
    cachedCall("plot", "01-main-plot.md", "plot", [
      "角色：主线剧情架构师。负责本章主线推进和长篇结构，不写正文。",
      common,
      "输出可执行章节方案：本章主线目标、因果链、场景顺序、关键选择及代价、与长期主线/伏笔的关系、结尾状态。明确哪些事实不可改变。"
    ]),
    cachedCall("creative", "02-creative-options.md", "creative", [
      "角色：创意发散 Agent。只负责提出有戏剧价值的备选创意，不负责决定正史。",
      common,
      "提出最多 5 个不同方向的情节/冲突/信息揭示方案。每项说明新鲜点、人物动机、代价、与现有设定的冲突风险。至少给出一个低风险方案和一个高风险方案。不要写正文，不要擅自把建议当作已发生事实。"
    ])
  ]);
  await saveStage(input.outputDir, "01-main-plot.md", plotPlan);
  await saveStage(input.outputDir, "02-creative-options.md", ideas);

  const plan = await cachedCall("plan", "03-chapter-plan.md", "plan", [
    "角色：主编 Agent。整合主线架构师方案和创意发散建议，决定本章唯一执行方案。",
    common,
    "主线方案：", plotPlan, "创意备选：", ideas,
    "只采纳不破坏人物动机、既有事实和长期主线的创意。输出最终章节蓝图，逐场列出视角、人物、地点、目标、阻力、行动、信息变化和场景结果；区分确定事实与本章新创作。"
  ]);
  await saveStage(input.outputDir, "03-chapter-plan.md", plan);

  const initialDraft = await cachedCall("scene", "04-scene-draft.md", "scene", [
    "角色：场景小说家。根据最终蓝图写完整章节正文，不输出分析。",
    common, "最终章节蓝图：", plan,
    "目标篇幅约 " + input.maxWords + " 个中文字符。通过场景、行动、选择和后果推进；不要用概述代替关键场景。",
    RHYTHM_RULE
  ]);
  await saveStage(input.outputDir, "04-scene-draft.md", initialDraft);

  const dialogueDraft = await cachedCall("dialogue", "05-dialogue-edited.md", "dialogue", [
    "角色：人物对话编辑。专门修整人物对白和对白相关动作，不改变剧情事实、场景顺序、人物决定和信息揭示。",
    common, "章节蓝图：", plan, "当前正文：", initialDraft,
    "检查每个人物的词汇、句长、表达习惯、身份关系、情绪和已知信息。删掉解释性过强、所有角色都像同一个人的对白；让潜台词通过停顿、回避、误解和行动体现。",
    RHYTHM_RULE, "输出完整修订正文，不得缩短篇幅，不得把长对白改成短句问答。"
  ]);
  await saveStage(input.outputDir, "05-dialogue-edited.md", dialogueDraft);

  const voiceDraft = await cachedCall("voice", "06-voice-edited.md", "voice", [
    "角色：叙事声音与文风编辑。只负责统一全章叙述声音，不负责改剧情。",
    common, "章节蓝图：", plan, "当前正文：", dialogueDraft,
    "统一叙述视角、时态、句长变化、段落节奏、叙述距离、动作/环境/心理描写比例和悬念节奏。保持中文自然、有变化，避免模板化排比、总结句、过度解释和重复修辞。不得复刻任何特定作者的独特句式或标志性表达。",
    RHYTHM_RULE, "输出完整修订正文，保留长句与放慢段落，不得把全章改成短促腔。"
  ]);
  await saveStage(input.outputDir, "06-voice-edited.md", voiceDraft);

  const reviewHistory: string[] = [];
  const reviewed = await reviewAndRepair({
    initialChapter: voiceDraft,
    maxRepairRounds: 2,
    review: (candidate, correction) => {
      const round = reviewHistory.length + 1;
      return cachedCall("quality-review-" + round, "07-review-round-" + round + ".json", "review", [
        reviewPrompt({ context: common, blueprint: plan, chapter: candidate, correction })
      ]);
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

  const stateText = await cachedCall("state-update", "08-state-update-raw.json", "state", [
    "角色：小说连续性资料管理员。根据旧状态和最终章节提取本章状态变化。",
    "只输出合法 JSON 对象，不要 Markdown 代码围栏。结构：",
    JSON.stringify({
      currentPosition: "string",
      canonFacts: [{ id: "stable-id", fact: "fact", source: "chapter id", confidence: "confirmed|inferred|original" }],
      characters: [{ name: "name", profile: { coreTraits: ["stable traits"], values: ["values"], contradictions: ["internal contradictions"], voice: "distinctive voice", boundaries: ["what this character will not easily do"], arc: "current long-term character arc" }, status: "current status", location: "current location", abilities: ["current abilities"], knowledge: ["current known information"], goals: ["current goals"], relationships: ["current relationships"] }],
      events: [{ id: "stable-id", summary: "event", position: "story position", participants: ["name"], consequences: ["consequence"] }],
      plotThreads: [{ id: "stable-id", title: "thread", status: "open|active|resolved|abandoned", lastUpdated: "chapter id", notes: "latest state" }],
      continuityNotes: ["facts future chapters must preserve"]
    }, null, 2),
    "旧状态：", JSON.stringify(state, null, 2), "最终章节：", chapter,
    "人物 profile 是相对稳定的性格底色、价值观、内在矛盾、语言习惯与行为边界；不要因单次情绪或行为轻易改写。character 的 status/location/abilities/knowledge/goals/relationships 是当前剧情状态，必须反映本章结束时的最新快照，数组应给出完整当前值而非只追加变化项。人物弧光允许发生真实变化，但必须由连续的选择、压力、代价和行为证据支撑；不要把人物锁死成标签，也不要为了反转强行黑化/洗白。只记录章节明确支持的内容。无法确认的内容不要写入 canonFacts；推断必须标为 inferred。人物和情节线只输出本章新增或发生变化的记录。"
  ]);

  try {
    const update = parseStoryStateUpdate(extractJson(stateText));
    const nextState = mergeStoryState(state, update);
    // 默认自动提交状态；仅在显式隔离/试写模式下保留为本次运行提案。
    if (input.applyState) await saveStoryState(input.statePath, nextState);
    await saveStage(input.outputDir, "08-state-update.json", JSON.stringify(nextState, null, 2));
  } catch (error) {
    await saveStage(input.outputDir, "08-state-update-error.txt", String(error) + "\n\n" + stateText);
    throw new Error("Chapter was generated, but story-state update failed. See 08-state-update-error.txt; do not start the next chapter until reconciled.");
  }
  return chapter;
}
