// ===========================================================================
// fingerprint.test.mjs — Tests for buildFingerprint rule-based generation
//
// Verifies that buildFingerprint() produces correct Fingerprint fields
// from KG + Findings + EvidenceBrief using deterministic rules (no LLM).
// ===========================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildFingerprint } from "../hybrid-pipeline.mjs";
import { validateFingerprint, SCHEMA_VERSIONS } from "../schemas.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKG(entityCount = 5, relCount = 3) {
  const entities = Array.from({ length: entityCount }, (_, i) => ({
    id: `Capability ${i}`,
    type: "Capability",
    owns: [`packages/mod${i}/`],
    attributes: { language: "ts", confidence: 0.8 },
    evidence: [{ id: `ev-${i}`, kind: "code", path: `packages/mod${i}/index.ts` }],
  }));
  const relationships = Array.from({ length: relCount }, (_, i) => ({
    id: `rel-${i}`,
    from: `Capability ${i % entityCount}`,
    to: `Capability ${(i + 1) % entityCount}`,
    type: "depends_on",
    evidence: [{ id: `ev-r${i}`, kind: "graph" }],
  }));
  return { version: SCHEMA_VERSIONS.knowledgeGraph, entities, relationships };
}

function makeFindings(types = ["constraint", "decision"]) {
  const findings = types.map((type, i) => {
    const f = {
      id: `F-${String(i + 1).padStart(3, "0")}`,
      type,
      title: `Test ${type}`,
      evidence: [{ id: `ev-f${i}`, kind: "code", path: "src/foo.ts" }],
      confidence: 0.7,
      entity_refs: ["Capability 0"],
    };
    if (type === "decision") f.intent = "Future X";
    if (type === "mental_model") {
      f.concepts = [{
        concept: "X", owns: ["Y"],
        responsibility: "does X", boundary: "separated",
      }];
      f.attributes = { engineering_taste: "Minimalistic" };
    }
    return f;
  });
  return { version: SCHEMA_VERSIONS.findings, findings };
}

function makeBrief(overrides = {}) {
  return {
    repository: {
      name: "test-repo",
      directoryStructure: ["src/", "tests/", "packages/"],
      manifest: { name: "test-repo" },
    },
    symbols: { functionCount: 50, classCount: 10 },
    tests: { total: 20 },
    git: {
      commitCount: 100,
      recentCommits: [
        { message: "feat: add new feature" },
        { message: "fix: bug fix" },
        { message: "feat: another feature" },
      ],
    },
    ci: { platforms: ["github"] },
    documents: [],
    ...overrides,
  };
}

// ===========================================================================
// buildFingerprint rule-based generation
// ===========================================================================

describe("buildFingerprint", () => {
  test("returns valid Fingerprint schema", () => {
    const fp = buildFingerprint(makeKG(5, 3), makeFindings(), makeBrief());
    const r = validateFingerprint(fp);
    assert.ok(r.ok, `Fingerprint should be valid: ${r.errors.join("; ")}`);
  });

  test("includes version field", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief());
    assert.equal(fp.version, SCHEMA_VERSIONS.fingerprint);
  });

  test("complexity = Low when entity+rel < 20", () => {
    const fp = buildFingerprint(makeKG(5, 3), makeFindings(), makeBrief());
    assert.equal(fp.complexity, "Low");
  });

  test("complexity = Medium when 20 <= entity+rel <= 50", () => {
    const fp = buildFingerprint(makeKG(15, 10), makeFindings(), makeBrief());
    assert.equal(fp.complexity, "Medium");
  });

  test("complexity = High when entity+rel > 50", () => {
    const fp = buildFingerprint(makeKG(30, 25), makeFindings(), makeBrief());
    assert.equal(fp.complexity, "High");
  });

  test("maturity = Production when hasADR + hasCI + tests > 50", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      documents: [{ path: "adr/001.md", priority: 1, content: "..." }],
      tests: { total: 60 },
      ci: { platforms: ["github"] },
    }));
    assert.equal(fp.maturity, "Production");
  });

  test("maturity = Early when hasCI + tests > 10", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      tests: { total: 15 },
      ci: { platforms: ["github"] },
    }));
    assert.equal(fp.maturity, "Early");
  });

  test("maturity = Experimental when no CI and few tests", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      tests: { total: 5 },
      ci: { platforms: [] },
    }));
    assert.equal(fp.maturity, "Experimental");
  });

  test("architecture = Capability-oriented when entity > 8", () => {
    const fp = buildFingerprint(makeKG(10, 5), makeFindings(), makeBrief());
    assert.equal(fp.architecture, "Capability-oriented");
  });

  test("architecture = Layered when 3 < entity <= 8", () => {
    const fp = buildFingerprint(makeKG(5, 2), makeFindings(), makeBrief());
    assert.equal(fp.architecture, "Layered");
  });

  test("architecture = Monolith when entity <= 3", () => {
    const fp = buildFingerprint(makeKG(2, 1), makeFindings(), makeBrief());
    assert.equal(fp.architecture, "Monolith");
  });

  test("architecture = Plugin when plugin dir exists and entity <= 8", () => {
    const fp = buildFingerprint(makeKG(5, 2), makeFindings(), makeBrief({
      repository: {
        name: "test",
        directoryStructure: ["src/", "plugins/", "tests/"],
        manifest: {},
      },
    }));
    assert.equal(fp.architecture, "Plugin");
  });

  test("style = Functional when functions >> classes", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      symbols: { functionCount: 100, classCount: 10 },
    }));
    assert.equal(fp.style, "Functional");
  });

  test("style = OOP when classes >> functions", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      symbols: { functionCount: 10, classCount: 100 },
    }));
    assert.equal(fp.style, "OOP");
  });

  test("style = Mixed when balanced", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      symbols: { functionCount: 50, classCount: 40 },
    }));
    assert.equal(fp.style, "Mixed");
  });

  test("evolution = Early when no commits", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      git: { commitCount: 0, recentCommits: [] },
    }));
    assert.equal(fp.evolution, "Early");
  });

  test("evolution = Active Migration when >20% breaking commits", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      git: {
        commitCount: 100,
        recentCommits: [
          { message: "breaking: major rewrite" },
          { message: "refactor: huge change" },
          { message: "feat: small" },
        ],
      },
    }));
    assert.equal(fp.evolution, "Active Migration");
  });

  test("evolution = Active Development when >50% feat commits", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      git: {
        commitCount: 100,
        recentCommits: [
          { message: "feat: add X" },
          { message: "feat: add Y" },
          { message: "feat: add Z" },
          { message: "fix: bug" },
        ],
      },
    }));
    assert.equal(fp.evolution, "Active Development");
  });

  test("evolution = Stable when mostly fixes", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      git: {
        commitCount: 100,
        recentCommits: [
          { message: "fix: bug 1" },
          { message: "fix: bug 2" },
          { message: "chore: cleanup" },
        ],
      },
    }));
    assert.equal(fp.evolution, "Stable");
  });

  test("domain = Coding Agent when repo name matches", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      repository: { name: "my-agent", directoryStructure: [], manifest: { name: "my-agent" } },
    }));
    assert.equal(fp.domain, "Coding Agent");
  });

  test("domain = Database when matches", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), makeBrief({
      repository: { name: "my-database", directoryStructure: [], manifest: { name: "my-database" } },
    }));
    assert.equal(fp.domain, "Database");
  });

  test("engineering_taste from mental_model Finding", () => {
    const fp = buildFingerprint(
      makeKG(),
      makeFindings(["mental_model"]),
      makeBrief()
    );
    assert.equal(fp.engineering_taste, "Minimalistic");
  });

  test("engineering_taste = Minimalistic when >=3 omissions", () => {
    const fp = buildFingerprint(
      makeKG(),
      makeFindings(["omission", "omission", "omission"]),
      makeBrief()
    );
    assert.equal(fp.engineering_taste, "Minimalistic");
  });

  test("engineering_taste fallback = Pragmatic", () => {
    const fp = buildFingerprint(
      makeKG(2, 1),
      makeFindings(["constraint"]),
      makeBrief({ symbols: { functionCount: 5, classCount: 3 } })
    );
    assert.equal(fp.engineering_taste, "Pragmatic");
  });

  test("does not crash with empty KG", () => {
    const fp = buildFingerprint({}, { findings: [] }, makeBrief());
    assert.ok(typeof fp === "object");
    assert.equal(fp.version, SCHEMA_VERSIONS.fingerprint);
  });

  test("does not crash with null findings", () => {
    const fp = buildFingerprint(makeKG(), null, makeBrief());
    assert.ok(typeof fp === "object");
  });

  test("does not crash with empty evidenceBrief", () => {
    const fp = buildFingerprint(makeKG(), makeFindings(), {});
    assert.ok(typeof fp === "object");
  });
});
