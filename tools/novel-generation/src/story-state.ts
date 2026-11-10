// Story State 的加载/保存层：SQLite 是权威存储，story-state.json 只是可读快照。
// saveStoryState 写入前校验完整状态；章节未过终审或状态提取失败时不会走到保存，
// 保持「未通过审查的状态永不进正史」这条单向门。
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { readStoryState as readDatabaseStoryState, syncStoryState } from "./database.js";
import { dirname } from "node:path";
import { z } from "zod";

// 人物弧光里程碑：本章出现的重要转折 + 逐字证据；choice/pressure/cost 由正文自然呈现时填写。
const ARC_MILESTONE_SCHEMA = z.object({
  id: z.string().min(1), chapter: z.string().min(1), change: z.string().min(1),
  choice: z.string().optional(), pressure: z.string().optional(), cost: z.string().optional(),
  evidence: z.string().min(4)
});
const ForeshadowingUpdateSchema = z.object({
  id: z.string().min(1), clueId: z.string().min(1), clue: z.string().min(1),
  status: z.enum(["planted", "reinforced", "misdirected", "partially_revealed", "revealed", "resolved", "abandoned", "uncertain"]),
  chapter: z.string().min(1), change: z.string().min(1),
  relatedThreadIds: z.array(z.string()).default([]), evidence: z.string().min(4)
});
const RelationshipUpdateSchema = z.object({
  id: z.string().min(1), relationId: z.string().min(1),
  from: z.string().min(1), to: z.string().min(1), label: z.string().min(1),
  chapter: z.string().min(1), change: z.string().min(1), evidence: z.string().min(4)
});
const MacGuffinUpdateSchema = z.object({
  id: z.string().min(1), macguffinId: z.string().min(1), name: z.string().min(1),
  status: z.enum(["introduced", "sought", "located", "held", "transferred", "lost", "destroyed", "secured", "irrelevant", "uncertain"]),
  chapter: z.string().min(1), change: z.string().min(1),
  holder: z.string().optional(), location: z.string().optional(),
  relatedThreadIds: z.array(z.string()).default([]), evidence: z.string().min(4)
});

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
    motivation: z.string().optional(), resources: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(), currentPressure: z.array(z.string()).optional(),
    decisionHistory: z.array(z.string()).optional(),
    relationships: z.array(z.string()).optional(),
    // 弧光里程碑只记录正文自然呈现的转折，字段多为可选。
    arcMilestones: z.array(ARC_MILESTONE_SCHEMA).optional(), stateUpdatedAt: z.string().optional()
  })),
  events: z.array(z.object({
    id: z.string().min(1), summary: z.string(), position: z.string(),
    participants: z.array(z.string()), consequences: z.array(z.string()),
    causes: z.array(z.string()).optional(), relatedPlotThreads: z.array(z.string()).optional(),
    origin: z.enum(["canon", "inferred", "original"]).optional(), source: z.string().optional()
  })),
  plotThreads: z.array(z.object({
    id: z.string().min(1), title: z.string(), status: z.enum(["open", "active", "resolved", "abandoned"]),
    lastUpdated: z.string(), notes: z.string()
  })),
  continuityNotes: z.array(z.string()),
  foreshadowingUpdates: z.array(ForeshadowingUpdateSchema).optional(),
  macguffinUpdates: z.array(MacGuffinUpdateSchema).optional(),
  relationshipUpdates: z.array(RelationshipUpdateSchema).optional()
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
    motivation: z.string().optional(), resources: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(), currentPressure: z.array(z.string()).optional(),
    decisionHistory: z.array(z.string()).optional(),
    relationships: z.array(z.string()).optional(),
    // 弧光里程碑只记录正文自然呈现的转折，字段多为可选。
    arcMilestones: z.array(ARC_MILESTONE_SCHEMA).optional(), stateUpdatedAt: z.string().optional()
  })).optional(),
  events: z.array(z.object({
    id: z.string().min(1), summary: z.string(), position: z.string(),
    participants: z.array(z.string()), consequences: z.array(z.string()),
    causes: z.array(z.string()).optional(), relatedPlotThreads: z.array(z.string()).optional(),
    origin: z.enum(["canon", "inferred", "original"]).optional(), source: z.string().optional()
  })).optional(),
  plotThreads: z.array(z.object({
    id: z.string().min(1), title: z.string(), status: z.enum(["open", "active", "resolved", "abandoned"]),
    lastUpdated: z.string(), notes: z.string()
  })).optional(),
  continuityNotes: z.array(z.string()),
  foreshadowingUpdates: z.array(ForeshadowingUpdateSchema).optional(),
  macguffinUpdates: z.array(MacGuffinUpdateSchema).optional(),
  relationshipUpdates: z.array(RelationshipUpdateSchema).optional()
}).strict();

export function parseStoryStateUpdate(value: unknown, chapter?: string): Partial<StoryState> {
  const update = StoryStateUpdateSchema.parse(value) as Partial<StoryState>;
  if (chapter !== undefined) {
    for (const item of [...(update.foreshadowingUpdates ?? []), ...(update.macguffinUpdates ?? []), ...(update.relationshipUpdates ?? [])]) {
      if (!chapter.includes(item.evidence)) {
        throw new Error("Story graph update evidence is not present in the final chapter: " + item.id);
      }
    }
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
    motivation?: string;
    resources?: string[];
    constraints?: string[];
    currentPressure?: string[];
    decisionHistory?: string[];
    relationships?: string[];
    arcMilestones?: Array<{ id: string; chapter: string; change: string; choice?: string; pressure?: string; cost?: string; evidence: string }>;
    stateUpdatedAt?: string;
  }>;
  events: Array<{ id: string; summary: string; position: string; participants: string[]; consequences: string[]; causes?: string[]; relatedPlotThreads?: string[]; origin?: "canon" | "inferred" | "original"; source?: string }>;
  plotThreads: Array<{ id: string; title: string; status: "open" | "active" | "resolved" | "abandoned"; lastUpdated: string; notes: string }>;
  continuityNotes: string[];
  /** Append-only, evidence-backed lifecycle changes to story clues. */
  foreshadowingUpdates?: Array<{
    id: string; clueId: string; clue: string;
    status: "planted" | "reinforced" | "misdirected" | "partially_revealed" | "revealed" | "resolved" | "abandoned" | "uncertain";
    chapter: string; change: string; relatedThreadIds: string[]; evidence: string;
  }>;
  /** Append-only, evidence-backed relationship and interaction changes. */
  relationshipUpdates?: Array<{ id: string; relationId: string; from: string; to: string; label: string; chapter: string; change: string; evidence: string }>;
  /** Append-only, evidence-backed changes to important story-driving objects or information. */
  macguffinUpdates?: Array<{
    id: string; macguffinId: string; name: string;
    status: "introduced" | "sought" | "located" | "held" | "transferred" | "lost" | "destroyed" | "secured" | "irrelevant" | "uncertain";
    chapter: string; change: string; holder?: string; location?: string; relatedThreadIds: string[]; evidence: string;
  }>;
}

export function emptyStoryState(worldId: string): StoryState {
  return {
    schemaVersion: 1, worldId, updatedAt: new Date().toISOString(), currentPosition: "尚未建立",
    canonFacts: [], characters: [], events: [], plotThreads: [], continuityNotes: [], foreshadowingUpdates: [], macguffinUpdates: [], relationshipUpdates: []
  };
}

/** Downgrades legacy facts whose source explicitly identifies generated continuation text. */
export function normalizeStoryStateProvenance(state: StoryState): StoryState {
  const generatedSource = /续写|续章|衍生|项目原创|生成章节|本章原创/i;
  return {
    ...state,
    canonFacts: state.canonFacts.map(fact =>
      fact.source && generatedSource.test(fact.source) ? { ...fact, confidence: "original" as const } : fact
    ),
    events: state.events.map(event =>
      event.source && generatedSource.test(event.source) ? { ...event, origin: "original" as const } : event
    )
  };
}

export async function loadStoryState(path: string, worldId: string): Promise<StoryState> {
  const worldDir = dirname(path);
  const databaseState = readDatabaseStoryState(worldDir, worldId);
  if (databaseState) {
    const parsedDatabaseState = StoryStateSchema.safeParse(databaseState);
    if (!parsedDatabaseState.success) throw new Error("Invalid SQLite story state: " + parsedDatabaseState.error.issues.map(issue => issue.path.join(".") + " " + issue.message).join("; "));
    if (parsedDatabaseState.data.worldId !== worldId) throw new Error("SQLite story state world mismatch: " + worldId);
    const normalized = normalizeStoryStateProvenance(parsedDatabaseState.data);
    if (JSON.stringify(normalized) !== JSON.stringify(parsedDatabaseState.data)) await saveStoryState(path, normalized);
    return normalized;
  }
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    const parsed = StoryStateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Invalid story state " + path + ": " + parsed.error.issues.map(issue => issue.path.join(".") + " " + issue.message).join("; "));
    }
    if (parsed.data.worldId !== worldId) throw new Error("Story state world mismatch: " + path);
    const normalized = normalizeStoryStateProvenance(parsed.data);
    if (JSON.stringify(normalized) !== JSON.stringify(parsed.data)) await saveStoryState(path, normalized);
    else syncStoryState(worldDir, normalized);
    return normalized;
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

/**
 * Commit the authoritative Story State first, then atomically publish its matching
 * Story Arc snapshot. If publishing the Arc fails, restore the previous state so
 * the next chapter cannot observe a new state paired with an old plan.
 */
export async function commitStoryStateAndArc(input: {
  statePath: string;
  previousState: StoryState;
  nextState: StoryState;
  applyState: boolean;
  storyArcPath?: string;
  storyArcText?: string;
}): Promise<void> {
  if (!input.applyState) return;
  await saveStoryState(input.statePath, input.nextState);
  if (!input.storyArcPath || input.storyArcText === undefined) return;
  const target = input.storyArcPath;
  const temporary = target + "." + process.pid + "." + Date.now() + ".tmp";
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, input.storyArcText.trim() + "\n", "utf8");
    await rename(temporary, target);
  } catch (error) {
    try {
      await saveStoryState(input.statePath, input.previousState);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Story Arc publication failed and Story State rollback also failed; inspect the run artifacts before continuing.");
    }
    throw new Error("Story Arc publication failed; Story State was rolled back: " + String(error));
  }
}
