// ===========================================================================
// missing-evidence.test.mjs — Mutation / Adversarial Test
//
// Verifies that when key evidence is removed or README makes unsupported
// claims, the Skill output stays honest: Unknown, Missing Evidence,
// Documentation Only — instead of hallucinating certainty.
// ===========================================================================

import { runSuite, assertContains, assertNotContains } from "../../lib/test-runner.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

function loadReport(fixture) {
  return readFileSync(join(FIXTURES_DIR, fixture, "expected/07-report.md"), "utf-8");
}

export function runMutationTests() {
  return runSuite("mutation — missing evidence", [
    {
      name: "duckdb-mutated: removed vectorized evidence → Unknown",
      test(result) {
        const report = loadReport("duckdb-mutated");
        result.record("mentions Unknown", () => assertContains(report, "Unknown"));
        result.record("does not claim verified vectorized execution", () => {
          assertNotContains(report, "Quality: Verified", "Removed evidence should not be Verified");
        });
        result.record("explicitly flags missing execution model evidence", () => {
          assertContains(report, "向量执行模型的证据不足");
        });
      },
    },
    {
      name: "openai-agents-mutated: removed runner evidence → Unknown",
      test(result) {
        const report = loadReport("openai-agents-mutated");
        result.record("mentions Unknown", () => assertContains(report, "Unknown"));
        result.record("does not claim verified runner-centric model", () => {
          assertNotContains(report, "Quality: Verified", "Removed evidence should not be Verified");
        });
        result.record("explicitly flags missing runner evidence", () => {
          assertContains(report, "证据不足");
        });
      },
    },
    {
      name: "readme-claims-code-doesnt: README claim without code → Documentation Only",
      test(result) {
        const report = loadReport("readme-claims-code-doesnt");
        result.record("labels claim as Documentation Only", () => assertContains(report, "Documentation Only"));
        result.record("flags unverified in Chinese", () => assertContains(report, "未验证"));
        result.record("does not present README claim as implemented", () => {
          assertNotContains(report, "已实现", "Should not claim feature is implemented");
        });
        result.record("mentions missing evidence", () => assertContains(report, "Missing evidence"));
      },
    },
    {
      name: "mutated reports do not hallucinate removed claims",
      test(result) {
        const duckdbMut = loadReport("duckdb-mutated");
        const agentsMut = loadReport("openai-agents-mutated");

        result.record("duckdb-mutated does not say vectorized is core", () => {
          if (/向量化.+核心|Vectorized.+core/i.test(duckdbMut)) {
            throw new Error("Mutated report hallucinates vectorized execution as core");
          }
        });
        result.record("openai-mutated does not say runner owns the loop", () => {
          if (/Runner\s+是\s*核心|Runner\s+拥有|Runner\s+own/i.test(agentsMut)) {
            throw new Error("Mutated report hallucinates Runner ownership");
          }
        });
      },
    },
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runMutationTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
