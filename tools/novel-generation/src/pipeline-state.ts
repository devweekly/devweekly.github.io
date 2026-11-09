export type StoryExecutionLifecycle = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled" | "stalled";
export type KnowledgeBuildStepLifecycle = "running" | "completed" | "failed" | "skipped";

const ACTIVE_EXECUTION_STATES = new Set<StoryExecutionLifecycle>(["queued", "running", "paused"]);
const RESUMABLE_EXECUTION_STATES = new Set<StoryExecutionLifecycle>(["paused", "failed", "stalled"]);
const CANCELLABLE_EXECUTION_STATES = new Set<StoryExecutionLifecycle>(["queued", "running", "paused"]);

/** These states own the World write lock and must remain visible until explicitly resolved. */
export function isStoryExecutionBlocking(status: StoryExecutionLifecycle): boolean {
  return ACTIVE_EXECUTION_STATES.has(status);
}

export function canResumeStoryExecution(status: StoryExecutionLifecycle): boolean {
  return RESUMABLE_EXECUTION_STATES.has(status);
}

export function canCancelStoryExecution(status: StoryExecutionLifecycle): boolean {
  return CANCELLABLE_EXECUTION_STATES.has(status);
}

/** A process-local worker cannot survive restart; an orphaned record is safe to cancel immediately. */
export function shouldCancelStoryExecutionImmediately(status: StoryExecutionLifecycle, workerIsAlive: boolean): boolean {
  return status === "paused" || !workerIsAlive;
}

/** Only durably completed/skipped steps are reusable. Running/failed steps must execute again. */
export function reusableKnowledgeBuildStepNames<T extends { name: string; status: KnowledgeBuildStepLifecycle }>(steps: readonly T[]): Set<string> {
  return new Set(steps.filter(step => step.status === "completed" || step.status === "skipped").map(step => step.name));
}
