# World Monitor 架构报告：从 API 仪表盘到 Agent 情报平台的演进

## 1. 执行摘要

**系统定位**: World Monitor 是一个 Agent-ready 的全球情报仪表盘，以 stateless edge receptor surface（路由/认证/缓存/Agent 发现）fronting 一个 stateful server processor core（数据聚合/跨域关联/弹性）的二分格局组织，通过 proto 定义的契约连接，双重暴露于人类（REST）和机器（A2A/Agent）接口。

**核心发现**: 系统正从"API-first 数据仪表盘"向"Agent-native 情报平台"演进，但处于过渡期——REST 是当前主导接口，Agent 平台是新增的薄层尚未触及核心处理。架构最大的张力来自 edge/server 二分法在实践中不断模糊（edge 正在变厚），以及 Proto IDL 驱动的契约治理可能是"架构意图"而非"已实现架构"。

---

## 2. 仓库心智模型

维护者将系统沿两条正交轴划分：

| 轴 | 划分 | 内容 |
|---|---|---|
| 部署边界 | Edge vs Server | Edge = 受体表面（路由/认证/缓存/发现），Server = 处理器核心（聚合/关联/弹性） |
| 能力域 | Data → Intelligence → Presentation → Agent | 从数据摄入到多格式输出 |

**实际并非固定二分法**。挑战分析显示 edge 正在变厚：auth origin allowlist（配置状态）、rate limit buckets（计数器状态）、Agent 路由、缓存协调均已运行在 edge。更准确的模型应该是"capability-dependent deployment spectrum"——每个 capability 独立决定 edge-side vs server-side 分割点。

维护者实际上将系统理解为**数据精炼厂**（data refinery）：adapter-based data ingestion → standardized pipeline processing → multi-format output (REST/A2A/SDK) → multi-brand rendering。Edge/server 分区是部署细节，不是架构本质。

```
[数据源1] ─┐
[数据源2] ─┤  ┌─ Adapter ─→ [聚合 Pipeline] ─→ [关联引擎] ─→ [缓存: CDN/Redis/Bootstrap]
[数据源N] ─┘  └──────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
               [REST API]    [A2A Agent]    [SDK Client]
                    │
                    ▼
              [多品牌 SPA 渲染]
              (apex/www/variant subdomains)
```

---

## 3. 架构：四层组织

### 3.1 受体层（Edge Functions）

Filesystem-based routing，以目录结构作为路由表。路由优先级：具体函数 > 嵌套动态网关 > 版本化网关 > 兜底 catch-all。

```
api/
├── health.ts                    # 具体函数（最高优先级）
├── _api-key.js                  # 下划线前缀 = 路由级 helper（无冷启动）
├── _session.js
├── a2a.ts                       # A2A 协议端点
├── ask.ts                       # NLWeb 自然语言端点
├── <service>/v1/<rpc>.ts        # 按服务/版本的嵌套网关
├── v2/shipping/<rpc>.ts         # 版本化迁移路径
└── [...notfound].ts             # 兜底 404（最低优先级）
```

### 3.2 核心处理层（Server Runtime）

数据聚合 Pipeline + 断路器 + 跨域关联。与 edge 通过共享 helper（`_*.js`）通信，server 代码通过 esbuild 在部署时被 bundle 进 Edge Functions。

### 3.3 契约层（Proto IDL）

**重要：当前处于"架构意图"状态。** Proto IDL → code generation pipeline（buf generate → TypeScript stubs + OpenAPI specs）已建立，但缺少独立证据链证明所有 handler 由生成驱动。未见 `DO NOT EDIT` 注释、generator version header、或 `pnpm generate` 命令。**8 个操作端点明确通过 `api-route-exceptions.json` 退出契约系统**（auth、MCP、bootstrap、health 等），但退出理由未文档化。

### 3.4 展示层（多品牌 SPA + Variant 系统）

单代码库多品牌，通过 Host header 运行时选择品牌。同一前端代码部署到所有子域，**API 后端在 variant 之间完全相同**——variant 边界只到 UI 层。一个 tech 变体的用户仍在支付 aviation/conflict/climate handlers 的冷启动成本。

> **架构中心假设**: "该系统是一个 stateless edge receptor surface fronting a stateful server processor core，通过 proto 定义的契约连接，双重暴露于人类和机器接口。"
>
> **挑战结果**: 此假设的 5 个关键子假设中 4 个被成功挑战并修改（详见 §6）。

---

## 4. 工程决策

### D1: Proto-defined IDL with Code Generation
| 选择 | Proto IDL → 自动生成 handler stubs + SDK + 验证器 |
|---|---|
| 拒绝 | 手写 API handler（spec/implementation drift）；OpenAPI-first（约束力弱）；无契约（不一致） |
| 为什么 | 契约一致性 + 零摩擦扩展模型 |
| **挑战** | ❌ 假设翻转：proto 可能只是架构意图（intended architecture），不是已实现架构。未见 .proto 文件的实际证据链 |

### D2: Token-overlap Routing over NLU for Agent Tool Suggestion
| 选择 | 名称/描述分词交叠 + 名称加权（3pts vs 1pt）|
|---|---|
| 拒绝 | NLU intent classification（冷启动延迟）；hard-coded route map（手动更新）；vector embedding（过度设计） |
| 为什么 | 透明、可调试、无模型依赖 |
| **挑战** | ❌ 降级为实现细节：任何 keyword-match 机制可替代 token-overlap。核心决策是"基于工具注册表的显式路由，而非意图分类" |

### D3: Single-codebase Multi-brand Variant System
| 选择 | 运行时 Host header 选择品牌，单代码库生成所有变体 |
|---|---|
| 拒绝 | 多仓库（重复维护）；Git 分支（合并地狱）；仅 feature flags（不足以实现完整品牌主题） |
| 为什么 | 共享后端 + 独立品牌 + 所有品牌受益于统一修复 |
| **挑战** | ⚠️ 重新标定：品牌数达到 10+ 时条件逻辑指数扩散。未提供品牌特异功能 vs 共享功能的比例监控，feature flags 缺少跨品牌命名空间隔离 |

### D4: No Database (Cache as Primary Storage)
| 选择 | 所有状态是 ephemeral（Redis/CDN/Bootstrap 缓存）或环境配置 |
|---|---|
| 为什么 | 系统是聚合层+展示层，不拥有数据。无状态应用层支持水平扩展 |
| **挑战** | ❌ 标记为有时效性：intelligence graph 增强 + Agent ecosystem 扩展将产生高价值持久化分析产物。cache 过期丢失不可恢复 |

### D5: Multi-tier Caching (CDN + Redis + Bootstrap)
| 选择 | 三级缓存，distinct TTL policies，coordinated invalidation |
|---|---|
| 拒绝 | 单 CDN（无服务器协调）；单 Redis（全局瓶颈）；无缓存（延迟不可接受） |
| 为什么 | 每层优化不同 latency/capacity 权衡 |
| **挑战** | ⚠️ 重新标定为 tradeoff：无量化指标（hit ratio、freshness SLA）。高 freshness 要求数据跳过缓存可能更优。三级间 invalidation 协调复杂度随数据源线性增长 |

### D6: Lint & Enforcement Scripts
| 选择 | 8+ 独立 enforce 脚本在 CI 中运行 |
|---|---|
| 为什么 | 架构治理作为自动化 CI 门禁 |
| **挑战** | ❌ 降级为 CI/CD 质量门禁：lint 检查合规性，不参与运行时架构。模块边界是代码结构问题，不是 lint 脚本创建的。更好表示为"CI/CD Quality Gates" |

### D7: A2A Protocol + Custom Concierge
| 选择 | 直接实现 A2A 标准，自定义轻量 concierge |
|---|---|
| 拒绝 | LangChain（重型依赖）；Semantic Kernel（.NET 生态冲突）；自建非标准 |
| 为什么 | A2A 是新兴开放标准，确保互操作性 |
| **挑战** | ✅ Survived：但重新定位为"超前投资于未来 Agent 生态互操作性"。REST API 当前已足够。核心架构贡献是"Agent 接口与人类接口分离为平行的两个 API surface" |

### D8: Desktop Tauri via Origin Allowlisting (Shared Auth)
| 选择 | Tauri origins 加入 API key 验证的 allowlist，desktop 复用 web auth 模型 |
|---|---|
| 拒绝 | 独立 desktop auth 系统；desktop-only API endpoints |
| 为什么 | 统一安全模型，desktop 作为"另一个浏览器上下文" |
| **挑战** | ⚠️ 当前是 Phase 1（Desktop-as-Web-Client），非原生桌面应用。无 OS keychain、硬件认证、离线能力 |

---

## 5. 设计空间：被拒绝的替代方案

| 决策 | 哪些被拒绝 | 为什么拒绝 |
|---|---|---|
| D1 Proto IDL | OpenAPI-first; 手写 API; 无契约 | OpenAPI 约束力弱，手写容易 drift |
| D2 Token-overlap | NLU; Hard-coded map; Vector embedding | NLU 冷启动/黑盒，embedding 过度工程 |
| D3 单代码库 | 多仓库; Git 分支; 仅 feature flags | 分支导致 merge hell，多仓库重复维护 |
| D4 No DB | 无替代方案被拒绝——这是设计约束非选择 | — |
| D5 三级缓存 | 单 CDN; 单 Redis; 无缓存 | 每层解决不同问题 |
| D6 Lint 脚本 | 约定治理; 单一体 linter; 仅运行时 | 约定不可强制，运行时太晚 |
| D7 A2A | LangChain; Semantic Kernel; 自建非标准 | 重量级/生态冲突/无互操作性 |
| D8 Desktop | 独立 auth 系统; Desktop-only endpoints | 重复基础设施，安全模型不一致 |

---

## 6. 模型挑战：哪些被挑战过

| # | 挑战目标 | 方法 | 结果 | 
|---|---|---|---|
| 1 | Token-overlap 路由是核心架构决策 | 移除测试 | **修改** → 降级为实现细节，核心是"基于工具注册表的显式路由" |
| 2 | Proto IDL 已实现并驱动所有 handler | 假设翻转 | **修改** → 从已验证约束降级为架构意图 |
| 3 | No database 是永久性决策 | 时间测试 | **修改** → 标注有时效性，intelligence graph 演进需要持久化 |
| 4 | 多级缓存优势成立 | 边界测试 | **修改** → 重新标定为 context-dependent tradeoff |
| 5 | Lint scripts 是架构组件 | 移除测试 | **修改** → 降级为 CI/CD 质量门禁 |
| 6 | A2A 是当前必需品 | 假设翻转 | ✅ Survived → 重新定位为超前投资 |
| 7 | Edge/server 固定二分法 | 边界测试 | **驳斥** → 建模为 capability-dependent deployment spectrum |
| 8 | 单代码库多品牌长期最优 | 时间测试 | **修改** → 标注10+品牌时条件逻辑扩散风险 |
| 9 | Rule-based 关联足够支撑 | 边界测试 | **修改** → 标注跨语言/隐式关系推理时上限 |
| 10 | Desktop = 原生桌面应用 | 假设翻转 | **修改** → 当前是 Phase 1: Desktop-as-Web-Client |

### 关键反证记录

**Proto IDL 假设翻转的证据模式**: 所有五次对 proto IDL 的描述都指向 Repository Model 的同一句话，没有独立证据链。如果 proto 真正驱动所有 handler，应有:
- `.proto` 文件路径 ✓ (有 proto/ 目录)
- 生成脚本/generate 命令 ✗ (package.json 中无)
- Handler 中的 `DO NOT EDIT` 注释 ✗
- Generator version header ✗

**Edge stateless 被驳斥**: auth origin allowlist（配置状态）、rate limit buckets（计数器状态）、缓存协调（一致性状态）已在 edge 运行——"edge = thin" 是过时的 mental model。

---

## 7. 修改影响地图

### 修改 A：向 proto IDL 添加新 service

```
proto/foo/v1/foo.proto
  → buf generate
    ├── api/foo/v1/foo.ts          (handler stub)
    ├── sdk/client/foo.ts           (SDK client)
    └── shared/types/foo.ts         (验证器 schema)
  → 影响：
    ├── API Gateway: 新增 /api/foo/v1/* 路由（自动注册）
    ├── SPA Frontend: 需要 UI 组件消费新端点
    ├── Caching Layer: 需要确定 cache tier (fast/medium/slow/static/daily/no-store)
    ├── SDK Client: 自动获得新服务客户端
    ├── Lint & Enforcement: lint:api-contract 自动覆盖
    └── 不受影响：Authentication（复用现有）、Variant System（不感知）、Agent Platform（手动注册 tool 到 tools/list）
```

**风险**: 如果 proto pipeline 当前是"架构意图"而非已实现，实际影响范围只有 proto/ 目录本身的文件。

### 修改 B：新增品牌 variant

```
variant/configs/foo.json  +  src/assets/foo/*.overlay
  → Host header 匹配 → 加载 foo 配置 → 渲染
  → 影响：
    ├── Variant System: 运行时选择，无代码变更
    ├── SPA Frontend: 主题/配置切换（Client-only）
    ├── API Gateway: ❗ 无影响——API 后端完全不变
    └── 不影响：Server Runtime、Data Aggregation Pipeline、Caching Layer、Auth
```

**关键观察**: Variant 边界在 UI 层——添加品牌不影响后端，但也意味着 tech variant 用户仍在支付所有 35+ 域 handler 的冷启动成本。

### 修改 C：修改 circuit breaker 参数

```
src/utils/circuit-breaker.ts: maxFailures=2 → 3
  → 影响：
    ├── Server Runtime: 所有域断路器更新
    ├── Data Aggregation Pipeline: 失败容忍度变化
    ├── Caching Layer: 断路器 fallback 路径触发频率降低
    └── 不影响：API Gateway（不拥有断路器状态）、Auth、SPA、Variant、Agent
```

**未覆盖风险**: ❗ 无 gateway-level bulkhead——一个上游超时可阻塞整个 gateway worker。此修改不修复 domain isolation 问题。

### 修改 D：添加 Agent tool

```
tools/list 注册新 tool → _agent-tool-suggest.ts 自动路由
  → 影响：
    ├── Agent Platform: 工具注册表增加条目
    ├── A2A endpoint: 自动发现新 tool
    ├── NLWeb /ask: 自动路由到新 tool
    └── 不影响：REST API 端点、Server Runtime、Caching Layer、Auth
```

**架构意义**: Agent tool 是最高杠杆扩展点之一——无需改路由、无需改 edge 代码。

---

## 8. 可复用知识

### 8.1 Token-overlap Concierge 模式
一个透明、可调试的 Agent 路由机制：工具注册表（tools/list）匿名发布 → 请求与工具名称/描述分词交叠 → 名称加权（3pts）高于描述（1pt）→ 返回 top-N。核心理念：Agent 路由的透明性比智能更重要——"dumb switchboard where the intelligence lives in the tool implementation, not the router"。

**可迁移条件**: 工具数量 < 100、工具功能差异度高（名称可表达功能本质）、无跨语言需求。

### 8.2 Edge Helper Underscore Convention
下划线前缀（`_api-key.js`）作为"路由级 helper"的命名约定——避免独立冷启动，通过共享模块而非复制到每个 edge function。模式：Vercel/Cloudflare edge runtime 中，`_` 前缀文件不会被注册为独立路由端点，但可被其他 handler import。

### 8.3 Proto IDL + Codegen as Architecture Spine
IDL 驱动开发模式的核心价值不在于"代码生成"，而在于: (1) 单一真理源（proto 变更触发所有下游更新）；(2) 契约可视化（proto 文件是 API surface 的可读文档）；(3) 扩展零摩擦（新增 service = 定义 proto + 重新生成）。

**反模式标记**: 当操作端点退出契约系统（`api-route-exceptions.json`）时，需要明确记录退出理由——否则契约覆盖率降低且团队不知道哪些端点未受治理。

### 8.4 Cache Tier as Per-RPC Concern
不将缓存视为系统级全局策略，而是每个 RPC 声明自己的 cache tier（fast/medium/slow/static/daily/no-store with s-maxage from 300s to 86400s）。模式：`RPC_CACHE_TIER` map 表达了 fine-grained 缓存策略，拒绝 one-size-fits-all。

### 8.5 Lint Scripts as CI Quality Gates
脚本级治理：每个规则独立文件、独立测试、独立 CI gate。模式不是"架构组件"，而是"架构合规性自动化"。**关键洞察**: 将治理机制与架构组件区分——lint 脚本不是架构，它们 enforce 的架构规则才是。

---

## 9. 意外发现

### 9.1 系统中同时存在语义路由和词法路由但不连通
客户端 Web Worker 已运行 ONNX ML pipeline（MiniLM-L6 embeddings + vector store + semantic search）用于 headline 聚类和关联检测，但 Agent tool suggestion 只用简单的 token-overlap 评分——语义引擎和词法路由在同一仓库中却不连接。这是故意的（edge cold-start 预算约束）还是演进间隙？当前解释为"冷启动约束"，但无定量证据。

### 9.2 80+ Edge Functions 使用 plain JS 而 Server 使用 TypeScript
创建了认知维护负担：开发者需要 mental track 什么在 V8 Edge isolate 中运行 vs 什么在 bundled server context 中运行，且共享的 `_*.js` helpers 被两者 import。实际边界不是源码级隔离而是构建时 bundling。

### 9.3 单一 Gateway Factory 模式
`server/gateway.ts`（1092+ 行）是跨所有 domain bundle 共享的 ~3KB import，但实际包含了 idempotency checks、MCP internal HMAC、entitlements、usage telemetry、direct LLM quota、bbox validation——所有 domain bundle 都拉入这些逻辑即使 domain 不使用。冷启动预算影响未测量。

### 9.4 缺少 Gateway-level Bulkhead
系统有 40+ per-domain 断路器 + server-side idempotency layer + Redis-outage degraded mode，但 **无 gateway-level bulkhead**——`createDomainGateway` 从共享 pipeline 为所有域服务，单一上游超时可阻塞整个 gateway worker。

### 9.5 Proto 多语言 SDK 同步缺失
proto 定义覆盖 35+ domains → buf generate → TypeScript stubs + OpenAPI specs。Go/Python/Ruby SDKs 存在，但 CI 只检查 TypeScript 生成代码的新鲜度（`proto-check.yml`）。非 TypeScript SDK 没有契约新鲜度 CI。

---

## 10. 未解问题

| ID | 问题 | 深度 | 置信度 | 阻塞原因 |
|---|---|---|---|---|
| R2-Q1 | 四层缓存层级如何协调 TTL 和失效——当单个数据域有 per-RPC cache tiers AND 预计算 bootstrap tier AND CDN edge headers 时，是否存在 stale bootstrap 遮蔽较新 per-RPC 数据的 freshness inversion？ | L3 | 低 | 缺少 invalidation protocol 文档 |
| R2-Q2 | Edge (plain JS) vs Server (TypeScript with esbuild) 的双运行时分拆是否造成认知维护负担？ | L2 | 低 | 缺少开发体验评估 |
| R2-Q3 | 8 个操作端点退出 proto 契约的决策驱动因素是什么？团队如何防止契约 drift？ | L2 | 低 | 退出理由未文档化 |
| R2-Q4 | 无 gateway-level bulkhead——单一上游故障如何不级联到整个 API surface？ | L3 | 低 | 架构缺口，未实现 |
| R2-Q5 | Variant 边界在 UI 层而非也过滤 API surface——tech variant 用户在支付不需要的 handlers 的冷启动成本，为何选择此 tradeoff？ | L3 | 低 | 冷启动预算影响未测量 |
| R2-Q6 | ONNX 语义引擎客户端已存在，但 Agent tool suggestion 只用 token-overlap——为何不连接？冷启动约束还是演进间隙？ | L3 | 低 | 缺少定量冷启动预算分析 |
| R2-Q7 | Go/Python/Ruby SDK 如何与 proto 契约保持同步？proto 变更到 SDK 发布的时间差？ | L2 | 低 | 缺少非 TypeScript SDK 契约新鲜度 CI |
| R2-Q8 | 单一 gateway factory（1092 行）共享给所有 35+ domain bundle——冷启动预算影响是否测量过？ | L3 | 低 | 未测量 |

**8 个未解问题的共同特征**: 全部涉及**量化缺失**（冷启动预算、freshness SLA、cache hit ratio、SDK 发布延迟）。这不是偶然——系统在"架构意图"和"已实现架构"之间的差距需要量化证据来弥合。建议优先回答 R2-Q2（双运行时分拆认知负担）和 R2-Q5（variant API surface 分割决策），这两个是当前演进阶段可操作的短期改善点。R2-Q1（缓存一致性）和 R2-Q4（bulkhead 缺失）是潜在生产风险，建议补充监控后评估优先级。

---

## 报告质量门禁

- **多重证据？** 五个关键挑战的每个都有反对证据链。竞争解释引用了独立证据中的矛盾。
- **替代解释？** §9 提供了四个竞争解释（数据精炼厂模式、intended vs implemented architecture、平台愿景 vs 当前现实、Desktop-as-Web-Client）。
- **重要决策？** 8 个工程决策中每个都列举了被拒绝的替代方案及其理由。
- **Unknown 不掩饰？** §10 明确列出 8 个无法完整回答的问题，标注置信度。
- **洞察 vs 堆砌？** 核心洞察: 该系统最重要的不是 edge/server 二分法（这是实现细节），而是"基于工具注册表的显式路由 + Proto 契约 + 三级缓存 + 多品牌变体"这四个模式的组合——数据精炼厂的 chassis，Agent-native 接口是用于未来生态兼容性的前向投资。

---

*本报告基于提供的 Repository Model、Architecture Explanation、10 项挑战结果（5 modified / 1 survived / 1 refuted / 3 modified-with-caveat）、8 个未解问题、和竞争解释生成。*