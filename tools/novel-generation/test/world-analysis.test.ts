import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_ROLES, validateAnalysisOutput } from "../src/world-analysis.js";

test("analysis roles have unique ids and complete contracts", () => {
  const ids = ANALYSIS_ROLES.map(role => role.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 5);
  for (const role of ANALYSIS_ROLES) {
    assert.ok(role.query.length > 0);
    assert.ok(role.questions.length >= 4);
    assert.equal(role.lineRanges.length, role.rangeNotes.length);
    assert.ok(role.focusVolumes.length > 0);
  }
});

test("rejects missing, short and placeholder outputs", () => {
  assert.equal(validateAnalysisOutput("", 118089).ok, false);
  assert.equal(validateAnalysisOutput("## 短\n内容太少 L100 L200 L300 L400 L500 L600", 118089).ok, false);
  const withPlaceholder = "## 结论\n" + "正文".repeat(320) + "\nL100 L200 L300 L400 L500 L600 TODO";
  assert.ok(validateAnalysisOutput(withPlaceholder, 118089).issues.some(issue => issue.includes("占位")));
});

test("accepts a complete analysis with evidence references", () => {
  const text = [
    "# 主线分析",
    "## 判断",
    "正文".repeat(320),
    "依据 L7209、L7317、L7848、L12187、L28122、L45301、L47258、L114297。",
    "## 待核实",
    "全书总章数与末卷之后的情节。",
    "## 引用范围",
    "以上行号均来自本地全文。"
  ].join("\n");
  const result = validateAnalysisOutput(text, 118089);
  assert.equal(result.ok, true);
  assert.equal(result.evidenceCount, 8);
  assert.ok(result.chars >= 600);
});

test("rejects line numbers outside the corpus", () => {
  const text = "## 判断\n" + "正文".repeat(320) + "\nL7209 L7317 L7848 L12187 L28122 L999999";
  const result = validateAnalysisOutput(text, 118089);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes("越界")));
});
