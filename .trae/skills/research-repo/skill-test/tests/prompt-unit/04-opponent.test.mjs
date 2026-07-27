// ===========================================================================
// 04-opponent.test.mjs — Prompt Unit Test for Opponent Agent
//
// Layer 1 (always runs): Template contract — verifies the prompt instructs
//   adversarial behavior (skeptic role, prove findings wrong).
//
// Layer 2 (only when RESEARCH_REPO_LLM_CMD is set): LLM execution.
// ===========================================================================

import { renderPrompt } from "../../lib/prompt-renderer.mjs";
import { runSuite, assertContains } from "../../lib/test-runner.mjs";
import { isLlmAvailable, runLlm } from "../../lib/llm-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runAnalyzerReport } from "../../lib/analyzer-runner.mjs";

export function runOpponentTests() {
  const cases = [
    {
      name: "template contract: instructs adversarial behavior",
      test(result) {
        const prompt = renderPrompt("04-opponent", { repoName: "test-repo" });

        result.record("casts model as skeptic", () => {
          assertContains(prompt, "怀疑论者", "Prompt should cast model as skeptic");
        });
        result.record("requires proving findings wrong", () => {
          assertContains(prompt, "证明每个 Finding 是错的", "Prompt should require proving findings wrong");
        });
      },
    },
  ];

  if (isLlmAvailable()) {
    cases.push({
      name: "LLM output contains attacks and conclusion (live)",
      test(result) {
        const dir = createSyntheticRepo("agent");
        try {
          const brief = runAnalyzerReport(dir);
          const prompt = renderPrompt("04-opponent", { repoName: "synthetic-agent" }) + "\n\n## 必读输入\n\n" + brief;
          const output = runLlm(prompt);

          result.record("LLM output is non-empty", () => {
            if (!output || output.length < 50) throw new Error("Output too short or empty");
          });
          result.record("LLM output has attacks", () => {
            if (!/攻击\s*\d/i.test(output)) throw new Error("Output should contain numbered attacks");
          });
          result.record("LLM output has conclusion", () => {
            assertContains(output, "结论", "Output should have conclusion");
          });
        } finally {
          cleanupSyntheticRepo(dir);
        }
      },
    });
  }

  return runSuite("04-opponent", cases);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runOpponentTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
