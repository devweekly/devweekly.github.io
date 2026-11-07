// 从 Story State 的稳定 ID 与显式引用派生续写图谱：不做模糊实体合并，未解析的引用保持原样。
// 边只表达关系/参与/因果等显式声明；布局仅用于导航展示，不代表语义强度或重要性排序。
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

export interface GraphSlice<TNode, TEdge> {
  totalNodes: number;
  totalEdges: number;
  matchedNodes: number;
  returnedNodes: number;
  returnedEdges: number;
  truncated: boolean;
  nodes: TNode[];
  edges: TEdge[];
}

/** Generic graph query: matching nodes plus exactly one hop of explicit adjacency. */
export function filterGraph<TNode extends { id: string }, TEdge extends { from: string; to: string }>(
  graph: { nodes: TNode[]; edges: TEdge[] }, query = "", limit = 500
): GraphSlice<TNode, TEdge> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error("Graph limit must be between 1 and 5000.");
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (node: TNode): boolean => !normalized || (JSON.stringify(node) ?? "").toLocaleLowerCase().includes(normalized);
  const direct = normalized ? graph.nodes.filter(matches) : graph.nodes;
  const seeds = new Set(direct.map(node => node.id));
  const selected = new Set(seeds);
  if (normalized) {
    for (const edge of graph.edges) {
      if (seeds.has(edge.from)) selected.add(edge.to);
      if (seeds.has(edge.to)) selected.add(edge.from);
    }
  }
  const candidateNodes = graph.nodes.filter(node => selected.has(node.id));
  const nodes = candidateNodes.slice(0, limit);
  const nodeIds = new Set(nodes.map(node => node.id));
  const candidateEdges = graph.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const edges = candidateEdges.slice(0, limit * 4);
  return {
    totalNodes: graph.nodes.length, totalEdges: graph.edges.length, matchedNodes: direct.length,
    returnedNodes: nodes.length, returnedEdges: edges.length,
    truncated: nodes.length < candidateNodes.length || edges.length < candidateEdges.length,
    nodes, edges
  };
}

/** Query a derived sequel graph with the same bounded one-hop semantics. */
export function filterStoryStateGraph(graph: StoryStateGraph, query = "", limit = 500): GraphSlice<StoryStateGraphNode, StoryStateGraphEdge> {
  return filterGraph(graph, query, limit);
}
