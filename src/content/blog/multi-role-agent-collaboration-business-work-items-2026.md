---
author: W
featured: false
draft: false
description: 面向多人、多角色和多个 Agent 的业务事项协作架构，分析 A2A、共享项目上下文、Case Management、BPMN 与 Agent Orchestration 的边界，并给出可落地的设计。
pubDatetime: 2026-11-22T03:00:00Z
title: 从 A2A 到共享业务事项：多角色 Agent 协作架构怎么设计
tags:
  - ai
  - agent
  - a2a
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

**Artifact 与 Decision 是两种不同的业务结果。** Artifact 是分析文档、架构图、风险清单、测试结果或证据包，必须有版本和来源；Decision 是对某个问题作出的正式决定，例如接受、拒绝、附条件接受或退回修改。Agent 可以提出 Decision Proposal，但不能仅凭生成一段文本就改变正式业务状态。

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

Agent 也应遵循同一模型。不要创建一个全局的“Architect Agent”账号，然后让它天然拥有所有架构事项的修改权。应为每次 Agent Participation 绑定委托来源、允许的 Task 类型、资源范围、有效期和可执行动作。Agent 的身份说明它是谁，Participation 说明它为何参与这个事项，Capability 才说明它能做什么。

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

已有的 [AI 时代的业务流程：Workflow 应该用 BPMN 还是 Agent](./workflow%20and%20agent%20and%20bpmn) 讨论了 Business Workflow 与 Agent Workflow 的编排权边界。这里是在该边界上增加 Collaboration 层：外层业务流程持有事项状态，协作层管理人与 Agent 的参与和交接，Agent Runtime 执行被分配的工作。

### 一个架构分析事项的生命周期

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

### 核心数据模型

| 对象 | 关键字段 | 说明 |
| --- | --- | --- |
| WorkItem | id, type, status, owner_org, context_version | 长期业务事项 |
| Participation | work_item_id, principal_id, role, scope, valid_until | 人或 Agent 在事项中的角色 |
| Task | id, work_item_id, kind, assignee, status, due_at | 一次可执行工作 |
| TaskRelation | from_task_id, to_task_id, relation_type | depends_on、reviews、revises、delegates_to |
| Artifact | id, work_item_id, type, version, created_by, content_hash | 有版本的正式产物或工作产物 |
| ArtifactRelation | artifact_id, source_id, relation_type | 产物与输入、证据、评审的关联 |
| Review | artifact_version, reviewer, outcome, findings | 对特定版本的审查 |
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

**提交业务动作的授权**：谁可以把 Artifact 标记为正式提交，谁可以要求重做，谁可以批准或拒绝，谁可以关闭事项。Agent 可以提交建议或草稿，但正式决策必须由授权主体完成，除非业务规则明确允许自动化决定。

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
- [Google：A2A 与 MCP 的分工](https://docs.cloud.google.com/agent-registry/a2a-protocol)

## 13. 推荐的落地路径

第一阶段先实现一个真正可用的 Work Item 工作台，不急于构建 Agent 市场或复杂的 Agent 群体自治。选择架构分析作为第一个业务类型，提供事项创建、角色参与、任务分配、Artifact 版本、Review、Decision、评论和审计。Agent 先作为一种 Task Assignee 接入，能力范围与普通用户一样受到事项级授权。

第二阶段增加自动协作。系统根据事项类型、阶段和缺失信息创建 Task；Agent 可以建议新增 Specialist Participation、请求 Requester 补充信息、创建 Reviewer Task 或生成分析产物。任务是否分配给人还是 Agent，由策略、能力和风险决定。对于需要独立判断的 Review，应使用独立执行上下文。

第三阶段再增加跨 Agent 服务。先统一本地 Task Contract、Artifact Contract 和授权模型，再为远端 Agent 增加 A2A Adapter。这样即使某个 Agent 使用 LangGraph、另一个使用自研 Runtime、第三个由供应商提供，也不会改变业务事项模型。

第四阶段才考虑更复杂的 Case Management、跨部门工作队列、动态参与者推荐、SLA 优化和组织级 Agent Registry。只有当真实业务场景出现跨事项协同、复杂临时活动或跨组织委托时，才增加对应抽象。

建议用以下场景作为端到端验收，而不是只测试 Agent 能否互相发消息：

- 同一用户在不同 Work Item 中可以承担不同角色。
- Requester 可以补充需求，但不能修改已归档的评审记录。
- 两个 Agent 可以并行分析同一事项，各自提交独立 Artifact。
- Reviewer 只能审查被指定的 Artifact Version，版本变化后旧 Review 不自动生效。
- Agent 可以请求人工输入并持久等待，用户数天后回复仍能恢复原 Task。
- 两个参与者同时认领同一任务时，只允许一个成功。
- Agent 委托子 Agent 时，权限范围不会扩大。
- A2A 远端 Task 完成后，结果先进入本地 Artifact 流程，不直接改变业务决定。
- 事项关闭后仍可完整追溯参与者、任务、上下文版本、评审和决策。

## 14. 结论

这类系统最合适的设计单位不是 Agent，也不是一个共享聊天会话，而是长期存在的业务事项。参与者通过 Participation 加入事项，角色决定其责任，Task 承载具体工作，Artifact 保存交付物，Review 和 Decision 表达正式判断，Workflow Runtime 管理业务生命周期。

A2A 是这套架构中的一个通信边界：当独立 Agent 服务需要互相委托工作时使用它；当多个 Agent 只是同一个业务事项中的协作执行者时，不需要把所有内部调用都协议化。

真正需要共享的是经过授权、结构化、版本化的 Work Item Context，而不是所有 Agent 的内部记忆。真正需要治理的是谁能对哪个事项、哪个版本、执行什么动作，而不是 Agent 之间能不能互相发送消息。

**建议采用 Work Item-centric Collaboration Architecture：以业务事项为中心，以 Participation 管理动态角色，以 Task 管理人与 Agent 的工作，以 Artifact / Decision 固化结果，以 Business Workflow 管理正式状态，以 A2A 连接跨边界 Agent。** 这样既能容纳同一项目内的多 Agent，也能支持不同用户在不同事项中承担不同职责，而且不会把业务责任、项目上下文和 Agent 执行状态混成一团。
