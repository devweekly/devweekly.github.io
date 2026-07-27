// ===========================================================================
// 04-opponent.test.mjs — Prompt Unit Test for Opponent Agent
//
// Tests that the prompt requires adversarial attacks on findings and that
// expected outputs contain attacks, conclusion, and evidence-based critique.
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

function loadExpectedOpponent(fixture) {
  return readFileSync(join(FIXTURES_DIR, fixture, "expected/04-opponent.md"), "utf-8");
}

function makeCase(fixture) {
  return {
    name: `${fixture} — opponent agent`,
    test(result) {
      const prompt = renderPrompt("04-opponent", { repoName: fixture });
      const expected = loadExpectedOpponent(fixture);

      result.record(`${fixture}: prompt requires adversarial behavior`, () => {
        assertContains(prompt, "怀疑论者", "Prompt should cast model as skeptic");
        assertContains(prompt, "证明每个 Finding 是错的", "Prompt should require proving findings wrong");
      });

      result.record(`${fixture}: expected output contains four attacks`, () => {
        assertContains(expected, "攻击 1", "Expected output should have attack 1");
        assertContains(expected, "攻击 2", "Expected output should have attack 2");
        assertContains(expected, "攻击 3", "Expected output should have attack 3");
        assertContains(expected, "攻击 4", "Expected output should have attack 4");
      });

      result.record(`${fixture}: expected output reaches a conclusion`, () => {
        assertContains(expected, "结论", "Expected output should have conclusion");
      });

      result.record(`${fixture}: expected output requests more evidence when needed`, () => {
        assertContains(expected, "建议", "Expected output should have recommendation");
      });
    },
  };
}

export function runOpponentTests() {
  return runSuite("04-opponent", FIXTURES.map(makeCase));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runOpponentTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
