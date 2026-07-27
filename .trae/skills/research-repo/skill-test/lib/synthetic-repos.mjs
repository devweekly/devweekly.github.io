// ===========================================================================
// synthetic-repos.mjs — Factory for synthetic archetype repositories.
//
// Creates real directories with real source files that the Analyzer can
// process. Each archetype triggers different signals in buildArchetypeHints:
//   - database: sql, parser, lexer, optimizer, storage keywords
//   - agent:    agent, runner, tool, prompt files
//   - tool:     plugin, extension, driver keywords
//   - readme-claims: README claims features absent from code
// ===========================================================================

import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function writeFile(dir, relPath, content) {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
}

function createDatabaseRepo(dir) {
  writeFile(dir, "package.json", JSON.stringify({
    name: "synthetic-db",
    version: "1.0.0",
    main: "src/index.js",
    description: "In-process analytical SQL database",
  }));

  writeFile(dir, "README.md", [
    "# SyntheticDB",
    "",
    "An in-process analytical database with SQL parser, optimizer, and columnar storage.",
    "Features vectorized execution for OLAP workloads.",
  ].join("\n"));

  writeFile(dir, "src/index.js", [
    "export { Database } from './core/database.js';",
    "export { SQLParser } from './sql/parser.js';",
    "export { Optimizer } from './optimizer/optimizer.js';",
  ].join("\n"));

  writeFile(dir, "src/sql/parser.js", [
    "import { tokenize } from './lexer.js';",
    "export class SQLParser {",
    "  constructor() { this.tokens = []; }",
    "  parse(query) { this.tokens = tokenize(query); return this.buildAST(); }",
    "  buildAST() { return { type: 'SelectStmt', body: this.tokens }; }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/sql/lexer.js", [
    "export function tokenize(query) {",
    "  return query.split(/\\s+/).map(t => ({ type: 'keyword', value: t }));",
    "}",
    "export const TokenType = { KEYWORD: 'keyword', IDENT: 'ident', NUMBER: 'number' };",
  ].join("\n"));

  writeFile(dir, "src/optimizer/optimizer.js", [
    "export class Optimizer {",
    "  optimize(plan) { return this.pushDownPredicates(plan); }",
    "  pushDownPredicates(plan) { return plan; }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/execution/vectorized_executor.js", [
    "export class VectorizedExecutor {",
    "  execute(chunk) { return chunk.map(row => this.process(row)); }",
    "  process(row) { return row; }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/storage/column_segment.js", [
    "export class ColumnSegment {",
    "  constructor(type) { this.type = type; this.data = []; }",
    "  append(value) { this.data.push(value); }",
    "}",
  ].join("\n"));

  writeFile(dir, "tests/sql.test.js", [
    "import { test } from 'node:test';",
    "import { SQLParser } from '../src/sql/parser.js';",
    "test('parse select', () => { new SQLParser().parse('SELECT 1'); });",
  ].join("\n"));
}

function createAgentRepo(dir) {
  writeFile(dir, "package.json", JSON.stringify({
    name: "synthetic-agent",
    version: "1.0.0",
    main: "src/index.js",
    description: "AI Agent framework with Runner and Tool",
  }));

  writeFile(dir, "README.md", [
    "# SyntheticAgent",
    "",
    "An AI Agent framework with Runner, Tool, and Memory support.",
    "Agents use LLM to plan and execute tasks.",
  ].join("\n"));

  writeFile(dir, "src/index.js", [
    "export { Agent } from './agent.js';",
    "export { Runner } from './runner.js';",
    "export { Tool } from './tool.js';",
  ].join("\n"));

  writeFile(dir, "src/agent.js", [
    "import { Runner } from './runner.js';",
    "export class Agent {",
    "  constructor(tools, memory) { this.runner = new Runner(tools); this.memory = memory; }",
    "  run(prompt) { return this.runner.runLoop(prompt); }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/runner.js", [
    "import { Tool } from './tool.js';",
    "export class Runner {",
    "  constructor(tools) { this.tools = tools; }",
    "  runLoop(prompt) { return this.tools[0]?.execute(prompt) ?? prompt; }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/tool.js", [
    "export class Tool {",
    "  constructor(name, fn) { this.name = name; this.fn = fn; }",
    "  execute(input) { return this.fn(input); }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/memory.js", [
    "export class ConversationMemory {",
    "  constructor() { this.messages = []; }",
    "  add(msg) { this.messages.push(msg); }",
    "}",
  ].join("\n"));

  mkdirSync(join(dir, "src/prompts"), { recursive: true });
  writeFile(dir, "src/prompts/system.txt", [
    "You are a helpful AI agent.",
    "Use tools when needed to answer questions.",
  ].join("\n"));

  writeFile(dir, "tests/agent.test.js", [
    "import { test } from 'node:test';",
    "import { Agent } from '../src/agent.js';",
    "test('agent runs', () => { new Agent([], null); });",
  ].join("\n"));
}

function createToolRepo(dir) {
  writeFile(dir, "package.json", JSON.stringify({
    name: "synthetic-tool",
    version: "1.0.0",
    main: "src/index.js",
    description: "Eclipse Plugin for database management",
  }));

  writeFile(dir, "README.md", [
    "# SyntheticTool",
    "",
    "An Eclipse Plugin IDE extension for database management.",
    "Provides Driver management and SQL editor features.",
  ].join("\n"));

  writeFile(dir, "src/index.js", [
    "export { Plugin } from './plugin.js';",
    "export { ExtensionPoint } from './extension.js';",
    "export { DriverManager } from './driver.js';",
  ].join("\n"));

  writeFile(dir, "src/plugin.js", [
    "export class Plugin {",
    "  activate(context) { this.registerExtensions(context); }",
    "  deactivate() { this.extensions.clear(); }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/extension.js", [
    "export class ExtensionPoint {",
    "  constructor(id) { this.id = id; this.handlers = []; }",
    "  register(fn) { this.handlers.push(fn); }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/driver.js", [
    "export class DriverManager {",
    "  constructor() { this.drivers = new Map(); }",
    "  connect(url) { return { url, connected: true }; }",
    "}",
  ].join("\n"));

  writeFile(dir, "src/ui/view.js", [
    "export class ViewPart {",
    "  createControl(parent) { this.parent = parent; }",
    "}",
  ].join("\n"));

  writeFile(dir, "tests/plugin.test.js", [
    "import { test } from 'node:test';",
    "import { Plugin } from '../src/plugin.js';",
    "test('plugin activates', () => { new Plugin().activate({}); });",
  ].join("\n"));
}

function createReadmeClaimsRepo(dir) {
  writeFile(dir, "package.json", JSON.stringify({
    name: "readme-claims",
    version: "1.0.0",
    main: "src/index.js",
    description: "Project with ambitious README claims",
  }));

  writeFile(dir, "README.md", [
    "# ReadmeClaims",
    "",
    "A high-performance system featuring:",
    "- Vectorized Execution engine",
    "- Distributed Query Planner",
    "- LLM Integration for natural language queries",
    "- AI Agent for autonomous operation",
    "",
    "All features are fully implemented and production-ready.",
  ].join("\n"));

  writeFile(dir, "src/index.js", [
    "// Minimal implementation — does NOT implement any claimed features.",
    "export function hello() { return 'world'; }",
  ].join("\n"));
}

const FACTORIES = {
  database: createDatabaseRepo,
  agent: createAgentRepo,
  tool: createToolRepo,
  "readme-claims": createReadmeClaimsRepo,
};

export function createSyntheticRepo(archetype) {
  const factory = FACTORIES[archetype];
  if (!factory) {
    throw new Error(`Unknown archetype: ${archetype}. Valid: ${Object.keys(FACTORIES).join(", ")}`);
  }
  const dir = mkdtempSync(join(tmpdir(), `synthetic-${archetype}-`));
  factory(dir);
  return dir;
}

export function cleanupSyntheticRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export const ARCHETYPES = Object.keys(FACTORIES);
