---
author: SW
pubDatetime: 2026-11-20T00:00:00Z
title: "面向非开发团队的 Agent Desktop：从 Claude Cowork 和 ChatGPT Work 看企业级知识工作环境"
featured: false
draft: false
tags:
  - AI
  - Agent
  - Enterprise Architecture
  - Knowledge Work
  - Governance
  - Security
description: "面向金融分析师、研究员、架构师和审核员设计 Agent Desktop，需要解决的不是聊天体验，而是任务委托、企业数据访问、可控执行、证据追溯和人工决策。结合 Claude Cowork、OpenAI ChatGPT Work 与相关研究讨论架构取舍。"
---

# 面向非开发团队的 Agent Desktop：从 Claude Cowork 和 ChatGPT Work 看企业级知识工作环境

Agent Desktop 不是一个增加了文件访问和 MCP 工具的聊天窗口。企业知识工作往往跨越多个系统和多个步骤：分析师要核对数据口径，研究员要整理来源并验证结论，架构师要把需求与现有系统联系起来，审核员则要追溯证据、规则和审批记录。单轮问答很难承载这样的工作。

更合适的定位是任务工作台（Knowledge Work Environment）。用户提交目标、材料和交付要求，Agent 在明确的权限范围内检索信息、调用系统、分析资料并生成成果；用户可以查看进度、修正方向、检查依据，并决定是否批准后续动作。最终交付物应能编辑、复核、归档和追溯，而不是只留在对话里。

Claude Cowork 和 OpenAI 的 Agent、Deep Research、Work 展示了这类产品的不同实现方式。它们的功能边界还在变化，本文不按某一版本罗列功能，而是从公开资料中提炼产品设计和企业落地时需要解决的架构问题。

## 1. 产品实践：Claude 和 OpenAI 分别解决了什么问题

### Claude：把开发者的 Agent 执行能力带到知识工作

Anthropic 在 2026 年把 Claude Cowork 推向更广泛的企业用户。公开描述的典型任务包括研究冲刺、项目材料、协作演示文稿、数据整合和跨应用工作。其产品组合把文件工作区、Connectors、Skills、Plugins、子任务和较长时间运行的任务结合起来。Anthropic 在 [2026 年 4 月的企业公告](https://claude.com/resources/articles/cowork-for-enterprise)中提到，Cowork 的大量使用来自工程以外的团队，包含运营、市场、金融和法律职能；这些团队首先把周边研究、材料准备和协作任务交给 Agent，而不是直接交出核心业务决策。

这类产品给出的启示并不复杂：用户应该描述要完成的工作和交付标准，而不是先理解 Agent Framework、MCP 或 Prompt Engineering。系统负责选择合适的工具和流程，成果则应进入 Excel、PowerPoint、文档库、工单系统等日常工作环境，不能只保存在聊天记录中。

Anthropic 在 2026 年 11 月还开始向 Enterprise 组织推出统一的 Claude 体验：对话从普通 Chat 开始，任务需要文件或代码执行时再进入 Cowork 的隔离云端环境，用户不必先理解产品模式差异。入口从“先选工具”转向“直接描述任务”，降低了使用门槛；但系统仍应明确显示任务何时切换执行环境、使用了哪些连接器，以及本地文件通过什么方式被访问。参见 [统一 Claude Enterprise 体验的管理说明](https://support.claude.com/en/articles/17444462-set-up-and-manage-the-new-unified-claude-experience-for-your-enterprise-organization)。

Anthropic 的另一项公开资料更值得架构师仔细阅读：[How we contain Claude across products](https://www.anthropic.com/research/how-we-contain-claude)。它比较了 Claude Code 与 Cowork 的安全边界。开发者通常能够判断 Shell 命令和代码修改是否合理，因此 Claude Code 可以把一部分权限判断交给用户；普通知识工作者未必能判断命令行行为是否危险，Cowork 因此采用更强的隔离边界。Anthropic 的安全研究描述了 Cowork 的本地 VM 执行模式：用户明确选择的工作区被挂载到隔离环境，凭证留在宿主机，Agent 不会因此获得整台电脑的访问权。需要区分的是，当前 Cowork 的云端任务也可以运行在 Anthropic 管理的隔离环境中；桌面端通过受控桥接访问用户明确连接的本地文件夹。两种模式的执行位置不同，但共同原则是把 Agent 可见的文件范围限制在用户和组织授权的边界内。参见 [Cowork 使用与权限说明](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)。

这并不是多加几次确认就能解决的问题。Anthropic 在[安全架构研究](https://www.anthropic.com/research/how-we-contain-claude)中披露，Claude Code 的 OS 沙箱将权限提示数量减少了 84%。这项数据来自 Anthropic 自身的工程披露，不能视为独立对照实验。不过，它反映了一个实际问题：逐次弹出权限提示并不等于有效监督。提示过多会造成审批疲劳，用户最后可能不再认真判断。

### OpenAI：把研究、浏览器操作和桌面工作整合起来

OpenAI 在 [2025 年推出 ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/)，将研究和行动组合到一个任务中：Agent 可以使用自己的虚拟计算机浏览网站、运行代码、分析资料，并在连接器允许的范围内访问第三方数据。产品说明也强调用户可以中断任务并接管浏览器。此后，Deep Research 继续强化多来源研究与报告生成；企业连接器将 SharePoint、Google Drive、Slack 等系统的数据带入任务；OpenAI 在[2026 年 7 月的企业版本更新记录](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes)中宣布新的 ChatGPT Desktop 将 Chat、Work 和 Codex 放到统一桌面入口，Work 在获得用户许可后可以使用本地文件和桌面应用。

OpenAI 的产品方向也从单次任务扩展到组织级复用。Workspace Agents 允许组织创建可重复使用的工作流程，并在 ChatGPT 或 Slack 中运行；企业版本更新还加入了管理员分析、Agent 活动信息和审计日志。这意味着 Agent 开始成为需要配置、运营和审计的组织资产，而不只是个人助手。

不过，产品提供管理界面和审计事件，不代表企业已经获得完整的端到端治理能力。OpenAI 的[企业发布说明](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes)列出了 Workspace Agents、RBAC、连接器交互分析和 Global Admin Console 审计事件；这并不意味着每一个 Agent 在每个下游系统中的动作都已经被同一条审计链完整覆盖。实际部署仍需检查 Compliance Logs Platform、Agent 事件范围以及目标 SaaS 自身的审计日志，并将它们关联起来。

官方资料：
- [Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/)
- [ChatGPT Enterprise and Edu release notes](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes)
- [ChatGPT Enterprise](https://chatgpt.com/business/enterprise/)

### 两家产品的共同方向与差异

| 维度 | Anthropic Claude | OpenAI ChatGPT |
| --- | --- | --- |
| 面向知识工作的入口 | Claude Cowork、Claude Desktop、Connectors、Skills / Plugins | ChatGPT Desktop、Work、Deep Research、Agent、Workspace Agents |
| 长任务 | Cowork 的多步骤任务、子任务和持续执行 | Agent、Deep Research、Workspace Agents |
| 文件与应用 | 选择工作区、连接器、Office 应用集成 | 本地文件和桌面应用授权、企业连接器 |
| 企业复用 | Skills、Plugins、组织级连接器控制 | Workspace Agents、GPTs、连接器和管理员控制 |
| 安全设计公开重点 | 当前云端隔离执行与 Desktop Bridge；另有早期本地 VM 设计研究 | 云端虚拟计算机、Work Local 权限面和企业策略控制 |
| 运营可见性 | OpenTelemetry、Compliance API、组织分析 | Compliance Logs Platform、Admin Audit、Agent 与连接器分析 |

表格归纳的是公开资料呈现的产品方向，不代表功能完整度或安全性排名。相关能力和套餐可能调整，采购前仍需核对当前官方文档、租户实际配置及合同条款。

## 2. Agent Desktop 的核心架构

Agent Desktop 没必要重新建设企业身份、权限、数据目录和流程引擎。它应负责统一入口、任务管理和执行协调，底层尽量复用现有 IAM、文档平台、数据平台、Workflow、API Gateway、审计和 DLP。

![Agent Desktop 参考架构：工作台、Agent Runtime、企业控制平面和业务系统](/diagrams/agent-desktop-knowledge-work-architecture.svg)

用户界面层负责任务创建、上下文选择、执行观察、结果审查和交付物管理。Agent Runtime 负责计划、模型调用、工具路由、上下文组装、长任务状态和恢复。企业控制平面负责身份、策略、工具目录、模型准入、风险等级、审批和审计。连接器与工具层则把 SharePoint、Confluence、Snowflake、CRM、ServiceNow、邮件和浏览器等系统暴露为受控能力。

这些模块初期可以部署在同一个应用中，没有必要为了形式上的分层拆成一组微服务。真正需要隔离的是职责和权限：UI 不保存下游系统的高权限凭证，模型不能决定授权结果，Agent 也不能靠 Prompt 绕过业务系统的权限检查。

### 2.1 以 Task 为中心，而不是以 Chat 为中心

聊天记录能保存交互过程，却不能代表一项业务工作。Task 应成为独立对象，记录目标、业务上下文、发起人和责任人、输入资料、授权范围、执行状态、交付物、证据引用、审批记录及运行轨迹。

Task 可以跨多个会话继续执行，也可以暂停等待人工输入、审批或外部事件。用户打开桌面端时，看到的应该是正在进行的工作、等待自己处理的事项、已完成的交付物和可复用的工作模板，而不是一长串没有业务状态的对话。

Task 的状态必须由 Runtime 或 Workflow 管理，不能以模型在对话中说“完成了”作为业务完成的依据。例如，Agent 生成了合同审查报告，只能说明分析产物已生成；只有当报告经过指定审核人批准并归档到正式系统，业务流程才算完成。

### 2.2 工作区与上下文必须有明确边界

用户选择项目、客户或研究主题后，系统应列出工作区实际包含的文件、数据源和连接器。工作区不能自动继承整台设备的文件权限，也不能把一个任务的敏感上下文带到另一个客户或项目。

本地文件访问、云端执行和连接器访问是三种不同的数据路径。它们有不同的安全边界、日志位置和网络控制方式。Claude Cowork 的本地 VM 与云端隔离执行说明了为什么“用户选中的文件夹”比“Agent 可以读取整台电脑”更合理；OpenAI 的虚拟计算机则属于 Agent 自己的云端执行环境，不能与 Work 在桌面端获得授权的本地应用访问混为一谈。产品必须明确告诉用户：当前任务在哪里执行、能访问哪些文件、哪些连接器已启用、输出会保存到哪里。

## 3. 非开发团队真正需要的工作体验

### 金融分析师：数据口径比生成图表更重要

金融分析师可能需要准备公司或市场研究、解释业绩变化、比较投资标的、分析组合敞口，最后形成投资委员会材料。Agent 可以收集公开信息、查询授权数据、执行计算并生成 Excel 或演示文稿，但找到一个数字并不等于完成分析。

每个关键数字都应保留来源系统、查询时间、指标定义、币种、单位、期间、过滤条件和计算逻辑。若数据来自 Snowflake Semantic View 或受治理 SQL，交付物应引用查询或数据集版本，而不是只附一段模型生成的解释。估值假设、风险判断和投资建议必须标明是用户输入、模型推断还是外部事实。正式交易、资金划转和投资组合变更不应由普通研究 Agent 直接执行。

### 研究员：从资料汇总转向可复查的研究过程

研究工作不止于搜索和摘要。研究员还要管理问题定义、检索范围、来源质量、论文版本、证据冲突、引用及结论之间的关系。Agent 应支持保存检索策略、来源快照、引用片段、研究笔记和报告版本。它可以提出新的检索方向、对比不同论文的方法和结果，但不能把摘要当成全文，也不能把预印本当作经过同行评审的最终论文。

研究工作台最好允许用户从一个结论反向追溯到支持它的原始段落，并把未解决的问题保留在报告中。多 Agent 可以分别负责检索、方法审查和反方论证，但最终证据账本应由统一的任务上下文维护，避免各个 Agent 引用不同版本的材料。

### 架构师：让设计决策与系统事实关联

架构师可以把需求、现有系统清单、数据流、ADR、技术债、接口契约和运行指标放到一个项目工作区。Agent 可以生成系统依赖分析、方案比较、风险登记和 ADR 草稿，也可以调用 CMDB、LeanIX、GitHub、Confluence 或云平台工具验证系统现状。

架构分析必须区分系统记录与模型推断。例如，CMDB 中登记的应用依赖关系是一项有来源的事实；根据仓库调用关系推断出的潜在依赖则应标记为待验证。架构师需要的是能帮助自己做判断的证据和反例，而不是一个自动替自己宣布架构结论的 Agent。

### 审核员：把检查标准变成可执行、可追溯的流程

审核任务应明确检查范围、适用规则、必需证据、例外条件、发现项、严重程度、复核意见和最终结论。Agent 可以执行资料完整性检查、规则匹配、异常筛查和报告草拟，但每项发现必须链接原始证据，并说明规则版本和判断过程。

审核员不应只看到“合规/不合规”两个标签。系统需要显示缺失材料、冲突证据、规则适用性和需要人工判断的事项。对于监管申报、正式审计意见、客户风险评级和例外批准，Agent 可以准备材料，但最终签署和责任归属仍应由授权人员完成。

## 4. 自主权设计：不要只有一个“自动执行”开关

把所有任务放进同一种权限模式，是 Agent Desktop 常见的设计错误。读取公开报告、修改本地草稿、向客户发送邮件和更新生产记录，影响范围完全不同。

自治程度应由具体动作的风险决定，而不是由用户对某个 Agent 的总体信任决定。

| 等级 | Agent 可以做什么 | 典型任务 | 控制方式 |
| --- | --- | --- | --- |
| L0 建议 | 只分析和提出建议 | 方案比较、风险分析 | 不产生外部副作用 |
| L1 读取 | 读取授权数据并生成产物 | 文档检索、数据分析 | 继承用户权限，记录数据来源 |
| L2 草拟 | 修改工作区内的草稿 | 报告、Excel、ADR 草稿 | 版本控制、差异审查 |
| L3 受控写入 | 对指定系统执行有限写操作 | 创建工单、更新草稿状态 | 工具级策略、参数校验、必要时审批 |
| L4 高影响操作 | 产生不可逆或重大业务影响 | 对外发送、正式发布、交易或申报 | 明确授权、职责分离、双人复核或人工执行 |

审批界面不能只显示“Agent 想调用 update_record”。用户需要看到目标对象、变更前后差异、影响范围、数据依据、执行身份和撤销方式。批准结果必须绑定具体资源和参数；内容或目标在审批后发生变化，就应重新审批。

![Agent Desktop 的风险分级与人工审批流程](/diagrams/agent-desktop-risk-and-approval-flow.svg)

### 4.1 审批疲劳与 Human-in-the-loop 的局限

审批记录只能证明有人点击了按钮，不能证明对方理解并检查了操作内容。Anthropic 关于 Claude Code 权限提示和 Cowork 隔离机制的讨论，已经说明逐项授权可能形成疲劳。学术研究也反复发现，人们可能过度依赖算法建议，尤其在时间压力、任务负担和界面锚定影响下。

2026 年发表在 Harvard Data Science Review 的[《Bias in the Loop: How Humans Evaluate AI-Generated Suggestions》](https://hdsr.mitpress.mit.edu/pub/nrcn4h7d/release/2)基于 2,784 名参与者，发现当纠正 AI 错误需要额外输入时，参与者更少纠错，也更容易接受错误建议；参与者原有的 AI 态度也是判断表现的重要预测因素。[《Putting a human in the loop: Increasing uptake, but decreasing accuracy of automated decision-making》](https://pmc.ncbi.nlm.nih.gov/articles/PMC10857587/)则通过实验指出，让人参与调整自动化建议可能提高接受程度，却不保证最终准确率提高。这些研究不是企业 Agent Desktop 的直接生产评估，但它们提醒我们：人工参与必须设计成真实的判断过程，而不是审批按钮。

审批界面应把需要判断的内容摆出来：关键证据、冲突数据、异常变化、未满足的规则，以及模型无法确定的部分。对于高风险判断，可以先让审核人独立给出初步结论，再展示 Agent 的建议，降低锚定效应。审批数量、审批耗时和批准率不能单独作为效率指标；还应测量抽检发现的错误、人工修改比例、撤销率和重大问题逃逸率。

## 5. 安全边界：非开发用户不应该被迫理解底层风险

### 5.1 Prompt Injection 是数据访问问题，也是执行权限问题

Agent 会读取邮件、网页、PDF、文档和工单。这些内容可能包含恶意或误导性指令。OpenAI 的 [ChatGPT agent 安全说明](https://help.openai.com/en/articles/11752874-chatgpt-agent)和 Anthropic 的 [Cowork 安全指南](https://support.claude.com/en/articles/13364135-use-claude-cowork-safely)都明确提示，Prompt Injection 风险不会因为启用产品内置防护而消失。只要模型能够把外部内容当作指令，并且同时拥有文件、浏览器或连接器写权限，就可能发生跨系统数据泄露或非预期操作。

不能只靠 Prompt 写一句“忽略文档中的恶意指令”。工具输出、网页内容和文档内容都应视为不可信数据。真正的防线在执行层：文件系统隔离、连接器 allowlist、网络 egress 策略、工具级授权、敏感数据检测、写操作确认和输出目的地控制。尤其需要检查 Agent 是否能把一个有权限读取的数据源内容，通过另一个被允许访问的外部服务传出去。

### 5.2 用户权限、Agent 身份和工具权限必须分开

一次操作至少要能关联发起用户、Agent、运行任务、工具身份、目标资源、策略决策和审批记录。读取数据时优先继承用户授权（delegated access），后台任务则使用范围受限、可撤销的 workload identity。不要让所有 Agent 共用一个可以访问多个系统的超级账号。

MCP 只是工具集成协议，不是授权系统。每个连接器仍需明确数据范围、读写能力、凭证生命周期和责任人。工具描述与返回内容也属于不可信输入，需要经过版本审查和策略控制。

### 5.3 需要完整的运行审计，而不只是保存对话

企业需要能够回答：谁发起了任务、当时使用哪个模型和配置、Agent 读取了哪些数据、调用了什么工具、哪些动作被批准或拒绝、产生了哪些文件、最终结果是否被业务系统接受。

建议采用统一的 Task ID / Trace ID，将模型调用、工具调用、数据访问、文件读写、审批和下游系统审计事件关联起来。OpenTelemetry 适合承载运行指标和调用轨迹；合规日志则需要按组织的留存、访问和法律保全要求管理。不要默认把完整敏感 Prompt 和数据内容无限期写入通用日志。应区分元数据、内容审计和业务系统自身的正式记录。

### 5.4 沙箱解决的是执行隔离，不等于数据访问授权

部署前要先弄清几个边界：Agent 运行在哪台机器、以什么身份运行，如何访问本机文件，浏览器和桌面应用由谁控制，任务数据会发送到哪里。只说“运行在沙箱里”并不足够，因为沙箱解决执行隔离，不能代替数据授权。

Anthropic 当前的 Cowork 安全说明将任务描述为运行在 Anthropic 云端的临时隔离环境；需要本地文件或桌面应用时，再通过 Claude Desktop 建立受控访问路径。Anthropic 另有一篇工程研究，介绍早期 Cowork 本地 VM 的设计：VM 使用独立 Linux kernel、filesystem 和 process table，只挂载用户选定的工作区，凭证留在宿主机。这篇研究适合理解 VM 隔离思路，但不能据此推断当前 Cowork 的任务都在本机 VM 内执行。

OpenAI 的 Work 需要区分 Cloud Work、Local Work 和 Local computer access with Work Cloud。后一种模式由云端协调任务，本机执行需要访问设备资源的步骤；相关文件片段、Prompt、截图或应用上下文仍可能发送到 OpenAI 服务。OpenAI 明确说明该模式不提供严格的 Zero Data Retention（ZDR）。因此，“文件留在本机”不等于“任务数据只在本机处理”。

| 执行模式 | Agent 代码运行位置 | 本机访问方式 | 设计时必须检查 |
| --- | --- | --- | --- |
| Cowork 当前云端任务 | Anthropic 云端临时隔离环境 | Desktop bridge 访问已连接文件夹和获批应用 | 数据处理位置、桥接权限、云端留存 |
| Cowork 早期本地 VM 设计 | 本机 VM，独立 Guest OS | 选定工作区挂载到 VM | Host/Guest 边界、挂载模式、凭证隔离；这是工程研究披露的设计阶段 |
| ChatGPT Work Cloud | OpenAI 管理的云端执行环境 | 上传文件、连接器和云端浏览器等授权路径 | 云端执行策略、连接器身份、数据留存 |
| ChatGPT Work Local / Work Cloud 协同 | 本机执行部分步骤，云端协调任务 | 桌面端、本机文件与应用权限 | OS 权限、应用批准、浏览器路径、云端上下文和审计覆盖 |

从企业架构角度，沙箱至少应区分三层：

- **进程与运行时隔离**：限制 CPU、内存、进程、系统调用、临时目录和子进程能力。容器通常仍共享宿主机内核；VM 提供独立 Guest Kernel，隔离边界更强，但启动、资源和运维成本更高。
- **文件与凭证隔离**：Agent 只能看到显式挂载的工作区或通过文件服务访问获批资源。企业 SSO 凭证、刷新令牌和长期密钥应留在 Host 或专用凭证代理中，不能写入 Agent 工作目录或环境变量。
- **网络与工具隔离**：沙箱默认不继承企业 VPN、宿主机路由和浏览器登录态。访问内部系统必须走单独授权的 Connector、受控 Proxy 或本机 Bridge，并在目标系统再次执行用户权限检查。

本机 Agent 如果使用容器而非 VM，不能把容器边界当成对抗恶意 Guest Kernel 或高权限宿主机攻击的完整隔离。应以最小权限运行，去掉不必要的 capabilities，限制系统调用、设备、挂载和网络；对高敏感任务优先考虑独立 VM 或托管执行环境。Local MCP Server、浏览器扩展和桌面自动化进程也不应因为由 Agent 调用就自动被视为沙箱内可信组件，它们各自形成新的信任边界。

![Agent Desktop 的云端执行、本机桥接与沙箱信任边界](/diagrams/agent-desktop-execution-boundaries.svg)

[查看执行边界图（HTML）](/diagrams/agent-desktop-execution-boundaries.html)

### 5.5 本机文件访问：路径校验必须发生在真实文件对象上

把访问范围限制在用户选定的目录，只解决了授权问题的一部分。实现时还要处理符号链接、路径穿越、大小写和 Unicode 规范化、硬链接、挂载点、竞态条件及文件替换。只在字符串层面检查 `startsWith(workspaceRoot)` 并不安全：授权目录中的 symlink 可以指向目录外部，攻击者也可能在校验和打开文件之间替换路径目标。

建议将文件访问封装为独立的 File Access Service，而不是让 Agent Runtime 直接拼接本机路径。服务应执行以下流程：

1. 用户显式选择工作区根目录，服务保存其稳定的目录句柄或文件身份，而不只保存字符串路径。
2. 对请求路径做规范化，解析符号链接和真实目标，再检查目标是否仍处于授权根目录之内。**必须先解析 symlink，再做最终路径授权判断**；拒绝 `..` 穿越、越界链接和不允许的挂载点。
3. 授权检查应绑定实际打开的文件对象。支持的平台优先使用目录句柄相对打开、禁止跟随 symlink 的系统调用或等价机制，避免检查后文件被替换的 TOCTOU 问题。
4. 依据数据分类、文件类型和任务策略，分别授予只读、读写、禁止删除等能力。写入使用临时文件、原子替换和版本备份；删除、覆盖和批量改名是不同的动作，不能被一个笼统的“写权限”涵盖。
5. 对超大文件、隐藏文件、凭证文件、浏览器 Profile、SSH Key、云配置、系统目录和企业敏感目录设置默认拒绝或单独审批。拒绝规则应由管理员集中配置，普通用户不能通过 Prompt 覆盖。

Anthropic 的工程说明披露了 read-only、read-write 和 read-write-no-delete 等挂载模式，并特别指出 symlink 解析顺序对防止目录逃逸的重要性；企业还可以通过 MDM 限制允许挂载的路径。这里的文件句柄绑定、TOCTOU 防护、原子写入和敏感文件默认拒绝，是通用安全工程建议，不应误认为是所有商业产品都已公开实现的细节。

文件授权最好落到具体能力，而不是只给一个布尔值：

| 能力 | 默认策略 | 额外约束 |
| --- | --- | --- |
| List / Read | 工作区内允许 | 敏感文件分类、最大文件大小、内容审计 |
| Create | 工作区内允许创建新文件 | 限制扩展名、路径和输出目录 |
| Update | 默认生成新版本或草稿 | 展示 Diff、原子替换、可恢复 |
| Rename / Move | 单独控制 | 检查源和目标路径，防止跨区移动 |
| Delete | 默认禁止或逐次批准 | 回收站/备份、批量删除二次确认 |
| Execute | 不等同于文件读写权限 | 单独沙箱、命令策略、网络隔离 |

![本机文件访问的授权、路径解析和安全打开流程](/diagrams/agent-desktop-filesystem-access.svg)

[查看文件访问控制图（HTML）](/diagrams/agent-desktop-filesystem-access.html)

### 5.6 Computer Use 必须与文件 API 分开授权

文件 API 的目录授权，不能覆盖屏幕读取、鼠标点击和键盘输入权限。Computer Use 可能通过一个已授权的应用打开文件夹白名单之外的文件，也可能在当前用户已登录的应用中执行操作。因此，文件系统 Allowlist 不能被当作 Computer Use 的完整边界。

macOS 上，Screen Recording 权限决定 Agent 能否读取屏幕内容，Accessibility 权限决定它能否点击、输入和导航；Windows 的交互模式和当前可见桌面会话又有不同约束。OpenAI 的 Work Local 文档还明确区分了内置浏览器、Chrome 扩展和通过 Computer Use 控制本机浏览器：Computer Use 使用已登录的浏览器会话时，不适用 Browser Use 的站点和能力策略，仍受原生应用策略、OS 权限和账户自身权限约束。Anthropic 也提醒，Computer Use 不受文件工具同样的沙箱保护，应用批准不代表操作风险已经消失。

因此，桌面自动化应作为独立能力面管理：

- 按应用建立 Allowlist / Denylist，默认阻断网银、交易终端、密码管理器、身份管理、医疗和个人敏感应用。
- Screen Recording、Accessibility、麦克风、剪贴板和文件访问分别申请权限，不把一次应用批准扩展成所有权限。
- 批准范围绑定具体应用、任务和会话；跨会话复用审批由管理员策略决定，并支持撤销。
- 对浏览器区分云端 Browser、桌面内置 Browser、扩展控制现有标签页、Computer Use 操作原生浏览器。分别验证登录态、站点策略、上传下载限制、历史记录和审计覆盖。
- 对发送、提交、删除、资金相关和权限管理等操作采用专门的业务授权。屏幕上出现了按钮，不代表 Agent 有权点击它。

![Computer Use 的操作权限与浏览器访问边界](/diagrams/agent-desktop-computer-use-boundaries.svg)

[查看 Computer Use 权限边界图（HTML）](/diagrams/agent-desktop-computer-use-boundaries.html)

### 5.7 网络出口：VPN 可达不等于 Agent 获得授权

Agent 的网络请求可能来自代码沙箱、云端或本机浏览器、原生桌面应用、Connector 和 Local MCP。这些流量未必经过同一个 Proxy，也未必受同一套浏览器策略约束。仅在容器中设置一个网络 Allowlist，无法覆盖本机浏览器已登录会话或原生应用发出的请求；企业 VPN 能够访问内网，也不代表 Agent 有权访问其中的每个服务。

建议以 deny-by-default 为基线，为每种执行路径单独定义目的地、协议、身份和数据范围。代码执行环境通过受控 egress proxy 出网；本机 Bridge 只暴露窄接口，不提供任意 HTTP、Shell 或端口转发；Connector 使用目标系统 OAuth scope 和资源级权限；浏览器策略单独限制站点、上传下载和调试协议。DNS 解析结果、重定向、IP 段和代理绕行也要纳入验证，不能只按域名字符串做 Allowlist。

对金融和审核任务，尤其要防止 Agent 将受保护数据从一个合法读取通道转移到另一个合法写入通道。网络层允许访问某个 SaaS，不代表允许把当前工作区中的客户数据上传给它。数据分类、目的地策略和动作策略必须共同判断。

![Agent Desktop 不同执行路径的网络出口控制](/diagrams/agent-desktop-network-egress.svg)

[查看网络出口控制图（HTML）](/diagrams/agent-desktop-network-egress.html)

### 5.8 用数据外传场景检验纵深防御

需要重点测试的未必是沙箱逃逸，更常见的攻击路径可能是：Agent 读取了含有间接指令的外部 PDF，文档要求它把工作区中的客户资料发送到某个外部网站；Agent 本身没有突破文件权限，也没有逃出容器，只是把已获准读取的数据，通过另一个已获准使用的连接器写了出去。

这类问题说明，权限检查不能只问“这个工具是否允许使用”，还要判断当前任务能否把这类数据发往这个目标。建议对每个数据源和目的地维护数据分类、用途限制与允许流向；工具调用时由 Policy Enforcement Point 检查主体、动作、资源、数据标签、目的地和任务上下文。模型只能提出动作，不能自行改变策略或豁免规则。

高风险写入的审批应绑定目标资源、动作、完整参数摘要和数据来源。审批之后，只要目标、内容或参数发生变化，就重新计算策略并要求重新批准。日志记录策略决策、数据分类、目标系统和结果，但不要为了审计而把完整敏感文件内容复制进普通日志。

![Prompt Injection 导致跨系统数据外传的威胁路径与防护点](/diagrams/agent-desktop-data-exfiltration-threat-model.svg)

[查看数据外传威胁模型图（HTML）](/diagrams/agent-desktop-data-exfiltration-threat-model.html)

### 5.9 审计、留存与应急响应不是同一个控制

审计日志用于调查和问责，不能替代执行前的授权与阻断。应分别记录用户身份、Agent / workload identity、Task ID、模型和策略版本、文件操作元数据、工具调用、审批、网络目的地和下游结果，并关联设备 EDR、身份平台、代理和目标业务系统日志。对敏感内容采用受控的内容审计或证据快照，不要默认把完整 Prompt、文件内容和屏幕截图无限期写入通用日志。

同样不能假定结束任务就删除了所有副本。对云端任务、本机执行记录、Prompt 和文件片段、截图、生成文件、连接器缓存、浏览器 Profile、合规日志分别制定留存和删除策略。OpenAI 的 Work Local 文档明确指出，Local computer access with Work Cloud 不提供严格 ZDR，且不同数据类别适用不同留存规则；Anthropic 的 Cowork 安全说明也指出，云端任务通过 Desktop 读取的本地文件内容仍在 Anthropic 服务端处理。若组织要求数据绝不离开终端，必须验证产品的数据流是否满足该要求，而不是根据“Local”这个产品名称判断。

上线前至少验证以下失败场景：Agent 通过 symlink 访问工作区外文件；文件在授权检查后被替换；Computer Use 从获批应用跳转到未批准应用；浏览器策略没有覆盖原生浏览器自动化；任务取消后后台动作仍继续；审批后参数发生变化；连接器读取的敏感数据被发送到外部目的地；审计链缺少本机文件或云端协调事件。对每个场景都要验证系统是否阻断、是否告警、能否定位责任主体，以及能否恢复受影响的数据和业务状态。

### 5.10 执行配置：把文件、代码、网络和桌面操作拆成独立能力

“只读代码”“运行测试”和“操作本机浏览器”经常被放在同一个 Agent 权限开关下，这是一个危险的抽象。读取源码不会自动带来执行权限；但一旦允许运行测试，测试脚本、构建插件、依赖安装脚本和仓库中的辅助程序都可能执行任意代码。反过来，限制文件写入也不代表命令行不能通过网络发送读取到的资料。权限模型必须描述 Agent 能做什么，而不是只描述它打开了哪个项目。

建议把能力拆成至少六个独立维度：文件读取、文件写入、代码执行、网络访问、结构化业务工具、桌面与浏览器控制。每个任务先匹配一个最小权限执行配置（Execution Profile），只有任务确实需要时才逐项提升能力。一个配置不能因为启用了某个工具就隐式获得其他能力。

| 执行配置 | 文件范围 | 代码 / Shell | 网络 | 浏览器与桌面 | 适用任务 |
| --- | --- | --- | --- | --- | --- |
| Document Reader | 指定资料只读 | 禁止 | 默认禁止；检索走受控服务 | 禁止 | 阅读合同、报告、论文 |
| Code Reviewer | 仓库只读，敏感文件拒绝 | 静态分析优先；命令需受限 | 文档站点白名单或关闭 | 禁止 | 代码审查、架构分析 |
| Code Runner | 临时工作区可写，源仓库只读 | 允许受限测试 / 构建 | 默认关闭，按需开放 | 禁止 | 单元测试、数据转换、可复现分析 |
| Code Developer | 指定仓库可写 | 沙箱内执行 | 依赖源和文档站点白名单 | 禁止，除非单独授权 | 实现功能、修复缺陷 |
| Browser Researcher | 下载目录隔离写入 | 禁止任意 Shell | 受控浏览器站点策略 | 浏览器专用会话 | 网页研究、资料收集 |
| Desktop Operator | 显式授权的文件与应用 | 不自动授予 Shell | 仅经批准的应用 / 连接器 | 指定应用、指定会话 | Excel、PowerPoint 等桌面操作 |
| Business Operator | 业务数据按用户权限读取 | 禁止任意 Shell | 仅批准的 Connector | 优先使用结构化 API | 工单、CRM、审批流程 |

这张表是建议的企业策略模型，不是 Claude 或 OpenAI 的现成功能清单。实际产品能力需要映射到这些维度，并验证每个权限是否真正由执行环境强制实施。尤其要避免“读代码”被解释成“可以运行仓库代码”，也要避免“可以操作浏览器”被解释成“可以访问当前用户所有已登录应用”。

**Claude 的边界需要按产品区分。** Claude Code 在用户本机运行，Plan 模式适合只读分析；文件编辑权限、Shell 权限和网络权限应分别配置。其文件访问规则并不能自动约束 Shell 命令、MCP Server 或 Hook 程序，因此只设置目录读写限制并不足以构成完整沙箱。需要执行代码时，还要依赖操作系统级沙箱和命令执行策略。Cowork 则主要把任务放在云端隔离环境中，通过 Desktop Bridge 访问用户明确连接的本地文件；这和 Claude Code 在本机仓库中执行代码不是同一种运行模型。Cowork 的 Computer Use 又是独立权限面，不能把文件夹授权当成桌面操作的边界。

**OpenAI 的边界也不是一个统一的 Desktop 权限。** ChatGPT Work 可以在云端和本机之间协调任务；本机步骤仍受桌面端授权和本机策略控制，而任务上下文、文件片段、截图或工具结果可能进入云端处理。Codex 的关键设计是把 Sandbox 与 Approval Policy 分开：Sandbox 决定文件系统和网络在技术上能到哪里，Approval Policy 决定哪些动作需要用户批准。只读模式、工作区写入模式和更宽权限模式的差异，应通过执行环境强制，而不是只靠模型遵守指令。Work 的 Computer Use、桌面内置浏览器、Chrome 扩展和云端 Browser Use 也属于不同访问路径，不能假定一套站点策略覆盖所有路径。

因此，企业自建 Agent Desktop 应把“授权”和“执行限制”作为两道独立控制。策略引擎先决定某个 Task 可获得哪些能力；运行时再通过 OS 沙箱、容器或 VM、文件代理、网络代理和应用授权实际限制能力。审批只负责例外和风险提升，不能替代沙箱。批准一次测试命令，也不应自动批准后续联网、读取凭证或写入其他目录。

几个实现细节容易被忽略：

- **只读仓库不等于只读执行。** 测试和构建会运行项目代码、依赖脚本和插件。对不可信仓库，应在隔离环境运行，限制进程、系统调用、文件挂载和网络；不要在开发者宿主机上直接执行。
- **广泛读取会暴露秘密。** 即使不允许写文件，Agent 也可能读到 .env、SSH 配置、云凭证、浏览器 Profile 或本机配置文件。应在文件服务层默认拒绝敏感路径，而不是期待模型主动忽略。
- **网络权限要与代码执行解耦。** Code Reviewer 可能需要访问官方 API 文档，但不需要允许仓库代码任意出网。可由独立检索服务代为取回文档，或通过只读代理开放精确目的地。
- **浏览器登录态是高权限凭证。** 优先使用有资源级授权的 API、MCP 或 Office Add-in；只有没有结构化接口、确实需要视觉交互时才启用 Computer Use。操作现有用户浏览器时，必须把会话身份、站点范围、上传下载和页面数据外传纳入风险评估。
- **权限提升必须是任务级、短时和可撤销的。** 提升权限时显示新增的目录、命令能力、网络目的地或应用范围；任务结束后回收。审批绑定具体动作和参数，参数变化或目标资源变化时重新审批。

执行配置应随 Task 一起保存，作为任务记录的一部分。这样用户和审计人员能够回答：这次任务为什么能读取某个目录、为什么可以运行测试、是否能够访问网络、是否操作过登录浏览器，以及这些权限由谁批准。权限模型最终要能被测试：用恶意测试仓库、越界 symlink、依赖安装脚本、恶意网页和数据外传用例验证实际边界，而不是只检查设置界面上显示了哪些开关。

![Agent Desktop 的任务执行配置与能力授权边界](/diagrams/agent-desktop-execution-profiles.svg)

[查看执行配置与能力边界图（HTML）](/diagrams/agent-desktop-execution-profiles.html)

### 5.11 自建 Agent Desktop：不要从 Computer Use 开始

如果不是直接采用 Claude 或 OpenAI 的完整产品，而是自己构建面向企业知识工作者的 Agent Desktop，没必要一开始就实现 Computer Use 和 Browser Use。把商业产品的功能清单当成自建系统的必选项，会显著扩大工程范围，也会把最难治理的权限面提前引入。

更合理的顺序是：**先用结构化接口完成任务，再用浏览器自动化补齐没有 API 的 Web 系统，最后才考虑视觉驱动的桌面操作。** 三种方式解决的问题不同，安全边界和维护成本也不同。

| 执行方式 | 典型实现 | 适用场景 | 主要成本与风险 | 建议优先级 |
| --- | --- | --- | --- | --- |
| API / MCP / Connector | REST、GraphQL、业务 SDK、MCP Server | 查询数据库、读取知识库、创建工单、更新业务记录 | 身份映射、资源级授权、参数校验、审计 | 第一优先 |
| Browser Use | Chromium + Playwright，优先 DOM 和 Accessibility Tree | 没有可用 API 的 Web 应用、需要跨页面操作的流程 | 登录态管理、页面变化、下载上传、站点策略、反自动化机制 | 第二阶段 |
| Computer Use | 截图、视觉定位、鼠标键盘、窗口控制 | 只能通过 GUI 使用的传统桌面应用或特殊插件 | 视觉误判、焦点和窗口状态、误操作、桌面数据暴露 | 最后考虑 |

API/MCP 并不意味着把所有系统都包装成一个万能工具。每个 Connector 仍应有明确的身份、资源范围和动作语义。例如，查询 Snowflake、读取 Confluence 页面和创建 Jira 工单应是不同的工具能力，分别定义只读或写入权限、允许的资源范围和审计字段。MCP 只是工具交互协议，不是授权边界；真正的授权仍由 Connector Gateway 和目标系统共同执行。

Browser Use 的主要价值是补齐没有结构化接口的 Web 系统，而不是取代 API。自建时通常不需要开发浏览器内核或视觉模型，可以使用受控 Chromium 实例和 Playwright。优先通过 DOM、Role、Label 和 Accessibility Tree 定位页面元素；只有页面确实无法提供可访问结构时，才考虑截图和视觉定位。浏览器应使用专用 Profile，独立管理 Cookie、下载目录、站点 Allowlist、上传能力和会话生命周期，不要默认复用用户日常浏览器的完整登录态。对金融或客户数据场景，浏览器会话本身应视为一组高权限凭证。

Computer Use 则是另一种能力。它需要理解屏幕状态、选择窗口、定位控件并执行鼠标键盘动作。只有当目标应用没有可用 API、没有可行的浏览器自动化路径，而且 GUI 操作确实能带来业务价值时，才值得建设这条执行通道。典型例子是某些传统 Windows 金融终端、只能通过桌面插件访问的应用，或缺乏自动化接口的遗留系统。它不应成为普通文档阅读、代码分析或网页研究的默认执行方式。

自建系统可以把三种能力放进同一套 Task Runtime，但不应放进同一个权限开关。一个简化的运行结构是：

- **Agent Runtime**：理解用户目标，生成任务计划，并选择所需的工具能力；模型本身不直接获得操作系统权限。
- **Policy & Approval Engine**：根据用户身份、任务类型、数据分类、目标资源和动作风险，决定是否允许执行或要求审批。
- **API / MCP Runtime**：调用结构化业务接口，执行身份映射、资源级授权、参数校验和审计。
- **Browser Runtime**：运行隔离的浏览器实例，管理专用 Profile、站点策略、下载上传和页面交互。
- **Computer Use Runtime**：在明确授权后访问指定桌面会话，限制应用、窗口和可执行动作。
- **File / Code Runtime**：为本地文件和代码任务提供独立的文件代理、工作区和沙箱。
- **Task / Workspace / Artifact**：保存任务状态、输入输出、执行配置、审批记录和证据。

关键在于，Agent 只提出工具调用请求，Runtime 才能真正访问外部系统。Policy Engine 对动作做出决定后，执行环境还要强制实施文件、网络、应用和身份边界。不要让模型通过任意 Shell、通用 HTTP 或端口转发绕开 Connector、Browser 或 Computer Use 的策略。

实施上建议分三步：

**第一阶段：File、Code 和 Connector Runtime。** 先支持本地或云端 Workspace、文档解析、文件读取、产物生成、受限代码执行，以及少量高价值业务 Connector。代码执行应在独立沙箱中进行，区分只读分析、工作区写入和测试构建；默认不允许任意网络访问。大多数研究、分析、架构和审核任务，在这一阶段就能覆盖。

**第二阶段：Browser Runtime。** 只有当目标 Web 系统没有稳定 API，且人工操作确实构成主要瓶颈时才引入。使用 Playwright 和专用浏览器 Profile，优先 DOM / Accessibility 自动化；把站点范围、登录身份、文件上传下载和页面数据外传纳入 Policy Engine。浏览器会话应可创建、暂停、终止和审计，不能把用户个人浏览器当成无边界的自动化环境。

**第三阶段：Computer Use Runtime。** 通过独立进程或隔离桌面会话承载截图、鼠标键盘和窗口控制。先限定应用和会话，再定义动作权限；高影响操作要求用户确认。不要把 Computer Use 作为 Browser Use 失败后的自动 fallback，也不要让它继承 Browser Runtime 或本机用户的全部权限。

任务执行方式可以按以下规则选择：

| 用户任务 | 首选执行方式 | 不应默认做的事 |
| --- | --- | --- |
| 查询数据库或知识库 | API / MCP / Connector | 打开浏览器登录后台查询 |
| 阅读本地 PDF 或 Office 文件 | File Runtime | 启动桌面 GUI 逐页截图 |
| 分析代码或审查 Pull Request | Read-only Workspace + 静态分析 | 直接在开发者宿主机运行未知代码 |
| 运行测试或数据转换 | Code Sandbox | 自动开放整个文件系统和互联网 |
| 查询没有 API 的网站 | Browser Runtime | 直接接管用户当前浏览器 |
| 操作 Excel 等桌面应用 | Office API / Add-in；确有必要时 Computer Use | 一开始就实现通用鼠标键盘 Agent |
| 操作传统桌面遗留系统 | Computer Use，限定应用和会话 | 将桌面会话暴露成任意远程控制能力 |

需要特别定义失败处理。Connector 不可用时，应明确提示接口不可用或转交人工；Browser Runtime 遇到页面变化、登录过期或元素无法定位时，应停止并请求恢复会话或人工接管；Computer Use 遇到焦点不明、窗口变化或动作结果无法确认时，应暂停，不应继续猜测。**执行方式可以降级，但权限不能自动升级。** Browser Use 失败不能悄悄切换到 Computer Use，更不能借机获得用户桌面的完整访问权；切换执行通道必须重新经过策略判断和必要的用户审批。

自建时也不值得从零开发所有底层能力：不需要训练视觉模型，不需要实现浏览器内核，也不需要把鼠标键盘封装成一个万能 API。应把工程投入放在任务状态管理、身份与权限映射、执行隔离、失败恢复、审批和证据链上。Playwright、Chromium、容器或 OS 沙箱可以承担底层执行；企业自己的 Runtime 负责把它们组合成可治理的任务能力。

对大多数企业知识工作场景，先把 File / Code / Connector Runtime 做扎实，再根据真实任务缺口决定是否增加 Browser Use。Computer Use 应作为少数遗留应用的专用能力，而不是 Agent Desktop 的产品起点。

### 5.12 Agent Desktop 的信任边界：可信主机、不可信输入与受控执行

讨论 Agent Desktop 安全时，经常会出现一个过度简化的判断：既然 Agent 能操作桌面，那么整个桌面都应该被视为不可信；或者反过来，Browser Use、Computer Use 和本地文件操作都在同一台机器上运行，因此它们的风险差不多。这两种理解都不准确。

**是否运行在同一台机器，不决定它们是否处于同一个安全边界。** 安全边界取决于进程身份、操作系统权限、可访问资源、凭证范围、执行通道以及策略能否被强制执行。一个隔离的 Chromium 实例即使运行在用户电脑上，也可以只访问专用 Profile 和有限站点；一个与用户同身份运行的桌面 Agent，即使没有 Computer Use，也可能通过本地文件 API、Shell、MCP Server 或浏览器扩展接触大量用户资源。反过来，Computer Use 如果运行在独立桌面会话、专用账号和受限应用集合中，也可以被约束，只是它通常拥有更宽的可观察和可操作范围，因而需要更严格的控制。

因此，不应该把“整台桌面”笼统定义为不可信。需要分别判断三个维度：

| 维度 | 要回答的问题 | 建议的默认判断 |
| --- | --- | --- |
| 执行环境（Host / Runtime Trust） | 操作系统、Agent Runtime、文件代理、浏览器实例和 Connector 是否由组织管理，是否经过加固和验证？ | 受管理的 Host 和 Runtime 可以作为可信基础设施；不受控的插件、扩展、脚本和子进程不能自动继承这种信任 |
| 数据与指令来源（Content Trust） | 文件、邮件、网页、PDF、工具返回值和剪贴板内容来自哪里，是否可能包含恶意指令或伪造信息？ | 外部来源默认不可信；本地文件也不能仅因位于本机就被视为可信 |
| 动作授权（Action Authorization） | 当前 Task 是否有权对特定资源执行读取、修改、发送、删除或提交？ | 每个动作按主体、任务、资源、数据分类和目的地单独授权，不能从“用户本人有权限”推导出“Agent 当前任务有权限” |

这三个维度不能互相替代。可信的桌面应用可以显示不可信网页；不可信 PDF 可以被可信的文档解析器安全读取；可信的 Agent Runtime 也可能因为拿到了过宽的用户权限而执行未经授权的动作。信任应附着在具体主体、数据和动作上，而不是附着在“桌面端”这个产品名称上。

#### 同一台机器，不代表相同风险

Browser Use 和 Computer Use 的差异不在于一个运行在机器里、另一个运行在机器外，而在于它们能触达的资源和执行语义不同。

受控 Browser Runtime 通常可以把操作限制在浏览器进程、专用用户 Profile、指定站点和浏览器下载目录内，并通过 DOM 或 Accessibility Tree 操作页面。它仍然面临网页 Prompt Injection、恶意下载、登录态滥用、跨站数据泄露和上传外传风险，但可以利用浏览器进程隔离、站点权限、Cookie 分区、下载目录和网络代理等控制措施。若直接复用用户日常浏览器 Profile、调试端口或全部登录态，这些边界就会明显弱化。

Computer Use 通过屏幕、键盘和鼠标与桌面交互，可能跨越浏览器、Office、邮件客户端、文件管理器和其他原生应用。它看到的内容可能包括通知、客户资料和其他窗口；它能执行的动作也可能包括复制、粘贴、上传、发送和提交。它未必拥有比用户更高的 OS 权限，却可能把用户已有的广泛权限转化为 Agent 可调用的能力。其风险通常更高，是因为可见范围和可操作范围更广、状态更难准确判断、动作结果更难验证，而不是因为“本机执行”本身天然不安全。

同样，本地 File Runtime 也不天然安全。如果 Agent 进程直接以当前用户身份运行，且能读取整个 Home Directory，那么即使完全没有 Browser Use 和 Computer Use，也可能读取 SSH Key、云凭证、浏览器数据库、下载文件和同步盘内容。只读权限也可能造成数据泄露；没有写权限不等于没有风险。

#### 需要重点防止 Ambient Authority

桌面 Agent 最容易被低估的风险之一，是 Ambient Authority（环境中隐式存在的权限）。用户登录电脑后，操作系统、浏览器和桌面应用已经持有大量用户权限：访问个人文件、连接企业 VPN、读取同步目录、使用已登录的 SaaS 会话、调用本地开发工具等。如果 Agent 直接以同一个 OS 用户身份运行，这些权限可能在没有明确任务授权的情况下被间接继承。

这会形成典型的 Confused Deputy（混淆代理）问题：用户只要求 Agent 总结一份文档，但文档中包含恶意指令；Agent 为完成任务而调用了一个合法工具，最终利用用户已有的登录态，把其他文件或敏感数据发送到外部站点。Agent 并没有破解身份系统，工具也可能没有越权；问题在于系统把“用户能够做”错误地等同于“这个 Agent、这项任务、这个目的地可以做”。

解决方式不是把整个桌面都标记为不可信，而是避免 Agent 自动继承用户的全部环境权限：

- **使用独立的执行身份。** 高风险任务优先使用专用 OS 账号、隔离桌面会话或 VM；普通桌面集成也应尽量通过受控服务提供能力，而不是让模型直接获得当前用户的完整进程权限。
- **通过 Broker 提供窄范围能力。** 文件访问由 File Access Service 代理，业务访问由 Connector 代理，网络访问由受控 Proxy 代理。Agent 获得的是“读取这个工作区中的文件”或“查询这个客户的指定记录”，而不是通用文件系统、任意 HTTP 或用户的全部 OAuth Token。
- **把授权绑定到 Task。** 授权至少包含用户、Agent 身份、Task ID、资源范围、动作、数据分类、目的地和有效期。任务结束、取消或上下文切换后回收临时能力；不能因为用户已经登录某个应用，就自动授权所有任务使用该会话。
- **把读取和外传分开判断。** 允许读取一份客户资料，不代表允许把它上传到任意网站、粘贴到邮件或发送给另一个连接器。跨系统的数据流必须经过数据分类和目的地策略检查。
- **对桌面会话做应用级约束。** Computer Use 使用独立会话或专用账号，限制可见应用和可操作窗口；对密码管理器、身份管理、交易、资金、生产管理等高影响应用默认拒绝，例外必须单独授权。

#### 将信任模型落实到架构

现有的 Execution Profile 不应只是 UI 中的一组权限开关，而应成为 Policy Engine 和各 Runtime 共同执行的策略契约。Agent Runtime 负责提出动作，不直接持有宿主机和下游系统的广泛权限；Policy Engine 根据任务和资源作出决定；各 Runtime 通过操作系统沙箱、专用身份、文件代理、浏览器隔离、Connector scope 和网络代理落实限制。

| 组件 | 信任职责 | 不应承担的职责 |
| --- | --- | --- |
| Desktop Host | 提供受管理的 OS、设备身份、密钥存储和安全更新 | 不应把当前用户的全部权限直接交给 Agent |
| Agent Runtime | 维护 Task 上下文、生成计划、提出工具调用 | 不应自行判定授权，也不应持有长期高权限凭证 |
| Policy & Approval Engine | 评估主体、任务、资源、动作、数据标签和目的地；处理审批与撤权 | 不应只根据模型生成的理由放行 |
| File / Code Runtime | 提供限定工作区、敏感路径拒绝、代码沙箱和执行限制 | 不应默认挂载整个用户目录或继承宿主机网络 |
| Browser Runtime | 使用独立 Profile、站点策略、下载目录和网络出口 | 不应默认接管用户日常浏览器和全部登录态 |
| Computer Use Runtime | 在隔离会话中访问明确批准的应用和桌面动作 | 不应成为绕过 API、文件和浏览器策略的通用后门 |
| Connector Runtime | 以受限身份访问具体业务资源，执行资源级授权和审计 | 不应提供可绕过策略的通用超级账号或任意 HTTP 通道 |

这里有一个重要的工程原则：**策略决定“允许什么”，Runtime 保证“实际只能做什么”。** 如果 Policy Engine 允许 Agent 读取某个目录，但 Agent 进程仍能通过 Shell 读取目录之外的文件，那么策略只是界面承诺；如果审批通过后，执行环境没有限制目标资源和参数，审批也只是记录。安全测试必须验证真实进程、文件句柄、网络流量、浏览器 Profile 和应用会话的边界。

对于大多数 Agent Desktop，合理的默认设计是：受管理的 Desktop Host 可以是可信基础设施；外部内容和工具返回值默认按不可信输入处理；本地应用和 Connector 可以被信任为执行组件，但它们暴露给 Agent 的每项能力仍须独立授权。优先使用结构化 API 和受控 Runtime；Browser Use 与 Computer Use 是按需启用的执行能力，不是产品必须具备的基础组件。

这也修正了前文的一个容易产生误解的地方：不实现 Browser Use 或 Computer Use，不会因此形成更大的安全风险。通常恰恰相反，少开放一条执行通道，就少一类需要治理的攻击面。真正的安全目标不是让 Agent 能控制整台桌面，再试图用提示词约束它；而是让 Agent 在每个 Task 中只获得完成工作所需的最小能力，并且这些能力由执行环境强制限制。

## 6. 多 Agent、Skills 和 Workflow：从任务需要出发，不从概念出发

研究、审核和架构任务有时确实适合拆分。例如，研究任务可以让一个 Agent 检索来源，另一个 Agent 检查方法和数据，第三个 Agent 寻找反例。但多 Agent 会增加上下文传递、成本、延迟和错误归因难度。它不应该成为默认架构。

更适合长期复用的通常是三类资产：

- **Skills**：封装稳定的方法、模板和领域规则，例如财务指标核对、论文方法审查、ADR 生成和合同条款检查。
- **Connectors / Tools**：提供受授权的数据访问和业务操作，接口应保持明确、可测试、可审计。
- **Workflow**：管理有固定阶段、等待、审批、重试和终态的业务过程。

Agent 负责理解任务和处理不确定性；Workflow 负责确定性的状态迁移；业务系统仍然是正式业务记录的权威来源。不要让模型自己维护审批状态，也不要让一个子 Agent 自动继承父 Agent 的全部凭证。每次 handoff 都应传递最小任务上下文、授权范围和预期产物。

## 7. 如何评估是否真的提高了知识工作的质量

使用人数、任务数量和节省时间只能说明系统被使用了，不能证明工作质量有所提高。Agent Desktop 应按具体工作类型建立评估集，保留真实任务中的输入材料、预期证据、可接受输出和失败案例。

| 评估维度 | 建议指标 | 不能用什么替代 |
| --- | --- | --- |
| 事实质量 | 关键事实正确率、引用支持率、数据口径错误率 | 文本流畅度 |
| 任务完成 | 端到端完成率、返工率、人工接管率 | Agent 自报完成 |
| 审核质量 | 错误发现率、重大问题逃逸率、复核修改率 | 审批通过率 |
| 执行安全 | 越权调用、敏感数据外传、未授权写入 | 仅统计被拦截次数 |
| 运营效率 | 完成周期、人工净投入、单位任务成本 | 单次模型响应速度 |
| 可恢复性 | 任务恢复成功率、重复副作用、取消生效率 | 只看服务可用性 |

评估时应使用端到端任务，而不是只测模型回答。一个金融分析任务可能需要正确读取数据、解释指标口径、生成工作簿、保留计算过程并通过分析师复核；其中任何一步失败，都不能算任务成功。对于浏览器和桌面操作，还要覆盖页面变化、登录过期、网络中断、重复点击和部分成功等情况。

上线前至少要做三类红队测试：恶意文档或网页中的间接指令；用户权限不足但 Agent 试图通过其他连接器绕行；Agent 在任务中途修改目标或扩大操作范围。还应验证任务取消后下游动作是否真的停止，审批后参数变化是否重新触发审批，以及重试是否会重复创建工单或发送邮件。

## 8. 推荐的落地顺序

第一阶段选择一个范围明确的团队和任务，例如研究资料整理、架构评审准备或审核证据收集。先提供只读能力，接入少量企业数据源，建立 Task、Workspace、Artifact 和 Evidence 等基本对象，并为结果保留来源和版本。

第二阶段开放草稿写入和少量可恢复的业务操作。明确区分 Read、Draft 和 Submit：先在工作区生成待审查成果，再考虑创建工单、更新草稿状态等动作。审批和审计必须与执行能力同时上线。

跨应用自动化、定时任务和多 Agent 放到第三阶段。只有单 Agent 流程已经具备稳定的质量评估、失败恢复机制和成本数据，才有依据增加并行执行或后台运行。对资金、正式发布、合同生效和监管申报等高影响动作，始终保留业务系统既有的授权和职责分离机制。

## 结论

Agent Desktop 的价值不取决于接入了多少模型、MCP Server 或子 Agent，而取决于它能否把一项工作从任务委托推进到资料核验、成果生成和业务交接。

Claude Cowork 展示了隔离执行、文件工作区和可复用能力的组合；OpenAI 的 Agent、Deep Research 和 Work 则把研究、浏览器操作、企业连接器和桌面工作放进同一产品体系。产品形态不同，但企业落地时都绕不开身份、数据访问、执行权限、审批、证据和责任归属。

实际应用不必从自动决策开始。先让 Agent 把决策前的工作做好：找齐资料、核对数据、形成初稿、标记不确定项，并保留可复查的依据。准确性、可追溯性和失败后的可恢复性，才是判断它能否进入生产环境的标准。

## 研究资料与延伸阅读

### 产品与工程实践

- Anthropic, [How we contain Claude across products](https://www.anthropic.com/research/how-we-contain-claude) — Claude Code 与 Cowork 的执行隔离、沙箱和权限设计。
- Anthropic, [Making Claude Cowork ready for enterprise](https://claude.com/resources/articles/cowork-for-enterprise) — 企业部署、连接器控制和组织运营。
- Anthropic, [Use Claude Cowork safely](https://support.claude.com/en/articles/13364135-use-claude-cowork-safely) — 文件、浏览器、MCP 和跨应用访问风险。
- OpenAI, [ChatGPT Work local security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security) — 本机应用权限、浏览器路径、网络策略、数据留存与审计限制。
- OpenAI, [ChatGPT Work overview](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview) — Work Local、Work Cloud 和本机协同执行的边界。
- OpenAI, [ChatGPT Work cloud security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security) — 云端执行、连接器权限和数据留存。
- OpenAI, [Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/) — 研究与行动结合、虚拟计算机和用户接管。
- OpenAI, [ChatGPT Enterprise and Edu release notes](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes) — Work、Workspace Agents、管理员分析和审计能力演进。

### 学术研究

- [Bias in the Loop: How Humans Evaluate AI-Generated Suggestions](https://hdsr.mitpress.mit.edu/pub/nrcn4h7d/release/2) (Harvard Data Science Review, 2026) — 基于 2,784 名参与者的随机实验，研究建议质量、纠错成本和个体差异如何影响人类对 AI 建议的判断。
- [Putting a human in the loop: Increasing uptake, but decreasing accuracy of automated decision-making](https://pmc.ncbi.nlm.nih.gov/articles/PMC10857587/) (2024) — 实验研究人工参与自动化决策后，建议采纳与最终准确率之间并非简单正相关。
- [Engaging with AI: How Interface Design Shapes Human-AI Collaboration in High-Stakes Decision-Making](https://arxiv.org/abs/2501.16627) (2025) — 研究高风险决策中的界面设计、自动化偏差和人类判断。
- [What to Delegate, What to Preserve: Human Preferences for Agentic AI Across Everyday Life and Work](https://arxiv.org/abs/2611.09730) (2026) — 对 289 名有 AI 使用经验的美国成年人开展情景调查，分析不同工作和生活任务中的委托偏好。该研究是情景调查，不等同于真实企业部署结果。

这些研究提供的是人机协作和委托边界的证据，不应被直接解读为某个 Agent Desktop 产品的生产成功率。产品能力、学术实验和企业生产结果需要分别评价。
