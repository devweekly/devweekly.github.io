import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { emptyStoryState } from "../src/story-state.js";
import { rebaseStoryState, remapForkedRun } from "../src/universe-branch.js";
import type { WorkbenchRun } from "../src/workbench-store.js";

test("forked state keeps the selected chapter snapshot but receives a new universe identity", () => {
  const state = emptyStoryState("universe-a");
  state.currentPosition = "第十二章结尾";
  state.characters.push({ name: "主角", status: "受伤", location: "北门" });
  const fork = rebaseStoryState(state, "universe-a", "universe-b");
  assert.equal(fork.worldId, "universe-b");
  assert.equal(fork.currentPosition, "第十二章结尾");
  assert.equal(fork.characters[0]?.status, "受伤");
  assert.throws(() => rebaseStoryState(state, "universe-other", "universe-b"), /another universe/);
});

test("forked run history rewrites chapter and previous chapter paths into child output", () => {
  const parentA = path.resolve(".output/universe-a/chapter-a");
  const parentB = path.resolve(".output/universe-a/chapter-b");
  const childA = path.resolve(".output/universe-b/chapter-a");
  const childB = path.resolve(".output/universe-b/chapter-b");
  const outputs = new Map([[parentA, childA], [parentB, childB]]);
  const run: WorkbenchRun = {
    id: "4e25df2d-58f3-4a77-a2e4-7b09c5cfa2a1",
    worldId: "universe-a", kind: "chapter", status: "completed",
    createdAt: "2026-11-07T10:00:00.000Z", updatedAt: "2026-11-07T10:05:00.000Z",
    outputDir: parentB, chapterPath: path.join(parentB, "chapter.md"),
    previousChapterPath: path.join(parentA, "chapter.md")
  };
  const forked = remapForkedRun(run, "universe-b", outputs);
  assert.ok(forked);
  assert.equal(forked.worldId, "universe-b");
  assert.equal(forked.outputDir, childB);
  assert.equal(forked.chapterPath, path.join(childB, "chapter.md"));
  assert.equal(forked.previousChapterPath, path.join(childA, "chapter.md"));
  assert.equal(remapForkedRun({ ...run, chapterPath: "/outside/chapter.md" }, "universe-b", outputs), null);
});
