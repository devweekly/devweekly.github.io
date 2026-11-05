import test from "node:test";
import assert from "node:assert/strict";
import { chineseChars, rhythmMetrics } from "../src/long-chapter.js";

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
