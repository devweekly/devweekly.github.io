# OpenWorker 架构研究报告

> 仓库：`ref-only/openworker` · 分析时间：2026-07-30 · 证据：27 条 (ev-011~ev-036) · 覆盖度：runtime 0.85 / architecture 0.95 / design 0.95 / testing 0.75 / deployment 0.60 / history 0.40

---

## 1. 执行摘要

OpenWorker 是一个 **durable agent runtime**——以 `TurnEngine` 为架构中心的 agent 循环，配合 `SessionManager` 作为 orchestrator 管理跨 session 协调。它的核心设计目标是让 agent **"stays resumable forever, works with no live socket"**：跨进程重启、跨交互表面（in-app / Slack / mobile）、跨 session 生命周期都能续完未竟的 turn。

三个最关键的发现：

1. **三层 durable 设计**正交地解决了三个维度的 resumability——`TurnEngine.resume()` 跨 restart 重放 unanswered tool_calls；`InboxStore` 跨 surface idempotent (session_id, tool_call_id)；`SessionManager.deliver_to_session` 跨 session 生命周期重建 engine 并应用 permission grants。三层缺一不可。
2. **aisuite 不是 provider 抽象基座**，而是 toolkits/tracing 层 + OpenAI-compat plug-in (P12)。OpenWorker 自建 `ProviderClient` ABC，因 Anthropic Messages API 与 chat.completions 差异大到必须有专门 converter，且 extended thinking verbatim replay + API drift 适配 (pre-4.6/4.6+/Claude 5) 是当前 aisuite 抽象层无法覆盖的 model-family-specific 处理——OpenWorker 作者认为 aisuite 不适合承担这一职责。
3. **三种部署模式**共存于同一 Python 代码库：Tauri desktop sidecar（supervised）、standalone `openworker-server`（headless）、`openworker` TUI（terminal-only）。Desktop 只是 one deployment mode，不是架构约束。

置信度：**高**（27 条 A 级证据，12 个 R1 问题 + 6 个 R2 问题全部 answered + validated，5 个 challenge 全部维持）。

---

## 2. 仓库心智模型

维护者如何心智划分系统：

| 角色 | 组件 | 职责 |
|------|------|------|
| **心脏** | `TurnEngine` (engine.py, 1033 LOC) | 执行 agent 行为——iteration-based loop + provider stream + tool authorize/execute + approval interception |
| **大脑** | `SessionManager` (manager.py, 3505 LOC) | 协调跨 session——装配 engine + 路由 inbound + 执行 scheduled task + 持有 18+ stores |
| **神经系统** | `Inbox` (inbox.py) | cross-session human-attention queue——5 种 kind，多 surface 同一 item，idempotent + first-responder-wins |
| **心跳** | `Scheduler` (automation/scheduler.py) + `Self-wake` (selfwake.py) | cron + suspend/resume tick——run-once-catch-up + skip-on-overlap |
| **骨架** | `Tauri Shell` (surfaces/gui/src-tauri) | desktop supervisor——单实例锁 + close-to-tray + keep-awake + sidecar spawn |
| **可替换器官** | `Persona` / `Skill` / `Connector` / `Provider` | data-driven extension——Adding a connector is mostly data, not UI code |

**核心张力**：durable resumability vs 协调复杂度。三层 durable 设计让 agent 可跨 restart/surface/session 续完，但代价是 `SessionManager` god-class + 18+ stores + 多层 permission allowlist + 多 surface Inbox 同步。

---

## 3. 架构

### 3.1 能力地图

```
OpenWorker
├── Desktop Shell (Tauri Rust)          # supervisor + 单实例 + keep-awake
├── Python Agent Server (coworker/)
│   ├── TurnEngine                      # 架构中心 — agent loop
│   ├── SessionManager                  # orchestrator — 18+ stores
│   ├── Agent / Persona / Skill         # surface 抽象 — thin
│   ├── Providers                       # native Anthropic/Gemini + OpenAI-compat
│   ├── Connectors                      # 28 文件 — Slack/Telegram/GitHub/...
│   ├── MCP                             # async-native wrapper over mcp SDK
│   ├── Permissions                     # 5 mode + RiskClass + §25 standing rule
│   ├── Inbox                           # cross-session human-attention queue
│   └── Automation                      # cron scheduler + self-wake
└── 三种部署入口
    ├── openworker-server (uvicorn)     # standalone headless
    ├── openworker (textual TUI)        # terminal-only
    └── Tauri sidecar                   # desktop supervised
```

### 3.2 静态架构：分层与边界

**10 个分层**，每层有清晰 owner 和 responsibility（见 [repository-model.json](file:///Users/saga/code-repos/devweekly.github.io/.working/openworker/repository-model.json) `dimensions.structural.layers`）：

1. **Desktop Shell Layer**（Tauri）——进程监督、单实例锁、close-to-tray、keep-awake、SPA 注入 sidecar port
2. **Orchestration Layer**（SessionManager）——session 生命周期、cross-session coordination、engine 装配、inbound 路由
3. **Agent Loop Layer**（TurnEngine）——iteration-based loop、provider stream、tool authorize/execute、approval interception、durable resume
4. **Agent Surface Layer**（agents/ + personas/）——Agent 抽象 (Code/Chat/Cowork) + Persona 序列化 + Skill 可插拔
5. **Provider Layer**——ProviderClient ABC + native Anthropic/Gemini + OpenAI-compat vendor 路由
6. **Connector Layer**——BasePlatformAdapter 契约 + adapters + RelayHub + integration_tools + descriptors
7. **MCP Layer**——MCPManager async-native 包装 + stdio/http transport + OAuth
8. **Permission Layer**——5 mode + RiskClass + 4 层 allowlist + §25 standing rule
9. **Inbox Layer**——cross-session queue + 多 surface 同一 item + self-wake
10. **Automation Layer**——cron scheduler + catch-up + overlap policy + selfwake 集成

**关键边界**：
- **Tauri shell 是 supervisor 不是 peer**：spawn Python sidecar 绑 random free localhost port，通过 `COWORKER_EXIT_WITH_PARENT=1 + COWORKER_PARENT_PID` 显式建立进程关系（因 PyInstaller onefile bootloader 让 `getppid()` 不可靠）。
- **Agent 是 thin surface，TurnEngine 是 real loop**：`coworker/agents/` 仅 ~310 LOC 跨 8 文件，Agent 子类主要定义 system_prompt + traits (family/messaging/connectors)。TurnEngine 由 `build_engine` (agent.py) 装配。
- **Persona ⊇ Skill**：Persona = YAML frontmatter + markdown body，`to_agent()` 物化成 runtime Agent。Skill 是 Anthropic-format loadable capability，ANY agent can pull in。

### 3.3 运行时架构：控制流与数据流

#### Agent Turn 主循环

```
user message / scheduled task / inbound mention / self-wake resume
  ↓
SessionManager.deliver_to_session
  ├── busy (is_running) → engine.queue_steering (插队 live turn 下一步)
  └── idle → mark_running + get_engine
      ↓
      get_engine: load SessionRecord → resolve workspace → build_engine
                  + apply task standing rules + mention grants + record.grants
      ↓
      engine.run() → _loop() iteration while
          ↓
          _astream() [thread + asyncio.Queue 桥接 blocking provider stream]
          ↓
          _handle_tool_calls 两阶段:
            1. 顺序 authorize (approval 是 interactive 不能并发)
            2. execute 按 _parallel_safe 分流:
               - risk_level=low + 非 requires_approval → asyncio.gather 并发
               - writes/shell/unannotated → 严格串行
          ↓
          approval needed → emit PERMISSION_REQUIRED + await approver
            → inbox_approver 转 InboxItem + store.wait()
            → resolve from any surface → ApprovalOutcome
          ↓
          turn.tool_calls 空 + 无 steering → TURN_END
```

**终止条件**：(1) model 不再请求 tools；(2) `max_iterations` (默认 12) 超限；(3) rail 介入 (interrupt/error)。

#### 三层 Durable Resume

| 层 | 机制 | 跨什么 | 证据 |
|----|------|--------|------|
| `TurnEngine.resume()` | 重放 trailing assistant message 的 UNANSWERED tool_calls，`_unanswered_trailing_tool_calls()` 从持久化 messages 反推 | 跨 restart | ev-016 |
| `InboxStore` | `(session_id, tool_call_id)` idempotent + first-responder-wins，`for_tool_call()` 找到已有 item 复用而非 re-prompt | 跨 surface | ev-025 |
| `SessionManager.deliver_to_session + get_engine` | 重建 engine 并应用 task rules + mention grants + record.grants | 跨 session 生命周期 | ev-030, ev-031 |

**测试验证**：`tests/test_durable_resume.py` 明确测试这三层——`test_durable_resume_question` 模拟 restart (cancel task + drop engine + mark_idle)，然后 resolve Inbox item，验证 turn 从 persisted thread 续完；`test_durable_resume_approval_executes_tool` 验证 durable resume 时 "allow" 必须 RE-EXECUTE the tool。

#### Permission End-to-End Chain

```
tool_call 需要授权
  ↓
PermissionEngine.evaluate (5 mode + RiskClass + 4 层 allowlist)
  ├── READ_ONLY_MODES + consequential → deny
  ├── is_write + path 不在 writable root → deny
  ├── not consequential → allow (low risk)
  ├── AUTO → allow
  ├── shell + command allowlist (config 或 session) → allow
  ├── tool in session_allow_tools → allow
  ├── task_rules (§25 standing rule) → allow
  ├── CUSTOM + auto_allow_tools → allow
  └── else needs_user=True
  ↓
engine._authorize emit PERMISSION_REQUIRED + await approver
  ↓
SessionManager.inbox_approver 转 InboxItem + store.wait()
  ↓
resolve from any surface (in-app / Slack button / reply / [ow:id] token)
  ↓
ApprovalOutcome (ONCE / ALWAYS_TOOL / ALWAYS_COMMAND / DENY)
  ↓
ALWAYS_* → allow_tool_for_session / allow_command_for_session
         → 或 task_rules (§25 via _seed_task_permissions)
```

**§25 standing rule 是 automation-safe 的关键**：`task_rules = {tool: {allowed targets}}` seeded from `ScheduledTask`，external-risk only (never exec/write-local)，exact-target binding 让 connector tool auto-allow 安全——automation run 中 agent 对 declared target 自动放行不阻塞 scheduler。

---

## 4. 工程决策

### 4.1 工程约束

| 约束 | 来源 | 驱动的决策 |
|------|------|-----------|
| Desktop app 关闭是常态 | runtime 环境 | scheduler 必须 catch-up (run-once-catch-up) + skip-on-overlap；self-wake suspend/resume 而非 kill/restart |
| PyInstaller onefile bootloader | 打包约束 | 不能用 `getppid()` reparenting check，必须 `COWORKER_EXIT_WITH_PARENT + COWORKER_PARENT_PID` 显式 sidecar self-exit |
| 多 provider API drift | vendor API | 自建 native provider (Anthropic/Gemini) 而非用 aisuite 统一抽象 |
| anyio cancel scopes task-affine | mcp SDK | MCP server 必须在 dedicated asyncio task，enter+exit on one task |
| mid-thread system messages 不可靠 | provider 行为 | context_provider 把 plan/discuss reminder + directory list 注入 last user message (send-time only, never persisted) |
| hosted chat templates reject orphaned tool_calls | provider 约束 | Stop 路径必须给每个 pending tool_call 写 tool-error message，历史里永远不留 orphan |

### 4.2 架构作用力

- **always-on agent 需求** vs **desktop 资源约束** → suspend/resume 设计 (selfwake + scheduler + inbox)
- **多 surface human attention** vs **一致性** → Inbox as canonical queue，messaging connectors / mobile 是 transports of same items
- **automation 无人工干预** vs **permission 安全** → §25 standing rule exact-target binding
- **多 provider 共享 history** vs **API 差异** → canonical OpenAI-shape + per-call conversion

### 4.3 关键决策

| 决策 | 选择 | 替代方案 | 理由 |
|------|------|---------|------|
| Provider 抽象 | 自建 `ProviderClient` ABC + native 实现 | aisuite 统一抽象 | Anthropic Messages API 与 chat.completions 差异大到必须有专门 converter；extended thinking verbatim replay + API drift 适配是当前 aisuite 抽象层无法覆盖的 |
| MCP client | 自建 async-native 包装层 | 直接用官方 mcp SDK | 官方 SDK 同步阻塞需 nest_asyncio 或第二 event loop；anyio cancel scopes task-affine 要求 dedicated task |
| Scheduled task 执行模型 | durable conversation thread (可续) | fire-and-forget | 支持 parked approval + task-scoped standing rule；scheduled agent is no longer fire-and-forget |
| SessionManager 组织 | god-class (3505 LOC) | 按 13 类职责拆分 | 所有 cross-cutting state 需 shared access；拆分需引入 13+ 协作对象 + shared state 同步机制 |
| Connector 架构 | 三层分离 (adapter + tool surface + descriptor) | 单一 adapter | 支持 data-driven 扩展 (Adding a connector is mostly data, not UI code) |
| Permission allowlist | 三层 (session + task + config) | 单层 global | 支持 automation 的 task-scoped standing rule；各有 owner |

### 4.4 权衡

- **durable resumability vs 协调复杂度**：三层 durable 设计让 agent 可跨 restart/surface/session 续完，但代价是 SessionManager god-class + 18+ stores + 多层 allowlist。**置信度：高**。
- **native provider 维护成本 vs API drift 适配能力**：自建 AnthropicProvider 需跟踪 pre-4.6/4.6+/Claude 5 thinking config + Fable/Mythos 5 safety classifier，但获得 model-family-specific 适配能力。**置信度：高**。
- **god-class 可读性 vs 多对象协议复杂度**：3505 LOC 单文件是 onboarding 负担，但拆分需 13+ 协作对象 + shared state 同步。代码中无 TODO/FIXME 拆分标记，maintainer 注释称之为 deliberate trade-off，但无法证实是永久决策——目前无拆分计划。**置信度：中**。

---

## 5. 意外发现

### 5.1 aisuite 的真实角色

**预期**：aisuite 是 provider 抽象基座，OpenWorker 在其上加 native provider。

**实际**：aisuite 是 toolkits/tracing 层 + OpenAI-compat plug-in (P12)，主要用作 `ToolMetadata` 容器（25 个文件 import aisuite，主要是 tools/*.py）。`ProviderClient` 是 OpenWorker 自建 ABC，`providers/base.py` 注释明确 "aisuite is OpenAI-API-shaped, AISuiteProvider slots in later (P12) without touching the engine"。

**如果 aisuite 移除**：`ToolMetadata` 需替换但 provider 层不受影响——系统仍能跑（tool 装配需重构但 agent loop 不变）。**置信度：高**。

### 5.2 SessionManager 无拆分标记

**预期**：3505 LOC god-class 应该有 TODO/FIXME 拆分标记或 refactor commit。

**实际**：`manager.py` grep `TODO|FIXME|HACK|XXX|refactor|split|break-up` 零匹配。代码注释说 "god-class 是协调复杂度的 deliberate trade-off"。证据只能推出 "目前没有拆分计划"，不能推出 "maintainer 有意识决定永远不拆"——无法证实是永久决策还是事后合理化。**置信度：中**（无反证，但也无正向证据）。

### 5.3 测试覆盖远超预期

**预期**：durable resume 等核心 invariant 可能仅靠 code review + 生产验证。

**实际**：`tests/` 目录有 65+ test files，包括 `test_durable_resume.py`（明确测试三层 durable design）、`test_standing_approvals.py`（§25）、`test_self_wake.py`、`test_slack_relay.py`、`test_mcp_oauth.py` 等。E2E 测试在 `surfaces/gui/e2e/` 有 50+ spec files + `e2e-live/` 真实 API smoke test。pytest 配置 `asyncio_mode='auto'`。**置信度：高**。

### 5.4 三种部署模式共存

**预期**：Tauri shell 是主要入口。

**实际**：`pyproject.toml` 有三个 entry points——`openworker-server` (standalone uvicorn，可 headless)、`openworker` (textual TUI，terminal-only)、`openworker-connectors`。同一 Python 代码库支持 desktop sidecar + standalone server + TUI 三种部署。`_exit_when_orphaned()` 只在 `COWORKER_EXIT_WITH_PARENT=1` 时激活，standalone runs are unaffected。**置信度：高**。

---

## 6. 可复用知识

### 6.1 架构不变量

以下不变量是系统共同依赖的基本假设，违反任一都会破坏 durable resumability：

1. **§25 standing rule: external-risk only (never exec/write-local)** + exact-target binding——让 connector tool auto-allow 安全
2. **三层 allowlist 各有 owner**：session_allow_tools (TurnEngine) / task_rules (ScheduledTask) / auto_allow_tools (config)，deliberately NOT subject to connector exclusion
3. **history 里永远不留 orphan tool_calls**——Stop 路径必须给每个 pending tool_call 写 tool-error message
4. **canonical OpenAI-shape history 是多 provider 共享契约**——所有 provider per-call 转换
5. **roots 是 shared mutable list**——Kept by reference and re-read on every check，runtime add/remove folder takes effect without rebuilding engine
6. **MCP-backed connector 的 tool surface 是 PINNED subset**——drift can only shrink capability, not grow it
7. **extended thinking blocks 必须 verbatim replay** (含 signature) 在同 turn tool_use 之前——持久化在 _anthropic sidecar

### 6.2 可复用模式

| 模式 | 思想 | 适用场景 |
|------|------|---------|
| **三层 durable resumability** | engine.resume (跨 restart) + Inbox idempotent (跨 surface) + orchestrator 重建 (跨 session 生命周期)——维度正交 | 任何 long-running agent runtime (server-side / CLI / multi-tenant SaaS) |
| **§25 standing rule** | task-scoped {tool: {allowed targets}} + external-risk only + exact-target binding | automation-safe permission——让 agent 对 declared target 自动放行不阻塞 scheduler |
| **canonical OpenAI-shape + per-call conversion** | history 是 canonical，每个 provider per-call 转换 | 多 provider 共享 history——mid-conversation 模型切换 |
| **data-driven connector descriptor** | Adding a connector is mostly data, not UI code (descriptor + fields + validate) | 扩展性——connector/persona/provider 都是 data 驱动注册 |
| **MCP-backed connector PINNED subset** | tool surface 是 PINNED subset，never vendor full catalog | vendor drift 安全——drift can only shrink capability, not grow it |
| **Inbox as canonical cross-session queue** | store of record; messaging connectors / mobile are transports of same items | 多 surface human-attention——同一 item 从任何 surface 解 |
| **context_provider ephemeral 注入** | plan/discuss reminder + directory list 注入 last user message (send-time only, never persisted) | mid-thread system messages 不可靠的通用解法 |

### 6.3 Desktop-only 不可复用设计

- **Tauri shell supervisor**（`COWORKER_EXIT_WITH_PARENT` + 单实例锁 + close-to-tray + keep-awake）是 desktop 专属
- **caffeinate / SetThreadExecutionState keep-awake** 是 desktop 专属（保证 scheduled tasks 在 Mac idle 时仍能 fire）
- **managed OAuth via OpenWorker Cloud 的 relay** 是 desktop 云增强（server-side 可直接 OAuth）

---

## 7. 风险

| 风险 | 严重度 | 证据 |
|------|--------|------|
| SessionManager 3505 LOC onboarding 负担 | 中 | ev-030——maintainer 注释称 deliberate trade-off，但新开发者需理解 13 类职责 |
| 多 provider API drift 维护成本 | 中 | ev-020——Anthropic pre-4.6/4.6+/Claude 5 thinking config + Fable/Mythos 5 safety classifier 需持续跟踪 |
| 18+ stores 的 shared state 同步 | 中 | ev-030——所有 cross-cutting state 需 shared access，未来扩展可能迫使拆分 |
| aisuite pinned to commit | 低 | ev-034——pyproject.toml 注释 "swap for a PyPI pin once next aisuite release ships"，目前是供应链风险 |

---

## 8. Architecture Risk Analysis（Blast Radius）

> 如果我要改这里，会炸哪里——修改核心组件的影响范围与风险等级。

| 修改点 | 影响范围 | 风险等级 | 理由 |
|--------|---------|---------|------|
| **TurnEngine loop** | orphan invariant / durable resume / tool parallelism / approval chain / provider stream bridging | **Critical** | 多个 invariant 同时依赖 loop 正确性——改 loop 逻辑会同时影响 orphan 防护、durable resume 重放、tool 并行/串行分流、approval interception、stream cancel 竞速 |
| **SessionManager** | permission seeding / scheduler / inbox / resume / routing / 18+ stores | **Critical** | 所有 cross-cutting state 集中于此——改 SessionManager 影响 engine 装配、task rules seeding、inbound 路由、scheduled task 执行、cross-session coordination |
| **canonical OpenAI-shape history** | provider replay / thinking block / tool_call conversion / mid-session model switch | **High** | 所有 provider per-call 依赖此格式——改 history 结构需同步改所有 provider converter + durable resume 重放逻辑 + thinking block verbatim replay |
| **Inbox 状态机** | durable resume / multi-surface resolution / approval chain | **High** | `(session_id, tool_call_id)` idempotent 契约 + first-responder-wins——改 Inbox 状态机会影响 durable resume 的 for_tool_call() 复用 + 多 surface 同一 item 解析 |
| **§25 standing rule** | automation safety / permission chain / task-scoped auto-allow | **High** | external-risk only + exact-target binding 是 automation-safe 的基础——改 standing rule 语义会影响 scheduled task 的 auto-allow 安全性 |
| **PermissionEngine 5 mode** | approval flow / session_allow / task_rules / auto_allow | **Medium** | 4 层 allowlist 依赖 mode 判定——改 mode 语义影响整个 permission chain |
| **MCPManager** | MCP server lifecycle / tool registration / OAuth | **Medium** | dedicated asyncio task + anyio cancel scope——改 lifecycle 管理 affecting MCP server 连接稳定性 |
| **ConnectorDescriptor** | connector registration / wizard UI / tool surface | **Low** | data-driven——改 descriptor 结构 mostly data migration，adapter 层不受影响 |
| **Persona manifest** | agent materialization / skill loading / recommends | **Low** | YAML frontmatter——改 manifest schema 需 to_agent() 同步，但影响面局限于 persona loading |

### 改动危险等级速查

```
Critical  ─── TurnEngine loop, SessionManager
    │         （改这里 = 改架构中心）
    ▼
High      ─── canonical history, Inbox 状态机, §25 standing rule
    │         （改这里 = 破坏多个 invariant）
    ▼
Medium    ─── PermissionEngine modes, MCPManager
    │         （改这里 = 影响单子系统）
    ▼
Low       ─── ConnectorDescriptor, Persona manifest
              （改这里 = mostly data migration）
```

---

## 9. 架构演进（Evolution Timeline）

> 系统为何演变成今天这样——从 git 历史与代码注释推断。

### 9.1 关键发现：仓库于 2026-07-21 批量导入

```
git log --all --oneline --format="%ad %h %s" | head -5

2026-07-24 4766e59 Keep ripgrep searches out of generated directories (#10)
2026-07-23 4ffc73f README: Minor updates.
2026-07-23 f7c70a2 README: add how-it-works diagram from the website
...
2026-07-21 2b45018 OpenWorker: initial import          ← 整个架构在此 commit 一次性导入
```

**git 历史仅 4 天**（2026-07-21 ~ 2026-07-24），首个 commit `2b45018 OpenWorker: initial import` 包含完整架构。这意味着：

- 架构演进（per-agent-name → traits、Slack-only → RelayHub、fire-and-forget → durable thread、aisuite → native provider）发生在 **import 之前的私有仓库**
- git history 无法用于验证演进时间线——history 维度 coverage 受限于仓库本身
- 代码注释是唯一的演进证据来源

### 9.2 从代码注释推断的演进事件

| 事件 | 证据 | 推断的动机 |
|------|------|-----------|
| per-agent-name branching → traits-based branching | ev-017, ev-011 注释 "replace the old per-agent-name branching" | Agent 抽象从硬编码 if-else 转为 traits 驱动的 declarative 装配 |
| 手写 tool factory → catalog.expand | ev-012 注释 "was a hand-written factory" | Tool 装配从 imperative factory 转为 data-driven catalog expand |
| Slack-only relay → RelayHub 抽象 | ev-023 注释 "when GitHub became the second relay provider we abstracted RelayHub out" | Relay 从 Slack 专属转为 multi-provider shared transport |
| aisuite as provider → aisuite as OpenAI-compat plug-in + native provider | ev-018 注释 "AISuiteProvider slots in later (P12)" + ev-020 完整 native AnthropicProvider | API drift 适配需要 model-family-specific 处理 |
| fire-and-forget scheduled task → durable conversation thread | ev-030 注释 "scheduled agent is no longer fire-and-forget" | 支持 parked approval + task-scoped standing rule |
| Anthropic API drift 适配 | ev-020 pre-4.6 vs 4.6+/Claude 5 thinking config + Fable/Mythos 5 safety classifier | Provider 必须跟踪 vendor API drift |

### 9.3 import 后的 4 天迭代（2026-07-21 ~ 2026-07-24）

| 日期 | 关键 commit | 内容 |
|------|------------|------|
| 07-21 | `2b45018` | OpenWorker: initial import——完整架构一次性导入 |
| 07-21 | `cffec6b` | rename artifact names to openworker (从 ocw 改名) |
| 07-21 | `7f6f17c` | standalone-repo fixes——venv at repo root, aisuite as pip dep, keyless builds |
| 07-21 | `2451486` | port aisuite#380: slack installer pre-add, mcp oauth quarantine, automation toast |
| 07-21 | `61bd287` | port aisuite#381: Obsidian connector |
| 07-22 | `878b858` | Persist error/interrupt markers in history; add Retry on failed turns |
| 07-22 | `f1eb652` | Allow mid-session model switching with persisted transcript marker |
| 07-22 | `55ff8b7` | Anthropic extended thinking, opt-in via provider thinking_budget field |
| 07-22 | `1032e3a` | Persist Always-allow grants with the session |
| 07-23 | `eae5fbd` | Fix Anthropic extended thinking for current model families |
| 07-23 | `ba99978` | Enable Claude extended thinking by default, drop the settings field |
| 07-24 | `4766e59` | Keep ripgrep searches out of generated directories |

**观察**：import 后的迭代集中在 (1) extended thinking 适配（Anthropic API drift）、(2) 持久化增强（Retry / Always-allow grants / interrupt markers）、(3) 改名与打包。核心架构未变——证实架构在 import 前已稳定。

### 9.4 局限性

- **无法验证演进顺序**：代码注释只提及 "old" 与 "new"，无时间戳
- **无法验证演进动机**：注释给出 reason，但无 RFC/ADR/issue 链接佐证
- **无法发现未记录的演进**：可能存在未在注释中提及的架构变更
- **history coverage 维持 0.40**：受限于仓库 bulk-import 特性，非分析不足

---

## 10. 未解问题

| 问题 | 优先级 | 缺失证据 | 置信度影响 | 建议下一步 |
|------|--------|---------|-----------|-----------|
| 仓库 bulk-import 前的私有演进历史（per-agent-name→traits、Slack-only→RelayHub 等发生在哪个私有仓库）？ | Medium | git history 仅 4 天（2026-07-21 bulk-import），演进事件只能从代码注释推断 | history 维度 0.40 受限于仓库特性，非分析不足 | 寻找私有仓库或 design doc |
| OpenWorker Cloud 侧代码在哪？ | Low | 未找到 cloud 侧代码 | 低，不影响 desktop 侧架构理解 | 确认 cloud 是否单独仓库 |
| Inbox 5 种 kind (approval/question/notification/directory/plan) 在实际使用中是否都有场景？ | Low | 未统计使用频率 | 低，不影响架构理解 | 生产使用数据统计 |

---

## 11. 证据质量摘要

### 证据覆盖度

| 维度 | Coverage | 关键证据 |
|------|---------|---------|
| runtime | 0.85 | ev-016 (TurnEngine), ev-017 (build_engine), ev-025 (Inbox), ev-026 (selfwake), ev-027 (scheduler) |
| architecture | 0.95 | ev-011~ev-031 全部，ev-034 (aisuite 角色), ev-035 (connector 扩展) |
| design_decisions | 0.95 | ev-013 (persona), ev-020 (native provider), ev-021 (permission), ev-028 (descriptor), ev-031 (综合) |
| testing | 0.75 | ev-033 (65+ test files + test_durable_resume + E2E) |
| deployment | 0.60 | ev-015 (Tauri), ev-032 (三种部署入口) |
| history | 0.40 | git log 仅 4 天（2026-07-21 bulk-import）+ 代码注释推断 (per-agent-name→traits, Slack-only→RelayHub, fire-and-forget→durable thread)——history coverage 受限于仓库 bulk-import 特性 |

### 置信度分布

- **高置信度**：TurnEngine 是架构中心、三层 durable 设计、aisuite 真实角色、三种部署模式、测试覆盖度、§25 standing rule、canonical OpenAI-shape history
- **中置信度**：SessionManager god-class 是 deliberate trade-off（maintainer 注释称 deliberate trade-off，无 TODO/FIXME 标记，但无法证实是永久决策还是事后合理化）、Inbox 5 kind 必要性
- **低置信度**：bulk-import 前的私有演进历史、OpenWorker Cloud 侧实现

### 证据来源分布

- **源代码**（A 级）：27 条 evidence 全部基于源代码阅读，21 条 Round 1 + 6 条 Round 2
- **文档**：代码注释/docstring 提供设计意图与演进线索
- **配置**：pyproject.toml 揭示 entry points + dependencies + aisuite 角色
- **测试**：tests/ 目录 + test_durable_resume.py 验证核心 invariant
- **Git 历史**：已分析——仓库于 2026-07-21 bulk-import，仅 4 天 history，演进时间线只能从代码注释推断（history 维度 0.40 受限于仓库特性）

---

## Quality Gate

报告完成前自问：

1. **多重证据？** 是——TurnEngine 中心有 ev-016/ev-030/ev-031 三重证据；三层 durable 有 ev-016/ev-025/ev-030/ev-031 + test_durable_resume 验证
2. **替代解释？** 是——SessionManager god-class 提出 deliberate trade-off vs 技术债两种解释，证据无法证实是永久决策还是事后合理化，已如实标注
3. **重要决策？** 是——6 个关键决策 + 7 个架构不变量 + 7 个可复用模式 + 9 个 Blast Radius 风险评估
4. **Unknown 掩饰？** 否——3 个未解问题明确标注；history 维度 0.40 如实反映（仓库 bulk-import，仅 4 天 git history，非分析不足）
5. **洞察 vs 堆砌？** 洞察——三层 durable 正交性、aisuite 真实角色、§25 exact-target binding、bulk-import 演进约束是非显然发现
6. **Neutrality？** 是——绝对化结论已软化（"不可能" → "当前抽象层无法覆盖"；"deliberate trade-off" → "maintainer 注释称，但无法证实是永久决策"）
