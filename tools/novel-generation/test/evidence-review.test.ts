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

test("项目原创约束、引子和清单段落不要求原文行号", () => {
  const text = `## 判断

结论依据 L1 与 L2（原著明确）。

以下约束均为项目原创，不指向特定句式或比喻：

- 视角起笔时主角姓名延后。
- 动作段按动作转折拆段。

## 续写硬约束清单

以下为项目原创的整理层约束。`;
  const result = validateEvidenceReferences(text, ["第一行原文", "第二行原文"]);
  assert.equal(result.ok, true);
  assert.equal(result.claims.length, 1);
  assert.deepEqual(result.claims[0]?.lines, [1, 2]);
});

test("rejects substantive report paragraphs without citations", () => {
  const result = validateEvidenceReferences(
    "## 判断\n\n这是一段较长的分析结论，但是没有任何原文行号作为证据。",
    ["原文"]
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes("缺少原文行号引用")));
});
