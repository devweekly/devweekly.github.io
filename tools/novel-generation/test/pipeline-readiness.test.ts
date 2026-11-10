import test from "node:test";
import assert from "node:assert/strict";
import { isWritingKnowledgeReady, missingWritingKnowledgeSteps } from "../src/pipeline-readiness.js";

test("writing readiness requires every mandatory knowledge step", () => {
  const ready = [
    { name: "style-profile", status: "completed" },
    { name: "character-profiles", status: "completed" },
    { name: "character-states", status: "skipped" },
    { name: "as-of-dossier", status: "completed" }
  ];
  assert.equal(isWritingKnowledgeReady(ready), true);
  assert.deepEqual(missingWritingKnowledgeSteps(ready.slice(0, 3)), ["as-of-dossier"]);
  assert.equal(isWritingKnowledgeReady([...ready, { name: "corpus-craft", status: "failed" }]), true);
  assert.equal(isWritingKnowledgeReady(ready.map(step => step.name === "character-states" ? { ...step, status: "failed" } : step)), false);
});
