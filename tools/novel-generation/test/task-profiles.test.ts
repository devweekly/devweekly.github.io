import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeTaskProfile, readTaskProfiles, thinkingOption, STAGE_KEYS
} from "../src/task-profiles.js";

test("planning, review and prose stages think; extraction stages stay off", () => {
  const profiles = readTaskProfiles(join(tmpdir(), "novel-profiles-missing.json"));
  assert.equal(profiles.plan.thinkingMode, "adaptive");
  assert.equal(profiles.plan.effort, "high");
  assert.equal(profiles.review.effort, "medium");
  assert.equal(profiles.scene.thinkingMode, "adaptive");
  assert.equal(profiles.scene.effort, "medium");
  assert.equal(profiles.state.thinkingMode, "disabled");
  assert.equal(STAGE_KEYS.length, 9);
});

test("invalid profile values fall back to stage defaults", () => {
  const plan = normalizeTaskProfile({ thinkingMode: "auto", effort: "extreme", thinkingBudgetTokens: 5 }, "plan");
  assert.equal(plan.thinkingMode, "adaptive");
  assert.equal(plan.effort, "high");
  assert.equal(plan.thinkingBudgetTokens, 1024);
  const scene = normalizeTaskProfile({ thinkingMode: "enabled", effort: "medium", thinkingBudgetTokens: 999999 }, "scene");
  assert.equal(scene.thinkingMode, "enabled");
  assert.equal(scene.effort, "medium");
  assert.equal(scene.thinkingBudgetTokens, 65536);
});

test("project config overrides stage profiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-profiles-"));
  const config = join(dir, "novel.json");
  writeFileSync(config, JSON.stringify({
    taskProfiles: { scene: { thinkingMode: "adaptive", effort: "high" } }
  }), "utf8");
  try {
    const profiles = readTaskProfiles(config);
    assert.equal(profiles.scene.thinkingMode, "adaptive");
    assert.equal(profiles.scene.effort, "high");
    assert.equal(profiles.plan.thinkingMode, "adaptive");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("thinking options map to the SDK shapes", () => {
  assert.deepEqual(thinkingOption(normalizeTaskProfile({ thinkingMode: "disabled" }, "scene")), { type: "disabled" });
  assert.deepEqual(thinkingOption(normalizeTaskProfile({ thinkingMode: "adaptive" }, "plan")), { type: "adaptive" });
  assert.deepEqual(thinkingOption(normalizeTaskProfile({ thinkingMode: "enabled", thinkingBudgetTokens: 4096 }, "plan")), { type: "enabled", budgetTokens: 4096 });
});
