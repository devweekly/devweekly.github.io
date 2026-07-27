#!/usr/bin/env node
// ===========================================================================
// generate-baseline.mjs — Generate baseline-metrics.json from real Analyzer runs.
//
// Runs the Analyzer on each synthetic archetype repo, computes deterministic
// metrics, and writes them to fixtures/baseline-metrics.json. Run this after
// intentional Analyzer changes to update the regression baseline.
//
// Usage: node skill-test/generate-baseline.mjs
// ===========================================================================

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createSyntheticRepo, cleanupSyntheticRepo, ARCHETYPES } from "./lib/synthetic-repos.mjs";
import { runAnalyzerAll, runAnalyzerReport, computeAnalyzerMetrics } from "./lib/analyzer-runner.mjs";

const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures/baseline-metrics.json");

const repos = {};

for (const archetype of ARCHETYPES) {
  const dir = createSyntheticRepo(archetype);
  try {
    const store = runAnalyzerAll(dir);
    const brief = runAnalyzerReport(dir);
    const metrics = computeAnalyzerMetrics(store, brief);

    repos[archetype] = {
      // Quantity metrics (structural)
      functionCount: { value: metrics.functionCount, tolerance: 2 },
      classCount: { value: metrics.classCount, tolerance: 1 },
      toolCount: { value: metrics.toolCount, tolerance: 0 },
      promptCount: { value: metrics.promptCount, tolerance: 0 },
      testCount: { value: metrics.testCount, tolerance: 1 },
      signalCount: { value: metrics.signalCount, tolerance: 0 },
      briefLength: { value: metrics.briefLength, tolerance: 500 },
      briefFindingCount: { value: metrics.briefFindingCount, tolerance: 3 },
      fileCount: { value: metrics.fileCount, tolerance: 1 },
      // Quality metrics (semantic) — detect Skill quality regressions
      evidenceDensity: { value: metrics.evidenceDensity, tolerance: 0.3 },
      decisionQuality: { value: metrics.decisionQuality, tolerance: 0.1 },
      decisionReusability: { value: metrics.decisionReusability, tolerance: 0.1 },
      unknownRatio: { value: metrics.unknownRatio, tolerance: 0.1 },
      counterEvidenceRatio: { value: metrics.counterEvidenceRatio, tolerance: 0.1 },
      avgConfidence: { value: metrics.avgConfidence, tolerance: 0.1 },
      readmeContradictionCount: { value: metrics.readmeContradictionCount, tolerance: 1 },
      provenanceCoverage: { value: metrics.provenanceCoverage, tolerance: 0.1 },
    };

    console.error(`${archetype}: ${JSON.stringify(metrics)}`);
  } finally {
    cleanupSyntheticRepo(dir);
  }
}

const baseline = {
  comment: "Regression baseline from real Analyzer runs on synthetic archetype repos. Tolerance = max allowed deviation. Run `node skill-test/generate-baseline.mjs` to regenerate after intentional Analyzer changes.",
  repos,
};

writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
console.error(`\nBaseline written to: ${BASELINE_PATH}`);
