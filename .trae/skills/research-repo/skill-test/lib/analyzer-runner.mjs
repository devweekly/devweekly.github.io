// ===========================================================================
// analyzer-runner.mjs — Shared Analyzer subprocess helper for test layers.
//
// Runs `research-repo.mjs` commands on a repo path and returns parsed output.
// Used by Behavior, Mutation, E2E, and Regression test layers to run the real
// Analyzer pipeline instead of checking static fixture files.
// ===========================================================================

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../research-repo.mjs");

/**
 * Run a research-repo.mjs command and return stdout.
 * @param {string} command - Analyzer command (discovery, symbols, all, report, etc.)
 * @param {string} repoPath - Path to the repository to analyze
 * @param {object} options - { timeout, cwd }
 * @returns {string} stdout output
 */
export function runAnalyzerCommand(command, repoPath, options = {}) {
  const { timeout = 120000, cwd } = options;
  const result = spawnSync("node", [SCRIPT, command, repoPath], {
    cwd: cwd || repoPath,
    encoding: "utf-8",
    timeout,
    env: process.env,
  });
  if (result.status !== 0) {
    const msg = result.stderr || result.stdout || "unknown error";
    throw new Error(`Analyzer '${command}' failed (exit ${result.status}): ${msg.slice(0, 1000)}`);
  }
  return result.stdout;
}

/**
 * Extract the last balanced JSON object/array from stdout.
 * Handles commands that emit markdown/progress before the JSON payload.
 */
export function extractJson(stdout) {
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

/**
 * Run `research-repo.mjs all` and return the parsed evidence store JSON.
 * @param {string} repoPath
 * @returns {object} evidence store
 */
export function runAnalyzerAll(repoPath) {
  const stdout = runAnalyzerCommand("all", repoPath);
  const payload = extractJson(stdout) || stdout.trim();
  return JSON.parse(payload);
}

/**
 * Run `research-repo.mjs report` and return the evidence-brief markdown.
 * @param {string} repoPath
 * @returns {string} evidence-brief markdown text
 */
export function runAnalyzerReport(repoPath) {
  return runAnalyzerCommand("report", repoPath);
}

/**
 * Run the full deterministic pipeline on a repo and write outputs to a directory.
 * Produces: evidence-store/full.json, evidence-brief.md
 * @param {string} repoPath
 * @param {string} outputDir
 * @returns {{ store: object, brief: string }}
 */
export function runPipelineToDirectory(repoPath, outputDir) {
  mkdirSync(join(outputDir, "evidence-store"), { recursive: true });

  const store = runAnalyzerAll(repoPath);
  writeFileSync(join(outputDir, "evidence-store/full.json"), JSON.stringify(store, null, 2));

  const brief = runAnalyzerReport(repoPath);
  writeFileSync(join(outputDir, "evidence-brief.md"), brief);

  return { store, brief };
}

/**
 * Extract archetype signals from an evidence store.
 * @param {object} store
 * @returns {object} signals object (hasSQL, hasAgent, etc.)
 */
export function getSignals(store) {
  const hints = store._archetypeHints || store.archetypeHints || {};
  return hints.signals || {};
}

/**
 * Compute deterministic metrics from a real evidence store + brief.
 * Used by regression tests to detect Analyzer output drift.
 *
 * Two tiers of metrics:
 *   - Quantity metrics (functionCount, classCount, ...): detect structural drift
 *   - Quality metrics (evidenceDensity, decisionQuality, ...): detect semantic drift
 *
 * Quality metrics answer "did Skill quality improve?" not just "did output change?".
 *
 * @param {object} store
 * @param {string} brief
 * @returns {object}
 */
export function computeAnalyzerMetrics(store, brief) {
  const symbols = store.symbols || {};
  const rawFileCount = store.discovery?.fileCount;
  const fileCount = typeof rawFileCount === "number"
    ? rawFileCount
    : Array.isArray(store.discovery?.files)
      ? store.discovery.files.length
      : typeof rawFileCount === "object" && rawFileCount !== null
        ? Object.values(rawFileCount).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0)
        : 0;

  // ── Quantity metrics (structural drift detection) ──────────────────────
  const quantity = {
    functionCount: (symbols.functions || []).length,
    classCount: (symbols.classes || []).length,
    toolCount: store.tools?.totalTools || 0,
    promptCount: store.prompts?.totalPrompts || 0,
    testCount: store.tests?.totalTestFiles || store.tests?.total || (store.tests?.fileDetails || []).length || 0,
    signalCount: Object.values(getSignals(store)).filter(Boolean).length,
    briefLength: (brief || "").length,
    briefFindingCount: (((brief || "").match(/F-\d{3,}/g) || []).length),
    fileCount,
  };

  // ── Quality metrics (semantic drift detection) ─────────────────────────
  // These answer "did Skill quality improve?" — not just "did output change?".
  const findings = store.findings?.findings || [];
  const decisions = store.decisions?.decisions || [];
  const totalFindings = findings.length;

  // evidenceDensity: average evidence items per finding (higher = more grounded)
  const totalEvidenceItems = findings.reduce((sum, f) => sum + (f.support || []).length, 0);
  const evidenceDensity = totalFindings > 0 ? totalEvidenceItems / totalFindings : 0;

  // decisionQuality: fraction of decisions with both tradeoff AND alternatives (ADR-completeness)
  const decisionsWithTradeoffAndAlternatives = decisions.filter(
    (d) => d.tradeoff && d.alternatives
  ).length;
  const decisionQuality = decisions.length > 0 ? decisionsWithTradeoffAndAlternatives / decisions.length : 0;

  // decisionReusability: average reusability score across decisions (0-1)
  const decisionReusability = decisions.length > 0
    ? decisions.reduce((sum, d) => sum + (d.reusability || 0), 0) / decisions.length
    : 0;

  // unknownRatio: fraction of findings that mention Unknown (honesty signal)
  const findingsWithUnknown = findings.filter((f) =>
    /\bunknown\b|not detected|no\s+\w+\s+detected|not classified/i.test(f.finding || "")
  ).length;
  const unknownRatio = totalFindings > 0 ? findingsWithUnknown / totalFindings : 0;

  // counterEvidenceRatio: fraction of findings with counter evidence (adversarial signal)
  const findingsWithCounter = findings.filter((f) => (f.counter || []).length > 0).length;
  const counterEvidenceRatio = totalFindings > 0 ? findingsWithCounter / totalFindings : 0;

  // avgConfidence: mean confidence across findings (stability signal)
  const avgConfidence = totalFindings > 0
    ? findings.reduce((sum, f) => sum + (f.confidence || 0), 0) / totalFindings
    : 0;

  // readmeContradictionCount: Q8 findings that flag README claims (honesty signal)
  const readmeContradictionCount = findings.filter(
    (f) => f.questionId === "Q8" && /README claims/i.test(f.finding || "")
  ).length;

  // provenanceCoverage: fraction of support items with who+when (traceability)
  const allSupportItems = findings.flatMap((f) => f.support || []);
  const supportWithProvenance = allSupportItems.filter((s) => s.who && s.when).length;
  const provenanceCoverage = allSupportItems.length > 0 ? supportWithProvenance / allSupportItems.length : 0;

  const quality = {
    evidenceDensity: Number(evidenceDensity.toFixed(2)),
    decisionQuality: Number(decisionQuality.toFixed(2)),
    decisionReusability: Number(decisionReusability.toFixed(2)),
    unknownRatio: Number(unknownRatio.toFixed(2)),
    counterEvidenceRatio: Number(counterEvidenceRatio.toFixed(2)),
    avgConfidence: Number(avgConfidence.toFixed(2)),
    readmeContradictionCount,
    provenanceCoverage: Number(provenanceCoverage.toFixed(2)),
  };

  return { ...quantity, ...quality };
}
