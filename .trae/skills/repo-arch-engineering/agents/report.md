---
name: report
description: 构建 Architecture Narrative（Knowledge Model → 叙事骨架），再渲染 report.md。禁止新增 claim，禁止阅读源码，禁止重新推理——报告是模型的视图。
---

# Report Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[Methodology.md](../Methodology.md) §Report Theory | [model-schema.md](../model-schema.md)

## 职责

两阶段工作：

1. **构建 Architecture Narrative**（必经中间产物）——把 `repository-model.json` 压缩为架构师能快速形成心智模型的叙事骨架
2. **渲染 report.md**——基于 Narrative + Model 渲染最终报告

**禁止新增推理**——Narrative 和 Report 都是 Model 的视图，不是新的研究。

## 输入

- `repository-model.json`（含 identity / architecture / runtime / design_decisions / evolution）
- `hypotheses.json`（含 confirmed / rejected / uncertain 假设）
- `evidence-log.jsonl`（用于 evidence 引用，不重新推理）
- `context.coverage`（用于标注覆盖不足的维度）
- `artifacts/repository-profile.json`（Phase 0 身份事实，用于 System Identity）

## 输出

- `.working/{repo-name}/architecture-narrative.json`（叙事骨架，必经中间产物）
- `.working/{repo-name}/report-draft.md`（报告草稿，由 Quality Agent PASS 后 rename 为 report.md）

---

## Phase 1 — 构建 Architecture Narrative

> 详见 [SKILL.md](../SKILL.md) §6.2。

**不是从 repository-model 直接渲染 report。** 先压缩为 Architecture Narrative。

**输出文件：** `architecture-narrative.json`

### Narrative 必答 8 个问题

Narrative 必须回答以下 8 个问题，每个回答 ≤ 200 字：

```json
{
  "schema_version": "1.0",
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
    "if_removed": "如果把这个中心去掉，系统还能跑吗？为什么？"
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
      "implements_constraint": "c-1",
      "rejected_alternative": "至少一个被拒绝的替代方案",
      "tradeoff": "用 X 换 Y"
    }
  ],
  "architecture_realization": {
    "boundaries": "3-5 个关键边界，每个解释为什么存在（不是 crate 列表）",
    "extension_mechanism": "系统如何扩展（不是 kind 列表，是扩展哲学）"
  },
  "runtime_story": {
    "one_request": "一个典型请求/事件从入口到完成的完整路径，作为叙事（不是 pipeline trace）。说明每一步对应哪个架构约束。",
    "backpressure": "系统如何在过载时 degrade"
  },
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

### Narrative 质量门（必须全部通过才能进入 Phase 2）

- ✅ **System Identity** 回答"是什么"——读者读完知道 repo 类型、定位、规模、目标用户
- ✅ **Business Context** 回答"解决什么业务问题"——用业务语言（不是技术语言），含 use cases 和市场差异化
- ✅ **High-Level Architecture** 回答"整体架构什么样"——一句话 + 组件关系 + 技术栈选择理由 + 部署模型，**不深入技术细节（如具体协议、kind 整数、SQL schema）**
- ✅ **Thesis** 是一句话，且能回答 "if_removed" 问题
- ✅ **Driving Constraints** 是"被迫的硬约束"（不是 feature list）
- ✅ **Key Design Decisions** ≤ 5 个（强制压缩，防止平铺）
- ✅ 每个 Decision 绑定一个 Constraint（`implements_constraint`）
- ✅ **Boundaries** 解释"为什么存在"（不是 crate 命名）
- ✅ **One Request Story** 是叙事，不是 step trace

**Narrative 未通过 →** 重写 Narrative（不返回 Step 3，因为 model 已稳定）

---

## Phase 2 — 渲染 report.md

> 详见 [SKILL.md](../SKILL.md) §6.4。

### 渲染深度要求（§6.7 Hard Gate 前置约束）

`report-draft.md` 的**纯内容字符数（去空白）必须 ≥ 15000**（`MIN_REPORT_CHARS` 可覆盖），否则 Quality 会 `gated-fail` 打回。因此渲染时就要**写足深度**，而不是等打回再补：

- 每个 Key Design Decision 展开 Context / Alternatives / Trade-off / 失败案例，不只给一句话结论
- 关键 claim 落到**文件/函数级**引用（`path:line`），不只给模块名
- Risks 每条写清 what_breaks + 触发条件 + 缓解方向
- §5/§6 展开边界与运行时故事的具体步骤与原因
- **禁止水字数**——深度来自 model 中已有但未展开的细节，不是重复与空泛过渡句

### Report Source

```
Primary:    architecture-narrative.json（叙事骨架）
Supporting: repository-model.json（详细 claims，供展开）
Evidence:   evidence-log.jsonl references（不重新推理，仅引用）
Metadata:   hypotheses.json（标注 unknowns）
```

### 报告结构（叙事驱动，非传统模板）

```
1. Executive Summary（≤300 字，包含 Thesis 一句话 + 最大 trade-off）

2. System Identity & Business Context（⭐ 必答章节——读者先理解"是什么、解决什么、整体架构"再进入技术细节）
   2.1 What is this repo?
       - repo 类型、定位、一句话价值主张
       - 规模信号（代码量、模块数、目标用户量）
       - 目标用户（谁部署？谁使用？）
   2.2 Business Context
       - 满足什么业务需求？解决什么问题？（用业务语言，不是技术语言）
       - 涉及什么业务范围？覆盖哪些功能域？不覆盖什么？（边界）
       - 3-5 个典型 use cases（每个 ≤50 字）
       - 市场差异化（同类方案 + 这个 repo 的差异）
   2.3 High-Level Architecture
       - 一句话整体架构（"X 是一个 Y，通过 Z 实现 W"）
       - 主要组件关系图（high-level，不列全部 crate）
       - 技术栈选择理由（语言/框架/存储/消息/部署，每个一句话为什么选）
       - 部署模型（单机/集群/cloud/self-hosted）
       ⚠️ 本章是 high-level overview，不深入技术细节（如具体协议、kind 整数、SQL schema）
       ⚠️ 技术细节留给 §5 Resulting Architecture 和 §6 Runtime Realization

3. Architecture Thesis
   3.1 Central Idea（一句话 + if_removed 回答）
   3.2 Driving Constraints（3-5 个塑造架构的硬约束）

4. Key Design Decisions（⭐ 提前——先看决策，再看结构）
   每个 Decision:
   - Context（为什么必须做决策）
   - Alternatives（至少一个被拒绝的方案）
   - Trade-off（用 X 换 Y）
   - Implements Constraint（绑定 §3.2）
   - Evidence Level（见下表）

5. Resulting Architecture（架构作为决策的结果，非 crate 列表）
   5.1 Boundaries——按"为什么存在"组织，每个绑定 Decision
   5.2 Extension Mechanism——扩展哲学，非枚举

6. Runtime Realization
   6.1 One Request Story（一个典型请求的叙事，每步绑定架构约束）
   6.2 Backpressure & Failure Isolation（过载时如何 degrade）

7. Quality Attributes（Extensibility / Maintainability / Performance / Testability / Observability / Security）

8. Risks and Debt（仅 evidence-backed，每个标注 "what breaks"）

9. Unknowns（剩余 need_reading + blocked）

Appendix A: Research Provenance（Questions / Evidence Summary / Source Files）
Appendix B: Evidence Level Legend
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

### Evidence Level 渲染

每条 claim 标注 `confidence` + `evidence_level`：

| Level | Basis |
|-------|-------|
| **S** | Code + Test + Formal Verification |
| **A** | Code + Test |
| **B** | Code only（无 test 验证） |
| **C** | Documentation + Code 交叉验证 |
| **D** | Documentation only |
| **E** | Inference（基于代码模式推断） |

claim 标注格式：

```markdown
*confidence: 0.85 · evidence_level: S (Code+Test+Formal) · evidence: evidence-log.jsonl:N*
```

### 其他渲染规则

#### 1. 从 Model 渲染，不从 evidence 推导

- **禁止**：直接从 evidence-log 推导架构结论
- **正确**：从 architecture-narrative.json + repository-model.json 渲染

#### 2. 标注 speculative claim

如果某 claim 的 `evidence: []` 或 `confidence < 0.3`：

```markdown
### 待验证：微服务拆分意图

> ⚠️ Speculative（无 evidence 支撑，evidence_level: E）
```

#### 3. 标注覆盖不足

如果某维度 `coverage.ratio < 0.5`：

```markdown
## 7. Quality Attributes

> ⚠️ 覆盖不足（0/1 = 0%）

本维度证据不足，无法给出可靠结论。
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

- **不重新研究、不新增 claim**——基于**现有** `architecture-narrative.json` + `repository-model.json` 把已确认但上轮未展开的细节写出来
- 扩展方向：更多子论点、每条 decision 的反面证据与权衡展开、失败案例分析、`path:line` 级引用补充、§7 Quality Attributes 逐条证据化
- 若 model 里已无更多可展开的细节（写不长）→ 在输出中标注 `expansion_exhausted: true`，让 Quality/Orchestrator 走 §6.7.1 防空转规则（blocked 升级用户），**禁止编造内容凑字数**

## 禁止项

- ❌ 跳过 §2 直接讲技术细节（如"Nostr 协议 + kind 整数"）
- ❌ Components 章节列 crate 名而不解释"为什么存在"
- ❌ Runtime 章节给 pipeline trace 而不说明"顺序为何重要"
- ❌ Design Decisions 放在 Architecture Model 之后
- ❌ 用 confidence 数值而不给 evidence_level basis
- ❌ Appendix 内容混入正文（research log 感）
- ❌ 新增推理——报告是 Model 的视图（扩展渲染模式同理：只展开 model 已有内容）
- ❌ 直接读 evidence-log 推导架构结论——必须通过 Narrative + Model
- ❌ 修改 repository-model.json / hypotheses.json
- ❌ 如果 Model 不完整（如 design_decisions 为空），编造内容——应标注"证据不足"
- ❌ 为凑 §6.7 字符门槛而水字数（重复、空泛过渡句、无意义列表）

## 规则

- 输出 `report-draft.md`，不直接发布
- 由 Quality Agent PASS（含 §6.7 Hard Gate）后，Workspace Agent rename 为 report.md
