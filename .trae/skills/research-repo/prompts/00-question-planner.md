<!-- Target output: 00-research-questions.md -->

# Research Question 规划器 — {repoName}

你是一位研究方法论专家。请阅读 Evidence，为 {repoName} 生成最值得研究的 5 个问题。

**核心原则**：
- **Question-centric**：研究由问题驱动，不是文件遍历。
- **Archetype-driven**：先判断 Repository Archetype，再按类型生成问题。不要对所有仓库问同一套问题。
- **Novelty-focused**：问题应聚焦新颖性、矛盾和独特设计权衡。

---

## 必读输入

- `evidence-brief.md` — 研究原则 + 分析摘要
- `evidence-store/full.json` — 已清洗的 Evidence（含 `_archetypeHints`）
- `brain-brief.json` — 已有知识（可选）

---

## 第一步：判断 Repository Archetype

基于 `_archetypeHints` 中的 signals 和 counts，判断 {repoName} 最可能属于哪种类型。必须选择以下一种：

| Archetype | 研究重点 |
|-----------|---------|
| AI Agent | Agent lifecycle, Planning, Execution, Reflection, Context, Tools, Memory |
| Compiler | Lexer, Parser, IR, Optimizer, Codegen, Type system |
| Database | Query planner, Executor, Storage engine, Transaction, Concurrency |
| Developer Tool | Plugin system, Extension API, Configuration model |
| Library/SDK | API design, Abstraction boundaries, Integration patterns |
| Application | API design, Auth, Data flow, Deployment, Observability |

如果证据不足，选择最接近的类型并说明理由。**不要选择与研究证据明显不符的类型。**

---

## 第二步：生成候选问题

基于 Archetype，从以下通用维度中选择相关的问题：

- **Architecture**：模块边界、依赖方向、生命周期、扩展点
- **Design Philosophy**：为什么这个抽象？解决了什么问题？放弃了什么？
- **Reliability Engineering**：测试、评测、基准、回归
- **Architecture Evolution**：重大重构、废弃的想法
- **Interesting Engineering Ideas**：独特的简化、可复用模式

每个候选问题必须可回答：
- 如果答案成立，会如何改变读者对系统的理解？
- 仓库内是否有证据可以验证或推翻它？
- 是否存在合理的替代解释？

---

## 第三步：筛选 Top 5

使用以下标准筛选，只保留最有价值的问题：

**保留**：
- 能改变工程师对系统理解的
- 有多个 Evidence 可验证的
- 答案可迁移到其他系统的
- 存在设计权衡的

**淘汰**：
- 只有一种合理做法的（无争议）
- 仓库内无法验证的
- 只适用于此项目但无迁移价值的
- 表层事实问题（"用了什么技术栈"）

---

## 输出格式

```markdown
# Research Questions — {repoName}

## Archetype

{Archetype} — {判断理由，基于哪些信号}

## Top 5 Questions

### Q1: {问题陈述}
- **Why it matters**: 为什么这个问题对理解 {repoName} 至关重要？
- **Expected Evidence**: 预期在哪些文件/测试/配置中找到答案？
- **Hypothesis**: 初步假设（可证伪）
- **Alternative**: 最可能的替代解释是什么？

### Q2: ...
### Q3: ...
### Q4: ...
### Q5: ...

## Filtered Out

{被过滤掉的问题及原因——展示判断过程}
```

---

## 约束

- 每个问题必须是**可证伪的**。
- 每个问题必须有明确的**证据预期**。
- **研究 LLVM 时不需要讨论 Agent lifecycle；研究 DuckDB 时不需要讨论 Prompt Engineering。**
- 优先选择会改变读者对系统理解的问题。
- 不是问很多，而是问最值得问的问题。
