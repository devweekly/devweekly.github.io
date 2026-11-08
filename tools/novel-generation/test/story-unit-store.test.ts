import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveStoredStoryUnitVersion, createStoredStoryUnit, getStoredStoryUnit, getStoredStoryUnitVersion, listStoredStoryUnitVersions, listStoredStoryUnits, saveStoredStoryUnit } from "../src/story-unit-store.js";

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


test("regenerating a Story Unit can preserve immutable, separately listed design versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "story-units-versions-"));
  try {
    const unit = await createStoredStoryUnit(root, { worldId: "world-a", title: "雾河镇", updatedAt: "2026-11-08T00:00:00.000Z", storyCore: "河雾保存声音", centralConflict: "谁偷走了亡者的声音" });
    const archived = await archiveStoredStoryUnitVersion(root, unit);
    await saveStoredStoryUnit(root, { ...unit, title: "雾河镇·夜潮", storyCore: "河雾吞没活人的记忆", updatedAt: "2026-11-08T00:05:00.000Z" });
    const versions = await listStoredStoryUnitVersions(root, "world-a", unit.id);
    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.versionId, archived.versionId);
    assert.equal(versions[0]?.title, "雾河镇");
    assert.equal(versions[0]?.storyCore, "河雾保存声音");
    assert.equal((await getStoredStoryUnitVersion(root, "world-a", unit.id, archived.versionId))?.storyCore, "河雾保存声音");
    assert.equal(await getStoredStoryUnitVersion(root, "another-world", unit.id, archived.versionId), undefined);
    assert.equal((await getStoredStoryUnit(root, "world-a", unit.id))?.storyCore, "河雾吞没活人的记忆");
    assert.deepEqual(await listStoredStoryUnitVersions(root, "another-world", unit.id), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
