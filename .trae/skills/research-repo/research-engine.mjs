// EvidenceStore is imported for type reference; the actual store data is
// passed as constructor arguments.

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  {
    id: "Q9",
    question: "What architecture decisions were made, and what are their tradeoffs?",
    category: "decision",
    importance: "critical",
    sources: ["decisions", "archPattern", "responsibility", "tools", "informationFlow", "tests"],
  },
  {
    id: "Q10",
    question: "What constraints drive these decisions (and which modules do they affect)?",
    category: "constraint",
    importance: "high",
    sources: ["constraints", "discovery", "tests", "archPattern", "entrypoints", "ci"],
  },
  {
    id: "Q11",
    question: "What implicit assumptions does the system depend on, and where would they break?",
    category: "assumption",
    importance: "high",
    sources: ["assumptions", "informationFlow", "tests", "responsibility", "capabilityOntology", "constraints"],
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
  inference: 0.08, // Inference engine output (Decision/Constraint/Assumption analyzers)
                   // Raised from 0.02 to 0.08: Architecture Knowledge Layer findings
                   // were being rejected (confidence < 0.02) due to too-low weight.
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
    // ── Claim Lifecycle (P2-①) ────────────────────────────────────────────
    // A Claim advances through: candidate → hypothesis → supported → verified
    // → decision → reusable_pattern. Each transition requires stronger evidence.
    //   candidate        — initial observation (no validation)
    //   hypothesis       — deemed worth investigating (plausible, not yet supported)
    //   supported        — has ≥1 supporting evidence item
    //   verified         — survived adversarial check (no counter evidence, or counter resolved)
    //   decision         — promoted from a verified Q9 finding (architectural decision)
    //   reusable_pattern — promoted from a verified Q1 finding (reusable architecture pattern)
    lifecycle: {
      type: "string",
      enum: ["candidate", "hypothesis", "supported", "verified", "decision", "reusable_pattern"],
    },
    lifecycleHistory: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          at: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    // ── Unknown Classification (P2-②) ─────────────────────────────────────
    // When a Finding reports "Unknown" / "not detected", classify WHY:
    //   need_reading             — analyzer scanned but didn't read deeply;
    //                              a human reading the source could resolve it.
    //   need_external_evidence   — repo alone can't resolve; need issues/PRs/
    //                              design docs/runtime data to verify.
    //   impossible_to_verify     — cannot be verified from any source
    //                              (e.g., team intentions, production behavior).
    unknownType: {
      type: "string",
      enum: ["need_reading", "need_external_evidence", "impossible_to_verify"],
    },
    unknownReason: { type: "string" },
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
      Q9: () => this._q9Decisions(),
      Q10: () => this._q10Constraints(),
      Q11: () => this._q11Assumptions(),
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

    // README-vs-code contradiction detection: scan README for capability claims
    // (SQL, Vectorized, Distributed, LLM, Agent, Plugin, etc.) and check whether
    // the corresponding archetype signal is true. Claimed-but-missing = contradiction.
    const readmeGaps = this._detectReadmeClaimGaps();
    findings.push(...readmeGaps);

    if (contradictions.length === 0 && warnings.length === 0 && readmeGaps.length === 0) {
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

  // Detect README claims that are NOT supported by code signals.
  // E.g., README says "Vectorized Execution engine" but hasSQL=false, hasAgent=false, etc.
  _detectReadmeClaimGaps() {
    const discovery = this.store.get("discovery") || {};
    const hints = this.store._archetypeHints || this.store.archetypeHints || this.store.get("_archetypeHints") || this.store.get("archetypeHints") || {};
    const signals = hints.signals || {};

    // discovery.allFiles is a string[] of relative paths; discovery.files may be undefined.
    const allFiles = discovery.allFiles || [];
    const readmeRel = allFiles.find((f) => {
      const name = String(f).toLowerCase();
      return name === "readme.md" || name.startsWith("readme.");
    });
    if (!readmeRel) return [];

    // Read README content from disk (FindingsGenerator runs after discovery, repoPath is available).
    const repoPath = discovery.repoPath;
    if (!repoPath) return [];
    let readmeText = "";
    try {
      readmeText = readFileSync(join(repoPath, readmeRel), "utf-8");
    } catch {
      return [];
    }
    if (!readmeText) return [];

    // Map README claim keywords → required signal
    const CLAIM_TO_SIGNAL = [
      { claim: /vectorized\s+execution/i, signal: "hasSQL", label: "Vectorized Execution" },
      { claim: /distributed\s+query\s+planner/i, signal: "hasSQL", label: "Distributed Query Planner" },
      { claim: /sql/i, signal: "hasSQL", label: "SQL" },
      { claim: /\bllm\b|large\s+language\s+model/i, signal: "hasLLM", label: "LLM Integration" },
      { claim: /\bai\s+agent\b|autonomous\s+agent/i, signal: "hasAgent", label: "AI Agent" },
      { claim: /\bplugin\b/i, signal: "hasPlugin", label: "Plugin" },
      { claim: /\bcompiler\b|lexer|parser/i, signal: "hasParser", label: "Compiler" },
    ];

    const findings = [];
    for (const { claim, signal, label } of CLAIM_TO_SIGNAL) {
      if (!claim.test(readmeText)) continue;
      const satisfied = signals[signal] === true;
      if (!satisfied) {
        findings.push({
          finding: `README claims "${label}" but code signals do not confirm it (${signal}=false). Treated as documentation-only claim until source evidence is found.`,
          confidence: this._conf(["regex", "inference"]),
          coverage: 0.6,
          support: [
            { source: "regex", ref: "README.md", detail: `README mentions "${label}"` },
            { source: "inference", ref: `_archetypeHints.signals.${signal}`, detail: `${signal}=false` },
          ],
          counter: [],
          limitations: ["README claim may be aspirational, planned, or in a module the analyzer did not scan."],
          checkedLocations: ["README.md", `_archetypeHints.signals.${signal}`],
        });
      }
    }
    return findings;
  }

  // ── Q9: Architecture decisions ────────────────────────────────────────
  _q9Decisions() {
    const da = this.store.get("decisions") || {};
    const findings = [];
    const decisions = da.decisions || [];
    if (decisions.length === 0) {
      findings.push({
        finding: "No architecture decisions extracted (DecisionAnalyzer produced 0 decisions).",
        confidence: this._conf(["inference"]) * 0.5,
        coverage: 0,
        support: [],
        counter: [],
        limitations: ["DecisionAnalyzer infers decisions from analyzer outputs; repos with implicit/unconventional patterns may yield nothing."],
        checkedLocations: ["archPattern", "responsibility", "tools", "informationFlow", "tests", "capabilityOntology"],
      });
      return findings;
    }
    // Top 3 decisions (by confidence)
    const top = [...decisions].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 3);
    for (const d of top) {
      findings.push({
        finding: `Decision ${d.id}: ${d.decision} (category=${d.category}, confidence=${(d.confidence || 0).toFixed(2)}). Benefit: ${d.benefit}. Tradeoff: ${d.tradeoff}.`,
        confidence: this._conf(["inference"]) * (d.confidence || 0.5),
        coverage: Math.min(1, (d.evidence || []).length / 3),
        support: (d.evidence || []).slice(0, 3).map((e) => ({ source: "inference", ref: `decisions.${d.id}.evidence`, detail: String(e).slice(0, 100) })),
        counter: [],
        limitations: [
          `Alternative considered: ${d.alternatives || "n/a"}`,
          "Decision rationale is inferred from code shape, not from ADR docs",
        ],
        checkedLocations: ["decisions.decisions[] (DecisionAnalyzer output)"],
      });
    }
    // Negative decisions summary
    const negative = decisions.filter((d) => d.category === "negative");
    if (negative.length > 0) {
      findings.push({
        finding: `${negative.length} negative decision(s) detected — capabilities deliberately omitted: ${negative.map((d) => d.decision.replace(/Deliberately omit/, "").replace(/capability.*/, "").trim()).join("; ")}.`,
        confidence: this._conf(["inference"]) * 0.5,
        coverage: 0.4,
        support: negative.map((d) => ({ source: "inference", ref: `decisions.${d.id}`, detail: d.decision })),
        counter: [],
        limitations: ["Negative decisions are inferred from absence; the capability may be under-development rather than deliberately omitted."],
        checkedLocations: ["capabilityOntology.capabilityMatrix (missing/n/a entries)"],
      });
    }
    return findings;
  }

  // ── Q10: Constraints ──────────────────────────────────────────────────
  _q10Constraints() {
    const ca = this.store.get("constraints") || {};
    const findings = [];
    const constraints = ca.constraints || [];
    if (constraints.length === 0) {
      findings.push({
        finding: "No constraints extracted (ConstraintAnalyzer produced 0 constraints).",
        confidence: this._conf(["inference"]) * 0.5,
        coverage: 0,
        support: [],
        counter: [],
        limitations: ["ConstraintAnalyzer infers constraints from dependencies, test patterns, entry points, and CI; repos with implicit constraints may yield nothing."],
        checkedLocations: ["discovery.manifest.dependencies", "tests.testPatterns", "entrypoints", "archPattern", "ci"],
      });
      return findings;
    }
    // Group by source
    const bySource = {};
    for (const c of constraints) (bySource[c.source] = bySource[c.source] || []).push(c);
    for (const [source, items] of Object.entries(bySource)) {
      const top = items.slice(0, 2);
      for (const c of top) {
        findings.push({
          finding: `Constraint ${c.id} (${source}): ${c.constraint}. Drives: ${(c.drivesDecisions || []).slice(0, 2).join("; ") || "n/a"}. Affects: ${(c.affectedModules || []).slice(0, 3).join(", ") || "n/a"}.`,
          confidence: this._conf(["inference"]) * (c.confidence || 0.7),
          coverage: Math.min(1, (c.affectedModules || []).length / 3),
          support: (c.evidence || []).slice(0, 2).map((e) => ({ source: "inference", ref: `constraints.${c.id}.evidence`, detail: String(e).slice(0, 100) })),
          counter: [],
          limitations: ["Constraint is inferred from dependency/test/pattern, not from explicit README statement."],
          checkedLocations: [`constraints.constraints[] (source=${source})`],
        });
      }
    }
    return findings;
  }

  // ── Q11: Assumptions ──────────────────────────────────────────────────
  _q11Assumptions() {
    const aa = this.store.get("assumptions") || {};
    const findings = [];
    const assumptions = aa.assumptions || [];
    if (assumptions.length === 0) {
      findings.push({
        finding: "No assumptions extracted (AssumptionAnalyzer produced 0 assumptions).",
        confidence: this._conf(["inference"]) * 0.5,
        coverage: 0,
        support: [],
        counter: [],
        limitations: ["AssumptionAnalyzer infers assumptions from absence (no retry → assumes availability); inherently uncertain."],
        checkedLocations: ["informationFlow.llmCallSites", "tests.testPatterns", "discovery.manifest", "responsibility", "capabilityOntology"],
      });
      return findings;
    }
    // High-risk assumptions first
    const sorted = [...assumptions].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.risk] - order[b.risk];
    });
    for (const a of sorted.slice(0, 4)) {
      findings.push({
        finding: `Assumption ${a.id} (risk=${a.risk}): ${a.assumption}. Broken if: ${a.brokenIf}.`,
        confidence: this._conf(["inference"]) * (a.confidence || 0.6),
        coverage: 0.5,
        support: (a.evidence || []).slice(0, 2).map((e) => ({ source: "inference", ref: `assumptions.${a.id}.evidence`, detail: String(e).slice(0, 100) })),
        counter: [],
        limitations: [
          "Assumption inferred from absence of evidence (e.g., no retry symbol → assumes availability)",
          "Risk level is heuristic, not domain-calibrated",
        ],
        checkedLocations: ["assumptions.assumptions[] (AssumptionAnalyzer output)"],
      });
    }
    // High-risk summary
    const highRisk = assumptions.filter((a) => a.risk === "high");
    if (highRisk.length > 0) {
      findings.push({
        finding: `${highRisk.length} high-risk assumption(s) detected. These are the most likely failure modes under unexpected conditions.`,
        confidence: this._conf(["inference"]) * 0.7,
        coverage: 0.6,
        support: highRisk.slice(0, 3).map((a) => ({ source: "inference", ref: `assumptions.${a.id}`, detail: a.assumption.slice(0, 80) })),
        counter: [],
        limitations: ["High-risk classification is heuristic; domain-specific calibration needed."],
        checkedLocations: ["assumptions.assumptions[] (risk=high)"],
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
    // Evidence Provenance: inject who/when into each support item.
    // `who` = analyzer id inferred from ref prefix (e.g., "discovery.manifest" → "discovery")
    // `when` = current HEAD commit hash (from GitAnalyzer output)
    const gitData = this.store.get("git") || {};
    const commitHash = gitData.lastCommit?.hash || null;
    const commitDate = gitData.lastCommit?.date || null;
    const support = (f.support || []).map((s) => ({
      ...s,
      who: s.who || (s.ref ? String(s.ref).split(".")[0] : s.source || "unknown"),
      when: s.when || commitHash,
    }));
    // Claim Lifecycle (P2-①): initial state = candidate.
    // VerificationLoop will advance through hypothesis → supported → verified
    // → decision / reusable_pattern based on evidence and verification.
    const hasSupport = support.length > 0;
    const initialLifecycle = hasSupport ? "supported" : "candidate";
    // Unknown Classification (P2-②): if this is a negative finding, classify WHY.
    const isUnknown = this._isUnknownFinding(f, hasSupport);
    const unknownClassification = isUnknown ? this._classifyUnknown(q, f) : null;
    return {
      id: `F-${String(this.findingCounter).padStart(3, "0")}`,
      questionId: q.id,
      question: q.question,
      finding: f.finding,
      confidence: Number((f.confidence || 0).toFixed(2)),
      importance: f.importance || q.importance,
      coverage: Number((f.coverage || 0).toFixed(2)),
      support,
      counter: f.counter || [],
      limitations: f.limitations || [],
      checkedLocations: f.checkedLocations || [],
      verified: "pending",
      verificationNote: "",
      lifecycle: initialLifecycle,
      lifecycleHistory: [
        { from: null, to: initialLifecycle, at: new Date().toISOString(), reason: "Initial state from FindingsGenerator" },
      ],
      unknownType: unknownClassification?.type || null,
      unknownReason: unknownClassification?.reason || "",
      // Provenance for the Finding as a whole
      provenance: {
        generatedBy: "FindingsGenerator",
        commitHash,
        commitDate,
      },
    };
  }

  /**
   * Detect whether a Finding is reporting an Unknown / not-detected result.
   * Such findings either explicitly say "Unknown" / "not detected", or have
   * no support and list checkedLocations (negative finding).
   */
  _isUnknownFinding(f, hasSupport) {
    const text = (f.finding || "").toLowerCase();
    if (/\bunknown\b|not detected|no\s+\w+\s+detected|not classified|no recognizable/.test(text)) {
      return true;
    }
    // Negative finding: searched but found nothing
    if (!hasSupport && (f.checkedLocations || []).length > 0) return true;
    return false;
  }

  /**
   * Classify an Unknown Finding into one of three categories (P2-②):
   *   need_reading             — code-internal question; a human reading source can resolve.
   *   need_external_evidence   — repo alone insufficient; need issues/PRs/docs/runtime.
   *   impossible_to_verify     — cannot be verified from any source (intentions, runtime behavior).
   *
   * Classification is driven by Research Question semantics:
   *   Q1-Q6 (code-discoverable) → need_reading
   *   Q7 (correctness/tests)    → need_external_evidence (tests are partial; runtime needed)
   *   Q8 (README contradictions) → need_external_evidence (need issue tracker / docs)
   *   Q9 (decisions)            → impossible_to_verify (intentions live in ADRs / discussions)
   *   Q10 (constraints)         → need_external_evidence (constraints often in config / external)
   *   Q11 (assumptions)         → impossible_to_verify (implicit beliefs, not verifiable)
   */
  _classifyUnknown(q, f) {
    const id = q.id;
    const questionCategory = q.category || "";
    // Map by question ID
    const BY_QUESTION = {
      Q1: { type: "need_reading", reason: "Architecture pattern detection is heuristic; reading source code can confirm or refute." },
      Q2: { type: "need_reading", reason: "Orchestration logic is in source code; reading call chains can resolve." },
      Q3: { type: "need_reading", reason: "Retrieval/RAG implementation is code-internal; reading source can resolve." },
      Q4: { type: "need_reading", reason: "Prompt management is code-internal; reading source can resolve." },
      Q5: { type: "need_reading", reason: "Tool registry is code-internal; reading source can resolve." },
      Q6: { type: "need_reading", reason: "AI project signals are in source code; reading source can resolve." },
      Q7: { type: "need_external_evidence", reason: "Correctness assurance requires tests AND runtime/production evidence; repo alone is insufficient." },
      Q8: { type: "need_external_evidence", reason: "README claims often require issue tracker / design docs / changelog to verify." },
      Q9: { type: "impossible_to_verify", reason: "Architectural decisions live in ADRs / team discussions / PRs; not always recoverable from code." },
      Q10: { type: "need_external_evidence", reason: "Constraints (performance, compliance, deployment) often external to the codebase." },
      Q11: { type: "impossible_to_verify", reason: "Assumptions are implicit beliefs; cannot be verified without team interviews or design docs." },
    };
    return BY_QUESTION[id] || {
      type: "need_reading",
      reason: `Unknown finding for ${id} (${questionCategory}); defaulting to need_reading.`,
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
    const promoted = this._promoteLifecycle(verified);
    const summary = this._summary(promoted);
    return {
      ...this.findingsOutput,
      findings: promoted,
      verificationSummary: summary,
    };
  }

  /**
   * Promote verified Findings to terminal lifecycle states:
   *   - Q9 (Decisions) verified Findings → lifecycle = "decision"
   *   - Q1 (Entry Shape / Architecture) verified Findings that mention a
   *     recognized pattern → lifecycle = "reusable_pattern"
   *
   * Monotonicity: only verified Findings advance; downgraded/rejected stay.
   */
  _promoteLifecycle(findings) {
    const patternKeywords = [
      "monorepo", "layered", "microservice", "event-driven", "plugin",
      "pipeline", "actor", "dataflow", "registry", "plugin-based",
      "middleware", "interpreter", "compiler", "repository",
    ];
    return findings.map((f) => {
      if (f.lifecycle !== "verified") return f;
      const questionId = f.questionId;
      const findingText = (f.finding || "").toLowerCase();
      const reason = `Promoted from verified (questionId=${questionId})`;

      if (questionId === "Q9") {
        return {
          ...f,
          lifecycle: "decision",
          lifecycleHistory: [
            ...f.lifecycleHistory,
            { from: "verified", to: "decision", at: new Date().toISOString(), reason },
          ],
        };
      }
      if (questionId === "Q1" && patternKeywords.some((k) => findingText.includes(k))) {
        return {
          ...f,
          lifecycle: "reusable_pattern",
          lifecycleHistory: [
            ...f.lifecycleHistory,
            { from: "verified", to: "reusable_pattern", at: new Date().toISOString(), reason },
          ],
        };
      }
      return f;
    });
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
      // Match by topic keywords (not questionId, which never matches natural language topics)
      // Extract key terms from topic and check if they appear in finding text
      const topicTerms = topic.split(/\s+/).filter(t => t.length > 3); // Skip short words
      const hasTopicMatch = topicTerms.some(term => findingText.includes(term));
      // Also check if finding's question category matches contradiction topic
      const questionCategory = finding.questionId.toLowerCase(); // e.g., "q1", "q2"
      const topicMatchesQuestion = topic.includes(questionCategory);
      return hasTopicMatch || topicMatchesQuestion;
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
    // BUT: Do NOT override V2's "rejected" status (low confidence + counter evidence).
    if (verifiedStatus !== "rejected" && finding.support.length === 0 && finding.checkedLocations.length > 0 && counters.length === 0) {
      verifiedStatus = "verified";
      note = "Negative finding (searched, found nothing) — verified by absence";
    }

    // ── Claim Lifecycle advancement (P2-①) ────────────────────────────────
    // Transition rules (monotonic — lifecycle only advances, never regresses):
    //   candidate → supported  : when finding gains support (handled in _finalize)
    //   candidate → hypothesis : when finding has no support but is plausible (negative finding)
    //   supported → verified   : when verifiedStatus = "verified" (survived adversarial check)
    //   supported → supported  : when verifiedStatus = "downgraded" (still supported but disputed)
    //   candidate → candidate  : when verifiedStatus = "rejected" (lifecycle doesn't advance)
    //   verified  → decision / reusable_pattern : handled in _promoteLifecycle (post-verify step)
    const prevLifecycle = finding.lifecycle || "candidate";
    let nextLifecycle = prevLifecycle;
    const lifecycleReason = `verified=${verifiedStatus}`;

    if (verifiedStatus === "rejected") {
      // Lifecycle doesn't advance — claim stays at candidate
      nextLifecycle = "candidate";
    } else if (verifiedStatus === "verified") {
      // Adversarial check passed → advance to verified
      // (covers both "supported → verified" and "candidate → verified" for negative findings)
      nextLifecycle = "verified";
    } else if (verifiedStatus === "downgraded") {
      // Has counter evidence but still publishable → stays at supported
      nextLifecycle = prevLifecycle === "candidate" ? "supported" : prevLifecycle;
    } else if (verifiedStatus === "pending") {
      // Not yet verified — if it has support, it's "supported"; otherwise "hypothesis"
      nextLifecycle = finding.support && finding.support.length > 0 ? "supported" : "hypothesis";
    }

    const lifecycleHistory = [...(finding.lifecycleHistory || [])];
    if (nextLifecycle !== prevLifecycle) {
      lifecycleHistory.push({
        from: prevLifecycle,
        to: nextLifecycle,
        at: new Date().toISOString(),
        reason: lifecycleReason,
      });
    }

    return {
      ...finding,
      counter: counters,
      verified: verifiedStatus,
      verificationNote: note,
      confidence: downgraded
        ? Number((finding.confidence * 0.6).toFixed(2))
        : finding.confidence,
      lifecycle: nextLifecycle,
      lifecycleHistory,
    };
  }

  _summary(findings) {
    const status = { verified: 0, downgraded: 0, rejected: 0, pending: 0 };
    for (const f of findings) status[f.verified] = (status[f.verified] || 0) + 1;
    const lifecycleCounts = {
      candidate: 0,
      hypothesis: 0,
      supported: 0,
      verified: 0,
      decision: 0,
      reusable_pattern: 0,
    };
    for (const f of findings) {
      const lc = f.lifecycle || "candidate";
      lifecycleCounts[lc] = (lifecycleCounts[lc] || 0) + 1;
    }
    // Unknown Classification counts (P2-②)
    const unknownTypeCounts = {
      need_reading: 0,
      need_external_evidence: 0,
      impossible_to_verify: 0,
    };
    for (const f of findings) {
      if (f.unknownType) unknownTypeCounts[f.unknownType] = (unknownTypeCounts[f.unknownType] || 0) + 1;
    }
    return {
      total: findings.length,
      ...status,
      counterEvidenceFound: findings.filter((f) => f.counter.length > 0).length,
      averageConfidenceAfterVerification: findings.length > 0
        ? Number((findings.reduce((s, f) => s + f.confidence, 0) / findings.length).toFixed(2))
        : 0,
      lifecycle: lifecycleCounts,
      unknownTypes: unknownTypeCounts,
    };
  }
}

// ===========================================================================
// Evidence Synthesizer — converts raw Findings into Question Resolutions
// ===========================================================================

/**
 * EvidenceSynthesizer solves the core pipeline design problem identified in
 * 2026-07-26 audit: the report was Finding-centric, not Question-centric.
 *
 * Raw Findings come from 11+ analyzers. They often conflict (e.g.,
 * InformationFlow says "no LLM path" while Prompts/LLM-call-sites say "yes").
 * Without synthesis, the LLM receives a pile of Finding A says X / Finding B
 * says not-X and ends up narrating analyzer disagreements instead of
 * repository facts.
 *
 * EvidenceSynthesizer produces a Question Resolution Table:
 *
 *   Research Question
 *        ↓
 *   Evidence Collection (source code + analyzer outputs)
 *        ↓
 *   Conflict Detection (known cross-analyzer contradictions)
 *        ↓
 *   Verdict (yes / no / partial / unknown)
 *        ↓
 *   Conclusion (repository reality + which analyzer to trust / why)
 *
 * The LLM prompt is then instructed to consume the Resolution Table as the
 * primary input for report sections, and to cite Resolution IDs ([R-XXX])
 * instead of raw Finding IDs when stating architecture conclusions.
 *
 * Design principles:
 *   - Source code wins over analyzer heuristics.
 *   - AST/graph wins over regex/keyword.
 *   - A known-conflict pattern has a deterministic resolution rule.
 *   - The LLM no longer has to "mediate" analyzer debates.
 */
class EvidenceSynthesizer {
  /**
   * @param {object} verifiedFindings - Output of VerificationLoop.run()
   * @param {EvidenceStore} evidenceStore
   */
  constructor(verifiedFindings, evidenceStore) {
    this.findings = (verifiedFindings && verifiedFindings.findings) || [];
    this.findingsOutput = verifiedFindings || {};
    this.store = evidenceStore;
    this.s = evidenceStore && evidenceStore._store ? evidenceStore._store : {};
    this.lang = "en";
    this._counter = 0;
  }

  generate(options = {}) {
    this.lang = options.lang === "zh" ? "zh" : "en";
    const resolutions = [];

    // Q1 — Entry shape
    resolutions.push(this._resolveQ1Entry());
    // Q2 — Orchestration / architecture pattern
    resolutions.push(this._resolveQ2Orchestration());
    // Q3 — Retrieval
    resolutions.push(this._resolveQ3Retrieval());
    // Q4 — Prompt management
    resolutions.push(this._resolveQ4Prompts());
    // Q5 — Tool registry
    resolutions.push(this._resolveQ5Tools());
    // Q6 — Is this an AI project?
    resolutions.push(this._resolveQ6AiProject());
    // Q7 — Correctness validation
    resolutions.push(this._resolveQ7Correctness());
    // Q8 — README contradictions
    resolutions.push(this._resolveQ8Contradictions());
    // Q9-Q11 — Decisions / Constraints / Assumptions (pass-through, but structured)
    resolutions.push(this._resolveQ9Decisions());
    resolutions.push(this._resolveQ10Constraints());
    resolutions.push(this._resolveQ11Assumptions());

    const valid = resolutions.filter(Boolean);
    return {
      schema: "synthesis-v1",
      generatedAt: new Date().toISOString(),
      total: valid.length,
      evidenceHierarchy: [
        "source_code",
        "ast",
        "graph",
        "manifest",
        "regex",
        "keyword",
        "inference",
      ],
      resolutions: valid,
    };
  }

  // -- Helpers ---------------------------------------------------------------

  _id() {
    this._counter += 1;
    return `R-${String(this._counter).padStart(3, "0")}`;
  }

  _byQ(qid) {
    return this.findings.filter((f) => f.questionId === qid);
  }

  _textMatches(f, kw) {
    if (!f || !f.finding) return false;
    const text = f.finding.toLowerCase();
    if (Array.isArray(kw)) return kw.some((k) => text.includes(k.toLowerCase()));
    return text.includes(kw.toLowerCase());
  }

  _supportSources(f) {
    if (!f || !f.support) return [];
    return f.support.map((s) => s.source || s.ref || "unknown");
  }

  _evidenceType(f) {
    const sources = this._supportSources(f);
    if (sources.some((s) => s.includes("source") || s.includes("locator"))) return "source_code";
    if (sources.some((s) => s.includes("ast"))) return "ast";
    if (sources.some((s) => s.includes("graph"))) return "graph";
    if (sources.some((s) => s.includes("manifest"))) return "manifest";
    if (sources.some((s) => s.includes("regex"))) return "regex";
    if (sources.some((s) => s.includes("keyword"))) return "keyword";
    return "inference";
  }

  _zh(t) {
    return this.lang === "zh";
  }

  _label(verdict) {
    const map = {
      yes: this._zh() ? "是 / 存在" : "Yes / Present",
      no: this._zh() ? "否 / 不存在" : "No / Absent",
      partial: this._zh() ? "部分存在" : "Partial",
      unknown: this._zh() ? "未知" : "Unknown",
    };
    return map[verdict] || verdict;
  }

  _confidenceLabel(level) {
    if (this._zh()) {
      return level === "High" ? "高" : level === "Medium" ? "中" : level === "Low" ? "低" : "推测";
    }
    return level;
  }

  // -- Resolvers ---------------------------------------------------------------

  _resolveQ1Entry() {
    const fs = this._byQ("Q1");
    const f = fs.find((f) => f.verified !== "rejected" && f.finding && f.finding.includes("entry points"));
    if (!f) {
      return this._makeResolution("Q1", "unknown", "Low", "No reliable entry point Finding was verified.");
    }
    return this._makeResolution(
      "Q1",
      "yes",
      this._levelFromFinding(f),
      f.finding,
      f,
      [],
      []
    );
  }

  _resolveQ2Orchestration() {
    const fs = this._byQ("Q2");
    const patternF = fs.find((f) => f.finding && f.finding.includes("Primary architecture pattern"));
    const flowF = fs.find((f) => f.finding && f.finding.includes("Information flow analyzer detected"));

    // Conflict: pattern says X but flow analyzer says no path.
    const conflicts = [];
    if (patternF && flowF) {
      const patternName = (patternF.finding.match(/\*\*(\w+)\*\*/) || [])[1] || "";
      const hasFlow = !flowF.finding.includes("none reach") && !flowF.finding.includes("no end-to-end");
      if (patternName && !hasFlow && this._textMatches(flowF, ["LLM", "llm"])) {
        conflicts.push({
          type: "flow_false_negative",
          description: this._zh()
            ? `ArchitecturePattern 判断为 ${patternName}，但 InformationFlow 未检测到到达 LLM 调用点的路径。`
            : `ArchitecturePattern says ${patternName}, but InformationFlow reports no path reaches an LLM call site.`,
        });
      }
    }

    const verdict = patternF && patternF.verified !== "rejected" ? "yes" : "unknown";
    const conclusion = this._buildQ2Conclusion(patternF, flowF, conflicts);
    return this._makeResolution("Q2", verdict, this._levelFromFinding(patternF), conclusion, patternF, conflicts, [patternF, flowF].filter(Boolean));
  }

  _resolveQ3Retrieval() {
    return this._singleFindingResolution("Q3", "Retrieval capability");
  }

  _resolveQ4Prompts() {
    return this._singleFindingResolution("Q4", "prompt");
  }

  _resolveQ5Tools() {
    return this._singleFindingResolution("Q5", "tool");
  }

  _resolveQ6AiProject() {
    const fs = this._byQ("Q6");
    const aiF = fs.find((f) => f.finding && f.finding.includes("AI project"));
    const toolF = this._byQ("Q5").find((f) => f.verified !== "rejected" && f.finding && /detected \d+ tool/i.test(f.finding));
    const promptF = this._byQ("Q4").find((f) => f.verified !== "rejected" && f.finding && /detected \d+ prompt/i.test(f.finding));

    // Determine whether the finding affirms or denies AI-project status.
    // CapabilityOntology may emit "Not classified as AI project..." which
    // contains the substring "AI project" but is a NEGATIVE verdict.
    const isNegativeAiFinding = (f) => {
      if (!f || !f.finding) return false;
      const text = f.finding.toLowerCase();
      return text.includes("not classified") ||
        text.includes("not an ai") ||
        text.includes("non-ai") ||
        text.includes("insufficient ai signals") ||
        text.includes("no ai signals") ||
        text.includes("false negative for ai") ||
        /\bno\b.*\bai\b.*\bsignals?\b/.test(text);
    };
    const aiConfirmed = aiF && aiF.verified !== "rejected" && !isNegativeAiFinding(aiF);

    const conflicts = [];
    const llmFlowF = this._byQ("Q2").find((f) => f.finding && f.finding.includes("Information flow analyzer detected") && f.finding.includes("LLM"));

    if (aiConfirmed && llmFlowF && llmFlowF.finding && llmFlowF.finding.includes("none reach")) {
      conflicts.push({
        type: "ai_without_reachable_flow",
        description: this._zh()
          ? "CapabilityOntology 确认是 AI 项目，但 InformationFlow BFS 无法到达任何 LLM 调用点。这是典型 false negative：LLM 调用发生在动态 SDK 方法链、子进程或框架运行时路由中，静态 import 图不可见。"
          : "CapabilityOntology confirms AI project, but InformationFlow BFS cannot reach any LLM call site. This is a typical false negative: LLM calls happen via dynamic SDK method chains, spawned subprocesses, or framework runtime routing invisible to static import graph.",
        resolution: this._zh()
          ? "以源码和 CapabilityOntology 为准；InformationFlow 的 'none reach' 在此场景下是能力限制，不是反证。"
          : "Source code and CapabilityOntology take precedence; InformationFlow 'none reach' is a capability limit, not counter-evidence.",
      });
    }

    if (aiConfirmed && promptF && promptF.finding && promptF.finding.toLowerCase().includes("no prompts detected")) {
      conflicts.push({
        type: "prompt_analyzer_false_negative",
        description: this._zh()
          ? "AI 项目被确认，但 PromptsAnalyzer 报告未检测到任何 prompt。常见原因是 prompt 在函数返回值中动态组装（如 build_*_prompt），而不是常量赋值。"
          : "AI project confirmed, but PromptsAnalyzer reports no prompts detected. Common cause: prompts are dynamically assembled in function return values (e.g., build_*_prompt) rather than constant assignments.",
        resolution: this._zh()
          ? "将 PromptsAnalyzer 的 'No prompts' 视为潜在漏报，需人工检查 build_*_prompt / render_*_prompt 函数。"
          : "Treat PromptsAnalyzer 'No prompts' as a potential false negative; inspect build_*_prompt / render_*_prompt functions manually.",
      });
    }

    const verdict = aiConfirmed ? "yes" : aiF && aiF.verified !== "rejected" ? "no" : "unknown";
    const confidenceF = aiF || toolF;
    const conclusion = this._buildQ6Conclusion(aiF, toolF, promptF, conflicts, aiConfirmed);
    return this._makeResolution("Q6", verdict, this._levelFromFinding(confidenceF), conclusion, aiF, conflicts, [aiF, toolF, promptF, llmFlowF].filter(Boolean));
  }

  _resolveQ7Correctness() {
    return this._singleFindingResolution("Q7", "test");
  }

  _resolveQ8Contradictions() {
    const cons = this.s.consistency || {};
    const contradictions = cons.contradictions || [];
    const warnings = cons.warnings || [];
    const verdict = contradictions.length > 0 ? "yes" : warnings.length > 0 ? "partial" : "no";
    const conclusion = this._zh()
      ? (contradictions.length > 0
          ? `检测到 ${contradictions.length} 个跨分析器矛盾，${warnings.length} 个警告。`
          : warnings.length > 0
            ? `无严重矛盾，但有 ${warnings.length} 个警告。`
            : "未发现跨分析器矛盾或警告。")
      : (contradictions.length > 0
          ? `Detected ${contradictions.length} cross-analyzer contradiction(s) and ${warnings.length} warning(s).`
          : warnings.length > 0
            ? `No severe contradictions, but ${warnings.length} warning(s) found.`
            : "No cross-analyzer contradictions or warnings detected.");
    return this._makeResolution(
      "Q8",
      verdict,
      contradictions.length > 0 ? "High" : warnings.length > 0 ? "Medium" : "Medium",
      conclusion,
      null,
      contradictions.map((c) => ({
        type: c.id || "generic",
        description: c.interpretation || c.topic || "",
      })),
      []
    );
  }

  _resolveQ9Decisions() {
    return this._architectureKnowledgeResolution("Q9", "decisions", "decision");
  }

  _resolveQ10Constraints() {
    return this._architectureKnowledgeResolution("Q10", "constraints", "constraint");
  }

  _resolveQ11Assumptions() {
    return this._architectureKnowledgeResolution("Q11", "assumptions", "assumption");
  }

  // -- Generic helpers --------------------------------------------------------

  _singleFindingResolution(qid, keyword) {
    const fs = this._byQ(qid);
    const f = fs.find((f) => f.verified !== "rejected" && f.finding && f.finding.toLowerCase().includes(keyword.toLowerCase()));
    if (!f) {
      const neg = fs.find((f) => f.verified === "verified" && f.checkedLocations && f.checkedLocations.length > 0);
      const conclusion = neg
        ? (this._zh() ? `未检测到 ${keyword}（已检查相关位置）。` : `No ${keyword} detected (relevant locations checked).`)
        : (this._zh() ? `证据不足，无法判断 ${keyword}。` : `Insufficient evidence to determine ${keyword}.`);
      return this._makeResolution(qid, neg ? "no" : "unknown", "Low", conclusion, neg || null, [], fs);
    }
    const hasCount = /\d+/.test(f.finding);
    const verdict = hasCount
      ? (parseInt(f.finding.match(/\d+/)[0], 10) > 0 ? "yes" : "no")
      : (this._textMatches(f, ["strong", "mature", "detected", "present"]) ? "yes" : "partial");
    return this._makeResolution(qid, verdict, this._levelFromFinding(f), f.finding, f, [], [f]);
  }

  _architectureKnowledgeResolution(qid, storeKey, singular) {
    const fs = this._byQ(qid);
    const valid = fs.filter((f) => f.verified !== "rejected");
    const verdict = valid.length > 0 ? "yes" : "no";
    const conclusion = this._zh()
      ? `${valid.length} 个${singular === "decision" ? "架构决策" : singular === "constraint" ? "约束" : "假设"}被验证。`
      : `${valid.length} ${singular}(s) verified.`;
    return this._makeResolution(qid, verdict, valid.length > 0 ? "Medium" : "Low", conclusion, valid[0] || null, [], valid);
  }

  _makeResolution(questionId, verdict, confidence, conclusion, primaryFinding = null, conflicts = [], relatedFindings = []) {
    const q = RESEARCH_QUESTIONS.find((q) => q.id === questionId);
    const primaryEvidence = this._extractPrimaryEvidence(primaryFinding, relatedFindings);
    const analyzerEvidence = this._extractAnalyzerEvidence(relatedFindings, conflicts);

    return {
      id: this._id(),
      questionId,
      question: q ? q.question : questionId,
      importance: q ? q.importance : "medium",
      verdict,
      verdictLabel: this._label(verdict),
      confidence,
      confidenceLabel: this._confidenceLabel(confidence),
      conclusion,
      primaryEvidence,
      analyzerEvidence,
      conflicts,
      supportingFindings: relatedFindings.filter(Boolean).map((f) => f.id).filter(Boolean),
      checkedLocations: this._collectCheckedLocations(relatedFindings),
    };
  }

  _extractPrimaryEvidence(primaryFinding, relatedFindings) {
    const evidence = [];
    const candidates = [primaryFinding, ...relatedFindings].filter(Boolean);
    for (const f of candidates) {
      for (const s of (f.support || []).slice(0, 3)) {
        const ref = s.ref || s.source || "";
        const detail = s.detail || "";
        // Extract file paths from detail strings like "(path/to/file:123)"
        const paths = detail.match(/\([a-zA-Z0-9_./~-]+:\d+\)/g) || [];
        const location = paths.length > 0 ? paths[0].slice(1, -1) : ref;
        if (evidence.some((e) => e.location === location)) continue;
        evidence.push({
          type: s.source && s.source.includes("ast") ? "ast" : s.source && s.source.includes("graph") ? "graph" : "regex",
          location,
          description: detail.slice(0, 200),
        });
        if (evidence.length >= 5) break;
      }
      if (evidence.length >= 5) break;
    }
    return evidence;
  }

  _extractAnalyzerEvidence(findings, conflicts) {
    const evidence = [];
    for (const f of findings.filter(Boolean)) {
      const sources = new Set(this._supportSources(f));
      for (const src of sources) {
        const analyzer = src.split(".")[0] || src;
        const status = f.verified === "rejected"
          ? "rejected"
          : f.verified === "downgraded"
            ? "downgraded"
            : conflicts.some((c) => this._conflictInvolves(c, analyzer))
              ? "false_negative"
              : "supporting";
        evidence.push({
          analyzer,
          claim: f.finding.slice(0, 160),
          status,
          reason: status === "false_negative"
            ? (this._zh() ? "静态分析无法覆盖运行时路由或动态 SDK 调用" : "Static analysis cannot cover runtime routing or dynamic SDK calls")
            : "",
        });
      }
    }
    return evidence;
  }

  _conflictInvolves(conflict, analyzer) {
    const text = JSON.stringify(conflict).toLowerCase();
    return text.includes(analyzer.toLowerCase());
  }

  _collectCheckedLocations(findings) {
    const locs = new Set();
    for (const f of findings.filter(Boolean)) {
      for (const loc of f.checkedLocations || []) locs.add(loc);
    }
    return [...locs].slice(0, 10);
  }

  _levelFromFinding(f) {
    if (!f) return "Low";
    if (f.confidence >= 0.5) return "High";
    if (f.confidence >= 0.25) return "Medium";
    return "Low";
  }

  _buildQ2Conclusion(patternF, flowF, conflicts) {
    const zh = this._zh();
    const parts = [];
    if (patternF && patternF.verified !== "rejected") {
      parts.push(zh ? `主要架构模式：${patternF.finding}。` : `Primary architecture pattern: ${patternF.finding}.`);
    } else {
      parts.push(zh ? "未识别出明确的架构模式。" : "No clear architecture pattern identified.");
    }
    if (flowF && flowF.verified !== "rejected") {
      parts.push(zh ? `信息流分析：${flowF.finding}。` : `Information flow: ${flowF.finding}.`);
    }
    if (conflicts.length > 0) {
      parts.push(zh
        ? `冲突解决：${conflicts[0].resolution || conflicts[0].description}`
        : `Resolution: ${conflicts[0].resolution || conflicts[0].description}`);
    }
    return parts.join(" ");
  }

  _buildQ6Conclusion(aiF, toolF, promptF, conflicts, aiConfirmed) {
    const zh = this._zh();
    if (!aiF || aiF.verified === "rejected") {
      return zh ? "未确认 AI 项目身份。" : "AI project identity not confirmed.";
    }
    if (!aiConfirmed) {
      const parts = [zh ? `不是 AI 项目：${aiF.finding}。` : `Not an AI project: ${aiF.finding}.`];
      if (toolF && toolF.finding && toolF.finding.toLowerCase().includes("no tools detected")) {
        parts.push(zh ? `无工具证据：${toolF.finding}。` : `No tool evidence: ${toolF.finding}.`);
      }
      if (promptF && promptF.finding && promptF.finding.toLowerCase().includes("no prompts detected")) {
        parts.push(zh ? `无提示词证据：${promptF.finding}。` : `No prompt evidence: ${promptF.finding}.`);
      }
      return parts.join(" ");
    }
    const parts = [zh ? `确认是 AI 项目：${aiF.finding}。` : `Confirmed AI project: ${aiF.finding}.`];
    if (toolF) parts.push(zh ? `工具证据：${toolF.finding}。` : `Tool evidence: ${toolF.finding}.`);
    if (promptF) parts.push(zh ? `提示词证据：${promptF.finding}。` : `Prompt evidence: ${promptF.finding}.`);
    if (conflicts.length > 0) {
      parts.push(zh
        ? `注意：${conflicts.map((c) => c.resolution || c.description).join("；")}`
        : `Note: ${conflicts.map((c) => c.resolution || c.description).join("; ")}`);
    }
    return parts.join(" ");
  }
}

export {
  DEFAULT_RESEARCH_GOAL,
  ResearchPlanner,
  QuestionGenerator,
  RESEARCH_QUESTIONS,
  EVIDENCE_SOURCE_WEIGHTS,
  FINDING_SCHEMA,
  FindingsGenerator,
  VerificationLoop,
  EvidenceSynthesizer,
};
