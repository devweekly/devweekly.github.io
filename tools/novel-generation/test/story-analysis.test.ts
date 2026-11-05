import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { databaseStatus, readStoryAnalysis, saveStoryAnalysis, syncLibraryChunks } from "../src/database.js";
import { groupAnalysisBatches } from "../src/story-analysis.js";
import { loadLibraryChunks } from "../src/library.js";

test("story analysis batches preserve every indexed chunk in order", () => {
  const chunks = [0, 1, 2].map(index => ({
    id: "source:0:" + index, source: "source.txt", chapter: "第1章",
    chunkIndex: index, start: index * 1200, end: (index + 1) * 1200,
    text: "字".repeat(1200), sourceHash: "a".repeat(64), chapterStart: 0
  }));
  const batches = groupAnalysisBatches(chunks, 2500);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.flatMap(batch => batch.chunks.map(chunk => chunk.id)), chunks.map(chunk => chunk.id));
  assert.ok(batches.every(batch => batch.chars <= 2500));
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
    assert.equal(status.schemaVersion, 2);
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
