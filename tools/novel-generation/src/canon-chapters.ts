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
  chapterStartOffsets: Array<number | undefined> = []
): AlignedCanonChapter[] {
  const groups: Array<{ title: string; chunks: CanonChunk[] }> = [];
  for (const chunk of chunks) {
    let group = groups[groups.length - 1];
    if (!group || group.title !== chunk.chapter) {
      group = { title: chunk.chapter, chunks: [] };
      groups.push(group);
    }
    group.chunks.push(chunk);
  }

  let groupIndex = 0;
  return catalog.map((chapter, catalogIndex) => {
    const expectedStart = chapterStartOffsets[catalogIndex];
    const remainingSameTitle = catalog.slice(catalogIndex).filter(item => item.title === chapter.title).length;
    const groupMatches = (group: { title: string; chunks: CanonChunk[] } | undefined): boolean => {
      if (!group || group.title !== chapter.title) return false;
      const positions = group.chunks.map(item => item.chapterStart).filter((value): value is number => Number.isSafeInteger(value));
      if (expectedStart !== undefined && positions.length) return positions.every(value => value === expectedStart);
      // Repeated titles without positional evidence cannot be safely aligned.
      if (remainingSameTitle > 1) {
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


/** Verify that chapter line numbers still point at the exact headings in the offline corpus. */
export function validateCanonCatalogAgainstText(
  catalog: CatalogChapter[],
  originalText: string,
  expectedTotalLines?: number
): void {
  const normalized = originalText.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (expectedTotalLines !== undefined && lines.length !== expectedTotalLines) {
    throw new Error("chapter-index.json 的 totalLines 与 original.txt 不一致（目录 " + expectedTotalLines + " 行，原文 " + lines.length + " 行）。请重新运行 node analysis/build-corpus-index.mjs。");
  }
  let previousLine = 0;
  const identities = new Set<string>();
  for (const chapter of catalog) {
    const line = chapter.line;
    if (!Number.isSafeInteger(line) || (line ?? 0) <= previousLine || (line ?? 0) > lines.length) {
      throw new Error("chapter-index.json 的章节行号缺失、越界或顺序异常：" + chapter.title + "。请重新生成原文目录。");
    }
    const actual = (lines[(line as number) - 1] ?? "").trim();
    if (actual !== chapter.title.trim()) {
      throw new Error("chapter-index.json 的章节行号已过期：" + chapter.title + " 应位于 L" + line + "，但原文该行是「" + actual.slice(0, 80) + "」。请重新运行 node analysis/build-corpus-index.mjs。");
    }
    const identity = chapter.volume + ":" + chapter.sequenceInVolume;
    if (identities.has(identity)) throw new Error("chapter-index.json 存在重复章节身份：" + identity + "。请重新生成原文目录。");
    identities.add(identity);
    previousLine = line as number;
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
