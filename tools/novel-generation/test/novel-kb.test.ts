import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assignChapters, buildCharacterDictionary, countMentions, dedupeChunkTexts, groupAnalysisUnits,
  isUsableCharacterName, normalizeCharacterName, type CatalogChapter
} from "../src/novel-kb.js";
import { databaseStatus, syncNovelChapters, syncNovelMentions } from "../src/database.js";

function chunk(id: string, chapter: string, text: string, index: number) {
  return { id, source: "s.txt", chapter, chunkIndex: index, start: index * 100, end: index * 100 + text.length, text };
}

function catalogChapter(volume: number, sequence: number, title: string): CatalogChapter {
  return { volume, sequenceInVolume: sequence, printedNumber: sequence, title, label: title.replace(/^第.+?章\s*/, ""), line: sequence };
}

test("repeated chapter titles resolve positionally instead of collapsing across volumes", () => {
  const catalog: CatalogChapter[] = [
    catalogChapter(1, 1, "第一章 开端"), catalogChapter(1, 2, "第二章 转折"),
    catalogChapter(2, 1, "第一章 开端"), catalogChapter(2, 2, "第二章 转折")
  ];
  const chunks = [
    chunk("s:0", "前置内容", "书名", 0),
    chunk("s:1", "第一章 开端", "甲", 1),
    chunk("s:2", "第二章 转折", "乙", 2),
    chunk("s:3", "第一章 开端", "丙", 3),
    chunk("s:4", "第二章 转折", "丁", 4)
  ];
  const assignment = assignChapters(chunks, catalog);
  assert.deepEqual(assignment.chapters.map(item => item.chapterId), ["V00-C000", "V01-C001", "V01-C002", "V02-C001", "V02-C002"]);
  assert.equal(assignment.chunkChapter.get("s:3")?.volume, 2);
  assert.deepEqual(assignment.chapters.map(item => item.charCount), [2, 1, 1, 1, 1]);
});

test("overlapping retrieval chunks are joined once", () => {
  const overlap = "重叠部分甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉";
  const first = "开头一段完整的内容，用来测试去重。" + overlap;
  const second = overlap + "，后面接上新的情节。";
  const joined = dedupeChunkTexts([first, second]);
  assert.equal((joined.match(new RegExp(overlap, "g")) ?? []).length, 1);
  assert.ok(joined.startsWith("开头一段完整的内容"));
  assert.ok(joined.endsWith("后面接上新的情节。"));
});

test("mention counting uses longest alias first and masks the matched span", () => {
  const dictionary = buildCharacterDictionary([
    { name: "张三丰", aliases: ["张真人"] },
    { name: "张三", aliases: [] }
  ]);
  const counts = countMentions("张三丰对张三说，张真人来了，张三点头。", dictionary);
  assert.equal(counts.get("张三丰"), 2, "张三丰 and 张真人 are the same person");
  assert.equal(counts.get("张三"), 2, "张三 must not consume the 张三 inside 张三丰");
});

test("character names reject phrases and keep usable aliases", () => {
  assert.equal(normalizeCharacterName("李阎（天保仔）"), "李阎");
  assert.equal(isUsableCharacterName("众人"), false);
  assert.equal(isUsableCharacterName("的李"), false);
  assert.equal(isUsableCharacterName("李阎"), true);
  assert.equal(isUsableCharacterName("阿"), false);
});

test("chapter index and mentions persist into the knowledge base", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-kb-"));
  try {
    const world = join(root, "world");
    const chunks = [chunk("s:0", "第一章 开端", "李阎走进城寨。", 0), chunk("s:1", "第二章 转折", "李阎遇见查小刀。", 1)];
    const catalog = [catalogChapter(1, 1, "第一章 开端"), catalogChapter(1, 2, "第二章 转折")];
    const assignment = assignChapters(chunks, catalog);
    syncNovelChapters(world, "test-world", assignment.chapters);
    syncNovelMentions(world, "test-world", [
      { chapterId: "V01-C001", name: "李阎", count: 1 },
      { chapterId: "V01-C002", name: "李阎", count: 1 },
      { chapterId: "V01-C002", name: "查小刀", count: 1 }
    ]);
    const status = databaseStatus(world, "test-world");
    assert.equal(status.novelChapters, 2);
    assert.equal(status.novelMentions, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analysis batches keep chapter order and never split a chapter", () => {
  const units = ["A", "B", "C"].map((name, index) => ({
    chapterId: "V01-C00" + index, ordinal: index + 1, volume: 1, title: name, label: name,
    text: "字".repeat(5000), charCount: 5000
  }));
  assert.equal(groupAnalysisUnits(units, 12_000).length, 2);
  assert.equal(groupAnalysisUnits(units, 12_000).flat().length, 3);
  const oversized = groupAnalysisUnits([{ ...units[0]!, charCount: 30_000 }], 14_000);
  assert.equal(oversized[0]?.length, 1);
});

test("model JSON with raw control characters and trailing commas still parses", async () => {
  const { parseModelJson } = await import("../src/story-analysis.js");
  const raw = '{"characters":[{"name":"李阎","shortBio":"第一行\n第二行","personality":["冷静",],"aliases":"阎哥"}],"beats":[{"chapterKey":"V01-C001","summary":"开篇"}],}';
  const parsed = parseModelJson(raw);
  assert.equal(parsed.characters[0]?.name, "李阎");
  assert.deepEqual(parsed.characters[0]?.personality, ["冷静"]);
  assert.deepEqual(parsed.characters[0]?.aliases, ["阎哥"]);
  assert.equal(parsed.beats[0]?.chapterKey, "V01-C001");
});
