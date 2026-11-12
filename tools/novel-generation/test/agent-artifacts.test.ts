import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { collectAgentCallArtifacts } from "../src/generate.js";

test("collects stable artifact refs with hashes and partial-response completeness", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "novel-agent-artifacts-"));
  try {
    await mkdir(resolve(dir, "attempt-01"), { recursive: true });
    await writeFile(resolve(dir, "prompt.txt"), "exact prompt", "utf8");
    await writeFile(resolve(dir, "attempt-01", "partial-response.txt"), "incomplete output", "utf8");
    await writeFile(resolve(dir, "attempt-01", "events.jsonl"), '{"type":"assistant"}\n', "utf8");
    await mkdir(resolve(dir, "attempt-02"), { recursive: true });
    await writeFile(resolve(dir, "attempt-02", "attempt.json"), '{"status":"succeeded"}\n', "utf8");
    await writeFile(resolve(dir, "attempt-02", "partial-response.txt"), "complete streamed output", "utf8");
    await writeFile(resolve(dir, "attempt-02", "raw-response.txt"), "complete streamed output", "utf8");
    await writeFile(resolve(dir, "run.json"), '{"status":"running"}\n', "utf8");
    await writeFile(resolve(dir, ".leftover.tmp"), "must not be referenced", "utf8");

    const refs = await collectAgentCallArtifacts(dir);
    const byId = new Map(refs.map((ref) => [ref.id, ref]));

    assert.deepEqual([...byId.keys()].sort(), [
      "attempt-01/events.jsonl",
      "attempt-01/partial-response.txt",
      "attempt-02/attempt.json",
      "attempt-02/partial-response.txt",
      "attempt-02/raw-response.txt",
      "prompt.txt",
    ]);
    const prompt = byId.get("prompt.txt");
    assert.equal(prompt?.sha256, createHash("sha256").update("exact prompt").digest("hex"));
    assert.equal(prompt?.sizeBytes, Buffer.byteLength("exact prompt"));
    assert.equal(prompt?.payloadComplete, true);
    assert.ok(prompt?.uri.startsWith("file:"));
    assert.equal(byId.get("attempt-01/events.jsonl")?.mediaType, "application/x-ndjson");
    assert.equal(byId.get("attempt-01/partial-response.txt")?.payloadComplete, false);
    assert.equal(byId.get("attempt-02/partial-response.txt")?.payloadComplete, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
