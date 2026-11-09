import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assignChapters, buildAnalysisUnits, buildCharacterDictionary, countMentions, dedupeChunkTexts, ensureSourceCanonLibraryIndex, groupAnalysisUnits, prepareCanonIndexInputs,
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
    catalogChapter(2, 1, "第一章 开端")
  ];
  const offsets = [10, 30, 50];
  const chunks = [
    chunk("s:0", "前置内容", "书名", 0),
    { ...chunk("s:1", "第一章 开端", "甲", 1), chapterStart: offsets[0] },
    { ...chunk("s:2", "第二章 转折", "乙", 2), chapterStart: offsets[1] },
    { ...chunk("s:3", "第一章 开端", "丙", 3), chapterStart: offsets[2] }
  ];
  const assignment = assignChapters(chunks, catalog, offsets);
  assert.deepEqual(assignment.chapters.map(item => item.chapterId), ["V00-C000", "V01-C001", "V01-C002", "V02-C001"]);
  assert.equal(assignment.chunkChapter.get("s:3")?.volume, 2);
  assert.deepEqual(assignment.chapters.map(item => item.charCount), [2, 1, 1, 1]);
});

test("non-catalog author notes are not attached to the preceding chapter", () => {
  const catalog = [
    catalogChapter(1, 1, "第一章 开端"),
    catalogChapter(1, 2, "第二章 转折")
  ];
  const chunks = [
    chunk("s:1", "第一章 开端", "正式正文", 0),
    chunk("s:note", "作者说明", "作者说明不得成为章节正文", 1),
    chunk("s:2", "第二章 转折", "后续正文", 2)
  ];
  const assignment = assignChapters(chunks, catalog);
  assert.equal(assignment.chunkChapter.has("s:note"), false);
  assert.equal(assignment.chunkChapter.get("s:1")?.charCount, 4);
  assert.equal(assignment.chunkChapter.get("s:2")?.chapterId, "V01-C002");
  assert.deepEqual(assignment.unmatchedLabels, ["作者说明"]);
});

test("repeated canon titles without source positions fail closed", () => {
  const catalog = [
    catalogChapter(1, 1, "第一章 开端"),
    catalogChapter(2, 1, "第一章 开端")
  ];
  assert.throws(
    () => assignChapters([chunk("s:0", "第一章 开端", "正文", 0)], catalog, [0, 100]),
    /缺少 chapterStart 原文位置/
  );
});

test("canon index inputs use original source hash and exact line offsets", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-canon-index-"));
  try {
    const world = join(root, "world");
    await mkdir(world, { recursive: true });
    const original = "序言\n第一章 开端\n正文甲\n第二章 转折\n正文乙\n第一章 开端\n正文丙";
    await writeFile(join(world, "original.txt"), original, "utf8");
    const hash = createHash("sha256").update(original, "utf8").digest("hex");
    const first = original.indexOf("第一章");
    const second = original.lastIndexOf("第一章");
    const middleStart = original.indexOf("第二章 转折");
    const inputs = await prepareCanonIndexInputs(world, [
      { ...catalogChapter(1, 1, "第一章 开端"), line: 2 },
      { ...catalogChapter(1, 2, "第二章 转折"), line: 4 },
      { ...catalogChapter(2, 1, "第一章 开端"), line: 6 }
    ], [
      { ...chunk("canon:1", "第一章 开端", original.slice(first, middleStart).trim(), 0), end: original.slice(first, middleStart).trim().length, source: "world/original.txt", sourceHash: hash, chapterStart: first },
      { ...chunk("notes:1", "第一章 开端", "错误辅助资料", 1), source: "world/notes.txt", sourceHash: "f".repeat(64), chapterStart: first },
      { ...chunk("canon:2", "第二章 转折", original.slice(middleStart, second).trim(), 0), end: original.slice(middleStart, second).trim().length, source: "world/original.txt", sourceHash: hash, chapterStart: middleStart }
    ]);
    assert.deepEqual(inputs.chunks.map(item => item.id), ["canon:1", "canon:2"]);
    assert.deepEqual(inputs.chapterStartOffsets, [first, middleStart, second]);
    const assignment = assignChapters([
      { ...inputs.chunks[0]!, chapter: "第一章 开端" },
      { ...inputs.chunks[1]!, chapter: "第二章 转折" },
      { ...chunk("canon:3", "第一章 开端", "正文丙", 3), source: "world/original.txt", sourceHash: hash, chapterStart: second }
    ], [
      { ...catalogChapter(1, 1, "第一章 开端"), line: 2 },
      { ...catalogChapter(1, 2, "第二章 转折"), line: 4 },
      { ...catalogChapter(2, 1, "第一章 开端"), line: 6 }
    ], inputs.chapterStartOffsets);
    assert.deepEqual(assignment.chapters.map(item => item.chapterId), ["V01-C001", "V01-C002", "V02-C001"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("canon index validation reads project-root original.txt when world-local copy is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-canon-root-source-"));
  try {
    const world = join(root, "worlds", "source-world");
    await mkdir(join(world, "library"), { recursive: true });
    const original = "第一章 开端\n正文甲\n第二章 转折\n正文乙";
    await writeFile(join(root, "original.txt"), original, "utf8");
    const hash = createHash("sha256").update(original, "utf8").digest("hex");
    const firstStart = original.indexOf("第一章");
    const secondStart = original.indexOf("第二章");
    const inputs = await prepareCanonIndexInputs(world, [
      { ...catalogChapter(1, 1, "第一章 开端"), line: 1 },
      { ...catalogChapter(1, 2, "第二章 转折"), line: 3 }
    ], [
      { ...chunk("canon:1", "第一章 开端", original.slice(firstStart, secondStart).trim(), 0), start: 0, end: original.slice(firstStart, secondStart).trim().length, source: "original.txt", sourceHash: hash, chapterStart: firstStart },
      { ...chunk("canon:2", "第二章 转折", original.slice(secondStart).trim(), 0), start: 0, end: original.slice(secondStart).trim().length, source: "original.txt", sourceHash: hash, chapterStart: secondStart }
    ]);
    assert.deepEqual(inputs.chunks.map(item => item.id), ["canon:1", "canon:2"]);
    assert.deepEqual(inputs.chapterStartOffsets, [firstStart, secondStart]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing source Library is reconstructed from project-root original.txt and chapter catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-kb-offline-rebuild-"));
  const previousCwd = process.cwd();
  try {
    const worldDir = join(root, "worlds", "source-world");
    await mkdir(worldDir, { recursive: true });
    await mkdir(join(root, "analysis", "source-world"), { recursive: true });
    const original = ["第一章 大枪落幕", "李阎走进雨里。", "第二章 貘与姑获鸟", "夜色压住城寨。"].join("\n");
    await writeFile(join(root, "original.txt"), original, "utf8");
    await writeFile(join(root, "analysis", "source-world", "chapter-index.json"), JSON.stringify({
      schemaVersion: 2, totalLines: 4,
      volumes: [{ volume: 1, chapters: [
        { sequenceInVolume: 1, printedNumber: 1, title: "第一章 大枪落幕", label: "大枪落幕", line: 1 },
        { sequenceInVolume: 2, printedNumber: 2, title: "第二章 貘与姑获鸟", label: "貘与姑获鸟", line: 3 }
      ] }]
    }));
    process.chdir(root);
    assert.equal(await ensureSourceCanonLibraryIndex("source-world", worldDir), true);
    const library = JSON.parse(await readFile(join(worldDir, "library", "index.json"), "utf8")) as {
      worldId: string; chunks: Array<{ chapter: string; sourceHash: string; chapterStart: number; text: string }>;
    };
    assert.equal(library.worldId, "source-world");
    assert.deepEqual(library.chunks.map(item => item.chapter), ["第一章 大枪落幕", "第二章 貘与姑获鸟"]);
    assert.ok(library.chunks.every(item => item.sourceHash === createHash("sha256").update(original, "utf8").digest("hex")));
    const built = await buildAnalysisUnits("source-world", { worldDir });
    assert.deepEqual(built.units.map(item => item.title), ["第一章 大枪落幕", "第二章 貘与姑获鸟"]);
    assert.ok(built.units[0]!.text.includes("李阎走进雨里。"));
    assert.ok(built.units[1]!.text.includes("夜色压住城寨。"));
    assert.equal(await ensureSourceCanonLibraryIndex("source-world", worldDir), false);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

