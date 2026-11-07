import assert from "node:assert/strict";
import test from "node:test";
import { retrievalMetrics } from "../scripts/evaluate-retrieval.js";

test("retrieval metrics calculate Recall@5, MRR@10 and nDCG@10", () => {
  const result = retrievalMetrics(["noise-1", "relevant-a", "relevant-b"], ["relevant-a", "relevant-b"]);
  assert.equal(result.recallAt5, 1);
  assert.equal(result.mrrAt10, 0.5);
  assert.ok(result.ndcgAt10 > 0.69 && result.ndcgAt10 < 0.70);
});

test("retrieval metrics return zero for misses and reject empty relevance labels", () => {
  const result = retrievalMetrics(["noise-1", "noise-2"], ["relevant-a"]);
  assert.deepEqual(result, { recallAt5: 0, mrrAt10: 0, ndcgAt10: 0 });
  assert.throws(() => retrievalMetrics([], []), /at least one relevant/);
});

test("duplicate document IDs do not inflate retrieval ranking metrics", () => {
  const result = retrievalMetrics(["relevant-a", "relevant-a", "relevant-b"], ["relevant-a", "relevant-b"]);
  assert.equal(result.recallAt5, 1);
  assert.equal(result.mrrAt10, 1);
  assert.equal(result.ndcgAt10, 1);
});
