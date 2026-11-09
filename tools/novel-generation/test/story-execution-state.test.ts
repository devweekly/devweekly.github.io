import test from "node:test";
import assert from "node:assert/strict";
import { selectVisibleStoryExecution, shouldPollStoryExecution } from "../web/src/story-execution-state.js";

test("a paused world execution remains visible even when the current history scope excludes it", () => {
  const legacy = { id: "legacy-execution", status: "paused" };
  const scoped = { id: "selected-story-execution", status: "completed" };
  assert.equal(selectVisibleStoryExecution([legacy, scoped], scoped), legacy);
});

test("a scoped history selection is used when there is no active world execution", () => {
  const scoped = { id: "selected-story-execution", status: "completed" };
  assert.equal(selectVisibleStoryExecution([scoped], scoped), scoped);
});

test("queued, running and paused executions are polled so external cancellation is observed", () => {
  for (const status of ["queued", "running", "paused"]) assert.equal(shouldPollStoryExecution(status), true);
  for (const status of ["completed", "failed", "cancelled", "stalled"]) assert.equal(shouldPollStoryExecution(status), false);
});
