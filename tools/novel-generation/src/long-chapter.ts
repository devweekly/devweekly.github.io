// 万字章节流水线：一次规划、逐场成文、分批审校与文风统一。
// 不复用 SDK session；场景之间靠落盘的原文结尾与事实清单显式交接，可逐场重跑。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadStoryState, saveStoryState, type StoryState } from "./story-state.js";
import { runAgentText, type GenerationMode } from "./generate.js";
import { readTaskProfiles, type StageKey } from "./task-profiles.js";
import { RHYTHM_RULE } from "./workflow.js";

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

/** 按 `## 场景 N` 切蓝图；模型没按格式输出时退回整份蓝图，不让后续场景失去约束。 */
function splitScenes(plan: string, expected: number): string[] {
  const parts = plan.split(/^##\s*场景\s*\d+.*$/m).map(part => part.trim()).filter(Boolean);
  if (parts.length >= expected) return parts.slice(-expected);
  return Array.from({ length: expected }, () => plan.trim());
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
  const blueprint = await call("plan", [
    "角色：长篇章节主编。为一万字章节制定唯一执行蓝图，不写正文。",
    writingContext,
    `把整章拆成恰好 ${input.scenes} 个连续场景，每个场景用单独一行 "## 场景 N" 开头（N 从 1 到 ${input.scenes}），后面依次写：视角、人物、地点、时间、目标、阻力、行动与信息变化、场景结果、本场须埋或须收的伏笔、本场节奏（放慢或提速）。`,
    `每场目标 ${perScene} 个汉字；全章合计约 ${input.maxWords} 个汉字。场景之间必须有因果或时间推进，不写并列的小品。`,
    "区分原著已确认事实与本章新创作。不得安排新果实、十主完整名单、天母去向的解释、人物提前获知未知信息。",
    RHYTHM_RULE,
    "整章节奏：至少两场放慢（日常、器物、长对白、局势推断），至少两场提速（动作、交锋、拆段推进），不得全章同一速度。"
  ]);
  await saveStage(input.outputDir, "01-scene-blueprint.md", blueprint);
  const scenePlans = splitScenes(blueprint, input.scenes);

  const sceneTexts: string[] = [];
  for (let index = 0; index < input.scenes; index++) {
    const previous = sceneTexts.length ? tail(sceneTexts[sceneTexts.length - 1]!, 900) : "（本章第一场，无前文）";
    const scenePrompt = [
      `角色：场景小说家。只写第 ${index + 1} 场完整正文，不输出标题、分析或创作说明。`,
      writingContext,
      "全章蓝图：", blueprint,
      `本场蓝图：`, scenePlans[index]!,
      "上一场已写正文的结尾（用于承接语气、人物位置与未完成动作，不得重复其内容）：", previous,
      `本场目标 ${perScene} 个汉字。写完整场景：人物在具体地点做事、遇到阻力、做出选择、承担后果。不要用概述代替关键场景，不要跳到下一场。`,
      RHYTHM_RULE,
      "本场至少一处 45 字以上的逗号串联长对白或长叙述，随后用 12 字以内的短句收住；至少一处器物或感官清单。",
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

  const chapter = "# " + (input.mode === "continuation" ? "续写章节" : "衍生章节") + "\n\n" +
    polished.join("\n\n---\n\n") + "\n";
  await saveStage(input.outputDir, "chapter.md", chapter);
  const metrics = { target: input.maxWords, scenes: input.scenes, ...rhythmMetrics(chapter) };
  await saveStage(input.outputDir, "06-rhythm-metrics.json", JSON.stringify(metrics, null, 2));
  console.error(`[write-long] 成稿 ${metrics.chars} 汉字 · 均句长 ${metrics.mean} · 长句 ${(metrics.long * 100).toFixed(1)}%`);

  const stateText = await call("state", [
    "角色：小说连续性资料管理员。根据旧状态和最终章节提取状态变化。",
    "只输出合法 JSON 对象，不要 Markdown 代码围栏。结构：",
    JSON.stringify({
      currentPosition: "string",
      canonFacts: [{ id: "stable-id", fact: "fact", source: "chapter id", confidence: "confirmed|inferred|original" }],
      characters: [{ name: "name", status: "current status", knowledge: ["new knowledge"], goals: ["current goals"] }],
      events: [{ id: "stable-id", summary: "event", position: "story position", participants: ["name"], consequences: ["consequence"] }],
      plotThreads: [{ id: "stable-id", title: "thread", status: "open|active|resolved|abandoned", notes: "latest state" }],
      continuityNotes: ["facts future chapters must preserve"]
    }, null, 2),
    "旧状态：", JSON.stringify(state, null, 2),
    "章节结尾（状态提取以这里为准）：", tail(chapter, 4500),
    "只记录章节明确支持的内容；推断标为 inferred，项目原创内容标为 original，不得写进原著正史。"
  ]);
  try {
    const cleaned = stateText.trim().replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/i, "");
    const update = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as Partial<StoryState>;
    const nextState: StoryState = {
      ...state,
      currentPosition: update.currentPosition || state.currentPosition,
      canonFacts: [...state.canonFacts, ...(update.canonFacts ?? [])],
      characters: [...state.characters, ...(update.characters ?? [])],
      events: [...state.events, ...(update.events ?? [])],
      plotThreads: [...state.plotThreads, ...(update.plotThreads ?? [])],
      continuityNotes: [...new Set([...state.continuityNotes, ...(update.continuityNotes ?? [])])],
      updatedAt: new Date().toISOString()
    };
    if (input.applyState) await saveStoryState(input.statePath, nextState);
    await saveStage(input.outputDir, "07-state-update.json", JSON.stringify(nextState, null, 2));
  } catch (error) {
    await saveStage(input.outputDir, "07-state-update-error.txt", String(error) + "\n\n" + stateText);
    console.error("[write-long] 状态提取失败，成稿不受影响：" + String(error));
  }
  return chapter;
}
