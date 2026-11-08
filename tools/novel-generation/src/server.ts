// Workbench Express API 组装。这里只做三件事：参数校验、错误映射和响应序列化；
// 领域逻辑（Story Plan、Story State、故事图谱、风格参考）全部走共享 domain service，
// 不得在路由层复制 prompt 或 schema 逻辑。
import express, { type Request, type Response, type NextFunction } from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { loadStoryPlan, saveStoryPlan, generateStoryPlan } from "./story-plan.js";
import { loadStoryState, validateStoryState } from "./story-state.js";
import { readStoryAnalysis, listNovelCharacters, countNovelCharacters, readNovelCharacterWorkbenchDetail } from "./database.js";
import {
  CHARACTER_LIST_MAX_LIMIT, CHARACTER_LIST_DEFAULT_LIMIT, DASHBOARD_PLAN_VERSIONS_LIMIT, DASHBOARD_RECENT_RUNS_LIMIT,
  STORY_ANALYSIS_QUERY_CHARACTERS,
  WORKBENCH_BODY_LIMIT
} from "./constants.js";
import { buildStoryAnalysisContext } from "./story-analysis-context.js";
import { buildStoryStateGraph, filterGraph } from "./story-state-graph.js";
import { archiveStyleReference, listStyleReferenceHistory, listStyleReferences, putStyleReference, readActiveStyleReference, readStyleReferenceVersion } from "./style-references.js";
import { getCandidate, getRun, listCandidates, listRuns, recoverInterruptedRuns, saveCandidate, saveRun, type StoryPlanCandidate, type WorkbenchRun } from "./workbench-store.js";
import type { StoryState } from "./story-state.js";
import { buildUniverseOriginContext, buildUniverseWorldBible, rebaseStoryState, remapForkedRun, shouldCopyUniverseAsset } from "./universe-branch.js";
import { importBoundedStoryAnalysisSnapshot, restrictKnowledgeDatabaseToEntry } from "./source-canon-snapshot.js";
import { importBoundedStoryAnalysisFromBatchCache } from "./story-analysis.js";
import { resolveWorldLibraryDir } from "./universe-library.js";
import { assessStoryUnitProgress, generateStoryUnit, isStoryUnitNaturallyComplete, validateStoryUnit } from "./story-unit.js";
import { createStoredStoryUnit, getStoredStoryUnit, listStoredStoryUnits, saveStoredStoryUnit } from "./story-unit-store.js";
import { getStoryExecution, listStoryExecutions, recoverStoryExecutions, saveStoryExecution, type StoryExecution } from "./story-execution.js";

// 路由参数类型：显式列出各路由的参数名，避免向索引签名退化后被
// noUncheckedIndexedAccess 放宽成 string | undefined。
type WorldIdParams = { worldId: string };
type NamedParams = { worldId: string; name: string };
type ReferenceVersionParams = { worldId: string; name: string; version: string };

const app = express();
app.disable("x-powered-by");

/** 只接受回环 Host 头，并拒绝 Source 页面与 API Host 不一致的跨域请求。 */
app.use((req, res, next) => {
  const hostname = req.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) {
    return res.status(403).json({ error: "Workbench only accepts loopback Host headers." });
  }
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin requests are not allowed." });
    } catch {
      return res.status(403).json({ error: "Invalid Origin header." });
    }
  }
  next();
});
app.use(express.json({ limit: WORKBENCH_BODY_LIMIT, strict: true }));

/** 世界 ID 即目录名，只允许字母数字与连字符，防止路径逃逸。 */
function worldIdOf(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(value)) {
    throw Object.assign(new Error("Invalid world id."), { status: 400 });
  }
  return value;
}

/** 历史记录 ID 是本项目生成的 UUID，校验格式后再查库。 */
function recordId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw Object.assign(new Error("Invalid record id."), { status: 400 });
  }
  return value;
}

function worldDir(id: string): string {
  return path.resolve("worlds", id);
}

/** 双保险：即便 ID 校验规则未来放宽，也不允许解析到 worlds 之外。 */
function assertInsideWorld(id: string): void {
  if (!worldDir(id).startsWith(path.resolve("worlds") + path.sep)) {
    throw Object.assign(new Error("Invalid world path."), { status: 400 });
  }
}

/** 遍历 worlds/ 下合法目录，读取世界标题与 Story Plan 存在标记；无效目录静默跳过。 */
async function listWorlds(): Promise<Array<{ id: string; title: string; hasStoryPlan: boolean }>> {
  const root = path.resolve("worlds");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const validId = (x: string) => /^[a-z0-9][a-z0-9-]*$/i.test(x);
  const result: Array<{ id: string; title: string; hasStoryPlan: boolean }> = [];
  for (const id of entries.filter(validId)) {
    try {
      if (await readUniverse(id)) continue; // 宇宙是原文项目的分支，不重复列为独立原文项目。
      const bible = await readFile(path.join(root, id, "world-bible.md"), "utf8");
      let plan;
      try {
        plan = await loadStoryPlan(path.join(root, id, "story-plan.json"), id);
      } catch (error) {
        console.warn("[workbench] Invalid Story Plan for " + id, error);
      }
      const title = bible.split("\n").find(line => line.startsWith("# "))?.slice(2).trim() || id;
      result.push({ id, title, hasStoryPlan: Boolean(plan) });
    } catch {
      /* 非世界目录或缺失元数据，不进列表。 */
    }
  }
  return result;
}

/** 业务异常的 status 字段直接映射成 HTTP 状态；其余一律按 500 处理。 */
function sendError(res: Response, error: unknown): void {
  const status = Number((error as { status?: number })?.status) || 500;
  res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
}

/**
 * 同一世界的写任务串行执行（规划跑库、状态落盘会互相竞争）。
 * 各世界独立排队；队列尾部只保留最新任务，避免长链引用堆积。
 */
const worldQueues = new Map<string, Promise<void>>();
const worldMutationLocks = new Set<string>();

type KnowledgeBuildStep = "story-analysis" | "as-of-dossier" | "volume-arcs" | "style-profile" | "character-profiles" | "character-states" | "corpus-craft" | "vane-index";
type KnowledgeBuildProgress = { current: number; total: number; label: string };
type KnowledgeBuildState = {
  worldId: string; status: "queued" | "running" | "completed" | "partial" | "failed" | "interrupted";
  startedAt: string; updatedAt: string; completedAt?: string;
  currentStep?: KnowledgeBuildStep;
  /** 当前步骤的实时进度，从子进程 stdout 解析。步骤内可能持续数分钟，
   *  只在步骤结束时写状态会让前端看起来「一直不动」。 */
  progress?: KnowledgeBuildProgress;
  steps: Array<{ name: KnowledgeBuildStep; status: "running" | "completed" | "failed" | "skipped"; startedAt: string; completedAt?: string; exitCode?: number | null; output?: string; error?: string; progress?: KnowledgeBuildProgress }>;
};
/**
 * Resolve a CLI entry that exists in both source checkout and production package.
 * Production installs intentionally omit devDependencies such as tsx.
 */
export function buildCliEntryArgs(command: string[], production = process.env.NODE_ENV === "production"): string[] {
  return production
    ? ["dist/cli.js", ...command]
    : ["--import", "tsx", "src/cli.ts", ...command];
}

export function classifyKnowledgeBuildStepResult(
  stepName: KnowledgeBuildStep,
  exitCode: number | null,
  output: string
): "completed" | "failed" | "skipped" {
  if (stepName === "vane-index" && exitCode === 0) {
    try {
      if ((JSON.parse(output) as { skipped?: boolean }).skipped === true) return "skipped";
    } catch { /* successful commands may emit non-JSON diagnostics */ }
  }
  return exitCode === 0 ? "completed" : "failed";
}

const knowledgeBuilds = new Set<string>();
function knowledgeBuildPath(id: string): string {
  return path.resolve(".output", id, "workbench", "knowledge-build.json");
}
async function readKnowledgeBuild(id: string): Promise<KnowledgeBuildState | null> {
  try { return JSON.parse(await readFile(knowledgeBuildPath(id), "utf8")) as KnowledgeBuildState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeKnowledgeBuild(state: KnowledgeBuildState): Promise<void> {
  const target = knowledgeBuildPath(state.worldId);
  await mkdir(path.dirname(target), { recursive: true });
  // 进度写入可能与步骤结束写入并发；唯一临时文件名避免互相覆盖。
  const temporary = target + "." + process.pid + "." + randomUUID().slice(0, 8) + ".tmp";
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(temporary, target);
}
const KNOWLEDGE_BUILD_STEPS: Array<{ name: KnowledgeBuildStep; command: string[] }> = [
  { name: "story-analysis", command: ["analyze-story"] },
  { name: "volume-arcs", command: ["analyze-arcs"] },
  { name: "style-profile", command: ["ensure-style-profile"] },
  { name: "character-profiles", command: ["analyze-profiles"] },
  { name: "character-states", command: ["analyze-character-states"] },
  { name: "corpus-craft", command: ["analyze-corpus-craft"] },
  { name: "as-of-dossier", command: ["export-asof-dossier"] },
  { name: "vane-index", command: ["vane-index", "--optional"] }
];
/** analyze-story 每批打印 `[story-analysis] batch N/M · ...`，用于实时进度。 */
function parseBatchProgress(text: string): KnowledgeBuildProgress | undefined {
  const matches = [...text.matchAll(/\[story-analysis\] batch (\d+)\/(\d+)/g)];
  const last = matches.at(-1);
  if (!last) return undefined;
  const current = Number(last[1]), total = Number(last[2]);
  return Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? { current, total, label: "批次" }
    : undefined;
}

async function runKnowledgeBuildStep(
  worldId: string,
  command: string[],
  onProgress?: (progress: KnowledgeBuildProgress) => void
): Promise<{ exitCode: number | null; output: string; error: string }> {
  return await new Promise(resolve => {
    const cliArgs = [...buildCliEntryArgs(command), "--world", worldId];
    const child = spawn(process.execPath, cliArgs, {
      cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "", error = "", settled = false, lastCurrent = 0;
    child.stdout.setEncoding("utf8").on("data", chunk => {
      output += chunk;
      if (!onProgress) return;
      const progress = parseBatchProgress(output.slice(-4096));
      if (progress && progress.current !== lastCurrent) { lastCurrent = progress.current; onProgress(progress); }
    });
    child.stderr.setEncoding("utf8").on("data", chunk => { error += chunk; });
    child.on("error", cause => { if (settled) return; settled = true; resolve({ exitCode: null, output, error: error + cause.message }); });
    child.on("close", code => { if (settled) return; settled = true; resolve({ exitCode: code, output, error }); });
  });
}
async function startKnowledgeBuild(worldId: string): Promise<KnowledgeBuildState> {
  // Reserve synchronously before any await: two POSTs in the same event loop
  // must not both pass the active-task check.
  if (knowledgeBuilds.has(worldId)) {
    throw Object.assign(new Error("该宇宙已有知识构建任务正在运行。"), { status: 409 });
  }
  knowledgeBuilds.add(worldId);
  try {
    // 落盘状态不参与互斥判定：服务重启后它可能是上一次构建的残留 running，
    // 仅凭它会把「重新构建」永久挡在 409。真正的互斥由内存 Set 负责，
    // 残留状态由 recoverKnowledgeBuilds() 在启动时标记为 interrupted。
    const now = new Date().toISOString();
    const state: KnowledgeBuildState = { worldId, status: "queued", startedAt: now, updatedAt: now, steps: [] };
    await writeKnowledgeBuild(state);
    void (async () => {
      let failed = 0;
      state.status = "running";
      const universe = await readUniverse(worldId);
      let existingAnalysis = readStoryAnalysis(worldDir(worldId), worldId) as (ReturnType<typeof readStoryAnalysis> & { asOfEntryChapter?: string }) | undefined;
      if (universe && !hasBoundedStoryAnalysis(existingAnalysis, universe)) {
        await ensureUniverseStoryAnalysis(worldId, universe);
        existingAnalysis = readStoryAnalysis(worldDir(worldId), worldId) as (ReturnType<typeof readStoryAnalysis> & { asOfEntryChapter?: string }) | undefined;
      }
      // Use the same semantic validity predicate as backfill. A marker-only or
      // empty storyCore:{observations:[]} snapshot must never suppress analysis.
      const reusableBoundedAnalysis = Boolean(universe && hasBoundedStoryAnalysis(existingAnalysis, universe));
      for (const step of KNOWLEDGE_BUILD_STEPS) {
        if (step.name === "story-analysis" && reusableBoundedAnalysis) {
          const now = new Date().toISOString();
          state.steps.push({ name: step.name, status: "skipped", startedAt: now, completedAt: now, output: "Reused the existing complete, entry-bounded v6 story analysis snapshot." });
          state.updatedAt = now;
          await writeKnowledgeBuild(state);
          continue;
        }
        const record: KnowledgeBuildState["steps"][number] = { name: step.name, status: "running", startedAt: new Date().toISOString() };
        state.currentStep = step.name; state.steps.push(record); state.updatedAt = new Date().toISOString();
        delete state.progress;
        await writeKnowledgeBuild(state);
        let progressWrite: Promise<unknown> = Promise.resolve();
        const result = await runKnowledgeBuildStep(worldId, step.command, progress => {
          state.progress = progress;
          record.progress = progress;
          state.updatedAt = new Date().toISOString();
          // 串行链式写，避免批次密集时多个 tmp+rename 交错。
          progressWrite = progressWrite.then(() => writeKnowledgeBuild(state)).catch(() => undefined);
        });
        await progressWrite;
        record.exitCode = result.exitCode;
        record.output = result.output.slice(-12000);
        record.error = result.error.slice(-6000);
        record.completedAt = new Date().toISOString();
        record.status = classifyKnowledgeBuildStepResult(step.name, result.exitCode, result.output);
        if (record.status === "failed") failed++;
        state.updatedAt = new Date().toISOString();
        await writeKnowledgeBuild(state);
      }
      state.status = failed === 0 ? "completed" : failed === state.steps.length ? "failed" : "partial";
      state.completedAt = new Date().toISOString(); state.updatedAt = state.completedAt;
      delete state.currentStep; delete state.progress;
      await writeKnowledgeBuild(state);
    })().catch(async error => {
      state.status = "failed"; state.completedAt = new Date().toISOString(); state.updatedAt = state.completedAt;
      state.steps.push({ name: state.currentStep ?? "story-analysis", status: "failed", startedAt: state.updatedAt, completedAt: state.completedAt, error: String(error) });
      delete state.currentStep; delete state.progress;
      await writeKnowledgeBuild(state).catch(() => undefined);
    }).finally(() => knowledgeBuilds.delete(worldId));
    return state;
  } catch (error) {
    knowledgeBuilds.delete(worldId);
    throw error;
  }
}

/**
 * 服务重启会丢掉内存里的 knowledgeBuilds 标记，但落盘状态可能仍是 running/queued。
 * 不处理会形成永久卡死：重建被 409 拒绝、前端按钮 disabled、章节生成也被挡。
 * 启动时统一标为 interrupted；已完成的批次缓存仍在磁盘上，重新构建会直接复用。
 */
export async function recoverKnowledgeBuilds(): Promise<void> {
  const root = path.resolve(".output");
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  await Promise.all(entries.map(async id => {
    const state = await readKnowledgeBuild(id).catch(() => null);
    if (!state || (state.status !== "running" && state.status !== "queued")) return;
    const interruptedAt = new Date().toISOString();
    state.status = "interrupted";
    state.completedAt = interruptedAt;
    state.updatedAt = interruptedAt;
    state.steps = state.steps.map(step => step.status === "running"
      ? { ...step, status: "failed" as const, completedAt: interruptedAt, error: "服务重启，构建被中断；已完成的批次缓存仍可复用。" }
      : step);
    delete state.currentStep;
    delete state.progress;
    await writeKnowledgeBuild(state).catch(() => undefined);
  }));
}


/** Reserve the short metadata mutation window synchronously, before the first await. */
function acquireWorldMutation(worldId: string): (() => void) | null {
  if (worldMutationLocks.has(worldId)) return null;
  worldMutationLocks.add(worldId);
  return () => worldMutationLocks.delete(worldId);
}

/** Release callbacks are assigned inside async queue callbacks; isolate invocation from outer control-flow narrowing. */
function releaseWorldMutation(release: (() => void) | null): void {
  if (release) release();
}

async function serializeWorld<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  const previous = worldQueues.get(worldId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  worldQueues.set(worldId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (worldQueues.get(worldId) === tail) worldQueues.delete(worldId);
  }
}

// ── 基础与看板 ────────────────────────────────────────────────

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "novel-generation-workbench" }));
app.get("/api/worlds", async (_req, res) => {
  try {
    res.json({ worlds: await listWorlds() });
  } catch (error) { sendError(res, error); }
});

/** 看板：Story Plan 当前版本 + 各状态运行计数 + 最近运行与候选版本。 */
async function dashboardHandler(req: Request<WorldIdParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const [storyPlan, runs, candidates] = await Promise.all([
    loadStoryPlan(path.join(worldDir(id), "story-plan.json"), id),
    listRuns(id),
    listCandidates(id)
  ]);
  res.json({
    worldId: id,
    storyPlan: storyPlan ?? null,
    counts: {
      running: runs.filter(x => x.status === "queued" || x.status === "running").length,
      completedRuns: runs.filter(x => x.status === "completed").length,
      failedRuns: runs.filter(x => x.status === "failed").length
    },
    recentRuns: runs.slice(0, DASHBOARD_RECENT_RUNS_LIMIT),
    planVersions: candidates
      .map(candidate => candidate.status === "pending" || candidate.status === "changes_requested" ? { ...candidate, status: "superseded" } : candidate)
      .slice(0, DASHBOARD_PLAN_VERSIONS_LIMIT)
  });
}
app.get("/api/worlds/:worldId/dashboard", async (req, res) => {
  try { await dashboardHandler(req, res); } catch (error) { sendError(res, error); }
});

// ── 独立故事宇宙 ──────────────────────────────────────────

interface StoryUniverse {
  id: string;
  sourceWorldId: string;
  name: string;
  type: string;
  entryChapter: string;
  entryChapterId?: string;
  entryChapterIndex?: number;
  entryOrdinal?: number;
  brief: string;
  parentUniverseId?: string;
  forkPoint?: string;
  createdAt: string;
  archivedAt?: string;
}

function rebindKnowledgeDatabase(databasePath: string, worldId: string): void {
  if (!existsSync(databasePath)) return;
  const db = new DatabaseSync(databasePath);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const { name } of tables) {
        const columns = db.prepare("PRAGMA table_info(" + JSON.stringify(name) + ")").all() as Array<{ name: string }>;
        if (columns.some(column => column.name === "world_id")) {
          db.prepare("UPDATE \"" + name.replace(/"/g, "\"\"") + "\" SET world_id=?").run(worldId);
        }
      }
      const meta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='world_meta'").get();
      if (meta) db.prepare("UPDATE world_meta SET value=? WHERE key='world_id'").run(worldId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally { db.close(); }
}


async function readUniverse(id: string): Promise<StoryUniverse | null> {
  try {
    return JSON.parse(await readFile(path.join(worldDir(id), "universe.json"), "utf8")) as StoryUniverse;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function hasBoundedStoryAnalysis(
  snapshot: (ReturnType<typeof readStoryAnalysis> & { asOfEntryChapter?: string; asOfEntryChapterId?: string }) | undefined,
  universe: StoryUniverse
): boolean {
  if (!snapshot || snapshot.analysisVersion !== 6 || snapshot.complete !== true ||
      snapshot.asOfEntryChapter !== universe.entryChapter ||
      (universe.entryChapterId && snapshot.asOfEntryChapterId !== universe.entryChapterId)) return false;
  const coreObservations = Array.isArray(snapshot.storyCore?.observations) ? snapshot.storyCore.observations.length : 0;
  const facts = snapshot.characters.length + snapshot.plotThreads.length + snapshot.foreshadowings.length +
    (snapshot.relations?.length ?? 0) + (snapshot.macguffins?.length ?? 0) +
    (snapshot.storyGraph?.nodes.length ?? 0) + coreObservations +
    ((snapshot as typeof snapshot & {storyCoreObservations?:unknown[]}).storyCoreObservations?.length ?? 0);
  return facts > 0;
}

/** Existing universes created before bounded snapshot reuse can recover their source project's offline analysis. */
const universeAnalysisBackfills = new Map<string, Promise<void>>();
async function ensureUniverseStoryAnalysis(worldId: string, universe: StoryUniverse): Promise<void> {
  const active = universeAnalysisBackfills.get(worldId);
  if (active) return active;
  const task = (async () => {
    const current = readStoryAnalysis(worldDir(worldId), worldId) as (ReturnType<typeof readStoryAnalysis> & { asOfEntryChapter?: string }) | undefined;
    if (hasBoundedStoryAnalysis(current, universe)) return;
    if (!existsSync(path.join(worldDir(universe.sourceWorldId), "novel.db"))) return;
    const source = readStoryAnalysis(worldDir(universe.sourceWorldId), universe.sourceWorldId);
    if (!source || source.analysisVersion !== 6 || source.complete !== true) return;
    const targetDir = worldDir(worldId);
    const reusedBatches = universe.entryChapterId
      ? await importBoundedStoryAnalysisFromBatchCache(
          universe.sourceWorldId, worldId, targetDir, universe.entryChapterId, universe.entryChapter
        ).catch(error => {
          console.warn("[workbench] bounded batch-cache reuse failed; falling back to filtered merged snapshot", error);
          return false;
        })
      : false;
    if (!reusedBatches) {
      importBoundedStoryAnalysisSnapshot(
        path.join(targetDir, "novel.db"),
        worldId,
        universe.entryChapter,
        source as unknown as Record<string, unknown>,
        universe.entryChapterId
      );
    }
  })();
  universeAnalysisBackfills.set(worldId, task);
  try { await task; }
  finally { if (universeAnalysisBackfills.get(worldId) === task) universeAnalysisBackfills.delete(worldId); }
}

/**
 * Historical universes cannot inherit the source world's whole-book bible:
 * it may contain future spoilers. Write still requires world-bible.md, so
 * create a spoiler-safe bootstrap that points the writer at bounded local canon.
 */

async function listUniverses(sourceWorldId: string): Promise<StoryUniverse[]> {
  const root = path.resolve("worlds");
  const entries = await readdir(root).catch(() => []);
  const items: StoryUniverse[] = [];
  for (const id of entries.filter(x => /^[a-z0-9][a-z0-9-]*$/i.test(x))) {
    const universe = await readUniverse(id);
    if (universe?.sourceWorldId === sourceWorldId) items.push(universe);
  }
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

interface CanonChapterChunk { chapter: string; chunkIndex: number; start: number; end: number; text: string; }
async function readCanonChapters(sourceWorldId: string): Promise<Array<{ title: string; text: string }>> {
  const index = JSON.parse(await readFile(path.join(worldDir(sourceWorldId), "library", "index.json"), "utf8")) as { chunks?: CanonChapterChunk[] };
  // Chapter labels repeat across volumes. Group contiguous runs, not a Map keyed by title,
  // otherwise distinct "第一章" entries from different volumes collapse into one chapter.
  const groups: Array<{ title: string; rows: CanonChapterChunk[] }> = [];
  for (const chunk of index.chunks ?? []) {
    let group = groups[groups.length - 1];
    if (!group || group.title !== chunk.chapter) {
      group = { title: chunk.chapter, rows: [] };
      groups.push(group);
    }
    group.rows.push(chunk);
  }
  return groups.map(({ title, rows }) => {
    rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
    let text = "";
    let previousEnd = -1;
    for (const chunk of rows) {
      const overlap = previousEnd < 0 ? 0 : Math.max(0, previousEnd - chunk.start);
      text += chunk.text.slice(overlap);
      previousEnd = Math.max(previousEnd, chunk.end);
    }
    return { title, text };
  });
}


/**
 * Story analysis and Corpus Craft require the chapter catalog as well as library chunks.
 * The source catalog is full-book metadata, so write a universe-local copy filtered to
 * the same as-of chapter boundary. Never fall back to the parent's unbounded catalog.
 */
async function writeUniverseAnalysisCatalogSnapshot(sourceWorldId: string, targetDir: string, universeId: string, entryIndex: number): Promise<void> {
  const sourcePath = path.resolve("analysis", sourceWorldId, "chapter-index.json");
  try {
    const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
      schemaVersion?: number; totalLines?: number;
      volumes?: Array<{ volume: number; startLine?: number; endLine?: number; chapterCount?: number; openingChapter?: string; closingChapter?: string; chapters?: Array<Record<string, unknown>> }>;
      chapters?: Array<Record<string, unknown>>;
    };
    const library = JSON.parse(await readFile(path.join(targetDir, "library", "index.json"), "utf8")) as { chunks?: Array<{ chapter: string }> };
    const boundedChapterCount = (library.chunks ?? []).reduce((count, chunk, index, rows) => count + (index === 0 || rows[index - 1]?.chapter !== chunk.chapter ? 1 : 0), 0);
    const safeChapter = (chapter: Record<string, unknown>) => ({
      ...(typeof chapter.sequenceInVolume === "number" ? { sequenceInVolume: chapter.sequenceInVolume } : {}),
      ...(typeof chapter.printedNumber === "number" || chapter.printedNumber === null ? { printedNumber: chapter.printedNumber } : {}),
      title: String(chapter.title ?? ""),
      label: String(chapter.label ?? chapter.title ?? ""),
      ...(typeof chapter.line === "number" ? { line: chapter.line } : {})
    });
    let remaining = Math.min(entryIndex + 1, boundedChapterCount);
    const safeVolumes = (source.volumes ?? []).map(volume => {
      const chapters = (volume.chapters ?? []).slice(0, remaining).map(safeChapter);
      remaining -= chapters.length;
      if (!chapters.length) return null;
      const lastLine = [...chapters].reverse().find(chapter => typeof chapter.line === "number")?.line;
      return {
        volume: volume.volume,
        ...(typeof volume.startLine === "number" ? { startLine: volume.startLine } : {}),
        ...(typeof lastLine === "number" ? { endLine: lastLine } : {}),
        chapterCount: chapters.length,
        openingChapter: chapters[0]!.title,
        closingChapter: chapters[chapters.length - 1]!.title,
        chapters
      };
    }).filter((volume): volume is NonNullable<typeof volume> => volume !== null);
    const safeChapters = (source.chapters ?? []).slice(0, entryIndex + 1).map(safeChapter);
    const retainedLines = [
      ...safeVolumes.flatMap(volume => volume.chapters.map(chapter => chapter.line ?? 0)),
      ...safeChapters.map(chapter => chapter.line ?? 0)
    ];
    const totalLines = Math.max(1, ...retainedLines);
    const snapshot = {
      ...(typeof source.schemaVersion === "number" ? { schemaVersion: source.schemaVersion } : {}),
      totalLines,
      ...(safeVolumes.length ? { volumes: safeVolumes } : {}),
      ...(!safeVolumes.length && safeChapters.length ? { chapters: safeChapters } : {})
    };
    if (!safeVolumes.length && !safeChapters.length) return;
    const directory = path.resolve("analysis", universeId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "chapter-index.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

/**
 * original.txt is immutable source canon. Prefer a copy-on-write reflink so
 * branches share physical blocks without sharing a mutable inode. If the
 * filesystem cannot clone, keep the ordinary copy produced by cp().
 */
async function cloneOriginalCanon(sourceDir: string, targetDir: string): Promise<boolean> {
  const source = path.join(sourceDir, "original.txt");
  const target = path.join(targetDir, "original.txt");
  try {
    const info = await stat(source);
    if (!info.isFile()) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const temporary = target + ".reflink-" + process.pid;
  try {
    await copyFile(source, temporary, fsConstants.COPYFILE_FICLONE_FORCE);
    await rename(temporary, target);
    return true;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException).code;
    if (["EXDEV", "EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL"].includes(code ?? "")) return false;
    throw error;
  }
}

async function writeUniverseLibrarySnapshot(sourceWorldId: string, targetDir: string, universeId: string, entryIndex: number): Promise<void> {
  const sourceIndexPath = path.join(worldDir(sourceWorldId), "library", "index.json");
  const source = JSON.parse(await readFile(sourceIndexPath, "utf8")) as {
    schemaVersion: number; createdAt: string; updatedAt: string;
    chunks: Array<{ chapter: string; [key: string]: unknown }>;
  };
  // Use contiguous chapter occurrences, not distinct title strings: volume titles can repeat.
  let chapterOccurrence = -1;
  let previousTitle: string | undefined;
  const chunks = source.chunks.filter(chunk => {
    if (chunk.chapter !== previousTitle) {
      chapterOccurrence++;
      previousTitle = chunk.chapter;
    }
    return chapterOccurrence <= entryIndex;
  });
  const snapshot = {
    schemaVersion: source.schemaVersion,
    worldId: universeId,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    chunks
  };
  const libraryDir = path.join(targetDir, "library");
  await mkdir(libraryDir, { recursive: true });
  await writeFile(path.join(libraryDir, "index.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

app.get("/api/worlds/:worldId/source-chapters", async (req, res) => {
  try {
    const sourceId = worldIdOf(req.params.worldId); assertInsideWorld(sourceId);
    const universe = await readUniverse(sourceId);
    if (universe) return void res.status(409).json({ error: "章节目录应从原文项目读取。" });
    const chapters = await readCanonChapters(sourceId);
    res.json({ chapters: chapters.map(({ title }, index) => ({ id: index, title, label: String(index + 1).padStart(4, "0") + " · " + title })) });
  } catch (error) { sendError(res, error); }
});

app.get("/api/worlds/:worldId/universes", async (req, res) => {
  try {
    const sourceId = worldIdOf(req.params.worldId); assertInsideWorld(sourceId);
    const sourceUniverse = await readUniverse(sourceId);
    const rootSourceId = sourceUniverse?.sourceWorldId ?? sourceId;
    const universes = await listUniverses(rootSourceId);
    res.json({ sourceWorldId: rootSourceId, universes });
  } catch (error) { sendError(res, error); }
});

app.patch("/api/worlds/:worldId/universe-archive", async (req, res) => {
  let release: (() => void) | null = null;
  try {
    const lockId = worldIdOf(req.params.worldId);
    await serializeWorld(lockId, async () => {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    release = acquireWorldMutation(id);
    if (!release) return void res.status(409).json({ error: "当前宇宙正在执行创建、分叉或归档操作，请稍后重试。" });
    const universe = await readUniverse(id);
    if (!universe) return void res.status(409).json({ error: "原文项目不能归档为故事宇宙。" });
    const archive = req.body?.archived === true;
    if (knowledgeBuilds.has(id)) return void res.status(409).json({ error: "当前宇宙正在构建知识资料，完成后再归档或恢复。" });
    const runs = await listRuns(id);
    if (runs.some(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"))) {
      return void res.status(409).json({ error: "当前宇宙仍有章节正在生成，结束后再归档或恢复。" });
    }
    const updated: StoryUniverse = { ...universe, ...(archive ? { archivedAt: new Date().toISOString() } : { archivedAt: undefined }) };
    if (!archive) delete updated.archivedAt;
    const tempPath = path.join(worldDir(id), "universe.json.tmp");
    await writeFile(tempPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
    await rename(tempPath, path.join(worldDir(id), "universe.json"));
    res.json({ universe: updated });
    });
  } catch (error) { sendError(res, error); }
  finally { releaseWorldMutation(release); }
});

app.post("/api/worlds/:worldId/universes", async (req, res) => {
  let stagingPath: string | null = null;
  let createdUniverseId: string | null = null;
  try {
    const lockId = worldIdOf(req.params.worldId);
    await serializeWorld(lockId, async () => {
    const sourceId = worldIdOf(req.params.worldId); assertInsideWorld(sourceId);
    const sourceUniverse = await readUniverse(sourceId);
    if (sourceUniverse) return void res.status(409).json({ error: "当前版本的新建入口只从原文项目创建独立宇宙；从已有宇宙的历史时点分叉将在后续版本提供。" });
    const rootSourceId = sourceId;
    const sourceDir = worldDir(rootSourceId);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const entryChapter = typeof req.body?.entryChapter === "string" ? req.body.entryChapter.trim() : "";
    const entryChapterIndex = req.body?.entryChapterIndex;
    const brief = typeof req.body?.brief === "string" ? req.body.brief.trim() : "";
    const type = typeof req.body?.type === "string" ? req.body.type : "free";
    const allowedTypes = ["mainline", "side-story", "character", "parallel", "free"];
    if (!name || name.length > 80) return void res.status(400).json({ error: "宇宙名称必填，且不能超过 80 个字符。" });
    if (!entryChapter || entryChapter.length > 160) return void res.status(400).json({ error: "必须指定原文起始章节（章节标题或编号）。" });
    if (!allowedTypes.includes(type)) return void res.status(400).json({ error: "Invalid universe type." });
    await readFile(path.join(sourceDir, "world-bible.md"), "utf8");
    const canonChapters = await readCanonChapters(rootSourceId);
    if (!Number.isSafeInteger(entryChapterIndex) || entryChapterIndex < 0 || entryChapterIndex >= canonChapters.length) {
      return void res.status(400).json({ error: "必须通过章节目录提供有效的章节索引，不能只提交可能重复的章节标题。" });
    }
    const selectedIndex = entryChapterIndex as number;
    const selectedChapter = canonChapters[selectedIndex];
    if (!selectedChapter?.text.trim() || selectedChapter.title !== entryChapter) return void res.status(400).json({ error: "所选章节索引、标题或正文不匹配，请刷新原文目录后重试。" });
    // 起点前情属于原著只读背景，不是新宇宙已发生的续写事实。
    const originContext = buildUniverseOriginContext(canonChapters, selectedIndex);
    const id = "u-" + randomUUID().replace(/-/g, "").slice(0, 16);
    createdUniverseId = id;
    const targetDir = worldDir(id);
    const stagingDir = path.join(path.resolve("worlds"), ".staging-" + id);
    stagingPath = stagingDir;
    await mkdir(stagingDir, { recursive: true });
    // 只复制原文只读资产和基础世界资料；所有派生状态、计划、输出与运行记录从空白开始。
    await cp(sourceDir, stagingDir, {
      recursive: true,
      filter: source => {
        return shouldCopyUniverseAsset(path.relative(sourceDir, source));
      }
    });
    await cloneOriginalCanon(sourceDir, stagingDir);
    // novel.db 是原著分析只读快照的初期副本；重置其世界身份，防止数据库身份校验误认为属于源项目。
    rebindKnowledgeDatabase(path.join(stagingDir, "novel.db"), id);
    const knowledgePath = path.join(stagingDir, "novel.db");
    if (!existsSync(knowledgePath)) throw new Error("原著 novel.db 不存在，无法建立无未来剧情泄漏的历史宇宙。请先完成原著索引与知识库构建。");
    const sourceDb = new DatabaseSync(knowledgePath);
    let entryRecord: { chapter_id:string; ordinal:number } | undefined;
    try {
      const chapterCount = Number((sourceDb.prepare("SELECT COUNT(*) AS count FROM novel_chapters").get() as {count:number}).count);
      if (chapterCount !== canonChapters.length) throw new Error("原文目录与 novel.db 章节数量不一致，拒绝猜测章节映射。请重新导入并构建索引。");
      entryRecord = sourceDb.prepare("SELECT chapter_id,ordinal FROM novel_chapters ORDER BY ordinal LIMIT 1 OFFSET ?").get(selectedIndex) as {chapter_id:string;ordinal:number} | undefined;
    } finally { sourceDb.close(); }
    if (!entryRecord?.chapter_id || !Number.isSafeInteger(Number(entryRecord.ordinal))) throw new Error("无法将所选章节映射到 novel.db 的稳定 chapter_id，已终止创建。");
    const entryChapterId = entryRecord.chapter_id;
    const entryOrdinal = restrictKnowledgeDatabaseToEntry(knowledgePath, id, entryChapter, entryChapterId);
    if (entryOrdinal !== Number(entryRecord.ordinal)) throw new Error("章节起点 ordinal 校验失败，已终止创建。");
    const universe: StoryUniverse = {
      id, sourceWorldId: rootSourceId, name, type, entryChapter, entryChapterId, entryChapterIndex: selectedIndex, entryOrdinal, brief,
      createdAt: new Date().toISOString()
    };
    await writeFile(path.join(stagingDir, "universe.json"), JSON.stringify(universe, null, 2) + "\n", "utf8");
    await writeFile(path.join(stagingDir, "world-bible.md"), buildUniverseWorldBible(universe), "utf8");
    await writeFile(path.join(stagingDir, "source-canon.json"), JSON.stringify({ sourceWorldId: rootSourceId, readOnly: true }, null, 2) + "\n", "utf8");
    await writeFile(path.join(stagingDir, "universe-entry.md"), selectedChapter.text + "\n", "utf8");
    await writeFile(path.join(stagingDir, "universe-origin-context.md"), originContext + "\n", "utf8");
    await writeUniverseLibrarySnapshot(rootSourceId, stagingDir, id, selectedIndex);
    await writeUniverseAnalysisCatalogSnapshot(rootSourceId, stagingDir, id, selectedIndex);
    await writeFile(path.join(stagingDir, "source-canon-as-of.json"), JSON.stringify({ sourceWorldId: rootSourceId, entryChapter, entryChapterId, entryChapterIndex: selectedIndex, entryOrdinal, policy: "chapter-scoped-evidence-only", fullBookAggregates: "excluded" }, null, 2) + "\n", "utf8");
    await rename(stagingDir, targetDir);
    const knowledgeBuild = req.body?.buildKnowledge === false ? null : await serializeWorld(id, () => startKnowledgeBuild(id));
    res.status(201).json({ universe, ...(knowledgeBuild ? { knowledgeBuild } : {}) });
    });
  } catch (error) {
    if (stagingPath) await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
    if (createdUniverseId && /^u-[a-f0-9]{16}$/.test(createdUniverseId)) {
      await Promise.all([
        rm(worldDir(createdUniverseId), { recursive: true, force: true }),
        rm(path.resolve(".output", createdUniverseId), { recursive: true, force: true }),
        rm(path.resolve("analysis", createdUniverseId), { recursive: true, force: true })
      ]).catch(() => undefined);
    }
    sendError(res, error);
  }
});

app.get("/api/worlds/:worldId/forkable-chapters", async (req, res) => {
  try {
    const parentId = worldIdOf(req.params.worldId); assertInsideWorld(parentId);
    if (!(await readUniverse(parentId))) return void res.status(409).json({ error: "只能列出故事宇宙中的可分叉章节。" });
    const runs = (await listRuns(parentId)).filter(run => run.kind === "chapter" && run.status === "completed" && run.outputDir && run.chapterPath);
    const root = path.resolve(".output", parentId) + path.sep;
    const chapters: Array<{ id: string; title: string; createdAt: string }> = [];
    for (const run of runs) {
      const outputDir = path.resolve(run.outputDir!);
      const chapterPath = path.resolve(run.chapterPath!);
      if (!outputDir.startsWith(root) || !chapterPath.startsWith(outputDir + path.sep)) continue;
      try {
        const state = validateStoryState(JSON.parse(await readFile(path.join(outputDir, "08-state-update.json"), "utf8")));
        if (state.worldId !== parentId) continue;
        const chapter = await readFile(chapterPath, "utf8");
        const title = chapter.split("\n").map(line => line.trim()).find(Boolean) || "未命名章节";
        chapters.push({ id: run.id, title: title.slice(0, 120), createdAt: run.createdAt });
      } catch { /* 不具备可恢复状态快照的旧章节不作为分叉入口。 */ }
    }
    chapters.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ chapters });
  } catch (error) { sendError(res, error); }
});

app.post("/api/worlds/:worldId/universes/fork", async (req, res) => {
  let createdUniverseId: string | null = null;
  let forkStagingPath: string | null = null;
  let release: (() => void) | null = null;
  try {
    const lockId = worldIdOf(req.params.worldId);
    await serializeWorld(lockId, async () => {
    const parentId = worldIdOf(req.params.worldId); assertInsideWorld(parentId);
    release = acquireWorldMutation(parentId);
    if (!release) return void res.status(409).json({ error: "当前宇宙正在执行创建、分叉或归档操作，请稍后重试。" });
    const parent = await readUniverse(parentId);
    if (!parent) return void res.status(409).json({ error: "只能从已有故事宇宙创建分叉。" });
    if (parent.archivedAt) return void res.status(409).json({ error: "已归档的故事宇宙不能继续分叉，请先恢复。" });
    if (knowledgeBuilds.has(parentId)) return void res.status(409).json({ error: "当前宇宙正在构建知识资料，完成后再分叉。" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const chapterRunId = recordId(req.body?.chapterRunId);
    if (!name || name.length > 80) return void res.status(400).json({ error: "分支名称必填，且不能超过 80 个字符。" });
    const runs = await listRuns(parentId);
    if (runs.some(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"))) return void res.status(409).json({ error: "当前宇宙仍有章节正在生成，请等待任务结束后再分叉。" });
    const forkRun = runs.find(run => run.id === chapterRunId && run.kind === "chapter" && run.status === "completed" && run.chapterPath && run.outputDir);
    if (!forkRun?.outputDir || !forkRun.chapterPath) return void res.status(404).json({ error: "指定章节不是已完成的章节，无法从这里分叉。" });
    const parentOutputRoot = path.resolve(".output", parentId) + path.sep;
    const forkOutputDir = path.resolve(forkRun.outputDir);
    const forkChapterPath = path.resolve(forkRun.chapterPath);
    if (!forkOutputDir.startsWith(parentOutputRoot) || !forkChapterPath.startsWith(forkOutputDir + path.sep)) {
      return void res.status(409).json({ error: "章节产物路径不属于当前宇宙，拒绝分叉。" });
    }
    const statePath = path.join(forkOutputDir, "08-state-update.json");
    let state: StoryState;
    try {
      const parsed = validateStoryState(JSON.parse(await readFile(statePath, "utf8")));
      if (parsed.worldId !== parentId) throw new Error("Story State snapshot belongs to another universe.");
      state = parsed;
    } catch {
      return void res.status(409).json({ error: "该章节缺少完整的 Story State 快照，无法安全恢复历史时点。请从更新的、具备状态快照的章节分叉。" });
    }
    const arcSnapshot = await readFile(path.join(forkOutputDir, "00-story-arc.md"), "utf8").catch(() => "");
    const id = "u-" + randomUUID().replace(/-/g, "").slice(0, 16);
    createdUniverseId = id;
    const targetDir = worldDir(id);
    const stagingDir = path.join(path.resolve("worlds"), ".staging-" + id);
    forkStagingPath = stagingDir;
    await mkdir(stagingDir, { recursive: true });
    const parentDir = worldDir(parentId);
    await cp(parentDir, stagingDir, {
      recursive: true,
      filter: source => {
        return shouldCopyUniverseAsset(path.relative(parentDir, source));
      }
    });
    await cloneOriginalCanon(parentDir, stagingDir);
    rebindKnowledgeDatabase(path.join(stagingDir, "novel.db"), id);
    restrictKnowledgeDatabaseToEntry(path.join(stagingDir, "novel.db"), id, parent.entryChapter, parent.entryChapterId);
    const universe: StoryUniverse = {
      id, sourceWorldId: parent.sourceWorldId, name, type: parent.type,
      entryChapter: parent.entryChapter,
      entryChapterId: parent.entryChapterId,
      entryChapterIndex: parent.entryChapterIndex,
      entryOrdinal: parent.entryOrdinal,
      brief: parent.brief,
      parentUniverseId: parent.id, forkPoint: forkRun.id,
      createdAt: new Date().toISOString()
    };
    await writeFile(path.join(stagingDir, "universe.json"), JSON.stringify(universe, null, 2) + "\n", "utf8");
    await writeFile(path.join(stagingDir, "world-bible.md"), buildUniverseWorldBible(universe), "utf8");
    await writeFile(path.join(stagingDir, "source-canon.json"), JSON.stringify({ sourceWorldId: parent.sourceWorldId, readOnly: true }, null, 2) + "\n", "utf8");
    const parentCanonChapters = await readCanonChapters(parent.sourceWorldId);
    const matchingParentIndexes = parentCanonChapters.flatMap((chapter, index) => chapter.title === parent.entryChapter ? [index] : []);
    const parentEntryIndex = Number.isSafeInteger(parent.entryChapterIndex)
      ? parent.entryChapterIndex!
      : matchingParentIndexes.length === 1 ? matchingParentIndexes[0]! : -1;
    if (parentEntryIndex < 0 || parentEntryIndex >= parentCanonChapters.length) throw new Error("父宇宙的原文起点无法通过稳定章节索引唯一定位，拒绝创建可能泄漏未来剧情的分支。");
    await writeUniverseLibrarySnapshot(parent.sourceWorldId, stagingDir, id, parentEntryIndex);
    await writeUniverseAnalysisCatalogSnapshot(parent.sourceWorldId, stagingDir, id, parentEntryIndex);

    const forkState = rebaseStoryState(state, parentId, id);
    await writeFile(path.join(stagingDir, "story-state.json"), JSON.stringify(forkState, null, 2) + "\n", "utf8");
    await loadStoryState(path.join(stagingDir, "story-state.json"), id);
    if (arcSnapshot) await writeFile(path.join(stagingDir, "story-arc.md"), arcSnapshot, "utf8");

    // 复制分叉点及其之前的已完成章节产物和运行索引，重写所有路径指向子宇宙。
    const orderedHistory = runs.filter(run => run.kind === "chapter" && run.status === "completed")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const forkIndex = orderedHistory.findIndex(run => run.id === forkRun.id);
    if (forkIndex < 0) return void res.status(409).json({ error: "无法定位分叉章节在当前宇宙中的顺序。" });
    const history = orderedHistory.slice(0, forkIndex + 1);
    const outputMap = new Map<string, string>();
    for (const historicalRun of history) {
      if (!historicalRun.outputDir) continue;
      const sourceOutput = path.resolve(historicalRun.outputDir);
      if (!sourceOutput.startsWith(parentOutputRoot)) continue;
      const targetOutput = path.resolve(".output", id, path.basename(sourceOutput));
      await mkdir(path.dirname(targetOutput), { recursive: true });
      await cp(sourceOutput, targetOutput, { recursive: true });
      // Rebase every copied chapter-time state snapshot as well as the run index.
      // Otherwise the child can display the chapter but cannot safely fork from it:
      // forkable-chapters correctly rejects snapshots still owned by the parent world.
      const copiedStatePath = path.join(targetOutput, "08-state-update.json");
      try {
        const copiedState = validateStoryState(JSON.parse(await readFile(copiedStatePath, "utf8")));
        if (copiedState.worldId !== parentId) throw new Error("Copied chapter state belongs to another universe.");
        await writeFile(copiedStatePath, JSON.stringify(rebaseStoryState(copiedState, parentId, id), null, 2) + "\n", "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      outputMap.set(sourceOutput, targetOutput);
    }
    for (const historicalRun of history) {
      if (!historicalRun.outputDir || !historicalRun.chapterPath) continue;
      const forkedRun = remapForkedRun(historicalRun, id, outputMap);
      if (forkedRun) await saveRun(forkedRun);
    }
    await rename(stagingDir, targetDir);
    const knowledgeBuild = req.body?.buildKnowledge === false ? null : await serializeWorld(id, () => startKnowledgeBuild(id));
    res.status(201).json({ universe, forkedAt: forkRun.id, ...(knowledgeBuild ? { knowledgeBuild } : {}) });
    });
  } catch (error) {
    // Failed fork must not leave a half-visible universe or orphaned copied chapters.
    const failedId = createdUniverseId ?? "";
    if (failedId && /^u-[a-f0-9]{16}$/.test(failedId)) {
      await Promise.all([
        rm(worldDir(failedId), { recursive: true, force: true }),
        rm(path.resolve(".output", failedId), { recursive: true, force: true }),
        rm(path.resolve("analysis", failedId), { recursive: true, force: true }),
        rm(path.join(path.resolve("worlds"), ".staging-" + failedId), { recursive: true, force: true })
      ]).catch(() => undefined);
    } else if (forkStagingPath) {
      await rm(forkStagingPath, { recursive: true, force: true }).catch(() => undefined);
    }
    sendError(res, error);
  } finally { releaseWorldMutation(release); }
});

// ── 同一世界下的独立 Story Unit 资料管理 ────────────────────
app.get("/api/worlds/:worldId/story-units", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const units = await listStoredStoryUnits(worldDir(id), id);
    res.json({ storyUnits: units.map(unit => validateStoryUnit(unit, id)) });
  } catch (error) { sendError(res, error); }
});
app.get("/api/worlds/:worldId/story-units/:storyUnitId", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const unitId = recordId(req.params.storyUnitId);
    const unit = await getStoredStoryUnit(worldDir(id), id, unitId);
    if (!unit) return void res.status(404).json({ error: "Story Unit not found." });
    res.json({ storyUnit: validateStoryUnit(unit, id) });
  } catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-units/generate", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    if (activeStoryExecutions.has(id)) return void res.status(409).json({ error: "完整故事执行期间不能创建或重写故事单元。" });
    await serializeWorld(id, async () => {
      const dir = worldDir(id);
      const worldBible = await readFile(path.join(dir, "world-bible.md"), "utf8");
      const state = await loadStoryState(path.join(dir, "story-state.json"), id);
      const previousId = typeof req.body?.storyUnitId === "string" ? recordId(req.body.storyUnitId) : undefined;
      const previousRaw = previousId ? await getStoredStoryUnit(dir, id, previousId) : undefined;
      if (previousId && !previousRaw) throw Object.assign(new Error("Story Unit not found."), { status: 404 });
      const previous = previousRaw ? validateStoryUnit(previousRaw, id) : undefined;
      const query = [state.currentPosition, ...state.plotThreads.map(x => x.title), ...state.characters.slice(0, STORY_ANALYSIS_QUERY_CHARACTERS).map(x => x.name)].join("\n");
      const storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(dir, id), query);
      const brief = typeof req.body?.brief === "string" ? req.body.brief.trim().slice(0, 8000) : "";
      const model = typeof req.body?.model === "string" ? req.body.model : undefined;
      const generated = await generateStoryUnit({ worldId: id, worldBible, state, storyAnalysisContext, previous, brief, model });
      let unit: Record<string, unknown>;
      if (previous) {
        unit = { ...generated, id: previous.id };
        await saveStoredStoryUnit(dir, unit as never);
      } else {
        unit = await createStoredStoryUnit(dir, generated as never);
      }
      res.json({ storyUnit: validateStoryUnit(unit, id) });
    });
  } catch (error) { sendError(res, error); }
});

// ── 完整故事单元（果实/场景/人物群像/完整因果线） ────────────
function storyUnitPath(id: string): string { return path.join(worldDir(id), "story-unit.json"); }
app.get("/api/worlds/:worldId/story-unit", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    try {
      const unit = validateStoryUnit(JSON.parse(await readFile(storyUnitPath(id), "utf8")), id);
      res.json({ storyUnit: unit });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return void res.json({ storyUnit: null });
      throw error;
    }
  } catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-unit/generate", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    if (activeStoryExecutions.has(id)) return void res.status(409).json({ error: "完整故事执行期间不能重写故事单元设计。" });
    await serializeWorld(id, async () => {
      const dir = worldDir(id);
      const worldBible = await readFile(path.join(dir, "world-bible.md"), "utf8");
      const state = await loadStoryState(path.join(dir, "story-state.json"), id);
      const previous = await readFile(storyUnitPath(id), "utf8").then(raw => validateStoryUnit(JSON.parse(raw), id)).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
      const query = [state.currentPosition, ...state.plotThreads.map(x => x.title), ...state.characters.slice(0, STORY_ANALYSIS_QUERY_CHARACTERS).map(x => x.name)].join("\n");
      const storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(dir, id), query);
      const brief = typeof req.body?.brief === "string" ? req.body.brief.trim().slice(0, 8000) : "";
      const model = typeof req.body?.model === "string" ? req.body.model : undefined;
      const unit = await generateStoryUnit({ worldId: id, worldBible, state, storyAnalysisContext, previous, brief, model });
      const target = storyUnitPath(id);
      const temporary = target + "." + randomUUID() + ".tmp";
      await writeFile(temporary, JSON.stringify(unit, null, 2) + "\n", "utf8");
      await rename(temporary, target);
      res.json({ storyUnit: unit });
    });
  } catch (error) { sendError(res, error); }
});


function appendStoryExecutionEvent(task: StoryExecution, event: StoryExecution["events"][number]): StoryExecution {
  return { ...task, events: [...(task.events ?? []), event].slice(-500) };
}
const activeStoryExecutions = new Map<string, Promise<void>>();
const storyExecutionReservations = new Set<string>();
function storyExecutionUnitPath(worldId: string, storyUnitId?: string): string {
  return storyUnitId
    ? path.join(worldDir(worldId), ".story-units", recordId(storyUnitId) + ".json")
    : path.join(worldDir(worldId), "story-unit.json");
}
async function loadExecutionStoryUnit(worldId: string, storyUnitId?: string): Promise<Awaited<ReturnType<typeof generateStoryUnit>>> {
  const dir = worldDir(worldId);
  if (storyUnitId) {
    const unit = await getStoredStoryUnit(dir, worldId, storyUnitId);
    if (!unit) throw Object.assign(new Error("Story Unit not found: " + storyUnitId), { status: 404 });
    return validateStoryUnit(unit, worldId);
  }
  return validateStoryUnit(JSON.parse(await readFile(storyExecutionUnitPath(worldId), "utf8")), worldId);
}
async function saveExecutionStoryUnit(unit: Awaited<ReturnType<typeof generateStoryUnit>>): Promise<void> {
  if (unit.id) {
    await saveStoredStoryUnit(worldDir(unit.worldId), unit as Awaited<ReturnType<typeof generateStoryUnit>> & {id:string;title:string;updatedAt:string});
    return;
  }
  const target = storyExecutionUnitPath(unit.worldId);
  const temporary = target + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(unit, null, 2) + "\n", "utf8");
  await rename(temporary, target);
}

/** Run one ordinary chapter through the existing CLI pipeline and its existing quality/state gates. */
async function executeStoryUnitChapter(worldId: string, previousChapterPath: string | undefined, brief: string, model?: string, storyUnitId?: string, onRunStarted?: (run: WorkbenchRun) => Promise<void>): Promise<WorkbenchRun> {
  const dir = worldDir(worldId);
  const universe = await readUniverse(worldId);
  if (universe?.archivedAt) throw new Error("当前故事宇宙已归档，不能继续完整故事执行。");
  const universeEntryPath = universe ? path.join(dir, "universe-entry.md") : undefined;
  const now = new Date().toISOString();
  const runId = randomUUID();
  const outputDir = path.resolve(".output", worldId, "chapter-" + runId);
  const run: WorkbenchRun = {
    id: runId, worldId, ...(storyUnitId ? {storyUnitId} : {}), kind: "chapter", status: "queued", createdAt: now, updatedAt: now,
    outputDir, ...(previousChapterPath ? { previousChapterPath } : {})
  };
  await saveRun(run);
  await onRunStarted?.(run);
  const mode = previousChapterPath ? "continuation" : "derivative";
  const args = [
    ...buildCliEntryArgs(["write"]), "--world", worldId, "--mode", mode,
    "--state-file", storyUnitId ? path.join(dir, ".story-units", storyUnitId, "story-state.json") : path.join(dir, "story-state.json"),
    "--story-unit-file", storyExecutionUnitPath(worldId, storyUnitId),
    "--story-arc-file", storyUnitId ? path.join(dir, ".story-units", storyUnitId, "story-arc.md") : path.join(dir, "story-arc.md"),
    ...(previousChapterPath ? ["--source", previousChapterPath] : universeEntryPath ? ["--source", universeEntryPath] : []),
    ...(!previousChapterPath && universe ? ["--context", path.join(dir, "universe-origin-context.md")] : []),
    "--brief", brief, ...(model ? ["--model", model] : []),
    "--max-words", "3000", "--resume-dir", outputDir
  ];
  await mkdir(outputDir, { recursive: true });
  await saveRun({ ...run, status: "running", updatedAt: new Date().toISOString() });
  const result = await new Promise<{ code: number | null; output: string; errors: string }>(resolveResult => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "", settled = false;
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { errors += chunk; });
    child.on("error", error => { if (!settled) { settled = true; resolveResult({ code: null, output, errors: errors + error.message }); } });
    child.on("close", code => { if (!settled) { settled = true; resolveResult({ code, output, errors }); } });
  });
  const saved = result.output.match(/Saved chapter:\s*(.+)/)?.[1]?.trim();
  const chapterPath = saved ? path.resolve(saved) : undefined;
  const outputRoot = path.resolve(".output", worldId) + path.sep;
  let finalChapterExists = false, qualityPassed = false, stateCommitted = false;
  if (chapterPath && chapterPath.startsWith(outputRoot)) {
    try { finalChapterExists = (await readFile(chapterPath, "utf8")).trim().length > 0; } catch { /* no final chapter */ }
  }
  try { qualityPassed = (JSON.parse(await readFile(path.join(outputDir, "09-quality-summary.json"), "utf8")) as {status?:string}).status === "passed"; } catch { /* missing gate */ }
  try {
    const update = JSON.parse(await readFile(path.join(outputDir, "08-state-update.json"), "utf8")) as {worldId?:string};
    stateCommitted = update.worldId === worldId && /Story state automatically updated:/i.test(result.output);
  } catch { /* missing state commit */ }
  const completed = result.code === 0 && finalChapterExists && qualityPassed && stateCommitted;
  await Promise.all([
    writeFile(path.join(outputDir, "process.stdout.log"), result.output, "utf8"),
    writeFile(path.join(outputDir, "process.stderr.log"), result.errors, "utf8"),
    writeFile(path.join(outputDir, "process-result.json"), JSON.stringify({exitCode:result.code,chapterPath:chapterPath??null,finalChapterExists,qualityPassed,stateCommitted,completed},null,2)+"\n","utf8")
  ]);
  const finished: WorkbenchRun = {
    ...run, status: completed ? "completed" : "failed", updatedAt: new Date().toISOString(),
    ...(chapterPath && finalChapterExists ? {chapterPath} : {}),
    ...(!completed ? {error:("章节流程未完成：exit="+result.code+"；正文="+finalChapterExists+"；终审="+qualityPassed+"；状态提交="+stateCommitted+"\n"+(result.errors||result.output).slice(-5000))} : {})
  };
  await saveRun(finished);
  return finished;
}


async function assessStoryExecutionCheckpoint(
  worldId: string, taskInput: StoryExecution, unitInput: Awaited<ReturnType<typeof generateStoryUnit>>,
  checkpoint: StoryExecution["completedChapters"][number]
): Promise<{task:StoryExecution;unit:Awaited<ReturnType<typeof generateStoryUnit>>;terminal:boolean}> {
  const dir = worldDir(worldId);
  const chapterPath = path.resolve(checkpoint.chapterPath);
  const outputRoot = path.resolve(".output", worldId) + path.sep;
  if (!chapterPath.startsWith(outputRoot)) {
    throw new Error("故事执行检查点的章节路径不属于当前世界输出目录，拒绝读取外部或其他宇宙的正文。");
  }
  const chapterText = await readFile(chapterPath, "utf8");
  const chapterTitle = chapterText.split("\n").find(line => /^#\s+/.test(line))?.replace(/^#\s+/,"").trim() || "章节";
  const state = await loadStoryState(taskInput.storyUnitId ? path.join(dir, ".story-units", taskInput.storyUnitId, "story-state.json") : path.join(dir, "story-state.json"), worldId);
  const assessment = await assessStoryUnitProgress({
    unit: unitInput, chapterText, chapterTitle, completedChapterCount: taskInput.completedChapters.length,
    storyState: state, model: taskInput.model
  });
  const assessedAt = new Date().toISOString();
  const latestTask = await getStoryExecution(worldId, taskInput.id);
  let task: StoryExecution = latestTask
    ? { ...taskInput, pauseRequested: latestTask.pauseRequested, cancelRequested: latestTask.cancelRequested }
    : taskInput;
  task = appendStoryExecutionEvent({
    ...task, currentRunId: undefined, lastAssessment: assessment.rationale, nextDirection: assessment.nextDirection,
    idleChapterCount: assessment.nextDirection === unitInput.execution.nextDirection &&
      assessment.unresolvedCoreThreads.join("|") === unitInput.execution.lastUnresolvedCoreThreads.join("|")
      ? task.idleChapterCount + 1 : 0,
    updatedAt: assessedAt
  }, { at: assessedAt, type: "assessment", message: assessment.rationale.slice(0, 1200) });
  const naturallyComplete = isStoryUnitNaturallyComplete(assessment);
  const revisedSpine = assessment.revisedStorySpine.length >= 4
    ? assessment.revisedStorySpine.map(beat => {
        const previousBeat = unitInput.storySpine.find(item => item.title === beat.title);
        return previousBeat?.status === "completed" ? { ...beat, status: "completed" as const } : beat;
      })
    : unitInput.storySpine;
  const characterArcHistory = [
    ...(unitInput.execution.characterArcHistory ?? []),
    ...assessment.characterArcUpdates.filter(update => update.observedChange.trim()).map(update => ({
      chapterId: checkpoint.runId, name: update.name, observedChange: update.observedChange,
      futurePossibilities: update.futurePossibilities, recordedAt: assessedAt
    }))
  ].slice(-200);
  const unit = {
    ...unitInput, storySpine: revisedSpine, updatedAt: assessedAt,
    execution: {
      ...unitInput.execution, status: naturallyComplete ? "completed" as const : "in_progress" as const,
      lastAssessedChapterId: checkpoint.runId,
      lastUnresolvedCoreThreads: assessment.unresolvedCoreThreads,
      lastAssessment: assessment.rationale, nextDirection: assessment.nextDirection,
      characterArcHistory,
      assessedAt, ...(naturallyComplete ? {completedAt: assessedAt} : {})
    }
  };
  await saveExecutionStoryUnit(unit);
  if (naturallyComplete) {
    task = appendStoryExecutionEvent({ ...task, status: "completed", completedAt: assessedAt, updatedAt: assessedAt, nextDirection: "故事已自然收束。" }, { at: assessedAt, type: "completed", message: "完整故事达到自然收束条件" });
    await saveStoryExecution(task);
    return {task,unit,terminal:true};
  }
  if (task.idleChapterCount >= 4) {
    task = appendStoryExecutionEvent({ ...task, status: "stalled", error: "连续章节未推动核心冲突，任务已暂停而非误判为完成。请修订 Story Unit 的下一步方向后恢复。", updatedAt: assessedAt }, { at: assessedAt, type: "stalled", message: "连续章节没有推动故事方向，已暂停等待调整" });
    await saveStoryExecution(task);
    return {task,unit,terminal:true};
  }
  await saveStoryExecution(task);
  return {task,unit,terminal:false};
}

/**
 * Recover the narrow crash window after a chapter run completed but before its
 * story-execution checkpoint was persisted. currentRunId is the durable pointer
 * to that run; never infer ownership from the globally newest chapter.
 */
async function reconcileStoryExecutionCurrentRun(input: StoryExecution): Promise<StoryExecution> {
  if (!input.currentRunId) return input;
  const run = await getRun(input.worldId, input.currentRunId);
  if (run?.kind === "chapter" && run.storyUnitId === input.storyUnitId && run.status === "completed" && run.chapterPath &&
      !input.completedChapters.some(item => item.runId === run.id)) {
    const chapterPath = path.resolve(run.chapterPath);
    const outputRoot = path.resolve(".output", input.worldId) + path.sep;
    if (!chapterPath.startsWith(outputRoot)) {
      throw new Error("中断任务指向的已完成章节不属于当前世界输出目录，拒绝恢复。");
    }
    await readFile(chapterPath, "utf8");
    const checkpoint = { runId: run.id, chapterPath: run.chapterPath, completedAt: run.updatedAt };
    const recoveredAt = new Date().toISOString();
    const recovered = appendStoryExecutionEvent({ ...input, completedChapters: [...input.completedChapters, checkpoint],
      currentRunId: undefined, updatedAt: recoveredAt }, { at: recoveredAt, type: "chapter_completed", message: "恢复时补齐已完成章节检查点", runId: run.id });
    await saveStoryExecution(recovered);
    return recovered;
  }
  const cleared = { ...input, currentRunId: undefined, updatedAt: new Date().toISOString() };
  await saveStoryExecution(cleared);
  return cleared;
}

async function executeStoryUnitTask(initial: StoryExecution): Promise<void> {
  const worldId = initial.worldId;
  let task = initial;
  try {
    task = await reconcileStoryExecutionCurrentRun(task);
    const dir = worldDir(worldId);
    let unit = await loadExecutionStoryUnit(worldId, task.storyUnitId);
    if (task.mode === "complete_story" && unit.execution.status === "completed") {
      task = { ...task, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), nextDirection: "故事已自然收束。" };
      await saveStoryExecution(task); return;
    }
    const universe = await readUniverse(worldId);
    if (universe?.archivedAt) throw new Error("当前故事宇宙已归档。");
    if (universe) await ensureUniverseStoryAnalysis(worldId, universe);
    await readFile(path.join(dir, "world-bible.md"), "utf8");
    const libraryDir = await resolveWorldLibraryDir(worldId, path.resolve("worlds"));
    await readFile(path.join(libraryDir, "index.json"), "utf8");
    const runs = await listRuns(worldId);
    const previous = runs.filter(run => run.kind === "chapter" && (!task.storyUnitId || run.storyUnitId === task.storyUnitId) && run.status === "completed" && run.chapterPath)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    let previousChapterPath = task.completedChapters.at(-1)?.chapterPath
      ? path.resolve(task.completedChapters.at(-1)!.chapterPath)
      : previous?.chapterPath ? path.resolve(previous.chapterPath) : undefined;
    if (previousChapterPath) {
      const outputRoot = path.resolve(".output", worldId) + path.sep;
      if (!previousChapterPath.startsWith(outputRoot)) throw new Error("最近章节正文路径不属于当前故事输出目录，已停止以避免串线。");
      await readFile(previousChapterPath, "utf8");
    }
    task = { ...task, status: "running", startedAt: task.startedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), pauseRequested: false, cancelRequested: false, resumeCount: task.resumeCount + (task.startedAt ? 1 : 0), error: undefined };
    unit = { ...unit, execution: { ...unit.execution, status: "in_progress" } };
    await saveStoryExecution(task); await saveExecutionStoryUnit(unit);
    const pendingAssessment = task.completedChapters.at(-1);
    if (pendingAssessment && unit.execution.lastAssessedChapterId !== pendingAssessment.runId) {
      const recoveredAssessment = await assessStoryExecutionCheckpoint(worldId, task, unit, pendingAssessment);
      task = recoveredAssessment.task; unit = recoveredAssessment.unit;
      if (recoveredAssessment.terminal) return;
    }
    while (true) {
      task = (await getStoryExecution(worldId, task.id)) ?? task;
      if (task.cancelRequested) {
        task = appendStoryExecutionEvent({ ...task, status: "cancelled", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentRunId: undefined }, { at: new Date().toISOString(), type: "cancelled", message: "任务已取消" });
        await saveStoryExecution(task); return;
      }
      if (task.pauseRequested) {
        task = appendStoryExecutionEvent({ ...task, status: "paused", updatedAt: new Date().toISOString(), currentRunId: undefined }, { at: new Date().toISOString(), type: "paused", message: "用户请求暂停，已在章节边界停止" });
        await saveStoryExecution(task); return;
      }
      const nextDirection = unit.execution.nextDirection || "根据当前人物行动与故事因果自然推进，避免重复前章内容。";
      const brief = [
        "这是一个完整故事单元的连续创作。必须紧接上一章已发生的事实、人物位置、认知和未完成行动。",
        "当前故事核心：" + unit.storyCore,
        "本阶段推进方向（可根据正文自然修正，不是机械任务清单）：" + nextDirection,
        "完整故事结局方向：" + unit.endingAndAftermath,
        task.brief
      ].filter(Boolean).join("\n\n");
      const chapterRun = await executeStoryUnitChapter(worldId, previousChapterPath, brief, task.model, task.storyUnitId, async currentRun => {
        task = appendStoryExecutionEvent({ ...task, currentRunId: currentRun.id, updatedAt: new Date().toISOString() }, { at: new Date().toISOString(), type: "chapter_started", message: "开始生成新章节", runId: currentRun.id });
        await saveStoryExecution(task);
      });
      if (chapterRun.status !== "completed" || !chapterRun.chapterPath) {
        const failedAt = new Date().toISOString();
        task = appendStoryExecutionEvent({ ...task, status: "failed", error: "章节未通过现有终审或 Story State 提交门禁。修复该章节后可从最后一个已完成检查点恢复。"+(chapterRun.error?" "+chapterRun.error:""), updatedAt: failedAt, currentRunId: undefined }, { at: failedAt, type: "failed", message: "章节未通过终审或状态提交门禁" });
        await saveStoryExecution(task); return;
      }
      previousChapterPath = chapterRun.chapterPath;
      const completedAt = new Date().toISOString();
      const latestTaskState = await getStoryExecution(worldId, task.id);
      if (latestTaskState) task = { ...task, pauseRequested: latestTaskState.pauseRequested, cancelRequested: latestTaskState.cancelRequested };
      const checkpoint = {runId:chapterRun.id,chapterPath:chapterRun.chapterPath,completedAt};
      task = appendStoryExecutionEvent({ ...task, completedChapters: [...task.completedChapters, checkpoint], currentRunId: undefined, updatedAt: completedAt }, { at: completedAt, type: "chapter_completed", message: "章节通过终审并提交 Story State", runId: chapterRun.id });
      unit = { ...unit, execution: { ...unit.execution, status: "in_progress", completedChapterIds: [...unit.execution.completedChapterIds, chapterRun.id] }, updatedAt: completedAt };
      // Commit the chapter checkpoint before assessment so a failed assessment can be retried on resume.
      await saveStoryExecution(task);
      await saveExecutionStoryUnit(unit);
      const assessed = await assessStoryExecutionCheckpoint(worldId, task, unit, checkpoint);
      task = assessed.task; unit = assessed.unit;
      if (assessed.terminal) return;
      await saveStoryExecution(task);
    }
  } catch (error) {
    task = appendStoryExecutionEvent({ ...task, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString(), currentRunId: undefined }, { at: new Date().toISOString(), type: "failed", message: (error instanceof Error ? error.message : String(error)).slice(0, 1200) });
    await saveStoryExecution(task).catch(() => undefined);
  }
}


async function executeFixedChapterBatch(initial: StoryExecution): Promise<void> {
  let task = initial;
  const worldId = task.worldId;
  try {
    task = await reconcileStoryExecutionCurrentRun(task);
    const dir = worldDir(worldId);
    const universe = await readUniverse(worldId);
    if (universe?.archivedAt) throw new Error("当前故事宇宙已归档。");
    if (universe) await ensureUniverseStoryAnalysis(worldId, universe);
    await readFile(path.join(dir, "world-bible.md"), "utf8");
    const libraryDir = await resolveWorldLibraryDir(worldId, path.resolve("worlds"));
    await readFile(path.join(libraryDir, "index.json"), "utf8");
    const runs = await listRuns(worldId);
    const previous = runs.filter(run => run.kind === "chapter" && run.status === "completed" && run.chapterPath)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    let previousChapterPath = task.completedChapters.at(-1)?.chapterPath
      ? path.resolve(task.completedChapters.at(-1)!.chapterPath)
      : previous?.chapterPath ? path.resolve(previous.chapterPath) : undefined;
    if (previousChapterPath) {
      const outputRoot = path.resolve(".output", worldId) + path.sep;
      if (!previousChapterPath.startsWith(outputRoot)) throw new Error("最近章节正文路径不属于当前故事输出目录，已停止以避免串线。");
      await readFile(previousChapterPath, "utf8");
    }
    task = { ...task, status: "running", startedAt: task.startedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), pauseRequested: false, cancelRequested: false, resumeCount: task.resumeCount + (task.startedAt ? 1 : 0), error: undefined };
    await saveStoryExecution(task);
    // A crash may happen after the final chapter run completes but before the
    // batch task is marked completed. Reconciliation above restores that checkpoint.
    if (task.completedChapters.length >= (task.targetChapterCount ?? 1)) {
      const completedAt = new Date().toISOString();
      task = appendStoryExecutionEvent({ ...task, status: "completed", completedAt, updatedAt: completedAt,
        nextDirection: "本次指定数量的连续章节已完成；不代表完整故事已经结束。" }, { at: completedAt, type: "completed", message: "指定数量的章节已全部完成；不代表完整故事自然收束" });
      await saveStoryExecution(task);
      return;
    }
    while (task.completedChapters.length < (task.targetChapterCount ?? 1)) {
      task = (await getStoryExecution(worldId, task.id)) ?? task;
      if (task.cancelRequested) {
        task = appendStoryExecutionEvent({ ...task, status: "cancelled", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentRunId: undefined }, { at: new Date().toISOString(), type: "cancelled", message: "批量任务已取消" });
        await saveStoryExecution(task); return;
      }
      if (task.pauseRequested) {
        task = appendStoryExecutionEvent({ ...task, status: "paused", updatedAt: new Date().toISOString(), currentRunId: undefined }, { at: new Date().toISOString(), type: "paused", message: "批量任务已暂停" });
        await saveStoryExecution(task); return;
      }
      const chapterNumber = task.completedChapters.length + 1;
      const brief = [
        "这是一个用户指定数量的连续章节任务，第 " + chapterNumber + " / " + task.targetChapterCount + " 章。",
        "严格接续已完成正文和 Story State；本批次数量只控制本次执行章数，不代表完整故事结束。",
        "保持人物、事件和因果连续性，不要为了凑数量注水，也不要提前强行收尾。",
        task.brief
      ].filter(Boolean).join("\n\n");
      const chapterRun = await executeStoryUnitChapter(worldId, previousChapterPath, brief, task.model, task.storyUnitId, async currentRun => {
        task = appendStoryExecutionEvent({ ...task, currentRunId: currentRun.id, updatedAt: new Date().toISOString() }, { at: new Date().toISOString(), type: "chapter_started", message: "批量任务开始生成第 " + (task.completedChapters.length + 1) + " 章", runId: currentRun.id });
        await saveStoryExecution(task);
      });
      if (chapterRun.status !== "completed" || !chapterRun.chapterPath) {
        const failedAt = new Date().toISOString();
        task = appendStoryExecutionEvent({ ...task, status: "failed", error: "第 " + chapterNumber + " 章未通过终审或 Story State 提交门禁。可修复后从已完成检查点恢复。" + (chapterRun.error ? " " + chapterRun.error : ""), updatedAt: failedAt, currentRunId: undefined }, { at: failedAt, type: "failed", message: "第 " + chapterNumber + " 章未通过终审或状态提交门禁" });
        await saveStoryExecution(task); return;
      }
      previousChapterPath = chapterRun.chapterPath;
      const completedAt = new Date().toISOString();
      const latestTask = await getStoryExecution(worldId, task.id);
      if (latestTask) task = { ...task, pauseRequested: latestTask.pauseRequested, cancelRequested: latestTask.cancelRequested };
      task = appendStoryExecutionEvent({ ...task, completedChapters: [...task.completedChapters, {runId:chapterRun.id,chapterPath:chapterRun.chapterPath,completedAt}], currentRunId: undefined, updatedAt: completedAt }, { at: completedAt, type: "chapter_completed", message: "批量章节通过终审并提交 Story State", runId: chapterRun.id });
      await saveStoryExecution(task);
      try {
        const unit = await loadExecutionStoryUnit(worldId, task.storyUnitId);
        await saveExecutionStoryUnit({ ...unit, updatedAt: completedAt, execution: { ...unit.execution, status: unit.execution.status === "completed" ? "completed" : "in_progress", completedChapterIds: unit.execution.completedChapterIds.includes(chapterRun.id) ? unit.execution.completedChapterIds : [...unit.execution.completedChapterIds, chapterRun.id] } });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (task.completedChapters.length >= (task.targetChapterCount ?? 1)) {
        task = { ...task, status: "completed", completedAt, updatedAt: completedAt, nextDirection: "本次指定数量的连续章节已完成；不代表完整故事已经结束。" };
        await saveStoryExecution(task); return;
      }
      await saveStoryExecution(task);
    }
  } catch (error) {
    task = appendStoryExecutionEvent({ ...task, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString(), currentRunId: undefined }, { at: new Date().toISOString(), type: "failed", message: (error instanceof Error ? error.message : String(error)).slice(0, 1200) });
    await saveStoryExecution(task).catch(() => undefined);
  }
}

function startStoryUnitExecution(task: StoryExecution): void {
  if (activeStoryExecutions.has(task.worldId)) return;
  const worker = task.mode === "fixed_batch" ? executeFixedChapterBatch(task) : executeStoryUnitTask(task);
  const promise = worker.finally(() => activeStoryExecutions.delete(task.worldId));
  activeStoryExecutions.set(task.worldId, promise);
}


app.get("/api/worlds/:worldId/story-executions", async (req, res) => {
  try { const id = worldIdOf(req.params.worldId); assertInsideWorld(id); res.json({ executions: await listStoryExecutions(id, typeof req.query.storyUnitId === "string" ? recordId(req.query.storyUnitId) : undefined) }); }
  catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-executions", async (req, res) => {
  let reservedId: string | undefined;
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id)) return void res.status(409).json({ error: "当前世界已有完整故事任务正在执行或启动。" });
    storyExecutionReservations.add(id);
    reservedId = id;
    const requestedUnitId = typeof req.body?.storyUnitId === "string" ? recordId(req.body.storyUnitId) : undefined;
    const runs = await listRuns(id);
    const activeChapter = runs.find(run => run.kind === "chapter" && (!requestedUnitId || run.storyUnitId === requestedUnitId) && (run.status === "queued" || run.status === "running"));
    if (activeChapter) return void res.status(409).json({ error: "当前已有单章任务运行，请完成后再启动完整故事。" });
    const unit = await loadExecutionStoryUnit(id, requestedUnitId);
    const universe = await readUniverse(id);
    if (universe?.archivedAt) return void res.status(409).json({error:"当前故事宇宙已归档，不能启动完整故事执行。"});
    await readFile(path.join(worldDir(id), "world-bible.md"), "utf8");
    const retrievalDir = await resolveWorldLibraryDir(id, path.resolve("worlds"));
    await readFile(path.join(retrievalDir, "index.json"), "utf8");
    if (unit.execution.status === "completed") return void res.status(409).json({ error: "当前故事单元已自然收束。若要创作新故事，请创建新的故事单元或复制一个新宇宙。" });
    const previousTasks = await listStoryExecutions(id, unit.id);
    const latest = previousTasks.find(item => item.status === "running" || item.status === "queued" || item.status === "paused");
    if (latest) return void res.status(409).json({ error: "已有完整故事任务，请恢复或取消现有任务。", execution: latest });
    const now = new Date().toISOString();
    const task: StoryExecution = {
      id: randomUUID(), worldId: id, ...(unit.id ? {storyUnitId: unit.id} : {}), storyUnitTitle: unit.title, mode: "complete_story", status: "queued", createdAt: now, updatedAt: now,
      completedChapters: [], events: [{ at: now, type: "created", message: "创建完整故事执行任务" }], brief: typeof req.body?.brief === "string" ? req.body.brief.trim().slice(0, 8000) : "",
      ...(typeof req.body?.model === "string" ? {model:req.body.model} : {}),
      idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    };
    await saveStoryExecution(task);
    startStoryUnitExecution(task);
    res.status(202).json({ execution: task });
  } catch (error) { sendError(res, error); }
  finally { if (reservedId) storyExecutionReservations.delete(reservedId); }
});

app.post("/api/worlds/:worldId/chapter-batches", async (req, res) => {
  let reservedId: string | undefined;
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id)) return void res.status(409).json({error:"当前世界已有长篇或批量章节任务正在执行。"});
    storyExecutionReservations.add(id); reservedId = id;
    const requestedUnitId = typeof req.body?.storyUnitId === "string" ? recordId(req.body.storyUnitId) : undefined;
    const count = Number(req.body?.chapterCount);
    if (!Number.isSafeInteger(count) || count < 1) return void res.status(400).json({error:"chapterCount 必须是大于 0 的整数。"});
    const runs = await listRuns(id);
    const activeChapter = runs.find(run => run.kind === "chapter" && (!requestedUnitId || run.storyUnitId === requestedUnitId) && (run.status === "queued" || run.status === "running"));
    if (activeChapter) return void res.status(409).json({error:"当前已有章节正在生成，请完成后再启动批量任务。"});
    const universe = await readUniverse(id);
    if (universe?.archivedAt) return void res.status(409).json({error:"当前故事宇宙已归档。"});
    await readFile(path.join(worldDir(id), "world-bible.md"), "utf8");
    const retrievalDir = await resolveWorldLibraryDir(id, path.resolve("worlds"));
    await readFile(path.join(retrievalDir, "index.json"), "utf8");
    const previousTasks = await listStoryExecutions(id, requestedUnitId);
    const latest = previousTasks.find(item => ["running","queued","paused"].includes(item.status));
    if (latest) return void res.status(409).json({error:"已有长篇任务，请恢复或取消后再启动批量任务。",execution:latest});
    let title = "连续章节批次";
    try {
      const unit = await loadExecutionStoryUnit(id, requestedUnitId);
      if (unit.execution.status === "completed") return void res.status(409).json({error:"当前完整故事已经自然收束，请创建新的故事单元后再继续生成。"});
      title = unit.title;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const now = new Date().toISOString();
    const task: StoryExecution = {
      id: randomUUID(), worldId: id, ...(requestedUnitId ? {storyUnitId: requestedUnitId} : {}), storyUnitTitle: title, mode: "fixed_batch", targetChapterCount: count,
      status: "queued", createdAt: now, updatedAt: now, completedChapters: [], events: [{ at: now, type: "created", message: "创建连续章节批次任务" }],
      brief: typeof req.body?.brief === "string" ? req.body.brief.trim().slice(0,8000) : "",
      ...(typeof req.body?.model === "string" ? {model:req.body.model} : {}),
      idleChapterCount: 0, pauseRequested: false, cancelRequested: false, resumeCount: 0
    };
    await saveStoryExecution(task); startStoryUnitExecution(task);
    res.status(202).json({execution:task});
  } catch (error) { sendError(res,error); }
  finally { if (reservedId) storyExecutionReservations.delete(reservedId); }
});

app.get("/api/worlds/:worldId/story-executions/:executionId", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const execution = await getStoryExecution(id, recordId(req.params.executionId));
    if (!execution) return void res.status(404).json({error:"Story execution not found."});
    res.json({execution});
  } catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-executions/:executionId/pause", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); const executionId = recordId(req.params.executionId);
    const task = await getStoryExecution(id, executionId);
    if (!task) return void res.status(404).json({error:"Story execution not found."});
    if (task.status !== "running" && task.status !== "queued") return void res.status(409).json({error:"当前任务不在运行状态。",execution:task});
    const updated = {...task,pauseRequested:true,updatedAt:new Date().toISOString()};
    await saveStoryExecution(updated); res.json({execution:updated});
  } catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-executions/:executionId/resume", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); const executionId = recordId(req.params.executionId);
    const task = await getStoryExecution(id, executionId);
    if (!task) return void res.status(404).json({error:"Story execution not found."});
    if (!["paused","failed","stalled"].includes(task.status)) return void res.status(409).json({error:"当前任务不可恢复。",execution:task});
    if (activeStoryExecutions.has(id)) return void res.status(409).json({error:"当前世界已有故事任务正在执行。"});
    const resumedAt = new Date().toISOString();
    const updated = appendStoryExecutionEvent({...task,status:"queued" as const,pauseRequested:false,cancelRequested:false,error:undefined,completedAt:undefined,updatedAt:resumedAt}, { at: resumedAt, type: "resumed", message: "恢复任务执行" });
    await saveStoryExecution(updated); startStoryUnitExecution(updated); res.status(202).json({execution:updated});
  } catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-executions/:executionId/cancel", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); const executionId = recordId(req.params.executionId);
    const task = await getStoryExecution(id, executionId);
    if (!task) return void res.status(404).json({error:"Story execution not found."});
    if (!["running","queued","paused"].includes(task.status)) return void res.status(409).json({error:"当前任务不能取消。",execution:task});
    const now = new Date().toISOString();
    const updated = task.status === "paused"
      ? {...task,status:"cancelled" as const,cancelRequested:true,completedAt:now,updatedAt:now}
      : {...task,cancelRequested:true,updatedAt:now};
    await saveStoryExecution(updated); res.json({execution:updated});
  } catch (error) { sendError(res, error); }
});

// ── 当前滚动式多章节 Story Arc ─────────────────────────────
app.get("/api/worlds/:worldId/story-arc", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const storyUnitId = typeof req.query.storyUnitId === "string" ? recordId(req.query.storyUnitId) : undefined;
    const arcPath = storyUnitId ? path.join(worldDir(id), ".story-units", storyUnitId, "story-arc.md") : path.join(worldDir(id), "story-arc.md");
    const content = await readFile(arcPath, "utf8").catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    res.json({ storyArc: content });
  } catch (error) { sendError(res, error); }
});

// ── 故事图谱查询 ─────────────────────────────────────────────

/** 限制图谱查询的返回规模；非法或未传参时回落到 500。 */
function graphQueryLimit(raw: unknown): number {
  const requested = Number(raw ?? 500);
  return Number.isFinite(requested) ? Math.min(Math.max(Math.round(requested), 1), 1000) : 500;
}

/** 图谱的完整 v6 原著快照不存在时的占位响应，前端据此提示先跑分析。 */
interface GraphPendingResponse {
  source: string;
  available: boolean;
  reason: string;
  totalNodes: 0; totalEdges: 0; matchedNodes: 0; returnedNodes: 0; returnedEdges: 0;
  truncated: false;
  nodes: []; edges: [];
}

/** 两种查询形态（续写派生 / 原著快照）共同使用 GraphSlice 字段。 */
type GraphResponse = object;

function graphPendingResponse(source: string, worldId: string): GraphPendingResponse {
  return {
    source,
    available: false,
    reason: "原著 v6 全文故事图谱尚未完整合并。请先运行 analyze-story --world " + worldId + " --delta --merge-only。",
    totalNodes: 0, totalEdges: 0, matchedNodes: 0, returnedNodes: 0, returnedEdges: 0,
    truncated: false,
    nodes: [], edges: []
  };
}

/** 续写图谱由 Story State 实时派生；不落第二份存储。 */
async function sequelGraphResponse(source: "sequel", id: string, dir: string, query: string, limit: number): Promise<GraphResponse> {
  const state: StoryState = await loadStoryState(path.join(dir, "story-state.json"), id);
  return { source, available: true, ...filterGraph(buildStoryStateGraph(state), query, limit) };
}

/** 原著图谱只读完整 v6 story_analysis 快照；缺版本或不完整时返回占位结果。 */
function originalGraphResponse(source: "original", id: string, dir: string, query: string, limit: number): GraphResponse {
  const snapshot = readStoryAnalysis(dir, id);
  if (!snapshot || snapshot.analysisVersion !== 6 || snapshot.complete !== true || !snapshot.storyGraph) {
    return graphPendingResponse(source, id);
  }
  return { source, available: true, analysisVersion: snapshot.analysisVersion, analyzedAt: snapshot.analyzedAt, ...filterGraph(snapshot.storyGraph, query, limit) };
}

async function graphHandler(req: Request<WorldIdParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const source = req.query.source === "sequel" ? "sequel" : "original";
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const limit = graphQueryLimit(req.query.limit);
  const dir = worldDir(id);
  if (source === "sequel") {
    res.json(await sequelGraphResponse(source, id, dir, query, limit));
    return;
  }
  res.json(originalGraphResponse(source, id, dir, query, limit));
}
app.get("/api/worlds/:worldId/graph", async (req, res) => {
  try { await graphHandler(req, res); } catch (error) { sendError(res, error); }
});

// ── 人物检索与人物页 ─────────────────────────────────────────

/** 限制人物列表查询规模；与图谱查询共用 clamp 模式但上限按列表各自配置。 */
function charactersQueryLimit(raw: unknown): number {
  const requested = Number(raw ?? CHARACTER_LIST_DEFAULT_LIMIT);
  return Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 1), CHARACTER_LIST_MAX_LIMIT)
    : CHARACTER_LIST_DEFAULT_LIMIT;
}

async function charactersHandler(req: Request<WorldIdParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const limit = charactersQueryLimit(req.query.limit);
  const dir = worldDir(id);
  res.json({ characters: listNovelCharacters(dir, id, { query, limit }), total: countNovelCharacters(dir, id) });
}
app.get("/api/worlds/:worldId/characters", async (req, res) => {
  try { await charactersHandler(req, res); } catch (error) { sendError(res, error); }
});

async function characterDetailHandler(req: Request<NamedParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const name = decodeURIComponent(req.params.name);
  const detail = readNovelCharacterWorkbenchDetail(worldDir(id), id, name);
  if (!detail) return void res.status(404).json({ error: "Character not found." });
  res.json(detail);
}
app.get("/api/worlds/:worldId/characters/:name", async (req, res) => {
  try { await characterDetailHandler(req, res); } catch (error) { sendError(res, error); }
});

// ── 风格参考（认可样本） ─────────────────────────────────────

async function listStyleReferencesHandler(req: Request<WorldIdParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const dir = worldDir(id);
  res.json({ active: await listStyleReferences(dir), history: await listStyleReferenceHistory(dir) });
}
app.get("/api/worlds/:worldId/style-references", async (req, res) => {
  try { await listStyleReferencesHandler(req, res); } catch (error) { sendError(res, error); }
});

/** 新增或更新活动样本；替换前由 domain 层归档旧版本字节。 */
async function putStyleReferenceHandler(req: Request<WorldIdParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const name = req.body?.name;
  const content = req.body?.content;
  if (typeof name !== "string" || typeof content !== "string") {
    return void res.status(400).json({ error: "name and content are required strings." });
  }
  const result = await putStyleReference(worldDir(id), name, content);
  res.json({
    result,
    active: await listStyleReferences(worldDir(id)),
    history: await listStyleReferenceHistory(worldDir(id), name)
  });
}
app.post("/api/worlds/:worldId/style-references", async (req, res) => {
  try { await putStyleReferenceHandler(req, res); } catch (error) { sendError(res, error); }
});

async function readActiveStyleReferenceHandler(req: Request<NamedParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const content = await readActiveStyleReference(worldDir(id), decodeURIComponent(req.params.name));
  res.json({ content });
}
app.get("/api/worlds/:worldId/style-references/:name", async (req, res) => {
  try { await readActiveStyleReferenceHandler(req, res); } catch (error) { sendError(res, error); }
});

async function readStyleReferenceVersionHandler(req: Request<ReferenceVersionParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const content = await readStyleReferenceVersion(worldDir(id), decodeURIComponent(req.params.name), decodeURIComponent(req.params.version));
  res.json({ content });
}
app.get("/api/worlds/:worldId/style-references/:name/history/:version", async (req, res) => {
  try { await readStyleReferenceVersionHandler(req, res); } catch (error) { sendError(res, error); }
});

/** 归档即删除活动版本，历史仍在；不物理删除任何字节。 */
async function archiveStyleReferenceHandler(req: Request<NamedParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const name = decodeURIComponent(req.params.name);
  const result = await archiveStyleReference(worldDir(id), name);
  res.json({ result, active: await listStyleReferences(worldDir(id)), history: await listStyleReferenceHistory(worldDir(id), name) });
}
app.delete("/api/worlds/:worldId/style-references/:name", async (req, res) => {
  try { await archiveStyleReferenceHandler(req, res); } catch (error) { sendError(res, error); }
});

// ── 运行与候选记录 ───────────────────────────────────────────

app.get("/api/worlds/:worldId/candidates", async (req, res) => {
  try { res.json({ candidates: await listCandidates(worldIdOf(req.params.worldId)) }); } catch (error) { sendError(res, error); }
});
app.get("/api/worlds/:worldId/knowledge-build", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    res.json({ build: await readKnowledgeBuild(id) });
  } catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/knowledge-build", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    await serializeWorld(id, async () => {
      const universe = await readUniverse(id);
      if (!universe) return void res.status(409).json({ error: "该入口用于独立故事宇宙；原文项目请使用现有分析命令。" });
      if (universe.archivedAt) return void res.status(409).json({ error: "已归档的故事宇宙不能启动知识构建，请先恢复。" });
      // Knowledge data lives in novel.db; chapter state commits live in story.db.
      // They can run concurrently, so analysis completion is never a writing prerequisite.
      res.status(202).json({ build: await startKnowledgeBuild(id) });
    });
  } catch (error) { sendError(res, error); }
});
app.get("/api/worlds/:worldId/runs", async (req, res) => {
  try {
    const storyUnitId = typeof req.query.storyUnitId === "string" ? recordId(req.query.storyUnitId) : req.query.storyUnitId === "legacy" ? null : undefined;
    res.json({ runs: await listRuns(worldIdOf(req.params.worldId), storyUnitId) });
  } catch (error) { sendError(res, error); }
});
app.get("/api/candidates/:candidateId", async (req, res) => {
  try {
    const id = worldIdOf(req.query.worldId);
    const candidate = await getCandidate(id, recordId(req.params.candidateId));
    if (!candidate) return void res.status(404).json({ error: "Candidate not found." });
    res.json({ candidate });
  } catch (error) { sendError(res, error); }
});
app.get("/api/runs/:runId", async (req, res) => {
  try {
    const id = worldIdOf(req.query.worldId);
    const run = await getRun(id, recordId(req.params.runId));
    if (!run) return void res.status(404).json({ error: "Run not found." });
    res.json({ run });
  } catch (error) { sendError(res, error); }
});

// ── 一键续写下一章 ────────────────────────────────────────────
app.post("/api/worlds/:worldId/chapters/generate", async (req, res) => {
  try {
    const requestedStoryUnitId = typeof req.body?.storyUnitId === "string" ? recordId(req.body.storyUnitId) : undefined;
    const lockId = worldIdOf(req.params.worldId);
    if (activeStoryExecutions.has(lockId)) return void res.status(409).json({ error: "完整故事任务正在执行，请暂停或取消后再单独生成章节。" });
    const pendingStoryTask = (await listStoryExecutions(lockId)).find(task => ["queued","running","paused"].includes(task.status));
    if (pendingStoryTask) return void res.status(409).json({ error: "当前完整故事任务尚未结束，请恢复或取消后再单独生成章节。", execution: pendingStoryTask });
    await serializeWorld(lockId, async () => {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id); const dir = worldDir(id);
    try { await readFile(path.join(dir, "world-bible.md"), "utf8"); } catch { return void res.status(409).json({ error: "缺少 worlds/" + id + "/world-bible.md。请先建立世界设定；这是续写不可自动猜测的基础资料。" }); }
    try {
      const retrievalLibraryDir = await resolveWorldLibraryDir(id, path.resolve("worlds"));
      await readFile(path.join(retrievalLibraryDir, "index.json"), "utf8");
    } catch (error) {
      return void res.status(409).json({ error: error instanceof Error ? error.message : "原著资料库尚未建立。请先导入原著并执行 ingest；其余分析资料可以在续写时按需补齐。" });
    }
    if (requestedStoryUnitId && !await getStoredStoryUnit(dir, id, requestedStoryUnitId)) return void res.status(404).json({ error: "Story Unit not found." });
    const allRuns = await listRuns(id);
    const runs = allRuns.filter(run => run.kind === "chapter" && (requestedStoryUnitId ? run.storyUnitId === requestedStoryUnitId : !run.storyUnitId));
    const active = runs.find(run => run.status === "queued" || run.status === "running");
    if (active) return void res.status(409).json({ error: "已有章节正在生成。", run: active });

    // 连载默认接续最近一章成功成稿；第一章才从当前世界状态开启新故事。
    const previous = runs
      .filter(run => run.status === "completed" && run.chapterPath)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    let previousChapterPath: string | undefined;
    if (previous?.chapterPath) {
      previousChapterPath = path.resolve(previous.chapterPath);
      const outputRoot = path.resolve(".output", id) + path.sep;
      if (!previousChapterPath.startsWith(outputRoot)) {
        return void res.status(409).json({ error: "上一章记录的正文路径不在当前作品输出目录内，已停止生成以避免断档。" });
      }
      try { await readFile(previousChapterPath, "utf8"); }
      catch { return void res.status(409).json({ error: "找不到上一章正文：" + previousChapterPath + "。已停止生成，避免在缺少前文时另起故事。" }); }
    }

    const universe = await readUniverse(id);
    if (universe?.archivedAt) return void res.status(409).json({ error: "当前故事宇宙已归档，请先恢复后再生成章节。" });
    if (universe) await ensureUniverseStoryAnalysis(id, universe);
    const universeEntryPath = universe ? path.join(dir, "universe-entry.md") : undefined;
    const now = new Date().toISOString();
    const runId = randomUUID(); const outputDir = path.resolve(".output", id, "chapter-" + runId);
    const mode = previousChapterPath ? "continuation" : "derivative";
    const run: WorkbenchRun = {
      id: runId, worldId: id, kind: "chapter", status: "queued", ...(requestedStoryUnitId ? { storyUnitId: requestedStoryUnitId } : {}),
      createdAt: now, updatedAt: now, outputDir,
      ...(previousChapterPath ? { previousChapterPath } : {})
    };
    await saveRun(run);
    const args = [
      ...buildCliEntryArgs(["write"]), "--world", id,
      ...(requestedStoryUnitId ? ["--state-file", path.join(dir, ".story-units", requestedStoryUnitId, "story-state.json"), "--story-unit-file", storyExecutionUnitPath(id, requestedStoryUnitId), "--story-arc-file", path.join(dir, ".story-units", requestedStoryUnitId, "story-arc.md")] : []),
      "--mode", mode,
      ...(previousChapterPath ? ["--source", previousChapterPath] : universeEntryPath ? ["--source", universeEntryPath] : []),
      ...(!previousChapterPath && universe ? ["--context", path.join(dir, "universe-origin-context.md")] : []),
      "--brief", previousChapterPath
        ? "紧接上一章的结尾继续写下一章。保持时间、地点、人物位置、人物认知、情绪和未完成行动的连续性；不要重述上一章，不要无故跳线或重启冲突。若有充分的叙事理由，可以自然转场或切换视角，但必须让因果和时间线成立。"
        : universe
          ? "这是独立故事宇宙「" + universe.name + "」的第一章。原文分支起点：" + universe.entryChapter + "。创作方向：" + (universe.brief || universe.type) + "。从指定原文位置理解当时的人物处境、已发生事件和未解决冲突，在此基础上自然展开本宇宙的第一章；不要从原文最后一章开始，也不要继承其他宇宙的续写事实。"
          : "这是本作品的起始章节。根据当前世界设定和长期故事方向，自动确定切入点、人物行动、场景推进和结尾悬念。",
      "--max-words", "3000", "--resume-dir", outputDir
    ];
    await mkdir(outputDir, { recursive: true });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errors = ""; let settled = false;
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { errors += chunk; });
    await saveRun({ ...run, status: "running", updatedAt: new Date().toISOString() });
    child.on("error", error => {
      if (settled) return; settled = true;
      void (async () => {
        await Promise.all([
          writeFile(path.join(outputDir, "process.stdout.log"), output, "utf8"),
          writeFile(path.join(outputDir, "process.stderr.log"), errors + "\n" + error.stack, "utf8"),
          writeFile(path.join(outputDir, "process-result.json"), JSON.stringify({ exitCode: null, error: error.message, completed: false }, null, 2) + "\n", "utf8")
        ]);
        await saveRun({ ...run, status: "failed", error: error.message, updatedAt: new Date().toISOString() });
      })().catch(console.error);
    });
    child.on("close", code => {
      if (settled) return; settled = true;
      void (async () => {
        const saved = output.match(/Saved chapter:\s*(.+)/)?.[1]?.trim();
        const chapterPath = saved ? path.resolve(saved) : undefined;
        const outputRoot = path.resolve(".output", id) + path.sep;
        let finalChapterExists = false; let stateCommitted = false; let qualityPassed = false;
        if (chapterPath && chapterPath.startsWith(outputRoot)) {
          try { finalChapterExists = (await readFile(chapterPath, "utf8")).trim().length > 0; } catch { /* missing final artifact */ }
        }
        try {
          const summary = JSON.parse(await readFile(path.join(outputDir, "09-quality-summary.json"), "utf8")) as { status?: string };
          qualityPassed = summary.status === "passed";
        } catch { /* missing/invalid quality summary is a failed run */ }
        try {
          const update = JSON.parse(await readFile(path.join(outputDir, "08-state-update.json"), "utf8")) as { worldId?: string };
          stateCommitted = update.worldId === id && /Story state automatically updated:/i.test(output);
        } catch { /* missing/invalid state update is a failed run */ }
        const completed = code === 0 && finalChapterExists && qualityPassed && stateCommitted;
        const result = { exitCode: code, chapterPath: chapterPath ?? null, finalChapterExists, qualityPassed, stateCommitted, completed };
        await Promise.all([
          writeFile(path.join(outputDir, "process.stdout.log"), output, "utf8"),
          writeFile(path.join(outputDir, "process.stderr.log"), errors, "utf8"),
          writeFile(path.join(outputDir, "process-result.json"), JSON.stringify(result, null, 2) + "\n", "utf8")
        ]);
        await saveRun({
          ...run, status: completed ? "completed" : "failed",
          ...(chapterPath && finalChapterExists ? { chapterPath } : {}),
          ...(!completed ? { error: ("章节流程未完成：exit=" + code + "；正文=" + finalChapterExists + "；终审=" + qualityPassed + "；状态提交=" + stateCommitted + "\n" + (errors || output).slice(-5000)) } : {}),
          updatedAt: new Date().toISOString()
        });
      })().catch(error => {
        void saveRun({ ...run, status: "failed", error: "Finalizing chapter run failed: " + String(error), updatedAt: new Date().toISOString() });
      });
    });
    res.status(202).json({ run });
    });
  } catch (error) { sendError(res, error); }
});
app.get("/api/runs/:runId/preview", async (req, res) => {
  try {
    const id = worldIdOf(req.query.worldId); const run = await getRun(id, recordId(req.params.runId));
    if (!run || run.kind !== "chapter" || !run.outputDir) return void res.json({ chapterPlan: "", chapter: "" });
    const root = path.resolve(".output", id) + path.sep; const outputDir = path.resolve(run.outputDir);
    if (!outputDir.startsWith(root)) return void res.status(400).json({ error: "Invalid chapter output path." });
    const readOptionalText = async (name: string): Promise<string> => readFile(path.join(outputDir, name), "utf8").catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; });
    const [chapterPlan, sceneBlueprint, chapter, storyArc] = await Promise.all([readOptionalText("03-chapter-plan.md"), readOptionalText("01-scene-blueprint.md"), readOptionalText("chapter.md"), readOptionalText("00-story-arc.md")]);
    res.json({ storyArc, chapterPlan: chapterPlan || sceneBlueprint, chapter });
  } catch (error) { sendError(res, error); }
});
// ── Story Plan 生成（异步任务） ──────────────────────────────

/** 反斜杠以外的路径成分统一替换成下划线，历史文件名用它保证合法。 */
function historyFileName(updatedAt: string): string {
  return updatedAt.replace(/[^a-zA-Z0-9.-]/g, "_") + ".json";
}

/** 归档被替换的上一版 Story Plan。同名文件已存在时静默放弃本次归档。 */
async function archivePreviousPlan(previousPlan: NonNullable<Awaited<ReturnType<typeof loadStoryPlan>>>, dir: string): Promise<void> {
  const historyDir = path.join(dir, "story-plan-history");
  await mkdir(historyDir, { recursive: true });
  const historyPath = path.join(historyDir, historyFileName(previousPlan.updatedAt));
  await writeFile(historyPath, JSON.stringify(previousPlan, null, 2) + "\n", { encoding: "utf8", flag: "wx" })
    .catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
}

/**
 * 规划任务第 1 步：等量拼装检索查询。只取当前状态里的定位句、
 * 活跃剧情线标题和有限人数， Graphic 事实由 buildStoryAnalysisContext 自行打分。
 */
function storyPlanQuery(state: StoryState): string {
  return [
    state.currentPosition,
    ...state.plotThreads.map(thread => thread.title),
    ...state.characters.slice(0, STORY_ANALYSIS_QUERY_CHARACTERS).map(character => character.name)
  ].join("\n");
}

interface StoryPlanTaskInput {
  run: WorkbenchRun;
  worldId: string;
  model?: string;
}

/** 规划任务第 2 步：加载世界资料与旧状态，生成并激活新计划，登记候选与运行结果。 */
async function generateStoryPlanTask({ run, worldId, model }: StoryPlanTaskInput): Promise<void> {
  try {
    await saveRun({ ...run, status: "running", updatedAt: new Date().toISOString() });
    const dir = worldDir(worldId);
    const [worldBible, state, previousPlan] = await Promise.all([
      readFile(path.join(dir, "world-bible.md"), "utf8"),
      loadStoryState(path.join(dir, "story-state.json"), worldId),
      loadStoryPlan(path.join(dir, "story-plan.json"), worldId)
    ]);
    const query = storyPlanQuery(state);
    const storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(dir, worldId), query);
    const plan = await generateStoryPlan({ worldId, worldBible, state, storyAnalysisContext, previousPlan, model });
    const now = new Date().toISOString();
    const activePlan = { ...plan, status: "active" as const, updatedAt: now };
    if (previousPlan) await archivePreviousPlan(previousPlan, dir);
    await saveStoryPlan(path.join(dir, "story-plan.json"), activePlan);
    const candidate: StoryPlanCandidate = {
      id: randomUUID(), worldId, type: "story-plan", status: "applied",
      createdAt: now, updatedAt: now, baseUpdatedAt: previousPlan?.updatedAt ?? null, plan: activePlan, runId: run.id
    };
    await saveCandidate(candidate);
    await saveRun({ ...run, status: "completed", candidateId: candidate.id, updatedAt: now });
  } catch (error) {
    await saveRun({
      ...run, status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString()
    });
  }
}

/** 接口只负责建 run 并立刻返回 202；实际生成在同一世界的串行队列里跑。 */
async function generateStoryPlanHandler(req: Request<WorldIdParams>, res: Response): Promise<void> {
  const id = worldIdOf(req.params.worldId);
  assertInsideWorld(id);
  const runId = randomUUID();
  const run: WorkbenchRun = {
    id: runId, worldId: id, kind: "story-plan", status: "queued",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  await saveRun(run);
  res.status(202).json({ runId, status: "queued" });
  const model = typeof req.body?.model === "string" ? req.body.model : undefined;
  void serializeWorld(id, () => generateStoryPlanTask({ run, worldId: id, model }));
}
app.post("/api/worlds/:worldId/story-plan/generate", async (req, res) => {
  try { await generateStoryPlanHandler(req, res); } catch (error) { sendError(res, error); }
});

/** 顶层兜底：路由处理器之外抛出的异常也映射成统一的 JSON 错误。 */
app.use((error: unknown, _req: Request<WorldIdParams>, res: Response, _next: NextFunction) => sendError(res, error));

export function createApp() {
  return app;
}

/** 服务启动前把上次进程中断的运行记录标记为失败，避免 UI 出现永远 queued 的假任务。 */
export async function recoverWorkbenchRuns(): Promise<void> {
  const root = path.resolve("worlds");
  let entries: string[] = [];
  try {
    const directoryEntries = await readdir(root, { withFileTypes: true });
    // A hard process exit can happen before a staging rename. Such directories
    // are never visible worlds and must not accumulate or be resumed on startup.
    await Promise.all(directoryEntries
      .filter(entry => entry.isDirectory() && /^\.staging-u-[a-f0-9]{16}$/.test(entry.name))
      .map(entry => rm(path.join(root, entry.name), { recursive: true, force: true })));
    entries = directoryEntries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch { /* no worlds yet */ }
  const ids = entries.filter(id => /^[a-z0-9][a-z0-9-]*$/i.test(id));
  await Promise.all(ids.map(async id => {
    await recoverInterruptedRuns(id);
    await recoverStoryExecutions(id);
    const build = await readKnowledgeBuild(id);
    if (build && (build.status === "queued" || build.status === "running")) {
      build.status = "failed";
      build.completedAt = new Date().toISOString();
      build.updatedAt = build.completedAt;
      build.steps = build.steps.map(step => step.status === "running"
        ? { ...step, status: "failed" as const, completedAt: build.completedAt, error: "Workbench restarted before this step completed. Start a new knowledge build to retry." }
        : step);
      delete build.currentStep;
      await writeKnowledgeBuild(build);
    }
  }));
}
