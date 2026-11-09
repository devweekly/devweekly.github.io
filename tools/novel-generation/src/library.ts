// 语料存储与检索层：导入按中文章节标题切章、带重叠切片，BM25 词面打分（中文二元组），
// 非向量语义检索。切片记录来源 SHA-256 与章节内字符偏移，供证据逐字定位。
// 重复导入同一 source 会替换全部旧切片并使对应 annotations 失效——语料变化后旧证据不能沿用。
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { LIBRARY_CHUNK_MAX_CHARS, LIBRARY_CHUNK_OVERLAP_CHARS } from "./constants.js";
import { invalidateDerivedAnalysis, syncAnnotations, databaseWorldDirFromLibrary } from "./database.js";
import { createHash } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface LibraryChunk {
  id: string;
  source: string;
  chapter: string;
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
  /** SHA-256 of the complete source file; absent on indexes created before evidence locations. */
  sourceHash?: string;
  /** Character offset of the chapter text in the complete source file. */
  chapterStart?: number;
}

interface LibraryIndex {
  schemaVersion: 1;
  worldId: string;
  createdAt: string;
  updatedAt: string;
  chunks: LibraryChunk[];
}

export interface SearchHit extends LibraryChunk {
  score: number;
}

const HEADING = /^[ \t\u3000]*(第[〇零一二三四五六七八九十百千万0-9０-９]+[章节回卷部篇].*|序章.*|楔子.*|引子.*|尾声.*|终章.*|番外.*|后记.*)[ \t]*$/gm;

function splitChapters(text: string, source: string): Array<{ title: string; text: string; start: number }> {
  const matches = [...text.matchAll(HEADING)];
  const trimSection = (raw: string, absoluteStart: number): { text: string; start: number } => {
    const leading = raw.length - raw.trimStart().length;
    return { text: raw.trim(), start: absoluteStart + leading };
  };
  if (matches.length === 0) {
    const section = trimSection(text, 0);
    return [{ title: basename(source, extname(source)), ...section }];
  }

  const chapters: Array<{ title: string; text: string; start: number }> = [];
  const first = matches[0];
  if (first && first.index !== undefined && first.index > 0) {
    const preface = trimSection(text.slice(0, first.index), 0);
    if (preface.text) chapters.push({ title: "前置内容", ...preface });
  }
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current || current.index === undefined) continue;
    const next = matches[i + 1];
    const sectionStart = current.index;
    const sectionEnd = next?.index ?? text.length;
    const section = trimSection(text.slice(sectionStart, sectionEnd), sectionStart);
    if (section.text) chapters.push({ title: current[0].trim(), ...section });
  }
  return chapters;
}

export function chunkText(text: string, maxChars = LIBRARY_CHUNK_MAX_CHARS, overlap = LIBRARY_CHUNK_OVERLAP_CHARS): Array<{ text: string; start: number; end: number }> {
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf("\n", end),
        text.lastIndexOf("。", end),
        text.lastIndexOf("！", end),
        text.lastIndexOf("？", end)
      );
      if (boundary > start + Math.floor(maxChars * 0.6)) end = boundary + 1;
    }
    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const content = raw.trim();
    if (content) chunks.push({ text: content, start: start + leading, end: end - trailing });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function terms(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const result = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    if (!token) continue;
    if (token.length <= 3) result.add(token);
    else {
      result.add(token);
      for (let i = 0; i < token.length - 1; i++) result.add(token.slice(i, i + 2));
    }
  }
  const compact = normalized.replace(/\s/g, "");
  for (let i = 0; i < compact.length - 1; i++) result.add(compact.slice(i, i + 2));
  return [...result].filter(term => term.length >= 2);
}

function isPrivateSource(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return normalized.startsWith("../") || normalized.startsWith("/") || /^[a-z]:\\//i.test(normalized) ||
    isAbsolute(source) || normalized.split("/").includes("private");
}

async function readOptionalLibraryIndex(indexPath: string, worldId: string): Promise<LibraryIndex | undefined> {
  try {
    const index = JSON.parse(await readFile(indexPath, "utf8")) as LibraryIndex;
    if (index.schemaVersion !== 1 || index.worldId !== worldId || !Array.isArray(index.chunks)) {
      throw new Error("Library index schema/world mismatch.");
    }
    return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeLibraryIndex(indexPath: string, index: LibraryIndex): Promise<void> {
  await mkdir(dirname(indexPath), { recursive: true });
  const temporary = indexPath + ".tmp";
  await writeFile(temporary, JSON.stringify(index, null, 2) + "\n", "utf8");
  await rename(temporary, indexPath);
}

/**
 * Move any legacy private/ or external-file chunks out of the tracked public
 * index. Private annotations may already have reached annotations.json and
 * novel.db in older versions, so clear that mixed annotation registry too.
 */
export async function ensurePrivateLibraryIsolation(libraryDir: string, worldId: string): Promise<boolean> {
  const indexPath = join(libraryDir, "index.json");
  const publicIndex = await readOptionalLibraryIndex(indexPath, worldId);
  const privateChunks = (publicIndex?.chunks ?? []).filter(chunk => isPrivateSource(chunk.source));
  const privateDir = join(dirname(libraryDir), "private-library");
  const privateIndexPath = join(privateDir, "index.json");
  if (privateChunks.length) {
    const existingPrivate = await readOptionalLibraryIndex(privateIndexPath, worldId);
    const byId = new Map((existingPrivate?.chunks ?? []).map(chunk => [chunk.id, chunk]));
    for (const chunk of privateChunks) byId.set(chunk.id, chunk);
    const now = new Date().toISOString();
    await writeLibraryIndex(privateIndexPath, {
      schemaVersion: 1, worldId,
      createdAt: existingPrivate?.createdAt ?? now, updatedAt: now,
      chunks: [...byId.values()]
    });
    if (publicIndex) {
      publicIndex.chunks = publicIndex.chunks.filter(chunk => !isPrivateSource(chunk.source));
      publicIndex.updatedAt = now;
      await writeLibraryIndex(indexPath, publicIndex);
    }
  }

  let hasPrivateAnnotations = false;
  const annotationsPath = join(libraryDir, "annotations.json");
  try {
    const annotations = JSON.parse(await readFile(annotationsPath, "utf8")) as {
      annotations?: Array<{ source?: string }>;
      failures?: Array<{ chunkId?: string }>;
    };
    hasPrivateAnnotations = (annotations.annotations ?? []).some(item => isPrivateSource(item.source ?? "")) ||
      (annotations.failures ?? []).some(item => isPrivateSource(item.chunkId ?? ""));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const registry = JSON.parse(await readFile(join(libraryDir, "entities.json"), "utf8")) as {
      entities?: Array<{ mentions?: Array<{ source?: string }> }>;
    };
    hasPrivateAnnotations ||= (registry.entities ?? []).some(entity =>
      (entity.mentions ?? []).some(mention => isPrivateSource(mention.source ?? ""))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (hasPrivateAnnotations || privateChunks.length) {
    // Older analyze runs persisted private evidence in both JSON and SQLite.
    // Delete the mixed registry rather than risk retaining a private quote.
    syncAnnotations(databaseWorldDirFromLibrary(libraryDir), worldId, [], null);
    for (const name of ["annotations.json", "entities.json"]) {
      try { await unlink(join(libraryDir, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  if (privateChunks.length || hasPrivateAnnotations) {
    searchCache.delete(indexPath);
    searchCache.delete(privateIndexPath);
    return true;
  }
  return false;
}

export async function ingestFiles(worldId: string, inputPaths: string[], libraryDir: string): Promise<number> {
  const chunks: LibraryChunk[] = [];
  for (const inputPath of inputPaths) {
    const absolute = resolve(inputPath);
    const text = await readFile(absolute, "utf8");
    const sourceKey = relative(process.cwd(), absolute).split(sep).join("/");
    const sourceHash = createHash("sha256").update(text, "utf8").digest("hex");
    const chapters = splitChapters(text, absolute);
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const chapter = chapters[chapterIndex];
      if (!chapter) continue;
      const parts = chunkText(chapter.text);
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        chunks.push({
          id: sourceKey + ":" + chapterIndex + ":" + i,
          source: sourceKey,
          chapter: chapter.title,
          chunkIndex: i,
          start: part.start,
          end: part.end,
          text: part.text,
          sourceHash,
          chapterStart: chapter.start
        });
      }
    }
  }

  await mkdir(libraryDir, { recursive: true });
  await ensurePrivateLibraryIsolation(libraryDir, worldId);
  const indexPath = join(libraryDir, "index.json");
  const privateIndexPath = join(dirname(libraryDir), "private-library", "index.json");
  const publicChunks = chunks.filter(chunk => !isPrivateSource(chunk.source));
  const privateChunks = chunks.filter(chunk => isPrivateSource(chunk.source));
  const existingPublic = await readOptionalLibraryIndex(indexPath, worldId);
  const existingPrivate = await readOptionalLibraryIndex(privateIndexPath, worldId);
  const now = new Date().toISOString();

  const publicSources = new Set(publicChunks.map(chunk => chunk.source));
  const publicById = new Map((existingPublic?.chunks ?? [])
    .filter(chunk => !publicSources.has(chunk.source))
    .map(chunk => [chunk.id, chunk]));
  for (const chunk of publicChunks) publicById.set(chunk.id, chunk);
  await writeLibraryIndex(indexPath, {
    schemaVersion: 1, worldId,
    createdAt: existingPublic?.createdAt ?? now, updatedAt: now,
    chunks: [...publicById.values()]
  });

  if (privateChunks.length || existingPrivate) {
    const privateSources = new Set(privateChunks.map(chunk => chunk.source));
    const privateById = new Map((existingPrivate?.chunks ?? [])
      .filter(chunk => !privateSources.has(chunk.source))
      .map(chunk => [chunk.id, chunk]));
    for (const chunk of privateChunks) privateById.set(chunk.id, chunk);
    await writeLibraryIndex(privateIndexPath, {
      schemaVersion: 1, worldId,
      createdAt: existingPrivate?.createdAt ?? now, updatedAt: now,
      chunks: [...privateById.values()]
    });
  }

  if (publicChunks.length) {
    const ingestedSources = new Set(publicSources);
    const annotationsPath = join(libraryDir, "annotations.json");
    try {
      const annotations = JSON.parse(await readFile(annotationsPath, "utf8")) as {
        schemaVersion: number; worldId: string; annotations: Array<{ source: string }>;
        failures: Array<{ chunkId: string }>; updatedAt?: string;
      };
      if (annotations.schemaVersion === 1 && annotations.worldId === worldId) {
        const filtered = {
          ...annotations,
          updatedAt: now,
          annotations: annotations.annotations.filter(item => !ingestedSources.has(item.source)),
          failures: annotations.failures.filter(item => ![...ingestedSources].some(source => item.chunkId.startsWith(source + ":")))
        };
        const annotationTemp = annotationsPath + ".tmp";
        await writeFile(annotationTemp, JSON.stringify(filtered, null, 2) + "\n", "utf8");
        await rename(annotationTemp, annotationsPath);
        syncAnnotations(databaseWorldDirFromLibrary(libraryDir), worldId, filtered.annotations as unknown as Array<{ chunkId: string; source: string; chapter?: string; extractedAt?: string }>, null);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    invalidateDerivedAnalysis(databaseWorldDirFromLibrary(libraryDir), worldId);
    try { await unlink(join(libraryDir, "entities.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  searchCache.delete(indexPath);
  searchCache.delete(privateIndexPath);
  return chunks.length;
}

interface CachedDocument {
  chunk: LibraryChunk;
  counts: Map<string, number>;
}
interface CachedSearchIndex {
  mtimeMs: number;
  size: number;
  privateMtimeMs?: number;
  privateSize?: number;
  total: number;
  documentFrequency: Map<string, number>;
  documents: CachedDocument[];
}
const searchCache = new Map<string, CachedSearchIndex>();

export async function loadLibraryChunks(libraryDir: string, worldId: string): Promise<LibraryChunk[]> {
  await ensurePrivateLibraryIsolation(libraryDir, worldId);
  const indexPath = join(libraryDir, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8")) as LibraryIndex;
  if (index.worldId !== worldId) throw new Error("Library index world mismatch: " + worldId);
  return index.chunks;
}

async function loadSearchIndex(indexPath: string): Promise<CachedSearchIndex> {
  const libraryDir = dirname(indexPath);
  const initial = JSON.parse(await readFile(indexPath, "utf8")) as LibraryIndex;
  await ensurePrivateLibraryIsolation(libraryDir, initial.worldId);
  const info = await stat(indexPath);
  const privateIndexPath = join(dirname(libraryDir), "private-library", "index.json");
  let privateInfo: Awaited<ReturnType<typeof stat>> | undefined;
  try { privateInfo = await stat(privateIndexPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const cached = searchCache.get(indexPath);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size &&
      cached.privateMtimeMs === privateInfo?.mtimeMs && cached.privateSize === privateInfo?.size) return cached;

  const index = JSON.parse(await readFile(indexPath, "utf8")) as LibraryIndex;
  const privateIndex = privateInfo
    ? JSON.parse(await readFile(privateIndexPath, "utf8")) as LibraryIndex
    : undefined;
  if (privateIndex && privateIndex.worldId !== index.worldId) throw new Error("Private library index world mismatch: " + index.worldId);
  const chunks = [...index.chunks, ...(privateIndex?.chunks ?? [])];
  const documentFrequency = new Map<string, number>();
  const documents = chunks.map(chunk => {
    const counts = new Map<string, number>();
    for (const term of terms(chunk.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    return { chunk, counts };
  });
  const next = {
    mtimeMs: info.mtimeMs, size: info.size,
    privateMtimeMs: privateInfo?.mtimeMs, privateSize: privateInfo?.size,
    total: Math.max(1, documents.length), documentFrequency, documents
  };
  searchCache.set(indexPath, next);
  return next;
}

export async function searchLibrary(libraryDir: string, query: string, limit = 6): Promise<SearchHit[]> {
  const indexPath = join(libraryDir, "index.json");
  let index: CachedSearchIndex;
  try {
    index = await loadSearchIndex(indexPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const queryTerms = terms(query);
  if (!queryTerms.length) return [];
  const exact = query.trim();
  const hits: SearchHit[] = [];
  for (const document of index.documents) {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = document.counts.get(term) ?? 0;
      if (!frequency) continue;
      const df = index.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (index.total - df + 0.5) / (df + 0.5));
      score += idf * (frequency * 2.2) / (frequency + 1.2);
    }
    if (exact.length >= 2 && document.chunk.text.includes(exact)) score += 5;
    if (score > 0) hits.push({ ...document.chunk, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function listTextFiles(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const ext = extname(path).toLowerCase();
    if ([".txt", ".md"].includes(ext)) {
      result.push(path);
      return;
    }
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && [".txt", ".md"].includes(extname(entry.name).toLowerCase())) result.push(child);
    }
  };
  for (const path of paths) await visit(path);
  return [...new Set(result)];
}
