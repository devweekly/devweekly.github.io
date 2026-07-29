// ===========================================================================
// gated-checks.mjs — LLM-powered quality gate verification
//
// Uses llm-runner.mjs to execute gated checks against the research output.
// Each gate runs an LLM prompt that evaluates whether a specific quality
// criterion is met, returning a structured pass/fail with justification.
//
// Usage:
//   import { runGatedChecks, runSingleGate } from "./gated-checks.mjs";
//
//   // Run all gates
//   const results = await runGatedChecks(context, report);
//
//   // Run a single gate
//   const result = await runSingleGate("center_identified", context, report);
//
// Design principle:
//   Gated checks are the "human reviewer" layer. They ask the LLM to
//   evaluate whether the research meets quality standards, not to
//   generate new content. Each gate is a yes/no question with evidence.
// ===========================================================================

import { invokeLLMJSON } from "./llm-runner.mjs";

// ---------------------------------------------------------------------------
// Gate definitions
// ---------------------------------------------------------------------------

/**
 * Each gate defines:
 * - id: unique identifier (must match context.json quality_gate key)
 * - name: human-readable name
 * - prompt: LLM prompt template with {context} and {report} placeholders
 * - description: what this gate checks
 */
const GATES = {
  center_identified: {
    name: "架构中心已识别",
    description: "系统的架构中心是什么？能用一句话回答 + 引用证据",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 的分析结果是否清晰地识别了系统的架构中心。

架构中心不是"主要组件"，而是"驱动整个系统设计的核心抽象"。

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告是否用一句话清晰地陈述了系统的架构中心，并引用了具体证据？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "为什么通过或不通过，引用报告中的哪些内容",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  alternatives_considered: {
    name: "替代方案已考虑",
    description: "每个关键决策都考虑了替代方案吗？design_space 中每项 rejected 非空",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 是否为每个关键决策考虑了替代方案。

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告是否为每个关键决策至少列出了一个被拒绝的替代方案，并说明了拒绝理由？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "为什么通过或不通过，引用报告中的哪些内容",
  "missing": "如果不通过，哪些决策缺少替代方案分析（仅在 passed=false 时填写）"
}
`,
  },

  counterexamples_found: {
    name: "反证已寻找",
    description: "主动寻找过反证吗？challenge_record 非空",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 是否主动寻找了反证。

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：研究是否主动提出了挑战当前解释的问题，并寻找了 disconfirming evidence（反证）？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "为什么通过或不通过，引用报告中的哪些内容",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  model_challenged: {
    name: "模型已挑战",
    description: "模型被挑战过吗？model_stability 曾进入 challenged 状态",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 的模型是否经过了挑战验证。

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：研究是否主动挑战了自己的架构解释（如"如果移除中心，系统还能成立吗？"），并记录了挑战结果？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "为什么通过或不通过，引用报告中的哪些内容",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  depth_gate: {
    name: "深度充足",
    description: "研究达到了足够的'为什么'深度吗？至少有一个 depth≥3 的问题",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 是否达到了足够的深度。

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：研究是否触及了"为什么不是别的"的深度（depth≥3）？报告是否解释了不仅仅是"怎么做"，而是"为什么这样做"、"为什么不是别的"？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "为什么通过或不通过，引用报告中的哪些内容",
  "missing": "如果不通过，缺少什么深度的探索（仅在 passed=false 时填写）"
}
`,
  },

  maintainer_gate: {
    name: "维护者视角",
    description: "能回答'修改 X 影响哪些层'吗？maintainer_view.modification_impact_map 非空",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 是否提供了维护者视角的理解。

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告是否解释了如果修改某个功能，需要影响哪些文件/层？维护者如何心智划分系统？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "为什么通过或不通过，引用报告中的哪些内容",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single gated check.
 *
 * @param {string} gateId — gate identifier (key in GATES)
 * @param {object} context — context.json object
 * @param {string} report — report.md content
 * @param {object} [options] — LLM options
 * @returns {Promise<{id: string, name: string, passed: boolean, confidence: string, justification: string, missing?: string}>}
 */
export async function runSingleGate(gateId, context, report, options = {}) {
  const gate = GATES[gateId];
  if (!gate) {
    throw new Error(`Unknown gate: ${gateId}`);
  }

  const contextStr = JSON.stringify(context, null, 2);
  const prompt = gate.prompt
    .replace("{context}", contextStr)
    .replace("{report}", report);

  const result = await invokeLLMJSON(prompt, {
    model: "opencode/deepseek-v4-flash-free",
    ...options,
  });

  return {
    id: gateId,
    name: gate.name,
    description: gate.description,
    passed: Boolean(result.passed),
    confidence: result.confidence || "medium",
    justification: result.justification || "",
    missing: result.missing || null,
  };
}

/**
 * Check structural preconditions (from SKILL.md "前置条件" section).
 * These are deterministic checks — no LLM needed.
 *
 * @param {object} context — context.json object
 * @returns {{passed: boolean, checks: Array<{id: string, name: string, passed: boolean, detail: string}>}}
 */
export function checkPreconditions(context) {
  const checks = [];

  // 1. questions-r2.json all status=validated
  // (checked externally — here we verify context has the data)
  const r2Checked = context.research_progress?.round_2_checked === "done";
  checks.push({
    id: "round_2_checked",
    name: "第二轮问题已完成",
    passed: r2Checked,
    detail: `round_2_checked = ${context.research_progress?.round_2_checked || "missing"}`,
  });

  // 2. model_stability ≠ nascent
  const stability = context.research_progress?.model_stability;
  const stabilityOk = stability && stability !== "nascent";
  checks.push({
    id: "model_stability",
    name: "模型已被挑战",
    passed: stabilityOk,
    detail: `model_stability = ${stability || "missing"} (must not be nascent)`,
  });

  // 3. center_hypothesis 非空
  const center = context.architecture_model?.center_hypothesis;
  const centerOk = center && center.trim().length > 0;
  checks.push({
    id: "center_hypothesis",
    name: "架构中心假设已填写",
    passed: centerOk,
    detail: `center_hypothesis = ${center ? "present" : "empty/missing"}`,
  });

  // 4. quality_gate 全部为 true
  const qg = context.quality_gate || {};
  const qgKeys = Object.keys(qg);
  const qgAllTrue = qgKeys.length > 0 && qgKeys.every((k) => qg[k] === true);
  checks.push({
    id: "quality_gate",
    name: "质量门禁全部通过",
    passed: qgAllTrue,
    detail: `quality_gate = ${JSON.stringify(qg)} (${qgKeys.filter((k) => qg[k] !== true).length} not true)`,
  });

  const allPassed = checks.every((c) => c.passed);

  return { passed: allPassed, checks };
}

/**
 * Run all checks: preconditions + LLM gates.
 *
 * @param {object} context — context.json object
 * @param {string} report — report.md content
 * @param {object} [options] — LLM options
 * @returns {Promise<{preconditions: object, gates: {results: Array, allPassed: boolean, summary: string}, allPassed: boolean, summary: string}>}
 */
export async function runAllChecks(context, report, options = {}) {
  const preconditions = checkPreconditions(context);
  const gates = await runGatedChecks(context, report, options);

  const allPassed = preconditions.passed && gates.allPassed;
  const summary = `${preconditions.checks.filter((c) => c.passed).length}/${preconditions.checks.length} preconditions + ${gates.summary}`;

  return { preconditions, gates, allPassed, summary };
}

/**
 * Run all gated checks.
 *
 * @param {object} context — context.json object
 * @param {string} report — report.md content
 * @param {object} [options] — LLM options
 * @returns {Promise<{results: Array, allPassed: boolean, summary: string}>}
 */
export async function runGatedChecks(context, report, options = {}) {
  const gateIds = Object.keys(GATES);
  const results = [];

  for (const gateId of gateIds) {
    try {
      const result = await runSingleGate(gateId, context, report, options);
      results.push(result);
    } catch (err) {
      results.push({
        id: gateId,
        name: GATES[gateId].name,
        description: GATES[gateId].description,
        passed: false,
        confidence: "low",
        justification: `Gate execution failed: ${err.message}`,
        missing: "Unable to evaluate",
      });
    }
  }

  const allPassed = results.every((r) => r.passed);
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  const summary = `${passedCount}/${results.length} gates passed (${failedCount} failed)`;

  return {
    results,
    allPassed,
    summary,
  };
}

/**
 * Run gated checks and update context.json quality_gate.
 *
 * @param {object} context — context.json object (will be mutated)
 * @param {string} report — report.md content
 * @param {object} [options] — LLM options
 * @returns {Promise<{results: Array, allPassed: boolean, summary: string}>}
 */
export async function runGatedChecksAndUpdate(context, report, options = {}) {
  const { results, allPassed, summary } = await runGatedChecks(
    context,
    report,
    options
  );

  // Update context.json quality_gate
  for (const result of results) {
    context.quality_gate[result.id] = result.passed;
  }

  return { results, allPassed, summary };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * CLI: node gated-checks.mjs <context.json path> <report.md path>
 *
 * Runs preconditions + all gated checks and prints results.
 * Exits with code 0 if all pass, 1 if any fail.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, contextPath, reportPath] = process.argv;

  if (!contextPath || !reportPath) {
    console.error("Usage: node gated-checks.mjs <context.json path> <report.md path>");
    process.exit(2);
  }

  try {
    const contextContent = await import("node:fs").then((fs) =>
      fs.readFileSync(contextPath, "utf-8")
    );
    const reportContent = await import("node:fs").then((fs) =>
      fs.readFileSync(reportPath, "utf-8")
    );

    const context = JSON.parse(contextContent);
    const { preconditions, gates, allPassed, summary } = await runAllChecks(context, reportContent);

    // Print preconditions
    console.log(`\n=== Preconditions: ${preconditions.checks.filter((c) => c.passed).length}/${preconditions.checks.length} passed ===\n`);
    for (const check of preconditions.checks) {
      const status = check.passed ? "PASS" : "FAIL";
      console.log(`[${status}] ${check.name}`);
      console.log(`  ${check.detail}`);
      console.log();
    }

    // Print gates
    console.log(`=== Gated Checks: ${gates.summary} ===\n`);
    for (const result of gates.results) {
      const status = result.passed ? "PASS" : "FAIL";
      const confidence = result.confidence.toUpperCase().padEnd(6);
      console.log(`[${status}] ${result.name} (${confidence})`);
      console.log(`  ${result.justification}`);
      if (result.missing) {
        console.log(`  Missing: ${result.missing}`);
      }
      console.log();
    }

    console.log(`=== Summary: ${summary} ===\n`);
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }
}
