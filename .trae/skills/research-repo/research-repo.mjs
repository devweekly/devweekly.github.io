#!/usr/bin/env node
/**
 * research-repo.mjs — Deterministic analysis script for repository research.
 *
 * Usage:
 *   node research-repo.mjs discovery    <repoPath>  # Repository metadata, file tree, manifest
 *   node research-repo.mjs architecture <repoPath>  # Dependency graph + centrality + cycles
 *   node research-repo.mjs entrypoints  <repoPath>  # Entry point detection
 *   node research-repo.mjs prompts      <repoPath>  # Prompt discovery
 *   node research-repo.mjs tools        <repoPath>  # Tool/function discovery
 *   node research-repo.mjs tests        <repoPath>  # Test discovery + categorization
 *   node research-repo.mjs evaluations  <repoPath>  # Evaluation/benchmark discovery
 *   node research-repo.mjs git          <repoPath>  # Git history analysis
 *   node research-repo.mjs ci           <repoPath>  # CI/CD discovery
 *   node research-repo.mjs ranking      <repoPath>  # Interesting files ranking
 *   node research-repo.mjs symbols      <repoPath>  # Semantic Index (functions, classes, imports, calls, strings)
 *   node research-repo.mjs all          <repoPath>  # Complete Evidence Store (includes plan + questions)
 *   node research-repo.mjs plan         <repoPath>  # Research plan: goal → hypotheses → evidence → reading plan
 *   node research-repo.mjs questions    <repoPath>  # Gap-driven questions for LLM reasoning layer
 *
 * Zero-dependency fallback: works with Node.js built-ins only.
 * Optionally uses fast-glob, simple-git, yaml if installed (dynamic import).
 * Optionally uses web-tree-sitter + tree-sitter-wasms for AST-based analysis
 * (imports, prompts, tools, entrypoints, symbols). Falls back to regex heuristics
 * when Tree-sitter is unavailable.
 *
 * Each command prints JSON to stdout. Errors go to stderr, exit(1) on error.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, extname, basename, relative, sep, dirname } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

// Swallow EPIPE errors when downstream (e.g. `head`) closes the pipe early.
process.stdout?.on?.("error", (err) => {
  if (err && err.code === "EPIPE") process.exit(0);
  throw err;
});

// ---------------------------------------------------------------------------
// Repository Discovery Configuration
//
// Unified configuration for repository discovery and analysis.
// Adding a new language or discovery category only requires editing this section.
//
//   Repository Discovery Config
//   ├── IGNORED_DIRS              — directories skipped during traversal
//   ├── LANGUAGE_EXTENSIONS       — single source of truth for language→extensions
//   ├── SOURCE_EXTENSIONS         — auto-generated from LANGUAGE_EXTENSIONS
//   ├── PROJECT_DISCOVERY_RULES   — unified discovery rules with categories + priority
//   ├── ARCHITECTURE_SIGNAL_DIRS  — directories that reveal architecture
//   ├── IMPORTANT_FILES           — files to prioritize for reading
//   ├── ENTRY_POINT_FILES         — entry point filenames by type
//   ├── PROMPT_FILE_PATTERNS      — glob patterns for prompt file discovery
//   ├── TEST_FILE_REGEXES         — regex patterns for test file classification
//   └── Content scanning patterns (PROMPT_MARKERS, TOOL_PATTERNS, etc.)
// ---------------------------------------------------------------------------

// 1. IGNORED_DIRS — directories skipped during file traversal
//    NOTE: examples/, demo/, docs/, benchmark/, eval/, tests/ are NOT ignored
//    — they are research priorities.
const IGNORED_DIRS = new Set([
  // VCS
  ".git", ".svn", ".hg",
  // JavaScript
  "node_modules", ".next", ".nuxt", ".turbo", ".cache", "dist", "build", "coverage",
  // Python
  "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".venv", "venv", "env",
  // Rust
  "target",
  // Java / Kotlin
  ".gradle", ".idea",
  // .NET
  "out", "obj",
  // Common
  ".vscode", "vendor", "tmp", "temp", "logs",
]);

// 2. LANGUAGE_EXTENSIONS — single source of truth for language → extensions
//    SOURCE_EXTENSIONS is auto-generated; never edit it manually.
const LANGUAGE_EXTENSIONS = {
  javascript: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  python: [".py"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  kotlin: [".kt"],
  csharp: [".cs"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".h"],
  swift: [".swift"],
  ruby: [".rb"],
  php: [".php"],
  scala: [".scala"],
  dart: [".dart"],
};

// Auto-generated — all source file extensions across all languages
const SOURCE_EXTENSIONS = new Set(Object.values(LANGUAGE_EXTENSIONS).flat());

// Code file extensions for scanning (JS + Python + Rust + Go + Java)
const CODE_FILE_EXTENSIONS = new Set([
  ...LANGUAGE_EXTENSIONS.javascript,
  ...LANGUAGE_EXTENSIONS.python,
  ...LANGUAGE_EXTENSIONS.rust,
  ...LANGUAGE_EXTENSIONS.go,
  ...LANGUAGE_EXTENSIONS.java,
]);

// Prompt scanning extensions (code + markdown)
const PROMPT_FILE_EXTENSIONS = new Set([...CODE_FILE_EXTENSIONS, ".md"]);
// Tool scanning extensions (code only, no markdown)
const TOOL_FILE_EXTENSIONS = CODE_FILE_EXTENSIONS;

// 3. PROJECT_DISCOVERY_RULES — unified discovery with categories and priority
//    Higher priority = checked first; first match wins for manifests.
//    Categories: manifest, metadata, agent, ci, tests
const PROJECT_DISCOVERY_RULES = [
  // Manifests (package manager entry points)
  { category: "manifest", file: "package.json", language: "javascript", parser: parsePackageJson, priority: 100 },
  { category: "manifest", file: "pyproject.toml", language: "python", parser: parsePyproject, priority: 100 },
  { category: "manifest", file: "Cargo.toml", language: "rust", parser: parseCargoToml, priority: 100 },
  { category: "manifest", file: "go.mod", language: "go", parser: parseGoMod, priority: 100 },
  { category: "manifest", file: "setup.py", language: "python", parser: parseSetupPy, priority: 90 },
  { category: "manifest", file: "setup.cfg", language: "python", parser: parseSetupCfg, priority: 85 },
  { category: "manifest", file: "requirements.txt", language: "python", parser: parseRequirementsTxt, priority: 80 },
  // Metadata (project-level docs)
  { category: "metadata", file: "README.md", priority: 95 },
  { category: "metadata", file: "README.rst", priority: 95 },
  { category: "metadata", file: "README", priority: 95 },
  { category: "metadata", file: "LICENSE", priority: 85 },
  { category: "metadata", file: "CONTRIBUTING.md", priority: 75 },
  { category: "metadata", file: "CHANGELOG.md", priority: 70 },
  { category: "metadata", file: "SECURITY.md", priority: 70 },
  // Agent instructions (AI coding agent configs)
  { category: "agent", file: "AGENTS.md", priority: 95 },
  { category: "agent", file: "CLAUDE.md", priority: 95 },
  { category: "agent", file: join(".github", "copilot-instructions.md"), priority: 90 },
  { category: "agent", file: ".cursorrules", priority: 85 },
  // Test config
  { category: "tests", file: "pytest.ini", priority: 70 },
  { category: "tests", file: "conftest.py", priority: 65 },
  { category: "tests", file: "jest.config.js", priority: 70 },
  { category: "tests", file: "jest.config.ts", priority: 70 },
  { category: "tests", file: "vitest.config.ts", priority: 70 },
];

// 4. ARCHITECTURE_SIGNAL_DIRS — directories that reveal where the architecture lives
const ARCHITECTURE_SIGNAL_DIRS = new Set([
  "src", "lib", "core", "engine", "runtime", "internal",
  "planner", "runner", "executor", "agent", "agents",
  "memory", "context", "prompt", "prompts",
  "tool", "tools",
  "eval", "evaluation", "benchmark", "benchmarks",
  "tests", "examples", "docs",
]);

// 5. IMPORTANT_FILES — files to prioritize for reading (used in ranking)
const IMPORTANT_FILES = new Set([
  "README.md", "AGENTS.md", "CLAUDE.md",
  join(".github", "copilot-instructions.md"), ".cursorrules",
  "LICENSE", "CONTRIBUTING.md", "CHANGELOG.md", "SECURITY.md",
]);

// 6. ENTRY_POINT_FILES — entry point filenames by type
const ENTRY_POINT_FILES = [
  { names: ["cli.ts", "cli.js", "cli.mjs", "cli.py", "cli.rs", "cli.go"], type: "cli", reason: "cli entrypoint file" },
  { names: ["server.ts", "server.js", "server.py", "server.rs", "server.go"], type: "server", reason: "server entrypoint file" },
  { names: ["app.ts", "app.js", "app.py", "app.rs", "app.go"], type: "server", reason: "app entrypoint file" },
  { names: ["main.ts", "main.js", "main.mjs", "main.py", "main.rs", "main.go"], type: "cli", reason: "main entrypoint file" },
  { names: ["index.ts", "index.js", "index.mjs", "index.py"], type: "sdk", reason: "package index entrypoint" },
  { names: ["__main__.py"], type: "cli", reason: "Python __main__ entrypoint" },
];

const ENTRYPOINT_DIR_NAMES = new Set(["bin", "scripts", "examples", "example"]);

// 7. PROMPT_FILE_PATTERNS — glob patterns for prompt file discovery
const PROMPT_FILE_PATTERNS = [
  "**/*prompt*",
  "**/prompts/**",
  "**/*.prompt",
  "**/*.jinja",
  "**/*.mustache",
];

// 8. TEST_FILE_REGEXES — regex patterns for test file classification
const TEST_FILE_REGEXES = [
  { regex: /^test_.*\.py$|.*_test\.py$|^test.*\.py$/, lang: "python" },
  { regex: /\.test\.(ts|tsx|js|jsx)$/, lang: "javascript" },
  { regex: /\.spec\.(ts|tsx|js|jsx)$/, lang: "javascript" },
  { regex: /_test\.go$/, lang: "go" },
  { regex: /^Test.*\.java$|.*Test\.java$/, lang: "java" },
  { regex: /_test\.rs$/, lang: "rust" },
];

// 8b. TEST_DISCOVERY_PATTERNS — glob patterns for test directory/file discovery
const TEST_DISCOVERY_PATTERNS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/tests/**",
  "**/test/**",
  "**/e2e/**",
  "**/eval/**",
  "**/benchmark/**",
];

// 9. Content scanning patterns (regex-based, for specific analyzers)

const TEST_FUNCTION_REGEX = {
  python: /^\s*(def\s+test_|class\s+Test)/gm,
  javascript: /^\s*(it|test|describe)\s*\(/gm,
  go: /^\s*func\s+Test/gm,
  java: /^\s*(@Test|void\s+test)/gm,
  rust: /^\s*#\[test\]/gm,
};

const IMPORT_REGEX = {
  python: [
    /^\s*from\s+([\w.]+)\s+import/gm,
    /^\s*import\s+([\w.]+)/gm,
  ],
  javascript: [
    /^\s*import\s+[^;]*?\s+from\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
    /^\s*require\s*\(\s*["']([^"']+)["']\s*\)/gm,
  ],
  rust: [
    /^\s*use\s+([\w:]+)/gm,
    /^\s*mod\s+(\w+)/gm,
  ],
  go: [
    /^\s*"([^"]+)"/gm,
  ],
};

// Prompt content markers (regex-based, for scanning file content)
const PROMPT_MARKERS = [
  { type: "system", regex: /\b(SYSTEM_PROMPT|system_prompt|systemPrompt|System\.Message|system_message)\b/g },
  { type: "assistant", regex: /\b(ASSISTANT_PROMPT|assistant_prompt|Assistant\.Message)\b/g },
  { type: "prompt", regex: /\b(prompt|PROMPT|build_prompt|render_prompt)\s*[:=]/g },
  { type: "template", regex: /\b(template|TEMPLATE|Template)\s*[:=]/g },
  { type: "few-shot", regex: /\b(few_shot|fewshot|few-shot)\b/g },
  { type: "template-variable", regex: /\{\{\s*(tool|history|memory|input|context|user)\s*\}\}/g },
];

// Tool registration patterns (regex-based)
const TOOL_PATTERNS = [
  { framework: "langchain", regex: /@tool\s*\n?\s*def\s+(\w+)/g },
  { framework: "langchain-py", regex: /@tool\s*\(?[^)]*\)?\s*\n\s*def\s+(\w+)/g },
  { framework: "openai", regex: /function\s*\(\s*["']?(\w+)["']?\s*,/g },
  { framework: "generic-tool-call", regex: /\btool\s*\(\s*["']?(\w+)["']?/g },
  { framework: "generic-Tool", regex: /\bTool\s*\(\s*["']?(\w+)["']?/g },
  { framework: "agent.tool", regex: /@agent\.tool\s*\n?\s*def\s+(\w+)/g },
  { framework: "langgraph-ToolNode", regex: /ToolNode\s*\(\s*\[([^\]]*)\]/g },
  { framework: "fastmcp-server.tool", regex: /server\.tool\s*\(\s*\)?\s*["']?(\w+)["']?/g },
  { framework: "mcp-tool", regex: /@mcp\.tool\s*\n?\s*(?:async\s+)?def\s+(\w+)/g },
  { framework: "mcp-server-tool", regex: /@server\.tool\s*\n?\s*(?:async\s+)?def\s+(\w+)/g },
  { framework: "typescript-tool", regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*:\s*(?:Promise<)?Tool/g },
];

// Schema-first tool detection: files that declare tool arrays typed as ToolDef[] / Tool[]
// (common in MCP servers). We detect the type annotation first, then extract `name: '...'`
// values from the same file. This avoids false positives from generic `name:` properties.
const SCHEMA_FIRST_TOOL_TYPE_PATTERN =
  /\b(?:ToolDef|BaseToolDef|PublicToolShape|ToolRegistry)\b|\bTool\[\]/;

// Evaluation patterns
const EVAL_KEYWORDS = [
  "eval", "evaluation", "benchmark", "golden", "judge", "rubric",
  "dataset", "score", "pass_rate", "accuracy", "metric", "leaderboard",
];
const EVAL_DIR_NAMES = new Set(["eval", "evals", "benchmark", "benchmarks", "evaluation", "evaluations", "tests-eval"]);

// CI file locations (detailed, for CI analyzer — includes provider info)
const CI_FILES = [
  { path: join(".github", "workflows"), provider: "github-actions", type: "dir" },
  { path: ".gitlab-ci.yml", provider: "gitlab-ci", type: "file" },
  { path: "azure-pipelines.yml", provider: "azure-pipelines", type: "file" },
  { path: "azure-pipelines.yaml", provider: "azure-pipelines", type: "file" },
  { path: ".circleci", provider: "circleci", type: "dir" },
  { path: "Jenkinsfile", provider: "jenkins", type: "file" },
  { path: ".buildkite", provider: "buildkite", type: "dir" },
  { path: ".buildkite.yml", provider: "buildkite", type: "file" },
  { path: "bitbucket-pipelines.yml", provider: "bitbucket-pipelines", type: "file" },
  { path: ".travis.yml", provider: "travis-ci", type: "file" },
];

// Optional packages
let fastGlob = null;
let simpleGit = null;
let yaml = null;

async function loadOptionalPackages() {
  try { fastGlob = (await import("fast-glob")).default; } catch { /* optional */ }
  try { simpleGit = (await import("simple-git")).simpleGit; } catch { /* optional */ }
  try { yaml = (await import("yaml")).default; } catch { /* optional */ }
}

// ---------------------------------------------------------------------------
// Tree-sitter (optional, for AST-based analysis)
// ---------------------------------------------------------------------------

let Parser = null;
let wasmDir = null;
const languageCache = new Map(); // ext -> Language
const parserCache = new Map(); // ext -> Parser instance
const parserPending = new Map(); // ext -> Promise<Parser|null> (dedup concurrent load)
const treeCache = new Map(); // filePath -> tree

/**
 * Map items with limited concurrency to avoid overwhelming the WASM runtime.
 * Tree-sitter's WASM runtime is not safe under high concurrency — concurrent
 * parse calls can trigger "Aborted()" / "memory access out of bounds" crashes
 * that corrupt the runtime for all subsequent operations.
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        // Catch WASM crashes that throw RuntimeError; return null for this item.
        results[i] = null;
      }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

const TS_LANG_MAP = {
  ".py": "tree-sitter-python.wasm",
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
  ".mjs": "tree-sitter-javascript.wasm",
  ".cjs": "tree-sitter-javascript.wasm",
  ".rs": "tree-sitter-rust.wasm",
  ".go": "tree-sitter-go.wasm",
  ".java": "tree-sitter-java.wasm",
};

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const FUNCTION_NODE_TYPES = new Set([
  "function_definition", "function_declaration", "function_item", "method_declaration",
]);
const CLASS_NODE_TYPES = new Set(["class_definition", "class_declaration"]);

/**
 * Find the nearest node_modules directory by walking up from a starting path.
 * This allows the script to work when copied to a working folder subdirectory.
 */
function findNodeModules() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [scriptDir, process.cwd()];
  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 15; i++) {
      const nm = join(dir, "node_modules");
      if (existsSync(nm)) return nm;
      const parent = dirname(dir);
      if (parent === dir) break; // reached root
      dir = parent;
    }
  }
  return null;
}

// ===========================================================================
// RepositoryContext — shared analysis context for all analyzers
//
// Centralizes file tree traversal, AST parsing, content caching, manifest
// discovery, and git metadata. Every Analyzer receives the same context,
// eliminating duplicated `walkDir`, `readFileSync`, and Tree-sitter parses.
// ===========================================================================

class RepositoryContext {
  /**
   * @param {string} repoPath — absolute path to the repository root
   * @param {object} [options]
   * @param {number} [options.maxDepth=8] — max traversal depth
   */
  constructor(repoPath, options = {}) {
    this.repoPath = repoPath;
    this.options = { maxDepth: 8, ...options };
    this.nodeModulesDir = findNodeModules();
    this.changedFiles = options.changedFiles ?? null;
    this.lang = options.lang || null;

    // Lazy caches
    this._entries = null;
    this._files = null;
    this._filteredFiles = null;
    this._dirs = null;
    this._contentCache = new Map();
    this._astCache = new Map();
    this._manifest = undefined;
    this._gitInfo = null;
    this._isGitRepo = null;
  }

  // -------------------------------------------------------------------------
  // File system access
  // -------------------------------------------------------------------------

  /** All entries (files + dirs) discovered under the repo root. */
  get entries() {
    if (this._entries === null) {
      this._entries = walkDir(this.repoPath, this.options.maxDepth);
    }
    return this._entries;
  }

  /** All file entries (not affected by changedFiles filter). */
  get allFiles() {
    if (this._files === null) {
      this._files = this.entries.filter((e) => e.type === "file");
    }
    return this._files;
  }

  /** File entries only. If changedFiles is set, only files in changedFiles are returned. */
  get files() {
    if (this.changedFiles && this.changedFiles.size > 0) {
      if (this._filteredFiles === null) {
        this._filteredFiles = this.allFiles.filter((f) =>
          this.changedFiles.has(this.rel(f.path))
        );
      }
      return this._filteredFiles;
    }
    return this.allFiles;
  }

  /** Directory entries only. */
  get dirs() {
    if (this._dirs === null) {
      this._dirs = this.entries.filter((e) => e.type === "dir");
    }
    return this._dirs;
  }

  /** All source code files (not affected by changedFiles filter). */
  get allSourceFiles() {
    return this.allFiles.filter((f) => SOURCE_EXTENSIONS.has(f.ext));
  }

  /** Source code files only (extensions in SOURCE_EXTENSIONS). */
  get sourceFiles() {
    return this.files.filter((f) => SOURCE_EXTENSIONS.has(f.ext));
  }

  /** Absolute path of a relative path inside the repository. */
  resolve(relPath) {
    return join(this.repoPath, relPath);
  }

  /** Relative path from an absolute path inside the repository. */
  rel(absolutePath) {
    return relative(this.repoPath, absolutePath);
  }

  /** Read file content safely, cached. */
  readFile(relPath) {
    if (this._contentCache.has(relPath)) return this._contentCache.get(relPath);
    const content = readFileSafe(join(this.repoPath, relPath));
    this._contentCache.set(relPath, content);
    return content;
  }

  /** Read absolute file path safely. */
  readFileAbsolute(absolutePath) {
    const relPath = relative(this.repoPath, absolutePath);
    return this.readFile(relPath);
  }

  /** Check if a relative path exists inside the repo. */
  exists(relPath) {
    return existsSync(join(this.repoPath, relPath));
  }

  // -------------------------------------------------------------------------
  // Manifest / language
  // -------------------------------------------------------------------------

  /** Detected project manifest (the highest-priority manifest rule wins). */
  get manifest() {
    if (this._manifest === undefined) {
      this._manifest = this._detectManifest();
    }
    return this._manifest;
  }

  _detectManifest() {
    const manifestRules = PROJECT_DISCOVERY_RULES
      .filter((r) => r.category === "manifest" && r.parser)
      .sort((a, b) => b.priority - a.priority);
    for (const m of manifestRules) {
      const fullPath = join(this.repoPath, m.file);
      if (!existsSync(fullPath)) continue;
      try {
        const content = readFileSync(fullPath, "utf-8");
        return { language: m.language, entry: m.file, ...m.parser(content) };
      } catch {
        return { language: m.language, entry: m.file, name: "unknown", version: "unknown" };
      }
    }
    return null;
  }

  /** Primary programming language of the repository. */
  get language() {
    return this.manifest?.language ?? this._inferLanguage();
  }

  _inferLanguage() {
    const counts = countByExtension(this.files);
    const ranked = Object.entries(counts)
      .filter(([ext]) => SOURCE_EXTENSIONS.has(ext))
      .sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return "unknown";
    const topExt = ranked[0][0];
    for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
      if (exts.includes(topExt)) return lang;
    }
    return "unknown";
  }

  // -------------------------------------------------------------------------
  // Tree-sitter AST access
  // -------------------------------------------------------------------------

  /**
   * Parse a file with Tree-sitter and return its AST.
   * Results are cached by absolute path.
   */
  async parseAST(filePath) {
    await initTreeSitter();
    if (this._astCache.has(filePath)) return this._astCache.get(filePath);
    const tree = await parseFileAST(filePath);
    this._astCache.set(filePath, tree);
    return tree;
  }

  /** Parse a file identified by its repo-relative path. */
  async parseRelAST(relPath) {
    return this.parseAST(join(this.repoPath, relPath));
  }

  // -------------------------------------------------------------------------
  // Git helpers
  // -------------------------------------------------------------------------

  get isGitRepo() {
    if (this._isGitRepo === null) {
      this._isGitRepo = git(this.repoPath, "rev-parse", "--is-inside-work-tree")
        .trim() === "true";
    }
    return this._isGitRepo;
  }

  /** Run a git subcommand inside the repository. */
  git(...args) {
    return git(this.repoPath, ...args);
  }

  // -------------------------------------------------------------------------
  // Discovery helpers
  // -------------------------------------------------------------------------

  /** Test files discovered via filename regex patterns. */
  get testFiles() {
    return this.files.filter((f) => isTestFile(f.name));
  }

  /** Files inside directories named as architecture signals. */
  get architectureSignalFiles() {
    return this.files.filter((f) => {
      const parts = relative(this.repoPath, f.path).split(sep);
      return parts.some((p) => ARCHITECTURE_SIGNAL_DIRS.has(p.toLowerCase()));
    });
  }
}

// ===========================================================================
// Analyzer Interface — all analyzers implement this contract
//
// Pluggable design: a new analyzer only needs to implement the interface and
// be registered in the ANALYZERS array. The AnalyzerPipeline handles dispatch.
// ===========================================================================

/**
 * @typedef {Object} AnalyzerContext
 * @property {string} command — current command name (for phase output)
 */

/**
 * Base analyzer class. Subclasses override `supports()` and `analyze()`.
 */
class BaseAnalyzer {
  /** Analyzer id, e.g. "discovery" */
  get id() {
    throw new Error("Analyzer must define id");
  }

  /**
   * Return true if this analyzer applies to the given repository.
   * Override to gate analyzers by manifest language, file existence, etc.
   */
  supports(_ctx) {
    return true;
  }

  /**
   * Run analysis and write results into the evidence store.
   * @param {RepositoryContext} ctx
   * @param {Record<string, unknown>} store — evidence store object
   * @param {AnalyzerContext} analyzerCtx
   */
  async analyze(_ctx, _store, _analyzerCtx) {
    throw new Error(`Analyzer ${_ctx?.id} must implement analyze()`);
  }
}

async function initTreeSitter() {
  if (Parser) return Parser;
  try {
    // Find node_modules by walking up from script location and cwd.
    // This supports both running from project root and from a working folder.
    const nodeModulesDir = findNodeModules();
    if (!nodeModulesDir) return null;

    // Pre-check: verify WASM runtime file exists before init,
    // so we don't trigger Emscripten's noisy stdout output on missing files.
    const wasmRuntimePath = join(nodeModulesDir, "web-tree-sitter", "tree-sitter.wasm");
    if (!existsSync(wasmRuntimePath)) return null;

    const wasmsPkgPath = join(nodeModulesDir, "tree-sitter-wasms", "out");
    if (!existsSync(wasmsPkgPath)) return null;

    const mod = await import("web-tree-sitter");
    const parserCtor = mod.default || mod.Parser || mod;
    await parserCtor.init({
      locateFile: (filename) =>
        pathToFileURL(join(nodeModulesDir, "web-tree-sitter", filename)).href,
    });
    // Only set module-level Parser after successful init
    Parser = parserCtor;
    wasmDir = wasmsPkgPath;
    return Parser;
  } catch (e) {
    console.error("Tree-sitter not available, falling back to regex:", e.message);
    return null;
  }
}

async function getParserForFile(filePath) {
  if (!Parser || !wasmDir) return null;
  const ext = extname(filePath);
  if (parserCache.has(ext)) return parserCache.get(ext);
  // Dedup: if a load is already in-flight for this extension, await it.
  if (parserPending.has(ext)) return parserPending.get(ext);

  const wasmFile = TS_LANG_MAP[ext];
  if (!wasmFile) return null;
  const wasmPath = join(wasmDir, wasmFile);
  if (!existsSync(wasmPath)) return null;

  const pending = (async () => {
    try {
      const Language = Parser.Language;
      const language = await Language.load(wasmPath);
      const parser = new Parser();
      parser.setLanguage(language);
      parserCache.set(ext, parser);
      return parser;
    } catch {
      return null;
    } finally {
      parserPending.delete(ext);
    }
  })();

  parserPending.set(ext, pending);
  return pending;
}

async function parseFileAST(filePath) {
  if (treeCache.has(filePath)) return treeCache.get(filePath);
  const parser = await getParserForFile(filePath);
  if (!parser) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    const tree = parser.parse(content);
    // Touch rootNode to trigger WASM errors early (within try-catch).
    // Some files cause "memory access out of bounds" at rootNode access.
    const _root = tree.rootNode;
    treeCache.set(filePath, tree);
    return tree;
  } catch {
    return null;
  }
}

// --- AST traversal utilities ---

function walkAST(node, visitor, parentStack) {
  visitor(node, parentStack || []);
  const newStack = (parentStack || []).concat(node);
  for (const child of node.children) {
    walkAST(child, visitor, newStack);
  }
}

function findChild(node, type) {
  return node.children.find((c) => c.type === type);
}

function findChildren(node, type) {
  return node.children.filter((c) => c.type === type);
}

function stripStringQuotes(s) {
  return s.replace(/^["'`]|["'`]$/g, "");
}

function findEnclosingFuncName(parentStack) {
  for (let i = parentStack.length - 1; i >= 0; i--) {
    if (FUNCTION_NODE_TYPES.has(parentStack[i].type)) {
      const id = findChild(parentStack[i], "identifier");
      if (id) return id.text;
    }
  }
  return null;
}

function extractFunctionParams(funcNode) {
  const params = [];
  const paramsNode =
    findChild(funcNode, "parameters") ||
    findChild(funcNode, "formal_parameters") ||
    findChild(funcNode, "parameter_list");
  if (!paramsNode) return params;
  for (const child of paramsNode.children) {
    if (
      child.type === "identifier" ||
      child.type === "typed_parameter" ||
      child.type === "parameter" ||
      child.type === "required_parameter" ||
      child.type === "optional_parameter"
    ) {
      const id = findChild(child, "identifier") ||
        (child.type === "identifier" ? child : null);
      if (id) params.push(id.text);
    }
  }
  return params;
}

function getDecoratorsFromParent(parentStack) {
  const decos = [];
  const parent = parentStack[parentStack.length - 1];
  if (parent && parent.type === "decorated_definition") {
    for (const child of parent.children) {
      if (child.type === "decorator") decos.push(child.text.trim());
    }
  }
  return decos;
}

// --- AST-based extractors (return null if AST unavailable) ---

/** Extract import module strings from AST. Returns string[] or null. */
async function extractImportsAST(filePath, tree = null) {
  if (!tree) tree = await parseFileAST(filePath);
  if (!tree) return null;
  const ext = extname(filePath);
  const isJs = JS_EXTS.includes(ext);
  const imports = [];

  walkAST(tree.rootNode, (node) => {
    if (ext === ".py") {
      if (node.type === "import_from_statement") {
        const mod = findChild(node, "dotted_name");
        if (mod) imports.push(mod.text);
      } else if (node.type === "import_statement") {
        for (const child of node.children) {
          if (child.type === "dotted_name") imports.push(child.text);
        }
      }
    } else if (isJs) {
      if (node.type === "import_statement") {
        const str = findChild(node, "string");
        if (str) imports.push(stripStringQuotes(str.text));
      } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
        for (const decl of findChildren(node, "variable_declarator")) {
          const call = findChild(decl, "call_expression");
          if (call) {
            const fn = findChild(call, "identifier");
            if (fn && fn.text === "require") {
              const args = findChild(call, "arguments");
              if (args) {
                const str = findChild(args, "string");
                if (str) imports.push(stripStringQuotes(str.text));
              }
            }
          }
        }
      }
    } else if (ext === ".rs") {
      if (node.type === "use_declaration") {
        const text = node.text.replace(/^use\s+/, "").replace(/;$/, "");
        if (text) imports.push(text);
      }
    } else if (ext === ".go") {
      if (node.type === "import_declaration") {
        for (const child of node.children) {
          if (child.type === "interpreted_string_literal") {
            imports.push(stripStringQuotes(child.text));
          } else if (child.type === "import_spec_list") {
            for (const spec of findChildren(child, "import_spec")) {
              const str = findChild(spec, "interpreted_string_literal");
              if (str) imports.push(stripStringQuotes(str.text));
            }
          }
        }
      }
    }
  });

  return [...new Set(imports)];
}

/** Extract prompt-like assignments from AST. Returns array or null. */
async function extractPromptsAST(filePath, repoPath, tree = null) {
  if (!tree) tree = await parseFileAST(filePath);
  if (!tree) return null;
  const ext = extname(filePath);
  const isPy = ext === ".py";
  const isJs = JS_EXTS.includes(ext);
  const relPath = relative(repoPath, filePath);
  const prompts = [];

  walkAST(tree.rootNode, (node) => {
    let name = null;
    let valueNode = null;

    if (isPy && node.type === "assignment") {
      const left = node.children[0];
      if (left && left.type === "identifier") {
        name = left.text;
        valueNode = node.children.find(
          (c) => c.type === "string" || c.type === "concatenated_string"
        );
      }
    } else if (isJs && node.type === "variable_declarator") {
      const id = findChild(node, "identifier");
      if (id) {
        name = id.text;
        valueNode = node.children.find(
          (c) => c.type === "string" || c.type === "template_string"
        );
      }
    }

    if (name && valueNode) {
      const upper = name.toUpperCase();
      const lower = name.toLowerCase();
      let type = null;
      if (upper.includes("SYSTEM_PROMPT") || upper.includes("SYSTEM_MESSAGE")) type = "system";
      else if (upper.includes("ASSISTANT")) type = "assistant";
      else if (lower.includes("prompt")) type = "prompt";
      else if (lower.includes("template")) type = "template";
      else if (upper.includes("FEW_SHOT") || upper.includes("FEWSHOT") || upper.includes("INSTRUCTION")) type = "few-shot";

      if (type) {
        prompts.push({
          file: relPath,
          line: node.startPosition.row + 1,
          type,
          snippet: node.text.trim().slice(0, 200),
        });
      }
    }

    // Template strings with {{variables}} (JS)
    if (isJs && node.type === "template_string") {
      const text = node.text;
      if (/\{\{\s*(tool|history|memory|input|context|user)\s*\}\}/.test(text)) {
        prompts.push({
          file: relPath,
          line: node.startPosition.row + 1,
          type: "template-variable",
          snippet: text.trim().slice(0, 200),
        });
      }
    }
  });

  return prompts;
}

/** Extract tool registrations from AST. Returns array or null. */
async function extractToolsAST(filePath, repoPath, tree = null) {
  if (!tree) tree = await parseFileAST(filePath);
  if (!tree) return null;
  const relPath = relative(repoPath, filePath);
  const tools = [];

  walkAST(tree.rootNode, (node) => {
    if (node.type === "decorated_definition") {
      const decorator = findChild(node, "decorator");
      if (!decorator) return;
      let decoName = "";
      const idChild = decorator.children.find(
        (c) => c.type === "identifier" || c.type === "attribute" || c.type === "call"
      );
      if (idChild) decoName = idChild.text;

      const lower = decoName.toLowerCase();
      let framework = null;
      if (decoName === "tool") framework = "langchain";
      else if (decoName === "agent.tool") framework = "agent.tool";
      else if (decoName === "mcp.tool") framework = "mcp-tool";
      else if (decoName === "server.tool") framework = "mcp-server-tool";
      else if (lower.includes("tool")) framework = "decorator-tool";

      if (framework) {
        const funcDef = findChild(node, "function_definition");
        const classDef = findChild(node, "class_definition");
        const classDecl = findChild(node, "class_declaration");
        const funcDecl = findChild(node, "function_declaration");
        const target = funcDef || classDef || classDecl || funcDecl;
        if (target) {
          const id = findChild(target, "identifier");
          if (id) {
            tools.push({ name: id.text, file: relPath, framework, schema: null });
          }
        }
      }
    }

    // Class declarations/definitions with names ending in "Tool"
    if (CLASS_NODE_TYPES.has(node.type)) {
      const id = findChild(node, "identifier");
      if (id && id.text.endsWith("Tool") && id.text !== "Tool") {
        tools.push({ name: id.text, file: relPath, framework: "class-Tool", schema: null });
      }
    }
  });

  return tools;
}

/** Extract entrypoint signals from AST. Returns array or null. */
async function extractEntrypointsAST(filePath, repoPath, tree = null) {
  if (!tree) tree = await parseFileAST(filePath);
  if (!tree) return null;
  const ext = extname(filePath);
  const isPy = ext === ".py";
  const isJs = JS_EXTS.includes(ext);
  const relPath = relative(repoPath, filePath);
  const signals = [];

  walkAST(tree.rootNode, (node) => {
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      const id = findChild(node, "identifier");
      if (id && ["main", "cli", "serve", "start"].includes(id.text)) {
        signals.push({
          path: relPath,
          type: id.text === "serve" ? "server" : "cli",
          reason: `${ext} function: ${id.text}() (AST)`,
        });
      }
    }

    if (isPy && node.type === "if_statement") {
      const text = node.text;
      if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(text)) {
        signals.push({
          path: relPath,
          type: "cli",
          reason: "Python __main__ guard (AST)",
        });
      }
    }

    if (isJs && node.type === "export_statement") {
      const hasDefault = node.children.some((c) => c.type === "default");
      if (hasDefault) {
        const funcDecl = findChild(node, "function_declaration");
        if (funcDecl) {
          const id = findChild(funcDecl, "identifier");
          if (id) {
            signals.push({
              path: relPath,
              type: "sdk",
              reason: `JS export default function: ${id.text}() (AST)`,
            });
          }
        }
      }
    }
  });

  return signals;
}

/** Extract full symbol index from a file via AST. Returns object or null. */
async function extractSymbolsAST(filePath, repoPath, tree = null) {
  if (!tree) tree = await parseFileAST(filePath);
  if (!tree) return null;
  const ext = extname(filePath);
  const isPy = ext === ".py";
  const isJs = JS_EXTS.includes(ext);
  const isRs = ext === ".rs";
  const isGo = ext === ".go";
  const relPath = relative(repoPath, filePath);

  const functions = [];
  const classes = [];
  const imports = [];
  const calls = [];
  const strings = [];

  walkAST(tree.rootNode, (node, parentStack) => {
    // --- Imports ---
    if (isPy) {
      if (node.type === "import_from_statement") {
        const mod = findChild(node, "dotted_name");
        const whatNodes = node.children.filter((c) => c.type === "dotted_name").slice(1);
        const what = whatNodes.map((n) => n.text).join(", ") || "*";
        imports.push({ file: relPath, what, from: mod ? mod.text : "" });
      } else if (node.type === "import_statement") {
        for (const child of node.children) {
          if (child.type === "dotted_name") {
            imports.push({ file: relPath, what: child.text, from: "" });
          }
        }
      }
    } else if (isJs && node.type === "import_statement") {
      const str = findChild(node, "string");
      const from = str ? stripStringQuotes(str.text) : "";
      const importClause = findChild(node, "import_clause");
      const what = importClause ? importClause.text : "*";
      imports.push({ file: relPath, what, from });
    } else if (isRs && node.type === "use_declaration") {
      const text = node.text.replace(/^use\s+/, "").replace(/;$/, "");
      imports.push({ file: relPath, what: text, from: "" });
    } else if (isGo && node.type === "import_declaration") {
      for (const child of node.children) {
        if (child.type === "interpreted_string_literal") {
          imports.push({ file: relPath, what: stripStringQuotes(child.text), from: "" });
        } else if (child.type === "import_spec_list") {
          for (const spec of findChildren(child, "import_spec")) {
            const str = findChild(spec, "interpreted_string_literal");
            if (str) imports.push({ file: relPath, what: stripStringQuotes(str.text), from: "" });
          }
        }
      }
    }

    // --- Functions ---
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      const id = findChild(node, "identifier");
      if (id) {
        functions.push({
          name: id.text,
          file: relPath,
          line: node.startPosition.row + 1,
          params: extractFunctionParams(node),
          decorators: getDecoratorsFromParent(parentStack),
        });
      }
    }

    // --- Classes ---
    if (CLASS_NODE_TYPES.has(node.type)) {
      const id = findChild(node, "identifier");
      if (id) {
        const bases = [];
        if (isPy) {
          const argList = findChild(node, "argument_list");
          if (argList) {
            for (const child of argList.children) {
              if (child.type === "identifier" || child.type === "attribute") bases.push(child.text);
            }
          }
        } else {
          const heritage = findChild(node, "class_heritage");
          if (heritage) {
            for (const child of heritage.children) {
              if (child.type === "identifier" || child.type === "member_expression") bases.push(child.text);
            }
          }
        }
        const methods = [];
        const body = findChild(node, "block") || findChild(node, "class_body");
        if (body) {
          for (const child of body.children) {
            if (FUNCTION_NODE_TYPES.has(child.type)) {
              const methodId = findChild(child, "identifier");
              if (methodId) methods.push(methodId.text);
            }
          }
        }
        classes.push({
          name: id.text,
          file: relPath,
          line: node.startPosition.row + 1,
          bases,
          methods,
        });
      }
    }

    // --- Calls ---
    const callType = isPy ? "call" : "call_expression";
    if (node.type === callType) {
      const fnNode = node.children.find(
        (c) => c.type === "identifier" || c.type === "attribute" || c.type === "member_expression"
      );
      // Compress callee: strip argument lists from chained calls to keep only
      // the function path (e.g., "json.dumps(body, ...).encode" → "json.dumps.encode").
      // Full call expression can be recovered from source at the given line.
      const calleeRaw = fnNode ? fnNode.text : null;
      const callee = calleeRaw ? calleeRaw.replace(/\s*\([^)]*\)/g, "") : null;
      const caller = findEnclosingFuncName(parentStack);
      if (callee) {
        calls.push({ file: relPath, line: node.startPosition.row + 1, caller, callee });
      }
    }

    // --- String assignments (prompts/templates/constants) ---
    if (isPy && node.type === "assignment") {
      const left = node.children[0];
      const right = node.children.find(
        (c) => c.type === "string" || c.type === "concatenated_string"
      );
      if (left && left.type === "identifier" && right) {
        const name = left.text;
        const upper = name.toUpperCase();
        const lower = name.toLowerCase();
        if (
          upper.includes("PROMPT") ||
          upper.includes("SYSTEM") ||
          lower.includes("template") ||
          (upper === name && name.length > 4)
        ) {
          strings.push({
            file: relPath,
            line: node.startPosition.row + 1,
            name,
            length: right.text.length,
          });
        }
      }
    } else if (isJs && node.type === "variable_declarator") {
      const id = findChild(node, "identifier");
      const val = node.children.find(
        (c) => c.type === "string" || c.type === "template_string"
      );
      if (id && val) {
        const name = id.text;
        const upper = name.toUpperCase();
        const lower = name.toLowerCase();
        if (
          upper.includes("PROMPT") ||
          upper.includes("SYSTEM") ||
          lower.includes("template") ||
          (upper === name && name.length > 4)
        ) {
          strings.push({
            file: relPath,
            line: node.startPosition.row + 1,
            name,
            length: val.text.length,
          });
        }
      }
    }
  });

  return { functions, classes, imports, calls, strings };
}

// ---------------------------------------------------------------------------
// Generic file walking utilities
// ---------------------------------------------------------------------------

/**
 * Recursively walk a directory, returning {path, type, ext, depth} entries.
 * Honors IGNORED_DIRS. Max depth guards deep traversals.
 */
function walkDir(dir, maxDepth = 8, currentDepth = 0, results = []) {
  if (currentDepth >= maxDepth) return results;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push({ path: fullPath, type: "dir", depth: currentDepth });
      walkDir(fullPath, maxDepth, currentDepth + 1, results);
    } else if (entry.isFile()) {
      results.push({
        path: fullPath,
        type: "file",
        depth: currentDepth,
        ext: extname(entry.name),
        name: entry.name,
      });
    }
  }
  return results;
}

/** Walk and return only file entries (with name/ext). */
function walkFiles(dir, maxDepth = 8) {
  return walkDir(dir, maxDepth).filter((e) => e.type === "file");
}

/** Read file content safely, returns "" on error. */
function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Convert a relative path to a dotted module id. */
function pathToModuleId(relPath) {
  return relPath
    .replace(/\.(py|ts|tsx|js|jsx|mjs|cjs|rs|go)$/, "")
    .split(sep)
    .join(".");
}

/** Normalize an import string to a candidate target module id. */
function normalizeImportToId(imp, fromRelPath) {
  // Strip leading @scope/ for JS packages
  let s = imp.replace(/^@[\w-]+\//, "");
  // Relative imports: resolve against current file's directory
  if (s.startsWith("./") || s.startsWith("../")) {
    const baseDir = dirname(fromRelPath);
    const resolved = join(baseDir, s).replace(/^\.\//, "");
    return resolved
      .replace(/\.(py|ts|tsx|js|jsx|mjs|cjs|rs|go)$/, "")
      .split(sep)
      .join(".");
  }
  // Bare JS import: use last segment as candidate module id
  s = s.replace(/\.(py|ts|tsx|js|jsx|mjs|cjs|rs|go)$/, "");
  // For Python "from foo.bar import baz" → keep full dotted path
  if (s.includes(".")) return s;
  // For JS "lodash/get" → "get"
  if (s.includes("/")) s = s.split("/").pop();
  return s;
}

/** Count files by extension. */
function countByExtension(files) {
  const counts = {};
  for (const f of files) {
    const ext = f.ext || "(no ext)";
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Manifest Parsers
// ---------------------------------------------------------------------------

/** Parse package.json into a manifest. */
function parsePackageJson(content) {
  const pkg = JSON.parse(content);
  return {
    name: pkg.name || "unknown",
    version: pkg.version || "unknown",
    entry: pkg.main || pkg.module || pkg.exports?.["."] || "package.json",
    scripts: Object.keys(pkg.scripts || {}),
    dependencies: Object.keys(pkg.dependencies || {}),
    devDependencies: Object.keys(pkg.devDependencies || {}),
  };
}

/** Parse pyproject.toml into a manifest (minimal regex-based TOML reader). */
function parsePyproject(content) {
  const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
  const versionMatch = content.match(/^version\s*=\s*"([^"]+)"/m);
  // scripts under [project.scripts] or [tool.poetry.scripts]
  const scripts = [];
  const scriptRe = /^([A-Za-z_][\w-]*)\s*=\s*["']?([^\s"']+)["']?/gm;
  let inScripts = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*\[project\.scripts\]/.test(line) || /^\s*\[tool\.poetry\.scripts\]/.test(line) || /^\s*\[project\.entry-points\.[\w.-]+\]/.test(line)) {
      inScripts = true;
      continue;
    }
    if (/^\s*\[/.test(line)) {
      inScripts = false;
      continue;
    }
    if (inScripts) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*=\s*["']?([^\s"']+)["']?/);
      if (m) scripts.push(m[1]);
    }
  }
  // dependencies under [project] dependencies = [...] or [tool.poetry.dependencies]
  const dependencies = [];
  const depBlockMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depBlockMatch) {
    const items = depBlockMatch[1].match(/"([^"]+)"/g) || [];
    for (const item of items) {
      dependencies.push(item.replace(/"/g, "").split(/[><=~!]/)[0].trim());
    }
  }
  const poetryDepsMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|\n$|$)/);
  if (poetryDepsMatch) {
    for (const line of poetryDepsMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*=/);
      if (m && m[1] !== "python") dependencies.push(m[1]);
    }
  }
  return {
    name: nameMatch ? nameMatch[1] : "unknown",
    version: versionMatch ? versionMatch[1] : "unknown",
    entry: "pyproject.toml",
    scripts,
    dependencies,
  };
}

/** Parse setup.py minimally. */
function parseSetupPy(content) {
  const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
  const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
  return {
    name: nameMatch ? nameMatch[1] : "unknown",
    version: versionMatch ? versionMatch[1] : "unknown",
    entry: "setup.py",
    scripts: [],
    dependencies: [],
  };
}

/** Parse setup.cfg minimally. */
function parseSetupCfg(content) {
  const nameMatch = content.match(/^name\s*=\s*(.+)/m);
  const versionMatch = content.match(/^version\s*=\s*(.+)/m);
  const dependencies = [];
  const depMatch = content.match(/\[options\][\s\S]*?install_requires\s*=\s*\n([\s\S]*?)(\n\[|\n$|$)/);
  if (depMatch) {
    for (const line of depMatch[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][\w.-]+)/);
      if (m) dependencies.push(m[1]);
    }
  }
  return {
    name: nameMatch ? nameMatch[1].trim() : "unknown",
    version: versionMatch ? versionMatch[1].trim() : "unknown",
    entry: "setup.cfg",
    scripts: [],
    dependencies,
  };
}

/** Parse requirements.txt minimally. */
function parseRequirementsTxt(content) {
  const dependencies = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const pkgName = trimmed.split(/[><=~!@;\s]/)[0];
    if (pkgName) dependencies.push(pkgName);
  }
  return {
    name: "unknown",
    version: "unknown",
    entry: "requirements.txt",
    scripts: [],
    dependencies,
  };
}

/** Parse Cargo.toml minimally. */
function parseCargoToml(content) {
  const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
  const versionMatch = content.match(/^version\s*=\s*"([^"]+)"/m);
  const dependencies = [];
  const depMatch = content.match(/\[dependencies\]([\s\S]*?)(\n\[|\n$|$)/);
  if (depMatch) {
    for (const line of depMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*=/);
      if (m) dependencies.push(m[1]);
    }
  }
  return {
    name: nameMatch ? nameMatch[1] : "unknown",
    version: versionMatch ? versionMatch[1] : "unknown",
    entry: "Cargo.toml",
    scripts: [],
    dependencies,
  };
}

/** Parse go.mod minimally. */
function parseGoMod(content) {
  const moduleMatch = content.match(/^module\s+(\S+)/m);
  const goMatch = content.match(/^go\s+(\S+)/m);
  const dependencies = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.\-/]+)\s+v[\w.-]+/);
    if (m && !m[1].startsWith("module") && !m[1].startsWith("go ")) dependencies.push(m[1]);
  }
  return {
    name: moduleMatch ? moduleMatch[1] : "unknown",
    version: goMatch ? goMatch[1] : "unknown",
    entry: "go.mod",
    scripts: [],
    dependencies,
  };
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** Return true if filename matches a known test pattern. */
function isTestFile(fileName) {
  return TEST_FILE_REGEXES.some((p) => p.regex.test(fileName));
}

/** Find test files among walked entries. */
function findTestFiles(files) {
  return files.filter((f) => isTestFile(basename(f.path)));
}

/** Detect qualitative test patterns (poison, regression, golden, etc.). */
function detectTestPatterns(testFiles) {
  const patterns = new Set();
  for (const f of testFiles) {
    const name = basename(f.path).toLowerCase();
    if (name.includes("poison")) patterns.add("poison");
    if (name.includes("regression")) patterns.add("regression");
    if (name.includes("golden")) patterns.add("golden");
    if (name.includes("snapshot")) patterns.add("snapshot");
    if (name.includes("replay")) patterns.add("replay");
    if (name.includes("e2e")) patterns.add("e2e");
    if (name.includes("integration")) patterns.add("integration");
    if (name.includes("stress")) patterns.add("stress");
    if (name.includes("benchmark") || name.includes("bench")) patterns.add("benchmark");
    const content = readFileSafe(f.path);
    if (/fixture|corpus/i.test(content)) patterns.add("corpus");
    if (/verify_kit|verify-kit/i.test(content)) patterns.add("verify-kit");
  }
  return [...patterns];
}

/** Categorize a test file as unit/integration/e2e by path. */
function categorizeTestCategory(filePath) {
  const parts = filePath.split(sep).map((p) => p.toLowerCase());
  if (parts.some((p) => p.includes("e2e"))) return "e2e";
  if (parts.some((p) => p.includes("integration"))) return "integration";
  return "unit";
}

/** Categorize a test file by source module. */
function categorizeTestModule(filePath, repoPath) {
  const rel = relative(repoPath, filePath);
  const parts = rel.split(sep);
  for (const part of parts) {
    if (part.startsWith("test_") || part.endsWith("_test") || part.includes(".test.") || part.includes(".spec.")) {
      const mod = part
        .replace(/^test_/, "")
        .replace(/_test$/, "")
        .replace(/\.test\.(ts|tsx|js|jsx)$/, "")
        .replace(/\.spec\.(ts|tsx|js|jsx)$/, "")
        .replace(/\.py$/, "")
        .replace(/\.go$/, "");
      return mod || "unknown";
    }
  }
  return parts[parts.length - 2] || "unknown";
}

/** Count test functions in a file by language. */
function countTestFunctions(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return 0;
  const ext = extname(filePath);
  let regex;
  if (ext === ".py") regex = TEST_FUNCTION_REGEX.python;
  else if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) regex = TEST_FUNCTION_REGEX.javascript;
  else if (ext === ".go") regex = TEST_FUNCTION_REGEX.go;
  else if (ext === ".java") regex = TEST_FUNCTION_REGEX.java;
  else if (ext === ".rs") regex = TEST_FUNCTION_REGEX.rust;
  else return 0;
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

/** Extract import identifiers from a source file. */
function parseImports(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return [];
  const ext = extname(filePath);
  let regexes;
  if (ext === ".py") regexes = IMPORT_REGEX.python;
  else if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) regexes = IMPORT_REGEX.javascript;
  else if (ext === ".rs") regexes = IMPORT_REGEX.rust;
  else if (ext === ".go") regexes = IMPORT_REGEX.go;
  else return [];

  const imports = [];
  for (const regex of regexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  return [...new Set(imports)];
}

// ---------------------------------------------------------------------------
// Graph algorithms (pure JS)
// ---------------------------------------------------------------------------

/** Compute in-degree for each node id from edges. */
function computeInDegree(nodeIds, edges) {
  const inDeg = {};
  for (const id of nodeIds) inDeg[id] = 0;
  for (const edge of edges) {
    if (inDeg[edge.to] !== undefined) inDeg[edge.to] += 1;
  }
  return inDeg;
}

/** Compute out-degree for each node id from edges. */
function computeOutDegree(nodeIds, edges) {
  const outDeg = {};
  for (const id of nodeIds) outDeg[id] = 0;
  for (const edge of edges) {
    if (outDeg[edge.from] !== undefined) outDeg[edge.from] += 1;
  }
  return outDeg;
}

/**
 * Compute simplified PageRank.
 * @param {string[]} nodeIds
 * @param {{from:string,to:string}[]} edges
 * @param {number} iterations default 20
 * @param {number} damping default 0.85
 * @returns {Record<string, number>}
 */
function computePageRank(nodeIds, edges, iterations = 20, damping = 0.85) {
  const N = nodeIds.length;
  if (N === 0) return {};
  let pr = {};
  for (const id of nodeIds) pr[id] = 1 / N;

  const outLinks = {};
  const inLinks = {};
  for (const id of nodeIds) {
    outLinks[id] = [];
    inLinks[id] = [];
  }
  for (const edge of edges) {
    if (outLinks[edge.from] !== undefined && inLinks[edge.to] !== undefined) {
      outLinks[edge.from].push(edge.to);
      inLinks[edge.to].push(edge.from);
    }
  }

  for (let i = 0; i < iterations; i++) {
    const newPr = {};
    let danglingSum = 0;
    for (const id of nodeIds) {
      if (outLinks[id].length === 0) danglingSum += pr[id];
    }
    const danglingContribution = danglingSum / N;
    for (const id of nodeIds) {
      let sum = 0;
      for (const src of inLinks[id]) {
        sum += pr[src] / (outLinks[src].length || 1);
      }
      newPr[id] = (1 - damping) / N + damping * (sum + danglingContribution);
    }
    pr = newPr;
  }
  return pr;
}

/**
 * DFS-based cycle detection. Returns array of cycles (each as array of node ids
 * ending with the repeated start node). Caps results to avoid combinatorial blowup.
 */
function detectCycles(nodeIds, edges, maxCycles = 20) {
  const adjList = {};
  for (const id of nodeIds) adjList[id] = [];
  for (const edge of edges) {
    if (adjList[edge.from] !== undefined) adjList[edge.from].push(edge.to);
  }
  // De-duplicate adjacency lists
  for (const id of Object.keys(adjList)) {
    adjList[id] = [...new Set(adjList[id])];
  }

  const cycles = [];
  const seenCycleKeys = new Set();
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  for (const id of nodeIds) color[id] = WHITE;
  const path = [];
  const pathSet = new Set();

  function dfs(node) {
    if (cycles.length >= maxCycles) return;
    color[node] = GRAY;
    path.push(node);
    pathSet.add(node);

    for (const neighbor of adjList[node] || []) {
      if (cycles.length >= maxCycles) break;
      if (neighbor === node) {
        const key = `${node}->${node}`;
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push([node, node]);
        }
        continue;
      }
      if (pathSet.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart).concat([neighbor]);
        const key = cycle.slice(0, -1).sort().join("|");
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push(cycle);
        }
      } else if (color[neighbor] === WHITE) {
        dfs(neighbor);
      }
    }

    path.pop();
    pathSet.delete(node);
    color[node] = BLACK;
  }

  for (const id of nodeIds) {
    if (color[id] === WHITE) dfs(id);
    if (cycles.length >= maxCycles) break;
  }
  return cycles;
}

/** Return top N entries of an object by value, as [{id, value}]. */
function topN(obj, n = 10) {
  return Object.entries(obj)
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Command: discovery
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command: architecture
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command: entrypoints
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command: prompts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command: tools
// ---------------------------------------------------------------------------

/**
 * Extract a JSON-ish schema snippet from text near a tool registration.
 * Best-effort: returns a string (source text) rather than a parsed object.
 */
function extractSchemaNear(content, startIndex, maxChars = 400) {
  const slice = content.slice(startIndex, startIndex + maxChars);
  // Look for arguments: Pydantic BaseModel class, args_schema = X, or JSON schema literal
  const argsMatch = slice.match(/args_schema\s*=\s*(\w+)/);
  if (argsMatch) return { args_schema: argsMatch[1] };
  const schemaMatch = slice.match(/schema\s*[:=]\s*(\{[\s\S]*?\})/);
  if (schemaMatch) {
    try {
      const parsed = JSON.parse(schemaMatch[1]);
      return { schema: parsed };
    } catch {
      return { schemaRaw: schemaMatch[1] };
    }
  }
  const pydanticMatch = slice.match(/class\s+(\w+)\s*\([^)]*BaseModel[^)]*\)/);
  if (pydanticMatch) return { args_schema: pydanticMatch[1] };
  return null;
}

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

// ---------------------------------------------------------------------------
// Command: tests
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command: evaluations
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command: git
// ---------------------------------------------------------------------------

/** Run a git command synchronously, returning stdout (or "" on failure). */
function git(repoPath, ...args) {
  try {
    return execSync(`git ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch {
    return "";
  }
}

/** Check whether a path is inside a git work tree. */
function isGitRepo(repoPath) {
  const out = git(repoPath, "rev-parse", "--is-inside-work-tree");
  return out.trim() === "true";
}

/**
 * git command — Git history analysis.
 * @param {string} repoPath
 * @returns {object}
 */
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

// ---------------------------------------------------------------------------
// Command: ci
// ---------------------------------------------------------------------------

/** Parse a GitHub Actions workflow YAML (or regex-fallback) into triggers/jobs. */
function parseWorkflow(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return { triggers: [], jobs: [] };

  // Use yaml parser if available
  if (yaml) {
    try {
      const parsed = yaml.parse(content);
      if (parsed && typeof parsed === "object") {
        const triggers = [];
        const on = parsed.on;
        if (typeof on === "string") triggers.push(on);
        else if (Array.isArray(on)) triggers.push(...on);
        else if (on && typeof on === "object") triggers.push(...Object.keys(on));
        const jobs = parsed.jobs ? Object.keys(parsed.jobs) : [];
        return { triggers, jobs };
      }
    } catch { /* fall through to regex */ }
  }

  // Regex fallback
  const triggers = [];
  const onMatch = content.match(/^on\s*:\s*$/m);
  if (onMatch) {
    const after = content.slice(onMatch.index + onMatch[0].length);
    // Either a list or a map; capture up to next top-level key
    const blockMatch = after.match(/^([\s\S]*?)(?=^\S)/m);
    const block = blockMatch ? blockMatch[1] : after;
    const listItems = block.match(/^\s*-\s+(\w+)/gm) || [];
    for (const item of listItems) {
      const m = item.match(/-\s+(\w+)/);
      if (m) triggers.push(m[1]);
    }
    const mapItems = block.match(/^\s*(\w+)\s*:/gm) || [];
    for (const item of mapItems) {
      const m = item.match(/(\w+)\s*:/);
      if (m) triggers.push(m[1]);
    }
  }
  const jobs = [];
  const jobsMatch = content.match(/^jobs\s*:\s*$/m);
  if (jobsMatch) {
    const after = content.slice(jobsMatch.index + jobsMatch[0].length);
    const blockMatch = after.match(/^([\s\S]*?)(?=^\S)/m);
    const block = blockMatch ? blockMatch[1] : after;
    const jobItems = block.match(/^\s{2}([A-Za-z0-9_-]+)\s*:/gm) || [];
    for (const item of jobItems) {
      const m = item.match(/^\s{2}([A-Za-z0-9_-]+)\s*:/);
      if (m) jobs.push(m[1]);
    }
  }
  return { triggers: [...new Set(triggers)], jobs: [...new Set(jobs)] };
}

/**
 * ci command — CI/CD discovery.
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

// ---------------------------------------------------------------------------
// Command: ranking
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command: symbols
// ---------------------------------------------------------------------------

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
// AnalyzerPipeline — executes registered analyzers against a repository
//
// Phase 1 design: existing analyzer functions are wrapped by adapters so the
// pipeline contract is in place without rewriting every analyzer.
// Phase 2+: migrate each adapter into a true Analyzer class.
// ===========================================================================

/**
 * Adapter that wraps a legacy analyzer function `(repoPath) => result`.
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
//
// This analyzer demonstrates how a Phase 1 analyzer consumes RepositoryContext
// instead of rescanning the repository. It uses ctx.manifest, ctx.files,
// ctx.dirs, ctx.testFiles, and ctx.exists() to produce the discovery evidence.
// ---------------------------------------------------------------------------

class DiscoveryAnalyzer extends BaseAnalyzer {
  get id() {
    return "discovery";
  }

  supports(_ctx) {
    return true;
  }

  analyze(ctx, store, _analyzerCtx) {
    // Scan for metadata and agent files via PROJECT_DISCOVERY_RULES
    const metadataFiles = [];
    const agentFiles = [];
    for (const r of PROJECT_DISCOVERY_RULES) {
      if (r.category !== "metadata" && r.category !== "agent") continue;
      if (ctx.exists(r.file)) {
        if (r.category === "metadata") metadataFiles.push(r.file);
        else agentFiles.push(r.file);
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

    // Architecture signal directories — where the architecture lives
    const architectureSignalDirs = dirs
      .filter((d) => d.split(sep).some((p) => ARCHITECTURE_SIGNAL_DIRS.has(p.toLowerCase())))
      .slice(0, 20);

    const fileCount = countByExtension(files);
    const testFiles = ctx.testFiles;
    const hasReadme = metadataFiles.some((f) => f.toLowerCase().startsWith("readme"));
    const hasCI = CI_FILES.some((ci) => ctx.exists(ci.path));

    const repoName =
      ctx.manifest?.name && ctx.manifest.name !== "unknown"
        ? ctx.manifest.name
        : basename(ctx.repoPath);

    store[this.id] = {
      repoName,
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
    };
  }
}

// ---------------------------------------------------------------------------
// True Analyzer: SymbolsAnalyzer (uses RepositoryContext AST cache)
//
// Builds the Semantic Index by walking source files once and reusing parsed ASTs
// from RepositoryContext. This avoids re-parsing the same file for architecture,
// prompts, tools, and entrypoint analyzers.
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
//
// Builds the module dependency graph. When SymbolsAnalyzer has already run,
// it reuses the collected imports to avoid re-parsing every source file.
// Otherwise it falls back to per-file import extraction.
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
      const depth = relPath.split(sep).length;
      const isDeep = depth > 3;
      const isBundled = /bundled_skills|vendor|node_modules|site-packages/.test(relPath);
      const isLibOrTest = /(?:^|[\\/])(?:lib|libs|utils|helpers|internal|common|tests?|__tests__|spec)[\\/]/.test(relPath)
        || /^tests?[\\/]/.test(relPath);
      for (const ep of ENTRY_POINT_FILES) {
        if (ep.names.includes(e.name)) {
          if (isDeep || isBundled) {
            addEntrypoint(relPath, "tool", ep.reason + " (deep/bundled)");
          } else if (isLibOrTest) {
            addEntrypoint(relPath, "tool", ep.reason + " (library/test dir)");
          } else {
            addEntrypoint(relPath, ep.type, ep.reason);
          }
          break;
        }
      }
    }

    // 2. Directory-based detection (bin/, scripts/, examples/)
    for (const e of entries) {
      const parts = ctx.rel(e.path).split(sep);
      if (parts.length < 2) continue;
      const topDir = parts[0];
      if (topDir === "bin") {
        addEntrypoint(ctx.rel(e.path), "cli", "file under bin/");
      } else if (topDir === "examples" || topDir === "example") {
        addEntrypoint(ctx.rel(e.path), "example", "file under examples/");
      } else if (topDir === "scripts" && ENTRYPOINT_DIR_NAMES.has("scripts")) {
        addEntrypoint(ctx.rel(e.path), "cli", "file under scripts/");
      }
    }

    // 3. AST-based detection (preferred) + regex fallback per file
    const sourceFiles = entries.filter((e) => SOURCE_EXTENSIONS.has(e.ext));
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
    const codeFiles = files.filter((f) => codeExts.has(f.ext));
    const mdFiles = files.filter((f) => !codeExts.has(f.ext));

    // AST-based extraction for code files (with regex fallback per file)
    const codeResults = await mapWithConcurrency(codeFiles, 10, async (f) => {
        const tree = await ctx.parseAST(f.path);
        const astPrompts = await extractPromptsAST(f.path, ctx.repoPath, tree);
        if (astPrompts !== null) return astPrompts;
        // Regex fallback
        const content = ctx.readFileAbsolute(f.path);
        if (!content) return [];
        const prompts = [];
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
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

    // Regex for markdown files
    const mdPrompts = [];
    for (const f of mdFiles) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
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

    const files = ctx.files.filter((f) => TOOL_FILE_EXTENSIONS.has(f.ext));
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
    const regexFiles = [];
    for (const r of results) {
      if (!r) continue;
      if (r.ast) {
        for (const t of r.tools) {
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

    // Schema-first / registry-array tool detection (common in MCP servers).
    // Pattern: `export const RPC_TOOLS: ToolDef[] = [ { name: 'foo', ... }, ... ]`
    // We detect the type annotation first, then extract `name: '...'` values.
    // This catches tools that decorators and class-name patterns miss.
    const SCHEMA_FIRST_NAME_RE = /\bname\s*:\s*['"]([a-zA-Z_][\w-]*)['"]/g;
    for (const f of files) {
      const content = ctx.readFileAbsolute(f.path);
      if (!content) continue;
      if (!SCHEMA_FIRST_TOOL_TYPE_PATTERN.test(content)) continue;
      const relPath = ctx.rel(f.path);
      // Reset regex state for each file
      SCHEMA_FIRST_NAME_RE.lastIndex = 0;
      let match;
      while ((match = SCHEMA_FIRST_NAME_RE.exec(content)) !== null) {
        const name = match[1];
        if (!name) continue;
        // Filter out common false positives: generic object names
        const lower = name.toLowerCase();
        if (["react", "vue", "angular", "svelte", "default", "main", "app", "config"].includes(lower)) continue;
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
    }

    // Cross-reference entrypoints labeled as "tool" for standalone executable scripts
    // (e.g. bundled_skills/*/scripts/execute.py, skills/*/scripts/*.py) so that
    // simple argparse/sys.argv tools are represented even when they lack decorator/class patterns.
    const entrypoints = store.entrypoints?.entrypoints || [];
    for (const ep of entrypoints) {
      if (ep.type !== "tool") continue;
      const relPath = ep.path;
      const fileName = basename(relPath);
      const baseName = fileName.replace(/\.[^.]+$/, "");

      // Ignore library/test modules that the entrypoints analyzer may have mis-tagged as tool.
      const isLibraryOrTest = /(?:^|[\\/])(?:lib|libs|utils|helpers|internal|common|tests?|__tests__|spec|benchmark)[\\/]/.test(
        relPath
      );
      if (isLibraryOrTest) continue;

      // Only accept tool scripts that live inside a recognized skill/tool/agent directory.
      const isInToolSpace = /(?:^|[\\/])(?:skills?|bundled_skills?|tools?|agents?|hooks?|plugins?)[\\/]/.test(relPath);
      if (!isInToolSpace) continue;

      // Derive a readable tool name from the parent directory when possible:
      // custodian/bundled_skills/ai/openai-chat/scripts/execute.py -> openai-chat
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

    store[this.id] = { totalTools: tools.length, tools };
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
    for (const f of ctx.allFiles) {
      const name = f.name.toLowerCase();
      const relPath = ctx.rel(f.path);
      // Name-based detection: only source files (no images, docs, data files)
      const isEvalByName =
        SOURCE_EXTENSIONS.has(f.ext) && EVAL_KEYWORDS.some((kw) => name.includes(kw));
      // Only source files inside eval dirs (not docs/configs)
      const isInEvalDir =
        SOURCE_EXTENSIONS.has(f.ext) &&
        [...evalDirs].some(
          (d) => relPath.startsWith(d + sep) || relPath.startsWith(d + "/")
        );
      let isEvalByContent = false;
      if (SOURCE_EXTENSIONS.has(f.ext)) {
        const content = ctx.readFileAbsolute(f.path);
        if (content) {
          let matchCount = 0;
          for (const kw of EVAL_KEYWORDS) {
            const re = new RegExp(`\\b${kw.replace(/_/g, "[_]")}\\b`, "i");
            if (re.test(content)) {
              matchCount++;
              patterns.add(kw);
            }
          }
          isEvalByContent = matchCount >= 2;
          const metricRegexes = [
            /\b(accuracy|pass_rate|pass@k|f1|precision|recall|bleu|rouge|exact_match|exact-match)\b/gi,
            /\b(score|metric|accuracy_score|recall_score|precision_score)\b/gi,
          ];
          for (const re of metricRegexes) {
            let m;
            while ((m = re.exec(content)) !== null) {
              metrics.add(m[1].toLowerCase());
            }
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

    // Contributors
    const shortlog = git(repoPath, "shortlog", "-sne", "HEAD").trim();
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

      if (name === "readme.md" || name === "readme.rst" || name === "readme") {
        score += 50;
        reasons.push("README (+50)");
      }
      if (IMPORTANT_FILES.has(relPath) || IMPORTANT_FILES.has(name)) {
        score += 40;
        reasons.push("important file (+40)");
      }
      if (
        relPath
          .split(sep)
          .some((p) => p.toLowerCase() === "examples" || p.toLowerCase() === "example")
      ) {
        score += 30;
        reasons.push("examples (+30)");
      }
      if (testPaths.has(relPath)) {
        score += 20;
        reasons.push("test (+20)");
      }
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

      if (score > 0) {
        scored.push({ path: relPath, score, reasons });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    store[this.id] = { topFiles: scored.slice(0, 20) };
  }
}

const ANALYZERS = [
  new DiscoveryAnalyzer(),
  new SymbolsAnalyzer(),
  new ArchitectureAnalyzer(),
  new EntrypointsAnalyzer(),
  new PromptsAnalyzer(),
  new ToolsAnalyzer(),
  new TestsAnalyzer(),
  new EvaluationsAnalyzer(),
  new GitAnalyzer(),
  new CIAnalyzer(),
  new RankingAnalyzer(),
];

// ===========================================================================
// EvidenceStore — graph-based research evidence layer
//
// Wraps the flat analyzer outputs (discovery, symbols, architecture, ...) and
// exposes a unified graph view: nodes (functions, classes, modules, prompts,
// tools, tests) connected by edges (imports, calls, tested_by, documents, ...).
//
// This is the layer the LLM consumes. Every conclusion can be traced back to
// deterministic evidence nodes and edges.
// ===========================================================================

class EvidenceStore {
  constructor(flatStore = {}) {
    this._store = flatStore;
    this._nodes = new Map();
    this._edges = [];
    this._indexByKind = new Map();
    this._indexByFile = new Map();
    this._outgoing = new Map();
    this._incoming = new Map();
    this._built = false;
  }

  // -------------------------------------------------------------------------
  // Graph construction
  // -------------------------------------------------------------------------

  ensureBuilt() {
    if (this._built) return;
    this._buildGraph();
    this._built = true;
  }

  _buildGraph() {
    const discovery = this._store.discovery || {};
    const symbols = this._store.symbols || {};
    const architecture = this._store.architecture || {};
    const tests = this._store.tests || {};
    const entrypoints = this._store.entrypoints || {};
    const prompts = this._store.prompts || {};
    const tools = this._store.tools || {};

    // Modules from architecture
    for (const mod of architecture.nodes || []) {
      this.addNode("module", mod.id, mod.id, { path: mod.path, imports: mod.imports });
    }

    // Module dependency edges
    for (const edge of architecture.edges || []) {
      this.addEdge(edge.from, edge.to, "imports");
    }

    // Functions / classes / calls / imports
    for (const fn of symbols.functions || []) {
      const id = this._symbolId("function", fn.file, fn.name, fn.line);
      this.addNode("function", id, fn.name, { file: fn.file, line: fn.line, params: fn.params, decorators: fn.decorators });
      this.addEdge(this._moduleIdFromPath(fn.file), id, "contains");
    }

    for (const cls of symbols.classes || []) {
      const id = this._symbolId("class", cls.file, cls.name, cls.line);
      this.addNode("class", id, cls.name, { file: cls.file, line: cls.line, bases: cls.bases, methods: cls.methods });
      this.addEdge(this._moduleIdFromPath(cls.file), id, "contains");
    }

    for (const call of symbols.calls || []) {
      const callerId = call.caller ? this._symbolId("function", call.file, call.caller, null) : null;
      const calleeId = this._symbolId("function", null, call.callee, null);
      if (calleeId) {
        // Ensure callee node exists even if its definition was not indexed.
        this.addNode("function", calleeId, call.callee, {});
      }
      if (callerId) {
        this.addNode("function", callerId, call.caller, { file: call.file });
      }
      if (callerId && calleeId) {
        this.addEdge(callerId, calleeId, "calls");
      }
    }

    // Imports as module dependency edges (redundant with architecture but typed)
    for (const imp of symbols.imports || []) {
      const fromMod = this._moduleIdFromPath(imp.file);
      const toMod = imp.from || imp.what;
      if (fromMod && toMod) {
        this.addEdge(fromMod, toMod, "imports");
      }
    }

    // Strings as prompt/template candidates
    for (const s of symbols.strings || []) {
      const id = this._symbolId("string", s.file, s.name, s.line);
      this.addNode("string", id, s.name, { file: s.file, line: s.line, length: s.length });
    }

    // Entrypoints
    for (const ep of entrypoints.entrypoints || []) {
      const id = this._symbolId("entrypoint", ep.path, ep.path, null);
      this.addNode("entrypoint", id, ep.path, { type: ep.type, reason: ep.reason });
      this.addEdge(id, this._moduleIdFromPath(ep.path), "executes");
    }

    // Tools
    for (const t of tools.tools || []) {
      const id = this._symbolId("tool", t.file, t.name, t.line);
      this.addNode("tool", id, t.name, { file: t.file, line: t.line, framework: t.framework });
    }

    // Tests
    for (const tf of tests.testFiles || []) {
      const id = this._symbolId("test", tf.path, tf.path, null);
      this.addNode("test", id, tf.path, { path: tf.path, language: tf.language, functions: tf.functions });
      this.addEdge(id, this._moduleIdFromPath(tf.path), "tests");
    }

    // Architecture signals
    for (const dir of discovery.architectureSignalDirs || []) {
      const id = `dir:${dir}`;
      this.addNode("architecture_signal", id, dir, { path: dir });
    }
  }

  _moduleIdFromPath(filePath) {
    if (!filePath) return null;
    return pathToModuleId(filePath);
  }

  _symbolId(kind, filePath, name, line) {
    const loc = filePath ? `${filePath}:${line || "?"}` : `global:${name}`;
    return `${kind}:${name}@${loc}`;
  }

  addNode(kind, id, name, properties = {}) {
    if (this._nodes.has(id)) return this._nodes.get(id);
    const node = { kind, id, name, ...properties };
    this._nodes.set(id, node);

    let kindList = this._indexByKind.get(kind);
    if (!kindList) {
      kindList = [];
      this._indexByKind.set(kind, kindList);
    }
    kindList.push(node);

    const file = properties.file || properties.path;
    if (file) {
      let fileList = this._indexByFile.get(file);
      if (!fileList) {
        fileList = [];
        this._indexByFile.set(file, fileList);
      }
      fileList.push(node);
    }

    return node;
  }

  addEdge(from, to, kind) {
    if (!from || !to || from === to) return;
    const edge = { from, to, kind };
    this._edges.push(edge);

    this._pushToMap(this._outgoing, from, edge);
    this._pushToMap(this._incoming, to, edge);
  }

  _pushToMap(map, key, value) {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(value);
  }

  // -------------------------------------------------------------------------
  // Query API
  // -------------------------------------------------------------------------

  /** Raw flat evidence by analyzer id. */
  get(id) {
    return this._store[id];
  }

  /** All evidence keys. */
  keys() {
    return Object.keys(this._store);
  }

  /** All graph nodes, optionally filtered by kind. */
  nodes(kind) {
    this.ensureBuilt();
    if (kind) return this._indexByKind.get(kind) || [];
    return [...this._nodes.values()];
  }

  /** All graph edges, optionally filtered by kind. */
  edges(kind) {
    this.ensureBuilt();
    if (kind) return this._edges.filter((e) => e.kind === kind);
    return this._edges;
  }

  /** Find a node by id. */
  node(id) {
    this.ensureBuilt();
    return this._nodes.get(id) || null;
  }

  /** Find nodes by name across all kinds. */
  findByName(name) {
    this.ensureBuilt();
    return [...this._nodes.values()].filter((n) => n.name === name);
  }

  /** Find all nodes defined in a file. */
  nodesInFile(filePath) {
    this.ensureBuilt();
    return this._indexByFile.get(filePath) || [];
  }

  /** Who calls this function/symbol? */
  callersOf(name) {
    this.ensureBuilt();
    const matches = this.findByName(name);
    const result = [];
    for (const m of matches) {
      const incoming = this._incoming.get(m.id) || [];
      for (const edge of incoming.filter((e) => e.kind === "calls")) {
        result.push(this._nodes.get(edge.from));
      }
    }
    return result.filter(Boolean);
  }

  /** What does this function/symbol call? */
  callsOf(name) {
    this.ensureBuilt();
    const matches = this.findByName(name);
    const result = [];
    for (const m of matches) {
      const outgoing = this._outgoing.get(m.id) || [];
      for (const edge of outgoing.filter((e) => e.kind === "calls")) {
        result.push(this._nodes.get(edge.to));
      }
    }
    return result.filter(Boolean);
  }

  /** Which modules import this module? */
  usedBy(moduleId) {
    this.ensureBuilt();
    const incoming = this._incoming.get(moduleId) || [];
    return incoming
      .filter((e) => e.kind === "imports")
      .map((e) => this._nodes.get(e.from))
      .filter(Boolean);
  }

  /** Which modules does this module import? */
  importsOf(moduleId) {
    this.ensureBuilt();
    const outgoing = this._outgoing.get(moduleId) || [];
    return outgoing
      .filter((e) => e.kind === "imports")
      .map((e) => this._nodes.get(e.to))
      .filter(Boolean);
  }

  /** Subgraph: module dependency graph as adjacency list. */
  moduleGraph() {
    this.ensureBuilt();
    const modules = this.nodes("module");
    const adj = {};
    for (const m of modules) adj[m.id] = [];
    for (const edge of this.edges("imports")) {
      if (adj[edge.from] && this._nodes.has(edge.to)) {
        adj[edge.from].push(edge.to);
      }
    }
    return { modules, adjacency: adj };
  }

  /** Find tests related to a source file path. */
  testsFor(filePath) {
    this.ensureBuilt();
    return this.nodes("test").filter((t) => {
      const testName = t.name || "";
      const base = basename(filePath).replace(/\.[^.]+$/, "");
      return testName.includes(base) || testName.replace(/test_|_test|\.test/g, "") === base;
    });
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * Return the flat evidence store for JSON serialization.
   * This keeps the CLI output backward-compatible.
   */
  toJSON() {
    return this._store;
  }
}

// ===========================================================================
// Ontology: Object Types and Relationship Types
//
// Inspired by Palantir's ontology approach: treat the repository as a graph
// of engineering objects (not just files). Every significant concept is an
// Object with typed Relationships and linked Evidence.
// ===========================================================================

const OBJECT_TYPES = [
  "repository",
  "module",
  "function",
  "class",
  "agent",
  "planner",
  "runner",
  "tool",
  "prompt",
  "test",
  "evaluation",
  "workflow",
  "config",
  "document",
  "dataset",
];

const RELATIONSHIP_TYPES = [
  "imports",
  "calls",
  "extends",
  "implements",
  "creates",
  "uses",
  "references",
  "owns",
  "testedBy",
  "configuredBy",
  "evaluatedBy",
  "documentedBy",
  "benchmarkedBy",
];

// Classification rules: name/path patterns → object type
// Order matters: first match wins (more specific patterns first)
const CLASSIFICATION_RULES = [
  { type: "agent", patterns: [/agent/i, /harness/i], field: "name" },
  { type: "planner", patterns: [/plan/i, /strateg/i], field: "name" },
  { type: "runner", patterns: [/runner/i, /executor/i, /loop/i, /run\b/i], field: "name" },
  { type: "evaluation", patterns: [/eval/i, /benchmark/i, /score/i, /metric/i], field: "name" },
  { type: "workflow", patterns: [/workflow/i, /pipeline/i, /ci\b/i], field: "name" },
];

/**
 * Classifies raw symbols, prompts, tools, tests, etc. into semantic Objects.
 * Inspired by Palantir's Object Discovery: everything is an Entity with a type.
 *
 * Input: existing analyzer outputs (symbols, prompts, tools, tests, evaluations, ci)
 * Output: typed Objects with properties, ready for relationship building.
 */
class ObjectClassifier {
  /**
   * @param {Record<string, any>} store — raw analyzer outputs
   * @returns {{ objects: Array, summary: Record<string, number> }}
   */
  classify(store) {
    const objects = [];
    const seen = new Set(); // dedup by key

    // 1. Classify prompts → Prompt objects
    const prompts = store.prompts?.prompts || [];
    for (const p of prompts) {
      const key = `prompt:${p.file}:${p.name || p.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "prompt",
        name: p.name || p.type || "unnamed",
        file: p.file,
        properties: {
          promptType: p.type,
          variables: p.variables || [],
          line: p.line,
        },
        evidence: [p.file],
      });
    }

    // 2. Classify tools → Tool objects
    const tools = store.tools?.tools || [];
    for (const t of tools) {
      const key = `tool:${t.name}:${t.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "tool",
        name: t.name,
        file: t.file,
        properties: {
          framework: t.framework,
          schema: t.schema,
        },
        evidence: [t.file],
      });
    }

    // 3. Classify tests → Test objects
    const testFiles = store.tests?.testFiles || [];
    for (const tf of testFiles) {
      const key = `test:${tf.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "test",
        name: tf.file.split("/").pop(),
        file: tf.file,
        properties: {
          testCount: tf.testCount || 0,
          patterns: tf.patterns || [],
        },
        evidence: [tf.file],
      });
    }

    // 4. Classify evaluations → Evaluation objects
    const evalFiles = store.evaluations?.evalFiles || [];
    for (const ef of evalFiles) {
      const key = `eval:${ef}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "evaluation",
        name: ef.split("/").pop(),
        file: ef,
        properties: {},
        evidence: [ef],
      });
    }

    // 5. Classify CI workflows → Workflow objects
    const ciWorkflows = store.ci?.workflows || [];
    for (const w of ciWorkflows) {
      const key = `workflow:${w.path || w.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: "workflow",
        name: w.name || (w.path ? w.path.split("/").pop() : "unnamed"),
        file: w.path,
        properties: {
          triggers: w.triggers || [],
          jobs: w.jobs || [],
        },
        evidence: [w.path].filter(Boolean),
      });
    }

    // 6. Classify functions/classes → semantic types
    const symbols = store.symbols || {};
    const allFuncs = symbols.functions || [];
    const allClasses = symbols.classes || [];

    for (const fn of allFuncs) {
      const semanticType = this._classifyByName(fn.name);
      const key = `${semanticType}:${fn.file}:${fn.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: semanticType,
        name: fn.name,
        file: fn.file,
        properties: {
          line: fn.line,
          params: fn.params || 0,
          exported: fn.exported || false,
        },
        evidence: [fn.file],
      });
    }

    for (const cls of allClasses) {
      const semanticType = this._classifyByName(cls.name, "class");
      const key = `${semanticType}:${cls.file}:${cls.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objects.push({
        id: key,
        type: semanticType,
        name: cls.name,
        file: cls.file,
        properties: {
          line: cls.line,
          methods: cls.methods || 0,
          exported: cls.exported || false,
        },
        evidence: [cls.file],
      });
    }

    // 7. Classify config files → Config objects
    const disc = store.discovery || {};
    const allFiles = disc.allFiles || [];
    for (const f of allFiles) {
      if (/\.(ya?ml|toml|ini|env|json)$/.test(f) && !/node_modules|\.git/.test(f)) {
        const key = `config:${f}`;
        if (seen.has(key)) continue;
        seen.add(key);
        objects.push({
          id: key,
          type: "config",
          name: f.split("/").pop(),
          file: f,
          properties: {},
          evidence: [f],
        });
      }
    }

    // 8. Classify documents → Document objects
    for (const f of allFiles) {
      if (/\.(md|rst|txt)$/.test(f) && !/node_modules|\.git/.test(f)) {
        const key = `doc:${f}`;
        if (seen.has(key)) continue;
        seen.add(key);
        objects.push({
          id: key,
          type: "document",
          name: f.split("/").pop(),
          file: f,
          properties: {},
          evidence: [f],
        });
      }
    }

    // Strip redundant `evidence` arrays — every object already has a `file`
    // field that serves as the evidence pointer. This reduces ontology size by
    // ~15% with zero information loss.
    for (const obj of objects) {
      delete obj.evidence;
    }

    // Build summary
    const summary = {};
    for (const obj of objects) {
      summary[obj.type] = (summary[obj.type] || 0) + 1;
    }

    return { objects, summary };
  }

  /**
   * Classify a function/class name into a semantic object type.
   * Returns "function" or "class" if no semantic match.
   * @param {string} name
   * @param {string} defaultType
   * @returns {string}
   */
  _classifyByName(name, defaultType = "function") {
    if (!name) return defaultType;
    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(name)) return rule.type;
      }
    }
    return defaultType;
  }
}

/**
 * Builds semantic relationships between classified Objects.
 * Inspired by Palantir's Relationship Discovery: Object identity is less
 * important than how Objects connect.
 *
 * Input: classified Objects + raw analyzer outputs
 * Output: typed Relationships (testedBy, configuredBy, usesTool, etc.)
 */
class RelationshipBuilder {
  /**
   * @param {Array} objects — from ObjectClassifier
   * @param {Record<string, any>} store — raw analyzer outputs
   * @returns {{ relationships: Array, summary: Record<string, number> }}
   *
   * NOTE: Structural relationships (imports, calls) are NOT duplicated here —
   * they already exist in `store.symbols.imports` and `store.symbols.calls`.
   * Only semantic relationships (testedBy, configuredBy, documentedBy, uses,
   * etc.) are materialized, because they require cross-analyzer inference
   * that cannot be reconstructed from symbols alone. This avoids ~90% of the
   * ontology bloat (observed: 11k+ calls duplicates in custodian-kernel).
   */
  build(objects, store) {
    const rels = [];
    const symbols = store.symbols || {};

    // --- Semantic relationships only (structural ones live in symbols.*) ---

    // 1. testedBy (function/class → test file)
    const testObjects = objects.filter((o) => o.type === "test");
    const funcObjects = objects.filter((o) => o.type === "function" || o.type === "class");
    for (const fn of funcObjects) {
      const baseName = fn.name.replace(/\.(ts|js|py|tsx)$/, "");
      for (const test of testObjects) {
        const testName = test.name.replace(/\.(test|spec)\.(ts|js|py|tsx)$/, "");
        if (testName.includes(baseName) || baseName.includes(testName)) {
          rels.push({
            type: "testedBy",
            source: `${fn.type}:${fn.file}:${fn.name}`,
            target: test.file,
          });
        }
      }
    }

    // 2. configuredBy (module → config file)
    const configObjects = objects.filter((o) => o.type === "config");
    const moduleFiles = new Set(funcObjects.map((f) => f.file));
    for (const cfg of configObjects) {
      const cfgDir = cfg.file.split("/").slice(0, -1).join("/");
      for (const modFile of moduleFiles) {
        const modDir = modFile.split("/").slice(0, -1).join("/");
        if (modDir === cfgDir) {
          rels.push({
            type: "configuredBy",
            source: modFile,
            target: cfg.file,
          });
          break;
        }
      }
    }

    // 3. documentedBy (module → README/doc)
    const docObjects = objects.filter((o) => o.type === "document");
    for (const doc of docObjects) {
      if (!/^readme/i.test(doc.name)) continue;
      const docDir = doc.file === "README.md" ? "" : doc.file.split("/").slice(0, -1).join("/");
      for (const fn of funcObjects) {
        const fnDir = fn.file.split("/").slice(0, -1).join("/");
        if (fnDir === docDir) {
          rels.push({
            type: "documentedBy",
            source: `${fn.type}:${fn.file}:${fn.name}`,
            target: doc.file,
          });
          break;
        }
      }
    }

    // 4. usesTool / usesPrompt (agent → tool/prompt)
    const agentObjects = objects.filter(
      (o) => o.type === "agent" || o.type === "runner" || o.type === "planner",
    );
    const toolObjects = objects.filter((o) => o.type === "tool");
    const promptObjects = objects.filter((o) => o.type === "prompt");

    for (const agent of agentObjects) {
      for (const tool of toolObjects) {
        if (agent.file === tool.file || this._sharesDirectory(agent.file, tool.file)) {
          rels.push({
            type: "uses",
            source: agent.file,
            target: tool.file,
          });
        }
      }
      // Agent uses Prompt: if agent file is near prompt file
      for (const prompt of promptObjects) {
        if (agent.file === prompt.file || this._sharesDirectory(agent.file, prompt.file)) {
          rels.push({
            type: "uses",
            source: agent.file,
            target: prompt.file,
          });
        }
      }
    }

    // 5. evaluatedBy (module → evaluation)
    const evalObjects = objects.filter((o) => o.type === "evaluation");
    for (const ev of evalObjects) {
      rels.push({
        type: "evaluatedBy",
        source: "repository",
        target: ev.file,
      });
    }

    // Build summary
    const summary = {};
    for (const r of rels) {
      summary[r.type] = (summary[r.type] || 0) + 1;
    }

    return { relationships: rels, summary };
  }

  _sharesDirectory(a, b) {
    if (!a || !b) return false;
    const dirA = a.split("/").slice(0, -1).join("/");
    const dirB = b.split("/").slice(0, -1).join("/");
    return dirA === dirB && dirA !== "";
  }
}

// ===========================================================================
// ResearchPlanner — goal-driven research design
//
// Transforms a high-level research goal into a set of falsifiable hypotheses,
// an evidence-gathering plan, and a prioritized reading plan. All reasoning is
// grounded in the deterministic EvidenceStore graph.
// ===========================================================================

const DEFAULT_RESEARCH_GOAL =
  "understand the repository architecture, design ideas, engineering tradeoffs, and reusable patterns";

class ResearchPlanner {
  /**
   * @param {string} goal
   * @param {EvidenceStore} evidenceStore
   */
  constructor(goal, evidenceStore) {
    this.goal = goal || DEFAULT_RESEARCH_GOAL;
    this.store = evidenceStore;
  }

  plan() {
    this.store.ensureBuilt();
    const hypotheses = this._generateHypotheses();
    const evidencePlan = this._buildEvidencePlan(hypotheses);
    const readingPlan = this._buildReadingPlan(hypotheses, evidencePlan);
    return {
      goal: this.goal,
      hypotheses,
      evidencePlan,
      readingPlan,
    };
  }

  _generateHypotheses() {
    const discovery = this.store.get("discovery") || {};
    const architecture = this.store.get("architecture") || {};
    const entrypoints = this.store.get("entrypoints") || {};
    const tests = this.store.get("tests") || {};
    const evaluations = this.store.get("evaluations") || {};
    const prompts = this.store.get("prompts") || {};
    const tools = this.store.get("tools") || {};
    const gitInfo = this.store.get("git") || {};

    const hypotheses = [];

    // H1: Purpose
    const hasReadme = discovery.hasReadme;
    const hasManifest = Boolean(discovery.manifest);
    hypotheses.push({
      id: "H1-purpose",
      statement: "The repository purpose and target audience can be inferred from README and manifest",
      confidence: hasReadme && hasManifest ? "high" : hasReadme || hasManifest ? "medium" : "low",
      evidence: [
        ...(hasReadme ? ["README.md exists"] : []),
        ...(hasManifest ? [`manifest: ${discovery.manifest.entry}`] : []),
      ],
      gaps: [
        ...(hasReadme ? [] : ["README.md missing"]),
        ...(hasManifest ? [] : ["No recognized package manifest"]),
      ],
    });

    // H2: AI/Agent nature
    const hasAgentFiles = (discovery.agentFiles || []).length > 0;
    const hasPrompts = (prompts.totalPrompts || 0) > 0;
    const hasTools = (tools.totalTools || 0) > 0;
    const signalDirs = discovery.architectureSignalDirs || [];
    const agentLikeDirs = signalDirs.filter((d) =>
      /\b(agent|agents|prompt|prompts|tool|tools|memory|context|planner|executor)\b/.test(d)
    );
    const aiScore = [hasAgentFiles, hasPrompts, hasTools, agentLikeDirs.length > 0].filter(Boolean).length;
    hypotheses.push({
      id: "H2-ai-agent",
      statement: "This is an AI-agent / LLM-related project with prompts and/or tools",
      confidence: aiScore >= 3 ? "high" : aiScore >= 1 ? "medium" : "low",
      evidence: [
        ...(hasAgentFiles ? ["agent instruction files found"] : []),
        ...(hasPrompts ? [`${prompts.totalPrompts} prompt-like strings`] : []),
        ...(hasTools ? [`${tools.totalTools} tool registrations`] : []),
        ...(agentLikeDirs.length ? [`architecture signal dirs: ${agentLikeDirs.join(", ")}`] : []),
      ],
      gaps: aiScore === 0 ? ["No prompt/tool/agent signals detected"] : [],
    });

    // H3: Modular architecture
    const nodeCount = architecture.totalNodes || 0;
    const edgeCount = architecture.totalEdges || 0;
    const cycleCount = (architecture.cycles || []).length;
    hypotheses.push({
      id: "H3-modular",
      statement: "The codebase has a modular architecture with identifiable dependency layers",
      confidence: nodeCount > 10 && edgeCount > 5 ? "high" : nodeCount > 0 ? "medium" : "low",
      evidence: [
        `${nodeCount} modules`,
        `${edgeCount} import edges`,
        ...(cycleCount ? [`${cycleCount} import cycles detected`] : []),
      ],
      gaps: nodeCount === 0 ? ["No module dependency graph available"] : [],
    });

    // H4: Testing
    const testFileCount = tests.totalTestFiles || 0;
    hypotheses.push({
      id: "H4-testing",
      statement: "The project relies on automated tests for correctness",
      confidence: testFileCount > 5 ? "high" : testFileCount > 0 ? "medium" : "low",
      evidence: [
        `${testFileCount} test files`,
        `${tests.totalTestFunctions || 0} test functions`,
        ...(tests.patterns || []).map((p) => `pattern: ${p}`),
      ],
      gaps: testFileCount === 0 ? ["No test files detected"] : [],
    });

    // H5: Entry points
    const epCount = (entrypoints.entrypoints || []).length;
    const cliCount = (entrypoints.entrypoints || []).filter((e) => e.type === "cli").length;
    hypotheses.push({
      id: "H5-entrypoints",
      statement: "Entry points reveal the primary interfaces (CLI, server, SDK)",
      confidence: epCount > 0 ? "high" : "low",
      evidence: [
        `${epCount} entry points`,
        `${cliCount} CLI entry points`,
        ...(entrypoints.entrypoints || [])
          .slice(0, 5)
          .map((e) => `${e.type}: ${e.path}`),
      ],
      gaps: epCount === 0 ? ["No entry points detected"] : [],
    });

    // H6: Evaluation
    const hasEval = evaluations.hasEvaluation;
    hypotheses.push({
      id: "H6-evaluation",
      statement: "The project measures quality through benchmarks or evaluations",
      confidence: hasEval ? "high" : "low",
      evidence: [
        ...(hasEval ? ["evaluation/benchmark artifacts found"] : []),
        ...(evaluations.patterns || []).slice(0, 5).map((p) => `pattern: ${p}`),
        ...(evaluations.metrics || []).slice(0, 5).map((m) => `metric: ${m}`),
      ],
      gaps: hasEval ? [] : ["No evaluation or benchmark artifacts detected"],
    });

    // H7: Maturity
    const totalCommits = gitInfo.totalCommits || 0;
    const totalContributors = gitInfo.totalContributors || 0;
    hypotheses.push({
      id: "H7-maturity",
      statement: "The project is actively maintained with a non-trivial development history",
      confidence: totalCommits > 50 && totalContributors > 1 ? "high" : totalCommits > 0 ? "medium" : "low",
      evidence: [
        `${totalCommits} commits`,
        `${totalContributors} contributors`,
        ...(gitInfo.lastCommit ? [`last commit: ${gitInfo.lastCommit.date}`] : []),
      ],
      gaps: totalCommits === 0 ? ["No Git history available"] : [],
    });

    return hypotheses;
  }

  _buildEvidencePlan(hypotheses) {
    const plan = [];
    const discovery = this.store.get("discovery") || {};
    const ranking = this.store.get("ranking") || {};
    const topFiles = (ranking.topFiles || []).map((f) => f.path);

    for (const h of hypotheses) {
      if (h.gaps.length === 0) continue;
      for (const gap of h.gaps) {
        if (gap.includes("README")) {
          plan.push({
            hypothesisId: h.id,
            source: "manual",
            query: "read README.md or project documentation",
            priority: "high",
          });
        } else if (gap.includes("manifest")) {
          plan.push({
            hypothesisId: h.id,
            source: "manual",
            query: "inspect package manifest for dependencies and scripts",
            priority: "high",
          });
        } else if (gap.includes("entry") || gap.includes("interface")) {
          plan.push({
            hypothesisId: h.id,
            source: "entrypoints",
            query: "trace entry point call graphs",
            priority: "high",
          });
        } else if (gap.includes("test")) {
          plan.push({
            hypothesisId: h.id,
            source: "tests",
            query: "inspect examples or manual validation workflows",
            priority: "medium",
          });
        } else if (gap.includes("eval")) {
          plan.push({
            hypothesisId: h.id,
            source: "evaluations",
            query: "search for ad-hoc validation scripts",
            priority: "medium",
          });
        } else {
          plan.push({
            hypothesisId: h.id,
            source: "auto",
            query: `resolve gap: ${gap}`,
            priority: "medium",
          });
        }
      }
    }

    // Add file-specific evidence queries from ranking
    for (const file of topFiles.slice(0, 10)) {
      plan.push({
        hypothesisId: "H3-modular",
        source: "ranking",
        query: `read ${file}`,
        priority: "high",
      });
    }

    // Add architecture signal directory queries
    for (const dir of (discovery.architectureSignalDirs || []).slice(0, 10)) {
      plan.push({
        hypothesisId: "H3-modular",
        source: "discovery",
        query: `explore architecture signal directory: ${dir}`,
        priority: "medium",
      });
    }

    return plan;
  }

  _buildReadingPlan(hypotheses, evidencePlan) {
    const ranking = this.store.get("ranking") || {};
    const entrypoints = this.store.get("entrypoints") || {};
    const discovery = this.store.get("discovery") || {};
    const agentFiles = discovery.agentFiles || [];

    const scoredFiles = new Map();

    // Seed from ranking
    for (const item of ranking.topFiles || []) {
      scoredFiles.set(item.path, { path: item.path, score: item.score, reasons: [...item.reasons] });
    }

    // Boost entry points
    for (const ep of entrypoints.entrypoints || []) {
      const entry = scoredFiles.get(ep.path) || { path: ep.path, score: 0, reasons: [] };
      entry.score += 30;
      entry.reasons.push(`entrypoint (${ep.type})`);
      scoredFiles.set(ep.path, entry);
    }

    // Ensure README and agent instructions are included
    for (const candidate of ["README.md", "AGENTS.md", "CLAUDE.md", ...agentFiles]) {
      if ((discovery.metadataFiles || []).includes(candidate) || agentFiles.includes(candidate)) {
        const entry = scoredFiles.get(candidate) || { path: candidate, score: 0, reasons: [] };
        entry.score += 40;
        entry.reasons.push("critical documentation");
        scoredFiles.set(candidate, entry);
      }
    }

    const sorted = [...scoredFiles.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return sorted.map((item) => ({
      file: item.path,
      reason: [...new Set(item.reasons)].join("; "),
      priority: item.score >= 60 ? "high" : item.score >= 30 ? "medium" : "low",
      estimatedEffort: item.path.endsWith(".md") ? "low" : "medium",
    }));
  }
}

// ===========================================================================
// QuestionGenerator — gap-driven question generation
//
// Reads the EvidenceStore and emits concrete research questions for the LLM
// layer. Each question points to the exact evidence gap and suggests which
// analyzer output or files to consult.
// ===========================================================================

class QuestionGenerator {
  /**
   * @param {EvidenceStore} evidenceStore
   */
  constructor(evidenceStore) {
    this.store = evidenceStore;
  }

  generate() {
    this.store.ensureBuilt();
    const gaps = this._identifyGaps();
    const questions = gaps.map((gap) => this._gapToQuestion(gap));
    return { questions };
  }

  _identifyGaps() {
    const gaps = [];
    const discovery = this.store.get("discovery") || {};
    const architecture = this.store.get("architecture") || {};
    const entrypoints = this.store.get("entrypoints") || {};
    const tests = this.store.get("tests") || {};
    const evaluations = this.store.get("evaluations") || {};
    const prompts = this.store.get("prompts") || {};
    const tools = this.store.get("tools") || {};
    const ranking = this.store.get("ranking") || {};

    if (!discovery.hasReadme) {
      gaps.push({ category: "purpose", severity: "high", detail: "No README.md found" });
    }
    if (!discovery.manifest) {
      gaps.push({ category: "purpose", severity: "medium", detail: "No recognized package manifest" });
    }

    const modules = architecture.nodes || [];
    const highCentrality = [
      ...(architecture.centrality?.topByInDegree || []),
      ...(architecture.centrality?.topByPageRank || []),
    ];
    if (modules.length > 0 && highCentrality.length === 0) {
      gaps.push({ category: "architecture", severity: "medium", detail: "Modules exist but centrality is unclear" });
    }
    if ((architecture.cycles || []).length > 0) {
      gaps.push({ category: "architecture", severity: "medium", detail: `${architecture.cycles.length} import cycles detected` });
    }

    if ((entrypoints.entrypoints || []).length === 0) {
      gaps.push({ category: "entrypoints", severity: "high", detail: "No entry points detected" });
    } else {
      const cliEps = entrypoints.entrypoints.filter((e) => e.type === "cli");
      if (cliEps.length > 0) {
        gaps.push({ category: "entrypoints", severity: "medium", detail: "CLI entry points need usage semantics" });
      }
    }

    if ((tests.totalTestFiles || 0) === 0) {
      gaps.push({ category: "testing", severity: "medium", detail: "No automated tests detected" });
    }

    if (!evaluations.hasEvaluation) {
      gaps.push({ category: "evaluation", severity: "medium", detail: "No evaluation or benchmark artifacts detected" });
    }

    if ((prompts.totalPrompts || 0) > 0 && (tools.totalTools || 0) === 0) {
      gaps.push({ category: "prompts", severity: "medium", detail: "Prompts exist but tool binding is unclear" });
    }
    if ((tools.totalTools || 0) > 0 && (prompts.totalPrompts || 0) === 0) {
      gaps.push({ category: "tools", severity: "medium", detail: "Tools exist but prompt orchestration is unclear" });
    }
    if ((prompts.totalPrompts || 0) > 0 && (tools.totalTools || 0) > 0) {
      gaps.push({ category: "prompts", severity: "medium", detail: "Both prompts and tools exist; their orchestration needs inspection" });
    }
    if ((prompts.totalPrompts || 0) > 0) {
      gaps.push({ category: "prompts", severity: "low", detail: "Prompt lifecycle (versioning, assembly, compression) needs inspection" });
    }
    if ((tools.totalTools || 0) > 0) {
      gaps.push({ category: "tools", severity: "low", detail: "Tool lifecycle (registration, discovery, invocation) needs inspection" });
    }

    // High-centrality modules that are not in the top reading list
    const topPaths = new Set((ranking.topFiles || []).map((f) => f.path));
    for (const { id } of highCentrality.slice(0, 5)) {
      const node = modules.find((n) => n.id === id);
      if (node && !topPaths.has(node.path)) {
        gaps.push({ category: "architecture", severity: "low", detail: `High-centrality module not yet prioritized: ${node.path}` });
      }
    }

    return gaps;
  }

  _gapToQuestion(gap) {
    const templates = {
      purpose: {
        high: "What problem does this repository solve, and who are its intended users?",
        medium: "How is the project packaged and what are its declared dependencies/scripts?",
        low: "What additional metadata (LICENSE, CONTRIBUTING, CHANGELOG) clarifies project intent?",
      },
      architecture: {
        high: "What are the core architectural layers and how do they interact?",
        medium: "How is responsibility divided among the top modules, and where are the dependency boundaries?",
        low: "What design patterns or conventions explain the module organization?",
      },
      entrypoints: {
        high: "How does a user or downstream system invoke this project?",
        medium: "What commands or APIs does the CLI/server expose?",
        low: "What initialization or configuration is required before running?",
      },
      testing: {
        high: "How is correctness validated in this codebase?",
        medium: "Which modules have the most test coverage, and which are under-tested?",
        low: "What test fixtures or mocking strategies are used?",
      },
      evaluation: {
        high: "How does the project measure success or quality?",
        medium: "What metrics, datasets, or judges are used for evaluation?",
        low: "Are there any benchmarks or leaderboards documented?",
      },
      prompts: {
        high: "How are prompts composed, versioned, and rendered at runtime?",
        medium: "What role do system, assistant, and few-shot prompts play?",
        low: "Are prompts statically defined or dynamically assembled?",
      },
      tools: {
        high: "How are tools registered, discovered, and invoked by the agent/runtime?",
        medium: "What is the schema contract between tools and callers?",
        low: "Are tools decorated, wrapped, or provided by a framework?",
      },
    };

    const bySeverity = templates[gap.category] || templates.architecture;
    const question = bySeverity[gap.severity] || bySeverity.medium;

    return {
      category: gap.category,
      question,
      priority: gap.severity,
      evidenceGap: gap.detail,
      suggestedSources: this._sourcesForGap(gap.category),
    };
  }

  _sourcesForGap(category) {
    const map = {
      purpose: ["discovery.metadataFiles", "discovery.manifest", "ranking.topFiles"],
      architecture: ["architecture.nodes", "architecture.edges", "architecture.centrality", "discovery.architectureSignalDirs"],
      entrypoints: ["entrypoints.entrypoints", "ranking.topFiles"],
      testing: ["tests.fileDetails", "tests.byModule", "tests.patterns"],
      evaluation: ["evaluations.evalFiles", "evaluations.patterns", "evaluations.metrics"],
      prompts: ["prompts.prompts", "symbols.strings", "tools.tools"],
      tools: ["tools.tools", "symbols.functions", "architecture.edges"],
    };
    return map[category] || ["discovery", "ranking.topFiles"];
  }
}

// ===========================================================================
// Report Generator — produces an Evidence Brief for LLM analysis
// ===========================================================================

/**
 * The ReportGenerator does NOT produce the final report.
 * It produces a structured **Evidence Brief** (Markdown) that condenses all
 * analyzer outputs into an LLM-friendly format, highlights computable
 * insights (patterns, anomalies, engineering metrics), and ends with an
 * analysis prompt that instructs the LLM on how to write `report.md`.
 *
 * Design principle: Scripts produce facts + computable insights.
 * The LLM produces interpretation, tradeoff analysis, and narrative.
 */
class ReportGenerator {
  constructor(evidenceStore, options = {}) {
    this.store = evidenceStore;
    this.s = evidenceStore._store;
    this.lang = options.lang === "zh" ? "zh" : "en";
  }

  generate() {
    const sections = [
      this._header(),
      this._researchPrinciples(),
      this._executiveBrief(),
      this._architectureInsights(),
      this._aiAgentInsights(),
      this._testingAndEvaluation(),
      this._engineeringMetrics(),
      this._ontologyView(),
      this._negativeFindings(),
      this._readingPriority(),
      this._readingGuide(),
      this._researchPlan(),
      this._llmPrompt(),
    ];
    return sections.filter(Boolean).join("\n\n");
  }

  // -- Helpers --------------------------------------------------------------

  _get(key) {
    return this.s[key] || {};
  }

  _num(value) {
    return typeof value === "number" ? value : Array.isArray(value) ? value.length : 0;
  }

  _pct(numerator, denominator) {
    if (!denominator) return "N/A";
    return ((numerator / denominator) * 100).toFixed(1) + "%";
  }

  _topN(arr, n, key) {
    if (!arr || arr.length === 0) return [];
    return [...arr].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, n);
  }

  // -- Sections -------------------------------------------------------------

  _header() {
    const disc = this._get("discovery");
    const repoName = disc.repoName || "unknown";
    const date = new Date().toISOString().split("T")[0];
    if (this.lang === "zh") {
      return [
        `# 证据简报：${repoName}`,
        "",
        `> 生成时间：${date}，由 research-repo skill（确定性分析）生成。`,
        `> 本简报是 LLM 报告生成的**输入**，并非最终报告。`,
        `> LLM 应阅读本简报，然后按照最后一节的提示撰写 \`report.md\`。`,
      ].join("\n");
    }
    return [
      `# Evidence Brief: ${repoName}`,
      "",
      `> Generated: ${date} by research-repo skill (deterministic analysis).`,
      `> This brief is the **input** for LLM report generation — not the final report.`,
      `> The LLM should read this brief, then write \`report.md\` per the prompt in the last section.`,
    ].join("\n");
  }

  _researchPrinciples() {
    if (this.lang === "zh") {
      return [
        "## 0. 研究原则",
        "",
        "LLM 在撰写报告时必须遵循以下原则：",
        "",
        "- **证据优于假设** — 每个结论必须引用具体证据（文件路径、指标、简报章节）。",
        "- **多个弱信号优于一个强信号** — 交叉验证，避免单一来源偏差。",
        `- **区分事实与解读** — 事实是「代码中存在 X」，解读是「这意味着 Y」。`,
        `- **显式声明不确定性** — 证据不足时说「未知」，不要默认「有」。`,
        `- **分离观察与结论** — 观察是「检测到 X」，结论是「因此 Y」。`,
        "- **不要仅从命名推断架构** — 函数名不等于功能，需查看调用链。",
        "- **测试是一等证据** — 测试代码揭示真实意图和使用方式。",
        "- **示例是可执行文档** — example/ 目录的价值不低于 README。",
        "- **关注可复用模式而非实现细节** — 提取模式，不陷于细节。",
        `- **Negative Finding 同样重要** — 「未找到 X」与「找到 Y」具有同等研究价值。`,
      ].join("\n");
    }
    return [
      "## 0. Research Principles",
      "",
      "The LLM MUST follow these principles when writing the report:",
      "",
      "- **Prefer evidence over assumptions** — Every conclusion must cite specific evidence (file path, metric, brief section).",
      "- **Prefer multiple weak signals over one strong signal** — Cross-validate to avoid single-source bias.",
      "- **Distinguish facts from interpretations** — Fact: \"X exists in code\". Interpretation: \"This means Y\".",
      "- **State uncertainty explicitly** — Say \"Unknown\" when evidence is insufficient. Do NOT default to \"present\".",
      "- **Separate observations from conclusions** — Observation: \"X detected\". Conclusion: \"Therefore Y\".",
      "- **Do not infer architecture from naming alone** — Function names ≠ functionality. Check call chains.",
      "- **Treat tests as first-class evidence** — Test code reveals true intent and usage patterns.",
      "- **Treat examples as executable documentation** — example/ directories are as valuable as READMEs.",
      "- **Prefer reusable patterns over implementation details** — Extract patterns, don't get lost in details.",
      "- **Negative findings are equally important** — \"X not found\" is as valuable as \"Y found\".",
    ].join("\n");
  }

  _ontologyView() {
    const ontology = this.s.ontology;
    if (!ontology) return "";
    const zh = this.lang === "zh";
    const objects = ontology.objects || [];
    const relationships = ontology.relationships || [];
    const objSummary = ontology.objectSummary || {};
    const relSummary = ontology.relSummary || {};

    if (objects.length === 0) return "";

    const lines = zh
      ? [
          "## 5.5. Ontology View（对象视图）",
          "",
          "> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。",
          "> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。",
          "",
          "### 对象类型分布",
          "",
          "| 类型 | 数量 |",
          "|------|------|",
          ...Object.entries(objSummary)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `| ${type} | ${count} |`),
          "",
          "### 关系类型分布",
          "",
          "| 关系 | 数量 |",
          "|------|------|",
          ...Object.entries(relSummary)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `| ${type} | ${count} |`),
          "",
          "### 语义对象（非 function/class）",
          "",
          "| 类型 | 名称 | 文件 | 属性 |",
          "|------|------|------|------|",
          ...objects
            .filter((o) => !["function", "class", "config", "document"].includes(o.type))
            .slice(0, 30)
            .map((o) => {
              const props = Object.entries(o.properties || {})
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
              return `| ${o.type} | ${o.name} | ${o.file} | ${props || "—"} |`;
            }),
          "",
          "### 问题驱动查询示例",
          "",
          "> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）",
          "",
          ...this._buildQueryExamples(objects, relationships, zh),
          "",
          "> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），",
          "> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。",
        ]
      : [
          "## 5.5. Ontology View",
          "",
          "> Inspired by Palantir Ontology: treat the repository as a graph of engineering objects,",
          "> not a collection of files. Every concept is an Object with typed Relationships and linked Evidence.",
          "",
          "### Object Type Distribution",
          "",
          "| Type | Count |",
          "|------|-------|",
          ...Object.entries(objSummary)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `| ${type} | ${count} |`),
          "",
          "### Relationship Type Distribution",
          "",
          "| Relationship | Count |",
          "|--------------|-------|",
          ...Object.entries(relSummary)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `| ${type} | ${count} |`),
          "",
          "### Semantic Objects (non-function/class)",
          "",
          "| Type | Name | File | Properties |",
          "|------|------|------|------------|",
          ...objects
            .filter((o) => !["function", "class", "config", "document"].includes(o.type))
            .slice(0, 30)
            .map((o) => {
              const props = Object.entries(o.properties || {})
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
              return `| ${o.type} | ${o.name} | ${o.file} | ${props || "—" } |`;
            }),
          "",
          "### Question-Driven Query Examples",
          "",
          "> The following are research query paths through the object graph (Question → Object → Relationship → Evidence)",
          "",
          ...this._buildQueryExamples(objects, relationships, zh),
          "",
          "> The LLM should use object-driven language in the report (e.g., \"The Agent object connects",
          "> to the Tool object via the uses relationship\") rather than file-driven language.",
        ];
    return lines.join("\n");
  }

  _buildQueryExamples(objects, relationships, zh) {
    // Build 3-5 query examples based on discovered objects
    const examples = [];
    const agents = objects.filter((o) => o.type === "agent");
    const tools = objects.filter((o) => o.type === "tool");
    const prompts = objects.filter((o) => o.type === "prompt");
    const tests = objects.filter((o) => o.type === "test");
    const runners = objects.filter((o) => o.type === "runner");

    if (agents.length > 0 || runners.length > 0) {
      const agent = (agents[0] || runners[0]);
      const usesRels = relationships.filter((r) => r.source === agent.id && r.type === "uses");
      if (usesRels.length > 0) {
        const targets = usesRels.map((r) => objects.find((o) => o.id === r.target)).filter(Boolean);
        if (zh) {
          examples.push("**查询**: Agent 使用了哪些工具和 prompt？");
          examples.push(`  Agent(${agent.name}) → uses → ${targets.map((t) => `${t.type}(${t.name})`).join(", ")}`);
          examples.push(`  证据: ${agent.file}, ${targets.map((t) => t.file).join(", ")}`);
        } else {
          examples.push("**Query**: What tools and prompts does the Agent use?");
          examples.push(`  Agent(${agent.name}) → uses → ${targets.map((t) => `${t.type}(${t.name})`).join(", ")}`);
          examples.push(`  Evidence: ${agent.file}, ${targets.map((t) => t.file).join(", ")}`);
        }
      }
    }

    if (tests.length > 0) {
      const testedRels = relationships.filter((r) => r.type === "testedBy");
      if (testedRels.length > 0) {
        const example = testedRels[0];
        if (zh) {
          examples.push("**查询**: 哪些对象有测试覆盖？");
          examples.push(`  ${example.source} → testedBy → ${example.target}`);
          examples.push(`  证据: ${example.evidence.join(", ")}`);
        } else {
          examples.push("**Query**: Which objects have test coverage?");
          examples.push(`  ${example.source} → testedBy → ${example.target}`);
          examples.push(`  Evidence: ${example.evidence.join(", ")}`);
        }
      }
    }

    if (prompts.length > 0) {
      if (zh) {
        examples.push(`**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？`);
        examples.push(`  Prompt 对象: ${prompts.length} 个`);
      } else {
        examples.push(`**Query**: How many prompt objects are in the repository? What are their types?`);
        examples.push(`  Prompt objects: ${prompts.length} total`);
      }
    }

    return examples.length > 0 ? examples : (zh ? ["（未找到足够的对象关系来构建查询示例）"] : ["(Insufficient object relationships to build query examples)"]);
  }

  _negativeFindings() {
    const tests = this._get("tests");
    const evals = this._get("evaluations");
    const prompts = this._get("prompts");
    const tools = this._get("tools");
    const ci = this._get("ci");
    const git = this._get("git");
    const arch = this._get("architecture");
    const disc = this._get("discovery");
    const ranking = this._get("ranking");

    const findings = [];
    const zh = this.lang === "zh";

    // Tests
    if (this._num(tests.totalTestFiles) === 0) {
      findings.push(zh ? "未找到测试文件 — 质量验证策略不明" : "No test files found — quality verification strategy unclear");
    }
    // Evaluation
    if (!evals.hasEvaluation) {
      findings.push(zh ? "未找到评估/基准测试基础设施" : "No evaluation/benchmark infrastructure found");
    }
    // Prompts
    if (this._num(prompts.totalPrompts) === 0) {
      findings.push(zh ? "未检测到显式 prompt 定义（可能使用非标准模式或动态组装）" : "No explicit prompt definitions detected (may use non-standard patterns or dynamic assembly)");
    }
    // Tools
    if (this._num(tools.totalTools) === 0) {
      findings.push(zh ? "未检测到显式工具注册（可能使用非装饰器模式）" : "No explicit tool registrations detected (may use non-decorator patterns)");
    }
    // CI
    if (!ci.hasCI) {
      findings.push(zh ? "未检测到 CI/CD 配置" : "No CI/CD configuration detected");
    }
    // Git
    if (this._num(git.totalCommits) === 0) {
      findings.push(zh ? "无 Git 历史记录（可能是新仓库或非 Git 项目）" : "No Git history (may be a new repo or non-Git project)");
    }
    // Cycles (positive negative)
    const cycles = arch.cycles || [];
    if (cycles.length === 0 && this._num(arch.totalNodes) > 0) {
      findings.push(zh ? "未检测到 import 循环 — 模块分层清晰" : "No import cycles detected — clean module layering");
    }
    // Documentation & metadata — use discovery.metadataFiles (source of truth)
    // NOTE: Do NOT use ranking.topFiles — it is a ranked subset and may omit
    // root-level LICENSE/README even when they exist (false negatives observed
    // in 6/8 ref-only repos). metadataFiles is populated by MetadataRules from
    // the actual file tree.
    const metadataFiles = (disc.metadataFiles || []).map((f) => f.toLowerCase());
    const hasReadme = metadataFiles.some((f) => f.startsWith("readme"));
    if (!hasReadme) {
      findings.push(zh ? "未找到 README 文件" : "No README file found");
    }
    const hasLicense = metadataFiles.some((f) => f.startsWith("license"));
    if (!hasLicense) {
      findings.push(zh ? "未找到 LICENSE 文件" : "No LICENSE file found");
    }
    const hasContributing = metadataFiles.some((f) => f.startsWith("contributing"));
    if (!hasContributing) {
      findings.push(zh ? "未找到 CONTRIBUTING 指南（外部贡献流程不明）" : "No CONTRIBUTING guide found (external contribution process unclear)");
    }
    const hasSecurity = metadataFiles.some((f) => f.startsWith("security"));
    if (!hasSecurity) {
      findings.push(zh ? "未找到 SECURITY 策略（漏洞报告流程不明）" : "No SECURITY policy found (vulnerability reporting process unclear)");
    }
    const hasChangelog = metadataFiles.some((f) => f.startsWith("changelog"));
    if (!hasChangelog) {
      findings.push(zh ? "未找到 CHANGELOG（版本演进缺乏结构化记录）" : "No CHANGELOG found (version evolution lacks structured record)");
    }
    // Agent instructions (AI-agent readiness)
    const agentFiles = (disc.agentFiles || []).map((f) => f.toLowerCase());
    if (agentFiles.length === 0) {
      findings.push(zh ? "未找到 AI Agent 指令文件（AGENTS.md / CLAUDE.md 等）" : "No AI Agent instruction files found (AGENTS.md / CLAUDE.md etc.)");
    }
    // Architecture
    if (this._num(arch.totalNodes) === 0) {
      findings.push(zh ? "⚠ 架构图为空 — AST 解析可能失败" : "⚠ Architecture graph is empty — AST parsing may have failed");
    }

    if (findings.length === 0) {
      findings.push(zh ? "无明显缺口检测到（不代表无缺口，仅表示脚本未检测到）" : "No significant gaps detected (does not mean none exist — only that scripts did not detect them)");
    }

    const header = zh ? "## 6. Negative Findings（未找到什么）" : "## 6. Negative Findings (What Was NOT Found)";
    const note = zh
      ? "> 这些 \"未找到\" 的发现同样重要 — 它们防止 LLM 默认假设 \"存在\"。"
      : "> These \"not found\" findings are equally important — they prevent the LLM from defaulting to \"present\".";
    return [header, "", note, "", ...findings.map((f) => `- ${f}`)].join("\n");
  }

  _readingGuide() {
    const ranking = this._get("ranking");
    const topFiles = ranking.topFiles || [];
    if (topFiles.length === 0) return "";

    const zh = this.lang === "zh";
    // 30-minute plan: ROOT README + top-scoring source files.
    // NOTE: Do NOT include sub-package READMEs (e.g., sdk/go/README.md,
    // blog-site/README.md) — they add noise without revealing architecture.
    // Only root-level README/LICENSE/manifest qualify as "quick orientation".
    const isRootMeta = (p) =>
      /^(readme|license|package\.json|pyproject\.toml|cargo\.toml|agents\.md|claude\.md)$/i.test(p);
    const isSourceFile = (p) =>
      /\.(ts|tsx|js|jsx|py|rs|go|java|rb|ex|exs|zig|nim|kt|swift)$/i.test(p) &&
      !/\.(test|spec)\./i.test(p);
    const quick = [];
    // 1. Root README/manifest first
    for (const f of topFiles) {
      if (isRootMeta(f.path)) quick.push(f);
      if (quick.length >= 2) break;
    }
    // 2. Fill with top-scoring source files (not tests, not sub-READMEs)
    for (const f of topFiles) {
      if (quick.length >= 5) break;
      if (quick.includes(f)) continue;
      if (/\/readme/i.test(f.path)) continue; // skip sub-package READMEs
      if (!isSourceFile(f.path)) continue;
      quick.push(f);
    }
    // 3. Fallback: if still < 3, use top files regardless
    if (quick.length < 3) {
      for (const f of topFiles) {
        if (quick.length >= 5) break;
        if (quick.includes(f)) continue;
        quick.push(f);
      }
    }

    // 2-hour plan: + next 10 source files + key tests
    const deep = topFiles
      .filter((f) => !quick.includes(f))
      .filter((f) => isSourceFile(f.path) || /\/readme/i.test(f.path))
      .slice(0, 10);

    const lines = zh
      ? [
          "## 8. Reading Guide（阅读指南）",
          "",
          "### 30 分钟速览",
          "如果只有 30 分钟，阅读以下文件：",
          "",
          ...quick.map((f, i) => `${i + 1}. \`${f.path}\` — ${f.reasons.join("; ")}`),
          "",
          "### 2 小时深入",
          "继续阅读：",
          "",
          ...deep.map((f, i) => `${i + 1}. \`${f.path}\` — ${f.reasons.join("; ")}`),
          "",
          "> LLM 应在报告的「阅读指南」章节中复现并扩展此列表，按洞察密度排序。",
        ]
      : [
          "## 8. Reading Guide",
          "",
          "### 30-Minute Quick Look",
          "If you only have 30 minutes, read these files:",
          "",
          ...quick.map((f, i) => `${i + 1}. \`${f.path}\` — ${f.reasons.join("; ")}`),
          "",
          "### 2-Hour Deep Dive",
          "Then continue with:",
          "",
          ...deep.map((f, i) => `${i + 1}. \`${f.path}\` — ${f.reasons.join("; ")}`),
          "",
          "> The LLM should reproduce and expand this list in the report's Reading Guide section, ordered by insight density.",
        ];
    return lines.join("\n");
  }

  _executiveBrief() {
    const disc = this._get("discovery");
    const git = this._get("git");
    const ci = this._get("ci");
    const manifest = disc.manifest || {};
    const fileCount = disc.fileCount || {};
    const topLangs = Object.entries(fileCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([ext, count]) => `${ext} (${count})`)
      .join(", ");
    const totalSource = this._num(disc.totalSourceFiles);

    const lines = [
      "## 1. Executive Brief",
      "",
      `| Dimension | Value |`,
      `|-----------|-------|`,
      `| Repository | ${disc.repoName || "unknown"} |`,
      `| Manifest | ${manifest.entry || "none"} (${manifest.language || "unknown"}) |`,
      `| Version | ${manifest.version || "N/A"} |`,
      `| Source files | ${totalSource} |`,
      `| Top languages | ${topLangs || "N/A"} |`,
      `| Top-level dirs | ${(disc.topLevelDirs || []).slice(0, 10).join(", ")} |`,
      `| Commits | ${this._num(git.totalCommits)} |`,
      `| Contributors | ${this._num(git.totalContributors)} |`,
      `| CI provider | ${ci.hasCI ? ci.provider || "detected" : "none"} |`,
    ];

    // Derived: project stage
    const commits = this._num(git.totalCommits);
    const contributors = this._num(git.totalContributors);
    let stage = "early-stage";
    if (commits > 500 && contributors > 5) stage = "mature";
    else if (commits > 100 || contributors > 2) stage = "growing";
    lines.push(`| **Project stage** | ${stage} (${commits} commits, ${contributors} contributors) |`);

    // Derived: language ecosystem
    const lang = manifest.language || "unknown";
    const ecosystems = {
      python: "Python ecosystem",
      typescript: "TypeScript/Node ecosystem",
      javascript: "JavaScript/Node ecosystem",
      rust: "Rust ecosystem",
      go: "Go ecosystem",
    };
    lines.push(`| **Ecosystem** | ${ecosystems[lang] || lang} |`);

    return lines.join("\n");
  }

  _architectureInsights() {
    const arch = this._get("architecture");
    const symbols = this._get("symbols");
    const entrypoints = this._get("entrypoints");
    const nodes = this._num(arch.totalNodes);
    const edges = this._num(arch.totalEdges);
    const cycles = arch.cycles || [];
    const funcs = this._num(symbols.totalFunctions);
    const classes = this._num(symbols.totalClasses);

    if (nodes === 0) {
      return [
        "## 2. Architecture Insights",
        "",
        "**WARNING**: No architecture graph was built. This may indicate AST parsing failures.",
        "The LLM should investigate file structure manually from discovery data.",
      ].join("\n");
    }

    const edgeNodeRatio = nodes > 0 ? (edges / nodes).toFixed(2) : "N/A";
    const lines = [
      "## 2. Architecture Insights",
      "",
      `| Metric | Value | Interpretation |`,
      `|--------|-------|----------------|`,
      `| Modules | ${nodes} | — |`,
      `| Import edges | ${edges} | edge/node ratio: ${edgeNodeRatio} |`,
      `| Import cycles | ${cycles.length} | ${cycles.length > 0 ? "⚠ tight coupling detected" : "no cycles — clean layering"} |`,
      `| Functions | ${funcs} | ${funcs > 0 ? `${(funcs / nodes).toFixed(1)} funcs/module` : "N/A"} |`,
      `| Classes | ${classes} | ${classes > 0 ? `${(classes / nodes).toFixed(1)} classes/module` : "N/A"} |`,
    ];

    // Coupling assessment
    const ratio = edges / nodes;
    let coupling = "low";
    if (ratio > 2.0) coupling = "high — tightly coupled, changes ripple widely";
    else if (ratio > 1.0) coupling = "moderate — typical for mid-size projects";
    lines.push("");
    lines.push(`**Coupling assessment**: edge/node ratio ${edgeNodeRatio} → ${coupling}`);

    // Cycles detail
    if (cycles.length > 0) {
      lines.push("");
      lines.push("**Import cycles** (potential design issues):");
      for (const cycle of cycles.slice(0, 5)) {
        lines.push(`  - \`${cycle.join(" → ")}\``);
      }
      if (cycles.length > 5) lines.push(`  - ... and ${cycles.length - 5} more`);
    }

    // Centrality — most depended-upon modules
    const topInDegree = this._topN(arch.centrality?.topByInDegree, 10, "value");
    if (topInDegree.length > 0) {
      lines.push("");
      lines.push("**Most depended-upon modules** (high in-degree = core/foundation):");
      for (const { id, value } of topInDegree) {
        lines.push(`  - \`${id}\` (in-degree: ${value})`);
      }
    }

    // PageRank — most influential modules
    const topPageRank = this._topN(arch.centrality?.topByPageRank, 10, "value");
    if (topPageRank.length > 0) {
      lines.push("");
      lines.push("**Most influential modules** (high PageRank = architectural bottleneck):");
      for (const { id, value } of topPageRank) {
        lines.push(`  - \`${id}\` (PageRank: ${value.toFixed(4)})`);
      }
    }

    // Entrypoints summary
    const eps = entrypoints.entrypoints || [];
    if (eps.length > 0) {
      const byType = {};
      for (const ep of eps) byType[ep.type] = (byType[ep.type] || 0) + 1;
      const summary = Object.entries(byType)
        .map(([t, c]) => `${t}: ${c}`)
        .join(", ");
      lines.push("");
      lines.push(`**Entry points**: ${eps.length} total (${summary})`);
      // Sample entrypoints
      lines.push("  Sample entry points:");
      for (const ep of eps.slice(0, 8)) {
        lines.push(`  - [${ep.type}] \`${ep.path}\` — ${ep.reason}`);
      }
    }

    return lines.join("\n");
  }

  _aiAgentInsights() {
    const prompts = this._get("prompts");
    const tools = this._get("tools");
    const symbols = this._get("symbols");
    const totalPrompts = this._num(prompts.totalPrompts);
    const totalTools = this._num(tools.totalTools);

    if (totalPrompts === 0 && totalTools === 0) {
      // Check if there are prompt-like strings
      const promptStrings = (symbols.strings || []).filter(
        (s) => /prompt|system|instruction/i.test(s.name || "")
      );
      if (promptStrings.length === 0) {
        return [
          "## 3. AI / Agent Design",
          "",
          "No prompts or tools detected. This may not be an AI/Agent project,",
          "or prompt/tool definitions use non-standard patterns.",
        ].join("\n");
      }
    }

    const lines = ["## 3. AI / Agent Design", ""];

    // Prompt analysis
    if (totalPrompts > 0) {
      const promptByType = {};
      for (const p of prompts.prompts || []) {
        promptByType[p.type] = (promptByType[p.type] || 0) + 1;
      }
      lines.push(`**Prompts**: ${totalPrompts} detected`);
      lines.push(`  By type: ${Object.entries(promptByType).map(([t, c]) => `${t} (${c})`).join(", ")}`);
      // Sample prompts
      lines.push("  Sample prompts:");
      for (const p of (prompts.prompts || []).slice(0, 5)) {
        const snippet = (p.snippet || "").slice(0, 120);
        lines.push(`  - [${p.type}] \`${p.file}:${p.line}\` ${snippet}...`);
      }
    }

    // Tool analysis
    if (totalTools > 0) {
      const toolByFw = {};
      for (const t of tools.tools || []) {
        toolByFw[t.framework] = (toolByFw[t.framework] || 0) + 1;
      }
      lines.push("");
      lines.push(`**Tools**: ${totalTools} detected`);
      lines.push(`  By framework: ${Object.entries(toolByFw).map(([f, c]) => `${f} (${c})`).join(", ")}`);
      // Sample tools
      lines.push("  Sample tools:");
      for (const t of (tools.tools || []).slice(0, 8)) {
        lines.push(`  - [${t.framework}] \`${t.name}\` — \`${t.file}\``);
      }
    }

    // Derived: design archetype
    if (totalPrompts > 0 || totalTools > 0) {
      lines.push("");
      lines.push("**Design archetype** (derived):");
      if (totalTools > 0 && totalPrompts > 0) {
        const ratio = (totalTools / totalPrompts).toFixed(1);
        lines.push(`  - Tools/Prompts ratio: ${ratio} → ${ratio > 3 ? "tool-heavy design (capabilities primarily tool-driven)" : ratio < 0.3 ? "prompt-heavy design (capabilities primarily instruction-driven)" : "balanced prompt+tool design"}`);
      } else if (totalTools > 0) {
        lines.push("  - Tool-only design (no explicit prompts detected) — capabilities are entirely tool-driven");
      } else if (totalPrompts > 0) {
        lines.push("  - Prompt-only design (no explicit tools detected) — capabilities are instruction-driven");
      }
    }

    return lines.join("\n");
  }

  _testingAndEvaluation() {
    const tests = this._get("tests");
    const evals = this._get("evaluations");
    const disc = this._get("discovery");
    const totalTestFiles = this._num(tests.totalTestFiles);
    const totalTestFuncs = this._num(tests.totalTestFunctions);
    const totalSource = this._num(disc.totalSourceFiles);
    const testRatio = totalSource > 0 ? (totalTestFiles / totalSource).toFixed(2) : "N/A";

    const lines = ["## 4. Testing & Evaluation", ""];

    // Testing
    if (totalTestFiles > 0) {
      lines.push(`**Testing**: ${totalTestFiles} test files, ${totalTestFuncs} test functions`);
      lines.push(`  Test/source ratio: ${testRatio} → ${testRatio !== "N/A" && parseFloat(testRatio) < 0.15 ? "⚠ below typical 0.15 threshold" : "adequate coverage"}`);
      // Test patterns
      if (tests.patterns && tests.patterns.length > 0) {
        lines.push(`  Test patterns detected: ${tests.patterns.join(", ")}`);
      }
      // Test by module
      if (tests.byModule && Object.keys(tests.byModule).length > 0) {
        const topModules = Object.entries(tests.byModule)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5);
        lines.push("  Tests by module (top 5):");
        for (const [mod, count] of topModules) {
          lines.push(`    - \`${mod}\`: ${count} tests`);
        }
      }
    } else {
      lines.push("**Testing**: No test files detected. ⚠ This is a significant quality risk.");
    }

    // Evaluation
    lines.push("");
    if (evals.hasEvaluation) {
      lines.push(`**Evaluation**: Detected`);
      if (evals.evalFiles && evals.evalFiles.length > 0) {
        lines.push(`  Eval files: ${evals.evalFiles.length}`);
        for (const f of evals.evalFiles.slice(0, 5)) {
          lines.push(`    - \`${f}\``);
        }
      }
      if (evals.metrics && evals.metrics.length > 0) {
        lines.push(`  Metrics: ${evals.metrics.join(", ")}`);
      }
      if (evals.patterns && evals.patterns.length > 0) {
        lines.push(`  Patterns: ${evals.patterns.join(", ")}`);
      }
    } else {
      lines.push("**Evaluation**: No evaluation/benchmark artifacts detected.");
      lines.push("  The LLM should investigate whether evaluation is done externally or is absent.");
    }

    return lines.join("\n");
  }

  _engineeringMetrics() {
    const arch = this._get("architecture");
    const tests = this._get("tests");
    const git = this._get("git");
    const ci = this._get("ci");
    const symbols = this._get("symbols");
    const disc = this._get("discovery");

    const nodes = this._num(arch.totalNodes);
    const edges = this._num(arch.totalEdges);
    const cycles = (arch.cycles || []).length;
    const funcs = this._num(symbols.totalFunctions);
    const calls = this._num(symbols.totalCalls);
    const testFiles = this._num(tests.totalTestFiles);
    const commits = this._num(git.totalCommits);
    const contributors = this._num(git.totalContributors);

    const lines = [
      "## 5. Engineering Metrics",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Modules (AST nodes) | ${nodes} |`,
      `| Import edges | ${edges} |`,
      `| Import cycles | ${cycles} |`,
      `| Functions indexed | ${funcs} |`,
      `| Call relations | ${calls} |`,
      `| Test files | ${testFiles} |`,
      `| Total commits | ${commits} |`,
      `| Contributors | ${contributors} |`,
    ];

    // Derived complexity indicators
    lines.push("");
    lines.push("**Derived indicators**:");
    const ratio = nodes > 0 ? edges / nodes : 0;
    lines.push(`  - Coupling density: ${ratio.toFixed(2)} edges/module`);
    if (cycles > 0) {
      lines.push(`  - Cycle count: ${cycles} — ${cycles > 3 ? "⚠ multiple cycles suggest architectural debt" : "minor coupling issues"}`);
    }
    if (funcs > 0 && calls > 0) {
      lines.push(`  - Call density: ${(calls / funcs).toFixed(1)} calls/function`);
    }
    if (commits > 0) {
      const commitsPerContributor = contributors > 0 ? (commits / contributors).toFixed(0) : "N/A";
      lines.push(`  - Commit intensity: ${commitsPerContributor} commits/contributor`);
    }

    // CI assessment
    if (ci.hasCI) {
      lines.push(`  - CI: ${ci.provider || "detected"} with ${(ci.workflows || []).length} workflow(s)`);
    } else {
      lines.push("  - CI: none detected ⚠");
    }

    // Architecture signal dirs
    const signalDirs = disc.architectureSignalDirs || [];
    if (signalDirs.length > 0) {
      lines.push("");
      lines.push("**Architecture signal directories** (high structural importance):");
      for (const d of signalDirs.slice(0, 10)) {
        lines.push(`  - \`${d}\``);
      }
    }

    return lines.join("\n");
  }

  _readingPriority() {
    const ranking = this._get("ranking");
    const topFiles = ranking.topFiles || [];
    if (topFiles.length === 0) return "";

    const lines = ["## 7. Reading Priority (Top Files)", ""];
    lines.push("Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):");
    lines.push("");
    lines.push("| # | File | Score | Why |");
    lines.push("|---|------|-------|-----|");
    for (let i = 0; i < Math.min(topFiles.length, 20); i++) {
      const f = topFiles[i];
      lines.push(`| ${i + 1} | \`${f.path}\` | ${f.score} | ${f.reasons.join("; ")} |`);
    }

    lines.push("");
    lines.push("**LLM guidance**: Read files in this order. The first 5-10 files typically reveal");
    lines.push("the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.");

    return lines.join("\n");
  }

  _researchPlan() {
    const plan = this._get("plan");
    const questions = this._get("questions");
    const lines = ["## 9. Research Plan & Open Questions", ""];

    // Hypotheses
    const hypotheses = plan.hypotheses || [];
    if (hypotheses.length > 0) {
      lines.push("### Hypotheses (from evidence)");
      for (const h of hypotheses) {
        const icon = h.confidence === "high" ? "✓" : h.confidence === "medium" ? "?" : "⚠";
        lines.push(`- **${icon} ${h.id}** (${h.confidence}): ${h.statement}`);
        if (h.gaps && h.gaps.length > 0) {
          lines.push(`  - Gaps: ${h.gaps.join("; ")}`);
        }
      }
    }

    // Questions
    const qs = questions.questions || [];
    if (qs.length > 0) {
      lines.push("");
      lines.push("### Open Questions (from evidence gaps)");
      for (const q of qs) {
        lines.push(`- [${q.priority}] **${q.category}**: ${q.question}`);
      }
    }

    return lines.join("\n");
  }

  _llmPrompt() {
    const disc = this._get("discovery");
    const repoName = disc.repoName || "this repository";
    if (this.lang === "zh") {
      return [
        "---",
        "",
        "## LLM 分析指令",
        "",
        `你是一位经验丰富的软件架构师。基于上述证据，为 **${repoName}** 撰写一份工程研究报告。`,
        `请将报告保存为工作目录下的 \`report.md\`。`,
        "",
        "### 核心方法论：Ontology-driven Research（对象驱动研究）",
        "",
        "将仓库视为工程对象图（简报 §5.5），而非文件集合。每个重要概念是一个 Object（Agent、Tool、Prompt、Test 等），",
        "Object 之间有语义关系（uses、testedBy、configuredBy 等）。",
        "",
        "Research Trace 应使用对象驱动语言：",
        `- ❌「agent.ts 导入了 tool.ts」`,
        `- ✅「Agent 对象通过 uses 关系连接到 Tool 对象」`,
        "",
        "查询路径：Question → Object → Relationship → Evidence → Answer",
        "",
        "### 核心方法论：Research Trace",
        "",
        "**每个重要结论必须展示完整推导链条**，而非仅给出结论。格式如下：",
        "",
        "```markdown",
        "### [结论标题]",
        "",
        "**问题**: 这个结论回答了什么问题？",
        "",
        "**证据**:",
        "- 证据1（文件路径 + 简报章节）",
        "- 证据2（指标 + 解读）",
        "- 证据3（交叉验证来源）",
        "",
        "**分析**: 基于证据的推理过程。区分事实与解读。",
        "",
        "**反证**: 是否有矛盾证据？如无，说明「未发现反证」。",
        "",
        "**结论**: 推导出的结论。",
        "",
        "**置信度**: 高/中/低 — 说明为何这个置信度。",
        "```",
        "",
        "### 报告结构",
        "",
        "1. **执行摘要** — 这是什么项目？最有趣的发现是什么？（不超过 3 段）",
        "",
        "2. **Research Traces** — 对 5-8 个核心发现，每个使用上述 Research Trace 格式。",
        "   选择最有研究价值的发现，而非面面俱到。例如：",
        "   - 核心架构模式是什么？",
        "   - Agent 如何防止无限循环？",
        "   - 上下文工程策略是什么？",
        "   - 测试策略是否充分？",
        "   - 是否有评估基础设施？",
        "",
        "3. **Negative Findings** — 明确列出「未找到什么」。这些不是缺陷，而是研究边界。",
        "   - 引用简报 §6 的发现",
        "   - 补充你在阅读源码时发现的「未找到」",
        "   - 每条说明：为什么这个缺失重要？",
        "",
        "4. **Architecture Smells** — 潜在的设计风险。注意：都是「Potential」，不是断言。",
        "   - Potential Tight Coupling（引用循环数据）",
        "   - Potential Over-engineering",
        "   - Potential Hidden Complexity",
        "   - Potential Scalability Issues",
        "   每条说明：为什么这是潜在风险？证据是什么？置信度如何？",
        "",
        "5. **Interesting Decisions** — 几个「看起来奇怪但可能很聪明」的设计决策。",
        "   每条包含：决策内容 / 为什么有趣 / 替代方案 / 权衡。",
        "",
        "6. **Repository Positioning** — 生态定位（不是 Feature Matrix）。",
        "   | 维度 | 当前成熟度 | 说明 |",
        "   维度包括：Planning, Execution, Memory, Evaluation, Guardrails, Prompt, Tooling, Observability",
        "   成熟度：Emerging / Common / Advanced / Unique",
        "",
        "7. **Reusable Pattern Catalog** — 可复用模式目录（结构化表格）。",
        "   | 模式 | 描述 | 位置 | 可复用性 |",
        "   可复用性：✅ 通用 / ⚠ 需适配 / ❌ 特定场景",
        "",
        "8. **Architecture Evolution** — 架构演进（基于 Git 历史）。",
        "   - 主要重构事件",
        "   - 已移除的设计",
        "   - 已弃用的 API",
        "   - 历史决策的痕迹",
        "",
        "9. **Reading Guide** — 阅读指南（基于简报 §8 扩展）。",
        "   - 30 分钟速览：最关键的 5 个文件",
        "   - 2 小时深入：+ 10 个文件",
        "   - 按洞察密度排序，说明每个文件为什么值得读",
        "",
        "10. **Open Questions** — 待解决问题（用于第二轮研究）。",
        "    每条包含：问题 / 为什么重要 / 建议的调查方法。",
        "",
        "### 规则",
        "",
        "- 遵循简报 §0 的研究原则。",
        "- 每个论断必须引用证据（文件路径、简报章节、指标）。",
        "- 对主要结论使用高/中/低置信度标签，并说明原因。",
        "- 没有证据时说「未知」，不要默认「存在」。",
        "- 不要只复述数字 — 解释它们对工程决策意味着什么。",
        "- Negative Findings 与正面发现同等重要。",
        "- Architecture Smells 使用「Potential」而非断言。",
        "- Interesting Decisions 关注「为什么有趣」而非「好不好」。",
        "",
        "### 用于深入调查的证据文件",
        "",
        "以下 JSON 文件包含完整证据（如需更多细节请阅读）：",
        "- `evidence-store/full.json` — 完整分析输出",
        "- `evidence-store/symbols.json` — 函数/类/导入/调用索引",
        "- `evidence-store/architecture.json` — 依赖图 + 中心性",
        "- `evidence-store/interesting_files.json` — 排序后的文件阅读优先级",
      ].join("\n");
    }
    return [
      "---",
      "",
      "## LLM Analysis Instructions",
      "",
      `You are an experienced software architect. Based on the evidence above, write an engineering`,
      `research report for **${repoName}**. Save it as \`report.md\` in the working folder.`,
      "",
      "### Core Methodology: Ontology-driven Research",
      "",
      "Treat the repository as a graph of engineering objects (brief §5.5), not a collection of files.",
      "Every significant concept is an Object (Agent, Tool, Prompt, Test, etc.) with semantic",
      "Relationships (uses, testedBy, configuredBy, etc.).",
      "",
      "Research Traces should use object-driven language:",
      "- ❌ \"agent.ts imports tool.ts\"",
      "- ✅ \"The Agent object connects to the Tool object via the uses relationship\"",
      "",
      "Query path: Question → Object → Relationship → Evidence → Answer",
      "",
      "### Core Methodology: Research Trace",
      "",
      "**Every important conclusion must show its full derivation chain**, not just the conclusion.",
      "Use this format:",
      "",
      "```markdown",
      "### [Conclusion Title]",
      "",
      "**Question**: What question does this conclusion answer?",
      "",
      "**Evidence**:",
      "- Evidence 1 (file path + brief section)",
      "- Evidence 2 (metric + interpretation)",
      "- Evidence 3 (cross-validation source)",
      "",
      "**Analysis**: Reasoning based on evidence. Distinguish facts from interpretations.",
      "",
      "**Counter Evidence**: Any contradictory evidence? If none, state \"No counter evidence found\".",
      "",
      "**Conclusion**: The derived conclusion.",
      "",
      "**Confidence**: High/Medium/Low — explain why this confidence level.",
      "```",
      "",
      "### Report Structure",
      "",
      "1. **Executive Summary** — What is this project? What's the most interesting finding? (max 3 paragraphs)",
      "",
      "2. **Research Traces** — For 5-8 core findings, use the Research Trace format above.",
      "   Choose the most research-valuable findings, not everything. Examples:",
      "   - What is the core architecture pattern?",
      "   - How does the Agent prevent infinite loops?",
      "   - What is the context engineering strategy?",
      "   - Is the testing strategy sufficient?",
      "   - Is there evaluation infrastructure?",
      "",
      "3. **Negative Findings** — Explicitly list what was NOT found. These are not flaws but research boundaries.",
      "   - Reference brief §6 findings",
      "   - Add any \"not found\" you discovered while reading source code",
      "   - For each: why does this absence matter?",
      "",
      "4. **Architecture Smells** — Potential design risks. Note: all are \"Potential\", not assertions.",
      "   - Potential Tight Coupling (cite cycle data)",
      "   - Potential Over-engineering",
      "   - Potential Hidden Complexity",
      "   - Potential Scalability Issues",
      "   For each: why is this a potential risk? What's the evidence? Confidence?",
      "",
      "5. **Interesting Decisions** — A few \"seems odd but might be clever\" design decisions.",
      "   Each includes: Decision / Why interesting / Alternative / Tradeoff.",
      "",
      "6. **Repository Positioning** — Ecological positioning (NOT a feature matrix).",
      "   | Dimension | Current Maturity | Notes |",
      "   Dimensions: Planning, Execution, Memory, Evaluation, Guardrails, Prompt, Tooling, Observability",
      "   Maturity: Emerging / Common / Advanced / Unique",
      "",
      "7. **Reusable Pattern Catalog** — Structured pattern table.",
      "   | Pattern | Description | Location | Reusability |",
      "   Reusability: ✅ Universal / ⚠ Needs adaptation / ❌ Context-specific",
      "",
      "8. **Architecture Evolution** — Based on Git history.",
      "   - Major refactor events",
      "   - Removed designs",
      "   - Deprecated APIs",
      "   - Traces of historical decisions",
      "",
      "9. **Reading Guide** — Based on brief §8, expanded.",
      "   - 30-minute quick look: 5 most critical files",
      "   - 2-hour deep dive: + 10 files",
      "   - Ordered by insight density, explain why each file is worth reading",
      "",
      "10. **Open Questions** — For further investigation (second round).",
      "    Each includes: Question / Why it matters / Suggested investigation method.",
      "",
      "### Rules",
      "",
      "- Follow the research principles in brief §0.",
      "- Every claim must cite evidence (file path, brief section, metric).",
      "- Use High/Medium/Low confidence labels for major conclusions, with explanation.",
      "- Say \"Unknown\" when evidence is insufficient. Do NOT default to \"present\".",
      "- Don't just restate numbers — interpret what they MEAN for engineering decisions.",
      "- Negative Findings are as important as positive findings.",
      "- Architecture Smells use \"Potential\" not assertions.",
      "- Interesting Decisions focus on \"why interesting\" not \"good or bad\".",
      "",
      "### Evidence Files for Deeper Investigation",
      "",
      "The following JSON files contain full evidence (read them if you need more detail):",
      "- `evidence-store/full.json` — complete analysis output",
      "- `evidence-store/symbols.json` — function/class/import/call index",
      "- `evidence-store/architecture.json` — dependency graph + centrality",
      "- `evidence-store/interesting_files.json` — ranked file reading priority",
    ].join("\n");
  }
}

class AnalyzerPipeline {
  constructor(analyzers = ANALYZERS) {
    this.analyzers = analyzers;
    this._byId = new Map(analyzers.map((a) => [a.id, a]));
  }

  getAnalyzer(id) {
    return this._byId.get(id);
  }

  /**
   * Run a single analyzer by id.
   * @param {string} id
   * @param {RepositoryContext} ctx
   * @returns {Promise<unknown>} the analyzer's result
   */
  async run(id, ctx) {
    const analyzer = this._byId.get(id);
    if (!analyzer) {
      throw new Error(`Unknown analyzer: ${id}`);
    }
    if (!analyzer.supports(ctx)) {
      return { skipped: true, reason: "not supported for this repository" };
    }
    const store = {};
    await analyzer.analyze(ctx, store, { command: id });
    return store[id];
  }

  /**
   * Run all analyzers and return a graph-based EvidenceStore.
   * Also synthesizes a research plan and gap-driven questions from the evidence.
   * @param {RepositoryContext} ctx
   * @returns {Promise<EvidenceStore>}
   */
  async runAll(ctx) {
    const store = {};
    for (const analyzer of this.analyzers) {
      if (!analyzer.supports(ctx)) {
        store[analyzer.id] = { skipped: true, reason: "not supported for this repository" };
        continue;
      }
      await analyzer.analyze(ctx, store, { command: analyzer.id });
    }
    const evidenceStore = new EvidenceStore(store);
    // Ontology: classify objects and build semantic relationships
    const classifier = new ObjectClassifier();
    const { objects, summary: objectSummary } = classifier.classify(store);
    const relBuilder = new RelationshipBuilder();
    const { relationships, summary: relSummary } = relBuilder.build(objects, store);
    store.ontology = { objects, relationships, objectSummary, relSummary };
    const planner = new ResearchPlanner(DEFAULT_RESEARCH_GOAL, evidenceStore);
    store.plan = planner.plan();
    const questionGenerator = new QuestionGenerator(evidenceStore);
    store.questions = questionGenerator.generate();
    const reportGenerator = new ReportGenerator(evidenceStore, { lang: ctx.lang || "en" });
    store.report = reportGenerator.generate();
    store._meta = {
      lastCommit: ctx.isGitRepo ? ctx.git("rev-parse", "HEAD").trim() : null,
      analyzedAt: new Date().toISOString(),
      repoPath: ctx.repoPath,
      incremental: false,
    };
    return evidenceStore;
  }
}

// ---------------------------------------------------------------------------
// Incremental analysis merge utilities
//
// Used by the `update` command to merge previously-saved analysis results with
// freshly-analyzed changed files. Per-file evidence (symbols, entrypoints,
// prompts, tools, tests) is merged by file path; full-scan evidence
// (discovery, git, ci) is replaced by the new run.
// ---------------------------------------------------------------------------

function mergeAnalysisResults(prevStore, newStore, changedFiles) {
  const merged = {};

  // discovery, git, ci: 直接用新的（全量扫描）
  merged.discovery = newStore.discovery || prevStore.discovery;
  merged.git = newStore.git || prevStore.git;
  merged.ci = newStore.ci || prevStore.ci;

  // symbols: 按文件过滤合并
  if (prevStore.symbols && newStore.symbols) {
    merged.symbols = mergeByKey(
      prevStore.symbols,
      newStore.symbols,
      changedFiles,
      ["functions", "classes", "imports", "calls", "strings"],
      "file"
    );
  } else {
    merged.symbols = newStore.symbols || prevStore.symbols;
  }

  // entrypoints: 按 path 过滤合并
  if (prevStore.entrypoints && newStore.entrypoints) {
    merged.entrypoints = mergeByKey(
      prevStore.entrypoints,
      newStore.entrypoints,
      changedFiles,
      ["entrypoints"],
      "path"
    );
  } else {
    merged.entrypoints = newStore.entrypoints || prevStore.entrypoints;
  }

  // prompts: 按 file 过滤合并
  if (prevStore.prompts && newStore.prompts) {
    merged.prompts = mergeByKey(
      prevStore.prompts,
      newStore.prompts,
      changedFiles,
      ["prompts"],
      "file"
    );
  } else {
    merged.prompts = newStore.prompts || prevStore.prompts;
  }

  // tools: 按 file 过滤合并
  if (prevStore.tools && newStore.tools) {
    merged.tools = mergeByKey(
      prevStore.tools,
      newStore.tools,
      changedFiles,
      ["tools"],
      "file"
    );
  } else {
    merged.tools = newStore.tools || prevStore.tools;
  }

  // tests: 按 file 过滤合并（testFiles 数组中每项有 file 属性）
  if (prevStore.tests && newStore.tests) {
    merged.tests = mergeByKey(
      prevStore.tests,
      newStore.tests,
      changedFiles,
      ["testFiles"],
      "file"
    );
    // 重新计算聚合计数
    if (merged.tests.testFiles) {
      merged.tests.totalTestFiles = merged.tests.testFiles.length;
      merged.tests.totalTestFunctions = merged.tests.testFiles.reduce(
        (sum, f) => sum + (f.testCount || 0),
        0
      );
    }
  } else {
    merged.tests = newStore.tests || prevStore.tests;
  }

  // evaluations: evalFiles 是字符串数组
  if (prevStore.evaluations && newStore.evaluations) {
    const prevEvalFiles = (prevStore.evaluations.evalFiles || []).filter(
      (f) => !changedFiles.has(f)
    );
    const newEvalFiles = newStore.evaluations.evalFiles || [];
    merged.evaluations = {
      ...newStore.evaluations,
      evalFiles: [...new Set([...prevEvalFiles, ...newEvalFiles])],
    };
    merged.evaluations.hasEvaluation =
      merged.evaluations.evalFiles.length > 0 ||
      (merged.evaluations.evalDirs || []).length > 0;
  } else {
    merged.evaluations = newStore.evaluations || prevStore.evaluations;
  }

  return merged;
}

function mergeByKey(prev, next, changedFiles, arrayKeys, fileField) {
  const result = { ...next };
  for (const key of arrayKeys) {
    const prevArr = prev[key] || [];
    const newArr = next[key] || [];
    // 保留未变更文件的旧数据
    const kept = prevArr.filter((item) => !changedFiles.has(item[fileField]));
    // 合并新数据
    result[key] = [...kept, ...newArr];
    // 更新 total 计数
    const totalKey = `total${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (prev[totalKey] !== undefined || next[totalKey] !== undefined) {
      result[totalKey] = result[key].length;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main() {
  // Filter out --lang= flag before parsing positional args
  const langFlag = process.argv.find((a) => a.startsWith("--lang="));
  const lang = langFlag ? langFlag.split("=")[1] : "en";
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const command = positional[0];
  const repoPath = positional[1];
  const syntheticCommands = new Set(["plan", "questions", "report", "update"]);
  const validCommands = new Set([...ANALYZERS.map((a) => a.id), "all", ...syntheticCommands]);

  if (!command || !repoPath) {
    console.error(
      `Usage: node research-repo.mjs <${[...validCommands].join("|")}> <repoPath>`
    );
    process.exit(1);
  }

  if (!validCommands.has(command)) {
    console.error(
      `Unknown command: ${command}. Valid: ${[...validCommands].join(", ")}`
    );
    process.exit(1);
  }

  if (!existsSync(repoPath)) {
    console.error(`Error: path does not exist: ${repoPath}`);
    process.exit(1);
  }

  const absPath = statSync(repoPath).isDirectory()
    ? repoPath
    : dirname(repoPath);

  await loadOptionalPackages();
  await initTreeSitter();

  try {
    if (command === "update") {
      // 1. 读取前一次分析的 full.json (+ symbols.json + ontology.json if split)
      const evidenceStoreDir = join(process.cwd(), "evidence-store");
      const fullJsonPath = join(evidenceStoreDir, "full.json");
      if (!existsSync(fullJsonPath)) {
        console.error("Error: evidence-store/full.json not found. Run 'all' first.");
        process.exit(1);
      }
      const previousData = JSON.parse(readFileSync(fullJsonPath, "utf-8"));
      // Load split files if they exist (slim full.json references them)
      const symbolsPath = join(evidenceStoreDir, "symbols.json");
      const ontologyPath = join(evidenceStoreDir, "ontology.json");
      const archPath = join(evidenceStoreDir, "architecture.json");
      if (existsSync(symbolsPath)) {
        previousData.symbols = JSON.parse(readFileSync(symbolsPath, "utf-8"));
      }
      if (existsSync(ontologyPath)) {
        previousData.ontology = JSON.parse(readFileSync(ontologyPath, "utf-8"));
      }
      if (existsSync(archPath)) {
        previousData.architecture = JSON.parse(readFileSync(archPath, "utf-8"));
      }
      const lastCommit = previousData._meta?.lastCommit;
      if (!lastCommit) {
        console.error("Error: No lastCommit in previous data. Run 'all' first.");
        process.exit(1);
      }

      // 2. 获取变更文件
      const ctx = new RepositoryContext(absPath);
      if (!ctx.isGitRepo) {
        console.error("Error: update requires a git repository.");
        process.exit(1);
      }
      const diffOutput = ctx.git("diff", "--name-only", `${lastCommit}..HEAD`);
      const changedFiles = new Set(diffOutput.split("\n").filter(Boolean));

      if (changedFiles.size === 0) {
        console.error(`No changes since ${lastCommit.substring(0, 8)}.`);
        process.exit(0);
      }

      console.error(
        `[update] ${changedFiles.size} files changed since ${lastCommit.substring(0, 8)}`
      );

      // 3. 用 changedFiles 创建新 context
      const updateCtx = new RepositoryContext(absPath, { changedFiles });

      // 4. 运行分析器（仅处理变更文件）
      const pipeline = new AnalyzerPipeline();
      const newStore = {};
      for (const analyzer of pipeline.analyzers) {
        if (!analyzer.supports(updateCtx)) continue;
        await analyzer.analyze(updateCtx, newStore, { command: analyzer.id });
      }

      // 5. 合并结果
      const mergedStore = mergeAnalysisResults(previousData, newStore, changedFiles);

      // 6. 重建架构图和排名（需要全量数据）
      // ArchitectureAnalyzer 和 RankingAnalyzer 需要从合并后的 symbols 重建
      // 创建一个不受 changedFiles 限制的 context 用于重建
      const rebuildCtx = new RepositoryContext(absPath);
      // 先把合并后的 symbols 放入 store
      const rebuildStore = { ...mergedStore };
      // 重新运行 architecture analyzer（它会从 store.symbols 读取）
      const archAnalyzer = pipeline.getAnalyzer("architecture");
      if (archAnalyzer && archAnalyzer.supports(rebuildCtx)) {
        await archAnalyzer.analyze(rebuildCtx, rebuildStore, { command: "architecture" });
      }
      // 重新运行 ranking analyzer
      const rankAnalyzer = pipeline.getAnalyzer("ranking");
      if (rankAnalyzer && rankAnalyzer.supports(rebuildCtx)) {
        await rankAnalyzer.analyze(rebuildCtx, rebuildStore, { command: "ranking" });
      }

      // 7. 重新生成 plan, questions, report
      const evidenceStore = new EvidenceStore(rebuildStore);
      rebuildStore.plan = new ResearchPlanner(DEFAULT_RESEARCH_GOAL, evidenceStore).plan();
      rebuildStore.questions = new QuestionGenerator(evidenceStore).generate();
      rebuildStore.report = new ReportGenerator(evidenceStore, { lang: "en" }).generate();
      rebuildStore._meta = {
        lastCommit: rebuildCtx.git("rev-parse", "HEAD").trim(),
        analyzedAt: new Date().toISOString(),
        repoPath: absPath,
        incremental: true,
        changedFilesCount: changedFiles.size,
        baseCommit: lastCommit,
      };

      // File splitting (same as 'all' command): write symbols/ontology/architecture
      const updateStoreDir = join(process.cwd(), "evidence-store");
      if (existsSync(updateStoreDir) && statSync(updateStoreDir).isDirectory()) {
        if (rebuildStore.symbols) {
          writeFileSync(
            join(updateStoreDir, "symbols.json"),
            JSON.stringify(rebuildStore.symbols, null, 2),
          );
        }
        if (rebuildStore.ontology) {
          writeFileSync(
            join(updateStoreDir, "ontology.json"),
            JSON.stringify(rebuildStore.ontology, null, 2),
          );
        }
        if (rebuildStore.architecture) {
          writeFileSync(
            join(updateStoreDir, "architecture.json"),
            JSON.stringify(rebuildStore.architecture, null, 2),
          );
        }
        if (rebuildStore.symbols) {
          rebuildStore._symbolsRef = "evidence-store/symbols.json";
          rebuildStore.symbols = {
            totalFunctions: rebuildStore.symbols.totalFunctions || 0,
            totalClasses: rebuildStore.symbols.totalClasses || 0,
            totalImports: rebuildStore.symbols.totalImports || 0,
            totalCalls: rebuildStore.symbols.totalCalls || 0,
            totalStrings: rebuildStore.symbols.totalStrings || 0,
            _ref: "evidence-store/symbols.json",
          };
        }
        if (rebuildStore.ontology) {
          rebuildStore._ontologyRef = "evidence-store/ontology.json";
          rebuildStore.ontology = {
            objectSummary: rebuildStore.ontology.objectSummary || {},
            relSummary: rebuildStore.ontology.relSummary || {},
            _ref: "evidence-store/ontology.json",
          };
        }
        if (rebuildStore.architecture) {
          rebuildStore._architectureRef = "evidence-store/architecture.json";
          rebuildStore.architecture = {
            totalNodes: rebuildStore.architecture.totalNodes || 0,
            totalEdges: rebuildStore.architecture.totalEdges || 0,
            cycles: rebuildStore.architecture.cycles || [],
            centrality: rebuildStore.architecture.centrality || {},
            _ref: "evidence-store/architecture.json",
          };
        }
      }

      process.stdout.write(JSON.stringify(evidenceStore, null, 2) + "\n");
      return;
    }

    const ctx = new RepositoryContext(absPath);
    const pipeline = new AnalyzerPipeline();
    let result;
    if (command === "all") {
      ctx.lang = lang;
      result = await pipeline.runAll(ctx);
    } else if (command === "report") {
      const evidenceStore = await pipeline.runAll(ctx);
      const reportGenerator = new ReportGenerator(evidenceStore, { lang });
      process.stdout.write(reportGenerator.generate() + "\n");
      return;
    } else if (syntheticCommands.has(command)) {
      const evidenceStore = await pipeline.runAll(ctx);
      result = command === "plan" ? evidenceStore.get("plan") : evidenceStore.get("questions");
    } else {
      result = await pipeline.run(command, ctx);
    }

    // File splitting: split large sections into separate files to keep
    // full.json git-friendly. The slim full.json keeps summaries + _ref pointers.
    // Sections split: symbols, ontology, architecture (nodes/edges are bulky).
    if (command === "all" && result && result._store) {
      const store = result._store;
      const evidenceStoreDir = join(process.cwd(), "evidence-store");
      if (existsSync(evidenceStoreDir) && statSync(evidenceStoreDir).isDirectory()) {
        // Write large sections to separate files
        if (store.symbols) {
          writeFileSync(
            join(evidenceStoreDir, "symbols.json"),
            JSON.stringify(store.symbols, null, 2),
          );
        }
        if (store.ontology) {
          writeFileSync(
            join(evidenceStoreDir, "ontology.json"),
            JSON.stringify(store.ontology, null, 2),
          );
        }
        if (store.architecture) {
          writeFileSync(
            join(evidenceStoreDir, "architecture.json"),
            JSON.stringify(store.architecture, null, 2),
          );
        }
        // Replace with slim summaries (keep aggregates, drop raw arrays)
        if (store.symbols) {
          store._symbolsRef = "evidence-store/symbols.json";
          store.symbols = {
            totalFunctions: store.symbols.totalFunctions || 0,
            totalClasses: store.symbols.totalClasses || 0,
            totalImports: store.symbols.totalImports || 0,
            totalCalls: store.symbols.totalCalls || 0,
            totalStrings: store.symbols.totalStrings || 0,
            _ref: "evidence-store/symbols.json",
          };
        }
        if (store.ontology) {
          store._ontologyRef = "evidence-store/ontology.json";
          store.ontology = {
            objectSummary: store.ontology.objectSummary || {},
            relSummary: store.ontology.relSummary || {},
            _ref: "evidence-store/ontology.json",
          };
        }
        if (store.architecture) {
          store._architectureRef = "evidence-store/architecture.json";
          store.architecture = {
            totalNodes: store.architecture.totalNodes || 0,
            totalEdges: store.architecture.totalEdges || 0,
            cycles: store.architecture.cycles || [],
            centrality: store.architecture.centrality || {},
            _ref: "evidence-store/architecture.json",
          };
        }
      }
    }

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    console.error(`Error running '${command}': ${err && err.message ? err.message : String(err)}`);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

const isMainModule = () => {
  try {
    return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
  } catch {
    return false;
  }
};

if (isMainModule()) {
  main().catch((err) => {
    console.error(`Fatal: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
}

// Public API for programmatic use (e.g. tests, LLM subagents, Research Planner)
export {
  RepositoryContext,
  BaseAnalyzer,
  AnalyzerPipeline,
  EvidenceStore,
  ResearchPlanner,
  QuestionGenerator,
  LANGUAGE_EXTENSIONS,
  SOURCE_EXTENSIONS,
  PROJECT_DISCOVERY_RULES,
  ARCHITECTURE_SIGNAL_DIRS,
};
