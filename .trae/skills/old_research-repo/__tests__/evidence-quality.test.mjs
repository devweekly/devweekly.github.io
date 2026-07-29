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
  computeResearchCoverage,
} from "../evidence-quality.mjs";
import {
  CORE_ONTOLOGY_TYPES,
  CORE_RELATIONSHIP_TYPES,
  toCoreType,
  toCoreRelationship,
  projectToCoreTypeDistribution,
  projectToCoreRelDistribution,
} from "../evidence-store.mjs";

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

// ---------------------------------------------------------------------------
// Research Coverage (computeResearchCoverage)
// ---------------------------------------------------------------------------

describe("computeResearchCoverage", () => {
  it("returns empty dimensions for empty findings", () => {
    const cov = computeResearchCoverage([]);
    assert.ok(cov.dimensions);
    assert.strictEqual(cov.dimensions.Architecture.coverage, 0);
    assert.strictEqual(cov.dimensions.Architecture.findingCount, 0);
    assert.strictEqual(cov.summary.overallCoverage, 0);
  });

  it("computes coverage per dimension from findings", () => {
    const findings = [
      { questionId: "Q1", verified: "verified", confidence: 0.7 },
      { questionId: "Q2", verified: "verified", confidence: 0.6 },
      { questionId: "Q4", verified: "downgraded", confidence: 0.4 },
      { questionId: "Q9", verified: "verified", confidence: 0.8 },
      { questionId: "Q9", verified: "rejected", confidence: 0.1 }, // rejected → not counted
    ];
    const cov = computeResearchCoverage(findings);
    // Architecture = Q1+Q2+Q3 → 2 answered / 3 total = 0.67
    assert.ok(cov.dimensions.Architecture.coverage > 0.6);
    assert.strictEqual(cov.dimensions.Architecture.findingCount, 2);
    assert.strictEqual(cov.dimensions.Architecture.verifiedCount, 2);
    // Decisions = Q9+Q10+Q11 → 1 answered (Q9 verified, Q9 rejected not counted) / 3 = 0.33
    assert.ok(cov.dimensions.Decisions.coverage < 0.5);
    assert.strictEqual(cov.dimensions.Decisions.findingCount, 2);
    assert.strictEqual(cov.dimensions.Decisions.verifiedCount, 1);
  });

  it("assigns confidence label based on avg confidence", () => {
    const highFindings = [
      { questionId: "Q1", verified: "verified", confidence: 0.85 },
      { questionId: "Q2", verified: "verified", confidence: 0.75 },
    ];
    const cov = computeResearchCoverage(highFindings);
    assert.strictEqual(cov.dimensions.Architecture.confidence, "high");

    const lowFindings = [
      { questionId: "Q1", verified: "verified", confidence: 0.15 },
      { questionId: "Q2", verified: "verified", confidence: 0.2 },
    ];
    const covLow = computeResearchCoverage(lowFindings);
    assert.strictEqual(covLow.dimensions.Architecture.confidence, "low");
  });

  it("identifies weakest and strongest dimensions", () => {
    const findings = [
      { questionId: "Q1", verified: "verified", confidence: 0.7 },
      { questionId: "Q4", verified: "verified", confidence: 0.7 },
      { questionId: "Q5", verified: "verified", confidence: 0.7 },
      { questionId: "Q6", verified: "verified", confidence: 0.7 },
    ];
    const cov = computeResearchCoverage(findings);
    // AI/Capability = Q4+Q5+Q6 → full coverage (3/3) → strongest
    // Testing/Quality = Q7 only → 0/1 = 0.0 → weakest
    // Architecture = Q1 only → 1/3 = 0.33
    assert.strictEqual(cov.summary.strongestDimension, "AI/Capability");
    assert.strictEqual(cov.summary.weakestDimension, "Testing/Quality");
  });

  it("generates gap message for low coverage", () => {
    const findings = [{ questionId: "Q1", verified: "verified", confidence: 0.5 }];
    const cov = computeResearchCoverage(findings);
    // Architecture: 1/3 = 33% → "Only 33% of Architecture questions answered"
    assert.match(cov.dimensions.Architecture.gap, /Only.*Architecture/);
  });
});

// ---------------------------------------------------------------------------
// Core Ontology (toCoreType / toCoreRelationship / projectors)
// ---------------------------------------------------------------------------

describe("Core Ontology projections", () => {
  it("projects implementation types to 8 core types", () => {
    assert.strictEqual(toCoreType("agent"), "Entity");
    assert.strictEqual(toCoreType("function"), "Entity");
    assert.strictEqual(toCoreType("runner"), "Entity");
    assert.strictEqual(toCoreType("module"), "Module");
    assert.strictEqual(toCoreType("repository"), "Module");
    assert.strictEqual(toCoreType("tool"), "API");
    assert.strictEqual(toCoreType("prompt"), "API");
    assert.strictEqual(toCoreType("test"), "Artifact");
    assert.strictEqual(toCoreType("config"), "Artifact");
    assert.strictEqual(toCoreType("document"), "Artifact");
    assert.strictEqual(toCoreType("decision"), "Decision");
    assert.strictEqual(toCoreType("constraint"), "Decision");
    assert.strictEqual(toCoreType("assumption"), "Decision");
    assert.strictEqual(toCoreType("pattern"), "Pattern");
    assert.strictEqual(toCoreType("tradeoff"), "Pattern");
    assert.strictEqual(toCoreType("hypothesis"), "Pattern");
    assert.strictEqual(toCoreType("finding"), "Concept");
    assert.strictEqual(toCoreType("issue"), "Concept");
    assert.strictEqual(toCoreType("risk"), "Concept");
    assert.strictEqual(toCoreType("unknown"), "Concept");
  });

  it("returns Concept as fallback for unknown types", () => {
    assert.strictEqual(toCoreType("nonexistent_type"), "Concept");
    assert.strictEqual(toCoreType(""), "Concept");
    assert.strictEqual(toCoreType(null), "Concept");
  });

  it("projects relationship types to 8 core verbs", () => {
    assert.strictEqual(toCoreRelationship("implements"), "implements");
    assert.strictEqual(toCoreRelationship("implemented_by"), "implements");
    assert.strictEqual(toCoreRelationship("imports"), "depends_on");
    assert.strictEqual(toCoreRelationship("calls"), "depends_on");
    assert.strictEqual(toCoreRelationship("references"), "depends_on");
    assert.strictEqual(toCoreRelationship("owns"), "owns");
    assert.strictEqual(toCoreRelationship("configuredBy"), "owns");
    assert.strictEqual(toCoreRelationship("creates"), "creates");
    assert.strictEqual(toCoreRelationship("produces"), "creates");
    assert.strictEqual(toCoreRelationship("uses"), "uses");
    assert.strictEqual(toCoreRelationship("testedBy"), "uses");
    assert.strictEqual(toCoreRelationship("supported_by"), "uses");
    assert.strictEqual(toCoreRelationship("contains"), "contains");
    assert.strictEqual(toCoreRelationship("exposes"), "exposes");
    assert.strictEqual(toCoreRelationship("replaces"), "replaces");
    assert.strictEqual(toCoreRelationship("alternative_to"), "replaces");
    assert.strictEqual(toCoreRelationship("contradicts"), "replaces");
    assert.strictEqual(toCoreRelationship("conflicts_with"), "replaces");
  });

  it("returns depends_on as fallback for unknown relationships", () => {
    assert.strictEqual(toCoreRelationship("nonexistent_rel"), "depends_on");
    assert.strictEqual(toCoreRelationship(""), "depends_on");
  });

  it("projectToCoreTypeDistribution counts objects by core type", () => {
    const objects = [
      { type: "agent" },        // Entity
      { type: "function" },     // Entity
      { type: "runner" },       // Entity
      { type: "module" },       // Module
      { type: "tool" },         // API
      { type: "prompt" },       // API
      { type: "test" },         // Artifact
      { type: "decision" },     // Decision
      { type: "pattern" },      // Pattern
      { type: "finding" },      // Concept
    ];
    const dist = projectToCoreTypeDistribution(objects);
    assert.strictEqual(dist.Entity, 3);
    assert.strictEqual(dist.Module, 1);
    assert.strictEqual(dist.API, 2);
    assert.strictEqual(dist.Artifact, 1);
    assert.strictEqual(dist.Decision, 1);
    assert.strictEqual(dist.Pattern, 1);
    assert.strictEqual(dist.Concept, 1);
    assert.strictEqual(dist.Capability, 0); // not directly detectable yet
    // Sum equals total
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 10);
  });

  it("projectToCoreRelDistribution counts relationships by core verb", () => {
    const rels = [
      { type: "imports" },      // depends_on
      { type: "calls" },        // depends_on
      { type: "implements" },   // implements
      { type: "uses" },         // uses
      { type: "uses" },         // uses
      { type: "alternative_to" }, // replaces
    ];
    const dist = projectToCoreRelDistribution(rels);
    assert.strictEqual(dist.depends_on, 2);
    assert.strictEqual(dist.implements, 1);
    assert.strictEqual(dist.uses, 2);
    assert.strictEqual(dist.replaces, 1);
    assert.strictEqual(dist.owns, 0);
    assert.strictEqual(dist.creates, 0);
    assert.strictEqual(dist.contains, 0);
    assert.strictEqual(dist.exposes, 0);
  });

  it("CORE_ONTOLOGY_TYPES has exactly 8 types", () => {
    assert.strictEqual(CORE_ONTOLOGY_TYPES.length, 8);
    assert.deepStrictEqual(CORE_ONTOLOGY_TYPES, [
      "Entity", "Module", "API", "Capability",
      "Concept", "Artifact", "Decision", "Pattern",
    ]);
  });

  it("CORE_RELATIONSHIP_TYPES has exactly 8 verbs", () => {
    assert.strictEqual(CORE_RELATIONSHIP_TYPES.length, 8);
    assert.deepStrictEqual(CORE_RELATIONSHIP_TYPES, [
      "implements", "depends_on", "owns", "creates",
      "uses", "contains", "exposes", "replaces",
    ]);
  });

  it("projection is many-to-one (multiple impl types map to same core type)", () => {
    // All of agent/function/class/planner/runner → Entity
    const coreTypes = new Set(
      ["agent", "function", "class", "planner", "runner"].map(toCoreType)
    );
    assert.strictEqual(coreTypes.size, 1);
    assert.strictEqual([...coreTypes][0], "Entity");
  });
});
