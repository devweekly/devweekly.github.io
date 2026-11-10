// World Situation 确定性上下文构建器：不是模拟器，也不是持久层。按任务词面挑相关人物/
// 事件/情节线（无命中时仅回退少量最近记录），把记录展开成可读上下文；真正的局势推演
// 由既有主线规划阶段完成。未知引用保持原样，不编造关系，不把推测写进 Story State。
import type { StoryState } from "./story-state.js";
import {
  WORLD_SITUATION_ACTIVE_THREAD_BONUS,
  WORLD_SITUATION_CHARACTER_LIMIT,
  WORLD_SITUATION_EVENT_LIMIT,
  WORLD_SITUATION_FALLBACK_CHARACTERS,
  WORLD_SITUATION_FALLBACK_EVENTS,
  WORLD_SITUATION_FALLBACK_THREADS,
  WORLD_SITUATION_FIELD_CONTRADICTIONS_LIMIT,
  WORLD_SITUATION_FIELD_DEFAULT_LIMIT,
  WORLD_SITUATION_FIELD_KNOWLEDGE_LIMIT,
  WORLD_SITUATION_FIELD_RELATIONS_LIMIT,
  WORLD_SITUATION_MAX_CHARS,
  WORLD_SITUATION_NAME_HIT_SCORE,
  WORLD_SITUATION_PARTICIPANT_BONUS,
  RECENT_EVENT_CONTEXT_LIMIT,
  RECENT_EVENT_CONTEXT_MAX_CHARS,
  WORLD_SITUATION_THREAD_LIMIT,
  WORLD_SITUATION_THREAD_LINK_BONUS
} from "./constants.js";

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
    if (normalized.length > 1 && queryCompact.includes(normalized)) score += WORLD_SITUATION_NAME_HIT_SCORE;
    for (const term of terms(value)) {
      if (queryTerms.has(term)) score += term.length > 2 ? 2 : 1;
    }
  }
  return score;
}

function strings(values: string[] | undefined, limit: number): string {
  return (values ?? []).filter(Boolean).slice(0, limit).join("；");
}

/**
 * A compact chronological reminder for planners. This is deliberately advisory:
 * repeated events are discouraged, but meaningful callbacks and reinterpretations
 * remain valid narrative choices.
 */
export function buildRecentEventContinuityContext(
  state: StoryState,
  limit = RECENT_EVENT_CONTEXT_LIMIT,
  maxChars = RECENT_EVENT_CONTEXT_MAX_CHARS
): string {
  const count = Math.max(0, Math.min(RECENT_EVENT_CONTEXT_LIMIT, Math.floor(limit)));
  const budget = Math.max(0, Math.min(RECENT_EVENT_CONTEXT_MAX_CHARS, Math.floor(maxChars)));
  if (!count || !budget || !state.events.length) return "";
  const recent = state.events.slice(-count);
  const eventLines = recent.map(event => {
    const details = [
      event.position,
      event.summary,
      event.consequences.length ? "后果：" + strings(event.consequences, 2) : ""
    ].filter(Boolean);
    return "- " + details.join("；");
  });
  const guidance = [
    "规划时先对照这些已发生事件，避免只换人物、地点或措辞，却再次安排相同的发现、解释、冲突和解决过程。",
    "旧事件可以再次产生作用，但应带来新的信息、意义、代价、关系变化或局势后果；揭示旧误解、改变人物对往事的理解、让旧选择产生新后果，都属于有效呼应。",
    "不要为了去重而禁止伏笔回响、冲突升级或人物反复面对同一问题；也不要求每章必须引入新事件。"
  ];
  const rendered = [
    "## 最近已发生的事件（按 Story State 记录顺序）",
    ...eventLines,
    "## 重复情节与有效呼应",
    ...guidance
  ].join("\n");
  if (rendered.length <= budget) return rendered;
  const suffix = "\n（近期事件摘要已按预算截断。）";
  if (budget <= suffix.length) return rendered.slice(0, budget);
  return rendered.slice(0, budget - suffix.length) + suffix;
}

function renderCharacter(character: Character): string {
  const rows = [
    character.status ? "当前处境：" + character.status : "",
    character.location ? "位置：" + character.location : "",
    character.goals?.length ? "目标：" + strings(character.goals, WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
    character.motivation ? "动机：" + character.motivation : "",
    character.knowledge?.length ? "已知信息：" + strings(character.knowledge, WORLD_SITUATION_FIELD_KNOWLEDGE_LIMIT) : "",
    character.resources?.length ? "可用资源：" + strings(character.resources, WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
    character.constraints?.length ? "行动限制：" + strings(character.constraints, WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
    character.currentPressure?.length ? "当前压力：" + strings(character.currentPressure, WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
    character.relationships?.length ? "关系：" + strings(character.relationships, WORLD_SITUATION_FIELD_RELATIONS_LIMIT) : "",
    character.decisionHistory?.length ? "近期重要决定：" + strings(character.decisionHistory.slice(-WORLD_SITUATION_FIELD_DEFAULT_LIMIT), WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
    character.profile?.contradictions?.length ? "内在矛盾：" + strings(character.profile.contradictions, WORLD_SITUATION_FIELD_CONTRADICTIONS_LIMIT) : ""
  ].filter(Boolean);
  return "### " + character.name + "\n" + rows.join("\n");
}

/**
 * Build a small, task-oriented view of canonical writing state for chapter planning.
 * It supplies facts and constraints; the planner itself decides whether any
 * independent action or off-screen development is narratively useful.
 */
export function buildWorldSituationContext(state: StoryState, query: string, maxChars = WORLD_SITUATION_MAX_CHARS): string {
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
    .slice(0, WORLD_SITUATION_CHARACTER_LIMIT);

  // If the request names no character, retain only the most recently updated
  // profiles. Do not turn an underspecified brief into a cast-wide simulation.
  const characterRows = (selectedCharacters.length
    ? selectedCharacters.map(item => item.character)
    : [...state.characters]
        .sort((a, b) => (b.stateUpdatedAt ?? "").localeCompare(a.stateUpdatedAt ?? ""))
        .slice(0, WORLD_SITUATION_FALLBACK_CHARACTERS)
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
    ? rankedThreads.slice(0, WORLD_SITUATION_THREAD_LIMIT)
    : state.plotThreads
        .map((thread, index) => ({ thread, index, score: 0 }))
        .filter(item => item.thread.status === "active" || item.thread.status === "open")
        .slice(-WORLD_SITUATION_FALLBACK_THREADS));

  const threadIds = new Set(threadRows.map(item => item.thread.id));
  const rankedEvents = state.events
    .map((event, index) => ({
      event,
      index,
      score: relevance(source, [event.summary, ...event.participants, ...(event.causes ?? []), ...(event.consequences ?? [])]) +
        (event.participants.some(name => characterNames.has(name)) ? WORLD_SITUATION_PARTICIPANT_BONUS : 0) +
        (event.relatedPlotThreads ?? []).filter(id => threadIds.has(id)).length * WORLD_SITUATION_THREAD_LINK_BONUS
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, WORLD_SITUATION_EVENT_LIMIT)
    .sort((a, b) => a.index - b.index);
  const eventRows = rankedEvents.length
    ? rankedEvents
    : state.events.slice(-WORLD_SITUATION_FALLBACK_EVENTS).map((event, index) => ({ event, index, score: 0 }));
  const eventById = new Map(state.events.map(event => [event.id, event]));
  const threadById = new Map(state.plotThreads.map(thread => [thread.id, thread]));

  const latestByKey = <T,>(items: T[], key: (item: T) => string): T[] => {
    const latest = new Map<string, T>();
    for (const item of items) latest.set(key(item), item);
    return [...latest.values()];
  };
  const latestClues = latestByKey(state.foreshadowingUpdates ?? [], item => item.clueId)
    .map(item => ({ item, score: relevance(source, [item.clue, item.change, item.status]) }))
    .filter(row => row.score > 0 && !["resolved", "abandoned"].includes(row.item.status))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  const latestMacguffins = latestByKey(state.macguffinUpdates ?? [], item => item.macguffinId)
    .map(item => ({ item, score: relevance(source, [item.name, item.change, item.holder ?? "", item.location ?? "", item.status]) }))
    .filter(row => row.score > 0 && !["destroyed", "irrelevant"].includes(row.item.status))
    .sort((a, b) => b.score - a.score).slice(0, 4);
  const latestRelationships = latestByKey(state.relationshipUpdates ?? [], item => item.relationId)
    .map(item => ({ item, score: relevance(source, [item.from, item.to, item.label, item.change]) }))
    .filter(row => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

  const sections = [
    latestClues.length
      ? "## 本章相关伏笔的最新状态（只记录正文有证据的变化）\n" + latestClues.map(({ item }) =>
          "- " + item.clue + "（" + item.status + "，" + item.chapter + "）：" + item.change + "；证据：" + item.evidence
        ).join("\n")
      : "",
    latestMacguffins.length
      ? "## 本章相关关键目标/物件/信息的最新状态\n" + latestMacguffins.map(({ item }) =>
          "- " + item.name + "（" + item.status + "，" + item.chapter + "）：" + item.change +
          (item.holder ? "；持有者：" + item.holder : "") + (item.location ? "；位置：" + item.location : "") +
          "；证据：" + item.evidence
        ).join("\n")
      : "",
    latestRelationships.length
      ? "## 本章相关人物关系的最新变化\n" + latestRelationships.map(({ item }) =>
          "- " + item.from + " —" + item.label + "→ " + item.to + "（" + item.chapter + "）：" + item.change + "；证据：" + item.evidence
        ).join("\n")
      : "",
    characterRows.length
      ? "## 本章相关人物的当前状态\n" + characterRows.map(renderCharacter).join("\n\n")
      : "",
    eventRows.length
      ? "## 已发生事件及其因果关联\n" + eventRows.map(({ event }) => {
          const parts = [
            event.summary,
            event.causes?.length ? "前因：" + strings(event.causes.map(cause => eventById.get(cause)?.summary ?? cause), WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
            event.consequences.length ? "后果：" + strings(event.consequences, WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
            event.relatedPlotThreads?.length ? "关联剧情线：" + strings(event.relatedPlotThreads.map(id => threadById.get(id)?.title ?? id), WORLD_SITUATION_FIELD_DEFAULT_LIMIT) : "",
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
    "事件及因果关联是已经记录的故事事实；可能的发展仍须由规划和正文决定，不能直接当成已发生事件。伏笔和 MacGuffin 只提供最近一次有正文证据的状态，不代表必须在本章推进或回收。",
    "只考虑对本章有价值的人物和局势。主角不介入时世界可以继续变化，但不要求每个角色都行动，也不必为了证明世界在运转而添加支线。"
  ].join("\n");
  const rendered = header + "\n\n" + sections.join("\n\n");
  return rendered.length > maxChars
    ? rendered.slice(0, maxChars) + "\n\n（上下文已按预算裁剪；未列出的信息不代表不存在。）"
    : rendered;
}
