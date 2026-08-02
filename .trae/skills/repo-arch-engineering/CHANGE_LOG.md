# CHANGE_LOG.md — 状态变更日志

> 本文档记录每个 Step 执行后 `context.json` 的状态变更规则。
> SKILL.md 只描述流程，状态变更细节集中在此。

## Step 2 — 快速分析 Repo 完成后

```
context.json.phases_completed += "reconnaissance"
```

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

收敛条件：`coverage.ratio >= 0.8 AND coverage.confidence >= 0.75`

## Step 6 — 写 report.md 完成后

```
context.json.converged = true
context.json.last_analyzed_commit = context.json.analysis_target_commit
context.json.analysis_target_commit = null
context.json.pending_invalidation = false
```

## 非首次分析（Step 1 检测到 commit 变化）

```
context.json.pending_invalidation = true
context.json.analysis_target_commit = <new commit hash>
# 增量更新：只重新分析受影响部分，不重新生成整个 Model
```
