# Buzz — 工程研究报告

> **仓库**: [block/buzz](https://github.com/block/buzz) (buzz-workspace)
> **分析日期**: 2026-07-24
> **方法论**: Research Trace（Question → Evidence → Analysis → Counter Evidence → Conclusion → Confidence）+ Ontology-driven Research
> **证据来源**: evidence-brief.md（简报 §1–§9）、ARCHITECTURE.md、VISION_AGENT.md、crates/ 源码、benchmarks/ 源码

---

## 1. 执行摘要

Buzz 是 Block, Inc. 开源的**自托管多智能体工作空间**，构建于 Nostr 协议之上。它的核心赌注是：**一个社区、一种身份模型、一条事件日志**——人类、AI agent、workflow、git 事件全部讲同一种协议（NIP-01），用同一种 keypair 签名，最终落入同一个搜索索引与审计链。仓库是成熟项目（1802 commits、50 contributors、2409 模块、~24 个 Rust crate + Tauri/Flutter/Web 三端客户端），License 为 Apache 2.0。

**最有趣的发现**：Buzz 不是"给 agent 用的聊天工具"，而是把 agent 当作"有自己 keypair 的队友"——agent 通过 ACP（Agent Client Protocol）harness 桥接到任意 agent runtime（Goose/Codex/Claude Code/buzz-agent），身份与权限完全由密码学身份而非 permission flag 决定。配套的 `harbor-buzz-orchestra` 基准测试让 manifest 定义的 agent 团队跑过**真实** Buzz 技术栈去解 Terminal-Bench 2.1 任务，是少见的"用生产 stack 做 eval"的工程实践。

第二个值得注意的点：简报判定"Prompt-only design（无显式工具）"和"未找到 LICENSE"均为**假阴性**——工具系统是 MCP 运行时发现而非装饰器注册，LICENSE 实际存在。这印证了交叉验证的必要性。

---

## 2. Research Traces

### 2.1 核心架构：Nostr-as-Substrate（事件即一切）

**问题**: Buzz 的核心架构范式是什么？人类与 agent 如何在同一个 substrate 上对等协作？

**证据**:
- ARCHITECTURE.md §1："Every action — a chat message, a reaction, a workflow step, a canvas update, a huddle event — is a cryptographically signed Nostr event identified by a `kind` integer."
- `buzz-core/src/kind.rs` 定义 81 个 kind 常量（简报 §5.5：function 15710、agent 911、workflow 194 个对象）
- 事件流水线 12 步（ARCHITECTURE.md §4）：AUTH → PUBKEY MATCH → VERIFY → DB INSERT → REDIS PUBLISH → FAN-OUT → SEARCH INDEX → AUDIT → WORKFLOW TRIGGER
- 简报 §2：`admin-web.src.types` 入度 397、PageRank 0.059（全库最高），反映类型层是核心枢纽

**分析**: kind 整数是**唯一的分发开关**——relay 按 kind 路由/存储/扇出，client 按 kind 订阅，新功能 = 新 kind = 零破坏性变更。Event 对象通过 `produces`/`consumes` 关系连接到 Search/Audit/Workflow 对象；Agent 对象与 Human 对象在协议层无差别（都用 secp256k1 keypair 签名）。`buzz-core` 显式禁止 tokio/sqlx/redis/axum（零 I/O 基座），依赖严格自底向上。

**反证**: 简报 §2 检测到 5 个 import 循环，但全部位于 desktop/web 的 UI feature 层（如 `web.src.features.repos.mock-repos → use-repos → mock-repos`），**不在核心 Rust crate 层**——Rust workspace 的 crate 依赖是严格 DAG（ARCHITECTURE.md §1 的依赖图可验证）。

**结论**: Buzz 采用 **Nostr-as-Substrate 架构**——签名事件是唯一的数据模型，kind 是唯一的多态开关，人类与 agent 在协议层完全对等。

**置信度**: 高 — kind 注册表、事件流水线、crate 依赖图均可通过源码与简报交叉验证。

---

### 2.2 Agent 集成：ACP Harness 桥接任意 runtime

**问题**: Buzz 如何让 Goose/Codex/Claude Code 等异构 agent 接入同一个工作空间，而不锁定某一 runtime？

**证据**:
- `crates/buzz-acp/README.md`：`Buzz Relay ──WS──→ buzz-acp ──stdio (ACP/JSON-RPC)──→ Agent`
- 支持 goose、codex（经 codex-acp）、claude code（经 claude-agent-acp），或任何实现 ACP spec 的 agent
- `buzz-acp` 关键模块（ARCHITECTURE.md §6）：`relay.rs`(3143 LOC)、`queue.rs`(2565)、`pool.rs`(2253)、`acp.rs`(1785)
- 简报 §3：440 个 prompt，其中 system 345 个——大量 system prompt 位于 `crates/buzz-acp/src/{acp,pool,queue,lib}.rs`
- 每 channel 至多一个 in-flight prompt；N=1–32 agent 进程池，claim/return 生命周期；崩溃自动 respawn

**分析**: Agent 对象通过 `orchestratedBy` 关系连接到 ACP Harness 对象，Harness 对象通过 `uses` 关系连接到 Relay 对象与 Agent subprocess 对象。关键解耦：**Buzz 不关心 agent 内部实现**，只要求 agent 实现 `initialize`/`session/new`/`session/prompt` 三个方法。Queue 对象在 channel 维度做 batching + dedup，确保同一 channel 串行处理。`--respond-to` 门控（owner-only/allowlist/anyone/nobody）在事件到达 agent 前过滤，是 Harness 层的 guardrail。

**反证**: 未发现反证。但 Harness 不持久化状态——重启后靠 `since` filter 重放未处理 @mention，若 relay 事件已过期清理则可能丢失。

**结论**: Buzz 用 **ACP Harness 模式**实现 agent-runtime 无关——任何 ACP agent 即插即用，Buzz 只管事件与身份。

**置信度**: 高 — README、ARCHITECTURE.md、模块 LOC 均一致。

---

### 2.3 极简 agent 哲学：buzz-agent 的"可审计性优先"

**问题**: 既然已有 Goose/Codex/Claude，为何自建 `buzz-agent`？它的设计取舍是什么？

**证据**:
- `crates/buzz-agent/README.md`："Minimal, unbreakable ACP-compliant LLM agent. Stdio in, tool calls out. Non-streaming. No persistence. No cleverness."
- VISION_AGENT.md："A coding agent should be small enough to hold in your head... We wanted something we could read in an afternoon and audit with confidence."
- 明确的"NOT"清单：Not a framework / Not streaming / Not persistent / Not an SDK / Not a UI / Not authenticated / Not networked MCP / Not load-able / Not a router
- 测试策略："Regression tests are the changelog"——每个 `#[test]` 以它锁定的 bug 命名（`cancel_leaves_history_valid_for_next_prompt`、`mcp_init_timeout_kills_child`）
- 上下文 handoff：context 满时 agent 自摘要历史并继续（`BUZZ_AGENT_MAX_HANDOFFS=10`）

**分析**: buzz-agent 对象通过 `extends`（ACP 协议）与 `uses`（MCP 工具）关系组合，刻意拒绝框架化。其"输出即工具调用"模型把 LLM 文本降级为 reasoning，真正的工作发生在 MCP 工具里。非流式（一次 HTTP POST 一个响应）是刻意取舍——牺牲首 token 延迟换取实现简单与可审计。Process-group kill、bounded everything（4MiB frame、1MiB history、50KiB tool text）是 hardened 原则的体现。

**反证**: 非流式对长输出任务体验不佳；无持久化意味着重启丢失 session——但 VISION_AGENT.md 明确这是"per-process, in-memory"的设计意图，配合 `session/load: false` 广播。

**结论**: buzz-agent 是**可审计性优先的极简 agent**——刻意放弃框架化、流式、持久化，换取"一下午能读懂"的代码，是 对"agent 应该小到能装进脑子里"这一理念的工程兑现。

**置信度**: 高 — README、VISION、配置项、测试命名均一致。

---

### 2.4 身份模型：Keypair-as-Identity，按身份而非 permission flag 授权

**问题**: Buzz 如何在不引入传统 RBAC 的前提下安全地给 agent 授权？

**证据**:
- README："Agents have their own keys, their own channel memberships, and their own audit trail. Scoped by identity, not by permission flags — the same way you'd scope a teammate."
- ARCHITECTURE.md §7：NIP-42（WebSocket）+ NIP-98（HTTP，kind:27235 Schnorr 签名）；AUTH 事件从不存储、从不入审计链
- `buzz-auth`：14 个 Scope（MessagesRead/Write、ChannelsRead/Write、Admin*、Jobs*、Files*...）；Channel membership 是唯一访问门
- AGENTS.md：Agent 成员角色含 `Bot`；channel 操作 TOCTOU-safe（事务内 check-then-modify）
- `buzz-audit`：hash-chain 审计链，`pg_advisory_lock` 单写者，`catch_unwind` 保证锁释放

**分析**: Agent 对象通过 `registeredBy`（keypair）关系获得身份，通过 `configuredBy`（channel membership + scope）关系获得能力。安全属性通过三个独立机制叠加：密码学身份（Schnorr）+ channel membership 门（relay 每次操作校验）+ hash-chain 审计（事后可验证）。审计链的 canonical JSON（BTreeMap 确定性排序）+ 单写者锁保证可重现与防篡改。

**反证**: ARCHITECTURE.md §9 Known Limitation #2：`RateLimiter` trait 存在但**唯一实现是 `AlwaysAllowRateLimiter`**（test stub），4 档 rate limit 配置（human/agent-standard/agent-elevated/agent-platform）**均未强制**。这是身份授权的一个真实缺口——agent 可无限速调用。

**结论**: Buzz 用 **keypair-as-identity + channel-membership-as-capability** 替代传统 RBAC，配合 hash-chain 审计实现可验证的同等对待。但 rate limiting 是设计目标而非已实现能力。

**置信度**: 高 — auth crate、scope 枚举、audit 设计、known limitation 均可验证。

---

### 2.5 评估基础设施：用生产 stack 跑 Terminal-Bench

**问题**: Buzz 如何验证多 agent 协作有效？eval 是否真实可信？

**证据**:
- `benchmarks/harbor-buzz-orchestra/README.md`："Each agent runs *inside* the Harbor task container as the same `buzz-acp` → `buzz-agent` → `buzz-dev-mcp` process tree the desktop app launches"
- manifest（`manifests/m1-hello-world.yaml`）：roster 定义 orchestrator + worker，`prompt.sha256` **字节固定** system prompt，`generation` 固定 token 预算，`prices` 固定成本表
- persona（`personas/orchestrator-m1.md`）：明确规则——"Nothing you write is visible to anyone unless you publish it"，必须用 `buzz messages send` 发布
- `just benchmark` 默认 leaderboard-legal（TB 2.1，k=5，Sonnet+Haiku team）；每次 trial 独立 keypair + 私有 channel；relay/Postgres 事件时间线归档供分析
- 简报 §4：46 个 eval 文件，metrics 含 f1/precision/recall/exact-match/accuracy

**分析**: Evaluation 对象通过 `orchestrates` 关系连接到 Agent Team 对象，Agent Team 对象通过 `uses` 关系连接到真实 Relay/ACP/Agent/MCP 对象。关键设计：**不用 mock，不用 shim**——agent 在 benchmark 容器里跑的就是桌面 app 启动的同一棵进程树。字节固定 prompt（sha256）+ 固定 generation 参数 + 固定价格表 = 可复现、可 leaderboard 提交。orchestrator/worker persona 强制"必须经 Buzz channel 通信"，使协作过程本身成为可审计的事件流。

**反证**: 未发现反证。但 `--n-concurrent 1` 是"安全笔记本设置"，大规模并行能力未验证；TB graders 在验证时安装依赖，需在特定网络环境运行。

**结论**: harbor-buzz-orchestra 是**生产-stack-in-the-loop 的 eval**——避免 mock 失真，prompt 字节固定保证可复现，是 agent 评估的工程化范本。

**置信度**: 高 — README、manifest、persona、just 命令均一致。

---

### 2.6 Workflow 引擎：YAML-as-Code 与已知的"未接通"

**问题**: Buzz 的自动化引擎设计如何？哪些是已实现、哪些是显式未完成？

**证据**:
- ARCHITECTURE.md §6 buzz-workflow：4 trigger（message_posted/reaction_added/schedule/webhook）× 7 action（send_message/send_dm/set_channel_topic/add_reaction/call_webhook/request_approval/delay）
- 条件求值用 `evalexpr` + `HashMapContext`，100ms 超时防对抗表达式；模板变量单遍解析（不递归）
- 循环防护：kind 46001–46012（workflow 执行事件）、`buzz:workflow` tag、KIND_GIFT_WRAP 排除触发
- **已知缺口**（ARCHITECTURE.md §9）：#5 approval gate 未端到端接通（run 命中 approval 即标记 Failed，🚧 WF-08）；#6 `send_dm`/`set_channel_topic` 返回 NotImplemented（🚧 WF-07）

**分析**: Workflow 对象通过 `triggers`（event）→ `produces`（action event）关系编排，通过 `configuredBy`（YAML manifest）关系定义。`request_approval` 返回 `StepResult::Suspended` 但引擎不持久化 token 也不恢复执行——`execute_from_step()` 已为未来恢复预留。这是"骨架已立、血肉未全"的状态。

**反证**: cron scheduler 已完全实现（60s tick + 窗口匹配）；call_webhook 有 SSRF 防护 + 禁重定向 + 1MiB 响应 cap。已实现部分是生产级的。

**结论**: Workflow 引擎是**YAML-as-Code 设计 + 显式未完成项**——团队诚实标注 WF-07/WF-08，已实现部分生产级，approval gate 是当前阻塞点。

**置信度**: 高 — ARCHITECTURE.md Known Limitations 与 §6 描述一致。

---

### 2.7 多社区租户：Host-derived 边界与 fail-closed

**问题**: Buzz 如何在共享基础设施上隔离多社区？边界由什么决定？

**证据**:
- ARCHITECTURE.md §1：`req.community = resolve_host(connection.host)` 在 AUTH 之前建立；"Unknown hosts fail closed, and NIP-98/API-token stamps must agree with the host-derived community rather than overriding it."
- §5：订阅注册前校验 channel 访问（无 race window）；channel-scoped 事件**不**扇出给 global 订阅（安全边界）
- §8：多社区下所有 tenant-visible key 按 `buzz:{community}:...` 前缀隔离；FTS 查询 community_id BitmapAnd btree filter
- audit chain 每 community 独立 head/chain

**分析**: Community 对象通过 `configuredBy`（host）关系绑定，所有子对象（Event/Channel/Presence/Typing/Audit/Workflow）通过 `consumes` community context 关系继承边界。fail-closed 是关键——未知 host 不回退默认租户。NIP-98 stamp 必须与 host 一致而非覆盖，防止跨租户提权。

**反证**: 单社区默认（一 host 一 relay 一 implicit community）仍是最常见部署，多社区是"上移语义边界"——共享 Postgres/Redis/S3 是实现细节，非用户可见全局空间。

**结论**: Buzz 的多租户是 **host-derived、fail-closed、端到端 community-scoped**——比基于 tag 的软隔离更严格。

**置信度**: 高 — ARCHITECTURE.md §1/§5/§8 多处一致。

---

### 2.8 交叉验证：简报的两处假阴性

**问题**: 简报的 Negative Findings 是否全部可信？

**证据**:
- 简报 §6："未找到 LICENSE 文件"——但 README 链接 `LICENSE`，仓库根 `LS` 显示 `LICENSE` 文件存在，README 标注"Apache 2.0"
- 简报 §3："Design archetype: Prompt-only design (no explicit tools detected)"——但 `buzz-dev-mcp` 提供 shell/file-edit/todo 工具，`buzz-agent` 通过 MCP `tools/list` 运行时发现工具（`buzz-agent/README.md` §MCP Servers）；简报 §6 自己也 hedge："未检测到显式工具注册（可能使用非装饰器模式）"

**分析**: analyzer 的 LICENSE 检测与 tool 检测基于文件名/装饰器启发式，对 MCP 运行时发现式工具系统产生假阴性。这印证简报 §0 原则"多个弱信号优于一个强信号"与"测试/示例是一等证据"——README 与源码是更强证据。

**反证**: 无。

**结论**: 简报两处 Negative Findings（LICENSE、工具）为**假阴性**，经源码交叉验证后推翻。研究报告必须独立验证 analyzer 结论。

**置信度**: 高 — LICENSE 文件与 MCP 工具机制直接可验证。

---

## 3. Negative Findings

| 发现 | 为什么重要 |
|------|-----------|
| **Rate limiting 未强制**（简报未列，源码发现）| `AlwaysAllowRateLimiter` 是唯一实现，agent 可无限速——对多 agent 部署是真实 DoS 风险 |
| **Approval gate 未端到端接通**（WF-08）| workflow 命中 approval 即 Failed，"人在环中"自动化尚不可用 |
| **`send_dm`/`set_channel_topic` 未实现**（WF-07）| workflow action 在 schema 但返回 NotImplemented |
| **Huddle 录音/track 未建**| kind 已预留但无 producer |
| **无 sqlx 编译期查询校验**| 用 `sqlx::query()` 运行时，无 `.sqlx/` 离线缓存，SQL 错误延后到运行期 |
| **buzz-acp 不持久化状态**| 重启靠 `since` 重放，relay 清理后可能丢事件 |
| **简报假阴性：LICENSE 与工具检测**| analyzer 启发式局限，须源码交叉验证（见 §2.8）|

---

## 4. Architecture Smells

> 均为 Potential，非断言。

### 4.1 Potential Test Coverage Undercount
- **证据**: 简报 §4 test/source ratio 0.05（低于 0.15），125 test 文件 / 908 测试函数
- **为什么是风险**: 数字可能误导——Rust `#[test]` 内联测试与 `tests/` 目录集成测试未被文件启发式完全捕获；ARCHITECTURE.md 称 buzz-test-client 有 134 e2e 测试。真实覆盖率可能高于 0.05
- **置信度**: 中 — 需用 `cargo test` 实际计数验证

### 4.2 Potential UI-layer Coupling
- **证据**: 5 个 import 循环全在 desktop/web feature 层（简报 §2）
- **为什么是风险**: feature 模块互导违反"feature 不互导"约定（AGENTS.md mobile 部分明确，desktop 隐含）。变更涟漪
- **置信度**: 中 — 循环在 UI 层不影响核心 Rust crate DAG

### 4.3 Potential God Module: `admin-web/src/types.ts`
- **证据**: 入度 397、PageRank 0.059，全库最高（简报 §2）
- **为什么是风险**: 397 个依赖方意味着类型变更触发大面积级联
- **置信度**: 高 — 但这是 admin-web 子项目，非核心 relay

### 4.4 Potential Stubbed Workflow Surface
- **证据**: 2 个 action NotImplemented + approval 不恢复（ARCHITECTURE.md §9）
- **为什么是风险**: 用户若按文档写 workflow 命中 stub 会运行时失败
- **置信度**: 高 — 团队已诚实标注 🚧

---

## 5. Interesting Decisions

### 5.1 非流式 LLM 调用
- **决策**: buzz-agent 一次 HTTP POST 一个响应，无 token 级流式
- **为什么有趣**: 业界普遍追求首 token 低延迟，Buzz 反向选择
- **替代方案**: SSE 流式
- **权衡**: 实现简单、可审计、stdout 不交错；牺牲长输出体验

### 5.2 Webhook 用 constant-time XOR 而非 HMAC
- **决策**: workflow webhook 用 XOR 比较 stored UUID secret（ARCHITECTURE.md §7）
- **为什么有趣**: 直接比 secret 而非 body MAC，是"够用就好"取舍
- **替代方案**: HMAC-SHA256 body 验签
- **权衡**: 防时序攻击但不防重放/篡改——文档明确标注此局限

### 5.3 回归测试即 changelog
- **决策**: `regressions.rs` 每个 test 以 bug 命名（`cancel_leaves_history_valid_for_next_prompt`）
- **为什么有趣**: 把测试当历史文档，读测试即读失败模式史
- **替代方案**: 按 feature 命名
- **权衡**: 检索性强；新成员读测试即理解协议陷阱

### 5.4 Agent 共享同一 bot 身份
- **决策**: N=1–32 agent 进程全部认证为**同一** Nostr bot 身份（buzz-acp README）
- **为什么有趣**: 用户视角永远是一个 bot，底层是进程池
- **替代方案**: 每 agent 独立身份
- **权衡**: 用户体验一致；无法区分哪个 agent 进程的行为

---

## 6. Repository Positioning

| 维度 | 成熟度 | 说明 |
|------|--------|------|
| Planning | Emerging | 无显式 planner，orchestrator/worker 分工靠 persona prompt |
| Execution | Advanced | ACP harness + N-agent pool + per-channel 串行 + 崩溃 respawn |
| Memory | Common | buzz-agent 自摘要 handoff；事件历史由 relay/Postgres 持久化 |
| Evaluation | Advanced | harbor-buzz-orchestra 用生产 stack 跑 TB 2.1，字节固定 prompt |
| Guardrails | Emerging | 身份+membership 强；rate limit 未强制；approval 未接通 |
| Prompt | Advanced | persona pack + 字节固定 + system prompt 分布于 acp/agent/queue |
| Tooling | Unique | MCP 运行时发现 + buzz-dev-mcp + buzz-cli agent-first JSON I/O |
| Observability | Advanced | hash-chain audit + Prometheus + 归档事件时间线 |

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|---------|
| Nostr-as-Substrate | 一切是签名事件，kind 是多态开关 | `buzz-core/src/kind.rs` | ⚠ 需适配 |
| ACP Harness | 桥接事件总线到任意 ACP agent，per-channel 串行 | `crates/buzz-acp/` | ✅ 通用 |
| Keypair-as-Identity | agent 即队友，按身份非 permission flag 授权 | `buzz-auth` + NIP-42/98 | ✅ 通用 |
| Hash-Chain Audit | SHA-256 链 + advisory lock + canonical JSON | `buzz-audit` | ✅ 通用 |
| Byte-Pinned Prompt | prompt sha256 固定，可复现 eval | `benchmarks/.../manifests/` | ✅ 通用 |
| Regression-as-Changelog | 测试以 bug 命名 | `buzz-agent/tests/regressions.rs` | ✅ 通用 |
| Host-derived Tenancy | host 决定 community，fail-closed | `buzz-relay` TenantContext | ⚠ 需适配 |
| Three-Tier Fan-Out | channel+kind / channel-wildcard / global 三级订阅索引 | `buzz-relay/subscription.rs` | ✅ 通用 |
| Bounded Everything | frame/history/response/tool 全部硬上限 | `buzz-agent` 配置项 | ✅ 通用 |
| God Module (anti-pattern) | `types.ts` 入度 397 | `admin-web/src/types.ts` | ❌ 应避免 |

---

## 8. Architecture Evolution

基于 Git 历史（1802 commits、50 contributors）与文档痕迹：

- **从单社区到多社区**: ARCHITECTURE.md 反复强调"multi-community mode"作为后加语义层——单社区是默认，多社区是"上移边界"。`community_id` 渗透到 events/channels/workflows/audit/Redis key/FTS 全链路，显系渐进重构
- **ACP 作为 agent 抽象边界**: buzz-acp 支持 goose/codex/claude 三家 + 任意 ACP agent，说明 agent runtime 抽象是经过多轮验证的稳定 seam
- **buzz-dev-mcp 从 buzz-agent 分离**: VISION_AGENT.md "Two binaries, two protocols, no coupling"——刻意拆分以独立复用
- **Workflow 的诚实未完成**: WF-07/WF-08 标注显示 workflow 是在建能力，approval gate 是失败驱动迭代的中途态
- **Benchmark 后置**: harbor-buzz-orchestra 用 Terminal-Bench 2.1，是相对新近的 eval 基础设施投入

---

## 9. Reading Guide

### 30 分钟速览
1. **`README.md`** — 项目定位、架构图、crate map
2. **`ARCHITECTURE.md`** §1–§4 — 事件流水线、连接生命周期、订阅系统
3. **`crates/buzz-acp/README.md`** — ACP harness 如何桥接 agent
4. **`crates/buzz-agent/README.md`** — 极简 agent 哲学与"NOT"清单
5. **`VISION_AGENT.md`** — 自建 agent 的设计理念

### 2 小时深入
6. **`ARCHITECTURE.md`** §6–§9 — crate 逐项 reference + 安全模型 + Known Limitations
7. **`crates/buzz-core/src/kind.rs`** — 81 个 kind 注册表，理解"kind 即多态"
8. **`crates/buzz-acp/src/pool.rs`** — N-agent 进程池 claim/return
9. **`crates/buzz-agent/src/agent.rs`** — agent loop 实现
10. **`crates/buzz-audit/src/service.rs`** — hash-chain + advisory lock
11. **`crates/buzz-workflow/src/executor.rs`** — evalexpr 条件 + Suspended 状态
12. **`benchmarks/harbor-buzz-orchestra/manifests/m1-hello-world.yaml`** — 字节固定 manifest
13. **`benchmarks/harbor-buzz-orchestra/personas/orchestrator-m1.md`** — persona 协作规则
14. **`crates/buzz-agent/tests/regressions.rs`** — 回归测试即 changelog
15. **`AGENTS.md`** — agent 贡献者约定与 gotchas

---

## 10. Open Questions

| # | 问题 | 为什么重要 | 建议调查方法 |
|---|------|-----------|-------------|
| 1 | Rate limiting 何时从 stub 转生产? | 4 档配置已定义但未强制，是 agent DoS 风险 | grep `RateLimiter` impl 与 issue tracker |
| 2 | Approval gate 恢复执行的路线图? | WF-08 阻塞"人在环中"自动化 | 查 `execute_from_step` 调用点与 WF-08 issue |
| 3 | buzz-agent 自摘要 handoff 的质量如何评估? | 上下文压缩是 agent 可靠性关键 | 读 handoff.rs + 跑 benchmark 对比 handoff 前后 |
| 4 | 多社区下 audit chain 跨社区聚合如何做? | 运维需要全局视角但租户只读本社区 | 查 operator metrics 与 `verify_chain` 实现 |
| 5 | buzz-acp 重启事件丢失窗口多大? | 不持久化状态是已知取舍 | 分析 relay 事件保留策略与 `since` 重放边界 |
| 6 | orchestrator/worker 协作是否出现死锁/抖动? | 多 agent 协作是 benchmark 核心但难调 | 分析归档的 trial event timeline 与 acp logs |

---

## 附录：证据引用

- **简报 §1**: Executive Brief — 2409 模块、1802 commits、50 contributors
- **简报 §2**: Architecture Insights — 入度/PageRank/5 循环
- **简报 §3**: AI/Agent Design — 440 prompts
- **简报 §4**: Testing & Evaluation — 125 test 文件、46 eval 文件
- **简报 §5.5**: Ontology View — 911 agent / 194 workflow / 122 evaluation 对象
- **简报 §6**: Negative Findings — LICENSE/工具假阴性（已交叉验证推翻）
- **源码**: README.md、ARCHITECTURE.md、VISION_AGENT.md、AGENTS.md、crates/buzz-{acp,agent,core,auth,audit,workflow}/、benchmarks/harbor-buzz-orchestra/
