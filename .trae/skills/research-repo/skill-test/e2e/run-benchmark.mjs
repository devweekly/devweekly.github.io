#!/usr/bin/env node
// ===========================================================================
// run-benchmark.mjs — Architecture Benchmark for the research-repo Skill.
//
// Runs the real Analyzer against a fixed set of benchmark repositories and
// compares key quality metrics against a stored benchmark baseline.
//
// Benchmark metrics (per repo):
//   - findingCount          — total Findings generated
//   - evidenceCount         — total evidence items across all Findings
//   - unsupportedClaimCount — Findings with confidence < 0.3 (rejected by Verification)
//   - hallucinationCount    — Findings that contradict analyzer's own signals
//                             (caught by ConsistencyAnalyzer contradictions)
//   - unknownRatio          — fraction of Findings that say "Unknown" (honesty)
//   - avgConfidence         — mean confidence across all Findings
//   - decisionCount         — total architectural decisions detected
//   - patternCount          — total architecture patterns detected
//   - readmeContradictionCount — Q8 findings flagging README false claims
//
// Usage:
//   node skill-test/e2e/run-benchmark.mjs                       # synthetic benchmark
//   node skill-test/e2e/run-benchmark.mjs --repo=/path/to/repo  # add a real repo
//   node skill-test/e2e/run-benchmark.mjs --update              # update baseline
//   node skill-test/e2e/run-benchmark.mjs --diff                # diff vs baseline
//
// Output:
//   skill-test/e2e/benchmark-baseline.json   (stored baseline)
//   stdout: CI-style report with PASS/FAIL per metric
// ===========================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createSyntheticRepo, cleanupSyntheticRepo, ARCHETYPES } from "../lib/synthetic-repos.mjs";
import { runPipelineToDirectory, computeAnalyzerMetrics } from "../lib/analyzer-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, "benchmark-baseline.json");

// Tolerances for benchmark comparison — based on observed variance.
const TOLERANCES = {
  findingCount: 3,                  // allow small drift
  evidenceCount: 10,                // evidence items fluctuate more
  unsupportedClaimCount: 2,         // rejected findings should be stable
  hallucinationCount: 1,            // contradictions should be rare
  unknownRatio: 0.15,               // honesty ratio can drift
  avgConfidence: 0.10,              // confidence should be stable
  decisionCount: 3,                 // decisions may shift with heuristic tweaks
  patternCount: 2,                  // patterns should be stable
  readmeContradictionCount: 2,      // Q8 findings fluctuate based on README
};

/**
 * Compute benchmark metrics from a real Analyzer run.
 * "Hallucination" = ConsistencyAnalyzer contradictions (analyzer caught
 * its own contradiction — these are the closest deterministic signal to
 * "the LLM would have fabricated here").
 */
function computeBenchmarkMetrics(store, brief) {
  const base = computeAnalyzerMetrics(store, brief);
  const findings = store.findings?.findings || [];
  const contradictions = store.consistency?.contradictions || [];

  return {
    findingCount: findings.length,
    evidenceCount: findings.reduce((s, f) => s + (f.support || []).length, 0),
    unsupportedClaimCount: findings.filter((f) => f.confidence < 0.3).length,
    hallucinationCount: contradictions.length,
    unknownRatio: base.unknownRatio,
    avgConfidence: base.avgConfidence,
    decisionCount: store.decisions?.decisions?.length || 0,
    patternCount: (store.archPattern?.patterns || []).length,
    readmeContradictionCount: base.readmeContradictionCount,
  };
}

/**
 * Run benchmark against one synthetic archetype repo.
 */
function runSyntheticBenchmark(archetype) {
  const repoDir = createSyntheticRepo(archetype);
  const outputDir = join(__dirname, ".benchmark-tmp", archetype);
  try {
    mkdirSync(outputDir, { recursive: true });
    const { store, brief } = runPipelineToDirectory(repoDir, outputDir);
    const metrics = computeBenchmarkMetrics(store, brief);
    return { name: `synthetic:${archetype}`, metrics };
  } finally {
    cleanupSyntheticRepo(repoDir);
    rmSync(outputDir, { recursive: true, force: true });
  }
}

/**
 * Run benchmark against a local real repository.
 */
function runLocalBenchmark(repoPath, name) {
  const outputDir = join(__dirname, ".benchmark-tmp", name || "local");
  try {
    mkdirSync(outputDir, { recursive: true });
    const { store, brief } = runPipelineToDirectory(repoPath, outputDir);
    const metrics = computeBenchmarkMetrics(store, brief);
    return { name: name || `local:${repoPath}`, metrics };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
}

function saveBaseline(results) {
  const baseline = {
    comment: "Architecture Benchmark baseline. Run `node skill-test/e2e/run-benchmark.mjs --update` to regenerate after intentional Skill changes.",
    generatedAt: new Date().toISOString(),
    repos: {},
  };
  for (const r of results) {
    baseline.repos[r.name] = r.metrics;
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`Baseline saved: ${BASELINE_PATH}`);
}

function compareMetric(name, live, baseline, tol) {
  const delta = Math.abs(live - baseline);
  const ok = delta <= tol;
  const icon = ok ? "✓" : "✗";
  const trend = live > baseline ? "+" : "";
  console.log(`    ${icon} ${name}: ${trend}${delta.toFixed(2)} (live=${live}, base=${baseline}, tol=${tol})`);
  return ok;
}

function compareAgainstBaseline(results, baseline) {
  let allOk = true;
  console.log("\n=== Benchmark Comparison ===\n");
  for (const r of results) {
    const baseRepo = baseline.repos[r.name];
    if (!baseRepo) {
      console.log(`  ${r.name}: (new — no baseline, skipped)`);
      continue;
    }
    console.log(`  ${r.name}:`);
    let repoOk = true;
    for (const key of Object.keys(TOLERANCES)) {
      const live = r.metrics[key] ?? 0;
      const base = baseRepo[key] ?? 0;
      const tol = TOLERANCES[key];
      if (!compareMetric(key, live, base, tol)) repoOk = false;
    }
    if (!repoOk) allOk = false;
    console.log(`    → ${repoOk ? "PASS" : "FAIL"}\n`);
  }
  return allOk;
}

function printMetricsTable(results) {
  console.log("\n=== Benchmark Metrics ===\n");
  const keys = Object.keys(TOLERANCES);
  console.log("  " + ["repo", ...keys].map((k) => k.padEnd(22)).join(" | "));
  console.log("  " + "-".repeat(22 * (keys.length + 1) + 3));
  for (const r of results) {
    const cells = [r.name, ...keys.map((k) => String(r.metrics[k] ?? 0))];
    console.log("  " + cells.map((c) => c.padEnd(22)).join(" | "));
  }
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const repoArg = args.find((a) => a.startsWith("--repo="));
  const nameArg = args.find((a) => a.startsWith("--name="));

  console.log("=== Architecture Benchmark ===\n");

  const results = [];

  // Always run synthetic benchmark suite
  for (const archetype of ARCHETYPES) {
    console.log(`Running synthetic benchmark: ${archetype}...`);
    results.push(runSyntheticBenchmark(archetype));
  }

  // Optional: run against a real local repo
  if (repoArg) {
    const repoPath = repoArg.split("=")[1];
    const name = nameArg ? nameArg.split("=")[1] : `local:${repoPath.split("/").pop()}`;
    console.log(`Running local benchmark: ${name} (${repoPath})...`);
    try {
      results.push(runLocalBenchmark(repoPath, name));
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  printMetricsTable(results);

  if (update) {
    saveBaseline(results);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log("\nNo baseline found. Run with --update to create one.");
    process.exit(0);
  }

  const ok = compareAgainstBaseline(results, baseline);
  console.log(`\n=== RESULT: ${ok ? "PASS" : "FAIL"} ===`);
  process.exit(ok ? 0 : 1);
}

main();
