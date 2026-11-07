import type { StoryState } from "./story-state.js";

export interface StoryStateGraphNode {
  id: string;
  type: "character" | "event" | "plot-thread" | "foreshadowing" | "macguffin";
  label: string;
  data: Record<string, unknown>;
}
export interface StoryStateGraphEdge {
  id: string;
  from: string;
  to: string;
  type: "relationship" | "participates" | "causes" | "related-thread" | "foreshadowing-thread" | "macguffin-thread";
  label: string;
  data: Record<string, unknown>;
}
export interface StoryStateGraph {
  nodes: StoryStateGraphNode[];
  edges: StoryStateGraphEdge[];
}

/**
 * Build a graph projection from persisted Story State. IDs and explicit references
 * are the only join keys; this deliberately performs no fuzzy entity resolution.
 */
export function buildStoryStateGraph(state: StoryState): StoryStateGraph {
  const nodes = new Map<string, StoryStateGraphNode>();
  const edges = new Map<string, StoryStateGraphEdge>();
  const addNode = (node: StoryStateGraphNode): void => {
    const previous = nodes.get(node.id);
    if (!previous) { nodes.set(node.id, node); return; }
    const data = { ...previous.data, ...node.data };
    if (node.type === "character" && (node.data.status !== undefined || node.data.profile !== undefined)) {
      delete data.observedInEventsOnly;
      delete data.observedInRelationshipsOnly;
    }
    nodes.set(node.id, { ...previous, ...node, data });
  };
  const addEdge = (edge: StoryStateGraphEdge): void => { edges.set(edge.id, edge); };
  const characterId = (name: string): string => "character:" + name;
  const threadId = (id: string): string => "thread:" + id;
  const eventId = (id: string): string => "event:" + id;

  for (const character of state.characters) {
    addNode({
      id: characterId(character.name), type: "character", label: character.name,
      data: { status: character.status, location: character.location, profile: character.profile, arcMilestones: character.arcMilestones ?? [] }
    });
  }
  for (const thread of state.plotThreads) {
    addNode({ id: threadId(thread.id), type: "plot-thread", label: thread.title, data: { status: thread.status, notes: thread.notes, lastUpdated: thread.lastUpdated } });
  }
  for (const event of state.events) {
    addNode({ id: eventId(event.id), type: "event", label: event.summary, data: { position: event.position, origin: event.origin, consequences: event.consequences } });
    for (const participant of event.participants) {
      const id = characterId(participant);
      if (!nodes.has(id)) addNode({ id, type: "character", label: participant, data: { observedInEventsOnly: true } });
      addEdge({ id: "participates:" + event.id + ":" + participant, from: eventId(event.id), to: id, type: "participates", label: "参与", data: { position: event.position } });
    }
    for (const cause of event.causes ?? []) {
      if (state.events.some(candidate => candidate.id === cause)) {
        addEdge({ id: "causes:" + event.id + ":" + cause, from: eventId(cause), to: eventId(event.id), type: "causes", label: "导致", data: {} });
      }
    }
    for (const relatedId of event.relatedPlotThreads ?? []) {
      const thread = state.plotThreads.find(item => item.id === relatedId);
      if (!nodes.has(threadId(relatedId))) addNode({ id: threadId(relatedId), type: "plot-thread", label: thread?.title ?? relatedId, data: thread ? { status: thread.status } : { unresolvedReference: true } });
      addEdge({ id: "event-thread:" + event.id + ":" + relatedId, from: eventId(event.id), to: threadId(relatedId), type: "related-thread", label: "关联剧情线", data: {} });
    }
  }

  const latestByKey = <T,>(items: T[], key: (item: T) => string): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const id = key(item);
      grouped.set(id, [...(grouped.get(id) ?? []), item]);
    }
    return grouped;
  };

  for (const [clueId, history] of latestByKey(state.foreshadowingUpdates ?? [], item => item.clueId)) {
    const latest = history[history.length - 1]!;
    const id = "foreshadowing:" + clueId;
    addNode({ id, type: "foreshadowing", label: latest.clue, data: { status: latest.status, chapter: latest.chapter, change: latest.change, history } });
    for (const relatedId of latest.relatedThreadIds) {
      if (!nodes.has(threadId(relatedId))) addNode({ id: threadId(relatedId), type: "plot-thread", label: relatedId, data: { unresolvedReference: true } });
      addEdge({ id: "clue-thread:" + clueId + ":" + relatedId, from: id, to: threadId(relatedId), type: "foreshadowing-thread", label: "关联剧情线", data: {} });
    }
  }

  for (const [macguffinId, history] of latestByKey(state.macguffinUpdates ?? [], item => item.macguffinId)) {
    const latest = history[history.length - 1]!;
    const id = "macguffin:" + macguffinId;
    addNode({ id, type: "macguffin", label: latest.name, data: { status: latest.status, chapter: latest.chapter, change: latest.change, holder: latest.holder, location: latest.location, history } });
    for (const relatedId of latest.relatedThreadIds) {
      if (!nodes.has(threadId(relatedId))) addNode({ id: threadId(relatedId), type: "plot-thread", label: relatedId, data: { unresolvedReference: true } });
      addEdge({ id: "macguffin-thread:" + macguffinId + ":" + relatedId, from: id, to: threadId(relatedId), type: "macguffin-thread", label: "推动剧情线", data: {} });
    }
  }

  for (const [relationId, history] of latestByKey(state.relationshipUpdates ?? [], item => item.relationId)) {
    const latest = history[history.length - 1]!;
    const from = characterId(latest.from);
    const to = characterId(latest.to);
    if (!nodes.has(from)) addNode({ id: from, type: "character", label: latest.from, data: { observedInRelationshipsOnly: true } });
    if (!nodes.has(to)) addNode({ id: to, type: "character", label: latest.to, data: { observedInRelationshipsOnly: true } });
    addEdge({
      id: "relationship:" + relationId, from, to, type: "relationship", label: latest.label,
      data: { chapter: latest.chapter, change: latest.change, history }
    });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
