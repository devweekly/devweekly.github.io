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
  "00-question-planner": (repoName) => ({
    target: "00-research-questions.md",
    text: `# 动态 Research Question 规划器 — ${repoName}

你是一位研究方法论专家。请阅读证据，为 ${repoName} **动态生成**最适合的 5 个 Research Question。

必读输入：
- \`evidence-brief.md\`（§0 研究原则、§1-§5 分析摘要、§9 研究计划）
- \`evidence-store/full.json\`（discovery、architecture、capabilityOntology、entrypoints）
- \`evidence-store/interesting_files.json\`（阅读优先级前 20）

**不要使用固定模板**（如 Architecture / LLM / Tool / Context / Evolution）。
不同项目应该产生不同的问题。

例如：
- OpenAI Agents SDK 应该问：为什么 Runner 是核心？为什么 Tool 不允许递归？为什么 Memory 没做？
- DuckDB 应该问：为什么不用 Volcano？为什么 Vectorized？为什么 Push-based？

## 两阶段流程

### 阶段 1：候选生成（8-10 个）

先头脑风暴 8-10 个候选问题，覆盖不同维度（架构 / 设计决策 / 工程权衡 / 演进 / 反模式）。

### 阶段 2：5 维打分与筛选（选出 Top 5）

每个候选问题按以下 5 维标准打分（每维 1-5 分）：

| 维度 | 含义 | 1 分 | 5 分 |
|------|------|------|------|
| **Impact** | 能否改变工程师对系统的理解 | 表层事实（用了什么技术） | 颠覆性洞察（为什么这样设计） |
| **Novelty** | 是否 README 已回答 | README 直接写了 | 必须读源码才能回答 |
| **Evidence Rich** | Repository 能否回答 | 无证据或纯推测 | 多个文件/测试/提交可验证 |
| **Transferable** | 答案是否有迁移价值 | 仅适用于本项目 | 可迁移到其他系统 |
| **Controversial** | 是否存在其他可能设计 | 只有一种合理做法 | 存在明显的设计权衡 |

**筛选规则**：
- 总分 = 5 维之和（最高 25 分）
- **Controversial = 1 的问题直接淘汰**（没有争议的问题不值得研究）
- **Evidence Rich = 1 的问题直接淘汰**（无法验证的问题不值得研究）
- 选出总分最高的 5 个

## 输出格式

\`\`\`markdown
# Research Questions — ${repoName}

## 候选问题打分表

| # | 候选问题 | Impact | Novelty | Evidence | Transferable | Controversial | 总分 | 入选 |
|---|---------|--------|---------|----------|--------------|---------------|------|------|
| 1 | ... | 5 | 4 | 5 | 4 | 3 | 21 | ✓ |
| 2 | ... | 4 | 5 | 4 | 5 | 4 | 22 | ✓ |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## Q1: {问题陈述}
- **Priority**: Critical / High / Medium
- **Importance**: Critical / High / Medium / Low（与 Confidence 独立）
- **Reason**: 为什么这个问题对理解 ${repoName} 至关重要？
- **Expected Evidence**: 预期在哪些文件中找到答案？
- **Hypothesis**: 初步假设（可证伪）
- **Score**: Impact=N/5, Novelty=N/5, Evidence=N/5, Transferable=N/5, Controversial=N/5, 总分=N/25

## Q2: {问题陈述}
...

## Q3: {问题陈述}
...

## Q4: {问题陈述}
...

## Q5: {问题陈述}
...
\`\`\`

约束：
- 每个问题必须是**可证伪的**（能回答"是"或"否"）。
- 每个问题必须有明确的**证据预期**（不要问无法验证的问题）。
- **Controversial = 1 或 Evidence Rich = 1 的问题必须淘汰**。
- 优先选择**会改变读者对系统理解**的问题。
- 不要问表面问题（如"用了什么技术栈"），要问深层问题（如"为什么这样设计"）。
- 不是问很多，而是问**最值得问的问题**。`,
  }),

  "01-hypothesis": (repoName) => ({
    target: "01-hypotheses.md",
    text: `# 贝叶斯假设生成器 — ${repoName}

你是一位软件架构研究员。请阅读证据，为 ${repoName} 生成 **3-5 个可检验的架构级假设**，并使用**贝叶斯置信度演进**方法。

必读输入：
- \`evidence-brief.md\`
- \`evidence-store/full.json\`（摘要字段）
- \`evidence-store/interesting_files.json\`

每个假设必须包含：
1. **假设陈述**（一句话，可证伪）
2. **先验置信度**（0-100%，基于初步证据）
3. **支持证据**（引用具体文件路径或简报章节）
4. **若成立，意味着什么**（对架构理解的影响）
5. **若不成立，意味着什么**（替代解释）
6. **如何验证**（需要查看哪些源码/测试/文档）
7. **置信度演进历史**（表格形式）：

\`\`\`markdown
| 证据来源 | 置信度变化 | 原因 |
|----------|------------|------|
| 先验 | 15% | 初步观察 |
| architecture.json | 62% | 发现模块化设计 |
| tests/ | 80% | 测试验证了关键路径 |
| git_history.json | 91% | 重构历史支持假设 |
\`\`\`

8. **Competing Hypothesis（竞争假设，必须包含）**：

为每个主假设提出一个**最可能的竞争假设**——即对同一组证据的另一种合理解释。竞争假设也必须有置信度。

\`\`\`markdown
### Competing Hypothesis（竞争假设）
- **陈述**: {对同一证据的另一种解释，一句话}
- **先验置信度**: N%
- **置信度**: N%（低于主假设）
- **为何不如主假设**: {简述}
- **如何证伪竞争假设**: {需要哪些证据}
\`\`\`

**竞争假设的价值**：Opponent Agent 将攻击主假设并尝试支持竞争假设。只有当主假设的置信度**远高于**竞争假设时，结论才稳定。

输出到 \`01-hypotheses.md\`。只写假设，不写无关总结。`,
  }),

  "02-ontology": (repoName) => ({
    target: "02-ontology.md",
    text: `# 行为本体映射器 — ${repoName}

你是一位本体工程师。请从证据中提取 ${repoName} 的**共享语义层**，包括**静态对象**和**行为图**，输出到 \`02-ontology.md\`。

必读输入：
- \`evidence-brief.md\`（§5.5 Ontology 视图）
- \`evidence-store/ontology.json\`
- \`evidence-store/full.json\`（capabilityOntology、responsibility 章节）
- \`evidence-store/symbols.json\`

你的任务**不是**重新分析架构，而是提取并标准化：

## Part 1: 静态对象

- **Component**：核心模块/组件
- **Interface**：组件间的接口/协议
- **Service**：提供特定能力的服务
- **Adapter**：与外部系统交互的适配器
- **Workflow**：端到端的业务流程
- **Prompt**：Prompt 模板/变量
- **Tool**：Tool 定义/注册

## Part 2: 行为本体（Execution Graph）

**不是 Dependency Graph，而是 Behavior Ontology**。

例如：
\`\`\`
Tool
  ↓ EXECUTES
Workflow
  ↓ EMITS
Event
  ↓ TRIGGERS
Prompt
  ↓ CALLS
LLM
\`\`\`

## Part 3: Decision Ontology（Palantir 风格，扩展）

Palantir Ontology 真正强大的不仅是静态对象和行为图，还包括**决策层**。提取以下类型（如证据支持）：

- **Decision**：架构决策（如"Planner 与 Runner 解耦"）
- **Policy**：约束策略（如"Tool 不允许递归"）
- **Constraint**：技术约束（如"必须单进程"）
- **Observation**：观察到的现象（如"测试覆盖了 80% 的核心路径"）
- **Resolution**：研究结论（如"Planner 解耦是为了支持多执行器"）

决策关系动词（用于 Execution Graph 之外的语义层）：
- \`EXECUTES\` / \`EMITS\` / \`TRIGGERS\` / \`CALLS\`（行为）
- \`JUSTIFIES\`（Decision JUSTIFIES Module —— 决策证明模块存在）
- \`SUPPORTS\`（Observation SUPPORTS Finding）
- \`PROVES\`（Finding PROVES Resolution）
- \`ANSWERS\`（Resolution ANSWERS Question）
- \`CONSTRAINS\`（Policy CONSTRAINS Component）

输出格式：

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

## Capabilities

| Capability | Provided By | Evidence |
|------------|-------------|----------|
| Multi-agent orchestration | Agent | src/agent.ts:L45-L80 |

## Execution Graph (Behavior Ontology)

\`\`\`mermaid
graph TD
    A[Planner] -->|generates| B[Task]
    B -->|dispatches to| C[Executor]
    C -->|invokes| D[Tool]
    D -->|returns| E[Observation]
    E -->|stores in| F[Memory]
    F -->|feeds back to| A
\`\`\`

| From | To | Relation | Description |
|------|----|----|------------|
| Planner | Task | generates | Creates execution plan |
| Task | Executor | dispatches to | Assigns work |
| Executor | Tool | invokes | Calls tool implementation |
| Tool | Observation | returns | Produces result |
| Observation | Memory | stores in | Persists state |
| Memory | Planner | feeds back to | Provides context |

## Decisions（如证据支持）

| Decision | Type | Evidence | Justifies |
|----------|------|----------|-----------|
| Separate Planner from Runner | structural | src/runner.ts:L20 | Planner module exists |

## Policies & Constraints（如证据支持）

| Policy/Constraint | Type | Constrains | Evidence |
|-------------------|------|------------|----------|
| Tools must not recurse | policy | Tool | docs/tools.md:L15 |
\`\`\`

约束：
- 每个实体必须有明确的文件路径证据。
- 不要推断功能；必须查看实现或调用链。
- **Execution Graph 必须基于实际调用链**，不要臆测。
- **Decisions / Policies / Constraints 只在证据支持时输出**；无证据则省略该章节，不要编造。`,
  }),

  "03-research-agent": (repoName, questionIndex) => ({
    target: `RQ-${String(questionIndex).padStart(3, "0")}.md`,
    text: `# RQ-${String(questionIndex).padStart(3, "0")} Agent — ${repoName}

你是编号为 RQ-${String(questionIndex).padStart(3, "0")} 的 Research Question Agent。

## 第一步：读取你负责的 Research Question

**立即打开** \`00-research-questions.md\`，找到第 ${questionIndex} 个问题（标题为 \`## Q${questionIndex}: ...\`）。
将该问题的完整陈述作为你的 Research Question。**不要使用任何占位符或默认问题**——必须使用 \`00-research-questions.md\` 中真实生成的第 ${questionIndex} 个问题。

同时读取该问题下的 **Priority / Reason / Expected Evidence / Hypothesis** 字段，这些是 00-question-planner 为你提供的调查方向。

## 调查目标

你的首要目标**不是**总结架构，而是**验证或推翻** \`01-hypotheses.md\` 中与该问题相关的假设（参考 00-research-questions.md 中该问题的 Hypothesis 字段）。

必读输入：
- \`00-research-questions.md\`（找到你负责的第 ${questionIndex} 个问题）
- \`01-hypotheses.md\`（找到相关假设，参考其置信度演进历史）
- \`02-ontology.md\`（共享语义层，引用其中的 Component/Interface/Relation/Execution Graph）
- \`evidence-brief.md\`
- \`evidence-store/full.json\`
- \`evidence-store/interesting_files.json\` 中排名前 20 的文件

**Evidence Budget**：
- 最多读取 **50 个文件**
- 最多读取 **200 个符号**（函数/类）
- 当置信度稳定时停止

## 输出结构

\`\`\`markdown
# RQ-${String(questionIndex).padStart(3, "0")}: {从 00-research-questions.md 读取的真实问题陈述}

## Research Question

{真实问题陈述（从 00-research-questions.md ## Q${questionIndex} 复制）}

## Hypothesis Evaluation

| 假设 | 状态 | 证据 | 置信度演进 |
|------|------|------|------------|
| H-XXX: ... | 支持 / 反驳 / 证据不足 | ... | 15% → 62% → 80% |

## Findings

### Finding 1: {标题}
- **Conclusion**: ...
- **Importance**: Critical / High / Medium / Low（与 Confidence 独立——这个 Finding 对理解架构有多重要）
- **Evidence**: \`file.py:L10-L30\`, 或简报 §X
- **Counter Evidence**: 哪些证据与这个结论矛盾？
- **Alternative Interpretation**: 还有什么其他解释？
- **Confidence**: High / Medium / Low（证据强度——证据有多强，不是结论有多重要）
- **Unknowns**: 还需要哪些源码验证？

## Shared Findings

如果你发现了其他 Research Question 可能关心的发现，列在这里：

- **SF-001**: {简述} — 详见 \`shared-findings.md\`

## RQ Status

- [x] Investigating
- [ ] Validated
- [ ] Rejected
- [ ] Needs Evidence
\`\`\`

约束：
- **第一行标题必须使用从 00-research-questions.md 读取的真实问题陈述**，不要使用 "Dynamic Question ${questionIndex}" 等占位符。
- 每个 Finding 必须引用至少一个证据源。
- 不要从命名推断功能；必须查看调用链或实现。
- 区分事实与解读。
- **必须**包含 Counter Evidence 和 Alternative Interpretation。`,
  }),

  "04-opponent": (repoName) => ({
    target: "04-opponent.md",
    text: `# 反证者（Opponent Agent） — ${repoName}

你是一位怀疑论者。你的职责只有一个：**证明每个 Finding 是错的**。

必读输入：
- \`RQ-*.md\`（所有 Research Question 文件）
- \`evidence-brief.md\`
- \`evidence-store/full.json\`

对每个 Finding，你必须：

1. **寻找直接矛盾**：有没有直接调用/循环/例外？
2. **寻找测试反例**：有没有测试证明这个结论是错的？
3. **寻找替代解释**：有没有更简单的解释？
4. **寻找缺失证据**：有没有应该存在但不存在的证据？

输出格式：

\`\`\`markdown
# Opponent Report — ${repoName}

## RQ-001

### Finding 1: {标题}
- **攻击 1**: 直接矛盾 — {描述}
- **攻击 2**: 测试反例 — {描述}
- **攻击 3**: 替代解释 — {描述}
- **攻击 4**: 缺失证据 — {描述}
- **结论**: Finding 成立 / 部分成立 / 不成立
- **建议**: 需要哪些额外证据才能确认？
\`\`\`

约束：
- 不要接受任何 Finding 为真；你的工作是质疑。
- 每个攻击必须有证据支持（不要臆测）。
- 如果找不到反例，明确说"未找到反例"。`,
  }),

  "05-cross-validation": (repoName) => ({
    target: "05-cross-validation.md",
    text: `# 交叉验证 + Evidence Graph — ${repoName}

你是一位审稿人。请交叉验证所有证据，并构建 **Evidence Graph**，输出到 \`05-cross-validation.md\`。

必读输入：
- \`00-research-questions.md\`
- \`01-hypotheses.md\`
- \`02-ontology.md\`
- \`RQ-*.md\`（所有 Research Question 文件）
- \`04-opponent.md\`（反证者报告）
- \`evidence-brief.md\`
- \`evidence-store/full.json\`

你的任务：

1. **更新 Research Question 状态**：根据证据和反证者报告，更新每个 RQ 的状态
2. **验证假设**：检查每个假设是否被支持、反驳或证据不足
3. **识别证据间冲突**：找出不同 RQ 文件之间的矛盾
4. **校准置信度**：哪些 Finding 应该升级/降级？
5. **构建 Evidence Graph**：统一证据关系图

## Evidence Graph 格式

\`\`\`mermaid
graph LR
    E1[Evidence: src/agent.ts] -->|supports| F1[Finding 1]
    F1 -->|answers| Q1[RQ-001]
    Q1 -->|validates| H1[Hypothesis 1]
    H1 -->|produces| R1[Resolution]
\`\`\`

| Evidence | Supports | Finding | Answers | RQ | Validates | Hypothesis | Confidence |
|----------|----------|---------|---------|----|----|------------|------------|
| src/agent.ts:L45-L80 | supports | F1 | answers | Q1 | validates | H1 | 0.85 |

输出结构：

## Research Question 状态追踪

| RQ | 状态 | 关键发现 | 置信度 | 反证者结论 |
|----|------|----------|--------|------------|
| RQ-001 | Validated / Rejected / Needs Evidence | ... | High / Medium / Low | 成立 / 部分成立 / 不成立 |

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

## Evidence Graph

（见上表）

## 开放问题

- 还需要哪些源码验证才能下结论？`,
  }),

  "06-comparative": (repoName) => ({
    target: "06-comparative.md",
    text: `# 对比分析 — ${repoName}

将 ${repoName} 与**以下显式列出的项目**进行对比，输出到 \`06-comparative.md\`。

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
- \`RQ-*.md\`（选择最相关的 2-3 个）
- \`05-cross-validation.md\`

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

- 哪些设计选择可能在其它场景下成为陷阱？`,
  }),

  "07-report-writer": (repoName) => ({
    target: "report.md",
    text: `# Research Trace 报告撰写 — ${repoName}

你是首席软件架构师。请综合所有证据与 subagent 产出，撰写最终工程研究报告 \`report.md\`。

**严格限制**：
- **禁止创建新的 Finding**。只整合经过 \`05-cross-validation.md\` 验证的 Finding。
- **禁止重新解释**。只引用已被标记为 Validated 的 Research Question。
- **禁止推测**。如果证据不足，明确说「未知」。

**反伪造约束（Anti-Fabrication，最高优先级）**：

历史审计发现 LLM 会系统性地伪造 Finding 引用——发明 ID、篡改置信度、翻转 verified 状态、甚至颠倒 Finding 内容。以下规则为强制要求，违反任一条均为严重错误：

- **ID 完整性**：你引用的每个 \`[F-XXX]\` 必须对应 evidence-brief.md ★ Findings 章节中的真实 Finding ID。禁止发明新 ID，禁止跳过 ID，禁止把 F-005 的内容归给 F-010。
- **置信度逐字引用**：你引用的 \`confidence=X.XX\` 必须与 brief Findings 表格的 Confidence 列**逐字符匹配**（包括小数位）。禁止四舍五入、篡改或凭记忆重写。
- **状态不得反转**：brief 中标记为 \`✅ verified\` 的 Finding，在你的报告中不得被描述为 \`rejected\` 或 \`downgraded\`，反之亦然。若要质疑一个 verified Finding，必须先逐字引用 brief 行，再提供源码反证——但**不得修改 Verified 字段本身**。
- **数字完整性**：所有计数（tools/prompts/evals/tests）必须逐字引用自 brief。若 brief 说"检测到 10 个 tools"，报告不得说"12 个"或"8 个"。若你怀疑某个计数，应在 Architecture Smells 中提出，**不得**默默修改数字。
- **内容不得伪造**：引用 Finding 文本时，必须与 brief 的 \`finding\` 字段匹配。若 brief F-006 写"Detected 10 tools"，报告不得写"No tools detected"。
- **先引用再批判**（强制）：对于你打算 Reject / Downgrade / 重新解释的每个 Finding，必须**先逐字引用 brief 的完整行**（ID / Q / Importance / Confidence / Coverage / Verified / Finding 文本），**再**给出判断。这防止"稻草人"批判——攻击 brief 从未做出的声明。
- **矛盾双向检查**：当你声称 brief"自相矛盾"或"ConsistencyAnalyzer 漏检了矛盾"时，必须先逐字引用 brief §A \`consistency.contradictions[]\` 和 \`consistency.warnings[]\` 的实际内容，再解释你认为漏检了什么。禁止在 brief 实际列出了矛盾时声称"无矛盾"。

**Finding 引用格式**：在 Trace 中引用 Finding 时使用 \`[F-001 @ Q1, confidence=0.85, verified]\`。读者应能从 Trace 追溯回 Findings 章节的对应条目。

必读输入：
- \`evidence-brief.md\`
- \`00-research-questions.md\`
- \`01-hypotheses.md\`
- \`02-ontology.md\`
- \`RQ-*.md\`（只引用状态为 Validated 的）
- \`04-opponent.md\`
- \`05-cross-validation.md\`（包含 Evidence Graph）
- \`06-comparative.md\`（若存在）

**Research Trace 格式**（不是 Summary，而是记录调查过程）：

对于每个 Research Question，按如下结构撰写：

\`\`\`markdown
## RQ-001: {问题}

### Investigation（调查过程）

Initially believed...（最初认为...）

Found contrary evidence...（发现相反证据...）

Read tests...（阅读测试...）

Changed belief...（改变信念...）

### Turning Point（转折点）

The key evidence that changed understanding was...（改变理解的关键证据是...）

### Resolution（最终结论）

Final resolution: ...（最终结论...）

Confidence: High / Medium / Low（置信度...）

Evidence Graph: [引用 05-cross-validation.md 中的 Evidence Graph]
\`\`\`

报告结构遵循 SKILL.md 中的 "Report 结构（Question-centric）"：
1. Executive Summary
2. Research Traces（按 Research Question 组织，记录调查过程）
3. Engineering Decisions（Palantir 风格 Decision Report——见下方格式）
4. Negative Findings
5. Architecture Smells
6. Architecture Fitness（Modularity/Extensibility/Testability 等评分——见下方格式）
7. Architecture Compression（300/100/30 字摘要——见下方格式）
8. Repository Positioning
9. Reusable Pattern Catalog
10. What NOT to Learn（不值得复制的内容——见下方格式）
11. Architecture Evolution
12. Reading Guide
13. Open Questions

## Engineering Decisions 格式（第 3 章）

Palantir Research 是 Decision Report，不是 Architecture Report。每个 Decision 必须包含：

\`\`\`markdown
### Decision D-001: {决策标题}
- **Decision**: {一句话决策陈述}
- **Why**: {为什么做这个决策}
- **Evidence**: \`file.py:L10-L30\`, [F-XXX]
- **Tradeoff**: {放弃了什么}
- **Alternative**: {考虑过但拒绝的替代方案}
- **Status**: Accepted / Deprecated / Superseded
- **Learning**: {可迁移的工程教训}
\`\`\`

## Architecture Fitness 格式（第 6 章）

按以下维度评分（★1-5），引用证据：

\`\`\`markdown
| Dimension | Score | Evidence | Note |
|-----------|-------|----------|------|
| Modularity | ★★★★☆ | architecture.json: 0 cycles | 清晰的模块边界 |
| Extensibility | ★★★☆☆ | plugins/ dir | 插件机制存在但文档少 |
| Testability | ★★★★★ | testFileCount=120 | 测试覆盖核心路径 |
| Observability | ★★☆☆☆ | 无 metrics | 缺少可观测性 |
| Evolution | ★★★★☆ | git_history: 稳定增长 | 健康的演进节奏 |
| Performance | ★★★☆☆ | benchmark/ | 有基准但未持续 |
| Developer Experience | ★★★★☆ | docs/ 完整 | 文档质量高 |
\`\`\`

## Architecture Compression 格式（第 7 章）

\`\`\`markdown
### Architecture in 300 words
{300 字摘要——核心架构、关键决策、主要权衡}

### Architecture in 100 words
{100 字摘要——压缩到本质}

### Architecture in 30 words
{30 字摘要——一句话定义这个系统}
\`\`\`

如果压缩不了，说明其实没有理解。

## What NOT to Learn 格式（第 10 章）

\`\`\`markdown
### 值得学习（Things worth learning）
- ★★★★★ {模式/决策/思想} — {为何值得}
- ★★★★☆ {模式/决策/思想} — {为何值得}

### 不值得复制（Things NOT worth copying）
- {具体内容} — {为何不值得（历史包袱/临时方案/特定上下文）}
\`\`\`

很多项目真正值得学的只有 10%，其它是历史包袱。明确区分"值得学"和"不要抄"。

每条架构结论优先引用 \`[R-XXX]\` 或源码路径；原始 \`[F-XXX]\` 仅作为支持证据。
禁止让 Analyzer 成为叙事主体；禁止复述 Analyzer 之间的争论。
每个 Trace 必须回答一个会改变工程师对系统理解的架构问题。`,
  }),
};

export function writeSubagentPrompts(repoPath, options = {}) {
  const repoName = basename(repoPath);
  const baseDir = options.outDir || process.cwd();
  const outDir = join(baseDir, "subagents");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Stage 0: Question Planner
  // Stage 1: Hypothesis Generator (Bayesian)
  // Stage 2: Ontology Mapper (Behavior Ontology)
  // Stage 3: Dynamic Research Agents (5 questions)
  // Stage 4: Opponent Agent
  // Stage 5: Cross Validation + Evidence Graph
  // Stage 6: Comparative Analysis (optional)
  // Stage 7: Report Writer (Research Trace)

  for (const [key, factory] of Object.entries(PROMPTS)) {
    if (key === "03-research-agent") {
      // Generate 5 RQ agent prompts. The actual question text is NOT hardcoded here —
      // each subagent reads 00-research-questions.md at runtime to find its assigned
      // question (Stage 0 must run before Stage 3). This enforces the "dynamic question
      // planning" principle from plan4.md §1.
      for (let i = 1; i <= 5; i++) {
        const { target, text } = factory(repoName, i);
        const header = `<!-- Target output: ${target} -->\n<!-- Repo: ${repoName} | Question: read from 00-research-questions.md ## Q${i} -->\n\n`;
        writeFileSync(join(outDir, `${key}-${i}.md`), header + text, "utf-8");
      }
    } else {
      const { target, text } = factory(repoName);
      const header = `<!-- Target output: ${target} -->\n<!-- Repo: ${repoName} -->\n\n`;
      writeFileSync(join(outDir, `${key}.md`), header + text, "utf-8");
    }
  }

  const index = `# Subagent 执行顺序

请按以下顺序派发 subagent（可用 Task 工具并行执行无依赖的阶段）：

## Stage 0 — 动态 Research Question 规划
- prompt: \`subagents/00-question-planner.md\`
- output: \`00-research-questions.md\`
- 任务：根据证据动态生成 5 个最适合的 Research Question（不要使用固定模板）

## Stage 1 — 贝叶斯假设生成
- prompt: \`subagents/01-hypothesis.md\`
- output: \`01-hypotheses.md\`
- 任务：生成 3-5 个假设，每个假设包含置信度演进历史（Prior → Posterior）

## Stage 2 — 行为本体映射（Behavior Ontology）
- prompt: \`subagents/02-ontology.md\`
- output: \`02-ontology.md\`
- 任务：提取静态对象（Component/Interface/Service/Adapter/Workflow/Prompt/Tool）+ 行为图（Execution Graph）

## Stage 3 — 动态 Research Question Agents（并行）
- \`subagents/03-research-agent-1.md\` → \`RQ-001.md\`
- \`subagents/03-research-agent-2.md\` → \`RQ-002.md\`
- \`subagents/03-research-agent-3.md\` → \`RQ-003.md\`
- \`subagents/03-research-agent-4.md\` → \`RQ-004.md\`
- \`subagents/03-research-agent-5.md\` → \`RQ-005.md\`

每个 RQ Agent 会：
1. 读取 \`00-research-questions.md\`（找到自己的问题）
2. 读取 \`01-hypotheses.md\` 和 \`02-ontology.md\`
3. 验证或推翻相关假设（包含置信度演进）
4. 输出 Findings（含 Counter Evidence / Alternative Interpretation / Unknowns）
5. 更新 RQ 状态（Open → Investigating → Validated / Rejected / Needs Evidence）
6. 将跨 RQ 共享的发现写入 \`shared-findings.md\`

## Stage 4 — 反证者（Opponent Agent）
- prompt: \`subagents/04-opponent.md\`
- output: \`04-opponent.md\`
- 任务：对每个 Finding 进行攻击（寻找直接矛盾/测试反例/替代解释/缺失证据）

## Stage 5 — 交叉验证 + Evidence Graph
- prompt: \`subagents/05-cross-validation.md\`
- output: \`05-cross-validation.md\`
- 任务：更新 RQ 状态、验证假设、识别冲突、校准置信度、构建 Evidence Graph

## Stage 6 — 对比分析（可选）
- prompt: \`subagents/06-comparative.md\`
- output: \`06-comparative.md\`
- 限制：只允许对比显式列出的项目（OpenAI Agents SDK / LangGraph / Claude Code / Codex / AutoGen / CrewAI / MCP）

## Stage 7 — Research Trace 报告
- prompt: \`subagents/07-report-writer.md\`
- output: \`report.md\`
- 限制：禁止创建新 Finding；只整合 Validated 的 RQ
- 格式：Research Trace（记录调查过程，不是 Summary）
`;

  writeFileSync(join(outDir, "README.md"), index, "utf-8");
  return outDir;
}
