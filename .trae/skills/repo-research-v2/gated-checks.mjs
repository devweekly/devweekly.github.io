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

  // -- Neutrality 检查（最高优先级） -----------------------------------------
  neutrality_gate: {
    name: "Neutrality 中立性",
    description: "报告有绝对化结论吗？禁止 '不可能/永远(用于结论)/deliberate trade-off(作为结论)'",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告是否保持 evidence-based 中立性。

**禁止的绝对化措辞**（用于结论时）：
- "不可能" / "永远"（用于 maintainer 意图结论，非 invariant 描述）
- "deliberate trade-off"（作为结论，而非引用 maintainer 注释）
- "必须"（用于 maintainer 意图，非 invariant 描述）
- "唯一入口"（除非有穷举证据）

**保留的措辞**：
- invariant 描述中的 "必须/永远"（如 "history 里永远不留 orphan tool_calls"）是硬约束，保留

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告中是否有用于结论的绝对化措辞？（invariant 描述中的 "必须/永远" 不算违规）

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中违规的具体句子（如有），或说明为何通过",
  "missing": "如果不通过，需要软化的具体句子（仅在 passed=false 时填写）"
}
`,
  },

  evidence_scope_gate: {
    name: "证据范围匹配",
    description: "证据范围与结论匹配吗？无 TODO/FIXME 不能推出 '永久决策'",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告中证据范围与结论是否匹配。

**过度推断示例**（禁止）：
- 证据 "无 TODO/FIXME" → 结论 "maintainer 有意识决定永远不拆"（过度推断）
- 证据 "代码注释说 deliberate" → 结论 "是永久决策"（过度推断，可能是事后合理化）
- 证据 "某抽象层不存在某功能" → 结论 "未来版本不可能覆盖"（过度推断）

**正确推断示例**：
- 证据 "无 TODO/FIXME" → 结论 "目前没有拆分计划"（范围匹配）
- 证据 "代码注释说 deliberate" → 结论 "maintainer 称之为 deliberate，但无法证实是永久决策"（范围匹配）

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告中是否有过度推断（证据范围超出结论支持范围）？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中过度推断的具体句子（如有），或说明为何通过",
  "missing": "如果不通过，需要修正的具体结论（仅在 passed=false 时填写）"
}
`,
  },

  neutral_terminology_gate: {
    name: "术语 Neutral 化",
    description: "有拟人化比喻吗？禁止 心脏/大脑/神经/骨架/心跳",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告是否使用 neutral 术语。

**禁止的拟人化比喻**：
- 心脏 / 大脑 / 神经系统 / 神经 / 骨架 / 心跳 / 中枢神经 / 器官

**应使用的 neutral 术语**：
- Core Runtime / Coordinator / Human Interaction Layer / Desktop Shell / Scheduling Layer

**理由**：拟人化比喻是研究者创造的，不是 maintainer 的 terminology。blog 可以用，research 不行。

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告中是否有拟人化比喻？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中违规的具体词汇（如有），或说明为何通过",
  "missing": "如果不通过，需要替换的具体词汇（仅在 passed=false 时填写）"
}
`,
  },

  // -- 结构检查（从 "描述系统" 到 "预测系统"） --------------------------------
  blast_radius_gate: {
    name: "Blast Radius 影响范围",
    description: "报告有 Architecture Risk Analysis 章节吗？至少覆盖 Critical + High 组件",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告是否包含 Architecture Risk Analysis（Blast Radius）章节。

**必需内容**：
- 修改点 → 影响范围 → 风险等级（Critical/High/Medium/Low）的表格
- 至少覆盖 Critical 和 High 风险等级的组件
- 每个组件说明为何危险（哪些 invariant 会受影响）

**风险等级标准**：
- Critical：改这里 = 改架构中心，多个 invariant 同时依赖
- High：改这里 = 破坏多个 invariant
- Medium：改这里 = 影响单子系统
- Low：改这里 = mostly data migration

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告是否包含合格的 Blast Radius 章节？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中的 Blast Radius 表格（如有），或说明缺失内容",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  change_difficulty_gate: {
    name: "Change Difficulty 修改难度",
    description: "报告有 Change Difficulty 章节吗？至少 5 项修改难度评估",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告是否包含 Change Difficulty 章节。

**必需内容**：
- 修改 / 难度（Very Low/Low/Medium/High/Very High）/ 理由 的表格
- 至少 5 项修改评估
- 难度理由需具体（如 "data-driven"、"多个 invariant 依赖"、"shared state 耦合"）

**难度标准**：
- Very Low：data-driven，mostly data
- Low：ABC 已稳定，plug-in 式
- Medium：多层契约需同步
- High：多个 shared state + 职责耦合
- Very High：多个 invariant 同时依赖

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告是否包含合格的 Change Difficulty 章节？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中的 Change Difficulty 表格（如有），或说明缺失内容",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  evidence_inference_gate: {
    name: "Evidence/Inference/Confidence 分离",
    description: "核心结论分离了 Evidence/Inference/Confidence 吗？",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告的核心结论是否显式分离了 Evidence / Inference / Confidence。

**核心结论**（架构中心、关键决策、durable 设计等）必须采用三段式格式：

\`\`\`
Evidence:    <代码事实 + evidence id>
Inference:   <研究推断>
Confidence:  <高/中/低>（<理由>）
\`\`\`

**禁止**：
- 把 Inference 包装为 Evidence（把研究推断当代码事实陈述）
- 把 maintainer 注释的 "deliberate" 当作 Evidence 证明永久决策

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告的核心结论是否显式分离了 Evidence / Inference / Confidence？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中的三段式格式示例（如有），或说明哪些核心结论未分离",
  "missing": "如果不通过，哪些核心结论需要重构（仅在 passed=false 时填写）"
}
`,
  },

  coverage_calculable_gate: {
    name: "Coverage 可计算化",
    description: "Coverage 分数可计算吗？格式为 X/Y = Z%，非主观分数 0.85",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告的 Coverage 分数是否可计算。

**禁止格式**（主观分数）：
- runtime: 0.85
- architecture: 0.95

**正确格式**（可计算）：
- runtime: 17/20 questions answered = 85%
- architecture: 19/20 questions answered = 95%

**规则**：
- answered = 该维度问题中已回答（有证据支撑）的数量
- total = 该维度问题总数
- reviewer 必须能验证为什么是 17/20 而不是 18/20

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告的 Coverage 是否使用可计算格式（X/Y = Z%）？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中的 Coverage 格式（如有），或说明为何不合规",
  "missing": "如果不通过，需要改成什么格式（仅在 passed=false 时填写）"
}
`,
  },

  evolution_timeline_gate: {
    name: "架构演进时间线",
    description: "报告有架构演进章节吗？bulk-import 情况下从代码注释推断 + 标注限制",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告是否包含架构演进时间线。

**必需内容**：
- 架构演进章节（重大重构或设计转向）
- 演进时间线（关键事件 + 时间点或推断来源）
- 如果是 bulk-import 仓库：从代码注释推断演进 + 明确标注 git history 限制

**bulk-import 情况**：
- git history 无法用于验证演进时间线——明确标注此限制
- 从代码注释推断演进事件（搜索 "replace the old"、"was a hand-written"、"when X became the second"、"no longer"）
- history coverage 受限于仓库特性，非分析不足——如实标注

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告是否包含合格的架构演进章节？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中的演进时间线（如有），或说明缺失内容",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  tradeoff_expansion_gate: {
    name: "成熟替代方案对比",
    description: "每个核心架构决策对比了成熟替代方案吗？至少 2 个，基于代码证据",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 报告是否对核心架构决策对比了成熟替代方案。

**必需内容**：
- 每个核心架构决策至少对比 2 个成熟替代方案
- 对比必须基于代码证据（非空想）
- 如果证据不足以对比，标注 evidence_insufficient，不强行编造

**应对比的成熟方案示例**：
- Durable execution: Event Sourcing / Temporal / Actor Model / LangGraph / Workflow Engine
- Provider 抽象: aisuite / LiteLLM / LangChain Provider
- Session 管理: Session Store Pattern / Actor Model / Event-Driven
- Permission: RBAC / ABAC / Capability-based

**禁止**：
- 只说"为什么选这个"而不说"为什么不用成熟方案 X"
- 空想对比（无代码证据支撑的 "why not"）
- 说"未来版本不可能覆盖"

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：报告是否对核心决策对比了成熟替代方案？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中的成熟方案对比（如有），或说明缺失内容",
  "missing": "如果不通过，哪些决策需要补充成熟方案对比（仅在 passed=false 时填写）"
}
`,
  },

  surprise_gate: {
    name: "意外发现深挖",
    description: "意外发现被深挖了吗？如果有意外发现，必须有对应的后续问题",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 是否对意外发现进行了深入挖掘。

**意外发现**指与预期不符的架构现象（如：整个仓库没有 Interface、刻意省略常见模式、一个组件做了不该做的事）。

**必需内容**：
- 如果报告提到意外发现，必须说明其对架构理解的 implications
- 意外发现必须有对应的证据支撑
- 如果意外发现未解决，必须作为未解问题提出

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

请判断：研究是否对意外发现进行了足够深挖？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用报告中的意外发现（如有），或说明为何通过",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  design_space_gate: {
    name: "设计空间完整",
    description: "关键决策的设计空间被完整记录了吗？每项有 rejected 替代方案",
    prompt: `
你是一个资深架构评审员。请评估以下 Repository Research 是否完整记录了关键决策的设计空间。

**必需内容**：
- context.design_space 非空
- 每个决策包含 chosen / rejected / why_chosen / why_rejected / tradeoff
- 如果 design_space 为空，报告必须解释为什么（例如仓库太小没有关键决策）

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

请判断：设计空间是否被完整记录？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "引用 context.design_space 或报告中的设计空间分析",
  "missing": "如果不通过，缺少什么（仅在 passed=false 时填写）"
}
`,
  },

  final_check: {
    name: "最终综合检查",
    description: "报告整体是否达到从 '描述系统' 到 '预测系统' 的目标？",
    prompt: `
你是一个资深架构评审员。请对以下 Repository Research 报告做最终综合检查。

**检查维度**：
1. 能否用一句话说出架构中心？
2. 每个关键决策是否有替代方案？
3. 是否能回答"改 X 会炸哪里"？
4. 是否能回答"哪些改动容易、哪些危险"？
5. 是否有证据支撑的核心结论？
6. 是否有过度推断或绝对化结论？

**整体标准**：报告应该让有经验的工程师能快速掌握系统，并做出修改决策。

报告 (report.md):
\`\`\`markdown
{report}
\`\`\`

上下文 (context.json):
\`\`\`json
{context}
\`\`\`

请判断：报告整体是否达到研究目标？

输出 JSON 格式（严格 JSON，无 markdown）：
{
  "passed": true/false,
  "confidence": "high/medium/low",
  "justification": "综合评估报告的优缺点",
  "missing": "如果不通过，最需要补充的内容（仅在 passed=false 时填写）"
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

  // 1. current_round ≥ 1 (at least 1 round completed — allows first-run reports)
  const currentRound = context.current_round || 0;
  const roundOk = currentRound >= 1;
  checks.push({
    id: "current_round",
    name: "至少完成 1 轮问题",
    passed: roundOk,
    detail: `current_round = ${currentRound} (need ≥ 1)`,
  });

  // 2. model_stability ≠ nascent
  const stability = context.model_stability;
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

  // 4. design_space 非空（结构性前置条件；quality_gate 本身由 gate 产出，不能作为 gate 的前置条件，否则形成自举矛盾）
  const ds = context.design_space || [];
  const designSpaceOk = ds.length > 0;
  checks.push({
    id: "design_space",
    name: "设计空间已记录",
    passed: designSpaceOk,
    detail: `design_space = ${ds.length} entries (need > 0)`,
  });

  const allPassed = checks.every((c) => c.passed);

  return { passed: allPassed, allPassed, checks };
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
