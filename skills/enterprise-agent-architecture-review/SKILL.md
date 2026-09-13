---
name: enterprise-agent-architecture-review
version: 1.0.0
description: 审查企业级 Agent / AI 平台的架构决策，而不是检查技术组件。从 Business Problem、Context、Constraints 开始，逐步收敛到「是否需要 AI、最低能力档位、哪些步骤必须确定性、autonomy 边界在哪、责任归谁、风险由谁接受」。用于评审 Agent Platform、Cortex Agents、AgentCore、自建 Agent 或第三方 Agent 平台的设计稿、ADR、方案文档。触发词：架构评审、architecture review、Agent 架构、AI 平台评审、ADR 评审、design review、autonomy 边界、Buy vs Build。
---

# Enterprise Agent Architecture Review

## Goal

产出一份能进 Architecture Board 的评审结论：**这个架构是否值得继续评审、边界划在哪、谁承担后果**。

核心原则：

> **Architecture review 不能从技术组件开始，而应该从 Business Problem + Context + Constraints 开始。**

因此本 skill 的失败模式不是「漏了某个控制点」，而是**在问题本身还没定义清楚时开始比较框架与选型**。

## 何时用 / 不适用

| 用 | 不用 |
| --- | --- |
| 新 Agent 用例的架构评审（Discovery / Design 阶段） | 已有系统的实现取证（用 `agent-well-architected-assessment`） |
| 评审 ADR、目标架构文档、平台选型方案 | 单点安全评估（用 `agent-security-threat-review`） |
| 判断「该不该上 Agent」「该不该自建 Runtime」 | 具体 Tool 准入（用 `agent-tool-and-mcp-governance`） |
| Agent 平台的一次重大架构变更 | 纯性能 / 成本优化（直接看 checklist J 节） |

## 输入

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| 用例描述 / 业务问题陈述 | ✅ | 没有就停在 Step 0，不要往下走 |
| 目标架构图或组件清单 | ✅ | 用来核对边界，不作为起点 |
| ADR / 方案文档 / PoC 结论 | 建议 | 缺失时在输出里标 `Assumption` |
| 约束清单（监管、数据驻留、既有平台、合同） | ✅ | 硬约束必须逐条确认 |
| 相关风险登记册条目 | 可选 | 用于对接受影响方 |

## 十二步流程

每一步都给出**问什么**、**判据**、**产物**。前 3 步没过，不要进入第 4 步之后。

### Step 0 — 问题是否成立

- 问：这份材料回答的是「我们在解决什么问题」，还是「我们打算用什么技术」？
- 判据：能一句话复述业务问题与受影响角色。
- 产物：评审前置页（问题陈述 + 受影响方）。
- **如果材料从组件清单开始，直接退回，不进入 Step 1。**

### Step 1 — 业务问题与可验证结果（Q001–Q003）

- 问：核心业务问题？目标用户与业务角色？期望的业务结果与可验证 KPI / Outcome？不做的损失？
- 判据：业务结果有基线值、目标值、观测口径、责任业务方；「不做」的损失可量化（人力 / 时长 / 差错 / 监管敞口）。
- 反模式：只列平台指标（调用量、准确率、并发）；只写用户画像而无痛点证据。
- 产物：业务结果表（结果 → 基线 → 目标 → 口径 → owner）。

### Step 2 — 范围与约束（Q004–Q006）

- 问：In / Out of Scope？隐含需求由谁裁决？组织 / 人力 / 预算 / 时间 / 采购 / 供应商 / 企业标准哪些是硬约束？是否有数据驻留、跨境、制裁、出口管制、监管辖区约束？
- 判据：Out of Scope 非空且写明裁决人；每条约束写清来源与可否改变；每条地缘约束映射到具体设计落点。
- 反模式：把偏好写成硬约束；把 Out of Scope 留空；地缘约束只在风险清单打勾。
- 产物：约束表 + 边界图（哪些设计被约束锁死）。

### Step 3 — 为什么不是现状、不是替代方案（Q007–Q010）

- 问：现有系统 / 流程 / 平台为什么解决不了？评估过「不做、改造现有、购买现成」吗？Buy / Reuse / Extend / Build 的差异？哪些决策不可逆、用什么 PoC 验证？重大变化时怎么迁移 / 退出？
- 判据：每个替代方案写明不选的具体理由与证据；四路径并列比较且含 Do Nothing 一列；不可逆决策有验证假设与退出判据；退出路径有触发条件、责任人、时间窗。
- 反模式：「能力不足」「不够智能」「更灵活」这类无证据判断；只比价格；只写「可替换」。
- 产物：Alternatives & Trade-offs 表 + 不可逆决策清单（含验证计划）。

### Step 4 — 是否真的需要 AI，最低档位是什么（Q011–Q013）

- 问：确定性流程能不能解决？差距是什么？需求来自数据规模、非结构化、预测、生成、搜索、推理还是开放式任务？最低够用档位（传统 ML / LLM / RAG / Agent）？
- 判据：差距写成可观测指标；有不含 AI 的基线对照；逐档写明能力边界与失败样例。
- 反模式：默认选最高档（Agent）而无对照；「需要 AI」而无归因。
- 产物：能力档位对照表（档位 → 覆盖范围 → 失败样例 → 结论）。

### Step 5 — 确定性 / 概率性边界（Q014、Q018、Q022）

- 问：每个步骤哪些行为必须 deterministic？规则性任务（BPMN / Rules / DMN）与 Agent 任务的分界线在哪？哪些业务状态必须由状态机持有？
- 判据：边界写成可判定规则；probabilistic 步骤有校验与兜底；业务状态有清单与持有方，且给出 Agent 无法改写的验证方式。
- 反模式：只笼统标「AI 部分」；让 Agent 自己决定业务状态。
- 产物：Task Allocation 表（步骤 → 确定性 / 概率性 → 持有方 → 兜底）。

### Step 6 — autonomy 必要性与边界（Q015–Q017、Q020）

- 问：为什么需要 autonomy，而不是把 AI 当作确定性流程里的受控步骤？允许自主规划 / 重规划 / 选工具 / 委派子任务吗？每一项的必要性？能力能否收在最小必要范围？
- 判据：以「受控步骤」方案作对照并给出其失败场景；**每项 autonomy 单独列出**并各自对应业务场景与失败影响；扩权有独立评审与影响评估。
- 反模式：打包写「允许自主」；把 autonomy 当作能力而不是风险。
- 产物：Autonomy Register（能力 → 场景 → 失败影响 → 上限 → 复核日）。

### Step 7 — 运行模式与责任边界（Q019）

- 问：Agent 是在辅助人决策、准备决策材料，还是执行决策？不同模式的责任边界？
- 判据：per 模式写清谁签字、谁承担后果、留什么证据。
- 反模式：模式含糊或多种混用而无边界。
- 产物：Run Mode 声明 + 责任矩阵。

### Step 8 — 职责边界与 Owner（Q021、Q023–Q026）

- 问：Business Process / Agent Runtime / Enterprise Control Plane 的边界？交互面是什么 typed contract？Business / Risk / Technical Owner 各是谁？Agent 的职责、权限、适用范围、禁止行为、责任边界？
- 判据：职责矩阵无重叠；契约有 schema、版本与错误语义；三类 owner 分别**指名到人**，Risk owner 独立于交付方且有权叫停；五项定义写进受控文档并绑定版本。
- 反模式：只挂团队名；同一人兼任业务与技术；边界靠口头约定；用非结构化文本交互。
- 产物：职责矩阵 + Owner 表 + 交互契约清单。

### Step 9 — Trust Boundary 与控制域归属（Q039）

- 问：Agent / Tool / Memory / Knowledge / Model Provider / Runtime 之间的边界在哪？每条边界上谁做决定？
- 判据：每条边界写明信任假设、越界检测、控制落点与 owner。完整威胁建模转 `agent-security-threat-review`。
- 产物：Trust Boundary 图（一张），每条边界一行控制归属。

### Step 10 — 风险分级与人工权威（Q027–Q029）

- 问：风险分级如何决定 autonomy、审批、日志与证据要求？高风险 / 受监管决策的 HITL / HOTL 配置？能否证明最终责任仍在人与授权机构？
- 判据：分级逐档对应控制强度；审批有触发条件、审批人、超时行为、回避规则；有责任承接清单与签署证据。
- 反模式：分级存在但不驱动控制；所有场景统一「人工确认」；只写「由人兜底」。
- 产物：风险分级表（等级 → autonomy 上限 → 审批层级 → 证据要求）。

### Step 11 — 决策与例外留痕（Q030）

- 问：关键决策、例外批准、风险接受是否有 Decision Owner、授权来源、结论、到期复核日？
- 判据：per 决策四要素齐备。
- 反模式：口头同意、事后补记录。
- 产物：Decision Log（含例外与风险接受）。

### Step 12 — Gate 判定

| Gate | 触发时机 | 通过条件 | 不通过 |
| --- | --- | --- | --- |
| **Discovery Gate** | 进入详细设计前 | Step 1–4 的 P0 问题已答（Answered）或已登记为 Validated assumption / Validation required | 不允许开始选型与实现 |
| **Design Convergence** | 设计冻结前 | Trust Boundary、Runtime 边界、威胁模型收敛（配合 `agent-runtime-boundary-review`） | 不允许冻结设计 |
| **Production Gate** | 上生产前 | 风险分级、人工权威、审批与证据链有结论，残余风险有接受人 | 不允许上生产 |

三层 Gate 与 checklist 的 `INIT / DESIGN / PRE-PROD` 三个 Stage 对齐。

## 输出模板

```text
Enterprise Agent Architecture Review — <用例名>

1. 业务问题与结果          <一句话 + 结果表>
2. 范围与约束              <In / Out + 硬约束>
3. Alternatives            <四路径比较 + 不选理由 + 不可逆决策>
4. AI 必要性               <基线对照 + 最低档位>
5. 确定性 / 概率性边界      <Task Allocation 表>
6. Autonomy                <Autonomy Register + 上限>
7. 运行模式与责任          <模式 + 责任矩阵>
8. 职责边界与 Owner        <矩阵 + owner 到人>
9. Trust Boundary          <边界图 + 控制归属>
10. 风险分级与人工权威     <分级表 + HITL/HOTL 配置>
11. 决策与例外             <Decision Log>

Gate 结论：   Discovery  □ 通过  □ 有条件  □ 不通过
              Design     □ 通过  □ 有条件  □ 不通过
              Production □ 通过  □ 有条件  □ 不通过

必须随结论一起给出的三件事：
  · 未决项（谁在什么时间前补什么）
  · 残余风险与接受人
  · 不通过时的阻断范围（不允许做什么）
```

## 十条快速自检（评审开场用）

评审开始时先让团队现场回答，而不是看 PPT：

```text
1.  业务问题是什么？
2.  Agent 为什么适合这个问题？
3.  业务流程中哪些部分必须保持确定性？
4.  当前架构的 Context / Constraints 是什么？
5.  Buy vs Build 怎么判断？
6.  Agent 的 Trust Boundary 在哪里？
7.  Agent 能自主决定什么？
8.  哪些事情必须由确定性系统决定？
9.  数据、Tool、Model、Runtime 分别属于哪个控制域？
10. 如何审计、停止、恢复？
```

第 10 问的答案必须包含**不依赖 Agent 配合**的停止路径；否则无论前面答得多好，本轮评审都不能给通过。

## 反模式总表

| 反模式 | 为什么致命 | 正确做法 |
| --- | --- | --- |
| 从组件清单开始评审 | 会在错误的问题上做出正确的技术选择 | 退回 Step 0 |
| 用「更灵活 / 更智能」论证 autonomy | 无法评估失败影响 | 给出受控步骤方案的失败场景 |
| 把「不是 deterministic」等同于「需要 Agent」 | 跳过 ML / LLM / RAG 三档 | 逐档对照后再定 |
| 风险分级与审批强度脱钩 | 分级变成文档装饰 | 分级必须驱动控制档位 |
| 责任落在「委员会」而无人名 | 出事无人承担 | 指名到人并写进 Registry |
| Trust Boundary 只有一张图 | 图不能证明边界被执行 | 每条边界一行控制归属与 owner |
| 评审结论只写 Gap 不写阻断范围 | 团队会「先上再补」 | 明确写出不允许做什么 |

## 与其他 skill 的衔接

```text
enterprise-agent-architecture-review   ← 本 skill（架构是否成立、边界划在哪）
        │
        ├─ agent-security-threat-review        逐条 trust boundary 的威胁与控制
        ├─ agent-runtime-boundary-review       Runtime 能不能被治理
        ├─ agent-tool-and-mcp-governance       Tool / MCP / Skill 准入
        ├─ agent-governance-and-control-design Policy / 审批 / Kill / 证据的设计
        ├─ agent-reliability-review            semantic failure 与降级语义
        └─ agent-well-architected-assessment   逐条取证、评分与整改
```

## 数据来源与锚点

| 锚点 | 位置 |
| --- | --- |
| 正文 120 问的 A / B / C 节（Q001–Q030） | `temp/agent研究checklist.md` 第一章 |
| P00 Architecture Foundation、P00.A（AD / BO） | 同文件 附录 D |
| 三个 Stage 与 Gate | 同文件 B.11、B.5 |
| 章节定位与原依据（C.1–C.10） | 同文件 附录 C |
| 架构平面的完整论证 | `temp/agent研究.md` §1 / §3 / §19 |
| 决策记录形态 | `temp/agent研究.md` §20（ADR） |
