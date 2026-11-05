import test from "node:test";
import assert from "node:assert/strict";
import { chapterMetrics, loadChapters, metricDeltas, rhythmDistance, buildReviewPrompt } from "../src/regression.js";

const SAMPLE = [
  "# 第一章 试",
  "“你来了。”他说。",
  "海风从窗缝里挤进来，带着咸味和铁锈味，吹得桌上的纸页翻过去又翻回来，谁都没有伸手去按。",
  "“坐。”"
].join("\n");

test("chapterMetrics counts sentences, dialogue lines and punctuation", () => {
  const metrics = chapterMetrics(SAMPLE);
  assert.equal(metrics.characters, 45);
  assert.equal(metrics.paragraphs, 3);
  assert.equal(metrics.sentences, 4);
  assert.equal(metrics.meanSentence, 11.3);
  assert.equal(metrics.medianSentence, 2.5);
  assert.equal(metrics.p90Sentence, 39);
  assert.equal(metrics.maxSentence, 39);
  assert.equal(metrics.shortRatio, 0.75);
  assert.equal(metrics.longRatio, 0.25);
  assert.equal(metrics.veryLongRatio, 0);
  assert.equal(metrics.sentencesPerParagraph, 1.33);
  assert.equal(metrics.dialogueLineRatio, 0.667);
  assert.equal(metrics.commasPerSentence, 0.75);
  assert.equal(metrics.charsPerParagraph, 15);
});

test("identical texts have zero rhythm distance", () => {
  const metrics = chapterMetrics(SAMPLE);
  assert.equal(rhythmDistance(metrics, metrics), 0);
});

test("shorter sentences produce a positive distance and are ranked first", () => {
  const original = chapterMetrics(SAMPLE);
  const terse = chapterMetrics(["“来。”", "“坐。”", "他点头。"].join("\n"));
  const distance = rhythmDistance(original, terse);
  assert.ok(distance > 0.2, "distance should be clearly positive");
  const deltas = metricDeltas(original, terse);
  assert.ok(deltas[0]!.relative >= deltas[deltas.length - 1]!.relative, "deltas should be sorted by relative deviation");
  const mean = deltas.find(item => item.key === "meanSentence")!;
  assert.ok(mean.delta < 0, "terse text should shorten the mean sentence");
});

test("loadChapters derives chapter end lines from volume boundaries", () => {
  const chapters = loadChapters({
    volumes: [{ volume: 1, startLine: 1, endLine: 99, chapters: [{ title: "第一章", line: 5 }, { title: "第二章", line: 40 }] }]
  });
  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters[0], { index: 1, title: "第一章", volume: 1, startLine: 5, endLine: 39 });
  assert.equal(chapters[1]!.endLine, 99);
});

test("review prompt carries both metric tables and a verdict request", () => {
  const metrics = chapterMetrics(SAMPLE);
  const prompt = buildReviewPrompt({
    original: SAMPLE,
    candidateA: "A 文本",
    candidateB: "B 文本",
    metrics: { original: metrics, a: metrics, b: metrics },
    deltasA: metricDeltas(metrics, metrics),
    deltasB: metricDeltas(metrics, metrics),
    profileA: { thinkingMode: "disabled", thinkingBudgetTokens: 8192, effort: "low" },
    profileB: { thinkingMode: "adaptive", thinkingBudgetTokens: 8192, effort: "high" }
  });
  assert.ok(prompt.includes("平均句长"));
  assert.ok(prompt.includes("disabled/low"));
  assert.ok(prompt.includes("adaptive/high"));
  assert.ok(prompt.includes("哪个更接近原文"));
  assert.ok(prompt.includes("不引用超过 20 字"));
});
