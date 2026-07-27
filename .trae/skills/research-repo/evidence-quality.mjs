// ===========================================================================
// evidence-quality.mjs — Evidence Quality Layer
//
// 在 AnalyzerPipeline 和 EvidenceStore 之间的 QA + 智能层：
//   1. EvidenceSanitizer — 修正 Analyzer 误检（prompt/tool/architecture）
//   2. ArchetypeDetector — 基于证据自动判断 Repository Archetype
//   3. ConfidencePropagator — Evidence confidence → Claim confidence
//   4. CoverageCalculator — 每个 Claim 的证据覆盖度矩阵
//   5. ClaimRanker — Claim ★ 评级（Importance × Confidence × Coverage × Transferability）
//   6. StopConditionChecker — Research Completeness Score
//
// 设计原则（来自用户反馈）：
//   - Prompt 永远服务于 Evidence，而不是反过来
//   - Report 不应该知道 Analyzer 出过错——Sanitizer 在 Evidence Store 阶段修正
//   - Evidence Store 是 research-repo 的真正创新，不是 Prompt
// ===========================================================================

import { isTestPath } from "./utils.mjs";

// ---------------------------------------------------------------------------
// 1. EvidenceSanitizer — 修正 Analyzer 误检
// ---------------------------------------------------------------------------

/**
 * 修正 Analyzer 的已知误检模式。
 * 基于历史报告勘误记录（pi/topcoat/pyod/dbeaver）提炼的规则。
 *
 * 修正规则：
 *   - prompts: 排除 examples/、docs/、README.md 中的示例代码
 *   - tools: 排除 node_modules/、SDK 中间件、barrel exports
 *   - architecture: Reactive vs Event-Driven 需要额外信号验证
 */
export class EvidenceSanitizer {
  /**
   * @param {object} store — analyzer 输出的 flat store（会被原地修正）
   * @returns {{ corrected: string[], dropped: {type: string, item: object, reason: string}[] }}
   */
  sanitize(store) {
    const corrected = [];
    const dropped = [];

    if (store.prompts && Array.isArray(store.prompts.prompts)) {
      const result = this._sanitizePrompts(store.prompts);
      dropped.push(...result.dropped);
      if (result.corrected) corrected.push(`prompts: ${store.prompts.totalPrompts} → ${store.prompts.prompts.length}`);
    }

    if (store.tools && Array.isArray(store.tools.tools)) {
      const result = this._sanitizeTools(store.tools);
      dropped.push(...result.dropped);
      if (result.corrected) corrected.push(`tools: ${store.tools.totalTools} → ${store.tools.tools.length}`);
    }

    if (store.architecture && store.architecture.pattern) {
      const result = this._sanitizeArchitecture(store.architecture);
      if (result.corrected) corrected.push(`architecture.pattern: ${result.corrected}`);
    }

    return { corrected, dropped };
  }

  /**
   * Prompt 误检修正：
   * - 排除 examples/、docs/、README.md 中的示例代码（这些是文档示例，不是真实 prompt）
   * - 排除 test fixtures（isTestPath）
   */
  _sanitizePrompts(promptsStore) {
    const dropped = [];
    const before = promptsStore.prompts.length;
    const filtered = promptsStore.prompts.filter((p) => {
      const file = (p.file || "").toLowerCase();
      // 文档示例不是真实 prompt
      if (file.includes("examples/") || file.includes("example/")) {
        dropped.push({ type: "prompt", item: p, reason: "example file (文档示例)" });
        return false;
      }
      if (file.includes("docs/") || file.includes("documentation/")) {
        dropped.push({ type: "prompt", item: p, reason: "docs file (文档目录)" });
        return false;
      }
      if (file.endsWith("readme.md") || file.endsWith("readme_zh.md")) {
        dropped.push({ type: "prompt", item: p, reason: "README file (README 示例)" });
        return false;
      }
      // test fixtures
      if (isTestPath(file)) {
        dropped.push({ type: "prompt", item: p, reason: "test file (测试 fixture)" });
        return false;
      }
      return true;
    });
    promptsStore.prompts = filtered;
    promptsStore.totalPrompts = filtered.length;
    return { dropped, corrected: before !== filtered.length };
  }

  /**
   * Tool 误检修正：
   * - 排除 node_modules/、vendor/、dist/、build/ 中的第三方代码
   * - 排除 barrel exports（index.js/index.ts 只做 re-export）
   * - 排除 SDK 中间件（aws-sdk、@aws-sdk、@anthropic-ai/sdk 等）
   * - 排除 platform utilities（_is_wsl、_is_mac、_is_win 等）
   */
  _sanitizeTools(toolsStore) {
    const dropped = [];
    const before = toolsStore.tools.length;
    const SDK_PATTERNS = [
      /aws-sdk/, /@aws-sdk\//, /@anthropic-ai\//, /@openai\//,
      /@langchain\//, /langchain\//, /@modelcontextprotocol\//,
    ];
    const PLATFORM_UTIL_NAMES = /^(_is_wsl|_is_mac|_is_win|_is_linux|_is_options|_is_data|_is_value|_is_key|_is_type|_is_id)$/i;

    const filtered = toolsStore.tools.filter((t) => {
      const file = (t.file || "").toLowerCase();
      const name = (t.name || "").toLowerCase();

      // 第三方代码
      if (file.includes("node_modules/") || file.includes("vendor/") ||
          file.includes("dist/") || file.includes("build/")) {
        dropped.push({ type: "tool", item: t, reason: "third-party code (node_modules/vendor/dist/build)" });
        return false;
      }
      // SDK 中间件
      if (SDK_PATTERNS.some((re) => re.test(file))) {
        dropped.push({ type: "tool", item: t, reason: "SDK middleware (SDK 中间件)" });
        return false;
      }
      // barrel exports（index.js 只做 re-export）
      if (/\bindex\.(js|ts|tsx|mjs)$/.test(file) && name === "") {
        dropped.push({ type: "tool", item: t, reason: "barrel export (barrel re-export)" });
        return false;
      }
      // platform utilities
      if (PLATFORM_UTIL_NAMES.test(name)) {
        dropped.push({ type: "tool", item: t, reason: "platform utility (平台工具函数)" });
        return false;
      }
      return true;
    });
    toolsStore.tools = filtered;
    toolsStore.totalTools = filtered.length;
    return { dropped, corrected: before !== filtered.length };
  }

  /**
   * Architecture 误检修正：
   * - Reactive 不应被误判为 Event-Driven
   * - Java Eclipse plugin packaging 不应被误判为 Layered
   */
  _sanitizeArchitecture(archStore) {
    let corrected = null;
    if (archStore.pattern && archStore.pattern.name === "Event-Driven") {
      // Event-Driven 需要 ≥1 个 event bus / message queue / pub-sub 信号
      // 如果没有，降级为 Unknown
      const signals = archStore.pattern.signals || [];
      const hasEventBus = signals.some((s) =>
        /event.?bus|message.?queue|pub.?sub|emitter|dispatcher/i.test(s)
      );
      if (!hasEventBus) {
        archStore.pattern = {
          name: "Unknown",
          confidence: 0,
          reason: "Event-Driven 误判修正：缺少 event bus / message queue / pub-sub 信号",
          originalPattern: "Event-Driven",
        };
        corrected = "Event-Driven → Unknown (缺少 event bus 信号)";
      }
    }
    return { corrected };
  }
}

// ---------------------------------------------------------------------------
// 2. Archetype Detection — 由 LLM 判断，不在这里做脚本规则检测
// ---------------------------------------------------------------------------
// 设计决策：
//   - 纯脚本规则无法可靠判断 Repository Archetype（测试显示 dbeaver/topcoat/pyod
//     都被误判）。
//   - Archetype 判断是语义判断，应该交给 LLM（Question Planner）。
//   - 这里只提供 ARCHETYPE_CATALOG 给 prompt 作为参考，不做硬性分类。
// ---------------------------------------------------------------------------

export const ARCHETYPE_CATALOG = {
  "AI Agent": {
    name: "AI Agent 框架",
    focus: ["Agent lifecycle", "Planning", "Execution", "Reflection", "Context", "Tools", "Memory", "Retry", "Parallelism"],
    signals: ["tool definitions", "prompt templates", "agent classes", "LLM API calls", "runner/loop"],
  },
  "Compiler": {
    name: "编译器/语言工具",
    focus: ["Lexer", "Parser", "IR", "Optimizer", "Codegen", "Type system", "Runtime"],
    signals: ["lexer", "parser", "AST", "IR", "codegen"],
  },
  "Database": {
    name: "数据库/数据系统",
    focus: ["Query planner", "Executor", "Storage engine", "Transaction", "Concurrency", "Vectorized execution"],
    signals: ["query planner", "storage engine", "transaction", "jdbc", "execution engine"],
  },
  "Developer Tool": {
    name: "开发者工具",
    focus: ["Plugin system", "Extension API", "Configuration model", "Integration patterns"],
    signals: ["plugin registry", "extension API", "CLI", "bin scripts"],
  },
  "Library/SDK": {
    name: "Library/SDK",
    focus: ["API design", "Abstraction boundaries", "Integration patterns"],
    signals: ["public API", "main entry", "exports", "abstraction layers"],
  },
  "Application": {
    name: "应用/服务",
    focus: ["API design", "Auth", "Data flow", "Deployment", "Observability"],
    signals: ["server", "router", "handler", "service layer"],
  },
};

/**
 * 基于证据摘要让调用方（LLM）判断 Archetype。
 * 这里只生成供 prompt 使用的 evidence hints，不返回最终结果。
 * @param {object} store
 * @returns {object}
 */
export function buildArchetypeHints(store) {
  const symbols = store.symbols || {};
  // 使用文件路径 + 模块名 + 类名（函数名太宽泛）
  const filePaths = (store.discovery?.files || []).map((f) => String(f.path || f.name || f)).join(" ").toLowerCase();
  const moduleNames = (store.architecture?.nodes || []).map((m) => m.id || m.path || "").join(" ").toLowerCase();
  const classNames = (symbols.classes || []).map((c) => c.name || "").join(" ").toLowerCase();
  const nameText = `${filePaths} ${moduleNames} ${classNames}`;

  const hasAgent = /\bagent\b/.test(nameText);
  const hasLLM = /\b(llm|openai|anthropic|claude|gpt|gemini)\b/.test(nameText);
  const hasTool = /\btool\b/.test(nameText) || (store.tools?.totalTools || 0) > 0;
  const hasPrompt = (store.prompts?.totalPrompts || 0) > 0;
  const hasParser = /\bparse(r|s)?\b/.test(nameText);
  const hasLexer = /\blexer?\b/.test(nameText) || /\btokeniz(er|ation)\b/.test(nameText);
  const hasCodegen = /\bcodegen\b/.test(nameText) || /\bcode.?gen\b/.test(nameText) || /\bemit\b/.test(nameText);
  const hasSQL = /\bsql\b/.test(nameText) || /\.sql\b/.test(nameText);
  const hasDB = /\bjdbc\b/.test(nameText) || /\bdrivermanager\b/.test(nameText) || /\bdatasource\b/.test(nameText);
  const hasPlugin = /\bplugin\b/.test(nameText) || /\bextension\b/.test(nameText);
  const hasCLI = /\bcli\b/.test(nameText) || /\bcommand.?line\b/.test(nameText);
  const manifest = store.discovery?.manifest || {};

  return {
    signals: { hasAgent, hasLLM, hasTool, hasPrompt, hasParser, hasLexer, hasCodegen, hasSQL, hasDB, hasPlugin, hasCLI },
    counts: {
      tools: store.tools?.totalTools || 0,
      prompts: store.prompts?.totalPrompts || 0,
      entrypoints: store.entrypoints?.entrypoints?.length || 0,
      files: store.discovery?.fileCount || 0,
    },
    manifest: {
      hasMain: Boolean(manifest.main || manifest.module),
      hasExports: Boolean(manifest.exports),
      hasBin: Boolean(manifest.bin),
    },
    catalog: ARCHETYPE_CATALOG,
  };
}

// ---------------------------------------------------------------------------
// 3. ConfidencePropagator — Evidence confidence → Claim confidence
// ---------------------------------------------------------------------------

/**
 * Evidence 来源权重（来自 config.mjs EVIDENCE_SOURCE_WEIGHTS 的简化版）
 */
const SOURCE_WEIGHTS = {
  ast: 0.90,
  graph: 0.75,
  git: 0.60,
  manifest: 0.50,
  regex: 0.30,
  keyword: 0.20,
  inference: 0.10,
};

/**
 * 计算 Claim 的 confidence（基于 supporting evidence 的聚合）。
 * 不由 LLM 重新猜——confidence 从 evidence 继承。
 *
 * @param {{ evidence: Array<{source?: string, confidence?: number}>, counterEvidence?: any[] }} claim
 * @returns {number} 0.0 - 0.95
 */
export function propagateConfidence(claim) {
  const evidence = claim.evidence || [];
  if (evidence.length === 0) return 0.0;

  // 取所有 evidence 的 confidence（如果没有，用 source weight 推断）
  const confidences = evidence.map((e) => {
    if (typeof e.confidence === "number") return e.confidence;
    const source = (e.source || "inference").toLowerCase();
    return SOURCE_WEIGHTS[source] || 0.10;
  });

  // 聚合策略：取最高 3 个的加权平均（最高权重，次高 0.6，第三 0.3）
  // 这样单一证据源不会得到高 confidence
  const sorted = confidences.sort((a, b) => b - a);
  const weights = [1.0, 0.6, 0.3];
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < Math.min(3, sorted.length); i++) {
    sum += sorted[i] * weights[i];
    weightSum += weights[i];
  }
  let confidence = sum / weightSum;

  // Counter evidence 降低 confidence
  const counterCount = (claim.counterEvidence || []).length;
  if (counterCount > 0) {
    confidence *= Math.max(0.3, 1 - counterCount * 0.15);
  }

  // 多源加分（不同来源的证据互相印证）
  const sources = new Set(evidence.map((e) => (e.source || "inference").toLowerCase()));
  if (sources.size >= 3) confidence = Math.min(0.95, confidence + 0.05);

  return Math.min(0.95, Math.max(0.0, confidence));
}

// ---------------------------------------------------------------------------
// 4. CoverageCalculator — 每个 Claim 的证据覆盖度矩阵
// ---------------------------------------------------------------------------

/**
 * 计算 Claim 的证据覆盖度。
 *
 * Coverage 维度：
 *   - Code:    源码文件证据
 *   - Test:    测试文件证据
 *   - Config:  配置/manifest 证据
 *   - Doc:     文档/README 证据
 *   - Commit:  git 提交历史证据
 *
 * @param {{ evidence: Array<{file?: string, source?: string}> }} claim
 * @returns {{ dimensions: Record<string, boolean>, score: number, level: "High"|"Medium"|"Low" }}
 */
export function calculateCoverage(claim) {
  const evidence = claim.evidence || [];
  const dimensions = {
    Code: false,
    Test: false,
    Config: false,
    Doc: false,
    Commit: false,
  };

  for (const e of evidence) {
    const file = (e.file || e.path || "").toLowerCase();
    const source = (e.source || "").toLowerCase();

    if (isTestPath(file) || source === "test") {
      dimensions.Test = true;
    } else if (/\.(json|yaml|yml|toml|ini|env)$/.test(file) || file.includes("manifest") || source === "manifest") {
      dimensions.Config = true;
    } else if (/\.(md|rst|txt)$/.test(file) || file.includes("readme") || file.includes("docs/") || source === "doc") {
      dimensions.Doc = true;
    } else if (source === "git" || source === "commit") {
      dimensions.Commit = true;
    } else if (file && !dimensions.Code) {
      dimensions.Code = true;
    }
  }

  const covered = Object.values(dimensions).filter(Boolean).length;
  const score = covered / 5;
  const level = covered >= 3 ? "High" : covered >= 2 ? "Medium" : "Low";

  return { dimensions, score, level, covered, total: 5 };
}

// ---------------------------------------------------------------------------
// 5. ClaimRanker — Claim ★ 评级
// ---------------------------------------------------------------------------

/**
 * 为 Claim 评级（★1 到 ★5）。
 *
 * Rating = f(Importance, Confidence, Coverage, Transferability)
 *
 * @param {{
 *   importance?: "Critical"|"High"|"Medium"|"Low",
 *   confidence?: number,
 *   coverage?: { covered: number },
 *   transferability?: "High"|"Medium"|"Low"
 * }} claim
 * @returns {{ stars: number, rating: string, reason: string }}
 */
export function rankClaim(claim) {
  const importanceScore = {
    Critical: 5, High: 4, Medium: 3, Low: 2,
  }[claim.importance] || 2;

  const confidenceScore = claim.confidence != null
    ? Math.round(claim.confidence * 5)
    : 2;

  const coverageScore = claim.coverage?.covered != null
    ? Math.round((claim.coverage.covered / 5) * 5)
    : 1;

  const transferabilityScore = {
    High: 4, Medium: 3, Low: 2,
  }[claim.transferability] || 2;

  // 加权平均：Importance 40% + Confidence 30% + Coverage 20% + Transferability 10%
  const weighted = (
    importanceScore * 0.40 +
    confidenceScore * 0.30 +
    coverageScore * 0.20 +
    transferabilityScore * 0.10
  );

  const stars = Math.max(1, Math.min(5, Math.round(weighted)));
  const rating = "★".repeat(stars) + "☆".repeat(5 - stars);
  const reason = `Importance=${claim.importance || "Low"}, Confidence=${(claim.confidence || 0).toFixed(2)}, Coverage=${claim.coverage?.covered || 0}/5, Transferability=${claim.transferability || "Low"}`;

  return { stars, rating, reason };
}

// ---------------------------------------------------------------------------
// 6. StopConditionChecker — Research Completeness Score
// ---------------------------------------------------------------------------

/**
 * 检查研究是否可以停止。
 *
 * Stop when:
 *   - Core Research Questions 都有 Claim 回答
 *   - 每个 Claim 的 Coverage ≥ 2/5
 *   - 没有发现新的矛盾证据
 *   - 继续阅读不再改变任何 Claim 的 confidence
 *
 * @param {{
 *   questions: Array<{ answered: boolean }>,
 *   claims: Array<{ coverage?: { covered: number }, contradictions?: any[] }>,
 *   recentConfidenceChanges?: number[]
 * }} state
 * @returns {{ shouldStop: boolean, completeness: number, reasons: string[] }}
 */
export function checkStopCondition(state) {
  const reasons = [];
  let score = 0;

  // 1. 问题回答率
  const questions = state.questions || [];
  const answered = questions.filter((q) => q.answered).length;
  const questionRate = questions.length > 0 ? answered / questions.length : 0;
  if (questionRate >= 0.8) {
    score += 30;
    reasons.push(`问题回答率 ${Math.round(questionRate * 100)}% (≥80%)`);
  } else {
    reasons.push(`问题回答率 ${Math.round(questionRate * 100)}% (<80%，需继续研究)`);
  }

  // 2. Claim 覆盖度
  const claims = state.claims || [];
  const wellCovered = claims.filter((c) => (c.coverage?.covered || 0) >= 2).length;
  const coverageRate = claims.length > 0 ? wellCovered / claims.length : 0;
  if (coverageRate >= 0.6) {
    score += 25;
    reasons.push(`Claim 覆盖度 ≥2/5 比例 ${Math.round(coverageRate * 100)}% (≥60%)`);
  } else {
    reasons.push(`Claim 覆盖度 ≥2/5 比例 ${Math.round(coverageRate * 100)}% (<60%，需继续研究)`);
  }

  // 3. 矛盾证据
  const totalContradictions = claims.reduce((sum, c) => sum + (c.contradictions?.length || 0), 0);
  if (totalContradictions === 0) {
    score += 25;
    reasons.push("无未解决矛盾");
  } else {
    reasons.push(`${totalContradictions} 个未解决矛盾（需继续研究）`);
  }

  // 4. 置信度稳定性
  const changes = state.recentConfidenceChanges || [];
  if (changes.length > 0 && changes.every((c) => Math.abs(c) < 0.05)) {
    score += 20;
    reasons.push("置信度稳定（最近变化 <0.05）");
  } else if (changes.length === 0) {
    score += 10;
    reasons.push("无最近置信度变化数据");
  } else {
    reasons.push("置信度仍在变化（需继续研究）");
  }

  return {
    shouldStop: score >= 80,
    completeness: score,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// 7. enhanceStore — 一站式 Evidence Quality 增强
// ---------------------------------------------------------------------------

/**
 * 对 Evidence Store 执行全部质量增强：
 *   1. Sanitizer 修正误检
 *   2. Archetype 检测
 *   3. （Confidence/Coverage/Ranking 在 Claim 层按需计算）
 *
 * @param {object} store — analyzer 输出的 flat store（原地修改）
 * @returns {{ archetype: object, sanitized: object }}
 */
export function enhanceStore(store) {
  // 1. Sanitizer — 修正 Analyzer 已知误检
  const sanitizer = new EvidenceSanitizer();
  const sanitized = sanitizer.sanitize(store);

  // 2. Archetype Hints — 把判断留给 LLM（Question Planner）
  const archetypeHints = buildArchetypeHints(store);
  store._archetypeHints = archetypeHints;

  return { archetypeHints, sanitized };
}
