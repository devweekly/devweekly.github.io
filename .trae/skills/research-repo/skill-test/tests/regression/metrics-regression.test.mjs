// ===========================================================================
// metrics-regression.test.mjs — Regression Suite (LIVE)
//
// Runs the real Analyzer on synthetic archetype repos, computes deterministic
// metrics from the actual evidence store + evidence-brief, and compares
// against baseline values. If the Analyzer output drifts beyond tolerance,
// the test fails — detecting regressions in symbol extraction, signal
// detection, or evidence-brief generation.
//
// This is NOT a fixture-vs-fixture comparison. The baseline comes from real
// Analyzer runs and is updated via `--update-baseline` when intentional
// changes are made.
// ===========================================================================

import { runSuite, loadJsonFixture } from "../../lib/test-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runAnalyzerAll, runAnalyzerReport, computeAnalyzerMetrics } from "../../lib/analyzer-runner.mjs";

const BASELINE = loadJsonFixture("baseline-metrics.json", { repos: {} });
const REPO_BASELINE = BASELINE.repos || BASELINE.fixtures || {};

const ARCHETYPES = [
  {
    name: "database",
    expectedSignals: ["hasSQL", "hasParser", "hasLexer"],
  },
  {
    name: "agent",
    expectedSignals: ["hasAgent", "hasTool"],
  },
  {
    name: "tool",
    expectedSignals: ["hasPlugin"],
  },
  {
    name: "readme-claims",
    expectedSignals: [],
  },
];

function withRepo(archetype, fn) {
  return (result) => {
    const dir = createSyntheticRepo(archetype);
    try {
      fn(result, dir);
    } finally {
      cleanupSyntheticRepo(dir);
    }
  };
}

function checkMetric(result, label, actual, baseline, tolerance) {
  result.record(label, () => {
    const diff = Math.abs(actual - baseline);
    if (diff > tolerance) {
      throw new Error(`${label}: ${actual} vs baseline ${baseline} (tolerance ${tolerance})`);
    }
  });
}

function makeRegressionCase(archetype) {
  const baseline = REPO_BASELINE[archetype.name];
  const hasBaseline = Boolean(baseline);

  return {
    name: `${archetype.name} repo: analyzer metrics ${hasBaseline ? "match baseline" : "(no baseline — establishing)"}`,
    test: withRepo(archetype.name, (result, dir) => {
      const store = runAnalyzerAll(dir);
      const brief = runAnalyzerReport(dir);
      const metrics = computeAnalyzerMetrics(store, brief);

      // Always check signal expectations (these are hard contracts).
      result.record(`${archetype.name}: signalCount matches expected`, () => {
        if (metrics.signalCount < archetype.expectedSignals.length) {
          throw new Error(
            `Expected ≥${archetype.expectedSignals.length} signals, got ${metrics.signalCount}`
          );
        }
      });

      result.record(`${archetype.name}: brief is non-empty`, () => {
        if (metrics.briefLength < 100) throw new Error(`Brief too short: ${metrics.briefLength} chars`);
      });

      result.record(`${archetype.name}: fileCount > 0`, () => {
        if (metrics.fileCount === 0) throw new Error("Expected non-zero file count");
      });

      // Check baseline-bound metrics (only if baseline exists).
      if (hasBaseline) {
        if (baseline.functionCount) {
          checkMetric(result, `${archetype.name}: functionCount`, metrics.functionCount, baseline.functionCount.value, baseline.functionCount.tolerance);
        }
        if (baseline.classCount) {
          checkMetric(result, `${archetype.name}: classCount`, metrics.classCount, baseline.classCount.value, baseline.classCount.tolerance);
        }
        if (baseline.signalCount) {
          checkMetric(result, `${archetype.name}: signalCount`, metrics.signalCount, baseline.signalCount.value, baseline.signalCount.tolerance);
        }
        if (baseline.toolCount) {
          checkMetric(result, `${archetype.name}: toolCount`, metrics.toolCount, baseline.toolCount.value, baseline.toolCount.tolerance);
        }
        if (baseline.promptCount) {
          checkMetric(result, `${archetype.name}: promptCount`, metrics.promptCount, baseline.promptCount.value, baseline.promptCount.tolerance);
        }
        if (baseline.fileCount) {
          checkMetric(result, `${archetype.name}: fileCount`, metrics.fileCount, baseline.fileCount.value, baseline.fileCount.tolerance);
        }
      }
    }),
  };
}

export function runRegressionTests() {
  return runSuite("regression — analyzer metrics (live)", ARCHETYPES.map(makeRegressionCase));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runRegressionTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
