#!/usr/bin/env node
// ===========================================================================
// skill-test.mjs — Test harness for the research-repo Skill
//
// Runs six layers of behavioral tests and prints a CI-style report:
//   1. Unit Test — Analyzer JSON output contracts
//   2. Prompt Unit Test
//   3. Behavior Test
//   4. Mutation / Adversarial Test
//   5. Regression Suite
//   6. End-to-End Pipeline Test
//
// Usage:
//   node skill-test/skill-test.mjs
//   node skill-test/skill-test.mjs --layer=unit
//   node skill-test/skill-test.mjs --layer=prompt
//   node skill-test/skill-test.mjs --layer=behavior
//   node skill-test/skill-test.mjs --layer=e2e
// ===========================================================================

import { runQuestionPlannerTests } from "./tests/prompt-unit/00-question-planner.test.mjs";
import { runHypothesisTests } from "./tests/prompt-unit/01-hypothesis.test.mjs";
import { runOpponentTests } from "./tests/prompt-unit/04-opponent.test.mjs";
import { runReportWriterTests } from "./tests/prompt-unit/07-report-writer.test.mjs";
import { runArchetypeBehaviorTests } from "./tests/behavior/archetype-behavior.test.mjs";
import { runMutationTests } from "./tests/mutation/missing-evidence.test.mjs";
import { runRegressionTests } from "./tests/regression/metrics-regression.test.mjs";
import { runPipelineE2ETests } from "./tests/e2e/pipeline-e2e.test.mjs";
import { runAnalyzerOutputTests } from "./tests/unit/analyzer-output.test.mjs";

const args = process.argv.slice(2);
const requestedLayer = args
  .find((a) => a.startsWith("--layer="))
  ?.replace("--layer=", "");

const LAYERS = {
  unit: [runAnalyzerOutputTests],
  prompt: [
    runQuestionPlannerTests,
    runHypothesisTests,
    runOpponentTests,
    runReportWriterTests,
  ],
  behavior: [runArchetypeBehaviorTests],
  mutation: [runMutationTests],
  regression: [runRegressionTests],
  e2e: [runPipelineE2ETests],
};

function printBanner(text) {
  const line = "=".repeat(50);
  console.log(`\n${line}`);
  console.log(text);
  console.log(line);
}

function printSuite(result, indent = "") {
  console.log(`${indent}${result.name}: ${result.passCount}/${result.total} passed`);
  for (const c of result.failed) {
    console.log(`${indent}  ✗ ${c.case}`);
    console.log(`${indent}    ${c.error}`);
  }
  for (const c of result.skipped) {
    console.log(`${indent}  ⊘ ${c.case} — ${c.reason}`);
  }
}

function runLayer(name, runners) {
  printBanner(name);
  const results = runners.map((fn) => fn());
  for (const r of results) {
    printSuite(r, "  ");
  }
  const totalPassed = results.reduce((sum, r) => sum + r.passCount, 0);
  const total = results.reduce((sum, r) => sum + r.total, 0);
  const ok = results.every((r) => r.ok);
  const pct = total > 0 ? Math.round((totalPassed / total) * 100) : 100;
  console.log(`  Layer total: ${totalPassed}/${total} (${pct}%) ${ok ? "PASS" : "FAIL"}`);
  return { name, results, totalPassed, total, ok, pct };
}

function main() {
  console.log("research-repo skill-test");
  console.log("Deterministic structural + behavioral test suite");

  const layerNames = requestedLayer ? [requestedLayer] : Object.keys(LAYERS);
  const layers = [];

  for (const name of layerNames) {
    const runners = LAYERS[name];
    if (!runners) {
      console.error(`Unknown layer: ${name}. Valid: ${Object.keys(LAYERS).join(", ")}`);
      process.exit(2);
    }
    layers.push(runLayer(name.toUpperCase(), runners));
  }

  const grandPassed = layers.reduce((sum, l) => sum + l.totalPassed, 0);
  const grandTotal = layers.reduce((sum, l) => sum + l.total, 0);
  const grandOk = layers.every((l) => l.ok);
  const grandPct = grandTotal > 0 ? Math.round((grandPassed / grandTotal) * 100) : 100;

  printBanner("OVERALL");
  for (const l of layers) {
    console.log(`${l.name}: ${l.pct}% ${l.ok ? "PASS" : "FAIL"}`);
  }
  console.log(`\nTOTAL: ${grandPassed}/${grandTotal} (${grandPct}%) ${grandOk ? "PASS" : "FAIL"}`);

  if (!grandOk) {
    console.log("\nTip: Each layer runs the real Analyzer on synthetic repos.");
    console.log("If a behavior/mutation/e2e/regression test fails, the Analyzer pipeline changed.");
    console.log("If a prompt template contract fails, the prompt template lost a required instruction.");
    console.log("To run LLM-driven prompt tests, set RESEARCH_REPO_LLM_CMD.");
  }

  process.exit(grandOk ? 0 : 1);
}

main();
