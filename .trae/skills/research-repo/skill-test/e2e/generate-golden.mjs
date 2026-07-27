#!/usr/bin/env node
// ===========================================================================
// generate-golden.mjs — Generate Golden E2E fixtures from real Analyzer runs.
//
// The Golden fixture is the canonical "known-good" output for a given archetype.
// When the Analyzer changes, regenerate Golden fixtures and diff against the
// previous version to detect intentional vs unintentional changes.
//
// Usage:
//   node skill-test/e2e/generate-golden.mjs                  # regenerate all
//   node skill-test/e2e/generate-golden.mjs --archetype=database  # one archetype
//   node skill-test/e2e/generate-golden.mjs --diff            # diff vs existing
//
// Output:
//   skill-test/e2e/fixtures/<archetype>-golden/
//     evidence-store/full.json   (real Analyzer output)
//     evidence-brief.md          (real Analyzer output)
//     report.md                   (deterministic report from real brief)
//     expected.json               (behavioral expectations for this archetype)
// ===========================================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createSyntheticRepo, cleanupSyntheticRepo, ARCHETYPES } from "../lib/synthetic-repos.mjs";
import { runPipelineToDirectory, getSignals, computeAnalyzerMetrics } from "../lib/analyzer-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

// Expected behavioral assertions per archetype — what the Analyzer MUST detect.
const EXPECTED = {
  database: {
    repository: { archetype: "database" },
    report: {
      claims: { min: 2 },
      unknown: { min: 0 },
      counter_evidence: { required: false },
    },
    signals: ["hasSQL", "hasParser", "hasLexer"],
  },
  agent: {
    repository: { archetype: "agent" },
    report: {
      claims: { min: 2 },
      unknown: { min: 0 },
      counter_evidence: { required: false },
    },
    signals: ["hasAgent", "hasTool"],
  },
  tool: {
    repository: { archetype: "tool" },
    report: {
      claims: { min: 2 },
      unknown: { min: 0 },
      counter_evidence: { required: false },
    },
    signals: ["hasPlugin"],
  },
  "readme-claims": {
    repository: { archetype: "readme-claims" },
    report: {
      claims: { min: 2 },
      unknown: { min: 0 },
      counter_evidence: { required: false },
    },
    signals: [],
    readmeContradictions: { min: 3 },  // Q8 should detect ≥3 README false claims
  },
};

function generateDeterministicReport(outputDir, store, brief) {
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
  // Materialize real findings as claim blocks (uses `#### F-NNN — QN:` format from real brief)
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

function generateGolden(archetype, diff = false) {
  const fixtureName = `${archetype}-golden`;
  const fixtureDir = join(FIXTURES_DIR, fixtureName);

  console.log(`\n--- Generating Golden fixture: ${fixtureName} ---`);

  // Read previous version for diff (if exists)
  const prevBriefPath = join(fixtureDir, "evidence-brief.md");
  const prevBrief = existsSync(prevBriefPath) ? readFileSync(prevBriefPath, "utf-8") : null;

  const repoDir = createSyntheticRepo(archetype);
  try {
    mkdirSync(join(fixtureDir, "evidence-store"), { recursive: true });

    const { store, brief } = runPipelineToDirectory(repoDir, fixtureDir);
    generateDeterministicReport(fixtureDir, store, brief);

    // Write expected.json with archetype-specific assertions
    const expected = EXPECTED[archetype] || {};
    writeFileSync(join(fixtureDir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");

    // Compute metrics for quick comparison
    const metrics = computeAnalyzerMetrics(store, brief);
    console.log(`  Metrics: ${JSON.stringify(metrics)}`);

    // Diff against previous (if --diff flag and previous exists)
    if (diff && prevBrief) {
      const lengthDiff = brief.length - prevBrief.length;
      console.log(`  Brief length diff: ${lengthDiff >= 0 ? "+" : ""}${lengthDiff} chars`);
      if (brief === prevBrief) {
        console.log(`  Brief content: IDENTICAL`);
      } else {
        console.log(`  Brief content: CHANGED`);
        // Find first difference
        for (let i = 0; i < Math.min(brief.length, prevBrief.length); i++) {
          if (brief[i] !== prevBrief[i]) {
            console.log(`  First diff at char ${i}:`);
            console.log(`    prev: ${prevBrief.slice(i, i + 80).replace(/\n/g, "\\n")}`);
            console.log(`    new:  ${brief.slice(i, i + 80).replace(/\n/g, "\\n")}`);
            break;
          }
        }
      }
    }

    console.log(`  Golden fixture written to: ${fixtureDir}`);
    return { archetype, fixtureDir, metrics };
  } finally {
    cleanupSyntheticRepo(repoDir);
  }
}

function main() {
  const args = process.argv.slice(2);
  const diff = args.includes("--diff");
  const archetypeArg = args.find((a) => a.startsWith("--archetype="));
  const archetype = archetypeArg ? archetypeArg.split("=")[1] : null;

  const archetypes = archetype ? [archetype] : ARCHETYPES;
  const results = [];
  for (const a of archetypes) {
    results.push(generateGolden(a, diff));
  }

  console.log("\n=== Golden Fixture Generation Summary ===");
  for (const r of results) {
    console.log(`  ${r.archetype}: ${r.metrics.briefFindingCount} findings, ${r.metrics.signalCount} signals, brief ${r.metrics.briefLength} chars`);
  }
  console.log(`\n${results.length} Golden fixtures generated.`);
}

main();
