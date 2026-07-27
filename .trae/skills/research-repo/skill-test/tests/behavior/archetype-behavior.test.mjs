// ===========================================================================
// archetype-behavior.test.mjs — Behavior Test for Repository Archetypes
//
// Tests that different repository archetypes produce distinct, archetype-
// appropriate research questions and avoid cross-archetype contamination.
// ===========================================================================

import { runSuite, assertContains } from "../../lib/test-runner.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

function loadExpectedQuestions(fixture) {
  return readFileSync(join(FIXTURES_DIR, fixture, "expected/00-research-questions.md"), "utf-8");
}

function questionSectionOnly(text) {
  const marker = /(^|\n)## Filtered Out/i;
  const idx = text.search(marker);
  return idx >= 0 ? text.slice(0, idx) : text;
}

function extractQuestionBlocks(text) {
  // Match ### QN: ... until next ### or section header
  return (text.match(/### Q\d+:.+?(?=### Q\d+:|## |\Z)/gs) || []);
}

export function runArchetypeBehaviorTests() {
  return runSuite("behavior — archetype", [
    {
      name: "duckdb questions are database-specific",
      test(result) {
        const text = questionSectionOnly(loadExpectedQuestions("duckdb"));
        result.record("mentions vectorized", () => assertContains(text, "Vectorized"));
        result.record("mentions optimizer", () => assertContains(text, "Optimizer"));
        result.record("does not mention runner", () => {
          if (/\bRunner\b/i.test(text)) throw new Error("DuckDB should not ask about Runner");
        });
        result.record("does not mention plugin", () => {
          if (/\bPlugin\b/i.test(text)) throw new Error("DuckDB should not ask about Plugin");
        });
      },
    },
    {
      name: "openai-agents questions are agent-specific",
      test(result) {
        const text = questionSectionOnly(loadExpectedQuestions("openai-agents"));
        result.record("mentions runner", () => assertContains(text, "Runner"));
        result.record("mentions context", () => assertContains(text, "Context"));
        result.record("mentions tool", () => assertContains(text, "Tool"));
        result.record("does not mention volcano", () => {
          if (/\bVolcano\b/i.test(text)) throw new Error("Agent should not ask about Volcano");
        });
        result.record("does not mention eclipse", () => {
          if (/\bEclipse\b/i.test(text)) throw new Error("Agent should not ask about Eclipse");
        });
      },
    },
    {
      name: "dbeaver questions are developer-tool-specific",
      test(result) {
        const text = questionSectionOnly(loadExpectedQuestions("dbeaver"));
        result.record("mentions plugin", () => assertContains(text, "Plugin"));
        result.record("mentions eclipse", () => assertContains(text, "Eclipse"));
        result.record("mentions driver", () => assertContains(text, "Driver"));
        result.record("does not mention llm", () => {
          if (/\bLLM\b/i.test(text)) throw new Error("DBeaver should not ask about LLM");
        });
        result.record("does not mention runner", () => {
          if (/\bRunner\b/i.test(text)) throw new Error("DBeaver should not ask about Runner");
        });
      },
    },
    {
      name: "question blocks contain required fields",
      test(result) {
        for (const fixture of ["duckdb", "openai-agents", "dbeaver"]) {
          const text = loadExpectedQuestions(fixture);
          const blocks = extractQuestionBlocks(text);
          result.record(`${fixture}: has 5 question blocks`, () => {
            if (blocks.length < 5) throw new Error(`Expected 5 question blocks, got ${blocks.length}`);
          });
          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            result.record(`${fixture} Q${i + 1}: has Why it matters`, () => {
              assertContains(block, "Why it matters");
            });
            result.record(`${fixture} Q${i + 1}: has Expected Evidence`, () => {
              assertContains(block, "Expected Evidence");
            });
            result.record(`${fixture} Q${i + 1}: has Hypothesis`, () => {
              assertContains(block, "Hypothesis");
            });
            result.record(`${fixture} Q${i + 1}: has Alternative`, () => {
              assertContains(block, "Alternative");
            });
          }
        }
      },
    },
    {
      name: "archetypes are mutually distinct",
      test(result) {
        const duckdb = questionSectionOnly(loadExpectedQuestions("duckdb")).toLowerCase();
        const agents = questionSectionOnly(loadExpectedQuestions("openai-agents")).toLowerCase();
        const dbeaver = questionSectionOnly(loadExpectedQuestions("dbeaver")).toLowerCase();

        result.record("duckdb vs agents have no shared keyword dominance", () => {
          if (duckdb.includes("runner") && agents.includes("runner")) {
            throw new Error("DuckDB and Agents should not both focus on Runner");
          }
        });
        result.record("agents vs dbeaver have no shared keyword dominance", () => {
          if (agents.includes("plugin") && dbeaver.includes("plugin")) {
            throw new Error("Agents and DBeaver should not both focus on Plugin");
          }
        });
      },
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
