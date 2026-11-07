import assert from "node:assert/strict";
import test from "node:test";
import { buildCommonWritingContext } from "../src/workflow.js";
import type { StoryState } from "../src/story-state.js";

test("the exact common prompt receives bounded universe evidence and excludes future-canon markers", () => {
  const state = {
    worldId: "u-child",
    currentPosition: "第二章之后",
    characters: [],
    plotThreads: [],
    continuityNotes: []
  } as unknown as StoryState;
  const prompt = buildCommonWritingContext({
    worldBible: "历史分支启动底稿",
    contextText: "起点之前的背景",
    retrievedContext: "第二章：当前分支允许读取的证据",
    writingBrief: "只含本宇宙已发生事实",
    storyAnalysisContext: "时点分析：起点前人物关系",
    sourceText: "本宇宙起点章节正文",
    styleProfile: "克制、简洁、叙事有留白",
    mode: "continuation",
    brief: "从人物选择切入"
  }, state, "当前人物与局势");
  assert.match(prompt, /起点之前的背景/);
  assert.match(prompt, /当前分支允许读取的证据/);
  assert.match(prompt, /时点分析：起点前人物关系/);
  assert.match(prompt, /本宇宙起点章节正文/);
  assert.match(prompt, /文学表达/);
  assert.match(prompt, /严格承接用户提供的合法文本/);
  assert.doesNotMatch(prompt, /未来剧情泄漏标记/);
  assert.doesNotMatch(prompt, /父宇宙未来章节/);
});
