// ===========================================================================
// 01-hypothesis.test.mjs — Prompt Unit Test for Bayesian Hypothesis Generator
//
// Tests that the prompt instructs prior/posterior confidence and competing
// hypotheses, and that expected outputs contain the required Bayesian fields.
// ===========================================================================

import { renderPrompt } from "../../lib/prompt-renderer.mjs";
import {
  runSuite,
  assertContains,
  assertHasSection,
} from "../../lib/test-runner.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

const FIXTURES = ["duckdb", "openai-agents", "dbeaver", "readme-claims-code-doesnt"];

function loadExpectedHypotheses(fixture) {
  return readFileSync(join(FIXTURES_DIR, fixture, "expected/01-hypotheses.md"), "utf-8");
}

function makeCase(fixture) {
  return {
    name: `${fixture} — hypothesis generator`,
    test(result) {
      const prompt = renderPrompt("01-hypothesis", { repoName: fixture });
      const expected = loadExpectedHypotheses(fixture);

      result.record(`${fixture}: prompt requires Bayesian structure`, () => {
        assertContains(prompt, "先验置信度", "Prompt should ask for prior confidence");
        assertContains(prompt, "置信度演进", "Prompt should ask for confidence evolution");
        assertContains(prompt, "Competing Hypothesis", "Prompt should require competing hypothesis");
      });

      result.record(`${fixture}: expected output has prior and competing hypothesis`, () => {
        assertContains(expected, "先验置信度", "Expected output should have prior confidence");
        assertHasSection(expected, "Competing Hypothesis", "Expected output should have competing hypothesis");
      });

      result.record(`${fixture}: expected output has confidence evolution table`, () => {
        assertContains(expected, "| 证据来源 | 置信度变化 | 原因 |", "Expected output should have evolution table");
      });

      result.record(`${fixture}: expected output is falsifiable`, () => {
        assertContains(expected, "如何验证", "Expected output should explain how to verify");
        assertContains(expected, "若不成立", "Expected output should explain consequences if false");
      });
    },
  };
}

export function runHypothesisTests() {
  return runSuite("01-hypothesis", FIXTURES.map(makeCase));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runHypothesisTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
