// ===========================================================================
// 01-hypothesis.test.mjs — Prompt Unit Test for Bayesian Hypothesis Generator
//
// Layer 1 (always runs): Template contract — verifies the prompt instructs
//   prior/posterior confidence, confidence evolution, and competing hypotheses.
//
// Layer 2 (only when RESEARCH_REPO_LLM_CMD is set): LLM execution.
// ===========================================================================

import { renderPrompt } from "../../lib/prompt-renderer.mjs";
import { runSuite, assertContains } from "../../lib/test-runner.mjs";
import { isLlmAvailable, runLlm } from "../../lib/llm-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runAnalyzerReport } from "../../lib/analyzer-runner.mjs";

export function runHypothesisTests() {
  const cases = [
    {
      name: "template contract: contains Bayesian structure instructions",
      test(result) {
        const prompt = renderPrompt("01-hypothesis", { repoName: "test-repo" });

        result.record("instructs prior confidence", () => {
          assertContains(prompt, "先验置信度", "Prompt should ask for prior confidence");
        });
        result.record("instructs confidence evolution", () => {
          assertContains(prompt, "置信度演进", "Prompt should ask for confidence evolution");
        });
        result.record("requires Competing Hypothesis", () => {
          assertContains(prompt, "Competing Hypothesis", "Prompt should require competing hypothesis");
        });
      },
    },
  ];

  if (isLlmAvailable()) {
    cases.push({
      name: "LLM output has Bayesian fields (live)",
      test(result) {
        const dir = createSyntheticRepo("database");
        try {
          const brief = runAnalyzerReport(dir);
          const prompt = renderPrompt("01-hypothesis", { repoName: "synthetic-db" }) + "\n\n## 必读输入\n\n" + brief;
          const output = runLlm(prompt);

          result.record("LLM output is non-empty", () => {
            if (!output || output.length < 50) throw new Error("Output too short or empty");
          });
          result.record("LLM output has prior confidence", () => {
            assertContains(output, "先验置信度", "Output should have prior confidence");
          });
          result.record("LLM output has competing hypothesis", () => {
            assertContains(output, "Competing Hypothesis", "Output should have competing hypothesis");
          });
        } finally {
          cleanupSyntheticRepo(dir);
        }
      },
    });
  }

  return runSuite("01-hypothesis", cases);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runHypothesisTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
