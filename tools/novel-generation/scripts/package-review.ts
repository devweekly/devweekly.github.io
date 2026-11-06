/**
 * 打包审核材料：数据库样本 + 分析请求/响应样本 + 生成的章节与写作中间产物。
 *
 *   npm run package-review
 *   npm run package-review -- --out /tmp/review.zip --max-mb 6 --batches 6
 *
 * 不打包原文全文与完整数据库（12MB）；只取有代表性的切片。
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildAnalysisUnits, groupAnalysisUnits } from "../src/novel-kb.js";
import { buildAnalysisPrompt, storyAnalysisCacheStatus } from "../src/story-analysis.js";
import { resolveAgentModel } from "../src/agent-runtime.js";
import { openStoryStateDatabase, openWorldDatabase } from "../src/database.js";

interface Entry {
  path: string;
  data: Buffer;
  optional?: boolean;
  note?: string;
}

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const worldId = arg("--world") ?? "conghuoniao";
const worldDir = resolve("worlds", worldId);
const outputDir = resolve(".output");
const maxBytes = Math.max(1, Number(arg("--max-mb") ?? 8)) * 1024 * 1024;
const batchCount = Math.max(2, Math.min(12, Number(arg("--batches") ?? 3)));
const stamp = new Date();
const localDate = stamp.getFullYear() + String(stamp.getMonth() + 1).padStart(2, "0") + String(stamp.getDate()).padStart(2, "0");
const localTime = String(stamp.getHours()).padStart(2, "0") + String(stamp.getMinutes()).padStart(2, "0");
const outPath = resolve(arg("--out") ?? join(outputDir, `review-pack-${worldId}-${localDate}-${localTime}.zip`));

const entries: Entry[] = [];
const add = (path: string, data: Buffer | string, options: { optional?: boolean; note?: string } = {}): void => {
  entries.push({ path, data: typeof data === "string" ? Buffer.from(data, "utf8") : data, ...options });
};
const totalBytes = (): number => entries.reduce((sum, entry) => sum + entry.data.length, 0);

/* ---------------------------------------------------------------- zip ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: Entry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const deflated = deflateRawSync(file.data, { level: 9 });
    const useDeflate = deflated.length < file.data.length;
    const body = useDeflate ? deflated : file.data;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(file.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(dosTime, 12);
    directory.writeUInt16LE(dosDate, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + body.length;
  }
  const directoryBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, directoryBuffer, end]);
}

/* ------------------------------------------------------------ database --- */

function withDatabase<T>(work: (db: ReturnType<typeof openWorldDatabase>) => T): T {
  const db = openWorldDatabase(worldDir, worldId);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

const rows = (sql: string, params: Array<string | number> = []): Array<Record<string, unknown>> =>
  withDatabase(db => db.prepare(sql).all(...params) as Array<Record<string, unknown>>);
const one = (sql: string): number => Number((withDatabase(db => db.prepare(sql).get()) as { count?: number })?.count ?? 0);

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function toCsv(records: Array<Record<string, unknown>>, columns: string[]): string {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [columns.join(","), ...records.map(record => columns.map(column => escape(record[column])).join(","))].join("\n") + "\n";
}

const counts = {
  chapters: one("SELECT COUNT(*) AS count FROM novel_chapters"),
  characters: one("SELECT COUNT(*) AS count FROM novel_characters"),
  mentions: one("SELECT COUNT(*) AS count FROM novel_mentions"),
  threads: one("SELECT COUNT(*) AS count FROM novel_plot_threads"),
  foreshadowings: one("SELECT COUNT(*) AS count FROM novel_foreshadowings"),
  beats: one("SELECT COUNT(*) AS count FROM novel_beats"),
  relations: one("SELECT COUNT(*) AS count FROM novel_relations"),
  arcs: one("SELECT COUNT(*) AS count FROM novel_arcs"),
  graphNodes: one("SELECT COUNT(*) AS count FROM story_graph_nodes"),
  graphEdges: one("SELECT COUNT(*) AS count FROM story_graph_edges"),
  chaptersWithBeats: one("SELECT COUNT(DISTINCT chapter_ordinal) AS count FROM novel_beats")
};

const storyAnalysis=withDatabase(db=>{const row=db.prepare("SELECT payload_json FROM story_analysis WHERE singleton=1 AND world_id=?").get(worldId) as {payload_json:string}|undefined;return row?JSON.parse(row.payload_json) as Record<string,unknown>:{};});
const graphNodes=rows("SELECT node_id AS id,node_type AS type,label,properties_json,source_refs_json FROM story_graph_nodes ORDER BY node_type,label").map(row=>({id:row.id,type:row.type,label:row.label,properties:JSON.parse(String(row.properties_json)),sourceRefs:JSON.parse(String(row.source_refs_json))}));
// `from` 是保留字，做别名会让整条 SQL 解析失败；用 from_id 再映射。
const graphEdges=rows("SELECT edge_id AS id,from_node_id AS from_id,to_node_id AS to_id,edge_type AS type,label,properties_json,source_refs_json FROM story_graph_edges ORDER BY edge_type,label").map(row=>({id:row.id,from:row.from_id,to:row.to_id,type:row.type,label:row.label,properties:JSON.parse(String(row.properties_json)),sourceRefs:JSON.parse(String(row.source_refs_json))}));
const degree=new Set(graphEdges.flatMap(e=>[String(e.from),String(e.to)]));
const graphQuality={
  nodeTypes:rows("SELECT node_type AS type,COUNT(*) AS count FROM story_graph_nodes GROUP BY node_type"),
  edgeTypes:rows("SELECT edge_type AS type,COUNT(*) AS count FROM story_graph_edges GROUP BY edge_type"),
  isolatedNodes:graphNodes.filter(n=>!degree.has(String(n.id))).map(n=>({id:n.id,type:n.type,label:n.label})),
  danglingEdges:graphEdges.filter(e=>!graphNodes.some(n=>n.id===e.from)||!graphNodes.some(n=>n.id===e.to)),
  nodesWithoutSourceRefs:graphNodes.filter(n=>!Array.isArray(n.sourceRefs)||!n.sourceRefs.length).map(n=>({id:n.id,type:n.type,label:n.label})),
  edgesWithoutSourceRefs:graphEdges.filter(e=>!Array.isArray(e.sourceRefs)||!e.sourceRefs.length).map(e=>({id:e.id,type:e.type,label:e.label}))
};
const interactionRows=rows("SELECT beat_id AS beatId,chapter_ordinal AS chapterOrdinal,summary,actors_json FROM novel_beats WHERE json_array_length(actors_json)>=2 ORDER BY chapter_ordinal,beat_id").map(row=>({...row,actors:JSON.parse(String(row.actors_json)),actors_json:undefined}));
const interactions=interactionRows.filter((_,index)=>index%Math.max(1,Math.ceil(interactionRows.length/8))===0).slice(0,8);
const summary = {
  worldId,
  generatedAt: new Date().toISOString(),
  counts,
  coverage: {
    chaptersWithBeats: counts.chaptersWithBeats + "/" + counts.chapters,
    beatCoverage: Number((counts.chaptersWithBeats / Math.max(1, counts.chapters)).toFixed(3))
  },
  chaptersPerVolume: rows("SELECT volume,COUNT(*) AS chapters,SUM(char_count) AS chars FROM novel_chapters WHERE ordinal>0 GROUP BY volume ORDER BY volume"),
  threadStatus: rows("SELECT status,COUNT(*) AS count FROM novel_plot_threads GROUP BY status ORDER BY count DESC"),
  foreshadowingStatus: rows("SELECT status,confidence,COUNT(*) AS count FROM novel_foreshadowings GROUP BY status,confidence ORDER BY count DESC"),
  topCharacters: rows("SELECT name,mention_total AS mentions,chapters_seen AS chapters,first_chapter AS firstChapter,last_chapter AS lastChapter FROM novel_characters ORDER BY mention_total DESC LIMIT 15"),
  storyCore: storyAnalysis.storyCore ?? {}, macguffins: Array.isArray(storyAnalysis.macguffins)?storyAnalysis.macguffins.length:0,
  graph: {nodes:counts.graphNodes,edges:counts.graphEdges},
  characterProfiles: counts.characterProfiles,
  storyAnalysisVersion: storyAnalysis.analysisVersion ?? null,
  storyCoreObservationCount: Array.isArray(storyAnalysis.storyCoreObservations)?storyAnalysis.storyCoreObservations.length:0,
  graphEvidenceCoverage: {
    nodesWithSourceRefs: graphNodes.length-graphQuality.nodesWithoutSourceRefs.length,
    edgesWithSourceRefs: graphEdges.length-graphQuality.edgesWithoutSourceRefs.length
  }
};

const characterSample = [
  ...rows("SELECT name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,first_chapter,last_chapter,chapters_seen,mention_total FROM novel_characters ORDER BY mention_total DESC LIMIT 4"),
  ...rows("SELECT name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,first_chapter,last_chapter,chapters_seen,mention_total FROM novel_characters WHERE mention_total BETWEEN 3 AND 80 ORDER BY RANDOM() LIMIT 2"),
  ...rows("SELECT name,aliases_json,role,bio,voice,personality_json,desires_json,contradictions_json,arc_json,first_chapter,last_chapter,chapters_seen,mention_total FROM novel_characters WHERE mention_total=0 LIMIT 1")
].map(row => {
  // 合并后的数组可能上百条（跨批次重复是已知问题）。示例只留前几条，
  // 但把总数写进 arrayCounts，审阅者能看出规模而不用背整包体积。
  const lists = {
    personality: JSON.parse(String(row.personality_json)) as string[],
    desires: JSON.parse(String(row.desires_json)) as string[],
    contradictions: JSON.parse(String(row.contradictions_json)) as string[],
    arc: JSON.parse(String(row.arc_json)) as string[]
  };
  const head = <T,>(items: T[], limit: number): T[] => items.slice(0, limit);
  return {
  ...row,
  bio: String(row.bio ?? "").slice(0, 240),
  aliases: JSON.parse(String(row.aliases_json)) as string[],
  personality: head(lists.personality, 8),
  desires: head(lists.desires, 5),
  contradictions: head(lists.contradictions, 5),
  arc: head(lists.arc, 5),
  arrayCounts: Object.fromEntries(Object.entries(lists).map(([key, value]) => [key, value.length])),
  aliases_json: undefined,
  personality_json: undefined,
  desires_json: undefined,
  contradictions_json: undefined,
  arc_json: undefined
  };
});

const profileRows = rows("SELECT name,summary,stages_json,traits_json,contradictions_json,arc_json,observation_count FROM novel_character_profiles");
const profilesByName = new Map(profileRows.map(row => [String(row.name), {
  summary: row.summary,
  stages: JSON.parse(String(row.stages_json)) as string[],
  traits: JSON.parse(String(row.traits_json)) as string[],
  contradictions: JSON.parse(String(row.contradictions_json)) as string[],
  arc: JSON.parse(String(row.arc_json)) as string[],
  observationCount: row.observation_count
}]));
for (const character of characterSample as Array<Record<string, unknown>>) {
  const profile = profilesByName.get(String(character.name));
  if (profile) (character as Record<string, unknown>).profile = profile;
}

const chapterSample = rows(
  "SELECT chapter_id,ordinal,volume,title,label,start_line,char_count,chunk_start,chunk_end FROM novel_chapters WHERE ordinal IN (1,300,753) ORDER BY ordinal"
);
const beatSample = rows(
  "SELECT chapter_id,chapter_ordinal AS chapterOrdinal,summary,actors_json FROM novel_beats WHERE chapter_ordinal IN (1,300,753) ORDER BY chapter_ordinal, beat_id"
).map(row => ({ ...row, actors: JSON.parse(String(row.actors_json)) as string[], actors_json: undefined }));

const threadSample = [
  ...rows("SELECT title,status,summary,key_turns_json,first_chapter,last_chapter,COALESCE(last_chapter,0)-COALESCE(first_chapter,0) AS span FROM novel_plot_threads ORDER BY span DESC LIMIT 3"),
  ...rows("SELECT title,status,summary,key_turns_json,first_chapter,last_chapter,COALESCE(last_chapter,0)-COALESCE(first_chapter,0) AS span FROM novel_plot_threads ORDER BY RANDOM() LIMIT 2")
].map(row => ({ ...row, keyTurns: JSON.parse(String(row.key_turns_json)) as string[], key_turns_json: undefined }));

const foreshadowingSample = [
  ...rows("SELECT clue,first_appearance,meaning,payoffs_json,confidence,status,chapter_ordinal FROM novel_foreshadowings WHERE confidence='明确线索' AND status='埋设' ORDER BY RANDOM() LIMIT 2"),
  ...rows("SELECT clue,first_appearance,meaning,payoffs_json,confidence,status,chapter_ordinal FROM novel_foreshadowings WHERE confidence='可能线索' ORDER BY RANDOM() LIMIT 2"),
  ...rows("SELECT clue,first_appearance,meaning,payoffs_json,confidence,status,chapter_ordinal FROM novel_foreshadowings WHERE status='已回收' ORDER BY RANDOM() LIMIT 1"),
  ...rows("SELECT clue,first_appearance,meaning,payoffs_json,confidence,status,chapter_ordinal FROM novel_foreshadowings WHERE confidence='不确定' ORDER BY RANDOM() LIMIT 1")
].map(row => ({ ...row, payoffs: JSON.parse(String(row.payoffs_json)) as string[], payoffs_json: undefined }));

const relationSample = rows(
  "SELECT r.from_name,r.to_name,r.label,r.evidence,r.chapter_ordinal,c.mention_total FROM novel_relations r " +
  "JOIN novel_characters c ON c.name=r.from_name ORDER BY c.mention_total DESC, r.from_name LIMIT 6"
);

const arcs = rows("SELECT volume,title,summary,key_turns_json,characters_json FROM novel_arcs WHERE volume IN (1,17) ORDER BY volume").map(row => ({
  ...row,
  keyTurns: JSON.parse(String(row.key_turns_json)) as string[],
  characters: JSON.parse(String(row.characters_json)) as string[],
  key_turns_json: undefined,
  characters_json: undefined
}));

const allCharacters = rows("SELECT name,aliases_json FROM novel_characters");
const aliasOwners = new Map<string, string[]>();
for (const character of allCharacters) {
  for (const alias of JSON.parse(String(character.aliases_json)) as string[]) {
    const owners = aliasOwners.get(alias) ?? [];
    owners.push(String(character.name));
    aliasOwners.set(alias, owners);
  }
}
const qualityFlags = {
  charactersWithoutMentions: rows("SELECT name,role FROM novel_characters WHERE mention_total=0 ORDER BY name LIMIT 40").map(row => row.name),
  charactersWithoutMentionsCount: one("SELECT COUNT(*) AS count FROM novel_characters WHERE mention_total=0"),
  aliasSharedByMultipleCharacters: [...aliasOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .slice(0, 40)
    .map(([alias, owners]) => ({ alias, owners })),
  chaptersWithoutBeats: rows(
    "SELECT ordinal,title FROM novel_chapters c WHERE c.ordinal>0 AND NOT EXISTS (SELECT 1 FROM novel_beats b WHERE b.chapter_ordinal=c.ordinal) ORDER BY ordinal"
  ).map(row => row.ordinal + " " + String(row.title)),
  threadsWithoutResolutionHint: one("SELECT COUNT(*) AS count FROM novel_plot_threads WHERE status='未判断'"),
  foreshadowingsUncertain: one("SELECT COUNT(*) AS count FROM novel_foreshadowings WHERE confidence='不确定'")
};

add("01-database/summary.json", json(summary));
add("01-database/schema.sql", withDatabase(db => (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").all() as Array<{ sql: string }>).map(row => row.sql + ";").join("\n\n") + "\n"));
add("01-database/schema-state.sql", (() => { const db = openStoryStateDatabase(worldDir, worldId); try { return (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").all() as Array<{ sql: string }>).map(row => row.sql + ";").join("\n\n") + "\n"; } finally { db.close(); } })());
add("01-database/schema.md", [
  "# 数据表说明",
  "",
  "| 表 | 一行是什么 | 关键列 |",
  "|---|---|---|",
  "| `novel_chapters` | 一章 | `ordinal` 全书序号、`volume` 卷、`chunk_start/chunk_end` 对应检索片段下标 |",
  "| `novel_characters` | 一个人物（全书合并后） | `name`、`aliases_json`、`mention_total`、`chapters_seen`、`first_chapter/last_chapter` |",
  "| `novel_mentions` | 人物 × 章的出现次数 | `chapter_id`、`name`、`count`；只统计本名，不含别名 |",
  "| `novel_beats` | 一条章级事件 | `chapter_ordinal`、`summary`、`actors_json` |",
  "| `novel_plot_threads` | 一条局部情节线 | `title`、`status`、`summary`、`key_turns_json`、`first/last_chapter` |",
  "| `novel_foreshadowings` | 一条伏笔线索 | `clue`、`confidence`、`status`（埋设/已回收）、`chapter_ordinal` |",
  "| `novel_relations` | 一对人物关系 | `from_name`、`to_name`、`label`、`evidence` |",
  "| `novel_arcs` | 一卷的主线梗概 | `volume`、`summary`、`key_turns_json`、`characters_json` |",
  "| `story_graph_nodes` / `story_graph_edges` | 故事核心、人物、情节线、伏笔、MacGuffin、事件和发展可能组成的关系图 | 节点/边类型、关系方向、来源引用、属性 JSON |",
  "",
  "写作状态另存于 `characters`、`story_state`、`story_events`、`plot_threads`（不带 `novel_` 前缀），与上述成书知识库分开。",
  ""
].join("\n"));
add("01-database/characters.sample.json", json(characterSample));
add("01-database/characters.top50.csv", toCsv(
  rows("SELECT name,aliases_json,mention_total,chapters_seen,first_chapter,last_chapter,substr(role,1,60) AS role FROM novel_characters ORDER BY mention_total DESC LIMIT 50"),
  ["name", "aliases_json", "mention_total", "chapters_seen", "first_chapter", "last_chapter", "role"]
));
add("01-database/chapters.sample.json", json(chapterSample));
add("01-database/beats.sample.json", json(beatSample));
add("01-database/threads.sample.json", json(threadSample));
add("01-database/foreshadowings.sample.json", json(foreshadowingSample));
add("01-database/relations.sample.json", json(relationSample));
add("01-database/arcs.sample.json", json(arcs));
add("01-database/README.md", [
  "# 数据库：概要、样例与出处",
  "",
  "完整数据在仓库里，本包不复制。这里只放三类东西：",
  "",
  "- `schema.sql` / `schema-state.sql` / `schema.md`：表结构，用来判断字段设计够不够用；",
  "- `summary.json` / `quality-flags.json`：规模、覆盖、状态分布、质量问题清单；",
  "- `*.sample.json` / `characters.top50.csv`：每张表 1–6 条示例，只看字段形状与内容粒度。",
  "",
  "因为样例很短，**不要用它们判断分布**（例如「人物描写是否普遍空洞」），那类结论要回原库查。",
  "",
  "| 内容 | 仓库路径 | 查询方式 |",
  "|---|---|---|",
  "| 知识库：2,594 片段 / " + counts.characters + " 人 / " + counts.beats + " 事件 / " + counts.threads + " 线 / " + counts.foreshadowings + " 伏笔 / " + counts.relations + " 关系 | `worlds/conghuoniao/novel.db` | `npm run dev -- story-kb --world conghuoniao --type overview` |",
  "| 写作状态：人物、事实、事件、情节线、连续性备注 | `worlds/conghuoniao/story.db` | `npm run dev -- db-status --world conghuoniao` |",
  "| 知识库文本快照（可读、可 diff） | `worlds/conghuoniao/story-kb.json` | 直接读 JSON |",
  "| 原文 | 不入库 | 需另行提供语料 |",
  "",
  "常用查询：",
  "",
  "```bash",
  "npm run dev -- story-kb --world conghuoniao --type characters --query 李阎",
  "npm run dev -- story-kb --world conghuoniao --type threads --status 进行中",
  "npm run dev -- story-kb --world conghuoniao --type foreshadowings --status 已回收",
  "npm run dev -- story-kb --world conghuoniao --type beats --from 1 --to 60",
  "npm run dev -- story-kb --world conghuoniao --type arcs",
  "```",
  ""
].join("\n"));
add("01-database/quality-flags.json", json(qualityFlags));
add("01-database/story-core.json",json(storyAnalysis.storyCore??{}));
add("01-database/story-core-observations.json",json(storyAnalysis.storyCoreObservations??[]));
add("01-database/macguffins.json",json(storyAnalysis.macguffins??[]));
add("01-database/story-graph.json",json({nodes:graphNodes,edges:graphEdges}),{optional:true});
add("01-database/story-graph-quality.json",json(graphQuality));
add("01-database/interactions.sample.json",json(interactions));
if (existsSync(join(worldDir, "story-state.json"))) {
  add("01-database/writing-state.sample.json", await readFile(join(worldDir, "story-state.json")));
}

/* ------------------------------------------------------- analysis calls --- */

const model = resolveAgentModel().model;
const { units } = await buildAnalysisUnits(worldId, { worldDir });
const batches = groupAnalysisUnits(units, 14_000);
const cache = await storyAnalysisCacheStatus(worldId, { worldDir });
// 语料或提示词版本变化后，当前指纹对应的缓存目录可能还没生成：这是缺数据，不是错误。
const cacheAvailable = existsSync(cache.directory);
const picks = [...new Set(Array.from({ length: batchCount }, (_, index) =>
  Math.min(batches.length - 1, Math.round((index * (batches.length - 1)) / Math.max(1, batchCount - 1)))
))];
const analysisMeta: Array<Record<string, unknown>> = [];
for (const index of picks) {
  const chapters = batches[index] ?? [];
  const request = buildAnalysisPrompt({ index, chapters, chars: chapters.reduce((sum, chapter) => sum + chapter.charCount, 0) });
  const responsePath = join(cache.directory, "batch-" + String(index).padStart(4, "0") + ".json");
  const response = existsSync(responsePath) ? await readFile(responsePath, "utf8") : "";
  const responseStat = existsSync(responsePath) ? await stat(responsePath) : undefined;
  const parsed = response ? JSON.parse(response) as Record<string, unknown[]> : {};
  const base = "02-analysis-calls/batch-" + String(index).padStart(4, "0");
  add(base + ".request.md", request);
  if (response) add(base + ".response.json", response);
  analysisMeta.push({
    batch: index,
    chapters: chapters.map(chapter => ({ key: chapter.chapterId, title: chapter.title, chars: chapter.charCount })),
    chars: chapters.reduce((sum, chapter) => sum + chapter.charCount, 0),
    requestBytes: Buffer.byteLength(request, "utf8"),
    responseBytes: Buffer.byteLength(response, "utf8"),
    responseWrittenAt: responseStat?.mtime.toISOString(),
    extracted: Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]))
  });
}
add("02-analysis-calls/sampling.json", json({
  model,
  totalBatches: batches.length,
  batchSizeChars: 14_000,
  selected: picks,
  cacheDirectory: cache.directory.replace(process.cwd() + "/", ""),
  cacheAvailable,
  note: "请求体由 CLI 的提示词构造函数原样重建；响应体来自实际调用缓存。SDK 不落盘 token 数与耗时，故未包含。"
}));
add("02-analysis-calls/README.md", [
  "# 分批分析的请求与响应",
  "",
  "- `batch-NNNN.request.md`：用项目里的同一提示词构造函数，作用在该批章节文本上重建的完整请求体。",
  "- `batch-NNNN.response.json`：模型实际返回、并经 schema 校验后写入缓存的 JSON，未做改写。",
  "- `meta.json`：每批覆盖的 chapterKey、字数、请求/响应字节数、抽取到的条目数。",
  "- `sampling.json`：总批数、采样点、模型、缓存目录。",
  "",
  "未包含 token 数与耗时：Agent SDK 只返回文本，不落盘这些指标。",
  cacheAvailable ? "" : "当前语料指纹下没有分析缓存（`sampling.json` 里 `cacheAvailable=false`），因此这一节只有重建的请求体、没有响应体；响应体需要先跑一次 `analyze-story` 才会产生。",
  "响应里的「本批」是模型按提示词写的批次内措辞，入库时会统一改写为「这一阶段」。",
  ""
].join("\n"));
add("02-analysis-calls/meta.json", json(analysisMeta));
for (const name of cacheAvailable ? await readdir(cache.directory) : []) {
  if (!/^batch-\d{4}\.json\.(invalid-raw|repair-raw)\.txt$/.test(name)) continue;
  add("02-analysis-calls/failed/" + name, await readFile(join(cache.directory, name)), { optional: true });
}

add("02-analysis-calls/config.json", json({
  model,
  configFile: JSON.parse(await readFile(resolve("novel-generation.config.json"), "utf8")),
  note: "分析阶段使用 thinkingMode=disabled、effort=low 的 state 档案；写作阶段按 taskProfiles 各自配置。"
}));

/* ------------------------------------------------------------ references --- */

add("REFERENCES.md", [
  "# 完整数据与产物索引",
  "",
  "本包是切片：已经入库的内容不重复打包。下列路径都在仓库 `tools/novel-generation/` 下。",
  "",
  "| 用途 | 路径 | 说明 |",
  "|---|---|---|",
  "| 知识库 | `worlds/conghuoniao/novel.db` | 12MB：标注、`novel_*`、`story_analysis`、`story_graph_*` |",
  "| 写作状态 | `worlds/conghuoniao/story.db` | 68KB：人物、正史事实、事件、情节线、连续性备注，每章重写 |",
  "| 知识库文本快照 | `worlds/conghuoniao/story-kb.json` | 3.5MB，不含原文，便于 diff |",
  "| 分析请求/响应缓存 | `.output/conghuoniao/story-analysis/<cache-key>/` | 196 批，`batch-NNNN.json` 为模型原始返回 |",
  "| 万字流水线产物 | `.output/conghuoniao/long-2026-11-05T13-04-56-213Z/` | 蓝图、逐场、草稿、审查、润色、节奏指标、终稿 |",
  "| 回归实验 | `.output/regression/<run>/` | 原文续写盲测两版 + 评审 |",
  "| 多 Agent 分析成稿 | `analysis/conghuoniao/agent-analysis/` | 5 份 `output.md` + `manifest.json`（含逐句证据核验） |",
  "| 卷章索引 | `analysis/conghuoniao/chapter-index.json` | 753 章的卷序、标题、行号、字数 |",
  "| 世界设定 | `worlds/conghuoniao/{world-bible,yanfu-system,fruit-worlds,characters,timeline,style-profile}.md` | 人工整理的设定摘要 |",
  "| 硬约束 | `worlds/conghuoniao/laws.json` | 可机检的位阶、数值、身份禁忌 |",
  "| 原文 | 不入库 | 需另行提供 |",
  ""
].join("\n"));

/* -------------------------------------------------------------- writing --- */

const worldOutputDir = join(outputDir, worldId);
const runRoots = existsSync(worldOutputDir)
  ? (await readdir(worldOutputDir, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith("long-")).map(entry => entry.name).sort()
  : [];
const latestRun = runRoots.at(-1);
if (latestRun) {
  const runDir = join(worldOutputDir, latestRun);
  const pickFiles: Array<[string, string, boolean]> = [
    ["01-scene-blueprint.md", "blueprint.md", false],
    ["00-scene-01-retrieval.md", "retrieval-context.md", true],
    ["02-scene-01.md", "scene-01.md", false],
    ["02-scene-02.md", "scene-02.md", false],
    ["02-scene-03.md", "scene-03.md", true],
    ["03-draft.md", "draft.md", true],
    ["04-continuity-review.md", "continuity-review.md", false],
      ["06-rhythm-metrics.json", "rhythm-metrics.json", false],
    ["stage-calls.jsonl", "stage-calls.jsonl", true],
    ["07-state-update.json", "state-update.json", true],
    ["chapter.md", "chapter-final.md", false]
  ];
  for (const [source, target, optional] of pickFiles) {
    const file = join(runDir, source);
    if (existsSync(file)) add("03-writing/long-chapter/" + target, await readFile(file), { optional });
  }

  // Include every scene's actual polish output, not just scene 1. Keep these
  // optional so the pack budget can trim them only when necessary.
  const polishFiles = (await readdir(runDir)).filter(name => /^05-polish-\d{2}\.md$/.test(name)).sort();
  for (const name of polishFiles) {
    add("03-writing/long-chapter/" + name.slice(3), await readFile(join(runDir, name)), { optional: true });
  }
  const polishDiagnostics = join(runDir, "05-polish-diagnostics.json");
  if (existsSync(polishDiagnostics)) add("03-writing/long-chapter/polish-diagnostics.json", await readFile(polishDiagnostics), { optional: true });

  add("03-writing/long-chapter/README.md", [
    "# 万字章节流水线样本",
    "",
    "- 来源：`.output/" + worldId + "/" + latestRun + "/`",
    "- 顺序：蓝图 → 逐场检索与生成 → 拼章草稿 → 连续性审查 → 逐场润色 → 节奏指标 → 状态提取。",
    "- `chapter-final.md` 是最终交给用户的正文章节；`draft.md` 是润色前全文；所有 `polish-XX.md` 与 `polish-diagnostics.json` 用于检查逐场修订幅度。",
    "- `state-update.json` 是模型从正文提取的结构化状态，写入前会经过 schema 校验。",
    ""
  ].join("\n"));
}
for (const name of ["chapter-001.md", "chapter-002.md"]) {
  const file = join(worldDir, "chapters", name);
  if (existsSync(file)) add("03-writing/" + name, await readFile(file));
}
if (existsSync(join(outputDir, "kimi-write.log"))) {
  add("04-logs/kimi-write.log", await readFile(join(outputDir, "kimi-write.log")), { optional: true });
}
if (existsSync(join(outputDir, "shard-0.log"))) {
  add("04-logs/analysis-shard-0.log", await readFile(join(outputDir, "shard-0.log")), { optional: true });
}

/* --------------------------------------------------------------- budget --- */

const dropped: string[] = [];
const dropOrder = [
  "retrieval-context.md",
  "story-graph.json",
  "draft.md",
  "state-update.json",
  "analysis-shard-0.log",
  "stage-calls.jsonl",
  "kimi-write.log",
  "scene-03.md"
];
for (const entry of [...entries].filter(item => item.optional && item.path.includes("/polish-") && /polish-\d{2}\.md$/.test(item.path))) {
  if (totalBytes() <= maxBytes) break;
  dropped.push(entry.path);
  entries.splice(entries.indexOf(entry), 1);
}
for (const token of dropOrder) {
  if (totalBytes() <= maxBytes) break;
  const index = entries.findIndex(entry => entry.optional && entry.path.endsWith(token));
  if (index >= 0) {
    dropped.push(entries[index]!.path);
    entries.splice(index, 1);
  }
}
while (totalBytes() > maxBytes) {
  const last = [...entries].reverse().find(entry => entry.path.startsWith("02-analysis-calls/batch-"));
  if (!last) break;
  const prefix = last.path.replace(/\.(request\.md|response\.json)$/, "");
  const removed = entries.filter(entry => entry.path === prefix + ".request.md" || entry.path === prefix + ".response.json");
  if (!removed.length) break;
  dropped.push(...removed.map(entry => entry.path));
  for (const entry of removed) entries.splice(entries.indexOf(entry), 1);
}

/* --------------------------------------------------------------- readme --- */

const sampleCounts = {
  characters: characterSample.length,
  chapters: chapterSample.length,
  threads: threadSample.length,
  foreshadowings: foreshadowingSample.length,
  relations: relationSample.length,
  arcs: arcs.length
};
const sizeMb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2) + " MB";
const readme = [
  "# 小说续写系统 · 审核材料包",
  "",
  "生成时间：" + stamp.toLocaleString("zh-CN", { hour12: false }) + "（本机时区）　世界：" + worldId + "　模型：" + model,
  "",
  "## 这是什么",
  "",
  "一套本地运行的中文长篇小说工具：把 753 章、约 190 万字的原文（用户自行提供）整理成可检索的知识库，",
  "再基于该知识库生成新的章节。本包是供外部审核用的切片，不是完整数据。",
  "",
  "数据规模：" + counts.chapters + " 章 / " + counts.characters + " 人 / " + counts.mentions + " 条人物×章出场 / " +
    counts.beats + " 条章级事件 / " + counts.threads + " 条局部情节线 / " + counts.foreshadowings + " 条伏笔 / " +
    counts.relations + " 条人物关系 / " + counts.arcs + " 篇卷级梗概。",
  "",
  "## 目录",
  "",
  "| 路径 | 内容 | 建议关注 |",
  "|---|---|---|",
  "| `01-database/` | schema、统计、质量问题清单、每类 1–6 条示例 | 字段设计是否够用、分类口径、异常项 |",
  "| `02-analysis-calls/` | " + picks.length + " 次分批分析的请求体（响应体需缓存存在） | 提示词是否明确、输出是否被正确解析 |",
  "| `03-writing/` | 生成的新章节、所有场景润色稿、润色幅度与阶段调用日志 | 连续性、文风、扩写幅度、阶段耗时 |",
  "| `04-logs/` | 分析分片与写作过程的运行日志 | 失败重试、超时、逐阶段耗时 |",
  "| `manifest.json` | 每个文件的字节数与 sha256 | 校验用 |",
  "",
  "## 本包为什么不完整",
  "",
  "分析结果与生成产物都已经随仓库提交，重复打包只会让包变大、且与仓库版本对不上。",
  "所以这里只放：统计与质量问题清单、每类几条示例、schema、以及少量请求/响应样本；",
  "完整数据的路径与查询命令见 `REFERENCES.md` 和 `01-database/README.md`。",
  "",
  "如果要判定「分布」或「普遍性问题」，请按 `REFERENCES.md` 回原库检索，不要用示例下结论。",
  "",
  "## 数据是怎么来的",
  "",
  "1. `index-story`：按卷章索引把 2,594 个检索片段映射回 753 章。片段之间原本有约 160 字重叠，重建章节文本时去重；",
  "   不去重会让文本虚增 12%（`李阎` 从 14,024 次涨到 15,724 次）。",
  "2. `analyze-story`：以章为分析单元装箱（约 14,000 字一批，共 196 批），每批让模型返回人物、关系、情节线、伏笔、章级事件；",
  "   章级事件必须带 `chapterKey`（如 `V11-C045`），用于对齐真实章节。",
  "3. 合并：人物只按规范姓名合并；带原文证据的个人化名/别称只作为检索元数据，不用于实体合并；称号、职位、传承、能力和身份分开分类，共享别名不参与关系解析。",
  "4. `analyze-arcs`：把每卷的章级事件汇总成一篇主线梗概。",
  "",
  "## 请重点审什么（按优先级）",
  "",
  "1. **人物归并是否正确**：`characters.sample.json` 的几名主要人物里，有没有把两个人当成一个、或一个人拆成两条；别名是否可信。要看全部 544 人，用 `story-kb --type characters` 导出。",
  "2. **伏笔是否成立**：`foreshadowings.sample.json` 里 `明确线索` 是否真的在原文有落点，`已回收` 的回收方式是否对得上。",
  "3. **情节线粒度**：`threads.sample.json` 只给了跨度最长的几条；862 条全部是局部情节线候选记录，同名但不同阶段应保留，不算重复。",
  "4. **故事图谱**：`story-graph-quality.json` 给的是连通性摘要（孤立节点、悬空边、缺来源引用），完整图谱在 `novel.db` 的 `story_graph_nodes/edges`；当前库内该图为空，属已知状态。",
  "5. **故事核心与 MacGuffin**：`story-core.json`、`macguffins.json` 是全文导出（体量小），可直接判断是否识别真正驱动行动的核心目标。",
  "6. **人物互动**：`interactions.sample.json` 是 8 条均匀抽样的多人事件，只看互动写法是否有原文依据；全量在 `novel_beats` 的 `actors`。",
  "7. **章级事件是否准确**：`beats.sample.json` 只给第 1、300、753 章；1,314 条覆盖 738/753 章，全量用 `story-kb --type beats` 查。",
  "8. **章节质量**：`03-writing/long-chapter/chapter-final.md` 与 `draft.md` 对比，看修订是否改善了节奏而没有引入新事实。",
  "9. **提示词是否安全**：`02-analysis-calls/*.request.md` 是否包含会诱导模型编造设定的指令。",
  "",
  dropped.length ? "> 本包已按体积上限裁剪：" + dropped.join("、") + "\n" : "",
  "## 已知局限（请勿当作新问题重复报告）",
  "",
  "- 分类样本只是示例（每类 1–6 条），不能代表分布；需要统计结论时回原库。故事核心、MacGuffin 与图质量摘要是完整导出。孤立节点不自动代表分析错误。",
  "- 有 " + qualityFlags.charactersWithoutMentionsCount + " 个人物「有名无实」：模型给出了名字，但正文没有逐字出现，统计为 0。",
  "- 人物的性格/欲望/矛盾/成长数组是逐批观察（每批只看几章，同一个人被反复描述），主角可达数百条（李阎：性格 193、欲望 197、矛盾 194、成长 380）。",
  "  这些不是重复文本，实测两两相似度都低于 0.6，去重去不掉。`novel_character_profiles` 把主要人物合并成一份档案（本次 " + counts.characterProfiles + " 人），示例里以 `profile` 字段给出；原始数组保留作证据，示例只留前 5–8 条，总量见 `arrayCounts`。",
  "- 置信度、状态、关系标签都是模型判断，不是人工标注。",
  "- SDK 不落盘 token 与耗时，`02-analysis-calls/` 包含采样请求/响应，以及已保留的失败原始响应；请求体由同一构造函数重建，内容与线上一致。长章节 `stage-calls.jsonl` 记录实际执行的阶段、请求模型候选链、提示词/输出字符数、耗时和结果；缓存命中不会产生模型调用记录。",
  "- 原文全文与 12MB 的 `novel.db` 未打包；如需核对原文，请另行提供语料。",
  "",
  "## 版权",
  "",
  "原文与生成章节均为用户提供的材料，仅用于本次审核，不应再分发。",
  ""
].join("\n");
add("README.md", readme);

const manifest = {
  bundle: "novel-generation review pack",
  worldId,
  generatedAt: new Date().toISOString(),
  model,
  budgetBytes: maxBytes,
  uncompressedBytes: totalBytes(),
  dropped,
  counts,
  files: entries.map(entry => ({
    path: entry.path,
    bytes: entry.data.length,
    sha256: createHash("sha256").update(entry.data).digest("hex")
  }))
};
add("manifest.json", json(manifest));

/* ---------------------------------------------------------------- write --- */

const zip = buildZip(entries);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, zip);

console.log(JSON.stringify({
  out: outPath,
  zipBytes: zip.length,
  zipSize: sizeMb(zip.length),
  files: entries.length,
  uncompressed: sizeMb(totalBytes()),
  budget: sizeMb(maxBytes),
  dropped,
  analysisBatches: picks.length,
  counts
}, null, 2));
