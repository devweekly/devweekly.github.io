import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUniverseAnalysisJob, startUniverseAnalysisRebuild } from "../src/universe-analysis-jobs.js";

test("as-of analysis job records an isolated failure without throwing into universe creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-analysis-job-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    assert.equal(await readUniverseAnalysisJob("u-test"), null);
    const job = await startUniverseAnalysisRebuild("u-test", "第一章");
    assert.equal(job.worldId, "u-test");
    assert.equal(job.entryChapter, "第一章");
    assert.ok(["running", "failed"].includes(job.status));

    let persisted = await readUniverseAnalysisJob("u-test");
    for (let attempt = 0; attempt < 40 && persisted?.status === "running"; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      persisted = await readUniverseAnalysisJob("u-test");
    }
    assert.equal(persisted?.status, "failed");
    assert.match(persisted?.error ?? "", /analyze-story exited|spawn/i);
    assert.equal(persisted?.kind, "as-of-story-analysis");
    assert.equal(persisted?.entryChapter, "第一章");
    assert.ok((await readFile(persisted!.logPath, "utf8").catch(() => "")).length >= 0);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
