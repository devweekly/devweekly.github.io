// ===========================================================================
// pipeline-e2e.test.mjs — End-to-end pipeline test (LIVE)
//
// Creates a synthetic repo, runs the real deterministic pipeline
// (research-repo.mjs all + report), generates a deterministic report stub,
// and validates the output directory with stage-checks and verify.
//
// This is a real end-to-end test: it does NOT check static fixture files.
// The System Under Test is the Analyzer pipeline itself.
//
// Golden fixture comparison: also compares live pipeline output against
// the stored Golden fixture (signalCount / briefFindingCount / briefLength
// within tolerance) to catch analyzer regressions.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo, ARCHETYPES } from "../../lib/synthetic-repos.mjs";
import { runPipelineToDirectory, getSignals, computeAnalyzerMetrics } from "../../lib/analyzer-runner.mjs";
import { validateAnalyzerStage, validateEvidenceBriefStage, validateReportStage } from "../../e2e/stage-checks.mjs";
import { verifyResearchDirectory } from "../../e2e/verify-directory.mjs";
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "..", "..", "e2e", "fixtures");

// Tolerances for Golden comparison — catch meaningful drift, not noise.
const TOLERANCES = {
  signalCount: 0,        // signals should be identical (deterministic)
  briefFindingCount: 2,  // small drift allowed (e.g., if analyzer adds a check)
  briefLength: 1000,     // ±1000 chars allowed (formatting / wording changes)
  fileCount: 0,          // file count must match
};

function generateDeterministicReport(outputDir, store, brief) {
  // The deterministic pipeline does not run an LLM. We synthesize a report
  // from the real evidence-brief so verify-directory can validate structure.
  const repoName = store.discovery?.repoName || store.discovery?.packageName || "repository";
  const signals = getSignals(store);
  const signalList = Object.entries(signals).filter(([, v]) => v).map(([k]) => k);
  const arch = store.architecture || {};
  const smells = store.dependencySmell || {};

  let report = `# Research Report: ${repoName}\n\n`;
  report += `## Executive Summary\n\n`;
  report += `${repoName} is analyzed with the deterministic mechanical pipeline. `;
  report += `Detected signals: ${signalList.length > 0 ? signalList.join(", ") : "none"}. `;
  report += `Architecture graph: ${arch.totalNodes || 0} nodes, ${arch.totalEdges || 0} edges, `;
  report += `${(arch.cycles || []).length} cycles. Dependency smells: ${smells.totalSmells || 0}.\n\n`;
  report += `## Evidence Brief\n\n`;
  report += brief;
  report += `\n## Top Claims\n\n`;
  report += `### Claim 1: Mechanical evidence is available\n\n`;
  report += `Quality: Verified\n\n`;
  report += `Evidence: evidence-brief.md, evidence-store/full.json.\n\n`;
  report += `Why it matters: The pipeline successfully extracted repository metadata, symbols, and import graph facts.\n\n`;
  report += `### Claim 2: Semantic interpretation requires the hybrid command\n\n`;
  report += `Quality: Unknown\n\n`;
  report += `Evidence: N/A — deterministic pipeline does not run an LLM.\n\n`;
  report += `Why it matters: Architecture patterns, responsibilities, and tradeoffs are delegated to the LLM in Hybrid mode.\n\n`;
  report += `## Appendix\n\n`;
  report += `- **Reading Guide**: Inspect evidence-brief.md for mechanical evidence.\n`;
  report += `- **Semantic interpretation**: Use the \`hybrid\` command (LLM-driven).\n`;
  report += `- **What NOT to Learn**: This is a deterministic report (no LLM synthesis).\n\n`;
  report += `## Quality Gate\n\n`;
  report += `1. **What would invalidate this report?** LLM synthesis produces contradictory conclusions.\n`;
  report += `2. **What is most likely to be disagreed with?** Signal-based archetype classification.\n`;
  report += `3. **Is any Claim pretending to be certain when it should be Unknown?** See Claim 2.\n`;

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
    // ── Golden fixture comparison (regression detection) ──────────────────
    // For each archetype with a stored Golden fixture, re-run the real
    // pipeline and compare key metrics. Catches analyzer regressions that
    // would otherwise silently change report content.
    ...ARCHETYPES.flatMap((archetype) => {
      const goldenDir = join(GOLDEN_DIR, `${archetype}-golden`);
      if (!existsSync(join(goldenDir, "evidence-store", "full.json"))) return [];
      return [{
        name: `golden comparison: ${archetype} matches stored Golden fixture`,
        test: withPipeline(archetype, (result, outputDir, store, brief) => {
          const goldenStore = JSON.parse(
            readFileSync(join(goldenDir, "evidence-store", "full.json"), "utf-8")
          );
          const goldenBrief = readFileSync(join(goldenDir, "evidence-brief.md"), "utf-8");
          const liveMetrics = computeAnalyzerMetrics(store, brief);
          const goldenMetrics = computeAnalyzerMetrics(goldenStore, goldenBrief);

          for (const key of Object.keys(TOLERANCES)) {
            const tol = TOLERANCES[key];
            const live = liveMetrics[key] ?? 0;
            const golden = goldenMetrics[key] ?? 0;
            const delta = Math.abs(live - golden);
            result.record(`${archetype}: ${key} within tolerance (live=${live}, golden=${golden}, Δ=${delta}, tol=${tol})`, () => {
              if (delta > tol) {
                throw new Error(`${key} drift ${delta} exceeds tolerance ${tol} (live=${live}, golden=${golden}). Re-run pnpm test:golden:generate to update Golden fixtures.`);
              }
            });
          }
        }),
      }];
    }),
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
