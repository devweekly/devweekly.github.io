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

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { loadOptionalPackages, initTreeSitter } from "./utils.mjs";
import { RepositoryContext } from "./context.mjs";
import { EvidenceSanitizer, buildArchetypeHints } from "./evidence-quality.mjs";
import { invokeLLM, invokeLLMJSON, renderPrompt } from "./llm-runner.mjs";
import {
  validateKG,
  validateFindings,
  validateFingerprint,
  SCHEMA_VERSIONS,
} from "./schemas.mjs";

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

// ===========================================================================
// Pipeline v2: Document Discovery
//
// Not README Discovery — searches ADR > RFC > architecture.md > docs/design > README
// ===========================================================================

/** @type {[string, number][]} — [glob pattern, priority] */
const DOC_PATTERNS = [
  // Priority 1: ADR (Architecture Decision Records)
  ["adr", 1], ["docs/adr", 1], ["docs/decisions", 1],
  // Priority 2: RFC
  ["rfc", 2], ["docs/rfc", 2], ["rfcs", 2], ["docs/rfcs", 2],
  // Priority 3: Architecture docs
  ["architecture.md", 3], ["docs/architecture.md", 3], ["ARCHITECTURE.md", 3],
  ["docs/ARCHITECTURE.md", 3],
  // Priority 4: Design docs
  ["docs/design", 4],
  // Priority 5: README (lowest priority for architecture info)
  ["README.md", 5], ["docs/README.md", 5],
];

const MAX_DOC_CHARS = 2000;
const MAX_TOTAL_DOC_CHARS = 5000;

/**
 * Discover design documents in a repository by priority.
 * ADR > RFC > architecture.md > docs/design > README
 *
 * @param {string} repoPath
 * @returns {{ path: string, priority: number, content: string }[]}
 */
export function discoverDocuments(repoPath) {
  const results = [];

  for (const [pattern, priority] of DOC_PATTERNS) {
    const fullPath = join(repoPath, pattern);

    if (pattern.includes(".")) {
      // File pattern (e.g., "README.md", "architecture.md")
      if (existsSync(fullPath) && results.length < 10) {
        try {
          const content = readFileSync(fullPath, "utf-8").slice(0, MAX_DOC_CHARS);
          results.push({ path: pattern, priority, content });
        } catch { /* ignore read errors */ }
      }
    } else {
      // Directory pattern (e.g., "adr/", "docs/design/")
      if (existsSync(fullPath) && results.length < 10) {
        try {
          const entries = readdirSync(fullPath, { withFileTypes: true });
          const mdFiles = entries
            .filter((e) => e.isFile() && /\.(md|mdx|rst|txt)$/i.test(e.name))
            .sort()
            .slice(0, 3); // max 3 files per directory
          for (const f of mdFiles) {
            if (results.length >= 10) break;
            const fPath = join(pattern, f.name);
            try {
              const content = readFileSync(join(fullPath, f.name), "utf-8").slice(0, MAX_DOC_CHARS);
              results.push({ path: fPath, priority, content });
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }
  }

  // Sort by priority, then enforce total char limit
  results.sort((a, b) => a.priority - b.priority);
  let total = 0;
  const filtered = [];
  for (const doc of results) {
    if (total + doc.content.length > MAX_TOTAL_DOC_CHARS) {
      doc.content = doc.content.slice(0, MAX_TOTAL_DOC_CHARS - total);
    }
    filtered.push(doc);
    total += doc.content.length;
    if (total >= MAX_TOTAL_DOC_CHARS) break;
  }

  return filtered;
}

// ===========================================================================
// Pipeline v2: Stage Runners
// ===========================================================================

/**
 * Build a simplified evidence brief for LLM consumption.
 * Filters to only the sections relevant for the Modeling stage.
 */
function buildModelingInput(evidenceBrief) {
  return {
    repository: evidenceBrief.repository,
    architecture: evidenceBrief.architecture,
    symbols: evidenceBrief.symbols,
    entrypoints: evidenceBrief.entrypoints,
    git: evidenceBrief.git,
    archMetrics: evidenceBrief.archMetrics,
    dependencySmell: evidenceBrief.dependencySmell,
    temporal: evidenceBrief.temporal,
    archetypeHints: evidenceBrief.archetypeHints,
  };
}

/**
 * Stage 1: Knowledge Modeling — produce Knowledge Graph from mechanical evidence.
 *
 * Input: JSON Evidence Brief + Documents
 * Output: Knowledge Graph JSON (entities, relationships, metadata.evolution)
 * Constraint: NO intent inference, NO leverage, NO assessment
 *
 * @param {object} evidenceBrief
 * @param {{ path: string, priority: number, content: string }[]} documents
 * @param {object} opts — { model, cli }
 * @returns {Promise<object>} KnowledgeGraph
 */
export async function runModelingStage(evidenceBrief, documents, opts = {}) {
  const model = opts.model || "opencode/deepseek-v4-flash-free";
  const modelingInput = buildModelingInput(evidenceBrief);

  const promptPath = join(__dirname, "prompts", "01-modeling.md");
  let promptTemplate;
  try {
    promptTemplate = readFileSync(promptPath, "utf8");
  } catch {
    throw new Error(`Knowledge Modeling prompt not found: ${promptPath}`);
  }

  const docsSection = documents.length > 0
    ? `\n---\n## Discovered Documents\n\n${documents.map((d) =>
      `### ${d.path} (priority: ${d.priority})\n\n${d.content}`
    ).join("\n\n")}`
    : "\n---\n## Discovered Documents\n\n(No design documents found)";

  const llmInput = `DO NOT use any tools, file searches, shell commands, or external lookups.
All evidence required is provided below.

${promptTemplate}

---

## JSON Evidence Brief (Mechanical Truth)

\`\`\`json
${JSON.stringify(modelingInput, null, 2)}
\`\`\`
${docsSection}
`;

  const kg = await invokeLLMJSON(llmInput, { model, cli: opts.cli });

  // Quality Gate: validate KG
  const validation = validateKG(kg);
  if (!validation.ok) {
    console.error(`[modeling] KG validation failed:\n  ${validation.errors.join("\n  ")}`);
    throw new Error(`Knowledge Graph validation failed: ${validation.errors.join("; ")}`);
  }

  return kg;
}

/**
 * Stage 2: Interpretation — produce Semantic Findings from Knowledge Graph.
 *
 * Input: Knowledge Graph + Documents + Evidence Brief
 * Output: Semantic Findings JSON (unified Finding objects)
 * Constraint: All Findings must reference KG entities via entity_refs
 *
 * @param {object} knowledgeGraph
 * @param {{ path: string, priority: number, content: string }[]} documents
 * @param {object} evidenceBrief
 * @param {object} opts — { model, cli }
 * @returns {Promise<object>} SemanticFindings
 */
export async function runInterpretationStage(knowledgeGraph, documents, evidenceBrief, opts = {}) {
  const model = opts.model || "opencode/deepseek-v4-flash-free";

  const promptPath = join(__dirname, "prompts", "02-interpretation.md");
  let promptTemplate;
  try {
    promptTemplate = readFileSync(promptPath, "utf8");
  } catch {
    throw new Error(`Interpretation prompt not found: ${promptPath}`);
  }

  const docsSection = documents.length > 0
    ? `\n---\n## Discovered Documents\n\n${documents.map((d) =>
      `### ${d.path} (priority: ${d.priority})\n\n${d.content}`
    ).join("\n\n")}`
    : "";

  const llmInput = `DO NOT use any tools, file searches, shell commands, or external lookups.
All evidence required is provided below.

${promptTemplate}

---

## Knowledge Graph (verified facts from Modeling stage)

\`\`\`json
${JSON.stringify(knowledgeGraph, null, 2)}
\`\`\`

---

## Supporting Evidence Brief

\`\`\`json
${JSON.stringify(buildModelingInput(evidenceBrief), null, 2)}
\`\`\`
${docsSection}
`;

  const findings = await invokeLLMJSON(llmInput, { model, cli: opts.cli });

  // Quality Gate: validate Findings
  const validation = validateFindings(findings);
  if (!validation.ok) {
    console.error(`[interpretation] Findings validation failed:\n  ${validation.errors.join("\n  ")}`);
    throw new Error(`Semantic Findings validation failed: ${validation.errors.join("; ")}`);
  }

  return findings;
}

// ===========================================================================
// Pipeline v2: Repository Fingerprint (rule-based, no LLM)
// ===========================================================================

/**
 * Build Repository Fingerprint from KG + Findings using rules.
 * No LLM call — all fields are derived from structural data.
 *
 * @param {object} kg — Knowledge Graph
 * @param {object} findings — Semantic Findings
 * @param {object} evidenceBrief — Evidence Brief (for CI/test/manifest info)
 * @returns {object} RepositoryFingerprint
 */
export function buildFingerprint(kg, findings, evidenceBrief = {}) {
  const entityCount = kg?.entities?.length || 0;
  const relCount = kg?.relationships?.length || 0;
  const hasADR = (evidenceBrief.documents || []).some((d) => d.priority <= 1);
  const hasCI = (evidenceBrief.ci?.platforms || []).length > 0;
  const testCount = evidenceBrief.tests?.total || 0;
  const commitCount = evidenceBrief.git?.commitCount || 0;

  // Complexity: entity + relationship + depth
  const totalStructural = entityCount + relCount;
  const complexity =
    totalStructural > 50 ? "High" :
    totalStructural > 20 ? "Medium" : "Low";

  // Maturity: ADR + CI + tests + commits
  const maturity =
    hasADR && hasCI && testCount > 50 ? "Production" :
    hasCI && testCount > 10 ? "Early" :
    "Experimental";

  // Architecture: entity count + plugin signal
  const hasPluginDir = (evidenceBrief.repository?.directoryStructure || [])
    .some((d) => /plugin/i.test(typeof d === "string" ? d : d.name || ""));
  const architecture =
    entityCount > 8 ? "Capability-oriented" :
    hasPluginDir ? "Plugin" :
    entityCount > 3 ? "Layered" : "Monolith";

  // Style: language + symbol ratio
  const funcCount = evidenceBrief.symbols?.functionCount || 0;
  const classCount = evidenceBrief.symbols?.classCount || 0;
  const style =
    funcCount > classCount * 2 ? "Functional" :
    classCount > funcCount * 2 ? "OOP" : "Mixed";

  // Evolution: commit patterns
  const recentCommits = evidenceBrief.git?.recentCommits || [];
  const breakingCount = recentCommits.filter((c) =>
    /break|major|rewrite|refactor/i.test(c.message || "")
  ).length;
  const featCount = recentCommits.filter((c) =>
    /feat|add|new/i.test(c.message || "")
  ).length;
  const evolution =
    commitCount === 0 ? "Early" :
    breakingCount > recentCommits.length * 0.2 ? "Active Migration" :
    featCount > recentCommits.length * 0.5 ? "Active Development" :
    "Stable";

  // Domain: keyword matching from README/manifest
  const repoName = (evidenceBrief.repository?.name || "").toLowerCase();
  const manifestName = (evidenceBrief.repository?.manifest?.name || "").toLowerCase();
  const domainText = `${repoName} ${manifestName}`;
  const domain =
    /agent|coding|copilot|code-assist/.test(domainText) ? "Coding Agent" :
    /database|sql|query|storage/.test(domainText) ? "Database" :
    /compil|parser|lexer|codegen/.test(domainText) ? "Compiler" :
    /web|server|api|http/.test(domainText) ? "Application" :
    /sdk|library|client/.test(domainText) ? "Library/SDK" : "Application";

  // Engineering taste: from Findings (mental_model type)
  const mentalModelFinding = (findings?.findings || []).find(
    (f) => f.type === "mental_model"
  );
  let engineeringTaste = "Pragmatic"; // fallback
  if (mentalModelFinding?.attributes?.engineering_taste) {
    engineeringTaste = mentalModelFinding.attributes.engineering_taste;
  } else {
    // Infer from omissions
    const omissions = (findings?.findings || []).filter((f) => f.type === "omission");
    if (omissions.length >= 3) {
      engineeringTaste = "Minimalistic";
    } else if (classCount > 20 && entityCount > 10) {
      engineeringTaste = "Enterprise";
    }
  }

  const fingerprint = {
    version: SCHEMA_VERSIONS.fingerprint,
    style,
    architecture,
    evolution,
    domain,
    maturity,
    complexity,
    engineering_taste: engineeringTaste,
  };

  // Quality Gate
  const validation = validateFingerprint(fingerprint);
  if (!validation.ok) {
    console.warn(`[fingerprint] Validation warnings:\n  ${validation.errors.join("\n  ")}`);
  }

  return fingerprint;
}

// ===========================================================================
// Pipeline v2: Narrative Report Stage
// ===========================================================================

/**
 * Stage 4: Narrative Report — render KG + Findings + Fingerprint into Markdown.
 *
 * Input: Knowledge Graph + Semantic Findings + Repository Fingerprint + Evidence Brief
 * Output: Markdown report (12 sections)
 * Constraint: Report is a Renderer only — no new reasoning
 *
 * @param {object} kg
 * @param {object} findings
 * @param {object} fingerprint
 * @param {object} evidenceBrief
 * @param {object} opts
 * @returns {Promise<string>} Markdown report
 */
export async function runNarrativeStage(kg, findings, fingerprint, evidenceBrief, opts = {}) {
  const model = opts.model || "opencode/deepseek-v4-flash-free";

  const promptPath = join(__dirname, "prompts", "07-report-writer.md");
  let promptTemplate;
  try {
    promptTemplate = readFileSync(promptPath, "utf8");
  } catch {
    throw new Error(`Report prompt not found: ${promptPath}`);
  }

  const repoName = opts.repoName || evidenceBrief?.repository?.name || "unknown-repo";
  const renderedPrompt = renderPrompt(promptTemplate, { repoName });

  const llmInput = `DO NOT use any tools, file searches, shell commands, or external lookups.
All evidence required to write this report is provided in full below.

CRITICAL: Your response IS the report content itself. Output the full markdown report starting with "# Research Report — {repoName}".
Do NOT write a meta-description like "Report written to..." or "Here is the report...".
Do NOT describe what you did — WRITE the actual report content (all 12 sections + Quality Gate).

${renderedPrompt}

---

## Knowledge Graph (verified facts)

\`\`\`json
${JSON.stringify(kg, null, 2)}
\`\`\`

---

## Semantic Findings (interpreted evidence)

\`\`\`json
${JSON.stringify(findings, null, 2)}
\`\`\`

---

## Repository Fingerprint

\`\`\`json
${JSON.stringify(fingerprint, null, 2)}
\`\`\`

---

## Supporting Evidence Brief (mechanical facts)

\`\`\`json
${JSON.stringify(buildModelingInput(evidenceBrief), null, 2)}
\`\`\`
`;

  const report = await invokeLLM(llmInput, { model, cli: opts.cli });
  return report;
}

// ===========================================================================
// Pipeline v2: Full 4-stage orchestration
// ===========================================================================

/**
 * Run the v2 Pipeline (4 stages: Modeling → Interpretation → Fingerprint → Narrative).
 *
 * Stage 0: Mechanical Analyzers (existing)
 * Stage 1: Knowledge Modeling → KG (LLM call 1)
 * Stage 2: Interpretation → Findings (LLM call 2)
 * Stage 3: Fingerprint → buildFingerprint() (rule-based, no LLM)
 * Stage 4: Narrative Report (LLM call 3)
 *
 * @param {string} repoPath
 * @param {object} options — { model, cli, stage, repoName }
 * @returns {Promise<string | object>} report or intermediate stage output
 */
export async function runPipelineV2(repoPath, options = {}) {
  const opts = {
    model: "opencode/deepseek-v4-flash-free",
    cli: null,
    stage: "all",
    repoName: null,
    ...options,
  };

  // Stage 0: Mechanical analyzers (reuse existing infrastructure)
  await loadOptionalPackages();
  await initTreeSitter();

  const ctx = new RepositoryContext(repoPath);
  const { ANALYZERS } = await import("./pipeline.mjs");
  const mechanicalAnalyzers = ANALYZERS.filter((a) =>
    MECHANICAL_ANALYZER_NAMES.has(a.constructor.name)
  );

  const store = {};
  for (const analyzer of mechanicalAnalyzers) {
    if (!analyzer.supports(ctx)) {
      store[analyzer.id] = { skipped: true, reason: "not supported" };
      continue;
    }
    await analyzer.analyze(ctx, store, { command: analyzer.id });
  }

  // Sanitize + archetype hints
  const sanitizer = new EvidenceSanitizer();
  sanitizer.sanitize(store);
  store._archetypeHints = buildArchetypeHints(store);

  // Build evidence brief + discover documents
  const evidenceBrief = buildJSONEvidenceBrief(store, ctx, opts);
  const documents = discoverDocuments(repoPath);
  evidenceBrief.documents = documents;

  // Stage 1: Knowledge Modeling
  console.error(`[v2] Stage 1: Knowledge Modeling (LLM call 1)...`);
  const kg = await runModelingStage(evidenceBrief, documents, opts);
  console.error(`[v2] Stage 1 complete: ${kg.entities?.length || 0} entities, ${kg.relationships?.length || 0} relationships`);

  if (opts.stage === "modeling") return kg;

  // Stage 2: Interpretation
  console.error(`[v2] Stage 2: Interpretation (LLM call 2)...`);
  const findings = await runInterpretationStage(kg, documents, evidenceBrief, opts);
  console.error(`[v2] Stage 2 complete: ${findings.findings?.length || 0} findings`);

  if (opts.stage === "interpretation") return findings;

  // Stage 3: Fingerprint (rule-based, no LLM)
  console.error(`[v2] Stage 3: Fingerprint (rule-based)...`);
  const fingerprint = buildFingerprint(kg, findings, evidenceBrief);
  console.error(`[v2] Stage 3 complete: ${fingerprint.domain} / ${fingerprint.architecture} / ${fingerprint.complexity}`);

  if (opts.stage === "fingerprint") return fingerprint;

  // Stage 4: Narrative Report
  console.error(`[v2] Stage 4: Narrative Report (LLM call 3)...`);
  const report = await runNarrativeStage(kg, findings, fingerprint, evidenceBrief, opts);
  console.error(`[v2] Stage 4 complete: ${report.length} chars`);

  if (opts.returnAll) {
    return { kg, findings, fingerprint, report, evidenceBrief };
  }

  return report;
}
