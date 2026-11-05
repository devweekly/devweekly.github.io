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

test("同一段里的多句各按自己的引用核验，不再整段连坐", async () => {
  const { splitEvidenceClaims } = await import("../src/world-analysis.js");
  const text = [
    "## 判断",
    "",
    "卷 5 为结构转折，十主殿议通报果实脱落（L3，人物推断）。本 Agent 判断转折分两步。结算随即失灵，评价仍按上上给点数（L7）。"
  ].join("\n");
  const claims = splitEvidenceClaims(text);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0]?.lines, [3]);
  assert.deepEqual(claims[1]?.lines, [7]);
  assert.equal(claims[0]?.section, "判断");
});

test("句中没有引用行号时不算待审主张，避免把评价与过渡句判成缺证据", async () => {
  const { splitEvidenceClaims } = await import("../src/world-analysis.js");
  const text = "## 判断\n\n这是本 Agent 的归纳，没有行号。这里有引用（L2）。";
  const claims = splitEvidenceClaims(text);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0]?.lines, [2]);
});

test("待核实小节不进入语义核验", async () => {
  const { splitEvidenceClaims } = await import("../src/world-analysis.js");
  const text = "## 判断\n\n事实成立（L1）。\n\n## 待核实\n\n这里存疑（L2）。";
  const claims = splitEvidenceClaims(text);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0]?.lines, [1]);
});

test("个别引用行越界不会清空其余可核验句子", () => {
  const result = validateEvidenceReferences("## 判断\n\n事实成立（L1）。另一条越界（L9）。", ["第一行原文"]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes("L9 超出原文范围")));
  assert.equal(result.claims.length, 2);
});

test("证据窗口取锚点邻行，不越过原文首尾", async () => {
  const { evidenceWindow } = await import("../src/world-analysis.js");
  assert.deepEqual(evidenceWindow([5], 2, 10), [3, 4, 5, 6, 7]);
  assert.deepEqual(evidenceWindow([1], 2, 10), [1, 2, 3]);
  assert.deepEqual(evidenceWindow([10], 2, 10), [8, 9, 10]);
  assert.deepEqual(evidenceWindow([5], 0, 10), [5]);
});

test("模型把 JSON 键写成 JS 对象也不会整批失败", async () => {
  const { parseJsonObject } = await import("../src/model-json.js");
  const parsed = parseJsonObject('{decisions:[{index:0,supported:true,reason:"行文一致"}]}') as {
    decisions: Array<{ index: number; supported: boolean }>;
  };
  assert.equal(parsed.decisions[0]?.supported, true);
});
