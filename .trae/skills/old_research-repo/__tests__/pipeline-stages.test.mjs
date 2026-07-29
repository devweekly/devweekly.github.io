// ===========================================================================
// pipeline-stages.test.mjs — Tests for Pipeline v2 stage runners
//
// Uses mock LLM (via RESEARCH_REPO_LLM_CMD=cat) to test stage orchestration
// without requiring a real OpenCode CLI.
// ===========================================================================

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runModelingStage,
  runInterpretationStage,
  buildFingerprint,
  runNarrativeStage,
  runPipelineV2,
  discoverDocuments,
} from "../hybrid-pipeline.mjs";
import {
  SCHEMA_VERSIONS,
  validateKG,
  validateFindings,
  validateFingerprint,
} from "../schemas.mjs";

// ---------------------------------------------------------------------------
// Mock LLM setup
// ---------------------------------------------------------------------------

const ORIGINAL_LLM_CMD = process.env.RESEARCH_REPO_LLM_CMD;

function setupMockLLM(response) {
  // Write response to a temp file, then use cat to return it
  const tmpFile = join(tmpdir(), `mock-llm-${Date.now()}.txt`);
  writeFileSync(tmpFile, response);
  process.env.RESEARCH_REPO_LLM_CMD = `cat ${tmpFile}`;
  return tmpFile;
}

function cleanupMockLLM(tmpFile) {
  if (tmpFile && tmpFile.startsWith(tmpdir())) {
    try { rmSync(tmpFile, { force: true }); } catch { /* ignore */ }
  }
  if (ORIGINAL_LLM_CMD !== undefined) {
    process.env.RESEARCH_REPO_LLM_CMD = ORIGINAL_LLM_CMD;
  } else {
    delete process.env.RESEARCH_REPO_LLM_CMD;
  }
}

// ---------------------------------------------------------------------------
// Valid mock responses
// ---------------------------------------------------------------------------

const MOCK_KG = {
  version: SCHEMA_VERSIONS.knowledgeGraph,
  entities: [
    {
      id: "Agent Runtime",
      type: "Capability",
      owns: ["packages/agent/"],
      attributes: { language: "ts", stability: "stable", confidence: 0.9 },
      evidence: [{ id: "ev-001", kind: "code", path: "packages/agent/index.ts", score: 0.9 }],
    },
    {
      id: "LLM Integration",
      type: "Capability",
      owns: ["packages/ai/"],
      attributes: { language: "ts", stability: "stable", confidence: 0.85 },
      evidence: [{ id: "ev-002", kind: "code", path: "packages/ai/index.ts", score: 0.85 }],
    },
  ],
  relationships: [
    {
      id: "rel-001",
      from: "Agent Runtime",
      to: "LLM Integration",
      type: "depends_on",
      evidence: [{ id: "ev-003", kind: "graph", path: "packages/agent→packages/ai", score: 0.8 }],
    },
  ],
  metadata: {
    evolution: [
      {
        trend: "Registry → Runtime",
        direction: "forward",
        evidence: { id: "ev-004", kind: "commit", commit: "abc1234" },
      },
    ],
  },
};

const MOCK_FINDINGS = {
  version: SCHEMA_VERSIONS.findings,
  findings: [
    {
      id: "F-001",
      type: "constraint",
      title: "Must support multiple LLM providers",
      evidence: [{ id: "ev-101", kind: "code", path: "packages/ai/factory.ts", score: 0.9 }],
      confidence: 0.85,
      entity_refs: ["LLM Integration"],
      drives: ["Provider Factory pattern"],
    },
    {
      id: "F-002",
      type: "decision",
      title: "Provider Factory pattern",
      intent: "Enable future providers",
      time_horizon: "long-term",
      tradeoff: "More boilerplate per provider",
      alternatives: ["Switch statement"],
      evidence: [{ id: "ev-102", kind: "code", path: "packages/ai/factory.ts:L20", score: 0.9 }],
      confidence: 0.8,
      entity_refs: ["LLM Integration"],
    },
    {
      id: "F-003",
      type: "mental_model",
      title: "Maintainer mental model",
      concepts: [
        {
          concept: "Conversation",
          owns: ["Messages"],
          responsibility: "Manages dialogue state",
          boundary: "Separated from tools",
        },
      ],
      attributes: { engineering_taste: "Minimalistic" },
      evidence: [{ id: "ev-103", kind: "code", path: "packages/agent/conversation.ts", score: 0.8 }],
      confidence: 0.75,
      entity_refs: ["Agent Runtime"],
    },
  ],
};

const MOCK_REPORT = `# Research Report

## 1. Repository Mental Model
The maintainer divides the system into Conversation and Provider concepts.

## 2. Design Philosophy
Minimalistic — avoids DI frameworks.

## Quality Gate
1. What would invalidate: removing the factory pattern.
`;

// ---------------------------------------------------------------------------
// Minimal evidence brief for stage tests
// ---------------------------------------------------------------------------

const MOCK_BRIEF = {
  _meta: { pipeline: "hybrid" },
  repository: {
    name: "test-repo",
    directoryStructure: ["src/", "tests/", "packages/"],
    manifest: { name: "test-repo" },
  },
  architecture: {
    moduleCount: 5,
    edgeCount: 3,
    topModules: [{ id: "packages/agent", path: "packages/agent", type: "package" }],
    topEdges: [],
  },
  symbols: { functionCount: 50, classCount: 10 },
  tests: { total: 20 },
  git: {
    commitCount: 100,
    recentCommits: [{ message: "feat: add X" }],
  },
  ci: { platforms: ["github"] },
  documents: [],
};

// ===========================================================================
// discoverDocuments
// ===========================================================================

describe("discoverDocuments", () => {
  test("returns empty array for empty directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "test-repo-"));
    try {
      const docs = discoverDocuments(tmp);
      assert.ok(Array.isArray(docs));
      assert.equal(docs.length, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("discovers README.md", () => {
    const tmp = mkdtempSync(join(tmpdir(), "test-repo-"));
    try {
      writeFileSync(join(tmp, "README.md"), "# Test Repo\nThis is a test.");
      const docs = discoverDocuments(tmp);
      assert.ok(docs.length >= 1);
      const readme = docs.find((d) => d.path === "README.md");
      assert.ok(readme, "README.md should be discovered");
      assert.equal(readme.priority, 5);
      assert.ok(readme.content.includes("# Test Repo"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("discovers ADR directory with priority 1", () => {
    const tmp = mkdtempSync(join(tmpdir(), "test-repo-"));
    try {
      mkdirSync(join(tmp, "adr"));
      writeFileSync(join(tmp, "adr", "001-use-factory.md"), "# ADR 001: Use Factory");
      const docs = discoverDocuments(tmp);
      const adr = docs.find((d) => d.path.startsWith("adr/"));
      assert.ok(adr, "ADR should be discovered");
      assert.equal(adr.priority, 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("respects priority ordering (ADR before README)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "test-repo-"));
    try {
      mkdirSync(join(tmp, "adr"));
      writeFileSync(join(tmp, "adr", "001.md"), "# ADR");
      writeFileSync(join(tmp, "README.md"), "# README");
      const docs = discoverDocuments(tmp);
      const adrIdx = docs.findIndex((d) => d.path.startsWith("adr/"));
      const readmeIdx = docs.findIndex((d) => d.path === "README.md");
      assert.ok(adrIdx < readmeIdx, "ADR should come before README");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("truncates content to MAX chars", () => {
    const tmp = mkdtempSync(join(tmpdir(), "test-repo-"));
    try {
      const longContent = "x".repeat(5000);
      writeFileSync(join(tmp, "README.md"), longContent);
      const docs = discoverDocuments(tmp);
      const readme = docs[0];
      assert.ok(readme.content.length <= 2000, `Content should be truncated, got ${readme.content.length}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// runModelingStage
// ===========================================================================

describe("runModelingStage", () => {
  test("returns valid KG from mock LLM", async () => {
    const tmpFile = setupMockLLM(JSON.stringify(MOCK_KG));
    try {
      const kg = await runModelingStage(MOCK_BRIEF, [], {});
      assert.ok(kg, "Should return KG");
      assert.equal(kg.version, SCHEMA_VERSIONS.knowledgeGraph);
      assert.ok(kg.entities.length >= 2);

      const r = validateKG(kg);
      assert.ok(r.ok, `KG should be valid: ${r.errors.join("; ")}`);
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });

  test("throws on invalid JSON from LLM", async () => {
    const tmpFile = setupMockLLM("not valid json");
    try {
      await assert.rejects(
        () => runModelingStage(MOCK_BRIEF, [], {}),
        /JSON/
      );
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });

  test("throws on invalid KG schema", async () => {
    const badKG = { version: "0.1", entities: "not-array" };
    const tmpFile = setupMockLLM(JSON.stringify(badKG));
    try {
      await assert.rejects(
        () => runModelingStage(MOCK_BRIEF, [], {}),
        /validation failed/
      );
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });

  test("throws on KG with leverage (forbidden)", async () => {
    const badKG = { ...MOCK_KG, leverage: [{ entity: "X", blast_radius: 10 }] };
    const tmpFile = setupMockLLM(JSON.stringify(badKG));
    try {
      await assert.rejects(
        () => runModelingStage(MOCK_BRIEF, [], {}),
        /leverage/
      );
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });
});

// ===========================================================================
// runInterpretationStage
// ===========================================================================

describe("runInterpretationStage", () => {
  test("returns valid Findings from mock LLM", async () => {
    const tmpFile = setupMockLLM(JSON.stringify(MOCK_FINDINGS));
    try {
      const findings = await runInterpretationStage(MOCK_KG, [], MOCK_BRIEF, {});
      assert.ok(findings, "Should return Findings");
      assert.equal(findings.version, SCHEMA_VERSIONS.findings);
      assert.ok(findings.findings.length >= 1);

      const r = validateFindings(findings);
      assert.ok(r.ok, `Findings should be valid: ${r.errors.join("; ")}`);
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });

  test("throws on invalid Findings schema", async () => {
    const badFindings = { version: "0.1", findings: "not-array" };
    const tmpFile = setupMockLLM(JSON.stringify(badFindings));
    try {
      await assert.rejects(
        () => runInterpretationStage(MOCK_KG, [], MOCK_BRIEF, {}),
        /validation failed/
      );
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });

  test("throws on Finding without entity_refs", async () => {
    const badFindings = {
      version: SCHEMA_VERSIONS.findings,
      findings: [{
        id: "F-001",
        type: "constraint",
        title: "X",
        evidence: [{ id: "ev-1", kind: "code", path: "x.ts" }],
        confidence: 0.5,
        // missing entity_refs and relationship_refs
      }],
    };
    const tmpFile = setupMockLLM(JSON.stringify(badFindings));
    try {
      await assert.rejects(
        () => runInterpretationStage(MOCK_KG, [], MOCK_BRIEF, {}),
        /entity_refs or relationship_refs/
      );
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });
});

// ===========================================================================
// runNarrativeStage
// ===========================================================================

describe("runNarrativeStage", () => {
  test("returns markdown report from mock LLM", async () => {
    const tmpFile = setupMockLLM(MOCK_REPORT);
    try {
      const fingerprint = buildFingerprint(MOCK_KG, MOCK_FINDINGS, MOCK_BRIEF);
      const report = await runNarrativeStage(MOCK_KG, MOCK_FINDINGS, fingerprint, MOCK_BRIEF, {});
      assert.equal(typeof report, "string");
      assert.ok(report.length > 100);
      assert.match(report, /Repository Mental Model/);
    } finally {
      cleanupMockLLM(tmpFile);
    }
  });
});

// ===========================================================================
// runPipelineV2 end-to-end (mocked)
// ===========================================================================

describe("runPipelineV2", () => {
  // For end-to-end test, we need a real repo to run mechanical analyzers on.
  // We'll create a synthetic mini-repo.
  let tmpRepo;
  let tmpLLMFile;

  before(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), "test-pipeline-"));
    // Minimal repo structure
    mkdirSync(join(tmpRepo, "src"), { recursive: true });
    writeFileSync(join(tmpRepo, "package.json"), JSON.stringify({
      name: "test-pipeline-repo",
      version: "1.0.0",
      main: "src/index.js",
    }));
    writeFileSync(join(tmpRepo, "src", "index.js"), "module.exports = { run: () => {} };");
    writeFileSync(join(tmpRepo, "README.md"), "# Test Pipeline Repo");

    // Mock LLM to return valid KG, then Findings, then Report
    // Note: runPipelineV2 makes 3 LLM calls. The mock will return the same
    // content for all 3 calls. We need to make the mock return content that
    // passes all 3 stages. This is tricky — for a real test we'd need
    // different responses per call. For now, we test that the pipeline
    // at least starts and the first LLM call is made.
    tmpLLMFile = setupMockLLM(JSON.stringify(MOCK_KG));
  });

  after(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
    cleanupMockLLM(tmpLLMFile);
  });

  test("stage=modeling returns KG", async () => {
    const result = await runPipelineV2(tmpRepo, { stage: "modeling" });
    assert.ok(result, "Should return KG");
    assert.equal(result.version, SCHEMA_VERSIONS.knowledgeGraph);
  });
});
