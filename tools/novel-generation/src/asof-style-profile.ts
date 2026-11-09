import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadLibraryChunks, type LibraryChunk } from "./library.js";
import { buildStyleDistillationPrompt } from "./style-distillation.js";
import { runAgentText } from "./generate.js";
import { ensureSourceCanonLibraryIndex } from "./novel-kb.js";
import { ensureBoundedUniverseCanonAssets } from "./canon-source.js";

export interface AsOfStyleSample { label: string; text: string; }

export function selectAsOfStyleSamples(chunks: LibraryChunk[], maxSamples = 4, maxCharsPerSample = 9000): AsOfStyleSample[] {
  const byChapter = new Map<string, LibraryChunk[]>();
  for (const chunk of chunks) {
    const list = byChapter.get(chunk.chapter) ?? [];
    list.push(chunk);
    byChapter.set(chunk.chapter, list);
  }
  const chapters = [...byChapter.entries()].map(([title, rows]) => ({
    title,
    text: rows.sort((a, b) => a.start - b.start).map(row => row.text).join("\n")
  })).filter(item => item.text.trim());
  if (!chapters.length) return [];
  const count = Math.min(maxSamples, chapters.length);
  const selected = Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? chapters.length - 1 : Math.round(index * (chapters.length - 1) / (count - 1));
    return chapters[position]!;
  });
  return selected.map(item => ({ label: item.title, text: item.text.slice(0, maxCharsPerSample) }));
}

/**
 * Build a style profile from this world's own bounded corpus. Never overwrite
 * an existing curated profile; historical branches have no inherited profile
 * and therefore receive an as-of reconstruction automatically.
 */
export async function ensureAsOfStyleProfile(
  worldId: string,
  worldDir: string,
  model?: string
): Promise<{ created: boolean; samples: number }> {
  await ensureBoundedUniverseCanonAssets(worldId, { projectRoot: resolve(worldDir, "..", ".."), worldDir });
  await ensureSourceCanonLibraryIndex(worldId, worldDir);
  const target = join(worldDir, "style-profile.md");
  try {
    const existing = (await readFile(target, "utf8")).trim();
    if (existing) return { created: false, samples: 0 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const chunks = await loadLibraryChunks(join(worldDir, "library"), worldId);
  const samples = selectAsOfStyleSamples(chunks);
  if (!samples.length) throw new Error("No bounded chapter samples available for style profile reconstruction.");
  const profile = await runAgentText(buildStyleDistillationPrompt(samples), model);
  if (!profile.trim() || profile.trim().length < 300) throw new Error("Style profile reconstruction returned an empty or incomplete profile.");
  const temporary = target + "." + process.pid + ".tmp";
  await writeFile(temporary, profile.trim() + "\n", "utf8");
  await rename(temporary, target);
  return { created: true, samples: samples.length };
}
