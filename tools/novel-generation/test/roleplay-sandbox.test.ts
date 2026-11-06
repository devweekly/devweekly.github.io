import test from "node:test";
import assert from "node:assert/strict";
import { buildRoleplayPrompt } from "../src/roleplay-sandbox.js";

test("roleplay sandbox treats character simulation as non-canon creative material", () => {
  const prompt = buildRoleplayPrompt({
    brief: "两名旧友在雨夜重逢",
    worldBible: "城中有宵禁",
    characters: [{ name: "沈砚", knowledge: ["城中有宵禁"], goals: ["找到旧友"] }],
    storyAnalysisContext: "沈砚与旧友曾共同隐瞒一件事；两种后续关系走向均未确定。",
    transcript: "沈砚没有回答。",
    authorDirection: "让另一人先开口"
  });
  assert.match(prompt, /人物互动推演搭档/);
  assert.match(prompt, /每个人只能依据自己实际知道的信息/);
  assert.match(prompt, /这是非正史推演/);
  assert.match(prompt, /不要修改或输出 Story State/);
  assert.match(prompt, /文学性、文笔、艺术风格高于一切/);
  assert.match(prompt, /相关人物互动、情节线、伏笔与故事关系图/);
  assert.match(prompt, /两种后续关系走向均未确定/);
});
