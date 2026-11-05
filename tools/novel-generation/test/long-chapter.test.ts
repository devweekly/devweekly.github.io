import test from "node:test";
import assert from "node:assert/strict";
import { chineseChars, rhythmMetrics, splitScenes } from "../src/long-chapter.js";

test("chineseChars counts Han characters only", () => {
  assert.equal(chineseChars("海水压着耳朵，藤壶割得掌心发涩。"), 14);
  assert.equal(chineseChars("  L118031 · 500 点\n"), 1);
});

test("rhythmMetrics reports long and short sentence shares", () => {
  const text = [
    "# 章标题",
    "他点了点头。",
    "「我跟刚才那两个人没有任何关系，唯一的相同点在于，我们都对你很感兴趣，别担心，我只是借用那个平头男人的一个念头来向你打个招呼，仅此而已，他们两个对此一无所知。」",
    "李阎没说话，等着后文。",
    "好。"
  ].join("\n");
  const metrics = rhythmMetrics(text);
  assert.ok(metrics.chars > 40);
  assert.equal(metrics.sentences, 4);
  assert.ok(metrics.long > 0);
  assert.ok(metrics.veryLong > 0);
  assert.ok(metrics.short > 0);
  assert.ok(metrics.mean > 20);
  assert.ok(metrics.dialogueLines > 0);
});

test("splitScenes maps each numbered heading to exactly one scene", () => {
  const plan = [
    "# 全章蓝图",
    "总体目标",
    "## 场景 1：夜入旧城",
    "视角：李玄。目标：找到入口。",
    "## 场景 2：守门人",
    "视角：李玄。阻力：守门人拒绝放行。"
  ].join("\n");
  assert.deepEqual(splitScenes(plan, 2), [
    "## 场景 1：夜入旧城\n视角：李玄。目标：找到入口。",
    "## 场景 2：守门人\n视角：李玄。阻力：守门人拒绝放行。"
  ]);
});

test("splitScenes rejects missing, duplicate, out-of-order and extra scene headings", () => {
  assert.throws(() => splitScenes("## 场景 1\n内容", 2), /实际识别到 1 个/);
  assert.throws(() => splitScenes("## 场景 1\nA\n## 场景 1\nB", 2), /编号必须连续/);
  assert.throws(() => splitScenes("## 场景 2\nA\n## 场景 1\nB", 2), /编号必须连续/);
  assert.throws(() => splitScenes("## 场景 1\nA\n## 场景 2\nB\n## 场景 3\nC", 2), /实际识别到 3 个/);
});
