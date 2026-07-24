# OpenWorker — 工程研究报告

> **仓库**: [openworker](https://github.com/andrewyng/openworker)（包名 `coworker`，version 0.0.0，Beta）
> **分析日期**: 2026-07-24
> **方法论**: Research Trace（Question → Evidence → Analysis → Counter Evidence → Conclusion → Confidence）+ Ontology-driven Research（对象图）
> **证据来源**: `evidence-brief.md`（确定性分析输出）+ `ref-only/openworker/` 源码验证

---

## 1. 执行摘要

OpenWorker 是 Andrew Ng 团队的开源桌面 AI coworker——一个本地优先（local-first）、provider-agnostic 的 agentic runtime，目标是交付**完成的工作**（文档、Slack 回复、日程调整、收件箱分类），而非聊天。它由三部分构成：Python agent 后端（`coworker/`，构建于 [aisuite](https://github.com/andrewyng/aisuite) 之上）、React + Tauri 桌面 shell（`surfaces/gui/`）、Rust 语音输入 sidecar（`stt/`）。仓库规模 355 模块 / 3304 函数 / 46 commits / 4 contributors，处于早期成长期（Beta）。

**最有趣的发现**：OpenWorker 把"approval-gated agentic execution"做成了**一等公民**——权限引擎（`PermissionEngine`）、Plan/Discuss/Interactive 模式切换、standing approvals、unattended inbox parking、self-wake 调度共同构成了一套"可中断、可恢复、可审计"的 agent 执行模型。这远超典型 open-source agent harness 的"loop + tools"模式，更接近一个**面向真实工作流的 coworker 操作系统**。

第二个有趣发现：persona 系统采用 `persona ⊇ skill` 的设计——persona manifest 复用 SKILL.md 的 frontmatter + markdown 形状，且严格解析（无效 manifest 抛 `ManifestError`），使第三方 persona 必须显式失败而非静默降级。

---

## 2. Research Traces

### 2.1 核心架构模式：三层桌面 Agent Runtime

**问题**: OpenWorker 的核心架构模式是什么？层与层之间的职责如何划分？

**证据**:
- 顶层目录划分：`coworker/`（Python 后端）、`surfaces/gui/`（Tauri+React 桌面 shell）、`stt/`（Rust STT sidecar）、`packaging/`（macOS/Windows 安装器）（`README.md` Repository layout）
- `pyproject.toml` 三个 entrypoint script：`openworker`（cli）、`openworker-server`（server）、`openworker-connectors`（connectors cli）（简报 §2：15 个 entrypoint，cli:9 / server:2 / tool:4）
- `coworker/server/app.py` 提供 FastAPI server；`coworker/server/manager.py` 入度 52，PageRank 0.0074——后端核心枢纽（简报 §2）
- `surfaces/gui/src-tauri/src/main.rs` 是 Tauri 入口；Tauri shell 监督 Python server（README："the Tauri shell launches the window and supervises the server itself"）
- `surfaces/gui/src/api.ts` 入度 45、`surfaces/gui/src/types.ts` 入度 34——GUI 层的契约层（简报 §2）

**分析**: 三层分离是事实——后端 Python（agent engine + providers + connectors + MCP）作为可独立运行的 server（`.venv/bin/openworker-server`），桌面 shell 通过 Tauri 监督并通信，Rust STT 作为可选 sidecar。`server/manager.py` 的高入度表明它是 GUI↔engine 的中介。这与 Pi 的"包内三层"不同——OpenWorker 是**进程级三层**（独立 server 进程 + 桌面 shell 进程 + 可选 STT 进程），更接近传统桌面应用架构。

**反证**: 简报 §2 列出 9 个 import cycle，其中 `coworker.tui.app → coworker.tui.app`（自循环）和 GUI 内 `types ↔ api` 循环说明层内契约不完美。但所有循环都局限在单一 surface 内部，**未发现跨进程层间的循环**。

**结论**: OpenWorker 采用**进程级三层桌面 Agent Runtime 模式**——Python server 提供 agentic 能力，Tauri shell 提供 GUI + 生命周期监督，STT sidecar 提供语音输入。后端可在无 GUI 模式下独立运行（`openworker-server` 命令）。

**置信度**: 高 — entrypoint、目录结构、README 描述通过源码验证；循环数据来自 analyzer。

---

### 2.2 Approval-gated Execution：可中断、可恢复的 Agent Loop

**问题**: OpenWorker 如何防止 agent 失控？approval 机制如何与 unattended 场景兼容？

**证据**:
- `coworker/engine.py` 头部 docstring："Async, but with blocking provider/tool calls wrapped in `asyncio.to_thread`... One user turn spans many model↔tool iterations until the model stops requesting tools, a rail trips, or it's interrupted"（源码验证）
- `TurnEngine.__init__` 默认 `max_iterations: int = 12`（`coworker/engine.py:62`）——硬性循环上限
- `ApprovalOutcome` 枚举：`ONCE` / `ALWAYS_TOOL` / `ALWAYS_COMMAND` / `DENY`（`engine.py:29-33`）——粒度化审批
- `PermissionRequest.tool_call_id` 注释："for durable resume (idempotent inbox item)"（`engine.py:42`）——审批可持久化恢复
- `coworker/permissions.py` 的 `Mode` 枚举包含 `PLAN` / `DISCUSS` / `INTERACTIVE` / `CUSTOM` / `AUTO`（`personas/manifest.py:25` `VALID_MODES`）
- `coworker/inbox.py` 的 `planner._handle_plan_proposal`（简报 §5.5）+ `unattended.py` + `standing_approvals`（测试 `tests/test_standing_approvals.py`）——unattended 场景把 asks 停泊到 inbox
- `agent.py:280` 注册 `propose_plan_tool()`——plan 模式的退出通道

**分析**: TurnEngine 是 owned agent loop——owned 意味着它持有 messages 状态、可被外部 interrupt、可被 plan_approver 同步翻转 mode。审批不是简单 yes/no：`ALWAYS_TOOL` 生成 standing rule，后续同类 tool 自动放行；unattended 运行不阻塞——asks 落入 inbox 等用户回填，engine 持久化 `tool_call_id` 实现幂等恢复。`max_iterations=12` 是保守默认，但对 coworker 场景（交付物而非长链路编码）合理。

**反证**: 未发现反证。但 `max_iterations` 是否对复杂多步任务（如跨 Jira+GitHub 的状态核对）足够，未见 eval 数据支撑——这与简报 §6 "未找到评估基础设施"一致。

**结论**: OpenWorker 的 agent loop 是**审批门控的可中断可恢复执行模型**——审批粒度化（once / always_tool / always_command / deny）、mode 可运行时翻转（plan↔discuss↔interactive）、unattended 场景通过 inbox + durable resume 解耦。

**置信度**: 高 — engine.py docstring + 枚举 + 测试文件名（`test_standing_approvals.py`、`test_plan_mode.py`、`test_durable_resume.py`）多重交叉验证。

---

### 2.3 Persona ⊇ Skill：严格 manifest 驱动的 Agent 定义

**问题**: OpenWorker 如何定义和扩展 agent？persona 与 skill 的关系是什么？

**证据**:
- `coworker/personas/manifest.py:4` 注释："`persona ⊇ skill` — the same frontmatter-markdown shape as SKILL.md, with more structured fields"（源码验证）
- `PersonaManifest` dataclass 字段：`id` / `name` / `system_prompt` / `family`（"code"|"knowledge"） / `workspace`（"git"|"project"|"deliverable"|"none"） / `tools` / `connectors` / `messaging` / `mcp` / `recommends` / `recommended_models` / `skills`（`manifest.py:48-70`）
- `_ID_RE = r"^[a-z0-9][a-z0-9_-]{0,63}$"`——persona id 强制为跨 OS 文件系统安全 slug（`manifest.py:21`），防止路径穿越
- `ManifestError(ValueError)` + 注释："a third-party persona must fail loudly"（`manifest.py:30`、`manifest.py:6`）
- `coworker/agents/registry.py` 委托给 `personas.registry`，懒导入避免 `personas → agents builders` 循环（`registry.py:6-7`）
- 测试 `tests/test_persona_manifest.py`、`tests/test_persona_loading.py`、`tests/test_persona_registry.py`、`tests/test_persona_connections.py`——manifest 是被测对象
- 内置 persona：`coworker/personas/builtin/ops.md`；legacy `myhelper_agent` 直接构建（`registry.py:17`）

**分析**: persona 是 Agent 对象的**声明式描述**——YAML frontmatter 声明能力（tools/connectors/mcp/messaging/skills/workspace），markdown body 是 system prompt。`to_agent()` 方法把 manifest 物化为运行时 Agent。`persona ⊇ skill` 意味着 persona 可以下放 skill 注册，skill 复用相同 frontmatter-markdown 形状——这是一种**渐进式扩展**：从单文件 skill 到完整 persona 不需要切换格式。严格解析（`ManifestError`）是关键工程决策——第三方 persona 在打包阶段就暴露问题，而非运行时静默半坏。

**反证**: `VALID_FAMILIES = {"code", "knowledge"}` 只有两类——这是从早期 enum collapse 而来（`manifest.py:58` 注释："Derived from family since the enum collapse (§16)"）。collapse 减少了表达力，但简化了 workspace 派生（code→git, knowledge→deliverable）。这是 trade-off 而非反证。

**结论**: OpenWorker 使用**严格 manifest 驱动的 persona-skill 同构扩展模型**——persona ⊇ skill 共享 frontmatter-markdown 格式，第三方扩展必须显式失败，family 已收敛为 code/knowledge 两类。

**置信度**: 高 — manifest 源码 + 多个 persona 测试 + registry 懒导入注释多重验证。

---

### 2.4 Scheduler 的"不阻塞"设计：spawn 而非 await

**问题**: OpenWorker 的自动化调度如何避免一个慢任务拖垮整个 scheduler？

**证据**:
- `coworker/automation/scheduler.py:76-84` `_tick` 方法：每个 due task `asyncio.create_task(self.run_task(...))` 而非 `await`——spawn 独立 task
- 注释："Spawn, don't await: a run can suspend on a parked approval (standing scoped approvals, §25) and one blocked automation must never stall the scheduler loop, other due tasks, or self-wake resumption"（`scheduler.py:78-81`）
- `_running_ids` skip-on-overlap：`if task.id in self._running_ids: return None`——同 task 上一轮未完成则跳过本次（`scheduler.py:92-94`）
- 启动时 `await self._tick(trigger="catchup")`——服务重启后补跑漏掉的任务（`scheduler.py:66`）
- `_spawned` 集合 + `add_done_callback(self._spawned.discard)`——监督所有 spawned task，shutdown 时全部 cancel（`scheduler.py:55-61`）
- `croniter>=2` 依赖计算 cron 下次触发（`pyproject.toml:27`）
- self-wake 机制：`coworker/selfwake.py` + `selfwake_tools(wake_store, session_id)`（`agent.py:238-239`）仅对 `family == "knowledge"` 注册

**分析**: scheduler 的"不阻塞"是显式设计——spawn 而非 await 让一个停泊在 approval inbox 的 unattended run 不能阻塞其他 due task。skip-on-overlap 保证同一 task 不会并发执行两次。catchup + durable resume（`tool_call_id` 幂等）共同保证服务重启后状态一致。shutdown 协议（cancel 所有 spawned）确保 suspended run 不会成为孤儿。

**反证**: 未发现反证。但 spawn 模式意味着**多个 long-running automation 可能并发消耗 provider quota**——scheduler 没有显式并发上限（只有 per-task overlap guard）。对个人桌面场景可接受，对团队部署可能是隐患。

**结论**: OpenWorker 的 scheduler 采用**spawn-不阻塞 + skip-on-overlap + catchup 补跑**三件套，专门为 unattended + approval parking 场景设计。

**置信度**: 高 — scheduler 源码 + 注释 + croniter 依赖 + selfwake 源码交叉验证。

---

### 2.5 Provider 抽象：基于 aisuite 的多模型路由

**问题**: OpenWorker 如何支持 12+ LLM provider 而不锁死用户？

**证据**:
- `pyproject.toml:11-13` 同时依赖 `openai>=1.0` / `anthropic>=0.40` / `google-genai>=1.0`——三大原生 SDK
- `pyproject.toml:19` aisuite 以 git commit pin 形式依赖：`"aisuite @ git+https://github.com/andrewyng/aisuite.git@1b4bbf303ec21968230b1ec869a144d054e9b3c4"`
- `coworker/providers/` 目录：`anthropic_provider.py` / `gemini_provider.py` / `openai_provider.py` / `router.py` / `matrix.py` / `capabilities.py` / `registry.py`（源码验证）
- `agent.py:212` `ProviderRouter(secrets, default_provider="openai")`——按 model 字符串的 `provider:` 前缀路由
- 测试覆盖：`test_anthropic_provider.py`(32) / `test_gemini_provider.py`(32) / `test_provider_router.py`(34) / `test_providers.py` / `test_provider_verify.py`（简报 §4）
- README 列出 12 个 provider：OpenAI / Anthropic / Gemini / Inkling / GLM / DeepSeek / Kimi / Qwen / MiniMax / Mistral / Grok / Ollama（含本地）
- `surfaces/gui/src/providers/logos/` 含 13 个 SVG logo——UI 层 provider 平等呈现

**分析**: OpenWorker 不重新发明 provider 抽象——它继承 aisuite 的 unified chat-completions API，但为三大原生 SDK 写了自己的 provider 实现（绕过 aisuite 的 thin wrapper 以拿到 native capabilities，如 Anthropic 的 native Messages API）。`ProviderRouter` 按 `provider:` 前缀解析 model 字符串，使 model 切换零配置。git commit pin（而非 PyPI 版本）说明 aisuite 还未发布稳定 release，OpenWorker 选择**确定性优先于可升级性**——这是一个早期项目的合理 trade-off。

**反证**: 未发现反证。但 git pin 意味着 aisuite 上游 bug fix 不会自动到达——需要手动 bump commit。`pyproject.toml:18` 注释承认这一点："swap for a PyPI pin once the next aisuite release ships"。

**结论**: OpenWorker 采用**aisuite-继承 + 三大原生 provider 重写 + 前缀路由**的多模型策略，git pin 锁定确定性，等待 aisuite 稳定 release 后切换。

**置信度**: 高 — pyproject 依赖 + providers 目录 + router 注释 + 测试覆盖多重验证。

---

### 2.6 测试策略：Fake Slack + E2E 主导

**问题**: OpenWorker 的测试策略是否充分？如何避免真实 API 调用？

**证据**:
- 148 测试文件 / 1009 测试函数 / test-source ratio 0.42（简报 §4）——高于典型 0.15 阈值
- `coworker/testing/fake_slack/server.py` 入度 19、entrypoint——一个**完整的 fake Slack server** 作为 test fixture（简报 §2、§5.5）
- `pyproject.toml:43` `messaging = ["python-telegram-bot>=21", "slack-bolt>=1.18", "aiohttp>=3.9"]` 注释："the FakeSlack test harness drives the real handler"——fake server 驱动真实 handler 代码
- `surfaces/gui/e2e/` 含 60+ Playwright spec 文件（`access-section.spec.ts`、`approval-card.spec.ts`、`automations.spec.ts`、`cloud.spec.ts`、`mcp-oauth.spec.ts` 等）——hermetic E2E（简报 §4：测试模式 corpus + e2e）
- `surfaces/gui/e2e-live/` 含 `fib.spec.ts`、`approval.spec.ts`、`persistence.spec.ts`——live E2E（连真实后端）
- Top 测试模块：connectors(50) / provider_router(34) / server(34) / anthropic_provider(32) / gemini_provider(32)（简报 §4）
- CI workflow `ci.yml` jobs: pytest, gui-unit, gui-e2e（简报 §5.5 workflow 对象）

**分析**: 测试策略**双轨**——后端用 fake Slack server 而非 mock，保证 handler 代码路径真实执行；前端用 Playwright hermetic E2E（60+ spec）覆盖几乎所有 UI 流。fake_slack server 的入度 19 说明它被广泛复用为 fixture——这是一个**测试基础设施投资**而非一次性 mock。connectors 测试最多（50）反映这是高风险区（外部 IO + 副作用）。

**反证**: 简报 §4 声明 "No evaluation/benchmark artifacts detected"——没有 agent 行为的自动化评估。对一个 agentic 产品，这是显著缺口：知道 handler 不崩溃 ≠ 知道 agent 交付了正确工作。

**结论**: OpenWorker 的**功能测试充分**（fake server + 60+ E2E + 高 connectors 覆盖），但**评估基础设施缺失**——这是研究边界而非缺陷。

**置信度**: 高 — 测试文件数、fake_slack 源码、CI workflow、Playwright spec 列表多重验证。

---

### 2.7 上下文工程：动态拼装的 instructions

**问题**: OpenWorker 如何构造 agent 的 system prompt？是静态还是动态？

**证据**:
- `agent.py:241-264` 显示 instructions 是**逐步 f-string 拼装**：
  - `instructions = f"{agent.system_prompt}\n\n{_NARRATION_GUIDANCE}"`
  - `+= environment_context(ws)`（若 workspace）
  - `+= load_agents_md(ws)`（用户自定义约定）
  - `+= _MEMORY_GUIDANCE` + `format_memories(remembered)`（若 memory_store）
  - `+= skill_catalog_text(skill_loader)`（若 skill 存在）
- `agent.py:283-302` `context_provider()` 是**每轮调用**的 ephemeral context——附加到最近 user message 而非 system message
- 注释："We can't reliably inject system messages mid-thread across providers, so dynamic per-turn context (e.g. the live directory list) rides on the latest user turn"（`engine.py:90-93`）
- Plan/Discuss mode 提示也是 per-turn 注入（`agent.py:294-297`），因为 mode 可中途翻转
- memory scope：`Scope.GLOBAL` + `Scope.WORKSPACE`（`agent.py:253-255`）
- 简报 §3: 15 个 prompt 对象，9 个 few-shot、2 个 assistant、4 个 prompt——拼装式

**分析**: 上下文工程是**双层动态拼装**——静态层（system prompt + narration + environment + AGENTS.md + memory + skill catalog）在 build_engine 时组装；动态层（plan mode reminder + live roots）每轮通过 `context_provider` 注入到最近 user message。后者是 provider 兼容性 hack——mid-thread system message 在不同 provider 行为不一致。这反映 OpenWorker 对**多 provider 真实差异**的工程认知。

**反证**: 未发现反证。但拼装式 instructions 难以审计——一个 agent 实际看到的 final prompt 是多处 f-string 串接的结果，没有 single source of truth。debug 时需要打日志还原。

**结论**: OpenWorker 使用**双层动态 instructions 拼装**——静态层 build-time 组装，动态层 per-turn 注入到 user message（provider 兼容性 hack）。

**置信度**: 高 — agent.py 源码 + engine.py 注释 + memory scope 代码交叉验证。

---

## 3. Negative Findings

> 这些"未找到"是研究边界，不是缺陷声明。每条说明为什么这个缺失重要。

- **未找到评估/benchmark 基础设施**（简报 §6）：对一个 agentic 产品，仅有功能测试不足以衡量"agent 是否交付了正确工作"。建议参考 Pi 的 faux provider + replay 模式构建 agent 行为基准。**重要性**：高——决定产品能否量化迭代。
- **未找到 LICENSE 误报**：经 `LS` + `Read` 验证，`ref-only/openworker/LICENSE` **存在**（MIT License, Copyright (c) 2024 Andrew Ng）。简报 §6 **未**将 LICENSE 列为缺失——简报 §7 Reading Priority 第 15 项正确标注了 LICENSE（important file +40）。此前其他仓库报告出现的"误报无 LICENSE"问题在本简报中**不存在**，无需校正。
- **未找到 agent 并发上限配置**：scheduler 只有 per-task overlap guard（`_running_ids`），未见全局并发 quota 或 provider rate-limit 抽象。**重要性**：中——个人桌面场景可接受，团队部署可能触发 provider 限流。
- **未找到 extension 沙箱**：persona/skill 在进程内加载，未见沙箱隔离。MCP 走 stdio/http 是天然进程隔离，但本地 skill 没有。**重要性**：中——第三方 persona 信任模型靠 `ManifestError` 严格校验，无运行时隔离。
- **未找到观测性基础设施**：`coworker/audit.py` 存在但只是 audit sink；未见 OpenTelemetry / metrics / structured log pipeline。**重要性**：中——Beta 阶段可接受，生产化前需要补。
- **未找到 release notes / CHANGELOG**：46 commits 但无 CHANGELOG.md。**重要性**：低——4 contributors 阶段尚可，扩大协作时需要。

---

## 4. Architecture Smells

> 以下都是 **Potential**，不是断言。证据 + 置信度。

- **Potential Tight Coupling — 9 个 import cycle**（置信度：高）：简报 §2 列出 `coworker.tui.app → coworker.tui.app`（自循环）、`surfaces.gui.src.types ↔ api`、`humanize ↔ ApprovalCard`、`ConnectorsSection ↔ AccountsDetail` / `CalendarDetail` 等。GUI connectors 区的循环说明**详情页与列表页双向依赖**——典型 React 组件分层问题。证据：简报 §2 cycle 列表。建议：抽 connector 共享 hook 或 context。
- **Potential Architectural Bottleneck — `types.ts` PageRank 0.2222**（置信度：高）：`surfaces.gui.src.types` 和 `surfaces.gui.src.api` 的 PageRank 合计 0.43——GUI 几乎所有模块都依赖这两个文件。types 变更会涟漪整个前端。证据：简报 §2 PageRank 排名。建议：types 按域拆分（connector-types / session-types / api-types）。
- **Potential Test Fixture Leaking — `fake_slack.server` 入度 19**（置信度：中）：测试基础设施模块出现在"most depended-upon"榜单，说明它被生产代码（而非仅 test 代码）依赖，或 analyzer 把 test 导入计入了生产依赖图。证据：简报 §2。建议：确认 `coworker.testing` 是否被非 test 代码导入。
- **Potential Hidden Complexity — `max_iterations=12` 默认**（置信度：中）：对 coworker 场景（交付物）够用，但对 code-family agent（跨 Jira+GitHub 状态核对 + 文件编辑）可能偏紧。证据：`engine.py:62`。建议：按 persona family 派生 max_iterations。
- **Potential Scalability — scheduler 无全局并发上限**（置信度：中）：见 Negative Findings。证据：`scheduler.py:76-84` 仅 spawn 不限流。
- **Potential Over-engineering — `Mode` 5 值枚举**（置信度：低）：`discuss / plan / interactive / custom / auto` 五种模式 + per-turn context 注入，对个人桌面应用可能偏复杂。但 `VALID_MODES` 来自 `manifest.py:25` 且测试覆盖 `test_plan_mode.py`，说明是有意设计而非冗余。证据：`manifest.py:25`。

---

## 5. Interesting Decisions

### 5.1 pypdf + pypdfium2 而非 PyMuPDF

**决策**: PDF 处理用 `pypdf`（文本抽取）+ `pypdfium2`（页面光栅化），显式拒绝 PyMuPDF。
**为什么有趣**: `pyproject.toml:30-31` 注释直接给出理由："NOT PyMuPDF, whose AGPL license can't ride in the DMG"。这是一个**license-driven 技术选型**——AGPL 与 macOS DMG 分发不兼容。
**替代方案**: PyMuPDF（fitz）性能更好但 AGPL。
**权衡**: 性能 ↔ 分发合规性。OpenWorker 选择合规性，因为桌面分发是核心。

### 5.2 `tzdata; sys_platform == 'win32'` 条件依赖

**决策**: 仅在 Windows 平台声明 `tzdata` 依赖。
**为什么有趣**: `pyproject.toml:34-35` 注释："Windows ships no system tz db, so without this every named schedule timezone (UTC, Asia/Kolkata, …) silently falls back to local time"。
**替代方案**: 无条件声明 `tzdata`（多 2MB）。
**权衡**: 安装包体积 ↔ 跨平台行为一致性。这是一个**基于真实 bug 的精准修复**，而非防御性编程。

### 5.3 Persona id 强制文件系统安全 slug

**决策**: `_ID_RE = r"^[a-z0-9][a-z0-9_-]{0,63}$"`，禁止路径分隔符、`..`、Windows 非法字符。
**为什么有趣**: persona id 会成为目录名和 registry key，必须在所有 OS 上安全。
**替代方案**: 运行时 sanitize。
**权衡**: 严格 upfront 校验 ↔ 第三方 persona 命名自由度。OpenWorker 选择"fail loudly at install"，与 `ManifestError` 哲学一致。

### 5.4 ephemeral context 注入到 user message 而非 system message

**决策**: per-turn 动态 context（plan mode reminder、live directory list）通过 `context_provider` 附加到**最近 user message**。
**为什么有趣**: `engine.py:90-93` 注释："We can't reliably inject system messages mid-thread across providers"。
**替代方案**: 注入 system message（更"正确"但跨 provider 行为不一致）。
**权衡**: 语义纯度 ↔ 跨 provider 可移植性。OpenWorker 选择可移植性——这是多 provider 产品的现实主义。

### 5.5 `persona ⊇ skill` 而非独立概念

**决策**: persona 和 skill 共享 frontmatter-markdown 格式，persona 多一层结构化字段。
**为什么有趣**: `manifest.py:4` 注释明确这个关系。
**替代方案**: 两套独立格式 + 转换层。
**权衡**: 概念清晰度 ↔ 渐进式扩展路径。OpenWorker 选择渐进式——单文件 skill 可平滑升级为完整 persona。

---

## 6. Repository Positioning

| 维度 | 成熟度 | 说明 |
|------|--------|------|
| Planning | Common | `propose_plan_tool` + Plan mode + `_handle_plan_proposal` planner 对象（简报 §5.5）——标准 plan-then-execute |
| Execution | Advanced | TurnEngine + approval gating + durable resume + interrupt hooks——超越典型 harness |
| Memory | Common | `memory/sqlite_store.py` + GLOBAL/WORKSPACE scope + memory_tools——基础但够用 |
| Evaluation | Emerging | **未找到** eval 基础设施（简报 §6）——仅 1 个 evaluation 对象（简报 §5.5） |
| Guardrails | Advanced | PermissionEngine + Mode 枚举 + risk_overrides + standing approvals + unattended inbox——一等公民 |
| Prompt | Common | 15 个 prompt 对象，双层动态拼装（agent.py:241-302）——拼装式而非模板引擎 |
| Tooling | Advanced | 25+ connectors + MCP client + browser automation + explorer subagents——广度突出 |
| Observability | Emerging | `audit.py` 存在但无 metrics/trace pipeline——Beta 阶段可接受 |

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|----------|
| Approval-gated TurnEngine | `ApprovalOutcome` 枚举 + `tool_call_id` 幂等 + approver callback | `coworker/engine.py` | ✅ 通用 |
| Spawn-不阻塞 Scheduler | `asyncio.create_task` per due task + skip-on-overlap + catchup | `coworker/automation/scheduler.py` | ✅ 通用 |
| Persona ⊇ Skill 同构 | frontmatter-markdown 共享格式，严格 manifest 校验 | `coworker/personas/manifest.py` | ✅ 通用 |
| Ephemeral per-turn Context | 动态 context 注入最近 user message（provider 兼容） | `coworker/engine.py:90`、`coworker/agent.py:292` | ✅ 通用 |
| Fake Server as Test Fixture | `fake_slack/server.py` 完整 fake server 驱动真实 handler | `coworker/testing/fake_slack/` | ⚠ 需适配（每个外部服务都要写一个） |
| Per-family Tool Branching | `if agent.family == "code"` 注册 explorer / `knowledge` 注册 scheduling | `coworker/agent.py:215-239` | ✅ 通用 |
| Lazy Import to Break Cycle | `agents/registry.py` 懒导入 `personas.registry` 避免循环 | `coworker/agents/registry.py:19` | ✅ 通用 |
| License-driven Dep Selection | 拒绝 AGPL 库以保 DMG 分发合规 | `pyproject.toml:30-31` | ⚠ 特定场景（分发产品） |
| Conditional Platform Dep | `tzdata; sys_platform == 'win32'` 精准平台补丁 | `pyproject.toml:35` | ✅ 通用 |
| Standing Approval Parking | unattended run 的 ask 落入 inbox，durable resume | `coworker/inbox.py`、`coworker/unattended.py` | ✅ 通用 |

---

## 8. Architecture Evolution

基于 46 commits + 4 contributors 的有限历史，可观察到的演进痕迹：

- **Family enum collapse**：`manifest.py:58` 注释 "Derived from family since the enum collapse (§16)"——早期有更多 family，已收敛为 code/knowledge 两类。code 派生 git workspace，knowledge 派生 deliverable workspace。**信号**：从细粒度分类走向二元模型，简化派生逻辑。
- **aisuite 迁移**：README："OpenWorker was originally developed inside the aisuite repository before moving to its own home here"——这是一个**从库到产品**的剥离。`pyproject.toml:18-19` 的 git commit pin 是迁移期的过渡状态，注释承诺 "swap for a PyPI pin once the next aisuite release ships"。
- **Legacy persona 保留**：`registry.py:17` `if name == "myhelper": return myhelper_agent()`——`myhelper` 是 legacy personal-helper persona，直接构建而非走 manifest。注释："kept for sessions that still reference it"。**信号**：向后兼容优先，但留了技术债。
- **Mode 枚举扩展**：`VALID_MODES = {"discuss", "plan", "interactive", "custom", "auto"}`——5 种模式暗示经历过从单一 interactive 到 plan/discuss 再到 custom/auto 的扩展。
- **§25 standing approvals / §16 enum collapse**：源码注释引用 § 编号，说明项目内部有 design spec 文档（`docs/` 目录），架构决策有可追溯的 RFC 链路。

---

## 9. Reading Guide

### 30 分钟速览（5 个文件）

1. **`README.md`** — 项目定位、三层架构图、25+ connectors、12 providers。最高信息密度。
2. **`coworker/engine.py`**（前 120 行）— TurnEngine docstring + `ApprovalOutcome` 枚举 + `__init__` 签名。理解 agent loop 的 owned/可中断/approval-gated 设计。
3. **`coworker/agent.py`**（200-320 行）— instructions 拼装 + per-family tool 分支 + memory/skill 注册。理解上下文工程。
4. **`coworker/personas/manifest.py`**（前 80 行）— `PersonaManifest` dataclass + `VALID_FAMILIES` + `_ID_RE`。理解 persona ⊇ skill 模型。
5. **`coworker/automation/scheduler.py`**（50-113 行）— `_tick` + `run_task`。理解 spawn-不阻塞设计。

### 2 小时深入（+ 10 个文件）

6. **`coworker/permissions.py`** — PermissionEngine + Mode + risk_overrides。approval 系统的核心。
7. **`coworker/inbox.py`** + **`coworker/unattended.py`** — standing approvals + durable resume。unattended 场景的关键。
8. **`coworker/providers/router.py`** — ProviderRouter 的 `provider:` 前缀解析。
9. **`coworker/agents/registry.py`** — 懒导入破环 + persona registry 委托。
10. **`coworker/testing/fake_slack/server.py`** — fake server 作为 test fixture 的设计。
11. **`surfaces/gui/src/api.ts`**（PageRank 0.2052）— GUI↔后端契约层，理解进程间通信。
12. **`surfaces/gui/src/streamGate.ts` + `.test.ts`** — GUI 流式响应处理（高 PageRank 测试）。
13. **`.github/workflows/ci.yml`** — pytest + gui-unit + gui-e2e 三 job 矩阵。
14. **`packaging/build_dmg.sh`** — macOS 分发流程，理解 license 选型约束。
15. **`docs/config.example.toml`** — 配置 schema，理解用户可调参数。

> 阅读顺序按"洞察密度"——先看 docstring 和 dataclass（高密度声明），再看实现（中密度逻辑），最后看测试和打包（验证性低密度）。

---

## 10. Open Questions

### Q1: agent 行为是否有量化评估？
**为什么重要**: 功能测试（fake Slack + E2E）只能证明 handler 不崩溃，不能证明 agent 交付了正确工作。对 agentic 产品，eval 是迭代的基础。
**建议调查方法**: 搜索 `eval` / `benchmark` / `judge` 关键词；检查 `docs/` 是否有 eval design spec；查看 `surfaces/gui/e2e-live/` 的 fib/approval/persistence spec 是否兼任 acceptance benchmark。

### Q2: scheduler 是否需要全局并发上限？
**为什么重要**: spawn-不阻塞设计在多 automation 并发时会同时打多个 provider 请求，可能触发限流或 quota 超支。
**建议调查方法**: 读 `scheduler.py` 完整实现 + `automation/store.py`；搜索 `semaphore` / `concurrency` / `rate_limit`；检查 `coworker/cloud.py`（入度 24）是否含配额逻辑。

### Q3: MCP 风险模型与 risk_overrides 的实际边界？
**为什么重要**: `agent.py:267-268` 注释 "mainly to relax MCP's conservative default"——risk override 是用户侧风险放松机制，需要理解其授权边界。
**建议调查方法**: 读 `coworker/risk.py` + `coworker/overrides.py` + `tests/test_permissions_risk.py` + `tests/test_risk_overrides.py`；追踪 `RiskOverrideStore` 的写入路径（注释说 "never written by persona loading"）。

### Q4: explorer subagent 如何与主 agent 协调上下文？
**为什么重要**: `agent.py:215-223` 显示 code-family 会 fan out 到 read-only explorer subagents "keeping their own context for the actual change"——这是上下文隔离的多 agent 模式，值得提取模式。
**建议调查方法**: 读 `coworker/tools/subagent.py`（简报 §5.5 prompt 对象位置）+ `tests/test_subagent.py`；追踪 explorer_tools 注册的工具集。

### Q5: `surfaces.gui.src.types` 的 0.2222 PageRank 是否是技术债？
**为什么重要**: 全 GUI 几乎都依赖单一 types 文件——变更涟漪大。是 monorepe 还是 god-file？
**建议调查方法**: 读 `surfaces/gui/src/types.ts` 行数 + 内容分类；统计被导入的 symbol 数；评估拆分成本。

---

*报告基于 `evidence-brief.md`（确定性分析）+ `ref-only/openworker/` 源码交叉验证。所有结论的置信度标注均基于证据强度。*
