#!/usr/bin/env node
// ===========================================================================
// run-e2e.mjs — End-to-end test runner for the research-repo Skill.
//
// Usage:
//   node skill-test/e2e/run-e2e.mjs <researchDir> [--expected=<yaml|json>] [--snapshot]
//   node skill-test/e2e/run-e2e.mjs --fixtures [--snapshot]
//   node skill-test/e2e/run-e2e.mjs --fixtures --update-snapshot
//
// Behavior:
//   1. Runs stage-by-stage checks on the research output directory.
//   2. Runs behavioral verification (expected.yaml / expected.json).
//   3. Computes quality metrics.
//   4. Compares current output against stored snapshots (with --snapshot).
//   5. Prints a CI-style report and exits with 0 only if all checks pass.
// ===========================================================================

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAllStages } from "./stage-checks.mjs";
import { verifyResearchDirectory, loadExpectedYaml } from "./verify-directory.mjs";
import { compareSnapshot, updateSnapshot, printSnapshotDiff } from "./snapshot-manager.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

function printBanner(text) {
  const line = "=".repeat(60);
  console.log(`\n${line}`);
  console.log(text);
  console.log(`${line}`);
}

function printStageChecks(stageResult) {
  for (const c of stageResult.checks) {
    const icon = c.ok ? "✓" : "✗";
    console.log(`  ${icon} [${c.stage}] ${c.name}`);
    if (!c.ok) {
      console.log(`      ${c.message}`);
    }
  }
}

function printMetrics(metrics) {
  console.log("\n  Quality Metrics:");
  for (const [key, value] of Object.entries(metrics)) {
    const formatted = typeof value === "number" ? value.toFixed(2) : value;
    console.log(`    ${key}: ${formatted}`);
  }
}

function runE2E(researchDir, expectedPath, { snapshot = false, updateSnapshot: update = false, fixtureName = null } = {}) {
  printBanner(`E2E: ${researchDir}`);

  if (!existsSync(researchDir)) {
    console.error(`Error: directory does not exist: ${researchDir}`);
    process.exit(1);
  }

  // Stage checks
  const stageResult = validateAllStages(researchDir);
  printStageChecks(stageResult);

  // Behavioral verification
  let expected = {};
  if (expectedPath && existsSync(expectedPath)) {
    expected = loadExpectedYaml(expectedPath);
  } else if (existsSync(join(researchDir, "expected.json"))) {
    expected = JSON.parse(readFileSync(join(researchDir, "expected.json"), "utf-8"));
  } else if (existsSync(join(researchDir, "expected.yaml"))) {
    expected = loadExpectedYaml(join(researchDir, "expected.yaml"));
  }

  const verifyResult = verifyResearchDirectory(researchDir, expected);

  console.log(`\n  Stage checks: ${stageResult.passed}/${stageResult.total} passed`);
  console.log(`  Behavioral checks: ${verifyResult.checks.filter((c) => c.status === "pass").length}/${verifyResult.checks.length} passed`);

  if (verifyResult.errors.length > 0) {
    console.log("\n  Failures:");
    for (const err of verifyResult.errors) {
      console.log(`    ✗ ${err}`);
    }
  }

  printMetrics(verifyResult.metrics);

  // Snapshot management
  let snapshotResult = null;
  const name = fixtureName || expected.repository?.name || "research-output";
  if (update) {
    snapshotResult = updateSnapshot(researchDir, name);
    console.log(`\n  Snapshot updated: ${snapshotResult.fileCount} files → skill-test/e2e/snapshots/${name}`);
  } else if (snapshot) {
    snapshotResult = compareSnapshot(researchDir, name);
    console.log("\n  Snapshot comparison:");
    printSnapshotDiff(snapshotResult);
  }

  const snapshotOk = !snapshotResult || snapshotResult.ok;
  const ok = stageResult.ok && verifyResult.ok && (update || snapshotOk);
  console.log(`\n  Result: ${ok ? "PASS" : "FAIL"}`);

  return {
    dir: researchDir,
    stageResult,
    verifyResult,
    snapshotResult,
    ok,
  };
}

function runAllFixtures(options) {
  const fixtures = readdirSync(FIXTURES_DIR).filter((name) =>
    existsSync(join(FIXTURES_DIR, name, "expected.json"))
  );

  const results = [];
  for (const fixture of fixtures) {
    const researchDir = join(FIXTURES_DIR, fixture);
    const expectedPath = join(researchDir, "expected.json");
    results.push(runE2E(researchDir, expectedPath, { ...options, fixtureName: fixture }));
  }

  const allOk = results.every((r) => r.ok);
  const totalPassed = results.reduce((sum, r) => sum + r.stageResult.passed, 0);
  const totalChecks = results.reduce((sum, r) => sum + r.stageResult.total, 0);

  printBanner("E2E OVERALL");
  for (const r of results) {
    console.log(`  ${r.dir}: ${r.ok ? "PASS" : "FAIL"}`);
  }
  console.log(`\n  Total stage checks passed: ${totalPassed}/${totalChecks}`);
  console.log(`\n  RESULT: ${allOk ? "PASS" : "FAIL"}`);

  process.exit(allOk ? 0 : 1);
}

async function main() {
  const args = process.argv.slice(2);
  const snapshot = args.includes("--snapshot");
  const updateSnapshot = args.includes("--update-snapshot");
  const options = { snapshot, updateSnapshot };

  if (args.includes("--fixtures") || args.length === 0) {
    runAllFixtures(options);
    return;
  }

  const researchDir = args[0];
  const expectedFlag = args.find((a) => a.startsWith("--expected="));
  const expectedPath = expectedFlag ? expectedFlag.split("=")[1] : null;

  const result = runE2E(researchDir, expectedPath, options);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
