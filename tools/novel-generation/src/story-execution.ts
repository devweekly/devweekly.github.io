import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";

export const StoryExecutionSchema = z.object({
  id: z.string().uuid(), worldId: z.string().min(1), storyUnitId: z.string().uuid().optional(), storyUnitTitle: z.string().min(1),
  mode: z.enum(["complete_story", "fixed_batch"]).default("complete_story"), targetChapterCount: z.number().int().positive().optional(),
  status: z.enum(["queued", "running", "paused", "completed", "failed", "cancelled", "stalled"]),
  createdAt: z.string(), updatedAt: z.string(), startedAt: z.string().optional(), completedAt: z.string().optional(),
  completedChapters: z.array(z.object({ runId: z.string().uuid(), chapterPath: z.string(), completedAt: z.string() })),
  events: z.array(z.object({ at: z.string(), type: z.enum(["created","resumed","chapter_started","chapter_completed","assessment","paused","completed","failed","cancelled","stalled"]), message: z.string(), runId: z.string().uuid().optional() }).strict()).default([]),
  currentRunId: z.string().uuid().optional(), lastAssessment: z.string().optional(), nextDirection: z.string().optional(),
  idleChapterCount: z.number().int().nonnegative().default(0), error: z.string().optional(),
  brief: z.string().default(""), model: z.string().optional(), pauseRequested: z.boolean().default(false),
  cancelRequested: z.boolean().default(false), resumeCount: z.number().int().nonnegative().default(0)
}).strict();

export type StoryExecution = z.infer<typeof StoryExecutionSchema>;

function directory(worldId: string): string {
  return join(process.cwd(), ".output", worldId, "workbench", "story-executions");
}
function filePath(worldId: string, id: string): string { return join(directory(worldId), id + ".json"); }

export async function saveStoryExecution(value: StoryExecution): Promise<void> {
  const task = StoryExecutionSchema.parse(value);
  const target = filePath(task.worldId, task.id);
  await mkdir(dirname(target), { recursive: true });
  const temporary = target + "." + process.pid + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(task, null, 2) + "\n", "utf8");
  await rename(temporary, target);
}
export async function getStoryExecution(worldId: string, id: string): Promise<StoryExecution | undefined> {
  try { return StoryExecutionSchema.parse(JSON.parse(await readFile(filePath(worldId, id), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export function storyExecutionOwnsRun(storyUnitId: string | undefined, runStoryUnitId: string | undefined): boolean {
  return storyUnitId === runStoryUnitId;
}

export interface StoryExecutionChapterRun {
  kind?: string;
  storyUnitId?: string;
  status?: string;
  chapterPath?: string;
  createdAt: string;
}

/** Select the latest completed chapter only from the exact execution scope, including legacy. */
export function latestCompletedChapterForStoryUnit<T extends StoryExecutionChapterRun>(runs: T[], storyUnitId?: string): T | undefined {
  return runs
    .filter(run => run.kind === "chapter" && storyExecutionOwnsRun(storyUnitId, run.storyUnitId) && run.status === "completed" && Boolean(run.chapterPath))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export async function listStoryExecutions(worldId: string, storyUnitId?: string | null): Promise<StoryExecution[]> {
  try {
    const names = await readdir(directory(worldId));
    const values = await Promise.all(names.filter(name => name.endsWith(".json")).map(async name => {
      try { return StoryExecutionSchema.parse(JSON.parse(await readFile(join(directory(worldId), name), "utf8"))); }
      catch { return undefined; }
    }));
    return values.filter((value): value is StoryExecution => value !== undefined && (storyUnitId === undefined || storyExecutionOwnsRun(storyUnitId ?? undefined, value.storyUnitId))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
/** A process restart preserves the checkpoint and marks the task resumable, never falsely completed. */
export async function recoverStoryExecutions(worldId: string): Promise<number> {
  const tasks = await listStoryExecutions(worldId);
  let recovered = 0;
  for (const task of tasks) {
    if (task.status !== "running" && task.status !== "queued") continue;
    // Keep currentRunId: on resume the worker reconciles whether that exact run
    // completed just before the process stopped, closing the checkpoint write gap.
    await saveStoryExecution({ ...task, status: "paused", pauseRequested: false, cancelRequested: false,
      updatedAt: new Date().toISOString(),
      error: "Workbench restarted. Completed chapters and story state are preserved; resume this story execution to continue." });
    recovered++;
  }
  return recovered;
}
