import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node analyze-output.mjs <full.json> ...");
  process.exit(1);
}

function summarize(path) {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const d = data.discovery || {};
  const s = data.symbols || {};
  const a = data.architecture || {};
  const e = data.entrypoints || {};
  const p = data.prompts || {};
  const t = data.tools || {};
  const tests = data.tests || {};
  const evals = data.evaluations || {};
  const g = data.git || {};
  const c = data.ci || {};
  const r = data.ranking || {};
  const plan = data.plan || {};
  const q = data.questions || {};

  const entryByType = {};
  for (const ep of e.entrypoints || []) {
    entryByType[ep.type] = (entryByType[ep.type] || 0) + 1;
  }

  return {
    file: path,
    discovery: {
      repoName: d.repoName,
      manifest: d.manifest ? { entry: d.manifest.entry, name: d.manifest.name } : null,
      hasReadme: d.hasReadme,
      topLevelDirs: (d.topLevelDirs || []).slice(0, 10),
      architectureSignalDirs: (d.architectureSignalDirs || []).length,
      metadataFiles: d.metadataFiles || [],
      agentFiles: d.agentFiles || [],
      totalSourceFiles: d.totalSourceFiles,
      fileCount: d.fileCount,
    },
    symbols: {
      totalFunctions: s.totalFunctions,
      totalClasses: s.totalClasses,
      totalImports: s.totalImports,
      totalCalls: s.totalCalls,
      totalStrings: s.totalStrings,
    },
    architecture: {
      totalNodes: a.totalNodes,
      totalEdges: a.totalEdges,
      cycles: (a.cycles || []).length,
      topInDegree: (a.centrality?.topByInDegree || []).slice(0, 5).map((x) => `${x.id}(${x.value})`),
      topPageRank: (a.centrality?.topByPageRank || []).slice(0, 5).map((x) => `${x.id}(${x.value.toFixed(3)})`),
    },
    entrypoints: {
      total: (e.entrypoints || []).length,
      byType: entryByType,
      first10: (e.entrypoints || []).slice(0, 10).map((x) => `${x.type}: ${x.path}`),
    },
    prompts: {
      totalPrompts: p.totalPrompts,
      byType: countBy((p.prompts || []).map((x) => x.type)),
    },
    tools: {
      totalTools: t.totalTools,
      byFramework: countBy((t.tools || []).map((x) => x.framework)),
    },
    tests: {
      totalTestFiles: tests.totalTestFiles,
      totalTestFunctions: tests.totalTestFunctions,
      byCategory: tests.byCategory,
      patterns: tests.patterns,
    },
    evaluations: {
      hasEvaluation: evals.hasEvaluation,
      evalFiles: (evals.evalFiles || []).length,
      evalDirs: (evals.evalDirs || []).length,
      patterns: evals.patterns,
      metrics: evals.metrics,
    },
    git: {
      totalCommits: g.totalCommits,
      totalContributors: g.totalContributors,
      topActiveModules: (g.topActiveModules || []).slice(0, 5),
    },
    ci: {
      hasCI: c.hasCI,
      provider: c.provider,
      workflows: (c.workflows || []).length,
    },
    ranking: {
      top10: (r.topFiles || []).slice(0, 10).map((x) => `${x.path}(${x.score})`),
    },
    plan: {
      hypotheses: (plan.hypotheses || []).length,
      gaps: (plan.hypotheses || []).flatMap((h) => h.gaps.map((g) => `${h.id}: ${g}`)),
      readingPlan: (plan.readingPlan || []).length,
    },
    questions: {
      count: (q.questions || []).length,
      items: (q.questions || []).map((x) => `[${x.priority}] ${x.category}: ${x.question}`),
    },
  };
}

function countBy(arr) {
  const c = {};
  for (const x of arr) c[x] = (c[x] || 0) + 1;
  return c;
}

for (const f of files) {
  console.log("=".repeat(80));
  console.log(f);
  console.log("=".repeat(80));
  console.log(JSON.stringify(summarize(f), null, 2));
}
