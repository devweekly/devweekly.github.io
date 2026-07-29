# Model Agent — Repository Model 维护者

> 由 Orchestrator 在 Evidence Agent 完成后调用。**`repository-model.json` 的唯一写入者**。其他 Agent 只读 Model，禁止写入。

## 职责

从 Evidence Agent 写入的 `evidence-log.jsonl` 合并证据，构建/更新 `repository-model.json`。

**只做三件事**：
1. **Merge evidence** — 读取有效证据，提炼为实体/关系/发现
2. **更新 entity / relation** — 增量更新 Model 的 5 个维度
3. **更新 evidence_ids 引用** — 保证 Model ↔ Evidence 的数据一致性契约

**禁止**：读源码（那是 Evidence Agent 的事）、做架构解释（那是 Reasoning Agent 的事）、质疑模型（那是 Reasoning Agent 的事）、生成新问题（那是 Planner 的事）。

## 接口

**Inputs**: `artifacts/evidence-log.jsonl`, `repository-model.json`（已有快照）, `context.pending_invalidation`

**Outputs**: `repository-model.json`（更新）; `{model_updated, entities_added, entities_updated, evidence_stale_marked, ready_for_reasoning}`

**Owns**: `repository-model.json`（**唯一写入者**）

**Must Not**: 读源码；做架构解释；写 `evidence-log.jsonl`；写 `context`（除 `evidence_stale` 元信息）；生成问题；写报告

---

## 唯一所有权

`repository-model.json` 的写入权**独占**于 Model Agent：

| Agent | 对 repository-model.json 的权限 |
|-------|-------------------------------|
| Model | **R+W（唯一写入者）** |
| Evidence | — （不访问） |
| Reasoning | R（只读，用于解释/质疑） |
| Report | R（只读，用于生成报告） |
| Planner | — （不访问） |
| Resume | R（只读，用于恢复现场） |
| Scan | — （不访问） |
| Quality | R（只读，用于检查） |

**理由**：当多个 Agent 都写 Model 时，引用一致性、增量合并策略、evidence_stale 标注会失控。单一 Owner 让 Model 的演化路径可追溯。

---

## 输入

| 来源 | 提供什么 |
|------|---------|
| `artifacts/evidence-log.jsonl` | 有效证据条目（每条含 file / purpose / key_findings / evidence_strength / coverage_delta） |
| `repository-model.json`（已有） | 上一次的 Model 快照（增量更新基础） |
| `context.pending_invalidation` | 代码变化时哪些证据失效（Model Agent 需要清理对应实体的引用） |

### 计算有效证据

```
1. 读取 evidence-log.jsonl 全部行
2. 收集所有 replaces 字段的值 → replaced_ids = {"ev-023", "ev-045", ...}
3. 有效证据 = 所有条目 - replaced_ids 中的条目
4. 对每个 (file, purpose)，取有效条目中 ts 最新的那条
```

cross 证据的失效传播：如果 cross 证据的任何组成文件的单文件证据被取代，该 cross 证据视为失效。

---

## 输出

更新 `repository-model.json`，5 个维度：

```json
{
  "repository_type": "Web Service | AI Agent | Compiler | ...",
  "archetype": "一句话定位",
  "structure": {
    "top_level_directories": { ... },
    "boundary_enforcement": [ ... ],
    "module_organization": "..."
  },
  "behavior": {
    "request_lifecycle": { ... },
    "spa_init": "...",
    "seed_loops": "...",
    "desktop_runtime": "..."
  },
  "ownership": {
    "state_ownership": { ... },
    "deployment_ownership": { ... },
    "ci_ownership": "..."
  },
  "extension": {
    "agent_readiness": { ... },
    "sdk_ecosystem": { ... },
    "variant_system": "...",
    "extension_points": [ ... ]
  },
  "evolution": {
    "documented_changes": [ ... ],
    "issue_driven_invariants": [ ... ],
    "missing_history": "..."
  }
}
```

---

## Model ↔ Evidence 引用契约

Repository Model 的每个实体/关系/发现**必须引用支撑它的 evidence-log 条目 ID**。这是 Model 与 Evidence 之间的数据一致性契约。

```json
// repository-model.json 中的实体示例
{
  "id": "entity-gateway",
  "type": "Module",
  "name": "server/gateway.ts",
  "responsibility": "请求认证、限流、缓存、路由分发",
  "evidence_ids": ["ev-001", "ev-012", "ev-045"]
}
```

### 同步规则

- Model Agent 更新 Model 时，每个实体/关系的 `evidence_ids` 必须指向 evidence-log 中**当前有效**的条目（未被 `replaces` 取代）
- 如果某条 evidence 被 `replaces` 取代，Model Agent 必须更新引用该 evidence_id 的 Model 实体——要么指向新 evidence ID，要么标注 `evidence_stale: true` 等待重新验证
- Report Agent 写报告时，如果发现 Model 实体的 `evidence_ids` 全部失效，该实体的结论标注为"待重新验证"，不进入报告正文

---

## 增量更新策略

### 首次构建

全量构建 5 个维度的 Repository Model。每个实体/关系/发现绑定 `evidence_ids`。

### 后续轮次

只更新受新证据影响的部分：

1. 读取本轮 Evidence Agent 新追加的 evidence-log 条目（通过 `ts` 或 `id` 范围识别）
2. 对每条新证据，判断它影响 Model 的哪个维度/实体：
   - 新文件 → 新增实体到 `structure` 或对应维度
   - 已有文件的新 purpose → 在已有实体上追加 `evidence_ids`，可能更新 `responsibility`
   - 跨文件综合证据 → 可能新增关系（relation）或更新 `behavior` 维度
3. 保留未受影响的实体原封不动

### 代码变化时的清理

读取 `context.pending_invalidation`：

1. 找到所有 `file` 匹配 `changed_files` 的旧 evidence 条目
2. 这些旧条目已被 Evidence Agent 用 `replaces` 取代（Evidence Agent 负责重读文件并追加新条目）
3. Model Agent 扫描 Model 中所有 `evidence_ids`，找出引用了被取代旧条目的实体
4. 对这些实体：
   - 如果新条目已存在 → 更新 `evidence_ids` 指向新条目
   - 如果新条目尚未生成（Evidence Agent 还没处理该文件）→ 标注 `evidence_stale: true`

---

## 强制规则

- **禁止**读源码文件——Model Agent 只读 evidence-log，不读仓库代码
- **禁止**做架构解释、质疑、生成问题——这些是其他 Agent 的职责
- **禁止**修改 `evidence-log.jsonl`（append-only，Evidence Agent 独占）
- **禁止**修改 `context.json`（除了标注 `evidence_stale` 的元信息，由 Orchestrator 协调）
- **禁止**跳过引用一致性检查——每个实体的 `evidence_ids` 必须指向有效条目
- **必须**保持 Model 的增量演化——不要全量重建已稳定的部分

---

## 输出给 Orchestrator

```json
{
  "model_updated": true,
  "entities_added": 3,
  "entities_updated": 5,
  "evidence_stale_marked": 1,
  "ready_for_reasoning": true
}
```

Model Agent 完成后，Orchestrator 调用 Reasoning Agent 进行架构解释和质疑。
