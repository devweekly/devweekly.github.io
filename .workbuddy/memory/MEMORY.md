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

一份企业 Agent 平台的架构评审报告（不是博客 post，独立于周报体系）。当前版本（2026-09-13 第四轮 review 后，5489 行）：

- 结构：1 个 H1 + 20 个 `##` 章 + 113 个 `###`；引用 [1]–[35]，定义数 = 使用数
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

配套 checklist（2026-09-13 框架级重构 + 结构收敛后，1716 行 / 主表 542 项 + Invariants 15 + 附录 A 181 项）：

- **交付形态：正文只放清单，方法说明全部后置为附录**。骨架 = 导语（依据/规模/指向附录）
  → `# 一、Checklist 主表（P01–P14，542 项）`（P01 降 H2、P01.1 降 H3）
  → `# 二、Architecture Invariants（15 条）`
  → `# 附录 A — 上一版保留项（A01..A181，不计入主表）`
  → `# 附录 B — 评审框架与说明`（B.1 三层结构 / B.2 记录字段 / B.3 评分方式 / B.4 总览 /
  B.5 P0 十项红线 / B.6 6 个关键证明问题 / B.7 评分板 / B.8 与 AWS WAF 关系 / B.9 版本差异）
  → `# 参考`
- 已删除的对话与起草过程语（9 处）：开篇「可以。基于你们现在的实际架构…」、
  P01.2 / P01.6 / P02.1 / P02.7 / P08.7 / P13 的「上一版…」比较句、P01.4 的
  「你们已经决定 MCP…」及其架构决策 blockquote、P01.5 的「你们已经有 LangSmith…」；
  混血句改写为中性事实句（6 处），交叉引用回改 2 处（「一、评审框架」→「附录 B.1」、
  「三、P0 十项红线」→「附录 B.5」）
- 该「对话稿转成稿」的可复用流程见 skill `skills/article-de-ai` 第 27 节
- 最高层**不再自建分类**，直接用 AWS Well-Architected 六支柱 + 两类 overlay：
  `P01 Operational Excellence` / `P02 Security` / `P03 Reliability` / `P04 Performance Efficiency` /
  `P05 Cost Optimization` / `P06 Sustainability`（Agentic AI Lens 的 AGENTOPS / AGENTSEC / AGENTREL 作 focus area 注入）
  → `P07–P09 Financial Services Overlay`（FSISEC01–16 / FSIOPS / FSIREL / backup）
  → `P10–P14 Enterprise Agent Platform Overlay`（Knowledge·Retrieval / Skill 供应链 /
  Deployment·Evidence / Multi-tenancy / Multi-runtime）
  → `P15 15 条 Architecture Invariants`（Fail 即阻断）
- 对齐版本：Agentic AI Lens **2026-06-10**、FSI Industry Lens **2026-01-27 修订**
- 主表编号 `1..542` **连续且唯一**；上一版未被覆盖的旧条目进「附录 A」，编号 `A01..A181`，不计入主表
- 评分：0–5 分 + `E = Evidence available`（`3 + E` 才算可信 Pass）
- 10 项 P0 红线：Agent Identity / Retrieval Entitlement / Tool Authorization / Prompt·Config Versioning /
  Memory Isolation / Input-Output DLP / Non-repudiation / Human Approval·Rogue Agent /
  Provider·Runtime Resilience / Skill Supply Chain
- 上一版的「14 Pillars + 389 问题 + 12 Invariants + 50 核心问题清单」已作废（50 项清单编号无法映射，改用 P0 红线）

