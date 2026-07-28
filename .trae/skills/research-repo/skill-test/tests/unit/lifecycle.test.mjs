// ===========================================================================
// lifecycle.test.mjs — Unit tests for Mechanical Evidence Store structure
//
// Verifies that the deterministic pipeline produces a well-formed evidence
// store after the semantic analyzers were removed. Confirms:
//   - Evidence store contains expected mechanical sections
//   - Archetype hints are present (signals only, no LLM classification)
//   - Ontology and research objects are built
//   - No stale semantic outputs (findings, decisions) remain in store
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
  return runSuite("unit — mechanical evidence store structure", [
    {
      name: "evidence store has discovery, symbols, architecture",
      test: withAgentRepo((result, store) => {
        result.record("discovery present", () => {
          if (!store.discovery) throw new Error("Missing discovery");
        });
        result.record("symbols present", () => {
          if (!store.symbols) throw new Error("Missing symbols");
        });
        result.record("architecture present", () => {
          if (!store.architecture) throw new Error("Missing architecture");
        });
      }),
    },
    {
      name: "archetype hints exist with signals",
      test: withAgentRepo((result, store) => {
        const hints = store._archetypeHints || {};
        result.record("_archetypeHints present", () => {
          if (!store._archetypeHints) throw new Error("Missing _archetypeHints");
        });
        result.record("signals object present", () => {
          if (!hints.signals || typeof hints.signals !== "object") {
            throw new Error("Missing archetype signals");
          }
        });
      }),
    },
    {
      name: "ontology and research objects are built",
      test: withAgentRepo((result, store) => {
        result.record("ontology present", () => {
          if (!store.ontology) throw new Error("Missing ontology");
        });
        result.record("ontology has objectSummary", () => {
          if (!store.ontology?.objectSummary) throw new Error("Missing ontology.objectSummary");
        });
        result.record("researchObjects present", () => {
          if (!store.researchObjects) throw new Error("Missing researchObjects");
        });
      }),
    },
    {
      name: "mechanical inference analyzers run",
      test: withAgentRepo((result, store) => {
        result.record("stability present", () => {
          if (!store.stability) throw new Error("Missing stability");
        });
        result.record("archMetrics present", () => {
          if (!store.archMetrics) throw new Error("Missing archMetrics");
        });
        result.record("dependencySmell present", () => {
          if (!store.dependencySmell) throw new Error("Missing dependencySmell");
        });
      }),
    },
    {
      name: "semantic outputs are not produced by mechanical pipeline",
      test: withAgentRepo((result, store) => {
        result.record("no findings", () => {
          if (store.findings) throw new Error("Semantic findings should not exist in mechanical-only store");
        });
        result.record("no decisions", () => {
          if (store.decisions) throw new Error("Semantic decisions should not exist in mechanical-only store");
        });
        result.record("no report", () => {
          if (store.report) throw new Error("Generated report should not exist in mechanical-only store");
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
