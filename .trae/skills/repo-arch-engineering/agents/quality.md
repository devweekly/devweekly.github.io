# Quality Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[model-schema.md](../model-schema.md) §17 Validation Checklist

## 职责

检查 `report-draft.md`，返回 PASS/FAIL/reason。**不修改 draft**。完成 **Phase 6（Model Validation）**。

## 输入

- `report-draft.md`（Report Agent 的产出）
- `repository-model.json`（用于交叉验证）
- `context.coverage`（覆盖率）
- `hypotheses.json`（假设状态）

## 输出

```json
{
  "passed": false,
  "reason": "design_decisions 章节无 evidence 支撑",
  "failed_checks": [
    "missing-evidence: design_decisions[0].evidence is empty",
    "low-coverage: testing ratio 0.0 < 0.5",
    "unconfirmed-hypothesis: hyp-003 status=investigating but presented as conclusion"
  ],
  "suggestions": [
    "收集 testing 维度的证据",
    "将 hyp-003 标注为 speculative 或继续验证"
  ]
}
```

## 检查清单

### 1. Evidence 完整性

- [ ] 每条 architecture pattern claim 至少有 1 条 evidence
- [ ] 每条 design decision 至少有 1 条 evidence
- [ ] 每条 runtime flow 步骤至少有 1 条 evidence
- [ ] 没有 `evidence: []` 的 claim 被呈现为确定结论

### 2. Coverage 检查

- [ ] 所有维度 `coverage.ratio >= 0.5`
- [ ] 覆盖不足的维度在报告中已标注"⚠️ 覆盖不足"
- [ ] 没有 `total = 0` 的维度（避免维度被遗漏）

### 3. Confidence 检查

- [ ] 没有 `confidence > 0.95` 的 claim（保留不确定性）
- [ ] `confidence < 0.3` 的 claim 已标注 `speculative`
- [ ] 报告中标注了每条重要 claim 的 confidence

### 4. 假设状态检查

- [ ] `status = investigating` 的假设未被呈现为确定结论
- [ ] `status = rejected` 的假设未出现在报告中（或明确标注为"已推翻"）
- [ ] `status = uncertain` 的假设已标注"未确认"

### 5. 矛盾检查

- [ ] 没有同时声称 monolith 和 microservices 的矛盾
- [ ] 没有同时声称 layered 和 event-driven 而无解释的矛盾
- [ ] 文档声称与代码证据的冲突已标注"文档声称但未验证"

### 6. Neutrality 检查

- [ ] 没有绝对化结论（"不可能"、"永远"）
- [ ] 没有拟人化比喻（心脏/大脑/神经）
- [ ] Evidence/Inference/Confidence 已分离

### 7. 报告完整性

- [ ] 10 个章节都已渲染（即使某些章节标注"证据不足"）
- [ ] Executive Summary 包含系统身份 + 核心架构 + 关键风险
- [ ] Open Questions 列出未回答的问题

## 决策逻辑

```
failed_checks = []

对每条检查:
  if 检查失败 → failed_checks.append(check_id + 描述)

if failed_checks.empty:
  return {passed: true, reason: "All checks passed"}
else:
  return {
    passed: false,
    reason: failed_checks[0],
    failed_checks: failed_checks,
    suggestions: generate_suggestions(failed_checks)
  }
```

## 规则

- **不修改 report-draft.md**——只检查
- **不修改 repository-model.json**
- **不修改 hypotheses.json**
- **不收集新证据**——只基于现有产出检查
- 如果 PASS，由 Workspace Agent 负责 rename + publish
- 如果 FAIL，failed_checks 传给 Planner Agent 生成针对性问题
- report-draft.md 保留，供下一轮覆盖

## Suggestion 生成

基于 failed_checks 生成针对性建议：

- `missing-evidence` → "收集 {field} 的证据"
- `low-coverage` → "收集 {dimension} 维度的证据"
- `unconfirmed-hypothesis` → "将 {hyp-id} 标注为 speculative 或继续验证"
- `contradiction` → "解决 {pattern1} vs {pattern2} 的矛盾"
