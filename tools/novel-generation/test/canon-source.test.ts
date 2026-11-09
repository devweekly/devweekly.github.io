import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyOriginalCanonToUniverse, resolveOriginalCanonPath, truncateCanonAtLine } from "../src/canon-source.js";

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
    const original = "canonical root corpus\\nfuture chapter";
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
  assert.equal(truncateCanonAtLine("第一章\\r\\n正文\\r\\n第二章\\r\\n未来", 3), "第一章\\r\\n正文");
  assert.equal(truncateCanonAtLine("第一章\\n正文\\n第二章", undefined), "第一章\\n正文\\n第二章");
  assert.throws(() => truncateCanonAtLine("只有一行", 3), /超出全文范围/);
});

