# 报告规范（Report Schema）

> 本文档定义 Repository Research 的输出契约。报告必须遵循此 Schema。

---

## 证据链（Evidence Chain）

每一个非平凡结论都必须能够追溯到证据链。

```mermaid
flowchart TD
    A[Conclusion] --> B[Interpretation]
    B --> C[Evidence]
    C --> D[Repository Artifact]
    D --> E[File / Symbol / Commit]
```

证据来源：

| 来源 | 说明 |
|---------|------|
| 源代码 | 实现层面的直接证据 |
| 文档 | README / ADR / RFC / 设计文档 |
| 配置 | 构建配置 / CI 配置 / 部署配置 |
| 测试 | 测试用例反映的预期行为 |
| Git 历史 | 提交历史反映的演进意图 |
| 仓库元数据 | package.json / Cargo.toml 等 |

多个独立来源相互印证时，优先于单一来源。

---

## 置信度等级

每个解释必须标注置信度。置信度反映证据质量，而非模型确定性。

| 等级 | 要求 |
|------|------|
| **High** | 多个独立证据来源相互支持 |
| **Medium** | 证据存在，但解释仍有不确定性 |
| **Low** | 证据薄弱或仅间接推断 |

---

## Open Questions 格式

研究结束后仍可能存在无法验证的问题。每项必须包含：

| 字段 | 说明 |
|------|------|
| **Question** | 待回答的问题 |
| **Missing Evidence** | 缺失的证据类型 |
| **Confidence Impact** | 对整体置信度的影响 |
| **Suggested Next Investigation** | 建议的下一步调查方向 |

---

## 报告章节

最终报告必须包含以下 17 个章节：

| # | 章节 | 说明 |
|---|------|------|
| 1 | **Executive Summary** | 执行摘要 |
| 2 | **Repository Mental Model** | 维护者心智模型 |
| 3 | **Architectural Invariants** | 架构不变量 |
| 4 | **Engineering Constraints** | 工程约束 |
| 5 | **Capability Map** | 能力地图 |
| 6 | **Static Architecture** | 静态架构 |
| 7 | **Runtime Architecture** | 运行时架构 |
| 8 | **Evolution** | 架构演进 |
| 9 | **Key Decisions** | 关键决策 |
| 10 | **Architectural Forces** | 架构作用力 |
| 11 | **Design Tensions** | 设计张力 |
| 12 | **Architectural Leverage** | 架构杠杆点 |
| 13 | **Reusable Patterns** | 可复用模式 |
| 14 | **Risks** | 风险 |
| 15 | **Lessons Learned** | 经验教训 |
| 16 | **Open Questions** | 未解问题 |
| 17 | **Evidence Quality Summary** | 证据质量摘要 |

---

## Repository Model 维度

Stage 1 产出的 Repository Model 必须描述以下 5 个维度：

| 模型 | 描述 |
|------|------|
| **Structural Model** | 模块、目录、组件及其边界 |
| **Behavioral Model** | 控制流、数据流、运行流程 |
| **Ownership Model** | 状态、职责、生命周期归属 |
| **Extension Model** | 插件机制、扩展点、公共 API |
| **Evolution Model** | 架构演进与历史变化 |

---

## Stage 2 输出类型

Stage 2 的 Architectural Interpretation 必须产出以下类型的内容：

- Engineering Constraints
- Architectural Forces
- Design Decisions
- Trade-offs
- Deliberate Omissions
- Architectural Tensions
- Leverage Points
- Maintainer Mental Model

如果存在多个合理解释，分别说明并给出各自证据与置信度。
