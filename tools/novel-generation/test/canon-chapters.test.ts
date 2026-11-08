import assert from "node:assert/strict";
import test from "node:test";
import { alignCanonChapterGroups, joinCanonChunkText, selectCanonSourceChunks } from "../src/canon-chapters.js";
import type { CatalogChapter } from "../src/novel-kb.js";

const catalog: CatalogChapter[] = [
  { volume: 1, sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 1 },
  { volume: 1, sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 10 },
  { volume: 2, sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 20 },
  { volume: 2, sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 30 }
];

function chunk(chapter: string, text: string, chapterStart: number, chunkIndex = 0) {
  return { chapter, chunkIndex, start: 0, end: text.length, chapterStart, text };
}

test("catalog alignment skips non-chapter groups and preserves repeated titles by volume order", () => {
  const aligned = alignCanonChapterGroups(catalog, [
    chunk("前置内容", "不属于正式章节", -1),
    chunk("第一章", "卷一第一章", 0),
    chunk("第二章", "卷一第二章", 10),
    chunk("作者说明", "不属于正式章节", 15),
    chunk("第一章", "卷二第一章", 20),
    chunk("第二章", "卷二第二章", 30)
  ], [0, 10, 20, 30]);
  assert.deepEqual(aligned.map(item => item.chunks.map(row => row.text)), [
    ["卷一第一章"], ["卷一第二章"], ["卷二第一章"], ["卷二第二章"]
  ]);
  assert.deepEqual(aligned.map(item => item.chapter.volume), [1, 1, 2, 2]);
});

test("catalog alignment keeps a formal chapter with no library chunks in its exact position", () => {
  const aligned = alignCanonChapterGroups(catalog, [
    chunk("第一章", "卷一第一章", 0),
    chunk("第二章", "卷一第二章", 10),
    chunk("作者说明", "卷间作者说明", 15),
    chunk("第二章", "卷二第二章", 30)
  ], [0, 10, 20, 30]);
  assert.deepEqual(aligned.map(item => item.chunks.length), [1, 1, 0, 1]);
  assert.equal(aligned[2]?.chapter.title, "第一章");
  assert.equal(aligned[2]?.chapter.volume, 2);
});

test("chunk joining removes overlap without changing chapter boundaries", () => {
  assert.equal(joinCanonChunkText([
    { ...chunk("第一章", "甲乙丙", 0), chunkIndex: 0, start: 0, end: 3 },
    { ...chunk("第一章", "丙丁戊", 0), chunkIndex: 1, start: 2, end: 5 }
  ]), "甲乙丙丁戊");
});

test("repeated chapter titles without source offsets fail closed", () => {
  assert.throws(() => alignCanonChapterGroups(catalog, [
    { chapter: "第一章", chunkIndex: 0, start: 0, end: 5, text: "无法判断属于哪一卷" }
  ]), /缺少 chapterStart 原文位置/);
});

test("a repeated title group is matched by its exact original source offset", () => {
  const aligned = alignCanonChapterGroups(catalog, [
    chunk("第一章", "卷二第一章", 20),
    chunk("第二章", "卷二第二章", 30)
  ], [0, 10, 20, 30]);
  assert.deepEqual(aligned.map(item => item.chunks.map(row => row.text)), [
    [], [], ["卷二第一章"], ["卷二第二章"]
  ]);
});

test("canon alignment excludes chunks from auxiliary source files", () => {
  const selected = selectCanonSourceChunks([
    { ...chunk("第一章", "原文正文", 0), source: "worlds/book/original.txt", sourceHash: "canon" },
    { ...chunk("第一章", "辅助文档内容", 0), source: "worlds/book/notes.txt", sourceHash: "notes" }
  ], "canon");
  assert.deepEqual(selected.map(item => item.text), ["原文正文"]);
});

test("source path remains usable when the full original file is stored externally", () => {
  const selected = selectCanonSourceChunks([
    chunk("第一章", "没有来源证据", 0),
    { ...chunk("第一章", "原文切片", 0), source: "worlds/book/original.txt", sourceHash: "indexed-source-hash" },
    { ...chunk("第一章", "辅助文档", 0), source: "worlds/book/notes.txt", sourceHash: "notes-hash" }
  ]);
  assert.deepEqual(selected.map(item => item.text), ["原文切片"]);
});

test("available original file still requires an exact source hash", () => {
  const selected = selectCanonSourceChunks([
    { ...chunk("第一章", "旧原文切片", 0), source: "worlds/book/original.txt", sourceHash: "stale" },
    { ...chunk("第一章", "当前原文切片", 0), source: "worlds/book/original.txt", sourceHash: "current" }
  ], "current");
  assert.deepEqual(selected.map(item => item.text), ["当前原文切片"]);
});
test("a unique catalog chapter can use indexed original chunks without a local full-text file", () => {
  const oneChapter: CatalogChapter[] = [
    { volume: 1, sequenceInVolume: 1, printedNumber: 1, title: "第一章 大枪落幕", label: "大枪落幕", line: 9 }
  ];
  const selected = selectCanonSourceChunks([
    { ...chunk("第一章 大枪落幕", "可验证的原文切片正文", 120), source: "worlds/conghuoniao/original.txt", sourceHash: "sha256-from-ingest" }
  ]);
  const aligned = alignCanonChapterGroups(oneChapter, selected);
  assert.equal(joinCanonChunkText(aligned[0]!.chunks), "可验证的原文切片正文");
});

test("legacy source paths retain original.txt chunks but reject auxiliary files", () => {
  const selected = selectCanonSourceChunks([
    { ...chunk("第一章", "原文", 0), source: "worlds/book/original.txt" },
    { ...chunk("第一章", "笔记", 0), source: "worlds/book/notes.txt" }
  ]);
  assert.deepEqual(selected.map(item => item.text), ["原文"]);
});
