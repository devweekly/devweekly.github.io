---
author: W
featured: false
draft: false
description: 面向多人、多角色和多种 Agent Runtime 的 Human-led 业务事项协作架构，比较 MCP、A2A、ACP、CMMN、BPMN、Flowable、Camunda、Temporal 与 Cumora，并明确 Human 决策权边界。
pubDatetime: 2026-11-22T03:00:00Z
title: 从 A2A 到共享业务事项：多角色 Agent 协作架构怎么设计
tags:
  - ai
  - agent
  - a2a
  - mcp
  - acp
  - cmmn
  - dmn
  - flowable
  - temporal
  - cumora
  - collaboration
  - workflow
  - architecture
---

# 从 A2A 到共享业务事项：多角色 Agent 协作架构怎么设计

## 1. 问题不是 Agent 如何互相聊天

考虑一个网站上的架构分析需求。业务人员提交需求并希望获得架构分析；架构师接手后梳理约束、分析方案；另一位架构师作为 Reviewer 独立审查；安全或数据团队可能只在相关问题出现时加入；需求提交人需要补充信息、确认分析范围，最后由有决策权的人接受、退回或要求修改。

参与者并不固定。同一个人可能在事项 A 中是提交人，在事项 B 中是 Reviewer，在事项 C 中是业务负责人。角色由当前事项、阶段和授权关系决定，而不是绑定在某个用户账号或 Agent 实例上。参与者也不必同时在线：有人今天提交，Agent 夜间分析，Reviewer 两天后提出异议，提交人下周补充材料。

这类系统要解决的是一个持续存在的业务事项如何被多人和多个 Agent 共同推进。它至少包含五个相互关联、但不能混为一谈的问题：

- **事项身份与上下文**：大家讨论的是哪一个需求、哪个版本、哪些业务事实和哪些历史决定？
- **角色与责任**：当前谁是提交人、执行者、Reviewer、批准人或观察者？这些角色分别能做什么？
- **协作与交接**：谁可以发起工作、认领任务、提出异议、请求补充、转交或升级？
- **流程与状态**：事项处于待分析、分析中、待补充、待评审、修改中还是已决策？什么事件可以推动状态变化？
- **Agent 执行**：Agent 如何接收工作、读取上下文、调用工具、生成产物，并把结果交回业务事项？

A2A 主要解决最后一类问题中的跨 Agent 通信与任务委托。它不是完整的多人业务协作模型。把一个 A2A contextId 当成项目空间，或者把几个 Agent 放进一个群聊，就会遗漏业务身份、授权、流程状态、产物版本和决策责任。

本文把核心对象定义为 **Business Work Item（业务事项）**。它可以是一项架构分析、一项安全评审、一份数据申请、一次变更、一项合规调查，也可以是一个持续演进的项目工作包。所有参与者围绕同一个 Work Item 工作，但各自拥有独立的身份、角色、任务和执行上下文。

## 2. 与 A2A 的关系：通信协议不是协作系统

A2A（Agent2Agent）是跨 Agent 系统的互操作协议。Agent 可以通过 Agent Card 声明身份、能力、接口和认证要求；调用方发送 Message，远端 Agent 可以返回即时 Message，也可以创建有生命周期的 Task；Task 可以产生 Artifact，并通过状态更新、流式订阅或推送通知报告进度。A2A 的 Task 和 Context ID 也支持多轮交互与相关任务的上下文关联。

这些能力非常有用，但它们的语义边界需要明确：

- Agent Card 描述“这个 Agent 能做什么、如何调用”，不描述“它在某个业务事项中被赋予什么组织角色”。
- Task ID 标识一次 Agent 工作，不等于业务事项 ID。一个事项可能产生多个并行或串行 Agent Task。
- Context ID 将相关消息和任务组织为一个交互上下文，不等于具有成员、权限、版本、业务状态和审计规则的共享项目空间。
- Artifact 是 Agent 交付的结果，不自动成为业务系统认可的正式文件或已批准决策。
- A2A 的消息与任务状态不能代替业务事件账本。协议文档也明确指出，不能把所有消息都视为可靠持久化记录；关键业务信息需要由应用负责保存。

因此，合理的组合关系是：**业务协作系统持有 Work Item 和业务状态；Agent Runtime 负责执行认知任务；A2A 负责需要跨 Agent 边界时的通信。** 同一个系统内部的 Agent 可以通过本地编排、队列或函数调用协作，不必为了“多 Agent”而强行走 A2A。

参考：
- [A2A Protocol Specification 1.0](https://a2a-protocol.org/v1.0.0/specification/)
- [A2A Key Concepts](https://a2a-protocol.org/latest/topics/key-concepts/)
- [Google Cloud：A2A Protocol 与 MCP 的关系](https://docs.cloud.google.com/agent-registry/a2a-protocol)

## 3. 应该围绕 Work Item 建模，而不是围绕 Agent 建模

建议将系统中的对象分成四个层次。

**Work Item 是业务协作的根对象。** 它拥有稳定 ID、类型、标题、业务目标、发起组织、当前状态、优先级、期限、关联项目和业务上下文版本。它代表“组织正在处理的这件事”，生命周期可能持续数天或数月。它不属于某个 Agent，也不属于最初提交它的用户。

**Participation 表示谁以什么身份参与。** Participation 将 Principal、Work Item、Role、Scope 和有效期关联起来。Principal 可以是人、Agent Service Identity 或组织/团队。角色是事项范围内的关系，不是全局用户属性。一个人可以同时是提交人和业务专家，但如果需要独立评审，就应通过职责分离规则禁止其评审自己负责的产物。

**Task 表示一次可执行的工作。** Task 可以分配给人，也可以分配给 Agent；可以由流程自动创建，也可以由参与者主动发起。它有自己的状态、输入、输出、截止时间、依赖、执行者和重试规则。一个 Work Item 可以有多个 Task，例如需求澄清、架构分析、安全评审、数据影响分析和最终决策。

**Artifact、Decision Draft 与 Decision 是三种不同的对象。** Artifact 是分析文档、架构图、风险清单、测试结果或证据包，必须有版本和来源。Agent 可以生成分析结论、选项比较、风险评估和 Decision Draft（决策草案），但不能确认草案，也不能作出、批准或提交正式 Decision。只有具备相应权限的 Human 才能确认、修改或拒绝决策草案，并亲自确认正式决定。系统可以在 Human 确认后执行状态转换、通知和归档，但自动化执行不等于 Agent 拥有决定权。

这四层不要压成一张“Agent Session”记录。Session 是运行时概念，Work Item 是业务概念；前者可以结束、重建或切换模型，后者必须长期存在。

## 4. 角色是上下文关系，不是 Agent 人格

系统需要区分三种身份：

1. **Principal**：谁在执行，包括用户、Agent 身份或服务账号。
2. **Role**：这个 Principal 在当前 Work Item 中承担什么责任。
3. **Capability / Permission**：该角色在当前状态下可以执行哪些动作、访问哪些资源。

例如，架构分析事项可以定义以下角色：

| 角色 | 主要责任 | 典型权限 |
| --- | --- | --- |
| Requester | 提出需求、补充业务背景、确认目标 | 创建事项、补充材料、确认范围、查看结果 |
| Business Owner | 对业务目标、约束和风险接受负责 | 确认业务约束、接受或拒绝业务结果 |
| Analyst / Architect | 执行分析并维护分析产物 | 创建分析任务、编辑草稿、回应评审 |
| Reviewer | 独立检查分析质量、假设和风险 | 提出 Review、要求修改、给出评审结论 |
| Specialist | 提供安全、数据、合规等专业意见 | 访问授权范围内的材料、提交专业意见 |
| Approver | 作出正式批准或拒绝 | 执行流程定义允许的决策动作 |
| Observer | 跟踪进度，不承担交付责任 | 只读查看授权内容 |

角色不应直接决定全部权限。Requester 在“待补充”阶段可以修改需求材料，但在正式决策后不能悄悄覆盖历史版本；Reviewer 可以提出阻断性意见，但是否能批准最终方案由流程规则决定。权限判断应结合 Principal、Role、Work Item、当前状态、资源分类、动作和策略版本。

Agent 也应遵循同一模型。不要创建一个全局的“Architect Agent”账号，然后让它天然拥有所有架构事项的修改权。应为每次 Agent Participation 绑定委托来源、允许的 Task 类型、资源范围、有效期和可执行动作。Agent 的身份说明它是谁，Participation 说明它为何参与这个事项，Capability 才说明它能做什么。无论 Agent 的角色名称是 Analyst、Reviewer Assistant 还是 Approver Assistant，都不因此获得 Human 的业务决定权：Agent 可以分析、质疑、推荐、准备草案和提醒风险，不能代表 Human 确认草案、确认评审结论、批准或拒绝事项。

## 5. 同一个事项可以有多个 Agent，但不需要一个永久的 Agent 群聊

Agent collaboration 常见的组织方式包括 Supervisor、Group Chat、Handoff、Sequential / Concurrent Workflow，以及 Blackboard / Shared State。它们解决的是不同层面的协调问题。

| 模式 | 适用场景 | 局限 |
| --- | --- | --- |
| Supervisor | 一个协调 Agent 分派任务、汇总结果 | 协调者可能成为瓶颈；容易把业务责任错误地集中到 Agent |
| Group Chat | 多个 Agent 围绕同一问题讨论、相互质疑 | 对话膨胀；难以区分意见、事实、正式产物和决定 |
| Handoff | 一个 Agent 把任务转交给另一个 Agent | 适合执行权交接，不等于共享业务状态 |
| Sequential / Parallel Workflow | 分析、检查、汇总等步骤有明确依赖 | 不适合把所有临时协作都固化成流程节点 |
| Blackboard / Shared State | 多个参与者读写同一事项的结构化工作区 | 必须解决并发、权限、版本和冲突处理 |

推荐以 **Shared Work Item + Task Orchestration** 为主，按需使用其他模式。Work Item 的共享上下文是所有参与者的共同参照；Agent Task 则是一次有边界的工作。需要讨论时，可以启动一个有明确议题和参与者的讨论线程；需要独立判断时，创建独立 Reviewer Task；需要跨系统 Agent 时，通过 A2A 委托。

不要把所有 Agent 放进一个持续运行的群聊。不同 Agent 应该看到与其任务相关的上下文投影，而不是自动获得事项中的全部对话、附件、敏感数据和其他 Agent 的内部状态。

## 6. 共享上下文应该是结构化的、分层的、有版本的

Work Item 的 Context 不应等同于聊天记录。建议分为以下几类：

- **Business Facts**：业务目标、范围、约束、术语、系统现状、相关数据和权威来源。
- **Working Notes**：尚未验证的假设、探索过程、待确认问题和临时结论。
- **Artifacts**：需求说明、分析报告、架构图、评审意见、证据材料及其版本。
- **Decisions**：正式决定、决定人、理由、适用范围、条件和时间。
- **Activity History**：谁在何时执行了什么动作，产生了什么结果。
- **Conversation Threads**：围绕具体议题的讨论，不承担正式状态或决策的唯一存储职责。

上下文还应支持访问投影。Requester、Reviewer、Security Agent 和 Architect Agent 对同一 Work Item 的可见内容不必相同。系统根据参与关系、数据分类和任务授权生成 Context View，并记录其版本或快照标识。Agent 输出需要引用它实际使用的输入版本，避免 Reviewer 审查的是新版本，而 Analyst 的结论基于旧版本。

对正式产物采用版本化和不可变修订记录。修改不是覆盖历史，而是产生新版本；评审意见必须指向被评审的 Artifact Version。若分析报告从 v3 更新到 v4，v3 上的 Review 不能自动变成 v4 的批准。可以根据差异决定哪些评审需要重跑，但必须显式记录。

共享状态也不能允许多个 Agent 直接写同一个自由文本字段。更合理的方式是：Agent 提交结构化变更或 Artifact，服务端执行权限校验、Schema 校验、版本检查和冲突检测，再写入正式状态。重要的事实、假设、建议和决定应有不同类型，避免把 Agent 的推断写成已确认业务事实。

## 7. 业务流程、协作任务和 Agent 执行需要分层

这套系统同时包含三种不同的流程：

**Business Workflow** 定义事项生命周期、阶段、审批门槛、SLA、升级路径和正式状态转换。它回答“业务事项现在处于什么状态、下一步允许谁做什么”。对于正式审批、合规检查和责任明确的流程，应由确定性的 Workflow Runtime 持有状态。

**Collaboration Workflow** 管理具体参与者之间的任务分配、认领、交接、评论、补充信息、评审和冲突解决。它可以由业务流程创建 Task，也允许参与者在授权范围内发起临时协作。不是每个评论都需要 BPMN 节点，也不是每次 Agent 委托都应该修改业务流程定义。

**Agent Execution Workflow** 管理 Agent 的内部计划、工具调用、并行分析、重试和上下文压缩。LangGraph 等 Agent Framework 可以管理这部分状态，但它的执行状态不能成为 Work Item 的唯一业务状态来源。

已有的 [AI 时代的业务流程：Workflow 应该用 BPMN 还是 Agent](https://devweekly.github.io/posts/workflow-and-agent-and-bpmn/) 讨论了 Business Workflow 与 Agent Workflow 的编排权边界。这里是在该边界上增加 Collaboration 层：外层业务流程持有事项状态，协作层管理人与 Agent 的参与和交接，Agent Runtime 执行被分配的工作。

### 7.1 一个架构分析事项的生命周期

1. Requester 创建 Work Item，填写业务目标、问题描述、影响范围和已有材料。系统根据事项类型创建初始流程实例。
2. 系统根据组织规则或人工选择分配 Architect Participation，创建架构分析 Task。Agent 可以辅助分析师整理材料、提出问题，但不自动取代责任人。
3. Analyst 完成初稿，产生 Artifact v1，并提交分析完成事件。业务流程将事项推进到待评审。
4. 系统根据独立性规则选择 Reviewer。Reviewer 获得针对 v1 的上下文快照，创建独立 Review Task。
5. Reviewer 提交 Review Artifact，指出问题、证据和严重程度。若需要修改，流程创建 Revision Task 并回到 Analyst；若通过，进入业务确认或批准阶段。
6. Requester 或 Business Owner 补充业务确认。Approver 根据正式权限作出决定。
7. Decision 记录批准、拒绝或附条件接受。事项关闭，但历史 Artifact、Review、Task 和 Decision 仍可查询。

这里的“独立评审”是一个组织控制，而不只是另一个 Agent 换个 Prompt。Reviewer 应获得独立任务和独立上下文视图；如果要求真正独立，就不能让 Reviewer 继承 Analyst 的隐藏推理或未公开的倾向性结论。它应看到业务输入、分析产物和必要证据，并自行形成判断。

## 8. 建议的参考架构

建议将平台分成五个边界清晰的部分：

| 层 | 核心职责 | 不应该承担的职责 |
| --- | --- | --- |
| Collaboration UI | 事项工作台、任务箱、讨论、产物查看、审批操作 | 不直接修改业务状态或绕过授权 |
| Work Item Service | 事项、参与关系、角色、上下文视图、Artifact、Decision | 不运行长时间 Agent 推理 |
| Workflow / Task Service | 业务状态机、任务分配、SLA、等待、重试、升级和交接 | 不实现 Agent 内部推理 |
| Agent Gateway / Runtime | Agent 调用、执行计划、工具访问、模型路由、执行追踪 | 不成为业务状态的权威来源 |
| Identity / Policy / Audit | 身份认证、委托授权、策略决策、审计和证据链 | 不依赖 Prompt 约束权限 |

服务间通过领域事件协作，例如 WorkItemCreated、ParticipationAdded、TaskAssigned、ArtifactSubmitted、ReviewRequested、ReviewCompleted、DecisionRecorded。事件应带有 Work Item ID、Actor、Correlation ID、发生时间、版本和必要的因果关联。事件用于驱动通知、工作分配和投影更新；正式状态变更仍通过受控的命令入口执行。

持久化可以从关系数据库开始。Work Item、Participation、Task、Artifact、Decision、Comment / Thread、Workflow Instance 和 Audit Event 是核心数据对象。附件和大型 Artifact 正文放对象存储，数据库保存版本、内容哈希、媒体类型、访问标签和存储引用。初期不必为了“Agentic”引入图数据库、事件流平台或独立记忆数据库；只有当查询模式、吞吐或跨系统集成确实需要时再增加。

### 8.1 核心数据模型

| 对象 | 关键字段 | 说明 |
| --- | --- | --- |
| WorkItem | id, type, status, owner_org, context_version | 长期业务事项 |
| Participation | work_item_id, principal_id, role, scope, valid_until | 人或 Agent 在事项中的角色 |
| Task | id, work_item_id, kind, assignee, status, due_at | 一次可执行工作 |
| TaskRelation | from_task_id, to_task_id, relation_type | depends_on、reviews、revises、delegates_to |
| Artifact | id, work_item_id, type, version, created_by, content_hash | 有版本的正式产物或工作产物 |
| ArtifactRelation | artifact_id, source_id, relation_type | 产物与输入、证据、评审的关联 |
| Review Submission | work_item_id, proposer, package_version, artifact_refs, submitted_at | 固定一轮评审需要审查的提案材料集合 |
| Review Round | submission_id, chair, decision_authority, state, quorum_policy | 一轮针对特定提案版本的评审过程 |
| Reviewer Assessment | round_id, reviewer, role, disposition, findings | 每位专业 Reviewer 的独立正式意见 |
| Review Session | round_id, meeting_time, attendees, agenda, minutes | 一次评审会议及其材料快照 |
| Review Question / Response | session_id, author, respondent, topic_ref, status | 会议中的提问、答复和待澄清问题 |
| ADR Record | artifact_id, adr_key, status, supersedes_id, decision_scope | 具有独立决策生命周期的 ADR |
| Decision Record | round_id, authority, outcome, rationale, policy_version | 正式决策及其授权依据 |
| Decision Item | decision_id, adr_ref, outcome, rationale, condition_refs | 对提案中的每一项 ADR 分别作出决定 |
| Technical Debt Item | source_decision, source_adr, owner, remediation, target_date | 跟踪已接受方案形成的长期技术负担 |
| Architecture Exception | standard_ref, scope, controls, owner, expires_at | 管理对企业标准或架构原则的限时偏离 |
| Risk Acceptance | risk_ref, risk_owner, accepted_scope, expires_at, controls | 记录由授权风险负责人作出的风险接受 |
| Decision | work_item_id, decision_type, actor, rationale, policy_version | 正式业务决定 |
| Thread / Message | work_item_id, topic_id, author, visibility | 讨论记录 |
| AuditEvent | actor, action, target, before, after, correlation_id | 不可随意覆盖的审计记录 |

一个重要的建模选择是：Task 与 Work Item 是多对一关系，而不是一对一。Task Relation 也不只是父子关系；评审、修订、补充和依赖都是不同的关系类型。这样才能表达同一个事项中的并行专家分析、多个 Reviewer 和反复修订，而不必把所有工作压成一条线性对话。

## 9. 事件、并发和交接：协作系统最容易出错的地方

多个参与者共同操作同一个事项，首先要处理并发写入。Artifact 更新采用乐观锁或版本号；提交时必须声明基于哪个版本。如果版本已变化，系统应拒绝静默覆盖，并要求重新读取差异。评论可以追加，但正式事实、状态、审批和决策必须走命令接口。

Task 分配需要区分 Assigned、Claimed 和 In Progress。团队队列中的任务可以由符合条件的人认领；独占任务则由系统直接分配。认领操作必须原子化，防止两个 Reviewer 同时以为自己拿到了唯一任务。任务转交应记录交出方、接收方、原因、上下文和当前产物，不要只在聊天里说“交给某某了”。

长时间等待应是一等状态，而不是 Agent 一直占着执行线程。Waiting for Requester、Waiting for Reviewer、Waiting for Approval、Blocked by Dependency 都应能持久化，触发通知和 SLA 计时。参与者回来后，系统从持久状态恢复，而不是要求 Agent 从头阅读全部聊天记录。

关键事件需要可靠投递。数据库事务与事件发布之间可以使用 Transactional Outbox，消费者用幂等键处理重复投递。对于重复的审批提交、Agent 回调和 Webhook，应使用幂等命令或请求 ID，避免重复产生业务副作用。事件日志与 Agent Trace 分开保存：前者是业务事实，后者解释 Agent 如何执行。

## 10. A2A 应该放在哪一层

当同一个业务平台内有多个 Agent Runtime，且它们可以直接调用或由统一 Runtime 编排时，先用内部 Task Contract 和统一的 Agent Gateway。A2A 并不是内部协作的必选项。

当需要调用另一个团队、供应商或组织提供的独立 Agent 服务时，A2A 才真正发挥价值。例如外部威胁情报 Agent、第三方合规分析 Agent 或另一个业务域的架构知识 Agent。此时 Agent Card 负责能力发现，A2A Task 负责远端执行，Artifact 负责传回结果；Work Item Service 仍负责决定是否接受结果、把它绑定到哪个事项版本，以及是否推进业务状态。

建议在 A2A Adapter 中维护映射关系：

- WorkItem ID：本地业务事项标识，不直接等同于 A2A contextId。
- Collaboration Task ID：本地协作任务标识，负责分配、授权、SLA 和状态。
- A2A Task ID / Context ID：远端 Agent 的协议标识。
- Artifact Reference：远端结果与本地 Artifact 的关联。
- Correlation ID：跨服务追踪一次委托的完整链路。

A2A 的 contextId 可以在一个远端 Agent 的多个相关任务之间保持交互连续性，但不能作为跨 Agent 的共享数据库主键。不同远端 Agent 可以有不同 contextId；它们仍然围绕同一个本地 Work Item 工作。

## 11. 权限和治理必须围绕事项与任务执行

系统至少需要三层授权检查：

**进入事项的授权**：Principal 是否可以发现和读取这个 Work Item，是否可以加入某个 Role，是否可以查看附件和讨论。不能因为知道 Work Item ID 就默认有权访问。

**执行任务的授权**：Principal 是否可以认领或执行这个 Task，Agent 是否被允许读取本次 Context View、调用指定工具和生成指定类型的 Artifact。授权应限定到事项、资源、动作和有效期。

**提交业务动作的授权**：谁可以把 Artifact 标记为正式提交，谁可以要求重做，谁可以批准或拒绝，谁可以关闭事项。Agent 可以提交分析产物、建议和决策草案，但不能确认草案、确认正式评审结论、批准或拒绝，也不能关闭事项。所有具有业务后果的确认和决定都必须由具备权限的 Human 明确执行。系统可在 Human 操作后自动完成确定性的状态更新、任务派发和通知。

尤其要防止权限随交接扩大。父 Agent 委托子 Agent 时，只能传递完成任务所需的最小权限；子 Agent 不能自行扩大数据范围或获取新的业务权限。A2A 的认证机制只解决远端调用的身份与传输安全，不能替代本地对 Work Item 的资源级授权。

审计记录需要回答：谁以什么身份，在什么角色和策略版本下，基于哪个上下文版本，对哪个对象执行了什么操作，结果是什么。对于 Agent 生成的结论，还应记录模型/Agent 版本、Prompt 或 Skill 版本、输入 Artifact 和数据快照引用。敏感正文不应无差别复制进日志，审计应保存足以复核的引用、摘要和访问控制信息。

## 12. 现有方案如何组合

这不是要寻找一个单独的 Agent Framework 来实现全部功能。不同产品解决的层次不同：

| 方案 | 可以借鉴的能力 | 不应误认为 |
| --- | --- | --- |
| A2A | 跨 Agent 发现、消息、任务生命周期、Artifact、异步状态 | 业务项目空间或组织角色系统 |
| MCP | Agent 调用工具和读取资源的统一接口 | Agent 之间的任务委托协议 |
| LangGraph | Agent 内部状态图、持久化执行、人工中断与恢复、多 Agent 编排 | 企业业务事项的唯一状态源 |
| Microsoft Agent Framework | Sequential、Concurrent、Handoff、Group Chat 等协作模式 | 组织审批和业务责任模型 |
| Camunda / BPMN | 业务流程、User Task、角色分配、等待与审批 | Agent 的内部推理框架 |
| Temporal | 长时间运行、持久化进度、重试、定时器和消息驱动 | 业务协作 UI 或完整身份治理 |
| Case Management / CMMN 思路 | 围绕 Case 的阶段、角色、里程碑和临时活动 | 多 Agent 通信协议 |

Camunda User Task 可以配置 assignee、candidateUsers 和 candidateGroups，并在任务完成后恢复流程实例；这与本设计中的人类任务和审批节点高度相关。Temporal 的 Durable Execution 则适合承载长时间运行、等待外部信号、失败后恢复的执行。它们可以作为不同实现选择，不意味着必须同时部署。

参考：
- [Camunda 8 User Tasks](https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/)
- [Temporal Durable Execution](https://docs.temporal.io/durable-execution)
- [Temporal Design Patterns](https://docs.temporal.io/design-patterns)
- [Microsoft Agent Framework：Workflow Orchestrations](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/)（Sequential、Concurrent、Handoff、Group Chat、Magentic）
- [Microsoft Azure Architecture Center：AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns/)
- [Google：A2A 与 MCP 的分工](https://docs.cloud.google.com/agent-registry/a2a-protocol)

## 13. 关键原则：Agent 可以分析和起草，不能替 Human 作决定

这是整个协作系统必须贯彻的业务控制边界，而不是某个 Agent Prompt 的行为约定。

Agent 的职责是帮助 Human 更好地理解问题和准备行动。它可以读取授权范围内的资料，检索知识，识别矛盾和缺失信息，比较方案，分析影响与风险，提出推荐，生成报告、评审意见和决策草案。它也可以指出当前事项可能需要谁参与、下一步有哪些可选动作，以及每种动作的后果。

但 Agent 不能把自己的分析结果升级为组织决定。以下动作必须由有权限的 Human 明确确认：

- 确认、接受或修改 Agent 生成的 Decision Draft。
- 作出正式的批准、拒绝、附条件批准、豁免或风险接受决定。
- 确认正式 Review Outcome，尤其是通过、阻断或关闭评审。
- 确认业务范围、关键约束、风险接受和例外处理。
- 确认事项完成或关闭，以及任何具有同等业务效果的动作。

因此，数据模型必须区分至少三个层次：

| 对象 | 含义 | 谁可以创建或修改 | 是否产生正式业务效力 |
| --- | --- | --- | --- |
| Analysis / Recommendation | 分析、事实整理、方案比较、风险和建议 | Human、Agent | 否 |
| Decision Draft | 面向 Human 的结构化决策草案，包含选项、推荐、理由、风险和待确认条件 | Human、Agent | 否 |
| Decision | Human 明确确认的正式决定，包含决定人、权限依据、时间、理由和适用范围 | 授权 Human | 是 |

Review 也采用相同原则。Agent 可以生成 Review Findings 或 Review Recommendation，例如“发现两个阻断问题，建议退回修改”；但如果流程要求正式 Reviewer 确认评审结论，那么必须由被授权的 Human Reviewer 执行确认。Agent 辅助 Reviewer 不等于 Agent 成为 Reviewer of Record。

系统界面应清楚区分“Agent 建议”“待 Human 确认”和“已由某人正式确认”。不能使用一个模糊的“完成”按钮，让 Agent 提交结果后看起来像事项已经批准。Human 确认时应看到被确认的草案版本、关键依据、未解决风险和确认后果；确认动作记录操作者身份、角色、对象版本和时间。若草案在确认前发生变化，原确认界面应失效并要求重新审阅。

在技术实现上，不要只依赖 Prompt 说“你不能决定”。权限层应直接拒绝 Agent Principal 对 Decision、Approval、正式 Review Outcome 和 Work Item Closure 执行写入。Agent Gateway 可以提供 `prepare_decision_draft`、`submit_recommendation`、`request_human_confirmation` 等工具，但不向 Agent 暴露 `approve_work_item`、`confirm_decision`、`reject_request` 或 `close_case` 这类正式决定工具。即使 Agent 通过其他 API 尝试调用，也必须在服务端按 Principal 类型和授权策略拒绝。

Human 确认后，系统可以自动执行后续确定性动作，例如更新状态、创建下一个 Task、通知参与者或归档版本。这是工作流引擎执行已确认的业务规则，不是 Agent 自主作出决定。任何“自动化”都不能绕过 Human 确认这一业务边界。

## 14. 多入口协作：网站是业务协作中心，不是所有人的 Agent Host

参与者使用的工作环境不应该被平台统一。有人完全不用 Agent；有人日常使用 VS Code 中的 GitHub Copilot Chat；有人使用 Copilot CLI 或 SDK；有人使用 Claude Code 或其他本地 Agent Runtime；也有人直接使用网站内置 Agent。平台要统一的是业务事项、任务、上下文、产物和责任，而不是每个人的模型、IDE、插件或本地工作区。

建议将网站定位为 **Business Collaboration Hub**。它负责 Work Item、Participation、Task、业务上下文、产物版本、评审、Human 决策和审计。外部 Agent Runtime 负责用户选择的执行环境。网站内置 Agent 是可选入口，适合搜索、整理和分析；它不应成为所有用户参与事项的前置条件。

这意味着“使用 Agent”不应该是创建或处理事项的必要步骤。没有安装 MCP、没有 Skill、没有 SDK、没有脚本，用户仍然可以完整参与工作。平台提供的集成能力应逐级增强，而不是一次性要求用户改变工作习惯。

### 14.1 Agent 接入的四个层级

| 层级 | 使用方式 | 网站提供什么 | 用户需要做什么 | 适用场景 |
| --- | --- | --- | --- | --- |
| Level 0：Copy / Paste | 用户把事项上下文复制到自己的 Agent，再把结果提交回网站 | 简短任务说明、Context Capsule、复制入口、结果提交入口 | 复制一段指令，使用自己熟悉的 Agent，粘贴结果 | 临时使用、轻量分析、没有集成能力的 Agent |
| Level 1：MCP / Remote API | 外部 Agent 通过工具读取事项并提交工作结果 | 有范围限制的 MCP Server 或 API、授权和审计 | 完成一次授权或使用已有企业身份集成 | Agent 能调用远程工具，但不需要本地文件执行 |
| Level 2：Local SDK / CLI Connector | 本地 Connector 把网站 Task 与用户本地 Agent Runtime 连接 | Task API、短期委托授权、回调和活动记录接口 | 连接本地 Copilot SDK/CLI、Claude Code 或其他 Runtime | 需要本地文件、IDE、脚本和工具的深度工作 |
| Level 3：Skill / Agent 配置 | 加载团队或个人的专用 Skill、模板和规则 | 可选 Skill、模板、知识源和配置分发 | 主动安装或启用 | 重复性强、专业要求高的团队工作 |

Level 0 必须被认真设计，而不是当作临时补丁。用户在事项页面点击“交给我的 Agent 辅助”，网站生成一段可以直接复制的任务说明，明确工作目标、必要背景、约束、预期产物和提交方式。用户不必理解 MCP、OAuth、SDK 或 Agent Skill。

Level 1 适合 Agent 已具备 MCP 或 HTTP 工具调用能力的情况。工具应围绕业务意图设计，例如读取当前任务、准备上下文、列出可访问产物、提交分析结果、请求人工补充，而不是简单暴露一个可以任意修改事项的通用接口。

Level 2 解决网站无法直接访问用户本地工作区的问题。Connector 在用户本机运行，使用用户选择的 Runtime 和本地文件工具；网站只提供任务上下文、授权范围和结果提交接口。网站不需要托管或接管用户的 Copilot / Claude Code Session。

Level 3 是可选的专业化能力，不应成为参与流程的门槛。某个团队可以安装架构分析 Skill、ADR 模板或安全审查规则；另一个团队可以只使用普通 Copilot Chat 的一两句话提示。系统不能假设每个用户都愿意维护完整的 Agent 配置。

### 14.2 Context Capsule：把必要业务上下文交给外部 Agent

网站需要提供一个可复制、可下载或通过授权 API 获取的 Context Capsule。它不是完整的 Work Item 导出，也不是把全部聊天历史塞进 Prompt，而是针对当前参与者、Task 和权限生成的最小工作上下文。

建议包含：

| 字段 | 内容 |
| --- | --- |
| Work Item Reference | 事项 ID、标题、事项类型和可访问链接 |
| Task Reference | Task ID、当前目标、状态和截止时间 |
| Participant Context | 当前 Human 的事项角色，以及 Agent 被委托执行的辅助工作 |
| Objective | 需要分析或完成的问题 |
| Business Context | 与本次任务有关的业务事实和背景 |
| Constraints | 已确认约束、不可违反的边界和明确排除项 |
| Inputs | 授权访问的 Artifact、附件、证据和版本引用 |
| Expected Output | 需要提交的分析、风险、建议或 Decision Draft 格式 |
| Submission Instructions | 如何把结果提交回网站，以及提交到哪个 Task |
| Context Version | 上下文快照或版本标识，便于追溯结果所依据的输入 |

Capsule 应明确区分已确认事实、待验证假设、历史建议和正式决定。Agent 不应把“某人曾在评论中提出的猜测”当成业务事实。敏感资料默认只提供引用和受控访问链接，不应因为用户复制了一段 Prompt 就把受限内容泄露到外部模型。链接本身也不能代替授权；外部 Agent 访问资源时仍需独立验证身份和权限。

对于 Level 0，平台无法可靠观测用户在 Copilot 或 Claude Code 中做了什么，也不应伪装成能够完整追踪。网站只记录 Context Capsule 的生成、用户提交的 Artifact 和相关 Human 操作。对于 MCP 和 Connector，平台可以记录经由授权工具发生的活动，但仍不需要采集 Agent 的内部思维过程。

## 15. Work Session：区分业务任务与实际工作过程

Task 是业务工作单元，Work Session 是某个参与者围绕该 Task 实际开展的一段工作。二者不能混为一谈。

例如，Bob 接手一个架构分析 Task，上午在 VS Code 中使用 Copilot Chat，下午切换 Claude Code，第二天又手动修改报告，最后提交 Artifact v1。这是同一个 Task 下的多个 Work Session，而不是三个不同的业务任务。

建议 Work Session 至少记录：

- Session ID、Task ID、Work Item ID。
- Participant / Principal，以及执行方式：Human、Local Agent、Website Agent、External Agent 或 Hybrid。
- 使用的 Runtime / Tool（若可观测）、开始和结束时间。
- 本次 Session 的目标、输入 Context Version 和访问范围。
- 产生的 Activity、草稿或 Artifact 引用。
- Session 状态，例如 Active、Paused、Waiting、Completed、Abandoned。

Work Session 不是所有场景的强制对象。纯人工参与可以只记录业务活动；当需要追踪连续工作、等待恢复、跨 Runtime 接力或 Agent 执行时，再创建 Session。不能因为没有 Session 记录就认为 Task 没有发生，也不能把 Session Completed 等同于 Task Completed。

Task 可以有多个 Session，Session 可以由 Human、Agent 或二者共同参与。Task 的责任人仍然是 Human 或被指定的业务责任主体；Agent Session 只是被授权的执行过程。即使 Agent 生成了完整报告，Task 是否完成、是否提交、是否进入评审，仍由业务规则和有权限的 Human 操作决定。

## 16. 端到端场景：同一事项，多种工作方式

### 16.1 场景 A：纯 Human 协作

Requester 在网站创建事项，Architect 接手 Task，上传分析报告，Reviewer 在网站查看并提交评审意见，Architect 修改后提交新版本。Business Owner 或 Approver 查看材料并作出正式决定。所有步骤都在网站完成，不需要 Agent、MCP 或 Skill。

### 16.2 场景 B：临时使用 Copilot Chat

用户打开 Task，复制网站生成的 Context Capsule，将一两句话和必要上下文粘贴到自己日常使用的 Copilot Chat。Copilot 帮助整理分析、比较方案或起草报告。用户检查结果后，将内容作为 Artifact 提交到网站。

网站不需要知道用户的 Copilot Session ID，也不需要为此创建专用 Agent、安装 Skill 或运行脚本。Agent 的分析内容仍是工作草稿，用户提交也不意味着正式批准；后续评审和 Human 决策按业务流程进行。

### 16.3 场景 C：深度连接本地 Copilot 或 Claude Code

用户在网站选择连接本地 Agent，完成一次明确授权。本地 Connector 获取当前 Task 的最小上下文，启动或连接用户选择的 Runtime。Runtime 可以访问用户授权的本地文件和工具，生成分析产物，再由 Connector 提交回网站。

网站记录授权关系、Session 元数据、提交的 Artifact 和可观测的工具活动，但不需要接管本地 Agent 的会话管理。用户可以中断、切换 Runtime 或手工继续；业务 Task 不会因为某个本地 Session 结束而丢失。

### 16.4 场景 D：网站内置 Agent 辅助

用户在网站内选择“辅助分析”。Website Agent 根据授权范围检索知识库、整理材料、分析缺失信息并形成建议。若缺少业务信息，它可以提出问题并将 Task 标记为等待 Human 输入；Requester 补充后，Agent 可以继续分析。

Agent 可以提交分析草稿或建议，但不能自行确认评审结果、批准事项或关闭 Work Item。需要正式结论时，系统把草案交给对应 Human 确认。

### 16.5 场景 E：多人使用不同 Agent 并行工作

同一个 Work Item 中，Bob 使用 Copilot 分析应用架构，Carol 使用 Claude Code 检查本地配置和代码，David 使用网站 Agent 检索企业标准。三人各自拥有 Task 和 Work Session，结果作为不同 Artifact 汇集到同一个 Work Item。

Alice 作为 Reviewer 获得被授权的材料，独立审查这些产物。Agent 可以协助 Alice 整理差异和风险，但正式 Review Outcome 由 Alice 确认。最终业务决定由有权限的 Business Owner 或 Approver 作出。

### 16.6 场景 F：临时 Agent 咨询，不启动完整流程

参与者可能只是想针对事项中的一个问题向 Agent 咨询，例如“这个方案是否存在数据驻留风险”。这类咨询可以记录为关联当前 Work Item 的 Collaboration Message 或轻量 Work Session，不必自动创建完整审批流程。只有当分析结果需要正式交付、评审或产生后续工作时，才提升为独立 Task 或 Artifact。

这些场景应共享同一套业务模型。差异在于工作入口和执行方式，不应为每一种 Agent Runtime 建立一套独立的事项、状态和产物系统。

## 17. 记录模型：业务事实、工作过程、产物和讨论分开保存

不要把所有交互压成 Chat History。建议明确区分四类记录：

| 记录类型 | 记录什么 | 例子 | 权威性 |
| --- | --- | --- | --- |
| Business Activity | 事项和流程中的正式业务动作 | 接手任务、邀请 Reviewer、Human 确认决策、关闭事项 | 业务审计依据 |
| Work Activity | 人或 Agent 实际执行的工作 | 检索资料、运行分析、修改草稿、生成风险清单 | 执行过程记录，不代表业务决定 |
| Artifact | 可引用、可版本化的工作产物 | 分析报告、架构图、Review Findings、Decision Draft | 依据类型和确认状态决定 |
| Collaboration Message | 围绕问题的讨论、提问和回复 | Requester 补充、Agent 提问、Human 评论 | 讨论上下文，不自动成为正式事实 |

Work Activity 可以记录“Copilot 辅助生成了架构分析草稿”，但不能记录成“架构方案已批准”。Decision Draft 可以保存 Agent 推荐的选项和理由，但只有 Human 确认后才创建正式 Decision。业务审计日志不应依赖 Agent 自己声称“我已批准”；它必须来自服务端验证过的 Human Principal 和授权操作。

## 18. 身份、SSO 与 Agent 委托授权

网站有 SSO，并不意味着用户本机的 Copilot、Claude Code 或其他 Agent 自动获得网站权限。用户登录浏览器，也不代表本地 Agent 可以读取浏览器 Cookie。不要把浏览器会话凭证复制给 Agent，也不要让 Agent 通过共享用户密码模拟 Human。

深度连接应使用明确的委托授权流程，例如 OAuth Authorization Code + PKCE，或符合企业身份平台要求的 Device Authorization。Token 应短期有效、范围最小、可撤销，并绑定用户、Agent Client、Work Item / Task、允许动作和资源范围。不同 Agent Session 不应自动继承用户的全部权限。

身份模型应分开记录：

- **Human Principal**：真实登录并发起委托的用户。
- **Agent Execution Identity**：实际执行工具调用的 Agent 或 Connector 身份。
- **Delegation Grant**：Human 授予该 Agent 的有限权限，包含范围、有效期和撤销状态。
- **Business Participation**：Human 或 Agent 在 Work Item 中的业务参与关系。

审计链应能表达“Bob 委托本地 Connector 启动 Copilot Session 123，Session 生成 Artifact v2，Bob 检查并提交”。不能把 Agent 的执行行为记在 Bob 名下而隐藏 Agent 身份，也不能因为 Agent 是 Bob 启动的就认为它可以执行 Bob 有权执行的所有动作。Human 委托给 Agent 的权限只能是其本人权限的受限子集，并且仍受 Agent Principal 的动作限制；正式决定权不能通过委托转移给 Agent。

## 19. API 与工具边界

API 应围绕 Work Item 和 Task 提供明确的业务操作，而不是开放一个可以任意修改对象的万能接口。一个初始 REST API 可以包括：

| API | 用途 |
| --- | --- |
| `GET /work-items/{id}` | 读取有权访问的事项 |
| `GET /work-items/{id}/context` | 获取当前授权范围内的上下文视图 |
| `GET /work-items/{id}/tasks` | 列出事项任务 |
| `POST /tasks/{id}/sessions` | 创建 Work Session |
| `POST /tasks/{id}/activities` | 记录可审计的工作活动 |
| `POST /tasks/{id}/artifacts` | 提交分析产物或草案 |
| `POST /tasks/{id}/comments` | 添加讨论消息 |
| `POST /tasks/{id}/request-input` | 请求 Human 补充信息 |
| `POST /tasks/{id}/handoff` | 发起任务交接请求 |
| `POST /tasks/{id}/complete` | 提交任务完成请求，由业务规则判断是否可完成 |

MCP Tool 不需要与 REST API 一一对应。面向 Agent 的工具应表达工作意图，例如 `get_my_work`、`prepare_work_context`、`submit_analysis`、`submit_review_findings`、`prepare_decision_draft`、`request_human_confirmation`。不要暴露一个不受约束的 `update_work_item`，更不能给 Agent 提供正式批准、确认决定或关闭事项的工具。

`POST /tasks/{id}/complete` 对 Agent 应解释为“提交工作结果或完成请求”，不是直接把业务事项推进到已批准或已关闭。服务端需要区分 Task Execution Status、Artifact Submission Status 和 Business Workflow Status。Agent 可以完成自己的分析执行，但 Task 是否被业务接受、Review 是否通过、Decision 是否生效，都由相应 Human 或确定性业务规则处理。

## 20. 调整后的落地顺序与验收重点

实施时建议先把 Human 主导的业务闭环做正确，再逐步增加 Agent 接入能力：

1. **业务骨架**：Work Item、Participation、Task、Artifact、Review、Decision、Human 确认、审计。先确保纯 Human 流程完整可用。
2. **低门槛 Agent 使用**：Context Capsule、Copy / Paste、草稿提交和结果归集。无需连接任何 Runtime。
3. **网站内置 Agent**：提供搜索、整理、分析、请求补充和草稿生成能力；所有正式确认保留给 Human。
4. **MCP / Remote API**：提供最小权限、可审计的事项读取和结果提交工具。
5. **Local Connector**：支持 Copilot SDK/CLI、Claude Code 等不同本地 Runtime，保持 Runtime-independent。
6. **团队 Skill 与跨组织 A2A**：在确实需要复用专业工作方法或委托外部 Agent 服务时再增加。

验收不能只检查 Agent 能否完成任务，还必须检查业务权力边界：

- 没有 Agent 的用户可以独立完成事项全流程。
- 用户只复制一段 Context Capsule 就能使用自己的 Agent，不需要先安装 Skill 或连接 SDK。
- 同一 Task 可以切换多个 Runtime 或回到人工处理，Task 和 Artifact 历史不丢失。
- 多人使用不同 Agent 并行工作，产物能回到同一个 Work Item 并保留来源。
- Agent 可以提交分析、建议、Review Findings 和 Decision Draft，但不能确认它们为正式结果。
- Agent Principal 调用批准、拒绝、确认决定、确认正式 Review 或关闭事项的接口时，服务端必须拒绝。
- 只有具备相应权限的 Human 能确认 Decision Draft，并产生正式 Decision。
- Human 确认后，工作流可以自动推进后续确定性步骤，但审计记录必须保留真实 Human 决定者。
- Agent 的建议、工作活动和聊天内容不会被误记为业务事实或组织决定。
- SSO 登录不会自动授予本地 Agent 权限；委托范围可查看、可撤销、可过期。
- 对 Level 0 Copy / Paste，系统不声称可以追踪 Agent 内部执行；对集成方式，只记录实际经过平台的活动。


## 21. 协议边界：REST/OpenAPI、MCP、A2A 和 ACP 不是同一层

讨论“网站如何连接 Agent”时，容易把所有协议都当成 Agent Protocol。实际上，它们解决的是不同的连接关系。设计时应先确定哪一方是 Client、哪一方是 Server、谁持有业务状态，再决定使用哪种协议。

| 协议 | 主要通信关系 | 提供的能力 | 不负责什么 |
| --- | --- | --- | --- |
| REST / HTTP API | 应用、网站、CLI、Connector 与业务服务 | 业务资源、命令、状态查询、标准 HTTP 认证 | Agent 内部执行和多 Agent 编排 |
| OpenAPI | API 提供方与客户端生成工具 | 描述 HTTP 路径、Schema、认证和操作契约 | 运行时授权决策和业务流程 |
| MCP | Agent Host / Client 与工具、资源 Server | Tools、Resources、Prompts、Elicitation、能力协商和 HTTP 授权 | Work Item 生命周期、组织角色、正式审批 |
| A2A | 独立 Agent Client 与 Remote Agent | Agent Card、Message、Task、Artifact、异步进度和跨 Agent 委托 | 企业 Case、参与者管理和业务决策权 |
| ACP（Agent Client Protocol） | 编辑器、桌面客户端或 Connector 与本地 Coding Agent Runtime | 本地 Session、Prompt、流式更新、取消和运行时能力协商 | 企业业务事项、跨部门角色和审批 |
| CloudEvents / AsyncAPI | 业务服务与事件消费者 | 事件 Envelope、消息 Channel 和异步接口描述 | 业务事件是否合法、谁能触发事件 |

### 21.1 REST/OpenAPI 应该是业务服务的稳定接口

业务系统首先应定义自己的领域 API。Web UI、移动端、CLI、Local Connector、MCP Server、Webhook 和第三方服务都通过这一层访问 Work Item 服务。

例如：

- `GET /work-items/{id}`：读取事项。
- `GET /work-items/{id}/context`：读取当前授权的上下文视图。
- `GET /tasks/{id}`：读取任务。
- `POST /tasks/{id}/artifacts`：提交分析产物。
- `POST /tasks/{id}/recommendations`：提交建议。
- `POST /decision-drafts/{id}/confirm`：Human 确认决策草案。
- `POST /decisions/{id}/record`：记录授权 Human 已作出的正式决定。

OpenAPI 可以描述这些接口并生成 TypeScript、Python、Java 或其他客户端，但 Schema 中的 `confirm` 并不代表 Agent 可以调用。谁能调用仍由服务端根据 Principal 类型、Participation、角色、作用域、事项状态和策略校验。

不要因为某个 Agent 支持 MCP，就把 MCP Server 当成唯一后端。否则所有客户端、业务集成和自动化系统都必须围绕模型工具协议工作，业务接口会被 Agent Host 的实现细节绑住。

### 21.2 MCP 适合包装 Agent 需要的业务操作

MCP 定义 JSON-RPC 基础协议、版本与能力协商、HTTP 授权机制，以及 Server 提供的 Tools、Resources、Prompts；Client 侧还可以支持 Elicitation、Sampling 和 Roots。不同能力是按需协商的，不代表每个 MCP Client 都支持全部特性。参见 [MCP Specification](https://modelcontextprotocol.io/specification/2026-07-28) 和 [MCP Server Tools](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx)。

对业务网站而言，MCP 可以提供：

- Resources：当前用户可访问的 Work Item、Task、Artifact、流程定义和相关知识。
- Tools：查询待办、读取任务上下文、提交分析、提交 Review Findings、请求补充信息、创建 Decision Draft。
- Prompts：架构分析、风险检查、方案比较等任务模板。
- Elicitation：请求用户补充结构化输入，或者引导用户到受信任的网页完成敏感授权。

MCP 的 Tools 是面向模型调用设计的，但协议本身不规定必须采用哪种 Human 交互 UI。规范建议宿主能够拒绝工具调用、显示工具执行状态，并在需要时请求用户确认。Elicitation 可以请求 Human 输入，但它本身不是正式业务审批引擎。

因此，不应把“Agent 发起了一次 MCP Tool Call，用户点击了客户端确认”直接记成业务 Decision。MCP Client 的工具授权与 Work Item 的正式业务决定是两个不同的记录和权限层。

建议 MCP Tool 使用业务意图命名，例如：

```text
get_my_work
prepare_work_context
list_accessible_artifacts
submit_analysis
submit_review_findings
prepare_decision_draft
request_human_confirmation
```

不向 Agent 提供 `approve_work_item`、`confirm_decision`、`reject_request` 或 `close_case`。即便外部 MCP Server 暴露了类似工具，本系统也不能信任客户端是否展示了确认对话框；服务端必须自己检查调用身份。

### 21.3 A2A 负责跨独立 Agent 服务委托

A2A 1.0 定义 Agent Card、Message、Task、Artifact、Context ID、异步状态和 Push Notification。它适合调用其他组织或团队提供的独立 Agent 服务。例如安全情报 Agent、外部合规分析 Agent、供应商架构评估 Agent。

A2A 的 Task 是远端 Agent 管理的有状态工作单元；Context ID 把相关 Task 和 Message 组织成一个交互上下文。它不是本地 Work Item ID，也不是用户参与关系。A2A 的 Task History 也不保证包含所有瞬时消息，规范明确不应把普通 Message 当作关键业务信息的可靠持久化机制。正式业务信息仍需落入本地 Artifact 和 Activity 账本。

建议建立以下关联，而不是让 A2A ID 取代业务 ID：

| 本地对象 | 作用 |
| --- | --- |
| Work Item ID | 本地业务事项的稳定身份 |
| Collaboration Task ID | 本地任务、责任、权限和 SLA |
| Work Session ID | 人或 Agent 实际执行的一段工作 |
| A2A Task ID | 远端 Agent 的协议任务 |
| A2A Context ID | 远端 Agent 的交互上下文 |
| Artifact Reference | 远端产物进入本地 Artifact 版本体系后的引用 |
| Correlation ID | 贯穿委托、回调和事件链路的追踪标识 |

参考：[A2A 1.0 Specification](https://a2a-protocol.org/v1.0.0/specification/)、[A2A Key Concepts](https://a2a-protocol.org/latest/topics/key-concepts/)。

### 21.4 ACP 是本地 Agent Runtime 接口，不是业务系统协议

这里的 ACP 指 [Agent Client Protocol](https://agentclientprotocol.com/)，它主要标准化编辑器或客户端与 Coding Agent Runtime 的通信。协议使用 JSON-RPC 2.0，围绕初始化、Session 创建或恢复、Prompt、Session Update 和 Cancel 等操作展开。

ACP 很适合需要嵌入本地 Coding Agent 的 IDE、桌面客户端或 Local Connector。它能减少不同 Runtime 各自定义 Session 生命周期、Prompt 传输和流式事件格式带来的适配工作。

它不管理企业用户、Work Item、Reviewer、Approver，也不负责持久化业务决策。不要把 ACP Session 当作 Work Session 的唯一实现，更不能把它的 Session ID 当成业务 Task ID。

还需要留意 ACP 缩写的歧义：Agent Client Protocol 与早期 IBM/BeeAI 语境中的 Agent Communication Protocol 不是同一个概念。讨论当前 Coding Agent 集成时应写全称，避免把它与 A2A 混淆。

### 21.5 Events 是状态变化通知，不是第二套业务数据库

业务事件可采用 CloudEvents Envelope，并通过 AsyncAPI 描述异步消息接口。事件例如：

- WorkItemCreated
- ParticipationChanged
- TaskAssigned
- ArtifactSubmitted
- ReviewRequested
- DecisionDraftPrepared
- HumanDecisionConfirmed
- WorkItemClosed

事件消费者可以负责通知、搜索索引、Agent 唤醒和外部同步。事件发布建议使用 Transactional Outbox，避免数据库状态已提交而事件丢失。

事件本身不能绕开命令入口。Agent 不能通过发布一个 `DecisionConfirmed` 事件来伪造 Human 决定；事件必须来自服务端验证过的业务命令，并保留 Actor、Principal Type、Role、Resource Version 和 Policy Version。

## 22. BPMN、CMMN、DMN：三种业务建模标准各自解决什么问题

当前设计里最值得进一步引入的不是某个 Agent Framework，而是 OMG 的 BPMN、CMMN 和 DMN。它们不是 Agent 标准，但能描述业务活动、动态工作和确定性业务规则。

### 22.1 BPMN：流程顺序明确时使用

BPMN 适合步骤、条件和责任相对确定的工作，例如：

`Request submitted → Analysis → Review → Human approval → Implementation`

它能描述 User Task、Service Task、Gateway、Boundary Event、Timer 和 Subprocess。对于强制审批、合规流程、明确的 SLA 和升级路径，BPMN 很合适。

但如果每个事项都需要先判断是否要增加 Specialist、是否要补充材料、是否要做额外风险调查，强行把每一种可能性都固化成 BPMN 节点，模型会逐渐膨胀。

### 22.2 CMMN：动态事项和知识工作更接近当前场景

CMMN（Case Management Model and Notation）是 OMG 的 Adaptive Case Management 标准。它围绕 Case、Case File、Plan Model、Plan Item、Stage、Milestone 和 Sentry 建模。Case 的工作可以根据新信息和当前状态，以不固定顺序推进。

这与架构分析、风险调查、数据评估、合规审查等知识工作非常相似：

- 一开始只知道需要架构分析。
- 分析中发现安全问题后，增加 Security Review。
- 数据团队发现数据驻留风险后，再加入 Data Specialist。
- 新的业务信息到达后，重新激活某些活动。
- 事项完成某个里程碑后，部分动作不再允许。

CMMN 的核心价值不是“Agent 可以决定下一步”，而是**Case 状态定义当前哪些活动可用，哪些活动必须等待 Human 或业务规则触发**。OMG 对 CMMN 的定位明确强调动态工作与知识工作，并让 Human 保持在驾驶席上。

参见 [OMG CMMN](https://www.omg.org/cmmn/)、[Flowable CMMN 1.1 Concepts](https://www.flowable.com/open-source/docs/cmmn/ch06-cmmn)。

### 22.3 DMN：确定性规则与 LLM 建议分开

DMN（Decision Model and Notation）是业务规则与决策逻辑的建模标准，能和 BPMN/CMMN 一起使用。

例如：

- 事项类型是架构评估，必须有 Architect Owner。
- 风险等级为 Critical，必须有 Security Review。
- Artifact 进入正式评审之前必须完成指定证据检查。
- Production 风险接受必须由指定权限等级的 Human 批准。

这些是可解释、可测试、可重复的规则，应由 DMN 或普通确定性代码实现。LLM 可以分析材料并建议风险等级，但它不能通过生成一段 JSON 就修改组织规则或授予自己权限。

不要将 DMN 的 Decision Table 与本设计中的正式业务 Decision 混为一谈：前者是可执行的规则模型；后者是由授权 Human 对具体事项作出的决定记录。

OMG 的 [DMN 规范](https://www.omg.org/spec/DMN) 当前正式版本为 1.6，1.7 仍为 Beta。DMN 设计上就是与 BPMN 和 CMMN 配套的业务决策与规则模型。

### 22.4 Work Item 是否应直接等于 CMMN Case？

不应该强行等同。

Work Item 是本系统的业务领域对象；CMMN Case 是工作流引擎中的执行与建模对象。两者可以一对一映射，也可以按业务类型拆成多个 Case。

建议 Work Item 服务继续拥有业务 ID、参与关系、上下文版本、Artifact、Review 和 Decision。若使用 CMMN，Case Instance ID 作为执行关联 ID 保存。这样即使将来更换工作流引擎，业务对象仍然稳定。

CMMN 对动态 Case 特别有价值，但不代表所有事项都必须启动 Case Engine。简单的咨询、一次性任务和无需正式流程的事项，不应该被流程模型强行复杂化。

## 23. 工作流与 Agent 执行项目比较

以下比较区分**业务事项管理、流程编排和 Agent 执行**。它们并不是同一类产品。

### 23.1 Flowable：与动态 Case / Work Item 语义最接近

项目：[flowable/flowable-engine](https://github.com/flowable/flowable-engine)

Flowable 的核心开源引擎提供 BPMN、CMMN 和 DMN，使用 Java，可以嵌入应用或通过服务/API 集成，许可证为 Apache 2.0。它的 CMMN Engine 和 Human Task 模型值得作为 Work Item 生命周期的重点参考。

Flowable 近期的 Agentic Case Platform 把 Agent 作为 Case 中的参与者，使用 CMMN Plan Item 表达 Agent 可以选择的活动。Case 进展会动态改变可执行的 Plan Item。其企业产品也提供 Agent 类型、Guardrail、Evaluator、External Agent、A2A Agent 和 Work MCP Server 等能力。

尤其值得关注的是 Flowable Work MCP Server：它允许 Agent 读取并操作 Flowable Work 中的 Process / Case / Task，MCP Tool 的权限和 Tenant Scope 与 Work REST API 保持一致。这是“同一个业务授权模型同时供 Web UI 和 MCP 使用”的商业实现例子。

但有一个重要的产品边界：**Flowable BPMN/CMMN/DMN 核心引擎是 Apache 2.0；Flowable Agentic Case Platform、Work MCP Server 等能力属于企业产品文档范围，不能假定它们都包含在开源 Engine 中。** 需要按实际产品版和授权核对。

适合借鉴：

- CMMN Case / Plan Item / Sentry。
- 动态参与者和人类任务。
- 案件状态控制允许的工作项。
- BPMN、CMMN 与 DMN 的协作。
- MCP Tool 和 REST API 共用权限模型。
- Guardrail / Evaluator 作为单独治理组件。

不应直接复制的地方是：Flowable Agentic Platform 支持可配置的 Agent 自主程度，某些场景允许 AI 自动完成决定；当前业务要求不允许这种自动业务决定。需要把 Human Decision Gate 设成固定规则，而不是一个可被流程模型随意放宽的可选 Autonomy Level。

参考：[Flowable Open Source](https://www.flowable.com/open-source)、[Agentic Case Platform](https://www.flowable.com/product/agentic-case-platform)、[AI Capabilities Overview](https://documentation.flowable.com/latest/ai/ai-introduction)、[Work MCP Server](https://documentation.flowable.com/latest/ai/ai-work-mcp-server)。

### 23.2 Camunda：确定性 BPMN 与 Agent 运行结合得较好

项目：[camunda/camunda](https://github.com/camunda/camunda)

Camunda Agentic Orchestration 把确定性 BPMN 流程、Agent Task、工具调用和 Human Task 放在同一流程模型中。Agent 可以根据上下文选择工具，但 Camunda 控制流程边界、重试、Incident 和 Human Task。

值得研究的能力：

- AI Agent Task 和 Agent Subprocess。
- Agent 工具调用前后的 User Task / Approval Gate。
- 连接 LangGraph、CrewAI 等外部 Agent Runtime。
- Agent Instance API：外部 Runtime 向 Camunda 报告 Agent 执行状态、Tool Call、Conversation 和用量。
- Operate 对 Agent 执行过程的观测。

其中 External Agent 的设计尤其重要：Camunda 负责编排何时调用外部 Agent；外部 Runtime 仍然拥有真正的执行状态。Camunda 的 Agent Instance 是观测和解释对象，不应误认为它是外部 Runtime 的真实执行状态来源。

Camunda 8.10 增强了 Agent 的实时可见性和 Agent Instance API，对外部 LangGraph / CrewAI Agent 也可以使用同样的追踪能力。

必须考虑许可：Camunda 8.6 及以上版本的核心组件源代码使用 Camunda License v1，编译产品在生产环境需要 Enterprise Edition；不能再简单按照“Camunda 全部是 Apache 开源”进行评估。Connector SDK、REST Connector 等部分组件仍使用 Apache 2.0。

适合：明确的业务流程、严格审批、复杂 BPMN、需要统一流程运行时和 Agent 执行观测的环境。

不适合：仅为了一个动态 Work Item 引入完整流程设计平台，或者希望长期完全依赖 Apache 2.0 开源运行时的场景。

参考：[Agentic Orchestration](https://docs.camunda.io/docs/components/agentic-orchestration/agentic-orchestration-overview/)、[Connect External Agent](https://docs.camunda.io/docs/components/agentic-orchestration/connect-external-agent/)、[Agent Instance API](https://docs.camunda.io/docs/components/agentic-orchestration/agent-definitions-and-instances/)、[Camunda Licensing](https://docs.camunda.io/docs/reference/licenses/)。

### 23.3 Temporal：长期运行、等待和可靠恢复能力突出

项目：[temporalio/temporal](https://github.com/temporalio/temporal)

Temporal 是 Durable Execution 平台，不是 Case Management 产品。它把 Workflow 执行状态持久化，支持长时间等待、失败恢复、重试、超时、Timer 和 Signal。Temporal Server 使用 MIT License，可自托管。

如果选择代码驱动的业务流程，而不是 BPMN/CMMN 图形建模，Temporal 是很有竞争力的候选。尤其适合 Agent 运行可能持续数小时或数天、需要等待 Human 输入、外部事件和工具执行结果的场景。

但需要自己定义 Work Item、参与关系、权限、Artifact、Decision 和业务生命周期；Temporal Workflow 不会自动变成完整的业务事项平台。

### 23.4 Temporal Agent Kit：最值得研究的 Agent Execution 实现之一

项目：[temporal-community/temporal-agent-kit](https://github.com/temporal-community/temporal-agent-kit)，许可证 MIT，但 README 明确标注 Experimental，API 仍可能变化。

Agent Kit 的核心思路是：**一个 Agent 是一个 Temporal Workflow**。它在 Temporal 的持久化执行基础上，提供类型化消息、Handler、Tools、Streaming、Agent Composition、Human Approval 和可观测事件流。

可直接借鉴的设计：

**Typed Agent Interface。** Agent 用具名 Handler 声明可接收的操作，并用 Schema 定义输入输出。Agent 不是一个只能接收自然语言的黑盒，而是可以被应用和其他 Agent 以结构化方式调用。

**Durable Human Approval。** 某个工具调用需要批准时，Workflow 暂停并等待 Human。人几分钟、几天后回应都可以继续，不需要保持一个 HTTP 请求或进程一直运行。

**Safe-by-default ToolApprovalPolicy。** 当前实现要求 Agent 明确配置默认 Approval Policy。使用 `always_require_human_approval()` 时，所有工具调用都进入 Human Gate；只有静态安全声明或显式的工具 allow-list 才能绕过。未配置规则的工具不会自动放行。

**Auto Mode 的 fail-safe。** 如果启用了动态评估器，它可以对工具调用做三值判断：APPROVE、DENY、ESCALATE。评估器异常、返回非法数据或不确定时，都会升级到 Human Gate；Human 如果先作出决定，正在运行的评估器会被取消。每次评估都有开始和结束/异常/取消事件，便于审计。

**Callback Tools。** Agent 可以请求在客户端执行一个工具，例如访问用户本机的文件或私有网络资源；Workflow 暂停，Client 执行后把结构化结果返回。它把本地工具执行与云端 Agent Worker 分开，是 Local Connector 设计的一个有价值模式。

**Typed Event Stream。** Agent 的消息、工具调用、审批请求、工具执行结果、Subagent Handoff 和 Token Usage 通过统一事件流暴露，Client 可以按 Offset 恢复。

需要明确边界：Agent Kit 的 Tool Approval 是对“是否允许调用某个 Tool”的执行权限控制，不等于正式业务 Decision。它的 Auto Mode 可能自动放行某些工具调用，但不能借此让 Agent 自动确认架构方案或业务审批。对当前平台，Decision Draft 的确认必须使用独立 Human-only 业务接口，不能复用 Agent Kit 的工具审批策略。

还有一个实现层面的限制：当前 Agent Kit 的 API/UI Server 主要由 Python Package 提供，TypeScript 负责 Agent Worker；它不是纯 TypeScript 的统一服务端框架。Agent Kit 仍是 Experimental，需要固定版本并评估升级成本。

参考：[Agent Kit README](https://github.com/temporal-community/temporal-agent-kit)、[Capabilities](https://github.com/temporal-community/temporal-agent-kit/blob/main/docs/guides/capabilities.md)、[Approvals](https://github.com/temporal-community/temporal-agent-kit/blob/main/docs/guides/approvals.md)、[Agent Kit API](https://github.com/temporal-community/temporal-agent-kit/blob/main/docs/api/README.md)、[Approval Tests](https://github.com/temporal-community/temporal-agent-kit/blob/main/typescript/packages/worker/test/agent-workflow/approvals.test.ts)。

### 23.5 LangGraph 和 n8n 的位置

LangGraph 适合 Agent 内部图执行、Checkpoint、Interrupt/Resume 和多 Agent 编排；它不提供完整的多人 Work Item 管理、组织身份和业务审批模型。

n8n 擅长自动化工作流以及在 Tool Call 周围插入 Human Review。它很适合做局部自动化和审批拦截，但不应直接被当作企业 Case Management 的完整替代品。

选择时应按层比较，而不是简单地把这些框架排成一个“最好用”的榜单。

## 24. 商业产品：已有平台如何让外部 Agent 使用业务系统

### 24.1 Atlassian Rovo MCP：最接近“用户自己的 Agent 直接连接工作网站”的实例

Atlassian 提供官方 Remote MCP Server，支持 Jira、Confluence、Jira Service Management、Bitbucket、Compass 等产品。它可以连接 ChatGPT、Claude、VS Code/GitHub Copilot、Cursor 等 MCP Client。

它的模式是：

1. Agent Client 连接 Atlassian 托管的 MCP Server。
2. 用户通过 OAuth 2.1 完成授权。
3. MCP Server 按 Atlassian 用户已有权限读取和修改 Jira / Confluence 数据。
4. 管理员控制 Read、Write、Search、Delete、Manage 等工具组。
5. MCP Server 先暴露常用工具，其他工具按需发现，避免一开始把所有工具塞给模型。

这正是 Level 1 MCP 接入的成熟商业案例。它说明网站不必为每一种 Agent Runtime 单独开发插件：只需要维护稳定的业务 API 和统一 MCP Adapter。

但 Atlassian 的默认模式主要是“Agent 借用当前用户授权访问 Jira”。如果将这种模式用于多个 Agent、不同 Work Item 和不同业务角色，仍要额外实现 Task 范围授权和 Human 决策身份。用户能在 Jira 执行某个操作，不代表其 Agent 可以在所有 Work Item 中执行该操作。

参考：[Atlassian MCP Server](https://atlassian.github.io/atlassian-mcp-server/)、[Atlassian MCP Security](https://support.atlassian.com/security-and-access-policies/docs/understand-atlassian-mcp-server/)、[Rovo MCP Developer Guide](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/)。

### 24.2 ServiceNow：Agent 辅助现有审批记录

ServiceNow 的 Approval Assistance AI Agent 可以读取当前用户待处理的 Approval Records、获取最新详情、生成基于知识库的评估 Checklist，并支持审批与拒绝操作。

这是“Agent 进入已有业务记录和审批任务”的典型企业实现。设计上值得借鉴它围绕现有审批记录提供检索、摘要和证据，而不是另建一套 Agent Chat 记录。

但正式审批动作必须明确是用户指示下的 Human 操作，还是平台授予 Agent 的操作权限。当前设计只允许前者。

参考：[ServiceNow Approval Assistance AI Agent](https://www.servicenow.com/docs/r/intelligent-experiences/plat-approval-assistance-ai-agent.html)。

### 24.3 Salesforce Agentforce：把审批人工作台放进对话界面

Salesforce 的 Approval Agent 可以查询审批工作项、汇总资料、生成评论建议，并在审核人员作出决定后同步底层 Approval Record。用户可以从 Salesforce 或 Slack 中操作审批。

这个案例值得借鉴的是：Agent 可以把背景、证据、历史和待处理事项汇总到一个对话入口，但正式决策仍然应与具体 Reviewer / Approver 的身份关联，而不是把 Agent 记录成审批人。

参考：[Salesforce Agentforce for Advanced Approval](https://help.salesforce.com/s/articleView?id=ind.rev_agent_approval_agent.htm&language=en_US&type=5)。

### 24.4 Microsoft Copilot Studio：AI Approval 不符合当前默认治理约束

Copilot Studio 的 Multistage Approvals 提供 Manual Approval Stage 和 AI Approval Stage。AI Stage 可以依据文档和规则直接产生 Approve / Reject，随后可以进入 Human Review，也可以按条件自动通过或跳过后续阶段。这些能力当前仍有 Preview 标记。

Microsoft 自己也提示，财务、法律、人事和合规等敏感审批应确保 Human Approval Stage 被执行，让 Human 保持最终控制。

这证明商业产品正在尝试把 AI 变成审批流程参与者，但对当前系统不能照搬 AI Approval Stage。即便将来增加自动化，也只能用于非业务决定的可逆工具动作或确定性规则，不得代替授权 Human 确认正式 Decision。

参考：[Copilot Studio Multistage and AI Approvals](https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-advanced-approvals)、[Human-in-the-loop Workflow Steps](https://learn.microsoft.com/en-us/training/modules/add-human-loop-workflows-copilot-studio/)。

## 25. Cumora 源码解读：最值得参考的是 Runtime 解耦、授权代理和并发控制

项目：[yetone/cumora](https://github.com/yetone/cumora)

Cumora 是一个以 Team Chat 为主要产品入口的跨平台协作应用，让 Agent 与 Human 出现在同一个成员列表、私聊、群聊、Kanban Board 和 Calendar 中。它不是通用 Work Item / Case Management 平台，但已经实现了多种 Agent Runtime 接入、多 Agent 并发协作和一个证据驱动的 Shipping 工作流。

它对当前架构最有价值的地方，不是照搬它的聊天界面，而是学习它如何将**业务协作服务、Agent 执行 Runtime、本地机器和模型进程隔离**。

### 25.1 它有两条 Agent 执行路径，不是单纯的 ACP Client

Cumora 有两个执行模式：

| 执行模式 | Agent Brain 在哪里 | Agent Tool 执行在哪里 | 主要作用 |
| --- | --- | --- | --- |
| Cumora Cloud | Cumora 管理的 Kubernetes Pod / OpenAI Responses API | 每个 Agent 独立 Pod | 平台托管 Agent Runtime |
| BYOA | 用户自己的 Mac / VPS / 本地 Provider Account | 本机 Daemon 和本地 Runtime | 用户自己管理模型和 Agent Runtime |

Cloud Agent 由服务端为每个 Agent 管理 Pod，运行 Responses API 的多轮 Tool Calling Loop。BYOA 则通过 `npx cumora agent computer --pair` 把用户的机器登记为 Computer，由常驻 Daemon 驱动本地 Agent CLI。

两条路径最终都通过 Cumora 自己的 `cumora` CLI Command Contract 与业务服务交互，并使用同一个 LLM Call Ledger。换句话说，Cumora 抽象的是“Agent 可以执行哪些业务命令”，而不是要求所有 Runtime 使用同一个模型 SDK。

这一点非常值得借鉴：**业务工具协议稳定，Runtime Adapter 可以因 Agent 产品而不同。**

参考：[Cumora README](https://github.com/yetone/cumora)、[BYOA Design](https://github.com/yetone/cumora/blob/main/docs/BYOA.md)。

### 25.2 Engine Adapter：协议兼容不等于把所有 Runtime 伪装成同一种 Runtime

Cumora 的 `server/src/agents/computer/engine.ts` 定义了不同 Engine 的启动和交互适配。

其 Runtime 接入方式包括：

| Runtime | Cumora 适配方式 |
| --- | --- |
| Claude Code | 原生 CLI / stream-json |
| Codex | CLI exec 或 App Server 等路径 |
| Pi | RPC |
| ZCode | `zcode-acp-server` ACP Bridge |
| OMP | `omp acp` |
| Grok Build | ACP 兼容路径 |
| Cursor、OpenCode、Gemini CLI、Qwen Code、Antigravity 等 | 各自 CLI Adapter 或兼容模式 |

这说明 ACP 在 Cumora 中是部分 Runtime 的 Client/Runtime 协议，不是 Cumora 的业务协作协议。ACP Adapter 只负责 Runtime Session、Prompt 和事件；上层业务操作仍走 Cumora 自己的 CLI Contract。

可以借鉴这种 Adapter 架构，但应增加统一的 Capability Manifest。例如某个 Runtime 是否支持持久 Session、Streaming、Cancel、MCP、Callback Tool、Workspace Access、Sandbox、Approval Request。不要假设所有 CLI 都有相同的能力和安全边界。

### 25.3 Computer、Agent、Runtime Session 三者分离

Cumora 把 Computer 作为一个独立注册对象：

- Computer 表示 Cloud、Local 或 VPS 等执行主机。
- Agent 是工作空间中的参与者。
- Engine 表示该 Agent 当前使用的 Runtime 类型。
- Session ID 是 Runtime 自己的运行时身份。
- Agent 的 Memory / Skill / Workspace 存放在各自 Agent Home 下。

一个 Daemon 可以承载多个 Agent，每个 Agent 拥有独立 Home、Memory、Skill、Session 和工作目录。Computer 负责主机在线状态、Engine 列表、Pairing 和运行负载。

这非常适合迁移到当前平台：

- Work Item Participation 不应与 Computer 绑定。
- Agent Execution Identity 不应与 Human Principal 混淆。
- Runtime Session 不应成为业务 Task。
- 用户切换 Mac、VPS、云端 Runtime 时，不应该改变 Work Item 和 Task 的身份。
- 同一业务 Task 可以由多个 Session 接续，但这些 Session 必须属于同一个授权边界。

建议在当前模型增加 `Execution Endpoint` 或 `Runtime Connection` 概念，对应 Cumora Computer；不要把它直接命名为 Agent Participant。

### 25.4 BYOA Daemon 的安全设计值得深入借鉴

Cumora 的 BYOA 设计特别强调：**模型进程不应该拿到平台凭证。**

它的主要流程是：

1. 用户使用 Workspace Pairing Code 注册 Computer。
2. 服务端保存 Device Token Hash，不以明文长期存储。
3. Daemon 持有设备身份，并为分配给该 Computer 的 Agent 获取短期 Runtime JWT。
4. Runtime JWT 绑定 Agent ID、Company ID、Computer ID、Assignment ID 和 Scope。
5. Daemon 在内存中保存 JWT，定时刷新。
6. Agent CLI 子进程不接收 Server URL、Bearer Token 或 HTTP Client。
7. Agent 产生的业务命令通过固定 MCP Bridge / File IPC 交给 Daemon。
8. Daemon 校验请求、补充身份、再调用 `/runtime/cli`。
9. 服务端每次执行都重新核对当前 Assignment，避免 Agent 已被迁移或 Computer 已被撤销后继续使用旧 Token。
10. 移除 Computer 会撤销设备凭证及其派生 Runtime 权限。

相关源码：

- [Computer Daemon](https://github.com/yetone/cumora/blob/main/server/src/agents/computer/daemon.ts)
- [Runtime JWT](https://github.com/yetone/cumora/blob/main/server/src/agents/runtime/jwt.ts)
- [Runtime Authorization](https://github.com/yetone/cumora/blob/main/server/src/agents/runtime/authorization.ts)
- [Computer Registry](https://github.com/yetone/cumora/blob/main/server/src/agents/computer/registry.ts)
- [Engine Adapters](https://github.com/yetone/cumora/blob/main/server/src/agents/computer/engine.ts)

其中值得直接吸收的设计是：

- 本地 Device 身份与用户登录会话分离。
- Agent Runtime Token 短期有效、带 Scope、绑定 Assignment。
- 服务端不能相信请求体中的 `agentId`、`companyId` 或 `computerId`；必须从已验证的 Token 获取。
- 每个请求应检查当前 Assignment 是否仍有效，而不是只验证 JWT 签名。
- Agent 子进程不获得运行时凭证，凭证保留在受信任的本地 Connector。
- 本地工作目录和 Daemon 私有 IPC 区域分离，避免模型可以覆盖自己的权限代理。

Cumora 也明确把不具备已验证 Sandbox 能力的 Runtime 放进显式兼容模式，而不是默认给予主机权限。它目前将 Claude Code 和 Codex 作为安全模式的主要适配器，其他 Runtime 需要显式开启不安全兼容开关。这种 Capability-based fail-closed 策略值得借鉴，但需要结合你自己的 Rust/本机工具安全设计重新评估，不能仅复制某个 CLI 的启动参数。

### 25.5 Local State 与 Shared Business State 分开

Cumora 的 BYOA 设计将数据拆成两类：

- Agent Local Home：Agent Memory、Notes、Skills、临时文件和 Runtime Session，保留在用户机器上。
- Server Shared State：团队共享文档、Board、Calendar、Conversation 和其他正式协作内容，由服务端保存。

这避免将 Agent 内部记忆强行同步到服务器，也避免所有外部 Agent 都需要共享同一文件系统。

对于当前系统，建议进一步明确三种数据：

1. **Private Runtime State**：模型上下文、局部缓存、Agent 内部记忆。
2. **Task Working State**：用户或 Agent 在当前 Task 中使用的临时材料、草稿和工作区。
3. **Business Artifact**：提交到 Work Item、可版本化、可评审和可追溯的产物。

只有第三类进入正式业务上下文。第二类可以通过明确的 Artifact Submission 晋升为正式产物。第一类原则上不作为业务证据，也不要求全部上传。

这是避免企业系统把 Agent 的内部记忆误当成业务知识库的重要边界。

### 25.6 固定 MCP Bridge + CLI Contract：不要把模型进程变成 API 客户端

Cumora 的本地模型进程通过固定 MCP Bridge 发起业务命令，Bridge 将受限的 argv 请求交给 Daemon 的 File IPC Broker。Daemon 在可信边界内验证后，使用自己的 Token 请求服务端。

这个设计的价值在于：模型只能调用定义好的业务命令，不能随意获取 Daemon Token 或者自行构造带身份信息的 HTTP 请求。

可以借鉴其思路，但不必复制 File IPC：

- Connector 可以是本地 HTTPS Loopback API、Unix Domain Socket 或 Named Pipe。
- IPC 请求必须限制长度、操作集合和并发。
- Daemon 需要对请求来源、Session、Work Item、Task 和授权 Grant 进行校验。
- Agent 不允许通过任意 argv 绕过业务权限边界。
- 服务端仍要重新验证授权，不能相信 Connector 已经做过检查。

### 25.7 多 Agent 协调：Cumora 的并发处理比 Prompt 规则更值得借鉴

Cumora 的 `docs/COORDINATION.md` 是项目中最值得研究的文档之一。它记录了多个独立 Agent Session 同时参与同一个 Group Conversation 时发生的竞态问题。

它将冲突分成两类：

- 模型层面的误判，例如多个 Agent 都觉得自己应该回答。
- 基础设施层面的竞态，例如两个 Agent 同时读取同一版本，然后写入互相覆盖。

后者不能靠 Prompt 修复。Cumora 使用多层服务端机制：

- 对话消息的 Seen Cursor / Sequence Freshness Gate：Agent 基于过期消息作答时，服务端拦截并要求它先读取更新内容。
- 原子 Claim：同一项工作只能被一个 Agent 成功取得。
- 数据库事务内的重复内容检测。
- Wake Debounce 和 Coalescing：将短时间重复通知合并，避免同一 Agent 不必要地多次启动。
- Per-Computer 并发限制和启动节奏控制。
- Rate Limit Cooldown：遇到模型限流时暂缓，不丢失 Inbox。
- 小模型 Triage：先判断消息是否真的需要较贵的主 Agent 运行。
- HOLD 机制：发现内容过期或有冲突时先拦截，让 Agent 读取新消息后再决定是否发送。
- SSE 唤醒 + Inbox 持久化 + 定时 Polling：防止网络断开导致唤醒事件丢失。

这些机制非常适合移植到多人多 Agent 协作：

**Freshness Gate** 可以从 Conversation Sequence 扩展到 Artifact Version 和 Context Version。如果 Agent 基于 Artifact v3 生成建议，而 Human 已经提交 v4，服务端应检测版本冲突，要求 Agent 重新读取或将产物标记为 Stale，而不是静默提交。

**Atomic Claim / Lease** 可以用于 Task 认领、Reviewer 独占任务和临时 Agent Session 调度。Claim 需要有 TTL、Heartbeat、Owner 和释放机制，避免执行节点崩溃后任务永远被占用。

**HOLD / Re-evaluate** 可以成为提交边界：Agent 产生的结果如果基于过期输入、上下文不一致或权限变化，应进入待重新确认状态，而不是直接成为新的正式 Artifact。

**Bounded Fan-out** 可以限制一个 Work Item 同时启动的 Agent 数量、每个 Computer 的并发和总模型预算，防止 Agent 之间因互相唤醒形成放大效应。

参考：[Cumora Coordination Design](https://github.com/yetone/cumora/blob/main/docs/COORDINATION.md)。

### 25.8 Cumora Shipping：证据驱动的业务阶段门槛值得借鉴，但 Agent 权限不能照搬

Cumora 的 Shipping 模块不是通用 Workflow Engine，而是一个专门针对产品交付和发布的垂直业务工作流。它的生命周期是：

`Draft → Contract → Building → Verifying → Ready → Releasing → Watching → Learned`

同时还有 Paused 和 Archived。

它有几个非常有价值的做法：

**Contract 先于执行。** 在进入 Building 前，要求定义 Problem、Desired Outcome 和 Contract Summary，避免工作开始后才发现目标不清楚。

**Invariant 与 Evidence Square 分离。** Invariant 表达必须保持的行为或约束；Verification Square 表达如何验证这些约束。每个必要 Invariant 都需要一个或多个必要的证据检查项。

**Builder / Verifier 分离。** 执行工作的人不能验证自己的工作。证据检查项有单独负责人，并记录验证结果和证据。

**阶段门槛在服务端强制。** 从 Building 进入 Verifying 前，必须保证所有必需 Invariant 都有相应验证项和负责人；进入 Ready 前，所有必须的 Verification Square 必须通过，并包含用户路径、Trace 和 Release Note 等证据。

**Release Gate。** 生产发布要求有成功的 Staging / Canary、Release Notes、Rollback Plan、Measurable Baseline 和 Approval。成功发布后仍然需要 Smoke Evidence 和生产 Readback。

**Readback 和回归闭环。** 默认生产回读时间为 24 小时；失败的 Verification 或生产 Readback 会创建 Friction Report 和 Regression Asset，使失败信息进入后续工作。

**事件与数据库约束。** 重要变化写入 append-only Shipping Events；多项约束不仅在 UI 检查，也在服务端事务和数据库层强制。

这些做法可以直接迁移到架构分析、数据治理和合规评审：

- Requirement / Invariant：需要满足的业务或技术约束。
- Evidence Requirement：证明约束成立的材料。
- Verification Task：由独立 Reviewer 或 Specialist 执行。
- Verification Result Draft：Agent 可以整理证据和推荐结果。
- Human Verification Confirmation：只有授权 Human 能确认正式验证结论。
- Decision Gate：只有授权 Human 能批准或拒绝。

但必须说明一个重要的代码级区别：Cumora 当前 Agent CLI 的 `ship square` 命令允许非 Builder Agent 将 Verification Square 标记为 `passed`、`failed` 或 `waived`，并提交相应证据或理由；它只阻止 Builder 验证自己的工作。源码位于 [server/src/agents/cli.ts](https://github.com/yetone/cumora/blob/main/server/src/agents/cli.ts#L1455-L1599)。而 Human Shipping API 中，生产 Release 的 `approve` 和 `rollback` 需要更高的 Company Role，见 [shipping-router.ts](https://github.com/yetone/cumora/blob/main/server/src/api/shipping-router.ts#L633-L715)。

这是一种 Builder / Verifier 独立性机制，但**不是“所有正式 Review Outcome 只能由 Human 确认”的严格模型**。当前业务不应照搬这一 Agent 权限。正确改造应是：

- Agent 可以提交 Evidence、Verification Findings 和 Verification Result Draft。
- Agent 可以建议通过、失败或豁免，并解释依据。
- Agent 不得把 Verification Square 从 Pending / Running 变成正式 Passed、Failed 或 Waived。
- 只有授权 Human Reviewer 才能确认正式验证状态。
- Production Approval、Decision 和 Work Item Closure 始终只允许 Human。
- 工作流在 Human 确认后自动执行状态推进、通知和后续任务创建。

Cumora Shipping 最值得借鉴的是它的 Contract → Invariant → Evidence → Gate → Readback → Regression 闭环，而不是它当前 Agent 可完成部分验证项的权限设计。

参考：[Cumora Shipping Design](https://github.com/yetone/cumora/blob/main/docs/SHIPPING.md)、[Shipping Router](https://github.com/yetone/cumora/blob/main/server/src/api/shipping-router.ts)。

### 25.9 Cumora 最值得借鉴和不应该照搬的部分

| Cumora 设计 | 建议 | 原因 |
| --- | --- | --- |
| Cloud + BYOA 双 Runtime | 大力借鉴 | 用户可以选择自己的 Runtime，平台只统一业务契约 |
| Computer 与 Agent 分离 | 大力借鉴 | 执行主机、Agent 身份和业务参与角色各自独立 |
| 短期 Runtime JWT / Assignment Binding | 大力借鉴 | 设备撤销、Agent 迁移和 Token 过期都能在服务端校验 |
| Agent 子进程不持有 Server Token | 大力借鉴 | 保护本地身份和凭证边界 |
| 每个 Agent 独立 Home / Memory / Session | 借鉴 | 降低多 Agent 本地状态互相污染 |
| Native Runtime Adapter + 少量 ACP Bridge | 大力借鉴 | 不强迫所有 Runtime 伪装成同一个协议 |
| Fixed MCP Bridge + CLI Domain Commands | 大力借鉴思路 | 模型只接触受限业务操作，不直接得到服务凭证 |
| Seen Cursor、Atomic Claim、HOLD | 大力借鉴 | 服务端解决并发和过期写入，不能靠 Prompt |
| Durable Inbox + SSE + Polling | 借鉴 | 连接中断时工作不会丢失 |
| Shipping 的 Invariant / Evidence / Gate | 大力借鉴 | 结果必须有证据，状态必须满足门槛 |
| Agent 在 Conversation 中作为成员 | 选择性借鉴 | 适合讨论，但不能代替 Participation / Role / Task 模型 |
| Group Chat 是业务中心 | 不建议照搬 | 缺少 Work Item 的版本、正式产物、独立评审和决策边界 |
| Agent 可直接通过 CLI 完成 Verification Square | 不照搬 | 与 Human-only 正式确认要求冲突 |
| 自定义 CLI Protocol 是唯一公共接口 | 不照搬 | 其他客户端和企业集成仍需要稳定 REST/OpenAPI 契约 |

Cumora 的一个局限是：它的主要协作模型围绕 Workspace、Participants、Conversations、Messages、Board 和 Shipping 等产品对象，并没有把通用 Work Item、Participation Scope、Context Version、Decision Draft 和 Human Decision 定义为一个跨业务域的标准模型。其 API 文档也说明接口契约主要维护在 TypeScript 源码和自有契约文件中，并不是一个全面以 OpenAPI 发布的通用业务协议。

因此，建议把 Cumora 视为**Agent Runtime 接入与多 Agent 协调的参考实现**，而不是完整业务事项平台的替代品。

## 26. 研究进展：真正需要关注的是授权边界，而不只是 Agent 协作拓扑

现有研究已从“多个 Agent 怎么协作”逐渐转向“Agent 在真实业务环境中怎样被授权、监督和验证”。

### 26.1 Enterprise Agent Governance

Chawla 与 Thakkar 的 [Agentic AI in Enterprise Systems: A Systematic Review of Human-in-the-Loop, Governance, and Autonomous Workflow Control](https://research.google/pubs/agentic-ai-in-enterprise-systems-a-systematic-review-of-human-in-the-loop-governance-and-autonomous-workflow-control-2/) 研究企业 Agent 系统的 Human-in-the-loop、Human-on-the-loop、自治流程控制和安全治理。其结论之一是：Human 监督对企业部署非常关键，但现有系统实现并不一致，尤其在信任、记忆、安全和跨 Agent 治理方面仍有缺口。

这支持一个设计原则：Human 决策权不能由 Agent Prompt 或单个 Runtime 的默认设置保证，需要独立的业务授权层。

### 26.2 Human-Agent Collaboration 的长期问题并未因 LLM 而消失

2026 年的 [Human–AI Collaboration Across Decision Support, Autonomous Systems, and LLM Agents: A Systematic Review and Collaboration Convergence Framework](https://doi.org/10.3390/su18115313) 综合 152 篇研究，跨越决策支持系统、自治系统和 LLM Agent。研究指出，信任校准、依赖行为、认知参与、技能保持、问责和透明性等问题，在不同 AI 技术代际反复出现。

对网站设计的启示是：不能只展示 Agent 的最终回答。用户需要看到来源、输入版本、未解决问题和建议依据，同时保留 Human 的独立判断空间。Reviewer 应能基于原始材料进行独立判断，而不是只能接受 Agent 整理后的结论。

### 26.3 Agent Workflow 研究需要把协调拓扑与治理机制分开

[Agentic Workflows in Large Language Models: A Comprehensive Review](https://link.springer.com/article/10.1007/s10791-026-10743-4) 是 2026 年发表的系统性综述，覆盖 126 篇 2023 年至 2026 年 6 月的同行评审文章。它将 Single-agent、Collaborative Multi-agent 和 Hierarchical 协调拓扑，与 Role Specialization、Tool Augmentation、Hybrid Memory 和 Human-in-the-loop Governance 分成不同维度。

这非常符合当前架构的建模方式：

- Supervisor、Group Chat、Handoff 是执行协调拓扑。
- Analyst、Reviewer、Specialist 是功能角色。
- MCP、A2A、ACP 是集成和通信能力。
- Work Item、Participation、Decision 是业务治理模型。

它们不应该被压成一个 Agent Profile 或一个 Workflow JSON。

### 26.4 审批需要同时验证“拒绝确实阻止”和“批准确实完成”

2026 年 11 月 14 日发布的预印本 [Auditable Authorization for LLM Agents: Empirical Evidence Across Model, Harness, and Workflow Layers](https://arxiv.org/abs/2611.19237) 研究了 Human Approval 在 Model、Harness 和 Workflow 三个执行边界中的实际效果。

它的重要观点是：Human Approval 只有在拒绝后动作确实停止、批准后授权动作确实完成时，才是有效控制。只验证 UI 出现了“Approve / Reject”按钮是不够的。模型可能正确生成了审批请求，但 Harness 丢失批准结果；也可能 Workflow 在 Reject 后仍然执行了副作用。

这篇预印本的结果应当作为研究证据而非定论，但它提出了非常实用的验收标准：

- Reject 后底层业务副作用必须不存在。
- Approve 后指定动作必须可追踪地完成，不能丢失授权。
- Human Decision ID 必须与实际执行的副作用绑定。
- 决策、工具调度、恢复和最终业务状态之间必须可关联。
- 并发审批不能发生分支丢失、重复执行或错误恢复。

### 26.5 企业 Agent 上线应评估 Human-AI 联合系统

[READY or Not: Reliable Enterprise Agent Deployment](https://arxiv.org/abs/2609.02095) 提出根据具体工作流成功标准、Agent 可靠性、人类监督策略和运行成本共同评估企业 Agent。它提醒我们，单独看 Agent Benchmark 成绩并不能证明该 Agent 适合进入业务流程。

对当前平台而言，PoC 不应该只问“Agent 能不能完成分析”，而应测量整个 Human + Agent + Workflow 的端到端质量、错误恢复、审批延迟、人工负担和运行成本。

## 27. 推荐架构与选型：先固定业务契约，再选择执行引擎

经过协议、Workflow、产品和 Cumora 的比较，可以得出一个比“选择一个 Agent Framework”更稳定的设计。

### 27.1 平台的业务核心必须自己掌握

建议将业务平台拆成以下层次：

| 层 | 应拥有的事实 | 建议技术 |
| --- | --- | --- |
| Work Item Core | Work Item、Participation、Task、Artifact、Review、Decision Draft、Decision、业务活动 | 自建领域服务 + PostgreSQL |
| Identity / Policy | Human Principal、Agent Principal、Delegation Grant、Role、Scope、策略版本 | 企业 SSO / OAuth 2.1 + 服务端 Policy |
| Integration | REST/OpenAPI、MCP、A2A Adapter、ACP/CLI Connector、Webhook | 公开稳定业务契约 + 协议适配器 |
| Workflow | Case / Process State、Human Task、等待、SLA、升级和状态约束 | Flowable CMMN/BPMN 或 Temporal |
| Agent Execution | 模型调用、工具执行、Session、Checkpoint、Memory、Runtime Trace | 用户本地 Runtime、网站 Agent 或 Temporal Agent Runtime |
| Realtime / Events | Outbox、通知、唤醒、重连、事件关联 | PostgreSQL Outbox + Redis / Message Broker / SSE |

这里要明确：Workflow Engine 可以持有流程执行状态，但业务 Decision 是 Work Item Service 中的正式记录。工作流引擎在 Human 确认后执行状态推进；不能让 Agent 通过引擎变量或外部事件直接把业务 Decision 变成已批准。

### 27.2 Flowable、Camunda、Temporal 怎么选

| 选择 | 最适合的前提 | 当前场景的优势 | 主要代价 |
| --- | --- | --- | --- |
| Flowable CMMN/BPMN/DMN | 动态 Case、业务人员参与、事项活动顺序不固定 | CMMN 与 Work Item 语义最接近，开源核心可嵌入 | Java 服务、建模和产品能力需自行集成；企业 Agent 功能另行评估 |
| Camunda 8 | 业务流程确定、审批节点较多、需要 BPMN 建模和可观测 Agent Execution | Agentic Orchestration、Human Task、外部 Agent 可观测 | Camunda 8.6+ 生产自托管许可成本，需要评估产品授权 |
| Temporal | 开发团队偏代码驱动、需要长期运行和可靠等待 | Durable Execution、Signal、Retry、TS/Python/Java/Go SDK、MIT Server | 没有原生 CMMN/Case 建模，需要自建业务工作台和 Case Model |
| 自建轻量 State Machine | 流程很简单、初期事项类型有限 | 实现最少、领域模型完全自己控制 | 长期等待、重试、并发和故障恢复容易逐渐变成自研 Workflow Engine |

**推荐的研究优先级：**

1. Flowable CMMN：验证它的 Case / Plan Item 能否自然表达 Work Item 的动态活动。
2. Temporal：验证长期 Agent Session、Human Wait、Local Callback、Task Resume 和并发恢复。
3. Camunda：验证 BPMN + External Agent + Agent Instance API 的整合能力及生产授权成本。

不要同时部署 Flowable 和 Temporal 作为两个可以自由推进业务状态的引擎。若后续确实需要一个引擎管业务 Case、另一个引擎管长期 Agent Execution，必须把边界固定：前者控制业务活动，后者只执行被委托的 Agent Task；跨引擎通过带幂等键和版本的命令/事件交互。

### 27.3 对外接入：先 Web API，再 MCP；本地 Runtime 由 Connector 连接

建议的接口顺序：

- REST/OpenAPI 是业务 API 的稳定基础。
- MCP Server 将安全的读取和工作提交动作包装给 Agent。
- ACP 只在某些本地 Coding Agent Runtime 支持时使用。
- 对不支持 ACP 的 Runtime 使用原生 CLI / SDK Adapter。
- A2A 只用于独立 Remote Agent 服务的委托。
- Copy/Paste 是最基础的兼容方式，不要求任何 Runtime 具备集成协议。

对 Cumora 的借鉴是：Runtime Adapter 不要泄漏到业务核心。Agent 是通过 Claude CLI、Codex App Server、ACP 还是 MCP 访问工具，不应该改变 Work Item 的业务语义。

### 27.4 Human Decision Gate：从 API 到数据库都必须是强制边界

业务决策相关的接口需要独立身份约束：

| 操作 | Agent | Human |
| --- | --- | --- |
| 读取授权的 Work Item Context | 允许 | 允许 |
| 生成 Analysis / Recommendation | 允许 | 允许 |
| 提交 Review Findings Draft | 允许 | 允许 |
| 生成 Decision Draft | 允许 | 允许 |
| 确认 Decision Draft | 禁止 | 有权限时允许 |
| 正式确认 Review Outcome | 禁止 | 被指定 Reviewer 时允许 |
| 正式批准 / 拒绝 / 风险接受 | 禁止 | 被授权 Approver 时允许 |
| 关闭 Work Item | 禁止 | 被授权 Human 时允许 |

技术实现上，不只是把正式 Decision 工具从 MCP 列表中隐藏。服务端要按 Principal Type 拒绝 Agent 请求；数据库层限制 Decision 的创建来源；Workflow Engine 的 Command Handler 必须验证当前 Human Decision Record，而不是接受一个可由 Agent 写入的状态变量。

Human Confirmation 还要绑定 Decision Draft Version、输入 Artifact Versions、Reviewer/Approver Role、Policy Version 和有效期。草案发生变化后，之前的确认不能自动沿用。

另一个重要区别：Agent 可以拥有执行 Task 的权限，但这不代表它可以决定 Task 的验收结果。Task 完成可以有两步：

1. Agent / Human 提交 Work Result（Execution Completed）。
2. 授权 Human 接受产物或确认工作结果（Business Accepted）。

不要把 `Task.status = completed` 同时用来表达 Agent 执行完成、Reviewer 通过和事项正式完成。

### 27.5 建议用同一组场景做 PoC，而不是看产品演示

至少用下面这些场景比较 Flowable、Temporal Agent Kit、Camunda 和自建方案：

| 测试场景 | 验收要求 |
| --- | --- |
| 动态增加 Security / Data Specialist | Work Item 仍保持同一身份，能动态创建 Task 和 Participation |
| 同一个 Task 切换 Copilot / Claude Code | 多个 Work Session 关联同一个 Task，Artifact 连续版本化 |
| Agent 等待 Human 补充数天 | 服务重启或断线不丢失等待状态 |
| 两个 Agent 并发处理同一事项 | 过期 Context / Artifact 写入必须被拦截 |
| 多人同时认领 Reviewer Task | 只有一个 Claim 成功 |
| Agent 提交 Decision Draft | 只能创建草案，不能产生正式 Decision |
| Agent 尝试将 Review 标记为 Passed | 服务端拒绝 |
| Human 拒绝 Decision Draft | 任何关联业务副作用都不能发生 |
| Human 批准 Decision Draft | 正式 Decision 与 Human 身份、草案版本和依据绑定 |
| 撤销一个本地 Computer | 该设备及其 Agent Runtime Token 立即失效 |
| MCP Client 不支持 Elicitation | 仍可以由网站 UI 完成人工交互 |
| 外部 A2A Agent 长时间离线 | 本地 Work Item 和 Task 状态仍可靠，远端进度可恢复 |

审批测试尤其要验证两件事：拒绝之后实际副作用确实不存在；批准之后授权动作可以被完整追踪且不会丢失。

### 27.6 最终建议

目前最合理的方向不是把 Cumora、Flowable 或 Temporal 整个项目直接作为基础，而是组合它们最成熟的设计：

- **Work Item 和业务权限模型**：由本平台自己定义并持有。
- **动态事项建模**：优先研究 CMMN，Flowable 是第一个 PoC 候选。
- **Agent 长期执行与可靠恢复**：研究 Temporal / Agent Kit。
- **多 Runtime 本地接入**：借鉴 Cumora Computer / Daemon / Engine Adapter。
- **Agent 工具访问**：REST/OpenAPI 为基础，MCP 为适配，A2A 为远端 Agent 委托，ACP 只用于支持它的本地 Runtime。
- **并发和提交保护**：借鉴 Cumora Freshness Gate、Atomic Claim、HOLD 和 Outbox。
- **证据驱动的工作验收**：借鉴 Cumora Shipping 的 Invariant、Evidence Square、Stage Gate、Readback 和 Regression。
- **正式业务确认**：永远由授权 Human 完成，Agent 只能生成分析、建议和 Decision Draft。

这套组合既能支持完全不用 Agent 的用户，也能容纳 Copilot、Claude Code、网站 Agent 和多个外部 Agent，不会把业务平台变成某个 Agent Runtime 的专用前端。



## 28. Human-first 的外部 Agent 接入：网站提供服务，用户选择 Agent

前面的架构还需要一个更明确的产品定位：**网站的主要用户仍然是 Human，Agent 是可选的外部协作者。网站不应该变成 Agent 的管理中心，也不应该要求用户先在网站注册、配置或启动某个 Agent。**

用户可能在 VS Code 中使用 GitHub Copilot，也可能在终端使用 Copilot CLI、Claude Code，或者使用其他支持标准协议的 Agent。网站不需要知道用户最终选择哪个模型、哪个 Runtime，也不应该要求用户迁移工作习惯。网站只需要提供一个对外稳定、可以被这些 Agent 连接的业务服务入口。

推荐模式是：

- Human 继续通过网站 UI 创建事项、分配角色、查看结果、评审和作出决定。
- 用户自己选择 Copilot、Claude 或其他 Agent，并从该 Agent Client 发起连接。
- 网站公开一个 Remote MCP Server，提供经过授权的 Work Item、Task、Artifact 和 Review 能力。
- Agent 通过 OAuth 代表当前 Human 访问网站，不需要网站为它创建一个专属 Runtime。
- Agent 没有连接、没有配置 Skill 或不支持 MCP 时，网站仍然可以完整地由 Human 使用。

这不是“网站调用一个外部 Agent”，而是“外部 Agent 在 Human 的授权下调用网站服务”。两种模式的控制方向不同。当前场景应该优先实现后者。

### 28.1 MCP Remote Server 是最合适的跨 Agent 接入入口

GitHub Copilot 和 Claude Code 已经支持以 MCP Client 的方式连接外部服务，而且都支持远程 HTTP MCP Server：

| 客户端 | 当前接入能力 | 对网站的意义 |
| --- | --- | --- |
| GitHub Copilot in VS Code | 支持远程 MCP Server、OAuth；部分能力取决于 Copilot Harness 和编辑器 | 不需要网站开发 Copilot 专用 Runtime |
| GitHub Copilot CLI | 支持本地和远程 MCP Server | 终端用户可以直接连接网站 |
| GitHub Copilot App / Cloud Agent | 支持 MCP，但服务配置和权限受 GitHub 产品策略约束 | 可以逐步覆盖 GitHub 工作流 |
| Claude Code | 推荐使用 Remote HTTP MCP，可通过 OAuth 进行授权 | 可以直接连接网站的业务服务 |
| 其他 MCP Client | 按各自支持的传输、授权和能力协商接入 | 网站不必为每个模型品牌开发独立 API |

参考：[GitHub Copilot MCP](https://docs.github.com/en/copilot/concepts/customizations/mcp)、[Copilot MCP Integration Guide](https://code.visualstudio.com/api/extension-guides/ai/mcp)、[Copilot CLI MCP Setup](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)。

网站应该提供一个稳定的 HTTPS 地址，例如：

`https://work.example.com/mcp`

MCP 使用 Streamable HTTP 传输。不要把旧式 HTTP+SSE 作为新实现的主路径；MCP 规范已将旧传输列为弃用方向。服务端应通过标准 MCP 协议完成能力协商，并兼容当前主流客户端实际使用的协议版本。

但“支持 MCP”并不代表所有客户端的能力完全相同。Copilot 的官方集成说明明确区分了 Harness 和 Client：Tools、OAuth、Elicitation、MCP Apps、Resources、Prompts 等能力的可用性不同；例如 Copilot 会调用 MCP Tools，但 VS Code 的 MCP Prompts 并不直接以通用 Prompt 列表暴露给 Copilot 会话。Claude Code 的 MCP 能力也会随着版本和运行模式变化。

因此，第一版只依赖跨客户端最稳定的公共子集：

- Remote Streamable HTTP。
- OAuth 授权。
- Tools 与 JSON Schema 输入定义。
- 标准化的结果和错误表达。
- HTTPS、请求超时、取消、幂等与审计。

Resources 可以作为只读上下文入口的补充；Elicitation、MCP Apps、Prompts、Sampling、MCP Tasks 等能力不要成为业务流程能否工作的前提。尤其不要把 MCP Client 是否支持 Elicitation 当成人工确认的唯一入口。所有正式 Human 操作仍可回到网站 UI。

### 28.2 MCP 是接入协议，Work Collaboration Contract 才是业务契约

MCP 解决的是不同 Agent Client 如何发现和调用工具，但它没有定义企业 Work Item、Requester、Reviewer、Approver、Task、Artifact 或 Decision 的业务语义。

因此，需要定义一套平台自己的 **Work Collaboration Contract**。它不是发明新的网络协议，而是把业务操作整理为跨 Agent 可复用、稳定且可测试的 Tool Contract，并同时映射到 REST/OpenAPI 和 MCP。

例如：

| 能力 | MCP Tool 示例 | 说明 |
| --- | --- | --- |
| 查询事项 | `list_my_work_items` | 只返回当前用户有权访问的事项 |
| 获取上下文 | `get_work_item_context` | 返回经过权限投影的 Context Capsule 和版本 |
| 查询任务 | `list_my_tasks` / `get_task` | 提供当前用户可见的 Task |
| 认领任务 | `claim_task` | 需要时使用带 TTL 的 Claim / Lease |
| 提交分析 | `submit_analysis` | 以 Artifact 形式保存分析结果 |
| 提交评审意见 | `submit_review_findings` | 只能形成 Review Findings Draft |
| 创建决策草案 | `create_decision_draft` | 记录推荐方案、依据和未解决风险 |
| 请求 Human 输入 | `request_human_input` | 在网站中形成待处理事项 |
| 提交工作结果 | `submit_task_result` | 标记执行已提交，不能直接确认业务验收 |

不要向 Agent 暴露一个泛化的 `update_work_item`，更不能提供 `approve`、`confirm_decision`、`reject_request` 或 `close_work_item` 这样的正式业务操作。

这套 Contract 同时需要映射到 REST API。例如，MCP 的 `submit_analysis` 对应业务服务的 `POST /tasks/{id}/artifacts` 或专用分析提交端点。Web UI、MCP、CLI 和未来其他 Connector 应复用同一领域服务和权限检查，而不是分别实现业务规则。

每个写操作应支持：

- 业务对象 ID 和 Task ID。
- 当前 Context / Artifact Version 或 ETag。
- 幂等请求 ID。
- 结构化输入 Schema。
- 服务端返回的提交状态和 Artifact ID。
- 明确的错误类别，如权限不足、上下文过期、任务已被其他人认领、状态不允许或需要 Human 处理。

Agent 提交的结果应附带它实际读取的输入版本。若事项上下文已经变化，服务端应返回 Conflict / Stale Context，而不是把基于旧事实产生的结果静默写入当前版本。

### 28.3 不要求网站注册 Agent，但仍然需要记录 Human 授权

“不需要注册 Agent”不等于“不要身份和权限”。

网站不需要提前创建一个 Claude Agent、Copilot Agent 或模型实例记录。用户连接 MCP 时，客户端通过 OAuth 代表当前 Human 获取访问令牌。网站识别登录用户和 OAuth Client，并为这次连接建立一个可撤销的 Delegation Grant。

建议记录：

| 字段 | 用途 |
| --- | --- |
| Human Subject | 实际授权人和业务责任人 |
| OAuth Client ID | 连接来源，例如 Copilot 或 Claude Client |
| Delegation Grant ID | 本次授权的稳定标识 |
| Scopes | 允许访问的能力范围 |
| Resource / Work Item Scope | 允许访问的事项或资源范围 |
| Issued / Expires / Revoked | 授权生命周期 |
| Policy Version | 授权时采用的策略版本 |

这里不必强求知道实际运行的是哪个模型。Agent 可能经由 Claude Code 的不同模型执行，也可能由 Copilot 切换模型；客户端提供的模型名称或 Agent Name 只能当作可选审计元数据，不能用作身份凭证。

每次操作都需要服务端重新校验：

1. OAuth Token 是否有效、是否签发给当前 MCP Resource。
2. Delegation Grant 是否仍有效，是否已撤销或过期。
3. Human 是否仍是当前组织成员。
4. Human 对这个 Work Item 是否具有相应 Participation 和 Role。
5. Task 当前状态是否允许该操作。
6. Agent 提交内容是否试图跨越 Human-only 的正式决策边界。

OAuth Scope 适合表达较粗粒度的能力，例如 `work:read`、`task:read`、`artifact:submit`；真正的事项权限必须由服务端结合参与关系、角色、事项状态和动态策略判断。不能因为用户曾登录网站，就把这个 Token 当成对整个组织数据的永久授权。

审计中应保留真实的 Human 授权者，同时记录 OAuth Client、Delegation Grant、MCP Request ID 和调用时间。这样既不会把 Agent 误记成 Human，也不需要提前维护一个网站专属 Agent 目录。

如果未来需要把某个长期运行的外部 Agent 作为正式工作参与者，也可以另外定义 Service Principal / Agent Principal，并明确委托范围。这是更高一级的协作模式，不应成为普通用户连接 Copilot 或 Claude 的门槛。

### 28.4 连接方式应该由用户在 Agent Client 内完成

网站只需要提供清晰的连接信息，不必为每个 Agent 写一个专用插件。

建议网站在 Work Item 页面或用户设置里提供一个“Connect an Agent”入口，内容包括 MCP URL、OAuth 登录入口、授权范围、支持能力和撤销入口。对常见客户端可以给出简短的官方配置指引，但它们最终都连接同一个服务地址。

例如，Claude Code 可以通过 `claude mcp add --transport http <name> https://work.example.com/mcp` 添加远程服务器，然后在 `/mcp` 中完成授权。Copilot 则可以通过 VS Code 的 MCP 配置、Copilot CLI 的 `/mcp` 或其连接器入口添加服务。具体配置和授权 UI 由各 Client 管理，网站不需要控制用户的 Agent 进程。

首次授权后，用户可以在自己的 Agent 中直接提出：

> 查看我当前负责的架构评估事项，读取上下文并整理需要补充的证据。

Agent 使用网站提供的工具完成读取和提交。Human 仍通过网站查看产物、补充信息或确认正式决定。

### 28.5 Agent Skills 可选，不能成为接入依赖

Agent Skills 是有价值的跨 Agent 指令分发标准。它可以提供 `SKILL.md`、示例、领域术语、产物模板和任务执行建议。GitHub Copilot 已支持 Agent Skills，Claude Code 也可以通过自己的 Skill 目录使用类似的标准结构。

但 Skill 与 MCP 解决的问题不同：

- MCP 是连接和调用业务服务的协议。
- Agent Skill 是告诉 Agent 如何正确使用这些业务能力的说明和方法。
- OAuth 是访问授权。
- Work Collaboration Contract 是业务操作和数据语义。

没有 Skill，Agent 仍然应该可以通过 MCP 的 Tool Description 和 JSON Schema 理解并使用基础工具。Skill 可以提升执行质量，但不能承载安全规则，也不能用它来授予权限。

建议网站提供一个可选的、版本化的 `SKILL.md` 下载或公开链接，用户可以自行安装到 Claude、Copilot 或其他支持 Agent Skills 的 Client。不要要求每个用户先安装它，也不要把业务流程的关键规则只写在 Skill 里面。

参考：[Agent Skills Standard in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills)。

### 28.6 MCP Registry 可以帮助发现，但不应该是系统依赖

如果网站服务是公开可访问的，可以考虑将 MCP Server 的元数据发布到官方 MCP Registry 或其他聚合目录。官方 Registry 通过 `server.json` 描述 MCP Server 的名称、版本、连接地址、安装方式和能力。

但官方 Registry 当前仍处于 Preview，而且明确不支持仅在私有网络中提供服务的 Private MCP Server。企业内网或租户专用环境应使用企业自己的连接目录，或者直接通过网站提供连接说明。

所以，MCP Registry 只能解决“用户在哪里发现这个 MCP Server”，不能解决用户身份、Work Item 授权或业务决策，也不应该成为系统运行依赖。

参考：[MCP Registry](https://github.com/modelcontextprotocol/registry)、[Registry Overview](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/about.mdx)。

### 28.7 不支持 MCP 的 Agent 也不能被排除

MCP 应是最优先的集成方式，但不能成为唯一入口。至少保留三种接入级别：

| 级别 | 使用方式 | 是否需要 Agent 专门配置 |
| --- | --- | --- |
| 0 | 网站 UI + Copy / Paste Context Capsule | 不需要 |
| 1 | Remote MCP + OAuth | 只需在用户自己的 Agent Client 中添加服务 |
| 2 | REST/OpenAPI + 用户自己的 Connector / SDK | 需要用户自己的集成，但不依赖网站 Runtime |

如果某个 Agent 只支持 HTTP Tool、OpenAPI 或用户自定义 Connector，它仍然可以通过同一业务 API 工作。未来出现新的 Agent Protocol，也只需要增加 Adapter，不应改变 Work Item 模型和业务 API。

不要为了支持每一种客户端而重写业务操作。所有入口最终都应落到同一应用服务、同一授权体系和同一审计记录。

### 28.8 这也意味着网站不需要先建设 Agent Runtime 管理平台

在这个产品定位下，以下能力都不是第一阶段的必要条件：

- 在网站中创建 Claude / Copilot Agent 实例。
- 在网站中管理用户的模型、Prompt、Skill 和 Runtime 配置。
- 为每个 Agent 分配一台云端执行主机。
- 网站主动拉起用户本机 Agent。
- 要求用户将 Agent 的内部 Memory 或 Session 同步到网站。

网站需要的是稳定的业务 API、Remote MCP Server、OAuth Authorization、Delegation Grant、Context Projection、Artifact Submission 和 Human Decision Gate。

用户需要 Agent 执行时，由自己的 Agent Client 负责启动和管理 Runtime。网站只负责授权、提供业务上下文、接收工作结果和记录协作过程。

这可以显著降低第一阶段的产品复杂度，也避免把业务平台绑定到某个厂商的 Agent Runtime。

### 28.9 第一阶段的验收标准

不要用“网站能启动几个 Agent”来衡量第一阶段。更有价值的验证方式是：

1. 用户不配置任何 Agent，也能完整使用网站。
2. 用户可以在 Copilot 和 Claude Code 中分别添加同一个 Remote MCP URL。
3. 两个 Agent 通过不同 Client ID 登录后，获得的权限都由当前 Human 的业务角色决定。
4. 用户撤销一个 Delegation Grant 后，该连接不能继续访问数据。
5. Agent 可以读取用户授权的 Work Item Context，并提交 Analysis、Artifact 和 Decision Draft。
6. Agent 无法调用正式批准、确认 Decision、确认 Review Outcome 或关闭事项的接口。
7. Human 在网站完成确认，所有后续工作流动作均绑定该 Human Decision Record。
8. MCP Client 不支持 Elicitation 或 MCP Apps 时，工作流程仍可通过网站 UI 完成。
9. Agent 不安装 Skill、不使用特定 Runtime，也能完成基础读取和提交。
10. Copilot、Claude 和其他客户端的差异只存在于连接与交互适配层，不影响业务对象、权限规则和审计模型。


## 29. 实际场景验证：企业架构评审中的多人、多 Persona 与不同 Agent 使用习惯

前面建立的是通用的 Work Item 协作模型。现在用一个更接近大型金融或企业 IT 部门日常工作的场景验证它：某个业务部门准备建设或改造一项 Solution，由 Solution Architect 提交架构方案和若干 ADR，Enterprise Architect、Security Architect、Solution SME、Development Manager 等人员参加评审。会议中由 Solution Architect 介绍总体设计，其他参与者提问和质疑，Solution SME 补充业务流程、领域规则和更细的实现约束。评审结束后，有权的负责人决定接受方案、要求进一步分析，或者拒绝当前方案。

这里还有一个现实情况：有些决定并不是最佳目标架构，而是在交付时间、预算、遗留系统和组织约束下选择的 workaround。组织可能同意先采用它，但必须留下 Technical Debt，明确未来如何处理。与此同时，参与者的 AI 使用习惯差异很大：有人完全不用 Agent，有人只用它整理材料，还有人会让 Copilot、Claude 或其他 Agent 深度参与研究和方案分析。

这个场景不是简单地给 Work Item 增加几个角色。它要求系统同时支持多人参与、专业分工、会议讨论、多个 ADR 的独立结论、正式决策权、技术债务追踪，以及可选的外部 Agent。它也是检验前面设计是否真正 Human-first 的一个很好的案例。

### 29.1 先明确这不是一次普通的文档审批

Solution Architect 提交的不是一份孤立文档，而是一个有明确版本边界的架构提案包。里面可能有总体架构、部署和集成视图、数据流、安全设计、非功能需求、迁移方案，以及多个 ADR。每个 ADR 应该描述一个相对独立的架构决策问题，包括背景、约束、备选方案、选择理由和后果。

这些材料进入评审后，至少有四种不同活动：

1. **专业审查**：各参与者从自己的职责范围检查架构，例如企业标准、安全控制、业务领域约束、开发交付和运维可行性。
2. **集体讨论**：Solution Architect 介绍方案，参与者提出问题，SME 补充事实和业务细节，相关人员回应或提出异议。
3. **正式决策**：由组织事先指定的 Decision Authority 或有权限的评审机构，决定方案或其中各项 ADR 的处理结果。
4. **决策后的治理**：将批准条件转成有责任人和期限的 Task；将获准的标准例外和技术债务登记为长期可跟踪对象。

这四种活动不能都记录成 Comment，也不能全部塞进一个 Review 记录。Comment 适合讨论，Review 表达专业判断，Decision 表达组织授权的正式结论，Task 和 Technical Debt Item 则负责把结论落实到后续工作中。

### 29.2 Persona 是职责分工，不是固定的审批层级

建议把场景中的角色定义如下。表中的责任是默认职责，最终权限仍由组织的 Architecture Governance Charter、委托规则和当前事项的授权策略确定。

| Persona | 在本场景中的责任 | 应提供的输入 | 不应默认获得的权力 |
| --- | --- | --- | --- |
| Solution Architect | 提案负责人，组织架构材料、解释方案、回答问题、更新 ADR | 架构提案包、ADR、设计依据、方案权衡、后续修订 | 不应因为是提案作者就自动批准自己的方案或充当独立 Reviewer |
| Enterprise Architect | 检查与企业目标架构、参考架构、技术标准、复用策略和跨系统影响是否一致 | 企业架构符合性意见、标准偏离项、跨域影响、目标架构差距 | 不应仅凭职位名称就推定其是本事项的最终 Decision Authority |
| Security Architect | 检查信任边界、身份和访问控制、数据保护、威胁、合规控制及安全例外 | 安全评估、风险和控制缺口、必要的安全整改条件 | 不应自动成为所有业务风险的接受人；安全否决或强制会签必须由组织策略明确授权 |
| Solution SME | 解释领域流程、业务规则、系统行为、数据含义、实际限制和需求优先级 | 领域事实、业务场景、特殊约束、需求澄清和证据 | 不应因为掌握详细知识就自动拥有架构批准权 |
| Development Manager | 检查研发团队是否能实施和维护该方案，包括容量、技能、交付节奏、成本、依赖和运行支持 | 工期与资源评估、技术可行性、交付风险、运维准备情况 | 不应默认替代架构或业务风险决策 |
| Review Chair / Secretary | 组织议程、确认评审范围和参与者、维护会议记录与待办，必要时主持决策流程 | 议程、出席记录、问题清单、会议纪要、待办 | 记录会议的人不因此拥有决策权 |
| Decision Authority | 在授权范围内作出正式决定；可能是 EA、架构委员会主席或被正式委托的委员会 | 各专业意见、未解决问题、决策选项和风险 | 只能在其授权范围内决定；不能把未解决的强制安全条件默认为已通过 |

这里有一个必须由业务组织回答的问题：**谁有权拍板？** 用户列出的 Solution Architect、Enterprise Architect、Security Architect、Solution SME 和 Development Manager，能够覆盖主要专业视角，但不能仅凭这五个职位推断最终决策权属于谁。平台必须把 Decision Authority 显式记录在当前评审轮次上，不能默认由会议主持人、Enterprise Architect 或发起人决定。

还要区分“参与评审”和“拥有否决权”。Security Architect 可以提交严重程度很高的安全发现；但只有当安全政策规定某类控制必须通过 Security concurrence，或者明确授予特定角色阻断权时，系统才应把它建模为正式 Gate。普通建议、专业反对意见和强制审批条件不能混为一谈。

一个人也可能在不同事项中承担不同角色。Solution Architect 在事项 A 中是提案人，在事项 B 中可能是独立 Reviewer。权限应通过 Participation 和当前评审轮次确定，不应该写死在全局用户属性里。

### 29.3 将评审拆成提交、预审、会议、决策和后续治理

一个可落地的流程可以分成以下阶段。

| 阶段 | 主要活动 | 系统记录与状态变化 |
| --- | --- | --- |
| 1. 提交提案 | Solution Architect 提交架构提案包和一组 ADR，说明评审范围、关键选择、相关标准、风险和待决问题 | 创建 Architecture Review Work Item；生成 Review Submission，固定本轮材料的版本和内容哈希 |
| 2. 分流与准备 | Review Chair 或指定负责人判断是否需要正式评审、需要哪些专业参与者、是否达到安全或企业标准会签条件 | 创建 Review Round；确定 Decision Authority、必需 Reviewer、参会角色和评审规则 |
| 3. 异步预审 | EA、Security Architect、SME、Development Manager 分别阅读同一版材料，提出问题、发现和意见 | 为每个参与者创建 Reviewer Assessment；问题可以关联 ADR、Artifact 或具体设计位置 |
| 4. 会议讨论 | Solution Architect 介绍方案；参与者提问；SME 解释业务细节；提案人回应；尚未解决的问题转成行动项 | 保存会议、出席情况、提问与答复、会议纪要和未解决事项；不因会议结束自动产生批准 |
| 5. 正式决策 | Decision Authority 根据专业意见和授权规则，对整个提案或各 ADR 作出决定 | 创建不可静默覆盖的 Decision Record 和 Decision Items，记录结论、理由、参与者、条件和依据 |
| 6. 后续跟踪 | 执行批准条件、补充分析、处理架构例外和技术债务，必要时再次评审 | 创建有责任人和期限的 Task；创建或关联 Technical Debt、Architecture Exception、Risk Acceptance 等记录 |

预审和会议不必对每个事项都采用相同强度。材料简单、影响范围小、没有标准偏离的事项可以异步完成；涉及跨业务域、安全边界、关键数据或难以逆转的架构选择时，才需要完整的多人会议。评审前应先确定本轮究竟要决定什么，避免会议变成没有明确结论的方案宣讲。

会议中的提问也要有结构。至少要能记录提问人、问题、关联 ADR 或设计材料、答复人、答复内容、是否解决，以及是否需要进一步分析。没有在会上解决的问题可以转成 Task，并明确由谁补充材料、由谁验证。会议纪要可以由秘书整理，也可以由 Agent 辅助生成草稿；但正式的评审意见和决策仍需由授权人员确认。

需要特别区分三套状态：

- **Work Item 状态**表示这项架构评审是否仍在处理、是否已形成正式决定、是否关闭。
- **Review Round 状态**表示本轮预审、会议和决策过程进行到哪里。
- **Review Submission 状态**表示提案材料的版本是否已提交、正在评审、被退回修订或被新版本取代。

不要用一个 status 同时表示“会议已结束”“方案已批准”“所有条件已完成”和“技术债务已清零”。它们属于不同对象的生命周期。

### 29.4 对现有数据模型的必要扩展

现有 Work Item、Participation、Task、Artifact、Review、Decision 的方向是正确的，但对企业架构评审而言，当前的 Review 模型过于简单。如果只保存 `artifact_version, reviewer, outcome, findings`，就表达不了一轮多人评审、会议讨论、多个 ADR 的不同结论和明确的决策授权。

建议在现有模型上增加以下对象，而不是把整套系统改造成通用会议管理平台。

| 对象 | 核心字段或关联 | 责任边界 |
| --- | --- | --- |
| Review Submission | work_item_id, submission_no, proposer, package_version, artifact_refs, submitted_at | 将本轮要审查的 ADR、架构图、说明和证据固定为一个提案版本 |
| Review Round | submission_id, chair, decision_authority, state, required_roles, quorum_policy | 表示针对某个提案版本发起的一轮评审 |
| Reviewer Assessment | round_id, reviewer, role, disposition, findings, evidence_refs | 记录每位专业 Reviewer 的正式意见；不能用 Agent 的普通分析输出替代 |
| Review Session | round_id, meeting_time, attendees, agenda, minutes, recording_ref | 保存一次或多次评审会议及其材料快照 |
| Review Question / Response | session_id, author, respondent, topic_ref, question, answer, status | 让问答和待澄清事项可追踪，不把聊天记录当作唯一证据 |
| ADR Record | artifact_id, adr_key, status, supersedes_id, decision_scope | 为 ADR 增加 Proposed、Accepted、Rejected、Superseded、Deprecated 等生命周期语义 |
| Decision Record | round_id, authority, outcome, rationale, decided_at, policy_version | 记录谁依据什么授权作出了正式决定 |
| Decision Item | decision_id, adr_ref, outcome, rationale, condition_refs | 将决定落实到每一项 ADR，允许同一提案中出现不同结果 |
| Technical Debt Item | source_decision, source_adr, owner, impact, remediation, target_date, review_date | 跟踪已接受选择所产生的长期技术负担 |
| Architecture Exception | standard_ref, scope, rationale, controls, owner, expires_at, review_date | 记录对企业标准或架构原则的限时偏离及补偿控制 |
| Risk Acceptance | risk_ref, risk_owner, accepted_scope, rationale, expires_at, controls | 记录由有权风险负责人接受的风险，不由普通架构批准自动替代 |

这里的几个对象可以作为 Work Item 领域模型中的类型化扩展，不要求全部在第一版拆成独立微服务。初期用关系数据库中的表和统一应用服务就足够。

`Review Submission` 很重要：一轮评审应该针对一个确定的材料集合，而不是针对一个持续变化的文件夹。评审期间，如果 Solution Architect 修改了 ADR 或架构图，系统需要知道本轮 Reviewer 实际审查的是哪个版本。重大修改应该产生新的 Submission 或 Revision，并按影响范围要求重新审查；不能把旧版本上的 Review 自动变成新版本的通过记录。

`Reviewer Assessment` 与 `Decision Record` 也必须分开。Security Architect 可以给出“存在阻断性安全问题”的意见，Enterprise Architect 可以认可目标方向但要求修改，Development Manager 可以指出当前团队无法在既定期限内交付。这些是不同专业视角。最终组织决定可能采纳其中部分意见，也可能在授权范围内接受某些风险。会议参与者的意见不能自动拼成一个批准结论。

### 29.5 多个 ADR 不能被压成一个总的 Approve / Reject

一个提案包可能包含多个 ADR，例如：

- ADR-001：选择目标集成模式。
- ADR-002：选择身份认证和授权方案。
- ADR-003：选择数据存储和数据交换模式。
- ADR-004：决定遗留系统迁移期间采用临时兼容方案。

整个方案可以进入同一轮评审，但这些 ADR 不一定得到相同的结果。评审委员会可能接受 ADR-001 和 ADR-002，要求 ADR-003 做进一步分析，并拒绝 ADR-004 当前提出的做法。

因此，Decision Record 应该支持一个整体结论，同时包含多个 Decision Item。整体结论可以表示“部分接受”或“需进一步处理”，但每一项 ADR 必须有自己的结果、理由、条件和责任人。不能因为提案总体被接受，就把所有 ADR 自动标记为 Accepted。

ADR 的状态和评审轮次的状态也不是同一个概念。ADR 在被接受后，应该保留其原始决策内容；未来发现需要改变时，创建新的 ADR 并将旧 ADR 标记为 Superseded，而不是静默修改已接受的决策。对于一项被要求进一步分析的 ADR，应保留 Proposed 状态，等新版本再次提交并完成决定。

### 29.6 Workaround、Architecture Exception 和 Technical Debt 必须分开管理

这是这个实际场景中最值得单独建模的部分。

假设最优方案是改造一个遗留核心系统，但当前预算和交付时间不允许。团队提出先通过一个兼容层解决集成问题，评审委员会同意短期采用。这个决定至少包含三件不同的事：

1. **架构决定**：当前阶段选择兼容层，而不是立即改造核心系统。ADR 记录选择背景、替代方案、短期收益和长期后果。
2. **架构例外**：如果兼容层偏离了组织已经发布的标准或目标架构，需要一项有范围、有到期时间和补偿控制的 Architecture Exception。
3. **技术债务**：如果这项 workaround 会持续增加接口维护、故障排查、性能限制或未来迁移成本，应创建 Technical Debt Item，并指定责任人和退出方案。

这三者不能相互替代。批准一个临时例外，不等于技术债务已经被偿还；记录一个 Technical Debt，也不代表组织已经授权偏离安全或企业标准；接受一项风险，更不应该因为架构委员会同意了方案就自动发生。

Technical Debt Item 至少需要记录：来源 ADR 和 Decision、债务类型、形成原因、当前影响、未来维护或迁移成本、责任团队和 Owner、建议的偿还方式、目标日期、复查频率、关闭条件，以及相关交付任务。估算不必一开始就很精确，但必须能说明为什么这项负担值得保留和未来如何处理。

Architecture Exception 则应有明确的标准条款或目标架构要求、适用系统和环境、偏离范围、业务理由、补偿控制、批准人、生效日期、到期时间、复查日期和撤销条件。到期时应重新评估：延长例外、完成整改，还是重新提交架构评审。不要把临时例外变成永久豁免。

Risk Acceptance 是另一条边界。如果 workaround 带来尚未消除的安全或业务风险，需要由组织授权的 Risk Owner 接受该风险，并明确范围、控制和有效期。Security Architect 的评估意见不自动等于风险接受，架构 Decision Authority 也不一定就是风险接受人。

如果一个方案只是实现上的权衡，并没有形成持续的维护成本、限制或风险，就不必为了形式创建 Technical Debt Item。是否登记债务，应看它是否形成了未来必须承担的负担；是否登记 Architecture Exception，则看它是否偏离了明确的组织标准或控制要求。

### 29.7 Agent 使用程度不同，不应该改变业务流程

这个场景还有一个很容易设计错的地方：把“角色”和“AI 使用习惯”混成一个 Persona。Solution Architect、Security Architect 是业务职责；不用 Agent、轻度使用 Agent、重度使用 Agent 是工作方式。两者是正交关系，同一个 Security Architect 可以完全不用 Agent，另一个 Security Architect 可以经常使用 Claude Code 或 Copilot。

建议把使用方式分成三种实际水平，但不把它们做成强制流程阶段。

| 使用方式 | 典型行为 | 平台需要支持什么 |
| --- | --- | --- |
| 不使用 Agent | 通过网站、文档、会议和人工沟通完成全部工作 | 所有提交、评审、会议、决策和债务跟踪都必须可以直接由 Human 完成 |
| 轻度使用 Agent | 整理会议材料、总结 ADR、生成问题清单、改进文字表达 | Agent 产物可以作为草稿或工作笔记，Human 检查后再提交 |
| 深度使用 Agent | 分析多个 ADR、比较架构选项、检查安全控制、检索企业标准、提出风险和技术债务建议 | 允许外部 Agent 在 Human 委托下读取授权上下文并提交分析草稿，但不能替代正式 Reviewer 或 Decision Authority |

Solution Architect 可以用 Agent 生成 ADR 初稿、比较备选方案或检查架构一致性；Security Architect 可以让 Agent 辅助威胁建模、检查控制覆盖和寻找证据；Development Manager 可以让 Agent 分析交付依赖和资源约束；SME 可以完全不使用任何 Agent，直接解释业务事实。系统不应要求每个人都安装同一个 Skill，也不应因为某个人没有 Agent 就降低其参与评审的能力。

这里必须保留一条责任边界：**Agent 可以帮助某个 Reviewer 形成判断，但正式的 Reviewer Assessment 应由被指定的 Human Reviewer 核对并提交。** Agent 生成的安全检查清单不能自动算作 Security Architect 的安全会签；Agent 生成的企业标准比对也不能自动算作 Enterprise Architect 的认可。否则同一个 Agent 可以同时扮演提案人、评审人和批准人，独立审查就失去意义。

对于有外部 Agent 的人，仍然沿用前面定义的 Remote MCP + OAuth + Delegation Grant。Agent 通过 Human 授权读取该事项的上下文，提交分析产物或评审草稿。网站不要求预先注册 Copilot、Claude 或某个模型 Runtime，也不要求把 Agent 配置成一个组织成员。对于完全不用 Agent 的人，平台通过普通 Web UI 提供完全相同的业务操作。

审计信息应尽可能区分 `SubmittedBy`、`AccountableHuman`、`GeneratedBy` 和 `DelegationGrant`。能够通过集成链路确认的 Agent 来源可以记录 Client、Grant、模型或 Runtime 元数据；用户在本地工具中生成内容后手工粘贴的情况，不必强迫平台采集无法可靠验证的信息。平台不应把客户端自报的模型名称当成安全身份，也不应将 Agent 的生成内容错误记为它没有实际审阅过的 Human 亲自撰写。

### 29.8 对 Work Collaboration Contract 和 MCP 工具的影响

前面定义的通用 Work Collaboration Contract 可以继续使用，但需要增加架构评审领域的操作。第一版可以提供如下能力：

| 操作 | 典型调用者 | 用途与限制 |
| --- | --- | --- |
| `get_review_submission` | 参与者或授权 Agent | 读取本轮固定版本的提案包和权限投影 |
| `list_review_rounds` | 参与者 | 查看评审轮次和当前阶段 |
| `list_review_questions` | 参与者或授权 Agent | 查看其有权访问的问题与待澄清事项 |
| `submit_review_question` | Reviewer / SME | 提出问题并关联 ADR 或 Artifact |
| `submit_reviewer_assessment_draft` | 指定 Reviewer 的 Agent | 提交个人评审草稿，不自动成为正式会签 |
| `submit_reviewer_assessment` | 被指定的 Human Reviewer | 提交经本人确认的正式专业意见 |
| `submit_meeting_notes_draft` | 秘书或会议辅助 Agent | 提交会议纪要草稿 |
| `record_meeting_notes` | 有权限的 Human | 确认正式会议纪要和行动项 |
| `create_analysis_task` | 有权限的 Human 或受限 Agent | 将待补充分析转为有 Owner 的 Task |
| `create_decision_draft` | Agent 或 Human | 整理候选结论、理由和各 ADR 的建议结果 |
| `propose_technical_debt` | Agent 或 Human | 提交待确认的技术债务候选项 |
| `record_decision` | Decision Authority | 创建正式 Decision Record，Agent 不应调用 |
| `accept_risk` | 被授权的 Risk Owner | 在权限和政策允许范围内接受明确风险，不能由普通架构审批替代 |

正式决策、风险接受和例外授权必须经过各自的服务端权限校验。不能只根据 MCP Tool 名称或 Agent 的 Prompt 判断权限，也不能因为某个用户是 Work Item 参与者就授予所有操作。每个写操作都要检查当前 Principal、Delegation Grant、Participation、角色、Review Round、目标 ADR 版本和当前状态。

对于不同 MCP Client，工具能力可能存在差异，所以第一版仍然只依赖 Remote Streamable HTTP、Tools、JSON Schema 和 OAuth。正式决策由网站 UI 完成也完全没有问题。MCP 的存在是为了让 Agent 更方便地参与工作，不是把网站的核心流程迁移到 Agent Client 中。

### 29.9 现有设计的符合性判断与需要补齐的内容

这个场景验证后，结论是：现有设计的方向正确，但还不能只依靠当前通用对象直接上线企业架构评审。需要补齐的是领域语义，而不是引入一个新的 Agent Runtime。

| 设计能力 | 当前设计是否覆盖 | 需要的调整 |
| --- | --- | --- |
| 不同 Persona 围绕同一事项协作 | 已覆盖 | 继续使用 Participation，但增加评审轮次中的职责和授权约束 |
| 提案、ADR、架构图和证据版本 | 基本覆盖 | 增加 Review Submission，固定每轮评审的材料基线 |
| 多人独立预审 | 部分覆盖 | 明确 Reviewer Assessment，区分正式意见和普通评论 |
| 现场介绍、提问、SME 补充和会议纪要 | 覆盖不足 | 增加 Review Session 与结构化 Question / Response |
| 会议讨论与正式决定分离 | 原则已覆盖 | 增加 Decision Authority、Quorum Policy 和 Decision Record |
| 一次评审中多个 ADR 得到不同结论 | 覆盖不足 | 增加 Decision Item，按 ADR 记录结果、条件和理由 |
| 要求进一步分析并再次提交 | 基本覆盖 | 将 Deferred 与 Rejected 分开；创建 Analysis Task 和新 Review Submission |
| Workaround 形成技术债务 | 覆盖不足 | 增加 Technical Debt Item 和偿还、复查机制 |
| 偏离企业标准的限时授权 | 覆盖不足 | 增加 Architecture Exception 和到期复查 |
| 安全风险由正确责任人接受 | 覆盖不足 | 将 Risk Acceptance 与架构决定和安全评估分离 |
| 不同人采用不同 Agent 使用方式 | 已覆盖基本原则 | 明确 AI 使用程度不是业务 Persona，也不是流程门槛 |
| 外部 Copilot、Claude 等可选接入 | 已覆盖 | 继续使用 Remote MCP + OAuth + Delegation Grant |

实现时不应该先把 CMMN、BPMN 或某个 Agent Framework 全部引入。第一步先在现有 Work Item 服务中实现 Review Submission、Review Round、Reviewer Assessment、Decision Item 和 Technical Debt / Exception 的领域对象与状态约束。流程可以先使用明确的应用服务和状态机；只有当评审路径、分流规则、超时升级和跨团队依赖变得复杂时，再将确定性业务流程交给 BPMN/CMMN Runtime。

一个重要的验收场景是：Solution Architect 提交四个 ADR；EA、Security、SME 和 Development Manager 分别提交不同意见；会议中有问题未解决；Decision Authority 对其中两个 ADR 作出接受，对一个 ADR 要求进一步分析，对另一个 ADR 拒绝；接受的方案中有一个 workaround，被批准为限期例外并登记技术债务；所有后续任务都有责任人和期限。同时，五类参与者中可以有人完全不用 Agent，有人通过 Copilot，有人通过 Claude；他们仍然使用同一个 Work Item、同一轮评审和同一套正式决策记录。

只要系统能保证这个流程完整、可追踪，而且不强迫任何人使用某种 Agent，就说明它真正具备了企业级多人协作能力。

参考资料：
- [AWS Architecture Blog：Build and operate an effective architecture review board](https://aws.amazon.com/blogs/architecture/build-and-operate-an-effective-architecture-review-board/)：多专业成员、评审门槛、正式决策和例外到期管理。
- [GitLab Handbook：Architecture Review Board](https://handbook.gitlab.com/handbook/eta/arb/)：预审分流、会议评审、Decision Authority，以及 Approved、Conditionally Approved、Deferred、Rejected 等结果。
- [GOV.UK：Architectural Decision Record Framework](https://www.gov.uk/government/publications/architectural-decision-record-framework/architectural-decision-record-framework)：先确定决策层级，再选择利益相关方和审批机构。
- [Defra Architecture：Architecture decision records](https://defra.github.io/architecture/governance/architecture-decision-records/)：一个 ADR 聚焦一个决策，并保留 Accepted、Rejected、Superseded 等生命周期。

## 30. 结论


这类系统最合适的设计单位不是 Agent，也不是一个共享聊天会话，而是长期存在的业务事项。参与者通过 Participation 加入事项，角色决定其责任，Task 承载具体工作，Artifact 保存交付物，Review 和 Decision 表达正式判断，Workflow Runtime 管理业务生命周期。

A2A 是这套架构中的一个通信边界：当独立 Agent 服务需要互相委托工作时使用它；当多个 Agent 只是同一个业务事项中的协作执行者时，不需要把所有内部调用都协议化。

真正需要共享的是经过授权、结构化、版本化的 Work Item Context，而不是所有 Agent 的内部记忆。真正需要治理的是谁能对哪个事项、哪个版本、执行什么动作，而不是 Agent 之间能不能互相发送消息。

**建议采用 Work Item-centric Collaboration Architecture：以业务事项为中心，以 Participation 管理动态角色，以 Task 管理人与 Agent 的工作，以 Artifact / Decision 固化结果，以 Business Workflow 管理正式状态，以 A2A 连接跨边界 Agent。** 这样既能容纳同一项目内的多 Agent，也能支持不同用户在不同事项中承担不同职责，而且不会把业务责任、项目上下文和 Agent 执行状态混成一团。

