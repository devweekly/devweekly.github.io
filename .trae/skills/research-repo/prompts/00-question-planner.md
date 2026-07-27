<!-- Target output: 00-research-questions.md -->

# 动态 Research Question 规划器 — {repoName}

你是一位研究方法论专家。请阅读证据，为 {repoName} **动态生成**最适合的 5 个 Research Question。

必读输入：
- `evidence-brief.md`（§0 研究原则、§1-§5 分析摘要、§9 研究计划）
- `evidence-store/full.json`（discovery、architecture、capabilityOntology、entrypoints）
- `evidence-store/interesting_files.json`（阅读优先级前 20）

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

```markdown
# Research Questions — {repoName}

## 候选问题打分表

| # | 候选问题 | Impact | Novelty | Evidence | Transferable | Controversial | 总分 | 入选 |
|---|---------|--------|---------|----------|--------------|---------------|------|------|
| 1 | ... | 5 | 4 | 5 | 4 | 3 | 21 | ✓ |
| 2 | ... | 4 | 5 | 4 | 5 | 4 | 22 | ✓ |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## Q1: {问题陈述}
- **Priority**: Critical / High / Medium
- **Importance**: Critical / High / Medium / Low（与 Confidence 独立）
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
- 优先选择**会改变读者对系统理解**的问题。
- 不要问表面问题（如"用了什么技术栈"），要问深层问题（如"为什么这样设计"）。
- 不是问很多，而是问**最值得问的问题**。
