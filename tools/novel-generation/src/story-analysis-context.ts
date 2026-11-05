import type { StoryAnalysisSnapshot } from "./database.js";

type AnalysisItem = Record<string, unknown>;

function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [];
}

function terms(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
  const result = new Set(normalized.split(/\\s+/u).filter(token => token.length > 1));
  const compact = normalized.replace(/\\s/gu, "");
  for (let i = 0; i < compact.length - 1; i++) result.add(compact.slice(i, i + 2));
  return result;
}

function score(item: AnalysisItem, queryTerms: Set<string>, query: string): number {
  const text = values(item).join(" ");
  const itemTerms = terms(text);
  let total = 0;
  for (const term of queryTerms) if (itemTerms.has(term)) total += term.length > 2 ? 2 : 1;
  const name = String(item.name ?? item.title ?? item.clue ?? item.focus ?? "");
  if (name && query.includes(name)) total += 20;
  const aliases = Array.isArray(item.aliases) ? item.aliases : [];
  for (const alias of aliases) if (typeof alias === "string" && alias.length > 1 && query.includes(alias)) total += 12;
  return total;
}

function select(items: AnalysisItem[], queryTerms: Set<string>, query: string, limit: number): AnalysisItem[] {
  return items
    .map(item => ({ item, score: score(item, queryTerms, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item);
}

function compact(item: AnalysisItem): string {
  const refs = Array.isArray(item.sourceRefs)
    ? item.sourceRefs.map(ref => {
        const value = ref as Record<string, unknown>;
        return [value.source, value.chapter].filter(Boolean).join(" / ");
      }).filter(Boolean)
    : [];
  const body = Object.entries(item)
    .filter(([key, value]) => key !== "sourceRefs" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join("；") : typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join("\\n");
  return body + (refs.length ? "\\n- 参考来源范围（用于回查，不代表逐条证明）： " + [...new Set(refs)].join("；") : "");
}

/** Selects only potentially relevant analysis as optional inspiration; never turns it into canon or a writing checklist. */
export function buildStoryAnalysisContext(snapshot: StoryAnalysisSnapshot | undefined, query: string): string {
  if (!snapshot?.complete || !query.trim()) return "";
  const queryTerms = terms(query);
  const groups: Array<[string, AnalysisItem[], number]> = [
    ["相关人物（画像与变化可能性）", snapshot.characters, 5],
    ["相关情节线", snapshot.plotThreads, 4],
    ["可能的伏笔与不同解释", snapshot.foreshadowings, 4],
    ["可探索的后续发展（创意选项）", snapshot.developmentPossibilities, 5]
  ];
  const sections = groups.map(([title, items, limit]) => {
    const chosen = select(items, queryTerms, query, limit);
    return chosen.length ? "### " + title + "\\n" + chosen.map(compact).join("\\n\\n") : "";
  }).filter(Boolean);
  if (!sections.length) return "";
  return [
    "以下是从既有语料分析中挑选出的相关参考。它们是可选素材和创意火花，不是正史、人物定论、剧情任务或必须兑现的伏笔。",
    "人物画像不能限制人物当下的选择；成长方向可以互相矛盾，人物可以反复、倒退、背叛、和解、黑化或洗白。情节建议可以采用、改造、组合或全部舍弃。",
    "若参考内容与用户本次创作意图、正文自然性或文学表达冲突，以本次创作和文学表达为准。不要为了体现这些资料而强行塞入人物、伏笔或情节。",
    sections.join("\\n\\n")
  ].join("\\n\\n");
}
