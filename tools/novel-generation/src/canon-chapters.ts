import type { CatalogChapter } from "./novel-kb.js";

export interface CanonChunk {
  chapter: string;
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
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
  chunks: CanonChunk[]
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
    // Skip only labels that are not present later in the formal catalog. If a
    // later formal title appears before this chapter's label, this chapter is
    // genuinely missing from the chunk index; do not steal the later chapter's
    // text just because its title happens to be the next available group.
    const laterTitles = new Set(catalog.slice(catalogIndex + 1).map(item => item.title));
    while (groupIndex < groups.length && groups[groupIndex]!.title !== chapter.title &&
      !laterTitles.has(groups[groupIndex]!.title)) {
      groupIndex++;
    }
    const group = groups[groupIndex];
    if (group?.title === chapter.title) {
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
