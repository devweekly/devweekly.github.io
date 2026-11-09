import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestFiles, listTextFiles, loadLibraryChunks, searchLibrary } from "../src/library.js";

test("ingests chapter headings and retrieves Chinese passages", async () => {
  const root = await mkdtemp(join(process.cwd(), ".novel-library-"));
  try {
    const input = join(root, "novel.txt");
    const library = join(root, "library");
    await writeFile(input, [
      "第1章 夜入旧城",
      "李玄站在城门下，发现守门人留下了一枚铜钱。",
      "第2章 铜钱的秘密",
      "铜钱背面刻着一只乌鸦，指向北面的废弃戏院。"
    ].join("\n"), "utf8");

    const count = await ingestFiles("test-world", [input], library);
    assert.ok(count >= 2);
    const index = JSON.parse(await readFile(join(library, "index.json"), "utf8")) as { chunks: Array<{ sourceHash?: string; chapterStart?: number; start: number; end: number; text: string }> };
    assert.ok(index.chunks.every(chunk => /^[a-f0-9]{64}$/.test(chunk.sourceHash ?? "")));
    assert.ok(index.chunks.every(chunk => Number.isInteger(chunk.chapterStart) && chunk.end - chunk.start === chunk.text.length));
    const hits = await searchLibrary(library, "铜钱 乌鸦", 5);
    assert.ok(hits.length > 0);
    const firstPass = hits.map(hit => hit.id + ":" + hit.score.toFixed(6));
    const secondPass = await searchLibrary(library, "铜钱 乌鸦", 5);
    assert.deepEqual(secondPass.map(hit => hit.id + ":" + hit.score.toFixed(6)), firstPass);
    assert.match(hits[0]?.text ?? "", /铜钱|乌鸦/);
    assert.equal(hits[0]?.chapter, "第2章 铜钱的秘密");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("re-ingesting a changed source removes stale chunks and annotations", async () => {
  const root = await mkdtemp(join(process.cwd(), ".novel-library-refresh-"));
  try {
    const input = join(root, "volume.txt");
    const library = join(root, "library");
    await writeFile(input, "第1章 旧线索\n旧线索只在这里出现。", "utf8");
    await ingestFiles("test-world", [input], library);

    const oldIndex = JSON.parse(await readFile(join(library, "index.json"), "utf8")) as {
      chunks: Array<{ id: string; source: string }>;
    };
    await writeFile(join(library, "annotations.json"), JSON.stringify({
      schemaVersion: 1, worldId: "test-world",
      annotations: [{ chunkId: oldIndex.chunks[0]?.id, source: oldIndex.chunks[0]?.source }],
      failures: []
    }), "utf8");

    await writeFile(input, "第1章 新线索\n新线索在这里出现。", "utf8");
    await ingestFiles("test-world", [input], library);

    // 中文二元组检索是近似匹配，"线索" 会命中 "新线索"；这里验证的是旧片段确实被移除。
    assert.ok((await searchLibrary(library, "旧线索", 5)).every(hit => !hit.text.includes("旧线索")));
    assert.ok((await searchLibrary(library, "新线索", 5)).length > 0);
    const index = JSON.parse(await readFile(join(library, "index.json"), "utf8")) as { chunks: unknown[] };
    assert.ok(index.chunks.length > 0);
    const annotations = JSON.parse(await readFile(join(library, "annotations.json"), "utf8")) as { annotations: unknown[] };
    assert.equal(annotations.annotations.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers text files recursively and ignores other formats", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-library-files-"));
  try {
    const nested = join(root, "volume", "chapter");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "notes.md"), "notes", "utf8");
    await writeFile(join(nested, "chapter.txt"), "chapter", "utf8");
    await writeFile(join(nested, "cover.png"), "not an image", "utf8");
    const files = await listTextFiles([root]);
    assert.equal(files.length, 2);
    assert.ok(files.some(file => file.endsWith("chapter.txt")));
    assert.ok(files.some(file => file.endsWith("notes.md")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private and external source files are stored only in ignored private-library and remain searchable", async () => {
  const root = await mkdtemp(join(process.cwd(), ".novel-library-private-"));
  try {
    const privateDir = join(root, "private");
    const worldDir = join(root, "worlds", "test-world");
    const library = join(worldDir, "library");
    await mkdir(privateDir, { recursive: true });
    await writeFile(join(privateDir, "notes.txt"), "第1章 私人线索\\n只有本机可以检索的秘密证据。", "utf8");

    const count = await ingestFiles("test-world", [join(privateDir, "notes.txt")], library);
    assert.ok(count > 0);
    const publicIndex = JSON.parse(await readFile(join(library, "index.json"), "utf8")) as { chunks: Array<{ text: string }> };
    const privateIndex = JSON.parse(await readFile(join(worldDir, "private-library", "index.json"), "utf8")) as { chunks: Array<{ text: string }> };
    assert.equal(publicIndex.chunks.length, 0);
    assert.ok(privateIndex.chunks.some(chunk => chunk.text.includes("只有本机可以检索的秘密证据")));
    assert.ok(!JSON.stringify(publicIndex).includes("只有本机可以检索的秘密证据"));
    assert.equal((await loadLibraryChunks(library, "test-world")).length, 0,
      "private material must not enter canonical indexing or public analysis");
    const hits = await searchLibrary(library, "私人线索 秘密证据", 5);
    assert.ok(hits.some(hit => hit.text.includes("只有本机可以检索的秘密证据")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy private chunks and annotations are migrated out of tracked public assets", async () => {
  const root = await mkdtemp(join(process.cwd(), ".novel-library-private-migrate-"));
  try {
    const worldDir = join(root, "worlds", "test-world");
    const library = join(worldDir, "library");
    await mkdir(library, { recursive: true });
    const privateChunk = {
      id: "private/secret.txt:0:0", source: "private/secret.txt", chapter: "秘密",
      chunkIndex: 0, start: 0, end: 8, text: "私有引文不能留在 Git"
    };
    await writeFile(join(library, "index.json"), JSON.stringify({
      schemaVersion: 1, worldId: "test-world", createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z", chunks: [privateChunk]
    }));
    await writeFile(join(library, "annotations.json"), JSON.stringify({
      schemaVersion: 1, worldId: "test-world",
      annotations: [{ chunkId: privateChunk.id, source: privateChunk.source, evidence: "私有引文不能留在 Git" }],
      failures: []
    }));
    await writeFile(join(library, "entities.json"), JSON.stringify({
      entities: [{ id: "private-entity", name: "私有人物", type: "character", aliases: [],
        mentions: [{ chunkId: privateChunk.id, source: privateChunk.source, chapter: "秘密", evidence: "私有引文不能留在 Git" }] }]
    }));
    const db = new DatabaseSync(join(worldDir, "novel.db"));
    db.exec("CREATE TABLE annotations(chunk_id TEXT PRIMARY KEY,source TEXT NOT NULL,chapter TEXT NOT NULL,extracted_at TEXT NOT NULL,payload_json TEXT NOT NULL); CREATE TABLE entities(entity_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,aliases_json TEXT NOT NULL,mention_count INTEGER NOT NULL,payload_json TEXT NOT NULL); CREATE TABLE entity_mentions(entity_id TEXT NOT NULL,chunk_id TEXT NOT NULL,source TEXT NOT NULL,chapter TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(entity_id,chunk_id));");
    db.prepare("INSERT INTO annotations VALUES(?,?,?,?,?)").run(privateChunk.id, privateChunk.source, "秘密", "", JSON.stringify({ evidence: "私有引文不能留在 Git" }));
    db.prepare("INSERT INTO entities VALUES(?,?,?,?,?,?)").run("private-entity", "私有人物", "character", "[]", 1, "{}");
    db.prepare("INSERT INTO entity_mentions VALUES(?,?,?,?,?)").run("private-entity", privateChunk.id, privateChunk.source, "秘密", "私有引文不能留在 Git");
    db.close();

    const hits = await searchLibrary(library, "私有引文", 5);
    assert.ok(hits.some(hit => hit.text.includes("私有引文不能留在 Git")));
    const publicIndex = JSON.parse(await readFile(join(library, "index.json"), "utf8")) as { chunks: Array<{ text: string }> };
    const privateIndex = JSON.parse(await readFile(join(worldDir, "private-library", "index.json"), "utf8")) as { chunks: Array<{ text: string }> };
    assert.equal(publicIndex.chunks.length, 0);
    assert.ok(privateIndex.chunks.some(chunk => chunk.text.includes("私有引文不能留在 Git")));
    assert.equal(await readFile(join(library, "annotations.json"), "utf8").catch(() => ""), "");
    assert.equal(await readFile(join(library, "entities.json"), "utf8").catch(() => ""), "");
    const verifyDb = new DatabaseSync(join(worldDir, "novel.db"));
    try {
      assert.equal((verifyDb.prepare("SELECT COUNT(*) AS count FROM annotations").get() as { count: number }).count, 0);
      assert.equal((verifyDb.prepare("SELECT COUNT(*) AS count FROM entities").get() as { count: number }).count, 0);
      assert.equal((verifyDb.prepare("SELECT COUNT(*) AS count FROM entity_mentions").get() as { count: number }).count, 0);
    } finally { verifyDb.close(); }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

