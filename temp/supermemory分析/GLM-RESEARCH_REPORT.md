# Supermemory 仓库架构与知识库实现研究报告

---

## 一、仓库定位与边界

这个仓库是一个**前端与集成层 monorepo**，核心后端 API 服务不在其中。后端的痕迹只能通过以下"化石"来推断：Zod Schema 契约、SDK 客户端调用、Cloudflare Workers 配置、文档描述和工具包行为。这种"前端开源、后端闭源"的结构意味着本报告对后端的描述属于**有据推测**，而非直接观察。

---

## 二、Monorepo 的组织逻辑

仓库采用 Turbo 管理，分为三层：

**应用层**包含三个面向不同用户的产品形态：Web 控制台（Next.js，部署在 Cloudflare Workers 上）、文档站点（Mintlify）、浏览器扩展（WXT 框架，能感知 ChatGPT/Claude/Twitter 等页面并一键保存内容）。MCP Server 的代码在当前仓库中不可见，可能已移出或尚未同步。

**共享包层**是整个仓库最核心的部分，包含七个包：`validation`（Zod Schema 契约，所有前后端共享的"真相源"）、`lib`（API 客户端 + 认证 + 工具函数）、`tools`（面向 AI 框架的集成包，支持 Vercel AI SDK、OpenAI、Mastra、Claude Memory 等）、`memory-graph`（知识图谱的 Canvas 可视化组件）、`ui`（设计系统组件）、`hooks`（React Hooks）、`docs-test`（文档代码示例的集成测试）。

**技能层**位于 `skills/` 目录，为 AI 编程助手提供结构化的仓库知识，包括架构说明和 API 参考。

这种分层的核心意图是：**所有外部接口（人类用户、AI Agent、第三方 SDK）都通过同一套 Zod Schema 约束的契约通信**。`packages/validation` 是整个系统的类型中枢。

---

## 三、Knowledge Base 的核心数据模型

### 3.1 两个世界的划分：Document 与 Memory

Supermemory 最根本的设计决策是将"知识"拆成两个层次：

**Document 是原始材料的容器**。它记录用户上传了什么 — PDF、网页、推文、图片、视频、Notion 页面。Document 的关键特征是不可变性：一旦处理完成，Document 本身的内容不再改变。它是一个"发生过的事件"的记录。

**Memory 是语义理解的节点**。它不是文档的片段，而是从文档中提炼出的、与特定实体（通常是用户）相关的知识单元。一条 Memory 可能来自多个 Document，也可能完全由 LLM 推理产生。Memory 是活的 — 它可以被更新、扩展、派生、遗忘。

这种双层模型的精妙之处在于：Document 解决"RAG 场景"（查找原始内容），Memory 解决"Memory 场景"（理解用户上下文）。两套需求共用一套底层存储，但通过不同的检索路径暴露给上层。

### 3.2 Document 的状态机

Document 的生命周期是一个七状态的状态机：unknown → queued → extracting → chunking → embedding → indexing → done（或 failed）。每个状态转换都记录在 `ProcessingMetadata.steps` 数组中，包含阶段名、起止时间、状态和错误信息。

这个状态机的设计暗示了后端使用了**分步持久化的异步编排**：不是一次性处理完，而是每完成一步就写入数据库。这意味着 Worker 崩溃后可以从最近的 checkpoint 恢复，也意味着前端可以实时轮询处理进度。

### 3.3 Memory 的版本链与关系图

Memory 的版本控制通过四个字段实现：`version`（版本号）、`isLatest`（是否最新）、`parentMemoryId`（前驱记忆）、`rootMemoryId`（整条链的起点）。当一条记忆被更新时，旧版本标记 `isLatest=false`，新版本通过 `parentMemoryId` 指向前驱。这构成了一条单向链表，可以沿链回溯完整的历史。

关系系统通过 `memoryRelations` 字段实现，它是一个从目标 Memory ID 到关系类型的映射。三种关系类型有截然不同的语义：

- **Updates**：新信息替代旧信息。旧记忆标记 `isLatest=false`，检索时默认不返回，但历史版本保留。这解决了"记忆过时"的问题。
- **Extends**：新信息补充旧信息但不构成矛盾。两条记忆都保持 `isLatest=true`，检索时同时返回，提供更丰富的上下文。
- **Derives**：系统从多条记忆中发现模式，推理出新结论。推理记忆带有 `isInference=true` 标记。

### 3.4 自动遗忘机制

三个字段实现了记忆的自动过期：`isForgotten`（是否已遗忘）、`forgetAfter`（过期时间）、`forgetReason`（遗忘原因）。临时性信息（如"今天下午有个会"）在过期后自动标记遗忘，不再参与检索。遗忘不是删除 — 记忆仍然存在于数据库中，只是被检索层过滤掉。

### 3.5 静态与动态的区分

`isStatic` 字段将记忆分为两类：长期不变的事实（姓名、职业、偏好）和经常变化的上下文（当前项目、最近兴趣）。这一区分直接服务于 Profile 系统 — 静态事实适合长缓存，动态事实需要频繁刷新。在工具包代码中，静态记忆和动态记忆被分别格式化为 Markdown 的不同章节，注入到 LLM 的系统提示词中。

### 3.6 源追溯

`MemoryDocumentSource` 关联表记录了每条记忆是从哪些文档中抽取的，以及当时的置信度（`relevanceScore`，默认 100）。这让记忆变得可审计 — 可以回答"这条记忆从哪来的？"

---

## 四、处理管线的六个阶段

### 阶段一：Queued

系统检测内容类型，验证元数据，将文档放入处理队列。这一步是轻量级的，不涉及任何重量级操作。

### 阶段二：Extracting

根据文档类型选择不同的提取器。PDF 走解析、图片走 OCR、视频走语音转写、网页走 HTML 清洗。提取的结果是纯文本加结构化元数据。这是处理时间差异最大的阶段 — 文本几乎瞬时完成，100 页 PDF 需要 1-2 分钟，1 小时视频需要 5-10 分钟。

### 阶段三：Chunking

将长文本切分成语义上有意义的片段。核心设计是**内容感知分块**而非固定长度切分：代码走 AST 感知分块（使用开源的 `code-chunk` 库，函数、类、方法各自独立成块），Markdown 按标题层级切分，PDF 按段落和章节切分。每个 Chunk 记录了 `position`（在文档中的位置），用于检索时还原上下文。

### 阶段四：Embedding

每个 Chunk 被送入 embedding 模型生成高维向量。Schema 中同时存在三套 embedding 字段：`embedding`（旧模型）、`embeddingNew`（新模型）、`matryokshaEmbedding`（Matryoshka 压缩版本）。这是一个务实的工程决策 — 模型升级时不强制全量重算，而是新旧并行，逐步迁移。Matryoshka embedding 的设计意图是用更短的向量做粗排，用完整向量做精排，降低 ANN 检索的计算成本。

Document 层面也有两套 summary embedding（`summaryEmbedding` 和 `summaryEmbeddingNew`），用于文档级的相关性判断。

### 阶段五：Indexing

这一步做了三件事：将 Chunk 写入向量索引和全文索引；用 LLM 从文档中抽取 Memory；检测新 Memory 与已有 Memory 之间的关系。这是"从文档到知识"的关键转换步骤。

### 阶段六：Done

状态标记为 `done`，文档和记忆全部可检索。

---

## 五、检索系统的双范式设计

### 5.1 v3 搜索：面向文档的精确 RAG

v3 搜索（`POST /v3/search`）的设计哲学是"给开发者最大的控制权"。它支持大量参数：chunk 阈值、文档阈值、重排序、查询改写、元数据过滤、全文包含、是否只返回匹配 chunk、是否包含完整文档内容、是否包含摘要。返回结果是"文档 + 相关 chunk"的组合，每个 chunk 带有相似度分数和相关性标记。

检索流程推测为：查询改写（可选，增加约 400ms 延迟）→ 向量召回（带 chunk 阈值和文档阈值过滤）→ 按文档聚合 → cross-encoder 重排序（可选）→ 返回。如果 `onlyMatchingChunks=false`，还会在返回 chunk 时附带前后各一个上下文 chunk，让 LLM 获得更完整的理解。

### 5.2 v4 搜索：面向记忆的快速检索

v4 搜索（`POST /v4/search`）的设计哲学是"开箱即用"。参数更少，默认阈值更高（0.6 vs 0），返回的是 Memory 条目而非 Chunk。每条 Memory 结果还携带 `context` 对象，包含父记忆和子记忆的关系链，让调用方可以沿图谱遍历。

v4 还有一个独特的 `include` 参数，可以指定是否附带关联文档、摘要和相关记忆。这让一次搜索可以返回完整的上下文网络，而不只是孤立的记忆条目。

### 5.3 Profile 端点：免搜索的上下文获取

`POST /v4/profile` 是 v4 体系的另一个核心端点。它接受 containerTag 和可选的查询文本，返回一个 Profile 结构：静态记忆数组 + 动态记忆数组 + 可选的搜索结果数组。

在工具包代码中可以看到，Profile 的消费方式是：调用 `/v4/profile` → 去重（跨 static/dynamic/searchResults 去除重复内容）→ 格式化为 Markdown（静态记忆和动态记忆分章节）→ 注入到 LLM 系统提示词中。这意味着 AI 助手在对话开始前就获得了完整的用户上下文，无需每次对话都做搜索。

### 5.4 两套范式并存的原因

v3 服务于"我要查文档/知识库"的场景（法律文件检索、技术文档问答），v4 服务于"我要让 AI 助手理解用户"的场景（个性化对话、上下文感知）。两套 API 的底层是同一套数据，但检索路径和返回格式完全不同。

---

## 六、多租户隔离：Container Tag 机制

几乎所有核心实体都带有 `orgId` 和 `containerTag` 字段。Container Tag 是 Supermemory 的多租户隔离机制，它的设计非常灵活：

- 一个 Container Tag 可以是一个用户 ID、一个项目 ID、一个会话 ID，或者它们的组合
- 写入时，所有内容被标记上对应的 container tag
- 检索时，container tag 作为过滤条件，确保不同租户之间的数据完全隔离
- `Space` 实体将 container tag 抽象为"工作空间"，支持更细粒度的权限控制（owner/admin/editor/viewer 四级角色）
- 工具包中有 `getContainerTags` 辅助函数，将 projectId 映射为 `sm_project_{id}` 格式的 container tag

API 客户端中还暴露了 container tag 级别的管理操作：获取 profile、更新设置、删除（级联删除该 tag 下的所有文档和记忆）。

---

## 七、第三方连接器系统

从 Schema 和 API 定义中可以看到，Supermemory 支持三种核心连接器（Notion、Google Drive、OneDrive），以及额外的导入端点（Gmail、GitHub、Web Crawler、S3）。

连接器的生命周期是：创建连接（OAuth 授权，获取 access/refresh token）→ 定时同步（每 4 小时一次 cron）→ 增量拉取新文件 → 转为 Document 进入处理管线。同步结果记录在 `sync-runs` 端点中，包含处理数量、失败数量和错误信息。

组织级别的设置允许自定义 OAuth 密钥（Google Drive、Notion、OneDrive 各有 `customKeyEnabled` 开关和对应的 clientId/clientSecret），以及 LLM 过滤配置（`shouldLLMFilter`、`filterPrompt`、`includeItems`、`excludeItems`）。

---

## 八、对话摄入：v4/conversations 端点

工具包中的 `conversations-client.ts` 暴露了一个独立于文档摄入的对话摄入通道。`POST /v4/conversations` 接受结构化的对话消息（支持 user/assistant/system/tool 角色、多模态内容、工具调用），以及 conversationId、containerTags、metadata 和 entityContext。

这个端点的设计意图是：AI 助手在对话过程中自动将对话内容发送给 Supermemory，后端做"智能 diff 和追加检测"（代码注释原文），只抽取新增的事实作为 Memory，避免重复存储。`entityContext` 参数允许调用方提供上下文提示（如"这个用户是 John，使用个人知识管理系统"），帮助后端更精准地抽取记忆。

---

## 九、从仓库信息推测后端 API 的实现

### 9.1 可确定的技术栈

`CLAUDE.md` 和 `wrangler.jsonc` 提供了明确的后端技术选型：Cloudflare Workers 运行时、Hono Web 框架、PostgreSQL 主数据库（通过 Hyperdrive 连接池）、Drizzle ORM、Better Auth 认证、Cloudflare AI 提供 Embedding、Cloudflare Workflows 做异步编排、KV 做缓存、Sentry 做监控。

### 9.2 推测的 API 分层

从 `packages/lib/api.ts` 中定义的完整路由结构可以推测，后端 API 服务分为四层：

**路由层**将 `/v3` 和 `/v4` 两套路由分别挂载到 Hono app 实例上。`/v3` 处理文档 CRUD、搜索、连接器管理、设置、分析、项目管理、container tag 管理；`/v4` 处理 profile 获取、记忆搜索和对话摄入。`/api/auth/*` 由 Better Auth 的 handler 接管。路由层只负责参数绑定和响应格式化。

**业务逻辑层**每个路由 handler 调用对应的 service。例如文档创建的 service 负责：验证内容类型、生成 contentHash 去重、选择 container tag、写入数据库、触发处理管线。

**管线编排层**是后端最核心的部分。`IngestContentWorkflow` 是一个 Cloudflare Workflow，把六个处理阶段编排成有状态的状态机。Cloudflare Workflow 的 step 级持久化能力与 `ProcessingMetadata.steps` 数组的设计完全吻合 — 每个 step 记录了名称、起止时间、状态和错误信息。

**数据访问层**Drizzle ORM 的 schema 定义与 Zod Schema 形成镜像。PostgreSQL 中的表结构直接对应 Document、Chunk、MemoryEntry、Space 等核心实体。向量索引推测使用 Cloudflare Vectorize 或内嵌的 pgvector 扩展。

### 9.3 推测的搜索检索流程

**v3 搜索**：query rewriting（可选，用 LLM 扩展查询词）→ 向量召回（带 chunk 阈值和文档阈值过滤，同时做全文检索）→ 按文档聚合 chunk → cross-encoder 重排序（可选）→ 返回。如果 `onlyMatchingChunks=false`，为每个匹配 chunk 附加前后各一个上下文 chunk。

**v4 搜索**：向量化查询 → 在 MemoryEntry 表中做向量召回（过滤 `isForgotten=false`、`isLatest=true`）→ 按相似度排序 → 对每条结果查询其 context（沿 parentMemoryId 和 memoryRelations 获取父/子记忆）→ 可选附带关联文档 → 返回。

**v4 Profile**：三路并发查询 — 静态记忆（`isStatic=true, isForgotten=false`，限制条数）、动态记忆（`isStatic=false, isLatest=true`，按更新时间倒序）、语义搜索（可选，只在有 query 时触发）→ 合并去重 → 返回。

### 9.4 推测的 Memory 抽取与关系检测

从文档描述和 Schema 结构可以推测，Memory 抽取发生在 Indexing 阶段：

**抽取步骤**：用 LLM 分析整篇文档，识别与特定实体相关的可独立存在的事实。每条事实成为一条 MemoryEntry，同时通过 `MemoryDocumentSource` 关联到源文档。`OrganizationSettings` 中的 `filterPrompt`、`includeItems`、`excludeItems` 会被注入到 LLM 的 prompt 中，让不同组织可以定制抽取策略。`isInference=true` 标记区分了直接提取的事实和 LLM 推理的结论。

**关系检测步骤**：对每条新 Memory，在同 space 内做向量召回，获取 top-K 条候选记忆。然后用 LLM 判断新记忆与每条候选记忆的关系类型。判断结果写入 `memoryRelations` 字段。如果关系是 Updates，旧记忆的 `isLatest` 被设为 false。

### 9.5 推测的 Embedding 迁移策略

三套 embedding 字段并存暗示了以下策略：写入时新内容同时用新旧模型生成向量；读取时优先使用新模型向量，不存在则回退；Matryoshka 压缩版本用于低成本 ANN 预筛选；模型的版本信息记录在 `embeddingModel` 字段中，方便追溯。代价是存储翻倍，但好处是可以在不中断服务的情况下完成模型迁移。

### 9.6 推测的对话摄入的智能 Diff

`/v4/conversations` 端点的"智能 diff 和追加检测"推测的实现是：后端按 conversationId 维护已处理的对话历史。新请求到达时，与已处理的历史做 diff，只对新增消息做 Memory 抽取。这避免了同一轮对话被重复处理，也解释了为什么对话摄入是独立的端点而非复用文档摄入。

---

## 十、如果由我来实现

### 10.1 总体设计哲学

**核心引擎开源，商业价值在生态层。** 当前后端闭源是一种合理的商业选择，但限制了社区参与和技术信任的建立。在 memory/RAG 赛道，护城河最终不在代码本身，而在"关系图的质量"和"集成的广度"。开源核心引擎可以加速这两个维度 — 社区贡献分块策略和连接器，商业化的重心放在托管服务、企业级监控和 SLA 上。

**统一数据模型，用类型区分而非表区分。** 当前的 Document 和 Memory 是两张独立的表，中间通过 `MemoryDocumentSource` 关联。查询一条记忆的完整来源需要 join 三张表。我会把所有"知识节点"合并到一张 `Item` 表中，用 `type` 字段区分原始文档、chunk、memory 和 profile fact。`parentId` 指向直接前驱，`rootId` 指向整条链的源头。任何一条知识都可以通过单表查询回溯，不需要 join。代价是表更宽，但查询更简单。

**Pipeline 状态外置为事件流，而非 JSON blob。** 当前处理管线的状态记录在 `ProcessingMetadata.steps` 这个 JSON 数组中，无法用 SQL 查询"过去 7 天 embed 阶段的失败率"。我会将每个 stage 的执行记录写到独立的 `pipeline_events` 表中，每条记录包含 item_id、stage 名、状态、起止时间、错误和附加上下文。这样可以用 SQL 直接查询 pipeline 的健康状况，也可以接入 OpenTelemetry 做分布式追踪。

**关系由 LLM 提议 + 用户裁决。** 当前推测关系检测是纯 LLM 自动完成的，一个错误的关系分类（把"扩展"误判为"更新"）可能导致旧记忆被错误标记。我会让 LLM 只输出"提议"和置信度，在 UI 上呈现给用户确认。用户反馈可以反哺模型，持续提升关系检测的准确率。

**多租户按工作区隔离，而非 row-level 过滤。** 当前用 container tag 和 orgId 做 row-level 隔离，数据量小时是最佳实践，但一个组织有数百万条记忆时，每行查询都带过滤条件会成为瓶颈。我会用 schema-per-tenant 或 DB-per-workspace 的方式隔离，让每个工作区拥有独立的数据库，避免跨租户的数据扫描。

### 10.2 架构分层

我会把系统拆成三个独立可版本化的层：

**Core 层**包含共享数据模型、Zod 契约、Drizzle Schema。这是整个系统的"真相源"，任何上层都依赖它。Core 层独立 semver，任何破坏性变更都在 CI 中被所有下游检测到。

**Pipeline 层**包含六个独立的子包，每个负责一个处理阶段。阶段之间通过 Stage interface 解耦 — 每个 stage 只接收一个不可变的 context 对象，返回一个新的 context。这种"注册式编排"带来了几个关键能力：可以做 dry-run 预览、可以做 A/B 测试（同一个 stage 替换成两个实现，各走 50% 流量）、可以单步重放（失败时只重跑某个 stage）、可以在本地用 in-memory DB 跑全链路测试。

**应用层**包含 API 控制面、Worker 编排、Web 控制台、MCP Server。各自独立部署，通过 Core 层共享类型。

### 10.3 关键技术决策

**向量库选择**：早期用 Postgres + pgvector，规模上来后拆分为独立向量服务。起步不需要引入额外组件，扩展后按需拆分。当前推测使用 Cloudflare Vectorize，绑定到了 Cloudflare 生态，未来需要多云部署会受限。

**Embedding 管理**：当前是三套 embedding 字段并存，我倾向于用单一字段加 `embeddingModelVersion` 列。模型升级时后台异步重算旧数据，不引入多套字段的存储和同步复杂度。重算期间，查询走"有新向量用新向量，没有就回退旧向量"的逻辑，但存储层只有一套字段。

**处理编排**：当前用 Cloudflare Workflows，我倾向于用 Temporal.io 或 Inngest。它们有更成熟的调试 UI、回放能力和跨云支持，不绑定到 Cloudflare 生态。Cloudflare Workflows 的 step 级持久化能力很好，但调试体验和可观测性不如专业的工作流引擎。

**API 版本策略**：当前 v3 和 v4 并存，我倾向于单一 `/v1`，通过请求体中的 `mode` 字段区分"文档搜索"和"记忆搜索"。两个版本长期并存会增加维护成本，且新用户会困惑"我该用哪个"。统一入口后，内部路由到不同的检索路径，对外只暴露一套 API。

**内容去重**：当前只用 contentHash，我倾向于加上感知哈希（图像）和 simhash（文本）。多模态场景下，同一张照片两次上传、同一篇文档微调格式后重新上传，都需要更智能的去重。

**缓存策略**：当前推测用 KV 做通用缓存，我倾向于显式 cache 层，针对 profile 查询做专门的缓存。从工具包代码可以看出 profile 查询是调用频率最高的路径，适合 5 分钟 TTL 加 SWR（Stale-While-Revalidate）策略 — 先返回缓存结果，同时异步刷新。

### 10.4 关系检测的差异化设计

当前推测的关系检测是"向量召回 + LLM 分类"的纯 LLM 路径。我的方案是"启发式预筛 + LLM 兜底"：

第一步，向量召回 top-20 候选记忆。第二步，用三类廉价信号做启发式预筛 — 时间窗（一周内的事件更可能相关）、主题相似度（基于关键词重叠而非 embedding）、元数据键名重叠（共享同一个 tag 的记忆更可能相关）。这一步覆盖大约 60% 的显然关系，免去 LLM 负担。第三步，只对"启发式未命中但向量相似度仍高"的 10-15 条候选，调 LLM 做精确分类。第四步，每条关系带显式 confidence 落库，UI 上用不同颜色展示，让用户选择信任与否。

这种设计的好处是：省 token、可解释、可降级。LLM 挂了仍然能跑（只是少了部分关系发现），且启发式命中是可审计的。

### 10.5 可观测性的三层设计

**结构化 Events 表**：每行是一条 stage 执行记录，可以按 stage 名、状态、orgId 做聚合查询。"过去 7 天 extract 阶段的失败率""按 orgId 看慢的 stage"都可以用 SQL 直接回答。

**OpenTelemetry Traces**：每个 stage 是一个 span，LLM 调用是子 span。性能瓶颈一目了然 — "这 1.2 秒慢在哪？是 extract 还是 embed？"

**Sentry Breadcrumbs**：在关键决策点（LLM 拒绝抽取某条记忆、用户拒绝确认关系、chunk 被判定为噪声）留 breadcrumb，出问题回溯时一目了然。

### 10.6 对话摄入的改进

当前对话摄入是独立的 `/v4/conversations` 端点，与文档摄入走不同的路径。我会统一摄入入口，用 `source` 字段区分来源（document、conversation、connector），后端根据 source 选择不同的处理策略。对话来源的内容不需要 extract 和 chunk 阶段，可以直接进入 memory 抽取。这样一套管线处理所有来源，减少代码重复和维护成本。

---

## 十一、对当前架构的总体评价

**做得很好的地方**：

- Zod 契约驱动的前后端协作，在 monorepo 中是非常成熟的做法，保证了类型安全
- Document/Memory 双层模型精准捕捉了"原始材料 vs 语义理解"的本质区别
- Updates/Extends/Derives 三种关系类型用一个简洁的模型覆盖了知识演化的核心模式
- 多 embedding 版本的灰度迁移策略，工程上很务实
- 工具包（`packages/tools`）的设计很优雅 — 把 profile 格式化为 Markdown 注入系统提示词，让 AI 助手在对话前就获得完整上下文
- MemoryCache 的 turn 级缓存避免了同一轮对话中的重复 API 调用
- 图谱可视化组件（`packages/memory-graph`）用 Canvas 实现了高性能的力导向图，边样式根据关系类型区分（updates 最粗最不透明，derives 最细最透明）

**可以改进的地方**：

- 核心引擎不开源，限制了社区参与和技术信任的建立
- 两套 API 版本（v3/v4）长期并存，维护成本会持续增长，且对新用户造成认知负担
- Pipeline 的可观测性依赖 JSON blob，查询和告警能力不足
- 关系检测推测是纯 LLM 路径，缺乏用户反馈闭环，错误分类无法自动纠正
- 多 embedding 字段的存储成本随内容量增长线性放大
- 对话摄入与文档摄入是两套独立路径，增加了维护复杂度

**一句话总结**：Supermemory 的 Knowledge Base 本质上是用一套统一的数据模型同时表达 RAG 检索和 Long-term Memory 两种范式 — Document 是"真相的锚点"，Memory 是"语义的节点"，三种关系边把节点编织成一张会自我演化的知识图谱。用户不需要在"我要做 RAG"和"我要做 Memory"之间做选择，系统自己会判断。
