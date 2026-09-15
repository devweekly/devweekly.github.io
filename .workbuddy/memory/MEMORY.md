# 项目长期记忆 — devweekly.github.io

Astro (AstroPaper) 技术博客，域名语义为「Dev Weekly」。作者笔名 `W`。
逐轮细节与脚本工艺见同目录 `YYYY-MM-DD.md` 日志；本文件只保留跨会话仍需遵守的约定与当前状态。

## 1. 博客 post 约定

- 位置 `src/content/blog/`；schema `src/content.config.ts`（`pubDatetime` / `title` / `description` 必填，`tags` 默认 `["others"]`）
- 命名：周报 `YYYYMMMD.md`（如 `2026Aug31.md`）；主题长文用 slug（如 `ai-courses.md`）
- frontmatter：`author: W` / `featured: false` / `draft: false`

| 类型 | 结构 |
|---|---|
| 周报 | `### AI and Programming` + `### Others`；正文条目 `[标题](url)` + 简短中文说明；每区块留约 20 行 `[]()` 占位 |
| 主题长文 | 自由长文，`## N. 主题` 分节，夹叙夹议 + 真实链接；tag 用主题词（`ai`/`agent`/`interview`）而非 `weekly` |

**周报只建空白骨架，不填充内容**（用户原话：「去掉填充的假内容！我自己会填！」）。不搜网络、不编造条目。
主题长文才允许用网络搜索填充真实内容。

**发布机制**：Astro 是静态站，`pubDatetime` 只是元数据，不做定时发布；上线由构建/部署流水线控制，
CI 按 push 触发即推即发。需要「周几才出现」必须在部署侧加发布窗口。

## 2. 主题长文写作规范（用户明确要求）

**语气**：不要第一/第二人称对话腔。删「我查了 / 我认为 / 我推荐 / 给你的最终判断 / 你们平台 / 在你补充这个前提之后」，
改成无人称陈述（「值得注意」「更推荐」「可以定义为」）。章节标题不写口语祈使句或自述句。
例外：引用模型或他人原话的引号内第一人称保留。

**结构**：全文章节编号连续 `## 1.`–`## N.`，不混用中文序号；引用编号全文唯一（各段都从 `[1]` 起会互相覆盖）；
`([X][n])` 紧跟句末，定义全部集中到文末；不用 `---` 分隔线；**不带 `utm_source` 等跟踪参数**。
真拓扑（分支/汇合/循环/树/分层）用 **mermaid**，线性 `A ↓ B ↓ C` 保留 `text` 块；写完必须逐个 `mermaid.parse` 校验
（build 不报错，页面才会炸）。

**「实操」章节的写法**：用户原话「实操不等同一定要有代码，而是工程实践的可行性」。讲流程卡点、角色与 owner、
指标与 SLA、取舍与成本、反模式、可行性自检；不讲具体工具/代码/配置。判据用人话（「两个人看了会不会得出同一结论」），
落地难点优先归因到人、纪律、预算、预期对齐。

**超长文（>2000 行）**：三层 `#` 第 X 部分 → `## N.` 全文连续编号 → `###`。**一篇文章只能有一套主线模型** ——
先写的「趋势观察」与后写的「自己的结论」容易互相冲突，处理方式是**显式降级**（引子声明前者不是本文结论，
趋势段末尾用对照表 pivot），不是删掉。前向引用在重排后必须逐条 grep 核对。工艺见 skill `longform-md-restructure`。

**交付稿不带版本自指**：正文与元数据都不出现「本版 / 上一版 / 终轮」这类 changelog；撤回的判断可以留，
但主语必须是判断本身。起草过程语与「你们已经决定…」这类对话残留一律不进交付稿。

## 3. `skills/` — 自建 Agent 评审 Skill 套件

约定：`skills/<name>/SKILL.md`，frontmatter 只要 `name` / `version` / `description`。
**skill 只写流程与判据，不复制 checklist 条文** —— 规范内容用「数据来源与锚点」表指向
`temp/agent研究checklist.md`（Q 编号 / 附录 C 节号 / Invariant）与 `temp/agent研究.md`（§N），维持单一真相源。

```text
enterprise-agent-architecture-review      架构是否成立、边界划在哪（12 步 + Discovery/Design/Production 三层 Gate）
  ├─ agent-security-threat-review         trust chain 七问 + 六列威胁矩阵
  ├─ agent-governance-and-control-design  Risk→Policy→AuthZ→Approval→Execution→Evidence
  ├─ agent-runtime-boundary-review        14 个能力维度 × Native/Interceptable/Absent → 四档结论
  ├─ agent-tool-and-mcp-governance        Tool 十项元数据 + 六类动作 + 四级风险 + 七项执行控制
  ├─ agent-reliability-review             八个必答问题 + 五类语义失败
  └─ agent-well-architected-assessment    Scope→按 Depth 取证→五条判定→P0/P1/P2→Remediation
evidence-and-claim-review                 横切件：审「说法成不成立」（v2.0.0，四层模型）
```

`evidence-and-claim-review` 与 `agent-well-architected-assessment` 互补：前者审说法可信度，后者审控制是否落地。

**`evidence-and-claim-review` 当前为 v2.0.0（2026-09-15 按用户 17 条 review 重写，960 行 / 38KB）。**
核心改动的几处，改这个 skill 时必须守住：

- **四层结构**：`1 Claim Model` / `2 Evidence Model` / `3 Reality Model` / `4 Review Workflow` + 附录 A（检索词）/ B（术语与编号）。
  不再是一堆平行小节。
- **旧 `S0–S5` 单一等级已废**：它把「来源类型 / 权威性 / 独立性」混在一根轴上。现拆为
  **Source Type `T0–T5`**（只是分类，不代表权威）＋ 独立评分的 **Authority** 与 **Independence `IND0–IND5`**。
  旧 `S0` 要按「是主体自己的事实还是对主体的评价」拆成 T0 或 T1。对照表在附录 B.3。
- **Evidence Quality 五个独立轴**：Directness / Authority / Independence / Freshness / Completeness，
  不平均、不互相替代。**Authority 是「对这个问题」而言** —— 厂商文档对 capability 是 5，对 comparison/maturity 降为 1。
- **Confidence ≠ Independence**（最重要的一处修正）：`FACT/CAPABILITY/LIMITATION` 型 Claim 可以
  `Confidence HIGH + Independence LOW`（厂商就是唯一权威源，不需要独立 corroboration）；
  但 `PERFORMANCE/MATURITY/COMPARISON/PREDICTION` 不得只凭厂商来源给 High。
- **打分是 `F / S / I / R / T` 五维**（比 v1 多了 `I — Independence`）。
- **两组正交结论**：`Status`（SUPPORTED / CONDITIONALLY_SUPPORTED / CONTESTED / OUTDATED /
  INSUFFICIENT_EVIDENCE / REFUTED）与 `Confidence`（High/Medium/Low/Unknown）。
- **新增维度**：`Scope / Applicability`（证据 scope 是否 ⊇ claim scope，防「证据被错误泛化」）、
  `Claim Context`（产品/版本/区域/availability GA·Preview·Limited Access/API 面/date_verified）、
  `Silent Evidence`（搜不到要写成「搜了什么、为什么可能搜不到」）、`Benchmark Validity`（12 项检查）、
  `Use Case Status`（Exists→Adopted→Successful→Scaled→Outcome-verified）、`Production Level L0–L6`、
  Claim Type 增加 **LIMITATION**（「不支持什么」是独立类型，不能从「文档没写」反推）。
- **可执行化**：`§4.1 Required Actions`（17 步）+ `§4.2 Stop/Continue Conditions`
  （何时必须继续搜、何时可以收工、何时必须降级结论）。这是 v2 相对 v1 最关键的性质变化。
- **§4.7 结构化 Claim Record**（YAML）是审核产物的机器可读形态，声称后续要复用于架构评审 / 技术雷达 / 产品比较。

**注意术语断层**：`temp/Snowflake Agent体系-成稿.review.md` 是用 v1 术语写的（S0–S5 / U0–U4 / Level 0–5），
结论有效，但若要与 v2 对照需按附录 B.3 转换；下次审同类文稿用 v2 口径重述即可。

## 4. `temp/` 长期产物

### `temp/agent研究.md` — Enterprise Agent Platform Risk Architecture Review

单位内部评审文档（保留顾问式「你们」，博客 post 才去人称）。当前 5452 行 / 1 个 H1 + 20 章 + 113 个 `###`，
引用 [1]–[35] 定义数 = 使用数。

- 最高层原则：**Agent 是不可信的决策参与者，不是安全边界**；边界由 Identity / Policy / PEP / Entitlement /
  Runtime Isolation / Evidence 建立（AWS Lens 原话：Agent 本身不是 trust boundary）
- 平面模型：**Governance & Enforcement Layer 横切** + Control / Runtime / Data & Capability Plane；
  出口有 Retrieval PEP / Tool PEP / Egress PEP；Evidence / Audit Plane 独立于 LangSmith
- Policy 归属：AI Platform = Model Governance；Agent Platform = Agent/Action Governance；
  IAM/Data Platform = Enterprise Entitlement；Runtime/PEP = Enforcement
- 定位 **Runtime-aware, Runtime-independent**；Managed Runtime（Cortex Agents）只能做**边界控制**
- **12 条 Architecture Invariants** + **P0 十项**，且 P0 = architectural prerequisite（未落地 → Production Gate 未满足）
- 核心结论：技术底座基本完整（AgentCore + LangSmith + PostgreSQL/pgvector + LiteLLM），
  主要风险是把模型/ICT/数据治理/访问控制/第三方/审计要求映射到 Agent 生命周期
- Snowflake Cortex Agents 是**潜在的第二 Agent Runtime**，不是数据源或 LLM Provider，需要 Runtime abstraction
  + 「平台权限 + 数据平台原生权限」双层授权
- **未完成**：review 建议的「整体 30% 压缩」只做了 8 个概念的局部去重

### `temp/agent研究checklist.md` — Well-Architected Review Checklist

当前形态（第十轮起）：**正文 = A–L 十二节 120 个架构评审问题（`Q001`–`Q120`）**；
原 431 项控制条目**一字未改**降为 **附录 D — Evidence Checks**（旧编号 `1`–`512` / `P00-nn` / `AD`·`BO`·`TM`·`EV`·`RT`
继续有效，历史引用不废）。正文用 `Q` 编号、证据层用旧编号，两个独立序列。

必须遵守的几条：

- **正文零说明**：第一章只允许 标题 / 表格行 / 条目行 / 空行；散文、`>` 引用、层标注、ASCII 图全部搬进附录 C。
  后续加条目时不要往正文补说明段落。depth / Stage 写在**节标题**（`## A. … ｜L1 Decision · INIT`）。
- **条目必带方向标签 + 达标线**：格式 `｜必须：… ｜达标线：…`；方向标签只能取 **必须 / 禁止 / 条件 / 可选**
  四选一（条件必须写明，没写清不能判 N/A）；达标线要给可核对尺度（per Run·Agent·tenant·dataset + 覆盖 + 频率
  + 举证位置）并补「什么不算达标」。**不要**用「应为 / 应有」（用户：「AI 味道刺鼻难闻」）。
- **三个 Review Depth 不是互斥分类**，而是同一 control 的三个深度：`L1 Decision` → `L2 Design` → `L3 Evidence`，
  只能标「主要落在哪一层」。L1 再按 Stage 切 `INIT` / `DESIGN` / `PRE-PROD`，与两个 Gate 对齐。
- **`Priority` 与 `Requirement Level` 是两个维度，不能互推**（`P0+P1` × `R/RA/Rec` 五种组合都合法）。
  条目元数据：`[R]` / `[RA]` / `[Rec]`。
- **主表编号是稳定标识不是流水号**：条目被合并后编号留空、不重排、不重用；逐组去向写在附录 B.12 对照表。
- **统计数字是 informational metadata**：增删条目只更新 B.4 编号总账（唯一权威数字来源），不要为同步数字全库改数。
- **批量补注的装配方式**：不要子代理直接改正文 —— 让它只产出 `ANN = {"<id>": "…"}` 字典，主代理用脚本插入，
  保证「原问题文字零漂移 + 覆盖性可机器判定」。
- 骨架顺序：H1 + 4 行导航 → `# 一、Architecture Review Checklist` → `# 二、Invariants 与 Decision Gates`
  → 附录 A（补充控制项）→ 附录 B（框架·读法·评分·版本）→ 附录 C（62 节章节说明）→ 附录 D（Evidence Checks）
  → `# 参考`。

### `temp/Snowflake Agent体系-成稿.md` — Cortex Agent 体系分析

博客主题长文（v2.1，14 节 + 47 条引用），核心判断：Cortex Agent 是**Data-Native Managed General Agent Runtime**，
不是 LLM Provider 也不是数据源插件；推荐自建平台为 Control Plane + Cortex 为辅助 Runtime。
2026-09-15 用 `evidence-and-claim-review` 审过一轮，结论落盘为同目录 `.review.md`：- 硬错 1 处：Cortex Search 单服务行数上限写 **400M**，官方为 **<100M**（P0）
- 疑似错：Cortex Agents orchestration 模型官方清单只有 Anthropic + OpenAI，无 Google
- 结构性薄弱：47 条引用全为厂商文档（S0/S4）+ Reddit（S3），**零独立 benchmark / 分析师 / cross-vendor 研究**；
  落地证据最高 Level 2–3，无 Level 4/5 独立案例
