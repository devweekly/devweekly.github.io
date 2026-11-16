---
author: W
pubDatetime: 2026-11-17T00:00:00Z
title: "Spec-Driven Development 能提升 AI Agent 的开发生产率吗？"
featured: false
draft: false
tags:
  - AI
  - Agent
  - AI Coding
  - Software Engineering
  - SDD
  - Requirements Engineering
description: "以 Anthropic 工程实践为主，比较 OpenAI、LangChain 和 Thoughtworks 的 Agent-first 工作流，结合 2025–2026 年论文、Spec 写法和公开对照数据分析 SDD 的真实收益与成本。"
---

# Spec-Driven Development 能提升 AI Agent 的开发生产率吗？

让 Agent 根据一句话直接改代码，已经是很多团队的日常工作方式。简单任务往往确实很快：描述目标，Agent 找文件、写实现、跑测试，几分钟后就能看到结果。麻烦通常出现在任务稍微复杂一点之后：它理解了主要目标，却漏掉某个边界条件；实现了功能，却违反现有架构约定；测试通过了，交付结果仍然不是业务真正想要的东西。

这类问题很容易被归结为模型能力不足，接着便是换更强的模型、增加 Prompt、再加一个 Review Agent。但有时问题出在更前面：模型拿到的任务描述，本身并没有完整表达需要实现的行为和约束。

Spec-Driven Development（SDD）试图在需求和实现之间增加一个经过整理、可以持续维护的规格层，让 Agent 不再只根据一段原始需求推断整个任务。这个方向有实际价值，但需要先把结论说清楚：

**结构化规格有证据支持能改善代码生成的正确性和需求覆盖；它是否能稳定提升整个团队的开发生产率，目前还没有足够的直接对照研究。**真正值得采用的不是“多写几份文档”，而是把需求变成可审查、可验证、能贯穿任务分解和测试的工程约定。只把自然语言换成 YAML 或 JSON，通常不会带来同等收益。

## 需求文本、Spec 和 Schema 不是一回事

三者经常被混为一谈，实际上承担不同职责。

需求文本负责表达意图。它可以很自然，也可以包含背景、业务动机、例子和一些暂时不确定的想法。它适合人和人沟通，但不保证每个实现所需的信息都已经说清楚。

Spec 是从意图中整理出来的行为和约束定义。它回答谁在什么条件下可以做什么、系统应该如何响应、哪些规则必须满足、异常情况如何处理，以及怎样判断实现已经完成。Spec 可以用 Markdown 写，也可以包含表格、状态图、接口定义和验收场景。它的重点是语义是否完整、明确、可验证，而不是文件格式。

Schema 则定义 Spec 的结构。例如规定每条需求必须有 ID、描述、验收标准和来源，约束状态只能取几个枚举值，或者要求每个任务引用至少一条需求。Schema 可以自动检查字段缺失、类型错误和引用关系，但无法仅凭字段合法就判断需求本身是否正确。

可以把它们理解成三层：

| 层次 | 主要回答 | 能解决什么 | 不能保证什么 |
| --- | --- | --- | --- |
| 需求文本 | 我想解决什么问题？ | 保留背景、意图和业务语境 | 不保证没有歧义或遗漏 |
| Spec | 系统应该表现成什么样？ | 澄清行为、边界、约束和验收条件 | 不保证内容真实、正确或足够 |
| Schema | Spec 必须按什么结构表达？ | 校验字段、类型、枚举、ID 和引用 | 不理解业务含义，也不能证明需求正确 |

因此，SDD 的关键步骤不是把一段话序列化成结构化数据，而是把未经整理的意图，转换为一组开发者和 Agent 都能检查的行为约定。Schema 是实现这一过程自动化的工具，不是 Spec 的替代品。

## 直接把需求交给 Agent，问题出在哪里？

直接需求文本驱动的典型过程是：用户描述任务，Agent 读取仓库，理解上下文，决定实现方案，修改代码并运行测试。对于小而明确的任务，这条路径非常有效。额外引入需求分析和设计文档，反而可能增加开销。

随着任务复杂度提高，这条路径会把很多隐含决策留给 Agent 临场推断。比如“增加一个持仓导出功能”，至少还存在这些待明确的问题：哪些角色能够导出？导出的是当前可见数据还是完整数据？筛选条件如何处理？空结果应该生成空文件还是提示用户？金额和日期采用什么格式？导出失败如何反馈？是否需要记录审计事件？大文件是否有容量或时延限制？

模型通常能给出一套看起来合理的答案，但合理不等于符合系统真实要求。不同 Agent、不同 Session 甚至同一个 Agent 在不同上下文下，都可能对这些细节作出不同假设。它们一旦进入实现，就可能变成代码、测试和接口中的隐含约定。

问题还不只来自需求本身。已有代码库包含大量不在用户描述中的约束：公共接口、数据模型、权限边界、错误处理方式、兼容要求、测试约定，以及过去做过的架构决策。如果 Agent 没有找到这些上下文，需求再清楚也未必能导出正确修改。

直接文本驱动把需求解释、上下文发现、方案选择和实现放在同一轮生成中。Agent 可以边写边补全自己的理解，却未必会把这些推断显式暴露出来。错误可能直到集成测试、Code Review 或生产运行时才被发现。

## Spec 能在哪些环节帮上忙？

首先，它把“没有说清楚的部分”从隐含假设变成可以讨论的问题。把用户角色、前置条件、业务规则、正常行为、异常路径和非功能约束分开整理，团队更容易发现冲突和遗漏。还没有结论的事项可以保留为 Open Questions，而不是让 Agent 自行补一个默认答案。

其次，Spec 为多个 Agent 和多个 Session 提供稳定的任务语义。需求分析 Agent、设计 Agent、编码 Agent 和测试 Agent 不必依赖各自对原始对话的理解来重建目标。需求 ID 可以被技术设计、实施任务和测试引用，后续修改也能追踪到受影响的范围。它减少的是语义在交接过程中的漂移，并不意味着所有 Agent 都必须使用完全相同的 Prompt。

第三，Spec 让任务分解有了边界。像“实现账户管理”这样的任务对 Agent 太大，也很难独立验收。把它拆成有明确输入输出、约束和验收条件的工作项之后，Agent 可以逐项实现、测试和提交，人也更容易 review 局部变更。GitHub 在介绍 [Spec Kit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/) 时采用的就是这一思路：先 Specify，再 Plan、Tasks，最后 Implement；每一阶段都有检查点，规格持续参与后续实现，而不是写完就放在一旁。

第四，Spec 可以成为测试设计的依据。每一条重要需求都应对应至少一种验证方式：单元测试、集成测试、契约测试、属性测试、权限测试，或需要业务人员确认的验收场景。测试结果可以直接回答某条需求是否满足，而不是只用“测试套件通过”替代需求覆盖情况。

这几项作用有一个共同前提：Spec 必须真正进入后续工程流程。只在仓库里多放一份 requirements.md，编码 Agent 却仍然只看原始 Prompt，实际收益可能很有限。

## Anthropic：Spec 的重点是让 Agent 持续知道“什么算完成”

Anthropic 的公开实践很有代表性，因为它关注的不是先产出一份漂亮的设计文档，而是 Agent 在真实代码库中连续工作、跨越多个 Context Window 时，怎样避免偏离原始目标。

### 从一个高层目标，生成可逐项验收的功能清单

Anthropic 在 2025 年发布的 [Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents) 记录了一种双 Agent 工作方式。第一个是 initializer，负责把任务建立成后续 Agent 能继续执行的工程环境；之后每个 Session 都由 coding agent 逐步完成一个功能，并留下 Git 历史和进度记录。

这个例子不是让 Agent 直接读取一句“做一个 Claude.ai 克隆”就开始写代码。Initializer 会先读取项目规格，再把用户目标展开成一份详细的功能清单。Anthropic 给出的示例超过 200 个功能项，范围不仅包括聊天主流程，还覆盖模型切换、会话管理、文件 Artifact、设置、响应式布局和辅助功能。每一项都带有可执行的验证步骤，初始状态统一标记为未通过。后续 Agent 每次只选一个未完成项，实施后通过真实浏览器交互、截图和测试验证，再更新状态并提交 Git。

单条 feature 的结构很简单：

    {
      "category": "functional",
      "description": "New chat button creates a fresh conversation",
      "steps": [
        "Navigate to main interface",
        "Click the New Chat button",
        "Verify a new conversation is created",
        "Check that chat area shows welcome state",
        "Verify conversation appears in sidebar"
      ],
      "passes": false
    }

这里值得注意的是，Anthropic 把“目标规格”和“执行进度”分开保存。功能描述和验证步骤是相对稳定的验收契约；passes 只是当前实现状态。Agent 不能因为代码已经生成，或某个命令退出码为 0，就自行宣告整项功能完成。

它还要求后续 Session 先检查已经通过的核心功能是否回归，再开始新工作；实现必须通过 UI 的真实操作验证，而不是只靠 curl 或孤立的后端测试；结束前提交 Git、写入进度日志，并留下可以继续工作的干净状态。这些约束直接针对两个长任务常见失效：一次做太多而中途耗尽上下文，以及后续 Agent 看到已有代码后误以为工作已经完成。

**这套例子的关键并不是“200 条规格是标准答案”。** 一个普通功能可能只需要几条验收场景；一个跨模块产品才可能需要上百项。Anthropic 展示的是如何把高层目标拆成一批有优先级、可独立验证、可跨 Session 追踪的行为，而不是让所有项目都照抄 200 条的数量。

完整的公开实现可以直接查看 [anthropics/claude-quickstarts/autonomous-coding](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding)。其中包括 [app_spec.txt](https://github.com/anthropics/claude-quickstarts/blob/main/autonomous-coding/prompts/app_spec.txt)、[initializer_prompt.md](https://github.com/anthropics/claude-quickstarts/blob/main/autonomous-coding/prompts/initializer_prompt.md) 和 [coding_prompt.md](https://github.com/anthropics/claude-quickstarts/blob/main/autonomous-coding/prompts/coding_prompt.md)。这三份文件分别承担产品规格、初始化工作和后续增量实现的职责，适合用来研究长时运行 Agent 的工程组织方式。

### Anthropic 对 Spec 的另一条建议：不要重复代码库已经告诉 Agent 的内容

Claude Code 的 [Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices) 对过度文档化提出了很明确的提醒：只把 Agent 无法通过读仓库获得、或每次任务都要花时间重新发现的信息写下来。团队在会议中做出的决定、部署流程中未记录的步骤、集成测试需要的环境变量，都是值得持久化的上下文；目录结构、已有测试框架、组件惯例等，模型通常可以直接从代码中发现，不应在多个文档里重复抄写。

这对 Spec 的粒度有直接影响。一个 Spec 不应该成为代码库导览或技术名词百科。它应该写清楚这次变更新增或改变的用户行为、项目当前没有表达出来的业务规则、重要边界、必须遵守的约束，以及怎样验证交付结果。已有代码负责表达已实现的事实，Spec 负责表达本次变更的目标和尚未实现的约定。

Anthropic 还把自然语言指导和确定性控制明确区分。Prompt、CLAUDE.md 和 Skill 都由模型阅读后自行决定如何遵守，不能把它们当作强制执行机制；Hooks、权限规则、沙箱、测试、CI 和分支保护才是 Harness 可以确定执行的控制点。比如“导出前必须验证用户数据权限”可以写入 Spec，描述期望行为；但真正的授权检查必须落在服务端代码和测试中，不能仅靠 Spec 提醒 Agent。

### 谁在决定需求，谁在负责实现？

Anthropic 对约 40 万个 Claude Code Session 的 [2026 年研究](https://www.anthropic.com/research/claude-code-expertise)提供了一个很有用的现实观察。研究把决策分为 planning（做什么、采用什么方向、怎样算完成）和 execution（改哪些文件、写什么代码、运行哪些命令）。在平均 Session 中，人类做出了约 70% 的规划决策，但只做了约 20% 的执行决策。换句话说，人主要决定目标和验收方向，Agent 承担了更多具体执行。

这个结果是观察性使用数据，不是 SDD 的随机对照实验，也不能证明写 Spec 会带来某个百分比的提速。但它说明人和 Agent 的工作边界已经发生变化：需求澄清、业务判断、架构取舍和完成标准越来越重要，手工编写代码的占比则在下降。

Anthropic 2025 年的 [How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic)也显示，受访员工自报 Claude 已参与约 60% 的工作，并估计带来约 50% 的生产率提升；但大多数人表示能够完全交给 AI、不再亲自检查的工作只占 0–20%。研究包括 132 名工程师和研究人员的问卷、53 次访谈及内部使用数据。这些数据说明高频使用不等于无监督委派，尤其在业务语义和高风险决策上，人仍然承担验证责任。

Anthropic 在 2026 年的内部总结 [When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement)进一步报告，2026 年 5 月超过 80% 合并进 Anthropic 代码库的代码由 Claude 编写，2026 年第二季度典型工程师每日合并的代码量约为 2024 年的 8 倍。Anthropic 同时提醒 Lines of Code 是不完美的生产率指标，衡量的是产出数量而不是质量。这些数字说明 Agent 已经深入实际工程流程，却不能被解读成 SDD 的收益，更不能用来推导团队端到端交付效率提高了 8 倍。

Anthropic 自己的 [How Anthropic teams use Claude Code](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf)还记录了不同团队的使用方式：快速原型可以采用较高自主度的循环，但关键业务逻辑会使用更详细的指令、实时监督和更严格的检查；Claude 自主完成 Vim 键位功能的案例中，约 70% 的最终实现代码由 Claude 编写。它是内部访谈材料，不是对照实验，但很清楚地表明，团队会根据任务风险调整规格细节和人的介入程度。


## 核心参考：Anthropic 的 AI-Native SDLC Playbook

2026 年 8 月，Anthropic 发布 [The AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook)，并在 [Claude Academy](https://academy.claude.com/courses/ai-native-sdlc-playbook) 提供了配套的 14 节课程。它是本文最值得深入研究的实践材料。它面向已经在使用 Claude Code、但仍被传统需求交接、人工审查、测试和发布流程拖慢的工程、平台与安全负责人，尤其关注大型企业和受监管组织。它不是一个新的代码生成 Prompt 模板，而是对完整 SDLC 的重新组织。

Playbook 的出发点很直接：AI 已经把 Build 阶段压缩得很快，但 Plan、Review、Test 和 Deploy 仍按人的速度运转。代码生成能力越强，瓶颈越容易从写代码转移到需求澄清、设计审查、测试反馈、发布审批和安全治理。如果只把 AI 接入编码环节，而不调整这些周边流程，团队得到的可能只是更大的 PR 队列、更重的 Review 负担，以及更快产生的返工。

Anthropic 因此提出的不是线性的“需求文档—设计文档—开发—测试—发布”，而是一套由版本化交付物串联起来的闭环。每个阶段结束时都要提交一个明确产物，下一阶段以该产物为输入；当产物经过人工批准，才触发下一阶段。最初可以手工运行这些步骤，稳定后再把 Git 合并、CI Job 和 Agent 工作流连接起来。

### 六个阶段、十二项 Play：不只是 Spec，而是完整的交付链

Claude Academy 将 Playbook 拆成六个 SDLC 阶段和十二项 Play：

| SDLC 阶段 | Anthropic 的 Play | 关键产物或控制点 |
| --- | --- | --- |
| Plan | Capture as intent.md | 由需求发起人确认的意图文件 |
| Design | Requirements and design | 经过 Product Owner 审核的 spec.md |
| Build | Claude Code plan mode；CLAUDE.md；Skills；Parallel sessions and subagents | 已批准的 plan.md、仓库级上下文、组织技能、可并行的工作单元 |
| Test | Give Claude a feedback loop；Continuous evals in CI | 可执行验证命令、持续运行的 Agent Eval Suite |
| Deploy | AI in the PR review loop；Hooks as approval gates；CI/CD integration and deployment | PR Review 结果、审批 Hook、受控 Pipeline |
| Maintain | Closing the loop on metrics | 生产指标、控制区间、事件记录和新的 intent.md |

这十二项 Play 并非要求一次全部上线。Anthropic 给出了依赖关系：CLAUDE.md、Skills、反馈循环、Hooks、Plan Mode 和 Intent Capture 可以先独立采用；Subagents 依赖项目上下文，Evals 依赖上下文和反馈循环，Requirements and Design 依赖 Intent Capture 与 Skills；PR Review 依赖 Evals 和 Subagents；CI/CD 依赖 PR Review 与 Hooks；最后才把生产监控闭环接回 Intent。对组织而言，这意味着可以按能力成熟度分阶段引入，而不是先买一套工具、再强制所有团队走同一套重流程。

### 第一步不是写 Spec，而是由需求发起人写出 intent.md

Anthropic 将最初的输入命名为 intent.md，而不是直接要求业务人员写完整 PRD 或技术规格。它是一份短小、可读、可版本化的意图记录，回答四个问题：想要什么、为什么需要、影响哪些用户和系统、有哪些约束和未决问题。

Playbook 的示例来自保险理赔场景：

    # Intent: claims status self-service
    Author: J. Ortiz (claims operations). Status: draft.

    ## Problem
    Customers phone the contact center to ask where their claim is.
    Handlers spend roughly a third of call time on status-only queries.

    ## Proposed outcome
    Customers see claim status, next step and expected date in the portal.

    ## Affected users and systems
    Claims handlers, portal team, claims-core API.

    ## Constraints
    No new PII in the portal session. Existing authentication only.

    ## Open questions
    Do third-party loss adjusters need access too?

这个例子刻意没有写 API 路径、数据库表、缓存策略或 React 组件。因为它描述的是业务意图，而不是提前替工程团队作技术决定。需求发起人可以是业务运营人员、产品经理、内部用户，也可以是事故告警或工单的提交者；他们不必先掌握 Git 或需求工程术语。可以通过 Claude 或 Cowork 与 Agent 讨论，Agent 扮演分析师角色追问范围、用户、约束和成功标准，再生成 intent.md 草案。

但 Agent 生成不等于批准。发起人必须校正 Agent 对原意的误解；Product Owner 决定接受还是拒绝，并对批准的版本负责。Anthropic 建议把文件放在产品仓库的 intent/ 目录；只有当意图跨越多个仓库时，才值得单独建立 intent repository。没有 Git 使用经验的业务人员，也可以通过 GitHub Connector 等方式让 Agent 代为提交 Markdown，但作者、时间和审查历史仍应保留。

这里体现了一个重要的角色变化：业务人员不再必须先把想法交给分析师，再等待需求文档被重新表达；Agent 可以帮助把原始表达整理成统一产物，但业务意图的确认权仍属于发起人和 Product Owner。

### 第二步：Agent 写 requirements + design，Product Owner 审核而不是亲自从头撰写

在 intent.md 获得批准后，Claude 根据组织已有的 Skills 生成 spec.md。这些 Skills 可以包含安全、合规、品牌、UX、API 设计和数据处理标准。Anthropic 的建议是把 Requirements 与 Design 合并在一次 Agent 工作会话中完成，减少传统流程里分析师写需求、设计师再二次解释的交接损耗。

Playbook 的 claims 示例给出了一个可直接参考的 spec.md 形态：

    # Spec: claims status self-service
    From: intent.md (J. Ortiz, claims operations).
    Status: ready for product owner review.
    Skills applied: secure-api-review, brand-voice, portal-ux.

    ## Requirements
    - R1. A signed-in customer sees status, next step and expected date for each open claim.
    - R2. Status is one of four states: received, in review, approved, paid.
    - R3. The response carries those three fields and nothing else.
    - R4. What the customer sees is at most 60 seconds old.

    ## Design
    - New endpoint GET /claims/{id}/status in claims-api, behind the gateway JWT.
    - claims-api reads the claim from claims-core. The portal never calls claims-core.
    - New StatusPanel on the portal claims page. It caches each answer for 60 seconds.

    ## How each constraint in the intent is met
    | Constraint | Met by |
    | :---- | :---- |
    | No new PII in the portal session | R3. None of the three fields is tagged pii in the schema. |
    | Existing authentication only | The gateway JWT. No new login, token or role. |

    ## Open questions from the intent
    - Do third-party loss adjusters need access too? Not answered. Carried forward as concern 1.

    ## Areas of concern
    1. Loss adjusters have no portal account. Giving them access breaks "existing authentication only", so they are left out of this spec. Owner: security.
    2. The portal-ux skill says every status shows a date. The brand-voice skill says never to state a payment date as a commitment. I cannot satisfy both as written. Proposed label: "Estimated date". Owner: compliance.
    3. claims-core allows 50 requests a second. The 60-second cache should keep the portal under that, but nobody has load tested it. Owner: claims-core team.

这个例子比只列功能点更重要的地方，是它把需求、设计、约束映射和风险放在同一份工作规格里。R1 到 R4 可以被后续计划、代码和测试引用；Design 说明系统边界和主要实现路径；约束映射解释原始意图如何被满足；Areas of concern 则把冲突和未经验证的假设显式交给有权决策的人。

尤其是第三方理赔人员是否需要访问、UX 与品牌规范冲突、下游系统吞吐量未经压测等问题，Agent 不应该自行编造答案。它应标记问题、给出影响和建议 Owner，由 Product Owner 与安全、合规或系统负责人解决。Product Owner 审核 Spec 是否忠于原始意图、未决问题是否得到回答或被明确保留；高风险事项还要咨询 Tech Lead。通过后，intent.md 和 spec.md 一起提交，形成“当初要求了什么、最终决定了什么”的版本记录。

这也修正了一个常见误区：Spec 并不一定要由业务分析师或架构师逐字写完。在 Anthropic 的模式里，Agent 承担草拟和综合，Product Owner 对业务意图和范围负责，政策 Owner 解释安全/合规等规则，Tech Lead 对高风险技术设计把关。Spec 的作者可以是 Agent，Spec 的责任人不能是 Agent。

### 第三步：Spec 批准之后，工程师仍要审查 plan.md

spec.md 不是直接交给 Agent 开始改代码。工程师在 Claude Code Plan Mode 下，让 Agent 只读代码库，结合 Spec 生成 plan.md，列出需要修改的文件、实现顺序、测试方式、风险和备选方案。工程师通过追问“会破坏什么”“哪一步风险最高”“为什么不选其他方案”来检查计划。

Anthropic 给出的判断标准非常实用：一个从未参与过这次讨论的工程师，应该能够只看批准的 Plan 就理解怎样实施。Plan 经工程师确认后提交到 Git；如果实现过程中偏离 Plan，应在同一个变更中同步更新 plan.md。后续 PR Review 再检查最终 diff 是否与 Spec 和 Plan 一致。

这三个文件的职责不能混淆：

| 文件 | 回答的问题 | 主要责任人 |
| --- | --- | --- |
| intent.md | 为什么做、想改变什么、影响谁、有哪些业务约束？ | 需求发起人提出，Product Owner 确认 |
| spec.md | 系统应表现出什么行为、遵循什么约束、采用什么设计、还有哪些风险？ | Agent 草拟，Product Owner / Policy Owner / Tech Lead 审核 |
| plan.md | 在当前仓库里改哪些地方、按什么顺序实施、怎样证明完成？ | Agent 草拟，工程师 / Tech Lead 审核 |

因此，Spec 的细节不应该无限膨胀。intent.md 保持短小；spec.md 要足够明确到可以计划、审查和验证；plan.md 再落到仓库文件、模块、接口、测试和迁移步骤。三层文档分别服务于业务意图、系统行为和工程执行，避免一份超长 PRD 同时承担所有职责。

### 第四步：把 CLAUDE.md、Skills 和 Hooks 分开管理

Playbook 对 Agent 上下文的分层值得单独吸收，因为它能避免把所有规则都塞进一份越来越长的 CLAUDE.md。

- CLAUDE.md：仓库级工作说明，放新成员第一天就需要知道的命令、架构地图、编码约定和常见陷阱。Anthropic 建议从 /init 生成初稿，再人工删减到一页左右；规则应简短、稳定，并在 Agent 重复犯错后补充。示例包括 Java 版本、构建/测试命令、Money 必须使用 BigDecimal、目录职责、哪些依赖不能自行升级。
- Skills：组织的制度性知识和可复用工作流程，例如 API 安全审查、品牌规范、合规要求。Skill 应有明确触发条件、权威来源和责任 Owner；放在 .claude/skills/<name>/ 或通过组织 Plugin 分发。政策变化时由 Policy Owner 审批更新。
- Hooks：需要确定性执行的控制点，例如禁止未通过测试就报告完成、限制修改特定文件、在发布前等待人工审批。Prompt 和 Skill 是 Agent 需要理解并遵守的指引；Hook、权限、沙箱和 CI 才能把关键约束落实为执行边界。

Playbook 给出的原则是：同一错误出现两次，就考虑把纠正方法写入 CLAUDE.md；但不要把仓库里本来就能读到的代码结构、API 文档全文复制进去。常驻上下文越长，越容易消耗 Context Window 并引入过期信息。

### 第五步：测试不是最后一个阶段，而是 Agent 每次工作都要运行的反馈循环

Anthropic 区分了两个容易混淆的概念：Feedback Loop 是实现过程中持续运行的反馈回路；Verifier Subagent 则是在 Agent 认为任务完成后，用一个新的 Context Window 独立复核结果。前者反复执行，后者用于避免最终检查完全沿用实现 Agent 自己的假设。

最简单的反馈回路可以就是一段 CLAUDE.md：

    ## Verifying your work
    - Build: make build (must finish with "Build succeeded")
    - Test: make test (all green; never skip or delete a failing test)
    - Lint: make lint (zero warnings)

    Run all three before reporting any task complete, and paste the output.
    If a test fails, fix the code, not the test.

更重要的是，Agent 的工作环境本身也需要回归测试。Playbook 建议收集 20–50 个近期真实任务，每个任务都保留输入 Prompt 和定义可接受结果的 Checks；形成 Evals Suite，在 CI 中定期运行，并在 CLAUDE.md、Skills 或 Hooks 发生变化时触发。模型升级、Prompt 改写、Skill 调整都可能改变 Agent 行为，因此不能只测试业务代码，不测试驱动 Agent 的配置。

每次生产事故也应该沉淀为新的 Eval Case。这样，团队不是只在某个 PR 上修复一次问题，而是让同类问题成为后续 Agent 必须持续通过的回归场景。Eval 的通过率下降时，应像代码测试失败一样阻止配置变更合并。

### 第六步：Review、审批与部署也要适应 Agent 的速度

Playbook 并不主张让 Agent 自动批准所有代码。它提出多层 Review：Agent 可以先检查 PR 是否符合 Spec、Plan、项目规范和测试证据；人类则集中审查业务意图、架构取舍、高风险变更和监管关键代码。REVIEW.md 可以承载组织的审查规则；自动 Review 负责发现问题和提供证据，而不是取代代码 Owner 的责任。

Hooks 作为审批门禁，负责在需要人类决策时暂停执行，例如生产发布、敏感操作或策略例外。CI/CD 中可以用非交互式 Claude Code 处理构建失败分类、生成变更说明、修复 lint 或响应 Review 意见，但 Agent 应运行在沙箱中，使用短时、最小权限凭证；部署工具通过 MCP 暴露为按环境授权的操作，而不是把生产凭证直接交给 Agent。开发环境可以有更高自主度，生产环境则由发布负责人批准，Hook 强制执行。

这套方法的核心不是“Agent Review 代替人工 Review”，而是把 Review 分工：机械性、重复性和可验证的问题尽可能前移自动化；人集中在需要业务判断、风险接受和责任承担的决策上。

### 第七步：生产运行状态重新进入需求入口

Maintain 阶段把 Playbook 从一次性交付流程变成闭环。Agent 监控生产指标；当指标超出正常控制区间（control band），先按预先定义的权限和风险等级进行诊断，再把问题写成新的 intent.md，重新进入 Plan 阶段。也就是说，生产反馈不再只是一个孤立告警或待办，而成为可追踪的新需求来源。

例如，理赔状态 API 的 P95 延迟连续超出控制区间，系统可以触发诊断任务，Agent 汇总影响、相关部署、日志和指标，草拟一份 intent，描述受影响的用户、业务后果和预期改善。是否扩大缓存、调整数据源或改变业务 SLA，仍由有权人员确认；Agent 不应因为发现指标越界就自行改变业务承诺或生产策略。

这使 intent.md 不仅是新功能的起点，也成为事故、性能退化和运营问题进入工程改进流程的统一入口。

### Anthropic Playbook 怎样衡量效果？

Playbook 的一个优点是没有只用代码行数或 Agent 生成速度衡量转型，而是为每个 Play 提出 Leading Indicator 和 Lagging Indicator。举例来说：

| Play | 领先指标 | 滞后指标 |
| --- | --- | --- |
| Capture intent | 从首次讨论到提交 intent.md 的时间 | Intent 被 Product Owner 接受进入设计阶段的比例；Spec 提交后又回改 Intent 的次数 |
| Requirements and design | intent.md 到 spec.md 的提交时间 | Build 开始后仍需修改 Spec 的次数 |
| Plan mode | Spec 到批准 Plan 的时间 | 实现过程中 Plan 变更频率、PR 对 Plan 的偏离 |
| Feedback loop | Agent 首次运行 Build/Test/Lint 的成功率 | 每个 PR 的人工 Review 时间、变更失败率 |
| Continuous evals | Eval Suite 覆盖的真实任务数和运行频率 | Agent 配置变更后任务通过率的回归幅度 |
| PR review / Hooks | 自动 Review 覆盖率、被 Hook 拦截的未授权操作 | Review 等待时间、未经批准的高风险变更数量 |
| CI/CD | Pipeline 中 Agent 可安全处理的步骤比例 | 部署失败率、回滚时间、生产变更失败率 |
| Maintain | 指标越界到诊断和 Intent 生成的时间 | 事故恢复时间、同类问题复发率 |

需要特别说明：Playbook 中“从数周降到数小时”等表述，是流程改善的预期和建议观测指标，不是一项公开的随机对照实验结果。Playbook 是 Anthropic Applied AI 团队基于内部实践和客户项目经验整理的实施指南，不是证明 AI-native SDLC 平均提升某个百分比的学术研究。采用时应把它的指标当成团队自己的基线和验证框架，而不是引用成已被实验验证的生产率增幅。

对 SDD 的意义在于：Spec 不再是一份写完就归档的文档，而是整个 Agent 交付链中的一个受控版本化工件。它要能被 Plan 引用、被测试验证、被 PR Review 检查；发生偏离时要能回写更新；上线后的问题还可以重新生成 Intent，启动下一轮需求与设计。


## OpenAI、LangChain 和 Thoughtworks：Spec 正在和 Harness、Eval 融合

SDD 并不是这些团队唯一使用的术语。它与 Harness Engineering、Context Engineering、Eval-Driven Development 有交叉：共同关注点是把目标、约束、工程上下文和验证变成 Agent 可持续消费的工作材料。

### OpenAI：把设计约束、代码库结构和反馈回路做成 Agent 的工作环境

OpenAI 在 2026 年 2 月发布的 [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) 描述了一个从空仓库开始的内部产品实验。团队称，约五个月内交付了约一百万行应用、基础设施、工具和文档代码，合并约 1,500 个 PR，最初三名工程师推动 Codex 工作，平均约为每位工程师每天 3.5 个 PR；后续团队扩展到七人。文章估计项目用时约为手工编写代码的十分之一。

这不是一次 SDD 与普通 Prompt 的对照试验，十分之一是团队自己的估算，PR 数量也不是交付质量的完整度量。不过它提供了一个清楚的 Agent-first 工程案例：团队没有让 Codex 在一个缺少结构的仓库里自由生成，而是逐步建立能被机器理解和检查的工程环境。架构层次、跨模块依赖和代码规范通过自定义 Linter 与结构测试强制执行；UI、日志、指标和 Trace 被接入本地环境，让 Agent 可以启动应用、复现问题、观察运行结果并验证修复。人描述任务并设定目标，Codex 负责实现、运行检查、创建 PR，再接受本地和云端 Agent Review 的反馈。

这类工程实践可以看成 Spec 的执行侧：Spec 说明变化应该达到什么状态，Harness 则提供 Agent 能够观察、操作和验证这个状态的环境。只有文字契约、没有可执行验证工具，Agent 仍然可能“按文档说完成了”，但实际行为并不正确。

### LangChain：用精简的项目上下文指导 Agent，再按需读取详细文档

LangChain 在 2025 年对 Claude Code 做过一组面向自身 LangGraph / LangChain 库的配置对比，详见 [How to turn Claude Code into a domain specific coding agent](https://www.langchain.com/blog/how-to-turn-claude-code-into-a-domain-specific-coding-agent)。团队固定使用 Claude 4 Sonnet，比较了四种配置：原始 Claude Code、加文档 MCP、加入详细 CLAUDE.md，以及 CLAUDE.md 与 MCP 同时使用。测试任务包括构建多节点 LangGraph Agent，并覆盖 Text-to-SQL 等场景。

他们发现，单独接入 MCP 文档并没有达到预期：Agent 有时只读取文档入口页，没有继续深入关联页面。包含 LangGraph 核心概念、项目结构、标准模式、常见陷阱和调试方法的精简 CLAUDE.md，反而比单独接入 MCP 更重要；MCP 工具本身相对 Vanilla 约提升 10 个百分点，但最好的结果来自 CLAUDE.md 提供方向、MCP 在需要时补充细节。团队还指出，在其中一个任务上，CLAUDE.md 配置的成本约为 MCP 单独配置或二者组合的 2.5 分之一。

它不是功能需求 Spec 的比较，而是项目级上下文的实验。对写 Spec 有两个实际启发：一是不要把整套 API 文档无差别塞进 Prompt，二是 Spec 应该把高价值信息压缩到足以指导决策的程度，并为 Agent 提供进一步查阅权威资料的路径。实验代码和任务定义可以查看 [langchain-ai/claude-code-evals](https://github.com/langchain-ai/claude-code-evals)。

LangChain 2026 年发布的 [Eval-Driven Development](https://www.langchain.com/blog/what-is-eval-driven-development)则把这一思路应用到行为开发：先定义什么算好结果，再写 Eval，最后修改 Agent 并比较实验。它要求每个行为的简短 Spec 写清何时触发、Agent 应该做什么、不应该做什么，以及哪些既有行为必须保持。Spec 必须明确到可通过或失败。文章举例：用户报告 VPN 连接故障时，Agent 应调用 create_ticket；用户只是询问如何连接 VPN 时，不应创建工单；原有文档搜索和网页搜索行为仍须保持。这是一个比“增加工单功能”更容易验证的需求。

LangChain 与 Monday.com 合作的 [Code-First Evaluation Strategy](https://www.langchain.com/blog/customers-monday)进一步展示了验证成本的变化。Monday.com 为面向 IT 等部门的 Agent 建立了约 30 条真实、脱敏的已解决工单数据集，再逐渐增加检索、记忆、冲突解决和 Guardrail 场景；它们报告离线评估反馈周期从 162 秒下降到 18 秒，约快 8.7 倍，数百个案例可以在几分钟内检查。这测量的是 Agent 质量反馈周期，不是开发者从需求到生产的耗时，更不是 SDD 相对直接 Prompt 的提速。

### Thoughtworks：把需求分析、推理依据和生成 Prompt 一起版本化

Thoughtworks 内部 IT 团队公开的 [Structured Prompt-Driven Development（SPDD）](https://martinfowler.com/articles/structured-prompt-driven/)是另一个值得看实际文件的案例。它把 Prompt 当作一等交付资产，和代码一样版本化、审查、复用。流程先记录初始需求，再通过澄清分析和 REASONS Canvas 梳理业务理由、约束和决策，随后形成结构化 Prompt，最后生成代码与测试。它强调三个技能：抽象优先、意图对齐和迭代审查。

这个方法比单纯的 requirements.md 多保留了一层“为什么这样做”的上下文。对复杂业务变更，只有行为规则而没有决策依据，后续 Agent 仍可能在修改时误解业务取舍。SPDD 也明确指出，即使 Agent 能够检查代码是否符合 Canvas，仍然需要人确认 Canvas 是否符合真实业务意图。

它提供了实际可读的开源实现和示例变更：

- [open-spdd](https://github.com/gszhangwei/open-spdd)：SPDD 的命令、流程与模板集合。
- [spdd-reasons-canvas.md](https://github.com/gszhangwei/open-spdd/blob/v0.4.9/internal/templates/data/core/spdd-reasons-canvas.md)：把业务理由和决策依据结构化的模板。
- [token-billing 示例项目](https://github.com/gszhangwei/token-billing/tree/after-enhancement)：包含初始需求、分析、结构化 Prompt、代码变更和测试资产。
- [变更前后代码对比](https://github.com/gszhangwei/token-billing/compare/before-enhancement...after-enhancement)：可以直接检查一个需求怎样逐步转成实现。

这些是实践项目和模板，不是经严格控制的生产率实验。它们的价值在于让读者看到，规格不一定只是一份面向 Agent 的功能说明，也可以把业务推理和设计决策留下来，成为后续维护的上下文。


## 业界工具正在把 Spec 放到开发流程中

GitHub Spec Kit 是较早明确推动 SDD 的开源工具之一。它把规格放在工程流程中心，并将工作划分为四个阶段。Specify 先整理用户、问题、使用流程和成功标准；Plan 再加入技术栈、架构和约束；Tasks 将计划分解为可审查和可测试的工作项；Implement 才进入代码修改。GitHub 的设计强调每个阶段的产物都要经过人工检查，Agent 负责大量文档和代码生成，人负责方向和结果确认。

[Spec Kit 仓库](https://github.com/github/spec-kit)可以与 GitHub Copilot、Claude Code、Gemini CLI 等编码 Agent 配合。它的价值在于提供了一种相对通用的工作约定，而不是某种只能由特定模型执行的专有规格语言。

AWS Kiro 的 [Specs](https://kiro.dev/docs/specs/) 采用了更明确的文件结构：requirements.md、design.md 和 tasks.md。Requirements-First 工作流先整理需求，再生成技术设计和任务；Design-First 则适用于技术约束或架构方向已经比较明确的情况。Kiro 的 [Feature Specs 文档](https://kiro.dev/docs/specs/feature-specs/)还使用 EARS（Easy Approach to Requirements Syntax）来组织可测试的需求表达，并在设计文件中覆盖架构、数据流、接口、数据模型、错误处理和测试策略。

Kiro 还提供 [Analyze Requirements](https://kiro.dev/docs/specs/best-practices/) 来检查逻辑矛盾、歧义、约束冲突和遗漏，并支持把规格保存在代码仓库中进行版本管理。这种做法很重要：如果设计变化了，需求和任务也要跟着更新；不能只维护代码，而让规格逐渐成为过期文档。

这些产品文档证明相关工具已经把 SDD 做成可用的工作流，但不能据此推断它已经提升了多少生产率。工具具备需求分析、任务追踪和并行执行能力，与企业部署后能够持续减少返工，是两个不同层次的结论。

## 论文给出的证据：正确率有改善，生产率证据仍不充分

研究领域正在从“模型能不能根据 Prompt 写代码”，转向“需求表示的质量会怎样影响最终实现”。这条研究线索比厂商对 SDD 的概念定义更接近问题本身。

2024 年的 [ArchCode: Incorporating Software Requirements in Code Generation with Large Language Models](https://arxiv.org/abs/2408.00994) 将需求作为文本描述与代码之间的中间层。它让模型从原始描述中整理功能和非功能需求，再分别生成代码和对应测试。需求分类包括输入输出条件、预期行为、边界情况，以及时间性能、健壮性、可维护性和可靠性。论文在 HumanEval-NFR 等基准上报告，相比 GPT-3.5-Turbo 等基线，ArchCode 能显著改善代码满足功能及非功能需求的结果。一个值得注意的设计是：代码和测试从需求中并行生成，而不是直接让测试生成结果决定代码，这样可以降低测试提示对实现的偏置。

ArchCode 支持了一个重要判断：原始文本中明确写出来的内容，并不一定覆盖正确实现所需的全部要求；把这些要求显式整理出来，再逐项验证，有助于改善代码生成。不过它主要评估函数级代码和基准测试，不是对完整开发团队端到端效率的测量。

2026 年的 [WiseSpec: Requirements-Driven Agents for Code Generation](https://doi.org/10.1145/3832783.3844573) 则把这种方法推进到代码仓库级任务。WiseSpec 会沿着代码依赖逐步检索仓库上下文，再用包含 9 个主要属性和 17 个子属性的 DSL 组织需求，覆盖架构和更细粒度的实现要求。它还把规格缺陷分成冲突、遗漏和歧义，通过生成代码和测试、执行验证，再迭代修订需求。

WiseSpec 在 SWE-bench-Lite、SWE-bench-Verified 和 SWE-bench-Pro 上各抽样 100 个任务，使用 DeepSeek 和 Qwen 模型，与 Agentless、Trae-agent、Claude Code 等方案比较。论文报告，在六组基准与模型组合中，WiseSpec 都取得了更高的结果；相对基线，代码解决率（%Resolved）提高约 2 至 29 个百分点，补丁可应用率（%Applied）提高约 11 至 63 个百分点。论文还报告了统计显著性检验结果。对于更强模型的补充实验，Claude Code 在 SWE-bench-Pro 上解决率为 53%，WiseSpec 为 56%。

这是支持需求驱动 Agent 的直接实验结果，但不能把它读成“SDD 让开发者快了 13%”之类的生产率结论。WiseSpec 的核心指标是补丁能否应用、能否通过基准中的标准测试；它没有测量需求整理、人工审核、等待、代码审查和维护的全部时间。它的需求质量评估还依赖模型生成的代码和测试作为代理指标，测试是否准确代表真实用户意图，仍然是一个需要独立验证的问题。

另一个方向是研究自然语言歧义本身的危害。[Clarity Is Not Assumed: Understanding LLM-Based Code Generation under Ambiguous Requirements](https://arxiv.org/abs/2604.21505) 提出了 Orchid 基准，覆盖 1,304 个代码生成任务，并为原始需求构造了词汇、句法、语义和模糊性等不同类型的歧义版本。研究在相同任务和测试条件下比较原始需求与歧义变体，发现歧义使 Pass@1 平均下降 7.22 个百分点，最大下降达到 32.35 个百分点。它清楚地说明，模型在需求清楚时表现不错，并不代表它在需求含糊时也能稳定实现正确行为。研究范围主要是函数级任务，尚未覆盖大型仓库中多个需求交互、跨模块依赖和需求持续变化的全部情况。

但 SpecBench 给出了另一面。[SpecBench: Evaluating Specification-Level Reasoning for Software Engineering LLM Agents](https://arxiv.org/abs/2605.30314) 使用 Kubernetes、React、Rust、TVM 和 vLLM 等项目的 RFC 提案和历史讨论，测试 Agent 能否识别设计规格中的遗漏、歧义、不一致和错误假设。表现最好的 Agent 准确率也只有 44.4%。这项早期基准只考察识别缺陷，还没有完整评估如何修订规格；作者也指出，评分需要更多领域专家验证。它提醒我们：不能假定 Agent 能可靠地审查自己刚刚生成的 Spec。重要业务规则和高风险约束仍然需要人确认。

把这些论文放在一起，能够得到比较稳妥的结论：**明确、完整的需求有助于提高代码生成的正确性；当前 Agent 对歧义和规格缺陷仍然敏感，且自行识别问题的能力有限。**但从代码正确率到真实生产率，中间还隔着需求分析成本、人工 review、返工、集成、部署和后续维护。

## SDD 的对照数据：目前能证明什么，不能证明什么

现有研究已经不只停留在概念介绍，开始比较结构化需求、普通自然语言和不同开发方法。但必须把几种研究设计拆开看：有的比较输入规格对代码正确率的影响，有的比较 SDD 与 TDD，有的是一个组织上线 Spec Kit 前后的观察，还有一些只是测量 AI 编码整体使用后的 PR 数量或评估反馈速度。它们不能合并成“SDD 平均提升 X%”。

### 规格是否比直接自然语言更有助于生成正确代码？

2026 年的 [Feng 等人的 Structured Spec-Driven Engineering 研究](https://arxiv.org/abs/2605.02455)提供了比较接近这个问题的实验。研究选取三个已有 MVC 项目，覆盖不同领域；使用五种模型（Claude Sonnet 4.5、Qwen3 Coder、GPT-5.1、GPT-5 Nano 和 Llama 3.2 3B），让它们根据不同规格输入生成 Python 业务逻辑，再通过人工编写和验证的测试集计算 Test Pass Rate。每种配置重复十次。

研究比较了自包含的自然语言需求、Gherkin 场景、领域模型，以及模型层类与函数签名等输入。结果并不是“Gherkin 永远胜过自然语言”：在 30 组模型和模型工具配置中，Gherkin 的测试通过率只在 14 组高于自然语言；其整体平均测试通过率反而低约 6.8%。但在 Gherkin 胜出的组合中，平均提升约 7.7%；模型层签名和自然语言规格组合，也使平均通过率提高约 7.82%，并降低结果波动。论文展示了一个组合条件下的极端案例：Symboleo/Umple 样本的自然语言基线为 0%，Gherkin 与领域模型组合达到 99.1%（标准差 2.9%）。这不是单纯替换文本格式的 A/B 测试，而是加入了领域模型信息；不能把这个结果归因于 Gherkin 一个因素。

这项研究的价值在于揭示了“结构化信息、领域模型和 API 签名”如何共同帮助模型减少接口臆测、理解业务规则，并让生成结果可以由独立测试验证。它仍然是三个代码库上的小规模 pilot，测量的是测试通过率而不是需求分析、审查、返工和交付总耗时。研究自身也观察到模型间及配置间有明显波动。

[2025 年 Jia 等人关于歧义需求自动修复的研究](https://arxiv.org/abs/2505.07270)则发现，系统识别并补全了约 43.58% 的不完整或有歧义的题目描述；在这些实际被修复的任务上，模型正确率提高约 30.9%。由于大多数输入原本已经足够清楚，摊到全部任务后整体收益约为 4.09 个百分点。它支持的是“先识别并修复真正缺失的信息”，而不是所有需求都应该增加同样数量的细节。研究仍是函数级代码生成，不是大型项目或团队交付实验。

[WiseSpec（2026）](https://doi.org/10.1145/3832783.3844573)更接近仓库级 Agent 工作。它把需求、代码依赖上下文、DSL 结构化和执行反馈结合起来，在 SWE-bench-Lite、Verified 和 Pro 上抽取任务进行比较。与 Agentless、Trae-agent 和 Claude Code 基线相比，论文报告 %Resolved 提高约 2–29 个百分点，%Applied 提高约 11–63 个百分点；摘要给出的平均解决率提升是 13.17%。这说明“Agent 先理解仓库并整理需求，再执行验证和修订”可能改善复杂代码修改的成功率。但这是一套包含上下文检索、需求质量评估和迭代修订的完整框架，不是隔离了其他变量的“Markdown Spec vs 一句 Prompt”实验，也没有测量开发者实际节省多少小时。

### SDD 自身有成本，而且未必比 TDD 快

2026 年 KTH 的学士学位论文 [A Performance Evaluation of Test-Driven and Spec-Driven Development using AI-Assisted Code Generation](https://kth.diva-portal.org/smash/record.jsf?pid=diva2%3A2101100)把 AI 辅助下的 SDD 与 TDD 放在同一个小规模实现实验中比较。两种方法各完成一个功能等价的预算规划 Web 应用原型。SDD 使用 Constitution、Specification、Plan 和 Tasks；TDD 则先写测试，再逐步实现。研究只覆盖实现阶段，不是长期团队交付数据。

结果并不支持“SDD 更快”：TDD 总耗时为 469 分钟，SDD 为 634.5 分钟，SDD 多约 35%，其中 Spec 编写本身就用了 145 分钟。TDD 的整体代码覆盖率也更高（91.0% 对 82.5%），条件覆盖率差异更明显（81.8% 对 60.4%）。但静态分析指标呈现另一面：SDD 技术债估算为 34 分钟，低于 TDD 的 276 分钟；维护性问题数量为 5，对比 TDD 的 41；按全部代码计算的静态问题密度为每 KLOC 1.9，对比 TDD 的 32.2。SDD 同时在圈复杂度和认知复杂度上更高，说明不同质量指标并不一致。

不能根据这个单一原型实验得出“SDD 会增加 35% 开发成本”或“SDD 一定更易维护”的普遍结论。它的意义是提醒团队：规格撰写成本必须纳入总成本；覆盖率、结构复杂度、静态问题和技术债也可能给出相互不同的判断。具体结果受原型设计、实现者、AI 工具、任务顺序和小样本规模影响，尚需更大规模的重复实验。

### 真实团队采用 Spec Kit 后发生了什么？

2026 年的 [The Productivity-Reliability Paradox](https://arxiv.org/abs/2605.01160)汇总了相关研究，并附带一个 14 名工程师、三个 Web 项目的四个月 illustrative pilot。前两个月是团队原有的自然语言工单 + AI 编码流程，后两个月引入 Spec Kit：每个项目建立项目级 Constitution，中高影响变更走 Specify、Plan、Tasks 流程。

作者报告的近似运营指标如下：

| 指标 | 原有流程（2 个月） | 引入 Spec Kit（2 个月） |
| --- | ---: | ---: |
| Feature lead time 中位区间 | 8–12 工作日 | 6–9 工作日 |
| 每 Sprint 后期 Hotfix | 3–5 | 1–2 |
| 每月 Rollback | 2–4 | 0–1 |
| 两周内被 Revert 的变更行比例 | 12–18% | 6–10% |
| 开发者信心评分（1–5） | 3.1 | 3.9 |
| 中等功能的 Spec/Plan 编写成本 | — | 45–90 分钟 |

这组数据对实际采用成本很有帮助，但论文明确说明它不是受控实验：没有平行对照组，度量是事后从 Git、CI/CD 和工单系统中汇总的近似区间；研究期间模型能力也在变化。因此它只能说明一个组织在特定流程调整后观察到这些趋势，不能证明变化完全由 Spec Kit 导致。特别要留意 45–90 分钟的规格成本：如果后续没有减少等待、返工或质量事故，流程就不一定划算。

### 其他 AI 公司报告的数字，不能冒充 SDD 的提速幅度

| 团队 / 来源 | 公开数字 | 实际测量的对象 | 和 SDD 的关系 |
| --- | --- | --- | --- |
| OpenAI Codex Harness Engineering | 约 1,500 个合并 PR；约 3.5 PR/工程师/天；团队估计约为手工开发的 1/10 时间 | 新产品团队的 Agent-first 交付吞吐与自我估算 | 不是 Spec 对照试验；主要说明 Harness、架构边界和反馈系统的重要性 |
| Anthropic 内部工程 | 2026 年 5 月超过 80% 合并代码由 Claude 编写；2026 Q2 每位工程师每日合并代码量约为 2024 年的 8 倍 | 内部 AI 编码产出比例和代码量 | 不是 SDD 效果；代码行数不是质量调整后的生产率 |
| LangChain / Monday.com | Eval 反馈周期由 162 秒降至 18 秒，约 8.7 倍 | Agent 离线评估和回归反馈速度 | 不是开发总耗时；说明可执行验收能缩短反馈循环 |
| LangChain / Cisco 合作案例 | 20 多个调试流程的 Root Cause 时间减少 93%；一个月 512 次 Session 估计节省 200 多工程小时；开发流程执行时间减少 65% | 多 Agent 协作的调试与测试流程，相对历史基线 | 客户访谈/试点报告，不是 SDD 对照试验，也不是随机试验 |
| LangChain Claude Code 配置实验 | 文档 MCP 单独使用相对 Vanilla 约提高 10 个百分点；精简 CLAUDE.md 比单独 MCP 更重要，二者结合最佳 | 三种 LangGraph 代码生成任务的完成与代码质量评分 | 属于 Agent 上下文配置实验，不是功能 Spec 的端到端生产率比较 |

这些数字有参考价值，但要看清它们到底测了什么。OpenAI 和 Anthropic 的数字体现了 Agent 参与后代码产出规模的变化；LangChain/Monday 的数字是评估反馈周期；Cisco 合作案例测的是根因定位和开发流程执行；LangChain 配置实验比较的是项目知识如何提供给 Agent。它们共同支持一个趋势：把工作环境、上下文和验证能力工程化，通常比单纯加长 Prompt 更有意义。但没有任何一组数字可以直接写成“SDD 让团队提速了 X%”。

因此目前最稳妥的判断是：规格结构和上下文质量能够影响代码生成正确率，复杂需求的系统化拆解有真实工程价值；SDD 是否带来净生产率提升，则取决于规格成本是否被更少的返工、故障和审查等待抵消。现有公开证据尚不足以给出一个适用于所有团队的平均 ROI。


## AI 编码工具本身能提速，但效率收益并不稳定

讨论 SDD 是否提高生产率之前，需要先看 AI 编码工具整体的生产率证据。这个领域已有不少研究，但结果并不一致，而且研究对象不是 SDD。

Google 在 2024 年发表的[企业随机对照试验](https://arxiv.org/abs/2410.12944)招募了 96 名全职工程师，随机分配 AI 工具或无 AI 工具条件，完成一个企业级代码修改任务。分析样本中，AI 组平均用时约 96 分钟，对照组约 114 分钟，研究估计的任务时间改善约为 21%，统计检验达到显著水平。这个结果支持 AI 辅助在特定任务中缩短完成时间，但实验使用的是 Google 内部工具和单一任务场景，作者也明确提醒不能把效果直接推广到其他工具、任务和时间阶段。

METR 在 2025 年对有经验的开源开发者做了另一项随机对照试验：[Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://arxiv.org/abs/2507.09089)。16 名开发者在自己熟悉的成熟项目中完成 246 个任务，每个任务随机允许或禁止使用 AI。结果出乎参与者预期：允许使用 AI 后，任务完成时间反而增加了 19%。研究记录显示，开发者需要花时间检查和清理生成结果；模型也缺少专家对大型代码库的隐性认识。这个结论同样有边界：样本量小，针对的是 2025 年初的工具和高度熟悉的成熟仓库，不代表所有开发任务都会变慢。但它说明，代码生成速度不等于任务完成速度。

企业真实使用中的变化也不只是“更快写代码”。2025 年 DORA 报告基于近 5,000 名技术从业者的调查和定性研究，发现 AI 使用与软件交付吞吐量、产品绩效呈正向关系，同时也与交付稳定性下降相关。报告的解释是 AI 会放大组织已有的优势和弱点：自动化测试、快速反馈、版本控制和高质量内部平台，会影响组织能否把个人效率转化为稳定的交付结果。[DORA 2025 报告](https://dora.dev/research/2025/dora-report/)

一篇 2026 年的企业纵向研究 [AI Writes Faster Than Humans Can Review](https://arxiv.org/abs/2607.01904) 分析了一家 AI 使用较积极的企业，涵盖 802 名开发者和 196,212 个 PR。研究估计，开发者开始使用 AI 后，PR 吞吐量提高约 12%，随后随着使用时间增长继续上升；但每位 Reviewer 的审查负担也大约翻倍。该研究不是随机试验，来自单一公司，PR 数量也只是生产率的一个代理指标，不能据此推断所有企业都会获得相同结果。它揭示的却是一个重要问题：Agent 可以更快地产生变更，瓶颈会转移到需求确认、审查和集成。

因此，SDD 最有价值的假设不是它能让 Agent 写得更快，而是它能减少错误实现、反复澄清和下游审查返工，让更快的代码生成真正转化为可接受的交付。

## 真正有用的 Spec 应该包含什么？

一个实用的 Spec 不需要一开始就成为完整的形式化模型。对于常见功能任务，先把下面几类信息整理清楚，通常已经足够：

- **目标与范围**：要解决什么问题，哪些行为属于本次变更，哪些明确不做。
- **角色与权限**：谁能执行操作，依赖什么身份或授权，是否存在数据隔离要求。
- **功能行为**：在什么前置条件下执行什么操作，成功时返回什么，异常时如何响应。
- **业务规则和不变量**：哪些规则不能被实现过程改变，哪些状态转换不允许发生。
- **非功能约束**：性能、容量、可用性、审计、安全、可维护性等真正影响方案的要求。
- **验收条件**：如何判断每项行为已经实现，怎样覆盖正常路径、边界和失败情况。
- **假设与未决问题**：哪些信息来自现有代码或文档，哪些是 Agent 的推断，哪些仍需业务或架构人员确认。

一个轻量的结构化表示可以长这样：

    spec_version: 1
    feature: portfolio-export
    goal: 允许具备权限的分析人员导出当前筛选范围内的持仓数据
    scope:
      included:
        - 导出当前用户有权查看的持仓
        - 保留页面当前筛选条件
      excluded:
        - 批量导出其他用户的数据
    requirements:
      - id: FR-01
        behavior: 导出内容必须受当前用户的数据权限约束
        acceptance:
          - id: AC-01
            given: 用户只能查看组合 A
            when: 用户导出当前筛选结果
            then: 文件中不得包含组合 B 的持仓
      - id: FR-02
        behavior: 导出结果应保留页面已应用的筛选条件
        acceptance:
          - id: AC-02
            given: 页面已筛选出满足条件的持仓
            when: 用户执行导出
            then: 导出文件仅包含该筛选结果
    constraints:
      security:
        - 导出操作必须经过服务端授权
      audit:
        - 记录操作主体、时间和导出对象范围
    assumptions: []
    open_questions:
      - 大数据量导出是否需要异步任务？

这里的格式只是示例，字段也不代表必须为每个项目统一采用。真正重要的是 FR-01 有稳定 ID，验收条件描述了可以验证的行为，权限约束没有埋在一句模糊的需求里，尚未决定的问题没有被 Agent 擅自补齐。

可以先用 Markdown 作为主要表达方式，再用 JSON Schema 或 Zod 等工具验证固定字段、枚举、ID 和引用关系。对外部 API 使用 OpenAPI，对消息结构使用 JSON Schema，对状态转换使用状态模型，对性能要求使用可执行的测试阈值。只有在结构化数据确实有下游消费者时，才值得把它变成严格机器可读的格式。让所有需求都变成复杂 DSL，会把需求工程变成新的维护负担。

还有一个容易忽视的点：Spec 不应把实现方案和需求行为混在一起。需求规格说明要实现什么，技术设计说明准备怎样实现。把两者分开，架构调整时就不至于把用户行为契约也一起改掉；反过来，业务规则变化时，也能追踪它对设计和任务的影响。

## 谁来写 Spec？不是把全部需求工作交给一个“Spec Agent”

实际开发中，Spec 通常由人和 Agent 协作形成，但责任不能平均分配。业务含义由懂业务的人确认，技术边界由负责系统的人确认，Agent 可以承担大量资料整理、问题发现、草拟和任务分解。

| 角色 | 应负责什么 | 可以让 Agent 做什么 | 最终确认权 |
| --- | --- | --- | --- |
| Product Owner / 业务负责人 | 用户目标、业务规则、范围、优先级和明确不做的事项 | 访谈问题整理、现有需求归纳、验收场景初稿 | 业务含义和范围 |
| 领域专家 / Operations | 例外流程、日常操作、数据定义、监管或控制要求 | 从流程文档和历史案例提取规则，生成边界场景 | 领域规则和例外 |
| Architect / Tech Lead | 系统边界、接口契约、数据模型、NFR、架构约束 | 仓库检索、依赖分析、设计选项、影响面和风险清单 | 技术设计和架构取舍 |
| QA / 测试负责人 | 验收策略、覆盖范围、测试数据、回归条件 | 从每条需求生成 Given/When/Then、测试骨架和追踪矩阵 | 测试是否真的证明需求 |
| Coding Agent | 读取已确认规格、提出缺失问题、分解任务、实现和回报结果 | 大部分编码、测试实现、文档更新 | 不拥有业务意图的最终解释权 |

在小团队里，同一个人可以同时担任 Product Owner、架构师和 Reviewer；关键是要明确哪一种判断是以什么身份作出的。高风险的业务规则不应由生成该 Spec 的同一个 Agent 自己审批。至少要有一个真正理解业务、并能质疑其假设的人审阅。

一个实用的工作顺序是：人先描述目标和已知约束，Agent 检查代码库、现有 API、数据模型、测试与文档，形成规格草案和待澄清问题；业务负责人确认“要做什么”，架构负责人确认“哪些边界不可越过”；Agent 再提出设计和任务分解；实现后由测试、CI 和人工 Review 分别验证。对明确、低风险的小变更可以减少审批层次，但权限、资金、隐私、审计和不可逆操作不能因为想追求自主性而交给模型猜测。

## Spec 应该写多详细？以“能判断正确与否”为止

Spec 的详细程度不应该按字数、字段数量或章节数量衡量，而要看它是否足以减少对结果影响最大的猜测。需求清楚、范围局部的功能，几条验收条件可能就够了；涉及跨模块流程、业务状态、权限边界或多个 Agent 的长任务，则需要更多场景和约束。

比较稳定的做法是把信息放到不同层次，而不是将所有内容塞进一份超长 requirements.md：

    specs/
      portfolio-export/
        spec.md           # 用户行为、业务规则、范围和验收条件
        design.md         # 架构影响、接口、数据流、失败处理
        tasks.md          # 可独立实施和验证的任务
        evals/
          export-access.json
          filter-preservation.json

项目级文件则放在另外的位置：

    AGENTS.md              # 仓库地图、常用命令、开发流程入口
    .claude/CLAUDE.md      # Claude Code 的项目级常驻指引（如项目使用）
    .specify/memory/
      constitution.md      # 跨功能长期适用的工程原则（如采用 Spec Kit）

AGENTS.md / CLAUDE.md 应该说明 Agent 如何认识和操作仓库，不应该重复每个功能的业务需求；constitution 放稳定的项目约束，feature spec 只描述本次功能和它需要改变的行为。这样，日后另一个功能不会误把旧需求当作全局规则。

### 一份可落地的 feature spec 需要覆盖什么

一份中等复杂度的规格一般需要交代以下内容。它们不是每项都必须写成独立章节，但关键决策不能缺席。

| 内容 | 具体写法 | 常见错误 |
| --- | --- | --- |
| 背景与目标 | 谁遇到什么问题，本次改善什么结果 | 把解决方案当成目标 |
| 范围 | Included / Excluded 明确列出 | 只写要做的，不写不做的 |
| 用户与权限 | 使用者角色、资源归属、授权前提 | 默认所有用户都有相同权限 |
| 功能需求 | 一条规则一个 ID，使用可验证的行为语言 | “支持灵活导出”“体验更好”等空泛表述 |
| 业务规则和不变量 | 金额、状态转换、优先级、数据定义、冲突处理 | 只描述正常路径 |
| 边界与异常 | 空数据、重复请求、过期状态、超时、部分失败 | 只测 Happy Path |
| 非功能要求 | 明确阈值、负载、测量点和适用条件 | “高性能”“企业级安全”但没有验证方法 |
| 验收标准 | 每条重要需求有可观察的 Pass/Fail 条件 | 只有整体“测试通过” |
| 证据来源 | 链接到 API、流程、数据字典、现有代码或决策记录 | Agent 推断被写成既定业务事实 |
| 未决问题 | 明确列出假设、Owner 和阻塞状态 | 让 Agent 自动补全仍未决定的政策 |

行为需求可以采用 Kiro 使用的 EARS 风格，例如：“当用户提交导出请求时，系统必须检查该用户对每个组合的读取权限”；“如果某个组合不在用户授权范围内，文件不得包含该组合的数据”。对于场景较多的功能，可以用 Gherkin 的 Given / When / Then 来表达验收条件。格式不是目标，重点是不同实现者能否对预期行为达成一致。

### 示例：不要只写“支持持仓导出”

下面的例子把一个模糊需求拆成可检查的行为。这里使用 Markdown/YAML 混合只是为了易读；实际项目可统一使用 Markdown、YAML、JSON 或工具定义的模板。

    Feature: portfolio-export
    Goal:
      允许分析人员导出当前筛选范围内、且有权查看的持仓。

    Scope:
      Included:
        - 导出当前页面筛选结果
        - 支持 CSV 格式
        - 记录操作主体、时间和导出范围
      Excluded:
        - 导出其他用户无权查看的组合
        - 本次不提供定时或批量后台导出

    Requirements:
      - id: FR-01
        statement: 服务端必须按当前用户的数据权限过滤导出记录。
        source: Data Entitlement API / portfolio-access policy
        acceptance:
          - id: AC-01
            given: 用户仅有组合 A 的读取权限
            when: 用户导出组合 A 与组合 B 的筛选结果
            then: CSV 只能包含组合 A 的持仓
          - id: AC-02
            given: 用户的组合权限在页面打开后被撤销
            when: 用户提交导出请求
            then: 服务端重新校验权限，不得沿用页面旧状态

      - id: FR-02
        statement: 导出必须保留页面当前生效的筛选条件。
        acceptance:
          - id: AC-03
            given: 页面筛选条件为 Portfolio=A 且 AssetClass=Fixed Income
            when: 用户执行 CSV 导出
            then: 文件只包含满足两个条件的记录

      - id: FR-03
        statement: 每次成功导出都必须记录主体、时间、筛选范围和结果数量。
        acceptance:
          - id: AC-04
            given: 一次导出成功完成
            when: 审计查询该操作
            then: 能查到操作者、时间、过滤范围和导出记录数

    NonFunctional:
      - id: NFR-01
        statement: 在 10 万条授权记录、目标并发 20 的测试负载下，
                   服务端导出耗时 P95 不超过 5 秒。
        verification: performance-test / export-large-dataset

    OpenQuestions:
      - 超过 10 万条记录时是否切换为异步导出？Owner: Product
      - CSV 中的日期时区和金额小数位是否遵循用户偏好？Owner: Data Product

这份 Spec 刻意没有写“用哪个 React 组件”“采用哪张数据库表”“后端具体使用哪个类”。这些应进入 design.md，在检查仓库现状和架构约束之后再决定。若把实现细节过早写进需求，系统改变时 Spec 就会成为技术债。

### 设计文档、任务和 Eval 应该从 Spec 派生

design.md 解释怎样实现 Spec，而不是再次讲一遍业务目标。它至少要交代受影响的组件、调用方向、数据模型/接口变化、权限检查位置、事务边界、错误处理、观测点和回滚考虑。复杂系统还需要说明兼容性、迁移顺序和依赖团队。设计变更后必须回头检查需求是否仍然成立。

tasks.md 负责把设计拆成可独立实现、可独立测试、可 review 的增量。每项任务都应引用需求 ID，写清涉及的模块、前置依赖、完成条件和验证命令。例如：TASK-03 实现服务端导出授权过滤，关联 FR-01，完成时必须通过 AC-01 和 AC-02。不要把“做完整个持仓导出”当成单项任务，也不要为了拆而拆成只有改一个文件名、没有独立验证价值的微任务。

evals 或测试则把验收条件真正放到代码之外运行。一个重要要求至少要有一种独立验证方式：单元测试、集成测试、契约测试、浏览器端到端测试、属性测试、性能测试或人工业务验收。测试数据应来自真实边界或经过明确设计的 Fixture；不能让编码 Agent 修改测试直到自己的实现通过，然后把通过结果当作需求已实现。

建议维护一张简单的追踪表：

| Requirement | Acceptance / Eval | Implementation task | Status |
| --- | --- | --- | --- |
| FR-01 | AC-01、AC-02 | TASK-03 | Pending |
| FR-02 | AC-03 | TASK-04 | Pending |
| FR-03 | AC-04 | TASK-05 | Pending |
| NFR-01 | export-large-dataset | TASK-06 | Pending |

状态应由测试运行结果或 Review 结果更新，而不是由 Agent 自我报告。Spec、测试和代码必须一起演进：如果业务决定改变，应先改需求和验收；如果实现发现规格不可行，应提出规格变更并解释原因，不能静默偏离。

### 把什么交给机器可读 Schema？

不要因为 Agent 能输出 JSON，就要求所有规格都使用 JSON。Markdown 适合表达背景、决策理由和边界；YAML/JSON 适合有下游消费需求的字段，如需求 ID、优先级、状态和测试映射；OpenAPI / JSON Schema 适合接口与数据契约；状态机和领域模型适合表达复杂状态转换和实体关系。

Schema 能检查字段是否存在、类型是否正确、需求 ID 是否重复、任务是否引用了不存在的需求、是否遗漏验收引用。它不能判断“导出授权按账户而不是按组合”是不是正确的业务规则，也无法证明性能目标现实可行。业务语义仍要由专家确认，运行时行为仍要靠测试证明。


### 可复用的公开样例仓库

除了 Spec Kit 和 Anthropic 的 autonomous-coding，下面几个仓库和样例值得直接打开检查：

- [github/spec-kit](https://github.com/github/spec-kit)：适合观察 Constitution、Specify、Plan、Tasks 和实现阶段的模板与 CLI 工作流。
- [anthropics/claude-quickstarts/autonomous-coding](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding)：适合观察长任务如何用 app_spec、feature_list、进度记录和验收步骤跨 Session 继续。
- [gszhangwei/open-spdd](https://github.com/gszhangwei/open-spdd)：展示 Thoughtworks SPDD 的需求分析、REASONS Canvas、结构化 Prompt 和同步更新流程。
- [gszhangwei/token-billing](https://github.com/gszhangwei/token-billing/tree/after-enhancement)：有真实业务变更文件和前后版本对比，适合看需求如何关联到分析、Prompt、代码和测试。
- [langchain-ai/claude-code-evals](https://github.com/langchain-ai/claude-code-evals)：不是通用 SDD 框架，但有 LangChain 用来比较 Claude Code 配置的任务 Prompt、评估器和实验输入。


### 一个可执行的 Spec 审查清单

提交 Spec Review 时，建议直接回答以下问题，而不是只问“文档是否完整”：

1. 每条需求是否只有一个主要行为，且有稳定 ID？
2. 是否写出了触发条件、前置状态、预期结果和失败行为？
3. 用户角色和数据权限是否明确到可以写测试？
4. 空数据、重复请求、并发修改、超时和部分失败是否按风险覆盖？
5. 对金额、日期、数量、状态及数据语义的定义是否来自可验证的业务来源？
6. 性能、可用性、审计和安全要求是否有可测量阈值及验证方式？
7. 是否区分现有事实、已确认决定、Agent 推断和未决问题？
8. 哪些内容可以从现有代码中发现，因而没有必要在 Spec 中重复？
9. 设计是否说明了现有接口和数据契约的影响、失败恢复和回滚？
10. 每项任务和测试是否能追溯到需求，且不会由实现 Agent 自行修改验收标准？
11. 新需求与现有行为是否存在冲突，是否定义必须保持的回归行为？
12. 规格改变时，谁负责更新测试、设计和任务状态？

对复杂功能，最有价值的审查通常不是再加一段“注意安全”，而是指出某条规则仍然有两种可能的解释，并要求业务 Owner 作出决定。


## 把 Spec 接入 Agent 工作流，而不是增加文档步骤

可以从一条轻量的端到端流程开始。

用户先提交原始需求。Agent 读取相关代码、接口、测试和仓库级开发约定，形成 Spec 草稿，同时标出来源、假设和未决问题。这里的关键动作是先查上下文，不要让 Agent 在没有证据时直接发明项目约定。

接下来由人确认业务语义、权限边界和重要非功能要求。普通实现细节可以让 Agent 根据现有代码推导；涉及资金、个人数据、跨租户访问、不可逆操作、审计或监管要求的事项，则不应由模型自行决定。对于明确且低风险的任务，可以跳过正式审批，避免为了流程完整而增加不必要等待。

Spec 确认后，Agent 生成技术设计和任务分解。每个任务引用相关需求 ID，并说明要修改的组件、依赖和验证方法。编码 Agent 按任务实现，测试 Agent 根据验收条件补充测试。执行结果应该回写到任务状态和需求追踪信息中；某条需求没有验证通过，就不能仅凭代码已经生成或测试命令执行成功标记完成。

最后，Code Review 同时检查实现和规格：实现是否符合 Spec？Spec 是否遗漏了仓库中已有的约束？需求或架构发生变化时，是否同步更新测试、任务和规格？如果实现与 Spec 不一致，应明确判断是实现错误还是需求本身已经变化，而不是留下两套互相矛盾的真相。

这套流程可以在现有 Agent Harness 上逐步实现。它不要求更换模型，也不要求先部署一套复杂的需求管理平台。对已有项目来说，版本控制中的 Markdown、稳定的需求 ID、结构校验和 CI 测试，已经能构成一个有效起点。

## 什么时候值得做，什么时候不要做？

SDD 的收益与任务的复杂度、错误代价和协作跨度有关。对一个变量名修改、文案调整或有明确复现测试的局部 Bug，直接需求文本加仓库上下文就够了。此时写完整 Spec 的成本，很可能超过它能减少的返工。

当一项变更涉及多个模块、多个 Agent、跨 Session 工作、接口契约、业务规则、权限或非功能要求时，Spec 更有价值。它能让不同角色围绕同一组约定工作，也能在实现开始之前暴露一些代价高昂的误解。金融、医疗、身份权限等领域尤其值得把规则、授权和审计要求写清楚，但这并不意味着每个内部小工具都需要完整的需求工程流程。

原型探索也需要区别对待。探索阶段的目标常常是尽快了解可行性，过早固定需求可能限制方案空间。可以先保留意图和关键约束，等方向确定后，再把稳定行为转成可验收的 Spec。

SDD 本身也有成本。规格越细，生成、审查和维护它所花的时间越多；如果 Agent 根据错误假设生成了一份看似完整的 Spec，后续代码和测试可能只是把这个错误固化下来。规格还可能过度约束实现，让技术设计在信息不足时过早定型。更常见的失败是代码改变了，Spec 没有同步更新，最终变成另一份过期文档。

因此，不应以 Spec 文件数量或字段完整率衡量成熟度。真正有意义的是它是否帮助团队更早发现问题，并且是否被后续代码、测试和审查流程持续引用。

## 怎样验证它是否真的提高了生产率？

团队最容易犯的错误，是只比较编码阶段的耗时。SDD 增加了需求整理和审查时间，却可能减少测试失败、反复澄清和 Code Review 返工。只看 Agent 从开始写代码到生成补丁的时间，会把成本从一个阶段转移到另一个阶段的情况误判为生产率提升。

更合适的口径是：从需求提交到变更被审查接受、合并或达到约定交付状态的端到端时间。可以把它拆为需求整理和确认、Agent 规划、代码生成、测试与 CI、Code Review、返工修正几个阶段，观察 Spec 是否改变了各阶段耗时和等待时间。

建议至少记录以下指标：任务成功率和验收通过率、从需求提交到合并的时间、人工介入和澄清次数、Review 往返次数、返工比例、需求覆盖率，以及上线后的缺陷、回滚和变更失败情况。最好同时观察不同复杂度的任务，不要用一个总体平均值掩盖小任务被流程拖慢、复杂任务收益明显的差别。

如果要在团队内做对照实验，可以选择一批可比任务，使用同一模型、同一 Agent 工具和相近的仓库条件，分别采用直接需求文本驱动和 Spec-driven 流程。按任务随机分配或采用交叉设计，避免把某一组恰好分到更熟悉代码库的开发者。Spec 组的需求整理、人工确认和规格维护时间必须全部计入成本。除了交付时的验收，还应观察后续维护任务是否更容易完成。

最终比较的是单位时间内交付的、经过验证并能持续维护的变更，而不是 Agent 生成了多少行代码、创建了多少个 PR，或者消耗了多少 Token。只有在总耗时下降且质量没有明显退化时，才能说这套流程提高了生产率。

## 结论：把 Spec 当作 Agent 交付链中的受控工件

Anthropic 的 AI-Native SDLC Playbook 把 SDD 推进了一步：重点不再只是“先写规格再写代码”，而是让 intent.md、spec.md、plan.md、代码与测试、PR Review 和生产反馈成为一条可追踪、可验证、能持续回流的交付链。业务发起人表达意图，Agent 整理和生成规格，Product Owner 与政策负责人确认业务和治理约束，工程师审核实施计划，Agent 在持续反馈和 Eval 中实现，Hooks、权限和 CI 控制发布边界，生产问题再回到新的 Intent。

这套方法最有价值的地方，是把人类判断放在真正需要判断的关口，而不是要求人逐字撰写每份文档或检查 Agent 生成的每一行代码。它也明确了不同工件的职责：Intent 说清为什么做，Spec 说清系统要满足什么行为和约束，Plan 说清在当前仓库如何实现，测试和 Eval 提供可观察证据，Hook 和权限控制真正不可越过的边界。

但 Playbook 是实践指南，不是 SDD 生产率提升幅度的受控实验。它提出的流程指标和预期改善方向值得借鉴，却不能被引用为已经验证的平均提速百分比。现有研究支持结构化需求、上下文和验证能改善部分代码生成结果；至于端到端 ROI，仍需把 Spec 编写和审批成本、实现时间、返工、Review 等待、变更失败率和事故恢复时间放在同一条链路中测量。

对团队而言，合理的起点不是一次性引入全部十二项 Play，而是先让一个复杂功能跑通 intent → spec → plan → implementation + eval → review，保存每个阶段的版本和耗时，再逐步接入 Hooks、CI/CD 和生产反馈。简单、低风险、局部的修改仍然可以直接交给 Agent；跨系统、高风险、长周期和需要多人协作的变更，才值得投入更完整的规格和治理流程。

真正值得追求的不是更多文档，而是更少的猜测、更早的验证、更明确的责任，以及能从生产结果持续改进的 Agent 工程系统。

## 参考资料

18. Den Delimarsky, [Spec-driven development with AI: Get started with a new open source toolkit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/), GitHub Blog, 2025-09-02.
19. [GitHub Spec Kit](https://github.com/github/spec-kit), GitHub 开源项目。
20. [Kiro Specs](https://kiro.dev/docs/specs/)、[Feature Specs](https://kiro.dev/docs/specs/feature-specs/) 和 [Best Practices](https://kiro.dev/docs/specs/best-practices/)，AWS Kiro 官方文档。
21. Hojae Han et al., [ArchCode: Incorporating Software Requirements in Code Generation with Large Language Models](https://arxiv.org/abs/2408.00994), 2024.
22. Zhao Tian, [WiseSpec: Requirements-Driven Agents for Code Generation](https://doi.org/10.1145/3832783.3844573), ASE 2026.
23. Di Yang et al., [Clarity Is Not Assumed: Understanding LLM-Based Code Generation under Ambiguous Requirements](https://arxiv.org/abs/2604.21505), 2026.
24. Grant Hamblin et al., [SpecBench: Evaluating Specification-Level Reasoning for Software Engineering LLM Agents](https://arxiv.org/abs/2605.30314), 2026.
25. Elise Paradis et al., [How much does AI impact development speed? An enterprise-based randomized controlled trial](https://arxiv.org/abs/2410.12944), 2024.
26. Joel Becker, Nate Rush, Beth Barnes and David Rein, [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://arxiv.org/abs/2507.09089), METR, 2025.
27. [DORA Research: 2025](https://dora.dev/research/2025/dora-report/), State of AI-assisted Software Development, 2025.
28. Hao He et al., [AI Writes Faster Than Humans Can Review: A Longitudinal Study of an Enterprise 2x Mandate](https://arxiv.org/abs/2607.01904), 2026.

29. Louis Claxton, Anthropic, [The AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook), 2026-08-21.
30. Anthropic Academy, [The AI-native SDLC playbook](https://academy.claude.com/courses/ai-native-sdlc-playbook), 14 lessons covering six SDLC stages and twelve plays, 2026.
31. Anthropic Academy, [Requirements and design](https://academy.claude.com/courses/ai-native-sdlc-playbook/requirements-and-design).
32. Anthropic Academy, [Claude Code plan mode as the default starting point](https://academy.claude.com/courses/ai-native-sdlc-playbook/plan-mode).
33. Anthropic Academy, [Give Claude a feedback loop](https://academy.claude.com/courses/ai-native-sdlc-playbook/give-claude-a-feedback-loop).
34. Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), 2025.
35. Anthropic, [Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices), official documentation.
36. Anthropic, [How Claude Code is used in practice](https://www.anthropic.com/research/claude-code-expertise), 2026.
37. Anthropic, [How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic), 2025.
38. Anthropic Institute, [When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement), 2026.
39. Anthropic, [How Anthropic teams use Claude Code](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf), internal team practice guide.
40. OpenAI, [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/), 2026-02-11.
41. LangChain, [How to turn Claude Code into a domain specific coding agent](https://www.langchain.com/blog/how-to-turn-claude-code-into-a-domain-specific-coding-agent), 2025-09-11.
42. LangChain, [What Is Eval-Driven Development?](https://www.langchain.com/blog/what-is-eval-driven-development), 2026-11-09.
43. LangChain / Monday.com, [Building a Code-First Evaluation Strategy from Day 1](https://www.langchain.com/blog/customers-monday), 2026-02-18.
44. Renuka Kumar and Prashanth Ramagopal, [Agentic Engineering: How Swarms of AI Agents Are Redefining Software Engineering](https://www.langchain.com/blog/agentic-engineering-redefining-software-engineering), 2026-04-17 (Cisco guest case).
45. Birgitta Böckeler, [Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), 2025-10-15.
46. Wei Zhang and Jessie Jie Xia, [Structured Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/), 2026-04-28.
47. [open-spdd](https://github.com/gszhangwei/open-spdd), reusable SPDD templates and commands.
48. [token-billing](https://github.com/gszhangwei/token-billing/tree/after-enhancement), SPDD example project.
49. GitHub, [Spec Kit](https://github.com/github/spec-kit).
50. AWS Kiro, [Specs](https://kiro.dev/docs/specs/) and [Feature Specs](https://kiro.dev/docs/specs/feature-specs/).
51. Haoxiang Jia et al., [Automated Repair of Ambiguous Problem Descriptions for LLM-Based Code Generation](https://arxiv.org/abs/2505.07270), 2025.
52. S. Feng, B. Chen, B. H. Meyer and G. Mussbacher, [LLM-Assisted Repository-Level Generation with Structured Spec-Driven Engineering](https://arxiv.org/abs/2605.02455), 2026 pilot study.
53. Oscar Caddeo and Flora Lindberg, [A Performance Evaluation of Test-Driven and Spec-Driven Development using AI-Assisted Code Generation](https://kth.diva-portal.org/smash/record.jsf?pid=diva2%3A2101100), KTH degree thesis, 2026.
54. Sabry E. Farrag, [The Productivity-Reliability Paradox: Specification-Driven Governance for AI-Augmented Software Development](https://arxiv.org/abs/2605.01160), 2026 preprint and illustrative pilot.
55. [langchain-ai/claude-code-evals](https://github.com/langchain-ai/claude-code-evals), evaluation prompts and code-quality checks.
56. [anthropics/claude-quickstarts/autonomous-coding](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding), long-running coding-agent example.
