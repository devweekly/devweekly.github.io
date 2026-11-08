import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

export async function createStoredStoryUnit(worldDir: string, input: Omit<StoredStoryUnit, "id">): Promise<StoredStoryUnit> {
  const unit = { ...input, id: randomUUID() };
  await saveStoredStoryUnit(worldDir, unit);
  return unit;
}
