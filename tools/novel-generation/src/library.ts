import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

export interface LibraryChunk {
  id: string;
  source: string;
  chapter: string;
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
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

const HEADING = /^(第[〇零一二三四五六七八九十百千万0-9０-９]+[章节回卷部篇].*|序章.*|楔子.*|引子.*|尾声.*|终章.*|番外.*|后记.*)$/gm;

function splitChapters(text: string, source: string): Array<{ title: string; text: string }> {
  const matches = [...text.matchAll(HEADING)];
  if (matches.length < 2) return [{ title: basename(source, extname(source)), text: text.trim() }];
  const chapters: Array<{ title: string; text: string }> = [];
  const first = matches[0];
  if (first && first.index !== undefined && first.index > 0) {
    const preface = text.slice(0, first.index).trim();
    if (preface) chapters.push({ title: "前置内容", text: preface });
  }
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current || current.index === undefined) continue;
    const next = matches[i + 1];
    const start = current.index;
    const end = next?.index ?? text.length;
    const section = text.slice(start, end).trim();
    if (section) chapters.push({ title: current[0].trim(), text: section });
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
    const content = text.slice(start, end).trim();
    if (content) chunks.push({ text: content, start, end });
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
    const chapters = splitChapters(text, absolute);
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const chapter = chapters[chapterIndex];
      if (!chapter) continue;
      const parts = chunkText(chapter.text);
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        chunks.push({
          id: basename(absolute, extname(absolute)) + ":" + chapterIndex + ":" + i,
          source: basename(absolute),
          chapter: chapter.title,
          chunkIndex: i,
          start: part.start,
          end: part.end,
          text: part.text
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
  const byId = new Map(existing.map(chunk => [chunk.id, chunk]));
  for (const chunk of chunks) byId.set(chunk.id, chunk);
  const now = new Date().toISOString();
  const index: LibraryIndex = {
    schemaVersion: 1, worldId, createdAt: now, updatedAt: now, chunks: [...byId.values()]
  };
  const temporary = indexPath + ".tmp";
  await writeFile(temporary, JSON.stringify(index, null, 2) + "\n", "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, indexPath);
  return chunks.length;
}

export async function searchLibrary(libraryDir: string, query: string, limit = 6): Promise<SearchHit[]> {
  const indexPath = join(libraryDir, "index.json");
  let index: LibraryIndex;
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as LibraryIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const queryTerms = terms(query);
  if (!queryTerms.length) return [];
  const documentFrequency = new Map<string, number>();
  for (const chunk of index.chunks) {
    const unique = new Set(terms(chunk.text));
    for (const term of unique) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const total = Math.max(1, index.chunks.length);
  const hits: SearchHit[] = [];
  for (const chunk of index.chunks) {
    const docTerms = terms(chunk.text);
    const counts = new Map<string, number>();
    for (const term of docTerms) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const frequency = counts.get(term) ?? 0;
      if (!frequency) continue;
      const idf = Math.log(1 + (total - (documentFrequency.get(term) ?? 0) + 0.5) / ((documentFrequency.get(term) ?? 0) + 0.5));
      score += idf * (frequency * 2.2) / (frequency + 1.2);
    }
    const exact = query.trim();
    if (exact.length >= 2 && chunk.text.includes(exact)) score += 5;
    if (score > 0) hits.push({ ...chunk, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function listTextFiles(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const path of paths) {
    const ext = extname(path).toLowerCase();
    if ([".txt", ".md"].includes(ext)) result.push(path);
    else {
      const stat = await readdir(path, { withFileTypes: true });
      for (const entry of stat) {
        if (entry.isFile() && [".txt", ".md"].includes(extname(entry.name).toLowerCase())) result.push(join(path, entry.name));
      }
    }
  }
  return result;
}
