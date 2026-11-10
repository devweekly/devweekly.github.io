import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyKnowledgeBuildStepResult, createApp, recoverKnowledgeBuilds, recoverWorkbenchRuns } from "../src/server.js";
import { saveRun } from "../src/workbench-store.js";

test("universe knowledge build fails fast when source analysis is missing and never analyzes the canon locally", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-knowledge-build-"));
  const previousCwd = process.cwd();
  const worldId = "test-universe";
  let server: ReturnType<typeof createServer> | undefined;
  try {
    process.chdir(root);
    await mkdir(join(root, "worlds", worldId), { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(
      join(root, "worlds", worldId, "universe.json"),
      JSON.stringify({ id: worldId, sourceWorldId: "source", name: "测试宇宙", type: "free", entryChapter: "第一章", brief: "", createdAt: new Date().toISOString() })
    ));
    server = createServer(createApp());
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/worlds/${worldId}/knowledge-build`;
    await saveRun({
      id: "11111111-1111-4111-8111-111111111111", worldId, kind: "chapter",
      status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    const request = () => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: "{}"
    });
    const archive = (archived: boolean) => fetch(`http://127.0.0.1:${address.port}/api/worlds/${worldId}/universe-archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ archived })
    });
    assert.equal((await archive(true)).status, 409);
    const firstBuild = await request();
    assert.equal(firstBuild.status, 202, await firstBuild.clone().text());
    const immediateRetry = await request();
    assert.ok([202, 409].includes(immediateRetry.status), "an active build is guarded; a completed fail-fast build can be retried");
    await saveRun({
      id: "11111111-1111-4111-8111-111111111111", worldId, kind: "chapter",
      status: "completed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    const generation = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${worldId}/chapters/generate`, {
      method: "POST", headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` }, body: "{}"
    });
    assert.equal(generation.status, 409);
    const generationError = await generation.json();
    assert.match(String(generationError.error), /world-bible/);
    let buildFinished = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await fetch(url, { headers: { host: `127.0.0.1:${address.port}` } });
      const body = await status.json();
      if (body.build && ["failed", "partial", "completed"].includes(body.build.status)) { buildFinished = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(buildFinished, true);
    assert.equal((await archive(true)).status, 200);
    assert.equal((await request()).status, 409);
    assert.equal((await archive(false)).status, 200);
    const accepted = await request();
    assert.equal(accepted.status, 202);
    const acceptedBody = JSON.parse(await accepted.text()) as { build: { status: string; worldId: string } };
    assert.ok(["queued", "running"].includes(acceptedBody.build.status));
    assert.equal(acceptedBody.build.worldId, worldId);

    const generationDuringBuild = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${worldId}/chapters/generate`, {
      method: "POST", headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` }, body: "{}"
    });
    assert.equal(generationDuringBuild.status, 409);
    const generationDuringBuildError = await generationDuringBuild.json();
    assert.match(String(generationDuringBuildError.error), /world-bible/);

    let latest: { build: { status: string; steps: Array<{ name: string; status: string }> } | null } = { build: null };
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await fetch(url, { headers: { host: `127.0.0.1:${address.port}` } });
      latest = JSON.parse(await status.text()) as typeof latest;
      if (latest.build?.status === "failed" || latest.build?.status === "partial" || latest.build?.status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(latest.build);
    assert.ok(["failed", "partial", "completed"].includes(latest.build.status));
    assert.equal(latest.build.steps.length, 1, "missing source analysis must stop before launching downstream steps");
    assert.equal(latest.build.steps[0]?.name, "story-analysis");
    assert.equal(latest.build.steps[0]?.status, "failed");
    assert.match(latest.build.steps[0]?.error ?? "", /禁止在新故事宇宙重新分析整本原著/);
    const persisted = JSON.parse(await readFile(join(root, ".output", worldId, "workbench", "knowledge-build.json"), "utf8")) as typeof latest.build;
    assert.equal(persisted?.status, latest.build.status);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});


test("workbench restart marks an interrupted knowledge build interrupted and retryable", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-knowledge-recovery-"));
  const previousCwd = process.cwd();
  const worldId = "recovery-universe";
  const workbenchDir = join(root, ".output", worldId, "workbench");
  try {
    process.chdir(root);
    await mkdir(join(root, "worlds", worldId), { recursive: true });
    await mkdir(workbenchDir, { recursive: true });
    await writeFile(join(root, "worlds", worldId, "universe.json"), JSON.stringify({
      id: worldId, sourceWorldId: "source", name: "恢复测试", type: "free",
      entryChapter: "第一章", brief: "", createdAt: new Date().toISOString()
    }));
    await writeFile(join(workbenchDir, "knowledge-build.json"), JSON.stringify({
      worldId, status: "running", startedAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:01:00.000Z", currentStep: "character-states",
      steps: [
        { name: "story-analysis", status: "completed", startedAt: "2026-11-07T00:00:00.000Z", completedAt: "2026-11-07T00:00:30.000Z", exitCode: 0 },
        { name: "character-states", status: "running", startedAt: "2026-11-07T00:00:31.000Z" }
      ]
    }));
    await recoverWorkbenchRuns();
    await recoverKnowledgeBuilds();
    const recovered = JSON.parse(await readFile(join(workbenchDir, "knowledge-build.json"), "utf8")) as {
      status: string; currentStep?: string; steps: Array<{ name: string; status: string; error?: string }>
    };
    assert.equal(recovered.status, "interrupted");
    assert.equal(recovered.currentStep, undefined);
    assert.equal(recovered.steps[0]?.status, "completed");
    assert.equal(recovered.steps[1]?.status, "failed");
    assert.match(recovered.steps[1]?.error ?? "", /服务重启.*被中断/);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});


test("optional Vane unavailability is reported as skipped, not a failed knowledge build", () => {
  assert.equal(classifyKnowledgeBuildStepResult("vane-index", 0, JSON.stringify({
    skipped: true, reason: "Vane 原生包未安装；本宇宙继续使用现有 BM25 检索。"
  })), "skipped");
  assert.equal(classifyKnowledgeBuildStepResult("vane-index", 0, JSON.stringify({ documents: 120, vectorMode: false })), "completed");
  assert.equal(classifyKnowledgeBuildStepResult("story-analysis", 1, "model timeout"), "failed");
  assert.equal(classifyKnowledgeBuildStepResult("corpus-craft", 0, "done"), "completed");
});
