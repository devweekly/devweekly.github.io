// ===========================================================================
// skill-test/lib/test-runner.mjs — Test harness for research-repo Skill behavior
//
// Architecture (4 layers):
//   1. Prompt Unit Test    — Each prompt behaves correctly on fixed inputs
//   2. Behavior Test       — Different repo archetypes produce correct questions
//   3. Mutation/Adversarial Test — Missing or wrong evidence → Unknown / caution
//   4. Regression Suite    — Fixed fixtures + metrics comparison over time
//
// Design choices:
//   - Deterministic structural checks first (70% of coverage)
//   - Optional LLM Judge for semantic checks (not required for CI)
//   - No new dependencies: uses node:test/assert internally, but exposed as
//     a lightweight runner for skill-test.mjs
// ===========================================================================

import assert from "node:assert";

export class SkillTestResult {
  constructor(name) {
    this.name = name;
    this.passed = [];
    this.failed = [];
    this.skipped = [];
  }

  get passCount() {
    return this.passed.length;
  }

  get failCount() {
    return this.failed.length;
  }

  get skipCount() {
    return this.skipped.length;
  }

  get total() {
    return this.passed.length + this.failed.length + this.skipped.length;
  }

  get ok() {
    return this.failed.length === 0;
  }

  record(caseName, fn) {
    try {
      fn();
      this.passed.push(caseName);
    } catch (err) {
      this.failed.push({ case: caseName, error: err.message });
    }
  }

  skip(caseName, reason) {
    this.skipped.push({ case: caseName, reason });
  }
}

/**
 * Run a suite of test functions and aggregate results.
 * @param {string} suiteName
 * @param {Array<{name: string, test: (result: SkillTestResult) => void}>} cases
 * @returns {SkillTestResult}
 */
export function runSuite(suiteName, cases) {
  const result = new SkillTestResult(suiteName);
  for (const c of cases) {
    try {
      c.test(result);
    } catch (err) {
      result.failed.push({ case: c.name, error: err.message });
    }
  }
  return result;
}

/**
 * Load a fixture file from skill-test/fixtures/{name}
 */
export function loadFixture(name) {
  const path = new URL(`../fixtures/${name}`, import.meta.url);
  return readFileSync(path, "utf-8");
}

// Minimal JSON file loader for fixtures
import { readFileSync, existsSync } from "node:fs";

export function loadJsonFixture(name, defaultValue = null) {
  const path = new URL(`../fixtures/${name}`, import.meta.url);
  if (!existsSync(path)) return defaultValue;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function fixtureExists(name) {
  const path = new URL(`../fixtures/${name}`, import.meta.url);
  return existsSync(path);
}

// ---------------------------------------------------------------------------
// Structural assertion helpers (deterministic)
// ---------------------------------------------------------------------------

export function assertContains(text, substring, message) {
  assert.ok(
    (text || "").toLowerCase().includes(substring.toLowerCase()),
    message || `Expected text to contain "${substring}"`
  );
}

export function assertNotContains(text, substring, message) {
  assert.ok(
    !(text || "").toLowerCase().includes(substring.toLowerCase()),
    message || `Expected text NOT to contain "${substring}"`
  );
}

export function assertMatchesAny(text, patterns, message) {
  const lower = (text || "").toLowerCase();
  const ok = patterns.some((p) => lower.includes(p.toLowerCase()));
  assert.ok(ok, message || `Expected text to match one of: ${patterns.join(", ")}`);
}

export function assertRegexCount(text, regex, min, message) {
  const count = ((text || "").match(regex) || []).length;
  assert.ok(
    count >= min,
    message || `Expected at least ${min} matches of ${regex}, got ${count}`
  );
}

export function assertHasSection(text, header, message) {
  const regex = new RegExp(`(^|\n)#{1,4}\\s*${header}`, "i");
  assert.ok(regex.test(text || ""), message || `Expected section "${header}"`);
}

export function countClaims(text) {
  return ((text || "").match(/^#{1,3}\s+Claim\s+\d+/gim) || []).length;
}

export function countQuestions(text) {
  return ((text || "").match(/^#{1,3}\s+Q\d+[:.]/gim) || []).length;
}

export function hasUnknown(text) {
  return /\bUnknown\b/i.test(text || "");
}

export function hasAlternativeExplanation(text) {
  return /\bAlternative\s+(Explanation|Interpretation)\b/i.test(text || "");
}

export function hasCounterEvidence(text) {
  return /\bCounter\s+Evidence\b/i.test(text || "");
}

// ---------------------------------------------------------------------------
// Metrics extraction
// ---------------------------------------------------------------------------

export function extractReportMetrics(reportText) {
  return {
    claimCount: countClaims(reportText),
    unknownCount: ((reportText || "").match(/\bUnknown\b/gi) || []).length,
    alternativeCount: ((reportText || "").match(/\bAlternative\b/gi) || []).length,
    counterEvidenceCount: ((reportText || "").match(/\bCounter\s+Evidence\b/gi) || []).length,
    hasExecutiveSummary: /(^|\n)#{1,2}\s*Executive\s+Summary/i.test(reportText || ""),
    hasReadingGuide: /\bReading\s+Guide\b/i.test(reportText || ""),
    hasQualityGate: /(^|\n)#{1,4}\s*Quality\s+Gate/i.test(reportText || ""),
  };
}

export function extractQuestionMetrics(questionText) {
  return {
    questionCount: countQuestions(questionText),
    hasArchetype: /^#{1,2}\s*Archetype/i.test(questionText || ""),
    mentionsAI: /\bAI\s+Agent\b|\bLLM\b|\bPrompt\b/i.test(questionText || ""),
    mentionsOptimizer: /\bOptimizer\b|\bVolcano\b|\bVectorized\b/i.test(questionText || ""),
    mentionsPlugin: /\bPlugin\b|\bExtension\b/i.test(questionText || ""),
  };
}

/**
 * Compute aggregate metrics for a fixture's expected outputs.
 * Used by the regression suite to detect drift across Skill changes.
 */
export function computeFixtureMetrics(questionsText, reportText) {
  const qm = extractQuestionMetrics(questionsText);
  const rm = extractReportMetrics(reportText);
  return {
    questionCount: qm.questionCount,
    claimCount: rm.claimCount,
    verifiedCount: ((reportText || "").match(/Quality:\s*Verified/gi) || []).length,
    partiallyVerifiedCount: ((reportText || "").match(/Quality:\s*Partially Verified/gi) || []).length,
    documentationOnlyCount: ((reportText || "").match(/Quality:\s*Documentation Only/gi) || []).length,
    unknownCount: rm.unknownCount,
    alternativeCount: rm.alternativeCount,
    counterEvidenceCount: rm.counterEvidenceCount,
    hasQualityGate: rm.hasQualityGate,
    hasReadingGuide: rm.hasReadingGuide,
    hasFilteredOut: /## Filtered Out/i.test(questionsText || ""),
  };
}
