# DESIGN.md — Repository Engineering Research Agent

## 设计目标

从 **Solution Architect 视角**阅读代码，分析仓库的架构设计与工程设计，产出完整详细的分析报告（保存到 working dir）。

核心定位差异：

| 代码摘要 Agent | 本 Skill（Solution Architect 视角） |
|-|-|
| 文件级总结 | 架构级推理 |
| 罗列目录/类/函数 | 识别架构模式、边界、引力中心 |
| 描述"有什么" | 解释"为什么这样设计" |
| 证据日志（append-only） | Evidence + Hypothesis system（可证伪、可挑战） |
| 静态问题列表 | Knowledge gap engine（随证据演化） |
| 一次性报告 | 报告 + 持久化 Model（可增量更新、可追溯） |
| 总结代码 | Solution Architect 视角的完整分析报告 |

---

## §1 为什么 Model First，Report as View

### 设计定位

用户要的是 **Solution Architect 视角的完整分析报告**，但直接生成报告不可行（见下）。因此：

**Repository Knowledge Model 是首要工程产物，报告是 Model 的视图（Report as View）。**

```
Solution Architect 视角阅读代码
  |
  v
Research Engine（循环研究）
  |
  v
Repository Knowledge Model（首要产物：持久化、可追溯、可增量更新）
  |
  v
Architecture Narrative（压缩层：Model → 叙事骨架）
  |
  v
report.md（视图渲染，保存到 working dir）
```

### 为什么直接生成报告不可行

1. **证据收集为了填报告章节** — Agent 倾向于收集"能写进报告的证据"，而非"能理解系统的证据"
2. **无追溯性** — 报告里的 claim 无法追溯到源码
3. **无增量更新** — commit 变化时必须重新生成整个报告
4. **无质量保证** — 无法检查 coverage / confidence / contradictions

Model First 解决这些问题：

- **可增量更新** — commit 变化时只更新受影响部分，不重新生成整个报告
- **可查询** — "这个系统的扩展点有哪些？"可以直接查 Model
- **可验证** — 每个 claim 都有 evidence 链，可以追溯
- **质量门控** — Quality Agent 基于 Model 检查 coverage/confidence/contradictions

### 为什么不是"只产 Model"

Model First 不等于 Model Only。Model 是事实集合，不是交付物：

- 用户读的是报告，不是 JSON——Model 的价值通过报告体现
- 因此报告侧有**两道强制处理**：Architecture Narrative 压缩层（防止信息密度超过认知结构）+ 叙事驱动的报告结构（Thesis 为骨架，见 Methodology.md §Report Theory）
- 报告的每个 claim 只能引用 Model，不允许新增推理（Report MUST NOT introduce new architectural claims）

本 Skill 的平衡：**Model 是首要工程产物（保证质量），Narrative + Report 是 Model 的视图（保证可读性）**。

---

## §2 为什么 Evidence + Hypothesis 而非 Evidence Only

### 问题

旧设计中，Evidence Log 只记录"观察到了什么"。但架构理解需要推理——从观察推导到结论。如果没有显式的假设系统，LLM 会：

1. **直接从证据跳到结论** — "看到 PluginManager → 系统是插件架构"，跳过了推理过程
2. **无法被挑战** — 没有显式假设，就无法挑战假设
3. **置信度不可计算** — 没有假设验证过程，confidence 是 LLM 随口说的数字

### 设计决策

**四层认知链路：Observation → Evidence → Hypothesis → Validated Knowledge**

```
Code (源码)
  |
  v
Observation (观察: "PluginManager calls ServiceLoader.load()")
  |
  v
Evidence (证据: 结构化记录，含 source + observation + inference)
  |
  v
Hypothesis (假设: "系统支持运行时扩展发现")
  |
  v
Validated Knowledge (验证后的知识: 假设 + 置信度 + 反证搜索结果)
```

### 关键规则

- **Observation vs Inference 分离** — 观察是代码事实，推理是架构解释，永远不混在一起
- **假设必须可证伪** — 每个假设都有"如果这个假设是错的，我们会看到什么"
- **置信度通过验证计算** — 不是 LLM 猜的数字，而是基于证据数量、来源多样性、反证搜索结果计算

---

## §3 为什么 Knowledge Gap Engine 而非 Question List

### 问题

旧设计中，问题是静态列表——Phase 0 生成问题，后续阶段回答问题。这导致：

1. **问题不随证据演化** — 发现新证据后，问题列表不更新
2. **问题是任务而非缺口** — "分析插件模块"是任务描述，不是知识缺口
3. **问题与假设脱节** — 问题不绑定假设，回答了问题也不知道更新了什么知识

### 设计决策

**问题是知识缺口的表达，随研究进展动态演化。**

```
Question (知识缺口)
  |
  +-- Why it matters: 为什么问这个？（回答后会改变什么架构理解）
  +-- Expected Model Change: 回答后会修改/确认模型的哪些字段
  +-- Hypothesis: 待验证/推翻的初始假设
  +-- Evidence Needed: 期望找到什么证据来回答？
  +-- Priority: 这个缺口有多重要？（Impact × Uncertainty × Evidence Availability）
  +-- Status: open → investigating → validated/rejected/blocked → model_updated
  +-- Linked Hypothesis: 回答这个问题验证/推翻了哪个假设？
```

### 好问题 vs 坏问题

**好问题**（知识缺口）：
```
How are plugins discovered at runtime?
```

**坏问题**（任务描述）：
```
Analyze plugin module.
```

### 理由

- 好问题有明确的"期望证据"——知道找到什么才算回答了
- 好问题有明确的"关联假设"——回答它会影响某个架构假设的置信度
- 问题随证据演化——发现新证据可能关闭旧问题、开启新问题

---

## §4 为什么 Research Engine 而非 Stage Workflow

### 问题

旧设计是线性流水线：Scan → Evidence → Model → Interpret → Challenge → Report。每个阶段严格按顺序执行。这导致：

1. **无法回溯** — 发现 Phase 3 的证据需要更新 Phase 2 的模型时，无法回退
2. **无法并行** — 所有阶段串行，即使某些研究可以并行
3. **无法增量** — commit 变化时必须重新跑整个流水线

### 设计决策

**研究引擎是循环驱动，而非线性流水线。**

```
                    +---> Phase 0: Reconnaissance
                    |
                    +---> Phase 1: Structural Discovery
                    |
                    +---> Phase 2: Architecture Reconstruction
                    |
Research Engine --->+---> Phase 3: Runtime Reconstruction
                    |
                    +---> Phase 4: Design Decision Mining
                    |
                    +---> Phase 5: Evolution Analysis
                    |
                    +---> Phase 6: Model Validation
                    |
                    +---> (loop back if knowledge gaps remain)
```

引擎根据知识缺口决定下一步执行哪个 Phase，可以回溯、增量更新（当前 Orchestrator 串行调度，见 agents/orchestrator.md）。

### Phase ↔ Step ↔ Agent 映射

SKILL.md 的 6 个 Step 是执行流程视角，Phase 0-6 是研究内容视角，两者对应关系：

| Phase | 名称 | SKILL.md Step | 负责 Agent | `phases_completed` 值 |
|-|-|-|-|-|
| 0 | Reconnaissance | Step 2 | Scan | `reconnaissance` |
| 1 | Structural Discovery | Step 2 | Scan | `structural_discovery` |
| 2 | Architecture Reconstruction | Step 4 | Model | `architecture_reconstruction` |
| 3 | Runtime Reconstruction | Step 4 | Model | `runtime_reconstruction` |
| 4 | Design Decision Mining | Step 4 | Reasoning | `design_decision_mining` |
| 5 | Evolution Analysis | Step 4 | Reasoning | `evolution_analysis` |
| 6 | Model Validation | Step 6 | Quality | `model_validation` |

研究循环（Step 3-5）每轮按 Evidence → Model → Reasoning 顺序推进 Phase 2-5 的增量；Phase 6 在收敛后、报告发布前执行。

---

## §5 为什么 Challenge Every Conclusion

### 问题

架构研究最大的风险是**确认偏误**——Agent 找到支持证据就下结论，不搜索反证。

例如：
- Claim: "系统是微服务架构"
- 支持证据: "有多个 service 目录"
- 反证（未搜索）: "所有 service 共享一个数据库"、"没有独立部署"

### 设计决策

**每个重要结论必须经历反证搜索。**

```
Claim
  |
  +-- Supporting Evidence (支持证据)
  |
  +-- Counter Evidence Search (反证搜索)
  |     |
  |     +-- 如果找到反证 → 降低置信度
  |     +-- 如果未找到反证 → 提高置信度
  |
  +-- Confidence Update (置信度更新)
```

### 理由

- 反证搜索强制 Agent 考虑"如果我是错的会怎样"
- 置信度不再是 LLM 猜的数字，而是基于正反证据的平衡
- 这是最接近科学研究方法的架构研究实践

---

## §6 Repository Knowledge Model（权威定义见 model-schema.md）

Repository Model 是整个 Skill 的核心。没有模型定义，Agent 行为容易退化成"高级代码总结器"。

> **字段级定义、Evidence→Model 映射规则、置信度计算、增量更新冲突解决，均以 [model-schema.md](./model-schema.md) 为唯一权威来源。** 本节只记录核心设计决策，不复制 schema（避免双源不一致）。

### 顶层结构（概览）

```
repository-model.json
  ├── identity            # 仓库身份（§3）
  ├── architecture        # patterns / layers / boundaries / modules / extension_points（§4）
  ├── runtime             # startup_flow / request_lifecycle / async_flows（§5）
  ├── design_decisions    # Decision + Context + Alternatives + Trade-off（§6）
  ├── evolution           # timeline / current_direction / deprecated_patterns（§7）
  ├── quality_attributes  # 可扩展性/可维护性/性能等评估（§18）
  ├── risks               # evidence-backed 风险 + what_breaks（§18）
  ├── unknowns            # 剩余未知（need_reading / blocked）（§18）
  └── coverage            # 各维度覆盖率快照（§11）

工作文件（独立存储，model 只通过 ID 引用，不复制内容）：
  hypotheses.json         # 假设系统（§8，Reasoning 维护）
  evidence-log.jsonl      # 证据日志（§9，append-only 唯一事实源）
  questions/              # 问题引擎（§10，round-N.json + reviewed.json + summary.json）
```

### 关键设计

1. **所有 claim 通过 evidence_id 链接** — 不允许无证据的 claim
2. **observation 和 inference 分离** — 结构上不允许混淆
3. **hypotheses 有状态** — candidate/investigating/confirmed/rejected/uncertain，不是二元判断
4. **模型是持久化的 JSON** — 可增量更新，可查询，可验证
5. **模型与工作文件分离** — Model 存稳定知识；hypotheses/evidence/questions 是研究过程状态，独立存储

---

## §7 Phase 设计理由

### Phase 0 — Repository Reconnaissance

**为什么禁止深度分析？**

因为 Phase 0 的目标是建立"仓库身份"，不是理解架构。如果在侦察阶段就深入代码分析，Agent 会：
- 陷入细节，失去全局视角
- 在没有足够信息时下架构结论
- 浪费 token 在不重要的文件上

**输出 `repository-profile.json`** 包含：语言、框架、构建系统、入口点、部署文件。这些是后续 Phase 的输入约束。

### Phase 1 — Structural Discovery

**为什么"不描述每个文件"？**

因为架构研究的对象是**架构单元**（applications, libraries, services, infrastructure, tests），不是文件。描述每个文件会：
- 产生大量无架构价值的噪声
- 让 LLM 把文件列表当作架构理解
- 消耗大量 token 在无洞察的内容上

### Phase 2 — Architecture Reconstruction

**为什么"每个 pattern claim 都需要证据"？**

因为架构模式是最容易被误判的。Agent 看到 `controllers/` 目录就声称"MVC 架构"，看到 `services/` 就声称"微服务"。但：
- 目录名不等于架构模式
- 模式需要运行时行为验证
- 多种模式可以共存（如 plugin + layered）

### Phase 3 — Runtime Reconstruction

**为什么要分 Startup Flow / Request Lifecycle / Async Flow？**

因为运行时行为有三个不同维度：
- **Startup** — 系统如何初始化（静态→动态）
- **Request** — 系统如何处理请求（动态→动态）
- **Async** — 系统如何处理异步（时间维度）

混淆这三个维度会导致运行时理解不完整。

### Phase 4 — Design Decision Mining

**为什么 Decision 要包含 Context + Alternative + Trade-off？**

因为架构决策的本质是**在约束下选择**。没有 Context（约束）的决策无法理解，没有 Alternative（替代方案）的决策无法评估，没有 Trade-off（权衡）的决策不是架构决策。

### Phase 5 — Evolution Analysis

**为什么要分析演进历史？**

因为当前架构是历史演进的**快照**。不理解"系统如何变成这样"，就无法理解"系统为什么是这样"。演进分析揭示：
- 哪些是刻意设计，哪些是历史沉积
- 哪些架构决策在演进中被推翻
- 当前架构的演化压力在哪里

### Phase 6 — Model Validation

**为什么要在报告前验证？**

因为未验证的模型可能包含：
- 覆盖率不足的维度（如 testing 覆盖率 0%）
- 低置信度的 claim（confidence < 0.5）
- 矛盾的架构假设（同时声称 monolith 和 microservices）

验证确保报告基于可靠的模型，而非未经验证的推测。

---

## §8 与 repo-research-v2 的关系

`repo-arch-engineering` 不是 `repo-research-v2`（已归档为 `Aug02-Old-repo-research-v2`）的增量改进，而是**重新设计**。

### 保留的核心思想

- Evidence First 原则
- Question-driven 研究
- Architecture Mining（PageRank, gravity centers, tensions, violations）
- Tree-sitter + Graphology 机械事实层
- LLM 推理约束（禁止机械总结、Mechanism vs Intent、Confidence discipline）

### 根本改变

- **Model 是首要产物**（旧：Report 是首要产物）
- **Evidence + Hypothesis 系统**（旧：Evidence only）
- **Knowledge Gap Engine**（旧：静态问题列表）
- **Research Engine 循环驱动**（旧：线性流水线）
- **Challenge Every Conclusion**（旧：可选挑战）
- **模型持久化与增量更新**（旧：每次重新生成）

### 迁移策略

`repo-arch-engineering` 作为新 Skill 独立开发，不修改 `repo-research-v2`。当新 Skill 验证稳定后，旧 Skill 可以废弃。

---

## §9 文档地图

本 Skill 的文档分工（单一权威来源原则，避免双源不一致）：

| 文档 | 职责 | 状态 |
|-|-|-|
| [SKILL.md](./SKILL.md) | 执行规范——Workflow / Artifacts / Agent 调度 | 当前 |
| [Methodology.md](./Methodology.md) | 研究方法论——稳定的研究理论，与执行细节无关 | 当前 |
| [DESIGN.md](./DESIGN.md) | 设计决策理由（本文档） | 当前 |
| [model-schema.md](./model-schema.md) | Repository Model 字段定义、映射规则、置信度计算、增量更新策略 | 当前 |
| [CHANGE_LOG.md](./CHANGE_LOG.md) | context.json 状态变更规则 | 当前 |
| [agents/](./agents/) | Sub Agent 定义（11 个） | 当前 |
| [p1.md](./p1.md) | 初始设计提案（历史存档，已被上述文档取代） | 存档 |

p1.md 曾建议"下一步设计 model-schema.md"——已完成。model-schema.md 落地了：

1. 每个模型字段的类型约束（§3-§11、§18）
2. Evidence 到 Model 的映射规则（§13）
3. Hypothesis 到 Model 的链接方式（§14）
4. 模型增量更新的冲突解决策略（§16）
