import test from "node:test";
import assert from "node:assert/strict";
import { isEvidenceReviewed } from "../src/analysis.js";
import type { ChunkAnnotation } from "../src/analysis.js";

const base: ChunkAnnotation = {
  chunkId: "source:0:0", source: "source.txt", chapter: "第一章",
  extractedAt: "2026-11-05T00:00:00.000Z",
  entities: [], events: [], relations: [], coreferences: []
};

test("legacy annotations without a semantic review are not considered complete", () => {
  assert.equal(isEvidenceReviewed(base), false);
});

test("an empty but explicit evidence review is a valid reviewed result", () => {
  assert.equal(isEvidenceReviewed({ ...base, evidenceReviews: [] }), true);
});
