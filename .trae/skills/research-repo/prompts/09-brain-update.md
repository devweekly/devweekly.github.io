<!-- Target output: brain-update-report.md -->

# Brain 更新 — {repoName}

你是一位知识库管理员。请审核 `knowledge-units.json` 中的提取结果，与全局 Research Brain 的已有知识进行比对，产出更新计划。

**核心理念**：Brain 更新不是简单的"添加"。每个新观察都应该**增强**已有知识或**贡献**新知识。错误的更新（重复、低质量）会污染整个知识库。

必读输入：
- `knowledge-units.json`（Stage 8 提取的知识单元）
- `brain-brief.json`（Brain 已有知识的摘要）
- `brain/index.json`（Brain 完整索引——可选，用于精确比对）

## 你的任务

对 `knowledge-units.json` 中的每个 Knowledge Unit，判断：

### 情况 1：Brain 已知（id 匹配或标题相似度 > 0.5）

→ **不需要创建新单元**。只需将该仓库添加为已有单元的新观察证据。

报告格式：
```markdown
### [MERGE] pattern.planner-executor
- **已有单元**: brain/patterns/pattern.planner-executor.json
- **当前证据**: openai-agents, langgraph, autogen
- **新增证据**: {repoName}
- **置信度变化**: 0.85 → 0.87（+0.02，diminishing returns）
- **新增 Tradeoff**: "+ {repoName} 的实现使用了 streaming cancellation"
- **判断**: MERGE — 已有单元的描述更完整，保持不变；仅添加 {repoName} 到 evidence
```

### 情况 2：Brain 未知（新知识）

→ **创建新单元**。但需要验证其抽象性。

报告格式：
```markdown
### [CREATE] decision.runner-centric
- **判断**: CREATE — Brain 中没有类似决策
- **相似度检查**: 最相似的是 pattern.planner-executor（score=0.3），不构成重复
- **抽象性验证**: 该决策在 3+ 个 Agent 框架中观察到（OpenAI Agents / Claude Code / LangGraph），可迁移
- **新建路径**: brain/decisions/decision.runner-centric.json
```

### 情况 3：质量不足（过于具体或无迁移价值）

→ **REJECT**。不添加到 Brain。

报告格式：
```markdown
### [REJECT] pattern.{something-too-specific}
- **判断**: REJECT — 仅适用于 {repoName}，无迁移价值
- **原因**: 该模式是 {repoName} 特定的临时方案，不是可复用的架构模式
```

## 输出格式

写入 `brain-update-report.md`：

```markdown
# Brain Update Report — {repoName}

## Summary
- 提取的 Knowledge Units: N
- CREATE: X
- MERGE: Y
- REJECT: Z

## Statistics
- Brain 更新前总单元数: {before}
- Brain 更新后总单元数: {after}
- 新增 Concept Graph 边: M

## Details

### CREATE

#### [CREATE] {unit-id}
...

### MERGE

#### [MERGE] {unit-id}
...

### REJECT

#### [REJECT] {unit-id}
...

## Concept Graph Updates

| Source | Relation | Target | Action |
|--------|----------|--------|--------|
| pattern.planner-executor | observed_in | {repoName} | NEW |
| concept.plan | executed_by | concept.runner | EXISTING |
```

## 更新规则

1. **保守优先**：宁可少添加，不要污染知识库。REJECT 永远比 CREATE 安全。
2. **抽象性门槛**：一个 Pattern 必须能在至少 2 个项目中出现才算可复用。如果只在 {repoName} 中观察到，置信度不超过 0.5，且必须标注 `tags: ["needs-validation"]`。
3. **MERGE 不覆盖**：合并时，已有单元的 description 保持不变（除非新描述明显更完整）。只添加 evidence 和 tradeoffs。
4. **Confidence 演进**：
   - CREATE: 初始 0.5-0.6（单一证据源）
   - MERGE: `new_confidence = old_confidence + increment * (1 - old_confidence)`（diminishing returns）
   - 不要手动设置高置信度——置信度通过多仓库观察自然增长
5. **Concept Graph 去重**：如果 `{source, relation, target}` 已存在，只需在 evidence 中添加 `{repoName}`。
6. **Anti-pattern 验证**：必须有至少 1 个失败案例才能创建。如果只有理论推测，REJECT。

## 自检

在输出前自问：
- 我 REJECT 了足够多的低质量单元吗？（如果全部 CREATE，可能门槛太低）
- 我 MERGE 的单元真的匹配吗？（标题相似 ≠ 概念相同）
- Concept Graph 的边是否基于报告中的真实证据？（不要凭空构建关系）
