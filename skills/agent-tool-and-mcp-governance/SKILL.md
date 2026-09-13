---
name: agent-tool-and-mcp-governance
version: 1.0.0
description: 统一审查 Tool / MCP Server / Skill 的准入与执行控制。每项工具按十个元数据字段登记（Identity、Owner、Version、Risk、Permissions、Data Classification、Network Access、Credential、Approval Requirement、Audit Requirement），按六类动作（READ / WRITE / EXECUTE / COMMUNICATE / TRANSFER / TRANSACTION）与四级风险（LOW / MEDIUM / HIGH / CRITICAL）分级，并覆盖供应链与沙箱控制。用于新 Tool / MCP / Skill 接入评审、Tool Registry 设计与执行面治理。触发词：Tool 准入、MCP 治理、tool registry、capability model、tool risk、skill 供应链、tool authorization、side effect 分级、工具注册。
---

# Agent Tool & MCP Governance

## Goal

任何新的 Tool / MCP Server / Skill 接入时，都能被同一套模型审查，并得出可执行的准入结论。

核心原则：

> **Agent 只能调用能力被显式声明的工具，不能获得通用生产访问能力。**

因此「通用执行器」「任意 SQL 查询」「任意 HTTP 调用」这类工具一律判 **不应存在**，无论封装得多好。

## 何时用 / 不适用

| 用 | 不用 |
| --- | --- |
| 新 Tool / MCP Server / Skill 的准入评审 | Agent 的授权判定设计（用 `agent-governance-and-control-design`） |
| Tool Registry / 注册表字段设计 | Runtime 能力判断（用 `agent-runtime-boundary-review`） |
| 供应链与制品安全要求 | 整体威胁建模（用 `agent-security-threat-review`） |
| 已有工具集的定期复查与退役判断 | 逐条评分与整改（用 `agent-well-architected-assessment`） |

## 输入

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| Tool / MCP Server / Skill 清单与描述 | ✅ | 逐项登记 |
| 接口 schema 与副作用说明 | ✅ | 无 schema 不得进入评审 |
| 所需权限（数据范围、网络出口、凭证） | ✅ | 决定风险等级 |
| 制品来源（仓库、构建、签名） | ✅ | 供应链门禁的输入 |
| 调用方 Agent 与业务场景 | ✅ | 风险随场景而非工具本身变化 |

## 第一步：Tool 元数据（十项）

每一项都是**准入必要条件**，缺项不得上线。写入 Tool Registry，随版本更新。

| # | 字段 | 要求 | 缺失后果 |
| --- | --- | --- | --- |
| 1 | Identity | Tool 自身身份与可审计标识 | 调用无法归因 |
| 2 | Owner | 业务与技术责任人，指名到人 | 无人维护、无人叫停 |
| 3 | Version | 唯一版本号 + 变更差异 + 生效时间 | 无法回滚、无法追溯 |
| 4 | Risk | 风险等级（见第三步） | 控制强度无法确定 |
| 5 | Permissions | 最小权限集，按任务授予、到期回收 | 权限蔓延 |
| 6 | Data Classification | 可触达数据的最高分类与最小字段 | 数据越界不可控 |
| 7 | Network Access | 允许的出站目的地（白名单，禁止 `*`） | 数据外泄无闸门 |
| 8 | Credential | 凭证来源、轮转周期、是否可委托 | 长期凭证泄露 |
| 9 | Approval Requirement | 是否需要审批、审批层级、金额或范围阈值 | 高风险动作无审批 |
| 10 | Audit Requirement | 必须留哪些字段、保留多久、谁能访问 | 无法举证 |

## 第二步：动作分类（六类）

一个工具可以归多类，但**风险按最高的那一类**判定。

| 动作 | 含义 | 典型控制 |
| --- | --- | --- |
| **READ** | 读取数据或状态 | 数据 entitlement 前置 + 最小字段 |
| **WRITE** | 创建或修改自身或平台内对象 | 幂等 + 审批（按等级）+ 变更留痕 |
| **EXECUTE** | 执行代码、脚本、命令 | 独立沙箱 + 资源上限 + 出口限制 |
| **COMMUNICATE** | 对外发送消息、通知、邮件 | DLP + 收件人白名单 + 频率限制 |
| **TRANSFER** | 传输文件、数据集、批量数据 | 分类标签 + 目标方授权 + 数量上限 |
| **TRANSACTION** | 产生资金、交易、额度、合约等不可逆后果 | 双人控制 + 人工权威边界 + 强证据 |

判据：**副作用分类必须写进 Tool 元数据**，未分类即不得调用。

## 第三步：风险分级（四级）

| 等级 | 判定 | 必须有的控制 |
| --- | --- | --- |
| **LOW** | 只读、无敏感数据、无出口 | 日志 + 配额 |
| **MEDIUM** | 只读敏感数据 或 可逆写 | entitlement + 校验 + 抽检 |
| **HIGH** | 有外部可见副作用、可逆交易、批量传输 | 审批 + 二次确认 + 幂等 + 完整审计 |
| **CRITICAL** | 资金 / 客户 / 监管级、不可逆 | 双人控制 + 人工权威边界 + 独立审批 + fail-closed |

分级驱动的是**控制档位**，不是文档标签。等级与控制不匹配即为 Gap。

## 第四步：执行面控制（每次调用都要有的七件事）

| # | 控制 | 判据 |
| --- | --- | --- |
| 1 | 授权判定 | 由确定性引擎裁决，LLM 不得放行；有拒绝样本 |
| 2 | 输入校验 | schema + 语义校验同时存在，失败即拒绝并留证 |
| 3 | 输出校验 | 返回值校验 + 注入检测（返回值是不可信输入） |
| 4 | 副作用边界 | 副作用限于当前任务范围，有越界拦截证据 |
| 5 | 幂等与补偿 | 幂等键可验证，超时与补偿结果明确，重试不产生重复副作用 |
| 6 | 完整追踪 | 调用者、参数、授权结果、执行结果、失败原因五要素齐备且不可篡改 |
| 7 | 出口控制 | 出站目的地与内容受 policy 约束，异常出口即阻断 |

## 第五步：供应链与沙箱（Skill / MCP / 依赖）

| 控制域 | 要求 | 判据 |
| --- | --- | --- |
| Artifact intake | 制品入库前检查 malware / dependency / SBOM / license / provenance | 命中即阻断并留证，结果绑定制品版本 |
| Build isolation | 构建与运行沙箱分离，限制 network egress、secret access、filesystem、shell | 有逃逸测试记录 |
| Signing & provenance | 制品有摘要或签名，部署前校验 | 可被就地覆盖即为不达标 |
| Immutable deployment | 生产制品不可变，按环境晋级 | 各环境重构建即为不达标 |
| Change approval | 高风险变更需业务、风险、安全签核，绑定版本与评估结果 | 所有变更同一流程即为不达标 |
| Lifecycle | 版本、owner、审批、回滚、退役路径齐备 | 只写「可下线」即为不达标 |

## 第六步：准入结论

| 结论 | 条件 |
| --- | --- |
| **Approved** | 十项元数据齐备 + 风险分级与控制匹配 + 七项执行控制有证据 |
| **Approved with conditions** | 缺证据但控制存在；限定场景与期限，到期复核 |
| **Rejected** | 缺 schema、无 owner、无出口白名单、CRITICAL 无人工权威边界 |
| **Not allowed by design** | 通用执行器、任意 SQL、任意 HTTP、通配出口 |

## 输出模板

```text
Tool Governance Review — <Tool / MCP / Skill 名>

元数据（十项）
| 字段 | 值 | 证据 | 缺失 |
| Identity | ... | ... | — |

动作分类：READ □  WRITE □  EXECUTE □  COMMUNICATE □  TRANSFER □  TRANSACTION □
风险等级：LOW □  MEDIUM □  HIGH □  CRITICAL □     控制档位是否匹配：是 / 否（说明）

执行面控制（七项）   <逐项：控制 / 落点 / 证据>
供应链与沙箱        <逐项：控制 / 落点 / 证据>

调用方与允许场景：   <Agent 清单 + 场景边界>
禁止用法：           <明确写出不得做什么>
准入结论：           Approved / Approved with conditions / Rejected / Not allowed by design
条件与到期日：       <限定场景 / 期限 / 复核人>
```

## 反模式总表

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 提供「通用 HTTP / SQL / 执行器」工具 | 一次性绕开全部授权与数据边界 | 按 capability 显式声明 |
| 工具无 Owner | 无人维护、出事无人叫停 | 元数据必填到人 |
| 用类型检查代替校验 | 类型对不代表语义合法 | schema + 语义校验并存 |
| 信任 Tool 返回值 | 返回值是间接注入的主要入口 | 返回值按不可信输入处理 |
| 出口白名单写 `*` | 等于没有出口控制 | 明确目的地 |
| 风险等级与控制脱钩 | 分级变成标签 | 等级 → 控制档位一一对应 |
| 所有工具同一套审批 | 低风险被拖慢、高风险被放松 | 按动作与等级分档 |
| 幂等靠「不会重试」 | 网络与超时一定会重试 | 幂等键 + 对账 |

## 与其他 skill 的衔接

- 前置：`enterprise-agent-architecture-review`（确认能力边界）
- 并行：`agent-security-threat-review`（Tool 侧威胁与控制）、`agent-governance-and-control-design`（审批与风险分级口径）
- 依赖：`agent-runtime-boundary-review`（Tool 调用能否被拦截，决定执行控制能否落地）
- 后续：`agent-well-architected-assessment`（逐条评分与整改）

## 数据来源与锚点

| 锚点 | 位置 |
| --- | --- |
| 正文 120 问 F 节（Q051–Q060）、K 节供应链（Q102–Q105） | `temp/agent研究checklist.md` 第一章 |
| Tool 元数据与 MCP 治理模式（附录 A.6） | 同文件 附录 A |
| P11 Skill / Software Supply Chain 章节 | 同文件 附录 D 与 附录 C.52 |
| P0-03 Tool Authorization、P0-10 Skill Supply Chain | 同文件 B.5 |
| Tool / MCP 治理的完整论证 | `temp/agent研究.md` §8 |
| 第三方与供应链风险 | `temp/agent研究.md` §14 |
