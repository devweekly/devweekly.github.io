import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isVaneManifestUsable, publishVaneIndexDirectory, searchVane } from "../src/vane-retrieval.js";

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


test("Vane index publication replaces the old index only after a complete staging directory exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "vane-index-publish-"));
  try {
    const active = join(root, "vane-index");
    const staging = join(root, ".vane-index.staging-test");
    await mkdir(active);
    await writeFile(join(active, "manifest.json"), "old manifest");
    await mkdir(staging);
    await writeFile(join(staging, "manifest.json"), "new manifest");
    await writeFile(join(staging, "documents.bin"), "new index");
    await publishVaneIndexDirectory(staging, active);
    assert.equal(await readFile(join(active, "manifest.json"), "utf8"), "new manifest");
    assert.equal(await readFile(join(active, "documents.bin"), "utf8"), "new index");
    assert.deepEqual((await readdir(root)).sort(), ["vane-index"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Vane index publication restores the previous index if the staged directory cannot be published", async () => {
  const root = await mkdtemp(join(tmpdir(), "vane-index-rollback-"));
  try {
    const active = join(root, "vane-index");
    const missingStaging = join(root, "missing-staging");
    await mkdir(active);
    await writeFile(join(active, "manifest.json"), "last known good");
    await assert.rejects(() => publishVaneIndexDirectory(missingStaging, active));
    assert.equal(await readFile(join(active, "manifest.json"), "utf8"), "last known good");
    assert.deepEqual((await readdir(root)).sort(), ["vane-index"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
