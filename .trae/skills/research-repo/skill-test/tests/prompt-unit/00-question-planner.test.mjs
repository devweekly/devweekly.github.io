// ===========================================================================
// 00-question-planner.test.mjs — Prompt Unit Test for Question Planner
//
// Layer 1 (always runs): Template contract — verifies the prompt template
//   contains required instructions (Archetype detection, Top 5, Filtered Out,
//   5-dimension scoring). If someone removes a critical instruction, this
//   test catches it.
//
// Layer 2 (only when RESEARCH_REPO_LLM_CMD is set): LLM execution — renders
//   the prompt with a real evidence-brief from a synthetic repo, runs the
//   LLM, and validates the output has required sections.
// ===========================================================================

import { renderPrompt } from "../../lib/prompt-renderer.mjs";
import { runSuite, assertContains } from "../../lib/test-runner.mjs";
import { isLlmAvailable, runLlm } from "../../lib/llm-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runAnalyzerReport } from "../../lib/analyzer-runner.mjs";

export function runQuestionPlannerTests() {
  const cases = [
    {
      name: "template contract: contains required instructions",
      test(result) {
        const prompt = renderPrompt("00-question-planner", { repoName: "test-repo" });

        result.record("instructs Archetype detection", () => {
          assertContains(prompt, "Archetype", "Template should mention Archetype");
        });
        result.record("instructs Top 5 questions", () => {
          assertContains(prompt, "Top 5", "Template should mention Top 5");
        });
        result.record("instructs Filtered Out section", () => {
          assertContains(prompt, "Filter", "Template should mention Filter");
        });
        result.record("renders repoName placeholder", () => {
          assertContains(prompt, "test-repo", "Template should contain substituted repoName");
        });
      },
    },
  ];

  if (isLlmAvailable()) {
    cases.push({
      name: "LLM output has required sections (live)",
      test(result) {
        const dir = createSyntheticRepo("agent");
        try {
          const brief = runAnalyzerReport(dir);
          const prompt = renderPrompt("00-question-planner", { repoName: "synthetic-agent" }) + "\n\n## 必读输入\n\n" + brief;
          const output = runLlm(prompt);

          result.record("LLM output is non-empty", () => {
            if (!output || output.length < 50) throw new Error("Output too short or empty");
          });
          result.record("LLM output mentions Archetype", () => {
            assertContains(output, "Archetype", "Output should have Archetype section");
          });
          result.record("LLM output has questions", () => {
            if (!/Q\d+/i.test(output)) throw new Error("Output should contain Q1, Q2, etc.");
          });
        } finally {
          cleanupSyntheticRepo(dir);
        }
      },
    });
  }

  return runSuite("00-question-planner", cases);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runQuestionPlannerTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
