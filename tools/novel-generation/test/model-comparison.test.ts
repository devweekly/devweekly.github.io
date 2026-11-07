import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelAttempts } from "../src/generate.js";
import { extractLocalResponseText, parseComparisonResult, summarizeLocalResponse } from "../src/model-comparison.js";

test("strict model selection disables automatic fallback models", () => {
  assert.deepEqual(resolveModelAttempts("novel-test-explicit-model", false), ["novel-test-explicit-model"]);
});

test("normal model selection retains the configured fallback chain", () => {
  const attempts = resolveModelAttempts("novel-test-explicit-model", true);
  assert.equal(attempts[0], "novel-test-explicit-model");
  assert.ok(attempts.length >= 1);
});

test("LM Studio string content is extracted", () => {
  assert.deepEqual(extractLocalResponseText({ choices: [{ message: { content: "hello" } }] }), { text: "hello", source: "choices[0].message.content" });
});

test("LM Studio array content blocks are extracted without losing text", () => {
  const result = extractLocalResponseText({ choices: [{ message: { content: [{ type: "text", text: "第一段" }, { type: "image", image_url: "ignored" }, { type: "text", text: "第二段" }] } }] });
  assert.equal(result.text, "第一段\n第二段");
});

test("LM Studio alternative output_text response is supported", () => {
  assert.equal(extractLocalResponseText({ output_text: "fallback" }).text, "fallback");
});

test("response diagnostics capture finish reason, usage and content shape", () => {
  const result = summarizeLocalResponse({ model: "writer", usage: { prompt_tokens: 12 }, choices: [{ finish_reason: "length", message: { content: [] } }] });
  assert.equal(result.finishReason, "length");
  assert.deepEqual(result.usage, { prompt_tokens: 12 });
  assert.equal(result.contentType, "array");
});

test("response diagnostics distinguish reasoning-only output from final content", () => {
  const result = summarizeLocalResponse({
    usage: { completion_tokens: 1718, completion_tokens_details: { reasoning_tokens: 1667 } },
    choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "internal reasoning" } }]
  });
  assert.equal(result.finishReason, "length");
  assert.equal(result.contentChars, 0);
  assert.equal(result.reasoningContentChars, 18);
  assert.equal(result.reasoningPreview, "internal reasoning");
});

test("evidence validation checks short, altered and exact quotes", () => {
  const raw = JSON.stringify({ characters: [{ name: "甲", evidence: ["原文连续引用", "改写后的引用", "短"] }], styleAnalysis: {} });
  const result = parseComparisonResult(raw, "原文连续引用");
  assert.equal(result.jsonValid, true);
  assert.equal(result.evidenceCount, 3);
  assert.equal(result.groundedEvidenceCount, 1);
  assert.equal(result.evidenceIssueCount, 2);
  const issues = result.evidenceIssues as Array<{ reason: string }>;
  assert.deepEqual(issues.map(item => item.reason), ["not_exact_source_text", "too_short"]);
});

test("invalid JSON includes a useful parse diagnostic", () => {
  const result = parseComparisonResult("{not json", "source");
  assert.equal(result.jsonValid, false);
  assert.ok(typeof result.parseError === "string");
  assert.equal(result.outputPreview, "{not json");
});
