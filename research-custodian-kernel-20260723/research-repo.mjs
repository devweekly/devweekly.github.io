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
 *   node research-repo.mjs all          <repoPath>  # Complete Evidence Store
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
async function extractImportsAST(filePath) {
  const tree = await parseFileAST(filePath);
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
async function extractPromptsAST(filePath, repoPath) {
  const tree = await parseFileAST(filePath);
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
async function extractToolsAST(filePath, repoPath) {
  const tree = await parseFileAST(filePath);
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
async function extractEntrypointsAST(filePath, repoPath) {
  const tree = await parseFileAST(filePath);
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
async function extractSymbolsAST(filePath, repoPath) {
  const tree = await parseFileAST(filePath);
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
 * discovery command — Repository metadata, file tree, manifest.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeDiscovery(repoPath) {
  // Detect manifest — sort manifest rules by priority, first match wins
  const manifestRules = PROJECT_DISCOVERY_RULES
    .filter((r) => r.category === "manifest")
    .sort((a, b) => b.priority - a.priority);

  let manifest = null;
  for (const m of manifestRules) {
    const fullPath = join(repoPath, m.file);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        manifest = { language: m.language, entry: m.file, ...m.parser(content) };
      } catch {
        manifest = { language: m.language, entry: m.file, name: "unknown", version: "unknown" };
      }
      break;
    }
  }

  // Scan for metadata and agent files via PROJECT_DISCOVERY_RULES
  const metadataFiles = [];
  const agentFiles = [];
  for (const r of PROJECT_DISCOVERY_RULES) {
    if (r.category !== "metadata" && r.category !== "agent") continue;
    if (existsSync(join(repoPath, r.file))) {
      if (r.category === "metadata") metadataFiles.push(r.file);
      else agentFiles.push(r.file);
    }
  }

  const entries = walkDir(repoPath, 2);
  const dirs = entries
    .filter((e) => e.type === "dir")
    .map((e) => relative(repoPath, e.path));
  const files = entries.filter((e) => e.type === "file");

  const topLevelDirs = dirs
    .filter((d) => !d.includes(sep) && d.length > 0)
    .sort();

  const importantDirs = dirs
    .filter((d) => {
      const filesInDir = files.filter((f) => {
        const relFile = relative(repoPath, f.path);
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
  const testFiles = findTestFiles(files);
  const hasReadme = metadataFiles.some((f) => f.toLowerCase().startsWith("readme"));
  const hasCI = CI_FILES.some((ci) => existsSync(join(repoPath, ci.path)));

  return {
    repoName: manifest ? manifest.name : basename(repoPath),
    repoPath,
    analyzedAt: new Date().toISOString(),
    manifest,
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

// ---------------------------------------------------------------------------
// Command: architecture
// ---------------------------------------------------------------------------

/**
 * architecture command — Dependency graph + centrality + cycles.
 * Uses AST-based import extraction when Tree-sitter is available, regex fallback otherwise.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeArchitecture(repoPath) {
  const entries = walkDir(repoPath, 8);
  const sourceFiles = entries.filter(
    (e) => e.type === "file" && SOURCE_EXTENSIONS.has(e.ext)
  );

  const nodes = [];
  const edges = [];
  const nodeIdSet = new Set();

  // Parse imports in parallel; AST used when available, regex fallback per file
  const nodeResults = await Promise.all(
    sourceFiles.map(async (file) => {
      const relPath = relative(repoPath, file.path);
      const moduleId = pathToModuleId(relPath);
      const astImports = await extractImportsAST(file.path);
      const imports = astImports !== null ? astImports : parseImports(file.path);
      return { id: moduleId, path: relPath, imports };
    })
  );
  for (const node of nodeResults) {
    nodes.push(node);
    nodeIdSet.add(node.id);
  }

  // Build edges; only keep edges whose target resolves to an existing node id.
  // Try a few resolution strategies for resilience.
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

  return {
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

// ---------------------------------------------------------------------------
// Command: entrypoints
// ---------------------------------------------------------------------------

/**
 * entrypoints command — Entry point detection.
 * Uses AST-based detection when Tree-sitter is available, regex fallback otherwise.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeEntrypoints(repoPath) {
  const entries = walkDir(repoPath, 6);
  const entrypoints = [];
  const seen = new Set();

  const addEntrypoint = (relPath, type, reason) => {
    if (seen.has(relPath)) return;
    seen.add(relPath);
    entrypoints.push({ path: relPath, type, reason });
  };

  // 1. Filename-based detection (with depth/library filtering)
  for (const e of entries) {
    if (e.type !== "file") continue;
    const name = e.name;
    const relPath = relative(repoPath, e.path);
    const depth = relPath.split(sep).length;
    const isDeep = depth > 3;
    const isBundled = /bundled_skills|vendor|node_modules|site-packages/.test(relPath);
    const isLibOrTest = /(?:^|[\\/])(?:lib|libs|utils|helpers|internal|common|tests?|__tests__|spec)[\\/]/.test(relPath)
      || /^tests?[\\/]/.test(relPath);
    for (const ep of ENTRY_POINT_FILES) {
      if (ep.names.includes(name)) {
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
    if (e.type !== "file") continue;
    const parts = relative(repoPath, e.path).split(sep);
    if (parts.length < 2) continue;
    const topDir = parts[0];
    if (topDir === "bin") {
      addEntrypoint(relative(repoPath, e.path), "cli", "file under bin/");
    } else if (topDir === "examples" || topDir === "example") {
      addEntrypoint(relative(repoPath, e.path), "example", "file under examples/");
    } else if (topDir === "scripts" && ENTRYPOINT_DIR_NAMES.has("scripts")) {
      addEntrypoint(relative(repoPath, e.path), "cli", "file under scripts/");
    }
  }

  // 3. AST-based detection (preferred) + regex fallback per file
  const sourceFiles = entries.filter(
    (e) => e.type === "file" && SOURCE_EXTENSIONS.has(e.ext)
  );
  const astResults = await Promise.all(
    sourceFiles.map(async (file) => {
      const relPath = relative(repoPath, file.path);
      const astSignals = await extractEntrypointsAST(file.path, repoPath);
      if (astSignals !== null) return { relPath, signals: astSignals, useRegex: false };
      // Regex fallback
      const content = readFileSafe(file.path);
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
    // Filter out deep paths (tool scripts, bundled skills, etc.)
    // depth > 3 catches skills/X/scripts/Y.py (depth 4) but not custodian/cli/main.py (depth 3)
    const depth = relPath.split(sep).length;
    const isDeep = depth > 3;
    const isBundled = /bundled_skills|vendor|node_modules|site-packages/.test(relPath);
    // Library/test/utility directories are not CLI entrypoints even with main() or __main__
    const isLibOrTest = /(?:^|[\\/])(?:lib|libs|utils|helpers|internal|common|tests?|__tests__|spec)[\\/]/.test(relPath)
      || /^tests?[\\/]/.test(relPath);
    for (const sig of signals) {
      if (isDeep || isBundled) {
        // Categorize as "tool" instead of "cli" for deep/bundled scripts
        addEntrypoint(sig.path, "tool", sig.reason + " (deep/bundled)");
      } else if (isLibOrTest && sig.type === "cli") {
        // main() or __main__ in lib/tests/ is likely a demo/test helper, not a CLI entrypoint
        addEntrypoint(sig.path, "tool", sig.reason + " (library/test dir)");
      } else {
        addEntrypoint(sig.path, sig.type, sig.reason);
      }
    }
  }

  // 4. Manifest-declared entry points
  const pkgJsonPath = join(repoPath, "package.json");
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
  const pyprojectPath = join(repoPath, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    const content = readFileSync(pyprojectPath, "utf-8");
    // Only parse [project.scripts] and [tool.poetry.scripts] sections
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
        // Match: key = "module.path:function" or key = "module.path"
        const m = line.match(/^([A-Za-z_][\w-]*)\s*=\s*"([^"]+)"/);
        if (m) {
          const modulePath = m[2].includes(":") ? m[2].split(":")[0] : m[2];
          // Convert Python module path to file path (custodian.cli.main → custodian/cli/main.py)
          const scriptPath = modulePath.replace(/\./g, "/") + ".py";
          addEntrypoint(scriptPath, "cli", `pyproject.toml script: ${m[1]}`);
        }
      }
    }
  }

  return { entrypoints };
}

// ---------------------------------------------------------------------------
// Command: prompts
// ---------------------------------------------------------------------------

/**
 * prompts command — Prompt discovery.
 * Uses AST-based discovery when Tree-sitter is available, regex fallback otherwise.
 * Scans .py/.ts/.js/.md for prompt markers and template variables.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzePrompts(repoPath) {
  const entries = walkDir(repoPath, 8);
  const files = entries.filter(
    (e) => e.type === "file" && PROMPT_FILE_EXTENSIONS.has(e.ext)
  );

  // Partition files: code files (AST-eligible) vs markdown (always regex)
  const codeExts = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs"]);
  const codeFiles = files.filter((f) => codeExts.has(f.ext));
  const mdFiles = files.filter((f) => !codeExts.has(f.ext));

  // AST-based extraction for code files (with regex fallback per file)
  const codeResults = await Promise.all(
    codeFiles.map(async (f) => {
      const astPrompts = await extractPromptsAST(f.path, repoPath);
      if (astPrompts !== null) return astPrompts;
      // Regex fallback
      const content = readFileSafe(f.path);
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
              file: relative(repoPath, f.path),
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
    const content = readFileSafe(f.path);
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const marker of PROMPT_MARKERS) {
        marker.regex.lastIndex = 0;
        const match = marker.regex.exec(line);
        if (match) {
          mdPrompts.push({
            file: relative(repoPath, f.path),
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
  return { totalPrompts: prompts.length, prompts };
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
 * tools command — Tool/function discovery.
 * Uses AST-based discovery when Tree-sitter is available, regex fallback otherwise.
 * Detects tool registrations across multiple frameworks.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeTools(repoPath) {
  const entries = walkDir(repoPath, 8);
  const files = entries.filter(
    (e) => e.type === "file" && TOOL_FILE_EXTENSIONS.has(e.ext)
  );

  const tools = [];
  const seen = new Set();

  // Try AST first per file; regex fallback when AST unavailable
  const results = await Promise.all(
    files.map(async (f) => {
      const astTools = await extractToolsAST(f.path, repoPath);
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
    const content = readFileSafe(f.path);
    if (!content) continue;
    const relPath = relative(repoPath, f.path);

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

  return { totalTools: tools.length, tools };
}

// ---------------------------------------------------------------------------
// Command: tests
// ---------------------------------------------------------------------------

/**
 * tests command — Test discovery + categorization.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeTests(repoPath) {
  const entries = walkDir(repoPath, 8);
  const testFiles = entries.filter(
    (e) => e.type === "file" && isTestFile(basename(e.path))
  );

  const byCategory = { unit: 0, integration: 0, e2e: 0 };
  const byModule = {};
  let totalFunctions = 0;

  const fileDetails = testFiles.map((f) => {
    const relPath = relative(repoPath, f.path);
    const category = categorizeTestCategory(f.path);
    const module = categorizeTestModule(f.path, repoPath);
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

  return {
    totalTestFiles: testFiles.length,
    totalTestFunctions: totalFunctions,
    byCategory,
    byModule,
    patterns,
    fileDetails,
  };
}

// ---------------------------------------------------------------------------
// Command: evaluations
// ---------------------------------------------------------------------------

/**
 * evaluations command — Evaluation/benchmark discovery.
 * @param {string} repoPath
 * @returns {object}
 */
function analyzeEvaluations(repoPath) {
  const entries = walkDir(repoPath, 8);
  const evalFiles = [];
  const evalDirs = new Set();
  const patterns = new Set();
  const metrics = new Set();

  // 1. Directory-based detection
  for (const e of entries) {
    if (e.type !== "dir") continue;
    const name = basename(e.path).toLowerCase();
    if (EVAL_DIR_NAMES.has(name)) {
      evalDirs.add(relative(repoPath, e.path));
    }
  }

  // 2. File-based detection (by name and content)
  for (const e of entries) {
    if (e.type !== "file") continue;
    const name = basename(e.path).toLowerCase();
    const relPath = relative(repoPath, e.path);
    const isEvalByName = EVAL_KEYWORDS.some((kw) => name.includes(kw));
    // Check if file is inside an eval directory (only for source files, not docs/configs)
    const isInEvalDir = SOURCE_EXTENSIONS.has(e.ext) && [...evalDirs].some((d) => relPath.startsWith(d + sep) || relPath.startsWith(d + "/"));
    let isEvalByContent = false;
    // Only scan content for source files; docs/configs use filename-only detection
    // to avoid false positives (README mentioning "benchmark" is not an eval file)
    if (SOURCE_EXTENSIONS.has(e.ext)) {
      const content = readFileSafe(e.path);
      if (content) {
        let matchCount = 0;
        for (const kw of EVAL_KEYWORDS) {
          const re = new RegExp(`\\b${kw.replace(/_/g, "[_]")}\\b`, "i");
          if (re.test(content)) {
            matchCount++;
            patterns.add(kw);
          }
        }
        // Require at least 2 keyword matches to reduce false positives
        isEvalByContent = matchCount >= 2;
        // Detect metric names
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

  return {
    hasEvaluation: evalFiles.length > 0 || evalDirs.size > 0,
    evalFiles: [...new Set(evalFiles)],
    evalDirs: [...evalDirs],
    patterns: [...patterns],
    metrics: [...metrics],
  };
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
function analyzeGit(repoPath) {
  if (!isGitRepo(repoPath)) {
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

  // Total commits
  const totalCommitsRaw = git(repoPath, "rev-list", "--count", "HEAD").trim();
  const totalCommits = parseInt(totalCommitsRaw, 10) || 0;

  // First / last commit
  const lastCommitRaw = git(
    repoPath, "log", "-1", "--format=%cI|%H|%s"
  ).trim();
  const firstCommitRaw = git(
    repoPath, "log", "--max-parents=0", "-1", "--format=%cI|%H|%s"
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
  const logLines = git(
    repoPath, "log", "--name-only", "--format=", "HEAD"
  ).split(/\r?\n/).filter(Boolean);
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
    repoPath, "log", "--name-only", "--format=@@@%H|%cI|%s", "HEAD"
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

  return {
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
 * symbols command — Semantic Index Analyzer.
 * Builds a symbol-level index (functions, classes, imports, calls, strings)
 * via AST traversal. Falls back to empty arrays when Tree-sitter unavailable.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeSymbols(repoPath) {
  const entries = walkDir(repoPath, 8);
  const sourceFiles = entries.filter(
    (e) => e.type === "file" && SOURCE_EXTENSIONS.has(e.ext)
  );

  const results = await Promise.all(
    sourceFiles.map(async (file) => {
      const symbols = await extractSymbolsAST(file.path, repoPath);
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

  return {
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

// ---------------------------------------------------------------------------
// Command: all
// ---------------------------------------------------------------------------

/**
 * all command — Complete Evidence Store.
 * @param {string} repoPath
 * @returns {object}
 */
async function analyzeAll(repoPath) {
  return {
    discovery: analyzeDiscovery(repoPath),
    architecture: await analyzeArchitecture(repoPath),
    entrypoints: await analyzeEntrypoints(repoPath),
    prompts: await analyzePrompts(repoPath),
    tools: await analyzeTools(repoPath),
    tests: analyzeTests(repoPath),
    evaluations: analyzeEvaluations(repoPath),
    git: analyzeGit(repoPath),
    ci: analyzeCI(repoPath),
    ranking: await analyzeRanking(repoPath),
    symbols: await analyzeSymbols(repoPath),
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

const COMMANDS = {
  discovery: analyzeDiscovery,
  architecture: analyzeArchitecture,
  entrypoints: analyzeEntrypoints,
  prompts: analyzePrompts,
  tools: analyzeTools,
  tests: analyzeTests,
  evaluations: analyzeEvaluations,
  git: analyzeGit,
  ci: analyzeCI,
  ranking: analyzeRanking,
  symbols: analyzeSymbols,
  all: analyzeAll,
};

async function main() {
  const command = process.argv[2];
  const repoPath = process.argv[3];

  if (!command || !repoPath) {
    console.error(
      "Usage: node research-repo.mjs <discovery|architecture|entrypoints|prompts|tools|tests|evaluations|git|ci|ranking|symbols|all> <repoPath>"
    );
    process.exit(1);
  }

  if (!COMMANDS[command]) {
    console.error(
      `Unknown command: ${command}. Valid: ${Object.keys(COMMANDS).join(", ")}`
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
    const result = await COMMANDS[command](absPath);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    console.error(`Error running '${command}': ${err && err.message ? err.message : String(err)}`);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
