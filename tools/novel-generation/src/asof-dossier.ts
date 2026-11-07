import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readStoryAnalysis, type StoryAnalysisSnapshot } from "./database.js";

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}
function value(row: Record<string, unknown>, key: string): string {
  const item = row[key];
  if (typeof item === "string") return item.trim();
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  return "";
}
function list(label: string, items: unknown): string {
  const rows = strings(items);
  return rows.length ? label + "\n" + rows.map(item => "- " + item).join("\n") : "";
}
function chapters(row: Record<string, unknown>): string {
  return list("证据章节", row.chapterKeys ?? row.chapters ?? row.sourceRefs);
}
function section(title: string, rows: Array<Record<string, unknown>>, render: (row: Record<string, unknown>) => string): string {
  return "## " + title + "\n\n" + (rows.length ? rows.map((row, index) => "### " + (value(row, "name") || value(row, "title") || value(row, "clue") || value(row, "focus") || (index + 1)) + "\n\n" + render(row)).join("\n\n") : "当前时点没有足够证据形成条目。");
}

/** Render a human-readable dossier only from this world's completed, bounded SQLite snapshot. */
export function renderAsOfDossier(snapshot: StoryAnalysisSnapshot): Record<string, string> {
  if (!snapshot.complete) throw new Error("Story analysis snapshot is incomplete; refusing to publish a partial dossier.");
  const preface = [
    "# 历史时点分析资料",
    "",
    "- 宇宙：" + snapshot.worldId,
    "- 分析时间：" + snapshot.analyzedAt,
    "- 原文语料哈希：" + snapshot.sourceHash,
    "- 分析批次：" + snapshot.batches,
    "",
    "> 本资料仅反映当前故事宇宙起点及其之前的原文证据。人物画像、剧情线、伏笔和发展可能性是分析观察，不是正史补写，也不是后续创作的硬性约束。文学性、文笔、艺术风格优先；人物可以反复、转向、背叛、和解、黑化或洗白。",
    ""
  ].join("\n");
  const characters = section("人物", snapshot.characters, row => [
    value(row, "shortBio"),
    value(row, "storyFunction") ? "故事作用：" + value(row, "storyFunction") : "",
    list("可观察性格", row.personality),
    list("内在矛盾", row.contradictions),
    list("已观察到的变化", row.observedChanges),
    list("欲望与目标", row.desires),
    list("关系", row.relationships),
    value(row, "voice") ? "表达声音：" + value(row, "voice") : "",
    list("可能的发展方向（非剧情承诺）", row.arcPossibilities),
    chapters(row)
  ].filter(Boolean).join("\n\n"));
  const plot = section("主线与情节线", snapshot.plotThreads, row => [
    value(row, "summary"),
    value(row, "status") ? "当前状态：" + value(row, "status") : "",
    value(row, "narrativeRole") ? "叙事作用：" + value(row, "narrativeRole") : "",
    list("关键转折", row.keyTurns),
    list("未解问题", row.unresolvedQuestions),
    list("相关人物", row.relatedCharacters),
    chapters(row)
  ].filter(Boolean).join("\n\n"));
  const foreshadowings = section("伏笔", snapshot.foreshadowings, row => [
    value(row, "firstAppearance") ? "首次出现：" + value(row, "firstAppearance") : "",
    value(row, "possibleMeaning") ? "可能含义：" + value(row, "possibleMeaning") : "",
    list("可能回收方向（待验证）", row.possiblePayoffs),
    list("相关主线", row.relatedThreadTitles),
    value(row, "confidence") ? "分析置信度：" + value(row, "confidence") : "",
    value(row, "status") ? "状态：" + value(row, "status") : "",
    chapters(row)
  ].filter(Boolean).join("\n\n"));
  const macguffins = section("关键物件与 MacGuffin", snapshot.macguffins ?? [], row => [
    value(row, "kind") ? "类型：" + value(row, "kind") : "",
    value(row, "significance"),
    list("争夺者", row.whoWantsIt),
    list("动机", row.whyTheyWantIt),
    list("状态变化", row.shifts),
    list("相关人物", row.relatedCharacters),
    chapters(row)
  ].filter(Boolean).join("\n\n"));
  const coreRows = snapshot.storyCoreObservations ?? [];
  const core = section("故事核心", coreRows, row => [
    value(row, "centralConflict") ? "核心冲突：" + value(row, "centralConflict") : "",
    value(row, "centralQuestion") ? "核心问题：" + value(row, "centralQuestion") : "",
    list(" stakes", row.stakes),
    list("主题", row.themes),
    value(row, "narrativePromise") ? "叙事承诺：" + value(row, "narrativePromise") : "",
    list("主要剧情线", row.mainPlotThreadTitles),
    chapters(row)
  ].filter(Boolean).join("\n\n"));
  const development = section("后续发展可能性", snapshot.developmentPossibilities, row => [
    value(row, "direction"),
    value(row, "tension") ? "张力：" + value(row, "tension") : "",
    value(row, "whyPlausible") ? "为何可能成立：" + value(row, "whyPlausible") : "",
    list("意外发展选项", row.surpriseOptions),
    chapters(row)
  ].filter(Boolean).join("\n\n"));
  return {
    "story-analysis.md": preface + [plot, core].join("\n\n"),
    "characters.md": preface + characters,
    "foreshadowing.md": preface + foreshadowings,
    "macguffins.md": preface + macguffins,
    "development-possibilities.md": preface + development
  };
}

export async function exportAsOfDossier(worldId: string, worldDir: string): Promise<{ files: string[] }> {
  const snapshot = readStoryAnalysis(worldDir, worldId);
  if (!snapshot) throw new Error("No completed bounded story-analysis snapshot exists for this universe.");
  if (snapshot.worldId !== worldId) throw new Error("Story-analysis snapshot belongs to another universe.");
  const files = renderAsOfDossier(snapshot);
  const directory = join(worldDir, "as-of-analysis");
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = join(directory, name);
    const temporary = target + "." + process.pid + ".tmp";
    await writeFile(temporary, content.trimEnd() + "\n", "utf8");
    await rename(temporary, target);
  }
  return { files: Object.keys(files) };
}
