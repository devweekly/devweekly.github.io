import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { DatabaseSync } from "node:sqlite";
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
    await mkdir(join(root, "worlds", "source-world", "library"), { recursive: true });
    await mkdir(join(root, "analysis", "source-world"), { recursive: true });
    const sourceLines = Array.from({ length: 201 }, (_, index) =>
      index === 0 ? "原文第一章" : index === 1 ? "此前正文" : index === 99 ? "原文第二章" : index === 100 ? "起点正文" : index === 199 ? "原文第三章" : index === 200 ? "未来原文" : ""
    );
    const sourceOriginalText = sourceLines.join("\n");
    const sourceHash = createHash("sha256").update(sourceOriginalText, "utf8").digest("hex");
    const sourceChapterStarts = [sourceOriginalText.indexOf("原文第一章"), sourceOriginalText.indexOf("原文第二章"), sourceOriginalText.indexOf("原文第三章")];
    await writeFile(join(root, "worlds", "source-world", "original.txt"), sourceOriginalText, "utf8");
    const canonDb = new DatabaseSync(join(root, "worlds", "source-world", "novel.db"));
    canonDb.exec(`CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO world_meta VALUES('world_id','source-world'); CREATE TABLE novel_chapters(chapter_id TEXT PRIMARY KEY,title TEXT NOT NULL,ordinal INTEGER NOT NULL,volume INTEGER NOT NULL DEFAULT 1); INSERT INTO novel_chapters VALUES('c1','原文第一章',1,1),('c2','原文第二章',2,1),('c3','原文第三章',3,1);`);
    canonDb.close();
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(root, "worlds", "source-world", "library", "index.json"), JSON.stringify({
      schemaVersion: 1, worldId: "source-world", createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      chunks: [
        { id: "source:1", source: "worlds/source-world/original.txt", sourceHash, chapter: "原文第一章", chunkIndex: 0, start: 0, end: "原文第一章\n此前正文".length, chapterStart: sourceChapterStarts[0], text: "原文第一章\n此前正文" },
        { id: "source:2", source: "worlds/source-world/original.txt", sourceHash, chapter: "原文第二章", chunkIndex: 0, start: 0, end: "原文第二章\n起点正文".length, chapterStart: sourceChapterStarts[1], text: "原文第二章\n起点正文" },
        { id: "source:3", source: "worlds/source-world/original.txt", sourceHash, chapter: "原文第三章", chunkIndex: 0, start: 0, end: "原文第三章\n未来原文".length, chapterStart: sourceChapterStarts[2], text: "原文第三章\n未来原文" }
      ]
    }));
    await writeFile(join(root, "analysis", "source-world", "chapter-index.json"), JSON.stringify({
      schemaVersion: 1, totalLines: 201,
      volumes: [{ volume: 1, chapters: [
        { sequenceInVolume: 1, printedNumber: 1, title: "原文第一章", label: "原文第一章", line: 1 },
        { sequenceInVolume: 2, printedNumber: 2, title: "原文第二章", label: "原文第二章", line: 100 },
        { sequenceInVolume: 3, printedNumber: 3, title: "原文第三章", label: "原文第三章", line: 200 }
      ] }]
    }));
    await writeFile(join(parentDir, "original.txt"), sourceOriginalText, "utf8");
    const parentDb = new DatabaseSync(join(parentDir, "novel.db"));
    parentDb.exec(`CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO world_meta VALUES('world_id','parent-universe'); CREATE TABLE novel_chapters(chapter_id TEXT PRIMARY KEY,title TEXT NOT NULL,ordinal INTEGER NOT NULL,volume INTEGER NOT NULL DEFAULT 1); INSERT INTO novel_chapters VALUES('c1','原文第一章',1,1),('c2','原文第二章',2,1),('c3','原文第三章',3,1);`);
    parentDb.close();
    await writeFile(join(parentDir, "world-bible.md"), "# Test universe\n");
    await writeFile(join(parentDir, "universe.json"), JSON.stringify({
      id: parentId, sourceWorldId: "source-world", name: "父宇宙", type: "free",
      entryChapter: "原文第二章", entryChapterId: "c2", entryChapterIndex: 1, entryOrdinal: 2, brief: "测试", createdAt: "2026-11-01T00:00:00.000Z"
    }));
    await writeFile(join(parentDir, "source-canon.json"), JSON.stringify({ sourceWorldId: "source-world", readOnly: true }));
    await writeFile(join(parentDir, "library", "index.json"), JSON.stringify({
      schemaVersion: 1, worldId: parentId, createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      chunks: [
        { id: "parent:1", source: "worlds/source-world/original.txt", sourceHash, chapter: "原文第一章", chunkIndex: 0, start: 0, end: "原文第一章\n此前正文".length, chapterStart: sourceChapterStarts[0], text: "原文第一章\n此前正文" },
        { id: "parent:2", source: "worlds/source-world/original.txt", sourceHash, chapter: "原文第二章", chunkIndex: 0, start: 0, end: "原文第二章\n起点正文".length, chapterStart: sourceChapterStarts[1], text: "原文第二章\n起点正文" },
        { id: "parent:3", source: "worlds/source-world/original.txt", sourceHash, chapter: "原文第三章", chunkIndex: 0, start: 0, end: "原文第三章\n未来原文".length, chapterStart: sourceChapterStarts[2], text: "原文第三章\n未来原文" }
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

    // A fork must use the parent's bounded local corpus; it must not reopen
    // the source project's full original.txt.
    await unlink(join(root, "worlds", "source-world", "original.txt"));

    server = createServer(createApp());
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${parentId}/universes/fork`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "北门之后的分支", chapterRunId: runId, buildKnowledge: false })
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
    const childCanon = await readFile(join(childDir, "original.txt"), "utf8");
    assert.ok(!childCanon.includes("原文第三章"), "fork must preserve the parent's bounded corpus");
    assert.ok(!childCanon.includes("未来原文"));

    assert.equal(payload.universe.parentUniverseId, parentId);
    assert.equal(payload.universe.forkPoint, runId);
    assert.equal(payload.universe.entryChapter, "原文第二章");
    const localBible = await readFile(join(childDir, "world-bible.md"), "utf8");
    assert.ok(localBible.includes("原文第二章"));
    assert.ok(localBible.includes(parentId));
    assert.ok(!localBible.includes("未来原文"));
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
    const childBible = await readFile(join(childDir, "world-bible.md"), "utf8");
    assert.ok(childBible.includes("分叉"));
    assert.ok(!childBible.includes("父宇宙后续剧情泄漏标记"));

    const archiveResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universe-archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ archived: true })
    });
    assert.equal(archiveResponse.status, 200, await archiveResponse.text());
    const archivedForkResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universes/fork`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "不应创建", chapterRunId: runId, buildKnowledge: false })
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

    // A fork must itself remain a valid source for another historical fork.
    const grandchildResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universes/fork`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "二次分支", chapterRunId: runId, buildKnowledge: false })
    });
    const grandchildBody = await grandchildResponse.text();
    assert.equal(grandchildResponse.status, 201, grandchildBody);
    const grandchildPayload = JSON.parse(grandchildBody) as { universe: { id: string } };
    const grandchildId = grandchildPayload.universe.id;
    const grandchildState = JSON.parse(await readFile(join(root, ".output", grandchildId, "workbench", "runs", runId + ".json"), "utf8")) as WorkbenchRun;
    assert.equal(grandchildState.worldId, grandchildId);
    const grandchildSnapshot = JSON.parse(await readFile(join(root, ".output", grandchildId, "chapter-001", "08-state-update.json"), "utf8")) as { worldId: string };
    assert.equal(grandchildSnapshot.worldId, grandchildId);

    // Race a second fork against archive on the same parent. The shared per-world
    // queue must serialize them: either the fork completes before archive, or
    // archive wins and the fork is rejected. A half-published fork is never valid.
    const raceForkPromise = fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universes/fork`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "并发竞态分支", chapterRunId: runId, buildKnowledge: false })
    });
    const raceArchivePromise = fetch(`http://127.0.0.1:${address.port}/api/worlds/${childId}/universe-archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ archived: true })
    });
    const [raceForkResponse, raceArchiveResponse] = await Promise.all([raceForkPromise, raceArchivePromise]);
    const raceForkBody = await raceForkResponse.text();
    const raceArchiveBody = await raceArchiveResponse.text();
    assert.equal(raceArchiveResponse.status, 200, raceArchiveBody);
    assert.ok([201, 409].includes(raceForkResponse.status), raceForkBody);
    if (raceForkResponse.status === 409) {
      const worlds = await (await import("node:fs/promises")).readdir(join(root, "worlds"));
      assert.equal(worlds.some(name => name.startsWith("u-") && name !== childId && name !== grandchildId), false);
    } else {
      const raced = JSON.parse(raceForkBody) as { universe: { id: string } };
      assert.ok(await readFile(join(root, "worlds", raced.universe.id, "universe.json"), "utf8"));
    }
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
