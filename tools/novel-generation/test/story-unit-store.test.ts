import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStoredStoryUnit, getStoredStoryUnit, listStoredStoryUnits, saveStoredStoryUnit } from "../src/story-unit-store.js";

test("multiple Story Units persist independently within one world", async () => {
  const root = await mkdtemp(join(tmpdir(), "story-units-"));
  try {
    const a = await createStoredStoryUnit(root, { worldId: "world-a", title: "雾河镇", updatedAt: "2026-11-08T00:00:00.000Z", storyCore: "河雾保存声音" });
    const b = await createStoredStoryUnit(root, { worldId: "world-a", title: "山中驿站", updatedAt: "2026-11-08T00:01:00.000Z", storyCore: "驿站里的失踪案" });
    assert.notEqual(a.id, b.id);
    assert.equal((await getStoredStoryUnit(root, "world-a", a.id))?.storyCore, "河雾保存声音");
    assert.equal((await getStoredStoryUnit(root, "world-a", b.id))?.storyCore, "驿站里的失踪案");
    await saveStoredStoryUnit(root, { ...a, storyCore: "河雾保存亡者最后一句话", updatedAt: "2026-11-08T00:02:00.000Z" });
    assert.equal((await getStoredStoryUnit(root, "world-a", b.id))?.storyCore, "驿站里的失踪案");
    assert.deepEqual((await listStoredStoryUnits(root, "world-a")).map(x => x.id), [a.id, b.id]);
    await assert.rejects(() => listStoredStoryUnits(root, "another-world"), /world mismatch/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy story-unit.json is lazily migrated once and preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "story-units-legacy-"));
  try {
    const legacy = { worldId: "world-a", title: "旧故事", updatedAt: "2026-11-07T00:00:00.000Z", storyCore: "旧数据" };
    await writeFile(join(root, "story-unit.json"), JSON.stringify(legacy), "utf8");
    const first = await listStoredStoryUnits(root, "world-a");
    const second = await listStoredStoryUnits(root, "world-a");
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0]?.id, second[0]?.id);
    assert.equal(first[0]?.storyCore, "旧数据");
    assert.deepEqual(JSON.parse(await readFile(join(root, "story-unit.json"), "utf8")), legacy);
  } finally { await rm(root, { recursive: true, force: true }); }
});
