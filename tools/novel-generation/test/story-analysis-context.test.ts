import test from "node:test";
import assert from "node:assert/strict";
import { buildStoryAnalysisContext } from "../src/story-analysis-context.js";

test("writing context selects only relevant analysis and labels it as optional", () => {
  const context = buildStoryAnalysisContext({
    worldId: "test", sourceHash: "a".repeat(64), analyzedAt: "2026-11-05T00:00:00.000Z",
    complete: true, batches: 1,
    characters: [
      { name: "林岚", aliases: ["阿岚"], shortBio: "擅长隐瞒心事", arcPossibilities: ["可能背叛旧友"] },
      { name: "顾青", shortBio: "行事谨慎" }
    ],
    plotThreads: [{ title: "旧城失踪案", summary: "失踪者与林岚有关" }],
    foreshadowings: [{ clue: "旧城墙上的血字", possiblePayoffs: ["指向失踪案"] }],
    developmentPossibilities: [{ focus: "林岚", direction: "背叛旧友", surpriseOptions: ["临时救下旧友"] }]
  }, "林岚回到旧城，调查失踪案");
  assert.match(context, /林岚/);
  assert.match(context, /旧城失踪案/);
  assert.match(context, /可选素材和创意火花/);
  assert.doesNotMatch(context, /顾青/);
});

test("writing context does not turn incomplete or irrelevant analysis into instructions", () => {
  assert.equal(buildStoryAnalysisContext(undefined, "林岚"), "");
  assert.equal(buildStoryAnalysisContext({
    worldId: "test", sourceHash: "a".repeat(64), analyzedAt: "2026-11-05T00:00:00.000Z",
    complete: false, batches: 1, characters: [{ name: "林岚" }],
    plotThreads: [], foreshadowings: [], developmentPossibilities: []
  }, "林岚"), "");
  assert.equal(buildStoryAnalysisContext({
    worldId: "test", sourceHash: "a".repeat(64), analyzedAt: "2026-11-05T00:00:00.000Z",
    complete: true, batches: 1, characters: [{ name: "林岚" }],
    plotThreads: [], foreshadowings: [], developmentPossibilities: []
  }, "完全无关的海边旅行"), "");
});
