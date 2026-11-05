import { z } from "zod";

export const ReviewIssueSchema = z.object({
  severity: z.enum(["blocker", "major", "minor"]),
  scenes: z.array(z.number().int().min(1).max(20)).default([]),
  evidence: z.string().min(4),
  problem: z.string().min(1),
  repair: z.string().min(1)
}).strict();

export const ChapterReviewSchema = z.object({
  status: z.enum(["pass", "needs_repair"]),
  summary: z.string().min(1),
  issues: z.array(ReviewIssueSchema)
}).strict();

export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ChapterReview = z.infer<typeof ChapterReviewSchema>;

function extractObject(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Review agent did not return a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

export function parseChapterReview(raw: string, chapter: string, sceneCount?: number): ChapterReview {
  const parsed = ChapterReviewSchema.parse(extractObject(raw));
  const blocking = parsed.issues.filter(issue => issue.severity === "blocker" || issue.severity === "major");
  for (const issue of parsed.issues) {
    if (!chapter.includes(issue.evidence)) {
      throw new Error("Review evidence is not an exact substring of the final chapter: " + issue.evidence);
    }
    if (sceneCount !== undefined) {
      if (issue.scenes.some(scene => scene > sceneCount)) {
        throw new Error("Review references a scene outside this chapter.");
      }
      if (blocking.includes(issue) && issue.scenes.length === 0) {
        throw new Error("Every blocker/major finding in a multi-scene chapter must identify at least one affected scene.");
      }
    }
  }
  const hasBlocking = blocking.length > 0;
  if (parsed.status === "pass" && hasBlocking) {
    throw new Error("Review status is pass but blocker/major issues are present.");
  }
  if (parsed.status === "needs_repair" && !hasBlocking) {
    throw new Error("Review status is needs_repair but no blocker/major issues are present.");
  }
  return parsed;
}

export function reviewPrompt(input: {
  context: string;
  blueprint: string;
  chapter: string;
  priorReview?: string;
  sceneCount?: number;
  correction?: string;
}): string {
  return [
    "角色：小说终审与连续性审查 Agent。你必须审查当前完整章节，而不是只检查局部段落。",
    input.context,
    "章节蓝图：",
    input.blueprint,
    "最终候审正文：",
    input.chapter,
    input.priorReview ? "前序审查记录（用于复核修复是否有效，不代表必须接受）：\n" + input.priorReview : "",
    "审查范围：人物动机、人物性格与弧光是否有选择/压力/代价支撑；人物知识边界；人物声音与关系变化；时间、地点、人物位置和道具归属；事件因果；能力限制及代价；原著事实与项目原创边界；伏笔埋设/回收；场景之间的信息交接；主线推进；场景是否产生有效变化。",
    "只报告可以从正文、世界设定、前文或故事状态中定位的实质问题。区分硬事实错误与创作偏好。句长、标点、段落比例、文风统计偏离不能单独成为 blocker 或 major；不得因为人物做出意外选择就判错，重点判断是否有足够动机和行为证据。",
    input.sceneCount !== undefined
      ? "这是多场景章节。跨场问题必须列出所有受影响的场景编号；每个 blocker/major 必须至少给出一个场景编号。"
      : "这是普通章节，不需要填写场景编号。",
    "证据必须是正文中连续、逐字存在的原文片段，长度至少 4 个字符；不能概述或改写证据。",
    "输出严格 JSON，不要 Markdown 围栏或其他文字，结构：",
    JSON.stringify({
      status: "pass|needs_repair",
      summary: "一句话说明整体审查结论",
      issues: [{
        severity: "blocker|major|minor",
        scenes: input.sceneCount !== undefined ? [1, 2] : [],
        evidence: "从正文逐字复制的连续原文",
        problem: "具体问题及其影响",
        repair: "最小范围、可执行的修复方式"
      }]
    }, null, 2),
    "如果没有 blocker/major，status 必须是 pass；minor 可以保留在 issues 中但不触发重写。如果存在 blocker/major，status 必须是 needs_repair。不要虚构问题，不要为了显示审查价值强行找问题。",
    input.correction ?? ""
  ].filter(Boolean).join("\n\n");
}

export async function reviewAndRepair(input: {
  initialChapter: string;
  sceneCount?: number;
  maxRepairRounds?: number;
  review: (chapter: string, correction?: string) => Promise<string>;
  repair: (chapter: string, issues: ReviewIssue[], round: number) => Promise<string>;
  onReview?: (round: number, chapter: string, review: ChapterReview) => Promise<void>;
}): Promise<{ chapter: string; reviews: ChapterReview[]; repairRounds: number }> {
  const maxRepairRounds = input.maxRepairRounds ?? 2;
  let chapter = input.initialChapter;
  const reviews: ChapterReview[] = [];
  for (let round = 0; round <= maxRepairRounds; round++) {
    let raw = await input.review(chapter);
    let parsed: ChapterReview;
    try {
      parsed = parseChapterReview(raw, chapter, input.sceneCount);
    } catch (firstError) {
      raw = await input.review(
        chapter,
        "上一次审查结果未通过 JSON / 证据校验：" + String(firstError) +
        "。请重新检查当前正文，只输出符合指定 schema 的 JSON；证据必须逐字出现在正文中。"
      );
      parsed = parseChapterReview(raw, chapter, input.sceneCount);
    }
    reviews.push(parsed);
    await input.onReview?.(round, chapter, parsed);
    const blocking = parsed.issues.filter(issue => issue.severity === "blocker" || issue.severity === "major");
    if (!blocking.length) return { chapter, reviews, repairRounds: round };
    if (round >= maxRepairRounds) {
      throw new Error("Chapter still has blocker/major issues after " + maxRepairRounds + " automatic repair rounds. See final review artifacts; story state was not updated.");
    }
    const repaired = (await input.repair(chapter, blocking, round + 1)).trim();
    if (!repaired || repaired === chapter.trim()) {
      throw new Error("Automatic chapter repair produced no change. Story state was not updated.");
    }
    chapter = repaired;
  }
  throw new Error("Unreachable chapter review state.");
}

export function formatReview(review: ChapterReview): string {
  return [
    "# 自动质量审查",
    "",
    "状态：" + review.status,
    "",
    review.summary,
    "",
    ...review.issues.map((issue, index) => [
      "## " + (index + 1) + ". " + issue.severity,
      "场景：" + (issue.scenes.length ? issue.scenes.join(", ") : "普通章节 / 未指定"),
      "证据：" + issue.evidence,
      "问题：" + issue.problem,
      "最小修复：" + issue.repair
    ].join("\n"))
  ].join("\n");
}
