---
name: evidence-and-claim-review
version: 2.0.0
description: 审核技术文章、架构报告、产品与行业分析中的观点、论据和结论是否站得住。先把文章拆成最小可验证的 Claim 并判定类型（FACT / CAPABILITY / LIMITATION / PERFORMANCE / MATURITY / PRACTICE / EXPERIENCE / COMPARISON / CAUSAL / RECOMMENDATION / PREDICTION / STRATEGIC / OPINION），记录 Claim Context（产品 / 版本 / 区域 / 可用状态 / API 面 / 核对日期）与 Scope，再把证据拆成五个独立维度评估（Directness / Authority / Independence / Freshness / Completeness），主动搜索反例与沉默证据，验证真实用例的「存在 / 采用 / 成功 / 规模化 / 结果已证」，判定理论与实践的鸿沟，最后按 F/S/I/R/T 五维打分，给出 Status 与 Confidence 两个正交结论及改写建议。用于事实核查、引用核查、行业报告审视、AI 与云产品能力与成熟度评估、厂商宣传与 benchmark 可信度判断、文章发布前审稿、架构评审与厂商评估。触发词：事实核查、claim review、evidence review、可信度评估、来源审查、引用核查、是否过时、找反例、落地案例、成熟度、生产可用、benchmark 可信吗、厂商宣传、一家之言、独立验证、scope 适用性。
---

# Evidence & Claim Review

## Purpose

判断一个观点**现在到底有多可信**：事实是否成立、来源是否真实直接、是否权威且独立、是否仍然有效、
有没有真实落地、落地到底证明了什么、适用到哪里、理论与实际差多少，以及今天是否还能据此做决策。

本 Skill 不产出「支持这个观点的链接清单」。它产出：

> **Claim → Type → Scope → Evidence → Directness → Authority → Independence → Freshness →
> Counter-evidence → Use Case → Outcome → Reality Gap → Status → Confidence → Rewrite**

这是一个可复用于架构评审、厂商评估、技术雷达、产品比较、研究报告审稿的 Evidence Review Engine。

## Core Principle

### 不要默认

```text
有引用          = 事实成立
官方文档        = 生产能力成熟
有人做过        = 理论已被验证
一个案例成功    = 普遍规律
论文结果        = 生产效果
benchmark 领先  = 生产更优
多数来源        = 多个独立证据
```

### 四条不可违反的原则

```text
引用不是证据，引用只是证据的入口。
官方文档证明 capability，不自动证明 maturity。
客户案例证明 feasibility，不自动证明 generality。
缺席的反证 ≠ 反证不存在。（Absence of counter-evidence ≠ Evidence of absence）
```

第四条尤其重要。没有搜到负面信息，通常只是因为你没搜到，而不是因为没有。结构性原因有四条：

```text
企业内部事故不会公开
失败 POC 厂商不会公开
客户故事只挑成功案例
社区讨论有强烈的 selection bias（满意的人不发帖）
```

因此对任何 claim，**沉默证据（silent evidence）本身要作为一个字段记录下来**：
「我搜过什么、搜到没有、为什么可能搜不到」。搜不到要写成 `silent_evidence: searched X, no public findings`，
不能默默当成「无问题」。

### 三个必须先分开的概念

| 概念 | 含义 | 能否互相推导 |
| --- | --- | --- |
| **Confidence** | 对这个 Claim，现有证据够不够确定 | 不能 |
| **Independence** | 证据是否独立于利益相关方 | 不能 |
| **Status** | 这个 Claim 目前处于什么状态（支持 / 有条件支持 / 有争议 / 过时 / 证据不足 / 被否定） | 不能 |

```text
一个事实可以高度确定，同时缺少独立来源。
例：Cortex Agent 支持 MCP → Status: SUPPORTED / Confidence: HIGH / Independence: LOW
```

反过来也一样：大量互不独立的来源不能把 Confidence 推高，只能把「厂商确实这么说过」这件事推高。

---

# 1. Claim Model

## 1.1 Claim 抽取

把文章拆成**最小可验证 Claim**，不要评价整段。

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
| **LIMITATION** | 产品/系统**不支持**什么、有什么已知限制 | 官方 limitations / known issues 原文 |
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

## 1.3 Fact / Interpretation / Prediction 分离

每个 Claim 必须归入且只归入一类：

```text
Fact           「Cortex Agent Evaluations 已 GA。」          官方 release note 可证
Interpretation 「Snowflake Evaluation 已经比较成熟。」        需多来源
Prediction     「未来 Evaluation 会成为核心竞争力。」          必须显式标注
```

不要把三者混在同一句里。**Prediction 伪装成 Fact 是本类文档最常见的问题。**

## 1.4 Scope / Applicability

**这是最容易被跳过、也最容易出错的一步。**

一个 Claim 即使证据全真，仍然可能因为**证据的适用范围小于 Claim 的适用范围**而不成立。
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

## 1.5 Claim Context（Version / Scope Binding）

同一个产品在 `GA` / `Public Preview` / `Private Preview` / `Limited Access` 下**不是同一个事实**。
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

证据质量**不是一个分数，而是五个互不替代的轴**。不要把它们平均，也不要让一个轴掩盖另一个轴。

| 维度 | 问题 | 取值 |
| --- | --- | --- |
| **Directness** | 来源是否直接说明这个 Claim | direct / indirect / speculative |
| **Authority** | 来源对**这个具体问题**是否专业权威 | 0–5 |
| **Independence** | 来源是否与利益相关方独立 | IND0–IND5 |
| **Freshness** | 是否当前有效 | current / aging / outdated |
| **Completeness** | 是否同时给出限制条件、反证与上下文 | full / partial / one-sided |

### Directness

- **direct**：来源直接陈述该 Claim。
- **indirect**：由多条信息推导得出（合法分析，但不能伪装成来源结论）。
- **speculative**：只有逻辑推断，无现实证据 → 必须标 `Hypothesis`。

### Authority 是「对这个问题」而言，不是「网站看起来大」

**同一个来源，对不同 Claim 类型的 Authority 完全不同。这是最容易误判的地方。**

| 来源 | 对「该产品支持什么」 | 对「该产品比竞品更成熟」 | 对「我们的生产环境遇到了什么」 | 对「所有企业都会遇到」 |
| --- | --- | --- | --- | --- |
| 厂商官方文档 | 5 | 1（interested party） | 1 | 1 |
| 竞品官方文档 | 5（对自身能力） | 1 | 1 | 1 |
| 独立 benchmark | 3 | 4 | 3 | 3 |
| 第三方生产团队 | 2 | 3 | 4–5 | 2 |
| 社区单帖 | 1 | 1 | 3 | 1 |

**规则：当 Claim 是 MATURITY / COMPARISON / PERFORMANCE / CAUSAL 时，利益相关方来源的 Authority 直接降为 1。**

### Completeness

| 取值 | 判据 |
| --- | --- |
| full | 同时给出能力、限制、成本或代价、适用范围 |
| partial | 只讲能力或只讲限制 |
| one-sided | 只给有利信息，或只挑反例不讲适用条件 |

厂商营销材料几乎永远是 `one-sided`，即使它引用了真实数据。

## 2.2 Source Type（T0–T5）

Source Type 只描述**来源是哪一类，以及它与事实的距离**。它**不表示**权威等级，也**不表示**独立性 ——
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
- 「源文有更新」时不要直接判旧结论错，而是说明**它改变了什么**。
- 只有 6–12 个月前的二手转述、且期间产品快速迭代 → 标记为 `aging`，重新取证。

## 2.6 Counter-Evidence 与 Silent Evidence

不要只搜支持证据。对每个重要 Claim 至少执行这些检索变体：

```text
"<claim>" limitations
"<claim>" known issues
"<claim>" deprecated  /  superseded  /  migration
"<claim>" production issues  /  postmortem  /  incident
"<claim>" criticism  /  alternative  /  benchmark
"<claim>" release notes  /  GA  /  preview
```

产物是两栏：

```text
Supporting Evidence   vs   Counter Evidence
```

### Silent Evidence

同时记录**搜不到什么**以及为什么可能搜不到：

```yaml
silent_evidence:
  searched: ["limitations", "production issues", "postmortem", "criticism"]
  found: none
  plausible_reasons:
    - 企业内部事故不公开
    - 失败 POC 不公开
    - 社区存在 selection bias
```

**搜不到不是清白证明。** 这项为空（= 没搜）与这项为「搜了没找到」是两个完全不同的结论。

## 2.7 Benchmark Validity

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

## 2.8 厂商类 Claim 的四条硬规则

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
| **Successful** | 该组织自己公布量化结果（前后对比、指标改善、时长） | 在该条件下有效 |
| **Scaled** | 扩展到多部门 / 多地区 / 大规模，且有治理与成本管理 | 可规模化 |
| **Outcome-verified** | 有独立验证的业务结果（审计、财报、第三方评估） | 业务影响成立 |

```text
某银行使用 Claude 做 KYC                        → Exists
KYC 审查时间减少 40%、误报率降低 20%、连续运行一年 → Successful
上述结果由该银行工程博客给出方法与样本              → 接近 Outcome-verified
```

**报告里禁止用 Exists 支撑 Successful 级别的结论。**

## 3.2 Production Level（L0–L6）

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

## 3.3 这个案例到底证明了什么

即使有 L4 以上的案例，也要问：**它证明了 Claim 的哪一部分？**

```text
理论：Cortex Agent 可以承担企业核心交易 workflow
案例：某银行用 Cortex Agent 查询研究资料

→ supports:        Data retrieval
→ does NOT support: Trading workflow / Transactional execution / High-risk authorization
→ Evidence Coverage: PARTIAL
```

不得从「读」外推到「写」「审批」「对外通信」。外推一步就要一次单独的取证。

## 3.4 案例描述客观性

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

## 3.5 Theory-Practice Gap

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

## 4.1 Required Actions

按顺序执行，不得跳步。每一步都要留下可核对的记录。

```text
 1. 抽取 Claim（最小可验证单元）
 2. 判定 Claim Type（表 1.2）
 3. 记录 Claim Context（产品/版本/区域/可用状态/API 面/核对日期）
 4. 记录 Scope，并检查 Evidence Scope ⊇ Claim Scope
 5. 定位现有来源 → 归类 Source Type（T0–T5）
 6. 打开一手来源，逐字核对 Source-Claim 对齐（数值必查）
 7. 核对时效与版本；厂商研究类核对前提 / 更新 / 限定语
 8. 搜索反例（≥4 个检索变体）并记录 Silent Evidence
 9. 搜索独立证据，统计 independent_sources 数量
10. 搜索真实用例，判定 Use Case Status（Exists→Outcome-verified）
11. 判定 Production Level（L0–L6）
12. 判定 Evidence Coverage：这个案例证明了 Claim 的哪一部分
13. 判定 Theory-Practice Gap 类型
14. 打分：F / S / I / R / T（五维，不平均）
15. 定 Status 与 Confidence（两个正交结论）
16. 给改写建议（KEEP / QUALIFY / DOWNGRADE / REVERSE / REMOVE）
17. 输出 Claim Matrix + 结构化 Claim Record
```

## 4.2 Stop Conditions 与 Continue Conditions

这是本 Skill 从「方法论文章」变成「可执行流程」的关键。Agent 必须按这些条件决定**继续搜还是收工**。

### 必须继续搜索

```text
Claim Type ∈ {PERFORMANCE, MATURITY, COMPARISON, PREDICTION, CAUSAL}
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
```

### 可以停止搜索

```text
Claim Type ∈ {FACT, CAPABILITY, LIMITATION}
  且存在当前（<6 个月）官方一手来源（T0）
  且 version / availability / date_verified 已确认
  且无显式反证
→ 可以结案，Independence 记为 LOW 并如实报告，不影响 Confidence
```

### 必须降级结论（不得直接下结论）

| 情况 | 最低处置 |
| --- | --- |
| 只有厂商来源，Claim 是 MATURITY | 最高 `CONDITIONALLY_SUPPORTED`，独立证据须标 0 |
| 只有单一案例，Claim 是普遍规律 | 必须限定到该案例的 Scope |
| 只有社区轶事（T3），Claim 是 prevalence | Status 记 `INSUFFICIENT_EVIDENCE`，措辞降为「反复出现的问题」 |
| 只有 T5 无出处主张 | `INSUFFICIENT_EVIDENCE`，不得进入结论 |
| 厂商研究被引用但前提 / 更新未核对 | 不得引用该统计量，或必须补齐前提与源文限定语 |
| 有 L4 案例但无治理 / SLA / 成本证据 | 不得推导「企业级成熟」 |

### 必须标 REFUTED

```text
一手来源直接否定该 Claim
或 Claim 描述的是已被 supersede / deprecated 的行为
```

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

## 4.4 Status 与 Confidence

### Status（Claim 处于什么状态）

| Status | 含义 |
| --- | --- |
| `SUPPORTED` | 存在直接、当前、对该问题有权威的证据，且无反证 |
| `CONDITIONALLY_SUPPORTED` | 证据成立，但 Scope 有限或依赖未说明的前提 |
| `CONTESTED` | 存在同等或更强强度的相反证据 |
| `OUTDATED` | 曾成立，已被新版本 / 新数据 / 新实践取代 |
| `INSUFFICIENT_EVIDENCE` | 证据不足，无法判断（**不等于假**） |
| `REFUTED` | 一手来源直接否定 |

### Confidence（有多确定）

| Confidence | 判据 |
| --- | --- |
| **High** | 有对该 Claim 类型而言**最权威且直接**的当前来源，且无反证 |
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
| 「有人认为…也有人认为…」 | 把**已知限制**写成观点分歧 | 去查官方 limitations，翻成限制清单 |
| 「实际使用者反馈呈现…共识」 | 用少量社区帖冒充 prevalence | 数来源；≤10 条社区帖不能叫共识 |
| 「已具备…能力，不止…」 | 把**有滞后的机制**写成即时生效 | 查触发周期、延迟上限、覆盖范围 |
| 「业界普遍认为」 | 无出处（T5） | 找一手来源，找不到则删 |

## 4.6 最终输出模板

````text
# Evidence & Claim Review

## Overall Verdict
（分层给结论：Capability 层 / Maturity 层 / Prediction 层 分别多少）

## Critical Findings
### P0
（两类分开写：P0-A 单点事实错 / P0-B 证据结构缺层）
### P1
### P2

## Claim Matrix
| # | Claim | Type | Scope | Direct | Authority | Independence | Freshness | Counter | Reality | Status | Confidence | Rewrite |

## Counter Evidence

## Silent Evidence
（搜了什么 / 搜到什么 / 为什么可能搜不到）

## Real-world Evidence
（Use Case Status + Production Level + 这个案例证明了什么）

## Theory / Practice Gaps

## Scope Warnings
（哪些结论被错误泛化，应限定到哪里）

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
Overall confidence: 
````

## 4.7 结构化 Claim Record

审核产物应可机器读取，便于后续复用于架构评审、技术雷达或产品比较。

```yaml
claim:
  text: "Cortex Agent is production-ready for financial services"
  type: MATURITY
  polarity: affirmative          # affirmative | negative（LIMITATION 类常用 negative）

  scope:
    domain: financial-services
    workload: data-analysis
    region: global
    excluded: [transactional-execution, customer-communication]

  context:
    product: Cortex Agent
    version_or_release: 2026-09
    availability: GA
    api_surface: REST
    date_verified: 2026-09-15

  evidence:
    - type: T0
      source: official-doc
      directness: direct
      authority: high          # 仅对「支持什么」有效
      independence: IND1
      freshness: high
      completeness: partial    # 未覆盖全部限制
    - type: T3
      source: practitioner-blog
      directness: experience
      authority: medium
      independence: IND3
      freshness: high
      completeness: one-sided

  independent_sources: 0

  counter_evidence:
    - "MCP 行为不参与 evaluation"
    - "replay 不传 session attributes"

  silent_evidence:
    searched: ["limitations", "production issues", "postmortem"]
    found: none
    plausible_reasons: ["企业内部事故不公开", "失败 POC 不公开"]

  real_world:
    existence: proven
    status: Adopted            # Exists | Adopted | Successful | Scaled | Outcome-verified
    production_level: L4
    evidence_coverage: partial # 只覆盖 retrieval，不覆盖 execution
    scale: unknown
    outcome_verified: false

  gaps: [operational, governance, economic]

  assessment:
    status: CONDITIONALLY_SUPPORTED
    fact_strength: 4
    source_strength: 4
    independence: 1
    reality_strength: 3
    timeliness: 5
    confidence: MEDIUM

  recommendation:
    action: QUALIFY
    wording: >
      Cortex Agent 是 Snowflake-native、data-heavy workload 的强候选；
      跨系统、高风险、有副作用的 workflow 仍需额外 Control Plane。
```

---

# 附录 A — 检索词模板

对技术产品至少执行：

```text
"<product>" official documentation
"<product>" release notes
"<product>" limitations
"<product>" known issues
"<product>" production
"<product>" customer case study
"<product>" benchmark
"<product>" criticism
"<product>" Reddit
"<product>" GitHub issues
"<product>" migration
"<product>" alternative
"<product>" deprecated
"<product>" GA / preview
```

对研究：

```text
"<paper title>" original paper
"<topic>" systematic review
"<topic>" benchmark
"<topic>" replication
"<topic>" criticism
```

对行业实践：

```text
"<technology>" production architecture
"<technology>" engineering blog
"<technology>" conference talk
"<technology>" postmortem
"<technology>" case study
```

对厂商研究类引用，额外查：

```text
"<report name>" methodology
"<report name>" updated  /  revised  /  corrigendum
"<statistic>" percentile  /  sample size  /  time window
```

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

## B.4 两个正交结论

```text
Status      SUPPORTED / CONDITIONALLY_SUPPORTED / CONTESTED / OUTDATED /
            INSUFFICIENT_EVIDENCE / REFUTED
Confidence  High / Medium / Low / Unknown
```

Status 描述 Claim 的状态，Confidence 描述确定性，Independence 单独报告。三者不可互推。

## B.5 使用场景

同一套模型可直接用于：

```text
Architecture Review        审架构文档里的结论是否站得住
Vendor Evaluation          审厂商材料与客户故事
Technology Radar           决定一项技术进入哪个环
Product Comparison         审 benchmark 与比较结论
Research Review            审论文与研究报告的传播版本
AI Capability Assessment   审「模型/平台能不能做 X」
```
