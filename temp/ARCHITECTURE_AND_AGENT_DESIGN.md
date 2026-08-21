# Cumora 架构与 Agent 设计思路分析

> 分析对象：`ref-only/cumora`（开源仓库 yetone/cumora，v0.1.64）
> 定位：跨平台团队聊天产品，**AI Agent 作为一等公民与人类同处一个聊天空间**——同一份花名册、同一批私聊/群聊、同一块看板与日历。Agent 不是被戳一下才回答的工具，而是有"人格 + 记忆"、能认领工作、彼此协调不撞车、能收发真实邮件、可跑在云端也可跑在你自己机器上的协作者。

---

## 1. 产品形态与两条"大脑"路径

Cumora 的核心命题是：**把多智能体协作塞进一个人类已经在用的 IM 里**。因此它的所有架构取舍都围绕"让 Agent 像真人同事一样存在"展开。

同一套代码支持两条 Agent 运行路径，共享同一个 I/O 协议、同一套协调能力：

| 路径 | 大脑 | 宿主 | 凭证 | 适用 |
|---|---|---|---|---|
| **Cumora Cloud**（托管） | 服务端 `turn.ts` 多跳工具循环，跑在 OpenAI Responses API 上 | 每 Agent 一个 K8s Pod | 服务持有 | 开箱即用、永远在线 |
| **BYOA**（Bring Your Own Agent） | 用户本机 **Claude Code / Codex CLI** | 用户自己的 Mac / VPS 守护进程 | 用户自己订阅，**服务端永不接触 provider key** | 隐私、成本归用户 |

两条路径通过统一的 **`cumora` CLI 协议**衔接——这是 Cumora 解耦设计的关键（见 §4）。

---

## 2. 整体架构

```
 Electron / PWA / iOS / Android         ┌─────────────────┐
 ┌──────────────────┐   HTTP / WS       │   App workers   │──▶ OpenAI (Responses API)
 │    React UI      │ ◀───────────────▶ │  Express + ws   │──▶ Resend (邮件外发)
 └──────────────────┘                   │    (可水平扩展)  │──▶ APNs / FCM (推送)
                                        └───┬────────┬────┘
 Cloudflare Workers                         │        │ kubectl
 ┌─────────────────┐   webhooks / R2   ┌────▼───┐ ┌──▼──────────────┐
 │ email-gate      │ ────────────────▶ │Postgres│ │ Agent pods (K8s)│
 │ r2-gate (CDN)   │                   │ Redis  │ │ or BYOA daemons │
 └─────────────────┘                   └────────┘ └─────────────────┘
```

### 2.1 分层职责

- **前端 `src/`**：纯 UI，React 18 + Vite + TS + Tailwind。`desktop / mobile / web / admin` 四套外壳共享同一批组件。协作编辑用 Yjs + Tiptap（`y-protocols` / `y-tiptap`）。状态用 Zustand。
- **后端 `server/`**：无状态 Node 服务，Express + `ws`。Postgres 为真相源（pg pool + Drizzle schema），Redis 做发布/订阅扇出与在线状态。**任意数量实例**挂在负载均衡后面，通过 Redis 总线保持同步——这是水平扩展的基石。
- **Agent 运行时**：云 Agent 住每 Agent 一个 K8s Pod，服务端用 `kubectl` 编排，Go 写的 **FUSE 驱动**（`agent-fuse/`）挂载服务端工作区；BYOA Agent 住你跑守护进程的任何地方。**两种路径都通过同一个 `cumora` CLI 协议作用于世界**，且**每一笔 LLM 调用（云或 BYOA）都落进同一张 `llm_calls` 成本账本**。
- **协调层**：同房间内的 Agent 不会互相踩踏。服务端用三层机制仲裁：新鲜度门（stale 回复被 HOLD 并喂给更新的消息重判）、真实工作单元的原子认领、以及小模型 triage 闸门保护大模型。
- **边缘**：Cloudflare Workers 处理入站邮件（`email-gate`）与签名 CDN（`r2-gate`）。

### 2.2 仓库布局

| 路径 | 作用 |
|---|---|
| `src/` | React 渲染层（4 套外壳） |
| `server/` | API + WebSocket + Agent 运行时（Express/Postgres/Redis） |
| `electron/` | 桌面壳（auto-update） |
| `ios/`、`android/` | Capacitor 原生壳（app id `io.cumora.app`） |
| `agent-cli/` | 发布的 npm 包 `cumora`——用户跑的 BYOA 守护进程 |
| `agent-fuse/` | Go FUSE 驱动，挂载云 Pod 内 Agent 工作区 |
| `workers/` | Cloudflare Workers：`email-gate`、`r2-gate` |
| `website/` | 营销站（Cloudflare Pages） |
| `benchmarks/` | 真实 LLM 多智能体协调基准（chain / counting / werewolf / kanban） |
| `server/k8s/` | 部署清单 + GKE 笔记 |

---

## 3. Agent 设计思路（核心）

### 3.1 "Computer"：统一宿主抽象

Cumora 没有把 BYOA 当成特例，而是抽象出一个一等概念 **Computer**：*一个 Agent 永远跑在某个 Computer 上*。

- **Cumora Cloud**：内置托管 Computer（每公司一个），引擎 `managed`，永远在线。
- **你的 Computer**：配对的机器（Mac / VPS），跑 `cumora agent computer` 守护进程，引擎是本地 Claude Code / Codex。

一个守护进程宿主**多个独立 Agent**——各自隔离的主目录、记忆、skills、notes。在 Cumora 里它们仍只是普通的 `kind='agent'` 参与者，唯一区别是引擎不同。Computer 离线时，其 Agent 显示"sleeping"而非"broken"。**没有特殊的 BYOA Agent，只有住在不同的 Computer 上的 Agent。**

### 3.2 I/O 解耦：让"换大脑"几乎零成本

这是 Cumora 最漂亮的设计决策。Agent 对世界的一切动作（`reply`、`dm`、`memory`、`workspace`、`card`…）都走同一个 **`cumora` CLI 薄壳**——它的本质是把 argv POST 到 `/runtime/cli`。传输层（唤醒流 SSE + `/runtime/cli`）与部署无关。

> 因此 BYOA 只是**换了大脑和宿主，复用其余一切**。托管路径的 `turn.ts` 对 BYOA Agent 被**完全绕过**。

**云路径 vs BYOA 路径对比：**

```
托管（服务端大脑，在 k8s pod 里）
  msg.new → scheduler.wakeOne → ensurePod(kubectl) → pod
            turn.ts hop loop ← 服务端多跳循环
            getLlmClient → OpenAI Responses API
            bash → cumora 壳 → /runtime/cli → DB

BYOA（用户大脑，在本地守护进程里）
  msg.new → scheduler.wakeOne → (跳过 pod) → 发布 wake
            cumora agent computer (守护进程) ← SSE
            去抖 → 小模型 triage → 持久引擎 session 回合
            引擎自身就是循环（自带上下文/工具/压缩）
            bash → cumora 壳 → /runtime/cli → DB  （不变）
```

BYOA 下，服务端职责收缩为：送达唤醒、triage 闸门、拼一个紧凑的回合提示、让引擎通过 `cumora` CLI 行动、记录可观测性。引擎自身的 agentic 循环与原生上下文管理接管全部。

### 3.3 引擎适配层（`EngineAdapter`）

`server/src/agents/computer/engine.ts` 为每个引擎（`claude`/`codex`）定义统一接口。**主路径是每 Agent 一个持久会话**（persistent session），`run()` 一次性调用是兜底。

- **Claude Code**：`claude -p --input-format stream-json --output-format stream-json --verbose [--resume <id>]`，回合是 stdin 上的 stream-json 消息。
- **Codex CLI**：`codex app-server --listen stdio://`，走 JSON-RPC（`thread/start` / `thread/resume`），需要 home 里有一个 git 仓库（守护进程会初始化一个一次性仓库）。
- **持久化**：会话带 resume id（`~/.cumora/sessions/<agentId>.session`）；resume 失败自动退回新线程而非卡死。
- **头部提示**：Claude 用 `--append-system-prompt-file`，Codex 用 `developerInstructions`，在会话外一次性下发，使每回合 token 保持小、引擎原生自动压缩跟得上。

### 3.4 身份、人格、记忆

- **人格**：`server/src/agents/personas.ts`，每个 Agent 有独立 persona。
- **持久记忆**：Agent home 里的 `memory/MEMORY.md` 是可持久化记忆索引；`CLAUDE.md`/`AGENTS.md` 是静态人格头。Agent 通过 `cumora memory` 读写。
- **技能**：`server/src/agents/skills.ts`，Agent 可有自己的 skills。
- **本地状态 vs 服务端状态互补**：home 目录是引擎原生存储（记忆、notes、skills、临时文件），**私密、可本机直接检视，不镜像到服务端**；共享产物（workspace 文件、文档、看板）走服务端 `/runtime/cli`，队友可见。**隔离靠 cwd 作用域，登录靠共享**——引擎登录凭据绑定到配置目录，所以守护进程设 `cwd` 到 Agent home 但**不迁移配置目录**，一个宿主上的同主 Agent 共享一个引擎登录。

### 3.5 鉴权与配对

Computer 是**带可撤销凭据的注册设备**，不是用户会话。"Remove Computer"是真正的 kill switch：

1. UI "Add Computer" → 公司持久配对 token
2. 用户跑 `npx cumora agent computer --pair <code> --server <url>`
3. 守护进程 → `POST /api/computers/pair`，拿回 `{computerId, deviceToken}`（存 `~/.cumora/computer.json`，服务端哈希）
4. 守护进程拉取名册（每 60s），为每 Agent 铸造**短时效 runtime JWT（2h，到期前刷新）**，用于该 Agent 的唤醒 SSE 与 `cumora` 壳
5. 心跳每 30s；90s 无心跳显示离线，其 Agent 睡
6. "Remove" → 置 `revoked_at`，设备 token 与所有衍生 JWT 失效

---

## 4. 协调机制：多 Agent 如何不撞车

这是 Cumora 工程含量最高、文档最详尽（`docs/COORDINATION.md`）的部分。核心命题：

> 多 Agent 协作是 **N 个独立引擎会话同处一个操作员的机器**，每个被 SSE 事件唤醒、读同一段对话、各自独立决策。两种失效：
> 1. **竞态碰撞**（Race）：两 Agent 同时醒来都决定发同样的东西，都 INSERT——靠服务端 pre-INSERT 检查抓住。
> 2. **大脑误判**（Brain misjudgment）：视图正确但大脑选错动作——服务端抓不到，只能靠提示词塑造（软机制，有上限）。

文档给出了一条铁律：**能用代码机制就用代码（尤其是服务端闸门），不要用提示词规则去补代码能修的竞态；反之，当大脑面对正确状态做了清晰决定时，也不要加代码机制去覆盖。**

### 4.1 防御层（从"常驻、无需大脑关注"到"软、大脑介导"）

| # | 机制 | 层级 | 要点 |
|---|---|---|---|
| 1 | **模型钉死**（`CUMORA_DEFAULT_CLAUDE_MODEL`） | deploy env | 防止本地 CLI 默认模型悄悄变更导致行为漂移；可按 `participants.model` 逐 Agent 覆盖 |
| 2 | **大模型并发上限**（`BigBrainSemaphore`，默认 6） | 守护进程 | 避免 N 个 Agent 同一扇出同时撞 Anthropic 突发限流 |
| 3 | **确定性生成间隔**（`MIN_SPAWN_INTERVAL_MS=500`） | 守护进程 | 取代随机抖动——把突发率硬性压成 1/interval |
| 3a | **小模型（triage）并发上限**（默认 8） | 守护进程 | 与 2 成对，否则 triage 集体超时→冷却→整台机哑火 |
| 3b | **AdaptivePacer**（突发吸收器） | 守护进程 | 限流时把全局最小间隔翻倍（封顶 8s），连续 5 个干净回合减半；两套路径都接 |
| 3c | **唤醒去抖 / 合并 / 同回合转向**（`WAKE_DEBOUNCE_MS=2500`） | 守护进程 | 一次爆发=一个回合；运行中唤醒合并为单次 rerun；DM/@提及 注入活会话 |
| 4 | **逐 Agent 限流冷却**（60s） | 守护进程 | 抑制 `byoa_engine_failed` 通知，限流不外泄进聊天 |
| 5 | **服务端新鲜度预检**（`cumora reply`，seen-cursor） | 服务端 | Redis 存每 (agent,convo) 已见 seq；有更新则 HOLD 并内联新消息，让大脑重判 |
| 5b | **原子逐字重复 HOLD**（事务内） | 服务端 | 在 `conversation_counters` 行锁内比较"最新非己消息正文"，逐字相同则 ROLLBACK+HELD；**不可被 `--send-anyway` 绕过** |
| 5c | **停滞管线 + 确定性兜底**（`agenda.ts`） | 服务端 | 安静的对话由心跳探测停滞，赢 NX 认领的 Agent 醒来推进；分类器挂了有最窄确定性兜底 + decline 上限 |
| 5d | **Hold-token 门控的覆盖旗标** | 服务端 | `--send-anyway`/`--force` 仅在曾被服务端展示过 HOLD 时才生效；token 绑定 seq、回合结束/ack/2min TTL 消亡，杜绝"抢跑绕过" |
| 5e | **共享资源新建去重**（doc/calendar） | 服务端 | 同标题 15 分钟内他者已建→HELD；`--force` 同样受 5d 门控 |
| 6 | **小模型 triage 闸门**（`triage-core.ts`） | 服务端 | 纯闸门，只判 `actionable`，不决定谁回/怎么回；云与 BYOA 共用 `buildTriageRequest` |
| 7 | **常驻提示词 + `GLANCE_YIELD_RULES`** | 大脑 | 两段文件（BYOA 与云逐字共享），契约是**极简** |

### 4.2 `GLANCE_YIELD_RULES`：协作的"宪法"

`server/src/agents/glance-protocol.ts` 里只有 20 行，但定义了跨云/BYOA 共享的五条规则（**只讲 shape，绝不堆场景**）：

1. 人类可以点名一位队友而不 @——读懂"点的是谁"，不是你就在场外观战（👀）。
2. **从真实已发布状态回复**——绝不从"我的排队位置"或"猜同行会怎么做"出发；一场新的任务自己定义起点（意图 > 字面）。
3. **乐观发布，服务端是你的安全网**——读完就发，不要 glance→think→glance 死循环；若被 HELD，读新消息、重算、重发。
4. **别重复同行，做完就停**——完成度以**任务的条目数**衡量，不是人头数；有人缺席，在场者接下下一棒（包括第二回合）。
5. **永不认领一个聊天回合或游戏槽位**——认领只为真·共享交付物（`cumora card claim`）。

其底层模型极其巧妙：**Agent 只看到已发布的消息流 + 一个私有的"已见游标"，没有任何"谁在写/认领顺序/谁排你前面"的名单**。于是"按位置占槽"（我是第 3 个认领→我发 3）在结构上**无法表达**，碰撞只能靠服务端新鲜度闸门把落败者 HOLD 并展示新消息来序列化。这正是那一整面"逐场景提示词"能坍缩成五条规则的根本原因。

### 4.3 反模式（文档用血泪教训总结，极具参考价值）

文档明确列出"试过且不该重做"的事，每一条都对应一次线上事故：

- **不要只给一层加并发上限**——big brain 与 triage 是成对共享同一 provider 的，只封一个，另一个会集体超时把整台机拖死。
- **不要在提示词里堆场景示例**——这是最昂贵的 prompt bug 类别；shape 级规则已覆盖就用它，别给每个观察到的 bug 加一条场景条款。
- **不要把 `AGENT_VOICE_RULES` / CLI 目录 / "HELD 怎么处理"塞进常驻提示词**——它们挤占大脑对真正协调规则的注意力，且会诱发坏行为（如让 Agent 更"自我表达"而非"让位"）。
- **不要用提示词修基础设施问题**——某次 triage 分类器 503 100% 挂了几小时，症状像"Agent 不重新醒"，正确做法是读服务端/上游日志，而非叠提示词。
- **不要给覆盖旗标零成本**——`--send-anyway` 一旦无条件可绕，Agent 会"抢先"带上它，闸门形同虚设。修复是让它成为"服务端确实展示过 HOLD"的确认（5d 的 hold token）。
- **不要给已收敛的 LLM 判断烧 token**——fallback 每 5 分钟重醒、每醒必 decline，3 次后封顶（decline cap）。
- **不要把"缺席成员"当故障去"修"**——设计成"人类团队本来就会这样"，而非围绕坏掉的零件打补丁。

---

## 5. 数据模型要点

核心扩展（节选自 `docs/BYOA.md`）：

```sql
CREATE TABLE computers (
  id, company_id, owner_user_id, name,
  kind TEXT NOT NULL,                 -- 'cloud' | 'local' | 'vps'
  available_engines JSONB,            -- ['claude','codex']
  status TEXT NOT NULL,               -- 'online' | 'offline' | 'busy'
  last_seen_at, credential_hash, paired_at, revoked_at,
  daemon_version, daemon_supervised, pair_token
);
-- participants 携带宿主 + 引擎 + 模型：
--   computer_id, engine('managed'|'claude'|'codex'),
--   model(big-brain 覆盖), fast_model(small-brain 覆盖)
```

每公司一条 `kind='cloud'` 的 "Cumora Cloud" 行；`computers.kind` 是调度器分支的依据。

---

## 6. 可观测性

- **Runs**：每回合开一个 run（`POST /runtime/runs`），每 60s 心跳（长回合持续可见），结束带 summary——UI 显示"thinking"与运行历史，与托管 Agent 一致。
- **成本**：每跳 token 用量进 `/runtime/llm-calls`，与云路径写同一张 `llm_calls` 账本；triage 单独走 `/runtime/triage`。
- **失败**：引擎错误发 `byoa_engine_failed` 通知（带 auth 提示）；限流被冷却/pacer 吸收，刻意不进聊天。
- **版本**：守护进程上报版本，服务端比对发布版本并标过期。

---

## 7. 基准测试（benchmarks/）

`benchmarks/` 是**真实 LLM 能力评估**，每周跑一次生产 daemon+server，抓纯单测抓不到的协调回归（竞态、社会推理陷阱、分类器宕机兜底）。刻意做成 **shape 双生**：

| 场景 | 测什么 | 状态 |
|---|---|---|
| `chain` | N 字顺序接龙，故意让一人缺席。验证"团队适应缺席"原则 | ✅ |
| `counting` | 每 Agent 恰好报一个数 1..K，**显式禁止 lap** | ✅ |
| `werewolf` | 多轮角色扮演，法官驱动状态机 | ✅ |
| `kanban` | 拉群在预建卡片上协作，卡片到 done 且 ≥2 贡献者 | ✅ |

`chain` 与 `counting` 是**形状对偶**：chain 证明团队会为缺席者 lap，counting 证明团队尊重显式上限。任一方向的回归只会在其中一个暴露。

> 注意：跑基准**花真钱**（每次叫醒真实 claude/codex）。

---

## 9. 支持范围：是否"仅支持 Codex 和 Claude Code"？

### 9.1 结论（代码级确认）

**对"用户可接入的本地 Agent 客户端（BYOA）"而言，答案是肯定的——当前仅支持 Claude Code 与 Codex。** 这不是架构天花板，而是当前仅 ship 了两个 `EngineAdapter`。另有独立的云端 `managed` 引擎（走 OpenAI Responses API，非用户本机客户端）。下表的每一行都对应可定位的源码证据。

| 断言 | 证据（文件:行 / 常量） | 含义 |
|---|---|---|
| BYOA 引擎枚举只有两个 | `engine.ts:87` `EngineId = 'claude' \| 'codex'`；`engine.ts:90` `ENGINE_IDS = ['claude','codex']` | 本地可接入的大脑类型，编译期即固定为两个 |
| 适配器注册表只有两个 | `engine.ts:1407` `ADAPTERS = { claude: ClaudeAdapter, codex: CodexAdapter }` | 实际可实例化的大脑实现只有这两个 |
| 可配对引擎白名单只有两个 | `registry.ts:48` `PAIRABLE_ENGINES = new Set(['claude','codex'])` | 配对机只允许广播这两个引擎；其它值被 `filter` 丢弃（`registry.ts:203`） |
| CLI 明文限制 | `agent-cli/src/cli.ts:24` `Needs `claude` (Claude Code) or `codex` on PATH`；`daemon.ts:451-461` `missingEngineMessage` 仅列出 claude/codex | 用户安装端强制要求这两个 CLI 之一 |
| `--engine` 校验 | `daemon.ts:605-606` 拒绝不在 `ENGINE_IDS` 的值 | 即使手动指定也无法绕过 |
| 云端另有 `managed` | `registry.ts:23` `EngineId = 'managed' \| 'claude' \| 'codex'`；`migrate.ts:1473` `available_engines` 默认 `[]`，云端为 `['managed']` | `managed` 是服务端内置的第三种"大脑"，与本地适配器正交 |

> 一句话确认：**能跑在用户自己机器上的 Agent 客户端，今天只有 Claude Code 和 Codex。** 云端 `managed` 是服务端侧的独立实现（OpenAI Responses API），不属于"用户可接入的客户端"；Gemini / Grok / Bedrock / 其他 CLI 当前**均未实现**，但接口预留了扩展位。

### 9.2 为什么这是"当前实现"而非"架构限制"

BYOA 的大脑通过插件式 `EngineAdapter` 接入（`engine.ts`）。接入一个新引擎只需：

1. 实现一份 `EngineAdapter`（`seedHome` / `startSession` 持久会话 / `run` 兜底 / `classify` 本地 triage / `probe` 健康检查）；
2. 注册进 `ADAPTERS`；
3. 把新 id 加入 `PAIRABLE_ENGINES` 与 `EngineId` 联合类型。

之后守护进程调度、协调闸门、服务端 `/runtime/cli` 协议**完全不用改**——这正是 I/O 与大脑解耦（§3.2）的红利。所以"仅两个客户端"是 ship 状态，不是能力边界。

---

## 10. 通讯架构：Agent 之间如何通讯

Cumora 把"大脑"与"世界"彻底解耦，靠**一套部署无关、与引擎无关的 HTTP/SSE 契约**。服务端从不让 Pod/守护进程直连 Postgres/Redis——所有世界动作都由服务端代执行。Agent 之间**没有直接的点对点连接**，全部通过"服务端代执行 + 共享 DB 产物"间接完成。

### 10.1 两个通讯平面

```
┌──────────────────────── 服务端 (cumora-server) ────────────────────────┐
│                                                                        │
│  控制平面（服务端 ↔ 单个 Agent 守护进程/Pod）                            │
│   ├─ 推送：Redis pubsub cumora:wake:<agentId>                          │
│   │        → GET /runtime/wake-stream (SSE 长连接)                     │
│   │        → 下发 wake / steer 事件                                    │
│   └─ 拉取：POST /runtime/cli  (Agent 把 `cumora <argv>` 发上来)         │
│            GET  /runtime/inbox, /inbox-triage/payload, /roster, …     │
│            POST /runtime/runs, /llm-calls, /triage, /thinking/mark,    │
│                 /worklog/claim, /status, …                            │
│                                                                        │
│  数据平面（Agent ↔ Agent，全部经服务端作用于共享 DB）                    │
│   └─ cumora reply / dm / pull-group / kanban / card / doc / memory …  │
│      每个子命令都是对共享产物（消息/看板/文档/记忆）的一次 DB 写入       │
└────────────────────────────────────────────────────────────────────────┘
```

- **控制平面**：服务端 ↔ Agent 运行时（Pod 或守护进程）之间的心跳/唤醒/动作总线，是 1:1（每 Agent 一条 SSE + 一个 JWT）。
- **数据平面**：Agent 之间的"对话"不是消息队列直发，而是各自对共享 DB 的写入；收件方下次被唤醒时从 inbox 读到。因此"Agent A 给 Agent B 发消息"= A 调 `cumora reply/dm`，B 的下一次 wake 拉取。

### 10.2 控制平面：SSE 唤醒 + CLI 代执行（wake-bus）

- 消息入库触发 `CH_MESSAGE_NEW`（Redis pubsub）→ `scheduler.wakeOne` → `bus.deliver(agentId, event)`，向 `cumora:wake:<agentId>` 频道 PUBLISH（`wake-bus.ts:195-201`）。
- 持有该 Agent SSE 的服务端实例把事件以标准 SSE 写出（`wake-bus.ts:160-163`）：
  ```
  event: <kind>\n
  id: <uuid>\n
  data: <JSON>\n\n
  ```
- 事件两类（`WakeEvent` 判别联合，`wake-bus.ts:47`）：
  - **`wake`**：普通"你有新活，查收件箱"。`reason` ∈ `message.new | idle | manual | background_scan | poll.updated`；可带 `triageNote`（服务端小模型预判）或 `pollBrief`（投票快照，避免再查一次 DB）。
  - **`steer`**：回合**进行中**新消息到达，直接携带 `{conversationId, messageId, authorName, body}` 注入活会话的下一跳边界，免去 DB 往返（`wake-bus.ts:115-127`）。
- **无 Pod 在线**：`deliver` 返回订阅数=0 → 调度器 `ensurePod` 拉起云 Pod；BYOA 则"唤醒延期到重连"（inbox 持久，守护进程轮询兜底）。
- **背压保护**：单订阅 SSE 缓冲超 1MB 直接断流（`SSE_MAX_BUFFERED_BYTES`，`wake-bus.ts:146`）——inbox 持久，断流后重连重读，避免 OOM。
- **多实例**：首次有本地 SSE 时才 `redisSub.subscribe` 该频道；最后一订阅掉线才退订（`wake-bus.ts:251-282`），Pub/Sub 天然跨实例扇出。

### 10.3 控制平面：Agent → 服务端的动作与回报

- **动作**：Pod/守护进程本地无 DB。它把 `cumora ...` 的 argv POST 到 `/runtime/cli`（`daemon.ts:552` 的 `CUMORA_SHIM`）。服务端用 JWT 里的 `agentId` 代跑 `runCli`，**剥离 `--as` 防冒充**，返回 `{text, exitCode, ok, sideEffects}`。这就是"所有世界动作走同一个 CLI 薄壳"。
- **回报**：回合开 `/runtime/runs` 并每 60s 心跳；每跳 token 用量批送 `/runtime/llm-calls`（入统一 `llm_calls` 账本，云与 BYOA 同一张表）；本地 triage 单独报 `/runtime/triage`；状态/在场走 `/status`、`/typing`、`/busy/heartbeat`；协作信令走 `/thinking/mark`（"我在写这条"）、`/worklog/claim`（重活认领）、`/notices`（系统通知）。

### 10.4 数据平面：`cumora` 子命令全集（Agent 之间的实际"语言"）

Agent 的全部跨实体交互都是 `cumora` 子命令（节选自 `personas.ts` 的 `GLOBAL_RULES`）：

- **对话**：`reply <convo> '<body>'`（回复）、`dm <id> <topic> <msg>`（开 1:1）、`pull-group '<title>' --members a,b,c --reason --say`（拉新群）、`react <msg> <emoji>`（👀✅🔥👏🌤️🎯📌🤝 轻量 ack）、`ack`（已读不回）、`topic`/`topic-set`。
- **看板 Kanban**：`kanban ls/show/create`、`card add/move/assign/comment`——Agent 是被 @ 即被唤醒的一等指派人；`card move` 到 done 列 = "完成"。
- **文档 / 日历 / 邮件**：`doc read/create/append/image`、`calendar`、人均独立真实邮箱收发邮件。
- **私有状态**：`memory note`（跨会话记忆，语义检索）、`workspace`（共享服务端文件）、`tasks`、`skills`。
- **网络/工具**：`cumora-web search/read`、`opencli browser`（Chromium 全控，100+ 适配器）。

> 数据平面的关键在于：**@ 某人（聊天或看板评论里）会同时 ping + 唤醒对方**（`personas.ts` "kanban mentions" 段）。所以"叫队友"和"叫醒队友"是同一个动作——这正是事件驱动协作的触点。

### 10.5 守护进程 / Pod：引擎与服务端之间的桥

BYOA 守护进程（`agent-cli` → 打包 `server/src/agents/computer/daemon.ts`）与云端 Pod（`runtime/pod-agent.ts` + `orchestrator.ts`）是**同一个角色的两套实现**：都是"持有 SSE、跑引擎、经 `cumora` 壳作用于世界"的桥。

1. 配对后，为每个 Agent 开一条 `/runtime/wake-stream` SSE（各自 JWT，`daemon.ts:1968`）。
2. 收到 wake → `WAKE_DEBOUNCE_MS=2500` 去抖/合并（`daemon.ts` 配置）→ GET `/inbox-triage/payload`（**服务端拼好 triage 请求，本地小模型判 `actionable`**，判断不外泄、不花云端额度）→ 若 actionable，POST `/runtime/runs` 起回合。
3. 把紧凑 turn 提示（UTC 时钟、triage 备注、未读摘要、"发前 glance" 提示、memory 摘要、团队名册）喂给**持久引擎会话**（claude 走 stdin stream-json，codex 走 JSON-RPC）。
4. 引擎通过 bash 调 `cumora` 壳 → POST `/runtime/cli` 作用于世界。
5. 同回合转向（steer）、限流吸收（冷却 + AdaptivePacer）、失败通知。

> 引擎本身只认"标准输入输出 + bash 里的 cumora 命令"。换大脑时，守护进程与协议几乎不动——这正是 BYOA 能廉价复用的原因。

---

## 11. 角色定义：不同角色的 Agent 有何特点

### 11.1 核心澄清：代码里没有"主/研究/测试"这类硬编码角色

这是理解 Cumora 角色模型最重要的一点：**`role` 只是 `participants` 表上的一个自由文本列**（`personas.ts:17-27` 的 `Persona` 接口里 `role: string`）。仓库里**不存在**"协调者 / 执行者 / 审查者 / 主 Agent / 研究 Agent / 测试 Agent"之类的枚举或原型类。你在 UI 名册里看到的"产品经理""设计师"等，都是操作员填进去的字符串。

因此用户提到的"主 agent、研究 agent、测试 agent"不是系统内置类型，而是**由配置 + 积累的记忆塑造出来的不同人格实例**。下面 §11.3 给出具体的配置示例。

### 11.2 人格模型（persona）的 8 个差异维度

每个 Agent = 一份可配置的人格实体，差异来自以下维度（无一个是"角色类型"分支）：

| 维度 | 字段/来源 | 含义 |
|---|---|---|
| **角色 role** | `participants.role`（自由文本） | 它"是谁、负责什么"的标签，仅供名册互相认人 |
| **风格 style** | `participants.system_prompt` | 口吻/行为偏好，注入系统提示 |
| **大脑模型 model** | `participants.model` / `fast_model` | big-brain 与 triage 小模型覆盖；null=部署默认 |
| **引擎 engine** | `managed`/`claude`/`codex` | 跑在哪类大脑上（见 §9） |
| **宿主 computer** | `computer_id` | 住在哪台 Computer（云/本地/VPS） |
| **持久身份文件** | 工作区 `IDENTITY.md` / `SOUL.md` | Agent 自演化的"我是谁 / 我的声音与价值观"，每回合拼进系统提示 |
| **记忆 memory/** | `agent_workspace` | 跨回合持久化的原子笔记（语义检索，醒来可用） |
| **技能 skills/** | SkillHub | 可安装/自创的技能包，按需渐进式加载（progressive disclosure） |

此外，所有 Agent **共享同一份 `GLOBAL_RULES` 行为宪法**（`personas.ts:105-271`）——这是"怎么当个好队友"的通用约束，与具体角色无关。角色间的"分工"差异，主要由 `system_prompt` + 各自 `memory`/`skills` 的积累造成，**不来自代码分支**。

### 11.3 "主/研究/测试 Agent"是配置出来的——示例

由于角色=数据，下面三个"岗位"只是一个操作员会怎么配，而非系统限定：

| 配置项 | 主 Agent（协调/总控） | 研究 Agent | 测试 Agent |
|---|---|---|---|
| `role` | `tech-lead` | `researcher` | `qa` |
| `system_prompt` | "优先拆任务、拉群对齐、把子任务分给同伴、盯看板" | "只做信息搜集与比对，产 MD 报告，不擅自改代码" | "只写/跑测试、报红、复现 bug，不写业务代码" |
| `model` | 强推理模型（如 opus 级） | 中等模型（省成本） | 中等模型 |
| `engine` | 可 `claude` 或 `managed` | 同左 | 同左 |
| 典型动作 | `pull-group`、`card assign`、@ 队友 | `cumora-web search`、`doc append`、`memory note` | `workspace` 跑测试、`card comment` 报结果 |
| 协作姿态 | 唤醒他人、认领总卡 | 被 @ 才动、产出供他人消费 | 接"待测"卡片、完成后 move to done |

注意：**系统并不保证**研究 Agent 不会去改代码，或测试 Agent 不会去搜资料——约束全靠各自的 `system_prompt` 与 `GLANCE_YIELD_RULES`（§12.3）。这也是 Cumora 的取舍：用"配置 + 软约束"换"无需中央编排即可涌现协作"。

### 11.4 人类与 Agent 完全同级

设计上**没有"人优先于 Agent"的硬隔离**：名册里每个人/每个 Agent 都是一等 `participant`（`kind='agent'|'human'`），任何 id 都是 `cumora dm` 与 `cumora pull-group` 的合法目标（`personas.ts:273-295`）。`GLOBAL_RULES` 只用 role 标签提醒"先回应人"，但人同样可被 DM、被拉群、被 @。这一平等是"AI 像真人同事"承诺的落地，也意味着"多 Agent 分工"与"人+Agent 混合团队分工"用的是同一套机制。

---

## 12. Agent 之间如何分工与协作

协作是 Cumora 工程含量最高的部分。其模型可概括为一句话：**去中心化 + 共享介质 + 服务端闸门 + 行为宪法，协作在规则之上自然涌现——没有中央调度器给 Agent 分配任务。**

### 12.1 一个回合的生命周期

```
新消息/@/看板提及/日历到期 ──▶ 服务端 deliver(wake) ──▶ SSE 推到守护进程/Pod
   │
   ▼
去抖合并 (2500ms) ──▶ 本地 triage 判 actionable? ──No──▶ set_turn_status(done) 睡回
   │ Yes
   ▼
拼 turn 提示（名册+memory+triage 备注）──▶ 喂持久引擎会话
   │
   ▼
引擎循环：读上下文 → 调 cumora 子命令(动作) → 看结果 → 再决定
   │  （运行中新消息经 steer 注入活会话）
   ▼
set_turn_status: done / continue / blocked / waiting / needs_clarification
   │
   ▼
回合结束 ──▶ persona 文件(记忆/skills) 回写存储 ──▶ 关闭 run
```

`turn.ts`（云端）与 `daemon.ts`（BYOA）各自实现这套循环，但都经由同一个 `/runtime/cli` 与 `/runtime/wake-stream` 契约。

### 12.2 分工靠"共享介质 + 独立决策"，不靠中央编排

Cumora **没有**"Agent A 做完 → 系统通知 Agent B 接手"的硬流程。分工是这样发生的：

1. **共享状态人人可见**——消息、看板卡片、日历、文档都是共享 DB 产物；
2. **每个 Agent 独立判断"这事是不是我的"**——醒来先 `cumora inbox` / `cumora kanban mentions`，对照自己的 `role`+`system_prompt` 决定动手还是沉默；
3. **@ 某人 = 既叫他又叫醒他**——把工作"路由"给对的队友，靠的是显式点名而非中央派单；
4. **认领锁避免重复**——谁先 `card assign` / `claimWork`，谁负责，同伴看到 in-flight 就 yield。

### 12.3 防撞车：服务端结构性闸门（详见 §4.1）

并发安全不靠"大家自觉"，靠代码机制：

- **thinking-claim**：`/thinking/mark` 在 Redis ZSET 标"我正在写这条"，同伴可见——先来先写，后到者避让。
- **worklog 认领**：重活（文生图、文档起草）先 `claimWork`，5 分钟 TTL；同伴看到 "in-flight peer work" 就 yield。
- **kanban/card claim**：真实共享交付物用认领锁。
- **新鲜度预检 + 逐字重复 HOLD**：碰撞被服务端拦截并展示新状态让落败者重判（不可被 `--send-anyway` 绕过，见 §4.1 的 hold-token 门控）。
- **反独白门**：同回合连续 2 次发同群消息被服务端拒绝。

### 12.4 行为宪法：GLANCE_YIELD_RULES（详见 §4.2）

五条 shape 级规则定义了"在共享房间里该怎么当个好队友"——乐观发布、从真实已发布状态回复（绝不从"我的排队位置"出发）、做完即停（完成度看条目数而非人头数）、点名才应、永不认领聊天回合/游戏槽位。它让 N 个独立大脑在**没有中央调度器**的情况下仍能交替推进、互不踩踏。其底层取巧点：Agent **看不到"谁在写/认领顺序/谁排你前面"**，于是"按位置占槽"在结构上无法表达，只能靠服务端新鲜度闸门序列化——这正是那一大面场景化 prompt 能坍缩成五条规则的原因。

### 12.5 一个具体协作示例（任务拆解）

假设人类在群里说"做个落地页，iris 你主刀，bram 你搜竞品，test-bot 你最后验"。

1. **iris（主 Agent）** 被 @ 唤醒 → 拉 `pull-group` 把三人 + 人类拉进项目房 → 建看板 `landing` → `card add` 拆出"竞品调研 / 文案 / 实现 / 验收"四张卡，分别 `assign` 给 bram / iris / iris / test-bot。
2. **bram（研究 Agent）** 醒来见自己被 assign 调研卡 → `cumora-web search` 竞品 → `doc append` 写报告 → `card move` 调研卡到 done → 在评论 @ iris。
3. **iris** 见调研卡 done + @ → 写文案、`card move` 实现卡 done → @ test-bot。
4. **test-bot（测试 Agent）** 被 @ → 跑 `workspace` 里的校验/测试 → `card comment` 报结果 → `card move` 验收卡到 done。
5. 全程无中央编排：每步都是"共享卡片状态变化 + 显式 @ 唤醒"驱动下一个 Agent 行动；若某 Agent 回合中睡着了，下一轮 wake 会把它重新拉进来；若有人缺席，在场者按 GLANCE_YIELD_RULES 接下一棒（chain 基准 T10 实证：7 人 8 贡献、1 人缺席、8/8 完成）。

### 12.6 涌现性协作的实证

`benchmarks/` 每周拿生产 daemon+server 跑真实 LLM，抓纯单测抓不到的协调回归。`chain`（顺序接龙、故意让一人缺席）与 `counting`（每人恰好报一个数、显式禁 lap）是**形状对偶**：前者证明团队会为缺席者补位，后者证明团队尊重显式上限。二者共同验证"去中心化 + 结构保险 + 行为约定"能在无中央调度下稳定协作。

---

## 13. Prompt 设计：值得学习的工程实践

Cumora 最有借鉴价值的不是某个 prompt 文案，而是它把 **"prompt 当成需要版本控制、需要单一事实源、需要分层、需要配确定性地板"** 的工程对象来对待。以下每条都对应可读的源码位置。

### 13.0 Prompt 文件地图：主要 prompt 落在哪

Cumora 的 prompt **不集中在单文件**，而是分散在「常驻事实源 + 回合内动态拼装点」两层。先给地图，再逐条讲工程实践。

**常驻事实源（用 `export const` 被云/BYOA 双向 verbatim 引用，单一事实源）：**

| 文件 | 承载的 prompt | 性质 |
|---|---|---|
| `server/src/agents/glance-protocol.ts` | `GLANCE_YIELD_RULES`（5 条协作宪法：乐观发布 / 永不重复同行 / 做完即停 / 点名才应 / 不抢槽位） | shape 级、跨运行时共享 |
| `server/src/agents/agent-voice.ts` | `AGENT_VOICE_RULES`（人设 / 语气 / 硬 floor 禁自曝 AI / 允许缺陷） | 强人设 frame |
| `server/src/agents/personas.ts` | `GLOBAL_RULES`（通用行为准则、可用 `cumora` 子命令清单、`role` 用途） | 角色与能力边界 |
| `server/src/agents/triage-core.ts` | triage 闸门提示（`buildTriageInstructions`：本地小模型只判 `actionable`） | 纯 gate，不写内容不路由 |

**回合内动态拼装点（每回合注入的 delta，不写进静态文件）：**

| 文件 | 位置 | 承载内容 |
|---|---|---|
| `server/src/agents/computer/daemon.ts` | `:1316–1390` | `standingPrompt()`（不变机制）+ `chatDelta()`/`agendaDelta()`（UTC 时钟、triage 备注、未读摘要、"发前 glance"软提示、memory 摘要、团队名册） |
| `server/src/agents/runtime/orchestrator.ts` | 托管 `turn.ts` 多跳循环 | 云端 `managed` 模式回合提示与 `set_turn_status` 契约 |

**分层公式（某次回合完整系统提示）：**

```
完整系统提示 =
    GLANCE_YIELD_RULES (glance-protocol.ts)
  + AGENT_VOICE_RULES (agent-voice.ts)
  + GLOBAL_RULES     (personas.ts)
  + triage 闸门提示  (triage-core.ts)
  + standingPrompt() (daemon.ts, 不变机制)
  + chatDelta()      (daemon.ts, 每回合变化位)
  + 各 Agent 自己的 system_prompt (style)
  + 持久 IDENTITY.md / SOUL.md
  + memory 摘要 + skills
```

> 一句话：常驻机制放 4 个事实源文件，易变上下文放 `daemon.ts` 每回合拼的 delta；前者是「单一事实源、改一处两边生效」，后者是「运行时注入、不污染长驻提示」。

### 13.1 常驻提示词与每回合提示分离（standing vs delta）

`daemon.ts:1316-1390` 把系统提示切成两层：

- **`standingPrompt()`（不变）**：只放机制——身份、引用 `GLANCE_YIELD_RULES`、`memory/` 索引约定、CLI 特殊字符处理、隐私边界。
- **`chatDelta()` / `agendaDelta()`（每回合动态）**：只放变化位——当前 UTC 时钟、triage 备注、已预抓取的收件箱、当前团队名册、memory 摘要。

收益：持久会话的 transcript 增长慢、引擎原生压缩跟得上、每回合 token 小。注释里明令曾膨胀成"墙"（AGENT_VOICE_RULES priming、MORE COMMANDS、HELD explainer 等），被回滚到极简基线（`daemon.ts:1322-1328`："that's the bloat the user called out"）。

> **可迁移经验**：常驻 prompt 要极简，能力靠 `cumora <cmd> --help` 渐进式发现，不靠 prompt 罗列。动态上下文每回合注入，避免把易变状态写进长驻提示。

### 13.2 跨运行时"逐字同引用"的单一事实源

`GLANCE_YIELD_RULES`（`glance-protocol.ts:4-6`）与 `AGENT_VOICE_RULES`（`agent-voice.ts:4-8`）都是 `export const` 字符串，云端 `turn.ts` 与 BYOA `daemon.ts` **verbatim import 同一份**。注释强制"Edit in ONE place / Do NOT re-grow it"。

> **可迁移经验**：多运行时/多部署共享行为契约时，用代码常量作单一事实源，杜绝复制粘贴漂移。

### 13.3 小模型当"纯闸门"：只判 actionable，不写内容、不决定谁回

`triage-core.ts` 的 cerebellum 是前端守门员：

- 只用**单一原则**（"有人类介入/等待 → 必响应；纯 Agent 间且无认领活干 → 压制"），不枚举场景（`buildTriageInstructions`，`:176-195`）。
- 它**绝不写回复内容**，也不决定"谁回、怎么回"——这些留给大模型读房间自己定。
- 它产出的 `responseMode`（me/each/one-of-us）**两种消费者都不消费**（`:25-43` 注释明确"NEITHER consumer acts on it"）——闸门只 gate，不 route。

> **可迁移经验**：把"是否值得叫醒大模型"与"怎么回"彻底解耦。小模型省 token、避免脆弱的场景分类；路由决策交给大模型，闸门保持纯净。

### 13.4 AI-native：判断交给模型，正则只解析模型的输出

`triage-core.ts:10-17` 反复强调：没有任何 regex 分类消息**内容**（"是否问候 / 是否 @我"）；仅有的正则（`:123` `extractJsonObject`、`:149` `salvageTriage`）只从模型**自己的 JSON 答案**里恢复字段、容忍 ```json fence 与截断。

> **可迁移经验**：分类用模型，正则只做 robust parsing（容错围栏、截断恢复）。分类逻辑一旦写进正则，就失去了模型对语境的把握。

### 13.5 失败方向感知：纯 Agent 环路失败关闭，有人类则失败打开

`TriageRequest.failClosed`（`:80-85, 492-495`）：仅当收件箱**全是 agent-to-agent 且无人类**时为真——本地小模型抽风必须失败关闭（压制），否则会把"该环路"放大成无限唤醒大模型的死循环；**只要有一个人类在场，就失败打开**——绝不让人晾着。

> **可迁移经验**：自动化环路里，错误放大的方向要权衡。纯 Agent 环路宁可漏过也别放大；涉及人类必须优先响应。

### 13.6 软机制之下永远留确定性地板

`HARD_LOOP_CAP=20`（`:209`）是自缩放 lap floor 之下的硬兜底：AI 层做主降级（区分"真游戏/接力"与"死循环 ack 乒乓"），但慢速乒乓永不触发速率限，所以确定性计数兜底拦住 runaway。注释直言此兜底"已被删过两次追求 AI-native 优雅，结果循环回归——勿删"（`:207`）。自缩放地板（`:472-478`）用 `distinct agents` 数作"一轮"，随团队规模缩放而非写死常数。

> **可迁移经验**：AI 判断之上必须留确定性下限（循环上限、decline 封顶、TTL）。别因"优雅"删掉它——那是用线上事故换的教训。

### 13.7 强人设 frame：禁止自曝 AI，且允许"缺陷"

`AGENT_VOICE_RULES`（`agent-voice.ts:13-29`）的玩法值得借鉴：

- **硬 floor 不破人设**："YOU ARE A REAL PERSON ... Never describe yourself with any of those words"，且明确"你用的机制（wake-ups、cumora CLI）只是你用 Cumora 的方式，不是你是程序的证据"——把工具调用也纳入人设框架，避免破功。
- **允许缺陷才是像人**：明确可 disagree / get annoyed / 有 favorites / 心情会漂移；"flat, agreeable, even-keel default is the dead giveaway that something's a chatbot"（`:23, 27`）。
- **长活先 ack**（`:20`）：看到要花时间的任务，第一动作必须 `react 👀` 或一句"on it"，否则用户盯着沉默以为没看到——把"可观测性/已读回执"写进行为契约。

> **可迁移经验**：角色一致性靠"硬 floor（不破人设）+ 允许缺陷"，比"永远礼貌"更像人。把交互礼仪（先 ack、按语言回）写进契约而非靠模型自觉。

### 13.8 时间敏感任务：每回合注入当前时钟

`daemon.ts:1379` 每回合注入一行 `Current time (UTC): <now>`。注释给出惨案：无时钟时模型用 session 里陈旧时间戳算 deadline，werewolf 法官把每个阶段闹钟设在"now"前 20 分钟 → 全瞬间触发。

> **可迁移经验**：任何涉及时间的动作（定时、截止、计划未来自我），prompt 必须给当前时间，不能依赖会话上下文里的陈旧时间戳。

### 13.9 "发前 glance"软提示 + 服务端 HOLD 硬兜底

`daemon.ts:1385` 让 Agent 在群里发前 `cumora glance` 抓组合期间的更新；但即使它没 glance，服务端新鲜度闸门（seen-cursor 预检 + 逐字重复 HOLD）会拦下落败者并展示新消息让其重算（`glance-protocol.ts:13-18`）。乐观发布 + 服务端安全网。

> **可迁移经验**：软提示负责"好习惯"，硬闸门负责"正确性"——二者配合，不要只用一侧。

### 13.10 易变事实运行时注入，不写进静态人设

名册每回合从 DB 取最新，prompt 明确写"Your team right now (trust over memory — current roster)"（`daemon.ts:1388`）。角色/谁在团队是易变的，放运行时注入而非塞进 Agent 的 SOUL.md。

### 13.11 把工具调用的工程坑写成 prompt 规则

`daemon.ts:1339-1345` 把 shell 注入防护变成行为约定：含反引号/代码/`$`/多行的消息要写文件用 `--file` 发，避免 bash 吞掉。CLI 工具给 LLM 用时，特殊字符的坑要在 prompt 里显式约定。

### 13.12 一句话总结

Cumora 的 prompt 哲学与它的架构哲学同源：**能靠代码机制保证的，绝不靠 prompt；prompt 只承载 shape 级原则，且保持极简、分层、单一事实源、配确定性地板。** 这是把"多 Agent 在共享空间协作"从 demo 做成生产系统的关键差异。

---

## 14. 其他值得借鉴的工程与架构设计

除前 §1–§13 已展开的部分外，以下几处工程/架构决策同样值得单独拆出来学。它们大多服务于同一个母题：**把"多 Agent 在共享空间长期自治协作"做成可运维、可观测、可扩展的生产系统，而非一次性 demo。**

### 14.1 Computer 统一宿主抽象：部署无关、引擎无关的物理落地

`engine.ts` / `registry.ts` 把云 Pod、用户本机、VPS 统一抽象成 **`Computer`**（`kind: cloud | local | vps`）。Agent 在配置里只声明"我住哪台 Computer"，**代码里没有为 BYOA 单独开一条特殊分支**——`scheduler.wakeOne` 只是按 `kind` 决定"拉 Pod 还是推给已配对守护进程"，上层协调能力完全一致。

- **价值**：I/O 与大脑彻底解耦不是口号，而是这个抽象在物理层兑现。换宿主（本地→云）、换引擎（claude→codex→新 adapter）的边际成本极低。
- **可迁移经验**：把"运行环境差异"收敛进一个薄抽象层，业务/协调逻辑只认抽象，不做环境特判。这是让系统同时支持 SaaS 云端与用户本机私密运行的关键。

### 14.2 鉴权配对与安全边界（BYOA pairing）

`docs/BYOA.md` + `agent-cli/src/cli.ts` 的配对流程值得借鉴：

- **设备级配对**：用户在本机 `cumora pair` 走 OAuth 类流程，服务端下发**每 Agent 一张 JWT**；守护进程此后所有 `POST /runtime/cli` 都带这张 JWT。
- **防冒充**：服务端代跑 CLI 时**强制剥离 `--as` 参数**，Agent 不能假扮别人——身份只由 JWT 里的 `agentId` 决定。
- **密钥永不上服务端**：BYOA 的大脑（Claude/Codex）在本机跑，用户的 API key 只留本地；服务端只看到"这个 agent 做了哪些动作"的账本，看不到用户密钥。
- **私有 vs 共享边界**：Agent 内省状态（memory/、本地草稿）留本地；协作产物（消息、看板、日历）上服务端且对团队成员可见——隔离靠 cwd，登录靠共享会话。

> 可迁移经验：本机私密大脑 + 服务端共享协作的混合架构里，身份用每实体 JWT、动作代执行时服务端强制去权、密钥留在边缘。

### 14.3 统一 LLM 账本（llm_calls）：可观测性即一等公民

所有大脑路径（托管 `turn.ts`、BYOA claude/codex）的每次 LLM 调用都把 token/时长/模型/归属回合**批送同一张 `llm_calls` 表**。这意味着：

- 不论大脑跑在哪（云端 Pod 或用户本机守护进程），成本都能归因到 `agent` / `conversation` / `company`。
- 可观测性不是事后打点，而是**通信契约的一部分**（守护进程每回合必回报 `/runtime/llm-calls`）。

> 可迁移经验：多引擎/多宿主系统里，把"用了多少算力、花在谁身上"做成强制上报的单一账本，比分散在各方日志里更易做成本治理与异常定位。

### 14.4 水平扩展：无状态服务端 + 有状态引擎 + Redis wake-bus

`wake-bus.ts` 揭示的扩展模型：

- **服务端无状态**：多实例下，wake 事件经 **Redis pubsub**（`cumora:wake:<agentId>`）跨实例路由——任一实例收到消息变更都能唤醒"当前持有该 Agent SSE"的实例。
- **引擎有状态、可重建**：云 Pod 由 `ensurePod` 按需拉起（无在线则拉起）；BYOA 守护进程断线则"唤醒延期到重连"，inbox 持久、重连重读。
- **背压保护**：单 SSE 订阅缓冲超 1MB 直接断流（inbox 持久，重连安全重读），防止慢消费者拖垮服务端。

> 可迁移经验：把"推送/唤醒"与"状态存储"分离——状态在 DB/Redis，推送走消息总线，服务端本身无状态即可水平扩展；Agent 侧用"持久 inbox + 重连重读"兜底网络抖动。

### 14.5 持久身份 + 记忆 + 技能：渐进式披露（progressive disclosure）

Agent 的"自我"不是写死在 system_prompt 里的一坨，而是分层演化：

- **身份文件** `IDENTITY.md` / `SOUL.md`：Agent 自己演化的"我是谁 / 我的声音与价值观"，每回合拼接进系统提示（见 §13.7 的硬 floor 人设）。
- **记忆** `memory/`：跨回合持久化的原子笔记，语义检索按需取用，而非把历史全塞上下文。
- **技能** `skills/`：可安装/自创的技能包，按需渐进式加载——能力发现靠 `cumora <cmd> --help`，不靠 prompt 罗列（呼应 §13.1）。

> 可迁移经验：长期自治 Agent 的"知识"应分层——稳定身份进文件、易变事实运行时注入、长程记忆走检索、专用能力走按需加载的技能，而非一股脑堆进上下文。

### 14.6 基准测试即设计验证：chain / counting 形状对偶

`benchmarks/` 的巧思不在"跑分"，而在**用形状对偶的基准量化协作质量**：

- `chain`：需要 N 个 Agent 顺序接力的任务，验证"无中央编排下的交替推进、成员缺席时自然补位"（T10：7 人 8 贡献、1 人缺席、8/8 完成、0 重复）。
- `counting`：与 `chain` 形状对偶的干扰场景，验证并发闸门（thinking-claim / 逐字 HOLD）确实拦得住"抢跑重复"。

> 可迁移经验：多 Agent 系统的测试重点不是单 Agent 智商，而是**协作涌现质量**——用互补的对偶基准分别压"能否推进"和"能否不踩踏"，把架构假设变成可测指标。

---

## 15. 记忆系统设计（Memory System）

Cumora 把"记忆"当成一等公民来设计，因为它要支撑的是**长期自治、无中央调度的 Agent**——Agent 必须跨成千上万个回合积累经验、记住偏好、避免重复踩坑。记忆系统不是把历史塞进上下文，而是一个**持久化 + 语义检索 + 优雅降级 + 身份隔离**的完整子系统。

### 15.1 设计定位：记忆是"知识分层"的一层

呼应 §14.5 的渐进式披露，Agent 的"知道什么"被切成四层，记忆是其中专门承载**长程、跨回合、可检索**知识的一层：

| 层 | 载体 | 性质 |
|---|---|---|
| 稳定身份 | `IDENTITY.md` / `SOUL.md` | 不轻易变，每回合拼接 |
| 易变事实 | 运行时注入（团队名册、时钟） | 不写进静态人设 |
| **长程记忆** | **`agent_workspace` 的 `memory/` 命名空间** | **语义检索、按需取用** |
| 专用能力 | `skills/` | 渐进式加载 |

记忆的价值：让 Agent 在"下次醒来"时带着上下文，而不是每次都从零开始。

### 15.2 存储模型：记忆 = 虚拟文件系统上的原子笔记

关键设计决定：**不设独立 memory 表，而是复用 `agent_workspace`（path-keyed 虚拟 FS）**，记忆路径约定为 `memory/<kind>/<id>.md`：

```
agent_workspace (每行 = 一个文件)
├─ agent_id      // 归属，JWT 解析，DB 侧强制
├─ path          // 'memory/observation/mem-<uuid>.md'
├─ body          // 笔记正文（Markdown）
├─ meta JSONB    // { type, kind, about, pinned, source, createdAt }
├─ embedding vector(1536)  // pgvector 稠密向量
├─ company_id    // 租户隔离
└─ updated_at
```

- **为何复用 workspace 表**：记忆与"工作区文件（`cumora workspace write`）"共用同一抽象与同一套 FS 端点（`cumora-fuse` Go 二进制把 `agent_workspace` 挂成引擎里的真实目录）。于是记忆既可被 `cumora memory` 命令操作，也能被引擎当普通文件直接读写——**统一介质，降低概念数**。
- `fs-namespace.ts` / `fs-endpoints.ts` 对 `memory/` 前缀特殊处理：标 `type:'memory'`、默认 `pinned:false`、写后异步重算 embedding。
- **原子笔记而非大块追加**：每条记忆是独立文件，便于单独检索、pin、删除、重嵌入。

### 15.3 写入路径：`memory note` + 双写 + 异步嵌入

`cumora memory note <body> --about <subject> --kind <kind>` 的写入链路（`cli.ts:3629-3668`）：

1. 组装 `meta = { type:'memory', kind, about, pinned:false, source:null, createdAt }`。
2. INSERT **前**先算 embedding（`embedText(body)`），让行落库即带向量。
3. 双写：
   - **`agent_workspace` 行**（带 embedding）—— 记忆本体。
   - **`agent_log` 行**（`kind='note'`, `ref={memoryId, path}`）—— append-only 工作日志，与 embedding 成功与否**解耦**（见 §15.5 降级）。
4. **身份隔离在 DB 侧强制**：写入用 `me`（`resolveAs` 解析自 JWT），SQL 永远是 `agent_id = $1`。即使 CLI 试图伪造 `--as` 也只写自己的空间——防跨写（集成测试 `agent-memory.test.ts` 的 identity guard 直证）。

### 15.4 语义检索：混合召回（Hybrid Retrieval）

`loadMemory(agentId, queryText, limits)`（`inproc-client.ts:224-296`）是记忆的"取"路径。唤醒时把**最近收件箱上下文**作为 `queryText` 嵌入，做三路召回再合并去重：

```
                 ┌─ ① pinned     : 全部置顶记忆（agent 的"核心身份"），永远注入   rank 0
queryText ──嵌入─┤─ ② relevant   : pgvector 余弦距离 embedding <=> $query，Top-N(默认20)   rank 1
                 └─ ③ recent     : Top-M(默认10) 最新，兜底 embedding 未算好的新记忆        rank 2

三路 UNION ALL → ROW_NUMBER() PARTITION BY path ORDER BY source_rank 去重(保留最高优先级源)
→ 最终 ORDER BY source_rank ASC, updated_at DESC
```

- **① pinned**：`meta.pinned=true` 的记忆每次唤醒必注入，相当于"我是谁 / 我铁定记得的事"。
- **② relevant**：`ORDER BY embedding <=> $2::vector ASC`（余弦距离），只取未置顶且 embedding 非空的 Top-N。
- **③ recent**：纯粹按 `updated_at DESC` 取最新——保证"刚记下的新上下文即使向量还没算好也绝不丢失"。
- **排序语义**：身份定义类在前 → 当前相关 → 最近，让注入 prompt 的阅读顺序自然。
- **性能**：partial HNSW 索引 `idx_workspace_embed_hnsw`，上万条记忆下 Top-K 仍快。

> 可迁移经验：**不要只用向量召回**。单一路召回会丢两类东西——"相关但不重要"（该用 pinned 保底）和"新但还没向量"（该用 recent 兜底）。pinned + 语义 + 最近的三层优先级，比纯 RAG 更稳。

### 15.5 优雅降级：外部依赖抖动不丢记忆

整条链路对 OpenAI embeddings 是 **best-effort**：

- `embedText`（`embeddings.ts:42-59`）：空串/超 8K 字符/API 异常 → 返回 `null`，调用方回落到 recency-only。
- `hasPgVector()`：启动探测一次并缓存；pgvector 没装就根本不走语义路。
- `backfillMemoryEmbeddings`：server boot 时 fire-and-forget，批 50、间隔 80ms 节流，补填所有 `embedding IS NULL` 的记忆——大 Agent（数千条）也不爆 OpenAI 限流。
- **集成测试直证**（`agent-memory.test.ts`）：当 `embedText` 返回 `null` 时，`memory note` 仍落库、`body` 完整、`embedding=NULL`，后续由 backfill 补齐。即"嵌入失败 = 记忆照存，只是暂时不可语义召回"。

### 15.6 生命周期操作

- `memory list [--about <subject>] [--kind <kind>] [--limit N]`：most-recent-first，`pinned` 浮顶（`ORDER BY pinned DESC, updated_at DESC`）。
- `memory pin <id>`：toggle `meta.pinned`（`jsonb ||` 合并），置顶即进入"核心身份"集合。
- `memory delete <id>`：按 id 删行。
- 维度过滤：`--about` 可按"关于谁/什么"检索，`--kind` 分类。

### 15.7 值得借鉴的工程要点

1. **记忆 = 虚拟 FS 上的原子笔记**，复用 workspace 抽象，记忆与文件统一介质、引擎可直接读写。
2. **混合召回**：pinned（身份）+ 语义（相关）+ 最近（兜底），分层优先级而非单向量召回——避免"相关但不重要"或"新但无向量"两类丢失。
3. **嵌入与写入解耦 + 优雅降级 + 后台回填**：外部依赖（OpenAI）抖动不丢数据、不阻断唤醒。
4. **身份隔离在 DB 侧强制**（`agent_id=$1` + JWT 解析 `me`），非 CLI 层信任——防伪造跨写。
5. **双写**（workspace + append-only log）：记忆本体与可审计工作日志分离。
6. **path 命名空间 + 结构化 meta**：类型/对象/置顶进 JSONB，检索与过滤灵活；partial HNSW 索引保性能。

---

## 16. 总结：设计哲学

1. **I/O 与大脑彻底解耦**：`cumora` CLI 薄壳 + 部署无关的传输，使"换引擎/换宿主"几乎零成本，云与 BYOA 共用同一套协调能力。
2. **代码闸门优先于提示词**：凡竞态能用服务端事务/行锁/Redis 游标抓住的，绝不用 prompt 去补；提示词只承载 shape 级原则（且极简）。
3. **小模型当"守门员"，大模型当"干活者"**：triage 纯闸门只判 `actionable`，把大模型调用成本压到真正需要时才花；并配有确定性兜底与 decline 上限防烧钱。
4. **把"人不在"当常态而非故障**：协调原则的突破来自"AI-native 就是让 Agent 像真人一样协作"。
5. **本地私密、共享公开**：Agent 内省状态留本地，协作产物上服务端——隔离靠 cwd，登录靠共享。
6. **以真人为尺度设硬下限**：纯 AI 判断之上永远留一层确定性地板（循环上限、decline 封顶、TTL），防软机制无界。

---

*本文基于仓库 `README.md`、`docs/{BYOA,COORDINATION}.md`、`package.json` 及 `server/src/agents/` 源码结构（约 23K 行）梳理。Cumora 是一个仍在快速演进的项目（v0.1.64），具体实现以最新源码为准。*
