<!-- Target output: knowledge-units.json -->

# 知识提取 — {repoName}

你是一位工程知识架构师。请从已完成的研究报告中**提取可复用的工程知识**，写入 `knowledge-units.json`。

**核心理念**：Repository 只是 Evidence，Knowledge 才是真正产品。这次研究的价值不只在于 `report.md`，更在于它为全局 Research Brain 贡献了哪些可迁移的抽象。

必读输入：
- `report.md`（最终报告——包含 Engineering Decisions、Reusable Pattern Catalog、What NOT to Learn 等章节）
- `evidence-brief.md`（证据摘要）
- `brain-brief.json`（**Brain 已知的知识**——避免重复提取已有模式）

## 提取什么

从报告中提取以下五类知识单元（Knowledge Unit）。每个单元必须是**抽象**，不是代码细节。

### 1. Pattern（架构模式）

可复用的架构模式，例如：
- Planner-Executor Separation
- Event Bus
- Plugin Registry
- Workflow Engine
- Actor Model
- Checkpoint / Snapshot
- Context Compression

**不要提取**仅在 {repoName} 中出现、无法迁移的实现细节。

### 2. Decision（工程决策）

为什么选择某种设计？适用条件是什么？例如：
- "Why Runner-centric"（OpenAI Agents）
- "Why Stateless Tool"（MCP）
- "Why Push-based Execution"（DuckDB）

### 3. Tradeoff（权衡）

每种设计的收益、成本和适用边界。例如：
- "Single Runner: Pros=简单 / Cons=扩展困难 / Boundary=单进程场景"
- "Vectorized Execution: Pros=高吞吐 / Cons=实现复杂 / Boundary=OLAP"

### 4. Anti-pattern（反模式）

常见设计问题及失败案例。例如：
- Prompt Spaghetti（Old AutoGPT）
- God Context（上下文无限膨胀）
- Tool Recursion（工具递归调用无终止）

### 5. Term（工程术语）

统一术语定义。例如：
- Planner / Executor / Harness / Guardrail / Checkpoint / Observation / Resolution

## 输出格式

写入 `knowledge-units.json`：

```json
{
  "repoName": "{repoName}",
  "units": [
    {
      "id": "pattern.planner-executor",
      "type": "pattern",
      "title": "Planner Executor Separation",
      "description": "Planning and execution are isolated into separate components. Planner produces a plan; Executor executes it without re-planning.",
      "evidence": ["{repoName}"],
      "confidence": 0.6,
      "tradeoffs": ["+ 清晰的关注点分离", "+ Planner 可独立测试", "- 需要额外的协调层"],
      "counterExamples": [],
      "tags": ["architecture", "agent-harness"],
      "sourceSection": "Engineering Decisions D-001"
    },
    {
      "id": "decision.runner-centric",
      "type": "decision",
      "title": "Runner as Central Orchestrator",
      "description": "Runner 是 Agent 执行的核心入口，统一管理 lifecycle、streaming、cancellation。",
      "evidence": ["{repoName}"],
      "confidence": 0.7,
      "conditions": ["适用于需要统一 lifecycle 管理的 Agent 框架"],
      "alternatives": ["Event-driven orchestration", "State machine"],
      "tags": ["architecture", "orchestration"],
      "sourceSection": "Engineering Decisions D-002"
    }
  ],
  "conceptEdges": [
    {
      "source": "pattern.planner-executor",
      "relation": "produces",
      "target": "concept.plan",
      "evidence": ["{repoName}"]
    },
    {
      "source": "concept.plan",
      "relation": "executed_by",
      "target": "concept.runner",
      "evidence": ["{repoName}"]
    },
    {
      "source": "concept.runner",
      "relation": "calls",
      "target": "concept.tool",
      "evidence": ["{repoName}"]
    }
  ]
}
```

## 提取规则

1. **抽象优先**：提取 `Planner-Executor Separation`，不是 `runner.py:L203`。代码路径只作为 `sourceSection` 引用。
2. **Brain 已知的不再提取**：如果 `brain-brief.json` 已包含 `pattern.planner-executor`（observedIn 含 3+ repos），不要重复提取——它的置信度已经足够高。只需在 `conceptEdges` 中添加 `{repoName}` 作为新的观察证据。
3. **置信度初始值**：
   - 单一证据源 → 0.5-0.6
   - 报告中有明确源码引用 + 测试验证 → 0.7-0.8
   - 多个 Finding 一致支持 → 0.8-0.9
4. **Tradeoff 必须双向**：每个 Tradeoff 必须包含 Pros 和 Cons，不能只有优点。
5. **Anti-pattern 必须有反例**：必须说明在哪些项目中失败过，否则不算 anti-pattern。
6. **Concept Graph**：提取 Pattern/Decision 之间的关系，使用以下关系动词：
   - `produces` / `executed_by` / `calls` / `returns` / `updates`
   - `alternative_to` / `requires` / `conflicts_with`
   - `observed_in` / `contradicts`
7. **数量**：质量优先于数量。提取 5-15 个最有价值的 Knowledge Unit 即可，不要为了凑数提取琐碎事实。

## 自检

在输出前，对每个 Knowledge Unit 自问：
- 这个模式在其他项目中也会出现吗？（如果不，它不是 pattern）
- 这个决策的 Why 是否清晰？（如果不，它不是 decision）
- 这个权衡是否双向？（如果只有 Pros，它不是 tradeoff）
- Brain 是否已经知道这个？（如果是，只在 conceptEdges 添加证据）
