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


/**
 * Historical universes must not inherit whole-book derived material.
 * Unknown files are retained only when they are not in a known derived namespace;
 * root-level aggregate summaries are explicitly denied until as-of rebuilding exists.
 */
export function shouldCopyUniverseAsset(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return true;
  const first = parts[0]!;
  if ([
    "story.db", "story-state.json", "story-arc.md", "story-plan.json",
    ".output", "universes", "library", "vane-index", "analysis",
    "corpus-craft", "style-references", "style-reference-history", "as-of-analysis", "universe.json"
  ].includes(first)) return false;
  if (parts.length === 1 && [
    "world-bible.md", "characters.md", "timeline.md", "fruit-worlds.md",
    "yanfu-system.md", "style-profile.md", "story-analysis.md",
    "character-profiles.md", "plot-summary.md", "foreshadowing.md"
  ].includes(first)) return false;
  return true;
}

export interface CanonChapterText { title: string; text: string; }

/** Build bounded, chronological canon context strictly before the selected entry chapter. */
export function buildUniverseOriginContext(
  chapters: CanonChapterText[],
  selectedIndex: number,
  maxPreviousChapters = 3,
  maxChars = 18_000
): string {
  const selected = chapters[selectedIndex];
  if (!selected) throw new Error("Selected canon chapter does not exist.");
  const preceding = chapters.slice(Math.max(0, selectedIndex - maxPreviousChapters), selectedIndex);
  const parts = [
    "# 原著起点前情（只读背景）",
    "",
    "以下章节发生在本宇宙起点之前，只用于理解人物处境、关系和已发生事件。不得把原著起点之后的剧情当成本宇宙事实。",
    ""
  ];
  // 从最近章节向前分配预算，确保最接近起点的前情优先；最后再恢复原文顺序。
  let remaining = maxChars;
  const selectedContext: Array<{ title: string; text: string }> = [];
  for (const chapter of [...preceding].reverse()) {
    if (remaining <= 0) break;
    const body = chapter.text.slice(-remaining);
    selectedContext.push({ title: chapter.title, text: body });
    remaining -= body.length;
  }
  for (const chapter of selectedContext.reverse()) {
    parts.push("## " + chapter.title, "", chapter.text, "");
  }
  return parts.join("\n");
}


export interface UniverseWorldBibleInput {
  name: string;
  sourceWorldId: string;
  entryChapter: string;
  brief?: string;
  parentUniverseId?: string;
}

/**
 * Whole-book world bibles are excluded from historical branches because they
 * may contain future spoilers. Create a minimal local bible that points writers
 * to the bounded canon files instead of silently omitting the required file.
 */
export function buildUniverseWorldBible(input: UniverseWorldBibleInput): string {
  return [
    "# " + input.name,
    "",
    "## 宇宙定位",
    "",
    "- 原文项目：" + input.sourceWorldId,
    "- 原文分支起点：" + input.entryChapter,
    ...(input.parentUniverseId ? ["- 分叉来源宇宙：" + input.parentUniverseId] : []),
    "",
    "## 原文边界",
    "",
    "本宇宙是独立的历史分支。原著只读背景严格截止于上述起点，不得读取、推断或引用起点之后的原文剧情作为本宇宙已发生事实。",
    "",
    "理解起点时，优先阅读本目录的 universe-entry.md；需要前情时阅读 universe-origin-context.md。两者是本宇宙经过时点截断的原文材料。知识构建完成后，可进一步参考本目录 as-of-analysis/ 下的人物、关系、时间线和 world-details.md；这些是截至本宇宙起点的证据整理，不是新增正史。",
    "",
    "## 本宇宙正史",
    "",
    "本宇宙从分支起点开始独立发展。起点之后的事实以本宇宙自己的 story-state.json、已完成章节正文和章节状态快照为准；不得引用父宇宙或其他分支的续写事实。",
    "",
    "人物、关系、主线、伏笔和世界细节分析属于可选创作参考，不是人物行为硬约束，也不是必须兑现的剧情清单。人物可以改变、反复、背叛、和解、黑化或洗白。",
    "",
    "## 创作方向",
    "",
    input.brief?.trim() || "从指定原文时点自然展开独立故事，尊重当时的人物处境与已发生事件；允许探索新的情节和人物发展。",
    "",
    "文学性、文笔、艺术风格高于分析字段完整度、图谱闭环和统计指标。"
  ].join("\n") + "\n";
}
