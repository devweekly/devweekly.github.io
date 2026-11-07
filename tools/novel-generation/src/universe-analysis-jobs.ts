import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/** Rebuild from bounded local inputs; failures never block writing. */
export async function startUniverseAnalysisRebuild(worldId: string, entryChapter: string): Promise<UniverseAnalysisJob> {
  const previous = await readUniverseAnalysisJob(worldId);
  if (previous?.status === "queued" || previous?.status === "running") return previous;

  const now = new Date().toISOString();
  const logPath = path.resolve(".output", worldId, "workbench", "as-of-analysis.log");
  const queued: UniverseAnalysisJob = {
    worldId, kind: "as-of-story-analysis", status: "queued",
    createdAt: now, updatedAt: now, entryChapter, logPath
  };
  await writeJob(queued);
  const running: UniverseAnalysisJob = { ...queued, status: "running", updatedAt: new Date().toISOString() };
  await writeJob(running);

  let logFd: number | undefined;
  try {
    logFd = openSync(logPath, "a");
    const child = spawn(process.execPath, [
      "--import", "tsx", "src/cli.ts", "analyze-story",
      "--world", worldId,
      "--catalog", path.join("analysis", worldId, "chapter-index.json")
    ], {
      cwd: process.cwd(), env: process.env, detached: true,
      stdio: ["ignore", logFd, logFd]
    });
    closeSync(logFd);
    logFd = undefined;

    child.once("error", error => {
      void writeJob({ ...running, status: "failed", error: error.message, updatedAt: new Date().toISOString() });
    });
    child.once("exit", (code, signal) => {
      const updatedAt = new Date().toISOString();
      if (code === 0) {
        void writeJob({ ...running, status: "completed", updatedAt, result: { exitCode: code, signal: signal ?? null } });
      } else {
        void writeJob({
          ...running, status: "failed", updatedAt,
          error: "analyze-story exited with code " + String(code) + (signal ? " (signal " + signal + ")" : "")
        });
      }
    });
    child.unref();
    return running;
  } catch (error) {
    if (logFd !== undefined) closeSync(logFd);
    const failed: UniverseAnalysisJob = {
      ...running, status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString()
    };
    await writeJob(failed);
    return failed;
  }
}
