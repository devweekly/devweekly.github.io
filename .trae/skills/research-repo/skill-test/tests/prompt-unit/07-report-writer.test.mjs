// ===========================================================================
// 07-report-writer.test.mjs — Prompt Unit Test for Report Writer
//
// Tests that the prompt enforces judgment-driven report structure and that
// expected outputs follow the contract: Executive Summary, <=5 Claims,
// Evidence Quality labels, Unknown handling, Quality Gate.
// ===========================================================================

import { renderPrompt } from "../../lib/prompt-renderer.mjs";
import {
  runSuite,
  assertContains,
  assertNotContains,
  assertHasSection,
  countClaims,
  extractReportMetrics,
} from "../../lib/test-runner.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

const FIXTURES = ["duckdb", "openai-agents", "dbeaver", "readme-claims-code-doesnt"];

function loadExpectedReport(fixture) {
  return readFileSync(join(FIXTURES_DIR, fixture, "expected/07-report.md"), "utf-8");
}

function makeCase(fixture) {
  return {
    name: `${fixture} — report writer`,
    test(result) {
      const prompt = renderPrompt("07-report-writer", { repoName: fixture });
      const expected = loadExpectedReport(fixture);
      const metrics = extractReportMetrics(expected);

      result.record(`${fixture}: prompt enforces judgment over format`, () => {
        assertContains(prompt, "Judgment over Format", "Prompt should emphasize judgment");
        assertContains(prompt, "Unknown is valid", "Prompt should allow Unknown");
        assertContains(prompt, "Evidence over Analyzer", "Prompt should not discuss analyzer errors");
      });

      result.record(`${fixture}: expected report has Executive Summary`, () => {
        if (!metrics.hasExecutiveSummary) {
          throw new Error("Expected report to have Executive Summary");
        }
      });

      result.record(`${fixture}: expected report has <=5 claims`, () => {
        if (metrics.claimCount > 5) {
          throw new Error(`Expected <=5 claims, got ${metrics.claimCount}`);
        }
      });

      result.record(`${fixture}: each claim has required subsections`, () => {
        assertContains(expected, "Why it holds", "Claims need Why it holds");
        assertContains(expected, "Why it might be wrong", "Claims need Why it might be wrong");
        assertContains(expected, "Why it matters", "Claims need Why it matters");
      });

      result.record(`${fixture}: expected report has Evidence Quality labels`, () => {
        assertContains(expected, "Quality:", "Claims need Evidence Quality label");
        assertContains(expected, "Verified", "Report should use Verified label");
      });

      result.record(`${fixture}: expected report has Quality Gate`, () => {
        assertHasSection(expected, "Quality Gate", "Report should have Quality Gate");
      });

      result.record(`${fixture}: expected report does not discuss analyzer errors`, () => {
        assertNotContains(expected, "Analyzer 为什么错了", "Report should not discuss analyzer errors");
      });

      if (fixture === "readme-claims-code-doesnt") {
        result.record(`${fixture}: flags documentation-only claim as unverified`, () => {
          assertContains(expected, "Documentation Only", "Should label unverified README claim");
          assertContains(expected, "未验证", "Should flag as unverified in Chinese");
        });
      }
    },
  };
}

export function runReportWriterTests() {
  return runSuite("07-report-writer", FIXTURES.map(makeCase));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runReportWriterTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
