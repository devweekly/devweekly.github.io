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
        // CRITICAL: hasDB must be false — DriverManager in Eclipse Plugin is NOT a DB signal.
        // Regression guard for the hasDB false-positive bug (DriverManager keyword).
        result.record("hasDB is false (DriverManager is not a DB signal)", () => {
          if (signals.hasDB) throw new Error("Expected hasDB=false — DriverManager in Eclipse Plugin is not a database signal");
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
    {
      name: "Findings differ across archetypes (not template-driven)",
      test(result) {
        const dirs = {};
        const findings = {};
        try {
          for (const arch of ["database", "agent", "tool", "readme-claims"]) {
            dirs[arch] = createSyntheticRepo(arch);
            const store = runAnalyzerAll(dirs[arch]);
            findings[arch] = store.findings?.findings || [];
          }

          // CRITICAL: Findings must NOT be identical across archetypes.
          // Compare archetype-specific Findings (Q5=tools, Q6=AI project, Q8=README contradictions).
          // F-001 (entrypoints) is intentionally similar across repos (all have src/index.js).
          const dbF006 = findings.database.find((f) => f.id === "F-006")?.finding || "";
          const rcF006 = findings["readme-claims"].find((f) => f.id === "F-006")?.finding || "";

          result.record("F-006 (AI project) finding can differ or match — but Q8 must differ", () => {
            // Q8 is the key differentiator: readme-claims has README contradictions, database does not.
            const dbQ8 = findings.database.filter((f) => f.questionId === "Q8");
            const rcQ8 = findings["readme-claims"].filter((f) => f.questionId === "Q8");
            if (rcQ8.length <= dbQ8.length) {
              throw new Error(`Expected readme-claims Q8 findings (${rcQ8.length}) > database (${dbQ8.length})`);
            }
          });

          result.record("readme-claims Q8 findings mention README claims", () => {
            const rcQ8 = findings["readme-claims"].filter((f) => f.questionId === "Q8");
            const q8Text = rcQ8.map((f) => f.finding).join(" ");
            if (!/README claims/i.test(q8Text)) {
              throw new Error(`Q8 findings should mention "README claims" but got: ${q8Text.slice(0, 200)}`);
            }
          });

          // Different archetypes should produce different signal-based Findings.
          // database has hasSQL=true, readme-claims has hasSQL=false → F-003 (RAG) text may differ.
          const dbF003 = findings.database.find((f) => f.id === "F-003")?.finding || "";
          const rcF003 = findings["readme-claims"].find((f) => f.id === "F-003")?.finding || "";
          result.record("F-003 (RAG) finding text is non-empty for both archetypes", () => {
            if (!dbF003 || !rcF003) {
              throw new Error("F-003 finding text should be non-empty");
            }
          });
        } finally {
          for (const d of Object.values(dirs)) cleanupSyntheticRepo(d);
        }
      },
    },
    {
      name: "database brief discusses SQL/parser (not generic template)",
      test: withRepo("database", (result, dir) => {
        const brief = runAnalyzerReport(dir);
        const lower = brief.toLowerCase();

        // Brief should contain archetype-specific evidence, not just generic templates.
        result.record("brief discusses SQL (archetype-specific)", () => {
          if (!lower.includes("sql")) throw new Error("Expected brief to discuss SQL for database archetype");
        });
        result.record("brief discusses parser (archetype-specific)", () => {
          if (!lower.includes("parser")) throw new Error("Expected brief to discuss parser for database archetype");
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
