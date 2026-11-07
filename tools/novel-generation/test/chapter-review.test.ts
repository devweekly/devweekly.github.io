import test from "node:test";
import assert from "node:assert/strict";
import { formatReview, parseChapterReview, reviewAndRepair, reviewPrompt, MUST_FIX_RULE } from "../src/chapter-review.js";

const chapter = "李玄推开门。门后的人没有说话，只把一枚铜钱放在桌上。";

test("pass requires an empty issue list", () => {
  const report = parseChapterReview(JSON.stringify({
    status: "pass",
    summary: "未发现读者会认定不可能的硬伤",
    issues: []
  }), chapter);
  assert.equal(report.status, "pass");
  assert.equal(report.issues.length, 0);
});

test("any reported issue makes the status needs_repair", () => {
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "pass", summary: "OK", issues: [{
      scenes: [], evidence: "门后的人", problem: "读者会认为这个人凭空出现", repair: "补一句脚步声"
    }]
  }), chapter), /status is pass/);
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "needs_repair", summary: "有问题", issues: []
  }), chapter), /no issue is listed/);
});

test("more than three issues is rejected", () => {
  const issue = { scenes: [], evidence: "李玄", problem: "不可能", repair: "改" };
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "needs_repair", summary: "四条", issues: [issue, issue, issue, issue]
  }), chapter), /Too big|too_big|Expected array/);
});

test("证据只用于定位，找不到时加注而不判无效", () => {
  const report = parseChapterReview(JSON.stringify({
    status: "needs_repair", summary: "有硬伤", issues: [{
      scenes: [], evidence: "门后出现一个陌生人", problem: "读者会认为这个人凭空出现", repair: "补一句脚步声"
    }]
  }), chapter);
  assert.equal(report.issues.length, 1);
  assert.match(report.issues[0]!.evidence, /未定位到/);
});

test("长章节的必改问题必须带有效场景编号", () => {
  const issue = { scenes: [], evidence: "李玄", problem: "人物凭空出现", repair: "补足出场过程" };
  const raw = JSON.stringify({ status: "needs_repair", summary: "有硬伤", issues: [issue] });
  assert.throws(() => parseChapterReview(raw, chapter, 2), /missing required scene numbers/);
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "needs_repair", summary: "有硬伤", issues: [{ ...issue, scenes: [3] }]
  }), chapter, 2), /outside this chapter/);
});

test("场景编号超出范围时报错", () => {
  assert.throws(() => parseChapterReview(JSON.stringify({
    status: "needs_repair", summary: "越界", issues: [{
      scenes: [4], evidence: "李玄", problem: "不可能", repair: "改"
    }]
  }), chapter, 3), /outside this chapter/);
});

test("必改规则排除措辞、节奏与偏好", () => {
  assert.match(MUST_FIX_RULE, /不可能/);
  assert.match(MUST_FIX_RULE, /一律不报/);
  for (const word of ["措辞", "节奏", "伏笔", "可以更好"]) {
    assert.ok(MUST_FIX_RULE.includes(word), word);
  }
  const prompt = reviewPrompt({ context: "设定", blueprint: "蓝图", chapter });
  assert.match(prompt, /只判断一件事/);
  assert.match(prompt, /人物关系变化/);
  assert.match(prompt, /人物关系可以因新的互动而变化/);
  assert.match(prompt, /同一时点出现互斥关系状态/);
  assert.match(prompt, /上限 3 条/);
  assert.match(prompt, /issues 必须是空数组/);
});

test("reviewAndRepair repairs and rechecks until pass without human approval", async () => {
  let reviewCalls = 0;
  let repairCalls = 0;
  const result = await reviewAndRepair({
    initialChapter: chapter,
    review: async () => {
      reviewCalls++;
      return JSON.stringify(reviewCalls === 1 ? {
        status: "needs_repair", summary: "门后人物出现缺少前提。", issues: [{
          scenes: [], evidence: "门后的人没有说话",
          problem: "读者会认为这人凭空出现", repair: "开门前加入可听见的动静"
        }]
      } : { status: "pass", summary: "未发现读者会认定不可能的硬伤", issues: [] });
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
          scenes: [], evidence: "李玄推开门",
          problem: "读者会认为他不可能知道门后有人", repair: "补足信息来源"
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

test("终审阻断前把最新成稿交给 onFailure，不静默丢稿", async () => {
  let saved = "";
  let reason = "";
  await assert.rejects(() => reviewAndRepair({
    initialChapter: chapter,
    maxRepairRounds: 1,
    review: async () => JSON.stringify({
      status: "needs_repair", summary: "仍有硬伤。", issues: [{
        scenes: [], evidence: "李玄推开门", problem: "读者会认为不可能", repair: "补足信息来源"
      }]
    }),
    repair: async current => current + "已修复。",
    onFailure: async (current, _reviews, message) => { saved = current; reason = message; }
  }), /after 1 automatic repair rounds/);
  assert.match(saved, /已修复。/);
  assert.match(reason, /automatic repair rounds/);
});

test("formatReview 在无必改项时只给一行结论", () => {
  const text = formatReview({ status: "pass", summary: "未发现读者会认定不可能的硬伤", issues: [] });
  assert.match(text, /状态：pass/);
  assert.ok(!text.includes("必改"));
});
