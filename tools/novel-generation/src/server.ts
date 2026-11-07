// Workbench Express API 组装。这里只做三件事：参数校验、错误映射和响应序列化；
// 领域逻辑（Story Plan、Story State、故事图谱、风格参考）全部走共享 domain service，
// 不得在路由层复制 prompt 或 schema 逻辑。
import express, { type Request, type Response, type NextFunction } from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadStoryPlan, saveStoryPlan, generateStoryPlan } from "./story-plan.js";
import { loadStoryState } from "./story-state.js";
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

// ── 当前滚动式多章节 Story Arc ─────────────────────────────
app.get("/api/worlds/:worldId/story-arc", async (req, res) => {
  try {
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id);
    const content = await readFile(path.join(worldDir(id), "story-arc.md"), "utf8").catch(error => {
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
app.get("/api/worlds/:worldId/runs", async (req, res) => {
  try { res.json({ runs: await listRuns(worldIdOf(req.params.worldId)) }); } catch (error) { sendError(res, error); }
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
    const id = worldIdOf(req.params.worldId); assertInsideWorld(id); const dir = worldDir(id);
    try { await readFile(path.join(dir, "world-bible.md"), "utf8"); } catch { return void res.status(409).json({ error: "缺少 worlds/" + id + "/world-bible.md。请先建立世界设定；这是续写不可自动猜测的基础资料。" }); }
    try { await readFile(path.join(dir, "library", "index.json"), "utf8"); } catch { return void res.status(409).json({ error: "原著资料库尚未建立。请先导入原著并执行 ingest；其余分析资料可以在续写时按需补齐。" }); }
    const runs = await listRuns(id);
    const active = runs.find(run => run.kind === "chapter" && (run.status === "queued" || run.status === "running"));
    if (active) return void res.status(409).json({ error: "已有章节正在生成。", run: active });

    // 连载默认接续最近一章成功成稿；第一章才从当前世界状态开启新故事。
    const previous = runs
      .filter(run => run.kind === "chapter" && run.status === "completed" && run.chapterPath)
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

    const now = new Date().toISOString();
    const runId = randomUUID(); const outputDir = path.resolve(".output", id, "chapter-" + runId);
    const mode = previousChapterPath ? "continuation" : "derivative";
    const run: WorkbenchRun = {
      id: runId, worldId: id, kind: "chapter", status: "queued",
      createdAt: now, updatedAt: now, outputDir,
      ...(previousChapterPath ? { previousChapterPath } : {})
    };
    await saveRun(run);
    const args = [
      "--import", "tsx", "src/cli.ts", "write", "--world", id,
      "--mode", mode,
      ...(previousChapterPath ? ["--source", previousChapterPath] : []),
      "--brief", previousChapterPath
        ? "紧接上一章的结尾继续写下一章。保持时间、地点、人物位置、人物认知、情绪和未完成行动的连续性；不要重述上一章，不要无故跳线或重启冲突。若有充分的叙事理由，可以自然转场或切换视角，但必须让因果和时间线成立。"
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
  const worlds = await listWorlds();
  await Promise.all(worlds.map(x => recoverInterruptedRuns(x.id)));
}
