// 语料知识库批处理：把 library 切片组成定长批次（相邻批次做重叠去重，避免同一段落
// 被算成两次事件），同步 novel_* 知识表；同时提供目录扫描与语料画像入口。
// 语料重新导入后派生分析必须失效重建，本模块导出失效钩子供 library 调用。
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
  invalidateStoryAnalysis, readNovelKbMeta, syncAnnotations, type NovelChapterRow
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
  sourceHash?: string;
}

/** Reads the volume/chapter index produced by analysis/build-corpus-index.mjs. */
export async function loadChapterCatalogDocument(worldId: string, catalogPath?: string): Promise<ChapterCatalogDocument | undefined> {
  const path = catalogPath ?? resolve("analysis", worldId, "chapter-index.json");
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    totalLines?: number;
    sourceHash?: string;
    volumes?: Array<{ volume: number; chapters?: Array<Record<string, unknown>> }>;
    chapters?: Array<Record<string, unknown>>;
  };
  if (raw.sourceHash !== undefined &&
      (typeof raw.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(raw.sourceHash))) {
    throw new Error("chapter-index.json 的 sourceHash 格式无效：" + path);
  }
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
    ...(Number.isSafeInteger(raw.totalLines) && Number(raw.totalLines) > 0 ? { totalLines: Number(raw.totalLines) } : {}),
    ...(typeof raw.sourceHash === "string" && /^[a-f0-9]{64}$/i.test(raw.sourceHash) ? { sourceHash: raw.sourceHash.toLowerCase() } : {})
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

const canonLibraryValidationCache = new Map<string, string>();

/**
 * Reconstruct missing chapter chunks from the canonical offline text and its
 * verified catalog. Existing auxiliary imports and valid chapter chunks remain.
 */
export async function ensureSourceCanonLibraryIndex(
  worldId: string,
  worldDir = resolve("worlds", worldId)
): Promise<boolean> {
  const absoluteWorldDir = resolve(worldDir);
  const projectRoot = resolve(absoluteWorldDir, "..", "..");
  const libraryDir = join(absoluteWorldDir, "library");
  const indexPath = join(libraryDir, "index.json");
  let existing: { schemaVersion: number; worldId: string; createdAt: string; updatedAt: string; chunks: LibraryChunk[] } | undefined;
  try {
    existing = JSON.parse(await readFile(indexPath, "utf8")) as typeof existing;
    if (!existing || existing.schemaVersion !== 1 || existing.worldId !== worldId || !Array.isArray(existing.chunks)) {
      throw new Error("Library index schema/world mismatch: " + worldId);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      // Preserve a damaged derived cache for diagnosis, then rebuild it from
      // the canonical offline text. Never silently parse partial JSON.
      const backupPath = indexPath + ".corrupt-" + Date.now();
      await rename(indexPath, backupPath);
      existing = undefined;
    } else if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await ensurePrivateLibraryIsolation(libraryDir, worldId);

  let originalPath: string;
  try {
    originalPath = await resolveOriginalCanonPath(worldId, { projectRoot, worldDir: absoluteWorldDir });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const originalText = await readFile(originalPath, "utf8");
  const originalHash = createHash("sha256").update(originalText, "utf8").digest("hex");
  const catalogDocument = await loadChapterCatalogDocument(worldId, join(projectRoot, "analysis", worldId, "chapter-index.json"));
  if (!catalogDocument) return false;
  validateCanonCatalogAgainstText(catalogDocument.chapters, originalText, catalogDocument.totalLines, catalogDocument.sourceHash);
  if (!catalogDocument.sourceHash) {
    // Older catalogs predate corpus fingerprints. Once their line count and
    // every chapter heading have been verified against the local full text,
    // pin this exact source generation so same-shape text replacements cannot
    // silently reuse the catalog later.
    const catalogPath = join(projectRoot, "analysis", worldId, "chapter-index.json");
    const rawCatalog = JSON.parse(await readFile(catalogPath, "utf8")) as Record<string, unknown>;
    if (rawCatalog.sourceHash === undefined) {
      rawCatalog.sourceHash = originalHash;
      const temporaryCatalogPath = catalogPath + ".source-hash.tmp";
      await writeFile(temporaryCatalogPath, JSON.stringify(rawCatalog, null, 2) + "\n", "utf8");
      await rename(temporaryCatalogPath, catalogPath);
    } else {
      throw new Error("chapter-index.json 已有无效 sourceHash，拒绝自动覆盖：" + catalogPath);
    }
  }

  let indexInfo: Awaited<ReturnType<typeof stat>> | undefined;
  try { indexInfo = await stat(indexPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Include the content hash: size + mtime can miss same-size replacements on
  // filesystems with coarse timestamp resolution.
  const signature = [originalHash, indexInfo?.size ?? "missing", indexInfo?.mtimeMs ?? "missing"].join(":");
  if (indexInfo && canonLibraryValidationCache.get(indexPath) === signature) return false;

  const isCanonicalSource = (source: string) => {
    const normalized = source.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts.at(-1)?.toLowerCase() === "original.txt" && !parts.includes("private");
  };
  const allChunks = existing?.chunks ?? [];
  const canonicalExisting = allChunks.filter(chunk => isCanonicalSource(chunk.source));
  const staleCanonical = canonicalExisting.some(chunk => chunk.sourceHash !== undefined && chunk.sourceHash !== originalHash);
  const existingMeta = existsSync(join(absoluteWorldDir, "novel.db"))
    ? readNovelKbMeta(absoluteWorldDir, worldId)
    : {};
  const staleDerivedAnalysis = staleCanonical ||
    (typeof existingMeta.source_hash === "string" && existingMeta.source_hash !== originalHash);
  // A stale or hashless chunk is not trusted. Rebuild from the canonical text
  // rather than mixing old evidence into the current corpus.
  const trustedCanonical = staleCanonical ? [] : canonicalExisting.filter(chunk => chunk.sourceHash === originalHash);
  const prepared = await prepareCanonIndexInputs(
    absoluteWorldDir, catalogDocument.chapters, trustedCanonical,
    catalogDocument.totalLines, catalogDocument.sourceHash
  );
  const aligned = alignCanonChapterGroups(catalogDocument.chapters, prepared.chunks, prepared.chapterStartOffsets);
  validateCanonChunksAgainstText(aligned, originalText, prepared.chapterStartOffsets);
  const missing = aligned.find(item => item.chunks.length === 0);
  if (missing) throw new Error("离线原文切片重建后仍缺少章节：" + missing.chapter.title + "。请检查 chapter-index.json 的行号与正文。");

  const canonicalUnchanged = !staleCanonical &&
    canonicalExisting.length === prepared.chunks.length &&
    canonicalExisting.every(chunk => prepared.chunks.some(candidate =>
      candidate.id === chunk.id && candidate.text === chunk.text &&
      candidate.sourceHash === chunk.sourceHash && candidate.chapterStart === chunk.chapterStart &&
      candidate.start === chunk.start && candidate.end === chunk.end
    ));
  if (canonicalUnchanged) {
    canonLibraryValidationCache.set(indexPath, signature);
    return false;
  }

  const now = new Date().toISOString();
  const next = {
    schemaVersion: 1 as const,
    worldId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Preserve non-canonical user imports, but replace the entire canonical
    // slice set atomically with the verified/rebuilt original.txt generation.
    chunks: [...allChunks.filter(chunk => !isCanonicalSource(chunk.source)), ...prepared.chunks]
  };
  await mkdir(libraryDir, { recursive: true });
  const temporary = indexPath + ".canon-rebuild.tmp";
  await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(temporary, indexPath);

  // Derived analysis and annotations point at old chunk IDs/text. Clear them
  // only after the replacement index has been committed.
  if (existsSync(join(absoluteWorldDir, "novel.db"))) {
    if (staleDerivedAnalysis) invalidateStoryAnalysis(absoluteWorldDir, worldId);
    syncAnnotations(absoluteWorldDir, worldId, [], null);
  }
  for (const name of ["annotations.json", "entities.json"]) {
    try { await unlink(join(libraryDir, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const writtenInfo = await stat(indexPath);
  canonLibraryValidationCache.set(indexPath, [originalHash, writtenInfo.size, writtenInfo.mtimeMs].join(":"));
  return true;
}

/** Align indexing to the exact original.txt bytes, not similarly named auxiliary imports. */
export async function prepareCanonIndexInputs(worldDir: string, catalog: CatalogChapter[], chunks: LibraryChunk[], expectedTotalLines?: number, expectedSourceHash?: string): Promise<CanonIndexInputs> {
  let originalText: string | undefined;
  let originalPath: string | undefined;
  let resolverWorldId = basename(worldDir);
  // Universe creation indexes its staging directory before the final rename;
  // the directory basename is ".staging-<id>", so use the persisted universe ID.
  try {
    const universe = JSON.parse(await readFile(join(worldDir, "universe.json"), "utf8")) as { id?: string };
    if (typeof universe.id === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(universe.id)) resolverWorldId = universe.id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    originalPath = await resolveOriginalCanonPath(resolverWorldId, {
      projectRoot: resolve(worldDir, "..", ".."),
      worldDir
    });
    originalText = await readFile(originalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (originalText !== undefined) validateCanonCatalogAgainstText(catalog, originalText, expectedTotalLines, expectedSourceHash);
  const sourceHash = originalText === undefined ? undefined : createHash("sha256").update(originalText, "utf8").digest("hex");
  const sourceCandidates = selectCanonSourceChunks(chunks);
  if (sourceHash !== undefined && sourceCandidates.some(chunk => chunk.sourceHash !== undefined && chunk.sourceHash !== sourceHash)) {
    throw new Error("Library 中存在与当前离线 original.txt 不一致的旧切片。为避免混用不同版本语料，已拒绝读取；请备份后重建原文索引。");
  }
  let canonChunks = selectCanonSourceChunks(chunks, sourceHash);
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
    const missing = aligned.filter(item => item.chunks.length === 0);
    if (missing.length) {
      const sourceKey = relative(resolve(worldDir, "..", ".."), originalPath!).replace(/\\/g, "/");
      const rebuiltByCatalogIndex = new Map<number, LibraryChunk[]>();
      for (const item of missing) {
        const start = chapterStartOffsets[item.catalogIndex];
        const end = chapterStartOffsets[item.catalogIndex + 1] ?? originalText.length;
        if (start === undefined || end <= start) {
          throw new Error("原文目录缺少有效行号，无法从离线全文重建章节切片：" + item.chapter.title);
        }
        const chapterText = originalText.slice(start, end).trim();
        if (!chapterText) throw new Error("原文目录章节没有正文，无法重建切片：" + item.chapter.title);
        const stableId = chapterId(item.chapter.volume, item.chapter.sequenceInVolume);
        const rebuilt = chunkText(chapterText).map((part, chunkIndex) => ({
          id: sourceKey + ":catalog:" + stableId + ":" + chunkIndex,
          source: sourceKey,
          chapter: item.chapter.title,
          chunkIndex,
          start: part.start,
          end: part.end,
          text: part.text,
          sourceHash,
          chapterStart: start
        }));
        rebuiltByCatalogIndex.set(item.catalogIndex, rebuilt);
      }
      // Insert reconstructed groups at their catalog positions. Appending them
      // to the end would misalign a missing middle chapter when later chapters
      // with repeated titles already have valid chunks.
      const completed = aligned.map(item => ({
        ...item,
        chunks: [
          ...item.chunks,
          ...(rebuiltByCatalogIndex.get(item.catalogIndex) ?? [])
        ].sort((a, b) => a.chunkIndex - b.chunkIndex)
      }));
      validateCanonChunksAgainstText(completed, originalText, chapterStartOffsets);
      const stillMissing = completed.find(item => item.chunks.length === 0);
      if (stillMissing) throw new Error("从离线 original.txt 重建后仍缺少章节切片：" + stillMissing.chapter.title);
      canonChunks = completed.flatMap(item => item.chunks) as LibraryChunk[];
    } else {
      canonChunks = aligned.flatMap(item => [...item.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)) as LibraryChunk[];
    }
  } else {
    chapterStartOffsets.push(...catalog.map(() => undefined));
    if (!canonChunks.length) throw new Error("离线 original.txt 不可用，且没有可用的原文切片；无法重建章节内容。");
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
  const catalogPath = options.catalogPath ?? join(resolve(worldDir, "..", ".."), "analysis", worldId, "chapter-index.json");
  const catalogDocument = await loadChapterCatalogDocument(worldId, catalogPath);
  const catalog = catalogDocument?.chapters;
  if (!catalog) throw new Error("No chapter catalog. Run the corpus index script or pass --catalog.");
  const prepared = await prepareCanonIndexInputs(worldDir, catalog, rawChunks, catalogDocument.totalLines, catalogDocument.sourceHash);
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

  const catalogPath = options.catalogPath ?? join(resolve(worldDir, "..", ".."), "analysis", worldId, "chapter-index.json");
  const catalogDocument = await loadChapterCatalogDocument(worldId, catalogPath);
  const catalog = catalogDocument?.chapters;
  if (!catalog) throw new Error("No chapter catalog. Run the corpus index script or pass --catalog.");
  const prepared = await prepareCanonIndexInputs(worldDir, catalog, rawChunks, catalogDocument.totalLines);
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
    source_hash: prepared.originalText ? createHash("sha256").update(prepared.originalText, "utf8").digest("hex") : "",
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
