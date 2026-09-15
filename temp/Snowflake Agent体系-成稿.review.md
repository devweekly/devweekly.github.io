# Evidence & Claim Review

**审核对象**：`temp/Snowflake Agent体系-成稿.md`（v2.1，14 节 + 47 条引用定义，900 行）
**审核方法**：`skills/evidence-and-claim-review` **v2.0.0**（四层模型；17 步 Required Actions；§4.2 Stop/Continue Conditions；F/S/I/R/T 五维；Status × Confidence 正交）
**审核日期**：2026-09-15｜**版本**：本文件为第二轮（v2 口径），取代上一份 v1 口径的审核

---

## Overall Verdict

**Medium confidence，按 Claim 类型分层：**

| 层 | Confidence | Independence | 依据 |
| --- | --- | --- | --- |
| Fact / Capability / Limitation 层 | **High** | IND1（厂商唯一权威源） | 抽查 12 条关键事实，10 条与官方文档逐字吻合；这一层的高可信**不需要**独立来源 |
| Maturity / 生产可用层 | **Low–Medium** | IND1，组织级独立来源仅 1 条且方向相反 | 无 L5/L6 案例；Use Case Status 最高到 Adopted |
| Comparison 层（vs LangSmith） | **Low** | IND1（双方自证） | Benchmark Validity 检查不通过：无任何 benchmark |
| Prediction / Strategic 层（第十四节） | **Low–Medium** | IND1 | 且本轮找到**方向相反**的厂商动作，原排他性论证被削弱 |

一句话：**技术底稿可信，成熟度与战略结论需要重写强度，不是重写方向。**

相对上一轮，本轮有两处重要升级：**一处新 P0（授权行为的归因错误）** 和 **一处新 P1（战略结论的相反证据）**。

---

## Critical Findings

### P0

#### P0-A-1｜Cortex Search 的授权行为被归因错误（本轮最严重）

**原文（§2）**：

> 「两者是否形成同一个 Data Entitlement Contract，**取决于建模时是否对齐**。… Search authorization 与 SQL authorization 必须收敛到同一份 entitlement 定义，否则检索侧会绕过表侧的行级控制。」

**事实**：Snowflake 官方文档《Query Cortex Search Service → 使用所有者权限进行查询》明确写着：

> Cortex Search 服务**使用所有者权限（owner's rights）执行搜索**…任何有足够权限查询该服务的角色，**都可以查询该服务已索引的任何数据，而不管该角色对服务源查询引用的基础对象（例如表和视图）的权限如何**。例如，对于引用具有行级掩码策略的表的 Cortex Search 服务，该服务的查询用户将能够从所有者角色具有读取权限的行查看搜索结果，**即使查询用户的角色无法读取源表中的这些行**。

Snowflake 官方开发者指南进一步确认这是设计选择而非缺陷：*"Cortex Search Services runs with Owner's Rights **by design**."*

**独立佐证**：安全厂商 Cyera 发布过完整实测——`accountadmin` 创建 Search Service 后把 USAGE 授予低权用户，该用户**直接查表只能看到脱敏数据，经 Search Service 却拿到未脱敏的工资数据**；Cyera 在文中致谢 Snowflake 团队的配合。

**判定**：

| 项 | 结论 |
| --- | --- |
| Claim Type | CAUSAL（「是否一致取决于建模是否对齐」） |
| Status | 就这一句而言 = **REFUTED**（一手来源直接否定该因果关系） |
| Evidence | T0 官方 limitations + T2/T3 独立安全研究（IND4） |
| 问题性质 | 不是「建模纪律不足」，而是**平台的设计行为** |

**为什么这是 P0 而不是 P1**：原文的措辞会让读者得出错误行动——「把建模对齐就好了」。实际缓解需要三个**架构动作**：

```text
1. 按 entitlement 域拆分多个 Search Service，USAGE 只授予对应角色
   （因为 USAGE 一旦给出，就等于给出 owner 的读权限）
2. 调用侧传 server-validated filter（Snowflake 官方给出的推荐做法，
   用后端 owner session + CURRENT_ROLE() 构造 filter，不让前端可篡改）
3. 审核「谁持有该 Search Service 的 USAGE」——这是权限面而不是建模面
```

按原文的写法，一个金融团队会把这条风险登记成「语义层治理待办」；按事实，它应该登记成**数据泄漏路径 + 权限设计缺陷**。

处置：**REVERSE**（把因果归因掉转），并补上上述机制与缓解路径。

#### P0-A-2｜Cortex Search 行数上限写成 400M，官方为 100M

原文（§2）：「单 Search Service 默认规模约束为 **400M rows**，更大规模需要与 Snowflake 协商扩容 [10]」。

官方 `Cortex Search → Known limitations → Base table size`：物化结果必须**小于 1 亿行**，超出时 `CREATE CORTEX SEARCH SERVICE` 直接报错；要突破需联系账户团队。三个独立第三方整理（Flexera / Chaos Genius / Archetype Consulting）一致为 100M。

```text
Source–Claim Alignment : FAIL（来源写 100M，文章写 400M，差 4 倍）
Source Reviewability   : 引用链接存在，但显然未被打开
Status                 : REFUTED
```

#### P0-B｜证据结构：46 条来源中，独立第三方组织级来源仅 1 条，且方向相反

去重后（[13] 与 [14] 为同一文档）**46 条来源**，按 v2 的 Source Type 分布：

| Type | 条数 | 具体 |
| --- | --- | --- |
| T0 Direct primary（Snowflake 官方文档 / release notes） | 28 | — |
| T0 Direct primary（Anthropic 自研研究） | 2 | [34] [35] |
| T0 Direct primary（LangChain 官方文档，竞品自证） | 2 | [6] [7] |
| T3 Practitioner（Reddit） | 9 | [2][3][11][15][23][24][27][28][29] |
| T4 Vendor positioning（OpenAI / Anthropic 公告） | 4 | [30][31][32][33] |
| **T1 Independent primary（独立实验 / benchmark / 论文）** | **0** | — |
| **T2 Reputable secondary（分析师 / 研究机构）** | **0**（仅下述 1 条同行评议） | — |

**独立来源统计（v2 要求显式计数）**：

```yaml
independent_sources: 9        # 全部为匿名 Reddit 帖
organization_level_independent_sources: 1   # Gartner Peer Insights 企业评议（2026-04）
independent_supporting: 0     # 方向为支持本文结论的独立来源：0
```

**关键发现**：唯一一条组织级独立来源，方向是**否定**的。Gartner Peer Insights 的企业评议（含公司规模与行业标注）写道：

> 「Lack of AI Evaluation Tools: There are **no native, robust frameworks for LLM evaluation or automated testing of Cortex-powered agents**.」
> 「The observability and debugging gap in AI services… logging and error-tracing tools for Python UDFs and AI agents are **still immature**.」
> 「Granular Cost Attribution: It is difficult to see exactly which specific AI job or LLM call is driving up the bill.」
> 「vendor lock in concerns regarding proprietary features that make portability harder.」

这条评议发布于 2026-04（在 Evaluations 2026-03 GA **之后**），直接指向原文 §7 与 §9 的乐观面。本节不要求删文——原文已自我限定「尚未等价 LangSmith」——但**这条反证必须写进正文**，否则读者只看到厂商文档的乐观版本。

---

### P1

**P1-1｜Cortex Search 的已知限制清单只覆盖了三分之一**

原文只写「response size 有限制」。官方限制实际包括（均为 v2 §4.2 要求的「涉及数值必须回源核」范围）：

| 限制 | 官方值 | 原文 |
| --- | --- | --- |
| Base table size | **< 100M 行** | ✗ 写错（400M） |
| 向量嵌入窗口 | **每条文本仅前 512 token 参与向量匹配**（更长文本仍参与关键词检索） | ✗ 完全缺失 |
| Response size | REST / Python API **10 MB**；SQL `SEARCH_PREVIEW` **300 KB** | △ 只写「有限制」 |
| 克隆 | **不支持** | ✗ 缺失 |
| 表不可变 | 运行期不得修改或删除底层表 | ✗ 缺失 |
| 区域 / 模型可用性 | 按区域不同 | ✗ 缺失 |

其中 **512-token 嵌入窗口**对原文的工程主张影响最直接：既然「长文档需要 ingestion pipeline」，那预分块就不是可选优化而是**语义召回的前置条件**。这条缺失使 §2 的 chunk 建议显得像工程惯例而非硬约束。

**P1-2｜role-per-tenant 的 secondary roles fallback 路径完全未提**

原文 §5 用一整段讲 identity propagation，并强调「不能假设平台侧授权一次即代表全部授权」。但漏了这条：在 role-per-tenant 模式（按请求传 `X-Snowflake-Role`）下，**如果 service user 持有默认 secondary roles，agent 会 fallback 到其他角色，租户隔离即失效**。Snowflake 工程师的技术实践文章明确写着「为了**防止任何 fallback**，需要将 service user 配置为没有默认 secondary roles」；官方 MCP 文档同样推荐 `OAUTH_USE_SECONDARY_ROLES = NONE`。

这是一条**默认即失效**的路径，且与 P0-A-1 属同一类问题（默认配置下的授权边界不成立）。原文的 §2「典型泄漏形态」和 §5 的 role 链都应该提到它。

**P1-3｜[4] 链接损坏**：`https://docs.snowflake.com/en/en/release-notes/...`，双 `/en/` 前缀。规范形式为
`https://docs.snowflake.com/release-notes/2026/other/2026-03-13-cortex-agent-evaluations`。

**P1-4｜[13] 与 [14] 是同一篇文档，被拆成两条来源（伪多来源）**

```text
[13] docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp
[14] docs.snowflake.cn/en/user-guide/snowflake-cortex/cortex-agents-mcp   ← 同一路径，镜像域名
```

两条的标题字串完全相同（`Snowflake-managed MCP server | Snowflake Documentation`），而 [14] 在参考列表里被标为「Snowflake-managed MCP server **限制**」——标签与内容不符。这构成 v2 §2.3 的「同一文档的镜像变体被拆号计入」，抬高了表面来源量。应合并为一条。

**P1-5｜引用卫生**：全部 47 条 URL 带 `utm_source=chatgpt.com`；[31] 另有 `_bhlid=f8286af…`；[34] 另有 `trk=lss-blog-leading-team-with-metrics`；[36] 带有垃圾参数
（`?-what-the-heck-is-rust%2F=undefined&hubs_content-cta=-the-hustle&hubs_post-cta=homepage`），规范地址为 `https://www.anthropic.com/research/trustworthy-agents`。

**P1-6｜§6 orchestration 模型「含 Anthropic、OpenAI、部分 Google 模型」= REFUTED**

官方 Cortex Agents 模型清单为：
`auto` / `claude-haiku-4-5` / `claude-sonnet-4-5` / `claude-4-6-sonnet` / `claude-4-sonnet` / `openai-gpt-4.1`
——**没有 Google 模型**。这句话被用来支撑「multi-model ≠ provider-agnostic」的论证，论点成立但举例错误。

**P1-7｜§14 自主性数据丢了三个关键限定**

原文：「Anthropic 研究显示 Claude Code 长运行 session 快速增长，最长 session 三个月内从不足 25 分钟增至超过 45 分钟 [34]」。

源文实际内容：这是 **99.9th percentile 的 turn duration**；中位数约 **45 秒**；窗口是 2025-10 → 2026-01；且**源文明确说明该极值在 2026-01 中旬之后已有所回落**。原文取了最陡的一段、去掉前提、去掉回落、去掉中位数——四处都缺。

**P1-8｜§14 OpenAI Agents API 漏 state 与一条金融硬限制**

原文：「OpenAI 2026-09-10 **发布**的 Agents API…」。实际是 **public beta**（官方公告与开发者文档一致）。更关键的是官方文档明确：**data residency 仅支持美国；不支持 Zero Data Retention，且自建 sandbox 亦不因此获得 ZDR 资格**。文章通篇以金融机构为读者，这条遗漏是实质性的。

**P1-9｜§9 per-user quotas 的 enforcement 说法偏高**

原文：「user-level Agent FinOps 已具备**平台级 enforcement 能力，不止 usage reporting**」。实测口径：resource budget 的阈值动作是**周期性执行，标准配置下可滞后至 8 小时**；`CORTEX_AGENT_USAGE_HISTORY` 也不覆盖 CoWork 发起的用量（走 `SNOWFLAKE_INTELLIGENCE_USAGE_HISTORY`）。它是「准实时封顶 + 分账」，不是即时熔断。

**P1-10｜§8「三类稳定共识」用词超出证据**

支撑是 9 条 Reddit 帖（其中 [3] 一条被复用于三处论点）。按 v2 §2.1，社区来源对「prevalence」的 Authority 为 1。Gartner 同行评议方向一致，但那是**单条**企业评议，也不构成共识。应改为「反复出现的三类问题」。

**P1-11｜§2 / §8 把已知限制写成了观点分歧**

原文：「社区对 Semantic View Autopilot 的反馈也出现分歧：**有人认为**已可自动化 80–90%，**也有人认为**复杂 metric 与 edge case 仍需大量人工修正 [29]」。

实际有可核验的硬限制与独立实测：

```text
官方限制：Level of Detail 计算不支持迁移；混合数据源不支持；
         Tableau 虚拟连接不支持；文件须 <250 MB；published data source 须单独上传
质量依赖：账户 query history 的质量
独立实测：头对头测试发现生成的 metric 定义错误
         （snapshot 表上 COUNT(booking_id) 未去重，最多放大 14 倍）
维护成本：verified queries 不自维护，需定期复核
```

「分歧」句式在这里掩盖了可确定的事实。这是 v2 §4.5 明确点名的红旗句式。

**P1-12｜（本轮新增）§14 的战略结论存在方向相反的厂商动作**

原文的排他性论证是：「Frontier vendors 给得出 Model、Harness、Sandbox、Tool Calling、Subagents、长执行，**给不出**『谁属于哪个法人实体、能访问哪只基金、为了什么业务目的、在哪条政策下、经谁批准、用哪些数据、执行什么动作』」，因此企业必须自建 Operating Layer。

反证：Snowflake 在 Summit 26（2026-06，早于本文成稿）已明确把自身定位为 **「LLM 与企业系统系统之间的 control plane」**，并推出 Horizon Context 作为业务词汇表 / lineage / access policy / **agent permissions** 的归集点；Cortex Agents 的每次 API 调用携带 **Agent Identity**，由 Trust Center 审计。第三方报道亦确认 Cortex Code 已达 50% 客户采用、Cortex AISQL 与 Adaptive Compute 同期发布。

判据：

| 项 | 结论 |
| --- | --- |
| Claim Type | STRATEGIC（排他性论证） |
| Status | **CONTESTED** ——「企业必须自建 Identity / Entitlement / Policy 层，因为厂商给不出」这一排他性不成立 |
| 仍然成立的部分 | 跨法人 / 跨基金的**业务语义类** entitlement（原文后半句）确由企业定义；厂商给的是治理基础设施，不是企业的业务授权模型 |
| 处置 | **QUALIFY**：把「给不出」改为「给的是通用治理原语，企业的业务授权语义仍需自建」，并显式承认厂商正在向这一层移动 |

这条不削弱原文结论的**方向**（企业仍应持有 Control Plane），但削弱它的**理由**强度——按原文的写法，读者会低估厂商在这一层的推进速度，从而误判自建范围。

**P1-13｜（本轮新增）§7 Evaluation Plane 的乐观面缺独立反证**

原文已自我限定「还不是 LangSmith 那种成熟工作台」，方向正确。但应把 Gartner 同行评议中「no native, robust frameworks for LLM evaluation or automated testing of Cortex-powered agents」这条独立反证写进来——它来自一个**已在使用平台的企业**，时间点在 Evaluations GA 之后，比文章自己的限定语更有说服力。

---

### P2

| # | 问题 |
| --- | --- |
| P2-1 | frontmatter `version: v2.1 终轮事实收紧（P0/P1/P2）` 是版本自指与 changelog，按项目约定不进交付稿 |
| P2-2 | §1 官方工具清单里 **Analytical Search 实为 Public Preview**（官方标注），原文未标；同章的 `code_execution` 却标了 Preview，前后不一致 |
| P2-3 | §5 同一段内「Coding Agent 于 2026-08-26 GA」重复声明两次 |
| P2-4 | §10 Runtime Selection 表（9 行）与 §13 采用决策表（13 行）高度重叠，多数行判断一致，可合并为一处 |
| P2-5 | 参考列表非数字序（[1]–[29] → [37]–[47] → [30]–[36]），阅读时需来回跳 |
| P2-6 | §11 Trust Boundary 正文仅约 20 行，是三张图里最短的一节，与它「把 Governance 收敛成一张边界图」的定位不匹配 |
| P2-7 | 「平台评审」自引约 10 处，应在首次出现处显式声明为**本文配套框架**（IND0，不计独立佐证），而非并列的外部依据 |
| P2-8 | §4 附件 `source: "upload" \| "url" \| "workspace"` 三值在后文没有对应行为差异，属装饰性 schema |

---

## Claim Matrix

Direct = direct / indir / spec｜Auth = Authority 0–5｜Ind = Independence｜Fresh = current / aging｜
Counter = none / weak / strong｜Reality = L0–L6 or —｜Status = 见 §4.4｜Rewrite = KEEP / QUALIFY / DOWNGRADE / REVERSE / REMOVE

| # | Claim | Type | Scope | Direct | Auth | Ind | Fresh | Counter | Reality | Status | Conf | Rewrite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Cortex Agent 官方工具清单（Analyst / Search / Analytical Search / Code Execution / Data to Chart / custom / skills / MCP / toolsets / web search） | CAPABILITY | Snowflake 账户 | direct | 5 | IND1 | current | none | L1 | SUPPORTED | HIGH | KEEP（补 Preview 标注） |
| C2 | 官方建议 Cortex Analyst 迁往 Cortex Agents（2026-08） | FACT | 当前版本 | direct | 5 | IND1 | current | none | — | SUPPORTED | HIGH | KEEP |
| C3 | Cortex Agent = Data-Native Managed General Agent Runtime | STRATEGIC | data-native workload | indir | 4 | IND0 | current | none | L1 | CONDITIONALLY_SUPPORTED | MED | QUALIFY（标为本文术语） |
| C4 | code_execution 2026-08-20 Preview / code_toolset_all 2026-08-26 GA | FACT | 当前版本 | direct | 5 | IND1 | current | none | L1 | SUPPORTED | HIGH | KEEP（删重复句） |
| C5 | 单 Search Service 规模约束 **400M** rows | FACT | — | direct | 5 | IND1 | current | strong | — | **REFUTED** | — | 修字 → 100M |
| C6 | Search >20 QPS 单服务 / >140 QPS 账户需协商 | FACT | 账户级 | direct | 5 | IND1+IND4 | current | none | — | SUPPORTED | HIGH | KEEP |
| C7 | Cortex Search response size 有限制 | FACT | — | direct | 5 | IND1 | current | none | — | CONDITIONALLY_SUPPORTED | MED | QUALIFY（补 10 MB / 300 KB） |
| C8 | MCP server ≤50 tools、250 KB 截断、protocol constructs 未完整覆盖 | CAPABILITY + LIMITATION | MCP server | direct | 5 | IND1+IND4 | current | none | L1 | SUPPORTED | HIGH | KEEP（补 4 条限制） |
| C9 | Search 与 SQL 的授权一致性「取决于建模时是否对齐」 | CAUSAL | 默认配置 | direct | 5 | **IND4** | current | **strong** | — | **REFUTED** | — | **REVERSE** |
| C10 | Cortex Agent 权限取 querying user 的 default role，配置不当直接失败 | FACT | Agent 调用 | direct | 5 | IND1+IND4 | current | none | — | SUPPORTED | HIGH | KEEP ← 全文最强 |
| C11 | REST API 可经 `X-Snowflake-Role` 显式指定 role | FACT | REST API | direct | 5 | IND1+IND4 | current | none | — | SUPPORTED | HIGH | KEEP（补优先级与 PAT 限制） |
| C12 | Evaluations 2026-03-13 GA；2026-08-21 支持 Agent Version 定位 | FACT | 当前版本 | direct | 5 | IND1 | current | none | L1 | SUPPORTED | HIGH | KEEP（修链接） |
| C13 | 四条官方 Evaluation 限制（MCP 不参与 / replay 无 session attrs / code exec 无 side effect / 有成本） | LIMITATION | Evaluation | direct | 5 | IND1 | current | none | — | SUPPORTED | HIGH | KEEP ← 全文最有价值 |
| C14 | Snowflake 有机会成为统一 Evaluation / Observability Data Plane | PREDICTION | 数据型 evaluation | indir | 4 | IND1 | current | **strong** | L1 | **CONTESTED** | LOW-MED | QUALIFY（标 Prediction + 引反证） |
| C15 | 与 LangSmith 的三档对照（Human eval / Pairwise「明显领先」等） | COMPARISON | 企业 eval 工作流 | indir | 2 | IND1 | current | weak | — | INSUFFICIENT_EVIDENCE | LOW | QUALIFY（声明为作者判断） |
| C16 | §8 使用者反馈呈现「三类稳定共识」 | EXPERIENCE | 已用平台的企业 | indir | 2 | IND4 | current | weak | L3–L4 | CONDITIONALLY_SUPPORTED | MED | QUALIFY（改「反复出现」） |
| C17 | Semantic View Autopilot「有人认为可自动化 80–90%」 | PRACTICE | Snowflake 账户 | indir | 2 | IND4 | current | **strong** | L2 | CONTESTED | LOW | QUALIFY（改为限制清单） |
| C18 | per-user quotas 已具备平台级 enforcement，不止 reporting | CAPABILITY | 账户级 | direct | 5 | IND1+IND4 | current | weak | L4 | CONDITIONALLY_SUPPORTED | MED | QUALIFY |
| C19 | Cortex Run API 同步默认 15 分钟 / background 最长 6 小时 | FACT | 当前版本 | direct | 5 | IND1+IND3 | current | none | — | SUPPORTED | HIGH | KEEP |
| C20 | 推荐架构：自建 Control Plane + Cortex 为辅助 Runtime | RECOMMENDATION | 已有企业级平台的组织 | indir | 4 | IND1 | current | none | L1 | CONDITIONALLY_SUPPORTED | MED | KEEP（已带前提，边界可再收紧） |
| C21 | §14 OpenAI Agents API 2026-09-10「发布」 | FACT | 当前版本 | direct | 5 | IND1+IND4 | current | none | L1 | SUPPORTED | MED | QUALIFY（标 public beta + 补 ZDR） |
| C22 | §14 Claude Code 长 session 三个月内 <25 min → >45 min | FACT + 推断 | Claude Code 自有遥测 | indir | 3 | IND1 | **aging** | strong | L4 | CONDITIONALLY_SUPPORTED | LOW | QUALIFY |
| C23 | §14 Economic Index 显示 Code / Cowork 任务更长、autonomy 更高 | FACT | — | indir | 3 | IND1 | current | — | — | **INSUFFICIENT_EVIDENCE** | UNKNOWN | 补原文或删 |
| C24 | §14 Frontier Runtime primitives 正在快速商品化 | PREDICTION | 2026–2028 | indir | 4 | IND1 | current | none | L1 | CONDITIONALLY_SUPPORTED | MED | QUALIFY（显式标 Prediction） |
| C25 | §14 企业必须自建 Operating Layer，因 Frontier 给不出 Identity / Entitlement / Policy | STRATEGIC | 多法人金融企业 | indir | 3 | IND1 | **aging** | **strong** | L0 | **CONTESTED** | LOW-MED | QUALIFY ← 本轮新增 |
| C26 | §6 orchestration 模型「含 Anthropic、OpenAI、部分 Google 模型」 | FACT | 当前版本 | direct | 5 | IND1 | current | strong | — | **REFUTED** | — | 修字 |
| C27 | 两类 Runtime 分工（Full-Control vs Managed） | STRATEGIC | 企业 Agent Platform | indir | 3 | IND0 | current | none | — | CONDITIONALLY_SUPPORTED | MED | QUALIFY（标为本文框架） |
| C28 | Trace ≠ 审计证据，须分开存放 | RECOMMENDATION | 受监管企业 | indir | 4 | IND1 | current | none | — | SUPPORTED | MED-HIGH | KEEP |

**Status 分布**：SUPPORTED 12 ｜ CONDITIONALLY_SUPPORTED 9 ｜ CONTESTED 3 ｜ REFUTED 3 ｜ INSUFFICIENT_EVIDENCE 2 ｜ OUTDATED 0

---

## Counter Evidence

按发现顺序，逐条标注来源等级：

**1. Cortex Search 以 owner's rights 执行检索（推翻 C9）**
T0 官方 + T2/T3 独立安全研究（IND4）。官方原文见 P0-A-1。

**2. Cortex Search 的 512-token 嵌入窗口（削弱 C6/C7 的完整性）**
官方与多个第三方整理一致：索引时只有每条文本的前 512 token 参与向量匹配。这使「长文档必须预分块」成为硬约束而非优化建议。

**3. role-per-tenant 的 secondary roles fallback（补 C10/C11 的缺口）**
Snowflake 工程师技术实践（T3，IND3）+ 官方 MCP 文档（T0）：「为防止任何 fallback」，service user 必须无默认 secondary roles；MCP 侧推荐 `OAUTH_USE_SECONDARY_ROLES = NONE`。

**4. 企业侧对 Evaluation / Observability / 成本归因的独立负面评价（削弱 C14）**
Gartner Peer Insights 同行评议（T2/T3，IND4，2026-04）：「no native, robust frameworks for LLM evaluation」「logging and error-tracing tools for AI agents are still immature」「difficult to see exactly which AI job is driving up the bill」。

**5. Snowflake 自我定位为 control plane（削弱 C25 的排他性）**
Summit 26（2026-06）厂商声明 + 第三方报道（T4/T3）：Horizon Context 归集 business glossary、lineage、access policy、agent permissions；Cortex Agents 调用携带 Agent Identity 并由 Trust Center 审计。**这意味着「厂商给不出 Identity / Entitlement / Policy」这一前提在时间上已经过期。**

**6. Cortex Analyst 的复杂查询边界（削弱 C20 的推荐粒度）**
实践汇总（T3，IND4）：多表 join 与复杂聚合上不稳定；Search 的默认分块不保留文档结构，团队常需自建预处理。

**7. 成本量级参照（削弱 C18 的可操作性）**
社区案例：单个团队业务用户试点期**月账单约 $14k**；另有建议「按计算器结果多准备 30% 预算，尤其 Search」。

**8. 行业整体落地率（支持原文的成熟度怀疑）**
Deloitte：**不到 2% 的企业**已把 agentic AI 部署到完整生产规模。这条方向与原文一致，但原文明说「生产现实」却未引，属可用而未用的支持性反证。

**9. Autopilot 的实测反证（推翻 C17 的分歧框定）**
独立头对头实测（T3，IND4）：10 题 × 3 次，发现生成的 metric 定义错误（snapshot 未去重，最多 14 倍高估）；另有研究者判断「任何 autopilot 都无法完全替代复杂业务域里的人工直觉」。

**10. 厂商 benchmark 的独立性（原文正确规避，予以确认）**
Snowflake 自述的 >90% accuracy 出自 **2024-08 内部 150 题集，此后未更新**；47%→83% 的提升是 **Cortex 内部 benchmark**。**原文没有引用这两个数字**——属正确规避厂商 benchmark 陷阱，应予肯定。

---

## Silent Evidence

本轮按要求记录「搜了什么、搜到什么、为什么可能搜不到」。

```yaml
searched:
  - "Cortex Agents" limitations / known issues
  - "Cortex Agents" production issues / postmortem
  - "Cortex Search" row access policy / RLS / owner rights
  - "Cortex Agents" Gartner / Forrester / analyst evaluation
  - "Cortex Agents" named customer production case study
  - "Cortex Agents" benchmark
  - Snowflake REST API X-Snowflake-Role
  - Cortex Agents secondary roles / multi-tenancy isolation

found:
  official_limitations: yes        # 价值最高，且原文只覆盖三分之一
  independent_security_research: yes  # Cyera 实测，未见于原文
  analyst_assessment_of_cortex_agents: none   # 只有同行评议，无分析师评估
  named_production_case_study: none
  independent_benchmark: none

plausible_reasons:
  - 企业内部事故与失败 POC 不公开（尤其金融业）
  - 客户故事页只挑成功案例，且摘要层不披露规模与结果方法
  - 厂商不发布可被独立复现的 benchmark
  - Cortex Agents 2025-11 才 GA，公开生产案例的时间窗口本身很短
  - 分析师评估通常需要 12–18 个月的产品成熟度才会覆盖
```

**结论**：`independent_supporting = 0` 不是「文章没找」，而是**这类证据目前公开可得性很低**。这解释了为什么原文只能靠厂商文档 + 社区帖——它是当前可获得证据的上限，不是作者的疏漏。**但这也意味着「生产现实」这个定位目前无法被独立验证，标题与 description 的强度应据此调整。**

---

## Real-world Evidence

### Use Case Status 与 Production Level（v2 要求分开判定）

| 来源 | Type | Use Case Status | Production Level | 证明了什么 | 不能证明什么 |
| --- | --- | --- | --- | --- | --- |
| Reddit [28] mature data product + semantic view + testing | T3 | Exists → Adopted | L4 | 在具备成熟数据治理的前提下可正常生产使用 | 不能外推到数据治理不成熟的组织 |
| Reddit [11] Cortex Search + COMPLETE for RAG | T3 | Exists | L2 | 小规模能快速搭起来 | 不证明规模与可信度 |
| Reddit [15] prod cost & risk | T3 | Adopted | L3–L4 | 成本与信任摩擦真实存在 | 不提供可核对量级 |
| Reddit [23] 5 分钟 token / time budget | T3 | Adopted | L3 | 有团队在生产用 guardrail | 不构成最佳实践 |
| Reddit [24] Streamlit vs Notebook 结果不同 | T3 | Adopted | L4 | 存在可复现的平台行为差异 | 不证明根因（官方另有 warehouse runtime 限制，见下） |
| Reddit [27] 部署方式提问 | T3 | — | L3 | 部署模式尚未收敛 | 不证明任何成熟度 |
| Gartner Peer Insights 2026-04 | T2/T3 | Adopted | L4 | 已进入生产，但 evaluation / observability / 成本归因仍是痛点 | 单条评议，不代表普遍 |
| Snowflake 官方文档 / release notes | T0 | — | **L1** | capability exists | 不证明生产可用 |
| OpenAI / Anthropic 公告 | T4 | — | L1 | 能力已发布 | 不证明客户成功 |
| Anthropic 自研遥测 [34] | T0 | — | L4–L5（**Claude Code 自身**） | Claude Code 的使用分布 | 与 Cortex Agent 无关 |
| Anthropic 金融模板 [33] | T4 | Exists（资产已发布） | L1 | 模板存在 | 不证明任何机构部署成功 |

**判定**：

```text
Use Case Status 最高到：Adopted
  —— 无一条达到 Successful（该组织自公布量化结果）
  —— 无一条达到 Scaled / Outcome-verified

Production Level 最高到：L4
  —— 有 L4（真实用户 + 真实业务）
  —— 无 L5（治理 + SLA + 成本管理 + 持续运营）
  —— 无 L6（大规模 + 关键业务 + 量化 business outcome + 独立可核验）
```

**这是本轮相对上一轮的关键修正**：上一轮说「最高 L2–L3」低估了——实际有 L4 的证据（Reddit [28]、[24] 与 Gartner 评议都描述了真实业务使用）。但 **L4 ≠ Successful ≠ Enterprise-grade**（v2 §3.2 的两条规则）。原文的「生产现实」措辞踩在 L4 上，不能推出企业级成熟。

### 具名组织级案例：0 条

原文**没有引用任何 Snowflake 客户故事页**——这是正确规避（v2 §2.8 规则 4）。但代价是：全文没有任何具名组织的部署事实。第三方对 Summit 26 的报道里出现的 Telenav、Wolfspeed 属厂商口径，且指向 Snowflake AI 整体而非 Cortex Agent，只能算 `existence: vendor-reported`。

### 案例证明了什么（v2 §3.3 的 coverage 检查）

原文的推荐用例（Snowflake 内部数据问答、structured + PDF 联合分析、data-heavy 子 Agent）与其证据**匹配**——都在「读 / 分析」范围内。原文**没有**把用例外推到交易、审批、对外通信，并在 §10、§13 明确把这些归给 Full-Control Implementation。

```text
Evidence Coverage: MATCHED
原文没有过度外推。这一点处理正确。
```

---

## Theory / Practice Gaps

| Gap | 位置 | 判断 |
| --- | --- | --- |
| Capability | — | 基本不存在，所列能力均有官方文档支撑 |
| Integration | Semantic Layer、MCP tool curation、附件链路需外围 File / Session Service | 存在，原文已识别 |
| Operational | Evaluation 不能重放 MCP；replay 不传 session attributes；code execution 无 side effect | 存在且是**全文最扎实的发现** |
| **Governance** | **Search 侧 owner's rights 使「同一 Data Entitlement Contract」在默认配置下不成立；secondary roles fallback 使 role-per-tenant 隔离在默认配置下不成立** | **存在，本轮新增的关键 gap**。两条都是**默认即失效**，不是配置疏漏，因此不能靠「注意配置」解决 |
| Economic | 成本 additive、跨多维归因困难、budget 动作滞后 | 存在，原文已识别，但 enforcement 时效被高估 |
| Reliability | tool 数量↑ → selection accuracy↓；递归 loop | 存在，官方与社区双向印证 |
| Organizational | Semantic Layer 维护责任四方共有 | 存在，是原文**最轻描淡写的一处**。四方共有在实践中通常等于无人负责，应单列 |
| **Freshness 一致性**（原文归入第二章 Data Freshness Contract，未列入 gap） | 「多源时间戳合并且输出单一答案」在 Demo 里不暴露、在实践中最易出事 | 建议升级为独立失败模式 |

---

## Scope Warnings

v2 §1.4 要求显式检查「证据 scope 是否 ⊇ claim scope」。以下四处存在泛化风险：

**1. 「Cortex Search 已经成熟」类印象**

```text
证据 scope:      Snowflake-native + 中等规模 + 非受监管高风险检索
claim 疑似 scope: 通用 RAG 基础设施
不能外推到:       cross-cloud + 任意语料 + 受监管的高风险检索
处置:            Scope Invalid → 限定为 Snowflake-native、中等规模
```

**2. §10 推荐架构**

证据 scope = 已有企业级 Agent Platform、以 Snowflake 为核心数据平台的组织。原文已声明这一前提（「对已有企业级平台的组织」），处理正确。但应补一条反向边界：**greenfield 组织或纯 Snowflake 组织采用这套分层会引入不必要的 Control Plane**。

**3. §14 Operating Layer**

证据 scope = 多法人、多基金、受监管的金融企业（原文举例 Investment Review 恰当）。对单一法人、数据密集型、无跨系统授权需求的企业，八个 Plane 中的 Workflow & Action、Economics 可能过度设计。原文的「金融企业尤其需要」方向正确，但未给反例边界。

**4. §6 可插拔性对照表**（16 行「中 / 高 / 强」）

这是功能维度的相对判断，**不是实测比较**。表格形式容易读成结论性评估。应加一句说明：本表为定性判断，无 benchmark 依据。

---

## Claims That Should Be Rewritten

### 1. Cortex Search 的授权一致性（P0，必须改）

**Original**：
> 两者是否形成同一个 Data Entitlement Contract，取决于建模时是否对齐。… Search authorization 与 SQL authorization 必须收敛到同一份 entitlement 定义，否则检索侧会绕过表侧的行级控制。

**Recommended**：
> Cortex Search 按**所有者权限（owner's rights）执行检索**，这是官方设计行为：任何持有该服务 `USAGE` 的角色都能检索该服务已索引的全部数据，**不受其对底层表权限的限制**——官方文档明确说明，即使底层表套用了行级掩码策略，查询用户仍能看到服务所有者可读的行。因此「检索侧绕过表侧行级控制」不是建模对齐问题，而是默认配置下的既成事实。缓解需要三个架构动作：按 entitlement 域拆分独立的 Search Service 并只把 `USAGE` 授予对应角色；在调用侧传服务端校验的 filter（官方示例用后端 owner session 配合 `CURRENT_ROLE()` 构造，避免前端可篡改）；把「谁持有该服务的 `USAGE`」纳入权限面审计。

**Action: REVERSE**

### 2. Cortex Search 规模约束（P0，必须改）

**Original**：「单 Search Service 默认规模约束为 400M rows」
**Recommended**：「单 Search Service 的物化结果必须**小于 1 亿行**，超出时创建语句直接报错；要突破该上限须联系 Snowflake 账户团队。此外，索引时**每条文本只有前 512 个 token 参与向量匹配**，更长的文本仍参与关键词检索但不影响语义匹配，因此长文档必须预分块。」
**Action: REVERSE**

### 3. 第十四节的排他性论证（P1，本轮新增）

**Original**：
> Frontier vendors 给得出 Model、Harness、Sandbox、Tool Calling、Subagents、长执行，**给不出**「谁属于哪个法人实体、能访问哪只基金、为了什么业务目的…」

**Recommended**：
> Frontier vendors 提供的是**通用治理原语**，不是企业的业务授权语义。Snowflake 已在 Summit 26 把自身定位为 LLM 与企业系统之间的 control plane，并推出 Horizon Context（业务词汇表、lineage、access policy、agent permissions 的归集点）与由 Trust Center 审计的 Agent Identity——这一层正在被厂商快速填充。因此企业必须自建的不是「有没有 Identity 组件」，而是**「Fund A 用户能看 Fund B 吗」这类由企业定义、无法由厂商代填的业务授权语义**，以及跨 Runtime 的 Evidence 与 Regulatory Audit 归属。按前一种写法会低估厂商推进速度，从而高估自建范围。
**Action: QUALIFY**

### 4. §14 自主性数据

**Original**：「Claude Code 长运行 session 快速增长，最长 session 三个月内从不足 25 分钟增至超过 45 分钟」
**Recommended**：「Anthropic 对 Claude Code 交互式 session 的测量显示，**99.9 百分位**的单轮持续时长在 2025-10 至 2026-01 之间从不足 25 分钟增至超过 45 分钟，同期**中位数仍约为 45 秒**；源文亦说明该极值在 2026-01 中旬之后已有所回落。长时自主执行目前是长尾现象而非普遍形态。」
**Action: QUALIFY**

### 5. §9 per-user quotas

**Original**：「user-level Agent FinOps 已具备平台级 enforcement 能力，不止 usage reporting」
**Recommended**：「per-user quotas 提供了账户级的用量封顶与阻断，不再是纯报表；但阈值动作周期性执行、标准配置下可滞后数小时，且 CoWork 发起的用量单独归属，因此**不能当作即时熔断**，告警阈值需要早于硬限制触发。」
**Action: QUALIFY**

### 6. §8 社区反馈定性

**Original**：「实际使用者反馈呈现三类稳定共识」
**Recommended**：「社区与企业评议中反复出现三类问题，构成选型前需要预先回答的清单」
**Action: QUALIFY**

### 7. §2 / §8 Autopilot

**Original**：「社区反馈出现分歧：有人认为已可自动化 80–90%…」
**Recommended**：「Autopilot 能显著缩短首版草稿的产出时间，但有明确的已知限制：Level of Detail 计算与混合数据源不支持迁移、Tableau 虚拟连接不支持、文件须小于 250 MB、生成质量取决于账户 query history 的质量；独立实测中出现过 metric 定义错误（快照未去重导致高估）。verified queries 不自维护，需纳入定期复核。」
**Action: QUALIFY**

### 8. §6 orchestration 模型

**Original**：「含 Anthropic、OpenAI、部分 Google 模型」
**Recommended**：「当前官方清单为 `auto`、Claude 4.x 系列与 `openai-gpt-4.1`（按区域可用性提供，非本区域模型需开启 cross-region inference）」
**Action: REVERSE**

### 9. §7 Evaluation Plane（补强，非纠错）

**Original**：「它是强数据型 Evaluation Plane，还不是 LangSmith 那种成熟的 Evaluation Engineering Workbench。」
**Recommended**：保留，并补：「这一判断有独立印证——2026-04 的企业侧同行评议指出，平台仍缺少用于 LLM evaluation 与 Agent 自动化测试的原生框架，Agent 相关日志与错误追踪工具也不够成熟。」
**Action: QUALIFY**

### 10. §14 OpenAI Agents API

**Original**：「OpenAI 2026-09-10 发布的 Agents API…」
**Recommended**：「OpenAI 于 2026-09-10 上线 Agents API 的 **public beta**…（能力描述同上）。需同时记录其当前边界：**数据驻留仅支持美国，且不支持 Zero Data Retention，自建 sandbox 亦不因此获得 ZDR 资格**——这直接决定它能否承接金融数据。」
**Action: QUALIFY**

---

## Claims That Should Be Removed

1. **frontmatter 的 `version: v2.1 终轮事实收紧（P0/P1/P2）`** —— 版本自指与 changelog，不属于交付稿内容。
2. **§6「部分 Google 模型」** —— 无一手依据且与官方清单不符，删除或按官方列表改写。
3. **§4 附件 `source` 三值枚举** —— 三个取值在全文没有对应行为差异，属装饰性 schema。
4. **§14 中不带限定语的战略断言** —— 不是删判断，是消除「已成立」的语气：「继续投入重写 Agent Loop 会走偏」应改为带前提的判断（「在 Runtime 已商品化的前提下，继续投入重写 Agent Loop 的边际收益会显著下降」）。**2028+ 的 Operating System 判断必须显式标 Prediction**，不能与前面的事实段落同语气排列。
5. **§10 与 §13 重叠的决策表之一** —— 合并为一处，避免同一判断出现两个版本。

---

## Missing Evidence

按补齐价值排序：

1. **一条支持性的独立第三方证据**。目前 `independent_supporting = 0`，唯一组织级独立来源方向为**否定**。任何一条独立 benchmark、分析师评估或具名组织的生产架构报告都会改变 Overall Verdict。
2. **Cortex Search 的完整限制清单** —— 100M 行 / 512-token 嵌入窗 / 10 MB·300 KB 响应 / 不可克隆 / 表不可变 / 区域可用性，以及配套的授权缓解路径（per-entitlement service、server-validated filter、`USAGE` 审计）。
3. **secondary roles 与隔离的关系** —— 「为防止任何 fallback 需关闭默认 secondary roles」这条前置条件应写进 §5 的 identity 链。
4. **Cortex Agents 的 L5 / L6 案例** —— 有治理、SLA、成本管理与量化 outcome 的生产实例。厂商客户故事页属 U4，不足以支撑。
5. **成本量级参照** —— 现在只有「成本偏高」「会失控」的定性描述，缺 per Run / per User / per Month 的区间。
6. **Cortex Analyst 的复杂查询边界** —— 多表 join 与复杂聚合的失败率或官方限制，直接影响 §13 推荐粒度。
7. **Summit 26 之后的治理层能力**（Horizon Context、Agent Identity、Cortex AISQL、Adaptive Compute）对 §14 战略结论的影响——这是成稿前已公开、但未纳入的信息。
8. **[5] 的四条 Evaluation 限制建议逐条标注抓取日期** —— 这是全文关键论证，应可追溯到具体版本。

---

## Claim Records

关键 Claim 的机器可读记录（v2 §4.7）。可直接用于后续架构评审、技术雷达或产品比较。

```yaml
- claim:
    text: "Cortex Search 与 SQL 的授权一致性取决于建模时是否对齐"
    type: CAUSAL
    polarity: affirmative
    scope: { domain: regulated-financial, workload: retrieval }
  context: { product: Cortex Search, availability: GA, date_verified: 2026-09-15 }
  evidence:
    - { type: T0, source: snowflake-doc-query-cortex-search-service, directness: direct, authority: 5, independence: IND1, freshness: current, completeness: full }
    - { type: T2, source: cyera-security-research, directness: direct, authority: 4, independence: IND4, freshness: current, completeness: full }
  independent_sources: 1
  counter_evidence: ["官方明确 Search 以 owner's rights 执行，USAGE 即等于 owner 的读权限"]
  assessment: { status: REFUTED, fact_strength: 1, source_strength: 5, independence: 4, reality_strength: 4, timeliness: 5, confidence: LOW }
  recommendation: { action: REVERSE, wording: "见 P0-A-1 改写建议" }

- claim:
    text: "Cortex Agent 默认权限上下文依赖 querying user 的 default role，配置不当会直接失败"
    type: FACT
    scope: { domain: any, workload: agent-invocation }
  context: { product: Cortex Agent, availability: GA, date_verified: 2026-09-15 }
  evidence:
    - { type: T0, source: snowflake-doc-cortex-agents, directness: direct, authority: 5, independence: IND1, freshness: current, completeness: partial }
    - { type: T3, source: infoq-snowflake-engineering-multi-tenancy, directness: direct, authority: 4, independence: IND3, freshness: current, completeness: full }
  independent_sources: 1
  counter_evidence: []
  silent_evidence: { searched: ["secondary roles", "identity propagation"], found: "found: secondary-role fallback risk not mentioned in article" }
  assessment: { status: SUPPORTED, fact_strength: 5, source_strength: 5, independence: 3, reality_strength: 3, timeliness: 5, confidence: HIGH }
  recommendation: { action: KEEP, wording: "保留，并补 secondary roles fallback 前置条件" }

- claim:
    text: "Cortex Agent 已适合企业生产环境（金融场景）"
    type: MATURITY
    polarity: affirmative
    scope:
      domain: financial-services
      workload: data-analysis
      region: global
      excluded: [transactional-execution, customer-communication, high-risk-approval]
  context: { product: Cortex Agent, version_or_release: 2026-09, availability: GA, date_verified: 2026-09-15 }
  evidence:
    - { type: T0, source: snowflake-docs, directness: capability-only, authority: 5, independence: IND1, freshness: current, completeness: partial }
    - { type: T3, source: reddit-9-threads, directness: experience, authority: 2, independence: IND4, freshness: current, completeness: one-sided }
    - { type: T2, source: gartner-peer-insights, directness: experience, authority: 3, independence: IND4, freshness: current, completeness: full }
  independent_sources: 10
  independent_supporting: 0
  counter_evidence: ["evaluation 工具 immature（企业评议）", "成本归因困难", "Search 侧 owner's rights 授权缺口", "无 L5/L6 案例"]
  silent_evidence:
    searched: ["analyst report", "named case study", "independent benchmark", "postmortem"]
    found: none
    plausible_reasons: ["事故与失败 POC 不公开", "客户故事只挑成功案例", "GA 仅约 10 个月", "分析师覆盖通常滞后 12–18 个月"]
  real_world:
    existence: vendor-and-community-reported
    status: Adopted
    production_level: L4
    evidence_coverage: partial
    scale: unknown
    outcome_verified: false
  gaps: [governance, operational, economic, organizational]
  assessment: { status: CONDITIONALLY_SUPPORTED, fact_strength: 4, source_strength: 4, independence: 1, reality_strength: 3, timeliness: 5, confidence: MEDIUM }
  recommendation: { action: QUALIFY, wording: "对 Snowflake-native、data-heavy workload 已具备 L4 级生产条件；跨系统、高风险、有副作用的 workflow 仍需额外 Control Plane。企业级成熟度尚无独立验证。" }

- claim:
    text: "企业必须自建 Operating Layer，因为 Frontier Runtime 给不出 Identity / Entitlement / Policy"
    type: STRATEGIC
    scope: { domain: multi-entity-regulated-financial }
  context: { date_verified: 2026-09-15 }
  evidence:
    - { type: T4, source: openai-anthropic-announcements, directness: indir, authority: 2, independence: IND1, freshness: current, completeness: one-sided }
  independent_sources: 0
  counter_evidence:
    - "Snowflake Summit 26 自我定位为 LLM 与企业系统间的 control plane"
    - "Horizon Context 归集 business glossary / lineage / access policy / agent permissions"
    - "Cortex Agents 调用携带 Agent Identity，由 Trust Center 审计"
  assessment: { status: CONTESTED, fact_strength: 3, source_strength: 3, independence: 1, reality_strength: 1, timeliness: 3, confidence: LOW }
  recommendation: { action: QUALIFY, wording: "厂商提供通用治理原语并正在快速填补这一层；企业必须自建的是业务授权语义与跨 Runtime 的证据归属，而非全部 Identity / Policy 组件。" }
```

---

## Final Assessment

```text
Fact strength:          4 / 5   抽查 12 条关键事实，10 条与官方文档逐字吻合；取证密度高于同类文章。
                                扣分：1 处硬错（400M）+ 1 处归因错（Search 授权）+ 1 处举例错（Google 模型）
Source strength:        4 / 5   S0 引用精确、release note 可逐条追溯，这一点比多数行业分析强。
                                但 Authority 只对「主体自身的事实」成立——用作成熟度判断时降为 1
Independence:           1 / 5   46 条来源中独立组织级来源 1 条，且方向为否定
                                （independent_supporting = 0）
Reality strength:       3 / 5   有 L4（真实业务使用），但 Use Case Status 最高到 Adopted；
                                无 Successful / Scaled / Outcome-verified；无具名组织案例
Timeliness:             5 / 5   主体引用集中在 2026-03 至 2026-09，属当前版本；release note 可核；
                                扣分项：§14 自主性数据源文已回落，以及 Summit 26 治理层动作未纳入
--------------------------------------------------------------------------------
Status 分布:            SUPPORTED 12 ｜ CONDITIONALLY_SUPPORTED 9 ｜ CONTESTED 3 ｜
                        REFUTED 3 ｜ INSUFFICIENT_EVIDENCE 2 ｜ OUTDATED 0
Overall confidence:     Medium
  ├ Fact / Capability 层:  High        —— 可直接作为技术选型底稿
  ├ Maturity / 生产层:     Low–Medium  —— 需限定范围；「生产现实」措辞强于证据
  ├ Comparison 层:         Low         —— 无 benchmark，Benchmark Validity 不通过
  └ Prediction / 战略层:   Low–Medium  —— 方向成立，排他性理由需重写
```

### 发布建议

**必须改（P0）**

```text
1. §2 Cortex Search 授权行为的归因（REVERSE）—— 这是本轮最重要的修改，
   它把一条数据泄漏路径从「建模待办」纠正为「默认配置下的设计行为 + 三个架构动作」
2. §2 Cortex Search 规模约束 400M → 100M（并补 512-token 嵌入窗与响应体积）
3. 补 secondary roles fallback 前置条件（§5）
```

**强烈建议改（P1 中影响结论强度的四条）**

```text
4. §14 排他性论证 QUALIFY —— 承认厂商正在填充治理层，把自建范围收敛到
   「业务授权语义 + 跨 Runtime 证据归属」
5. §14 自主性数据、OpenAI Agents API、per-user quotas 三处限定语
6. §8「稳定共识」→「反复出现」，并把 Gartner 评议的反证写进 §7/§9
7. 引用卫生：修 [4] 双 /en/、合并 [13]/[14]、修 [36]、清洗 47 条 utm 参数
```

**可与 P1 同批（其余 P1/P2）**：MCP 四条补充限制、Autopilot 改写为限制清单、重复句与重叠表清理、frontmatter 版本自指删除。

### 与上一轮的差异

| 项 | 上一轮（v1 口径） | 本轮（v2 口径） |
| --- | --- | --- |
| 最严重发现 | 400M 行数错误 | **Search 授权行为归因错误**（安全相关，影响架构动作） |
| 落地程度 | 「最高 L2–L3」 | **修正为 L4，但 L4 ≠ Successful ≠ Enterprise-grade**；Use Case Status 最高 Adopted |
| 独立性 | 「独立证据为 0」 | **细化为 `independent_sources: 9`（全匿名）+ 组织级 1 条且方向否定** |
| 战略层 | 「须标 Prediction」 | **CONTESTED**：找到方向相反的厂商动作，排他性论证需重写 |
| 结论强度 | 方向对、强度过高 | 同，但**多了一条被低估的治理缺口**与**一条被高估的战略排他性** |

### 一句话

这篇的**方法论是对的**（先声明口径 → 逐条给官方依据 → 主动写官方限制 → 不定项归给 Full-Control Runtime → 不引厂商 benchmark），问题全部出在**证据结构与两处授权机制**上。改动量不大，但 P0-A-1 那条不改，金融读者会低估一个默认生效的数据泄漏路径。
