import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidenceReferences } from "../src/world-analysis.js";

test("checks that cited lines exist and contain source text", () => {
  const source = ["第一行原文", "", "第三行原文"];
  const result = validateEvidenceReferences("## 判断\n\n结论依据 L1 和 L3。", source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.references, [1, 3]);
  assert.equal(result.claims.length, 1);
});

test("rejects citations to empty or out-of-range source lines", () => {
  const result = validateEvidenceReferences("## 判断\n\n结论依据 L2、L8。", ["第一行原文", ""]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes("L2 指向空行")));
  assert.ok(result.issues.some(issue => issue.includes("L8 超出原文范围")));
});

test("requires at least one cited claim paragraph", () => {
  const result = validateEvidenceReferences("## 判断\n\n没有原文引用的结论。", ["原文"]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes("没有找到")));
});
