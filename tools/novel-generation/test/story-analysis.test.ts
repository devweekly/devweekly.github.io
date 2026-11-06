import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { databaseStatus, readStoryAnalysis, saveStoryAnalysis, syncLibraryChunks } from "../src/database.js";
import { groupAnalysisUnits } from "../src/novel-kb.js";
import { assertMergeOptions, buildAnalysisPrompt, cleanCharacterAliases, filterCharacterAliasEvidence, parseModelJson, plotThreadId, plotThreadMergeKey, stripUnclassifiedAliases } from "../src/story-analysis.js";
import { loadLibraryChunks } from "../src/library.js";

test("story analysis batches preserve every chapter in order without splitting one", () => {
  const units = [0, 1, 2].map(index => ({
    chapterId: "V01-C00" + index, ordinal: index + 1, volume: 1,
    title: "第" + (index + 1) + "章", label: String(index + 1),
    text: "字".repeat(1200), charCount: 1200
  }));
  const batches = groupAnalysisUnits(units, 2500);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.flat().map(unit => unit.chapterId), units.map(unit => unit.chapterId));
  assert.ok(batches.every(batch => batch.reduce((sum, unit) => sum + unit.charCount, 0) <= 2500));
  const oversized = groupAnalysisUnits([{ ...units[0] as typeof units[0], charCount: 9000, text: "字".repeat(9000) }], 2500);
  assert.equal(oversized.length, 1, "a chapter longer than the budget must stay in one piece");
});

test("story analysis snapshot is persisted and replaced atomically as one database record", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-story-analysis-"));
  try {
    const snapshot = {
      worldId: "test-world", sourceHash: "b".repeat(64), analyzedAt: "2026-11-05T00:00:00.000Z",
      complete: true, batches: 2,
      characters: [{ name: "林岚", shortBio: "一个复杂的人物", sourceRefs: [{ chunkId: "c1", source: "s.txt", chapter: "第一章" }] }],
      plotThreads: [{ title: "失踪案", summary: "仍未解决" }],
      foreshadowings: [{ clue: "墙上的旧照片", confidence: "可能线索" }],
      developmentPossibilities: [{ focus: "林岚", direction: "可能背叛同伴" }]
    };
    saveStoryAnalysis(root, "test-world", snapshot);
    assert.deepEqual(readStoryAnalysis(root, "test-world"), snapshot);
    assert.equal(databaseStatus(root, "test-world").storyAnalysis, 1);
    const replacement = { ...snapshot, sourceHash: "c".repeat(64), batches: 3 };
    saveStoryAnalysis(root, "test-world", replacement);
    assert.deepEqual(readStoryAnalysis(root, "test-world"), replacement);
    assert.equal(databaseStatus(root, "test-world").storyAnalysis, 1);
    assert.throws(() => saveStoryAnalysis(root, "other-world", snapshot), /world mismatch/);
    syncLibraryChunks(root, "test-world", [{ id: "new:0:0", source: "new.txt", chapter: "第一章", chunkIndex: 0, start: 0, end: 2, text: "新文本" }]);
    assert.equal(readStoryAnalysis(root, "test-world"), undefined, "re-ingesting corpus must invalidate stale analysis");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("version 1 world databases upgrade to include story analysis storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-story-analysis-migration-"));
  try {
    const worldDir = join(root, "world");
    await mkdir(worldDir, { recursive: true });
    const db = new DatabaseSync(join(worldDir, "novel.db"));
    db.exec("CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?)").run("test-world");
    db.exec("PRAGMA user_version=1");
    db.close();
    const status = databaseStatus(worldDir, "test-world");
    assert.equal(status.schemaVersion, 4);
    assert.equal(status.storyAnalysis, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("story analysis can load an existing JSON library index and migrate it to SQLite", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-story-analysis-library-"));
  try {
    const worldDir = join(root, "worlds", "test-world");
    const libraryDir = join(worldDir, "library");
    await mkdir(libraryDir, { recursive: true });
    const chunks = [{
      id: "source:0:0", source: "source.txt", chapter: "第一章", chunkIndex: 0,
      start: 0, end: 4, text: "故事开篇", sourceHash: "d".repeat(64), chapterStart: 0
    }];
    await writeFile(join(libraryDir, "index.json"), JSON.stringify({
      schemaVersion: 1, worldId: "test-world", createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z", chunks
    }), "utf8");
    assert.deepEqual(JSON.parse(JSON.stringify(await loadLibraryChunks(libraryDir, "test-world"))), chunks);
    assert.equal(databaseStatus(worldDir, "test-world").chunks, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("story analysis asks for chapter-scoped sources and preserves multiple character directions", () => {
  const chapters = [
    { chapterId: "V01-C001", ordinal: 1, volume: 1, title: "第一章", label: "1", text: "林岚救下同伴。", charCount: 6 },
    { chapterId: "V01-C002", ordinal: 2, volume: 1, title: "第二章", label: "2", text: "林岚背叛旧盟友。", charCount: 8 }
  ];
  const prompt = buildAnalysisPrompt({ index: 0, chapters, chars: 14 });
  assert.match(prompt, /chapterKeys/);
  assert.match(prompt, /只列出确实能从中找到该条内容的章节 key/);
  const parsed = parseModelJson(JSON.stringify({
    characters: [{ name: "林岚", chapterKeys: ["V01-C001"], shortBio: "复杂人物" }],
    developmentPossibilities: [
      { focus: "林岚", direction: "为了救人而背叛", chapterKeys: ["V01-C001"] },
      { focus: "林岚", direction: "为求自保而背叛", chapterKeys: ["V01-C002"] }
    ]
  }));
  assert.equal(parsed.developmentPossibilities.length, 2);
  assert.deepEqual(parsed.developmentPossibilities.map(item => item.chapterKeys), [["V01-C001"], ["V01-C002"]]);
});

test("merge-only 拒绝与分片/限量组合，避免写出残缺 complete 快照", () => {
  assert.throws(() => assertMergeOptions({ mergeOnly: true, shard: { index: 0, count: 4 } }), /cannot be combined/);
  assert.throws(() => assertMergeOptions({ mergeOnly: true, limit: 5 }), /cannot be combined/);
  assert.doesNotThrow(() => assertMergeOptions({ mergeOnly: true }));
  assert.doesNotThrow(() => assertMergeOptions({ shard: { index: 0, count: 4 } }));
});

test("批次分析能容忍 JSON 后的说明文字", () => {
  const raw = JSON.stringify({ characters: [{ name: "林岚", chapterKeys: ["V01-C001"] }] }) +
    "\n以上为分析结果，注意 } 只是标点。";
  assert.equal(parseModelJson(raw).characters[0]?.name, "林岚");
});


test("plot thread merge key deduplicates exact source spans but preserves same-title distinct spans", async () => {
  assert.equal(plotThreadMergeKey("金家灭门与冥扎下落", ["V01-C001", "V01-C002"]), plotThreadMergeKey("金家灭门与冥扎下落", ["V01-C002", "V01-C001"]));
  assert.notEqual(plotThreadMergeKey("金家灭门与冥扎下落", ["V01-C001"]), plotThreadMergeKey("金家灭门与冥扎下落", ["V02-C001"]));
  assert.notEqual(plotThreadId("金家灭门与冥扎下落", ["V01-C001"]), plotThreadId("金家灭门与冥扎下落", ["V02-C001"]));
  assert.notEqual(plotThreadMergeKey("金家灭门与冥扎下落", ["V01-C001"], ["金家灭门"]), plotThreadMergeKey("金家灭门与冥扎下落", ["V01-C001"], ["冥扎下落"]));
});


test("only evidence-backed personal-name aliases enter character lookup", () => {
  const aliases = cleanCharacterAliases({
    name: "李阎",
    aliases: ["姑获鸟", "太岁", "冯夷"],
    aliasDetails: [
      { value: "李玄", type: "name_alias", evidence: "旁人称他李玄" },
      { value: "姑获鸟", type: "title", evidence: "姑获鸟现身" },
      { value: "太岁", type: "inheritance", evidence: "太岁之力" },
      { value: "冯夷", type: "identity", evidence: "冯夷附身" },
      { value: "九哥", type: "nickname", evidence: "" },
      { value: "小刀", type: "nickname", evidence: "查小刀，人称小刀" }
    ]
  });
  assert.deepEqual(aliases, ["李玄", "小刀"]);
});


test("alias evidence must quote the alias and exist in its cited chapter", () => {
  const valid = filterCharacterAliasEvidence([
    { value: "李玄", type: "name_alias", evidence: "旁人称他李玄" },
    { value: "太岁", type: "name_alias", evidence: "旁人称他李玄" },
    { value: "九哥", type: "name_alias", evidence: "原文中不存在的九哥" }
  ], ["旁人称他李玄，随后离开。"]);
  assert.deepEqual(valid.map(item => item.value), ["李玄"]);
});


test("legacy analysis cache migration discards unclassified aliases but keeps narrative analysis", () => {
  const analysis = parseModelJson(JSON.stringify({
    characters: [{ name: "李阎", aliases: ["姑获鸟", "太岁"] }],
    plotThreads: [{ title: "红旗帮存亡", summary: "围剿与内部异心" }]
  }));
  const migrated = stripUnclassifiedAliases(analysis);
  assert.deepEqual(migrated.characters[0]?.aliases, []);
  assert.deepEqual(migrated.characters[0]?.aliasDetails, []);
  assert.equal(migrated.plotThreads[0]?.title, "红旗帮存亡");
});
