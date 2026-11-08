import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { archiveStoredStoryUnitVersion, createStoredStoryUnit, saveStoredStoryUnit } from "../src/story-unit-store.js";
import { emptyStoryState, saveStoryState } from "../src/story-state.js";


function validStoryUnit(worldId: string, title: string, storyCore: string, centralConflict: string) {
  return {
    schemaVersion: 1 as const, worldId, title, storyCore, centralConflict, updatedAt: new Date().toISOString(),
    readerExperience: "", openingSituation: "故事开端",
    fruitOrSetting: {},
    storySpine: [
      { title: "开端" }, { title: "发展" }, { title: "转折" }, { title: "结局" }
    ],
    climax: "关键选择", endingAndAftermath: "故事余韵"
  };
}

test("graph and character-state APIs return only the requested Story Unit, with a separate legacy scope", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "story-unit-api-"));
  process.chdir(root);
  const worldId = "world-a";
  const worldDir = join(root, "worlds", worldId);
  await mkdir(worldDir, { recursive: true });
  const server = createServer(createApp());
  try {
    const unitA = await createStoredStoryUnit(worldDir, validStoryUnit(worldId, "雾河镇", "河雾保存声音", "谁偷走了亡者的声音"));
    const unitB = await createStoredStoryUnit(worldDir, validStoryUnit(worldId, "山中驿站", "驿站里的失踪案", "谁纵火烧了驿站"));
    const archivedDesign = await archiveStoredStoryUnitVersion(worldDir, unitA);
    await saveStoredStoryUnit(worldDir, { ...unitA, title: "雾河镇·夜潮", storyCore: "河雾吞没活人的记忆", updatedAt: new Date().toISOString() });
    const stateA = emptyStoryState(worldId);
    stateA.currentPosition = "雾河镇 / 第三章";
    stateA.characters.push({ name: "李玄", status: "持有铜匣", location: "雾河镇" });
    stateA.events.push({ id: "event-a", summary: "铜匣易主", position: "第三章", participants: ["李玄"], consequences: [] });
    const stateB = emptyStoryState(worldId);
    stateB.currentPosition = "山中驿站 / 第一章";
    stateB.characters.push({ name: "沈七", status: "被困", location: "山中驿站" });
    stateB.events.push({ id: "event-b", summary: "驿站失火", position: "第一章", participants: ["沈七"], consequences: [] });
    await saveStoryState(join(worldDir, ".story-units", unitA.id, "story-state.json"), stateA);
    await saveStoryState(join(worldDir, ".story-units", unitB.id, "story-state.json"), stateB);
    await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    const base = `http://127.0.0.1:${address.port}/api/worlds/${worldId}`;
    const post = async (url: string) => fetch(url, { method: "POST", headers: { host: `127.0.0.1:${address.port}`, "content-type": "application/json" }, body: "{}" });
    const get = async (url: string) => {
      const response = await fetch(url, { headers: { host: `127.0.0.1:${address.port}` } });
      if (!response.ok) throw new Error(await response.text());
      assert.equal(response.status, 200);
      return response.json() as Promise<Record<string, any>>;
    };
    const graphA = await get(`${base}/graph?source=sequel&storyUnitId=${unitA.id}`);
    const graphB = await get(`${base}/graph?source=sequel&storyUnitId=${unitB.id}`);
    const graphLegacy = await get(`${base}/graph?source=sequel&storyUnitId=legacy`);
    assert.deepEqual(graphA.nodes.filter(node => node.type === "character").map(node => node.label), ["李玄"]);
    assert.deepEqual(graphB.nodes.filter(node => node.type === "character").map(node => node.label), ["沈七"]);
    assert.equal(graphLegacy.nodes.length, 0);
    const restoredResponse = await post(`${base}/story-units/${unitA.id}/versions/${archivedDesign.versionId}/restore`);
    if (!restoredResponse.ok) throw new Error(await restoredResponse.text());
    const restoredBody = await restoredResponse.json() as {storyUnit:{storyCore:string}};
    assert.equal(restoredBody.storyUnit.storyCore, "河雾保存声音");
    const versionsResponse = await get(`${base}/story-units/${unitA.id}/versions`);
    assert.equal((versionsResponse.versions as unknown[]).length, 2);
    const missingUnit = await fetch(`${base}/story-units/00000000-0000-4000-8000-000000000000/state`, { headers: { host: `127.0.0.1:${address.port}` } });
    assert.equal(missingUnit.status, 404);
    const detailA = await get(`${base}/story-units/${unitA.id}/state`);
    const detailB = await get(`${base}/story-units/${unitB.id}/state`);
    assert.deepEqual(detailA.state.characters.map((person: {name:string}) => person.name), ["李玄"]);
    assert.deepEqual(detailB.state.characters.map((person: {name:string}) => person.name), ["沈七"]);
    assert.equal(detailA.storyUnitTitle, "雾河镇");
    assert.equal(detailB.storyUnitTitle, "山中驿站");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
});
