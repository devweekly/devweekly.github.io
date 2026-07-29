# Resume Agent — 恢复现场

> Orchestrator 调度的第一个 Agent。负责恢复上次研究状态，判断代码是否变化，确定下一步跳转到哪个 Agent。

## 职责

加载工作目录中的已有状态，判断代码变化，输出下一步跳转目标。**禁止**做任何扫描、分析或推理。

## 接口

**Inputs**: `context.json`, `meta.json`, `artifacts/evidence-log.jsonl`, `repository-model.json`, `questions/summary.json`

**Outputs**: `{next: "scan"|"planner"|"report"|"workspace"|"done", need_scan: bool, resume_context: {...}}` — 直接返回下一步 Agent，Orchestrator 不做任何判断

**Owns**: `context.resume`

**Must Not**: 扫描/分析/推理；修改 `round-N.json`；代码没变时触发 Scan

## 执行流程

### 1. 加载已有状态

按顺序加载工作目录中的文件：

1. **`context.json`** — 恢复研究状态（当前轮次、模型稳定程度、已收集证据计数、resume 位置）
2. **`artifacts/evidence-log.jsonl`** — 恢复已收集的所有证据洞察（这是研究的"实验室笔记"，Report Agent 从这里取证据）
3. **`repository-model.json`** — 恢复 Repository Model
4. **`meta.json`** — 恢复元信息（仓库路径、仓库类型、上次分析的提交）
5. **`questions/summary.json`** — 恢复问题进度（问题数量、已回答、已验证）
6. **按需加载 `round-N.json`** — 作为只读历史引用，禁止修改

### 2. 判断代码是否变了

- `git rev-parse HEAD` 与 `meta.last_analyzed_commit` 比较
- 非 Git 仓库 → 始终视为"已变化"

| 代码变了没有 | 怎么做 |
|------------|------|
| 没变 | 不做扫描、不重新识别类型、不重新统计目录 |
| 变了 | 标记需要 Scan Agent 扫描，Scan Agent 会用 `git diff` 找出改了什么 |

### 3. 恢复到上次执行位置

读取 `context.resume`，看上次执行到哪里了：

```json
{
  "last_completed_stage": "reasoning",
  "next_stage": "planner",
  "last_round": 2
}
```

- 直接跳到 `next_stage` 对应的 Agent
- 禁止重复执行已经做完且仍然有效的阶段

### 4. 输出

向 Orchestrator 返回：

```
{
  "next": "scan" | "planner" | "report" | "workspace" | "done",   // 直接返回下一步 Agent
  "need_scan": true/false,                           // 代码是否变了（供 Scan 参考）
  "resume_context": { ... }                          // 恢复的上下文摘要
}
```

Orchestrator 不做任何判断，直接调用 `next` 指定的 Agent。SKILL 不需要 "Need Scan?" 分支判断——Resume 已经把所有条件判断内化了。

> `next: "workspace"` 仅在 Quality PASS 后崩溃恢复时出现——`context.resume.next_stage == "workspace"` 说明 checkpoint+publish 未完成，Resume 直接跳回 Workspace 完成。

## 强制规则

- 如果上次已经写完了报告（`resume.next_stage == "done"`），而且代码没变 → 返回 `{next: "done"}`
- 如果上次至少完成了一轮完整研究 → 进入 Planner，由 Planner 判断收敛与否
- **禁止**在代码没变时触发 Scan Agent
- **禁止**修改已有的 `questions/round-N.json`
- **禁止**做任何扫描、分析或推理——只加载和判断

## context.json 结构参考

Resume Agent 需要理解 context.json 的结构才能正确恢复：

```json
{
  "user_input": "用户原始输入，保持不变",
  "resume": {
    "last_completed_stage": "reasoning",
    "next_stage": "planner",
    "last_round": 2
  },
  "current_round": 2,
  "current_question_file": "questions/round-2.json",
  "model_stability": "formative",
  "coverage": {
    "runtime": 0.95,
    "architecture": 0.82,
    "design_decisions": 0.64,
    "testing": 0.51,
    "deployment": 0.31,
    "history": 0.21
  },
  "pending_invalidation": null
}
```

### model_stability 状态

| 状态 | 含义 |
|------|------|
| `nascent` | 刚建好模型，还没验证过 |
| `formative` | 模型还在修正中 |
| `challenged` | 模型被质疑过，有别的解释 |
| `stable` | 质疑没推翻，模型收敛了 |

### 代码变化时的 pending_invalidation

如果 `context.pending_invalidation` 非空，说明 Scan Agent 检测到了代码变化但 Evidence/Model/Reasoning 还没处理。Resume Agent 应将此信息传递给 Orchestrator，由 Orchestrator 确保 Evidence → Model → Reasoning 链处理状态回退。

```json
{
  "pending_invalidation": {
    "changed_files": ["server/gateway.ts", "convex/schema.ts"],
    "target_commit": "abc123"
  }
}
```
