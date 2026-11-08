import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { createStoredStoryUnit } from "../src/story-unit-store.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function storyUnit(worldId: string, title: string) {
  return {
    schemaVersion: 1 as const, worldId, updatedAt: new Date().toISOString(), title,
    storyCore: title + " 的独立故事", readerExperience: "", openingSituation: "故事开始",
    centralConflict: "人物必须作出选择",
    fruitOrSetting: { name: "雾地", premise: "雾地中的故事", abilitiesAndRules: [], costsAndLimits: [], historicalContext: "", geographyAndDailyLife: "", powerAndSocialRelations: "" },
    cultureAndFolklore: [], taboosAndGhostStories: [], cast: [], relationshipDynamics: [],
    storySpine: [
      { title: "开端", function: "建立局面", causalChange: "人物被卷入", involvedCharacters: [], possibleArcs: [], status: "planned" as const },
      { title: "发展", function: "冲突升级", causalChange: "利益冲突", involvedCharacters: [], possibleArcs: [], status: "planned" as const },
      { title: "高潮", function: "关键选择", causalChange: "局面改变", involvedCharacters: [], possibleArcs: [], status: "planned" as const },
      { title: "结局", function: "收束", causalChange: "后果显现", involvedCharacters: [], possibleArcs: [], status: "planned" as const }
    ],
    subplots: [], climax: "关键选择", endingAndAftermath: "留下余韵",
    unresolvedQuestions: [], creativePossibilities: []
  };
}

test("fixed-batch worker keeps alternating Story Unit chapter history and Story State isolated", async () => {
  const originalCwd = process.cwd();
  const previousSourceRoot = process.env.NOVEL_TEST_SOURCE_ROOT;
  const root = await mkdtemp(join(tmpdir(), "story-unit-worker-"));
  const worldId = "world-worker-test";
  const worldDir = join(root, "worlds", worldId);
  const cliDir = join(root, "src");
  const server = createServer(createApp());
  let serverStarted = false;
  try {
    process.chdir(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    process.env.NOVEL_TEST_SOURCE_ROOT = projectRoot;
    await mkdir(worldDir, { recursive: true });
    await mkdir(join(worldDir, "library"), { recursive: true });
    await mkdir(cliDir, { recursive: true });
    await symlink(join(projectRoot, "node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(worldDir, "world-bible.md"), "# Worker Test World\n", "utf8");
    await writeFile(join(worldDir, "library", "index.json"), JSON.stringify({ schemaVersion: 1, chunks: [] }), "utf8");

    // A deterministic fake CLI replaces only the model-backed chapter pipeline.
    // The real Express routes, worker, Run store, Story State store and checkpoint
    // handling still execute exactly as they do in the application.
    const fakeCli = `
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const worldId = value("--world");
const stateFile = value("--state-file");
const storyUnitFile = value("--story-unit-file");
const storyArcFile = value("--story-arc-file");
const outputDir = value("--resume-dir");
const unitId = storyUnitFile?.split("/").at(-1)?.replace(/\\.json$/, "") ?? "legacy";
const sourceRoot = process.env.NOVEL_TEST_SOURCE_ROOT;
const { loadStoryState, saveStoryState } = await import(sourceRoot + "/src/story-state.ts");
await mkdir(outputDir, { recursive: true });
const state = await loadStoryState(stateFile, worldId);
state.currentPosition = unitId + " / generated chapter";
state.characters.push({ name: unitId, status: "active", location: "test location" });
state.events.push({ id: unitId + "-" + state.events.length, summary: "worker generated", position: state.currentPosition, participants: [unitId], consequences: [] });
await saveStoryState(stateFile, state);
await mkdir(dirname(storyArcFile), { recursive: true });
await writeFile(storyArcFile, "arc:" + unitId + "\\n", "utf8");
const chapterPath = join(outputDir, "chapter.md");
await writeFile(chapterPath, "# Worker chapter\\n\\n" + unitId + " generated content.\\n", "utf8");
await writeFile(join(outputDir, "09-quality-summary.json"), JSON.stringify({ status: "passed" }), "utf8");
await writeFile(join(outputDir, "08-state-update.json"), JSON.stringify({ worldId }), "utf8");
console.log("Saved chapter: " + resolve(chapterPath));
console.log("Story state automatically updated: " + stateFile);
`;
    await writeFile(join(cliDir, "cli.ts"), fakeCli, "utf8");

    const unitA = await createStoredStoryUnit(worldDir, storyUnit(worldId, "故事 A"));
    const unitB = await createStoredStoryUnit(worldDir, storyUnit(worldId, "故事 B"));
    await new Promise<void>((resolveListen, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolveListen()));
    serverStarted = true;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    const base = `http://127.0.0.1:${address.port}/api/worlds/${worldId}`;
    const headers = { host: `127.0.0.1:${address.port}`, "content-type": "application/json" };

    const runBatch = async (storyUnitId: string) => {
      const created = await fetch(base + "/chapter-batches", { method: "POST", headers, body: JSON.stringify({ storyUnitId, chapterCount: 1 }) });
      if (created.status !== 202) throw new Error("Batch creation failed: " + await created.text());
      const body = await created.json() as { execution: { id: string } };
      for (let attempt = 0; attempt < 200; attempt++) {
        const response = await fetch(base + "/story-executions/" + body.execution.id, { headers });
        const current = await response.json() as { execution: { status: string; error?: string; completedChapters: Array<{runId:string;chapterPath:string}> } };
        if (current.execution.status === "completed") return current.execution;
        if (current.execution.status === "failed") throw new Error("Worker failed: " + current.execution.error);
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      throw new Error("Timed out waiting for deterministic worker completion.");
    };

    const a1 = await runBatch(unitA.id);
    const b1 = await runBatch(unitB.id);
    const a2 = await runBatch(unitA.id);
    assert.equal(a1.completedChapters.length, 1);
    assert.equal(b1.completedChapters.length, 1);
    assert.equal(a2.completedChapters.length, 1);

    const runsResponse = await fetch(base + "/runs?storyUnitId=" + unitA.id, { headers });
    const runsA = await runsResponse.json() as { runs: Array<{ id:string; previousChapterPath?:string; chapterPath?:string }> };
    const a1Run = runsA.runs.find(run => run.id === a1.completedChapters[0]?.runId);
    const a2Run = runsA.runs.find(run => run.id === a2.completedChapters[0]?.runId);
    assert.ok(a1Run?.chapterPath);
    assert.equal(a2Run?.previousChapterPath, a1Run?.chapterPath);

    const stateAResponse = await fetch(base + "/story-units/" + unitA.id + "/state", { headers });
    const stateBResponse = await fetch(base + "/story-units/" + unitB.id + "/state", { headers });
    const stateA = await stateAResponse.json() as { state: { characters:Array<{name:string}>; events:Array<{id:string}> } };
    const stateB = await stateBResponse.json() as { state: { characters:Array<{name:string}>; events:Array<{id:string}> } };
    assert.equal(stateA.state.characters.length, 2);
    assert.equal(stateB.state.characters.length, 1);
    assert.ok(stateA.state.characters.every(person => person.name === unitA.id));
    assert.ok(stateB.state.characters.every(person => person.name === unitB.id));
    assert.equal((await readFile(join(worldDir, ".story-units", unitA.id, "story-arc.md"), "utf8")).trim(), "arc:" + unitA.id);
    assert.equal((await readFile(join(worldDir, ".story-units", unitB.id, "story-arc.md"), "utf8")).trim(), "arc:" + unitB.id);
  } finally {
    if (serverStarted) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    process.chdir(originalCwd);
    if (previousSourceRoot === undefined) delete process.env.NOVEL_TEST_SOURCE_ROOT;
    else process.env.NOVEL_TEST_SOURCE_ROOT = previousSourceRoot;
    await rm(root, { recursive: true, force: true });
  }
});
