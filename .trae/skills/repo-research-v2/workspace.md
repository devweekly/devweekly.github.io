# Workspace — 工作目录 + 文件所有权 + 缓存策略

> SKILL.md 是 Orchestrator，不包含这些实现细节。本文档定义工作目录结构、各 Agent 的文件读写权限、产物缓存规则。

## 工作目录结构

每次分析用同一个工作目录，放所有中间结果和最终报告。

```
.working/{repo-name}/
├── artifacts/               # 可复用的产物（代码没变时禁止重新生成）
│   ├── repository-profile.json  # 仓库类型、语言、文件统计、入口点
│   ├── directory-tree.json      # 完整目录结构（扁平路径列表）
│   ├── symbol-index.json        # 符号索引（函数、类、导出）
│   ├── git-summary.json         # Git 历史分析
│   └── evidence-log.jsonl       # 证据日志（append-only，每文件一行，含 key_findings）
├── context.json             # 执行上下文（允许修改，增量更新）
├── questions/               # 问题轮次（不可变历史）
│   ├── round-1.json         # 第一轮问题
│   ├── round-N.json         # 第 N 轮问题
│   └── summary.json         # 轮次索引
├── repository-model.json    # Repository Model（允许修改，增量更新）
├── report.md                # 最新报告（易变）
└── meta.json                # 元信息
```

## 文件所有权矩阵

每个 Agent 只读写自己负责的文件，禁止越界。

| 文件 | Resume | Scan | Planner | Evidence | Model | Reasoning | Report | Quality | Orchestrator |
|------|--------|------|---------|----------|-------|-----------|--------|---------|-------------|
| `meta.json` | R | R+W | R | R | R | R | R+W | R | R |
| `context.json` | R+W | W(pending) | R | R | R | R+W | R | R | R+W |
| `artifacts/repository-profile.json` | R | R+W | R | R | R | R | — | — | — |
| `artifacts/directory-tree.json` | R | R+W | R | R | R | R | — | — | — |
| `artifacts/symbol-index.json` | R | R+W | R | R | R | — | — | — | — |
| `artifacts/git-summary.json` | R | R+W | R | R | R | R | — | — | — |
| `artifacts/evidence-log.jsonl` | R | — | — | **R+W** | R | R | R | R | — |
| `repository-model.json` | R | — | — | — | **R+W** | R | R | R | — |
| `questions/round-N.json` | R | — | **W(new only)** | R | R | R | R | R | — |
| `questions/summary.json` | R | — | R | — | — | R | R | R | **R+W** |
| `report.md` | — | — | — | — | — | — | **W** | R | — |
| `context.current_round` | R | — | — | R | R | R | R | R | **W** |

> R = 只读, W = 可写, R+W = 读写, — = 不访问, W(pending) = 只写 pending 字段, W(new only) = 只能创建新文件, **粗体** = 唯一写入者

### 关键所有权变更（本次重构）

| 文件 | 旧 Owner | 新 Owner | 变更理由 |
|------|---------|---------|---------|
| `repository-model.json` | Evidence (R+W) | **Model (R+W 唯一)** | Evidence 职责过载（读文件+写 log+建 Model），拆分后 Model 专责维护 |
| `questions/summary.json` | Planner (R+W) + Reasoning (R+W) | **Orchestrator (R+W 唯一)** | Planner 只决策不写状态文件 |
| `context.current_round` | Planner (R+W) | **Orchestrator (W)** | 同上 |

## context.json 逻辑分块（按 Owner）

context.json 是一个 JSON 文件，但逻辑上按 Owner 分块。每个 Agent 只更新自己负责的块：

```json
{
  "user_input": "...",                    // Owner: Resume（只读，首次写入后不变）

  "resume": {                             // Owner: Resume + Orchestrator
    "last_completed_stage": "report",
    "next_stage": "quality",
    "last_round": 2
  },

  "current_round": 2,                     // Owner: Orchestrator（基于 Planner 返回值更新）
  "current_question_file": "...",         // Owner: Orchestrator

  "coverage": {                           // Owner: Reasoning
    "runtime": 0.75, "architecture": 0.80,
    "design_decisions": 0.70, "testing": 0.55,
    "deployment": 0.75, "history": 0.30
  },

  "model_stability": "challenged",        // Owner: Reasoning

  "architecture_model": {                 // Owner: Reasoning
    "center_hypothesis": "...",
    "key_assumptions": [...],
    "architecture_invariants": [...],
    "unexplained_observations": [...],
    "competing_interpretations": []
  },

  "challenge_record": [...],              // Owner: Reasoning
  "design_space": [...],                  // Owner: Reasoning
  "maintainer_view": {...},               // Owner: Reasoning

  "quality_gate": {...},                  // Owner: Quality（只写 quality_gate 字段，不改其他）

  "pending_invalidation": null            // Owner: Scan（写）→ Reasoning（读后清除）
}
```

### Owner 职责速查

| 块 | Owner | 读取者 |
|----|-------|--------|
| `resume` | Resume + Orchestrator | 所有 Agent |
| `current_round` / `current_question_file` | Orchestrator | 所有 Agent |
| `coverage` / `model_stability` / `architecture_model` / `challenge_record` / `design_space` / `maintainer_view` | Reasoning | 所有 Agent |
| `quality_gate` | Quality | Planner（读 failed_checks）+ Orchestrator |
| `pending_invalidation` | Scan（写）→ Reasoning（读后清除） | Evidence + Model |

## 产物缓存策略

| 分类 | 产物 | 更新规则 |
|------|------|---------|
| **可复用** | artifacts/*.json（repository-profile, directory-tree, symbol-index, git-summary） | 代码没变时禁止重新生成 |
| **可复用+追加** | evidence-log.jsonl | append-only，禁止改写已有行 |
| **允许修改** | context.json, repository-model.json, summary.json | 首次创建后持久化，恢复时加载继续，增量更新 |
| **禁止修改** | round-N.json | 创建后永久冻结 |
| **每次重新生成** | report.md | 每次分析重新生成 |

## checkpoint 语义

`meta.last_analyzed_commit` 只在 **Report Agent 成功后**更新。如果 Evidence/Model/Reasoning Agent 中途崩溃，下次恢复时 `last_analyzed_commit` 仍是旧值，Scan Agent 会重新检测到代码变化。

```
Scan Agent 写 meta.analysis_target_commit（pending）
  ↓
Evidence + Model + Reasoning 执行（崩溃时 last_analyzed_commit 不变）
  ↓
Report Agent 成功
  ↓
Report Agent 提交 checkpoint:
  meta.last_analyzed_commit = meta.analysis_target_commit
  meta.analysis_target_commit = null
  context.pending_invalidation = null
```

## Stage 命名（用于 resume 定位）

| Stage 名 | 对应 Agent | next_stage 取值 |
|---------|-----------|----------------|
| `resume` | Resume | `scan` 或 `planner` |
| `scan` | Scan | `planner` |
| `planner` | Planner | `evidence` 或 `report`（收敛时） |
| `evidence` | Evidence | `model` |
| `model` | Model | `reasoning` |
| `reasoning` | Reasoning | `planner`（循环） |
| `report` | Report | `quality` |
| `quality` | Quality | `done`（PASS）或 `planner`（FAIL） |
| `done` | — | — |
