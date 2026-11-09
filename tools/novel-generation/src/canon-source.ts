import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { alignCanonChapterGroups, selectCanonSourceChunks, validateCanonCatalogAgainstText, type CanonChunk } from "./canon-chapters.js";
import { chunkText } from "./library.js";
import path from "node:path";

export interface CanonSourcePaths {
  projectRoot?: string;
  worldDir?: string;
}

/**
 * Resolve the canonical full text for a source world or historical universe.
 * Source projects use <projectRoot>/original.txt, with a world-local legacy
 * fallback. Historical universes must use their own bounded local copy only.
 */
export async function resolveOriginalCanonPath(
  worldId: string,
  options: CanonSourcePaths = {}
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(worldId)) throw new Error("Invalid world id.");
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const worldDir = path.resolve(options.worldDir ?? path.join(projectRoot, "worlds", worldId));

  let isUniverse = false;
  for (const marker of ["universe.json", "source-canon.json"]) {
    try {
      if ((await stat(path.join(worldDir, marker))).isFile()) { isUniverse = true; break; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const localPath = path.join(worldDir, "original.txt");
  const projectPath = path.join(projectRoot, "original.txt");
  const candidates = isUniverse ? [localPath] : [projectPath, localPath];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const message = isUniverse
    ? "故事宇宙缺少自己的时点原文副本：" + localPath + "。为避免读取完整原著并泄漏起点之后的剧情，拒绝回退到项目根目录 original.txt。请从有效父宇宙重新创建或修复该副本。"
    : "找不到原著全文。已检查 " + projectPath + " 和 " + localPath + "；请确认 original.txt 位于 novel-generation 项目根目录。";
  throw Object.assign(new Error(message), { code: "ENOENT" });
}

/** Return the original prefix ending immediately before a chapter heading line. */
export function truncateCanonAtLine(text: string, endBeforeLine?: number, allowAlreadyBounded = false): string {
  if (endBeforeLine === undefined) return text;
  if (!Number.isSafeInteger(endBeforeLine) || endBeforeLine < 2) {
    throw new Error("原文时点边界行号无效，拒绝生成未截断的故事宇宙原文副本。");
  }
  const lineCount = text.split(/\r?\n/).length;
  if (endBeforeLine > lineCount) {
    if (allowAlreadyBounded) return text;
    throw new Error("原文时点边界超出全文范围，无法安全截断。");
  }
  let offset = 0;
  for (let line = 1; line < endBeforeLine; line++) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) throw new Error("原文时点边界超出全文范围，无法安全截断。");
    offset = newline + 1;
  }
  // Remove the line break immediately before the excluded chapter heading.
  let end = offset;
  if (end > 0 && text[end - 1] === "\n") end--;
  if (end > 0 && text[end - 1] === "\r") end--;
  return text.slice(0, end);
}

/**
 * Create an independent, as-of copy for a universe. The source project may
 * store original.txt outside worlds/<id>; never assume cp(worldDir) included it.
 */
export async function copyOriginalCanonToUniverse(
  sourceWorldId: string,
  targetDir: string,
  projectRoot = process.cwd(),
  endBeforeLine?: number,
  allowAlreadyBounded = false
): Promise<boolean> {
  let source: string;
  try {
    source = await resolveOriginalCanonPath(sourceWorldId, { projectRoot });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const text = await readFile(source, "utf8");
  const boundedText = truncateCanonAtLine(text, endBeforeLine, allowAlreadyBounded);
  await writeFile(path.join(targetDir, "original.txt"), boundedText, "utf8");
  return true;
}

interface CanonCatalogEntry {
  volume: number;
  sequenceInVolume: number;
  printedNumber: number | null;
  title: string;
  label: string;
  line: number | null;
}

/**
 * One-time, idempotent repair for universes created before original.txt itself
 * was bounded. It also rebinds old full-book chunk provenance to the bounded
 * local file, so existing universes remain usable without re-creating them.
 */
export async function ensureBoundedUniverseCanonAssets(
  worldId: string,
  options: { projectRoot?: string; worldDir?: string } = {}
): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(worldId)) throw new Error("Invalid world id.");
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const worldDir = path.resolve(options.worldDir ?? path.join(projectRoot, "worlds", worldId));
  const universePath = path.join(worldDir, "universe.json");
  let universe: { sourceWorldId?: string; entryChapter?: string; entryChapterIndex?: number; entryChapterId?: string } | undefined;
  try { universe = JSON.parse(await readFile(universePath, "utf8")) as typeof universe; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await stat(path.join(worldDir, "source-canon.json"));
      throw new Error("检测到 source-canon.json，但缺少 universe.json。该目录是损坏的故事宇宙，不能按原文项目回退读取完整原著。");
    } catch (markerError) {
      if (markerError instanceof Error && markerError.message.includes("损坏的故事宇宙")) throw markerError;
      if ((markerError as NodeJS.ErrnoException).code !== "ENOENT") throw markerError;
    }
    return false;
  }
  if (!universe?.sourceWorldId || !/^[a-z0-9][a-z0-9-]*$/i.test(universe.sourceWorldId)) {
    throw new Error("故事宇宙缺少有效的原文来源身份，无法验证本地原文边界。");
  }
  let sourcePointer: { sourceWorldId?: string; readOnly?: boolean };
  try { sourcePointer = JSON.parse(await readFile(path.join(worldDir, "source-canon.json"), "utf8")) as typeof sourcePointer; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("故事宇宙缺少 source-canon.json，拒绝把它当作普通原文项目处理。");
    throw error;
  }
  if (sourcePointer.readOnly !== true || sourcePointer.sourceWorldId !== universe.sourceWorldId) {
    throw new Error("universe.json 与 source-canon.json 的原文来源身份不一致，拒绝读取或重建时点语料。");
  }

  const sourceCatalogPath = path.join(projectRoot, "analysis", universe.sourceWorldId, "chapter-index.json");
  const sourceCatalog = JSON.parse(await readFile(sourceCatalogPath, "utf8")) as {
    volumes?: Array<{ volume: number; startLine?: number; endLine?: number; chapters?: Array<Record<string, unknown>> }>;
    chapters?: Array<Record<string, unknown>>;
  };
  const catalog: CanonCatalogEntry[] = [];
  for (const volume of sourceCatalog.volumes ?? []) {
    for (const chapter of volume.chapters ?? []) {
      const title = String(chapter.title ?? "").trim();
      if (!title) continue;
      catalog.push({
        volume: Number(volume.volume),
        sequenceInVolume: Number(chapter.sequenceInVolume ?? catalog.length + 1),
        printedNumber: chapter.printedNumber === null || chapter.printedNumber === undefined ? null : Number(chapter.printedNumber),
        title, label: String(chapter.label ?? title),
        line: typeof chapter.line === "number" ? chapter.line : null
      });
    }
  }
  if (!catalog.length) {
    for (const chapter of sourceCatalog.chapters ?? []) {
      const title = String(chapter.title ?? "").trim();
      if (!title) continue;
      catalog.push({
        volume: Number(chapter.volume ?? 1),
        sequenceInVolume: Number(chapter.sequenceInVolume ?? catalog.length + 1),
        printedNumber: chapter.printedNumber === null || chapter.printedNumber === undefined ? null : Number(chapter.printedNumber),
        title, label: String(chapter.label ?? title),
        line: typeof chapter.line === "number" ? chapter.line : null
      });
    }
  }
  if (!catalog.length) throw new Error("原文项目章节目录为空，无法修复故事宇宙的原文时点边界。");

  let entryIndex: number;
  if (Number.isSafeInteger(universe.entryChapterIndex) && Number(universe.entryChapterIndex) >= 0 && Number(universe.entryChapterIndex) < catalog.length) {
    entryIndex = Number(universe.entryChapterIndex);
  } else {
    const matches = catalog.flatMap((chapter, index) => chapter.title === universe?.entryChapter ? [index] : []);
    if (matches.length !== 1) throw new Error("旧故事宇宙缺少可唯一验证的原文起点索引，拒绝猜测并读取完整原著。");
    entryIndex = matches[0]!;
  }
  if (catalog[entryIndex]?.title !== universe.entryChapter) {
    throw new Error("故事宇宙记录的起点章节与原文目录索引不一致，拒绝猜测时点边界。");
  }
  const entry = catalog[entryIndex]!;
  const expectedEntryId = "V" + String(entry.volume).padStart(2, "0") + "-C" + String(entry.sequenceInVolume).padStart(3, "0");
  if (universe.entryChapterId && universe.entryChapterId !== expectedEntryId) {
    throw new Error("故事宇宙 entryChapterId 与原文目录中的稳定章节身份不一致，拒绝猜测起点。");
  }
  for (let index = 0; index <= entryIndex; index++) {
    const line = catalog[index]?.line;
    if (!Number.isSafeInteger(line) || Number(line) < 1 || (index > 0 && Number(line) <= Number(catalog[index - 1]?.line))) {
      throw new Error("故事宇宙起点之前的原文目录行号缺失或顺序异常，无法验证本地原文边界。");
    }
  }
  const nextChapter = catalog[entryIndex + 1];
  const endBeforeLine = nextChapter?.line ?? undefined;
  if (nextChapter && (!Number.isSafeInteger(endBeforeLine) || Number(endBeforeLine) <= Number(catalog[entryIndex]?.line))) {
    throw new Error("故事宇宙起点之后的原文章节缺少有效行号，无法验证未来剧情边界。");
  }

  const localOriginalPath = path.join(worldDir, "original.txt");
  let localOriginalText: string | undefined;
  try { localOriginalText = await readFile(localOriginalPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Repair older universes whose reflink/copy step failed: read the source
  // corpus only inside this migration, then materialize a bounded local copy.
  const originalText = localOriginalText ?? await readFile(
    await resolveOriginalCanonPath(universe.sourceWorldId, { projectRoot }), "utf8"
  );
  const originalHash = createHash("sha256").update(originalText, "utf8").digest("hex");
  const boundedText = truncateCanonAtLine(originalText, endBeforeLine, true);
  const boundedLines = boundedText.split(/\r?\n/);
  if (endBeforeLine !== undefined && boundedLines.length < endBeforeLine - 1) {
    throw new Error("故事宇宙本地原文副本在起点之前就已截断，不能安全恢复；请从原文项目重新创建该宇宙。");
  }
  const boundedHash = createHash("sha256").update(boundedText, "utf8").digest("hex");
  const sourceKey = path.relative(projectRoot, localOriginalPath).split(path.sep).join("/");

  const libraryIndexPath = path.join(worldDir, "library", "index.json");
  let library: { schemaVersion: number; worldId: string; createdAt: string; updatedAt: string; chunks: Array<CanonChunk & { id: string; sourceHash?: string }> } | undefined;
  try {
    library = JSON.parse(await readFile(libraryIndexPath, "utf8")) as typeof library;
    if (!library || library.worldId !== worldId || !Array.isArray(library.chunks)) {
      throw new Error("故事宇宙 library/index.json 身份或结构不匹配。");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const existingChunks = library?.chunks ?? [];
  // Hashless legacy chunks cannot be proven to match the local snapshot.
  // Rebuild them from the bounded text instead of blessing unknown content.
  const canonical = selectCanonSourceChunks(existingChunks).filter(chunk =>
    chunk.sourceHash === originalHash || chunk.sourceHash === boundedHash
  );
  const starts: Array<number | undefined> = [];
  let offset = 0;
  for (const line of boundedLines) {
    starts.push(offset + line.length - line.trimStart().length);
    offset += line.length;
    if (boundedText[offset] === "\r") offset++;
    if (boundedText[offset] === "\n") offset++;
  }
  const prefixCatalog = catalog.slice(0, entryIndex + 1);
  validateCanonCatalogAgainstText(prefixCatalog, boundedText);
  const offsets = prefixCatalog.map(chapter => chapter.line == null ? undefined : starts[chapter.line - 1]);
  const aligned = alignCanonChapterGroups(prefixCatalog, canonical, offsets);
  const boundedChunks = aligned.flatMap((item, index) => {
    if (item.chunks.length) return item.chunks.map(chunk => ({
      ...chunk, source: sourceKey, sourceHash: boundedHash
    }));
    const startLine = item.chapter.line;
    const nextLine = prefixCatalog[index + 1]?.line;
    if (!Number.isSafeInteger(startLine) || Number(startLine) < 1) {
      throw new Error("故事宇宙章节「" + item.chapter.title + "」缺少原文行号，无法重建时点切片。");
    }
    const chapterText = boundedLines.slice(Number(startLine) - 1, nextLine === undefined ? boundedLines.length : Number(nextLine) - 1).join("\n").trim();
    if (!chapterText) throw new Error("故事宇宙章节「" + item.chapter.title + "」在 bounded original.txt 中没有正文。");
    const volume = String(item.chapter.volume).padStart(2, "0");
    const sequence = String(item.chapter.sequenceInVolume).padStart(3, "0");
    return chunkText(chapterText).map((part, chunkIndex) => ({
      id: sourceKey + ":rebuild:V" + volume + "-C" + sequence + ":" + chunkIndex,
      source: sourceKey,
      sourceHash: boundedHash,
      chapter: item.chapter.title,
      chunkIndex,
      start: part.start,
      end: part.end,
      text: part.text,
      ...(offsets[index] !== undefined ? { chapterStart: offsets[index] } : {})
    }));
  });
  if (!boundedChunks.length) throw new Error("故事宇宙原文切片无法映射或重建，拒绝发布空检索索引。");
  const now = new Date().toISOString();
  const sameChunks = JSON.stringify(library?.chunks ?? []) === JSON.stringify(boundedChunks);
  const nextLibrary = {
    schemaVersion: library?.schemaVersion ?? 1,
    worldId,
    createdAt: library?.createdAt ?? now,
    updatedAt: sameChunks && library ? library.updatedAt : now,
    chunks: boundedChunks
  };
  if (!sameChunks || !library) {
    await mkdir(path.dirname(libraryIndexPath), { recursive: true });
    const temporary = libraryIndexPath + ".bounded.tmp";
    await writeFile(temporary, JSON.stringify(nextLibrary, null, 2) + "\n", "utf8");
    await rename(temporary, libraryIndexPath);
  }

  // Rebuild only the bounded catalog metadata; do not copy full-book totals.
  let remaining = entryIndex + 1;
  const safeVolumes = (sourceCatalog.volumes ?? []).map(volume => {
    const chapters = (volume.chapters ?? []).slice(0, remaining).map(chapter => ({
      ...(typeof chapter.sequenceInVolume === "number" ? { sequenceInVolume: chapter.sequenceInVolume } : {}),
      ...(typeof chapter.printedNumber === "number" || chapter.printedNumber === null ? { printedNumber: chapter.printedNumber } : {}),
      title: String(chapter.title ?? ""),
      label: String(chapter.label ?? chapter.title ?? ""),
      ...(typeof chapter.line === "number" ? { line: chapter.line } : {})
    }));
    remaining -= chapters.length;
    if (!chapters.length) return null;
    return {
      volume: volume.volume,
      ...(typeof volume.startLine === "number" ? { startLine: volume.startLine } : {}),
      endLine: Math.min(typeof volume.endLine === "number" ? volume.endLine : boundedLines.length, boundedLines.length),
      chapterCount: chapters.length,
      openingChapter: chapters[0]!.title,
      closingChapter: chapters[chapters.length - 1]!.title,
      chapters
    };
  }).filter((volume): volume is NonNullable<typeof volume> => volume !== null);
  const childCatalogPath = path.join(projectRoot, "analysis", worldId, "chapter-index.json");
  await mkdir(path.dirname(childCatalogPath), { recursive: true });
  const catalogSnapshot = {
    schemaVersion: 2,
    totalLines: boundedLines.length,
    ...(safeVolumes.length ? { volumes: safeVolumes } : {
      chapters: (sourceCatalog.chapters ?? []).slice(0, entryIndex + 1).map(chapter => ({
        ...(typeof chapter.sequenceInVolume === "number" ? { sequenceInVolume: chapter.sequenceInVolume } : {}),
        ...(typeof chapter.printedNumber === "number" || chapter.printedNumber === null ? { printedNumber: chapter.printedNumber } : {}),
        title: String(chapter.title ?? ""),
        label: String(chapter.label ?? chapter.title ?? ""),
        ...(typeof chapter.line === "number" ? { line: chapter.line } : {})
      }))
    })
  };
  let existingCatalog: unknown;
  try { existingCatalog = JSON.parse(await readFile(childCatalogPath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (JSON.stringify(existingCatalog) !== JSON.stringify(catalogSnapshot)) {
    const catalogTemporary = childCatalogPath + ".bounded.tmp";
    await writeFile(catalogTemporary, JSON.stringify(catalogSnapshot, null, 2) + "\n", "utf8");
    await rename(catalogTemporary, childCatalogPath);
  }

  if (localOriginalText !== boundedText) {
    const temporary = localOriginalPath + ".bounded.tmp";
    await writeFile(temporary, boundedText, "utf8");
    await rename(temporary, localOriginalPath);
  }
  return true;
}

