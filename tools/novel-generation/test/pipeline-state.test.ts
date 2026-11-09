import test from "node:test";
import assert from "node:assert/strict";
import {
  canCancelStoryExecution,
  canResumeStoryExecution,
  isStoryExecutionBlocking,
  reusableKnowledgeBuildStepNames,
  shouldCancelStoryExecutionImmediately
} from "../src/pipeline-state.js";

test("story execution lifecycle exposes one consistent lock and action policy", () => {
  for (const status of ["queued", "running", "paused"] as const) {
    assert.equal(isStoryExecutionBlocking(status), true);
    assert.equal(canCancelStoryExecution(status), true);
  }
  for (const status of ["paused", "failed", "stalled"] as const) assert.equal(canResumeStoryExecution(status), true);
  for (const status of ["completed", "failed", "cancelled", "stalled"] as const) {
    assert.equal(isStoryExecutionBlocking(status), false);
    assert.equal(canCancelStoryExecution(status), false);
  }
});

test("orphaned and paused story executions can be cancelled without a worker", () => {
  assert.equal(shouldCancelStoryExecutionImmediately("running", false), true);
  assert.equal(shouldCancelStoryExecutionImmediately("queued", false), true);
  assert.equal(shouldCancelStoryExecutionImmediately("paused", true), true);
  assert.equal(shouldCancelStoryExecutionImmediately("running", true), false);
});

test("knowledge build retries preserve completed checkpoints but rerun failed and running steps", () => {
  const reusable = reusableKnowledgeBuildStepNames([
    { name: "story-analysis", status: "completed" as const },
    { name: "volume-arcs", status: "failed" as const },
    { name: "style-profile", status: "running" as const },
    { name: "character-profiles", status: "skipped" as const }
  ]);
  assert.deepEqual([...reusable].sort(), ["character-profiles", "story-analysis"]);
});
