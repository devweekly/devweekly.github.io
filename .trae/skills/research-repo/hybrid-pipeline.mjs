// ===========================================================================
// hybrid-pipeline.mjs — Hybrid Architecture Pipeline
//
// Design principle (from user feedback):
//   "Script 不负责思考。Script 负责 Mechanical Truth。
//    LLM 负责 Semantic Truth。"
//
// Pipeline flow:
//   Repository
//     ↓
//   Mechanical Analyzers (AST / Graph / Metrics / Evidence / File Index)
//     ↓
//   JSON Evidence Brief (structured facts, NO interpretation)
//     ↓
//   llm-runner.mjs → OpenCode/Copilot CLI
//     ↓
//   Skill Prompt (prompts/07-report-writer.md or custom)
//     ↓
//   LLM
//     ↓
//   Report (Markdown or JSON)
//
// What this pipeline does NOT do (delegated to LLM):
//   - Pattern Detection (Plugin/Layered/Event-Driven)
//   - Responsibility Analysis
//   - Decision/Constraint/Assumption inference
//   - FindingsGenerator / VerificationLoop / EvidenceSynthesizer
//   - ReportGenerator (Markdown rendering)
//   - Claim Ranking
//   - ConsistencyAnalyzer (cross-analyzer contradiction)
//
// What this pipeline KEEPS (Mechanical Truth):
//   - Discovery / Symbols / Architecture / Entrypoints / Prompts / Tools
//   - Tests / Evaluations / Git / CI / Ranking
//   - Stability / ChangeCoupling / InformationFlow / DependencySmell
//   - ArchitectureMetrics (Fan-in/Fan-out) / TemporalAnalyzer (git history)
//
// Coexists with existing Script-heavy pipeline via `--mode=hybrid` flag.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { loadOptionalPackages, initTreeSitter } from "./utils.mjs";
import { RepositoryContext } from "./context.mjs";
import { EvidenceSanitizer, buildArchetypeHints } from "./evidence-quality.mjs";
import { invokeLLM, invokeLLMJSON, renderPrompt } from "./llm-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Mechanical Analyzer allowlist
// ---------------------------------------------------------------------------

/**
 * Analyzers that produce Mechanical Truth (no semantic interpretation).
 * Semantic analyzers (ArchitecturePattern / Responsibility / Capability /
 * Decision / Constraint / Assumption / DesignPattern / Consistency) are
 * skipped — their work is delegated to the LLM via Skill prompts.
 *
 * Rationale:
 *   - Graph algorithms (cycle/Fan-in/Fan-out/BFS) are deterministic and fast
 *   - Git history facts (commits/changes/authors) are objective
 *   - File/symbol/import extraction is language-driven, not judgment
 *   - Pattern Detection / Responsibility / Decision inference are subjective
 *     and better handled by LLM with full context awareness
 */
export const MECHANICAL_ANALYZER_NAMES = new Set([
  // Fact extractors (analyzers-fact.mjs)
  "DiscoveryAnalyzer",
  "SymbolsAnalyzer",
  "ArchitectureAnalyzer",
  "EntrypointsAnalyzer",
  "PromptsAnalyzer",
  "ToolsAnalyzer",
  "TestsAnalyzer",
  "EvaluationsAnalyzer",
  "GitAnalyzer",
  "CIAnalyzer",
  "RankingAnalyzer",
  // Structural inference (graph algorithms, git history)
  "StabilityAnalyzer",
  "ChangeCouplingAnalyzer",
  "InformationFlowAnalyzer",
  "DependencySmellAnalyzer",
  "ArchitectureMetricsAnalyzer",
  "TemporalAnalyzer",
]);

// Semantic analyzers explicitly skipped in Hybrid mode:
//   ArchitecturePatternAnalyzer  — LLM judges architecture pattern from evidence
//   ResponsibilityAnalyzer       — LLM infers module responsibility
//   CapabilityOntologyAnalyzer   — LLM infers capabilities
//   DecisionAnalyzer             — LLM infers engineering decisions
//   ConstraintAnalyzer           — LLM infers constraints
//   AssumptionAnalyzer           — LLM infers assumptions
//   DesignPatternAnalyzer        — LLM detects GoF patterns (optional: keep as candidate generator)
//   ConsistencyAnalyzer          — LLM detects contradictions (better with context)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hybrid pipeline options.
 */
export const DEFAULT_HYBRID_OPTIONS = {
  /** Skill prompt template file (relative to prompts/ dir or absolute path) */
  skillPrompt: "07-report-writer.md",
  /** LLM model override. Default: free model via OpenCode CLI. */
  model: "opencode/deepseek-v4-flash-free",
  /** Output format: "markdown" (default) or "json" (structured) */
  outputFormat: "markdown",
  /** Repo name override (defaults to dir name) */
  repoName: null,
  /** Skip EvidenceSanitizer (debug only) */
  skipSanitizer: false,
  /** Extra variables to inject into prompt template */
  extraVars: {},
  /** Custom LLM CLI override (testing) */
  cli: null,
  /** If true, return both evidence brief and LLM output */
  returnEvidenceBrief: false,
};

/**
 * Run the Hybrid Pipeline on a repository.
 *
 * @param {string} repoPath — absolute path to repository
 * @param {Partial<typeof DEFAULT_HYBRID_OPTIONS>} [options]
 * @returns {Promise<string | { evidenceBrief: object, report: string }>}
 *   Resolves to the LLM-generated report string, or an object with both
 *   evidence brief and report if `returnEvidenceBrief` is true.
 */
export async function runHybridPipeline(repoPath, options = {}) {
  const opts = { ...DEFAULT_HYBRID_OPTIONS, ...options };

  // ── Step 1: Mechanical analysis ────────────────────────────────────────
  await loadOptionalPackages();
  await initTreeSitter();

  const ctx = new RepositoryContext(repoPath);
  // RepositoryContext is lazy — no initialize() needed, properties auto-populate on access

  // Import ANALYZERS dynamically and filter to Mechanical subset
  const { ANALYZERS } = await import("./pipeline.mjs");
  const mechanicalAnalyzers = ANALYZERS.filter((a) =>
    MECHANICAL_ANALYZER_NAMES.has(a.constructor.name)
  );

  // Run only Mechanical analyzers manually (skip semantic post-processing
  // like ResearchPlanner / QuestionGenerator / ReportGenerator that run
  // inside pipeline.runAll — those are LLM's job in Hybrid mode)
  const store = {};
  for (const analyzer of mechanicalAnalyzers) {
    if (!analyzer.supports(ctx)) {
      store[analyzer.id] = { skipped: true, reason: "not supported for this repository" };
      continue;
    }
    await analyzer.analyze(ctx, store, { command: analyzer.id });
  }

  // ── Step 2: Apply Evidence Sanitizer (mechanical correction) ───────────
  const sanitizer = new EvidenceSanitizer();
  const sanitizeResult = sanitizer.sanitize(store);
  if (sanitizeResult.corrected.length > 0) {
    store._sanitizerCorrections = sanitizeResult;
  }

  // Build archetype hints (signals only, no classification — LLM decides)
  const archetypeHints = buildArchetypeHints(store);
  store._archetypeHints = archetypeHints;

  // ── Step 3: Generate JSON Evidence Brief ───────────────────────────────
  const evidenceBrief = buildJSONEvidenceBrief(store, ctx, opts);

  // ── Step 4: Load Skill prompt template ─────────────────────────────────
  const promptPath = opts.skillPrompt.startsWith("/")
    ? opts.skillPrompt
    : join(__dirname, "prompts", opts.skillPrompt);
  let promptTemplate;
  try {
    promptTemplate = readFileSync(promptPath, "utf8");
  } catch {
    throw new Error(`Skill prompt not found: ${promptPath}`);
  }

  // ── Step 5: Render prompt with evidence brief ──────────────────────────
  const repoName = opts.repoName || basename(repoPath) || "unknown-repo";
  const renderedPrompt = renderPrompt(promptTemplate, {
    repoName,
    ...opts.extraVars,
  });

  // Compose final LLM input: rendered prompt + JSON evidence brief
  const llmInput = `DO NOT use any tools, file searches, shell commands, or external lookups.
All evidence required to write this report is provided in full below.
Read the Evidence Brief and write the final report directly.

${renderedPrompt}

---

## JSON Evidence Brief (Mechanical Truth)

The following is a structured evidence brief produced by Mechanical Analyzers
(AST / Graph / Metrics / Git facts). All semantic interpretation
(architecture pattern / responsibility / decisions / tradeoffs / report
narrative) is YOUR job as the LLM. Do not restate the brief — use it as
evidence and produce the final report.

\`\`\`json
${JSON.stringify(evidenceBrief, null, 2)}
\`\`\`
`;

  // ── Step 6: Invoke LLM via OpenCode/Copilot CLI ────────────────────────
  const llmOutput = opts.outputFormat === "json"
    ? await invokeLLMJSON(llmInput, { model: opts.model, cli: opts.cli })
    : await invokeLLM(llmInput, { model: opts.model, cli: opts.cli });

  // ── Step 7: Return ─────────────────────────────────────────────────────
  if (opts.returnEvidenceBrief) {
    return { evidenceBrief, report: llmOutput };
  }
  return llmOutput;
}

// ---------------------------------------------------------------------------
// JSON Evidence Brief builder
// ---------------------------------------------------------------------------

/**
 * Build a structured JSON Evidence Brief from the Mechanical Evidence Store.
 *
 * Design: this is pure Mechanical Truth — no interpretation, no ranking,
 * no narrative. Just facts that the LLM can use as evidence.
 *
 * Sections:
 *   - repository: name/path/fileCount/manifest
 *   - files: interesting file ranking (top N)
 *   - symbols: function/class counts + notable symbols
 *   - architecture: modules + edges (import graph)
 *   - entrypoints: detected entry points
 *   - prompts: discovered prompt templates
 *   - tools: discovered tool/function definitions
 *   - tests: test files + categorization
 *   - evaluations: eval/benchmark files
 *   - git: commit count + recent commits + change frequency
 *   - ci: CI/CD config
 *   - dependencySmell: cycles + layer violations + hub nodes
 *   - archMetrics: Fan-in/Fan-out/coupling density
 *   - temporal: git evolution events (rewrites/pivots)
 *   - archetypeHints: signals for LLM to classify archetype
 *
 * @param {EvidenceStore} store
 * @param {RepositoryContext} ctx
 * @param {object} opts
 * @returns {object}
 */
function buildJSONEvidenceBrief(store, ctx, opts) {
  const repoPath = ctx.repoPath;
  const brief = {
    _meta: {
      pipeline: "hybrid",
      generatedAt: new Date().toISOString(),
      repoPath: repoPath,
      analyzerCount: MECHANICAL_ANALYZER_NAMES.size,
      skippedSemanticAnalyzers: [
        "ArchitecturePatternAnalyzer",
        "ResponsibilityAnalyzer",
        "CapabilityOntologyAnalyzer",
        "DecisionAnalyzer",
        "ConstraintAnalyzer",
        "AssumptionAnalyzer",
        "DesignPatternAnalyzer",
        "ConsistencyAnalyzer",
      ],
      note: "Semantic analysis delegated to LLM. This brief contains Mechanical Truth only.",
    },
  };

  // Repository metadata
  if (store.discovery) {
    brief.repository = {
      name: basename(repoPath),
      path: repoPath,
      fileCount: store.discovery.fileCount || 0,
      languages: store.discovery.languages || {},
      manifest: store.discovery.manifest || null,
      directoryStructure: (store.discovery.directories || []).slice(0, 20),
    };
  }

  // File ranking (top 30 interesting files)
  if (store.ranking?.files) {
    brief.files = (store.ranking.files || []).slice(0, 30).map((f) => ({
      path: f.path || f.file,
      score: f.score,
      reason: f.reasons?.slice(0, 2) || [],
    }));
  }

  // Symbols (functions/classes/imports/calls)
  if (store.symbols) {
    const s = store.symbols;
    brief.symbols = {
      functionCount: (s.functions || []).length,
      classCount: (s.classes || []).length,
      totalImports: (s.imports || []).length,
      totalCalls: (s.calls || []).length,
      topFunctions: (s.functions || []).slice(0, 20).map((f) => ({
        name: f.name,
        file: f.file,
        line: f.line,
        params: (f.params || []).length,
      })),
      topClasses: (s.classes || []).slice(0, 15).map((c) => ({
        name: c.name,
        file: c.file,
        line: c.line,
        methodCount: (c.methods || []).length,
      })),
    };
  }

  // Architecture (module graph)
  if (store.architecture) {
    const arch = store.architecture;
    brief.architecture = {
      moduleCount: (arch.nodes || []).length,
      edgeCount: (arch.edges || []).length,
      topModules: (arch.nodes || []).slice(0, 20).map((n) => ({
        id: n.id || n.path,
        path: n.path,
        type: n.type,
        size: n.size || 0,
      })),
      topEdges: (arch.edges || []).slice(0, 50).map((e) => ({
        from: e.from || e.source,
        to: e.to || e.target,
        type: e.type || "imports",
      })),
    };
  }

  // Entrypoints
  if (store.entrypoints?.entrypoints) {
    brief.entrypoints = store.entrypoints.entrypoints.slice(0, 10).map((e) => ({
      path: e.path || e.file,
      type: e.type,
      reason: e.reason,
    }));
  }

  // Prompts
  if (store.prompts) {
    brief.prompts = {
      total: store.prompts.totalPrompts || 0,
      items: (store.prompts.prompts || []).slice(0, 15).map((p) => ({
        file: p.file,
        line: p.line,
        preview: (p.preview || p.text || "").slice(0, 200),
      })),
    };
  }

  // Tools
  if (store.tools) {
    brief.tools = {
      total: store.tools.totalTools || 0,
      items: (store.tools.tools || []).slice(0, 20).map((t) => ({
        name: t.name,
        file: t.file,
        line: t.line,
        framework: t.framework,
      })),
    };
  }

  // Tests
  if (store.tests) {
    brief.tests = {
      total: (store.tests.files || []).length,
      frameworks: store.tests.frameworks || [],
      files: (store.tests.files || []).slice(0, 15).map((t) => ({
        path: t.path || t.file,
        framework: t.framework,
        lines: t.lines || 0,
      })),
    };
  }

  // Evaluations
  if (store.evaluations) {
    brief.evaluations = {
      total: (store.evaluations.files || []).length,
      files: (store.evaluations.files || []).slice(0, 10).map((e) => ({
        path: e.path || e.file,
        type: e.type,
        metrics: e.metrics || [],
      })),
    };
  }

  // Git history
  if (store.git) {
    brief.git = {
      commitCount: store.git.commitCount || 0,
      authorCount: (store.git.authors || []).length,
      topAuthors: (store.git.authors || []).slice(0, 5),
      recentCommits: (store.git.commits || []).slice(0, 10).map((c) => ({
        hash: c.hash,
        author: c.author,
        date: c.date,
        message: (c.message || "").slice(0, 120),
      })),
      changeFrequency: store.git.changeFrequency || {},
    };
  }

  // CI/CD
  if (store.ci) {
    brief.ci = {
      platforms: store.ci.platforms || [],
      files: (store.ci.files || []).slice(0, 10),
    };
  }

  // Dependency smells (cycles, layer violations, hub nodes) — mechanical
  if (store.dependencySmell) {
    brief.dependencySmell = {
      smells: (store.dependencySmell.smells || []).slice(0, 20),
      summary: store.dependencySmell.summary || null,
    };
  }

  // Architecture metrics (Fan-in/Fan-out/coupling) — mechanical
  if (store.archMetrics) {
    brief.archMetrics = {
      summary: store.archMetrics.summary || null,
      hubNodes: (store.archMetrics.coupling?.hubNodes || []).slice(0, 10),
      bottleneckNodes: (store.archMetrics.coupling?.bottleneckNodes || []).slice(0, 10),
      couplingDensity: store.archMetrics.coupling?.density || 0,
    };
  }

  // Temporal evolution (git-driven events) — mechanical
  if (store.temporal && !store.temporal.skipped) {
    brief.temporal = {
      events: (store.temporal.events || []).slice(0, 10),
      summary: store.temporal.summary || null,
    };
  }

  // Archetype hints (signals only, LLM classifies)
  if (store._archetypeHints) {
    brief.archetypeHints = store._archetypeHints;
  }

  return brief;
}

// ---------------------------------------------------------------------------
// Utility: list mechanical / semantic analyzer names (for introspection)
// ---------------------------------------------------------------------------

export function listMechanicalAnalyzers() {
  return Array.from(MECHANICAL_ANALYZER_NAMES).sort();
}

export const SEMANTIC_ANALYZER_NAMES = [
  "ArchitecturePatternAnalyzer",
  "ResponsibilityAnalyzer",
  "CapabilityOntologyAnalyzer",
  "DecisionAnalyzer",
  "ConstraintAnalyzer",
  "AssumptionAnalyzer",
  "DesignPatternAnalyzer",
  "ConsistencyAnalyzer",
];

export function listSemanticAnalyzers() {
  return [...SEMANTIC_ANALYZER_NAMES].sort();
}
