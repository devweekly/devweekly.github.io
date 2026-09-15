---
name: evidence-and-claim-review
version: 2.2.0
description: 审核技术文章、架构报告、产品与行业分析中的观点、论据和结论是否站得住。先把文章拆成最小可验证的 Claim 并判定两个正交字段 —— Claim Type（FACT / CAPABILITY / LIMITATION / PERFORMANCE / MATURITY / PRACTICE / EXPERIENCE / COMPARISON / CAUSAL / RECOMMENDATION / PREDICTION / STRATEGIC / OPINION）与 Epistemic Status（FACT / INFERENCE / PREDICTION / OPINION），再记录 Claim Context（产品 / 版本 / 区域 / 可用状态 / API 面 / 核对日期）、Scope 与 Applicability Conditions（什么条件下才成立），把证据拆成五个独立维度评估（Directness / Authority / Independence / Freshness / Completeness），主动搜索反例、给反证定严重度并记录沉默证据与搜索覆盖偏差，验证真实用例的「存在 / 采用 / 成功 / 规模化 / 结果已证」与结果验证方式，判定理论与实践的鸿沟，最后给出 Status、Confidence、Evidence Sufficiency 三个正交结论及改写建议。全程受六条不可违反原则约束：结论强度不得超过证据强度、引用不等于证据、证据到结论的推理链须单独审查、capability 不等于 maturity、feasibility 不等于 generality、缺席的证据不自动构成反证。用于事实核查、引用核查、行业报告审视、AI 与云产品能力与成熟度评估、厂商宣传与 benchmark 可信度判断、文章发布前审稿、架构评审与厂商评估。触发词：事实核查、claim review、evidence review、可信度评估、来源审查、引用核查、是否过时、找反例、落地案例、成熟度、生产可用、过度推断、结论过强、证据够不够、benchmark 可信吗、厂商宣传、一家之言、独立验证、scope 适用性、适用条件、证据够不够。
---

# Evidence & Claim Review

## Purpose

判断一个观点****现在到底有多可信****：事实是否成立、来源是否真实直接、是否权威且独立、是否仍然有效、

有没有真实落地、落地到底证明了什么、适用到哪里、理论与实际差多少，以及今天是否还能据此做决策。

本 Skill 不产出「支持这个观点的链接清单」。它产出：

> **Claim → Type × Epistemic → Context → Scope → Applicability → Evidence →

> Directness → Authority → Independence → Freshness → Completeness →

> Counter-evidence（+ Severity）→ Silent Evidence → Search Coverage →

> Use Case → Outcome Verification → Reality Gap →

> Status → Confidence → Sufficiency → Principle Check → Rewrite**

这是一个可复用于架构评审、厂商评估、技术雷达、产品比较、研究报告审稿的 Evidence Review Engine。

## Core Principle

这六条原则是整套方法的认识论底座，后面所有维度都是它们的操作化。**先读原则，再用维度。**

### 不要默认

```text

有引用          = 事实成立

官方文档        = 生产能力成熟

有人做过        = 理论已被验证

一个案例成功    = 普遍规律

论文结果        = 生产效果

benchmark 领先  = 生产更优

多数来源        = 多个独立证据

能部署          = 已成熟

没搜到反证      = 不存在反证

```

### 六条不可违反的原则（epistemic constitution）

这六条不是六个并列的注意事项，而是一条从「我到底想证明什么」到「我最终能说什么」的推理主线。

顺序本身是内容的一部分，不要重排。

```text

1. 结论强度不得超过证据强度。

The strength, specificity, and scope of a claim must not exceed

what the available evidence can justify.

2. 引用不是证据，引用只是证据的入口。

A citation is not evidence; it is an entry point to the evidence.

必须检查引用实际支持了什么，而不是只检查「有没有引用」。

3. 证据到结论之间的推理链必须被单独审查。

Evidence does not automatically become a conclusion.

必须检查证据与结论之间的推理跳跃、隐含前提、替代解释与因果跳跃。

4. 官方文档证明 capability，不自动证明 maturity。

Official documentation can establish documented capability, but does not

by itself establish maturity, reliability, production success, or

operational excellence.

5. 客户案例证明 feasibility，不自动证明 generality。

A customer case can establish that something has been done or is feasible

in a particular context, but does not by itself establish generalizability,

scalability, or broad production success.

6. 缺席的证据不自动构成反证。

Absence of evidence is not automatically evidence of absence.

只有当「某假设成立时，该证据本应以较高概率被观察到」且「搜索、检测与

信息获取过程足够有效」时，「没有发现」才可以作为负证据。

因此：Evidence absence ≠ Negative Product Assessment.

必须先判断 Search Coverage、detection probability、source completeness

与替代解释。

```

**这六条覆盖三个不同的失效模式**，不要以为它们都在说同一件事：

```text

Evidence Quality   证据本身可靠吗？      由 2 保证

Inference Validity 从证据到结论的推理成立吗？由 1、3 保证

Applicability      结论能推广到哪里？     由 4、5 保证

```

### 原则 1 的操作化：证据强度 → 结论强度上限

原则 1 是这六条里最容易被违反、也最少被明文写出的一条。它约束的是****强度升级**，不是**方向****：

```text

证据（官方文档）: "The system supports MCP."

✅ SUPPORTED:  The system supports MCP.

❌ MATURITY:   The system has a mature MCP ecosystem.

❌ STRATEGIC:  This is a production-proven enterprise-grade MCP platform.

```

后两句并不是「错的」，而是****发生了 inferential leap**** —— 中间缺少了支持成熟度的那类证据。

判定时按证据的实际支撑范围反查结论：

| 手上有什么证据 | 最高能支持到什么强度 |

| --- | --- |

| 官方能力文档（单一 T0） | CAPABILITY 级事实陈述；**不得**升级为 MATURITY / COMPARISON / STRATEGIC |

| 官方限制文档（单一 T0） | LIMITATION 级事实陈述（见 §1.2 三条件） |

| 单个客户案例 | 该案例条件下的 feasibility；**不得**升级为 generality |

| 厂商自述的性能数字 | 方向性参考（directional-only）；**不得**作为 COMPARISON 结论 |

| 独立 benchmark（未复现） | 方向性参考；`not usable` 时不得支撑任何比较结论 |

| 独立复现的 benchmark | 可支撑 COMPARISON |

| 多个 IND ≥ 4 的来源 + 生产证据 | 可支撑 MATURITY |

**规则**：写下结论前反过来问一次 —— **「我手上的证据，最多能支持到哪一档？」**

如果结论所在那一档不在上表里对应证据的那一行，就必须降级（DOWNGRADE）或补证据，不能保留。

### 原则 3 的操作化：inferential chain 审查

原则 3 要求把「证据 → 结论」这一步当作独立对象审查，因为前一步成立不保证后一步成立：

```text

Evidence:                Customer X 部署了该产品

↓ 这一步直接确立了：     该产品可以被部署（feasibility）

↓ 这一步隐含了前提：     该客户的环境与目标环境可比

Conclusion:              该产品 production-ready

↑ 这一步还缺：           治理、SLA、成本、失败率、规模化证据

```

审查动作是****把链条画出来，逐段问「这一段是不是直接得到的」****：

```text

Evidence

↓  直接确立了什麼？（directly established）

↓  间接支持了什么？（indirectly supported）

↓  需要哪些额外假设？（additional assumptions）

↓  有没有替代解释能同样解释这些证据？（alternative explanations）

Conclusion

```

四类 Claim 必须走完这条链，缺一不得下结论：

```text

CAUSAL          必须排除替代解释（相关性 ≠ 因果）

STRATEGIC       必须说明隐含前提与它依赖的当前信号

PREDICTION      必须给出可被证伪的信号

RECOMMENDATION  必须写清前提与适用条件

```

与 §3.6 的 Gap 类型配合使用：链条断在哪一环，缺失的就是哪一类 Gap。

### 原则 6 的操作化：缺席何时成为反证

**「缺席的反证 ≠ 反证不存在」不是一个可以无条件使用的绝对命题。**

现代证据论（Bayesian confirmation）的结论是条件性的：

```text

「没有找到」要成为负证据，需要同时满足：

a. 若该假设成立，该证据本应以较高概率被观察到（detection probability 高）

b. 搜索、检测与信息获取过程足够有效（Search Coverage 已覆盖该渠道）

两者缺一，「没有找到」只能记为「未观察到」，不能记为「不存在」。

```

因此原则 6 的判定分两步：

```text

第一步  这个证据，在假设成立时有多容易被观察到？

    ├ 高（官方会公布 / 有合规披露要求 / 有公开 benchmark）→ 缺席有负证据价值，可上调 severity

    └ 低（内部事故 / 失败 POC / 未公开的客户反馈）→ 缺席几乎没有负证据价值

第二步  我们的搜索是否覆盖了它可能出现的渠道？（见 §2.7 Search Coverage）

    ├ 已覆盖 → 「没有证据」是结论

    └ 未覆盖 → 「我们没搜到」，不得作为结论，只能写进 Missing Evidence

```

只有两步都过关，「缺席」才具备负证据价值。常见的高/低检测概率对照：

| 证据类型 | 检测概率 | 缺席的含义 |

| --- | --- | --- |

| 官方 release note / 定价 / 限额 | 高 | 缺席往往意味着确实没有 → 可上调 severity |

| 已受监管行业的合规披露 | 高 | 同上 |

| 独立 benchmark / 学术复现 | 中 | 缺席只表示「尚无人做」，不表示「效果差」 |

| 企业内部事故 / 失败 POC | 低 | **几乎无负证据价值** |

| 客户满意度 / 流失率 | 低 | 同上 |

| 社区负面反馈 | 中（且有 selection bias） | 缺席不构成正证据，出现也不构成普遍性证据 |

结构性原因有四条，它们都属于「检测概率低」这一类：

```text

企业内部事故不会公开

失败 POC 厂商不会公开

客户故事只挑成功案例

社区讨论有强烈的 selection bias（满意的人不发帖）

```

因此对任何 claim，**沉默证据（silent evidence）本身要作为一个字段记录下来**：

「我搜过什么、搜到没有、为什么可能搜不到」。搜不到要写成 `silent_evidence: searched X, no public findings`，

不能默默当成「无问题」。

原则 6 的用法：`independent_sources: 0` 是一个****关于证据结构的结论**，不是一个**关于产品的结论****。

它应当降低 Independence 得分、削弱成熟度类 Claim 的强度，但不得被读成「所以这个产品不行」。

在新产品上这条尤其容易出错 —— GA 时间短、事故不公开、第三方 benchmark 尚少，都会自然产生 `independent_sources = 0`。

正确写法是把两者分开陈述：

```text

❌ 独立来源为 0，因此 Cortex Agent 尚不成熟。

✅ 独立来源为 0（组织级）。因此关于成熟度的结论最高只能到 CONDITIONALLY_SUPPORTED，

不构成对产品成熟度的否定判断。

```

### 四个必须先分开的概念

| 概念 | 回答的问题 | 能否互相推导 |

| --- | --- | --- |

| **Status** | 这个 Claim 目前处于什么状态（支持 / 有条件支持 / 有争议 / 过时 / 证据不足 / 被否定） | 不能 |

| **Confidence** | 就现有证据而言，我有多确定 | 不能 |

| **Sufficiency** | 对这个类型的问题，证据量本身够不够 | 不能 |

| **Independence** | 证据是否独立于利益相关方 | 不能 |

```text

一个事实可以高度确定，同时缺少独立来源。

例：Cortex Agent 支持 MCP → Status: SUPPORTED / Confidence: HIGH / Independence: LOW

一个 Claim 可以证据都真、都很确定，但证据量不足以支撑它。

例：「是金融级成熟平台」只有厂商文档 → Sufficiency: INSUFFICIENT（问题问的是成熟度，给的是能力证据）

```

反过来也一样：大量互不独立的来源不能把 Confidence 推高，只能把「厂商确实这么说过」这件事推高。

---

# 1. Claim Model

## 1.1 Claim 抽取

把文章拆成****最小可验证 Claim****，不要评价整段。

```text

原文：「Cortex Agent 是成熟的企业级 Agent Platform，已适合金融生产。」

拆成：

C1: Cortex Agent 是 Agent Runtime。                    → CAPABILITY

C2: Cortex Agent 支持多步 orchestration。              → CAPABILITY

C3: Cortex Agent 支持 Search / Analyst / Code Execution → CAPABILITY

C4: Cortex Agent 已适合企业生产环境。                   → MATURITY

C5: Cortex Agent 已达到成熟 Agent Platform 水平。       → MATURITY

C6: 上述结论适用于金融行业。                            → MATURITY + Scope

```

六条的取证要求完全不同。**把 MATURITY / COMPARISON / PREDICTION 从句子里拆出来，是这一步的全部意义。**

## 1.2 Claim Type

| Type | 含义 | 该类型最低取证要求 |

| --- | --- | --- |

| FACT | 可直接验证的事实（日期、版本、数值） | 一手来源 + 逐字核对 |

| CAPABILITY | 产品/系统当前支持什么 | 当前官方文档 |

| **LIMITATION** | 产品/系统****不支持****什么、有什么已知限制 | 官方 limitations / known issues 原文 |

| PERFORMANCE | 可测量的性能、准确率、吞吐、延迟、成本 | 一手 + 独立复现 |

| MATURITY | 成熟度、稳定性、生产准备度 | 官方能力 + 生产案例 + 独立反馈 + 已知限制 |

| PRACTICE | 业界实践做法 | 至少两个独立组织的实践 |

| EXPERIENCE | 用户体验 / 社区反馈 | 社区来源 + 明示其代表性局限 |

| COMPARISON | A 优于 B | 独立 benchmark 或 cross-vendor 研究 |

| CAUSAL | A 导致 B | 机制说明 + 排除替代解释 |

| RECOMMENDATION | 架构建议 | 明确前提与适用条件 |

| PREDICTION | 对未来的判断 | 显式标记 + 说明依据的当前信号 |

| STRATEGIC | 战略观点 | 显式标记为立场，不作为事实 |

| OPINION | 主观判断 | 标注为主观 |

**LIMITATION 是独立类型，不是 CAPABILITY 的反面。**「不支持某种 MCP 能力」这句话的取证要求与

「支持 X」不同：它需要官方 limitations 原文，而不是从「文档里没写」反推。

`DEPENDENCY` / `CONSTRAINT` / `REQUIREMENT` 目前不单列，归入 LIMITATION 或 FACT，避免类型无限膨胀。

### Negative Claim（LIMITATION）的取证规则

否定型 Claim 是本类文档最容易误判的一类，因为它允许用****取证不足冒充结论****。判定必须满足三条之一：

```text

1. 官方明确写出 unsupported / not supported / limitation / known issue

2. 官方 schema / API reference / runtime behavior 明确排除该能力

（例如接口清单里根本没有该字段、权限模型不可能表达该操作）

3. 可重复实验确认不支持，且与官方文档不冲突

```

三条都不满足时的处置：

```text

「文档里没找到」        → Status = INSUFFICIENT_EVIDENCE，不得写 REFUTED，也不得写 SUPPORTED LIMITATION

「文档沉默 + 社区有人说不行」 → INSUFFICIENT_EVIDENCE，措辞降为「未见官方支持」

「官方文档明确未提但接口存在」 → 只记为 UNKNOWN，不作结论

```

```text

absence in docs  ≠  explicitly unsupported

```

**规则的对称性**：这条与「缺席的反证 ≠ 反证不存在」是同一个纪律的两面。

肯定句的缺失不能证明否定，否定句的缺失也不能证明肯定 —— 两者都只能落到 `INSUFFICIENT_EVIDENCE`。

一个 LIMITATION 判定为 `SUPPORTED` 时，其 Confidence 最高只能到 **High**，

且****必须指向第 1 或第 2 类依据的原文位置****；只凭第 3 类（实验）时最高 **Medium**，

因为「我测出来不行」不等于「官方定义上不行」，可能只是当前版本、当前配置或当前权限下的行为。

## 1.3 Epistemic Status（与 Claim Type 正交）

**Claim Type 与 Epistemic Status 是两个不同维度，不要压成一个字段。**

```text

Claim Type        这个 Claim 在问哪一类问题？（它是关于什么的问题）

Epistemic Status  这句话本身是事实、推论、预测，还是意见？

```

同一个 Type 可以配不同 Epistemic，同一句 Epistemic 可以出现在不同 Type。举例：

| 原句 | Claim Type | Epistemic |

| --- | --- | --- |

| 「Cortex Agent Evaluations 已于 2026-03-13 GA。」 | FACT | FACT |

| 「Snowflake Cortex Agent 是 Data-Native Managed Agent Runtime。」 | STRATEGIC | INTERPRETATION |

| 「Frontier Agent Runtime primitives 正在快速商品化。」 | PREDICTION / STRATEGIC | INFERENCE |

| 「Cortex Agent 比 LangSmith 更适合金融场景。」 | COMPARISON | OPINION |

取值：

```text

FACT           可核验的事实陈述（日期、版本、数值、官方明确声明）

INFERENCE      由已知证据推导出的结论，本身不是一手观察

PREDICTION     对未来的判断，当前不可核验

OPINION        价值判断或偏好，不存在客观真值

```

判定规则：

- **Type 决定要多少证据，Epistemic 决定这句话的强度上限。**

`CAPABILITY + FACT` 可以由官方文档单独支撑；`CAPABILITY + INFERENCE` 即使内容对，也必须标出它是推导来的。

- **`Epistemic = PREDICTION` 一律不得判 `SUPPORTED`**，最高 `CONDITIONALLY_SUPPORTED`，并显式标注为预测。

- **`Epistemic = OPINION` 不得作为论证前提**，只能作为立场陈述保留。

- **Prediction 伪装成 Fact 是本类文档最常见的问题**：句子用现在时陈述一个尚未发生的结果，就要按 PREDICTION 处理。

- 同一句里混了两种 Epistemic 时，先拆句，再分别判定 —— 例如「X 已 GA（FACT），因此 X 已经成熟（INFERENCE）」是两句，不是一个 Claim。

## 1.4 Scope

**这是最容易被跳过、也最容易出错的一步。**

一个 Claim 即使证据全真，仍然可能因为****证据的适用范围小于 Claim 的适用范围****而不成立。

这属于「证据被错误泛化」，不是「证据造假」，所以用前几节的方法查不出来。

必须为每个 Claim 记录 Scope，并检查：

```text

证据覆盖的 scope  ⊇  claim 主张的 scope   → Scope 有效

证据覆盖的 scope  ⊂  claim 主张的 scope   → Scope Invalid，必须限定或降级

```

Scope 维度清单（按需取，不要求全填）：

| 维度 | 例 |

| --- | --- |

| domain | 金融 / 医疗 / 通用；零售银行 vs 投行 |

| workload | 数据问答 / 检索 / 交易 / 客户通信 / 风控决策 |

| data scale | 单表 <100 万行 / 亿级 / 跨云 |

| risk level | 只读咨询 / 建议 / 有副作用 / 不可逆动作 |

| region & regulation | 中国大陆 / 欧盟 / 美国；是否受 DORA、FSI 约束 |

| deployment model | 平台内托管 / 自建 / 混合 / 跨云 |

| human oversight | 逐动作审批 / 计划审批 / 事后抽检 / 无 |

| org size / team | 有专职 Data Platform 团队 / 无 |

示例：

```text

Claim:   「Snowflake Cortex Search 已经成熟。」

实际证据： 「在 Snowflake-native、中等规模文档检索上工作良好。」

证据 Scope: Snowflake-native + medium scale

不能外推到:  cross-cloud + arbitrary corpus + 受监管的高风险检索

→ Status: CONDITIONALLY_SUPPORTED（限定范围后才成立）

```

## 1.5 Applicability Conditions

**Scope 与 Conditions 是两件事，缺一个都会让结论落不到地。**

```text

Scope        这条 Claim 适用在什么范围内？（domain / workload / scale / region / deployment …）

Conditions   在什么前提满足之后，这条 Claim 才成立？

```

Scope 回答「到哪里为止」，Conditions 回答「拿什么换」。一条 Scope 完全正确的 Claim，

在前提不满足的组织里依然不成立 —— 这是架构评审里最常被忽略的一层。

例子：

```text

Claim:   「Cortex Agent 适合 Snowflake-native 的金融数据分析。」

Scope:   domain=finance · workload=analysis · data=Snowflake-native

Conditions（部分）:

- semantic layer / 业务术语表质量达到可用水平   required

- 检索语料的治理（谁可索引、谁可查）已定义清楚   required

- 用户身份与数据权限已正确映射                   required

- agent 的可用权限集已收敛并有人负责             required

- 写操作有 human approval 通道                   required_for_write

- evaluation 已可用并接入发布流程                recommended

```

判定规则：

- **Conditions 里出现 `required` 而无法确认满足时，Claim 最高只能给 `CONDITIONALLY_SUPPORTED`**，

即使所有证据都真、都当前、都权威。

- Conditions 是****可执行项****，不是免责声明。写「取决于治理成熟度」不算写清条件；

要写成「谁必须提供什么」，才能被核对。

- Conditions 应尽量落在****组织可控制的对象****上（角色、流程、配置、数据质量），

而不是「团队要重视」这类无法核对的说法。

- 一条 Claim 的 Conditions 通常就是它在目标组织里落地的 gap 清单 —— 与 §3.6 的 Gap 类型对齐使用。

```yaml

applicability:

conditions:

\- item: semantic-layer-quality

  level: required

\- item: retrieval-corpus-governance

  level: required

\- item: human-approval-for-write

  level: required\_for\_write

```

## 1.6 Claim Context（Version / Scope Binding）

同一个产品在 `GA` / `Public Preview` / `Private Preview` / `Limited Access` 下****不是同一个事实****。

任何涉及产品能力的 Claim 都必须绑定上下文，否则无法判断时效与有效性。

```yaml

claim_context:

product: Cortex Agent

version_or_release: 2026-09

region: AWS US (cross-region)

availability: GA | Public Preview | Private Preview | Limited Access

api_surface: REST | UI | SDK | SQL

edition_or_plan: Enterprise

date_verified: 2026-09-15

```

规则：

- 缺少 `availability` 的 capability claim，一律不能给 High Confidence。

- `Preview` 状态下不得推导 maturity。

- 引用官方页时同时记录 `date_verified`，因为同一 URL 内容会随版本变化。

- 若官方页把功能放在受限路径（如 `/LIMITEDACCESS/`），`availability` 必须如实写为 Limited Access。

---

# 2. Evidence Model

## 2.1 Evidence Quality — 五个独立维度

证据质量****不是一个分数，而是五个互不替代的轴****。不要把它们平均，也不要让一个轴掩盖另一个轴。

| 维度 | 问题 | 取值 |

| --- | --- | --- |

| **Directness** | 来源是否直接说明这个 Claim | direct / indirect / speculative |

| **Authority** | 来源对****这个具体问题****是否专业权威 | 0–5 |

| **Independence** | 来源是否与利益相关方独立 | IND0–IND5 |

| **Freshness** | 是否当前有效 | current / aging / outdated |

| **Completeness** | 是否同时给出限制条件、反证与上下文 | full / partial / one-sided |

### Directness

- **direct**：来源直接陈述该 Claim。

- **indirect**：由多条信息推导得出（合法分析，但不能伪装成来源结论）。

- **speculative**：只有逻辑推断，无现实证据 → 必须标 `Hypothesis`。

### Authority 是「对这个问题」而言，不是「网站看起来大」

**同一个来源，对不同 Claim 类型的 Authority 完全不同。这是最容易误判的地方。**

Authority 不是一个需要背下来的对照表，而是一个由三件事合成、再被利益冲突扣减的概念模型：

```text

Authority ≈ Expertise × Proximity × Claim-Fit   （再按 conflict of interest 扣减）

```

| 因子 | 问题 |

| --- | --- |

| **Expertise** | 这个主体有没有回答该类问题的专业能力 |

| **Proximity** | 它是否直接接触事实（一手观察 vs 转述 vs 推测） |

| **Claim-Fit** | 它是不是恰好适合回答****这一个****问题 |

| **Conflict of interest** | 结论是否直接有利于它自己 |

用模型反推两个例子，就不需要记忆「厂商=5 / Reddit=3」：

```text

Snowflake Docs → 「Cortex API 支持哪些参数」

Expertise: high     Proximity: high（一手）     Claim-Fit: high      Conflict: n/a

→ Authority 高

Snowflake Docs → 「Cortex Agent 比 LangSmith 更成熟」

Expertise: high     Proximity: high             Claim-Fit: low（不是它的问题）

Conflict: high（结论直接有利于它）

→ Authority 低

```

**规则：当 Claim 是 MATURITY / COMPARISON / PERFORMANCE / CAUSAL 时，利益相关方来源的 Authority 直接降为 1。**

下表是上述模型的****结果****，供快速参考，不必逐项背诵：

| 来源 | 对「该产品支持什么」 | 对「该产品比竞品更成熟」 | 对「我们的生产环境遇到了什么」 | 对「所有企业都会遇到」 |

| --- | --- | --- | --- | --- |

| 厂商官方文档 | 5 | 1（interested party） | 1 | 1 |

| 竞品官方文档 | 5（对自身能力） | 1 | 1 | 1 |

| 独立 benchmark | 3 | 4 | 3 | 3 |

| 第三方生产团队 | 2 | 3 | 4–5 | 2 |

| 社区单帖 | 1 | 1 | 3 | 1 |

### Completeness

| 取值 | 判据 |

| --- | --- |

| full | 同时给出能力、限制、成本或代价、适用范围 |

| partial | 只讲能力或只讲限制 |

| one-sided | 只给有利信息，或只挑反例不讲适用条件 |

厂商营销材料几乎永远是 `one-sided`，即使它引用了真实数据。

## 2.2 Source Type（T0–T5）

Source Type 只描述****来源是哪一类，以及它与事实的距离**。它**不表示**权威等级，也**不表示****独立性 ——

后两者由 2.1 的 Authority / Independence 单独判定。

| Type | 名称 | 典型形态 | 默认 Authority | 默认 Independence |

| --- | --- | --- | --- | --- |

| **T0** | Direct primary artifact | 官方产品文档 / API reference / 规范 / 官方 release notes / 官方源代码 / RFC 与标准正文 / 法规原文 / 原始研究数据 | 5（**仅限该主体自身的事实**） | IND1（自我陈述） |

| **T1** | Independent primary evidence | 独立实验 / 独立 benchmark / peer-reviewed paper / 大规模生产 telemetry / 独立技术报告 | 5 | IND4–5 |

| **T2** | Reputable secondary | 研究机构 / 分析师 / 标准组织整理 / 专业咨询 / 高质量技术媒体 | 3–4 | IND3–4 |

| **T3** | Practitioner report | 企业工程博客 / conference talk / 生产 postmortem / GitHub 真实项目 / 社区论坛帖 | 3（对「我们遇到什么」高，对「普遍如何」低） | IND3–4 |

| **T4** | Vendor positioning | 产品博客 / 客户故事 / sales material / webinar / 发布会 | 2（除该产品自身能力） | IND1 |

| **T5** | Unsourced claim | 「业界都认为」/ 无出处社媒 / 二手转述 / 无来源图 | 0 | 未知 |

**关键规则：T0 的 Authority = 5 只在「回答该主体自己的事实」时成立。**

一旦 Claim 变成比较、成熟度、行业地位，T0 立即退化为 interested party，Authority 降为 1。

这就是为什么「引用全是官方文档」不足以支撑一篇成熟度评估。

## 2.3 Independence（IND0–IND5）

| 级别 | 含义 |

| --- | --- |

| IND5 | 与被评价方无任何关系，方法与数据公开，可复现 |

| IND4 | 独立主体，方法未完全公开 |

| IND3 | 存在间接商业关系（联盟、渠道、集成伙伴、共同投资方） |

| IND2 | 直接生态关系（同一阵营的认证伙伴、被收购方高层） |

| IND1 | 利益相关方（厂商本身、厂商雇用的研究者） |

| IND0 | 与 claim owner 同一主体，且该 Claim 直接有利于它 |

### 「伪多来源」检测

```text

同一公司的 Blog + Docs + Press Release + Webinar + Customer Story

= 5 个链接，1 个来源，IND 不变

```

必查的四种伪多来源：

```text

同一主体的多种载体      （厂商 Blog / Docs / Webinar）

同一文档的镜像或域名变体（.com 与 .cn 同路径 → 被拆成两条引用）

同一来源被复用于多个论点（一条社区帖支撑三处结论）

自引体系                （作者自己另一份文档被当作外部权威）

```

**计数规则：只有 IND ≥ 4 的来源才算「独立佐证」。报告里要写 `independent_sources: 0`。**

## 2.4 Source Correctness（来源与 Claim 是否真的对齐）

这是实操中出错最多的一步。必须逐字核对，**打开来源，而不是相信引用存在**。

```text

Claim：  「支持企业级审计」（Regulatory audit evidence）

来源：   Cortex Agent tracing documentation（只说明 runtime trace）

→ Source Relevance: PARTIAL

→ Claim Overreach: YES

```

### 数值类 Claim 必须回源核

限额、QPS、行数、token 数、价格、GA/Preview 日期、超时值、预算上限 —— 这类 Claim：

```text

最容易被二手转述成错值

+ 错值会被下游直接拿去做容量规划或架构决策

= 必须打开一手页面逐字确认，不接受二次转述

```

**判据**：这个数字，我是从原文看到的，还是从别处的转述看到的？

引用链接存在 ≠ 引用被读过。

## 2.5 Freshness

对每个 Claim 记录：

```text

published_date / product_version / research_date / date_verified

```

必须优先查最新官方资料的高波动 Claim：

```text

API · pricing · product capability · availability（GA/Preview）· security · model support ·

limits · enterprise features · MCP support · cloud services · regulation · industry adoption · benchmark

```

规则：

- 引用厂商研究时，核对三件事：**统计量是否带前提**（percentile / 样本量 / 时间窗 / 对照组）、

**源文是否有后续更新**（趋势回落、数据修订）、**源文自身的限定语是否被保留**。

只取趋势最陡的一段而丢掉前提与回落，属 Freshness 与选择性取证叠加的问题，比单条过时更隐蔽。

- 「源文有更新」时不要直接判旧结论错，而是说明****它改变了什么****。

- 只有 6–12 个月前的二手转述、且期间产品快速迭代 → 标记为 `aging`，重新取证。

## 2.6 Counter-Evidence 与 Silent Evidence

不要只搜支持证据。但****反证搜索的深度由 Claim Type 决定****，不要对所有 Claim 机械地跑同一套查询 ——

那只会产生一堆无关结果，还会把「搜过了」误当成「查清了」。

| Claim Type | 反证搜索要求 |

| --- | --- |

| FACT | 通常无需（官方一手核对即可） |

| CAPABILITY | limitation / deprecated |

| LIMITATION | alternative / current support（反证搜索方向****相反****：去找「其实支持」的证据） |

| PERFORMANCE | benchmark / replication / criticism |

| MATURITY | production / failure / customer feedback |

| COMPARISON | benchmark / alternative / independent study |

| CAUSAL | alternative explanation / confounder |

| PREDICTION | counter-trend / disconfirming signal |

| STRATEGIC | opposing strategy / market movement |

| PRACTICE | alternative practice / failed adoption |

### Counter-Evidence Severity

反证不能只记「有 / 没有」。**「有人吐槽 UI 不好用」与「存在数据越权路径」都叫反证，

但一个不该推翻能力结论，另一个可以直接把架构建议降级。**必须给严重度：

| Severity | 含义 | 对结论的作用 |

| --- | --- | --- |

| **Cosmetic** | 体验、措辞、文档质量问题 | 不改 Status，最多进 P2 |

| **Operational** | 增加运维负担、需要额外流程 | 影响落地条件，进 Applicability Conditions |

| **Economic** | 成本结构不可接受 | 影响适用性判断，可降级为 CONDITIONALLY_SUPPORTED |

| **Reliability** | 均值尚可但尾部失败、行为不稳定 | 削弱 PERFORMANCE / MATURITY，进 Reality Gap |

| **Governance** | 权限、审计、合规、责任归属存在缺口 | 可把架构建议整体降级，必须单列 |

| **Safety / Security** | 数据越权、泄露、不可逆副作用 | 直接进 P0，可推翻原结论（REVERSE / REMOVE） |

**规则：一个 `Severity ≥ Governance` 且已确认的反证，其权重高于任意数量的 `Cosmetic` 反证之和。**

不要用「大多数反馈是正面的」来抵消一条已确认的数据越权路径 —— 严重度不是可平均的量。

产物是两栏，counter 一侧带严重度：

```text

Supporting Evidence   vs   Counter Evidence（severity: Cosmetic | Operational | Economic |

                                                   Reliability | Governance | Safety-Security）

```

### Silent Evidence

同时记录****搜不到什么****以及为什么可能搜不到：

```yaml

silent_evidence:

searched: ["limitations", "production issues", "postmortem", "criticism"]

found: none

plausible_reasons:

\- 企业内部事故不公开

\- 失败 POC 不公开

\- 社区存在 selection bias

```

**搜不到不是清白证明。** 这项为空（= 没搜）与这项为「搜了没找到」是两个完全不同的结论。

## 2.7 Search Coverage（搜索空间覆盖检查）

记录「搜了什么」还不够，还要检查****搜到的结果是否覆盖了搜索空间****。

两者混淆会直接导致错误的普遍性结论：

```text

搜索 Reddit → 找到 9 篇

≠ 社区普遍认为如此

```

存在的偏差至少有五类：

```text

selection bias          满意的人不发帖，发帖的多是遇到问题的人

search engine ranking   高排名的多是 SEO 友好的博客，不是最权威的

survivorship bias       活下来的项目才有人写，失败的没有

language bias           只搜英文会漏掉本地实践（反之亦然）

geographic bias         不同区域的合规与实践差异被抹平

```

因此每条重要 Claim（尤其是 MATURITY / PRACTICE / COMPARISON / STRATEGIC）都要记录覆盖情况：

```yaml

search_coverage:

primary:

official\_docs: yes

release\_notes: yes

independent:

practitioner: yes

benchmark: no

analyst: no

cross\_vendor\_study: no

community:

reddit: yes

github: yes

vendor_side:

competitor\_docs: no

language:

english: yes

chinese: partial

japanese: no

```

**用途**：它是 `independent_sources = 0` 这类结论的****解释依据****。必须能区分两种情况：

```text

没有证据          → 真的搜了多个渠道都没找到（sufficiency 可判 INSUFFICIENT，属证据结构问题）

我们没搜到        → 只搜了英文 Reddit（sufficiency 不得据以下结论，属取证不完整）

```

第二种情况不能写进结论，只能写进 `Missing Evidence`，并说明下一步该搜什么。

### 与原则 6 的连接：detection probability

Search Coverage 只回答「我们搜了没有」；要判断「缺席能否算负证据」，还要回答

**「如果假设成立，这条证据本来有多容易被观察到」**（见 Core Principle 原则 6 的两步判定）。

```yaml

absence_assessment:

searched_channels: [official_docs, release_notes, github, reddit, practitioner_blogs]

coverage_complete: partial          # complete | partial | narrow

detection_probability: low          # high | medium | low

# high   → 若假设成立，该证据大概率会出现（官方披露、强制合规、公开 benchmark）

# low    → 该证据本来就不太会公开（内部事故、失败 POC、客户流失）

conclusion: >

未观察到负面证据。但该品类证据的 detection probability 为 low，

因此「缺席」不构成负证据，也不构成对产品成熟度的否定判断。

```

**三种组合的读法**：

```text

coverage_complete = yes  +  detection_probability = high   → 缺席有负证据价值，可上调 severity

coverage_complete = yes  +  detection_probability = low    → 缺席无负证据价值，只记 silent_evidence

coverage_complete = no   +  任意                            → 不能作任何结论，只记 Missing Evidence

```

## 2.8 Benchmark Validity

Benchmark 是 AI / Agent 领域最危险的一类证据。**benchmark 差值不构成生产优越性。**

`Agent A 85% vs Agent B 80%` 不能推出 A 在生产中更好。必须逐项检查：

| 检查项 | 要看什么 |

| --- | --- |

| Benchmark source | 谁做的？与被测方什么关系？（IND） |

| Dataset provenance | 数据集哪来的？公开 / 内部 / 合成？ |

| Task representativeness | 任务分布是否贴近目标 workload |

| Evaluation protocol | 打分方式、judge 模型、是否 LLM-as-judge |

| Model / runtime version | 是否同一版本、同一配置对比 |

| Prompt contamination | 测试集是否可能进入训练或提示 |

| Data leakage | 评测数据与训练数据是否重叠 |

| Reproducibility | 方法是否公开到可复现 |

| Independent replication | 有没有第三方复现过 |

| Cost normalization | 是否同成本口径（token、调用数、延迟） |

| Failure tail | 是否报告 P99 / 尾部失败，而不只是均值 |

| Human baseline | 有没有人类基线，基线怎么算的 |

输出：

```text

Benchmark Usability: usable / directional-only / not usable

```

只有 `usable` 且经独立复现，才可支撑 COMPARISON 类 Claim。

## 2.9 Evidence Sufficiency（证据量够不够）

这是全 Skill 对 Sufficiency 的唯一 canonical definition。其他章节只引用本节，不重复维护一套 Type → Evidence 规则。

Confidence 问「我有多确定」，Sufficiency 问「对于这个 Claim Type 与结论强度，证据组合够不够」。搜到几条不是 Sufficiency；是否覆盖了该类型所需的决定性维度才是。

2.9.1 三档定义

| Sufficiency | 判据 |
| --- | --- |
| **SUFFICIENT** | 该 Claim Type + 目标结论档位所要求的最低证据组合已齐备，且关键反证/限制没有未处理缺口 |
| **PARTIALLY_SUFFICIENT** | 核心证据存在，但缺少一个会影响结论强度的关键维度；可保留，但必须限定或降级 |
| **INSUFFICIENT** | 证据类型与问题不匹配，或关键决定性证据缺失到无法支撑当前结论 |

2.9.2 各 Claim Type 的最低组合

FACT
  当前一手来源即可；数值/版本/日期必须逐字回一手页面。

CAPABILITY
  当前官方一手来源即可；若涉及权限、区域、版本、API surface，必须绑定 Context。

LIMITATION
  必须满足 §1.2 Negative Claim 三条路径之一；若只看到文档沉默 → INSUFFICIENT。

PERFORMANCE
  一手数据 + 独立复现，或至少存在可比的独立测量；厂商自述只能 directional-only。

MATURITY
  能力证据 + 真实生产证据 + 独立反馈 + 已知限制；只有 vendor sources → INSUFFICIENT。

PRACTICE
  至少两个独立组织的可验证实践；单个案例 → 只能是 EXPERIENCE / feasibility。

EXPERIENCE
  真实用户/实践者来源即可，但必须说明 selection bias / representativeness；
  若 claim 声称 prevalence / consensus，则还需要跨来源的覆盖证据。

COMPARISON
  可比 benchmark / cross-vendor study；若只有 vendor benchmark 或未复现结果 → directional-only / INSUFFICIENT。

CAUSAL
  机制说明 + 替代解释审查 + 足够支持因果方向的证据；缺一不能给强因果结论。

RECOMMENDATION
  必须有明确前提、适用条件、主要反方论点与选择依据；不能只引用 capability。
  因此 RECOMMENDATION 需要走 Level 3 inference-chain 审查。

PREDICTION
  当前信号 + 反趋势检查 + 可被证伪/修正的观察指标；不是「预测正确才算充分」。

STRATEGIC
  当前信号 + 关键前提 + opposing thesis / alternative strategy 检查。

OPINION
  不是客观真值命题；Sufficiency 只评价「作为观点，其依据是否披露充分」，不能把它升级为事实。

Epistemic 对 Sufficiency 的额外约束：

Epistemic = PREDICTION
  → 最低 Level 3；必须有当前信号与反趋势检查。

Epistemic = INFERENCE
  → 检查 inferential chain；证据充分不等于推理自动成立。

Epistemic = OPINION
  → 评价的是论据透明度，不是客观真值。

2.9.3 与 Status / Confidence 的关系

Status = SUPPORTED + Sufficiency = SUFFICIENT
  → 当前结论可以直接使用。

Status = SUPPORTED + Sufficiency = PARTIALLY_SUFFICIENT
  → 可以使用，但必须标明证据缺口并限定结论。

Status = INSUFFICIENT_EVIDENCE + Sufficiency = INSUFFICIENT
  → 不得作为事实性论证前提。

Status = CONDITIONALLY_SUPPORTED + Sufficiency = INSUFFICIENT
  → 只能作为待验证假设，不得写成确定结论。

重要：Sufficiency 是对「证据够不够回答这个问题」的判断，不是对产品好坏的判断。INSUFFICIENT 不等于负面结论。

## 2.10 厂商类 Claim 的四条硬规则

### 规则 1 — 不能用产品文档证明成熟度

以下词必须增加独立证据：

```text

成熟 · 稳定 · 生产可用 · 企业级 · 金融级 · 高性能 · 低成本 · 高可靠 ·

最佳实践 · 领先 · 业界标准 · 已经普遍采用

```

官方文档最多证明 `Capability`，不证明 `Maturity / Reliability / Industry adoption / Best practice`。

### 规则 2 — 不能用单个案例证明普遍规律

```text

Company X successfully uses Agent Y

→ 最多支持「Agent Y 在 Company X 的条件下可行」

→ 不能推出「Agent Y 适合所有企业」

```

必须检查：company size / data architecture / team size / use case / risk level / human oversight / deployment scale。

### 规则 3 — 厂商比较必须避免利益相关方自证

```text

OpenAI says OpenAI Agents are better.

Anthropic says Claude Agents are safer.

Snowflake says Cortex is cheaper.

LangSmith says LangSmith Evaluation is more mature.

```

以上均为 `Vendor Position`，不是 `Industry Fact`。比较类 Claim 优先寻找独立 benchmark、cross-vendor 研究、生产证据。

### 规则 4 — 厂商客户故事只能证明「有人部署过」

看到 `Vendor Customer Story` 时，必须拆成五项分别判定，**不得整体当作成功证据**：

```yaml

customer_claim:

existence:      strong      # 厂商公布客户名 → 相对可信

adoption:       unknown     # 是否真的在用，还是只签了试点

deployment:     unknown     # 架构细节、部署模式

scale:          unknown     # 用户数、数据量、QPS

success:        unknown     # 有没有量化结果

outcome:        unknown     # 业务结果是否独立验证

```

> **Vendor-reported customer usage 证明「有人部署过」，不自动证明「部署成功」。**

---

# 3. Reality Model

## 3.1 Use Case Status — 存在 ≠ 成功

「有没有真实落地」不够。必须区分五种状态：

| Status | 判据 | 能证明什么 |

| --- | --- | --- |

| **Exists** | 有第三方可见的部署事实（客户名 + 场景） | 可行性存在 |

| **Adopted** | 该组织在持续使用（有运维痕迹、后续更新、内部推广） | 已进入使用 |

| **Successful** | 该组织****自称**有量化结果（前后对比、指标改善、时长）—— 注意这是 self-reported | 在该条件下**可能有****效，须再用 §3.2 判定验证方式 |

| **Scaled** | 扩展到多部门 / 多地区 / 大规模，且有治理与成本管理 | 可规模化 |

| **Outcome-verified** | 有****独立验证****的业务结果（审计、财报、第三方评估） | 业务影响成立 |

```text

某银行使用 Claude 做 KYC                        → Exists

KYC 审查时间减少 40%、误报率降低 20%、连续运行一年 → Successful（但由该银行自己公布）

上述结果由独立第三方复核，方法与样本公开            → Outcome-verified

```

**报告里禁止用 Exists 支撑 Successful 级别的结论。**

`Successful` 是五个状态里最容易被误用的一格，因为****它没说清是谁定义的****。

见到 `Successful` 时必须立刻追问 §3.2 的验证方式；`self_reported` 的 Successful 不得与

`independently_verified` 的 Successful 在结论中同等对待。

## 3.2 Outcome Verification（结果由谁验证）

`Successful` 描述「有没有量化结果」，`Outcome Verification` 描述****这个结果是自证的还是被独立验证的****。

两者必须分开记录，否则 `Successful` 会被读成「已被证实有效」。

| Outcome Status | 判据 | 能支撑什么 |

| --- | --- | --- |

| **NONE** | 没有任何结果数据，只有「已上线」 | 只能支撑 Exists / Adopted |

| **SELF_REPORTED** | 由实施方自己给出数字，方法未公开 | 可支撑「在该组织条件下自称有效」，不得外推 |

| **REPRODUCIBLY_REPORTED** | 方法、样本、口径公开，他人可按同一方法复算或复现 | 可支撑「该方法在该条件下可复现」 |

| **INDEPENDENTLY_VERIFIED** | 由无利益关系的第三方独立验证（审计 / 财报 / 第三方评估） | 可支撑业务影响结论 |

```yaml

outcome:

type: SELF_REPORTED

verification: none            # none | method-disclosed | independent

metric: "KYC review time -40%"

baseline: "未披露"

sample: "未披露"

measured_by: "客户方"

```

判定规则：

- **`SELF_REPORTED` 的数字不得在结论中写成既成事实。**必须保留归因：

写「该银行称 / 该客户公布」而不是「效率提升 40%」。

- 从 `SELF_REPORTED` 升到 `REPRODUCIBLY_REPORTED` 的必要条件是****方法与样本公开****；

数字本身量级合理不构成升级理由。

- 「给方法和样本、但由自己公布」仍属 `REPRODUCIBLY_REPORTED`，不是 `INDEPENDENTLY_VERIFIED` ——

独立验证的核心是****验证方与被验证方无利益关系****，不是「写得详细」。

- 与 §3.5 的 Metric Reliability 检查配合使用：Metric Reliability 判****数字可不可信****，

Outcome Verification 判****是谁在背书****。两者都过关才能支撑 Outcome-verified 级结论。

## 3.3 Production Level（L0–L6）

原来的 L4/L5 太主观（「Production」可能只是 10 个内部用户每天用）。

拆成更可验证的六级：

| Level | 名称 | 判据 |

| --- | --- | --- |

| **L0** | Concept | whitepaper / 架构图 / 理念 |

| **L1** | Demo | 官方 demo、tutorial、quickstart |

| **L2** | POC | 内部原型，无真实用户 |

| **L3** | Pilot | 真实部门、小规模、有明确结束日期 |

| **L4** | Production | 真实用户 + 真实业务（**但可能没有任何治理、SLA、成本管理**） |

| **L5** | Operationalized Production | 真实业务 + 治理 + SLA + 成本管理 + 持续运营（有 runbook、on-call、变更控制） |

| **L6** | Scaled / Strategic Production | 大规模 + 关键业务 + **量化 business outcome** + 独立可核验 |

### 两条必须写进结论的规则

```text

Production ≠ Successful      （L4 只说明在跑，不说明跑得好）

Production ≠ Enterprise-grade（L4 不自动等于 L5）

```

大量 AI Agent 的「最佳实践」目前只到 L1–L2。因此要特别警惕这种跳跃：

```text

Architecture Pattern  →  Demo  →  「Enterprise Best Practice」

```

## 3.4 这个案例到底证明了什么

即使有 L4 以上的案例，也要问：**它证明了 Claim 的哪一部分？**

```text

理论：Cortex Agent 可以承担企业核心交易 workflow

案例：某银行用 Cortex Agent 查询研究资料

→ supports:        Data retrieval

→ does NOT support: Trading workflow / Transactional execution / High-risk authorization

→ Evidence Coverage: PARTIAL

```

不得从「读」外推到「写」「审批」「对外通信」。外推一步就要一次单独的取证。

## 3.5 案例描述客观性

每个案例都检查：

```text

Who reports it?           Who benefits from the claim?

What metrics disclosed?   What limitations disclosed?

Failure rates disclosed?  Scale disclosed?

Cost disclosed?           Architecture disclosed?

Human involvement disclosed?

```

遇到「提升效率 30%」必须继续追：30% 是什么？baseline 是什么？样本多少？实验多久？谁测的？有没有对照组？

```text

缺这些信息 → Metric Reliability = LOW

```

## 3.6 Theory-Practice Gap

对重要观点建立 `Theory → Capability → POC → Production` 的坡度，明确 Gap 类型：

| Gap | 含义 |

| --- | --- |

| **Capability** | 理论需要的能力，产品根本没有 |

| **Integration** | 能力存在，但组合起来复杂 |

| **Operational** | Demo 能跑，生产运营困难 |

| **Governance** | Demo 正常，但治理无法满足 |

| **Economic** | 技术可行，成本不可接受 |

| **Reliability** | 均值不错，tail risk 太高 |

| **Organizational** | 技术可行，但 ownership / operating model 不成立 |

**Organizational gap 最常被漏。** 一个控制项由四个角色共有（业务 owner / 数据 owner / 平台 / 架构）时，

通常等于无人负责 —— 这是长期资产腐化的主因，应单独列出。

---

# 4. Review Workflow

## 4.1 Required Actions（按 Claim Type × Epistemic 分三级）

分级不是只看 Claim Type。先判断 Epistemic；只要 Epistemic 更高阶，就按更高等级执行。

Level 1 — Basic Fact
  FACT / CAPABILITY / LIMITATION
  且 Epistemic ∈ {FACT, INFERENCE}

Level 2 — Decision Claim
  PERFORMANCE / MATURITY / PRACTICE / EXPERIENCE / COMPARISON
  且不是 Level 3 条件

Level 3 — Strategic / Inferential Claim
  CAUSAL / RECOMMENDATION / PREDICTION / STRATEGIC / OPINION
  或任何 Claim 的 Epistemic = PREDICTION

优先级规则：Level 3 > Level 2 > Level 1。

例如：FACT × PREDICTION 从语义上通常说明原句有分类错误，但在未拆句前，必须按 Level 3 处理，直到拆成当前事实与未来预测两个 Claim。

Level 1 — Basic Fact

1. Claim 抽取（最小可验证单元）
2. 判定 Type × Epistemic × Polarity
3. 记录 Claim Context（产品/版本/区域/可用状态/API 面/date_verified）
4. 定为一级来源（T0）并逐字核对；数值必须回一手页面
5. 核对 Freshness 与版本
6. 定 Status / Confidence / Sufficiency（按 §2.9）

LIMITATION 额外强制执行 §1.2 Negative Claim 三条路径，并做一次针对“其实支持 / 当前支持”的反向搜索；这属于 Level 1 的必做子程序，不要求把整个 Level 2 跑一遍。

Level 2 — Decision Claim

7. 记录 Scope，检查 Evidence Scope ⊇ Claim Scope
8. 记录 Applicability Conditions（required / required_for_write / recommended）
9. 按 §2.6 的 Claim-Type-specific 反证搜索，给反证定 Severity 与 Strength
10. 记录 Silent Evidence 与 Search Coverage
11. 统计 independent_sources（只计 IND ≥ 4）
12. 搜索真实用例 → Use Case Status（Exists → Outcome-verified）
13. 判定 Outcome Verification（NONE → INDEPENDENTLY_VERIFIED）
14. 判定 Production Level（L0–L6），并明确该案例证明了 Claim 的哪一部分

Level 3 — Strategic / Inferential Claim

15. 建坡道：Theory → Capability → POC → Production，判定 Theory-Practice Gap 类型
16. 完成 inferential_chain 四段：
    directly_established / indirectly_supported / additional_assumptions / alternative_explanations
17. 对 CAUSAL / RECOMMENDATION / STRATEGIC / PREDICTION 构造 opposing thesis / counter thesis，说明为什么弱或强
18. 做反趋势检查：有没有方向相反的当前信号（产品路线图、厂商动作、市场变化、替代技术）
19. 显式标注 Prediction / Strategic，并写出它依赖的当前信号或适用条件

收尾（所有级别）

20. Principle Pre-check：检查明显的原则违规（引用未核对、Negative Claim 无依据、明显 Scope leap 等）
21. 打分 F / S / I / R / T（五维，不平均）
22. 定 Status / Confidence / Sufficiency（三个正交结论；Sufficiency 按 §2.9）
23. Final Principle Check：重新检查结论档位是否超过证据档位、推理链是否完整、缺席是否被误作反证
    若 23 发现需要降级或补证据 → 回到 21 重新评分，再执行 22。不要直接跳到 Rewrite。
24. 给改写建议（KEEP / QUALIFY / DOWNGRADE / REVERSE / REMOVE）
25. 输出 Claim Matrix + 结构化 Claim Record

不要把 Level 1、Level 2、Level 3 机械套到所有 Claim。 级别决定最低检查深度；§2.9 决定最终 Sufficiency 是否足够。

## 4.2 Stop Conditions 与 Continue Conditions

这是本 Skill 从「方法论文章」变成「可执行流程」的关键。Agent 必须按这些条件决定****继续搜还是收工****。

### 必须继续搜索

```text

Claim Type ∈ {PERFORMANCE, MATURITY, COMPARISON, PREDICTION, CAUSAL, RECOMMENDATION, STRATEGIC}

且当前只有单一来源，或全部来源与 claim owner 同一主体

→ 必须找 IND ≥ 4 的来源

Claim 涉及数值（限额 / QPS / 行数 / 价格 / 日期 / 超时 / 预算）

→ 必须打开一手页面逐字确认（不含此法不得给 High）

Claim 涉及可用状态（GA / Preview / Limited Access）

→ 必须查 release notes 或官方 availability 表

Claim 涉及「成熟 / 稳定 / 生产可用 / 企业级 / 最佳实践」

→ 必须至少有一条 L4 以上用例证据，否则不得给 High

Claim 属 COMPARISON 且依据 benchmark

→ 必须完成 Benchmark Validity 检查，否则降为 directional-only

Claim 属 LIMITATION 但只找到「文档没写」的依据

→ 必须继续搜：官方 limitations 页 / API reference 字段清单 / 已知问题列表

```

### 可以停止搜索

```text

FACT / CAPABILITY / LIMITATION（并满足对应 Level 1 条件）

且存在当前（<6 个月）官方一手来源（T0）

且 version / availability / date_verified 已确认

→ 可以停止基础取证。

先按 §2.9 判 Sufficiency，再按 Status / Confidence 判定。

Independence 记为 LOW 并如实报告，不影响 FACT/CAPABILITY 的 Confidence；

counter_evidence 是否搜索过，按 Claim Type 的要求单独记录，不是 SUPPORTED 的必要条件。

```

注意最后一行：**「没有搜到反证」不是 SUPPORTED 的积极条件。**

官方文档写「Supports MCP」，即使没有执行任何反证搜索，这个 FACT 也是 SUPPORTED 的。

反证搜索的产出写进独立的 `counter_evidence` 轴（`none_found / weak / strong`），不参与 Status 判定。

### 必须降级结论（不得直接下结论）

| 情况 | 最低处置 |

| --- | --- |

| 只有厂商来源，Claim 是 MATURITY | 最高 `CONDITIONALLY_SUPPORTED`，独立证据须标 0 |

| 只有单一案例，Claim 是普遍规律 | 必须限定到该案例的 Scope |

| 只有社区轶事（T3），Claim 是 prevalence | Status 记 `INSUFFICIENT_EVIDENCE`，措辞降为「反复出现的问题」 |

| 只有 T5 无出处主张 | `INSUFFICIENT_EVIDENCE`，不得进入结论 |

| 厂商研究被引用但前提 / 更新未核对 | 不得引用该统计量，或必须补齐前提与源文限定语 |

| 有 L4 案例但无治理 / SLA / 成本证据 | 不得推导「企业级成熟」 |

| Claim 的 Applicability Conditions 含未满足的 `required` 项 | 最高 `CONDITIONALLY_SUPPORTED` |

| Counter Evidence 含已确认的 Governance / Security 级反证 | 必须进 P0，并重新评估是否 REVERSE |

| **结论档位超过证据能支持的档位（原则 1）** | **降到证据支持的最高档**，或补证据后再升回 |

| **CAUSAL 未排除替代解释（原则 3）** | 不得下因果结论，降为相关性陈述 |

| **把「未观察到」写成「不存在」（原则 6）** | 撤回该负证据，改为 `silent_evidence` 记录 |

### 必须标 REFUTED

```text

一手来源直接否定该 Claim

或 Claim 描述的是已被 supersede / deprecated 的行为

```

**REFUTED 的门槛高于 INSUFFICIENT_EVIDENCE**：它要求有一手来源****主动否定****，

而不是「搜不到支持证据」。否定型 Claim 尤其容易踩这条（见 §1.2）。

## 4.3 打分：F / S / I / R / T

五个维度各 1–5。**不要把五个维度平均成一个分数。**

```text

F — Fact Strength        事实本身有多确定

S — Source Strength      来源对这个问题有多直接与权威

I — Independence         证据有多独立于利益相关方

R — Reality Strength     有多少真实落地，落到什么程度

T — Timeliness           是否当前有效

```

`I` 是正式维度，不再隐藏在 Source 里 —— 因为「是不是一家之言」是本 Skill 的核心判断之一。

示例：

```yaml

F: 5   # 产品能力事实非常确定

S: 5   # 官方文档直接说明

I: 1   # 但全部来自厂商，无独立来源

R: 3   # 只有 L2–L3 试点

T: 5   # 当前版本

```

结论读法：能力确定、但独立性与现实强度不足 → **可作技术底稿，不可作成熟度背书**。

## 4.4 Status / Confidence / Sufficiency（三个正交结论）

### Status（Claim 处于什么状态）

| Status | 含义 |

| --- | --- |

| `SUPPORTED` | 存在直接、当前、与 Claim 类型匹配的权威证据 |

| `CONDITIONALLY_SUPPORTED` | 证据成立，但 Scope 有限、Applicability Conditions 未满足，或依赖未说明的前提 |

| `CONTESTED` | 存在同等或更强强度的相反证据 |

| `OUTDATED` | 曾成立，已被新版本 / 新数据 / 新实践取代 |

| `INSUFFICIENT_EVIDENCE` | 证据不足，无法判断（**不等于假**） |

| `REFUTED` | 一手来源直接否定 |

**「无反证」不是 SUPPORTED 的积极条件。** 反证是否存在由独立的 `counter_evidence` 轴报告，

不写进 Status 定义 —— 否则会与「缺席的反证 ≠ 反证不存在」自相矛盾，

并且会迫使 Agent 对一条官方明写的能力事实做完反证搜索才敢判 SUPPORTED。

### Counter Evidence Strength（独立轴）

```text

none_found     按该 Claim Type 的最低要求执行搜索后，未发现可靠的 Counter Evidence

weak           已发现 Counter Evidence，但证据直接性/当前性/来源质量不足以与主张抗衡，或影响严重度较低

strong         Counter Evidence 本身具备较高证据强度（direct + current + claim-fit，或有可靠独立 corroboration）

注意：Strength 与 Severity 是两个独立轴。 一条独立但仅影响 UI 的证据可以 strength=strong, severity=Cosmetic；不能因为 strength=strong 就自动改变 Status。

```

判定与读法：

```yaml

status: SUPPORTED

counter_evidence: none_found     # 官方明写支持，未搜到反证 —— 正常组合

```

```yaml

status: SUPPORTED

counter_evidence: weak           # 主体成立，另有轻微反证 —— 进 P2，不改 Status

```

```yaml

status: CONTESTED

counter_evidence: strong         # 反证强度足以与正文对抗

```

**规则**：`counter_evidence = strong` 时不得判 `SUPPORTED`，至少为 `CONTESTED`

或按反证类型降级为 `CONDITIONALLY_SUPPORTED`。但反过来，

`counter_evidence = none_found` **不构成** SUPPORTED 的加分项，它只是「没找到」。

### Confidence（有多确定）

| Confidence | 判据 |

| --- | --- |

| **High** | 对该 Claim 类型存在最权威且直接的当前来源，且没有已确认且足以动摇该结论的强反证；none_found 不是 High 的必要条件。 |

| **Medium** | 有权威一手来源，但缺独立验证或生产证据；或来源 aging |

| **Low** | 仅厂商立场、社区轶事、间接推断，或 Scope 明显大于证据 |

| **Unknown** | 证据不足，不能判断 |

### 关键修正：Confidence 不由独立性决定

```text

FACT / CAPABILITY / LIMITATION（产品支持什么、限制是什么、日期版本）

→ 厂商就是唯一权威来源，独立 corroboration 通常不存在，也不需要

→ 可以给 High，同时如实报 Independence = LOW

PERFORMANCE / MATURITY / COMPARISON / CAUSAL / PREDICTION / STRATEGIC

→ 厂商对该问题的 Authority 本身就很低

→ 不得只凭厂商来源给 High，必须有 IND ≥ 4 的证据

```

因为「一个事实可以高度确定，但缺少独立来源」，把 Independence 强制塞进 Confidence 会让

所有能力事实被系统性误判为 Medium。**两个维度分别报告。**

示例：

```yaml

- claim: Cortex Agent 支持 MCP

status: SUPPORTED

confidence: HIGH

independence: LOW        # 只有官方文档，但这不影响这个事实的确定性

- claim: Cortex Agent 是成熟的企业级 Agent Platform

status: CONDITIONALLY_SUPPORTED

confidence: MEDIUM

independence: LOW        # 成熟度判断必须靠独立证据，此处缺 → 限定范围

```

### Sufficiency（证据量是否够支撑这个问题）

完整判据见 §2.9。这里只强调它与 Confidence 的分工：

```text

Confidence   我有多确定（就手头的证据而言）

Sufficiency  手头的证据，够不够回答这类问题

```

```yaml

- claim: Cortex Agent 支持 MCP

confidence: HIGH

sufficiency: SUFFICIENT          # 能力问题，一份权威一手来源就够

- claim: Cortex Agent 是金融企业级成熟平台

confidence: MEDIUM               # 每条证据本身都不算不可信

sufficiency: INSUFFICIENT        # 但问题问的是成熟度，给的是能力证据

```

**三个结论必须同时给出，缺一个都会导致误读**：

`Confidence` 高但 `Sufficiency` 不足，是最常见的「看起来很有把握、其实答非所问」。

## 4.5 改写动作

| 动作 | 何时用 | 例 |

| --- | --- | --- |

| **KEEP** | Status = SUPPORTED 且 Scope 匹配 | 直接保留 |

| **QUALIFY** | Scope 有限、条件依赖 | 「Cortex Agent 适合企业生产」→「对 Snowflake-native、data-heavy workload，已具备较强生产条件；跨系统高风险 workflow 仍需额外 Control Plane」 |

| **DOWNGRADE** | 证据只支持较弱形态 | 「未来所有 Agent 都会通过 MCP」→「MCP 很可能成为重要的 Tool interoperability layer」（并标 Prediction） |

| **REVERSE** | 反证更强，方向应反向 | 原判断为「X 是缺口」而证据显示已被覆盖 |

| **REMOVE** | 证据弱 + 反证显著 + 无落地验证 | 直接删除 |

**常见改写触发句式**（见到就要查）：

| 句式 | 掩盖了什么 | 怎么处理 |

| --- | --- | --- |

| 「有人认为…也有人认为…」 | 把****已知限制****写成观点分歧 | 去查官方 limitations，翻成限制清单 |

| 「实际使用者反馈呈现…共识」 | 用少量社区帖冒充 prevalence | 数来源；≤10 条社区帖不能叫共识 |

| 「已具备…能力，不止…」 | 把****有滞后的机制****写成即时生效 | 查触发周期、延迟上限、覆盖范围 |

| 「业界普遍认为」 | 无出处（T5） | 找一手来源，找不到则删 |

## 4.6 最终输出模板

````text

# Evidence & Claim Review

## Overall Verdict

（分层给结论：Fact/Capability 层 / Maturity 层 / Comparison 层 / Prediction·Strategic 层。

每层给 Confidence + Independence + Sufficiency；只汇总 Claim Matrix 已判定结果，不得在 Overall Verdict 重新发明一套评分规则。）

## Critical Findings

### P0

（两类分开写：P0-A 单点事实错 / P0-B 证据结构缺层）

### P1

### P2

## Claim Matrix

| # | Claim | Type | Epistemic | Polarity | Scope | Applicability | Direct | Authority | Independence | Freshness | Counter Strength | Severity | Reality / Production | Outcome Verification | Status | Conf | Suff | Rewrite |

## Counter Evidence

（每条带 Severity：Cosmetic / Operational / Economic / Reliability / Governance / Safety-Security）

## Silent Evidence

（搜了什么 / 搜到什么 / 为什么可能搜不到）

## Search Coverage

（primary / independent / community / vendor_side / language 各覆盖了什么）

## Real-world Evidence

（Use Case Status + Outcome Verification + Production Level + 这个案例证明了什么）

## Applicability Conditions

（每条 Claim 成立所需的 required / required_for_write / recommended 前提）

## Theory / Practice Gaps

## Scope Warnings

（哪些结论被错误泛化，应限定到哪里）

## Principle Check

（六条原则的违规清单；没有违规就写 none）

结论强度超过证据强度:  （逐条列出，写明原结论 → 证据能支持的最高档）

推理链断裂:            （CAUSAL / STRATEGIC / PREDICTION / RECOMMENDATION 中 inferential_chain 缺失或替代解释未处理）

缺席被当作反证:        （被误用的负证据，及其 detection probability）

## Claims That Should Be Rewritten

Original: …

Recommended: …

Action: QUALIFY / DOWNGRADE / REVERSE

## Claims That Should Be Removed

## Missing Evidence

（按补齐价值排序；写明「如果只能补一条，补什么」）

## Final Assessment

Fact strength:

Source strength:

Independence:

Reality strength:

Timeliness:

Status 分布:

Overall confidence（分层）:

Sufficiency 分布:

Principle 违规数:

````

## 4.7 结构化 Claim Record

审核产物应可机器读取，便于后续复用于架构评审、技术雷达或产品比较。

```yaml

claim:

text: "Cortex Agent is production-ready for financial services"

type: MATURITY                                   # 问的是哪类问题

epistemic: INTERPRETATION                        # 这句话本身是事实/推论/预测/意见

polarity: affirmative                            # affirmative | negative；由 Claim 的断言方向决定

inference_chain:

directly\_established: \"\"

indirectly\_supported: \"\"

additional\_assumptions: []

alternative\_explanations: []

claim\_leap\_detected: false

context:

product: Cortex Agent

version_or_release: 2026-09

region: AWS US

availability: GA                                 # GA | Public Preview | Private Preview | Limited Access

api_surface: REST

edition_or_plan: Enterprise

date_verified: 2026-09-15

scope:

domain: financial-services

workload: data-analysis

data_scale: medium

risk_level: read-only-advisory

region_regulation: [US, EU]

deployment_model: platform-managed

human_oversight: plan-approval

org_size: large

excluded: [transactional-execution, customer-communication]

applicability:                                     # 什么条件下这条 Claim 才成立

conditions:

\- item: semantic-layer-quality

  level: required

\- item: retrieval-corpus-governance

  level: required

\- item: entitlement-model-alignment

  level: required

\- item: human-approval-for-write

  level: required\_for\_write

\- item: evaluation-in-release-pipeline

  level: recommended

evidence:

- type: T0

source: official-doc

directness: direct

authority: high            # 仅对「支持什么」有效

independence: IND1

freshness: current

completeness: partial      # 未覆盖全部限制

- type: T3

source: practitioner-blog

directness: experience

authority: medium

independence: IND3

freshness: current

completeness: one-sided

independent_sources: 0         # 只计 IND ≥ 4

counter_evidence:

strength: weak               # none_found | weak | strong

items:

\- text: "MCP 行为不参与 evaluation"

  severity: Operational

\- text: "replay 不传 session attributes"

  severity: Operational

\- text: "服务以 owner's rights 运行，USAGE 即等于 owner 读权限"

  severity: Governance

  confirmed: true

silent_evidence:

searched: ["limitations", "production issues", "postmortem"]

found: none

plausible_reasons: ["企业内部事故不公开", "失败 POC 不公开", "产品 GA 时间短"]

search_coverage:

primary: { official_docs: yes, release_notes: yes }

independent: { practitioner: yes, benchmark: no, analyst: no }

community: { reddit: yes, github: yes }

vendor_side: { competitor_docs: no }

language: { english: yes, chinese: partial }

absence_assessment:                # 原则 6：缺席能否算负证据

coverage_complete: partial       # complete | partial | narrow

detection_probability: low       # high | medium | low

verdict: no_negative_evidence    # negative_evidence | no_negative_evidence | inconclusive

inference_chain 已在 claim 顶层字段示例中定义；实际输出时仅填一次。

real_world:

existence: proven

status: Adopted                # Exists | Adopted | Successful | Scaled | Outcome-verified

production_level: L4

outcome:

type: SELF\_REPORTED

verification: none           # none | method-disclosed | independent

evidence_coverage: partial     # 只覆盖 retrieval，不覆盖 execution

scale: unknown

gaps: [operational, governance, economic]

assessment:

status: CONDITIONALLY_SUPPORTED

confidence: MEDIUM

sufficiency: INSUFFICIENT      # 问的是成熟度，给的是能力证据

fact_strength: 4

source_strength: 4

independence: 1

reality_strength: 3

timeliness: 5

recommendation:

action: QUALIFY

wording: >

Cortex Agent 是 Snowflake-native、data-heavy workload 的强候选；

跨系统、高风险、有副作用的 workflow 仍需额外 Control Plane。

```

---

# 附录 A — 检索词模板

先按 §2.6 的 Claim-Type 反证要求决定要搜哪些 Evidence Family，再从下面的 Query Family 组合词。不要把「产品名」当成唯一锚点。

A.1 Query Family：实体锚点

Product / feature:
"<product>"
"<feature>"
"<api / capability>"

Category / ecosystem:
"<category>" enterprise
"<category>" production
"<category>" maturity
"<category>" benchmark

Benchmark / dataset / eval suite:
"<benchmark name>"
"<dataset name>"
"<evaluation suite>"
"<benchmark name>" replication
"<benchmark name>" criticism

Customer / organization:
"<customer>" "<product>"
"<customer>" production
"<customer>" case study
"<customer>" architecture

Industry / analyst:
"<category>" Gartner
"<category>" Forrester
"<category>" analyst
"<category>" market report

Practice / incidents:
"<technology>" postmortem
"<technology>" incident
"<technology>" migration
"<technology>" failure
"<technology>" lessons learned

规则：至少选择一个 Product/Feature 锚点，另加一个 Category / Benchmark / Customer / Analyst / Practice 锚点；不要只跑产品名查询。

A.2 技术产品 / Capability

"<product>" official documentation
"<product>" release notes
"<product>" availability
"<product>" GA
"<product>" preview
"<product>" API reference
"<feature>" documentation
"<feature>" limitations
"<feature>" known issues
"<feature>" deprecated
"<feature>" alternative

A.3 Performance / Benchmark

"<product>" benchmark
"<product>" evaluation
"<product>" performance
"<benchmark name>"
"<benchmark name>" replication
"<benchmark name>" independent
"<benchmark name>" criticism
"<category>" benchmark
"<category>" cross-vendor comparison
"<dataset name>" benchmark

A.4 Maturity / Production

"<product>" production
"<product>" production architecture
"<product>" postmortem
"<product>" incident
"<product>" reliability
"<product>" outage
"<product>" enterprise adoption
"<category>" production adoption
"<category>" failure
"<category>" lessons learned

A.5 Customer / Feasibility / Generality

"<product>" customer case study
"<customer>" "<product>"
"<customer>" production
"<customer>" architecture
"<customer>" scale
"<customer>" outcome
"<customer>" benchmark
"<category>" customer adoption
"<category>" implementation

厂商客户故事只能作为 vendor-reported evidence；发现客户名后，应切换到客户名锚点继续检索，而不是继续只搜产品名。

A.6 Analyst / Industry

"<category>" Gartner
"<category>" Forrester
"<category>" analyst
"<category>" Magic Quadrant
"<category>" Wave
"<category>" market report
"<category>" industry analysis
"<category>" independent research

这组 Query Family 用于填充 search_coverage.independent.analyst。没有任何 analyst 检索词时，不得把 analyst: no 解释为「没有分析师证据」；只能写「未覆盖 analyst channel」。

A.7 Counter-Evidence

按 Claim Type 选择反方向词：

CAPABILITY      limitations / unsupported / deprecated / missing / workaround
LIMITATION      supported / now supports / added / GA / feature update
PERFORMANCE     replication / criticism / independent benchmark / tail latency / cost
MATURITY        failure / incident / production issue / customer complaint / postmortem
COMPARISON      alternative / independent comparison / cross-vendor / benchmark criticism
CAUSAL          confounder / alternative explanation / correlation / replication
PREDICTION      contrary trend / disconfirming evidence / reversal / adoption slowdown
STRATEGIC       opposing strategy / competitor move / market reversal / substitution
PRACTICE        alternative practice / failed adoption / organization-specific
RECOMMENDATION  counter-case / downside / alternative architecture / trade-off

A.8 Research / Paper

"<paper title>" original paper
"<topic>" systematic review
"<topic>" benchmark
"<topic>" replication
"<topic>" criticism
"<topic>" negative result
"<topic>" meta-analysis

A.9 Vendor-reported metrics

"<report name>" methodology
"<report name>" updated
"<report name>" revised
"<report name>" corrigendum
"<statistic>" percentile
"<statistic>" sample size
"<statistic>" time window
"<statistic>" baseline
"<statistic>" control group

A.10 Search Coverage minimum

对 MATURITY / PRACTICE / COMPARISON / STRATEGIC，至少记录：

primary          official docs / release notes
independent      practitioner / benchmark / analyst（按问题需要）
community        Reddit / GitHub / forums（若使用）
vendor_side      competitor / vendor ecosystem（若有价值）
entity           product / category / benchmark / customer 中实际使用的锚点
language         实际搜索过的语言

search_coverage 记录的是搜索空间是否被覆盖，不是「结果有多少」。一个 analyst / benchmark / customer 槽位为 no，必须能够说明它是「真的搜过没找到」还是「根本没搜」。

---

# 附录 B — 术语与编号约定

## B.1 五维证据质量

```text

Directness     direct / indirect / speculative

Authority      0–5，且「对这个问题」而言，不是「网站看起来大」

Independence   IND0–IND5，只有 IND ≥ 4 计入 independent_sources

Freshness      current / aging / outdated

Completeness   full / partial / one-sided

```

## B.2 Source Type

```text

T0  Direct primary artifact        官方文档 / 规范 / release notes / 源码 / 法规原文 / 原始数据

T1  Independent primary evidence   独立实验 / 独立 benchmark / 论文 / 生产 telemetry

T2  Reputable secondary            研究机构 / 分析师 / 标准组织 / 专业咨询

T3  Practitioner report            工程博客 / conference talk / postmortem / 社区帖

T4  Vendor positioning             产品博客 / 客户故事 / 营销材料

T5  Unsourced claim                无出处主张

```

## B.3 与 v1.x 的编号对照

v1 的单一等级 `S0–S5` 把「来源类型」「权威性」「独立性」混在一根轴上，v2 已拆开：

| v1 | v2 的读法 |

| --- | --- |

| S0 Direct Primary Source | 现在拆成 **T0**（自身事实，Authority 5 / IND1）与 **T1**（独立一手，Authority 5 / IND4–5）。判定时必须先问「这条 Claim 是主体自己的事实，还是对主体的评价」 |

| S1 Independent Primary Evidence | **T1** |

| S2 Reputable Secondary | **T2** |

| S3 Community Evidence | **T3** |

| S4 Vendor Marketing | **T4** |

| S5 Unsourced | **T5** |

历史文档里若出现 `S0–S5`，按上表解读，**不要**默认「S0 = 最高质量证据」。

## B.4 三个正交结论

```text

Status       SUPPORTED / CONDITIONALLY_SUPPORTED / CONTESTED / OUTDATED /

         INSUFFICIENT\_EVIDENCE / REFUTED

Confidence   High / Medium / Low / Unknown

Sufficiency  SUFFICIENT / PARTIALLY_SUFFICIENT / INSUFFICIENT

```

Status 描述 Claim 的状态，Confidence 描述确定性，Sufficiency 描述证据量是否够回答该问题；

Independence 与 Counter Evidence Strength 单独报告。五者不可互推。

```text

一个 Claim 可以 Confidence = HIGH 而 Sufficiency = INSUFFICIENT

（每条证据都可信，但答的不是这个问题）

```

## B.5 正交字段与枚举

Claim 的两个正交字段：

```text

type        FACT / CAPABILITY / LIMITATION / PERFORMANCE / MATURITY / PRACTICE / EXPERIENCE /

        COMPARISON / CAUSAL / RECOMMENDATION / PREDICTION / STRATEGIC / OPINION

epistemic   FACT / INFERENCE / PREDICTION / OPINION

polarity    affirmative / negative

OPINION 的消歧：type=OPINION 表示「这是一种主观判断」；epistemic=OPINION 表示「作者不主张它具有可客观核验的真值」。二者可以同时出现，但不是同一个维度。

```

反证与验证相关枚举：

```text

counter_evidence.strength   none_found / weak / strong   # 证据对抗强度；与 severity 分开

counter_evidence.severity   Cosmetic / Operational / Economic / Reliability /

                        Governance / Safety-Security

outcome.type                NONE / SELF_REPORTED / REPRODUCIBLY_REPORTED / INDEPENDENTLY_VERIFIED

outcome.verification        none / method-disclosed / independent

applicability.conditions.level   required / required_for_write / recommended

absence_assessment.coverage_complete   complete / partial / narrow

absence_assessment.detection_probability   high / medium / low

absence_assessment.verdict  negative_evidence / no_negative_evidence / inconclusive

```

## B.6 六条原则与维度的对应关系

原则层不重复维度的定义，它规定****每个维度在什么条件下失效****。查维度的落点用这张表：

| 原则 | 主要落点 | 失效时怎么处理 |

| --- | --- | --- |

| 1 结论强度 ≤ 证据强度 | Core Principle 的上限表；§4.1 第 19 步；§4.2 降级表 | 降到证据支持的最高档，或补证据 |

| 2 引用 ≠ 证据 | §2.4 Source Correctness（逐字核对） | 打开原文；数值必回一手页面 |

| 3 推理链须单独审查 | `inference_chain` 字段；§4.1 Level 3；§3.6 Gap | 画出链条，逐段问「直接确立了什么」 |

| 4 capability ≠ maturity | §1.2 MATURITY 取证要求；§2.10 规则 1 | 补独立 + 生产 + 限制证据 |

| 5 feasibility ≠ generality | §2.10 规则 2；§3.4 案例证明了什么 | 限定到该案例的 Scope |

| 6 缺席不自动构成反证 | §2.7 detection probability；`absence_assessment` | 撤回负证据，改记 silent_evidence |

## B.7 使用场景

同一套模型可直接用于：

```text

Architecture Review        审架构文档里的结论是否站得住

Vendor Evaluation          审厂商材料与客户故事

Technology Radar           决定一项技术进入哪个环

Product Comparison         审 benchmark 与比较结论

Research Review            审论文与研究报告的传播版本

AI Capability Assessment   审「模型/平台能不能做 X」

```

## B.8 v2.2 变更总账（执行收敛版）

v2.2 不增加新的核心维度，只修复 v2.1.1 在真实执行中暴露的召回、分级、重复定义与流程循环问题：

搜索层
  Appendix A 从「产品名锚点」扩展为 Product / Category / Benchmark / Customer / Analyst / Practice 多锚点
  补齐 analyst query family，并明确 no = 未覆盖还是搜过未发现

分级层
  Level 改为 Claim Type × Epistemic 的最高级规则
  LIMITATION 的反向支持搜索变成 Level 1 必做子程序，不再与 Level 2 冲突
  RECOMMENDATION 统一进入 Level 3 inference-chain

证据层
  Evidence Ceiling 增加 Vendor Customer Story、Production、Outcome 的明确上限
  LIMITATION 的最低证据定义只保留一处 canonical rule
  Sufficiency 全部统一到 §2.9，覆盖全部 Claim Type

反证层
  Counter Evidence Strength 与 Severity 正交；不再用「IND ≥ 4」直接等同 strong
  High Confidence 不再要求「无反证」；只要求没有已确认且足以动摇结论的强反证

Reality 层
  customer_claim / Use Case Status / Outcome Verification / Production Level 明确映射
  禁止四套枚举互相自动升级

输出层
  Claim Matrix 补 Polarity / Applicability / Outcome Verification / Production Level
  inference_chain 只保留一份 canonical 字段
  Principle Check 改为 pre-check + final check，发现降级时回到评分步骤重新判定

维护原则
  不新增新的核心维度；后续优先修边界、枚举与流程，不再扩张模型

冻结条件：后续发现问题，优先修改现有字段的判据、映射或流程顺序；只有发现「当前模型无法表达一个反复出现的独立证据问题」时，才考虑增加新维度。