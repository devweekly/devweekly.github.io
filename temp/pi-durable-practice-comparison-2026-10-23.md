# pi-durable 与 saga Agent 项目实践对比报告

**评估日期：** 2026-10-23  
**范围：** `earendil-works/pi/packages/durable`、`saga/architecture-diagram-studio/v2`、`saga/agentic-data-architect`、`saga/common-agent-lib` 的公开 `main` 分支源码与文档。本文是架构分析，不代表已经修改代码或运行测试。

## 1. 结论摘要

**值得借鉴的是 pi-durable 的“可恢复执行模型”，而不是直接引入整个 pi-durable。** 它并非单纯把聊天记录写入数据库，而是将提交记录、任务状态、阶段检查点、任务依赖关系、输入去重和恢复调度组合起来。进程中断后，运行时从最后一次已提交的 checkpoint 继续调度；UI 也可以直接观察持久化后的真实状态。

你现有项目并非没有持久化基础：

- `architecture-diagram-studio/v2` 已将 Draw.io XML 作为图模型的持久化来源，另外保存 workspace 状态、版本记录、聊天消息和 Copilot SDK session identity；Copilot runtime 也有 session/turn 锁、超时保护、运行时重建和 SDK session resume。
- `agentic-data-architect` 已有 SQLite `conversation_turns` / `conversation_messages`、一个 Investigation 仅允许一个 running turn 的数据库约束、assistant draft 保存、启动时对遗留 running turn 的恢复处理，以及独立的 trajectory、run recording、audit、业务快照与阶段性 checkpoint。
- `common-agent-lib` 已把 `agent-contracts`、`agent-tracing`、`markdown-workflow` 与确定性 `agent-state-machine` 分开。这些边界本身是合理的：trace 不等于执行状态，workflow parser 也不应暗中成为作业调度器。

主要差距不是“有没有历史记录”，而是：**对一项长时间、多阶段的 Agent 工作，是否持久化了下一步应该做什么、上一步的结果是什么、重试会不会重复副作用，以及重启后怎样继续或安全地停止。** `agentic-data-architect` 对 interrupted turn 目前有明确的安全回收策略，但它主要将旧 turn 标为 aborted 并提示用户继续；这与自动从最近的业务阶段 checkpoint 恢复，是两种不同的语义。

建议分三步走：

1. 先在 `common-agent-lib` 沉淀一套轻量的 durable-execution 契约与设计规则，不复制 pi-durable 的整套 Harness。
2. 优先在 `architecture-diagram-studio` 为长的 Copilot 编辑流程增加持久化 Run/Phase 状态与幂等应用边界；Draw.io XML 仍是业务事实来源，不引入第二套 diagram golden source。
3. 在 `agentic-data-architect` 保留现有 SQLite、trajectory 和 artifact 设计，只为真正值得自动续跑的长流程补“执行 checkpoint”，不把每一次模型调用都改成 task，也不拿 trajectory 日志推断 live 状态。

## 2. pi-durable 的关键设计

参考：[pi-durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)、[源码目录](https://github.com/earendil-works/pi/tree/main/packages/durable/src)、[设计规格](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)。README 当前明确标注该包是 **Experimental**，API 可能在版本之间变化。

### 2.1 它持久化的不是单一的 conversation/session

pi-durable 把状态拆成几类并在同一提交模型中协调：

| 概念 | 职责 | 可借鉴点 |
|---|---|---|
| Entry / transcript | 用户输入、助手响应、工具结果等不可变记录 | 结果历史可审计，不依赖覆盖式聊天状态 |
| Typed documents | Agent 配置、provider session identity、live 状态、inbox、usage 及应用自有 JSON 状态 | 把可变当前状态与不可变历史分开，明确版本和作用域 |
| Durable task | 任务输入、owner、状态、phase/checkpoint、重试与最终 outcome | 持久化“流程控制状态”，而不只是运行日志 |
| Submission | 接收用户输入、排队、去重、等待结果与结算状态 | 同一请求重试时不会重复提交同一份用户输入 |
| Transaction / commit | 可把 entry、document 改动、task 状态及其依赖关系放在一个原子提交内 | 防止“输出已经显示，但状态还没写入”或任务指针与结果脱节 |
| Task graph / watch | 从已提交状态提供任务图和可观察快照 | UI 的状态源应是已提交的当前状态，而不是从旧事件文本猜测 |

这里最重要的区别是 **provider session identity 与 durable task state 是两回事**。持久化 SDK session ID 可以恢复模型会话；它不能单独证明应用工作流应该从哪个阶段继续，也不能保证外部工具副作用没有重复。

### 2.2 阶段级 checkpoint，而不是整段函数一次跑到底

pi-durable 的 task definition 显式定义 phase。phase 的运行结果将下一状态与 checkpoint 一起提交。若进程在运行中被切断，该 phase 可以从头重跑，因此 phase 必须把需要保留的结果写进 checkpoint，并对副作用进行安全重放设计；等待、延时和对子任务的等待是明确的持久化状态，而不是占着一个 Promise 等待。

它还提供以下恢复保护：

- 任务定义有版本与迁移机制；找不到定义、版本太旧或迁移失败时，任务会显示为 blocked，而非悄悄执行不兼容代码。
- 持续崩溃达到 restart limit 的任务会 parked，需要显式排查和重试，避免故障任务无休止重启。
- 任务可拥有子任务并等待它们完成；取消会按 ownership 传播，background task 则有明确的生命周期边界。
- 每个 phase 和 task 具有可见的状态、attempt 和 outcome；UI 可用 task graph 观察依赖关系。
- 相同 `requestId` 的重复提交返回原提交记录，降低 HTTP 重试或页面重复提交导致重复执行的概率。

注意这不是“任意副作用 exactly-once”。任务恢复时可能需要重新执行一个 phase；外部写操作仍须幂等，或在重试前确认其结果。`replay: safe` 等语义的价值，就是让重试边界显式化，而不是假设工具调用天然安全。

### 2.3 可观察状态与 trace 的分工

pi-durable 的任务状态/文档是运行状态的来源，telemetry 用于跨 phase 诊断和统计。它还控制 partial answer/tool output 的提交频率，允许客户端重新连接后获取当前快照。

这条分工适合你现有的架构：

- 当前状态、checkpoint 与结果引用决定“还在不在运行、在哪一步、能否续跑”。
- Agent trace / trajectory 解释“刚才发生过什么、哪个模型或工具调用失败”。
- 业务 audit 记录“谁授权了什么、业务结果是否被正式接受”。

三者关联，但不要互相替代。

## 3. 与现有项目的对比

### 3.1 `architecture-diagram-studio/v2`

参考文件：[Copilot runtime](https://github.com/saga/architecture-diagram-studio/blob/main/v2/server/copilot/runtime.ts)、[server state / persistence](https://github.com/saga/architecture-diagram-studio/blob/main/v2/server/copilot-server.ts)、[intent route](https://github.com/saga/architecture-diagram-studio/blob/main/v2/server/copilot/intent-route.ts)。

**已经具备的能力：**

- Draw.io XML 是图内容的持久化来源；workspace 状态和 diagram versions 分别保存，旧的 projection 字段被清理，不把两种 diagram model 作为并列 golden source。
- Copilot runtime 按 conversation、model 和 config revision 复用 SDK session；内存 session cache 之外，SDK session identity 可以在 server 重启后尝试 resume。
- 对一个 conversation 有 session/turn 锁，防止多个浏览器请求交错写入同一 SDK session。
- 有 recoverable runtime 故障的单次重建/重试、turn watchdog、abort 等待超时与日志记录；不会在任意 resume 错误时默默创建空 session。

**相对 pi-durable 的差距：**

Copilot runtime 的 `sessions`、`sessionLocks` 和 `turnLocks` 是进程内 Map；它们管理 SDK 对话会话并发，不是可持久化的应用级 job scheduler。已有的 workspace/chat/session 数据也不等于已记录一个长任务执行到哪一阶段。假如一次请求由 intent analysis、规划、生成 XML、校验、应用、保存版本等多个步骤组成，只恢复 Copilot session 并不能自然还原应用控制流、阶段结果和副作用状态。

workspace 状态与版本列表也使用不同的持久化文件，因此不应默认它们具备跨文件的数据库事务语义。要保证“XML 已应用”和“版本/执行记录已提交”一致，需要明确写入顺序、幂等键及启动恢复规则。

**建议：** 把 durable execution 先用于 Copilot 驱动的复杂图编辑流程，而不是普通闲聊。一个最小的应用级 Run 应至少有 `runId`、`requestId`、`workspaceId`、`diagramPath`、`baseXmlHash`/`baseVersionId`、当前 phase、状态、尝试次数、最后 checkpoint、结果版本引用和错误分类。

推荐阶段示例：

`accepted → planning → candidate_ready → validating → applying → completed`

其中 `candidate_ready` 的内容必须是候选 XML/patch 的引用，而不是已经覆盖正式 XML；`validating` 应执行服务端 schema 与 Draw.io XML 校验；`applying` 应再次检查 `baseXmlHash`，避免用户在模型处理期间已经修改图，导致旧候选覆盖新内容。实际应用和版本记录应被设计成可恢复、可去重的提交边界。保留现有 XML golden source，不在 common library 中定义 Draw.io 业务对象。

### 3.2 `agentic-data-architect`

参考文件：[conversation.ts](https://github.com/saga/agentic-data-architect/blob/main/src/investigation/conversation.ts)、[trajectory.ts](https://github.com/saga/agentic-data-architect/blob/main/src/investigation/trajectory.ts)、[run-recorder.ts](https://github.com/saga/agentic-data-architect/blob/main/src/investigation/run-recorder.ts)、[store.ts](https://github.com/saga/agentic-data-architect/blob/main/src/investigation/store.ts)、[workflow/ask.ts](https://github.com/saga/agentic-data-architect/blob/main/src/workflow/ask.ts)。

**已经做得比较好的部分：**

- SQLite 保存 conversation turn 与 messages；`conversation_turns` 有状态约束，并通过 partial unique index 保证一个 Investigation 最多一个 running turn。这比仅靠进程内 Map 判断是否重复运行可靠。
- assistant draft 会持续保存；启动恢复遇到遗留的 running turn 时，会生成用户可见的中断提示、清理 draft 并把旧 turn 标记为 aborted。
- live execution truth 与历史 trajectory 分离。源码明确指出 trajectory 是历史，不应作为当前进程仍在工作的判断依据；没有 live owner 的持久化 running turn 应被回收，避免 UI 永久显示在运行。
- trajectory JSONL、run recording、audit、Investigation context、Discovery snapshots 和阶段性 `AgentCheckpoint` 各有用途；trajectory 写入也有串行化与 schema 校验。

**与 pi-durable 的主要区别：**

当前恢复策略倾向于安全终止 interrupted turn，并保留已向用户展示的文字；它没有因此自动获得“从上一个业务 phase 恢复执行”的语义。`AgentCheckpoint` 在 common contracts 中被定义为紧凑的中间工作产物，不负责 orchestration、持久化和最终报告语义。trajectory 里出现了 checkpoint 事件，也不必然意味着该 checkpoint 足以恢复所有后续控制流。

**建议：** 不替换现有的 conversation store 或 trajectory。挑选成本高、运行时间长、可从中间结果继续的流程（例如 report generation、modernization、较长的 assessment / journey workflow），为它们加显式执行 checkpoint：

- checkpoint 记录已完成的业务 phase、版本化输出引用、输入或上下文 hash、运行配置摘要和下一个可执行 phase。
- 在 phase 开始前记录运行意图；完成时先持久化 phase 输出/业务 artifact，再以幂等方式提交 phase 完成状态。需要强一致性的部分应放在同一 SQLite transaction；跨文件写入则必须定义可恢复的先后顺序。
- 只有已验证为纯计算、或已使用幂等键的 phase 才自动重试。对于模型调用可从保存的输入和 context snapshot 重新执行；对于写文件、改 artifact 或触发外部服务的步骤，必须检查结果是否已提交。
- 启动后区分 `interrupted`、`retryable`、`blocked` 与 `aborted`，不要把它们都折叠成“正在运行”或笼统失败。用户发起新的“继续”也应与后台透明自动恢复区分。

### 3.3 `common-agent-lib`

参考文件：[agent-contracts](https://github.com/saga/common-agent-lib/tree/main/packages/agent-contracts)、[agent-tracing](https://github.com/saga/common-agent-lib/tree/main/packages/agent-tracing)、[markdown-workflow](https://github.com/saga/common-agent-lib/tree/main/packages/markdown-workflow)、[agent-state-machine](https://github.com/saga/common-agent-lib/tree/main/packages/agent-state-machine)。

**当前抽象边界是合理的：**

- `agent-contracts` 是跨 Runtime 的 Zod 契约；它明确不提供执行 Runtime、policy、approval、persistence 或业务 audit。
- `agent-tracing` 提供 provider-neutral event schema、SQLite 事件存储、查询、usage 汇总、敏感字段脱敏和 payload 限制；它是观测记录器，不是 workflow database 或 authorization system。
- `markdown-workflow` 负责 Markdown 工作流的解析、结构验证、状态投影与声明路由；宿主应用负责 persistence、工具调用、副作用和审批。
- `agent-state-machine` 是无持久化副作用的确定性状态转换原语，只处理合法状态转移。

因此，**不要把 pi-durable 的 scheduler 塞进 `agent-state-machine`，也不要让 `agent-tracing` 变成事实上的执行状态存储。** 这会混淆现有包的职责并增加隐式依赖。

**可沉淀的最小公共层：** 新增一组可选的 durable-execution contracts，或者先在设计文档和示例中验证这些契约，再决定是否发布新 package。公共契约应表达“执行状态与 checkpoint 怎样跨 Runtime/宿主持久化”，不绑定 SQLite、Copilot SDK、CodeBuddy、Draw.io 或 Investigation 业务逻辑。

避免复用现有 `AgentCheckpoint` 名称承载执行控制语义：它目前表示中间工作产物。新的执行控制类型应清楚地区分，例如 `AgentExecutionCheckpoint` / `ExecutionStepRecord`，其字段只保留跨项目稳定需要的最小集合：

- `runId`、`stepId`、`stepVersion`、`status`、`attempt`、`updatedAt`；
- checkpoint 数据或 artifact 的版本化引用；
- `idempotencyKey` 与输入/上下文 fingerprint；
- 可分类的 failure/outcome，而不是只保存自由文本错误；
- `providerSessionRef` 可选，但绝不能作为业务 checkpoint 的替代品。

`ExecutionStore` 可以定义通用读写和原子提交的语义，而实际存储适配器、锁、保留策略、授权、业务审计和外部副作用仍由宿主应用决定。等两个以上项目使用同一契约后，再考虑提供可复用的 SQLite 实现。

## 4. 功能对照矩阵

| 能力 | pi-durable | architecture-diagram-studio | agentic-data-architect | common-agent-lib | 评估 / 建议 |
|---|---|---|---|---|---|
| 持久化对话/session identity | 内建，且与 task 状态分离 | 已有 SDK session resume 与 chat/workspace persistence | 已有 conversation SQLite 与 provider session 实践 | 有 runtime contracts，但不拥有应用持久化 | 已有，不需要重复建设 |
| 持久化 execution phase/checkpoint | 核心能力 | 应用级长流程仍主要由一次运行控制流驱动 | 有阶段产物/checkpoint，但不是所有流程都能从中间步骤续跑 | 缺通用 durable execution runtime | **最高优先级借鉴** |
| 原子提交业务状态与任务状态 | Entry/doc/task 可在单次 commit 内协调 | 多个 JSON 文件不等于跨文件原子事务 | SQLite turn 状态与 JSONL/文件 artifact 分开 | 未定义通用 transaction/store | 只在需要强一致性处落地，不重构全部存储 |
| 请求幂等与重复提交保护 | submission `requestId` | 需为应用级编辑请求/应用结果定义明确幂等语义 | turn ID 与唯一 running 约束已有基础 | 目前是契约层可扩展项 | 给 HTTP 重试、浏览器重连与工具副作用一个共同语义 |
| 重启恢复 | scheduler 从 committed checkpoint 继续 | 可恢复 SDK session，不等于恢复多阶段业务运行 | interrupted turn 安全回收；自动从 phase 续跑能力有限 | 无 scheduler | 分项目渐进增加 |
| Retry / crash-loop 防护 | attempt、restart limit、parked task | 有一次 runtime recovery、watchdog；没有通用应用任务的 restart budget | 有 stale-turn 回收与 provider fallback 规则 | 有 provider/runtime 契约和 tracing，未定义任务重试模型 | 抽取策略，不复制整个 scheduler |
| 子任务与取消传播 | ownership、waiting、fail-fast、abort cascade | 适合后续多阶段编辑；当前先不引入通用 DAG | 可用于并行 review / report 子流程 | 不属于现有基础包职责 | 作为第二阶段能力，避免提前泛化 |
| 状态 UI 与历史 trace 分离 | committed task/doc state + telemetry | 有 SDK/session logs；可加 durable run snapshot | 已明确 live state 和 trajectory 分离 | tracing 查询能力较成熟 | 保持分工，Run 状态读执行表，细节读 trace |
| Schema/任务版本演进 | task version + migration / blocked reason | workspace/config 有 schema/revision 管理 | Zod schema 与业务 artifact 版本化已有基础 | Zod contracts 已有 | 给可恢复任务定义增加 version 规则 |

## 5. 推荐的实施顺序

### P0：写清恢复与重试语义

先定义本项目所说的“恢复”到底意味着什么：恢复 transcript、恢复 provider session、恢复当前状态展示，还是自动继续未完成的业务任务。不同对象需有不同状态和保证。明确每个步骤是 `safe-to-replay`、`idempotent`，还是 `must-reconcile-before-retry`。这一步可以先是 `common-agent-lib` 的设计文档与契约，不需要马上做通用 scheduler。

### P1：先在 architecture-diagram-studio 验证最小 durable run

选择一条有明确结束点和业务副作用的路径，例如由自然语言请求生成并应用 Draw.io XML。做到：持久化 run/phase；页面刷新和 server 重启后能准确显示真实状态；候选 XML 可单独检查；应用前校验 XML 与 base hash；成功后能关联到一个明确的 diagram version；相同 request ID 不会重复产生相同编辑。保留现有 Copilot session/runtime 作为模型执行层。

### P1：在 agentic-data-architect 只为合适的长任务增加阶段恢复

优先挑选每阶段都产生可持久化结果、且重新执行代价较高的流程。将业务 artifact、execution checkpoint 和 trajectory event 的角色分清。继续保留 interrupted turn 的安全回收逻辑；只有定义过恢复策略的任务类型才自动 resume，其余任务仍提示用户继续。

### P2：把稳定部分提炼回 common-agent-lib

跨两个宿主验证后，再固定通用字段、store 约定、状态迁移与 recovery 规则。推荐先做 contracts + conformance tests（重复请求、进程中断、phase 重放、输出已写入但 checkpoint 未提交、旧 schema、新旧 Runtime session 不匹配），然后按真实复用需求决定是否增加 SQLite adapter 或调度器。对一个宿主特有的 XML edit、Investigation Mission Gate、具体 prompt 或权限决策，不应抽进公共包。

## 6. 不建议直接照搬的内容

1. **不直接依赖整个 `pi-durable` 作为当前统一运行时。** 它当前标注 Experimental，并依赖 pi 自己的 `pi-ai` 和 `chord` 状态模型。你的项目使用 Copilot SDK、CodeBuddy/WorkBuddy、OpenCode 等不同运行时，需要保留 provider adapter 和应用级权限模型。
2. **不把所有 Agent 调用都包装成 durable task。** 短小、可快速重算、没有外部副作用的同步调用可以继续保持简单；只有长耗时、昂贵、跨多个阶段或有副作用的工作值得承受持久化和恢复成本。
3. **不把 trace 当 checkpoint，不把 checkpoint 当 audit。** trace 解释过程，execution checkpoint 决定下一步，business audit 记录授权与正式结果。一个事件写入成功不等于业务操作成功。
4. **不追求虚假的 exactly-once。** 发生进程中断时，无法仅靠一次数据库提交保证第三方工具或文件系统副作用只发生一次。必须使用幂等键、结果对账或明确人工恢复边界。
5. **不改变 Draw.io XML 为唯一业务事实来源的决策。** durable run 仅记录控制状态、输入/输出引用和版本关系；diagram 内容仍以 validated Draw.io XML 为准。

## 7. 最终建议

`pi-durable` 值得作为**持久化 Agent 执行语义的参考实现**，但不适合作为现有三个 repo 的直接替换方案。最有价值的借鉴有四项：阶段级 checkpoint、幂等 submission、已提交状态驱动的恢复/可观察性、显式任务重试与生命周期管理。

落点应是：**common-agent-lib 定义跨项目的最小 durable-execution 契约；architecture-diagram-studio 先验证持久化 Run/Phase 与安全应用边界；agentic-data-architect 只为选定的长流程补可恢复阶段，不推翻现有 SQLite、trajectory 和审计设计。** 在这一切之上，继续把 provider session、执行控制状态、业务数据和观测日志作为相互关联但不同的对象。
