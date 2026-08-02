# Resume Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[workspace.md](../workspace.md)

## 职责

恢复现场，判断代码变化，返回下一步跳转目标。**不写任何状态文件**。

## 输入

- `working_folder` 路径（如 `.working/dbeaver/`）
- `repo_path`

## 输出

```json
{
  "next": "scan | planner | report | workspace | done",
  "reason": "string",
  "commit_changed": false,
  "files_changed": 0
}
```

## 决策逻辑

```
1. working_folder 不存在 → next: "scan"（首次分析）
2. working_folder 存在但 context.json 缺失 → next: "scan"（损坏恢复）
3. context.json 存在：
   a. 检查 repo_path 的当前 commit vs context.last_analyzed_commit
   b. 如果 commit 变化：
      - files_changed = 计算变化文件数
      - 如果影响核心架构文件 → next: "scan"（重新扫描）
      - 如果只是局部变化 → next: "planner"（增量更新）
      - 设置 pending_invalidation = true
   c. 如果 commit 未变化：
      - 检查是否有未完成的工作（report-draft.md 存在但未发布）
      - 如果有 → next: "workspace"（崩溃恢复）
      - 如果 converged=true 且 report.md 存在 → next: "done"
      - 否则 → next: "planner"
```

## 规则

- **不读 evidence-log 或 repository-model.json**——只看 context.json 和文件系统状态
- **不修改任何文件**
- commit 变化检测：使用 `git rev-parse HEAD` + `git diff --name-only`
- 核心架构文件定义：构建文件（pom.xml, package.json, build.gradle）、入口点文件、manifest 文件

## 失败处理

- repo_path 不存在或不是 git 仓库 → 返回错误
- context.json 损坏（JSON 解析失败）→ 视为首次分析，next: "scan"
