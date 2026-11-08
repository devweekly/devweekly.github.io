import assert from "node:assert/strict";
import test from "node:test";
import { alignCanonChapterGroups, joinCanonChunkText } from "../src/canon-chapters.js";
import type { CatalogChapter } from "../src/novel-kb.js";

const catalog: CatalogChapter[] = [
  { volume: 1, sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 1 },
  { volume: 1, sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 10 },
  { volume: 2, sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 20 },
  { volume: 2, sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 30 }
];

function chunk(chapter: string, text: string, chunkIndex = 0) {
  return { chapter, chunkIndex, start: 0, end: text.length, text };
}

test("catalog alignment skips non-chapter groups and preserves repeated titles by volume order", () => {
  const aligned = alignCanonChapterGroups(catalog, [
    chunk("前置内容", "不属于正式章节"),
    chunk("第一章", "卷一第一章"),
    chunk("第二章", "卷一第二章"),
    chunk("作者说明", "不属于正式章节"),
    chunk("第一章", "卷二第一章"),
    chunk("第二章", "卷二第二章")
  ]);
  assert.deepEqual(aligned.map(item => item.chunks.map(row => row.text)), [
    ["卷一第一章"], ["卷一第二章"], ["卷二第一章"], ["卷二第二章"]
  ]);
  assert.deepEqual(aligned.map(item => item.chapter.volume), [1, 1, 2, 2]);
});

test("catalog alignment keeps a formal chapter with no library chunks in its exact position", () => {
  const aligned = alignCanonChapterGroups(catalog, [
    chunk("第一章", "卷一第一章"),
    chunk("第二章", "卷一第二章"),
    chunk("作者说明", "卷间作者说明"),
    chunk("第二章", "卷二第二章")
  ]);
  assert.deepEqual(aligned.map(item => item.chunks.length), [1, 1, 0, 1]);
  assert.equal(aligned[2]?.chapter.title, "第一章");
  assert.equal(aligned[2]?.chapter.volume, 2);
});

test("chunk joining removes overlap without changing chapter boundaries", () => {
  assert.equal(joinCanonChunkText([
    { ...chunk("第一章", "甲乙丙"), chunkIndex: 0, start: 0, end: 3 },
    { ...chunk("第一章", "丙丁戊"), chunkIndex: 1, start: 2, end: 5 }
  ]), "甲乙丙丁戊");
});
