import test from "node:test";
import assert from "node:assert/strict";
import { buildStyleDistillationPrompt } from "../src/style-distillation.js";
import { STAGE_KEYS } from "../src/task-profiles.js";

test("style distillation extracts abstract and scene-aware traits without imitation", () => {
  const prompt = buildStyleDistillationPrompt([
    { label: "sample-a.txt", text: "她站在门边，听雨落下来。" },
    { label: "sample-b.md", text: "他没有回答，只把灯吹灭。" }
  ]);
  assert.match(prompt, /抽象 Style Profile/);
  assert.match(prompt, /场景级风格差异/);
  assert.match(prompt, /禁止输出长段原文/);
  assert.match(prompt, /样本不足/);
  assert.match(prompt, /文学性、文笔、艺术风格高于一切/);
});

test("style distillation uses an explicit task profile", () => {
  assert.ok(STAGE_KEYS.includes("styleDistill"));
});
