import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname, basename, relative, sep } from "node:path";
import {
  SOURCE_EXTENSIONS,
  PROMPT_FILE_EXTENSIONS,
  TOOL_FILE_EXTENSIONS,
  ARCHITECTURE_SIGNAL_DIRS,
  ENTRY_POINT_FILES,
  ENTRYPOINT_DIR_NAMES,
  PROMPT_MARKERS,
  TOOL_PATTERNS,
  SCHEMA_FIRST_TOOL_TYPE_PATTERN,
  EVAL_KEYWORDS,
  EVAL_DIR_NAMES,
  CI_FILES,
  IMPORTANT_FILES,
} from "./config.mjs";
import {
  mapWithConcurrency,
  walkFiles,
  readFileSafe,
  countByExtension,
  parseImports,
  parseWorkflow,
  extractSchemaNear,
  extractSymbolsAST,
  extractImportsAST,
  extractEntrypointsAST,
  extractPromptsAST,
  extractToolsAST,
  isTestFile,
  isTestPath,
  categorizeTestCategory,
  categorizeTestModule,
  countTestFunctions,
  detectTestPatterns,
  computeInDegree,
  computePageRank,
  detectCycles,
  topN,
  pathToModuleId,
  normalizeImportToId,
  git,
  PROJECT_DISCOVERY_RULES,
} from "./utils.mjs";
import { RepositoryContext } from "./context.mjs";
import { BaseAnalyzer } from "./base-analyzer.mjs";

// ===========================================================================
// Legacy compatibility wrappers
// ===========================================================================

// --- Command: discovery ---
/**
 * Legacy compatibility wrapper for discovery analysis.
 * New code should use AnalyzerPipeline with DiscoveryAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeDiscovery(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const analyzer = new DiscoveryAnalyzer();
  const store = {};
  analyzer.analyze(ctx, store, { command: "discovery" });
  return store.discovery;
}

// --- Command: architecture ---
/**
 * Legacy compatibility wrapper for architecture analysis.
 * New code should use AnalyzerPipeline with ArchitectureAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeArchitecture(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const store = {};

  // Legacy wrapper runs symbols first so architecture can reuse imports.
  const symbolsAnalyzer = new SymbolsAnalyzer();
  await symbolsAnalyzer.analyze(ctx, store, { command: "symbols" });

  const analyzer = new ArchitectureAnalyzer();
  await analyzer.analyze(ctx, store, { command: "architecture" });
  return store.architecture;
}

// --- Command: entrypoints ---
/**
 * Legacy compatibility wrapper for entrypoints analysis.
 * New code should use AnalyzerPipeline with EntrypointsAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeEntrypoints(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const analyzer = new EntrypointsAnalyzer();
  const store = {};
  await analyzer.analyze(ctx, store, { command: "entrypoints" });
  return store.entrypoints;
}

// --- Command: prompts ---
/**
 * Legacy compatibility wrapper for prompts analysis.
 * New code should use AnalyzerPipeline with PromptsAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzePrompts(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const analyzer = new PromptsAnalyzer();
  const store = {};
  await analyzer.analyze(ctx, store, { command: "prompts" });
  return store.prompts;
}

// --- Command: tools ---
/**
 * Legacy compatibility wrapper for tools analysis.
 * New code should use AnalyzerPipeline with ToolsAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeTools(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const analyzer = new ToolsAnalyzer();
  const store = {};
  await analyzer.analyze(ctx, store, { command: "tools" });
  return store.tools;
}

// --- Command: tests ---
/**
 * Legacy compatibility wrapper for tests analysis.
 * New code should use AnalyzerPipeline with TestsAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeTests(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const analyzer = new TestsAnalyzer();
  const store = {};
  analyzer.analyze(ctx, store, { command: "tests" });
  return store.tests;
}

// --- Command: evaluations ---
/**
 * Legacy compatibility wrapper for evaluations analysis.
 * New code should use AnalyzerPipeline with EvaluationsAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeEvaluations(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const analyzer = new EvaluationsAnalyzer();
  const store = {};
  analyzer.analyze(ctx, store, { command: "evaluations" });
  return store.evaluations;
}

// --- Command: git ---
/**
 * Legacy compatibility wrapper for git analysis.
 * New code should use AnalyzerPipeline with GitAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeGit(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  if (!ctx.isGitRepo) {
    return {
      totalCommits: 0,
      totalContributors: 0,
      firstCommit: null,
      lastCommit: null,
      topActiveModules: [],
      largestRefactors: [],
      tags: [],
      note: "not a git repository (or git unavailable)",
    };
  }
  const analyzer = new GitAnalyzer();
  const store = {};
  analyzer.analyze(ctx, store, { command: "git" });
  return store.git;
}

// --- Command: ci ---
/**
 * Legacy compatibility wrapper for CI analysis.
 * New code should use AnalyzerPipeline with CIAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeCI(repoPath) {
  const workflows = [];
  let provider = null;
  let hasCI = false;

  for (const ci of CI_FILES) {
    const fullPath = join(repoPath, ci.path);
    if (ci.type === "file") {
      if (existsSync(fullPath)) {
        hasCI = true;
        provider = ci.provider;
        workflows.push({
          name: basename(ci.path),
          path: ci.path,
          triggers: [],
          jobs: [],
        });
      }
    } else {
      // directory
      if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
        hasCI = true;
        provider = ci.provider;
        let entries;
        try {
          entries = readdirSync(fullPath, { withFileTypes: true });
        } catch { entries = []; }
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const ext = extname(entry.name);
          if (ext !== ".yml" && ext !== ".yaml") continue;
          const wfPath = join(fullPath, entry.name);
          const { triggers, jobs } = parseWorkflow(wfPath);
          workflows.push({
            name: entry.name,
            path: join(ci.path, entry.name),
            triggers,
            jobs,
          });
        }
      }
    }
  }

  // Jenkinsfile parse
  const jenkinsfilePath = join(repoPath, "Jenkinsfile");
  if (existsSync(jenkinsfilePath)) {
    hasCI = true;
    provider = provider || "jenkins";
    const content = readFileSafe(jenkinsfilePath);
    const stages = [];
    const stageRe = /stage\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = stageRe.exec(content)) !== null) stages.push(m[1]);
    workflows.push({
      name: "Jenkinsfile",
      path: "Jenkinsfile",
      triggers: [],
      jobs: stages,
    });
  }

  return { hasCI, provider, workflows };
}

// --- Command: ranking ---
/**
 * ranking command — Interesting files ranking.
 * Combines signals from discovery, architecture, entrypoints, tests.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeRanking(repoPath) {
  const discovery = analyzeDiscovery(repoPath);
  const architecture = await analyzeArchitecture(repoPath);
  const entrypoints = await analyzeEntrypoints(repoPath);
  const tests = analyzeTests(repoPath);

  const indegreeMap = {};
  for (const { id, value } of architecture.centrality.topByInDegree) {
    indegreeMap[id] = value;
  }
  const pagerankMap = {};
  for (const { id, value } of architecture.centrality.topByPageRank) {
    pagerankMap[id] = value;
  }
  // Set of high-centrality node paths
  const highIndegreePaths = new Set(
    architecture.centrality.topByInDegree.map(({ id }) => {
      const node = architecture.nodes.find((n) => n.id === id);
      return node ? node.path : null;
    }).filter(Boolean)
  );
  const highPagerankPaths = new Set(
    architecture.centrality.topByPageRank.map(({ id }) => {
      const node = architecture.nodes.find((n) => n.id === id);
      return node ? node.path : null;
    }).filter(Boolean)
  );
  const entrypointPaths = new Set(entrypoints.entrypoints.map((e) => e.path));
  const testPaths = new Set(tests.fileDetails.map((t) => t.path));

  // Build a candidate file list (use deep walk this time)
  const allFiles = walkFiles(repoPath, 8);
  const scored = [];
  for (const f of allFiles) {
    const relPath = relative(repoPath, f.path);
    const name = basename(f.path).toLowerCase();
    let score = 0;
    const reasons = [];

    if (name === "readme.md" || name === "readme.rst" || name === "readme") {
      score += 50;
      reasons.push("README (+50)");
    }
    // Boost important files (AGENTS.md, CLAUDE.md, LICENSE, etc.)
    if (IMPORTANT_FILES.has(relPath) || IMPORTANT_FILES.has(name)) {
      score += 40;
      reasons.push("important file (+40)");
    }
    if (relPath.split(sep).some((p) => p.toLowerCase() === "examples" || p.toLowerCase() === "example")) {
      score += 30;
      reasons.push("examples (+30)");
    }
    if (testPaths.has(relPath)) {
      score += 20;
      reasons.push("test (+20)");
    }
    if (relPath.split(sep).some((p) => p.toLowerCase() === "docs" || p.toLowerCase() === "doc")) {
      score += 20;
      reasons.push("docs (+20)");
    }
    if (highIndegreePaths.has(relPath)) {
      score += 40;
      reasons.push("high in-degree (+40)");
    }
    if (highPagerankPaths.has(relPath)) {
      score += 50;
      reasons.push("high PageRank (+50)");
    }
    if (entrypointPaths.has(relPath)) {
      score += 30;
      reasons.push("entrypoint (+30)");
    }

    if (score > 0) {
      scored.push({ path: relPath, score, reasons });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { topFiles: scored.slice(0, 20) };
}

// --- Command: symbols ---
/**
 * Legacy compatibility wrapper for symbols analysis.
 * New code should use AnalyzerPipeline with SymbolsAnalyzer.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeSymbols(repoPath) {
  const ctx = new RepositoryContext(repoPath);
  const analyzer = new SymbolsAnalyzer();
  const store = {};
  await analyzer.analyze(ctx, store, { command: "symbols" });
  return store.symbols;
}

// ===========================================================================
// AnalyzerPipeline adapters and true analyzers (fact extractors)
// ===========================================================================

/**
 * Adapter that wraps a legacy analyzer function (repoPath) => result.
 * The function receives a RepositoryContext instead of a raw repoPath, so
 * future refactoring can gradually move shared logic into the context.
 */
class FunctionAnalyzerAdapter extends BaseAnalyzer {
  constructor(id, fn, options = {}) {
    super();
    this._id = id;
    this._fn = fn;
    this._options = options;
  }

  get id() {
    return this._id;
  }

  supports(ctx) {
    if (this._options.needsGit && !ctx.isGitRepo) return false;
    return true;
  }

  async analyze(ctx, store, analyzerCtx) {
    const result = await this._fn(ctx.repoPath);
    store[this._id] = result;
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: DiscoveryAnalyzer (uses RepositoryContext)
// ---------------------------------------------------------------------------

class DiscoveryAnalyzer extends BaseAnalyzer {
  get id() {
    return "discovery";
  }

  supports(_ctx) {
    return true;
  }

  analyze(ctx, store, _analyzerCtx) {
    // Scan for metadata and agent files via PROJECT_DISCOVERY_RULES (root-level)
    const metadataFiles = [];
    const agentFiles = [];
    for (const r of PROJECT_DISCOVERY_RULES) {
      if (r.category !== "metadata" && r.category !== "agent") continue;
      if (ctx.exists(r.file)) {
        if (r.category === "metadata") metadataFiles.push(r.file);
        else agentFiles.push(r.file);
      }
    }

    // Recursive agent-instruction detection.
    // Root-level check above misses SKILL.md/CLAUDE.md/AGENTS.md in subdirectories
    // (monorepos, skill bundles, workspace packages). This caused 3/8 ref-only
    // repos to falsely report "No AI Agent instruction files found" despite
    // containing 100+ SKILL.md files in subdirectories. We now glob for any
    // agent-instruction file anywhere in the repo (excluding node_modules/.git).
    if (agentFiles.length === 0) {
      const allRels = ctx.allFiles.map((f) => ctx.rel(f.path));
      const agentFileNames = new Set(["agents.md", "claude.md", "skill.md", "gemini.md"]);
      const seen = new Set();
      for (const rel of allRels) {
        if (/(?:^|[\\/])(?:node_modules|\.git|vendor|dist|build)[\\/]/.test(rel)) continue;
        const name = basename(rel).toLowerCase();
        if (agentFileNames.has(name) && !seen.has(rel)) {
          agentFiles.push(rel);
          seen.add(rel);
          // Cap at 50 to avoid huge lists (some repos have 100+ agent files)
          if (agentFiles.length >= 50) break;
        }
      }
    }

    const dirs = ctx.dirs.map((d) => ctx.rel(d.path));
    const files = ctx.allFiles;

    const topLevelDirs = dirs
      .filter((d) => !d.includes(sep) && d.length > 0)
      .sort();

    const importantDirs = dirs
      .filter((d) => {
        const filesInDir = files.filter((f) => {
          const relFile = ctx.rel(f.path);
          return relFile.startsWith(d + sep);
        });
        return filesInDir.some((f) => SOURCE_EXTENSIONS.has(f.ext));
      })
      .slice(0, 20);

    // Architecture signal directories — where the architecture lives.
    // Deduplicate by root directory: when multiple subdirectories of the same
    // root match (e.g. benchmarks/repo-name/{src,scripts,personas}),
    // keep only the shallowest one. This prevents a single root directory from
    // monopolizing the 20-slot budget and hiding other signal directories.
    const archSignalAll = dirs
      .filter((d) => d.split(sep).some((p) => ARCHITECTURE_SIGNAL_DIRS.has(p.toLowerCase())));
    const archSignalRoots = new Map();
    const architectureSignalDirs = [];
    for (const d of archSignalAll) {
      const root = d.split(sep)[0];
      // Keep at most 2 entries per root directory
      const count = archSignalRoots.get(root) || 0;
      if (count >= 2) continue;
      archSignalRoots.set(root, count + 1);
      architectureSignalDirs.push(d);
      if (architectureSignalDirs.length >= 20) break;
    }

    const fileCount = countByExtension(files);
    const testFiles = ctx.testFiles;
    const hasReadme = metadataFiles.some((f) => f.toLowerCase().startsWith("readme"));
    const hasCI = CI_FILES.some((ci) => ctx.exists(ci.path));

    // repoName: prefer the repository directory name (basename of repoPath).
    // The manifest `name` field is the PACKAGE name, which often differs from
    // the repo directory name (e.g. PyPI/npm package names differ from repo names).
    // Using package name as repo name caused systematic mis-naming.
    // We now always use the directory name; manifest.name is preserved separately
    // in the `manifest` field for downstream consumers.
    const repoName = basename(ctx.repoPath);

    store[this.id] = {
      repoName,
      packageName: ctx.manifest?.name || null,
      repoPath: ctx.repoPath,
      analyzedAt: new Date().toISOString(),
      manifest: ctx.manifest,
      hasReadme,
      hasCI,
      topLevelDirs,
      importantDirs,
      architectureSignalDirs,
      metadataFiles,
      agentFiles,
      fileCount,
      testFileCount: testFiles.length,
      totalSourceFiles: files.filter((f) => SOURCE_EXTENSIONS.has(f.ext)).length,
      // allFiles: relative paths of all files in the repo (excluding ignored dirs).
      // Used by _negativeFindings for monorepo-aware recursive metadata detection.
      allFiles: files.map((f) => ctx.rel(f.path)),
    };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: SymbolsAnalyzer (uses RepositoryContext AST cache)
// ---------------------------------------------------------------------------

class SymbolsAnalyzer extends BaseAnalyzer {
  get id() {
    return "symbols";
  }

  supports(_ctx) {
    return true;
  }

  async analyze(ctx, store, _analyzerCtx) {
    const sourceFiles = ctx.sourceFiles;

    const results = await mapWithConcurrency(sourceFiles, 10, async (file) => {
      const tree = await ctx.parseAST(file.path);
      const symbols = await extractSymbolsAST(file.path, ctx.repoPath, tree);
      return symbols || { functions: [], classes: [], imports: [], calls: [], strings: [] };
    });

    const functions = [];
    const classes = [];
    const imports = [];
    const calls = [];
    const strings = [];
    for (const r of results) {
      if (!r) continue;
      functions.push(...r.functions);
      classes.push(...r.classes);
      imports.push(...r.imports);
      calls.push(...r.calls);
      strings.push(...r.strings);
    }

    store[this.id] = {
      totalFunctions: functions.length,
      totalClasses: classes.length,
      totalImports: imports.length,
      totalCalls: calls.length,
      totalStrings: strings.length,
      functions,
      classes,
      imports,
      calls,
      strings,
    };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: ArchitectureAnalyzer (uses RepositoryContext + symbols cache)
// ---------------------------------------------------------------------------

class ArchitectureAnalyzer extends BaseAnalyzer {
  get id() {
    return "architecture";
  }

  supports(_ctx) {
    return true;
  }

  async analyze(ctx, store, _analyzerCtx) {
    const sourceFiles = ctx.sourceFiles;
    const fileImports = new Map(); // relPath -> string[]

    // Prefer symbols imports if SymbolsAnalyzer ran before us.
    const symbols = store.symbols;
    if (symbols && Array.isArray(symbols.imports)) {
      for (const imp of symbols.imports) {
        // For "from x import y" the module is in `from`; for "import x" it is in `what`.
        const moduleName = imp.from || imp.what;
        if (!moduleName) continue;
        const list = fileImports.get(imp.file) || [];
        list.push(moduleName);
        fileImports.set(imp.file, list);
      }
    } else {
      // Fallback: parse imports per file (still uses ctx AST cache)
      await mapWithConcurrency(sourceFiles, 10, async (file) => {
        const relPath = ctx.rel(file.path);
        const tree = await ctx.parseAST(file.path);
        const astImports = await extractImportsAST(file.path, tree);
        const imports = astImports !== null ? astImports : parseImports(file.path);
        fileImports.set(relPath, imports);
      });
    }

    const nodes = [];
    const nodeIdSet = new Set();
    for (const file of sourceFiles) {
      const relPath = ctx.rel(file.path);
      const moduleId = pathToModuleId(relPath);
      nodes.push({ id: moduleId, path: relPath, imports: fileImports.get(relPath) || [] });
      nodeIdSet.add(moduleId);
    }

    // Build edges; only keep edges whose target resolves to an existing node id.
    const edges = [];
    for (const node of nodes) {
      for (const imp of node.imports) {
        const targetId = normalizeImportToId(imp, node.path);
        // Exact match
        if (nodeIdSet.has(targetId)) {
          edges.push({ from: node.id, to: targetId });
          continue;
        }
        // Suffix match: any node id ending with .targetId or equal to last segment
        const lastSeg = targetId.includes(".") ? targetId.split(".").pop() : targetId;
        const candidates = [...nodeIdSet].filter(
          (id) => id === lastSeg || id.endsWith("." + lastSeg)
        );
        if (candidates.length === 1) {
          edges.push({ from: node.id, to: candidates[0] });
        } else if (candidates.length > 1) {
          // Prefer the shortest candidate (closest match)
          const best = candidates.sort((a, b) => a.length - b.length)[0];
          edges.push({ from: node.id, to: best });
        }
      }
    }

    const nodeIds = nodes.map((n) => n.id);
    const inDegree = computeInDegree(nodeIds, edges);
    const pageRank = computePageRank(nodeIds, edges, 20, 0.85);
    const cycles = detectCycles(nodeIds, edges, 20);

    store[this.id] = {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodes: nodes.map((n) => ({ id: n.id, path: n.path, imports: n.imports })),
      edges,
      cycles,
      centrality: {
        topByInDegree: topN(inDegree, 10),
        topByPageRank: topN(pageRank, 10),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: EntrypointsAnalyzer (uses RepositoryContext)
// ---------------------------------------------------------------------------

class EntrypointsAnalyzer extends BaseAnalyzer {
  get id() {
    return "entrypoints";
  }

  supports(_ctx) {
    return true;
  }

  async analyze(ctx, store, _analyzerCtx) {
    const entries = ctx.files.filter((f) => f.depth <= 6);
    const entrypoints = [];
    const seen = new Set();

    const addEntrypoint = (relPath, type, reason) => {
      if (seen.has(relPath)) return;
      seen.add(relPath);
      entrypoints.push({ path: relPath, type, reason });
    };

    // 1. Filename-based detection (with depth/library filtering)
    for (const e of entries) {
      const relPath = ctx.rel(e.path);
      // Skip test files entirely — e.g. MySQLErrorsTest.java with a main() method
      // is a test fixture, not a real entrypoint. Observed in Java IDE plugins.
      if (isTestPath(relPath)) continue;
      const depth = relPath.split(sep).length;
      const isDeep = depth > 3;
      const isBundled = /bundled_skills|vendor|node_modules|site-packages/.test(relPath);
      const isLibOrTest = /(?:^|[\\/])(?:lib|libs|utils|helpers|internal|common|tests?|__tests__|spec)[\\/]/.test(relPath)
        || /^tests?[\\/]/.test(relPath);
      for (const ep of ENTRY_POINT_FILES) {
        if (ep.names.includes(e.name)) {
          if (isDeep || isBundled) {
            // SDK entrypoints (index.ts/index.js/index.py) are barrel exports,
            // NOT executable tools — preserve their type instead of reclassifying.
            // Reclassifying them as "tool" caused massive false positives in
            // barrel exports in tool/plugins directories (121+ false tools in one repo).
            const reclassifyType = ep.type === "sdk" ? "sdk" : "tool";
            addEntrypoint(relPath, reclassifyType, ep.reason + " (deep/bundled)");
          } else if (isLibOrTest) {
            const reclassifyType = ep.type === "sdk" ? "sdk" : "tool";
            addEntrypoint(relPath, reclassifyType, ep.reason + " (library/test dir)");
          } else {
            addEntrypoint(relPath, ep.type, ep.reason);
          }
          break;
        }
      }
    }

    // 2. Directory-based detection (bin/, scripts/)
    // Note: examples/ directory is intentionally excluded — example files are
    // demonstration code, not executable entry points. Counting them as entrypoints
    // caused massive false positives (e.g., 98 example files in one repo).
    for (const e of entries) {
      const parts = ctx.rel(e.path).split(sep);
      if (parts.length < 2) continue;
      const topDir = parts[0];
      if (topDir === "bin") {
        addEntrypoint(ctx.rel(e.path), "cli", "file under bin/");
      } else if (topDir === "scripts" && ENTRYPOINT_DIR_NAMES.has("scripts")) {
        addEntrypoint(ctx.rel(e.path), "cli", "file under scripts/");
      }
    }

    // 3. AST-based detection (preferred) + regex fallback per file
    // Filter test files — test fixtures with main() (e.g. MySQLErrorsTest.java)
    // are not real entrypoints.
    const sourceFiles = entries.filter((e) => SOURCE_EXTENSIONS.has(e.ext) && !isTestPath(ctx.rel(e.path)));
    const astResults = await mapWithConcurrency(sourceFiles, 10, async (file) => {
        const relPath = ctx.rel(file.path);
        const tree = await ctx.parseAST(file.path);
        const astSignals = await extractEntrypointsAST(file.path, ctx.repoPath, tree);
        if (astSignals !== null) return { relPath, signals: astSignals, useRegex: false };
        // Regex fallback
        const content = ctx.readFileAbsolute(file.path);
        if (!content) return { relPath, signals: [], useRegex: false };
        const signals = [];
        if (file.ext === ".py") {
          if (/if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(content)) {
            signals.push({ path: relPath, type: "cli", reason: "Python __main__ guard" });
          }
          if (/def\s+main\s*\(/.test(content) && /argparse|click|typer|sys\.argv/.test(content)) {
            signals.push({ path: relPath, type: "cli", reason: "Python main() with argparse/click/typer" });
          }
        } else if ([".ts", ".js", ".mjs", ".tsx", ".jsx"].includes(file.ext)) {
          if (/createServer\s*\(|app\.listen\s*\(|server\.listen\s*\(/.test(content)) {
            signals.push({ path: relPath, type: "server", reason: "JS server.listen / createServer" });
          }
          if (/process\.argv|yargs|commander|inquirer/.test(content) && /export\s+(default\s+)?(async\s+)?function\s+main|function\s+main\s*\(/.test(content)) {
            signals.push({ path: relPath, type: "cli", reason: "JS CLI with argv/yargs/commander + main()" });
          }
        } else if (file.ext === ".go") {
          if (/func\s+main\s*\(\)/.test(content)) {
            signals.push({ path: relPath, type: "cli", reason: "Go func main()" });
          }
        } else if (file.ext === ".rs") {
          if (/fn\s+main\s*\(\)/.test(content)) {
            signals.push({ path: relPath, type: "cli", reason: "Rust fn main()" });
          }
        }
        return { relPath, signals, useRegex: true };
      });
    for (const r of astResults) {
      if (!r) continue;
      const { relPath, signals } = r;
      if (seen.has(relPath)) continue;
      const depth = relPath.split(sep).length;
      const isDeep = depth > 3;
      const isBundled = /bundled_skills|vendor|node_modules|site-packages/.test(relPath);
      const isLibOrTest = /(?:^|[\\/])(?:lib|libs|utils|helpers|internal|common|tests?|__tests__|spec)[\\/]/.test(relPath)
        || /^tests?[\\/]/.test(relPath);
      for (const sig of signals) {
        if (isDeep || isBundled) {
          addEntrypoint(sig.path, "tool", sig.reason + " (deep/bundled)");
        } else if (isLibOrTest && sig.type === "cli") {
          addEntrypoint(sig.path, "tool", sig.reason + " (library/test dir)");
        } else {
          addEntrypoint(sig.path, sig.type, sig.reason);
        }
      }
    }

    // 4. Manifest-declared entry points
    const pkgJsonPath = join(ctx.repoPath, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        if (pkg.bin) {
          const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin;
          for (const [binName, binPath] of Object.entries(bins)) {
            addEntrypoint(binPath, "cli", `package.json bin: ${binName}`);
          }
        }
      } catch { /* ignore */ }
    }
    const pyprojectPath = join(ctx.repoPath, "pyproject.toml");
    if (existsSync(pyprojectPath)) {
      const content = readFileSync(pyprojectPath, "utf-8");
      let inScripts = false;
      for (const line of content.split(/\r?\n/)) {
        if (/^\s*\[(project\.scripts|tool\.poetry\.scripts|project\.entry-points\.[\w.-]+)\]/.test(line)) {
          inScripts = true;
          continue;
        }
        if (/^\s*\[/.test(line)) {
          inScripts = false;
          continue;
        }
        if (inScripts) {
          const m = line.match(/^([A-Za-z_][\w-]*)\s*=\s*"([^"]+)"/);
          if (m) {
            const modulePath = m[2].includes(":") ? m[2].split(":")[0] : m[2];
            const scriptPath = modulePath.replace(/\./g, "/") + ".py";
            addEntrypoint(scriptPath, "cli", `pyproject.toml script: ${m[1]}`);
          }
        }
      }
    }

    store[this.id] = { entrypoints };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: PromptsAnalyzer (uses RepositoryContext AST cache)
// ---------------------------------------------------------------------------

class PromptsAnalyzer extends BaseAnalyzer {
  get id() {
    return "prompts";
  }

  supports(_ctx) {
    return true;
  }

  async analyze(ctx, store, _analyzerCtx) {
    const files = ctx.files.filter((f) => PROMPT_FILE_EXTENSIONS.has(f.ext));
    const codeExts = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs"]);
    // SKIP test files: test fixtures (mock prompts, `SYSTEM_PROMPT` constants in
    // test setup) are not real prompts. Observed: test files contained mock
    // prompts and CSS template strings that matched prompt regex. Filtering
    // tests eliminates this noise.
    const codeFiles = files.filter((f) => codeExts.has(f.ext) && !isTestPath(ctx.rel(f.path)));
    const mdFiles = files.filter((f) => !codeExts.has(f.ext));

    // AST-based extraction for code files (with regex fallback per file)
    const codeResults = await mapWithConcurrency(codeFiles, 10, async (f) => {
        const tree = await ctx.parseAST(f.path);
        const astPrompts = await extractPromptsAST(f.path, ctx.repoPath, tree);
        if (astPrompts !== null) return astPrompts;
        // Regex fallback (only used when AST parsing fails)
        const content = ctx.readFileAbsolute(f.path);
        if (!content) return [];
        const prompts = [];
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip Python kwargs / shell flags: `prompt=` preceded by `,` or `(`
          // or `--prop` is a kwarg/flag, not a variable assignment. The AST
          // path correctly filters these (only matches `assignment` nodes),
          // but this regex fallback needs the same guard.
          if (/(?:[,(]\s*|--prop\s+)prompt\s*=/i.test(line)) continue;
          for (const marker of PROMPT_MARKERS) {
            marker.regex.lastIndex = 0;
            const match = marker.regex.exec(line);
            if (match) {
              prompts.push({
                file: ctx.rel(f.path),
                line: i + 1,
                type: marker.type,
                snippet: line.trim().slice(0, 200),
              });
              break;
            }
          }
        }
        return prompts;
      });

    // Regex for markdown files — only scan inside fenced code blocks.
    // Prose mentions of "prompt:" or "template" (e.g. CHANGELOG entries,
    // README sentences like "Other commands that may prompt:") are NOT prompts.
    // This eliminates ~6 false positives per repo observed in ref-only repos.
    const mdPrompts = [];
    for (const f of mdFiles) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      const lines = content.split(/\r?\n/);
      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Track fenced code blocks (``` or ~~~)
        if (/^\s*(```|~~~)/.test(line)) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        // Only detect prompt markers inside code blocks
        if (!inCodeBlock) continue;
        // Skip shell CLI flag context: `--prop prompt=...` / `--prompt=...` /
        // `--prop promptTitle=...`. These are CLI argument assignments, not
        // LLM prompt definitions. Observed: OfficeCLI data-validation docs
        // use `--prop prompt="Age must be 18-120"` to set Excel UI prompts.
        if (/--(?:prop|prompt|option)\s+\w*\s*prompt/i.test(line)) continue;
        for (const marker of PROMPT_MARKERS) {
          marker.regex.lastIndex = 0;
          const match = marker.regex.exec(line);
          if (match) {
            mdPrompts.push({
              file: ctx.rel(f.path),
              line: i + 1,
              type: marker.type,
              snippet: line.trim().slice(0, 200),
            });
            break;
          }
        }
      }
    }

    const prompts = [...codeResults.filter(Boolean).flat(), ...mdPrompts];
    store[this.id] = { totalPrompts: prompts.length, prompts };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: ToolsAnalyzer (uses RepositoryContext AST cache)
// ---------------------------------------------------------------------------

class ToolsAnalyzer extends BaseAnalyzer {
  get id() {
    return "tools";
  }

  supports(_ctx) {
    return true;
  }

  async analyze(ctx, store, _analyzerCtx) {
    // The tool cross-reference step needs entrypoints; ensure they exist even when
    // this analyzer is run in isolation (e.g. `node research-repo.mjs tools <repo>`).
    if (!store.entrypoints) {
      const entrypointsAnalyzer = new EntrypointsAnalyzer();
      if (entrypointsAnalyzer.supports(ctx)) {
        await entrypointsAnalyzer.analyze(ctx, store, { command: "entrypoints" });
      }
    }

    // SKIP test files: test fixtures (mock ToolDef objects, `name: 'lookup'`
    // in test setup) are not real tools. Observed: most detected "tools" in
    // some repos were test fixtures. Filtering tests is the single
    // highest-impact fix for tool-detection accuracy.
    const files = ctx.files.filter((f) => TOOL_FILE_EXTENSIONS.has(f.ext) && !isTestPath(ctx.rel(f.path)));
    const tools = [];
    const seen = new Set();

    // Try AST first per file; regex fallback when AST unavailable
    const results = await mapWithConcurrency(files, 10, async (f) => {
        const tree = await ctx.parseAST(f.path);
        const astTools = await extractToolsAST(f.path, ctx.repoPath, tree);
        if (astTools !== null) return { ast: true, tools: astTools, file: f };
        return { ast: false, tools: null, file: f };
      });

    // Process AST results; collect files that need regex fallback
    // Filter false-positive tool names: platform utilities (_is_wsl, mac, win),
    // generic config names, and framework names that AST detection may pick up
    // from decorators on utility functions.
    const TOOL_FP_NAMES = new Set([
      "react", "vue", "angular", "svelte", "default", "main", "app", "config",
      "mac", "win", "linux", "unix", "darwin", "windows",
      "_is_wsl", "is_wsl", "is_windows", "is_mac", "is_linux", "is_darwin",
      "platform", "os", "env", "environment",
      "options", "settings", "params", "args", "props", "state",
      "data", "value", "key", "type", "id", "url", "host", "port",
      "name", "title", "label", "description", "content",
    ]);
    const regexFiles = [];
    for (const r of results) {
      if (!r) continue;
      if (r.ast) {
        for (const t of r.tools) {
          if (t.name && TOOL_FP_NAMES.has(t.name.toLowerCase())) continue;
          const key = `${t.file}:${t.framework}:${t.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tools.push(t);
        }
      } else {
        regexFiles.push(r.file);
      }
    }

    // Regex fallback for files where AST was unavailable
    for (const f of regexFiles) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      const relPath = ctx.rel(f.path);

      for (const pattern of TOOL_PATTERNS) {
        pattern.regex.lastIndex = 0;
        let match;
        while ((match = pattern.regex.exec(content)) !== null) {
          const name = match[1];
          if (!name) continue;
          const key = `${relPath}:${pattern.framework}:${name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const schema = extractSchemaNear(content, match.index);
          tools.push({
            name,
            file: relPath,
            framework: pattern.framework,
            schema,
          });
        }
      }
    }

    // Factory function pattern detection (also run on all files, not just regex fallback)
    // This catches tools created via factory functions like createEditTool, createBashTool
    // Pattern: `export function createEditTool(` or `export async function createEditTool(`
    const FACTORY_TOOL_RE = /(?:export\s+)?(?:async\s+)?function\s+(create\w+Tool)\s*\(/g;
    for (const f of files) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      const relPath = ctx.rel(f.path);
      
      FACTORY_TOOL_RE.lastIndex = 0;
      let match;
      while ((match = FACTORY_TOOL_RE.exec(content)) !== null) {
        const funcName = match[1];
        if (!funcName) continue;
        // Extract tool name from function name: createEditTool -> edit
        const toolName = funcName.replace(/^create/, "").replace(/Tool$/, "").toLowerCase();
        // Filter out utility functions that aren't real tools:
        // - Names > 15 chars are likely compound phrases (e.g., "tooldefinitionfromagent")
        // - Names containing "definition", "wrapper", "manager", "handler", "builder",
        //   "factory", "registry", "config", "provider", "resolver", "adapter",
        //   "converter", "transformer" indicate utility/converter functions
        if (toolName.length > 15) continue;
        if (/definition|wrapper|manager|handler|builder|factory|registry|config|provider|resolver|adapter|converter|transformer/.test(toolName)) continue;
        const key = `${relPath}:factory-function:${toolName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const schema = extractSchemaNear(content, match.index);
        tools.push({
          name: toolName,
          file: relPath,
          framework: "factory-function",
          schema,
        });
      }
    }

    // Schema-first / registry-array tool detection (common in MCP servers).
    // Pattern: `export const RPC_TOOLS: ToolDef[] = [ { name: 'foo', ... }, ... ]`
    // We detect the type annotation first, then extract `name: '...'` values.
    // This catches tools that decorators and class-name patterns miss.
    //
    // Two extraction modes:
    //   1. String literal: `name: 'foo'` / `name: "foo"` (original)
    //   2. Constant reference: `name: LOAD_SKILL_TOOL.to_owned()` /
    //      `name: CONSTANT.into()` — resolves the constant to its string value
    //      by scanning for `const CONSTANT: &str = "..."` in the same file.
    //      This catches Rust builtin tools that use string constants for tool names.
    const SCHEMA_FIRST_NAME_RE = /\bname\s*:\s*['"]([a-zA-Z_][\w-]*)['"]/g;
    const SCHEMA_FIRST_CONST_RE = /\bname\s*:\s*([A-Z_][A-Z0-9_]*)\s*\.\s*(?:to_owned|into|to_string)\s*\(\s*\)/g;
    for (const f of files) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      if (!SCHEMA_FIRST_TOOL_TYPE_PATTERN.test(content)) continue;
      const relPath = ctx.rel(f.path);

      // Build a map of CONSTANT → string value for const-reference resolution
      const constMap = new Map();
      const constDefRe = /\b(?:const|static)\s+([A-Z_][A-Z0-9_]*)\s*:\s*(?:&'?str|String)\s*=\s*['"]([^'"]+)['"]/g;
      let constMatch;
      while ((constMatch = constDefRe.exec(content)) !== null) {
        constMap.set(constMatch[1], constMatch[2]);
      }

      // Mode 1: string literal
      SCHEMA_FIRST_NAME_RE.lastIndex = 0;
      let match;
      while ((match = SCHEMA_FIRST_NAME_RE.exec(content)) !== null) {
        const name = match[1];
        if (!name) continue;
        // Filter out common false positives: generic object names + single-char test fixtures
        // + platform/env detection utilities (e.g. _is_wsl, mac, win)
        const lower = name.toLowerCase();
        const TOOL_FALSE_POSITIVE_NAMES = new Set([
          "react", "vue", "angular", "svelte", "default", "main", "app", "config",
          // Platform/environment detection — not AI tools
          "mac", "win", "linux", "unix", "darwin", "windows",
          "_is_wsl", "is_wsl", "is_windows", "is_mac", "is_linux", "is_darwin",
          "platform", "os", "env", "environment",
          // Generic config/option names
          "options", "settings", "params", "args", "props", "state",
          "data", "value", "key", "type", "id", "url", "host", "port",
          "name", "title", "label", "description", "content",
        ]);
        if (TOOL_FALSE_POSITIVE_NAMES.has(lower)) continue;
        if (name.length < 2) continue; // skip single-char names like `t` (test fixtures)
        const key = `${relPath}:schema-first:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const schema = extractSchemaNear(content, match.index);
        tools.push({
          name,
          file: relPath,
          framework: "schema-first",
          schema,
        });
      }

      // Mode 2: constant reference (e.g. `name: LOAD_SKILL_TOOL.to_owned()`)
      SCHEMA_FIRST_CONST_RE.lastIndex = 0;
      while ((match = SCHEMA_FIRST_CONST_RE.exec(content)) !== null) {
        const constName = match[1];
        const resolved = constMap.get(constName);
        if (!resolved) continue; // cannot resolve — skip rather than guess
        const key = `${relPath}:schema-first:${resolved}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const schema = extractSchemaNear(content, match.index);
        tools.push({
          name: resolved,
          file: relPath,
          framework: "schema-first",
          schema,
        });
      }
    }

    // Map.set + factory-function registration (e.g., page-agent pattern).
    // Pattern: `tools.set('name', tool({...}))` or `tools.set("name", factory(...))`
    // This catches tools registered via imperative Map.set with string-literal
    // names, common in TypeScript/JavaScript agents that use a Map<string, Tool>
    // registry instead of decorators.
    // Observed: page-agent uses `tools.set('done', tool({...}))` for 9 tools,
    // none of which are caught by decorator/class/schema-first patterns.
    const MAP_SET_TOOL_RE = /\.set\(\s*['"]([a-zA-Z_][\w-]*)['"]\s*,\s*(?:tool|createTool|makeTool|defineTool|factory)\s*\(/g;
    for (const f of files) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      const relPath = ctx.rel(f.path);
      MAP_SET_TOOL_RE.lastIndex = 0;
      let match;
      while ((match = MAP_SET_TOOL_RE.exec(content)) !== null) {
        const name = match[1];
        if (!name) continue;
        const lower = name.toLowerCase();
        if (TOOL_FP_NAMES.has(lower)) continue;
        if (name.length < 2) continue;
        const key = `${relPath}:map-set:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const schema = extractSchemaNear(content, match.index);
        tools.push({
          name,
          file: relPath,
          framework: "map-set",
          schema,
        });
      }
    }

    // FastMCP tuple registration (e.g., pyod pattern).
    // Pattern 1: `mcp.tool()(fn_name)` — function-call-as-decorator factory.
    //   Unlike `@mcp.tool()` (Decorator node in AST), `mcp.tool()(fn)` is a
    //   CallExpression wrapping a CallExpression, common in FastMCP's
    //   programmatic registration API.
    // Pattern 2: `_TOOL_FUNCTIONS = (fn1, fn2, ...)` followed by a loop
    //   `for fn in _TOOL_FUNCTIONS: mcp.tool()(fn)`. We detect the tuple
    //   assignment and extract each function name as a tool.
    // Observed: pyod's mcp_server.py defines `_TOOL_FUNCTIONS = (profile_data,
    //   plan_detection, build_detector, ...)` and registers 10 MCP tools via
    //   `mcp.tool()(fn)` loop — none caught by existing patterns.
    const MCP_TUPLE_ASSIGN_RE = /([A-Z_][A-Z0-9_]*)\s*=\s*\(\s*([a-zA-Z_][\w]*)\s*,/g;
    const MCP_TUPLE_ITEM_RE = /([a-zA-Z_][\w]*)\s*,?/g;
    const MCP_TOOL_CALL_RE = /mcp\.tool\(\)\s*\(\s*([a-zA-Z_][\w]*)\s*\)/g;
    for (const f of files) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      // Skip if no mcp.tool() call — avoids false positives from arbitrary tuples
      if (!/mcp\.tool\(\)/.test(content)) continue;
      const relPath = ctx.rel(f.path);

      // Pattern 1: direct mcp.tool()(fn_name) calls
      MCP_TOOL_CALL_RE.lastIndex = 0;
      let match;
      while ((match = MCP_TOOL_CALL_RE.exec(content)) !== null) {
        const fnName = match[1];
        if (!fnName) continue;
        // Tool name = function name (FastMCP uses function name as tool name)
        const toolName = fnName.toLowerCase().replace(/^make_/, "").replace(/^create_/, "");
        if (TOOL_FP_NAMES.has(toolName)) continue;
        if (toolName.length < 2) continue;
        const key = `${relPath}:mcp-tuple:${toolName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tools.push({
          name: toolName,
          file: relPath,
          framework: "mcp-tuple",
          schema: null,
        });
      }

      // Pattern 2: tuple assignment + loop registration
      // Find `<NAME> = (fn1, fn2, ...)` where NAME suggests tools
      MCP_TUPLE_ASSIGN_RE.lastIndex = 0;
      while ((match = MCP_TUPLE_ASSIGN_RE.exec(content)) !== null) {
        const tupleName = match[1];
        const firstFn = match[2];
        // Only treat as tool tuple if name suggests tools OR file has mcp.tool() loop
        const nameSuggestsTools = /TOOL|TOOL_FUNC|TOOLS|REGISTER/.test(tupleName);
        if (!nameSuggestsTools) continue;
        // Extract the full tuple content between ( and )
        const tupleStart = match.index + match[0].length - 1; // position of first (
        // Find matching close paren
        let depth = 1;
        let end = tupleStart + 1;
        while (end < content.length && depth > 0) {
          if (content[end] === "(") depth++;
          else if (content[end] === ")") depth--;
          end++;
        }
        const tupleContent = content.slice(tupleStart + 1, end - 1);
        // Extract function names from tuple
        const fnNames = [];
        const itemRe = /\b([a-zA-Z_][\w]*)\b/g;
        let itemMatch;
        while ((itemMatch = itemRe.exec(tupleContent)) !== null) {
          const name = itemMatch[1];
          // Skip keywords and common non-function words
          if (["True", "False", "None", "self", "cls"].includes(name)) continue;
          fnNames.push(name);
        }
        for (const fnName of fnNames) {
          const toolName = fnName.toLowerCase().replace(/^make_/, "").replace(/^create_/, "");
          if (TOOL_FP_NAMES.has(toolName)) continue;
          if (toolName.length < 2) continue;
          const key = `${relPath}:mcp-tuple:${toolName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tools.push({
            name: toolName,
            file: relPath,
            framework: "mcp-tuple",
            schema: null,
          });
        }
      }
    }

    // Imperative registry.register pattern (e.g., openworker pattern).
    // Pattern: `registry.register(make_*_tool(...))` or `registry.register(*_tool())`
    //   where the factory function name encodes the tool name. This catches
    //   Python agents that build a ToolRegistry imperatively at runtime rather
    //   than using decorators.
    // Only matches `registry.register(` (singular) — NOT `register_all`,
    //   because `register_all(factory(...))` typically passes a list of tools
    //   built by a multi-tool factory (e.g., `git_tools()`, `file_tools()`),
    //   and we can't extract individual tool names from the factory name alone.
    // Observed: openworker's coworker/agent.py registers ~12 tools via
    //   `registry.register(make_send_message_tool(secrets))` /
    //   `registry.register(propose_plan_tool())` — none caught by existing
    //   patterns because they're plain function calls, not decorators.
    const REGISTRY_REGISTER_RE = /\bregistry\s*\.\s*register\s*\(\s*(?:make_?|create_?)?([a-zA-Z_][\w]*)\s*\(/g;
    for (const f of files) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      // Skip if no registry.register call — avoids scanning every file
      if (!/\bregistry\s*\.\s*register\s*\(/.test(content)) continue;
      const relPath = ctx.rel(f.path);
      REGISTRY_REGISTER_RE.lastIndex = 0;
      let match;
      while ((match = REGISTRY_REGISTER_RE.exec(content)) !== null) {
        const fnName = match[1];
        if (!fnName) continue;
        // Skip multi-tool factories: function names ending with `_tools`
        // (plural) typically return a list of tools, not a single tool.
        // e.g., `file_tools()`, `git_tools()`, `subscription_tools()`
        if (/_tools$/.test(fnName)) continue;
        // Derive tool name from factory function name:
        //   make_send_message_tool -> send_message
        //   propose_plan_tool -> propose_plan
        //   ask_user_tool -> ask_user
        //   make_web_search_tool -> web_search
        let toolName = fnName
          .replace(/^(make|create)_/, "")
          .replace(/_tool$/, "")
          .toLowerCase();
        if (TOOL_FP_NAMES.has(toolName)) continue;
        if (toolName.length < 2) continue;
        // Skip generic utility names that aren't tools
        if (/^(?:build|main|app|config|setup|init|get|set|run|start|stop|close|open)$/.test(toolName)) continue;
        const key = `${relPath}:registry-register:${toolName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tools.push({
          name: toolName,
          file: relPath,
          framework: "registry-register",
          schema: null,
        });
      }
    }

    // Cross-reference entrypoints labeled as "tool" for standalone executable scripts
    // (e.g. bundled_skills/*/scripts/execute.py, skills/*/scripts/*.py) so that
    // simple argparse/sys.argv tools are represented even when they lack decorator/class patterns.
    const entrypoints = store.entrypoints?.entrypoints || [];
    // Barrel-export filenames — `index.*` files are package entrypoints, NOT
    // executable tools. Even when they live in `plugins/` or `tools/` directories,
    // they just re-export symbols. Observed: barrel exports caused 121+ false tools.
    const BARREL_EXPORT_RE = /^index\.(ts|js|mjs|cjs|py|rs|go|java|kt)$/;
    for (const ep of entrypoints) {
      if (ep.type !== "tool") continue;
      const relPath = ep.path;
      const fileName = basename(relPath);
      // Skip barrel exports — they're not standalone tools.
      if (BARREL_EXPORT_RE.test(fileName)) continue;
      const baseName = fileName.replace(/\.[^.]+$/, "");

      // Ignore library/test modules that the entrypoints analyzer may have mis-tagged as tool.
      const isLibraryOrTest = /(?:^|[\\/])(?:lib|libs|utils|helpers|internal|common|tests?|__tests__|spec|benchmark)[\\/]/.test(
        relPath
      );
      if (isLibraryOrTest) continue;

      // Only accept tool scripts that live inside a recognized skill/tool/agent directory.
      // Note: `plugins/` is intentionally excluded here — Eclipse/IDE plugins
      // and webpack/vite plugins are NOT agent tools.
      // Agent-tool directories are: skills/, bundled_skills/, tools/, agents/, hooks/.
      const isInToolSpace = /(?:^|[\\/])(?:skills?|bundled_skills?|tools?|agents?|hooks?)[\\/]/.test(relPath);
      if (!isInToolSpace) continue;

      // Filter out platform-specific packaging/build directories. `tools/pack/src/mac/`
      // and `tools/pack/src/win/` are platform build targets, not AI tools. Observed
      // platform directories like `mac/` and `win/` were falsely detected as script-tools.
      const PLATFORM_DIR_RE = /(?:^|[\\/])(?:mac|win|linux|darwin|windows|ios|android|arm64|x64|x86)[\\/]/i;
      if (PLATFORM_DIR_RE.test(relPath)) continue;

      // Derive a readable tool name from the parent directory when possible:
      // bundled_skills/ai/openai-chat/scripts/execute.py -> openai-chat
      const GENERIC_DIR_NAMES = new Set([
        "scripts",
        "hooks",
        "dot-claude",
        "examples",
        "src",
        "lib",
        "libs",
        "utils",
        "helpers",
        "tools",
        "common",
        "internal",
      ]);
      const parts = relPath.split(sep);
      let derivedName = baseName;
      const scriptsIdx = parts.indexOf("scripts");
      const hooksIdx = parts.indexOf("hooks");
      const toolDirIdx = scriptsIdx > 0 ? scriptsIdx : hooksIdx > 0 ? hooksIdx : -1;
      if (toolDirIdx > 0 && !GENERIC_DIR_NAMES.has(parts[toolDirIdx - 1])) {
        derivedName = parts[toolDirIdx - 1];
      } else if (parts.length >= 2) {
        const parent = parts[parts.length - 2];
        if (!GENERIC_DIR_NAMES.has(parent)) {
          derivedName = parent;
        }
      }
      const key = `${relPath}:script-tool:${derivedName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tools.push({
        name: derivedName,
        file: relPath,
        framework: "script-tool",
        schema: null,
      });
    }

    // Cross-file name deduplication: the same tool name may be detected in
    // multiple files (e.g., idea_spark in 4 files, sandbox_available in 2
    // files). Keep the first occurrence by name to avoid inflated counts.
    // Different frameworks with the same name are kept separately.
    const dedupedTools = [];
    const nameFrameworkSeen = new Set();
    for (const t of tools) {
      const dedupKey = `${t.name}:${t.framework}`;
      if (nameFrameworkSeen.has(dedupKey)) continue;
      nameFrameworkSeen.add(dedupKey);
      dedupedTools.push(t);
    }

    store[this.id] = { totalTools: dedupedTools.length, tools: dedupedTools };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: TestsAnalyzer (uses RepositoryContext)
// ---------------------------------------------------------------------------

class TestsAnalyzer extends BaseAnalyzer {
  get id() {
    return "tests";
  }

  supports(_ctx) {
    return true;
  }

  analyze(ctx, store, _analyzerCtx) {
    const testFiles = ctx.files.filter((f) => isTestFile(f.name));

    const byCategory = { unit: 0, integration: 0, e2e: 0 };
    const byModule = {};
    let totalFunctions = 0;

    const fileDetails = testFiles.map((f) => {
      const relPath = ctx.rel(f.path);
      const category = categorizeTestCategory(f.path);
      const module = categorizeTestModule(f.path, ctx.repoPath);
      const functionCount = countTestFunctions(f.path);
      byCategory[category] = (byCategory[category] || 0) + 1;
      byModule[module] = (byModule[module] || 0) + functionCount;
      totalFunctions += functionCount;
      return {
        path: relPath,
        category,
        module,
        testFunctionCount: functionCount,
      };
    });

    const patterns = detectTestPatterns(testFiles);

    store[this.id] = {
      totalTestFiles: testFiles.length,
      totalTestFunctions: totalFunctions,
      byCategory,
      byModule,
      patterns,
      fileDetails,
    };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: EvaluationsAnalyzer (uses RepositoryContext)
// ---------------------------------------------------------------------------

class EvaluationsAnalyzer extends BaseAnalyzer {
  get id() {
    return "evaluations";
  }

  supports(_ctx) {
    return true;
  }

  analyze(ctx, store, _analyzerCtx) {
    const evalFiles = [];
    const evalDirs = new Set();
    const patterns = new Set();
    const metrics = new Set();

    // 1. Directory-based detection
    for (const d of ctx.dirs) {
      const name = basename(d.path).toLowerCase();
      if (EVAL_DIR_NAMES.has(name)) {
        evalDirs.add(ctx.rel(d.path));
      }
    }

    // 2. File-based detection (by name and content)
    // NOTE: Name-based detection is restricted to source files to avoid false
    // positives (e.g., blog posts, images, slide decks with "benchmark" in
    // the filename were being misclassified as evaluation files).
    //
    // Additional guard (2026-07): name-based detection now requires LLM-specific
    // context in the file content. This avoids false positives like
    // Java IDE evaluation classes (query execution context, NOT LLM eval)
    // and mapping libraries with "metric"/"score" words.
    // LLM-specific context = at least one of: prompt, llm, model, judge, agent,
    // harness, system_prompt, chat, completion, embedding, retrieval, rag.
    //
    // "benchmark" and "dataset" were removed from LLM_CONTEXT_RE because they
    // caused circular false positives: every file inside a `benchmarks/`
    // directory contains the word "benchmark" in comments (e.g., "every
    // benchmark app"), which then satisfied the LLM-context check and
    // classified performance benchmarks as AI evaluation files.
    // Observed false positive: topcoat (46 Rust bench files in benchmarks/
    // detected as 46 AI eval files — actually axum-maud/leptos/nextjs
    // performance comparisons).
    //
    // Package/import declarations are stripped before testing — Java package
    // names like `com.example.model` would otherwise trigger a false
    // "model" match.
    const LLM_CONTEXT_RE = /\b(?:prompt|llm|model|judge|agent|harness|system_prompt|chat|completion|embedding|retrieval|rag)\b/i;
    const STRIP_PKG_IMPORT_RE = /^\s*(?:package|import)\s+[^;]+;\s*$/gm;
    // Skip minified/bundled vendor assets — they contain every keyword by
    // accident (e.g., worldmonitor's `public/pro/assets/clerk-*.js` bundles
    // matched `score`, `metric`, `accuracy`, `model` and produced 44 false
    // eval files). Heuristics: very long average line length OR known
    // bundle filename patterns.
    const BUNDLE_FILE_RE = /(?:[-.]min\.|vendor\/|assets\/|\/dist\/|\/build\/|public\/|\.bundle\.)/i;
    const isBundleFile = (relPath, content) => {
      if (BUNDLE_FILE_RE.test(relPath)) return true;
      if (!content) return false;
      // Minified JS: average line length > 500 chars is a strong signal.
      const lines = content.split("\n", 200);
      if (lines.length === 0) return false;
      const totalLen = lines.reduce((s, l) => s + l.length, 0);
      return totalLen / lines.length > 500;
    };
    for (const f of ctx.allFiles) {
      const name = f.name.toLowerCase();
      const relPath = ctx.rel(f.path);
      // Exclude test files — test fixtures with `score`/`metric`/`accuracy`
      // words (e.g., worldmonitor `tests/*.test.mjs` for clerk SDK) caused
      // false-positive eval detection.
      if (isTestPath(relPath)) continue;
      // Only source files inside eval dirs (not docs/configs)
      const isInEvalDir =
        SOURCE_EXTENSIONS.has(f.ext) &&
        [...evalDirs].some(
          (d) => relPath.startsWith(d + sep) || relPath.startsWith(d + "/")
        );
      // Read content once for both name-confirmation and content-based detection.
      let content = null;
      let codeOnly = null;
      if (SOURCE_EXTENSIONS.has(f.ext)) {
        content = ctx.readFileAbsolute(f.path);
        if (content) {
          // Skip bundle/minified files — they pollute keyword counts.
          if (isBundleFile(relPath, content)) continue;
          // Strip package/import lines so Java package names like
          // Java package names like `com.example.model` don't trigger LLM-context false positives.
          codeOnly = content.replace(STRIP_PKG_IMPORT_RE, "");
        }
      }
      // Name-based detection: source file with eval keyword in name AND
      // LLM-specific context in content (or located in an eval directory).
      // Without the LLM-context check, `DBPEvaluationContext.java` (DB query
      // eval) and similar Java/IDE "evaluation" classes get flagged.
      const hasNameKeyword =
        SOURCE_EXTENSIONS.has(f.ext) && EVAL_KEYWORDS.some((kw) => name.includes(kw));
      const hasLLMContext = !!(codeOnly && LLM_CONTEXT_RE.test(codeOnly));
      const isEvalByName = hasNameKeyword && (hasLLMContext || isInEvalDir);
      let isEvalByContent = false;
      if (codeOnly) {
        let matchCount = 0;
        for (const kw of EVAL_KEYWORDS) {
          const re = new RegExp(`\\b${kw.replace(/_/g, "[_]")}\\b`, "i");
          if (re.test(codeOnly)) {
            matchCount++;
            patterns.add(kw);
          }
        }
        // Require ≥3 keyword matches (was 2) OR ≥2 matches + LLM context.
        // The stricter threshold filters out generic JS libraries (leaflet.js
        // matches "metric"+"accuracy"+"score" from CSS/map code) while keeping
        // real eval files which typically match 4+ keywords.
        isEvalByContent = matchCount >= 3 || (matchCount >= 2 && hasLLMContext);
        const metricRegexes = [
          /\b(accuracy|pass_rate|pass@k|f1|precision|recall|bleu|rouge|exact_match|exact-match)\b/gi,
          /\b(score|metric|accuracy_score|recall_score|precision_score)\b/gi,
        ];
        for (const re of metricRegexes) {
          let m;
          while ((m = re.exec(codeOnly)) !== null) {
            metrics.add(m[1].toLowerCase());
          }
        }
      }
      if (isEvalByName || isEvalByContent || isInEvalDir) {
        evalFiles.push(relPath);
      }
    }

    store[this.id] = {
      hasEvaluation: evalFiles.length > 0 || evalDirs.size > 0,
      evalFiles: [...new Set(evalFiles)],
      evalDirs: [...evalDirs],
      patterns: [...patterns],
      metrics: [...metrics],
    };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: GitAnalyzer (uses RepositoryContext)
// ---------------------------------------------------------------------------

class GitAnalyzer extends BaseAnalyzer {
  get id() {
    return "git";
  }

  supports(ctx) {
    return ctx.isGitRepo;
  }

  analyze(ctx, store, _analyzerCtx) {
    const repoPath = ctx.repoPath;

    // Total commits
    const totalCommitsRaw = git(repoPath, "rev-list", "--count", "HEAD").trim();
    const totalCommits = parseInt(totalCommitsRaw, 10) || 0;

    // First / last commit
    const lastCommitRaw = git(repoPath, "log", "-1", "--format=%cI|%H|%s").trim();
    const firstCommitRaw = git(
      repoPath,
      "log",
      "--max-parents=0",
      "-1",
      "--format=%cI|%H|%s"
    ).trim();
    const parseCommit = (raw) => {
      if (!raw) return null;
      const [date, hash, ...subjectParts] = raw.split("|");
      return { date, hash, subject: subjectParts.join("|") };
    };
    const lastCommit = parseCommit(lastCommitRaw);
    const firstCommit = parseCommit(firstCommitRaw);

    // Contributors — use `-sn` (name only) to avoid counting the same person
    // multiple times when they use different emails. `-sne` includes email,
    // causing one person with 2 emails to be counted as 2 contributors.
    const shortlog = git(repoPath, "shortlog", "-sn", "HEAD").trim();
    const contributors = shortlog
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^\s*(\d+)\s+(.+)$/);
        return m ? { commits: parseInt(m[1], 10), name: m[2].trim() } : null;
      })
      .filter(Boolean);
    const totalContributors = contributors.length;

    // Top active modules: count commits per top-level dir
    const moduleCounts = {};
    const logLines = git(repoPath, "log", "--name-only", "--format=", "HEAD")
      .split(/\r?\n/)
      .filter(Boolean);
    for (const line of logLines) {
      const top = line.split(sep)[0];
      if (!top || top === ".") continue;
      moduleCounts[top] = (moduleCounts[top] || 0) + 1;
    }
    const topActiveModules = Object.entries(moduleCounts)
      .map(([module, commits]) => ({ module, commits }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 10);

    // Largest refactors: commits touching the most files
    const commitStatRaw = git(
      repoPath,
      "log",
      "--name-only",
      "--format=@@@%H|%cI|%s",
      "HEAD"
    );
    const largestRefactors = [];
    if (commitStatRaw) {
      const blocks = commitStatRaw.split(/@@@/).filter(Boolean);
      for (const block of blocks) {
        const lines = block.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) continue;
        const [hash, date, ...subjectParts] = lines[0].split("|");
        const subject = subjectParts.join("|");
        const fileCount = lines.length - 1;
        if (fileCount > 0) {
          largestRefactors.push({ hash, date, subject, filesChanged: fileCount });
        }
      }
    }
    largestRefactors.sort((a, b) => b.filesChanged - a.filesChanged);
    const largestRefactorsTop = largestRefactors.slice(0, 10);

    // Tags
    const tagsRaw = git(repoPath, "tag", "--sort=-creatordate").trim();
    const tags = tagsRaw ? tagsRaw.split(/\r?\n/).slice(0, 50) : [];

    store[this.id] = {
      totalCommits,
      totalContributors,
      contributors: contributors.slice(0, 20),
      firstCommit,
      lastCommit,
      topActiveModules,
      largestRefactors: largestRefactorsTop,
      tags,
    };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: CIAnalyzer (uses RepositoryContext)
// ---------------------------------------------------------------------------

class CIAnalyzer extends BaseAnalyzer {
  get id() {
    return "ci";
  }

  supports(_ctx) {
    return true;
  }

  analyze(ctx, store, _analyzerCtx) {
    const workflows = [];
    let provider = null;
    let hasCI = false;

    for (const ci of CI_FILES) {
      const fullPath = join(ctx.repoPath, ci.path);
      if (ci.type === "file") {
        if (existsSync(fullPath)) {
          hasCI = true;
          provider = ci.provider;
          workflows.push({
            name: basename(ci.path),
            path: ci.path,
            triggers: [],
            jobs: [],
          });
        }
      } else {
        if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
          hasCI = true;
          provider = ci.provider;
          let entries;
          try {
            entries = readdirSync(fullPath, { withFileTypes: true });
          } catch {
            entries = [];
          }
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const ext = extname(entry.name);
            if (ext !== ".yml" && ext !== ".yaml") continue;
            const wfPath = join(fullPath, entry.name);
            const { triggers, jobs } = parseWorkflow(wfPath);
            workflows.push({
              name: entry.name,
              path: join(ci.path, entry.name),
              triggers,
              jobs,
            });
          }
        }
      }
    }

    // Jenkinsfile parse
    const jenkinsfilePath = join(ctx.repoPath, "Jenkinsfile");
    if (existsSync(jenkinsfilePath)) {
      hasCI = true;
      provider = provider || "jenkins";
      const content = readFileSafe(jenkinsfilePath);
      const stages = [];
      const stageRe = /stage\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let m;
      while ((m = stageRe.exec(content)) !== null) stages.push(m[1]);
      workflows.push({
        name: "Jenkinsfile",
        path: "Jenkinsfile",
        triggers: [],
        jobs: stages,
      });
    }

    store[this.id] = { hasCI, provider, workflows };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: RankingAnalyzer (uses RepositoryContext + prior evidence)
// ---------------------------------------------------------------------------

class RankingAnalyzer extends BaseAnalyzer {
  get id() {
    return "ranking";
  }

  supports(_ctx) {
    return true;
  }

  analyze(ctx, store, _analyzerCtx) {
    // Reuse results from analyzers that ran before us.
    const architecture = store.architecture || {};
    const entrypoints = store.entrypoints || {};
    const tests = store.tests || {};

    const indegreeMap = {};
    for (const { id, value } of architecture.centrality?.topByInDegree || []) {
      indegreeMap[id] = value;
    }
    const pagerankMap = {};
    for (const { id, value } of architecture.centrality?.topByPageRank || []) {
      pagerankMap[id] = value;
    }
    const highIndegreePaths = new Set(
      (architecture.centrality?.topByInDegree || [])
        .map(({ id }) => {
          const node = architecture.nodes?.find((n) => n.id === id);
          return node ? node.path : null;
        })
        .filter(Boolean)
    );
    const highPagerankPaths = new Set(
      (architecture.centrality?.topByPageRank || [])
        .map(({ id }) => {
          const node = architecture.nodes?.find((n) => n.id === id);
          return node ? node.path : null;
        })
        .filter(Boolean)
    );
    const entrypointPaths = new Set(
      (entrypoints.entrypoints || []).map((e) => e.path)
    );
    const testPaths = new Set(
      (tests.fileDetails || []).map((t) => t.path)
    );

    const allFiles = ctx.files;
    const scored = [];
    for (const f of allFiles) {
      const relPath = ctx.rel(f.path);
      const name = f.name.toLowerCase();
      let score = 0;
      const reasons = [];

      // Down-rank test files: they are derivatives of implementation, not
      // architecture. Previously tests got +20 and invaded Top 10. Now tests
      // get 0 from the test signal. Tests are still visible via TestsAnalyzer.
      const isTest = isTestPath(relPath) || testPaths.has(relPath);

      if (name === "readme.md" || name === "readme.rst" || name === "readme") {
        score += 50;
        reasons.push("README (+50)");
      }
      if (IMPORTANT_FILES.has(relPath) || IMPORTANT_FILES.has(name)) {
        score += 40;
        reasons.push("important file (+40)");
      }
      // Examples: reduced from +30 to +10. Examples are auxiliary, not core
      // architecture. Previously examples READMEs monopolized Top 3, pushing
      // core architecture docs out of Top 20.
      if (
        relPath
          .split(sep)
          .some((p) => p.toLowerCase() === "examples" || p.toLowerCase() === "example")
      ) {
        score += 10;
        reasons.push("examples (+10)");
      }
      // Test files: no bonus (previously +20). Tests are still ranked if they
      // have high in-degree/PageRank, but the test signal alone no longer
      // promotes them.
      if (
        relPath
          .split(sep)
          .some((p) => p.toLowerCase() === "docs" || p.toLowerCase() === "doc")
      ) {
        score += 20;
        reasons.push("docs (+20)");
      }
      if (highIndegreePaths.has(relPath)) {
        score += 40;
        reasons.push("high in-degree (+40)");
      }
      if (highPagerankPaths.has(relPath)) {
        score += 50;
        reasons.push("high PageRank (+50)");
      }
      if (entrypointPaths.has(relPath)) {
        score += 30;
        reasons.push("entrypoint (+30)");
      }

      // Apply test-file penalty AFTER all bonuses: tests lose 30 points.
      // This ensures tests with high PageRank still rank, but plain test
      // files (score 0 from bonuses) don't appear in Top 20 at all.
      if (isTest) {
        score -= 30;
        reasons.push("test file (-30)");
      }

      if (score > 0) {
        scored.push({ path: relPath, score, reasons });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    store[this.id] = { topFiles: scored.slice(0, 20) };
  }
}

export {
  // Legacy wrappers
  analyzeDiscovery,
  analyzeArchitecture,
  analyzeEntrypoints,
  analyzePrompts,
  analyzeTools,
  analyzeTests,
  analyzeEvaluations,
  analyzeGit,
  analyzeCI,
  analyzeRanking,
  analyzeSymbols,
  // Adapter
  FunctionAnalyzerAdapter,
  // Fact extractors
  DiscoveryAnalyzer,
  SymbolsAnalyzer,
  ArchitectureAnalyzer,
  EntrypointsAnalyzer,
  PromptsAnalyzer,
  ToolsAnalyzer,
  TestsAnalyzer,
  EvaluationsAnalyzer,
  GitAnalyzer,
  CIAnalyzer,
  RankingAnalyzer,
};
