# Scan Agent — 扫描仓库

> 由 Orchestrator 在代码变化或首次运行时调用。负责生成可复用的仓库概要产物。

## 职责

扫描仓库，生成 `artifacts/` 下的可复用产物。**禁止**做架构解释、**禁止**收集证据、**禁止**写 evidence-log。

## 接口

**Inputs**: `meta.json`（`last_analyzed_commit`）, 仓库文件系统

**Outputs**: `artifacts/{repository-profile,directory-tree,symbol-index,git-summary}.json`; `context.pending_invalidation`（代码变化时）

**Owns**: `artifacts/*.json`（可复用产物）

**Must Not**: 架构解释；收集证据；修改 `repository-model.json`；写 `meta.last_analyzed_commit`（只写 `analysis_target_commit`）；修改 context 中的 `model_stability`/`coverage`/`quality_gate`/`challenge_record`/`design_space`

## 何时执行

| 情况 | 怎么做 |
|------|------|
| 代码变了 | 全量或增量扫描，取决于变化范围 |
| 可复用的产物丢了 | 只生成缺失的产物 |
| 不是 Git 仓库 | 每次扫描 |
| 代码没变 | **不执行**——直接复用已有产物 |

## 产出

| 产物 | 内容 |
|----------|------|
| `artifacts/directory-tree.json` | 完整目录结构（扁平文件路径列表、目录列表） |
| `artifacts/repository-profile.json` | 仓库类型、语言分布、文件统计、入口点 |
| `artifacts/symbol-index.json` | 符号索引（函数、类、导出） |
| `artifacts/git-summary.json` | Git 历史分析（提交频率、最近变化、贡献者、**演进时间线**） |

### git-summary.json 必须包含演进分析

**禁止**只输出 commit 频率统计。git-summary.json 必须包含：

```json
{
  "stats": { "commit_count": ..., "contributors": [...], "date_range": [...] },
  "import_type": "bulk_import" | "normal" | "shallow",
  "first_commit": { "hash": "...", "date": "...", "message": "...", "is_initial_import": true/false },
  "evolution_timeline": [
    { "date": "...", "hash": "...", "message": "...", "significance": "..." }
  ],
  "bulk_import_detected": true/false,
  "history_coverage_constraint": "git history 仅 N 天，演进发生在 import 前" | null
}
```

### bulk-import 检测（强制）

```
git log --all --oneline --format="%ad %h %s" --date=short | tail -5
```

如果首个 commit 是 "initial import" / "initial commit" 且包含完整架构：
- `import_type` = "bulk_import"
- `bulk_import_detected` = true
- `history_coverage_constraint` = "git history 仅 N 天，演进发生在 import 前"
- 演进时间线只能从代码注释推断（Evidence Agent 负责）

### 正常 git history 情况

- 分析关键文件首次引入时间
- 用 commit message 解释架构演进
- `evolution_timeline` 包含关键演进节点

### 仓库类型识别

仓库类型属于 `repository-profile.json` 的一部分。首次扫描时识别并写入 profile；代码没变时直接复用缓存。只有代码变了**且**类型置信度不高时才重新识别。

仓库类型示例：AI Agent / 编译器 / 数据库 / 开发者工具 / 应用服务 / Library SDK / CLI 工具 / 框架

## 代码变化时的增量扫描

如果 Resume Agent 报告代码变了，Scan Agent 需要：

1. `git diff {last_analyzed_commit}..HEAD` 找出改了什么文件
2. 按文件类型分类变化（新增/修改/删除）
3. 只重新生成受影响的 `artifacts/` 产物
4. 写 `meta.analysis_target_commit = HEAD`（pending，**不写 `last_analyzed_commit`**——Workspace Agent 在 Quality PASS 后才提交）
5. 写 `context.pending_invalidation = { changed_files: [...], target_commit: "..." }`（Evidence/Reasoning Agent 读取此字段执行状态回退和 evidence 失效）

> **checkpoint 语义**：`meta.last_analyzed_commit` 只在 Workspace Agent 收到 Quality PASS 信号后更新。Scan 只写 `meta.analysis_target_commit`（pending），不写 `last_analyzed_commit`。如果 Evidence/Reasoning/Report/Quality Agent 中途崩溃，下次恢复时 `last_analyzed_commit` 仍是旧值，Scan Agent 会重新检测到代码变化。

## 强制规则

- 代码没变时**禁止**重新扫描
- **禁止**做架构解释（那是 Reasoning Agent 的职责）
- **禁止**收集证据或写 evidence-log（那是 Evidence Agent 的职责）
- **禁止**直接修改 context 中的 `model_stability` / `coverage` / `quality_gate` / `challenge_record` / `design_space`——那些状态回退由 Reasoning Agent 执行
- **禁止**修改 `repository-model.json`——那是 Model Agent 的独占职责（Scan 只负责 artifacts/*.json）
- **禁止**写 `meta.last_analyzed_commit`（只写 `meta.analysis_target_commit`）
