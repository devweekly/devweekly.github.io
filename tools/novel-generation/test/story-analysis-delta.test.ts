import test from "node:test";
import assert from "node:assert/strict";
import { applyDelta, assertV6DeltaFields, parseDelta, parseModelJson } from "../src/story-analysis.js";

const batch = {
  index: 0,
  chars: 12,
  chapters: [
    { chapterId: "V01-C001", ordinal: 1, volume: 1, title: "第一章", label: "1", text: "林岚推开门。", charCount: 6 }
  ]
};

const legacy = parseModelJson(JSON.stringify({
  characters: [{ name: "林岚", aliases: ["阿岚"], shortBio: "擅长隐瞒心事" }],
  relations: [{ from: "林岚", to: "顾青", label: "师徒", evidence: "师徒同门" }],
  plotThreads: [{ title: "旧城失踪案", summary: "失踪者与林岚有关" }],
  foreshadowings: [{ clue: "城墙血字", possiblePayoffs: ["指向失踪案"] }],
  beats: [],
  developmentPossibilities: []
}));

test("delta patches existing items by exact key without inventing new ones", () => {
  const delta = parseDelta(JSON.stringify({
    storyCoreObservations: [{ chapterKeys: ["V01-C001"], centralConflict: "旧城失踪" }],
    macguffins: [{ chapterKeys: ["V01-C001"], name: "铜钥匙" }],
    plotThreadRoles: [{ title: "旧城失踪案", narrativeRole: "main", relatedCharacters: ["林岚"] }],
    relationDynamics: [{ from: "林岚", to: "顾青", label: "师徒", dynamic: "由信任转为试探", change: "夜谈后", interactionMoments: ["夜谈"] }],
    foreshadowingThreads: [{ clue: "城墙血字", relatedThreadTitles: ["旧城失踪案"] }],
    aliasDetails: [{ name: "林岚", aliases: [{ value: "阿岚", type: "name_alias", evidence: "阿岚推开门" }] }]
  }));
  const merged = applyDelta(legacy, delta, batch);
  assert.equal(merged.characters.length, 1);
  assert.equal(merged.plotThreads.length, 1);
  assert.equal(merged.plotThreads[0]?.narrativeRole, "main");
  assert.deepEqual(merged.plotThreads[0]?.relatedCharacters, ["林岚"]);
  assert.equal(merged.relations[0]?.dynamic, "由信任转为试探");
  assert.deepEqual(merged.foreshadowings[0]?.relatedThreadTitles, ["旧城失踪案"]);
  assert.equal(merged.characters[0]?.aliasDetails?.[0]?.type, "name_alias");
  assert.equal(merged.storyCoreObservations.length, 1);
  assert.equal(merged.macguffins.length, 1);
  // 旧条目没有 chapterKeys，补成本批章节集合，保持 v4 的整批来源粒度。
  assert.deepEqual(merged.characters[0]?.chapterKeys, ["V01-C001"]);
  assert.deepEqual(merged.storyCoreObservations[0]?.chapterKeys, ["V01-C001"]);
});

test("delta patches that do not match any legacy item are ignored", () => {
  const delta = parseDelta(JSON.stringify({
    plotThreadRoles: [{ title: "不存在的线", narrativeRole: "main" }],
    relationDynamics: [{ from: "甲", to: "乙", label: "无关", dynamic: "变化" }]
  }));
  const merged = applyDelta(legacy, delta, batch);
  assert.equal(merged.plotThreads[0]?.narrativeRole, "unclear");
  assert.equal(merged.relations[0]?.dynamic, "");
});

test("delta parser tolerates fences, trailing commas and trailing prose", () => {
  const raw = '```json\n{"storyCoreObservations":[],"macguffins":[],}\n```\n说明：这里有个 } 不是 JSON。';
  const parsed = parseDelta(raw);
  assert.deepEqual(parsed.storyCoreObservations, []);
  assert.deepEqual(parsed.plotThreadRoles, []);
});

const empty = {
  storyCoreObservations: [], macguffins: [], plotThreads: [], relations: [], foreshadowings: []
};

test("refuses to write version 6 when no v6-only field was produced", () => {
  assert.throws(() => assertV6DeltaFields(empty), /refusing to write analysisVersion 6/);
  assert.throws(
    () => assertV6DeltaFields({ ...empty, storyCoreObservations: [{ centralConflict: "冲突" }] }),
    /refusing to write analysisVersion 6/
  );
});

test("accepts a delta that produced both core observations and v6-only patches", () => {
  assert.doesNotThrow(() => assertV6DeltaFields({
    ...empty,
    storyCoreObservations: [{ centralConflict: "冲突" }],
    plotThreads: [{ narrativeRole: "main" }]
  }));
});
