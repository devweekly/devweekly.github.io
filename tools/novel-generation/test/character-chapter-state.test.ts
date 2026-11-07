import test from "node:test";
import assert from "node:assert/strict";
import { hasExactEvidence, matchChapterCharacters } from "../src/character-chapter-state.js";

const characters = [
  { characterId: "c1", name: "李阎", aliases: ["阎王", "老李"], role: "", bio: "", voice: "", chaptersSeen: 10, mentionTotal: 20, firstChapter: 1, lastChapter: 10 },
  { characterId: "c2", name: "查小刀", aliases: ["小刀"], role: "", bio: "", voice: "", chaptersSeen: 8, mentionTotal: 12, firstChapter: 2, lastChapter: 9 },
  { characterId: "c3", name: "阎罗", aliases: ["阎王"], role: "", bio: "", voice: "", chaptersSeen: 4, mentionTotal: 6, firstChapter: 4, lastChapter: 7 }
];

test("chapter matching uses primary names and only unambiguous explicit aliases", () => {
  const matched = matchChapterCharacters("李阎走进屋里，查小刀随后赶到。旁人提了一句阎王。", characters);
  assert.deepEqual(matched.map(character => character.characterId), ["c1", "c2"]);
});

test("chapter state evidence must be an exact verbatim substring", () => {
  assert.equal(hasExactEvidence("他把刀放在桌上，转身离开。", ["把刀放在桌上"]), true);
  assert.equal(hasExactEvidence("他把刀放在桌上，转身离开。", ["他将刀放在桌上"]), false);
  assert.equal(hasExactEvidence("短句", ["短句"]), false);
});
