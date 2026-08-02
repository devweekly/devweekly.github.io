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
├── report-draft.md          # Report Agent 工作版本（Quality 检查的对象）
├── report.md                # Quality 通过的版本（由 Workspace 从 draft rename 发布）
└── meta.json                # 元信息
```

## 文件所有权矩阵

每个 Agent 只读写自己负责的文件，禁止越界。

| 文件 | Resume | Scan | Planner | Workspace | Evidence | Model | Reasoning | Report | Quality | Orchestrator |
|------|--------|------|---------|-----------|----------|-------|-----------|--------|---------|-------------|
| `meta.json`（`analysis_target_commit`） | R | **W** | R | R | R | R | R | R | R | — |
| `meta.json`（`last_analyzed_commit` / `analyzed_at` / 清空 target） | R | R | R | **W** | R | R | R | R | R | — |
| `context.json`（`resume`） | **R+W** | — | — | — | — | — | — | — | — | — |
| `context.json`（`current_round` / `current_question_file`） | R | — | — | **W** | R | R | R | R | R | — |
| `context.json`（`pending_invalidation`） | R | **W** | — | **W**(clear on checkpoint) | R | R | R | — | — | — |
| `context.json`（`coverage`/`model_stability`/`architecture_model`/`challenge_record`/`design_space`/`maintainer_view`） | R | — | — | — | — | — | **R+W** | R | R | — |
| `context.json`（`quality_gate`） | R | — | — | — | — | — | — | — | **R+W** | — |
| `artifacts/repository-profile.json` | R | R+W | R | — | R | R | R | — | — | — |
| `artifacts/directory-tree.json` | R | R+W | R | — | R | R | R | — | — | — |
| `artifacts/symbol-index.json` | R | R+W | R | — | R | R | — | — | — | — |
| `artifacts/git-summary.json` | R | R+W | R | — | R | R | R | — | — | — |
| `artifacts/evidence-log.jsonl` | R | — | — | — | **R+W** | R | R | R | R | — |
| `repository-model.json` | R | — | — | — | — | **R+W** | R | R | R | — |
| `questions/round-N.json` | R | — | **W(new only)** | — | R | R | R | R | R | — |
| `questions/summary.json` | R | — | R | **R+W** | — | — | R | R | R | — |
| `report-draft.md` | — | — | — | — | — | — | — | **W** | R | — |
| `report.md` | — | — | — | **W**(rename from draft) | — | — | — | — | R | — |

> R = 只读, W = 可写, R+W = 读写, — = 不访问, W(new only) = 只能创建新文件, **粗体** = 唯一写入者

### 关键所有权变更（本次重构）

| 文件 | 旧 Owner | 新 Owner | 变更理由 |
|------|---------|---------|---------|
| `repository-model.json` | Evidence (R+W) | **Model (R+W 唯一)** | Evidence 职责过载（读文件+写 log+建 Model），拆分后 Model 专责维护 |
| `questions/summary.json` | Orchestrator (R+W) | **Workspace (R+W 唯一)** | Orchestrator 退化为纯调度，不写状态文件 |
| `context.current_round` | Orchestrator (W) | **Workspace (W 唯一)** | 同上 |
| `meta.last_analyzed_commit` | Report (W) | **Workspace (W 唯一)** | Report 只写 draft，checkpoint 提交由 Workspace 在 Quality PASS 后执行 |
| `report.md` | Report (W) | **Workspace (W，rename from draft)** | Report 写 draft，Workspace 在 Quality PASS 后发布；`report.md` 始终是 Quality 通过版本 |
| `report-draft.md` | — | **Report (W 唯一)** | 新增：Report 工作版本，Quality 检查对象 |

## context.json 逻辑分块（按 Owner）

context.json 是一个 JSON 文件，但逻辑上按 Owner 分块。每个 Agent 只更新自己负责的块：

```json
{
  "user_input": "...",                    // Owner: Resume（只读，首次写入后不变）

  "resume": {                             // Owner: Resume
    "last_completed_stage": "report",
    "next_stage": "quality",
    "last_round": 2
  },

  "current_round": 2,                     // Owner: Workspace（基于 Planner 返回值更新）
  "current_question_file": "...",         // Owner: Workspace

  "coverage": {                           // Owner: Reasoning（可计算格式）
    "runtime": { "answered": 17, "total": 20, "ratio": 0.85 },
    "architecture": { "answered": 19, "total": 20, "ratio": 0.95 },
    "design_decisions": { "answered": 14, "total": 20, "ratio": 0.70 },
    "testing": { "answered": 11, "total": 20, "ratio": 0.55 },
    "deployment": { "answered": 15, "total": 20, "ratio": 0.75 },
    "history": { "answered": 6, "total": 20, "ratio": 0.30 }
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

  "design_space": [                       // Owner: Reasoning（含成熟替代方案对比）
    {
      "decision": "...",
      "chosen": "...",
      "rejected": [...],
      "rejected_reason": "...",
      "tradeoff": "...",
      "mature_alternatives_compared": [
        { "alternative": "Event Sourcing", "why_not": "...", "evidence": [...] }
      ]
    }
  ],

  "maintainer_view": {                    // Owner: Reasoning（含 Blast Radius + Change Difficulty + Design Smells）
    "modification_impact_map": {...},
    "complexity_drivers": [...],
    "blast_radius": [
      { "component": "...", "impact_scope": [...], "risk_level": "Critical", "reason": "..." }
    ],
    "change_difficulty": [
      { "modification": "...", "difficulty": "Very Low", "reason": "..." }
    ],
    "design_smells": [
      { "smell": "...", "type": "Deliberate", "evidence": [...], "note": "无法证实是永久决策" }
    ]
  },

  "quality_gate": {...},                  // Owner: Quality（只写 quality_gate 字段，不改其他）

  "pending_invalidation": null            // Owner: Scan（写）→ Workspace（checkpoint 时清除）
}
```

### Owner 职责速查

| 块 | Owner | 读取者 |
|----|-------|--------|
| `resume` | Resume | 所有 Agent |
| `current_round` / `current_question_file` | Workspace | 所有 Agent |
| `coverage` / `model_stability` / `architecture_model` / `challenge_record` / `design_space` / `maintainer_view` | Reasoning | 所有 Agent |
| `quality_gate` | Quality | Planner（读 failed_checks） |
| `pending_invalidation` | Scan（写）→ Workspace（checkpoint 时清除） | Evidence + Model + Reasoning |

## 产物缓存策略

| 分类 | 产物 | 更新规则 |
|------|------|---------|
| **可复用** | artifacts/*.json（repository-profile, directory-tree, symbol-index, git-summary） | 代码没变时禁止重新生成 |
| **可复用+追加** | evidence-log.jsonl | append-only，禁止改写已有行 |
| **允许修改** | context.json, repository-model.json, summary.json | 首次创建后持久化，恢复时加载继续，增量更新 |
| **禁止修改** | round-N.json | 创建后永久冻结 |
| **每次重新生成** | report-draft.md | 每次分析重新生成（Report Agent 写） |
| **Quality PASS 后发布** | report.md | Workspace Agent 从 report-draft.md rename，始终是 Quality 通过版本 |

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
  meta.analyzed_at = <now>
  context.pending_invalidation = null
  report-draft.md → report.md（rename，覆盖旧版本）
```

## Stage 命名（用于 resume 定位）

| Stage 名 | 对应 Agent | next_stage 取值 |
|---------|-----------|----------------|
| `resume` | Resume | `scan` 或 `planner` 或 `report` 或 `done` |
| `scan` | Scan | `planner` |
| `planner` | Planner | `evidence` 或 `report`（收敛时） |
| `evidence` | Evidence | `model` |
| `model` | Model | `reasoning` |
| `reasoning` | Reasoning | `planner`（循环） |
| `report` | Report | `quality` |
| `quality` | Quality | `workspace`（PASS）或 `planner`（FAIL） |
| `workspace` | Workspace | `done`（仅 Quality PASS 后的 checkpoint+publish 场景） |
| `done` | — | — |

> Workspace 在 loop 内部（Planner 未收敛后持久化轮次状态）不对应 Stage——那是内联操作，崩溃后从 Planner 重新开始即可。只有 Quality PASS 后的 checkpoint+publish 场景才需要 Stage 定位（崩溃后 Resume Agent 看到 `next_stage=workspace` 会重新调用 Workspace 完成发布）。

### `context.resume` 更新权

`context.resume`（`last_completed_stage` / `next_stage`）是框架字段，由刚完成的 Agent 更新：

| Agent | 更新 resume 的时机 |
|-------|------------------|
| Resume | 恢复现场时设置 `next_stage` |
| Report | 写完 draft 后设 `last_completed_stage="report"`, `next_stage="quality"` |
| Quality | 检查完后设 `last_completed_stage="quality"`, `next_stage="workspace"`（PASS）或 `"planner"`（FAIL） |
| Workspace | checkpoint+publish 完成后设 `last_completed_stage="workspace"`, `next_stage="done"` |
