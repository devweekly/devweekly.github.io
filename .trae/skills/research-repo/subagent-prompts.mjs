#!/usr/bin/env node
/**
 * Subagent prompt templates for the research-repo skill.
 *
 * The `subagent-prompts` command writes these prompts into the working folder
 * as `subagents/*.md`. The main Agent then dispatches each prompt to an LLM
 * subagent, which reads the evidence store and writes the target artifact.
 *
 * v2: Question-centric pipeline with Ontology Mapper and shared findings.
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

  "02-ontology": (repoName, lang) => ({
    target: "02-ontology.md",
    text:
      lang === "zh"
        ? `# Ontology Mapper — ${repoName}

你是一位本体工程师。请从证据中提取 ${repoName} 的**共享语义层**，输出到 \`02-ontology.md\`。

必读输入：
- \`evidence-brief.md\`（§5.5 Ontology 视图）
- \`evidence-store/ontology.json\`（脚本生成的原始本体数据）
- \`evidence-store/full.json\`（capabilityOntology、responsibility 章节）
- \`evidence-store/symbols.json\`（关键函数/类定义）

你的任务**不是**重新分析架构，而是提取并标准化以下语义对象：

## 实体类型

- **Component**：核心模块/组件（如 Agent、Planner、Executor、ToolRegistry）
- **Interface**：组件间的接口/协议（如 LLMProvider、ToolExecutor、ContextStore）
- **Service**：提供特定能力的服务（如 PromptAssembler、EvidenceCollector）
- **Adapter**：与外部系统交互的适配器（如 OpenAIAdapter、MCPClient）
- **Workflow**：端到端的业务流程（如 AgentLoop、ResearchPipeline）
- **Prompt**：Prompt 模板/变量（如 system_prompt、user_template）
- **Tool**：Tool 定义/注册（如 @tool、Tool()、server.tool）

## 输出格式

\`\`\`markdown
# Ontology — ${repoName}

## Components

| Name | Responsibility | Key Files | Depends On |
|------|---------------|-----------|------------|
| Agent | Orchestrates planning/execution | src/agent.ts | Planner, Executor |

## Interfaces

| Name | Purpose | Implemented By |
|------|---------|----------------|
| LLMProvider | Abstracts LLM calls | OpenAIAdapter, AnthropicAdapter |

## Relations

| From | To | Relation Type | Description |
|------|----|----|------------|
| Agent | Planner | uses | Delegates planning tasks |
| Agent | LLMProvider | depends_on | Calls LLM for reasoning |

## Capabilities

| Capability | Provided By | Evidence |
|------------|-------------|----------|
| Multi-agent orchestration | Agent | src/agent.ts:L45-L80 |
\`\`\`

约束：
- 每个实体必须有明确的文件路径证据。
- 不要推断功能；必须查看实现或调用链。
- 如果 \`evidence-store/ontology.json\` 已包含完整数据，直接引用而非重复。`
        : `# Ontology Mapper — ${repoName}

You are an ontology engineer. Extract the **shared semantic layer** of ${repoName} from the evidence and write output to \`02-ontology.md\`.

Required inputs:
- \`evidence-brief.md\` (§5.5 Ontology View)
- \`evidence-store/ontology.json\` (script-generated raw ontology data)
- \`evidence-store/full.json\` (capabilityOntology, responsibility sections)
- \`evidence-store/symbols.json\` (key function/class definitions)

Your task is **NOT** to re-analyze architecture, but to extract and standardize the following semantic objects:

## Entity Types

- **Component**: Core modules/components (e.g., Agent, Planner, Executor, ToolRegistry)
- **Interface**: Interfaces/protocols between components (e.g., LLMProvider, ToolExecutor, ContextStore)
- **Service**: Services providing specific capabilities (e.g., PromptAssembler, EvidenceCollector)
- **Adapter**: Adapters interacting with external systems (e.g., OpenAIAdapter, MCPClient)
- **Workflow**: End-to-end business processes (e.g., AgentLoop, ResearchPipeline)
- **Prompt**: Prompt templates/variables (e.g., system_prompt, user_template)
- **Tool**: Tool definitions/registrations (e.g., @tool, Tool(), server.tool)

## Output Format

\`\`\`markdown
# Ontology — ${repoName}

## Components

| Name | Responsibility | Key Files | Depends On |
|------|---------------|-----------|------------|
| Agent | Orchestrates planning/execution | src/agent.ts | Planner, Executor |

## Interfaces

| Name | Purpose | Implemented By |
|------|---------|----------------|
| LLMProvider | Abstracts LLM calls | OpenAIAdapter, AnthropicAdapter |

## Relations

| From | To | Relation Type | Description |
|------|----|----|------------|
| Agent | Planner | uses | Delegates planning tasks |
| Agent | LLMProvider | depends_on | Calls LLM for reasoning |

## Capabilities

| Capability | Provided By | Evidence |
|------------|-------------|----------|
| Multi-agent orchestration | Agent | src/agent.ts:L45-L80 |
\`\`\`

Constraints:
- Every entity must have explicit file-path evidence.
- Do not infer functionality; inspect implementation or call chains.
- If \`evidence-store/ontology.json\` already contains complete data, reference it instead of duplicating.`,
  }),

  "RQ-001-architecture-pattern": (repoName, lang) => ({
    target: "RQ-001-architecture-pattern.md",
    text:
      lang === "zh"
        ? `# RQ-001: 核心架构模式 — ${repoName}

**Research Question**: ${repoName} 采用什么核心架构模式？它是如何在规划与执行之间实现分离的？

你是一位软件架构师。你的首要目标**不是**总结架构，而是**验证或推翻** \`01-hypotheses.md\` 中与架构相关的假设。

必读输入：
- \`01-hypotheses.md\`（找到与架构相关的假设）
- \`02-ontology.md\`（共享语义层，引用其中的 Component/Interface/Relation）
- \`evidence-brief.md\`
- \`evidence-store/full.json\`（architecture、responsibility、stability 章节）
- \`evidence-store/interesting_files.json\` 中排名前 20 的文件

**Evidence Budget**：
- 最多读取 **50 个文件**
- 最多读取 **200 个符号**（函数/类）
- 当置信度稳定时停止（不要为了凑数而过度阅读）

输出结构：

## Research Question

${repoName} 采用什么核心架构模式？它是如何在规划与执行之间实现分离的？

## Hypothesis Evaluation

| 假设 | 状态 | 证据 |
|------|------|------|
| H-XXX: ... | 支持 / 反驳 / 证据不足 | ... |

## Findings

### Finding 1: {标题}
- **Conclusion**: ...
- **Evidence**: \`file.py:L10-L30\`, 或简报 §X
- **Counter Evidence**: 哪些证据与这个结论矛盾？（例如：没有测试验证、没有运行时注册等）
- **Alternative Interpretation**: 还有什么其他解释？（例如：可能只是 wrapper 而非真正的抽象）
- **Confidence**: High / Medium / Low
- **Unknowns**: 还需要哪些源码验证？

## Shared Findings

如果你发现了其他 Research Question 可能关心的发现，列在这里供后续 Agent 引用：

- **SF-001**: {简述} — 详见 \`shared-findings.md\`

## RQ Status

- [x] Investigating
- [ ] Validated
- [ ] Rejected
- [ ] Needs Evidence

约束：
- 每个 Finding 必须引用至少一个证据源。
- 不要从命名推断功能；必须查看调用链或实现。
- 区分事实与解读。
- **必须**包含 Counter Evidence 和 Alternative Interpretation。`
        : `# RQ-001: Core Architecture Pattern — ${repoName}

**Research Question**: What core architecture pattern does ${repoName} use? How does it enforce separation between planning and execution?

You are a software architect. Your primary goal is **NOT** to summarize architecture, but to **evaluate whether any hypothesis in** \`01-hypotheses.md\` **is supported, refuted, or unaffected** by the architecture evidence.

Required inputs:
- \`01-hypotheses.md\` (find architecture-related hypotheses)
- \`02-ontology.md\` (shared semantic layer; reference Component/Interface/Relation)
- \`evidence-brief.md\`
- \`evidence-store/full.json\` (architecture, responsibility, stability sections)
- Top 20 files from \`evidence-store/interesting_files.json\`

**Evidence Budget**:
- Maximum **50 files**
- Maximum **200 symbols** (functions/classes)
- Stop when confidence stabilizes (do not over-read just to fill quota)

Output structure:

## Research Question

What core architecture pattern does ${repoName} use? How does it enforce separation between planning and execution?

## Hypothesis Evaluation

| Hypothesis | Status | Evidence |
|------------|--------|----------|
| H-XXX: ... | supported / refuted / insufficient | ... |

## Findings

### Finding 1: {Title}
- **Conclusion**: ...
- **Evidence**: \`file.py:L10-L30\` or brief §X
- **Counter Evidence**: What evidence contradicts this conclusion? (e.g., no tests verify this, no runtime registration found)
- **Alternative Interpretation**: What other explanations are possible? (e.g., might merely be a wrapper rather than true abstraction)
- **Confidence**: High / Medium / Low
- **Unknowns**: What source-code verification is still needed?

## Shared Findings

If you discover findings that other Research Questions might care about, list them here for subsequent agents to reference:

- **SF-001**: {brief description} — see \`shared-findings.md\`

## RQ Status

- [x] Investigating
- [ ] Validated
- [ ] Rejected
- [ ] Needs Evidence

Constraints:
- Every Finding must cite at least one evidence source.
- Do not infer function from name alone; inspect call chains or implementation.
- Separate fact from interpretation.
- **Must** include Counter Evidence and Alternative Interpretation.`,
  }),

  "RQ-002-llm-provider-isolation": (repoName, lang) => ({
    target: "RQ-002-llm-provider-isolation.md",
    text:
      lang === "zh"
        ? `# RQ-002: LLM Provider 隔离机制 — ${repoName}

**Research Question**: ${repoName} 如何隔离 LLM Provider？它是真正的抽象还是仅仅是 wrapper？

你的首要目标是**验证或推翻** \`01-hypotheses.md\` 中与 LLM 集成相关的假设。

必读输入：
- \`01-hypotheses.md\`
- \`02-ontology.md\`（查找 LLMProvider Interface 及其 Implemented By）
- \`evidence-brief.md\`
- \`evidence-store/full.json\`（capabilityOntology、informationFlow 章节）
- 关键源码（LLM 调用点、Provider 注册、Adapter 实现）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001：Research Question → Hypothesis Evaluation → Findings（含 Counter Evidence / Alternative / Unknowns）→ Shared Findings → RQ Status

约束：
- 如果 \`02-ontology.md\` 中已定义 LLMProvider Interface，直接引用。
- 必须查看实际调用链，不要仅从类名推断。
- 如果没有找到 LLM 隔离机制，明确记录为 Negative Finding。`
        : `# RQ-002: LLM Provider Isolation — ${repoName}

**Research Question**: How does ${repoName} isolate LLM providers? Is it a true abstraction or merely a wrapper?

Your primary goal is to **evaluate whether any hypothesis in** \`01-hypotheses.md\` **related to LLM integration is supported, refuted, or unaffected**.

Required inputs:
- \`01-hypotheses.md\`
- \`02-ontology.md\` (find LLMProvider Interface and its Implemented By)
- \`evidence-brief.md\`
- \`evidence-store/full.json\` (capabilityOntology, informationFlow sections)
- Key source files (LLM call sites, Provider registration, Adapter implementations)

**Evidence Budget**: Maximum 50 files / 200 symbols

Output structure follows RQ-001: Research Question → Hypothesis Evaluation → Findings (with Counter Evidence / Alternative / Unknowns) → Shared Findings → RQ Status

Constraints:
- If \`02-ontology.md\` already defines LLMProvider Interface, reference it directly.
- Must inspect actual call chains; do not infer from class names alone.
- If no LLM isolation mechanism is found, explicitly record as Negative Finding.`,
  }),

  "RQ-003-tool-determinism": (repoName, lang) => ({
    target: "RQ-003-tool-determinism.md",
    text:
      lang === "zh"
        ? `# RQ-003: Tool 执行确定性 — ${repoName}

**Research Question**: ${repoName} 如何保证 Tool 执行的确定性？

你的首要目标是**验证或推翻** \`01-hypotheses.md\` 中与 Tool 执行相关的假设。

必读输入：
- \`01-hypotheses.md\`
- \`02-ontology.md\`（查找 Tool 相关 Component/Interface）
- \`evidence-brief.md\`
- \`evidence-store/tools.json\`
- 关键源码（Tool 注册、执行器、错误处理、重试逻辑）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001。

重点关注：
- Tool 注册机制（静态 vs 动态）
- 执行沙箱/隔离
- 错误处理与重试策略
- 幂等性保证
- 超时与取消机制`
        : `# RQ-003: Tool Execution Determinism — ${repoName}

**Research Question**: How does ${repoName} ensure deterministic tool execution?

Your primary goal is to **evaluate whether any hypothesis in** \`01-hypotheses.md\` **related to tool execution is supported, refuted, or unaffected**.

Required inputs:
- \`01-hypotheses.md\`
- \`02-ontology.md\` (find Tool-related Component/Interface)
- \`evidence-brief.md\`
- \`evidence-store/tools.json\`
- Key source files (Tool registration, executor, error handling, retry logic)

**Evidence Budget**: Maximum 50 files / 200 symbols

Output structure follows RQ-001.

Focus areas:
- Tool registration mechanism (static vs dynamic)
- Execution sandboxing/isolation
- Error handling and retry strategies
- Idempotency guarantees
- Timeout and cancellation mechanisms`,
  }),

  "RQ-004-context-propagation": (repoName, lang) => ({
    target: "RQ-004-context-propagation.md",
    text:
      lang === "zh"
        ? `# RQ-004: Context 传播机制 — ${repoName}

**Research Question**: ${repoName} 中 Context 是如何在组件间传播的？

你的首要目标是**验证或推翻** \`01-hypotheses.md\` 中与 Context 管理相关的假设。

必读输入：
- \`01-hypotheses.md\`
- \`02-ontology.md\`（查找 Context 相关 Component/Interface）
- \`evidence-brief.md\`
- \`evidence-store/full.json\`（informationFlow 章节）
- 关键源码（Context 定义、传递路径、压缩/截断逻辑）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001。

重点关注：
- Context 数据结构
- 跨组件传递方式（参数传递 vs 全局状态 vs 事件总线）
- Context 压缩/截断策略
- Multi-agent 场景下的 Context 隔离
- Human-in-the-loop 的 Context 切换`
        : `# RQ-004: Context Propagation — ${repoName}

**Research Question**: How is context propagated between components in ${repoName}?

Your primary goal is to **evaluate whether any hypothesis in** \`01-hypotheses.md\` **related to context management is supported, refuted, or unaffected**.

Required inputs:
- \`01-hypotheses.md\`
- \`02-ontology.md\` (find Context-related Component/Interface)
- \`evidence-brief.md\`
- \`evidence-store/full.json\` (informationFlow section)
- Key source files (Context definition, propagation paths, compression/truncation logic)

**Evidence Budget**: Maximum 50 files / 200 symbols

Output structure follows RQ-001.

Focus areas:
- Context data structure
- Cross-component propagation method (parameter passing vs global state vs event bus)
- Context compression/truncation strategies
- Context isolation in multi-agent scenarios
- Context switching for human-in-the-loop`,
  }),

  "RQ-005-architecture-evolution": (repoName, lang) => ({
    target: "RQ-005-architecture-evolution.md",
    text:
      lang === "zh"
        ? `# RQ-005: 架构演化路径 — ${repoName}

**Research Question**: ${repoName} 的架构是如何演化的？有哪些关键的重构节点？

你的首要目标是**验证或推翻** \`01-hypotheses.md\` 中与架构演化相关的假设。

必读输入：
- \`01-hypotheses.md\`
- \`02-ontology.md\`
- \`evidence-brief.md\`
- \`evidence-store/git_history.json\`
- \`evidence-store/full.json\`（architecture、dependencySmell、stability 章节）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001。

重点关注：
- 提交量、贡献者、主要重构节点
- 模块增长方式：monolith → split？新增产品形态？
- 循环依赖、hub modules、不稳定依赖的演化趋势
- 测试/eval 基础设施是早期还是后期加入`
        : `# RQ-005: Architecture Evolution Path — ${repoName}

**Research Question**: How has ${repoName}'s architecture evolved? What are the key refactoring points?

Your primary goal is to **evaluate whether any hypothesis in** \`01-hypotheses.md\` **related to architecture evolution is supported, refuted, or unaffected**.

Required inputs:
- \`01-hypotheses.md\`
- \`02-ontology.md\`
- \`evidence-brief.md\`
- \`evidence-store/git_history.json\`
- \`evidence-store/full.json\` (architecture, dependencySmell, stability sections)

**Evidence Budget**: Maximum 50 files / 200 symbols

Output structure follows RQ-001.

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
- \`02-ontology.md\`
- \`RQ-*.md\`（所有 Research Question 文件）
- \`shared-findings.md\`（如果存在）
- \`evidence-brief.md\`
- \`evidence-store/full.json\`

你的任务：

1. **更新 Research Question 状态**：根据每个 RQ 文件的证据，将其状态更新为 Validated / Rejected / Needs Evidence
2. **验证假设**：检查每个假设是否被支持、反驳或证据不足
3. **识别证据间冲突**：找出不同 RQ 文件之间的矛盾
4. **校准置信度**：哪些 Finding 应该升级/降级？

输出结构：

## Research Question 状态追踪

| RQ | 状态 | 关键发现 | 置信度 |
|----|------|----------|--------|
| RQ-001 | Validated / Rejected / Needs Evidence | ... | High / Medium / Low |

## 假设验证

| 假设 | 支持证据 | 矛盾证据 | 结论 | 置信度 |
|------|----------|----------|------|--------|
| H-XXX: ... | ... | ... | 成立 / 不成立 / 证据不足 | High / Medium / Low |

## 证据间冲突

- 冲突 A：RQ-001 Finding 1 vs RQ-003 Finding 2
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
- \`02-ontology.md\`
- \`RQ-*.md\` (all Research Question files)
- \`shared-findings.md\` (if present)
- \`evidence-brief.md\`
- \`evidence-store/full.json\`

Your tasks:

1. **Update Research Question status**: Based on evidence in each RQ file, update status to Validated / Rejected / Needs Evidence
2. **Validate hypotheses**: Check whether each hypothesis is supported, refuted, or has insufficient evidence
3. **Identify evidence conflicts**: Find contradictions between different RQ files
4. **Calibrate confidence**: Which Findings should be upgraded/downgraded?

Output structure:

## Research Question Status Tracking

| RQ | Status | Key Findings | Confidence |
|----|--------|--------------|------------|
| RQ-001 | Validated / Rejected / Needs Evidence | ... | High / Medium / Low |

## Hypothesis Validation

| Hypothesis | Supporting Evidence | Contradicting Evidence | Verdict | Confidence |
|------------|---------------------|------------------------|---------|------------|
| H-XXX: ... | ... | ... | holds / refuted / insufficient | High / Medium / Low |

## Evidence Conflicts

- Conflict A: RQ-001 Finding 1 vs RQ-003 Finding 2
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

将 ${repoName} 与**以下显式列出的项目**进行对比，输出到 \`04-comparative.md\`。

**只允许对比以下项目**（禁止自行编造其他项目）：
- OpenAI Agents SDK
- LangGraph
- Claude Code
- Codex
- AutoGen
- CrewAI
- MCP

必读输入：
- \`evidence-brief.md\`
- \`02-ontology.md\`
- \`RQ-001-architecture-pattern.md\` 与 \`RQ-002-llm-provider-isolation.md\`
- \`03-cross-validation.md\`

输出结构：

## 对比维度

| 维度 | ${repoName} | OpenAI Agents SDK | LangGraph | 差异含义 |
|------|-------------|-------------------|-----------|----------|

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

Compare ${repoName} with the **explicitly listed projects below** and write output to \`04-comparative.md\`.

**Only compare against these projects** (do NOT invent other projects):
- OpenAI Agents SDK
- LangGraph
- Claude Code
- Codex
- AutoGen
- CrewAI
- MCP

Required inputs:
- \`evidence-brief.md\`
- \`02-ontology.md\`
- \`RQ-001-architecture-pattern.md\` and \`RQ-002-llm-provider-isolation.md\`
- \`03-cross-validation.md\`

Output structure:

## Comparison Dimensions

| Dimension | ${repoName} | OpenAI Agents SDK | LangGraph | Implication |
|-----------|-------------|-------------------|-----------|-------------|

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

**严格限制**：
- **禁止创建新的 Finding**。只整合经过 \`03-cross-validation.md\` 验证的 Finding。
- **禁止重新解释**。只引用已被标记为 Validated 的 Research Question。
- **禁止推测**。如果证据不足，明确说「未知」。

必读输入：
- \`evidence-brief.md\`
- \`01-hypotheses.md\`
- \`02-ontology.md\`
- \`RQ-*.md\`（只引用状态为 Validated 的）
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

**Strict constraints**:
- **Never create new findings**. Only summarize validated findings accepted by \`03-cross-validation.md\`.
- **Never re-interpret**. Only cite Research Questions marked as Validated.
- **Never speculate**. If evidence is insufficient, explicitly say "unknown".

Required inputs:
- \`evidence-brief.md\`
- \`01-hypotheses.md\`
- \`02-ontology.md\`
- \`RQ-*.md\` (only cite those with status = Validated)
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
    ? `# Subagent 执行顺序（v2: Question-centric Pipeline）

请按以下顺序派发 subagent（可用 Task 工具并行执行无依赖的阶段）：

## Stage 1 — 假设生成
- prompt: \`subagents/01-hypothesis.md\`
- output: \`01-hypotheses.md\`

## Stage 2 — Ontology Mapper（共享语义层）
- prompt: \`subagents/02-ontology.md\`
- output: \`02-ontology.md\`

## Stage 3 — Research Question Agents（并行）
- \`subagents/RQ-001-architecture-pattern.md\` → \`RQ-001-architecture-pattern.md\`
- \`subagents/RQ-002-llm-provider-isolation.md\` → \`RQ-002-llm-provider-isolation.md\`
- \`subagents/RQ-003-tool-determinism.md\` → \`RQ-003-tool-determinism.md\`
- \`subagents/RQ-004-context-propagation.md\` → \`RQ-004-context-propagation.md\`
- \`subagents/RQ-005-architecture-evolution.md\` → \`RQ-005-architecture-evolution.md\`

每个 RQ Agent 会：
1. 读取 \`01-hypotheses.md\` 和 \`02-ontology.md\`
2. 验证或推翻相关假设
3. 输出 Findings（含 Counter Evidence / Alternative Interpretation / Unknowns）
4. 更新 RQ 状态（Open → Investigating → Validated / Rejected / Needs Evidence）
5. 将跨 RQ 共享的发现写入 \`shared-findings.md\`

## Stage 4 — 交叉验证
- prompt: \`subagents/03-cross-validation.md\`
- output: \`03-cross-validation.md\`
- 任务：更新 RQ 状态、验证假设、识别冲突、校准置信度

## Stage 5 — 对比分析（可选）
- prompt: \`subagents/04-comparative.md\`
- output: \`04-comparative.md\`
- 限制：只允许对比显式列出的项目（OpenAI Agents SDK / LangGraph / Claude Code / Codex / AutoGen / CrewAI / MCP）

## Stage 6 — 最终报告
- prompt: \`subagents/05-report-writer.md\`
- output: \`report.md\`
- 限制：禁止创建新 Finding；只整合 Validated 的 RQ
`
    : `# Subagent Execution Order (v2: Question-centric Pipeline)

Dispatch subagents in the following order (use Task tool; independent stages can run in parallel):

## Stage 1 — Hypothesis Generation
- prompt: \`subagents/01-hypothesis.md\`
- output: \`01-hypotheses.md\`

## Stage 2 — Ontology Mapper (Shared Semantic Layer)
- prompt: \`subagents/02-ontology.md\`
- output: \`02-ontology.md\`

## Stage 3 — Research Question Agents (parallel)
- \`subagents/RQ-001-architecture-pattern.md\` → \`RQ-001-architecture-pattern.md\`
- \`subagents/RQ-002-llm-provider-isolation.md\` → \`RQ-002-llm-provider-isolation.md\`
- \`subagents/RQ-003-tool-determinism.md\` → \`RQ-003-tool-determinism.md\`
- \`subagents/RQ-004-context-propagation.md\` → \`RQ-004-context-propagation.md\`
- \`subagents/RQ-005-architecture-evolution.md\` → \`RQ-005-architecture-evolution.md\`

Each RQ Agent will:
1. Read \`01-hypotheses.md\` and \`02-ontology.md\`
2. Evaluate whether hypotheses are supported, refuted, or unaffected
3. Output Findings (with Counter Evidence / Alternative Interpretation / Unknowns)
4. Update RQ status (Open → Investigating → Validated / Rejected / Needs Evidence)
5. Write cross-RQ shared findings to \`shared-findings.md\`

## Stage 4 — Cross Validation
- prompt: \`subagents/03-cross-validation.md\`
- output: \`03-cross-validation.md\`
- Tasks: Update RQ status, validate hypotheses, identify conflicts, calibrate confidence

## Stage 5 — Comparative Analysis (optional)
- prompt: \`subagents/04-comparative.md\`
- output: \`04-comparative.md\`
- Constraint: Only compare against explicitly listed projects (OpenAI Agents SDK / LangGraph / Claude Code / Codex / AutoGen / CrewAI / MCP)

## Stage 6 — Final Report
- prompt: \`subagents/05-report-writer.md\`
- output: \`report.md\`
- Constraint: Never create new findings; only integrate Validated RQs
`;

  writeFileSync(join(outDir, "README.md"), index, "utf-8");
  return outDir;
}
