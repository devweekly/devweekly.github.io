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
    "角色：小说责任编辑。首要职责是保护小说的可读性、人物生命力、情绪和文学表达，不是做学术审查、设定审计或格式验收。请通读完整章节，像真正读者一样判断它是否自然、有感染力、是否让人想继续读。",
    "文学表达和故事体验优先。不要把正文改成设定说明、剧情报告、人物心理分析或逻辑证明。允许留白、偶然、误会、矛盾、冲动、荒诞、含混和暂时无法解释的细节；不要要求每件事都被解释、每个场景都推进主线、每个人物每章都有成长。",
    input.context,
    "章节蓝图（仅供理解创作意图，不是必须逐项兑现的合同）：",
    input.blueprint,
    "最终候审正文：",
    input.chapter,
    input.priorReview ? "前序审查记录（仅供核对，不代表必须接受）：\n" + input.priorReview : "",
    "先看整体阅读感受：人物是否鲜活，场景是否有吸引力，语言是否自然，情绪是否成立，叙事是否有张力。若正文已经好看，不要为了显示审查价值而找问题，也不要提出纯个人偏好的改写。",
    "只有会实质破坏读者理解或故事成立的问题才允许报告为 blocker/major：明确的前后事实矛盾、人物不可能获得的信息、时间地点/人物位置冲突、关键行动缺少必要前提导致情节无法理解、明确违反已经展示且不可变通的能力规则。必须确认这不是有意留白、人物误判、隐瞒、欺骗、伏笔或刻意反转。",
    "人物动机、弧光、关系变化、伏笔、场景推进、对白和文学表达都可以作为阅读观察，但除非造成明确且严重的理解断裂，否则只能作为建议性 minor，不能触发自动重写。人物不需要证明自己为什么改变；意外选择不等于错误，反转不必提前解释清楚。",
    "严禁用风格统计、句长比例、段落长度、对白占比、设定覆盖率、证据数量或分析完整度评价文学质量；不得因此触发修订。不要把合理的文学留白判为信息缺失。",
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
    "如果没有明确破坏故事成立或读者理解的硬伤，status 必须是 pass；minor 只记录可选建议，不触发重写。如果存在上述硬伤，status 才是 needs_repair。不要虚构问题，不要为了显示审查价值强行找问题；不要把个人审美偏好伪装成客观错误。",
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
