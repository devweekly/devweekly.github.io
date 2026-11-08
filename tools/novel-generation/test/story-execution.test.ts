import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStoryExecution, listStoryExecutions, recoverStoryExecutions, saveStoryExecution } from "../src/story-execution.js";

test("story execution checkpoints survive restart and resume from completed chapters", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "story-execution-"));
  process.chdir(root);
  try {
    const now = new Date().toISOString();
    const task = {
      id: "5e4a83c8-51aa-4cc3-8db1-b93f27f4c5a2", worldId: "world-a", storyUnitTitle: "雾河镇", mode: "complete_story" as const,
      status: "running" as const, createdAt: now, updatedAt: now, startedAt: now,
      completedChapters: [{ runId: "7ab0f4d0-99e0-4f6d-8c1b-1a0e8b7f3c19", chapterPath: ".output/world-a/chapter-one/chapter.md", completedAt: now }],
      brief: "", idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    };
    await saveStoryExecution(task);
    assert.equal((await getStoryExecution("world-a", task.id))?.completedChapters.length, 1);
    assert.equal((await listStoryExecutions("world-a")).length, 1);
    assert.equal(await recoverStoryExecutions("world-a"), 1);
    const recovered = await getStoryExecution("world-a", task.id);
    assert.equal(recovered?.status, "paused");
    assert.equal(recovered?.completedChapters.length, 1);
    assert.match(recovered?.error ?? "", /resume/i);
  } finally {
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
});

test("story execution rejects invalid lifecycle states and malformed checkpoint IDs", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "story-execution-invalid-"));
  process.chdir(root);
  try {
    const now = new Date().toISOString();
    await assert.rejects(() => saveStoryExecution({
      id: "not-a-uuid", worldId: "world-a", storyUnitTitle: "x", mode: "complete_story", status: "running", createdAt: now, updatedAt: now,
      completedChapters: [], brief: "", idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    } as never));
  } finally {
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
});
