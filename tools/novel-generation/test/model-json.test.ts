import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonText, parseJsonObject } from "../src/model-json.js";

test("extracts the first complete object even when trailing prose contains braces", () => {
  const raw = '先看结论：{"status":"pass","issues":[]}\n补充说明：这里有个 } 不是 JSON。';
  assert.deepEqual(parseJsonObject(raw), { status: "pass", issues: [] });
});

test("handles fenced output and braces inside strings", () => {
  const raw = '```json\n{"title":"场景 } 一","note":"{不是对象}"}\n```';
  assert.deepEqual(parseJsonObject(raw), { title: "场景 } 一", note: "{不是对象}" });
});

// 裸换行、尾逗号与裸键都由 jsonrepair 修复；这里保证三条坏损路径最终都解析出正确对象。
test("repairs raw control characters, trailing commas and bare keys", () => {
  assert.deepEqual(
    parseJsonObject('{"characters":[{"name":"李阎","shortBio":"第一行\n第二行",}],}'),
    { characters: [{ name: "李阎", shortBio: "第一行\n第二行" }] }
  );
  assert.deepEqual(
    parseJsonObject("{decisions:[{index:0,supported:true,reason:\"行文一致\"}]}"),
    { decisions: [{ index: 0, supported: true, reason: "行文一致" }] }
  );
});

test("ignores a second JSON object instead of slicing across both", () => {
  const raw = '{"a":1}\n{"b":2}';
  assert.equal(extractJsonText(raw), '{"a":1}');
});

test("rejects output without a complete object", () => {
  assert.throws(() => parseJsonObject("没有 JSON"), /no JSON object/);
  assert.throws(() => parseJsonObject('{"unclosed": true'), /no complete JSON object/);
});
