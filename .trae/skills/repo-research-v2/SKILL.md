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
- 如果上次至少完成了一轮完整研究（Stage 4）→ 进入规划阶段决定下一轮方向，不重新生成问题
- **禁止**在代码没变时重新执行阶段 1-2
- **禁止**在已经完成阶段 3 之后重新规划问题（除非规划器认为有必要）

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

**JSON Lines 格式**（每行一个 JSON 对象，append-only）。这是研究过程的"实验室笔记"，记录从每个文件提取的**实际洞察**，而非仅文件路径。

```json
{"id": "ev-001", "ts": "2026-07-30T14:23:01Z", "file": "server/gateway.ts", "purpose": "理解请求生命周期与认证链", "key_findings": ["1960 行单文件实现 7 层认证（origin→CORS→HMAC→API key→tier→entitlement→rate-limit）", "7 档缓存策略（fast/medium/slow/slow-browser/static/daily/no-store/live）", "ETag 用 FNV-1a 哈希", "POST→GET 兼容垫片用于 CDN 缓存"], "evidence_strength": "A", "related_questions": ["Q1", "Q3"], "coverage_delta": {"runtime": 0.3, "architecture": 0.2}}
```

**字段约束**：

| 字段 | 必填 | 内容 |
|------|------|------|
| `id` | 是 | 递增编号 `ev-001`, `ev-002`... |
| `ts` | 是 | ISO 8601 时间戳 |
| `file` | 是 | 相对仓库根的路径 |
| `purpose` | 是 | 为什么读这个文件（一句话，绑定到具体研究问题） |
| `key_findings` | 是 | **从该文件提取的关键洞察数组（至少 3 条）**。这是核心字段——不是文件摘要，是研究结论 |
| `evidence_strength` | 是 | S/A/B/C/D/E 分级（详见 report-schema.md Evidence Hierarchy） |
| `related_questions` | 否 | 关联的 round-N 问题 ID |
| `coverage_delta` | 否 | 本条证据对 6 维 coverage 的影响估算 |

**禁止行为**：

- ❌ `key_findings` 为空数组或只写"已读"
- ❌ `key_findings` 写成文件内容摘要而非研究洞察（错误示例："这个文件有 1960 行"；正确示例："单文件承载 7 层认证链，违反单一职责但换取了请求处理的原子性"）
- ❌ 批量读取多个文件后才写一条聚合日志——**每读一个文件写一行**
- ❌ 修改或删除已有行（append-only）
- ❌ 把证据只存在 `context.json.evidence_collected` 而不写日志文件

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
    Planner --> P1{评估覆盖度}
    P1 --> P2[找到最薄弱的地方]
    P2 --> P3[生成下一轮问题]
    P3 --> P4{至少做过一轮?}

    P4 -- 否 --> FullResearch
    P4 -- 是 --> P5[复用已有模型 + 追加研究]

    %% Research cycle
    subgraph FullResearch[阶段 4：完整研究]
        R1[收集证据]
        R2[构建/更新模型]
        R3[架构解释]
        R4[质疑模型]
        R5[收敛问题]
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
- 在此阶段识别仓库类型（类型应该缓存，只有代码变了而且置信度不高时才能重新识别）
- 在此阶段做架构解释

---

## 阶段 2 — 分析代码变化

**条件执行**。只有代码变了才需要执行。

1. `git diff {last_analyzed_commit}..HEAD` 找出改了什么文件
2. 按文件类型分类变化（新增/修改/删除）
3. 只重新生成受影响的产物
4. 没受影响的部分，禁止重新生成

产出：更新后的产物 + 最新分析的提交记录。

---

## 阶段 3 — 决定下一步研究什么

**只要研究没做完，每次都要经过这个阶段。**

决定**下一轮研究什么**，而不是继续生成 round-N 问题。

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
哪里了解最少？     → 上面 6 个方面里得分最低的
哪个假设没验证过？ → key_assumptions 中 challenged=false 的
哪个解释没被质疑过？ → challenge_record 缺少 counter_evidence 的
哪个模块还没看过？ → structure.modules 有但 evidence_collected 里没有的
下一轮应该研究什么？→ 一句话说清楚研究目标
```

### 规划规则

- 首次运行：生成 8-12 个至少追问一层为什么的问题，写入新创建的 `questions/round-1.json`
- 后续运行：基于最薄弱的方向生成 ≤5 个至少追问两层为什么的问题，**必须创建新的 `questions/round-(current_round+1).json`**，禁止追加到已有轮次
- 如果所有 6 个方面评分都 ≥ 0.8 而且所有质疑都挺住了 → 研究收敛，可以写报告了
- 禁止在同一方面重复生成同类问题
- 如果最薄弱的方向和上一轮一样 → 要求追问更深一层（追问层数+1），避免在原地打转

---

## 阶段 4 — 深入研究架构

执行规划器定好的下一轮研究目标。

### 4a: 收集证据

**核心原则：每读一个文件，立即落盘证据，再读下一个。** 禁止把多个文件的洞察堆积在对话上下文里最后批量写入——会话压缩会丢失这些洞察。

#### 执行流程（逐文件循环）

```
for each 研究目标文件:
  1. 从 directory-tree.json 定位文件路径
  2. Read 文件内容
  3. 提取 key_findings（至少 3 条研究洞察，非摘要）
  4. 立即追加一行到 artifacts/evidence-log.jsonl  ← 强制，禁止跳过
  5. 更新 context.evidence_collected 计数（仅在内存）
  ← 然后才能读下一个文件
```

#### 强制规则

- **每读一个文件，立即写一行 evidence-log.jsonl**。不是读完所有文件后批量写，是逐文件写。
- `key_findings` 必须是**研究洞察**（"7 层认证链违反单一职责但换取原子性"），不是文件摘要（"这个文件 1960 行实现了认证"）。
- `key_findings` 至少 3 条。少于 3 条说明没读懂或选错文件，重读或换文件。
- 已在 evidence-log.jsonl 中的文件，代码没变时禁止重读（直接复用日志里的 key_findings）。
- 证据强度 S/A/B/C/D/E 必须标注（S=可执行行为/测试，A=源码实现，B=配置，C=文档，D=commit/issue，E=推断）。

#### 恢复时的行为

代码没变时恢复研究：
1. 读取 `artifacts/evidence-log.jsonl` 全部内容
2. 已记录的文件不再重读——直接用日志里的 key_findings
3. 只读 evidence-log 里没有的新文件
4. 新读的文件追加新行到日志末尾

### 4b: 构建/更新仓库模型
- 首次：全量构建 6 个方面的模型
- 后续：只更新受影响的部分

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

从仓库模型 + evidence-log.jsonl 生成人类可读的中文报告。

**禁止**在此阶段做任何新的推理。**禁止**发明新结论。**禁止**从对话上下文回忆证据——所有证据必须从 `artifacts/evidence-log.jsonl` 读取。只把已验证的发现组织成连贯叙事。

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

进入阶段 5（写报告）前，以下条件**必须全部满足**：

1. `questions/summary.json` 中 `latest_round` ≥ 2（至少做过两轮问题）
2. context.json 的 `model_stability` ≠ `nascent`（模型必须被质疑过）
3. context.json 的 `architecture_model.center_hypothesis` 非空
4. context.json 的 `quality_gate` 全部为 `true`
5. `context.coverage` 中至少 4 个方面 ≥ 0.5

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
