import { sep } from "node:path";
import { DirectedGraph } from "graphology";
import { isTestPath, pathToModuleId, git } from "./utils.mjs";
import { BaseAnalyzer } from "./base-analyzer.mjs";

// ---------------------------------------------------------------------------
// buildArchGraph — shared helper: build a graphology DirectedGraph from
// ArchitectureAnalyzer output (nodes + edges). Used by ArchitectureMetrics
// and DependencySmell analyzers to avoid hand-rolled Map-based degree
// counting. graphology provides battle-tested inDegree/outDegree/density.
// ---------------------------------------------------------------------------
function buildArchGraph(arch) {
  const graph = new DirectedGraph();
  for (const n of arch.nodes || []) {
    // ArchitectureAnalyzer may emit duplicate node ids across different files
    // (e.g., test files mapped to the same module id); de-duplicate here.
    if (!graph.hasNode(n.id)) {
      graph.addNode(n.id);
    }
  }
  for (const e of arch.edges || []) {
    // addEdge throws on duplicate edges; merge silently instead.
    if (graph.hasEdge(e.from, e.to)) continue;
    try {
      graph.addEdge(e.from, e.to);
    } catch {
      // Node not in graph (edge references unknown node) — skip.
    }
  }
  return graph;
}

// ===========================================================================
// Mechanical Inference Analyzers
//
// These analyzers produce deterministic, evidence-backed structural facts:
//   - Stability / ChangeCoupling / InformationFlow / DependencySmell
//   - ArchitectureMetrics / Temporal
//
// Semantic interpretation (architecture patterns, responsibilities, decisions,
// capabilities) is intentionally removed — it is now the LLM's job in Hybrid
// mode, fed by the mechanical evidence these analyzers produce.
// ===========================================================================

/**
 * StabilityAnalyzer — module-level Robert C. Martin stability / abstractness.
 *
 * I (Instability) = Ce / (Ca + Ce)
 * A (Abstractness) = (interfaces + abstract classes) / total classes
 *
 * Zone classification:
 *   I < 0.3 && A > 0.7  → Zone of Uselessness (over-abstract)
 *   I > 0.7 && A < 0.3  → Zone of Pain (concrete, hard to change)
 *   Near main sequence   → Sweet Spot
 */
class StabilityAnalyzer extends BaseAnalyzer {
  get id() {
    return "stability";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const symbols = store.symbols || {};
    const discovery = store.discovery || {};

    // Group nodes by top-level module.
    const moduleNodes = new Map(); // moduleName → Set<nodeId>
    for (const node of arch.nodes || []) {
      const mod = this._moduleOf(node.id);
      if (!moduleNodes.has(mod)) moduleNodes.set(mod, new Set());
      moduleNodes.get(mod).add(node.id);
    }

    // Count afferent (Ca) and efferent (Ce) couplings at module level.
    const ca = new Map(); // moduleName → Set<depends-on-module>
    const ce = new Map(); // moduleName → Set<depended-on-by-module>
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      if (fromMod === toMod) continue;
      if (!ce.has(fromMod)) ce.set(fromMod, new Set());
      ce.get(fromMod).add(toMod);
      if (!ca.has(toMod)) ca.set(toMod, new Set());
      ca.get(toMod).add(fromMod);
    }

    // Count abstracts (interfaces, abstract classes, protocols, traits) per module.
    const abstractsPerModule = new Map();
    const totalPerModule = new Map();
    for (const cls of symbols.classes || []) {
      const mod = cls.file ? this._moduleOf(pathToModuleId(cls.file)) : "unknown";
      totalPerModule.set(mod, (totalPerModule.get(mod) || 0) + 1);
      const name = cls.name || "";
      const isAbstract = /\b(Interface|Protocol|Trait|Mixin|Abstract|Base|ABC)\b/.test(name)
        || cls.modifiers?.includes?.("abstract")
        || cls.modifiers?.includes?.("protocol");
      if (isAbstract) {
        abstractsPerModule.set(mod, (abstractsPerModule.get(mod) || 0) + 1);
      }
    }

    const modules = [];
    for (const [mod, nodes] of moduleNodes.entries()) {
      const caVal = (ca.get(mod) || new Set()).size;
      const ceVal = (ce.get(mod) || new Set()).size;
      const total = caVal + ceVal;
      const instability = total > 0 ? ceVal / total : 0;
      const totalClasses = totalPerModule.get(mod) || 0;
      const abstractClasses = abstractsPerModule.get(mod) || 0;
      const abstractness = totalClasses > 0 ? abstractClasses / totalClasses : 0;

      let zone;
      if (total === 0) zone = "isolated";
      else if (instability < 0.3 && abstractness > 0.7) zone = "zone_of_uselessness";
      else if (instability > 0.7 && abstractness < 0.3) zone = "zone_of_pain";
      else if (Math.abs(instability + abstractness - 1) < 0.3) zone = "sweet_spot";
      else zone = "transitioning";

      modules.push({
        module: mod,
        ca: caVal,
        ce: ceVal,
        instability: Number(instability.toFixed(3)),
        abstractness: Number(abstractness.toFixed(3)),
        totalClasses,
        abstractClasses,
        zone,
        nodeCount: nodes.size,
      });
    }

    modules.sort((a, b) => (b.ca + b.ce) - (a.ca + a.ce));

    // Summary distribution for A-I graph.
    const zoneDistribution = {};
    for (const m of modules) {
      zoneDistribution[m.zone] = (zoneDistribution[m.zone] || 0) + 1;
    }

    store[this.id] = {
      modules,
      zoneDistribution,
      totalModules: modules.length,
      painModules: modules.filter((m) => m.zone === "zone_of_pain").slice(0, 5),
      uselessnessModules: modules.filter((m) => m.zone === "zone_of_uselessness").slice(0, 5),
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * ChangeCouplingAnalyzer — detects files that frequently change together in
 * git history, even without import dependencies.
 *
 * Re-runs `git log --name-only` (the raw data is NOT cached in GitAnalyzer
 * — only the count is). Produces coupled pairs with co-change ratio and
 * classifies them as structural (have import dep) or logical (no import dep
 * but change together — the high-value signal).
 */
class ChangeCouplingAnalyzer extends BaseAnalyzer {
  get id() {
    return "changeCoupling";
  }
  supports(ctx) {
    return !!ctx.repoPath;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const repoPath = ctx.repoPath;
    const arch = store.architecture || {};

    // Get the full file list per commit (top 200 commits to bound runtime).
    const logRaw = git(
      repoPath,
      "log",
      "--name-only",
      "--format=@@@%H",
      "-n",
      "200",
      "HEAD"
    );

    if (!logRaw || logRaw.trim().length === 0) {
      store[this.id] = { coupledPairs: [], totalCommitsAnalyzed: 0 };
      return;
    }

    const commits = logRaw.split(/@@@/).filter(Boolean);
    const pairCounts = new Map(); // "fileA|fileB" → count
    const fileCounts = new Map(); // file → commit count
    const totalCommits = commits.length;

    for (const block of commits) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const files = lines.slice(1).filter((l) => l.trim().length > 0);
      // Count individual file frequencies.
      for (const f of files) {
        fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
      }
      // Count pairs (only if commit touches ≤ 30 files — larger commits are
      // usually merges/refactors and pollute the signal).
      if (files.length > 30) continue;
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const a = files[i] < files[j] ? files[i] : files[j];
          const b = files[i] < files[j] ? files[j] : files[i];
          const key = `${a}|${b}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    // Build a set of import edges for structural-dependency classification.
    const edgeSet = new Set();
    for (const edge of arch.edges || []) {
      edgeSet.add(`${edge.from}|${edge.to}`);
      edgeSet.add(`${edge.to}|${edge.from}`);
    }
    // Also check file-path co-occurrence (same directory = likely related).
    const sameDir = (a, b) => {
      const dirA = a.split(sep).slice(0, -1).join(sep);
      const dirB = b.split(sep).slice(0, -1).join(sep);
      return dirA === dirB;
    };

    // Filter pairs: co-change count ≥ 3 (statistical significance).
    const coupledPairs = [];
    for (const [key, count] of pairCounts.entries()) {
      if (count < 3) continue;
      const [fileA, fileB] = key.split("|");
      const ratioA = fileCounts.get(fileA) > 0 ? count / fileCounts.get(fileA) : 0;
      const ratioB = fileCounts.get(fileB) > 0 ? count / fileCounts.get(fileB) : 0;
      const coChangeRatio = (ratioA + ratioB) / 2;
      const idA = pathToModuleId(fileA);
      const idB = pathToModuleId(fileB);
      const hasStructuralDep = edgeSet.has(`${idA}|${idB}`);
      coupledPairs.push({
        files: [fileA, fileB],
        coChangeCount: count,
        coChangeRatio: Number(coChangeRatio.toFixed(2)),
        hasImportDep: hasStructuralDep,
        type: hasStructuralDep ? "structural" : "logical",
        sameDirectory: sameDir(fileA, fileB),
      });
    }

    coupledPairs.sort((a, b) => b.coChangeCount - a.coChangeCount);

    store[this.id] = {
      coupledPairs: coupledPairs.slice(0, 30),
      totalPairs: coupledPairs.length,
      logicalPairs: coupledPairs.filter((p) => p.type === "logical").length,
      totalCommitsAnalyzed: totalCommits,
    };
  }
}

/**
 * InformationFlowAnalyzer — infers end-to-end information flows by following
 * entrypoints → call graph → LLM call sites → output handlers.
 *
 * Produces labeled flows like:
 *   Request → Planner → Executor → LLM → Parser → Response
 *
 * NOTE: In the mechanical-only pipeline no ResponsibilityAnalyzer runs, so
 * flow step labels fall back to module names. The LLM in Hybrid mode performs
 * semantic labeling using the full context.
 */
class InformationFlowAnalyzer extends BaseAnalyzer {
  get id() {
    return "informationFlow";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const entrypoints = store.entrypoints || {};
    const symbols = store.symbols || {};
    const arch = store.architecture || {};

    // Build adjacency list from architecture edges.
    const adj = new Map(); // nodeId → Set<targetId>
    for (const edge of arch.edges || []) {
      if (!adj.has(edge.from)) adj.set(edge.from, new Set());
      adj.get(edge.from).add(edge.to);
    }

    // Identify LLM call sites (functions/classes with LLM-related names).
    // Tightened to LLM-specific provider/model names only.
    const LLM_NAME_RE = /\b(?:openai|anthropic|claude|gpt|chat_completion|gemini|mistral|deepseek|qwen|bedrock)\b|(?:(?:^|[^a-zA-Z])llm|(?:^|[^a-zA-Z])LLM|[a-z]Llm)(?:[^a-zA-Z]|$)/i;
    const llmNodes = new Set();
    for (const fn of symbols.functions || []) {
      if (fn.name && LLM_NAME_RE.test(fn.name) && fn.file) {
        llmNodes.add(pathToModuleId(fn.file));
      }
    }
    for (const cls of symbols.classes || []) {
      if (cls.name && LLM_NAME_RE.test(cls.name) && cls.file) {
        llmNodes.add(pathToModuleId(cls.file));
      }
    }

    // Identify request entrypoints (cli/server type, source files only).
    const SOURCE_EXT_SET = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java"]);
    const requestEntries = (entrypoints.entrypoints || []).filter(
      (ep) =>
        (ep.type === "cli" || ep.type === "server") &&
        SOURCE_EXT_SET.has("." + (ep.path.split(".").pop() || ""))
    );

    // For each request entry, do a BFS (depth 10) and label each node with its
    // module name (no responsibility data in mechanical-only mode).
    const flows = [];
    for (const entry of requestEntries.slice(0, 8)) {
      const startId = pathToModuleId(entry.path);
      const visited = new Set([startId]);
      const queue = [{ id: startId, depth: 0, path: [startId] }];
      let llmHit = null;
      let maxDepth = 0;

      while (queue.length > 0 && queue[0].depth < 10) {
        const { id, depth, path } = queue.shift();
        if (llmNodes.has(id) && !llmHit) {
          llmHit = { node: id, depth };
        }
        maxDepth = Math.max(maxDepth, depth);
        const neighbors = adj.get(id) || new Set();
        // Follow top 5 most-connected neighbors.
        const next = [...neighbors].slice(0, 5);
        for (const n of next) {
          if (visited.has(n)) continue;
          visited.add(n);
          queue.push({ id: n, depth: depth + 1, path: [...path, n] });
        }
      }

      const entryModule = this._moduleOf(startId);
      const steps = [
        { step: 1, module: entryModule, role: "Entry Point", node: startId },
      ];

      // Walk the visited set and pick distinct modules.
      const seenModules = new Set([entryModule]);
      for (const nodeId of visited) {
        const mod = this._moduleOf(nodeId);
        if (!seenModules.has(mod) && mod !== "unknown") {
          steps.push({
            step: steps.length + 1,
            module: mod,
            role: mod,
            node: nodeId,
            isLLMCall: llmNodes.has(nodeId),
          });
          seenModules.add(mod);
        }
        if (steps.length >= 7) break;
      }

      flows.push({
        name: `${entry.path} → ${llmHit ? "LLM" : "output"}`,
        entrypoint: entry.path,
        steps,
        reachesLLM: !!llmHit,
        llmNode: llmHit ? llmHit.node : null,
        confidence: Number((0.4 + steps.length * 0.08).toFixed(2)),
        coverage: steps.length >= 4 ? "complete" : steps.length >= 2 ? "partial" : "minimal",
      });
    }

    store[this.id] = {
      flows,
      totalFlows: flows.length,
      llmCallSites: [...llmNodes].slice(0, 10),
      reachesLLM: flows.some((f) => f.reachesLLM),
      _meta: {
        source: "regex+graph",
        strength: "weak",
        assumptions: [
          "LLM call sites are detected via regex on symbol names (LLM_NAME_RE: openai/anthropic/claude/gpt/llm/gemini/mistral/deepseek/qwen/bedrock/chat_completion)",
          "Entry points are CLI tools or HTTP handlers from EntrypointsAnalyzer",
          "BFS from entry point reaches LLM call site → flow.reachesLLM=true",
        ],
        limitations: [
          "Rust mod/use declarations are not resolved to full module paths → reachesLLM may be false-negative for Rust projects",
          "BFS is bounded by graph connectivity; isolated LLM call sites with 0 in/out edges are never reached",
        ],
        checkedLocations: [
          "symbols.functions[].name + symbols.classes[].name (regex LLM_NAME_RE)",
          "entrypoints.cli[] + entrypoints.tools[] + entrypoints.http[]",
          "architecture.edges[] (BFS traversal)",
        ],
        coverage: "Symbol-name regex; misses LLM calls via DI/registry/extension-point",
      },
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * DependencySmellAnalyzer — detects architectural smells in the dependency graph.
 *
 * Smell types:
 *   - layer_violation: module depends in the wrong direction (only when a
 *     layered pattern is present; absent in mechanical-only mode)
 *   - circular_dependency: cycles, classified by context
 *   - hub_module: in-degree > 20 (god module)
 *   - unstable_dependency: stable module depends on unstable module
 */
class DependencySmellAnalyzer extends BaseAnalyzer {
  get id() {
    return "dependencySmell";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const stability = store.stability || {};

    const smells = [];

    // Circular dependencies — classify by context (module names only in
    // mechanical-only mode; LLM performs semantic classification in Hybrid).
    for (const cycle of arch.cycles || []) {
      if (cycle.length < 3) continue; // skip 2-node cycles
      const modules = [...new Set(cycle.map((n) => this._moduleOf(n)))];
      const isPluginCycle = modules.some((m) => /plugin|registry|config/i.test(m));
      const isBusinessCycle = modules.some((m) => /plan|exec|persist|domain|service/i.test(m));
      smells.push({
        type: "circular_dependency",
        severity: isPluginCycle ? "low" : isBusinessCycle ? "high" : "medium",
        cycle: cycle.slice(0, 6),
        modules,
        context: isPluginCycle ? "plugin_registration" : isBusinessCycle ? "business_logic" : "general",
        acceptable: isPluginCycle,
        rule: isPluginCycle
          ? "Circular deps in plugin registration are acceptable (registry ↔ plugin)"
          : "Circular deps in business logic indicate tight coupling",
      });
    }

    // Hub modules (god module smell) — in-degree ≥ 20 (via graphology).
    const smellGraph = buildArchGraph(arch);
    for (const node of smellGraph.nodes()) {
      const deg = smellGraph.inDegree(node);
      if (deg >= 20) {
        smells.push({
          type: "hub_module",
          severity: deg >= 40 ? "high" : "medium",
          module: this._moduleOf(node),
          node,
          inDegree: deg,
          rule: `Module with in-degree ${deg} (≥20) is a god module — too many dependents`,
        });
      }
    }

    // Unstable dependency — stable module (I < 0.3) depends on unstable (I > 0.7).
    const stabilityByModule = new Map();
    for (const m of stability.modules || []) {
      stabilityByModule.set(m.module, m);
    }
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      const fromStab = stabilityByModule.get(fromMod);
      const toStab = stabilityByModule.get(toMod);
      if (fromStab && toStab && fromStab.instability < 0.3 && toStab.instability > 0.7) {
        smells.push({
          type: "unstable_dependency",
          severity: "medium",
          from: fromMod,
          to: toMod,
          fromInstability: fromStab.instability,
          toInstability: toStab.instability,
          rule: "Stable module (I<0.3) should not depend on unstable module (I>0.7)",
        });
      }
    }

    // Deduplicate and sort.
    const seen = new Set();
    const deduped = smells.filter((s) => {
      const key = `${s.type}|${s.from || s.module || ""}|${s.to || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const severityRank = { high: 3, medium: 2, low: 1 };
    deduped.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));

    store[this.id] = {
      smells: deduped.slice(0, 30),
      totalSmells: deduped.length,
      byType: {
        layer_violation: deduped.filter((s) => s.type === "layer_violation").length,
        circular_dependency: deduped.filter((s) => s.type === "circular_dependency").length,
        hub_module: deduped.filter((s) => s.type === "hub_module").length,
        unstable_dependency: deduped.filter((s) => s.type === "unstable_dependency").length,
      },
      highSeverity: deduped.filter((s) => s.severity === "high").length,
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

// ===========================================================================
// ArchitectureMetricsAnalyzer — Structural metrics (P2-④)
//
// Computes node-level and aggregate architecture metrics from the import graph
// produced by ArchitectureAnalyzer. Complements StabilityAnalyzer (which is
// module-level Robert C. Martin A-I graph) by providing:
//   - Layer       : layer detection from top-level dirs + src/<layer>/ patterns
//   - Cycle       : count, max length, cycle list (sourced from arch.cycles)
//   - Fan-in/out  : per-node, with aggregate avg / max / distribution
//   - Stability   : per-node I = Ce/(Ca+Ce) (0=stable, 1=unstable)
//   - Coupling    : density, avg degree, hub nodes (high fan-in),
//                   bottleneck nodes (high fan-out)
//
// Source: store.architecture (ArchitectureAnalyzer output — nodes, edges, cycles)
//
// Output: store.archMetrics = { layers, cycles, fanIn, fanOut, stability,
//                               coupling, summary, _meta }
// ===========================================================================

// Known layer name patterns. Matched against top-level dir names AND one-level
// deep subdirs of src/, lib/, app/. Each entry: { layer, aliases }.
const LAYER_PATTERNS = [
  { layer: "presentation", aliases: ["ui", "views", "view", "frontend", "web", "client", "components", "screens", "pages", "presentation"] },
  { layer: "business", aliases: ["services", "service", "domain", "usecases", "use_cases", "core", "business", "logic", "interactors"] },
  { layer: "data", aliases: ["data", "models", "entities", "schemas", "db", "database", "persistence", "repositories", "store", "storage"] },
  { layer: "infrastructure", aliases: ["infrastructure", "infra", "adapters", "adapter", "ports", "drivers", "external", "gateways"] },
  { layer: "api", aliases: ["api", "routes", "controllers", "endpoints", "handlers"] },
  { layer: "config", aliases: ["config", "configuration", "settings", "env"] },
  { layer: "utils", aliases: ["utils", "util", "helpers", "common", "shared", "lib"] },
  { layer: "tests", aliases: ["tests", "test", "spec", "specs", "__tests__"] },
];

class ArchitectureMetricsAnalyzer extends BaseAnalyzer {
  get id() {
    return "archMetrics";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const discovery = store.discovery || {};
    const nodes = arch.nodes || [];
    const edges = arch.edges || [];
    const cycles = arch.cycles || [];

    if (nodes.length === 0) {
      store[this.id] = {
        skipped: true,
        reason: "No architecture graph available.",
        summary: { totalNodes: 0, totalEdges: 0, totalCycles: 0, totalLayers: 0 },
      };
      return;
    }

    // --- Layer detection ----------------------------------------------------
    const { layers, nodeIdToLayer } = this._detectLayers(nodes, edges, discovery, ctx);

    // --- Build graphology DirectedGraph (replaces hand-rolled Map counting) --
    const graph = buildArchGraph(arch);
    const inDeg = (id) => graph.inDegree(id);
    const outDeg = (id) => graph.outDegree(id);

    // --- Fan-in / Fan-out (per-node, via graphology degree) ------------------
    const fanIn = this._aggregateFan(nodes, inDeg, "fan-in");
    const fanOut = this._aggregateFan(nodes, outDeg, "fan-out");

    // --- Stability (per-node, Robert C. Martin I = Ce/(Ca+Ce)) --------------
    const nodeStability = nodes.map((n) => {
      const ca = inDeg(n.id);
      const ce = outDeg(n.id);
      const total = ca + ce;
      const instability = total > 0 ? ce / total : 0;
      return { node: n.id, path: n.path, ca, ce, instability: Number(instability.toFixed(3)) };
    });
    const mostStable = [...nodeStability]
      .filter((s) => s.ca + s.ce > 0)
      .sort((a, b) => a.instability - b.instability)
      .slice(0, 5);
    const leastStable = [...nodeStability]
      .filter((s) => s.ca + s.ce > 0)
      .sort((a, b) => b.instability - a.instability)
      .slice(0, 5);
    const avgInstability = nodeStability.length > 0
      ? Number((nodeStability.reduce((sum, s) => sum + s.instability, 0) / nodeStability.length).toFixed(3))
      : 0;
    const stability = {
      avg: avgInstability,
      mostStable,
      leastStable,
      isolatedCount: nodeStability.filter((s) => s.ca + s.ce === 0).length,
    };

    // --- Coupling (aggregate) ----------------------------------------------
    const totalNodes = nodes.length;
    const totalEdges = edges.length;
    const density = totalNodes > 1
      ? totalEdges / (totalNodes * (totalNodes - 1))
      : 0;
    const avgDegree = totalNodes > 0 ? (totalEdges * 2) / totalNodes : 0;
    // Hub nodes: high fan-in (many depend on them) — they are "depended-upon" cores.
    const hubNodes = [...nodes]
      .map((n) => ({ node: n.id, path: n.path, fanIn: inDeg(n.id) }))
      .sort((a, b) => b.fanIn - a.fanIn)
      .slice(0, 5);
    // Bottleneck nodes: high fan-out (they depend on many) — change ripples out from them.
    const bottleneckNodes = [...nodes]
      .map((n) => ({ node: n.id, path: n.path, fanOut: outDeg(n.id) }))
      .sort((a, b) => b.fanOut - a.fanOut)
      .slice(0, 5);
    // Cross-layer edges: edges that cross layer boundaries (high = layers leak).
    let crossLayerEdges = 0;
    for (const e of edges) {
      const fromL = nodeIdToLayer.get(e.from);
      const toL = nodeIdToLayer.get(e.to);
      if (fromL && toL && fromL !== toL) crossLayerEdges++;
    }
    const coupling = {
      density: Number(density.toFixed(4)),
      avgDegree: Number(avgDegree.toFixed(3)),
      crossLayerEdges,
      crossLayerRatio: totalEdges > 0 ? Number((crossLayerEdges / totalEdges).toFixed(3)) : 0,
      hubNodes,
      bottleneckNodes,
    };

    // --- Cycle metrics -----------------------------------------------------
    const cycleLengths = cycles.map((c) => Array.isArray(c) ? c.length : (c.nodes?.length || 0));
    const cycleMetrics = {
      count: cycles.length,
      maxLength: cycleLengths.length > 0 ? Math.max(...cycleLengths) : 0,
      avgLength: cycleLengths.length > 0
        ? Number((cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length).toFixed(2))
        : 0,
      top: cycles.slice(0, 5).map((c, i) => ({
        id: i + 1,
        nodes: Array.isArray(c) ? c : (c.nodes || []),
        length: Array.isArray(c) ? c.length : (c.nodes?.length || 0),
      })),
    };

    // --- Summary -----------------------------------------------------------
    const summary = {
      totalNodes,
      totalEdges,
      totalCycles: cycles.length,
      totalLayers: layers.length,
      avgFanIn: fanIn.avg,
      avgFanOut: fanOut.avg,
      avgInstability,
      density: coupling.density,
    };

    store[this.id] = {
      layers,
      cycles: cycleMetrics,
      fanIn,
      fanOut,
      stability,
      coupling,
      summary,
      _meta: {
        source: "store.architecture (nodes, edges, cycles)",
        strength: "strong",
        assumptions: [
          "Import graph accurately reflects runtime dependencies",
          "Layer detection is heuristic (directory naming) — verify against actual architecture",
          "Node-level stability follows Robert C. Martin's I metric; module-level is in StabilityAnalyzer",
        ],
        limitations: [
          "Synthetic repos with no imports produce empty graph",
          "Dynamic imports / reflection-based deps are not captured",
          "Layer detection misses non-conventional directory layouts",
        ],
        possibleFalsePositives: [
          "Test files may inflate fan-in of utility modules",
          "Barrel index.* files create false hubs",
        ],
        checkedLocations: ["store.architecture.nodes", "store.architecture.edges", "store.architecture.cycles", "store.discovery.topLevelDirs"],
        coverage: "import-graph-only",
      },
    };
  }

  /**
   * Detect architectural layers from directory structure.
   */
  _detectLayers(nodes, edges, discovery, _ctx) {
    const topLevelDirs = discovery.topLevelDirs || [];
    const nodeLayer = new Map();

    const candidates = new Set(topLevelDirs);
    const srcSubDirs = new Set();
    for (const n of nodes) {
      const parts = (n.path || "").split("/");
      if (parts.length >= 2 && (["src", "lib", "app"].includes(parts[0]))) {
        srcSubDirs.add(parts[1]);
      }
    }
    for (const d of srcSubDirs) candidates.add(d);

    const layerOfDir = new Map();
    for (const cand of candidates) {
      const lower = cand.toLowerCase();
      for (const pat of LAYER_PATTERNS) {
        if (pat.aliases.includes(lower)) {
          layerOfDir.set(cand, pat.layer);
          break;
        }
      }
    }

    for (const n of nodes) {
      const parts = (n.path || "").split("/").filter(Boolean);
      if (parts.length === 0) continue;
      let dirSeg = null;
      if ((["src", "lib", "app"].includes(parts[0])) && parts.length >= 2) {
        dirSeg = parts[1];
      } else {
        dirSeg = parts[0];
      }
      const layer = layerOfDir.get(dirSeg);
      if (layer) {
        nodeLayer.set(n.id, { layer, sourceDir: dirSeg });
      }
    }

    const byLayer = new Map();
    for (const [nodeId, info] of nodeLayer.entries()) {
      if (!byLayer.has(info.layer)) {
        byLayer.set(info.layer, { nodes: [], sourceDirs: new Set() });
      }
      const entry = byLayer.get(info.layer);
      entry.nodes.push(nodeId);
      entry.sourceDirs.add(info.sourceDir);
    }

    const layers = [];
    for (const [layer, info] of byLayer.entries()) {
      const nodeSet = new Set(info.nodes);
      let intraEdges = 0;
      let crossEdges = 0;
      for (const e of edges) {
        const fromIn = nodeSet.has(e.from);
        const toIn = nodeSet.has(e.to);
        if (fromIn && toIn) intraEdges++;
        else if (fromIn || toIn) crossEdges++;
      }
      layers.push({
        layer,
        sourceDirs: [...info.sourceDirs],
        nodeCount: info.nodes.length,
        intraEdges,
        crossEdges,
      });
    }
    layers.sort((a, b) => b.nodeCount - a.nodeCount);

    const nodeIdToLayer = new Map();
    for (const [nodeId, info] of nodeLayer.entries()) {
      nodeIdToLayer.set(nodeId, info.layer);
    }
    return { layers, nodeIdToLayer };
  }

  _aggregateFan(nodes, degreeFn, _label) {
    if (nodes.length === 0) {
      return { avg: 0, max: 0, maxNode: null, distribution: { "0": 0, "1-3": 0, "4-9": 0, "10+": 0 } };
    }
    const values = nodes.map((n) => degreeFn(n.id) || 0);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = Number((sum / values.length).toFixed(3));
    let max = 0;
    let maxNode = null;
    const dist = { "0": 0, "1-3": 0, "4-9": 0, "10+": 0 };
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v > max) {
        max = v;
        maxNode = nodes[i].id;
      }
      if (v === 0) dist["0"]++;
      else if (v <= 3) dist["1-3"]++;
      else if (v <= 9) dist["4-9"]++;
      else dist["10+"]++;
    }
    return { avg, max, maxNode, distribution: dist };
  }
}

// ===========================================================================
// TemporalAnalyzer — Repository Evolution (P2-③)
//
// Analyzes git history to detect architectural evolution events:
//   - Major Rewrite     : single commit touching >30% of files
//   - Architecture Pivot: sustained shift in top-active modules across time windows
//   - Deprecated Pattern: modules with high early activity but no recent activity
//   - Historical Tradeoff: commit messages mentioning rewrite/refactor/deprecate/
//                          replace/migrate (intentional architectural changes)
//
// Source: store.git (GitAnalyzer output)
//
// Output: store.temporal = { events, deprecatedModules, pivotWindows, summary, _meta }
// ===========================================================================

class TemporalAnalyzer extends BaseAnalyzer {
  get id() {
    return "temporal";
  }

  supports(ctx) {
    return ctx.isGitRepo === true;
  }

  async analyze(ctx, store, _analyzerCtx) {
    const gitData = store.git || {};
    const totalCommits = gitData.totalCommits || 0;
    const largestRefactors = gitData.largestRefactors || [];
    const topActiveModules = gitData.topActiveModules || [];

    if (totalCommits === 0) {
      store[this.id] = {
        skipped: true,
        reason: "No git history available.",
        events: [],
        deprecatedModules: [],
        pivotWindows: [],
        summary: { totalEvents: 0, totalDeprecated: 0, totalPivots: 0 },
        _meta: this._meta(),
      };
      return;
    }

    const events = [];

    const fileCountThreshold = Math.max(10, Math.floor(this._estimateTotalFiles(topActiveModules) * 0.10));
    for (const ref of largestRefactors) {
      if (ref.filesChanged >= fileCountThreshold && ref.filesChanged >= 30) {
        events.push({
          type: "major_rewrite",
          commitHash: ref.hash,
          date: ref.date,
          subject: ref.subject,
          filesChanged: ref.filesChanged,
          interpretation: `Major rewrite: commit ${ref.hash.slice(0, 8)} touched ${ref.filesChanged} files in a single commit — likely a large-scale refactor or architectural change.`,
          confidence: 0.7,
        });
      }
    }

    const TRADEOFF_PATTERNS = [
      { regex: /\brewrite\b|refactor\s+(?:whole|entire|major|large)/i, type: "rewrite", interpretation: "Commit message indicates a rewrite — explicit architecture tradeoff." },
      { regex: /\bdeprecat/i, type: "deprecation", interpretation: "Commit message marks something deprecated — historical tradeoff in favor of a new approach." },
      { regex: /\breplace\b|\bmigrate\b|\bport\s+to\b/i, type: "migration", interpretation: "Commit message indicates a migration — replacing one approach with another." },
      { regex: /\barchitecture\b|\bpivot\b|\brestructure\b/i, type: "restructure", interpretation: "Commit message explicitly mentions architecture change." },
    ];
    for (const ref of largestRefactors) {
      for (const pattern of TRADEOFF_PATTERNS) {
        if (pattern.regex.test(ref.subject || "")) {
          events.push({
            type: "historical_tradeoff",
            subtype: pattern.type,
            commitHash: ref.hash,
            date: ref.date,
            subject: ref.subject,
            filesChanged: ref.filesChanged,
            interpretation: pattern.interpretation,
            confidence: 0.6,
          });
          break;
        }
      }
    }

    const DEPRECATED_NAME_RE = /^(legacy|old|deprecated|v1|archive|obsolete|retired)[/_-]/i;
    const deprecatedModules = topActiveModules
      .slice(0, 10)
      .filter((m) => DEPRECATED_NAME_RE.test(m.module))
      .map((m) => ({
        module: m.module,
        commits: m.commits,
        reason: `Module name suggests legacy/deprecated status (${m.commits} historical commits).`,
        confidence: 0.5,
      }));

    const pivotWindows = [];
    if (largestRefactors.length >= 4) {
      const sorted = [...largestRefactors].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const midIdx = Math.floor(sorted.length / 2);
      const oldHalf = sorted.slice(0, midIdx);
      const newHalf = sorted.slice(midIdx);
      const oldTopModules = this._topModulesFromRefactors(oldHalf);
      const newTopModules = this._topModulesFromRefactors(newHalf);
      const oldTopNotInNew = oldTopModules.slice(0, 3).filter((m) => !newTopModules.slice(0, 3).includes(m));
      if (oldTopNotInNew.length > 0 && newTopModules.length > 0) {
        pivotWindows.push({
          oldTopModules: oldTopModules.slice(0, 3),
          newTopModules: newTopModules.slice(0, 3),
          shiftedAway: oldTopNotInNew,
          interpretation: `Architecture pivot detected: focus shifted from [${oldTopModules.slice(0, 3).join(", ")}] to [${newTopModules.slice(0, 3).join(", ")}].`,
          confidence: 0.5,
        });
      }
    }

    const seen = new Set();
    const dedupedEvents = events.filter((e) => {
      const key = `${e.commitHash}:${e.type}:${e.subtype || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    store[this.id] = {
      events: dedupedEvents,
      deprecatedModules,
      pivotWindows,
      summary: {
        totalEvents: dedupedEvents.length,
        totalDeprecated: deprecatedModules.length,
        totalPivots: pivotWindows.length,
        totalCommitsAnalyzed: totalCommits,
      },
      _meta: this._meta(),
    };
  }

  _estimateTotalFiles(topActiveModules) {
    return topActiveModules.reduce((s, m) => s + (m.commits || 0), 0);
  }

  _topModulesFromRefactors(refactors) {
    const counts = {};
    for (const r of refactors) {
      const subject = r.subject || "";
      const moduleHint = subject.split(/[,\s/]/)[0]?.toLowerCase() || "unknown";
      counts[moduleHint] = (counts[moduleHint] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
  }

  _meta() {
    return {
      source: "git.largestRefactors + git.topActiveModules",
      strength: "weak",
      assumptions: [
        "Major rewrite = single commit touching ≥30 files or ≥10% of all touched files",
        "Historical tradeoff detected from commit subject keywords (rewrite/deprecate/migrate)",
        "Deprecated pattern requires module name to start with legacy/old/deprecated/v1/archive",
        "Architecture pivot approximated by comparing old/new halves of largestRefactors",
      ],
      limitations: [
        "Synthetic repos have no git history — this analyzer is skipped",
        "Per-period file-touch counts not available from GitAnalyzer; pivot detection is approximate",
        "Subject-line keyword matching can produce false positives",
      ],
      checkedLocations: ["store.git.largestRefactors", "store.git.topActiveModules", "store.git.totalCommits"],
      coverage: "git-history-only",
    };
  }
}

export {
  StabilityAnalyzer,
  ChangeCouplingAnalyzer,
  InformationFlowAnalyzer,
  DependencySmellAnalyzer,
  ArchitectureMetricsAnalyzer,
  TemporalAnalyzer,
};
