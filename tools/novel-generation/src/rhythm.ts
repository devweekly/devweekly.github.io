// 节奏闸门：先量出与目标基线的差距，再让模型只改句子组织。
// 目标值来自 analysis/conghuoniao/style-rhythm.md 的全书抽样，不靠目测判断「太急」。
import { runAgentText } from "./generate.js";
import {
  RHYTHM_LONG_SENTENCE_CHARS,
  RHYTHM_REPAIR_LONG_MAX_CHARS,
  RHYTHM_REPAIR_LONG_MIN_CHARS,
  RHYTHM_REPAIR_THRESHOLD,
  RHYTHM_SHORT_SENTENCE_CHARS,
  RHYTHM_VERY_LONG_SENTENCE_CHARS,
  RHYTHM_WORD_COUNT_TOLERANCE
} from "./constants.js";
import type { ChapterMetrics } from "./regression.js";
import type { TaskProfile } from "./task-profiles.js";

export interface RhythmTarget {
  meanSentence: number;
  p90Sentence: number;
  shortRatio: number;
  longRatio: number;
  veryLongRatio: number;
  dialogueLineRatio: number;
  sentencesPerParagraph: number;
  charsPerParagraph: number;
  strongPunctPer1000: number;
}

/** 全书抽样基线（10,895 句）。写新章节时用它，因为单章类型未知。 */
export const BASELINE_TARGET: RhythmTarget = {
  meanSentence: 22,
  p90Sentence: 47,
  shortRatio: 0.32,
  longRatio: 0.25,
  veryLongRatio: 0.045,
  dialogueLineRatio: 0.25,
  sentencesPerParagraph: 1.35,
  charsPerParagraph: 30,
  strongPunctPer1000: 12
};

/** 交锋、审讯、密集对白类的卷段基线，用于对白占比高、句子偏短的章节。 */
export const DIALOGUE_TARGET: RhythmTarget = {
  ...BASELINE_TARGET,
  meanSentence: 18,
  p90Sentence: 42,
  shortRatio: 0.37,
  longRatio: 0.18,
  veryLongRatio: 0.02,
  dialogueLineRatio: 0.45,
  sentencesPerParagraph: 1.25,
  charsPerParagraph: 21
};

/** 对照组直接沿用原章自身的数值，回归测试才有确定的重建目标。 */
export function targetsFromMetrics(metrics: ChapterMetrics): RhythmTarget {
  return {
    meanSentence: metrics.meanSentence,
    p90Sentence: metrics.p90Sentence,
    shortRatio: metrics.shortRatio,
    longRatio: metrics.longRatio,
    veryLongRatio: metrics.veryLongRatio,
    dialogueLineRatio: metrics.dialogueLineRatio,
    sentencesPerParagraph: metrics.sentencesPerParagraph,
    charsPerParagraph: metrics.charsPerParagraph,
    strongPunctPer1000: metrics.strongPunctPer1000
  };
}

export interface RhythmGap {
  key: keyof RhythmTarget;
  label: string;
  actual: number;
  target: number;
  /** 相对偏差，正数表示超出目标，负数表示不足。 */
  deviation: number;
}

const LABELS: Record<keyof RhythmTarget, string> = {
  meanSentence: "平均句长",
  p90Sentence: "句长 p90",
  shortRatio: `短句占比(≤${RHYTHM_SHORT_SENTENCE_CHARS} 字)`,
  longRatio: `长句占比(≥${RHYTHM_LONG_SENTENCE_CHARS} 字)`,
  veryLongRatio: `超长句占比(≥${RHYTHM_VERY_LONG_SENTENCE_CHARS} 字)`,
  dialogueLineRatio: "对白行占比",
  sentencesPerParagraph: "段均句数",
  charsPerParagraph: "段均字数",
  strongPunctPer1000: "强调标点每千字"
};

const WEIGHTS: Record<keyof RhythmTarget, number> = {
  meanSentence: 2,
  p90Sentence: 1.5,
  shortRatio: 2,
  longRatio: 2,
  veryLongRatio: 0.5,
  dialogueLineRatio: 1,
  sentencesPerParagraph: 0.5,
  charsPerParagraph: 0.5,
  strongPunctPer1000: 1
};

export function rhythmGaps(metrics: ChapterMetrics, target: RhythmTarget): RhythmGap[] {
  const keys = Object.keys(LABELS) as Array<keyof RhythmTarget>;
  return keys.map(key => ({
    key,
    label: LABELS[key],
    actual: metrics[key],
    target: target[key],
    deviation: target[key] ? Number(((metrics[key] - target[key]) / target[key]).toFixed(3)) : 0
  }));
}

/** 加权偏差超过 12% 才修，避免为几个百分点把文本反复改写。 */
export function rhythmScore(gaps: RhythmGap[]): number {
  let total = 0;
  let weight = 0;
  for (const gap of gaps) {
    total += Math.abs(gap.deviation) * WEIGHTS[gap.key];
    weight += WEIGHTS[gap.key];
  }
  return Number((total / weight).toFixed(3));
}

export function needsRepair(gaps: RhythmGap[]): boolean {
  return rhythmScore(gaps) > RHYTHM_REPAIR_THRESHOLD;
}

/**
 * 修订必须比原稿更接近基线才采纳。实测里低推理档的修订会把「短段并成复句」，
 * 与原文「一句一段」的组织相反，偏差从 20% 涨到 40%，这种修订要退回原稿。
 */
export function shouldAcceptRepair(before: number, after: number): boolean {
  return after < before;
}

/**
 * 只改句子组织的修订指令：按缺口给具体动作，明确禁止改剧情、加场景、合并段落凑数。
 * 长句要求「合并已有短句」，不是「新写长句」，否则内容会被扩写跑偏。
 */
export function buildRepairPrompt(text: string, gaps: RhythmGap[]): string {
  const urgent = gaps
    .filter(gap => Math.abs(gap.deviation) > RHYTHM_REPAIR_THRESHOLD)
    .sort((a, b) => Math.abs(b.deviation) * WEIGHTS[b.key] - Math.abs(a.deviation) * WEIGHTS[a.key]);
  const actions: string[] = [];
  for (const gap of urgent) {
    if (gap.key === "shortRatio" && gap.deviation > 0) {
      actions.push(`短句占比 ${(gap.actual * 100).toFixed(0)}%，目标 ${(gap.target * 100).toFixed(0)}%：把功能重复、语气相同的相邻短句用一个逗号并进同一句，只保留结尾的句号。`);
    } else if (gap.key === "longRatio" || gap.key === "p90Sentence" || gap.key === "meanSentence") {
      actions.push(`长句占比 ${(gap.actual * 100).toFixed(0)}%（目标 ${(gap.target * 100).toFixed(0)}%），平均句长 ${gap.actual} 字（目标 ${gap.target}）：把旁边两到三个短句用逗号、分号串成一句 ${RHYTHM_REPAIR_LONG_MIN_CHARS}–${RHYTHM_REPAIR_LONG_MAX_CHARS} 字的长句，原句信息全部保留，不新增内容。`);
    } else if (gap.key === "dialogueLineRatio" && gap.deviation > 0) {
      actions.push(`对白行占比 ${(gap.actual * 100).toFixed(0)}%，目标 ${(gap.target * 100).toFixed(0)}%：把连续的一问一答合并成一个人连着说的一段长对白，答话人的回应改成动作或沉默。`);
    } else if (gap.key === "sentencesPerParagraph" && gap.deviation > 0) {
      actions.push(`段均句数 ${gap.actual}，目标 ${gap.target}：把并在一起的句群按动作转折拆回单句成段，长句留在段落内部。`);
    } else if (gap.key === "strongPunctPer1000" && gap.deviation < 0) {
      actions.push(`强调标点每千字 ${gap.actual} 处，目标 ${gap.target}：对白里的质问、反问、惊讶保留问号与感叹号，不要一律改成句号。`);
    } else if (gap.key === "veryLongRatio" && gap.deviation < 0) {
      actions.push(`超长句占比 ${(gap.actual * 100).toFixed(1)}%，目标 ${(gap.target * 100).toFixed(1)}%：至少写出一到两处 ${RHYTHM_VERY_LONG_SENTENCE_CHARS} 字以上、由逗号串联三个以上分句的长句，用于局势推断或器物清单。`);
    }
  }
  return [
    "角色：句法编辑。只重排现有文本的句子组织，不改情节、人物、对白内容、事实与顺序。",
    "当前成稿的节奏指标与本作基线不符，症状是句子过短、长句缺席，读起来一路急促。",
    "需要修的地方：",
    ...urgent.map(gap => `- ${gap.label}：当前 ${gap.actual}，目标 ${gap.target}`),
    "具体做法：",
    ...actions.map(action => "- " + action),
    "边界：",
    "- 不改写人物说的话，只合并或拆分说话前后的叙述；对白本身只允许合并连续发言，不增加内容。",
    "- 不新增场景、事件、人物、比喻和形容；不删情节。",
    "- 不靠合并段落凑指标：原文单句成段约占一半，段落数应基本不变。",
    `- 总字数变化控制在 ${RHYTHM_WORD_COUNT_TOLERANCE * 100}% 以内。`,
    "当前正文：",
    text,
    "输出完整修订后的正文，不要输出修改说明或指标对照。"
  ].join("\n\n");
}

export interface RepairInput {
  text: string;
  gaps: RhythmGap[];
  model?: string;
  timeoutMs: number;
  profile?: TaskProfile;
}

/** 跑一次修订并返回新文本；调用方重新计量，决定是否还需要下一轮。 */
export async function repairRhythm(input: RepairInput): Promise<string> {
  return runAgentText(buildRepairPrompt(input.text, input.gaps), input.model, input.timeoutMs, input.profile);
}
