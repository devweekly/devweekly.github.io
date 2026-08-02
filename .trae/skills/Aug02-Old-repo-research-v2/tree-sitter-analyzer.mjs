// ===========================================================================
// tree-sitter-analyzer.mjs — Mechanical code fact extractor (p6 copy.md §3-§4)
//
// p6 copy.md: "Tree-sitter 负责让系统'知道代码是什么'"
// This module extracts STRUCTURAL FACTS only — no interpretation.
// LLM may interpret these facts later but cannot alter them.
//
// Output (p6 copy.md §3 "facts/"):
//   facts/symbols.json  — classes, functions, methods (with location)
//   facts/calls.json    — function/method call edges (caller → callee)
//   facts/imports.json  — import statements (file → module)
//   facts/modules.json  — module-level structure (file → class/function list)
//   facts/tests.json    — test file → tested entity mapping
//
// Supported languages (p6 copy.md §4 priority): Java, Python, TypeScript, Go, Rust
//
// Borrows init/parse pattern from old_research-repo/utils.mjs:90-188 but is a
// fresh implementation focused on fact extraction for repo-research-v2.
// ===========================================================================

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// 1. Language config
// ---------------------------------------------------------------------------

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

const SUPPORTED_EXTS = Object.keys(TS_LANG_MAP);

const FUNCTION_NODE_TYPES = new Set([
  "function_definition", "function_declaration", "function_item",
  "method_declaration", "method_definition",
]);

const CLASS_NODE_TYPES = new Set([
  "class_definition", "class_declaration",
]);

// Node types that represent a function/method call
const CALL_NODE_TYPES = new Set([
  "call", "call_expression",
]);

// ---------------------------------------------------------------------------
// 2. Tree-sitter init (borrowed pattern from old_research-repo/utils.mjs)
// ---------------------------------------------------------------------------

let Parser = null;
let LanguageExport = null;
let wasmDir = null;
const parserCache = new Map();

function findNodeModules(startDir = process.cwd()) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function initTreeSitter() {
  if (Parser) return Parser;
  const nodeModulesDir = findNodeModules();
  if (!nodeModulesDir) return null;

  const wtsDir = join(nodeModulesDir, "web-tree-sitter");
  // web-tree-sitter >=0.25 renamed runtime to web-tree-sitter.wasm
  const wasmRuntimePath = existsSync(join(wtsDir, "web-tree-sitter.wasm"))
    ? join(wtsDir, "web-tree-sitter.wasm")
    : join(wtsDir, "tree-sitter.wasm");
  if (!existsSync(wasmRuntimePath)) return null;

  const wasmsPkgPath = join(nodeModulesDir, "tree-sitter-wasms", "out");
  if (!existsSync(wasmsPkgPath)) return null;

  try {
    const mod = await import("web-tree-sitter");
    const parserCtor = mod.default || mod.Parser || mod;
    LanguageExport = mod.Language || parserCtor.Language || null;

    await parserCtor.init({
      locateFile: (filename) =>
        pathToFileURL(join(nodeModulesDir, "web-tree-sitter", filename)).href,
    });
    Parser = parserCtor;
    wasmDir = wasmsPkgPath;
    return Parser;
  } catch (e) {
    console.warn("Tree-sitter init failed:", e.message);
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
    const Language = LanguageExport || Parser.Language;
    if (!Language) return null;
    const language = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    parserCache.set(ext, parser);
    return parser;
  } catch {
    return null;
  }
}

async function parseFile(filePath) {
  const parser = await getParserForFile(filePath);
  if (!parser) return null;
  try {
    const content = await readFile(filePath, "utf-8");
    const tree = parser.parse(content);
    // Touch rootNode to trigger WASM errors early
    const _root = tree.rootNode;
    return { tree, content };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. AST traversal helpers
// ---------------------------------------------------------------------------

function walkAST(node, visitor, parentStack = []) {
  visitor(node, parentStack);
  const newStack = parentStack.concat(node);
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

function findEnclosingFuncName(parentStack) {
  for (let i = parentStack.length - 1; i >= 0; i--) {
    if (FUNCTION_NODE_TYPES.has(parentStack[i].type)) {
      const id = findChild(parentStack[i], "identifier") ||
        findChild(parentStack[i], "name");
      if (id) return id.text;
    }
    // Java method_declaration: name is in "identifier" child
    if (parentStack[i].type === "method_declaration" || parentStack[i].type === "constructor_declaration") {
      const id = findChild(parentStack[i], "identifier");
      if (id) return id.text;
    }
  }
  return null;
}

function findEnclosingClassName(parentStack) {
  for (let i = parentStack.length - 1; i >= 0; i--) {
    if (CLASS_NODE_TYPES.has(parentStack[i].type)) {
      const name = findChild(parentStack[i], "identifier") || findChild(parentStack[i], "name");
      if (name) return name.text;
    }
  }
  return null;
}

function stripQuotes(s) {
  return s.replace(/^["'`]|["'`]$/g, "");
}

// ---------------------------------------------------------------------------
// 4. Fact extractors: symbols, calls, imports
// ---------------------------------------------------------------------------

/**
 * Extract symbol facts: classes, functions, methods with location.
 * Output: [{ name, type, file, line, class (if method), params[] }]
 */
function extractSymbols(tree, filePath) {
  const symbols = [];
  const ext = extname(filePath);

  walkAST(tree.rootNode, (node, parentStack) => {
    // Class definitions
    if (CLASS_NODE_TYPES.has(node.type)) {
      const name = findChild(node, "identifier") || findChild(node, "name");
      if (name) {
        symbols.push({
          name: name.text,
          type: "class",
          file: filePath,
          line: name.startPosition.row + 1,
        });
      }
    }
    // Function/method definitions
    if (FUNCTION_NODE_TYPES.has(node.type) || node.type === "method_declaration" || node.type === "constructor_declaration") {
      const nameNode = findChild(node, "identifier") || findChild(node, "name");
      const name = nameNode?.text;
      if (!name) return;

      const enclosingClass = findEnclosingClassName(parentStack);
      const isMethod = enclosingClass !== null || node.type === "method_declaration" || node.type === "method_definition" || node.type === "constructor_declaration";

      symbols.push({
        name,
        type: isMethod ? "method" : "function",
        file: filePath,
        line: nameNode.startPosition.row + 1,
        class: enclosingClass,
      });
    }
  });

  return symbols;
}

/**
 * Extract call facts: caller → callee edges.
 * Output: [{ caller (function name), callee (function name), file, line }]
 */
function extractCalls(tree, filePath) {
  const calls = [];
  const ext = extname(filePath);

  walkAST(tree.rootNode, (node, parentStack) => {
    if (CALL_NODE_TYPES.has(node.type)) {
      // Extract callee name — different grammars store it differently
      let callee = null;
      const funcNode = findChild(node, "identifier") || findChild(node, "function");
      if (funcNode) {
        callee = funcNode.text;
      } else {
        // JS/TS: call_expression has function as first child
        const firstChild = node.children[0];
        if (firstChild && (firstChild.type === "identifier" || firstChild.type === "member_expression")) {
          callee = firstChild.text;
        }
      }
      if (!callee) return;

      // Skip language builtins and operators
      if (["print", "len", "range", "console", "require", "typeof", "if", "for", "while"].includes(callee)) return;

      const caller = findEnclosingFuncName(parentStack) || "(module-level)";
      calls.push({
        caller,
        callee: callee.length > 200 ? callee.slice(0, 200) + "…" : callee,
        file: filePath,
        line: node.startPosition.row + 1,
      });
    }
  });

  return calls;
}

/**
 * Extract import facts: file → imported module/package.
 * Output: [{ file, module, items[] }]
 */
function extractImports(tree, filePath) {
  const imports = [];
  const ext = extname(filePath);
  const isJs = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext);

  walkAST(tree.rootNode, (node) => {
    if (ext === ".py") {
      if (node.type === "import_from_statement") {
        const mod = findChild(node, "dotted_name");
        if (mod) imports.push({ file: filePath, module: mod.text });
      } else if (node.type === "import_statement") {
        for (const child of node.children) {
          if (child.type === "dotted_name") imports.push({ file: filePath, module: child.text });
        }
      }
    } else if (ext === ".java") {
      if (node.type === "import_declaration") {
        const text = node.text.replace(/^import\s+(static\s+)?/, "").replace(/;$/, "");
        if (text) imports.push({ file: filePath, module: text });
      }
    } else if (isJs) {
      if (node.type === "import_statement") {
        const str = findChild(node, "string");
        if (str) imports.push({ file: filePath, module: stripQuotes(str.text) });
      } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
        for (const decl of findChildren(node, "variable_declarator")) {
          const call = findChild(decl, "call_expression");
          if (call) {
            const fn = findChild(call, "identifier");
            if (fn && fn.text === "require") {
              const args = findChild(call, "arguments");
              if (args) {
                const str = findChild(args, "string");
                if (str) imports.push({ file: filePath, module: stripQuotes(str.text) });
              }
            }
          }
        }
      }
    } else if (ext === ".rs") {
      if (node.type === "use_declaration") {
        const text = node.text.replace(/^use\s+/, "").replace(/;$/, "");
        if (text) imports.push({ file: filePath, module: text });
      }
    } else if (ext === ".go") {
      if (node.type === "import_declaration") {
        for (const child of node.children) {
          if (child.type === "interpreted_string_literal") {
            imports.push({ file: filePath, module: stripQuotes(child.text) });
          } else if (child.type === "import_spec_list") {
            for (const spec of findChildren(child, "import_spec")) {
              const str = findChild(spec, "interpreted_string_literal");
              if (str) imports.push({ file: filePath, module: stripQuotes(str.text) });
            }
          }
        }
      }
    }
  });

  return imports;
}

/**
 * Detect test files and map to tested entity (heuristic).
 * Output: [{ testFile, testedEntity (inferred from name), framework }]
 */
function extractTestMapping(filePath, symbols) {
  const base = filePath.split("/").pop() || "";
  const isTest = /^(test_|.*_test\.(py|go|rs)|.*Test\.(java)|.*\.test\.(ts|js)|.*\.spec\.(ts|js))/.test(base) ||
    /\/test[s]?\//.test(filePath) || /\/__tests__\//.test(filePath);

  if (!isTest) return null;

  // Infer tested entity from filename
  let testedEntity = null;
  const m = base.match(/(?:test_|^)(\w+?)(?:_test|\.test|\.spec|Test)?\./);
  if (m && m[1]) testedEntity = m[1];

  return {
    testFile: filePath,
    testedEntity,
    framework: base.endsWith(".py") ? "pytest" : base.endsWith(".go") ? "go-test" : base.endsWith(".java") ? "junit" : "jest/vitest",
    symbolCount: symbols.length,
  };
}

// ---------------------------------------------------------------------------
// 5. Main: analyzeCodeRepo — orchestrates all extractors
// ---------------------------------------------------------------------------

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

/**
 * Main entry point. Parses all supported source files in the repo and
 * produces mechanical code facts.
 *
 * @param {string} repoPath - absolute path to repository root
 * @param {{files: string[]}} scan - file list from Stage 1 scan
 * @param {string} workDir - working directory for output
 * @returns {object} with keys: symbols, calls, imports, modules, tests, stats, evidenceFacts
 */
export async function analyzeCodeRepo(repoPath, scan, workDir) {
  // p6 copy.md §3: analyzer does its own deep scan — Stage 1 scan has depth=4
  // limit which misses deep source files (e.g. dbeaver has 6397 .java files at
  // depth 6+). We walk the full tree here, excluding vendor/build dirs.
  const { readdir } = await import("node:fs/promises");
  const EXCLUDE_DIRS = new Set(["node_modules", "dist", "build", "target", "bin", ".git", ".working"]);
  const EXCLUDE_PATTERNS = [/\.min\.js$/, /\.umd\.js$/, /\/vendor\//, /\/third[_-]?party\//, /\/assets\//];

  async function deepWalk(dir, depth = 0) {
    if (depth > 8) return []; // bound depth to avoid infinite recursion
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || EXCLUDE_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        files.push(...await deepWalk(full, depth + 1));
      } else if (e.isFile()) {
        const ext = extname(e.name);
        if (SUPPORTED_EXTS.includes(ext)) {
          const rel = full.replace(repoPath + "/", "");
          if (!EXCLUDE_PATTERNS.some((p) => p.test(rel))) {
            files.push(rel);
          }
        }
      }
    }
    return files;
  }

  const files = await deepWalk(repoPath);

  // Cap file count to bound runtime (large repos: sample 500 most relevant)
  const MAX_FILES = 500;
  const filesToParse = files.length > MAX_FILES
    ? files.slice(0, MAX_FILES)
    : files;

  await initTreeSitter();
  if (!Parser) {
    console.warn("  Tree-sitter unavailable — skipping code fact extraction");
    return { symbols: [], calls: [], imports: [], modules: [], tests: [], stats: { filesParsed: 0 }, evidenceFacts: [] };
  }

  const allSymbols = [];
  const allCalls = [];
  const allImports = [];
  const allTests = [];
  const modules = [];
  let parsed = 0;
  let failed = 0;

  // Parse files in batches to avoid memory pressure
  const BATCH = 20;
  for (let i = 0; i < filesToParse.length; i += BATCH) {
    const batch = filesToParse.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (f) => {
      const fullPath = join(repoPath, f);
      const parsed = await parseFile(fullPath);
      if (!parsed) return { file: f, symbols: [], calls: [], imports: [], test: null };
      const symbols = extractSymbols(parsed.tree, f);
      const calls = extractCalls(parsed.tree, f);
      const imports = extractImports(parsed.tree, f);
      const test = extractTestMapping(f, symbols);
      return { file: f, symbols, calls, imports, test };
    }));

    for (const r of results) {
      if (r.symbols.length === 0 && r.calls.length === 0 && r.imports.length === 0) {
        failed++;
        continue;
      }
      parsed++;
      allSymbols.push(...r.symbols);
      allCalls.push(...r.calls);
      allImports.push(...r.imports);
      if (r.test) allTests.push(r.test);
      modules.push({
        file: r.file,
        classes: r.symbols.filter((s) => s.type === "class").map((s) => s.name),
        functions: r.symbols.filter((s) => s.type === "function").map((s) => s.name),
        methods: r.symbols.filter((s) => s.type === "method").map((s) => ({ name: s.name, class: s.class })),
        importCount: r.imports.length,
        callCount: r.calls.length,
      });
    }

    // Progress log every 100 files
    if ((i + BATCH) % 100 === 0) {
      console.log(`  Tree-sitter: parsed ${parsed}/${filesToParse.length} files (${allSymbols.length} symbols, ${allCalls.length} calls)`);
    }
  }

  // Save facts/ artifacts (p6 copy.md §3)
  const factsDir = join(workDir, "facts");
  await ensureDir(factsDir);
  await writeFile(join(factsDir, "symbols.json"), JSON.stringify(allSymbols, null, 2), "utf-8");
  await writeFile(join(factsDir, "calls.json"), JSON.stringify(allCalls, null, 2), "utf-8");
  await writeFile(join(factsDir, "imports.json"), JSON.stringify(allImports, null, 2), "utf-8");
  await writeFile(join(factsDir, "modules.json"), JSON.stringify(modules, null, 2), "utf-8");
  await writeFile(join(factsDir, "tests.json"), JSON.stringify(allTests, null, 2), "utf-8");

  // Generate human-readable mechanical facts for Evidence Agent
  const evidenceFacts = generateCodeEvidenceFacts(allSymbols, allCalls, allImports, allTests, modules);

  return {
    symbols: allSymbols,
    calls: allCalls,
    imports: allImports,
    modules,
    tests: allTests,
    stats: {
      filesParsed: parsed,
      filesFailed: failed,
      totalSymbols: allSymbols.length,
      totalCalls: allCalls.length,
      totalImports: allImports.length,
      totalTests: allTests.length,
      totalModules: modules.length,
    },
    evidenceFacts,
  };
}

// ---------------------------------------------------------------------------
// 6. Generate evidence facts from code structure
// ---------------------------------------------------------------------------

function generateCodeEvidenceFacts(symbols, calls, imports, tests, modules) {
  const facts = [];

  // Top classes by method count (potential "God classes")
  const classMethodCounts = new Map();
  for (const s of symbols) {
    if (s.type === "method" && s.class) {
      classMethodCounts.set(s.class, (classMethodCounts.get(s.class) || 0) + 1);
    }
  }
  const topClasses = [...classMethodCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  for (const [cls, count] of topClasses) {
    if (count >= 10) {
      const sampleFile = symbols.find((s) => s.class === cls)?.file || "(unknown)";
      facts.push({
        observation: `Class "${cls}" has ${count} methods (potential high-responsibility class)`,
        source: "tree-sitter:symbols",
        file: sampleFile,
      });
    }
  }

  // Most-called functions (potential orchestration centers)
  const calleeCounts = new Map();
  for (const c of calls) {
    calleeCounts.set(c.callee, (calleeCounts.get(c.callee) || 0) + 1);
  }
  const topCallees = [...calleeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  for (const [fn, count] of topCallees) {
    if (count >= 5) {
      const sampleCall = calls.find((c) => c.callee === fn);
      facts.push({
        observation: `Function "${fn}" is called ${count} times across the codebase (potential shared utility or orchestration point)`,
        source: "tree-sitter:calls",
        file: sampleCall?.file || "(unknown)",
      });
    }
  }

  // Import hub files (files that import many modules — potential integration points)
  const importHubs = modules
    .filter((m) => m.importCount >= 15)
    .sort((a, b) => b.importCount - a.importCount)
    .slice(0, 5);
  for (const m of importHubs) {
    facts.push({
      observation: `File "${m.file}" imports ${m.importCount} modules (potential integration/aggregation point)`,
      source: "tree-sitter:imports",
      file: m.file,
    });
  }

  // Cross-module call patterns (caller and callee in different files)
  const crossModuleCalls = calls.filter((c) => {
    // Heuristic: if callee looks like ClassName.method, it's likely cross-module
    return c.callee.includes(".") && c.callee.length < 100;
  }).slice(0, 5);
  if (crossModuleCalls.length > 0) {
    facts.push({
      observation: `Detected ${crossModuleCalls.length}+ cross-module method calls (e.g., ${crossModuleCalls[0].caller} → ${crossModuleCalls[0].callee} in ${crossModuleCalls[0].file})`,
      source: "tree-sitter:calls",
      file: crossModuleCalls[0].file,
    });
  }

  // Test coverage summary
  if (tests.length > 0) {
    facts.push({
      observation: `Repository has ${tests.length} test files covering entities like: ${tests.slice(0, 5).map((t) => t.testedEntity || "(unknown)").join(", ")}`,
      source: "tree-sitter:tests",
      file: tests[0]?.testFile || "(unknown)",
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// CLI entry (for standalone testing)
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith("tree-sitter-analyzer.mjs")) {
  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error("Usage: node tree-sitter-analyzer.mjs <repo-path>");
    process.exit(1);
  }
  const { readdir } = await import("node:fs/promises");
  async function walk(dir, depth = 0) {
    if (depth > 5) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "target" || e.name === "bin") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) files.push(...await walk(full, depth + 1));
      else files.push(full.replace(repoPath + "/", ""));
    }
    return files;
  }
  const scan = { files: await walk(repoPath) };
  const workDir = join(repoPath, "..", ".tree-sitter-test");
  const result = await analyzeCodeRepo(repoPath, scan, workDir);
  console.log(JSON.stringify({ stats: result.stats, evidenceFacts: result.evidenceFacts }, null, 2));
}
