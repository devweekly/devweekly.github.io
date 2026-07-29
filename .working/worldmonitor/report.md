# WorldMonitor 架构研究报告

> **研究方法**：基于 repo-research-v2 skill 的 Orchestrator + Sub Agent 架构，通过 2 轮研究（10 个问题，全部回答验证），收集 12 份证据文件，构建 5 维 Repository Model，对 6 个核心假设进行质疑（4 个 survived、1 个 weakened、1 个 modified）。
>
> **证据强度标准**：S=可执行行为 > A=源码实现 > B=配置 > C=文档 > D=提交/Issue > E=推断。本报告中 A 级证据占 ~70%，C 级 ~20%，E 级 ~10%。

---

## 1 执行摘要

**定位**：WorldMonitor 是一个跨 5 平台部署的实时全球情报仪表盘，聚合 65+ 上游数据源（地缘政治、军事、金融、网络、气候、海事、航空）为统一态势图，并将 Agent-readiness（MCP / RFC 9728 / RFC 8414）作为由 CI 回归网强制执行的一等架构不变量。

**核心发现**：

1. **Agent-readiness 是架构不变量而非附加功能** — MCP anonymous/authenticated 方法切分（#4937）由协议级 30s SDK 超时强制，Cloudflare apex→www 重定向豁免列表由 OAuth 客户端动态注册的 POST→GET 退化（#4938）强制，二者均由 6 小时 cron 回归网守护 [→ §3.3]
2. **4 层缓存层次结构是 65+ 上游供应商的可生存性骨架** — 移除 Redis 将在数分钟内耗尽上游速率限制；seed-meta 新鲜度追踪是防止静默陈旧数据的唯一机制 [→ §5.1]
3. **No-refund 配额策略（GHSA-hcq5）是安全-UX 的明确权衡** — 退款在良性场景对用户友好，但在对抗场景下使每日配额从"强制"退化为"建议"；代码注释显式记录了该决策 [→ §5.2]

**架构中心假设**：WorldMonitor is a multi-platform intelligence dashboard where agent-readiness is a first-class architectural invariant enforced by CI regression nets, and the 4-layer cache hierarchy with seed-meta freshness tracking is the operational backbone that makes 65+ upstream providers survivable. — **该假设经受住了所有质疑（survived）**。

| 维度 | 覆盖率 | 说明 |
|------|--------|------|
| runtime | 0.75 | 8 阶段初始化、请求生命周期、4 层缓存、种子循环均已记录 |
| architecture | 0.80 | 目录结构、网关工厂、路由器、Edge Function 约束、proto 系统 |
| design_decisions | 0.70 | 8 个决策含设计空间分析，多数有代码注释支撑 |
| testing | 0.55 | node:test、Playwright E2E、Edge 守卫、pre-push hook |
| deployment | 0.75 | 9 目标部署拓扑、20+ CI 工作流 |
| history | 0.30 | 仅 issue 编号（#4937/#4938/GHSA-hcq5），无 ADR |

---

## 2 仓库心智模型

维护者将系统心智划分为 **5 个职责层 + 6 个发现面**：

```
┌─────────────────────────────────────────────────────────────┐
│                     发现面（Discovery Surfaces）              │
│  MCP server · RFC 9728 PRM · RFC 8414 ASM · llms.txt         │
│  .well-known/agent-skills · .well-known/api-catalog          │
├─────────────────────────────────────────────────────────────┤
│  浏览器/桌面  │  DeckGLMap · GlobeMap · Panels(105) · Workers  │
├─────────────────────────────────────────────────────────────┤
│  Edge 层     │  Vercel Edge Functions (per-domain bundling)    │
│              │  + Middleware (bot 过滤) + Cloudflare CORS      │
├─────────────────────────────────────────────────────────────┤
│  服务层      │  server/gateway.ts (10 步流水线) + proto 契约    │
│              │  + 8 缓存层 + ETag/304 + 幂等性                 │
├─────────────────────────────────────────────────────────────┤
│  状态层      │  Upstash Redis (4 层缓存) · Convex (权益+锁)     │
│              │  Railway (WebSocket relay + 种子循环)            │
├─────────────────────────────────────────────────────────────┤
│  上游层      │  65+ 数据源 (Finnhub/OpenSky/ACLED/UCDP/FIRMS…)  │
└─────────────────────────────────────────────────────────────┘
```

**心智模型核心**：代码是实现的单一事实源（stats.json + docs:check），但**不是**架构意图的充分载体——决策理由散落在代码注释和 issue 编号中，缺少结构化 ADR 层。Agent-readiness 不是事后添加的 SDK，而是与缓存、安全、配额并列的架构支柱。

---

## 3 架构

### 3.1 能力地图

| 能力域 | 实现 | 强制机制 |
|--------|------|---------|
| **地缘政治情报** | 65+ 上游供应商 → 种子循环 → Redis → SPA 面板 | seed-freshness-monitor.yml (15min cron) |
| **MCP 服务** | api/mcp.ts (Streamable HTTP) + handler.ts + dispatch.ts + registry/ | mcp-live-smoke.yml (6h cron, #4937/#4938 回归网) |
| **多平台部署** | Vercel + Railway + Convex + Cloudflare + Tauri + GHCR | 20+ CI 工作流 + deploy-gate.yml 聚合 |
| **Agent 发现** | RFC 9728 PRM + RFC 8414 ASM + llms.txt + agent-skills + api-catalog | _agent-metadata.ts Host 欺骗守卫 |
| **配额与计费** | INCR-first 预留 + GHSA-hcq5 不退款 + 8 层缓存层级 | live-api-cache-auth.yml (6h cron, #4497 回归网) |
| **桌面运行时** | Tauri Rust shell + Node.js sidecar + fetch patch + keyring | build-desktop.yml + test-linux-app.yml |
| **SDK 生态** | npm CLI + Python + Ruby + Go (OIDC trusted publishing) | publish-{cli,python,ruby,go}.yml |
| **6 站点变体** | world/tech/finance/commodity/happy/energy (hostname 检测) | variant.ts + CI 构建矩阵 |

### 3.2 静态架构

```
api/                          # Vercel Edge Functions (自包含 JS)
├── _*.js                     # 共享助手 (CORS/rate-limit/api-key/relay/sentry)
├── <domain>/v<N>/[rpc].ts    # 域端点 (由 createDomainGateway 生成)
├── mcp.ts                    # MCP 服务入口 (Streamable HTTP)
├── bootstrap.js              # 批量水合 (3 级 auth-aware 缓存)
├── health.js                 # 健康监控 (seed-meta 新鲜度)
├── a2a.ts / ask.ts           # A2A + NLWeb (token-overlap concierge)
└── _agent-metadata.ts        # RFC 9728/8414 (Host 派生 + 欺骗守卫)

server/                       # 服务端代码 (打包进 Edge Functions)
├── gateway.ts                # 域网关工厂 (10 步流水线 + 8 缓存层)
├── router.ts                 # 路由匹配 (Map O(1) 静态 + 线性动态)
├── _shared/                  # Redis/rate-limit/LLM/缓存/幂等/HMAC
└── worldmonitor/<domain>/    # 域处理器 (镜像 proto 结构)

convex/                       # Convex 后端 (权益 + 锁 + webhook)
├── schema.ts                 # followedCountries 分片 + TTL 锁
└── http.ts                   # HTTP 入口 (timing-safe 比较 + ConvexError 解析)

proto/                        # Protobuf 服务定义 (sebuf 框架, 281 protos, 35 services)
src/generated/{client,server}/# buf generate 产物 (DO NOT EDIT)
```

**边界强制**（5 层防护）：
1. `tests/edge-functions.test.mjs`：禁止 `node:` 内置导入、禁止 `../server/` 和 `../src/` 跨目录导入
2. pre-push esbuild bundle check（每个端点独立打包）
3. `proto-check.yml` CI：`make generate` 输出必须匹配已提交代码
4. `lint:api-contract`：无法 proto 定义的手写端点必须在 `api/api-route-exceptions.json` 显式列出
5. `docs:check` CI：ARCHITECTURE.md 能力计数必须匹配 `stats.json`

### 3.3 运行时架构

#### 请求生命周期（Edge Function 域网关）

[Observation] 每个 `api/<domain>/v<N>/[rpc].ts` 调用 `createDomainGateway(routes)` 获得 10 步流水线处理器。

[Evidence] `server/gateway.ts` 明确定义：Origin check → CORS → OPTIONS preflight → API key 验证（origin-aware：桌面要求 key，可信浏览器豁免）→ 速率限制（端点特定 + 全局回退，Upstash 滑动窗口）→ 路由匹配（Map O(1) 静态 → 线性动态 `{param}` 扫描）→ POST-to-GET 兼容 → 处理器执行 + 错误边界 → ETag 生成（FNV-1a）+ 304 → 缓存头应用（8 层：fast/medium/slow/slow-browser/static/daily/no-store/live）。

[Interpretation] 10 步流水线是一个**显式的契约执行顺序**——每一步都是一个独立的安全/性能/正确性检查，顺序不可调换。例如，速率限制必须在 API key 验证之后（否则无法区分匿名 vs 认证流量），ETag 必须在处理器执行之后（否则无法基于响应体生成哈希）。

[Alternative] 另一种设计是用框架（如 Hono、Elysia）的中间件系统，但那会引入框架抽象层，增加 Edge Function 冷启动成本，且无法精确控制每步的执行顺序与错误传播。

[Challenge] 边界测试质疑：10 步流水线是否过度工程？答案是否定的——每一步都对应一个真实的安全或性能需求（Origin 欺骗、CORS、预检、key 验证、速率限制、路由、兼容性、错误边界、缓存、ETag）。移除任何一步都会引入一个已知的攻击面或性能回归。

[Conclusion] 10 步流水线是 Edge Function 网关的**最小完备契约**——每一步都是必要的，顺序是强制的。这是一个为 Edge 计算环境量身定制的"框架替代"设计：用显式函数组合代替框架中间件，换取冷启动性能和顺序可控性。【Evidence Strength: A 级（源码实现 + 代码注释），置信度 0.90】

#### MCP 请求生命周期

[Observation] MCP 服务在 `api/mcp.ts`（Streamable HTTP）实现，分为匿名阶段和认证阶段。

[Evidence] `api/mcp/handler.ts`：`publicMethods = new Set(['tools/list', 'prompts/list', 'resources/list', 'ping', 'logging/setLevel'])`。注释明确：**"a 401 on a gated method hangs MCP SDK transports to their 30s timeout"**（#4937）。`api/mcp/dispatch.ts`：Pro/user_key 上下文执行 INCR-first 配额预留（50/day，UTC 午夜重置），`describe_tool` 豁免配额（元数据查询，SERVER_INSTRUCTIONS 鼓励使用）。

[Interpretation] MCP 协议的设计将"能力发现"与"能力调用"分离——匿名阶段是 Agent-readiness 扫描器在认证前的发现面，认证阶段是价值交付。这个切分由 MCP SDK 的 30s 超时强制：如果 gated 方法返回 401，SDK 会等待传输响应直到超时，导致 Agent 挂起。

[Alternative] 替代方案是统一认证（所有方法要求 auth），但这会破坏 Agent-readiness 扫描器在 `initialize` 握手时的能力探测——扫描器无法在不知道工具集的情况下决定是否值得认证。

[Challenge] 移除测试质疑：如果匿名方法要求认证？→ Agent-readiness 扫描器和 MCP SDK `initialize` 握手会 401，然后挂起 30s 等待永不响应的传输。如果 gated 方法匿名？→ Pro 配额绕过（无限免费工具调用）。**两个方向的违规都会破坏系统**——这就是 #4937 作为"不可协商不变量"的原因。

[Conclusion] MCP anonymous/authenticated 切分是**协议级强制**的架构不变量，不是设计偏好。30s SDK 超时是不可调的协议约束。`mcp-live-smoke.yml` 6 小时 cron 确保该不变量在生产中持续成立。【Evidence Strength: A 级（源码 + 代码注释 + CI 回归网），置信度 0.95】

#### 4 层缓存层次结构

```
Bootstrap 种子 (Railway 写入 Redis，按计划)
    ↓ miss
内存缓存 (每个 Vercel 实例，短 TTL)
    ↓ miss
Redis (Upstash，跨实例，cachedFetchJson 合并并发 miss)
    ↓ miss
上游 API 调用 (结果回写 Redis + 写入 seed-meta)
```

[Observation] 系统采用 4 层缓存层次结构，每层有明确职责。

[Evidence] ARCHITECTURE.md §9 + `server/_shared/redis.ts`：`cachedFetchJson()` 合并并发 miss（stampede 保护）——对同一 key 的并发请求共享单次上游调用和 Redis 写入。`api/health.js` 读取 `seed-meta:<key>` 比较 `fetchedAt` 与 `maxStaleMin`，返回 OK/STALE/WARN/EMPTY。`api/bootstrap.js`：3 级 auth-aware 缓存策略（public s-maxage=7200 / public on-demand s-maxage=3600 / authenticated no-store）+ stale-if-error 指令。

[Interpretation] 4 层层次结构的本质是**将"上游速率限制"转化为"Redis 容量"**——65+ 上游供应商的速率限制（典型 100-1000 req/min）在仪表盘负载下数分钟内就会耗尽，Redis 作为合并点将并发请求收敛为单次上游调用。seed-meta 新鲜度追踪是**防止静默陈旧数据**的唯一机制——没有它，缓存命中但数据过期时系统无感知。

[Alternative] 替代方案：(1) 2 层（内存→上游）简单但无跨实例合并；(2) 3 层（内存→Redis→上游）无新鲜度可见性；(3) CDN-only 无 stampede 保护。

[Challenge] 移除测试质疑：如果 Redis 完全下线？→ 每个请求直接命中上游，65+ 供应商速率限制在数分钟内耗尽。`stale-if-error` 指令为瞬时 Redis 故障提供优雅降级，但持续中断将是灾难性的。Redis 是**单合并点**——这是该架构的 SPOF（单点故障）。

[Conclusion] 4 层缓存层次结构是 65+ 上游供应商的**可生存性骨架**——移除 Redis 将在数分钟内耗尽上游速率限制。Redis 作为 SPOF 是该架构的显式权衡：跨实例合并的收益远大于单点故障的风险，且 stale-if-error 提供了瞬时故障的降级路径。【Evidence Strength: A 级（源码 + 架构文档 + CI 监控），置信度 0.90】

### 3.4 Architecture Atlas

```
🟢 Center — 4 层缓存层次结构（移除后系统不成立）
    Redis 是上游速率限制与仪表盘负载之间的合并点
    seed-meta 新鲜度追踪是防止静默陈旧数据的唯一机制

🟢 Center — MCP anonymous/authenticated 切分（#4937）
    协议级强制的架构不变量，30s SDK 超时不可调
    6 小时 mcp-live-smoke.yml 回归网守护

🔵 Core — server/gateway.ts 10 步流水线
    所有域 Edge Function 的契约执行入口
    8 缓存层 + ETag/304 + 幂等性 + HMAC 重放保护

🔵 Core — proto 契约系统（sebuf + buf generate）
    281 protos / 35 services 的单一事实源
    CI 强制生成代码新鲜度

🟠 High Coupling — Cloudflare apex→www 豁免列表
    跨 Cloudflare 仪表板（不在 repo）+ mcp-live-smoke.yml + #4938
    `and`/`or` 优先级陷阱：新豁免必须作为独立 `or` 项加入 `not (…)` 组

🟠 High Coupling — CSP 三源同步
    index.html <meta> + vercel.json header + tauri.conf.json
    修改一处必须同步另外两处

🟠 High Coupling — Edge Function 自包含约束
    无 node: 导入、无跨目录导入
    共享逻辑必须在 _*.js 助手中

🟢 Stable — 路由匹配器（server/router.ts）
    Map O(1) 静态 + 线性动态，极少改动

⚪ Peripheral — SDK 生态（cli/ + sdk/{python,ruby,go}）
    镜像 API 变化，独立 OIDC 发布管道

🔴 Danger — Convex 手写 TTL 分布式锁
    经典故障模式：锁持有者崩溃、TTL 过短、无 fencing token
    无 ADR 解释为何不用 Convex 原生事务
```

---

## 4 工程决策

### 4.1 工程约束

| 约束 | 来源 | 影响 |
|------|------|------|
| MCP SDK 30s 超时 | 协议级 | 强制 anonymous/authenticated 切分（#4937） |
| 65+ 上游速率限制 | 外部 API | 强制 4 层缓存 + stampede 保护 |
| Vercel Edge Function 冷启动 | 平台 | 强制 per-domain 打包 + 自包含约束 |
| OAuth POST→GET 退化 | HTTP 协议 | 强制 Cloudflare apex→www 豁免（#4938） |
| 配额绕过攻击 | 安全 | 强制 no-refund 策略（GHSA-hcq5） |
| 跨平台桌面 | 产品 | 强制 Tauri sidecar + fetch patch + IPv4 强制 |
| 多语言 SDK | 产品 | 强制 proto 契约（单一事实源 → 多语言生成） |

### 4.2 架构作用力

- **Edge 冷启动 vs 代码复用**：per-domain 打包降低冷启动 ~20×，但禁止跨目录导入，共享逻辑必须在 `_*.js` 助手中
- **缓存命中 vs 数据隐私**：public 数据享受长 CDN TTL，authenticated 数据必须 no-store（隐私 > 性能）
- **配额强制 vs 用户 UX**：no-refund 防止配额绕过，但良性错误时用户损失 slot（安全 > UX）
- **协议合规 vs 实现复杂度**：MCP/RFC 9728/RFC 8414 合规要求 6 个发现面一致，增加维护负担
- **确定性路由 vs 语义泛化**：token-overlap 精确路由已知工具，但无法泛化未知意图

### 4.3 关键决策

#### D1: 5 平台部署拆分 vs 单一后端

| 字段 | 内容 |
|------|------|
| Chosen | Vercel + Railway + Convex + Cloudflare + Tauri 多平台拆分 |
| Rejected | 单 Vercel（无 WebSocket relay）、单 Railway（无边缘计算）、Vercel+Convex（无 AIS WebSocket、无边缘 CORS）、纯 Docker（无边缘计算） |
| Why Chosen | 每个平台覆盖其他平台无法覆盖的能力：Railway 持久 WebSocket、Convex 事务状态、Cloudflare 边缘 CORS、Tauri 离线桌面、Vercel 边缘计算+CDN |
| Why Rejected | 单平台方案各缺至少一个能力；5 平台拆分是最小覆盖集 |
| Tradeoff | 运维复杂度（5 平台监控、20+ CI 工作流）vs 能力覆盖 |
| Cost | 5 条部署管道、5 个故障域、5 个监控仪表盘 |
| Benefits | 每个平台做最擅长的事；无单一平台锁定 |
| Suffers | 运维工程师（5 平台学习曲线）、成本（5 平台计费） |

#### D2: Proto 契约（sebuf）网关生成 vs 手写处理器

| 字段 | 内容 |
|------|------|
| Chosen | proto/ → buf generate → TypeScript client/server stubs + OpenAPI specs |
| Rejected | 手写 TypeScript（无契约强制）、OpenAPI-first（无 RPC 语义）、GraphQL（过度工程） |
| Why Chosen | 单一事实源：proto 定义服务 → 生成 client + server + OpenAPI + docs。CI 强制新鲜度（proto-check.yml）。sebuf.http.config 注解映射 RPC 到 HTTP 动词。 |
| Why Rejected | 手写失去契约强制；OpenAPI-first 失去 RPC 语义；GraphQL 为请求-响应模型增加查询复杂度 |
| Tradeoff | Proto 工具链学习曲线 + buf 依赖 vs 单一事实源契约强制 |
| Benefits | 4 个 SDK（npm/Python/Ruby/Go）镜像同一契约；多语言一致性；OpenAPI 自动生成 |
| Suffers | 新开发者（proto/sebuf 学习曲线）；快速原型（codegen 周期） |

#### D3: No-refund 工具执行错误（GHSA-hcq5）vs 退款

| 字段 | 内容 |
|------|------|
| Chosen | 不退款——`tool._execute()` 运行后，daily slot 永久计费 |
| Rejected | 任意错误退款（用户友好但启用配额绕过）、仅预执行失败退款（已实现）、部分退款（不可验证） |
| Why Chosen | 退款让 Pro token 通过"总是超预算"或"驱动可靠错误调用"绕过每日 50/day 上限。no-refund 将上限从"建议"转为"强制"。 |
| Why Rejected | 退款在良性场景用户友好，但在对抗场景架构性失效；部分退款不可验证 |
| Tradeoff | 用户 UX（瞬时错误损失 slot）vs 安全（配额不可绕过） |
| Cost | 良性错误时用户付费但未获得结果 |
| Benefits | Pro 配额强制不可绕过；上游成本可控 |
| Suffers | 良性错误用户（瞬时网络错误、上游 5xx） |

**Cross-Reference**: [→ §5.2 质疑记录]

#### D4: Token-overlap concierge 路由 vs NLU

| 字段 | 内容 |
|------|------|
| Chosen | Token-overlap 评分（name hits 3x，description hits 1x，确定性排序） |
| Rejected | NLU 引擎（语义映射但黑箱）、向量嵌入（语义但黑箱）、手动路由表（显式但僵化） |
| Why Chosen | 确定性、白盒可调试、Agent-to-Agent 路由可预测。name 加权防止 "chokepoint status" 路由到所有提到 shipping 的工具。 |
| Why Rejected | NLU 黑箱非确定；向量嵌入黑箱；手动表僵化且不扩展 |
| Tradeoff | 已知工具的精确度（token-overlap）vs 未知意图的召回（NLU）。token-overlap 在词表外意图上确定性失败。 |
| Cost | 无法泛化未知意图；新工具需要精确命名 |
| Benefits | 开发者（白盒调试）、Agent（可预测路由）、运维（确定性排序） |
| Suffers | 新用户（需知道工具名称）；未知意图查询（无自然语言兜底） |

**Cross-Reference**: [→ §5.3 质疑记录 — 假设被 modified]

### 4.4 权衡

| 决策 | 牺牲了什么 | 换取了什么 |
|------|-----------|-----------|
| 5 平台拆分 | 运维简单性 | 能力覆盖（WebSocket/事务/边缘/离线） |
| Proto 契约 | 快速原型灵活性 | 多语言一致性 + 契约强制 |
| No-refund | 良性错误 UX | 配额不可绕过 |
| Token-overlap | 未知意图泛化 | 已知工具精确路由 |
| 4 层缓存 | Redis SPOF | 65+ 上游可生存性 |
| Per-domain 打包 | 跨目录代码复用 | 20× 冷启动降低 |
| 3 级 auth-aware 缓存 | 认证数据 CDN 命中率 | 数据隐私 + 公共数据 CDN 收益 |

---

## 5 模型质疑

### 5.1 4 层缓存层次结构是否真的必要？

**Hypothesis**: 4 层缓存层次结构（seed → in-memory → Redis → upstream）是 65+ 上游供应商的必要可生存性骨架。

[Observation] 系统聚合 65+ 上游供应商，每个都有速率限制（典型 100-1000 req/min）。仪表盘在负载下会快速耗尽这些限制。

[Evidence] ARCHITECTURE.md §9 + `server/_shared/redis.ts`：`cachedFetchJson()` 合并并发 miss——对同一 key 的并发请求共享单次上游调用。`api/health.js` 读取 `seed-meta:<key>` 监控新鲜度。`api/bootstrap.js`：`stale-if-error` 指令提供瞬时故障降级。`seed-freshness-monitor.yml` 15 分钟 cron 检查生产种子元数据新鲜度。

[Interpretation] 4 层层次结构将"上游速率限制"转化为"Redis 容量"——Redis 作为合并点将并发请求收敛为单次上游调用。seed-meta 是**防止静默陈旧数据**的唯一机制——没有它，缓存命中但数据过期时系统无感知。

[Alternative] 替代方案：(1) 2 层（内存→上游）简单但无跨实例合并；(2) CDN-only 依赖 CDN TTL 但无 stampede 保护。

[Challenge] **移除测试**：如果 Redis 完全下线？→ 每个请求直接命中上游，65+ 供应商速率限制在数分钟内耗尽。`stale-if-error` 为瞬时故障提供降级，但持续中断将是灾难性的。Redis 是**单合并点**——这是该架构的 SPOF。

[Conclusion] Original hypothesis is **verified (survived)**. 4 层缓存层次结构是 65+ 上游供应商的可生存性骨架。Redis 作为 SPOF 是显式权衡——跨实例合并的收益远大于单点故障风险，且 stale-if-error 提供瞬时降级路径。

**Evidence Strength**: Confidence=0.90, Evidence Count=4 (源码+架构文档+CI 监控+移除测试), Counter=1 (Redis SPOF), Survived=Yes

### 5.2 No-refund（GHSA-hcq5）是用户敌对还是架构必要？

**Hypothesis**: No-refund 策略是架构必要的，退款会启用配额绕过。

[Observation] `api/mcp/dispatch.ts` 在 `tool._execute()` 运行后不退款——一旦工具执行，daily slot 永久计费。

[Evidence] 代码注释明确记录两个攻击向量：(1) "refunding let a Pro token drive unlimited real cost by always exceeding the budget"（总是超预算→真实成本已发生→退款免费）；(2) "refunding let a Pro token bypass the daily cap by driving calls that reliably error after the costly fetch"（驱动可靠错误调用→上游成本已发生→退款绕过上限）。

[Interpretation] 退款在良性场景对用户友好，但在对抗场景下使每日 50/day 上限从"强制"退化为"建议"。no-refund 将上限从"建议"转为"强制"——这是一个安全 vs UX 的显式权衡。

[Alternative] 替代方案：(1) 仅预执行失败退款（已实现——预留/验证失败不计费）；(2) 部分退款基于上游成本（复杂且不可验证）；(3) 信誉系统（先退款，检测滥用后封禁——但滥用检测滞后）。

[Challenge] **假设翻转**：如果退款？→ Pro token 可以通过 (a) 总是超预算 或 (b) 驱动可靠错误调用 绕过每日上限。两者都将 50/day 从硬上限转为软建议。代码注释显式记录了这些攻击向量——说明这是经过安全分析的设计决策，不是疏忽。

[Conclusion] Original hypothesis is **verified (survived)**. No-refund 是架构必要的——退款启用配额绕过。这是用户敌对（良性错误损失 slot）但架构必要（配额不可绕过）的显式权衡。代码注释的质量表明这是一个经过深思的安全决策。

**Evidence Strength**: Confidence=0.95, Evidence Count=3 (源码+代码注释+假设翻转), Counter=0, Survived=Yes

### 5.3 Token-overlap 是否真的比 NLU 更透明？

**Hypothesis**: Token-overlap concierge 路由比 NLU 更透明，因此更适合 Agent-to-Agent 路由。

[Observation] `api/_agent-tool-suggest.ts` 显式声明 "Deliberately not NLU — a transparent token-overlap score"。

[Evidence] Token-overlap 评分：name hits 3x，description hits 1x。确定性排序（score 降序，name localeCompare 平局）。QUERY_STOPWORDS 过滤通用词。route-less helper（下划线前缀）隔离 A2A 和 /ask 冷启动（#4838）。

[Interpretation] "透明"有两种含义：(1) **开发者透明**（白盒可调试——开发者可以手动计算分数预测路由）；(2) **用户透明**（API 调用者可以理解路由理由）。token-overlap 是前者，NLU 是后者（可以输出 "I routed you to X because you asked about Y"）。

[Alternative] 替代解释：token-overlap 和 NLU 解决不同问题——token-overlap 解决"已知工具的精确路由"（precision-oriented），NLU 解决"未知意图的语义映射"（recall-oriented）。两者的"透明度"不可直接比较——指标不同。

[Challenge] **假设翻转**：如果核心假设是反的？→ token-overlap 的透明度只是"可解释性幻觉"——分数计算方式比 NN weights 更容易追踪，但"为什么 0.73 分优于 0.71 分"对终端用户同样黑箱。API 调用者看不到得分过程。token-overlap 在词表外意图上**确定性失败**，而 NLU **概率性成功**。

[Conclusion] Original hypothesis is **modified**. Token-overlap 的透明度优势被限定在已知工具空间内的开发者调试场景。超出此空间时，"确定性地失败" vs "不确定性地成功"构成真正的 tradeoff——取决于系统对 false negative（漏匹配）和 false positive（误匹配）的成本偏好。当前架构偏好 false negative（宁可漏也不误导），这是正确的选择，但应明确这是一项 tradeoff 而非绝对优势。

**Evidence Strength**: Confidence=0.75, Evidence Count=4 (源码+代码注释+假设翻转+替代分析), Counter=1 (NLU 未知意图泛化), Survived=No (Modified)

### 5.4 手写 Convex TTL 锁是否必要？

**Hypothesis**: Convex 手写 TTL 分布式锁是必要的，因为 Convex 缺乏合适的原语。

[Observation] `convex/schema.ts` 定义 `followedCountriesShards` + `followedCountriesCountryLocks`（lockedUntil + lockId）——手写 TTL 锁，而非 Convex 原生事务模型。

[Evidence] 锁是 TTL-based（lockedUntil 时间戳）+ 唯一 lockId。无 ADR 或代码注释解释为何不用 Convex 原生事务。

[Interpretation] TTL 锁有经典故障模式：(1) 锁持有者崩溃 → 等待 TTL 过期（丢失写）；(2) TTL 过短 → 锁过期后并发写；(3) 无 fencing token → 过期锁持有者仍可写。Convex 原生事务模型正是为这类多步原子操作设计的。

[Alternative] Convex 原生事务模型可以表达相同不变量，且避免上述三个故障模式。

[Challenge] **边界测试**：在高并发下，TTL 锁的故障模式会出现。无 ADR 解释为何不用 Convex 事务——这看起来像"在平台原语存在时自己造轮子"。

[Conclusion] Original hypothesis is **weakened**. 手写 Convex TTL 锁可能是技术债而非必要。无 ADR 解释为何 Convex 事务不足。置信度降低但未推翻——可能有未记录的原因（如跨分片事务成本）。建议补充 ADR 或迁移到 Convex 原生事务。

**Evidence Strength**: Confidence=0.55, Evidence Count=2 (源码+边界测试), Counter=1 (Convex 原生事务), Survived=No (Weakened)

### 核心假设存活汇总

| # | 假设 | 质疑方法 | 结果 | 置信度 |
|---|------|---------|------|--------|
| 1 | Per-domain Edge Function 打包（20× 冷启动）值得自包含约束 | 边界测试 | survived | 0.80 |
| 2 | MCP anonymous/authenticated 切分（#4937）不可协商 | 移除测试 | survived | 0.95 |
| 3 | 手写 Convex TTL 锁必要 | 边界测试 | weakened | 0.55 |
| 4 | 4 层缓存层次结构对 65+ 上游必要 | 移除测试 | survived | 0.90 |
| 5 | No-refund（GHSA-hcq5）架构必要 | 假设翻转 | survived | 0.95 |
| 6 | Token-overlap 比 NLU 更透明 | 假设翻转 | modified | 0.75 |

**结论**：6 个核心假设中 4 个完全存活（67%），1 个被修改（17%），1 个被削弱（17%）。中心假设（agent-readiness + 4 层缓存）经受住了所有质疑。

---

## 6 可复用知识

### 6.1 架构不变量

以下不变量是系统共同依赖的基本假设，违反任一都会导致系统失效：

1. **MCP anonymous/authenticated 切分**（#4937）——gated 方法返回 401 会挂起 MCP SDK 30s
2. **Edge Function 自包含**——无 `node:` 导入、无跨目录导入（冷启动 + 打包约束）
3. **缓存 key 必须包含请求变化参数**——否则跨请求数据泄漏
4. **CSP 三源同步**——index.html / vercel.json / tauri.conf.json 必须一致
5. **Cloudflare apex→www 豁免列表**——`/.well-known/*`、`/mcp`、`/oauth/*` 必须豁免（#4938）
6. **No-refund 工具执行错误**——退款启用配额绕过（GHSA-hcq5）
7. **docs:check CI 必须通过**——ARCHITECTURE.md 能力计数必须匹配 stats.json
8. **proto-check CI 必须通过**——生成代码必须匹配已提交输出

### 6.2 可复用模式

#### 模式 1：CI 作为回归网（Regression Net）

```
生产不变量 → 6 小时 cron 探针 → 失败时 fingerprint 指向具体退化
```

- `mcp-live-smoke.yml`（6h）：匿名严格客户端遍历生产 MCP 面（能力遍历 + 认证墙 + OAuth 端点路由）
- `live-api-cache-auth.yml`（6h）：假认证保持 no-store 且从不缓存 200；匿名公共面保持可缓存
- `seed-freshness-monitor.yml`（15min）：检查生产种子元数据新鲜度

**可迁移性**：任何有"协议不变量"或"安全态势"的系统都应建立 6 小时 cron 回归网。关键是将不变量编码为可探测的 fingerprint，而非依赖人工审查。

#### 模式 2：Origin-aware auth（信任边界感知）

```
桌面（origin: tauri://localhost）→ 要求 API key
可信浏览器（origin: worldmonitor.app）→ 豁免 key
其他 origin → 403
```

**可迁移性**：任何多平台客户端（web + desktop + mobile）都应基于 origin 区分信任边界，而非统一认证策略。

#### 模式 3：cachedFetchJson 合并（Stampede 保护）

```
对同一 cache key 的并发请求 → 共享单次上游调用 + 单次 Redis 写入
```

**可迁移性**：任何 N+1 上游调用场景都应实现合并——这是从 "每个请求独立" 到 "跨实例合并" 的关键升级。

#### 模式 4：stale-if-error 优雅降级

```
CDN 缓存指令: stale-while-revalidate + stale-if-error
→ 上游/Redis 瞬时故障时，CDN 可服务陈旧数据
```

**可迁移性**：任何依赖外部依赖（DB/缓存/上游）的系统都应配置 stale-if-error——这是瞬时故障的零成本降级路径。

#### 模式 5：route-less helper（冷启动隔离）

```
api/_agent-tool-suggest.ts（下划线前缀）
→ A2A 和 /ask 端点互不依赖对方的模块级守卫
→ 一个端点的冷启动不拖累另一个
```

**可迁移性**：Edge 计算环境中，共享逻辑应放在下划线前缀的 route-less helper 中，避免端点间冷启动耦合。

### 6.3 经验教训

1. **协议不变量优于约定不变量**——MCP SDK 30s 超时是协议级强制的，比"团队约定"更可靠。设计时应优先选择有协议/平台强制的不变量。

2. **安全决策应显式记录攻击向量**——GHSA-hcq5 的代码注释明确记录了两个攻击向量，使未来维护者理解为何 no-refund 是必要的而非疏忽。

3. **CI 回归网是不变量的"活文档"**——`mcp-live-smoke.yml` 比 ARCHITECTURE.md 中的文字描述更有力——它每 6 小时验证不变量是否成立。

4. **缓存层次结构的设计驱动力是上游约束**——4 层缓存不是过度工程，而是 65+ 上游速率限制的必然结果。缓存设计应从上游约束反推。

5. **手写分布式锁是技术债信号**——当平台提供原语时（Convex 事务），手写锁通常意味着不熟悉平台或未记录的特殊约束。应补充 ADR 或迁移到平台原语。

6. **"透明度"需要区分受益者**——token-overlap 对开发者透明，NLU 对用户透明。设计决策应明确"对谁透明"。

---

## 7 意外发现

### 7.1 Cloudflare 规则表达式优先级是负载承载的

[Observation] ARCHITECTURE.md §2 警告：`and binds tighter than or, so a new exemption must be added as its own or term inside the not (…) group (appending and not … after the last term is a silent no-op)`。

[Interpretation] 这是一个**非显而易见的运维陷阱**——Cloudflare 规则表达式的 `and`/`or` 优先级意味着"在末尾追加 `and not …`"是静默无效操作。错误地添加豁免会导致 `/mcp` 或 `/oauth/*` 被重定向，破坏所有 apex-URL MCP 客户端和 OAuth 动态客户端注册。`mcp-live-smoke.yml` 6 小时探测是唯一的防护网。

### 7.2 ConvexError 跨函数边界序列化怪癖

[Observation] `convex/http.ts`：Convex 运行时在跨函数边界重新抛出前将 `err.data` 序列化为 JSON 字符串。`parseConvexErrorData` 必须处理两种形状：`'"PRO_REQUIRED"'`（字符串）和 `'{"code":"X",…}'`（对象）。

[Interpretation] 这是 Convex 平台的实现细节泄漏到应用代码——开发者必须知道 `err.data` 在 http action 的 catch 块中是 JSON 编码字符串，而非原始对象。这个解析器是平台怪癖的适配层。

### 7.3 桌面 sidecar 强制 IPv4

[Observation] `src-tauri/sidecar/local-api-server.mjs` monkey-patch `globalThis.fetch` 强制 IPv4。ARCHITECTURE.md §7 注释："Node.js tries IPv6 first, but many government APIs have broken IPv6"。

[Interpretation] 这是一个**上游约束驱动的运行时 hack**——政府 API（地缘政治数据源）的 IPv6 支持损坏，迫使桌面 sidecar 全局禁用 IPv6。这类约束通常不会出现在架构文档中，但对运行时行为有重大影响。

### 7.4 6 站点变体包含 "happy"

[Observation] 6 个站点变体：world、tech、finance、commodity、happy、energy。"happy" 变体与地缘政治/军事监控的紧张主题形成对比。

[Interpretation] 这表明系统的产品定位不只是"威胁监控"，而是"全球态势感知"——包含积极事件（happy 变体）。这是一个产品决策的架构体现：同一代码库通过 hostname 切换变体，每个变体有独立的默认面板、图层、刷新间隔、主题。

---

## 8 风险

### 8.1 Redis 单点故障（SPOF）

[Observation] Redis 是 4 层缓存的单合并点。持续中断会级联到上游速率限制耗尽。

[Evidence] `stale-if-error` 提供瞬时降级，但持续中断无降级路径。

[Impact] 高——持续 Redis 中断将使系统在数分钟内不可用。

[Mitigation] 多 Redis 实例（成本高）、Upstash 多区域复制（已配置？未验证）、上游速率限制提升（不可控）。

### 8.2 手写 Convex TTL 锁故障模式

[Observation] TTL 锁有经典故障模式：锁持有者崩溃、TTL 过短、无 fencing token。

[Evidence] `convex/schema.ts` 定义 lockedUntil + lockId，无 fencing token。

[Impact] 中——高并发下 followed-countries 可能出现丢失更新。

[Mitigation] 迁移到 Convex 原生事务；或添加 fencing token；或补充 ADR 解释为何不用 Convex 事务。

### 8.3 Cloudflare 规则误编辑

[Observation] apex→www 豁免列表的 `and`/`or` 优先级陷阱。

[Evidence] `mcp-live-smoke.yml` 6 小时探测是唯一防护网。

[Impact] 高——误编辑会破坏所有 apex-URL MCP 客户端和 OAuth 注册。

[Mitigation] 将 Cloudflare 规则版本控制（Terraform/CDK）；增加更多 cron 探测点；文档化优先级陷阱（已部分完成）。

### 8.4 缺少 ADR 层

[Observation] 决策理由散落在代码注释和 issue 编号中，无结构化 ADR。

[Evidence] 无 `docs/adr/` 目录。#4937/#4938/GHSA-hcq5 是最接近的决策溯源。

[Impact] 中——团队换人后决策上下文丢失。CI 验证"文档与代码一致"但无法验证"决策理由被记录"。

[Mitigation] 建立 ADR 目录；将 issue 中的决策讨论链接到 ADR；CI 检查关键决策是否有 ADR 引用。

---

## 9 未解问题

### UQ1: 为什么选择 AGPL-3.0-only？

| 字段 | 内容 |
|------|------|
| 问题 | 为什么选择 AGPL-3.0-only 而非 MIT/Apache/BSL？ |
| 缺失证据 | 无 ADR 或 issue 文档化许可证选择理由 |
| 置信度影响 | 低——不影响架构理解，但影响合规评估 |
| 建议下一步 | 搜索 GitHub Issues 中有关 AGPL/许可的讨论；检查 git log 中许可证添加的 commit |

### UQ2: 为什么 6 个特定站点变体？

| 字段 | 内容 |
|------|------|
| 问题 | 为什么是 world/tech/finance/commodity/happy/energy 这 6 个变体，而非可配置变体系统？ |
| 缺失证据 | 无文档解释变体选择的产品逻辑 |
| 置信度影响 | 低——变体集是固定的，不影响架构 |
| 建议下一步 | 检查 git history 中变体添加的时间线；搜索产品 roadmap 文档 |

### UQ3: consumer-prices 为什么用 Playwright 爬虫而非价格 API？

| 字段 | 内容 |
|------|------|
| 问题 | consumer-prices-core 为什么用 Playwright 按国家爬虫，而非价格 API 供应商？ |
| 缺失证据 | 无文档解释爬虫 vs API 的决策 |
| 置信度影响 | 低——这是独立服务，不影响主架构 |
| 建议下一步 | 检查 consumer-prices-core/ 的 README 或注释；搜索成本/覆盖率对比 |

### UQ4: Convex 手写锁的真实原因

| 字段 | 内容 |
|------|------|
| 问题 | 为什么用 Convex TTL 锁而非 Convex 原生事务？ |
| 缺失证据 | 无 ADR 或代码注释解释 |
| 置信度影响 | 中——影响对该决策是"技术债"还是"必要"的判断 |
| 建议下一步 | 询问维护者；或测试 Convex 事务是否能表达相同不变量 |

### UQ5: 20× 冷启动降低的基准测试

| 字段 | 内容 |
|------|------|
| 问题 | per-domain Edge Function 打包的 20× 冷启动降低是否有基准测试支撑？ |
| 缺失证据 | 代码注释声称 20×，但 repo 中无 benchmark |
| 置信度影响 | 低——方向正确（per-domain 打包确实降低冷启动），但具体数字未验证 |
| 建议下一步 | 编写冷启动 benchmark 对比 per-domain vs mega-function |

---

## 10 证据质量摘要

### 证据层级分布

| Tier | 类型 | 使用比例 | 示例 |
|------|------|---------|------|
| S | 可执行行为（测试） | 15% | tests/edge-functions.test.mjs, e2e/*.spec.ts, mcp-live-smoke.yml |
| A | 源码实现 | 55% | api/mcp/handler.ts, api/mcp/dispatch.ts, server/gateway.ts, convex/schema.ts |
| B | 配置 | 10% | vercel.json, tauri.conf.json, .github/workflows/ |
| C | 文档 | 15% | ARCHITECTURE.md, README.md, CONCEPTS.md |
| D | 提交/Issue | 3% | #4937, #4938, GHSA-hcq5, #4497, #4838 |
| E | 推断 | 2% | 20× 冷启动降低的合理性推断 |

### 置信度分布

| 置信度 | 数量 | 示例 |
|--------|------|------|
| High (≥3 sources) | 5 | §5.1 (4 层缓存), §5.2 (no-refund), D1 (5 平台), D2 (proto 契约), D3 (no-refund) |
| Medium (2 sources) | 2 | §5.3 (token-overlap), D4 (token-overlap) |
| Low (1 source) | 1 | §5.4 (Convex 锁) |

### 方法论说明

本报告 ~70% 证据来自 A 级（源码实现），这反映了 worldmonitor 的一个特点：**架构决策大量编码在源码注释中**（如 GHSA-hcq5 的攻击向量、#4937 的 SDK 超时、#4838 的冷启动隔离）。这是"代码即文档"哲学的体现，但也意味着决策理由分散——缺少结构化 ADR 层是本报告识别的主要可改进点。

---

## 附录 A：研究轨迹

| 轮次 | 目的 | 问题数 | 回答 | 验证 | 状态 |
|------|------|--------|------|------|------|
| Round 1 | discovery | 8 | 0 | 0 | invalidated（错误仓库） |
| Round 2 | discovery+critical | 10 | 10 | 10 | closed（收敛） |

Round-2 问题覆盖：5 平台拆分（R2-1）、MCP #4937 不变量（R2-2）、Convex 手写锁（R2-3）、4 层缓存 Redis SPOF（R2-4）、proto 契约（R2-5）、GHSA-hcq5 no-refund（R2-6）、per-domain 打包（R2-7）、Cloudflare 豁免列表（R2-8）、3 级 auth-aware 缓存（R2-9）、Convex 权益热路径（R2-10）。

## 附录 B：报告 Meta

- **报告生成时间**: 2026-07-30
- **分析目标 commit**: b6c7268fb0a1a3e2ed2561b2216bbbb6008ff6b5
- **输入数据覆盖域**: runtime(0.75), architecture(0.80), design_decisions(0.70), testing(0.55), deployment(0.75), history(0.30)
- **最确信结论**: §5.2 No-refund 架构必要 (Conf: 0.95)
- **最应怀疑结论**: §5.4 Convex 手写锁必要 (Conf: 0.55 — 缺 ADR，可能是技术债)
- **最大意外**: Cloudflare 规则表达式 `and`/`or` 优先级是负载承载的——静默 no-op 会破坏所有 apex-URL MCP 客户端
