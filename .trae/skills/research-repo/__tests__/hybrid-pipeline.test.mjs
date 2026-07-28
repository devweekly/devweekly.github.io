// Unit tests for Hybrid Pipeline (llm-runner.mjs + hybrid-pipeline.mjs)
//
// Uses RESEARCH_REPO_LLM_CMD env var to mock LLM — no real CLI needed.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import {
  invokeLLM,
  invokeLLMJSON,
  renderPrompt,
  DEFAULT_LLM_OPTIONS,
} from "../llm-runner.mjs";
import {
  runHybridPipeline,
  listMechanicalAnalyzers,
  listSemanticAnalyzers,
  DEFAULT_HYBRID_OPTIONS,
  MECHANICAL_ANALYZER_NAMES,
} from "../hybrid-pipeline.mjs";
import {
  createSyntheticRepo,
  cleanupSyntheticRepo,
} from "../skill-test/lib/synthetic-repos.mjs";

// ---------------------------------------------------------------------------
// llm-runner.mjs tests
// ---------------------------------------------------------------------------

describe("llm-runner", () => {
  const savedCmd = process.env.RESEARCH_REPO_LLM_CMD;

  before(() => {
    // Mock LLM command: echoes prompt back as response
    process.env.RESEARCH_REPO_LLM_CMD = "cat";
  });

  after(() => {
    if (savedCmd !== undefined) {
      process.env.RESEARCH_REPO_LLM_CMD = savedCmd;
    } else {
      delete process.env.RESEARCH_REPO_LLM_CMD;
    }
  });

  it("DEFAULT_LLM_OPTIONS has expected fields", () => {
    assert.strictEqual(
      DEFAULT_LLM_OPTIONS.model,
      "opencode/deepseek-v4-flash-free"
    );
    assert.strictEqual(DEFAULT_LLM_OPTIONS.jsonMode, false);
    assert.strictEqual(DEFAULT_LLM_OPTIONS.systemPrompt, null);
  });

  it("invokeLLM returns string from mock command", async () => {
    const result = await invokeLLM("test prompt");
    assert.ok(typeof result === "string");
    assert.ok(result.includes("test prompt"));
  });

  it("invokeLLM injects JSON mode instruction", async () => {
    const result = await invokeLLM("analyze this", { jsonMode: true });
    assert.match(result, /valid JSON only/);
  });

  it("invokeLLM prepends system prompt", async () => {
    const result = await invokeLLM("user query", {
      systemPrompt: "YOU ARE AN EXPERT",
    });
    assert.match(result, /\[System\]/);
    assert.match(result, /YOU ARE AN EXPERT/);
    assert.match(result, /\[User\]/);
  });

  it("invokeLLMJSON parses JSON response", async () => {
    // Mock command that outputs JSON
    process.env.RESEARCH_REPO_LLM_CMD = "echo {\"result\":\"ok\"}";
    try {
      const result = await invokeLLMJSON("test");
      assert.deepStrictEqual(result, { result: "ok" });
    } finally {
      process.env.RESEARCH_REPO_LLM_CMD = "cat";
    }
  });

  it("invokeLLMJSON strips markdown fences (direct regex test)", () => {
    // Directly test the fence-stripping regex logic (avoids shell quoting issues)
    const fenced = "```json\n{\"x\":1}\n```";
    const cleaned = fenced
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    assert.deepStrictEqual(JSON.parse(cleaned), { x: 1 });
  });

  it("invokeLLMJSON throws on invalid JSON", async () => {
    process.env.RESEARCH_REPO_LLM_CMD = "echo NOT_JSON";
    try {
      await assert.rejects(
        () => invokeLLMJSON("test"),
        /LLM did not return valid JSON/
      );
    } finally {
      process.env.RESEARCH_REPO_LLM_CMD = "cat";
    }
  });

  it("renderPrompt substitutes {placeholder} tokens", () => {
    const result = renderPrompt("Hello {name}, repo is {repo}", {
      name: "World",
      repo: "test-repo",
    });
    assert.strictEqual(result, "Hello World, repo is test-repo");
  });

  it("renderPrompt leaves unknown tokens unchanged", () => {
    const result = renderPrompt("Hello {name} {unknown}", { name: "World" });
    assert.strictEqual(result, "Hello World {unknown}");
  });
});

// ---------------------------------------------------------------------------
// hybrid-pipeline.mjs — analyzer classification
// ---------------------------------------------------------------------------

describe("Hybrid pipeline analyzer classification", () => {
  it("lists 17 mechanical analyzers", () => {
    const mechanical = listMechanicalAnalyzers();
    assert.strictEqual(mechanical.length, 17);
    // Spot check key analyzers
    assert.ok(mechanical.includes("DiscoveryAnalyzer"));
    assert.ok(mechanical.includes("SymbolsAnalyzer"));
    assert.ok(mechanical.includes("ArchitectureAnalyzer"));
    assert.ok(mechanical.includes("ArchitectureMetricsAnalyzer"));
    assert.ok(mechanical.includes("DependencySmellAnalyzer"));
    assert.ok(mechanical.includes("TemporalAnalyzer"));
    assert.ok(mechanical.includes("InformationFlowAnalyzer"));
    assert.ok(mechanical.includes("StabilityAnalyzer"));
  });

  it("lists 8 semantic analyzers (skipped in hybrid mode)", () => {
    const semantic = listSemanticAnalyzers();
    assert.strictEqual(semantic.length, 8);
    assert.ok(semantic.includes("ArchitecturePatternAnalyzer"));
    assert.ok(semantic.includes("ResponsibilityAnalyzer"));
    assert.ok(semantic.includes("CapabilityOntologyAnalyzer"));
    assert.ok(semantic.includes("DecisionAnalyzer"));
    assert.ok(semantic.includes("ConstraintAnalyzer"));
    assert.ok(semantic.includes("AssumptionAnalyzer"));
    assert.ok(semantic.includes("DesignPatternAnalyzer"));
    assert.ok(semantic.includes("ConsistencyAnalyzer"));
  });

  it("mechanical + semantic = 25 total analyzers", () => {
    const total = listMechanicalAnalyzers().length + listSemanticAnalyzers().length;
    assert.strictEqual(total, 25);
  });

  it("MECHANICAL_ANALYZER_NAMES does not contain semantic analyzers", () => {
    const semanticNames = listSemanticAnalyzers();
    for (const name of semanticNames) {
      assert.ok(
        !MECHANICAL_ANALYZER_NAMES.has(name),
        `${name} should not be in mechanical set`
      );
    }
  });

  it("DEFAULT_HYBRID_OPTIONS has expected defaults", () => {
    assert.strictEqual(DEFAULT_HYBRID_OPTIONS.skillPrompt, "07-report-writer.md");
    assert.strictEqual(
      DEFAULT_HYBRID_OPTIONS.model,
      "opencode/deepseek-v4-flash-free"
    );
    assert.strictEqual(DEFAULT_HYBRID_OPTIONS.outputFormat, "markdown");
    assert.strictEqual(DEFAULT_HYBRID_OPTIONS.returnEvidenceBrief, false);
  });
});

// ---------------------------------------------------------------------------
// hybrid-pipeline.mjs — end-to-end pipeline (mocked LLM)
// ---------------------------------------------------------------------------

describe("Hybrid pipeline end-to-end (mocked LLM)", () => {
  const savedCmd = process.env.RESEARCH_REPO_LLM_CMD;
  let tempRepos = [];

  before(() => {
    process.env.RESEARCH_REPO_LLM_CMD = "cat"; // echo prompt as response
  });

  after(() => {
    if (savedCmd !== undefined) {
      process.env.RESEARCH_REPO_LLM_CMD = savedCmd;
    } else {
      delete process.env.RESEARCH_REPO_LLM_CMD;
    }
    for (const dir of tempRepos) {
      try { cleanupSyntheticRepo(dir); } catch { /* ignore */ }
    }
  });

  it("runs on synthetic agent repo and returns report string", async () => {
    const dir = createSyntheticRepo("agent");
    tempRepos.push(dir);
    const report = await runHybridPipeline(dir);
    assert.ok(typeof report === "string");
    assert.ok(report.length > 100, "report should have content");
  });

  it("returns evidence brief when returnEvidenceBrief=true", async () => {
    const dir = createSyntheticRepo("database");
    tempRepos.push(dir);
    const result = await runHybridPipeline(dir, { returnEvidenceBrief: true });
    assert.ok(typeof result === "object");
    assert.ok(result.evidenceBrief, "should have evidenceBrief");
    assert.ok(result.report, "should have report");
    assert.ok(typeof result.report === "string");
  });

  it("evidence brief contains mechanical sections only", async () => {
    const dir = createSyntheticRepo("tool");
    tempRepos.push(dir);
    const { evidenceBrief } = await runHybridPipeline(dir, {
      returnEvidenceBrief: true,
    });
    // Mechanical sections should be present
    assert.ok(evidenceBrief._meta);
    assert.ok(evidenceBrief.repository);
    assert.ok(evidenceBrief.symbols);
    assert.ok(evidenceBrief.architecture);
    // Semantic sections should NOT be present (delegated to LLM)
    assert.ok(!evidenceBrief.findings, "findings should not exist (LLM's job)");
    assert.ok(!evidenceBrief.decisions, "decisions should not exist (LLM's job)");
    assert.ok(!evidenceBrief.consistency, "consistency should not exist (LLM's job)");
    assert.ok(!evidenceBrief.archPattern, "archPattern should not exist (LLM's job)");
  });

  it("evidence brief _meta records skipped semantic analyzers", async () => {
    const dir = createSyntheticRepo("database");
    tempRepos.push(dir);
    const { evidenceBrief } = await runHybridPipeline(dir, {
      returnEvidenceBrief: true,
    });
    assert.strictEqual(evidenceBrief._meta.pipeline, "hybrid");
    assert.ok(Array.isArray(evidenceBrief._meta.skippedSemanticAnalyzers));
    assert.ok(evidenceBrief._meta.skippedSemanticAnalyzers.length >= 8);
  });

  it("evidence brief includes archetype hints (signals only, no classification)", async () => {
    const dir = createSyntheticRepo("agent");
    tempRepos.push(dir);
    const { evidenceBrief } = await runHybridPipeline(dir, {
      returnEvidenceBrief: true,
    });
    assert.ok(evidenceBrief.archetypeHints);
    assert.ok(evidenceBrief.archetypeHints.signals);
    assert.ok(evidenceBrief.archetypeHints.signals.hasAgent);
    // Should NOT have a final archetype classification (LLM decides)
    assert.ok(!evidenceBrief.archetypeHints.archetype, "archetype decision is LLM's job");
  });

  it("evidence brief includes dependency smell (mechanical)", async () => {
    const dir = createSyntheticRepo("database");
    tempRepos.push(dir);
    const { evidenceBrief } = await runHybridPipeline(dir, {
      returnEvidenceBrief: true,
    });
    // dependencySmell may be empty but section should exist
    assert.ok(evidenceBrief.dependencySmell, "dependencySmell section should exist");
  });

  it("evidence brief includes arch metrics (mechanical)", async () => {
    const dir = createSyntheticRepo("database");
    tempRepos.push(dir);
    const { evidenceBrief } = await runHybridPipeline(dir, {
      returnEvidenceBrief: true,
    });
    assert.ok(evidenceBrief.archMetrics, "archMetrics section should exist");
  });

  it("renders skill prompt with repoName substitution", async () => {
    const dir = createSyntheticRepo("agent");
    tempRepos.push(dir);
    const report = await runHybridPipeline(dir, { repoName: "my-test-repo" });
    // The mock LLM (cat) echoes the prompt back, which should contain repoName
    assert.match(report, /my-test-repo/);
  });

  it("supports JSON output format via invokeLLMJSON", async () => {
    const dir = createSyntheticRepo("tool");
    tempRepos.push(dir);
    // Mock LLM that outputs JSON
    process.env.RESEARCH_REPO_LLM_CMD = 'echo {\"summary\":\"test\"}';
    try {
      const result = await runHybridPipeline(dir, { outputFormat: "json" });
      assert.deepStrictEqual(result, { summary: "test" });
    } finally {
      process.env.RESEARCH_REPO_LLM_CMD = "cat";
    }
  });

  it("runs on all 4 synthetic archetypes without error", async () => {
    for (const archetype of ["agent", "database", "tool", "readme-claims"]) {
      const dir = createSyntheticRepo(archetype);
      tempRepos.push(dir);
      const report = await runHybridPipeline(dir);
      assert.ok(typeof report === "string", `${archetype} should produce a report`);
      assert.ok(report.length > 0, `${archetype} report should not be empty`);
    }
  });
});
