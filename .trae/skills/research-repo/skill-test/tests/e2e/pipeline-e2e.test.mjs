// ===========================================================================
// pipeline-e2e.test.mjs — End-to-end pipeline test for research-repo Skill.
//
// Treats the research output directory as the system under test and validates
// every stage of the pipeline:
//   Analyzer → Evidence Brief → Questions → Hypotheses → Ontology →
//   Opponent → Cross Validation → Report
//
// Also computes quality metrics and compares them against fixture expectations.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { validateAllStages } from "../../e2e/stage-checks.mjs";
import { verifyResearchDirectory } from "../../e2e/verify-directory.mjs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../e2e/fixtures");

function loadExpectedJson(fixtureDir) {
  const path = join(fixtureDir, "expected.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

function listFixtures() {
  return readdirSync(FIXTURES_DIR).filter((name) =>
    existsSync(join(FIXTURES_DIR, name, "expected.json"))
  );
}

function makeCase(fixture) {
  return {
    name: `e2e — ${fixture}`,
    test(result) {
      const dir = join(FIXTURES_DIR, fixture);
      const expected = loadExpectedJson(dir);

      const stageResult = validateAllStages(dir);
      result.record(`${fixture}: all pipeline stages pass`, () => {
        if (!stageResult.ok) {
          const failures = stageResult.checks
            .filter((c) => !c.ok)
            .map((c) => `[${c.stage}] ${c.name}: ${c.message}`)
            .join("; ");
          throw new Error(failures);
        }
      });

      const verifyResult = verifyResearchDirectory(dir, expected);
      result.record(`${fixture}: behavioral expectations pass`, () => {
        if (!verifyResult.ok) {
          throw new Error(verifyResult.errors.join("; "));
        }
      });

      result.record(`${fixture}: metrics are captured`, () => {
        if (!verifyResult.metrics || verifyResult.metrics.totalClaims === undefined) {
          throw new Error("Quality metrics not computed");
        }
      });

      result.record(`${fixture}: has at least one Verified or Unknown claim`, () => {
        const m = verifyResult.metrics;
        if (m.verified === 0 && m.unknownQuality === 0) {
          throw new Error("Report has no Verified or Unknown claims");
        }
      });
    },
  };
}

export function runPipelineE2ETests() {
  return runSuite("e2e — pipeline", listFixtures().map(makeCase));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runPipelineE2ETests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
