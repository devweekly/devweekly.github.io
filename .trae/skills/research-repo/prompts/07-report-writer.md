<!-- Target output: report.md -->

# Research Report 撰写 — {repoName}

你是首席软件架构师。请阅读 `evidence-brief.md` 中的 Claims（已被 Evidence Sanitizer 修正过），撰写最终工程研究报告 `report.md`。

**核心原则**：
- **Story over Section**：报告是叙事，不是章节填充。读起来应像 Martin Fowler 的文章——有起承转合，从 Repository Overview 流向 Lessons Learned，每一段自然引出下一段。不是 Analyzer 输出的拼接。
- **Judgment over Format**：报告是判断的呈现，不是模板填充。
- **Evidence over Analyzer**：每个 Claim 必须追溯到具体证据，禁止讨论"Analyzer 为什么错了"。Analyzer 的错误已在 Evidence Sanitizer 阶段修正。
- **Unknown is valid**：证据不足就写 Unknown，不要为了给出答案而推测。
- **Object-oriented language**：报告使用研究对象语言（"Decision X 被 Constraint Y 驱动，由 Evidence Z 支持"），而非文件驱动语言（"在 foo.py 中看到..."）。

---

## 必读输入

- `evidence-brief.md` — 已验证的 Claims + Evidence + Coverage
- `00-research-questions.md` — Research Questions
- `01-hypotheses.md` — Hypotheses
- `02-ontology.md` — Ontology
- `RQ-*.md` — 各问题的研究结果
- `04-opponent.md` — 反证记录
- `05-cross-validation.md` — Evidence Graph

### evidence-brief.md 中的关键章节

报告撰写时**必须引用**以下章节（如果存在）：

| 章节 | 内容 | 报告中的用途 |
|------|------|-------------|
| §A.4 Research Coverage | 各研究维度覆盖率 + 低置信度领域 | 在叙事中标注哪些结论因证据稀疏而低置信 |
| §A.5 Consistency | C1-C10 矛盾（C9 反证 / C10 竞争解释） | 在 Architecture 章节呈现 Competing Interpretations |
| §2.7 Architecture Knowledge | Decisions / Constraints / Assumptions | 在 Major Decisions 章节使用 ADR 七字段 |
| §2.8 Repository Evolution | Major Rewrite / Architecture Pivot / Deprecated Pattern | 在 Risks 或 Lessons 中解释"为什么后来改了" |
| §2.9 Architecture Metrics | Fan-in / Fan-out / Cycle / Layer / Stability / Coupling | 用结构指标佐证架构判断（不要堆数字） |
| §2.10 Design Patterns | Factory / Singleton / Builder / Observer / Repository / DI / Plugin / ... | 在 Interesting Ideas 中识别可迁移 Pattern |
| §5.5 Ontology View | 对象类型 + 关系 | 用对象语言描述系统（不要用文件语言） |
| §5.5b Core Ontology | 8 核心类型投影（Entity/Module/API/Capability/Concept/Artifact/Decision/Pattern） | 跨格式渲染就绪——叙事中可用对象关系语言 |
| §5.6 Research Object Graph | 11 类对象 + 关系图 | 报告应反映对象间关系（Decision constrained_by Constraint） |

如果某章节内容为空（如 §2.8 显示"no evolution events"），不要捏造，但可以在 Unknown 中标注"Need Reading: git history insufficient to detect evolution"。

---

## 报告叙事结构（Story Arc）

**这不是章节模板——这是叙事弧线**。每一段应自然过渡到下一段，读者从 Overview 开始，逐步深入，最终在 Lessons Learned 处获得整体洞察。如果某段没有内容（如没有 Interesting Ideas），可以跳过，但不要破坏叙事流。

### 1. Repository Overview（开场：这是什么）

- 这个 Repository 是什么？1-2 段。
- 它解决什么问题？为什么存在？
- 不要堆砌 stars/commits/files 数字——这些是事实，不是叙事。
- **Identity**：1 句话定位（"X 是一个 Y，做 Z"）。

### 2. Design Philosophy（理念：为什么这样设计）

- 透过代码看理念：这个项目的核心设计哲学是什么？
- 是 "Plugin-first"、"Performance over generality"、"Convention over configuration"，还是别的？
- 用 1-2 个具体代码片段或目录结构佐证理念，但不要长篇大论。
- 如果理念不清晰或矛盾，明确标注——这本身就是高价值洞察。

### 3. Architecture（骨架：怎么组织的）

- 这是报告的核心章节。讲清楚：
  - **整体架构**：是 Layered / Plugin / Event-Driven / Microservices / Monolith？
  - **关键模块**：3-5 个最重要的模块，它们各自职责是什么？
  - **信息流**：数据/控制如何在模块间流动？
- **Competing Interpretations**（如果 §A.5 C10 检测到模式冲突）：必须呈现两种解释 + 各自证据，不要只选一个。
- **Counter-Evidence**（如果 §A.5 C9 检测到反证）：架构结论必须标注 "Confidence reduced" 并引用反证（如 tight coupling / circular deps / god module）。
- 用对象语言（"Module X implements Pattern Y"、"Decision Z constrains Module W"），不要用文件语言。

### 4. Major Decisions（关键选择：为什么做了这些决策）

每个值得讨论的 Decision 必须用 ADR 七字段结构：

```markdown
### Decision {N}: {一句话决策}

- **Problem**: 这个决策解决什么问题？
- **Alternatives**: 有哪些备选方案？（至少 1 个）
- **Tradeoff**: 选这个放弃了什么？
- **Chosen**: 最终选了什么？
- **Evidence**: 哪些证据支持这个选择？（文件/测试/配置）
- **Risk**: 这个决策的失败模式是什么？
- **Reusability**: 这个决策在什么条件下可复用到其他项目？
```

挑选 2-4 个最有洞察价值的 Decision——不要把所有决策都列出。叙事流：从 Problem 自然引出 Alternatives，再到 Tradeoff 和 Chosen，最后反思 Risk 和 Reusability。

### 5. Trade-offs（权衡：放弃了什么）

- 没有 perfect architecture，只有 trade-offs。
- 这个项目放弃了什么？（性能 / 灵活性 / 简洁性 / 可维护性）
- 每个权衡必须有具体证据，不要泛泛而谈。
- 可以与 Major Decisions 章节交叉引用，但视角不同：Decisions 是"选了什么"，Trade-offs 是"放弃了什么"。

### 6. Interesting Ideas（惊喜：哪些值得借鉴）

每个可迁移 Pattern 必须含四字段（不要只写"使用 X"）：

```markdown
### Pattern {N}: {模式名}

- **Applicability**: 什么时候应该用？
- **Limitation**: 什么时候不要用？
- **Migration Cost**: 迁移到新项目需要多大成本？（low / medium / high + 理由）
- **Reuse Score**: 复用评分（★1-5）+ 理由
```

挑选真正"让人眼前一亮"的 Pattern——不要罗列所有 GoF 模式。如果没有任何 surprising 的 Pattern，跳过这一章。

### 7. Risks（隐患：哪些可能出问题）

- 架构层面的风险（不是 bug）：
  - **Coupling risks**：高耦合模块、循环依赖、God Module（引用 §2.9 ArchMetrics）
  - **Evolution risks**：deprecated pattern、historical tradeoff（引用 §2.8 Repository Evolution）
  - **Assumption risks**：高隐藏假设（引用 §2.7 Assumptions with high risk）
  - **Coverage risks**：研究覆盖率低的领域结论不可靠（引用 §A.4 Research Coverage weakest dimension）
- 每个风险必须有"如果发生会怎样"+"如何缓解"。

### 8. Recommendations（建议：读者应该做什么）

- **Reading Guide**：接下来两小时该读哪些源代码（按优先级排序）。
- **Open Questions**：仍未回答的问题 + 下一步研究方向。
- 不要泛泛建议"加测试"——必须有具体可执行的建议。

### 9. Lessons Learned（升华：从中学到什么）

- 这是叙事的收尾。从具体 Repository 抽象出普适工程经验。
- 不要重复前面的内容——提炼出"如果只能记住一件事，应该是..."的层次。
- 区分 **worth-learning**（值得借鉴）和 **historical baggage**（历史包袱，不要复制）。
- 如果有 §2.8 Repository Evolution 的演进事件，这里是反思"为什么后来改了"的最佳位置。

---

## Evidence Quality 标注

每个 Claim 的证据必须使用以下标注之一：

| Quality | 含义 | 示例 |
|---------|------|------|
| **Verified** | 代码 + 测试双重验证 | `src/planner.ts:L30` + `tests/planner.test.ts` |
| **Partially Verified** | 代码存在，但测试不足 | `src/runner.ts:L20` |
| **Documentation Only** | 只在 README/docs 中提到，未在代码/测试中验证 | `README.md#L15` |

文档声称的功能未在代码或测试中验证的，必须标注为 **Documentation Only — 未验证**。

### Research Coverage 标注

引用 §A.4 Research Coverage：
- 如果某结论属于 low-coverage 维度，必须标注 `Low coverage (X%) — evidence sparse`
- 不要在叙事中堆砌覆盖率数字，只在引用低置信结论时使用

---

## 判断标准（来自 SKILL.md）

### 什么 Claim 值得写入报告

**保留**：
- 改变读者对系统理解的
- 有明确 tradeoff 的
- 可迁移到其他系统的
- 与已有假设矛盾的（最高价值）

**淘汰**：
- 单一证据源的
- 无法经受对抗性反证的
- 不改变理解的
- 适用于任何项目的（缺乏特异性）
- 只有"是什么"没有"为什么"的

### Unknown 主动分类

报告中的每个 Unknown 必须主动分类，告诉读者下一步该怎么做：

| Unknown Type | 含义 | 下一步 |
|--------------|------|--------|
| **Need Reading** | 仓库内有相关文件但本研究未覆盖 | 列出应读但未读的文件 |
| **Need External Evidence** | 仓库内无法验证，需要外部资料（issue/PR/discussion/blog） | 列出应查询的外部来源 |
| **Impossible to Verify** | 即使深入阅读也无法验证（设计意图、未发生的场景） | 明确标注为不可验证 |

被动标注"Unknown"不够——必须给出分类理由和推荐下一步。

### Honest Limits

禁止：
- 从 README 推断未在代码中实现的功能
- 从单次提交推断长期设计意图
- 把推测包装为结论

必须：
- 标注 Unknown / Missing Evidence / Alternative Explanation
- 区分"文档声称"与"代码验证"
- Unknown 必须主动分类（Need Reading / Need External Evidence / Impossible to Verify）

### Competing Interpretations（来自 §A.5 C10）

如果 §A.5 Consistency 检测到 C10 矛盾（互斥架构模式共存），Architecture 章节必须呈现：

```markdown
**Competing Interpretations**:

- **Interpretation A**: Plugin Architecture
  - Evidence: plugin registry, extension API, ...
  - Why it fits: ...
- **Interpretation B**: Monolith
  - Evidence: tight coupling, shared state, ...
  - Why it fits: ...

**Recommendation**: 两种解释都成立，取决于视角。Plugin 是设计意图，Monolith 是当前实现状态。
```

### Counter-Evidence（来自 §A.5 C9）

如果 §A.5 Consistency 检测到 C9 矛盾（架构模式反证），Architecture 章节的对应 Claim 必须标注：

```markdown
**Claim**: Plugin-oriented Architecture

**Confidence**: Reduced (originally High, downgraded due to counter-evidence)

**Counter-Evidence**:
- Cross-module coupling: 3 circular dependencies detected
- God module: `core/registry.ts` has fan-in=18

**Reason**: Plugin pattern implies loose coupling, but tight coupling detected.
```

---

## Quality Gate

报告完成前，必须回答（放在报告末尾的 **Quality Gate** 小节）：

1. **What would invalidate this report?** — 哪些证据如果存在，会让报告崩溃？
2. **What is most likely to be disagreed with?** — 另一个工程师读完后，最可能质疑哪个 Claim？
3. **Is any Claim pretending to be certain when it should be Unknown?**
4. **每个 Decision 是否含 ADR 七字段？**（Problem/Alternatives/Tradeoff/Chosen/Evidence/Risk/Reusability）
5. **每个 Pattern 是否含四字段？**（Applicability/Limitation/Migration Cost/Reuse Score）
6. **每个 Unknown 是否主动分类？**（Need Reading / Need External Evidence / Impossible to Verify）
7. **叙事流是否自然？** — 从 Overview 到 Lessons Learned，读者能否像读文章一样流畅？
8. **Competing Interpretations 和 Counter-Evidence 是否已处理？** — §A.5 中的 C9/C10 是否在 Architecture 章节得到反映？
9. **低覆盖率结论是否标注？** — §A.4 中 low-coverage 维度的结论是否显式标注为低置信？

---

## Anti-Fabrication Constraints（HIGHEST PRIORITY）

1. **ID Integrity**: 引用 Finding 时必须使用 brief 中的真实 ID（[F-001], [F-002]...），禁止编造 ID。
2. **Confidence Verbatim**: Confidence 数字必须逐字匹配 brief 中的值，禁止"近似"或"四舍五入"。
3. **No Status Inversion**: brief 中标记为 verified 的 Finding 不能在报告中被暗示为 rejected，反之亦然。
4. **Number Integrity**: brief 中的数量（findings count / tool count / pattern count）必须逐字引用，禁止改写。
5. **No Content Fabrication**: 报告中的 Finding 描述必须与 brief 中的 finding 字段一致，禁止扩展或扭曲。
6. **Quote-then-Critique**: 在引用 brief 中的某行前，先逐字粘贴 brief 中的原行，再展开评论。
7. **Contradiction Bidirectional Check**: 如果报告声称"分析器漏检了某矛盾"，必须先逐字引用 §A.5 Consistency 中的对应行；如果 §A.5 已记录该矛盾，报告不能声称"漏检"。
