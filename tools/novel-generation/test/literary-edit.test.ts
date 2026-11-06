import test from "node:test";
import assert from "node:assert/strict";
import { antiAiDiagnosticPrompt, antiAiEditPrompt, antiAiVerificationPrompt, parseAntiAiVerification, readerExperiencePrompt, LIVING_VOICE_RULES } from "../src/literary-edit.js";
import { STAGE_KEYS } from "../src/task-profiles.js";

test("anti-ai diagnosis uses concrete reading evidence, not AI detection", () => {
  const prompt = antiAiDiagnosticPrompt({
    brief: "写两个人久别重逢",
    blueprint: "两人相见但没有立刻相认",
    chapter: "他没有说话。"
  });
  assert.match(prompt, /不判断文本是否由 AI 生成/);
  assert.match(prompt, /每项必须引用短片段/);
  assert.match(prompt, /未发现值得修改的地方/);
  assert.match(prompt, /文学性、文笔、艺术风格高于一切/);
});

test("anti-ai editor protects literary intent and permits zero-change output", () => {
  const prompt = antiAiEditPrompt({
    brief: "写两个人久别重逢",
    blueprint: "两人相见但没有立刻相认",
    styleProfile: "克制、留白",
    chapter: "# 重逢\n\n他没有说话。"
  });
  assert.match(prompt, /文学性、文笔、艺术风格高于其他一切/);
  assert.match(prompt, /原样输出/);
  assert.match(prompt, /不得改变剧情事实/);
  assert.match(prompt, /不得制造错字/);
  const withDiagnosis = antiAiEditPrompt({
    brief: "写两个人久别重逢", blueprint: "两人相见", diagnosis: "某处可能解释过度",
    chapter: "他没有说话。"
  });
  assert.match(withDiagnosis, /诊断线索（可忽略，不是修改清单）/);
  assert.match(LIVING_VOICE_RULES, /人物在场景里有眼下要办的事/);
});

test("anti-ai post-edit verification restores edits without clear literary benefit", () => {
  const prompt = antiAiVerificationPrompt({ original: "他没有回答。", edited: "他沉默不语。" });
  assert.match(prompt, /原文更好或两版相当时选择 restore/);
  assert.deepEqual(parseAntiAiVerification('{"decision":"restore","reason":"原句更有力量"}'), {
    decision: "restore", reason: "原句更有力量"
  });
  assert.throws(() => parseAntiAiVerification('{"decision":"maybe","reason":"x"}'));
});

test("reader experience is observational and cannot become a repair gate", () => {
  const prompt = readerExperiencePrompt({ brief: "推进调查", chapter: "她把信折好。" });
  assert.match(prompt, /普通文学读者/);
  assert.match(prompt, /不要给 blocker\/major/);
  assert.match(prompt, /不改变章节通过状态/);
  assert.match(prompt, /是否愿意继续读/);
  assert.doesNotMatch(prompt, /推进调查/);
  assert.match(prompt, /先盲读正文/);
});

test("literary stages are part of the existing task profile registry", () => {
  assert.ok(STAGE_KEYS.includes("antiAi"));
  assert.ok(STAGE_KEYS.includes("reader"));
});
