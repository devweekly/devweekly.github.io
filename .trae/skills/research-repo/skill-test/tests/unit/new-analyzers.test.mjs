// ===========================================================================
// new-analyzers.test.mjs — Unit tests for new inference analyzers
//
// Covers:
//   - DesignPatternAnalyzer (P3-②): Factory/Singleton/Builder/Observer/...
//   - ArchitectureMetricsAnalyzer (P2-④): Fan-in/Fan-out/Cycle/Layer/Stability
//   - TemporalAnalyzer (P2-③): Major Rewrite/Architecture Pivot/Deprecated
//
// Creates a synthetic repo with patterns + import graph + git history,
// runs the full pipeline, and verifies analyzer output structure.
// ===========================================================================

import { runSuite } from "../../lib/test-runner.mjs";
import { runAnalyzerAll } from "../../lib/analyzer-runner.mjs";
import { createSyntheticRepo, cleanupSyntheticRepo } from "../../lib/synthetic-repos.mjs";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// --- Agent repo wrapper: triggers DecisionAnalyzer via tools/prompts/LLM ---
function withAgentRepo(fn) {
  return (result) => {
    const repoDir = createSyntheticRepo("agent");
    try {
      const store = runAnalyzerAll(repoDir);
      fn(result, store);
    } finally {
      cleanupSyntheticRepo(repoDir);
    }
  };
}

// --- Synthetic repo with rich design patterns + import graph + git history --
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
  return runSuite("unit — new analyzers (design patterns / metrics / temporal)", [
    // ── DesignPatternAnalyzer ──────────────────────────────────────────────
    {
      name: "DesignPatternAnalyzer produces output",
      test: withRichRepo((result, store) => {
        const dp = store.designPatterns;
        result.record("designPatterns key exists", () => {
          if (!dp) throw new Error("Missing designPatterns in store");
        });
        result.record("has patterns array", () => {
          if (!Array.isArray(dp?.patterns)) throw new Error("Missing patterns[]");
        });
      }),
    },
    {
      name: "DesignPatternAnalyzer detects Factory pattern",
      test: withRichRepo((result, store) => {
        const patterns = store.designPatterns?.patterns || [];
        const factory = patterns.find((p) => p.pattern === "Factory");
        result.record("Factory pattern detected", () => {
          if (!factory) throw new Error("Factory pattern not detected");
        });
        result.record("Factory has instances >= 1", () => {
          if (!factory || factory.instances < 1) throw new Error("No Factory instances");
        });
        result.record("Factory has evidence array", () => {
          if (!factory?.evidence || !Array.isArray(factory.evidence)) {
            throw new Error("Factory missing evidence[]");
          }
        });
      }),
    },
    {
      name: "DesignPatternAnalyzer detects Singleton pattern",
      test: withRichRepo((result, store) => {
        const patterns = store.designPatterns?.patterns || [];
        const singleton = patterns.find((p) => p.pattern === "Singleton");
        result.record("Singleton detected", () => {
          if (!singleton) throw new Error("Singleton not detected (Logger has getInstance)");
        });
      }),
    },
    {
      name: "DesignPatternAnalyzer detects Observer pattern",
      test: withRichRepo((result, store) => {
        const patterns = store.designPatterns?.patterns || [];
        const observer = patterns.find((p) => p.pattern === "Observer");
        result.record("Observer detected", () => {
          if (!observer) throw new Error("Observer not detected (EventBus has subscribe+publish)");
        });
      }),
    },
    {
      name: "DesignPatternAnalyzer detects Repository pattern",
      test: withRichRepo((result, store) => {
        const patterns = store.designPatterns?.patterns || [];
        const repo = patterns.find((p) => p.pattern === "Repository");
        result.record("Repository detected", () => {
          if (!repo) throw new Error("Repository not detected (UserRepository class)");
        });
      }),
    },
    {
      name: "DesignPatternAnalyzer does NOT false-positive on Service class",
      test: withRichRepo((result, store) => {
        const patterns = store.designPatterns?.patterns || [];
        // UserService should not be tagged as a design pattern
        const allEvidence = patterns.flatMap((p) => p.evidence || []);
        const userServiceHits = allEvidence.filter((e) =>
          String(e.symbol).includes("UserService")
        );
        result.record("UserService not tagged as pattern", () => {
          if (userServiceHits.length > 0) {
            throw new Error(`UserService falsely tagged: ${JSON.stringify(userServiceHits[0])}`);
          }
        });
      }),
    },
    {
      name: "DesignPatternAnalyzer confidence is between 0 and 1",
      test: withRichRepo((result, store) => {
        const patterns = store.designPatterns?.patterns || [];
        result.record("all confidences in [0,1]", () => {
          const bad = patterns.filter(
            (p) => typeof p.confidence !== "number" || p.confidence < 0 || p.confidence > 1
          );
          if (bad.length > 0) throw new Error(`Bad confidence: ${bad[0].pattern}=${bad[0].confidence}`);
        });
      }),
    },

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

    // ── P2-②: Decision Record ADR 7-field validation ──────────────────────
    // The synthetic "patterns" repo may not trigger DecisionAnalyzer (which
    // keys off architecture patterns / AI capabilities / tools / LLM call
    // sites). When no decisions are produced, we skip ADR validation rather
    // than fail — the test's purpose is to validate ADR FIELDS when decisions
    // exist, not to guarantee decisions on a patterns-only repo.
    {
      name: "Decision Record contains ADR 7 fields (Problem/Alternatives/Tradeoff/Chosen/Evidence/Risk/Reusability)",
      test: withRichRepo((result, store) => {
        const decisions = store.decisions?.decisions || [];
        if (decisions.length === 0) {
          result.record("skipped (no decisions detected on patterns repo)", () => {});
          return;
        }
        for (const d of decisions) {
          result.record(`${d.id} has problem`, () => {
            if (!d.problem) throw new Error(`Missing problem in ${d.id}`);
          });
          result.record(`${d.id} has alternatives`, () => {
            if (!d.alternatives) throw new Error(`Missing alternatives in ${d.id}`);
          });
          result.record(`${d.id} has tradeoff`, () => {
            if (!d.tradeoff) throw new Error(`Missing tradeoff in ${d.id}`);
          });
          result.record(`${d.id} has chosen (decision)`, () => {
            if (!d.decision) throw new Error(`Missing decision (chosen) in ${d.id}`);
          });
          result.record(`${d.id} has evidence array`, () => {
            if (!Array.isArray(d.evidence)) throw new Error(`Missing evidence[] in ${d.id}`);
          });
          result.record(`${d.id} has risk`, () => {
            if (!d.risk) throw new Error(`Missing risk in ${d.id}`);
          });
          result.record(`${d.id} has reusability (0-1)`, () => {
            if (typeof d.reusability !== "number" || d.reusability < 0 || d.reusability > 1) {
              throw new Error(`Bad reusability in ${d.id}: ${d.reusability}`);
            }
          });
        }
      }),
    },
    {
      name: "Decision Record categories are known enum",
      test: withRichRepo((result, store) => {
        const decisions = store.decisions?.decisions || [];
        const KNOWN = ["structural", "modular", "capability", "integration", "quality", "negative"];
        result.record("all categories valid", () => {
          const bad = decisions.filter((d) => !KNOWN.includes(d.category));
          if (bad.length > 0) throw new Error(`Unknown category: ${bad[0].category}`);
        });
      }),
    },

    // ── P2-② (agent repo): ADR 7-field validation on a repo that triggers decisions ─
    // The agent synthetic repo has tools/prompts/LLM call sites, so DecisionAnalyzer
    // should produce decisions. This is where the ADR field validation actually runs.
    {
      name: "Agent repo triggers DecisionAnalyzer and ADR 7 fields are present",
      test: withAgentRepo((result, store) => {
        const decisions = store.decisions?.decisions || [];
        result.record("agent repo produces >=1 decision", () => {
          if (decisions.length === 0) throw new Error("Agent repo should trigger decisions (tools/prompts/LLM)");
        });
        for (const d of decisions) {
          result.record(`${d.id} has problem`, () => {
            if (!d.problem) throw new Error(`Missing problem in ${d.id}`);
          });
          result.record(`${d.id} has alternatives`, () => {
            if (!d.alternatives) throw new Error(`Missing alternatives in ${d.id}`);
          });
          result.record(`${d.id} has tradeoff`, () => {
            if (!d.tradeoff) throw new Error(`Missing tradeoff in ${d.id}`);
          });
          result.record(`${d.id} has chosen (decision)`, () => {
            if (!d.decision) throw new Error(`Missing decision (chosen) in ${d.id}`);
          });
          result.record(`${d.id} has evidence array`, () => {
            if (!Array.isArray(d.evidence)) throw new Error(`Missing evidence[] in ${d.id}`);
          });
          result.record(`${d.id} has risk`, () => {
            if (!d.risk) throw new Error(`Missing risk in ${d.id}`);
          });
          result.record(`${d.id} has reusability (0-1)`, () => {
            if (typeof d.reusability !== "number" || d.reusability < 0 || d.reusability > 1) {
              throw new Error(`Bad reusability in ${d.id}: ${d.reusability}`);
            }
          });
        }
      }),
    },

    // ── P2-①: Pattern Reusability 4-field validation ──────────────────────
    {
      name: "Pattern output contains Reusability 4 fields (Applicability/Limitation/Migration Cost/Reuse Score)",
      test: withRichRepo((result, store) => {
        const patterns = store.designPatterns?.patterns || [];
        if (patterns.length === 0) {
          result.record("skipped (no patterns)", () => {});
          return;
        }
        for (const p of patterns) {
          result.record(`${p.pattern} has applicability`, () => {
            if (!p.applicability) throw new Error(`Missing applicability in ${p.pattern}`);
          });
          result.record(`${p.pattern} has limitation`, () => {
            if (p.limitation === undefined) throw new Error(`Missing limitation in ${p.pattern}`);
          });
          result.record(`${p.pattern} has migrationCost`, () => {
            if (!["low", "medium", "high"].includes(p.migrationCost)) {
              throw new Error(`Bad migrationCost in ${p.pattern}: ${p.migrationCost}`);
            }
          });
          result.record(`${p.pattern} has reuseScore (1-5)`, () => {
            if (typeof p.reuseScore !== "number" || p.reuseScore < 1 || p.reuseScore > 5) {
              throw new Error(`Bad reuseScore in ${p.pattern}: ${p.reuseScore}`);
            }
          });
        }
      }),
    },
  ]);
}
