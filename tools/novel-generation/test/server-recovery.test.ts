import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverWorkbenchRuns } from "../src/server.js";
import { getRun, saveRun } from "../src/workbench-store.js";
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


test("startup recovery restores the pre-chapter Story Unit SQLite and state mirrors", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-chapter-rollback-"));
  const previousCwd = process.cwd();
  const worldId = "world-a";
  const runId = "a4d9a0ef-5a4b-4a7d-9b7f-2b0bfc2d3a11";
  const unitId = "9b9d8b42-2c8c-4f9a-a9b7-1c7d9a0b4e21";
  try {
    process.chdir(root);
    const unitDir = join(root, "worlds", worldId, ".story-units", unitId);
    const snapshotDir = join(root, ".output", worldId, "workbench", "state-snapshots", runId);
    await mkdir(unitDir, { recursive: true });
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(unitDir, "story.db"), "mutated-db");
    await writeFile(join(unitDir, "story-state.json"), "mutated-state");
    await writeFile(join(unitDir, "story-arc.md"), "mutated-arc");
    await writeFile(join(root, "worlds", worldId, ".story-units", unitId + ".json"), "mutated-unit");
    await writeFile(join(snapshotDir, "story.db"), "checkpoint-db");
    await writeFile(join(snapshotDir, "story-state.json"), "checkpoint-state");
    await writeFile(join(snapshotDir, "story-arc.md"), "checkpoint-arc");
    await writeFile(join(snapshotDir, "story-unit-record.json"), "checkpoint-unit");
    await writeFile(join(snapshotDir, "manifest.json"), JSON.stringify({
      version: 1, worldId, storyUnitId: unitId,
      files: { "story.db": true, "story.db-wal": false, "story.db-shm": false, "story-state.json": true, "story-arc.md": true, "story-unit-record.json": true }
    }));
    const now = new Date().toISOString();
    await saveRun({
      id: runId, worldId, storyUnitId: unitId, kind: "chapter", status: "running",
      createdAt: now, updatedAt: now, outputDir: join(root, ".output", worldId, "chapter-" + runId)
    });
    await recoverWorkbenchRuns();
    assert.equal(await (await import("node:fs/promises")).readFile(join(unitDir, "story.db"), "utf8"), "checkpoint-db");
    assert.equal(await (await import("node:fs/promises")).readFile(join(unitDir, "story-state.json"), "utf8"), "checkpoint-state");
    assert.equal(await (await import("node:fs/promises")).readFile(join(unitDir, "story-arc.md"), "utf8"), "checkpoint-arc");
    assert.equal(await (await import("node:fs/promises")).readFile(join(root, "worlds", worldId, ".story-units", unitId + ".json"), "utf8"), "checkpoint-unit");
    assert.equal((await getRun(worldId, runId))?.status, "failed");
    await assert.rejects(() => access(snapshotDir));
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
