# Evidence & Claim Review

**审核对象**：`temp/Snowflake Agent体系-成稿.md`（v2.1，14 节 + 47 条引用定义，900 行）
**审核方法**：`skills/evidence-and-claim-review` **v2.1.1**（四层模型；六条不可违反原则；Type × Epistemic 正交；Status / Confidence / Sufficiency 三正交结论；Level 1–3 分级工作流）
**审核日期**：2026-09-15｜**版本**：第三轮（v2.1.1 口径），取代 v1 与 v2.0 两份口径的审核

---

## Overall Verdict

**按 Claim 类型分层给结论**（v2.1.1 的要求：不给单一总分）：

| 层 | Confidence | Independence | Sufficiency | 依据 |
| --- | --- | --- | --- | --- |
| Fact / Capability / Limitation | **High** | IND1 | **SUFFICIENT** | 抽查 12 条关键事实，10 条与官方文档逐字吻合；3 处硬错已定位 |
| Maturity / 生产可用 | **Low–Medium** | IND1–IND3 | **PARTIALLY_SUFFICIENT** | 本轮找到独立分析师结论（Gartner MQ 2026-06：Snowflake = Visionary）与 4 个具名组织案例 |
| Comparison（vs LangSmith） | **Low** | IND1 | **INSUFFICIENT** | 原文无 benchmark；本轮找到的 cross-vendor benchmark 不覆盖此项比较 |
| Prediction / Strategic（§14） | **Low–Medium** | IND1 | **INSUFFICIENT** | 依赖的「厂商给不出 Identity / Entitlement / Policy」前提已被自家路线图反证 |

一句话：**技术底稿可信；成熟度结论的强度高于证据；战略层的排他性前提已过期。**

### 本轮相对前两轮最重要的变化：三处「缺席」被证伪

v2.0 口径的审核把三样东西记为 `none`。本轮按原则 6 的两步判定（detection probability + Search Coverage）重做取证，三样**都存在**：

| v2.0 的结论 | v2.1.1 实测 | 性质 |
| --- | --- | --- |
| `analyst_assessment_of_cortex_agents: none` | **Gartner MQ for AI Platforms for DSML（2026-06-22）**覆盖 Snowflake，定位 **Visionary**，含三条 cautions | 取证失败 |
| `independent_benchmark: none` | **runQL cross-vendor benchmark（2025）**、**BI Bench**、**dbt Labs 2026 benchmark** 均已发布 | 取证失败 |
| `named_production_case_study: none` | **Whatnot**、**Fireblocks**、**A+E Global Media**、Snowflake 内部合同审查 | 取证失败 |

**这不是原文的错误，是审核方的错误。** 上一轮把「我没搜到」写成了「不存在」，正好踩了原则 6 禁止的那一步。三处的 detection probability 都不低 —— 分析师覆盖企业 AI 平台、跨厂商 benchmark 覆盖 NL-to-SQL、厂商发布客户故事，都是行业常规动作，本就应当被搜索到。本轮的 Search Coverage 已补全渠道，`absence_assessment` 逐项重判（见 §Silent Evidence）。

**对结论的影响**：成熟度层的 Sufficiency 从 `INSUFFICIENT` 上调为 `PARTIALLY_SUFFICIENT`；Reality 层从「最高 Adopted / L4」上调为「可达 Successful（self-reported）/ L5」。但**证据结构的问题没有消失** —— 新找到的证据里，分析师结论方向为谨慎，benchmark 结果对 Cortex 不利，客户案例全部是厂商自述。原文的问题从「没有证据可用」变成了「有证据可用而未被使用」。

---

## Critical Findings

### P0

#### P0-A｜单点事实错（三处）

**P0-A-1｜Cortex Search 单服务规模上限写 400M rows**

官方为 **<100M rows**。数值类 Claim 属 §2.4 强制回源项，且该数值会直接被用于容量规划。严重度 **Operational**（会误导架构决策），判定 **REFUTED**。

**P0-A-2｜Cortex Search 的授权行为被归因错误（本轮最严重）**

**原文（§2）**：

> 「两者是否形成同一个 Data Entitlement Contract，**取决于建模时是否对齐**。… Search authorization 与 SQL authorization 必须收敛到同一份 entitlement 定义，否则检索侧会绕过表侧的行级控制。」

**事实**：Snowflake 官方文档《Query Cortex Search Service → 使用所有者权限进行查询》明确写着：

> Cortex Search 服务**使用所有者权限（owner's rights）执行搜索**…任何有足够权限查询该服务的角色，**都可以查询该服务已索引的任何数据，而不管该角色对服务源查询引用的基础对象（例如表和视图）的权限如何**。例如，对于引用具有行级掩码策略的表的 Cortex Search 服务，该服务的查询用户将能够从所有者角色具有读取权限的行查看搜索结果，**即使查询用户的角色无法读取源表中的这些行**。

官方开发者指南进一步确认这是设计选择：*"Cortex Search Services runs with Owner's Rights **by design**."*

**独立佐证**：安全厂商 Cyera 有完整实测 —— `accountadmin` 创建 Search Service 后把 USAGE 授予低权用户，该用户**直接查表只见脱敏数据，经 Search Service 却拿到未脱敏的工资数据**。

**判定**：

| 项 | 结论 |
| --- | --- |
| Claim Type × Epistemic | CAUSAL × FACT（原文以事实语气陈述因果关系） |
| Status | **REFUTED**（一手来源直接否定该因果归因） |
| Authority | T0 官方 limitations = 5（对「机制是什么」）；T2/T3 独立安全研究 IND4 |
| Counter Severity | **Governance + Safety/Security** |
| 问题性质 | 不是「建模纪律不足」，而是**平台的设计行为** |

**为什么是 P0 而不是 P1**：原文措辞会让读者得出错误行动 ——「把建模对齐就好了」。实际缓解需要三个**架构动作**：

```text
1. 按 entitlement 域拆分多个 Search Service，USAGE 只授予对应角色
   （USAGE 一旦给出，就等于给出 owner 的读权限）
2. 调用侧传 server-validated filter（Snowflake 官方推荐做法：
   用后端 owner session + CURRENT_ROLE() 构造 filter，不让前端可篡改）
3. 审核「谁持有该 Search Service 的 USAGE」—— 这是权限面而非建模面
```

按 §2.6 的规则，一条 `Severity = Safety/Security` 且已确认的反证**权重高于任意数量 Cosmetic 反证之和**，且必须进 P0。

**P0-A-3｜§6 orchestration 模型清单里的「部分 Google 模型」**

Cortex Agents 的 orchestration model 官方清单为 `auto` + Claude 4.x 系列 + `openai-gpt-4.1`，**不含 Google 模型**。原文「含 Anthropic、OpenAI、部分 Google 模型」的第二项不成立 → **REFUTED**。

#### P0-B｜证据结构缺层（本轮已部分修正，但性质变化）

```text
原文 47 条引用：T0 官方文档 33 条 ｜ T4 厂商公告 6 条 ｜ T3 Reddit 8 条
其中 IND ≥ 4 的独立来源：0 条（组织级）
```

**本轮的发现改变了这一条的表述方式**：

```text
v2.0：问题是「这类证据公开可得性低」，原文已到当前可获得证据的上限
v2.1.1：问题是「这类证据本来存在，原文未使用」
```

| 证据 | 是否存在 | 原文是否使用 |
| --- | --- | --- |
| Gartner MQ for AI Platforms for DSML（2026-06-22） | **存在**（Snowflake = Visionary + 3 条 cautions） | 未使用 |
| runQL cross-vendor benchmark（2025） | **存在**（Cortex Analyst 88.67%，4 家对比） | 未使用 |
| BI Bench | **存在**（Cortex 19.2%，**第 10 位**） | 未使用 |
| dbt Labs 2026 benchmark | **存在**（语义层把 NL-to-SQL 从 64.5% 提到 98.2–100%） | 未使用 |
| 具名组织案例 | **存在**（Whatnot / Fireblocks / A+E Global Media） | 未使用 |
| Gartner Peer Insights 同行评议 | **存在**（方向为负） | 未使用 |

**这一条的定性因此变化**：原文确有可用的独立来源，却全部集中在厂商文档与 Reddit。§8 标题写「真实生产反馈」，实际只用了社区帖；而同期存在的分析师报告与跨厂商 benchmark 一条未引。

**但要注意公平**：原文「不引用厂商 benchmark」这一点方向正确（Snowflake 自述的 >90% accuracy 出自 2024-08 内部 150 题集，此后未更新；47%→83% 出自 Cortex 内部 benchmark，原文均未引用）。问题不是引用方式错，而是**克制只做了一半** —— 避开了对厂商有利的 benchmark，也一并避开了对厂商不利的第三方 benchmark。

### P1

| # | 问题 | 类型 | 严重度 | 处置 |
| --- | --- | --- | --- | --- |
| P1-1 | §8「实际使用者反馈呈现三类**稳定共识**」—— 9 条 Reddit 帖不足以支撑 prevalence | EXPERIENCE × INFERENCE | Operational | 改「反复出现的问题」 |
| P1-2 | §7「Agent-specific eval **快速成熟**」—— 用官方能力文档支撑 maturity | MATURITY × INFERENCE | Reliability | 改为「功能覆盖在扩展」并引 Gartner 评议的反证 |
| P1-3 | §14「Frontier vendors 给不出 Identity / Entitlement / Policy」—— 前提已过期 | STRATEGIC × OPINION | Governance | QUALIFY，把自建范围收敛 |
| P1-4 | §8 Autopilot「有人认为可自动化 80–90%」—— 把实测反证写成观点分歧 | PRACTICE × INFERENCE | Reliability | 改为限制清单 |
| P1-5 | §14 自主性数据（<25 min → >45 min）—— 源文已回落，且属 Claude Code 自研遥测 | FACT × INFERENCE | Reliability | 补限定语与回落 |
| P1-6 | §14 OpenAI Agents API「发布」—— 实为 public beta；US-only 数据驻留；自己托管 sandbox 亦无 ZDR | FACT × FACT | Governance | 补 availability 与数据驻留 |
| P1-7 | §9 per-user quotas「具备平台级 enforcement，不止 reporting」—— enforcement 动作有滞后 | CAPABILITY × INFERENCE | Operational | 补时效 |
| P1-8 | §1 官方工具清单未标 availability（`code_execution` 为 Preview） | CAPABILITY × FACT | Operational | 逐项补 GA / Preview |
| P1-9 | §5 `X-Snowflake-Role` 未写优先级与 PAT `ROLE_RESTRICTION` 限制 | FACT × FACT | Operational | 补两句 |
| P1-10 | §5 未提 secondary roles fallback（`OAUTH_USE_SECONDARY_ROLES = NONE`） | FACT × FACT | Governance | 补前置条件 |
| P1-11 | MCP 四条限制未引全（resources / prompts / roots / sampling） | LIMITATION × FACT | Operational | 补齐 |
| P1-12 | **§7 / §9 未引独立分析师与 cross-vendor benchmark**（本轮新增） | MATURITY / COMPARISON × INFERENCE | Reliability | 见 P1-13、P1-14 |
| P1-13 | **Gartner MQ 2026-06-22 将 Snowflake 定位为 Visionary（非 Leader）**，cautions 含 platform complexity、Cortex AI 仅在 Snowflake 托管基础设施内可用、composite AI 依赖开源库 | MATURITY × FACT | Reliability | 必须补入；与「生产能力成熟」的措辞直接冲突 |
| P1-14 | **BI Bench 显示 Cortex 19.2%，第 10 位**；runQL benchmark 显示 Cortex Analyst 88.67%（竞品 runQL 92%） | PERFORMANCE × FACT | Reliability | 补入并说明 benchmark 的 runQL/basedash 利益关系（IND3） |
| P1-15 | §14 未纳入 Snowflake 的治理层动作（Summit 26 / Horizon Context / Agent Identity） | STRATEGIC × FACT | Governance | 与 P1-3 合并处理 |
| P1-16 | 引用卫生：`[4]` 路径双 `/en/en/`；`[13]`/`[14]` 同文档（.com/.cn）；`[36]` 参数异常；47 条全部携带 `utm_source` | — | Cosmetic | 批量清洗 |

### P2

- MCP 限制可再补：recursive loop 检测、tool poisoning / shadowing 的官方建议位置
- §6「已从单一数据问答形态扩展为…」与后句语义重复
- frontmatter `version: v2.1 终轮事实收紧（P0/P1/P2）` 属版本自指，交付稿应删
- §8 表格「MCP 很方便 / 但不是完整 Runtime」与 §6 正文重叠
- 全文 47 条引用均带 `utm_source=chatgpt.com`，属跟踪参数

---

## Claim Matrix

Direct = direct / indir / spec｜Auth = Authority 0–5｜Ind = Independence｜Fresh = current / aging｜
Counter = none / weak / strong｜Severity = 反证严重度｜Reality = L0–L6｜Conf = Confidence｜Suff = Sufficiency

| # | Claim | Type | Epistemic | Scope | Direct | Auth | Ind | Fresh | Counter | Severity | Reality | Status | Conf | Suff | Rewrite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Cortex Agent 官方工具清单 | CAPABILITY | FACT | Snowflake 账户 | direct | 5 | IND1 | current | none | — | L1 | SUPPORTED | HIGH | SUFFICIENT | KEEP（补 Preview 标注） |
| C2 | 官方建议 Analyst 迁往 Cortex Agents（2026-08） | FACT | FACT | 当前版本 | direct | 5 | IND1 | current | none | — | — | SUPPORTED | HIGH | SUFFICIENT | KEEP |
| C3 | Cortex Agent = Data-Native Managed General Agent Runtime | STRATEGIC | INTERPRETATION | data-native workload | indir | 4 | IND0 | current | none | — | L1 | CONDITIONALLY_SUPPORTED | MED | PARTIALLY | QUALIFY（标为本文术语） |
| C4 | code_execution 2026-08-20 Preview / code_toolset_all 2026-08-26 GA | FACT | FACT | 当前版本 | direct | 5 | IND1 | current | none | — | L1 | SUPPORTED | HIGH | SUFFICIENT | KEEP（删重复句） |
| C5 | 单 Search Service 规模约束 **400M** rows | FACT | FACT | — | direct | 5 | IND1 | current | strong | Operational | — | **REFUTED** | — | n/a | 修字 → 100M |
| C6 | Search >20 QPS 单服务 / >140 QPS 账户需协商 | FACT | FACT | 账户级 | direct | 5 | IND1+IND4 | current | none | — | — | SUPPORTED | HIGH | SUFFICIENT | KEEP |
| C7 | Cortex Search response size 有限制 | FACT | FACT | — | direct | 5 | IND1 | current | none | — | — | CONDITIONALLY_SUPPORTED | MED | PARTIALLY | QUALIFY（补 10 MB / 300 KB） |
| C8 | MCP server ≤50 tools、250 KB 截断、protocol constructs 未完整覆盖 | CAPABILITY + LIMITATION | FACT | MCP server | direct | 5 | IND1+IND4 | current | none | — | L1 | SUPPORTED | HIGH | SUFFICIENT | KEEP（补 4 条限制） |
| C9 | Search 与 SQL 的授权一致性「取决于建模时是否对齐」 | CAUSAL | FACT | 默认配置 | direct | 5 | **IND4** | current | **strong** | **Safety/Security** | — | **REFUTED** | — | n/a | **REVERSE** |
| C10 | 权限取 querying user 的 default role，配置不当直接失败 | FACT | FACT | Agent 调用 | direct | 5 | IND1+IND4 | current | none | Operational | — | SUPPORTED | HIGH | SUFFICIENT | KEEP ← 全文最强 |
| C11 | REST API 可经 `X-Snowflake-Role` 显式指定 role | FACT | FACT | REST API | direct | 5 | IND1+IND4 | current | none | — | — | SUPPORTED | HIGH | SUFFICIENT | KEEP（补优先级与 PAT 限制） |
| C12 | Evaluations 2026-03-13 GA；2026-08-21 支持版本定位 | FACT | FACT | 当前版本 | direct | 5 | IND1 | current | none | — | L1 | SUPPORTED | HIGH | SUFFICIENT | KEEP（修链接） |
| C13 | 四条官方 Evaluation 限制 | LIMITATION | FACT | Evaluation | direct | 5 | IND1 | current | none | Operational | — | SUPPORTED | HIGH | SUFFICIENT | KEEP ← 全文最有价值 |
| C14 | Snowflake 有机会成为统一 Evaluation / Observability Data Plane | PREDICTION | INFERENCE | 数据型 evaluation | indir | 4 | IND1 | current | **strong** | Reliability | L1 | **CONTESTED** | LOW-MED | INSUFFICIENT | QUALIFY（标 Prediction + 引反证与支持信号） |
| C15 | 与 LangSmith 的三档对照（Human eval / Pairwise「明显领先」） | COMPARISON | OPINION | 企业 eval 工作流 | indir | 2 | IND1 | current | weak | Reliability | — | INSUFFICIENT_EVIDENCE | LOW | INSUFFICIENT | QUALIFY（声明为作者判断） |
| C16 | §8 使用者反馈呈现「三类稳定共识」 | EXPERIENCE | INFERENCE | 已用平台的企业 | indir | 2 | IND4 | current | weak | Operational | L3–L4 | CONDITIONALLY_SUPPORTED | MED | PARTIALLY | QUALIFY（改「反复出现」） |
| C17 | Semantic View Autopilot「可自动化 80–90%」 | PRACTICE | INFERENCE | Snowflake 账户 | indir | 2 | IND4 | current | **strong** | Reliability | L2 | CONTESTED | LOW | PARTIALLY | QUALIFY（改限制清单） |
| C18 | per-user quotas 具备平台级 enforcement，不止 reporting | CAPABILITY | INFERENCE | 账户级 | direct | 5 | IND1+IND4 | current | weak | Economic | L4 | CONDITIONALLY_SUPPORTED | MED | PARTIALLY | QUALIFY |
| C19 | Run API 同步默认 15 分钟 / background 最长 6 小时 | FACT | FACT | 当前版本 | direct | 5 | IND1+IND3 | current | none | — | — | SUPPORTED | HIGH | SUFFICIENT | KEEP |
| C20 | 推荐架构：自建 Control Plane + Cortex 为辅助 Runtime | RECOMMENDATION | INFERENCE | 已有企业级平台的组织 | indir | 4 | IND1 | current | none | — | L1 | CONDITIONALLY_SUPPORTED | MED | PARTIALLY | KEEP（条件可再收紧） |
| C21 | §14 OpenAI Agents API 2026-09-10「发布」 | FACT | FACT | 当前版本 | direct | 5 | IND1+IND4 | current | none | Governance | — | SUPPORTED | MED | PARTIALLY | QUALIFY（标 public beta + 补 ZDR） |
| C22 | Claude Code 长 session <25 min → >45 min | FACT + 推断 | INFERENCE | Claude Code 自研遥测 | indir | 3 | IND1 | **aging** | **strong** | Reliability | L4 | CONDITIONALLY_SUPPORTED | LOW | PARTIALLY | QUALIFY |
| C23 | Economic Index 显示 Code / Cowork 任务更长、autonomy 更高 | FACT | FACT | — | indir | 3 | IND1 | current | — | — | — | INSUFFICIENT_EVIDENCE | UNKNOWN | INSUFFICIENT | 补原文或删 |
| C24 | Frontier Runtime primitives 正在快速商品化 | PREDICTION | INFERENCE | 2026–2028 | indir | 4 | IND1 | current | none | — | L1 | CONDITIONALLY_SUPPORTED | MED | PARTIALLY | QUALIFY（显式标 Prediction） |
| C25 | 企业必须自建 Operating Layer，因 Frontier 给不出 Identity / Entitlement / Policy | STRATEGIC | OPINION | 多法人金融企业 | indir | 3 | IND1 | current | **strong** | Governance | L0 | **CONTESTED** | LOW-MED | INSUFFICIENT | QUALIFY |
| C26 | §6 orchestration 模型「含 Anthropic、OpenAI、部分 Google 模型」 | FACT | FACT | 当前版本 | direct | 5 | IND1 | current | strong | Operational | — | **REFUTED** | — | n/a | 修字 |
| C27 | 两类 Runtime 分工（Full-Control vs Managed） | STRATEGIC | INTERPRETATION | 企业 Agent Platform | indir | 3 | IND0 | current | none | — | — | CONDITIONALLY_SUPPORTED | MED | PARTIALLY | QUALIFY（标为本文框架） |
| C28 | Trace ≠ 审计证据，须分开存放 | RECOMMENDATION | INFERENCE | 受监管企业 | indir | 4 | IND1 | current | none | Governance | — | SUPPORTED | MED-HIGH | SUFFICIENT | KEEP |

**Status 分布**：SUPPORTED 12 ｜ CONDITIONALLY_SUPPORTED 8 ｜ CONTESTED 3 ｜ REFUTED 3 ｜ INSUFFICIENT_EVIDENCE 2 ｜ OUTDATED 0

**Sufficiency 分布**：SUFFICIENT 11 ｜ PARTIALLY_SUFFICIENT 10 ｜ INSUFFICIENT 4 ｜ n/a 3

**Epistemic 分布**：FACT 12 ｜ INFERENCE 13 ｜ OPINION 2 ｜ PREDICTION 0（**原文无一条显式标注为预测**）

最后一项值得单列：全文 28 条 Claim 中，性质为 PREDICTION / STRATEGIC 的有 4 条（C14 / C24 / C25 / C27），**没有一条在原文中被显式标注为预测或推论**。这正是 §1.3 所说的「Prediction 伪装成 Fact」。

---

## Counter Evidence

每条标注严重度（§2.6 要求）。

**1. Cortex Search 以 owner's rights 执行检索（推翻 C9）**
T0 官方 + T2/T3 独立安全研究（IND4）。**Severity: Safety/Security**。官方原文见 P0-A-2。
**这是本轮唯一一条足以单独改变架构建议的反证。**

**2. Cortex Search 的 512-token 嵌入窗口（削弱 C6/C7）**
官方与多个第三方整理一致：索引时只有每条文本的前 512 token 参与向量匹配。使「长文档必须预分块」成为硬约束。**Severity: Operational**。

**3. role-per-tenant 的 secondary roles fallback（补 C10/C11 缺口）**
Snowflake 工程师技术实践（T3，IND3）+ 官方 MCP 文档（T0）：「为防止任何 fallback」，service user 必须无默认 secondary roles；MCP 侧推荐 `OAUTH_USE_SECONDARY_ROLES = NONE`。**Severity: Governance**。

**4. Gartner MQ for AI Platforms for DSML（2026-06-22）：Snowflake 为 Visionary，非 Leader（削弱 C14 / 全文成熟度措辞）**
T2，IND4。Leaders 为 AWS / Databricks / Dataiku / DataRobot / Google / IBM / Microsoft。Snowflake 的 cautions 三条：

```text
Composite AI    仅支持 ML 与 GenAI，替代 AI 技术依赖开源库
Hybrid          跨云与本地有连接器，但 Cortex AI 等能力仅在 Snowflake 托管基础设施内可用
Complexity      客户反馈频繁提及平台复杂度，需要预留培训与上手时间
```

**Severity: Reliability**。这是本项最重要的独立分析师结论，且方向为谨慎 —— 与原文「生产能力成熟」的措辞直接冲突。注意其 Strengths 也明确肯定 Snowflake 的「context and decision intelligence」方向，属有褒有贬，不是否定。

**5. 独立 cross-vendor benchmark 存在，结果对 Cortex 不利（削弱 C14、C15 与 §7 整体语气）**

| Benchmark | 结果 | 独立性 | 方向 |
| --- | --- | --- | --- |
| runQL Conversational Analytics Benchmark（2025） | Cortex Analyst 平均准确率 **88.67%**（runQL 92% / Databricks Genie 84.67% / ThoughtSpot 54.67%）；Cortex 错误率 11.33% | 跨厂商，但发起方 runQL 是竞品（**IND3**） | 中性偏正 |
| BI Bench | Cortex **19.2%，第 10 位**（Sigma 35.2% / Julius 46.1%） | 跨厂商，聚合方 basedash 为竞品（**IND3**） | **负** |
| dbt Labs 2026 benchmark | 语义层把 NL-to-SQL 从 64.5% 提到 98.2–100%（与厂商无关的机制结论） | 第三方（IND3–4） | 中性 |
| Snowflake 自述 BIRD-SQL | 同一 LLM 加语义模型从 57% → 78% | 厂商自测（**IND1**） | 正 |

**Severity: Reliability**。注意三点：一是这些 benchmark 的发起方多为竞品，**IND 均为 3 而非 ≥4**，不构成「独立佐证」；二是 runQL 与 BI Bench 结论互相不一致（88.67% vs 19.2%），说明任务分布与语义层配置差异极大，正好印证 §2.8「benchmark 差值不构成生产优越性」；三是 dbt Labs 的机制结论（语义层是最大杠杆）与原文第二章的判断**方向一致**，是支持性证据。

**6. Gartner Peer Insights（2026-04）同行评议（削弱 C14）**
T2/T3，IND4：「no native robust frameworks for LLM evaluation」「logging and error-tracing tools for AI agents are still immature」「difficult to see exactly which AI job is driving up the bill」。**Severity: Reliability**。

**7. Snowflake 自我定位为 control plane（削弱 C25 的排他性）**
Summit 26（2026-06）厂商声明 + 第三方报道（T4/T3）：Horizon Context 归集 business glossary、lineage、access policy、agent permissions；Cortex Agents 调用携带 Agent Identity 并由 Trust Center 审计。**Severity: Governance**。

**8. Cortex Analyst 的复杂查询边界（削弱 C20 的推荐粒度）**
实践汇总（T3，IND4）：多表 join 与复杂聚合上不稳定；Search 默认分块不保留文档结构。**Severity: Reliability**。

**9. 成本量级参照（削弱 C18 的可操作性）**
社区案例：单个团队业务用户试点期**月账单约 $14k**；另有建议「按计算器结果多准备 30% 预算，尤其 Search」。**Severity: Economic**。

**10. 行业整体落地率（支持原文的成熟度怀疑）**
Deloitte：**不到 2% 的企业**已把 agentic AI 部署到完整生产规模。方向与原文一致，但原文未引。**Severity: —（支持性）**。

**11. Autopilot 的实测反证（推翻 C17 的分歧框定）**
独立头对头实测（T3，IND4）：10 题 × 3 次，发现生成的 metric 定义错误（snapshot 未去重，最多 14 倍高估）。**Severity: Reliability**。

**12. 厂商 benchmark 的独立性（原文正确规避，予以确认）**
Snowflake 自述的 >90% accuracy 出自 **2024-08 内部 150 题集，此后未更新**；47%→83% 出自 **Cortex 内部 benchmark**。**原文没有引用这两个数字** —— 属正确规避，应予肯定。

---

## Silent Evidence

按 §2.6 记录「搜了什么、搜到什么、为什么可能搜不到」。

```yaml
searched:
  - "Cortex Agents" limitations / known issues
  - "Cortex Agents" production issues / postmortem
  - "Cortex Search" row access policy / RLS / owner rights
  - "Cortex Agents" Gartner / Forrester / analyst evaluation      # ← 本轮新增
  - "Cortex Agents" named customer production case study          # ← 本轮新增
  - "Cortex Agents" independent benchmark / cross-vendor          # ← 本轮新增
  - Snowflake REST API X-Snowflake-Role
  - Cortex Agents secondary roles / multi-tenancy isolation

found:
  official_limitations: yes            # 价值最高，原文只覆盖三分之一
  independent_security_research: yes   # Cyera 实测，未见于原文
  analyst_assessment: YES              # Gartner MQ 2026-06-22，Snowflake = Visionary
  named_production_case_study: YES     # Whatnot / Fireblocks / A+E Global Media / Snowflake 内部
  cross_vendor_benchmark: YES          # runQL 2025 / BI Bench / dbt Labs 2026
  independent_replication: no          # 无 IND≥4 的独立复现
```

**结论修订**：上一轮写的是「`independent_supporting = 0` 不是文章没找，而是这类证据公开可得性很低」。**这个说法是错的** —— 分析师覆盖、跨厂商 benchmark、厂商客户故事都已公开发布且容易检索到。修订为：

```text
原文的铁证结构问题 = 「有独立来源可用，但未使用」
而不是              「独立来源不存在」
```

同时保留一项真实的空缺：**没有任何 IND ≥ 4 的独立复现或第三方审计**。这一项在 `absence_assessment` 中另作判定。

---

## Search Coverage

按 §2.7 记录搜索空间覆盖情况（本轮的渠道覆盖已补齐）。

```yaml
search_coverage:
  primary:
    official_docs: yes
    release_notes: yes
  independent:
    practitioner: yes
    benchmark: yes          # ← 本轮补齐，找到 3 个（均为 IND3）
    analyst: yes            # ← 本轮补齐，找到 Gartner MQ 2026-06
    third_party_audit: no
  community:
    reddit: yes
    github: partial
  vendor_side:
    competitor_docs: partial
  language:
    english: yes
    chinese: partial
    japanese: no
```

### absence_assessment（原则 6 的两步判定）

| 缺席项 | coverage_complete | detection_probability | verdict | 结论 |
| --- | --- | --- | --- | --- |
| 分析师评估 | yes | **high**（Gartner MQ 必覆盖该品类） | **negative_evidence** | 不存在缺席 —— 已找到，且方向谨慎。上一轮的 `none` 是取证失败 |
| 独立 benchmark | yes | **high**（NL-to-SQL 是常规 benchmark 对象） | **negative_evidence** | 同上 |
| 具名生产案例 | yes | **high**（厂商常规发布客户故事） | **negative_evidence** | 同上 |
| 第三方独立审计 | yes | **low**（无监管强制，厂商无动机） | no_negative_evidence | 这一项才是真缺席，**不构成对产品的负面判断** |
| 内部事故 / 失败 POC | partial | **low** | no_negative_evidence | 不构成负面判断 |
| 独立复现 | yes | medium | inconclusive | 只表示「尚无人做」 |

**三种组合的读法全部出现**：

```text
coverage_complete = yes + detection_probability = high  → 前 3 项：缺席有负证据价值，可上调 severity
coverage_complete = yes + detection_probability = low   → 第 4、5 项：缺席无负证据价值
coverage_complete = yes + detection_probability = medium → 第 6 项：inconclusive，不入结论
```

**这一步的意义**：它把上一轮的一处方法错误定位清楚了 —— 不是「证据不存在」，而是**把一个 detection probability 为 high 的项目记成了不存在**。按原则 6，`coverage_complete = no` 时不得作任何结论；上一轮实质上是 `coverage_complete = no` 却下了结论。

---

## Real-world Evidence

### Use Case Status（存在 → 结果已证）

本轮找到 4 个具名组织的部署事实，v2.0 的「具名组织级案例：0 条」已被推翻。

| 组织 | 部署事实 | 量化结果 | 来源与 IND | Use Case Status | Outcome Verification | Production Level |
| --- | --- | --- | --- | --- | --- | --- |
| **Snowflake 内部**（合同审查 Agent） | Cortex Agent + AI Extract + CoWork，审计团队自持 playbook 规则表，每次修正写回长期记忆 | 合同审查时间**减少 70%** | 厂商自有博客 T4，**IND1** | Successful | **SELF_REPORTED**（verification: none） | L5（含 immutable audit trail、规则变更留痕、审计控制） |
| **Whatnot** | Cortex Agents 嵌入 Seller Hub，**strict row-level security**；1,000+ 员工 | 90 天内 **80%+ 员工**活跃使用；17 个部门 100% 使用率 | Summit 2026 厂商博客 T4，**IND1** | Successful | **SELF_REPORTED** | L5（外部用户 + RLS + 运维监控体系） |
| **Fireblocks** | Cortex Agents + semantic views；15 个数据域；RBAC 强制数据隔离；对外 Fire Genie | AI agent 承担 **40–50%** 全部数据查询；约 **2 个 FTE/月** | 第三方汇总 Snowflake 案例 T3/T4，**IND1–3** | Successful | **SELF_REPORTED** | L5 |
| **A+E Global Media**（经 Cognizant） | Cortex agent 改造 Creative Airing Logs 分析流程 | 回收约 **200 小时**人工；另 biopharma 客户最高 70% 工作量下降 | 合作方新闻稿 T4，**IND2** | Successful | **SELF_REPORTED** | L4–L5 |
| Reddit [28] mature data product + semantic view | 真实业务使用 | 无 | T3, IND4 | Adopted | NONE | L4 |
| Reddit [15] prod cost & risk | 成本与信任摩擦 | 无（另有 $14k/月 社区参照） | T3, IND4 | Adopted | NONE | L3–L4 |
| Reddit [23] 5 分钟 token / time budget | 生产用 guardrail | 无 | T3, IND4 | Adopted | NONE | L3 |
| Reddit [24] Streamlit vs Notebook 结果不同 | 可复现的平台行为差异 | 无 | T3, IND4 | Adopted | NONE | L4 |
| Gartner Peer Insights 2026-04 | 已进入生产，evaluation / observability / 成本归因仍是痛点 | 无 | T2/T3, IND4 | Adopted | NONE | L4 |
| Anthropic 自研遥测 [34] | Claude Code 使用分布 | 有 | T0, IND1 | — | — | L4–L5（**属 Claude Code，与 Cortex 无关**） |
| Snowflake 官方文档 / release notes | capability exists | 无 | T0, IND1 | — | — | **L1** |

**判定（v2.1.1 三层结论）**：

```text
Use Case Status 最高到：Successful
  —— 4 个具名组织有量化结果（v2.0 判 Adopted，本轮上调）
  —— 但仍无一条达到 Scaled / Outcome-verified

Outcome Verification：
  —— 全部为 SELF_REPORTED，verification = none
  —— 无一条达到 REPRODUCIBLY_REPORTED（方法、样本、口径均未公开）
  —— 无一条达到 INDEPENDENTLY_VERIFIED

Production Level 最高到：L5
  —— 有 L5（真实业务 + 治理 + 持续运营：Whatnot 的 RLS、Snowflake 内部的审计留痕）
  —— 无 L6（大规模 + 关键业务 + 量化 business outcome + 独立可核验）
```

**三处必须保留的限定**（§2.10 规则 4 要求逐项拆分，不得整体当作成功证据）：

```text
1. 4 个案例全部来自厂商自有渠道或其合作伙伴（IND1–IND2），
   按 §2.10 规则 4 只能证明「有人部署过」，不自动证明「部署成功」。
2. 所有量化数字均为 SELF_REPORTED（verification: none），
   按 §3.2 不得写成既成事实，须保留归因（「该组织公布」而非「提升 70%」）。
3. 「Successful」描述的是「有量化结果」，不是「已被证实有效」。
   本轮把 Use Case Status 从 Adopted 上调到 Successful，
   但 Outcome Verification 停留在最低档 —— 两者必须同时陈述。
```

**这一处正是 v2.1.1 相对 v2.0 的改进示范**：v2.0 只有 `Use Case Status` 一个轴，无法表达「有量化结果但全是自证」；v2.1.1 拆出 `Outcome Verification` 后，结论可以精确到「Successful + SELF_REPORTED」，既不低估也不高估。

### 案例证明了什么（§3.4）

4 个案例的用途全部落在「读 / 分析 / 审查」范围内：

```text
supports:          contract review（读+分类）、self-service analytics（查）、
                   customer-facing data query（查）
does NOT support:  transactional execution、trading、approval、external communication
Evidence Coverage: MATCHED
```

原文**没有**把用例外推到交易、审批、对外通信，并在 §10、§13 明确把这些归给 Full-Control Implementation。**这一点处理正确，不受本轮新增案例影响。**

---

## Applicability Conditions

按 §1.5 记录「什么条件下这些 Claim 才成立」。以下条件从原文自身论述与反证共同推出，均为 `required` 级。

| Claim | 条件 | 级别 | 依据 |
| --- | --- | --- | --- |
| C1 / C3 / C20（Cortex 作为 Runtime 可用） | 企业以 Snowflake 为核心数据平台 | required | Gartner MQ caution：Cortex AI 仅在 Snowflake 托管基础设施内可用 |
| C2 / C3 / C20 | Semantic Layer 质量达到可用水平（metric 定义、verified queries、ownership 齐备） | **required** | 原文 §2/§3 自述 + dbt Labs benchmark（语义层是准确率最大杠杆） |
| C6 / C7 / C9 / C20 | **检索语料 entitlement 与表侧 entitlement 已收敛并对齐**（含 Search Service 的 USAGE 授予面审计） | **required** | P0-A-2：默认配置下二者不收敛，此项未满足则 C9 不成立 |
| C10 / C11 | Snowflake role semantics 已在每个边界显式定义，service user 无默认 secondary roles | required | 反证 3 |
| C13 / C14 | Evaluation 结果不被当作授权正确性的证明 | required | C13 的官方限制第 2 条 |
| C14 | 不使用 MCP 作为主要 tool 路径，或接受 MCP 行为不在 evaluation 闭环内 | required（若用 MCP） | C13 的官方限制第 1 条 |
| C18 | 已接受成本 enforcement 存在滞后窗口，并另设硬上限 | required | 反证 9 |
| C20 / C25 / C28 | 企业具备独立于 Runtime 的 Policy / Evidence / Entitlement 能力 | required | C25 的推理链 |
| C20（推荐架构） | 组织已有企业级 Control Plane 与多 Runtime 需求 | required | 原文 §10 已声明 |
| C28 | 受监管要求下的证据台账与工程 telemetry 分库存放 | required | 原文 §7 已声明 |

**判定**：原文对其中 4 项（Semantic Layer 质量、Snowflake 为前提、已有 Control Plane、证据分存）**已显式写出**；对**检索 entitlement 收敛**这一项，原文写成「取决于建模时是否对齐」——**归因错误且条件强度被低估**（实为 required 且默认不满足）；对 role semantics 与成本 enforcement 滞后**未列为条件**。

按 §1.5 规则：「Conditions 里出现 `required` 而无法确认满足时，Claim 最高只能给 `CONDITIONALLY_SUPPORTED`」。**因此 C20（推荐架构）在本轮维持 `CONDITIONALLY_SUPPORTED`，且独立于其他证据质量 —— 这解释了为什么即使本轮找到了更多支持证据，C20 也不应上调。**

---

## Theory / Practice Gaps

| Gap | 位置 | 判断 |
| --- | --- | --- |
| Capability | — | 基本不存在，所列能力均有官方文档支撑 |
| Integration | Semantic Layer、MCP tool curation、附件链路需外围 File / Session Service | 存在，原文已识别 |
| Operational | Evaluation 不能重放 MCP；replay 不传 session attributes；code execution 无 side effect | 存在且是**全文最扎实的发现** |
| **Governance** | **Search 侧 owner's rights 使「同一 Data Entitlement Contract」在默认配置下不成立；secondary roles fallback 使 role-per-tenant 隔离在默认配置下不成立** | **存在，本轮维持并强化**。两条都是**默认即失效**，不能靠「注意配置」解决 |
| Economic | 成本 additive、跨多维归因困难、budget 动作滞后 | 存在，原文已识别，但 enforcement 时效被高估 |
| Reliability | tool 数量↑ → selection accuracy↓；递归 loop；**cross-vendor benchmark 显示复杂任务上准确率显著下降** | 存在，本轮新增 benchmark 维度 |
| Organizational | Semantic Layer 维护责任四方共有 | 存在，是原文**最轻描淡写的一处**。四方共有在实践中通常等于无人负责，应单列 |
| **Analyst-positioning**（本轮新增） | Gartner MQ 将该平台定位为 Visionary 并列出 complexity、hybrid、composite AI 三条 caution | 原文完全未涉及；建议在 §1 或 §7 补一段定位说明 |
| Freshness 一致性 | 多源时间戳合并且输出单一答案在 Demo 里不暴露、在实践中最易出事 | 建议升级为独立失败模式 |

---

## Scope Warnings

按 §1.4 检查「证据 scope 是否 ⊇ claim scope」。以下五处存在泛化风险：

**1. 「Cortex Search 已经成熟」类印象**

```text
证据 scope:  Snowflake-native + 中等规模文档检索 + Snowflake 账户内
claim scope: 通用 RAG 检索层
不能外推到:  cross-cloud + arbitrary corpus + 受监管高风险检索
→ 应限定为 CONDITIONALLY_SUPPORTED（当前状态已如此）
```

**2. §8「三类稳定共识」**

```text
证据 scope:  9 条 Reddit 帖（英文、Snowflake 社区、selection bias 明确）
claim scope: 实际使用者群体的普遍共识
→ 证据 scope ⊂ claim scope，Scope Invalid
```

**3. §14 自主性数据**

```text
证据 scope:  Claude Code 自有遥测（Anthropic 单一产品的单一指标）
claim scope:  Agent 整体演进方向
→ 证据 scope ⊂ claim scope；且源文已回落，属 Freshness 叠加问题
```

**4. §7 与 LangSmith 的比较**

```text
证据 scope:  双方厂商文档的功能清单对照
claim scope: 两套系统在企业 eval 工作流中的相对能力
→ 功能清单 scope ⊂ 工作流能力 scope，Scope Invalid
（本轮找到的 cross-vendor benchmark 也不覆盖这一比较）
```

**5. §14 排他性论证**

```text
证据 scope:  2026-09 之前厂商公开材料中未见某项能力
claim scope: 厂商给不出该能力
→ 属「缺席当反证」，detection probability 为 high（厂商会公布治理能力）
→ Scope Invalid，且违反原则 6
```

---

## Principle Check

按 §4.1 第 19 步执行六条原则检查。**这一节是 v2.1.1 新增的核心产出。**

### 原则 1：结论强度不得超过证据强度

**原文违规 5 处**：

| 位置 | 原结论（强度） | 手上证据（强度） | 应有的最高档 |
| --- | --- | --- | --- |
| 标题 + description「**生产现实**」 | MATURITY | 当时为纯厂商文档；本轮补到 L5 案例但全部 self-reported | 可保留，但须限定为「生产实践反馈」而非「生产现实」 |
| §7「Agent-specific eval **快速成熟**」 | MATURITY | 官方能力文档 | CAPABILITY 级陈述：「功能覆盖在扩展」 |
| §8「三类**稳定共识**」 | prevalence（普遍性） | 9 条 Reddit | 「反复出现的问题」 |
| §14「Frontier vendors **给不出** Identity / Entitlement / Policy」 | 事实性否定 | 无 → 且存在相反证据 | 只能写「原文写作时未见到成熟的跨厂商方案」 |
| §14「企业**必须**自建 Operating Layer」 | 必然性战略 | 单一推断链 | 「在具备多法人合规要求的组织里，更可能需要」 |

**注意第 1 行**：标题的「生产现实」在 v2.0 被列为强度过高。本轮因为找到 L5 案例，**结论发生变化** —— 但改变的不是「强度是否过高」，而是「证据档位是否提升」。这恰好演示了原则 1 的正确用法：**上限由证据档位决定，证据档位一变，上限跟着变**。此外原文 description 用「生产现实」而正文用「按官方已知限制与实际生产反馈校准」，标题与正文口径不一致，建议统一到后者。

### 原则 3：推理链必须单独审查

**原文违规 4 处**（四类高阶 Claim 各一处）：

```text
C3（STRATEGIC）
  证据：官方已列出 10 类 tools、有 threads / orchestration
  直接确立：这是一个功能较完整的 managed agent
  隐含前提：功能完整 ⇒ 可以称为 General Agent Runtime
  替代解释：功能收敛到 data-centric 场景，称为 general 属外推
  结论：链路在「隐含前提」处断裂（缺工具无关用例如跨系统 workflow 的证据）
  处置：QUALIFY（标注为本文的分析框架，非官方定位）

C14（PREDICTION）
  证据：evaluation data API 区分 CORTEX AGENT / EXTERNAL AGENT；TruLens 方向
  直接确立：接口层允许把外部 Agent 纳入同一 data plane
  隐含前提：接口开放 ⇒ 会被采用 ⇒ 会成为统一 plane
  替代解释：各 Runtime 自带 eval，跨 Runtime 采用意愿低
  反证：Gartner 评议指 evaluation / observability 工具链仍不成熟
  结论：未排除替代解释即下预测
  处置：QUALIFY（标 Prediction，并列反证与支持信号）

C20（RECOMMENDATION）
  证据：能力矩阵 + 控制面分析
  直接确立：Cortex 适合 data-native 场景
  隐含前提：企业已有 Control Plane 且愿维护 Runtime Adapter
  缺口：未给出「什么条件下该推荐不成立」
  处置：KEEP 但补齐否决条件（见 Applicability Conditions）
  说明：原文此处已带前提，属四类中处理最好的一处

C25（STRATEGIC）
  证据：OpenAI / Anthropic 的 Runtime 产品化
  直接确立：Runtime 层在商品化
  隐含前提：商品化 ⇒ 厂商不会进入 Identity / Entitlement / Policy 层
  替代解释：厂商正在向该层移动（Summit 26 已证明）
  反趋势检查：未做
  结论：前提与当前信号相反，推理链在第一步就断
  处置：QUALIFY（收敛自建范围）
```

### 原则 6：缺席不自动构成反证

**原文违规 1 处 + 审核方自身违规 3 处。**

**原文的违规**：§14 的排他性论证以「未见厂商提供」为否定依据。该证据的 detection probability 为 **high**（厂商会公布治理能力），Search Coverage 当时为 partial。按两步判定，**「未观察到」不构成「不存在」**，故 C25 判 CONTESTED 而非 SUPPORTED。处置：撤回否定式断言，改为限定时间窗的观察陈述。

**审核方自身的违规（必须记录）**：上一轮（v2.0 口径）把分析师评估、独立 benchmark、具名案例三项记为 `none`，实测三项均存在且检测概率为 high。这违反原则 6 的两步判定（实质是 `coverage_complete = no` 却下了结论）。

```text
❌ 上一轮的写法：independent_benchmark: none → 因此原文只能靠厂商文档
✅ 本轮的写法：  三项均存在（coverage_complete = yes）
                → 原文的问题不是「没有独立来源可用」，而是「有而未用」
```

**同时保留一条不构成负面判断的真缺席**：无 IND ≥ 4 的独立复现或第三方审计。该项 detection probability 为 low（无监管强制），按原则 6 不得推出产品负面结论。

### 原则 2 / 4 / 5：无违规

- **原则 2**（引用 ≠ 证据）：原文引用精确、release note 可逐条追溯，数值类也基本回源（除 P0-A-1 一处）。**这是全文最强的部分。**
- **原则 4**（capability ≠ maturity）：原文 §26 已自述「Snowflake 最大的优势是能力收敛，不是所有能力都已到达成熟平台的终局」，方向正确。**违规在于执行层面**（§7「快速成熟」、§8「稳定共识」），不在主张层面。
- **原则 5**（feasibility ≠ generality）：原文对客户案例的处理正确 —— 未引用厂商客户故事页，未从单案例外推。**但本轮找到的 4 个具名案例表明，原文的克制同时导致了证据缺口。**

### Principle Check 汇总

```text
结论强度超过证据强度:  5 处（§7 / §8 / §14×2 / 标题-description 口径不一致）
推理链断裂:            4 处（C3 / C14 / C20 / C25，其中 C20 处理最好）
缺席被当作反证:        原文 1 处（C25）；审核方自身 3 处（已修正）
```

**六条原则中，原则 1 是本篇最大的问题所在。** 原文的事实层与推理层质量都高，问题集中在**把 CAPABILITY 层的证据用于 MATURITY 层的结论**。

---

## Claims That Should Be Rewritten

**R1（P0）** — §2 授权归因

```text
Original:    两者是否形成同一个 Data Entitlement Contract，取决于建模时是否对齐。…
             Search authorization 与 SQL authorization 必须收敛到同一份 entitlement 定义。
Recommended: Cortex Search 服务按官方设计以 owner's rights 执行检索 —— USAGE 一旦授予，
             调用方即获得 owner 角色的读取范围，表侧的行访问策略与 masking 不参与判定。
             因此这不是建模对齐问题，而是权限面的设计行为：需要按 entitlement 域拆分
             Search Service、在调用侧使用 server-validated filter，并审计谁持有 USAGE。
Action:      REVERSE
```

**R2（P0）** — §2 规模约束

```text
Original:    单 Search Service 默认规模约束为 400M rows
Recommended: 单 Search Service 建议不超过 1 亿行（<100M rows），更大规模需与 Snowflake 协商；
             并补充 512-token 嵌入窗口与响应体积上限（REST 10 MB / SQL SEARCH_PREVIEW 300 KB）。
Action:      DOWNGRADE（数值纠正）
```

**R3（P0）** — §6 模型清单

```text
Original:    Cortex orchestration model 可从 Snowflake 目录选择（含 Anthropic、OpenAI、部分 Google 模型，支持 auto）
Recommended: Cortex orchestration model 限定在 Snowflake 目录内，当前包含 auto、Claude 4.x 系列与 openai-gpt-4.1；
             不含 Google 模型。与 LiteLLM 式任意 endpoint 抽象仍有差距。
Action:      DOWNGRADE（事实纠正）
```

**R4（P1）** — §7 成熟度措辞

```text
Original:    Agent-specific eval 快速成熟
Recommended: Agent-specific evaluation 的功能覆盖在快速扩展（ground-truth、reference-free、
             custom metrics、trace-level），但企业侧的独立评价仍指出 LLM 评估框架与
             observability 工具链不成熟（Gartner Peer Insights 2026-04）。
Action:      QUALIFY
```

**R5（P1）** — §8 共识措辞

```text
Original:    实际使用者反馈呈现三类稳定共识
Recommended: 社区讨论中反复出现三类问题（共 9 条公开帖，均为英文 Snowflake 社区，
             存在满意者不发帖的选择偏差）。
Action:      QUALIFY
```

**R6（P1）** — §7 / §9 补入独立评估

```text
新增段建议:  第三方评估与跨厂商 benchmark 提供了原文未覆盖的参照。
             Gartner 的 AI Platforms for DSML 象限（2026-06-22）将 Snowflake 列为 Visionary
             而非 Leader，并提示平台复杂度、Cortex AI 仅在托管基础设施内可用、
             composite AI 依赖开源库三项注意点，同时肯定其 context and decision intelligence 方向。
             跨厂商 NL-to-SQL benchmark 结论分歧较大：runQL 的 2025 年测试给出 Cortex Analyst
             88.67%（其自身 92%），BI Bench 则给出 19.2%（第 10 位）。两者均为竞品发起，
             任务分布与语义层配置差异显著，正好印证「benchmark 差值不构成生产优越性」。
Action:      ADD
```

**R7（P1）** — §14 排他性论证

```text
Original:    Frontier vendors 给得出 Model、Harness、Sandbox、Tool Calling、Subagents、长执行，
             给不出「谁属于哪个法人实体、能访问哪只基金、为了什么业务目的、在哪条政策下、
             经谁批准、用哪些数据、执行什么动作」。
Recommended: 厂商正在向治理层移动。Snowflake 在 Summit 26 已将自身定位为 LLM 与企业系统之间的
             control plane，给出 Horizon Context（业务术语表、血缘、访问策略、agent 权限聚合），
             并让 Cortex Agents 调用携带 Agent Identity、由 Trust Center 审计。
             因此企业自建的价值不在「厂商给不出」，而在于：跨 Runtime 的授权语义、
             多法人主体的 entitlement 归属、以及监管举证责任 —— 这些是任何单一厂商
             无法代表企业承担的。
Action:      QUALIFY（同时收敛自建范围）
```

**R8（P1）** — §14 自主性数据

```text
Original:    Anthropic 研究显示 Claude Code 长运行 session 快速增长，最长 session
             三个月内从不足 25 分钟增至超过 45 分钟
Recommended: 该数据出自 Anthropic 对自有产品的遥测（p99 口径），源文同时指出
             2026 年 1 月中旬后该趋势出现回落。它反映的是 Claude Code 的使用分布，
             不能直接外推为 Agent 整体演进方向。
Action:      QUALIFY
```

**R9（P1）** — §14 OpenAI Agents API

```text
Original:    OpenAI 2026-09-10 发布的 Agents API 把 Codex 背后的 harness … 做成 managed runtime
Recommended: OpenAI 于 2026-09-10 将 Agents API 置于 public beta；当前数据驻留仅限美国区域，
             且即使用自有 sandbox 也不适用 Zero Data Retention。
Action:      QUALIFY
```

**R10（P2）** — §8 Autopilot

```text
Original:    社区对 Semantic View Autopilot 的反馈出现分歧：有人认为已可自动化 80–90%，
             也有人认为复杂 metric 与 edge case 仍需大量人工修正
Recommended: Autopilot 的适用范围有条件：独立实测显示其可能在 metric 定义上出错
             （snapshot 未去重时最多高估 14 倍），复杂业务域仍需人工复核。
             采用前应保留 verified queries 作为回归基线。
Action:      REVERSE（从「观点分歧」改为「限制清单」）
```

---

## Claims That Should Be Removed

- 全文 47 条引用中的 `utm_source=chatgpt.com` 与 `_bhlid` 等跟踪参数（属引用卫生，非内容问题）
- frontmatter 的 `version: v2.1 终轮事实收紧（P0/P1/P2）` —— 版本自指不应进入交付稿
- §6「已从单一数据问答形态扩展为 Data-Native Managed General Agent Runtime（Coding Agent 于 2026-08-26 GA [40]），不宜再写成…」与紧随其后的重复表述，合并为一处

---

## Missing Evidence

按补齐价值排序。**如果只能补一条，补 Gartner MQ 的定位说明（P1-13）** —— 它是唯一一条同时影响成熟度层结论强度、且完全未被原文使用的独立来源。

```text
1. Gartner MQ for AI Platforms for DSML（2026-06-22）中 Snowflake 的定位与三条 cautions
   —— 影响 C14 与全文成熟度措辞，且属 IND4 独立来源

2. 跨厂商 NL-to-SQL benchmark 的分歧结论（runQL 2025 / BI Bench / dbt Labs 2026）
   —— 影响 §7 的治理框架与「语义层是最大杠杆」这一正相关结论
   （dbt Labs 的机制结论与原文第二章方向一致，属支持性证据，值得引用）

3. 具名组织案例的量化结果（Whatnot / Fireblocks / A+E Global Media / Snowflake 内部）
   —— 影响 Reality 层；须按 §2.10 规则 4 拆六项、按 §3.2 保留 SELF_REPORTED 归因

4. §14 Economic Index 的原始出处（C23 目前不可核）

5. secondary roles fallback 的官方原文位置（C10/C11 的前置条件）

6. Cortex Search 512-token 窗口的官方原文位置（C7 的完整性缺口）
```

---

## Claim Records

按 §4.7 输出结构化记录。选三条最具代表性的 Claim。

### Record 1 — C9（授权归因，判 REFUTED + REVERSE）

```yaml
claim:
  text: "Search 与 SQL 的授权一致性取决于建模时是否对齐"
  type: CAUSAL
  epistemic: FACT
  polarity: affirmative

context:
  product: Cortex Search
  version_or_release: 2026-09
  region: any
  availability: GA
  api_surface: SQL / REST
  date_verified: 2026-09-15

scope:
  domain: financial-services
  workload: retrieval
  risk_level: read-with-masking
  excluded: [cross-cloud, non-Snowflake-native corpus]

applicability:
  conditions:
    - item: search-service-usaged-audited
      level: required
    - item: entitlement-domain-separation
      level: required

evidence:
  - type: T0
    source: official-limitations-owner-rights
    directness: direct
    authority: 5
    independence: IND1
    freshness: current
    completeness: full
  - type: T2
    source: independent-security-research
    directness: direct
    authority: 4
    independence: IND4
    freshness: current
    completeness: partial

independent_sources: 1

counter_evidence:
  strength: strong
  items:
    - text: "服务以 owner's rights 运行，USAGE 即等于 owner 读权限"
      severity: Safety-Security
      confirmed: true

silent_evidence:
  searched: ["cortex search" row access policy, "cortex search" owner rights, "cortex search" rls bypass]
  found: official_confirmation_plus_independent_test
  plausible_reasons: []

search_coverage:
  primary: { official_docs: yes, release_notes: yes }
  independent: { practitioner: yes, security_research: yes, benchmark: no }
  community: { reddit: yes }
  vendor_side: { competitor_docs: no }
  language: { english: yes }

absence_assessment:
  coverage_complete: complete
  detection_probability: high
  verdict: negative_evidence

real_world:
  existence: proven
  status: Successful
  production_level: L5
  outcome: { type: SELF_REPORTED, verification: none }
  evidence_coverage: partial
  scale: partial

gaps: [governance, reliability]

assessment:
  status: REFUTED
  confidence: HIGH
  sufficiency: SUFFICIENT
  fact_strength: 5
  source_strength: 5
  independence: 4
  reality_strength: 0
  timeliness: 5

recommendation:
  action: REVERSE
  wording: >
    Cortex Search 按官方设计以 owner's rights 执行检索，USAGE 一旦授予即等于给出
    owner 的读取范围；这是权限面的设计行为，不是建模对齐问题。
    缓解需要按 entitlement 域拆分 Search Service、调用侧使用 server-validated filter，
    并审计 USAGE 持有面。
```

### Record 2 — C14（Evaluation Data Plane，判 CONTESTED）

```yaml
claim:
  text: "Snowflake 有机会成为统一的 Evaluation / Observability Data Plane"
  type: PREDICTION
  epistemic: INFERENCE
  polarity: affirmative

context:
  product: Cortex Agent Evaluations / AI Observability
  version_or_release: 2026-09
  availability: GA
  api_surface: REST / SQL
  date_verified: 2026-09-15

scope:
  domain: data-native evaluation
  workload: agent-evaluation
  deployment_model: Snowflake-native
  excluded: [non-Snowflake runtimes, security-testing, regulatory-evidence]

applicability:
  conditions:
    - item: mcp-behavior-outside-eval-scope
      level: required
    - item: eval-result-not-used-as-authorization-proof
      level: required
    - item: cross-runtime-adoption-willingness
      level: required

evidence:
  - type: T0
    source: official-docs-external-agent-eval-api
    directness: indirect
    authority: 4
    independence: IND1
    freshness: current
    completeness: partial
  - type: T2
    source: gartner-peer-insights-2026-04
    directness: direct
    authority: 4
    independence: IND4
    freshness: current
    completeness: partial

independent_sources: 1

counter_evidence:
  strength: strong
  items:
    - text: "no native robust frameworks for LLM evaluation; agent observability immature"
      severity: Reliability
      confirmed: false
    - text: "Gartner MQ 2026-06 cautions: platform complexity; Cortex AI only in managed infra"
      severity: Reliability
      confirmed: true

silent_evidence:
  searched: ["cortex agents" evaluation, "cortex" observability analyst, "trulens" adoption]
  found: analyst_and_peer_evidence_both_present
  plausible_reasons: []

search_coverage:
  primary: { official_docs: yes, release_notes: yes }
  independent: { analyst: yes, practitioner: yes, benchmark: partial }
  community: { reddit: yes }
  vendor_side: { competitor_docs: partial }
  language: { english: yes }

absence_assessment:
  coverage_complete: complete
  detection_probability: high
  verdict: negative_evidence

real_world:
  existence: vendor-documented
  status: Adopted
  production_level: L4
  outcome: { type: NONE, verification: none }
  evidence_coverage: partial

gaps: [operational, governance, analyst-positioning]

assessment:
  status: CONTESTED
  confidence: LOW-MEDIUM
  sufficiency: INSUFFICIENT
  fact_strength: 4
  source_strength: 3
  independence: 2
  reality_strength: 3
  timeliness: 5

recommendation:
  action: QUALIFY
  wording: >
    Snowflake 在接口层已允许外部 Agent 纳入同一 evaluation data plane，方向明确；
    但企业侧独立评价指出 LLM 评估框架与 observability 工具链尚不成熟，
    且该定位是否被采用取决于各 Runtime 的意愿。宜标为 Prediction 并列出支持与反对信号。
```

### Record 3 — C25（Operating Layer 排他性，判 CONTESTED）

```yaml
claim:
  text: "企业必须自建 Operating Layer，因为 Frontier 厂商给不出 Identity / Entitlement / Policy"
  type: STRATEGIC
  epistemic: OPINION
  polarity: affirmative

context:
  product: OpenAI Agents API / Claude Agent SDK / Snowflake Cortex
  version_or_release: 2026-09
  date_verified: 2026-09-15

scope:
  domain: multi-entity financial-services
  risk_level: high
  region_regulation: [US, EU, FSI]
  org_size: large

applicability:
  conditions:
    - item: multi-legal-entity-entitlement
      level: required
    - item: regulatory-evidence-obligation
      level: required
    - item: cross-runtime-authorization-semantics
      level: required

evidence:
  - type: T4
    source: openai-anthropic-product-announcements
    directness: indirect
    authority: 3
    independence: IND1
    freshness: current
    completeness: one-sided
  - type: T4
    source: snowflake-summit-26-control-plane-positioning
    directness: direct
    authority: 2
    independence: IND1
    freshness: current
    completeness: partial

independent_sources: 0

counter_evidence:
  strength: strong
  items:
    - text: "Snowflake Summit 26: Horizon Context 归集业务术语表、血缘、访问策略、agent 权限；调用携带 Agent Identity 并受 Trust Center 审计"
      severity: Governance
      confirmed: true

silent_evidence:
  searched: ["frontier vendor" identity, entitlement, policy, agent governance]
  found: vendor_governance_capabilities_exist
  plausible_reasons: []

search_coverage:
  primary: { official_docs: yes, release_notes: yes }
  independent: { analyst: yes, practitioner: partial }
  community: { reddit: partial }
  vendor_side: { competitor_docs: yes }
  language: { english: yes }

absence_assessment:
  coverage_complete: complete
  detection_probability: high
  verdict: negative_evidence

inference_chain:
  directly_established: "Runtime 层的 orchestration / sandbox / context 管理正在被产品化"
  indirectly_supported: "企业平台的差异化空间在治理层"
  additional_assumptions: ["厂商不会进入 Identity / Entitlement / Policy 层"]
  alternative_explanations: ["厂商正在向该层移动，最终形成厂商治理能力 + 企业自有合规语义的分工"]
  claim_leap_detected: true

real_world:
  existence: vendor-documented
  status: Adopted
  production_level: L4
  outcome: { type: NONE, verification: none }
  evidence_coverage: partial

gaps: [governance, organizational]

assessment:
  status: CONTESTED
  confidence: LOW-MEDIUM
  sufficiency: INSUFFICIENT
  fact_strength: 3
  source_strength: 3
  independence: 1
  reality_strength: 2
  timeliness: 5

recommendation:
  action: QUALIFY
  wording: >
    厂商正在向治理层移动，排他性前提已过期。企业自建的价值应重新表述为三件厂商无法
    代表企业承担的事：跨 Runtime 的授权语义、多法人主体的 entitlement 归属、监管举证责任。
```

---

## Final Assessment

```text
Fact strength:        4 / 5   抽查 12 条关键事实，10 条与官方文档逐字吻合
                              扣分：1 处硬错（400M）+ 1 处归因错（Search 授权）+ 1 处举例错（Google 模型）
Source strength:      4 / 5   引用精确、release note 可逐条追溯，这一点强于多数行业分析
                              但 Authority 只对「主体自身的事实」成立，用作成熟度判断时降为 1
Independence:         1 / 5   47 条引用中组织级独立来源 0 条；本轮找到的 IND3 来源原文未用
                              注意：independence 低是关于证据结构的结论，不是对产品的否定
Reality strength:     4 / 5   L5 案例存在（Whatnot / Fireblocks / Snowflake 内部），
                              但全部 SELF_REPORTED；Use Case Status 达 Successful，
                              Outcome Verification 停在最低档
Timeliness:           4 / 5   主体引用集中在 2026-03 至 2026-09，属当前版本
                              扣分：§14 自主性数据源文已回落；Gartner MQ 与 Summit 26 未纳入
--------------------------------------------------------------------------------
Status 分布:      SUPPORTED 12 ｜ CONDITIONALLY_SUPPORTED 8 ｜ CONTESTED 3 ｜
                  REFUTED 3 ｜ INSUFFICIENT_EVIDENCE 2 ｜ OUTDATED 0
Sufficiency 分布: SUFFICIENT 11 ｜ PARTIALLY_SUFFICIENT 10 ｜ INSUFFICIENT 4 ｜ n/a 3
Overall confidence（分层）:
  ├ Fact / Capability 层:  High        —— 可直接作为技术选型底稿
  ├ Maturity / 生产层:     Low–Medium  —— 有 L5 案例但全为自证；Gartner 定位为 Visionary
  ├ Comparison 层:         Low         —— 无 benchmark 覆盖该比较
  └ Prediction / 战略层:   Low–Medium  —— 方向成立，排他性前提需重写
Principle 违规数: 10（原则 1 五处 ｜ 原则 3 四处 ｜ 原则 6 一处）
  另有审核方自身违规 3 处，已在本轮修正
```

### 发布建议

**必须改（P0）**

```text
1. §2 Cortex Search 授权行为的归因（REVERSE）—— 本轮最重要的修改，
   它把一条数据泄漏路径从「建模待办」纠正为「默认配置下的设计行为 + 三个架构动作」
2. §2 规模约束 400M → 100M（并补 512-token 嵌入窗与响应体积）
3. §6 模型清单删除「部分 Google 模型」
4. 补 secondary roles fallback 前置条件（§5）
```

**强烈建议改（P1 中影响结论强度的六条）**

```text
5. §14 排他性论证 QUALIFY（引用 Summit 26 的治理层动作，收敛自建范围）
6. §7 / §9 补入 Gartner MQ 2026-06 定位与跨厂商 benchmark 分歧结论
7. §14 自主性数据、OpenAI Agents API、per-user quotas 三处补限定语
8. §7「快速成熟」→「功能覆盖在扩展」；§8「稳定共识」→「反复出现的问题」
9. §8 Autopilot 改为限制清单
10. 引用卫生：修 [4] 双 /en/、合并 [13]/[14]、修 [36]、清洗 47 条 utm 参数
```

**可与 P1 同批**

```text
11. MCP 四条补充限制、§1 工具清单补 availability、§6 重复句合并
12. frontmatter 版本自指删除；标题与 description 口径统一到「生产实践反馈」
```

### 与前两轮的差异

| 项 | v1 口径 | v2.0 口径 | **v2.1.1 口径（本轮）** |
| --- | --- | --- | --- |
| 最严重发现 | 400M 行数错误 | Search 授权归因错误 | 同 v2.0，并补 cross-vendor benchmark 反证 |
| 落地程度 | 最高 L2–L3 | Adopted ≈ L4 | **Successful + SELF_REPORTED ≈ L5** |
| 具名组织案例 | 未评 | 「0 条」 | **4 个**（Whatnot / Fireblocks / A+E / Snowflake 内部） |
| 独立来源 | 「为 0」 | 「公开可得性低」 | **存在且未使用**（Gartner MQ / 3 个 benchmark / 4 个案例） |
| 战略层 | 须标 Prediction | CONTESTED | CONTESTED + 原则 6 违规认定 |
| 结论形态 | 单点总分 | 按 Claim 类型分层 | 分层 × 三正交结论 + **Principle Check** |
| 方法论错误 | — | — | **审核方自身 3 处缺席误判，已记录并修正** |

### 一句话

原文的**事实层与方法论是对的**（先声明口径 → 逐条给官方依据 → 主动写官方限制 → 不引厂商 benchmark → 不定项归给 Full-Control Runtime），问题集中在三处：**两处授权机制写错**、**成熟度结论的强度超过证据档位**、**已有的独立来源未被使用**。改动量不大，但 P0-A-2 不改，金融读者会低估一个默认生效的数据泄漏路径。
