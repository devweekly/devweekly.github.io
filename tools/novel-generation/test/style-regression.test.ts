import test from "node:test";
import assert from "node:assert/strict";
import { buildStyleRegressionPrompt } from "../src/style-regression.js";

test("style regression compares approved references with candidates without imitation or gating", () => {
  const prompt = buildStyleRegressionPrompt({
    styleProfile: "叙述克制，人物声音有差异",
    references: [{ label: "approved-1.md", text: "她把信折好。" }],
    candidates: [{ label: "chapter-new.md", text: "他站在门外，没有敲门。" }],
    sceneType: "quiet dialogue"
  });
  assert.match(prompt, /识别可能的风格漂移/);
  assert.match(prompt, /区分有意的场景变化/);
  assert.match(prompt, /不要复制参考文本/);
  assert.match(prompt, /不触发自动改写/);
  assert.match(prompt, /quiet dialogue/);
});
