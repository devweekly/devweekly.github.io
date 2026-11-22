# Architecture Workbench

用于管理架构方案和 ADR，组织跨角色评审、记录正式决定，并跟踪决定后需要处理的技术债务。

本项目位于 devweekly 的 tools 目录，可独立运行，不依赖 Astro 站点构建。除架构评审外，也可用于变更评估、风险评估等业务事项。

## 当前实现

- React 19、Vite、TypeScript。
- Ant Design 6 作为通用企业 UI，Ant Design X 提供 Agent/上下文辅助区域。
- Express 5 提供 REST API。
- Node 内置 node:sqlite 作为第一阶段存储，要求 Node.js 24.0 或更高版本。
- 非结构化文件通过 ObjectStore 接口存储，默认写入本地目录；配置 S3 后使用 AWS SDK。
- Workbench Server 通过 MCP 发布角色 Skills 和业务 Tools，并提供 Agent Plan / Run Coordinator、DAG 依赖及最终汇总节点。独立 Agent Host 连接 MCP，调度可执行节点，并通过部署方的 AgentExecutor 插件调用具体模型 Runtime；Workbench 不绑定 Copilot、CodeBuddy 或特定模型 SDK。Jira、Confluence、GitHub、LeanIX 只登记为外部上下文引用；Workbench 不实现这些系统的 Connector、同步或缓存。

## 启动

需要 Node.js >=24.0 和 pnpm 或 npm。

    cd tools/architecture-workbench
    cp .env.example .env
    npm install
    npm run dev

前端地址为 http://localhost:5173，API 地址为 http://localhost:4000。首次启动会自动创建 SQLite schema 和演示数据。默认数据库在 data/architecture-workbench.sqlite。Express 会通过 dotenv 读取本目录的 .env。

生产模式先执行 `npm run build`，再执行 `npm start`。

可以在页面顶部切换演示身份，查看不同人员在各事项中的权限差异。系统还会创建一个管理员演示账号，用于维护人员目录和流程。演示身份切换只用于本地测试；正式部署需要接入企业身份认证，并设置受控的管理员账号管理流程。

## 原型能力

1. 创建业务事项，查看负责人、状态、参与者和关联资源。
2. 在事项内提交 ADR、架构方案和其他需要保留版本的材料。
3. 申请人提交材料时，系统会记录本轮评审所依据的材料版本和内容摘要，并保留提交说明。Agent 可以协助准备，但必须由申请人确认并提交。
4. 讨论和评审有明确截止时间：普通评论不会改变流程；提出澄清问题时暂停评审计时；出现阻断性异议或评审到期后，进入决定会议。
5. 会议主席或管理员在决定会议后记录批准、要求修改或拒绝。要求修改时由申请人修改材料后重新提交；批准或拒绝后，还需由会议主席或管理员关闭事项。
6. 为任务分别指定负责人和执行人；Agent 任务记录实际执行者，但不会因此转移人的责任。
7. 管理事项参与者，并分别授予读取、提交材料、讨论、评审、决策和人员管理权限。人员管理权限不会自动包含评审或决策权限。
8. 技术债务关联产生它的事项和决定，并单独记录负责人、优先级、严重程度、处理目标、计划、状态和期限。
9. 更新任务状态，查看讨论和操作记录。
10. 上传文件和证据附件；默认保存在本地，也可配置为使用 AWS S3。
11. 将 Jira Story、Confluence Page、GitHub Repository、LeanIX Application / Interface 等外部资源关联到事项。同一资源可以被多个事项复用。
12. 为 Confluence 页面记录模板标识，供具备相应访问权限的 Agent 读取模板内容。
13. 全局分析分为事项分析和技术债务分析，展示状态、优先级、登记时长、逾期情况、来源事项和外部资源关联情况。
14. 将当前人员有权查看的事项资料复制给 Copilot、Claude 或其他 Agent。资料中只包含外部资源链接和关联关系，不包含外部系统正文。

## 核心对象及关系

Work Item 表示一项需要持续跟踪的业务工作，例如架构评审、变更评估或技术债务。架构评审和技术债务只是不同类型的 Work Item。ADR、架构方案等属于有版本的材料；Review 记录针对哪一轮评审、哪一份材料和哪个版本提出的意见；Decision 记录由谁作出决定、决定结果、理由和附加条件。一个事项可以关联多条外部资源，同一条外部资源也可以被多个事项引用。

Task 是具体要完成的工作，不等于评审意见或正式决定。任务负责人对结果负责，执行人负责处理任务；Agent Run 记录实际执行任务的 Agent，不替代人的责任。Request 的状态由 Node.js 状态机管理。每次提交都会固定本轮评审所依据的材料版本和内容摘要；评审过程按保存的截止时间运行，正式决定只能由有权限的会议主席或管理员记录。同一个人可以在同一事项中承担多个角色，系统会合并其明确授予的权限；人员管理权限不会自动获得评审或决策权限。评审人不能独立评审自己提交的材料；新版本也不会改变已经开始的评审所依据的材料。

本原型用演示身份 Header 模拟当前 Human Principal，并在服务端校验 Participation permissions；上线前必须替换为企业 OIDC/OAuth 认证、Delegation Grant 和真正的资源级授权。

## 事项工作区

事项详情使用一个连续的工作区，不把概览、任务、材料、评审和 Agent 执行记录拆成一排同级页面。默认视图优先展示事项阶段、负责人、下一步工作、当前任务、材料版本和讨论内容。

参与者和权限、完整评审与决定记录、材料历史版本、提交记录、外部资源、附件、Agent 计划和执行记录、事项资料导出及操作轨迹统一放在“更多信息”中。全局导航包括我的工作、全部事项、全局分析和技术债务；人员目录作为次级入口。

此设计遵循 Apple HIG 所强调的清晰层级、用户控制和渐进披露，而不是复刻某个 Apple 产品的视觉外观。业务流程、协作任务和 Agent 执行始终是三个独立层次。

## 存储设计

SQLite 仅作为本地原型存储。数据访问集中在 server/db.ts 和 Express Application Service 中，前端不直接访问数据库。后续迁移 PostgreSQL 时，保留领域 API 与业务约束，替换数据库连接和 repository 实现，并补充正式迁移脚本、并发控制和备份恢复策略。当前尚未实现 PostgreSQL 驱动。

对象存储通过 server/object-store.ts 的 ObjectStore 接口隔离。默认 LocalObjectStore 将文件放在 LOCAL_OBJECT_DIR。设置 STORAGE_DRIVER=s3、S3_BUCKET 和 AWS_REGION 后切换为 S3ObjectStore；部署环境应优先使用 IAM Role / Workload Identity，不要把长期 AWS Key 写入代码或提交到仓库。文件元数据和访问授权在业务数据库中管理；S3 URI 本身不应被视为授权。

## AI 与 Agent 接入

当前阶段不接入 LangChain、DeepAgents 或 LangSmith。这个原型的首要验证对象是业务状态、授权、评审和决策，不是 Agent 编排。Ant Design X 只提供可选的 Agent 辅助体验，页面提供 Context Capsule 导出。

Workbench Server 使用官方 MCP TypeScript SDK v2，在 `http://localhost:4000/mcp` 同时发布 Skills 和业务 Tools。Skills 通过 `skills/list`、`skills/get` 和 `resources/read` 发现与读取；业务 Tools 用于查询事项、读取 Context Capsule、管理 Task、提交 Artifact 草案和讨论记录。目录中的每个 Skill 都有 `SKILL.md`，可继续包含 references、examples 等配套文件。目录在服务启动时严格校验，内容随代码版本发布。

**外部业务系统不由 Workbench 后端集成。** Workbench 只保存 Jira Story、Confluence Page、GitHub Repository、LeanIX Application、Interface 等资源的 ID/Key、URL、类型、关联语义，以及 Confluence Template 的引用标识。不会调用外部系统 API，不同步状态，不复制外部正文，也不保存这些系统的凭据。用户可以复用当前身份可见、之前已经登记的引用；新资源由用户录入。当前没有源系统搜索选择器。

外部 Agent Host 是 MCP/API 工具的调用方：它读取 Work Item 的引用信息，使用自身配置和授权的源系统工具按需查询外部内容，再将分析、证据和草案提交回 Workbench。外部权限仍由各源系统及 Agent 使用的身份/授权决定。Agent 返回的信息要保留来源和获取时间；它不能据此自动创建正式 Review Outcome 或 Decision。

Agent Plan 是一次多角色协作请求；Plan 下的 Agent Run 是执行节点，依赖关系存储在 agent_run_dependencies。创建计划时，Workbench 自动增加最终 Decision Analyst 汇总节点，并让它依赖所有专业节点。Agent Host 通过 agent_claim_next_run 轮询时，服务端只会返回依赖已完成且当前服务身份有权限执行的节点。无依赖的节点可以并行，依赖节点在前置节点成功后才进入可领取状态。节点产出保存为 Draft Artifact，汇总节点会读取全部专业产物，生成最终决策简报草案。

Run 领取采用服务端管理的 Claim Lease。默认租约为 60 秒，Host 每三分之一租期发送一次心跳；Workbench Service 周期性扫描过期租约，并在新任务分配前再次执行回收。租约过期后，原 Claim Token 失效，Run 自动回到队列，由其他 Host 使用新 Token 重新领取。每个 Run 最多允许三次领取，连续崩溃耗尽次数后转为 failed。Artifact 创建与 Run 完成在同一 SQLite 事务提交，避免过期 Worker 留下孤立产物。



Workbench 不在服务进程内执行模型推理。独立 Host 进程通过 npm run agent-host 运行，按配置的角色并发轮询 MCP；Host 加载并验证 Skill、获取 Context Capsule，并调用部署方提供的 AgentExecutor 实现。模型 SDK、凭据、模型选择和上下文策略由该插件负责，Host 只负责协议、调度、依赖执行和结果回写。

Skills 描述工作方法，MCP Tools 提供受控操作，Coordinator 管理 Agent Run 生命周期。Host 必须自行发现、校验、审批和加载 Skill。Agent 只能创建草案、Task 和讨论记录；没有正式 Review Outcome、Decision、风险接受或关闭事项的 MCP Tool。每个 Tool 都重新读取当前 Participation 权限，不能通过 Skill 或 Agent Profile 扩大权限。

LangChain / DeepAgents 可以作为未来 Agent Runtime 的实现选择，LangSmith 用于 Agent 执行追踪；它们都不是外部系统 Connector，更不能成为业务状态的权威来源。

## Agent Host

安装项目依赖后，配置 MCP 地址、远程 Bearer Token（远程模式）、要运行的角色和 Executor 插件路径：

    # Workbench Server lease settings
    AGENT_RUN_LEASE_MS=60000
    AGENT_RUN_LEASE_SWEEP_MS=10000

    # Separate Agent Host process
    MCP_URL=http://localhost:4000/mcp
    MCP_DEMO_USER_ID=u-agent
    AGENT_EXECUTOR_MODULE=/absolute/path/to/agent-executors.ts
    AGENT_HOST_PROFILES=business-analyst,solution-architect,data-architect,security-reviewer,decision-analyst
    AGENT_HOST_WORKERS_PER_PROFILE=1
    AGENT_HOST_POLL_INTERVAL_MS=3000
    npm run agent-host

Executor 插件必须导出 createAgentExecutors()，返回以 Agent Profile key 为索引的 AgentExecutor。接口定义位于 server/agents/host.ts。它由独立的 `npm run agent-host` 进程加载和执行，**不是浏览器 UI 的 client 端代码，也不在 Workbench Server 进程中运行**。插件的 execute() 接收已验证 Skill、Context Capsule、Run 元数据、可选的 Plan 汇总上下文、Artifact 读取方法和租约失效时的 AbortSignal；它需要返回 Draft Artifact，或明确请求 Human hand-off。Host 捕获执行异常并记录 Run failure。当前仓库提供 Host 与 Executor 接口，但没有捆绑 CodeBuddy、Copilot 或其他真实模型 Provider Adapter。

Remote Host 使用 MCP_URL、MCP_BEARER_TOKEN 和服务器配置的 MCP_SERVICE_USER_ID；本地演示模式使用 MCP_DEMO_USER_ID。运行身份必须加入每个相关 Work Item 并仅授予必要权限。不要将模型 API Key 放入 Workbench Server 配置或提交到仓库。

## 目录

    client/              React + Ant Design + Ant Design X
    server/              Express API、SQLite schema/seed、对象存储适配
    server/agents/       Agent Profile、Plan Coordinator、MCP Agent Host 和 Executor contract
    server/mcp/          Skills Extension、业务 Tools 和 MCP Host smoke tests
    skills/              通过 MCP Skills Extension 发布的角色 Skills
    ADR/                 本工具架构决策记录
    docs/                领域模型、权限与 API 说明
    data/                 本地运行时数据（gitignore）

## 当前限制

- 演示登录通过 Header 选择身份，不可用于生产。
- 已提供 Skills / 业务 Tools over MCP、带 DAG 依赖和汇总节点的 Agent Plan、带服务端 Claim Lease、心跳与崩溃恢复的 Coordinator，以及 provider-neutral Agent Host。项目没有随 Host 捆绑特定模型 Provider Adapter；部署方仍需提供 AgentExecutor 插件。尚未实现企业 OIDC/OAuth Delegation Grant、完整组织目录和策略引擎，也没有 Jira/Confluence/GitHub/LeanIX Connector。
- 本地 MCP 默认只允许 localhost Host，并通过 `x-demo-user-id` 模拟调用者；不能用于生产身份认证。远程 MCP 必须同时配置 `MCP_ALLOWED_HOSTS`、长度至少 32 字符的 `MCP_BEARER_TOKEN` 和非 Admin 的 `MCP_SERVICE_USER_ID`。默认 Seed 会创建 `u-agent` 服务身份；必须由 Requestor/Admin 将它作为相关人员加入具体 Work Item，并只授予必要的 `read` / `contribute` / `comment` 权限。远程模式忽略请求自带的 `x-demo-user-id`，所有调用固定映射到该服务身份。静态 Bearer Token 是原型级服务认证，不替代企业 OAuth/OIDC 与用户级 Delegation Grant。
- 当前 SQLite 通过启动时的增量 schema check 兼容本原型已有数据库；尚无通用迁移框架和 PostgreSQL Adapter。迁移到 PostgreSQL 时需要引入异步 Repository / Unit of Work 实现，不能只替换连接字符串。
- 当前已实现本地/S3 上传和元数据记录，尚未实现经过 Work Item 授权的下载/预签名 URL，也没有病毒扫描。
- 已实现 Request Package、不可变 Submission/Review Cycle、评论/澄清/阻断性异议、决定会议与 Chairman/Admin 关闭。Reviewer Snapshot 已保存；正式环境仍需补充通知送达、独立性规则、法定人数和可版本化评审策略。
- 定时服务使用单个 Node.js `setTimeout` + SQLite 持久化任务。它面向当前单实例原型；多实例部署需进一步实现严格的任务认领、租约和恢复协调。
