// Tests for context.mjs RepositoryContext
// Run: node --test .trae/skills/research-repo/__tests__/context.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepositoryContext } from "../context.mjs";
import { loadOptionalPackages } from "../utils.mjs";

const TEST_DIR = join(tmpdir(), "research-repo-context-test-" + Date.now());

describe("RepositoryContext", () => {
  before(async () => {
    await loadOptionalPackages();
    mkdirSync(join(TEST_DIR, "src"), { recursive: true });
    mkdirSync(join(TEST_DIR, "tests"), { recursive: true });
    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify({ name: "test-repo", main: "src/index.js" }));
    writeFileSync(join(TEST_DIR, "src", "index.js"), "export function hello() { return 1; }");
    writeFileSync(join(TEST_DIR, "src", "utils.js"), "export const x = 1;");
    writeFileSync(join(TEST_DIR, "tests", "index.test.js"), "test('hello', () => {});");
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("discovers files and dirs", () => {
    const ctx = new RepositoryContext(TEST_DIR);
    assert.ok(ctx.files.length >= 3);
    assert.ok(ctx.dirs.length >= 2);
  });

  it("filters source files by extension", () => {
    const ctx = new RepositoryContext(TEST_DIR);
    const srcFiles = ctx.sourceFiles;
    assert.strictEqual(srcFiles.length, 3);
    assert.ok(srcFiles.every((f) => f.ext === ".js"));
  });

  it("excludes test files from non-test source sets", () => {
    const ctx = new RepositoryContext(TEST_DIR);
    assert.strictEqual(ctx.sourceFiles.length, 3);
    assert.strictEqual(ctx.testFiles.length, 1);
    assert.ok(ctx.testFiles[0].path.includes("tests"));
  });

  it("reads manifest", () => {
    const ctx = new RepositoryContext(TEST_DIR);
    const manifest = ctx.manifest;
    assert.strictEqual(manifest.name, "test-repo");
    assert.strictEqual(manifest.entry, "src/index.js");
  });

  it("caches file content", () => {
    const ctx = new RepositoryContext(TEST_DIR);
    const content1 = ctx.readFile("src/index.js");
    const content2 = ctx.readFile("src/index.js");
    assert.ok(content1.includes("hello"));
    assert.strictEqual(content1, content2);
  });

  it("respects changedFiles filter", () => {
    const changedFiles = new Set(["src/index.js"]);
    const ctx = new RepositoryContext(TEST_DIR, { changedFiles });
    assert.strictEqual(ctx.files.length, 1);
    assert.ok(ctx.files[0].path.endsWith("src/index.js"));
  });
});
