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

export {
  EvidenceStore,
  OBJECT_TYPES,
  RELATIONSHIP_TYPES,
  CLASSIFICATION_RULES,
  ObjectClassifier,
  RelationshipBuilder,
};
