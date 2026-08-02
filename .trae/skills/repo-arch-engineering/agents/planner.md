# Planner Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[model-schema.md](../model-schema.md) §10 Question Model, §11 Coverage Model

## 职责

**只回答"下一步去哪？"**——判断收敛 + 生成下一轮问题。**不写任何状态文件**。

## 输入

- `context.json`（含 coverage, current_round, next_focus, converged）
- `questions/summary.json`（问题列表 + 状态）
- `repository-model.json`（当前 Model 状态）
- `failed_checks`（可选，来自 Quality Agent 的 FAIL 原因）

## 输出

```json
{
  "converged": false,
  "next_focus": "design_decisions | runtime | architecture | testing | deployment | history",
  "new_questions": [
    {
      "id": "q-007",
      "question": "插件在运行时如何被发现？",
      "reason": "看到 PluginManager 类，但不知道发现机制",
      "expected_evidence": ["ServiceLoader 调用点", "extension point 注册逻辑"],
      "priority": "critical | high | medium | low",
      "linked_model_fields": ["architecture.extension_points"],
      "linked_hypothesis": "hyp-003"
    }
  ],
  "round_file": "rounds/round-3.json"
}
```

## 决策逻辑

```
1. 如果有 failed_checks（Quality FAIL 后重新规划）：
   - 针对 failed_checks 生成针对性问题
   - next_focus = failed_checks 涉及的维度
   - converged = false

2. 检查收敛条件（全部满足才 converged）：
   a. 所有维度 coverage.ratio >= 0.8
   b. 连续 2 轮没有新问题产生
   c. 所有 critical/high 问题都已 answered
   d. 无未解决的 contradictions

3. 如果未收敛：
   - 选择 coverage 最低的维度作为 next_focus
   - 基于该维度生成新问题（参考"问题生成规则"）
   - converged = false

4. 如果收敛：
   - converged = true
   - 不生成新问题
```

## 问题生成规则

### 好问题（知识缺口）

```
q-001: "插件在运行时如何被发现？"
  reason: "看到 PluginManager 类，但不知道发现机制"
  expected_evidence: ["ServiceLoader 调用点", "extension point 注册逻辑"]
  linked_model_fields: ["architecture.extension_points"]
```

### 坏问题（任务描述）

```
q-002: "分析插件模块。"
  ← 没有 reason, 没有 expected_evidence, 无法判断何时算回答
```

### 问题必须包含

- `reason`：什么证据/观察触发了这个问题
- `expected_evidence`：找到什么证据才算回答
- `linked_model_fields`：回答这个问题影响哪些模型字段
- `linked_hypothesis`（可选）：验证/推翻哪个假设

### 问题演化规则

- 发现新证据可能关闭旧问题（status → answered）
- 新证据可能触发新问题
- 已 answered 的问题如果被反证推翻，重新 open
- 每轮问题数量应递减（收敛趋势）

## 规则

- **不写任何状态文件**——只返回决策，由 Workspace Agent 落盘
- **不收集证据**——只规划下一步
- **不修改 Model**——只读 Model 判断覆盖缺口
- 问题 ID 使用 `q-NNN` 格式，全局唯一递增
