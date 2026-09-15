---
name: evidence-and-claim-review
version: 1.0.0
description: 审核技术文章、架构报告、产品与行业分析中的观点、论据和结论是否站得住。先把文章拆成最小可验证的 Claim 并判定类型（FACT / CAPABILITY / PERFORMANCE / MATURITY / PRACTICE / COMPARISON / CAUSAL / RECOMMENDATION / PREDICTION / STRATEGIC / OPINION），再核对来源等级与 Claim 是否真的对齐，判断时效与权威性，主动搜索反例，验证真实落地用例与理论—实践鸿沟，最后给出 Confidence 与改写建议（保留 / 限定范围 / 降级为假设 / 删除）。用于事实核查、引用核查、行业报告审视、AI 与云产品能力与成熟度评估、厂商宣传与 benchmark 可信度判断、文章发布前审稿。触发词：事实核查、claim review、evidence review、可信度评估、来源审查、引用核查、是否过时、找反例、落地案例、成熟度、生产可用、benchmark 可信吗、厂商宣传、一家之言。
---

# Evidence & Claim Review

## Purpose

系统审核一篇技术、架构、产品、研究或行业分析中的**观点、论据和结论**，判断：

1. 这个论据在事实层面是否成立；
2. 论据的来源是否真实、直接、完整；
3. 来源是否足够权威、独立，是否存在明显的一家之言；
4. 观点截至当前日期是否仍然有效，是否出现新的证据、版本、研究或实践推翻/削弱它；
5. 观点是否有真实落地用例；
6. 落地用例是否真的证明了该观点，而不是仅仅“有人做过”；
7. 用例本身的描述是否来自可信来源，是否客观；
8. 理论与实际落地之间是否存在差距；
9. 最终是否应该保留、弱化、限定、重写或删除这个观点。

本 Skill 的目标不是简单寻找“支持观点的链接”，而是建立：

> **Claim → Evidence → Source → Freshness → Authority → Disagreement → Use Case → Reality Gap → Confidence**

的完整证据链。

---

# Core Principle

不要默认：

```text
有引用
=
事实成立
```

也不要默认：

```text
官方文档
=
生产能力成熟
```

更不能默认：

```text
有人做过
=
理论已经被验证
```

正确的判断路径是：

```text
Claim
  ↓
What exactly is being claimed?
  ↓
Fact / Interpretation / Prediction?
  ↓
Primary Evidence
  ↓
Source Quality
  ↓
Freshness
  ↓
Independent Corroboration
  ↓
Counter-evidence
  ↓
Real-world Use Case
  ↓
Theory ↔ Practice Gap
  ↓
Confidence
  ↓
Recommended wording
```

---

# 1. Claim Extraction

首先把文章拆成最小可验证的 Claim。

不要直接评价一个大段落。

例如：

> “Snowflake Cortex Agent 是一个成熟的企业级 Agent Platform。”

至少拆成：

```text
C1: Cortex Agent 是 Agent Runtime。
C2: Cortex Agent 支持多步 orchestration。
C3: Cortex Agent 支持 Search / Analyst / Code Execution。
C4: Cortex Agent 已经适合企业生产环境。
C5: Cortex Agent 已经达到成熟 Agent Platform 的水平。
```

这些 Claim 的证据要求完全不同。

## Claim 类型

给每个 Claim 标记类型：

| Type | 含义 |
| --- | --- |
| FACT | 可直接验证的事实 |
| CAPABILITY | 产品/系统当前支持的能力 |
| PERFORMANCE | 性能、准确率、吞吐等可测量结果 |
| MATURITY | 成熟度、稳定性、生产准备度 |
| PRACTICE | 业界实践 |
| EXPERIENCE | 用户体验/社区反馈 |
| COMPARISON | A 优于 B |
| CAUSAL | A 导致 B |
| RECOMMENDATION | 架构建议 |
| PREDICTION | 对未来的判断 |
| STRATEGIC | 战略观点 |
| OPINION | 主观判断 |

---

# 2. 判断这个 Claim 到底需要什么证据

不同 Claim 不能使用同样的证据。

例如：

```text
“API 支持 streaming”
```

需要：

```text
官方 API 文档
```

而：

```text
“API 已经适合金融生产”
```

单靠官方 API 文档远远不够。

应该要求：

```text
官方能力
+
生产案例
+
独立用户反馈
+
已知限制
```

---

# 3. Fact / Interpretation / Prediction 分离

这是本 Skill 最重要的步骤之一。

每个观点必须先区分：

### Fact

> “Snowflake Cortex Agent Evaluation 已 GA。”

可以由官方 release note 证明。

### Interpretation

> “Snowflake Evaluation 已经比较成熟。”

这是分析判断，需要多来源。

### Prediction

> “未来 Evaluation 会成为 Snowflake 的核心竞争力。”

这是预测，不能伪装成事实。

必须显式标记：

```text
Fact
Interpretation
Prediction
```

不要把三者混在同一句话里。

---

# 4. Source Hierarchy

对每个 Claim 判断来源等级。

## S0 — Direct Primary Source

最高等级：

* 官方产品文档
* 官方 API reference
* 官方 specification
* 官方 release notes
* 官方源代码
* 官方论文
* 原始研究数据
* RFC
* 标准组织正式规范
* 法规 / regulator 原文

适用于：

```text
产品支持什么
API 怎么工作
版本什么时候发布
技术规范是什么
实验结果是什么
```

---

## S1 — Independent Primary Evidence

高价值：

* 独立实验
* benchmark
* peer-reviewed paper
* 大规模真实生产经验
* 原始 telemetry / dataset
* 独立技术报告

适用于：

```text
性能
准确率
成本
可靠性
生产效果
```

尤其用于验证厂商自己的 claim。

---

## S2 — Reputable Secondary Source

例如：

* ACM
* IEEE
* Gartner
* Forrester
* 可靠行业研究机构
* 高质量技术媒体
* 专业咨询公司

可用于：

```text
行业趋势
市场判断
竞品比较
第三方观点
```

但不要让 S2 替代产品事实的一手来源。

---

## S3 — Community Evidence

例如：

* Reddit
* Hacker News
* GitHub Issues
* Discord
* Stack Overflow
* 用户博客
* 社区论坛

它们特别适合发现：

```text
真实问题
生产摩擦
bug
成本问题
开发者体验
未公开限制
```

但通常不能单独证明：

```text
“系统整体成熟”
“性能提升 30%”
“适合企业生产”
```

---

## S4 — Vendor Marketing

例如：

* 官网 Blog
* 产品宣传文章
* Sales material
* Customer success page

可以证明：

> “厂商声称 X。”

不能直接证明：

> “X 已经被独立验证。”

---

## S5 — Unsourced / Social Claim

例如：

* “业内都认为……”
* “大家都在用……”
* “生产环境肯定……”
* “这是最佳实践……”
* 没有出处的 Twitter / 微博 / 二手文章

只能作为：

```text
Lead / Hypothesis
```

不能作为核心证据。

---

# 5. Source Correctness

判断“这个来源是否真的支持这个 Claim”。

这是最容易出错的地方。

例如文章写：

> “Cortex Agent 支持企业级审计。”

引用：

> Cortex Agent tracing documentation。

必须检查：

```text
文档是否真的说 Audit？
还是仅仅说 Trace？
```

如果来源只证明：

```text
Runtime trace
```

而 Claim 写成：

```text
Regulatory audit evidence
```

则结论是：

```text
Source Relevance: PARTIAL
Claim Overreach: YES
```

---

# 6. Evidence Directness

定义：

### Direct

来源直接说明该 Claim。

例如：

```text
官方文档：
“Agent evaluations support X”
```

### Indirect

根据多个信息推导。

例如：

```text
Agent 有 tracing
+
有 evaluation
+
有 data storage
```

推导：

> “可能适合作为 Evaluation Data Plane。”

这是合理的分析，但不能伪装成官方结论。

### Speculative

只有逻辑推断，没有现实证据。

必须标：

```text
Hypothesis / Strategic inference
```

---

# 7. Freshness / Timeliness

每个 Claim 判断：

```text
Published Date
Product Version
Research Date
Last Verified Date
```

特别关注：

* API
* SaaS 产品能力
* pricing
* limits
* security
* model capability
* agent framework
* cloud service
* regulations
* benchmarks

这些都属于：

> **high-volatility claims**

必须优先查询最新官方资料。

---

# 8. 判断“有没有新的观点推翻这个观点”

不要只搜索：

```text
支持这个观点
```

必须主动搜索：

```text
反例
限制
失败
deprecated
superseded
migration
known issue
production problem
benchmark disagreement
alternative approach
```

建立：

```text
Supporting Evidence
vs
Counter Evidence
```

---

# 9. Counter-Evidence Search

针对每个重要 Claim 至少尝试搜索：

```text
"<claim>"
limitations
```

```text
"<claim>"
production issues
```

```text
"<claim>"
alternative
```

```text
"<claim>"
benchmark
```

```text
"<claim>"
criticism
```

```text
"<claim>"
migration
```

对于技术产品，再检查：

```text
deprecated
GA
preview
known limitations
release notes
```

目标不是“找反对意见”，而是判断：

> **这个 Claim 是否仍然是当前最合理的描述。**

---

# 10. Authority

Authority 不能简单等于“网站看起来很大”。

判断四个维度：

```text
Expertise
+
Proximity
+
Independence
+
Evidence
```

例如：

### Snowflake 官方

对：

> Cortex Agent 支持什么

Authority 极高。

但对：

> Cortex Agent 比 LangGraph 更成熟

Authority 很低，因为这是 Snowflake 自己的利益相关判断。

---

### LangChain 官方

对：

> LangSmith 支持什么

Authority 极高。

对：

> LangSmith 比 Snowflake Evaluation 好

只能算厂商观点。

---

### 第三方生产团队

对：

> 我们使用 Cortex Agent 遇到什么问题

Authority 较高。

对：

> 所有企业都会遇到这个问题

Authority 不够。

---

# 11. Independence

判断一组证据是不是“伪多来源”。

例如：

```text
Snowflake Blog
Snowflake Docs
Snowflake Press Release
Snowflake Webinar
Snowflake Customer Story
```

看起来有 5 个来源。

实际上：

```text
Source Independence = LOW
```

因为全部来自同一家公司。

应该标：

```text
Independent corroboration: LOW
```

真正强的证据通常是：

```text
Vendor documentation
+
Independent benchmark
+
Production customer
+
Community feedback
```

---

# 12. “一家之言”检测

一个观点如果只有：

```text
Vendor A
```

支持，不应写成：

> “业界已经形成共识。”

应该写：

> “Vendor A 的产品定位是……”

如果：

```text
Vendor A
+
Vendor B
+
Independent researchers
+
Production users
```

都支持，才可以逐渐提升到：

> “行业正在形成明显趋势。”

---

# 13. Disagreement Detection

对有争议的话题建立：

```text
Consensus
Partial consensus
Contested
Open question
```

例如：

### Consensus

> MCP 已成为重要的 Agent Tool protocol。

### Partial consensus

> Semantic Layer 能显著改善 Text-to-SQL，但维护成本较高。

### Contested

> Agentic systems 是否应该由 LLM 自主规划大部分 workflow。

### Open question

> 未来企业是否会普遍采用 multi-runtime Agent Operating Layer。

不要把 Contested / Open question 写成确定事实。

---

# 14. Real-world Use Case Validation

这是本 Skill 与普通“事实检查”最大的区别。

必须问：

> **这个理论有没有真实落地？**

例如：

> “Cortex Agent 非常适合金融研究。”

不能只证明：

```text
Cortex Agent 可以 Search
Cortex Agent 可以 Analyst
```

必须寻找：

```text
Financial institution
+
Actual deployment
+
Actual workload
```

---

# 15. Use Case Source Hierarchy

真实用例也分等级。

## U0 — Verified Production Evidence

最强：

* 金融机构官方 case study
* 客户自己公开技术报告
* conference talk
* architecture presentation
* engineering blog
* production postmortem

---

## U1 — Strong Practitioner Evidence

例如：

* 企业工程团队长期实践文章
* GitHub 真实项目
* conference demo + architecture detail
* production engineering discussion

---

## U2 — Pilot / POC

例如：

> “我们尝试了 Cortex Agent。”

只能证明：

```text
Feasibility
```

不能证明：

```text
Production maturity
```

---

## U3 — Demo / Tutorial

只能证明：

```text
Capability exists
```

不能证明：

```text
Production viability
```

---

## U4 — Marketing Claim

只能证明：

> Vendor says customer uses it.

不能自动证明：

> Customer has successfully deployed it at scale.

---

# 16. Use Case Reality Gap

必须单独判断：

```text
Theory
vs
POC
vs
Pilot
vs
Production
vs
Scaled Production
```

定义：

### Level 0 — Concept

```text
whitepaper / architecture
```

### Level 1 — Demo

```text
官方 demo
```

### Level 2 — POC

```text
内部 prototype
```

### Level 3 — Pilot

```text
真实部门，小规模
```

### Level 4 — Production

```text
真实用户 + 真实业务
```

### Level 5 — Scaled Production

```text
大规模
关键业务
持续运行
有 SLA
有治理
有成本管理
```

一个重要结论：

> **大量 AI Agent “最佳实践”目前只到 Level 1–2。**

因此报告应该非常警惕：

```text
Architecture Pattern
→ Demo
→ “Enterprise Best Practice”
```

这种跳跃。

---

# 17. Use Case 是否真的证明理论

即使存在 Production Case，也要检查：

> **这个案例究竟证明了什么？**

例如：

理论：

> “Cortex Agent 可以承担企业核心交易 workflow。”

案例：

> 某银行使用 Cortex Agent 查询研究资料。

那么：

```text
Use Case Evidence
supports:
Data retrieval

does NOT support:
Trading workflow
Transactional execution
High-risk authorization
```

因此应该写：

```text
Evidence Coverage = PARTIAL
```

不能过度外推。

---

# 18. Case Description Objectivity

每个真实案例都检查：

```text
Who reports it?
Who benefits from the claim?
What metrics are disclosed?
What limitations are disclosed?
Are failure rates disclosed?
Is scale disclosed?
Is cost disclosed?
Is architecture disclosed?
Is human involvement disclosed?
```

特别警惕：

> “帮助某公司提升效率 30%。”

必须继续追：

```text
30% 是什么？
Baseline 是什么？
样本多少？
实验多久？
谁测的？
有没有 control group？
```

没有这些信息时：

```text
Metric Reliability = LOW
```

---

# 19. Theory-Practice Gap

对每个重要观点建立：

```text
Theory
↓
Capability
↓
POC
↓
Production
```

然后明确 Gap：

### Capability gap

理论需要的能力，产品根本没有。

### Integration gap

能力存在，但是组合起来复杂。

### Operational gap

Demo 能工作，生产运营困难。

### Governance gap

Demo 正常，但金融治理无法满足。

### Economic gap

技术可行，但成本不可接受。

### Reliability gap

平均效果不错，但 tail risk 太高。

### Organizational gap

技术可行，但 ownership / operating model 不成立。

---

# 20. Claim Confidence

每个 Claim 最终给出：

```text
High
Medium
Low
Unknown
```

推荐判断：

### High

同时满足：

```text
Primary source
+
Recent
+
Direct evidence
+
Independent corroboration
```

### Medium

```text
Primary source
+
Recent
```

但缺：

```text
Independent production evidence
```

### Low

```text
Vendor claim
or
Community anecdote
or
Indirect inference
```

### Unknown

证据不足，不能判断。

---

# 21. 推荐输出格式

对重要 Claim 建立表格：

| Claim | Type | Evidence | Source | Freshness | Authority | Independent? | Counter Evidence | Use Case | Reality Level | Confidence | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cortex Agent 支持 X | Capability | Direct | Official docs | Current | High | N/A | None | Demo | L1 | High | 保留 |
| Cortex Agent 已适合金融生产 | Maturity | Partial | Vendor + users | Current | Medium | Partial | 有限制 | Pilot | L2/L3 | Medium | 弱化 |
| Snowflake Eval 可替代 LangSmith | Comparison | Indirect | Docs + comparison | Current | Mixed | Low | LangSmith human eval 更强 | Limited | L2 | Low | 改成局部替代 |
| Semantic Layer 是长期资产 | Strategic | Multiple | Vendor + practitioners | Current | High | Medium | 无明显反例 | Production | L3/L4 | High | 保留 |

---

# 22. 对文章观点进行四层评分

除了 Confidence，再给每个重要观点标记四个维度：

```text
F — Fact Strength
S — Source Strength
R — Reality Strength
T — Timeliness
```

例如：

```text
F: 5/5
S: 5/5
R: 3/5
T: 5/5
```

代表：

> 产品能力事实非常确定，但生产落地证据尚不充分。

不要把四个维度平均成一个分数。

---

# 23. 特别规则：不能用产品文档证明“成熟度”

以下 Claim 必须增加独立证据：

```text
成熟
稳定
生产可用
企业级
金融级
高性能
低成本
高可靠
最佳实践
领先
业界标准
已经普遍采用
```

官方产品文档最多证明：

```text
Capability
```

不能直接证明：

```text
Maturity
Reliability
Industry adoption
Best practice
```

---

# 24. 特别规则：不能用单个案例证明普遍规律

例如：

```text
Company X successfully uses Agent Y
```

最多支持：

> Agent Y 在 Company X 的特定条件下可行。

不能直接推出：

> Agent Y 适合所有企业。

必须检查：

```text
company size
data architecture
team size
use case
risk level
human oversight
deployment scale
```

---

# 25. 特别规则：厂商比较必须避免利益相关方自证

例如：

```text
OpenAI says OpenAI Agents are better.
Anthropic says Claude Agents are safer.
Snowflake says Cortex is cheaper.
LangSmith says LangSmith Evaluation is more mature.
```

这些均属于：

```text
Vendor Position
```

不能直接作为：

```text
Industry Fact
```

比较时优先寻找：

```text
Independent benchmark
+
cross-vendor study
+
production evidence
```

---

# 26. 特别规则：架构结论和事实证据分开

推荐：

```text
Fact:
Snowflake supports Cortex Search.

Evidence:
Official Snowflake documentation.

Analysis:
Therefore Snowflake is a strong candidate for Data Plane.

Recommendation:
Use Snowflake Search for Snowflake-native corpora.
```

不要写成：

> “Snowflake Search 已经是企业最好的 RAG，所以应该采用。”

因为这里实际上混入了三个不同层级：

```text
Fact
+
Interpretation
+
Recommendation
```

---

# 27. 输出最终审查结论

最终报告必须回答：

## A. 哪些观点可以直接保留

```text
High confidence
```

## B. 哪些观点要限定范围

```text
Conditionally valid
```

例如：

> “Snowflake Agent 适合企业生产”

改成：

> “对于 Snowflake-native、Data-heavy workload，Cortex Agent 已具备较强生产条件；复杂跨系统、高风险 workflow 仍需额外 Control Plane。”

## C. 哪些观点应该降级成假设

例如：

> “未来所有 Agent 都会通过 MCP。”

应改成：

> “MCP 很可能成为重要的 Tool interoperability layer。”

## D. 哪些观点应该删除

当：

```text
Evidence = weak
+
Counter evidence = significant
+
No production validation
```

就删除。

---

# 28. Review Workflow

执行本 Skill 时，严格按以下步骤：

```text
Step 1
Extract Claims

Step 2
Classify Claim Type

Step 3
Locate Existing Sources

Step 4
Find Primary Source

Step 5
Check Source-Claim Alignment

Step 6
Check Publication / Version Date

Step 7
Search Counter Evidence

Step 8
Search Independent Evidence

Step 9
Search Real-world Use Cases

Step 10
Classify Reality Level
Demo / POC / Pilot / Production / Scale

Step 11
Assess Theory-Practice Gap

Step 12
Score:
Fact
Source
Freshness
Independence
Reality

Step 13
Rewrite Overstated Claims

Step 14
Produce Final Evidence Matrix
```

---

# 29. Web Search Strategy

不要只使用一个搜索词。

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

---

# 30. 时间敏感规则

以下内容必须检查最新信息：

```text
API
Pricing
Product capability
Availability
GA / Preview
Security
Model support
Limits
Enterprise features
MCP support
Cloud services
Regulation
Industry adoption
```

至少检查：

```text
Current official docs
+
Latest release notes
```

如果最近一年产品变化很快，优先检查：

```text
Current docs
+
last 6–12 months release notes
```

---

# 31. 最终审查输出模板

最终回答使用以下结构：

```text
# Evidence & Claim Review

## Overall Verdict

High / Medium / Low confidence

## Critical Findings

### P0
...

### P1
...

## Claim Matrix

| Claim | Type | Fact | Source | Freshness | Authority | Independence | Reality | Confidence |

## Counter Evidence

...

## Real-world Evidence

...

## Theory / Practice Gaps

...

## Claims That Should Be Rewritten

Original:
...

Recommended:
...

## Claims That Should Be Removed

...

## Missing Evidence

...

## Final Assessment

Fact strength:
Source strength:
Timeliness:
Independent validation:
Production validation:
Overall confidence:
```

---

# 32. 核心检查原则

最后始终遵守以下原则：

> **引用不是证据，引用只是证据的入口。**

> **官方文档证明 capability，不自动证明 maturity。**

> **客户案例证明 feasibility，不自动证明 generality。**

> **社区反馈证明 experience，不自动证明 prevalence。**

> **论文证明 research result，不自动证明 production effectiveness。**

> **一个来源证明的是“这个来源说了什么”，不是“这个观点已经成为事实”。**

> **最新观点不一定推翻旧观点，但必须解释它改变了什么。**

> **多个同一公司来源不等于多个独立证据。**

> **一个成功案例不等于行业最佳实践。**

> **POC 能跑不等于 Production Ready。**

> **Production 能跑不等于 Financial-grade。**

> **技术上可行不等于架构上应该采用。**

最终目标不是给观点找“支持它的证据”，而是回答：

> **这个观点现在到底有多可信？为什么可信？谁证明了它？谁反驳了它？是否真正落地？在哪些条件下成立？理论与实践相差多少？我们今天是否还应该据此做架构决策？**
