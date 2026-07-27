// ===========================================================================
// 07-report-writer.test.mjs — Prompt Unit Test for Report Writer
//
// Layer 1 (always runs): Template contract — verifies the prompt enforces
//   judgment-driven structure (Judgment over Format, Unknown is valid,
//   Evidence over Analyzer, ≤5 Claims, Quality Gate).
//
// Layer 2 (only when RESEARCH_REPO_LLM_CMD is set): LLM execution.
// ===========================================================================

import { renderPrompt } from "../../lib/prompt-renderer.mjs";
import { runSuite, assertContains, assertNotContains } from "../../lib/test-runner.mjs";
import { isLlmAvailable, runLlm } from "../../lib/llm-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runAnalyzerReport } from "../../lib/analyzer-runner.mjs";

export function runReportWriterTests() {
  const cases = [
    {
      name: "template contract: enforces judgment-driven structure",
      test(result) {
        const prompt = renderPrompt("07-report-writer", { repoName: "test-repo" });

        result.record("emphasizes Judgment over Format", () => {
          assertContains(prompt, "Judgment over Format", "Prompt should emphasize judgment");
        });
        result.record("allows Unknown as valid", () => {
          assertContains(prompt, "Unknown is valid", "Prompt should allow Unknown");
        });
        result.record("instructs Evidence over Analyzer", () => {
          assertContains(prompt, "Evidence over Analyzer", "Prompt should not discuss analyzer errors");
        });
      },
    },
  ];

  if (isLlmAvailable()) {
    cases.push({
      name: "LLM output has report structure (live)",
      test(result) {
        const dir = createSyntheticRepo("database");
        try {
          const brief = runAnalyzerReport(dir);
          const prompt = renderPrompt("07-report-writer", { repoName: "synthetic-db" }) + "\n\n## 必读输入\n\n" + brief;
          const output = runLlm(prompt);

          result.record("LLM output is non-empty", () => {
            if (!output || output.length < 100) throw new Error("Output too short or empty");
          });
          result.record("LLM output has Executive Summary", () => {
            if (!/Executive\s+Summary/i.test(output)) throw new Error("Output should have Executive Summary");
          });
          result.record("LLM output has Claims", () => {
            if (!/Claim\s+\d/i.test(output)) throw new Error("Output should contain numbered Claims");
          });
          result.record("LLM output has Quality Gate", () => {
            if (!/Quality\s+Gate/i.test(output)) throw new Error("Output should have Quality Gate");
          });
          result.record("LLM output does not discuss analyzer errors", () => {
            assertNotContains(output, "Analyzer 为什么错了", "Report should not discuss analyzer errors");
          });
        } finally {
          cleanupSyntheticRepo(dir);
        }
      },
    });
  }

  return runSuite("07-report-writer", cases);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runReportWriterTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
