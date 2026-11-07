import path from "node:path";
import type { StoryState } from "./story-state.js";
import type { WorkbenchRun } from "./workbench-store.js";

/** Rebase a chapter-time snapshot into a new universe without changing its narrative state. */
export function rebaseStoryState(state: StoryState, sourceWorldId: string, targetWorldId: string): StoryState {
  if (state.worldId !== sourceWorldId) throw new Error("Story State snapshot belongs to another universe.");
  return { ...state, worldId: targetWorldId, updatedAt: new Date().toISOString() };
}

/** Rewrite historical artifact paths so a fork never points back into its parent universe. */
export function remapForkedRun(
  run: WorkbenchRun,
  targetWorldId: string,
  outputMap: ReadonlyMap<string, string>
): WorkbenchRun | null {
  if (!run.outputDir || !run.chapterPath) return null;
  const sourceOutput = path.resolve(run.outputDir);
  const sourceChapter = path.resolve(run.chapterPath);
  const targetOutput = outputMap.get(sourceOutput);
  if (!targetOutput || !sourceChapter.startsWith(sourceOutput + path.sep)) return null;
  const previousSource = run.previousChapterPath ? path.resolve(run.previousChapterPath) : "";
  let previousTarget: string | undefined;
  if (previousSource) {
    for (const [oldOutput, newOutput] of outputMap) {
      if (previousSource.startsWith(oldOutput + path.sep)) {
        previousTarget = path.join(newOutput, path.relative(oldOutput, previousSource));
        break;
      }
    }
  }
  return {
    ...run,
    worldId: targetWorldId,
    outputDir: targetOutput,
    chapterPath: path.join(targetOutput, path.relative(sourceOutput, sourceChapter)),
    ...(previousTarget ? { previousChapterPath: previousTarget } : { previousChapterPath: undefined })
  };
}
