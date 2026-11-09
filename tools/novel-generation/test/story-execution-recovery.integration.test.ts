import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { getStoryExecution, saveStoryExecution } from "../src/story-execution.js";

test("an orphaned running execution can be cancelled after a process restart", async () => {
  const previousCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "story-execution-orphan-cancel-"));
  let server: ReturnType<typeof createServer> | undefined;
  const worldId = "recovery-world";
  const executionId = "5e4a83c8-51aa-4cc3-8db1-b93f27f4c5a2";
  try {
    process.chdir(root);
    const now = new Date().toISOString();
    await saveStoryExecution({
      id: executionId, worldId, storyUnitTitle: "恢复测试", mode: "complete_story", status: "running",
      createdAt: now, updatedAt: now, completedChapters: [], events: [], brief: "",
      idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    });
    server = createServer(createApp());
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${worldId}/story-executions/${executionId}/cancel`, {
      method: "POST",
      headers: { host: `127.0.0.1:${address.port}`, "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as { execution: { status: string; cancelRequested: boolean } };
    assert.equal(body.execution.status, "cancelled");
    assert.equal(body.execution.cancelRequested, true);
    assert.equal((await getStoryExecution(worldId, executionId))?.status, "cancelled");
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
