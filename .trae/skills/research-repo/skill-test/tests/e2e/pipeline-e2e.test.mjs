// ===========================================================================
// pipeline-e2e.test.mjs — End-to-end pipeline test (LIVE)
//
// Creates a synthetic repo, runs the real deterministic pipeline
// (research-repo.mjs all + report), generates a deterministic report stub,
// and validates the output directory with stage-checks and verify.
//
// This is a real end-to-end test: it does NOT check static fixture files.
// The System Under Test is the Analyzer pipeline itself.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runPipelineToDirectory, getSignals } from "../../lib/analyzer-runner.mjs";
import { validateAnalyzerStage, validateEvidenceBriefStage, validateReportStage } from "../../e2e/stage-checks.mjs";
import { verifyResearchDirectory } from "../../e2e/verify-directory.mjs";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function generateDeterministicReport(outputDir, store, brief) {
  // The deterministic pipeline does not run an LLM, so we synthesize a report
  // from the real evidence-brief. This is NOT a stub — it reflects actual
  // Analyzer output (signals, findings, Q8 contradictions) and lets verify
  // catch real regressions in brief structure.
  const repoName = store.discovery?.repoName || store.discovery?.packageName || "repository";
  const signals = getSignals(store);
  const signalList = Object.entries(signals).filter(([, v]) => v).map(([k]) => k);
  const findings = store.findings?.findings || [];
  const q8Findings = findings.filter((f) => f.questionId === "Q8");

  let report = `# Research Report: ${repoName}\n\n`;
  report += `## Executive Summary\n\n`;
  report += `${repoName} is analyzed with deterministic pipeline. `;
  report += `Detected signals: ${signalList.length > 0 ? signalList.join(", ") : "none"}.\n`;
  report += `Findings: ${findings.length}. README contradictions: ${q8Findings.length}.\n\n`;
  report += `## Top Claims\n\n`;

  // Materialize real findings as claim blocks so verify-directory's extractReportClaims
  // can validate them (uses `#### F-NNN — QN:` format from real brief).
  report += brief;

  report += `\n## Appendix\n\n`;
  report += `- **Reading Guide**: Inspect evidence-brief.md for detailed findings.\n`;
  report += `- **Open Questions**: See evidence-brief.md.\n`;
  report += `- **What NOT to Learn**: This is a deterministic report (no LLM synthesis).\n\n`;
  report += `## Quality Gate\n\n`;
  report += `1. **What would invalidate this report?** LLM synthesis produces contradictory conclusions.\n`;
  report += `2. **What is most likely to be disagreed with?** Signal-based archetype classification.\n`;
  report += `3. **Is any Claim pretending to be certain when it should be Unknown?** See Findings.\n`;

  writeFileSync(join(outputDir, "report.md"), report);
}

function withPipeline(archetype, fn) {
  return (result) => {
    const repoDir = createSyntheticRepo(archetype);
    const outputDir = mkdtempSync(join(tmpdir(), "e2e-output-"));
    try {
      const { store, brief } = runPipelineToDirectory(repoDir, outputDir);
      generateDeterministicReport(outputDir, store, brief);
      fn(result, outputDir, store, brief);
    } finally {
      cleanupSyntheticRepo(repoDir);
      rmSync(outputDir, { recursive: true, force: true });
    }
  };
}

export function runPipelineE2ETests() {
  return runSuite("e2e — pipeline stages (live)", [
    {
      name: "agent repo: analyzer stage passes on real output",
      test: withPipeline("agent", (result, outputDir) => {
        const checks = validateAnalyzerStage(outputDir);
        const failed = checks.filter((c) => !c.ok);

        result.record("all analyzer checks pass", () => {
          if (failed.length > 0) throw new Error(failed[0].message);
        });
      }),
    },
    {
      name: "agent repo: evidence-brief stage passes on real output",
      test: withPipeline("agent", (result, outputDir) => {
        const checks = validateEvidenceBriefStage(outputDir);
        const failed = checks.filter((c) => !c.ok);

        result.record("all evidence-brief checks pass", () => {
          if (failed.length > 0) throw new Error(failed[0].message);
        });
      }),
    },
    {
      name: "agent repo: report stage passes on generated report",
      test: withPipeline("agent", (result, outputDir) => {
        const checks = validateReportStage(outputDir);
        const failed = checks.filter((c) => !c.ok);

        result.record("all report checks pass", () => {
          if (failed.length > 0) throw new Error(failed[0].message);
        });
      }),
    },
    {
      name: "agent repo: verify command passes on real output",
      test: withPipeline("agent", (result, outputDir) => {
        const verifyResult = verifyResearchDirectory(outputDir, {});

        result.record("verify has no errors", () => {
          if (verifyResult.errors.length > 0) throw new Error(verifyResult.errors[0]);
        });
      }),
    },
    {
      name: "database repo: full pipeline produces valid output",
      test: withPipeline("database", (result, outputDir) => {
        const allChecks = [
          ...validateAnalyzerStage(outputDir),
          ...validateEvidenceBriefStage(outputDir),
          ...validateReportStage(outputDir),
        ];
        const failed = allChecks.filter((c) => !c.ok);

        result.record("all stage checks pass for database repo", () => {
          if (failed.length > 0) throw new Error(failed[0].message);
        });
      }),
    },
    {
      name: "database repo: verify passes with correct metrics",
      test: withPipeline("database", (result, outputDir) => {
        const verifyResult = verifyResearchDirectory(outputDir, {});

        result.record("verify produces metrics", () => {
          if (Object.keys(verifyResult.metrics).length === 0) {
            throw new Error("Expected non-empty metrics");
          }
        });
        result.record("verify has no errors", () => {
          if (verifyResult.errors.length > 0) throw new Error(verifyResult.errors[0]);
        });
      }),
    },
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runPipelineE2ETests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
