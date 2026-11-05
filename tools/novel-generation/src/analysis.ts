import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { runAgentText } from "./generate.js";
import type { LibraryChunk } from "./library.js";

export type NarrativeEntityType = "character" | "organization" | "location" | "object" | "ability" | "concept";
export type ExtractionConfidence = "explicit" | "inferred";

export interface ExtractedEntity {
  name: string;
  type: NarrativeEntityType;
  aliases: string[];
  description?: string;
  evidence: string;
  confidence: ExtractionConfidence;
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
}

export interface ExtractedRelation {
  subject: string;
  predicate: string;
  object: string;
  evidence: string;
  confidence: ExtractionConfidence;
}

export interface ChunkAnnotation {
  chunkId: string;
  source: string;
  chapter: string;
  extractedAt: string;
  entities: ExtractedEntity[];
  events: ExtractedEvent[];
  relations: ExtractedRelation[];
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

function parseObject(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response did not contain a JSON object.");
  const value: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Extraction response must be a JSON object.");
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function validConfidence(value: unknown): ExtractionConfidence {
  return value === "inferred" ? "inferred" : "explicit";
}

function normalizeAnnotation(raw: Record<string, unknown>, chunk: LibraryChunk): ChunkAnnotation {
  const entities = Array.isArray(raw.entities) ? raw.entities.flatMap((item): ExtractedEntity[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.name !== "string" || typeof value.evidence !== "string" || !chunk.text.includes(value.evidence)) return [];
    const allowed: NarrativeEntityType[] = ["character", "organization", "location", "object", "ability", "concept"];
    const type = allowed.includes(value.type as NarrativeEntityType) ? value.type as NarrativeEntityType : "concept";
    return [{
      name: value.name, type, aliases: stringArray(value.aliases),
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      evidence: value.evidence, confidence: validConfidence(value.confidence)
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
      evidence: value.evidence, confidence: validConfidence(value.confidence)
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
      evidence: value.evidence, confidence: validConfidence(value.confidence)
    }];
  }) : [];

  return {
    chunkId: chunk.id, source: chunk.source, chapter: chunk.chapter,
    extractedAt: new Date().toISOString(), entities, events, relations
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
  model?: string
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

  const done = new Set(store.annotations.map(item => item.chunkId));
  const pending = index.chunks.filter(chunk => !done.has(chunk.id)).slice(0, limit);
  let processed = 0;
  let failed = 0;

  for (const chunk of pending) {
    const prompt = [
      "你是中文长篇小说资料分析器。任务是提取可追溯的故事事实，不写评论，不补充原文没有的信息。",
      "只输出 JSON 对象，结构为：",
      JSON.stringify({
        entities: [{ name: "规范名称", type: "character|organization|location|object|ability|concept", aliases: ["原文称谓"], description: "仅写本段明确支持的简短说明", evidence: "原文连续短引文", confidence: "explicit|inferred" }],
        events: [{ summary: "事件", participants: ["参与者"], location: "地点或空", timeExpression: "原文时间表达或空", cause: "明确原因或空", outcome: "明确结果或空", evidence: "原文连续短引文", confidence: "explicit|inferred" }],
        relations: [{ subject: "主体", predicate: "关系", object: "客体", evidence: "原文连续短引文", confidence: "explicit|inferred" }]
      }, null, 2),
      "约束：",
      "- evidence 必须逐字出现在输入文本中，尽量使用最短且足以证明该条目的片段。",
      "- 不确定的别名、身份或因果关系不要强行合并；明确区分 explicit 和 inferred。",
      "- 人物、组织、地点、物品、能力、概念分别分类；普通形容词不要抽成实体。",
      "- 事件按发生的动作或状态变化提取，不要把每句话都当事件。",
      "- 人物关系只记录文本明确表达的关系，不根据共同出现推断亲属、敌友或隶属。",
      "- 没有可靠信息的数组返回空数组。",
      "来源：" + chunk.source + " / " + chunk.chapter,
      "待分析文本：",
      chunk.text
    ].join("\n\n");

    try {
      const response = await runAgentText(prompt, model);
      const annotation = normalizeAnnotation(parseObject(response), chunk);
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
    await saveStore(libraryDir, store);
  }

  const completed = new Set(store.annotations.map(item => item.chunkId));
  return {
    processed, failed,
    remaining: index.chunks.filter(chunk => !completed.has(chunk.id)).length
  };
}
