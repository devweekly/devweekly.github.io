# Report Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[model-schema.md](../model-schema.md)

## 职责

从 `Repository Model + Evidence Model + Hypothesis Model` 生成 `report-draft.md`。**禁止新增推理**——报告是 Model 的视图，不是新的研究。

## 输入

- `repository-model.json`（含 identity / architecture / runtime / design_decisions / evolution）
- `hypotheses.json`（含 confirmed / rejected / uncertain 假设）
- `evidence-log.jsonl`（用于 evidence 引用）
- `context.coverage`（用于标注覆盖不足的维度）

## 输出

`report-draft.md`（报告草稿，不直接发布，由 Workspace Agent 在 Quality PASS 后 rename 为 report.md）

## 报告结构

```
1. Executive Summary
2. System Identity
3. Architecture Overview
4. Runtime Behavior
5. Key Design Decisions
6. Evolution History
7. Testing Strategy
8. Deployment Model
9. Architectural Risks
10. Open Questions
```

## 渲染规则

### 1. 从 Model 渲染，不从 evidence 推导

- **禁止**：直接从 evidence-log 推导架构结论
- **正确**：从 repository-model.json 的字段渲染

### 2. 每条 claim 标注 evidence 和 confidence

```markdown
### 架构模式：Plugin Architecture

系统采用插件架构。Confidence: 0.86

Evidence:
- PluginManager 动态加载扩展 [ev-007]
- ExtensionRegistry 维护 providers [ev-012]
- 模块暴露 extension points [ev-015]
```

### 3. 标注 speculative claim

如果某 claim 的 `evidence: []` 或 `confidence < 0.3`：

```markdown
### 待验证：微服务拆分意图

> ⚠️ Speculative（无 evidence 支撑）

系统可能计划向微服务演进...
```

### 4. 标注覆盖不足

如果某维度 `coverage.ratio < 0.5`：

```markdown
## 7. Testing Strategy

> ⚠️ 覆盖不足（0/1 = 0%）

本维度证据不足，无法给出可靠结论。
```

### 5. 呈现假设状态

```markdown
### 假设：OSGi 运行时隔离

- Status: Confirmed
- Confidence: 0.85
- Supporting: [ev-007, ev-012]
- Counter: 无
- Falsification criteria: 如果假设错，我们会看到 plugin 直接编译时绑定
```

## Neutrality 原则

- **禁止绝对化结论**：不用"不可能"、"永远"、"deliberate trade-off"（作为结论）
- **证据范围约束**：证据只能推出其支持范围内的结论
- **术语 Neutral 化**：禁止拟人化比喻（心脏/大脑/神经）
- **Evidence/Inference/Confidence 分离**：核心结论显式分离代码事实与研究推断

## 从"描述系统"到"预测系统"

报告不仅描述系统如何工作，还要**预测系统行为**：

- **Blast Radius**：改这里会影响哪些子系统/invariant
- **Change Difficulty**：哪些改动容易（data-driven）、哪些危险（多 invariant 依赖）
- **Evolution Timeline**：系统为何演变成今天

## 规则

- **禁止新增推理**——报告是 Model 的视图
- **禁止直接读 evidence-log 推导架构结论**——必须通过 Model
- **不修改 repository-model.json**
- **不修改 hypotheses.json**
- 如果 Model 不完整（如 design_decisions 为空），在报告中标注"证据不足"，不编造
- 输出 `report-draft.md`，不直接发布
