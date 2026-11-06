import type { StoryAnalysisSnapshot } from "./database.js";

type AnalysisItem = Record<string, unknown>;

function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [];
}

const STOP_TERMS = new Set([
  "人物", "角色", "故事", "情节", "发展", "可能", "当前", "本章", "这一", "一个", "一些",
  "已经", "正在", "之后", "之前", "然后", "因此", "因为", "但是", "如果", "没有", "什么",
  "如何", "是否", "自己", "他们", "我们", "对方", "事情", "发生", "关系", "方面", "可以",
  "需要", "成为", "开始", "继续", "以及", "以及", "这个", "那个", "其中", "通过", "对于"
]);

function terms(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const result = new Set(normalized.split(/\s+/u).filter(token => token.length > 1 && !STOP_TERMS.has(token)));
  const compact = normalized.replace(/\s/gu, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const pair = compact.slice(i, i + 2);
    if (!STOP_TERMS.has(pair)) result.add(pair);
  }
  return result;
}

function score(item: AnalysisItem, queryTerms: Set<string>, query: string): number {
  const metadata = new Set(["sourceRefs", "chapterKeys", "aliases", "confidence", "status"]);
  const text = Object.entries(item)
    .filter(([key]) => !metadata.has(key))
    .flatMap(([, value]) => values(value))
    .join(" ");
  const itemTerms = terms(text);
  let total = 0;
  for (const term of queryTerms) if (itemTerms.has(term)) total += term.length > 2 ? 2 : 1;
  const queryCompact = query.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const name = String(item.name ?? item.title ?? item.clue ?? item.focus ?? "");
  const nameCompact = name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (nameCompact.length > 1 && queryCompact.includes(nameCompact)) total += 24;
  const aliases = Array.isArray(item.aliases) ? item.aliases : [];
  for (const alias of aliases) {
    if (typeof alias !== "string") continue;
    const aliasCompact = alias.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (aliasCompact.length > 1 && queryCompact.includes(aliasCompact)) total += 16;
  }
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
    .join("\n");
  const sourceSummary = refs.length ? "\n- 参考来源范围（用于回查，不代表逐条证明）： " + [...new Set(refs)].slice(0, 5).join("；") + (refs.length > 5 ? `；另有 ${refs.length - 5} 处` : "") : "";
  return body.slice(0, 1400) + (body.length > 1400 ? "…" : "") + sourceSummary;
}

/** 当前快照结构版本；ADR-0002 §6：旧版本快照不得注入写作上下文，必须重新分析。 */
const ANALYSIS_VERSION = 6;

/** Selects only potentially relevant analysis as optional inspiration; never turns it into canon or a writing checklist. */
export function buildStoryAnalysisContext(snapshot: StoryAnalysisSnapshot | undefined, query: string): string {
  if (!snapshot?.complete || !query.trim()) return "";
  const version = snapshot.analysisVersion;
  if (typeof version !== "number" || version < ANALYSIS_VERSION) {
    console.warn(
      "[analysis-context] 分析快照版本 " + (typeof version === "number" ? version : "缺失") +
      " 低于当前 " + ANALYSIS_VERSION + "，已跳过注入；重新运行 npm run dev -- analyze-story 生成当前版本快照。"
    );
    return "";
  }
  const queryTerms = terms(query);
  const groups: Array<[string, AnalysisItem[], number]> = [
    ["相关人物（画像与变化可能性）", snapshot.characters, 5],
    ["相关人物互动与关系变化", snapshot.relations ?? [], 6],
    ["相关主线与支线", snapshot.plotThreads, 5],
    ["相关 MacGuffin（驱动行动的目标/物件/信息）", snapshot.macguffins ?? [], 4],
    ["可能的伏笔与不同解释", snapshot.foreshadowings, 5],
    ["可探索的后续发展（创意选项）", snapshot.developmentPossibilities, 5]
  ];
  const sections = groups.map(([title, items, limit]) => {
    const chosen = select(items, queryTerms, query, limit);
    return chosen.length ? "### " + title + "\n" + chosen.map(compact).join("\n\n") : "";
  }).filter(Boolean);
  const graph=snapshot.storyGraph;
  const nodes=Array.isArray(graph?.nodes)?graph.nodes as Array<Record<string,unknown>>:[];
  const edges=Array.isArray(graph?.edges)?graph.edges as Array<Record<string,unknown>>:[];
  const matched=select(nodes.map(n=>({...((n.data&&typeof n.data==="object")?n.data as Record<string,unknown>:{}),graphId:n.id})),queryTerms,query,8);
  const ids=new Set(matched.map(n=>String(n.graphId)));
  const connected=new Set(ids);
  for(const edge of edges)if(ids.has(String(edge.from))||ids.has(String(edge.to))){connected.add(String(edge.from));connected.add(String(edge.to));}
  const links=edges.filter(e=>connected.has(String(e.from))&&connected.has(String(e.to))).slice(0,16).map(e=>{
    const from=nodes.find(n=>n.id===e.from),to=nodes.find(n=>n.id===e.to);
    return "- "+String(from?.label??e.from)+" —"+String(e.label??e.type)+"→ "+String(to?.label??e.to);
  });
  if(links.length)sections.push("### 与本次任务相关的故事关系图\n"+links.join("\n"));
  const core=snapshot.storyCore&&Object.keys(snapshot.storyCore).length?"### 故事核心观察（保留多种解释）\n"+compact(snapshot.storyCore as AnalysisItem):"";
  if(!sections.length&&!core)return "";
  const rendered = [
    "以下是从既有语料分析中挑选出的相关参考。它们是可选素材和创意火花，不是正史、人物定论、剧情任务或必须兑现的伏笔。",
    "人物画像不能限制人物当下的选择；成长方向可以互相矛盾，人物可以反复、倒退、背叛、和解、黑化或洗白。情节建议可以采用、改造、组合或全部舍弃。",
    "若参考内容与用户本次创作意图、正文自然性或文学表达冲突，以本次创作和文学表达为准。不要为了体现这些资料而强行塞入人物、伏笔或情节。",
    core,
    sections.join("\n\n")
  ].join("\n\n");
  // 硬事实已由 writing-brief 承担，这里只留可选启发，预算压到 6k。
  const budget = 6_000;
  return rendered.length > budget ? rendered.slice(0, budget) + "\n\n（参考内容已截断；以本次创作任务和文学表达为准。）" : rendered;
}
