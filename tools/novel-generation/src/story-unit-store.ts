import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredStoryUnit {
  id: string;
  worldId: string;
  title: string;
  updatedAt: string;
  [key: string]: unknown;
}
interface StoryUnitIndex { schemaVersion: 1; worldId: string; units: Array<{ id: string; title: string; updatedAt: string }> }

function root(worldDir: string): string { return join(worldDir, ".story-units"); }
function indexPath(worldDir: string): string { return join(root(worldDir), "index.json"); }
function unitPath(worldDir: string, id: string): string { return join(root(worldDir), id + ".json"); }
function legacyPath(worldDir: string): string { return join(worldDir, "story-unit.json"); }
function assertId(id: string): void { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid Story Unit ID."); }

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}
async function readIndex(worldDir: string): Promise<StoryUnitIndex> {
  try {
    const value = JSON.parse(await readFile(indexPath(worldDir), "utf8")) as StoryUnitIndex;
    if (value.schemaVersion !== 1 || value.worldId.length === 0 || !Array.isArray(value.units)) throw new Error("Invalid Story Unit index.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { schemaVersion: 1, worldId: "", units: [] };
  }
}

/** Lazy migration keeps the existing single-unit file readable without a destructive bulk migration. */
export async function listStoredStoryUnits(worldDir: string, worldId: string): Promise<StoredStoryUnit[]> {
  const index = await readIndex(worldDir);
  if (index.worldId && index.worldId !== worldId) throw new Error("Story Unit index world mismatch.");
  const units: StoredStoryUnit[] = [];
  for (const entry of index.units) {
    assertId(entry.id);
    try {
      const unit = JSON.parse(await readFile(unitPath(worldDir, entry.id), "utf8")) as StoredStoryUnit;
      if (unit.worldId !== worldId || unit.id !== entry.id) throw new Error("Story Unit identity mismatch.");
      units.push(unit);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (!units.length) {
    try {
      const legacy = JSON.parse(await readFile(legacyPath(worldDir), "utf8")) as Record<string, unknown>;
      const migrated: StoredStoryUnit = { ...legacy, id: randomUUID(), worldId, title: String(legacy.title ?? "未命名故事"), updatedAt: String(legacy.updatedAt ?? new Date().toISOString()) };
      await saveStoredStoryUnit(worldDir, migrated);
      units.push(migrated);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return units.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getStoredStoryUnit(worldDir: string, worldId: string, id: string): Promise<StoredStoryUnit | undefined> {
  assertId(id);
  const units = await listStoredStoryUnits(worldDir, worldId);
  return units.find(unit => unit.id === id);
}

export async function saveStoredStoryUnit(worldDir: string, unit: StoredStoryUnit): Promise<void> {
  assertId(unit.id);
  if (!unit.worldId || !unit.title.trim()) throw new Error("Story Unit requires worldId and title.");
  const index = await readIndex(worldDir);
  if (index.worldId && index.worldId !== unit.worldId) throw new Error("Story Unit index world mismatch.");
  const existing = index.units.filter(entry => entry.id !== unit.id);
  await atomicWrite(unitPath(worldDir, unit.id), unit);
  await atomicWrite(indexPath(worldDir), {
    schemaVersion: 1, worldId: unit.worldId,
    units: [...existing, { id: unit.id, title: unit.title, updatedAt: unit.updatedAt }].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } satisfies StoryUnitIndex);
}

export async function createStoredStoryUnit(worldDir: string, input: { worldId: string; title: string; updatedAt: string; [key: string]: unknown }): Promise<StoredStoryUnit> {
  const unit = { ...input, id: randomUUID() };
  await saveStoredStoryUnit(worldDir, unit);
  return unit;
}


export interface StoredStoryUnitVersion {
  versionId: string;
  storyUnitId: string;
  worldId: string;
  createdAt: string;
  title: string;
  storyCore: string;
  centralConflict: string;
}
function versionDirectory(worldDir: string, id: string): string {
  assertId(id);
  return join(root(worldDir), id, "versions");
}

/** Preserve the exact previous design before a regeneration overwrites the active Story Unit. */
export async function archiveStoredStoryUnitVersion(worldDir: string, unit: StoredStoryUnit): Promise<StoredStoryUnitVersion> {
  assertId(unit.id);
  const versionId = randomUUID();
  const createdAt = new Date().toISOString();
  const record = { schemaVersion: 1, versionId, storyUnitId: unit.id, worldId: unit.worldId, createdAt, unit };
  await atomicWrite(join(versionDirectory(worldDir, unit.id), versionId + ".json"), record);
  return {
    versionId, storyUnitId: unit.id, worldId: unit.worldId, createdAt,
    title: unit.title, storyCore: String(unit.storyCore ?? ""), centralConflict: String(unit.centralConflict ?? "")
  };
}

/** Return compact metadata only; full historical snapshots remain separately addressable. */
export async function listStoredStoryUnitVersions(worldDir: string, worldId: string, storyUnitId: string): Promise<StoredStoryUnitVersion[]> {
  assertId(storyUnitId);
  const directory = versionDirectory(worldDir, storyUnitId);
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const versions: StoredStoryUnitVersion[] = [];
  for (const name of names.filter(value => /^[0-9a-f-]{36}\.json$/i.test(value))) {
    try {
      const record = JSON.parse(await readFile(join(directory, name), "utf8")) as {schemaVersion?:number;versionId?:string;storyUnitId?:string;worldId?:string;createdAt?:string;unit?:StoredStoryUnit};
      if (record.schemaVersion !== 1 || record.versionId !== name.slice(0, -5) || record.storyUnitId !== storyUnitId || record.worldId !== worldId || record.unit?.id !== storyUnitId || record.unit.worldId !== worldId) continue;
      versions.push({ versionId: record.versionId, storyUnitId, worldId, createdAt: String(record.createdAt ?? ""), title: record.unit.title, storyCore: String(record.unit.storyCore ?? ""), centralConflict: String(record.unit.centralConflict ?? "") });
    } catch { /* Ignore an incomplete/corrupt historical snapshot; never affect the active unit. */ }
  }
  return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}


/** Read one immutable design snapshot after validating both world and Story Unit ownership. */
export async function getStoredStoryUnitVersion(worldDir: string, worldId: string, storyUnitId: string, versionId: string): Promise<StoredStoryUnit | undefined> {
  assertId(storyUnitId);
  assertId(versionId);
  try {
    const record = JSON.parse(await readFile(join(versionDirectory(worldDir, storyUnitId), versionId + ".json"), "utf8")) as {schemaVersion?:number;versionId?:string;storyUnitId?:string;worldId?:string;unit?:StoredStoryUnit};
    if (record.schemaVersion !== 1 || record.versionId !== versionId || record.storyUnitId !== storyUnitId || record.worldId !== worldId || record.unit?.id !== storyUnitId || record.unit.worldId !== worldId) {
      throw new Error("Story Unit version ownership mismatch.");
    }
    return record.unit;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
