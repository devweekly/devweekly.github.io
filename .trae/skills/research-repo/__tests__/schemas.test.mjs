// ===========================================================================
// schemas.test.mjs — Tests for Pipeline v2 schema validators
//
// Tests validateKG / validateFindings / validateFingerprint / validateEvidenceRef
// using crafted inputs (no LLM, no analyzer pipeline).
// ===========================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  validateKG,
  validateFindings,
  validateFingerprint,
  validateEvidenceRef,
  SCHEMA_VERSIONS,
  EVIDENCE_KINDS,
  FINDING_TYPES,
  RELATIONSHIP_TYPES,
} from "../schemas.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEvidenceRef(overrides = {}) {
  return {
    id: "ev-001",
    kind: "code",
    path: "src/foo.ts",
    symbol: "doFoo",
    excerpt: "function doFoo() { ... }",
    score: 0.9,
    ...overrides,
  };
}

function validEntity(overrides = {}) {
  return {
    id: "LLM Integration",
    type: "Capability",
    owns: ["packages/ai/"],
    attributes: { language: "ts", stability: "stable", confidence: 0.85 },
    evidence: [validEvidenceRef()],
    ...overrides,
  };
}

function validRelationship(overrides = {}) {
  return {
    id: "rel-001",
    from: "LLM Integration",
    to: "Agent Runtime",
    type: "depends_on",
    evidence: [validEvidenceRef({ id: "ev-002", kind: "graph" })],
    ...overrides,
  };
}

function validKG(overrides = {}) {
  return {
    version: SCHEMA_VERSIONS.knowledgeGraph,
    entities: [validEntity(), validEntity({ id: "Agent Runtime", owns: ["packages/agent/"] })],
    relationships: [
      validRelationship({ from: "Agent Runtime", to: "LLM Integration" }),
    ],
    metadata: {
      evolution: [
        {
          trend: "Registry → Runtime",
          direction: "forward",
          evidence: validEvidenceRef({ id: "ev-003", kind: "commit", commit: "abc1234" }),
        },
      ],
    },
    ...overrides,
  };
}

function validFinding(overrides = {}) {
  return {
    id: "F-001",
    type: "constraint",
    title: "Must support many providers",
    evidence: [validEvidenceRef()],
    confidence: 0.85,
    entity_refs: ["LLM Integration"],
    ...overrides,
  };
}

function validFindings(overrides = {}) {
  return {
    version: SCHEMA_VERSIONS.findings,
    findings: [validFinding()],
    ...overrides,
  };
}

function validFingerprint(overrides = {}) {
  return {
    version: SCHEMA_VERSIONS.fingerprint,
    style: "Functional",
    architecture: "Capability-oriented",
    evolution: "Stable",
    domain: "Coding Agent",
    maturity: "Production",
    complexity: "Medium",
    engineering_taste: "Minimalistic",
    ...overrides,
  };
}

// ===========================================================================
// EvidenceRef validation
// ===========================================================================

describe("validateEvidenceRef", () => {
  test("accepts valid EvidenceRef", () => {
    const r = validateEvidenceRef(validEvidenceRef());
    assert.ok(r.ok, `Should pass: ${r.errors.join("; ")}`);
  });

  test("rejects non-object", () => {
    assert.equal(validateEvidenceRef(null).ok, false);
    assert.equal(validateEvidenceRef("string").ok, false);
    assert.equal(validateEvidenceRef(undefined).ok, false);
  });

  test("requires id", () => {
    const r = validateEvidenceRef(validEvidenceRef({ id: "" }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /id/);
  });

  test("requires valid kind", () => {
    const r = validateEvidenceRef(validEvidenceRef({ kind: "invalid" }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /kind/);
  });

  test("accepts all valid kinds", () => {
    for (const kind of EVIDENCE_KINDS) {
      const r = validateEvidenceRef(validEvidenceRef({ kind }));
      assert.ok(r.ok, `Kind "${kind}" should be valid: ${r.errors.join("; ")}`);
    }
  });

  test("requires at least one target (path/symbol/commit/excerpt)", () => {
    const r = validateEvidenceRef({ id: "ev-x", kind: "code" });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /path.*symbol.*commit.*excerpt/);
  });

  test("accepts metric kind without path", () => {
    const r = validateEvidenceRef({ id: "ev-m", kind: "metric", score: 0.8 });
    assert.ok(r.ok, `metric kind should be valid without path: ${r.errors.join("; ")}`);
  });

  test("rejects score outside [0,1]", () => {
    assert.equal(validateEvidenceRef(validEvidenceRef({ score: 1.5 })).ok, false);
    assert.equal(validateEvidenceRef(validEvidenceRef({ score: -0.1 })).ok, false);
  });

  test("accepts score in [0,1]", () => {
    assert.ok(validateEvidenceRef(validEvidenceRef({ score: 0 })).ok);
    assert.ok(validateEvidenceRef(validEvidenceRef({ score: 1 })).ok);
    assert.ok(validateEvidenceRef(validEvidenceRef({ score: 0.5 })).ok);
  });
});

// ===========================================================================
// Knowledge Graph validation
// ===========================================================================

describe("validateKG", () => {
  test("accepts valid KG", () => {
    const r = validateKG(validKG());
    assert.ok(r.ok, `Should pass: ${r.errors.join("; ")}`);
  });

  test("rejects non-object", () => {
    assert.equal(validateKG(null).ok, false);
    assert.equal(validateKG("string").ok, false);
  });

  test("requires version", () => {
    const r = validateKG(validKG({ version: "" }));
    assert.equal(r.ok, false);
  });

  test("requires entities array", () => {
    const r = validateKG(validKG({ entities: "not array" }));
    assert.equal(r.ok, false);
  });

  test("rejects entity count > 20", () => {
    const entities = Array.from({ length: 21 }, (_, i) =>
      validEntity({ id: `Capability ${i}` })
    );
    const r = validateKG(validKG({ entities }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /exceeds limit of 20/);
  });

  test("rejects package-path entity ids", () => {
    const r = validateKG(validKG({
      entities: [validEntity({ id: "packages/ai" })],
    }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /package path/);
  });

  test("rejects /src/ in entity ids", () => {
    const r = validateKG(validKG({
      entities: [validEntity({ id: "src/agent/runtime" })],
    }));
    assert.equal(r.ok, false);
  });

  test("accepts capability-name entity ids", () => {
    const r = validateKG(validKG({
      entities: [
        validEntity({ id: "LLM Integration" }),
        validEntity({ id: "Agent Runtime" }),
        validEntity({ id: "Persistence" }),
      ],
    }));
    assert.ok(r.ok, `Capability names should pass: ${r.errors.join("; ")}`);
  });

  test("rejects entity type != Capability", () => {
    const r = validateKG(validKG({
      entities: [validEntity({ type: "Module" })],
    }));
    assert.equal(r.ok, false);
  });

  test("rejects relationship referencing non-existent entity", () => {
    const r = validateKG(validKG({
      relationships: [
        validRelationship({ from: "NonExistent", to: "LLM Integration" }),
      ],
    }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /does not reference a valid entity id/);
  });

  test("rejects invalid relationship type", () => {
    const r = validateKG(validKG({
      relationships: [
        validRelationship({ type: "invalid_type" }),
      ],
    }));
    assert.equal(r.ok, false);
  });

  test("accepts all valid relationship types", () => {
    for (const type of RELATIONSHIP_TYPES) {
      const r = validateKG(validKG({
        relationships: [validRelationship({ type })],
      }));
      assert.ok(r.ok, `Relationship type "${type}" should be valid: ${r.errors.join("; ")}`);
    }
  });

  test("rejects KG containing leverage field", () => {
    const r = validateKG(validKG({ leverage: [] }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /leverage/);
  });

  test("accepts missing metadata (optional)", () => {
    const r = validateKG(validKG({ metadata: undefined }));
    assert.ok(r.ok, `Missing metadata should be OK: ${r.errors.join("; ")}`);
  });

  test("rejects evolution with invalid direction", () => {
    const r = validateKG(validKG({
      metadata: {
        evolution: [{
          trend: "X → Y",
          direction: "invalid",
          evidence: validEvidenceRef(),
        }],
      },
    }));
    assert.equal(r.ok, false);
  });
});

// ===========================================================================
// Semantic Findings validation
// ===========================================================================

describe("validateFindings", () => {
  test("accepts valid Findings", () => {
    const r = validateFindings(validFindings());
    assert.ok(r.ok, `Should pass: ${r.errors.join("; ")}`);
  });

  test("rejects non-object", () => {
    assert.equal(validateFindings(null).ok, false);
  });

  test("requires version", () => {
    const r = validateFindings(validFindings({ version: "" }));
    assert.equal(r.ok, false);
  });

  test("requires findings array", () => {
    const r = validateFindings(validFindings({ findings: "not array" }));
    assert.equal(r.ok, false);
  });

  test("rejects Finding without evidence", () => {
    const r = validateFindings(validFindings({
      findings: [validFinding({ evidence: [] })],
    }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /evidence/);
  });

  test("rejects Finding without entity_refs or relationship_refs", () => {
    const r = validateFindings(validFindings({
      findings: [validFinding({ entity_refs: undefined, relationship_refs: undefined })],
    }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /entity_refs or relationship_refs/);
  });

  test("accepts Finding with relationship_refs only", () => {
    const r = validateFindings(validFindings({
      findings: [validFinding({
        entity_refs: undefined,
        relationship_refs: ["rel-001"],
      })],
    }));
    assert.ok(r.ok, `relationship_refs should suffice: ${r.errors.join("; ")}`);
  });

  test("rejects confidence outside [0,1]", () => {
    assert.equal(validateFindings(validFindings({
      findings: [validFinding({ confidence: 1.5 })],
    })).ok, false);
    assert.equal(validateFindings(validFindings({
      findings: [validFinding({ confidence: -0.1 })],
    })).ok, false);
  });

  test("accepts all valid Finding types", () => {
    for (const type of FINDING_TYPES) {
      const overrides = { type };
      if (type === "decision") overrides.intent = "Future X";
      if (type === "mental_model") {
        overrides.concepts = [{
          concept: "X",
          owns: ["Y"],
          responsibility: "does X",
          boundary: "separated from Z",
        }];
      }
      const r = validateFindings(validFindings({
        findings: [validFinding(overrides)],
      }));
      assert.ok(r.ok, `Finding type "${type}" should be valid: ${r.errors.join("; ")}`);
    }
  });

  test("rejects mental_model with layers field", () => {
    const r = validateFindings(validFindings({
      findings: [validFinding({
        type: "mental_model",
        layers: ["Presentation", "Runtime"],
        concepts: [{
          concept: "X",
          owns: ["Y"],
          responsibility: "does X",
          boundary: "separated from Z",
        }],
      })],
    }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /concepts\[\], not layers/);
  });

  test("rejects decision without intent", () => {
    const r = validateFindings(validFindings({
      findings: [validFinding({ type: "decision", intent: undefined })],
    }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /intent/);
  });

  test("rejects invalid Finding type", () => {
    const r = validateFindings(validFindings({
      findings: [validFinding({ type: "invalid_type" })],
    }));
    assert.equal(r.ok, false);
  });

  test("accepts multiple Findings of different types", () => {
    const r = validateFindings(validFindings({
      findings: [
        validFinding({ id: "F-001", type: "constraint" }),
        validFinding({
          id: "F-002", type: "decision", intent: "Future providers",
          time_horizon: "long-term",
        }),
        validFinding({
          id: "F-003", type: "tension",
          left: "Simplicity", right: "Flexibility",
        }),
        validFinding({
          id: "F-004", type: "mental_model",
          concepts: [{
            concept: "X", owns: ["Y"],
            responsibility: "does X", boundary: "separated",
          }],
        }),
      ],
    }));
    assert.ok(r.ok, `Multiple types should pass: ${r.errors.join("; ")}`);
  });
});

// ===========================================================================
// Repository Fingerprint validation
// ===========================================================================

describe("validateFingerprint", () => {
  test("accepts valid Fingerprint", () => {
    const r = validateFingerprint(validFingerprint());
    assert.ok(r.ok, `Should pass: ${r.errors.join("; ")}`);
  });

  test("rejects non-object", () => {
    assert.equal(validateFingerprint(null).ok, false);
  });

  test("requires version", () => {
    const r = validateFingerprint(validFingerprint({ version: "" }));
    assert.equal(r.ok, false);
  });

  test("requires all 7 fields", () => {
    const fields = ["style", "architecture", "evolution", "domain", "maturity", "complexity", "engineering_taste"];
    for (const field of fields) {
      const fp = validFingerprint();
      fp[field] = "";
      const r = validateFingerprint(fp);
      assert.equal(r.ok, false, `Field ${field} should be required`);
    }
  });

  test("rejects 'Unknown' values", () => {
    const r = validateFingerprint(validFingerprint({ domain: "Unknown" }));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /Unknown/);
  });

  test("rejects 'unknown' (case-insensitive)", () => {
    const r = validateFingerprint(validFingerprint({ style: "unknown" }));
    assert.equal(r.ok, false);
  });
});
