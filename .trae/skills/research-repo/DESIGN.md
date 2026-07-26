# DESIGN.md — research-repo 设计理由

> 本文档记录 research-repo skill 的设计决策与理由。它不指导 Agent 如何执行，而是解释**为什么**这样设计。维护者可从此处理解架构演进。

---

## 1. 脚本层与 LLM 层分离

**决策**：脚本层只做确定性事实（AST、符号、图、文件树、git 历史）；LLM 层做解释与综合（架构意味着什么、为什么这样设计、工程权衡）。

**理由**：
- LLM 从不做脚本能做的事。脚本产出的符号索引、centrality 分数是确定性的，LLM 重复计算只会引入幻觉。
- 分阶段降低单次上下文压力：每个 subagent 只聚焦一个领域，输出可以被下一阶段验证和引用。
- 可追踪：每个产物都有明确输入 prompt 和输出文件，便于复核。

---

## 2. 动态 Research Question Planner

**决策**：根据证据动态生成适合特定仓库的 Research Question，不使用固定模板。

**理由**：
- 不同项目应该产生不同的问题。OpenAI Agents SDK 应该问"为什么 Runner 是核心"，DuckDB 应该问"为什么不用 Volcano"。
- 固定模板（Architecture / LLM / Tool / Context / Evolution）会导致所有仓库的研究报告千篇一律，失去洞察价值。
- 5 维打分（Impact/Novelty/Evidence Rich/Transferable/Controversial）确保问题值得研究——Controversial=1 的问题没有争议，Evidence Rich=1 的问题无法验证，都不值得研究。

---

## 3. Bayesian Hypothesis

**决策**：假设包含置信度演进历史（Prior → Posterior），而非一次性判断。

**理由**：
- 整个研究过程不断更新 belief，而不是一开始就下结论。这更接近真实的研究方法论。
- 置信度演进历史让读者看到"哪些证据真正改变了判断"，而不仅仅是最终结论。

**Competing Hypothesis**：
- 为每个主假设提出一个最可能的竞争假设——对同一组证据的另一种合理解释。
- Opponent Agent 将攻击主假设并尝试支持竞争假设。只有主假设的置信度远高于竞争假设时，结论才稳定。
- 这避免了"确认偏误"——研究者倾向于只找支持自己假设的证据。

---

## 4. Behavior Ontology

**决策**：Ontology 不只是静态对象（Component/Interface/Tool），还包含行为图（Execution Graph）和决策层（Decision Ontology）。

**理由**：
- 静态对象列表只回答"有什么"，不回答"怎么工作"。Execution Graph 回答"怎么工作"：Tool EXECUTES Workflow → Workflow EMITS Event → Event TRIGGERS Prompt → Prompt CALLS LLM。
- Palantir Ontology 真正强大的不仅是静态对象和行为图，还包括决策层。Decision JUSTIFIES Module——决策证明模块存在。Policy CONSTRAINS Component——策略约束组件。
- 决策关系动词（JUSTIFIES/SUPPORTS/PROVES/ANSWERS/CONSTRAINS）让 Evidence Graph 能连接不同层次的实体。

---

## 5. Opponent Agent

**决策**：新增反证者角色，对每个 Finding 进行攻击（寻找直接矛盾、测试反例、替代解释、缺失证据）。

**理由**：
- Proposer → Opponent → Judge 比 Reviewer Alone 更稳定。单一角色容易确认偏误。
- Opponent 的职责不是"审查"，而是"证明 Finding 是错的"。这种对抗性设置迫使 Finding 经受真正的压力测试。
- 如果 Opponent 找不到反例，Finding 的置信度才真正可靠。

---

## 6. Evidence Graph

**决策**：Cross Validation 构建统一证据关系图：Evidence → supports → Finding → answers → RQ → validates → Hypothesis → produces → Resolution。

**理由**：
- Report Writer 查询 Evidence Graph 而非读所有 Markdown。这降低了上下文压力，也避免了 Report Writer 重新解释证据。
- 读者可以从 Resolution 追溯回 Evidence，也可以从 Evidence 查找它支持的所有 Finding。双向可追溯。

---

## 7. Research Trace 格式

**决策**：Report 不再是 Question → Conclusion，而是 Question → Investigation → Turning Point → Resolution，记录调查过程而非只写结论。

**理由**：
- 真正好的研究不是证明自己，而是改变自己。记录"最初认为 → 发现相反证据 → 改变信念"的过程，比只写最终结论更有价值。
- Turning Point 是改变理解的关键证据——读者最想知道的是"什么证据让研究者改变了想法"。
- 这也让读者判断研究过程的严谨性——如果没有 Turning Point，说明研究者可能只是在找支持自己假设的证据。

---

## 8. Importance 与 Confidence 分离

**决策**：Finding 结构增加 Importance 字段（Critical/High/Medium/Low），与 Confidence 独立。

**理由**：
- README 可能 High Confidence 但 Importance 低（README 的存在是确定的，但对理解架构不重要）。
- "Planner 为什么存在" 可能 Confidence Medium 但 Importance Critical（证据不够强，但这个问题对理解系统至关重要）。
- 混淆两者会导致报告要么只覆盖高置信度的琐碎事实，要么只覆盖低置信度的重要问题。分离后，读者可以同时看到"多确定"和"多重要"。

---

## 9. Decision-centric Report

**决策**：报告是 Decision Report，不是 Architecture Report。新增 Engineering Decisions 章节。

**理由**：
- Palantir Research 的核心是 Decision Report。架构只是决策的产物，决策才是值得学习的。
- 可复用 Pattern 直接来自 Decision，而不是 Finding。Decision 包含 Why/Tradeoff/Alternative/Learning，比 Finding 更适合迁移。
- 读报告的工程师最想知道"为什么这样设计"，而不是"架构是什么"。

---

## 10. Architecture Fitness

**决策**：报告新增 Architecture Fitness 章节，按 Modularity/Extensibility/Testability/Observability/Evolution/Performance/Developer Experience 7 维评分。

**理由**：
- Neal Ford 的 Architecture Fitness Function 思想：架构不是一次性设计，而是持续满足设计目标。
- 比 Smell 更高级——Smell 只回答"有没有代码味道"，Fitness 回答"架构是否持续满足设计目标"。
- 7 维评分让读者快速判断架构的健康状况，而不用读完整个报告。

---

## 11. Architecture Compression

**决策**：报告新增 Architecture Compression 章节，300/100/30 字三级摘要。

**理由**：
- "如果压缩不了，说明其实没有理解"——迫使作者提炼核心架构，而不是堆砌细节。
- 300 字给快速浏览的读者，100 字给扫一眼的读者，30 字给只看标题的读者。不同读者在不同时间预算下都能获得价值。

---

## 12. What NOT to Learn

**决策**：报告新增 What NOT to Learn 章节，明确区分"值得学"和"不要抄"。

**理由**：
- 很多项目真正值得学的只有 10%，其它是历史包袱、临时方案或特定上下文的产物。
- 如果不明确区分，读者容易把历史包袱当作"最佳实践"复制到自己的项目中。
- "不值得复制"的内容往往比"值得学习"的内容更有信息价值——它告诉读者"这条路不要走"。

---

## 13. Anti-Fabrication Constraints

**决策**：Report Writer 遵循 7 条反伪造约束（ID 完整性 / 置信度逐字引用 / 状态不得反转 / 数字完整性 / 内容不得伪造 / 先引用再批判 / 矛盾双向检查）。

**理由**：
- 历史审计发现 LLM 会系统性地伪造 Finding 引用——发明 ID、篡改置信度、翻转 verified 状态、甚至颠倒 Finding 内容。
- 这些伪造行为对读者最有害——读者信任报告中的引用，如果引用是假的，整个报告的可信度崩溃。
- 7 条约束是针对历史审计中发现的具体伪造模式设计的，每条约束解决一类问题。

---

## 14. 模块化拆分

**决策**：将 10000+ 行的 `research-repo.mjs` 拆分为 12 个聚焦模块。

**理由**：
- 单文件 449KB 不可维护——任何修改都需要在 10000 行中定位。
- 按职责拆分（config / utils / context / base-analyzer / analyzers-fact / analyzers-inference / evidence-store / research-engine / report-generator / pipeline / CLI）让每个文件聚焦一个领域。
- ES module 的 import/export 让依赖关系显式化，避免隐式全局状态。

---

## 15. 中文优先

**决策**：`subagent-prompts` 命令始终生成中文 prompt，不再支持英文版本。

**理由**：
- 实际使用中只生成中文 prompt，英文版本是死代码。
- 移除英文分支让 `subagent-prompts.mjs` 从 1432 行缩减到 750 行，降低维护成本。
- `report` 命令仍支持 `--lang=zh` 生成中文 Evidence Brief，因为 evidence-brief 可能需要英文版本供国际用户使用。
