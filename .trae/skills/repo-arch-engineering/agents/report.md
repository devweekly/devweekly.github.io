---
name: report
description: 构建 Architecture Insight（Knowledge Model → 洞察骨架），再按叙事规则渲染 report-draft.md 初稿。禁止新增 claim，禁止阅读源码，禁止重新推理——报告是模型的视图。初稿追求完整性与技术密度，可读性编辑由 Editor Agent 负责。
---

# Report Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[Methodology.md](../Methodology.md) §Report Theory | [model-schema.md](../model-schema.md)

## 职责

两阶段工作：

1. **构建 Architecture Insight**（必经中间产物）——把 `repository-model.json` 压缩为架构师能快速形成心智模型的**洞察骨架**（每个决策/边界/运行时环节回答「为什么 → 怎么做 → 代价 → 意味着什么」）
2. **渲染 report-draft.md 初稿**——基于 Insight + Model 渲染完整初稿，遵循 SKILL §6.4.1 叙事规则；**初稿优先完整性与技术密度，可读性编辑（导航/裁剪/密度/索引）由 Editor Agent 负责**

**禁止新增推理**——Insight 和 Report 都是 Model 的视图，不是新的研究。

## 输入

- `repository-model.json`（含 identity / architecture / runtime / design_decisions / evolution）
- `hypotheses.json`（含 confirmed / rejected / uncertain 假设）
- `evidence-log.jsonl`（用于 evidence 引用，不重新推理）
- `context.coverage`（用于标注覆盖不足的维度）
- `artifacts/repository-profile.json`（Phase 0 身份事实，用于 System Identity）

## 输出

- `.working/{repo-name}/architecture-insight.json`（洞察骨架，必经中间产物）
- `.working/{repo-name}/report-draft.md`（报告初稿；由 Editor Agent 编辑为 report-edited.md，Quality PASS 后 rename 为 report.md）

---

## Phase 1 — 构建 Architecture Insight

> 详见 [SKILL.md](../SKILL.md) §6.2。

**不是从 repository-model 直接渲染 report。** 先压缩为 Architecture Insight——不允许直接写报告。

**输出文件：** `architecture-insight.json`

### Insight 必答问题（六要素结构）

Insight 必须回答以下问题，每个回答 ≤ 200 字：

```json
{
  "schema_version": "2.0",
  "repo_name": "...",
  "system_identity": {
    "what_is": "这个 repo 是什么？一句话——类型、定位、一句话价值主张",
    "repo_type": "CLI / Library / Framework / Database / IDE / Application / Platform / Monorepo",
    "scale": "规模信号——代码量、模块数、目标用户量、目标吞吐量（如适用）",
    "target_users": "目标用户是谁？谁部署？谁使用？"
  },
  "business_context": {
    "needs_satisfied": "满足什么业务需求？解决什么问题？（用业务语言，不是技术语言）",
    "business_scope": "涉及什么业务范围？覆盖哪些功能域？不覆盖什么？（边界很重要）",
    "use_cases": ["3-5 个典型使用场景，每个 ≤50 字"],
    "alternatives_in_market": "市场上同类方案是什么？这个 repo 的差异化在哪？"
  },
  "high_level_architecture": {
    "one_sentence": "一句话整体架构——'X 是一个 Y，通过 Z 实现 W'（不深入技术细节）",
    "components_overview": "主要组件及其关系（≤150 字，high-level，不列全部 crate）",
    "tech_stack": "核心技术栈选择（语言/框架/存储/消息/部署），每个一句话说为什么选",
    "deployment_model": "如何部署？单机/集群/cloud/self-hosted？"
  },
  "thesis": {
    "central_idea": "一句话——系统的架构中心是什么？",
    "if_removed": "如果把这个中心去掉，系统还能跑吗？为什么？",
    "why_this_center": "为什么这个中心成立？（因果链：什么目标迫使它成为中心，不是定义句复述）"
  },
  "driving_constraints": [
    {
      "id": "c-1",
      "constraint": "塑造架构的硬约束（不是 feature，是被迫做出的约束）",
      "forces": "这个约束迫使系统做出什么决策？",
      "evidence_ref": "evidence-log.jsonl:N"
    }
  ],
  "key_design_decisions": [
    {
      "id": "d-1",
      "decision": "最关键的 5 个决策之一（从 repository-model.design_decisions 选 top 5）",
      "intent": "为什么做这个决策（Intent：要达成什么）",
      "mechanism": ["如何实现（Mechanism：具体机制/代码路径）"],
      "constraint": ["被什么限制（Constraint）"],
      "tradeoff": { "gain": "得到什么", "cost": "失去什么" },
      "evidence": ["ev-xxx（Evidence：哪里证明）"],
      "engineering_meaning": "对维护/演进意味着什么（Engineering Meaning）"
    }
  ],
  "architecture_realization": {
    "boundaries": [
      {
        "name": "边界名",
        "why_exists": "为什么存在（Intent）",
        "mechanism": "如何划界（Mechanism）",
        "tradeoff": "这个边界付出的代价",
        "engineering_meaning": "对维护意味着什么",
        "evidence_ref": "evidence-log.jsonl:N"
      }
    ],
    "extension_mechanism": {
      "philosophy": "系统如何扩展（扩展哲学，非枚举）",
      "engineering_meaning": "这套扩展机制对维护/新功能意味着什么"
    }
  },
  "runtime_story": {
    "one_request": {
      "story": "一个典型请求/事件从入口到完成的完整路径，作为叙事（不是 pipeline trace）。说明每一步对应哪个架构约束。",
      "engineering_meaning": "这个流程揭示了什么重要事实（如：优化发生在训练开始之前，而非训练之中）"
    },
    "backpressure": "系统如何在过载时 degrade"
  },
  "architecture_strengths": [
    {
      "id": "s-1",
      "strength": "基于证据的优势（非空泛评价）",
      "evidence_ref": "evidence-log.jsonl:N",
      "engineering_meaning": "这个优势对用户/维护者意味着什么"
    }
  ],
  "top_risks": [
    {
      "id": "r-1",
      "risk": "最大 trade-off / 风险",
      "what_breaks": "这个 risk 触发时什么会崩",
      "evidence_ref": "evidence-log.jsonl:N"
    }
  ]
}
```

### Insight 质量门（必须全部通过才能进入 Phase 2）

- ✅ **System Identity** 回答"是什么"——读者读完知道 repo 类型、定位、规模、目标用户
- ✅ **Business Context** 回答"解决什么业务问题"——用业务语言（不是技术语言），含 use cases 和市场差异化
- ✅ **High-Level Architecture** 回答"整体架构什么样"——一句话 + 组件关系 + 技术栈选择理由 + 部署模型，**不深入技术细节（如具体协议、kind 整数、SQL schema）**
- ✅ **Thesis** 是一句话，且能回答 "if_removed" 问题
- ✅ `thesis.why_this_center` 是**因果链**（为什么这个中心成立），不是定义句复述
- ✅ **Driving Constraints** 是"被迫的硬约束"（不是 feature list）
- ✅ **Key Design Decisions** ≤ 5 个（强制压缩，防止平铺）
- ✅ 每个 Decision 完整包含六要素：`intent` / `mechanism` / `constraint` / `tradeoff{gain,cost}` / `evidence` / `engineering_meaning`（缺失任一要素 → 视为未完成）
- ✅ `engineering_meaning` 回答"对维护/演进意味着什么"（不是结论复述）
- ✅ **Boundaries** 解释"为什么存在"（不是 crate 命名），且含 `why_exists` + `tradeoff` + `engineering_meaning`
- ✅ **One Request Story** 是叙事，不是 step trace，且含 `engineering_meaning`（这个流程揭示了什么）
- ✅ `architecture_strengths` 是**基于证据**的优势（非空泛评价），每项含 `engineering_meaning`

**Insight 未通过 →** 重写 Insight（不返回 Step 3，因为 model 已稳定）

---

## Phase 2 — 渲染 report-draft.md

> 详见 [SKILL.md](../SKILL.md) §6.4。

### 渲染深度要求（§6.8 Hard Gate 前置约束——初稿写足，编辑才有素材）

`report-draft.md` 是初稿，追求**完整性与技术密度**；最终 `report-edited.md` 的**纯内容字符数（去空白）必须 ≥ 12000**（`MIN_REPORT_CHARS` 可覆盖），否则 Quality 会 `gated-fail` 打回。因此渲染初稿时就要**写足深度**，而不是等打回再补：

- 每个 Key Design Decision 按六要素展开（intent / mechanism / constraint / tradeoff / evidence / engineering_meaning），不只给一句话结论
- 关键 claim 落到**文件/函数级**引用（`path:line`），不只给模块名
- §5/§7 展开边界与运行时故事的具体步骤与原因
- §10 Change Difficulty & Blast Radius 写清"改 X 会炸哪里"的具体耦合与影响范围
- 每章必须满足 §6.4.1 叙事规则：因果链开头、章节过渡句、观点段先于清单、术语人话解释、节末 Engineering Meaning、Evidence 收进 Box
- **禁止水字数**——深度来自 model 中已有但未展开的细节，不是重复与空泛过渡句

### Report Source

```
Primary:    architecture-insight.json（洞察骨架）
Supporting: repository-model.json（详细 claims，供展开）
Evidence:   evidence-log.jsonl references（不重新推理，仅引用）
Metadata:   hypotheses.json
```

### 报告结构（叙事驱动，非传统模板）

```
1. Executive Summary（≤300 字，包含 Thesis 一句话 + 最大 trade-off + 主要技术债务）

2. System Identity & Context（⭐ 必答章节——读者先理解"是什么、解决什么、整体架构"再进入技术细节）
   2.1 What is this repo?
       - repo 类型、定位、一句话价值主张
       - 规模信号（代码量、模块数、目标用户量）
       - 目标用户（谁部署？谁使用？）
   2.2 System Context（C4 Level 1：外部 Actor + 系统负责/不负责边界）
   2.3 Business Context
       - 满足什么业务需求？解决什么问题？（用业务语言，不是技术语言）
       - 涉及什么业务范围？覆盖哪些功能域？不覆盖什么？（边界）
       - 3-5 个典型 use cases（每个 ≤50 字）
       - 市场差异化（同类方案 + 这个 repo 的差异）
   2.4 High-Level Architecture
       - 一句话整体架构（"X 是一个 Y，通过 Z 实现 W"）
       - 主要组件关系图（high-level，不列全部 crate）
       - 技术栈选择理由（语言/框架/存储/消息/部署，每个一句话为什么选）
       - 部署模型（单机/集群/cloud/self-hosted）
       ⚠️ 本章是 high-level overview，不深入技术细节
       ⚠️ 技术细节留给 §5 Resulting Architecture 和 §7 Runtime Realization

3. Architecture Overview
   3.1 Architecture Style（显式识别风格：patch/decorator + facade + registry）
   3.2 Driving Constraints（c-1..c-5 塑造架构的硬约束，被 §4 决策引用）
   3.3 Central Idea（一句话 + if_removed 回答）
   3.4 If Removed
   3.5 Evolution Timeline（历史维度）

4. Key Design Decisions（⭐ 提前——先看决策，再看结构）
   每个 Decision 按六要素展开（对应 architecture-insight.json）:
   - Intent（为什么做这个决策）
   - Mechanism（如何实现——机制/代码路径）
   - Constraint（被什么限制，绑定 §3.2 c-N）
   - Trade-off（得到什么，失去什么）
   - Evidence（收进节末 Evidence Box）
   - Engineering Meaning（对维护/演进意味着什么）

5. Resulting Architecture（架构作为决策的结果，非 crate 列表）
   5.1 Boundaries——按"为什么存在"组织，每个绑定 Decision
   5.2 Extension Mechanism——扩展哲学，非枚举

6. Data Architecture（数据模型 + 数据流 + 约束；量化/优化器状态/registry）

7. Runtime Realization
   7.1 One Request Story（典型微调请求叙事，每步绑定架构约束）
   7.2 Studio 请求流（Rust→uvicorn→Python 链路，进程/状态模型）
   7.3 Backpressure & Failure Isolation（过载/失败如何 degrade 与隔离）

8. Architecture Strengths（基于证据的优势，非空泛评价）

9. Architecture Risks（聚焦 Top 2-3，每项标注 what_breaks；p7.md §10 必含）

10. Change Difficulty & Blast Radius（改 X 会炸哪里）

11. Engineering Insights（工程哲学提炼，报告价值最高部分）
```

### §2 必答规则（最高优先级）

> **§2 是必答章节。** 跳过 §2 直接讲技术细节（如"Nostr 协议 + kind 整数"）是常见错误——读者不知道 repo 是什么、解决什么业务问题，就被拉入技术决策，会丢失主线。

- §2.1 必须回答"**这个 repo 是什么？**"——类型、定位、一句话价值主张、规模、目标用户
- §2.2 必须回答"**业务 context 是什么？**"——用业务语言（不是技术语言）描述满足什么业务需求、涉及什么业务范围
- §2.3 必须回答"**整体架构和工程框架是什么？**"——high-level overview，**不深入技术细节**
- §2 用业务语言和 high-level 架构建立读者心智模型，§3+ 才进入技术深度

**反例（禁止）：**

```
§2 直接讲 "Buzz 是一个基于 Nostr 协议的实时音频中继，使用 kind:35 整数作为分发开关..."
```

读者还不知道 Buzz 解决什么业务问题、整体架构什么样，就被拉入 Nostr 协议细节。

**正例：**

```
§2.1 Buzz 是一个自部署的实时语音社区服务器，让小规模社区在自己的基础设施上运行语音房间。
§2.2 满足"社区自有、低延迟、无需依赖第三方平台"的语音沟通需求...
§2.3 整体架构：Buzz 是一个单进程多协议服务器，通过 Nostr 中继 + WebSocket 音频桥 实现...
```

### Evidence Level 渲染（Evidence Box，不混正文）

> 定义权威见 [SKILL.md](../SKILL.md) §6.5；下表为执行速查（Level 含义与 Evidence Box 展示）：

每条 claim 标注 `confidence` + `evidence_level`：

| Level | Basis |
|-------|-------|
| **S** | Code + Test + Formal Verification |
| **A** | Code + Test |
| **B** | Code only（无 test 验证） |
| **C** | Documentation + Code 交叉验证 |
| **D** | Documentation only |
| **E** | Inference（基于代码模式推断） |

**展示方式：** 正文保持流畅，每章/节**结尾**用引用块汇总该节证据（Evidence Box）：

```markdown
> **Evidence**
> - Confidence: 0.85 · Level: S（Code + Test + Formal）
> - Sources: evidence-log.jsonl:42, evidence-log.jsonl:57
```

- ❌ 正文**禁止**内嵌 `（confidence: X · evidence_level: Y · evidence: ev-xxx）`——机器可读性由 Evidence Box 提供，正文只承担可读性
- Evidence Box 可合并（一节一个 Box 汇总本节所有 claim），可分级（`A-level: ev-005, ev-007` + `Confidence: High`）
- 组合标注（如 A/D 表示由 A 级和 D 级证据共同支撑）在 Box 内注明
- `ev-xxx` 引用与 `confidence` 数值必须完整保留——机器可消费性不丢失

### 叙事渲染规则（p8.md：报告是给工程师读的文章）

> 目标是「资深架构师写给另一个工程师的分析文档」，不是「带引用元数据的 AI 生成答案」。规则详见 [SKILL.md](../SKILL.md) §6.4.1，要点如下：

1. **三层结构**：每个 §4-§7 子节 = Story（为什么）→ Detail（怎么做）→ Evidence（哪里证明）
2. **因果链开头**：禁止定义句开篇，先给"为了……因此……"的因果链
3. **章节过渡句**：每章结尾一句承上启下
4. **观点段先于清单**：先给判断+理由的观点段，再展开证据
5. **术语人话解释**：技术名词首次出现给"简单来说"
6. **节末 Engineering Meaning**：每节结尾回答"所以意味着什么"

示例（正确 vs 错误）：

```markdown
❌ Unsloth 的架构中心是 import-time monkey-patch。（confidence: 0.95 · evidence_level: A · evidence: ev-005）

✅ Unsloth 的核心目标不是重新设计训练框架，而是在不破坏 HF 生态兼容性的前提下替换慢路径。
   因此它没有创建新 Model API，而选择在 import 阶段介入 transformers/peft/trl……
   （节末）> **Evidence** > - Confidence: 0.95 · Level: A > - Sources: ev-005
```

### 其他渲染规则

#### 1. 从 Model 渲染，不从 evidence 推导

- **禁止**：直接从 evidence-log 推导架构结论
- **正确**：从 architecture-insight.json + repository-model.json 渲染

#### 2. 标注 speculative claim

如果某 claim 的 `evidence: []` 或 `confidence < 0.3`：

```markdown
### 待验证：微服务拆分意图

> ⚠️ Speculative（无 evidence 支撑，Evidence Level: E）
> **Evidence**
> - Confidence: 0.2 · Level: E（Inference）
> - Sources: 无（推测）
```

#### 3. 标注覆盖不足

如果某维度 `coverage.ratio < 0.5`：

```markdown
## 10. Change Difficulty & Blast Radius

> ⚠️ 覆盖不足（0/1 = 0%）

本维度证据不足，无法给出可靠结论。

> **Evidence**
> - 该维度暂无证据支撑（coverage 0/1 = 0%）
```

#### 4. 呈现假设状态

```markdown
### 假设：OSGi 运行时隔离

- Status: Confirmed
- Confidence: 0.85
- Evidence Level: A (Code + Test)
- Supporting: [ev-007, ev-012]
- Counter: 无
- Falsification criteria: 如果假设错，我们会看到 plugin 直接编译时绑定
```

---

## 扩展渲染模式（gated-fail step5 路由）

当 Orchestrator 因 Quality `gated-fail` 且 `gate_failed_route = "step5"` 重新调用本 Agent 时（知识已稳、只是渲染没写足）：

- **不重新研究、不新增 claim**——基于**现有** `architecture-insight.json` + `repository-model.json` 把已确认但上轮未展开的细节写出来
- 扩展方向：更多子论点、每条 decision 的六要素展开（intent/mechanism/constraint/tradeoff/engineering_meaning）、反面证据与权衡展开、失败案例分析、`path:line` 级引用补充、§10 Change Difficulty & Blast Radius 逐条耦合展开、补全每节的 Engineering Meaning 与 Evidence Box
- 若 model 里已无更多可展开的细节（写不长）→ 在输出中标注 `expansion_exhausted: true`，让 Quality/Orchestrator 走 §6.8.1 防空转规则（blocked 升级用户），**禁止编造内容凑字数**

## 禁止项

- ❌ 跳过 §2 直接讲技术细节（如"Nostr 协议 + kind 整数"）
- ❌ Components 章节列 crate 名而不解释"为什么存在"
- ❌ Runtime 章节给 pipeline trace 而不说明"顺序为何重要"
- ❌ Design Decisions 放在 Architecture Model 之后
- ❌ 用 confidence 数值而不给 evidence_level basis
- ❌ Appendix 内容混入正文（research log 感）
- ❌ 正文内嵌 `（confidence: X · evidence_level: Y · evidence: ev-xxx）` 标注——Evidence 必须收进章节结尾的 Evidence Box
- ❌ 以定义句开篇而不给因果链（"架构中心 = xxx" 必须先回答"为什么这个中心成立"）
- ❌ 章节间无过渡、突兀跳跃（每章必须有一句承上启下）
- ❌ checklist 式罗列替代观点段（先观点后证据）
- ❌ 技术术语首现不解释（"简单来说"人话层缺失）
- ❌ 章节结尾缺 Engineering Meaning（"所以意味着什么"缺失）
- ❌ 新增推理——报告是 Model 的视图（扩展渲染模式同理：只展开 model 已有内容）
- ❌ 直接读 evidence-log 推导架构结论——必须通过 Insight + Model
- ❌ 修改 repository-model.json / hypotheses.json
- ❌ 如果 Model 不完整（如 design_decisions 为空），编造内容——应标注"证据不足"
- ❌ 为凑 §6.8 字符门槛而水字数（重复、空泛过渡句、无意义列表）

## 规则

- 输出 `report-draft.md`，不直接发布
- 由 Editor Agent 编辑为 `report-edited.md`，Quality Agent PASS（含 §6.8 Hard Gate）后，Workspace Agent rename 为 report.md
