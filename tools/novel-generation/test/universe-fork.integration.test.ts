import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { emptyStoryState } from "../src/story-state.js";
import { saveRun, type WorkbenchRun } from "../src/workbench-store.js";

test("fork universe restores a completed chapter snapshot and isolates copied history", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-fork-"));
  const previousCwd = process.cwd();
  const parentId = "parent-universe";
  const parentDir = join(root, "worlds", parentId);
  const outputDir = join(root, ".output", parentId, "chapter-001");
  const runId = "4e25df2d-58f3-4a77-a2e4-7b09c5cfa2a1";
  const chapterPath = join(outputDir, "chapter.md");
  let server: ReturnType<typeof createServer> | undefined;

  try {
    process.chdir(root);
    await mkdir(join(parentDir, "library"), { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(parentDir, "world-bible.md"), "# Test universe\n");
    await writeFile(join(parentDir, "universe.json"), JSON.stringify({
      id: parentId, sourceWorldId: "source-world", name: "父宇宙", type: "free",
      entryChapter: "原文第二章", brief: "测试", createdAt: "2026-11-01T00:00:00.000Z"
    }));
    await writeFile(join(parentDir, "source-canon.json"), JSON.stringify({ sourceWorldId: "source-world", readOnly: true }));
    await writeFile(join(parentDir, "library", "index.json"), JSON.stringify({
      schemaVersion: 1, worldId: parentId, createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      chunks: [
        { chapter: "原文第一章", chunkIndex: 0, start: 0, end: 6, text: "此前正文" },
        { chapter: "原文第二章", chunkIndex: 0, start: 0, end: 6, text: "起点正文" },
        { chapter: "原文第三章", chunkIndex: 0, start: 0, end: 6, text: "未来原文" }
      ]
    }));
    await writeFile(join(parentDir, "characters.md"), "不应继承的全书人物画像");
    await writeFile(join(parentDir, "timeline.md"), "不应继承的全书时间线");
    await writeFile(join(parentDir, "story-state.json"), JSON.stringify(emptyStoryState(parentId)));

    const state = emptyStoryState(parentId);
    state.currentPosition = "第一章续写结尾：主角已抵达北门";
    state.characters.push({ name: "主角", status: "受伤", location: "北门", knowledge: ["已知密信内容"] });
    state.events.push({
      id: "event-fork-point", summary: "主角抵达北门", position: "第一章续写结尾",
      participants: ["主角"], consequences: ["与守门人相遇"], origin: "original"
    });
    await writeFile(join(outputDir, "08-state-update.json"), JSON.stringify(state, null, 2));
    await writeFile(join(outputDir, "00-story-arc.md"), "# 分叉点 Story Arc\n后续计划只属于分叉点之前。\n");
    await writeFile(chapterPath, "# 续写第一章\n主角抵达北门。\n");
    const run: WorkbenchRun = {
      id: runId, worldId: parentId, kind: "chapter", status: "completed",
      createdAt: "2026-11-06T10:00:00.000Z", updatedAt: "2026-11-06T10:10:00.000Z",
      outputDir, chapterPath
    };
    await saveRun(run);

    server = createServer(createApp({ backgroundUniverseAnalysis: false }));
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${parentId}/universes/fork`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "北门之后的分支", chapterRunId: runId })
    });
    const responseBody = await response.text();
    assert.equal(response.status, 201, responseBody);
    const payload = JSON.parse(responseBody) as {
      universe: { id: string; parentUniverseId: string; forkPoint: string; entryChapter: string };
      forkedAt: string;
    };
    const childId = payload.universe.id;
    const childDir = join(root, "worlds", childId);
    const childOutput = join(root, ".output", childId, "chapter-001");

    assert.equal(payload.universe.parentUniverseId, parentId);
    assert.equal(payload.universe.forkPoint, runId);
    assert.equal(payload.universe.entryChapter, "原文第二章");
    assert.equal(payload.forkedAt, runId);
    assert.ok((await readFile(join(childDir, "story-state.json"), "utf8")).includes(childId));
    const restored = JSON.parse(await readFile(join(childDir, "story-state.json"), "utf8")) as typeof state;
    assert.equal(restored.worldId, childId);
    assert.equal(restored.currentPosition, state.currentPosition);
    assert.equal(restored.characters[0]?.status, "受伤");
    assert.equal(restored.events[0]?.id, "event-fork-point");
    assert.ok((await readFile(join(childDir, "story-arc.md"), "utf8")).includes("分叉点 Story Arc"));

    const bounded = JSON.parse(await readFile(join(childDir, "library", "index.json"), "utf8")) as { chunks: Array<{ chapter: string; text: string }> };
    assert.deepEqual(bounded.chunks.map(chunk => chunk.chapter), ["原文第一章", "原文第二章"]);
    assert.ok(!JSON.stringify(bounded).includes("未来原文"));
    assert.equal(await readFile(join(childDir, "characters.md"), "utf8").catch(() => ""), "");
    assert.equal(await readFile(join(childDir, "timeline.md"), "utf8").catch(() => ""), "");

    assert.equal(await readFile(join(childOutput, "chapter.md"), "utf8"), await readFile(chapterPath, "utf8"));
    const childSnapshot = JSON.parse(await readFile(join(childOutput, "08-state-update.json"), "utf8")) as typeof state;
    assert.equal(childSnapshot.worldId, childId);
    assert.equal(childSnapshot.currentPosition, state.currentPosition);

    const archiveResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universe-archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ archived: true })
    });
    assert.equal(archiveResponse.status, 200, await archiveResponse.text());
    const archivedForkResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universes/fork`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "不应创建", chapterRunId: runId })
    });
    assert.equal(archivedForkResponse.status, 409);
    const restoreResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universe-archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ archived: false })
    });
    assert.equal(restoreResponse.status, 200, await restoreResponse.text());

    const childRunResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/forkable-chapters`, {
      headers: { host: `127.0.0.1:${address.port}` }
    });
    const childRunBody = await childRunResponse.text();
    assert.equal(childRunResponse.status, 200, childRunBody);
    const childRuns = JSON.parse(childRunBody) as { chapters: Array<{ id: string }> };
    assert.deepEqual(childRuns.chapters.map(chapter => chapter.id), [runId]);
    const copiedRun = JSON.parse(await readFile(join(root, ".output", childId, "workbench", "runs", runId + ".json"), "utf8")) as WorkbenchRun;
    assert.equal(copiedRun.worldId, childId);
    assert.equal(copiedRun.outputDir, childOutput);
    assert.equal(copiedRun.chapterPath, join(childOutput, "chapter.md"));
    assert.ok(!copiedRun.outputDir.includes(parentId));
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
