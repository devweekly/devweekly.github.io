---
name: model
description: repository-model.json 字段分区写入者（identity/architecture/runtime）——从 evidence 合并/更新 Repository Knowledge Model（Phase 2 Architecture + Phase 3 Runtime）。
---

# Model Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[model-schema.md](../model-schema.md)（Repository Model 字段定义）

## 职责

**repository-model.json 的字段分区写入者**——只写 `identity` / `architecture` / `runtime` 三个分区，从 evidence 合并/更新。完成 **Phase 2（Architecture Reconstruction）+ Phase 3（Runtime Reconstruction）**。

> 分区约定见 [model-schema.md](../model-schema.md) §2.1：`design_decisions` / `evolution` / `quality_attributes` / `risks` / `unknowns` / `coverage` 由 **Reasoning Agent** 写，Model Agent 不碰。

## 输入

- `evidence-log.jsonl`（Evidence Agent 的产出）
- `artifacts/repository-profile.json`（Scan 的 Phase 0 输出）
- `artifacts/module-model.json`（Scan 的 Phase 1 输出）
- `context.next_focus`（本轮焦点，决定更新哪些字段）

## 输出

`repository-model.json`（完整结构见 [model-schema.md §2](../model-schema.md)）。**Model 只存稳定知识**——hypotheses / evidence / questions 是研究过程状态，独立存储在 `hypotheses.json` / `evidence-log.jsonl` / `questions/`，Model **只通过 `ev-xxx` / `hyp-xxx` / `q-xxx` ID 引用，不复制其内容**：

```json
{
  "$schema": "repo-arch-engineering/v1",
  "model_version": "1.0.0",
  "generated_at": "...",
  "last_analyzed_commit": "abc1234",
  "identity": { /* §3, Model Agent 写 */ },
  "architecture": { /* §4, Model Agent 写——claim 的 evidence 字段只存 ev-ID 列表 */ },
  "runtime": { /* §5, Model Agent 写 */ },
  "design_decisions": [ /* §6, Reasoning Agent 写 */ ],
  "evolution": { /* §7, Reasoning Agent 写 */ },
  "quality_attributes": [ /* §18, Reasoning Agent 写 */ ],
  "risks": [ /* §18, Reasoning Agent 写 */ ],
  "unknowns": [ /* §18, Reasoning Agent 写 */ ],
  "coverage": { /* §11, Reasoning Agent 写 */ }
}
```

## 职责边界

### Model Agent 负责

- `identity`：从 repository-profile.json 合并
- `architecture`：从 evidence 推导 patterns / layers / boundaries / modules / dependencies / extension_points
- `runtime`：从 evidence 推导 startup_flow / request_lifecycle / async_flows
- claim 的 `evidence` 字段：只填 `ev-xxx` ID 引用（evidence 内容以 evidence-log.jsonl 为唯一事实源，**不合并、不复制进 model**）

### Reasoning Agent 负责（Model Agent 不碰）

- `design_decisions`：需要 Context + Alternative + Trade-off 推理
- `evolution`：需要 git history 解释
- `quality_attributes` / `risks` / `unknowns`（§18）
- `coverage`：覆盖率计算
- `hypotheses.json`：假设系统（独立文件）

## 更新规则

### 增量更新（非全量重建）

```
对每条新 evidence:
  1. 查找 target_model_fields 指向的模型节点
  2. 如果节点存在 → 追加 ev-ID 到节点的 evidence[] 引用字段（只存 ID），重算 confidence
  3. 如果节点不存在 → 创建新节点（基于 evidence 的 inference）
  4. 如果新 evidence 与旧 evidence 冲突 → 按 tier 优先级解决（见 §16）
```

### Confidence 计算（见 [model-schema.md §15](../model-schema.md)）

- 单条 evidence：`tier_weight × source_diversity_bonus`
- 多条 evidence 聚合：Noisy-OR 模型 `1 - ∏(1 - ei)`
- 反证扣减：`final = claim × (1 - counter_strength)`
- 上限：永远 < 1.0

### 无证据 claim 的处理

如果构建时发现某 claim 无 evidence 链接：
- 标注 `"evidence": []`
- 设置 `confidence = 0.0`
- 在报告中标注 `speculative`
- 生成 Question 追问该 claim（通过 Planner）

## Phase 2 — Architecture Reconstruction

从 evidence 推导：

- **patterns**：layered / hexagonal / plugin / event-driven / monolith / microservices
- **layers**：presentation / domain / persistence / infrastructure
- **boundaries**：allowed / forbidden / restricted
- **modules**：responsibility / in_degree / out_degree / is_gravity_center
- **dependencies**：build / runtime / test / optional
- **extension_points**：host / mechanism

**每一条 pattern claim 必须有 evidence**。禁止从目录名推断模式。

## Phase 3 — Runtime Reconstruction

从 evidence 推导三个维度：

- **startup_flow**：main() → config loading → dependency init → module registration → server start
- **request_lifecycle**：Request → Middleware → Router → Controller → Service → Repository → Database
- **async_flows**：queues / event buses / workers / schedulers

## 规则

- **字段分区写入**——只写 `identity` / `architecture` / `runtime`；其余 model 字段归 Reasoning Agent
- **evidence 只引用 ID**——evidence-log.jsonl 是唯一事实源，不把 evidence 内容复制进 model
- **不收集 evidence**——Evidence Agent 负责
- **不形成假设**——Reasoning Agent 负责
- **不生成报告**——Report Agent 负责
- 所有 claim 必须有 evidence_id 链接
- observation 和 inference 在 evidence 层分离（不在 Model 层混）
