// ===========================================================================
// analyzer-output.test.mjs — Unit tests for deterministic Analyzer JSON output.
//
// Creates a minimal synthetic repository, runs each analyzer command, and
// validates that the JSON output contains the expected structural contract.
// These tests catch Analyzer regressions without invoking any LLM.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = join(import.meta.dirname, "../../../research-repo.mjs");

function createSyntheticRepo() {
  const workDir = join(tmpdir(), `research-repo-analyzer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(join(workDir, "src"), { recursive: true });
  mkdirSync(join(workDir, "tests"), { recursive: true });

  writeFileSync(
    join(workDir, "package.json"),
    JSON.stringify({ name: "synthetic-agent", version: "1.0.0", main: "src/index.js" })
  );
  writeFileSync(
    join(workDir, "README.md"),
    "# Synthetic Agent\n\nA minimal agent framework with Runner and Tool.\n"
  );
  writeFileSync(
    join(workDir, "src", "agent.js"),
    "export class Agent { constructor(tools) { this.tools = tools; } run(prompt) { return this.tools[0].execute(prompt); } }"
  );
  writeFileSync(
    join(workDir, "src", "runner.js"),
    "import { Agent } from './agent.js'; export function run(agent, prompt) { return agent.run(prompt); }"
  );
  writeFileSync(
    join(workDir, "src", "tool.js"),
    "export class Tool { constructor(name) { this.name = name; } execute(input) { return input; } }"
  );
  mkdirSync(join(workDir, "src", "prompts"), { recursive: true });
  writeFileSync(
    join(workDir, "src", "prompts", "system.txt"),
    "You are a helpful agent. Use tools when needed."
  );
  writeFileSync(
    join(workDir, "tests", "agent.test.js"),
    "import { test } from 'node:test'; test('agent runs', () => {});"
  );

  return workDir;
}

function runAnalyzer(command, repoPath) {
  const result = spawnSync("node", [SCRIPT, command, repoPath], {
    cwd: repoPath,
    encoding: "utf-8",
    timeout: 120000,
  });
  return result;
}

function parseJson(result, context) {
  if (result.status !== 0) {
    throw new Error(`CLI error [${context}]: ${result.stderr || result.stdout}`);
  }
  const stdout = result.stdout;
  // Commands may emit markdown/progress before the JSON payload.
  // Extract the largest top-level JSON object/array from stdout.
  const jsonMatch = stdout.match(/(\{[\s\S]*\}|\[[\s\S]*\])$/);
  const payload = jsonMatch ? jsonMatch[1] : stdout.trim();
  try {
    return JSON.parse(payload);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON [${context}]: ${err.message}. stdout: ${stdout.slice(0, 500)}... stderr: ${result.stderr}`
    );
  }
}

export function runAnalyzerOutputTests() {
  const workDir = createSyntheticRepo();

  try {
    return runSuite("unit — analyzer output", [
      {
        name: "discovery command returns repository metadata",
        test(result) {
          const output = parseJson(runAnalyzer("discovery", workDir), "discovery");
          result.record("has repository name", () => {
            if (!output.repoName && !output.name && !output.repository?.name) throw new Error("Missing repository name");
          });
          result.record("has files or fileTree", () => {
            if (!output.allFiles && !output.files && !output.fileTree) throw new Error("Missing files/fileTree");
          });
        },
      },
      {
        name: "symbols command returns semantic index",
        test(result) {
          const output = parseJson(runAnalyzer("symbols", workDir), "symbols");
          result.record("has modules or functions", () => {
            if (!output.modules && !output.functions && !output.totalFunctions !== undefined) {
              throw new Error("Missing modules/functions");
            }
          });
          result.record("detects Agent class", () => {
            const text = JSON.stringify(output).toLowerCase();
            if (!text.includes("agent")) throw new Error("Agent class not found in symbols");
          });
        },
      },
      {
        name: "architecture command returns graph structure",
        test(result) {
          const output = parseJson(runAnalyzer("architecture", workDir), "architecture");
          result.record("has nodes/edges or totalNodes/totalEdges", () => {
            if (!output.nodes && output.totalNodes === undefined) throw new Error("Missing nodes");
            if (!output.edges && output.totalEdges === undefined) throw new Error("Missing edges");
          });
        },
      },
      {
        name: "prompts command returns prompt discovery",
        test(result) {
          const output = parseJson(runAnalyzer("prompts", workDir), "prompts");
          result.record("has prompts array or total", () => {
            if (!Array.isArray(output.prompts) && output.total === undefined) {
              throw new Error("Missing prompts array or total");
            }
          });
        },
      },
      {
        name: "tools command returns tool discovery",
        test(result) {
          const output = parseJson(runAnalyzer("tools", workDir), "tools");
          result.record("has tools array or total", () => {
            if (!Array.isArray(output.tools) && output.total === undefined) {
              throw new Error("Missing tools array or total");
            }
          });
        },
      },
      {
        name: "tests command returns test discovery",
        test(result) {
          const output = parseJson(runAnalyzer("tests", workDir), "tests");
          result.record("has tests array or total", () => {
            if (
              !Array.isArray(output.tests) &&
              !Array.isArray(output.fileDetails) &&
              output.total === undefined &&
              output.totalTestFiles === undefined
            ) {
              throw new Error("Missing tests array or total");
            }
          });
        },
      },
      {
        name: "all command produces complete evidence store",
        test(result) {
          const output = parseJson(runAnalyzer("all", workDir), "all");
          result.record("has repository", () => {
            if (!output.repository && !output.discovery) throw new Error("Missing repository/discovery");
          });
          result.record("has symbols", () => {
            if (!output.symbols) throw new Error("Missing symbols");
          });
          result.record("has architecture", () => {
            if (!output.architecture) throw new Error("Missing architecture");
          });
          result.record("has archetypeHints", () => {
            if (!output.archetypeHints && !output._archetypeHints) throw new Error("Missing archetypeHints");
          });
        },
      },
    ]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runAnalyzerOutputTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
