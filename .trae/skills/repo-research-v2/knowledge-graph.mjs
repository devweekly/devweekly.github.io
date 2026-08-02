// ===========================================================================
// knowledge-graph.mjs — Repository Knowledge Graph (p6 copy.md §5-§6)
//
// p6 copy.md: "Graphology 负责让系统'知道代码之间如何关联'"
// Merges facts from all mechanical analyzers into a unified graph:
//   - Tree-sitter: symbols (class/function), calls, imports
//   - Java Analyzer: Maven modules, OSGi bundles, extensions, features
//   - Git History: file change patterns (optional)
//
// The graph is the SINGLE SOURCE OF TRUTH for Repository Model.
// Reports are VIEWS derived from this graph (p6 copy.md §6).
//
// Uses graphology (already in package.json) for graph operations.
// ===========================================================================

import Graph from "graphology";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Node/Edge type constants
// ---------------------------------------------------------------------------

const NODE_TYPES = {
  FILE: "file",
  CLASS: "class",
  FUNCTION: "function",
  METHOD: "method",
  MODULE: "module",        // Maven module / npm package
  BUNDLE: "bundle",        // OSGi bundle
  FEATURE: "feature",      // Eclipse Feature
  EXTENSION_POINT: "ext-point",
  PACKAGE: "package",      // Java package / Python module
};

const EDGE_TYPES = {
  CONTAINS: "contains",         // module → file, class → method
  CALLS: "calls",               // function → function
  IMPORTS: "imports",           // file → module/package
  DEPENDS_ON: "depends-on",     // module → module, bundle → bundle
  EXTENDS: "extends",           // class → class (inheritance)
  IMPLEMENTS: "implements",     // class → interface
  CONTRIBUTES_TO: "contributes", // bundle → extension-point
  INCLUDES_PLUGIN: "includes-plugin",  // feature → bundle
  INCLUDES_FEATURE: "includes-feature", // feature → feature
  REQUIRES_BUNDLE: "requires-bundle",  // bundle → bundle (OSGi)
  EXPORTS_PACKAGE: "exports-package",  // bundle → package
};

// ---------------------------------------------------------------------------
// Build graph from Tree-sitter facts
// ---------------------------------------------------------------------------

function addTreeSitterFacts(graph, tsResult) {
  const { symbols, calls, imports, modules } = tsResult;

  // Add file nodes + symbol nodes
  for (const mod of modules) {
    graph.addNode(mod.file, { type: NODE_TYPES.FILE, importCount: mod.importCount, callCount: mod.callCount });
  }

  for (const sym of symbols) {
    const nodeId = `${sym.file}::${sym.type}:${sym.name}`;
    if (!graph.hasNode(nodeId)) {
      graph.addNode(nodeId, {
        type: sym.type === "class" ? NODE_TYPES.CLASS : (sym.type === "method" ? NODE_TYPES.METHOD : NODE_TYPES.FUNCTION),
        name: sym.name,
        file: sym.file,
        line: sym.line,
        class: sym.class || null,
      });
    }
    // file CONTAINS symbol
    if (graph.hasNode(sym.file)) {
      graph.addDirectedEdge(sym.file, nodeId, { type: EDGE_TYPES.CONTAINS });
    }
    // class CONTAINS method
    if (sym.type === "method" && sym.class) {
      const classId = `${sym.file}::class:${sym.class}`;
      if (graph.hasNode(classId)) {
        graph.addDirectedEdge(classId, nodeId, { type: EDGE_TYPES.CONTAINS });
      }
    }
  }

  // Add call edges
  for (const call of calls) {
    const callerId = `${call.file}::function:${call.caller}`;
    // Only add edge if caller node exists (avoid phantom nodes)
    if (graph.hasNode(callerId)) {
      // Try to find callee node — may not exist for external calls
      const calleeCandidates = symbols.filter((s) => s.name === call.callee);
      if (calleeCandidates.length > 0) {
        for (const c of calleeCandidates.slice(0, 3)) { // cap to avoid explosion
          const calleeId = `${c.file}::${c.type}:${c.name}`;
          if (graph.hasNode(calleeId) && callerId !== calleeId) {
            graph.addDirectedEdge(callerId, calleeId, { type: EDGE_TYPES.CALLS, line: call.line });
          }
        }
      }
    }
  }

  // Add import edges
  for (const imp of imports) {
    if (graph.hasNode(imp.file)) {
      // Create package node if not exists
      const pkgId = `pkg:${imp.module}`;
      if (!graph.hasNode(pkgId)) {
        graph.addNode(pkgId, { type: NODE_TYPES.PACKAGE, name: imp.module });
      }
      graph.addDirectedEdge(imp.file, pkgId, { type: EDGE_TYPES.IMPORTS });
    }
  }
}

// ---------------------------------------------------------------------------
// Build graph from Java Analyzer facts
// ---------------------------------------------------------------------------

function addJavaAnalyzerFacts(graph, javaResult) {
  const { mavenModuleGraph, osgiBundleIndex, osgiExtensionIndex, featureComposition } = javaResult;

  // Maven modules
  for (const node of mavenModuleGraph.nodes) {
    const id = `maven:${node.id}`;
    if (!graph.hasNode(id)) {
      graph.addNode(id, {
        type: NODE_TYPES.MODULE,
        name: node.id,
        groupId: node.groupId,
        version: node.version,
        packaging: node.packaging,
        path: node.path,
      });
    }
  }
  for (const edge of mavenModuleGraph.edges) {
    const from = `maven:${edge.from}`;
    const to = `maven:${edge.to}`;
    if (graph.hasNode(from) && graph.hasNode(to)) {
      graph.addDirectedEdge(from, to, { type: EDGE_TYPES.DEPENDS_ON, subtype: edge.type, scope: edge.scope });
    }
  }

  // OSGi bundles
  for (const bundle of osgiBundleIndex.bundles) {
    const id = `osgi:${bundle.symbolicName}`;
    if (!graph.hasNode(id)) {
      graph.addNode(id, {
        type: NODE_TYPES.BUNDLE,
        name: bundle.symbolicName,
        version: bundle.version,
        activator: bundle.activator,
        path: bundle.path,
      });
    }
    // Export packages
    for (const pkg of bundle.exportPackages || []) {
      const pkgId = `pkg:${pkg}`;
      if (!graph.hasNode(pkgId)) {
        graph.addNode(pkgId, { type: NODE_TYPES.PACKAGE, name: pkg });
      }
      graph.addDirectedEdge(id, pkgId, { type: EDGE_TYPES.EXPORTS_PACKAGE });
    }
  }
  for (const edge of osgiBundleIndex.edges) {
    const from = `osgi:${edge.from}`;
    const to = `osgi:${edge.to}`;
    if (graph.hasNode(from) && graph.hasNode(to)) {
      graph.addDirectedEdge(from, to, {
        type: EDGE_TYPES.REQUIRES_BUNDLE,
        optional: edge.optional,
        reexport: edge.reexport,
      });
    }
  }

  // Eclipse extension points + contributions
  for (const ep of osgiExtensionIndex.extensionPoints) {
    const id = `extpoint:${ep.id}`;
    if (!graph.hasNode(id)) {
      graph.addNode(id, { type: NODE_TYPES.EXTENSION_POINT, name: ep.id, declaredBy: ep.declaredBy });
    }
  }
  for (const ext of osgiExtensionIndex.extensions) {
    const from = `osgi:${ext.contributedBy}`;
    const to = `extpoint:${ext.point}`;
    if (graph.hasNode(from) && graph.hasNode(to)) {
      graph.addDirectedEdge(from, to, { type: EDGE_TYPES.CONTRIBUTES_TO, childCount: ext.childCount });
    }
  }

  // Eclipse Features
  for (const feature of featureComposition.features) {
    const id = `feature:${feature.id}`;
    if (!graph.hasNode(id)) {
      graph.addNode(id, {
        type: NODE_TYPES.FEATURE,
        name: feature.id,
        label: feature.label,
        version: feature.version,
        path: feature.path,
      });
    }
  }
  for (const edge of featureComposition.edges) {
    const from = `feature:${edge.from}`;
    if (edge.type === "includes-plugin") {
      const to = `osgi:${edge.to}`;
      if (graph.hasNode(from) && graph.hasNode(to)) {
        graph.addDirectedEdge(from, to, { type: EDGE_TYPES.INCLUDES_PLUGIN, version: edge.version });
      }
    } else if (edge.type === "includes-feature") {
      const to = `feature:${edge.to}`;
      if (graph.hasNode(from) && graph.hasNode(to)) {
        graph.addDirectedEdge(from, to, { type: EDGE_TYPES.INCLUDES_FEATURE, version: edge.version });
      }
    } else if (edge.type === "requires-plugin") {
      const to = `osgi:${edge.to}`;
      if (graph.hasNode(from) && graph.hasNode(to)) {
        graph.addDirectedEdge(from, to, { type: EDGE_TYPES.DEPENDS_ON, subtype: "requires-plugin" });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Compute graph metrics (for blast radius + change difficulty)
// ---------------------------------------------------------------------------

function computeGraphMetrics(graph) {
  const inDegree = new Map();
  const outDegree = new Map();
  const edgesByType = new Map();

  graph.forEachEdge((edge, attrs, source, target) => {
    inDegree.set(target, (inDegree.get(target) || 0) + 1);
    outDegree.set(source, (outDegree.get(source) || 0) + 1);
    const t = attrs.type || "unknown";
    edgesByType.set(t, (edgesByType.get(t) || 0) + 1);
  });

  // Find hub nodes (high in-degree = many dependents = high blast radius)
  const hubsByInDegree = [...inDegree.entries()]
    .map(([node, deg]) => ({ node, inDegree: deg, attrs: graph.getNodeAttributes(node) }))
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 20);

  // Find bottleneck nodes (high out-degree = many dependencies = high coupling)
  const bottlenecksByOutDegree = [...outDegree.entries()]
    .map(([node, deg]) => ({ node, outDegree: deg, attrs: graph.getNodeAttributes(node) }))
    .sort((a, b) => b.outDegree - a.outDegree)
    .slice(0, 20);

  return {
    totalNodes: graph.order,
    totalEdges: graph.size,
    edgesByType: Object.fromEntries(edgesByType),
    topHubs: hubsByInDegree.slice(0, 10),
    topBottlenecks: bottlenecksByOutDegree.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Derive views from graph (p6 copy.md §6: Graph → multiple Views)
// ---------------------------------------------------------------------------

function deriveRuntimeView(graph) {
  // Runtime view: entry points + call chains
  const entryPoints = [];
  graph.forEachNode((node, attrs) => {
    if (attrs.type === NODE_TYPES.CLASS && (attrs.name?.includes("Launcher") || attrs.name?.includes("Main") || attrs.name?.includes("Application"))) {
      entryPoints.push({ node, name: attrs.name, file: attrs.file });
    }
  });
  return { entryPoints, entryPointCount: entryPoints.length };
}

function deriveArchitectureView(graph) {
  // Architecture view: modules + their dependencies
  const modules = [];
  graph.forEachNode((node, attrs) => {
    if (attrs.type === NODE_TYPES.MODULE || attrs.type === NODE_TYPES.BUNDLE) {
      const deps = [];
      graph.forEachOutEdge(node, (edge, attrs2, source, target) => {
        if (attrs2.type === EDGE_TYPES.DEPENDS_ON || attrs2.type === EDGE_TYPES.REQUIRES_BUNDLE) {
          deps.push(target);
        }
      });
      modules.push({ node, name: attrs.name, type: attrs.type, dependencies: deps });
    }
  });
  return { modules, moduleCount: modules.length };
}

function deriveBlastRadiusView(graph, metrics) {
  // Blast radius: nodes with highest in-degree (most dependents)
  return {
    topHubs: metrics.topHubs.map((h) => ({
      node: h.node,
      name: h.attrs.name,
      type: h.attrs.type,
      dependentCount: h.inDegree,
    })),
  };
}

// ---------------------------------------------------------------------------
// Main: buildKnowledgeGraph
// ---------------------------------------------------------------------------

/**
 * Build unified Repository Knowledge Graph from all analyzer outputs.
 *
 * @param {object} params - { tsResult, javaResult, gitSummary }
 * @param {string} workDir - working directory for output
 * @returns {object} graph data + derived views + metrics
 */
export async function buildKnowledgeGraph(params, workDir) {
  const { tsResult, javaResult } = params;
  const graph = new Graph({ multi: true, type: "directed" });

  // Layer 1: Tree-sitter code facts
  if (tsResult) {
    addTreeSitterFacts(graph, tsResult);
  }

  // Layer 2: Java ecosystem facts
  if (javaResult) {
    addJavaAnalyzerFacts(graph, javaResult);
  }

  // Compute metrics
  const metrics = computeGraphMetrics(graph);

  // Derive views (p6 copy.md §6)
  const views = {
    runtime: deriveRuntimeView(graph),
    architecture: deriveArchitectureView(graph),
    blastRadius: deriveBlastRadiusView(graph, metrics),
  };

  // Serialize graph for persistence (graphology exportNode/Edge)
  const serialized = {
    nodes: graph.mapNodes((node, attrs) => ({ id: node, ...attrs })),
    edges: graph.mapEdges((edge, attrs, source, target) => ({ id: edge, source, target, ...attrs })),
  };

  // Save to artifacts/
  const artifactsDir = join(workDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, "repository-graph.json"), JSON.stringify(serialized, null, 2), "utf-8");
  await writeFile(join(artifactsDir, "graph-views.json"), JSON.stringify(views, null, 2), "utf-8");
  await writeFile(join(artifactsDir, "graph-metrics.json"), JSON.stringify(metrics, null, 2), "utf-8");

  // Generate evidence facts from graph topology
  const evidenceFacts = generateGraphEvidenceFacts(graph, metrics, views);

  return {
    graph: serialized,
    views,
    metrics,
    evidenceFacts,
    stats: {
      totalNodes: graph.order,
      totalEdges: graph.size,
      ...metrics.edgesByType,
    },
  };
}

// ---------------------------------------------------------------------------
// Generate evidence facts from graph topology
// ---------------------------------------------------------------------------

function generateGraphEvidenceFacts(graph, metrics, views) {
  const facts = [];

  // Hub nodes (high blast radius)
  for (const hub of metrics.topHubs.slice(0, 5)) {
    if (hub.inDegree >= 5) {
      facts.push({
        observation: `"${hub.attrs.name || hub.node}" has ${hub.inDegree} inbound dependencies (highest blast radius — changing it impacts ${hub.inDegree} dependents)`,
        source: "knowledge-graph:hub",
        file: hub.attrs.path || hub.attrs.file || "(graph node)",
      });
    }
  }

  // Bottleneck nodes (high coupling)
  for (const bn of metrics.topBottlenecks.slice(0, 5)) {
    if (bn.outDegree >= 10) {
      facts.push({
        observation: `"${bn.attrs.name || bn.node}" depends on ${bn.outDegree} other nodes (high coupling — changes in many dependencies may affect it)`,
        source: "knowledge-graph:bottleneck",
        file: bn.attrs.path || bn.attrs.file || "(graph node)",
      });
    }
  }

  // Entry points
  if (views.runtime.entryPointCount > 0) {
    facts.push({
      observation: `Repository has ${views.runtime.entryPointCount} entry point classes: ${views.runtime.entryPoints.slice(0, 3).map((e) => e.name).join(", ")}`,
      source: "knowledge-graph:runtime",
      file: views.runtime.entryPoints[0]?.file || "(unknown)",
    });
  }

  // Module dependency summary
  if (views.architecture.moduleCount > 0) {
    const modules = views.architecture.modules;
    const avgDeps = modules.reduce((sum, m) => sum + m.dependencies.length, 0) / modules.length;
    facts.push({
      observation: `Repository has ${modules.length} modules/bundles with average ${avgDeps.toFixed(1)} intra-project dependencies each`,
      source: "knowledge-graph:architecture",
      file: modules[0]?.attrs?.path || "(multiple)",
    });
  }

  return facts;
}
