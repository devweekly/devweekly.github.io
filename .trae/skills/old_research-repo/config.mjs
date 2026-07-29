import { join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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
//   ├── PROJECT_DISCOVERY_RULES   — (in utils.mjs, depends on parsers)
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
//     too noisy (one repo had 440 prompts, ~60% were CSS/UI template strings).
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
  // Factory function pattern: createEditTool, createWriteTool, etc.
  // Common in TypeScript/JavaScript agent frameworks where tools are created via factory functions
  { framework: "factory-function", regex: /(?:export\s+)?function\s+(create\w+Tool)\s*\(/g },
];

// Schema-first tool detection: files that declare tool arrays typed as ToolDef[] / Tool[]
// (common in MCP servers). We detect the type annotation first, then extract `name: '...'`
// values from the same file. This avoids false positives from generic `name:` properties.
const SCHEMA_FIRST_TOOL_TYPE_PATTERN =
  /\b(?:ToolDef|BaseToolDef|PublicToolShape|ToolRegistry)\b|\bTool\[\]/;

// Evaluation patterns
const EVAL_KEYWORDS = [
  // AI-eval-specific terms — "benchmark" and "dataset" are NOT here because
  // they're too generic (every performance benchmark matches them).
  "eval", "evaluation", "golden", "judge", "rubric",
  "pass_rate", "accuracy", "leaderboard",
  // "score" / "metric" are weak on their own — kept for ≥3-match threshold.
  "score", "metric",
];
// Eval directory names — "benchmark"/"benchmarks" intentionally excluded.
// Performance benchmark dirs (Rust cargo bench, JMH, Google Benchmark, etc.)
// are ubiquitous and have nothing to do with AI evaluation.
// Only count directories that explicitly say "eval" / "evaluation".
const EVAL_DIR_NAMES = new Set(["eval", "evals", "evaluation", "evaluations", "tests-eval"]);

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

// ---------------------------------------------------------------------------
// findNodeModules — locate nearest node_modules directory
// ---------------------------------------------------------------------------
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

export {
  IGNORED_DIRS,
  LANGUAGE_EXTENSIONS,
  SOURCE_EXTENSIONS,
  CODE_FILE_EXTENSIONS,
  PROMPT_FILE_EXTENSIONS,
  TOOL_FILE_EXTENSIONS,
  ARCHITECTURE_SIGNAL_DIRS,
  IMPORTANT_FILES,
  ENTRY_POINT_FILES,
  ENTRYPOINT_DIR_NAMES,
  PROMPT_FILE_PATTERNS,
  TEST_FILE_REGEXES,
  TEST_DISCOVERY_PATTERNS,
  TEST_FUNCTION_REGEX,
  IMPORT_REGEX,
  PROMPT_MARKERS,
  TOOL_PATTERNS,
  SCHEMA_FIRST_TOOL_TYPE_PATTERN,
  EVAL_KEYWORDS,
  EVAL_DIR_NAMES,
  CI_FILES,
  findNodeModules,
};
