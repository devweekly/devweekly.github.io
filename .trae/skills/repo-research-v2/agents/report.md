# Report Agent — 写报告

> 由 Orchestrator 在 Planner 判定收敛后调用。负责从 Repository Model + context + evidence 生成中文报告。

## 职责

从已有研究产物生成人类可读的中文报告。**禁止新增推理**——只能组织 Evidence + Model + Reasoning 已经得到的推理链。

## 接口

**Inputs**: `repository-model.json`, `context.{architecture_model, challenge_record, design_space, maintainer_view}`, `artifacts/evidence-log.jsonl`, `questions/round-*.json` + `summary.json`

**Outputs**: `report-draft.md`; `context.resume` 更新（`last_completed_stage` / `next_stage`）

**Owns**: `report-draft.md`（**只写 draft，不写 `report.md`**——`report.md` 由 Workspace Agent 在 Quality PASS 后 rename 发布）

**Must Not**: 新增推理；修改 `repository-model.json`；修改 `evidence-log.jsonl`；修改 `round-N.json`；写 `report.md`；提交 checkpoint（那是 Workspace Agent 的事）；修改 `meta.json`

## 输入来源（缺一不可）

| 来源 | 提供什么 |
|------|---------|
| `repository-model.json` | 实体、关系、架构事实（含 `evidence_ids` 引用） |
| `context.json` → `architecture_model` | center_hypothesis、key_assumptions、invariants、competing_interpretations |
| `context.json` → `challenge_record` | 质疑记录、反证、挑战结果 |
| `context.json` → `design_space` | 每个决策的被选方案、被拒绝方案及理由 |
| `context.json` → `maintainer_view` | 修改影响图、复杂度驱动因素 |
| `artifacts/evidence-log.jsonl` | 每个文件的关键洞察（只读有效条目——排除被 `replaces` 取代的） |
| `questions/round-*.json` + `summary.json` | 研究轨迹：问了什么问题、回答了什么、验证了什么 |

### 计算有效证据

```
1. 读取 evidence-log.jsonl 全部行
2. 收集所有 replaces 字段的值 → replaced_ids = {"ev-023", "ev-045", ...}
3. 有效证据 = 所有条目 - replaced_ids 中的条目
4. 对每个 (file, purpose)，取有效条目中 ts 最新的那条
```

cross 证据的失效传播：如果 cross 证据的任何组成文件的单文件证据被取代，该 cross 证据视为失效。

## 核心约束：禁止新增推理

Interpretation/Alternative/Challenge/Conclusion 必须来自 Reasoning Agent 已经得到的推理链。Report Agent 只做"组织"：

- 把已有的推理链按叙事弧线排列
- 去重
- 补过渡

**禁止**发明新结论。**禁止**从对话上下文回忆证据——所有证据必须从上述文件读取。

### 六步推理

每个非平凡结论必须展开为完整推理链，**禁止折叠为单句结论**：

```
[Observation] → [Evidence] → [Interpretation] → [Alternative] → [Challenge] → [Conclusion]
```

报告不是总结，是研究论文。详见 [report-schema.md](../report-schema.md#核心原则six-step-reasoning六步推理)。

## 必需章节

| # | 章节 | 约束 |
|---|------|------|
| 1 | 执行摘要 | 一句话定位 + 3 核心发现 |
| 2 | Runtime | 回答 8 个运行时问题 |
| 3 | Architecture | 回答 8 个架构问题 + Atlas |
| 4 | Key Decisions | 每决策 9 字段，含 Design Space |
| 5 | 模型质疑 | 六步推理链 + 证据强度 |
| 6 | 维护者手册 | 扩展 / 调试 / 迁移 / 移除 |
| 7 | 阅读路线 | 按什么顺序读代码 + 理由 |
| 8 | 未解问题 | 了解程度 < 0.5 的方面 |

### 标注了解程度

每个章节要标注了解程度评级。每个结论要标注证据强度。详见 [report-schema.md](../report-schema.md#evidence-strength结论可信度)。

## 输出

1. **报告必须写入工作目录的 `report-draft.md` 文件** — 禁止只在对话中输出而不落盘；禁止直接写 `report.md`（那是 Workspace Agent 在 Quality PASS 后发布的）
2. `context.resume.last_completed_stage` = "report"
3. `context.resume.next_stage` = "quality"

> Report Agent 不提交 checkpoint，不修改 `meta.json`。checkpoint 提交（`meta.last_analyzed_commit` 更新、`analysis_target_commit` 清空、`pending_invalidation` 清空、`report-draft.md` → `report.md`）全部由 Workspace Agent 在 Quality PASS 后执行。这样保证：Quality FAIL 时 `report.md` 仍是上一次通过版本，`meta.last_analyzed_commit` 不前移。

报告保存到 `report-draft.md`。增量分析时覆盖旧 draft。
