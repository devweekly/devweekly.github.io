import test from "node:test";
import assert from "node:assert/strict";
import { buildEntityRegistry } from "../src/entity-registry.js";
import type { ChunkAnnotation } from "../src/analysis.js";

function annotation(
  chunkId: string,
  name: string,
  aliases: string[],
  refersTo?: string
): ChunkAnnotation {
  return {
    chunkId, source: "novel.txt", chapter: chunkId, extractedAt: "2026-11-05T00:00:00.000Z",
    entities: [{
      name, type: "character", aliases, evidence: name,
      confidence: "explicit",
      sourceSpan: { chunkId, source: "novel.txt", chapter: chunkId, start: 0, end: name.length }
    }],
    events: [], relations: [],
    coreferences: refersTo ? [{
      mention: "他", refersTo, evidence: "他回头",
      confidence: "explicit",
      sourceSpan: { chunkId, source: "novel.txt", chapter: chunkId, start: 0, end: 3 }
    }] : []
  };
}

test("merges cross-chapter entities only through an unambiguous explicit alias", () => {
  const registry = buildEntityRegistry("world", [
    annotation("chapter-1", "李阎", ["阎哥"]),
    annotation("chapter-2", "阎哥", ["李阎"], "李阎")
  ]);
  assert.equal(registry.entities.length, 1);
  assert.ok(registry.entities[0]?.aliases.includes("阎哥"));
  assert.equal(registry.resolvedCoreferences, 1);
  assert.equal(registry.unresolvedCoreferences.length, 0);
});

test("does not merge entities through a shared ambiguous alias", () => {
  const registry = buildEntityRegistry("world", [
    annotation("chapter-1", "李阎", ["老大"]),
    annotation("chapter-2", "赵剑中", ["老大"])
  ]);
  assert.equal(registry.entities.length, 2);
  assert.ok(registry.ambiguousAliases.some(item => item.alias === "老大"));
});

test("keeps unresolved cross-chapter references visible instead of guessing", () => {
  const registry = buildEntityRegistry("world", [
    annotation("chapter-2", "阎哥", [], "未出现的人物")
  ]);
  assert.equal(registry.resolvedCoreferences, 0);
  assert.equal(registry.unresolvedCoreferences.length, 1);
});
