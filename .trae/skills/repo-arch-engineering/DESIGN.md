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

## §1 为什么 Report First，Model 作为支撑

### 设计定位

用户要的是 **Solution Architect 视角的完整分析报告**，不是 Repository Model。因此：

**报告是首要产物，Repository Knowledge Model 是支撑手段。**

```
Solution Architect 视角阅读代码
  |
  v
Research Engine（循环研究）
  |
  +-- 中间产物: Repository Knowledge Model（持久化、可追溯）
  |     - 保证每条 claim 有 evidence 链
  |     - 保证可增量更新（commit 变化时只更新受影响部分）
  |     - 保证可验证（claim → evidence → source 可追溯）
  |
  v
最终产物: report.md（保存到 working dir）
```

### 为什么需要 Model 作为支撑

直接生成报告的问题：

1. **证据收集为了填报告章节** — Agent 倾向于收集"能写进报告的证据"，而非"能理解系统的证据"
2. **无追溯性** — 报告里的 claim 无法追溯到源码
3. **无增量更新** — commit 变化时必须重新生成整个报告
4. **无质量保证** — 无法检查 coverage / confidence / contradictions

Model 作为支撑解决这些问题：

- **可增量更新** — commit 变化时只更新受影响部分，不重新生成整个报告
- **可查询** — "这个系统的扩展点有哪些？"可以直接查 Model
- **可验证** — 每个 claim 都有 evidence 链，可以追溯
- **质量门控** — Quality Agent 基于 Model 检查 coverage/confidence/contradictions

### 与纯 Model First 的区别

纯 Model First 设计（Model 是首要产物，报告是派生视图）的问题：

- 用户要的是报告，不是 Model
- Model 的价值通过报告体现，而非独立存在
- 过度强调 Model 会让 Agent 忽视报告的可读性

本 Skill 的平衡：**报告是首要产物，Model 是保证报告质量的支撑手段**。

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
  +-- Reason: 为什么问这个？（什么证据触发了这个问题）
  +-- Expected Evidence: 期望找到什么证据来回答？
  +-- Priority: 这个缺口有多重要？
  +-- Status: open → investigating → answered → invalidated
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

引擎根据知识缺口决定下一步执行哪个 Phase，可以回溯、并行、增量更新。

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

## §6 Repository Knowledge Model Schema

Repository Model 是整个 Skill 的核心。没有模型定义，Agent 行为容易退化成"高级代码总结器"。

### 顶层结构

```json
{
  "identity": {
    "name": "string",
    "type": "CLI | Library | Framework | Database | Compiler | ...",
    "languages": ["string"],
    "frameworks": ["string"],
    "build_system": "string",
    "entry_points": ["string"],
    "deployment_files": ["string"]
  },
  "architecture": {
    "pattern": "layered | hexagonal | plugin | event-driven | monolith | microservices",
    "pattern_evidence": ["evidence_id"],
    "layers": [{"name": "string", "modules": ["module_id"]}],
    "boundaries": [{"name": "string", "direction": "string", "evidence": ["evidence_id"]}],
    "modules": [{"id": "string", "name": "string", "responsibility": "string"}],
    "dependencies": [{"from": "module_id", "to": "module_id", "type": "string"}]
  },
  "runtime": {
    "startup_flow": [{"step": "string", "component": "module_id", "evidence": ["evidence_id"]}],
    "request_lifecycle": [{"step": "string", "component": "module_id", "evidence": ["evidence_id"]}],
    "async_flows": [{"name": "string", "components": ["module_id"], "evidence": ["evidence_id"]}]
  },
  "design_decisions": [{
    "decision": "string",
    "context": "string",
    "alternative": "string",
    "tradeoff": "string",
    "evidence": ["evidence_id"],
    "confidence": "number"
  }],
  "evolution": {
    "timeline": [{"version": "string", "change": "string", "evidence": ["evidence_id"]}],
    "current_direction": "string",
    "deprecated_patterns": ["string"]
  },
  "hypotheses": [{
    "id": "string",
    "hypothesis": "string",
    "status": "confirmed | rejected | uncertain",
    "confidence": "number",
    "supporting_evidence": ["evidence_id"],
    "counter_evidence": ["evidence_id"],
    "linked_questions": ["question_id"]
  }],
  "evidence": [{
    "id": "evidence_id",
    "source": "file_path",
    "observation": ["string"],
    "inference": ["string"],
    "confidence": "number"
  }]
}
```

### 关键设计

1. **所有 claim 通过 evidence_id 链接** — 不允许无证据的 claim
2. **observation 和 inference 分离** — 结构上不允许混淆
3. **hypotheses 有状态** — confirmed/rejected/uncertain，不是二元判断
4. **模型是持久化的 JSON** — 可增量更新，可查询，可验证

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

`repo-engineering-research` 不是 `repo-research-v2` 的增量改进，而是**重新设计**。

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

`repo-engineering-research` 作为新 Skill 独立开发，不修改 `repo-research-v2`。当新 Skill 验证稳定后，旧 Skill 可以废弃。

---

## §9 下一步：model-schema.md

p1.md 建议下一步设计 `model-schema.md`，因为 Repository Model 是整个 Skill 的核心。

没有模型定义的后果：
- Agent 行为容易退化成"高级代码总结器"
- Evidence 没有 target 字段，不知道更新模型的哪个部分
- Hypothesis 没有 linked_model_field，无法追踪假设影响哪个模型节点

`model-schema.md` 需要定义：
1. 每个模型字段的类型约束
2. Evidence 到 Model 的映射规则
3. Hypothesis 到 Model 的链接方式
4. 模型增量更新的冲突解决策略
