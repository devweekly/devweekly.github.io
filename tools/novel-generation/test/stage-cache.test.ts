import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadRunStoryState, prepareRunDirectory, runCachedStage } from "../src/stage-cache.js";
import { emptyStoryState, saveStoryState } from "../src/story-state.js";

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


test("resume directory identity is bound to its world and pipeline kind", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "novel-run-identity-"));
  try {
    await prepareRunDirectory(dir, "world-a", "write-long");
    await assert.rejects(() => prepareRunDirectory(dir, "world-a", "write"), /identity mismatch/);
    await assert.rejects(() => prepareRunDirectory(dir, "world-b", "write-long"), /identity mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resume always reads the immutable initial state after a previous attempt committed", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "novel-state-snapshot-"));
  try {
    const statePath = resolve(dir, "worlds", "world-a", "story-state.json");
    const outputDir = resolve(dir, ".output", "world-a", "run-1");
    const initial = await loadRunStoryState(statePath, "world-a", outputDir, "write");
    assert.equal(initial.currentPosition, "尚未建立");
    const committed = { ...emptyStoryState("world-a"), currentPosition: "第1章结束" };
    await saveStoryState(statePath, committed);
    const resumed = await loadRunStoryState(statePath, "world-a", outputDir, "write");
    assert.equal(resumed.currentPosition, "尚未建立");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("semantically invalid cached output is regenerated instead of reused", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "novel-stage-cache-validation-"));
  try {
    let calls = 0;
    const first = await runCachedStage({
      dir, key: "review", outputFile: "review.json", fingerprint: "same-input",
      execute: async () => { calls++; return JSON.stringify({ status: "needs_repair", issues: [] }); }
    });
    assert.match(first, /needs_repair/);
    const second = await runCachedStage({
      dir, key: "review", outputFile: "review.json", fingerprint: "same-input",
      execute: async () => { calls++; return JSON.stringify({ status: "pass", issues: [] }); },
      validate: output => {
        const value = JSON.parse(output) as { status?: string; issues?: unknown[] };
        if (value.status === "needs_repair" && (!Array.isArray(value.issues) || value.issues.length === 0)) {
          throw new Error("invalid review");
        }
      }
    });
    assert.match(second, /"pass"/);
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
