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
 * This file is the CLI entrypoint. All analysis logic lives in modular files:
 *   config.mjs              — Configuration constants
 *   utils.mjs               — Shared utilities (AST, file walking, parsers, graph algos)
 *   context.mjs             — RepositoryContext (shared analysis context)
 *   base-analyzer.mjs       — BaseAnalyzer abstract class
 *   analyzers-fact.mjs      — Fact extractor analyzers
 *   analyzers-inference.mjs — Inference engine analyzers
 *   evidence-store.mjs      — EvidenceStore, ObjectClassifier, RelationshipBuilder
 *   research-engine.mjs     — ResearchPlanner, QuestionGenerator, FindingsGenerator
 *   report-generator.mjs    — ReportGenerator (Evidence Brief)
 *   pipeline.mjs            — ANALYZERS array, AnalyzerPipeline, merge utilities
 *
 * Each command prints JSON to stdout. Errors go to stderr, exit(1) on error.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { loadOptionalPackages, initTreeSitter } from "./utils.mjs";
import { RepositoryContext } from "./context.mjs";
import { AnalyzerPipeline, ANALYZERS, mergeAnalysisResults } from "./pipeline.mjs";
import { EvidenceStore } from "./evidence-store.mjs";
import {
  DEFAULT_RESEARCH_GOAL,
  ResearchPlanner,
  QuestionGenerator,
} from "./research-engine.mjs";
import { ReportGenerator } from "./report-generator.mjs";

// Swallow EPIPE errors when downstream (e.g. `head`) closes the pipe early.
process.stdout?.on?.("error", (err) => {
  if (err && err.code === "EPIPE") process.exit(0);
  throw err;
});

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
      rebuildStore.report = new ReportGenerator(evidenceStore, { lang }).generate();
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

      process.stdout.write(JSON.stringify(rebuildStore, null, 2) + "\n");
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
export { RepositoryContext } from "./context.mjs";
export { BaseAnalyzer } from "./base-analyzer.mjs";
export { AnalyzerPipeline } from "./pipeline.mjs";
export { EvidenceStore } from "./evidence-store.mjs";
export { ResearchPlanner, QuestionGenerator } from "./research-engine.mjs";
export { LANGUAGE_EXTENSIONS, SOURCE_EXTENSIONS, ARCHITECTURE_SIGNAL_DIRS } from "./config.mjs";
export { PROJECT_DISCOVERY_RULES } from "./utils.mjs";
