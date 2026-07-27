// Tests for utils.mjs helper functions
// Run: node --test .trae/skills/research-repo/__tests__/utils.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { isTestPath, pathToModuleId, countByExtension } from "../utils.mjs";

describe("isTestPath", () => {
  it("detects common test file patterns", () => {
    assert.strictEqual(isTestPath("src/foo.test.ts"), true);
    assert.strictEqual(isTestPath("tests/foo.spec.js"), true);
    assert.strictEqual(isTestPath("__tests__/bar.js"), true);
    assert.strictEqual(isTestPath("test/unit/baz.py"), true);
    assert.strictEqual(isTestPath("src/main.ts"), false);
    assert.strictEqual(isTestPath("lib/index.js"), false);
  });

  it("does not flag files with 'test' as substring", () => {
    assert.strictEqual(isTestPath("src/testimonial.js"), false);
    assert.strictEqual(isTestPath("src/contest.ts"), false);
  });
});

describe("pathToModuleId", () => {
  it("normalizes paths to module ids", () => {
    assert.strictEqual(pathToModuleId("src/agent/runner.ts"), "src.agent.runner");
    assert.strictEqual(pathToModuleId("lib/utils.js"), "lib.utils");
  });

  it("strips extensions", () => {
    assert.strictEqual(pathToModuleId("src/utils/index.ts"), "src.utils.index");
    assert.strictEqual(pathToModuleId("components/Button/index.tsx"), "components.Button.index");
  });

  it("handles Windows separators", () => {
    assert.strictEqual(pathToModuleId("src\\agent\\runner.ts"), "src\\agent\\runner");
  });
});

describe("countByExtension", () => {
  it("counts extensions from file objects", () => {
    const files = [
      { path: "src/a.ts", ext: ".ts" },
      { path: "src/b.ts", ext: ".ts" },
      { path: "src/c.js", ext: ".js" },
      { name: "d.py", ext: ".py" },
    ];
    const counts = countByExtension(files);
    assert.strictEqual(counts[".ts"], 2);
    assert.strictEqual(counts[".js"], 1);
    assert.strictEqual(counts[".py"], 1);
  });

  it("returns empty object for empty input", () => {
    assert.deepStrictEqual(countByExtension([]), {});
  });
});
