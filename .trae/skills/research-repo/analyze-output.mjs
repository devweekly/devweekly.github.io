import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node analyze-output.mjs <full.json> ...");
  process.exit(1);
}

/**
 * summarize() — surfaces ARCHITECTURE SEMANTICS, not just counts.
 *
 * Pre-2026-07: this function collapsed each analyzer's output to counts and
 * top-N lists, throwing away the semantic richness. Architects complained
 * "totalNodes=400, edges=600 tells me nothing about WHY it's designed this way."
 *
 * Post-2026-07: the function leads with the 7 inference analyzers' output
 * (pattern, responsibility, stability, change coupling, information flow,
 * dependency smells, capability ontology) and keeps the fact-level counts as
 * a secondary "Raw Metrics" section for completeness.
 */
function summarize(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const d = data.discovery || {};
  const a = data.architecture || {};
  const ap = data.archPattern || {};
  const r = data.responsibility || {};
  const st = data.stability || {};
  const cc = data.changeCoupling || {};
  const ifl = data.informationFlow || {};
  const ds = data.dependencySmell || {};
  const co = data.capabilityOntology || {};

  // -- Semantic Layer (the part architects actually read) --
  const semantics = {};

  // 1. Architecture Pattern
  if (ap.patterns && ap.patterns.length > 0) {
    semantics.architecturePattern = {
      primary: ap.primaryPattern,
      confidence: ap.patterns[0].confidence,
      alternatives: ap.patterns.slice(1, 4).map((p) => ({
        pattern: p.pattern,
        confidence: p.confidence,
      })),
      evidence: ap.patterns[0].evidence.slice(0, 5),
    };
  } else {
    semantics.architecturePattern = { primary: "Unknown", confidence: 0 };
  }

  // 2. Responsibility Matrix (top 8 mapped modules)
  const mappedResponsibilities = (r.responsibilities || [])
    .filter((x) => x.responsibility !== "Uncategorized")
    .slice(0, 8)
    .map((x) => ({
      module: x.module,
      responsibility: x.responsibility,
      confidence: x.confidence,
      fileCount: x.fileCount,
      capabilities: x.capabilities,
    }));
  semantics.responsibility = {
    mapped: r.mappedModules || 0,
    total: r.totalModules || 0,
    topModules: mappedResponsibilities,
  };

  // 3. Stability (A/I) — top modules by coupling + zone distribution
  semantics.stability = {
    zoneDistribution: st.zoneDistribution || {},
    painModules: (st.painModules || []).map((m) => ({
      module: m.module,
      instability: m.instability,
      abstractness: m.abstractness,
    })),
    topModules: (st.modules || [])
      .slice(0, 6)
      .map((m) => ({
        module: m.module,
        I: m.instability,
        A: m.abstractness,
        zone: m.zone,
        Ca: m.ca,
        Ce: m.ce,
      })),
  };

  // 4. Change Coupling — top logical dependencies
  semantics.changeCoupling = {
    totalPairs: cc.totalPairs || 0,
    logicalPairs: cc.logicalPairs || 0,
    commitsAnalyzed: cc.totalCommitsAnalyzed || 0,
    topLogical: (cc.coupledPairs || [])
      .filter((p) => p.type === "logical")
      .slice(0, 5)
      .map((p) => ({
        files: p.files,
        coChangeCount: p.coChangeCount,
        coChangeRatio: p.coChangeRatio,
      })),
  };

  // 5. Information Flow
  semantics.informationFlow = {
    totalFlows: ifl.totalFlows || 0,
    reachesLLM: ifl.reachesLLM || false,
    llmCallSites: (ifl.llmCallSites || []).slice(0, 5),
    topFlows: (ifl.flows || []).slice(0, 3).map((f) => ({
      name: f.name,
      coverage: f.coverage,
      confidence: f.confidence,
      steps: f.steps.map((s) => `${s.role}${s.isLLMCall ? "[LLM]" : ""}`),
    })),
  };

  // 6. Dependency Smells
  semantics.dependencySmells = {
    total: ds.totalSmells || 0,
    highSeverity: ds.highSeverity || 0,
    byType: ds.byType || {},
    topSmells: (ds.smells || []).slice(0, 5).map((s) => ({
      type: s.type,
      severity: s.severity,
      from: s.from || s.module || "",
      to: s.to || "",
      rule: s.rule,
    })),
  };

  // 7. Capability Ontology
  semantics.capabilityOntology = {
    covered: co.coveredCapabilities || 0,
    total: co.totalCapabilities || 10,
    matrix: co.capabilityMatrix || {},
    strong: co.strongCapabilities || [],
    weak: co.weakCapabilities || [],
    missing: co.missingCapabilities || [],
    topCapabilities: (co.capabilities || [])
      .filter((c) => c.coverage !== "missing")
      .slice(0, 5)
      .map((c) => ({
        capability: c.capability,
        maturity: c.maturity,
        coverage: c.coverage,
        modules: c.modules,
      })),
  };

  // -- Raw Metrics (kept for completeness, but no longer the main output) --
  const s = data.symbols || {};
  const e = data.entrypoints || {};
  const p = data.prompts || {};
  const t = data.tools || {};
  const tests = data.tests || {};
  const evals = data.evaluations || {};
  const g = data.git || {};
  const c = data.ci || {};
  const rr = data.ranking || {};

  const entryByType = {};
  for (const ep of e.entrypoints || []) {
    entryByType[ep.type] = (entryByType[ep.type] || 0) + 1;
  }

  const rawMetrics = {
    discovery: {
      repoName: d.repoName,
      manifest: d.manifest ? { entry: d.manifest.entry, name: d.manifest.name, language: d.manifest.language } : null,
      totalSourceFiles: d.totalSourceFiles,
    },
    symbols: {
      totalFunctions: s.totalFunctions,
      totalClasses: s.totalClasses,
      totalImports: s.totalImports,
    },
    architecture: {
      totalNodes: a.totalNodes,
      totalEdges: a.totalEdges,
      cycles: (a.cycles || []).length,
    },
    entrypoints: { total: (e.entrypoints || []).length, byType: entryByType },
    prompts: { totalPrompts: p.totalPrompts },
    tools: { totalTools: t.totalTools },
    tests: { totalTestFiles: tests.totalTestFiles },
    evaluations: { hasEvaluation: evals.hasEvaluation, evalFiles: (evals.evalFiles || []).length },
    git: { totalCommits: g.totalCommits, totalContributors: g.totalContributors },
    ci: { hasCI: c.hasCI, provider: c.provider },
    ranking: { top5: (rr.topFiles || []).slice(0, 5).map((x) => `${x.path}(${x.score})`) },
  };

  return {
    file: path,
    repoName: d.repoName,
    // Semantics first — this is what architects read.
    semantics,
    // Raw metrics second — for completeness and debugging.
    rawMetrics,
  };
}

for (const f of files) {
  console.log("=".repeat(80));
  console.log(f);
  console.log("=".repeat(80));
  console.log(JSON.stringify(summarize(f), null, 2));
}
