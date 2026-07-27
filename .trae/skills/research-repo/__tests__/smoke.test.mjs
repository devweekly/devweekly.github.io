// Smoke tests for research-repo CLI
// Run: node --test .trae/skills/research-repo/__tests__/smoke.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = "/Users/saga/code-repos/devweekly.github.io/.trae/skills/research-repo/research-repo.mjs";

describe("research-repo CLI smoke tests", () => {
  it("all command produces valid evidence store with archetype hints", () => {
    const workDir = join(tmpdir(), `research-repo-smoke-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
    mkdirSync(join(workDir, "src"), { recursive: true });
    writeFileSync(join(workDir, "package.json"), JSON.stringify({ name: "smoke-test", main: "src/index.js" }));
    writeFileSync(join(workDir, "src", "index.js"), "export function runAgent(tool, prompt) { return { tool, prompt }; }");

    const result = spawnSync("node", [SCRIPT, "all", workDir], {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 120000,
    });

    assert.strictEqual(result.status, 0, `CLI exited with error: ${result.stderr}`);
    assert.ok(result.stdout.length > 0, "CLI produced no output");

    const store = JSON.parse(result.stdout);
    assert.ok(store.discovery, "Evidence store should contain discovery");
    assert.ok(store.symbols, "Evidence store should contain symbols");
    assert.ok(store._archetypeHints, "Evidence store should contain archetype hints");

    rmSync(workDir, { recursive: true, force: true });
  });

  it("brain-init command initializes Brain", () => {
    const brainDir = join(tmpdir(), `research-repo-brain-smoke-${Date.now()}`);
    const result = spawnSync("node", [SCRIPT, "brain-init", brainDir], {
      encoding: "utf-8",
      timeout: 30000,
    });

    assert.strictEqual(result.status, 0, `brain-init failed: ${result.stderr}`);
    const summary = JSON.parse(result.stdout);
    assert.ok(summary.counts, "Brain summary should have counts");
    assert.strictEqual(summary.counts.pattern, 0);
    assert.strictEqual(summary.counts.decision, 0);

    rmSync(brainDir, { recursive: true, force: true });
  });
});
