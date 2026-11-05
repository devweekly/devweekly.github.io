import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoryState {
  schemaVersion: 1;
  worldId: string;
  updatedAt: string;
  currentPosition: string;
  canonFacts: Array<{ id: string; fact: string; source?: string; confidence: "confirmed" | "inferred" | "original" }>;
  characters: Array<{ name: string; status: string; location?: string; abilities?: string[]; knowledge?: string[]; goals?: string[]; relationships?: string[] }>;
  events: Array<{ id: string; summary: string; position: string; participants: string[]; consequences: string[] }>;
  plotThreads: Array<{ id: string; title: string; status: "open" | "active" | "resolved" | "abandoned"; lastUpdated: string; notes: string }>;
  continuityNotes: string[];
}

export function emptyStoryState(worldId: string): StoryState {
  return {
    schemaVersion: 1, worldId, updatedAt: new Date().toISOString(), currentPosition: "尚未建立",
    canonFacts: [], characters: [], events: [], plotThreads: [], continuityNotes: []
  };
}

export async function loadStoryState(path: string, worldId: string): Promise<StoryState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<StoryState>;
    if (parsed.schemaVersion !== 1 || parsed.worldId !== worldId) throw new Error("Story state schema/world mismatch: " + path);
    return {
      ...emptyStoryState(worldId), ...parsed,
      canonFacts: Array.isArray(parsed.canonFacts) ? parsed.canonFacts : [],
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      plotThreads: Array.isArray(parsed.plotThreads) ? parsed.plotThreads : [],
      continuityNotes: Array.isArray(parsed.continuityNotes) ? parsed.continuityNotes : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyStoryState(worldId);
  }
}

export async function saveStoryState(path: string, state: StoryState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
}
