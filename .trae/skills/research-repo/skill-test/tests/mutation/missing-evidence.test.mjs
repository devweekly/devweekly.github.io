// ===========================================================================
// missing-evidence.test.mjs — Mutation / Adversarial Test (LIVE)
//
// Creates a "readme-claims" repo where the README claims features (Vectorized
// Execution, Distributed Query Planner, LLM Integration) that are NOT
// implemented in code. Runs the real Analyzer and verifies that:
//   1. Archetype signals remain all-false (code doesn't match README claims)
//   2. Evidence store has minimal symbols (no fake classes/functions)
//   3. Evidence-brief does not assert README claims as verified code facts
//
// This tests the Analyzer's honesty: it should not hallucinate capabilities
// from README content alone.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runAnalyzerAll, runAnalyzerReport, getSignals } from "../../lib/analyzer-runner.mjs";

function withReadmeClaimsRepo(fn) {
  return (result) => {
    const dir = createSyntheticRepo("readme-claims");
    try {
      fn(result, dir);
    } finally {
      cleanupSyntheticRepo(dir);
    }
  };
}

export function runMutationTests() {
  return runSuite("mutation — readme-claims honesty (live)", [
    {
      name: "readme-claims repo has no code signals for claimed features",
      test: withReadmeClaimsRepo((result, dir) => {
        const store = runAnalyzerAll(dir);
        const signals = getSignals(store);

        result.record("hasSQL is false (no SQL in code)", () => {
          if (signals.hasSQL) throw new Error("README claims SQL but code has none — signal should be false");
        });
        result.record("hasAgent is false (no Agent in code)", () => {
          if (signals.hasAgent) throw new Error("README claims Agent but code has none — signal should be false");
        });
        result.record("hasParser is false (no parser in code)", () => {
          if (signals.hasParser) throw new Error("README claims parser but code has none — signal should be false");
        });
        result.record("hasTool is false (no tools in code)", () => {
          if (signals.hasTool) throw new Error("README claims tools but code has none — signal should be false");
        });
        result.record("hasPlugin is false (no plugin in code)", () => {
          if (signals.hasPlugin) throw new Error("Signal should be false");
        });
        result.record("hasLLM is false (no LLM in code)", () => {
          if (signals.hasLLM) throw new Error("README claims LLM but code has none — signal should be false");
        });
      }),
    },
    {
      name: "evidence store has minimal symbols for readme-claims",
      test: withReadmeClaimsRepo((result, dir) => {
        const store = runAnalyzerAll(dir);
        const functions = store.symbols?.functions || [];
        const classes = store.symbols?.classes || [];

        result.record("has only trivial functions (≤2)", () => {
          if (functions.length > 2) throw new Error(`Expected ≤2 functions, got ${functions.length}`);
        });
        result.record("has no classes", () => {
          if (classes.length > 0) throw new Error(`Expected 0 classes, got ${classes.length}`);
        });
        result.record("has no tools", () => {
          if ((store.tools?.totalTools || 0) > 0) throw new Error("Expected 0 tools");
        });
        result.record("has no prompts", () => {
          if ((store.prompts?.totalPrompts || 0) > 0) throw new Error("Expected 0 prompts");
        });
      }),
    },
    {
      name: "evidence-brief does not verify README claims as code facts",
      test: withReadmeClaimsRepo((result, dir) => {
        const brief = runAnalyzerReport(dir);

        result.record("brief does not claim Vectorized Execution is implemented", () => {
          if (/vectorized\s+execution.*(implement|verified|detect)/i.test(brief)) {
            throw new Error("Brief falsely claims Vectorized Execution is implemented");
          }
        });
        result.record("brief does not claim Distributed Query Planner is implemented", () => {
          if (/distributed\s+query\s+planner.*(implement|verified|detect)/i.test(brief)) {
            throw new Error("Brief falsely claims Distributed Query Planner is implemented");
          }
        });
        result.record("brief does not claim LLM Integration is implemented", () => {
          if (/llm\s+integration.*(implement|verified|detect)/i.test(brief)) {
            throw new Error("Brief falsely claims LLM Integration is implemented");
          }
        });
      }),
    },
    {
      name: "evidence-brief EXPLICITLY flags README claims as unverified",
      test: withReadmeClaimsRepo((result, dir) => {
        // CRITICAL: Brief must not stay silent about README contradictions.
        // The "no contradiction" answer is itself a failure — Analyzer should detect
        // that README claims features (Vectorized Execution, LLM, AI Agent) which
        // are absent from code. This is the core mutation-test guarantee.
        const store = runAnalyzerAll(dir);
        const q8Findings = (store.findings?.findings || []).filter((f) => f.questionId === "Q8");

        result.record("Q8 produces README-contradiction findings (not 'no contradiction')", () => {
          if (q8Findings.length === 0) {
            throw new Error("Expected Q8 to produce README-contradiction findings");
          }
          const hasNoContradiction = q8Findings.some((f) =>
            /no\s+contradictions?\s+(detected|found)|all\s+analyzers\s+agree/i.test(f.finding)
          );
          if (hasNoContradiction && q8Findings.length === 1) {
            throw new Error("Q8 only says 'no contradictions' — failed to detect README false claims");
          }
        });

        result.record("Q8 findings mention README claims", () => {
          const q8Text = q8Findings.map((f) => f.finding).join(" ");
          if (!/README claims/i.test(q8Text)) {
            throw new Error(`Q8 should mention "README claims" but got: ${q8Text.slice(0, 200)}`);
          }
        });

        result.record("Q8 flags Vectorized Execution as unverified", () => {
          const q8Text = q8Findings.map((f) => f.finding).join(" ");
          if (!/vectorized/i.test(q8Text)) {
            throw new Error("Q8 should flag Vectorized Execution as unverified");
          }
        });

        result.record("Q8 flags LLM Integration as unverified", () => {
          const q8Text = q8Findings.map((f) => f.finding).join(" ");
          if (!/LLM/i.test(q8Text)) {
            throw new Error("Q8 should flag LLM Integration as unverified");
          }
        });
      }),
    },
    {
      name: "readme-claims signals differ from real database repo",
      test(result) {
        const claimsDir = createSyntheticRepo("readme-claims");
        const dbDir = createSyntheticRepo("database");
        try {
          const claimsSignals = getSignals(runAnalyzerAll(claimsDir));
          const dbSignals = getSignals(runAnalyzerAll(dbDir));

          result.record("readme-claims has fewer signals than database", () => {
            const claimsCount = Object.values(claimsSignals).filter(Boolean).length;
            const dbCount = Object.values(dbSignals).filter(Boolean).length;
            if (claimsCount >= dbCount) {
              throw new Error(`Expected readme-claims (${claimsCount}) < database (${dbCount}) signals`);
            }
          });
        } finally {
          cleanupSyntheticRepo(claimsDir);
          cleanupSyntheticRepo(dbDir);
        }
      },
    },
  ]);
}

// Backward-compatible alias
export const runMissingEvidenceTests = runMutationTests;

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runMutationTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
