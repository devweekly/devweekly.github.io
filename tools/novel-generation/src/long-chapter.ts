// 万字章节流水线：一次规划、逐场成文、分批审校与文风统一。
// 不复用 SDK session；场景之间靠落盘的原文结尾与事实清单显式交接，可逐场重跑。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadStoryState, parseStoryStateUpdate, saveStoryState } from "./story-state.js";
import type { StoryState } from "./story-state.js";
import { runAgentText, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { RHYTHM_RULE, mergeStoryState } from "./workflow.js";
import { searchLibrary } from "./library.js";
import { formatReview, reviewAndRepair, reviewPrompt } from "./chapter-review.js";

export interface LongChapterInput {
  worldId: string;
  mode: GenerationMode;
  brief: string;
  worldBible: string;
  styleProfile?: string;
  styleRhythm?: string;
  sourceText?: string;
  contextText?: string;
  model?: string;
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

/** 与 style-rhythm.md 相同的句长口径，用于成稿验收。 */
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
  if (headings.length !== expected) {
    throw new Error(`场景蓝图应包含 ${expected} 个场景标题，实际识别到 ${headings.length} 个；请检查 01-scene-blueprint.md 后重试。`);
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
  const state = await loadStoryState(input.statePath, input.worldId);
  const profiles = readTaskProfiles();
  await mkdir(input.outputDir, { recursive: true });
  const call = (stage: StageKey, parts: string[]): Promise<string> =>
    runAgentText(parts.join("\n\n"), input.model, input.timeoutMs, profiles[stage]);

  const facts = [
    ...state.canonFacts.map(fact => fact.fact),
    ...state.continuityNotes
  ].join("\n");
  const writingContext = [
    "世界设定（辅助索引，未知内容不得写成原著事实）：", input.worldBible,
    "当前位置：", state.currentPosition,
    "已确认事实与连续性约束：", facts,
    input.contextText ? "前文与连续性摘要：\n" + input.contextText : "",
    input.sourceText ? "用户提供且有权使用的续写起点（只用于承接，不得整段复制）：\n" + input.sourceText : "",
    input.styleProfile ? "叙事风格约束：\n" + input.styleProfile : "",
    input.styleRhythm ? "叙事节奏复核：\n" + input.styleRhythm : "",
    input.mode === "continuation" ? "创作模式：续写，严格承接材料最后一个有效情节节点。" : "创作模式：原创衍生，项目原创内容不得伪装成原著事实。",
    "本次创作任务：", input.brief
  ].filter(Boolean).join("\n\n");

  const perScene = Math.ceil(input.maxWords / input.scenes * 1.15);
  const blueprintPrompt = [
    "角色：长篇章节主编。为一万字章节制定唯一执行蓝图，不写正文。",
    writingContext,
    `把整章拆成恰好 ${input.scenes} 个连续场景，每个场景用单独一行 "## 场景 N" 开头（N 从 1 到 ${input.scenes}），后面依次写：视角、人物、地点、时间、目标、阻力、行动与信息变化、场景结果、本场须埋或须收的伏笔、本场节奏（放慢或提速）。`,
    `每场目标 ${perScene} 个汉字；全章合计约 ${input.maxWords} 个汉字。场景之间必须有因果或时间推进，不写并列的小品。`,
    "区分原著已确认事实与本章新创作。不得安排新果实、十主完整名单、天母去向的解释、人物提前获知未知信息。",
    RHYTHM_RULE,
    "整章节奏应有场景差异，但不按固定数量分配快慢场景。"
  ];
  let blueprint = await call("plan", blueprintPrompt);
  let scenePlans: string[];
  try {
    scenePlans = splitScenes(blueprint, input.scenes);
  } catch (error) {
    await saveStage(input.outputDir, "01-scene-blueprint-attempt-1.md", blueprint);
    blueprint = await call("plan", [
      ...blueprintPrompt,
      "上一次场景蓝图未通过程序格式校验：" + String(error),
      "请修正上一版蓝图，必须恰好输出连续编号的场景标题，从场景 1 到场景 " + input.scenes + "，每场内容非空。只输出修正后的完整蓝图，不解释。",
      "上一次蓝图：",
      blueprint
    ]);
    scenePlans = splitScenes(blueprint, input.scenes);
  }
  await saveStage(input.outputDir, "01-scene-blueprint.md", blueprint);
  const sceneTexts: string[] = [];
  for (let index = 0; index < input.scenes; index++) {
    const previous = sceneTexts.length ? tail(sceneTexts[sceneTexts.length - 1]!, 3600) : "（本章第一场，无前文）";
    const sceneRetrieval = input.libraryDir
      ? await searchLibrary(input.libraryDir, [input.brief, scenePlans[index]!, ...state.characters.map(character => character.name)].join("\n"), input.retrievalLimit ?? 4)
      : [];
    const sceneEvidence = sceneRetrieval.map((hit, hitIndex) =>
      `[${hitIndex + 1}, score ${hit.score.toFixed(2)}] ${hit.source} / ${hit.chapter} / offset ${hit.start}-${hit.end}\n${hit.text}`
    ).join("\n\n");
    await saveStage(input.outputDir, `00-scene-${String(index + 1).padStart(2, "0")}-retrieval.md`, sceneEvidence || "本场未检索到额外原文证据。");
    const scenePrompt = [
      `角色：场景小说家。只写第 ${index + 1} 场完整正文，不输出标题、分析或创作说明。`,
      writingContext,
      "全章蓝图：", blueprint,
      `本场蓝图：`, scenePlans[index]!,
      "本场相关原文证据（只用于核实事实，不得照搬）：", sceneEvidence,
      "上一场正文的连续性上下文（重点承接人物位置、已知信息、关系变化、道具归属、未完成动作与场景结果，不得重复）：", previous,
      `本场目标 ${perScene} 个汉字。写完整场景：人物在具体地点做事、遇到阻力、做出选择、承担后果。不要用概述代替关键场景，不要跳到下一场。`,
      RHYTHM_RULE,
      "根据本场功能安排长短句、对白和感官细节；推理或交涉可以展开长句，动作和情绪落点可以短句收束。不要为了满足固定字数或清单配额而添加无功能内容。",
      "不复制原文句子，不以近义词替换改写原文；不写「未完待续」「本场结束」等标记。"
    ];
    let text = await call("scene", scenePrompt);
    if (chineseChars(text) < perScene * 0.82) {
      const extra = await call("scene", [
        scenePrompt[0]!, "已写出的本场正文：", text,
        `本场仍缺字数。从现有最后一句接着往后写，补足到约 ${perScene} 个汉字；不重复、不改写已有内容，不提前收束全章。`,
        RHYTHM_RULE
      ]);
      text = text.trim() + "\n\n" + extra.trim();
    }
    sceneTexts.push(text.trim());
    await saveStage(input.outputDir, `02-scene-${String(index + 1).padStart(2, "0")}.md`, text);
    console.error(`[write-long] 场景 ${index + 1}/${input.scenes} · ${chineseChars(text)} 汉字`);
  }

  const draft = sceneTexts.join("\n\n---\n\n");
  await saveStage(input.outputDir, "03-draft.md", draft);

  // 审查只看问题清单，分两批控制单次输入；输出合并后交给逐场修订。
  const halves = [sceneTexts.slice(0, Math.ceil(input.scenes / 2)), sceneTexts.slice(Math.ceil(input.scenes / 2))];
  const reviews: string[] = [];
  for (let index = 0; index < halves.length; index++) {
    reviews.push(await call("review", [
      "角色：连续性与剧情审查 Agent。只报告问题，不重写正文。",
      writingContext, "全章蓝图：", blueprint,
      `第 ${index + 1} 批待审正文：`, halves[index]!.join("\n\n---\n\n"),
      "检查人物动机/知识/能力边界、时间地点、因果、伏笔、对白泄密、场景变化与设定冲突。每项给原文短证据、严重程度（blocker/major/minor）和最小修复建议。",
      "另检查节奏：指出整段急促、缺少长句、连续短句超过 8 句的位置。区分事实错误与个人偏好。"
    ]));
  }
  const review = reviews.join("\n\n---\n\n");
  await saveStage(input.outputDir, "04-continuity-review.md", review);

  const polished: string[] = [];
  for (let index = 0; index < sceneTexts.length; index++) {
    const text = await call("voice", [
      "角色：人物对话编辑兼叙事声音编辑。只修订这一场的对白与叙述表达，不改剧情事实、场景顺序、人物决定和信息揭示。",
      writingContext, "全章蓝图：", blueprint, "连续性审查（只修有证据支持的问题）：", review,
      `第 ${index + 1} 场当前正文：`, sceneTexts[index]!,
      "校准人物语气与知识边界，删解释性过强、所有人同一腔调的对白；统一视角与叙述距离。",
      RHYTHM_RULE,
      "输出本场完整修订正文，字数不得少于原场；保留长句、清单与放慢段落，不得把全章改成短促腔，不得新增标题或创作说明。"
    ]);
    polished.push(text.trim());
    await saveStage(input.outputDir, `05-polish-${String(index + 1).padStart(2, "0")}.md`, text);
    console.error(`[write-long] 修订 ${index + 1}/${input.scenes} · ${chineseChars(text)} 汉字`);
  }

  const chapterTitle = "# " + (input.mode === "continuation" ? "续写章节" : "衍生章节") + "\n\n";
  const buildChapter = (): string => chapterTitle + polished.join("\n\n---\n\n") + "\n";
  const reviewHistory: string[] = [];
  const reviewed = await reviewAndRepair({
    initialChapter: buildChapter(),
    sceneCount: input.scenes,
    maxRepairRounds: 2,
    review: (candidate, correction) => call("review", [
      reviewPrompt({
        context: writingContext,
        blueprint,
        chapter: candidate,
        priorReview: review,
        sceneCount: input.scenes,
        correction
      })
    ]),
    repair: async (_candidate, issues, round) => {
      const affectedScenes = [...new Set(issues.flatMap(issue => issue.scenes))].sort((a, b) => a - b);
      for (const sceneNumber of affectedScenes) {
        const sceneIssues = issues.filter(issue => issue.scenes.includes(sceneNumber));
        const index = sceneNumber - 1;
        const currentScene = polished[index];
        if (currentScene === undefined) throw new Error("Review referenced a missing scene: " + sceneNumber);
        const revised = await call("voice", [
          "角色：场景修复编辑。只修复指定场景中的实质问题，输出本场完整正文，不得输出解释或标题。",
          writingContext,
          "全章蓝图：", blueprint,
          "原始分场审查：", review,
          "最终全章审查发现：", JSON.stringify(sceneIssues, null, 2),
          "当前场景正文：", currentScene,
          "本轮自动修复：" + round,
          "修复要求：解决列出的问题，保留本场已成立的人物选择、信息揭示和文学表达；不得引入与其他场景冲突的新事实。跨场问题应遵守其他受影响场景已确认的事实。除修复问题外尽量保持原文。"
        ]);
        if (chineseChars(revised) < chineseChars(currentScene) * 0.85) {
          throw new Error("Automatic repair shortened scene " + sceneNumber + " by more than 15%; refusing to silently lose story content.");
        }
        polished[index] = revised.trim();
        await saveStage(input.outputDir, "05-polish-" + String(sceneNumber).padStart(2, "0") + "-repair-" + round + ".md", revised);
      }
      return buildChapter();
    },
    onReview: async (round, candidate, report) => {
      reviewHistory.push("## 全章复查轮次 " + (round + 1) + "\n\n" + formatReview(report));
      await saveStage(input.outputDir, "08-final-review-round-" + (round + 1) + ".json", JSON.stringify(report, null, 2));
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
  const metrics = { target: input.maxWords, scenes: input.scenes, ...rhythmMetrics(chapter) };
  await saveStage(input.outputDir, "06-rhythm-metrics.json", JSON.stringify(metrics, null, 2));
  console.error("[write-long] 成稿 " + metrics.chars + " 汉字 · 均句长 " + metrics.mean + " · 长句 " + (metrics.long * 100).toFixed(1) + "% · 自动修复 " + reviewed.repairRounds + " 轮");

  const stateText = await call("state", [
    "角色：小说连续性资料管理员。根据旧状态和最终章节提取状态变化。",
    "只输出合法 JSON 对象，不要 Markdown 代码围栏。结构：",
    JSON.stringify({
      currentPosition: "string",
      canonFacts: [{ id: "stable-id", fact: "fact", source: "chapter id", confidence: "confirmed|inferred|original" }],
      characters: [{ name: "name", profile: { coreTraits: ["stable traits"], values: ["values"], contradictions: ["internal contradictions"], voice: "distinctive voice", boundaries: ["behavioral boundaries"], arc: "long-term arc" }, status: "current status", location: "current location", abilities: ["current abilities"], knowledge: ["current knowledge"], goals: ["current goals"], relationships: ["current relationships"] }],
      events: [{ id: "stable-id", summary: "event", position: "story position", participants: ["name"], consequences: ["consequence"] }],
      plotThreads: [{ id: "stable-id", title: "thread", status: "open|active|resolved|abandoned", lastUpdated: "chapter id", notes: "latest state" }],
      continuityNotes: ["facts future chapters must preserve"]
    }, null, 2),
    "旧状态：", JSON.stringify(state, null, 2),
    "最终章节全文（状态提取必须覆盖每一场的人物、事件、事实与情节线变化）：", chapter,
    "profile 记录相对稳定的性格底色、价值观、内在矛盾、语言习惯和行为边界；不要因单次行为轻易改写。其他字段是章节结束时的当前状态快照，数组必须给出完整当前值。人物弧光可以改变人物，但必须由选择、压力、代价和行为证据支撑，不得刻板化，也不得为制造反转而突然黑化/洗白。只记录章节明确支持的内容；推断标为 inferred，项目原创内容标为 original，不得写进原著正史。"
  ]);
  try {
    const cleaned = stateText.trim().replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/i, "");
    const update = parseStoryStateUpdate(JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as unknown);
    const nextState = mergeStoryState(state, update);
    if (input.applyState) await saveStoryState(input.statePath, nextState);
    await saveStage(input.outputDir, "07-state-update.json", JSON.stringify(nextState, null, 2));
  } catch (error) {
    await saveStage(input.outputDir, "07-state-update-error.txt", String(error) + "\n\n" + stateText);
    throw new Error("Chapter was generated, but story-state extraction or persistence failed. See 07-state-update-error.txt; do not start the next chapter until the state is reconciled.");
  }
  return chapter;
}
