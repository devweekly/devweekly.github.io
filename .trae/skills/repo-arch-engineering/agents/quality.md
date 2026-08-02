---
name: quality
description: 检查 report-draft.md 质量，返回 PASS/FAIL/reason（Phase 6 Model Validation）。不修改 draft。
---

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

### 7. §2 必答检查（⭐ 最高优先级——FAIL 直接拒绝报告）

- [ ] §2.1 What is this repo? 存在且回答了 repo 类型、定位、价值主张、规模、目标用户
- [ ] §2.2 Business Context 存在且用**业务语言**（不是技术语言）描述满足的业务需求、业务范围、use cases、市场差异化
- [ ] §2.3 High-Level Architecture 存在且是 **high-level overview**（一句话架构 + 组件关系 + 技术栈理由 + 部署模型）
- [ ] §2.3 **没有深入技术细节**（如具体协议字段、kind 整数、SQL schema、配置参数）——技术细节应在 §5/§6
- [ ] 报告没有跳过 §2 直接讲技术细节（如"Nostr 协议 + kind 整数"出现在 §2 中 → FAIL）

### 8. Architecture Narrative 质量门检查

- [ ] `architecture-narrative.json` 已生成（不是从 repository-model 直接渲染 report）
- [ ] Narrative 的 `system_identity` 字段已填充（非空、非模板占位符）
- [ ] Narrative 的 `business_context` 字段已填充（用业务语言，含 use cases）
- [ ] Narrative 的 `high_level_architecture` 字段已填充（一句话 + 组件 + 技术栈 + 部署）
- [ ] Narrative 的 `thesis.central_idea` 是一句话，且 `if_removed` 已回答
- [ ] Narrative 的 `key_design_decisions` ≤ 5 个
- [ ] 每个 Decision 的 `implements_constraint` 绑定了有效的 Constraint ID

### 9. Evidence Level 检查

- [ ] 报告中每条重要 claim 标注了 `evidence_level`（S/A/B/C/D/E）
- [ ] 没有 `confidence > 0.8` 但 `evidence_level: D/E` 的矛盾（高置信度但仅文档/推断支撑）
- [ ] `evidence_level: E`（Inference）的 claim 已标注为 speculative

### 10. 报告完整性

- [ ] 报告结构匹配 SKILL §6.4（§1-§9 + Appendix A/B）
- [ ] Executive Summary ≤ 300 字，包含 Thesis 一句话 + 最大 trade-off
- [ ] Key Design Decisions 在 Resulting Architecture **之前**（先决策后结构）
- [ ] Appendix 内容未混入正文（research log 感）
- [ ] Unknowns 列出剩余 need_reading + blocked

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
- `§2-missing` → "补充 §2.{subsection}——回答 {question}（用业务语言，不深入技术细节）"
- `§2-too-technical` → "§2.3 过于技术化，将 {技术细节} 移到 §5/§6，§2 只保留 high-level overview"
- `narrative-missing` → "先生成 architecture-narrative.json，再渲染 report（不能从 model 直接渲染）"
- `narrative-incomplete` → "Narrative 的 {field} 未填充或为模板占位符，需要从 model + repository-profile.business_signals 填充"
- `evidence-level-missing` → "为 claim {claim_id} 标注 evidence_level（S/A/B/C/D/E）"
- `evidence-level-contradiction` → "claim {claim_id} confidence={value} 但 evidence_level={level}，需降低 confidence 或升级 evidence"
