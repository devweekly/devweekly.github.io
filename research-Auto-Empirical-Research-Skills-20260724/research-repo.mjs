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

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
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
const treeCache = new Map(); // filePath -> tree

const TS_LANG_MAP = {
  ".py": "tree-sitter-python.wasm",
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-typescript.wasm",
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

    // Lazy caches
    this._entries = null;
    this._files = null;
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

  /** File entries only. */
  get files() {
    if (this._files === null) {
      this._files = this.entries.filter((e) => e.type === "file");
    }
    return this._files;
  }

  /** Directory entries only. */
  get dirs() {
    if (this._dirs === null) {
      this._dirs = this.entries.filter((e) => e.type === "dir");
    }
    return this._dirs;
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
  const wasmFile = TS_LANG_MAP[ext];
  if (!wasmFile) return null;
  const wasmPath = join(wasmDir, wasmFile);
  if (!existsSync(wasmPath)) return null;
  try {
    const Language = Parser.Language;
    const language = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    parserCache.set(ext, parser);
    return parser;
  } catch {
    return null;
  }
}

async function parseFileAST(filePath) {
  if (treeCache.has(filePath)) return treeCache.get(filePath);
  const parser = await getParserForFile(filePath);
  if (!parser) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    const tree = parser.parse(content);
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
      const callee = fnNode ? fnNode.text : null;
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
    const files = ctx.files;

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

    const results = await Promise.all(
      sourceFiles.map(async (file) => {
        const tree = await ctx.parseAST(file.path);
        const symbols = await extractSymbolsAST(file.path, ctx.repoPath, tree);
        return symbols || { functions: [], classes: [], imports: [], calls: [], strings: [] };
      })
    );

    const functions = [];
    const classes = [];
    const imports = [];
    const calls = [];
    const strings = [];
    for (const r of results) {
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
      await Promise.all(
        sourceFiles.map(async (file) => {
          const relPath = ctx.rel(file.path);
          const tree = await ctx.parseAST(file.path);
          const astImports = await extractImportsAST(file.path, tree);
          const imports = astImports !== null ? astImports : parseImports(file.path);
          fileImports.set(relPath, imports);
        })
      );
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
    const astResults = await Promise.all(
      sourceFiles.map(async (file) => {
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
      })
    );
    for (const { relPath, signals } of astResults) {
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
    const codeResults = await Promise.all(
      codeFiles.map(async (f) => {
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
      })
    );

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

    const prompts = [...codeResults.flat(), ...mdPrompts];
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
    const results = await Promise.all(
      files.map(async (f) => {
        const tree = await ctx.parseAST(f.path);
        const astTools = await extractToolsAST(f.path, ctx.repoPath, tree);
        if (astTools !== null) return { ast: true, tools: astTools, file: f };
        return { ast: false, tools: null, file: f };
      })
    );

    // Process AST results; collect files that need regex fallback
    const regexFiles = [];
    for (const r of results) {
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
    for (const f of ctx.files) {
      const name = f.name.toLowerCase();
      const relPath = ctx.rel(f.path);
      const isEvalByName = EVAL_KEYWORDS.some((kw) => name.includes(kw));
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
    const planner = new ResearchPlanner(DEFAULT_RESEARCH_GOAL, evidenceStore);
    store.plan = planner.plan();
    const questionGenerator = new QuestionGenerator(evidenceStore);
    store.questions = questionGenerator.generate();
    return evidenceStore;
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const command = process.argv[2];
  const repoPath = process.argv[3];
  const syntheticCommands = new Set(["plan", "questions"]);
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
    const ctx = new RepositoryContext(absPath);
    const pipeline = new AnalyzerPipeline();
    let result;
    if (command === "all") {
      result = await pipeline.runAll(ctx);
    } else if (syntheticCommands.has(command)) {
      const evidenceStore = await pipeline.runAll(ctx);
      result = command === "plan" ? evidenceStore.get("plan") : evidenceStore.get("questions");
    } else {
      result = await pipeline.run(command, ctx);
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
