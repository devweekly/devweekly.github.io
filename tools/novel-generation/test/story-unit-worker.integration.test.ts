import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, setStoryProgressAssessorForTests } from "../src/server.js";
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
  const previousCorruptSnapshot = process.env.NOVEL_TEST_CORRUPT_SNAPSHOT;
  const root = await mkdtemp(join(tmpdir(), "story-unit-worker-"));
  const worldId = "world-worker-test";
  const worldDir = join(root, "worlds", worldId);
  const cliDir = join(root, "src");
  const server = createServer(createApp());
  let serverStarted = false;
  let assessmentCount = 0;
  let completeStoryMode = false;
  let completeStoryAssessmentCount = 0;
  setStoryProgressAssessorForTests(async input => {
    assessmentCount++;
    if (completeStoryMode) completeStoryAssessmentCount++;
    const naturallyComplete = completeStoryMode && completeStoryAssessmentCount >= 2;
    return {
      coreConflictResolved: naturallyComplete, endingFeelsNatural: naturallyComplete, confidence: naturallyComplete ? "high" : "medium",
      unresolvedCoreThreads: naturallyComplete ? [] : ["核心选择仍在推进"],
      unrealizedMajorBeats: naturallyComplete ? [] : ["高潮尚未发生"],
      remainingStoryWork: naturallyComplete ? [] : ["继续推进人物选择及其后果"],
      nextDirection: naturallyComplete ? "故事自然收束" : "让人物选择带来新的局面变化",
      rationale: naturallyComplete ? "核心冲突已解决，人物选择产生后果，结尾自然。" : "测试用的逐章进展评估",
      meaningfulProgress: true, progressEvidence: "Worker chapter",
      cumulativeStorySummary: (input.unit.execution.cumulativeStorySummary ? input.unit.execution.cumulativeStorySummary + "\\n" : "") + input.chapterTitle + "：人物作出新的选择",
      revisedStorySpine: naturallyComplete ? input.unit.storySpine.map((beat, index) => ({ ...beat, status: index === input.unit.storySpine.length - 1 ? "completed" as const : "completed" as const })) : input.unit.storySpine,
      characterArcUpdates: []
    };
  });
  try {
    process.chdir(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    process.env.NOVEL_TEST_SOURCE_ROOT = projectRoot;
    await mkdir(worldDir, { recursive: true });
    await mkdir(join(worldDir, "library"), { recursive: true });
    await mkdir(cliDir, { recursive: true });
    await symlink(join(projectRoot, "node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(worldDir, "world-bible.md"), "# Worker Test World\n", "utf8");
    await writeFile(join(worldDir, "library", "index.json"), JSON.stringify({ schemaVersion: 1, worldId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), chunks: [] }), "utf8");

    // A deterministic fake CLI replaces only the model-backed chapter pipeline.
    // The real Express routes, worker, Run store, Story State store and checkpoint
    // handling still execute exactly as they do in the application.
    const fakeCli = `
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
state.characters.push({ name: unitId + "-" + state.events.length, status: "active", location: "test location" });
state.events.push({ id: unitId + "-" + state.events.length, summary: "worker generated", position: state.currentPosition, participants: [unitId], consequences: [] });
await saveStoryState(stateFile, state);
await mkdir(dirname(storyArcFile), { recursive: true });
await writeFile(storyArcFile, "arc:" + unitId + "\\n", "utf8");
const chapterPath = join(outputDir, "chapter.md");
await writeFile(chapterPath, "# Worker chapter\\n\\n" + unitId + " generated content.\\n", "utf8");
await writeFile(join(outputDir, "09-quality-summary.json"), JSON.stringify({ status: "passed" }), "utf8");
await writeFile(join(outputDir, "08-state-update.json"), JSON.stringify({ worldId }), "utf8");
if (process.env.NOVEL_TEST_CORRUPT_SNAPSHOT === "1") {
  const runId = outputDir.split("/").at(-1)?.replace(/^chapter-/, "");
  await rm(resolve(".output", worldId, "workbench", "state-snapshots", runId, "manifest.json"), { force: true });
  process.exitCode = 1;
}
console.log("Saved chapter: " + resolve(chapterPath));
console.log("Story state automatically updated: " + stateFile);
`;
    await writeFile(join(cliDir, "cli.ts"), fakeCli, "utf8");

    const unitA = await createStoredStoryUnit(worldDir, storyUnit(worldId, "故事 A"));
    const unitB = await createStoredStoryUnit(worldDir, storyUnit(worldId, "故事 B"));
    const unitC = await createStoredStoryUnit(worldDir, storyUnit(worldId, "故事 C"));
    await new Promise<void>((resolveListen, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolveListen()));
    serverStarted = true;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    const base = `http://127.0.0.1:${address.port}/api/worlds/${worldId}`;
    const headers = { host: `127.0.0.1:${address.port}`, "content-type": "application/json" };

    const runBatch = async (storyUnitId: string, chapterCount = 1) => {
      let created: Response | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        created = await fetch(base + "/chapter-batches", { method: "POST", headers, body: JSON.stringify({ storyUnitId, chapterCount }) });
        if (created.status !== 409) break;
        const reason = await created.clone().json().catch(() => ({})) as {error?:string};
        if (!reason.error?.includes("已有章节或长篇任务") && !reason.error?.includes("已有章节正在生成") && !reason.error?.includes("已有长篇任务")) {
          throw new Error("Batch creation rejected: " + JSON.stringify(reason));
        }
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      if (!created || created.status !== 202) throw new Error("Batch creation failed: " + (created ? await created.text() : "no response"));
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
    const runCompleteStory = async (storyUnitId: string) => {
      let created: Response | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        created = await fetch(base + "/story-executions", { method: "POST", headers, body: JSON.stringify({ storyUnitId }) });
        if (created.status !== 409) break;
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      if (!created || created.status !== 202) throw new Error("Complete-story creation failed: " + (created ? await created.text() : "no response"));
      const body = await created.json() as { execution: { id: string } };
      for (let attempt = 0; attempt < 200; attempt++) {
        const response = await fetch(base + "/story-executions/" + body.execution.id, { headers });
        const current = await response.json() as { execution: { status: string; error?: string; completedChapters: Array<{runId:string;chapterPath:string}> } };
        if (current.execution.status === "completed") return current.execution;
        if (current.execution.status === "failed" || current.execution.status === "stalled") throw new Error("Complete-story worker failed: " + current.execution.error);
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      throw new Error("Timed out waiting for complete-story worker completion.");
    };

    const a1 = await runBatch(unitA.id, 2);
    const b1 = await runBatch(unitB.id);
    const a2 = await runBatch(unitA.id);
    assert.equal(a1.completedChapters.length, 2);
    assert.equal(b1.completedChapters.length, 1);
    assert.equal(a2.completedChapters.length, 1);
    assert.equal(assessmentCount, 4);

    const runsResponse = await fetch(base + "/runs?storyUnitId=" + unitA.id, { headers });
    const runsA = await runsResponse.json() as { runs: Array<{ id:string; previousChapterPath?:string; chapterPath?:string }> };
    const a1Run = runsA.runs.find(run => run.id === a1.completedChapters[1]?.runId);
    const a2Run = runsA.runs.find(run => run.id === a2.completedChapters[0]?.runId);
    assert.ok(a1Run?.chapterPath);
    assert.equal(a2Run?.previousChapterPath, a1Run?.chapterPath);

    const stateAResponse = await fetch(base + "/story-units/" + unitA.id + "/state", { headers });
    const stateBResponse = await fetch(base + "/story-units/" + unitB.id + "/state", { headers });
    const stateA = await stateAResponse.json() as { state: { characters:Array<{name:string}>; events:Array<{id:string}> } };
    const stateB = await stateBResponse.json() as { state: { characters:Array<{name:string}>; events:Array<{id:string}> } };
    assert.equal(stateA.state.characters.length, 3);
    assert.equal(stateB.state.characters.length, 1);
    assert.ok(stateA.state.characters.every(person => person.name.startsWith(unitA.id + "-")));
    const unitARecord = JSON.parse(await readFile(join(worldDir, ".story-units", unitA.id + ".json"), "utf8")) as { execution: { lastAssessedChapterId?: string; cumulativeStorySummary?: string } };
    assert.equal(unitARecord.execution.lastAssessedChapterId, a2.completedChapters[0]?.runId);
    assert.match(unitARecord.execution.cumulativeStorySummary ?? "", /人物作出新的选择/);
    assert.ok(stateB.state.characters.every(person => person.name.startsWith(unitB.id + "-")));
    assert.equal((await readFile(join(worldDir, ".story-units", unitA.id, "story-arc.md"), "utf8")).trim(), "arc:" + unitA.id);
    assert.equal((await readFile(join(worldDir, ".story-units", unitB.id, "story-arc.md"), "utf8")).trim(), "arc:" + unitB.id);

    // Complete-story mode must use the same per-chapter assessor and stop only
    // when the deterministic assessment confirms natural narrative closure.
    completeStoryMode = true;
    completeStoryAssessmentCount = 0;
    const complete = await runCompleteStory(unitB.id);
    assert.equal(complete.completedChapters.length, 2);
    assert.equal(completeStoryAssessmentCount, 2);
    const completedUnitB = JSON.parse(await readFile(join(worldDir, ".story-units", unitB.id + ".json"), "utf8")) as { execution: { status: string; completedChapterIds: string[] } };
    assert.equal(completedUnitB.execution.status, "completed");
    assert.equal(completedUnitB.execution.completedChapterIds.length, 3);

    // A failed chapter whose rollback manifest is missing must retain currentRunId;
    // recovery must stop rather than silently continue from uncertain Story State.
    process.env.NOVEL_TEST_CORRUPT_SNAPSHOT = "1";
    const failedCreate = await fetch(base + "/chapter-batches", { method: "POST", headers, body: JSON.stringify({ storyUnitId: unitC.id, chapterCount: 1 }) });
    assert.equal(failedCreate.status, 202);
    const failedBody = await failedCreate.json() as { execution: { id: string } };
    let failedExecution: { status: string; currentRunId?: string; error?: string } | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await fetch(base + "/story-executions/" + failedBody.execution.id, { headers });
      failedExecution = (await response.json() as { execution: typeof failedExecution }).execution;
      if (failedExecution?.status === "failed") break;
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
    assert.equal(failedExecution?.status, "failed");
    assert.ok(failedExecution?.currentRunId);
    assert.match(failedExecution?.error ?? "", /状态回滚失败/);
    const failedRunsResponse = await fetch(base + "/runs?storyUnitId=" + unitC.id, { headers });
    const failedRuns = await failedRunsResponse.json() as { runs: Array<{ id: string; error?: string }> };
    assert.match(failedRuns.runs.find(run => run.id === failedExecution?.currentRunId)?.error ?? "", /状态回滚失败/);
    const blockedNewBatch = await fetch(base + "/chapter-batches", { method: "POST", headers, body: JSON.stringify({ storyUnitId: unitA.id, chapterCount: 1 }) });
    assert.equal(blockedNewBatch.status, 409);
    assert.match(((await blockedNewBatch.json()) as { error: string }).error, /回滚尚未得到确认/);
    delete process.env.NOVEL_TEST_CORRUPT_SNAPSHOT;

  } finally {
    setStoryProgressAssessorForTests((await import("../src/story-unit.js")).assessStoryUnitProgress);
    if (serverStarted) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    process.chdir(originalCwd);
    if (previousSourceRoot === undefined) delete process.env.NOVEL_TEST_SOURCE_ROOT;
    else process.env.NOVEL_TEST_SOURCE_ROOT = previousSourceRoot;
    if (previousCorruptSnapshot === undefined) delete process.env.NOVEL_TEST_CORRUPT_SNAPSHOT;
    else process.env.NOVEL_TEST_CORRUPT_SNAPSHOT = previousCorruptSnapshot;
    await rm(root, { recursive: true, force: true });
  }
});
