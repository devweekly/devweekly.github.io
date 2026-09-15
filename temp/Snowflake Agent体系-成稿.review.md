# Evidence & Claim Review

**审核对象**：`temp/Snowflake Agent体系-成稿.md`（v2.1，14 节 + 47 条引用，900 行）
**审核方法**：`skills/evidence-and-claim-review`（14 步 workflow：Claim 抽取 → 分类 → 定位来源 → 一手核验 → 来源-Claim 对齐 → 时效 → 反例 → 独立证据 → 真实用例 → 落地等级 → 理论-实践鸿沟 → F/S/R/T 评分 → 改写 → 证据矩阵）
**审核日期**：2026-09-15

---

## Overall Verdict

**Medium confidence（分层结论）**

这篇文章的**能力事实层**是可信的，**成熟度与战略层**是自证的。

- 对 **Capability / FACT 类**判断（支持哪些 tool、GA 日期、权限如何传递、MCP 有什么限制）：**High**。
  抽查了 8 条关键事实，7 条与厂商一手文档逐字吻合，取证质量明显高于同类文章。
- 对 **MATURITY / PRODUCTION 类**判断（生产可用、成熟、适合金融）：**Low–Medium**。
  支撑证据全部来自 Snowflake 官方文档（S0，但属利益相关方自证）与 Reddit 社区轶事（S3），
  **独立证据层为零**。
- 对 **PREDICTION / STRATEGIC 类**判断（第十四节 Operating Layer）：**Low**。
  无落地验证，属推断与愿景，文章大部分已用「未来」「应该」限定，但个别处语气滑向结论。

一句话：**可以作为技术选型的事实底稿，不能直接作为成熟度背书或架构决策依据。**

---

## Critical Findings

### P0

**P0-1｜一处硬性事实错误：Cortex Search 行数上限写成 400M，官方是 100M**

原文（§2）：「单 Search Service 默认规模约束为 400M rows，更大规模需要与 Snowflake 协商扩容」，
引用 [10]（Cortex Search 官方文档）。

核验结果：Snowflake 官方文档 *Known limitations → Base table size* 明确写
**the materialized result must be under 100 million rows；超过则 `CREATE CORTEX SEARCH SERVICE` 直接报错**，
并注明「要超过 100M 需联系账户团队」。多个独立第三方（Flexera、Chaos Genius、Archetype Consulting）
的整理一致写 100M。

- Source–Claim Alignment：**FAIL** —— 来源说的是 100M，文章写 400M，差 4 倍。
- 影响：这条被用来论证「大规模场景的扩容边界」，数值错直接导致容量规划结论错。
- 处置：必须改为 **100M**，并要求重新确认 [10] 的读取位置。

**P0-2｜证据结构问题：全文没有一条独立证据**

47 条引用的构成：

| 来源类型 | 条数 | 等级 | 说明 |
|---|---|---|---|
| Snowflake 官方文档 / release note | 30 | S0（自证） | 能力事实权威，成熟度判断无效 |
| Reddit 社区帖 | 10 | S3 | 可证明「有人遇到」，不能证明「普遍如此」 |
| LangChain 官方文档 | 2 | S0（对手方自证） | 只用于 LangSmith 自身能力描述 |
| OpenAI / Anthropic 官方博客 | 5 | S4 | 对自身产品的定位与营销 |

**独立 benchmark：0。分析师报告（Gartner/Forrester）：0。第三方生产案例研究：0。cross-vendor 研究：0。**

这不是单条 claim 的瑕疵，而是证据架构的缺口。全文的落点是「生产现实」与「采用决策」，
而这两类结论恰恰是 §23 明确要求**不能由产品文档证明**的（成熟 / 稳定 / 生产可用 / 企业级）。
现在这两个结论建立在厂商文档之上，等于让被评估方替自己出具证明。

- 处置：不要求删文，但（a）第十四节的战略判断必须显式标 Prediction；
  （b）第八节的社区反馈不能升级为「共识」；（c）需要至少补一条独立第三方证据（benchmark、
  分析师、或第三方生产架构报告）来支撑「生产现实」这个定位，否则应把标题与 description 里的
  「生产现实」改掉。

### P1

**P1-1｜[4] 链接损坏**：`https://docs.snowflake.com/en/en/release-notes/...` 双 `/en/` 前缀。
正确形式为 `https://docs.snowflake.com/release-notes/2026/other/2026-03-13-cortex-agent-evaluations`。

**P1-2｜[13] 与 [14] 是同一篇文档，被算作两条来源**：
[13] `docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp`
[14] `docs.snowflake.cn/en/user-guide/snowflake-cortex/cortex-agents-mcp`（同一路径，中文镜像域名）
文章把 [14] 标注为「Snowflake-managed MCP server 限制」，暗示它是一条独立的限制页，实际就是同一页。
这构成 §11 意义上的「伪多来源」——同一来源被拆号计入，抬高表面证据量。

**P1-3｜[36] URL 含垃圾参数**：
`.../trustworthy-agents?-what-the-heck-is-rust%2F=undefined&hubs_content-cta=-the-hustle&hubs_post-cta=homepage`。
规范地址为 `https://www.anthropic.com/research/trustworthy-agents`。

**P1-4｜全部 47 条 URL 带 `utm_source=chatgpt.com`**，其中 [31] 还有 `_bhlid`、[34] 有 `trk=lss-blog-*`、
[36] 有多个 hubspot 追踪参数。既暴露检索路径，也与项目既有约定（不带 `utm_source` 等跟踪参数）冲突。需全量清洗。

**P1-5｜§6「含 Anthropic、OpenAI、部分 Google 模型」与官方模型清单不符**
Snowflake Cortex Agents 官方文档列出的 orchestration 模型为：
`auto` / `claude-haiku-4-5` / `claude-sonnet-4-5` / `claude-4-6-sonnet` / `claude-4-sonnet` / `openai-gpt-4.1`。
**清单里没有 Google 模型**。文章这句话没有一手依据，且被用来支撑「multi-model 不等于 provider-agnostic」的论证，
需按官方列表改写（或删除 Google 字样）。

**P1-6｜§14 自主性数据丢失关键前提，且未反映源文的后续回落**
原文：「Anthropic 研究显示 Claude Code 长运行 session 快速增长，最长 session 三个月内从不足 25 分钟增至超过 45 分钟 [34]」。
源文（*Measuring AI agent autonomy in practice*）实际说的是：
（a）这是**99.9th percentile 的 turn duration**，不是「最长 session」，中位数只有约 **45 秒**；
（b）窗口是 2025-10 → 2026-01，**源文同时说明「mid-January 之后 extreme turn duration 已经有所回落」**；
（c）源文把中位数与长尾的差距（≈60:1）本身当作主要发现。
文章取用了趋势最陡的一段，未带回落，也未带「中位数 45 秒」这个反面事实，
读起来会让人以为长时自主执行已是常态。这属 §7 Freshness + §8 选择性取证的组合问题。

**P1-7｜§14 OpenAI Agents API 是 public beta，不是 GA；且缺一条金融相关的硬限制**
原文：「OpenAI 2026-09-10 发布的 Agents API 把 Codex 背后的 harness…做成 managed runtime」。
核验：该 API 于 2026-09-10 上线，状态为 **public beta**（官方 community 公告与开发者文档一致）。
文章未标 beta。更关键的是，官方文档明确写着 **data residency 仅支持美国、且不支持 Zero Data Retention
（即使自建 sandbox 也不因此获得 ZDR 资格）**。文章通篇以金融机构为读者，这条限制的缺失是实质性遗漏。

**P1-8｜§9 per-user quotas「已具备平台级 enforcement 能力，不止 usage reporting」偏乐观**
Resource budget 的阈值动作是**周期性执行**，标准配置下可滞后至 **8 小时**；`CORTEX_AGENT_USAGE_HISTORY`
也不覆盖 CoWork 发起的用量（走 `SNOWFLAKE_INTELLIGENCE_USAGE_HISTORY`）。所以它是「准实时封顶 + 分账」，
不是即时阻断。应限定措辞，并补「告警阈值要早于硬限制触发」。

**P1-9｜§8「实际使用者反馈呈现三类稳定共识」措辞超出证据**
支撑是 10 条 Reddit 帖。按 §32，社区反馈证明 **experience**，不证明 **prevalence**。
「稳定共识」暗示普遍性，应改为「社区反馈中反复出现三类问题」。
另：[3] 一条帖被用于三处不同论点（§6 MCP、§8 两处），来源过于单薄。

**P1-10｜§2 Semantic View Autopilot 被写成「观点分歧」，实际是「有已知限制」**
原文：「有人认为已可自动化 80–90%，也有人认为复杂 metric 与 edge case 仍需大量人工修正 [29]」。
这条用「分歧」框住了本可确定的事实。可核验的反证不止「有意见」：

- 独立对比实测（goiris.ai，与 Iris 头对头）发现 Autopilot 生成的多个 metric **定义错误**，
  例如 snapshot 表上的 `total_bookings = COUNT(booking_id)` 未做快照去重，会**最多放大 14 倍**；
  结论是「output needed a lot of work」。
- 官方文档本身列出迁移限制：**LOD 计算不支持、混合数据源不支持、Tableau 虚拟连接不支持**、
  文件需 <250 MB、published data source 需单独上传。
- Autopilot 质量**依赖 query history 质量**；verified queries 不自维护，需季度复核。

处置：把「有人认为 80–90%」降为个例，把已知限制清单写进来。

### P2

| 编号 | 问题 |
|---|---|
| P2-1 | `pubDatetime: 2026-09-15` 与当前日期（2026-09-13）不符，需核对是否提前日 |
| P2-2 | frontmatter `version: v2.1 终轮事实收紧（P0/P1/P2）` 是 changelog 自指，按项目约定不进交付稿 |
| P2-3 | §1 官方 tool 清单里 **Analytical search 实为 Public Preview**（官方标注），文章未标；同章的 `code_execution` 却标了 Preview，前后不一致 |
| P2-4 | §5 在同一段里「Coding Agent 于 2026-08-26 GA」重复声明两次 |
| P2-5 | MCP 250 KB 截断实际只适用于 **generic tools 与 SQL execution tool**，文章写成笼统「response 250 KB 上限」；同时漏了「仅支持非流式响应」「OAuth session 无 secondary roles」「MCP server 不参与 failover 复制」「政府区域不支持」 |
| P2-6 | §14 引用 [36] 的读法比原来源乐观：源文自己强调「no single line of defense is enough」「1% attack success rate 仍是实质风险」「目前尚无标准化的比较方法」，文章未带这些限定语 |
| P2-7 | 「平台评审」自引约 10 处，属作者配套文档的框架主张（Control/Runtime/Data/Evidence 四平面、Managed Runtime 只能边界控制等）。应显式声明为本文采用的框架，不计入独立佐证 |
| P2-8 | §4 附件类型定义中 `source: "upload" \| "url" \| "workspace"` 三个取值在后文没有对应实现路径，属装饰性 schema |

---

## Claim Matrix

评分口径：Fact / Source / Freshness / Authority / Independence / Reality 各 1–5；
Confidence 取 High / Medium / Low / Unknown。

| # | Claim | Type | Fact | Source | Fresh | Author | Indep | Reality | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Cortex Agent 是完整 managed agent platform，内部调用 Search / Analyst / tools / threads | CAPABILITY | 5 | S0 官方 | 5 | 5 | 1 | L1 | **High** |
| C2 | 官方标准 tool 清单（Analyst / Search / Analytical Search / Code Execution / Data to Chart / custom / skills / MCP / toolsets / web search） | CAPABILITY | 5 | S0 官方 | 5 | 5 | 1 | L1 | **High**（Analytical search 需标 Preview） |
| C3 | Snowflake 建议 Cortex Analyst 迁往 Cortex Agents（2026-08） | FACT | 5 | S0 release note | 5 | 5 | 1 | — | **High** |
| C4 | Cortex Agent = Data-Native Managed General Agent Runtime | STRATEGIC / OPINION | 3 | 作者归纳 | 5 | 4 | 2 | L1 | **Medium**（须标为分析命名） |
| C5 | `code_execution` 2026-08-20 public preview；`code_toolset_all` 2026-08-26 GA | CAPABILITY | 5 | S0 release note | 5 | 5 | 1 | L1 | **High** |
| C6 | **Cortex Search 单服务规模约束 400M rows** | FACT | **1** | S0 官方（实为 100M） | 5 | 5 | 3 | — | **Low｜错误** |
| C7 | Cortex Search 20 QPS / 账户 140 QPS / 有持续 serving cost | FACT | 5 | S0 官方 | 5 | 5 | 3 | — | **High** |
| C8 | MCP server ≤50 tools、响应 250 KB 上限 | FACT | 5 | S0 官方 | 5 | 5 | 4 | L1 | **High**（需补适用面） |
| C9 | MCP resources / prompts / roots / sampling 未完整支持 | CAPABILITY | 5 | S0 + 第三方确认 | 5 | 5 | 3 | L1 | **High** |
| C10 | Cortex Agent 权限上下文取 querying user 的 **default role**，配置不当直接失败 | FACT | 5 | S0 官方（逐字一致） | 5 | 5 | 1 | — | **High** ← 全文取证最扎实的一条 |
| C11 | Cortex Agent Evaluations 2026-03-13 GA | FACT | 5 | S0 release note | 5 | 5 | 1 | L1 | **High**（链接需修） |
| C12 | Evaluation 支持指定 Agent Version（2026-08-21 GA） | FACT | 5 | S0 release note（细节逐条吻合） | 5 | 5 | 1 | L1 | **High** |
| C13 | 四条官方 Evaluation 限制（MCP 不进 evaluation / replay 不传 session attributes / code execution 无 side effect / evaluation 有成本） | CAPABILITY + MATURITY | 5 | S0 官方 | 5 | 5 | 1 | — | **High** ← 全文最有价值的一段 |
| C14 | Snowflake 有机会成为统一 Evaluation / Observability Data Plane | PREDICTION | 3 | 厂商路线文档 | 5 | 4 | 2 | L1 | **Medium**（须显式标 prediction） |
| C15 | 与 LangSmith 的三档对照表（Human eval / Pairwise「明显领先」等） | COMPARISON | 3 | 双方自证，无独立 benchmark | 5 | 3 | 1 | — | **Medium**（应标为作者定性判断） |
| C16 | §8 使用者反馈呈现「三类稳定共识」 | EXPERIENCE | 3 | S3 Reddit ×10 | 5 | 2 | 2 | L2–L3 | **Low**（措辞超出证据） |
| C17 | Semantic View Autopilot：有人认为可自动化 80–90% | PRACTICE | 2 | S3 | 5 | 2 | 2 | L2 | **Low**（应改写成已知限制） |
| C18 | per-user AI quotas 提供平台级 enforcement，不止 reporting | CAPABILITY + MATURITY | 3 | S0 + 反证 | 5 | 4 | 2 | L4 | **Medium**（需剔除「即时」含义） |
| C19 | Cortex Run API 同步默认 15 分钟、background 最长 6 小时 | FACT | 5 | S0 + 第三方确认 | 5 | 5 | 3 | — | **High** |
| C20 | §10 推荐架构：自建 Control Plane + Cortex 为辅助 Runtime | RECOMMENDATION | 3 | 作者推导 | 5 | 4 | 2 | L1 | **Medium**（作为主张成立，作为结论不成立） |
| C21 | §14 Claude Code 长运行 session 从 <25 min 增至 >45 min | FACT（数值）+ 推断 | 3 | S0（Anthropic 自证） | 2 | 3 | 1 | L3–L4（内部产品） | **Low**（丢前提 + 未带回落） |
| C22 | §14 Anthropic Economic Index 显示 Code / Cowork 任务更长、autonomy 更高 | FACT | 3 | S0/S4 自证 | 4 | 3 | 1 | — | **Unknown**（本次未逐条核验） |
| C23 | §14 OpenAI Agents API 把 Codex harness 做成 managed runtime（2026-09-10） | FACT | 4 | S0 + 多源确认 | 5 | 5 | 2 | L1 | **Medium**（须标 public beta + 补数据驻留限制） |
| C24 | §14 Frontier Agent Runtime primitives 正在快速商品化 | PREDICTION | 3 | 三家厂商产品化事实 | 5 | 4 | 1 | L1 | **Medium**（须标 Prediction） |
| C25 | §14 2028+ 形成 Enterprise Agent Operating System | PREDICTION | 2 | 无落地证据 | 5 | 3 | 1 | L0 | **Low**（须标 Prediction，不得作结论） |
| C26 | §14 Anthropic 面向金融发布十类现成模板 | FACT | 4 | S0（自述） | 5 | 4 | 1 | L1 | **Medium**（可证「已发布」，不证「已验证」） |
| C27 | §6 Cortex orchestration 模型「含 Anthropic、OpenAI、部分 Google 模型」 | FACT | 2 | 与官方清单不符 | 5 | 4 | 1 | — | **Low｜疑似错误** |
| C28 | §2 Cortex Search 与 SQL authorization 必须收敛到同一份 entitlement | RECOMMENDATION | 4 | 官方机制 + 推导 | 5 | 4 | 2 | L2 | **Medium–High**（可补「Search 默认不套 RLS」的机制说明） |

---

## Counter Evidence

审核过程中主动检索到的、**削弱或需要限定原文判断**的证据：

**1. Cortex Search 行数上限（推翻 P0-1）**
官方文档 *Known limitations*：materialized result 必须 **< 100 million rows**，超出即创建失败；
多个第三方整理（Flexera / Chaos Genius / Archetype Consulting）一致为 100M。

**2. Cortex Search 的向量侧限制被原文完全遗漏**
官方与第三方一致说明：索引时**只有每个文本条目的前 512 个 token 参与向量嵌入**，
超出部分仅保留给关键词检索。这对「Cortex Search 是 hybrid search 层」的工程判断有直接影响
（长文档必须预分块，否则语义召回退化）。原文只提到「chunk」，未引这条硬限制。

**3. Cortex Search 的行级安全缺口**
第三方整理列出：对 Cortex Search service 的查询**以 service owner 的权限执行，默认不套用底层表的
row access policy**。原文 §2 把「检索侧绕过行级控制」写成一种建模失配风险（「取决于建模时是否对齐」），
方向正确但力度不足——这是一条**平台默认行为**层面的问题，值得升格为显式限制并给出缓解方式。
（此项来自第三方整理，建议以官方页复核后再定级。）

**4. Cortex Agents 的生产摩擦（S1/S2 级汇总）**
实践向汇总指出：做常规任务（摘要、分类、抽取）的团队会留下，
**尝试构建 agentic workflow 或复杂 RAG 管线的团队往往在一两个季度内迁出**；
Cortex Analyst 在**多表 join 与复杂聚合**上不稳定；Cortex Search 的分块默认值不保留文档结构，
团队常需自建预处理，削弱了「全托管」的收益。这与原文 §8「三类共识」方向一致，
但原文只在「可靠性 / 成本」上提及，未覆盖 **Analyst 复杂查询能力边界**与 **Search 分块**两项。

**5. 成本失控的具体量级**
社区案例出现单个团队在业务用户试点期间 **月账单约 $14k**；另一处建议「按计算器结果多准备 30% 预算，
尤其 Search」。原文 §9 把成本问题写成「七维度归因」，方向对，但缺可核对的量级参照。

**6. 厂商 benchmark 的独立性**
Snowflake 自述的 accuracy 数字（>90%）出自 **2024 年 8 月的内部 150 题集，此后未更新**；
另一处 47% → 83% 的提升是 **Cortex 内部 benchmark**，作者自己标注「可能无法在外部客户端复现」。
原文**没有引用这些数字**——这一点应予肯定，属正确规避。

**7. OpenAI Agents API 的金融不适用面**
官方限制：data residency **仅美国**；**不支持 Zero Data Retention**，且自建 sandbox **不使其获得 ZDR 资格**。
原文第十四节把它作为金融企业战略转折的论据之一，但未带这条。

**8. Autopilot 的实测反证**
头对头实测（10 题 × 3 次）发现 Autopilot 生成的 metric 定义错误（snapshot 去重缺失导致最多 14 倍高估）；
另一份研究者的判断是「we remain skeptical that any autopilot can fully replace human intuition in complex business domains」。

---

## Real-world Evidence

原文最需要补的一层，实际也是本次审核最难补的一层。

**原文已有的落地证据等级**

| 证据 | 等级（U） | 落地程度（Level） | 能证明什么 |
|---|---|---|---|
| Snowflake 官方文档 / release note | — | L1 Demo | capability exists |
| Reddit「Cortex Search + COMPLETE for RAG，surprisingly simple」[11] | U3 | L1–L2 | 能搭起来 |
| Reddit「mature data product + semantic view + testing 时可用」[28] | U2 | L2–L3 | 在特定条件下可行 |
| Reddit 成本 / 信任反馈 [3][15] | U2 | L2–L3 | 生产摩擦真实存在 |
| Reddit 5 分钟预算实践 [23] | U1–U2 | L3 | 具体 guardrail 做法 |
| Anthropic 自主性研究 [34] | U0（自研产品 telemetry） | L4–L5 | Claude Code 自身的使用分布 |

**结论**：
- 与 Snowflake Cortex 相关的落地证据**最高只到 Level 2–3（POC / 小规模试点）**，
  **没有一条 Level 4–5 的公开可核验案例**：没有客户自述的生产架构报告、没有 conference talk、
  没有 engineering blog、没有 postmortem。
- 因此「生产现实」这个定位目前**没有 Level 4 以上的证据支撑**，只有「生产摩擦的社区反馈」。
- 这一点原文其实自己承认了（引子：「不是所有能力都已到达成熟平台的终局」），
  属**自我校准做得好**，但标题与 description 的用词仍强于证据。

**对用例证明力的合规检查**（§17）

原文的推荐用例（Snowflake 内部数据问答、structured + PDF 联合分析、data-heavy 子 Agent）与其证据是匹配的——
这些都在「读 / 分析」范围内。原文**没有**把用例外推到交易、审批、正式对外通信，
并在 §10、§13 明确把这些归给 Full-Control Implementation。这在 §17 的意义上是**正确处理**，
不是过度外推。

---

## Theory / Practice Gaps

| Gap 类型 | 原文中的位置 | 判断 |
|---|---|---|
| **Capability gap** | — | 基本不存在。所列能力都有官方文档支撑 |
| **Integration gap** | Semantic Layer 建设、MCP tool curation、附件链路需外围 File/Session Service | 存在，原文已识别 |
| **Operational gap** | Evaluation 不能重放 MCP 行为；replay 不传 session attributes；code execution 无 side effect | **存在且是全文最扎实的发现**。这意味着生产排障与回归的闭环在 Runtime 边界处断掉 |
| **Governance gap** | Cortex 内部 planning / tool selection / execution 发生在企业 PEP 之下 | 存在。原文的「只能做边界控制」判断成立 |
| **Economic gap** | 成本 additive、跨多维归因困难、budget 动作有滞后 | 存在。原文已识别，但 enforcement 时效被高估 |
| **Reliability gap** | tool 数量↑ → selection accuracy↓；递归 loop；open-ended 问题质量随提问精度剧烈变化 | 存在，官方文档与社区双向印证 |
| **Organizational gap** | Semantic Layer 维护责任归四方共有（Business Owner / Data Owner / AI / Architecture） | **存在，且原文最轻描淡写的一处**。四方共有在实践里通常等于无人负责，这是 Semantic Contract 腐化的主因，值得单列一节 |

**未被原文处理的一个 Gap**：**新鲜度一致性**。原文把它写进了第二章 Data Freshness Contract（建议良好），
但没有把它归入 Theory-Practice Gap —— 而「多源时间戳合并且输出单一答案」是实践中最容易出事、
又最难在 Demo 里暴露的一类，值得在失败模式里升级。

---

## Claims That Should Be Rewritten

**1. Cortex Search 规模约束（必改）**

- Original：「单 Search Service 默认规模约束为 400M rows，更大规模需要与 Snowflake 协商扩容」
- Recommended：「单 Search Service 的物化结果必须**小于 1 亿行**，超出时创建语句直接报错；
  要突破该上限须联系 Snowflake 账户团队」
- 理由：Source–Claim Alignment FAIL，数值差 4 倍。

**2. orchestration 模型范围**

- Original：「Cortex orchestration model 可从 Snowflake 目录选择（含 Anthropic、OpenAI、部分 Google 模型，支持 auto）[1]」
- Recommended：「Cortex orchestration model 从 Snowflake 目录内选择，当前官方列表为
  `auto` / Claude 4.x 系列 / `openai-gpt-4.1`（按区域可用性提供，非本区域模型需开启 cross-region inference）；
  与 LiteLLM / Model Gateway 的 OpenAI-compatible 任意 endpoint 抽象不同」
- 理由：官方清单无 Google 模型。

**3. §8 社区反馈的定性**

- Original：「实际使用者反馈呈现三类稳定共识，值得在选型前读完」
- Recommended：「社区反馈中反复出现三类问题，构成选型前需要预先回答的清单」
- 理由：10 条 Reddit 证明 experience，不证明 prevalence。

**4. Autopilot**

- Original：「有人认为已可自动化 80–90%，也有人认为复杂 metric 与 edge case 仍需大量人工修正 [29]」
- Recommended：「Autopilot 能显著缩短首版草稿的产出时间，但有明确的已知限制：Level of Detail 计算与混合
  数据源不支持迁移，Tableau 虚拟连接不支持，生成质量取决于账户 query history 的质量；
  独立实测出现过 metric 定义错误（未按快照去重导致高估）。verified queries 不自维护，需纳入季度复核」
- 理由：把可确定的事实写成了观点分歧。

**5. 自主性数据**

- Original：「Claude Code 长运行 session 快速增长，最长 session 三个月内从不足 25 分钟增至超过 45 分钟 [34]」
- Recommended：「Anthropic 对 Claude Code 交互式 session 的测量显示，**99.9 百分位**的单轮持续时长在
  2025-10 至 2026-01 之间从不足 25 分钟增至超过 45 分钟，同期**中位数仍约为 45 秒**；
  源文亦说明该极值在 2026-01 中旬之后已有所回落。长时自主执行目前是长尾现象，而不是普遍形态」
- 理由：丢失 percentile 前提、未带回落、未带中位数。

**6. OpenAI Agents API 的状态与限制**

- Original：「OpenAI 2026-09-10 发布的 Agents API 把 Codex 背后的 harness、长会话、context compaction、
  工具使用、subagents、sandbox、recovery 做成 managed runtime [30]」
- Recommended：「OpenAI 于 2026-09-10 上线 Agents API 的 **public beta**，把 Codex 背后的 harness 做成
  托管运行时…（能力描述同上）。需要同时记录其当前边界：**数据驻留仅支持美国，且不支持 Zero Data Retention，
  自建 sandbox 亦不因此获得 ZDR 资格**——这一点直接决定它能否承接金融数据」
- 理由：漏标 beta；漏掉对金融读者最相关的一条硬限制。

**7. Evaluation 与 Authorization 的关系（补强，非纠错）**

- Original：「Snowflake Evaluation 覆盖其中一部分，不能直接等同整套 Assurance」
- Recommended：保留，并补一句机制说明：「Documented limitation 之一是 evaluation run 不传
  session attributes，因此依赖 session 属性的授权结果无法在 evaluation 中复现；
  这使 Evaluation Correctness 与 Production Authorization Correctness 成为两个必须分别取证的指标」
- 理由：原文方向正确，补机制细节后论证强度显著提升（这条本来就写在 §7，只是与 §12 的失败模式没打通）。

**8. per-user quotas**

- Original：「user-level Agent FinOps 已具备平台级 enforcement 能力，不止 usage reporting」
- Recommended：「per-user quotas 提供了账户级的用量封顶与阻断能力，不再是纯报表；但阈值动作是周期性执行，
  标准配置下可滞后数小时，因此**不能被当作即时熔断**，告警阈值需要早于硬限制触发」

---

## Claims That Should Be Removed

**1. §6「部分 Google 模型」** —— 无一手依据且与官方清单不符。删除或按官方列表改正。

**2. frontmatter 的 `version: v2.1 终轮事实收紧（P0/P1/P2）`** —— 版本自指与 changelog，
按项目约定不属于交付稿内容（改动的结论可以留在正文，但主语应是结论本身，不是「本稿改了什么」）。

**3. §14 中不带限定语的战略断言** —— 不是删除判断，而是必须消除「已成立」的语气：
「继续投入重写 Agent Loop 会走偏」这类祈使式结论应改为带前提的判断
（「在 Runtime 已商品化的前提下，继续投入重写 Agent Loop 的边际收益会显著下降」）。
**2028+ 的 Operating System 判断必须显式标为 Prediction**，不能与前面的事实段落同语气排列。

**4. §4 的附件 `source` 三值枚举** —— 三个取值在全文没有对应的实现路径或约束说明，
属装饰性 schema，建议删除或补上取值对应的行为差异。

---

## Missing Evidence

按补齐价值排序：

1. **一条独立第三方证据**（任何一条都能改变 Overall Verdict）：
   独立 benchmark、分析师报告（Gartner/Forrester 对 Cortex Agents 的评估）、
   或第三方机构的公开生产架构报告 / conference talk。目前为零。
2. **Cortex Search 的官方限制页完整清单**：100M 行、512-token 嵌入窗口、20/140 QPS、不可克隆、
   表不可变、区域可用性、以及 row-level security 的默认行为。原文只取了其中三条。
3. **Cortex Agents 的生产案例（Level 4 以上）**：Snowflake 客户故事页属于 U4（厂商营销），
   不足以支撑。至少需要一条客户自述的技术架构或运维数据。
4. **成本量级参照**：现在只有「成本偏高」「会失控」的定性描述，
   缺可对照的数字（每 Run / 每用户 / 每月的量级区间），使 §9 的 FinOps 七维度缺少基准。
5. **Cortex Analyst 在复杂查询上的能力边界**：多表 join、复杂聚合的失败率或已知限制。
   这条直接影响 §13「Snowflake 内部数据问答 → Cortex Agent」的推荐粒度。
6. **Evaluation 限制的一手复核**：[5] 的四条限制是全文关键论证，建议逐条对照官方页并注明抓取日期。
7. **MCP 递归 loop 的官方原文与缓解措施**：[13] 提到风险，但缓解方案（深度限制、per-run budget）
   是否足以阻断未见说明。

---

## Final Assessment

```text
Fact strength:            4 / 5   绝大多数论断可逐条核验，取证密度高于同类文章；
                                  扣分项为 1 处硬错（400M）与 1 处疑似错（Google 模型）
Source strength:          3 / 5   S0 密集且引用精确，但 100% 来自利益相关方；
                                  对手方文档（LangChain）只用于描述对手自身能力
Timeliness:               4 / 5   主体引用集中在 2026-03 至 2026-09，属当前版本；
                                  扣分项为 §14 自主性数据已过期且源文已说明趋势回落
Independent validation:   1 / 5   零独立 benchmark、零分析师、零 cross-vendor 研究；
                                  47 条引用中无一条来自与被评估方无利益关系的机构
Production validation:    2 / 5   最高 Level 2–3（POC / 小规模试点 / 社区反馈）；
                                  无 Level 4–5 的公开可核验案例；
                                  加分项：作者主动声明「不是所有能力都已到达成熟终局」
--------------------------------------------------------------------------------
Overall confidence:       Medium
  ├ Capability / FACT 层：High   —— 可直接作为技术选型底稿
  ├ Maturity / 生产层：   Low–Medium —— 需限定范围后方可使用
  └ Prediction / 战略层： Low    —— 须显式标注，不得作为架构决策依据
```

**发布建议**：修掉 P0-1 后**可以发布**，但需同时完成三件事 ——
（a）修正 P0-1 与 P1-5 两处事实问题；
（b）按 P1-6 / P1-7 给第十四节的厂商类判断补上限定语并显式标 Prediction；
（c）清洗 47 条 URL 的追踪参数与两条损坏链接（P1-1 / P1-3）。

**证据结构的长期建议**：这篇文章的写法（「先声明口径 → 逐条给官方依据 → 主动写官方限制 → 把不定项归给
Full-Control Runtime」）**本身是正确的方法论**，问题只在证据构成。若后续版本能引入一条独立第三方证据，
并从「引用厂商文档」升级为「引用厂商文档 + 独立验证 + 生产案例」的三段式，这篇会从
「一份严谨的厂商能力综述」变成「一份可支撑架构决策的评估报告」。
