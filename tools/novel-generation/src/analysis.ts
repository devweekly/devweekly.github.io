import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { syncAnnotations } from "./database.js";
import { join } from "node:path";
import { runAgentText } from "./generate.js";
import type { LibraryChunk } from "./library.js";
import { buildEntityRegistry } from "./entity-registry.js";
import { parseJsonObject } from "./model-json.js";

export type NarrativeEntityType = "character" | "organization" | "location" | "object" | "ability" | "concept";
export type ExtractionConfidence = "explicit" | "inferred";

export interface EvidenceLocation {
  chunkId: string;
  source: string;
  chapter: string;
  sourceHash?: string;
  chapterStart?: number;
  /** Zero-based UTF-16 character offsets within the chapter text, end-exclusive. */
  start: number;
  end: number;
  /** Zero-based UTF-16 character offsets within the complete source file, end-exclusive. */
  sourceStart?: number;
  sourceEnd?: number;
}

export interface ExtractedEntity {
  name: string;
  type: NarrativeEntityType;
  aliases: string[];
  description?: string;
  evidence: string;
  confidence: ExtractionConfidence;
  sourceSpan: EvidenceLocation;
}

export interface ExtractedEvent {
  summary: string;
  participants: string[];
  location?: string;
  timeExpression?: string;
  cause?: string;
  outcome?: string;
  evidence: string;
  confidence: ExtractionConfidence;
  sourceSpan: EvidenceLocation;
}

export interface ExtractedRelation {
  subject: string;
  predicate: string;
  object: string;
  evidence: string;
  confidence: ExtractionConfidence;
  sourceSpan: EvidenceLocation;
}

export interface CoreferenceMention {
  mention: string;
  refersTo: string;
  evidence: string;
  confidence: ExtractionConfidence;
  sourceSpan: EvidenceLocation;
  entityId?: string;
}

export interface EvidenceReview {
  kind: "entity" | "event" | "relation" | "coreference";
  index: number;
  supported: boolean;
  reason: string;
  evidence: string;
}

export interface ChunkAnnotation {
  chunkId: string;
  source: string;
  chapter: string;
  extractedAt: string;
  entities: ExtractedEntity[];
  events: ExtractedEvent[];
  relations: ExtractedRelation[];
  coreferences: CoreferenceMention[];
  evidenceReviews?: EvidenceReview[];
}

interface LibraryIndex {
  schemaVersion: 1;
  worldId: string;
  chunks: LibraryChunk[];
}

interface AnnotationStore {
  schemaVersion: 1;
  worldId: string;
  updatedAt: string;
  annotations: ChunkAnnotation[];
  failures: Array<{ chunkId: string; error: string; attemptedAt: string }>;
}

export function isEvidenceReviewed(annotation: ChunkAnnotation): boolean {
  // Legacy annotations created before the semantic-review stage must be reprocessed.
  return Array.isArray(annotation.evidenceReviews);
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = parseJsonObject(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Extraction response must be a JSON object.");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error("Model response did not contain a usable JSON object: " + String(error));
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function validConfidence(value: unknown): ExtractionConfidence {
  return value === "explicit" ? "explicit" : "inferred";
}

function evidenceLocation(chunk: LibraryChunk, evidence: string): EvidenceLocation {
  const localStart = chunk.text.indexOf(evidence);
  if (localStart < 0) throw new Error("Evidence is not present in the source chunk.");
  return {
    chunkId: chunk.id, source: chunk.source, chapter: chunk.chapter,
    ...(chunk.sourceHash ? { sourceHash: chunk.sourceHash } : {}),
    ...(typeof chunk.chapterStart === "number" ? { chapterStart: chunk.chapterStart } : {}),
    start: chunk.start + localStart,
    end: chunk.start + localStart + evidence.length,
    ...(typeof chunk.chapterStart === "number" ? { sourceStart: chunk.chapterStart + chunk.start + localStart, sourceEnd: chunk.chapterStart + chunk.start + localStart + evidence.length } : {})
  };
}

function normalizeAnnotation(raw: Record<string, unknown>, chunk: LibraryChunk): ChunkAnnotation {
  const entities = Array.isArray(raw.entities) ? raw.entities.flatMap((item): ExtractedEntity[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.name !== "string" || !value.name.trim() || typeof value.evidence !== "string" || !chunk.text.includes(value.evidence)) return [];
    const allowed: NarrativeEntityType[] = ["character", "organization", "location", "object", "ability", "concept"];
    if (!allowed.includes(value.type as NarrativeEntityType)) return [];
    const type = value.type as NarrativeEntityType;
    return [{
      name: value.name.trim(), type,
      aliases: stringArray(value.aliases).filter(alias => chunk.text.includes(alias)),
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      evidence: value.evidence, confidence: validConfidence(value.confidence),
      sourceSpan: evidenceLocation(chunk, value.evidence)
    }];
  }) : [];

  const events = Array.isArray(raw.events) ? raw.events.flatMap((item): ExtractedEvent[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.summary !== "string" || typeof value.evidence !== "string" || !chunk.text.includes(value.evidence)) return [];
    return [{
      summary: value.summary, participants: stringArray(value.participants),
      ...(typeof value.location === "string" ? { location: value.location } : {}),
      ...(typeof value.timeExpression === "string" ? { timeExpression: value.timeExpression } : {}),
      ...(typeof value.cause === "string" ? { cause: value.cause } : {}),
      ...(typeof value.outcome === "string" ? { outcome: value.outcome } : {}),
      evidence: value.evidence, confidence: validConfidence(value.confidence),
      sourceSpan: evidenceLocation(chunk, value.evidence)
    }];
  }) : [];

  const relations = Array.isArray(raw.relations) ? raw.relations.flatMap((item): ExtractedRelation[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.subject !== "string" || typeof value.predicate !== "string" ||
        typeof value.object !== "string" || typeof value.evidence !== "string" ||
        !chunk.text.includes(value.evidence)) return [];
    return [{
      subject: value.subject, predicate: value.predicate, object: value.object,
      evidence: value.evidence, confidence: validConfidence(value.confidence),
      sourceSpan: evidenceLocation(chunk, value.evidence)
    }];
  }) : [];

  const coreferences = Array.isArray(raw.coreferences) ? raw.coreferences.flatMap((item): CoreferenceMention[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.mention !== "string" || typeof value.refersTo !== "string" ||
        typeof value.evidence !== "string" || !chunk.text.includes(value.mention) ||
        !chunk.text.includes(value.evidence) || !value.evidence.includes(value.mention)) return [];
    return [{
      mention: value.mention, refersTo: value.refersTo, evidence: value.evidence,
      confidence: validConfidence(value.confidence), sourceSpan: evidenceLocation(chunk, value.evidence)
    }];
  }) : [];

  return {
    chunkId: chunk.id, source: chunk.source, chapter: chunk.chapter,
    extractedAt: new Date().toISOString(), entities, events, relations, coreferences
  };
}

/** A separate model pass checks whether each quoted span actually entails its candidate claim. Missing decisions fail closed. */
export async function verifyAnnotationEvidence(
  annotation: ChunkAnnotation,
  chunk: LibraryChunk,
  model?: string,
  timeoutMs = 60_000
): Promise<ChunkAnnotation> {
  const groups = [
    { kind: "entity" as const, items: annotation.entities.map(({ name, type, aliases, description, evidence }) => ({ name, type, aliases, description, evidence })) },
    { kind: "event" as const, items: annotation.events.map(({ summary, participants, location, timeExpression, cause, outcome, evidence }) => ({ summary, participants, location, timeExpression, cause, outcome, evidence })) },
    { kind: "relation" as const, items: annotation.relations.map(({ subject, predicate, object, evidence }) => ({ subject, predicate, object, evidence })) },
    { kind: "coreference" as const, items: annotation.coreferences.map(({ mention, refersTo, evidence }) => ({ mention, refersTo, evidence })) }
  ].filter(group => group.items.length > 0);
  if (!groups.length) return { ...annotation, evidenceReviews: [] };

  const response = await runAgentText([
    "你是小说资料抽取的证据审查员。逐条判断候选结论是否被所附原文证据直接支持。",
    "不得因为结论看起来合理、符合常识或上下文可能如此就判为支持。证据只支持一部分时判 unsupported。",
    "实体：证据必须支持实体确实出现及其类别；别名必须在原文出现且确指同一实体。",
    "事件：证据必须支持事件动作、参与者和声称的结果/原因；缺乏证据的因果不能通过。",
    "关系：证据必须明确表达该关系，不能从共同出现推断。",
    "共指：证据和当前片段必须足以唯一支持 mention 指向 refersTo；无法唯一判断就拒绝。",
    "对每组每个 index 都必须返回一项；不确定、缺项、格式错误均按不支持处理。",
    "只输出 JSON：{entities:[{index,supported,reason}],events:[...],relations:[...],coreferences:[...]}。",
    "原文片段：", chunk.text,
    "待审候选：", JSON.stringify(groups)
  ].join("\n\n"), model, timeoutMs);

  const parsed = parseObject(response);
  const reviews: EvidenceReview[] = [];
  const accepted = new Map<string, Set<number>>();
  for (const group of groups) {
    const decisions = parsed[group.kind];
    const byIndex = new Map<number, { supported: boolean; reason: string }>();
    if (Array.isArray(decisions)) {
      for (const item of decisions) {
        if (!item || typeof item !== "object") continue;
        const value = item as Record<string, unknown>;
        if (typeof value.index !== "number" || !Number.isInteger(value.index)) continue;
        byIndex.set(value.index, {
          supported: value.supported === true,
          reason: typeof value.reason === "string" ? value.reason : "缺少可核验的审查理由"
        });
      }
    }
    const pass = new Set<number>();
    group.items.forEach((item, index) => {
      const decision = byIndex.get(index);
      const supported = decision?.supported === true;
      if (supported) pass.add(index);
      reviews.push({
        kind: group.kind, index, supported,
        reason: decision?.reason ?? "审查结果缺失，按不支持处理",
        evidence: String((item as { evidence?: string }).evidence ?? "")
      });
    });
    accepted.set(group.kind, pass);
  }
  return {
    ...annotation,
    entities: annotation.entities.filter((_, index) => accepted.get("entity")?.has(index) ?? false),
    events: annotation.events.filter((_, index) => accepted.get("event")?.has(index) ?? false),
    relations: annotation.relations.filter((_, index) => accepted.get("relation")?.has(index) ?? false),
    coreferences: annotation.coreferences.filter((_, index) => accepted.get("coreference")?.has(index) ?? false),
    evidenceReviews: reviews
  };
}

async function saveStore(path: string, store: AnnotationStore): Promise<void> {
  await mkdir(path, { recursive: true });
  const file = join(path, "annotations.json");
  const temporary = file + ".tmp";
  await writeFile(temporary, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  await rename(temporary, file);
}

export async function analyzeLibrary(
  libraryDir: string,
  worldId: string,
  limit: number,
  model?: string,
  timeoutMs = 60_000
): Promise<{ processed: number; failed: number; remaining: number }> {
  const index = JSON.parse(await readFile(join(libraryDir, "index.json"), "utf8")) as LibraryIndex;
  if (index.schemaVersion !== 1 || index.worldId !== worldId) throw new Error("Library index schema/world mismatch.");

  const storePath = join(libraryDir, "annotations.json");
  let store: AnnotationStore = { schemaVersion: 1, worldId, updatedAt: new Date().toISOString(), annotations: [], failures: [] };
  try {
    const previous = JSON.parse(await readFile(storePath, "utf8")) as AnnotationStore;
    if (previous.schemaVersion !== 1 || previous.worldId !== worldId) throw new Error("Annotation store schema/world mismatch.");
    store = previous;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const done = new Set(store.annotations.filter(isEvidenceReviewed).map(item => item.chunkId));
  const failedBefore = new Set(store.failures.map(item => item.chunkId));
  const unattempted = index.chunks.filter(chunk => !done.has(chunk.id) && !failedBefore.has(chunk.id));
  const retryable = index.chunks.filter(chunk => !done.has(chunk.id) && failedBefore.has(chunk.id));
  const pending = [...unattempted, ...retryable].slice(0, limit);
  let processed = 0;
  let failed = 0;

  for (const chunk of pending) {
    const prompt = [
      "你是中文长篇小说资料分析器。任务是提取可追溯的故事事实，不写评论，不补充原文没有的信息。",
      "只输出 JSON 对象，结构为：",
      JSON.stringify({
        entities: [{ name: "规范名称", type: "character|organization|location|object|ability|concept", aliases: ["原文称谓"], description: "仅写本段明确支持的简短说明", evidence: "原文连续短引文", confidence: "explicit|inferred" }],
        events: [{ summary: "事件", participants: ["参与者"], location: "地点或空", timeExpression: "原文时间表达或空", cause: "明确原因或空", outcome: "明确结果或空", evidence: "原文连续短引文", confidence: "explicit|inferred" }],
        relations: [{ subject: "主体", predicate: "关系", object: "客体", evidence: "原文连续短引文", confidence: "explicit|inferred" }],
        coreferences: [{ mention: "代词或简称", refersTo: "本片段可明确识别的实体规范名", evidence: "包含 mention 的原文连续短引文", confidence: "explicit|inferred" }]
      }, null, 2),
      "约束：",
      "- evidence 必须逐字出现在输入文本中，尽量使用最短且足以证明该条目的片段。",
      "- 不确定的别名、身份或因果关系不要强行合并；明确区分 explicit 和 inferred。",
      "- 人物、组织、地点、物品、能力、概念分别分类；普通形容词不要抽成实体。",
      "- 事件按发生的动作或状态变化提取，不要把每句话都当事件。",
      "- 人物关系只记录文本明确表达的关系，不根据共同出现推断亲属、敌友或隶属。",
      "- 只提取本片段内有充分上下文支持的共指；mention 必须出现在 evidence 中，无法唯一确定指向时不要输出。",
      "- 没有可靠信息的数组返回空数组。",
      "来源：" + chunk.source + " / " + chunk.chapter,
      "待分析文本：",
      chunk.text
    ].join("\n\n");

    try {
      const response = await runAgentText(prompt, model, timeoutMs);
      const extracted = normalizeAnnotation(parseObject(response), chunk);
      const annotation = await verifyAnnotationEvidence(extracted, chunk, model, timeoutMs);
      store.annotations = [...store.annotations.filter(item => item.chunkId !== chunk.id), annotation];
      store.failures = store.failures.filter(item => item.chunkId !== chunk.id);
      processed++;
    } catch (error) {
      store.failures = [
        ...store.failures.filter(item => item.chunkId !== chunk.id),
        { chunkId: chunk.id, error: error instanceof Error ? error.message : String(error), attemptedAt: new Date().toISOString() }
      ];
      failed++;
    }
  }

  // Persist once per bounded batch instead of rewriting the growing JSON store
  // after every chunk (which made a full run quadratic in bytes written).
  // Legacy annotations without evidenceReviews are excluded from the registry
  // and retried instead of being silently trusted.
  const registry = buildEntityRegistry(worldId, store.annotations.filter(isEvidenceReviewed));
  await saveStore(libraryDir, store);
  const registryPath = join(libraryDir, "entities.json");
  const registryTemporary = registryPath + ".tmp";
  await writeFile(registryTemporary, JSON.stringify(registry, null, 2) + "\n", "utf8");
  await rename(registryTemporary, registryPath);
  syncAnnotations(join(libraryDir, ".."), worldId, store.annotations, registry);

  const completed = new Set(store.annotations.filter(isEvidenceReviewed).map(item => item.chunkId));
  return {
    processed, failed,
    remaining: index.chunks.filter(chunk => !completed.has(chunk.id)).length
  };
}
