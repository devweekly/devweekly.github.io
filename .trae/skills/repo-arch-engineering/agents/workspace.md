---
name: workspace
description: 状态持久化 Agent——context.json 唯一写入者，初始化/恢复 working dir，把各 Agent 决策落到磁盘。
---

# Workspace Agent

> SKILL: [repo-arch-engineering](../SKILL.md)

## 职责

**状态持久化**——`context.json` 唯一写入者，把各 Agent 决策落到磁盘。Orchestrator 不写任何状态文件。

## 输入

来自其他 Agent 的决策（通过 Orchestrator 传入）：

- Planner 返回的 `{converged, next_focus, new_questions, round}`
- Reasoning 返回的 `round_stats`
- Quality 返回的 `{passed, reason}`（`gated-fail` 时另含 `gate_failed_route` / `gate_failed_reason`，供 Orchestrator 路由，**此时不发布报告**）
- Resume 返回的 `{next, pending_invalidation}`

## 输出

### context.json（唯一工作记录）

```json
{
  "repo_path": "/absolute/path/to/repo",
  "repo_name": "dbeaver",
  "created_at": "2026-08-02T10:00:00Z",
  "current_round": 2,
  "analysis_target_commit": "abc1234",
  "last_analyzed_commit": null,
  "pending_invalidation": false,
  "converged": false,
  "next_focus": "design_decisions",
  "coverage": { /* §11 Coverage Model */ },
  "questions_summary": "questions/summary.json",
  "phases_completed": ["reconnaissance", "structural_discovery"]
}
```

> `phases_completed` 使用命名相位（`reconnaissance` / `structural_discovery` / `architecture_reconstruction` / `runtime_reconstruction` / `design_decision_mining` / `evolution_analysis` / `model_validation`），不用 `phase-0` 式编号。

### questions/summary.json

```json
{
  "questions": [
    {
      "id": "q-001",
      "type": "boundary | decision | runtime | evolution | risk | pattern",
      "question": "...",
      "status": "open | investigating | validated | rejected | blocked | model_updated",
      "priority_score": 0.9,
      "impact": "high",
      "uncertainty": "high",
      "hypothesis_ref": "hyp-003",
      "asked_at": "...",
      "closed_at": null
    }
  ],
  "total": 6,
  "by_status": { "model_updated": 2, "blocked": 0, "open": 4 }
}
```

> 状态机见 [SKILL.md](../SKILL.md) Step 4：`open → investigating → validated/rejected/blocked → model_updated`。终态为 `model_updated` / `blocked`。聚合用 `by_status`，不用 `answered` 计数。

### rounds/round-{N}.json

```json
{
  "round": 2,
  "focus": "design_decisions",
  "questions_asked": ["q-005", "q-006"],
  "evidence_collected": 12,
  "model_updated_fields": ["design_decisions[0]", "design_decisions[1]"],
  "hypotheses_formed": ["hyp-003"],
  "coverage_before": { "design_decisions": { "ratio": 0.0 } },
  "coverage_after": { "design_decisions": { "ratio": 0.25 } },
  "started_at": "...",
  "completed_at": "..."
}
```

## 操作类型

### 1. 初始化 working folder（首次分析）

```
mkdir -p .working/{repo-name}/{artifacts,questions,rounds}
touch .working/{repo-name}/evidence-log.jsonl
write .working/{repo-name}/context.json (initial state)
write .working/{repo-name}/questions/summary.json (empty)
```

### 2. 新建轮次条目（Planner 返回后）

```
update context.json: current_round += 1, next_focus, converged
write questions/round-{N}.json (Planner 生成的问题，由 Workspace 代写落盘)
write rounds/round-{N}.json (initial, focus + questions_asked)
update questions/summary.json (add new_questions, update status)
```

### 3. 写 round_stats（Reasoning 返回后）

```
update rounds/round-{N}.json (evidence_collected, model_updated_fields, hypotheses_formed, coverage_before/after)
update context.json (coverage, phases_completed)
update questions/summary.json (把进入终态的问题标为 model_updated / blocked，填 closed_at)
```

### 4. 发布报告（Quality PASS 后）

**前置条件：Quality 返回 `passed: true`，且已包含 §6.7 Hard Gate PASS（`report-draft.md` 纯内容字符 ≥ 12000）。若 Quality 返回 `gated-fail`：不发布，保留 `report-draft.md` 供回炉覆盖，`gate_failed_route` 交 Orchestrator 路由。**

```
rename report-draft.md → report.md
update context.json:
  last_analyzed_commit = analysis_target_commit
  analysis_target_commit = null
  pending_invalidation = false
  converged = true
```

### 5. 崩溃恢复（Resume 返回 next=workspace）

```
检查 report-draft.md 是否存在且 Quality 已 PASS
如果是 → 执行操作 4（发布报告）
```

## 规则

- **context.json 唯一写入者**——其他 Agent 不直接写
- **evidence-log.jsonl 不归 Workspace 管**——Evidence Agent 直接 append
- **repository-model.json 不归 Workspace 管**——Model Agent 直接写
- 所有操作必须是原子写入（先写临时文件再 rename）
- 时间戳使用 ISO 8601 UTC
