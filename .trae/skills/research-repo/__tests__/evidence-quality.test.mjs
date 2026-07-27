// Tests for evidence-quality.mjs
// Run: node --test .trae/skills/research-repo/__tests__/evidence-quality.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  EvidenceSanitizer,
  buildArchetypeHints,
  propagateConfidence,
  calculateCoverage,
  rankClaim,
  checkStopCondition,
  enhanceStore,
} from "../evidence-quality.mjs";

describe("EvidenceSanitizer", () => {
  it("filters example and docs prompts", () => {
    const store = {
      prompts: {
        totalPrompts: 4,
        prompts: [
          { file: "examples/hello.py", name: "hello" },
          { file: "docs/prompts.md", name: "docs_prompt" },
          { file: "README.md", name: "readme_prompt" },
          { file: "src/agent.py", name: "agent_prompt" },
        ],
      },
    };
    const sanitizer = new EvidenceSanitizer();
    const { dropped, corrected } = sanitizer.sanitize(store);
    assert.strictEqual(store.prompts.prompts.length, 1);
    assert.strictEqual(store.prompts.totalPrompts, 1);
    assert.strictEqual(dropped.length, 3);
    assert.strictEqual(corrected.length, 1);
  });

  it("filters SDK middleware and platform utilities", () => {
    const store = {
      tools: {
        totalTools: 5,
        tools: [
          { file: "src/agent.js", name: "searchWeb" },
          { file: "node_modules/@aws-sdk/index.js", name: "invokeModel" },
          { file: "src/utils/index.ts", name: "" },
          { file: "src/_is_wsl.js", name: "_is_wsl" },
          { file: "vendor/lib.js", name: "vendorTool" },
        ],
      },
    };
    const sanitizer = new EvidenceSanitizer();
    const { dropped } = sanitizer.sanitize(store);
    assert.strictEqual(store.tools.tools.length, 1);
    assert.strictEqual(store.tools.totalTools, 1);
    assert.strictEqual(dropped.length, 4);
  });

  it("downgrades Event-Driven without event bus signal", () => {
    const store = {
      architecture: {
        pattern: { name: "Event-Driven", signals: ["react", "observer"], confidence: 0.7 },
      },
    };
    const sanitizer = new EvidenceSanitizer();
    sanitizer.sanitize(store);
    assert.strictEqual(store.architecture.pattern.name, "Unknown");
  });

  it("keeps Event-Driven with event bus signal", () => {
    const store = {
      architecture: {
        pattern: { name: "Event-Driven", signals: ["event bus"], confidence: 0.7 },
      },
    };
    const sanitizer = new EvidenceSanitizer();
    sanitizer.sanitize(store);
    assert.strictEqual(store.architecture.pattern.name, "Event-Driven");
  });
});

describe("buildArchetypeHints", () => {
  it("detects AI Agent signals", () => {
    const store = {
      discovery: { files: [{ path: "src/agent.py" }], manifest: {} },
      symbols: { classes: [{ name: "AgentRunner" }], functions: [] },
      tools: { totalTools: 3 },
      prompts: { totalPrompts: 2 },
      architecture: { nodes: [] },
    };
    const hints = buildArchetypeHints(store);
    assert.strictEqual(hints.signals.hasAgent, true);
    assert.strictEqual(hints.signals.hasTool, true);
    assert.strictEqual(hints.signals.hasPrompt, true);
  });

  it("detects Database signals via JDBC symbols", () => {
    const store = {
      discovery: { files: [{ path: "src/connection.java" }], manifest: {} },
      symbols: { classes: [{ name: "JDBCConnection" }], functions: [] },
      tools: { totalTools: 0 },
      prompts: { totalPrompts: 0 },
      architecture: { nodes: [] },
    };
    const hints = buildArchetypeHints(store);
    assert.strictEqual(hints.signals.hasDB, true);
  });

  it("provides catalog and counts", () => {
    const store = {
      discovery: { files: [], manifest: { main: "index.js" }, fileCount: 42 },
      symbols: { classes: [], functions: [] },
      tools: { totalTools: 0 },
      prompts: { totalPrompts: 0 },
      entrypoints: { entrypoints: ["index.js"] },
      architecture: { nodes: [] },
    };
    const hints = buildArchetypeHints(store);
    assert.ok(hints.catalog["AI Agent"]);
    assert.strictEqual(hints.counts.files, 42);
    assert.strictEqual(hints.manifest.hasMain, true);
  });
});

describe("propagateConfidence", () => {
  it("returns high confidence with multiple verified sources", () => {
    const claim = {
      evidence: [
        { source: "ast", confidence: 0.9 },
        { source: "test", confidence: 0.95 },
        { source: "git", confidence: 0.6 },
      ],
    };
    const c = propagateConfidence(claim);
    assert.ok(c > 0.8);
  });

  it("penalizes single source evidence", () => {
    const claim = {
      evidence: [{ source: "inference" }],
    };
    const c = propagateConfidence(claim);
    assert.ok(c < 0.3);
  });

  it("penalizes counter evidence", () => {
    const claim = {
      evidence: [
        { source: "ast", confidence: 0.9 },
        { source: "test", confidence: 0.95 },
      ],
      counterEvidence: [{}, {}],
    };
    const c = propagateConfidence(claim);
    assert.ok(c < 0.85);
  });
});

describe("calculateCoverage", () => {
  it("marks high coverage with code + test + doc", () => {
    const claim = {
      evidence: [
        { file: "src/planner.ts" },
        { file: "tests/planner.test.ts" },
        { file: "README.md" },
      ],
    };
    const coverage = calculateCoverage(claim);
    assert.strictEqual(coverage.level, "High");
    assert.strictEqual(coverage.dimensions.Code, true);
    assert.strictEqual(coverage.dimensions.Test, true);
    assert.strictEqual(coverage.dimensions.Doc, true);
  });

  it("marks low coverage with docs only", () => {
    const claim = {
      evidence: [{ file: "README.md" }],
    };
    const coverage = calculateCoverage(claim);
    assert.strictEqual(coverage.level, "Low");
  });
});

describe("rankClaim", () => {
  it("gives 5 stars to critical high-confidence high-coverage claim", () => {
    const claim = {
      importance: "Critical",
      confidence: 0.95,
      coverage: { covered: 5 },
      transferability: "High",
    };
    const r = rankClaim(claim);
    assert.strictEqual(r.stars, 5);
  });

  it("gives 1-2 stars to low importance low confidence claim", () => {
    const claim = {
      importance: "Low",
      confidence: 0.1,
      coverage: { covered: 1 },
      transferability: "Low",
    };
    const r = rankClaim(claim);
    assert.ok(r.stars <= 2);
  });
});

describe("checkStopCondition", () => {
  it("stops when completeness score is high", () => {
    const state = {
      questions: [{ answered: true }, { answered: true }, { answered: true }, { answered: true }],
      claims: [
        { coverage: { covered: 3 } },
        { coverage: { covered: 3 } },
        { coverage: { covered: 2 } },
      ],
      recentConfidenceChanges: [0.01, 0.02, 0.01],
    };
    const result = checkStopCondition(state);
    assert.strictEqual(result.shouldStop, true);
    assert.ok(result.completeness >= 80);
  });

  it("continues when questions are unanswered", () => {
    const state = {
      questions: [{ answered: false }, { answered: false }],
      claims: [{ coverage: { covered: 1 } }],
      recentConfidenceChanges: [0.1],
    };
    const result = checkStopCondition(state);
    assert.strictEqual(result.shouldStop, false);
  });
});

describe("enhanceStore", () => {
  it("returns sanitized info and archetype hints", () => {
    const store = {
      prompts: {
        totalPrompts: 2,
        prompts: [
          { file: "examples/ex.py", name: "ex" },
          { file: "src/agent.py", name: "agent_prompt" },
        ],
      },
      discovery: { files: [{ path: "src/agent.py" }], manifest: {}, fileCount: 10 },
      symbols: { classes: [{ name: "Agent" }], functions: [] },
      tools: { totalTools: 0 },
      prompts: { totalPrompts: 2, prompts: [{ file: "examples/ex.py" }, { file: "src/agent.py" }] },
      entrypoints: { entrypoints: [] },
      architecture: { nodes: [] },
    };
    const result = enhanceStore(store);
    assert.ok(result.archetypeHints);
    assert.ok(result.sanitized.dropped.length > 0);
    assert.strictEqual(store._archetypeHints.signals.hasAgent, true);
  });
});
