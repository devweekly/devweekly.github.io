import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname, basename, relative, sep, dirname } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  IGNORED_DIRS,
  TEST_FILE_REGEXES,
  TEST_FUNCTION_REGEX,
  IMPORT_REGEX,
  findNodeModules,
} from "./config.mjs";

// ===========================================================================
// Optional packages (fast-glob, simple-git, yaml)
// ===========================================================================
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
  // JS/TS class methods use `method_definition` (tree-sitter grammar). Without
  // this, methods are never extracted from JS/TS classes — class.method[]
  // stays empty, breaking method-based design pattern detection (Singleton,
  // Observer, Command, Chain of Responsibility, Repository CRUD, Factory
  // create*, Builder fluent*).
  "method_definition",
]);
const CLASS_NODE_TYPES = new Set(["class_definition", "class_declaration"]);

// ===========================================================================
// Tree-sitter initialization and parsing
// ===========================================================================


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
      // (e.g. `import com.example.core.ModelPreferences;`) or `asterisk_identifier`
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

      // Filter false positives: many variables match prompt/template/instruction
      // keywords but hold non-prompt values (filenames, version strings, empty
      // strings, short identifiers). Observed false positives across ref-only:
      //   - `prompt = ''` / `instructions: str = ""` (empty)
      //   - `_GEMMA4_TEMPLATE_FILE = "gemma-4.jinja"` (filename in name)
      //   - `TEMPLATE_VERSION = "attention_golden_section_modal.v1"` (version)
      //   - `template = "gpt-oss"` (short identifier, not a prompt)
      //   - `instruction_name = "AGENTS.md"` (filename in value)
      //   - `instructions = f"{instructions}\n\n{...}"` (string accumulator —
      //     self-referential re-assignment, not a new prompt definition)
      if (type && !isFalsePositivePrompt(name, valueNode.text)) {
        // Detect string accumulator pattern: the value references the same
        // variable being assigned (e.g., `instructions = f"{instructions}..."`).
        // These are append steps, not new prompt definitions. Keep only the
        // initial assignment (which doesn't self-reference).
        const selfRefPattern = new RegExp(`\\{${name}\\}|\\$\\{${name}\\}`);
        if (!selfRefPattern.test(valueNode.text)) {
          prompts.push({
            file: relPath,
            line: node.startPosition.row + 1,
            type,
            snippet: node.text.trim().slice(0, 200),
          });
        }
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

/**
 * Detect false-positive prompt values — variables that match prompt/template/
 * instruction keywords by name but hold non-prompt values.
 *
 * Heuristics (any one triggers false-positive classification):
 * 1. Empty or whitespace-only string value
 * 2. Variable name ends with `_FILE` / `_PATH` / `_FILENAME` (file path holder)
 * 3. Variable name contains `VERSION` (version string holder)
 * 4. Value is a short filename-like token (e.g., "gpt-oss", "gemma-4.jinja",
 *    "AGENTS.md") — identified by: no whitespace, ≤24 chars, and contains a
 *    dot extension OR is a single kebab/snake case identifier
 * 5. Variable name is exactly `instruction_name` / `instruction_file` /
 *    `prompt_file` etc. (these hold filenames/identifiers, not prompts)
 * 6. Variable name ends with `_EVENT` / `_PREFIX` / `_SUFFIX` / `_ID` /
 *    `_KEY` / `_TYPE` / `_CONST` / `_QUEUE` — identifier holders, not prompts
 * 7. Value is a template string with `${...}` interpolation and ≤30 chars —
 *    dynamic ID/value generator, not a static prompt
 */
function isFalsePositivePrompt(varName, valueText) {
  if (!valueText) return true;
  // Strip Python string prefixes (f, r, b, rb, fr, etc.) and surrounding quotes.
  // f"{REMOTE_ROOT}/prompts" → {REMOTE_ROOT}/prompts
  const stripped = valueText.replace(/^(?:[rbf]|rb|fr|rf|br)+/i, "").trim();
  const value = stripped.replace(/^(['"`])+/, "").replace(/(['"`])+$/, "").trim();
  // 1. Empty or whitespace-only
  if (value.length === 0) return true;
  if (value.length <= 1 && /\s/.test(value)) return true;

  const upperName = varName.toUpperCase();
  // 2. Variable name indicates file path holder
  if (/(?:_FILE|_PATH|_FILENAME|_LOCATION)$/.test(upperName)) return true;
  // 3. Variable name indicates version holder
  if (upperName.includes("VERSION")) return true;
  // 5. Variable name indicates identifier/filename holder (not prompt content)
  if (/(?:^|_)(?:NAME|FILE|DIR|DIRECTORY|KEY|ID|TOKEN|LABEL)$/.test(upperName)) return true;
  // `instruction_name` / `prompt_name` etc. — name holder, not prompt
  if (/(?:NAME|FILE)$/.test(upperName) && /(?:INSTRUCTION|PROMPT|TEMPLATE)/.test(upperName)) return true;
  // 6. Variable name indicates event/queue/prefix/type holder
  if (/(?:_EVENT|_PREFIX|_SUFFIX|_TYPE|_CONST|_QUEUE|_CHANNEL|_THREAD|_TOPIC|_URL|_URI)$/.test(upperName)) return true;

  // 7. Template string with ${...} interpolation and short — dynamic value
  if (/\$\{[^}]+\}/.test(value) && value.length <= 30) return true;
  // 7b. Python f-string with {...} interpolation and short — dynamic value.
  // Observed: REMOTE_PROMPTS = f"{REMOTE_ROOT}/prompts" (path builder, not prompt).
  if (/\{[A-Z_][A-Z0-9_]*\}/.test(value) && value.length <= 60) {
    // If the value looks like a path (contains `/` or `\`), it's a path builder.
    if (/[\/\\]/.test(value)) return true;
    // Short f-string with interpolation that's not a path — still suspicious.
    if (value.length <= 30) return true;
  }

  // 8. CSS / layout template values — these match `template` keyword
  // (gridTemplateColumns, gridTemplateRows, etc.) but are CSS, not LLM prompts.
  // Observed: gridTemplateColumns = `repeat(${weeks.length}, minmax(0, 1fr))`
  if (/\b(?:repeat|minmax|grid-template|auto-fit|auto-fill|1fr|fit-content)\b/.test(value)) {
    return true;
  }

  // 9. Path-like values — strings containing `/` and ending with a path/file
  // extension are paths, not prompts.
  // Observed: REMOTE_PROMPTS = f"{REMOTE_ROOT}/prompts",
  //           remote_prompt = f"{REMOTE_PROMPTS}/{...}.system-prompt.md"
  if (/[\/\\]\w*\.[a-z0-9]{1,8}$/i.test(value)) return true;
  // Path-like values ending with a directory name (no extension) and short.
  if (/[\/\\][a-z_\-]+$/i.test(value) && value.length <= 60 && !/\s/.test(value)) {
    return true;
  }

  // 4. Value is a short filename-like token (no spaces, short, has extension
  //    or is a single identifier). Real prompts are multi-word sentences.
  //    Strip surrounding quotes first.
  if (value.length <= 28 && !/\s/.test(value)) {
    // Has a file extension (e.g., "gemma-4.jinja", "AGENTS.md")
    if (/\.[a-z0-9]{1,8}$/i.test(value)) return true;
    // Single identifier with optional separators (kebab/snake case, colons,
    // dots, underscores) — covers event names like "unsloth:prompt-queue-stop",
    // thread ID prefixes like "__LOCALID_", version IDs like "attention.golden.v1"
    if (/^[a-zA-Z_][a-zA-Z0-9_\-:.]*$/i.test(value)) return true;
  }
  return false;
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
              // JS/TS `method_definition` stores its name in `property_identifier`;
              // Python `function_definition` and others use `identifier`.
              const methodId = findChild(child, "identifier")
                || findChild(child, "property_identifier");
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
// Project Discovery Rules (depends on manifest parsers above)
// ---------------------------------------------------------------------------

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
  // Extended metadata (added 2026-07: caught as false-negatives in Rust workspace repos)
  { category: "metadata", file: "CODE_OF_CONDUCT.md", priority: 60 },
  { category: "metadata", file: "GOVERNANCE.md", priority: 55 },
  { category: "metadata", file: "RELEASING.md", priority: 50 },
  { category: "metadata", file: "TESTING.md", priority: 50 },
  // Agent instructions (AI coding agent configs)
  // Added 2026-07: SKILL.md (Claude Code skill manifest) was missing — caused
  // repos with many SKILL.md files to falsely report "No AI Agent instruction
  // files found" despite containing 100+ SKILL.md files each.
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

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

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
// Schema extraction (for tools analyzer)
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

// ---------------------------------------------------------------------------
// Git utilities
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

// ---------------------------------------------------------------------------
// CI workflow parsing
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

export {
  // Optional packages (live bindings — consumers see updated values after loadOptionalPackages)
  fastGlob,
  simpleGit,
  yaml,
  loadOptionalPackages,
  // Tree-sitter state and functions
  Parser,
  LanguageExport,
  wasmDir,
  initTreeSitter,
  getParserForFile,
  parseFileAST,
  // Concurrency
  mapWithConcurrency,
  // Language maps
  TS_LANG_MAP,
  JS_EXTS,
  FUNCTION_NODE_TYPES,
  CLASS_NODE_TYPES,
  // AST traversal
  walkAST,
  findChild,
  findChildren,
  stripStringQuotes,
  findEnclosingFuncName,
  extractFunctionParams,
  getDecoratorsFromParent,
  // AST extractors
  extractImportsAST,
  extractPromptsAST,
  isFalsePositivePrompt,
  extractToolsAST,
  extractEntrypointsAST,
  extractSymbolsAST,
  // File walking
  walkDir,
  walkFiles,
  readFileSafe,
  pathToModuleId,
  normalizeImportToId,
  countByExtension,
  findNodeModules,
  // Manifest parsers
  parsePackageJson,
  parsePyproject,
  parseSetupPy,
  parseSetupCfg,
  parseRequirementsTxt,
  parseCargoToml,
  parseGoMod,
  parsePomXml,
  parseGradle,
  // Project discovery
  PROJECT_DISCOVERY_RULES,
  // Test utilities
  isTestFile,
  isTestPath,
  findTestFiles,
  detectTestPatterns,
  categorizeTestCategory,
  categorizeTestModule,
  countTestFunctions,
  // Import extraction
  parseImports,
  // Graph algorithms
  computeInDegree,
  computeOutDegree,
  computePageRank,
  detectCycles,
  topN,
  // Schema extraction
  extractSchemaNear,
  // Git utilities
  git,
  isGitRepo,
  // CI parsing
  parseWorkflow,
};
