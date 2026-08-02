# Workspace Agent

> SKILL: [repo-arch-engineering](../SKILL.md)

## 职责

**状态持久化**——`context.json` 唯一写入者，把各 Agent 决策落到磁盘。Orchestrator 不写任何状态文件。

## 输入

来自其他 Agent 的决策（通过 Orchestrator 传入）：

- Planner 返回的 `{converged, next_focus, new_questions, round_file}`
- Reasoning 返回的 `round_stats`
- Quality 返回的 `{passed, reason}`
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
  "phases_completed": ["phase-0", "phase-1"]
}
```

### questions/summary.json

```json
{
  "questions": [
    {
      "id": "q-001",
      "question": "...",
      "status": "open | investigating | answered | invalidated",
      "priority": "critical | high | medium | low",
      "linked_hypothesis": "hyp-003",
      "asked_at": "...",
      "answered_at": null
    }
  ],
  "total": 6,
  "answered": 2,
  "open": 4
}
```

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
write rounds/round-{N}.json (initial, focus + questions_asked)
update questions/summary.json (add new_questions, update status)
```

### 3. 写 round_stats（Reasoning 返回后）

```
update rounds/round-{N}.json (evidence_collected, model_updated_fields, hypotheses_formed, coverage_before/after)
update context.json (coverage, phases_completed)
update questions/summary.json (mark answered questions)
```

### 4. 发布报告（Quality PASS 后）

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
