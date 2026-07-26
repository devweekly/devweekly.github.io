import {
  DiscoveryAnalyzer,
  SymbolsAnalyzer,
  ArchitectureAnalyzer,
  EntrypointsAnalyzer,
  PromptsAnalyzer,
  ToolsAnalyzer,
  TestsAnalyzer,
  EvaluationsAnalyzer,
  GitAnalyzer,
  CIAnalyzer,
  RankingAnalyzer,
} from "./analyzers-fact.mjs";
import {
  ArchitecturePatternAnalyzer,
  ResponsibilityAnalyzer,
  StabilityAnalyzer,
  ChangeCouplingAnalyzer,
  InformationFlowAnalyzer,
  DependencySmellAnalyzer,
  CapabilityOntologyAnalyzer,
  DecisionAnalyzer,
  ConstraintAnalyzer,
  AssumptionAnalyzer,
  ConsistencyAnalyzer,
} from "./analyzers-inference.mjs";
import {
  EvidenceStore,
  ObjectClassifier,
  RelationshipBuilder,
} from "./evidence-store.mjs";
import {
  DEFAULT_RESEARCH_GOAL,
  ResearchPlanner,
  QuestionGenerator,
} from "./research-engine.mjs";
import { ReportGenerator } from "./report-generator.mjs";

// ===========================================================================
// ANALYZERS — registered analyzers in execution order
//
// Dependency order MUST be preserved:
//   Fact extractors first, then inference engines, then post-processors.
// ===========================================================================

const ANALYZERS = [
  new DiscoveryAnalyzer(),
  new SymbolsAnalyzer(),
  new ArchitectureAnalyzer(),
  new EntrypointsAnalyzer(),
  new PromptsAnalyzer(),
  new ToolsAnalyzer(),
  new TestsAnalyzer(),
  new EvaluationsAnalyzer(),
  new GitAnalyzer(),
  new CIAnalyzer(),
  new RankingAnalyzer(),
  // --- Architecture Semantics Layer (inference engines) ---
  // Order matters: Pattern → Responsibility → (Stability, ChangeCoupling,
  // InformationFlow, DependencySmell) → CapabilityOntology.
  new ArchitecturePatternAnalyzer(),
  new ResponsibilityAnalyzer(),
  new StabilityAnalyzer(),
  new ChangeCouplingAnalyzer(),
  new InformationFlowAnalyzer(),
  new DependencySmellAnalyzer(),
  new CapabilityOntologyAnalyzer(),
  // --- Architecture Knowledge Layer: Decision / Constraint / Assumption ---
  new DecisionAnalyzer(),
  new ConstraintAnalyzer(),
  new AssumptionAnalyzer(),
  // --- Post-processor: runs LAST, compares claims across analyzers ---
  new ConsistencyAnalyzer(),
];

// ===========================================================================
// AnalyzerPipeline — executes registered analyzers against a repository
// ===========================================================================

class AnalyzerPipeline {
  constructor(analyzers = ANALYZERS) {
    this.analyzers = analyzers;
    this._byId = new Map(analyzers.map((a) => [a.id, a]));
  }

  getAnalyzer(id) {
    return this._byId.get(id);
  }

  /**
   * Run a single analyzer by id.
   * @param {string} id
   * @param {RepositoryContext} ctx
   * @returns {Promise<unknown>} the analyzer's result
   */
  async run(id, ctx) {
    const analyzer = this._byId.get(id);
    if (!analyzer) {
      throw new Error(`Unknown analyzer: ${id}`);
    }
    if (!analyzer.supports(ctx)) {
      return { skipped: true, reason: "not supported for this repository" };
    }
    const store = {};
    await analyzer.analyze(ctx, store, { command: id });
    return store[id];
  }

  /**
   * Run all analyzers and return a graph-based EvidenceStore.
   * Also synthesizes a research plan and gap-driven questions from the evidence.
   * @param {RepositoryContext} ctx
   * @returns {Promise<EvidenceStore>}
   */
  async runAll(ctx) {
    const store = {};
    for (const analyzer of this.analyzers) {
      if (!analyzer.supports(ctx)) {
        store[analyzer.id] = { skipped: true, reason: "not supported for this repository" };
        continue;
      }
      await analyzer.analyze(ctx, store, { command: analyzer.id });
    }
    const evidenceStore = new EvidenceStore(store);
    // Ontology: classify objects and build semantic relationships
    const classifier = new ObjectClassifier();
    const { objects, summary: objectSummary } = classifier.classify(store);
    const relBuilder = new RelationshipBuilder();
    const { relationships, summary: relSummary } = relBuilder.build(objects, store);
    store.ontology = { objects, relationships, objectSummary, relSummary };
    const planner = new ResearchPlanner(DEFAULT_RESEARCH_GOAL, evidenceStore);
    store.plan = planner.plan();
    const questionGenerator = new QuestionGenerator(evidenceStore);
    store.questions = questionGenerator.generate();
    const reportGenerator = new ReportGenerator(evidenceStore, { lang: ctx.lang || "en" });
    store.report = reportGenerator.generate();
    store._meta = {
      lastCommit: ctx.isGitRepo ? ctx.git("rev-parse", "HEAD").trim() : null,
      analyzedAt: new Date().toISOString(),
      repoPath: ctx.repoPath,
      incremental: false,
    };
    return evidenceStore;
  }
}

// ---------------------------------------------------------------------------
// Incremental analysis merge utilities
//
// Used by the update command to merge previously-saved analysis results with
// freshly-analyzed changed files. Per-file evidence (symbols, entrypoints,
// prompts, tools, tests) is merged by file path; full-scan evidence
// (discovery, git, ci) is replaced by the new run.
// ---------------------------------------------------------------------------

function mergeAnalysisResults(prevStore, newStore, changedFiles) {
  const merged = {};

  // discovery, git, ci: 直接用新的（全量扫描）
  merged.discovery = newStore.discovery || prevStore.discovery;
  merged.git = newStore.git || prevStore.git;
  merged.ci = newStore.ci || prevStore.ci;

  // symbols: 按文件过滤合并
  if (prevStore.symbols && newStore.symbols) {
    merged.symbols = mergeByKey(
      prevStore.symbols,
      newStore.symbols,
      changedFiles,
      ["functions", "classes", "imports", "calls", "strings"],
      "file"
    );
  } else {
    merged.symbols = newStore.symbols || prevStore.symbols;
  }

  // entrypoints: 按 path 过滤合并
  if (prevStore.entrypoints && newStore.entrypoints) {
    merged.entrypoints = mergeByKey(
      prevStore.entrypoints,
      newStore.entrypoints,
      changedFiles,
      ["entrypoints"],
      "path"
    );
  } else {
    merged.entrypoints = newStore.entrypoints || prevStore.entrypoints;
  }

  // prompts: 按 file 过滤合并
  if (prevStore.prompts && newStore.prompts) {
    merged.prompts = mergeByKey(
      prevStore.prompts,
      newStore.prompts,
      changedFiles,
      ["prompts"],
      "file"
    );
  } else {
    merged.prompts = newStore.prompts || prevStore.prompts;
  }

  // tools: 按 file 过滤合并
  if (prevStore.tools && newStore.tools) {
    merged.tools = mergeByKey(
      prevStore.tools,
      newStore.tools,
      changedFiles,
      ["tools"],
      "file"
    );
  } else {
    merged.tools = newStore.tools || prevStore.tools;
  }

  // tests: 按 file 过滤合并（testFiles 数组中每项有 file 属性）
  if (prevStore.tests && newStore.tests) {
    merged.tests = mergeByKey(
      prevStore.tests,
      newStore.tests,
      changedFiles,
      ["testFiles"],
      "file"
    );
    // 重新计算聚合计数
    if (merged.tests.testFiles) {
      merged.tests.totalTestFiles = merged.tests.testFiles.length;
      merged.tests.totalTestFunctions = merged.tests.testFiles.reduce(
        (sum, f) => sum + (f.testCount || 0),
        0
      );
    }
  } else {
    merged.tests = newStore.tests || prevStore.tests;
  }

  // evaluations: evalFiles 是字符串数组
  if (prevStore.evaluations && newStore.evaluations) {
    const prevEvalFiles = (prevStore.evaluations.evalFiles || []).filter(
      (f) => !changedFiles.has(f)
    );
    const newEvalFiles = newStore.evaluations.evalFiles || [];
    merged.evaluations = {
      ...newStore.evaluations,
      evalFiles: [...new Set([...prevEvalFiles, ...newEvalFiles])],
    };
    merged.evaluations.hasEvaluation =
      merged.evaluations.evalFiles.length > 0 ||
      (merged.evaluations.evalDirs || []).length > 0;
  } else {
    merged.evaluations = newStore.evaluations || prevStore.evaluations;
  }

  return merged;
}

function mergeByKey(prev, next, changedFiles, arrayKeys, fileField) {
  const result = { ...next };
  for (const key of arrayKeys) {
    const prevArr = prev[key] || [];
    const newArr = next[key] || [];
    // 保留未变更文件的旧数据
    const kept = prevArr.filter((item) => !changedFiles.has(item[fileField]));
    // 合并新数据
    result[key] = [...kept, ...newArr];
    // 更新 total 计数
    const totalKey = `total${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (prev[totalKey] !== undefined || next[totalKey] !== undefined) {
      result[totalKey] = result[key].length;
    }
  }
  return result;
}

export {
  ANALYZERS,
  AnalyzerPipeline,
  mergeAnalysisResults,
  mergeByKey,
};
