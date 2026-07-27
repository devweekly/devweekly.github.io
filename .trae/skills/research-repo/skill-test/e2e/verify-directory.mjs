// ===========================================================================
// verify-directory.mjs — Verify a completed research output directory.
//
// Usage (programmatic):
//   import { verifyResearchDirectory } from "./verify-directory.mjs";
//   const result = verifyResearchDirectory("./research-output", expectedYaml);
//
// Checks:
//   - Required stage files exist (evidence-store/full.json, evidence-brief.md, report.md)
//   - Report structure: Executive Summary, Top Claims, Quality Gate
//   - Claim bounds (min/max)
//   - Unknown / Counter Evidence / Documentation Only presence
//   - Evidence coverage: every claim references concrete evidence
//   - Quality metrics: decision count, pattern count, etc.
// ===========================================================================

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "yaml";

const REQUIRED_FILES = [
  "evidence-store/full.json",
  "evidence-brief.md",
  "report.md",
];

const STAGE_FILES = [
  "00-research-questions.md",
  "01-hypotheses.md",
  "02-ontology.md",
  "04-opponent.md",
  "05-cross-validation.md",
  "07-report.md",
];

export function loadExpectedYaml(path) {
  const text = readFileSync(path, "utf-8");
  return yaml.parse(text);
}

export function extractReportClaims(reportText) {
  const blocks = (reportText.match(/### Claim \d+:.+?(?=### Claim \d+:|## |\Z)/gs) || []);
  return blocks.map((block) => {
    const title = block.match(/### Claim \d+:\s*(.+)/)?.[1]?.trim() || "";
    const qualityMatch = block.match(/Quality:\s*(Verified|Partially Verified|Documentation Only|Unknown)/i);
    const evidenceMatch = block.match(/Evidence:\s*`?([^`\n]+)`?/i);
    const hasCounter = /Why it might be wrong|Alternative explanation|Missing evidence/i.test(block);
    const hasUnknown = /\bUnknown\b/i.test(block);
    return {
      title,
      quality: qualityMatch ? qualityMatch[1] : null,
      evidence: evidenceMatch ? evidenceMatch[1].trim() : null,
      hasCounter,
      hasUnknown,
    };
  });
}

export function computeQualityMetrics(reportText, evidenceStore) {
  const claims = extractReportClaims(reportText);
  const totalClaims = claims.length;
  const verified = claims.filter((c) => c.quality === "Verified").length;
  const partially = claims.filter((c) => c.quality === "Partially Verified").length;
  const docOnly = claims.filter((c) => c.quality === "Documentation Only").length;
  const unknownQuality = claims.filter((c) => c.quality === "Unknown").length;
  const withCounter = claims.filter((c) => c.hasCounter).length;
  const unsupported = claims.filter((c) => !c.evidence && c.quality !== "Unknown").length;

  const decisions = (reportText.match(/Decision/gi) || []).length;
  const patterns = (reportText.match(/Pattern/gi) || []).length;
  const unknowns = (reportText.match(/\bUnknown\b/gi) || []).length;

  return {
    totalClaims,
    verified,
    partiallyVerified: partially,
    documentationOnly: docOnly,
    unknownQuality,
    withCounter,
    unsupported,
    decisionCount: decisions,
    patternCount: patterns,
    unknownCount: unknowns,
    counterEvidenceRatio: totalClaims > 0 ? withCounter / totalClaims : 0,
    unknownRatio: totalClaims > 0 ? unknowns / totalClaims : 0,
  };
}

export function verifyResearchDirectory(dir, expected = {}) {
  const result = {
    ok: true,
    checks: [],
    metrics: {},
    errors: [],
  };

  function check(name, condition, message) {
    if (condition) {
      result.checks.push({ name, status: "pass" });
    } else {
      result.checks.push({ name, status: "fail", message });
      result.errors.push(`${name}: ${message}`);
      result.ok = false;
    }
  }

  // 1. Required files
  for (const file of REQUIRED_FILES) {
    check(
      `required file: ${file}`,
      existsSync(join(dir, file)),
      `Missing ${file}`
    );
  }

  // 2. Stage files (optional but tracked)
  const presentStages = [];
  for (const file of STAGE_FILES) {
    if (existsSync(join(dir, file))) {
      presentStages.push(file);
    }
  }
  check(
    "stage files present",
    presentStages.length >= 1,
    `Expected at least one stage file, found ${presentStages.length}`
  );

  // If no report, stop here
  const reportPath = join(dir, "report.md");
  if (!existsSync(reportPath)) {
    return result;
  }
  const reportText = readFileSync(reportPath, "utf-8");

  // 3. Report structure
  check(
    "report has Executive Summary",
    /(^|\n)#{1,2}\s*Executive\s+Summary/i.test(reportText),
    "Missing Executive Summary"
  );
  check(
    "report has Quality Gate",
    /(^|\n)#{1,4}\s*Quality\s+Gate/i.test(reportText),
    "Missing Quality Gate"
  );
  check(
    "report has Reading Guide",
    /\bReading\s+Guide\b/i.test(reportText),
    "Missing Reading Guide"
  );

  // 4. Claims
  const claims = extractReportClaims(reportText);
  const expect = expected.report || {};

  if (expect.claims?.min !== undefined) {
    check(
      `claim count >= ${expect.claims.min}`,
      claims.length >= expect.claims.min,
      `Got ${claims.length} claims`
    );
  }
  if (expect.claims?.max !== undefined) {
    check(
      `claim count <= ${expect.claims.max}`,
      claims.length <= expect.claims.max,
      `Got ${claims.length} claims`
    );
  }
  if (expect.unknown?.min !== undefined) {
    check(
      `unknown count >= ${expect.unknown.min}`,
      claims.filter((c) => c.hasUnknown).length >= expect.unknown.min,
      `Not enough Unknown annotations`
    );
  }
  if (expect.counter_evidence?.required) {
    check(
      "counter evidence required",
      claims.some((c) => c.hasCounter),
      "No claim contains counter evidence / alternative explanation"
    );
  }
  if (expect.architecture_decision?.min !== undefined) {
    const count = (reportText.match(/Decision/gi) || []).length;
    check(
      `architecture decision count >= ${expect.architecture_decision.min}`,
      count >= expect.architecture_decision.min,
      `Got ${count} decision mentions`
    );
  }

  // 5. Unsupported claims
  const unsupported = claims.filter((c) => !c.evidence && c.quality !== "Unknown");
  check(
    "no unsupported claims",
    unsupported.length === 0,
    `${unsupported.length} claims lack evidence: ${unsupported.map((c) => c.title).join(", ")}`
  );

  // 6. Documentation-only claims are flagged honestly
  const docOnlyWithoutLabel = claims.filter(
    (c) => c.quality !== "Documentation Only" && /README|docs?/i.test(c.evidence || "")
  );
  check(
    "README-sourced claims labeled Documentation Only",
    docOnlyWithoutLabel.length === 0,
    `${docOnlyWithoutLabel.length} README-sourced claims not labeled Documentation Only`
  );

  // 7. Metrics
  let evidenceStore = null;
  const fullJsonPath = join(dir, "evidence-store/full.json");
  if (existsSync(fullJsonPath)) {
    evidenceStore = JSON.parse(readFileSync(fullJsonPath, "utf-8"));
  }
  result.metrics = computeQualityMetrics(reportText, evidenceStore);

  // 8. Repository archetype expectations
  if (expected.repository?.archetype) {
    const briefPath = join(dir, "evidence-brief.md");
    const briefText = existsSync(briefPath) ? readFileSync(briefPath, "utf-8") : "";
    check(
      `archetype matches ${expected.repository.archetype}`,
      new RegExp(expected.repository.archetype, "i").test(briefText),
      `Expected archetype ${expected.repository.archetype} not found in evidence-brief.md`
    );
  }

  return result;
}

// CLI entrypoint for `research-repo verify <dir> [--expected=<yaml>]`
export function runVerifyCli(dir, expectedPath) {
  const expected = expectedPath && existsSync(expectedPath)
    ? loadExpectedYaml(expectedPath)
    : {};
  const result = verifyResearchDirectory(dir, expected);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
