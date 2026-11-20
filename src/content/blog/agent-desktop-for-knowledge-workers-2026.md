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

如果把 Agent Desktop 理解成一个带文件访问、MCP 和多个 Agent 的聊天窗口，很容易做出一个看起来很强、但无法进入企业日常工作的产品。金融分析师需要核对数据口径和来源，研究员需要整理论文与形成可复查的结论，架构师需要把需求、系统现状和设计决策关联起来，审核员则必须知道每项判断依据了什么材料、谁批准了什么动作。这些工作都不是单轮问答，也不是简单的自动化脚本。

Agent Desktop 更准确的定位，是知识工作者的任务工作台（Knowledge Work Environment）。用户把一个有边界的目标交给 Agent，Agent 在授权范围内读取资料、调用企业系统、分析和生成交付物；用户能够观察进度、纠正方向、审查证据，并在关键节点作出决定。最终产物不应只是一段回答，而应是可以继续编辑、复核、共享和追溯的工作成果。

Claude Cowork 与 OpenAI ChatGPT 的 Agent、Deep Research 和 Work 产品，已经展示了这类工作环境的不同组成部分。它们的产品边界仍在快速变化，不能把某个版本的 UI 或功能清单当作长期架构。本文关注这些产品公开展示的设计选择，以及它们暴露出的工程问题。

## 1. 产品实践：Claude 和 OpenAI 分别解决了什么问题

### Claude：把开发者的 Agent 执行能力带到知识工作

Anthropic 在 2026 年把 Claude Cowork 推向更广泛的企业用户。公开描述的典型任务包括研究冲刺、项目材料、协作演示文稿、数据整合和跨应用工作。其产品组合把文件工作区、Connectors、Skills、Plugins、子任务和较长时间运行的任务结合起来。Anthropic 在 [2026 年 4 月的企业公告](https://claude.com/resources/articles/cowork-for-enterprise)中提到，Cowork 的大量使用来自工程以外的团队，包含运营、市场、金融和法律职能；这些团队首先把周边研究、材料准备和协作任务交给 Agent，而不是直接交出核心业务决策。

这对产品设计有两个启发。第一，用户不应该先学习 Agent Framework、MCP 或 Prompt Engineering 才能开始工作。用户描述任务和交付标准，系统再把任务映射到可用工具和工作流。第二，工作成果需要落在用户熟悉的文件和业务应用中，例如 Excel、PowerPoint、文档库、工单系统和知识库，而不是只留在聊天记录里。

Anthropic 在 2026 年 11 月还开始向 Enterprise 组织推出统一的 Claude 体验：对话从普通 Chat 开始，任务需要文件或代码执行时再进入 Cowork 的隔离云端环境，用户不必先理解产品模式差异。这个变化说明桌面 Agent 的入口正在从“选择工具”转向“描述工作”，但执行环境切换、连接器权限和本地文件桥接仍必须保持可见。参见 [统一 Claude Enterprise 体验的管理说明](https://support.claude.com/en/articles/17444462-set-up-and-manage-the-new-unified-claude-experience-for-your-enterprise-organization)。

Anthropic 的另一项公开资料更值得架构师仔细阅读：[How we contain Claude across products](https://www.anthropic.com/research/how-we-contain-claude)。它比较了 Claude Code 与 Cowork 的安全边界。开发者通常能够判断 Shell 命令和代码修改是否合理，因此 Claude Code 可以把一部分权限判断交给用户；普通知识工作者未必能判断命令行行为是否危险，Cowork 因此采用更强的隔离边界。Anthropic 描述的 Cowork VM 将用户明确选择的工作区挂载到隔离环境，凭证留在宿主机，Agent 不应因为一次任务就获得整台电脑的访问权。

这不是简单地“多弹几个确认框”。Anthropic 在[安全架构研究](https://www.anthropic.com/research/how-we-contain-claude)中披露，Claude Code 的 OS 沙箱将权限提示数量减少了 84%。这组数据来自厂商自己的使用与工程披露，不是独立对照实验，但它说明了一个实际问题：逐次询问用户并不天然等于有效监督。权限提示过多会形成审批疲劳，用户可能不再认真阅读。

### OpenAI：把研究、浏览器操作和桌面工作整合起来

OpenAI 在 [2025 年推出 ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/)，将研究和行动组合到一个任务中：Agent 可以使用自己的虚拟计算机浏览网站、运行代码、分析资料，并在连接器允许的范围内访问第三方数据。产品说明也强调用户可以中断任务并接管浏览器。此后，Deep Research 继续强化多来源研究与报告生成；企业连接器将 SharePoint、Google Drive、Slack 等系统的数据带入任务；OpenAI 在[2026 年 7 月的企业版本更新记录](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes)中宣布新的 ChatGPT Desktop 将 Chat、Work 和 Codex 放到统一桌面入口，Work 在获得用户许可后可以使用本地文件和桌面应用。

OpenAI 的企业产品实践有一个值得注意的方向：除了单次 Agent 任务，Workspace Agents 开始支持组织创建可复用的工作流程，并在 ChatGPT 或 Slack 中运行。2026 年企业版本更新还增加了管理员分析视图、Agent 活动信息和审计日志能力。换句话说，产品正在从个人助手走向组织可以管理的工作资产。

但产品能力与企业可治理性仍然要分开判断。OpenAI 的[企业发布说明](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes)列出了 Workspace Agents、RBAC、连接器交互分析和 Global Admin Console 审计事件；这并不意味着每一个 Agent 在每个下游系统中的动作都已经被同一条审计链完整覆盖。实际部署仍需检查 Compliance Logs Platform、Agent 事件范围以及目标 SaaS 自身的审计日志，并将它们关联起来。

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
| 安全设计公开重点 | Cowork VM、工作区挂载、网络与连接器边界 | 虚拟计算机、任务接管、工作区权限与企业控制 |
| 运营可见性 | OpenTelemetry、Compliance API、组织分析 | Compliance Logs Platform、Admin Audit、Agent 与连接器分析 |

这张表比较的是公开产品方向，不是功能完整度或安全性排名。两家产品的功能和计划可用性变化很快，采购或落地前必须以当时的官方文档、租户配置和合同能力为准。

## 2. Agent Desktop 的核心架构

Agent Desktop 不应该自己实现一套企业身份、权限、数据目录和流程引擎。它更适合成为统一的工作入口与执行协调层，复用企业已有的 IAM、文档平台、数据平台、Workflow、API Gateway、审计和 DLP 能力。

![Agent Desktop 参考架构：工作台、Agent Runtime、企业控制平面和业务系统](/diagrams/agent-desktop-knowledge-work-architecture.svg)

用户界面层负责任务创建、上下文选择、执行观察、结果审查和交付物管理。Agent Runtime 负责计划、模型调用、工具路由、上下文组装、长任务状态和恢复。企业控制平面负责身份、策略、工具目录、模型准入、风险等级、审批和审计。连接器与工具层则把 SharePoint、Confluence、Snowflake、CRM、ServiceNow、邮件和浏览器等系统暴露为受控能力。

这些职责可以先部署在一个应用中，不必为了架构图而拆成大量微服务。关键是运行时边界清晰：UI 不直接持有下游系统的高权限凭证，模型不直接决定授权结果，Agent 也不能通过 Prompt 绕过业务系统的权限检查。

### 2.1 以 Task 为中心，而不是以 Chat 为中心

聊天记录适合保存交互，但不足以代表一项正式工作。建议把 Task 作为一等对象，至少包含目标、业务上下文、发起人、责任人、输入资料、授权范围、执行状态、产物、证据引用、审批记录和运行轨迹。

Task 可以跨多个会话继续执行，也可以暂停等待人工输入、审批或外部事件。用户打开桌面端时，看到的应该是正在进行的工作、等待自己处理的事项、已完成的交付物和可复用的工作模板，而不是一长串没有业务状态的对话。

Task 的正式状态应由 Runtime 或 Workflow 管理，不能仅依赖模型在聊天中声称“已经完成”。例如，Agent 生成了合同审查报告，只能说明分析产物已生成；只有当报告经过指定审核人批准并归档到正式系统，业务流程才算完成。

### 2.2 工作区与上下文必须有明确边界

用户选择一个项目、客户或研究主题作为工作区时，系统需要明确展示该工作区包含哪些文件、数据源和连接器。工作区不应该隐式继承整台设备的文件权限，也不能把一个任务的敏感上下文自动带入另一个客户或项目。

本地文件访问、云端执行和连接器访问是三种不同的数据路径。它们有不同的安全边界、日志位置和网络控制方式。Claude Cowork 的 VM 设计说明了为什么“用户选中的文件夹”比“Agent 可以读取整台电脑”更合理。OpenAI 的虚拟计算机模式则说明，云端浏览器和本地桌面操作不应该混为一谈。产品必须明确告诉用户：当前任务在哪里执行、能访问哪些文件、哪些连接器已启用、输出会保存到哪里。

## 3. 非开发团队真正需要的工作体验

### 金融分析师：数据口径比生成图表更重要

分析师常见任务是准备市场或公司研究、解释业绩变化、比较多个投资标的、分析组合敞口和形成投资委员会材料。Agent 可以帮助收集公开信息、查询授权数据集、运行计算、制作 Excel 和演示文稿，但不能把“找到一个数字”当作分析完成。

每个关键数字都应保留来源系统、查询时间、指标定义、币种、单位、期间、过滤条件和计算逻辑。若数据来自 Snowflake Semantic View 或受治理 SQL，交付物应引用查询或数据集版本，而不是只附一段模型生成的解释。估值假设、风险判断和投资建议必须标明是用户输入、模型推断还是外部事实。正式交易、资金划转和投资组合变更不应由普通研究 Agent 直接执行。

### 研究员：从资料汇总转向可复查的研究过程

研究工作不只是搜索和摘要。研究员需要管理问题定义、检索范围、来源质量、论文版本、证据冲突、引用和研究结论。Agent 应支持保存检索策略、来源快照、引用片段、研究笔记和报告版本。它可以提出新的检索方向、对比不同论文的方法和结果，但不能把摘要当成全文，也不能把预印本当作经过同行评审的最终论文。

研究工作台最好允许用户从一个结论反向追溯到支持它的原始段落，并把未解决的问题保留在报告中。多 Agent 可以分别负责检索、方法审查和反方论证，但最终证据账本应由统一的任务上下文维护，避免各个 Agent 引用不同版本的材料。

### 架构师：让设计决策与系统事实关联

架构师可以把需求、现有系统清单、数据流、ADR、技术债、接口契约和运行指标放到一个项目工作区。Agent 可以生成系统依赖分析、方案比较、风险登记和 ADR 草稿，也可以调用 CMDB、LeanIX、GitHub、Confluence 或云平台工具验证系统现状。

这里最重要的是区分“系统记录的事实”和“Agent 推断”。例如，CMDB 中登记的应用依赖关系是一项有来源的事实；根据仓库调用关系推断出的潜在依赖则应标记为待验证。架构师需要的是能帮助自己做判断的证据和反例，而不是一个自动替自己宣布架构结论的 Agent。

### 审核员：把检查标准变成可执行、可追溯的流程

审核工作最适合采用结构化任务模板：检查范围、适用规则、必需证据、例外条件、发现项、严重程度、复核意见和最终结论。Agent 可以执行资料完整性检查、规则匹配、异常筛查和报告草拟，但每项发现必须链接原始证据，并说明规则版本和判断过程。

审核员不应只看到“合规/不合规”两个标签。系统需要显示缺失材料、冲突证据、规则适用性和需要人工判断的事项。对于监管申报、正式审计意见、客户风险评级和例外批准，Agent 可以准备材料，但最终签署和责任归属仍应由授权人员完成。

## 4. 自主权设计：不要只有一个“自动执行”开关

Agent Desktop 最危险的设计之一，是把所有任务放在同一种权限模式下。读一份公开报告、修改本地草稿、给客户发送邮件和更新生产系统记录，风险并不相同。

更合理的方式是把自治程度绑定到动作风险，而不是绑定到用户是否信任某个 Agent。

| 等级 | Agent 可以做什么 | 典型任务 | 控制方式 |
| --- | --- | --- | --- |
| L0 建议 | 只分析和提出建议 | 方案比较、风险分析 | 不产生外部副作用 |
| L1 读取 | 读取授权数据并生成产物 | 文档检索、数据分析 | 继承用户权限，记录数据来源 |
| L2 草拟 | 修改工作区内的草稿 | 报告、Excel、ADR 草稿 | 版本控制、差异审查 |
| L3 受控写入 | 对指定系统执行有限写操作 | 创建工单、更新草稿状态 | 工具级策略、参数校验、必要时审批 |
| L4 高影响操作 | 产生不可逆或重大业务影响 | 对外发送、正式发布、交易或申报 | 明确授权、职责分离、双人复核或人工执行 |

审批不能只显示“Agent 想调用 update_record”。审批界面应展示目标对象、变更前后差异、影响范围、数据依据、执行身份和撤销方式。审批应绑定具体参数与目标资源；Agent 如果在审批后改变了内容，就必须重新审批。

![Agent Desktop 的风险分级与人工审批流程](/diagrams/agent-desktop-risk-and-approval-flow.svg)

### 4.1 审批疲劳与 Human-in-the-loop 的局限

“有人点了批准”并不等于有人真正检查过。Anthropic 关于 Claude Code 权限提示和 Cowork 隔离机制的讨论，已经说明逐项授权可能形成疲劳。学术研究也反复发现，人们可能过度依赖算法建议，尤其在时间压力、任务负担和界面锚定影响下。

2025 年的[《Bias in the Loop: How Humans Evaluate AI-Generated Suggestions》](https://arxiv.org/abs/2509.08514)使用 2,784 名参与者研究 AI 建议质量、任务负担等因素对人类判断的影响；[《Putting a human in the loop: Increasing uptake, but decreasing accuracy of automated decision-making》](https://pmc.ncbi.nlm.nih.gov/articles/PMC10857587/)则通过实验指出，让人参与调整自动化建议可能提高接受程度，却不保证最终准确率提高。这些研究不是企业 Agent Desktop 的直接生产评估，但它们提醒我们：人工参与必须设计成真实的判断过程，而不是审批按钮。

界面应帮助人发现值得检查的地方，例如显示关键证据、冲突数据、置信度不足的环节、异常变化和未满足的规则。对于高风险判断，可以先让审核人独立给出初步结论，再展示 Agent 的建议，降低锚定效应。审批数量、审批耗时和批准率不能单独作为效率指标；还应测量抽检发现的错误、人工修改比例、撤销率和重大问题逃逸率。

## 5. 安全边界：非开发用户不应该被迫理解底层风险

### 5.1 Prompt Injection 是数据访问问题，也是执行权限问题

Agent 会读取邮件、网页、PDF、文档和工单。这些内容可能包含恶意或误导性指令。只要模型能够把外部内容当作指令，并且同时拥有文件、浏览器或连接器写权限，就可能发生跨系统数据泄露或非预期操作。

不能只靠 Prompt 写一句“忽略文档中的恶意指令”。工具输出、网页内容和文档内容都应视为不可信数据。真正的防线在执行层：文件系统隔离、连接器 allowlist、网络 egress 策略、工具级授权、敏感数据检测、写操作确认和输出目的地控制。尤其需要检查 Agent 是否能把一个有权限读取的数据源内容，通过另一个被允许访问的外部服务传出去。

### 5.2 用户权限、Agent 身份和工具权限必须分开

一次操作至少要能关联发起用户、Agent、运行任务、工具身份、目标资源、策略决策和审批记录。读取数据时优先继承用户授权（delegated access），后台任务则使用范围受限、可撤销的 workload identity。不要让所有 Agent 共用一个可以访问多个系统的超级账号。

MCP 只是工具集成协议，不是授权系统。每个连接器仍需明确数据范围、读写能力、凭证生命周期和责任人。工具描述与返回内容也属于不可信输入，需要经过版本审查和策略控制。

### 5.3 需要完整的运行审计，而不只是保存对话

企业需要能够回答：谁发起了任务、当时使用哪个模型和配置、Agent 读取了哪些数据、调用了什么工具、哪些动作被批准或拒绝、产生了哪些文件、最终结果是否被业务系统接受。

建议采用统一的 Task ID / Trace ID，将模型调用、工具调用、数据访问、文件读写、审批和下游系统审计事件关联起来。OpenTelemetry 适合承载运行指标和调用轨迹；合规日志则需要按组织的留存、访问和法律保全要求管理。不要默认把完整敏感 Prompt 和数据内容无限期写入通用日志。应区分元数据、内容审计和业务系统自身的正式记录。

## 6. 多 Agent、Skills 和 Workflow：从任务需要出发，不从概念出发

研究、审核和架构任务有时确实适合拆分。例如，研究任务可以让一个 Agent 检索来源，另一个 Agent 检查方法和数据，第三个 Agent 寻找反例。但多 Agent 会增加上下文传递、成本、延迟和错误归因难度。它不应该成为默认架构。

更适合长期复用的通常是三类资产：

- **Skills**：封装稳定的方法、模板和领域规则，例如财务指标核对、论文方法审查、ADR 生成和合同条款检查。
- **Connectors / Tools**：提供受授权的数据访问和业务操作，接口应保持明确、可测试、可审计。
- **Workflow**：管理有固定阶段、等待、审批、重试和终态的业务过程。

Agent 负责理解任务和处理不确定性；Workflow 负责确定性的状态迁移；业务系统仍然是正式业务记录的权威来源。不要让模型自己维护审批状态，也不要让一个子 Agent 自动继承父 Agent 的全部凭证。每次 handoff 都应传递最小任务上下文、授权范围和预期产物。

## 7. 如何评估是否真的提高了知识工作的质量

只统计使用人数、任务数量和节省时间，很容易把“生成得更快”误认为“工作做得更好”。Agent Desktop 应按具体工作类型建立评估集，保留真实任务中的输入材料、预期证据、可接受输出和失败案例。

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

第一阶段先做只读研究和文档工作。选择一个边界清晰的团队和任务，例如研究资料整理、架构评审材料准备或审核证据收集。接入少量企业数据源，建立 Task、Workspace、Artifact 和 Evidence 的基本对象，所有结果都保留来源和版本。

第二阶段再引入草稿写入和有限业务操作。把 Read、Draft、Submit 分开，先在工作区内生成可审查的产物，再逐步开放创建工单、更新草稿等可恢复动作。审批和审计需要与工具执行路径一起上线，不能等到出现事故后再补。

第三阶段才考虑跨应用自动化、定时任务和多 Agent。只有当单 Agent 工作流已经有稳定的质量评估、失败恢复和成本数据时，才值得增加并行 Agent 或后台自动运行。对资金、正式发布、合同生效和监管申报等高影响动作，始终保留业务系统既有的授权和职责分离机制。

## 结论

Agent Desktop 的竞争力不在于接入多少模型、多少 MCP Server 或多少 Agent，而在于能否让知识工作从“提出问题、得到回答”变成“委托任务、检查证据、形成成果、完成业务交接”。

Claude Cowork 展示了知识工作场景下的隔离执行和可复用工作能力；OpenAI 的 Agent、Deep Research 和 Work 展示了研究、浏览器操作、企业连接器与桌面工作逐步融合的产品方向。它们共同说明，Agent 正在从聊天工具进入真实工作流，但企业仍然需要自己定义数据边界、权限、审批、证据和责任。

对于金融、研究、架构和审核团队，最合适的第一步不是让 Agent 自动作出最终决策，而是让它可靠地完成决策之前的大量工作：找齐资料、核对数据、形成初稿、标注不确定性、准备可复查的证据。能否把这些工作做得准确、可追溯、可恢复，才是 Agent Desktop 是否真正进入企业生产环境的判断标准。

## 研究资料与延伸阅读

### 产品与工程实践

- Anthropic, [How we contain Claude across products](https://www.anthropic.com/research/how-we-contain-claude) — Claude Code 与 Cowork 的安全边界、沙箱和权限提示经验。
- Anthropic, [Making Claude Cowork ready for enterprise](https://claude.com/resources/articles/cowork-for-enterprise) — 企业角色、连接器动作控制、OpenTelemetry 和组织采用情况。
- Anthropic, [Use Claude Cowork safely](https://support.claude.com/en/articles/13364135-use-claude-cowork-safely) — 文件、浏览器、MCP 和跨应用数据访问风险。
- OpenAI, [Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/) — 研究与行动结合、虚拟计算机和用户接管。
- OpenAI, [ChatGPT Enterprise and Edu release notes](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes) — Work、Workspace Agents、管理员分析和审计能力演进。

### 学术研究

- [Bias in the Loop: How Humans Evaluate AI-Generated Suggestions](https://arxiv.org/abs/2509.08514) (2025) — 基于 2,784 名参与者的随机实验，研究建议质量、任务负担和个体差异如何影响人类对 AI 建议的判断。
- [Putting a human in the loop: Increasing uptake, but decreasing accuracy of automated decision-making](https://pmc.ncbi.nlm.nih.gov/articles/PMC10857587/) (2024) — 实验研究人工参与自动化决策后，建议采纳与最终准确率之间并非简单正相关。
- [Engaging with AI: How Interface Design Shapes Human-AI Collaboration in High-Stakes Decision-Making](https://arxiv.org/abs/2501.16627) (2025) — 研究高风险决策中的界面设计、自动化偏差和人类判断。
- [What to Delegate, What to Preserve: Human Preferences for Agentic AI Across Everyday Life and Work](https://arxiv.org/abs/2611.09730) (2026) — 对 289 名有 AI 使用经验的美国成年人开展情景调查，分析不同工作和生活任务中的委托偏好。该研究是情景调查，不等同于真实企业部署结果。

这些研究提供的是人机协作和委托边界的证据，不应被直接解读为某个 Agent Desktop 产品的生产成功率。产品能力、学术实验和企业生产结果需要分别评价。
