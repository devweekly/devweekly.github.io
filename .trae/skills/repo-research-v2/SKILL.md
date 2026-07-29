---
name: "repo-research-v2"
description: "把 Repository 编译成架构知识库（Repository Model），并从 Model 渲染报告。当用户要求研究/分析某个仓库的架构、设计模式或工程实现时调用。"
---

# Repository 研究

> 相关文档：[methodology.md](./methodology.md)（研究方法论） | [question-framework.md](./question-framework.md)（问题生成与管理） | [report-schema.md](./report-schema.md)（Repository Model + 报告 Schema）

---

## 目标

编译目标：构建可复用的架构知识库（Repository Model）。

Repository Model 捕获实体、关系及支撑证据。报告是 Model 的视图。

---

## Resume Existing Analysis

**这是执行入口，优先于编译流程中的所有 Stage。**

如果工作目录存在，恢复已有研究状态而非从头开始。

### 恢复流程

1. **加载 context.json** — 恢复研究状态（current_round, model_stability, evidence_collected）
2. **加载 repository-model.json** — 恢复 Repository Model
3. **加载 meta.json** — 恢复元信息（repo_path, repo_type, last_analyzed_commit）
4. **加载 questions/summary.json** — 恢复问题进度（问题数量、已回答、已验证）
5. **按需加载已有 round-N.json** — 作为只读历史引用，禁止修改

### 判断 commit

- `git rev-parse HEAD` 与 `meta.last_analyzed_commit` 比较
- 非 Git 仓库 → 始终视为"已变化"

| commit 状态 | 行为 |
|------------|------|
| 未变化 | 禁止重新扫描、禁止重新识别类型、禁止重新统计目录 |
| 已变化 | `git diff` 识别受影响文件，仅更新受影响部分 |

### 恢复 Pipeline Position

读取 `context.resume` 恢复精确执行位置：

```json
{
  "last_completed_stage": "Stage 3",
  "next_stage": "Stage 4",
  "last_round": 2
}
```

- 直接跳转到 `next_stage`
- 禁止重新执行 `last_completed_stage` 已经完成且未失效的阶段
- 每个 Stage 完成时写入 `context.resume.last_completed_stage`

### 强制规则

- 如果 `context.resume.last_completed_stage` >= Stage 5（报告已生成）且 commit 未变化 → 直接返回已有报告
- 如果 `context.resume.last_completed_stage` >= Stage 4（至少完成一轮完整 Research）→ 进入 Research Planner 决定下一轮方向，而不是重新生成问题
- **禁止**在 commit 未变化时重新执行 Stage 1-2
- **禁止**在 `last_completed_stage >= Stage 3` 时重新规划问题（除非 Planner 判定需要）

---

## 输入

接受以下信息的任意子集：

- 源代码
- 文档 / ADR / RFC / README
- 配置 / 构建脚本
- 测试
- Git 历史
- 包元数据 / 指标

信息缺失时，优雅降级。

---

## 工作目录

每次分析使用一个持久化的工作目录，存放所有中间产物和最终报告。**禁止**将分析产物散落在仓库内部或临时目录。

### 目录结构

```
.working/{repo-name}/
├── artifacts/               # 稳定 Artifact（commit 未变化时禁止重新生成）
│   ├── repository-profile.json  # 仓库类型、语言、文件统计、入口点
│   ├── directory-tree.json      # 完整目录结构（扁平路径列表）
│   ├── symbol-index.json        # 符号索引（函数、类、导出）
│   ├── git-summary.json         # Git 历史分析
│   └── evidence-index.json      # 证据索引（已读文件路径 + 目的）
├── context.json             # 执行上下文（易变）
├── questions/               # 问题轮次（不可变历史）
│   ├── round-1.json         # 第一轮问题
│   ├── round-2.json         # 第二轮问题
│   ├── round-N.json         # 第 N 轮问题
│   └── summary.json         # 轮次索引
├── repository-model.json    # Repository Model（易变）
├── report.md                # 最新报告（易变）
└── meta.json                # 元信息
```

---

## Artifact Cache（Stable vs Volatile）

定义 Artifact 的稳定性契约。**这是恢复现场的基础。**

| 分类 | Artifact | 保存位置 | 更新规则 |
|------|----------|---------|---------|
| **Stable** | Repository Profile | `artifacts/repository-profile.json` | 仅 commit 变化时重新生成 |
| **Stable** | Directory Tree | `artifacts/directory-tree.json` | 仅 commit 变化时重新生成 |
| **Stable** | Symbol Index | `artifacts/symbol-index.json` | 仅 commit 变化时重新生成 |
| **Stable** | Git Summary | `artifacts/git-summary.json` | 仅 commit 变化时重新生成 |
| **Stable** | Evidence Index | `artifacts/evidence-index.json` | 仅 commit 变化时重新生成 |
| **Volatile** | Context | `context.json` | 每次分析重新创建 |
| **Volatile** | Repository Model | `repository-model.json` | 每次分析重新构建 |
| **Immutable** | Questions | `questions/round-N.json` | 创建后永久冻结，禁止修改 |
| **Mutable** | Summary | `questions/summary.json` | 唯一允许修改的 questions 产物 |
| **Volatile** | Report | `report.md` | 每次分析重新生成 |

**强制规则**：

- Stable Artifact：**commit 未变化时，禁止重新生成**。必须直接从 `artifacts/` 读取。
- Volatile Artifact：每次分析按需重新创建。不缓存。
- `meta.json` 中的 `last_analyzed_commit` 是判断依据。非 Git 仓库每次全量分析。

---

## Immutable Question History

问题轮次是追加式（append-only）历史，不可修改。

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

`round-1.json` 中的 `status` 字段（如果存在）是初始值，LLM 输出中的任何状态变更必须写入 `summary.json`，而非写入 round 文件。

### 执行历史可复现

每个 `round-N.json` 是执行历史的不可变快照。修改已有 round = 伪造历史。**禁止。**

### context.json

context.json 是研究者的**外部脑**。记录当前研究状态和执行位置。

```json
{
  "user_input": "用户原始输入，不转义",
  "resume": {
    "last_completed_stage": "Stage 4",
    "next_stage": "Stage 5",
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
    "architecture_invariants": ["不可违反的基本约束"],
    "unexplained_observations": ["当前模型无法解释的现象"],
    "competing_interpretations": []
  },
  "challenge_record": [...],
  "design_space": [...],
  "maintainer_view": {...},
  "evidence_collected": [...],
  "quality_gate": {...}
}
```

#### model_stability 状态机

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| `nascent` | 模型刚建立，尚未验证 | 完成 Phase 1 |
| `formative` | 模型在修正中 | 新证据改变模型 |
| `challenged` | 模型受到挑战，有备选解释 | Phase 2b 挑战阶段 |
| `stable` | 挑战未推翻，模型收敛 | 所有挑战 surviving |

**禁止**直接从 nascent 跳到 stable。模型必须被挑战过才能算稳定。

---

## 编译流程

```mermaid
flowchart TD
    Start[Start] --> R{Working Directory?}

    %% Resume
    R -- 否 --> Fresh[初始化工作目录 + meta.json]
    Fresh --> S0[Stage 0: Resume Workspace]
    S0 --> S1_1

    R -- 是 --> Resume["Stage 0: Resume Workspace
    — 加载 context.json
    — 加载 repository-model.json
    — 加载 meta.json
    — 加载 questions/summary.json"]
    Resume --> C{commit 变化?}

    C -- 否 --> CheckStage{resume.next_stage?}
    CheckStage --> |Stage 4+| Direct[已有研究进展]
    Direct --> Planner[Stage 3: Research Planner]
    CheckStage --> |Stage 3以下| Jump[恢复到 next_stage]
    Jump --> Planner

    C -- 是 --> S1[Stage 1: Scan Repository<br>— directory-tree.json<br>— repository-profile.json]
    S1 --> S2[Stage 2: Analyze Delta<br>— git diff<br>— 更新受影响 Stable Artifact]
    S2 --> Planner

    %% Planner
    Planner --> P1{coverage 评估}
    P1 --> P2[识别 coverage 最低维度]
    P2 --> P3[生成下一轮研究问题]
    P3 --> P4{至少完成一次?}

    P4 -- 否 --> FullResearch
    P4 -- 是 --> P5[返回已有 Model + 追加研究]

    %% Research cycle
    subgraph FullResearch[Stage 4: Architecture Research]
        R1[收集证据]
        R2[构建/更新 Model]
        R3[架构解释]
        R4[挑战 Model]
        R5[收敛问题]
        R1 --> R2 --> R3 --> R4 --> R5
    end

    subgraph P5[Stage 4: Incremental Research]
        I1[仅收集缺失证据]
        I2[更新 Model 受影响部分]
        I3[挑战新增结论]
        I1 --> I2 --> I3
    end

    FullResearch --> G{quality_gate?}
    P5 --> G
    G -- 未通过 → Planner
    G -- 通过 --> Report[Stage 5: 生成报告]
    Report --> Done[写入工作目录 + 更新 context.resume]
```

---

## Stage 0 — 恢复研究现场（Resume Workspace）

参见 [Resume Existing Analysis](#resume-existing-analysis) 节。

**执行入口**。加载已有研究状态，确定 `next_stage`，跳转到对应阶段。

**禁止**在此阶段执行扫描、分析或推理。

---

## Stage 1 — 扫描仓库（Scan Repository）

**条件执行**。仅当以下条件之一满足：

| 条件 | 行为 |
|------|------|
| commit 变化（diff 非空） | 全量或增量扫描取决于变化范围 |
| Stable Artifact 缺失 | 仅生成缺失的 Artifact |
| 非 Git 仓库 | 每次扫描 |

生成 Stable Artifact 并保存到 `artifacts/`：

| Artifact | 内容 |
|----------|------|
| `directory-tree.json` | 完整目录结构（文件路径列表、目录列表） |
| `repository-profile.json` | 仓库类型、语言分布、文件统计、入口点 |

### 禁止行为

- commit 未变化时重新扫描
- 在此阶段识别仓库类型（类型应缓存，仅 commit 变化且 confidence < high 时才重新识别）
- 在此阶段进行架构解释

---

## Stage 2 — 分析变化（Analyze Delta）

**条件执行**。仅当 commit 变化时执行。

1. `git diff {last_analyzed_commit}..HEAD` 识别受影响文件
2. 按文件类型分类变化（新增/修改/删除）
3. 仅重新生成受影响的 Stable Artifact
4. 未受影响 Artifact 禁止重新生成

产出：更新后的 Stable Artifact + `meta.last_analyzed_commit`。

---

## Stage 3 — 研究规划器（Research Planner）

**无论 commit 是否变化，只要研究未完成，每次运行都必须经过此阶段。**

Planner 决定**下一轮研究什么**，而不是继续生成 round-N 问题。

### 评估模型覆盖度

读取 `context.coverage`，识别 coverage 最低的维度：

| 维度 | 包含 | 默认值 |
|------|------|--------|
| `runtime` | 运行时架构、启动流程、请求生命周期 | 首次 0 |
| `architecture` | 模块组织、边界、分层、模式 | 首次 0 |
| `design_decisions` | 关键决策、替代方案、权衡 | 首次 0 |
| `testing` | 测试策略、覆盖率、质量保障 | 首次 0 |
| `deployment` | 构建、部署、CI/CD | 首次 0 |
| `history` | 演进历史、重大变化、技术债务 | 首次 0 |

### Planner 输出

回答以下问题，写入 `context.resume.next_research_focus`：

```
模型哪里最弱？     → coverage 最低的维度
哪个假设没验证？   → key_assumptions 中 challenged=false 的
哪个解释没有反证？ → challenge_record 缺少 counter_evidence 的
哪个模块没有覆盖？ → structure.modules 但 evidence_collected 不包含的
下一轮应该研究什么？→ 一句话的研究目标
```

### Planner 规则

- 首次运行：生成 8-12 个 depth≥1 的问题，写入新创建的 `questions/round-1.json`
- 后续运行：基于 coverage 最低维度生成 ≤5 个 depth≥2 的聚焦问题，**必须创建新的 `questions/round-(current_round+1).json`**，禁止追加到已有轮次
- 如果所有维度 coverage ≥ 0.8 且所有 challenges surviving → 研究收敛，可以进入报告
- 禁止在同一维度重复生成同类问题
- 如果 coverage 最低维度与上一轮相同 → 要求 deeper（depth+1），避免平面重复

---

## Stage 4 — 架构研究（Architecture Research）

执行 Planner 确定的下一轮研究目标。

### 4a: 收集证据
- 基于研究目标选择需要读取的文件
- 从 `directory-tree.json` 定位文件
- 读取文件内容（仅新文件或新增证据索引）
- 写入 `evidence_collected`

### 4b: 构建/更新 Repository Model
- 首次：全量构建 5 维模型
- 后续：仅更新受影响的维度

### 4c: 架构解释
- 基于模型重建系统背后的工程思想
- 每个解释必须引用证据
- 产出：工程约束、架构作用力、设计决策、权衡、省略、张力、杠杆点

### 4d: 挑战模型
- 对每个关键结论执行移除测试、假设翻转、边界测试、时间测试
- 记录到 `challenge_record`
- 强制：每项 key_assumptions 必须至少被挑战一次

### 4e: 收敛问题
- 本轮问题是否需要下一轮追问（如 depth 不足、未覆盖的 surprise）
- 更新 `summary.json` 中的统计计数（answered/validated 按轮次记录）
- 更新 `context.coverage` 评分
- **禁止**修改 `round-N.json` 中的任何字段

### 更新 context.resume

每个子阶段完成后更新 `context.resume.last_completed_stage`：
```
4a → "Stage 4a"
4b → "Stage 4b"
4c → "Stage 4c"
4d → "Stage 4d"
4e → "Stage 4e"
```

---

## Stage 5 — 报告生成（Report）

从 Repository Model 生成人类可读的中文报告。

**禁止**在此阶段执行推理。**禁止**发明新结论。只将已验证的发现组织成连贯叙事。

### 核心约束：Six-Step Reasoning

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
| 5 | Model Challenge | 六步推理链 + Evidence Strength |
| 6 | Maintainer Handbook | Extend / Debug / Migrate / Remove |
| 7 | Repository Tour | 阅读顺序 + 理由 |
| 8 | Unresolved Questions | coverage<0.5 领域 |

### 覆盖率标注

每个章节必须标注 Coverage 评级。每个结论必须标注 Evidence Strength。

详见 [report-schema.md](./report-schema.md#evidence-strength结论可信度)。

### 输出

1. 报告写入 `report.md`
2. `context.resume.last_completed_stage` = "Stage 5"
3. `context.resume.next_stage` = "done"

---

## 质量门禁

### 前置条件

进入 Stage 5（报告生成）前，以下条件**必须全部满足**：

1. `questions/summary.json` 中 `latest_round` ≥ 2（至少完成 2 轮问题）
2. context.json 的 `model_stability` ≠ `nascent`（模型必须被挑战过）
3. context.json 的 `architecture_model.center_hypothesis` 非空
4. context.json 的 `quality_gate` 全部为 `true`
5. `context.coverage` 中至少 4 个维度 ≥ 0.5

### 自查清单

质量门禁通过 `gated-checks.mjs` 执行 LLM 验证。每个门禁是一个 LLM 提示，评估是否满足特定标准。

```bash
node gated-checks.mjs .trae/working/{repo-name}/context.json .trae/working/{repo-name}/report.md
```

| 门禁 | 检查项 | 通过条件 |
|------|--------|---------|
| **center_identified** | 系统的架构中心是什么？ | 能用一句话回答 + 引用证据 |
| **alternatives_considered** | 每个关键决策都考虑了替代方案吗？ | design_space 中每项 rejected 非空 |
| **counterexamples_found** | 主动寻找过反证吗？ | challenge_record 非空 |
| **model_challenged** | 模型被挑战过吗？ | model_stability 曾经进入 challenged 状态 |

### 深度门禁

| 门禁 | 检查项 | 通过条件 |
|------|--------|---------|
| **depth_gate** | 研究达到了足够的"为什么"深度吗？ | 至少有一个 depth≥3 的问题 |
| **surprise_gate** | 意外发现被深挖了吗？ | 如果有 surprise，必须有对应的后续问题 |
| **design_space_gate** | 设计空间被探索了吗？ | design_space 非空，且每项有 rejected |
| **maintainer_gate** | 能回答"修改 X 影响哪些层"吗？ | maintainer_view.modification_impact_map 非空 |

**如果任一问题无法回答，编译尚未完成。**

### 最终质量门禁

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

## 输出

### 第一产物：Repository Model

Repository Model 是核心产物，捕获实体、关系及支撑证据（详见 [report-schema.md](./report-schema.md#repository-model)）。持久化到工作目录的 `repository-model.json`。

### 第二产物：报告

报告是 Repository Model 的视图，**必须使用中文撰写**，覆盖以下信息维度（详见 [report-schema.md](./report-schema.md#报告信息维度)）：

- 系统如何工作
- 为什么这样设计
- 为什么不是别的
- 关键约束与决策
- 模型挑战结果
- 修改影响地图
- 可复用思想
- 意外发现
- 证据质量与未解问题

报告持久化到工作目录的 `report.md`。增量分析时覆盖旧报告，但 Repository Model 保留历史证据（标记 `deprecated`）。

---

## 成功标准

一份成功的编译应让有经验的工程师能够回答：

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
- 如果移除中心，系统是否还能成立？
- 每个关键决策都能说出**至少一个被拒绝的替代方案**
- 报告的结论不是从源码"观察"到的，而是通过**提问 → 收集证据 → 挑战 → 修正**循环产生的
