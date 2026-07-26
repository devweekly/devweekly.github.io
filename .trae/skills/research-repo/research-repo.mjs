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
  { category: "manifest", file: "pom.xml", language: "java", parser: parsePomXml, priority: 100 },
  { category: "manifest", file: "build.gradle", language: "java", parser: parseGradle, priority: 95 },
  { category: "manifest", file: "build.gradle.kts", language: "kotlin", parser: parseGradle, priority: 95 },
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
  // Extended metadata (added 2026-07: caught as false-negatives in buzz/worldmonitor)
  { category: "metadata", file: "CODE_OF_CONDUCT.md", priority: 60 },
  { category: "metadata", file: "GOVERNANCE.md", priority: 55 },
  { category: "metadata", file: "RELEASING.md", priority: 50 },
  { category: "metadata", file: "TESTING.md", priority: 50 },
  // Agent instructions (AI coding agent configs)
  // Added 2026-07: SKILL.md (Claude Code skill manifest) was missing — caused
  // 3/8 ref-only repos (Auto-Empirical-Research-Skills, ResearchStudio,
  // custodian-kernel) to falsely report "No AI Agent instruction files found"
  // despite containing 100+ SKILL.md files each.
  { category: "agent", file: "AGENTS.md", priority: 95 },
  { category: "agent", file: "CLAUDE.md", priority: 95 },
  { category: "agent", file: "SKILL.md", priority: 90 },
  { category: "agent", file: "GEMINI.md", priority: 90 },
  { category: "agent", file: join(".github", "copilot-instructions.md"), priority: 90 },
  { category: "agent", file: ".cursorrules", priority: 85 },
  { category: "agent", file: ".windsurfrules", priority: 85 },
  { category: "agent", file: "opencode.md", priority: 85 },
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
  { regex: /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/, lang: "javascript" },
  { regex: /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/, lang: "javascript" },
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
  java: [
    /^\s*import\s+(?:static\s+)?([\w.]+);/gm,
  ],
};

// Prompt content markers (regex-based, for scanning file content)
// Tightened in 2026-07 revision:
//   - `template` regex now requires a prompt-flavored prefix (PROMPT|MESSAGE|
//     DIALOG|LLM|AGENT|SYSTEM|ASSISTANT|USER|INSTRUCTION|RENDER|BUILD) to avoid
//     matching CSS `gridTemplateColumns`, React `gridTemplate`, UI animation
//     constants like `SEARCH_PROMPT_Y_OFFSET`. Plain `template:` assignment is
//     too noisy (buzz: 440 prompts, ~60% were CSS/UI template strings).
//   - `prompt` regex unchanged — `prompt:` / `prompt =` is specific enough.
const PROMPT_MARKERS = [
  { type: "system", regex: /\b(SYSTEM_PROMPT|system_prompt|systemPrompt|System\.Message|system_message)\b/g },
  { type: "assistant", regex: /\b(ASSISTANT_PROMPT|assistant_prompt|Assistant\.Message)\b/g },
  { type: "prompt", regex: /\b(prompt|PROMPT|build_prompt|render_prompt)\s*[:=]/g },
  // Template: only match when prefixed by a prompt-flavored identifier.
  // Catches `SYSTEM_TEMPLATE`, `MESSAGE_TEMPLATE`, `RENDER_TEMPLATE`, etc.
  // Does NOT catch `gridTemplateColumns`, `SEARCH_PROMPT_Y_OFFSET`, etc.
  { type: "template", regex: /\b(?:PROMPT|MESSAGE|DIALOG|LLM|AGENT|SYSTEM|ASSISTANT|USER|INSTRUCTION|RENDER|BUILD)_?TEMPLATE\s*[:=]/g },
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
let LanguageExport = null;
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
    // web-tree-sitter >=0.25 renamed the runtime from `tree-sitter.wasm` to
    // `web-tree-sitter.wasm`. Check both for backward compatibility.
    const wtsDir = join(nodeModulesDir, "web-tree-sitter");
    const wasmRuntimePath = existsSync(join(wtsDir, "web-tree-sitter.wasm"))
      ? join(wtsDir, "web-tree-sitter.wasm")
      : join(wtsDir, "tree-sitter.wasm");
    if (!existsSync(wasmRuntimePath)) return null;

    const wasmsPkgPath = join(nodeModulesDir, "tree-sitter-wasms", "out");
    if (!existsSync(wasmsPkgPath)) return null;

    const mod = await import("web-tree-sitter");
    // web-tree-sitter >=0.25 changed exports:
    //   Old: mod.default = Parser, Parser.Language = Language
    //   New: mod.Parser = Parser, mod.Language = Language (separate export)
    const parserCtor = mod.default || mod.Parser || mod;
    // Language may be on Parser (old) or a top-level export (new).
    LanguageExport = mod.Language || parserCtor.Language || null;

    // Init the WASM runtime. The locateFile callback resolves the runtime
    // .wasm file (not the language .wasm files — those are loaded separately).
    await parserCtor.init({
      locateFile: (filename) =>
        pathToFileURL(join(nodeModulesDir, "web-tree-sitter", filename)).href,
    });
    // Only set module-level vars after successful init
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
      // Use the Language export captured at init time (handles both old
      // Parser.Language and new mod.Language APIs).
      const Language = LanguageExport || Parser.Language;
      if (!Language) return null;
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
    } else if (ext === ".java") {
      // tree-sitter-java: `import_declaration` with `scoped_identifier` child
      // (e.g. `import org.jkiss.dbeaver.ModelPreferences;`) or `asterisk_identifier`
      // (e.g. `import java.awt.*;`). Static imports wrap the scoped_identifier
      // inside a `scoped_type_identifier` — handle both.
      if (node.type === "import_declaration") {
        const text = node.text
          .replace(/^import\s+(?:static\s+)?/, "")
          .replace(/;$/, "")
          .replace(/\s*\*$/, "") // `import foo.bar.*` → `foo.bar`
          .trim();
        if (text) imports.push(text);
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
    } else if (ext === ".java" && node.type === "import_declaration") {
      // Java: `import foo.bar.Baz;` / `import static foo.bar.Baz.method;` / `import foo.bar.*;`
      const text = node.text
        .replace(/^import\s+(?:static\s+)?/, "")
        .replace(/;$/, "")
        .replace(/\s*\*$/, "")
        .trim();
      if (text) imports.push({ file: relPath, what: text, from: "" });
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
    .replace(/\.(py|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|kts)$/, "")
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
      .replace(/\.(py|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|kts)$/, "")
      .split(sep)
      .join(".");
  }
  // Bare JS import: use last segment as candidate module id
  s = s.replace(/\.(py|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|kts)$/, "");
  // For Python "from foo.bar import baz" / Java "import foo.bar.Baz" → keep full dotted path
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

/**
 * Parse pom.xml minimally (Maven).
 * Extracts groupId:artifactId:version from the project's own coordinates
 * (NOT the parent) plus declared <dependency> entries. Modules in a reactor
 * build (<modules>) are exposed as scripts so callers can see sub-projects.
 */
function parsePomXml(content) {
  // Project's own coordinates — skip <parent> block.
  const withoutParent = content.replace(/<parent>[\s\S]*?<\/parent>/, "");
  const groupIdMatch = withoutParent.match(/<groupId>([^<]+)<\/groupId>/);
  const artifactIdMatch = withoutParent.match(/<artifactId>([^<]+)<\/artifactId>/);
  const versionMatch = withoutParent.match(/<version>([^<]+)<\/version>/);

  const dependencies = [];
  const depRe = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g;
  let depMatch;
  while ((depMatch = depRe.exec(content)) !== null) {
    dependencies.push(`${depMatch[1]}:${depMatch[2]}`);
  }

  // Reactor modules — treated as "scripts" (sub-project entry points).
  const scripts = [];
  const modRe = /<module>([^<]+)<\/module>/g;
  let modMatch;
  while ((modMatch = modRe.exec(content)) !== null) {
    scripts.push(modMatch[1].trim());
  }

  const name = artifactIdMatch
    ? artifactIdMatch[1].trim()
    : (groupIdMatch ? groupIdMatch[1].trim() : "unknown");

  return {
    name,
    version: versionMatch ? versionMatch[1].trim() : "unknown",
    entry: "pom.xml",
    scripts,
    dependencies,
  };
}

/** Parse build.gradle / build.gradle.kts minimally (Gradle). */
function parseGradle(content) {
  // Root project name: `rootProject.name = 'foo'` or just `name = 'foo'`
  const nameMatch = content.match(/(?:rootProject\.)?name\s*=\s*['"]([^'"]+)['"]/);
  const versionMatch = content.match(/version\s*=\s*['"]([^'"]+)['"]/);
  const dependencies = [];
  // implementation 'group:artifact:version' / api "..." / testImplementation(...)
  const depRe = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|compile)\s*[('"]\s*([^'"\s:]+:[^'"\s:]+)(?::[^'"\s)]+)?['")]?/g;
  let depMatch;
  while ((depMatch = depRe.exec(content)) !== null) {
    dependencies.push(depMatch[1]);
  }
  return {
    name: nameMatch ? nameMatch[1] : "unknown",
    version: versionMatch ? versionMatch[1] : "unknown",
    entry: "build.gradle",
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

/**
 * Return true if the file path (relative or absolute) points to a test file.
 * Combines filename pattern matching (isTestFile) with directory-based detection
 * (tests/, __tests__/, spec/, e2e/ directories, and Rust tests/*.rs convention).
 *
 * This is the canonical test-file filter used by all analyzers that should
 * SKIP test files (ObjectClassifier, ToolsAnalyzer, PromptsAnalyzer, etc.).
 * TestsAnalyzer is the only analyzer that deliberately does NOT use this filter.
 */
function isTestPath(filePath) {
  if (!filePath) return false;
  const normalized = String(filePath).replace(/\\/g, "/");
  const name = basename(normalized);
  // 1. Filename-based (existing logic)
  if (isTestFile(name)) return true;
  // 2. Directory-based: any path segment in test dirs
  if (/(?:^|\/)(?:tests?|__tests__|__mocks__|spec|specs|e2e|fixtures|mocks|test_helpers|testutils)\//.test(normalized + "/")) return true;
  // 3. Rust convention: tests/*.rs (integration tests live in tests/ dir, not _test.rs)
  if (/(?:^|\/)tests\/[^/]+\.rs$/.test(normalized)) return true;
  // 4. Python test root: test_*.py anywhere under tests/
  if (/(?:^|\/)tests?\/[^/]+\.py$/.test(normalized)) return true;
  return false;
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
  else if (ext === ".java") regexes = IMPORT_REGEX.java;
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
          // Cap at 50 to avoid huge lists (custodian-kernel has 100+ SKILL.md)
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
    // root match (e.g. benchmarks/harbor-buzz-orchestra/{src,scripts,personas}),
    // keep only the shallowest one. This prevents benchmarks/ from monopolizing
    // the 20-slot budget and hiding crates/ (observed in buzz).
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
    // the repo name (openworker → "coworker" PyPI name; worldmonitor →
    // "world-monitor" npm name; ResearchStudio → "researchstudio" lowercase).
    // Using package name as repo name caused systematic mis-naming in 3/8 repos.
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
      // Skip test files entirely — e.g. MySQLErrorsTest.java with a main() method
      // is a test fixture, not a real entrypoint. Observed in dbeaver.
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
            // open-design (121 fake tools) and pi (52 fake tools).
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
    // test setup) are not real prompts. Observed in pi: 9/36 prompt objects were
    // in test files; in buzz: `gridTemplateColumns` matched the template regex
    // inside test files. Filtering tests eliminates this noise.
    const codeFiles = files.filter((f) => codeExts.has(f.ext) && !isTestPath(ctx.rel(f.path)));
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
    // in test setup) are not real tools. Observed in pi: 13/14 tools were test
    // fixtures; in buzz: 3/3 tools were `#[test]` block fixtures. Filtering
    // tests is the single highest-impact fix for tool-detection accuracy.
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
    //      This catches Rust builtin tools like buzz's `load_skill` (buzz FN-1).
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
        // + platform/env detection utilities (observed in open-design: _is_wsl, mac, win)
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

    // Cross-reference entrypoints labeled as "tool" for standalone executable scripts
    // (e.g. bundled_skills/*/scripts/execute.py, skills/*/scripts/*.py) so that
    // simple argparse/sys.argv tools are represented even when they lack decorator/class patterns.
    const entrypoints = store.entrypoints?.entrypoints || [];
    // Barrel-export filenames — `index.*` files are package entrypoints, NOT
    // executable tools. Even when they live in `plugins/` or `tools/` directories,
    // they just re-export symbols. Observed in open-design (121 false tools) and pi.
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
      // Note: `plugins/` is intentionally excluded here — Eclipse/IDE plugins (dbeaver)
      // and webpack/vite plugins (apps/daemon/src/plugins/index.ts) are NOT agent tools.
      // Agent-tool directories are: skills/, bundled_skills/, tools/, agents/, hooks/.
      const isInToolSpace = /(?:^|[\\/])(?:skills?|bundled_skills?|tools?|agents?|hooks?)[\\/]/.test(relPath);
      if (!isInToolSpace) continue;

      // Filter out platform-specific packaging/build directories. `tools/pack/src/mac/`
      // and `tools/pack/src/win/` are platform build targets, not AI tools. Observed
      // in open-design: `mac` and `win` were falsely detected as script-tools.
      const PLATFORM_DIR_RE = /(?:^|[\\/])(?:mac|win|linux|darwin|windows|ios|android|arm64|x64|x86)[\\/]/i;
      if (PLATFORM_DIR_RE.test(relPath)) continue;

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
    // `DBPEvaluationContext.java` (dbeaver — query execution context, NOT LLM eval)
    // and `leaflet.js` (mapping library with "metric"/"score" words).
    // LLM-specific context = at least one of: prompt, llm, model, judge, agent,
    // dataset, benchmark, harness, system_prompt.
    //
    // Package/import declarations are stripped before testing — Java package
    // names like `org.jkiss.dbeaver.model` would otherwise trigger a false
    // "model" match.
    const LLM_CONTEXT_RE = /\b(?:prompt|llm|model|judge|agent|dataset|benchmark|harness|system_prompt|chat|completion|embedding|retrieval|rag)\b/i;
    const STRIP_PKG_IMPORT_RE = /^\s*(?:package|import)\s+[^;]+;\s*$/gm;
    for (const f of ctx.allFiles) {
      const name = f.name.toLowerCase();
      const relPath = ctx.rel(f.path);
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
          // Strip package/import lines so Java package names like
          // `org.jkiss.dbeaver.model` don't trigger LLM-context false positives.
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
    // causing one person with 2 emails to be counted as 2 contributors
    // (observed in buzz: 50 with -sne vs 40 with -sn after name dedup).
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
      // architecture. Previously tests got +20 and invaded Top 10 (buzz:
      // tauri.test.mjs ranked #7). Now tests get 0 from the test signal.
      // Tests are still visible via the TestsAnalyzer output.
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
      // architecture. Previously examples READMEs monopolized Top 3 (buzz:
      // examples/README.md, examples/countdown-bot/README.md, examples/meadow-core/README.md
      // all scored 110, pushing ARCHITECTURE.md and agent.rs out of Top 20).
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

// ===========================================================================
// Architecture Semantics Layer (2026-07)
//
// The analyzers above are Fact Extractors — they answer "what does the repo
// contain?" The seven analyzers below are Inference Engines — they answer
// "why is it designed this way? what responsibilities does it carry? what
// capabilities does it have? what are the architectural risks?"
//
// Dependency order (MUST be preserved in ANALYZERS array):
//   ArchitecturePattern → Responsibility → (Stability, ChangeCoupling,
//     InformationFlow, DependencySmell) → CapabilityOntology
// ===========================================================================

// --- Pattern signatures --------------------------------------------------
// Each pattern has: name, dirSignals (match against dir names), required
// (min signals to match), symbolSignals (optional class/function name
// patterns), and optional graph validation flag.
const ARCHITECTURE_PATTERNS = [
  {
    name: "Hexagonal (Ports & Adapters)",
    dirSignals: ["domain", "application", "adapters", "adapter", "ports", "port"],
    required: 2,
    graphCheck: "layered_direction", // domain ↛ infrastructure
  },
  {
    name: "Clean Architecture",
    dirSignals: ["entities", "usecases", "use_cases", "interface", "interfaces", "frameworks", "infrastructure"],
    required: 2,
    graphCheck: "layered_direction",
  },
  {
    name: "Onion",
    dirSignals: ["core", "infrastructure", "application", "domain"],
    required: 2,
    graphCheck: "layered_direction",
  },
  {
    name: "Layered",
    dirSignals: ["presentation", "business", "persistence", "ui", "services", "data", "repository", "repositories"],
    required: 2,
  },
  {
    name: "Pipeline",
    dirSignals: ["parser", "planner", "executor", "evaluator", "reporter", "stages", "pipeline", "pipelines"],
    required: 2,
    graphCheck: "linear_chain",
  },
  {
    name: "Plugin",
    dirSignals: ["plugins", "plugin", "registry", "extensions", "hooks", "addon", "addons"],
    required: 2,
    symbolSignals: [/\bregisterPlugin\b/, /\bloadPlugin\b/, /\bPluginRegistry\b/, /\bcreatePlugin\b/],
  },
  {
    name: "Event-Driven",
    dirSignals: ["events", "handlers", "bus", "dispatcher", "subscribers", "publishers", "listeners"],
    required: 2,
    symbolSignals: [/\bpublish\b/, /\bsubscribe\b/, /\bEventBus\b/, /\bemit\b/, /\bdispatch\b/],
  },
  {
    name: "Actor Model",
    dirSignals: ["actors", "actor", "mailbox", "messages", "props"],
    required: 2,
    symbolSignals: [/\bActor\b/, /\bActorRef\b/, /\bMailbox\b/, /\btell\b/, /\bask\b/],
  },
  {
    name: "Workflow Engine",
    dirSignals: ["workflow", "workflows", "steps", "tasks", "engine", "dag"],
    required: 2,
    symbolSignals: [/\bWorkflow\b/, /\bStep\b/, /\bTask\b/, /\bDAG\b/],
  },
  {
    name: "Finite State Machine",
    dirSignals: ["states", "transitions", "state_machine", "fsm"],
    required: 1,
    symbolSignals: [/\bStateMachine\b/, /\bState\b/, /\bTransition\b/, /\bfsm\b/i],
  },
  {
    name: "Dataflow",
    dirSignals: ["sources", "transforms", "sinks", "streams", "operators"],
    required: 2,
  },
  {
    name: "Compiler",
    // parser/lexer/ast alone are too generic (SQL parsers, config parsers trigger
    // false positives). Require at least one compiler-specific signal (codegen,
    // optimizer, semantic analysis, IR generation) to confirm.
    dirSignals: ["lexer", "tokenizer", "parser", "ast", "codegen", "ir", "semantic", "optimizer"],
    required: 2,
    requiredSpecialized: 1, // must have ≥1 of: codegen, optimizer, semantic, ir
    specializedSignals: ["codegen", "optimizer", "semantic", "ir"],
    symbolSignals: [/\bToken\b/, /\bAST\b/, /\bparse\b/, /\blex\b/, /\bcodegen\b/, /\bIRGen\b/, /\boptimize\b/],
  },
  {
    name: "Blackboard",
    dirSignals: ["blackboard", "knowledge", "controllers"],
    required: 2,
  },
  {
    name: "Microservices",
    dirSignals: ["services", "service"],
    required: 1,
    multiInstanceCheck: true, // need ≥3 service dirs or shared/ + services/
  },
  {
    name: "Monorepo",
    dirSignals: ["packages", "apps", "libs", "modules"],
    required: 1,
    multiManifestCheck: true,
  },
];

// --- Responsibility signatures ------------------------------------------
// Maps module naming patterns to a Responsibility label and Capability tags.
// Used by ResponsibilityAnalyzer and CapabilityOntologyAnalyzer.
const RESPONSIBILITY_RULES = [
  { responsibility: "Task Planning", keywords: ["planner", "planning", "plan", "scheduler", "strategy", "orchestrat"], capabilities: ["planning"] },
  { responsibility: "Tool Execution", keywords: ["executor", "execute", "runner", "runtime", "action"], capabilities: ["execution"] },
  { responsibility: "Tool Registry", keywords: ["tool", "tools", "toolkit"], capabilities: ["tool"] },
  { responsibility: "Context & Memory", keywords: ["memory", "context", "state", "session", "history", "buffer"], capabilities: ["memory", "context"] },
  { responsibility: "Prompt Assembly", keywords: ["prompt", "template", "templating"], capabilities: ["prompt"] },
  { responsibility: "Quality Assessment", keywords: ["eval", "evaluation", "benchmark", "metric", "metrics", "judge"], capabilities: ["evaluation"] },
  { responsibility: "Retrieval", keywords: ["retriev", "rag", "search", "index", "embed"], capabilities: ["retrieval"] },
  { responsibility: "Safety & Guardrails", keywords: ["guard", "guardrail", "safety", "filter", "policy", "validate", "schema"], capabilities: ["safety"] },
  { responsibility: "LLM Interface", keywords: ["llm", "inference", "openai", "anthropic", "claude", "gemini", "mistral", "deepseek", "qwen", "bedrock", "vertex", "completion"], capabilities: ["execution"] },
  { responsibility: "I/O & Transport", keywords: ["api", "http", "transport", "server", "route", "router", "request"], capabilities: ["io"] },
  { responsibility: "Persistence", keywords: ["db", "database", "storage", "store", "persist", "repository", "cache"], capabilities: ["persistence"] },
  { responsibility: "Parsing", keywords: ["parser", "lexer", "tokenizer", "ast", "parse"], capabilities: ["parsing"] },
  { responsibility: "Agent Lifecycle", keywords: ["agent", "harness", "loop", "turn"], capabilities: ["execution", "context"] },
  { responsibility: "Configuration", keywords: ["config", "configuration", "settings"], capabilities: [] },
  { responsibility: "Developer Tooling", keywords: ["cli", "command", "cmd", "dev", "debug"], capabilities: [] },
];

/**
 * Tokenize a symbol name into lowercase tokens for keyword matching.
 * Splits on CamelCase boundaries, underscores, hyphens, and dots.
 * Examples:
 *   "resetCapabilitiesCache" → ["reset", "capabilities", "cache"]
 *   "CacheManager"           → ["cache", "manager"]
 *   "openai_chat"            → ["openai", "chat"]
 *   "HTTPServer"             → ["http", "server"]
 *   "couldBeEmoji"           → ["could", "be", "emoji"]
 *
 * This replaces the old `s.toLowerCase().includes(kw)` substring match that
 * caused false positives like "db" matching "couldBeEmoji" (couldBe → db).
 */
function tokenizeSymbol(name) {
  if (!name) return [];
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")   // camelCase → camel_Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2") // HTTPServer → HTTP_Server
    .split(/[_\-.\s]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/**
 * Check if a keyword matches any symbol via token-prefix matching.
 * A keyword matches if any token of the symbol STARTS WITH the keyword.
 * This supports intentional prefix keywords like "retriev" (matches
 * "retrieve", "retrieval") and "persist" (matches "persistence", "persistent").
 */
function symbolTokensMatchKw(kw, symbols) {
  const kwLower = kw.toLowerCase();
  return symbols.some((s) =>
    tokenizeSymbol(s).some((token) => token.startsWith(kwLower))
  );
}

// --- Fixed Capability Ontology ------------------------------------------
// The 10 capabilities every AI/Agent system can have. Used by
// CapabilityOntologyAnalyzer to assess maturity and find gaps.
const CAPABILITY_ONTOLOGY = [
  "planning",
  "execution",
  "retrieval",
  "memory",
  "evaluation",
  "safety",
  "tool",
  "context",
  "io",
  "persistence",
];

/**
 * ArchitecturePatternAnalyzer — infers the repo's architecture pattern from
 * directory layout + symbol names + import-graph shape.
 *
 * Rule-based (no LLM). Identifies Hexagonal/Clean/Onion/Layered/Pipeline/
 * Plugin/Event-Driven/Actor/Workflow/FSM/Dataflow/Compiler/Blackboard/
 * Microservices/Monorepo with confidence scores.
 */
class ArchitecturePatternAnalyzer extends BaseAnalyzer {
  get id() {
    return "archPattern";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const discovery = store.discovery || {};
    const arch = store.architecture || {};
    const symbols = store.symbols || {};

    // Candidate directory names: top-level + architecture signal dirs.
    const allDirs = new Set([
      ...(discovery.topLevelDirs || []),
      ...(discovery.architectureSignalDirs || []),
    ]);
    // Also scan one level deep (e.g., src/domain, packages/core).
    for (const f of ctx.files) {
      const rel = ctx.rel(f.path);
      const parts = rel.split(sep);
      if (parts.length >= 2 && parts[0] !== "node_modules" && parts[0] !== "vendor") {
        allDirs.add(parts[parts.length - 1]);
        if (parts.length >= 3 && parts[0] === "src") allDirs.add(parts[1]);
      }
    }
    const dirNames = [...allDirs].map((d) => d.toLowerCase());

    // Symbol names for symbol-signal patterns.
    const symbolNames = [
      ...(symbols.classes || []).map((c) => c.name || ""),
      ...(symbols.functions || []).map((f) => f.name || ""),
    ];

    const matches = [];
    for (const pattern of ARCHITECTURE_PATTERNS) {
      // Exact segment match: require a directory segment to EQUAL the signal
      // (or start with `sig-`/`sig_`). Substring matching caused massive false
      // positives — e.g., "ast" matched "contrast", "ir" matched "first"/"directory",
      // which then satisfied the Compiler specialized-signal gate.
      const matchedDirs = pattern.dirSignals.filter((sig) =>
        dirNames.some(
          (d) => d === sig || d.startsWith(`${sig}-`) || d.startsWith(`${sig}_`)
        )
      );
      let matchedSymbols = [];
      if (pattern.symbolSignals) {
        matchedSymbols = pattern.symbolSignals
          .filter((re) => symbolNames.some((n) => re.test(n)))
          .map((re) => re.source);
      }

      const totalSignals = matchedDirs.length + matchedSymbols.length;
      if (totalSignals < pattern.required) continue;

      // Specialized-signal gate (e.g., Compiler requires ≥1 of codegen/optimizer/
      // semantic/ir to avoid false positives from SQL/config parsers).
      if (pattern.requiredSpecialized && pattern.specializedSignals) {
        const specializedHits = pattern.specializedSignals.filter((sig) =>
          matchedDirs.includes(sig)
        );
        if (specializedHits.length < pattern.requiredSpecialized) continue;
      }

      // Base confidence: 0.4 for meeting required, +0.15 per extra signal.
      let confidence = 0.4 + 0.15 * (totalSignals - pattern.required);

      // Multi-instance check (Microservices / Monorepo).
      if (pattern.multiInstanceCheck) {
        const serviceDirs = dirNames.filter((d) => d === "service" || d.endsWith("-service"));
        if (serviceDirs.length >= 3) confidence += 0.2;
        else if (serviceDirs.length < 2) continue; // require ≥2 service dirs
      }
      if (pattern.multiManifestCheck) {
        // Count manifests in subdirs (package.json, Cargo.toml, etc.)
        const manifestCount = (ctx.files || []).filter((f) =>
          ["package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml"].includes(f.name)
        ).length;
        if (manifestCount >= 3) confidence += 0.2;
        else continue;
      }

      // Graph validation: check layer direction or linear chain.
      if (pattern.graphCheck === "layered_direction" && arch.edges) {
        // For Hexagonal/Clean/Onion: verify domain doesn't import infrastructure.
        const hasDomain = matchedDirs.includes("domain") || matchedDirs.includes("entities") || matchedDirs.includes("core");
        const hasInfra = matchedDirs.includes("infrastructure") || matchedDirs.includes("frameworks") || matchedDirs.includes("adapters");
        if (hasDomain && hasInfra) {
          // Sample edges — if any edge goes infra→domain, that's expected (dependency inversion).
          // If any edge goes domain→infra, that's a violation (but still confirms layered structure).
          const infraToDomain = arch.edges.some((e) => /infra|adapter|framework/i.test(e.from) && /domain|entit|core/i.test(e.to));
          if (infraToDomain) confidence += 0.1; // dependency inversion confirmed
        }
      }
      if (pattern.graphCheck === "linear_chain" && arch.edges) {
        // Pipeline: verify a linear chain exists among the matched dirs.
        // Check if there's a path parser→planner→executor→evaluator.
        const chain = matchedDirs;
        let chainConfirmed = false;
        for (let i = 0; i < chain.length - 1; i++) {
          const fromRe = new RegExp(chain[i], "i");
          const toRe = new RegExp(chain[i + 1], "i");
          if (arch.edges.some((e) => fromRe.test(e.from) && toRe.test(e.to))) {
            chainConfirmed = true;
            break;
          }
        }
        if (chainConfirmed) confidence += 0.15;
      }

      confidence = Math.min(confidence, 0.95);

      const evidence = [
        ...matchedDirs.map((d) => `dir: ${d}/`),
        ...matchedSymbols.map((s) => `symbol: ${s}`),
      ];
      matches.push({
        pattern: pattern.name,
        confidence: Number(confidence.toFixed(2)),
        evidence,
        matchedDirs,
        matchedSymbols,
      });
    }

    matches.sort((a, b) => b.confidence - a.confidence);
    const primaryPattern = matches.length > 0 ? matches[0].pattern : "Unknown";
    const allPatterns = matches.map((m) => m.pattern);

    store[this.id] = {
      primaryPattern,
      patterns: matches,
      allPatterns,
      unknown: matches.length === 0,
      _meta: {
        source: "keyword+graph",
        strength: "moderate",
        assumptions: [
          "Architecture patterns are signaled by directory names (segment match, not substring)",
          "Specialized signals gate high-stakes patterns (e.g., Compiler requires codegen/optimizer/semantic/ir)",
          "Graph validation (layered direction, linear chain) confirms pattern with +0.1-0.15 confidence",
          "Multi-instance checks (≥3 service dirs, ≥3 manifests) confirm Microservices/Monorepo",
        ],
        limitations: [
          "Cannot detect patterns with no directory-name signal (e.g., pattern implemented purely in code structure)",
          "Hexagonal/Clean/Onion patterns share dir signals (domain, adapters, infrastructure) and may be indistinguishable",
          "Compiler specialized-signal gate may still false-positive on repos with parser/interpreter subsets (e.g., template engines)",
          "Pattern detection is recall-oriented; precision depends on directory naming conventions",
        ],
        possibleFalsePositives: [
          "Repos with 'core/' dir may trigger Hexagonal/Clean/Onion even when no layered architecture exists",
          "Repos with 'plugins/' dir may trigger Plugin pattern even if plugins/ contains unrelated code",
          "Repos with 'service/' suffix dirs may trigger Microservices with <3 instances (downgraded confidence)",
        ],
        checkedLocations: [
          "discovery.topLevelDirs + 1-level deep dirs",
          "discovery.architectureSignalDirs",
          "symbols.classes[].name + symbols.functions[].name (regex symbol signals)",
          "architecture.edges[] (graph validation)",
          "manifest files count (package.json/Cargo.toml/pyproject.toml/go.mod/pom.xml)",
        ],
        coverage: "Directory-driven pattern detection; misses code-only patterns",
      },
    };
  }
}

/**
 * ResponsibilityAnalyzer — maps each top-level module to a Responsibility
 * (e.g., planner/ → "Task Planning") based on naming + symbol content.
 *
 * Produces a Responsibility Matrix that's far more useful to architects than
 * "top PageRank modules".
 */
class ResponsibilityAnalyzer extends BaseAnalyzer {
  get id() {
    return "responsibility";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const discovery = store.discovery || {};
    const symbols = store.symbols || {};
    const arch = store.architecture || {};

    // Group files by top-level module (first path segment).
    // Test files are excluded so that test fixtures (e.g., tmp_db, test_cache)
    // don't pollute the module's responsibility classification. Previously,
    // the "tests" directory was tagged "Persistence" because test setup code
    // used database fixtures.
    const moduleFiles = new Map(); // moduleName → [{path, symbols}]
    for (const f of ctx.sourceFiles || ctx.files || []) {
      const rel = ctx.rel(f.path);
      if (isTestPath(rel)) continue;
      const parts = rel.split(sep);
      if (parts.length < 2) continue;
      // Use first 2 segments for monorepo (packages/foo) or 1 for flat (src).
      const mod = parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])
        ? `${parts[0]}/${parts[1]}`
        : parts[0];
      if (!moduleFiles.has(mod)) moduleFiles.set(mod, []);
      moduleFiles.get(mod).push(rel);
    }

    // Also group architecture nodes by module.
    const moduleEdges = new Map(); // moduleName → {out: Set, in: Set}
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      if (fromMod === toMod) continue;
      if (!moduleEdges.has(fromMod)) moduleEdges.set(fromMod, { out: new Set(), in: new Set() });
      if (!moduleEdges.has(toMod)) moduleEdges.set(toMod, { out: new Set(), in: new Set() });
      moduleEdges.get(fromMod).out.add(toMod);
      moduleEdges.get(toMod).in.add(fromMod);
    }

    // Map file paths to symbols.
    const symbolsByFile = new Map();
    for (const cls of symbols.classes || []) {
      if (!cls.file) continue;
      if (!symbolsByFile.has(cls.file)) symbolsByFile.set(cls.file, []);
      symbolsByFile.get(cls.file).push(cls.name);
    }
    for (const fn of symbols.functions || []) {
      if (!fn.file) continue;
      if (!symbolsByFile.has(fn.file)) symbolsByFile.set(fn.file, []);
      symbolsByFile.get(fn.file).push(fn.name);
    }

    const responsibilities = [];
    const matrix = {};

    for (const [mod, files] of moduleFiles.entries()) {
      // Collect all symbol names in this module.
      const modSymbols = [];
      for (const file of files) {
        const syms = symbolsByFile.get(file) || [];
        modSymbols.push(...syms);
      }
      // Also include the module name itself for keyword matching.
      // Path-segment match: split module ID on dots/slashes and require a
      // segment to EQUAL the keyword (or start with `kw-`). This prevents
      // false matches like "db" inside "dbeaver" or "plan" inside "explainer".
      const modSegments = mod.toLowerCase().split(/[./\\]+/);
      const segmentMatchesKw = (kw) =>
        modSegments.some(
          (seg) => seg === kw || seg.startsWith(`${kw}-`) || seg.startsWith(`${kw}_`)
        );

      let bestRule = null;
      let bestScore = 0;
      let bestEvidence = [];
      for (const rule of RESPONSIBILITY_RULES) {
        const dirHits = rule.keywords.filter(segmentMatchesKw);
        // Use CamelCase token-prefix matching instead of substring match.
        // This prevents false positives like "db" matching "couldBeEmoji"
        // (couldBe → db) while still supporting prefix keywords like
        // "retriev" (matches token "retrieve", "retrieval").
        const symHits = rule.keywords.filter((kw) =>
          symbolTokensMatchKw(kw, modSymbols)
        );
        const score = dirHits.length * 2 + symHits.length;
        if (score > bestScore) {
          bestScore = score;
          bestRule = rule;
          bestEvidence = [
            ...dirHits.map((k) => `dir segment matches "${k}"`),
            ...symHits.slice(0, 3).map((k) => {
              const sym = modSymbols.find((s) =>
                tokenizeSymbol(s).some((t) => t.startsWith(k.toLowerCase()))
              );
              return `symbol: ${sym}`;
            }),
          ];
        }
      }

      // Require score ≥ 2: a single symbol match (score 1) is too weak to
      // classify a module. This prevents e.g., "resetCapabilitiesCache" alone
      // from tagging the entire tui/ module as "Persistence". One directory
      // match (score 2) or two symbol matches (score 2) are minimum evidence.
      if (bestRule && bestScore >= 2) {
        const confidence = Math.min(0.5 + bestScore * 0.1, 0.95);
        const edges = moduleEdges.get(mod) || { out: new Set(), in: new Set() };
        responsibilities.push({
          module: mod,
          responsibility: bestRule.responsibility,
          capabilities: bestRule.capabilities,
          confidence: Number(confidence.toFixed(2)),
          evidence: bestEvidence,
          fileCount: files.length,
          dependencies: {
            outgoing: [...edges.out].slice(0, 5),
            incoming: [...edges.in].slice(0, 5),
          },
        });
        matrix[mod] = bestRule.responsibility;
      } else {
        // Unmapped module — still record for completeness.
        responsibilities.push({
          module: mod,
          responsibility: "Uncategorized",
          capabilities: [],
          confidence: 0.0,
          evidence: [],
          fileCount: files.length,
          dependencies: { outgoing: [], incoming: [] },
        });
        matrix[mod] = "Uncategorized";
      }
    }

    // Sort by file count descending (most significant modules first).
    responsibilities.sort((a, b) => b.fileCount - a.fileCount);

    store[this.id] = {
      responsibilities,
      responsibilityMatrix: matrix,
      totalModules: responsibilities.length,
      mappedModules: responsibilities.filter((r) => r.responsibility !== "Uncategorized").length,
      _meta: {
        source: "keyword",
        strength: "moderate",
        assumptions: [
          "Module boundaries = first 1-2 path segments (packages/foo for monorepo, top dir for flat layout)",
          "Test files are excluded (isTestPath) so test fixtures don't pollute module classification",
          "One directory match (score 2) or two symbol matches (score 2) are minimum evidence; single symbol match (score 1) is too weak",
        ],
        limitations: [
          "Cannot detect responsibilities that span multiple modules (e.g., 'security' implemented across crypto/ + auth/)",
          "Keyword matching is segment/token-prefix; unconventional naming (e.g., 'dataRepo' for persistence) may be missed",
          "Modules with generic names (components/, utils/) often get Uncategorized or false-positive matches",
        ],
        possibleFalsePositives: [
          "Modules named 'search' or 'query' may be tagged Retrieval even when not RAG (e.g., DB search, file search)",
          "Modules named 'storage' may be tagged Persistence even for in-memory caches",
          "Symbol token-prefix 'persist' may match 'persistenceLayer' in non-DB contexts",
        ],
        checkedLocations: [
          "discovery.topLevelDirs + 1-level deep dirs",
          "symbols.functions[].name (CamelCase tokenized)",
          "symbols.classes[].name (CamelCase tokenized)",
          "architecture.edges[] (for module dependency context)",
        ],
        coverage: "100% of non-test source files grouped into modules",
      },
    };
  }

  _moduleOf(nodeId) {
    // Convert dotted module ID back to first path segment.
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * StabilityAnalyzer — Robert C. Martin's A/I metrics at module level.
 *
 *   I (Instability) = Ce / (Ca + Ce)
 *   A (Abstractness) = (interfaces + abstract classes) / total classes
 *
 * Zone classification:
 *   I < 0.3 && A > 0.7  → Zone of Uselessness (over-abstract)
 *   I > 0.7 && A < 0.3  → Zone of Pain (concrete, hard to change)
 *   Near main sequence   → Sweet Spot
 */
class StabilityAnalyzer extends BaseAnalyzer {
  get id() {
    return "stability";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const symbols = store.symbols || {};
    const discovery = store.discovery || {};

    // Group nodes by top-level module.
    const moduleNodes = new Map(); // moduleName → Set<nodeId>
    for (const node of arch.nodes || []) {
      const mod = this._moduleOf(node.id);
      if (!moduleNodes.has(mod)) moduleNodes.set(mod, new Set());
      moduleNodes.get(mod).add(node.id);
    }

    // Count afferent (Ca) and efferent (Ce) couplings at module level.
    const ca = new Map(); // moduleName → Set<depends-on-module>
    const ce = new Map(); // moduleName → Set<depended-on-by-module>
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      if (fromMod === toMod) continue;
      if (!ce.has(fromMod)) ce.set(fromMod, new Set());
      ce.get(fromMod).add(toMod);
      if (!ca.has(toMod)) ca.set(toMod, new Set());
      ca.get(toMod).add(fromMod);
    }

    // Count abstracts (interfaces, abstract classes, protocols, traits) per module.
    const abstractsPerModule = new Map();
    const totalPerModule = new Map();
    for (const cls of symbols.classes || []) {
      const mod = cls.file ? this._moduleOf(pathToModuleId(cls.file)) : "unknown";
      totalPerModule.set(mod, (totalPerModule.get(mod) || 0) + 1);
      const name = cls.name || "";
      const isAbstract = /\b(Interface|Protocol|Trait|Mixin|Abstract|Base|ABC)\b/.test(name)
        || cls.modifiers?.includes?.("abstract")
        || cls.modifiers?.includes?.("protocol");
      if (isAbstract) {
        abstractsPerModule.set(mod, (abstractsPerModule.get(mod) || 0) + 1);
      }
    }

    const modules = [];
    for (const [mod, nodes] of moduleNodes.entries()) {
      const caVal = (ca.get(mod) || new Set()).size;
      const ceVal = (ce.get(mod) || new Set()).size;
      const total = caVal + ceVal;
      const instability = total > 0 ? ceVal / total : 0;
      const totalClasses = totalPerModule.get(mod) || 0;
      const abstractClasses = abstractsPerModule.get(mod) || 0;
      const abstractness = totalClasses > 0 ? abstractClasses / totalClasses : 0;

      let zone;
      if (total === 0) zone = "isolated";
      else if (instability < 0.3 && abstractness > 0.7) zone = "zone_of_uselessness";
      else if (instability > 0.7 && abstractness < 0.3) zone = "zone_of_pain";
      else if (Math.abs(instability + abstractness - 1) < 0.3) zone = "sweet_spot";
      else zone = "transitioning";

      modules.push({
        module: mod,
        ca: caVal,
        ce: ceVal,
        instability: Number(instability.toFixed(3)),
        abstractness: Number(abstractness.toFixed(3)),
        totalClasses,
        abstractClasses,
        zone,
        nodeCount: nodes.size,
      });
    }

    modules.sort((a, b) => (b.ca + b.ce) - (a.ca + a.ce));

    // Summary distribution for A-I graph.
    const zoneDistribution = {};
    for (const m of modules) {
      zoneDistribution[m.zone] = (zoneDistribution[m.zone] || 0) + 1;
    }

    store[this.id] = {
      modules,
      zoneDistribution,
      totalModules: modules.length,
      painModules: modules.filter((m) => m.zone === "zone_of_pain").slice(0, 5),
      uselessnessModules: modules.filter((m) => m.zone === "zone_of_uselessness").slice(0, 5),
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * ChangeCouplingAnalyzer — detects files that frequently change together in
 * git history, even without import dependencies.
 *
 * Re-runs `git log --name-only` (the raw data is NOT cached in GitAnalyzer
 * — only the count is). Produces coupled pairs with co-change ratio and
 * classifies them as structural (have import dep) or logical (no import dep
 * but change together — the high-value signal).
 */
class ChangeCouplingAnalyzer extends BaseAnalyzer {
  get id() {
    return "changeCoupling";
  }
  supports(ctx) {
    return !!ctx.repoPath;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const repoPath = ctx.repoPath;
    const arch = store.architecture || {};

    // Get the full file list per commit (top 200 commits to bound runtime).
    const logRaw = git(
      repoPath,
      "log",
      "--name-only",
      "--format=@@@%H",
      "-n",
      "200",
      "HEAD"
    );

    if (!logRaw || logRaw.trim().length === 0) {
      store[this.id] = { coupledPairs: [], totalCommitsAnalyzed: 0 };
      return;
    }

    const commits = logRaw.split(/@@@/).filter(Boolean);
    const pairCounts = new Map(); // "fileA|fileB" → count
    const fileCounts = new Map(); // file → commit count
    const totalCommits = commits.length;

    for (const block of commits) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const files = lines.slice(1).filter((l) => l.trim().length > 0);
      // Count individual file frequencies.
      for (const f of files) {
        fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
      }
      // Count pairs (only if commit touches ≤ 30 files — larger commits are
      // usually merges/refactors and pollute the signal).
      if (files.length > 30) continue;
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const a = files[i] < files[j] ? files[i] : files[j];
          const b = files[i] < files[j] ? files[j] : files[i];
          const key = `${a}|${b}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    // Build a set of import edges for structural-dependency classification.
    const edgeSet = new Set();
    for (const edge of arch.edges || []) {
      edgeSet.add(`${edge.from}|${edge.to}`);
      edgeSet.add(`${edge.to}|${edge.from}`);
    }
    // Also check file-path co-occurrence (same directory = likely related).
    const sameDir = (a, b) => {
      const dirA = a.split(sep).slice(0, -1).join(sep);
      const dirB = b.split(sep).slice(0, -1).join(sep);
      return dirA === dirB;
    };

    // Filter pairs: co-change count ≥ 3 (statistical significance).
    const coupledPairs = [];
    for (const [key, count] of pairCounts.entries()) {
      if (count < 3) continue;
      const [fileA, fileB] = key.split("|");
      const ratioA = fileCounts.get(fileA) > 0 ? count / fileCounts.get(fileA) : 0;
      const ratioB = fileCounts.get(fileB) > 0 ? count / fileCounts.get(fileB) : 0;
      const coChangeRatio = (ratioA + ratioB) / 2;
      const idA = pathToModuleId(fileA);
      const idB = pathToModuleId(fileB);
      const hasStructuralDep = edgeSet.has(`${idA}|${idB}`);
      coupledPairs.push({
        files: [fileA, fileB],
        coChangeCount: count,
        coChangeRatio: Number(coChangeRatio.toFixed(2)),
        hasImportDep: hasStructuralDep,
        type: hasStructuralDep ? "structural" : "logical",
        sameDirectory: sameDir(fileA, fileB),
      });
    }

    coupledPairs.sort((a, b) => b.coChangeCount - a.coChangeCount);

    store[this.id] = {
      coupledPairs: coupledPairs.slice(0, 30),
      totalPairs: coupledPairs.length,
      logicalPairs: coupledPairs.filter((p) => p.type === "logical").length,
      totalCommitsAnalyzed: totalCommits,
    };
  }
}

/**
 * InformationFlowAnalyzer — infers end-to-end information flows by following
 * entrypoints → call graph → LLM call sites → output handlers.
 *
 * Produces labeled flows like:
 *   Request → Planner → Executor → LLM → Parser → Response
 */
class InformationFlowAnalyzer extends BaseAnalyzer {
  get id() {
    return "informationFlow";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const entrypoints = store.entrypoints || {};
    const symbols = store.symbols || {};
    const arch = store.architecture || {};
    const responsibility = store.responsibility || {};

    // Build adjacency list from architecture edges.
    const adj = new Map(); // nodeId → Set<targetId>
    for (const edge of arch.edges || []) {
      if (!adj.has(edge.from)) adj.set(edge.from, new Set());
      adj.get(edge.from).add(edge.to);
    }

    // Identify LLM call sites (functions/classes with LLM-related names).
    // Tightened to LLM-specific provider/model names only. Previously included
    // generic terms (generate, complete, chat, inference, vertex) that caused
    // false positives on non-AI repos:
    //   - ng-zorro-antd: "generate" matched color.generate, generate-site
    //   - dbeaver: matched a function in DeploymentId.java
    //   - open-design: "complete" matched autocomplete components
    // Removed terms: generate, complete, completion, chat, inference, vertex,
    //   call_model, invoke_model, ai_client, model_client
    // Kept: provider names (openai/anthropic/claude/gpt/gemini/mistral/deepseek/
    //   qwen/bedrock) + LLM-specific terms (llm, chat_completion).
    const LLM_NAME_RE = /\b(openai|anthropic|claude|gpt|llm|chat_completion|gemini|mistral|deepseek|qwen|bedrock)\b/i;
    const llmNodes = new Set();
    for (const fn of symbols.functions || []) {
      if (fn.name && LLM_NAME_RE.test(fn.name) && fn.file) {
        llmNodes.add(pathToModuleId(fn.file));
      }
    }
    for (const cls of symbols.classes || []) {
      if (cls.name && LLM_NAME_RE.test(cls.name) && cls.file) {
        llmNodes.add(pathToModuleId(cls.file));
      }
    }

    // Identify request entrypoints (cli/server type, source files only).
    // Filter out shell scripts and non-source files that pollute flow detection
    // (e.g., bin/activate-hermit from Hermit tooling was being detected as an entrypoint).
    const SOURCE_EXT_SET = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java"]);
    const requestEntries = (entrypoints.entrypoints || []).filter(
      (ep) =>
        (ep.type === "cli" || ep.type === "server") &&
        SOURCE_EXT_SET.has("." + (ep.path.split(".").pop() || ""))
    );

    // Build a responsibility lookup by module.
    const respByModule = new Map();
    for (const r of responsibility.responsibilities || []) {
      respByModule.set(r.module, r.responsibility);
    }

    // For each request entry, do a BFS (depth 6) and label each node with its
    // responsibility. Detect if the flow passes through an LLM node.
    const flows = [];
    for (const entry of requestEntries.slice(0, 8)) {
      const startId = pathToModuleId(entry.path);
      const visited = new Set([startId]);
      const queue = [{ id: startId, depth: 0, path: [startId] }];
      let llmHit = null;
      let maxDepth = 0;

      while (queue.length > 0 && queue[0].depth < 6) {
        const { id, depth, path } = queue.shift();
        if (llmNodes.has(id) && !llmHit) {
          llmHit = { node: id, depth };
        }
        maxDepth = Math.max(maxDepth, depth);
        const neighbors = adj.get(id) || new Set();
        // Follow only the most-connected neighbor to avoid explosion.
        const next = [...neighbors].slice(0, 3);
        for (const n of next) {
          if (visited.has(n)) continue;
          visited.add(n);
          queue.push({ id: n, depth: depth + 1, path: [...path, n] });
        }
      }

      // Build labeled steps from the longest path found.
      // For simplicity, use the entry's responsibility chain.
      const entryModule = this._moduleOf(startId);
      const steps = [
        { step: 1, module: entryModule, role: respByModule.get(entryModule) || "Entry Point", node: startId },
      ];

      // Walk the visited set and pick distinct responsibilities.
      const seenResponsibilities = new Set([steps[0].role]);
      for (const nodeId of visited) {
        const mod = this._moduleOf(nodeId);
        const role = respByModule.get(mod);
        if (role && !seenResponsibilities.has(role) && role !== "Uncategorized") {
          steps.push({
            step: steps.length + 1,
            module: mod,
            role,
            node: nodeId,
            isLLMCall: llmNodes.has(nodeId),
          });
          seenResponsibilities.add(role);
        }
        if (steps.length >= 7) break;
      }

      flows.push({
        name: `${entry.path} → ${llmHit ? "LLM" : "output"}`,
        entrypoint: entry.path,
        steps,
        reachesLLM: !!llmHit,
        llmNode: llmHit ? llmHit.node : null,
        confidence: Number((0.4 + steps.length * 0.08).toFixed(2)),
        coverage: steps.length >= 4 ? "complete" : steps.length >= 2 ? "partial" : "minimal",
      });
    }

    store[this.id] = {
      flows,
      totalFlows: flows.length,
      llmCallSites: [...llmNodes].slice(0, 10),
      reachesLLM: flows.some((f) => f.reachesLLM),
      _meta: {
        source: "regex+graph",
        strength: "weak",
        assumptions: [
          "LLM call sites are detected via regex on symbol names (LLM_NAME_RE: openai/anthropic/claude/gpt/llm/gemini/mistral/deepseek/qwen/bedrock/chat_completion)",
          "Entry points are CLI tools, tools, or HTTP handlers from EntrypointsAnalyzer",
          "Flow steps are matched by module responsibility (ResponsibilityAnalyzer)",
          "BFS from entry point reaches LLM call site → flow.reachesLLM=true",
        ],
        limitations: [
          "LLM_NAME_RE is recall-oriented; may false-positive on non-LLM symbols (e.g., 'palette_generator', 'completions' as variable name)",
          "Rust mod/use declarations are not resolved to full module paths → reachesLLM may be false-negative for Rust (buzz verified)",
          "Java Eclipse extension-points (plugin.xml) are not parsed → dbeaver AI subsystem was invisible to this analyzer",
          "BFS is bounded by graph connectivity; isolated LLM call sites with 0 in/out edges are never reached",
        ],
        possibleFalsePositives: [
          "Symbol names containing 'gpt'/'llm'/'completion' as substrings (e.g., 'Completions' type in ng-zorro-antd)",
          "Variables named 'openai'/'anthropic' that are not actual LLM clients",
          "Test fixtures with mock LLM clients",
        ],
        checkedLocations: [
          "symbols.functions[].name + symbols.classes[].name (regex LLM_NAME_RE)",
          "entrypoints.cli[] + entrypoints.tools[] + entrypoints.http[]",
          "architecture.edges[] (BFS traversal)",
          "responsibility.responsibilities[] (flow step labeling)",
        ],
        coverage: "Symbol-name regex; misses LLM calls via DI/registry/extension-point",
      },
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
}

/**
 * DependencySmellAnalyzer — detects architectural smells in the dependency graph.
 *
 * Smell types:
 *   - layer_violation: module depends in the wrong direction (e.g., domain → infrastructure)
 *   - circular_dependency: cycles, classified by context (plugin registration = acceptable)
 *   - hub_module: in-degree > 20 (god module)
 *   - unstable_dependency: stable module depends on unstable module
 */
class DependencySmellAnalyzer extends BaseAnalyzer {
  get id() {
    return "dependencySmell";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const arch = store.architecture || {};
    const pattern = store.archPattern || {};
    const stability = store.stability || {};
    const responsibility = store.responsibility || {};

    const smells = [];

    // 1. Layer violations — depends on pattern.
    const primaryPattern = pattern.primaryPattern || "";
    const isLayered = /Hexagonal|Clean|Onion|Layered/.test(primaryPattern);
    if (isLayered) {
      // Define layer hierarchy: domain/core/entities (high) → application → infrastructure/adapters (low)
      const layerRank = (mod) => {
        const m = mod.toLowerCase();
        if (/domain|entit|core/.test(m)) return 3;
        if (/application|service/.test(m)) return 2;
        if (/infrastruct|adapter|framework|persistence|ui/.test(m)) return 1;
        return 0; // unknown
      };
      for (const edge of arch.edges || []) {
        const fromMod = this._moduleOf(edge.from);
        const toMod = this._moduleOf(edge.to);
        const fromRank = layerRank(fromMod);
        const toRank = layerRank(toMod);
        // Violation: high-rank layer depends on low-rank layer.
        if (fromRank > 0 && toRank > 0 && fromRank > toRank) {
          smells.push({
            type: "layer_violation",
            severity: fromRank - toRank >= 2 ? "high" : "medium",
            from: fromMod,
            to: toMod,
            fromLayer: this._layerName(fromRank),
            toLayer: this._layerName(toRank),
            rule: `${this._layerName(fromRank)} should not depend on ${this._layerName(toRank)} (${primaryPattern})`,
            evidence: `import edge: ${fromMod} → ${toMod}`,
          });
        }
      }
    }

    // 2. Circular dependencies — classify by context.
    const respByModule = new Map();
    for (const r of responsibility.responsibilities || []) {
      respByModule.set(r.module, r.responsibility);
    }
    for (const cycle of arch.cycles || []) {
      if (cycle.length < 3) continue; // skip 2-node cycles (often bidirectional plugins)
      const modules = [...new Set(cycle.map((n) => this._moduleOf(n)))];
      const responsibilities = modules.map((m) => respByModule.get(m) || "Unknown");
      // Plugin registration cycles are acceptable.
      const isPluginCycle = responsibilities.some((r) => /Plugin|Registry|Configuration/.test(r));
      // Business-logic cycles are bad.
      const isBusinessCycle = responsibilities.some((r) => /Planning|Execution|Persistence/.test(r));
      smells.push({
        type: "circular_dependency",
        severity: isPluginCycle ? "low" : isBusinessCycle ? "high" : "medium",
        cycle: cycle.slice(0, 6),
        modules,
        context: isPluginCycle ? "plugin_registration" : isBusinessCycle ? "business_logic" : "general",
        acceptable: isPluginCycle,
        rule: isPluginCycle
          ? "Circular deps in plugin registration are acceptable (registry ↔ plugin)"
          : "Circular deps in business logic indicate tight coupling",
      });
    }

    // 3. Hub modules (god module smell) — in-degree > 20.
    const inDegree = new Map();
    for (const edge of arch.edges || []) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
    for (const [node, deg] of inDegree.entries()) {
      if (deg >= 20) {
        smells.push({
          type: "hub_module",
          severity: deg >= 40 ? "high" : "medium",
          module: this._moduleOf(node),
          node,
          inDegree: deg,
          rule: `Module with in-degree ${deg} (≥20) is a god module — too many dependents`,
        });
      }
    }

    // 4. Unstable dependency — stable module (I < 0.3) depends on unstable (I > 0.7).
    const stabilityByModule = new Map();
    for (const m of stability.modules || []) {
      stabilityByModule.set(m.module, m);
    }
    for (const edge of arch.edges || []) {
      const fromMod = this._moduleOf(edge.from);
      const toMod = this._moduleOf(edge.to);
      const fromStab = stabilityByModule.get(fromMod);
      const toStab = stabilityByModule.get(toMod);
      if (fromStab && toStab && fromStab.instability < 0.3 && toStab.instability > 0.7) {
        smells.push({
          type: "unstable_dependency",
          severity: "medium",
          from: fromMod,
          to: toMod,
          fromInstability: fromStab.instability,
          toInstability: toStab.instability,
          rule: "Stable module (I<0.3) should not depend on unstable module (I>0.7)",
        });
      }
    }

    // Deduplicate and sort.
    const seen = new Set();
    const deduped = smells.filter((s) => {
      const key = `${s.type}|${s.from || s.module || ""}|${s.to || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const severityRank = { high: 3, medium: 2, low: 1 };
    deduped.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));

    store[this.id] = {
      smells: deduped.slice(0, 30),
      totalSmells: deduped.length,
      byType: {
        layer_violation: deduped.filter((s) => s.type === "layer_violation").length,
        circular_dependency: deduped.filter((s) => s.type === "circular_dependency").length,
        hub_module: deduped.filter((s) => s.type === "hub_module").length,
        unstable_dependency: deduped.filter((s) => s.type === "unstable_dependency").length,
      },
      highSeverity: deduped.filter((s) => s.severity === "high").length,
    };
  }

  _moduleOf(nodeId) {
    const parts = nodeId.split(".");
    if (parts.length >= 3 && ["packages", "apps", "libs", "plugins"].includes(parts[0])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
  _layerName(rank) {
    return rank === 3 ? "Domain" : rank === 2 ? "Application" : rank === 1 ? "Infrastructure" : "Unknown";
  }
}

/**
 * CapabilityOntologyAnalyzer — assesses the repo against a fixed 10-capability
 * ontology (Planning, Execution, Retrieval, Memory, Evaluation, Safety, Tool,
 * Context, I/O, Persistence).
 *
 * For each capability: maturity score, modules, evidence, coverage label.
 * Identifies missing capabilities (high-value for architects evaluating
 * whether a repo fits their use case).
 */
class CapabilityOntologyAnalyzer extends BaseAnalyzer {
  get id() {
    return "capabilityOntology";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(ctx, store, _analyzerCtx) {
    const responsibility = store.responsibility || {};
    const tools = store.tools || {};
    const prompts = store.prompts || {};
    const evals = store.evaluations || {};
    const symbols = store.symbols || {};
    const infoFlow = store.informationFlow || {};

    // AI-context gate: the 10 capability domains (Planning/Execution/Retrieval/
    // Memory/Evaluation/Safety/Tool/Context/IO/Persistence) are AI-agent-specific.
    // Applying them to non-AI repos (dbeaver=SQL client, pyod=ML library,
    // ng-zorro-antd=UI library, topcoat=styling) produces false positives:
    // SQL executors match "execution", database buffers match "memory",
    // HTTP routes match "io", etc.
    //
    // Gate: if the repo has NO tools, NO prompts, NO LLM call sites, and NO
    // "LLM Interface" responsibility, it is not an AI agent project. Report
    // all capabilities as "n/a" with a clear reason.
    const hasTools = (tools.tools || []).length > 0;
    const hasPrompts = (prompts.prompts || []).length > 0;
    const hasLLMCallSites = (infoFlow.llmCallSites || []).length > 0;
    const hasLLMResponsibility = (responsibility.responsibilities || []).some(
      (r) => r.responsibility === "LLM Interface"
    );
    const isAIProject = hasTools || hasPrompts || hasLLMCallSites || hasLLMResponsibility;

    if (!isAIProject) {
      const capabilities = CAPABILITY_ONTOLOGY.map((cap) => ({
        capability: cap,
        maturity: 0,
        coverage: "n/a",
        moduleCount: 0,
        symbolCount: 0,
        modules: [],
        evidence: [],
      }));
      store[this.id] = {
        totalCapabilities: CAPABILITY_ONTOLOGY.length,
        coveredCapabilities: 0,
        capabilities,
        capabilityMatrix: Object.fromEntries(
          CAPABILITY_ONTOLOGY.map((c) => [c, "n/a"])
        ),
        missingCapabilities: [],
        strongCapabilities: [],
        weakCapabilities: [],
        isAIProject: false,
        reason: "No AI signals detected (no tools, prompts, LLM call sites, or LLM Interface responsibility). Capability assessment is not applicable.",
      };
      return;
    }

    // Build capability → modules/evidence map from ResponsibilityAnalyzer output.
    const capabilityModules = new Map(); // capability → [{module, evidence, fileCount}]
    for (const r of responsibility.responsibilities || []) {
      for (const cap of r.capabilities) {
        if (!capabilityModules.has(cap)) capabilityModules.set(cap, []);
        capabilityModules.get(cap).push({
          module: r.module,
          evidence: r.evidence,
          fileCount: r.fileCount,
          confidence: r.confidence,
        });
      }
    }

    // Augment with direct signals:
    // - Tools → "tool" capability
    if ((tools.tools || []).length > 0) {
      if (!capabilityModules.has("tool")) capabilityModules.set("tool", []);
      capabilityModules.get("tool").push({
        module: "(tools analyzer)",
        evidence: [`detected ${tools.totalTools} tools`],
        fileCount: tools.totalTools,
        confidence: 0.9,
      });
    }
    // - Prompts → "context" capability (prompt assembly)
    if ((prompts.prompts || []).length > 0) {
      if (!capabilityModules.has("context")) capabilityModules.set("context", []);
      capabilityModules.get("context").push({
        module: "(prompts analyzer)",
        evidence: [`detected ${prompts.totalPrompts} prompts`],
        fileCount: prompts.totalPrompts,
        confidence: 0.85,
      });
    }
    // - Evaluations → "evaluation" capability
    if (evals.hasEvaluation || (evals.evalFiles || []).length > 0) {
      if (!capabilityModules.has("evaluation")) capabilityModules.set("evaluation", []);
      capabilityModules.get("evaluation").push({
        module: "(evaluations analyzer)",
        evidence: [`detected ${(evals.evalFiles || []).length} eval files`],
        fileCount: (evals.evalFiles || []).length,
        confidence: 0.9,
      });
    }

    // Count symbols per capability using CamelCase token-prefix matching.
    // Previously used `name.includes(kw)` substring match, which caused false
    // positives: "execut" matched "executeSQL", "run" matched "runQuery",
    // "store" matched "restoreData". Token matching: "executeSQL" → tokens
    // ["execute", "sql"], keyword "execut" matches token "execute" via prefix.
    //
    // Keywords are AI-context-specific: generic terms like "run", "call",
    // "save", "load", "http", "request", "response" were removed because they
    // match common software functions in any repo. The AI-context gate above
    // already ensures we only assess AI projects, but tightening keywords
    // further reduces noise within AI repos (e.g., a util function named
    // "httpGet" in an AI agent should NOT count as "io" capability by itself).
    const symbolCounts = new Map();
    const CAP_KEYWORDS = {
      planning: ["plan", "schedul", "decompos", "strateg", "orchestrat"],
      execution: ["execut", "invoke", "dispatch", "perform"],
      retrieval: ["retriev", "search", "rag", "embed", "index", "query"],
      memory: ["memory", "remember", "history", "retention"],
      evaluation: ["eval", "benchmark", "metric", "judge", "score", "assess"],
      safety: ["guard", "validate", "policy", "safety", "moderat", "redteam"],
      tool: ["tool", "function_call"],
      context: ["context", "prompt", "template", "instruction"],
      io: ["stream", "websocket", "sse", "pipe"],
      persistence: ["persist", "repository", "database", "kvstore"],
    };
    for (const fn of symbols.functions || []) {
      const tokens = tokenizeSymbol(fn.name || "");
      for (const [cap, keywords] of Object.entries(CAP_KEYWORDS)) {
        if (keywords.some((kw) => tokens.some((t) => t.startsWith(kw)))) {
          symbolCounts.set(cap, (symbolCounts.get(cap) || 0) + 1);
        }
      }
    }

    // Build capability assessment.
    const capabilities = [];
    for (const cap of CAPABILITY_ONTOLOGY) {
      const modules = capabilityModules.get(cap) || [];
      const symCount = symbolCounts.get(cap) || 0;
      const moduleCount = modules.length;
      const totalFiles = modules.reduce((s, m) => s + (m.fileCount || 0), 0);

      // Maturity: weighted combination of module count, symbol count, file count.
      let maturity = 0;
      maturity += Math.min(moduleCount * 0.2, 0.4);
      maturity += Math.min(symCount * 0.01, 0.3);
      maturity += Math.min(totalFiles * 0.005, 0.3);
      maturity = Math.min(maturity, 0.95);

      let coverage;
      if (maturity === 0) coverage = "missing";
      else if (maturity < 0.2) coverage = "weak";
      else if (maturity < 0.5) coverage = "moderate";
      else coverage = "strong";

      capabilities.push({
        capability: cap,
        maturity: Number(maturity.toFixed(2)),
        coverage,
        moduleCount,
        symbolCount: symCount,
        modules: modules.slice(0, 5).map((m) => m.module),
        evidence: modules.slice(0, 3).flatMap((m) => m.evidence || []),
      });
    }

    // Build matrix and summaries.
    const capabilityMatrix = {};
    for (const c of capabilities) capabilityMatrix[c.capability] = c.coverage;
    const missingCapabilities = capabilities.filter((c) => c.coverage === "missing").map((c) => c.capability);
    const strongCapabilities = capabilities.filter((c) => c.coverage === "strong").map((c) => c.capability);
    const weakCapabilities = capabilities.filter((c) => c.coverage === "weak").map((c) => c.capability);

    capabilities.sort((a, b) => b.maturity - a.maturity);

    store[this.id] = {
      capabilities,
      capabilityMatrix,
      missingCapabilities,
      strongCapabilities,
      weakCapabilities,
      totalCapabilities: CAPABILITY_ONTOLOGY.length,
      coveredCapabilities: CAPABILITY_ONTOLOGY.length - missingCapabilities.length,
      isAIProject: true,
      _meta: {
        source: "inference",
        strength: "moderate",
        assumptions: [
          "AI project gate: repo is AI-project iff it has tools OR prompts OR LLM call sites OR LLM-Interface responsibility",
          "Capability maturity = weighted(module count, symbol count, file count), capped at 0.95",
          "Capability keywords are AI-context-specific (generic terms like run/call/save/load removed)",
          "Non-AI repos get all capabilities 'n/a' (gate prevents false positives on UI/SQL/ML libraries)",
        ],
        limitations: [
          "Maturity score is heuristic, not benchmarked against ground truth",
          "Cannot detect capabilities implemented via composition (e.g., 'planning' via tool calls alone)",
          "Symbol keyword matching may miss capabilities implemented via indirect patterns (e.g., dependency injection)",
          "AI-context gate may under-classify repos with implicit AI usage (no explicit prompts/tools/LLM symbols)",
        ],
        possibleFalsePositives: [
          "Repos with 'agent' in name but no actual AI logic may pass the gate (e.g., cargo-agent)",
          "Capability keyword 'tool' matches any 'tool' symbol, including non-AI tooling",
          "EvaluationsAnalyzer false positives propagate (hasEvaluation=true from metric/score in type names)",
        ],
        checkedLocations: [
          "responsibility.responsibilities[].capabilities (cross-analyzer input)",
          "tools.tools[] (auto-adds 'tool' capability)",
          "prompts.prompts[] (auto-adds 'context' capability)",
          "evaluations.evalFiles[] + hasEvaluation (auto-adds 'evaluation' capability)",
          "symbols.functions[].name (tokenized for keyword matching)",
        ],
        coverage: "All 10 capabilities assessed for AI projects; n/a for non-AI projects",
      },
    };
  }
}

/**
 * ConsistencyAnalyzer — cross-analyzer contradiction detection (post-processor).
 *
 * Runs LAST in the pipeline. Compares claims across analyzers and flags:
 *   - Contradictions: two analyzers make incompatible claims (severity: high)
 *   - Warnings: one analyzer's output is suspicious given another's (severity: medium/low)
 *
 * Design rationale: with 7 inference engines, disagreements are inevitable.
 * Surfacing them in the Evidence Brief lets the LLM (and reader) prioritize
 * investigation rather than blindly trusting whichever analyzer ran last.
 *
 * Output: store.consistency = { contradictions, warnings, summary }
 * The Evidence Brief surfaces contradictions FIRST (before PageRank, before
 * Architecture Insights), because self-detected conflicts are the most
 * research-valuable findings.
 */
class ConsistencyAnalyzer extends BaseAnalyzer {
  get id() {
    return "consistency";
  }
  supports(_ctx) {
    return true;
  }
  async analyze(_ctx, store, _analyzerCtx) {
    const contradictions = [];
    const warnings = [];

    const cap = store.capabilityOntology || {};
    const resp = store.responsibility || {};
    const prompts = store.prompts || {};
    const tools = store.tools || {};
    const evals = store.evaluations || {};
    const infoFlow = store.informationFlow || {};
    const archPattern = store.archPattern || {};
    const tests = store.tests || {};

    const isAI = cap.isAIProject === true;
    const matrix = cap.capabilityMatrix || {};

    // ── C1: AI-project gate vs concrete AI signals ──────────────────────
    // CapabilityOntology says isAIProject=false but other analyzers found
    // prompts, tools, or LLM call sites. This is a direct contradiction —
    // the AI-context gate may have under-classified.
    if (!isAI) {
      const promptCount = (prompts.prompts || []).length;
      const toolCount = (tools.tools || []).length;
      const llmCallSiteCount = (infoFlow.llmCallSites || []).length;
      const llmRespCount = (resp.responsibilities || []).filter(
        (r) => r.responsibility === "LLM Interface"
      ).length;
      if (promptCount > 0 || toolCount > 0 || llmCallSiteCount > 0 || llmRespCount > 0) {
        const sources = [];
        if (promptCount > 0) sources.push(`PromptsAnalyzer found ${promptCount} prompts`);
        if (toolCount > 0) sources.push(`ToolsAnalyzer found ${toolCount} tools`);
        if (llmCallSiteCount > 0) sources.push(`InformationFlowAnalyzer found ${llmCallSiteCount} LLM call sites`);
        if (llmRespCount > 0) sources.push(`ResponsibilityAnalyzer tagged ${llmRespCount} modules as "LLM Interface"`);
        contradictions.push({
          id: `C${contradictions.length + 1}`,
          topic: "AI project classification",
          severity: "high",
          sourceA: { analyzer: "CapabilityOntology", claim: "isAIProject=false" },
          sourceB: { analyzer: sources.length === 1 ? sources[0].split(" ")[0] : "multiple", claim: sources.join("; ") },
          interpretation:
            "CapabilityOntology's AI-context gate may have under-classified this repo. The gate requires tools OR prompts OR LLM call sites OR LLM-Interface responsibility, but one of these signals exists.",
          recommendation:
            "LLM should verify by reading actual prompt/tool files — they may be test fixtures, docs, or false positives from regex matching.",
        });
      }
    }

    // ── C2: Responsibility "Retrieval" vs CapabilityOntology "retrieval" ──
    // Responsibility tags a module as "Retrieval" but CapabilityOntology
    // reports retrieval=missing/n/a. Suggests ResponsibilityAnalyzer false positive.
    const retrievalRespModules = (resp.responsibilities || []).filter(
      (r) => r.responsibility === "Retrieval"
    );
    if (retrievalRespModules.length > 0) {
      const capRetrieval = matrix.retrieval;
      if (capRetrieval === "missing" || capRetrieval === "n/a" || capRetrieval === undefined) {
        contradictions.push({
          id: `C${contradictions.length + 1}`,
          topic: "Retrieval capability",
          severity: "medium",
          sourceA: {
            analyzer: "ResponsibilityAnalyzer",
            claim: `tagged ${retrievalRespModules.length} module(s) as Retrieval: ${retrievalRespModules.slice(0, 3).map((m) => m.module).join(", ")}`,
          },
          sourceB: {
            analyzer: "CapabilityOntology",
            claim: `retrieval=${capRetrieval || "undefined"}`,
          },
          interpretation:
            "ResponsibilityAnalyzer may have false-positive Retrieval classification (keyword 'retriev'/'search'/'query' matched non-RAG symbols). CapabilityOntology found no retrieval evidence (no vector store, no embed, no RAG pipeline).",
          recommendation:
            "LLM should inspect the Retrieval-tagged module's actual symbols — if they are non-AI search/query (DB query, file search), classify as ResponsibilityAnalyzer false positive.",
        });
      }
    }

    // ── C3: Tools count vs CapabilityOntology "tool" coverage ───────────
    // ToolsAnalyzer detected many tools but CapabilityOntology says tool=missing.
    // Should not happen (CapabilityOntology auto-adds tool capability from
    // ToolsAnalyzer output), but if it does, indicates a bug.
    const toolCount = (tools.tools || []).length;
    const capTool = matrix.tool;
    if (toolCount >= 3 && (capTool === "missing" || capTool === "n/a")) {
      contradictions.push({
        id: `C${contradictions.length + 1}`,
        topic: "Tool capability",
        severity: "high",
        sourceA: { analyzer: "ToolsAnalyzer", claim: `detected ${toolCount} tools` },
        sourceB: { analyzer: "CapabilityOntology", claim: `tool=${capTool}` },
        interpretation:
          "CapabilityOntology should auto-mark tool capability from ToolsAnalyzer output. A 'missing' result with ≥3 tools indicates either a CapabilityOntology bug or the AI-context gate rejected the project.",
        recommendation: "LLM should note this as an analyzer bug; trust ToolsAnalyzer's count.",
      });
    }

    // ── C4: ArchitecturePattern vs Responsibility distribution ──────────
    // Pattern=Microservices but no module tagged "Service/API" → warning.
    // Pattern=Plugin but no module tagged "Plugin Interface" → warning.
    // These are warnings (not contradictions) — pattern detection is allowed
    // to use signals ResponsibilityAnalyzer doesn't cover.
    const primaryPattern = archPattern.primaryPattern;
    if (primaryPattern && primaryPattern !== "Unknown") {
      const respSet = new Set((resp.responsibilities || []).map((r) => r.responsibility));
      if (primaryPattern === "Microservices" && !respSet.has("API") && !respSet.has("Service")) {
        warnings.push({
          id: `W${warnings.length + 1}`,
          topic: "Pattern-Responsibility coverage",
          severity: "low",
          sourceA: { analyzer: "ArchitecturePatternAnalyzer", claim: "primaryPattern=Microservices" },
          sourceB: { analyzer: "ResponsibilityAnalyzer", claim: "no module tagged 'API' or 'Service'" },
          interpretation:
            "Pattern detection may have triggered on directory names like 'service/' without semantic confirmation. Microservices pattern expects service-tier responsibilities.",
        });
      }
      if (primaryPattern === "Plugin" && !respSet.has("Plugin Interface")) {
        warnings.push({
          id: `W${warnings.length + 1}`,
          topic: "Pattern-Responsibility coverage",
          severity: "low",
          sourceA: { analyzer: "ArchitecturePatternAnalyzer", claim: "primaryPattern=Plugin" },
          sourceB: { analyzer: "ResponsibilityAnalyzer", claim: "no module tagged 'Plugin Interface'" },
          interpretation:
            "Plugin pattern detected via 'plugins/' dir or extension-point symbols, but no module has Plugin-Interface responsibility. May indicate ResponsibilityAnalyzer keyword gap, or plugins/ contains unrelated code.",
        });
      }
    }

    // ── C5: Tests present vs Evaluations absent ─────────────────────────
    // Common gap: tests exist but no eval infrastructure. Not a contradiction
    // (tests != evals) but worth flagging as a research-relevant warning.
    const testCount = tests.totalTestFiles || 0;
    const evalFileCount = (evals.evalFiles || []).length;
    if (testCount >= 10 && evalFileCount === 0 && !evals.hasEvaluation) {
      warnings.push({
        id: `W${warnings.length + 1}`,
        topic: "Test vs Evaluation coverage",
        severity: "medium",
        sourceA: { analyzer: "TestsAnalyzer", claim: `${testCount} test files` },
        sourceB: { analyzer: "EvaluationsAnalyzer", claim: "0 eval files, hasEvaluation=false" },
        interpretation:
          "Project has substantial test suite but no eval infrastructure. For AI projects, this means unit/integration tests exist but no benchmark/leaderboard/quality-eval harness. May be acceptable (pre-eval stage) or a gap.",
        recommendation: "LLM should note this in Negative Findings: 'No evaluation infrastructure despite test coverage'.",
      });
    }

    // ── C6: InformationFlow LLM call sites vs CapabilityOntology isAIProject ──
    // Subset of C1 but specifically for LLM call sites — these are the strongest
    // AI signal and most surprising when CapabilityOntology says not-AI.
    if (!isAI && (infoFlow.llmCallSites || []).length > 0) {
      // Already covered by C1 if other AI signals exist; only emit separate
      // contradiction if C1 did not fire (i.e., LLM call sites are the ONLY signal).
      const otherSignals =
        (prompts.prompts || []).length > 0 ||
        (tools.tools || []).length > 0 ||
        (resp.responsibilities || []).some((r) => r.responsibility === "LLM Interface");
      if (!otherSignals) {
        contradictions.push({
          id: `C${contradictions.length + 1}`,
          topic: "LLM call sites vs AI classification",
          severity: "high",
          sourceA: { analyzer: "CapabilityOntology", claim: "isAIProject=false" },
          sourceB: {
            analyzer: "InformationFlowAnalyzer",
            claim: `found ${(infoFlow.llmCallSites || []).length} LLM call sites`,
          },
          interpretation:
            "InformationFlowAnalyzer detected LLM call sites via regex (openai/anthropic/claude/gpt/...). CapabilityOntology's AI-context gate should have triggered on this — possible gate logic bug, OR InformationFlowAnalyzer false positive (e.g., LLM_NAME_RE matched a variable named 'completions' that's not LLM-related).",
          recommendation:
            "LLM should verify LLM call sites by reading the actual file — if false positive, note InformationFlowAnalyzer over-broad regex; if real, note CapabilityOntology gate bug.",
        });
      }
    }

    // ── Summary ─────────────────────────────────────────────────────────
    const totalContradictions = contradictions.length;
    const totalWarnings = warnings.length;
    const overall = totalContradictions > 0 ? "has-conflicts" : totalWarnings > 0 ? "has-warnings" : "stable";

    store[this.id] = {
      contradictions,
      warnings,
      summary: {
        totalContradictions,
        totalWarnings,
        overall,
        message:
          overall === "stable"
            ? "No cross-analyzer contradictions detected. All analyzers agree."
            : overall === "has-warnings"
            ? `${totalWarnings} warning(s) — analyzers agree on major claims but minor inconsistencies exist.`
            : `${totalContradictions} contradiction(s) and ${totalWarnings} warning(s) — analyzers disagree on major claims. LLM should prioritize investigation.`,
      },
    };
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
  // --- Architecture Semantics Layer (inference engines) ---
  // Order matters: Pattern → Responsibility → (Stability, ChangeCoupling,
  // InformationFlow, DependencySmell) → CapabilityOntology.
  new ArchitecturePatternAnalyzer(),
  new ResponsibilityAnalyzer(),
  new StabilityAnalyzer(),
  new ChangeCouplingAnalyzer(),
  new InformationFlowAnalyzer(),
  new DependencySmellAnalyzer(),
  new CapabilityOntologyAnalyzer(),
  // --- Post-processor: runs LAST, compares claims across analyzers ---
  new ConsistencyAnalyzer(),
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
//
// Tightened in 2026-07 revision to avoid false positives observed across
// ref-only repos:
//   - `/agent/i` over-matched HTTP `user_agent`/`UserAgent` and UI agent hooks
//     (buzz: 911 "agent" objects, ~95% UI code). Now requires word-boundary
//     `Agent` (capital A) or explicit agent-loop/session/subagent patterns,
//     and excludes `user_?agent` / `useragent` HTTP header references.
//   - `/harness/i` matched test helpers like `createHarness`, `withHarness`.
//     Now requires `Harness` (capital H) and excludes `create*Harness*` /
//     `with*Harness*` test-fixture builders.
//   - `/run\b/i` matched `runTest`, `runQuery`, `runOnce` → dropped in favor
//     of `runLoop`/`runAgent`/`runTurn` which are actual agent-loop entrypoints.
const CLASSIFICATION_RULES = [
  {
    type: "agent",
    patterns: [
      /\bAgent\b/,                          // Standalone `Agent` (capital, word-boundary)
      /\bagent_(?:loop|session|turn|dir|state|message|def)\b/i,
      /\b(?:run|create|load|discover|start|stop|trigger|sync)Agent\b/,
      /\bsub_?agent\b/i,
      /\bagentLoop\b/i,
      /\bimpl\s+.*\bAgent\b/,               // Rust `impl Agent`
      /\b(?:class|struct)\s+\w*Agent\b/,    // `class FooAgent` / `struct FooAgent`
    ],
    // Negative patterns: if name matches any of these, skip agent classification.
    // Catches HTTP `user_agent`/`UserAgent`/`getUserAgent` and UI agent hooks
    // (e.g. `useChannelAgentSessions`, `AgentActivitySheet`) which are product
    // features named "agent", not AI agent framework code.
    negative: [/user_?agent/i, /useragent/i, /http_?agent/i],
    field: "name",
  },
  {
    type: "planner",
    patterns: [/\bplan(?:ner|ning)?\b/i, /\bstrateg(?:y|ic)?\b/i],
    field: "name",
  },
  {
    type: "runner",
    patterns: [
      /\b(?:agent|turn|main|event|step)?Loop\b/i,   // agentLoop, turnLoop, mainLoop
      /\brun(?:Agent|Turn|Step|Loop|Session)\b/i,
      /\bexecutor\b/i,
    ],
    field: "name",
  },
  {
    type: "evaluation",
    patterns: [/\beval(?:uate|uation)?\b/i, /\bbenchmark\b/i, /\brubric\b/i, /\bgolden\b/i],
    field: "name",
  },
  {
    type: "workflow",
    patterns: [/\bworkflow\b/i, /\bpipeline\b/i],
    field: "name",
  },
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
    // SKIP test files: test functions/classes (e.g. `test_agent_baseline_run`,
    // `createHarness`) are not semantic objects — they verify behavior, they
    // don't define it. Filtering them eliminates ~80% of false-positive
    // agent/runner/workflow objects observed in ref-only repos (code-review-graph:
    // 10/10 agent objects were test functions; pi: 13/14 tools were test fixtures).
    const symbols = store.symbols || {};
    const allFuncs = (symbols.functions || []).filter((fn) => !isTestPath(fn.file));
    const allClasses = (symbols.classes || []).filter((cls) => !isTestPath(cls.file));

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
      // Skip this rule if name matches any negative pattern (e.g. user_agent)
      if (rule.negative && rule.negative.some((np) => np.test(name))) continue;
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
// Findings Generator — v2 pipeline: Evidence → Question-bound Findings
//
// Plan reference: plan0726.md Part 1 (①②④⑤⑥⑦)
//   - Evidence Store → Findings Store (Question/Finding/Evidence/Counter/
//     Confidence/Coverage/Importance/Limitations)
//   - Every Finding binds to a Research Question
//   - Confidence auto-computed from evidence source weights (not "High/Med/Low")
//   - Coverage auto-computed from scanned/matched ratios
//   - Importance auto-assigned per question category
//   - Negative Evidence recorded as "checkedLocations" with "nothing found"
//
// Output: store.findings = { schema, questions, findings[], summary }
// The ReportGenerator surfaces this as the FIRST section in Evidence Brief,
// before consistency checks and executive brief — because Findings are the
// canonical unit the LLM should consume (plan0726.md Part 2 Phase 2).
// ===========================================================================

/**
 * Canonical Research Questions. Every Finding MUST bind to one of these.
 * Plan ref: "不要 Architecture 这种分类，改成 Q1/Q2/..."
 * Each question is falsifiable and answerable from Evidence Store.
 */
const RESEARCH_QUESTIONS = [
  {
    id: "Q1",
    question: "How does a request enter the system and what is the entry shape?",
    category: "architecture",
    importance: "critical",
    sources: ["entrypoints", "discovery", "architecture"],
  },
  {
    id: "Q2",
    question: "Where is orchestration/control-flow, and what pattern (pipeline/graph/fsm) is used?",
    category: "architecture",
    importance: "critical",
    sources: ["archPattern", "informationFlow", "responsibility"],
  },
  {
    id: "Q3",
    question: "Does Retrieval (RAG) really exist, and what is the evidence strength?",
    category: "capability",
    importance: "high",
    sources: ["responsibility", "capabilityOntology", "symbols", "prompts"],
  },
  {
    id: "Q4",
    question: "Where is prompt management and what is the prompt lifecycle?",
    category: "ai",
    importance: "high",
    sources: ["prompts", "symbols", "tools"],
  },
  {
    id: "Q5",
    question: "What is the tool registry/invocation pattern, and how are tools bound to agents?",
    category: "ai",
    importance: "high",
    sources: ["tools", "entrypoints", "symbols"],
  },
  {
    id: "Q6",
    question: "Is this an AI project? What concrete signals confirm or refute this?",
    category: "ai",
    importance: "critical",
    sources: ["capabilityOntology", "prompts", "tools", "informationFlow", "responsibility"],
  },
  {
    id: "Q7",
    question: "How is correctness validated (tests vs evaluation), and where are the gaps?",
    category: "testing",
    importance: "medium",
    sources: ["tests", "evaluations", "consistency"],
  },
  {
    id: "Q8",
    question: "What contradicts the README or self-presentation (false claims, hidden gaps)?",
    category: "meta",
    importance: "high",
    sources: ["consistency", "discovery", "capabilityOntology", "evaluations"],
  },
];

/**
 * Evidence source weights for Confidence auto-calculation.
 * Plan ref: "AST + Graph + Git + Runtime → Confidence=0.96, 不是 High"
 *
 * Rationale: AST-extracted facts are most reliable (parser-grounded).
 * Graph-derived facts are structural but inferred. Git facts are historical.
 * Regex/keyword facts are recall-oriented and may false-positive.
 */
const EVIDENCE_SOURCE_WEIGHTS = {
  ast: 0.40,       // Tree-sitter parsed symbols, calls, imports
  graph: 0.25,     // Architecture graph (PageRank, cycles, centrality)
  git: 0.15,       // Git history (commit count, change coupling)
  manifest: 0.10,  // package.json/pyproject.toml/Cargo.toml
  regex: 0.05,     // Regex scan (prompts, evaluations)
  keyword: 0.03,   // Keyword matching (responsibility, capability)
  inference: 0.02, // Inference engine output (derived, not primary)
};

/**
 * FINDING_SCHEMA — the JSON Schema every Finding conforms to.
 * Plan ref: "不是 Markdown，是 JSON Schema，GLM 最喜欢这种"
 * LLM consumes this schema directly (Phase 2: Finding Validation).
 */
const FINDING_SCHEMA = {
  type: "object",
  required: ["id", "questionId", "finding", "confidence", "importance", "coverage", "support", "counter", "limitations", "verified"],
  properties: {
    id: { type: "string", pattern: "^F-\\d{3}$" },
    questionId: { type: "string", pattern: "^Q\\d+$" },
    question: { type: "string" },
    finding: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    importance: { type: "string", enum: ["critical", "high", "medium", "low"] },
    coverage: { type: "number", minimum: 0, maximum: 1 },
    support: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["ast", "graph", "git", "manifest", "regex", "keyword", "inference"] },
          ref: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    counter: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          ref: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    limitations: { type: "array", items: { type: "string" } },
    checkedLocations: { type: "array", items: { type: "string" } },
    verified: { type: "string", enum: ["verified", "downgraded", "rejected", "pending"] },
    verificationNote: { type: "string" },
  },
};

class FindingsGenerator {
  /**
   * @param {EvidenceStore} evidenceStore
   */
  constructor(evidenceStore) {
    this.store = evidenceStore;
    this.findingCounter = 0;
  }

  generate() {
    this.store.ensureBuilt();
    const findings = [];
    for (const q of RESEARCH_QUESTIONS) {
      const qFindings = this._findingsForQuestion(q);
      findings.push(...qFindings);
    }
    const summary = this._summary(findings);
    return {
      schema: "findings-v1",
      generatedAt: new Date().toISOString(),
      questions: RESEARCH_QUESTIONS.map((q) => ({ id: q.id, question: q.question, category: q.category, importance: q.importance })),
      findings,
      summary,
    };
  }

  _findingsForQuestion(q) {
    const handlers = {
      Q1: () => this._q1EntryShape(),
      Q2: () => this._q2Orchestration(),
      Q3: () => this._q3Retrieval(),
      Q4: () => this._q4PromptManagement(),
      Q5: () => this._q5ToolRegistry(),
      Q6: () => this._q6AiProject(),
      Q7: () => this._q7Correctness(),
      Q8: () => this._q8ReadmeContradictions(),
    };
    const handler = handlers[q.id];
    if (!handler) return [];
    try {
      return handler().map((f) => this._finalize(f, q));
    } catch (_e) {
      return [];
    }
  }

  // ── Q1: Entry shape ───────────────────────────────────────────────────
  _q1EntryShape() {
    const eps = this.store.get("entrypoints") || {};
    const disc = this.store.get("discovery") || {};
    const findings = [];
    const allEps = eps.entrypoints || [];
    if (allEps.length === 0) {
      findings.push({
        finding: "No entry points detected by AST or filename scan.",
        confidence: this._conf(["ast", "regex"]),
        coverage: 0,
        support: [],
        counter: [],
        limitations: ["EntrypointsAnalyzer relies on AST main() detection and filename patterns; may miss framework-specific entry hooks (e.g., Spring Boot, plugin.xml)."],
        checkedLocations: ["**/cli.py", "**/main.py", "**/index.ts", "**/__main__.py", "manifest scripts field"],
      });
      return findings;
    }
    const byType = {};
    for (const e of allEps) byType[e.type] = (byType[e.type] || 0) + 1;
    const typeSummary = Object.entries(byType).map(([t, c]) => `${t}=${c}`).join(", ");
    const sampleEps = allEps.slice(0, 3).map((e) => `${e.file || e.path || e.name}`).join("; ");
    findings.push({
      finding: `Repository exposes ${allEps.length} entry points (${typeSummary}). Sample: ${sampleEps}.`,
      confidence: this._conf(["ast", "regex", "manifest"]),
      coverage: Math.min(1, allEps.length / 10),
      support: [
        { source: "ast", ref: "entrypoints.entrypoints", detail: `${allEps.length} entry points via AST main() / filename scan` },
        { source: "manifest", ref: "discovery.manifest", detail: disc.manifest ? `manifest=${disc.manifest.entry}` : "no manifest" },
      ],
      counter: [],
      limitations: ["Framework-specific entry hooks (e.g., Spring Boot application.properties, plugin.xml) may not be detected."],
      checkedLocations: ["**/cli.py", "**/main.py", "**/index.ts", "manifest scripts field", "package.json bin"],
    });
    return findings;
  }

  // ── Q2: Orchestration pattern ─────────────────────────────────────────
  _q2Orchestration() {
    const ap = this.store.get("archPattern") || {};
    const iflow = this.store.get("informationFlow") || {};
    const findings = [];
    if (ap.primaryPattern && ap.primaryPattern !== "Unknown") {
      const patternMatch = (ap.patterns || []).find((p) => p.pattern === ap.primaryPattern);
      const conf = patternMatch ? patternMatch.confidence : 0.4;
      findings.push({
        finding: `Primary architecture pattern is **${ap.primaryPattern}** (confidence ${conf.toFixed(2)}).`,
        confidence: this._conf(["keyword", "graph"]) * (0.5 + conf * 0.5),
        coverage: ap.unknown ? 0 : Math.max(0.3, conf),
        support: (patternMatch?.evidence || []).slice(0, 3).map((e) => ({ source: "keyword", ref: "archPattern.patterns", detail: e })),
        counter: [],
        limitations: (ap._meta?.limitations || []).slice(0, 2),
        checkedLocations: ap._meta?.checkedLocations || [],
      });
    } else {
      findings.push({
        finding: "No recognizable architecture pattern detected (Unknown).",
        confidence: this._conf(["keyword"]) * 0.5,
        coverage: 0,
        support: [],
        counter: [],
        limitations: ["Pattern detection is directory-name driven; code-only patterns are missed."],
        checkedLocations: ["discovery.topLevelDirs", "discovery.architectureSignalDirs"],
      });
    }
    if ((iflow.flows || []).length > 0) {
      const reachesLLM = iflow.reachesLLM === true;
      findings.push({
        finding: `Information flow analyzer detected ${iflow.totalFlows} end-to-end flows${reachesLLM ? ", with at least one reaching an LLM call site" : "; none reach an LLM call site"}.`,
        confidence: this._conf(["regex", "graph"]) * (iflow._meta?.strength === "weak" ? 0.6 : 0.8),
        coverage: Math.min(1, iflow.totalFlows / 5),
        support: [
          { source: "regex", ref: "informationFlow.llmCallSites", detail: `${(iflow.llmCallSites || []).length} LLM call sites` },
          { source: "graph", ref: "informationFlow.flows", detail: `${iflow.totalFlows} flows via BFS` },
        ],
        counter: [],
        limitations: (iflow._meta?.limitations || []).slice(0, 2),
        checkedLocations: iflow._meta?.checkedLocations || [],
      });
    }
    return findings;
  }

  // ── Q3: Retrieval (RAG) ───────────────────────────────────────────────
  _q3Retrieval() {
    const cap = this.store.get("capabilityOntology") || {};
    const resp = this.store.get("responsibility") || {};
    const sym = this.store.get("symbols") || {};
    const findings = [];
    const matrix = cap.capabilityMatrix || {};
    const retrievalCap = matrix.retrieval;
    const retrievalRespModules = (resp.responsibilities || []).filter((r) => r.responsibility === "Retrieval");

    // Primary finding: capability verdict
    if (retrievalCap && retrievalCap !== "missing" && retrievalCap !== "n/a") {
      findings.push({
        finding: `Retrieval capability is **${retrievalCap}** (maturity assessed).`,
        confidence: this._conf(["inference", "keyword"]),
        coverage: cap._meta?.coverage ? 0.7 : 0.5,
        support: [
          { source: "inference", ref: "capabilityOntology.capabilityMatrix.retrieval", detail: `retrieval=${retrievalCap}` },
        ],
        counter: [],
        limitations: (cap._meta?.limitations || []).slice(0, 2),
        checkedLocations: ["responsibility.responsibilities", "symbols.functions[].name", "tools.tools[]"],
      });
    } else {
      // Negative finding — searched but found nothing
      findings.push({
        finding: `No Retrieval (RAG) capability detected. CapabilityOntology reports retrieval=${retrievalCap || "n/a"}.`,
        confidence: this._conf(["inference", "keyword"]) * 0.8,
        coverage: 0.6,
        support: [
          { source: "inference", ref: "capabilityOntology.capabilityMatrix.retrieval", detail: `retrieval=${retrievalCap || "n/a"}` },
        ],
        counter: retrievalRespModules.length > 0
          ? [{ source: "keyword", ref: "responsibility.responsibilities", detail: `ResponsibilityAnalyzer tagged ${retrievalRespModules.length} module(s) as Retrieval: ${retrievalRespModules.slice(0, 2).map((m) => m.module).join(", ")}` }]
          : [],
        limitations: ["CapabilityOntology gate may under-classify repos with implicit RAG (no explicit vector store symbols)."],
        checkedLocations: ["embedding/", "vector/", "faiss/", "pgvector/", "chroma/", "symbols.functions[].name (retriev/embed/vector search)", "prompts.prompts[]"],
      });
    }
    return findings;
  }

  // ── Q4: Prompt management ─────────────────────────────────────────────
  _q4PromptManagement() {
    const prompts = this.store.get("prompts") || {};
    const findings = [];
    const total = prompts.totalPrompts || 0;
    if (total === 0) {
      findings.push({
        finding: "No prompts detected by AST or regex scan.",
        confidence: this._conf(["ast", "regex"]) * 0.7,
        coverage: 0.5,
        support: [],
        counter: [],
        limitations: ["PromptsAnalyzer detects SYSTEM_PROMPT/INSTRUCTION/PROMPT variable assignments; dynamic prompt assembly may be missed."],
        checkedLocations: ["**/*.py (SYSTEM_PROMPT/INSTRUCTION/PROMPT)", "**/*.ts (systemPrompt/instruction)", "prompts/", "**/prompt*.ts"],
      });
      return findings;
    }
    const byType = {};
    for (const p of prompts.prompts || []) byType[p.type] = (byType[p.type] || 0) + 1;
    findings.push({
      finding: `Detected ${total} prompts (${Object.entries(byType).map(([t, c]) => `${t}=${c}`).join(", ")}).`,
      confidence: this._conf(["ast", "regex"]),
      coverage: Math.min(1, total / 5),
      support: (prompts.prompts || []).slice(0, 3).map((p) => ({ source: "regex", ref: `prompts.prompts (${p.file}:${p.line})`, detail: (p.snippet || "").slice(0, 80) })),
      counter: [],
      limitations: ["Prompt lifecycle (versioning, assembly, compression) cannot be inferred from static scan."],
      checkedLocations: ["**/*.py (SYSTEM_PROMPT/INSTRUCTION)", "**/*.ts (systemPrompt/instruction)", "prompts/", "**/prompt*.ts"],
    });
    return findings;
  }

  // ── Q5: Tool registry ─────────────────────────────────────────────────
  _q5ToolRegistry() {
    const tools = this.store.get("tools") || {};
    const findings = [];
    const total = tools.totalTools || 0;
    if (total === 0) {
      findings.push({
        finding: "No tools detected by AST decorator or schema-first scan.",
        confidence: this._conf(["ast", "regex"]) * 0.7,
        coverage: 0.5,
        support: [],
        counter: [],
        limitations: ["ToolsAnalyzer detects @tool decorator, Tool() class, RPC_TOOLS schema; custom frameworks may be missed."],
        checkedLocations: ["@tool decorator", "Tool()/ToolNode()", "RPC_TOOLS/ToolDef[]", "skills/*/execute.py", "bundled_skills/*/"],
      });
      return findings;
    }
    const byFw = {};
    for (const t of tools.tools || []) byFw[t.framework] = (byFw[t.framework] || 0) + 1;
    findings.push({
      finding: `Detected ${total} tools (${Object.entries(byFw).map(([f, c]) => `${f}=${c}`).join(", ")}).`,
      confidence: this._conf(["ast", "regex"]),
      coverage: Math.min(1, total / 10),
      support: (tools.tools || []).slice(0, 3).map((t) => ({ source: "ast", ref: `tools.tools (${t.file})`, detail: `[${t.framework}] ${t.name}` })),
      counter: [],
      limitations: ["Tool-agent binding (which agent calls which tool) requires call-graph resolution, not yet implemented."],
      checkedLocations: ["@tool/@mcp.tool/@agent.tool", "Tool()/ToolNode()", "RPC_TOOLS[]", "skills/*/execute.py", "bundled_skills/*/"],
    });
    return findings;
  }

  // ── Q6: AI project confirmation ───────────────────────────────────────
  _q6AiProject() {
    const cap = this.store.get("capabilityOntology") || {};
    const prompts = this.store.get("prompts") || {};
    const tools = this.store.get("tools") || {};
    const iflow = this.store.get("informationFlow") || {};
    const findings = [];
    const isAI = cap.isAIProject === true;
    const signals = [];
    if ((prompts.totalPrompts || 0) > 0) signals.push({ source: "regex", ref: "prompts.totalPrompts", detail: `${prompts.totalPrompts} prompts` });
    if ((tools.totalTools || 0) > 0) signals.push({ source: "ast", ref: "tools.totalTools", detail: `${tools.totalTools} tools` });
    if ((iflow.llmCallSites || []).length > 0) signals.push({ source: "regex", ref: "informationFlow.llmCallSites", detail: `${iflow.llmCallSites.length} LLM call sites` });

    findings.push({
      finding: isAI
        ? `Confirmed AI project. Signals: ${signals.map((s) => s.detail).join("; ")}.`
        : `Not classified as AI project. CapabilityOntology gate found insufficient AI signals.`,
      confidence: isAI
        ? this._conf(["inference", ...signals.map((s) => s.source)])
        : this._conf(["inference"]) * 0.6,
      coverage: signals.length / 4,
      support: isAI ? signals : [{ source: "inference", ref: "capabilityOntology.isAIProject", detail: "isAIProject=false" }],
      counter: isAI ? [] : signals,
      limitations: (cap._meta?.limitations || []).slice(0, 2),
      checkedLocations: ["prompts.prompts[]", "tools.tools[]", "informationFlow.llmCallSites[]", "responsibility.responsibilities[] (LLM Interface)"],
    });
    return findings;
  }

  // ── Q7: Correctness validation ────────────────────────────────────────
  _q7Correctness() {
    const tests = this.store.get("tests") || {};
    const evals = this.store.get("evaluations") || {};
    const findings = [];
    const testCount = tests.totalTestFiles || 0;
    const evalCount = (evals.evalFiles || []).length;
    findings.push({
      finding: testCount > 0
        ? `Test suite: ${testCount} files, ${tests.totalTestFunctions || 0} test functions.`
        : "No test files detected.",
      confidence: this._conf(["ast", "regex"]),
      coverage: Math.min(1, testCount / 50),
      support: testCount > 0
        ? [{ source: "ast", ref: "tests.totalTestFiles", detail: `${testCount} test files, ${tests.totalTestFunctions || 0} functions` }]
        : [],
      counter: [],
      limitations: ["Test quality (assertion density, coverage) cannot be inferred from file/function count alone."],
      checkedLocations: ["**/test_*.py", "**/*_test.go", "**/*.test.ts", "**/*.spec.ts", "**/tests/", "**/__tests__/"],
    });
    if (evalCount > 0 || evals.hasEvaluation) {
      findings.push({
        finding: `Evaluation infrastructure detected: ${evalCount} eval files, hasEvaluation=${evals.hasEvaluation}.`,
        confidence: this._conf(["regex", "keyword"]),
        coverage: Math.min(1, evalCount / 3),
        support: [{ source: "regex", ref: "evaluations.evalFiles", detail: `${evalCount} eval files; patterns: ${(evals.patterns || []).join(", ")}` }],
        counter: [],
        limitations: ["EvaluationsAnalyzer detects score/benchmark/judge keywords; may false-positive on type names containing 'score'."],
        checkedLocations: ["**/eval*.py", "**/benchmark*", "**/leaderboard*", "evaluations/", "metrics/"],
      });
    } else {
      findings.push({
        finding: "No evaluation infrastructure detected (no eval files, hasEvaluation=false).",
        confidence: this._conf(["regex", "keyword"]) * 0.8,
        coverage: 0.4,
        support: [],
        counter: [],
        limitations: ["EvaluationsAnalyzer keyword-based; may miss eval logic embedded in test files."],
        checkedLocations: ["**/eval*.py", "**/benchmark*", "**/leaderboard*", "evaluations/", "metrics/"],
      });
    }
    return findings;
  }

  // ── Q8: README contradictions ─────────────────────────────────────────
  _q8ReadmeContradictions() {
    const con = this.store.get("consistency") || {};
    const findings = [];
    const contradictions = con.contradictions || [];
    const warnings = con.warnings || [];
    if (contradictions.length === 0 && warnings.length === 0) {
      findings.push({
        finding: "No cross-analyzer contradictions or warnings detected. All analyzers agree.",
        confidence: this._conf(["inference"]),
        coverage: 1,
        support: [{ source: "inference", ref: "consistency.summary", detail: con.summary?.message || "stable" }],
        counter: [],
        limitations: ["ConsistencyAnalyzer only checks 6 rule patterns (C1-C6); subtle disagreements may exist."],
        checkedLocations: ["capabilityOntology vs prompts/tools/informationFlow", "responsibility vs capabilityOntology", "tests vs evaluations"],
      });
      return findings;
    }
    for (const c of contradictions.slice(0, 3)) {
      findings.push({
        finding: `Contradiction ${c.id}: ${c.topic} — ${c.sourceA.analyzer} says "${c.sourceA.claim}" but ${c.sourceB.analyzer} says "${c.sourceB.claim}".`,
        confidence: this._conf(["inference"]) * 0.9,
        coverage: 0.8,
        support: [
          { source: "inference", ref: `consistency.contradictions.${c.id}.sourceA`, detail: c.sourceA.claim },
          { source: "inference", ref: `consistency.contradictions.${c.id}.sourceB`, detail: c.sourceB.claim },
        ],
        counter: [],
        limitations: [c.interpretation || ""],
        checkedLocations: [`${c.sourceA.analyzer} output`, `${c.sourceB.analyzer} output`],
      });
    }
    return findings;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Auto-compute confidence from evidence sources.
   * Plan ref: "AST + Graph + Git + Runtime → Confidence=0.96"
   * Sums the weights of distinct evidence sources, capped at 0.95.
   */
  _conf(sources) {
    const seen = new Set();
    let sum = 0;
    for (const s of sources) {
      if (!seen.has(s)) {
        seen.add(s);
        sum += EVIDENCE_SOURCE_WEIGHTS[s] || 0;
      }
    }
    return Math.min(0.95, sum);
  }

  _finalize(f, q) {
    this.findingCounter += 1;
    return {
      id: `F-${String(this.findingCounter).padStart(3, "0")}`,
      questionId: q.id,
      question: q.question,
      finding: f.finding,
      confidence: Number((f.confidence || 0).toFixed(2)),
      importance: f.importance || q.importance,
      coverage: Number((f.coverage || 0).toFixed(2)),
      support: f.support || [],
      counter: f.counter || [],
      limitations: f.limitations || [],
      checkedLocations: f.checkedLocations || [],
      verified: "pending",
      verificationNote: "",
    };
  }

  _summary(findings) {
    const byImportance = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) byImportance[f.importance] = (byImportance[f.importance] || 0) + 1;
    const verified = findings.filter((f) => f.verified === "verified").length;
    const downgraded = findings.filter((f) => f.verified === "downgraded").length;
    const hasCounter = findings.filter((f) => f.counter.length > 0).length;
    return {
      total: findings.length,
      byImportance,
      verifiedCount: verified,
      downgradedCount: downgraded,
      findingsWithCounterEvidence: hasCounter,
      averageConfidence: findings.length > 0
        ? Number((findings.reduce((s, f) => s + f.confidence, 0) / findings.length).toFixed(2))
        : 0,
    };
  }
}

// ===========================================================================
// Verification Loop — v2 pipeline: Finding → Counter Evidence → Verified
//
// Plan reference: plan0726.md Part 6
//   Finding → Counter Evidence → Still Valid? → Verified Finding
//
// For each Finding, the loop:
//   1. Searches for Counter Evidence in other analyzers' outputs
//   2. If counter evidence found, downgrades confidence
//   3. Marks Finding as verified / downgraded / rejected
//
// This is the script-layer Verification Loop. The LLM Phase 2 (Finding
// Validation) builds on top of this with Merge/Split/Reject decisions.
// ===========================================================================

class VerificationLoop {
  /**
   * @param {object} findingsOutput - Output of FindingsGenerator.generate()
   * @param {EvidenceStore} evidenceStore
   */
  constructor(findingsOutput, evidenceStore) {
    this.findingsOutput = findingsOutput || {};
    this.findings = this.findingsOutput.findings || [];
    this.store = evidenceStore;
  }

  run() {
    const verified = this.findings.map((f) => this._verify(f));
    const summary = this._summary(verified);
    return {
      ...this.findingsOutput,
      findings: verified,
      verificationSummary: summary,
    };
  }

  _verify(finding) {
    const counters = [...finding.counter];
    let downgraded = false;
    let note = "";

    // Rule V1: If ConsistencyAnalyzer flagged a contradiction on this topic,
    // the finding's confidence must be downgraded.
    const con = this.store.get("consistency") || {};
    const relevantCon = (con.contradictions || []).find((c) => {
      const topic = (c.topic || "").toLowerCase();
      const findingText = (finding.finding || "").toLowerCase();
      return findingText.includes(topic) || topic.includes(finding.questionId.toLowerCase());
    });
    if (relevantCon) {
      counters.push({
        source: "inference",
        ref: `consistency.contradictions.${relevantCon.id}`,
        detail: relevantCon.interpretation,
      });
      downgraded = true;
      note = `Downgraded due to contradiction ${relevantCon.id}: ${relevantCon.topic}`;
    }

    // Rule V2: If the finding's confidence is already low (<0.3) and has
    // counter evidence, mark as "rejected" — too weak to publish.
    let verifiedStatus = "verified";
    if (downgraded && finding.confidence < 0.3) {
      verifiedStatus = "rejected";
      note = `Rejected: confidence ${finding.confidence.toFixed(2)} < 0.3 after counter evidence`;
    } else if (downgraded) {
      verifiedStatus = "downgraded";
    }

    // Rule V3: Negative findings (checkedLocations but no support) are
    // always "verified" — there's nothing to contradict.
    if (finding.support.length === 0 && finding.checkedLocations.length > 0 && counters.length === 0) {
      verifiedStatus = "verified";
      note = "Negative finding (searched, found nothing) — verified by absence";
    }

    return {
      ...finding,
      counter: counters,
      verified: verifiedStatus,
      verificationNote: note,
      confidence: downgraded
        ? Number((finding.confidence * 0.6).toFixed(2))
        : finding.confidence,
    };
  }

  _summary(findings) {
    const status = { verified: 0, downgraded: 0, rejected: 0, pending: 0 };
    for (const f of findings) status[f.verified] = (status[f.verified] || 0) + 1;
    return {
      total: findings.length,
      ...status,
      counterEvidenceFound: findings.filter((f) => f.counter.length > 0).length,
      averageConfidenceAfterVerification: findings.length > 0
        ? Number((findings.reduce((s, f) => s + f.confidence, 0) / findings.length).toFixed(2))
        : 0,
    };
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
    this._findingsCache = null; // lazy: FindingsGenerator + VerificationLoop output
  }

  /**
   * v2 pipeline: run FindingsGenerator + VerificationLoop, cache result.
   * Plan ref: plan0726.md Part 1 + Part 6 — Findings are the canonical
   * unit the LLM consumes. Verification Loop adds Counter Evidence and
   * marks each Finding as verified/downgraded/rejected.
   */
  _findings() {
    if (this._findingsCache) return this._findingsCache;
    try {
      const gen = new FindingsGenerator(this.store);
      const raw = gen.generate();
      const loop = new VerificationLoop(raw, this.store);
      this._findingsCache = loop.run();
    } catch (_e) {
      this._findingsCache = { findings: [], summary: { total: 0 }, verificationSummary: { total: 0 } };
    }
    // Also persist to store so `analyze-output.mjs` and downstream consumers
    // can access it via store.findings.
    this.s.findings = this._findingsCache;
    return this._findingsCache;
  }

  generate() {
    const sections = [
      this._header(),
      this._researchPrinciples(),
      this._findingsSection(),
      this._consistencyFindings(),
      this._executiveBrief(),
      this._architectureInsights(),
      this._architectureSemantics(),
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
        `- **Trace 价值密度优先于覆盖度** — 每个 Trace 必须回答一个其答案会改变工程师对系统理解的架构问题。低价值 Trace 应删除而非保留凑数。5 个锋利的 Trace 胜过 8 个平庸的 Trace。`,
        `- **Confidence 必须有统一标准** — High: ≥3 个独立证据源；Medium: 2 个证据源；Low: 1 个证据源；Speculative: 无直接证据（仅推理）。所有置信度标签必须符合此定义。`,
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
      "- **Trace density over coverage** — Every Trace must answer one architectural question whose answer would change an engineer's understanding of the system. Low-value Traces should be deleted, not kept to pad the count. 5 sharp Traces beat 8 mediocre ones.",
      "- **Confidence MUST follow a unified standard** — High: ≥3 independent evidence sources; Medium: 2 sources; Low: 1 source; Speculative: no direct evidence (reasoning only). All confidence labels MUST conform to this definition.",
    ].join("\n");
  }

  /**
   * v2 Findings section — the canonical unit the LLM consumes.
   *
   * Plan ref: plan0726.md Part 1 + Part 2
   *   - Every Finding binds to a Research Question (Q1-Q8)
   *   - Confidence/Coverage/Importance auto-computed (not "High/Med/Low")
   *   - Counter Evidence + Verified status from VerificationLoop
   *   - Negative Evidence recorded as "checkedLocations" with "nothing found"
   *
   * Placed BEFORE consistency and executive brief, because Findings are the
   * primary input for LLM Phase 2 (Finding Validation). The raw analyzer
   * sections below serve as supporting evidence for verification.
   */
  _findingsSection() {
    const out = this._findings();
    const findings = out.findings || [];
    if (findings.length === 0) return null;

    const zh = this.lang === "zh";
    const lines = [];
    lines.push(zh ? "## ★ Findings（v2 规范化发现）" : "## ★ Findings (v2 normalized)");
    lines.push("");
    lines.push(zh
      ? "> 每个 Finding 绑定一个 Research Question (Q1-Q8)，并携带自动计算的 confidence / coverage / importance。"
      : "> Every Finding binds to a Research Question (Q1-Q8) with auto-computed confidence / coverage / importance."
    );
    lines.push(zh
      ? "> LLM 应优先消费本节；下方各 analyzer 章节作为支持证据。verified=downgraded/rejected 的 Finding 不应直接引用，需先核查。"
      : "> LLM should consume this section first; analyzer sections below serve as supporting evidence. Findings with verified=downgraded/rejected must not be cited without re-verification."
    );
    lines.push("");

    // Summary
    const summary = out.summary || {};
    const vSum = out.verificationSummary || {};
    lines.push(zh
      ? `**总览**: ${summary.total || 0} findings (${(summary.byImportance || {}).critical || 0} critical / ${(summary.byImportance || {}).high || 0} high / ${(summary.byImportance || {}).medium || 0} medium / ${(summary.byImportance || {}).low || 0} low); 平均置信度 ${summary.averageConfidence || 0}; 验证后: ${vSum.verified || 0} verified / ${vSum.downgraded || 0} downgraded / ${vSum.rejected || 0} rejected`
      : `**Summary**: ${summary.total || 0} findings (${(summary.byImportance || {}).critical || 0} critical / ${(summary.byImportance || {}).high || 0} high / ${(summary.byImportance || {}).medium || 0} medium / ${(summary.byImportance || {}).low || 0} low); avg confidence ${summary.averageConfidence || 0}; after verification: ${vSum.verified || 0} verified / ${vSum.downgraded || 0} downgraded / ${vSum.rejected || 0} rejected`
    );
    lines.push("");

    // Research Questions index
    const questions = out.questions || [];
    if (questions.length > 0) {
      lines.push(zh ? "### Research Questions" : "### Research Questions");
      lines.push("");
      for (const q of questions) {
        lines.push(`- **${q.id}** [${q.importance}] ${q.question}`);
      }
      lines.push("");
    }

    // Findings table (compact view)
    lines.push(zh ? "### Findings 表" : "### Findings table");
    lines.push("");
    lines.push("| ID | Q | Importance | Confidence | Coverage | Verified | Finding |");
    lines.push("|----|---|------------|------------|----------|----------|---------|");
    for (const f of findings) {
      const findingShort = (f.finding || "").replace(/\|/g, "\\|").slice(0, 120);
      const verifiedIcon = f.verified === "verified" ? "✅"
        : f.verified === "downgraded" ? "⚠️"
        : f.verified === "rejected" ? "❌"
        : "⏳";
      lines.push(`| ${f.id} | ${f.questionId} | ${f.importance} | ${f.confidence.toFixed(2)} | ${f.coverage.toFixed(2)} | ${verifiedIcon} ${f.verified} | ${findingShort} |`);
    }
    lines.push("");

    // Detailed findings (full structure)
    lines.push(zh ? "### Findings 详情（JSON Schema 化）" : "### Findings detail (JSON-schema structured)");
    lines.push("");
    for (const f of findings) {
      lines.push(`#### ${f.id} — ${f.questionId}: ${f.question}`);
      lines.push("");
      lines.push(`- **Finding**: ${f.finding}`);
      lines.push(`- **Importance**: ${f.importance}`);
      lines.push(`- **Confidence**: ${f.confidence.toFixed(2)} ${zh ? "(自动计算: " : "(auto-computed: "}${[...new Set((f.support || []).map((s) => s.source))].join("+") || "none"}${zh ? ")" : ")"};`);
      lines.push(`- **Coverage**: ${f.coverage.toFixed(2)} ${zh ? "(扫描覆盖范围)" : "(scan coverage)"}`);
      lines.push(`- **Verified**: ${f.verified}${f.verificationNote ? ` — ${f.verificationNote}` : ""}`);
      if ((f.support || []).length > 0) {
        lines.push(zh ? "- **Support（支持证据）**:" : "- **Support**:");
        for (const s of f.support) lines.push(`  - [${s.source}] ${s.ref} — ${s.detail}`);
      }
      if ((f.counter || []).length > 0) {
        lines.push(zh ? "- **Counter（反证）**:" : "- **Counter evidence**:");
        for (const c of f.counter) lines.push(`  - [${c.source}] ${c.ref} — ${c.detail}`);
      }
      if ((f.checkedLocations || []).length > 0) {
        lines.push(zh ? `- **Checked Locations（已检查位置）**: ${f.checkedLocations.join(", ")}` : `- **Checked Locations**: ${f.checkedLocations.join(", ")}`);
      }
      if ((f.limitations || []).length > 0) {
        lines.push(zh ? `- **Limitations**: ${f.limitations.join("; ")}` : `- **Limitations**: ${f.limitations.join("; ")}`);
      }
      lines.push("");
    }

    return lines.join("\n");
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

    // Documentation & metadata — monorepo-aware recursive detection.
    // Previously we only checked `disc.metadataFiles` (root-level files from
    // PROJECT_DISCOVERY_RULES). This caused false negatives in monorepos
    // where CHANGELOG/CONTRIBUTING/SECURITY live in workspace packages
    // (pi: 5 packages/*/CHANGELOG.md existed but §6 reported "No CHANGELOG").
    // We now scan all files in the repo for these metadata files.
    const allRepoFiles = (disc.allFiles || []).map((f) => f.toLowerCase());
    const metadataFiles = (disc.metadataFiles || []).map((f) => f.toLowerCase());
    const hasFileAnywhere = (prefixes) => {
      // Check root-level metadataFiles first (fast path)
      if (metadataFiles.some((f) => prefixes.some((p) => f.startsWith(p)))) return true;
      // Then scan all files (recursive, monorepo-aware)
      return allRepoFiles.some((f) => {
        const name = f.split(/[\\/]/).pop(); // basename
        return prefixes.some((p) => name.startsWith(p));
      });
    };

    const hasReadme = hasFileAnywhere(["readme"]);
    if (!hasReadme) {
      findings.push(zh ? "未找到 README 文件" : "No README file found");
    }
    const hasLicense = hasFileAnywhere(["license"]);
    if (!hasLicense) {
      findings.push(zh ? "未找到 LICENSE 文件" : "No LICENSE file found");
    }
    const hasContributing = hasFileAnywhere(["contributing"]);
    if (!hasContributing) {
      findings.push(zh ? "未找到 CONTRIBUTING 指南（外部贡献流程不明）" : "No CONTRIBUTING guide found (external contribution process unclear)");
    }
    const hasSecurity = hasFileAnywhere(["security"]);
    if (!hasSecurity) {
      findings.push(zh ? "未找到 SECURITY 策略（漏洞报告流程不明）" : "No SECURITY policy found (vulnerability reporting process unclear)");
    }
    const hasChangelog = hasFileAnywhere(["changelog"]);
    if (!hasChangelog) {
      findings.push(zh ? "未找到 CHANGELOG（版本演进缺乏结构化记录）" : "No CHANGELOG found (version evolution lacks structured record)");
    }

    // Agent instructions (AI-agent readiness) — already recursive via DiscoveryAnalyzer
    const agentFiles = (disc.agentFiles || []).map((f) => f.toLowerCase());
    if (agentFiles.length === 0) {
      findings.push(zh ? "未找到 AI Agent 指令文件（AGENTS.md / CLAUDE.md / SKILL.md 等）" : "No AI Agent instruction files found (AGENTS.md / CLAUDE.md / SKILL.md etc.)");
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

  /**
   * Cross-analyzer consistency findings — FIRST priority in the brief.
   *
   * Self-detected contradictions are the most research-valuable findings:
   * they tell the LLM "here is where the analyzers disagree, investigate
   * before trusting either side". Surfacing them before PageRank / Architecture
   * Insights reframes the brief from "analyzer output dump" to "research agenda".
   */
  _consistencyFindings() {
    const con = this._get("consistency");
    if (!con || (con.contradictions || []).length === 0 && (con.warnings || []).length === 0) {
      return null;
    }

    const lines = [];
    if (this.lang === "zh") {
      lines.push("## A. 跨分析器一致性检查（首要优先级）");
      lines.push("");
      lines.push("> 系统自己发现自己的矛盾，是最值钱的研究线索。");
      lines.push("> LLM 应优先调查矛盾，再决定信任哪个分析器。");
      lines.push("");
      lines.push(`**总体状态**: ${con.summary?.message || "未知"}`);
      lines.push("");
    } else {
      lines.push("## A. Cross-Analyzer Consistency (First Priority)");
      lines.push("");
      lines.push("> Self-detected contradictions are the most research-valuable findings.");
      lines.push("> The LLM should investigate contradictions before trusting either analyzer.");
      lines.push("");
      lines.push(`**Overall status**: ${con.summary?.message || "unknown"}`);
      lines.push("");
    }

    const contradictions = con.contradictions || [];
    const warnings = con.warnings || [];

    if (contradictions.length > 0) {
      if (this.lang === "zh") {
        lines.push(`### 矛盾（${contradictions.length} 条，severity=high/medium）`);
        lines.push("");
        lines.push("| ID | Topic | Severity | Source A | Source B | Interpretation |");
        lines.push("|----|-------|----------|----------|----------|----------------|");
        for (const c of contradictions) {
          lines.push(`| ${c.id} | ${c.topic} | ${c.severity} | ${c.sourceA.analyzer}: ${c.sourceA.claim} | ${c.sourceB.analyzer}: ${c.sourceB.claim} | ${c.interpretation} |`);
        }
        lines.push("");
        for (const c of contradictions) {
          lines.push(`#### ${c.id}: ${c.topic}`);
          lines.push("");
          lines.push(`- **Source A**: ${c.sourceA.analyzer} — ${c.sourceA.claim}`);
          lines.push(`- **Source B**: ${c.sourceB.analyzer} — ${c.sourceB.claim}`);
          lines.push(`- **解读**: ${c.interpretation}`);
          if (c.recommendation) lines.push(`- **建议**: ${c.recommendation}`);
          lines.push("");
        }
      } else {
        lines.push(`### Contradictions (${contradictions.length}, severity=high/medium)`);
        lines.push("");
        lines.push("| ID | Topic | Severity | Source A | Source B | Interpretation |");
        lines.push("|----|-------|----------|----------|----------|----------------|");
        for (const c of contradictions) {
          lines.push(`| ${c.id} | ${c.topic} | ${c.severity} | ${c.sourceA.analyzer}: ${c.sourceA.claim} | ${c.sourceB.analyzer}: ${c.sourceB.claim} | ${c.interpretation} |`);
        }
        lines.push("");
        for (const c of contradictions) {
          lines.push(`#### ${c.id}: ${c.topic}`);
          lines.push("");
          lines.push(`- **Source A**: ${c.sourceA.analyzer} — ${c.sourceA.claim}`);
          lines.push(`- **Source B**: ${c.sourceB.analyzer} — ${c.sourceB.claim}`);
          lines.push(`- **Interpretation**: ${c.interpretation}`);
          if (c.recommendation) lines.push(`- **Recommendation**: ${c.recommendation}`);
          lines.push("");
        }
      }
    }

    if (warnings.length > 0) {
      if (this.lang === "zh") {
        lines.push(`### 警告（${warnings.length} 条，severity=medium/low）`);
        lines.push("");
        lines.push("| ID | Topic | Severity | Source A | Source B | Interpretation |");
        lines.push("|----|-------|----------|----------|----------|----------------|");
        for (const w of warnings) {
          lines.push(`| ${w.id} | ${w.topic} | ${w.severity} | ${w.sourceA.analyzer}: ${w.sourceA.claim} | ${w.sourceB.analyzer}: ${w.sourceB.claim} | ${w.interpretation} |`);
        }
      } else {
        lines.push(`### Warnings (${warnings.length}, severity=medium/low)`);
        lines.push("");
        lines.push("| ID | Topic | Severity | Source A | Source B | Interpretation |");
        lines.push("|----|-------|----------|----------|----------|----------------|");
        for (const w of warnings) {
          lines.push(`| ${w.id} | ${w.topic} | ${w.severity} | ${w.sourceA.analyzer}: ${w.sourceA.claim} | ${w.sourceB.analyzer}: ${w.sourceB.claim} | ${w.interpretation} |`);
        }
      }
    }

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

    // topLevelDirs: show up to 15 with "等 N 个" suffix when truncated.
    // Previously hardcoded .slice(0, 10) hid important dirs like `crates/`
    // (buzz: Rust workspace root was invisible in §1).
    const allTopDirs = disc.topLevelDirs || [];
    const shownDirs = allTopDirs.slice(0, 15);
    const dirsStr = shownDirs.join(", ") + (allTopDirs.length > 15 ? `, ... (+${allTopDirs.length - 15} more)` : "");

    // Repository name: show repo dir name + package name when they differ.
    // (openworker repo → package "coworker"; worldmonitor → "world-monitor")
    const repoDisplay = disc.repoName || "unknown";
    const pkgName = disc.packageName;
    const repoCell = (pkgName && pkgName !== "unknown" && pkgName.toLowerCase() !== repoDisplay.toLowerCase())
      ? `${repoDisplay} (package: ${pkgName})`
      : repoDisplay;

    const lines = [
      "## 1. Executive Brief",
      "",
      `| Dimension | Value |`,
      `|-----------|-------|`,
      `| Repository | ${repoCell} |`,
      `| Manifest | ${manifest.entry || "none"} (${manifest.language || "unknown"}) |`,
      `| Version | ${manifest.version || "N/A"} |`,
      `| Source files | ${totalSource} |`,
      `| Top languages | ${topLangs || "N/A"} |`,
      `| Top-level dirs | ${dirsStr} |`,
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

  /**
   * Architecture Semantics — the seven inference analyzers' output.
   * This section elevates the brief from "what the repo contains" (fact
   * extraction) to "why it's designed this way" (architecture reasoning).
   * Consumed by architects who need pattern/responsibility/capability insight.
   */
  _architectureSemantics() {
    const pattern = this._get("archPattern");
    const resp = this._get("responsibility");
    const stab = this._get("stability");
    const coupling = this._get("changeCoupling");
    const flow = this._get("informationFlow");
    const smells = this._get("dependencySmell");
    const caps = this._get("capabilityOntology");

    // If none of the semantic analyzers produced data, skip this section.
    const hasAny =
      pattern.patterns || resp.responsibilities || stab.modules ||
      coupling.coupledPairs || flow.flows || smells.smells || caps.capabilities;
    if (!hasAny) return null;

    const isZh = this.lang === "zh";
    const lines = [];

    // --- Section header ---
    lines.push(isZh
      ? "## 2.5. 架构语义层（推理而非统计）"
      : "## 2.5. Architecture Semantics (Inference, not Statistics)"
    );
    lines.push(isZh
      ? "本节由 7 个推理分析器生成，回答架构师真正关心的问题：这是什么架构？各模块承担什么职责？有哪些能力与风险？"
      : "Generated by 7 inference analyzers that answer architect-level questions: what pattern? what responsibilities? what capabilities? what risks?"
    );
    lines.push("");

    // --- 1. Architecture Pattern ---
    if (pattern.patterns && pattern.patterns.length > 0) {
      lines.push(isZh ? "### 架构模式" : "### Architecture Pattern");
      lines.push(isZh
        ? `**主模式**: ${pattern.primaryPattern} (置信度 ${pattern.patterns[0].confidence})`
        : `**Primary**: ${pattern.primaryPattern} (confidence ${pattern.patterns[0].confidence})`
      );
      lines.push(isZh ? "" : "");
      lines.push(isZh ? "| 模式 | 置信度 | 证据 |" : "| Pattern | Confidence | Evidence |");
      lines.push("|--------|-----------|----------|");
      for (const p of pattern.patterns.slice(0, 5)) {
        lines.push(`| ${p.pattern} | ${p.confidence} | ${p.evidence.slice(0, 3).join("; ")} |`);
      }
      lines.push("");
    }

    // --- 2. Responsibility Matrix ---
    if (resp.responsibilities && resp.responsibilities.length > 0) {
      lines.push(isZh ? "### 职责矩阵" : "### Responsibility Matrix");
      const mapped = resp.responsibilities.filter((r) => r.responsibility !== "Uncategorized");
      lines.push(isZh
        ? `已映射 ${mapped.length}/${resp.responsibilities.length} 个模块到职责类别。`
        : `Mapped ${mapped.length}/${resp.responsibilities.length} modules to responsibility categories.`
      );
      lines.push("");
      lines.push(isZh ? "| 模块 | 职责 | 置信度 | 文件数 | 能力 |" : "| Module | Responsibility | Confidence | Files | Capabilities |");
      lines.push("|--------|---------------|-----------|-------|--------------|");
      for (const r of mapped.slice(0, 10)) {
        lines.push(`| ${r.module} | ${r.responsibility} | ${r.confidence} | ${r.fileCount} | ${(r.capabilities || []).join(", ")} |`);
      }
      lines.push("");
    }

    // --- 3. Stability (A/I) ---
    if (stab.modules && stab.modules.length > 0) {
      lines.push(isZh ? "### 稳定性与抽象度（Robert C. Martin A/I）" : "### Stability & Abstractness (A/I Metrics)");
      lines.push(isZh
        ? `Zone 分布: ${JSON.stringify(stab.zoneDistribution)}。Zone of Pain = 具体且被大量依赖（难变更）；Zone of Uselessness = 过度抽象（少被使用）。`
        : `Zone distribution: ${JSON.stringify(stab.zoneDistribution)}. Zone of Pain = concrete + heavily depended on (hard to change); Zone of Uselessness = over-abstract (rarely used).`
      );
      lines.push("");
      lines.push(isZh ? "| 模块 | I (不稳定) | A (抽象) | Zone | Ca | Ce |" : "| Module | I (Instability) | A (Abstractness) | Zone | Ca | Ce |");
      lines.push("|--------|----------------|------------------|------|----|----|");
      for (const m of stab.modules.slice(0, 8)) {
        lines.push(`| ${m.module} | ${m.instability} | ${m.abstractness} | ${m.zone} | ${m.ca} | ${m.ce} |`);
      }
      lines.push("");
    }

    // --- 4. Change Coupling ---
    if (coupling.coupledPairs && coupling.coupledPairs.length > 0) {
      lines.push(isZh ? "### 变更耦合（逻辑依赖）" : "### Change Coupling (Logical Dependencies)");
      lines.push(isZh
        ? `分析 ${coupling.totalCommitsAnalyzed} 个提交，发现 ${coupling.totalPairs} 个耦合对（其中 ${coupling.logicalPairs} 个为逻辑依赖——无 import 关系但经常一起变更）。`
        : `Analyzed ${coupling.totalCommitsAnalyzed} commits, found ${coupling.totalPairs} coupled pairs (${coupling.logicalPairs} logical — no import dep but change together).`
      );
      lines.push("");
      lines.push(isZh ? "| 文件 A | 文件 B | 同变更次数 | 类型 |" : "| File A | File B | Co-changes | Type |");
      lines.push("|--------|--------|------------|------|");
      for (const p of coupling.coupledPairs.slice(0, 8)) {
        lines.push(`| ${p.files[0]} | ${p.files[1]} | ${p.coChangeCount} | ${p.type} |`);
      }
      lines.push("");
    }

    // --- 5. Information Flow ---
    if (flow.flows && flow.flows.length > 0) {
      lines.push(isZh ? "### 信息流" : "### Information Flow");
      lines.push(isZh
        ? `检测到 ${flow.totalFlows} 条信息流，${flow.reachesLLM ? "有流经过 LLM 调用点" : "未检测到 LLM 调用点"}。`
        : `Detected ${flow.totalFlows} flows, ${flow.reachesLLM ? "some reach LLM call sites" : "none reach LLM call sites"}.`
      );
      lines.push("");
      for (const f of flow.flows.slice(0, 3)) {
        lines.push(isZh
          ? `**流**: ${f.name} (覆盖=${f.coverage}, 置信度=${f.confidence})`
          : `**Flow**: ${f.name} (coverage=${f.coverage}, confidence=${f.confidence})`
        );
        const steps = f.steps.map((s) => `${s.step}. ${s.role}${s.isLLMCall ? " [LLM]" : ""}`).join(" → ");
        lines.push(`  ${steps}`);
        lines.push("");
      }
    }

    // --- 6. Dependency Smells ---
    if (smells.smells && smells.smells.length > 0) {
      lines.push(isZh ? "### 架构坏味" : "### Architecture Smells");
      lines.push(isZh
        ? `共 ${smells.totalSmells} 个坏味（${smells.highSeverity} 个高严重度）。类型分布: ${JSON.stringify(smells.byType)}。`
        : `${smells.totalSmells} smells (${smells.highSeverity} high severity). By type: ${JSON.stringify(smells.byType)}.`
      );
      lines.push("");
      lines.push(isZh ? "| 严重度 | 类型 | 描述 |" : "| Severity | Type | Description |");
      lines.push("|----------|------|-------------|");
      for (const s of smells.smells.slice(0, 8)) {
        const desc = s.rule || s.rule || "";
        const from = s.from || s.module || "";
        const to = s.to ? ` → ${s.to}` : "";
        lines.push(`| ${s.severity} | ${s.type} | ${from}${to}: ${desc} |`);
      }
      lines.push("");
    }

    // --- 7. Capability Ontology ---
    if (caps.capabilities && caps.capabilities.length > 0) {
      lines.push(isZh ? "### 能力本体（Capability Ontology）" : "### Capability Ontology");
      lines.push(isZh
        ? `覆盖 ${caps.coveredCapabilities}/${caps.totalCapabilities} 个能力域。`
        : `Covers ${caps.coveredCapabilities}/${caps.totalCapabilities} capability domains.`
      );
      if (caps.strongCapabilities && caps.strongCapabilities.length > 0) {
        lines.push(isZh
          ? `- **强项能力**: ${caps.strongCapabilities.join(", ")}`
          : `- **Strong**: ${caps.strongCapabilities.join(", ")}`
        );
      }
      if (caps.weakCapabilities && caps.weakCapabilities.length > 0) {
        lines.push(isZh
          ? `- **弱项能力**: ${caps.weakCapabilities.join(", ")}`
          : `- **Weak**: ${caps.weakCapabilities.join(", ")}`
        );
      }
      if (caps.missingCapabilities && caps.missingCapabilities.length > 0) {
        lines.push(isZh
          ? `- **缺失能力**: ${caps.missingCapabilities.join(", ")}`
          : `- **Missing**: ${caps.missingCapabilities.join(", ")}`
        );
      }
      lines.push("");
      lines.push(isZh ? "| 能力 | 成熟度 | 覆盖 | 模块数 | 符号数 |" : "| Capability | Maturity | Coverage | Modules | Symbols |");
      lines.push("|-----------|----------|----------|---------|---------|");
      for (const c of caps.capabilities.slice(0, 10)) {
        lines.push(`| ${c.capability} | ${c.maturity} | ${c.coverage} | ${c.moduleCount} | ${c.symbolCount} |`);
      }
      lines.push("");
    }

    // --- 8. Evidence Metadata (analyzer self-disclosure) ---
    // Each inference analyzer ships _meta with assumptions, limitations,
    // possible false positives, and checked locations. Surfacing these in
    // the brief lets the LLM (and reader) calibrate trust per-analyzer
    // rather than treating all conclusions as equally reliable.
    const metaSources = [
      { key: "archPattern", label: isZh ? "架构模式分析器" : "ArchitecturePatternAnalyzer" },
      { key: "responsibility", label: isZh ? "职责分析器" : "ResponsibilityAnalyzer" },
      { key: "informationFlow", label: isZh ? "信息流分析器" : "InformationFlowAnalyzer" },
      { key: "capabilityOntology", label: isZh ? "能力本体分析器" : "CapabilityOntologyAnalyzer" },
    ];
    const anyMeta = metaSources.some((s) => this._get(s.key)?._meta);
    if (anyMeta) {
      lines.push(isZh ? "### 证据质量元信息（分析器自评）" : "### Evidence Quality Metadata (Analyzer Self-Disclosure)");
      lines.push(isZh
        ? "> 每个推理分析器附带 _meta：source（证据来源）/ strength（强度）/ assumptions（假设）/ limitations（限制）/ possibleFalsePositives（可能误报）/ checkedLocations（查了哪里）。"
        : "> Each inference analyzer ships _meta: source / strength / assumptions / limitations / possibleFalsePositives / checkedLocations."
      );
      lines.push(isZh
        ? "> LLM 引用 analyzer 结论时应参考其 strength：strong > moderate > weak。weak 的 analyzer 结论需要 LLM 通过源码核查后再相信。"
        : "> When citing analyzer claims, LLM should reference strength: strong > moderate > weak. Weak-analyzer claims require LLM source-code verification before trusting."
      );
      lines.push("");
      for (const s of metaSources) {
        const meta = this._get(s.key)?._meta;
        if (!meta) continue;
        lines.push(`**${s.label}** — source: \`${meta.source}\`, strength: \`${meta.strength}\`, coverage: ${meta.coverage || "n/a"}`);
        if (meta.assumptions && meta.assumptions.length > 0) {
          lines.push(isZh ? `- 假设:` : `- Assumptions:`);
          for (const a of meta.assumptions) lines.push(`  - ${a}`);
        }
        if (meta.limitations && meta.limitations.length > 0) {
          lines.push(isZh ? `- 限制:` : `- Limitations:`);
          for (const l of meta.limitations) lines.push(`  - ${l}`);
        }
        if (meta.possibleFalsePositives && meta.possibleFalsePositives.length > 0) {
          lines.push(isZh ? `- 可能误报:` : `- Possible false positives:`);
          for (const fp of meta.possibleFalsePositives) lines.push(`  - ${fp}`);
        }
        lines.push("");
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
    const findings = this._findings();
    const fCount = (findings.findings || []).length;
    const vSum = findings.verificationSummary || {};
    const fDowngraded = vSum.downgraded || 0;
    const fRejected = vSum.rejected || 0;
    if (this.lang === "zh") {
      return [
        "---",
        "",
        "## LLM 分析指令",
        "",
        `你是一位经验丰富的软件架构师。基于上述证据，为 **${repoName}** 撰写一份工程研究报告。`,
        `请将报告保存为工作目录下的 \`report.md\`。`,
        "",
        "### v2 Pipeline: 4 阶段执行（plan0726.md Part 2）",
        "",
        "本简报采用 v2 pipeline，已生成规范化 Findings（见上方 ★ Findings 章节）。",
        `共 ${fCount} 个 Finding；验证后: ${vSum.verified || 0} verified / ${fDowngraded} downgraded / ${fRejected} rejected。`,
        "",
        "请按以下 4 阶段执行（不要跳过）：",
        "",
        "**Phase 1 — Planning（低 reasoning_effort）**: 确认 Research Questions Q1-Q8 中哪些对本仓库最有价值。不必分析，只排序。",
        "",
        "**Phase 2 — Finding Validation（中 reasoning_effort）**: 对 ★ Findings 章节中的每个 Finding 执行 Merge/Split/Reject/Verify：",
        "- 若多个 Finding 描述同一现象 → Merge",
        "- 若一个 Finding 混淆多个现象 → Split",
        "- 若 verified=rejected 或反证强于支持证据 → Reject",
        "- 若反证存在但仍弱于支持证据 → 保留并降级 confidence",
        "- 检测 Findings 之间的 Conflict（脚本层 ConsistencyAnalyzer 可能漏检）",
        "",
        "**Phase 3 — Architecture Reasoning（高 reasoning_effort, thinking=enabled）**: 基于验证后的 Findings，回答 Why/Impact/Tradeoff：",
        "- Why: 为什么这样设计？（不是「是什么」）",
        "- Impact: 这个设计选择的影响是什么？（性能/可维护性/可扩展性）",
        "- Tradeoff: 牺牲了什么？换取了什么？",
        "",
        "**Phase 4 — Executive Summary（低 reasoning_effort）**: 生成 Markdown 报告。三段式 Executive Summary：Identity / Key Discovery / Recommendation。",
        "",
        "### Constraints（Do NOT）",
        "",
        "- **Do NOT** recommend technologies not present in the repository.",
        "- **Do NOT** invent architecture not supported by evidence.",
        "- **Do NOT** speculate beyond what Findings + Evidence Store show.",
        "- **Do NOT** ignore counter evidence — if a Finding has counter[], address it explicitly.",
        "- **Do NOT** cite verified=rejected Findings as conclusions.",
        "- **Do NOT** write Architecture Score / Radar / Heatmap / SWOT / Best Practice / Future Work sections (低价值，plan0726.md Part 7).",
        "- **Do NOT** pad the report with low-value Traces — 5 sharp Traces beat 8 mediocre ones.",
        "",
        "### Finding 引用规范",
        "",
        "在 Trace 中引用 Finding 时使用格式：`[F-001 @ Q1, confidence=0.85, verified]`。",
        "读者应能从 Trace 反向定位到 Findings 章节的对应条目。",
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
        "**每个 Trace 必须回答一个其答案会改变工程师对系统理解的架构问题。**",
        "如果一个 Trace 删掉后读者对系统的理解不会改变，它就不该存在。",
        "",
        "格式如下：",
        "",
        "```markdown",
        "### [Trace 标题]",
        "",
        "**Importance**: Critical / High / Medium / Low",
        "   - Critical: 不了解这一点会根本性误判系统",
        "   - High: 显著影响对系统某一维度的理解",
        "   - Medium: 提供有价值的上下文",
        "   - Low: 锦上添花（通常应删除）",
        "",
        "**问题**: 这个 Trace 回答什么架构问题？（一句话）",
        "",
        "**证据**:",
        "- 证据1（文件路径 + 简报章节）",
        "- 证据2（指标 + 解读）",
        "- 证据3（交叉验证来源）",
        "",
        "**分析**: 基于证据的推理过程。",
        "",
        "**反证**: 是否有矛盾证据？如无，说明「未发现反证」。",
        "",
        "**Fact**: 不可争辩的事实（如「存在 20 个依赖循环」）。",
        "**Interpretation**: 基于事实的解读（如「17 个是框架产物，只有 1 个值得审查」）。",
        "   读者通过这一区分知道：哪些是证据，哪些是你的判断。",
        "",
        "**Why it matters**: 如果不了解这一点，会怎样误解系统？（一句话）",
        "   这是 Palantir-style architecture review 的核心栏目，",
        "   把 Trace 从「结论」升级为「认知改变」。",
        "",
        "**置信度**: High / Medium / Low / Speculative",
        "   - High: ≥3 个独立证据源",
        "   - Medium: 2 个证据源",
        "   - Low: 1 个证据源",
        "   - Speculative: 无直接证据（仅推理）",
        "```",
        "",
        "### 报告结构",
        "",
        "1. **Executive Summary** — 三段式，不超过 300 字，不介绍所有东西，只介绍真正改变理解的东西：",
        "   - **Identity**: 这是什么项目？（一句话定位，不罗列技术栈）",
        "   - **Key Discovery**: 最改变理解的发现是什么？（一句话，对应最高 Importance 的 Trace）",
        "   - **Recommendation**: 读者应该记住什么？（一句话，可执行的洞察）",
        "   不写「项目使用了 X、Y、Z」这种描述性内容。",
        "",
        "2. **Research Traces** — 5 个真正重要的发现（不是 5-8 个面面俱到）。",
        "   每个 Trace 必须满足：",
        "   - 回答一个其答案会改变工程师对系统理解的架构问题",
        "   - 标注 Importance（Critical/High/Medium/Low）",
        "   - 区分 Fact 与 Interpretation",
        "   - 说明 Why it matters",
        "   不满足这两条的发现应降级为 Architecture Smell / Negative Finding 或删除。",
        "",
        "   ✅ 好的 Trace 例子（高价值，应保留）：",
        "   - 「依赖图被 demo 文件污染，导致 PageRank 失真」（颠覆对架构核心的判断）",
        "   - 「Retrieval 假阳性：analyzer 把组件目录误分类」（质疑 analyzer 输出）",
        "   - 「Agent 通过 X 机制防止无限循环，但流式路径未防护」（揭示边界）",
        "",
        "   ❌ 差的 Trace 例子（低价值，不应成为 Trace）：",
        "   - 「测试覆盖率中等」（陈述事实，无认知改变）",
        "   - 「没有评估基础设施」（应归入 Negative Findings）",
        "   - 「使用了 Monorepo 结构」（描述，非发现）",
        "   - 「Analyzer 不适用于本项目」（如果只是这一句，应归入 Negative Findings）",
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
        "- 遵循简报 §0 的研究原则（含 Trace 价值密度与 Confidence 统一标准）。",
        "- 每个论断必须引用证据（文件路径、简报章节、指标）。",
        "- 置信度标签必须符合 §0 统一标准：High=≥3 源 / Medium=2 源 / Low=1 源 / Speculative=无直接证据。",
        "- Trace 数量上限 5 个，宁缺毋滥。低价值 Trace 应删除而非保留凑数。",
        "- **简报 §A 的矛盾必须优先处理**：每条 high-severity 矛盾应成为一个 Research Trace（或并入相关 Trace），",
        "  因为「系统自己发现自己的矛盾」是最值钱的研究线索。如果矛盾解决后证明是某 analyzer 的假阳性，",
        "  在 Fact / Interpretation 中明确指出哪个 analyzer 误判、为什么。如果矛盾无法解决，作为 Open Question。",
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
      "**Every Trace must answer one architectural question whose answer would change an engineer's",
      "understanding of the system.** If deleting a Trace would not change the reader's understanding,",
      "it should not exist.",
      "",
      "Use this format:",
      "",
      "```markdown",
      "### [Trace Title]",
      "",
      "**Importance**: Critical / High / Medium / Low",
      "   - Critical: Without this, the system is fundamentally misjudged",
      "   - High: Materially shifts understanding of one dimension",
      "   - Medium: Provides valuable context",
      "   - Low: Nice-to-have (usually delete)",
      "",
      "**Question**: What architectural question does this Trace answer? (one sentence)",
      "",
      "**Evidence**:",
      "- Evidence 1 (file path + brief section)",
      "- Evidence 2 (metric + interpretation)",
      "- Evidence 3 (cross-validation source)",
      "",
      "**Analysis**: Reasoning based on evidence.",
      "",
      "**Counter Evidence**: Any contradictory evidence? If none, state \"No counter evidence found\".",
      "",
      "**Fact**: Undisputed fact (e.g., \"20 dependency cycles exist\").",
      "**Interpretation**: Interpretation built on facts (e.g., \"17 are framework artifacts, only 1 deserves review\").",
      "   This separation lets readers distinguish evidence from judgment.",
      "",
      "**Why it matters**: Without this insight, how would the system be misread? (one sentence)",
      "   This is the core column of Palantir-style architecture reviews,",
      "   elevating Trace from \"conclusion\" to \"understanding shift\".",
      "",
      "**Confidence**: High / Medium / Low / Speculative",
      "   - High: ≥3 independent evidence sources",
      "   - Medium: 2 evidence sources",
      "   - Low: 1 evidence source",
      "   - Speculative: No direct evidence (reasoning only)",
      "```",
      "",
      "### Report Structure",
      "",
      "1. **Executive Summary** — Three-part, under 300 words. Do NOT describe everything; only what shifts understanding:",
      "   - **Identity**: What is this project? (one sentence positioning, no tech-stack listing)",
      "   - **Key Discovery**: What is the most understanding-shifting finding? (one sentence, tied to highest-Importance Trace)",
      "   - **Recommendation**: What should the reader remember? (one actionable insight)",
      "   Skip \"the project uses X, Y, Z\" style descriptions.",
      "",
      "2. **Research Traces** — 5 truly important findings (NOT 5-8 for coverage).",
      "   Each Trace MUST:",
      "   - Answer an architectural question whose answer shifts an engineer's understanding",
      "   - Tag Importance (Critical/High/Medium/Low)",
      "   - Separate Fact from Interpretation",
      "   - Explain Why it matters",
      "   Findings that fail this bar should be demoted to Architecture Smell / Negative Finding or deleted.",
      "",
      "   ✅ Good Trace examples (high value, keep):",
      "   - \"Dependency graph is polluted by demo files, breaking PageRank\" (overturns judgment of architectural core)",
      "   - \"Retrieval false positive: analyzer misclassified component dirs\" (challenges analyzer output)",
      "   - \"Agent prevents infinite loops via X, but streaming path is unguarded\" (reveals a boundary)",
      "",
      "   ❌ Bad Trace examples (low value, do NOT make a Trace):",
      "   - \"Test coverage is moderate\" (states a fact, no understanding shift)",
      "   - \"No evaluation infrastructure\" (belongs in Negative Findings)",
      "   - \"Uses a monorepo structure\" (description, not a finding)",
      "   - \"Analyzer does not fit this project\" (if that's all, belongs in Negative Findings)",
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
      "- Follow the research principles in brief §0 (including Trace density and Confidence unified standard).",
      "- Every claim must cite evidence (file path, brief section, metric).",
      "- Confidence labels MUST follow the §0 unified standard: High=≥3 sources / Medium=2 / Low=1 / Speculative=none.",
      "- Trace count capped at 5. Prefer fewer, sharper Traces over more mediocre ones.",
      "- **Brief §A contradictions MUST be prioritized**: every high-severity contradiction should become a Research Trace",
      "  (or be folded into a related Trace), because \"self-detected contradictions are the most research-valuable",
      "  findings\". If resolution reveals an analyzer false positive, name the misfiring analyzer and the reason in",
      "  Fact / Interpretation. If the contradiction cannot be resolved, list it as an Open Question.",
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
