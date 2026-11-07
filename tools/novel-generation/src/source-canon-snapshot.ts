import { existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/** Remove an unsafe copied knowledge database rather than leave unfiltered canon behind. */
function removeUnsafeDatabase(filePath: string): void {
  try { rmSync(filePath, { force: true }); } catch { /* missing or unavailable */ }
}

/**
 * Build a conservative knowledge snapshot for a universe entry point.
 * Only records with complete chapter provenance inside the boundary are reused;
 * aggregates with missing or future provenance are discarded.
 */
export function restrictKnowledgeDatabaseToEntry(databasePath: string, worldId: string, entryChapter: string): number {
  if (!existsSync(databasePath)) return 0;
  const db = new DatabaseSync(databasePath);
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>).map(row=>row.name));
    const has = (name:string) => tables.has(name);
    if (!has("novel_chapters")) {
      removeUnsafeDatabase(databasePath);
      return 0;
    }
    const chapterColumns = new Set((db.prepare("PRAGMA table_info(novel_chapters)").all() as Array<{name:string}>).map(column=>column.name));
    if (!chapterColumns.has("title") || !chapterColumns.has("ordinal")) {
      removeUnsafeDatabase(databasePath);
      return 0;
    }
    const chapter = db.prepare("SELECT ordinal,volume FROM novel_chapters WHERE title=? ORDER BY ordinal LIMIT 1").get(entryChapter) as { ordinal: number; volume?: number } | undefined;
    if (!chapter || !Number.isSafeInteger(Number(chapter.ordinal))) {
      // Fail closed. A database without a resolvable chapter ordinal cannot be
      // proven safe for a historical branch.
      removeUnsafeDatabase(databasePath);
      return 0;
    }
    const cutoff = Number(chapter.ordinal);
    const columns = (name:string) => new Set((db.prepare("PRAGMA table_info(\"" + name.replace(/"/g, "\"\"") + "\")").all() as Array<{name:string}>).map(column=>column.name));
    db.exec("BEGIN IMMEDIATE");
    try {
      // Explicit allow-list: an unfamiliar table may contain a new whole-book
      // aggregate. Preserve only metadata and chapter-addressable evidence.
      const safeTables = new Set(["world_meta","novel_kb_meta","novel_chapters","novel_mentions","novel_beats","novel_relations","novel_character_chapter_states","novel_characters","novel_plot_threads","novel_arcs","story_analysis"]);
      for (const table of tables) {
        if (!safeTables.has(table)) db.exec("DELETE FROM \"" + table.replace(/"/g, "\"\"") + "\"");
      }
      // A chapter table without a trustworthy ordinal cannot be filtered safely;
      // discard that table rather than retaining unbounded evidence.
      for (const [table, required] of [
        ["novel_beats", ["chapter_ordinal"]],
        ["novel_relations", ["chapter_ordinal"]],
        ["novel_character_chapter_states", ["chapter_ordinal"]],
        ["novel_mentions", ["chapter_id"]]
      ] as Array<[string,string[]]>) {
        if (has(table) && required.some(column=>!columns(table).has(column))) {
          db.exec("DELETE FROM \"" + table.replace(/"/g, "\"\"") + "\"");
        }
      }
      if (has("novel_beats") && columns("novel_beats").has("chapter_ordinal")) {
        db.prepare("DELETE FROM novel_beats WHERE chapter_ordinal IS NULL OR chapter_ordinal>?").run(cutoff);
      }
      if (has("novel_relations") && columns("novel_relations").has("chapter_ordinal")) {
        db.prepare("DELETE FROM novel_relations WHERE chapter_ordinal IS NULL OR chapter_ordinal>?").run(cutoff);
      }
      if (has("novel_character_chapter_states") && columns("novel_character_chapter_states").has("chapter_ordinal")) {
        db.prepare("DELETE FROM novel_character_chapter_states WHERE chapter_ordinal IS NULL OR chapter_ordinal>?").run(cutoff);
      }
      if (has("novel_mentions") && columns("novel_mentions").has("chapter_id")) {
        db.prepare("DELETE FROM novel_mentions WHERE chapter_id NOT IN (SELECT chapter_id FROM novel_chapters WHERE ordinal<=?)").run(cutoff);
      }
      // These aggregate rows carry explicit last-chapter provenance. Keep only
      // records wholly observed by the cutoff; missing provenance fails closed.
      for (const table of ["novel_characters", "novel_plot_threads"]) {
        if (!has(table)) continue;
        if (columns(table).has("last_chapter")) {
          db.prepare("DELETE FROM \"" + table + "\" WHERE last_chapter IS NULL OR last_chapter>?").run(cutoff);
        } else {
          db.exec("DELETE FROM \"" + table + "\"");
        }
      }
      // A completed prior-volume arc is safe; the selected volume is not, since
      // its aggregate may summarize chapters after the chosen entry point.
      if (has("novel_arcs")) {
        if (typeof chapter.volume === "number" && columns("novel_arcs").has("volume")) {
          db.prepare("DELETE FROM novel_arcs WHERE volume>=?").run(chapter.volume);
        } else {
          db.exec("DELETE FROM novel_arcs");
        }
      }

      // Reuse completed offline analysis only when every cited chapter is within
      // this branch's boundary. Future-touching aggregates are dropped whole.
      const chapterRows = db.prepare("SELECT chapter_id,title FROM novel_chapters WHERE ordinal<=?").all(cutoff) as Array<{chapter_id:string;title:string}>;
      const allowedKeys = new Set(chapterRows.flatMap(row => [row.chapter_id, row.title]));
      if (has("story_analysis") && columns("story_analysis").has("payload_json")) {
        const row = db.prepare("SELECT singleton,payload_json FROM story_analysis WHERE singleton=1").get() as {singleton:number;payload_json:string} | undefined;
        if (row) {
          try {
            const source = JSON.parse(row.payload_json) as Record<string, unknown>;
            const boundedItems = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
              ? value.filter((item): item is Record<string, unknown> => {
                  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
                  const keys = Array.isArray(item.chapterKeys) ? item.chapterKeys.filter((key): key is string => typeof key === "string") : [];
                  return keys.length > 0 && keys.every(key => allowedKeys.has(key));
                })
              : [];
            const boundedRefs = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(ref => {
              if (!ref || typeof ref !== "object" || Array.isArray(ref)) return false;
              const item = ref as Record<string, unknown>;
              const key = String(item.chapterId ?? item.chunkId ?? item.chapter ?? "");
              return Boolean(key && allowedKeys.has(key));
            });
            const graph = source.storyGraph && typeof source.storyGraph === "object"
              ? source.storyGraph as {nodes?:unknown;edges?:unknown}
              : undefined;
            const bounded: Record<string, unknown> = {
              ...source,
              worldId,
              sourceHash: createHash("sha256").update(JSON.stringify({ sourceHash: source.sourceHash, entryChapter, cutoff })).digest("hex"),
              asOfEntryChapter: entryChapter,
              chapters: chapterRows.length,
              characters: boundedItems(source.characters),
              plotThreads: boundedItems(source.plotThreads),
              foreshadowings: boundedItems(source.foreshadowings),
              developmentPossibilities: boundedItems(source.developmentPossibilities),
              relations: boundedItems(source.relations),
              storyCoreObservations: boundedItems(source.storyCoreObservations),
              macguffins: boundedItems(source.macguffins),
              beats: Array.isArray(source.beats) ? source.beats.filter(item => {
                if (!item || typeof item !== "object" || Array.isArray(item)) return false;
                const key = String((item as Record<string, unknown>).chapterKey ?? "");
                return Boolean(key && allowedKeys.has(key));
              }) : [],
              storyGraph: graph ? {
                nodes: Array.isArray(graph.nodes) ? graph.nodes.filter(node =>
                  Boolean(node && typeof node === "object" && boundedRefs((node as Record<string, unknown>).sourceRefs))
                ) : [],
                edges: Array.isArray(graph.edges) ? graph.edges.filter(edge =>
                  Boolean(edge && typeof edge === "object" && boundedRefs((edge as Record<string, unknown>).sourceRefs))
                ) : []
              } : undefined
            };
            // Whole-book storyCore has no chapter provenance and is unsafe to reuse.
            delete bounded.storyCore;
            db.prepare("UPDATE story_analysis SET payload_json=? WHERE singleton=1").run(JSON.stringify(bounded));
          } catch {
            db.prepare("DELETE FROM story_analysis").run();
          }
        }
      }
      db.prepare("DELETE FROM novel_chapters WHERE ordinal>?").run(cutoff);
      if (has("world_meta") && columns("world_meta").has("key") && columns("world_meta").has("value")) {
        db.prepare("UPDATE world_meta SET value=? WHERE key='world_id'").run(worldId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return cutoff;
  } catch (error) {
    // Never leave an unfiltered full-canon database in a staging universe.
    removeUnsafeDatabase(databasePath);
    throw error;
  } finally { db.close(); }
}

