import { existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Remove an unsafe copied knowledge database rather than leave unfiltered canon behind. */
function removeUnsafeDatabase(filePath: string): void {
  try { rmSync(filePath, { force: true }); } catch { /* missing or unavailable */ }
}

/**
 * Build a conservative knowledge snapshot for a universe entry point.
 * Full-book aggregates are deliberately discarded: their summaries/profiles may
 * encode events that occur after the selected chapter even when their row has
 * an early first_chapter value.
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
    const chapter = db.prepare("SELECT ordinal FROM novel_chapters WHERE title=? ORDER BY ordinal LIMIT 1").get(entryChapter) as { ordinal: number } | undefined;
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
      const safeTables = new Set(["world_meta","novel_kb_meta","novel_chapters","novel_mentions","novel_beats","novel_relations","novel_character_chapter_states"]);
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

