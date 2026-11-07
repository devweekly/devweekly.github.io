import assert from "node:assert/strict";
import test from "node:test";
import { selectAsOfStyleSamples } from "../src/asof-style-profile.js";
import type { LibraryChunk } from "../src/library.js";

function chunk(id: string, chapter: string, text: string, start = 0): LibraryChunk {
  return { id, source: "original.txt", chapter, chunkIndex: 0, start, end: start + text.length, text };
}

test("as-of style samples span only the supplied bounded chapters", () => {
  const samples = selectAsOfStyleSamples([
    chunk("1", "第一章", "起点之前的叙事样本"),
    chunk("2", "第二章", "起点正文的叙事样本"),
    chunk("3", "第三章", "历史分支之后的章节不得进入此数组")
  ], 2);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map(sample => sample.label), ["第一章", "第三章"]);
  assert.ok(!samples.some(sample => sample.text.includes("历史分支之后")));
});

test("as-of style sample selection respects chapter and character budgets", () => {
  const samples = selectAsOfStyleSamples([
    chunk("1", "第一章", "甲".repeat(12000)),
    chunk("2", "第二章", "乙".repeat(12000)),
    chunk("3", "第三章", "丙".repeat(12000)),
    chunk("4", "第四章", "丁".repeat(12000)),
    chunk("5", "第五章", "戊".repeat(12000))
  ]);
  assert.equal(samples.length, 4);
  assert.ok(samples.every(sample => sample.text.length <= 9000));
});
