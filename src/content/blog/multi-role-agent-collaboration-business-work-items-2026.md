---
author: W
featured: false
draft: false
description: 从 A2A 通信走向以 Business Work Item 为中心的多人协作平台，梳理参与关系、任务、产物、评审、Human 决策、Workflow、协议适配和多种 Agent Runtime 的职责边界。
pubDatetime: 2026-11-22T03:00:00Z
title: 从 A2A 到共享业务事项：多角色 Agent 协作架构怎么设计
tags:
  - ai
  - agent
  - a2a
  - mcp
  - acp
  - work-item
  - collaboration
  - workflow
  - architecture
  - case-management
---

# 从 A2A 到共享业务事项：多角色 Agent 协作架构怎么设计

多角色 Agent 协作很容易从一个错误的问题开始：怎样让几个 Agent 互相通信、共享对话，再由一个协调 Agent 分配工作。这个思路适合研究 Agent 的协作方式，却不足以支撑真实业务。

在企业里，架构评估、风险调查、数据申请、变更审批和合规审查往往持续数天甚至数月。参与者会变化，有人提交材料，有人负责分析，有人独立评审，有人提供专业意见，最后由具备组织授权的人作出决定。有人使用网站，有人使用 Copilot 或 Claude Code，也有人完全不用 Agent。每个人不必同时在线，工作也不会因为某个模型会话结束而终止。

系统需要长期保存的是这件业务本身，以及参与关系、待办、材料版本、正式意见和决定。Agent 通信只是其中一条执行路径。

本文把这个长期存在的业务对象称为 **Business Work Item（业务事项）**。设计围绕 Work Item 展开，A2A、MCP、ACP 和各类 Agent Runtime 则放在各自应该承担的边界内。

## 1. 协作的中心是业务事项，不是 Agent 会话

以一项跨部门架构评估为例。Requester 提交问题和业务背景，Architect 负责分析，Security 或 Data Specialist 根据发现的问题加入，Reviewer 独立检查分析结果，Business Owner 或 Approver 最终确认决定。实际参与人由事项的目标、阶段和授权关系决定。同一个人在一项工作中可以是 Requester，在另一项工作中也可能是 Reviewer。

参与者还可能使用完全不同的工具。分析师在本地 IDE 中用 Copilot，安全专家通过 Claude Code 检查配置，业务负责人只登录网站查看材料和批准结果。几天后，某位参与者补充新事实，系统需要继续推进原来的事项，而不是重新创建一场 Agent 对话。

这类协作需要几个稳定的业务事实：事项的身份和当前目标、参与者在事项中的责任、每项工作的执行者和状态、交付材料的版本、独立评审的对象，以及正式决定由谁作出。它们需要跨越用户、Runtime 和会话而长期存在。

A2A 解决的是 Agent 服务之间的互操作。它定义了 Agent Card、Message、Task、Artifact 和 Context 等协议对象，支持远端 Agent 接收任务、报告进度和返回结果。A2A 的 `contextId` 用来组织相关 Task 和 Message，保持一组交互的上下文连续性；它并不因此成为一个具有组织成员、授权、业务状态、版本基线和审计规则的工作空间。参见 [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)。

因此，不能把 A2A Context ID 当作 Work Item ID，也不能把一组 Agent 放进 Group Chat 就认为完成了业务协作设计。一个 Work Item 可以对应多个内部 Task、多个远端 A2A Task 和多个 Runtime Session。通信协议负责把工作送到执行方，业务平台负责决定这项工作属于哪件事、由谁负责、结果能否被接受。

## 2. Work Item 领域模型：参与、执行、交付和决定分开记录

Work Item 是业务协作的根对象。它拥有稳定 ID、类型、标题、目标、发起组织、当前状态、优先级、期限和上下文版本。它不属于某个 Agent，也不应因为最初提交人离职、换组或切换 Runtime 而改变身份。

Participation 描述某个主体以什么身份参与当前事项。主体（Principal）可以是 Human、正式的 Agent Service Identity，也可以是组织或团队。Participation 将 Principal、Work Item、Role、Scope 和有效期关联起来。角色属于事项上下文，不是用户的全局属性。某个用户在一项工作中是 Requester，在另一项工作中可能是 Reviewer；系统不能仅凭全局职位或 Agent 自我声明推导出当前事项的权限。

Task 表示一项可执行的工作，例如需求澄清、架构分析、安全检查、数据影响分析或评审。一个 Work Item 通常包含多个并行或串行 Task。Task 应记录类型、输入版本、责任主体、执行者、截止时间、依赖和状态。这里需要区分业务责任人与实际执行者：Human 可以对 Task 负责，Agent 在被授权的范围内完成资料整理或分析；Agent Session 结束不意味着业务责任也随之结束。

Artifact 是有版本的工作产物，例如报告、架构图、风险清单、证据包或评审材料。系统应保存版本号、创建者、输入来源、内容哈希和必要的关联关系。修改应产生新版本，而不是覆盖旧内容。Review 必须绑定具体的 Artifact Version 或一次正式提交的材料基线。若报告从 v3 更新到 v4，针对 v3 的评审不能自动成为 v4 的批准。

多人评审需要比单个 `reviewed=true` 字段更明确的模型。可以用 Review Request / Review Cycle 固定一次评审的目标、范围、材料基线、参与人和适用规则，再由不同 Reviewer 独立提交 Review。这样能支持并行评审、复审和分阶段会签，也能防止一个 Reviewer 的意见覆盖另一个人的意见。若一次提交包含报告、架构图、数据结果和 ADR，可以使用 Submission / Manifest 固定本次提交包含的 Artifact Version 集合。

Decision Draft 和正式 Decision 必须是两个对象。Agent 可以整理选项、推荐意见、理由和风险，生成 Decision Draft；被授权的 Human 审阅后，才能确认或修改草案并记录正式 Decision。正式记录应包含决定人、授权依据、适用范围、确认时的草案版本、输入材料版本和时间。系统可以在 Human 决定后自动更新状态、创建后续任务和发送通知，但这些动作属于确定性流程执行，不代表 Agent 获得了决定权。

Work Session 则用于记录某个参与者围绕 Task 实际开展的一段工作。一个 Task 可以先后由 Human、Copilot、Claude Code 或网站 Agent 处理，因此可能存在多个 Session。Session 是 Runtime 和工作过程概念，Task 是业务工作单元，Work Item 才是跨工具和时间持续存在的业务对象。并非每个纯人工任务都必须创建 Work Session；当需要跨 Runtime 接力、等待恢复或记录 Agent 执行元数据时再使用即可。

这几个对象之间的关系决定了系统能否支持真正的多人协作：

| 对象 | 回答的问题 | 主要权威信息 |
| --- | --- | --- |
| Work Item | 组织正在处理哪件事？ | 事项身份、目标、状态和上下文版本 |
| Participation | 谁以什么身份参与？ | Principal、Role、Scope、有效期 |
| Task | 当前需要完成什么工作？ | 责任人、执行者、输入版本、状态和期限 |
| Artifact / Submission | 交付了什么，基于哪一版材料？ | 产物版本、来源、内容哈希和提交基线 |
| Review | 谁对哪个对象和版本发表了正式意见？ | Reviewer、范围、发现和评审结果 |
| Decision Draft / Decision | 建议是什么，谁作出了正式决定？ | 草案版本、决定人、授权依据和决定结果 |
| Work Session | 人或 Agent 如何执行了这项工作？ | Runtime、执行方式、输入版本和工作活动 |

不要把这些概念压缩成一个 Agent Session 或一条聊天记录。聊天适合讨论，不能替代业务对象和正式记录。

## 3. 共享上下文和流程：不同参与者看到同一件事的不同视图

Work Item 的 Context 不应等于完整聊天历史。正式业务事实、待验证假设、临时工作笔记、正式产物、决定记录、活动历史和讨论线程需要分开保存。尤其要明确哪些内容已经确认，哪些只是 Agent 的推断，哪些是尚未验证的假设。否则后续参与者容易把一条讨论意见误读成已确认的业务约束。

不同参与者对同一个事项也不应默认拥有相同的可见内容。Requester、Reviewer、Security Specialist 和 Analyst Agent 所需的信息不同。平台应根据 Principal、Participation、Task、数据分类和委托授权生成 Context View。上下文投影应有可追踪的版本或快照标识，Agent 提交结果时要说明自己实际读取了哪些输入版本。

交给外部 Agent 的上下文可以封装成 Context Capsule。它只包含本次 Task 需要的事项引用、目标、已确认事实、约束、输入 Artifact Version、预期输出和提交方式，不把整个聊天记录和所有附件打包给模型。敏感材料优先提供受控引用，外部 Agent 访问时仍然由服务端单独校验权限。

流程需要区分三个层次。**Business Workflow** 负责 Work Item 的正式生命周期、状态转换、审批门槛、SLA 和升级路径；**Collaboration Workflow** 管理参与者之间的任务分配、认领、补充、评审、交接和冲突处理；**Agent Execution Workflow** 负责 Agent 内部的计划、工具调用、并行执行、重试和上下文管理。三者有关联，但状态不能混在一起。

例如，业务流程可以把事项推进到“待评审”，协作层随后创建一个独立 Reviewer Task，Agent Runtime 则在某个 Task 内运行多轮分析。Agent 的内部执行状态不能成为 Work Item 的唯一业务状态来源。某个模型执行成功，只说明一次计算或工作过程结束，不意味着业务产物已经被接受，更不意味着评审或审批完成。

Work Item 的状态可以保持相对稳定，例如 Draft、Ready、In Progress、Review、Decision 和 Closed。具体的等待原因应由 Task / Workflow 层持久化，例如等待 Requester 补充材料、等待 Reviewer、等待 Human Approval 或等待远端 Agent。等待状态必须能在服务重启和参与者离线后恢复，不应靠一个长期占用线程的 Agent 进程维持。

![Work Item 的业务生命周期](/diagrams/work-item-lifecycle.svg)

[单独查看生命周期图](/diagrams/work-item-lifecycle.html)

一次典型协作会经历：提交事项、受理和分配 Task、分析 Agent 提交 Artifact v1、独立 Reviewer 对 v1 评审、需要时生成修订 Task 并提交 v2、Reviewer 针对新版本复审，最后由授权 Human 确认正式决定。流程可以包含更多 Specialist 或临时活动，但不应该为了每一种参与人组合都增加新的核心对象。

![一个业务事项如何经过多角色协作](/diagrams/work-item-collaboration-sequence.svg)

[单独查看协作时序图](/diagrams/work-item-collaboration-sequence.html)

角色也必须与能力和权限分开。Requester、Business Owner、Analyst、Reviewer、Specialist、Approver 和 Observer 描述的是常见责任，不是固定用户类型。实际业务可以配置不同角色和组合。某个参与人能否添加其他参与者、修改目标、认领任务或确认评审，应由 Work Item 类型、当前状态、组织策略和授权规则共同决定。角色名称本身不是权限控制。

独立评审尤其不能只靠给另一个 Agent 换一个 Reviewer Prompt。Reviewer 应获得独立 Task 和合适的 Context View，能够看到业务输入、被评审的 Artifact 和必要证据。是否能正式确认 Review Outcome 则取决于组织授权；Agent 可以辅助分析和整理 Findings，但不能仅靠被命名为 Reviewer Agent 就获得正式会签资格。

## 4. 参考架构：协议入口统一，业务状态集中持有

平台不需要为每个 Agent Runtime 建一套业务系统。Web UI、Remote MCP、REST 客户端和本地 Connector 应复用同一组 Application Service；远端 Agent 则通过 A2A Adapter 参与被委托的 Task。身份、事项级授权、版本检查和审计应集中在业务服务边界。

![共享业务事项的参考架构](/diagrams/work-item-architecture.svg)

[单独查看架构图](/diagrams/work-item-architecture.html)

架构的业务核心是 Work Item Service。它拥有 Work Item、Participation、Task、Artifact、Review、Decision Draft、Decision 和业务活动记录。Workflow / Task Runtime 管理长时间运行的业务流程、任务分配、等待、定时器和状态推进。Identity / Policy 负责 SSO、Agent 身份、委托授权、角色范围和动作检查。Agent Gateway 或 Runtime Adapter 负责调用内部或外部 Agent，并把执行结果作为 Task Result 或 Artifact 提交回来。

持久化可以从关系数据库开始。Work Item、Participation、Task、Artifact、Review、Decision 和 Workflow Instance 保存结构化业务状态；大文件和 Artifact 正文放对象存储，数据库保存版本、内容哈希、访问标签和引用。Activity / Audit Event 记录经过服务端验证的业务动作。Agent Trace 记录模型执行和工具调用过程，二者不应混成同一份审计账本。

服务之间可以通过领域事件协作，例如 WorkItemCreated、ParticipationChanged、TaskAssigned、ArtifactSubmitted、ReviewRequested、ReviewCompleted 和 DecisionRecorded。事件用于通知、工作分配、搜索投影或 Agent 唤醒；正式状态变更仍通过受控命令入口完成。数据库事务与事件发布之间可以采用 Transactional Outbox，消费者使用幂等键处理重复消息，防止数据库更新成功而通知丢失。

这个架构不要求第一阶段就拆分成多个微服务。核心领域边界可以先在一个模块化应用中实现，随着并发、组织隔离或独立扩展需求出现，再拆分 Work Item、Workflow、Agent Gateway 和 Audit 等服务。业务契约和权限边界应先稳定，部署形态可以渐进演进。

## 5. 协议和 Runtime：不要让接入方式决定业务模型

REST/OpenAPI 应是平台稳定的业务接口。Web UI、CLI、移动端、Connector 和其他系统都可以调用它。MCP 可以把其中适合 Agent 使用的读取和工作提交操作包装成 Tools 或 Resources；A2A 用于独立 Agent 服务之间的任务委托；ACP（Agent Client Protocol）用于支持它的本地 Coding Agent Runtime 与 IDE / Client 之间的会话交互。它们解决的不是同一个问题。

| 接口或协议 | 适合承担的职责 | 不应承担的职责 |
| --- | --- | --- |
| REST / OpenAPI | Work Item、Task、Artifact、Review 和 Decision 的稳定业务 API | Agent 内部推理和业务决策授权 |
| MCP | Agent Client 读取授权上下文、调用业务工具和提交结果 | Work Item 的权威状态或正式批准 |
| A2A | 独立 Remote Agent 的能力发现、任务委托、结果和状态传递 | 企业参与关系、事项权限和正式决策 |
| ACP | IDE / Client 与本地 Agent Runtime 的 Session、Prompt、Update 和 Cancel | 企业业务事项和跨部门审批 |
| Events / Webhook | 事件通知、唤醒、异步投影和跨系统同步 | 绕过业务命令入口直接修改状态 |

MCP 侧应提供表达业务意图的工具，例如 `list_my_work_items`、`get_work_item_context`、`list_my_tasks`、`claim_task`、`submit_analysis`、`submit_review_findings`、`create_decision_draft` 和 `request_human_input`。不要向 Agent 暴露一个能够随意修改领域对象的万能 `update_work_item`，更不能提供正式批准、确认决定、确认 Review Outcome 或关闭 Work Item 的工具。

新实现应以当前 [MCP Specification](https://modelcontextprotocol.io/specification/2026-07-28) 和 [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) 为依据。Streamable HTTP 已取代旧版 HTTP+SSE 作为标准传输路径；客户端能力仍有差异，业务流程不能依赖某个 MCP Client 必须支持 Elicitation、MCP Apps 或特定 Prompt 能力。正式操作需要人工确认时，平台始终可以让用户回到网站 UI。

A2A 适合委托给其他团队、供应商或组织维护的独立 Agent，例如安全情报、合规分析或第三方评估服务。适配层需要保存本地 Work Item ID、Collaboration Task ID、远端 A2A Task ID、A2A Context ID、Artifact Reference 和 Correlation ID 的映射。远端 Task 的状态与产物返回后，平台还要检查它对应的本地 Task、上下文版本和授权范围，决定是否接受结果。协议响应本身不能直接推进正式业务状态。

ACP 的位置更靠近用户本地工作环境。Local Connector 可以通过 ACP 或某个 Runtime 的原生 CLI / SDK 接入 Copilot、Claude Code 或其他 Agent Runtime。不同 Runtime 的 Session 能力、工具访问、取消和 Sandbox 支持并不完全一样，适配器应提供明确的 Capability Manifest，而不是假设所有 Runtime 都能被伪装成相同实现。无论底层使用哪一种方式，Connector 最终都通过平台业务 API 提交工作结果。

网站应该支持多种参与方式。最简单的是用户复制 Context Capsule 到自己熟悉的 Agent，再把结果作为 Artifact 提交；有集成能力的 Agent 可以通过 Remote MCP 读取 Task 并提交；需要本地文件和工具时，由用户自己的 Connector 接入 Local Runtime；真正跨独立 Agent 服务的协作再使用 A2A。平台不必强迫用户在网站注册每一个 Agent，也不需要第一阶段就托管所有人的 Agent Runtime。

## 6. 权限、并发和审计：关键控制必须在服务端生效

一个请求是否允许执行，至少要结合当前 Principal、有效 Delegation Grant、Work Item Participation、Role、资源范围、事项状态、动作和策略版本判断。OAuth Scope 适合表达粗粒度能力，例如读取事项或提交 Artifact；真正的事项级授权仍应在服务端计算。UI 隐藏按钮只是交互反馈，不能代替 API 的授权检查。

本地 Agent 也不能因为由某个 Human 启动，就自动继承这个 Human 的全部权限。建议将 Human Principal、Agent Execution Identity 和 Delegation Grant 分开记录。Grant 应限定允许访问的 Work Item / Task、资源范围、动作、有效期和撤销状态。每次写操作重新检查 Grant 和 Participation，不能因为连接建立时授权成功就长期放行。

正式业务决定必须有明确的 Human Decision Gate。Agent 可以准备分析、推荐、Decision Draft 和 Review Findings；服务端应按 Principal Type 拒绝 Agent 对正式 Decision、正式 Review Outcome、风险接受和 Work Item Closure 的写操作。Human 确认时，记录必须绑定 Decision Draft Version、输入 Artifact Versions、Role、授权策略版本和确认时间。草案在确认前发生变化，原确认页面就应失效并要求重新审阅。

这条边界不能只写在 Prompt、Skill 或 MCP Tool Description 中。服务端命令处理器必须检查执行主体；Workflow Engine 只能依据已经存在且验证过的 Human Decision Record 推进正式状态。数据库也可以为正式决定的写入路径增加约束，避免其他内部调用绕开应用服务。Human 拒绝后，相关业务副作用必须停止；Human 批准后，授权动作必须有可追踪的执行结果。

并发问题也不能交给 Agent 自己协调。Task 认领需要原子 Claim 或 Lease，包含 Owner、TTL 和释放机制，避免两个人同时认领同一个独占任务。Artifact 提交应携带它读取的 Context Version 和 Artifact Version；版本已经变化时，服务端返回 Conflict / Stale Context，让执行者重新读取或显式说明差异。不能静默覆盖新版本。

重复回调、审批提交和 Webhook 可能造成重复副作用，因此关键写接口需要幂等请求 ID。长时间运行和外部等待应持久化为 Task / Workflow 状态，遇到限流或网络故障时按策略重试；超过上限、发生版本冲突或授权被撤销时，应进入可解释的等待或失败状态，并提供人工接管路径。

审计记录需要回答：谁以什么身份、以什么角色和策略版本，基于哪个上下文版本，对哪个对象执行了什么操作，结果如何。Agent Trace 可以补充模型、Runtime、工具和执行时间等信息，但不能代替业务活动记录。对于 Copy / Paste 的工作方式，平台只能记录用户提交的结果和可验证来源，不能声称掌握了外部 Agent 的全部内部过程。

2026 年 11 月的一篇预印本 [Auditable Authorization for LLM Agents](https://arxiv.org/abs/2611.19237) 把审批控制放在 Model、Harness 和 Workflow 多个执行边界上考察。它尚属于预印本，不能当作行业定论，但其提出的验证方向很适合纳入系统测试：拒绝后实际副作用必须不存在；批准后指定动作必须完成并可追踪；Human Decision ID 必须与执行结果关联；并发审批和恢复不能导致重复执行或错误推进。人机协作的系统质量应以完整业务流程衡量，而不是只看 Agent 单次回答是否正确。

## 7. 网站工作台：围绕事项、任务和责任组织界面

如果业务事项是系统的中心，网站界面就不应以聊天窗口或一组孤立表单为中心。用户打开一项 Work Item，需要看到它当前处于什么阶段、有哪些参与者、每个人承担什么责任、有哪些待办 Task、材料有哪些版本、评审是否完成、还有什么决定等待作出。

通常需要三个主要工作视图：

**My Work** 面向个人，汇总当前用户负责或参与的 Work Item、需要认领的 Task、待回复的问题、待提交的评审和待确认的决定。它应该按当前用户的职责和可执行动作过滤，而不是只展示一个未经区分的事项列表。

**Work Item Workspace** 展示事项全貌，包括目标、当前阶段、参与人、Task、Artifact、Review、讨论、Decision 和 Activity。阶段进度可以用 Steps 一类组件表达，但它只展示业务生命周期的主要阶段；具体任务完成度、等待原因和阻塞项应来自 Task / Workflow 数据，不能把一个百分比当成整个协作状态。

**Task Workspace** 聚焦一项具体工作，显示责任人、执行者、输入上下文版本、预期交付、截止时间、当前状态和提交记录。用户可以在网站直接完成，也可以复制 Context Capsule、连接本地 Agent 或通过 MCP 调用。不同入口最后回到同一条 Task 和 Artifact 版本链。

参与者列表需要区分 Person Profile 和 Participation。Person Profile 描述一个人的组织信息、专业领域和可联系信息；Participation 则记录这个人在当前 Work Item 中的角色、职责范围、有效期和授权。平台可以允许具备相应权限的 Requester、Work Owner 或管理员维护参与人，但具体谁能邀请、移除或调整角色，应由业务策略定义，而不是硬编码成所有事项通用的全局权限。一个人的技能档案不能自动赋予他在每个事项中的审批权。

Chat 可以作为某些任务的工作入口，但不能成为业务记录唯一的承载方式。正式提交、评审、状态变化和决定需要结构化记录；聊天负责解释和讨论。这样，不使用 Agent 的参与者也能完成全部业务活动，深度使用 Agent 的参与者也不需要迁移自己的 IDE 或 Runtime。

## 8. Workflow Engine 与 Agent Runtime：选型要看边界，不看产品标签

业务流程建模可以借鉴 BPMN、CMMN 和 DMN，但不需要把它们都引入每一个系统。BPMN 适合步骤和责任相对明确的流程，例如提交、分析、评审、Human Approval 和关闭；CMMN 面向动态 Case，适合在事项推进过程中按需增加 Specialist、调查活动和里程碑；DMN 或普通确定性代码适合表达可重复验证的业务规则，例如哪些风险等级必须触发安全评审、哪些角色能批准某类事项。三者是不同的建模工具，不能把 LLM 的建议当作 DMN 规则，也不能把正式 Decision Record 和 DMN 决策表混为一谈。参考 [OMG BPMN](https://www.omg.org/spec/BPMN/)、[OMG CMMN](https://www.omg.org/cmmn/) 和 [OMG DMN](https://www.omg.org/spec/DMN)。

Work Item 不必直接等于 CMMN Case。Work Item 是平台自己的业务领域对象，CMMN Case 或 BPMN Process Instance 是某个 Workflow Engine 中的执行实例。二者可以一对一映射，也可以按业务类型建立多个流程实例。这样更换引擎时，不需要迁移或重定义核心业务身份。

几个值得评估的实现方向各有边界：

| 方案 | 适合的部分 | 主要代价或边界 |
| --- | --- | --- |
| Flowable | 开源 BPMN、CMMN、DMN 引擎；动态 Case 和 Human Task 值得研究 | 核心引擎以 Java 为主；企业 Agent 产品能力需与 Apache 2.0 开源组件分开核对 |
| Camunda 8 | BPMN 编排、Human Task、外部 Agent 执行观测和流程运维 | 8.6 及以上组件使用 Camunda License v1；自托管生产部署需要核对 Enterprise 授权 |
| Temporal | 长时间运行、持久化等待、Signal、Retry 和失败恢复 | 是 Durable Execution 平台，不是完整 Case Management 或业务工作台 |
| LangGraph | Agent 内部状态图、Checkpoint、Interrupt / Resume 和多 Agent 执行 | 不能作为组织 Participation、Work Item 和正式审批的权威数据源 |
| 轻量 State Machine | 第一阶段流程简单、团队希望控制实现复杂度 | 长期等待、重试、定时器和故障恢复逐渐增多时，容易演变成自建 Workflow Engine |

Flowable 官方资料说明其开源核心提供 BPMN、CMMN 和 DMN 引擎，并采用 Apache 2.0；Flowable Agentic Case Platform 和企业级集成能力需要按具体产品与许可单独评估。参见 [Flowable Open Source](https://www.flowable.com/open-source) 和 [Flowable Documentation](https://www.flowable.com/open-source/docs/)。

Camunda 的外部 Agent 集成有一个值得注意的边界：外部 Agent 在自己的 Runtime 中运行，Camunda 负责编排何时调用它；平台只能展示该 Runtime 主动报告回来的状态和执行信息。Camunda 8.6 及以上版本的核心组件许可也不同于传统 Apache 2.0 开源组件，生产自托管需要企业许可。参见 [Connect an external agent](https://docs.camunda.io/docs/components/agentic-orchestration/connect-external-agent/) 和 [Camunda 8 Licensing](https://docs.camunda.io/docs/reference/licenses/)。

Temporal 的价值是 Durable Execution。Workflow 的步骤和进度被持久化，Worker 故障后可以重放并继续，Timer、Signal 和 Retry 适合处理长时间等待和不稳定依赖。但 Temporal 不会自动提供 Work Item、Participation、Artifact、Review 或 Decision 模型；这些仍由业务平台定义。参见 [Temporal Durable Execution](https://docs.temporal.io/durable-execution)。

[Cumora](https://github.com/yetone/cumora) 值得作为 Runtime 解耦和本地 Agent 接入的源码参考。它将 Cloud Runtime 与 BYOA 本地执行路径分开，通过 Engine Adapter 对接不同 Agent CLI / ACP 路径，并把 Computer、Agent 和 Runtime Session 分开管理。其本地 Daemon 代理业务命令、短期凭证和授权范围，本地 Runtime 不必持有平台长期凭证。它的多 Agent 协调设计还使用原子 Claim、消息新鲜度检查和限流控制，说明并发竞态需要由服务端机制解决，不能依靠 Prompt 约定。

但 Cumora 的主要协作对象是 Workspace、Conversation、Board 和 Shipping，不是完整的跨业务域 Work Item / Case Management 模型。其 Shipping 验证流程允许一定范围的 Agent 提交验证状态；如果当前业务要求正式 Review 和 Decision 必须由 Human 确认，就不能直接复制这部分权限设计。可借鉴它的 Contract、Evidence、阶段门槛和 Readback 思路，正式业务确认仍需由本平台的授权策略强制执行。参考 [Cumora BYOA Design](https://github.com/yetone/cumora/blob/main/docs/BYOA.md)、[Coordination Design](https://github.com/yetone/cumora/blob/main/docs/COORDINATION.md) 和 [Shipping Design](https://github.com/yetone/cumora/blob/main/docs/SHIPPING.md)。

选型时不要同时引入两个能够独立推进同一业务状态的 Workflow Engine。如果一个引擎管理 Case，另一个管理 Agent 长时间执行，需要明确前者控制业务活动和 Human Task，后者只执行被委托的 Agent 工作；跨引擎通信通过带有幂等键、版本和关联 ID 的命令或事件完成。

## 9. 用不同业务验证通用模型

架构评审可以作为一个验证场景，但不能成为平台的专用模型。相同的 Work Item Core 还应能表达数据访问申请、风险调查、合规审查、生产变更、供应商评估和项目决策。变化的是 Work Item Type、Artifact Type、Role、Policy 和流程配置，不是每种业务都要新增一套核心实体。

例如，架构评审中可以由 Architect 负责分析、Security Specialist 提供安全意见、Reviewer 独立评审、Approver 作出决定；数据申请中则可能由 Data Owner、Privacy Specialist 和申请人参与。只要参与关系、任务、产物版本、评审请求和正式决定的语义保持一致，系统就不应因为角色名称不同而重新设计协作引擎。

长期技术债务、风险处置或整改事项也不应该只是源事项上的一个布尔字段。短期整改可以是关联 Task；若它需要独立排序、预算、责任人、风险跟踪和多个复查周期，就应提升为另一个 Work Item，并通过通用关系关联原始 Decision、Artifact 和事项。平台只需要提供可扩展的类型、关系、生命周期和责任模型，领域字段由具体业务配置。

至少应使用以下场景验证核心设计：

| 验证场景 | 需要证明的行为 |
| --- | --- |
| 动态加入专业角色 | 同一 Work Item 中可以增加 Participation 和新 Task，不需要改变事项身份 |
| 多人并行评审 | 每份 Review 绑定材料基线，彼此独立，不能互相覆盖 |
| 同一 Task 切换 Agent Runtime | 多个 Work Session 仍关联同一 Task，Artifact 保持连续版本 |
| Agent 等待 Human 数天 | 服务重启或断线后可以恢复，不要求进程常驻 |
| 两个执行者同时认领任务 | 原子 Claim 只允许一个请求成功 |
| 旧版本 Agent 提交结果 | Stale Context / Artifact Version 被拒绝或进入显式冲突处理 |
| Agent 尝试正式批准 | 服务端拒绝，不产生业务副作用 |
| Human 拒绝或批准 | 拒绝确实阻止后续动作，批准后动作与 Decision ID 可追踪 |
| 撤销 Agent 委托 | 后续请求立即失去授权，不依赖 Token 自然过期 |
| 外部 A2A Agent 离线 | 本地 Work Item 和 Task 状态仍可查询，远端结果返回后重新校验 |

这些测试应覆盖 Human、Agent、Workflow 和持久化层，尤其要验证真实副作用。UI 有一个 Approve / Reject 按钮、Agent 正确生成了一段审批请求，或者 Workflow 收到了某条事件，都不能单独证明决策控制有效。

## 10. 落地顺序：先把业务协作做完整，再增加 Agent 集成

第一阶段先实现 Work Item、Participation、Task、Artifact、Review 和 Decision 的基本领域模型，以及 My Work 和 Work Item Workspace。通过网站 UI 完成创建、分配、提交、评审和 Human 决策；外部 Agent 暂时使用 Copy / Paste Context Capsule。这样可以先验证多人协作本身是否成立，不必把 Runtime 接入作为前置条件。

第二阶段补齐事项级授权、Artifact Version、Review 基线、Decision Policy、审计和并发控制。Task Claim、幂等写入、Stale Context 检测、Transactional Outbox 和长时间等待恢复应在这一阶段成为服务端能力，而不是等到 Agent 数量增加后再补。

第三阶段开放 REST/OpenAPI 和 Remote MCP，让用户选择自己的 Agent Client。需要本地文件访问的用户使用 Local Connector；只有确实要委托独立 Agent 服务时，再增加 A2A Adapter。ACP 仅用于支持它的本地 Runtime，不能变成平台内部业务对象的标识体系。

当多个业务域都出现动态参与者、临时活动和长周期 Case 时，再用真实流程验证 CMMN 或完整 Workflow Engine 是否值得引入。若阶段和规则简单，轻量状态机可以先满足需求；若长期等待、补偿、重试和外部信号变多，就应评估成熟的 Durable Execution / Case Management 引擎，不要持续堆叠零散定时任务和自制状态表。

架构验收的重点不是启动了多少 Agent，而是同一项业务能否跨越不同参与者、工具和执行时间保持连续：责任明确，材料有版本，评审独立，授权可撤销，Human 决策可审计，等待和失败可以恢复。任何一种 Agent Client 都不应成为业务流程的唯一入口或状态来源。

## 结论

多角色 Agent 协作需要先解决一个传统企业系统一直面对的问题：一项工作由不同的人、团队和工具共同完成时，系统如何保存共同上下文、责任、进度、证据和决定。Agent 增加了新的执行者和接入方式，但没有改变这些业务要求。

Work Item 是长期业务对象，Participation 表示事项内的责任关系，Task 管理具体工作，Artifact 和 Review 管理版本化交付与独立意见，Decision 保存有授权依据的正式决定。Workflow 控制业务生命周期，Agent Runtime 执行被委托的任务，MCP 和 A2A 分别解决工具接入与跨 Agent 通信。

最终架构应保持 **Human-led、Agent-optional、Runtime-independent**：人仍然负责业务判断和正式决定，Agent 可以在授权范围内参与工作，平台则持续维护同一件业务事项的上下文、任务、产物、责任和结果。
