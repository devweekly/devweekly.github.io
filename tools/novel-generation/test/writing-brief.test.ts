import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWritingBrief, briefTerms } from "../src/writing-brief.js";
import {
  syncNovelBeats, syncNovelChapters, syncNovelCharacters, syncNovelForeshadowings, syncNovelThreads
} from "../src/database.js";

const refs: never[] = [];

function seedWorld(worldDir: string): void {
  syncNovelChapters(worldDir, "w", [1, 2, 3].map(ordinal => ({
    chapterId: "w-c-" + ordinal, ordinal, volume: 1, printedNumber: ordinal,
    title: "第" + ordinal + "章", label: "章" + ordinal, startLine: ordinal * 10,
    charCount: 2000, chunkStart: ordinal - 1, chunkEnd: ordinal
  })));
  syncNovelCharacters(worldDir, "w", [
    {
      characterId: "c1", name: "林岚", aliases: ["阿岚"], role: "主角，查旧案的记者",
      bio: "不愿提父亲", voice: "短句", personality: ["克制"], desires: ["查清旧案"],
      contradictions: ["怕真相"], arc: ["从回避到直面"], firstChapter: 1, lastChapter: 3,
      sourceRefs: refs, source: "analysis"
    },
    {
      characterId: "c2", name: "顾青", aliases: [], role: "警局档案员",
      bio: "按规矩办事", voice: "公文化", personality: [], desires: [],
      contradictions: [], arc: [], firstChapter: 2, lastChapter: 3,
      sourceRefs: refs, source: "analysis"
    }
  ], []);
  syncNovelThreads(worldDir, "w", [{
    threadId: "t1", title: "旧城失踪案", status: "进行中",
    summary: "失踪者与林岚父亲有关", keyTurns: ["第一具遗骸"], unresolved: ["谁改过档案"],
    firstChapter: 1, lastChapter: 3, sourceRefs: refs
  }]);
  syncNovelForeshadowings(worldDir, "w", [{
    clueId: "f1", clue: "旧城墙上的血字", firstAppearance: "第 2 章",
    meaning: "指向失踪案的第二现场", payoffs: [], confidence: "明确线索",
    status: "埋设", chapterOrdinal: 2, sourceRefs: refs
  }, {
    clueId: "f2", clue: "早已兑现的欠条", firstAppearance: "第 1 章",
    meaning: "已经回收的线索", payoffs: ["第 3 章兑现"], confidence: "明确线索",
    status: "已回收", chapterOrdinal: 1, sourceRefs: refs
  }]);
  syncNovelBeats(worldDir, "w", [1, 2, 3].map(ordinal => ({
    beatId: "b" + ordinal, chapterId: "w-c-" + ordinal, chapterOrdinal: ordinal,
    summary: "第" + ordinal + "章发生的事", actors: ["林岚"], sourceRefs: refs
  })));
}

test("brief 只带相关人物、未收线与未回收伏笔", async () => {
  const root = await mkdtemp(join(tmpdir(), "writing-brief-"));
  const worldDir = join(root, "world");
  try {
    seedWorld(worldDir);
    const brief = buildWritingBrief({ worldDir, worldId: "w", query: "林岚回旧城调查失踪案" });
    assert.match(brief, /林岚/);
    assert.match(brief, /旧城失踪案/);
    assert.match(brief, /旧城墙上的血字/);
    assert.match(brief, /第 3 章/);
    // 已回收的伏笔不该再当可用线索；不相关人物不出现。
    assert.doesNotMatch(brief, /早已兑现的欠条/);
    assert.doesNotMatch(brief, /顾青/);
    assert.match(brief, /不是创意建议/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief 在无命中或超长时给出可预期的结果", async () => {
  const root = await mkdtemp(join(tmpdir(), "writing-brief-"));
  const worldDir = join(root, "world");
  try {
    seedWorld(worldDir);
    // 无关任务不该带出人物、情节线与伏笔；但最近既成事实始终保留，续写需要它。
    const unrelated = buildWritingBrief({ worldDir, worldId: "w", query: "海边旅行" });
    assert.doesNotMatch(unrelated, /林岚|旧城失踪案|血字/);
    assert.match(unrelated, /时间线锚点/);
    const brief = buildWritingBrief({ worldDir, worldId: "w", query: "林岚 旧城 失踪案", maxChars: 200 });
    assert.ok(brief.length <= 240, "brief 超长时应截断到上限附近");
    assert.match(brief, /截断/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("briefTerms 同时收中文二字词与英文整词", () => {
  const terms = briefTerms("Li Yan 查失踪案");
  assert.ok(terms.has("li"));
  assert.ok(terms.has("yan"));
  assert.ok(terms.has("失踪"));
  assert.ok(!terms.has("我们"));
});
