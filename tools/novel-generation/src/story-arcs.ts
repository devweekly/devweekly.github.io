import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { runAgentText } from "./generate.js";
import { resolveAgentModel } from "./agent-runtime.js";
import { readTaskProfiles } from "./task-profiles.js";
import { openWorldDatabase } from "./database.js";
import { parseJsonObject } from "./model-json.js";

const ArcSchema = z.object({
  title: z.string().default(""),
  summary: z.string().default(""),
  keyTurns: z.preprocess(value => Array.isArray(value) ? value.map(String) : typeof value === "string" && value.trim() ? [value] : [], z.array(z.string())).default([]),
  characters: z.preprocess(value => Array.isArray(value) ? value.map(String) : typeof value === "string" && value.trim() ? [value] : [], z.array(z.string())).default([])
}).passthrough();

export interface VolumeDigest {
  volume: number;
  chapters: number;
  beats: string[];
}

/** Reads the chapter-level beats that the corpus analysis already stored. */
export function loadVolumeDigests(worldDir: string, worldId: string): VolumeDigest[] {
  const db = openWorldDatabase(worldDir, worldId);
  try {
    const rows = db.prepare(
      "SELECT c.volume AS volume, c.ordinal AS ordinal, c.title AS title, b.summary AS summary " +
      "FROM novel_chapters c LEFT JOIN novel_beats b ON b.chapter_ordinal=c.ordinal " +
      "WHERE c.ordinal>0 ORDER BY c.volume, c.ordinal"
    ).all() as Array<{ volume: number; ordinal: number; title: string; summary: string | null }>;
    const byVolume = new Map<number, VolumeDigest>();
    const counted = new Map<number, Set<number>>();
    for (const row of rows) {
      const digest = byVolume.get(row.volume) ?? { volume: row.volume, chapters: 0, beats: [] };
      const ordinals = counted.get(row.volume) ?? new Set<number>();
      if (!ordinals.has(row.ordinal)) { ordinals.add(row.ordinal); digest.chapters += 1; }
      counted.set(row.volume, ordinals);
      if (row.summary) digest.beats.push(`第${row.ordinal}章《${row.title}》：${row.summary}`);
      byVolume.set(row.volume, digest);
    }
    return [...byVolume.values()].sort((a, b) => a.volume - b.volume);
  } finally {
    db.close();
  }
}

function buildPrompt(digest: VolumeDigest): string {
  return [
    "你是一位小说编辑。下面是一卷书的章级事件记录，请写一段本卷主线梗概，供作者和读者检索。",
    "要求：",
    "- 300 到 500 字，连续叙述，不分点，不逐章复述。",
    "- 只写这一卷实际发生的事：谁想做什么、遇到什么阻碍、结果如何、留下了什么未解之处。",
    "- 抓住因果和转折，不要罗列设定，不要评价文笔。",
    "- title 用一句话概括本卷（可含主要地点或事件）。",
    "- keyTurns 列 3 到 6 个真正的转折，每条一句话。",
    "- characters 列出本卷戏份最重的人物，最多 10 个，用他们在正文里的名字。",
    "- 只返回 JSON：{title, summary, keyTurns, characters}。",
    "第 " + digest.volume + " 卷，共 " + digest.chapters + " 章。章级事件：",
    digest.beats.join("\n")
  ].join("\n\n");
}

export interface VolumeArc { volume: number; title: string; summary: string; keyTurns: string[]; characters: string[] }

export function syncVolumeArcs(worldDir: string, worldId: string, arcs: VolumeArc[]): void {
  const db = openWorldDatabase(worldDir, worldId);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS novel_arcs(volume INTEGER PRIMARY KEY,title TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',key_turns_json TEXT NOT NULL DEFAULT '[]',characters_json TEXT NOT NULL DEFAULT '[]',generated_at TEXT NOT NULL);");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM novel_arcs");
      const insert = db.prepare("INSERT INTO novel_arcs(volume,title,summary,key_turns_json,characters_json,generated_at) VALUES(?,?,?,?,?,?)");
      const now = new Date().toISOString();
      for (const arc of arcs) insert.run(arc.volume, arc.title, arc.summary, JSON.stringify(arc.keyTurns), JSON.stringify(arc.characters), now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export function listVolumeArcs(worldDir: string, worldId: string): VolumeArc[] {
  const db = openWorldDatabase(worldDir, worldId);
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='novel_arcs'").get();
    if (!exists) return [];
    const rows = db.prepare("SELECT volume,title,summary,key_turns_json,characters_json FROM novel_arcs ORDER BY volume").all() as Array<Record<string, string | number>>;
    return rows.map(row => ({
      volume: Number(row.volume), title: String(row.title), summary: String(row.summary),
      keyTurns: JSON.parse(String(row.key_turns_json)) as string[],
      characters: JSON.parse(String(row.characters_json)) as string[]
    }));
  } finally {
    db.close();
  }
}

export async function buildVolumeArcs(
  worldId: string,
  options: { worldDir?: string; model?: string; timeoutMs?: number; force?: boolean } = {}
): Promise<{ arcs: VolumeArc[]; generated: number; cached: number }> {
  const worldDir = options.worldDir ?? resolve("worlds", worldId);
  const digests = loadVolumeDigests(worldDir, worldId);
  if (!digests.length) throw new Error("No chapters found. Run index-story before analyze-arcs.");
  const withBeats = digests.filter(digest => digest.beats.length);
  if (!withBeats.length) throw new Error("No chapter beats found. Run analyze-story before analyze-arcs.");
  const model = resolveAgentModel(options.model).model;
  const sourceHash = createHash("sha256").update(digests.map(digest => digest.volume + ":" + digest.beats.join("|")).join("\n")).digest("hex");
  const cacheDir = resolve(".output", worldId, "story-arcs", createHash("sha256").update("arcs-v1\nmodel=" + model + "\nsource=" + sourceHash).digest("hex"));
  await mkdir(cacheDir, { recursive: true });
  const arcs: VolumeArc[] = [];
  let generated = 0; let cached = 0;
  for (const digest of digests) {
    const path = join(cacheDir, "volume-" + String(digest.volume).padStart(2, "0") + ".json");
    let arc: VolumeArc | undefined;
    if (!options.force) {
      try {
        const parsed = ArcSchema.parse(parseJsonObject(await readFile(path, "utf8")));
        arc = { volume: digest.volume, title: parsed.title, summary: parsed.summary, keyTurns: parsed.keyTurns, characters: parsed.characters };
        cached++;
      } catch { /* not cached or invalid: regenerate */ }
    }
    if (!arc) {
      if (!digest.beats.length) continue;
      console.log(`[story-arcs] volume ${digest.volume} · ${digest.chapters} chapters · ${digest.beats.length} beats`);
      const raw = await runAgentText(buildPrompt(digest), model, options.timeoutMs ?? 180_000, readTaskProfiles().state);
      const parsed = ArcSchema.parse(parseJsonObject(raw));
      arc = { volume: digest.volume, title: parsed.title, summary: parsed.summary, keyTurns: parsed.keyTurns, characters: parsed.characters };
      const temporary = path + ".tmp";
      await writeFile(temporary, JSON.stringify(arc, null, 2) + "\n", "utf8");
      await rename(temporary, path);
      generated++;
    }
    arcs.push(arc);
  }
  syncVolumeArcs(worldDir, worldId, arcs);
  return { arcs, generated, cached };
}
