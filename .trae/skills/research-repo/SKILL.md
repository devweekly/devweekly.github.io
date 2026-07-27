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
- AI/Agent 工程师能从中学习到什么？

输出应更像架构评审或工程设计文档，而非代码文档。

---

## Research Principles

1. **Evidence-first**：每个结论必须可追溯到具体证据（源码、测试、提交、配置）。无证据则标记 Unknown，不推测。
2. **Question-centric**：研究由问题驱动，不是由文件遍历驱动。先问"为什么这样设计"，再找证据。
3. **Bayesian**：假设随证据积累而更新置信度。记录置信度演进，而非一次性判断。
4. **Adversarial Validation**：每个 Finding 必须经受对抗性验证。只有经受住反证攻击的 Finding 才可进入报告。
5. **Decision-centric**：报告的核心是工程决策（为什么这样做、放弃了什么、替代方案是什么），而不是架构描述。
6. **Knowledge-Centric**：Repository 只是 Evidence，Knowledge 才是真正产品。每次研究的价值不只在于报告，更在于它为全局知识库贡献了哪些可迁移的抽象（模式、决策、权衡、反模式）。
7. **Brain-first**：研究从已有知识开始，不从零开始。研究问题应聚焦于新颖性——这个仓库与已有知识相比，有哪些相同与不同？已有知识能回答的问题不值得重新研究。

---

## Research Rules

1. **Research Questions**
   Generate only high-impact, evidence-rich and transferable questions.
   Discard questions lacking sufficient repository evidence.

2. **Hypothesis**
   Maintain Bayesian hypotheses.
   Every hypothesis must include competing hypotheses.
   Update confidence as evidence accumulates.

3. **Findings**
   Every finding must include:
   - Evidence
   - Counter Evidence
   - Alternative Interpretation
   - Unknowns
   - Importance (Critical / High / Medium / Low)
   - Confidence (High / Medium / Low)

4. **Validation**
   Every finding must withstand adversarial challenge.
   Only validated findings may appear in the final report.

5. **Reporting**
   The final report is decision-centric.
   Describe engineering decisions, tradeoffs and reusable patterns rather than file summaries.

6. **Knowledge Accumulation**
   Every research session must contribute to the global knowledge base.
   Extract reusable abstractions: patterns, decisions, tradeoffs, anti-patterns.
   Knowledge that cannot transfer to other projects is not worth accumulating.

7. **Novelty Detection**
   Before generating research questions, compare evidence against existing knowledge.
   Focus on what is new, contradictory, or a unique variation of known patterns.
   Already-answered questions should not be re-asked unless there is reason to doubt the answer.

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

## Research Content

### Architecture
Overall architecture, Layering, Responsibilities, Module boundaries, Dependency direction, Initialization flow, Lifecycle, Execution pipeline, Event flow, Data flow, Extension points, Plugin system, Configuration.

### Design Philosophy
作者想解决什么问题？为什么选择这个抽象？为什么不是另一种架构？做了哪些权衡？

### AI Agent Harness
Agent lifecycle, Planning, Execution, Reflection, Retry, Parallelism, Delegation, Cancellation, Checkpoint, Streaming, Context propagation, Human approval, Multi-agent orchestration, Loop prevention, State management, Failure recovery.

### Prompt Engineering
System prompts, Planning prompts, Reflection prompts, Repair prompts, Tool prompts, Compression prompts, Summarization prompts, Hidden prompts, Prompt templates, Few-shot examples, Prompt composition, Dynamic prompt generation, Prompt injection defenses. Prompt evolution, versioning, assembly pipeline, template engine, tool description generation, automatic compression, testing and regression.

### Context Engineering
Conversation memory, Working memory, Scratchpad, Compression, Sliding window, Retrieval, Context selection, Context prioritization, Context pruning, Conversation replay.

### Tool Framework
Tool registration, Schemas, Validation, Permission model, Timeout, Retry, Streaming, Error handling, Approval, Sandbox, Security.

### Guardrails
Hallucination prevention, Prompt injection, Loop detection, Budget limits, Max iterations, Tool whitelist, Permission control, Dangerous operations, Human confirmation, Rate limiting, Resource protection.

### Evaluation & Reliability Engineering
Benchmarks, Regression tests, Golden tests, Snapshots, Reference outputs, Judge LLM, Human evaluation, Rubrics, Metrics, Pass rate, Failure rate, Coverage. Determinism, Replayability, Reproducibility, Cost evaluation, Latency evaluation, Failure analysis, Flakiness mitigation.

### Testing Strategy
Unit tests, Integration tests, E2E, Simulation, Fake LLM, Mock Tool, Golden datasets, Replay, Deterministic execution, Recorded conversations, Regression suite.

### Interesting Engineering Ideas
Interesting abstractions, Elegant APIs, Reusable patterns, Small but clever implementations, Novel architecture, Unexpected simplifications, Performance optimizations, Engineering tricks, Developer experience improvements.

### Architecture Evolution
Major refactors, Breaking changes, Deprecated ideas, Evolution of prompts, Evolution of evaluation methodology, Evolution of APIs, Lessons learned from commit messages, PR descriptions, issue threads.

### Interesting Questions
- Why is this abstraction necessary?
- What would break if this module were removed?
- What is the smallest useful architecture this could be reduced to?
- Which modules are accidental complexity vs. essential complexity?
- Where is the real innovation?
- Which decisions appear over-engineered?
- Which ideas survived across multiple releases?

### Knowledge Extraction
After completing the report, extract reusable abstractions for the global knowledge base:

- **Patterns**: Reusable architecture patterns observed (Planner-Executor, Event Bus, Plugin Registry, etc.). Must be abstractable beyond this repository.
- **Decisions**: Why a design was chosen and under what conditions. Must include applicable context, not just the choice.
- **Tradeoffs**: Benefits, costs, and boundaries of each design. Must be bidirectional (Pros + Cons).
- **Anti-patterns**: Common design problems with failure cases. Must have real examples of failure, not theoretical.
- **Vocabulary**: Unified engineering terms. Consistent terminology across all research enables cross-repo comparison.
- **Concept Graph**: Relationships between patterns, decisions, and concepts (e.g., Planner produces Plan, Plan executed_by Runner).

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

每个结论都应包含 Evidence。

> **结论**：该框架有意将 planning 与 execution 分离。
>
> **证据**：`planner.ts`、`Runner.ts`、`ExecutionContext.ts`、`planner.test.ts`
>
> **Confidence**：High
>
> **原因**：多个模块一致地实现了这种分离。

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
- AI Agent 是如何设计与约束的
- Prompt 是如何组织与演化的
- Evaluation 与 Testing 如何保障可靠性
- 哪些实现模式是可复用的
- 哪些想法是独特或特别优雅的
- 哪些文件和测试是深入研究的最高价值入口
- 这个仓库为全局知识库贡献了哪些新的模式、决策、权衡或反例

读者读完报告后，应该知道接下来两小时该读哪些源代码。
研究完成后，全局知识库应该比研究前更丰富——这是衡量研究价值的最终标准。
