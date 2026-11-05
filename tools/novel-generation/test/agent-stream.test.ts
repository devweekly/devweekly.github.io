import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentMessage, type AgentStreamState } from "../src/generate.js";

function freshState(): AgentStreamState {
  return { text: "", messageCount: 0 };
}

test("collects assistant text across messages and records TTFT once", () => {
  const state = freshState();
  applyAgentMessage({ type: "system", subtype: "init" }, state);
  applyAgentMessage({ type: "assistant", message: { content: [{ type: "text", text: "可用" }] } }, state);
  const first = state.firstTextAt;
  applyAgentMessage({ type: "assistant", message: { content: [
    { type: "tool_use", name: "noop" },
    { type: "text", text: "连通" }
  ] } }, state);
  assert.equal(state.text, "可用\n连通");
  assert.equal(state.messageCount, 3);
  assert.equal(state.firstTextAt, first);
  assert.ok(typeof first === "number");
});

test("failed result messages surface the CLI error instead of an empty output", () => {
  const state = freshState();
  assert.throws(
    () => applyAgentMessage({ type: "result", subtype: "error_during_execution", errors: ["model not found"] }, state),
    /error_during_execution.*model not found/
  );
  applyAgentMessage({ type: "result", subtype: "success" }, state);
  assert.equal(state.text, "");
});

test("unknown or malformed messages do not break stream consumption", () => {
  const state = freshState();
  for (const value of [null, undefined, 42, { type: "assistant" }, { type: "assistant", message: {} }]) {
    applyAgentMessage(value, state);
  }
  assert.equal(state.text, "");
  assert.equal(state.messageCount, 5);
});
