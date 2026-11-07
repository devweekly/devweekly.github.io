// Workbench 运行记录与 Story Plan 候选版本。
// 状态保存在忽略目录 .output/<world>/workbench/ 下，属于运行历史而不是正史；
// 正式 Story Plan 仍在 worlds/<world>/story-plan.json。
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface WorkbenchRun {
  id: string; worldId: string; kind: "story-plan" | "chapter";
  status: RunStatus; createdAt: string; updatedAt: string;
  error?: string; candidateId?: string; outputDir?: string; chapterPath?: string;
}

export interface StoryPlanCandidate {
  id: string; worldId: string; type: "story-plan";
  status: "applied" | "superseded" | "pending" | "approved" | "rejected" | "changes_requested";
  createdAt: string; updatedAt: string; baseUpdatedAt: string | null;
  plan: unknown; runId: string; reviewComment?: string;
}

// ── 文件读写基础 ────────────────────────────────────────────

/** 读取单条 JSON 记录；文件不存在时回落到调用方给的 fallback。 */
async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

/** 原子写入：先写临时文件再 rename，进程崩溃不会留下半个 JSON。 */
async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + process.pid + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}

function root(worldId: string): string {
  return join(process.cwd(), ".output", worldId, "workbench");
}

function runPath(worldId: string, id: string): string {
  return join(root(worldId), "runs", id + ".json");
}

function candidatePath(worldId: string, id: string): string {
  return join(root(worldId), "candidates", id + ".json");
}

/** 列出目录下全部 JSON 记录，按创建时间倒序；目录不存在视为空。 */
async function listRecords<T extends { createdAt: string }>(dir: string): Promise<T[]> {
  try {
    const names = await readdir(dir);
    const rows = await Promise.all(
      names.filter(x => x.endsWith(".json")).map(x => readJson<T | undefined>(join(dir, x), undefined))
    );
    return rows
      .flatMap(row => row ? [row] : [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// ── 运行记录 ────────────────────────────────────────────────

export async function saveRun(run: WorkbenchRun): Promise<void> {
  await atomicJson(runPath(run.worldId, run.id), run);
}

export async function getRun(worldId: string, id: string): Promise<WorkbenchRun | undefined> {
  return readJson<WorkbenchRun | undefined>(runPath(worldId, id), undefined);
}

export async function listRuns(worldId: string): Promise<WorkbenchRun[]> {
  return listRecords<WorkbenchRun>(join(root(worldId), "runs"));
}

// ── 候选版本 ────────────────────────────────────────────────

export async function saveCandidate(candidate: StoryPlanCandidate): Promise<void> {
  await atomicJson(candidatePath(candidate.worldId, candidate.id), candidate);
}

export async function getCandidate(worldId: string, id: string): Promise<StoryPlanCandidate | undefined> {
  return readJson<StoryPlanCandidate | undefined>(candidatePath(worldId, id), undefined);
}

export async function listCandidates(worldId: string): Promise<StoryPlanCandidate[]> {
  return listRecords<StoryPlanCandidate>(join(root(worldId), "candidates"));
}

/** 服务启动时把上次进程中断的 queued/running 记录标记为失败；不复活任务，重试要显式新建。 */
export async function recoverInterruptedRuns(worldId: string): Promise<number> {
  const runs = await listRuns(worldId);
  let recovered = 0;
  for (const run of runs) {
    if (run.status === "queued" || run.status === "running") {
      await saveRun({
        ...run,
        status: "failed",
        error: "Server restarted before this run completed. Create a new candidate to retry.",
        updatedAt: new Date().toISOString()
      });
      recovered++;
    }
  }
  return recovered;
}
