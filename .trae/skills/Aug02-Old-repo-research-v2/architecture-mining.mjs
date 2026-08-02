// ===========================================================================
// architecture-mining.mjs — Architecture Mining Stage
//
// p6 copy.md §7: "Graph → Architecture Facts, not just symbol index"
//
// Consumes: Knowledge Graph (graphology) + Evidence Log
// Produces: Architecture Facts (centers, boundaries, tensions, violations)
//
// The output is the SINGLE SOURCE OF TRUTH for LLM architecture reasoning.
// LLM prompts consume these facts instead of raw code metrics.
//
// Key insight: "X has 90 inbound dependencies" is a code fact.
//              "model module acts as architectural gravity center" is an
//              architecture fact. This module transforms the former into the latter.
// ===========================================================================

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// PageRank — iterative implementation (no external deps)
// ---------------------------------------------------------------------------

/**
 * Compute PageRank for all nodes in the graph.
 * High PageRank = node is referenced by other important nodes = gravity center.
 *
 * @param {import('graphology').default} graph
 * @param {object} opts - { iterations, damping, minLength }
 * @returns {Map<string, number>} nodeId → pageRank score
 */
export function computePageRank(graph, opts = {}) {
  const { iterations = 30, damping = 0.85 } = opts;
  const nodes = graph.nodes();
  const n = nodes.length;
  if (n === 0) return new Map();

  // Initialize: uniform distribution
  let pr = new Map();
  for (const node of nodes) pr.set(node, 1 / n);

  // Pre-compute out-degree for normalization
  const outDegree = new Map();
  for (const node of nodes) {
    outDegree.set(node, graph.outDegree(node) || 0);
  }

  // Iterate
  for (let i = 0; i < iterations; i++) {
    const newPr = new Map();
    let danglingSum = 0;

    // Collect dangling nodes (no outgoing edges) — redistribute their PR
    for (const node of nodes) {
      if ((outDegree.get(node) || 0) === 0) {
        danglingSum += pr.get(node) || 0;
      }
    }

    for (const node of nodes) {
      let sum = 0;
      // Sum PR from incoming edges
      graph.forEachInEdge(node, (edge, attrs, source) => {
        const srcOutDeg = outDegree.get(source) || 1;
        sum += (pr.get(source) || 0) / srcOutDeg;
      });
      // Add dangling node redistribution
      sum += danglingSum / n;
      newPr.set(node, (1 - damping) / n + damping * sum);
    }
    pr = newPr;
  }

  // Normalize to [0, 1] range for readability
  const max = Math.max(...pr.values(), 1e-10);
  for (const [k, v] of pr) pr.set(k, v / max);

  return pr;
}

// ---------------------------------------------------------------------------
// Betweenness centrality (simplified — for small-medium graphs)
// ---------------------------------------------------------------------------

/**
 * Compute simplified betweenness centrality using BFS shortest paths.
 * High betweenness = node is a bridge between communities = boundary controller.
 *
 * For large graphs, we sample source nodes (cap at 200) to bound runtime.
 */
export function computeBetweenness(graph, opts = {}) {
  const { maxSources = 200 } = opts;
  const nodes = graph.nodes();
  const betweenness = new Map();
  for (const node of nodes) betweenness.set(node, 0);

  // Sample source nodes if graph is large
  const sources = nodes.length > maxSources
    ? nodes.filter((_, i) => i % Math.ceil(nodes.length / maxSources) === 0)
    : nodes;

  for (const source of sources) {
    // BFS shortest paths
    const dist = new Map();
    const paths = new Map(); // node → list of predecessors on shortest paths
    const pathCount = new Map();
    const queue = [source];
    dist.set(source, 0);
    pathCount.set(source, 1);

    while (queue.length > 0) {
      const v = queue.shift();
      const d = dist.get(v);
      graph.forEachOutEdge(v, (edge, attrs, source2, target) => {
        if (!dist.has(target)) {
          dist.set(target, d + 1);
          pathCount.set(target, pathCount.get(v) || 1);
          paths.set(target, [v]);
          queue.push(target);
        } else if (dist.get(target) === d + 1) {
          pathCount.set(target, (pathCount.get(target) || 0) + (pathCount.get(v) || 1));
          paths.get(target)?.push(v);
        }
      });
    }

    // Backtrack: accumulate betweenness
    const sortedByDist = [...dist.entries()].sort((a, b) => b[1] - a[1]);
    const delta = new Map();
    for (const [node] of sortedByDist) delta.set(node, 0);

    for (const [w, d] of sortedByDist) {
      if (w === source || d === 0) continue;
      const preds = paths.get(w) || [];
      const sigmaW = pathCount.get(w) || 1;
      for (const pred of preds) {
        const sigmaPred = pathCount.get(pred) || 1;
        const contribution = (delta.get(w) || 0) + 1;
        delta.set(pred, (delta.get(pred) || 0) + (sigmaPred / sigmaW) * contribution);
      }
      if (preds.length > 0) {
        betweenness.set(w, (betweenness.get(w) || 0) + (delta.get(w) || 0));
      }
    }
  }

  // Normalize
  const max = Math.max(...betweenness.values(), 1e-10);
  for (const [k, v] of betweenness) betweenness.set(k, v / max);

  return betweenness;
}

// ---------------------------------------------------------------------------
// 1. Architectural Gravity Centers
// ---------------------------------------------------------------------------

/**
 * Discover architectural gravity centers — nodes that the entire system
 * orbits around. These are NOT just "high in-degree" nodes; they combine:
 *   - High PageRank (referenced by other important nodes)
 *   - High in-degree (many direct dependents)
 *   - Semantic relevance (name suggests architectural role: model/core/api)
 *
 * Output: "model module acts as architectural gravity center" not "90 deps"
 */
export function discoverGravityCenters(graph, pageRank, metrics) {
  const centers = [];
  const SEMANTIC_KEYWORDS = /model|core|api|runtime|registry|plugin|manager|factory|context|base|abstract|interface|service/i;

  const inDegreeMap = new Map();
  graph.forEachEdge((edge, attrs, source, target) => {
    inDegreeMap.set(target, (inDegreeMap.get(target) || 0) + 1);
  });

  for (const node of graph.nodes()) {
    const attrs = graph.getNodeAttributes(node);
    const pr = pageRank.get(node) || 0;
    const inDeg = inDegreeMap.get(node) || 0;
    const name = attrs.name || node;

    // Skip low-impact nodes
    if (inDeg < 5 && pr < 0.1) continue;

    // Semantic relevance boost
    const isSemantic = SEMANTIC_KEYWORDS.test(name);
    const semanticBonus = isSemantic ? 0.3 : 0;

    // Composite score: PageRank (40%) + in-degree normalized (30%) + semantic (30%)
    const inDegScore = Math.min(inDeg / 100, 1); // cap at 100 deps
    const score = pr * 0.4 + inDegScore * 0.3 + semanticBonus;

    if (score > 0.15) {
      centers.push({
        node,
        name,
        type: attrs.type,
        score,
        pageRank: pr,
        inDegree: inDeg,
        isSemantic,
        file: attrs.file || attrs.path || null,
        reason: buildCenterReason(name, pr, inDeg, isSemantic, attrs.type),
      });
    }
  }

  centers.sort((a, b) => b.score - a.score);
  return centers.slice(0, 8);
}

function buildCenterReason(name, pr, inDeg, isSemantic, type) {
  const parts = [];
  if (pr > 0.5) parts.push(`PageRank ${pr.toFixed(2)} (top tier)`);
  else if (pr > 0.2) parts.push(`PageRank ${pr.toFixed(2)} (high centrality)`);
  if (inDeg >= 50) parts.push(`${inDeg} inbound dependencies (system-wide impact)`);
  else if (inDeg >= 10) parts.push(`${inDeg} dependents`);
  if (isSemantic) parts.push(`name "${name}" indicates architectural role (${type})`);
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// 2. Boundary Detection — module clusters + cross-boundary edges
// ---------------------------------------------------------------------------

/**
 * Detect architectural boundaries by clustering modules with high internal
 * dependency density and low cross-cluster coupling.
 *
 * Uses a simplified label propagation algorithm (no external deps).
 */
export function detectBoundaries(graph) {
  // Collect module/bundle-level nodes (skip file/class level for boundary analysis)
  const moduleNodes = graph.nodes().filter((node) => {
    const attrs = graph.getNodeAttributes(node);
    return attrs.type === "module" || attrs.type === "bundle" || attrs.type === "feature";
  });

  if (moduleNodes.length < 2) return [];

  // Label propagation clustering on module dependency graph
  const labels = new Map();
  for (const node of moduleNodes) labels.set(node, node);

  // Extract module name prefix for semantic grouping (e.g., org.jkiss.dbeaver.model → model)
  function getCluster(node) {
    const attrs = graph.getNodeAttributes(node);
    const name = attrs.name || node;
    // OSGi bundle: org.jkiss.dbeaver.model → "model"
    const m = name.match(/org\.jkiss\.dbeaver\.(\w+)/);
    if (m) return m[1];
    // Maven module: extract last segment
    const parts = name.split(/[.:]/);
    return parts[parts.length - 1] || name;
  }

  // Assign initial labels by semantic cluster
  for (const node of moduleNodes) {
    labels.set(node, getCluster(node));
  }

  // Count cross-boundary edges
  const boundaryEdges = [];
  for (const node of moduleNodes) {
    graph.forEachOutEdge(node, (edge, attrs, source, target) => {
      if (moduleNodes.includes(target)) {
        const srcCluster = labels.get(source);
        const tgtCluster = labels.get(target);
        if (srcCluster !== tgtCluster) {
          boundaryEdges.push({
            from: source,
            to: target,
            fromCluster: srcCluster,
            toCluster: tgtCluster,
            type: attrs.type,
          });
        }
      }
    });
  }

  // Group by cluster pair
  const boundaryMap = new Map();
  for (const be of boundaryEdges) {
    const key = `${be.fromCluster}→${be.toCluster}`;
    if (!boundaryMap.has(key)) {
      boundaryMap.set(key, {
        name: key,
        sides: [be.fromCluster, be.toCluster],
        edgeCount: 0,
        direction: `${be.fromCluster}→${be.toCluster}`,
        examples: [],
      });
    }
    const b = boundaryMap.get(key);
    b.edgeCount++;
    if (b.examples.length < 3) {
      const fromName = graph.getNodeAttributes(be.from)?.name || be.from;
      const toName = graph.getNodeAttributes(be.to)?.name || be.to;
      b.examples.push(`${fromName} → ${toName}`);
    }
  }

  return [...boundaryMap.values()].sort((a, b) => b.edgeCount - a.edgeCount).slice(0, 10);
}

// ---------------------------------------------------------------------------
// 3. Tension Detection — conflicting architectural forces
// ---------------------------------------------------------------------------

/**
 * Detect architectural tensions — forces pulling the system in opposite
 * directions. Tensions are the most valuable architecture insight because
 * they reveal the trade-offs the architect had to navigate.
 *
 * Heuristics:
 *   - Generic abstraction vs vendor specificity: model modules depended on by
 *     both generic and vendor-specific modules
 *   - Centralization vs decentralization: single high-fan-out node vs many
 *     independent modules
 *   - Stability vs flexibility: stable core with many extension points
 *   - Platform independence vs native integration: OSGi bundles with JNI/native
 */
export function detectTensions(graph, gravityCenters, metrics) {
  const tensions = [];

  // Tension 1: Generic abstraction vs vendor specificity
  // Find gravity center that is depended on by both generic and vendor modules
  for (const center of gravityCenters.slice(0, 3)) {
    const dependents = [];
    graph.forEachInEdge(center.node, (edge, attrs, source) => {
      const srcAttrs = graph.getNodeAttributes(source);
      dependents.push({ node: source, name: srcAttrs.name || source, type: srcAttrs.type });
    });

    const vendorDependents = dependents.filter((d) =>
      /ext\.|vendor|driver|specific|native|wmi|jni|jdbc/i.test(d.name)
    );
    const genericDependents = dependents.filter((d) =>
      /core|model|ui|registry|runtime/i.test(d.name)
    );

    if (vendorDependents.length >= 2 && genericDependents.length >= 2) {
      tensions.push({
        axis: "generic-abstraction vs vendor-specific-capability",
        description: `"${center.name}" serves as generic abstraction but is extended by ${vendorDependents.length} vendor-specific modules`,
        evidence: [
          `Gravity center "${center.name}" (${center.inDegree} dependents)`,
          `Vendor extensions: ${vendorDependents.slice(0, 3).map((d) => d.name).join(", ")}`,
          `Generic consumers: ${genericDependents.slice(0, 3).map((d) => d.name).join(", ")}`,
        ],
        resolution: "extension points allow vendor escape hatches while maintaining common abstraction",
      });
    }
  }

  // Tension 2: Centralization vs decentralization
  // Find nodes with extremely high out-degree (centralized control)
  const topBottlenecks = metrics.topBottlenecks?.slice(0, 5) || [];
  for (const bn of topBottlenecks) {
    if (bn.outDegree >= 50) {
      tensions.push({
        axis: "centralized-control vs modular-independence",
        description: `"${bn.attrs?.name || bn.node}" depends on ${bn.outDegree} other nodes — high coupling creates a centralization tension`,
        evidence: [
          `${bn.outDegree} outbound dependencies`,
          `Node type: ${bn.attrs?.type || "unknown"}`,
          `File: ${bn.attrs?.file || bn.attrs?.path || "(graph node)"}`,
        ],
        resolution: "centralization reduces duplication but creates a fragile coupling point",
      });
    }
  }

  // Tension 3: Platform independence vs native integration
  // Find JNI/native code references in OSGi bundles
  const nativeNodes = [];
  graph.forEachNode((node, attrs) => {
    const name = attrs.name || node;
    if (/jni|native|wmi|com4j|jna/i.test(name)) {
      nativeNodes.push({ node, name, type: attrs.type, file: attrs.file });
    }
  });

  if (nativeNodes.length > 0) {
    tensions.push({
      axis: "platform-independence vs native-integration",
      description: `${nativeNodes.length} nodes use native code (JNI/WMI/JNA), breaking OSGi platform independence`,
      evidence: nativeNodes.slice(0, 3).map((n) => `${n.name} (${n.file || "graph node"})`),
      resolution: "native code is isolated in separate bundles to contain platform dependency",
    });
  }

  // Tension 4: Stability vs extensibility
  // Find extension points with many contributors (high extensibility)
  const extPointContributors = new Map();
  graph.forEachEdge((edge, attrs, source, target) => {
    if (attrs.type === "contributes") {
      extPointContributors.set(target, (extPointContributors.get(target) || 0) + 1);
    }
  });

  const topExtPoints = [...extPointContributors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, count]) => count >= 5);

  if (topExtPoints.length > 0) {
    tensions.push({
      axis: "core-stability vs extension-extensibility",
      description: `Extension points with many contributors create a stability-extensibility tension`,
      evidence: topExtPoints.map(([ep, count]) => {
        const name = graph.getNodeAttributes(ep)?.name || ep;
        return `${name}: ${count} contributors`;
      }),
      resolution: "extension point contracts must remain stable while implementations vary freely",
    });
  }

  return tensions;
}

// ---------------------------------------------------------------------------
// 4. Violation Detection — where architecture patterns are broken
// ---------------------------------------------------------------------------

/**
 * Detect architecture violations — places where the code breaks the
 * established architectural patterns. These are the most surprising
 * findings in a good architecture report.
 *
 * Heuristics:
 *   - Cross-layer dependencies (UI depending on UI, model depending on UI)
 *   - Native code in platform-independent modules
 *   - Circular dependencies between modules
 *   - Direct implementation bypassing abstraction layer
 */
export function detectViolations(graph, boundaries) {
  const violations = [];

  // Violation 1: Cross-layer dependencies (model→ui, ui→model bidirectional)
  // Expected: ui→model (UI depends on model), NOT model→ui
  for (const boundary of boundaries.slice(0, 5)) {
    const [from, to] = boundary.sides;
    // If model→ui exists, it's a layering violation
    if (/model|core/i.test(from) && /ui|swt|debug/i.test(to)) {
      violations.push({
        type: "layering-violation",
        from,
        to,
        description: `model/core layer "${from}" depends on UI layer "${to}" — inverts expected dependency direction`,
        evidence: boundary.examples,
        severity: "high",
      });
    }
    // If ui→ui exists between different UI layers, it may indicate tight coupling
    if (/ui/i.test(from) && /ui/i.test(to) && from !== to) {
      violations.push({
        type: "cross-ui-coupling",
        from,
        to,
        description: `UI layer "${from}" depends on UI layer "${to}" — tight coupling between UI components`,
        evidence: boundary.examples,
        severity: "medium",
      });
    }
  }

  // Violation 2: Native code in OSGi bundles
  graph.forEachNode((node, attrs) => {
    const name = attrs.name || node;
    const file = attrs.file || attrs.path || "";
    if (/jni|native|wmi|com4j|jna/i.test(name) && attrs.type === "class") {
      // Check if this class is in an OSGi bundle
      let inBundle = false;
      graph.forEachInEdge(node, (edge, eattrs, source) => {
        const srcAttrs = graph.getNodeAttributes(source);
        if (srcAttrs.type === "bundle" || srcAttrs.type === "module") {
          inBundle = true;
        }
      });
      if (inBundle) {
        violations.push({
          type: "platform-independence-violation",
          from: name,
          to: "native-code",
          description: `Class "${name}" uses native code (JNI/WMI/JNA) inside an OSGi bundle, breaking platform independence`,
          evidence: [`Class: ${name}`, `File: ${file}`],
          severity: "high",
        });
      }
    }
  });

  // Violation 3: God classes (methods > 100)
  graph.forEachNode((node, attrs) => {
    if (attrs.type === "class") {
      let methodCount = 0;
      graph.forEachOutEdge(node, (edge, eattrs) => {
        if (eattrs.type === "contains") methodCount++;
      });
      if (methodCount >= 100) {
        violations.push({
          type: "god-class",
          from: attrs.name || node,
          to: `${methodCount} methods`,
          description: `Class "${attrs.name}" has ${methodCount} methods — violates single responsibility principle`,
          evidence: [`Class: ${attrs.name}`, `File: ${attrs.file}`, `Method count: ${methodCount}`],
          severity: methodCount >= 150 ? "high" : "medium",
        });
      }
    }
  });

  return violations.slice(0, 10);
}

// ---------------------------------------------------------------------------
// 5. Extension Point Analysis
// ---------------------------------------------------------------------------

export function analyzeExtensionPoints(graph) {
  const extPoints = [];

  graph.forEachNode((node, attrs) => {
    if (attrs.type === "ext-point") {
      let contributorCount = 0;
      const contributors = [];
      graph.forEachInEdge(node, (edge, eattrs, source) => {
        if (eattrs.type === "contributes") {
          contributorCount++;
          const srcName = graph.getNodeAttributes(source)?.name || source;
          if (contributors.length < 5) contributors.push(srcName);
        }
      });
      if (contributorCount > 0) {
        extPoints.push({
          node,
          name: attrs.name || node,
          declaredBy: attrs.declaredBy,
          contributorCount,
          sampleContributors: contributors,
        });
      }
    }
  });

  extPoints.sort((a, b) => b.contributorCount - a.contributorCount);
  return extPoints.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main: mineArchitectureFacts
// ---------------------------------------------------------------------------

/**
 * Mine architecture facts from the knowledge graph.
 *
 * This is the KEY transformation: graph topology → architecture insight.
 * The output feeds directly into LLM prompts, replacing raw metrics.
 *
 * @param {import('graphology').default} graph - the knowledge graph
 * @param {object} metrics - pre-computed metrics (from computeGraphMetrics)
 * @param {string} workDir - working directory for output
 * @returns {object} architecture facts
 */
export async function mineArchitectureFacts(graph, metrics, workDir) {
  console.log("  Architecture Mining: computing PageRank...");
  const pageRank = computePageRank(graph);

  console.log("  Architecture Mining: discovering gravity centers...");
  const gravityCenters = discoverGravityCenters(graph, pageRank, metrics);

  console.log("  Architecture Mining: detecting boundaries...");
  const boundaries = detectBoundaries(graph);

  console.log("  Architecture Mining: detecting tensions...");
  const tensions = detectTensions(graph, gravityCenters, metrics);

  console.log("  Architecture Mining: detecting violations...");
  const violations = detectViolations(graph, boundaries);

  console.log("  Architecture Mining: analyzing extension points...");
  const extensionPoints = analyzeExtensionPoints(graph);

  const facts = {
    gravityCenters,
    boundaries,
    tensions,
    violations,
    extensionPoints,
    summary: {
      gravityCenterCount: gravityCenters.length,
      boundaryCount: boundaries.length,
      tensionCount: tensions.length,
      violationCount: violations.length,
      extensionPointCount: extensionPoints.length,
      topGravityCenter: gravityCenters[0]?.name || "(none)",
    },
  };

  // Persist to artifacts/
  const artifactsDir = join(workDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, "architecture-facts.json"), JSON.stringify(facts, null, 2), "utf-8");

  console.log(`  Architecture Mining: ${gravityCenters.length} centers, ${tensions.length} tensions, ${violations.length} violations, ${extensionPoints.length} extension points`);

  return facts;
}

// ---------------------------------------------------------------------------
// Format architecture facts for LLM prompt injection
// ---------------------------------------------------------------------------

/**
 * Format architecture facts as a concise string for LLM prompt injection.
 * This replaces raw evidence/metrics in LLM prompts.
 *
 * Key design: every fact is a SENTENCE with architectural meaning,
 * not a number. "model module acts as gravity center" not "90 inbound deps".
 */
export function formatArchitectureFactsForPrompt(facts) {
  if (!facts) return "(无架构事实)";

  const parts = [];

  // Gravity centers — the architectural "sun" that everything orbits
  if (facts.gravityCenters?.length > 0) {
    parts.push("=== 架构引力中心（Architectural Gravity Centers）===");
    parts.push("系统的核心力量所在，修改这些节点会影响大量依赖：");
    for (const c of facts.gravityCenters.slice(0, 5)) {
      parts.push(`- ${c.name} (${c.type}): ${c.reason}`);
    }
    parts.push("");
  }

  // Tensions — the conflicts the architect had to navigate
  if (facts.tensions?.length > 0) {
    parts.push("=== 架构张力（Architectural Tensions）===");
    parts.push("系统中的对立力量，架构师必须在它们之间做出权衡：");
    for (const t of facts.tensions) {
      parts.push(`- [${t.axis}] ${t.description}`);
      parts.push(`  证据: ${t.evidence.join("; ")}`);
      parts.push(`  解决方式: ${t.resolution}`);
    }
    parts.push("");
  }

  // Violations — where the pattern breaks
  if (facts.violations?.length > 0) {
    parts.push("=== 架构违规（Architecture Violations）===");
    parts.push("违反架构模式的地方，通常是技术债或刻意妥协：");
    for (const v of facts.violations) {
      parts.push(`- [${v.type}] ${v.description} (严重度: ${v.severity})`);
      parts.push(`  证据: ${v.evidence.join("; ")}`);
    }
    parts.push("");
  }

  // Boundaries — the seams between subsystems
  if (facts.boundaries?.length > 0) {
    parts.push("=== 架构边界（Architectural Boundaries）===");
    parts.push("子系统之间的依赖边界，修改影响范围：");
    for (const b of facts.boundaries.slice(0, 5)) {
      parts.push(`- ${b.direction}: ${b.edgeCount} 条依赖边`);
      if (b.examples.length > 0) parts.push(`  示例: ${b.examples.join(", ")}`);
    }
    parts.push("");
  }

  // Extension points — where the system is designed to be extended
  if (facts.extensionPoints?.length > 0) {
    parts.push("=== 扩展点（Extension Points）===");
    parts.push("系统设计的可扩展接口，反映架构的开放性：");
    for (const ep of facts.extensionPoints.slice(0, 5)) {
      parts.push(`- ${ep.name}: ${ep.contributorCount} 个贡献者`);
      if (ep.sampleContributors.length > 0) {
        parts.push(`  贡献者: ${ep.sampleContributors.join(", ")}`);
      }
    }
    parts.push("");
  }

  return parts.join("\n");
}
