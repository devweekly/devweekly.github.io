import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { readStoryState as readDatabaseStoryState, syncStoryState } from "./database.js";
import { dirname } from "node:path";
import { z } from "zod";

const StoryStateSchema = z.object({
  schemaVersion: z.literal(1),
  worldId: z.string().min(1),
  updatedAt: z.string().min(1),
  currentPosition: z.string(),
  canonFacts: z.array(z.object({
    id: z.string().min(1), fact: z.string().min(1), source: z.string().optional(),
    confidence: z.enum(["confirmed", "inferred", "original"])
  })),
  characters: z.array(z.object({
    name: z.string().min(1),
    profile: z.object({
      coreTraits: z.array(z.string()).optional(), values: z.array(z.string()).optional(),
      contradictions: z.array(z.string()).optional(), voice: z.string().optional(),
      boundaries: z.array(z.string()).optional(), arc: z.string().optional()
    }).optional(),
    status: z.string(), location: z.string().optional(), abilities: z.array(z.string()).optional(),
    knowledge: z.array(z.string()).optional(), goals: z.array(z.string()).optional(),
    relationships: z.array(z.string()).optional(), arcMilestones: z.array(z.object({ id: z.string().min(1), chapter: z.string().min(1), change: z.string().min(1), choice: z.string().optional(), pressure: z.string().optional(), cost: z.string().optional(), evidence: z.string().min(4) })).optional(), stateUpdatedAt: z.string().optional()
  })),
  events: z.array(z.object({
    id: z.string().min(1), summary: z.string(), position: z.string(),
    participants: z.array(z.string()), consequences: z.array(z.string()),
    origin: z.enum(["canon", "inferred", "original"]).optional(), source: z.string().optional()
  })),
  plotThreads: z.array(z.object({
    id: z.string().min(1), title: z.string(), status: z.enum(["open", "active", "resolved", "abandoned"]),
    lastUpdated: z.string(), notes: z.string()
  })),
  continuityNotes: z.array(z.string())
}).passthrough();

const StoryStateUpdateSchema = z.object({
  currentPosition: z.string().optional(),
  canonFacts: z.array(z.object({
    id: z.string().min(1), fact: z.string().min(1), source: z.string().optional(),
    confidence: z.enum(["confirmed", "inferred", "original"])
  })).optional(),
  characters: z.array(z.object({
    name: z.string().min(1),
    profile: z.object({
      coreTraits: z.array(z.string()).optional(), values: z.array(z.string()).optional(),
      contradictions: z.array(z.string()).optional(), voice: z.string().optional(),
      boundaries: z.array(z.string()).optional(), arc: z.string().optional()
    }).optional(),
    status: z.string(), location: z.string().optional(), abilities: z.array(z.string()).optional(),
    knowledge: z.array(z.string()).optional(), goals: z.array(z.string()).optional(),
    relationships: z.array(z.string()).optional(), arcMilestones: z.array(z.object({ id: z.string().min(1), chapter: z.string().min(1), change: z.string().min(1), choice: z.string().optional(), pressure: z.string().optional(), cost: z.string().optional(), evidence: z.string().min(4) })).optional(), stateUpdatedAt: z.string().optional()
  })).optional(),
  events: z.array(z.object({
    id: z.string().min(1), summary: z.string(), position: z.string(),
    participants: z.array(z.string()), consequences: z.array(z.string())
  })).optional(),
  plotThreads: z.array(z.object({
    id: z.string().min(1), title: z.string(), status: z.enum(["open", "active", "resolved", "abandoned"]),
    lastUpdated: z.string(), notes: z.string()
  })).optional(),
  continuityNotes: z.array(z.string())
}).strict();

export function parseStoryStateUpdate(value: unknown, chapter?: string): Partial<StoryState> {
  const update = StoryStateUpdateSchema.parse(value) as Partial<StoryState>;
  if (chapter !== undefined) {
    for (const character of update.characters ?? []) {
      for (const milestone of character.arcMilestones ?? []) {
        if (!chapter.includes(milestone.evidence)) {
          throw new Error("Character arc evidence is not present in the final chapter: " + character.name + " / " + milestone.id);
        }
      }
    }
  }
  return update;
}

export function validateStoryState(value: unknown): StoryState {
  return StoryStateSchema.parse(value) as StoryState;
}

export interface StoryState {
  schemaVersion: 1;
  worldId: string;
  updatedAt: string;
  currentPosition: string;
  canonFacts: Array<{ id: string; fact: string; source?: string; confidence: "confirmed" | "inferred" | "original" }>;
  characters: Array<{
    name: string;
    profile?: { coreTraits?: string[]; values?: string[]; contradictions?: string[]; voice?: string; boundaries?: string[]; arc?: string };
    status: string;
    location?: string;
    abilities?: string[];
    knowledge?: string[];
    goals?: string[];
    relationships?: string[];
    arcMilestones?: Array<{ id: string; chapter: string; change: string; choice?: string; pressure?: string; cost?: string; evidence: string }>;
    stateUpdatedAt?: string;
  }>;
  events: Array<{ id: string; summary: string; position: string; participants: string[]; consequences: string[]; origin?: "canon" | "inferred" | "original"; source?: string }>;
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
  const worldDir = dirname(path);
  const databaseState = readDatabaseStoryState(worldDir, worldId);
  if (databaseState) {
    const parsedDatabaseState = StoryStateSchema.safeParse(databaseState);
    if (!parsedDatabaseState.success) throw new Error("Invalid SQLite story state: " + parsedDatabaseState.error.issues.map(issue => issue.path.join(".") + " " + issue.message).join("; "));
    if (parsedDatabaseState.data.worldId !== worldId) throw new Error("SQLite story state world mismatch: " + worldId);
    return parsedDatabaseState.data;
  }
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    const parsed = StoryStateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Invalid story state " + path + ": " + parsed.error.issues.map(issue => issue.path.join(".") + " " + issue.message).join("; "));
    }
    if (parsed.data.worldId !== worldId) throw new Error("Story state world mismatch: " + path);
    syncStoryState(worldDir, parsed.data);
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const empty = emptyStoryState(worldId);
    syncStoryState(worldDir, empty);
    return empty;
  }
}

export async function saveStoryState(path: string, state: StoryState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = path + ".tmp";
  const validated = validateStoryState(state);
  const next = { ...validated, updatedAt: new Date().toISOString() };
  syncStoryState(dirname(path), next);
  await writeFile(temporaryPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(temporaryPath, path);
}
