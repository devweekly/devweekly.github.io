#!/usr/bin/env node
// ===========================================================================
// fixture-generator.mjs — Generate or update skill-test fixtures from real repos.
//
// Usage:
//   node skill-test/fixture-generator.mjs <repoPath|repoURL> <fixtureName> [options]
//
// Options:
//   --llm                  Run LLM stages (requires RESEARCH_REPO_LLM_CMD).
//   --e2e                  Generate e2e/fixtures layout (full pipeline output).
//   --update               Overwrite existing fixture files.
//   --expected-only        Only generate expected/ outputs from existing evidence-brief.md.
//   --archetype=<name>     Override detected archetype in baseline metrics.
//
// Examples:
//   # Deterministic fixture (analyzer output only):
//   node skill-test/fixture-generator.mjs https://github.com/duckdb/duckdb duckdb
//
//   # LLM-in-the-loop fixture (questions, hypotheses, opponent, report):
//   RESEARCH_REPO_LLM_CMD="llm -m claude-3-5-sonnet" \
//     node skill-test/fixture-generator.mjs ./duckdb duckdb --llm
//
// Behavior:
//   1. Clones repo if input is a URL.
//   2. Runs `research-repo.mjs all` and `report` to produce evidence.
//   3. Copies evidence-brief.md (and full.json summary) into the fixture dir.
//   4. If --llm, invokes the configured LLM command for each subagent stage.
//   5. Otherwise writes deterministic stubs for expected/ outputs.
//   6. Updates baseline-metrics.json with computed metrics.
// ===========================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { isLlmAvailable, runLlm, loadPromptTemplate } from "./lib/llm-runner.mjs";
import { computeFixtureMetrics } from "./lib/test-runner.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../research-repo.mjs");
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const E2E_FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "e2e/fixtures");
const BASELINE_PATH = join(FIXTURES_DIR, "baseline-metrics.json");

function runCommand(label, args, cwd, env = {}, timeout = 600000) {
  const result = spawnSync("node", args, {
    cwd,
    encoding: "utf-8",
    timeout,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function cloneRepo(url) {
  const dir = mkdtempSync(join(tmpdir(), "research-fixture-"));
  console.error(`[clone] ${url} → ${dir}`);
  const result = spawnSync("git", ["clone", "--depth", "1", url, dir], {
    encoding: "utf-8",
    timeout: 300000,
  });
  if (result.status !== 0) {
    throw new Error(`git clone failed: ${result.stderr}`);
  }
  return dir;
}

function extractJson(stdout) {
  let end = stdout.length - 1;
  while (end >= 0 && /\s/.test(stdout[end])) end--;
  if (end < 0) return null;
  const closer = stdout[end];
  if (closer !== "}" && closer !== "]") return null;
  const opener = closer === "}" ? "{" : "[";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = end; i >= 0; i--) {
    const ch = stdout[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === closer) depth++;
    else if (ch === opener) {
      depth--;
      if (depth === 0) return stdout.slice(i, end + 1);
    }
  }
  return null;
}

function runAnalyzer(repoPath) {
  const allStdout = runCommand("analyzer all", [SCRIPT, "all", repoPath], repoPath);
  const jsonPayload = extractJson(allStdout) || allStdout.trim();
  const store = JSON.parse(jsonPayload);

  const reportStdout = runCommand("analyzer report", [SCRIPT, "report", repoPath], repoPath);

  return { store, briefText: reportStdout };
}

function runLlmStage(repoName, stage, briefText, previousOutputs = {}) {
  if (!isLlmAvailable()) return null;

  const templates = {
    questions: "00-question-planner",
    hypotheses: "01-hypothesis",
    opponent: "04-opponent",
    report: "07-report-writer",
  };

  const templateName = templates[stage];
  if (!templateName) return null;

  let prompt = loadPromptTemplate(templateName, { repoName });
  prompt += "\n\n## 必读输入\n\n";
  prompt += briefText;

  if (stage === "hypotheses" && previousOutputs.questions) {
    prompt += "\n\n## 已生成的问题\n\n" + previousOutputs.questions;
  }
  if (stage === "opponent" && previousOutputs.report) {
    prompt += "\n\n## 已生成的报告\n\n" + previousOutputs.report;
  }
  if (stage === "report" && previousOutputs.questions) {
    prompt += "\n\n## 已验证的问题\n\n" + previousOutputs.questions;
  }

  console.error(`[llm] running ${stage}...`);
  return runLlm(prompt);
}

function writeDeterministicQuestions(repoName, archetype) {
  return `# Research Questions — ${repoName}\n\n## Archetype\n\n${archetype || "Unknown"}\n\n## Top 5 Questions\n\n### Q1: What is the primary responsibility of ${repoName}?\n- **Why it matters**: Defines the architectural boundary of the system.\n- **Expected Evidence**: README, entry points, core modules.\n- **Hypothesis**: ${repoName} implements its documented purpose.\n- **Alternative**: The repository may be a meta-package or thin wrapper.\n\n## Filtered Out\n\n- (stub: regenerate with --llm for real questions)\n`;
}

function writeDeterministicHypotheses() {
  return `# Hypotheses\n\n## H1: Primary Hypothesis\n\n- **Prior**: 0.5\n- **Evidence**: README and source code structure.\n- **Posterior**: 0.6\n- **Competing Hypothesis**: The repository is a collection of unrelated utilities.\n`;
}

function writeDeterministicOpponent() {
  return `# Opponent Report\n\n## Counter Evidence\n\n- README claims may not be fully implemented in code.\n- Missing tests for edge cases described in documentation.\n`;
}

function writeDeterministicReport(repoName, archetype) {
  return `# Research Report — ${repoName}\n\n## Executive Summary\n\n${repoName} is classified as ${archetype || "Unknown"}. This is a deterministic stub.\n\n## Top Claims\n\n### Claim 1: ${repoName} has a documented purpose\n\n**Why it holds**:\n- Evidence: README.md\n- Coverage: Documentation\n- Quality: Partially Verified\n\n**Why it might be wrong**:\n- README may be outdated or aspirational.\n\n**Why it matters**:\nWithout validating against source code, this claim remains tentative.\n\n## Appendix\n\n- **Reading Guide**: Inspect README and core source files.\n- **Open Questions**: See evidence-brief.md.\n\n## Quality Gate\n\n1. **What would invalidate this report?** Source code contradicts README claims.\n2. **What is most likely to be disagreed with?** The classification as ${archetype || "Unknown"}.\n3. **Is any Claim pretending to be certain when it should be Unknown?** Claim 1 is Partially Verified.\n`;
}

function generateExpectedOutputs(repoName, archetype, briefText, useLlm) {
  const outputs = {};

  if (useLlm && isLlmAvailable()) {
    outputs.questions = runLlmStage(repoName, "questions", briefText);
    outputs.hypotheses = runLlmStage(repoName, "hypotheses", briefText, { questions: outputs.questions });
    outputs.report = runLlmStage(repoName, "report", briefText, { questions: outputs.questions });
    outputs.opponent = runLlmStage(repoName, "opponent", briefText, { report: outputs.report });
  }

  if (!outputs.questions) outputs.questions = writeDeterministicQuestions(repoName, archetype);
  if (!outputs.hypotheses) outputs.hypotheses = writeDeterministicHypotheses();
  if (!outputs.opponent) outputs.opponent = writeDeterministicOpponent();
  if (!outputs.report) outputs.report = writeDeterministicReport(repoName, archetype);

  return outputs;
}

function updateBaselineMetrics(fixtureName, questionsText, reportText) {
  const metrics = computeFixtureMetrics(questionsText, reportText);
  const fixtureEntry = {
    questionCount: { value: metrics.questionCount, tolerance: 0 },
    claimCount: { value: metrics.claimCount, tolerance: 1 },
    verifiedCount: { value: metrics.verifiedCount, tolerance: 1 },
    partiallyVerifiedCount: { value: metrics.partiallyVerifiedCount, tolerance: 1 },
    documentationOnlyCount: { value: metrics.documentationOnlyCount, tolerance: 0 },
    unknownCount: { value: metrics.unknownCount, tolerance: 1 },
    hasQualityGate: metrics.hasQualityGate,
    hasReadingGuide: metrics.hasReadingGuide,
    hasFilteredOut: metrics.hasFilteredOut,
  };

  if (!existsSync(BASELINE_PATH)) {
    const baseline = {
      comment: "Regression baseline for skill-test expected outputs. Tolerance = max allowed deviation from baseline value.",
      fixtures: { [fixtureName]: fixtureEntry },
      qualityGates: {
        minQuestionCount: 5,
        maxClaimCount: 5,
        minQualityGatePresence: 1,
        maxDocumentationOnlyRatio: 0.5,
      },
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    return;
  }

  // Preserve formatting: replace only the changed fixture entry in the original text.
  const originalText = readFileSync(BASELINE_PATH, "utf-8");
  const baseline = JSON.parse(originalText);
  baseline.fixtures[fixtureName] = fixtureEntry;
  baseline.qualityGates = baseline.qualityGates || {
    minQuestionCount: 5,
    maxClaimCount: 5,
    minQualityGatePresence: 1,
    maxDocumentationOnlyRatio: 0.5,
  };

  // Find the fixture entry in the original text and replace it to keep surrounding formatting.
  const entryText = JSON.stringify(fixtureEntry, null, 2).split("\n").join("\n      ");
  const fixturePattern = new RegExp(`("${fixtureName}":\\s*)\\{[\\s\\S]*?\\n\\s*\\}`, "m");
  let updatedText;
  if (fixturePattern.test(originalText)) {
    updatedText = originalText.replace(fixturePattern, `$1${entryText}`);
  } else {
    // Append new fixture before the closing "fixtures" object brace.
    const insertPattern = /("fixtures":\s*\{[\s\S]*?)(\n\s*\},\s*\n\s*"qualityGates")/m;
    const newEntry = `\n    "${fixtureName}": ${JSON.stringify(fixtureEntry, null, 2).split("\n").join("\n    ")}`;
    updatedText = insertPattern.test(originalText)
      ? originalText.replace(insertPattern, `$1,${newEntry}$2`)
      : JSON.stringify(baseline, null, 2) + "\n";
  }

  writeFileSync(BASELINE_PATH, updatedText);
}

function copyDirectory(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: node fixture-generator.mjs <repoPath|repoURL> <fixtureName> [--llm] [--e2e] [--update] [--expected-only] [--archetype=<name>]"
    );
    process.exit(1);
  }

  const input = args[0];
  const fixtureName = args[1];
  const useLlm = args.includes("--llm");
  const isE2e = args.includes("--e2e");
  const update = args.includes("--update");
  const expectedOnly = args.includes("--expected-only");
  const archetypeFlag = args.find((a) => a.startsWith("--archetype="));
  const overrideArchetype = archetypeFlag ? archetypeFlag.split("=")[1] : null;

  if (useLlm && !isLlmAvailable()) {
    console.error("Error: --llm requires RESEARCH_REPO_LLM_CMD environment variable.");
    process.exit(1);
  }

  const fixtureDir = isE2e
    ? join(E2E_FIXTURES_DIR, fixtureName)
    : join(FIXTURES_DIR, fixtureName);

  if (existsSync(fixtureDir) && !update && !expectedOnly) {
    console.error(`Error: fixture ${fixtureName} already exists. Use --update to overwrite.`);
    process.exit(1);
  }

  let repoPath;
  let cleanupRepo = false;
  if (/^https?:\/\//.test(input)) {
    repoPath = cloneRepo(input);
    cleanupRepo = true;
  } else if (existsSync(input)) {
    repoPath = input;
  } else {
    console.error(`Error: path or URL not found: ${input}`);
    process.exit(1);
  }

  try {
    mkdirSync(fixtureDir, { recursive: true });

    let briefText;
    let store;
    let evidenceStoreDir;

    if (!expectedOnly) {
      const result = runAnalyzer(repoPath);
      store = result.store;
      briefText = result.briefText;

      evidenceStoreDir = join(process.cwd(), "evidence-store");
      writeFileSync(join(fixtureDir, "evidence-brief.md"), briefText);

      if (existsSync(join(evidenceStoreDir, "full.json"))) {
        mkdirSync(join(fixtureDir, "evidence-store"), { recursive: true });
        copyFileSync(join(evidenceStoreDir, "full.json"), join(fixtureDir, "evidence-store/full.json"));
      }
    } else {
      briefText = readFileSync(join(fixtureDir, "evidence-brief.md"), "utf-8");
      store = existsSync(join(fixtureDir, "evidence-store/full.json"))
        ? JSON.parse(readFileSync(join(fixtureDir, "evidence-store/full.json"), "utf-8"))
        : {};
    }

    const repoName = store.discovery?.repoName || store.discovery?.packageName || basename(repoPath) || fixtureName;
    const archetype =
      overrideArchetype ||
      store._meta?.archetype ||
      store._archetypeHints?.archetype ||
      "Unknown";

    const outputs = generateExpectedOutputs(repoName, archetype, briefText, useLlm);

    if (isE2e) {
      // E2E fixture layout: stage files at root + expected.json + report.md.
      writeFileSync(join(fixtureDir, "00-research-questions.md"), outputs.questions);
      writeFileSync(join(fixtureDir, "01-hypotheses.md"), outputs.hypotheses);
      writeFileSync(join(fixtureDir, "02-ontology.md"), "# Behavior Ontology\n\n(stub)\n");
      writeFileSync(join(fixtureDir, "04-opponent.md"), outputs.opponent);
      writeFileSync(join(fixtureDir, "05-cross-validation.md"), "# Cross Validation\n\nEvidence Graph: (stub)\n");
      writeFileSync(join(fixtureDir, "07-report.md"), outputs.report);
      writeFileSync(join(fixtureDir, "report.md"), outputs.report);

      const expected = {
        repository: { archetype: archetype.toLowerCase().includes("agent") ? "AI Agent" : archetype },
        report: {
          claims: { min: 2, max: 5 },
          unknown: { min: 1 },
          counter_evidence: { required: true },
          architecture_decision: { min: 1 },
        },
      };
      writeFileSync(join(fixtureDir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
    } else {
      // Regression fixture layout: expected/ directory.
      const expectedDir = join(fixtureDir, "expected");
      mkdirSync(expectedDir, { recursive: true });
      writeFileSync(join(expectedDir, "00-research-questions.md"), outputs.questions);
      writeFileSync(join(expectedDir, "01-hypotheses.md"), outputs.hypotheses);
      writeFileSync(join(expectedDir, "04-opponent.md"), outputs.opponent);
      writeFileSync(join(expectedDir, "07-report.md"), outputs.report);

      updateBaselineMetrics(fixtureName, outputs.questions, outputs.report);
    }

    console.error(`\nFixture generated: ${fixtureDir}`);
    console.error(`  archetype: ${archetype}`);
    console.error(`  llm: ${useLlm ? "yes" : "no (deterministic stubs)"}`);
    console.error(`  baseline updated: ${!isE2e}`);
  } finally {
    if (cleanupRepo) {
      rmSync(repoPath, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
