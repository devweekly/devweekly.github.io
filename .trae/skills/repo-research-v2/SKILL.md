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
| **Volatile** | Questions | `questions/round-N.json` | 每次分析重新生成 |
| **Volatile** | Report | `report.md` | 每次分析重新生成 |

**强制规则**：

- Stable Artifact：**commit 未变化时，禁止重新生成**。必须直接从 `artifacts/` 读取。
- Volatile Artifact：每次分析按需重新创建。不缓存。
- `meta.json` 中的 `last_analyzed_commit` 是判断依据。非 Git 仓库每次全量分析。

---

### context.json

context.json 是研究者的**外部脑**。记录当前研究状态。

```json
{
  "user_input": "用户原始输入，不转义",
  "current_round": 2,
  "current_question_file": "questions/round-2.json",
  "model_stability": "formative",
  "question_statistics": {
    "rounds": 2,
    "total_questions": 57,
    "answered": 41,
    "validated": 18
  },
  "architecture_model": {
    "center_hypothesis": "最核心的架构假设（一句话）",
    "key_assumptions": [
      {
        "assumption": "系统依赖的某个关键假设",
        "evidence": ["server/gateway.ts:createDomainGateway"],
        "challenged": false,
        "survived_challenge": null
      }
    ],
    "architecture_invariants": ["不可违反的基本约束"],
    "unexplained_observations": ["当前模型无法解释的现象"],
    "competing_interpretations": []
  },
  "challenge_record": [
    {
      "target": "被挑战的结论",
      "challenge": "如果移除 X，系统还能成立吗？",
      "method": "寻找反证 | 替代方案比较 | 假设检验",
      "outcome": "survived | refuted | modified",
      "evidence": ["..."],
      "model_delta": "挑战后模型有何变化"
    }
  ],
  "design_space": [
    {
      "decision": "做出的技术决策",
      "chosen": "选择了什么",
      "rejected": ["被拒绝的方案"],
      "why_chosen": "为什么选这个",
      "why_rejected": "为什么拒接替代方案",
      "confidence": "high",
      "evidence": ["..."]
    }
  ],
  "maintainer_view": {
    "modification_impact_map": {
      "add_panel": ["src/config/panels.ts", "src/components/", "src/app/data-loader.ts"],
      "add_data_source": ["scripts/seed-*.mjs", "server/worldmonitor/", "api/"]
    },
    "complexity_drivers": ["驱动复杂度的根因"]
  },
  "evidence_collected": [
    {
      "path": "文件相对路径",
      "purpose": "读取目的",
      "key_findings": ["关键发现"],
      "surprises": ["意外发现"],
      "unanswered": ["阅读后仍存疑的问题"]
    }
  ],
  "quality_gate": {
    "center_identified": false,
    "alternatives_considered": false,
    "counterexamples_found": false,
    "model_challenged": false
  }
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
    Start[Start] --> A{Working Directory Exists?}

    %% Stage -1: Resume
    A -- 否 --> A1[创建工作目录 + 初始化 meta.json]
    A1 --> G[全量分析]
    A -- 是 --> B[Stage -1: 加载 meta.json + context.json]
    B --> C{commit 变化?}

    %% Commit unchanged — full resume
    C -- 否 --> D{所有 Stable Artifact 存在?}
    D -- 是 --> E[从 artifacts/ 加载 Stable Artifact]
    E --> F[禁止重新生成：scan / type / directory / dependency]
    F --> I[直接复用已有 Repository Model?]
    I -- 是且 report 存在 --> Return[返回已有报告]
    I -- 否 --> J[继续未完成研究]

    %% Commit changed — selective update
    C -- 是 --> H{Stable Artifact 全部存在?}
    H -- 是 --> H1[git diff 识别受影响文件]
    H1 --> H2[仅重新生成受影响的 Stable Artifact]
    H2 --> H3[更新 meta.last_analyzed_commit]
    H3 --> J
    H -- 否 --> H4[生成缺失的 Stable Artifact]
    H4 --> H3

    %% 全量分析路径
    G --> GR[Stage 0: 生成 Stable Artifact]
    GR --> GR1[repository-profile.json]
    GR1 --> GR2[directory-tree.json]
    GR2 --> GR3[symbol-index.json]
    GR3 --> GR4[git-summary.json]
    GR4 --> GR5[evidence-index.json]
    GR5 --> K

    %% 恢复后的统一路径
    J --> K{分析继续}

    K --> L[识别仓库类型]
    L --> M[生成研究问题 → questions/round-1.json]

    M --> N[Stage 1: 机械分析]
    N --> O[Stage 2: 仓库模型构建]
    O --> P{evidence sufficient?}
    P -- 否 --> Q[collect more evidence]
    Q --> N
    P -- 是 --> R

    subgraph R[Stage 3a: 架构解释]
        R1[Build architecture interpretation]
        R2[For each conclusion, ask "why not alternative?"]
        R3[Update design_space in context.json]
    end

    R --> S{Stage 3b: 挑战模型}
    S --> S1[Challenge center_hypothesis]
    S1 --> S2[Seek counterevidence for each conclusion]
    S2 --> S3{challenge_record updated?}
    S3 -- 每项至少一次 → T
    S3 -- 有未被挑战的结论 → S1

    T{Stage 3c: 第一轮收敛}
    T -- 所有 depth=1 已回答 --> U
    T -- 否 --> Q

    U{Stage 3d: 深度追问}
    U --> U1[生成 round-2 问题]
    U1 --> U2{有 depth≥3 的追问空间？}
    U2 -- 是 → U3[生成 depth≥3 问题]
    U2 -- 否 → V
    U3 --> V{quality_gate all passed?}
    V -- 否 → Q
    V -- 是 → W[Stage 4: 生成分析报告]
    W --> X[写入工作目录 + 更新 context.json]
```

---

## Stage -1 — 恢复研究现场（Resume Research）

**这是优先执行的阶段。** 在进入任何其他阶段之前，先判断是否能恢复已有研究。

### 执行流程

1. **检查工作目录是否存在**
   - 不存在 → 初始化工作目录 + meta.json，执行全量分析（进入 Stage 0）
   - 存在 → 继续

2. **加载 meta.json + context.json**
   - 读取 `last_analyzed_commit`、`repo_type`、`model_version`

3. **判断 commit 是否变化**
   - `git rev-parse HEAD` 与 `last_analyzed_commit` 比较
   - 非 Git 仓库 → 始终视为"已变化"

4. **分支一：commit 未变化**
   - 检查所有 Stable Artifact 是否存在
   - 全部存在 → 从 `artifacts/` 加载，**禁止重新扫描、重新识别类型、重新统计目录**
   - 缺失 → 生成缺失的 Stable Artifact，然后复用
   - 如果已有完整 report → 直接返回

5. **分支二：commit 已变化**
   - `git diff {last_analyzed_commit}..HEAD` 识别受影响文件
   - 仅重新生成受影响的 Stable Artifact
   - 未受影响 Artifact 必须复用
   - 更新 `last_analyzed_commit`

### 禁止行为
- commit 未变化时重新扫描全量目录结构
- commit 未变化时重新统计文件数量
- commit 未变化时重新识别仓库类型
- commit 未变化时重新生成 Stable Artifact
- 丢失已有 Stable Artifact 数据

---

## Stage 0 — Stable Artifact 生成（条件执行）

**仅当以下条件之一满足时执行：**

| 条件 | 行为 |
|------|------|
| Stage -1 判定需要全量分析 | 生成所有 Stable Artifact |
| Stage -1 判定部分 Stable Artifact 缺失 | 仅生成缺失的 |
| commit 变化且 Stable Artifact 受影响 | 仅重新生成受影响的 |

生成以下 Stable Artifact。**每个 Artifact 都是"生成一次，永久复用"（除非 commit 变化）。**

| Artifact | 内容 | 生成方法 |
|----------|------|---------|
| `repository-profile.json` | 仓库类型、语言、文件数量、入口点、构建系统 | LLM 识别 + 文件扫描 |
| `directory-tree.json` | 完整目录结构（扁平路径列表、文件/目录计数） | 文件系统遍历 |
| `symbol-index.json` | 关键符号（函数、类、导出） | AST 提取 |
| `git-summary.json` | Git 历史分析（提交频率、贡献者、重大变化边界） | git log |
| `evidence-index.json` | 已读文件的路径 + 读取目的索引 | 文件扫描 |

**禁止**在此阶段进行架构解释。只收集客观事实。

---

## Stage 1 — 问题生成

基于仓库类型和 Stable Artifact 生成研究问题。写入 `questions/round-1.json`。

详见 [question-framework.md](./question-framework.md)。

---

## Stage 2 — 机械分析

从 Stable Artifact 中提取证据，为仓库模型构建准备材料。

收集：目录结构、依赖图、import 图、package 图、符号、公共 API、Git 历史、文档、配置、指标。

**禁止**在此阶段进行架构解释。

---

## Stage 3a — 仓库模型构建

将机械证据转化为 Repository Model。

构建以下 5 个维度（详见 [report-schema.md](./report-schema.md#仓库模型)）：

| 模型 | 描述 |
|------|------|
| **结构模型** | 模块、目录、组件及其边界 |
| **行为模型** | 控制流、数据流、运行流程 |
| **归属模型** | 状态、职责、生命周期归属 |
| **扩展模型** | 插件机制、扩展点、公共 API |
| **演进模型** | 架构演进与历史变化 |

**禁止**在此阶段推断架构意图。

---

## Stage 3b — 架构解释

基于仓库模型重建系统背后的工程思想。

产出类型（详见 [report-schema.md](./report-schema.md#阶段-2-输出类型)）：

- 工程约束
- 架构作用力
- 设计决策
- 权衡
- 有意省略
- 架构张力
- 杠杆点
- 维护者心智模型

**每个解释必须引用证据。**

如果存在多个合理解释，分别说明并给出各自证据与置信度。

---

## Stage 3c — 挑战模型

**必须**对 Stage 3b 的每个结论执行以下检验：

| 检验 | 具体操作 | 判断标准 |
|------|---------|---------|
| **移除测试** | 如果移除这个组件/模式，系统还能成立吗？ | 能找到替代方案 → 非核心；找不到 → 架构中心 |
| **假设翻转** | 如果结论是相反的，哪些证据应该存在？实际存在吗？ | 反证存在 → 模型需修正 |
| **边界测试** | 这个结论在什么条件下不成立？ | 有明确边界 → 结论精确；无边界 → 结论过度泛化 |
| **时间测试** | 这个决策在最开始时也是最优的吗？ | 现在最优但初期次优 → 演进产物；一直最优 → 设计原则 |

每项检验的结果记录到 context.json 的 `challenge_record`。

**强制规则**：

- context.json 中 `architecture_model.key_assumptions` 的每一条**必须至少被挑战一次**
- 如果有 assumptions 的 `challenged=false`，**禁止**进入报告生成阶段
- 挑战时**必须寻找反证**（disconfirming evidence），而非只找支持证据
- 如果找到反证且证据强度 ≥ 挑战目标的证据强度，**必须修正模型**

---

## Stage 3d — 第一轮收敛

第一轮问题（questions.json）全部 `answered` 后，检查 depth 分布：

- 如果所有问题 depth_level 都是 1 → 研究停留在表面，**必须先追问 depth≥2 的问题**
- 如果有 depth≥2 的问题 → 可以进入下一阶段

同步更新 context.json 的 `research_progress` 计数。

---

## Stage 3e — 深度追问

基于第一轮回答生成第二轮收敛问题（questions-r2.json）。

**深度要求**：

- 至少有 1 个问题的 depth_level ≥3（"为什么不是别的"层级）
- 禁止问同层级同角度的问题
- 如果第一轮回答中出现了 surprise（意外发现），必须围绕 surprise 生成挑战性问题

如果仍有 depth≥3 的追问空间（即 answers 不够深入），**禁止进入报告生成阶段**。研究必须是收敛漏斗，不是扇形发散。

---

## Stage 4 — 分析报告生成

从 Repository Model 生成人类可读的中文报告。

**禁止**在此阶段执行推理。**禁止**发明新结论。

只将已验证的发现组织成连贯叙事。

报告生成后，**必须**保存到工作目录 `.trae/working/{repo-name}/report.md`。如果已有旧报告，直接覆盖。Repository Model（`repository-model.json`）保留历史证据（标记 `deprecated`），不删除。

---

## 增量分析

增量分析逻辑已由 Stage -1 和 Stage 0 的 Stable Artifact 契约处理。核心原则：

1. **commit 未变化** → 禁止重新生成任何 Stable Artifact。仅继续未完成的研究阶段。
2. **commit 已变化** → 基于 `git diff` 选择性重新生成受影响的 Stable Artifact。未受影响部分直接复用。
3. **非 Git 仓库** → 每次全量分析。

**禁止**在增量分析中丢失已有证据。新增证据合并，过时证据标记为 `deprecated` 但不删除。

---

## 质量门禁

### 前置条件

进入生成分析报告前，以下条件**必须全部满足**：

1. `questions/summary.json` 中 `latest_round` ≥ 2（至少完成 2 轮问题）
2. context.json 的 `model_stability` ≠ `nascent`（模型必须被挑战过）
3. context.json 的 `architecture_model.center_hypothesis` 非空
4. context.json 的 `quality_gate` 全部为 `true`
5. `questions/summary.json` 中状态为 `active` 的轮次无 open 问题

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
