import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isVaneManifestUsable, searchVane } from "../src/vane-retrieval.js";

test("Vane search rejects missing and foreign-world manifests before opening an index", async () => {
  const root = await mkdtemp(join(tmpdir(), "vane-world-isolation-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    const indexDir = join(root, "worlds", "u-child", "vane-index");
    await mkdir(indexDir, { recursive: true });
    assert.deepEqual(await searchVane("u-child", "future marker"), []);

    const foreign = { worldId: "source-world", dim: 8, ids: ["future-doc"], vectorMode: false };
    await writeFile(join(indexDir, "manifest.json"), JSON.stringify(foreign));
    assert.equal(isVaneManifestUsable(foreign, "u-child"), false);
    assert.deepEqual(await searchVane("u-child", "future marker"), []);

    const local = { worldId: "u-child", dim: 8, ids: [], vectorMode: false };
    assert.equal(isVaneManifestUsable(local, "u-child"), true);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
