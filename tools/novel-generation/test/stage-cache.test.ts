import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCachedStage } from "../src/stage-cache.js";

test("stage cache reuses only matching prompt fingerprints and intact output", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "novel-stage-cache-"));
  try {
    let calls = 0;
    const run = (fingerprint: string) => runCachedStage({
      dir, key: "draft", outputFile: "draft.md", fingerprint,
      execute: async () => { calls++; return "chapter " + calls; }
    });
    assert.equal(await run("prompt-a"), "chapter 1");
    assert.equal(await run("prompt-a"), "chapter 1");
    assert.equal(calls, 1);
    assert.equal(await run("prompt-b"), "chapter 2");
    assert.equal(calls, 2);
    await writeFile(resolve(dir, "draft.md"), "corrupted\n", "utf8");
    assert.equal(await run("prompt-b"), "chapter 3");
    assert.equal(calls, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent stage completions do not overwrite each other's manifest entries", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "novel-stage-cache-race-"));
  try {
    await Promise.all(["plot", "creative"].map(key => runCachedStage({
      dir, key, outputFile: key + ".md", fingerprint: key,
      execute: async () => key + " result"
    })));
    const manifest = JSON.parse(await readFile(resolve(dir, "pipeline-manifest.json"), "utf8")) as {
      stages: Record<string, unknown>;
    };
    assert.ok(manifest.stages.plot);
    assert.ok(manifest.stages.creative);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
