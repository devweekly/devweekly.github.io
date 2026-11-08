import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  await mkdir(join(source, "as-of-analysis"), { recursive: true });
  await writeFile(join(source, "as-of-analysis", "characters.md"), "未来分支人物资料泄漏标记");
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
      { chapter: "第一章", chunkIndex: 0, start: 0, end: 8, chapterStart: 0, text: "第一章正文" },
      { chapter: "第二章", chunkIndex: 0, start: 0, end: 8, chapterStart: 100, sourceHash: "a".repeat(64), text: "第二章正文" },
      { chapter: "第三章", chunkIndex: 0, start: 0, end: 8, chapterStart: 200, sourceHash: "a".repeat(64), text: "未来剧情泄漏标记" }
    ]
  }));
  const db = new DatabaseSync(join(source, "novel.db"));
  db.exec(`
    CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO world_meta VALUES('world_id','source-world');
    CREATE TABLE novel_chapters(chapter_id TEXT PRIMARY KEY,title TEXT NOT NULL,ordinal INTEGER NOT NULL,volume INTEGER NOT NULL DEFAULT 1);
    INSERT INTO novel_chapters(chapter_id,title,ordinal,volume) VALUES('V01-C001','第一章',1,1),('V01-C002','第二章',2,1),('V01-C003','第三章',3,1);
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
      body: JSON.stringify({ name: "第二章分支", entryChapter: "第二章", entryChapterIndex: 1, type: "free", brief: "测试", buildKnowledge: false })
    });
    const responseBody = await response.text();
    assert.equal(response.status, 201, responseBody);
    const payload = JSON.parse(responseBody) as { universe: { id: string; entryChapter: string } };
    const universeDir = join(root, "worlds", payload.universe.id);
    const sourceCanonStat = await stat(join(source, "original.txt"));
    const universeCanonStat = await stat(join(universeDir, "original.txt"));
    assert.notEqual(universeCanonStat.ino, sourceCanonStat.ino, "source canon must not share a mutable inode across universes");
    assert.equal(await readFile(join(universeDir, "original.txt"), "utf8"), await readFile(join(source, "original.txt"), "utf8"));
    await writeFile(join(universeDir, "original.txt"), "子宇宙私有修改");
    assert.equal(await readFile(join(source, "original.txt"), "utf8"), "第一章正文\\n第二章正文\\n未来剧情泄漏标记", "child edits must never mutate source canon");
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
    assert.ok(units.units.some(unit => unit.title === "第二章"), "analysis input must include the selected entry chapter");
    assert.ok(!JSON.stringify(units.units).includes("未来剧情泄漏标记"));

    const storyAnalysisContext = buildStoryAnalysisContext(
      readStoryAnalysis(universeDir, payload.universe.id),
      "未来剧情泄漏标记"
    );
    assert.ok(!storyAnalysisContext.includes("未来剧情泄漏标记"));

    const corpusCraftContext = await buildCorpusCraftContext(payload.universe.id, "未来剧情泄漏标记");
    assert.ok(!corpusCraftContext.includes("未来剧情泄漏标记"));
    // A stale derived file with a matching worldId must still fail closed if
    // its chapter hash does not match the current bounded source chapter.
    const childCraftDir = join(root, "analysis", payload.universe.id, "corpus-craft", "chapters");
    await mkdir(childCraftDir, { recursive: true });
    const boundedChapter = units.units[0]!;
    await writeFile(join(childCraftDir, boundedChapter.chapterId + ".json"), JSON.stringify({
      schemaVersion: 1, worldId: payload.universe.id, chapterId: boundedChapter.chapterId,
      ordinal: boundedChapter.ordinal, title: boundedChapter.title, sourceHash: "stale-source-hash",
      scenes: [{ evidence: "未来剧情泄漏标记", summary: "未来剧情泄漏标记" }],
      dialogueExemplars: [], voiceObservations: [], causalLinks: [], knowledgeStates: [],
      worldDetails: [{ category: "未来设定", detail: "未来剧情泄漏标记", evidence: "未来剧情泄漏标记" }],
      narrativeObservations: []
    }));
    const staleCraftContext = await buildCorpusCraftContext(payload.universe.id, "未来剧情泄漏标记");
    assert.ok(!staleCraftContext.includes("未来剧情泄漏标记"), "same-world stale Corpus Craft must not bypass bounded source hash validation");

    const writingBrief = buildWritingBrief({ worldDir: universeDir, worldId: payload.universe.id, query: "未来剧情泄漏标记" });
    assert.ok(!writingBrief.includes("未来剧情泄漏标记"));
    assert.equal(await readFile(join(universeDir, "characters.md"), "utf8").catch(() => ""), "");
    assert.equal(await readFile(join(universeDir, "timeline.md"), "utf8").catch(() => ""), "");
    for (const relative of [
      "style-profile.md", "story-arc.md", "story-plan.json", "story-state.json",
      "vane-index/manifest.json", "style-references/future.md", "as-of-analysis/characters.md"
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

    // Inject a post-staging failure while building the bounded library snapshot.
    await writeFile(join(source, "library", "index.json"), "{ malformed json");
    const failedCreate = await fetch(`http://127.0.0.1:${address.port}/api/worlds/source-world/universes`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `127.0.0.1:${address.port}` },
      body: JSON.stringify({ name: "应回滚的宇宙", entryChapter: "第二章", entryChapterIndex: 1, type: "free", brief: "故障注入", buildKnowledge: false })
    });
    assert.equal(failedCreate.status, 500);
    const remainingWorlds = (await readdir(join(root, "worlds"))).sort();
    assert.deepEqual(remainingWorlds, ["source-world", payload.universe.id].sort());
    assert.equal(remainingWorlds.some(name => name.startsWith(".staging-")), false);

  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});


test("universe creation uses catalog order and stable chapter IDs despite extra groups, repeated titles, and a chapter without chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-universe-catalog-"));
  const previousCwd = process.cwd();
  const source = join(root, "worlds", "source-world");
  await mkdir(join(source, "library"), { recursive: true });
  await mkdir(join(root, "analysis", "source-world"), { recursive: true });
  await writeFile(join(source, "world-bible.md"), "# Test World\n");
  await writeFile(join(source, "original.txt"), [
    "第一章 卷一", "卷一第一章正文", "第二章 卷一", "卷一第二章正文",
    "第一章 卷二", "卷二第一章正文", "第二章 卷二", "卷二第二章正文"
  ].join("\n"), "utf8");
  const catalog = {
    schemaVersion: 2,
    totalLines: 8,
    chapterCount: 4,
    volumes: [
      { volume: 1, chapters: [
        { sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 1 },
        { sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 3 }
      ] },
      { volume: 2, chapters: [
        { sequenceInVolume: 1, printedNumber: 1, title: "第一章", label: "第一章", line: 5 },
        { sequenceInVolume: 2, printedNumber: 2, title: "第二章", label: "第二章", line: 7 }
      ] }
    ]
  };
  await writeFile(join(root, "analysis", "source-world", "chapter-index.json"), JSON.stringify(catalog));
  const lineOne = "第一章 卷一";
  const lineTwo = "卷一第一章正文";
  const lineThree = "第二章 卷一";
  const lineFour = "卷一第二章正文";
  const lineFive = "第一章 卷二";
  const lineSix = "卷二第一章正文";
  const volumeTwoSecondChapterStart = [lineOne, lineTwo, lineThree, lineFour, lineFive, lineSix].reduce((sum, line) => sum + line.length + 1, 0);
  const chunks = [
    { chapter: "前置内容", chunkIndex: 0, start: 0, end: 5, chapterStart: 0, text: "前置内容泄漏" },
    { chapter: "第一章", chunkIndex: 0, start: 0, end: 7, chapterStart: 0, text: "卷一第一章正文" },
    { chapter: "第二章", chunkIndex: 0, start: 0, end: 7, chapterStart: lineOne.length + lineTwo.length + 2, text: "卷一第二章正文" },
    { chapter: "作者说明", chunkIndex: 0, start: 0, end: 5, chapterStart: lineOne.length + lineTwo.length + lineThree.length + lineFour.length + 4, text: "作者说明泄漏" },
    // Volume 2's first chapter intentionally has no chunk. The catalog line
    // boundary must provide its source text without shifting the next chapter.
    { chapter: "第二章", chunkIndex: 0, start: 0, end: 7, chapterStart: volumeTwoSecondChapterStart, text: "卷二第二章正文" }
  ];
  await writeFile(join(source, "library", "index.json"), JSON.stringify({
    schemaVersion: 1, worldId: "source-world", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", chunks
  }));
  const db = new DatabaseSync(join(source, "novel.db"));
  db.exec(`
    CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO world_meta VALUES('world_id','source-world');
    CREATE TABLE novel_chapters(
      chapter_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,ordinal INTEGER NOT NULL,volume INTEGER NOT NULL,
      printed_number INTEGER,title TEXT NOT NULL,label TEXT NOT NULL,start_line INTEGER,
      char_count INTEGER NOT NULL,chunk_start INTEGER NOT NULL,chunk_end INTEGER NOT NULL
    );
    INSERT INTO novel_chapters VALUES
      ('V01-C001','source-world',1,1,1,'第一章','第一章',1,7,0,0),
      ('V01-C002','source-world',2,1,2,'第二章','第二章',3,7,1,1),
      ('V02-C002','source-world',4,2,2,'第二章','第二章',7,7,2,2);
  `);
  db.close();

  let server: ReturnType<typeof createServer> | undefined;
  try {
    process.chdir(root);
    server = createServer(createApp());
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { "content-type": "application/json", host: `127.0.0.1:${address.port}` };

    const directoryResponse = await fetch(base + "/api/worlds/source-world/source-chapters", { headers });
    assert.equal(directoryResponse.status, 200);
    const directory = JSON.parse(await directoryResponse.text()) as { chapters: Array<{ id: number; title: string }> };
    assert.deepEqual(directory.chapters.map(item => [item.id, item.title]), [
      [0, "第一章"], [1, "第二章"], [2, "第一章"], [3, "第二章"]
    ]);

    const response = await fetch(base + "/api/worlds/source-world/universes", {
      method: "POST", headers,
      body: JSON.stringify({
        name: "卷二第一章分支", entryChapter: "第一章", entryChapterIndex: 2,
        type: "free", brief: "稳定章节 ID 映射", buildKnowledge: false
      })
    });
    const body = await response.text();
    assert.equal(response.status, 201, body);
    const payload = JSON.parse(body) as { universe: { id: string; entryChapterId: string; entryOrdinal: number; entryChapterIndex: number } };
    assert.equal(payload.universe.entryChapterId, "V02-C001");
    assert.equal(payload.universe.entryOrdinal, 3);
    assert.equal(payload.universe.entryChapterIndex, 2);

    const universeDir = join(root, "worlds", payload.universe.id);
    assert.ok((await readFile(join(universeDir, "universe-entry.md"), "utf8")).includes("卷二第一章正文"));
    const boundedLibrary = JSON.parse(await readFile(join(universeDir, "library", "index.json"), "utf8")) as { chunks: Array<{ chapter: string; text: string }> };
    assert.deepEqual(boundedLibrary.chunks.map(item => item.chapter), ["第一章", "第二章"]);
    assert.ok(!JSON.stringify(boundedLibrary).includes("前置内容泄漏"));
    assert.ok(!JSON.stringify(boundedLibrary).includes("作者说明泄漏"));

    const boundedCatalog = JSON.parse(await readFile(join(root, "analysis", payload.universe.id, "chapter-index.json"), "utf8")) as { volumes: Array<{ chapters: Array<{ title: string }> }> };
    assert.deepEqual(boundedCatalog.volumes.flatMap(volume => volume.chapters.map(item => item.title)), ["第一章", "第二章", "第一章"]);

    const snapshot = new DatabaseSync(join(universeDir, "novel.db"));
    try {
      assert.deepEqual((snapshot.prepare("SELECT chapter_id,ordinal FROM novel_chapters ORDER BY ordinal").all().map(row => ({ ...(row as { chapter_id: string; ordinal: number }) })) as Array<{ chapter_id: string; ordinal: number }>), [
        { chapter_id: "V01-C001", ordinal: 1 },
        { chapter_id: "V01-C002", ordinal: 2 },
        { chapter_id: "V02-C001", ordinal: 3 }
      ]);
    } finally { snapshot.close(); }

    // The chunkless catalog row is reconstructed only in the staged universe;
    // the source knowledge database remains unchanged.
    const sourceDb = new DatabaseSync(join(source, "novel.db"));
    try {
      assert.equal(sourceDb.prepare("SELECT COUNT(*) AS count FROM novel_chapters WHERE chapter_id='V02-C001'").get()?.count, 0);
      sourceDb.prepare("DELETE FROM novel_chapters").run();
    } finally { sourceDb.close(); }
    const emptyIndexResponse = await fetch(base + "/api/worlds/source-world/universes", {
      method: "POST", headers,
      body: JSON.stringify({
        name: "缺少章节索引时必须失败", entryChapter: "第一章", entryChapterIndex: 0,
        type: "free", brief: "失败关闭", buildKnowledge: false
      })
    });
    assert.equal(emptyIndexResponse.status, 500);
    assert.match(await emptyIndexResponse.text(), /index-story/);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
