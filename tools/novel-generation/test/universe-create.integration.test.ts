import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/server.js";
import { buildStoryAnalysisContext } from "../src/story-analysis-context.js";
import { searchLibrary } from "../src/library.js";

test("create universe builds a bounded canon and excludes whole-book derived files", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-api-"));
  const previousCwd = process.cwd();
  const source = join(root, "worlds", "source-world");
  await mkdir(join(source, "library"), { recursive: true });
  await writeFile(join(source, "world-bible.md"), "# Test World\n");
  await writeFile(join(source, "world-bible-full.md"), "source setting");
  await writeFile(join(source, "characters.md"), "全书人物画像：未来剧情泄漏标记");
  await writeFile(join(source, "timeline.md"), "未来时间线泄漏标记");
  await mkdir(join(source, "analysis"), { recursive: true });
  await writeFile(join(source, "analysis", "whole-book.json"), "未来素材泄漏标记");
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
      { chapter: "第一章", chunkIndex: 0, start: 0, end: 8, text: "第一章正文" },
      { chapter: "第二章", chunkIndex: 0, start: 0, end: 8, text: "第二章正文" },
      { chapter: "第三章", chunkIndex: 0, start: 0, end: 8, text: "未来剧情泄漏标记" }
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
      body: JSON.stringify({ name: "第二章分支", entryChapter: "第二章", type: "free", brief: "测试" })
    });
    const responseBody = await response.text();
    assert.equal(response.status, 201, responseBody);
    const payload = JSON.parse(responseBody) as { universe: { id: string; entryChapter: string } };
    const universeDir = join(root, "worlds", payload.universe.id);
    assert.equal(payload.universe.entryChapter, "第二章");
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
    assert.equal(await readFile(join(universeDir, "characters.md"), "utf8").catch(() => ""), "");
    assert.equal(await readFile(join(universeDir, "timeline.md"), "utf8").catch(() => ""), "");
    assert.equal(await readFile(join(universeDir, "analysis", "whole-book.json"), "utf8").catch(() => ""), "");

    const snapshot = new DatabaseSync(join(universeDir, "novel.db"));
    try {
      assert.deepEqual((snapshot.prepare("SELECT title FROM novel_chapters ORDER BY ordinal").all() as Array<{ title: string }>).map(row => row.title), ["第一章", "第二章"]);
      assert.equal(snapshot.prepare("SELECT * FROM story_analysis").all().length, 0);
      assert.equal((snapshot.prepare("SELECT value FROM world_meta WHERE key='world_id'").get() as { value: string }).value, payload.universe.id);
    } finally { snapshot.close(); }
    assert.ok((await readFile(join(universeDir, "universe-entry.md"), "utf8")).includes("第二章正文"));
    assert.ok(!(await readFile(join(universeDir, "universe-entry.md"), "utf8")).includes("未来剧情泄漏标记"));
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
