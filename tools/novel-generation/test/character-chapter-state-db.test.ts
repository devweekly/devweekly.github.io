import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listNovelCharacterChapterStates, syncNovelCharacterChapterStates, databaseStatus } from "../src/database.js";

test("chapter character states are upserted by stable character and chapter IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-character-state-db-"));
  try {
    const row = {
      characterId: "character-1", name: "李阎", chapterId: "chapter-7",
      chapterOrdinal: 7, chapterTitle: "雨夜", volume: 1, sourceHash: "sha256-a", contextHash: "context-a",
      model: "test-model", generatedAt: "2026-11-07T00:00:00.000Z",
      behavior: ["推门进入"], goals: ["找到线索"], knowledge: ["知道门后有人"],
      relationships: ["对查小刀保持戒备"], resources: ["持有短刀"],
      situation: "身处废弃仓库", changes: ["确认有人跟踪"], evidence: ["他推门走进仓库"],
      uncertainty: ["尚不清楚跟踪者身份"]
    };
    syncNovelCharacterChapterStates(root, "test-world", [row]);
    syncNovelCharacterChapterStates(root, "test-world", [{ ...row, sourceHash: "sha256-b", situation: "离开仓库" }]);
    const states = listNovelCharacterChapterStates(root, "test-world", { characterId: "character-1" });
    assert.equal(states.length, 1);
    assert.equal(states[0]?.sourceHash, "sha256-b");
    assert.equal(states[0]?.situation, "离开仓库");
    assert.equal(databaseStatus(root, "test-world").novelCharacterChapterStates, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
