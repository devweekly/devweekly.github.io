import test from "node:test";
import assert from "node:assert/strict";
import { emptyStoryState } from "../src/story-state.js";
import { buildWorldSituationContext } from "../src/world-situation.js";

test("world situation injects only the latest relevant clue and MacGuffin lifecycle state", () => {
  const state = emptyStoryState("test-world");
  state.foreshadowingUpdates = [
    { id: "clue-1:1", clueId: "clue-1", clue: "墙上的三道刻痕", status: "planted", chapter: "第1章", change: "首次出现", relatedThreadIds: [], evidence: "墙上有三道新刻痕" },
    { id: "clue-1:2", clueId: "clue-1", clue: "墙上的三道刻痕", status: "reinforced", chapter: "第2章", change: "与失踪案相关", relatedThreadIds: [], evidence: "三道刻痕与失踪者记号一致" }
  ];
  state.macguffinUpdates = [
    { id: "box:1", macguffinId: "box", name: "铜匣", status: "introduced", chapter: "第1章", change: "首次出现", holder: "守门人", location: "旧城门房", relatedThreadIds: [], evidence: "守门人把铜匣放在桌上" },
    { id: "box:2", macguffinId: "box", name: "铜匣", status: "transferred", chapter: "第2章", change: "交给李玄", holder: "李玄", location: "北门", relatedThreadIds: [], evidence: "他将铜匣交到李玄手中" }
  ];
  state.relationshipUpdates = [
    { id: "relation:1", relationId: "relation", from: "李玄", to: "守门人", label: "敌对", chapter: "第1章", change: "互相提防", evidence: "李玄没有接过守门人递来的茶" },
    { id: "relation:2", relationId: "relation", from: "李玄", to: "守门人", label: "暂时合作", chapter: "第2章", change: "开始互相信任", evidence: "李玄把后背交给了守门人" }
  ];
  const context = buildWorldSituationContext(state, "三道刻痕 铜匣 李玄 守门人");
  assert.match(context, /reinforced/);
  assert.match(context, /第2章/);
  assert.match(context, /李玄/);
  assert.match(context, /暂时合作/);
  assert.doesNotMatch(context, /互相提防/);
  assert.doesNotMatch(context, /首次出现/);
});

test("resolved or unrelated clue updates are not pushed into unrelated chapter context", () => {
  const state = emptyStoryState("test-world");
  state.foreshadowingUpdates = [
    { id: "clue-1:1", clueId: "clue-1", clue: "海底石门", status: "resolved", chapter: "第1章", change: "谜底揭开", relatedThreadIds: [], evidence: "石门后面是旧祭坛" }
  ];
  const context = buildWorldSituationContext(state, "北门铜匣");
  assert.doesNotMatch(context, /海底石门/);
});

test("recent event context is bounded, chronological, and permits meaningful callbacks", async () => {
  const { buildRecentEventContinuityContext } = await import("../src/world-situation.js");
  const state = emptyStoryState("test-world");
  state.events = Array.from({ length: 10 }, (_, index) => ({
    id: "event-" + (index + 1),
    summary: "已发生事件" + (index + 1),
    position: "第" + (index + 1) + "章",
    participants: ["李玄"],
    consequences: ["后果" + (index + 1)],
    causes: [],
    relatedPlotThreads: [],
    origin: "original" as const
  }));

  const context = buildRecentEventContinuityContext(state);
  assert.match(context, /已发生事件3/);
  assert.match(context, /已发生事件10/);
  assert.doesNotMatch(context, /已发生事件2/);
  assert.ok(context.indexOf("已发生事件3") < context.indexOf("已发生事件10"));
  assert.match(context, /新的信息、意义、代价/);
  assert.match(context, /不要求每章必须引入新事件/);
  assert.ok(context.length <= 1_800);
});

test("recent event context is empty when there is no recorded history or the limit is zero", async () => {
  const { buildRecentEventContinuityContext } = await import("../src/world-situation.js");
  const state = emptyStoryState("test-world");
  assert.equal(buildRecentEventContinuityContext(state), "");
  state.events.push({
    id: "event-1", summary: "一件事", position: "第一章",
    participants: [], consequences: [], origin: "original"
  });
  assert.equal(buildRecentEventContinuityContext(state, 0), "");
});
