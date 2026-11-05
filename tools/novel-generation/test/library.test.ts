import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestFiles, listTextFiles, searchLibrary } from "../src/library.js";

test("ingests chapter headings and retrieves Chinese passages", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-library-"));
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
    const hits = await searchLibrary(library, "铜钱 乌鸦", 5);
    assert.ok(hits.length > 0);
    assert.match(hits[0]?.text ?? "", /铜钱|乌鸦/);
    assert.equal(hits[0]?.chapter, "第2章 铜钱的秘密");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("re-ingesting a changed source removes stale chunks and annotations", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-library-refresh-"));
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
