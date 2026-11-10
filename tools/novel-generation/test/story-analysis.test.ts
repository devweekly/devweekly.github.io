import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { databaseStatus, invalidateDerivedAnalysis, readStoryAnalysis, saveStoryAnalysis } from "../src/database.js";
import { buildAnalysisUnits, groupAnalysisUnits } from "../src/novel-kb.js";
import { resolveAgentModel } from "../src/agent-runtime.js";
import { analyzeStoryCorpus, assertMergeOptions, batchFingerprint, buildAnalysisPrompt, cleanCharacterAliases, filterCharacterAliasEvidence, parseModelJson, plotThreadId, plotThreadMergeKey, selectBatchesThroughOrdinal, storyAnalysisCacheNamespace, stripUnclassifiedAliases } from "../src/story-analysis.js";
import { loadLibraryChunks } from "../src/library.js";

test("analyze-story refuses to rebuild the original canon inside a historical universe", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-no-full-analysis-"));
  try {
    await writeFile(join(root, "universe.json"), JSON.stringify({
      id: "u-test", sourceWorldId: "conghuoniao", entryChapter: "第二十章"
    }));
    await assert.rejects(
      analyzeStoryCorpus("u-test", { worldDir: root }),
      /历史故事宇宙禁止重新分析原著.*仅允许 --merge-only/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("story-analysis cache namespace is stable across corpus edits while each batch fingerprint is content-addressed", () => {
  const batch = {
    index: 0, chars: 12,
    chapters: [{
      chapterId: "V01-C001", ordinal: 1, volume: 1, title: "第一章", label: "1",
      text: "原文正文", charCount: 4
    }]
  };
  const namespace = storyAnalysisCacheNamespace("deepseek-v4.1-flash", 14000);
  assert.equal(namespace, storyAnalysisCacheNamespace("deepseek-v4.1-flash", 14000),
    "unrelated corpus changes must not create a different cache namespace");
  assert.notEqual(namespace, storyAnalysisCacheNamespace("glm-5.3-flash", 14000),
    "changing model must isolate incompatible analysis");
  assert.notEqual(namespace, storyAnalysisCacheNamespace("deepseek-v4.1-flash", 16000),
    "changing batch budget must isolate a different batch layout");
  const fingerprint = batchFingerprint(batch, "deepseek-v4.1-flash", 14000);
  assert.equal(fingerprint, batchFingerprint(batch, "deepseek-v4.1-flash", 14000));
  assert.notEqual(fingerprint, batchFingerprint({
    ...batch, chapters: [{ ...batch.chapters[0]!, text: "修改后的正文", charCount: 6 }]
  }, "deepseek-v4.1-flash", 14000), "only the batch containing changed source text should be invalidated");
});

test("historical universe reuses complete prior batches and re-analyzes only the entry-crossing prefix", () => {
  const units = Array.from({ length: 6 }, (_, index) => ({
    chapterId: "V01-C00" + (index + 1), ordinal: index + 1, volume: 1,
    title: "第" + (index + 1) + "章", label: String(index + 1),
    text: "章节正文" + (index + 1), charCount: 5
  }));
  const batches = [
    { index: 0, chapters: units.slice(0, 2), chars: 10 },
    { index: 1, chapters: units.slice(2, 4), chars: 10 },
    { index: 2, chapters: units.slice(4, 6), chars: 10 }
  ];
  const selected = selectBatchesThroughOrdinal(batches, 3);
  assert.deepEqual(selected.reusable.map(batch => batch.chapters.map(chapter => chapter.chapterId)), [
    ["V01-C001", "V01-C002"]
  ]);
  assert.deepEqual(selected.boundary?.chapters.map(chapter => chapter.chapterId), ["V01-C003"]);
  assert.ok(!JSON.stringify(selected).includes("V01-C004"), "entry-after chapters must not enter boundary analysis");
  assert.ok(!JSON.stringify(selected).includes("V01-C005"), "future batches must be excluded");
  const exactBoundary = selectBatchesThroughOrdinal(batches, 4);
  assert.equal(exactBoundary.reusable.length, 2);
  assert.equal(exactBoundary.boundary, undefined, "an entry at a batch end needs no extra model call");
});

test("merge-only restores a complete legacy batch directory without calling the model", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-story-analysis-legacy-cache-"));
  const worldId = "cache-world";
  const worldDir = join(root, "worlds", worldId);
  const libraryDir = join(worldDir, "library");
  const catalogPath = join(root, "analysis", worldId, "chapter-index.json");
  const originalText = "第一章\n正文一\n第二章\n正文二";
  const sourceHash = createHash("sha256").update(originalText, "utf8").digest("hex");
  const firstText = "第一章\n正文一";
  const secondText = "第二章\n正文二";
  const model = resolveAgentModel("deepseek-v4.1-flash").model;
  const maxChars = 14000;
  try {
    await mkdir(libraryDir, { recursive: true });
    await mkdir(join(root, "analysis", worldId), { recursive: true });
    await writeFile(join(worldDir, "original.txt"), originalText, "utf8");
    await writeFile(catalogPath, JSON.stringify({
      schemaVersion: 2, totalLines: 4, sourceHash,
      volumes: [{ volume: 1, chapters: [
        { sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 1 },
        { sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 3 }
      ] }]
    }), "utf8");
    await writeFile(join(libraryDir, "index.json"), JSON.stringify({
      schemaVersion: 1, worldId, createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z",
      chunks: [
        { id: "canon:1", source: "worlds/" + worldId + "/original.txt", sourceHash, chapter: "第一章", chunkIndex: 0, start: 0, end: firstText.length, chapterStart: 0, text: firstText },
        { id: "canon:2", source: "worlds/" + worldId + "/original.txt", sourceHash, chapter: "第二章", chunkIndex: 0, start: 0, end: secondText.length, chapterStart: originalText.indexOf("第二章"), text: secondText }
      ]
    }), "utf8");

    const { units } = await buildAnalysisUnits(worldId, { worldDir, catalogPath });
    const grouped = groupAnalysisUnits(units, maxChars);
    assert.equal(grouped.length, 1);
    const layout = grouped.map(batch => batch.map(chapter => chapter.chapterId).join(",")).join("|");
    const corpusHash = createHash("sha256").update(units.map(unit => unit.chapterId + ":" + unit.text).join("\n")).digest("hex");
    const legacyKey = createHash("sha256").update(
      "story-analysis-v6\nprompt=story-graph-core-macguffin-interactions-v2\nmodel=" + model +
      "\nmaxChars=" + maxChars + "\nbatches=" + layout + "\nsource=" + corpusHash
    ).digest("hex");
    const legacyDir = join(root, ".output", worldId, "story-analysis", legacyKey);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "batch-0000.json"), JSON.stringify({
      characters: [{ chapterKeys: ["V01-C001"], name: "人物甲", shortBio: "在第一章出场" }],
      beats: [
        { chapterKey: "V01-C001", summary: "人物甲抵达", actors: ["人物甲"] },
        { chapterKey: "V01-C002", summary: "人物甲遇到阻碍", actors: ["人物甲"] }
      ],
      plotThreads: [{ chapterKeys: ["V01-C001", "V01-C002"], title: "寻找失物", summary: "寻找失物的过程" }],
      storyCoreObservations: [{ chapterKeys: ["V01-C001"], centralConflict: "寻找失物", centralQuestion: "失物在哪里" }]
    }), "utf8");

    const result = await analyzeStoryCorpus(worldId, {
      worldDir, catalogPath, model, maxChars, mergeOnly: true
    });
    assert.equal(result.cached, 1);
    assert.equal(result.processed, 0, "merge-only must not invoke the model");
    assert.equal(result.snapshot?.complete, true);
    assert.equal(result.snapshot?.chapters, 2);
    assert.equal((result.snapshot as (typeof result.snapshot & { analysisModel?: string }) | undefined)?.analysisModel, model);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
      analysisVersion: 6, complete: true, batches: 2,
      analysisModel: "deepseek-v4.1-flash", analysisMaxChars: 14000,
      characters: [{ name: "林岚", shortBio: "一个复杂的人物", sourceRefs: [{ chunkId: "c1", source: "s.txt", chapter: "第一章" }] }],
      plotThreads: [{ title: "失踪案", summary: "仍未解决" }],
      foreshadowings: [{ clue: "墙上的旧照片", confidence: "可能线索" }],
      developmentPossibilities: [{ focus: "林岚", direction: "可能背叛同伴" }],
      storyCore: { centralConflicts: ["失踪案背后的争夺"], sourceRefs: [{ chunkId: "c1", source: "s.txt", chapter: "第一章" }] },
      macguffins: [{ name: "旧照片", whoWantsIt: ["林岚"] }],
      storyGraph: {
        nodes: [
          { id: "story_core:main", type: "story_core", label: "故事核心", data: { centralConflicts: ["失踪案背后的争夺"] }, sourceRefs: [{ chunkId: "c1", source: "s.txt", chapter: "第一章" }] },
          { id: "character:1", type: "character", label: "林岚", data: { name: "林岚" }, sourceRefs: [{ chunkId: "c1", source: "s.txt", chapter: "第一章" }] }
        ],
        edges: [{ id: "edge:1", from: "story_core:main", to: "character:1", type: "involves", label: "核心冲突相关人物", data: {}, sourceRefs: [{ chunkId: "c1", source: "s.txt", chapter: "第一章" }] }]
      }
    };
    saveStoryAnalysis(root, "test-world", snapshot);
    assert.deepEqual(readStoryAnalysis(root, "test-world"), snapshot);
    assert.equal(databaseStatus(root, "test-world").storyAnalysis, 1);
    const replacement = { ...snapshot, sourceHash: "c".repeat(64), batches: 3 };
    saveStoryAnalysis(root, "test-world", replacement);
    assert.deepEqual(readStoryAnalysis(root, "test-world"), replacement);
    assert.equal(databaseStatus(root, "test-world").storyAnalysis, 1);
    assert.throws(() => saveStoryAnalysis(root, "other-world", snapshot), /world mismatch/);
    invalidateDerivedAnalysis(root, "test-world");
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
    assert.equal(status.schemaVersion, 9);
    assert.equal(status.storyAnalysis, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upgrading a database that still holds a chunk copy drops it", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-chunk-table-drop-"));
  try {
    const worldDir = join(root, "world");
    await mkdir(worldDir, { recursive: true });
    const db = new DatabaseSync(join(worldDir, "novel.db"));
    db.exec("CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?)").run("test-world");
    db.exec("CREATE TABLE library_chunks(id TEXT PRIMARY KEY,text TEXT NOT NULL)");
    db.prepare("INSERT INTO library_chunks(id,text) VALUES('a','x')").run();
    db.exec("PRAGMA user_version=5");
    db.close();
    assert.equal(databaseStatus(worldDir, "test-world").schemaVersion, 9);
    const check = new DatabaseSync(join(worldDir, "novel.db"));
    try {
      assert.equal(check.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='library_chunks'").get(), undefined, "重复的分片表应已删除");
    } finally { check.close(); }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upgrading a database drops the graph tables and keeps the graph in the snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-graph-drop-"));
  try {
    const worldDir = join(root, "world");
    await mkdir(worldDir, { recursive: true });
    const snapshot = {
      worldId: "test-world", sourceHash: "a".repeat(64), analyzedAt: "2026-11-05T00:00:00.000Z",
      analysisVersion: 6, complete: true, batches: 1,
      characters: [], plotThreads: [], foreshadowings: [], developmentPossibilities: [],
      storyGraph: { nodes: [{ id: "n1", type: "character", label: "林岚", data: { name: "林岚" } }], edges: [] }
    };
    const db = new DatabaseSync(join(worldDir, "novel.db"));
    db.exec("CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    db.prepare("INSERT INTO world_meta(key,value) VALUES('world_id',?)").run("test-world");
    db.exec("CREATE TABLE story_analysis(singleton INTEGER PRIMARY KEY CHECK(singleton=1),world_id TEXT NOT NULL,source_hash TEXT NOT NULL,analyzed_at TEXT NOT NULL,payload_json TEXT NOT NULL)");
    db.exec("CREATE TABLE story_graph_nodes(node_id TEXT PRIMARY KEY,node_type TEXT NOT NULL,label TEXT NOT NULL,properties_json TEXT NOT NULL,source_refs_json TEXT NOT NULL DEFAULT '[]')");
    db.prepare("INSERT INTO story_analysis(singleton,world_id,source_hash,analyzed_at,payload_json) VALUES(1,?,?,?,?)").run("test-world", snapshot.sourceHash, snapshot.analyzedAt, JSON.stringify(snapshot));
    db.prepare("INSERT INTO story_graph_nodes(node_id,node_type,label,properties_json,source_refs_json) VALUES(?,?,?,?,?)").run("n1", "character", "林岚", "{}", "[]");
    db.exec("PRAGMA user_version=6");
    db.close();

    assert.equal(databaseStatus(worldDir, "test-world").schemaVersion, 9);
    assert.equal(readStoryAnalysis(worldDir, "test-world")?.storyGraph?.nodes?.[0]?.label, "林岚", "图仍保存在快照里");
    const check = new DatabaseSync(join(worldDir, "novel.db"));
    try {
      assert.equal(check.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='story_graph_nodes'").get(), undefined, "图谱表应已删除");
    } finally { check.close(); }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("library chunks are read from the JSON index and never copied into the database", async () => {
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
    assert.equal(databaseStatus(worldDir, "test-world").annotations, 0, "读取索引不应写入数据库");
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
