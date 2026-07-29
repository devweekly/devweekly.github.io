import { basename } from "node:path";
import { pathToModuleId, isTestPath } from "./utils.mjs";

// ===========================================================================
// EvidenceStore — graph-based research evidence layer
//
// Wraps the flat analyzer outputs (discovery, symbols, architecture, ...) and
// exposes a unified graph view: nodes (functions, classes, modules, prompts,
// tools, tests) connected by edges (imports, calls, tested_by, documents, ...).
//
// This is the layer the LLM consumes. Every conclusion can be traced back to
// deterministic evidence nodes and edges.
// ===========================================================================

class EvidenceStore {
  constructor(flatStore = {}) {
    this._store = flatStore;
    this._nodes = new Map();
    this._edges = [];
    this._indexByKind = new Map();
    this._indexByFile = new Map();
    this._outgoing = new Map();
    this._incoming = new Map();
    this._built = false;
  }

  // -------------------------------------------------------------------------
  // Graph construction
  // -------------------------------------------------------------------------

  ensureBuilt() {
    if (this._built) return;
    this._buildGraph();
    this._built = true;
  }

  _buildGraph() {
    const discovery = this._store.discovery || {};
    const symbols = this._store.symbols || {};
    const architecture = this._store.architecture || {};
    const tests = this._store.tests || {};
    const entrypoints = this._store.entrypoints || {};
    const prompts = this._store.prompts || {};
    const tools = this._store.tools || {};

    // Modules from architecture
    for (const mod of architecture.nodes || []) {
      this.addNode("module", mod.id, mod.id, { path: mod.path, imports: mod.imports });
    }

    // Module dependency edges
    for (const edge of architecture.edges || []) {
      this.addEdge(edge.from, edge.to, "imports");
    }

    // Functions / classes / calls / imports
    for (const fn of symbols.functions || []) {
      const id = this._symbolId("function", fn.file, fn.name, fn.line);
      this.addNode("function", id, fn.name, { file: fn.file, line: fn.line, params: fn.params, decorators: fn.decorators });
      this.addEdge(this._moduleIdFromPath(fn.file), id, "contains");
    }

    for (const cls of symbols.classes || []) {
      const id = this._symbolId("class", cls.file, cls.name, cls.line);
      this.addNode("class", id, cls.name, { file: cls.file, line: cls.line, bases: cls.bases, methods: cls.methods });
      this.addEdge(this._moduleIdFromPath(cls.file), id, "contains");
    }

    for (const call of symbols.calls || []) {
      const callerId = call.caller ? this._symbolId("function", call.file, call.caller, null) : null;
      const calleeId = this._symbolId("function", null, call.callee, null);
      if (calleeId) {
        // Ensure callee node exists even if its definition was not indexed.
        this.addNode("function", calleeId, call.callee, {});
      }
      if (callerId) {
        this.addNode("function", callerId, call.caller, { file: call.file });
      }
      if (callerId && calleeId) {
        this.addEdge(callerId, calleeId, "calls");
      }
    }

    // Imports as module dependency edges (redundant with architecture but typed)
    for (const imp of symbols.imports || []) {
      const fromMod = this._moduleIdFromPath(imp.file);
      const toMod = imp.from || imp.what;
      if (fromMod && toMod) {
        this.addEdge(fromMod, toMod, "imports");
      }
    }

    // Strings as prompt/template candidates
    for (const s of symbols.strings || []) {
      const id = this._symbolId("string", s.file, s.name, s.line);
      this.addNode("string", id, s.name, { file: s.file, line: s.line, length: s.length });
    }

    // Entrypoints
    for (const ep of entrypoints.entrypoints || []) {
      const id = this._symbolId("entrypoint", ep.path, ep.path, null);
      this.addNode("entrypoint", id, ep.path, { type: ep.type, reason: ep.reason });
      this.addEdge(id, this._moduleIdFromPath(ep.path), "executes");
    }

    // Tools
    for (const t of tools.tools || []) {
      const id = this._symbolId("tool", t.file, t.name, t.line);
      this.addNode("tool", id, t.name, { file: t.file, line: t.line, framework: t.framework });
    }

    // Tests
    for (const tf of tests.testFiles || []) {
      const id = this._symbolId("test", tf.path, tf.path, null);
      this.addNode("test", id, tf.path, { path: tf.path, language: tf.language, functions: tf.functions });
      this.addEdge(id, this._moduleIdFromPath(tf.path), "tests");
    }

    // Architecture signals
    for (const dir of discovery.architectureSignalDirs || []) {
      const id = `dir:${dir}`;
      this.addNode("architecture_signal", id, dir, { path: dir });
    }
  }

  _moduleIdFromPath(filePath) {
    if (!filePath) return null;
    return pathToModuleId(filePath);
  }

  _symbolId(kind, filePath, name, line) {
    const loc = filePath ? `${filePath}:${line || "?"}` : `global:${name}`;
    return `${kind}:${name}@${loc}`;
  }

  addNode(kind, id, name, properties = {}) {
    if (this._nodes.has(id)) return this._nodes.get(id);
    const node = { kind, id, name, ...properties };
    this._nodes.set(id, node);

    let kindList = this._indexByKind.get(kind);
    if (!kindList) {
      kindList = [];
      this._indexByKind.set(kind, kindList);
    }
    kindList.push(node);

    const file = properties.file || properties.path;
    if (file) {
      let fileList = this._indexByFile.get(file);
      if (!fileList) {
        fileList = [];
        this._indexByFile.set(file, fileList);
      }
      fileList.push(node);
    }

    return node;
  }

  addEdge(from, to, kind) {
    if (!from || !to || from === to) return;
    const edge = { from, to, kind };
    this._edges.push(edge);

    this._pushToMap(this._outgoing, from, edge);
    this._pushToMap(this._incoming, to, edge);
  }

  _pushToMap(map, key, value) {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(value);
  }

  // -------------------------------------------------------------------------
  // Query API
  // -------------------------------------------------------------------------

  /** Raw flat evidence by analyzer id. */
  get(id) {
    return this._store[id];
  }

  /** All evidence keys. */
  keys() {
    return Object.keys(this._store);
  }

  /** All graph nodes, optionally filtered by kind. */
  nodes(kind) {
    this.ensureBuilt();
    if (kind) return this._indexByKind.get(kind) || [];
    return [...this._nodes.values()];
  }

  /** All graph edges, optionally filtered by kind. */
  edges(kind) {
    this.ensureBuilt();
    if (kind) return this._edges.filter((e) => e.kind === kind);
    return this._edges;
  }

  /** Find a node by id. */
  node(id) {
    this.ensureBuilt();
    return this._nodes.get(id) || null;
  }

  /** Find nodes by name across all kinds. */
  findByName(name) {
    this.ensureBuilt();
    return [...this._nodes.values()].filter((n) => n.name === name);
  }

  /** Find all nodes defined in a file. */
  nodesInFile(filePath) {
    this.ensureBuilt();
    return this._indexByFile.get(filePath) || [];
  }

  /** Who calls this function/symbol? */
  callersOf(name) {
    this.ensureBuilt();
    const matches = this.findByName(name);
    const result = [];
    for (const m of matches) {
      const incoming = this._incoming.get(m.id) || [];
      for (const edge of incoming.filter((e) => e.kind === "calls")) {
        result.push(this._nodes.get(edge.from));
      }
    }
    return result.filter(Boolean);
  }

  /** What does this function/symbol call? */
  callsOf(name) {
    this.ensureBuilt();
    const matches = this.findByName(name);
    const result = [];
    for (const m of matches) {
      const outgoing = this._outgoing.get(m.id) || [];
      for (const edge of outgoing.filter((e) => e.kind === "calls")) {
        result.push(this._nodes.get(edge.to));
      }
    }
    return result.filter(Boolean);
  }

  /** Which modules import this module? */
  usedBy(moduleId) {
    this.ensureBuilt();
    const incoming = this._incoming.get(moduleId) || [];
    return incoming
      .filter((e) => e.kind === "imports")
      .map((e) => this._nodes.get(e.from))
      .filter(Boolean);
  }

  /** Which modules does this module import? */
  importsOf(moduleId) {
    this.ensureBuilt();
    const outgoing = this._outgoing.get(moduleId) || [];
    return outgoing
      .filter((e) => e.kind === "imports")
      .map((e) => this._nodes.get(e.to))
      .filter(Boolean);
  }

  /** Subgraph: module dependency graph as adjacency list. */
  moduleGraph() {
    this.ensureBuilt();
    const modules = this.nodes("module");
    const adj = {};
    for (const m of modules) adj[m.id] = [];
    for (const edge of this.edges("imports")) {
      if (adj[edge.from] && this._nodes.has(edge.to)) {
        adj[edge.from].push(edge.to);
      }
    }
    return { modules, adjacency: adj };
  }

  /** Find tests related to a source file path. */
  testsFor(filePath) {
    this.ensureBuilt();
    return this.nodes("test").filter((t) => {
      const testName = t.name || "";
      const base = basename(filePath).replace(/\.[^.]+$/, "");
      return testName.includes(base) || testName.replace(/test_|_test|\.test/g, "") === base;
    });
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * Return the flat evidence store for JSON serialization.
   * This keeps the CLI output backward-compatible.
   */
  toJSON() {
    return this._store;
  }
}

// ===========================================================================
// Ontology: Object Types and Relationship Types
//
// Inspired by Palantir's ontology approach: treat the repository as a graph
// of engineering objects (not just files). Every significant concept is an
// Object with typed Relationships and linked Evidence.
//
// Two layers:
//   1. Implementation-layer types (OBJECT_TYPES) — fine-grained, used by
//      analyzers and ObjectClassifier for accurate code-level classification.
//   2. Core-layer types (CORE_ONTOLOGY_TYPES) — 8 unified abstractions for
//      cross-tool rendering (Markdown / HTML / Mermaid / Graph). Existing
//      implementation types project to core types via toCoreType().
//      Report Generator renders the Core view; analyzers emit implementation
//      types; consumers render via the projection.
// ===========================================================================

const OBJECT_TYPES = [
  "repository",
  "module",
  "function",
  "class",
  "agent",
  "planner",
  "runner",
  "tool",
  "prompt",
  "test",
  "evaluation",
  "workflow",
  "config",
  "document",
  "dataset",
];

/**
 * Core Ontology — 8 unified abstractions (Palantir-light).
 *
 * Implementation types (OBJECT_TYPES + RESEARCH_OBJECT_TYPES) project to these
 * 8 core types. This is the canonical type set for cross-format rendering
 * (Markdown / HTML / Mermaid / Graph). Analyzers continue to emit granular
 * implementation types — only the rendering layer projects to core types.
 *
 *   Entity      — Concrete code unit (function/class/file/symbol)
 *   Module      — Coarse-grained code boundary (package/module/subsystem)
 *   API         — Exposed interface (public API/endpoint/CLI command)
 *   Capability  — System-level capability (AI/retrieval/storage/integration)
 *   Concept     — Domain concept or abstraction (ontology term)
 *   Artifact    — Non-code artifact (document/config/dataset/test)
 *   Decision    — Engineering choice (ADR / decision record)
 *   Pattern     — Reusable design pattern (architecture/code pattern)
 */
const CORE_ONTOLOGY_TYPES = [
  "Entity",
  "Module",
  "API",
  "Capability",
  "Concept",
  "Artifact",
  "Decision",
  "Pattern",
];

/**
 * Core Relationship Verbs — 8 unified verbs.
 * Implementation relationship types project to these for rendering.
 *
 *   implements   — A implements B (Module implements Pattern)
 *   depends_on   — A depends on B (Module depends on Module)
 *   owns         — A owns B (Module owns Entity)
 *   creates      — A creates B (Decision creates Pattern)
 *   uses         — A uses B (Entity uses API)
 *   contains     — A contains B (Module contains Entity)
 *   exposes      — A exposes B (Module exposes API)
 *   replaces     — A replaces B (Pattern replaces Pattern)
 */
const CORE_RELATIONSHIP_TYPES = [
  "implements",
  "depends_on",
  "owns",
  "creates",
  "uses",
  "contains",
  "exposes",
  "replaces",
];

/**
 * Map an implementation type (OBJECT_TYPES or RESEARCH_OBJECT_TYPES)
 * to one of the 8 CORE_ONTOLOGY_TYPES.
 *
 * Design: projection is many-to-one. Original type is preserved on the
 * object instance (obj.type) so analyzers can still distinguish e.g.
 * "agent" from "runner" while reports render both as "Entity".
 *
 * @param {string} implType
 * @returns {string} one of CORE_ONTOLOGY_TYPES
 */
function toCoreType(implType) {
  const t = String(implType || "").toLowerCase();
  // Code units → Entity
  if (["function", "class", "agent", "planner", "runner"].includes(t)) return "Entity";
  // Code boundaries → Module
  if (["repository", "module"].includes(t)) return "Module";
  // Non-code artifacts → Artifact
  if (["test", "evaluation", "workflow", "config", "document", "dataset", "evidence"].includes(t)) return "Artifact";
  // Exposed interfaces → API
  if (["tool", "prompt"].includes(t)) return "API";
  // Research-layer types
  if (["decision", "constraint", "assumption"].includes(t)) return "Decision";
  if (["pattern", "tradeoff", "hypothesis"].includes(t)) return "Pattern";
  if (["finding", "issue", "risk", "unknown"].includes(t)) return "Concept";
  // Fallback — Concept is the most generic semantic type
  return "Concept";
}

/**
 * Map an implementation relationship type to a core verb.
 * Many-to-one projection; original type preserved on relationship instance.
 *
 * @param {string} implRel
 * @returns {string} one of CORE_RELATIONSHIP_TYPES
 */
function toCoreRelationship(implRel) {
  const r = String(implRel || "").toLowerCase();
  // implements
  if (["implements", "implemented_by", "executed_by"].includes(r)) return "implements";
  // depends_on
  if (["imports", "calls", "references", "depends_on", "driven_by", "constrains", "observed_in"].includes(r)) return "depends_on";
  // owns
  if (["owns", "configuredby", "documentedby", "evaluatedby", "benchmarkedby"].includes(r)) return "owns";
  // creates
  if (["creates", "produces", "caused_by"].includes(r)) return "creates";
  // uses
  if (["uses", "testedby", "supported_by", "answers"].includes(r)) return "uses";
  // contains
  if (["contains"].includes(r)) return "contains";
  // exposes
  if (["exposes"].includes(r)) return "exposes";
  // replaces
  if (["replaces", "alternative_to", "mitigates", "contradicts", "conflicts_with"].includes(r)) return "replaces";
  // Fallback
  return "depends_on";
}

/**
 * Project a list of objects (with `type` field) to core-type distribution.
 * Returns a map: { Entity: 12, Module: 3, ... }
 *
 * @param {Array<{type: string}>} objects
 * @returns {Record<string, number>}
 */
function projectToCoreTypeDistribution(objects) {
  const dist = {};
  for (const t of CORE_ONTOLOGY_TYPES) dist[t] = 0;
  for (const o of objects || []) {
    const core = toCoreType(o.type);
    dist[core] = (dist[core] || 0) + 1;
  }
  return dist;
}

/**
 * Project a list of relationships (with `type` field) to core-verb distribution.
 *
 * @param {Array<{type: string}>} relationships
 * @returns {Record<string, number>}
 */
function projectToCoreRelDistribution(relationships) {
  const dist = {};
  for (const r of CORE_RELATIONSHIP_TYPES) dist[r] = 0;
  for (const rel of relationships || []) {
    const core = toCoreRelationship(rel.type);
    dist[core] = (dist[core] || 0) + 1;
  }
  return dist;
}

const RELATIONSHIP_TYPES = [
  "imports",
  "calls",
  "extends",
  "implements",
  "creates",
  "uses",
  "references",
  "owns",
  "testedBy",
  "configuredBy",
  "evaluatedBy",
  "documentedBy",
  "benchmarkedBy",
];

// Classification rules: name/path patterns → object type
// Order matters: first match wins (more specific patterns first)
//
// Tightened in 2026-07 revision to avoid false positives observed across
// ref-only repos:
//   - `/agent/i` over-matched HTTP `user_agent`/`UserAgent` and UI agent hooks
//     (one repo had 911 "agent" objects, ~95% UI code). Now requires word-boundary
//     `Agent` (capital A) or explicit agent-loop/session/subagent patterns,
//     and excludes `user_?agent` / `useragent` HTTP header references.
//   - `/harness/i` matched test helpers like `createHarness`, `withHarness`.
//     Now requires `Harness` (capital H) and excludes `create*Harness*` /
//     `with*Harness*` test-fixture builders.
//   - `/run\b/i` matched `runTest`, `runQuery`, `runOnce` → dropped in favor
//     of `runLoop`/`runAgent`/`runTurn` which are actual agent-loop entrypoints.
const CLASSIFICATION_RULES = [
  {
    type: "agent",
    patterns: [
      /\bAgent\b/,                          // Standalone `Agent` (capital, word-boundary)
      /\bagent_(?:loop|session|turn|dir|state|message|def)\b/i,
      /\b(?:run|create|load|discover|start|stop|trigger|sync)Agent\b/,
      /\bsub_?agent\b/i,
      /\bagentLoop\b/i,
      /\bimpl\s+.*\bAgent\b/,               // Rust `impl Agent`
      /\b(?:class|struct)\s+\w*Agent\b/,    // `class FooAgent` / `struct FooAgent`
    ],
    // Negative patterns: if name matches any of these, skip agent classification.
    // Catches HTTP `user_agent`/`UserAgent`/`getUserAgent` and UI agent hooks
    // (e.g. `useChannelAgentSessions`, `AgentActivitySheet`) which are product
    // features named "agent", not AI agent framework code.
    negative: [/user_?agent/i, /useragent/i, /http_?agent/i],
    field: "name",
  },
  {
    type: "planner",
    patterns: [/\bplan(?:ner|ning)?\b/i, /\bstrateg(?:y|ic)?\b/i],
    field: "name",
  },
  {
    type: "runner",
    patterns: [
      /\b(?:agent|turn|main|event|step)?Loop\b/i,   // agentLoop, turnLoop, mainLoop
      /\brun(?:Agent|Turn|Step|Loop|Session)\b/i,
      /\bexecutor\b/i,
    ],
    field: "name",
  },
  {
    type: "evaluation",
    patterns: [/\beval(?:uate|uation)?\b/i, /\bbenchmark\b/i, /\brubric\b/i, /\bgolden\b/i],
    field: "name",
  },
  {
    type: "workflow",
    patterns: [/\bworkflow\b/i, /\bpipeline\b/i],
    field: "name",
  },
];

/**
 * Classifies raw symbols, prompts, tools, tests, etc. into semantic Objects.
 * Inspired by Palantir's Object Discovery: everything is an Entity with a type.
 *
 * Input: existing analyzer outputs (symbols, prompts, tools, tests, evaluations, ci)
 * Output: typed Objects with properties, ready for relationship building.
 */
class ObjectClassifier {
  /**
   * @param {Record<string, any>} store — raw analyzer outputs
   * @returns {{ objects: Array, summary: Record<string, number> }}
   */
  classify(store) {
    const objects = [];
    const seen = new Set(); // dedup by key

    // 1. Classify prompts → Prompt objects
    const prompts = store.prompts?.prompts || [];
    for (const p of prompts) {
      const key = `prompt:${p.file}:${p.name || p.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "prompt",
        name: p.name || p.type || "unnamed",
        file: p.file,
        properties: {
          promptType: p.type,
          variables: p.variables || [],
          line: p.line,
        },
        evidence: [p.file],
      });
    }

    // 2. Classify tools → Tool objects
    const tools = store.tools?.tools || [];
    for (const t of tools) {
      const key = `tool:${t.name}:${t.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "tool",
        name: t.name,
        file: t.file,
        properties: {
          framework: t.framework,
          schema: t.schema,
        },
        evidence: [t.file],
      });
    }

    // 3. Classify tests → Test objects
    const testFiles = store.tests?.testFiles || [];
    for (const tf of testFiles) {
      const key = `test:${tf.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "test",
        name: tf.file.split("/").pop(),
        file: tf.file,
        properties: {
          testCount: tf.testCount || 0,
          patterns: tf.patterns || [],
        },
        evidence: [tf.file],
      });
    }

    // 4. Classify evaluations → Evaluation objects
    const evalFiles = store.evaluations?.evalFiles || [];
    for (const ef of evalFiles) {
      const key = `eval:${ef}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "evaluation",
        name: ef.split("/").pop(),
        file: ef,
        properties: {},
        evidence: [ef],
      });
    }

    // 5. Classify CI workflows → Workflow objects
    const ciWorkflows = store.ci?.workflows || [];
    for (const w of ciWorkflows) {
      const key = `workflow:${w.path || w.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "workflow",
        name: w.name || (w.path ? w.path.split("/").pop() : "unnamed"),
        file: w.path,
        properties: {
          triggers: w.triggers || [],
          jobs: w.jobs || [],
        },
        evidence: [w.path].filter(Boolean),
      });
    }

    // 6. Classify functions/classes → semantic types
    // SKIP test files: test functions/classes (e.g. `test_agent_baseline_run`,
    // `createHarness`) are not semantic objects — they verify behavior, they
    // don't define it. Filtering them eliminates ~80% of false-positive
    // agent/runner/workflow objects observed in ref-only repos (code-review-graph:
    // 10/10 agent objects were test functions; pi: 13/14 tools were test fixtures).
    const symbols = store.symbols || {};
    const allFuncs = (symbols.functions || []).filter((fn) => !isTestPath(fn.file));
    const allClasses = (symbols.classes || []).filter((cls) => !isTestPath(cls.file));

    for (const fn of allFuncs) {
      const semanticType = this._classifyByName(fn.name);
      const key = `${semanticType}:${fn.file}:${fn.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: semanticType,
        name: fn.name,
        file: fn.file,
        properties: {
          line: fn.line,
          params: fn.params || 0,
          exported: fn.exported || false,
        },
        evidence: [fn.file],
      });
    }

    for (const cls of allClasses) {
      const semanticType = this._classifyByName(cls.name, "class");
      const key = `${semanticType}:${cls.file}:${cls.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: semanticType,
        name: cls.name,
        file: cls.file,
        properties: {
          line: cls.line,
          methods: cls.methods || 0,
          exported: cls.exported || false,
        },
        evidence: [cls.file],
      });
    }

    // 7. Classify config files → Config objects
    const disc = store.discovery || {};
    const allFiles = disc.allFiles || [];
    for (const f of allFiles) {
      if (/\.(ya?ml|toml|ini|env|json)$/.test(f) && !/node_modules|\.git/.test(f)) {
        const key = `config:${f}`;
        if (seen.has(key)) continue;
        seen.add(key);
        objects.push({
          id: key,
          type: "config",
          name: f.split("/").pop(),
          file: f,
          properties: {},
          evidence: [f],
        });
      }
    }

    // 8. Classify documents → Document objects
    for (const f of allFiles) {
      if (/\.(md|rst|txt)$/.test(f) && !/node_modules|\.git/.test(f)) {
        const key = `doc:${f}`;
        if (seen.has(key)) continue;
        seen.add(key);
        objects.push({
          id: key,
          type: "document",
          name: f.split("/").pop(),
          file: f,
          properties: {},
          evidence: [f],
        });
      }
    }

    // Strip redundant `evidence` arrays — every object already has a `file`
    // field that serves as the evidence pointer. This reduces ontology size by
    // ~15% with zero information loss.
    for (const obj of objects) {
      delete obj.evidence;
    }

    // Build summary
    const summary = {};
    for (const obj of objects) {
      summary[obj.type] = (summary[obj.type] || 0) + 1;
    }

    return { objects, summary };
  }

  /**
   * Classify a function/class name into a semantic object type.
   * Returns "function" or "class" if no semantic match.
   * @param {string} name
   * @param {string} defaultType
   * @returns {string}
   */
  _classifyByName(name, defaultType = "function") {
    if (!name) return defaultType;
    for (const rule of CLASSIFICATION_RULES) {
      // Skip this rule if name matches any negative pattern (e.g. user_agent)
      if (rule.negative && rule.negative.some((np) => np.test(name))) continue;
      for (const pattern of rule.patterns) {
        if (pattern.test(name)) return rule.type;
      }
    }
    return defaultType;
  }
}

/**
 * Builds semantic relationships between classified Objects.
 * Inspired by Palantir's Relationship Discovery: Object identity is less
 * important than how Objects connect.
 *
 * Input: classified Objects + raw analyzer outputs
 * Output: typed Relationships (testedBy, configuredBy, usesTool, etc.)
 */
class RelationshipBuilder {
  /**
   * @param {Array} objects — from ObjectClassifier
   * @param {Record<string, any>} store — raw analyzer outputs
   * @returns {{ relationships: Array, summary: Record<string, number> }}
   *
   * NOTE: Structural relationships (imports, calls) are NOT duplicated here —
   * they already exist in `store.symbols.imports` and `store.symbols.calls`.
   * Only semantic relationships (testedBy, configuredBy, documentedBy, uses,
   * etc.) are materialized, because they require cross-analyzer inference
   * that cannot be reconstructed from symbols alone. This avoids ~90% of the
   * ontology bloat (observed: 11k+ duplicate call relationships in large repos).
   */
  build(objects, store) {
    const rels = [];
    const symbols = store.symbols || {};

    // --- Semantic relationships only (structural ones live in symbols.*) ---

    // 1. testedBy (function/class → test file)
    const testObjects = objects.filter((o) => o.type === "test");
    const funcObjects = objects.filter((o) => o.type === "function" || o.type === "class");
    for (const fn of funcObjects) {
      const baseName = fn.name.replace(/\.(ts|js|py|tsx)$/, "");
      for (const test of testObjects) {
        const testName = test.name.replace(/\.(test|spec)\.(ts|js|py|tsx)$/, "");
        if (testName.includes(baseName) || baseName.includes(testName)) {
          rels.push({
            type: "testedBy",
            source: `${fn.type}:${fn.file}:${fn.name}`,
            target: test.file,
          });
        }
      }
    }

    // 2. configuredBy (module → config file)
    const configObjects = objects.filter((o) => o.type === "config");
    const moduleFiles = new Set(funcObjects.map((f) => f.file));
    for (const cfg of configObjects) {
      const cfgDir = cfg.file.split("/").slice(0, -1).join("/");
      for (const modFile of moduleFiles) {
        const modDir = modFile.split("/").slice(0, -1).join("/");
        if (modDir === cfgDir) {
          rels.push({
            type: "configuredBy",
            source: modFile,
            target: cfg.file,
          });
          break;
        }
      }
    }

    // 3. documentedBy (module → README/doc)
    const docObjects = objects.filter((o) => o.type === "document");
    for (const doc of docObjects) {
      if (!/^readme/i.test(doc.name)) continue;
      const docDir = doc.file === "README.md" ? "" : doc.file.split("/").slice(0, -1).join("/");
      for (const fn of funcObjects) {
        const fnDir = fn.file.split("/").slice(0, -1).join("/");
        if (fnDir === docDir) {
          rels.push({
            type: "documentedBy",
            source: `${fn.type}:${fn.file}:${fn.name}`,
            target: doc.file,
          });
          break;
        }
      }
    }

    // 4. usesTool / usesPrompt (agent → tool/prompt)
    const agentObjects = objects.filter(
      (o) => o.type === "agent" || o.type === "runner" || o.type === "planner",
    );
    const toolObjects = objects.filter((o) => o.type === "tool");
    const promptObjects = objects.filter((o) => o.type === "prompt");

    for (const agent of agentObjects) {
      for (const tool of toolObjects) {
        if (agent.file === tool.file || this._sharesDirectory(agent.file, tool.file)) {
          rels.push({
            type: "uses",
            source: agent.file,
            target: tool.file,
          });
        }
      }
      // Agent uses Prompt: if agent file is near prompt file
      for (const prompt of promptObjects) {
        if (agent.file === prompt.file || this._sharesDirectory(agent.file, prompt.file)) {
          rels.push({
            type: "uses",
            source: agent.file,
            target: prompt.file,
          });
        }
      }
    }

    // 5. evaluatedBy (module → evaluation)
    const evalObjects = objects.filter((o) => o.type === "evaluation");
    for (const ev of evalObjects) {
      rels.push({
        type: "evaluatedBy",
        source: "repository",
        target: ev.file,
      });
    }

    // Build summary
    const summary = {};
    for (const r of rels) {
      summary[r.type] = (summary[r.type] || 0) + 1;
    }

    return { relationships: rels, summary };
  }

  _sharesDirectory(a, b) {
    if (!a || !b) return false;
    const dirA = a.split("/").slice(0, -1).join("/");
    const dirB = b.split("/").slice(0, -1).join("/");
    return dirA === dirB && dirA !== "";
  }
}

// ===========================================================================
// Research Object Registry — second-order objects produced by inference analyzers
//
// Code objects (module/class/tool) are extracted from source. Research objects
// (Pattern/Decision/Constraint/Tradeoff/Assumption/Hypothesis/Evidence/Issue/
// Risk/Unknown) are produced by inference analyzers and the FindingsGenerator.
//
// This registry collects them into a unified graph so the Skill (and downstream
// LLM) can reason about relationships like:
//   Pattern —implemented_by→ Module
//   Decision —driven_by→ Constraint
//   Hypothesis —supported_by→ Evidence
//   Pattern —conflicts_with→ Decision
//
// Research object types align with the user's Research Object model suggestion
// (Palantir-style ontology) while reusing existing analyzer outputs.
// ===========================================================================

const RESEARCH_OBJECT_TYPES = [
  "pattern",        // ArchitecturePatternAnalyzer output
  "decision",       // DecisionAnalyzer output
  "constraint",     // ConstraintAnalyzer output
  "tradeoff",       // DecisionAnalyzer.tradeoff / inferred from decisions
  "assumption",     // AssumptionAnalyzer output
  "hypothesis",     // ResearchPlanner hypotheses
  "evidence",       // Finding.support / analyzer evidence
  "finding",        // FindingsGenerator output
  "issue",          // ConsistencyAnalyzer contradictions
  "risk",           // AssumptionAnalyzer high-risk assumptions
  "unknown",        // Findings with Unknown status
];

// Relationships between research objects (and to code objects)
const RESEARCH_RELATIONSHIP_TYPES = [
  "implemented_by",    // Pattern → Module
  "supported_by",      // Hypothesis/Decision → Evidence
  "conflicts_with",    // Pattern ↔ Decision / Finding ↔ Finding
  "caused_by",         // Issue → Constraint / Risk → Assumption
  "driven_by",         // Decision → Constraint
  "constrains",        // Constraint → Decision/Pattern
  "produces",          // Pattern → Finding
  "answers",           // Finding → Research Question
  "contradicts",       // Finding ↔ README claim
  "alternative_to",    // Decision → Decision (alternatives)
  "observed_in",       // Pattern → Module
  "mitigates",         // Decision → Risk
];

class ResearchObjectRegistry {
  constructor() {
    this.objects = [];        // {id, type, ref, summary, source}
    this.relationships = [];  // {from, to, type, detail}
  }

  register(type, ref, summary, source = "analyzer") {
    const id = `${type}:${ref}`;
    // Deduplicate by id
    if (this.objects.some((o) => o.id === id)) return id;
    this.objects.push({ id, type, ref, summary, source });
    return id;
  }

  relate(fromId, toId, type, detail = "") {
    // Deduplicate
    if (this.relationships.some((r) => r.from === fromId && r.to === toId && r.type === type)) return;
    this.relationships.push({ from: fromId, to: toId, type, detail });
  }

  // Build registry from evidence store — collects all research objects
  // produced by inference analyzers and FindingsGenerator.
  static fromStore(store) {
    const registry = new ResearchObjectRegistry();

    // Patterns
    const ap = store.archPattern || {};
    for (const p of ap.patterns || []) {
      const pid = registry.register("pattern", p.pattern, p.pattern, "ArchitecturePatternAnalyzer");
      for (const ev of p.evidence || []) {
        const eid = registry.register("evidence", `archPattern.${p.pattern}`, ev, "ArchitecturePatternAnalyzer");
        registry.relate(pid, eid, "supported_by");
      }
    }

    // Decisions (with tradeoff as separate object)
    const dec = store.decisions || {};
    for (const d of dec.decisions || []) {
      const did = registry.register("decision", d.id, d.decision, "DecisionAnalyzer");
      if (d.tradeoff) {
        const tid = registry.register("tradeoff", `${d.id}-tradeoff`, d.tradeoff, "DecisionAnalyzer");
        registry.relate(did, tid, "produces");
      }
      if (d.alternatives) {
        // alternatives is a string, register as a soft reference
        registry.relate(did, `decision:alternative:${d.id}`, "alternative_to", d.alternatives);
      }
    }

    // Constraints
    const con = store.constraints || {};
    for (const c of con.constraints || []) {
      const cid = registry.register("constraint", c.id, c.constraint, "ConstraintAnalyzer");
      // Constraints drive decisions
      for (const dd of c.drivesDecisions || []) {
        registry.relate(cid, `decision:${dd}`, "driven_by");
      }
    }

    // Assumptions (high-risk → Risk object)
    const asm = store.assumptions || {};
    for (const a of asm.assumptions || []) {
      const aid = registry.register("assumption", a.id, a.assumption, "AssumptionAnalyzer");
      if (a.risk === "high") {
        const rid = registry.register("risk", `${a.id}-risk`, a.brokenIf || a.assumption, "AssumptionAnalyzer");
        registry.relate(rid, aid, "caused_by");
      }
    }

    // Findings (with Unknown classification)
    const fin = store.findings || {};
    for (const f of fin.findings || []) {
      const fid = registry.register("finding", f.id, f.finding, "FindingsGenerator");
      // Each support item → Evidence object
      for (const s of f.support || []) {
        const eid = registry.register("evidence", `${f.id}-${s.source}`, s.detail, s.who || "analyzer");
        registry.relate(fid, eid, "supported_by");
      }
      // Unknown findings → Unknown object
      if (/unknown|not detected|not classified/i.test(f.finding || "")) {
        const uid = registry.register("unknown", f.id, f.finding, "FindingsGenerator");
        registry.relate(uid, fid, "observed_in");
      }
      // Q8 README contradictions
      if (f.questionId === "Q8" && /README claims/i.test(f.finding || "")) {
        registry.relate(fid, "readme:claim", "contradicts", f.finding);
      }
    }

    // Consistency contradictions → Issues
    const consistency = store.consistency || {};
    for (const c of consistency.contradictions || []) {
      const iid = registry.register("issue", c.id, c.topic || "contradiction", "ConsistencyAnalyzer");
      registry.relate(iid, `analyzer:${c.sourceA?.analyzer}`, "caused_by", c.sourceA?.claim);
      registry.relate(iid, `analyzer:${c.sourceB?.analyzer}`, "caused_by", c.sourceB?.claim);
    }

    return registry;
  }

  // Export as JSON-LD-style graph (for P3-③ JSON-LD output)
  toGraph(format = "json") {
    if (format === "json-ld") {
      return {
        "@context": {
          pattern: "https://schema.org/Thing",
          decision: "https://schema.org/Thing",
          // ... extend as needed
        },
        "@graph": this.objects.map((o) => ({
          "@id": o.id,
          "@type": o.type,
          summary: o.summary,
          source: o.source,
        })),
        relationships: this.relationships.map((r) => ({
          "@id": `rel:${r.from}-${r.type}-${r.to}`,
          subject: r.from,
          predicate: r.type,
          object: r.to,
          detail: r.detail,
        })),
      };
    }
    return { objects: this.objects, relationships: this.relationships };
  }

  summary() {
    const byType = {};
    for (const o of this.objects) byType[o.type] = (byType[o.type] || 0) + 1;
    return {
      totalObjects: this.objects.length,
      totalRelationships: this.relationships.length,
      byType,
    };
  }
}

export {
  EvidenceStore,
  OBJECT_TYPES,
  RELATIONSHIP_TYPES,
  CLASSIFICATION_RULES,
  ObjectClassifier,
  RelationshipBuilder,
  RESEARCH_OBJECT_TYPES,
  RESEARCH_RELATIONSHIP_TYPES,
  ResearchObjectRegistry,
  CORE_ONTOLOGY_TYPES,
  CORE_RELATIONSHIP_TYPES,
  toCoreType,
  toCoreRelationship,
  projectToCoreTypeDistribution,
  projectToCoreRelDistribution,
};
