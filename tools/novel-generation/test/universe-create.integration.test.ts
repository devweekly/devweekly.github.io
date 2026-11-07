import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/server.js";
import { buildStoryAnalysisContext } from "../src/story-analysis-context.js";
import { readStoryAnalysis } from "../src/database.js";
import { buildAnalysisUnits } from "../src/novel-kb.js";
import { buildCorpusCraftContext } from "../src/corpus-craft.js";
import { buildWritingBrief } from "../src/writing-brief.js";
import { searchLibrary } from "../src/library.js";

test("create universe builds a bounded canon and excludes whole-book derived files", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-api-"));
  const previousCwd = process.cwd();
  const source = join(root, "worlds", "source-world");
  await mkdir(join(source, "library"), { recursive: true });
  await writeFile(join(source, "world-bible.md"), "# Test World\n");
  await writeFile(join(source, "original.txt"), "第一章正文\\n第二章正文\\n未来剧情泄漏标记", "utf8");
  await writeFile(join(source, "world-bible-full.md"), "source setting");
  await writeFile(join(source, "characters.md"), "全书人物画像：未来剧情泄漏标记");
  await writeFile(join(source, "timeline.md"), "未来时间线泄漏标记");
  await writeFile(join(source, "style-profile.md"), "未来风格信息泄漏标记");
  await writeFile(join(source, "story-arc.md"), "未来故事弧线泄漏标记");
  await writeFile(join(source, "story-plan.json"), JSON.stringify({ future: "未来计划泄漏标记" }));
  await writeFile(join(source, "story-state.json"), JSON.stringify({ future: "未来状态泄漏标记" }));
  await mkdir(join(source, "vane-index"), { recursive: true });
  await writeFile(join(source, "vane-index", "manifest.json"), JSON.stringify({ future: "未来 Vane 泄漏标记" }));
  await mkdir(join(source, "style-references"), { recursive: true });
  await writeFile(join(source, "style-references", "future.md"), "未来风格样本泄漏标记");
  await mkdir(join(source, "analysis"), { recursive: true });
  await writeFile(join(source, "analysis", "whole-book.json"), "未来素材泄漏标记");
  await mkdir(join(root, "analysis", "source-world", "corpus-craft", "chapters"), { recursive: true });
  await writeFile(join(root, "analysis", "source-world", "corpus-craft", "chapters", "future.json"), JSON.stringify({
    schemaVersion: 1, worldId: "source-world", chapterId: "future", ordinal: 3, title: "未来章节",
    scenes: [{ evidence: "未来剧情泄漏标记", summary: "未来剧情泄漏标记" }],
    dialogueExemplars: [], voiceObservations: [], causalLinks: [], knowledgeStates: [], worldDetails: [], narrativeObservations: []
  }));
  await mkdir(join(root, "analysis", "source-world"), { recursive: true });
  await writeFile(join(root, "analysis", "source-world", "chapter-index.json"), JSON.stringify({
    schemaVersion: 2, totalLines: 300,
    volumes: [{ volume: 1, chapters: [
      { sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 1 },
      { sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 100 },
      { sequenceInVolume: 3, printedNumber: 3, title: "第三章", label: "第三章", line: 200, futureMarker: "未来剧情泄漏标记" }
    ] }]
  }));
  await writeFile(join(source, "library", "index.json"), JSON.stringify({
    schemaVersion: 1, worldId: "source-world", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    chunks: [
      { chapter: "第一章", chunkIndex: 0, start: 0, end: 8, chapterStart: 0, sourceHash: "a".repeat(64), text: "第一章正文" },
      { chapter: "第二章", chunkIndex: 0, start: 0, end: 8, chapterStart: 100, sourceHash: "a".repeat(64), text: "第二章正文" },
      { chapter: "第三章", chunkIndex: 0, start: 0, end: 8, chapterStart: 200, sourceHash: "a".repeat(64), text: "未来剧情泄漏标记" }
    ]
  }));
  const db = new DatabaseSync(join(source, "novel.db"));
  db.exec(`
    CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO world_meta VALUES('world_id','source-world');
    CREATE TABLE novel_chapters(chapter_id TEXT PRIMARY KEY,title TEXT NOT NULL,ordinal INTEGER NOT NULL,volume INTEGER NOT NULL DEFAULT 1);
    INSERT INTO novel_chapters(chapter_id,title,ordinal,volume) VALUES('c1','第一章',1,1),('c2','第二章',2,1),('c3','第三章',3,1);
    CREATE TABLE story_analysis(singleton INTEGER PRIMARY KEY,world_id TEXT NOT NULL,payload_json TEXT);
    INSERT INTO story_analysis VALUES(1,'source-world','未来剧情泄漏标记');
  `);
  db.close();

  let server: ReturnType<typeof createServer> | undefined;
  try {
    process.chdir(root);
    server = createServer(createApp());
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/worlds/source-world/universes`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "第二章分支", entryChapter: "第二章", type: "free", brief: "测试", buildKnowledge: false })
    });
    const responseBody = await response.text();
    assert.equal(response.status, 201, responseBody);
    const payload = JSON.parse(responseBody) as { universe: { id: string; entryChapter: string } };
    const universeDir = join(root, "worlds", payload.universe.id);
    const sourceCanonStat = await stat(join(source, "original.txt"));
    const universeCanonStat = await stat(join(universeDir, "original.txt"));
    assert.equal(universeCanonStat.ino, sourceCanonStat.ino, "immutable original.txt should be physically shared when hard links are supported");
    assert.equal(payload.universe.entryChapter, "第二章");

    const archiveResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${payload.universe.id}/universe-archive`, {
      method: "PATCH", headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ archived: true })
    });
    assert.equal(archiveResponse.status, 200);
    const archivedPayload = JSON.parse(await archiveResponse.text()) as { universe: { archivedAt?: string } };
    assert.ok(archivedPayload.universe.archivedAt);

    const restoreResponse = await fetch(`http://127.0.0.1:${address.port}/api/worlds/${payload.universe.id}/universe-archive`, {
      method: "PATCH", headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ archived: false })
    });
    assert.equal(restoreResponse.status, 200);
    const restoredPayload = JSON.parse(await restoreResponse.text()) as { universe: { archivedAt?: string } };
    assert.equal(restoredPayload.universe.archivedAt, undefined);
    const localBible = await readFile(join(universeDir, "world-bible.md"), "utf8");
    assert.ok(localBible.includes("第二章"));
    assert.ok(localBible.includes("原文边界"));
    assert.ok(!localBible.includes("未来剧情泄漏标记"));
    const bootstrapBible = await readFile(join(universeDir, "world-bible.md"), "utf8");
    assert.ok(bootstrapBible.includes("第二章"));
    assert.ok(bootstrapBible.includes("不得读取、推断或引用起点之后的原文剧情作为本宇宙已发生事实"));
    assert.ok(!bootstrapBible.includes("未来剧情泄漏标记"));

    const boundedIndex = JSON.parse(await readFile(join(universeDir, "library", "index.json"), "utf8")) as { chunks: Array<{ chapter: string; text: string }> };
    assert.deepEqual(boundedIndex.chunks.map(chunk => chunk.chapter), ["第一章", "第二章"]);
    assert.ok(!JSON.stringify(boundedIndex).includes("未来剧情泄漏标记"));
    const boundedCatalog = JSON.parse(await readFile(join(root, "analysis", payload.universe.id, "chapter-index.json"), "utf8")) as { volumes: Array<{ chapters: Array<{ title: string; futureMarker?: string }> }> };
    assert.deepEqual(boundedCatalog.volumes.flatMap(volume => volume.chapters.map(chapter => chapter.title)), ["第一章", "第二章"]);
    assert.ok(!JSON.stringify(boundedCatalog).includes("未来剧情泄漏标记"));
    // Exercise the same chapter-unit and context assemblers used by analysis/write.
    const units = await buildAnalysisUnits(payload.universe.id, {
      worldDir: universeDir,
      catalogPath: join(root, "analysis", payload.universe.id, "chapter-index.json")
    });
    assert.deepEqual(units.units.map(unit => unit.title), ["第一章", "第二章"]);
    assert.ok(!JSON.stringify(units.units).includes("未来剧情泄漏标记"));

    const storyAnalysisContext = buildStoryAnalysisContext(
      readStoryAnalysis(universeDir, payload.universe.id),
      "未来剧情泄漏标记"
    );
    assert.ok(!storyAnalysisContext.includes("未来剧情泄漏标记"));

    const corpusCraftContext = await buildCorpusCraftContext(payload.universe.id, "未来剧情泄漏标记");
    assert.ok(!corpusCraftContext.includes("未来剧情泄漏标记"));

    const writingBrief = buildWritingBrief({ worldDir: universeDir, worldId: payload.universe.id, query: "未来剧情泄漏标记" });
    assert.ok(!writingBrief.includes("未来剧情泄漏标记"));
    assert.equal(await readFile(join(universeDir, "characters.md"), "utf8").catch(() => ""), "");
    assert.equal(await readFile(join(universeDir, "timeline.md"), "utf8").catch(() => ""), "");
    for (const relative of [
      "style-profile.md", "story-arc.md", "story-plan.json", "story-state.json",
      "vane-index/manifest.json", "style-references/future.md"
    ]) {
      assert.equal(await readFile(join(universeDir, relative), "utf8").catch(() => ""), "", relative + " must not be inherited");
    }
    assert.equal(await readFile(join(universeDir, "analysis", "whole-book.json"), "utf8").catch(() => ""), "");

    const snapshot = new DatabaseSync(join(universeDir, "novel.db"));
    try {
      assert.deepEqual((snapshot.prepare("SELECT title FROM novel_chapters ORDER BY ordinal").all() as Array<{ title: string }>).map(row => row.title), ["第一章", "第二章"]);
      assert.equal(snapshot.prepare("SELECT * FROM story_analysis").all().length, 0);
      assert.equal((snapshot.prepare("SELECT value FROM world_meta WHERE key='world_id'").get() as { value: string }).value, payload.universe.id);
    } finally { snapshot.close(); }
    assert.ok((await readFile(join(universeDir, "universe-entry.md"), "utf8")).includes("第二章正文"));
    assert.ok(!(await readFile(join(universeDir, "universe-entry.md"), "utf8")).includes("未来剧情泄漏标记"));
    const originContext = await readFile(join(universeDir, "universe-origin-context.md"), "utf8");
    assert.ok(originContext.includes("第一章正文"));
    assert.ok(!originContext.includes("未来剧情泄漏标记"));
    const analysisContext = buildStoryAnalysisContext(undefined, "未来剧情泄漏标记");
    assert.equal(analysisContext, "");
    const futureSearch = await searchLibrary(join(universeDir, "library"), "未来剧情泄漏标记", 10);
    assert.equal(futureSearch.length, 0);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
