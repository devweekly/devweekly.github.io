import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { emptyStoryState } from "../src/story-state.js";
import { buildUniverseOriginContext, rebaseStoryState, remapForkedRun, shouldCopyUniverseAsset } from "../src/universe-branch.js";
import type { WorkbenchRun } from "../src/workbench-store.js";

test("forked state keeps the selected chapter snapshot but receives a new universe identity", () => {
  const state = emptyStoryState("universe-a");
  state.currentPosition = "第十二章结尾";
  state.characters.push({ name: "主角", status: "受伤", location: "北门" });
  const fork = rebaseStoryState(state, "universe-a", "universe-b");
  assert.equal(fork.worldId, "universe-b");
  assert.equal(fork.currentPosition, "第十二章结尾");
  assert.equal(fork.characters[0]?.status, "受伤");
  assert.throws(() => rebaseStoryState(state, "universe-other", "universe-b"), /another universe/);
});

test("forked run history rewrites chapter and previous chapter paths into child output", () => {
  const parentA = path.resolve(".output/universe-a/chapter-a");
  const parentB = path.resolve(".output/universe-a/chapter-b");
  const childA = path.resolve(".output/universe-b/chapter-a");
  const childB = path.resolve(".output/universe-b/chapter-b");
  const outputs = new Map([[parentA, childA], [parentB, childB]]);
  const run: WorkbenchRun = {
    id: "4e25df2d-58f3-4a77-a2e4-7b09c5cfa2a1",
    worldId: "universe-a", kind: "chapter", status: "completed",
    createdAt: "2026-11-07T10:00:00.000Z", updatedAt: "2026-11-07T10:05:00.000Z",
    outputDir: parentB, chapterPath: path.join(parentB, "chapter.md"),
    previousChapterPath: path.join(parentA, "chapter.md")
  };
  const forked = remapForkedRun(run, "universe-b", outputs);
  assert.ok(forked);
  assert.equal(forked.worldId, "universe-b");
  assert.equal(forked.outputDir, childB);
  assert.equal(forked.chapterPath, path.join(childB, "chapter.md"));
  assert.equal(forked.previousChapterPath, path.join(childA, "chapter.md"));
  assert.equal(remapForkedRun({ ...run, chapterPath: "/outside/chapter.md" }, "universe-b", outputs), null);
});

test("origin context contains only earlier canon chapters in chronological order and respects its budget", () => {
  const chapters = [
    { title: "第一章", text: "旧事一" },
    { title: "第二章", text: "旧事二" },
    { title: "第三章", text: "旧事三" },
    { title: "第四章", text: "起点正文" },
    { title: "第五章", text: "未来剧情" }
  ];
  const context = buildUniverseOriginContext(chapters, 3, 3, 100);
  assert.ok(context.indexOf("第一章") < context.indexOf("第二章"));
  assert.ok(context.indexOf("第二章") < context.indexOf("第三章"));
  assert.ok(context.includes("旧事一"));
  assert.ok(context.includes("旧事二"));
  assert.ok(context.includes("旧事三"));
  assert.ok(!context.includes("起点正文"));
  assert.ok(!context.includes("未来剧情"));
  assert.throws(() => buildUniverseOriginContext(chapters, 99), /does not exist/);
});

test("origin context budget prioritizes chapters nearest to the selected entry", () => {
  const chapters = [
    { title: "第一章", text: "A".repeat(100) },
    { title: "第二章", text: "B".repeat(100) },
    { title: "第三章", text: "C".repeat(100) },
    { title: "起点", text: "ENTRY" }
  ];
  const context = buildUniverseOriginContext(chapters, 3, 3, 120);
  assert.ok(context.includes("第三章"));
  assert.ok(context.includes("第二章"));
  assert.ok(!context.includes("第一章"));
  assert.ok(context.indexOf("第二章") < context.indexOf("第三章"));
});

test("historical universe asset policy excludes full-book and derived data from create and fork", () => {
  for (const file of [
    "world-bible.md", "characters.md", "timeline.md", "fruit-worlds.md",
    "yanfu-system.md", "style-profile.md", "story-analysis.md",
    "character-profiles.md", "plot-summary.md", "foreshadowing.md",
    "analysis/chapter-index.json", "corpus-craft/chapters/1.json",
    "vane-index/index.json", "style-references/active.json",
    "library/index.json", "private-library/index.json", "story-state.json", ".output/run/chapter.md",
    "chapters/chapter-001.md", "chapters/continuity-review-001.md", "laws.json"
  ]) {
    assert.equal(shouldCopyUniverseAsset(file), false, file);
  }
  // novel.db is retained only as an input to the explicit as-of snapshot filter.
  assert.equal(shouldCopyUniverseAsset("novel.db"), true);
});

test("historical universe asset policy retains ordinary source material and nested non-derived assets", () => {
  for (const file of [
    "source-notes/folklore.txt", "images/map.png", "research/period-customs.md"
  ]) {
    assert.equal(shouldCopyUniverseAsset(file), true, file);
  }
});
