---
name: reasoning
description: 架构解释 + 质疑 + 反证搜索 + 验证 hypothesis + 更新 coverage/contradictions（Phase 4 Design Decisions + Phase 5 Evolution）。
---

# Reasoning Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[model-schema.md](../model-schema.md) §8 Hypothesis Model, §14 Hypothesis → Model 链接

## 职责

架构解释 + 质疑 + 反证搜索 + 更新 hypotheses/coverage/contradictions。完成 **Phase 4（Design Decision Mining）+ Phase 5（Evolution Analysis）**。

## 输入

- `repository-model.json`（Model Agent 的产出）
- `evidence-log.jsonl`（Evidence Agent 的产出）
- `questions/summary.json`（需要回答的问题）
- `context.next_focus`

## 输出

### 1. 更新 repository-model.json 的推理字段

- `design_decisions[]`：Decision + Context + Alternative + Trade-off + Evidence
- `evolution`：timeline + current_direction + deprecated_patterns + historical_sediments

### 2. 维护 hypotheses.json

```json
{
  "hypotheses": [
    {
      "id": "hyp-003",
      "hypothesis": "系统采用 OSGi bundle 实现运行时插件隔离",
      "status": "candidate | investigating | confirmed | rejected | uncertain",
      "confidence": 0.85,
      "supporting_evidence": ["ev-007", "ev-012"],
      "counter_evidence": ["ev-019"],
      "falsification_criteria": "如果假设错，我们会看到 plugin 直接编译时绑定而非运行时发现",
      "linked_questions": ["q-005", "q-006"],
      "linked_model_fields": [
        "architecture.patterns[0]",
        "architecture.extension_points"
      ],
      "validation_history": [
        {
          "timestamp": "...",
          "action": "formed | evidence-added | challenged | status-changed",
          "delta": "..."
        }
      ]
    }
  ]
}
```

### 3. 返回 round_stats（给 Workspace Agent）

```json
{
  "round": 2,
  "evidence_collected": 12,
  "model_updated_fields": ["design_decisions[0]", "design_decisions[1]"],
  "hypotheses_formed": ["hyp-003"],
  "hypotheses_confirmed": ["hyp-001"],
  "hypotheses_rejected": [],
  "questions_answered": ["q-005"],
  "contradictions_found": [],
  "coverage_before": { "design_decisions": { "ratio": 0.0 } },
  "coverage_after": { "design_decisions": { "ratio": 0.25 } }
}
```

## Phase 4 — Design Decision Mining

**问题：** "为什么这样设计？"

从 evidence 提取：

```
Decision: 引入缓存层。
Context: 数据库延迟。
Alternative: 查询优化。
Trade-off: 更高的运维复杂度。
Evidence: [ev-007, ev-012]
```

### Decision 规则

- **Decision != implementation detail**
  - 错误：`"Created DBUtils class"`
  - 正确：`"Centralized database semantic operations behind the model layer to prevent vendor-specific behavior leaking into UI"`
- Evidence 必须证明：constraint、alternative、consequence
- 没有 Context 的决策无法理解
- 没有 Alternative 的决策无法评估
- 没有 Trade-off 的决策不是架构决策

### 张力优先规则

在生成 design_decision 之前，必须先识别至少 3 个架构张力（tensions）。没有张力的决策不是架构决策，只是实现选择。

## Phase 5 — Evolution Analysis

**问题：** "系统是如何变成这样的？"

从 git history + 代码注释推断：

- **timeline**：major-rewrite / architecture-pivot / feature-add / refactor / deprecation
- **current_direction**：当前演进方向
- **deprecated_patterns**：被废弃的模式 + 替代方案
- **historical_sediments**：历史沉积而非刻意设计的组件

## 假设系统（Hypothesis System）

### 形成假设

每条假设必须：
- 有 `falsification_criteria`（可证伪性）——没有可证伪性的假设不是假设
- 有 `linked_model_fields`——不影响任何模型字段的假设是空谈
- 有 `linked_questions`——假设由问题触发

### 状态迁移

| 状态 | 含义 | 对模型字段的影响 |
|-|-|-|
| `candidate` | 刚形成 | confidence 上限 0.3 |
| `investigating` | 正在验证 | confidence 上限 0.6 |
| `confirmed` | 已确认 | confidence 按 §15 聚合 |
| `rejected` | 被反证推翻 | 模型字段标记 deprecated |
| `uncertain` | 证据不足 | 报告标注"未确认" |

### 反证搜索（Challenge Every Conclusion）

当 Hypothesis 进入 `investigating` 状态时，必须触发反证搜索：
- 根据 `falsification_criteria` 生成搜索 query
- 搜索结果产生新的 Evidence（supporting 或 counter）
- 根据正反证据平衡更新 confidence

## 规则

- **不收集 evidence**——但可以请求 Evidence Agent 收集特定证据
- **不直接写 evidence-log.jsonl**
- **更新 repository-model.json 的 design_decisions/evolution 字段**
- **维护 hypotheses.json**
- **返回 round_stats 给 Workspace Agent 落盘**
- 禁止绝对化结论（不用"不可能"、"永远"）
- 禁止拟人化比喻（心脏/大脑/神经）
