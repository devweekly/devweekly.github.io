---
name: agent-runtime-boundary-review
version: 1.0.0
description: 判断一个 Agent Runtime（AgentCore / LangGraph / DeepAgents / Snowflake Cortex Agents / Microsoft Foundry / Google Agent Engine / 自建）能不能被纳入统一治理，以及能治理到什么程度。按 14 个能力维度逐项打分，给出 FULLY / PARTIALLY / BOUNDARY / NOT GOVERNABLE 四档结论与补偿控制。用于 Runtime 选型、多 Runtime 并存治理、托管 Runtime 的边界确认。触发词：runtime 选型、AgentCore、Cortex Agents、Foundry、LangGraph、托管 runtime、多 runtime、runtime abstraction、治理边界、platform portability。
---

# Agent Runtime Boundary Review

## Goal

回答一个具体问题：**这个 Runtime 能治理到什么程度，剩下的靠什么补偿。**

核心原则：

> **不要问「哪个 Runtime 最好」，要问「它的哪些能力能被外部强制」。**
>
> Runtime 是执行环境，不是治理边界；治理必须能在 Runtime 之外裁决与取证。

## 何时用 / 不适用

| 用 | 不用 |
| --- | --- |
| 引入新 Runtime / Agent 框架时的准入判断 | Runtime 内部实现评审 |
| 多 Runtime 并存时的治理一致性检查 | Agent 业务逻辑与提示词质量 |
| 评估托管 Runtime 的边界控制能力 | Tool 准入（用 `agent-tool-and-mcp-governance`） |
| Runtime 迁移与可移植性判断 | 完整架构评审（用 `enterprise-agent-architecture-review`） |

## 输入

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| Runtime 能力清单 / 官方文档 | ✅ | 以文档与实际验证为准，不以厂商宣传为准 |
| 现有治理平面的控制清单（Policy / Evidence / Identity） | ✅ | 用来判断能否落地 |
| 一个可运行的 PoC | 强烈建议 | 无 PoC 的维度只能判 `Unverified` |
| 数据与网络拓扑 | ✅ | 决定 isolation 与 egress 是否可强制 |

## 14 个能力维度

逐项打三档：`Native`（Runtime 原生支持且可外部配置） / `Interceptable`（可在 Runtime 外拦截） / `Absent`（无法强制）。

| # | 维度 | 要确认的具体能力 | Absent 的后果 |
| --- | --- | --- | --- |
| 1 | Runtime capabilities | 能否枚举 Agent 可用的能力并限制 | 能力面不可知，无法做最小权限 |
| 2 | Runtime isolation | 执行隔离（进程 / 账户 / 租户 / 沙箱） | 跨租户越界不可阻断 |
| 3 | Identity | Agent 是否有独立身份，能否对接企业 IAM | 只能共享凭据，审计不可定位 |
| 4 | Authorization | 授权判定能否在 Runtime 外裁决 | 模型决定放行 |
| 5 | Tool control | Tool 调用能否被拦截、校验、拒绝 | 副作用不可控 |
| 6 | Data access | 数据访问能否下推 entitlement | 先取后过滤 |
| 7 | Observability | 是否有可导出的 trace，字段是否可对齐治理平面 | 无法重建 Run |
| 8 | Auditability | 证据能否不可篡改地留存与导出 | 无法向监管举证 |
| 9 | Human approval | 能否在动作前强制挂起等待人工 | 审批无法强制 |
| 10 | Kill / suspend | 能否独立暂停或终止 Run | 出事只能等它跑完 |
| 11 | Network egress | 出口能否被白名单与审计 | 数据外泄无闸门 |
| 12 | Memory | Memory 是否可隔离、可查、可清除 | 污染跨租户传播 |
| 13 | Failure semantics | 失败 / 重试 / 幂等语义是否明确可预期 | 重试产生重复副作用 |
| 14 | Provider visibility | 供应商能看到什么、模型侧留什么 | 不可见的数据流向成为风险 |

## 判定规则

```text
外部可裁决性   —— 授权、审批、拒绝是否能在 Runtime 之外完成？
外部可见性     —— 关键动作是否产生可导出的、不可篡改的证据？
外部可停止性   —— 能否在不依赖 Agent 配合的前提下终止？
```

三条同时成立 → 可纳入统一治理；缺一条就降档。

| 结论 | 含义 | 允许用法 |
| --- | --- | --- |
| **FULLY GOVERNABLE** | 三条全成立 | 可用于 L3 及以下；L4 需人工权威边界 |
| **PARTIALLY GOVERNABLE** | 缺证据或审批强制，但授权与停止可外部化 | 可用于 L2 及以下；须列补偿控制 |
| **BOUNDARY-GOVERNABLE** | 只能在入口与出口做控制，Runtime 内部不可见 | 仅用于内部低风险场景；禁止接触客户数据与资金动作 |
| **NOT SUITABLE** | 无法外部裁决、无法导出证据、无法独立停止 | 不得进入生产 |

托管 Runtime 通常落在 **BOUNDARY-GOVERNABLE**：这是它的固有边界，不要试图靠配置把它提升为 FULLY。
正确的做法是把它当作**潜在的第二 Runtime**，配 Runtime abstraction + 「平台权限 + 数据平台原生权限」双层授权。

## 流程

### Step 1 — 列 Runtime 清单与角色

每个 Runtime 标注：承载什么 Agent、风险等级、是否接触客户数据、是否有副作用动作。

### Step 2 — 逐维度取证

对 14 个维度，每一项必须给出：结论（Native / Interceptable / Absent）+ 证据位置（文档章节、配置、PoC 结果）。
**无证据的维度记 `Unverified`，不得按 Native 计。**

### Step 3 — 多 Runtime 一致性检查

| 检查 | 判据 | 不达标形态 |
| --- | --- | --- |
| 身份与策略权威来源 | 唯一权威来源成文 | 两个 Runtime 各有一套身份模型且无裁决方 |
| 状态与责任边界 | 谁持有业务状态、谁持有 Run 状态 | Agent 自己决定业务状态 |
| 审计一致性 | 跨 Runtime 的 trace 与证据字段可关联 | 需要人工拼接 |
| 语义一致性 | Identity / Policy / Audit schema 语义跨 Runtime 一致 | 同名不同义 |
| 补偿控制 | 不支持某控制时写明替代手段与残余风险 | 用「默认就安全」搪塞 |
| Ultimate authority | 哪一层是最终授权权威 | 无裁决方 |

### Step 4 — 可移植性判断

| 问题 | 判据 |
| --- | --- |
| 换 Runtime 是否改变控制语义 | policy / evidence / identity 接口保持一致；换后需改上层代码则不合格 |
| 绑定程度是否可度量 | 写明抽象层、迁移成本、已演练的迁移范围 |
| 是否有退出路径 | 触发条件、责任人、时间窗、数据处置方式 |

### Step 5 — 结论与补偿控制

输出四档结论 + 每个 Absent 维度对应的补偿控制 + 残余风险与接受人。

## 输出模板

```text
Runtime Boundary Review — <Runtime 名>

Runtime:               <名称 / 版本 / 托管方式>
承载 Agent 与风险等级:  <清单>
结论:                  □ FULLY  □ PARTIALLY  □ BOUNDARY  □ NOT SUITABLE

| # | 维度 | 结论 | 证据 | 缺失时的补偿控制 |
| 1 | runtime capabilities | Native | <文档/PoC> | — |
| 4 | authorization      | Absent | — | 在平台侧 PEP 拦截全部 Tool 调用 |
| 10| kill / suspend     | Interceptable | <PoC> | 平台侧撤销凭据 + 网络隔离 |

多 Runtime 一致性： <身份 / 策略 / 状态 / 审计 / 权威来源>
可移植性：         <抽象层 / 迁移成本 / 已演练范围 / 退出路径>
禁止用法：         <明确写出不得做什么>
残余风险与接受人：  <项 → 接受人 → 复核日>
```

## 反模式总表

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 用厂商宣传判断治理能力 | 宣传口径不是控制 | 逐维度取证，无证据记 Unverified |
| 把托管 Runtime 当 FULLY | 内部不可见是固有限制 | 归为 BOUNDARY，配进出口控制 |
| 用「Runtime abstraction」一句话代替可移植性 | 抽象层不能消除绑定 | 写迁移成本与已演练范围 |
| 两个 Runtime 各审各的 | 会出现两套安全模型 | 加一致性检查与唯一权威来源 |
| 只审单 Runtime | 多 Runtime 并存才是真实风险 | 以「组合」为单位评审 |
| 不写禁止用法 | 团队会一路扩到高风险场景 | 明确写出不得做什么 |

## 与其他 skill 的衔接

- 前置：`enterprise-agent-architecture-review`（先确认边界与责任）
- 并行：`agent-governance-and-control-design`（控制设计）、`agent-security-threat-review`（Enforcement Point 落点）
- 后续：`agent-tool-and-mcp-governance`（Tool 侧控制）、`agent-well-architected-assessment`（逐条评分）

## 数据来源与锚点

| 锚点 | 位置 |
| --- | --- |
| 正文 120 问 H 节（Q071–Q080） | `temp/agent研究checklist.md` 第一章 |
| RT01–RT17（Runtime Isolation / Execution Budget / Portability） | 同文件 附录 D（P14 段）与 附录 C.57–C.59 |
| 平台边界与 Runtime Abstraction（附录 A.1） | 同文件 附录 A |
| Invariants：Managed Runtime 治理边界、Runtime Isolation | 同文件 第二章 |
| Runtime 架构与定位（Runtime-aware, Runtime-independent） | `temp/agent研究.md` §5 |
| 多 Runtime / Cortex Agents 的双层授权 | `temp/agent研究.md` §3、§19 |
