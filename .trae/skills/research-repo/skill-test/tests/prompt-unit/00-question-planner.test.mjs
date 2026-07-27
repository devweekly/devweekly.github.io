// ===========================================================================
// 00-question-planner.test.mjs — Prompt Unit Test for Question Planner
//
// Tests that the prompt template renders correctly and that expected outputs
// follow the structural contract: Archetype section, Top 5 Questions,
// Filtered Out, and archetype-appropriate content.
// ===========================================================================

import { renderPrompt, loadEvidenceBrief } from "../../lib/prompt-renderer.mjs";
import {
  runSuite,
  assertContains,
  assertNotContains,
  assertHasSection,
  extractQuestionMetrics,
} from "../../lib/test-runner.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

const FIXTURES = ["duckdb", "openai-agents", "dbeaver", "readme-claims-code-doesnt"];

function loadExpectedQuestions(fixture) {
  return readFileSync(join(FIXTURES_DIR, fixture, "expected/00-research-questions.md"), "utf-8");
}

function questionSectionOnly(text) {
  // Only check the Top 5 Questions section; ignore Filtered Out examples.
  const marker = /(^|\n)## Filtered Out/i;
  const idx = text.search(marker);
  return idx >= 0 ? text.slice(0, idx) : text;
}

function makeCase(fixture) {
  return {
    name: `${fixture} — question planner`,
    test(result) {
      const repoName = fixture;
      const prompt = renderPrompt("00-question-planner", { repoName });
      const brief = loadEvidenceBrief(fixture);
      const expected = loadExpectedQuestions(fixture);
      const questions = questionSectionOnly(expected);

      result.record(`${fixture}: prompt renders repoName`, () => {
        assertContains(prompt, repoName, "Prompt should mention repoName");
        assertContains(prompt, "Archetype-driven", "Prompt should instruct archetype detection");
        assertContains(prompt, "Question-centric", "Prompt should be question-centric");
      });

      result.record(`${fixture}: expected output has required sections`, () => {
        assertHasSection(expected, "Archetype", "Expected output should have Archetype section");
        assertHasSection(expected, "Top 5 Questions", "Expected output should have Top 5 Questions");
        assertHasSection(expected, "Filtered Out", "Expected output should show filtered questions");
      });

      const metrics = extractQuestionMetrics(expected);
      result.record(`${fixture}: has 5 questions`, () => {
        if (metrics.questionCount < 5) {
          throw new Error(`Expected at least 5 questions, got ${metrics.questionCount}`);
        }
      });

      // Archetype-specific behavior checks (only in Top 5 Questions, not Filtered Out)
      if (fixture === "duckdb") {
        result.record(`${fixture}: asks database questions, not AI questions`, () => {
          assertContains(questions, "Vectorized", "DuckDB should ask about vectorized execution");
          assertContains(questions, "Optimizer", "DuckDB should ask about optimizer");
          assertNotContains(questions, "AI Agent", "DuckDB should not ask AI Agent questions");
          assertNotContains(questions, "LLM", "DuckDB should not ask LLM questions");
        });
      }

      if (fixture === "openai-agents") {
        result.record(`${fixture}: asks agent questions, not database questions`, () => {
          assertContains(questions, "Runner", "OpenAI Agents should ask about Runner");
          assertContains(questions, "Context", "OpenAI Agents should ask about Context");
          assertContains(questions, "Tool", "OpenAI Agents should ask about Tools");
          assertNotContains(questions, "Volcano", "OpenAI Agents should not ask database volcano model");
          assertNotContains(questions, "Optimizer", "OpenAI Agents should not ask database optimizer");
        });
      }

      if (fixture === "dbeaver") {
        result.record(`${fixture}: asks developer tool questions, not AI questions`, () => {
          assertContains(questions, "Plugin", "DBeaver should ask about Plugin architecture");
          assertContains(questions, "Eclipse", "DBeaver should ask about Eclipse RCP");
          assertContains(questions, "Driver", "DBeaver should ask about database drivers");
          assertNotContains(questions, "AI Agent", "DBeaver should not ask AI Agent questions");
          assertNotContains(questions, "LLM", "DBeaver should not ask LLM questions");
        });
      }

      if (fixture === "readme-claims-code-doesnt") {
        result.record(`${fixture}: focuses on evidence gap`, () => {
          assertContains(questions, "README", "Should question README claims");
          assertContains(questions, "验证", "Should flag verification need");
        });
      }
    },
  };
}

export function runQuestionPlannerTests() {
  return runSuite("00-question-planner", FIXTURES.map(makeCase));
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runQuestionPlannerTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
