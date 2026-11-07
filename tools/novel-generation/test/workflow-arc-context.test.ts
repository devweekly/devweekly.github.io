import assert from "node:assert/strict";
import test from "node:test";
import { emptyStoryState } from "../src/story-state.js";
import { buildCharacterArcRetrospective } from "../src/workflow.js";

test("character arc retrospective exposes evidenced turns as creative context, not fixed rules", () => {
  const state = emptyStoryState("arc-test");
  state.characters.push({
    name: "沈砚",
    status: "离开故乡",
    arcMilestones: [
      { id: "m1", chapter: "第 3 章", change: "从回避冲突转为主动承担", choice: "留下断后", pressure: "同伴受困", cost: "失去退路", evidence: "沈砚转身挡在门前" },
      { id: "m2", chapter: "第 8 章", change: "开始怀疑自己坚持的原则", choice: "隐瞒一段真相", pressure: "保护旧友", cost: "信任受损", evidence: "他最终没有说出那句话" }
    ]
  });
  state.characters.push({
    name: "顾遥",
    status: "仍在观察",
    arcMilestones: [
      { id: "m3", chapter: "第 5 章", change: "第一次主动求助", evidence: "她把信递了过去" }
    ]
  });

  const focused = buildCharacterArcRetrospective(state, "沈砚这次会怎么选择");
  assert.ok(focused.includes("沈砚"));
  assert.ok(focused.includes("第 3 章"));
  assert.ok(focused.includes("失去退路"));
  assert.ok(focused.includes("第 8 章"));
  assert.ok(!focused.includes("顾遥"));

  const general = buildCharacterArcRetrospective(state, "本章没有点名任何人物");
  assert.ok(general.includes("沈砚"));
  assert.ok(general.includes("顾遥"));
  assert.match(general, /不是性格模板或后续剧情合同/);
  assert.match(general, /不要为了保持一致而禁止改变/);
});

test("character arc retrospective is empty when no evidenced milestones exist", () => {
  assert.equal(buildCharacterArcRetrospective(emptyStoryState("empty"), "继续写"), "");
});
