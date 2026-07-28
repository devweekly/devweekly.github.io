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
 *   node research-repo.mjs report       <repoPath>  # Evidence Brief (Markdown)
 *   node research-repo.mjs verify       <researchDir> [--expected=<yaml>]  # Validate research output
 *
 *   # Hybrid commands (Script Mechanical Truth + LLM Semantic Truth):
 *   node research-repo.mjs hybrid       <repoPath> [outputDir]  # Markdown report via LLM
 *   node research-repo.mjs hybrid-json  <repoPath> [outputDir]  # JSON output via LLM
 *   node research-repo.mjs hybrid-analyzers         # List Mechanical vs Semantic analyzers
 *
 *   # Pipeline v2 commands (4-stage: Modeling → Interpretation → Fingerprint → Narrative):
 *   node research-repo.mjs pipeline-v2   <repoPath> [outputDir]  # Full 4-stage pipeline
 *   node research-repo.mjs modeling      <repoPath>              # Stage 1 only: Knowledge Graph
 *   node research-repo.mjs interpretation <repoPath>             # Stage 2 only: Semantic Findings (requires KG)
 *   node research-repo.mjs fingerprint   <repoPath>              # Stage 3 only: Fingerprint (requires KG + Findings)
 *
 * This file is the CLI entrypoint. All analysis logic lives in modular files:
 *   config.mjs              — Configuration constants
 *   utils.mjs               — Shared utilities (AST, file walking, parsers, graph algos)
 *   context.mjs             — RepositoryContext (shared analysis context)
 *   base-analyzer.mjs       — BaseAnalyzer abstract class
 *   analyzers-fact.mjs      — Fact extractor analyzers
 *   analyzers-inference.mjs — Mechanical inference engine analyzers
 *   evidence-store.mjs      — EvidenceStore, ObjectClassifier, RelationshipBuilder
 *   evidence-quality.mjs    — Evidence sanitizer + archetype hints
 *   pipeline.mjs            — ANALYZERS array, AnalyzerPipeline, merge utilities
 *   hybrid-pipeline.mjs     — Hybrid (Mechanical + LLM) pipeline
 *   llm-runner.mjs          — Unified LLM invocation (OpenCode / Copilot CLI)
 *
 * Each command prints JSON to stdout. Errors go to stderr, exit(1) on error.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { loadOptionalPackages, initTreeSitter } from "./utils.mjs";
import { RepositoryContext } from "./context.mjs";
import { AnalyzerPipeline, ANALYZERS } from "./pipeline.mjs";
import { verifyResearchDirectory, loadExpectedYaml } from "./skill-test/e2e/verify-directory.mjs";
import {
  runHybridPipeline,
  runPipelineV2,
  listMechanicalAnalyzers,
  listSemanticAnalyzers,
} from "./hybrid-pipeline.mjs";

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
  const positional = process.argv.slice(2).filter(
    (a) => !a.startsWith("--") && a !== langFlag
  );
  const command = positional[0];
  const repoPath = positional[1];
  const hybridCommands = new Set(["hybrid", "hybrid-json", "hybrid-analyzers"]);
  const pipelineV2Commands = new Set([
    "pipeline-v2",
    "modeling",
    "interpretation",
    "fingerprint",
  ]);
  const verifyCommands = new Set(["verify"]);
  const validCommands = new Set([
    ...ANALYZERS.map((a) => a.id),
    "all",
    "report",
    ...hybridCommands,
    ...pipelineV2Commands,
    ...verifyCommands,
  ]);

  if (!command) {
    console.error(
      `Usage: node research-repo.mjs <${[...validCommands].join("|")}> <args>`
    );
    process.exit(1);
  }

  if (!validCommands.has(command)) {
    console.error(
      `Unknown command: ${command}. Valid: ${[...validCommands].join(", ")}`
    );
    process.exit(1);
  }

  // ---- Verify command (requires research output directory) ----
  if (verifyCommands.has(command)) {
    const researchDir = positional[1];
    if (!researchDir) {
      console.error("Usage: node research-repo.mjs verify <researchDir> [--expected=<yaml>]");
      process.exit(1);
    }
    if (!existsSync(researchDir)) {
      console.error(`Error: research directory does not exist: ${researchDir}`);
      process.exit(1);
    }
    const expectedFlag = process.argv.find((a) => a.startsWith("--expected="));
    const expectedPath = expectedFlag ? expectedFlag.split("=")[1] : null;
    const expected = expectedPath && existsSync(expectedPath)
      ? loadExpectedYaml(expectedPath)
      : {};
    const result = verifyResearchDirectory(researchDir, expected);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(result.ok ? 0 : 1);
  }

  // ---- Hybrid commands (Script produces Mechanical Truth, LLM produces Semantic Truth) ----
  if (hybridCommands.has(command)) {
    if (command === "hybrid-analyzers") {
      // Introspection: list which analyzers are Mechanical vs Semantic
      process.stdout.write(JSON.stringify({
        mechanical: listMechanicalAnalyzers(),
        semantic: listSemanticAnalyzers(),
        total: listMechanicalAnalyzers().length + listSemanticAnalyzers().length,
      }, null, 2) + "\n");
      return;
    }

    const hybridRepoPath = positional[1];
    // positional[2] is outputDir (optional). If provided, write artifacts there.
    const outputDir = positional[2];
    if (!hybridRepoPath) {
      console.error("Usage: node research-repo.mjs hybrid <repoPath> [outputDir] [--skill=07-report-writer.md] [--model=opencode/deepseek-v4-flash-free] [--format=markdown|json]");
      process.exit(1);
    }
    if (!existsSync(hybridRepoPath)) {
      console.error(`Error: path does not exist: ${hybridRepoPath}`);
      process.exit(1);
    }

    const skillFlag = process.argv.find((a) => a.startsWith("--skill="));
    const modelFlag = process.argv.find((a) => a.startsWith("--model="));
    const formatFlag = process.argv.find((a) => a.startsWith("--format="));
    const briefFlag = process.argv.find((a) => a.startsWith("--brief="));

    const skill = skillFlag ? skillFlag.split("=")[1] : "07-report-writer.md";
    const model = modelFlag ? modelFlag.split("=")[1] : "opencode/deepseek-v4-flash-free";
    const format = formatFlag ? formatFlag.split("=")[1] : (command === "hybrid-json" ? "json" : "markdown");
    const returnBrief = briefFlag ? briefFlag.split("=")[1] === "true" : false;

    console.error(`[hybrid] Mechanical analyzers → JSON Evidence Brief → LLM (${model}) → ${format}`);
    console.error(`[hybrid] Skill prompt: ${skill}`);
    console.error(`[hybrid] Skipping semantic analyzers: ${listSemanticAnalyzers().join(", ")}`);
    if (outputDir) {
      console.error(`[hybrid] Output dir: ${outputDir}`);
    }

    try {
      const result = await runHybridPipeline(hybridRepoPath, {
        skillPrompt: skill,
        model,
        outputFormat: format,
        returnEvidenceBrief: returnBrief || !!outputDir,
      });

      if (outputDir) {
        // Write artifacts to outputDir
        const { mkdirSync } = await import("node:fs");
        mkdirSync(outputDir, { recursive: true });
        if (typeof result === "object" && result.evidenceBrief) {
          writeFileSync(join(outputDir, "report.md"), String(result.report || "") + "\n");
          writeFileSync(join(outputDir, "evidence-brief.json"), JSON.stringify(result.evidenceBrief, null, 2) + "\n");
          console.error(`[hybrid] Wrote report.md + evidence-brief.json to ${outputDir}`);
        } else {
          writeFileSync(join(outputDir, "report.md"), String(result) + "\n");
          console.error(`[hybrid] Wrote report.md to ${outputDir}`);
        }
      } else if (returnBrief && typeof result === "object") {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stdout.write(String(result) + "\n");
      }
    } catch (err) {
      console.error(`[hybrid] Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ---- Pipeline v2 commands (4-stage: Modeling → Interpretation → Fingerprint → Narrative) ----
  if (pipelineV2Commands.has(command)) {
    const v2RepoPath = positional[1];
    const outputDir = positional[2]; // optional output directory
    if (!v2RepoPath) {
      console.error(`Usage: node research-repo.mjs ${command} <repoPath> [outputDir] [--model=opencode/deepseek-v4-flash-free] [--stage=all|modeling|interpretation|fingerprint]`);
      process.exit(1);
    }
    if (!existsSync(v2RepoPath)) {
      console.error(`Error: path does not exist: ${v2RepoPath}`);
      process.exit(1);
    }

    const modelFlag = process.argv.find((a) => a.startsWith("--model="));
    const stageFlag = process.argv.find((a) => a.startsWith("--stage="));
    const model = modelFlag ? modelFlag.split("=")[1] : "opencode/deepseek-v4-flash-free";

    // Map CLI command to stage:
    //   pipeline-v2 → all
    //   modeling → modeling
    //   interpretation → interpretation
    //   fingerprint → fingerprint
    const stage = stageFlag
      ? stageFlag.split("=")[1]
      : (command === "pipeline-v2" ? "all" : command);

    console.error(`[v2] Pipeline v2 (4-stage): stage=${stage}, model=${model}`);
    if (outputDir) {
      console.error(`[v2] Output dir: ${outputDir}`);
    }

    try {
      const result = await runPipelineV2(v2RepoPath, {
        model,
        stage,
        returnAll: !!outputDir || stage === "all",
      });

      if (outputDir) {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(outputDir, { recursive: true });
        if (typeof result === "object") {
          if (result.kg) {
            writeFileSync(join(outputDir, "knowledge-graph.json"), JSON.stringify(result.kg, null, 2) + "\n");
          }
          if (result.findings) {
            writeFileSync(join(outputDir, "findings.json"), JSON.stringify(result.findings, null, 2) + "\n");
          }
          if (result.fingerprint) {
            writeFileSync(join(outputDir, "fingerprint.json"), JSON.stringify(result.fingerprint, null, 2) + "\n");
          }
          if (result.report) {
            writeFileSync(join(outputDir, "report.md"), String(result.report) + "\n");
          }
          if (result.evidenceBrief) {
            writeFileSync(join(outputDir, "evidence-brief.json"), JSON.stringify(result.evidenceBrief, null, 2) + "\n");
          }
          console.error(`[v2] Wrote artifacts to ${outputDir}`);
        } else {
          // String result (report only)
          writeFileSync(join(outputDir, "report.md"), String(result) + "\n");
          console.error(`[v2] Wrote report.md to ${outputDir}`);
        }
      } else {
        // No outputDir: print to stdout
        if (typeof result === "string") {
          process.stdout.write(result + "\n");
        } else {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        }
      }
    } catch (err) {
      console.error(`[v2] Error: ${err.message}`);
      if (err.stack) console.error(err.stack);
      process.exit(1);
    }
    return;
  }

  // ---- Analyzer commands (require repoPath + tree-sitter) ----
  const repoPathFinal = positional[1];
  if (!repoPathFinal) {
    console.error(
      `Usage: node research-repo.mjs <${[...validCommands]
        .filter((c) => !verifyCommands.has(c))
        .join("|")}> <repoPath>`
    );
    process.exit(1);
  }

  if (!existsSync(repoPathFinal)) {
    console.error(`Error: path does not exist: ${repoPathFinal}`);
    process.exit(1);
  }

  const absPath = statSync(repoPathFinal).isDirectory()
    ? repoPathFinal
    : dirname(repoPathFinal);

  await loadOptionalPackages();
  await initTreeSitter();

  try {
    const ctx = new RepositoryContext(absPath);
    const pipeline = new AnalyzerPipeline();

    if (command === "report") {
      const evidenceStore = await pipeline.runAll(ctx);
      const brief = renderMarkdownBrief(evidenceStore);
      process.stdout.write(brief + "\n");
      return;
    }

    let result;
    if (command === "all") {
      result = await pipeline.runAll(ctx);
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

// ---------------------------------------------------------------------------
// Minimal Markdown Evidence Brief renderer
//
// Replaces the deleted ReportGenerator. This is intentionally thin: it
// renders the mechanical evidence store as a readable Markdown brief. All
// semantic interpretation (patterns, decisions, narrative) is delegated to
// the Hybrid pipeline's LLM.
// ---------------------------------------------------------------------------

function renderMarkdownBrief(evidenceStore) {
  const store = evidenceStore._store || {};
  const discovery = store.discovery || {};
  const signals = (store._archetypeHints || {}).signals || {};
  const repoName = discovery.repoName || discovery.packageName || "repository";

  const lines = [];
  lines.push(`# Evidence Brief: ${repoName}`);
  lines.push("");
  lines.push("This brief contains **Mechanical Truth** only: repository metadata, " +
    "file/symbol counts, import graph metrics, detected prompts/tools/tests, " +
    "and git history facts. Semantic interpretation is intentionally omitted.");
  lines.push("");

  // Repository overview
  lines.push("## Repository Overview");
  lines.push("");
  lines.push(`- **Path**: ${discovery.repoPath || "unknown"}`);
  lines.push(`- **Files**: ${discovery.fileCount || 0}`);
  lines.push(`- **Languages**: ${JSON.stringify(discovery.languages || {})}`);
  lines.push(`- **Manifest**: ${discovery.manifest?.name || "none"}`);
  lines.push("");

  // Archetype signals
  const activeSignals = Object.entries(signals).filter(([, v]) => v).map(([k]) => k);
  lines.push("## Archetype Hints");
  lines.push("");
  if (activeSignals.length > 0) {
    lines.push(`Detected: ${activeSignals.join(", ")}.`);
  } else {
    lines.push("No strong archetype signals detected.");
  }
  lines.push("");

  // Key Evidence
  lines.push("## Key Evidence");
  lines.push("");
  lines.push(`- Repository: ${discovery.fileCount || 0} files across ${Object.keys(discovery.languages || {}).length || 0} languages.`);
  lines.push(`- Symbols: ${(store.symbols?.totalFunctions || 0) + (store.symbols?.totalClasses || 0)} total (functions + classes).`);
  lines.push(`- Architecture: ${(store.architecture?.totalNodes || 0)} modules, ${(store.architecture?.totalEdges || 0)} import edges, ${(store.architecture?.cycles || []).length} cycles.`);
  lines.push(`- Tests: ${store.tests?.totalTestFiles || 0} test files.`);
  if (store.prompts?.totalPrompts > 0) {
    lines.push(`- Prompts: ${store.prompts.totalPrompts} detected.`);
  }
  if (store.tools?.totalTools > 0) {
    lines.push(`- Tools: ${store.tools.totalTools} detected.`);
  }
  lines.push("");

  // Design Decisions
  lines.push("## Design Decisions");
  lines.push("");
  lines.push("No semantic decision inference is performed by the Mechanical Analyzers.");
  lines.push("Use the `hybrid` command to let the LLM infer architecture decisions and tradeoffs.");
  lines.push("");

  // Symbols
  const symbols = store.symbols || {};
  lines.push("## Symbols");
  lines.push("");
  lines.push(`- Functions: ${symbols.totalFunctions || 0}`);
  lines.push(`- Classes: ${symbols.totalClasses || 0}`);
  lines.push(`- Imports: ${symbols.totalImports || 0}`);
  lines.push(`- Calls: ${symbols.totalCalls || 0}`);
  lines.push("");

  // Architecture
  const arch = store.architecture || {};
  lines.push("## Architecture Graph");
  lines.push("");
  lines.push(`- Nodes: ${arch.totalNodes || 0}`);
  lines.push(`- Edges: ${arch.totalEdges || 0}`);
  lines.push(`- Cycles: ${(arch.cycles || []).length}`);
  lines.push("");

  // Entrypoints, prompts, tools, tests
  const entrypoints = (store.entrypoints?.entrypoints || []).slice(0, 5);
  if (entrypoints.length > 0) {
    lines.push("## Entrypoints");
    lines.push("");
    for (const ep of entrypoints) {
      lines.push(`- \`${ep.path}\` (${ep.type})`);
    }
    lines.push("");
  }

  const prompts = store.prompts || {};
  if (prompts.totalPrompts > 0) {
    lines.push("## Prompts");
    lines.push("");
    lines.push(`- Total: ${prompts.totalPrompts}`);
    lines.push("");
  }

  const tools = store.tools || {};
  if (tools.totalTools > 0) {
    lines.push("## Tools / Functions");
    lines.push("");
    lines.push(`- Total: ${tools.totalTools}`);
    lines.push("");
  }

  const tests = store.tests || {};
  lines.push("## Tests");
  lines.push("");
  lines.push(`- Test files: ${tests.totalTestFiles || 0}`);
  lines.push(`- Frameworks: ${(tests.frameworks || []).join(", ") || "none"}`);
  lines.push("");

  // Dependency smells & metrics
  const smells = store.dependencySmell || {};
  const archMetrics = store.archMetrics || {};
  lines.push("## Structural Metrics");
  lines.push("");
  lines.push(`- Dependency smells: ${smells.totalSmells || 0}`);
  if (archMetrics.summary) {
    lines.push(`- Coupling density: ${archMetrics.summary.density || 0}`);
    lines.push(`- Avg instability: ${archMetrics.summary.avgInstability || 0}`);
  }
  lines.push("");

  // Git
  const git = store.git || {};
  if (git.totalCommits > 0) {
    lines.push("## Git History");
    lines.push("");
    lines.push(`- Commits: ${git.totalCommits}`);
    lines.push(`- Authors: ${(git.authors || []).length}`);
    lines.push("");
  }

  // CI
  const ci = store.ci || {};
  if ((ci.platforms || []).length > 0) {
    lines.push("## CI/CD");
    lines.push("");
    lines.push(`- Platforms: ${ci.platforms.join(", ")}`);
    lines.push("");
  }

  // Honesty note
  lines.push("## Limits");
  lines.push("");
  lines.push("- This brief is produced by deterministic Mechanical Analyzers only.");
  lines.push("- No architecture pattern, responsibility, or decision inference is performed.");
  lines.push("- For semantic interpretation, use the `hybrid` command.");
  lines.push("");

  return lines.join("\n");
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

// Public API for programmatic use (e.g. tests, LLM subagents)
export { RepositoryContext } from "./context.mjs";
export { BaseAnalyzer } from "./base-analyzer.mjs";
export { AnalyzerPipeline } from "./pipeline.mjs";
export { EvidenceStore } from "./evidence-store.mjs";
export { LANGUAGE_EXTENSIONS, SOURCE_EXTENSIONS, ARCHITECTURE_SIGNAL_DIRS } from "./config.mjs";
export { PROJECT_DISCOVERY_RULES } from "./utils.mjs";
