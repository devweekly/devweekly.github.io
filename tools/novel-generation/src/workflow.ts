import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStoryStateUpdate, saveStoryState, type StoryState } from "./story-state.js";
import { runAgentText, resolveModelAttempts, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { formatReview, parseChapterReview, reviewAndRepair, reviewPrompt } from "./chapter-review.js";
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
  storyAnalysisContext?: string;
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
    canonFacts: mergeBy(current.canonFacts, update.canonFacts ?? [], item => item.id),
    characters: mergeBy(current.characters, update.characters ?? [], item => item.name.trim().toLocaleLowerCase()),
    events: mergeBy(current.events, update.events ?? [], item => item.id),
    plotThreads: mergeBy(current.plotThreads, update.plotThreads ?? [], item => item.id),
    // Current active notes are a snapshot, not an append-only history.
    continuityNotes: update.continuityNotes ?? current.continuityNotes,
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

  const common = [
    "世界设定：", input.worldBible,
    "当前故事状态（已有记录优先；不得擅自改写已确认事实）：", JSON.stringify(state, null, 2),
    input.contextText ? "用户补充的前文摘要：\n" + input.contextText : "",
    input.retrievedContext ? "本地资料库证据（用于核实事实，不得整段复制）：\n" + input.retrievedContext : "",
    input.storyAnalysisContext ? "既有小说分析参考（仅供启发，不是正史或写作清单）：\n" + input.storyAnalysisContext : "",
    input.sourceText ? "用户提供且有权使用的续写材料：\n" + input.sourceText : "",
    input.styleProfile ? "本项目叙事风格参考（仅使用抽象写作特征，不模仿特定作者的独特表达；参考不能凌驾于当前人物、场景需要和文学表达）：\n" + input.styleProfile : "",
    input.mode === "continuation" ? "创作模式：续写。严格承接用户提供的合法文本和当前故事状态。" : "创作模式：原创衍生。不得把项目原创内容伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  // 主线架构与创意发散并行；主编决定哪些点子能进正文，发散本身不构成正史。
  const [plotPlan, ideas] = await Promise.all([
    cachedCall("plot", "01-main-plot.md", "plot", [
      "角色：主线剧情架构师。负责本章主线推进和长篇结构，不写正文。",
      common,
      "提出有吸引力的章节构想，帮助这一章真正好看、能让人物活起来。可考虑主线、人物关系、冲突、悬念、意外性和后续空间，但不要求每项都出现；允许从一个鲜活场景、一段对话或一个反常细节自然生长。只标出确实不能改变的已知事实，不要把创意写成分析报告。"
    ]),
    cachedCall("creative", "02-creative-options.md", "creative", [
      "角色：创意发散 Agent。只负责提出有戏剧价值的备选创意，不负责决定正史。",
      common,
      "自由发散若干真正不同、鲜活、有戏剧性的可能性，可以大胆、怪异、温柔、残酷或出人意料。不要为了数量凑点子，也不必把每个点子拆成固定字段。关注它能带来什么人物互动、情绪、冲突或故事惊喜；不要写正文，不要把建议当作已发生事实。"
    ])
  ]);
  await saveStage(input.outputDir, "01-main-plot.md", plotPlan);
  await saveStage(input.outputDir, "02-creative-options.md", ideas);

  const plan = await cachedCall("plan", "03-chapter-plan.md", "plan", [
    "角色：主编 Agent。整合主线架构师方案和创意发散建议，决定本章唯一执行方案。",
    common,
    "主线方案：", plotPlan, "创意备选：", ideas,
    "选出最有小说感染力的方向，形成自然、有变化的章节构想。蓝图帮助写作者理解人物处境和故事走向，不是逐项验收的合同；不要求每场都按目标、阻力、行动、信息变化、结果的模板展开。保留人物的意外性、闲笔和情绪空间。不得无意违反已确认事实；区分确知内容与新创作。"
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
      return cachedCall("quality-review-" + round + (correction ? "-retry" : ""), "07-review-round-" + round + (correction ? "-retry" : "") + "-raw.txt", "review", [
        reviewPrompt({ context: common, blueprint: plan, chapter: candidate, correction })
      ], output => parseChapterReview(output, candidate));
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
      characters: [{ name: "name", profile: { coreTraits: ["stable traits"], values: ["values"], contradictions: ["internal contradictions"], voice: "distinctive voice", boundaries: ["what this character will not easily do"], arc: "current long-term character arc" }, status: "current status", location: "current location", abilities: ["current abilities"], knowledge: ["current known information"], goals: ["current goals"], relationships: ["current relationships"], arcMilestones: [{ id: "stable-milestone-id", chapter: "chapter id", change: "what changed", evidence: "exact excerpt from final chapter", choice: "optional, only if naturally clear", pressure: "optional, only if naturally clear", cost: "optional, only if naturally clear" }] }],
      events: [{ id: "stable-id", summary: "event", position: "story position", participants: ["name"], consequences: ["consequence"] }],
      plotThreads: [{ id: "stable-id", title: "thread", status: "open|active|resolved|abandoned", lastUpdated: "chapter id", notes: "latest state" }],
      continuityNotes: ["facts future chapters must preserve"]
    }, null, 2),
    "旧状态：", JSON.stringify(state, null, 2), "最终章节：", chapter,
    "continuityNotes 必须返回章节结束时仍然有效的完整备注集合，不是只列新增项；已经变化、解决或被新事实替代的旧备注不要继续返回。人物 profile 是相对稳定的性格底色、价值观、内在矛盾、语言习惯与行为边界；不要因单次情绪或行为轻易改写。character 的 status/location/abilities/knowledge/goals/relationships 是当前剧情状态，必须反映本章结束时的最新快照，数组应给出完整当前值而非只追加变化项。人物可以变化、反复、倒退、误判，也可以做出出乎意料的选择；不要把人物锁死成标签。状态提取只记录正文已经发生的事，不得要求正文为了状态字段而解释动机或安排代价。只记录章节明确支持的内容。无法确认的内容不要写入 canonFacts；推断必须标为 inferred。人物和情节线只输出本章新增或发生变化的记录。只有正文自然呈现重要转折时才追加 arcMilestones；不要为了填写字段而拔高普通情节或反向要求正文增加解释。"
  ]);

  let update: Partial<StoryState>;
  try {
    update = parseStoryStateUpdate(extractJson(stateText), chapter);
  } catch (firstError) {
    try {
      const retryText = await cachedCall("state-update-retry", "08-state-update-retry-raw.json", "state", [
        "上一次状态提取未通过 JSON 或 schema 校验：" + String(firstError),
        "上一次输出：", stateText,
        "请重新根据旧状态和下面的最终章节全文提取，只输出符合既定 JSON schema 的对象；continuityNotes 必须返回完整的当前有效备注数组；不要添加 Markdown、解释或 schema 外字段。",
        "旧状态：", JSON.stringify(state, null, 2),
        "最终章节全文：", chapter
      ]);
      update = parseStoryStateUpdate(extractJson(retryText), chapter);
    } catch (retryError) {
      await saveStage(input.outputDir, "08-state-update-error.txt", "First attempt: " + String(firstError) + "\nRetry: " + String(retryError) + "\n\n" + stateText);
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
