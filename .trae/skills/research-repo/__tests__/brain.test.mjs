// Tests for brain.mjs
// Run: node --test .trae/skills/research-repo/__tests__/brain.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Brain, validateKnowledgeUnit, createKnowledgeUnit } from "../brain.mjs";

const TEST_DIR = mkdtempSync(join(tmpdir(), "research-repo-brain-test-"));

describe("validateKnowledgeUnit", () => {
  it("accepts valid unit", () => {
    const result = validateKnowledgeUnit({
      id: "pattern.planner-executor",
      type: "pattern",
      title: "Planner Executor Separation",
      description: "Separate planning and execution.",
      evidence: ["repo-a"],
      confidence: 0.6,
    });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects missing fields", () => {
    const result = validateKnowledgeUnit({ id: "x" });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Missing required field")));
  });

  it("rejects invalid confidence", () => {
    const result = validateKnowledgeUnit({
      id: "x", type: "pattern", title: "X", description: "Y", evidence: [], confidence: 1.5,
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("confidence")));
  });
});

describe("createKnowledgeUnit", () => {
  it("generates id from title", () => {
    const unit = createKnowledgeUnit({ title: "Planner Executor Separation", type: "pattern" });
    assert.strictEqual(unit.id, "pattern.planner-executor-separation");
  });

  it("preserves explicit id", () => {
    const unit = createKnowledgeUnit({ id: "custom.id", title: "X", type: "pattern" });
    assert.strictEqual(unit.id, "custom.id");
  });
});

describe("Brain", () => {
  before(() => {
    const brain = new Brain(TEST_DIR);
    brain.init();
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("initializes directory structure", () => {
    const brain = new Brain(TEST_DIR);
    const root = brain.init();
    assert.ok(root.includes("research-repo-brain-test"));
  });

  it("saves and retrieves a unit", () => {
    const brain = new Brain(TEST_DIR);
    brain.init();
    const unit = {
      id: "pattern.test-save",
      type: "pattern",
      title: "Test Pattern",
      description: "For testing",
      evidence: ["repo-a"],
      confidence: 0.5,
    };
    brain.save(unit);
    const retrieved = brain.get("pattern", "pattern.test-save");
    assert.strictEqual(retrieved.title, "Test Pattern");
  });

  it("merges existing unit and increments confidence", () => {
    const brain = new Brain(TEST_DIR);
    brain.init();
    const unit = {
      id: "pattern.merge-test",
      type: "pattern",
      title: "Merge Test",
      description: "Initial",
      evidence: ["repo-a"],
      confidence: 0.5,
    };
    brain.save(unit);
    const result = brain.addOrUpdate({ ...unit, evidence: ["repo-b"] }, "repo-b");
    assert.strictEqual(result.action, "merged");
    assert.ok(result.unit.confidence > 0.5);
    assert.ok(result.unit.evidence.includes("repo-b"));
  });

  it("queries units by type", () => {
    const brain = new Brain(TEST_DIR);
    brain.init();
    brain.save({
      id: "decision.query-test",
      type: "decision",
      title: "Query Test",
      description: "For query",
      evidence: ["repo-a"],
      confidence: 0.6,
    });
    const results = brain.query("decision");
    assert.ok(results.some((u) => u.id === "decision.query-test"));
  });
});
