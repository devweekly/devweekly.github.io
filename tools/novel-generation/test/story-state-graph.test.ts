import test from "node:test";
import assert from "node:assert/strict";
import { emptyStoryState } from "../src/story-state.js";
import { buildStoryStateGraph } from "../src/story-state-graph.js";

test("dynamic story graph links characters, events, plot threads, clues, MacGuffins and relationships", () => {
  const state = emptyStoryState("test-world");
  state.characters = [
    { name: "李玄", status: "行动中" },
    { name: "守门人", status: "观望" }
  ];
  state.plotThreads = [{ id: "thread-1", title: "旧城失踪案", status: "active", lastUpdated: "第2章", notes: "追查中" }];
  state.events = [
    { id: "event-1", summary: "发现铜匣", position: "第1章", participants: ["李玄"], consequences: ["铜匣成为争夺目标"], relatedPlotThreads: ["thread-1"], origin: "original" },
    { id: "event-2", summary: "铜匣易手", position: "第2章", participants: ["李玄", "守门人"], causes: ["event-1"], consequences: ["双方暂时合作"], relatedPlotThreads: ["thread-1"], origin: "original" }
  ];
  state.foreshadowingUpdates = [
    { id: "clue:1", clueId: "clue", clue: "三道刻痕", status: "planted", chapter: "第1章", change: "首次出现", relatedThreadIds: ["thread-1"], evidence: "墙上有三道刻痕" },
    { id: "clue:2", clueId: "clue", clue: "三道刻痕", status: "reinforced", chapter: "第2章", change: "与失踪案关联", relatedThreadIds: ["thread-1"], evidence: "刻痕与失踪者的记号一致" }
  ];
  state.macguffinUpdates = [
    { id: "box:1", macguffinId: "box", name: "铜匣", status: "transferred", chapter: "第2章", change: "守门人交给李玄", holder: "李玄", location: "北门", relatedThreadIds: ["thread-1"], evidence: "守门人把铜匣交给李玄" }
  ];
  state.relationshipUpdates = [
    { id: "relation:1", relationId: "relation", from: "李玄", to: "守门人", label: "暂时合作", chapter: "第2章", change: "互相信任", evidence: "李玄把后背交给了守门人" }
  ];

  const graph = buildStoryStateGraph(state);
  assert.ok(graph.nodes.some(node => node.id === "foreshadowing:clue" && node.data.status === "reinforced"));
  assert.ok(graph.nodes.some(node => node.id === "macguffin:box" && node.data.holder === "李玄"));
  assert.ok(graph.edges.some(edge => edge.type === "relationship" && edge.label === "暂时合作"));
  assert.ok(graph.edges.some(edge => edge.type === "causes" && edge.from === "event:event-1" && edge.to === "event:event-2"));
  assert.ok(graph.edges.some(edge => edge.type === "foreshadowing-thread"));
  assert.ok(graph.edges.some(edge => edge.type === "macguffin-thread"));
});

test("graph uses exact participant names and never fuzzy-merges character aliases", () => {
  const state = emptyStoryState("test-world");
  state.characters = [{ name: "查小刀", status: "在场" }];
  state.events = [{ id: "event-1", summary: "小刀现身", position: "第1章", participants: ["小刀"], consequences: [] }];
  const graph = buildStoryStateGraph(state);
  assert.ok(graph.nodes.some(node => node.id === "character:查小刀"));
  assert.ok(graph.nodes.some(node => node.id === "character:小刀"));
  assert.equal(graph.nodes.filter(node => node.type === "character").length, 2);
});
