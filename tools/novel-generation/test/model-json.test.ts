import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonText, parseJsonObject, repairJsonText } from "../src/model-json.js";

test("extracts the first complete object even when trailing prose contains braces", () => {
  const raw = '先看结论：{"status":"pass","issues":[]}\n补充说明：这里有个 } 不是 JSON。';
  assert.deepEqual(parseJsonObject(raw), { status: "pass", issues: [] });
});

test("handles fenced output and braces inside strings", () => {
  const raw = '```json\n{"title":"场景 } 一","note":"{不是对象}"}\n```';
  assert.deepEqual(parseJsonObject(raw), { title: "场景 } 一", note: "{不是对象}" });
});

test("repairs raw control characters and trailing commas", () => {
  const raw = '{"characters":[{"name":"李阎","shortBio":"第一行\n第二行",}],}';
  assert.equal(repairJsonText(extractJsonText(raw)).includes("\n"), false);
  assert.deepEqual(parseJsonObject(raw), {
    characters: [{ name: "李阎", shortBio: "第一行\n第二行" }]
  });
});

test("ignores a second JSON object instead of slicing across both", () => {
  const raw = '{"a":1}\n{"b":2}';
  assert.equal(extractJsonText(raw), '{"a":1}');
});

test("rejects output without a complete object", () => {
  assert.throws(() => parseJsonObject("没有 JSON"), /no JSON object/);
  assert.throws(() => parseJsonObject('{"unclosed": true'), /no complete JSON object/);
});
