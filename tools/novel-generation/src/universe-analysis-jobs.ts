import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type UniverseAnalysisStatus = "queued" | "running" | "completed" | "failed";

export interface UniverseAnalysisJob {
  worldId: string;
  kind: "as-of-story-analysis";
  status: UniverseAnalysisStatus;
  createdAt: string;
  updatedAt: string;
  entryChapter: string;
  logPath: string;
  error?: string;
  result?: Record<string, unknown>;
}

function jobPath(worldId: string): string {
  return path.resolve(".output", worldId, "workbench", "as-of-analysis.json");
}

async function writeJob(job: UniverseAnalysisJob): Promise<void> {
  const target = jobPath(job.worldId);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = target + ".tmp";
  await writeFile(temporary, JSON.stringify(job, null, 2) + "\n", "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, target);
}

export async function readUniverseAnalysisJob(worldId: string): Promise<UniverseAnalysisJob | null> {
  try {
    return JSON.parse(await readFile(jobPath(worldId), "utf8")) as UniverseAnalysisJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Rebuild the universe-local story analysis using only its bounded library and
 * bounded chapter catalog. This is deliberately detached from universe creation:
 * writing remains available even when the model/runtime is unavailable.
 */
export async function startUniverseAnalysisRebuild(worldId: string, entryChapter: string): Promise<UniverseAnalysisJob> {
  const previous = await readUniverseAnalysisJob(worldId);
  if (previous?.status === "queued" || previous?.status === "running") return previous;

  const now = new Date().toISOString();
  const logPath = path.resolve(".output", worldId, "workbench", "as-of-analysis.log");
  const job: UniverseAnalysisJob = {
    worldId, kind: "as-of-story-analysis", status: "queued",
    createdAt: now, updatedAt: now, entryChapter, logPath
  };
  await writeJob(job);

  const child = spawn(process.execPath, [
    "--import", "tsx", "src/cli.ts", "analyze-story",
    "--world", worldId,
    "--catalog", path.join("analysis", worldId, "chapter-index.json")
  ], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"]
  });
  child.unref();

  void (async () => {
    try {
      await writeJob({ ...job, status: "running", updatedAt: new Date().toISOString() });
      child.once("error", async error => {
        await writeJob({ ...job, status: "failed", error: error.message, updatedAt: new Date().toISOString() });
      });
      child.once("exit", async (code, signal) => {
        const finishedAt = new Date().toISOString();
        if (code === 0) {
          await writeJob({
            ...job, status: "completed", updatedAt: finishedAt,
            result: { exitCode: code, signal: signal ?? null }
          });
        } else {
          await writeJob({
            ...job, status: "failed", updatedAt: finishedAt,
            error: "analyze-story exited with code " + String(code) + (signal ? " (signal " + signal + ")" : "")
          });
        }
      });
    } catch (error) {
      await writeJob({
        ...job, status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString()
      });
    }
  })();

  return job;
}
