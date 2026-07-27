// ===========================================================================
// metrics-regression.test.mjs — Regression Suite
//
// Compares current fixture metrics against baseline-metrics.json to detect
// drift after Skill changes. Fails on large unexpected drops in quality
// signals (verified claims, quality gate presence) or spikes in unverified
// claims.
// ===========================================================================

import { runSuite, computeFixtureMetrics } from "../../lib/test-runner.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

const baseline = JSON.parse(readFileSync(join(FIXTURES_DIR, "baseline-metrics.json"), "utf-8"));

function loadText(fixture, file) {
  try {
    return readFileSync(join(FIXTURES_DIR, fixture, file), "utf-8");
  } catch {
    return "";
  }
}

function discoverFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => baseline.fixtures[name]);
}

export function runRegressionTests() {
  const fixtures = discoverFixtures();

  const cases = [
    {
      name: "all fixtures have expected outputs",
      test(result) {
        for (const fixture of fixtures) {
          result.record(`${fixture}: has expected questions`, () => {
            const text = loadText(fixture, "expected/00-research-questions.md");
            if (!text) throw new Error("Missing expected questions");
          });
          result.record(`${fixture}: has expected report`, () => {
            const text = loadText(fixture, "expected/07-report.md");
            if (!text) throw new Error("Missing expected report");
          });
        }
      },
    },
    {
      name: "metrics match baseline within tolerance",
      test(result) {
        for (const fixture of fixtures) {
          const expectedBaseline = baseline.fixtures[fixture];
          const questions = loadText(fixture, "expected/00-research-questions.md");
          const report = loadText(fixture, "expected/07-report.md");
          const metrics = computeFixtureMetrics(questions, report);

          for (const [key, spec] of Object.entries(expectedBaseline)) {
            if (typeof spec === "boolean") {
              result.record(`${fixture}: ${key}=${spec}`, () => {
                if (metrics[key] !== spec) {
                  throw new Error(`Expected ${key}=${spec}, got ${metrics[key]}`);
                }
              });
              continue;
            }

            if (spec && typeof spec === "object" && "value" in spec) {
              const { value, tolerance } = spec;
              result.record(`${fixture}: ${key} within ${value}±${tolerance}`, () => {
                const diff = Math.abs((metrics[key] || 0) - value);
                if (diff > tolerance) {
                  throw new Error(`Expected ${key}=${value}±${tolerance}, got ${metrics[key]}`);
                }
              });
            }
          }
        }
      },
    },
    {
      name: "quality gates hold across fixtures",
      test(result) {
        const gates = baseline.qualityGates;
        let totalDocOnly = 0;
        let totalClaims = 0;

        for (const fixture of fixtures) {
          const questions = loadText(fixture, "expected/00-research-questions.md");
          const report = loadText(fixture, "expected/07-report.md");
          const metrics = computeFixtureMetrics(questions, report);

          totalDocOnly += metrics.documentationOnlyCount;
          totalClaims += metrics.claimCount;

          result.record(`${fixture}: question count >= ${gates.minQuestionCount}`, () => {
            if (metrics.questionCount < gates.minQuestionCount) {
              throw new Error(`questionCount ${metrics.questionCount} < ${gates.minQuestionCount}`);
            }
          });

          result.record(`${fixture}: claim count <= ${gates.maxClaimCount}`, () => {
            if (metrics.claimCount > gates.maxClaimCount) {
              throw new Error(`claimCount ${metrics.claimCount} > ${gates.maxClaimCount}`);
            }
          });
        }

        const docOnlyRatio = totalClaims > 0 ? totalDocOnly / totalClaims : 0;
        result.record(`documentation-only ratio <= ${gates.maxDocumentationOnlyRatio}`, () => {
          if (docOnlyRatio > gates.maxDocumentationOnlyRatio) {
            throw new Error(`Documentation-only ratio ${docOnlyRatio.toFixed(2)} exceeds ${gates.maxDocumentationOnlyRatio}`);
          }
        });
      },
    },
  ];

  return runSuite("regression — metrics", cases);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runRegressionTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
