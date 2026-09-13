---
name: agent-well-architected-assessment
version: 1.0.0
description: 把 Agent 架构评审 checklist 变成可执行的评估流程：抽取适用条目、收集证据、判定 Pass / Partial / Gap / N/A、定 P0/P1/P2、产出 Finding 与 Remediation，并登记风险接受。用于 Agent 平台的正式评估、季度复审、上线前取证与整改跟踪。触发词：Well-Architected 评估、assessment、评审执行、取证、证据要求、评分、Pass Gap、P0 P1 P2、finding、remediation、风险接受、上线前检查、checklist 打分。
---

# Agent Well-Architected Assessment

## Goal

把一份几百项的 checklist 变成一份**可复核、可跟踪、可签字的评估报告**，而不是每次让 AI 把条目重读一遍。

核心原则：

> **没有 Evidence，就不要标记 Pass。**
>
> 每条控制的结论由 Maturity / Evidence / Risk / Applicability 四个独立维度共同决定，不压成一个数字。

## 何时用 / 不适用

| 用 | 不用 |
| --- | --- |
| 正式评估、季度复审、上线前取证 | 评审「这个架构是否值得做」（用 `enterprise-agent-architecture-review`） |
| 从 checklist 生成评估报告与整改计划 | 单点领域深审（用 security / reliability / runtime / tool 各 skill） |
| 跟踪 Finding 与风险接受的闭环 | 第一次做威胁建模（用 `agent-security-threat-review`） |

## 四个 skill 的分工

```text
enterprise-agent-architecture-review   →  为什么这样设计         （架构是否成立）
agent-governance-and-control-design    →  谁批准 / 谁承担风险    （控制设计）
agent-security-threat-review           →  威胁与控制落点         （安全强度）
agent-well-architected-assessment      →  现在有没有做到         （本 skill，逐条判定）
        +
证据来源：checklist 附录 D（431 项证据检查项）与附录 A（181 项补充控制项）
```

本 skill 负责**判定与产出**，不负责重新论证设计。

## 输入

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| 评估范围与用例清单 | ✅ | 决定抽哪些条目 |
| 目标架构 / 现状描述 | ✅ | 判定对象 |
| 证据来源清单（仓库、配置、测试报告、日志、审批记录） | ✅ | 无来源即 Evidence = Missing |
| 上一轮评估报告与整改跟踪 | 建议 | 用于回归与关闭项核对 |
| checklist 版本 | ✅ | 记入报告，评分结果与版本绑定 |

## 第一步：Scope Profile（适用性裁剪）

不要从 120 问逐条读起。先按用例属性生成适用集：

| 用例属性 | 裁剪效果 |
| --- | --- |
| 是否接触客户数据 | E 节（数据与知识）从抽样改为全查 |
| 是否产生交易 / 资金动作 | F 节全查 + L 节（FSI）全查 + 强制 Step 五的 Critical 规则 |
| 是否使用托管 Runtime | H 节全查（多 Runtime 一致性） |
| 是否多租户 | H 节 + 附录 A 的隔离细项 |
| 是否引入第三方 Model / Tool / Framework | K 节 + L 节第三方风险 |
| 是否为内部只读工具 | 可判 N/A 的条目必须写明理由 |

输出一张**适用集表**：`条目 ID → Applicable / N/A（理由） → Depth → 责任 owner → 需要的证据形态`。
这张表可复用：同类用例下一轮只做差分。

## 第二步：证据收集

按 **Depth** 决定取证方式：

| Depth | 取证方式 | 证据形态 |
| --- | --- | --- |
| **L1 Decision** | 访谈 + 文档 | ADR、决策记录、风险接受签字 |
| **L2 Design** | 设计文档 + 配置 | 架构图、策略定义、控制清单 |
| **L3 Evidence** | 抽样取证 | 测试报告、拒绝样本、日志片段、扫描结果、演练记录 |

证据分级：

| 等级 | 含义 | 是否可支撑 Pass |
| --- | --- | --- |
| **Present** | 可现场演示或可复核的产物 | ✅（受 Risk 约束） |
| **Partial** | 只有设计或口头说明，未验证 | ❌ 最多 Partial |
| **Missing** | 找不到 | ❌ 最多 Partial |

**举证位置必须写出来**（哪个 artifact、谁能拿到）。写不出位置 = Partial。

## 第三步：判定（五条规则，不得跳过）

先看是否达到该条的**达标线**（方向标签 + 可核对的尺度），再套规则：

```text
1. Maturity ≤ 2                                  → Gap
2. Maturity ≥ 3 且 Evidence = Missing            → 不得 Pass，最多 Partial
3. Maturity ≥ 3 且 Evidence = Present
     · Risk ∈ {Low, Medium}                      → Pass
     · Risk ∈ {High, Critical}                   → Partial（必须给 remediation plan + owner + target date）
4. Risk = Critical 的控制                         → 不允许只凭 Maturity 判 Pass，需要 test result 或持续监控证据（Maturity 4 / 5）
5. 标 [RA] 的条目判 N/A                          → 必须写不适用理由，且需 Architecture Board 确认
```

Maturity 定义：

```text
0 = No control
1 = Documented only
2 = Partially implemented
3 = Implemented
4 = Implemented + tested
5 = Implemented + continuously monitored
```

> **Result 不是 Maturity 的函数。** 同一组 Maturity / Evidence 在不同 Risk 下结论不同：
> 「Kill switch，Maturity 3，Evidence Present，Risk Critical」应当判 **Partial**，
> 需要 remediation plan，而不能单独视为 Pass。

## 第四步：Priority 与 Finding

Priority 与 Requirement Level 是两个维度，不可互推：

| 组合 | 含义 |
| --- | --- |
| `P0 + R` | 关键且必须具备 |
| `P0 + RA` | 关键，仅在特定架构形态或监管条件下适用 |
| `P1 + R` | 非本期最关键，一旦适用即必须具备 |
| `P1 + Rec` / `P2 + Rec` | 改进项，不阻断 Pass |

Finding 必须写成**可验证的差距**，不是感想：

| 要素 | 要求 | 反例 |
| --- | --- | --- |
| 现状 | 目前是什么（含证据） | 「做得不够」 |
| 期望 | 达标线要求什么 | 「应该更好」 |
| 差距 | 差在哪个可核对点上 | 「有风险」 |
| 影响 | 失效时的业务 / 监管后果 | 「影响较大」 |
| 责任 | Owner 指名到人 | 「平台团队」 |
| 期限 | 目标日期 | 「尽快」 |

## 第五步：P0 红线优先

P0 控制属**架构前提（architectural prerequisite）**：未落地即 Production Gate 未满足。

十条主线（与 checklist B.5 对齐）：

```text
P0-01 Agent Identity / Delegated Identity
P0-02 Retrieval Entitlement
P0-03 Tool Authorization
P0-04 Prompt / Configuration Versioning
P0-05 Memory Isolation / Integrity
P0-06 Input / Output DLP + Injection Defense
P0-07 Non-repudiation / Audit Evidence
P0-08 Human Approval / Rogue Agent Containment
P0-09 External Provider / Runtime Resilience
P0-10 Skill / Artifact Supply Chain
```

处理规则：

- 未落地的 P0 → **阻断发布**，只能走例外流程 + 风险接受；
- 例外必须**双人批准 + 时限 + 补偿控制 + 到期强制复核**；
- 风险接受人必须是业务与风险双方，不能只有交付方；
- `Risk = Critical` 的条目不允许只凭 Maturity 判 Pass。

## 第六步：Remediation 与风险接受

| 项 | 内容 |
| --- | --- |
| Action | 具体改什么（不是「加强」） |
| Owner | 责任人 |
| Target | P0 / P1 / P2 |
| Due | 目标日期 |
| 补偿控制 | 整改前的临时手段（必须写，否则视为无缓解） |
| 验证方式 | 怎么证明改完了（拒绝样本 / 演练记录 / 扫描结果） |
| 关闭条件 | 达到哪条达标线才可关闭 |

风险接受登记必须包含：项、残余影响、接受人、批准人、时限、复核日。

## 输出模板

```text
Agent Well-Architected Assessment — <用例 / 平台名>    Checklist 版本：<version>    日期：<date>

0. 范围与适用性
   Scope Profile：适用 N 条 / N/A M 条（逐条给理由）

1. 结论摘要
   | 指标 | 值 |
   | 适用条目 | N |
   | Pass / Partial / Gap / N/A | a / b / c / d |
   | P0 未落地 | k |
   一句话结论： <可发布 / 有条件发布 / 不可发布>

2. 逐条判定（按节）
   | ID | Depth | Risk | Maturity | Evidence | Result | Owner | Finding |
   | Q031 | L1 | High | 3 | Present | Partial | <name> | 授权由 LLM 参与裁决 |

3. P0 红线
   | P0 | 状态 | 证据 | 阻断范围 | 例外与接受人 |

4. Finding 与 Remediation
   | # | Finding（现状 / 期望 / 差距 / 影响） | Action | Owner | Target | Due | 补偿控制 | 验证方式 | 关闭条件 |

5. 风险接受登记
   | 项 | 残余影响 | 接受人 | 批准人 | 时限 | 复核日 |

6. 与上一轮的差量
   | 项 | 上轮 | 本轮 | 变化原因 |

7. 签字
   Architecture Board：<name / date>
   Risk：<name / date>        Business：<name / date>        Security：<name / date>
```

## 反模式总表

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 无证据判 Pass | 会把「写在文档里」当成「已经做到」 | Evidence Missing → 最多 Partial |
| 用 Maturity 一个数字下结论 | 忽略 Risk 与 Evidence | 四维判定后再给 Result |
| 把 Critical 风险按普通规则判 | 最强的控制反而最容易放行 | Critical 需测试或持续监控证据 |
| N/A 不写理由 | 适用性变成逃避通道 | N/A 必写理由，`[RA]` 需 Board 确认 |
| 每条都从零读 | 浪费且不一致 | Scope Profile + 差分评估 |
| Finding 写成感想 | 无法跟踪、无法关闭 | 现状 / 期望 / 差距 / 影响 / 责任 / 期限 |
| 例外无时限 | 例外变成事实标准 | 双人批准 + 时限 + 强制复核 |
| 只报问题不给阻断范围 | 团队会「先上再补」 | 明确写出期间不允许做什么 |

## 与其他 skill 的衔接

- 上游：`enterprise-agent-architecture-review`、`agent-governance-and-control-design`
- 同级深审：`agent-security-threat-review`、`agent-reliability-review`、`agent-runtime-boundary-review`、`agent-tool-and-mcp-governance`
- 证据库：checklist 附录 D（431 项证据检查项）与附录 A（181 项补充控制项）

## 数据来源与锚点

| 锚点 | 位置 |
| --- | --- |
| 正文 120 问十二节（Q001–Q120）与十二节总览 | `temp/agent研究checklist.md` 第一章、B.4 |
| 记录字段、评分方式、条目阅读方式 | 同文件 B.2、B.3、B.13 |
| Review Depth 与三个 Stage | 同文件 B.11 |
| P0 十项红线、6 个关键证明问题、评分板 | 同文件 B.5、B.6、B.7 |
| 编号与元数据约定（R / RA / Rec 与 Priority） | 同文件 B.14 |
| 证据检查项与补充控制项 | 同文件 附录 D、附录 A |
| 风险分析、缺口分析与目标架构论证 | `temp/agent研究.md` §18、§19 |
