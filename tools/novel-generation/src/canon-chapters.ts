import { createHash } from "node:crypto";
import type { CatalogChapter } from "./novel-kb.js";

export interface CanonChunk {
  chapter: string;
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
  chapterStart?: number;
  source?: string;
  sourceHash?: string;
}

export interface AlignedCanonChapter {
  chapter: CatalogChapter;
  catalogIndex: number;
  chunks: CanonChunk[];
}

/**
 * Align contiguous library groups to the authoritative chapter catalog.
 * Non-chapter groups (front matter and author notes) are skipped. Matching
 * walks forward, so repeated labels such as "第一章" remain volume-specific.
 * Catalog entries without chunks are retained with an empty chunk list.
 */
export function alignCanonChapterGroups(
  catalog: CatalogChapter[],
  chunks: CanonChunk[],
  chapterStartOffsets: Array<number | undefined> = [],
  allowUnpositionedRepeatedTitles = false
): AlignedCanonChapter[] {
  const groups: Array<{ title: string; chapterStart?: number; chunks: CanonChunk[] }> = [];
  for (const chunk of chunks) {
    let group = groups[groups.length - 1];
    // A title is not a chapter identity: the same printed heading can occur
    // more than once in one volume. Preserve separate groups whenever their
    // verified absolute source offsets differ.
    const sameSourceChapter = group &&
      (group.chapterStart === undefined && chunk.chapterStart === undefined
        ? true
        : group.chapterStart === chunk.chapterStart);
    if (!group || group.title !== chunk.chapter || !sameSourceChapter) {
      group = { title: chunk.chapter, chapterStart: chunk.chapterStart, chunks: [] };
      groups.push(group);
    }
    group.chunks.push(chunk);
  }

  let groupIndex = 0;
  return catalog.map((chapter, catalogIndex) => {
    const expectedStart = chapterStartOffsets[catalogIndex];
    const repeatedTitle = catalog.some((item, index) => index !== catalogIndex && item.title === chapter.title);
    const groupMatches = (group: { title: string; chunks: CanonChunk[] } | undefined): boolean => {
      if (!group || group.title !== chapter.title) return false;
      const positions = group.chunks.map(item => item.chapterStart).filter((value): value is number => Number.isSafeInteger(value));
      if (expectedStart !== undefined && positions.length) return positions.every(value => value === expectedStart);
      // A legacy group without source offsets is ambiguous at every occurrence
      // of a repeated title, including the final occurrence in the catalog.
      if (repeatedTitle && !positions.length) {
        if (allowUnpositionedRepeatedTitles) return false;
        throw new Error("原著切片包含重复章节标题「" + chapter.title + "」，但缺少 chapterStart 原文位置，无法安全映射。请先备份 novel.db，再按语料重建流程补齐 chapterStart；ingest 会使派生分析失效，随后必须重跑 index-story 和分析构建。");
      }
      return true;
    };
    // Skip only groups that cannot belong to this or any later catalog entry.
    // A same-title group at another source position belongs to a later repeated
    // chapter and must not be consumed by the current chapter.
    while (groupIndex < groups.length && !groupMatches(groups[groupIndex])) {
      const candidate = groups[groupIndex]!;
      const laterCandidates = catalog.slice(catalogIndex + 1).filter(item => item.title === candidate.title);
      const candidatePosition = candidate.chunks[0]?.chapterStart;
      if (candidate.title === chapter.title && laterCandidates.length && candidatePosition !== undefined) break;
      if (catalog.slice(catalogIndex + 1).some(item => item.title === candidate.title)) break;
      groupIndex++;
    }
    const group = groups[groupIndex];
    if (group && groupMatches(group)) {
      group.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      groupIndex++;
      return { chapter, catalogIndex, chunks: group.chunks };
    }
    return { chapter, catalogIndex, chunks: [] };
  });
}


/** Split offline corpus text consistently for LF, CRLF and legacy CR files. */
export function splitCanonLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

/** Return UTF-16 offsets for each physical line without normalizing source bytes. */
export function canonLineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\r") {
      if (text[index + 1] === "\n") index++;
      starts.push(index + 1);
    } else if (char === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

/** Verify catalog line numbers and completeness against the actual offline corpus. */
export function validateCanonCatalogAgainstText(
  catalog: CatalogChapter[],
  originalText: string,
  expectedTotalLines?: number,
  expectedSourceHash?: string
): void {
  if (expectedSourceHash) {
    const actualHash = createHash("sha256").update(originalText, "utf8").digest("hex");
    if (actualHash !== expectedSourceHash) {
      throw Object.assign(new Error("chapter-index.json 的 sourceHash 与当前 original.txt 不一致。请重新运行 node analysis/build-corpus-index.mjs；不能使用旧目录解释新原文。"), { status: 400 });
    }
  }
  const lines = splitCanonLines(originalText);
  if (expectedTotalLines !== undefined && lines.length !== expectedTotalLines) {
    throw Object.assign(new Error("chapter-index.json 的 totalLines 与 original.txt 不一致（目录 " + expectedTotalLines + " 行，原文 " + lines.length + " 行）。请重新运行 node analysis/build-corpus-index.mjs。"), { status: 400 });
  }
  let previousLine = 0;
  const identities = new Set<string>();
  const catalogLines = new Set<number>();
  for (const chapter of catalog) {
    const line = chapter.line;
    if (!Number.isSafeInteger(line) || (line ?? 0) <= previousLine || (line ?? 0) > lines.length) {
      throw Object.assign(new Error("chapter-index.json 的章节行号缺失、越界或顺序异常：" + chapter.title + "。请重新生成原文目录。"), { status: 400 });
    }
    const actual = (lines[(line as number) - 1] ?? "").replace(/^\uFEFF/, "").trim();
    if (actual !== chapter.title.trim()) {
      throw Object.assign(new Error("chapter-index.json 的章节行号已过期：" + chapter.title + " 应位于 L" + line + "，但原文该行是「" + actual.slice(0, 80) + "」。请重新运行 node analysis/build-corpus-index.mjs。"), { status: 400 });
    }
    const identity = chapter.volume + ":" + chapter.sequenceInVolume;
    if (identities.has(identity)) throw Object.assign(new Error("chapter-index.json 存在重复章节身份：" + identity + "。请重新生成原文目录。"), { status: 400 });
    identities.add(identity);
    catalogLines.add(line as number);
    previousLine = line as number;
  }

  // Keep this expression in sync with analysis/build-corpus-index.mjs. A catalog
  // that silently omits a later chapter cannot define a safe end-of-book boundary.
  const headingPattern = /^[ \t\u3000]*第([〇零一二三四五六七八九十百千万两0-9０-９]+)章[ \t\u3000]*(.*)$/;
  const missingHeadings: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").replace(/^\uFEFF/, "");
    if (headingPattern.test(line) && !catalogLines.has(index + 1)) missingHeadings.push(index + 1);
  }
  if (missingHeadings.length) {
    throw Object.assign(new Error("原文目录不完整：chapter-index.json 在原文第 " + missingHeadings.slice(0, 8).join("、") + " 行存在未登记章节标题。请重新运行 node analysis/build-corpus-index.mjs；在目录完整前拒绝创建时点副本。"), { status: 400 });
  }
}

/** Verify every indexed chunk's payload against its exact location in original.txt. */
export function validateCanonChunksAgainstText(
  aligned: AlignedCanonChapter[],
  originalText: string,
  chapterStartOffsets: Array<number | undefined>
): void {
  for (const item of aligned) {
    if (!item.chunks.length) continue; // Full-text fallback is allowed when a derived index is absent.
    const chapterStart = chapterStartOffsets[item.catalogIndex];
    const nextStart = chapterStartOffsets[item.catalogIndex + 1] ?? originalText.length;
    const chapterText = chapterStart === undefined ? "" : originalText.slice(chapterStart, nextStart).trim();
    const ordered = [...item.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    let previousEnd = 0;
    let previousIndex = -1;
    for (const chunk of ordered) {
      if (chapterStart === undefined || !Number.isSafeInteger(chunk.chunkIndex) ||
          chunk.chunkIndex !== previousIndex + 1 || !Number.isSafeInteger(chunk.start) ||
          !Number.isSafeInteger(chunk.end) || chunk.start < 0 || chunk.end <= chunk.start ||
          chunk.end > chapterText.length || chunk.start > previousEnd) {
        throw new Error("原著切片缺少连续、可验证的正文偏移：" + item.chapter.title + " / chunk " + chunk.chunkIndex + "。请重新从 original.txt 建立索引。");
      }
      if (chunk.chapterStart !== undefined && chunk.chapterStart !== chapterStart) {
        throw new Error("原著切片 chapterStart 与 original.txt 不一致：" + item.chapter.title + "。请重新从 original.txt 建立索引。");
      }
      const expected = chapterText.slice(chunk.start, chunk.end);
      if (expected !== chunk.text) {
        throw new Error("原著切片正文与 original.txt 的声明位置不一致：" + item.chapter.title + " / chunk " + chunk.chunkIndex + "。切片可能已损坏或被修改，请重新 ingest original.txt 后执行 index-story。");
      }
      previousEnd = Math.max(previousEnd, chunk.end);
      previousIndex = chunk.chunkIndex;
    }
    if (ordered[0]?.start !== 0 || previousEnd !== chapterText.length) {
      throw new Error("原著切片在从 original.txt 自动重建后仍未完整覆盖目录章节：" + item.chapter.title + "。请检查该章节目录行号、下一章边界，以及 original.txt 是否与 chapter-index.json 对应同一版本。");
    }
  }
}

/** Keep only chunks from the immutable original.txt source, never auxiliary imports. */
export function selectCanonSourceChunks<T extends CanonChunk>(chunks: T[], originalSourceHash?: string): T[] {
  return chunks.filter(chunk => {
    const source = typeof chunk.source === "string" ? chunk.source.replace(/\\/g, "/") : "";
    const parts = source.split("/").filter(Boolean);
    const isCanonicalPath = parts.at(-1)?.toLowerCase() === "original.txt" && !parts.includes("private");
    if (!isCanonicalPath) return false;
    // When the full source is available, a missing hash is not evidence of
    // freshness. Old unverified chunks must yield to the exact local corpus.
    if (originalSourceHash !== undefined) return chunk.sourceHash === originalSourceHash;
    // If the source file is unavailable, an explicit original.txt path is the
    // only remaining provenance; repeated titles still require chapterStart.
    return true;
  });
}

/** Join overlapping retrieval chunks without duplicating their shared text. */
export function joinCanonChunkText(chunks: CanonChunk[]): string {
  let text = "";
  let previousEnd = -1;
  for (const chunk of [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)) {
    const overlap = previousEnd < 0 ? 0 : Math.max(0, previousEnd - chunk.start);
    text += chunk.text.slice(overlap);
    previousEnd = Math.max(previousEnd, chunk.end);
  }
  return text;
}
