import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emptyStoryState } from "../src/story-state.js";
import { listStoryMemories, recordStoryMemoryCandidates, syncStoryState, updateStoryMemory } from "../src/database.js";
import { buildNarrativeMemoryContext } from "../src/story-memory.js";

test("story memory requires independent run evidence before context injection", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-memory-"));
  try {
    const worldDir = join(root, "world");
    const state = emptyStoryState("test-world");
    syncStoryState(worldDir, state);
    const candidate = {
      memoryId: "memory-1", memoryType: "narrative" as const,
      content: "人物之间的信任变化更适合通过行动和代价呈现，而不是直接解释心理。",
      scope: "人物互动",
      evidence: { runId: "run-1", quote: "他没有回答，只把门推开。", source: "chapter.md" }
    };
    assert.equal(recordStoryMemoryCandidates(worldDir, "test-world", [candidate]), 1);
    assert.equal(recordStoryMemoryCandidates(worldDir, "test-world", [candidate]), 0, "同一运行不能重复累计证据");
    assert.equal(listStoryMemories(worldDir, "test-world", "active").length, 0);
    assert.throws(() => updateStoryMemory(worldDir, "test-world", "memory-1", { status: "active" }), /at least two independent story executions/);
    assert.equal(buildNarrativeMemoryContext(worldDir, "test-world", "人物信任变化"), "");

    assert.equal(recordStoryMemoryCandidates(worldDir, "test-world", [{
      ...candidate,
      evidence: { runId: "run-2", quote: "他把最后一支火把递给了对方。", source: "chapter-2.md" }
    }]), 1);
    const active = listStoryMemories(worldDir, "test-world", "active");
    assert.equal(active.length, 1);
    assert.equal(active[0]?.occurrences, 2);
    assert.match(buildNarrativeMemoryContext(worldDir, "test-world", "人物信任变化"), /仅供当前创作参考/);

    const edited = updateStoryMemory(worldDir, "test-world", "memory-1", {
      content: "人物的信任变化更适合通过行动、选择与代价逐步显露，而不是直接解释心理。",
      scope: "人物关系与互动", status: "superseded"
    });
    assert.equal(edited?.status, "superseded");
    assert.equal(listStoryMemories(worldDir, "test-world", "superseded").length, 1, "Workbench 可单独筛选已替代记忆");
    assert.equal(edited?.evidence.length, 2, "修订记忆不得覆盖或丢失来源证据");
    assert.equal(edited?.content, "人物的信任变化更适合通过行动、选择与代价逐步显露，而不是直接解释心理。");

    const nextState = emptyStoryState("test-world");
    nextState.currentPosition = "下一章";
    syncStoryState(worldDir, nextState);
    assert.equal(listStoryMemories(worldDir, "test-world", "all").length, 1, "章节状态替换不得清空长期记忆");
    assert.equal(listStoryMemories(worldDir, "test-world", "active").length, 0, "已淘汰记忆不得重新进入检索");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("story memory retrieval includes matching scope, not only matching prose", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-memory-scope-"));
  try {
    const worldDir = join(root, "world");
    syncStoryState(worldDir, emptyStoryState("scope-world"));
    const candidate = {
      memoryId: "scope-memory", memoryType: "creative" as const,
      content: "场景转换时保留人物选择带来的未知后果，让读者自行拼合信息。",
      scope: "人物互动与关系",
      evidence: { runId: "scope-run-1", quote: "他把话咽了回去。", source: "chapter.md" }
    };
    recordStoryMemoryCandidates(worldDir, "scope-world", [candidate]);
    recordStoryMemoryCandidates(worldDir, "scope-world", [{
      ...candidate,
      evidence: { runId: "scope-run-2", quote: "门外的人没有敲门。", source: "chapter-2.md" }
    }]);
    const context = buildNarrativeMemoryContext(worldDir, "scope-world", "人物互动");
    assert.match(context, /场景转换时保留人物选择带来的未知后果/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
