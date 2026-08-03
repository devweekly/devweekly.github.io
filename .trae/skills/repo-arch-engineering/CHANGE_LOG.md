# CHANGE_LOG.md — 状态变更日志

> 本文档记录每个 Step 执行后 `context.json` 的状态变更规则。
> SKILL.md 只描述流程，状态变更细节集中在此。

## Step 2 — 快速分析 Repo 完成后

```
context.json.phases_completed += "reconnaissance"        # Phase 0
context.json.phases_completed += "structural_discovery"  # Phase 1
```

> Step 2 包含 Phase 0（身份事实 + business_signals → repository-profile.json）与 Phase 1（架构单元 + 模块清单 → directory-model.json / module-model.json），两个相位一次完成。

## Step 3 — 生成 round-N.json 完成后

```
context.json.current_round = N
context.json.next_focus = (本轮 focus)
```

## Step 4 — 深入分析完成后

```
context.json.coverage = {
  <dimension>: {
    answered: count(questions with status == "model_updated" or "blocked"),
    total: count(all questions in this dimension),
    ratio: answered / total,
    confidence: avg(confidence of validated/rejected questions),
    validated_claims: count(questions with status == "model_updated")
  }
}
```

覆盖率基于 `model_updated` + `blocked` 状态的问题数计算（终态问题）。

**相位累计规则（Step 4 内 Evidence → Model → Reasoning 按 focus 推进 Phase 2-5）：**

```
Model Agent 更新 architecture 字段后   → phases_completed += "architecture_reconstruction"（若无）
Model Agent 更新 runtime 字段后        → phases_completed += "runtime_reconstruction"（若无）
Reasoning Agent 更新 design_decisions  → phases_completed += "design_decision_mining"（若无）
Reasoning Agent 更新 evolution         → phases_completed += "evolution_analysis"（若无）
```

相位按**首次完成**累计，不重复追加；同一 Step 4 轮次可累计多个相位。

收敛条件：`coverage.ratio >= 0.8 AND coverage.confidence >= 0.75`

## Step 5 — 收敛检查后

```
# Planner 判断，Workspace 落盘：
converged = true  → 进入 Step 6
converged = false → context.json.current_round += 1，回 Step 3 生成下一轮问题
```

## Step 6 — 报告发布完成后（Quality PASS 含 §6.7 Hard Gate）

```
context.json.phases_completed += "model_validation"  # Quality Agent PASS 后
context.json.converged = true
context.json.last_analyzed_commit = context.json.analysis_target_commit
context.json.analysis_target_commit = null
context.json.pending_invalidation = false
```

> 只有 Quality PASS（含 §6.7 字符门槛）后 Workspace 才 rename `report-draft.md → report.md` 并做上述变更。`gated-fail` / 质量门 FAIL → **不发布、不改 context**，按 `gate_failed_route`（step3/step4/step5）回炉，见 SKILL §6.7.1。

## 非首次分析（Step 1 检测到 commit 变化）

```
context.json.pending_invalidation = true
context.json.analysis_target_commit = <new commit hash>
# 增量更新：只重新分析受影响部分，不重新生成整个 Model
```
