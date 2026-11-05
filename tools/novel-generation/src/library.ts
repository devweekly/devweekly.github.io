import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { syncLibraryChunks, readLibraryChunks, syncAnnotations, databaseWorldDirFromLibrary } from "./database.js";
import { createHash } from "node:crypto";
import { basename, extname, join, relative, resolve, sep } from "node:path";

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

function chunkText(text: string, maxChars = 1200, overlap = 160): Array<{ text: string; start: number; end: number }> {
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
  const indexPath = join(libraryDir, "index.json");
  let existing: LibraryChunk[] = [];
  try {
    const previous = JSON.parse(await readFile(indexPath, "utf8")) as LibraryIndex;
    if (previous.schemaVersion !== 1 || previous.worldId !== worldId) throw new Error("Library index schema/world mismatch.");
    existing = previous.chunks;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const ingestedSources = new Set(chunks.map(chunk => chunk.source));
  const byId = new Map(existing.filter(chunk => !ingestedSources.has(chunk.source)).map(chunk => [chunk.id, chunk]));
  for (const chunk of chunks) byId.set(chunk.id, chunk);
  const now = new Date().toISOString();
  const index: LibraryIndex = {
    schemaVersion: 1, worldId, createdAt: now, updatedAt: now, chunks: [...byId.values()]
  };
  const temporary = indexPath + ".tmp";
  await writeFile(temporary, JSON.stringify(index, null, 2) + "\n", "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, indexPath);

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
  syncLibraryChunks(databaseWorldDirFromLibrary(libraryDir), worldId, index.chunks);
  searchCache.delete(indexPath);
  try { await unlink(join(libraryDir, "entities.json")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return chunks.length;
}

interface CachedDocument {
  chunk: LibraryChunk;
  counts: Map<string, number>;
}
interface CachedSearchIndex {
  mtimeMs: number;
  size: number;
  total: number;
  documentFrequency: Map<string, number>;
  documents: CachedDocument[];
}
const searchCache = new Map<string, CachedSearchIndex>();

async function loadSearchIndex(indexPath: string): Promise<CachedSearchIndex> {
  const info = await stat(indexPath);
  const cached = searchCache.get(indexPath);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;

  const index = JSON.parse(await readFile(indexPath, "utf8")) as LibraryIndex;
  let chunks = readLibraryChunks(databaseWorldDirFromLibrary(dirname(indexPath)), index.worldId);
  if (!chunks.length && index.chunks.length) {
    syncLibraryChunks(databaseWorldDirFromLibrary(dirname(indexPath)), index.worldId, index.chunks);
    chunks = readLibraryChunks(databaseWorldDirFromLibrary(dirname(indexPath)), index.worldId);
  }
  const documentFrequency = new Map<string, number>();
  const documents = (chunks.length ? chunks : index.chunks).map(chunk => {
    const counts = new Map<string, number>();
    for (const term of terms(chunk.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    return { chunk, counts };
  });
  const next = { mtimeMs: info.mtimeMs, size: info.size, total: Math.max(1, documents.length), documentFrequency, documents };
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
