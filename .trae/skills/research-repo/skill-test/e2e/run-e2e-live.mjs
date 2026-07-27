#!/usr/bin/env node
// ===========================================================================
// run-e2e-live.mjs — Live end-to-end runner for real repositories.
//
// Automates the deterministic part of the Research Pipeline:
//   Repository (or URL) → Analyzer → Evidence Store → Evidence Brief → Verify
//
// Usage:
//   node skill-test/e2e/run-e2e-live.mjs <repoPath|repoURL> [outputDir] [--expected=<yaml|json>] [--llm]
//   node skill-test/e2e/run-e2e-live.mjs https://github.com/duckdb/duckdb /tmp/duckdb-research
//
// Behavior:
//   1. If input is URL, clones into a temp directory.
//   2. Runs `research-repo.mjs all` to generate evidence-store/full.json.
//   3. Runs `research-repo.mjs report` to generate evidence-brief.md.
//   4. If --llm is set and RESEARCH_REPO_LLM_CMD is configured, generates the
//      final report.md with the report-writer subagent prompt.
//   5. Otherwise writes a deterministic report stub.
//   6. Runs stage checks (analyzer + evidence-brief + report) and verify.
//   7. Prints metrics and exits with 0 only if all checks pass.
//
// Note: Only the report stage is LLM-driven in this runner. For full subagent
// coverage use the Skill workflow directly.
// ===========================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { validateAnalyzerStage, validateEvidenceBriefStage, validateReportStage } from "./stage-checks.mjs";
import { verifyResearchDirectory, loadExpectedYaml } from "./verify-directory.mjs";
import { isLlmAvailable, runLlm, loadPromptTemplate } from "../lib/llm-runner.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../research-repo.mjs");

function runCommand(label, args, cwd, env = {}) {
  const result = spawnSync("node", args, {
    cwd,
    encoding: "utf-8",
    timeout: 600000,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function cloneRepo(url) {
  const dir = mkdtempSync(join(tmpdir(), "research-repo-live-"));
  console.error(`[clone] ${url} → ${dir}`);
  const result = spawnSync("git", ["clone", "--depth", "1", url, dir], {
    encoding: "utf-8",
    timeout: 300000,
  });
  if (result.status !== 0) {
    throw new Error(`git clone failed: ${result.stderr}`);
  }
  return dir;
}

function extractJson(stdout) {
  let end = stdout.length - 1;
  while (end >= 0 && /\s/.test(stdout[end])) end--;
  if (end < 0) return null;
  const closer = stdout[end];
  if (closer !== "}" && closer !== "]") return null;
  const opener = closer === "}" ? "{" : "[";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = end; i >= 0; i--) {
    const ch = stdout[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === closer) depth++;
    else if (ch === opener) {
      depth--;
      if (depth === 0) return stdout.slice(i, end + 1);
    }
  }
  return null;
}

function runAnalyzer(repoPath, outputDir) {
  const evidenceDir = join(outputDir, "evidence-store");
  mkdirSync(evidenceDir, { recursive: true });

  // Run `all` command and capture JSON evidence store.
  const allStdout = runCommand("analyzer all", [SCRIPT, "all", repoPath], repoPath);
  const jsonPayload = extractJson(allStdout) || allStdout.trim();
  const store = JSON.parse(jsonPayload);
  writeFileSync(join(evidenceDir, "full.json"), JSON.stringify(store, null, 2));

  // Run `report` command to generate evidence-brief.md.
  const reportStdout = runCommand("analyzer report", [SCRIPT, "report", repoPath], repoPath);
  writeFileSync(join(outputDir, "evidence-brief.md"), reportStdout);

  return store;
}

function buildExpectedFromStore(store) {
  const archetype = store._meta?.archetype || store._archetypeHints?.archetype || "Unknown";
  return {
    repository: { archetype },
    report: {
      claims: { min: 1 },
      counter_evidence: { required: false },
    },
  };
}

function extractFindingsFromBrief(briefText) {
  // Parse the markdown findings table in the evidence brief.
  const lines = briefText.split("\n");
  const findings = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("| ID ")) {
      inTable = true;
      continue;
    }
    if (inTable && line.startsWith("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 6 && cells[0].startsWith("F-")) {
        const text = cells.at(-1);
        findings.push(text);
      }
    } else {
      inTable = false;
    }
  }
  return findings;
}

function generateReportFromBrief(outputDir, store, briefText, useLlm) {
  const repoName = store.discovery?.repoName || store.discovery?.packageName || "repository";
  const archetype = store._meta?.archetype || "Unknown";

  if (useLlm && isLlmAvailable()) {
    console.error("[llm] generating report...");
    const prompt = loadPromptTemplate("07-report-writer", { repoName }) + "\n\n## 必读输入\n\n" + briefText;
    const report = runLlm(prompt);
    if (report) {
      writeFileSync(join(outputDir, "report.md"), report);
      return;
    }
  }

  const findings = extractFindingsFromBrief(briefText);

  let report = `# Research Report: ${repoName}\n\n`;
  report += `## Executive Summary\n\n`;
  report += `${repoName} is classified as ${archetype}. The following claims are derived from deterministic analyzer output.\n\n`;
  report += `## Top Claims\n\n`;

  const claims = findings.slice(0, 5);
  if (claims.length === 0) {
    report += "No findings available from analyzer output.\n\n";
  }
  for (let i = 0; i < claims.length; i++) {
    report += `### Claim ${i + 1}: ${claims[i]}\n\n`;
    report += `**Why it holds**:\n- Evidence: evidence-brief.md\n- Coverage: Analyzer\n- Quality: Partially Verified\n\n`;
    report += `**Why it might be wrong**:\n- Missing evidence: LLM synthesis not applied.\n\n`;
    report += `**Why it matters**:\nDeterministic signal from the analyzer pipeline.\n\n`;
  }

  report += `## Appendix\n\n`;
  report += `- **Reading Guide**: Continue with the subagent workflow (questions → hypotheses → opponent → cross-validation → report writer).\n`;
  report += `- **Open Questions**: See evidence-brief.md Research Questions section.\n`;
  report += `- **What NOT to Learn**: Do not treat this deterministic stub as the final report.\n\n`;
  report += `## Quality Gate\n\n`;
  report += `1. **What would invalidate this report?** Full subagent workflow produces contradictory conclusions.\n`;
  report += `2. **What is most likely to be disagreed with?** Claim interpretations before LLM synthesis.\n`;
  report += `3. **Is any Claim pretending to be certain when it should be Unknown?** Claims are marked Partially Verified by default.\n`;

  writeFileSync(join(outputDir, "report.md"), report);
}

function validateLiveOutput(outputDir) {
  const checks = [
    ...validateAnalyzerStage(outputDir),
    ...validateEvidenceBriefStage(outputDir),
    ...validateReportStage(outputDir),
  ];
  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node run-e2e-live.mjs <repoPath|repoURL> [outputDir] [--expected=<yaml|json>] [--llm]");
    process.exit(1);
  }

  const input = args[0];
  const expectedFlag = args.find((a) => a.startsWith("--expected="));
  const expectedPath = expectedFlag ? expectedFlag.split("=")[1] : null;
  const useLlm = args.includes("--llm");

  if (useLlm && !isLlmAvailable()) {
    console.error("Error: --llm requires RESEARCH_REPO_LLM_CMD environment variable.");
    process.exit(1);
  }

  let outputDir = args[1];
  if (!outputDir) {
    outputDir = mkdtempSync(join(tmpdir(), "research-output-"));
  }
  mkdirSync(outputDir, { recursive: true });

  let repoPath;
  let cleanupRepo = false;
  if (/^https?:\/\//.test(input)) {
    repoPath = cloneRepo(input);
    cleanupRepo = true;
  } else if (existsSync(input)) {
    repoPath = input;
  } else {
    console.error(`Error: path or URL not found: ${input}`);
    process.exit(1);
  }

  try {
    console.error(`[output] ${outputDir}`);
    const store = runAnalyzer(repoPath, outputDir);

    generateReportFromBrief(outputDir, store, readFileSync(join(outputDir, "evidence-brief.md"), "utf-8"), useLlm);

    // Build expected from analyzer output if user didn't provide one.
    let expected = {};
    if (expectedPath && existsSync(expectedPath)) {
      expected = loadExpectedYaml(expectedPath);
    } else {
      expected = buildExpectedFromStore(store);
      const generatedExpectedPath = join(outputDir, "expected.generated.yaml");
      // Minimal YAML serialization without external lib.
      writeFileSync(
        generatedExpectedPath,
        `repository:\n  archetype: ${expected.repository.archetype}\nreport:\n  claims:\n    min: ${expected.report.claims.min}\n  counter_evidence:\n    required: ${expected.report.counter_evidence.required}\n`
      );
    }

    const stageResult = validateLiveOutput(outputDir);
    const verifyResult = verifyResearchDirectory(outputDir, expected);

    console.log(`\nLive E2E: ${input}`);
    console.log(`  Stage checks: ${stageResult.passed}/${stageResult.total} passed`);
    console.log(`  Behavioral checks: ${verifyResult.checks.filter((c) => c.status === "pass").length}/${verifyResult.checks.length} passed`);

    for (const c of stageResult.checks.filter((c) => !c.ok)) {
      console.log(`  ✗ [${c.stage}] ${c.name}: ${c.message}`);
    }
    for (const err of verifyResult.errors) {
      console.log(`  ✗ ${err}`);
    }

    console.log("\n  Quality Metrics:");
    for (const [key, value] of Object.entries(verifyResult.metrics)) {
      const formatted = typeof value === "number" ? value.toFixed(2) : value;
      console.log(`    ${key}: ${formatted}`);
    }

    const ok = stageResult.ok && verifyResult.ok;
    console.log(`\n  Result: ${ok ? "PASS" : "FAIL"}`);
    console.error(`\nResearch output written to: ${outputDir}`);
    process.exit(ok ? 0 : 1);
  } finally {
    if (cleanupRepo) {
      rmSync(repoPath, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
