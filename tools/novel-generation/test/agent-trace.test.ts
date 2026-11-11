import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { recoverInterruptedAgentCalls } from "../src/generate.js";

test("recovers interrupted model calls and their in-flight attempts", async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "novel-agent-trace-"));
  try {
    process.chdir(root);
    const callDir = resolve(".output", "agent-calls", "call-1");
    const attemptDir = join(callDir, "attempt-01");
    await mkdir(attemptDir, { recursive: true });
    await writeFile(join(callDir, "run.json"), JSON.stringify({ callId: "call-1", status: "running" }));
    await writeFile(join(attemptDir, "attempt.json"), JSON.stringify({ model: "test-model", status: "running" }));

    assert.equal(await recoverInterruptedAgentCalls(), 1);
    const run = JSON.parse(await readFile(join(callDir, "run.json"), "utf8")) as { status: string; error?: string };
    const attempt = JSON.parse(await readFile(join(attemptDir, "attempt.json"), "utf8")) as { status: string };
    assert.equal(run.status, "interrupted");
    assert.match(run.error ?? "", /进程/);
    assert.equal(attempt.status, "interrupted");
    assert.equal(await recoverInterruptedAgentCalls(), 0);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});
