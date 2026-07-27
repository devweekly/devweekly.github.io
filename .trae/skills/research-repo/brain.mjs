// ===========================================================================
// brain.mjs — Global Research Brain
//
// The Brain is a persistent, global knowledge base that accumulates across
// all repository research sessions. It stores abstractions (patterns,
// decisions, tradeoffs, anti-patterns, ontology, concept graph) — NOT code.
//
// Three-layer architecture:
//   Layer 1: Repository Memory  (local, per-repo)  — evidence + report
//   Layer 2: Global Knowledge   (shared)           — patterns/decisions/...
//   Layer 3: Research Brain     (this file)        — query + concept graph
//
// Knowledge Units are JSON objects (not Markdown) so they can be queried,
// merged, and versioned programmatically.
//
//   brain/
//   ├── patterns/{pattern-id}.json
//   ├── decisions/{decision-id}.json
//   ├── tradeoffs/{tradeoff-id}.json
//   ├── anti-patterns/{antipattern-id}.json
//   ├── ontology/{term-id}.json
//   ├── concept-graph.json
//   └── index.json
// ===========================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import {
  BRAIN_DIR,
  KNOWLEDGE_TYPES,
  CONFIDENCE_INCREMENT,
  CONFIDENCE_MAX,
  ESTABLISHED_PATTERN_THRESHOLD,
  CONCEPT_RELATIONS,
} from "./config.mjs";

// ---------------------------------------------------------------------------
// Knowledge Unit validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ["id", "type", "title", "description", "evidence", "confidence"];

/**
 * Validate a Knowledge Unit object.
 * @param {object} unit - Knowledge Unit to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateKnowledgeUnit(unit) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (unit[field] === undefined || unit[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  if (unit.confidence !== undefined) {
    const c = Number(unit.confidence);
    if (Number.isNaN(c) || c < 0 || c > 1) {
      errors.push(`confidence must be 0..1, got: ${unit.confidence}`);
    }
  }
  if (unit.evidence !== undefined && !Array.isArray(unit.evidence)) {
    errors.push("evidence must be an array of repository names");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Create a normalized Knowledge Unit from partial input.
 * @param {object} partial - Partial knowledge unit
 * @returns {object} Complete knowledge unit with defaults filled
 */
export function createKnowledgeUnit(partial) {
  const type = partial.type || "pattern";
  const typeConfig = KNOWLEDGE_TYPES[type] || KNOWLEDGE_TYPES.pattern;
  const slug = partial.title
    ? partial.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : "untitled";
  const id = partial.id || `${typeConfig.idPrefix}.${slug}`;

  return {
    id,
    type,
    title: partial.title || "",
    description: partial.description || "",
    evidence: partial.evidence || [],
    confidence: partial.confidence !== undefined ? partial.confidence : 0.5,
    tradeoffs: partial.tradeoffs || [],
    counterExamples: partial.counterExamples || [],
    observedIn: partial.observedIn || partial.evidence || [],
    firstSeen: partial.firstSeen || new Date().toISOString(),
    lastUpdated: partial.lastUpdated || new Date().toISOString(),
    tags: partial.tags || [],
    ...partial, // allow extra fields (conditions, alternatives, etc.)
  };
}

// ---------------------------------------------------------------------------
// Brain — global knowledge store
// ---------------------------------------------------------------------------

export class Brain {
  /**
   * @param {string} rootDir - Brain root directory (default: BRAIN_DIR)
   */
  constructor(rootDir) {
    this.rootDir = rootDir || BRAIN_DIR;
  }

  // ---- Initialization ----

  /**
   * Initialize the Brain directory structure.
   * Creates subdirectories for each knowledge type + concept-graph.json + index.json.
   * Idempotent — safe to call on an existing brain.
   * @returns {string} brain root path
   */
  init() {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }
    for (const [, config] of Object.entries(KNOWLEDGE_TYPES)) {
      const dir = join(this.rootDir, config.dir);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
    // Initialize concept graph if missing
    const graphPath = join(this.rootDir, "concept-graph.json");
    if (!existsSync(graphPath)) {
      writeFileSync(graphPath, JSON.stringify({ nodes: [], edges: [] }, null, 2));
    }
    // Initialize index if missing
    const indexPath = join(this.rootDir, "index.json");
    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, JSON.stringify({ units: [], updatedAt: new Date().toISOString() }, null, 2));
    }
    return this.rootDir;
  }

  // ---- Path resolution ----

  /**
   * Resolve the file path for a knowledge unit by type and id.
   * @param {string} type - Knowledge type (pattern/decision/tradeoff/anti-pattern/term)
   * @param {string} id - Knowledge unit id
   * @returns {string} absolute file path
   */
  pathFor(type, id) {
    const typeConfig = KNOWLEDGE_TYPES[type];
    if (!typeConfig) {
      throw new Error(`Unknown knowledge type: ${type}. Valid: ${Object.keys(KNOWLEDGE_TYPES).join(", ")}`);
    }
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
    return join(this.rootDir, typeConfig.dir, `${safeId}.json`);
  }

  // ---- CRUD ----

  /**
   * Get a knowledge unit by type and id.
   * @returns {object|null} knowledge unit or null if not found
   */
  get(type, id) {
    const path = this.pathFor(type, id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  /**
   * Save a knowledge unit (create or overwrite).
   * @param {object} unit - Knowledge unit to save
   * @returns {object} saved unit
   */
  save(unit) {
    const { valid, errors } = validateKnowledgeUnit(unit);
    if (!valid) {
      throw new Error(`Invalid knowledge unit: ${errors.join("; ")}`);
    }
    unit.lastUpdated = new Date().toISOString();
    const path = this.pathFor(unit.type, unit.id);
    writeFileSync(path, JSON.stringify(unit, null, 2));
    this._rebuildIndex();
    return unit;
  }

  /**
   * Add a new knowledge unit, or merge with existing if similar id found.
   * When merging: increment confidence, add new evidence, update description.
   * @param {object} unit - Knowledge unit to add
   * @param {string} repoName - Repository name where this was observed
   * @returns {{ unit: object, action: "created"|"merged" }}
   */
  addOrUpdate(unit, repoName) {
    const normalized = createKnowledgeUnit(unit);
    const existing = this.get(normalized.type, normalized.id);

    if (existing) {
      // Merge: strengthen existing pattern with new observation
      const merged = this._merge(existing, normalized, repoName);
      this.save(merged);
      return { unit: merged, action: "merged" };
    }

    // New knowledge unit
    if (repoName && !normalized.evidence.includes(repoName)) {
      normalized.evidence.push(repoName);
      normalized.observedIn = normalized.evidence;
    }
    this.save(normalized);
    return { unit: normalized, action: "created" };
  }

  /**
   * Merge a new observation into an existing knowledge unit.
   * - Add repo to evidence list if not already present
   * - Increment confidence (diminishing returns)
   * - Keep the longer description
   * - Union the tradeoffs and counterExamples
   * @private
   */
  _merge(existing, incoming, repoName) {
    const merged = { ...existing };

    // Add repository to evidence list
    if (repoName && !merged.evidence.includes(repoName)) {
      merged.evidence.push(repoName);
    }
    merged.observedIn = merged.evidence;

    // Increment confidence with diminishing returns
    // Each new observation adds less confidence than the previous
    const observationCount = merged.evidence.length;
    const increment = CONFIDENCE_INCREMENT * (1 - merged.confidence);
    merged.confidence = Math.min(CONFIDENCE_MAX, merged.confidence + increment);

    // Keep longer description (more informative)
    if ((incoming.description || "").length > (merged.description || "").length) {
      merged.description = incoming.description;
    }

    // Union tradeoffs and counterExamples
    for (const field of ["tradeoffs", "counterExamples", "tags"]) {
      const existingSet = new Set(merged[field] || []);
      for (const item of incoming[field] || []) {
        existingSet.add(item);
      }
      merged[field] = [...existingSet];
    }

    // Merge any extra fields from incoming
    for (const [key, value] of Object.entries(incoming)) {
      if (REQUIRED_FIELDS.includes(key) || ["tradeoffs", "counterExamples", "tags"].includes(key)) continue;
      if (merged[key] === undefined && value !== undefined) {
        merged[key] = value;
      }
    }

    merged.lastUpdated = new Date().toISOString();
    return merged;
  }

  // ---- Querying ----

  /**
   * List all knowledge units of a given type.
   * @param {string} type - Knowledge type
   * @returns {object[]} array of knowledge units
   */
  list(type) {
    const typeConfig = KNOWLEDGE_TYPES[type];
    if (!typeConfig) {
      throw new Error(`Unknown knowledge type: ${type}`);
    }
    const dir = join(this.rootDir, typeConfig.dir);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
  }

  /**
   * List all knowledge units across all types.
   * @returns {object[]} all knowledge units
   */
  listAll() {
    const all = [];
    for (const type of Object.keys(KNOWLEDGE_TYPES)) {
      all.push(...this.list(type));
    }
    return all;
  }

  /**
   * Query knowledge units by type and optional filter.
   * @param {string} type - Knowledge type (or "all")
   * @param {object} [filter] - Optional filter { tag, repo, minConfidence, titleContains }
   * @returns {object[]} matching knowledge units
   */
  query(type, filter = {}) {
    const units = type === "all" ? this.listAll() : this.list(type);
    return units.filter((u) => {
      if (filter.tag && !(u.tags || []).includes(filter.tag)) return false;
      if (filter.repo && !(u.evidence || []).includes(filter.repo)) return false;
      if (filter.minConfidence !== undefined && (u.confidence || 0) < filter.minConfidence) return false;
      if (filter.titleContains) {
        const title = (u.title || "").toLowerCase();
        if (!title.includes(filter.titleContains.toLowerCase())) return false;
      }
      return true;
    });
  }

  /**
   * Find knowledge units similar to a given title/description.
   * Simple keyword-overlap similarity (no embeddings — keeps the script layer
   * deterministic and dependency-free; LLM handles semantic matching).
   * @param {string} type - Knowledge type
   * @param {string} title - Title to match against
   * @returns {{ unit: object, score: number }[]} ranked matches
   */
  findSimilar(type, title) {
    const units = this.list(type);
    const titleTokens = new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const scored = units.map((u) => {
      const unitTokens = new Set((u.title + " " + (u.description || "")).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      let overlap = 0;
      for (const t of titleTokens) {
        if (unitTokens.has(t)) overlap++;
      }
      const score = titleTokens.size > 0 ? overlap / titleTokens.size : 0;
      return { unit: u, score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  }

  // ---- Established patterns (high-confidence, multi-repo) ----

  /**
   * Get established patterns — observed in ≥ ESTABLISHED_PATTERN_THRESHOLD repos.
   * These are the patterns the Brain "already knows" and should not be
   * re-discovered from scratch when studying a new repository.
   * @returns {object[]} established patterns
   */
  getEstablishedPatterns() {
    return this.list("pattern").filter(
      (p) => (p.evidence || []).length >= ESTABLISHED_PATTERN_THRESHOLD
    );
  }

  // ---- Concept Graph ----

  /**
   * Get the concept graph (nodes + edges).
   * @returns {{ nodes: object[], edges: object[] }}
   */
  getConceptGraph() {
    const graphPath = join(this.rootDir, "concept-graph.json");
    if (!existsSync(graphPath)) return { nodes: [], edges: [] };
    return JSON.parse(readFileSync(graphPath, "utf-8"));
  }

  /**
   * Add a relationship to the concept graph.
   * @param {object} edge - { source, relation, target, evidence? }
   * @returns {object} the concept graph
   */
  addConceptEdge(edge) {
    if (!CONCEPT_RELATIONS.includes(edge.relation)) {
      throw new Error(`Unknown relation: ${edge.relation}. Valid: ${CONCEPT_RELATIONS.join(", ")}`);
    }
    const graph = this.getConceptGraph();
    // Add nodes if missing
    for (const nodeId of [edge.source, edge.target]) {
      if (!graph.nodes.find((n) => n.id === nodeId)) {
        graph.nodes.push({ id: nodeId });
      }
    }
    // Add edge if not duplicate
    const exists = graph.edges.find(
      (e) => e.source === edge.source && e.relation === edge.relation && e.target === edge.target
    );
    if (!exists) {
      graph.edges.push({
        source: edge.source,
        relation: edge.relation,
        target: edge.target,
        evidence: edge.evidence || [],
        addedAt: new Date().toISOString(),
      });
    }
    writeFileSync(join(this.rootDir, "concept-graph.json"), JSON.stringify(graph, null, 2));
    return graph;
  }

  /**
   * Add multiple concept edges at once.
   * @param {object[]} edges
   */
  addConceptEdges(edges) {
    for (const edge of edges) {
      this.addConceptEdge(edge);
    }
  }

  // ---- Summary / Stats ----

  /**
   * Get a summary of the Brain's contents.
   * @returns {object} { counts: {...}, totalUnits, establishedPatterns, topPatterns }
   */
  summary() {
    const counts = {};
    let totalUnits = 0;
    for (const type of Object.keys(KNOWLEDGE_TYPES)) {
      const list = this.list(type);
      counts[type] = list.length;
      totalUnits += list.length;
    }
    const established = this.getEstablishedPatterns();
    const topPatterns = this.list("pattern")
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 10);
    const graph = this.getConceptGraph();
    return {
      counts,
      totalUnits,
      establishedPatterns: established.length,
      conceptGraphNodes: graph.nodes.length,
      conceptGraphEdges: graph.edges.length,
      topPatterns: topPatterns.map((p) => ({
        id: p.id,
        title: p.title,
        confidence: p.confidence,
        observedIn: (p.evidence || []).length,
      })),
    };
  }

  // ---- Index management ----

  /**
   * Rebuild the index.json file from the current knowledge units.
   * @private
   */
  _rebuildIndex() {
    const units = this.listAll().map((u) => ({
      id: u.id,
      type: u.type,
      title: u.title,
      confidence: u.confidence,
      evidenceCount: (u.evidence || []).length,
    }));
    const index = { units, updatedAt: new Date().toISOString() };
    writeFileSync(join(this.rootDir, "index.json"), JSON.stringify(index, null, 2));
  }

  // ---- Export for Question Planner ----

  /**
   * Export a Brain Brief — a compact summary for the Question Planner to read
   * before generating research questions. This is what makes research
   * "Brain-first": the planner knows what patterns already exist and focuses
   * questions on novelty rather than re-discovering known patterns.
   * @returns {object} { establishedPatterns, recentDecisions, vocabulary, conceptGraphSummary }
   */
  exportBrief() {
    const established = this.getEstablishedPatterns();
    const decisions = this.list("decision").slice(0, 20);
    const terms = this.list("term");
    const antiPatterns = this.list("anti-pattern");
    const graph = this.getConceptGraph();
    return {
      establishedPatterns: established.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        confidence: p.confidence,
        observedIn: p.evidence || [],
        counterExamples: p.counterExamples || [],
      })),
      recentDecisions: decisions.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
        observedIn: d.evidence || [],
      })),
      vocabulary: terms.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
      })),
      antiPatterns: antiPatterns.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        observedIn: a.evidence || [],
      })),
      conceptGraphSummary: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        relations: CONCEPT_RELATIONS,
      },
    };
  }
}
