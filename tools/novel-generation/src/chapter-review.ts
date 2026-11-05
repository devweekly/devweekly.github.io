import { z } from "zod";

/**
 * 终审只回答一个问题：有没有读者会认定「不可能」的硬伤。
 * 措辞、用字、称谓、节奏、伏笔、偏好、需要再核对才能确认的疑点，一律不报。
 */
export const ReviewIssueSchema = z.object({
  scenes: z.array(z.number().int().min(1).max(40)).default([]),
  evidence: z.string().min(2).max(40),
  problem: z.string().min(1),
  repair: z.string().min(1)
}).strict();

export const ChapterReviewSchema = z.object({
  status: z.enum(["pass", "needs_repair"]),
  summary: z.string().min(1),
  issues: z.array(ReviewIssueSchema).max(3)
}).strict();

export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ChapterReview = z.infer<typeof ChapterReviewSchema>;

export const MUST_FIX_RULE = [
  "判定标准只有一条：读者读到这里会不会认为「不可能」。满足任一条才算必改，其余全部不报。",
  "一、人物做了他做不到的事：知道了没有渠道知道的信息、用了没有的能力或器物、出现在不可能的位置、同一时间处在两处、伤重到不可能行动却行动自如。",
  "二、世界规则被打破：与正文已经展示且不可变通的规则矛盾（能力的代价与限制、身份与权限、地理与航程、器物归属），或前后事实互相否定。",
  "三、时间或因果断裂到读者看不懂：同一事件在不同段落有两个互斥版本，时间倒流，结果先于原因。",
  "以下一律不报：措辞、用字、称谓是否统一、节奏与句长、标点、伏笔是否回收、场景转换是否顺滑、人物是否讨喜，以及任何「可以更好」的建议。",
  "需要复算、需要对照另一份文档才能确认的疑点不报；不能确定是有意留白、人物误判、隐瞒或刻意反转的，不报。",
  "上限 3 条；没有就返回空数组，不要为了显得尽责凑数。"
].join("\n");

function extractObject(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Review agent did not return a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

/**
 * 证据只用于定位，不要求逐字命中：强制逐字子串会把审查推向「能截出一句话」的局部瑕疵。
 * 定位不到时在证据后加注，不判整份审查无效。
 */
export function parseChapterReview(raw: string, chapter: string, sceneCount?: number): ChapterReview {
  const parsed = ChapterReviewSchema.parse(extractObject(raw));
  if (parsed.status === "pass" && parsed.issues.length > 0) {
    throw new Error("Review status is pass but must-fix issues are present.");
  }
  if (parsed.status === "needs_repair" && parsed.issues.length === 0) {
    throw new Error("Review status is needs_repair but no issue is listed.");
  }
  for (const issue of parsed.issues) {
    if (sceneCount !== undefined) {
      if (!issue.scenes.length) throw new Error("Review issue is missing required scene numbers.");
      if (issue.scenes.some(scene => scene > sceneCount)) throw new Error("Review references a scene outside this chapter.");
    }
    const probe = issue.evidence.replace(/[.…\s]+/g, "");
    const located = chapter.includes(issue.evidence) || (probe.length > 0 && chapter.includes(probe.slice(0, 8)));
    if (!located) issue.evidence = issue.evidence + "（未定位到，按场景号核对）";
  }
  return parsed;
}

export function reviewPrompt(input: {
  context: string;
  blueprint: string;
  chapter: string;
  priorReview?: string;
  sceneCount?: number;
  sceneLabel?: string;
  correction?: string;
}): string {
  return [
    "角色：小说终审。只判断一件事：这一章有没有读者会认定「不可能」的硬伤。",
    input.context,
    "章节蓝图：",
    input.blueprint,
    input.sceneLabel ? "候审正文（" + input.sceneLabel + "）：" : "候选正文：",
    input.chapter,
    input.priorReview ? "前序必改清单（只核对是否已修好，不代表必须接受）：\n" + input.priorReview : "",
    MUST_FIX_RULE,
    input.sceneCount !== undefined
      ? "跨场问题列出所有受影响场景号；每条至少给一个场景号。"
      : "不需要填写场景编号。",
    "evidence 只用于定位，引用不超过 15 字，可加省略号，不要求逐字命中。",
    "problem 写清读者会在哪一步觉得不可能，不写「建议加强」。repair 给最小改动，不重写整段。",
    "输出严格 JSON，不要 Markdown 围栏或其他文字：",
    JSON.stringify({
      status: "pass|needs_repair",
      summary: "一句话结论；没有硬伤时写「未发现读者会认定不可能的硬伤」",
      issues: [{
        scenes: input.sceneCount !== undefined ? [1] : [],
        evidence: "不超过 15 字的定位引用",
        problem: "读者会在哪一步认为不可能",
        repair: "最小改动"
      }]
    }, null, 2),
    "没有必改项时 issues 必须是空数组且 status 为 pass；有必改项时 status 为 needs_repair。",
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
        "上一次审查结果未通过 JSON / 结构校验：" + String(firstError) +
        "。请重新检查当前正文，只输出符合指定 schema 的 JSON；没有必改项就返回空数组。"
      );
      parsed = parseChapterReview(raw, chapter, input.sceneCount);
    }
    reviews.push(parsed);
    await input.onReview?.(round, chapter, parsed);
    if (!parsed.issues.length) return { chapter, reviews, repairRounds: round };
    if (round >= maxRepairRounds) {
      throw new Error("Chapter still has must-fix issues after " + maxRepairRounds + " automatic repair rounds. See final review artifacts; story state was not updated.");
    }
    const repaired = (await input.repair(chapter, parsed.issues, round + 1)).trim();
    if (!repaired || repaired === chapter.trim()) {
      throw new Error("Automatic chapter repair produced no change. Story state was not updated.");
    }
    chapter = repaired;
  }
  throw new Error("Unreachable chapter review state.");
}

export function formatReview(review: ChapterReview): string {
  if (!review.issues.length) {
    return ["## 终审", "", "状态：pass", "", review.summary].join("\n");
  }
  return [
    "## 终审：必改 " + review.issues.length + " 条",
    "",
    review.summary,
    "",
    ...review.issues.map((issue, index) => [
      (index + 1) + ". " + (issue.scenes.length ? "场景 " + issue.scenes.join("、") + "｜" : "") + issue.evidence,
      "   读者会认为不可能：" + issue.problem,
      "   最小改动：" + issue.repair
    ].join("\n"))
  ].join("\n");
}
