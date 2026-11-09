import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestFiles, searchLibrary } from "../src/library.js";
import { resolveWorldLibraryDir } from "../src/universe-library.js";

test("historical universe retrieval uses only its bounded local index", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-retrieval-"));
  try {
    const worlds = join(root, "worlds");
    const sourceDir = join(worlds, "source-world");
    const childDir = join(worlds, "u-historical");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(childDir, { recursive: true });
    await writeFile(join(childDir, "source-canon.json"), JSON.stringify({ sourceWorldId: "source-world", readOnly: true }));
    await writeFile(join(childDir, "universe.json"), JSON.stringify({
      id: "u-historical", sourceWorldId: "source-world", entryChapter: "第1章 起点前", entryChapterIndex: 0
    }));
    const fullText = join(root, "full.txt");
    const boundedText = join(root, "bounded.txt");
    await writeFile(fullText, `第1章 起点前
铜钱藏在旧城门下。
第2章 未来
未来剧情泄漏标记：沈砚在终局背叛所有人。`);
    await writeFile(boundedText, `第1章 起点前
铜钱藏在旧城门下。`);
    await writeFile(join(root, "original.txt"), await (await import("node:fs/promises")).readFile(fullText, "utf8"));
    await writeFile(join(childDir, "original.txt"), await (await import("node:fs/promises")).readFile(boundedText, "utf8"));
    await mkdir(join(root, "analysis", "source-world"), { recursive: true });
    await writeFile(join(root, "analysis", "source-world", "chapter-index.json"), JSON.stringify({
      schemaVersion: 2, totalLines: 4,
      volumes: [{ volume: 1, chapters: [
        { sequenceInVolume: 1, title: "第1章 起点前", label: "起点前", line: 1 },
        { sequenceInVolume: 2, title: "第2章 未来", label: "未来", line: 3 }
      ] }]
    }));
    await ingestFiles("source-world", [fullText], join(sourceDir, "library"));
    await ingestFiles("u-historical", [boundedText], join(childDir, "library"));

    const selectedDir = await resolveWorldLibraryDir("u-historical", worlds);
    assert.equal(selectedDir, join(childDir, "library"));
    const hits = await searchLibrary(selectedDir, "未来剧情泄漏标记", 5);
    assert.equal(hits.length, 0);
    const validHits = await searchLibrary(selectedDir, "铜钱", 5);
    assert.ok(validHits.some(hit => hit.text.includes("铜钱藏在旧城门下")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical universe fails closed when bounded index is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-no-index-"));
  try {
    const worlds = join(root, "worlds");
    const sourceDir = join(worlds, "source-world");
    const childDir = join(worlds, "u-historical");
    await mkdir(join(sourceDir, "library"), { recursive: true });
    await mkdir(childDir, { recursive: true });
    await writeFile(join(childDir, "source-canon.json"), JSON.stringify({ sourceWorldId: "source-world", readOnly: true }));
    await writeFile(join(childDir, "universe.json"), JSON.stringify({
      id: "u-historical", sourceWorldId: "source-world", entryChapter: "第1章 起点前", entryChapterIndex: 0
    }));
    await mkdir(join(root, "analysis", "source-world"), { recursive: true });
    await writeFile(join(root, "analysis", "source-world", "chapter-index.json"), JSON.stringify({
      schemaVersion: 2, totalLines: 4,
      volumes: [{ volume: 1, chapters: [
        { sequenceInVolume: 1, title: "第1章 起点前", label: "起点前", line: 1 },
        { sequenceInVolume: 2, title: "第2章 未来", label: "未来", line: 3 }
      ] }]
    }));
    await writeFile(join(sourceDir, "library", "index.json"), JSON.stringify({ worldId: "source-world", chunks: [] }));
    await assert.rejects(() => resolveWorldLibraryDir("u-historical", worlds), /找不到原著全文/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a universe record without source-canon metadata cannot be treated as a source world", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-missing-pointer-"));
  try {
    const worlds = join(root, "worlds");
    const childDir = join(worlds, "u-historical");
    await mkdir(join(childDir, "library"), { recursive: true });
    await writeFile(join(childDir, "universe.json"), JSON.stringify({
      id: "u-historical", sourceWorldId: "source-world", entryChapter: "第一章", entryChapterIndex: 0
    }));
    await writeFile(join(childDir, "library", "index.json"), JSON.stringify({ worldId: "u-historical", chunks: [] }));
    await assert.rejects(() => resolveWorldLibraryDir("u-historical", worlds), /缺少有效的只读 source-canon.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

