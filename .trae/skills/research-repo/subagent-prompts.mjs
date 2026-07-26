#!/usr/bin/env node
/**
 * Subagent prompt templates for the research-repo skill.
 *
 * The `subagent-prompts` command writes these prompts into the working folder
 * as `subagents/*.md`. The main Agent then dispatches each prompt to an LLM
 * subagent, which reads the evidence store and writes the target artifact.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const PROMPTS = {
  "01-hypothesis": (repoName, lang) => ({
    target: "01-hypotheses.md",
    text:
      lang === "zh"
        ? `# 假设生成器 — ${repoName}

你是一位软件架构研究员。请阅读当前 working folder 中的以下证据，为 ${repoName} 生成 **3-5 个可检验的架构级假设**：

- \`evidence-brief.md\`（§0 研究原则、§1-§5 分析摘要、§9 研究计划与开放问题）
- \`evidence-store/full.json\` 中的摘要字段（discovery、architecture、capabilityOntology、entrypoints）
- \`evidence-store/interesting_files.json\`（阅读优先级前 20）

每个假设必须包含：
1. **假设陈述**（一句话，可证伪）
2. **支持证据**（引用具体文件路径或简报章节）
3. **若成立，意味着什么**（对架构理解的影响）
4. **若不成立，意味着什么**（替代解释）
5. **如何验证**（需要查看哪些源码/测试/文档）

输出到 \`01-hypotheses.md\`。只写假设，不写无关总结。`
        : `# Hypothesis Generator — ${repoName}

You are a software architecture researcher. Read the following evidence in the working folder and generate **3-5 testable, architecture-level hypotheses** for ${repoName}:

- \`evidence-brief.md\` (research principles, analyzer summaries, research plan)
- Summary fields in \`evidence-store/full.json\` (discovery, architecture, capabilityOntology, entrypoints)
- \`evidence-store/interesting_files.json\` (top 20 reading priority)

For each hypothesis include:
1. **Hypothesis statement** (one sentence, falsifiable)
2. **Supporting evidence** (cite file paths or brief sections)
3. **If true, what it implies** (impact on architectural understanding)
4. **If false, what it implies** (alternative explanation)
5. **How to verify** (which source files/tests/docs to inspect)

Write output to \`01-hypotheses.md\`. Only list hypotheses, no extra summary.`,
  }),

  "02-evidence-architecture": (repoName, lang) => ({
    target: "02-evidence/architecture.md",
    text:
      lang === "zh"
        ? `# 架构深度分析 — ${repoName}

你是一位软件架构师。请基于证据深入分析 ${repoName} 的核心架构，输出到 \`02-evidence/architecture.md\`。

必读输入：
- \`evidence-brief.md\`
- \`evidence-store/full.json\`（architecture、responsibility、dependencySmell、stability、informationFlow 等章节）
- \`evidence-store/interesting_files.json\` 中排名前 20 的文件
- 必要时读取 \`evidence-store/symbols.json\` 定位关键函数/类

输出结构：

## Findings

### Finding 1: {标题}
- **Conclusion**: ...
- **Evidence**: \`file.py:L10-L30\`, 或简报 §X
- **Confidence**: High / Medium / Low
- **Reason**: 为什么得出这个结论

## Open Questions
- 还需要哪些源码验证？
- 哪些证据之间存在冲突？

约束：
- 每个 Finding 必须引用至少一个证据源。
- 不要从命名推断功能；必须查看调用链或实现。
- 区分事实与解读。`
        : `# Architecture Deep Dive — ${repoName}

You are a software architect. Deeply analyze the core architecture of ${repoName} based on the evidence and write output to \`02-evidence/architecture.md\`.

Required inputs:
- \`evidence-brief.md\`
- \`evidence-store/full.json\` (architecture, responsibility, dependencySmell, stability, informationFlow sections)
- Top 20 files from \`evidence-store/interesting_files.json\`
- \`evidence-store/symbols.json\` when locating key functions/classes

Output structure:

## Findings

### Finding 1: {Title}
- **Conclusion**: ...
- **Evidence**: \`file.py:L10-L30\` or brief §X
- **Confidence**: High / Medium / Low
- **Reason**: why this conclusion follows

## Open Questions
- What source code still needs verification?
- Which evidence sources conflict?

Constraints:
- Every Finding must cite at least one evidence source.
- Do not infer function from name alone; inspect call chains or implementation.
- Separate fact from interpretation.`,
  }),

  "02-evidence-guardrails": (repoName, lang) => ({
    target: "02-evidence/guardrails.md",
    text:
      lang === "zh"
        ? `# Guardrails 与安全分析 — ${repoName}

分析 ${repoName} 在 AI/Agent 场景下的 guardrails、安全机制、适配器与边界处理。输出到 \`02-evidence/guardrails.md\`。

必读输入：
- \`evidence-brief.md\`（capabilityOntology、safety、§6 Negative Findings）
- \`evidence-store/full.json\`
- \`evidence-store/prompts.json\`、\`evidence-store/tools.json\`
- 关键源码文件（如 middleware、policy、approval、validation 相关）

输出结构同 architecture.md：Findings + Open Questions。

重点关注：
- 输入校验、权限控制、token 保护
- Tool 审批、human-in-the-loop、rate limiting
- 错误处理、重试、降级策略
- 与外部 LLM/服务交互的安全边界`
        : `# Guardrails & Safety Analysis — ${repoName}

Analyze guardrails, safety mechanisms, adapters, and boundary handling for ${repoName} in AI/Agent scenarios. Write output to \`02-evidence/guardrails.md\`.

Required inputs:
- \`evidence-brief.md\` (capabilityOntology, safety, §6 Negative Findings)
- \`evidence-store/full.json\`
- \`evidence-store/prompts.json\`, \`evidence-store/tools.json\`
- Key source files (middleware, policy, approval, validation)

Output structure follows architecture.md: Findings + Open Questions.

Focus areas:
- Input validation, authorization, token protection
- Tool approval, human-in-the-loop, rate limiting
- Error handling, retries, fallback strategies
- Security boundaries with external LLM/services`,
  }),

  "02-evidence-testing": (repoName, lang) => ({
    target: "02-evidence/testing.md",
    text:
      lang === "zh"
        ? `# 测试与正确性分析 — ${repoName}

分析 ${repoName} 的测试策略、Evaluation 基础设施与正确性验证缺口。输出到 \`02-evidence/testing.md\`。

必读输入：
- \`evidence-brief.md\`（§7 Correctness、§6 Negative Findings）
- \`evidence-store/tests.json\`、\`evidence-store/evaluations.json\`
- \`evidence-store/full.json\`

输出结构：Findings + Open Questions。

重点关注：
- 测试覆盖率与测试类别分布（unit/integration/e2e/benchmark）
- Eval 文件是否真正评估 AI 行为，还是性能基准
- 边界情况、对抗输入、prompt injection 测试是否缺失
- CI 门禁与质量信号`
        : `# Testing & Correctness Analysis — ${repoName}

Analyze the testing strategy, evaluation infrastructure, and correctness-validation gaps of ${repoName}. Write output to \`02-evidence/testing.md\`.

Required inputs:
- \`evidence-brief.md\` (§7 Correctness, §6 Negative Findings)
- \`evidence-store/tests.json\`, \`evidence-store/evaluations.json\`
- \`evidence-store/full.json\`

Output structure: Findings + Open Questions.

Focus areas:
- Test coverage and category distribution (unit/integration/e2e/benchmark)
- Whether eval files assess AI behavior or only performance
- Missing boundary, adversarial, or prompt-injection tests
- CI gates and quality signals`,
  }),

  "02-evidence-ai-patterns": (repoName, lang) => ({
    target: "02-evidence/ai-patterns.md",
    text:
      lang === "zh"
        ? `# AI Agent 模式分析 — ${repoName}

分析 ${repoName} 中的 AI Agent 设计模式。输出到 \`02-evidence/ai-patterns.md\`。

必读输入：
- \`evidence-brief.md\`（capabilityOntology、prompts、tools、entrypoints）
- \`evidence-store/prompts.json\`、\`evidence-store/tools.json\`
- \`evidence-store/full.json\`
- 关键源码（agent loop、planner、executor、tool registry、context）

输出结构：Findings + Open Questions。

重点关注：
- Agent 生命周期：planning、execution、reflection、retry、cancellation
- Prompt 生命周期：versioning、assembly、compression、template
- Tool 注册、调用、与 Agent 的绑定关系
- Context propagation、multi-agent、human approval、streaming
- 与 MCP / OpenAI Agents / LangGraph 等模式的对比`
        : `# AI Agent Pattern Analysis — ${repoName}

Analyze AI Agent design patterns in ${repoName}. Write output to \`02-evidence/ai-patterns.md\`.

Required inputs:
- \`evidence-brief.md\` (capabilityOntology, prompts, tools, entrypoints)
- \`evidence-store/prompts.json\`, \`evidence-store/tools.json\`
- \`evidence-store/full.json\`
- Key source files (agent loop, planner, executor, tool registry, context)

Output structure: Findings + Open Questions.

Focus areas:
- Agent lifecycle: planning, execution, reflection, retry, cancellation
- Prompt lifecycle: versioning, assembly, compression, templates
- Tool registration, invocation, and binding to agents
- Context propagation, multi-agent, human approval, streaming
- Comparison with MCP / OpenAI Agents / LangGraph patterns`,
  }),

  "02-evidence-evolution": (repoName, lang) => ({
    target: "02-evidence/evolution.md",
    text:
      lang === "zh"
        ? `# 架构演化分析 — ${repoName}

基于 git 历史与代码结构，推断 ${repoName} 的架构演化路径与技术债。输出到 \`02-evidence/evolution.md\`。

必读输入：
- \`evidence-brief.md\`
- \`evidence-store/git_history.json\`
- \`evidence-store/full.json\`（architecture、dependencySmell、stability）
- \`evidence-store/interesting_files.json\`

输出结构：Findings + Open Questions。

重点关注：
- 提交量、贡献者、主要重构节点
- 模块增长方式： monolith → split？新增产品形态？
- 循环依赖、hub modules、不稳定依赖的演化趋势
- 测试/eval 基础设施是早期还是后期加入`
        : `# Architecture Evolution Analysis — ${repoName}

Infer the architectural evolution path and technical debt of ${repoName} from git history and code structure. Write output to \`02-evidence/evolution.md\`.

Required inputs:
- \`evidence-brief.md\`
- \`evidence-store/git_history.json\`
- \`evidence-store/full.json\` (architecture, dependencySmell, stability)
- \`evidence-store/interesting_files.json\`

Output structure: Findings + Open Questions.

Focus areas:
- Commit volume, contributors, major refactoring points
- Module growth patterns: monolith → split? New product forms added?
- Evolution of cycles, hub modules, unstable dependencies
- Whether tests/evals were added early or late`,
  }),

  "03-cross-validation": (repoName, lang) => ({
    target: "03-cross-validation.md",
    text:
      lang === "zh"
        ? `# 交叉验证 — ${repoName}

你是一位审稿人。请交叉验证之前 subagent 产出的证据，输出到 \`03-cross-validation.md\`。

必读输入：
- \`01-hypotheses.md\`
- \`02-evidence/*.md\`
- \`evidence-brief.md\`
- \`evidence-store/full.json\`

输出结构：

## 假设验证

| 假设 | 支持证据 | 矛盾证据 | 结论 | 置信度 |
|------|----------|----------|------|--------|
| ...  | ...      | ...      | 成立 / 不成立 / 证据不足 | High / Medium / Low |

## 证据间冲突

- 冲突 A：... vs ...
- 裁决：...

## 置信度校准

- 哪些 Finding 应该升级？为什么？
- 哪些 Finding 应该降级？为什么？

## 开放问题

- 还需要哪些源码验证才能下结论？`
        : `# Cross Validation — ${repoName}

You are a reviewer. Cross-validate the evidence produced by previous subagents and write output to \`03-cross-validation.md\`.

Required inputs:
- \`01-hypotheses.md\`
- \`02-evidence/*.md\`
- \`evidence-brief.md\`
- \`evidence-store/full.json\`

Output structure:

## Hypothesis Validation

| Hypothesis | Supporting Evidence | Contradicting Evidence | Verdict | Confidence |
|------------|---------------------|------------------------|---------|------------|
| ...        | ...                 | ...                    | holds / refuted / insufficient | High / Medium / Low |

## Evidence Conflicts

- Conflict A: ... vs ...
- Resolution: ...

## Confidence Calibration

- Which Findings should be upgraded and why?
- Which Findings should be downgraded and why?

## Open Questions

- What source-code verification is still needed?`,
  }),

  "04-comparative": (repoName, lang) => ({
    target: "04-comparative.md",
    text:
      lang === "zh"
        ? `# 对比分析 — ${repoName}

将 ${repoName} 与同类知名项目或模式进行对比，输出到 \`04-comparative.md\`。

必读输入：
- \`evidence-brief.md\`
- \`02-evidence/architecture.md\` 与 \`02-evidence/ai-patterns.md\`
- \`03-cross-validation.md\`

输出结构：

## 对比维度

| 维度 | ${repoName} | 同类项目 A | 同类项目 B | 差异含义 |
|------|-------------|------------|------------|----------|

维度建议：
- 架构模式（Plugin / Pipeline / Graph / Monolith）
- Agent 编排方式
- Prompt / Tool 生命周期
- Guardrails 深度
- 可扩展性机制
- 测试/Eval 策略

## 可复用模式

- 哪些做法值得迁移到其它项目？
- 需要满足什么前提条件？

## 反模式警告

- 哪些设计选择可能在其它场景下成为陷阱？`
        : `# Comparative Analysis — ${repoName}

Compare ${repoName} with similar well-known projects or patterns. Write output to \`04-comparative.md\`.

Required inputs:
- \`evidence-brief.md\`
- \`02-evidence/architecture.md\` and \`02-evidence/ai-patterns.md\`
- \`03-cross-validation.md\`

Output structure:

## Comparison Dimensions

| Dimension | ${repoName} | Peer A | Peer B | Implication |
|-----------|-------------|--------|--------|-------------|

Suggested dimensions:
- Architecture pattern (Plugin / Pipeline / Graph / Monolith)
- Agent orchestration style
- Prompt / Tool lifecycle
- Guardrails depth
- Extensibility mechanism
- Test / Eval strategy

## Reusable Patterns

- Which practices are worth migrating elsewhere?
- What preconditions are required?

## Anti-pattern Warnings

- Which design choices could become traps in other contexts?`,
  }),

  "05-report-writer": (repoName, lang) => ({
    target: "report.md",
    text:
      lang === "zh"
        ? `# 最终报告撰写 — ${repoName}

你是首席软件架构师。请综合所有证据与 subagent 产出，撰写最终工程研究报告 \`report.md\`。

必读输入：
- \`evidence-brief.md\`
- \`01-hypotheses.md\`
- \`02-evidence/*.md\`
- \`03-cross-validation.md\`
- \`04-comparative.md\`（若存在）

报告结构遵循 SKILL.md 中的 "Report 结构（Question-centric）"：
1. Executive Summary
2. Research Traces（按 Research Question 组织，而非按 Finding 组织）
3. Negative Findings
4. Architecture Smells
5. Interesting Decisions
6. Repository Positioning
7. Reusable Pattern Catalog
8. Architecture Evolution
9. Reading Guide
10. Open Questions

每条架构结论优先引用 \`[R-XXX]\` 或源码路径；原始 \`[F-XXX]\` 仅作为支持证据。
禁止让 Analyzer 成为叙事主体；禁止复述 Analyzer 之间的争论。
每个 Trace 必须回答一个会改变工程师对系统理解的架构问题。`
        : `# Final Report Writer — ${repoName}

You are the lead software architect. Synthesize all evidence and subagent outputs into the final engineering research report \`report.md\`.

Required inputs:
- \`evidence-brief.md\`
- \`01-hypotheses.md\`
- \`02-evidence/*.md\`
- \`03-cross-validation.md\`
- \`04-comparative.md\` (if present)

Follow the "Report 结构（Question-centric）" section in SKILL.md:
1. Executive Summary
2. Research Traces (organized by Research Question, not by Finding)
3. Negative Findings
4. Architecture Smells
5. Interesting Decisions
6. Repository Positioning
7. Reusable Pattern Catalog
8. Architecture Evolution
9. Reading Guide
10. Open Questions

Cite \`[R-XXX]\` or source-code paths for architectural conclusions; raw \`[F-XXX]\` may only appear as supporting evidence.
Never center the narrative around analyzer outputs; never narrate analyzer disagreements as report body.
Every Trace must answer an architecture question that changes the reader's understanding of the system.`,
  }),
};

export function writeSubagentPrompts(repoPath, options = {}) {
  const lang = options.lang === "zh" ? "zh" : "en";
  const repoName = basename(repoPath);
  const baseDir = options.outDir || process.cwd();
  const outDir = join(baseDir, "subagents");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  for (const [key, factory] of Object.entries(PROMPTS)) {
    const { target, text } = factory(repoName, lang);
    const header = lang === "zh"
      ? `<!-- Target output: ${target} -->\n<!-- Repo: ${repoName} | Lang: ${lang} -->\n\n`
      : `<!-- Target output: ${target} -->\n<!-- Repo: ${repoName} | Lang: ${lang} -->\n\n`;
    writeFileSync(join(outDir, `${key}.md`), header + text, "utf-8");
  }

  const index = lang === "zh"
    ? `# Subagent 执行顺序

请按以下顺序派发 subagent（可用 Task 工具并行执行无依赖的阶段）：

## Stage 1 — 假设生成
- prompt: \`subagents/01-hypothesis.md\`
- output: \`01-hypotheses.md\`

## Stage 2 — 证据收集（并行）
- \`subagents/02-evidence-architecture.md\` → \`02-evidence/architecture.md\`
- \`subagents/02-evidence-guardrails.md\` → \`02-evidence/guardrails.md\`
- \`subagents/02-evidence-testing.md\` → \`02-evidence/testing.md\`
- \`subagents/02-evidence-ai-patterns.md\` → \`02-evidence/ai-patterns.md\`
- \`subagents/02-evidence-evolution.md\` → \`02-evidence/evolution.md\`

## Stage 3 — 交叉验证
- prompt: \`subagents/03-cross-validation.md\`
- output: \`03-cross-validation.md\`

## Stage 4 — 对比分析（可选）
- prompt: \`subagents/04-comparative.md\`
- output: \`04-comparative.md\`

## Stage 5 — 最终报告
- prompt: \`subagents/05-report-writer.md\`
- output: \`report.md\`
`
    : `# Subagent Execution Order

Dispatch subagents in the following order (use Task tool; independent stages can run in parallel):

## Stage 1 — Hypothesis Generation
- prompt: \`subagents/01-hypothesis.md\`
- output: \`01-hypotheses.md\`

## Stage 2 — Evidence Collection (parallel)
- \`subagents/02-evidence-architecture.md\` → \`02-evidence/architecture.md\`
- \`subagents/02-evidence-guardrails.md\` → \`02-evidence/guardrails.md\`
- \`subagents/02-evidence-testing.md\` → \`02-evidence/testing.md\`
- \`subagents/02-evidence-ai-patterns.md\` → \`02-evidence/ai-patterns.md\`
- \`subagents/02-evidence-evolution.md\` → \`02-evidence/evolution.md\`

## Stage 3 — Cross Validation
- prompt: \`subagents/03-cross-validation.md\`
- output: \`03-cross-validation.md\`

## Stage 4 — Comparative Analysis (optional)
- prompt: \`subagents/04-comparative.md\`
- output: \`04-comparative.md\`

## Stage 5 — Final Report
- prompt: \`subagents/05-report-writer.md\`
- output: \`report.md\`
`;

  writeFileSync(join(outDir, "README.md"), index, "utf-8");
  return outDir;
}
