import type { CatalogChapter } from "./novel-kb.js";

export interface CanonChunk {
  chapter: string;
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
  chapterStart?: number;
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
        throw new Error("原著切片包含重复章节标题「" + chapter.title + "」，但缺少 chapterStart 原文位置，无法安全映射。请重新 ingest 原文后重试。");
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
    if (groupMatches(group)) {
      group.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      groupIndex++;
      return { chapter, catalogIndex, chunks: group.chunks };
    }
    return { chapter, catalogIndex, chunks: [] };
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
