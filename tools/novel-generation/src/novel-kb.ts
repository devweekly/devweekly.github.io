// 语料知识库批处理：把 library 切片组成定长批次（相邻批次做重叠去重，避免同一段落
// 被算成两次事件），同步 novel_* 知识表；同时提供目录扫描与语料画像入口。
// 语料重新导入后派生分析必须失效重建，本模块导出失效钩子供 library 调用。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  ANALYSIS_BATCH_CHARS,
  ANALYSIS_DEDUPE_MAX_OVERLAP_CHARS,
  ANALYSIS_DEDUPE_MIN_OVERLAP_CHARS,
  CATALOG_SCAN_WINDOW,
  CHARACTER_LIST_MAX_LIMIT,
  MIN_ANALYSIS_BATCH_CHARS
} from "./constants.js";
import { existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  syncNovelChapters, syncNovelMentions, writeNovelKbMeta, upsertSeedCharacters, listNovelCharacters,
  type NovelChapterRow
} from "./database.js";
import { chunkText, ensurePrivateLibraryIsolation, loadLibraryChunks, type LibraryChunk } from "./library.js";
import { alignCanonChapterGroups, canonLineStartOffsets, selectCanonSourceChunks, splitCanonLines, validateCanonCatalogAgainstText, validateCanonChunksAgainstText } from "./canon-chapters.js";
import { ensureBoundedUniverseCanonAssets, resolveOriginalCanonPath } from "./canon-source.js";

export interface CatalogChapter {
  volume: number;
  sequenceInVolume: number;
  printedNumber: number | null;
  title: string;
  label: string;
  line: number | null;
}

export interface ChapterAssignment {
  chapters: NovelChapterRow[];
  chunkChapter: Map<string, NovelChapterRow>;
  unmatchedLabels: string[];
  chaptersWithoutChunks: number[];
}

interface ChapterCatalog {
  chapters: CatalogChapter[];
}

export interface ChapterCatalogDocument {
  chapters: CatalogChapter[];
  totalLines?: number;
}

/** Reads the volume/chapter index produced by analysis/build-corpus-index.mjs. */
export async function loadChapterCatalogDocument(worldId: string, catalogPath?: string): Promise<ChapterCatalogDocument | undefined> {
  const path = catalogPath ?? resolve("analysis", worldId, "chapter-index.json");
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    totalLines?: number;
    volumes?: Array<{ volume: number; chapters?: Array<Record<string, unknown>> }>;
    chapters?: Array<Record<string, unknown>>;
  };
  const rows: CatalogChapter[] = [];
  const push = (item: Record<string, unknown>, volume: number) => {
    const title = String(item.title ?? "").trim();
    if (!title) return;
    rows.push({
      volume,
      sequenceInVolume: Number(item.sequenceInVolume ?? rows.length + 1),
      printedNumber: item.printedNumber === null || item.printedNumber === undefined ? null : Number(item.printedNumber),
      title,
      label: String(item.label ?? title.replace(/^第[^\s]+?[章节回]\s*/, "")).trim(),
      line: item.line === null || item.line === undefined ? null : Number(item.line)
    });
  };
  for (const volume of raw.volumes ?? []) {
    for (const chapter of volume.chapters ?? []) push(chapter, Number(volume.volume));
  }
  if (!rows.length) for (const chapter of raw.chapters ?? []) push(chapter, Number(chapter.volume ?? 1));
  if (!rows.length) throw new Error("Chapter catalog has no chapters: " + path);
  return {
    chapters: rows,
    ...(Number.isSafeInteger(raw.totalLines) && Number(raw.totalLines) > 0 ? { totalLines: Number(raw.totalLines) } : {})
  };
}

export async function loadChapterCatalog(worldId: string, catalogPath?: string): Promise<CatalogChapter[] | undefined> {
  return (await loadChapterCatalogDocument(worldId, catalogPath))?.chapters;
}

interface CanonIndexInputs {
  chunks: LibraryChunk[];
  chapterStartOffsets: Array<number | undefined>;
  originalText?: string;
}

/**
 * Reconstruct a missing source Library index from the canonical offline text
 * and its verified chapter catalog. Existing auxiliary imports are preserved.
 */
export async function ensureSourceCanonLibraryIndex(
  worldId: string,
  worldDir = resolve("worlds", worldId)
): Promise<boolean> {
  const absoluteWorldDir = resolve(worldDir);
  const projectRoot = resolve(absoluteWorldDir, "..", "..");
  const libraryDir = join(absoluteWorldDir, "library");
  const indexPath = join(libraryDir, "index.json");
  await ensurePrivateLibraryIsolation(libraryDir, worldId);

  let existing: { schemaVersion: number; worldId: string; createdAt: string; updatedAt: string; chunks: LibraryChunk[] } | undefined;
  try {
    existing = JSON.parse(await readFile(indexPath, "utf8")) as typeof existing;
    if (!existing || existing.schemaVersion !== 1 || existing.worldId !== worldId || !Array.isArray(existing.chunks)) {
      throw new Error("Library index schema/world mismatch: " + worldId);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const originalPath = await resolveOriginalCanonPath(worldId, { projectRoot, worldDir: absoluteWorldDir });
  const originalText = await readFile(originalPath, "utf8");
  const catalogDocument = await loadChapterCatalogDocument(worldId);
  if (!catalogDocument) throw new Error("缺少 analysis/" + worldId + "/chapter-index.json，无法从离线原文重建 Library。");
  validateCanonCatalogAgainstText(catalogDocument.chapters, originalText, catalogDocument.totalLines);
  const sourceHash = createHash("sha256").update(originalText, "utf8").digest("hex");
  const isCanonicalSource = (source: string) => {
    const normalized = source.replace(/\\\\/g, "/");
    return normalized.split("/").at(-1)?.toLowerCase() === "original.txt" && !normalized.split("/").includes("private");
  };
  const canonicalExisting = (existing?.chunks ?? []).filter(chunk => isCanonicalSource(chunk.source));
  if (canonicalExisting.length) {
    if (canonicalExisting.some(chunk => chunk.sourceHash !== sourceHash)) {
      throw new Error("Library 中已有 original.txt 切片，但 sourceHash 与当前离线原文不一致。请先备份，再执行 ingest --input original.txt，随后执行 index-story；不能混用新旧语料。");
    }
    const prepared = await prepareCanonIndexInputs(absoluteWorldDir, catalogDocument.chapters, canonicalExisting, catalogDocument.totalLines);
    const aligned = alignCanonChapterGroups(catalogDocument.chapters, prepared.chunks, prepared.chapterStartOffsets);
    validateCanonChunksAgainstText(aligned, originalText, prepared.chapterStartOffsets);
    return false;
  }

  const lines = splitCanonLines(originalText);
  const lineStarts = canonLineStartOffsets(originalText);
  const sourceKey = relative(projectRoot, originalPath).split(/[\\\\/]/).join("/");
  const chunks: LibraryChunk[] = [];
  for (let index = 0; index < catalogDocument.chapters.length; index++) {
    const chapter = catalogDocument.chapters[index]!;
    if (!Number.isSafeInteger(chapter.line) || (chapter.line ?? 0) < 1) {
      throw new Error("原文目录缺少有效行号，无法重建章节切片：" + chapter.title);
    }
    const startLine = chapter.line as number;
    const nextLine = catalogDocument.chapters[index + 1]?.line;
    if (nextLine !== undefined && (!Number.isSafeInteger(nextLine) || nextLine <= startLine)) {
      throw new Error("原文目录章节行号顺序异常：" + chapter.title);
    }
    const chapterText = lines.slice(startLine - 1, nextLine === undefined ? lines.length : nextLine - 1).join("\\n").trim();
    if (!chapterText) throw new Error("原文目录章节没有正文，无法重建切片：" + chapter.title);
    const lineText = lines[startLine - 1] ?? "";
    const chapterStart = (lineStarts[startLine - 1] ?? 0) + lineText.length - lineText.trimStart().length;
    const stableId = chapterId(chapter.volume, chapter.sequenceInVolume);
    chunkText(chapterText).forEach((part, chunkIndex) => chunks.push({
      id: sourceKey + ":catalog:" + stableId + ":" + chunkIndex,
      source: sourceKey, chapter: chapter.title, chunkIndex,
      start: part.start, end: part.end, text: part.text,
      sourceHash, chapterStart
    }));
  }
  if (!chunks.length) throw new Error("从 original.txt 重建后没有得到任何章节切片。");
  const now = new Date().toISOString();
  await mkdir(libraryDir, { recursive: true });
  const next = {
    schemaVersion: 1 as const, worldId,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
    chunks: [...(existing?.chunks ?? []), ...chunks]
  };
  const temporary = indexPath + ".canon-rebuild.tmp";
  await writeFile(temporary, JSON.stringify(next, null, 2) + "\\n", "utf8");
  await rename(temporary, indexPath);
  return true;
}

/** Align indexing to the exact original.txt bytes, not similarly named auxiliary imports. */
export async function prepareCanonIndexInputs(worldDir: string, catalog: CatalogChapter[], chunks: LibraryChunk[], expectedTotalLines?: number): Promise<CanonIndexInputs> {
  let originalText: string | undefined;
  try {
    const originalPath = await resolveOriginalCanonPath(basename(worldDir), {
      projectRoot: resolve(worldDir, "..", ".."),
      worldDir
    });
    originalText = await readFile(originalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (originalText !== undefined) validateCanonCatalogAgainstText(catalog, originalText, expectedTotalLines);
  const sourceHash = originalText === undefined ? undefined : createHash("sha256").update(originalText, "utf8").digest("hex");
  const canonChunks = selectCanonSourceChunks(chunks, sourceHash);
  const chapterStartOffsets: Array<number | undefined> = [];
  if (originalText !== undefined) {
    const lines = splitCanonLines(originalText);
    const starts = canonLineStartOffsets(originalText);
    for (const chapter of catalog) {
      const lineIndex = chapter.line == null ? -1 : chapter.line - 1;
      const line = lines[lineIndex] ?? "";
      chapterStartOffsets.push(lineIndex < 0 ? undefined :
        (starts[lineIndex] ?? 0) + line.length - line.trimStart().length);
    }
    const aligned = alignCanonChapterGroups(catalog, canonChunks, chapterStartOffsets);
    validateCanonChunksAgainstText(aligned, originalText, chapterStartOffsets);
    for (const item of aligned) {
      if (!item.chunks.length) throw new Error("Library 缺少原文目录章节切片：" + item.chapter.title + "。请执行 ingest --input original.txt 后再执行 index-story。");
    }
  } else {
    chapterStartOffsets.push(...catalog.map(() => undefined));
  }
  return { chunks: canonChunks, chapterStartOffsets, ...(originalText !== undefined ? { originalText } : {}) };
}

export function chapterId(volume: number, sequence: number): string {
  return `V${String(volume).padStart(2, "0")}-C${String(sequence).padStart(3, "0")}`;
}

/**
 * Maps chunks to catalog chapters by walking both in file order.
 * Chapter titles repeat across volumes ("第一章" appears 17 times), so matching
 * must be positional; a label search from the current pointer disambiguates.
 */
export function assignChapters(chunks: LibraryChunk[], catalog: CatalogChapter[], chapterStartOffsets: Array<number | undefined> = []): ChapterAssignment {
  const chapters: NovelChapterRow[] = [];
  const chunkChapter = new Map<string, NovelChapterRow>();
  const unmatchedLabels: string[] = [];
  const frontMatter: NovelChapterRow = {
    chapterId: "V00-C000", ordinal: 0, volume: 0, printedNumber: null,
    title: "前置内容", label: "前置内容", startLine: null,
    charCount: 0, chunkStart: 0, chunkEnd: -1
  };

  let pointer = 0;
  let current: NovelChapterRow | undefined;
  let currentLabel = "";
  const chunkStart = new Map<string, number>();
  const chunkEnd = new Map<string, number>();
  const chars = new Map<string, number>();

  chunks.forEach((chunk, index) => {
    if (chunk.chapter !== currentLabel) {
      currentLabel = chunk.chapter;
      let found = -1;
      const candidates: number[] = [];
      for (let scan = pointer; scan < catalog.length && scan < pointer + CATALOG_SCAN_WINDOW; scan++) {
        if (catalog[scan]?.title === chunk.chapter) candidates.push(scan);
      }
      if (chunk.chapterStart !== undefined) {
        found = candidates.find(scan => chapterStartOffsets[scan] === chunk.chapterStart) ?? -1;
        if (found < 0 && candidates.length && candidates.some(scan => chapterStartOffsets[scan] !== undefined)) {
          throw new Error("原著切片章节位置与 chapter-index.json 不一致：" + chunk.chapter + "（chapterStart=" + chunk.chapterStart + "）。请检查原文是否已变化，并重建章节索引。");
        }
      } else if (candidates.length > 1) {
        throw new Error("原著切片包含重复章节标题「" + chunk.chapter + "」，但缺少 chapterStart 原文位置，无法安全建立 novel.db。请先备份数据库，再按语料重建流程补齐切片位置元数据。");
      } else if (candidates.length === 1) {
        found = candidates[0]!;
      }
      if (found >= 0) {
        pointer = found + 1;
        const entry = catalog[found] as CatalogChapter;
        current = {
          chapterId: chapterId(entry.volume, entry.sequenceInVolume),
          ordinal: found + 1,
          volume: entry.volume,
          printedNumber: entry.printedNumber,
          title: entry.title,
          label: entry.label,
          startLine: entry.line,
          charCount: 0,
          chunkStart: index,
          chunkEnd: index
        };
        chapters.push(current);
      } else if (!current) {
        unmatchedLabels.push(chunk.chapter);
        current = frontMatter;
        chapters.push(frontMatter);
      } else {
        // Non-catalog groups (front matter, author notes, volume commentary)
        // must not leak into the preceding formal chapter.
        unmatchedLabels.push(chunk.chapter);
        current = undefined;
      }
    }
    if (!current) return;
    chunkChapter.set(chunk.id, current);
    if (!chunkStart.has(current.chapterId)) chunkStart.set(current.chapterId, index);
    chunkEnd.set(current.chapterId, index);
    chars.set(current.chapterId, (chars.get(current.chapterId) ?? 0) + chunk.text.length);
  });

  for (const chapter of chapters) {
    chapter.charCount = chars.get(chapter.chapterId) ?? 0;
    chapter.chunkStart = chunkStart.get(chapter.chapterId) ?? chapter.chunkStart;
    chapter.chunkEnd = chunkEnd.get(chapter.chapterId) ?? chapter.chunkEnd;
  }
  const covered = new Set(chapters.map(chapter => chapter.chapterId));
  const chaptersWithoutChunks: number[] = [];
  catalog.forEach((entry, index) => {
    const id = chapterId(entry.volume, entry.sequenceInVolume);
    if (!covered.has(id)) chaptersWithoutChunks.push(index + 1);
  });
  return { chapters, chunkChapter, unmatchedLabels: [...new Set(unmatchedLabels)], chaptersWithoutChunks };
}

const STOP_NAMES = new Set([
  "我们", "你们", "他们", "她们", "自己", "对方", "众人", "有人", "那人", "此人", "其人",
  "什么", "这个", "那个", "一个", "两个", "所有", "一切", "此时", "当时", "后来", "然后"
]);

/** Characters that almost never occur inside a Chinese personal name. */
const NAME_BREAKERS = /[的了是在和与把被就都也很不没我你他她它们这那有么什]/;

/**
 * Models happily return "男人", "老头子" or "老板" as aliases. Treating those as
 * names would attribute every generic mention in the book to one character, so
 * they stay out of the alias set and out of mention counting.
 */
const GENERIC_ALIASES = new Set([
  "男人", "女人", "老头", "老头子", "老人", "老者", "老翁", "姑娘", "女孩", "女孩儿", "少年", "少年人",
  "妇人", "汉子", "大汉", "大人", "老板", "先生", "小姐", "夫人", "同志", "家伙", "小子", "孩子",
  "厨子", "兄弟", "老乡", "众人", "对方", "那人", "此人", "主人", "客人", "徒弟", "师父", "师尊",
  "师兄", "师姐", "师妹", "师弟", "军需官", "士兵", "道士", "和尚", "县令", "管事", "伙计", "随从",
  "保镖", "首领", "族长", "村长", "掌柜", "公子", "阿姨", "大叔", "大娘", "婶子", "妖", "魔物",
  "年轻人", "年青人", "中年人", "黑衣人", "白衣人", "灰袍人", "胖子", "瘦子", "矮子", "高个子"
]);

export function isUsableAlias(alias: string): boolean {
  const value = normalizeCharacterName(alias);
  if (value.length < 2 || value.length > 6) return false;
  if (!isUsableCharacterName(value)) return false;
  if (GENERIC_ALIASES.has(value)) return false;
  return true;
}

export function normalizeCharacterName(raw: string): string {
  return raw
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[「」『』"“”'']/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** Names must look like a Chinese personal name, not a phrase or a title alone. */
export function isUsableCharacterName(name: string): boolean {
  if (name.length < 2 || name.length > 8) return false;
  if (STOP_NAMES.has(name)) return false;
  if (!/^[\u4e00-\u9fa5·]+$/.test(name)) return false;
  if (NAME_BREAKERS.test(name)) return false;
  return true;
}

export interface CharacterDictionaryEntry { name: string; aliases: string[] }

export function buildCharacterDictionary(entries: CharacterDictionaryEntry[]): Map<string, string> {
  const aliasToCanonical = new Map<string, string>();
  for (const entry of entries) {
    const canonical = normalizeCharacterName(entry.name);
    if (!isUsableCharacterName(canonical)) continue;
    if (!aliasToCanonical.has(canonical)) aliasToCanonical.set(canonical, canonical);
    for (const alias of entry.aliases) {
      const value = normalizeCharacterName(alias);
      if (!isUsableCharacterName(value)) continue;
      if (!aliasToCanonical.has(value)) aliasToCanonical.set(value, canonical);
    }
  }
  return aliasToCanonical;
}

/** Counts mentions per character with longest-alias-first span masking. */
export function countMentions(text: string, aliasToCanonical: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  const aliases = [...aliasToCanonical.keys()].sort((a, b) => b.length - a.length);
  const masked = new Uint8Array(text.length);
  for (const alias of aliases) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(alias, from);
      if (at < 0) break;
      let free = true;
      for (let i = at; i < at + alias.length; i++) if (masked[i]) { free = false; break; }
      if (free) {
        const canonical = aliasToCanonical.get(alias) as string;
        counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
        masked.fill(1, at, at + alias.length);
      }
      from = at + alias.length;
    }
  }
  return counts;
}

/**
 * Chunks overlap by up to 160 characters so retrieval keeps sentence context.
 * Analysis must see each passage once: trim the repeated head of every chunk
 * against the tail of what has already been accumulated for that chapter.
 */
export function dedupeChunkTexts(texts: string[], maxOverlap = ANALYSIS_DEDUPE_MAX_OVERLAP_CHARS): string {
  let acc = "";
  for (const text of texts) {
    if (!acc) { acc = text; continue; }
    const tail = acc.slice(-maxOverlap).replace(/\s/g, "");
    const head = text.slice(0, maxOverlap);
    const headCompact = head.replace(/\s/g, "");
    let overlap = 0;
    for (let k = Math.min(tail.length, headCompact.length); k >= ANALYSIS_DEDUPE_MIN_OVERLAP_CHARS; k--) {
      if (tail.endsWith(headCompact.slice(0, k))) { overlap = k; break; }
    }
    let cut = 0;
    if (overlap) {
      let seen = 0;
      for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i] as string)) seen++;
        if (seen === overlap) { cut = i + 1; break; }
      }
    }
    acc += text.slice(cut);
  }
  return acc;
}

export interface AnalysisUnit {
  chapterId: string;
  ordinal: number;
  volume: number;
  title: string;
  label: string;
  text: string;
  charCount: number;
}

/** Rebuilds one exact, non-overlapping passage per chapter. */
export async function buildAnalysisUnits(
  worldId: string,
  options: { worldDir?: string; catalogPath?: string } = {}
): Promise<{ units: AnalysisUnit[]; assignment: ChapterAssignment }> {
  const worldDir = options.worldDir ?? resolve("worlds", worldId);
  await ensureBoundedUniverseCanonAssets(worldId, { projectRoot: resolve(worldDir, "..", ".."), worldDir });
  if (!options.catalogPath) await ensureSourceCanonLibraryIndex(worldId, worldDir);
  const rawChunks = await loadLibraryChunks(join(worldDir, "library"), worldId);
  if (!rawChunks.length) throw new Error("No indexed text found. Run ingest first.");
  const catalogDocument = await loadChapterCatalogDocument(worldId, options.catalogPath);
  const catalog = catalogDocument?.chapters;
  if (!catalog) throw new Error("No chapter catalog. Run the corpus index script or pass --catalog.");
  const prepared = await prepareCanonIndexInputs(worldDir, catalog, rawChunks, catalogDocument.totalLines);
  const chunks = prepared.chunks;
  if (!chunks.length) throw new Error("No chunks from original.txt were found in the library index.");
  const assignment = assignChapters(chunks, catalog, prepared.chapterStartOffsets);
  const texts = new Map<string, string[]>();
  for (const chunk of chunks) {
    const chapter = assignment.chunkChapter.get(chunk.id);
    if (!chapter) continue;
    const list = texts.get(chapter.chapterId) ?? [];
    list.push(chunk.text);
    texts.set(chapter.chapterId, list);
  }
  const units: AnalysisUnit[] = [];
  for (const chapter of assignment.chapters) {
    const text = dedupeChunkTexts(texts.get(chapter.chapterId) ?? []);
    if (!text.trim()) continue;
    units.push({
      chapterId: chapter.chapterId, ordinal: chapter.ordinal, volume: chapter.volume,
      title: chapter.title, label: chapter.label, text, charCount: text.length
    });
  }
  units.sort((a, b) => a.ordinal - b.ordinal);
  return { units, assignment };
}

/** Packs whole chapters into batches; a chapter is never split across batches. */
export function groupAnalysisUnits(units: AnalysisUnit[], maxChars = ANALYSIS_BATCH_CHARS): AnalysisUnit[][] {
  if (!Number.isInteger(maxChars) || maxChars < MIN_ANALYSIS_BATCH_CHARS) throw new Error("maxChars must be at least " + MIN_ANALYSIS_BATCH_CHARS + ".");
  const batches: AnalysisUnit[][] = [];
  let current: AnalysisUnit[] = [];
  let chars = 0;
  for (const unit of units) {
    if (current.length && chars + unit.charCount > maxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(unit);
    chars += unit.charCount;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Seeds come from the curated world docs; the analysis pass adds names afterwards. */
export async function readSeedCharacters(worldDir: string): Promise<CharacterDictionaryEntry[]> {
  const entries: CharacterDictionaryEntry[] = [];
  const charactersDoc = join(worldDir, "characters.md");
  if (existsSync(charactersDoc)) {
    const text = await readFile(charactersDoc, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split("|").map(cell => cell.trim());
      if (cells.length < 4 || !cells[1] || /^-+$/.test(cells[1]) || cells[1] === "人物" || cells[1] === "人物 / 称号") continue;
      const parts = cells[1].split(/\s*\/\s*/).map(normalizeCharacterName).filter(Boolean);
      if (!parts.length) continue;
      entries.push({ name: parts[0] as string, aliases: parts.slice(1) });
    }
  }
  const stateFile = join(worldDir, "story-state.json");
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(await readFile(stateFile, "utf8")) as { characters?: Array<{ name?: string }> };
      for (const character of state.characters ?? []) {
        if (character.name) entries.push({ name: character.name, aliases: [] });
      }
    } catch {
      // A malformed state file must not block indexing.
    }
  }
  return entries;
}

export interface StoryIndexResult {
  chapters: number;
  chunksMapped: number;
  unmatchedLabels: string[];
  chaptersWithoutChunks: number;
  characters: number;
  aliases: number;
  mentions: number;
}

export async function indexNovelStructure(
  worldId: string,
  options: { worldDir?: string; catalogPath?: string; characters?: CharacterDictionaryEntry[] } = {}
): Promise<StoryIndexResult> {
  const worldDir = options.worldDir ?? resolve("worlds", worldId);
  await ensureBoundedUniverseCanonAssets(worldId, { projectRoot: resolve(worldDir, "..", ".."), worldDir });
  if (!options.catalogPath) await ensureSourceCanonLibraryIndex(worldId, worldDir);
  const rawChunks = await loadLibraryChunks(join(worldDir, "library"), worldId);
  if (!rawChunks.length) throw new Error("No indexed text found. Run ingest before index-story.");

  const catalogDocument = await loadChapterCatalogDocument(worldId, options.catalogPath);
  const catalog = catalogDocument?.chapters;
  if (!catalog) throw new Error("No chapter catalog. Run the corpus index script or pass --catalog.");
  const prepared = await prepareCanonIndexInputs(worldDir, catalog, rawChunks, catalogDocument?.totalLines);
  const chunks = prepared.chunks;
  if (!chunks.length) throw new Error("No chunks from original.txt were found in the library index.");
  const assignment = assignChapters(chunks, catalog, prepared.chapterStartOffsets);
  syncNovelChapters(worldDir, worldId, assignment.chapters);

  const seeds = (options.characters ?? await readSeedCharacters(worldDir))
    .filter(entry => isUsableCharacterName(normalizeCharacterName(entry.name)))
    .map(entry => ({ name: normalizeCharacterName(entry.name), aliases: entry.aliases.filter(isUsableAlias) }));
  const existing = listNovelCharacters(worldDir, worldId, { limit: CHARACTER_LIST_MAX_LIMIT });
  upsertSeedCharacters(worldDir, worldId, seeds);
  // Mention statistics count canonical names only. Aliases are metadata: a
  // generic alias such as "男人" would otherwise swallow thousands of mentions.
  const dictionary = buildCharacterDictionary([
    ...seeds.map(entry => ({ name: entry.name, aliases: [] })),
    ...existing.map(character => ({ name: character.name, aliases: [] }))
  ]);

  const texts = new Map<string, string[]>();
  for (const chunk of chunks) {
    const chapter = assignment.chunkChapter.get(chunk.id);
    if (!chapter) continue;
    const list = texts.get(chapter.chapterId) ?? [];
    list.push(chunk.text);
    texts.set(chapter.chapterId, list);
  }
  const textByChapter = new Map<string, string>();
  for (const [id, list] of texts) textByChapter.set(id, dedupeChunkTexts(list));

  const mentions: Array<{ chapterId: string; name: string; count: number }> = [];
  for (const [id, text] of textByChapter) {
    for (const [name, count] of countMentions(text, dictionary)) mentions.push({ chapterId: id, name, count });
  }
  syncNovelMentions(worldDir, worldId, mentions);
  writeNovelKbMeta(worldDir, worldId, {
    indexed_at: new Date().toISOString(),
    chapters: String(assignment.chapters.length),
    chunks: String(chunks.length),
    dictionary: String(dictionary.size)
  });

  return {
    chapters: assignment.chapters.length,
    chunksMapped: assignment.chunkChapter.size,
    unmatchedLabels: assignment.unmatchedLabels,
    chaptersWithoutChunks: assignment.chaptersWithoutChunks.length,
    characters: new Set(dictionary.values()).size,
    aliases: dictionary.size,
    mentions: mentions.length
  };
}
