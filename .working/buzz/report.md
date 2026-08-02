# Buzz 架构研究报告

> **架构中心**：Buzz 用 Nostr 协议的签名事件模型统一所有 surface（chat/forum/DM/workflow/git/voice），但放弃 Nostr 的 P2P gossip 特性，让 buzz-relay 成为单逻辑真相源——用"放弃去中心化"换取 multi-tenant 隔离的中央权威边界、hash-chain audit 的单写入点、channel-membership 访问控制的统一执行。
>
> **最大 trade-off**：单 tokio runtime 承载所有 workload 是"single-binary self-hostable"硬约束的直接后果，但带来 voice frame + event pipeline + git clone 共享 worker threads 的 head-of-line blocking 风险——这是 production SLO 的主要 risk。
>
> **分析 commit**：`1e6e743a3570` · **报告基于** [architecture-narrative.json](file:///Users/saga/code-repos/devweekly.github.io/.working/buzz/architecture-narrative.json) 渲染

---

## 1. Executive Summary

Buzz 是 Block, Inc. 的 self-hostable Nostr-based team workspace。它的架构选择是反直觉的：**保留 Nostr 协议但放弃 Nostr 的 P2P 特性**。所有 action（消息/reaction/workflow step/git event/voice event）是签名 Nostr event，kind 整数是唯一分发开关；但所有 read/write 流经单逻辑 buzz-relay per community，没有 gossip、没有多 relay 复制。这个 trade-off 是 multi-tenant 隔离、hash-chain audit 完整性、channel-membership 访问控制三者的必要条件——若去掉单 relay 真相源，三者同时崩塌。系统由 27 个 Rust crate 组成 layered architecture，buzz-relay 是唯一 composition root。最显著的工程亮点是 TLA+/Tamarin 形式化验证 multi-tenant isolation 协议层 + redteam test 验证 fence；最显著的风险是单 tokio runtime 共享所有 workload 的 head-of-line blocking。

---

## 2. Architecture Thesis

### 2.1 Central Idea

> **Buzz 用 Nostr 协议的签名事件模型统一所有 surface，但放弃 Nostr 的 P2P gossip 特性，让 buzz-relay 成为单逻辑真相源。**

**If removed**：如果去掉"单 relay 作为真相源"，系统的三个核心属性同时崩塌：

1. **Multi-tenant 隔离失去中央权威边界**——row-zero host binding 无法强制执行，客户端可绕过单 relay 路由
2. **Hash-chain audit log 失去单写入点保证**——多 relay 并发写入无法串联链
3. **Channel-membership 访问控制失去统一执行点**——任何 relay 都可能泄露 channel-scoped event 给未授权订阅者

系统退化为标准 Nostr P2P，失去 enterprise 可用性。

*confidence: 0.85 · evidence_level: A (Code+Test) · evidence: [evidence-log.jsonl:1-3](file:///Users/saga/code-repos/devweekly.github.io/.working/buzz/evidence-log.jsonl)*

### 2.2 Driving Constraints

5 个硬约束塑造了 Buzz 架构。这些不是 feature，是被迫做出的约束——每个都迫使系统做出特定决策。

#### C-1: Multi-tenant isolation must be proven, not asserted

多租户隔离是 production-critical security，不能依赖 code review 主观判断。**迫使系统**：(a) 在任何 handler 观察数据前完成 row-zero host→community 绑定（fail-closed，无 default）；(b) 用 TLA+/Tamarin 形式化验证协议层 + redteam test 验证 fence；(c) SQL 层 community_id 覆盖全部数据访问路径（20 文件 1264 次）。"proven, not asserted" 是硬约束，不是 feature。

*confidence: 0.88 · evidence_level: S (Code+Test+Formal) · evidence: evidence-log.jsonl:4-6*

#### C-2: Hash-chain audit log tamper-evidence

Audit 必须可证明未被篡改，合规要求。**迫使系统**：(a) 单写入点（buzz-relay）保证链完整性——audit 不能分布式写入；(b) audit 作为独立 subsystem 直接 sqlx + 自有 pool，不依赖 buzz-db——避免 db 故障影响 audit；(c) event 写入与 audit append 在同一 pipeline 强制串联（step 11），fire-and-forget 但不可跳过。

*confidence: 0.80 · evidence_level: B (Code only) · evidence: evidence-log.jsonl:18*

#### C-3: Nostr NIP-01 wire compatibility

客户端生态兼容性，不能破坏现有 Nostr 客户端。**迫使系统**：(a) kind 整数作为唯一分发开关——新功能 = 新 kind = 零破坏；(b) standard NIP kind range (0-9999) 不修改；(c) 自定义 kind 集中在 40000-49999 + ALL_KINDS 数组 + CI duplicate test 强制无 collision。扩展机制受 Nostr 协议约束，不能用 runtime plugin 或破坏性 schema 变更。

*confidence: 0.84 · evidence_level: A (Code+Test) · evidence: evidence-log.jsonl:16-17*

#### C-4: Single-binary self-hostable + multi-pod scalable

同一份代码必须支持 N=1 自托管和 N>1 横向扩展，且 N=1 不引入额外复杂度。**迫使系统**：(a) 单 tokio runtime 承载所有 workload——多 runtime 会增加 N=1 部署复杂度；(b) Redis pub/sub 作为多 pod 协调层，BUZZ_MESH=off 时单实例 byte-identical；(c) buzz-relay-mesh (iroh QUIC) 作为 opt-in session transport，不强制 N=1 部署启用。这是 deployment-driven 硬约束。

*confidence: 0.82 · evidence_level: B (Code only) · evidence: evidence-log.jsonl:1-3, 9-10*

#### C-5: Humans and agents as first-class equals

Agents 不是 bots，是 channel 成员，同 keypair + 同 audit trail + 同 surface area。**迫使系统**：(a) 统一 identity model（secp256k1 keypair + NIP-05 handle + NIP-42/NIP-98 auth）；(b) channel membership 是唯一 access gate，binary authenticated-or-not + role-based；(c) agents 通过 MCP/buzz-cli 访问 relay 全部 feature surface，无降级 surface。

*confidence: 0.75 · evidence_level: B (Code only) · evidence: artifacts/repository-profile.json:auth_model*

---

## 3. Key Design Decisions

> **Architecture 是 Decision 的结果，不是先看结构再解释为什么。** 以下 5 个决策是 Buzz 架构的核心——每个绑定一个 Driving Constraint，每个有被拒绝的替代方案。

### DD-1: 选择单逻辑 relay per community 作为 single source of truth

- **Implements**: C-1 + C-2 + C-3
- **Context**: Nostr 原生是多 relay P2P gossip。Buzz 需要 multi-tenant 隔离 + audit 完整性 + access control。
- **Rejected Alternative**: 标准 Nostr 多 relay P2P gossip——客户端聚合多 relay 结果
- **Trade-off**: 用放弃 P2P 去中心化特性换取 multi-tenant 隔离中央权威边界 + hash-chain audit 单写入点 + channel-membership 统一执行。Nostr 协议被保留是因为签名事件模型和客户端兼容性（C-3），而非 P2P 特性。多 pod 横向扩展通过 Redis pub/sub + 共享 Postgres 实现，buzz-relay-mesh (iroh QUIC) 承载 session traffic（huddle/tunnel）非事件复制。
- *confidence: 0.85 · evidence_level: A (Code+Test) · evidence: evidence-log.jsonl:1-3*

### DD-2: Multi-tenant 隔离通过 URL host binding + SQL community_id WHERE

- **Implements**: C-1
- **Context**: 一个 relay 部署可托管多 community，共享 Postgres/Redis/S3。
- **Rejected Alternative**: schema-level 隔离（每 community 独立 schema）或 Postgres Row-Level Security (RLS)
- **Trade-off**: 用 SQL 漏写 community_id 的潜在风险换取：(+) 共享池资源利用率高；(+) 新 community 仅 DB write + DNS route；(+) 已有 TLA+/Tamarin 形式化验证协议层。**Gap**：SQL community_id 覆盖是 conventional（无 macro/lint 强制），依赖 code review + buzz-conformance 测试。这是 protocol-level formal verification 与 SQL-level conventional coverage 之间的 known gap。
- *confidence: 0.88 · evidence_level: S (Code+Test+Formal) · evidence: evidence-log.jsonl:4-6*

### DD-3: 子系统通过 Cargo 依赖图 + layered architecture 组织

- **Implements**: C-2 + 可维护性
- **Context**: 需要避免子系统耦合导致循环依赖和测试困难。
- **Rejected Alternative**: 严格 hexagonal architecture（端口适配器）或 microservice 拆分
- **Trade-off**: 用部分子系统耦合（buzz-pubsub→buzz-auth, buzz-workflow→buzz-db）换取：(+) Cargo 编译期强制无循环依赖；(+) buzz-search/buzz-audit 直接 sqlx 避免 query 需求污染 db abstraction；(+) buzz-relay 唯一 composition root 测试清晰。ARCHITECTURE.md 声称 "subsystems are isolated" 是过度简化，实际是 layered architecture——但这个简化可接受，因为无循环依赖 + 无跨层反向引用。
- *confidence: 0.82 · evidence_level: A (Code+Test) · evidence: evidence-log.jsonl:7-8*

### DD-4: 单 tokio runtime 承载所有 workload

- **Implements**: C-4
- **Context**: Rust monolith，需要简化部署和共享状态。
- **Rejected Alternative**: 多 runtime（voice 独立 pool）或多进程 microservice
- **Trade-off**: 用 voice frame 与 event pipeline 共享 worker threads 的 head-of-line blocking 风险换取：(+) 共享 AppState 简单；(+) 单 binary 部署；(+) 无 IPC 开销。**这是 C-4（single-binary self-hostable）的直接后果**——多 runtime 会增加 N=1 部署复杂度。Mitigation: connection semaphore + SLOW_CLIENT_GRACE_LIMIT(3) + mesh datagram drop-on-full。但这是 production SLO 的主要 risk（见 R-1）。
- *confidence: 0.85 · evidence_level: B (Code only) · evidence: evidence-log.jsonl:9-10*

### DD-5: Kind registry 通过 centralized const + ALL_KINDS + CI duplicate test

- **Implements**: C-3
- **Context**: Nostr kind 整数是有限资源，需要避免 collision。
- **Rejected Alternative**: runtime registry（动态注册）或 plugin 机制或 range 分配文档化 governance
- **Trade-off**: 用无 runtime 扩展（需 recompile）换取：(+) 编译期强制无重复；(+) const 编译期内联性能；(+) 简单。子 range 划分（40000-40999 stream, 41000-41999 DM, 45000-45999 forum, 46000-46999 workflow）无 lint 强制，依赖 code review。Trade-off 可接受——40000-49999 range 足够大，duplicate test 防最严重 collision。
- *confidence: 0.84 · evidence_level: A (Code+Test) · evidence: evidence-log.jsonl:16-17*

---

## 4. Resulting Architecture

> 架构是上述 5 个 Decision 的结果。本章按"为什么存在"组织边界，而非 crate 命名清单。

### 4.1 Boundaries

#### B-1: Tenant Boundary（implements DD-2）

**为什么存在**：因为 C-1（multi-tenant isolation must be proven）。URL host 是 authoritative——`req.community = resolve_host(connection.host)` 在任何 handler 观察数据前完成，fail-closed，无 default/fallback。这个边界不是 filter，是 **hard gate**——unknown host 拒绝，empty host 拒绝，lookup error 拒绝。redteam_attack2 测试验证 empty host 即使 DB 有空 host 行也 fail closed。Boundaries 内：community_id WHERE 子句覆盖全部 SQL（1264 次/20 文件）。

*evidence_level: S (Code+Test+Formal)*

#### B-2: Subsystem Boundary（implements DD-3）

**为什么存在**：因为 C-2（audit integrity）+ 可维护性。buzz-search/buzz-audit 不依赖 buzz-db——避免 search/audit 的 query 需求污染 db abstraction，同时保证 audit 故障隔离（C-2）。buzz-pubsub 依赖 buzz-auth（for AuthContext types），buzz-workflow 依赖 buzz-db（for reading events）——这是 layered dependency 非 strict isolation。Cargo 依赖图 compile-time 强制无循环。

*evidence_level: A (Code+Test)*

#### B-3: Protocol Boundary（implements DD-5）

**为什么存在**：因为 C-3（Nostr wire compatibility）。kind integer 是唯一分发开关——standard NIP kinds (0-9999) + replaceable (10000-19999) + ephemeral (20000-29999, 不存储不审计) + parameterized replaceable (30000-39999) + Buzz custom (40000-49999)。**ephemeral boundary 是 protocol-level 性能优化**——presence/typing bypass DB/audit/search 避免 600K events/day 压垮持久层。

*evidence_level: A (Code+Test)*

#### B-4: Security Boundary — Global Sub Exclusion（implements DD-1 + DD-2）

**为什么存在**：因为 C-1 + C-5。Global subscriptions（无 channel_id 约束）被 excluded from channel-scoped events——这是 deliberate security boundary，只有 scoped to accessible channel_id 的 subscription 接收 channel-scoped events。防止 private channel event 通过 global subscription 泄露。

*evidence_level: B (Code only)*

#### B-5: Internal API Boundary（supports C-1）

**为什么存在**：defense in depth。`/internal/git/policy` localhost-only + HMAC auth + 1MB body limit——pre-receive hook 通过 localhost HMAC 调用 policy callback，防止外部直接访问。这是 git hosting 的安全边界，确保 push policy 不可绕过。

*evidence_level: B (Code only)*

### 4.2 Extension Mechanism

扩展哲学是 **"protocol-first, code-second"**——新功能通过新增 Nostr kind 实现，而非新增 endpoint 或 schema。[buzz-core/src/kind.rs](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-core/src/kind.rs) 是 protocol 的代码化身，`ALL_KINDS` 是 registry，`no_duplicate_kind_values` test 是 collision guard。

核心优势：**relay 不需要升级就能 forward 新 kind event**，只有需要 active 处理的客户端/agent 需要升级。客户端通过 "unknown kind 忽略" 语义保证向后兼容。

Workflow engine 在此之上提供 trigger-based 扩展（监听 kind → 执行 YAML），但 workflow execution kinds (46001-46012) 被 excluded 防止循环。Agent surface 通过 MCP/buzz-cli 暴露全部 feature——agents 不是二等公民，是 first-class channel 成员（C-5）。

**VISION 与实现的 gap**：NIP-34 kind（PATCH/PR/ISSUE/STATUS/REPO_ANNOUNCEMENT）已定义，但 side_effects.rs 仅 active 处理 REPO_ANNOUNCEMENT。VISION 描述的 "branch as room"（branch→channel auto-creation + CI/review/merge in channel）未实现——这是 aspirational feature，不是 shipping gap。

---

## 5. Runtime Realization

### 5.1 One Request Story — 用户发送一条 Stream Message

> 这个请求穿越所有 5 个 Driving Constraint。每步说明对应哪个架构约束。

```mermaid
sequenceDiagram
    participant U as User Client
    participant R as buzz-relay
    participant T as TenantResolver
    participant A as AuthService
    participant D as buzz-db (Postgres)
    participant P as Redis pub/sub
    participant S as SearchService
    participant AU as AuditService
    participant W as WorkflowEngine
    participant Other as Other pod subscribers

    U->>R: WebSocket connect ws://myproject.com
    R->>T: bind_community("myproject.com")
    T-->>R: TenantContext{community_id:42}  ❰ C-1: row-zero gate, fail-closed ❱
    R->>U: ["AUTH", "<challenge>"]
    U->>R: ["AUTH", <signed_event>]
    R->>A: verify NIP-42 Schnorr sig
    A-->>R: AuthContext{pubkey, scopes}  ❰ C-5: identity proof ❱
    U->>R: ["EVENT", <kind:9 stream msg, signed>]
    Note over R: Step 2: pubkey match (event.pubkey == auth.pubkey?)
    Note over R: Step 3: kind != 22242 (no AUTH store)
    Note over R: Step 4: kind 9 not ephemeral → storage path
    R->>R: spawn_blocking(verify_event)  ❰ CPU-bound isolation ❱
    R->>D: check_channel_membership(channel_id, pubkey)
    D-->>R: true  ❰ C-1+C-5: access gate ❱
    R->>D: insert_event ON CONFLICT DO NOTHING  ❰ idempotent ❱
    R->>P: publish_event(channel-scoped)  ❰ C-4: multi-pod fan-out ❱
    P->>Other: fan-out to other pods' local subs
    R->>R: sub_registry.fan_out (exclude global subs)  ❰ B-4: security boundary ❱
    R->>U: ["EVENT", sub_id, <event>] (to local subs)
    R->>S: search_index_tx.send (bounded queue, fire-and-forget)
    R->>AU: audit.log (spawned async)  ❰ C-2: hash-chain append, single writer ❱
    R->>W: wf.on_event (spawned async, exclude 46001-46012)  ❰ loop prevention ❱
    R->>U: ["OK", <id>, true, ""]
```

**架构约束映射**：
- **Step 1 (Tenant Binding)** → C-1：row-zero host→community，fail-closed
- **Step 2 (NIP-42 Auth)** → C-5：identity proof，secp256k1 签名
- **Step 3 (Kind Dispatch)** → C-3：kind 9 走存储路径，22242 拒绝，20000-29999 ephemeral bypass
- **Step 4 (Verify)** → CPU-bound isolation，spawn_blocking 不阻塞 worker
- **Step 5 (Membership)** → C-1+C-5：channel membership 是唯一 access gate
- **Step 6 (DB Insert)** → idempotent，ON CONFLICT DO NOTHING
- **Step 7 (Redis Publish)** → C-4：多 pod fan-out
- **Step 8 (Fan-out)** → B-4：global subs excluded，security boundary
- **Step 9-11 (Search/Audit/Workflow)** → fire-and-forget，C-2 audit 单写入点

*confidence: 0.83 · evidence_level: A (Code+Test) · evidence: [main.rs](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-relay/src/main.rs) + [ARCHITECTURE.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/ARCHITECTURE.md)*

### 5.2 Backpressure & Failure Isolation

过载时系统**分级 degrade**：

| 层级 | 机制 | 行为 | Confidence |
|------|------|------|------------|
| **连接层** | connection semaphore | 满时新连接直接拒绝（fast fail） | 0.85 |
| **慢客户端** | SLOW_CLIENT_GRACE_LIMIT=3 | `try_send` full buffer 3 次后 cancel connection，防止一个慢客户端拖累 fan-out | 0.85 |
| **搜索** | search_index_tx bounded queue (cap 1000) | 满则 drop event（搜索非关键路径，可接受 eventual consistency） | 0.80 |
| **Voice mesh** | datagram "drop-on-full, never blocks on old audio" | 实时性优先于完整性，丢旧 frame 不阻塞新 frame | 0.78 |
| **Audit/Workflow** | fire-and-forget spawned task | 失败不影响 event submission | 0.80 |
| **Graceful shutdown** | SIGTERM → 5s grace → drain_all (1012 close) → 30s hard timeout | K8s 外部 mitigation | 0.75 |

**关键 Gap**：无 per-route concurrency limit——voice + event + git 共享 tokio worker pool，head-of-line blocking 是已知 risk（见 R-1）。单 task panic 可能影响整个 process，无 supervisor 隔离——K8s restartPolicy 是外部 mitigation。

---

## 6. Quality Attributes

| Attribute | Score | Reasoning | Evidence Level |
|------|-------|---------|----------------|
| **Extensibility** | ★★★★☆ | Nostr kind 作为统一扩展点优秀（新功能=新 kind=零破坏）。Subsystem layered architecture 清晰。但子系统间有隐性耦合（pubsub→auth, workflow→db），branch-as-channel 未实现显示 VISION 与实现 gap。 | A (Code+Test) |
| **Maintainability** | ★★★★☆ | 27 focused crate + Cargo workspace + 编译期依赖检查 + 集中化 kind registry + TLA+/Tamarin spec + redteam 测试。但单 tokio runtime + 12 步 event pipeline + 多个 cron 后台任务增加认知复杂度。 | A (Code+Test) |
| **Performance** | ★★★☆☆ | Postgres 分区 + Redis pub/sub + bounded queue + leader election 优秀。但**单 tokio runtime 共享所有 workload 是 SLO 风险**——voice + event + git 并发时 head-of-line blocking。无 per-route concurrency limit。600K events/day + 10K humans + 50K agents 目标需验证。 | B (Code only) |
| **Testability** | ★★★★☆ | HostResolver trait 使 tenant binding 可无 DB 测试。redteam_attack2 测试模块验证安全 fence。buzz-conformance crate 提供 relay conformance 工具。kind.rs 单元测试验证 duplicate + range。但 integration test 需 Postgres + Redis，无完整 e2e harness。 | A (Code+Test) |
| **Observability** | ★★★★★ | JSON structured logs + OpenTelemetry OTLP + Prometheus metrics + per-community gauges + pool metrics + leader election metrics + fence observability + usage metrics（DB-derived + in-memory）。Datadog-compatible。`EmissionScope` 控制成本。**production-grade**。 | B (Code only) |
| **Security** | ★★★★☆ | Row-zero host binding + fail-closed + TLA+/Tamarin 形式化验证 + redteam 测试 + hash-chain audit + NIP-42/NIP-98 签名 auth + localhost-only policy + HMAC。Gap：SQL community_id conventional 非 enforced；E2E encryption future；mesh inference verification 不存在。 | S (Code+Test+Formal) |
| **Evolution** | ★★★★☆ | 清晰 Status 表区分 shipped/wired/planned。NIP-43 membership 重构 + empty host fence 修复显示安全驱动演进。但 VISION 与实现 gap（branch-as-channel, Buzz Mesh AI compute）需更明确标注，README "✅" 标注有误导风险。 | C (Doc+Code) |

---

## 7. Risks and Debt

> 仅 evidence-backed risks。每个标注 "what breaks"——这个 risk 触发时什么会崩。

### R-1: 单 tokio runtime head-of-line blocking（high）

**What breaks**：当 voice huddle（低延迟高吞吐 Opus frame）+ 600K events/day event pipeline + git large clone（subprocess + ReaderStream）同时发生时，tokio worker pool 饱和 → voice frame 延迟超过 Opus buffer 容忍度 → voice 卡顿；event pipeline tail latency 超过 <50ms p99 SLO；git clone 超时。无 per-route concurrency limit 是直接原因。一个 panic 的 task 可能影响整个 process（无 supervisor 隔离）。

*confidence: 0.85 · evidence_level: B (Code only) · evidence: evidence-log.jsonl:9-10*

### R-2: SQL community_id 漏写导致跨租户数据泄露（high）

**What breaks**：若 contributor 添加新 query 忘记 `WHERE community_id`，跨租户用户可读到其他 community 的 events/channels/DMs。TLA+/Tamarin 不覆盖 SQL 层（known gap），只能靠 code review + buzz-conformance 测试发现。这是 multi-tenant SaaS 最严重的安全风险——一次漏写 = 全平台数据泄露。

*confidence: 0.80 · evidence_level: S (Code+Test+Formal) 但有 known gap · evidence: evidence-log.jsonl:4-6*

### R-3: VISION/README 与实现 gap 误导用户（medium）

**What breaks**：用户基于 README "Buzz Mesh ✅" 部署 Buzz Mesh AI compute，发现 mesh-llm 是 dev-dependency production 不包含 → 信任崩塌。用户基于 "git events ✅" 期望 branch-as-room 体验，发现 NIP-34 仅存储事件无 auto-creation → 产品定位误解。这不是技术风险，是产品沟通风险，但影响 adoption。

*confidence: 0.83 · evidence_level: C (Doc+Code 交叉验证) · evidence: evidence-log.jsonl:11-15*

### R-4: Buzz Mesh AI compute 信任模型（medium）

**What breaks**：若 mesh-llm 启用（当前 dev-dependency，未来可能 production），恶意 community member 贡献 compute endpoint 返回错误 inference 结果 → agents 消费错误输出 → 决策错误。信任模型基于 relay membership（同 community trusted），但 inference result 无 hash/signature/challenge 验证。experimental feature 的潜在 future risk。

*confidence: 0.75 · evidence_level: E (Inference) · evidence: evidence-log.jsonl:14-15*

### R-5: 单 tokio process panic 影响整个 relay（medium）

**What breaks**：单 task panic（如 verify_event 解析 malformed event）可能影响整个 tokio runtime → 所有 WS 连接断开 + 所有 cron 任务停止。K8s restartPolicy + readiness/liveness probe + graceful drain(30s) 是外部 mitigation，但单 task panic 不隔离——recovery 时间 = pod 重启时间 + WS 重连时间。对 600K events/day SLO，这是可用性 risk。

*confidence: 0.70 · evidence_level: B (Code only) · evidence: evidence-log.jsonl:9-10*

---

## 8. Unknowns

剩余的 need_reading unknowns（实现细节，非 critical 架构决策）：

| ID | Question | Type | Evidence Needed |
|----|----------|------|-----------------|
| U-1 | buzz-conformance crate 是否提供 SQL community_id 覆盖率 lint？还是仅 relay protocol conformance？ | need_reading | crates/buzz-conformance/src/lib.rs + LIMITS.md |
| U-2 | buzz-audit hash-chain 多 pod 并发写入如何串联？是否依赖单写入点？ | need_reading | crates/buzz-audit/src/{hash,entry,service}.rs |
| U-3 | deny.toml 是否有跨 subsystem 依赖 ban 规则？还是仅 license/version ban？ | need_reading | deny.toml |
| U-4 | tower::ServiceBuilder 是否在 router.rs 配置 per-route concurrency limit？main.rs 未显示。 | need_reading | crates/buzz-relay/src/router.rs |
| U-5 | buzz-relay-mesh 的 Redis fenced generation 如何与 hash-chain audit 交互？ | need_reading | crates/buzz-relay-mesh/src/wire.rs FencedHeader + registry.rs |

---

## Appendix A: Research Provenance

### Research Questions (Round 1, all validated)

| ID | Type | Question (abbreviated) | Status | Confidence | Evidence Level |
|----|------|------------------------|--------|------------|----------------|
| q-001 | decision | 单 relay vs Nostr 多 relay P2P | validated_with_correction | 0.85 | A |
| q-002 | boundary | Multi-tenant isolation 实现机制 | validated | 0.88 | S |
| q-003 | boundary | 子系统隔离 Cargo 强制 vs 约定 | validated_with_correction | 0.82 | A |
| q-004 | runtime | 单进程多 workload 资源隔离 | validated | 0.85 | B |
| q-005 | runtime | Branches-as-channels 实现度 | validated | 0.83 | C |
| q-006 | risk | Buzz Mesh 信任/安全/性能 | validated | 0.80 | E |
| q-007 | pattern | Kind registry 治理机制 | validated | 0.84 | A |

### Evidence Summary

- **Evidence log entries**: 18（13 observation + 5 inference）
- **Hypotheses validated**: 7/7（5 validated + 2 validated_with_correction，0 rejected，0 blocked）
- **Average confidence**: 0.838
- **Coverage**: architecture 1.0 / runtime 1.0 / design_decisions 1.0 / evolution 1.0

### Key Source Files

- [crates/buzz-relay/src/main.rs](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-relay/src/main.rs) — composition root + startup flow + event pipeline
- [crates/buzz-relay/src/tenant.rs](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-relay/src/tenant.rs) — row-zero host binding + fail-closed + redteam test
- [crates/buzz-relay-mesh/src/lib.rs](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-relay-mesh/src/lib.rs) — iroh QUIC inter-relay session transport
- [crates/buzz-core/src/kind.rs](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-core/src/kind.rs) — Nostr kind registry + duplicate test
- [crates/buzz-relay/Cargo.toml](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-relay/Cargo.toml) — mesh-llm dev-dependency evidence
- [crates/buzz-relay/src/handlers/side_effects.rs](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/crates/buzz-relay/src/handlers/side_effects.rs) — NIP-34 only REPO_ANNOUNCEMENT handled
- [ARCHITECTURE.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/ARCHITECTURE.md) — system architecture + crate hierarchy
- [VISION.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/buzz/VISION.md) — feature surface + scale targets

---

## Appendix B: Evidence Level Legend

| Level | Basis | 含义 |
|-------|-------|------|
| **S** | Code + Test + Formal Verification | 最高可信度——代码 + 测试 + 形式化验证三重支撑 |
| **A** | Code + Test | 高可信度——代码 + 测试验证 |
| **B** | Code only（无 test 验证） | 中可信度——代码确认但无测试，需关注 limitation |
| **C** | Documentation + Code 交叉验证 | 中可信度——文档声称 + 代码实现交叉验证 |
| **D** | Documentation only | 低可信度——仅文档，需进一步代码验证 |
| **E** | Inference（基于代码模式推断） | 推测性——基于代码模式推断，需验证 |

**读者判断**：S/A 级 claim 可信度高，B/C 需要关注 limitation，D/E 是推测性 claim 需进一步验证。

---

*本报告基于 [architecture-narrative.json](file:///Users/saga/code-repos/devweekly.github.io/.working/buzz/architecture-narrative.json)（叙事骨架）+ [repository-model.json](file:///Users/saga/code-repos/devweekly.github.io/.working/buzz/repository-model.json)（详细 claims）渲染。不包含未经模型验证的新推理。Speculative claims（Buzz Mesh AI compute, branch-as-channel）已分离标注为 experimental/aspirational。*
