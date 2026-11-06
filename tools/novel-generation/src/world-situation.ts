import type { StoryState } from "./story-state.js";

type Character = StoryState["characters"][number];

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

function terms(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const result = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(item => item.length > 1));
  const compacted = compact(normalized);
  for (let index = 0; index < compacted.length - 1; index++) {
    result.add(compacted.slice(index, index + 2));
  }
  return result;
}

function relevance(query: string, values: string[]): number {
  const queryCompact = compact(query);
  const queryTerms = terms(query);
  let score = 0;
  for (const value of values.filter(Boolean)) {
    const normalized = compact(value);
    if (normalized.length > 1 && queryCompact.includes(normalized)) score += 24;
    for (const term of terms(value)) {
      if (queryTerms.has(term)) score += term.length > 2 ? 2 : 1;
    }
  }
  return score;
}

function strings(values: string[] | undefined, limit = 5): string {
  return (values ?? []).filter(Boolean).slice(0, limit).join("；");
}

function renderCharacter(character: Character): string {
  const rows = [
    character.status ? "当前处境：" + character.status : "",
    character.location ? "位置：" + character.location : "",
    character.goals?.length ? "目标：" + strings(character.goals, 4) : "",
    character.motivation ? "动机：" + character.motivation : "",
    character.knowledge?.length ? "已知信息：" + strings(character.knowledge, 6) : "",
    character.resources?.length ? "可用资源：" + strings(character.resources, 4) : "",
    character.constraints?.length ? "行动限制：" + strings(character.constraints, 4) : "",
    character.currentPressure?.length ? "当前压力：" + strings(character.currentPressure, 4) : "",
    character.relationships?.length ? "关系：" + strings(character.relationships, 5) : "",
    character.decisionHistory?.length ? "近期重要决定：" + strings(character.decisionHistory.slice(-4), 4) : "",
    character.profile?.contradictions?.length ? "内在矛盾：" + strings(character.profile.contradictions, 3) : ""
  ].filter(Boolean);
  return "### " + character.name + "\n" + rows.join("\n");
}

/**
 * Build a small, task-oriented view of canonical writing state for chapter planning.
 * It supplies facts and constraints; the planner itself decides whether any
 * independent action or off-screen development is narratively useful.
 */
export function buildWorldSituationContext(state: StoryState, query: string, maxChars = 5200): string {
  const source = query.trim();
  const selectedCharacters = state.characters
    .map((character, index) => ({
      character,
      index,
      score: relevance(source, [
        character.name,
        character.status,
        character.location ?? "",
        ...(character.goals ?? []),
        character.motivation ?? "",
        ...(character.relationships ?? [])
      ])
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 8);

  // If the request names no character, retain only the most recently updated
  // profiles. Do not turn an underspecified brief into a cast-wide simulation.
  const characterRows = (selectedCharacters.length
    ? selectedCharacters.map(item => item.character)
    : [...state.characters]
        .sort((a, b) => (b.stateUpdatedAt ?? "").localeCompare(a.stateUpdatedAt ?? ""))
        .slice(0, 5)
    );

  const characterNames = new Set(characterRows.map(character => character.name));
  const rankedThreads = state.plotThreads
    .map((thread, index) => ({
      thread,
      index,
      score: relevance(source, [thread.title, thread.notes, thread.id]) +
        ((thread.status === "active" || thread.status === "open") ? 2 : 0)
    }))
    .filter(item => item.score > 2 || characterRows.some(character =>
      (character.relationships ?? []).some(relationship => relationship.includes(item.thread.title))
    ))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  // A task that does not name a thread still needs a small amount of immediate
  // story context; use the latest active threads, not the whole backlog.
  const threadRows = (rankedThreads.length
    ? rankedThreads.slice(0, 6)
    : state.plotThreads
        .map((thread, index) => ({ thread, index, score: 0 }))
        .filter(item => item.thread.status === "active" || item.thread.status === "open")
        .slice(-4));

  const threadIds = new Set(threadRows.map(item => item.thread.id));
  const rankedEvents = state.events
    .map((event, index) => ({
      event,
      index,
      score: relevance(source, [event.summary, ...event.participants, ...(event.causes ?? []), ...(event.consequences ?? [])]) +
        (event.participants.some(name => characterNames.has(name)) ? 28 : 0) +
        (event.relatedPlotThreads ?? []).filter(id => threadIds.has(id)).length * 18
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index);
  const eventRows = rankedEvents.length
    ? rankedEvents
    : state.events.slice(-5).map((event, index) => ({ event, index, score: 0 }));
  const eventById = new Map(state.events.map(event => [event.id, event]));
  const threadById = new Map(state.plotThreads.map(thread => [thread.id, thread]));

  const sections = [
    characterRows.length
      ? "## 本章相关人物的当前状态\n" + characterRows.map(renderCharacter).join("\n\n")
      : "",
    eventRows.length
      ? "## 已发生事件及其因果关联\n" + eventRows.map(({ event }) => {
          const parts = [
            event.summary,
            event.causes?.length ? "前因：" + strings(event.causes.map(cause => eventById.get(cause)?.summary ?? cause), 4) : "",
            event.consequences.length ? "后果：" + strings(event.consequences, 4) : "",
            event.relatedPlotThreads?.length ? "关联剧情线：" + strings(event.relatedPlotThreads.map(id => threadById.get(id)?.title ?? id), 4) : "",
            event.origin ? "来源：" + event.origin : ""
          ].filter(Boolean);
          return "- " + parts.join("；");
        }).join("\n")
      : "",
    threadRows.length
      ? "## 当前相关剧情线\n" + threadRows.map(({ thread }) =>
          "- " + thread.title + "（" + thread.status + "）：" + thread.notes
        ).join("\n")
      : ""
  ].filter(Boolean);

  if (!sections.length) return "";
  const header = [
    "以下是当前故事状态中与本次创作任务相关的有限上下文，不是模拟结论。",
    "人物的已知信息表示其知识边界；不得把作者、读者或其他人物掌握的信息自动赋予该人物。",
    "事件及因果关联是已经记录的故事事实；可能的发展仍须由规划和正文决定，不能直接当成已发生事件。",
    "只考虑对本章有价值的人物和局势。主角不介入时世界可以继续变化，但不要求每个角色都行动，也不必为了证明世界在运转而添加支线。"
  ].join("\n");
  const rendered = header + "\n\n" + sections.join("\n\n");
  return rendered.length > maxChars
    ? rendered.slice(0, maxChars) + "\n\n（上下文已按预算裁剪；未列出的信息不代表不存在。）"
    : rendered;
}
