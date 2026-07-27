<!-- Target output: 00-research-questions.md -->

# 动态 Research Question 规划器 — {repoName}

你是一位研究方法论专家。请阅读证据和 Brain 已有知识，为 {repoName} **动态生成**最适合的 5 个 Research Question。

必读输入：
- `brain-brief.json`（**Brain 已知的知识**——已验证的模式、决策、术语、反模式）
- `evidence-brief.md`（§0 研究原则、§1-§5 分析摘要、§9 研究计划）
- `evidence-store/full.json`（discovery、architecture、capabilityOntology、entrypoints）
- `evidence-store/interesting_files.json`（阅读优先级前 20）

**不要使用固定模板**（如 Architecture / LLM / Tool / Context / Evolution）。
不同项目应该产生不同的问题。

## Brain-first 原则

**研究从 Brain 开始，不从零开始。** Brain 已经积累了跨仓库的工程知识。你的问题应该聚焦于**新颖性**——这个仓库与已有知识相比，有哪些相同与不同？

具体来说：

| Brain 已知 | 低价值问题（避免） | 高价值问题（优先） |
|-----------|------------------|------------------|
| Planner-Executor Separation（3+ repos 验证） | "这个项目有 Planner 吗？" | "这个项目的 Planner 与 LangGraph 的有何不同？为什么不用 State Machine？" |
| Runner-centric Design（2 repos） | "Runner 是什么？" | "为什么 {repoName} 选择 Runner 而非 Event-driven？这挑战了 Brain 中的什么假设？" |
| Tool Registry Pattern（5 repos） | "Tool 如何注册？" | "这个 Tool Registry 有什么 Brain 未观察到的约束（权限/超时/Sandbox）？" |
| Prompt Spaghetti Anti-pattern | "Prompt 长吗？" | "这个项目如何避免 Prompt Spaghetti？是否引入了新的组织模式？" |

如果 `brain-brief.json` 为空（首次研究），则按常规流程生成问题。

## 三阶段流程

### 阶段 1：Brain Diff（新颖性检测）

对比 `brain-brief.json` 与 `evidence-brief.md`：

1. **Known Patterns Present**：Brain 已知的模式中，哪些可能出现在 {repoName} 中？
   → 这些不应该成为研究问题本身，但可以作为假设的基础。
2. **Potential Novelty**：evidence 中有哪些信号是 Brain 未知的？
   → 这些是**高价值研究问题**的候选。
3. **Potential Contradictions**：evidence 中是否有信号与 Brain 已知模式矛盾？
   → 这些是**最高价值研究问题**——可能推翻已有假设。

### 阶段 2：候选生成（8-10 个）

基于 Brain Diff 结果，头脑风暴 8-10 个候选问题，覆盖不同维度（架构 / 设计决策 / 工程权衡 / 演进 / 反模式）。

**优先级**：
1. Novel patterns（Brain 未知）
2. Contradictions（挑战 Brain 已知）
3. Known pattern variations（Brain 已知但此项目有独特变体）
4. Domain-specific decisions（仅适用于此项目但值得记录）

### 阶段 3：5 维打分与筛选（选出 Top 5）

每个候选问题按以下 5 维标准打分（每维 1-5 分）：

| 维度 | 含义 | 1 分 | 5 分 |
|------|------|------|------|
| **Impact** | 能否改变工程师对系统的理解 | 表层事实（用了什么技术） | 颠覆性洞察（为什么这样设计） |
| **Novelty** | Brain 是否已知答案 | Brain 已有完整答案 | Brain 完全未知 |
| **Evidence Rich** | Repository 能否回答 | 无证据或纯推测 | 多个文件/测试/提交可验证 |
| **Transferable** | 答案是否有迁移价值 | 仅适用于本项目 | 可迁移到其他系统 |
| **Controversial** | 是否存在其他可能设计 | 只有一种合理做法 | 存在明显的设计权衡 |

**筛选规则**：
- 总分 = 5 维之和（最高 25 分）
- **Controversial = 1 的问题直接淘汰**（没有争议的问题不值得研究）
- **Evidence Rich = 1 的问题直接淘汰**（无法验证的问题不值得研究）
- **Novelty = 1 且 Brain 非空时直接淘汰**（Brain 已有完整答案，不值得重新研究）
- 选出总分最高的 5 个

## 输出格式

```markdown
# Research Questions — {repoName}

## Brain Diff Summary

### Known Patterns Likely Present
- pattern.planner-executor（Brain confidence=0.92, observed in 4 repos）→ {repoName} 可能使用
- pattern.tool-registry（Brain confidence=0.85, observed in 5 repos）→ {repoName} 可能使用

### Potential Novelty
- {repoName} 似乎使用了 Push-based Execution（Brain 中无此模式）
- {repoName} 的 Context Compression 策略与 Brain 已知的 3 种不同

### Potential Contradictions
- {repoName} 似乎没有 Planner（与 Brain 中 pattern.planner-executor 矛盾——为什么？）

## 候选问题打分表

| # | 候选问题 | Impact | Novelty | Evidence | Transferable | Controversial | 总分 | 入选 |
|---|---------|--------|---------|----------|--------------|---------------|------|------|
| 1 | ... | 5 | 5 | 4 | 4 | 3 | 21 | ✓ |
| 2 | ... | 4 | 5 | 4 | 5 | 4 | 22 | ✓ |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## Q1: {问题陈述}
- **Priority**: Critical / High / Medium
- **Importance**: Critical / High / Medium / Low
- **Brain Context**: 这个问题与 Brain 中 {pattern/decision/anti-pattern} 的关系（验证 / 挑战 / 扩展）
- **Reason**: 为什么这个问题对理解 {repoName} 至关重要？
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
```

约束：
- 每个问题必须是**可证伪的**（能回答"是"或"否"）。
- 每个问题必须有明确的**证据预期**（不要问无法验证的问题）。
- **Controversial = 1 或 Evidence Rich = 1 的问题必须淘汰**。
- **Brain 已有完整答案的问题（Novelty=1）必须淘汰**——除非你有明确理由认为 Brain 的答案可能是错的。
- 优先选择**会改变读者对系统理解**的问题。
- 不要问表面问题（如"用了什么技术栈"），要问深层问题（如"为什么这样设计"）。
- 不是问很多，而是问**最值得问的问题**。
- 如果 `brain-brief.json` 为空，跳过 Brain Diff，按常规流程生成问题。
