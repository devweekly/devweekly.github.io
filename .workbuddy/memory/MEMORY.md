# 项目长期记忆 — devweekly.github.io

Astro (AstroPaper) 技术博客，域名语义为「Dev Weekly」。

## 博客 post 约定

- 位置：`src/content/blog/`
- 内容 schema：`src/content.config.ts`（`pubDatetime` / `title` / `description` 必填；`tags` 默认 `["others"]`）
- 命名：周报按 `YYYYMMMD.md`（如 `2026Aug31.md`）；主题长文用 slug（如 `ai-courses.md`）
- frontmatter 固定：`author: W` / `featured: false` / `draft: false` / `description: Dev weekly`（周报）

### 两类 post 的结构

| 类型 | 结构 |
|---|---|
| 周报（weekly） | `### AI and Programming` + `### Others` 两个区块，正文条目为 `[标题](url)`，可后接简短中文说明；区块内保留 `[]()` 占位行（约 20 行/区块） |
| 主题长文 | 自由长文，分 `## N. 主题` 章节，夹叙夹议 + 真实链接；tag 用主题词（如 `ai` / `agent` / `interview`）而非 `weekly` |

### 周报填充规则（用户明确要求）

**周报只建空白骨架，不要填充内容。** 用户明确表示「去掉填充的假内容！我自己会填！」。
创建周报时只写 frontmatter + 两区块的 `[]()` 占位行，不搜网络、不编造条目。

主题长文（有明确题目时）才允许用网络搜索填充真实内容。

### 主题长文的「实操」写法（用户明确要求）

用户原话：「实操不等同一定要有代码，而是工程实践的可行性」。

写"怎么做/怎么落地"类章节时，**不要写成技术方案或代码清单**，要写成团队可执行的工程实践判断：

- 讲：流程卡点、角色与 owner、指标与 SLA 定义、取舍与成本、反模式、可行性自检
- 不讲：具体工具/代码/配置怎么做
- 判据要用人话表达（例："两个不同的人看了会不会得出同一结论"），而非技术手段
- 落地难点优先归因到"人、纪律、预算、预期对齐"，而非技术

### 主题长文的语气与结构规范（用户明确要求）

用户原话：「注意改成写正式文章的语气，而不是 ai 回答的语气」。

**语气**——不要第一/第二人称对话腔：

- 删「我查了」「我会把」「我认为」「我推荐」「给你的最终判断」「你们平台」
  「在你补充这个前提之后」这类；改成无人称陈述（「值得注意」「更推荐」「可以定义为」）。
- 章节标题不写成口语祈使句/自述句（「所以我认为未来会出现两层 Workflow」→
  「企业 AI Platform 的『两层 Workflow』」）。
- 例外：引用模型/他人原话的引号内第一人称保留。

**结构**——一份长文只应有一套编号，且引用定义只在文末：

- 全文章节编号连续 `## 1.`–`## N.`，不要一段阿拉伯数字一段中文序号。
- 引用编号全文唯一，不要各段都从 `[1]` 起（同名 reference 会互相覆盖）。
- `([X][n])` 引用紧跟句末/段末，不要单独占一段；定义全部集中到**文末**。
- 不用 `---` 分隔线，靠标题分层；不带 `utm_source` 等跟踪参数。
- **真拓扑图（分支/汇合/循环/树/分层）用 mermaid**；线性 `A ↓ B ↓ C` 小片段保留
  `text` 代码块即可。写完必须逐个 `mermaid.parse` 校验（build 不报错，页面才会炸）。

**超长文的分层与收敛**（`workflow and agent and bpmn.md` 一文的经验）：

- 超过 ~2000 行时用三层：`#` 第 X 部分 → `## N. 章节`（全文连续编号）→ `###` 子节。
  站内已有 post 用 `#` 做正文分节，主题渲染没问题。
- **一篇文章只能有一套主线模型。** 长文常常是先写了一段「趋势观察」（厂商怎么做），
  后来才写出自己的结论，两者容易被当成两个互相冲突的主张。
  处理方式不是删掉前者，而是**显式降级**：在引子声明「这部分是某条路线的真实主张，
  是趋势的一部分，但不是本文对金融业务的结论」，并在趋势部分末尾设一个转折小节
  （用「对 X 正确 / 对 Y 不正确」这类对照表做 pivot），再进入主线。
- 前向引用（「第 34 节会说明」）在重排后必须逐条 grep 核对。
- 具体的重排/收敛操作流程见 skill `longform-md-restructure`。

**该文当前定稿形态**（`workflow and agent and bpmn.md`，2026-09-12 第二次 review 后）：

- 9 部分 / 52 节（`## 1.`–`## 52.` 连续），mermaid 35 块，引用 [1]–[42] 定义数 = 使用数
- 主线：`Business Process → Agent Task Contract → Agent Runtime → Controlled Result → Business State`
- 术语已收紧：四条路线 → **四个架构领域**；BPMN = **可执行约束合同**（不含全部业务语义，
  DMN 管规则、IAM 管资格、Agent Policy 管能力边界、Human Approval 管责任归属，**不可合并**）
- 三个状态必须分开：Business Workflow State / Agent Task State / Agent Working Plan
- 已删除：「80/20 deterministic+agentic」「二阶段提交 / 2PC」；补充：Business Data Contract、
  Task Context、Governed Action Pipeline、OpenAI Agents API（2026-09-10，引 [42]）

## 发布机制注意

Astro 是静态站，`pubDatetime` 仅是元数据，不做定时发布。真正上线由构建/部署流水线控制；
若 CI 按 push 触发，推上去即发布。需要「周几才出现」必须在部署侧加发布窗口控制。

## 工作区其他长期产物

### `temp/agent研究.md` — Enterprise Agent Platform Risk Architecture Review

一份企业 Agent 平台的架构评审报告（不是博客 post，独立于周报体系）。当前版本（2026-09-13 第五轮后，5452 行）：

- 结构：1 个 H1 + 20 个 `##` 章 + 113 个 `###`；引用 [1]–[35]，定义数 = 使用数
- **文风要求（用户明确）**：正文只陈述架构事实，**不写版本自指**（「本版 / 这一版 / 上一版」一律清掉，
  加粗变更小标题如「**这一版收紧的两处**」直接删）。撤回/降级的判断可以留，但主语必须是判断本身，
  不能是「上一版报告说…」。详见 skill `skills/article-de-ai` §27.7
- **最高层原则**：Agent 是不可信的决策参与者，而不是安全边界（Security boundary 由 Identity / Policy / PEP /
  Entitlement / Runtime Isolation / Evidence 建立）；AWS Lens 原话「Agent 本身不是 trust boundary」
- **核心结论**：技术底座已基本完整（AgentCore + LangSmith + PostgreSQL/pgvector + LiteLLM），
  主要风险是把模型风险 / ICT 风险 / 数据治理 / 访问控制 / 第三方风险 / 审计要求映射到 Agent 生命周期
- 平面模型：**Governance & Enforcement Layer 横切**（旧名 Policy Plane 已废弃）+
  Control / Runtime / Data & Capability Plane + 出口有 **Retrieval PEP / Tool PEP / Egress PEP** +
  **独立于 LangSmith 的 Evidence / Audit Plane**
- **Policy 归属拆分**：AI Platform = Model Governance；Agent Platform = Agent / Action Governance；
  IAM / Data Platform = Enterprise Entitlement；Runtime / PEP = Enforcement
- 定位：**Runtime-aware, Runtime-independent**（Control Plane 不绑定 Runtime，Enforcement Plane 按 Runtime
  能力分别落地）；Managed Runtime（Cortex Agents）只能做**边界控制**
- 安全主轴：Prevent / Detect / Control / Evidence；Use Case Risk Classification L0–L4（L4 控制属**内部标准**，非监管要求）；
  **Fail-Closed 语义**（依赖不可用时 HIGH/CRITICAL 一律 DENY）
- **十二条 Architecture Invariants**（8 → 12）：Inv9 Memory 完整性、Inv10 Fail-Closed、Inv11 Managed Runtime
  治理边界、Inv12 语义健康；**P0 十项**（8 → 10：+Memory Isolation/Integrity、+Fail-Closed Semantics），
  且 **P0 = architectural prerequisite**（未落地则 Production Gate 未满足 → exception process + risk acceptance）
- 新增章节：§5.6 Runtime Governance Boundary、§10.9 Memory Security、§10.10 Goal Alignment / Rogue Agent、
  §10.11 Privileged Access & SoD、§10.12 SDLC Isolation、§10.13 持续红队、§10.14 Multi-agent（显式 N/A）、
  §10.15 Multi-tenancy、§13.6 Semantic Health（Agent Health ≠ Infra Health → DEGRADED/BLOCKED）、
  §13.7 Backup / Retention / Anti-ransomware、§16.4 AWS Agentic AI Lens 能力对齐
- 已明确撤回的旧判断：不要把 Retrieval 拆成独立 Service（PG + pgvector 当前够用）；
  MCP 不建重型 Registry（走架构 Pattern 治理，只补执行元数据）；
  Observability / Evaluation 不是缺口（LangSmith 已承担）；不用 Runtime-neutral 这个说法
- Snowflake Cortex Agents 是**潜在的第二 Agent Runtime**，不是数据源或 LLM Provider；
  需要 Runtime abstraction + 「平台权限 + 数据平台原生权限」双层授权
- 报告为该单位的内部评审文档，语气保留顾问式「你们」；**博客 post 才要求去掉人称**
- **未完成项**：review 建议的「整体 30% 压缩」只做了对 8 个点名概念的局部去重，需单独一轮

### `temp/agent研究checklist.md` — Well-Architected Review Checklist

配套 checklist（2026-09-13 第三轮**结构修正** + 第五轮**逐条去中性化**后：2606 行 / 主表 **594** 项 +
**18** Invariants + **4** Decision Gates + 附录 A 181 项。两轮均不增删条目）：

- **编号约定（重要）**：P01–P14 的条目**本版已重排为 `1`–`512`**（`1`–`336` 与上一版一致；`337` 起因 FSI Overlay
  去重而重排；P10–P14 整体平移 −30）。旧版 `1`–`542` 的逐段对照见 **附录 B.12 编号变更对照**。
  成组 ID（`P00` / `AD` / `BO` / `TM` / `EV` / `RT`）不并入连续编号。
  **主表只数有 ID 的条目**，P00.6 Gate / P00.7 Artifact 这类纯正文小节不计入。
  合计 512 + 23(P00) + 14(AD) + 10(BO) + 8(TM) + 10(EV) + 17(RT) = **594**；B.4 给出「编号总账」表供逐条核对

- **条目必带「应为 / 达标线」（第五轮定型，改条目时必须遵守）**：用户明确要求「不能中性提问，要能判断
  yes / no 倾向性与做到什么程度」。因此**每条问题末尾**必须有 `｜应为：… ｜达标线：…`（附录 A 也要，共 775 条）：
  `应为` 方向词**只能**取 `应有` / `不应` / `视条件：<写明条件>` / `可选` 四选一；
  `达标线` 必须给可核对尺度（粒度 per Run·Agent·tenant·dataset + 覆盖 + 频率 + 举证位置）并补一句**「什么不算达标」**。
  P00 五张问题表用**追加列** `应为 / 达标线`；Invariants / Gates 表用追加列 `判据 / 典型 Fail`（不变量是陈述句，不问方向）。
  阅读方式写在「编号约定」的「条目阅读方式」小节；B.2 有 `Expectation` 字段，B.3 说明它是 Result 判定的下限口径。
- **批量补注的装配方式**：不要子代理直接改正文 —— 让它只产出 `ANN = {"<id>": "…"}` 字典（本目录第六轮日志记了完整
  流程与坑），主代理用脚本插入，可保证「原问题文字零漂移 + 覆盖性可机器判定」。
  （上一版「顶部 621 与 B.4 的 P01=100 对不上」其实是 P01 = 90 连续 + EV01–10，只是统计表没写「构成」）。
- **三层结构（本版新增，写进文档结构而非只在文字里提醒）**：L1 Architecture Review **91** 条（P00 全部 47 +
  P02.0 8 + P07.1 12 + P13 12 + P14.1 12，Architecture Board 逐条开会）/ L2 Control Checklist **462** 条 /
  L3 Implementation & Evidence **41** 条（P02.9 16 + P11 19 + P12 的 manifest·evidence 6）+ 附录 A 181 条。
  每节标题下标注层归属，定义与归属表见 **附录 B.11**。
- **P00 — Architecture Foundation（框架中立层，放在六支柱之前）**：
  `P00.1 Business Problem & Outcome（P00-01…05）`、`P00.2 Context & Constraints（06…11）`、
  `P00.3 Architecture Approach（12…16）`、`P00.4 Decision & Trade-offs（17…20）`、
  `P00.5 Input / Output Contract（21…23，本轮新增）`＋`P00.6 Architecture Decision Gate`、`P00.7 Review Artifact`。
  **23 条全部框架中立**（不含 Agent / LLM / MCP / autonomy 专有判断）；Agent / AI 判断全部下沉到 `P00.A`
  （上一版宣称中立但 P00-12 / P00-13 / P00.5 三处含 Agent 判断，本轮改正）。
  **Buy / Reuse / Extend / Build 是并列 alternatives，不是「四级台阶」**，配 decision matrix 与 Do Nothing 一列。
  **Gate 分两级**：Discovery Gate（P0 全 answered，或归入 Accepted assumption / Validation required → 可进
  详细设计 + PoC + P01–P14）与 Production Gate（P0 全 answered 且验证项已关闭 → 才可上生产）。
- **`P00.A Agent / AI Architecture Decision`**：Agent / AI 判断的唯一落点，含
  `P00.A.1 Architecture Decision Chain（AD01–AD14）` 与 `P00.A.2 Business / User Outcome（BO01–BO10）`。
  决策链**不再二元**：现有方案能否解决 → 是否需要 AI → 最低 AI 档位（ML / LLM / RAG / Agent）→ 是否需要 autonomy；
  **Agent 是最后一档而不是 AI 场景的默认答案**。判据参考 AWS Responsible AI Lens 的 use case 顺序（只借顺序，不加检查项）。

- 另有 `P02.0 Threat Modeling / Abuse Case（TM01–TM08）`（先写攻击者能做什么；TM05 = 被完全控制时最大影响）、
  `P01.6 Evaluation Model / Trajectory Evaluation（EV01–EV10）`（评 trajectory 而不只是 output；区分
  deterministic assertion 与 LLM-as-judge）、`P14.2–14.4 Runtime Isolation & Agent Execution Budget
  / Lifecycle & Portability（RT01–RT17）`（原 P14 改名 Runtime / Snowflake / Multi-runtime；原 P01.6 Recovery 顺延为 P01.7）。
- **P07–P09 改写为 FSI Delta**（不再当「第二套 Pillar」）：只审金融行业额外要求；**同一 control 只在 base 章节计分一次**
  （Overlay 百分比 = delta 完备度），解决「DLP 在 P02.8 与 P08.4 各评一次、到底 Pass 还是 Partial」的歧义。
  P07–P09 由 130 条收敛为 100 条（删 30 条纯重复项，逐条去向见 B.12）。P08.1 Governance 整节并入 P07.1。
- **Non-Negotiable 拆成两块**：`2.1 Runtime / Security Invariants（INV01–INV18）`（Fail = 系统不合格）与
  `2.2 Architecture Decision Gates（ADG01–ADG04，即原 INV19–22）`（Fail = 准入不通过）。
  INV08 / INV12 / INV14 标 `[RA]` 并改条件措辞（「超出已接受风险等级的动作」「按风险等级所需的深度可重建」），
  避免把「最强控制」写成所有 workload 的绝对要求；P01.2 的 system prompt、P02.4 的 system objective 同步去绝对化。
- **条目元数据**：`[R]` Required / `[RA]` Required when applicable / `[Rec]` Recommended；默认 P0 → R，P1 / P2 → Rec；
  多列表里单列「级别」列，逐条编号里用行内 `[RA]`。
- **评分方式改为多维度**（原「`3 + E` 才算可信的 Pass」作废）：`Maturity 0–5` + `Evidence Present/Partial/Missing` +
  `Risk` + `Applicability` → `Result Pass/Partial/Gap/N/A`，并给出 5 条判定规则
  （`Risk = Critical` 不得只凭 Maturity 判 Pass）。
- **框架与 Checklist 解耦**：`附录 B.10 跨框架映射` —— Microsoft Agent Architecture（→P00.A）、
  OWASP GenAI（→P02.0）、CNCF（→P14.2–14.4）、ATAM / ADR / AWS Prescriptive Guidance（→P00）并入；
  **NIST AI RMF 与 AWS Responsible AI Lens 只做交叉引用 / 借判断顺序，不新增章节**。参考补到 `[1]–[33]`。
- **交付形态：正文只放清单，方法说明全部后置为附录**。骨架 = 导语（三层结构 + 依据 + 规模）
  → `# 一、Checklist 主表（P00 + P01–P14，594 项）`（P01 降 H2、P01.1 降 H3）
  → `# 二、Architecture Invariants 与 Decision Gates`
  → `# 附录 A — 上一版保留项（A01..A181，不计入主表）`
  → `# 附录 B — 评审框架与说明`（B.1 分层结构 / B.2 记录字段+Level·Requirement / B.3 评分方式 /
  B.4 总览 + 编号总账 / B.5 P0 十项红线 + 准入前置 / B.6 6 个关键证明问题 / B.7 评分板 /
  B.8 与 AWS WAF 关系 / B.9 版本差异（含「本轮结构修正」10 条）/ B.10 跨框架映射 /
  B.11 三层结构 / B.12 编号变更对照）→ `# 参考`
- 已删除的对话与起草过程语（9 处）：开篇「可以。基于你们现在的实际架构…」、
  P01.2 / P01.6 / P02.1 / P02.7 / P08.7 / P13 的「上一版…」比较句、P01.4 的
  「你们已经决定 MCP…」及其架构决策 blockquote、P01.5 的「你们已经有 LangSmith…」；
  混血句改写为中性事实句（6 处），交叉引用回改 2 处（「一、评审框架」→「附录 B.1」、
  「三、P0 十项红线」→「附录 B.5」）
- 该「对话稿转成稿」的可复用流程见 skill `skills/article-de-ai` 第 27 节
- 最高层**不再自建分类**，用 P00 框架中立前置层 + AWS Well-Architected 六支柱 + FSI delta overlay + 平台 overlay：
  `P00 Architecture Foundation` → `P00.A Agent / AI Architecture Decision`
  → `P01 Operational Excellence` / `P02 Security` / `P03 Reliability` / `P04 Performance Efficiency` /
  `P05 Cost Optimization` / `P06 Sustainability`（Agentic AI Lens 的 AGENTOPS / AGENTSEC / AGENTREL 作 focus area 注入）
  → `P07–P09 FSI Delta`（只审 delta：风险治理·监管义务 / 权限·SoD·AI 威胁检测·AI 资产隔离·AI 数据保护·事故上报 /
  resilience tier·外部依赖集中度·gray failure·备份与监管保留）
  → `P10–P14 Enterprise Agent Platform Overlay`
  → `二、18 Invariants + 4 Decision Gates`（Fail 即阻断）
- 对齐版本：Agentic AI Lens **2026-06-10**、FSI Industry Lens **2026-01-27 修订**
- 主表编号 `1..512` **连续且唯一**；附录 A 编号 `A01..A181`，不计入主表
- 装配工艺见 skill `longform-md-restructure`（片段文件 + build.py 区间 op + 多层断言 + 词元归零法 + 行级差异归因）

- 10 项 P0 红线：Agent Identity / Retrieval Entitlement / Tool Authorization / Prompt·Config Versioning /
  Memory Isolation / Input-Output DLP / Non-repudiation / Human Approval·Rogue Agent /
  Provider·Runtime Resilience / Skill Supply Chain
- 上一版的「14 Pillars + 389 问题 + 12 Invariants + 50 核心问题清单」已作废（50 项清单编号无法映射，改用 P0 红线）

