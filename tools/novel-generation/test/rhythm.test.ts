import test from "node:test";
import assert from "node:assert/strict";
import { chapterMetrics } from "../src/regression.js";
import {
  buildRepairPrompt, needsRepair, rhythmGaps, rhythmScore, shouldAcceptRepair,
  targetsFromMetrics, BASELINE_TARGET, DIALOGUE_TARGET
} from "../src/rhythm.js";

const TEXT = [
  "“来。”",
  "“坐。”",
  "他点头。",
  "海风从窗缝里挤进来，带着咸味和铁锈味，吹得桌上的纸页翻过去又翻回来，谁都没有伸手去按。"
].join("\n");

test("targetsFromMetrics copies every compared field", () => {
  const metrics = chapterMetrics(TEXT);
  assert.deepEqual(targetsFromMetrics(metrics), {
    meanSentence: metrics.meanSentence,
    p90Sentence: metrics.p90Sentence,
    shortRatio: metrics.shortRatio,
    longRatio: metrics.longRatio,
    veryLongRatio: metrics.veryLongRatio,
    dialogueLineRatio: metrics.dialogueLineRatio,
    sentencesPerParagraph: metrics.sentencesPerParagraph,
    charsPerParagraph: metrics.charsPerParagraph,
    strongPunctPer1000: metrics.strongPunctPer1000
  });
});

test("identical text scores zero and needs no repair", () => {
  const metrics = chapterMetrics(TEXT);
  const gaps = rhythmGaps(metrics, targetsFromMetrics(metrics));
  assert.equal(rhythmScore(gaps), 0);
  assert.equal(needsRepair(gaps), false);
});

test("terse text against the baseline triggers repair", () => {
  const metrics = chapterMetrics(TEXT);
  const gaps = rhythmGaps(metrics, BASELINE_TARGET);
  assert.ok(rhythmScore(gaps) > 0.12);
  assert.equal(needsRepair(gaps), true);
  const shortGap = gaps.find(gap => gap.key === "shortRatio")!;
  assert.ok(shortGap.deviation > 0, "short ratio should exceed the 32% baseline");
});

test("repair prompt asks for merging, not for new content", () => {
  const metrics = chapterMetrics(TEXT);
  const prompt = buildRepairPrompt(TEXT, rhythmGaps(metrics, BASELINE_TARGET));
  assert.ok(prompt.includes("把旁边两到三个短句用逗号"));
  assert.ok(prompt.includes("不新增内容"));
  assert.ok(prompt.includes("不新增场景"));
  assert.ok(prompt.includes("当前正文"));
});

test("dialogue baseline keeps a higher dialogue share than the general one", () => {
  assert.ok(DIALOGUE_TARGET.dialogueLineRatio > BASELINE_TARGET.dialogueLineRatio);
  assert.ok(DIALOGUE_TARGET.meanSentence < BASELINE_TARGET.meanSentence);
});

test("a repair is accepted only when the deviation drops", () => {
  assert.equal(shouldAcceptRepair(0.2, 0.12), true);
  assert.equal(shouldAcceptRepair(0.2, 0.4), false);
  assert.equal(shouldAcceptRepair(0.2, 0.2), false);
});
