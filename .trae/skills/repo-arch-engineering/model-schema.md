# model-schema.md — Repository Knowledge Model 定义

本文档定义 Repository Knowledge Model 的详细字段类型、Evidence 到 Model 的映射规则、Hypothesis 到 Model 的链接方式、模型增量更新的冲突解决策略。

SKILL.md 描述"Agent 应当做什么"；model-schema.md 定义"模型长什么样"。

没有模型定义，Agent 行为容易退化成"高级代码总结器"——Evidence 不知道更新哪个模型节点，Hypothesis 不知道影响哪个模型字段，增量更新无从下手。

---

# §1 设计原则

## 1.1 模型是图，不是表

Repository Model 不是一张扁平的 JSON 表，而是一个**有向图**：

```
Node（节点）：Identity / Module / Layer / Boundary / Pattern / Decision / Hypothesis / Evidence / Question
Edge（边）：depends_on / contains / supports / contradicts / answers / updates / derived_from
```

JSON 是图的序列化形式，不是图本身。

## 1.2 所有 claim 通过 evidence_id 链接

任何一条架构主张（pattern、decision、runtime flow、evolution event）都必须通过 `evidence: ["ev-xxx"]` 字段链接到至少一条 Evidence 节点。

**无证据的 claim 视为推测（speculative），必须在报告中标明。**

## 1.3 observation 和 inference 在 Evidence 层分离

Evidence 节点内部强制分离：
- `observation[]`：代码事实（"PluginManager 调用 ServiceLoader.load()"）
- `inference[]`：架构解释（"系统支持运行时扩展发现"）

永远不允许把 inference 写入 observation 字段。

## 1.4 模型是持久化的 JSON

模型存储为 `repository-model.json`，可：
- **增量更新**：commit 变化时只更新受影响节点
- **查询**：直接查 JSON，不需要读报告
- **验证**：每个 claim 都有 evidence 链可追溯
- **派生视图**：同一个模型生成不同粒度的报告

---

# §2 顶层结构

```json
{
  "$schema": "repo-engineering-research/v1",
  "model_version": "1.0.0",
  "generated_at": "2026-08-02T10:00:00Z",
  "last_analyzed_commit": "abc1234",
  "identity": { /* §3 */ },
  "architecture": { /* §4 */ },
  "runtime": { /* §5 */ },
  "design_decisions": { /* §6 */ },
  "evolution": { /* §7 */ },
  "hypotheses": { /* §8 */ },
  "evidence": { /* §9 */ },
  "questions": { /* §10 */ },
  "coverage": { /* §11 */ }
}
```

`questions` 和 `coverage` 在 SKILL.md 的顶层结构里未列出，但它们是 Research Engine 的驱动状态，必须持久化。

---

# §3 Identity Model（身份模型）

仓库身份是后续所有 Phase 的输入约束。Phase 0 产出，后续 Phase 不应修改（除非发现错误）。

```json
{
  "identity": {
    "name": "string (必填)",
    "type": "enum (必填): CLI | Library | Framework | Database | Compiler | IDE | Plugin-Host | Application | Monorepo | Unknown",
    "languages": ["string (必填，如 'Java', 'TypeScript')"],
    "frameworks": ["string (可选，如 'Spring', 'Astro')"],
    "build_system": "string (可选，如 'Maven', 'pnpm')",
    "build_files": ["string (可选，构建文件路径)"],
    "entry_points": [{
      "path": "string (必填，文件路径)",
      "symbol": "string (可选，函数/类名)",
      "kind": "enum (必填): main | cli | server | module | test | repl"
    }],
    "deployment_files": ["string (可选，部署相关文件路径)"],
    "deployment_model": "enum (可选): static-site | container | binary | library-artifact | ide-product | server-image | unknown",
    "repository_metadata": {
      "description": "string (可选)",
      "license": "string (可选)",
      "homepage": "string (可选)",
      "stars": "number (可选)",
      "primary_language": "string (可选)"
    }
  }
}
```

---

# §4 Architecture Model（架构模型）

```json
{
  "architecture": {
    "patterns": [{
      "id": "pat-001 (必填)",
      "name": "enum (必填): layered | hexagonal | plugin | event-driven | monolith | microservices | mvc | pipeline | unknown",
      "confidence": "number (必填, 0-1)",
      "evidence": ["ev-xxx (必填，至少 1 条)"],
      "notes": "string (可选，模式细节)"
    }],
    "layers": [{
      "id": "layer-001 (必填)",
      "name": "string (必填，如 'presentation', 'domain')",
      "modules": ["module-id (必填)"],
      "direction": "enum (可选): inward | outward | bidirectional",
      "evidence": ["ev-xxx (可选)"]
    }],
    "boundaries": [{
      "id": "bd-001 (必填)",
      "name": "string (必填，如 'persistence boundary')",
      "from": "module-id | layer-id (必填)",
      "to": "module-id | layer-id (必填)",
      "direction": "enum (必填): allowed | forbidden | restricted",
      "evidence": ["ev-xxx (必填)"],
      "violation_count": "number (可选，违规次数)"
    }],
    "modules": [{
      "id": "mod-001 (必填)",
      "name": "string (必填)",
      "path": "string (必填，目录或文件路径)",
      "responsibility": "string (必填，一句话职责描述)",
      "type": "enum (必填): application | library | service | infrastructure | test | tooling | config",
      "layer": "layer-id (可选)",
      "in_degree": "number (可选，被依赖次数)",
      "out_degree": "number (可选，依赖他人次数)",
      "is_gravity_center": "boolean (可选，是否架构引力中心)",
      "evidence": ["ev-xxx (可选)"]
    }],
    "dependencies": [{
      "from": "module-id (必填)",
      "to": "module-id (必填)",
      "type": "enum (必填): build | runtime | test | optional",
      "evidence": ["ev-xxx (可选)"]
    }],
    "extension_points": [{
      "id": "ep-001 (必填)",
      "name": "string (必填)",
      "host": "module-id (必填，谁暴露扩展点)",
      "mechanism": "string (必填，扩展机制描述)",
      "evidence": ["ev-xxx (必填)"]
    }]
  }
}
```

---

# §5 Runtime Model（运行时模型）

```json
{
  "runtime": {
    "startup_flow": [{
      "step": "number (必填，序号)",
      "action": "string (必填，动作描述)",
      "component": "module-id (必填)",
      "evidence": ["ev-xxx (必填)"]
    }],
    "request_lifecycle": [{
      "step": "number (必填)",
      "stage": "string (必填，如 'middleware', 'router', 'controller')",
      "component": "module-id (必填)",
      "evidence": ["ev-xxx (必填)"]
    }],
    "async_flows": [{
      "id": "af-001 (必填)",
      "name": "string (必填，如 'event-bus', 'job-queue')",
      "components": ["module-id (必填)"],
      "trigger": "enum (必填): timer | event | message | external",
      "evidence": ["ev-xxx (必填)"]
    }],
    "state_management": {
      "persistence": "enum (可选): none | file | database | cache | hybrid",
      "evidence": ["ev-xxx (可选)"]
    }
  }
}
```

---

# §6 Design Decision Model（设计决策模型）

```json
{
  "design_decisions": [{
    "id": "dec-001 (必填)",
    "decision": "string (必填，决策内容)",
    "context": "string (必填，决策约束/背景)",
    "alternatives": ["string (可选，被考虑但未选的方案)"],
    "tradeoff": {
      "gain": "string (必填，获得了什么)",
      "cost": "string (必填，牺牲了什么)"
    },
    "status": "enum (必填): adopted | deprecated | experimental | proposed",
    "evidence": ["ev-xxx (必填，至少 1 条)"],
    "confidence": "number (必填, 0-1)",
    "linked_hypotheses": ["hyp-xxx (可选)"]
  }]
}
```

**关键约束**：没有 `context` 的决策不是架构决策，没有 `alternatives` 的决策无法评估，没有 `tradeoff` 的决策不是真正的权衡。

---

# §7 Evolution Model（演进模型）

```json
{
  "evolution": {
    "timeline": [{
      "version": "string (必填，如 '1.0', 'commit-hash')",
      "date": "string (可选, ISO 8601)",
      "change_type": "enum (必填): major-rewrite | architecture-pivot | feature-add | refactor | deprecation | dependency-update",
      "change": "string (必填，变更描述)",
      "evidence": ["ev-xxx (必填)"]
    }],
    "current_direction": "string (必填，当前演进方向)",
    "deprecated_patterns": [{
      "pattern": "string (必填)",
      "replaced_by": "string (可选)",
      "evidence": ["ev-xxx (可选)"]
    }],
    "historical_sediments": ["string (可选，历史沉积而非刻意设计的组件)"]
  }
}
```

---

# §8 Hypothesis Model（假设模型）

假设是 Evidence 与 Validated Knowledge 之间的桥梁。每条假设可被 Evidence 支持/反对，并影响某个模型字段。

```json
{
  "hypotheses": [{
    "id": "hyp-001 (必填)",
    "hypothesis": "string (必填，假设陈述)",
    "status": "enum (必填): candidate | investigating | confirmed | rejected | uncertain",
    "confidence": "number (必填, 0-1)",
    "supporting_evidence": ["ev-xxx (可选)"],
    "counter_evidence": ["ev-xxx (可选)"],
    "falsification_criteria": "string (必填，'如果假设错，我们会看到什么')",
    "linked_questions": ["q-xxx (必填，至少 1 个)"],
    "linked_model_fields": ["model-path (必填，影响哪些模型字段)"],
    "validation_history": [{
      "timestamp": "string (必填, ISO 8601)",
      "action": "string (必填，'formed' | 'evidence-added' | 'challenged' | 'status-changed')",
      "delta": "string (可选，变化描述)"
    }]
  }]
}
```

**关键约束**：
- `falsification_criteria` 必填——没有可证伪性的假设不是假设
- `linked_model_fields` 必填——不影响任何模型字段的假设是空谈
- `linked_questions` 必填——假设由问题触发，回答问题验证/推翻假设

---

# §9 Evidence Model（证据模型）

证据是 append-only 的，永远不删除、不覆盖。

```json
{
  "evidence": [{
    "id": "ev-001 (必填)",
    "source": {
      "type": "enum (必填): file | git-commit | issue | doc | config | manifest | test | external",
      "path": "string (file/config/manifest 时必填)",
      "commit": "string (git-commit 时可选)",
      "url": "string (external 时可选)"
    },
    "observation": ["string (必填，代码事实，至少 1 条)"],
    "inference": ["string (可选，从观察推导的架构解释)"],
    "target_model_fields": ["model-path (可选，此证据支撑哪些模型字段)"],
    "confidence": "number (必填, 0-1)",
    "evidence_tier": "enum (必填): S-executable | A-implementation | B-config | C-doc | D-commit | E-inference",
    "collected_at": "string (必填, ISO 8601)",
    "collected_by": "enum (必填): mechanical-analyzer | llm-inference | human"
  }]
}
```

## 9.1 Evidence Tier（证据等级）

从高到低：

| Tier | 类型 | 示例 | 权重 |
|-|-|-|-|
| S | 可执行行为（tests/benchmarks） | 测试通过、性能基准 | 1.00 |
| A | 实现源码（source code） | 类定义、函数调用 | 0.85 |
| B | 配置（configuration） | pom.xml、tsconfig.json | 0.70 |
| C | 文档（documentation） | README、ADR | 0.50 |
| D | 提交/Issue（commit/issue） | commit message、issue | 0.30 |
| E | 推论（inference） | LLM 从代码推导 | 0.15 |

**冲突处理规则**：高层级证据覆盖低层级证据。文档声称必须在代码或测试中验证，否则标注"文档声称但未验证"。

## 9.2 Observation vs Inference

```
✓ observation: "PluginManager 在 line 42 调用 ServiceLoader.load()"
✗ observation: "系统支持插件架构"  ← 这是 inference
✓ inference:   "系统支持运行时扩展发现"
```

---

# §10 Question Model（问题模型）

问题是知识缺口，随研究进展动态演化。

```json
{
  "questions": [{
    "id": "q-001 (必填)",
    "question": "string (必填，问题陈述)",
    "reason": "string (必填，什么证据触发了这个问题)",
    "expected_evidence": ["string (必填，找到什么证据才算回答)"],
    "priority": "enum (必填): critical | high | medium | low",
    "status": "enum (必填): open | investigating | answered | invalidated",
    "linked_hypothesis": "hyp-xxx (可选)",
    "linked_model_fields": ["model-path (可选)"],
    "asked_at": "string (必填, ISO 8601)",
    "answered_at": "string (可选, ISO 8601)",
    "answer_summary": "string (可选，回答摘要)"
  }]
}
```

## 10.1 好问题 vs 坏问题

**好问题**（知识缺口）：
```
q-001: "插件在运行时如何被发现？"
  reason: "看到 PluginManager 类，但不知道发现机制"
  expected_evidence: ["ServiceLoader 调用点", "extension point 注册逻辑"]
```

**坏问题**（任务描述）：
```
q-002: "分析插件模块。"
  ← 没有 reason，没有 expected_evidence，无法判断何时算回答
```

---

# §11 Coverage Model（覆盖率模型）

Research Engine 的停止条件之一。每个维度的覆盖率 = answered / total。

```json
{
  "coverage": {
    "runtime": { "answered": 0, "total": 0, "ratio": 0.0 },
    "architecture": { "answered": 0, "total": 0, "ratio": 0.0 },
    "design_decisions": { "answered": 0, "total": 0, "ratio": 0.0 },
    "testing": { "answered": 0, "total": 0, "ratio": 0.0 },
    "deployment": { "answered": 0, "total": 0, "ratio": 0.0 },
    "history": { "answered": 0, "total": 0, "ratio": 0.0 }
  }
}
```

**停止条件**：
- 所有维度 `ratio >= 0.8`，或
- 连续 2 轮没有新问题产生，或
- 所有 critical/high 问题都已 answered

---

# §12 ID 命名规范

所有节点的 `id` 必须遵循以下前缀规范，便于跨节点引用：

| 前缀 | 节点类型 | 示例 |
|-|-|-|
| `ev-` | Evidence | `ev-001`, `ev-002` |
| `hyp-` | Hypothesis | `hyp-001` |
| `q-` | Question | `q-001` |
| `pat-` | Architecture Pattern | `pat-001` |
| `layer-` | Layer | `layer-001` |
| `bd-` | Boundary | `bd-001` |
| `mod-` | Module | `mod-001` |
| `ep-` | Extension Point | `ep-001` |
| `af-` | Async Flow | `af-001` |
| `dec-` | Design Decision | `dec-001` |

ID 在单个模型内全局唯一，使用 3 位数字 zero-padded。

`linked_model_fields` 使用 JSONPath 表示，如：
- `architecture.patterns[0].confidence`
- `runtime.startup_flow`
- `design_decisions[2].tradeoff.gain`

---

# §13 Evidence → Model 映射规则

Evidence 通过 `target_model_fields` 字段链接到模型节点。映射规则如下：

## 13.1 一对一映射

一条 Evidence 支撑一个模型字段：

```json
{
  "id": "ev-007",
  "source": { "type": "file", "path": "src/PluginManager.java" },
  "observation": ["PluginManager 在 line 42 调用 ServiceLoader.load()"],
  "inference": ["系统支持运行时扩展发现"],
  "target_model_fields": ["architecture.patterns[0].confidence", "architecture.extension_points[0].evidence"]
}
```

## 13.2 一对多映射

一条 Evidence 可支撑多个模型字段（常见情况）：

```json
"target_model_fields": [
  "architecture.patterns[0].evidence",
  "architecture.modules[3].evidence",
  "design_decisions[1].evidence"
]
```

## 13.3 多对一映射

多个 Evidence 共同支撑一个模型字段，置信度按 §14 聚合。

## 13.4 映射生成时机

- **Evidence 收集时**：Mechanical Analyzer 产出 Evidence 时，可初步标注 `target_model_fields`
- **Hypothesis 形成时**：LLM 形成 Hypothesis 时，通过 `linked_model_fields` 间接更新 Evidence 的 target
- **Model 构建时**：Model 构建阶段必须验证每个 claim 至少有 1 条 Evidence 指向它

## 13.5 无证据 claim 的处理

如果 Model 构建时发现某 claim 无 Evidence 链接：
- 标注 `"evidence": []`
- 设置 `confidence = 0.0`
- 在报告中标注"speculative"（推测）
- 生成 Question 追问该 claim

---

# §14 Hypothesis → Model 链接规则

## 14.1 linked_model_fields 必填

每条 Hypothesis 必须通过 `linked_model_fields` 声明它影响哪些模型字段。

```json
{
  "id": "hyp-003",
  "hypothesis": "系统采用 OSGi bundle 实现运行时插件隔离",
  "linked_model_fields": [
    "architecture.patterns[0]",
    "architecture.extension_points",
    "runtime.startup_flow"
  ],
  "linked_questions": ["q-005", "q-006"]
}
```

## 14.2 状态迁移影响模型

Hypothesis 状态变化时，触发对应模型字段更新：

| Hypothesis 状态 | 对模型字段的影响 |
|-|-|
| `candidate` | 模型字段可暂存，但 `confidence` 上限 0.3 |
| `investigating` | 模型字段保留，`confidence` 上限 0.6 |
| `confirmed` | 模型字段 `confidence` 按 §15 聚合计算 |
| `rejected` | 模型字段标记为 `deprecated` 或删除（保留历史） |
| `uncertain` | 模型字段保留，但报告中标注"未确认" |

## 14.3 反证搜索触发

当 Hypothesis 进入 `investigating` 状态时，Research Engine 必须触发反证搜索：
- 根据 `falsification_criteria` 生成搜索 query
- 搜索结果产生新的 Evidence（supporting 或 counter）
- 根据正反证据平衡更新 `confidence`

---

# §15 置信度计算规则

置信度不是 LLM 猜的数字，而是基于证据数量、来源多样性、证据等级、反证搜索结果计算。

## 15.1 单条 Evidence 的置信度

```
evidence_confidence = evidence_tier_weight × source_diversity_bonus
```

- `evidence_tier_weight`：见 §9.1（S=1.0, A=0.85, ..., E=0.15）
- `source_diversity_bonus`：如果该来源类型首次出现，×1.0；重复来源类型 ×0.7

## 15.2 多条 Evidence 聚合

一个 claim 由 N 条 Evidence 支撑时：

```
claim_confidence = 1 - ∏(1 - ei_confidence)    (Noisy-OR 模型)
```

示例：3 条 Evidence，置信度分别为 0.85、0.70、0.50：
```
claim_confidence = 1 - (1-0.85)(1-0.70)(1-0.50)
                 = 1 - 0.15 × 0.30 × 0.50
                 = 1 - 0.0225
                 = 0.9775
```

## 15.3 反证扣减

如果存在 counter_evidence：

```
final_confidence = claim_confidence × (1 - counter_evidence_strength)
```

`counter_evidence_strength` 同样按 §15.1/15.2 计算，但范围限制在 [0, 0.5]，避免单条反证直接清零。

## 15.4 置信度上限

- 纯 E-tier（推论）证据：`confidence` 上限 0.3
- 纯 D-tier（commit/issue）证据：上限 0.5
- 纯 C-tier（文档）证据：上限 0.6
- 至少 1 条 B-tier 及以上：上限 0.85
- 至少 1 条 S-tier 或 2 条 A-tier：上限 0.95
- 永远不到 1.0（保留"可能错"的空间）

---

# §16 模型增量更新冲突解决策略

当 commit 变化触发增量更新时，可能产生冲突。

## 16.1 冲突类型

| 冲突类型 | 描述 | 解决策略 |
|-|-|-|
| **Evidence 失效** | 原 Evidence 引用的文件/行已删除 | 标注 `deprecated`，不删除；重新收集 |
| **Claim 矛盾** | 新 Evidence 与已 confirmed 的 Hypothesis 矛盾 | Hypothesis 降级为 `uncertain`，触发新一轮反证搜索 |
| **字段覆盖** | 新值与旧值不同 | 旧值移入 `history[]`，新值覆盖；保留 `updated_at` |
| **节点删除** | 模块/层被移除 | 标注 `status: removed`，不物理删除（保留历史） |
| **置信度下降** | 新反证降低 confidence | 按 §15.3 重算；如果 < 0.3，触发验证或降级 |

## 16.2 冲突解决优先级

1. **S-tier 证据优先**：可执行行为证据覆盖一切
2. **新证据优先于旧证据**：当代码变更使旧观察失效时
3. **反证优先于支持**：当反证与支持冲突时，先降级再验证
4. **保留历史**：永远不物理删除节点，只标注状态

## 16.3 增量更新流程

```
commit 变化
  |
  v
识别受影响的 Evidence（基于 source.path）
  |
  v
对每条受影响 Evidence:
  +-- 文件未变 → 跳过
  +-- 文件已变 → 重新收集 Evidence（保留原 Evidence 为 deprecated）
  +-- 文件已删 → 标注 Evidence 为 deprecated
  |
  v
识别受影响的 Hypothesis（基于 supporting_evidence / counter_evidence）
  |
  v
重算受影响 Hypothesis 的 confidence（按 §15）
  |
  v
如果 confidence 下降超过 0.2 → 触发反证搜索
  |
  v
更新 Model 中受 linked_model_fields 影响的字段
  |
  v
更新 Coverage（重新计算 answered/total）
```

## 16.4 版本与回滚

```json
{
  "model_version": "1.0.0",
  "last_analyzed_commit": "abc1234",
  "previous_commit": "def5678",
  "update_history": [{
    "timestamp": "2026-08-02T10:00:00Z",
    "commit": "abc1234",
    "changes": ["ev-007 deprecated", "ev-012 added", "hyp-003 confidence 0.85→0.72"]
  }]
}
```

每次增量更新产生一条 `update_history` 记录，支持回滚到任意 commit 的模型快照。

---

# §17 验证清单（Validation Checklist）

Model 构建完成时，必须通过以下验证：

- [ ] 每个 `architecture.patterns[]` 至少有 1 条 `evidence`
- [ ] 每个 `design_decisions[]` 至少有 1 条 `evidence`
- [ ] 每个 `runtime.startup_flow[]` 步骤至少有 1 条 `evidence`
- [ ] 每个 `hypotheses[]` 有 `falsification_criteria` 和 `linked_model_fields`
- [ ] 每个 `evidence[]` 的 `observation` 不为空
- [ ] 没有 inference 被写入 `observation` 字段
- [ ] 所有 `evidence_id` 引用都指向存在的 Evidence 节点
- [ ] 所有 `hyp-xxx` 引用都指向存在的 Hypothesis 节点
- [ ] Coverage 每个维度的 `total > 0`（避免维度被遗漏）
- [ ] 没有 `confidence > 0.95` 的 claim（保留不确定性）

验证失败时，Agent 必须修复或标注为 `speculative`，不能 silently 进入报告生成。
