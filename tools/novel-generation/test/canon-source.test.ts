import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyOriginalCanonToUniverse, ensureBoundedUniverseCanonAssets, resolveOriginalCanonPath, truncateCanonAtLine } from "../src/canon-source.js";

test("source worlds resolve project-root original.txt before legacy world-local copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "canon-source-root-"));
  try {
    const world = join(root, "worlds", "source-world");
    await mkdir(world, { recursive: true });
    await writeFile(join(root, "original.txt"), "canonical root corpus", "utf8");
    await writeFile(join(world, "original.txt"), "stale legacy copy", "utf8");
    assert.equal(await resolveOriginalCanonPath("source-world", { projectRoot: root }), join(root, "original.txt"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical universes never fall back to the full project-root corpus", async () => {
  const root = await mkdtemp(join(tmpdir(), "canon-source-universe-"));
  try {
    const universe = join(root, "worlds", "u-1234567890abcdef");
    await mkdir(universe, { recursive: true });
    await writeFile(join(root, "original.txt"), "FULL BOOK WITH FUTURE PLOT", "utf8");
    await writeFile(join(universe, "universe.json"), JSON.stringify({ id: "u-1234567890abcdef" }), "utf8");
    await assert.rejects(
      resolveOriginalCanonPath("u-1234567890abcdef", { projectRoot: root }),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT" && /拒绝回退到项目根目录/.test(error.message ?? "")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("universe copy creates an independent local copy from the root corpus", async () => {
  const root = await mkdtemp(join(tmpdir(), "canon-source-copy-"));
  try {
    const source = join(root, "worlds", "source-world");
    const target = join(root, "worlds", "u-1234567890abcdef");
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    const original = "canonical root corpus\nfuture chapter";
    await writeFile(join(root, "original.txt"), original, "utf8");
    assert.equal(await copyOriginalCanonToUniverse("source-world", target, root, 2), true);
    assert.equal(await readFile(join(target, "original.txt"), "utf8"), "canonical root corpus");
    await writeFile(join(target, "original.txt"), "universe-local copy");
    assert.equal(await readFile(join(root, "original.txt"), "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canon truncation excludes the next chapter heading and handles CRLF", () => {
  assert.equal(truncateCanonAtLine("第一章\r\n正文\r\n第二章\r\n未来", 3), "第一章\r\n正文");
  assert.equal(truncateCanonAtLine("第一章\n正文\n第二章", undefined), "第一章\n正文\n第二章");
  assert.throws(() => truncateCanonAtLine("只有一行", 3), /超出全文范围/);
});

test("legacy universe repair truncates full local canon and rebinds library hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "canon-source-migrate-"));
  try {
    const sourceId = "source-world";
    const universeId = "u-1234567890abcdef";
    const sourceDir = join(root, "worlds", sourceId);
    const universeDir = join(root, "worlds", universeId);
    await mkdir(sourceDir, { recursive: true });
    await mkdir(join(universeDir, "library"), { recursive: true });
    await mkdir(join(root, "analysis", sourceId), { recursive: true });
    await mkdir(join(root, "analysis", universeId), { recursive: true });
    const fullText = ["第一章", "正文一", "第二章", "正文二", "第三章", "未来剧情"].join("\n");
    const fullHash = createHash("sha256").update(fullText, "utf8").digest("hex");
    const starts = [fullText.indexOf("第一章"), fullText.indexOf("第二章"), fullText.indexOf("第三章")];
    const catalog = {
      schemaVersion: 2, totalLines: 6,
      volumes: [{ volume: 1, startLine: 1, endLine: 6, chapters: [
        { sequenceInVolume: 1, title: "第一章", label: "第一章", line: 1 },
        { sequenceInVolume: 2, title: "第二章", label: "第二章", line: 3 },
        { sequenceInVolume: 3, title: "第三章", label: "第三章", line: 5 }
      ] }]
    };
    await writeFile(join(root, "original.txt"), fullText, "utf8");
    await writeFile(join(root, "analysis", sourceId, "chapter-index.json"), JSON.stringify(catalog));
    await writeFile(join(universeDir, "universe.json"), JSON.stringify({
      id: universeId, sourceWorldId: sourceId, entryChapter: "第二章", entryChapterIndex: 1
    }));
    await writeFile(join(universeDir, "original.txt"), fullText, "utf8");
    await writeFile(join(universeDir, "source-canon.json"), JSON.stringify({ sourceWorldId: sourceId, readOnly: true }));
    await writeFile(join(universeDir, "library", "index.json"), JSON.stringify({
      schemaVersion: 1, worldId: universeId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      chunks: [
        { id: "c1", source: "worlds/source-world/original.txt", sourceHash: fullHash, chapter: "第一章", chunkIndex: 0, start: 0, end: 3, chapterStart: starts[0], text: "正文一" },
        { id: "c2", source: "worlds/source-world/original.txt", sourceHash: fullHash, chapter: "第二章", chunkIndex: 0, start: 0, end: 3, chapterStart: starts[1], text: "正文二" },
        { id: "c3", source: "worlds/source-world/original.txt", sourceHash: fullHash, chapter: "第三章", chunkIndex: 0, start: 0, end: 4, chapterStart: starts[2], text: "未来剧情" }
      ]
    }));
    await writeFile(join(root, "analysis", universeId, "chapter-index.json"), JSON.stringify(catalog));

    assert.equal(await ensureBoundedUniverseCanonAssets(universeId, { projectRoot: root }), true);
    const boundedText = ["第一章", "正文一", "第二章", "正文二"].join("\n");
    assert.equal(await readFile(join(universeDir, "original.txt"), "utf8"), boundedText);
    const index = JSON.parse(await readFile(join(universeDir, "library", "index.json"), "utf8")) as {
      chunks: Array<{ id: string; source: string; sourceHash: string }>;
    };
    assert.deepEqual(index.chunks.map(chunk => chunk.id), ["c1", "c2"]);
    assert.ok(index.chunks.every(chunk => chunk.source === `worlds/${universeId}/original.txt`));
    assert.ok(index.chunks.every(chunk => chunk.sourceHash === createHash("sha256").update(boundedText, "utf8").digest("hex")));
    const childCatalog = JSON.parse(await readFile(join(root, "analysis", universeId, "chapter-index.json"), "utf8")) as {
      totalLines: number; volumes: Array<{ chapters: Array<{ title: string }> }>;
    };
    assert.equal(childCatalog.totalLines, 4);
    assert.deepEqual(childCatalog.volumes.flatMap(volume => volume.chapters.map(chapter => chapter.title)), ["第一章", "第二章"]);
    // A second call is idempotent.
    assert.equal(await ensureBoundedUniverseCanonAssets(universeId, { projectRoot: root }), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy universe repair reconstructs a missing local copy only as a bounded prefix", async () => {
  const root = await mkdtemp(join(tmpdir(), "canon-source-recover-"));
  try {
    const sourceId = "source-world";
    const universeId = "u-1234567890abcdef";
    const universeDir = join(root, "worlds", universeId);
    await mkdir(universeDir, { recursive: true });
    await mkdir(join(root, "analysis", sourceId), { recursive: true });
    await writeFile(join(root, "original.txt"), "第一章\n正文一\n第二章\n正文二\n第三章\n未来剧情", "utf8");
    await writeFile(join(root, "analysis", sourceId, "chapter-index.json"), JSON.stringify({
      volumes: [{ volume: 1, chapters: [
        { sequenceInVolume: 1, title: "第一章", label: "第一章", line: 1 },
        { sequenceInVolume: 2, title: "第二章", label: "第二章", line: 3 },
        { sequenceInVolume: 3, title: "第三章", label: "第三章", line: 5 }
      ] }]
    }));
    await writeFile(join(universeDir, "universe.json"), JSON.stringify({
      id: universeId, sourceWorldId: sourceId, entryChapter: "第二章", entryChapterIndex: 1
    }));
    assert.equal(await ensureBoundedUniverseCanonAssets(universeId, { projectRoot: root }), true);
    const boundedText = "第一章\n正文一\n第二章\n正文二";
    assert.equal(await readFile(join(universeDir, "original.txt"), "utf8"), boundedText);
    assert.ok(!(await readFile(join(universeDir, "original.txt"), "utf8")).includes("未来剧情"));
    const library = JSON.parse(await readFile(join(universeDir, "library", "index.json"), "utf8")) as {
      chunks: Array<{ source: string; sourceHash: string; text: string }>;
    };
    assert.equal(library.chunks.length, 2, "missing legacy library index must be rebuilt from bounded original text");
    assert.ok(library.chunks.every(chunk => chunk.source === `worlds/${universeId}/original.txt`));
    assert.ok(library.chunks.every(chunk => chunk.sourceHash === createHash("sha256").update(boundedText, "utf8").digest("hex")));
    assert.ok(!JSON.stringify(library).includes("未来剧情"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

