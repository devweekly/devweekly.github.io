import test from "node:test";
import assert from "node:assert/strict";
import { isStoryUnitNaturallyComplete, validateStoryUnit } from "../src/story-unit.js";

const valid = {
  schemaVersion: 1, worldId: "world-a", updatedAt: "2026-11-08T00:00:00.000Z",
  title: "雾河镇", storyCore: "一段关于失踪与归来的完整故事。", readerExperience: "压迫与余韵",
  openingSituation: "镇上连续三夜有人听见河底敲门。", centralConflict: "活人和死者对同一段历史有不同记忆。",
  fruitOrSetting: { name: "雾河果实", premise: "河雾会保存人的声音", abilitiesAndRules: ["声音可被雾留存"], costsAndLimits: ["每次取声都会遗忘一段记忆"], historicalContext: "战乱后重建的河镇", geographyAndDailyLife: "靠摆渡与渔业为生", powerAndSocialRelations: "船帮与乡绅争夺渡口" },
  cultureAndFolklore: [{ name: "封灯夜", practice: "入夜后不点窗灯", originOrBelief: "避免亡者认错归途", socialFunction: "共同哀悼", storyUse: "让人物在黑暗中辨认彼此" }],
  taboosAndGhostStories: [{ name: "河底敲门", versions: ["三声是亲人"], underlyingTruthOptions: ["有人借水声传信"], consequences: "村民不敢夜渡", scenePotential: "主角在禁夜时听到第四声" }],
  cast: [{ name: "沈砚", role: "摆渡人", status: "existing", desire: "找回妹妹", fearOrSecret: "曾经放弃救人", relationships: ["与船帮对立"], possibleDevelopment: ["承认当年的选择"] }],
  relationshipDynamics: ["互相利用逐渐变成相互承担"],
  storySpine: [
    { title: "异象", function: "引出疑问", causalChange: "失踪案重新出现", involvedCharacters: ["沈砚"], possibleArcs: [] },
    { title: "追查", function: "扩大冲突", causalChange: "旧案与船帮相连", involvedCharacters: ["沈砚"], possibleArcs: [] },
    { title: "反转", function: "改变认知", causalChange: "被寻找者主动隐瞒真相", involvedCharacters: ["沈砚"], possibleArcs: [] },
    { title: "收束", function: "完成选择", causalChange: "渡口规则被改变", involvedCharacters: ["沈砚"], possibleArcs: [] }
  ],
  subplots: ["船帮内部的继承争端"], climax: "沈砚在封灯夜决定公开旧事。",
  endingAndAftermath: "失踪者归来，但镇上的人不再相信同一种传说。",
  unresolvedQuestions: ["雾是否真的有记忆"], creativePossibilities: ["让传说的不同版本同时成立"]
};

test("validates a complete story unit with open-ended chapter scope", () => {
  const unit = validateStoryUnit(valid, "world-a");
  assert.equal(unit.storySpine.length, 4);
  assert.equal(unit.cast[0]?.status, "existing");
  assert.equal(unit.execution.status, "not_started");
  assert.deepEqual(unit.execution.completedChapterIds, []);
});

test("rejects a story unit without a complete causal spine", () => {
  assert.throws(() => validateStoryUnit({ ...valid, storySpine: valid.storySpine.slice(0, 3) }, "world-a"));
});

test("rejects cross-world story unit data", () => {
  assert.throws(() => validateStoryUnit(valid, "another-world"));
});


test("natural completion requires story closure and no unrealized major beats", () => {
  const assessment = {
    coreConflictResolved: true, endingFeelsNatural: true, confidence: "high" as const,
    unresolvedCoreThreads: [], unrealizedMajorBeats: [], remainingStoryWork: [],
    nextDirection: "收束余韵", rationale: "核心冲突已解决，结尾自然。"
  };
  assert.equal(isStoryUnitNaturallyComplete(assessment), true);
  assert.equal(isStoryUnitNaturallyComplete({ ...assessment, unrealizedMajorBeats: ["高潮尚未发生"] }), false);
  assert.equal(isStoryUnitNaturallyComplete({ ...assessment, confidence: "medium" }), false);
  assert.equal(isStoryUnitNaturallyComplete({ ...assessment, unresolvedCoreThreads: ["核心人物尚未作出选择"] }), false);
  assert.equal(isStoryUnitNaturallyComplete({ ...assessment, remainingStoryWork: ["还需要写出人物选择带来的后果"] }), false);
});
