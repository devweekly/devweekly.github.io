import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelAttempts } from "../src/generate.js";

test("strict model selection disables automatic fallback models", () => {
  assert.deepEqual(resolveModelAttempts("novel-test-explicit-model", false), ["novel-test-explicit-model"]);
});

test("normal model selection retains the configured fallback chain", () => {
  const attempts = resolveModelAttempts("novel-test-explicit-model", true);
  assert.equal(attempts[0], "novel-test-explicit-model");
  assert.ok(attempts.length >= 1);
});
