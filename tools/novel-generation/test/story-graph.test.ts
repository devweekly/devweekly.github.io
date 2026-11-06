import test from "node:test";
import assert from "node:assert/strict";
import { buildStoryGraph } from "../src/story-analysis.js";
import { buildStoryAnalysisContext } from "../src/story-analysis-context.js";
import type { StoryAnalysisSnapshot } from "../src/database.js";

const ref = [{ chapterId: "V01-C001", chapter: "第一章", volume: 1 }];

test("story graph connects core, characters, threads, foreshadowings, MacGuffins and events", () => {
  const graph = buildStoryGraph({
    storyCore: { centralConflicts: ["争夺秘钥"], mainPlotThreadTitles: ["夺回秘钥"], sourceRefs: ref },
    characters: [{ name: "甲", sourceRefs: ref }, { name: "乙", sourceRefs: ref }],
    relations: [{ from: "甲", to: "乙", label: "互相利用", sourceRefs: ref }],
    plotThreads: [{ title: "夺回秘钥", narrativeRole: "main", relatedCharacters: ["甲"], sourceRefs: ref }],
    foreshadowings: [{ clue: "黑色印记", relatedThreadTitles: ["夺回秘钥"], sourceRefs: ref }],
    macguffins: [{ name: "秘钥", whoWantsIt: ["乙"], relatedThreadTitles: ["夺回秘钥"], sourceRefs: ref }],
    beats: [{ beatId: "beat-1", summary: "甲乙争夺秘钥", actors: ["甲", "乙"], sourceRefs: ref }],
    developmentPossibilities: [{ focus: "甲", direction: "背叛盟友", sourceRefs: ref }]
  });
  const nodeTypes = new Set(graph.nodes.map(node => node.type));
  const edgeTypes = new Set(graph.edges.map(edge => edge.type));
  for (const type of ["story_core", "character", "plot_thread", "foreshadowing", "macguffin", "beat", "development"]) {
    assert.ok(nodeTypes.has(type), "missing graph node " + type);
  }
  for (const type of ["relationship", "main_plot", "involved_in", "foreshadows", "pursues", "drives", "participates_in", "possible_arc"]) {
    assert.ok(edgeTypes.has(type), "missing graph edge " + type);
  }
  assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to)));
  assert.ok(graph.nodes.every(node => node.sourceRefs.length > 0));
});

test("writing context expands relevant story graph and keeps literary freedom explicit", () => {
  const graph = buildStoryGraph({
    storyCore: { centralConflicts: ["秘钥争夺"], mainPlotThreadTitles: ["夺回秘钥"], sourceRefs: ref },
    characters: [{ name: "甲", shortBio: "守护秘钥", sourceRefs: ref }],
    relations: [],
    plotThreads: [{ title: "夺回秘钥", summary: "各方争夺秘钥", narrativeRole: "main", relatedCharacters: ["甲"], sourceRefs: ref }],
    foreshadowings: [],
    macguffins: [{ name: "秘钥", significance: "驱动各方行动", whoWantsIt: ["甲"], relatedThreadTitles: ["夺回秘钥"], sourceRefs: ref }],
    beats: [],
    developmentPossibilities: []
  });
  const snapshot = {
    worldId: "test", sourceHash: "hash", analyzedAt: new Date().toISOString(), analysisVersion: 5,
    complete: true, batches: 1, characters: [{ name: "甲", shortBio: "守护秘钥", sourceRefs: ref }],
    plotThreads: [{ title: "夺回秘钥", summary: "各方争夺秘钥", sourceRefs: ref }],
    foreshadowings: [], developmentPossibilities: [], relations: [],
    storyCore: { centralConflicts: ["秘钥争夺"], mainPlotThreadTitles: ["夺回秘钥"] },
    macguffins: [{ name: "秘钥", significance: "驱动各方行动", whoWantsIt: ["甲"], relatedThreadTitles: ["夺回秘钥"], sourceRefs: ref }],
    storyGraph: graph
  } as StoryAnalysisSnapshot;
  const context = buildStoryAnalysisContext(snapshot, "甲 守护秘钥");
  assert.match(context, /故事核心观察/);
  assert.match(context, /MacGuffin/);
  assert.match(context, /故事关系图/);
  assert.match(context, /文学表达/);
});
