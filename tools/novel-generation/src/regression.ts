// 回归测试：让写作 Agent 盲写原文某一章，再由独立评审 Agent 对照原文判断写法差异。
// 写法问题（短句堆叠、长句缺失、对白比例失衡）靠数字先量出来，再让评审模型解释成因。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chineseChars } from "./long-chapter.js";
import { runAgentText } from "./generate.js";
import type { TaskProfile } from "./task-profiles.js";
import {
  needsRepair, repairRhythm, rhythmGaps, rhythmScore, shouldAcceptRepair,
  targetsFromMetrics, type RhythmGap, type RhythmTarget
} from "./rhythm.js";

export interface ChapterRef {
  index: number;
  title: string;
  volume: number;
  startLine: number;
  endLine: number;
}

interface ChapterIndexFile {
  volumes?: Array<{
    volume: number;
    startLine: number;
    endLine: number;
    chapters?: Array<{ title: string; line: number }>;
  }>;
}

/**
 * 章节边界取 chapter-index.json：卷内每章的行号就是标题所在行，
 * 下一章标题前一行即本章末行；卷末章用卷的 endLine 收口。
 */
export function loadChapters(index: ChapterIndexFile): ChapterRef[] {
  const chapters: ChapterRef[] = [];
  for (const volume of index.volumes ?? []) {
    const list = volume.chapters ?? [];
    list.forEach((chapter, position) => {
      const next = list[position + 1];
      const endLine = next ? next.line - 1 : volume.endLine;
      chapters.push({
        index: chapters.length + 1,
        title: chapter.title,
        volume: volume.volume,
        startLine: chapter.line,
        endLine
      });
    });
  }
  return chapters;
}

export interface ChapterMetrics {
  characters: number;
  paragraphs: number;
  sentences: number;
  meanSentence: number;
  medianSentence: number;
  p90Sentence: number;
  maxSentence: number;
  shortRatio: number;
  midRatio: number;
  longRatio: number;
  veryLongRatio: number;
  sentencesPerParagraph: number;
  dialogueLineRatio: number;
  commasPerSentence: number;
  charsPerParagraph: number;
  strongPunctPer1000: number;
}

function ratio(part: number, total: number): number {
  return total ? Number((part / total).toFixed(3)) : 0;
}

/**
 * 与 style-rhythm.md 相同的口径：按行取段，按句末标点切句，句长只数汉字。
 * 对白行指以引号开头的段落，用来衡量信息是否主要靠对话承载。
 */
export function chapterMetrics(text: string): ChapterMetrics {
  const paragraphs = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !/^#/.test(line));
  const sentences: string[] = [];
  for (const paragraph of paragraphs) {
    for (const part of paragraph.split(/(?<=[。！？…])/)) {
      if (part.trim()) sentences.push(part.trim());
    }
  }
  const lengths = sentences
    .map(sentence => chineseChars(sentence))
    .filter(length => length > 0)
    .sort((a, b) => a - b);
  const total = lengths.length;
  const sum = lengths.reduce((acc, value) => acc + value, 0);
  const at = (percent: number): number => (total ? lengths[Math.min(total - 1, Math.floor(total * percent))]! : 0);
  const body = paragraphs.join("\n");
  const strongPunct = (body.match(/[！？…—]/g) ?? []).length;
  const commas = sentences.reduce((acc, sentence) => acc + (sentence.match(/[，、]/g) ?? []).length, 0);
  return {
    characters: chineseChars(body),
    paragraphs: paragraphs.length,
    sentences: total,
    meanSentence: total ? Number((sum / total).toFixed(1)) : 0,
    medianSentence: total ? Number(((lengths[Math.floor((total - 1) / 2)]! + lengths[Math.ceil((total - 1) / 2)]!) / 2).toFixed(1)) : 0,
    p90Sentence: at(0.9),
    maxSentence: total ? lengths[total - 1]! : 0,
    shortRatio: ratio(lengths.filter(length => length <= 10).length, total),
    midRatio: ratio(lengths.filter(length => length > 10 && length < 31).length, total),
    longRatio: ratio(lengths.filter(length => length >= 31).length, total),
    veryLongRatio: ratio(lengths.filter(length => length >= 60).length, total),
    sentencesPerParagraph: paragraphs.length ? Number((total / paragraphs.length).toFixed(2)) : 0,
    dialogueLineRatio: ratio(paragraphs.filter(line => /^["“「]/.test(line)).length, paragraphs.length),
    commasPerSentence: total ? Number((commas / total).toFixed(2)) : 0,
    charsPerParagraph: paragraphs.length ? Number((chineseChars(body) / paragraphs.length).toFixed(1)) : 0,
    strongPunctPer1000: chineseChars(body) ? Number(((strongPunct / chineseChars(body)) * 1000).toFixed(1)) : 0
  };
}

export interface MetricDelta {
  key: keyof ChapterMetrics;
  label: string;
  original: number;
  candidate: number;
  delta: number;
  /** 用于排序的归一化偏离量：绝对值差异除以原文该指标，跨指标可比。 */
  relative: number;
}

const LABELS: Record<keyof ChapterMetrics, string> = {
  characters: "汉字数",
  paragraphs: "段落数",
  sentences: "句数",
  meanSentence: "平均句长",
  medianSentence: "句长中位数",
  p90Sentence: "句长 p90",
  maxSentence: "最长句",
  shortRatio: "短句占比(≤10)",
  midRatio: "中句占比(11-30)",
  longRatio: "长句占比(≥31)",
  veryLongRatio: "超长句占比(≥60)",
  sentencesPerParagraph: "段均句数",
  dialogueLineRatio: "对白行占比",
  commasPerSentence: "句均逗号",
  charsPerParagraph: "段均字数",
  strongPunctPer1000: "强调标点每千字"
};

export function metricDeltas(original: ChapterMetrics, candidate: ChapterMetrics): MetricDelta[] {
  const keys = Object.keys(LABELS) as Array<keyof ChapterMetrics>;
  return keys.map(key => {
    const base = original[key];
    const value = candidate[key];
    return {
      key,
      label: LABELS[key],
      original: base,
      candidate: value,
      delta: Number((value - base).toFixed(2)),
      relative: base ? Number((Math.abs(value - base) / base).toFixed(3)) : Math.abs(value)
    };
  }).sort((a, b) => b.relative - a.relative);
}

/**
 * 节奏距离只取句法与段落结构，不含篇幅，避免章节长短把结果带偏。
 * 数值越小越接近原文，用作评审模型之外的机械基线。
 */
export function rhythmDistance(original: ChapterMetrics, candidate: ChapterMetrics): number {
  const weights: Array<[keyof ChapterMetrics, number]> = [
    ["meanSentence", 1], ["medianSentence", 1], ["p90Sentence", 1],
    ["shortRatio", 1.5], ["longRatio", 1.5], ["veryLongRatio", 1],
    ["sentencesPerParagraph", 1], ["dialogueLineRatio", 1], ["commasPerSentence", 1]
  ];
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of weights) {
    const base = original[key];
    const value = candidate[key];
    const normalized = base ? Math.abs(value - base) / base : Math.abs(value);
    total += normalized * weight;
    weightSum += weight;
  }
  return Number((total / weightSum).toFixed(4));
}

export interface RegressionInput {
  worldId: string;
  corpusPath: string;
  chapters: ChapterRef[];
  chapterIndex: number;
  contextLines: number;
  targetWords: number;
  brief: string;
  model: string;
  reviewModel: string;
  timeoutMs: number;
  styleProfile?: string;
  styleRhythm?: string;
  profileA: TaskProfile;
  profileB: TaskProfile;
  /** 评审阶段的档案，默认沿用 B，便于评审自己也想清楚再下结论。 */
  reviewProfile?: TaskProfile;
  /** 默认在指标不达标时做一次句法修订，修订只改句子组织。 */
  repair?: boolean;
  targets?: RhythmTarget;
  outputDir: string;
  archiveDir: string;
}

export interface RegressionResult {
  chapter: ChapterRef;
  candidates: Array<{
    id: string;
    profile: TaskProfile;
    chars: number;
    seconds: number;
    metrics: ChapterMetrics;
    distance: number;
    repaired: boolean;
    rejectedRepair: boolean;
    scoreBefore: number;
    scoreAfter: number;
    gaps: RhythmGap[];
  }>;
  reviewPath: string;
  archiveDir: string;
}

function tail(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars ? text : chars.slice(-maxChars).join("");
}

/**
 * 盲写提示：只给前文、设定与本章任务，不给原文任何句子。
 * 明示「不要模仿某位作者」，避免把风格要求变成对原文的改写。
 */
export function buildBlindPrompt(input: {
  title: string;
  context: string;
  brief: string;
  targetWords: number;
  styleProfile?: string;
  styleRhythm?: string;
}): string {
  return [
    "角色：中文类型小说作者。按给定的世界观、人物状态与文风约束，写出下一章的完整正文。",
    `本章目标篇幅：约 ${input.targetWords} 个汉字；以完整场景推进为准，不靠重复凑字数。`,
    "本章任务：",
    input.brief,
    "前文（上一章结尾部分的原文，只用于承接人物位置、语气与未完成动作，不得整段复制或改写）：",
    input.context,
    input.styleProfile ? "叙事风格约束：\n" + input.styleProfile : "",
    input.styleRhythm ? "节奏复核：\n" + input.styleRhythm : "",
    "写作要求：",
    "- 只输出小说正文，首行用 Markdown 二级标题写章节名，不输出分析、提纲或创作说明。",
    "- 句式要有轻重缓急：铺陈、交涉、局势推断处允许长句连写，动作与转折处才用短句收束。",
    "- 不模仿特定作者的标志性句式或比喻；不复述原文句子。",
    "- 人物说话要带各自的身份与信息量，不用寒暄填充对白。",
    "- 不新增世界规则、不解释原著未交代的悬念。"
  ].filter(Boolean).join("\n\n");
}

export function buildReviewPrompt(input: {
  original: string;
  candidateA: string;
  candidateB: string;
  metrics: { original: ChapterMetrics; a: ChapterMetrics; b: ChapterMetrics };
  deltasA: MetricDelta[];
  deltasB: MetricDelta[];
  profileA: TaskProfile;
  profileB: TaskProfile;
  repairNotes?: string;
}): string {
  const table = (rows: MetricDelta[]): string =>
    rows.map(row => `| ${row.label} | ${row.original} | ${row.candidate} | ${row.delta > 0 ? "+" : ""}${row.delta} |`).join("\n");
  const profileText = (profile: TaskProfile): string => `${profile.thinkingMode}/${profile.effort}`;
  return [
    "角色：文本对照评审。下面同一章有三个版本：原文、候选 A、候选 B。A 与 B 是写作模型在看不到原文的情况下，按同一份任务与前文各自写出的章节。",
    "任务目标只有一项：判断 A 与 B 在写法上离原文有多远，以及差在哪里。情节走向不同是预期的，不因情节差异扣分；只有写法、节奏、信息呈现方式才算差异。",
    "原文：",
    input.original,
    `候选 A（写作阶段推理配置 ${profileText(input.profileA)}）：`,
    input.candidateA,
    `候选 B（写作阶段推理配置 ${profileText(input.profileB)}）：`,
    input.candidateB,
    input.repairNotes ? "写稿后的处理：\n" + input.repairNotes : "",
    "已量出的指标（同一口径统计，只数汉字；短句≤10 字，长句≥31 字，超长句≥60 字）：",
    "| 指标 | 原文 | A | A 差值 |\n|---|---|---|---|\n" + table(input.deltasA),
    "| 指标 | 原文 | B | B 差值 |\n|---|---|---|---|\n" + table(input.deltasB),
    "请按以下结构写评审报告：",
    "## 1. 节奏是否被复现\n用上面的数字说明 A、B 各自偏离最大的三项，并判断偏离来自句子组织还是场景类型差异。",
    "## 2. 短句堆叠的具体位置\n从 A、B 各找 2 处连续短句堆叠的段落，引用不超过 20 字说明问题；再指出原文在同类场景里是怎么把短句并进长句的。",
    "## 3. 长句为什么没出现\n区分三种成因：模型不敢写长句、长句被拆成多段、长句写了但信息密度不足。给出各自的判断依据。",
    "## 4. 对白与信息承载\n比较对白行的比例与每段对白的信息量：是否用寒暄和确认句占位，是否缺少原文那种一段话里塞进身份、态度与试探的长对白。",
    "## 5. 结论\n明确回答：A、B 哪个更接近原文；推理强度提高是否改善了节奏；如果没有改善，说明原因。",
    "## 6. 可直接执行的修改\n给出 3 到 5 条能写进写作提示词的具体约束，每条一句话，必须可检查（例如「每 200 字至少出现一处 40 字以上的句子」），不要写「注意节奏」这类空话。",
    "约束：不评价情节是否合理；不引用超过 20 字的原文；不写客套话与总结性排比。"
  ].join("\n\n");
}

function metricsTable(metrics: Record<string, ChapterMetrics>): string {
  const keys = Object.keys(metrics) as string[];
  const fields = Object.keys(LABELS) as Array<keyof ChapterMetrics>;
  const header = "| 指标 | " + keys.join(" | ") + " |";
  const divider = "|---|" + keys.map(() => "---").join("|") + "|";
  const rows = fields.map(field => `| ${LABELS[field]} | ${keys.map(key => metrics[key]![field]).join(" | ")} |`);
  return [header, divider, ...rows].join("\n");
}

/** 跑一次完整回归：盲写两个候选、量指标、交给评审模型。 */
export async function runRegression(input: RegressionInput): Promise<RegressionResult> {
  const chapter = input.chapters.find(item => item.index === input.chapterIndex);
  if (!chapter) throw new Error(`第 ${input.chapterIndex} 章不存在；本书共 ${input.chapters.length} 章。`);

  const lines = (await readFile(input.corpusPath, "utf8")).split(/\r?\n/);
  const slice = (from: number, to: number): string => lines.slice(from - 1, to).join("\n").trim();
  const originalText = slice(chapter.startLine, chapter.endLine);
  const context = tail(slice(Math.max(1, chapter.startLine - input.contextLines), chapter.startLine - 1), 4000);
  const originalMetrics = chapterMetrics(originalText);
  const targetWords = input.targetWords > 0 ? input.targetWords : originalMetrics.characters;

  await mkdir(input.outputDir, { recursive: true });
  const save = async (name: string, content: string): Promise<void> => {
    await writeFile(resolve(input.outputDir, name), content.trim() + "\n", "utf8");
  };
  await save("00-context.md", context);
  await save("01-original.md", originalText);

  const prompt = buildBlindPrompt({
    title: chapter.title,
    context,
    brief: input.brief,
    targetWords,
    styleProfile: input.styleProfile,
    styleRhythm: input.styleRhythm
  });
  await save("02-prompt.md", prompt);

  const variants = [
    { id: "A", profile: input.profileA },
    { id: "B", profile: input.profileB }
  ];
  const candidates: RegressionResult["candidates"] = [];
  const texts: Record<string, string> = {};
  const target = input.targets ?? targetsFromMetrics(originalMetrics);
  for (const variant of variants) {
    const startedAt = Date.now();
    let text = await runAgentText(prompt, input.model, input.timeoutMs, variant.profile);
    const draftMetrics = chapterMetrics(text);
    const draftGaps = rhythmGaps(draftMetrics, target);
    const scoreBefore = rhythmScore(draftGaps);
    let repaired = false;
    let rejectedRepair = false;
    if (input.repair !== false && needsRepair(draftGaps)) {
      await save(`03-candidate-${variant.id}-raw.md`, text);
      const revised = await repairRhythm({
        text, gaps: draftGaps, model: input.model, timeoutMs: input.timeoutMs, profile: variant.profile
      });
      const revisedScore = rhythmScore(rhythmGaps(chapterMetrics(revised), target));
      if (shouldAcceptRepair(scoreBefore, revisedScore)) {
        text = revised;
        repaired = true;
      } else {
        rejectedRepair = true;
      }
    }
    const seconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    texts[variant.id] = text;
    await save(`03-candidate-${variant.id}.md`, text);
    const metrics = chapterMetrics(text);
    const gaps = rhythmGaps(metrics, target);
    candidates.push({
      id: variant.id,
      profile: variant.profile,
      chars: metrics.characters,
      seconds,
      metrics,
      distance: rhythmDistance(chapterMetrics(originalText), metrics),
      repaired,
      rejectedRepair,
      scoreBefore,
      scoreAfter: rhythmScore(gaps),
      gaps
    });
    const last = candidates[candidates.length - 1]!;
    console.error(`[regress] 候选 ${variant.id} 完成：${metrics.characters} 汉字 / ${seconds}s / 节奏距离 ${last.distance}` +
      (repaired ? ` / 修订 ${(scoreBefore * 100).toFixed(0)}% → ${(last.scoreAfter * 100).toFixed(0)}%` : rejectedRepair ? " / 修订未通过复核，保留原稿" : " / 未触发修订"));
  }

  const a = candidates.find(item => item.id === "A")!;
  const b = candidates.find(item => item.id === "B")!;
  const review = await runAgentText(buildReviewPrompt({
    original: originalText,
    candidateA: texts.A!,
    candidateB: texts.B!,
    metrics: { original: originalMetrics, a: a.metrics, b: b.metrics },
    deltasA: metricDeltas(originalMetrics, a.metrics),
    deltasB: metricDeltas(originalMetrics, b.metrics),
    profileA: a.profile,
    profileB: b.profile,
    repairNotes: candidates.map(item => item.repaired
      ? `候选 ${item.id} 经一次句法修订，加权节奏偏差 ${(item.scoreBefore * 100).toFixed(0)}% → ${(item.scoreAfter * 100).toFixed(0)}%。`
      : item.rejectedRepair
        ? `候选 ${item.id} 的句法修订未通过复核（偏差未下降），已退回原稿。`
        : `候选 ${item.id} 未触发句法修订。`).join("\n")
  }), input.reviewModel, input.timeoutMs, input.reviewProfile ?? input.profileB);
  await save("05-review.md", review);

  const report = {
    chapter: { index: chapter.index, title: chapter.title, volume: chapter.volume },
    models: { writer: input.model, reviewer: input.reviewModel },
    target,
    candidates: candidates.map(item => ({
      id: item.id, profile: item.profile, chars: item.chars, seconds: item.seconds,
      distance: item.distance, repaired: item.repaired, rejectedRepair: item.rejectedRepair,
      scoreBefore: item.scoreBefore, scoreAfter: item.scoreAfter
    })),
    metrics: Object.fromEntries([["original", originalMetrics], ...candidates.map(item => [item.id, item.metrics])]),
    deltas: {
      A: metricDeltas(originalMetrics, a.metrics),
      B: metricDeltas(originalMetrics, b.metrics)
    }
  };
  await save("metrics.json", JSON.stringify(report, null, 2));

  await mkdir(input.archiveDir, { recursive: true });
  await writeFile(resolve(input.archiveDir, "metrics.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  await writeFile(
    resolve(input.archiveDir, "review.md"),
    [
      `# 回归对照：${chapter.title}`,
      "",
      `- 写作模型：${input.model}（A ${a.profile.thinkingMode}/${a.profile.effort}，B ${b.profile.thinkingMode}/${b.profile.effort}）`,
      `- 评审模型：${input.reviewModel}`,
      `- 原文：${originalMetrics.characters} 汉字 / ${originalMetrics.sentences} 句 / 平均 ${originalMetrics.meanSentence} 字 / 短句 ${(originalMetrics.shortRatio * 100).toFixed(0)}% / 长句 ${(originalMetrics.longRatio * 100).toFixed(0)}%`,
      "",
      metricsTable(Object.fromEntries([["原文", originalMetrics], ...candidates.map(item => [item.id, item.metrics])])),
      "",
      review.trim()
    ].join("\n") + "\n",
    "utf8"
  );

  return { chapter, candidates, reviewPath: resolve(input.outputDir, "05-review.md"), archiveDir: input.archiveDir };
}
