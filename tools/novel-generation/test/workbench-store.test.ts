import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCandidate, getRun, listCandidates, listRuns, recoverInterruptedRuns, saveCandidate, saveRun, type StoryPlanCandidate, type WorkbenchRun } from "../src/workbench-store.js";

let originalCwd = "";
let temporaryRoot = "";
before(async () => {
  originalCwd = process.cwd();
  temporaryRoot = await mkdtemp(join(tmpdir(), "novel-workbench-test-"));
  process.chdir(temporaryRoot);
});
after(async () => {
  process.chdir(originalCwd);
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("persists runs and candidates", async () => {
  const worldId = "test-world";
  const now = new Date().toISOString();
  const run: WorkbenchRun = { id: "4e25df2d-58f3-4a77-a2e4-7b09c5cfa2a1", worldId, kind: "story-plan", status: "running", createdAt: now, updatedAt: now };
  const candidate: StoryPlanCandidate = { id: "a33b25e4-f42c-40f1-b59c-c5ecab2395b0", worldId, type: "story-plan", status: "pending", createdAt: now, updatedAt: now, baseUpdatedAt: null, plan: { worldId, status: "draft" }, runId: run.id };
  await saveRun(run);
  await saveCandidate(candidate);

  assert.deepEqual(await getRun(worldId, run.id), run);
  assert.deepEqual(await getCandidate(worldId, candidate.id), candidate);
  assert.equal((await listRuns(worldId)).length, 1);
  assert.equal((await listCandidates(worldId)).length, 1);
});

test("marks queued and running work as interrupted after restart", async () => {
  const worldId = "recovery-world";
  const now = new Date().toISOString();
  await saveRun({ id: "f421e927-8137-4e8f-94f7-719f3dcf94d7", worldId, kind: "story-plan", status: "queued", createdAt: now, updatedAt: now });
  await saveRun({ id: "e7cde4f3-98d1-4a31-a41e-1eebbc8c843d", worldId, kind: "story-plan", status: "running", createdAt: now, updatedAt: now });
  assert.equal(await recoverInterruptedRuns(worldId), 2);
  const runs = await listRuns(worldId);
  assert.ok(runs.every(run => run.status === "failed"));
  assert.ok(runs.every(run => run.error?.includes("Server restarted")));
});
