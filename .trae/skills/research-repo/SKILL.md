---
name: "research-repo"
description: "研究一个开源 Repository，提炼其架构、设计思想、工程权衡与可复用模式。当用户要求研究/分析某个仓库的架构、设计模式或 AI Agent 实现时调用。"
---

# Repository 研究

> 研究一个开源 Repository，提炼其架构、设计思想、工程权衡与可复用模式，而不是仅仅解释代码。生成中文报告。

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
3. **Bayesian**：假设随证据积累而更新置信度，而非一次性判断。
4. **Adversarial Validation**：每个结论必须经受对抗性验证。只有经受住反证攻击的结论才可进入报告。
5. **Decision-centric**：报告的核心是工程决策（为什么这样做、放弃了什么、替代方案是什么），而不是架构描述。
6. **Unknown is a valid result**：Absence of evidence is preferable to unsupported certainty. 不知道是合法的研究结果——不要为了给出答案而推测。
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

## Research Judgment System

Skill 的核心是判断标准，不是执行步骤。以下定义什么值得研究、什么值得相信、什么值得写入报告。

### Research Object Model

研究过程产生多种类型的 **Research Object**，不只是 Claim。每个对象有类型、生命周期状态、来源 Analyzer 和证据回溯。

| Type | 含义 | 触发 |
|------|------|------|
| **Pattern** | 可迁移的架构或设计模式 | 多模块反复出现的一致结构 |
| **Decision** | 工程设计决策（含 Problem/Alternatives/Tradeoff/Chosen/Evidence/Risk/Reusability） | 显式设计选择 |
| **Constraint** | 驱动决策的约束（manifest/code/config/pattern） | 决策的驱动因素 |
| **Tradeoff** | 决策的代价 | 每个 Decision 至少一个 |
| **Assumption** | 隐式假设（可能没有显式证据） | 从缺失证据推断 |
| **Hypothesis** | 待验证的研究假设 | Research Question 触发 |
| **Evidence** | 来自代码/测试/配置/提交的事实 | Analyzer 抽取 |
| **Finding** | 已验证的发现 | Hypothesis 经证据支持 |
| **Issue** | 矛盾或问题 | 跨 Analyzer 冲突 |
| **Risk** | 失败模式 | 高风险 Assumption 或 Decision |
| **Unknown** | 主动分类的未知 | 证据不足 |

**对象之间形成关系图**（不是线性流水线）：Pattern `implemented_by` Module，Evidence `supports` Finding，Decision `constrained_by` Constraint，Hypothesis `competes_with` alternative Hypothesis。

### Object Lifecycle

每个 Research Object 有生命周期，不是一次性判断。状态迁移反映证据积累：

```
Candidate → Hypothesis → Supported → Verified → Decision → Reusable Pattern
    ↓          ↓            ↓           ↓          ↓
  rejected  rejected     rejected   rejected   deprecated
```

- **Candidate**：刚发现，尚未验证
- **Hypothesis**：可被证据支持或反对
- **Supported**：有多源证据支持
- **Verified**：通过对抗性验证 + 测试/代码双重验证
- **Decision**：已确认的工程决策（含 ADR 字段）
- **Reusable Pattern**：跨仓库可迁移的模式

很多发现最后不会进入报告——中间有生命周期让 Agent 的思考稳定，而非一开始就下结论。

### Evidence Provenance

每条 Evidence 必须可追溯，包含：

- **where**：文件路径 + 行号或符号
- **who**：提取者（Analyzer 名 / LLM 阶段）
- **when**：commit hash（如果是 git 仓库）
- **source**：证据类型（AST / regex / graph / git / manifest / keyword / inference）
- **confidence**：0-1 数值（来自证据源权重聚合）

无 Provenance 的 Evidence 不可进入报告。

### 什么算高价值 Research Question

**值得研究的问题**：
- 能改变工程师对系统理解的（Impact）
- 仓库内有多处证据可验证的（Evidence richness）
- 答案可迁移到其他系统的（Transferability）
- 存在合理的设计权衡的（Controversial）

**不值得研究的问题**：
- 只有一种合理做法的问题（无争议）
- 仓库内无法验证的问题（无证据）
- 只适用于此项目的问题（无迁移价值）
- 表层事实问题（"用了什么技术栈"）

### 什么算可信的 Evidence

可信的 Evidence 必须满足**多重性**：

- **多来源**：来自不同类型的证据（代码 + 测试 + 配置 + 提交）
- **多模块**：跨越多个模块一致地出现，而非孤立于单文件
- **多层级**：高层级证据（测试）+ 低层级证据（文档）相互支持

单一来源的证据最多 Medium Confidence。

### 什么算好的 Claim

一个好的 Claim 必须回答三个问题：

1. **为什么成立？** — 支持证据是什么？为什么这些证据可信？
2. **为什么可能错？** — 反证是什么？有哪些替代解释？还缺什么证据？
3. **为什么重要？** — 如果没有这个洞察，读者会如何误读系统？

**坏的 Claim 特征**：
- 只回答"是什么"，不回答"为什么"
- 只有利，没有弊（没有 tradeoff）
- 只有结论，没有反证
- 只有一个证据源
- 适用于任何项目（缺乏特异性）

### 什么时候停止研究

- 当进一步阅读不再改变任何 Object 的置信度时
- 当剩余问题都是仓库内无法验证的时
- 当已有 Object 能完整回答核心 Research Questions 时

### 什么时候继续深挖

- 当发现与已有假设矛盾的证据时
- 当一个 Object 只有单一证据源时
- 当对抗性验证提出了无法反驳的反例时
- 当架构演进历史显示曾有重大设计转向时

---

## Evidence Acceptance Rules

一个 Claim 被接受进入报告前，必须通过以下检查：

| Rule | 要求 | 不过则 |
|------|------|--------|
| **Multi-source** | 至少 2 种不同类型的证据（如代码 + 测试） | 降级为 Speculative |
| **Cross-validated** | 至少 2 个模块或文件一致支持 | 标注"孤立证据" |
| **Higher-tier-wins** | Verified > Partially Verified > Documentation Only | 文档声称未在代码验证的，标注"未验证" |
| **Adversarial-survived** | 对抗性验证尝试反证后仍未被推翻 | 不进入报告 |
| **Alternative-explained** | 已考虑至少 1 个替代解释并说明为何不成立 | 标注"未考虑替代解释" |

---

## Evidence Quality

证据标注使用三种质量等级。报告中的每个 Claim 必须标注其证据质量。

| Quality | 含义 | 要求 |
|---------|------|------|
| **Verified** | 代码 + 测试双重验证 | 源码文件存在 + 测试覆盖 |
| **Partially Verified** | 代码存在，但测试不足 | 源码文件存在，无对应测试 |
| **Documentation Only** | 只在 README/docs 中声称 | 未在代码或测试中验证 |

**规则**：
- 文档声称的功能必须在代码或测试中验证，否则标注为 **Documentation Only — 未验证**。
- 当文档说 X 但测试说 Y 时，测试胜出。
- 单一证据源（如只有一个文件引用）最多 Medium Confidence。

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
- 必须在报告中标注 **Missing Evidence**（证据不足）
- 必须在报告中标注 **Need More Reading**（需进一步阅读）
- 必须为每个结论提供 **Alternative Explanation**（替代解释）
- 必须区分"文档声称"与"代码验证"

**Unknown 是合法的研究结果**，不是失败。承认不知道比给出错误答案更有价值。

### Unknown 的主动分类

Unknown 不是单一的"不知道"——必须主动分类，告诉读者下一步该怎么做：

| Unknown Type | 含义 | 下一步 |
|--------------|------|--------|
| **Need Reading** | 仓库内有相关文件但本研究未覆盖 | 列出应读但未读的文件 |
| **Need External Evidence** | 仓库内无法验证，需要外部资料（issue/PR/discussion/blog） | 列出应查询的外部来源 |
| **Impossible to Verify** | 即使深入阅读也无法验证（设计意图、未发生的场景） | 明确标注为不可验证 |

被动标注 Unknown 不够——必须为每个 Unknown 给出分类理由和推荐下一步。

---

## Distillation Rules

**过滤优先于生成。** 好的报告不是包含最多内容的报告，而是经过最严格筛选的报告。

研究过程是一个不断收敛的漏斗：

```
候选发现 (100)
    ↓  Cross Validation（跨来源验证）
存活 (40)
    ↓  Adversarial Challenge（对抗性反证）
存活 (18)
    ↓  Evidence Acceptance（证据准入）
存活 (7)
    ↓  Importance（重要性筛选）
报告 (5)
```

**报告理想数量**：5 条精悍 Trace，而非 40 条平庸 Claim。

**淘汰标准**：
- 单一证据源 → 淘汰或降级
- 无法经受对抗性反证 → 淘汰
- 不改变读者对系统的理解 → 淘汰
- 适用于任何项目（缺乏特异性） → 淘汰
- 只有"是什么"没有"为什么" → 淘汰

**保留标准**：
- 改变读者对系统理解的 → 保留
- 有明确 tradeoff 的 → 保留
- 可迁移到其他系统的 → 保留
- 与已有假设矛盾的 → 保留（最高价值）

---

## Research Content

研究维度按 Archetype 动态选择，不强制全部覆盖。

### 通用维度

- **Architecture** — Structure, layering, module boundaries, dependency direction, lifecycle, extension points.
- **Design Philosophy** — 作者想解决什么问题？为什么选择这个抽象？做了哪些权衡？
- **Reliability Engineering** — Testing, evaluation, benchmarks, regression, determinism.
- **Architecture Evolution** — Major refactors, breaking changes, deprecated ideas.
- **Interesting Engineering Ideas** — Elegant abstractions, reusable patterns, novel simplifications.

### Interesting Questions

- Why is this abstraction necessary?
- What would break if this module were removed?
- Which modules are accidental complexity vs. essential complexity?
- Where is the real innovation?
- Which decisions appear over-engineered?
- Which ideas survived across multiple releases?

---

## Research Mindset

**不要按顺序读文件。** 持续构建假设。

```
Problem → Design → Evidence → Tradeoff → Takeaway
```

**不要推测。** 没有 Evidence 就不要推断架构。如果 Evidence 不足，请说 **Unknown**。

---

## Reading Strategy

1. **README 与文档** — 目的、设计哲学
2. **Examples** — 设计意图
3. **Tests** — 预期行为、不变式
4. **Public APIs** — 接口契约
5. **Core architecture** — 模块边界
6. **Internal implementation** — 在理解上述内容之后
7. **Benchmarks and evaluation** — 团队测量什么
8. **CI and release workflow** — 质量门禁

---

## Report Quality

### Trace Density over Coverage

每个 Trace 必须回答一个会改变工程师理解的架构问题。精悍 Trace 胜过平庸 Trace。

每个 Trace 使用结构：**Question → Investigation → Turning Point → Resolution**

- **Investigation**：最初认为 → 发现相反证据 → 改变信念
- **Turning Point**：改变理解的关键证据
- **Resolution**：最终结论 + 置信度 + 替代解释

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
| **Decision-centric** | 报告核心是工程决策，不是架构描述。每个 Decision 必须含 Problem / Alternatives / Tradeoff / Chosen / Evidence / Risk / Reusability 七字段（ADR 风格）。 |
| **Object-oriented language** | 报告使用研究对象语言（"Decision X 被 Constraint Y 驱动，由 Evidence Z 支持"），而非文件驱动语言（"在 foo.py 中看到..."）。 |
| **Fact vs Interpretation** | 读者应能辨别什么是证据、什么是推断。 |
| **Compressed** | 如果压缩不了，说明其实没有理解。 |
| **What NOT to Learn** | 明确区分值得学与不要抄。 |
| **Fitness** | 评估架构是否持续满足设计目标。 |
| **Honest Limits** | 报告必须包含 Unknown / Missing Evidence / Alternative Explanation，且 Unknown 必须主动分类（Need Reading / Need External Evidence / Impossible to Verify）。 |
| **Pattern Reusability** | 每个可迁移 Pattern 必须含 Applicability（何时用）/ Limitation（何时不用）/ Migration Cost（迁移成本）/ Reuse Score（复用评分）。不要只写"使用 X"，要写"何时应该用、何时不要用、成本、收益"。 |

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
