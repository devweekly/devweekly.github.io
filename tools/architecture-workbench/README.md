# Architecture Workbench

面向架构方案、ADR、跨角色评审、正式决策和后续技术债务治理的 Human-first 网站原型。

本项目放在 devweekly 的 tools 目录中独立运行，不依赖 Astro 站点构建。它验证的是通用 Business Work Item 协作模型，不是某个架构委员会的专用审批系统。

## 当前实现

- React 19、Vite、TypeScript。
- Ant Design 6 作为通用企业 UI，Ant Design X 提供 Agent/上下文辅助区域。
- Express 5 提供 REST API。
- Node 内置 node:sqlite 作为第一阶段存储，要求 Node.js 24.0 或更高版本。
- 非结构化文件通过 ObjectStore 接口存储，默认写入本地目录；配置 S3 后使用 AWS SDK。
- 网站内置 Agent Runtime 暂不启用。Workbench Server 已通过 MCP Skills Extension（SEP-2640）发布版本化角色 Skills，默认端点为 `/mcp`；界面仍提供 Context Capsule 复制能力。Jira、Confluence、GitHub、LeanIX 只登记为外部上下文引用；Workbench 不实现这些系统的 Connector、同步或缓存。将来如启用网站内置 Agent，由 Agent Runtime 自己使用配置好的 MCP/API 工具按需读取。

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

Workbench Server 通过官方 MCP TypeScript SDK v2 的 Skills Extension 发布 `skills/` 目录。MCP Client 可在 `http://localhost:4000/mcp` 使用 `skills/list`、`skills/get` 和标准 `resources/read` 发现并读取 Skill 文件；目录中的每个 Skill 都有 `SKILL.md`，可以继续包含 references、examples 等配套文件。目录在服务启动时严格校验，内容随代码版本发布。

**外部业务系统不由 Workbench 后端集成。** Workbench 只保存 Jira Story、Confluence Page、GitHub Repository、LeanIX Application、Interface 等资源的 ID/Key、URL、类型、关联语义，以及 Confluence Template 的引用标识。不会调用外部系统 API，不同步状态，不复制外部正文，也不保存这些系统的凭据。用户可以复用当前身份可见、之前已经登记的引用；新资源由用户录入。当前没有源系统搜索选择器。

未来如果启用网站内置 AI Agent，Agent Runtime 才是 MCP/API 工具的调用方：它读取 Work Item 的引用信息，使用自身配置和授权的工具按需查询外部内容，再将分析、证据和草案提交回 Workbench。外部权限仍由各源系统及 Agent 使用的身份/授权决定。Agent 返回的信息要保留来源和获取时间；它不能据此自动创建正式 Review Outcome 或 Decision。

Skills over MCP 只负责发布可验证的角色工作方法，不负责启动或激活 Skill，也不负责选择 Agent、创建子 Agent、分配 Task 或推进 Workflow。MCP Host 必须自行完成 Skill 的发现、完整性验证、审批和加载。当前 MCP Endpoint 只发布只读 Skills 资源，不提供 Work Item/Task/Review/Decision 的 MCP Tools；业务数据仍走现有 REST API 和权限校验。

LangChain / DeepAgents 可以作为未来 Agent Runtime 的实现选择，LangSmith 用于 Agent 执行追踪；它们都不是外部系统 Connector，更不能成为业务状态的权威来源。

## 目录

    client/              React + Ant Design + Ant Design X
    server/              Express API、SQLite schema/seed、对象存储适配
    skills/              通过 MCP Skills Extension 发布的角色 Skills
    ADR/                 本工具架构决策记录
    docs/                领域模型、权限与 API 说明
    data/                 本地运行时数据（gitignore）

## 当前限制

- 演示登录通过 Header 选择身份，不可用于生产。
- 已提供只读 Skills over MCP Endpoint；暂未提供 Work Item/Task/Review/Decision MCP Tools、OIDC、OAuth Delegation Grant、网站内置 Agent Runtime、完整组织目录和策略引擎，也没有 Jira/Confluence/GitHub/LeanIX Connector。
- 演示身份通过请求 Header 提供，不能暴露到公网或用于任何真实审批。Skills Endpoint 默认只允许 localhost Host；远程部署需配置 `MCP_ALLOWED_HOSTS`。当前 Skills 内容是静态通用工作规范，不含业务数据，但 Endpoint 尚无 OAuth 身份认证，不能据此向它添加私有或用户级 Skill 内容。
- 当前 SQLite 通过启动时的增量 schema check 兼容本原型已有数据库；尚无通用迁移框架和 PostgreSQL Adapter。迁移到 PostgreSQL 时需要引入异步 Repository / Unit of Work 实现，不能只替换连接字符串。
- 当前已实现本地/S3 上传和元数据记录，尚未实现经过 Work Item 授权的下载/预签名 URL，也没有病毒扫描。
- Review Cycle 当前为轻量模型，提交 Review 时绑定 Artifact Version；正式环境还应增加完整 Submission Manifest、Reviewer Assignment、独立性规则和策略版本。
- 决策界面为原型级状态转换，正式系统应由可版本化 Decision Policy 控制法定人数、会签、职责分离、权限和有效结果。
