---
name: "repo-research-v2"
description: "把仓库编译成架构知识库（Repository Model），并从中生成报告。当用户要求研究/分析某个仓库的架构、设计模式或工程实现时调用。"
---

# Repository 研究

> 相关文档：[methodology.md](./methodology.md)（研究方法论） | [workspace.md](./workspace.md)（工作目录 + 文件所有权 + 缓存策略） | [question-framework.md](./question-framework.md)（问题生成与管理） | [report-schema.md](./report-schema.md)（Repository Model + 报告规范）

## 目标

构建可复用的架构知识库（Repository Model）。Repository Model 捕获实体、关系及支撑证据。报告是 Repository Model 的视图。

## 架构：Orchestrator + 9 Sub Agents

SKILL 是 Orchestrator，**只负责调度，不写任何状态文件**。每个 Agent 自己知道自己的输入/输出/规则，SKILL 不知道实现细节。状态文件的持久化全部经过 Workspace Agent。

```mermaid
flowchart TD
    Start[Start] --> Resume[Resume<br>返回 next]
    Resume -->|next=scan| Scan[Scan<br>扫描仓库]
    Resume -->|next=planner| Planner
    Resume -->|next=report| Report
    Resume -->|next=done| Done[Done]
    Scan --> Planner[Planner<br>下一步去哪?]
    Planner -->|converged| Report[Report<br>写 report-draft.md]
    Planner -->|not converged| WS1[Workspace<br>新建轮次条目]
    WS1 --> Evidence[Evidence<br>收集证据]
    Evidence --> Model[Model<br>更新 Repository Model]
    Model --> Reasoning[Reasoning<br>解释+质疑+coverage]
    Reasoning --> WS2[Workspace<br>写 round_stats]
    WS2 --> Planner
    Report --> Quality[Quality<br>检查 draft]
    Quality -->|FAIL| Planner
    Quality -->|PASS| WS3[Workspace<br>发布报告 + checkpoint]
    WS3 --> Done
```

## Orchestrator 调度步骤

```
1. call resume              → 返回 {next: "scan"|"planner"|"report"|"workspace"|"done"}
2. switch next:
     scan     → call scan, then goto 3
     planner  → goto 3
     report   → goto 4
     workspace → goto 7（崩溃恢复：Quality PASS 但 checkpoint+publish 未完成）
     done     → end
3. loop:
     a. call planner          → 返回 {converged, next_focus}（Planner 不写状态文件）
     b. if converged: break
     c. call workspace        → 把 planner 返回值落到 summary.json + context.current_round（新建轮次条目）
     d. call evidence         → 读文件，写 evidence-log（append-only）
     e. call model            → 从 evidence 合并/更新 repository-model.json（Model 是唯一写入者）
     f. call reasoning        → 架构解释 + 质疑 + 更新 coverage/design_space/maintainer_view，返回 round_stats
     g. call workspace        → 把 reasoning 返回的 round_stats 落到 summary.json 当前轮次条目
     goto a
4. call report              → 从 Model + evidence 生成 report-draft.md
5. call quality             → 检查 report-draft.md，返回 PASS/FAIL/reason（不修改 draft）
6. if FAIL: goto 3 (Planner 根据 failed_checks 生成针对性问题；report-draft.md 保留供下一轮覆盖)
7. if PASS:
     a. call workspace        → rename report-draft.md → report.md + 提交 checkpoint
       (meta.last_analyzed_commit = meta.analysis_target_commit; 清空 analysis_target_commit 和 pending_invalidation)
     b. end
```

### Orchestrator 不写任何状态文件

Planner 只返回决策，**不写状态文件**。Orchestrator 也**不直接写状态文件**——所有状态持久化由 Workspace Agent 执行：

- 收到 `{converged: false, round_file: "round-3.json"}` → Orchestrator 调用 Workspace，Workspace 更新 `context.current_round` 和 `questions/summary.json`
- 收到 `{converged: true}` → Orchestrator 进入 Report 阶段
- 收到 Quality `{passed: true}` → Orchestrator 调用 Workspace，Workspace 发布报告 + 提交 checkpoint

## Agent 清单

| Agent | 文件 | 一句话职责 |
|-------|------|-----------|
| Resume | [agents/resume.md](./agents/resume.md) | 恢复现场，判断代码变化，返回下一步跳转目标 |
| Scan | [agents/scan.md](./agents/scan.md) | 扫描仓库，生成可复用的 artifacts/*.json |
| Planner | [agents/planner.md](./agents/planner.md) | **只回答"下一步去哪？"**——判断收敛 + 生成下一轮问题 |
| Workspace | [agents/workspace.md](./agents/workspace.md) | **状态持久化**——把各 Agent 决策落到磁盘，Orchestrator 不写文件 |
| Evidence | [agents/evidence.md](./agents/evidence.md) | 读文件 + 写 evidence-log.jsonl（**不碰 Model**） |
| Model | [agents/model.md](./agents/model.md) | **repository-model.json 唯一写入者**——从 evidence 合并/更新 Model |
| Reasoning | [agents/reasoning.md](./agents/reasoning.md) | 架构解释 + 质疑模型 + 更新 coverage/design_space/maintainer_view |
| Report | [agents/report.md](./agents/report.md) | 从 Model + evidence 生成 `report-draft.md`（禁止新增推理） |
| Quality | [agents/quality.md](./agents/quality.md) | 检查 `report-draft.md`，返回 PASS/FAIL/reason（**不修改 draft**） |

> 工作目录结构、文件所有权矩阵、产物缓存策略详见 [workspace.md](./workspace.md)。SKILL 不重复这些实现细节。

## 成功标准

一份成功的研究应该让有经验的工程师能回答：

- 能用一句话说出系统的**架构中心**，且能回答"如果把这个中心去掉，系统还能跑吗？"
- 每个关键决策都能说出**至少一个被拒绝的替代方案**
- 报告的结论不是从源码"看"出来的，而是通过**提问 → 收集证据 → 质疑 → 修正**循环产生的
- 能回答"改 X 会炸哪里"（Blast Radius）和"哪些改动容易、哪些危险"（Change Difficulty）
- 能回答"系统为何演变成今天这样"（架构演进时间线）

### Neutrality 原则（最高优先级）

**研究是 evidence-based，禁止替 maintainer 做价值判断。**

- **禁止绝对化结论**：不用 "不可能"、"永远"（用于结论）、"deliberate trade-off"（作为结论）
- **证据范围约束**：证据只能推出其支持范围内的结论（无 TODO ≠ 永久决策）
- **术语 Neutral 化**：禁止拟人化比喻（心脏/大脑/神经），使用 neutral 术语
- **Evidence/Inference/Confidence 分离**：核心结论显式分离代码事实与研究推断
- **Coverage 可计算化**：X/Y = Z%，非主观分数

### 从 "描述系统" 到 "预测系统"

报告不仅描述系统如何工作，还要**预测系统行为**：

- **Blast Radius**：改这里会影响哪些子系统/invariant
- **Change Difficulty**：哪些改动容易（data-driven）、哪些危险（多 invariant 依赖）
- **Evolution Timeline**：系统为何演变成今天（git history 或代码注释推断）
