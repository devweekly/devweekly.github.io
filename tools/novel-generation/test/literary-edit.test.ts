import test from "node:test";
import assert from "node:assert/strict";
import { antiAiDiagnosticPrompt, antiAiEditPrompt, antiAiVerificationPrompt, parseAntiAiVerification, readerExperiencePrompt, LIVING_VOICE_RULES, postReviewLiteraryCheckPrompt, shouldRunAntiAiEdit } from "../src/literary-edit.js";
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
  assert.match(prompt, /文学性、文笔、艺术风格高于其他一切/);
  assert.match(prompt, /动作逐帧拆解/);
  assert.match(prompt, /全章层面的节奏检查/);
  assert.match(prompt, /机械复沓/);
  assert.match(prompt, /人物对白过度完整/);
  assert.match(prompt, /没有真实对照对象的“不是……而是……”/);
  assert.match(prompt, /强行凑三项排比/);
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
  assert.match(prompt, /合并重复动作/);
  assert.match(prompt, /短句数量、断行数量/);
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
  assert.match(prompt, /修复了可定位的重复/);
  assert.deepEqual(parseAntiAiVerification('{"decision":"restore","reason":"原句更有力量"}'), {
    decision: "restore", reason: "原句更有力量"
  });
  assert.deepEqual(parseAntiAiVerification('```json\n{"decision":"keep","reason":"没有损害原文"}\n```'), {
    decision: "keep", reason: "没有损害原文"
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

test("Anti-AI edit is skipped when diagnosis is absent or explicitly clean", () => {
  assert.equal(shouldRunAntiAiEdit(""), false);
  assert.equal(shouldRunAntiAiEdit("   "), false);
  assert.equal(shouldRunAntiAiEdit("结论：未发现值得修改的地方。"), false);
  assert.equal(shouldRunAntiAiEdit("没有明确需要修改的问题。"), false);
  assert.equal(shouldRunAntiAiEdit("说明：上一段未发现值得修改的地方，但第 5 段仍有重复。"), true);
  assert.equal(shouldRunAntiAiEdit("结论：有值得修改的问题。\n- 另一个段落未发现值得修改的地方。"), true);
});

test("Anti-AI edit runs only when diagnosis contains actionable findings", () => {
  assert.equal(shouldRunAntiAiEdit("发现两处解释过度，分别见第 3、8 段。"), true);
  assert.equal(shouldRunAntiAiEdit("问题：人物动作重复，第二句没有新增信息。"), true);
});

test("post-review literary check is observational and cannot trigger rewriting", () => {
  const prompt = postReviewLiteraryCheckPrompt({
    beforeReview: "他走进屋里。",
    finalChapter: "他走进屋里。门已经关了。",
    reviewHistory: "修复时间线"
  });
  assert.match(prompt, /这是只读诊断/);
  assert.match(prompt, /不得输出重写正文/);
  assert.match(prompt, /不得改变章节通过状态/);
});
