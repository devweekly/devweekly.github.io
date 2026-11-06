import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProfilePrompt, sampleChronologically } from "../src/character-profile.js";
import { listNovelCharacterProfiles, syncNovelCharacterProfiles, syncLibraryChunks, syncNovelCharacters } from "../src/database.js";

test("观察采样保留首尾，中间等距", () => {
  const items = Array.from({ length: 100 }, (_, index) => index);
  const sampled = sampleChronologically(items, 20);
  assert.equal(sampled.length, 20);
  assert.deepEqual(sampled.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(sampled.slice(-5), [95, 96, 97, 98, 99]);
  assert.equal(new Set(sampled).size, 20, "不应重复取同一条");
  // 中间取样应跨越整个区间，而不是挤在开头
  const middle = sampled.slice(5, 15);
  assert.ok((middle.at(-1) as number) - (middle[0] as number) > 60);
});

test("不足上限时原样返回", () => {
  assert.deepEqual(sampleChronologically(["a", "b"], 5), ["a", "b"]);
  assert.deepEqual(sampleChronologically(["a"], 0), []);
});

test("档案提示词带上总量与采样，要求保留变化而不是堆标签", () => {
  const prompt = buildProfilePrompt({
    name: "李阎", aliases: ["阎哥"], role: "主角", bio: "小传",
    firstChapter: 1, lastChapter: 753,
    observations: { personality: ["a"], desires: ["b"], contradictions: ["c"], arc: ["d"] },
    totals: { personality: 193, desires: 197, contradictions: 194, arc: 380 }
  });
  assert.match(prompt, /193\/197\/194\/380/);
  assert.match(prompt, /第 1 章/);
  assert.match(prompt, /保留前后变化/);
  assert.match(prompt, /只输出 JSON/);
});

test("档案写入后可按姓名读回", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-profile-"));
  try {
    const world = join(root, "world");
    syncLibraryChunks(world, "w", [{ id: "s:0:0", source: "s.txt", chapter: "第1章", chunkIndex: 0, start: 0, end: 4, text: "测试", sourceHash: "a".repeat(64), chapterStart: 0 }]);
    syncNovelCharacters(world, "w", [{
      characterId: "c1", name: "李阎", aliases: ["阎哥"], role: "主角", bio: "小传", voice: "",
      personality: [], desires: [], contradictions: [], arc: [],
      firstChapter: 1, lastChapter: 753, sourceRefs: [], source: "analysis"
    }], []);
    syncNovelCharacterProfiles(world, "w", [{
      characterId: "c1", name: "李阎", summary: "合并后的画像", stages: ["早期：混迹城寨"],
      traits: ["算计在前"], contradictions: ["一边说等死一边答应"], arc: ["可能北上"],
      observationCount: 964, model: "test", generatedAt: "2026-11-06T00:00:00.000Z"
    }]);
    const profiles = listNovelCharacterProfiles(world, "w");
    assert.equal(profiles.get("李阎")?.summary, "合并后的画像");
    assert.deepEqual(profiles.get("李阎")?.stages, ["早期：混迹城寨"]);
    assert.equal(profiles.get("李阎")?.observationCount, 964);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
