import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverWorkbenchRuns } from "../src/server.js";
import { getStoryExecution, saveStoryExecution } from "../src/story-execution.js";

test("startup recovery removes abandoned universe staging directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-recovery-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    const worlds = join(root, "worlds");
    const abandoned = join(worlds, ".staging-u-0123456789abcdef");
    const unrelated = join(worlds, ".staging-not-a-universe");
    await mkdir(abandoned, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    await writeFile(join(abandoned, "partial.json"), "{}");
    await recoverWorkbenchRuns();
    await assert.rejects(() => access(abandoned));
    await access(unrelated);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});


test("server startup recovery makes queued Story Unit executions resumable", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-story-execution-recovery-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    await mkdir(join(root, "worlds", "world-a"), { recursive: true });
    const now = new Date().toISOString();
    const task = {
      id: "a4d9a0ef-5a4b-4a7d-9b7f-2b0bfc2d3a11", worldId: "world-a",
      storyUnitId: "9b9d8b42-2c8c-4f9a-a9b7-1c7d9a0b4e21", storyUnitTitle: "雾河镇",
      mode: "complete_story" as const, status: "queued" as const, createdAt: now, updatedAt: now,
      completedChapters: [], events: [], brief: "", idleChapterCount: 0,
      pauseRequested: false, cancelRequested: false, resumeCount: 0
    };
    await saveStoryExecution(task);
    await recoverWorkbenchRuns();
    const recovered = await getStoryExecution(task.worldId, task.id);
    assert.equal(recovered?.status, "paused");
    assert.match(recovered?.error ?? "", /restarted/i);
    assert.equal(recovered?.storyUnitId, task.storyUnitId);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
