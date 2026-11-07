import assert from "node:assert/strict";
import test from "node:test";
import { renderAsOfDossier } from "../src/asof-dossier.js";
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
  const files = renderAsOfDossier(snapshot, [{ chapterId: "ch-2", chapterOrdinal: 2, summary: "人物甲发现旧盟约被篡改", actors: ["人物甲", "人物乙"] }]);
  assert.match(files["characters.md"]!, /人物甲/);
  assert.match(files["story-analysis.md"]!, /个人自由与组织控制/);
  assert.match(files["story-analysis.md"]!, /谁泄露了消息/);
  assert.match(files["foreshadowing.md"]!, /断裂的铜环/);
  assert.match(files["relationships.md"]!, /互相猜疑/);
  assert.match(files["timeline.md"]!, /旧盟约被篡改/);
  assert.match(files["macguffins.md"]!, /铜环/);
  assert.match(files["development-possibilities.md"]!, /主动暴露秘密/);
  assert.match(files["characters.md"]!, /不是正史补写/);
  assert.match(files["characters.md"]!, /人物可以反复/);
});

test("as-of dossier refuses incomplete or foreign-universe analysis snapshots", () => {
  assert.throws(() => renderAsOfDossier({ ...snapshot, complete: false }), /incomplete/);
});
