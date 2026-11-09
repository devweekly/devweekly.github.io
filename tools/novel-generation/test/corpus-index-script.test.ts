import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("offline corpus index builder records the exact original.txt SHA-256", async () => {
  const root = await mkdtemp(join(tmpdir(), "corpus-index-offline-"));
  try {
    const analysisDir = join(root, "analysis");
    await mkdir(analysisDir, { recursive: true });
    const original = [
      "第一章 大枪落幕",
      "李阎走进雨里。",
      "第二章 貘与姑获鸟",
      "夜色压下来。"
    ].join("\n");
    await writeFile(join(root, "original.txt"), original, "utf8");
    const sourceScript = fileURLToPath(new URL("../analysis/build-corpus-index.mjs", import.meta.url));
    const targetScript = join(analysisDir, "build-corpus-index.mjs");
    await copyFile(sourceScript, targetScript);

    const result = spawnSync(process.execPath, [targetScript], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const index = JSON.parse(await readFile(join(analysisDir, "conghuoniao", "chapter-index.json"), "utf8")) as {
      sourceHash: string;
      totalLines: number;
      chapterCount: number;
      volumes: Array<{ chapters: Array<{ title: string; line: number }> }>;
    };
    assert.equal(index.sourceHash, createHash("sha256").update(original, "utf8").digest("hex"));
    assert.equal(index.totalLines, 4);
    assert.equal(index.chapterCount, 2);
    assert.deepEqual(index.volumes.flatMap(volume => volume.chapters.map(chapter => chapter.title)), [
      "第一章 大枪落幕", "第二章 貘与姑获鸟"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
