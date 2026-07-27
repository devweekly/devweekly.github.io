---
name: "research-repo"
description: "研究一个开源 Repository，提炼其架构、设计思想、工程权衡与可复用模式。当用户要求研究/分析某个仓库的架构、设计模式或 AI Agent 实现时调用。"
---

# Repository 研究

> 研究一个开源 Repository，提炼其架构、设计思想、工程权衡与可复用模式，而不是仅仅解释代码。

---

## 目标

面向工程视角进行 Repository 研究。目标**不是**总结代码，而是回答：

- 为什么这个 Repository 要这样设计？
- 它在解决哪些工程问题？
- 哪些模式是可复用的？
- 哪些思想可以迁移到别处？

输出应更像架构评审或工程设计文档，而非代码文档。

---

## Research Principles

1. **Evidence-first**：每个结论必须可追溯到具体证据（源码、测试、提交、配置）。无证据则标记 Unknown，不推测。
2. **Question-centric**：研究由问题驱动，不是由文件遍历驱动。先问"为什么这样设计"，再找证据。
3. **Bayesian**：假设随证据积累而更新置信度。记录置信度演进，而非一次性判断。
4. **Adversarial Validation**：每个 Finding 必须经受对抗性验证。只有经受住反证攻击的 Finding 才可进入报告。
5. **Decision-centric**：报告的核心是工程决策（为什么这样做、放弃了什么、替代方案是什么），而不是架构描述。
6. **Unknown is a valid result**：Absence of evidence is preferable to unsupported certainty. 不知道是合法的研究结果。不要为了给出答案而推测——如果证据不足，明确标注 Unknown。
7. **Knowledge reuse**：研究应复用已有经验证的知识，而非从零开始。已有知识能回答的问题不值得重新研究。

---

## Research Rules

1. **Research Questions**
   Questions should maximize:
   - Impact — changes engineer's understanding of the system
   - Evidence richness — verifiable within the repository
   - Transferability — applicable to other systems

   Questions lacking sufficient repository evidence should not be pursued.

2. **Hypothesis**
   Hypotheses are Bayesian:
   - Include prior confidence and posterior confidence
   - Update confidence as evidence accumulates
   - Include competing hypotheses for the same evidence

3. **Findings**
   Every finding includes:
   - Evidence
   - Counter Evidence
   - Alternative Interpretation
   - Unknowns
   - Importance (Critical / High / Medium / Low)
   - Confidence (High / Medium / Low)

4. **Validation**
   Every finding withstands adversarial challenge.
   Only validated findings appear in the final report.

5. **Reporting**
   The final report is decision-centric.
   Engineering decisions, tradeoffs and reusable patterns — not file summaries.

---

## Confidence Standard

| Level | Meaning |
|-------|---------|
| **High** | ≥3 个独立证据源 |
| **Medium** | 2 个证据源 |
| **Low** | 1 个证据源 |
| **Speculative** | 无直接证据 |

**Importance 与 Confidence 独立**：
- README 的存在是 High Confidence 但可能 Low Importance。
- "Planner 为什么存在" 可能 Medium Confidence 但 Critical Importance。

---

## Evidence Hierarchy

高层级证据覆盖低层级证据的声明。当文档说 X 但测试说 Y 时，测试胜出。

| Tier | Source | Trust |
|------|--------|-------|
| **S** | Executable behavior（tests、benchmarks、reproducible runs） | 最高 |
| **A** | Implementation（source code） | 高 |
| **B** | Configuration（manifests、CI、build files） | 中 |
| **C** | Documentation（README、docs、comments） | 较低 |
| **D** | Commit messages、issues、PR descriptions | 较低 |
| **E** | Inference（heuristic、AST patterns、analyzer output） | 最低 |

**冲突处理**：
- 优先信任高层级证据
- 记录冲突并在报告中标注
- 不要用低层级证据否定高层级证据
- 文档声称的功能必须在代码或测试中验证，否则标注为"文档声称但未验证"

---

## Research Content

研究维度按适用性选择，不强制全部覆盖。不同类型的仓库应该产生不同的研究内容。

### 通用维度（适用于大多数仓库）

- **Architecture** — Overall structure, layering, module boundaries, dependency direction, lifecycle, execution pipeline, extension points, configuration.
- **Design Philosophy** — 作者想解决什么问题？为什么选择这个抽象？为什么不是另一种架构？做了哪些权衡？
- **Reliability Engineering** — Testing strategy, evaluation, benchmarks, regression, determinism, reproducibility, failure analysis.
- **Architecture Evolution** — Major refactors, breaking changes, deprecated ideas, lessons learned from history.
- **Interesting Engineering Ideas** — Elegant abstractions, reusable patterns, novel simplifications, performance tricks, developer experience improvements.

### 领域特定架构（动态选择，按仓库类型）

不要强行套用不相关的维度。研究 LLVM 时不需要讨论 Agent lifecycle；研究 DuckDB 时不需要讨论 Prompt Engineering。

| 仓库类型 | 适用维度 |
|---------|---------|
| AI Agent 框架 | Agent lifecycle, planning, execution, reflection, retry, parallelism, cancellation, context propagation, multi-agent orchestration, state management, failure recovery |
| 编译器/语言工具 | Lexer, parser, IR, optimizer, codegen, type system, runtime |
| 数据库/数据系统 | Query planner, executor, storage engine, transaction, concurrency, vectorized execution, replication |
| 开发者工具 | Plugin system, extension API, configuration model, integration patterns |
| 应用/服务 | API design, auth model, data flow, deployment, observability |

### Interesting Questions

- Why is this abstraction necessary?
- What would break if this module were removed?
- What is the smallest useful architecture this could be reduced to?
- Which modules are accidental complexity vs. essential complexity?
- Where is the real innovation?
- Which decisions appear over-engineered?
- Which ideas survived across multiple releases?

---

## Research Mindset

**不要按顺序读文件。** 持续构建假设。

> **假设**：该框架可能会把 planning 与 execution 分离。
>
> **证据**：`Planner`、`Runner`、`ToolExecutor`、`Context`
>
> **结论**：Planning 与 execution 被有意解耦。

永远不要产出逐行文件摘要。永远产出：

```
Problem → Design → Evidence → Tradeoff → Takeaway
```

**不要推测。** 没有 Evidence 就不要推断架构。如果 Evidence 不足，请说 **Unknown**。

---

## Reading Strategy

按以下顺序研究 Repository：

1. **README 与文档** —— 目的、设计哲学、快速开始
2. **Examples** —— 作者希望它如何被使用；设计意图在这里
3. **Tests** —— 预期行为、边界情况、不变式
4. **Public APIs** —— 接口契约、类型签名
5. **Core architecture** —— 模块边界、依赖方向
6. **Internal implementation** —— 在理解上述内容之后再读
7. **Benchmarks and evaluation** —— 团队测量和优化什么
8. **CI and release workflow** —— 质量门禁、发布流水线

---

## Cross Validation

只要可能，用多个来源验证结论：Architecture、Tests、Comments、Documentation、Prompts、Configuration、Examples、CI、Benchmarks。而不是依赖单一来源。

---

## Evidence Collection

每个结论都应包含 Evidence，并标注证据层级。

> **结论**：该框架有意将 planning 与 execution 分离。
>
> **证据**（Tier A）：`planner.ts`、`Runner.ts`、`ExecutionContext.ts`
>
> **证据**（Tier S）：`planner.test.ts` 验证了二者解耦
>
> **Confidence**：High
>
> **原因**：多个模块一致地实现了这种分离，且有测试验证。

---

## Report Quality

### Trace Density over Coverage

每个 Trace 必须回答一个会改变工程师理解的架构问题。精悍 Trace 胜过平庸 Trace——密度优先于覆盖。

每个 Trace 使用结构：**Question → Investigation → Turning Point → Resolution**

- **Investigation**：记录调查过程（最初认为 → 发现相反证据 → 改变信念）
- **Turning Point**：改变理解的关键证据
- **Resolution**：最终结论 + 置信度

### Anti-Fabrication

引用必须真实可追溯。不得发明 ID、篡改置信度、翻转验证状态或伪造内容。

### Report Principles

| 原则 | 要求 |
|------|------|
| **Decision-centric** | 报告核心是工程决策（Why / Tradeoff / Alternative / Learning），不是架构描述。 |
| **Fact vs Interpretation** | 区分无争议的事实与你的判断，读者应能辨别什么是证据、什么是推断。 |
| **Compressed** | 强制压缩以验证理解——如果压缩不了，说明其实没有理解。 |
| **What NOT to Learn** | 明确区分值得学与不要抄。很多项目真正值得学的只有少数，其它是历史包袱。 |
| **Fitness** | 评估架构是否持续满足设计目标，而非仅检测代码味道。 |
| **Why it matters** | 每个 Trace 用一句话说明：如果没有这个洞察，读者会如何误读系统。 |

---

## Output Style

关注：Architecture、Engineering thinking、Tradeoffs、Patterns、Reasoning。

避免：冗长的文件摘要、逐行解释、函数走读、大段代码转储。

---

## Success Criteria

一份成功的报告应让有经验的工程师理解：

- 这个 Repository 为何存在
- 它解决了哪些工程问题
- 哪些架构决策是重要的
- 哪些权衡被做出
- 哪些实现模式是可复用的
- 哪些想法是独特或特别优雅的
- 哪些文件和测试是深入研究的最高价值入口

读者读完报告后，应该知道接下来两小时该读哪些源代码。
