// ===========================================================================
// archetype-behavior.test.mjs — Behavior Test for Repository Archetypes (LIVE)
//
// Runs the real Analyzer on synthetic archetype repositories and verifies
// that archetype signals are correctly detected. This is NOT a static fixture
// check — each test case creates a real repo, runs `research-repo.mjs all`,
// and asserts on the actual evidence store output.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { runAnalyzerAll, runAnalyzerReport, getSignals } from "../../lib/analyzer-runner.mjs";

function withRepo(archetype, fn) {
  return (result) => {
    const dir = createSyntheticRepo(archetype);
    try {
      fn(result, dir);
    } finally {
      cleanupSyntheticRepo(dir);
    }
  };
}

export function runArchetypeBehaviorTests() {
  return runSuite("behavior — archetype detection (live)", [
    {
      name: "database repo triggers SQL/parser/lexer signals",
      test: withRepo("database", (result, dir) => {
        const store = runAnalyzerAll(dir);
        const signals = getSignals(store);

        result.record("hasSQL is true", () => {
          if (!signals.hasSQL) throw new Error("Expected hasSQL=true (sql/parser files present)");
        });
        result.record("hasParser is true", () => {
          if (!signals.hasParser) throw new Error("Expected hasParser=true (SQLParser class)");
        });
        result.record("hasLexer is true", () => {
          if (!signals.hasLexer) throw new Error("Expected hasLexer=true (tokenize function)");
        });
        result.record("hasAgent is false (no agent code)", () => {
          if (signals.hasAgent) throw new Error("Expected hasAgent=false");
        });
        result.record("hasPlugin is false (no plugin code)", () => {
          if (signals.hasPlugin) throw new Error("Expected hasPlugin=false");
        });
      }),
    },
    {
      name: "agent repo triggers agent/tool signals",
      test: withRepo("agent", (result, dir) => {
        const store = runAnalyzerAll(dir);
        const signals = getSignals(store);

        result.record("hasAgent is true", () => {
          if (!signals.hasAgent) throw new Error("Expected hasAgent=true (Agent class)");
        });
        result.record("hasTool is true", () => {
          if (!signals.hasTool) throw new Error("Expected hasTool=true (Tool class)");
        });
        result.record("hasSQL is false (no SQL code)", () => {
          if (signals.hasSQL) throw new Error("Expected hasSQL=false");
        });
        result.record("hasParser is false (no parser code)", () => {
          if (signals.hasParser) throw new Error("Expected hasParser=false");
        });
      }),
    },
    {
      name: "tool repo triggers plugin signals",
      test: withRepo("tool", (result, dir) => {
        const store = runAnalyzerAll(dir);
        const signals = getSignals(store);

        result.record("hasPlugin is true", () => {
          if (!signals.hasPlugin) throw new Error("Expected hasPlugin=true (Plugin class)");
        });
        result.record("hasSQL is false (no SQL code)", () => {
          if (signals.hasSQL) throw new Error("Expected hasSQL=false");
        });
        result.record("hasAgent is false (no agent code)", () => {
          if (signals.hasAgent) throw new Error("Expected hasAgent=false");
        });
      }),
    },
    {
      name: "different archetypes produce different signal sets",
      test(result) {
        const dbDir = createSyntheticRepo("database");
        const agentDir = createSyntheticRepo("agent");
        const toolDir = createSyntheticRepo("tool");
        try {
          const dbSignals = JSON.stringify(getSignals(runAnalyzerAll(dbDir)));
          const agentSignals = JSON.stringify(getSignals(runAnalyzerAll(agentDir)));
          const toolSignals = JSON.stringify(getSignals(runAnalyzerAll(toolDir)));

          result.record("database != agent signals", () => {
            if (dbSignals === agentSignals) throw new Error("Database and agent signals are identical");
          });
          result.record("database != tool signals", () => {
            if (dbSignals === toolSignals) throw new Error("Database and tool signals are identical");
          });
          result.record("agent != tool signals", () => {
            if (agentSignals === toolSignals) throw new Error("Agent and tool signals are identical");
          });
        } finally {
          cleanupSyntheticRepo(dbDir);
          cleanupSyntheticRepo(agentDir);
          cleanupSyntheticRepo(toolDir);
        }
      },
    },
    {
      name: "evidence-brief contains archetype-appropriate keywords",
      test: withRepo("database", (result, dir) => {
        const brief = runAnalyzerReport(dir);
        const lower = brief.toLowerCase();

        result.record("brief mentions sql", () => {
          if (!lower.includes("sql")) throw new Error("Expected brief to mention SQL");
        });
        result.record("brief mentions parser", () => {
          if (!lower.includes("parser")) throw new Error("Expected brief to mention parser");
        });
      }),
    },
    {
      name: "evidence-brief mentions agent keywords for agent repo",
      test: withRepo("agent", (result, dir) => {
        const brief = runAnalyzerReport(dir);
        const lower = brief.toLowerCase();

        result.record("brief mentions agent", () => {
          if (!lower.includes("agent")) throw new Error("Expected brief to mention agent");
        });
        result.record("brief mentions tool", () => {
          if (!lower.includes("tool")) throw new Error("Expected brief to mention tool");
        });
      }),
    },
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runArchetypeBehaviorTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
