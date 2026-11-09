import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { exportAsOfDossier, renderAsOfDossier } from "../src/asof-dossier.js";
import { saveStoryAnalysis } from "../src/database.js";
import { buildAnalysisUnits } from "../src/novel-kb.js";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoryAnalysisSnapshot } from "../src/database.js";

const snapshot: StoryAnalysisSnapshot = {
  worldId: "u-child",
  sourceHash: "bounded-hash",
  analyzedAt: "2026-11-07T00:00:00.000Z",
  complete: true,
  batches: 2,
  characters: [{
    name: "人物甲", shortBio: "起点前的人物经历", storyFunction: "推动冲突",
    personality: ["谨慎"], contradictions: ["渴望自由又害怕失去"], observedChanges: ["开始怀疑旧盟友"],
    desires: ["保护家人"], relationships: ["人物乙：旧友"], voice: "短句、少解释",
    arcPossibilities: ["可能背叛旧组织，也可能选择和解"], chapterKeys: ["第一章", "第二章"]
  }],
  plotThreads: [{ title: "主线", summary: "围绕旧盟约展开", status: "进行中", narrativeRole: "main", keyTurns: ["盟约破裂"], unresolvedQuestions: ["谁泄露了消息"], chapterKeys: ["第二章"] }],
  foreshadowings: [{ clue: "断裂的铜环", firstAppearance: "第一章", possibleMeaning: "身份凭证", possiblePayoffs: ["揭示旧身份"], confidence: "中", status: "未回收", chapterKeys: ["第一章"] }],
  developmentPossibilities: [{ focus: "人物甲", direction: "反向选择", tension: "忠诚与自由冲突", whyPlausible: "已有矛盾", surpriseOptions: ["主动暴露秘密"], chapterKeys: ["第二章"] }],
  storyCoreObservations: [{ centralConflict: "个人自由与组织控制", centralQuestion: "自由是否值得代价", stakes: ["家人安全"], themes: ["选择"], narrativePromise: "关系与代价", mainPlotThreadTitles: ["主线"], chapterKeys: ["第二章"] }],
  relations: [{ from: "人物甲", to: "人物乙", label: "旧友", dynamic: "互相猜疑", change: "关系破裂", interactionMoments: ["铜环交接"], chapterKeys: ["第二章"] }],
  macguffins: [{ name: "铜环", kind: "信物", significance: "牵动身份", whoWantsIt: ["人物甲"], whyTheyWantIt: ["证明身份"], shifts: ["从遗失到被发现"], relatedCharacters: ["人物甲"], chapterKeys: ["第一章"] }]
};

test("as-of dossier exports all major story dimensions from a completed bounded snapshot", () => {
  const files = renderAsOfDossier(
    snapshot,
    [{ chapterId: "ch-2", chapterOrdinal: 2, summary: "人物甲发现旧盟约被篡改", actors: ["人物甲", "人物乙"] }],
    [{ category: "社会习俗", detail: "商旅入城前须在关亭登记", context: "商队经过城门", evidence: "先验货籍，再放车马入城。", chapterTitle: "第一章", ordinal: 1 }]
  );
  assert.match(files["characters.md"]!, /人物甲/);
  assert.match(files["story-analysis.md"]!, /个人自由与组织控制/);
  assert.match(files["story-analysis.md"]!, /谁泄露了消息/);
  assert.match(files["foreshadowing.md"]!, /断裂的铜环/);
  assert.match(files["relationships.md"]!, /互相猜疑/);
  assert.match(files["timeline.md"]!, /旧盟约被篡改/);
  assert.match(files["world-details.md"]!, /商旅入城前须在关亭登记/);
  assert.match(files["world-details.md"]!, /先验货籍，再放车马入城/);
  assert.match(files["macguffins.md"]!, /铜环/);
  assert.match(files["development-possibilities.md"]!, /主动暴露秘密/);
  assert.match(files["characters.md"]!, /不是正史补写/);
  assert.match(files["characters.md"]!, /人物可以反复/);
});

test("as-of dossier refuses incomplete or foreign-universe analysis snapshots", () => {
  assert.throws(() => renderAsOfDossier({ ...snapshot, complete: false }), /incomplete/);
});

test("as-of dossier falls back to the consolidated story core when observations are absent", () => {
  const files = renderAsOfDossier({
    ...snapshot,
    storyCore: { centralConflict: "秩序与自由的冲突", centralQuestion: "谁有权决定命运" },
    storyCoreObservations: []
  });
  assert.match(files["story-analysis.md"]!, /秩序与自由的冲突/);
});


test("as-of dossier publishes a complete directory and removes stale generated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "asof-dossier-publish-"));
  const previousCwd = process.cwd();
  const worldDir = join(root, "worlds", "u-child");
  try {
    process.chdir(root);
    await mkdir(join(worldDir, "as-of-analysis"), { recursive: true });
    await writeFile(join(worldDir, "as-of-analysis", "stale-old-section.md"), "stale");
    const chapterText = "第一章正文：先验货籍，再放车马入城。";
    const canonLines = Array.from({ length: 100 }, (_, index) => index === 0 ? chapterText : index === 99 ? "第二章正文" : "");
    const originalText = canonLines.join("\n");
    const sourceHash = createHash("sha256").update(originalText, "utf8").digest("hex");
    const secondChapterStart = originalText.indexOf("第二章正文");
    await writeFile(join(worldDir, "original.txt"), originalText, "utf8");
    await mkdir(join(worldDir, "library"), { recursive: true });
    await writeFile(join(worldDir, "library", "index.json"), JSON.stringify({
      schemaVersion: 1, worldId: "u-child", createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
      chunks: [
        { id: "chunk-1", source: "original.txt", sourceHash, chapter: chapterText, chunkIndex: 0, start: 0, end: chapterText.length, chapterStart: 0, text: chapterText },
        { id: "chunk-2", source: "original.txt", sourceHash, chapter: "第二章正文", chunkIndex: 0, start: 0, end: 10, chapterStart: secondChapterStart, text: "第二章正文" }
      ]
    }));
    await mkdir(join(root, "analysis", "u-child"), { recursive: true });
    await writeFile(join(root, "analysis", "u-child", "chapter-index.json"), JSON.stringify({
      schemaVersion: 2, totalLines: 100, volumes: [{ volume: 1, chapters: [
        { sequenceInVolume: 1, printedNumber: 1, title: chapterText, label: "第一章", line: 1 },
        { sequenceInVolume: 2, printedNumber: 2, title: "第二章正文", label: "第二章", line: 100 }
      ] }]
    }));
    const { units } = await buildAnalysisUnits("u-child", { worldDir });
    const firstChapter = units.find(unit => unit.title === chapterText);
    assert.ok(firstChapter, "bounded chapter catalog must produce the first chapter unit");
    const craftDir = join(root, "analysis", "u-child", "corpus-craft", "chapters");
    await mkdir(craftDir, { recursive: true });
    await writeFile(join(craftDir, firstChapter.chapterId + ".json"), JSON.stringify({
      worldId: "u-child", chapterId: firstChapter.chapterId, title: firstChapter.title, ordinal: firstChapter.ordinal,
      sourceHash: createHash("sha256").update(firstChapter.text).digest("hex"),
      worldDetails: [{ category: "礼俗", detail: "城门关亭查验货籍", context: "商队入城", evidence: "先验货籍，再放车马入城。" }]
    }));
    await writeFile(join(root, "analysis", "u-child", "corpus-craft", "manifest.json"), JSON.stringify({
      worldId: "u-child", totalSelected: 10, processed: 9, failed: 1, updatedAt: "2026-11-07T00:00:00.000Z"
    }));
    saveStoryAnalysis(worldDir, "u-child", snapshot);
    const result = await exportAsOfDossier("u-child", worldDir);
    assert.ok(result.files.includes("characters.md"));
    const published = await readdir(join(worldDir, "as-of-analysis"));
    assert.deepEqual(published.sort(), [...result.files].sort());
    assert.match(await readFile(join(worldDir, "as-of-analysis", "characters.md"), "utf8"), /人物甲/);
    const worldDetails = await readFile(join(worldDir, "as-of-analysis", "world-details.md"), "utf8");
    assert.match(worldDetails, /城门关亭查验货籍/);
    assert.match(worldDetails, /计划分析章节：10/);
    assert.match(worldDetails, /失败章节：1/);
    const leftovers = (await readdir(worldDir)).filter(name => name.startsWith(".as-of-analysis."));
    assert.deepEqual(leftovers, []);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
