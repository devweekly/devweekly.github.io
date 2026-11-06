import test from "node:test";
import assert from "node:assert/strict";
import { emptyStoryState, parseStoryStateUpdate, validateStoryState } from "../src/story-state.js";
import { dedupeContinuityNotes, mergeStoryState } from "../src/workflow.js";

test("character profile is stable metadata while current character fields are replaceable snapshots", () => {
  const current = emptyStoryState("test-world");
  current.characters.push({
    name: "李玄",
    profile: { coreTraits: ["谨慎"], values: ["守信"], contradictions: ["渴望自由"] },
    status: "受伤",
    location: "旧城",
    knowledge: ["守门人身份"],
    goals: ["找到入口"],
    relationships: ["与守门人敌对"]
  });
  const next = mergeStoryState(current, {
    characters: [{
      name: "李玄",
      profile: { contradictions: ["害怕失去同伴"], arc: "开始愿意承担责任" },
      status: "恢复",
      location: "北门",
      knowledge: ["密道位置"],
      goals: ["保护同伴"],
      relationships: ["与守门人暂时合作"]
    }]
  });
  assert.equal(next.characters.length, 1);
  assert.deepEqual(next.characters[0]?.profile, {
    coreTraits: ["谨慎"], values: ["守信"], contradictions: ["害怕失去同伴"], arc: "开始愿意承担责任"
  });
  assert.equal(next.characters[0]?.status, "恢复");
  assert.equal(next.characters[0]?.location, "北门");
  assert.deepEqual(next.characters[0]?.knowledge, ["密道位置"]);
  assert.deepEqual(next.characters[0]?.goals, ["保护同伴"]);
  assert.deepEqual(next.characters[0]?.relationships, ["与守门人暂时合作"]);
});

test("story facts, events and threads merge by stable id without duplicate accumulation", () => {
  const current = emptyStoryState("test-world");
  current.canonFacts.push({ id: "f1", fact: "旧事实", confidence: "confirmed" });
  current.events.push({ id: "e1", summary: "旧事件", position: "第1章", participants: ["A"], consequences: [] });
  current.plotThreads.push({ id: "p1", title: "调查", status: "open", lastUpdated: "第1章", notes: "开始" });
  const next = mergeStoryState(current, {
    canonFacts: [{ id: "f1", fact: "修正事实", confidence: "confirmed" }],
    events: [{ id: "e1", summary: "更新事件", position: "第2章", participants: ["A", "B"], consequences: ["关系改变"] }],
    plotThreads: [{ id: "p1", title: "调查", status: "resolved", lastUpdated: "第2章", notes: "结束" }]
  });
  assert.equal(next.canonFacts.length, 1);
  assert.equal(next.canonFacts[0]?.fact, "修正事实");
  assert.equal(next.events.length, 1);
  assert.deepEqual(next.events[0]?.participants, ["A", "B"]);
  assert.equal(next.plotThreads.length, 1);
  assert.equal(next.plotThreads[0]?.status, "resolved");
});


test("model state updates are runtime-validated before they can be merged", () => {
  assert.deepEqual(parseStoryStateUpdate({
    currentPosition: "第2章结尾",
    characters: [{ name: "李玄", status: "离开旧城", location: "北门" }],
    continuityNotes: []
  }), {
    currentPosition: "第2章结尾",
    characters: [{ name: "李玄", status: "离开旧城", location: "北门" }],
    continuityNotes: []
  });
  assert.throws(() => parseStoryStateUpdate({
    characters: [{ name: "李玄", status: "离开旧城" }],
    unexpectedField: "must not be persisted"
  }));
  assert.throws(() => parseStoryStateUpdate({
    canonFacts: [{ id: "f1", fact: "事实", confidence: "guess" }]
  }));
});

test("full story state validation rejects cross-world or malformed snapshots", () => {
  const state = emptyStoryState("world-a");
  assert.equal(validateStoryState(state).worldId, "world-a");
  assert.throws(() => validateStoryState({ ...state, characters: [{ name: "", status: "" }] }));
});


test("character arc milestones are append-only, deduplicated by id and evidence-backed", () => {
  const current = emptyStoryState("test-world");
  current.characters.push({
    name: "李玄",
    status: "仍在观察",
    arcMilestones: [{
      id: "arc-1", chapter: "第1章", change: "开始信任同伴",
      choice: "把退路交给同伴", pressure: "追兵逼近", cost: "失去独自脱身机会",
      evidence: "把退路交给同伴"
    }]
  });
  const next = mergeStoryState(current, {
    characters: [{
      name: "李玄",
      status: "决定留下",
      arcMilestones: [{
        id: "arc-2", chapter: "第2章", change: "愿意承担责任",
        choice: "留下断后", pressure: "同伴被困", cost: "暴露行踪",
        evidence: "他转身挡在门前"
      }]
    }]
  });
  assert.deepEqual(next.characters[0]?.arcMilestones?.map(item => item.id), ["arc-1", "arc-2"]);
  assert.throws(() => parseStoryStateUpdate({
    characters: [{
      name: "李玄", status: "留下",
      arcMilestones: [{
        id: "arc-3", chapter: "第3章", change: "变化",
        choice: "选择", pressure: "压力", cost: "代价",
        evidence: "正文中不存在的证据"
      }]
    }]
  }, "这一章没有这句话"));
});


test("continuity notes are replaced by the complete active snapshot", () => {
  const current = emptyStoryState("test-world");
  current.continuityNotes = ["李玄仍然不知道密道位置", "铜钱由守门人持有"];
  const next = mergeStoryState(current, {
    continuityNotes: ["李玄已经知道密道位置"]
  });
  assert.deepEqual(next.continuityNotes, ["李玄已经知道密道位置"]);
});


test("facts introduced by generated prose remain project-original even when model marks them confirmed", () => {
  const current = emptyStoryState("test-world");
  current.canonFacts.push({ id: "canon-1", fact: "原著旧事实", confidence: "confirmed" });
  const next = mergeStoryState(current, {
    canonFacts: [
      { id: "canon-1", fact: "原著旧事实的补充表述", confidence: "confirmed" },
      { id: "new-1", fact: "本章新发生的交易", confidence: "confirmed" }
    ],
    events: [{ id: "event-new", summary: "本章新事件", position: "第2章", participants: [], consequences: [] }]
  });
  assert.equal(next.canonFacts.find(item => item.id === "canon-1")?.confidence, "confirmed");
  assert.equal(next.canonFacts.find(item => item.id === "new-1")?.confidence, "original");
  assert.equal(next.events.find(item => item.id === "event-new")?.origin, "original");
});


test("continuity notes deduplicate only formatting and punctuation variants", () => {
  assert.deepEqual(dedupeContinuityNotes([
    "李玄仍不知道密道位置",
    "李玄仍然不知道密道位置",
    "「李玄仍不知道密道位置。」",
    "铜钱由守门人持有"
  ]), [
    "李玄仍不知道密道位置",
    "李玄仍然不知道密道位置",
    "铜钱由守门人持有"
  ]);
});
