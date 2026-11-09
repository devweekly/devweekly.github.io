export type StoryExecutionState = { id: string; status: string };

const ACTIVE_STORY_EXECUTION_STATUSES = new Set(["queued", "running", "paused"]);
const POLLED_STORY_EXECUTION_STATUSES = new Set(["queued", "running", "paused"]);

/** The execution blocking writes must also be the one rendered with its control buttons. */
export function selectVisibleStoryExecution<T extends StoryExecutionState>(
  worldExecutions: T[],
  scopedSelection: T | null
): T | null {
  return worldExecutions.find(item => ACTIVE_STORY_EXECUTION_STATUSES.has(item.status)) ?? scopedSelection;
}

/** Paused executions remain live: another tab can cancel or resume them. */
export function shouldPollStoryExecution(status: string): boolean {
  return POLLED_STORY_EXECUTION_STATUSES.has(status);
}

export type StoryExecutionAction = "pause" | "resume" | "cancel";

/** Derive controls from the persisted lifecycle state, never from transient UI loading flags. */
export function getStoryExecutionActions(status: string): StoryExecutionAction[] {
  if (status === "queued" || status === "running") return ["pause", "cancel"];
  if (status === "paused") return ["resume", "cancel"];
  if (status === "failed" || status === "stalled") return ["resume"];
  return [];
}
