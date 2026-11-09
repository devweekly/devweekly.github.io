// Workbench Express API 组装。这里只做三件事：参数校验、错误映射和响应序列化；
// 领域逻辑（Story Plan、Story State、故事图谱、风格参考）全部走共享 domain service，
// 不得在路由层复制 prompt 或 schema 逻辑。
import express, { type Request, type Response, type NextFunction } from "express";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";

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
import { alignCanonChapterGroups, joinCanonChunkText, selectCanonSourceChunks, splitCanonLines, type CanonChunk } from "./canon-chapters.js";
import { chunkText, ensurePrivateLibraryIsolation } from "./library.js";
import { chapterId as catalogChapterId, ensureSourceCanonLibraryIndex, indexNovelStructure, loadChapterCatalog, loadChapterCatalogDocument, prepareCanonIndexInputs, type CatalogChapter } from "./novel-kb.js";
import { buildStoryStateGraph, filterGraph } from "./story-state-graph.js";
import { archiveStyleReference, listStyleReferenceHistory, listStyleReferences, putStyleReference, readActiveStyleReference, readStyleReferenceVersion } from "./style-references.js";
import { getCandidate, getRun, listCandidates, listRuns, recoverInterruptedRuns, saveCandidate, saveRun, type StoryPlanCandidate, type WorkbenchRun } from "./workbench-store.js";
import type { StoryState } from "./story-state.js";
import { buildUniverseOriginContext, buildUniverseWorldBible, rebaseStoryState, remapForkedRun, shouldCopyUniverseAsset } from "./universe-branch.js";
import { importBoundedStoryAnalysisSnapshot, restrictKnowledgeDatabaseToEntry } from "./source-canon-snapshot.js";
import { importBoundedStoryAnalysisFromBatchCache } from "./story-analysis.js";
import { resolveWorldLibraryDir } from "./universe-library.js";
import { copyOriginalCanonToUniverse, ensureBoundedUniverseCanonAssets, resolveOriginalCanonPath, truncateCanonAtLine } from "./canon-source.js";
import { assessStoryUnitProgress, generateStoryUnit, isStoryUnitNaturallyComplete, validateStoryUnit } from "./story-unit.js";
import { archiveStoredStoryUnitVersion, createStoredStoryUnit, getStoredStoryUnit, getStoredStoryUnitVersion, listStoredStoryUnitVersions, listStoredStoryUnits, saveStoredStoryUnit } from "./story-unit-store.js";
import { getStoryExecution, listStoryExecutions, recoverStoryExecutions, saveStoryExecution, storyExecutionOwnsRun, latestCompletedChapterForStoryUnit, mergeStoryExecutionControlFlags, storyRunStateWasRolledBack, type StoryExecution } from "./story-execution.js";

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

/** 遍历 worlds/ 下合法目录；各世界元数据并行读取，单个目录损坏不影响其余列表。 */
async function listWorlds(): Promise<Array<{ id: string; title: string; hasStoryPlan: boolean }>> {
  const root = path.resolve("worlds");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const validId = (x: string) => /^[a-z0-9][a-z0-9-]*$/i.test(x);
  const worlds = await Promise.all(entries.filter(validId).map(async id => {
    try {
      if (await readUniverse(id)) return null; // 宇宙是原文项目的分支，不重复列为独立原文项目。
      const bible = await readFile(path.join(root, id, "world-bible.md"), "utf8");
      let plan;
      try {
        plan = await loadStoryPlan(path.join(root, id, "story-plan.json"), id);
      } catch (error) {
        console.warn("[workbench] Invalid Story Plan for " + id, error);
      }
      const title = bible.split("\n").find(line => line.startsWith("# "))?.slice(2).trim() || id;
      return { id, title, hasStoryPlan: Boolean(plan) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[workbench] Unable to list world " + id, error);
      }
      return null;
    }
  }));
  return worlds.filter((world): world is { id: string; title: string; hasStoryPlan: boolean } => world !== null);
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

const WRITING_READINESS_STEPS: KnowledgeBuildStep[] = [
  "style-profile", "character-profiles", "character-states", "as-of-dossier"
];

/** Start or resume required knowledge preparation without holding the HTTP request open. */
async function ensureWritingKnowledgeBuildStarted(worldId: string): Promise<void> {
  const state = await readKnowledgeBuild(worldId);
  const ready = Boolean(state && WRITING_READINESS_STEPS.every(name =>
    state.steps.some(step => step.name === name && (step.status === "completed" || step.status === "skipped"))
  ));
  if (!ready && !knowledgeBuilds.has(worldId)) await startKnowledgeBuild(worldId);
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
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", ...cliArgs], {
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
        // stderr is diagnostic output, not automatically a failed step. Node 24's
        // SQLite ExperimentalWarning is suppressed at the child runtime; retain any
        // remaining stderr in diagnostic output without painting successful steps red.
        record.output = [result.output, result.error].filter(Boolean).join("\n").slice(-12000);
        record.error = result.exitCode === 0 ? undefined : result.error.slice(-6000);
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


async function serializeWorld<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  const previous = worldQueues.get(worldId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  worldQueues.set(worldId, tail);
  await previous.catch(() => undefined);
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
  /** SHA-256 of the full source corpus at universe creation; prevents silent repair from a changed book. */
  sourceCanonHash?: string;
  brief: string;
  parentUniverseId?: string;
  forkPoint?: string;
  createdAt: string;
  archivedAt?: string;
}

function checkpointKnowledgeDatabase(databasePath: string): void {
  if (!existsSync(databasePath)) return;
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    db.close();
  }
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

function readCatalogChapterText(catalog: CatalogChapter[], lines: string[], catalogIndex: number): string {
  const entry = catalog[catalogIndex];
  if (!entry || !Number.isSafeInteger(entry.line) || (entry.line ?? 0) < 1) return "";
  const start = (entry.line as number) - 1;
  const nextLine = catalog.slice(catalogIndex + 1).find(item => Number.isSafeInteger(item.line) && (item.line ?? 0) > (entry.line ?? 0))?.line;
  const end = typeof nextLine === "number" ? Math.max(start, nextLine - 1) : lines.length;
  return lines.slice(start, end).join("\n").trim();
}

interface CanonChapterChunk extends CanonChunk { id: string; source: string }
interface CanonChapterEntry {
  title: string;
  text: string;
  volume: number;
  sequenceInVolume: number;
  chapterId: string;
  ordinal: number;
  hasChunks: boolean;
}
async function ensureStagedChapterDatabase(
  universeId: string,
  sourceWorldId: string,
  stagedDir: string,
  chapters: CanonChapterEntry[]
): Promise<void> {
  const databasePath = path.join(stagedDir, "novel.db");
  let rows: Array<{ chapter_id: string; ordinal: number; volume: number; title: string }> = [];
  const databaseExists = existsSync(databasePath);
  if (databaseExists) {
    const db = new DatabaseSync(databasePath);
    try {
      rows = db.prepare("SELECT chapter_id,ordinal,volume,title FROM novel_chapters ORDER BY ordinal")
        .all() as typeof rows;
    } catch (error) {
      if (!(error instanceof Error) || !/no such table|no such column/i.test(error.message)) throw error;
    } finally {
      db.close();
    }
  }
  const canonicalRows = rows.filter(row => row.chapter_id !== "V00-C000");
  if (databaseExists && chapters.length > 0 && canonicalRows.length === 0) {
    throw new Error(
      "原文 novel.db 缺少正式章节目录记录，无法证明知识库与原文目录的稳定 ID 映射。" +
      "请先对原文项目执行 node --import tsx src/cli.ts index-story --world " + sourceWorldId +
      "，再创建故事宇宙；不要通过 ingest 重新导入来修复。"
    );
  }
  const complete = canonicalRows.length === chapters.length && chapters.every((chapter, index) => {
    const row = canonicalRows[index];
    return row?.chapter_id === chapter.chapterId &&
      Number(row.ordinal) === chapter.ordinal &&
      Number(row.volume) === chapter.volume &&
      row.title === chapter.title;
  });
  if (!complete) {
    // Rebuild only the staged copy. Universe creation must never mutate the
    // source project's novel.db just to repair missing/legacy chapter rows.
    await indexNovelStructure(universeId, { worldDir: stagedDir });
  }
}

const chapterCatalogBuilds = new Map<string, Promise<void>>();

async function rebuildOfflineChapterCatalog(sourceWorldId: string, projectRoot: string): Promise<void> {
  const running = chapterCatalogBuilds.get(sourceWorldId);
  if (running) return running;
  const task = new Promise<void>((resolveBuild, rejectBuild) => {
    const scriptPath = path.join(projectRoot, "analysis", "build-corpus-index.mjs");
    const child = spawn(process.execPath, [scriptPath], {
      cwd: projectRoot,
      env: { ...process.env, NOVEL_WORLD_ID: sourceWorldId },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.once("error", rejectBuild);
    child.once("close", code => {
      if (code === 0) resolveBuild();
      else rejectBuild(new Error(
        "从 original.txt 自动重建章节目录失败（exit " + String(code) + "）。" +
        (stderr.trim() || stdout.trim() || "请检查原文标题格式和文件权限。")
      ));
    });
  });
  chapterCatalogBuilds.set(sourceWorldId, task);
  try { await task; }
  finally { if (chapterCatalogBuilds.get(sourceWorldId) === task) chapterCatalogBuilds.delete(sourceWorldId); }
}

async function readCanonChapters(sourceWorldId: string): Promise<CanonChapterEntry[]> {
  // Resolve every offline asset from the Workbench project root, not from a
  // caller's incidental current working directory.
  const sourceProjectRoot = path.resolve(worldDir(sourceWorldId), "..", "..");
  const catalogPath = path.join(sourceProjectRoot, "analysis", sourceWorldId, "chapter-index.json");
  let originalPath: string | undefined;
  try {
    originalPath = await resolveOriginalCanonPath(sourceWorldId, {
      projectRoot: sourceProjectRoot,
      worldDir: worldDir(sourceWorldId)
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let catalogDocument;
  let rebuildCatalog = false;
  try {
    catalogDocument = await loadChapterCatalogDocument(sourceWorldId, catalogPath);
    rebuildCatalog = !catalogDocument;
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && /Chapter catalog has no chapters/.test(error.message))) {
      rebuildCatalog = true;
      // Keep the invalid derived file for diagnosis; never destroy the only copy.
      if (existsSync(catalogPath)) {
        await rename(catalogPath, catalogPath + ".invalid-" + Date.now());
      }
    } else {
      throw error;
    }
  }
  if (rebuildCatalog && originalPath) {
    await rebuildOfflineChapterCatalog(sourceWorldId, sourceProjectRoot);
    catalogDocument = await loadChapterCatalogDocument(sourceWorldId, catalogPath);
  }
  const catalog = catalogDocument?.chapters;
  if (!catalogDocument || !catalog) {
    throw new Error(
      "找不到有效的原著章节目录：" + catalogPath +
      (originalPath
        ? "；已找到原文全文：" + originalPath + "，但自动重建后仍没有有效章节，请检查 original.txt 中的章节标题格式。"
        : "；未找到 original.txt，无法从离线全文重建目录。")
    );
  }
  const libraryDir = path.join(worldDir(sourceWorldId), "library");
  await ensureSourceCanonLibraryIndex(sourceWorldId, worldDir(sourceWorldId));
  let chunks: CanonChapterChunk[] = [];
  try {
    const index = JSON.parse(await readFile(path.join(libraryDir, "index.json"), "utf8")) as { worldId?: string; chunks?: CanonChapterChunk[] };
    if (index.worldId !== sourceWorldId || !Array.isArray(index.chunks)) {
      throw new Error("原文 library/index.json 的世界身份或结构不匹配：" + sourceWorldId);
    }
    chunks = index.chunks;
  } catch (error) {
    // The full text + chapter catalog are sufficient to populate the selector.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const prepared = await prepareCanonIndexInputs(worldDir(sourceWorldId), catalog, chunks, catalogDocument.totalLines, catalogDocument.sourceHash);
  const aligned = alignCanonChapterGroups(catalog, prepared.chunks, prepared.chapterStartOffsets);
  const sourceHash = prepared.originalText === undefined
    ? undefined
    : createHash("sha256").update(prepared.originalText, "utf8").digest("hex");
  const persistedCanon = selectCanonSourceChunks(chunks, sourceHash);
  const persistedAligned = alignCanonChapterGroups(catalog, persistedCanon, prepared.chapterStartOffsets);
  const originalLines = prepared.originalText === undefined ? undefined : splitCanonLines(prepared.originalText);
  const result: CanonChapterEntry[] = [];
  for (const item of aligned) {
    const text = joinCanonChunkText(item.chunks) ||
      (originalLines ? readCatalogChapterText(catalog, originalLines, item.catalogIndex) : "");
    result.push({
      title: item.chapter.title,
      text,
      volume: item.chapter.volume,
      sequenceInVolume: item.chapter.sequenceInVolume,
      chapterId: catalogChapterId(item.chapter.volume, item.chapter.sequenceInVolume),
      ordinal: item.catalogIndex + 1,
      // Distinguish real persisted retrieval coverage from chunks reconstructed
      // in memory. The source novel.db may legitimately lack rows for chapters
      // whose derived Library chunks have not yet been materialized.
      hasChunks: (persistedAligned[item.catalogIndex]?.chunks.length ?? 0) > 0
    });
  }
  return result;
}

/**
 * Story analysis and Corpus Craft require the chapter catalog as well as library chunks.
 * The source catalog is full-book metadata, so write a universe-local copy filtered to
 * the same as-of chapter boundary. Never fall back to the parent's unbounded catalog.
 */
async function writeUniverseAnalysisCatalogSnapshot(sourceWorldId: string, targetDir: string, universeId: string, entryIndex: number, boundedTotalLines: number): Promise<void> {
  const sourcePath = path.resolve("analysis", sourceWorldId, "chapter-index.json");
  try {
    const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
      schemaVersion?: number; totalLines?: number;
      volumes?: Array<{ volume: number; startLine?: number; endLine?: number; chapterCount?: number; openingChapter?: string; closingChapter?: string; chapters?: Array<Record<string, unknown>> }>;
      chapters?: Array<Record<string, unknown>>;
    };
    const safeChapter = (chapter: Record<string, unknown>) => ({
      ...(typeof chapter.sequenceInVolume === "number" ? { sequenceInVolume: chapter.sequenceInVolume } : {}),
      ...(typeof chapter.printedNumber === "number" || chapter.printedNumber === null ? { printedNumber: chapter.printedNumber } : {}),
      title: String(chapter.title ?? ""),
      label: String(chapter.label ?? chapter.title ?? ""),
      ...(typeof chapter.line === "number" ? { line: chapter.line } : {})
    });
    let remaining = entryIndex + 1;
    const safeVolumes = (source.volumes ?? []).map(volume => {
      const chapters = (volume.chapters ?? []).slice(0, remaining).map(safeChapter);
      remaining -= chapters.length;
      if (!chapters.length) return null;
      return {
        volume: volume.volume,
        ...(typeof volume.startLine === "number" ? { startLine: volume.startLine } : {}),
        endLine: Math.min(typeof volume.endLine === "number" ? volume.endLine : boundedTotalLines, boundedTotalLines),
        chapterCount: chapters.length,
        openingChapter: chapters[0]!.title,
        closingChapter: chapters[chapters.length - 1]!.title,
        chapters
      };
    }).filter((volume): volume is NonNullable<typeof volume> => volume !== null);
    const safeChapters = (source.chapters ?? []).slice(0, entryIndex + 1).map(safeChapter);
    const totalLines = Math.max(1, boundedTotalLines);
    const boundedText = await readFile(path.join(targetDir, "original.txt"), "utf8");
    const boundedSourceHash = createHash("sha256").update(boundedText, "utf8").digest("hex");
    const snapshot = {
      ...(typeof source.schemaVersion === "number" ? { schemaVersion: source.schemaVersion } : {}),
      totalLines,
      sourceHash: boundedSourceHash,
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
 * The local cloneOriginalCanon() reflink helper was replaced by the shared
 * canon-source.ts implementation: copyOriginalCanonToUniverse() reads the
 * project-root canon and writes a chapter-bounded original.txt, which both
 * guarantees the universe owns the file (FICLONE_FORCE is ENOSYS on APFS) and
 * prevents future chapters from leaking into the universe's local corpus.
 */
async function writeUniverseLibrarySnapshot(sourceWorldId: string, targetDir: string, universeId: string, entryIndex: number): Promise<number> {
  let source: { schemaVersion: number; worldId?: string; createdAt: string; updatedAt: string; chunks: Array<CanonChapterChunk & { [key: string]: unknown }> } = {
    schemaVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), chunks: []
  };
  const sourceLibraryDir = path.join(worldDir(sourceWorldId), "library");
  await ensureSourceCanonLibraryIndex(sourceWorldId, worldDir(sourceWorldId));
  try {
    source = JSON.parse(await readFile(path.join(sourceLibraryDir, "index.json"), "utf8")) as typeof source & { worldId?: string };
    if (source.worldId !== sourceWorldId || !Array.isArray(source.chunks)) {
      throw new Error("原文 library/index.json 的世界身份或结构不匹配：" + sourceWorldId);
    }
  } catch (error) {
    // The library index is rebuildable. Reconstruct bounded chunks from the
    // canonical full text below instead of treating a missing cache as no canon.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const catalogDocument = await loadChapterCatalogDocument(sourceWorldId);
  const catalog = catalogDocument?.chapters;
  if (!catalog) throw new Error("原著章节目录不存在，无法创建有边界的知识切片快照。");
  const prepared = await prepareCanonIndexInputs(worldDir(sourceWorldId), catalog, source.chunks, catalogDocument.totalLines);
  const nextChapterLineValue = catalog[entryIndex + 1]?.line;
  const nextChapterLine = typeof nextChapterLineValue === "number" ? nextChapterLineValue : undefined;
  if (catalog[entryIndex + 1] && (!Number.isSafeInteger(nextChapterLine) || Number(nextChapterLine) < 2)) {
    throw new Error("所选起点之后的原文目录缺少有效行号，无法安全截断未来章节。");
  }
  const originalPath = await resolveOriginalCanonPath(sourceWorldId);
  const originalText = await readFile(originalPath, "utf8");
  const boundedOriginalText = truncateCanonAtLine(originalText, nextChapterLine);
  const originalSourceLines = splitCanonLines(originalText);
  const boundedLineCount = splitCanonLines(boundedOriginalText).length;
  const offsets = prepared.chapterStartOffsets;
  const sourceHash = createHash("sha256").update(boundedOriginalText, "utf8").digest("hex");
  const aligned = alignCanonChapterGroups(catalog, prepared.chunks, offsets);
  // Rebind provenance to the bounded file that is actually stored in this
  // universe. Keeping the parent's full-book hash would make index-story reject
  // every child chunk after the original copy is correctly truncated.
  const sourceKey = "worlds/" + universeId + "/original.txt";
  const chunks = aligned.filter(item => item.catalogIndex <= entryIndex).flatMap(item => {
    if (item.chunks.length) return item.chunks.map(chunk => ({
      ...chunk, source: sourceKey, sourceHash,
      ...(offsets[item.catalogIndex] !== undefined ? { chapterStart: offsets[item.catalogIndex] } : {})
    }));
    const chapterText = readCatalogChapterText(catalog, originalSourceLines, item.catalogIndex);
    if (!chapterText) throw new Error("无法为历史宇宙补齐原著章节切片：" + item.chapter.title + "。原文全文缺失或目录行号无效。");
    const parts = chunkText(chapterText);
    return parts.map((part, chunkIndex) => ({
      id: sourceKey + ":catalog:" + catalogChapterId(item.chapter.volume, item.chapter.sequenceInVolume) + ":" + chunkIndex,
      source: sourceKey,
      sourceHash,
      chapter: item.chapter.title,
      chunkIndex,
      start: part.start,
      end: part.end,
      text: part.text,
      ...(offsets[item.catalogIndex] !== undefined ? { chapterStart: offsets[item.catalogIndex] } : {})
    }));
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
  return boundedLineCount;
}


async function writeForkedUniverseCanonSnapshots(parentId: string, targetDir: string, universeId: string): Promise<number> {
  const parentOriginalPath = await resolveOriginalCanonPath(parentId);
  const parentOriginalText = await readFile(parentOriginalPath, "utf8");
  const sourceHash = createHash("sha256").update(parentOriginalText, "utf8").digest("hex");
  const lineCount = splitCanonLines(parentOriginalText).length;
  const parentLibrary = JSON.parse(await readFile(path.join(worldDir(parentId), "library", "index.json"), "utf8")) as {
    schemaVersion: number; createdAt: string; updatedAt: string; worldId: string;
    chunks: Array<CanonChapterChunk & { sourceHash?: string }>;
  };
  if (parentLibrary.worldId !== parentId || !Array.isArray(parentLibrary.chunks) || !parentLibrary.chunks.length) {
    throw new Error("父宇宙没有可验证的时点原文切片，无法安全分叉。");
  }
  const parentCatalogDocument = await loadChapterCatalogDocument(parentId);
  if (!parentCatalogDocument) throw new Error("父宇宙缺少 bounded chapter-index.json，拒绝分叉。");
  if (parentCatalogDocument.totalLines !== lineCount) {
    throw new Error("父宇宙章节目录 totalLines 与本地 bounded original.txt 不一致，拒绝分叉。");
  }
  const prepared = await prepareCanonIndexInputs(worldDir(parentId), parentCatalogDocument.chapters, parentLibrary.chunks, parentCatalogDocument.totalLines);
  const parentChunks = prepared.chunks;
  if (parentChunks.length !== parentLibrary.chunks.length || parentChunks.some(chunk => chunk.sourceHash !== sourceHash)) {
    throw new Error("父宇宙 library 的 source/sourceHash 与本地时点原文不一致，拒绝复制不确定的分支检索数据。");
  }
  const alignedParent = alignCanonChapterGroups(parentCatalogDocument.chapters, parentChunks, prepared.chapterStartOffsets);
  if (alignedParent.some(item => item.chunks.length === 0)) {
    throw new Error("父宇宙 library 缺少正式章节切片，拒绝创建不完整的分支检索快照。");
  }
  const catalogTitles = parentCatalogDocument.chapters.map(chapter => chapter.title);
  if (!catalogTitles.length || parentChunks.some(chunk => !catalogTitles.includes(chunk.chapter))) {
    throw new Error("父宇宙 library 存在章节目录之外的切片，拒绝分叉以防止未来剧情泄漏。");
  }

  const parentCatalogPath = path.resolve("analysis", parentId, "chapter-index.json");
  const parentCatalogText = await readFile(parentCatalogPath, "utf8");

  const sourceKey = "worlds/" + universeId + "/original.txt";
  const libraryDir = path.join(targetDir, "library");
  await mkdir(libraryDir, { recursive: true });
  const childLibrary = {
    schemaVersion: parentLibrary.schemaVersion,
    worldId: universeId,
    createdAt: parentLibrary.createdAt,
    updatedAt: new Date().toISOString(),
    chunks: alignedParent.flatMap(item => item.chunks.map(chunk => ({
      ...chunk, source: sourceKey, sourceHash,
      ...(prepared.chapterStartOffsets[item.catalogIndex] !== undefined
        ? { chapterStart: prepared.chapterStartOffsets[item.catalogIndex] }
        : {})
    })))
  };
  await writeFile(path.join(libraryDir, "index.json"), JSON.stringify(childLibrary, null, 2) + "\n", "utf8");

  const childCatalogDir = path.resolve("analysis", universeId);
  await mkdir(childCatalogDir, { recursive: true });
  await writeFile(path.join(childCatalogDir, "chapter-index.json"), parentCatalogText, "utf8");
  return lineCount;
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
  try {
    const lockId = worldIdOf(req.params.worldId);
    await serializeWorld(lockId, async () => {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id) || chapterGenerationReservations.has(id)) return void res.status(409).json({ error: "章节或长篇任务正在执行或启动，不能归档或恢复宇宙。" });
    const universe = await readUniverse(id);
    if (!universe) return void res.status(409).json({ error: "原文项目不能归档为故事宇宙。" });
    const archive = req.body?.archived === true;
    if (knowledgeBuilds.has(id)) return void res.status(409).json({ error: "当前宇宙正在构建知识资料，完成后再归档或恢复。" });
    const pendingStoryTask = (await listStoryExecutions(id)).find(task => ["queued","running","paused"].includes(task.status));
    if (pendingStoryTask) return void res.status(409).json({ error: "当前宇宙仍有长篇任务未结束，请先完成、取消或处理恢复状态。" });
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
});

app.post("/api/worlds/:worldId/universes", async (req, res) => {
  let stagingPath: string | null = null;
  let createdUniverseId: string | null = null;
  try {
    const lockId = worldIdOf(req.params.worldId);
    await serializeWorld(lockId, async () => {
    const sourceId = worldIdOf(req.params.worldId); assertInsideWorld(sourceId);
    const sourceUniverse = await readUniverse(sourceId);
    if (sourceUniverse) return void res.status(409).json({ error: "新建独立宇宙只能从原文项目发起；若要接着当前宇宙的某个历史章节继续，请使用「从本宇宙分叉」。" });
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
    const canonicalPath = await resolveOriginalCanonPath(rootSourceId, { projectRoot: path.resolve("."), worldDir: sourceDir });
    const sourceCanonText = await readFile(canonicalPath, "utf8");
    const sourceCanonHash = createHash("sha256").update(sourceCanonText, "utf8").digest("hex");
    const selectedChapter = canonChapters[selectedIndex];
    const boundedCanonChapters = canonChapters.slice(0, selectedIndex + 1);
    if (!selectedChapter || selectedChapter.title !== entryChapter) return void res.status(400).json({ error: "所选章节索引或标题不匹配，请刷新原文目录后重试。" });
    const incompletePast = canonChapters.slice(0, selectedIndex + 1).find(chapter => !chapter.text.trim());
    if (incompletePast) {
      return void res.status(400).json({
        error: "起点及之前的原著章节缺少可验证正文（" + incompletePast.title + "）。请先修复原文切片或目录行号，不能在缺失前情的状态下创建宇宙。"
      });
    }
    // 起点前情属于原著只读背景，不是新宇宙已发生的续写事实。
    const originContext = buildUniverseOriginContext(canonChapters, selectedIndex);
    const id = "u-" + randomUUID().replace(/-/g, "").slice(0, 16);
    createdUniverseId = id;
    const targetDir = worldDir(id);
    const stagingDir = path.join(path.resolve("worlds"), ".staging-" + id);
    stagingPath = stagingDir;
    await mkdir(stagingDir, { recursive: true });
    // Checkpoint SQLite before copying its main file; WAL sidecars and arbitrary
    // source-world files are deliberately not copied into a new universe.
    checkpointKnowledgeDatabase(path.join(sourceDir, "novel.db"));
    await cp(sourceDir, stagingDir, {
      recursive: true,
      filter: source => {
        return shouldCopyUniverseAsset(path.relative(sourceDir, source));
      }
    });
    const sourceCatalog = await loadChapterCatalog(rootSourceId);
    if (!sourceCatalog) throw new Error("原著章节目录不存在，无法建立安全的时点原文副本。");
    const nextChapterLineValue = sourceCatalog[selectedIndex + 1]?.line;
    const nextChapterLine = typeof nextChapterLineValue === "number" ? nextChapterLineValue : undefined;
    if (sourceCatalog[selectedIndex + 1] && (!Number.isSafeInteger(nextChapterLine) || Number(nextChapterLine) < 2)) {
      throw new Error("所选章节之后的目录缺少有效行号，无法截断原文未来剧情。");
    }
    const copiedCanon = await copyOriginalCanonToUniverse(rootSourceId, stagingDir, path.resolve("."), nextChapterLine);
    if (!copiedCanon) throw new Error("无法读取原著全文并建立独立的时点原文副本；拒绝创建可能暴露未来剧情的故事宇宙。");
    // 先写入宇宙身份和 bounded 离线资产，再在 staging 副本中修复章节数据库。
    // 这样即使源项目没有 novel.db 或章节 ID 已过期，也不会修改源项目。
    const entryChapterId = selectedChapter.chapterId;
    const universe: StoryUniverse = {
      id, sourceWorldId: rootSourceId, name, type, entryChapter, entryChapterId,
      entryChapterIndex: selectedIndex, entryOrdinal: selectedChapter.ordinal, brief,
      sourceCanonHash,
      createdAt: new Date().toISOString()
    };
    await writeFile(path.join(stagingDir, "universe.json"), JSON.stringify(universe, null, 2) + "\n", "utf8");
    await writeFile(path.join(stagingDir, "world-bible.md"), buildUniverseWorldBible(universe), "utf8");
    await writeFile(path.join(stagingDir, "source-canon.json"), JSON.stringify({ sourceWorldId: rootSourceId, readOnly: true }, null, 2) + "\n", "utf8");
    await writeFile(path.join(stagingDir, "universe-entry.md"), selectedChapter.text + "\n", "utf8");
    await writeFile(path.join(stagingDir, "universe-origin-context.md"), originContext + "\n", "utf8");
    const boundedTotalLines = await writeUniverseLibrarySnapshot(rootSourceId, stagingDir, id, selectedIndex);
    await writeUniverseAnalysisCatalogSnapshot(rootSourceId, stagingDir, id, selectedIndex, boundedTotalLines);

    // novel.db is copied into staging and rebound. If it is missing, legacy,
    // or incomplete, rebuild the chapter directory from the bounded local text.
    rebindKnowledgeDatabase(path.join(stagingDir, "novel.db"), id);
    await ensureStagedChapterDatabase(id, rootSourceId, stagingDir, boundedCanonChapters);
    const knowledgePath = path.join(stagingDir, "novel.db");
    const sourceDb = new DatabaseSync(knowledgePath);
    let entryRecord: { chapter_id:string; ordinal:number; volume:number; title:string } | undefined;
    try {
      const chapterRows = sourceDb.prepare("SELECT chapter_id,ordinal,volume,title FROM novel_chapters ORDER BY ordinal").all() as Array<{chapter_id:string;ordinal:number;volume:number;title:string}>;
      const rowsById = new Map(chapterRows.map(row => [row.chapter_id, row]));
      const catalogIds = new Set(boundedCanonChapters.map(chapter => chapter.chapterId));
      const unexpected = chapterRows.filter(row => row.chapter_id !== "V00-C000" && !catalogIds.has(row.chapter_id));
      if (unexpected.length) {
        throw new Error("staging novel.db 含有不属于 bounded chapter-index.json 的章节 ID（" + unexpected[0]!.chapter_id + "），拒绝猜测章节映射。");
      }
      const missing = boundedCanonChapters.find(chapter => !rowsById.has(chapter.chapterId));
      if (missing) throw new Error("staging novel.db 重建后仍缺少章节记录：" + missing.title + "。");
      for (const chapter of boundedCanonChapters) {
        const row = rowsById.get(chapter.chapterId);
        if (!row || Number(row.ordinal) !== chapter.ordinal || Number(row.volume) !== chapter.volume || row.title !== chapter.title) {
          throw new Error("staging novel.db 章节目录与 bounded chapter-index.json 不一致：" + chapter.title + "。");
        }
      }
      entryRecord = rowsById.get(selectedChapter.chapterId);
    } finally { sourceDb.close(); }
    if (!entryRecord?.chapter_id || !Number.isSafeInteger(Number(entryRecord.ordinal))) throw new Error("无法将所选章节映射到 staging novel.db 的稳定 chapter_id，已终止创建。");
    const entryOrdinal = restrictKnowledgeDatabaseToEntry(knowledgePath, id, entryChapter, entryChapterId);
    if (entryOrdinal !== selectedChapter.ordinal || entryOrdinal !== Number(entryRecord.ordinal)) {
      throw new Error("章节起点 ordinal 校验失败，已终止创建。");
    }
    await writeFile(path.join(stagingDir, "source-canon-as-of.json"), JSON.stringify({ sourceWorldId: rootSourceId, sourceCanonHash, entryChapter, entryChapterId, entryChapterIndex: selectedIndex, entryOrdinal, policy: "chapter-scoped-evidence-only", fullBookAggregates: "excluded" }, null, 2) + "\n", "utf8");
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
    if (activeStoryExecutions.has(parentId) || storyExecutionReservations.has(parentId) || chapterGenerationReservations.has(parentId)) return void res.status(409).json({ error: "章节或长篇任务正在执行或启动，不能从当前状态分叉。" });
    const parent = await readUniverse(parentId);
    if (!parent) return void res.status(409).json({ error: "只能从已有故事宇宙创建分叉。" });
    if (parent.archivedAt) return void res.status(409).json({ error: "已归档的故事宇宙不能继续分叉，请先恢复。" });
    if (knowledgeBuilds.has(parentId)) return void res.status(409).json({ error: "当前宇宙正在构建知识资料，完成后再分叉。" });
    const pendingStoryTask = (await listStoryExecutions(parentId)).find(task => ["queued","running","paused"].includes(task.status));
    if (pendingStoryTask) return void res.status(409).json({ error: "当前宇宙仍有长篇任务未结束，请先完成、取消或处理恢复状态。" });
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
    await ensureBoundedUniverseCanonAssets(parentId, { projectRoot: path.resolve("."), worldDir: parentDir });
    checkpointKnowledgeDatabase(path.join(parentDir, "novel.db"));
    await cp(parentDir, stagingDir, {
      recursive: true,
      filter: source => {
        return shouldCopyUniverseAsset(path.relative(parentDir, source));
      }
    });
    const parentCatalog = await loadChapterCatalog(parentId);
    if (!parentCatalog?.length) throw new Error("父宇宙缺少可验证的 bounded 原文目录，无法分叉。");
    const matchingParentIndexes = parentCatalog.flatMap((chapter, index) => chapter.title === parent.entryChapter ? [index] : []);
    const parentEntryIndex = Number.isSafeInteger(parent.entryChapterIndex) &&
      parent.entryChapterIndex! >= 0 && parent.entryChapterIndex! < parentCatalog.length
      ? parent.entryChapterIndex!
      : matchingParentIndexes.length === 1 ? matchingParentIndexes[0]! : -1;
    if (parentEntryIndex < 0 || parentCatalog[parentEntryIndex]?.title !== parent.entryChapter) {
      throw new Error("父宇宙的原文起点无法通过 bounded 章节目录唯一定位，拒绝创建可能泄漏未来剧情的分支。");
    }
    const copiedCanon = await copyOriginalCanonToUniverse(parentId, stagingDir, path.resolve("."));
    if (!copiedCanon) throw new Error("父宇宙缺少自己的时点原文副本，拒绝创建分支；不能回退读取完整原著。");
    rebindKnowledgeDatabase(path.join(stagingDir, "novel.db"), id);
    restrictKnowledgeDatabaseToEntry(path.join(stagingDir, "novel.db"), id, parent.entryChapter, parent.entryChapterId);
    const universe: StoryUniverse = {
      id, sourceWorldId: parent.sourceWorldId, name, type: parent.type,
      entryChapter: parent.entryChapter,
      entryChapterId: parent.entryChapterId,
      entryChapterIndex: parentEntryIndex,
      entryOrdinal: parent.entryOrdinal,
      ...(parent.sourceCanonHash ? { sourceCanonHash: parent.sourceCanonHash } : {}),
      brief: parent.brief,
      parentUniverseId: parent.id, forkPoint: forkRun.id,
      createdAt: new Date().toISOString()
    };
    await writeFile(path.join(stagingDir, "universe.json"), JSON.stringify(universe, null, 2) + "\n", "utf8");
    await writeFile(path.join(stagingDir, "world-bible.md"), buildUniverseWorldBible(universe), "utf8");
    await writeFile(path.join(stagingDir, "source-canon.json"), JSON.stringify({ sourceWorldId: parent.sourceWorldId, readOnly: true }, null, 2) + "\n", "utf8");
    await writeForkedUniverseCanonSnapshots(parentId, stagingDir, id);

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
  }
});

// ── 同一世界下的独立 Story Unit 资料管理 ────────────────────
app.get("/api/worlds/:worldId/story-units", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const units = await listStoredStoryUnits(worldDir(id), id);
    res.json({ storyUnits: units.map(unit => validateStoryUnit(unit, id)) });
  } catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-units/:storyUnitId/versions/:versionId/restore", async (req, res) => {
  const id = worldIdOf(req.params.worldId);
  let reserved = false;
  try {
    assertInsideWorld(id);
    if (chapterGenerationReservations.has(id) || storyExecutionReservations.has(id) || activeStoryExecutions.has(id)) {
      return void res.status(409).json({ error: "章节或完整故事执行期间不能恢复故事设计版本。" });
    }
    chapterGenerationReservations.add(id); reserved = true;
    await serializeWorld(id, async () => {
      if ((await listRuns(id)).some(run => run.kind === "chapter" && ["queued","running"].includes(run.status)) ||
          (await listStoryExecutions(id)).some(task => ["queued","running","paused"].includes(task.status))) {
        return void res.status(409).json({ error: "当前仍有未结束的章节或故事任务，不能恢复故事设计版本。" });
      }
      const storyUnitId = recordId(req.params.storyUnitId);
      const versionId = recordId(req.params.versionId);
      const current = await getStoredStoryUnit(worldDir(id), id, storyUnitId);
      if (!current) return void res.status(404).json({ error: "Story Unit not found." });
      const historical = await getStoredStoryUnitVersion(worldDir(id), id, storyUnitId, versionId);
      if (!historical) return void res.status(404).json({ error: "Story Unit version not found." });
      await archiveStoredStoryUnitVersion(worldDir(id), current);
      const restored = { ...historical, id: storyUnitId, worldId: id, updatedAt: new Date().toISOString() };
      await saveStoredStoryUnit(worldDir(id), restored);
      res.json({ storyUnit: validateStoryUnit(restored, id) });
    });
  } catch (error) { sendError(res, error); }
  finally { if (reserved) chapterGenerationReservations.delete(id); }
});
app.get("/api/worlds/:worldId/story-units/:storyUnitId/versions", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const storyUnitId = recordId(req.params.storyUnitId);
    if (!await getStoredStoryUnit(worldDir(id), id, storyUnitId)) return void res.status(404).json({ error: "Story Unit not found." });
    res.json({ versions: await listStoredStoryUnitVersions(worldDir(id), id, storyUnitId) });
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
    if (chapterGenerationReservations.has(id)) return void res.status(409).json({ error: "当前世界已有写入任务正在启动。" });
    chapterGenerationReservations.add(id);
    try {
      if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id)) return void res.status(409).json({ error: "章节或完整故事执行期间不能创建或重写故事单元。" });
      if ((await listRuns(id)).some(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"))) return void res.status(409).json({ error: "当前仍有章节正在执行，不能同时重写故事单元。" });
      if ((await listStoryExecutions(id)).some(task => ["queued","running","paused"].includes(task.status))) return void res.status(409).json({ error: "当前仍有未结束的长篇任务，不能同时重写故事单元。" });
      await serializeWorld(id, async () => {
      const dir = worldDir(id);
      const worldBible = await readFile(path.join(dir, "world-bible.md"), "utf8");
      const previousId = typeof req.body?.storyUnitId === "string" ? recordId(req.body.storyUnitId) : undefined;
      const previousRaw = previousId ? await getStoredStoryUnit(dir, id, previousId) : undefined;
      if (previousId && !previousRaw) throw Object.assign(new Error("Story Unit not found."), { status: 404 });
      const previous = previousRaw ? validateStoryUnit(previousRaw, id) : undefined;
      // Re-thinking an existing unit must use that unit's committed story state.
      // Only a brand-new unit starts from the legacy/world-level continuation state.
      const statePath = previousId
        ? path.join(dir, ".story-units", previousId, "story-state.json")
        : path.join(dir, "story-state.json");
      const state = await loadStoryState(statePath, id);
      const query = [state.currentPosition, ...state.plotThreads.map(x => x.title), ...state.characters.slice(0, STORY_ANALYSIS_QUERY_CHARACTERS).map(x => x.name)].join("\n");
      const storyAnalysisContext = buildStoryAnalysisContext(readStoryAnalysis(dir, id), query);
      const brief = typeof req.body?.brief === "string" ? req.body.brief.trim().slice(0, 8000) : "";
      const model = typeof req.body?.model === "string" ? req.body.model : undefined;
      const generated = await generateStoryUnit({ worldId: id, worldBible, state, storyAnalysisContext, previous, brief, model });
      let unit: Record<string, unknown>;
      if (previous) {
        // Keep every prior design immutable so regeneration is reversible and inspectable.
        await archiveStoredStoryUnitVersion(dir, { ...previous, id: previousId! });
        unit = { ...generated, id: previous.id };
        await saveStoredStoryUnit(dir, unit as never);
      } else {
        unit = await createStoredStoryUnit(dir, generated as never);
      }
      res.json({ storyUnit: validateStoryUnit(unit, id) });
      });
    } finally { chapterGenerationReservations.delete(id); }
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
    if (chapterGenerationReservations.has(id)) return void res.status(409).json({ error: "当前世界已有写入任务正在启动。" });
    chapterGenerationReservations.add(id);
    try {
      if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id)) return void res.status(409).json({ error: "章节或完整故事执行期间不能重写故事单元设计。" });
      if ((await listRuns(id)).some(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"))) return void res.status(409).json({ error: "当前仍有章节正在执行，不能同时重写故事单元设计。" });
      if ((await listStoryExecutions(id)).some(task => ["queued","running","paused"].includes(task.status))) return void res.status(409).json({ error: "当前仍有未结束的长篇任务，不能同时重写故事单元设计。" });
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
    } finally { chapterGenerationReservations.delete(id); }
  } catch (error) { sendError(res, error); }
});


function appendStoryExecutionEvent(task: StoryExecution, event: StoryExecution["events"][number]): StoryExecution {
  return { ...task, events: [...(task.events ?? []), event].slice(-500) };
}
const activeStoryExecutions = new Map<string, Promise<void>>();
const storyExecutionReservations = new Set<string>();
const chapterGenerationReservations = new Set<string>();
function storyExecutionUnitPath(worldId: string, storyUnitId?: string): string {
  return storyUnitId
    ? path.join(worldDir(worldId), ".story-units", recordId(storyUnitId) + ".json")
    : path.join(worldDir(worldId), "story-unit.json");
}

const STORY_STATE_SNAPSHOT_FILES = ["story.db", "story.db-wal", "story.db-shm", "story-state.json", "story-arc.md"] as const;
function storyStateSnapshotDir(worldId: string, runId: string): string {
  return path.resolve(".output", worldId, "workbench", "state-snapshots", recordId(runId));
}

/** Snapshot the authoritative SQLite state and its JSON/arc mirrors before a chapter can mutate them. */
async function createStoryStateSnapshot(worldId: string, storyUnitIdInput: string | undefined, runId: string): Promise<void> {
  const storyUnitId = storyUnitIdInput ? recordId(storyUnitIdInput) : undefined;
  const stateDir = storyUnitId ? path.join(worldDir(worldId), ".story-units", storyUnitId) : worldDir(worldId);
  const statePath = path.join(stateDir, "story-state.json");
  await loadStoryState(statePath, worldId);
  const db = new DatabaseSync(path.join(stateDir, "story.db"));
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { db.close(); }
  await rm(path.join(stateDir, "story.db-wal"), { force: true });
  await rm(path.join(stateDir, "story.db-shm"), { force: true });
  const snapshotDir = storyStateSnapshotDir(worldId, runId);
  await rm(snapshotDir, { recursive: true, force: true });
  await mkdir(snapshotDir, { recursive: true });
  const files: Record<string, boolean> = {};
  for (const name of STORY_STATE_SNAPSHOT_FILES) {
    try { await copyFile(path.join(stateDir, name), path.join(snapshotDir, name)); files[name] = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files[name] = false; }
  }
  const unitFile = storyExecutionUnitPath(worldId, storyUnitId);
  try { await copyFile(unitFile, path.join(snapshotDir, "story-unit-record.json")); files["story-unit-record.json"] = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files["story-unit-record.json"] = false; }
  if (storyUnitId) {
    const indexFile = path.join(worldDir(worldId), ".story-units", "index.json");
    try { await copyFile(indexFile, path.join(snapshotDir, "story-units-index.json")); files["story-units-index.json"] = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files["story-units-index.json"] = false; }
  }
  await writeFile(path.join(snapshotDir, "manifest.json"), JSON.stringify({ version: 1, worldId, storyUnitId: storyUnitId ?? null, files }, null, 2) + "\n", "utf8");
}

/** Roll back a chapter whose process died or failed before all final gates passed. */
async function restoreStoryStateSnapshot(worldId: string, run: WorkbenchRun): Promise<boolean> {
  const storyUnitId = run.storyUnitId ? recordId(run.storyUnitId) : undefined;
  const snapshotDir = storyStateSnapshotDir(worldId, run.id);
  let manifest: {version?:number;worldId?:string;storyUnitId?:string|null;files?:Record<string,boolean>};
  try { manifest = JSON.parse(await readFile(path.join(snapshotDir, "manifest.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (manifest.version !== 1 || manifest.worldId !== worldId || manifest.storyUnitId !== (storyUnitId ?? null) || !manifest.files) {
    throw new Error("章节状态快照归属不匹配，拒绝恢复到其他故事宇宙。");
  }
  const stateDir = storyUnitId ? path.join(worldDir(worldId), ".story-units", storyUnitId) : worldDir(worldId);
  await mkdir(stateDir, { recursive: true });
  for (const name of STORY_STATE_SNAPSHOT_FILES) {
    const target = path.join(stateDir, name);
    if (manifest.files[name]) {
      const temporary = target + "." + randomUUID() + ".restore";
      await copyFile(path.join(snapshotDir, name), temporary);
      await rename(temporary, target);
    } else {
      await rm(target, { force: true });
    }
  }
  const unitFile = storyExecutionUnitPath(worldId, storyUnitId);
  if (manifest.files["story-unit-record.json"]) {
    const temporary = unitFile + "." + randomUUID() + ".restore";
    await copyFile(path.join(snapshotDir, "story-unit-record.json"), temporary);
    await rename(temporary, unitFile);
  } else {
    await rm(unitFile, { force: true });
  }
  if (storyUnitId) {
    const indexFile = path.join(worldDir(worldId), ".story-units", "index.json");
    if (manifest.files["story-units-index.json"]) {
      const temporary = indexFile + "." + randomUUID() + ".restore";
      await copyFile(path.join(snapshotDir, "story-units-index.json"), temporary);
      await rename(temporary, indexFile);
    } else {
      await rm(indexFile, { force: true });
    }
  }
  await rm(snapshotDir, { recursive: true, force: true });
  return true;
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

/** Reconcile Story Unit progress counters from durable execution checkpoints after crash recovery. */
async function syncStoryUnitCheckpointIds(
  worldId: string, task: StoryExecution, unitInput?: Awaited<ReturnType<typeof generateStoryUnit>>
): Promise<Awaited<ReturnType<typeof generateStoryUnit>> | undefined> {
  if (!task.storyUnitId) return unitInput;
  const unit = unitInput ?? await loadExecutionStoryUnit(worldId, task.storyUnitId);
  const completedChapterIds = [...new Set([...unit.execution.completedChapterIds, ...task.completedChapters.map(item => item.runId)])];
  if (completedChapterIds.length === unit.execution.completedChapterIds.length) return unit;
  const updated = { ...unit, updatedAt: new Date().toISOString(), execution: { ...unit.execution, completedChapterIds } };
  await saveExecutionStoryUnit(updated);
  return updated;
}

async function recordSingleChapterCompletion(worldId: string, storyUnitId: string, runId: string): Promise<void> {
  const unit = await loadExecutionStoryUnit(worldId, storyUnitId);
  if (unit.execution.completedChapterIds.includes(runId)) return;
  const updatedAt = new Date().toISOString();
  await saveExecutionStoryUnit({
    ...unit, updatedAt,
    execution: { ...unit.execution, status: "in_progress", completedChapterIds: [...unit.execution.completedChapterIds, runId] }
  });
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
  await mkdir(outputDir, { recursive: true });
  await saveRun(run);
  try {
    await createStoryStateSnapshot(worldId, storyUnitId, runId);
    await onRunStarted?.(run);
  } catch (error) {
    await restoreStoryStateSnapshot(worldId, run).catch(() => false);
    await saveRun({ ...run, status: "failed", updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
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
  let rollbackError = "";
  if (!completed) {
    try { await restoreStoryStateSnapshot(worldId, run); }
    catch (error) { rollbackError = error instanceof Error ? error.message : String(error); }
  }
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
  await saveRun(rollbackError ? { ...finished, error: (finished.error ?? "章节未通过最终门禁。") + "；状态回滚失败：" + rollbackError } : finished);
  if (completed || !rollbackError) await rm(storyStateSnapshotDir(worldId, runId), { recursive: true, force: true }).catch(() => undefined);
  return rollbackError ? { ...finished, error: (finished.error ?? "章节未通过最终门禁。") + "\\n状态回滚失败：" + rollbackError } : finished;
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
      ...unitInput.execution,
      completedChapterIds: unitInput.execution.completedChapterIds.includes(checkpoint.runId) ? unitInput.execution.completedChapterIds : [...unitInput.execution.completedChapterIds, checkpoint.runId],
      status: naturallyComplete ? "completed" as const : "in_progress" as const,
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
  const outputRoot = path.resolve(".output", input.worldId) + path.sep;
  for (const checkpoint of input.completedChapters) {
    const savedRun = await getRun(input.worldId, checkpoint.runId);
    if (!savedRun || savedRun.kind !== "chapter" || savedRun.status !== "completed" ||
        !storyExecutionOwnsRun(input.storyUnitId, savedRun.storyUnitId) ||
        !savedRun.chapterPath || path.resolve(savedRun.chapterPath) !== path.resolve(checkpoint.chapterPath)) {
      throw new Error("故事执行检查点与章节 Run 的归属或完成状态不一致，拒绝跨单元恢复。");
    }
    const chapterPath = path.resolve(checkpoint.chapterPath);
    if (!chapterPath.startsWith(outputRoot)) throw new Error("故事执行检查点的章节路径不属于当前世界输出目录，拒绝恢复。");
    await readFile(chapterPath, "utf8");
  }
  if (!input.currentRunId) return input;
  const run = await getRun(input.worldId, input.currentRunId);
  if (!run) throw new Error("中断任务引用的当前章节 Run 不存在，无法确认章节是否已完成或状态是否已回滚；已停止自动恢复。");
  if (run.kind !== "chapter" || !storyExecutionOwnsRun(input.storyUnitId, run.storyUnitId)) {
    throw new Error("中断任务的当前 Run 属于其他故事单元，拒绝恢复。");
  }
  if (run?.status === "failed") {
    const restored = await restoreStoryStateSnapshot(input.worldId, run);
    if (!restored && !storyRunStateWasRolledBack(run.error)) {
      throw new Error("当前检查点来自没有事务快照保护的旧版中断章节，无法证明 Story State 未被部分提交。为避免重复或错乱剧情，已停止自动恢复；需要先人工核对该章节的 Story State。");
    }
  }
  if (run?.kind === "chapter" && storyExecutionOwnsRun(input.storyUnitId, run.storyUnitId) && run.status === "completed" && run.chapterPath &&
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
    unit = await syncStoryUnitCheckpointIds(worldId, task, unit) ?? unit;
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
    const previous = latestCompletedChapterForStoryUnit(runs, task.storyUnitId);
    let previousChapterPath = task.completedChapters.at(-1)?.chapterPath
      ? path.resolve(task.completedChapters.at(-1)!.chapterPath)
      : previous?.chapterPath ? path.resolve(previous.chapterPath) : undefined;
    if (previousChapterPath) {
      const outputRoot = path.resolve(".output", worldId) + path.sep;
      if (!previousChapterPath.startsWith(outputRoot)) throw new Error("最近章节正文路径不属于当前故事输出目录，已停止以避免串线。");
      await readFile(previousChapterPath, "utf8");
    }
    task = mergeStoryExecutionControlFlags(task, await getStoryExecution(worldId, task.id));
    task = { ...task, status: "running", startedAt: task.startedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), resumeCount: task.resumeCount + (task.startedAt ? 1 : 0), error: undefined };
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
        task = appendStoryExecutionEvent({ ...task, status: "failed", error: "章节未通过现有终审或 Story State 提交门禁。修复该章节后可从最后一个已完成检查点恢复。"+(chapterRun.error?" "+chapterRun.error:""), updatedAt: failedAt, currentRunId: chapterRun.error?.includes("状态回滚失败") ? chapterRun.id : undefined }, { at: failedAt, type: "failed", message: "章节未通过终审或状态提交门禁" });
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
    task = appendStoryExecutionEvent({ ...task, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() }, { at: new Date().toISOString(), type: "failed", message: (error instanceof Error ? error.message : String(error)).slice(0, 1200) });
    await saveStoryExecution(task).catch(() => undefined);
  }
}


async function executeFixedChapterBatch(initial: StoryExecution): Promise<void> {
  let task = initial;
  const worldId = task.worldId;
  try {
    task = await reconcileStoryExecutionCurrentRun(task);
    await syncStoryUnitCheckpointIds(worldId, task);
    const dir = worldDir(worldId);
    const universe = await readUniverse(worldId);
    if (universe?.archivedAt) throw new Error("当前故事宇宙已归档。");
    if (universe) await ensureUniverseStoryAnalysis(worldId, universe);
    await readFile(path.join(dir, "world-bible.md"), "utf8");
    const libraryDir = await resolveWorldLibraryDir(worldId, path.resolve("worlds"));
    await readFile(path.join(libraryDir, "index.json"), "utf8");
    const runs = await listRuns(worldId);
    const previous = latestCompletedChapterForStoryUnit(runs, task.storyUnitId);
    let previousChapterPath = task.completedChapters.at(-1)?.chapterPath
      ? path.resolve(task.completedChapters.at(-1)!.chapterPath)
      : previous?.chapterPath ? path.resolve(previous.chapterPath) : undefined;
    if (previousChapterPath) {
      const outputRoot = path.resolve(".output", worldId) + path.sep;
      if (!previousChapterPath.startsWith(outputRoot)) throw new Error("最近章节正文路径不属于当前故事输出目录，已停止以避免串线。");
      await readFile(previousChapterPath, "utf8");
    }
    task = mergeStoryExecutionControlFlags(task, await getStoryExecution(worldId, task.id));
    task = { ...task, status: "running", startedAt: task.startedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), resumeCount: task.resumeCount + (task.startedAt ? 1 : 0), error: undefined };
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

function startStoryUnitExecution(task: StoryExecution): boolean {
  if (activeStoryExecutions.has(task.worldId)) return false;
  const worker = task.mode === "fixed_batch" ? executeFixedChapterBatch(task) : executeStoryUnitTask(task);
  const promise = worker.finally(() => activeStoryExecutions.delete(task.worldId));
  activeStoryExecutions.set(task.worldId, promise);
  return true;
}


app.get("/api/worlds/:worldId/story-executions", async (req, res) => {
  try { const id = worldIdOf(req.params.worldId); assertInsideWorld(id); const query = req.query.storyUnitId; const storyUnitId = typeof query === "string" ? query === "legacy" ? null : recordId(query) : undefined; res.json({ executions: await listStoryExecutions(id, storyUnitId) }); }
  catch (error) { sendError(res, error); }
});
app.post("/api/worlds/:worldId/story-executions", async (req, res) => {
  let reservedId: string | undefined;
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id) || chapterGenerationReservations.has(id)) return void res.status(409).json({ error: "当前世界已有章节或故事任务正在执行或启动。" });
    storyExecutionReservations.add(id);
    reservedId = id;
    const requestedUnitId = typeof req.body?.storyUnitId === "string" ? recordId(req.body.storyUnitId) : undefined;
    const runs = await listRuns(id);
    const activeChapter = runs.find(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"));
    if (activeChapter) return void res.status(409).json({ error: "当前已有单章任务运行，请完成后再启动完整故事。" });
    const unit = await loadExecutionStoryUnit(id, requestedUnitId);
    const universe = await readUniverse(id);
    if (universe?.archivedAt) return void res.status(409).json({error:"当前故事宇宙已归档，不能启动完整故事执行。"});
    await readFile(path.join(worldDir(id), "world-bible.md"), "utf8");
    const retrievalDir = await resolveWorldLibraryDir(id, path.resolve("worlds"));
    await readFile(path.join(retrievalDir, "index.json"), "utf8");
    if (unit.execution.status === "completed") return void res.status(409).json({ error: "当前故事单元已自然收束。若要创作新故事，请创建新的故事单元或复制一个新宇宙。" });
    const previousTasks = await listStoryExecutions(id);
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
    if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id) || chapterGenerationReservations.has(id)) return void res.status(409).json({error:"当前世界已有章节或长篇任务正在执行。"});
    storyExecutionReservations.add(id); reservedId = id;
    const requestedUnitId = typeof req.body?.storyUnitId === "string" ? recordId(req.body.storyUnitId) : undefined;
    const count = Number(req.body?.chapterCount);
    if (!Number.isSafeInteger(count) || count < 1) return void res.status(400).json({error:"chapterCount 必须是大于 0 的整数。"});
    const runs = await listRuns(id);
    const activeChapter = runs.find(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"));
    if (activeChapter) return void res.status(409).json({error:"当前已有章节正在生成，请完成后再启动批量任务。"});
    const universe = await readUniverse(id);
    if (universe?.archivedAt) return void res.status(409).json({error:"当前故事宇宙已归档。"});
    await readFile(path.join(worldDir(id), "world-bible.md"), "utf8");
    const retrievalDir = await resolveWorldLibraryDir(id, path.resolve("worlds"));
    await readFile(path.join(retrievalDir, "index.json"), "utf8");
    const previousTasks = await listStoryExecutions(id);
    const latest = previousTasks.find(item => ["running","queued","paused"].includes(item.status));
    if (latest) return void res.status(409).json({error:"已有长篇任务，请恢复或取消后再启动批量任务。",execution:latest});
    let title = "连续章节批次";
    if (requestedUnitId) {
      const unit = await loadExecutionStoryUnit(id, requestedUnitId);
      if (unit.execution.status === "completed") return void res.status(409).json({error:"当前完整故事已经自然收束，请创建新的故事单元后再继续生成。"});
      title = unit.title;
    } else {
      try {
        const unit = await loadExecutionStoryUnit(id);
        if (unit.execution.status === "completed") return void res.status(409).json({error:"当前完整故事已经自然收束，请创建新的故事单元后再继续生成。"});
        title = unit.title;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
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
  let reservedId: string | undefined;
  try {
    const id = worldIdOf(req.params.worldId); const executionId = recordId(req.params.executionId);
    if (activeStoryExecutions.has(id) || storyExecutionReservations.has(id) || chapterGenerationReservations.has(id)) return void res.status(409).json({error:"当前世界已有章节或故事任务正在执行或启动。"});
    storyExecutionReservations.add(id); reservedId = id;
    if ((await listRuns(id)).some(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"))) return void res.status(409).json({error:"当前仍有章节正在执行，不能同时恢复长篇任务。"});
    const task = await getStoryExecution(id, executionId);
    if (!task) return void res.status(404).json({error:"Story execution not found."});
    if (!["paused","failed","stalled"].includes(task.status)) return void res.status(409).json({error:"当前任务不可恢复。",execution:task});
    const otherPending = (await listStoryExecutions(id)).find(item => item.id !== task.id && ["queued","running","paused"].includes(item.status));
    if (otherPending) return void res.status(409).json({error:"当前世界还有其他未结束的故事任务，请先处理该任务。",execution:otherPending});
    const resumedAt = new Date().toISOString();
    const updated = appendStoryExecutionEvent({...task,status:"queued" as const,pauseRequested:false,cancelRequested:false,error:undefined,completedAt:undefined,updatedAt:resumedAt}, { at: resumedAt, type: "resumed", message: "恢复任务执行" });
    await saveStoryExecution(updated);
    startStoryUnitExecution(updated);
    res.status(202).json({execution:updated});
  } catch (error) { sendError(res, error); }
  finally { if (reservedId) storyExecutionReservations.delete(reservedId); }
});
app.post("/api/worlds/:worldId/story-executions/:executionId/cancel", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); const executionId = recordId(req.params.executionId);
    const task = await getStoryExecution(id, executionId);
    if (!task) return void res.status(404).json({error:"Story execution not found."});
    if (!["running","queued","paused"].includes(task.status)) return void res.status(409).json({error:"当前任务不能取消。",execution:task});
    const now = new Date().toISOString();
    // A worker only exists in this process. After a restart, an orphaned queued/running
    // record must be cancellable immediately instead of waiting for a worker that no longer exists.
    const workerIsAlive = activeStoryExecutions.has(id);
    const cancelImmediately = task.status === "paused" || !workerIsAlive;
    const updated = cancelImmediately
      ? appendStoryExecutionEvent({
          ...task, status:"cancelled" as const, cancelRequested:true,
          completedAt:now, updatedAt:now
        }, { at:now, type:"cancelled", message:workerIsAlive ? "已取消暂停任务。" : "任务没有活动执行器，已清理残留执行状态。" })
      : {...task,cancelRequested:true,updatedAt:now};
    await saveStoryExecution(updated); res.json({execution:updated});
  } catch (error) { sendError(res, error); }
});

// ── 当前滚动式多章节 Story Arc ─────────────────────────────
app.get("/api/worlds/:worldId/story-arc", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const rawUnitId = req.query.storyUnitId;
    const storyUnitId = typeof rawUnitId === "string" && rawUnitId !== "legacy" ? recordId(rawUnitId) : undefined;
    if (storyUnitId && !await getStoredStoryUnit(worldDir(id), id, storyUnitId)) return void res.status(404).json({ error: "Story Unit not found." });
    const arcPath = storyUnitId ? path.join(worldDir(id), ".story-units", storyUnitId, "story-arc.md") : path.join(worldDir(id), "story-arc.md");
    const content = await readFile(arcPath, "utf8").catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    res.json({ storyArc: content });
  } catch (error) { sendError(res, error); }
});

app.get("/api/worlds/:worldId/story-units/:storyUnitId/state", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const storyUnitId = recordId(req.params.storyUnitId);
    const unit = await getStoredStoryUnit(worldDir(id), id, storyUnitId);
    if (!unit) return void res.status(404).json({ error: "Story Unit not found." });
    const state = await loadStoryState(path.join(worldDir(id), ".story-units", storyUnitId, "story-state.json"), id);
    res.json({ storyUnitId, storyUnitTitle: unit.title, state, graph: buildStoryStateGraph(state) });
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
async function sequelGraphResponse(source: "sequel", id: string, dir: string, query: string, limit: number, storyUnitId?: string | null): Promise<GraphResponse> {
  const statePath = storyUnitId
    ? path.join(dir, ".story-units", storyUnitId, "story-state.json")
    : path.join(dir, "story-state.json");
  const state: StoryState = await loadStoryState(statePath, id);
  return { source, scope: storyUnitId ? "story-unit" : "legacy", storyUnitId: storyUnitId ?? null, available: true, ...filterGraph(buildStoryStateGraph(state), query, limit) };
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
    const rawUnitId = req.query.storyUnitId;
    let storyUnitId: string | null | undefined;
    if (rawUnitId === "legacy") storyUnitId = null;
    else if (typeof rawUnitId === "string") {
      storyUnitId = recordId(rawUnitId);
      const unit = await getStoredStoryUnit(dir, id, storyUnitId);
      if (!unit) return void res.status(404).json({ error: "Story Unit not found." });
    }
    res.json(await sequelGraphResponse(source, id, dir, query, limit, storyUnitId));
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
    const storyUnitQuery = req.query.storyUnitId;
    const storyUnitId = typeof storyUnitQuery === "string" ? storyUnitQuery === "legacy" ? null : recordId(storyUnitQuery) : undefined;
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
    if (chapterGenerationReservations.has(lockId)) return void res.status(409).json({ error: "当前世界已有单章任务正在启动。" });
    chapterGenerationReservations.add(lockId);
    try {
    if (activeStoryExecutions.has(lockId) || storyExecutionReservations.has(lockId)) return void res.status(409).json({ error: "完整故事任务正在执行或启动，请暂停或取消后再单独生成章节。" });
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
    if (requestedStoryUnitId) {
      const unit = await loadExecutionStoryUnit(id, requestedStoryUnitId);
      if (unit.execution.status === "completed") return void res.status(409).json({ error: "当前故事单元已经自然收束；如需继续创作，请创建新的 Story Unit。" });
    }
    const allRuns = await listRuns(id);
    const runs = allRuns.filter(run => run.kind === "chapter" && (requestedStoryUnitId ? run.storyUnitId === requestedStoryUnitId : !run.storyUnitId));
    const active = allRuns.find(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"));
    if (active) return void res.status(409).json({ error: "当前世界已有章节正在生成；为保护共享索引和 Story Unit 元数据，同一 World 同时只运行一个章节任务。", run: active });

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
    if (universe) await ensureWritingKnowledgeBuildStarted(id);
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
    try {
      await mkdir(outputDir, { recursive: true });
      await createStoryStateSnapshot(id, requestedStoryUnitId, runId);
    } catch (error) {
      await restoreStoryStateSnapshot(id, run).catch(() => false);
      await saveRun({ ...run, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
      throw error;
    }
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
    await saveRun({ ...run, status: "running", updatedAt: new Date().toISOString() });
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errors = ""; let settled = false;
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { errors += chunk; });
    child.on("error", error => {
      if (settled) return; settled = true;
      void (async () => {
        await restoreStoryStateSnapshot(id, run).catch(() => false);
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
        let rollbackError = "";
        if (!completed) {
          try { await restoreStoryStateSnapshot(id, run); }
          catch (error) { rollbackError = error instanceof Error ? error.message : String(error); }
        }
        const result = { exitCode: code, chapterPath: chapterPath ?? null, finalChapterExists, qualityPassed, stateCommitted, completed, rollbackError: rollbackError || undefined };
        await Promise.all([
          writeFile(path.join(outputDir, "process.stdout.log"), output, "utf8"),
          writeFile(path.join(outputDir, "process.stderr.log"), errors, "utf8"),
          writeFile(path.join(outputDir, "process-result.json"), JSON.stringify(result, null, 2) + "\n", "utf8")
        ]);
        if (completed && requestedStoryUnitId) await recordSingleChapterCompletion(id, requestedStoryUnitId, runId);
        await saveRun({
          ...run, status: completed ? "completed" : "failed",
          ...(chapterPath && finalChapterExists ? { chapterPath } : {}),
          ...(!completed ? { error: ("章节流程未完成：exit=" + code + "；正文=" + finalChapterExists + "；终审=" + qualityPassed + "；状态提交=" + stateCommitted + "\n" + (errors || output).slice(-5000) + (rollbackError ? "\n状态回滚失败：" + rollbackError : "")) } : {}),
          updatedAt: new Date().toISOString()
        });
        if (completed || !rollbackError) await rm(storyStateSnapshotDir(id, runId), { recursive: true, force: true }).catch(() => undefined);
      })().catch(async error => {
        let rollbackError = "";
        try { await restoreStoryStateSnapshot(id, run); } catch (cause) { rollbackError = cause instanceof Error ? cause.message : String(cause); }
        await saveRun({ ...run, status: "failed", error: "Finalizing chapter run failed: " + String(error) + (rollbackError ? "; state rollback failed: " + rollbackError : ""), updatedAt: new Date().toISOString() });
      });
    });
    res.status(202).json({ run });
    });
    } finally { chapterGenerationReservations.delete(lockId); }
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
    const recoverableChapters = (await listRuns(id)).filter(run => run.kind === "chapter" && ["queued","running","failed"].includes(run.status));
    for (const run of recoverableChapters) {
      try {
        const restored = await restoreStoryStateSnapshot(id, run);
        if (restored) {
          await saveRun({ ...run, status: "failed", updatedAt: new Date().toISOString(),
            error: (run.error ?? "服务重启前章节未完成。") + "；已回滚到章节开始前的 Story State 快照。" });
        }
      } catch (error) {
        await saveRun({ ...run, status: "failed", updatedAt: new Date().toISOString(),
          error: "服务重启后恢复章节前状态失败，已停止自动续写以避免剧情状态不一致：" + (error instanceof Error ? error.message : String(error)) });
      }
    }
    await recoverInterruptedRuns(id);
    await recoverStoryExecutions(id);
  }));
}
