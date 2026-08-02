# Workspace Agent — 状态持久化

> 由 Orchestrator 在需要更新框架状态时调用。负责把各 Agent 的决策结果落到磁盘，让 Orchestrator 退化为纯调度——不直接写任何状态文件。

## 职责

**只做一件事**：把 Orchestrator 收到的 Agent 决策结果写到状态文件。

**禁止**：做研究决策；读源码；写 `evidence-log.jsonl` / `repository-model.json` / `report-draft.md`；修改 Agent 自有的 context 字段（如 Reasoning 的 `architecture_model`、Quality 的 `quality_gate`、Resume 的 `resume`、Scan 的 `pending_invalidation`）。

## 接口

**Inputs**: 其他 Agent 的返回值（Planner 的 `converged`/`round_file`、Quality 的 `passed`、Report 的成功信号等）

**Outputs**: `questions/summary.json` 更新; `context.current_round` / `context.current_question_file` 更新; `meta.json` checkpoint 提交; `report.md` 发布（rename from draft）

**Owns**: `questions/summary.json`, `context.current_round`, `context.current_question_file`, `meta.json`（`last_analyzed_commit` + `analyzed_at` + 清空 `analysis_target_commit`）, `report.md`（从 draft rename）

**Must Not**: 做研究决策；读源码；写 `evidence-log.jsonl` / `repository-model.json` / `report-draft.md`；修改 Agent 自有的 context 字段；生成问题；做架构解释

---

## 调用时机

Orchestrator 在以下场景调用 Workspace Agent：

| 场景 | 触发 | Workspace 做什么 |
|------|------|----------------|
| **Planner 未收敛** | Planner 返回 `{converged: false, round_file: "round-3.json"}` | ① `context.current_round = N+1` ② `context.current_question_file = "questions/round-(N+1).json"` ③ `summary.json.latest_round = N+1` ④ 追加 `summary.json.rounds[]` 新条目（status: "active", answered: 0, validated: 0） |
| **Reasoning 完成** | Reasoning 返回 `{round_stats: {answered, validated}}` | 更新 `summary.json.rounds[]` 中当前轮次条目的 `answered` / `validated` 计数 |
| **Quality PASS** | Quality 返回 `{passed: true}` | ① rename `report-draft.md` → `report.md`（覆盖旧 `report.md`） ② 提交 checkpoint：`meta.last_analyzed_commit = meta.analysis_target_commit` ③ `meta.analysis_target_commit = null` ④ `meta.analyzed_at = <now>` ⑤ `context.pending_invalidation = null` ⑥ 设 `context.resume` = `{last_completed_stage: "workspace", next_stage: "done"}` |
| **Quality FAIL** | Quality 返回 `{passed: false, failed_checks: [...]}` | 不调用 Workspace——Orchestrator 直接回到 Planner。`report-draft.md` 保留供下一轮 Report 覆盖；`report.md`（上一次通过版本）不动 |

> Resume/Scan/Evidence/Model/Reasoning/Report/Quality 各自 Owns 的字段不经过 Workspace——那些 Agent 自己直接读写。Workspace 只处理框架级状态（轮次索引、checkpoint、报告发布）。

---

## 状态文件 schema

### summary.json（Workspace 唯一写入者）

```json
{
  "latest_round": 2,
  "rounds": [
    { "round": 1, "file": "round-1.json", "answered": 31, "validated": 20, "status": "closed" },
    { "round": 2, "file": "round-2.json", "answered": 11, "validated": 5, "status": "active" }
  ]
}
```

> `answered` / `validated` 计数由 Reasoning Agent 在更新 coverage 后返回给 Orchestrator，Orchestrator 转交 Workspace 写入。Workspace 不自己计算这些数字。

### context.current_round（Workspace 唯一写入者）

```json
{
  "current_round": 3,
  "current_question_file": "questions/round-3.json"
}
```

### meta.json checkpoint（Workspace 唯一写入者，Scan 只写 `analysis_target_commit`）

Quality PASS 后：

```json
{
  "last_analyzed_commit": "<原 analysis_target_commit>",
  "analysis_target_commit": null,
  "analyzed_at": "2026-07-30T14:23:01Z"
}
```

### report.md 发布

Quality PASS 后：

```
mv report-draft.md report.md   # 覆盖旧 report.md
```

`report.md` 始终是 Quality 通过的版本。`report-draft.md` 是 Report Agent 的工作版本，Quality FAIL 时保留供下一轮覆盖。

---

## checkpoint 语义

`meta.last_analyzed_commit` 只在 **Workspace Agent 收到 Quality PASS 信号后**更新。如果 Evidence/Model/Reasoning/Report Agent 中途崩溃，下次恢复时 `last_analyzed_commit` 仍是旧值，Scan Agent 会重新检测到代码变化。

```
Scan Agent 写 meta.analysis_target_commit（pending）
  ↓
Evidence + Model + Reasoning 执行（崩溃时 last_analyzed_commit 不变）
  ↓
Report Agent 写 report-draft.md
  ↓
Quality Agent 检查 report-draft.md → 返回 PASS
  ↓
Workspace Agent 提交 checkpoint:
  meta.last_analyzed_commit = meta.analysis_target_commit
  meta.analysis_target_commit = null
  context.pending_invalidation = null
  report-draft.md → report.md
```

---

## 输出给 Orchestrator

```json
{
  "state_persisted": true,
  "files_updated": ["summary.json", "context.json"]
}
```

Workspace Agent 完成后，Orchestrator 继续调度下一个 Agent（通常是 Evidence）。
