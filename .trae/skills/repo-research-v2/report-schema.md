# 报告规范（Report Schema）

> 本文档定义报告的推理规则和结构要求。报告不是"总结"，而是「研究论文」——每个重要结论必须完整经历推理链，禁止只写结论。

---

## 核心原则：Six-Step Reasoning（六步推理）

**每个非平凡结论必须展开成以下推理链，禁止折叠为单句结论。**

```
[Observation] 观察到什么现象？
       ↓
[Evidence]    具体证据（文件/符号/提交）
       ↓
[Interpretation] 为什么这很重要？
       ↓
[Alternative]    还有哪些可能解释？
       ↓
[Challenge]      哪个解释被挑战过？
       ↓
[Conclusion]     最终结论（含置信度）
```

**示例**（好）：

```
Observation
  发现 7 个 gateway 都引用同一 helper，且后续新增仍沿用。

Evidence
  server/gateway.ts:line 12-45
  server/cache.ts:line 3-7
  server/proto.ts:line 89-102

Interpretation
  维护者把 Gateway 看成 Pipeline，而非独立服务。

Alternative
  可能只是历史遗留——早期只有一个 gateway，抽取 helper 是自然重构。

Why Alternative Rejected
  后来新增 gateway 仍沿用同一模式（evidence: 3 次 git commit），
  说明是设计模式而非偶然。

Conclusion
  Gateway Pipeline 是架构中心（Confidence: High, Evidence: 4 sources）。
```

**示例**（坏）：

```
Gateway 是架构中心。  ← 结论被折叠，没有推理过程
```

---

## Section-Level Questions（每节必须回答）

每个章节必须覆盖对应问题。**禁止**只写章节标题而不展开。

### 1. Runtime（运行时架构）

必须回答：
- 请求如何进入系统？（入口点、网关、负载均衡）
- 请求数据如何流动？经过哪些中间件/转换器？
- 生命周期如何结束？（响应、错误、超时）
- 哪些组件拥有状态？状态如何初始化/持久化？
- 哪些组件只是无状态转换器？（纯函数、管线）
- 哪些地方有缓存？缓存策略？失效条件？
- 哪些地方发生并发？如何保证安全？
- 如果某个组件宕机，系统如何降级？

### 2. Architecture（静态架构）

必须回答：
- 系统划分几层？为什么这样划分？
- 每层职责是什么？层间依赖方向？
- 边界如何保证？（编译期检查？lint？命名约定？）
- 哪些地方违反了边界？（实际存在的违规）
- 依赖方向与职责是否一致？（有无循环依赖）
- 哪些模块是高耦合的？哪些是低耦合的？

### 3. Key Decisions（关键决策）

每个决策必须包含以下 9 个字段：

| 字段 | 说明 |
|------|------|
| **Chosen** | 选择了什么？ |
| **Rejected** | 拒绝了哪些替代方案？（至少 1 个） |
| **Why Chosen** | 为什么选这个？ |
| **Why Rejected** | 为什么拒绝替代方案？ |
| **Tradeoff** | 这个决策的权衡是什么？ |
| **Cost** | 引入的工程成本（复杂度/维护/性能） |
| **Long-term Consequence** | 长期看这个决策会带来什么？ |
| **Who Benefits** | 谁从这个决策受益？（开发者/用户/运维） |
| **Who Suffers** | 谁为这个决策付出代价？ |

### 4. Evidence Strength（结论可信度）

每项结论必须标注：

| 标注 | 含义 |
|------|------|
| **Confidence** | High / Medium / Low（基于证据质量） |
| **Evidence Count** | 支持该结论的证据源数量 |
| **Evidence Sources** | 证据类型列举（source code / doc / config / test / git history） |
| **Counter Evidence** | 是否存在反证？如有，列出数量 |
| **Alternative** | 是否有替代解释未被否定？ |

### 5. Design Space（设计空间）

每个决策必须展开设计空间：

- **参数空间**：有哪些可选方案？
- **选择的维度**：在哪几个维度上做权衡？
- **为什么聚焦这个维度**？为什么忽略其他维度？
- **被拒绝方案的适用场景**：它们可能在什么条件下优于当前选择？

### 6. Architecture Atlas（架构地图）

必须标注每个模块的角色：

| 标签 | 含义 |
|------|------|
| **🟢 Center** | 架构中心——移除后系统不成立 |
| **🔵 Core** | 核心——改动影响全局 |
| **🟡 Support** | 支撑——被依赖但可替换 |
| **🟠 High Coupling** | 高耦合——修改需谨慎 |
| **🔴 Danger** | 危险区——易出错、难测试 |
| **🟢 Stable** | 稳定区——很少改动 |
| **⚪ Neutral** | 外围——相对独立 |
| **🗑️ Dead** | 废弃/待删除 |

### 7. Maintainer Handbook（维护者手册）

必须覆盖：

- **How to Extend**：新增 X 需要修改哪些文件？（按新增类型分类）
- **How to Debug**：如果 Y 出问题，如何定位根因？
- **How to Migrate**：如果要从 A 迁移到 B，需要做什么？
- **How to Remove**：如果要删除模块 Z，会影响哪些地方？
- **How to Refactor**：哪些部分可以安全重构？哪些必须极其小心？

### 8. Repository Tour（仓库游览）

为新读者推荐阅读顺序：

```
推荐阅读顺序：

Day 1 — 理解核心路径
  README.md → server/gateway.ts → src/App.ts → api/

Day 2 — 理解边界
  server/ → config/ → src/services/

Day 3 — 理解细节
  src/components/ → tests/ → scripts/

Day 4 — 理解演进
  CHANGELOG.md → git log --oneline --since="1 year"
```

必须说明**为什么**按这个顺序读。

### 9. Cross-Reference（交叉引用）

章节之间必须引用。**禁止**每一节独立于其他节。

引用格式：
```
[§2 Runtime] → 这个决策导致了 §2 描述的四层 Cache
[§5 Challenge #2] → 这个假设在 §5 被挑战，结果 modified
[§7 Atlas: Center] → Gateway 是架构中心（§7 标注）
```

---

## 报告结构

### 必需章节（按顺序）

| # | 章节 | 核心约束 |
|---|------|---------|
| 1 | **执行摘要** | 一句话定位 + 3 个核心发现 + 架构中心假设 |
| 2 | **Runtime** | 详见 §Runtime 问题列表 |
| 3 | **Architecture** | 详见 §Architecture 问题列表；含 Architecture Atlas |
| 4 | **Key Decisions** | 每个决策 9 字段 + Design Space；必须 cross-ref 其他章节 |
| 5 | **Model Challenge** | 每个挑战必须展开 Observation→Evidence→Interpretation→Conclusion |
| 6 | **Maintainer Handbook** | How to Extend / Debug / Migrate / Remove / Refactor |
| 7 | **Repository Tour** | 阅读顺序 + 为什么按这个顺序 |
| 8 | **Unresolved Questions** | coverage<0.5 的领域，含缺失证据说明 |

### 可选章节（有内容才出现）

- **Architecture Evolution** — 重大重构或设计转向
- **Unexpected Findings** — 与预期不符的现象
- **Risks** — 潜在失败模式
- **Reusable Ideas** — 可迁移到其他系统的模式

---

## Quality Gate for Report

报告生成后，必须自检以下问题：

1. 每个关键结论是否经历了 **Observation → Evidence → Interpretation → Alternative → Challenge → Conclusion** 六步？还是只写了结论？
2. 每个章节是否回答了该节对应的必答问题？
3. 每个决策是否包含 9 字段？是否有至少 1 个被拒绝方案？
4. 是否有跨章节引用？
5. Architecture Atlas 是否标注了每个模块的角色？
6. 每个结论是否标注了 Evidence Strength（Confidence / Evidence Count / Counter Evidence / Alternative）？
7. 是否有 Maintainer Handbook？是否覆盖了 Extend / Debug / Migrate 至少三项？
8. 是否有 Repository Tour？是否说明了阅读顺序的理由？

**如果任一问题答"否"，报告不合格，需要重写。**
