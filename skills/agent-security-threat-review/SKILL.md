---
name: agent-security-threat-review
version: 1.0.0
description: 以 Trust Boundary + Control Point 为核心审查 Agent 系统的安全设计，覆盖 Prompt Injection、Indirect Injection、Tool Poisoning、Identity 与 Delegated Identity、Memory 污染、Data Leakage、Egress、Human Oversight 被操纵与 Rogue Agent 遏制。输出 Threat / Control / Enforcement Point / Evidence / Failure Mode / Residual Risk 六列矩阵。用于 Agent 安全评审、威胁建模、红队方案设计、安全控制落点确认。触发词：Agent 安全、security review、threat model、prompt injection、参数注入、越权、DLP、identity delegation、kill switch、threat boundary。
---

# Agent Security & Threat Review

## Goal

把 Agent 的安全问题从「有没有防护」变成**每条 trust boundary 上的控制是否可证明地生效**。

核心原则：

> **Agent 是不可信的决策参与者，而不是安全边界。**
>
> 安全边界由 Identity / Policy / PEP / Entitlement / Runtime Isolation / Evidence 建立，不由模型建立。

推论：任何以「提示词约束」「内容过滤」「模型指令」作为唯一防线的设计，本 skill 一律判 Gap。

## 何时用 / 不适用

| 用 | 不用 |
| --- | --- |
| 新增 Agent 用例的安全评审与威胁建模 | 完整架构评审（用 `enterprise-agent-architecture-review`） |
| 新 Tool / MCP / Skill 的安全准入 | Tool 元数据与注册规范（用 `agent-tool-and-mcp-governance`） |
| Runtime 更换后的安全等价性判断 | Runtime 治理能力打分（用 `agent-runtime-boundary-review`） |
| 安全事件复盘、红队范围定义 | 可靠性语义与降级（用 `agent-reliability-review`） |

## 输入

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| Agent 架构图 / 组件清单 | ✅ | 用来画 trust chain，不信任图上的连线 |
| 可访问的资源清单（数据、Tool、API、网络出口） | ✅ | 缺失即判 `Unknown`，不得判 Pass |
| 身份与授权模型（Agent Identity、委派方式） | ✅ | Agent 是否使用共享凭据是首要判据 |
| 注入测试 / 红队结果 | 建议 | 无结果时相关条目只能判 🟡 Partial |
| 事故与近失事件记录 | 可选 | 用于校准残余风险 |

## 第一步：画出 trust chain

```text
User
 ↓
Agent（编排 / reasoning）
 ↓
LLM（Model Provider）
 ↓
Memory（短期状态 / 长期记忆）
 ↓
Retrieval（Knowledge / 文档 / 结构化数据）
 ↓
Tool / MCP（含 Skill 包与代码执行）
 ↓
External System（核心系统 / 交易 / 对外 API / 网络出口）
```

对链上**每一个箭头**，问七个问题。答案必须落到具体组件，不能回答「平台统一处理」：

```text
1. 谁提供输入？
2. 哪些输入是不可信的？
3. 谁决定 Authorization？
4. 哪里做 Data Entitlement？
5. 哪里做 Tool Authorization？
6. 哪里做 Egress Control？
7. 哪里做 Human Approval？
+  哪里可以 Kill？（不依赖 Agent 配合）
```

任一箭头无法回答任一问题 → 该边界记为 **Uncontrolled**，进入威胁矩阵的 Failure Mode 列。

## 第二步：五类不可信输入面

所有进入 Agent context 的不可信内容属于**同一个 control family**，必须用统一的 validation / trust-boundary policy 处理，而不是各写一条。

| 输入面 | 典型威胁 | 必备控制 |
| --- | --- | --- |
| User input | Direct Prompt Injection | 输入校验 + 越权意图检测 + 拒答路径 |
| Tool response | Indirect Injection、Tool Poisoning | 返回值 schema + 语义校验 + 注入检测 |
| Retrieved document | Indirect Injection、内容投毒 | 来源可信度 + 版本与有效期 + 注入检测 |
| Web / 外部内容 | Indirect Injection | 内容不进指令位、白名单出口 |
| Inter-agent message | 伪造指令、权限放大 | 对端身份校验 + 签名验签 + 权限不放大 |
| Memory（读 / 写） | Memory Poisoning | 写入校验 + 隔离 + 可检测可清除 |

判据：**防护位于模型之外**；失败时 fail-closed；有对抗样本集与定期回归。
只依赖系统提示词或模型自审 → Gap。

## 第三步：身份与授权（Q031–Q037）

| 检查 | 判据 | 不达标形态 |
| --- | --- | --- |
| Agent 独立身份 | 日志与审计中可唯一定位到 Agent 与版本 | 借用共享账号或用户凭据 |
| 四类身份区分 | Agent / Human / Service / Delegated 可区分且委派链可反查原始主体 | 四类混成一种身份 |
| 授权判定确定性 | 由 policy / authorization engine 给出，**LLM 不得成为放行终裁** | LLM 输出直接决定放行 |
| 权限不可自改 | 权限边界位于 Agent 之外且不可被 reasoning 修改，有越权尝试被拒证据 | 靠提示词约束 |
| 统一授权边界 | Tool / API / DB / File / Browser / External Service 全部经过同一边界，无旁路 | 存在直连数据库、脚本内嵌凭证 |
| 四个最小化 | least privilege + 最小数据范围 + 最小工具集 + 最小执行时间，权限按任务授予并到期回收 | 按「部门同权」授权 |
| 风险分级控制 | per action 风险等级有不同审批、二次确认与审计留存 | 所有 action 同一套控制 |

## 第四步：数据与出口保护

入站与出站是两个独立的 control family，不要合并成「DLP 有没有做」。

| 边界 | 必须覆盖 | 判据 |
| --- | --- | --- |
| Inbound（User / Tool / Retrieval / Web / Memory / A2A） | untrusted content classification、注入检测、schema + 语义校验 | 失败即拒绝并留证 |
| Outbound（User response / Tool response / Memory write / Log） | PII、credential、confidential data 检测与阻断 | 每个出口单独有策略，不靠「统一网关」口头承诺 |

判据：**敏感数据保护在每一个 inbound / outbound 边界实施统一 policy**，而不是只做用户响应侧。

## 第五步：最坏情况定义（Q040）

| 问题 | 判据 | 反模式 |
| --- | --- | --- |
| Agent / Tool / Model 完全被攻陷时最大业务影响 | 写明影响面（资金、客户、数据、声誉）、技术上限、接受人 | 「影响可控」 |
| 组合失效 | 至少分析两两组合（如 Model + Tool），不只做单点 | 只做单点分析 |
| 技术限制 | 最坏影响有硬上限（额度、白名单、只读、人工闸门） | 上限只写在文档里 |

## 输出：威胁矩阵

每个威胁一行，六列不得缺项：

| Threat | Control | Enforcement Point | Evidence | Failure Mode | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Indirect Injection via retrieved doc | trust-boundary validation + 指令位隔离 | Retrieval PEP（检索返回后、入 context 前） | 对抗样本集回归报告 | 检测失效时内容进入指令位 | Medium，接受人 <name> |
| Tool 越权写 | deterministic authorization + capability model | Tool PEP（调用前） | 拒绝样本 + 授权日志 | policy 服务不可用时放行 | High，须 fail-closed |
| Memory 污染 | 写入校验 + 隔离 + 清除机制 | Memory write PEP | 污染注入测试 + 清除演练 | 污染跨 tenant 传播 | High |
| 凭证外泄至外部 API | Egress allowlist + DLP | Egress PEP | 出口流量审计 | allowlist 被扩至 \* | Critical |

**Enforcement Point 必须是可命名的位置**（哪个组件、在调用链的哪一步）。写不出位置 = 控制不存在。

## 残余风险的处理

| 情形 | 处理 |
| --- | --- |
| 有控制、有证据、影响有硬上限 | 记录残余风险 + 接受人，可 Pass |
| 有控制、无证据 | 🟡 Partial，限期取证，不得 Pass |
| 无控制但依赖人工盯防 | Gap，除非该风险等级允许，否则不进入生产 |
| 无控制且影响无上限 | 阻断发布，不做风险接受 |

## 反模式总表

| 反模式 | 正确处理 |
| --- | --- |
| 「我们有 system prompt 防注入」 | 防线必须在模型之外，提示词不是控制 |
| 「Agent 继承用户权限」 | 必须有独立 Identity + 委派链 |
| 「统一网关做 DLP」 | 逐个 inbound / outbound 边界给策略与证据 |
| 「出问题可以人工停」 | 停止路径必须不依赖 Agent 配合且有演练记录 |
| 只做单点失陷分析 | 至少给出组合失效分析 |
| 把审计日志当检测手段 | 日志是证据，不是阻断 |

## 与其他 skill 的衔接

- 前置：`enterprise-agent-architecture-review`（确认问题成立与边界划清）
- 并行：`agent-governance-and-control-design`（Policy / Approval / Kill 的设计口径）
- 并行：`agent-runtime-boundary-review`（Runtime 是否可控，决定 Enforcement Point 是否可落地）
- 后续：`agent-well-architected-assessment`（把结论落成评分、P0/P1/P2 与整改项）

## 数据来源与锚点

| 锚点 | 位置 |
| --- | --- |
| 正文 120 问 D 节（Q031–Q040） | `temp/agent研究checklist.md` 第一章 |
| 威胁模型 TM01–TM08、Security Testing、Memory / Identity / Multi-agent / Human Oversight 各节 | 同文件 附录 D（P02 段）与 附录 C.19–C.27 |
| Invariants 与 Fail 即阻断条件 | 同文件 第二章 |
| P0 红线中的 P0-01 / 03 / 05 / 06 / 07 / 08 | 同文件 B.5 |
| 安全平面与 PEP 设计（Retrieval / Tool / Egress PEP） | `temp/agent研究.md` §10 |
| 人工监督与审批的完整论证 | `temp/agent研究.md` §11 |
