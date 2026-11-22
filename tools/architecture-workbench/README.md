# Architecture Workbench

面向架构方案、ADR、跨角色评审、正式决策和后续技术债务治理的 Human-first 网站原型。

本项目放在 devweekly 的 tools 目录中独立运行，不依赖 Astro 站点构建。它验证的是通用 Business Work Item 协作模型，不是某个架构委员会的专用审批系统。

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

可以切换顶部的演示身份，验证不同事项 Participation 的权限差异。除 Solution Architect 等业务参与人外，目录中还会自动创建一个 Workbench Administrator 演示身份，用于验证全局人员管理和流程维护能力。演示身份切换只是本地原型能力，不是生产认证方案；正式部署必须使用企业身份提供方和受控的 Admin Provisioning。

## 原型能力

1. 创建通用 Work Item，查看负责人、状态、参与者、上下文版本和关联对象。
2. 在事项内提交 ADR、架构说明和其他有版本的 Artifact。
3. 创建或复用 Review Cycle，并针对明确 Artifact Version 提交独立 Review。
4. 创建 Task，记录责任人和目标日期。
5. 在事项内管理 Participation，显式授予 read、contribute、comment、review、decide 和 manage；manage 不自动继承 decide 或 review。
6. 由具备 decide 权限的 Human 记录接受、附条件接受、要求更多分析或拒绝的正式 Decision。
7. Decision 要求更多分析时创建后续 Task；附条件接受时可以选择是否建立独立 Technical Debt Work Item，不需要把每个 Request 都转成 Tech Debt。
8. 技术债务保留来源事项和来源 Decision 关系，单独维护 Owner、优先级、严重程度、偿还目标、计划、状态和期限。
9. 更新 Task 状态，管理讨论与活动记录。
10. 上传普通文件和证据附件；本地默认存储，可切换到 AWS S3。
11. 为 Request 关联多条 Jira Story、Confluence Page、GitHub Repository、LeanIX Application / Interface 等外部上下文引用；同一资源可供多个 Request 复用。
12. 为 Confluence Page 记录 Template Key/Name，留给未来 Agent 通过自身 MCP/API 工具解析真实模板。
13. Dashboard 分为 Request 分析和 Tech Debt 分析，展示状态、优先级、Aging、逾期、来源关系和外部引用覆盖。
14. 将授权后的 Context Capsule 复制给用户自己的 Copilot、Claude 或其他 Agent；其中只包含外部资源引用和关系，不内嵌或缓存外部系统正文。

## 领域模型边界

Work Item 是业务事项的持久化根对象。架构评审只是一个 Work Item Type；Technical Debt 也是一个关联 Work Item Type，但仅在确实需要独立治理时创建。ADR 是 Artifact 类型，不是平台核心表。Review 指向 Review Cycle、Artifact 和被审查版本。Decision 指向明确的 Work Item 或 Artifact 对象，并记录决策人、结果、理由和条件。一个 Request 可以关联多条外部资源，同一个外部资源也可以被多个 Request 引用；关联通过独立的多对多关系表达。

Task 表示执行工作，不等于 Review 或 Decision。Request 生命周期由轻量 Workflow Engine 负责状态转换、角色校验、Review Cycle 基线建立和转换历史记录；Task 状态仍然独立维护。外部 Agent 的 Session 不作为业务状态来源。一个 Human 可以在同一 Work Item 下拥有多个 Participation，服务端合并其显式权限；manage 不会自动获得 review 或 decide。评审人不能对自己提交的 Artifact 进行独立 Review；新 Artifact Version 不会修改已创建 Review Cycle 的材料基线。

本原型用演示身份 Header 模拟当前 Human Principal，并在服务端校验 Participation permissions；上线前必须替换为企业 OIDC/OAuth 认证、Delegation Grant 和真正的资源级授权。

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

    MCP_URL=http://localhost:4000/mcp
    MCP_DEMO_USER_ID=u-agent
    AGENT_EXECUTOR_MODULE=/absolute/path/to/agent-executors.ts
    AGENT_HOST_PROFILES=business-analyst,solution-architect,data-architect,security-reviewer,decision-analyst
    AGENT_HOST_WORKERS_PER_PROFILE=1
    AGENT_HOST_POLL_INTERVAL_MS=3000
    npm run agent-host

Executor 插件必须导出 createAgentExecutors()，返回以 Agent Profile key 为索引的 AgentExecutor。接口定义位于 server/agents/host.ts。execute() 接收已验证 Skill、Context Capsule、Run 元数据、可选的 Plan 汇总上下文，以及按 Artifact ID 读取正文的方法。它需要返回 Draft Artifact，或明确请求 Human hand-off。Host 捕获执行异常并记录 Run failure。

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
- 已提供 Skills / 业务 Tools over MCP、带 DAG 依赖和汇总节点的 Agent Plan、以及 provider-neutral Agent Host。项目未内置特定模型 Executor；部署方需要实现 AgentExecutor 插件。尚未实现企业 OIDC/OAuth Delegation Grant、完整组织目录和策略引擎，也没有 Jira/Confluence/GitHub/LeanIX Connector。
- 本地 MCP 默认只允许 localhost Host，并通过 `x-demo-user-id` 模拟调用者；不能用于生产身份认证。远程 MCP 必须同时配置 `MCP_ALLOWED_HOSTS`、长度至少 32 字符的 `MCP_BEARER_TOKEN` 和非 Admin 的 `MCP_SERVICE_USER_ID`。默认 Seed 会创建 `u-agent` 服务身份；必须由 Requestor/Admin 将它作为相关人员加入具体 Work Item，并只授予必要的 `read` / `contribute` / `comment` 权限。远程模式忽略请求自带的 `x-demo-user-id`，所有调用固定映射到该服务身份。静态 Bearer Token 是原型级服务认证，不替代企业 OAuth/OIDC 与用户级 Delegation Grant。
- 当前 SQLite 通过启动时的增量 schema check 兼容本原型已有数据库；尚无通用迁移框架和 PostgreSQL Adapter。迁移到 PostgreSQL 时需要引入异步 Repository / Unit of Work 实现，不能只替换连接字符串。
- 当前已实现本地/S3 上传和元数据记录，尚未实现经过 Work Item 授权的下载/预签名 URL，也没有病毒扫描。
- Review Cycle 当前为轻量模型，提交 Review 时绑定 Artifact Version；正式环境还应增加完整 Submission Manifest、Reviewer Assignment、独立性规则和策略版本。
- 决策界面为原型级状态转换，正式系统应由可版本化 Decision Policy 控制法定人数、会签、职责分离、权限和有效结果。
