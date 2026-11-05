import test from "node:test";
import assert from "node:assert/strict";
import { parseChapterReview, reviewAndRepair } from "../src/chapter-review.js";

const chapter = "李玄推开门。门后的人没有说话，只把一枚铜钱放在桌上。";

test("chapter review accepts a pass only when no blocker or major findings exist", () => {
  const report = parseChapterReview(JSON.stringify({
    status: "pass",
    summary: "未发现需要自动修复的实质问题。",
    issues: [{ severity: "minor", scenes: [], evidence: "只把一枚铜钱", problem: "动作略显简略。", repair: "可保留，不影响情节。" }]
  }), chapter);
  assert.equal(report.status, "pass");
});

test("chapter review rejects unsupported evidence and inconsistent status", () => {
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "pass", summary: "OK", issues: [{
      severity: "major", scenes: [], evidence: "门后出现一个陌生人",
      problem: "信息不连贯", repair: "补充人物出现过程"
    }]
  }), chapter), /not an exact substring/);
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "pass", summary: "OK", issues: [{
      severity: "major", scenes: [], evidence: "李玄推开门",
      problem: "信息不连贯", repair: "补充人物出现过程"
    }]
  }), chapter), /status is pass/);
});

test("multi-scene blocker must identify affected scenes", () => {
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "needs_repair", summary: "场景交接存在问题。", issues: [{
      severity: "major", scenes: [], evidence: "李玄推开门",
      problem: "位置变化缺少交代", repair: "补足转场"
    }]
  }), chapter, 3), /must identify at least one affected scene/);
});

test("reviewAndRepair repairs and rechecks until pass without human approval", async () => {
  let reviewCalls = 0;
  let repairCalls = 0;
  const result = await reviewAndRepair({
    initialChapter: chapter,
    review: async current => {
      reviewCalls++;
      return JSON.stringify(reviewCalls === 1 ? {
        status: "needs_repair", summary: "需要补足门后人物出现过程。", issues: [{
          severity: "major", scenes: [], evidence: "门后的人没有说话",
          problem: "人物出现缺少前置线索", repair: "在开门前加入可观察的声音或动静"
        }]
      } : { status: "pass", summary: "修复后因果连贯。", issues: [] });
    },
    repair: async current => {
      repairCalls++;
      return current.replace("李玄推开门。", "门后传来轻微的衣料摩擦声。李玄推开门。");
    }
  });
  assert.equal(reviewCalls, 2);
  assert.equal(repairCalls, 1);
  assert.equal(result.repairRounds, 1);
  assert.match(result.chapter, /衣料摩擦声/);
});

test("reviewAndRepair stops after bounded repairs and never reports a false pass", async () => {
  let reviewCalls = 0;
  let repairCalls = 0;
  await assert.rejects(() => reviewAndRepair({
    initialChapter: chapter,
    maxRepairRounds: 1,
    review: async () => {
      reviewCalls++;
      return JSON.stringify({
        status: "needs_repair", summary: "仍有硬伤。", issues: [{
          severity: "blocker", scenes: [], evidence: "李玄推开门",
          problem: "关键人物动机不成立", repair: "补足动机"
        }]
      });
    },
    repair: async current => {
      repairCalls++;
      return current + "补充。";
    }
  }), /after 1 automatic repair rounds/);
  assert.equal(reviewCalls, 2);
  assert.equal(repairCalls, 1);
});
