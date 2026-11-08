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
      events: [{ at: now, type: "created", message: "created" }],
      currentRunId: "8c7f50f1-8e9d-4a20-b6d0-a7a4c4c8d9a1",
      brief: "", idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    };
    await saveStoryExecution(task);
    assert.equal((await getStoryExecution("world-a", task.id))?.completedChapters.length, 1);
    assert.equal((await listStoryExecutions("world-a")).length, 1);
    assert.equal(await recoverStoryExecutions("world-a"), 1);
    const recovered = await getStoryExecution("world-a", task.id);
    assert.equal(recovered?.status, "paused");
    assert.equal(recovered?.completedChapters.length, 1);
    assert.equal(recovered?.currentRunId, "8c7f50f1-8e9d-4a20-b6d0-a7a4c4c8d9a1");
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
      completedChapters: [], events: [], brief: "", idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    } as never));
  } finally {
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
});


test("fixed chapter batches accept story-sized counts without a 30 chapter cap", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "story-batch-"));
  process.chdir(root);
  try {
    const now = new Date().toISOString();
    const task = {
      id: "9e2ad4d2-8b6f-4a9f-a4c4-8e49f6d08a61", worldId: "world-a", storyUnitTitle: "雾河镇",
      mode: "fixed_batch" as const, targetChapterCount: 37, status: "queued" as const,
      createdAt: now, updatedAt: now, completedChapters: [], events: [], brief: "",
      idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    };
    await saveStoryExecution(task);
    const saved = await getStoryExecution("world-a", task.id);
    assert.equal(saved?.mode, "fixed_batch");
    assert.equal(saved?.targetChapterCount, 37);
  } finally {
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
});


test("story execution listing can isolate one Story Unit within a shared world", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "story-execution-units-"));
  process.chdir(root);
  try {
    const now = new Date().toISOString();
    const base = {
      worldId: "world-a", mode: "complete_story" as const, status: "queued" as const,
      createdAt: now, updatedAt: now, completedChapters: [], events: [], brief: "",
      idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    };
    const first = { ...base, id: "9e2ad4d2-8b6f-4a9f-a4c4-8e49f6d08a61", storyUnitId: "5e4a83c8-51aa-4cc3-8db1-b93f27f4c5a2", storyUnitTitle: "雾河镇" };
    const second = { ...base, id: "7ab0f4d0-99e0-4f6d-8c1b-1a0e8b7f3c19", storyUnitId: "8c7f50f1-8e9d-4a20-b6d0-a7a4c4c8d9a1", storyUnitTitle: "山中旧城" };
    await saveStoryExecution(first);
    await saveStoryExecution(second);
    assert.equal((await listStoryExecutions("world-a")).length, 2);
    assert.deepEqual((await listStoryExecutions("world-a", first.storyUnitId)).map(x => x.id), [first.id]);
    assert.deepEqual((await listStoryExecutions("world-a", second.storyUnitId)).map(x => x.id), [second.id]);
  } finally {
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
});
