---
name: "repo-research-v2"
description: "把仓库编译成架构知识库（仓库模型），并从中生成报告。当用户要求研究/分析某个仓库的架构、设计模式或工程实现时调用。"
---

# Repository 研究

> 相关文档：[methodology.md](./methodology.md)（研究方法论） | [question-framework.md](./question-framework.md)（问题生成与管理） | [report-schema.md](./report-schema.md)（仓库模型 + 报告规范）

---

## 目标

编译目标：构建可复用的架构知识库（Repository Model）。

Repository Model 捕获实体、关系及支撑证据。报告是 Model 的视图。

---

## 恢复已有分析

**这是执行入口，优先于下面的所有阶段。**

如果工作目录存在，从上次中断的地方继续，不从头开始。

### 恢复流程

1. **加载 context.json** — 恢复研究状态（当前轮次、模型稳定程度、已收集证据计数）
2. **加载 artifacts/evidence-log.jsonl** — 恢复已收集的所有证据洞察（这是研究的"实验室笔记"，Stage 5 写报告时从这里取证据，不从对话上下文取）
3. **加载 repository-model.json** — 恢复仓库模型
4. **加载 meta.json** — 恢复元信息（仓库路径、仓库类型、上次分析的提交）
5. **加载 questions/summary.json** — 恢复问题进度（问题数量、已回答、已验证）
6. **按需加载已有的 round-N.json** — 作为只读历史引用，禁止修改

### 判断代码是否变了

- `git rev-parse HEAD` 与 `meta.last_analyzed_commit` 比较
- 非 Git 仓库 → 始终视为"已变化"

| 代码变了没有 | 怎么做 |
|------------|------|
| 没变 | 不做扫描、不重新识别类型、不重新统计目录 |
| 变了 | 用 `git diff` 找出改了什么，只更新受影响的部分 |

### 恢复到上次执行位置

读取 `context.resume`，看上次执行到哪里了：

```json
{
  "last_completed_stage": "Stage 3",
  "next_stage": "Stage 4",
  "last_round": 2
}
```

- 直接跳到 `next_stage`
- 禁止重复执行已经做完且仍然有效的阶段
- 每个阶段做完时，写入 `context.resume.last_completed_stage`

### 强制规则

- 如果上次已经写完了报告（Stage 5），而且代码没变 → 直接返回已有报告
- 如果上次至少完成了一轮完整研究（Stage 4）→ 进入 Stage 3 Planner，由 Planner 判断收敛与否（收敛→Stage 5，未收敛→生成 round-N+1 继续 Stage 4）
- **禁止**在代码没变时重新执行阶段 1-2
- **禁止**修改已有的 `questions/round-N.json`（新研究目标只能写入 `round-(N+1).json`）

---

## 我们能看什么

从下面这些信息里挑可用的：

- 源代码
- 文档 / ADR / RFC / README
- 配置 / 构建脚本
- 测试
- Git 历史
- 包元数据 / 指标

信息缺失时，优雅降级。

---

## 工作目录

每次分析用同一个工作目录，放所有中间结果和最终报告。**禁止**把分析产物散落在仓库内部或临时目录。

### 目录结构

```
.working/{repo-name}/
├── artifacts/               # 可复用的产物（代码没变时禁止重新生成）
│   ├── repository-profile.json  # 仓库类型、语言、文件统计、入口点
│   ├── directory-tree.json      # 完整目录结构（扁平路径列表）
│   ├── symbol-index.json        # 符号索引（函数、类、导出）
│   ├── git-summary.json         # Git 历史分析
│   └── evidence-log.jsonl       # 证据日志（append-only，每文件一行，含 key_findings）
├── context.json             # 执行上下文（允许修改，增量更新）
├── questions/               # 问题轮次（不可变历史）
│   ├── round-1.json         # 第一轮问题
│   ├── round-2.json         # 第二轮问题
│   ├── round-N.json         # 第 N 轮问题
│   └── summary.json         # 轮次索引
├── repository-model.json    # 仓库模型（允许修改，增量更新）
├── report.md                # 最新报告（易变）
└── meta.json                # 元信息
```

> **evidence-log.jsonl 是研究的"实验室笔记"**。每读一个文件提取的洞察必须立即落盘到这个文件，禁止只存在对话上下文里。会话压缩或中断后，Stage 5 写报告时所有证据都从这里读取。

---

## 产物缓存（哪些能复用，哪些每次重新生成）

定义每种中间产物的稳定性。**这是恢复现场的基础。**

| 分类 | 产物 | 保存位置 | 更新规则 |
|------|----------|---------|---------|
| **可复用** | 仓库概要 | `artifacts/repository-profile.json` | 只有代码变了才重新生成 |
| **可复用** | 目录树 | `artifacts/directory-tree.json` | 只有代码变了才重新生成 |
| **可复用** | 符号索引 | `artifacts/symbol-index.json` | 只有代码变了才重新生成 |
| **可复用** | Git 历史 | `artifacts/git-summary.json` | 只有代码变了才重新生成 |
| **可复用+追加** | 证据日志 | `artifacts/evidence-log.jsonl` | 代码没变时禁止重新生成；新增读取的文件追加新行，禁止改写已有行 |
| **允许修改** | 上下文 | `context.json` | 首次创建后增量更新；恢复时加载现有文件继续，禁止从零重建——`resume`/`coverage`/`model_stability`/`challenge_record` 都是跨会话累积的 |
| **允许修改** | 仓库模型 | `repository-model.json` | Stage 4b 首次全量构建，后续只更新受影响部分；恢复时加载现有模型继续，禁止从零重建 |
| **禁止修改** | 问题轮次 | `questions/round-N.json` | 创建后永久冻结，禁止修改 |
| **允许修改** | 问题汇总 | `questions/summary.json` | 唯一可以修改的 questions 文件 |
| **每次重新生成** | 报告 | `report.md` | 每次分析重新生成（从模型+证据日志生成，不继承旧报告） |

**强制规则**：

- 可复用的产物：**代码没变时，禁止重新生成**。必须直接从 `artifacts/` 读取。
- 允许修改的产物：**首次创建后持久化，恢复时加载继续**。增量更新，禁止从零重建。代码变了时只更新受影响部分。
- 每次重新生成的产物：每次分析按需重建。不缓存。
- 判断依据是 `meta.json` 里的 `last_analyzed_commit`。不是 Git 仓库的话每次全量分析。

### evidence-log.jsonl 格式规范

**JSON Lines 格式**（每行一个 JSON 对象，**真正的 append-only——禁止修改或删除已有行**）。这是研究过程的"实验室笔记"，记录从每个文件提取的**实际洞察**，而非仅文件路径。

```json
{"id": "ev-001", "ts": "2026-07-30T14:23:01Z", "file": "server/gateway.ts", "purpose": "理解请求生命周期与认证链", "scope": "file", "key_findings": ["1960 行单文件实现 7 层认证（origin→CORS→HMAC→API key→tier→entitlement→rate-limit）", "7 档缓存策略（fast/medium/slow/slow-browser/static/daily/no-store/live）", "ETag 用 FNV-1a 哈希", "POST→GET 兼容垫片用于 CDN 缓存"], "evidence_strength": "A", "related_questions": ["Q1", "Q3"], "coverage_delta": {"runtime": 0.3, "architecture": 0.2}, "replaces": null}
```

**字段约束**：

| 字段 | 必填 | 内容 |
|------|------|------|
| `id` | 是 | 递增编号 `ev-001`, `ev-002`... |
| `ts` | 是 | ISO 8601 时间戳 |
| `file` | 是 | 相对仓库根的路径；cross-file 证据用 `cross:gateway+router+cache` 格式 |
| `scope` | 是 | `file`（单文件证据）或 `cross`（跨文件综合证据） |
| `purpose` | 是 | 为什么读这个文件（一句话，绑定到具体研究问题）。失效粒度是 `(file, purpose)`——同一个文件不同 purpose 的条目独立失效 |
| `key_findings` | 是 | **从该文件提取的关键洞察数组**。数量按文件类型分级（见下表）。这是核心字段——不是文件摘要，是研究结论 |
| `evidence_strength` | 是 | S/A/B/C/D/E 分级（详见 report-schema.md Evidence Hierarchy） |
| `related_questions` | 否 | 关联的 round-N 问题 ID |
| `coverage_delta` | 否 | 本条证据对 6 维 coverage 的影响估算 |
| `replaces` | 否 | 当本条取代旧证据时，填旧证据的 `id`（如 `"ev-023"`）。**不修改旧条目**——Stage 5 通过扫描所有 `replaces` 字段计算哪些条目已被取代 |

#### key_findings 数量分级（按文件类型）

| 文件类型 | 最少洞察数 | 示例 |
|----------|-----------|------|
| 核心源码（gateway/router/pipeline） | ≥ 3 | gateway.ts、router.ts、schema.ts |
| 普通源码（utils/handlers） | ≥ 2 | _cors.js、_rate-limit.js |
| 配置文件（package.json/tsconfig/Dockerfile） | ≥ 1 | package.json → "21 个 CI workflow，OIDC trusted publishing" |
| 琐碎文件（.gitignore/LICENSE/.npmrc） | 0 — 跳过不写日志 | — |

**洞察不足时的处理**：如果文件提取不出最少洞察数，说明该文件对当前研究问题价值低，跳过不写日志条目（不是硬凑洞察）。

**禁止行为**：

- ❌ `key_findings` 为空数组或只写"已读"（要么有洞察，要么跳过不写）
- ❌ `key_findings` 写成文件内容摘要而非研究洞察（错误示例："这个文件有 1960 行"；正确示例："单文件承载 7 层认证链，违反单一职责但换取了请求处理的原子性"）
- ❌ 批量读取多个文件后才写一条聚合日志——**单文件证据每读一个文件写一行**
- ❌ 修改或删除已有行的任何字段（**真正的 append-only**——代码变化时只能追加 `replaces` 新条目，不能改旧行）
- ❌ 把证据只存在 `context.json.evidence_collected` 而不写日志文件

#### 证据失效机制（真正的 append-only）

evidence-log.jsonl 是 **append-only**——禁止修改或删除已有行。代码变化时，不修改旧条目，而是追加新条目并在新条目的 `replaces` 字段声明取代关系。

**失效粒度**：`(file, purpose)`。同一个文件的不同 purpose 独立失效——gateway.ts 的"认证"证据失效不 影响 gateway.ts 的"缓存"证据。

**代码变化时的失效流程**：

1. Stage 2 检测到 `gateway.ts` 变化
2. 找到所有 `file == "gateway.ts"` 的旧条目（无论 purpose）
3. 对每个旧条目，重新读取文件并追加新条目：
   ```json
   {"id": "ev-058", "file": "gateway.ts", "purpose": "理解认证链", "replaces": "ev-023", ...}
   ```
4. **不修改 ev-023**——它原封不动留在日志里

**Stage 5 计算有效证据**：

```
1. 读取 evidence-log.jsonl 全部行
2. 收集所有 replaces 字段的值 → replaced_ids = {"ev-023", "ev-045", ...}
3. 有效证据 = 所有条目 - replaced_ids 中的条目
4. 对每个 (file, purpose)，取有效条目中 ts 最新的那条
```

**cross 证据的失效传播**：如果 cross 证据的任何一个组成文件的单文件证据被取代，该 cross 证据也被视为失效。Stage 5 计算 cross 证据有效性时，检查其 `file` 字段（如 `cross:gateway+router+cache`）拆分出的每个文件是否有更新的单文件证据——如果有，该 cross 证据跳过，需要 Stage 4 重新生成。

---

## 问题历史：只追加，不修改

每轮问题一旦生成就永久冻结，只能追加新轮次，不能修改已有轮次。

### 目录结构

```
questions/
├── round-1.json      (immutable — 永久冻结)
├── round-2.json      (immutable — 永久冻结)
├── round-3.json      (immutable — 永久冻结)
└── summary.json      (mutable — 唯一允许修改)
```

### 禁止操作

已有 `questions/round-N.json` 文件：

- ❌ 重写内容
- ❌ 重新排序问题
- ❌ 删除问题
- ❌ 修改问题措辞
- ❌ 更新问题状态（answered/validated）
- ❌ 更新证据引用
- ❌ 追加或删除问题

### 允许操作

- ✅ 创建 `questions/round-(N+1).json`（新增轮次）
- ✅ 更新 `questions/summary.json`（统计信息）
- ✅ 更新 `context.question_statistics`（内存中的统计缓存）

### 状态存储

**问题状态不存储在 round 文件中。** 答案状态存储在 `summary.json`：

```json
{
  "latest_round": 2,
  "rounds": [
    { "round": 1, "file": "round-1.json", "answered": 31, "validated": 20, "status": "closed" },
    { "round": 2, "file": "round-2.json", "answered": 11, "validated": 5, "status": "active" }
  ]
}
```

`round-1.json` 里的 `status` 字段（如果有的话）只是初始值，LLM 输出的任何状态变更必须写入 `summary.json`，不能改 round 文件。

### 历史必须能复现

每个 `round-N.json` 是当时研究过程的快照，不能改。改了就等于伪造历史。**禁止。**

### context.json

context.json 是研究者的**外部脑**。记录当前研究做到哪了、进展如何。

```json
{
  "user_input": "用户原始输入，保持不变",
  "resume": {
    "last_completed_stage": "阶段 4",
    "next_stage": "阶段 5",
    "last_round": 2
  },
  "current_round": 2,
  "current_question_file": "questions/round-2.json",
  "model_stability": "formative",
  "question_statistics": {
    "rounds": 2,
    "total_questions": 57,
    "answered": 41,
    "validated": 18
  },
  "coverage": {
    "runtime": 0.95,
    "architecture": 0.82,
    "design_decisions": 0.64,
    "testing": 0.51,
    "deployment": 0.31,
    "history": 0.21
  },
  "architecture_model": {
    "center_hypothesis": "最核心的架构假设（一句话）",
    "key_assumptions": [...],
    "architecture_invariants": ["不能违反的基本约束"],
    "unexplained_observations": ["当前模型解释不了的现象"],
    "competing_interpretations": []
  },
  "challenge_record": [...],
  "design_space": [...],
  "maintainer_view": {...},
  "evidence_collected": {
    "log_file": "artifacts/evidence-log.jsonl",
    "count": 42,
    "last_ev_id": "ev-042",
    "note": "实际证据洞察存放在 evidence-log.jsonl，这里只存计数和指针。禁止把完整证据内容塞进 context.json——会话压缩会丢失。"
  },
  "quality_gate": {...}
}
```

#### 模型稳定程度的状态变化

| 状态 | 含义 | 什么时候进入 |
|------|------|---------|
| `nascent` | 刚建好模型，还没验证过 | 完成第一轮研究 |
| `formative` | 模型还在修正中 | 新证据改变了模型 |
| `challenged` | 模型被质疑过，有别的解释 | 挑战阶段发现了替代方案 |
| `stable` | 质疑没推翻，模型收敛了 | 所有质疑都挺住了 |

**禁止**直接从 nascent 跳到 stable。模型必须先被质疑过，才能算稳定。

#### 代码变化时的状态回退

当 Stage 2 检测到代码变化时，context 中的状态需要回退——不能假设旧状态仍然有效：

| 状态字段 | 代码变化时的处理 | 理由 |
|---------|----------------|------|
| `model_stability` | `stable`/`challenged` → `formative` | 代码变了，模型可能过时，需要重新验证 |
| `coverage` | 受影响维度降回 0.3（保留基线），未受影响维度保持 | 不清零（避免丢失已积累的理解），但降低置信度 |
| `challenge_record` | 保留，但每条标注 `commit`（验证时的 commit hash） | 旧挑战结论可能不再适用，但保留历史供参考 |
| `design_space` | 保留，受影响的决策标注 `evidence_stale: true` | 决策本身可能仍有效，但支撑证据需要重新验证 |
| `quality_gate` | 全部重置为 `false` | 必须重新通过质量检查 |

#### coverage 计算规则

- coverage **只能增加，不能下降**——除非模型被挑战推翻（`model_stability` 回退到 `challenged`）
- 代码变化时：受影响维度降回 0.3（不是清零，保留基线理解），未受影响维度保持不变
- 代码没变时：每轮研究只能提升 coverage，禁止降低（新证据不应减少已有理解）
- 例外：如果新证据**推翻**了旧结论（challenge 成功），对应维度的 coverage 可以降低

---

## 研究流程

```mermaid
flowchart TD
    Start[Start] --> R{Working Directory?}

    %% Resume
    R -- 否 --> Fresh[初始化工作目录 + meta.json]
    Fresh --> S0[Stage 0: Resume Workspace]
    S0 --> S1_1

    R -- 是 --> Resume["阶段 0：恢复现场
    — 加载 context.json
    — 加载 repository-model.json
    — 加载 meta.json
    — 加载 questions/summary.json"]
    Resume --> C{代码变了?}

    C -- 否 --> CheckStage{resume.next_stage?}
    CheckStage --> |阶段 4+| Direct[已有进展]
    Direct --> Planner[阶段 3：决定下一步]
    CheckStage --> |阶段 3以下| Jump[恢复到 next_stage]
    Jump --> Planner

    C -- 是 --> S1[阶段 1：扫描仓库<br>— directory-tree.json<br>— repository-profile.json]
    S1 --> S2[阶段 2：分析变化<br>— git diff<br>— 更新受影响的产物]
    S2 --> Planner

    %% Planner
    Planner --> P0{收敛条件全满足?}
    P0 -- 是 --> Report[阶段 5：写报告]
    P0 -- 否 --> P1{评估覆盖度}
    P1 --> P2[找到最薄弱的地方]
    P2 --> P3[生成 round-N+1 问题]
    P3 --> P4{至少做过一轮?}

    P4 -- 否 --> FullResearch
    P4 -- 是 --> P5[复用已有模型 + 追加研究]

    %% Research cycle
    subgraph FullResearch[阶段 4：完整研究]
        R1[收集证据<br>file + cross 证据]
        R2[构建/更新模型]
        R3[架构解释]
        R4[质疑模型]
        R5[更新 coverage + summary]
        R1 --> R2 --> R3 --> R4 --> R5
    end

    subgraph P5[阶段 4：增量研究]
        I1[只收集缺失证据]
        I2[更新模型受影响部分]
        I3[质疑新增结论]
        I1 --> I2 --> I3
    end

    FullResearch --> G{质量检查通过?}
    P5 --> G
    G -- 不通过 → 回到规划器
    G -- 通过 --> Report[阶段 5：写报告]
    Report --> Done[写入工作目录 + 更新 context.resume]
```

---

## 阶段 0 — 恢复现场

参见 [恢复已有分析](#恢复已有分析) 节。

**执行入口**。加载已有研究状态，确定下一步跳到哪个阶段。

**禁止**在此阶段做任何扫描、分析或推理。

---

## 阶段 1 — 扫描仓库

**条件执行**。只有下面这些情况才需要执行：

| 情况 | 怎么做 |
|------|------|
| 代码变了 | 全量或增量扫描，取决于变化范围 |
| 可复用的产物丢了 | 只生成缺失的产物 |
| 不是 Git 仓库 | 每次扫描 |

生成可复用的产物，保存到 `artifacts/`：

| 产物 | 内容 |
|----------|------|
| `directory-tree.json` | 完整目录结构（文件路径列表、目录列表） |
| `repository-profile.json` | 仓库类型、语言分布、文件统计、入口点 |

### 禁止行为

- 代码没变时重新扫描
- 在此阶段做架构解释

### 仓库类型识别

仓库类型属于 `repository-profile.json` 的一部分。首次扫描时识别并写入 profile；代码没变时直接复用缓存。只有代码变了**且**类型置信度不高时才重新识别。

---

## 阶段 2 — 分析代码变化

**条件执行**。只有代码变了才需要执行。

**职责边界**：Stage 2 只更新 `artifacts/` 下的可复用产物（directory-tree、repository-profile、symbol-index、git-summary），**不更新** repository-model、context、challenge_record、design_space——那些是 Stage 4 的职责。

1. `git diff {last_analyzed_commit}..HEAD` 找出改了什么文件
2. 按文件类型分类变化（新增/修改/删除）
3. 只重新生成受影响的 `artifacts/` 产物
4. 标记 evidence-log 中受影响文件的条目需要失效（实际失效在 Stage 4a 重读时通过 `replaces` 完成）
5. 更新 `meta.last_analyzed_commit`

产出：更新后的 artifacts + 变化文件清单（传递给 Stage 4）。

---

## 阶段 3 — 决定下一步研究什么

**只要研究没做完，每次都要经过这个阶段。**

决定**下一轮研究目标**，而不是修改已有 round。已有 `questions/round-N.json` 永久冻结，新研究目标写入新的 `round-(N+1).json`。

### Planner 的首要职责：继续还是结束？

Planner 必须先回答：**研究是否收敛？**

**收敛条件（全部满足才能进入 Stage 5）**：

1. `context.coverage` 中至少 4 个方面 ≥ 0.5
2. `model_stability` ≠ `nascent`（模型被质疑过）
3. 所有 `key_assumptions` 至少被质疑一次
4. `latest_round` ≥ 2

**收敛了** → 直接进入 Stage 5，不生成新 round。
**没收敛** → 生成下一轮问题，进入 Stage 4。

### 评估我们已经了解了多少

读取 `context.coverage`，找到我们最不了解的方面：

| 方面 | 包含 | 默认值 |
|------|------|--------|
| `runtime` | 运行时架构、启动流程、请求生命周期 | 首次 0 |
| `architecture` | 模块组织、边界、分层、模式 | 首次 0 |
| `design_decisions` | 关键决策、替代方案、权衡 | 首次 0 |
| `testing` | 测试策略、覆盖率、质量保障 | 首次 0 |
| `deployment` | 构建、部署、CI/CD | 首次 0 |
| `history` | 演进历史、重大变化、技术债务 | 首次 0 |

### 规划器需要回答

把答案写入 `context.resume.next_research_focus`：

```
研究收敛了吗？     → 上面 4 个收敛条件是否全满足
哪里了解最少？     → 上面 6 个方面里得分最低的
哪个假设没验证过？ → key_assumptions 中 challenged=false 的
哪个解释没被质疑过？ → challenge_record 缺少 counter_evidence 的
哪个模块还没看过？ → structure.modules 有但 evidence_collected 里没有的
下一轮应该研究什么？→ 一句话说清楚研究目标
```

### 规划规则

- 首次运行：生成 8-12 个至少追问一层为什么的问题，写入新创建的 `questions/round-1.json`
- 后续运行：基于最薄弱的方向生成 ≤5 个至少追问两层为什么的问题，**必须创建新的 `questions/round-(current_round+1).json`**，禁止追加到已有轮次
- 禁止在同一方面重复生成同类问题
- 如果最薄弱的方向和上一轮一样 → 要求追问更深一层（追问层数+1），避免在原地打转

### current_round 更新时序

```
Planner 判定未收敛
  ↓
创建 questions/round-(N+1).json
  ↓
更新 context.current_round = N+1
更新 context.current_question_file = "questions/round-(N+1).json"
更新 questions/summary.json（追加新轮次记录）
  ↓
进入 Stage 4
```

**禁止**在 Stage 4 开始后才更新 `current_round`——恢复时必须能从 `context.current_round` 确切知道当前研究的是第几轮。

---

## 阶段 4 — 深入研究架构

执行规划器定好的下一轮研究目标。

### 4a: 收集证据

**核心原则：每读一个文件，立即落盘单文件证据，再读下一个。** 禁止把多个文件的洞察堆积在对话上下文里最后批量写入——会话压缩会丢失这些洞察。

#### 两类证据

| 类型 | scope | 写入时机 | 示例 |
|------|-------|---------|------|
| **单文件证据** | `file` | 读完该文件**立即写** | "gateway.ts 实现 7 层认证链" |
| **跨文件综合证据** | `cross` | 读完相关文件群**后写** | "gateway→router→cache 三层协作实现请求生命周期，gateway 负责认证/限流，router 负责分发，cache 负责幂等" |

单文件证据保证"读一个保一个"，跨文件证据保证"架构级洞察不丢"。两者都写入 evidence-log.jsonl，用 `scope` 字段区分。

#### 执行流程

```
# Phase 1: 逐文件收集单文件证据
for each 研究目标文件:
  1. 从 directory-tree.json 定位文件路径
  2. Read 文件内容
  3. 提取 key_findings（数量按文件类型分级，见格式规范表）
  4. 立即追加一行到 artifacts/evidence-log.jsonl（scope: "file"）  ← 强制
  ← 然后才能读下一个文件

# Phase 2: 综合跨文件洞察
for each 跨文件研究问题（如"请求生命周期"）:
  1. 回顾 Phase 1 收集的相关单文件证据
  2. 提炼跨文件综合洞察（至少 2 条）
  3. 追加一行到 artifacts/evidence-log.jsonl（scope: "cross", file: "cross:gateway+router+cache"）
```

#### 强制规则

- **单文件证据：读完一个文件立即写一行**。不是读完所有文件后批量写，是逐文件写。
- `key_findings` 必须是**研究洞察**（"7 层认证链违反单一职责但换取原子性"），不是文件摘要（"这个文件 1960 行实现了认证"）。
- `key_findings` 数量按文件类型分级（见 [格式规范-数量分级表](#key_findings-数量分级按文件类型)）。洞察不足时跳过该文件不写日志，不要硬凑。
- 证据强度 S/A/B/C/D/E 必须标注（S=可执行行为/测试，A=源码实现，B=配置，C=文档，D=commit/issue，E=推断）。

#### 重读文件的规则

**同一个文件可以被多次阅读**——研究是多轮的，Round 1 可能看认证，Round 2 可能看缓存策略，同一个 gateway.ts 两次阅读的 `purpose` 不同。

- 代码没变时：如果新 round 的 `purpose` 与已有有效条目的 `purpose` 相同 → 复用旧条目，不重读
- 代码没变时：如果新 round 的 `purpose` 不同（新研究角度）→ 重读文件，追加**新条目**（新 `id`，`replaces: null`），不修改旧条目
- 代码变了时：重读文件，新条目 `replaces` 旧条目 ID（旧条目不改，Stage 5 通过 `replaces` 计算有效性）

#### 恢复时的行为

代码没变时恢复研究：
1. 读取 `artifacts/evidence-log.jsonl` 全部内容
2. 计算有效条目：排除所有被 `replaces` 引用的旧条目
3. 对于已有有效条目且 `purpose` 匹配的文件 → 直接复用，不重读
4. 对于新 round 需要新 `purpose` 的文件 → 重读并追加新条目
5. 只读 evidence-log 里没有的新文件（新路径）

### 4b: 构建/更新仓库模型

- 首次：全量构建 6 个方面的模型
- 后续：只更新受影响的部分

#### Model ↔ Evidence 引用关系

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

**同步规则**：

- Stage 4b 构建/更新 Model 时，每个实体/关系的 `evidence_ids` 必须指向 evidence-log 中**当前有效**的条目（未被 `replaces` 取代）
- 如果某条 evidence 被 `replaces` 取代，Stage 4b 必须更新引用该 evidence_id 的 Model 实体——要么指向新 evidence ID，要么标注 `evidence_stale: true` 等待重新验证
- Stage 5 写报告时，如果发现 Model 实体的 `evidence_ids` 全部失效，该实体的结论标注为"待重新验证"，不进入报告正文

### 4c: 架构解释
- 基于模型重建系统背后的工程思想
- 每个解释必须引用证据
- 产出：工程约束、架构作用力、设计决策、权衡、省略、张力、杠杆点

### 4d: 质疑模型
- 对每个关键结论做移除测试、假设翻转、边界测试、时间测试
- 记录到 `challenge_record`
- 强制：每项 key_assumptions 必须至少被质疑一次

### 4e: 收敛问题
- 本轮问题是否需要下一轮追问（比如追问层数不够、没覆盖到的意外发现）
- 更新 `summary.json` 中的统计计数（answered/validated 按轮次记录）
- 更新 `context.coverage` 评分
- **禁止**修改 `round-N.json` 中的任何字段

### 更新 context.resume

每个子阶段做完后更新 `context.resume.last_completed_stage`：
```
4a → "Stage 4a"
4b → "Stage 4b"
4c → "Stage 4c"
4d → "Stage 4d"
4e → "Stage 4e"
```

---

## 阶段 5 — 写报告

从 **repository-model.json + context.json + artifacts/evidence-log.jsonl** 生成人类可读的中文报告。

**输入来源（缺一不可）**：

| 来源 | 提供什么 |
|------|---------|
| `repository-model.json` | 实体、关系、架构事实（含 `evidence_ids` 引用） |
| `context.json` → `architecture_model` | center_hypothesis、key_assumptions、invariants、competing_interpretations |
| `context.json` → `challenge_record` | 质疑记录、反证、挑战结果 |
| `context.json` → `design_space` | 每个决策的被选方案、被拒绝方案及理由 |
| `context.json` → `maintainer_view` | 修改影响图、复杂度驱动因素 |
| `artifacts/evidence-log.jsonl` | 每个文件的关键洞察（只读有效条目——排除被 `replaces` 取代的） |
| `questions/round-*.json` + `summary.json` | 研究轨迹：问了什么问题、回答了什么、验证了什么。报告如需展示追问路径则从此读取 |

**禁止在此阶段新增推理**——Interpretation/Alternative/Challenge/Conclusion 必须来自 Stage 4 已经得到的推理链。Stage 5 只做"组织"：把已有的推理链按叙事弧线排列、去重、补过渡。**禁止**发明新结论。**禁止**从对话上下文回忆证据——所有证据必须从上述文件读取。

### 核心约束：六步推理

每个非平凡结论必须展开为完整推理链，**禁止折叠为单句结论**：

```
[Observation] → [Evidence] → [Interpretation] → [Alternative] → [Challenge] → [Conclusion]
```

报告不是总结，是研究论文。详见 [report-schema.md](./report-schema.md#核心原则six-step-reasoning六步推理)。

### 必需章节

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

每个章节要标注了解程度评级。每个结论要标注证据强度。

详见 [report-schema.md](./report-schema.md#evidence-strength结论可信度)。

### 输出

1. **报告必须写入工作目录的 `report.md` 文件** — 禁止只在对话中输出而不落盘。报告生成后，必须使用文件写入工具将完整内容保存到 `.working/{repo-name}/report.md`。
2. `context.resume.last_completed_stage` = "Stage 5"
3. `context.resume.next_stage` = "done"
4. 更新 `meta.json` 的 `analyzed_at` 时间戳

---

## 质量检查

### 进入报告阶段的条件

收敛条件已在 [Stage 3](#阶段-3--决定下一步研究什么) 定义。Stage 3 Planner 判定"收敛了"后才能进入 Stage 5。此处不再重复定义收敛条件，仅补充报告生成后的质量验证。

**前置条件**（Stage 3 已检查，Stage 5 入口处二次确认）：

- `architecture_model.center_hypothesis` 非空
- `quality_gate` 全部为 `true`

### 自查清单

质量检查通过 `gated-checks.mjs` 调用 LLM 来判断。每项检查对应一个 LLM 提示，评估是否符合标准。

```bash
node gated-checks.mjs .trae/working/{repo-name}/context.json .trae/working/{repo-name}/report.md
```

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

### 最终检查

报告生成后，追加验证：

- 系统如何工作？
- 系统如何组织？
- 为什么做出这些架构决策？
- 哪些工程约束影响了设计？
- 架构如何演进？
- 有意牺牲了什么？
- 维护者如何心智划分系统？
- 哪些思想在本仓库之外仍有价值？
- **哪些替代方案被考虑过？为什么被拒绝？**
- **模型被挑战过几次？结果如何？**
- **哪些反证被寻找过？是否发现了反证？**

**如果任一问题无法回答，报告需要重写。**

---

## 产物

### 第一产物：仓库模型

仓库模型是核心产物，记录实体、关系以及支撑证据（详见 [report-schema.md](./report-schema.md#repository-model)）。保存到工作目录的 `repository-model.json`。

### 第二产物：报告

报告是仓库模型的可视化呈现，**必须用中文写**，覆盖以下信息（详见 [report-schema.md](./report-schema.md#报告信息维度)）：

- 系统如何工作
- 为什么这么设计
- 为什么不是别的方案
- 关键约束与决策
- 模型被质疑的结果
- 改某个东西会影响哪些层
- 可以复用的工程思想
- 意外发现
- 证据质量和没解决的问题

报告保存到工作目录的 `report.md`。增量分析时覆盖旧报告，但仓库模型保留历史证据（标记 `deprecated`）。

---

## 成功标准

一份成功的研究应该让有经验的工程师能回答：

- 这个仓库如何工作？
- 为什么这样设计？
- 哪些替代方案被考虑过？为什么被拒绝？
- 哪些结论被挑战过？挑战结果如何？
- 如果修改 X，影响哪些层？
- 我应该从中学到什么？
- 哪些思想值得复用？
- 哪些工程错误被有意避免？

**进阶标准**：

- 能用一句话说出系统的**架构中心**
- 如果把这个中心去掉，系统还能跑吗？
- 每个关键决策都能说出**至少一个被拒绝的替代方案**
- 报告的结论不是从源码"看"出来的，而是通过**提问 → 收集证据 → 质疑 → 修正**循环产生的
