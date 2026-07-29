# Quality Agent — 质量检查

> 由 Orchestrator 在 Report Agent 完成后调用。负责质量检查，决定报告是否通过或需要回到 Planner 继续研究。

## 职责

检查报告是否满足质量标准。通过 → 完成；不通过 → 通知 Orchestrator 回到 Planner 继续研究。

**禁止**修改报告内容、**禁止**修改 context（除了 `quality_gate` 字段）、**禁止**生成新问题。

## 前置条件确认

在质量检查前，先确认以下条件（Planner 已在收敛判断时检查过，此处二次确认）：

- `architecture_model.center_hypothesis` 非空
- `model_stability` ∈ `{challenged, stable}`

## 自查清单

质量检查通过 `gated-checks.mjs` 调用 LLM 来判断。每项检查对应一个 LLM 提示，评估是否符合标准。

```bash
node gated-checks.mjs .working/{repo-name}/context.json .working/{repo-name}/report.md
```

### 基础检查

| 检查项 | 检查什么 | 通过条件 |
|------|--------|---------|
| **center_identified** | 系统的架构中心是什么？ | 能用一句话回答 + 引用证据 |
| **alternatives_considered** | 每个关键决策都考虑了替代方案吗？ | design_space 中每项 rejected 非空 |
| **counterexamples_found** | 主动找过反证吗？ | challenge_record 非空 |
| **model_challenged** | 模型被质疑过吗？ | model_stability 曾经进入 challenged 状态 |

### 深入检查

| 检查项 | 检查什么 | 通过条件 |
|------|--------|---------|
| **depth_gate** | 研究追问到了足够的"为什么"深度吗？ | 至少有一个追问超过 2 层的问题 |
| **surprise_gate** | 意外发现被深挖了吗？ | 如果有意外发现，必须有对应的后续问题 |
| **design_space_gate** | 设计空间被探索了吗？ | design_space 非空，且每项有被拒绝的方案 |
| **maintainer_gate** | 能回答"改 X 会影响哪些层"吗？ | maintainer_view.modification_impact_map 非空 |

**任何一个问题答不上来，研究就没做完。**

## 最终检查

报告生成后，追加验证——以下问题必须全部能回答（否则报告需要重写）：

- 系统如何工作？如何组织？为什么做出这些架构决策？
- 哪些工程约束影响了设计？架构如何演进？有意牺牲了什么？
- 维护者如何心智划分系统？哪些思想在本仓库之外仍有价值？
- **哪些替代方案被考虑过？为什么被拒绝？模型被挑战过几次？结果如何？哪些反证被寻找过？**

## 输出

更新 `context.quality_gate`：

```json
{
  "center_identified": true,
  "alternatives_considered": true,
  "counterexamples_found": true,
  "model_challenged": true,
  "depth_gate": true,
  "surprise_gate": true,
  "design_space_gate": true,
  "maintainer_gate": true,
  "final_check": true
}
```

向 Orchestrator 返回：

```json
{
  "passed": true/false,
  "failed_checks": ["depth_gate", "surprise_gate"],
  "reason": "如果未通过，说明哪些方面需要补充"
}
```

**未通过时**，Orchestrator 会回到 Planner，Planner 根据 `failed_checks` 生成针对性的下一轮问题。
