# Supermemory 仓库架构研究报告

> 研究对象: `/Users/saga/code-repos/supermemory`  
> 报告时间: 2026-06-03

---

## 1. 关键发现 (TL;DR)

- 这是一个 **公开可见的 Turbo monorepo**,仅包含**前端控制台、SDK、集成、文档**等"客户端"代码。
- **核心后端服务 (API server) 不在本仓库内**。所有客户端 (`apps/web`、`apps/mcp`、`packages/tools` 等) 都通过 HTTPS 调用 `https://api.supermemory.ai/v3` 和 `/v4` 端点。
- 因此,真正的 Knowledge Base 实现 (向量库、图数据库、ETL pipeline) 属于另一个私有仓库。本报告能分析的是:
  1. 数据模型 ([`packages/validation/schemas.ts`](file:///Users/saga/code-repos/supermemory/packages/validation/schemas.ts))
  2. 处理流程的对外契约
  3. 客户端如何消费 KB
  4. 文档中描述的架构

---

## 2. 仓库整体结构

```
supermemory/
├── apps/                              # 部署单元
│   ├── web/                           # Next.js 控制台 (主前端)
│   ├── mcp/                           # MCP 服务器 (Cloudflare Workers + Durable Objects)
│   ├── browser-extension/             # WXT 浏览器扩展
│   ├── raycast-extension/             # Raycast 扩展
│   ├── memory-graph-playground/       # 知识图谱调试器
│   └── docs/                          # Mintlify 文档站
├── packages/                          # 共享包
│   ├── lib/                           # 共享 API client + 类型 (供 web/console 使用)
│   ├── validation/                    # Zod schemas (Document, Memory, Space 等数据契约)
│   ├── tools/                         # 多框架中间件 (Vercel AI SDK / OpenAI / Mastra / Voltagent)
│   ├── ai-sdk/                        # Vercel AI SDK 工具
│   ├── agent-framework-python/        # Microsoft Agent Framework 集成
│   ├── openai-sdk-python/             # OpenAI Agents SDK 集成
│   ├── cartesia-sdk-python/           # Cartesia 实时语音集成
│   ├── pipecat-sdk-python/            # Pipecat 实时对话集成
│   ├── memory-graph/                  # Canvas 知识图谱可视化 (D3 force)
│   ├── ui/                            # shadcn 共享组件
│   ├── hooks/                         # 共享 React hooks
│   └── docs-test/                     # 文档示例自动验证
├── skills/supermemory/                # 给 Claude 用的"产品使用指南" skill
└── CLAUDE.md                          # 仓库级 AI 协作约定
```

**技术栈**:
- 语言: TypeScript (前端/SDK) + Python (部分 SDK)
- 包管理: Bun
- 构建: Turbo
- 前端: Next.js 15 + React 19 + TanStack Query + Radix UI
- Lint/Format: Biome
- 部署: Cloudflare Workers (通过 OpenNext) + Durable Objects
- ORM: Drizzle (后端)
- 鉴权: Better Auth
- 监控: Sentry

---

## 3. Knowledge Base 数据模型 (本仓库可观察的部分)

核心 schema 在 [`packages/validation/schemas.ts`](file:///Users/saga/code-repos/supermemory/packages/validation/schemas.ts) 中定义,这是与后端 API 的"事实契约"。

### 3.1 核心实体 (5 层)

```
┌──────────────────────────────────────────────────────────────┐
│  Organization (orgId)                                        │  ← 多租户根
│  └── User (userId)                                           │
│      └── Space (containerTag)        ← "项目/上下文空间"     │
│          ├── Document (chunkCount, summary, type, status)    │  ← 原始输入
│          │   └── Chunk (embedding, position)                 │  ← 语义片段
│          ├── MemoryEntry (memory, version, isLatest)         │  ← 抽取/推理的知识单元
│          │   └── MemoryRelations: updates | extends | derives│ ← 三种关系边
│          ├── Connection (provider, accessToken)              │  ← 外部数据源
│          └── MemoryDocumentSource (memory ↔ document)        │  ← 反向追溯
└──────────────────────────────────────────────────────────────┘
```

| 实体 | 关键字段 | 作用 |
|---|---|---|
| `Space` | `containerTag`, `contentTextIndex` (标 "KnowledgeBase") | 隔离上下文,等同于"项目"或"用户" |
| `Document` | `type`, `status`, `summary`, `summaryEmbedding`, `chunkCount` | 用户上传的原始内容 |
| `Chunk` | `content`, `embedding`, `embeddingNew`, `matryokshaEmbedding`, `position` | 文档切分后的语义块,带多模型向量 |
| `MemoryEntry` | `memory`, `version`, `isLatest`, `parentMemoryId`, `memoryRelations`, `isStatic`, `isForgotten` | 系统提取出的"事实/记忆" |
| `Connection` | `provider`, `accessToken`, `documentLimit` | 外部集成 (Notion/Google Drive/OneDrive) |

### 3.2 关键字段解读

- **`containerTag`**: KB 的隔离单元。SDK 调用时几乎必传,可理解为"用户 ID"或"项目 ID"。
- **`Space.contentTextIndex`**: 在 schema 注释中明确标记为 `KnowledgeBase type`,这是内部"全文索引"挂载点 (推测为 Postgres GIN / 倒排索引)。
- **`embedding` + `embeddingNew` + `matryokshaEmbedding`**: 同一内容存了多套向量 — 体现"模型可热切换 + 嵌入压缩"思路。
- **`MemoryEntry.version` / `parentMemoryId` / `rootMemoryId` / `isLatest`**: 实现"Updates"关系的版本链,`parentMemoryId` 指向被本条更新掉的旧版本。
- **`isStatic` / `isForgotten` / `forgetAfter` / `forgetReason`**: 区分永久事实 vs 临时上下文,并支持"自动遗忘" (时间到期或显式标记)。

### 3.3 三种记忆关系 (MemoryRelations)

```ts
MemoryRelationEnum = z.enum(["updates", "extends", "derives"])
```

| 关系 | 含义 | 例子 |
|---|---|---|
| `updates` | 新信息替代旧信息 | "用 Vue" → "改用 React" |
| `extends` | 补充信息,新旧并存 | 职位 = 工程师 + 工作内容 |
| `derives` | 推理衍生 | "创始人讨论 AI" → 推理"公司是 AI 公司" |

---

## 4. Knowledge Base 处理流程 (文档 + 后端契约)

文档中给出的 pipeline (在 [`skills/supermemory/references/architecture.md`](file:///Users/saga/code-repos/supermemory/skills/supermemory/references/architecture.md) 中):

```
queued → extracting → chunking → embedding → indexing → done
```

每个 `Document.status` 字段对应其中一个阶段 (见 `DocumentStatusEnum`):

```ts
DocumentStatusEnum = ["unknown","queued","extracting","chunking","embedding","indexing","done","failed"]
```

`ProcessingMetadata` 中还记录了 `chunkingStrategy`、`tokenCount`、每一步的 `startTime/endTime/error`,便于调试和重试。

### 4.1 内容分块策略 (Smart Chunking)

来自 [`apps/docs/concepts/super-rag.mdx`](file:///Users/saga/code-repos/supermemory/apps/docs/concepts/super-rag.mdx):

- **PDF / Word**: 按语义段落/标题切分
- **代码**: 用自研开源库 [code-chunk](https://github.com/supermemoryai/code-chunk),按 AST 边界切 (imports / 函数 / 类方法)
- **Web 页面**: 取正文后按 article 结构切
- **Markdown**: 按 heading 层级

### 4.2 检索流程 (Hybrid Memory + RAG)

- **v3 search**: 文档级 RAG,支持 `rerank`、`rewriteQuery`、`chunkThreshold`、`documentThreshold`、metadata 过滤、AND/OR 组合
- **v4 search / v4 profile**: 记忆级,返回"static profile + dynamic profile + 语义搜索结果"
- **Hybrid mode (默认)**: 同时返回文档 chunks + 用户记忆,适合"既查知识库又带个人上下文"的场景

---

## 5. 客户端如何"消费" Knowledge Base

### 5.1 共享 API Client

[`packages/lib/api.ts`](file:///Users/saga/code-repos/supermemory/packages/lib/api.ts) 暴露 `$fetch`,基于 `@better-fetch/fetch` + Zod schema 强类型:

```ts
baseURL: `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://api.supermemory.ai"}/v3`
credentials: "include"
header: "X-App-Source: nova"
```

它定义了一组强类型路由: `documents`、`documents/list`、`search`、`container-tags/:tag/profile`、`connections/:provider` 等,覆盖了控制台所有交互。

### 5.2 多框架中间件

[`packages/tools/`](file:///Users/saga/code-repos/supermemory/packages/tools) 提供统一的 `supermemoryProfileSearch()` ([`memory-client.ts`](file:///Users/saga/code-repos/supermemory/packages/tools/src/shared/memory-client.ts)):

```ts
POST {baseUrl}/v4/profile
{ q, containerTag }
```

所有框架适配器 (Vercel AI SDK / OpenAI / Anthropic / Mastra / Voltagent) 走同一份共享代码,支持三种模式:
- `profile`: 仅取 static+dynamic profile
- `query`: 仅按查询做语义检索
- `full`: 两者合并

并提供 `PromptTemplate` 钩子让用户自定义如何把记忆注入到 system prompt。

### 5.3 MCP Server

[`apps/mcp/`](file:///Users/saga/code-repos/supermemory/apps/mcp) 在 Cloudflare Workers + Durable Objects 上把 KB 暴露为 MCP 工具:

- 工具: `memory` (save/forget)、`recall`、`listProjects`
- 资源: `supermemory://profile`、`supermemory://projects`
- 5 分钟 TTL 缓存 container tags
- 适用于 Claude Desktop / Cursor / VSCode / Windsurf 等所有 MCP 客户端

### 5.4 Memory Graph 可视化

[`packages/memory-graph/`](file:///Users/saga/code-repos/supermemory/packages/memory-graph) 是一个独立的 React 组件包,在 Canvas 上用 D3 force-directed 模拟画知识图谱:

- 节点: Document / Memory
- 边: updates / extends / derives (用不同样式区分)
- 提供 `ForceSimulation`、`ViewportState`、`SpatialIndex`、`VersionChainIndex` 四个 engine 类
- 在 web 端被 [`components/memory-graph/`](file:///Users/saga/code-repos/supermemory/apps/web/components/memory-graph) 包装成产品 UI

### 5.5 控制台功能映射

`apps/web/` 内的 UI 组件直接对应 KB 概念:
- [`add-document/`](file:///Users/saga/code-repos/supermemory/apps/web/components/add-document) → 添加 Document (file/link/note/connection)
- [`document-modal/`](file:///Users/saga/code-repos/supermemory/apps/web/components/document-modal) → 展示 Document + 关联的 Memory
- [`memories-grid.tsx`](file:///Users/saga/code-repos/supermemory/apps/web/components/memories-grid.tsx) → 列出 MemoryEntry
- [`timeline-view.tsx`](file:///Users/saga/code-repos/supermemory/apps/web/components/timeline-view.tsx) → 按时间线展示
- [`graph-layout-view.tsx`](file:///Users/saga/code-repos/supermemory/apps/web/components/graph-layout-view.tsx) → 知识图谱视图
- [`hooks/use-document-mutations.ts`](file:///Users/saga/code-repos/supermemory/apps/web/hooks/use-document-mutations.ts) → TanStack Query 包装的 CRUD

---

## 6. 集成 / 连接器

`Connection` 实体支持三类 provider (schema 中) 以及实际部署的更广集合:
- `notion` / `google-drive` / `onedrive` (OAuth, schema 枚举)
- 还支持 `gmail` / `github` / `web-crawler` / `s3` (通过文档可见)
- 流程: 创建 connection → 后端保存 access_token → 周期性 (cron 4h) + 实时 webhook 同步 → 产出 Document 走同一条 pipeline
- CLAUDE.md 提到 `wrangler.jsonc` 配 Hyperdrive + Cloudflare AI + KV + Workflows,推测 ingest pipeline 跑在 Cloudflare Workflows 上

---

## 7. 安全 / 多租户

- 所有 API 路径都基于 `orgId` + `userId` 隔离 (由 Better Auth 颁发)
- Document/Chunk/Memory 都有 `orgId` 字段
- 外部集成支持"bring your own key" (BYOK),存在 `OrganizationSettings` 中的 `googleDriveClientId` 等字段
- 内容用 `contentHash` 去重 (Document schema 中的字段)
- `IngestContentWorkflow` 完整流程中包含 LLM 过滤 (`shouldLLMFilter` / `filterPrompt` / `includeItems` / `excludeItems`)

---

## 8. 架构图 (基于可观察信息重建)

```
                         ┌────────────────────────────────────┐
                         │   私有仓库: supermemory-api         │
                         │   (Cloudflare Workers)             │
                         │                                    │
   ingest                │  ┌────────────┐   ┌────────────┐  │
 ┌────────────────┐      │  │   Queue    │──▶│  Extract   │  │
 │  Users upload  │─────▶│  │            │   │ (PDF/OCR)  │  │
 │  Doc/URL/Note  │      │  └────────────┘   └─────┬──────┘  │
 └────────────────┘      │                         ▼         │
                         │                  ┌────────────┐  │
   connectors            │  ┌────────────┐   │  Chunking  │  │
 ┌────────────────┐      │  │ Webhooks / │──▶│ (AST-aware)│  │
 │ Google Drive   │─────▶│  │  Cron 4h   │   └─────┬──────┘  │
 │ Notion / etc.  │      │  └────────────┘         ▼         │
 └────────────────┘      │                  ┌────────────┐  │
                         │                  │ Embeddings │  │
   search                │                  │ (CF AI +   │  │
 ┌────────────────┐      │                  │ OpenAI/etc)│  │
 │ SDK / Web /    │◀─────│                  └─────┬──────┘  │
 │ MCP / Browser  │ HTTPS│                         ▼         │
 └────────────────┘      │                  ┌────────────┐  │
                         │                  │  Indexing  │  │
                         │                  │ + Memory   │  │
                         │                  │  Relation  │  │
                         │                  │  Detection │  │
                         │                  └─────┬──────┘  │
                         │                         ▼         │
                         │   PG (Hyperdrive) + Vector Index  │
                         │   + KV + Sentry                   │
                         └────────────┬─────────────────────┘
                                      │
                                      ▼
              ┌─────────────────────────────────────────────┐
              │   本仓库 (公开): 客户端 + SDK + 控制台        │
              │   apps/web  apps/mcp  apps/browser-extension │
              │   apps/raycast-extension  apps/docs          │
              │   packages/tools  packages/ai-sdk            │
              │   packages/memory-graph (canvas 可视化)     │
              │   packages/validation (Zod 契约)            │
              │   packages/lib (控制台 $fetch)              │
              └─────────────────────────────────────────────┘
```

---

## 9. 总结与可改进方向

**架构优势**
1. **契约优先**: 公共 `packages/validation` 用 Zod 定义整套数据模型,前后端共享类型,降低对接成本。
2. **统一的"记忆"模型**: 不区分 memory / RAG / profile,统一抽象为带版本、关系、嵌入的 `MemoryEntry`,表达力强。
3. **多 embedding 策略**: 同时存 `embedding` / `embeddingNew` / `matryokshaEmbedding`,便于模型升级和成本优化。
4. **跨平台一致**: 共享 `supermemoryProfileSearch` 让所有 LLM 框架 (Vercel/OpenAI/Mastra/Voltagent/Pipecat/Cartesia) 行为一致。
5. **图谱可视化自研**: Canvas + D3 force,性能可控,被多端复用。

**可观察到的设计选择**
- 用 `containerTag` 作为天然的多租户 / 多项目隔离键,避免复杂 ACL。
- 用关系枚举 (`updates/extends/derives`) 而非自由文本边,降低推理复杂度。
- Document / Memory 分两层: Document 是"来源真值",Memory 是"抽取后的语义",保留双向追溯 (`MemoryDocumentSource`)。

**未在本仓库内的部分 (需访问私有仓库才能进一步分析)**
1. 真正的后端服务代码 (Hono handlers、`/v3/*` 实现)
2. 向量索引细节 (推测使用 Cloudflare Vectorize 或自建)
3. ETL pipeline (Cloudflare Workflows 内部步骤)
4. 关系检测算法 (LLM 调用 + 分类)
5. 嵌入/重排序模型选型与部署 (CLAUDE.md 提到 Cloudflare AI,实际可能混合 OpenAI/Cohere)
6. 多租户 PostgreSQL schema (虽然有 Drizzle 引用,但定义在私有 repo)
7. 同步 connector 的具体 OAuth 流程与速率限制策略

如果想深入 KB 实现,建议联系仓库维护者获取私有后端仓库的访问权限,或在 `https://api.supermemory.ai/v3` 上做黑盒行为分析。

---

## 10. 推测的后端 API 实现 (基于仓库可观察信息)

> 本节严格区分"可由仓库证据直接确定的事实"和"由 schema 字段、文档、客户端行为倒推出的推测"。所有论断都不引用伪代码,而是描述设计思路。

### 10.1 几乎可以确定的部分

来自 [`CLAUDE.md`](file:///Users/saga/code-repos/supermemory/CLAUDE.md) 和 `apps/web/wrangler.jsonc` 的明确陈述,可直接落地为后端技术栈:

- 运行时为 Cloudflare Workers(`wrangler.jsonc` 的 `compatibility_flags: ["nodejs_compat"]` 已经把 Node API 打开了)
- Web 框架是 Hono(CLAUDE.md 明确列出)
- 主存储是 PostgreSQL,通过 Cloudflare Hyperdrive 连接(CLAUDE.md 明确)
- ORM 使用 Drizzle(从共享 `packages/validation` 派生的 Zod 类型与 Drizzle schema 形态高度一致可佐证)
- 鉴权用 Better Auth,同时出现在 `CLAUDE.md` 和前端的 `auth-context.tsx`
- Embedding 主要由 Cloudflare AI 提供,文档原文有 "Vector embedding generation using Cloudflare AI"
- 异步编排使用 Cloudflare Workflows,长任务由它持久化 step state,这一点与"4 小时一次 cron"协同
- 监控用 Sentry,前后端都有初始化
- KV 缓存来自 Cloudflare KV,常用于速率限制、会话与短期缓存

### 10.2 强烈推测的部分

#### (a) 项目结构 (Hono 风格)

后端仓库的组织应与前端 monorepo 形成镜像:入口是一个 Hono app,把 `/v3` 与 `/v4` 两套路由分开挂载;`/v3` 服务于文档 RAG 类操作,`/v4` 服务于"profile + 记忆"语义类操作。业务 handler 与底层能力解耦:有专门的 workflows 目录承载 6 阶段内容处理;有 lib 子目录分别封装数据库、向量索引、分块、LLM 调用和关系检测;中间件层做鉴权、限流和可观测性注入。

这样的分层让"接入新类型内容"或"接入新数据源"只需新增一个 chunker 或一个 connector 子模块,而不必修改核心路由。

#### (b) 处理 pipeline 的设计哲学

`IngestContentWorkflow` 应当是把"6 阶段流水线"实现成一个**有状态、step 级持久化**的工作流。每个阶段写入时,只接受"接收上下文、返回新上下文"的纯函数式接口,所有副作用(数据库写入、外部 API 调用)由 stage 自身完成,Cloudflare Workflow 负责在每一步之后把状态持久化,以便 worker 崩溃后能从最近的 checkpoint 恢复。

阶段之间的边界设计是关键:

- extract 阶段根据 `document.type` 选择不同提取器(PDF/OCR/网页/语音转写),提取结果是纯文本 + 元数据
- chunk 阶段根据内容类型选择不同分块策略(代码用 AST、Markdown 按标题、PDF 按段落),产出多个语义块
- embed 阶段对每个块调用 embedding 模型,可能并行调用多个模型,产出多套向量
- extract-memory 阶段用 LLM 从整篇内容中识别"用户/实体相关的事实",产出 MemoryEntry 列表
- detect-relations 阶段对每条新 memory,在同 space 内做向量召回,用 LLM 判断 updates/extends/derives 关系
- index 阶段把结果写入向量索引和 Postgres 全文索引,变更 `Document.status` 为 `done`

为什么这么推测:文档中 `ProcessingMetadata.steps` 数组里每一步都有 `startTime/endTime/error`,这种结构只可能来自 step 级持久化的工作流;多 embedding 字段、`isInference` 标志也都一一对应"批 embedding、LLM 抽取"这两个独立阶段的输出。

#### (c) 关系检测的设计思路

关系检测是 KB 最具差异化的能力,推测流程是"召回 + 分类 + 维护版本链"三步:

1. **召回**:对每条新 memory,在同 space 内用其 embedding 做向量检索,召回 top-K(约 20 条)历史记忆
2. **分类**:把新 memory + 候选集一次性发给 LLM,要求 LLM 输出 updates/extends/derives 三种关系。批量请求 + 严格 JSON 输出,降低 token 成本
3. **维护版本链**:对每条 `updates` 关系,旧 memory 标记 `isLatest=false` 并指向新版本;新 memory 设置 `parentMemoryId` 指向被更新的旧版本,`version` 自增。对 `extends` 关系,把新 memory 关联到老 memory 的子节点集,不改变老 memory 的 `isLatest` 状态。对 `derives` 关系,把派生结论作为新 memory 写入,关系边挂在原 memory 上

这种设计的关键是**让 LLM 只做"分类"而不做"理解"** — 候选召回已经由向量检索完成,LLM 只是低成本地给出离散标签。

#### (d) 搜索实现的设计思路

v3 文档搜索与 v4 profile/记忆搜索的差异反映了**两套不同的检索语义**:

- **v3 文档搜索**走"向量召回 + 文档聚合 + 可选重排"的传统 RAG 路径。召回阶段输出 top-K 个 chunk,按所属 document 聚合,再去重。query rewriting 在向量检索前发生,生成多个变体查询并合并结果。rerank 是 cross-encoder 二次精排,牺牲 100ms 换精度
- **v4 profile** 走"静态事实 + 动态事实 + 语义召回"的三路并发路径。静态事实来自 `isStatic=true` 的长期偏好,数量稳定,适合缓存;动态事实来自 `isStatic=false, isLatest=true` 的近期上下文,按时间倒序;语义召回是可选的,只在带 query 时触发

两套并存的根本原因是它们的**用户场景不同**:v3 服务于"我要查文档/知识库"这种 RAG 范式,v4 服务于"我要让 AI 助手理解用户"这种 memory 范式。

#### (e) 多租户隔离的设计思路

隔离的关键不是"每行查询都带 orgId 过滤"(虽然这肯定存在),而是建立"自顶向下的上下文"和"自底向上的索引"双向机制:

- **自顶向下**:请求进入时,从 JWT 解析出 `orgId` + `userId`,封装到 context 透传到所有数据访问层;container tag 还要过一个"该 org 是否有权访问"的解析器,作为最后一道关卡
- **自底向上**:向量索引把 `spaceId` 作为 metadata,在 ANN 检索时强制传入 filter,确保跨 space 数据不混淆;Postgres 表上都带 `(orgId, spaceId)` 复合索引,所有查询模板强制带这两个谓词

这种"双层防御"避免任何一层失效就导致数据泄露。

### 10.3 公开行为佐证

下列"客户端可观察到的现象"与"内部实现推测"的对应关系,可以作为推测的合理性背书:

| 公开行为 | 推测的内部实现 |
|---|---|
| `npm i supermemory` 依赖 `^3.0.0-alpha.26` | 后端 `/v3` API 仍标 alpha,实际是 GA |
| `/v3` 和 `/v4` 并存 | `/v4` 是新 memory-centric 协议,与 `/v3` RAG 并行 |
| 同一 chunk 同时存 `embedding` / `embeddingNew` / `matryokshaEmbedding` | 旧向量用于兼容性,`embeddingNew` 走新模型,`matryokshaEmbedding` 是 Matryoshka 压缩版本,用于低成本 ANN |
| 文档处理时间从 10s 到 15min | 长任务用 Cloudflare Workflow 持久化 step state |
| `spaceContainerTag` 出现在 memory 字段 | 跨 space 检索时反查 source |
| `processingMetadata.chunkingStrategy` | 把 chunking 算法选择记录下来,便于 AB / 调试 |

---

## 11. 如果由我来实现,会怎么设计

> 本节是个人方案。我尽量描述"为什么这么做",而不写具体 API。

### 11.1 总体原则 (五条)

1. **核心引擎开源,商业化在生态**:KB 是用户最关心的部分,把 core + pipeline 开源可以极大降低信任与采用门槛;商业化靠在托管服务、付费 connector、监控告警上
2. **单一数据模型,统一关系链**:Document 与 Memory 在本质上都是"知识节点",应合并为一张带 `source` 指针的统一表,而不是两套表加关联表
3. **pipeline 显式可观测**:每个 stage 是 first-class 概念,持久化到结构化 events 表,而不是塞进 `processingMetadata.steps` 这种 JSON blob
4. **关系由 LLM 提议 + 用户裁决**:LLM 不应单方面决定 updates/extends/derives,应在 UI 上让用户确认或拒绝,以减少错误率并建立用户信任
5. **多租户按"工作区"分库**:单 DB + row-level 隔离在数据量上来后会成瓶颈,应当用 schema-per-tenant 或 DB-per-workspace 隔离

### 11.2 仓库结构 (如果我重做)

整体应拆成三层:

- **core 层**(共享数据模型、Zod 契约、Drizzle schema) — 任何上层都依赖它
- **pipeline 层**(6 个独立子包,每个负责一个处理阶段) — 阶段之间通过 stage interface 解耦,方便独立升级和替换
- **应用层**(API 控制面、worker 编排、web 控制台、MCP server) — 各自独立部署,通过 core 层共享类型

这样的结构比"一个大 monorepo 装下所有后端代码"更利于做版本化:core 可以独立 semver,pipeline 阶段可以独立 AB。

### 11.3 关键技术决策

| 决策点 | Supermemory 现状 | 我的方案 | 理由 |
|---|---|---|---|
| 向量库 | 推测用 Vectorize | 早期 Postgres + pgvector → 规模后拆分 | 起步不需要引入额外组件,扩展后按需拆 |
| 多 embedding | 3 套并存 | 单一字段 + `embedding_model_version` 列 | 减存储、减同步复杂度,模型升级用滚动重算 |
| Document vs Memory | 两层表 + 关联表 | 合并为 `Item` 表,带 `item_type` 区分 | 关系链扁平化,查询更简单,追溯更直接 |
| 关系检测 | 推测纯 LLM | LLM 提议 + 用户在 UI 确认/拒绝 | 减少错误率,建立用户信任,沉淀高质量反馈 |
| 处理编排 | Cloudflare Workflow | Temporal.io (self-host) 或 Inngest | 跨云、调试 UI 成熟、回放能力强 |
| 鉴权 | Better Auth | Better Auth (沿用) | 已被验证 |
| API 版本 | v3 + v4 并存 | 单一 `/v1`,通过 Accept header 协商 | 减少长期维护成本,迫使用户面向"能力"而非"路径"思考 |
| 内容去重 | contentHash | 加上 perceptual hash (图像) / simhash (文本) | 多模态场景下"同一张照片两次上传"也能识别 |
| 嵌入压缩 | matryokshaEmbedding | 默认用 Matryoshka 训练后的模型 | 省存储且不影响召回,实现简单 |
| 缓存层 | 推测 KV | 显式 cache 包:profileCache (5min TTL, SWR) | 已知 profile 查询是热路径,显式缓存可控性更高 |

### 11.4 核心 schema 的设计哲学

我会用一张统一的 `items` 表承载所有"知识节点",通过 `type` 字段区分原始文档、chunk、memory 和 profile fact。版本链通过 `parent_id` / `root_id` 两个字段建立,前者指向直接的"前驱版本",后者指向"这一脉知识的最早源头",便于做时间线回溯和整脉查询。

空间与租户用 `orgId` + `spaceId` 双重索引,所有高频查询路径都基于这两个字段的复合索引。contentHash 做"同空间内容去重",用 `(orgId, contentHash)` 的唯一约束保证不会重复入库。

**重要选择**:不做单独的 `MemoryDocumentSource` 关联表。源追溯可以用 SQL view 派生,避免在每次写入时维护额外的 join 行;这反映的原则是"派生数据不入表,让数据库做擅长的事"。

### 11.5 Pipeline 接口的设计哲学

整个 pipeline 应当围绕一个**不可变的 context 对象**流转 — context 包含当前 item、所属 space、org 设置、数据库/向量/LLM 客户端、logger。每个 stage 接收 context,返回新的 context(纯函数式),所有副作用封装在 stage 内部。

注册式编排,而不是 if-else:把 stage 列表当作数据而非控制流,这样:

- 可以做 dry-run 预览(让用户看到"如果我上传这个文档会触发哪些阶段")
- 可以做 A/B(把同一 stage 替换成两个实现,各自走 50% 流量)
- 可以做单步重放(失败时只重跑某个 stage 而不是整条 pipeline)
- 可以做本地 e2e 测试(用 in-memory db 跑整条链路)

每个 stage 还要声明**是否可重试、预估耗时量级**,让 worker 据此决定重试策略和资源占用。

### 11.6 关系检测的设计哲学 (启发式 + LLM 兜底)

不应让 LLM 做"理解"工作 — LLM 应当只做"分类"工作。具体流程:

1. **向量召回** — 对每条新 memory,在同 space 召回 top-20 候选
2. **启发式预筛** — 用三类廉价信号过滤明显的关系:时间窗(一周内的)、主题相似度阈值、元数据键名重叠。这一步覆盖掉大约 60% 显然的关系,免去 LLM 负担
3. **LLM 兜底** — 只对"启发式未命中但相似度仍高"的 10-15 条调 LLM 做精确分类
4. **confidence 落库** — 每条关系带显式 confidence,UI 上用不同颜色展示,让用户选择信任与否

这样的好处是:**省 token、可解释、可降级**。LLM 挂了仍然能跑(只是少了 20-30% 的关系发现),且启发式命中是可审计的。

### 11.7 可观测性的设计哲学

`ProcessingMetadata.steps` 用 JSON 数组记录步骤状态是"嵌入式日志",难以查询和告警。改用三层:

- **结构化 events 表**:每行是一条 stage 执行记录,字段有 item_id、stage 名、状态、起止时间、错误、附加 metadata。基于这张表可以查"过去 7 天 embed 阶段的失败率""按 orgId 看慢的 stage"等
- **OpenTelemetry traces**:每个 stage 是一个 span,可以串到 LLM 调用,直观看到"这 1.2s 慢在哪"。LLM 调用也作为子 span,记录 prompt token / completion token
- **Sentry breadcrumbs**:在关键决策点(LLM 拒绝抽取、用户拒绝确认关系)留 breadcrumb,出问题回溯时一目了然

### 11.8 对"私有后端"策略的反思

| 策略 | 优劣 |
|---|---|
| 后端闭源 (Supermemory 现状) | 商业护城河,但社区贡献者参与门槛极高,技术信任建立慢 |
| SDK 开源 (Supermemory 现状) | 用户可以自助集成,但核心能力不透明 |
| **我的方案**:core + pipeline 开源,商业化靠托管 + 企业 connector | 用户可以自部署以满足合规/隐私要求,降低采用摩擦;托管版本提供 SLA、监控、高级 connector 作为商业收入 |

理由:memory / RAG 赛道竞争激烈,护城河最终在"数据 + 关系图质量 + 集成广度",而不是核心代码。开源 core 可以反过来加速这三个维度:更多用户意味着更多关系图样本,可以反哺抽取质量;更多集成贡献者扩展了 connector 覆盖;更多企业自部署让托管版有更多"高价值客户"基础。

---

## 12. 一句话总结

> Supermemory 的 KB 是一个**用强 schema (Zod) 约束的、统一抽象的"活的知识图谱"** — Document 是来源真值,Memory 是抽取后的语义节点,`updates/extends/derives` 三种关系边把节点编织成网;一切围绕 `containerTag` 做租户隔离,Cloudflare 全家桶做弹性基础设施。它的精妙之处是**用一套数据模型同时表达了 RAG 检索和 Long-term Memory 记忆**,免去了用户在两种范式间做选择。短板是**核心引擎不开源**,社区贡献只能停在客户端层。
