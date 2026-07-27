// ===========================================================================
// lifecycle.test.mjs — Unit tests for Claim Lifecycle (P2-①)
//
// Verifies that Findings advance through the lifecycle:
//   candidate → supported → verified → decision / reusable_pattern
// and that lifecycle transitions are monotonic (never regress).
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runPipelineToDirectory } from "../../lib/analyzer-runner.mjs";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function withAgentRepo(fn) {
  return (result) => {
    const repoDir = createSyntheticRepo("agent");
    const outputDir = join(tmpdir(), `lifecycle-test-${Date.now()}`);
    try {
      const { store } = runPipelineToDirectory(repoDir, outputDir);
      fn(result, store);
    } finally {
      cleanupSyntheticRepo(repoDir);
      rmSync(outputDir, { recursive: true, force: true });
    }
  };
}

export function runLifecycleTests() {
  return runSuite("unit — claim lifecycle", [
    {
      name: "every finding has a lifecycle field",
      test: withAgentRepo((result, store) => {
        const findings = store.findings?.findings || [];
        result.record("findings exist", () => {
          if (findings.length === 0) throw new Error("Expected non-empty findings");
        });
        result.record("every finding has lifecycle", () => {
          const missing = findings.filter((f) => !f.lifecycle);
          if (missing.length > 0) throw new Error(`${missing.length} findings missing lifecycle field`);
        });
      }),
    },
    {
      name: "lifecycle values are valid enum",
      test: withAgentRepo((result, store) => {
        const VALID = ["candidate", "hypothesis", "supported", "verified", "decision", "reusable_pattern"];
        const findings = store.findings?.findings || [];
        result.record("all lifecycle values valid", () => {
          const invalid = findings.filter((f) => !VALID.includes(f.lifecycle));
          if (invalid.length > 0) throw new Error(`Invalid lifecycle: ${invalid[0].lifecycle}`);
        });
      }),
    },
    {
      name: "lifecycle history records transitions",
      test: withAgentRepo((result, store) => {
        const findings = store.findings?.findings || [];
        result.record("every finding has lifecycleHistory array", () => {
          const missing = findings.filter((f) => !Array.isArray(f.lifecycleHistory));
          if (missing.length > 0) throw new Error(`${missing.length} findings missing lifecycleHistory`);
        });
        result.record("history records initial transition", () => {
          const noInit = findings.filter((f) => !f.lifecycleHistory.some((h) => h.from === null));
          if (noInit.length > 0) throw new Error(`${noInit.length} findings missing initial transition`);
        });
      }),
    },
    {
      name: "verified findings have lifecycle >= verified",
      test: withAgentRepo((result, store) => {
        const findings = store.findings?.findings || [];
        const verifiedFindings = findings.filter((f) => f.verified === "verified");
        const ADVANCED = ["verified", "decision", "reusable_pattern"];
        result.record("verified findings advance to verified or beyond", () => {
          const stuck = verifiedFindings.filter((f) => !ADVANCED.includes(f.lifecycle));
          if (stuck.length > 0) {
            throw new Error(`${stuck.length} verified findings stuck at ${stuck[0].lifecycle}`);
          }
        });
      }),
    },
    {
      name: "rejected findings stay at candidate",
      test: withAgentRepo((result, store) => {
        const findings = store.findings?.findings || [];
        const rejected = findings.filter((f) => f.verified === "rejected");
        result.record("rejected findings have lifecycle=candidate", () => {
          const wrong = rejected.filter((f) => f.lifecycle !== "candidate");
          if (wrong.length > 0) throw new Error(`Rejected finding has lifecycle=${wrong[0].lifecycle}, expected candidate`);
        });
      }),
    },
    {
      name: "verification summary includes lifecycle counts",
      test: withAgentRepo((result, store) => {
        const vSum = store.findings?.verificationSummary || {};
        result.record("verificationSummary has lifecycle object", () => {
          if (!vSum.lifecycle || typeof vSum.lifecycle !== "object") {
            throw new Error("Missing verificationSummary.lifecycle");
          }
        });
        result.record("lifecycle counts cover all 6 states", () => {
          const required = ["candidate", "hypothesis", "supported", "verified", "decision", "reusable_pattern"];
          const missing = required.filter((k) => typeof vSum.lifecycle[k] !== "number");
          if (missing.length > 0) throw new Error(`Missing lifecycle counts: ${missing.join(", ")}`);
        });
        result.record("lifecycle counts sum to total", () => {
          const total = vSum.total || 0;
          const sum = Object.values(vSum.lifecycle).reduce((a, b) => a + b, 0);
          if (sum !== total) throw new Error(`Lifecycle counts sum=${sum}, total=${total}`);
        });
      }),
    },
    {
      name: "Q9 verified findings promote to decision",
      test: withAgentRepo((result, store) => {
        const findings = store.findings?.findings || [];
        const q9Verified = findings.filter((f) => f.questionId === "Q9" && f.verified === "verified");
        result.record("Q9 verified findings have lifecycle=decision", () => {
          // Note: synthetic agent repo may have 0 Q9 verified findings — that's OK.
          // Only check the ones that exist.
          const wrong = q9Verified.filter((f) => f.lifecycle !== "decision");
          if (wrong.length > 0) throw new Error(`Q9 verified finding has lifecycle=${wrong[0].lifecycle}, expected decision`);
        });
      }),
    },
    // ── P2-②: Unknown Classification tests ──────────────────────────────
    {
      name: "unknown findings have unknownType set",
      test: withAgentRepo((result, store) => {
        const findings = store.findings?.findings || [];
        const unknownFindings = findings.filter((f) =>
          /\bunknown\b|not detected|no\s+\w+\s+detected|not classified|no recognizable/i.test(f.finding || "")
        );
        result.record("unknown findings have unknownType", () => {
          const missing = unknownFindings.filter((f) => !f.unknownType);
          if (missing.length > 0) {
            throw new Error(`${missing.length} unknown findings missing unknownType (e.g., ${missing[0].id})`);
          }
        });
      }),
    },
    {
      name: "unknownType values are valid enum",
      test: withAgentRepo((result, store) => {
        const VALID = ["need_reading", "need_external_evidence", "impossible_to_verify"];
        const findings = store.findings?.findings || [];
        const classified = findings.filter((f) => f.unknownType);
        result.record("all unknownType values valid", () => {
          const invalid = classified.filter((f) => !VALID.includes(f.unknownType));
          if (invalid.length > 0) throw new Error(`Invalid unknownType: ${invalid[0].unknownType}`);
        });
      }),
    },
    {
      name: "verification summary includes unknownTypes counts",
      test: withAgentRepo((result, store) => {
        const vSum = store.findings?.verificationSummary || {};
        result.record("verificationSummary has unknownTypes object", () => {
          if (!vSum.unknownTypes || typeof vSum.unknownTypes !== "object") {
            throw new Error("Missing verificationSummary.unknownTypes");
          }
        });
        result.record("unknownTypes counts cover all 3 categories", () => {
          const required = ["need_reading", "need_external_evidence", "impossible_to_verify"];
          const missing = required.filter((k) => typeof vSum.unknownTypes[k] !== "number");
          if (missing.length > 0) throw new Error(`Missing unknownTypes counts: ${missing.join(", ")}`);
        });
      }),
    },
    {
      name: "unknownType classification follows question semantics",
      test: withAgentRepo((result, store) => {
        const findings = store.findings?.findings || [];
        // Q1-Q6 unknowns → need_reading
        const codeQs = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"];
        const codeUnknowns = findings.filter((f) => codeQs.includes(f.questionId) && f.unknownType);
        result.record("Q1-Q6 unknowns classified as need_reading", () => {
          const wrong = codeUnknowns.filter((f) => f.unknownType !== "need_reading");
          if (wrong.length > 0) throw new Error(`Q${wrong[0].questionId} unknown classified as ${wrong[0].unknownType}, expected need_reading`);
        });
        // Q9, Q11 unknowns → impossible_to_verify
        const implicitQs = ["Q9", "Q11"];
        const implicitUnknowns = findings.filter((f) => implicitQs.includes(f.questionId) && f.unknownType);
        result.record("Q9/Q11 unknowns classified as impossible_to_verify", () => {
          const wrong = implicitUnknowns.filter((f) => f.unknownType !== "impossible_to_verify");
          if (wrong.length > 0) throw new Error(`${wrong[0].questionId} unknown classified as ${wrong[0].unknownType}, expected impossible_to_verify`);
        });
      }),
    },
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runLifecycleTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}