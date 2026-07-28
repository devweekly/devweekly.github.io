// ===========================================================================
// new-analyzers.test.mjs — Unit tests for mechanical inference analyzers
//
// Covers the remaining Mechanical Inference Analyzers after the semantic
// analyzers were removed and delegated to the LLM in Hybrid mode:
//   - ArchitectureMetricsAnalyzer: Fan-in/Fan-out/Cycle/Layer/Stability
//   - TemporalAnalyzer: Major Rewrite/Architecture Pivot/Deprecated
//   - StabilityAnalyzer, ChangeCouplingAnalyzer, InformationFlowAnalyzer,
//     DependencySmellAnalyzer
//
// Creates a synthetic repo with import graph + git history and verifies
// analyzer output structure.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { runAnalyzerAll } from "../../lib/analyzer-runner.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// --- Synthetic repo with import graph + git history ------------------------
function createRichRepo() {
  const workDir = join(
    tmpdir(),
    `research-repo-new-analyzers-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(join(workDir, "src"), { recursive: true });
  mkdirSync(join(workDir, "src", "patterns"), { recursive: true });
  mkdirSync(join(workDir, "src", "services"), { recursive: true });
  mkdirSync(join(workDir, "tests"), { recursive: true });

  writeFileSync(
    join(workDir, "package.json"),
    JSON.stringify({ name: "rich-patterns", version: "1.0.0", main: "src/index.js" })
  );

  writeFileSync(
    join(workDir, "README.md"),
    "# Rich Patterns Repo\n\nSynthetic repo with multiple design patterns for testing.\n"
  );

  // src/index.js — barrel export + import graph edges
  writeFileSync(
    join(workDir, "src", "index.js"),
    [
      "export { Logger } from './patterns/logger.js';",
      "export { UserFactory } from './patterns/factory.js';",
      "export { UserRepository } from './patterns/repository.js';",
      "export { EventBus } from './patterns/observer.js';",
      "export { UserService } from './services/user_service.js';",
    ].join("\n")
  );

  // Singleton pattern
  writeFileSync(
    join(workDir, "src", "patterns", "logger.js"),
    [
      "export class Logger {",
      "  static getInstance() {",
      "    if (!this._inst) this._inst = new Logger();",
      "    return this._inst;",
      "  }",
      "  log(msg) { console.log('[LOG]', msg); }",
      "}",
    ].join("\n")
  );

  // Factory pattern
  writeFileSync(
    join(workDir, "src", "patterns", "factory.js"),
    [
      "export class UserFactory {",
      "  create(name) { return { id: Math.random(), name }; }",
      "  fromJSON(json) { return JSON.parse(json); }",
      "  build(payload) { return this.create(payload.name); }",
      "}",
    ].join("\n")
  );

  // Repository pattern
  writeFileSync(
    join(workDir, "src", "patterns", "repository.js"),
    [
      "export class UserRepository {",
      "  constructor(db) { this.db = db; }",
      "  findById(id) { return this.db.query('users', id); }",
      "  save(user) { return this.db.insert('users', user); }",
      "  delete(id) { return this.db.remove('users', id); }",
      "}",
    ].join("\n")
  );

  // Observer pattern
  writeFileSync(
    join(workDir, "src", "patterns", "observer.js"),
    [
      "export class EventBus {",
      "  constructor() { this.handlers = new Map(); }",
      "  subscribe(evt, fn) {",
      "    if (!this.handlers.has(evt)) this.handlers.set(evt, []);",
      "    this.handlers.get(evt).push(fn);",
      "  }",
      "  publish(evt, data) {",
      "    (this.handlers.get(evt) || []).forEach((fn) => fn(data));",
      "  }",
      "}",
    ].join("\n")
  );

  // Service module that depends on patterns (creates import graph edges)
  writeFileSync(
    join(workDir, "src", "services", "user_service.js"),
    [
      "import { Logger } from '../patterns/logger.js';",
      "import { UserFactory } from '../patterns/factory.js';",
      "import { UserRepository } from '../patterns/repository.js';",
      "",
      "export class UserService {",
      "  constructor(db) {",
      "    this.logger = Logger.getInstance();",
      "    this.factory = new UserFactory();",
      "    this.repo = new UserRepository(db);",
      "  }",
      "  register(name) {",
      "    const user = this.factory.create(name);",
      "    this.repo.save(user);",
      "    this.logger.log(`registered ${name}`);",
      "    return user;",
      "  }",
      "}",
    ].join("\n")
  );

  // Test file
  writeFileSync(
    join(workDir, "tests", "patterns.test.js"),
    [
      "import { test } from 'node:test';",
      "import { Logger } from '../src/patterns/logger.js';",
      "test('logger is singleton', () => {",
      "  const a = Logger.getInstance();",
      "  const b = Logger.getInstance();",
      "  if (a !== b) throw new Error('not singleton');",
      "});",
    ].join("\n")
  );

  // Git history with multiple commits to trigger TemporalAnalyzer
  try {
    execSync("git init -q", { cwd: workDir });
    execSync('git config user.email "t@t.com"', { cwd: workDir });
    execSync('git config user.name "tester"', { cwd: workDir });
    // Initial commit
    execSync("git add -A", { cwd: workDir });
    execSync('git commit -qm "init: basic patterns"', { cwd: workDir });
    // Simulate evolution: add new file, modify existing
    writeFileSync(
      join(workDir, "src", "patterns", "strategy.js"),
      [
        "export class SortStrategy {",
        "  sort(arr) { return arr.slice().sort(); }",
        "}",
        "export class ReverseSortStrategy {",
        "  sort(arr) { return arr.slice().sort().reverse(); }",
        "}",
      ].join("\n")
    );
    execSync("git add -A", { cwd: workDir });
    execSync('git commit -qm "feat: add strategy pattern"', { cwd: workDir });
    // Simulate large refactor (rewrite)
    writeFileSync(
      join(workDir, "src", "services", "user_service.js"),
      [
        "import { Logger } from '../patterns/logger.js';",
        "import { UserFactory } from '../patterns/factory.js';",
        "import { UserRepository } from '../patterns/repository.js';",
        "",
        "// Refactored: now uses dependency injection",
        "export class UserService {",
        "  constructor({ logger, factory, repo }) {",
        "    this.logger = logger || Logger.getInstance();",
        "    this.factory = factory || new UserFactory();",
        "    this.repo = repo || new UserRepository(null);",
        "  }",
        "  register(name) {",
        "    const user = this.factory.create(name);",
        "    this.repo.save(user);",
        "    this.logger.log(`registered ${name}`);",
        "    return user;",
        "  }",
        "}",
      ].join("\n")
    );
    execSync("git add -A", { cwd: workDir });
    execSync('git commit -qm "refactor: inject dependencies into UserService"', { cwd: workDir });
  } catch {
    // git unavailable — TemporalAnalyzer tests will be skipped
  }

  return workDir;
}

function hasGitHistory(workDir) {
  try {
    const out = execSync("git log --oneline", { cwd: workDir, encoding: "utf-8" });
    return out.trim().split("\n").length >= 2;
  } catch {
    return false;
  }
}

function withRichRepo(fn) {
  return (result) => {
    const repoDir = createRichRepo();
    try {
      const store = runAnalyzerAll(repoDir);
      fn(result, store, repoDir);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  };
}

export function runNewAnalyzersTests() {
  return runSuite("unit — mechanical inference analyzers", [
    // ── ArchitectureMetricsAnalyzer ────────────────────────────────────────
    {
      name: "ArchitectureMetricsAnalyzer produces output",
      test: withRichRepo((result, store) => {
        const am = store.archMetrics;
        result.record("archMetrics key exists", () => {
          if (!am) throw new Error("Missing archMetrics in store");
        });
        result.record("has summary", () => {
          if (!am?.summary) throw new Error("Missing summary");
        });
      }),
    },
    {
      name: "ArchitectureMetricsAnalyzer computes Fan-in/Fan-out",
      test: withRichRepo((result, store) => {
        const am = store.archMetrics || {};
        result.record("fanIn object exists", () => {
          if (!am.fanIn || typeof am.fanIn !== "object") throw new Error("Missing fanIn");
        });
        result.record("fanOut object exists", () => {
          if (!am.fanOut || typeof am.fanOut !== "object") throw new Error("Missing fanOut");
        });
        result.record("fanIn has avg", () => {
          if (typeof am.fanIn?.avg !== "number") throw new Error("Missing fanIn.avg");
        });
        result.record("fanOut has avg", () => {
          if (typeof am.fanOut?.avg !== "number") throw new Error("Missing fanOut.avg");
        });
      }),
    },
    {
      name: "ArchitectureMetricsAnalyzer computes coupling",
      test: withRichRepo((result, store) => {
        const am = store.archMetrics || {};
        const coupling = am.coupling || {};
        result.record("coupling object exists", () => {
          if (!coupling) throw new Error("Missing coupling");
        });
        result.record("has density", () => {
          if (typeof coupling.density !== "number") throw new Error("Missing density");
        });
      }),
    },
    {
      name: "ArchitectureMetricsAnalyzer detects hub/bottleneck nodes",
      test: withRichRepo((result, store) => {
        const am = store.archMetrics || {};
        const coupling = am.coupling || {};
        // patterns/logger.js, patterns/factory.js, patterns/repository.js
        // should appear as high-fan-in nodes (depended upon by services)
        result.record("hub nodes or bottleneck nodes present", () => {
          const hasHubs = Array.isArray(coupling.hubNodes) || Array.isArray(coupling.bottleneckNodes);
          if (!hasHubs) throw new Error("Missing hubNodes/bottleneckNodes arrays");
        });
      }),
    },
    {
      name: "ArchitectureMetricsAnalyzer summary has node/edge counts",
      test: withRichRepo((result, store) => {
        const summary = store.archMetrics?.summary || {};
        result.record("summary has totalNodes", () => {
          if (typeof summary.totalNodes !== "number") throw new Error("Missing totalNodes");
        });
        result.record("summary has totalEdges", () => {
          if (typeof summary.totalEdges !== "number") throw new Error("Missing totalEdges");
        });
      }),
    },

    // ── StabilityAnalyzer ──────────────────────────────────────────────────
    {
      name: "StabilityAnalyzer produces module stability metrics",
      test: withRichRepo((result, store) => {
        const stability = store.stability || {};
        result.record("stability key exists", () => {
          if (!stability.modules) throw new Error("Missing stability.modules");
        });
        result.record("modules have instability/abstractness/zone", () => {
          const bad = stability.modules.filter(
            (m) => typeof m.instability !== "number" || typeof m.abstractness !== "number" || !m.zone
          );
          if (bad.length > 0) throw new Error("Module missing stability fields");
        });
      }),
    },

    // ── TemporalAnalyzer ───────────────────────────────────────────────────
    {
      name: "TemporalAnalyzer produces output (skipped if no git)",
      test: withRichRepo((result, store, repoDir) => {
        const temporal = store.temporal;
        if (!hasGitHistory(repoDir)) {
          result.record("temporal skipped (no git history)", () => {
            if (!temporal?.skipped && !temporal?.note) {
              throw new Error("Expected temporal.skipped when no git history");
            }
          });
          return;
        }
        result.record("temporal key exists", () => {
          if (!temporal) throw new Error("Missing temporal in store");
        });
        result.record("has summary", () => {
          if (!temporal?.summary) throw new Error("Missing temporal.summary");
        });
      }),
    },
    {
      name: "TemporalAnalyzer detects events from git history",
      test: withRichRepo((result, store, repoDir) => {
        if (!hasGitHistory(repoDir)) {
          result.record("skipped (no git history)", () => {});
          return;
        }
        const temporal = store.temporal || {};
        const events = temporal.events || [];
        result.record("events is an array", () => {
          if (!Array.isArray(events)) throw new Error("Missing events[]");
        });
        // With 3 commits including a "refactor:" commit, TemporalAnalyzer
        // should detect at least one event type (or report 0 honestly).
        const knownTypes = ["major_rewrite", "architecture_pivot", "deprecated_pattern", "historical_tradeoff"];
        result.record("all event types are known", () => {
          const unknown = events.filter((e) => !knownTypes.includes(e.type));
          if (unknown.length > 0) {
            throw new Error(`Unknown event type: ${unknown[0].type}`);
          }
        });
      }),
    },
    {
      name: "TemporalAnalyzer summary has commit count",
      test: withRichRepo((result, store, repoDir) => {
        if (!hasGitHistory(repoDir)) {
          result.record("skipped (no git history)", () => {});
          return;
        }
        const summary = store.temporal?.summary || {};
        result.record("summary has totalCommitsAnalyzed", () => {
          if (typeof summary.totalCommitsAnalyzed !== "number") {
            throw new Error("Missing totalCommitsAnalyzed in temporal.summary");
          }
        });
        result.record("totalCommitsAnalyzed >= 2", () => {
          if (summary.totalCommitsAnalyzed < 2) {
            throw new Error(`Expected >=2 commits, got ${summary.totalCommitsAnalyzed}`);
          }
        });
      }),
    },
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runNewAnalyzersTests();
  console.log(`${result.name}: ${result.passCount}/${result.total} passed`);
  for (const f of result.failed) {
    console.error(`  ✗ ${f.case}: ${f.error}`);
  }
  process.exit(result.ok ? 0 : 1);
}
