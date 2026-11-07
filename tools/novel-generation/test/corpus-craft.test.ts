import test from "node:test";
import assert from "node:assert/strict";
import { retainGroundedItems } from "../src/corpus-craft.js";

test("corpus craft analysis keeps only non-empty exact source evidence", () => {
  const source = "李阎把刀放在桌上，转身离开。";
  const items = [
    { evidence: "把刀放在桌上", observation: "可核验" },
    { evidence: "他将刀放在桌上", observation: "改写引文" },
    { evidence: "", observation: "空证据" },
    { evidence: "短", observation: "过短证据" }
  ];
  assert.deepEqual(retainGroundedItems(items, source), [items[0]]);
});

test("corpus craft analysis tolerates malformed model fields", () => {
  assert.deepEqual(retainGroundedItems(null, "原文"), []);
  assert.deepEqual(retainGroundedItems("not-an-array", "原文"), []);
});
