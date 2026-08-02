---
name: "July-Old-research-repo"
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

## Pipeline 架构

研究 Pipeline 采用 **4 层分层推理**（3 层 LLM + 1 层规则生成）：

```
Mechanical Evidence          (事实层 — AST/Graph/Metrics/Git)
        │
        ▼
Knowledge Graph              (事实层 — Entity/Relationship/Attributes)
        │ Stage 1: Knowledge Modeling (LLM call 1)
        ▼
Semantic Findings            (解释层 — 统一 Finding 对象，type 区分)
        │ Stage 2: Interpretation (LLM call 2)
        ▼
Repository Fingerprint       (浓缩层 — 规则生成，不单独 LLM)
        │ Stage 3: buildFingerprint() (规则)
        ▼
Narrative Report             (展示层 — 只是 Renderer)
        │ Stage 4: Narrative (LLM call 3)
```

### 四种核心数据结构

1. **Knowledge Graph (KG)** — 事实层。Entity 使用 capability 名（如 "LLM Integration"），不使用 package 路径。只描述事实和关系，不掺杂评价。
2. **Semantic Findings** — 解释层。统一 `Finding` 对象，通过 `type` 字段区分（constraint / decision / tension / omission / leverage / mental_model）。所有 Finding 必须引用 KG 实体。
3. **Repository Fingerprint** — 浓缩层。由规则生成（`buildFingerprint(kg, findings)`），不消耗 LLM。包含 style/architecture/evolution/domain/maturity/complexity/engineering_taste。
4. **EvidenceRef** — 统一证据引用格式（id / kind / path / symbol / commit / excerpt / score）。

### 推理分层契约

| 层 | 输入 | 输出 | 允许推断意图 |
|----|------|------|-------------|
| Knowledge Modeling | AST / 依赖 / Git / Metrics / Documents | Entity / Relationship / Attributes / Evolution | 否 |
| Interpretation | Knowledge Graph + Documents + Evidence Brief | 统一 Finding 对象 | 是 |

Mental Model / Constraint / Intent 不直接从零散代码推断，而是建立在已验证的知识图谱之上。

**主线始终是 Repository Research，不向 Palantir Ontology 演进。**

---

## Research Principles

1. **Evidence-first**：每个结论必须可追溯到具体证据。无证据则标记 Unknown，不推测。
2. **Question-centric**：研究由问题驱动，不是由文件遍历驱动。先问"为什么这样设计"，再找证据。
3. **Decision-centric**：报告的核心是工程决策（为什么这样做、放弃了什么、替代方案是什么），而不是架构描述。
4. **Unknown is a valid result**：Absence of evidence is preferable to unsupported certainty. 不知道是合法的研究结果——不要为了给出答案而推测。
5. **Fact vs Interpretation**：读者应能辨别什么是证据、什么是推断。文档声称必须在代码或测试中验证，否则标注"未验证"。
6. **Higher-tier-wins**：Executable behavior (tests) > Implementation (source) > Configuration > Documentation > Commit > Inference。冲突时高层级覆盖低层级。
7. **Knowledge reuse**：研究应复用已有经验证的知识，而非从零开始。

---

## Repository Archetype

研究开始前，先判断仓库类型，再决定研究重点。不要对所有仓库套用同一套研究维度。

| Archetype | 研究重点 |
|-----------|---------|
| AI Agent 框架 | Agent lifecycle, planning, execution, reflection, context, tools |
| 编译器/语言工具 | Lexer, parser, IR, optimizer, codegen, type system |
| 数据库/数据系统 | Query planner, executor, storage, transaction, concurrency |
| 开发者工具 | Plugin system, extension API, configuration model |
| 应用/服务 | API design, auth, data flow, deployment, observability |
| Library/SDK | API design, abstraction boundaries, integration patterns |

研究 LLVM 时不需要讨论 Agent lifecycle；研究 DuckDB 时不需要讨论 Prompt Engineering。

---

## Research Content

研究维度按 Archetype 动态选择，不强制全部覆盖。

### 通用维度

- **Architecture** — Structure, layering, module boundaries, dependency direction, lifecycle, extension points.
- **Design Philosophy** — 作者想解决什么问题？为什么选择这个抽象？做了哪些权衡？
- **Engineering Constraints** — 什么约束驱动了设计？哪些替代方案被有意放弃？
- **Design Tensions** — 对立的设计力量（简单 vs 灵活、编译时 vs 运行时、函数 vs 抽象）。
- **Architectural Leverage** — 删除哪些模块会断什么？哪些是承重墙，哪些是装饰？
- **Deliberate Omissions** — 哪些常见工程实践被有意省略？为什么？这反映了什么哲学？
- **Architecture Evolution** — Major refactors, breaking changes, deprecated ideas.
- **Interesting Engineering Ideas** — Elegant abstractions, reusable patterns, novel simplifications.

### Interesting Questions

- Why is this abstraction necessary?
- What would break if this module were removed?
- Which modules are accidental complexity vs. essential complexity?
- Where is the real innovation?
- Which decisions appear over-engineered?
- Which ideas survived across multiple releases?
- What future evolution does this decision enable?

---

## Honest Limits

研究必须明确边界，不掩饰不确定性。

**不能做的事**：
- 不能从 README 推断未在代码中实现的功能
- 不能从单次提交推断长期设计意图
- 不能从公开观点推断作者的信仰
- 不能用低层级证据否定高层级证据
- 不能把推测包装为结论

**必须做的事**：
- 必须在报告中标注 **Unknown**（不知道）
- 必须区分"文档声称"与"代码验证"
- 必须为结论提供 **Alternative Explanation**（替代解释）

**Unknown 是合法的研究结果**，不是失败。承认不知道比给出错误答案更有价值。

---

## Report Quality

### Trace Density over Coverage

每个 Trace 必须回答一个会改变工程师理解的架构问题。精悍 Trace 胜过平庸 Trace。

### Quality Gate

报告完成前，自问：

> 如果我是 Palantir Architect / Google Staff Engineer / Redis 作者 / DuckDB 作者 / OpenAI SDK 作者，会接受这份报告吗？

如果不接受，找出原因并修改：
- 是否有 Claim 缺乏多重证据？
- 是否有 Claim 未考虑替代解释？
- 是否有重要决策未被讨论？
- 是否有 Unknown 被掩饰为结论？
- 报告是否只是"是什么"的堆砌，而非"为什么"的洞察？

### Report Principles

| 原则 | 要求 |
|------|------|
| **Decision-centric** | 报告核心是工程决策，不是架构描述。每个 Decision 必须含 Intent / Tradeoff / Alternatives。 |
| **Object-oriented language** | 报告使用能力语言（"Decision X 被 Constraint Y 驱动，由 Evidence Z 支持"），而非文件驱动语言（"在 foo.py 中看到..."）。 |
| **Compressed** | 如果压缩不了，说明其实没有理解。 |
| **What NOT to Learn** | 明确区分值得学与不要抄。 |
| **Honest Limits** | 报告必须包含 Unknown / Missing Evidence / Alternative Explanation。 |

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
