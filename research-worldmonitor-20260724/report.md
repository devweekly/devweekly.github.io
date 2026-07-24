# world-monitor 工程研究报告

> 基于 research-repo skill 确定性分析（2026-07-23）+ 源码交叉验证（2026-07-24）生成。
> 证据存储：`evidence-store/full.json`（105MB，仅按需 Grep）。
> 源码根：`ref-only/worldmonitor/`。

---

## 1. 执行摘要

**world-monitor**（v2.10.0，AGPL-3.0）是一个面向实时全球态势感知的情报仪表盘，单一 TypeScript 代码库同时驱动 6 个 Web 站点变体（world / tech / finance / commodity / happy / energy）、Tauri 桌面应用、4 个语言 SDK（Go / Python / Ruby / npm CLI）、80+ Vercel Edge API、以及一个**完整实现的 MCP（Model Context Protocol）服务器**。仓库处于 mature 阶段：4958 commits、117 contributors、2505 模块、22 个 CI workflow（§1 / §5 of brief）。

最有趣的发现集中在 **`api/mcp/`**：项目以 **schema-first registry-array 模式**注册了 43 个 MCP 工具，每个工具都被强制声明 `outputSchema` / `annotations` / `_outputBudgetBytes` / `_apiPaths`，并通过 **U3 / U5 / U7 三层 parity 测试**与 OpenAPI 规范、seeded cache inventory 双向锁定。这是一套罕见的「评估驱动质量门禁」工程实践——schema 既是 LLM 的 first-class 上下文，也是 CI 的不可变契约。

第二个亮点是 **多表面架构（multi-surface architecture）**：同一组 tool 对象通过 `buildPublicTool()` 单一入口同时驱动 `tools/list`、`describe_tool`、`resources/templates/list`、`prompts/list`、`ui://` MCP Apps 五个表面，所有表面共享同一份 schema 源真相，避免漂移。

第三是 **匿名发现表面（anonymous discovery surface）**：`initialize` / `tools/list` / `prompts/list` / `resources/list` / `ping` 等方法允许零认证枚举，专门为 agent-readiness 扫描器设计——这是该项目对 MCP 生态贡献的最具复用价值的模式。

---

## 2. Research Traces

### Trace 2.1 — Schema-First Tool Registry：43 个工具如何被声明、合并、发布

**问题**：项目如何把 43 个 MCP 工具组织成可被 LLM 调用的接口？是否存在「装饰器 / 框架包装」？

**证据**：
- `api/mcp/registry/index.ts:12` — `export const TOOL_REGISTRY: ToolDef[] = [...CACHE_TOOLS, ...RPC_TOOLS];`（registry-array 模式，非装饰器）
- `api/mcp/types.ts:44-128` — `BaseToolDef` 强制要求 `outputSchema: object`、`annotations` 四布尔位、`_outputBudgetBytes: number`，注释明确写「Required field with NO default — every new tool must make the schema an explicit deliberate authorship step」
- `api/mcp/registry/cache-tools.ts:43-100` — `get_market_data` 的完整 schema-first 声明：`inputSchema` 嵌套 enum / 描述 / `outputSchema` 用 `cacheEnvelope()` helper 构造
- brief §3 — 43 个工具全部归类为 `schema-first`，框架分布无 `decorator` / `framework-wrapped`

**分析**：项目放弃了 MCP SDK 推荐的「`server.tool(name, schema, handler)` 命令式注册」路径，转而采用**纯数据 registry-array**——所有工具是 `ToolDef[]` 字面量，类型系统强制每个字段必填。`CacheToolDef` 与 `RpcToolDef` 通过 discriminated union 区分（`_execute?: never` vs `_cacheKeys?: never`），编译期阻止混用。`TOOL_REGISTRY` 在模块加载时合并两类工具，并立刻运行 **collision guard**（`registry/index.ts:27-35`）——任何手写的 `jmespath` / `summary` 属性与 universal injection 冲突都会在 module load 时抛错。

**反证**：未发现反证。`rpc-tools.ts` 中的工具（如 `get_country_brief`）同样遵守 schema-first 形态，`_execute` 仅负责运行时数据获取。

**结论**：world-monitor 选择 schema-first registry-array 作为唯一工具注册路径。Schema 既是 LLM 调用前的契约，也是 CI parity 测试的源真相——一份声明，三处消费（LLM 推理 / `tools/list` 线协议 / CI 校验）。

**置信度**：高 — 三处源码 + brief §3 + 类型定义一致。

---

### Trace 2.2 — 多表面架构：一份 ToolDef 驱动 5 个 MCP 表面

**问题**：MCP 服务器同时暴露 `tools` / `prompts` / `resources` / `ui` 四大能力，如何保证它们描述同一份底层能力时不漂移？

**证据**：
- `api/mcp/registry/index.ts:56-115` — `buildPublicTool(tool, opts)` 是「SINGLE source of truth」（注释原文），`tools/list` 与 `describe_tool` 都经过它
- `api/mcp/resources/index.ts:1-41` — `TEMPLATE_RESOURCE_REGISTRY` 注释明确写「A concrete instantiation `resources/read` routes through the SAME `dispatchToolsCall` path `tools/call` uses, so auth, Pro daily quota, telemetry, and per-tool budget gating are inherited unchanged」
- `api/mcp/prompts/index.ts:42-101` — `PROMPT_REGISTRY` 中每个 `McpPromptStep` 引用 `tool` 名 + 字面量 `jmespath`，注释指出「only reference fields that exist in the targeted tool's `outputSchema`」并由 schema-parity test 校验
- `api/mcp/types.ts:120-127` — `_uiResourceUri` 字段把 tool 链接到 MCP Apps `ui://` shell，`buildPublicTool` 在 line 107-112 派生 `_meta.ui.resourceUri`
- brief §5.5 — `tool` 对象 43 个、`prompt` 对象 16 个、`agent` 对象 22 个、`uses` 关系 333 条

**分析**：这是一个典型的「**Single Source of Truth + 多视图投影**」架构。ToolDef 是唯一真相；其他四个表面都是它的投影：
- `tools/list` ← `buildPublicTool(compressDescriptions: true)`
- `describe_tool` ← `buildPublicTool(compressDescriptions: false)`
- `resources/templates/list` ← `TEMPLATE_RESOURCE_REGISTRY` 每项的 `tool` 字段反向引用 `TOOL_REGISTRY`
- `prompts/list` ← `PROMPT_REGISTRY` 每步的 `tool` 字段反向引用
- `ui://` shell ← `_uiResourceUri` 字段

任何表面修改都必须先改 ToolDef，因此**漂移在编译期和测试期被阻止**。

**反证**：未发现反证。`prompts/index.ts:22-24` 注释承认 tool-name parity 由 test time 而非 module load 校验，原因是避免 import cycle——这是工程权衡，不是矛盾。

**结论**：多表面架构通过「ToolDef 为根 + buildPublicTool 为单一投影函数 + 反向引用 + parity test」实现，是 MCP 服务器领域罕见的零漂移设计。

**置信度**：高 — 4 个独立文件相互印证。

---

### Trace 2.3 — 评估驱动质量门禁：U3 / U5 / U7 三层 Parity 测试

**问题**：43 个工具声明了 schema，但如何确保 schema 与实际数据形状一致？如何防止新 seed 上线后 MCP 工具漏覆盖？

**证据**：
- `tests/mcp-bootstrap-parity.test.mjs:1-11` — **U7 (Tier 3) parity**：断言 `api/health.js::BOOTSTRAP_KEYS ∪ STANDALONE_KEYS` 中每个 cache key 都被某个 `TOOL_REGISTRY[i]._cacheKeys` 或 `_coverageKeys` 覆盖，或在 `EXCLUDED_FROM_MCP` 中带非空 reason 列出。注释：「a new seed shipping its cache key into BOOTSTRAP_KEYS/STANDALONE_KEYS without a corresponding MCP tool will fail CI」
- `tests/mcp-tool-output-contracts.test.mjs:1-22` — 对每个工具触发 `tools/call`，断言返回的 `content[0].text` JSON 通过该工具自己声明的 `outputSchema` 验证。一个 `it()` per tool，「a failure names the offending tool」
- `api/mcp/types.ts:152-158` / `:178-197` — `_apiPaths: string[]` 是 CacheToolDef 和 RpcToolDef 的 **REQUIRED** 字段，注释指向「U5 MCP↔API parity test」
- brief §4 — 91 test files / 1235 test functions，`mcpProTokens` 模块 39 tests、`billing` 132 tests；Eval files 118 个；metrics 包括 `score / exact-match / recall / accuracy / f1 / precision / rouge / bleu`

**分析**：三层 parity 形成一个**闭环防漂移机制**：
1. **U3 (Tier-4)** — Tool._apiPaths ↔ OpenAPI 规范：每个工具声明它代理的 OpenAPI operation，CI 校验文档里每个 op 都被覆盖
2. **U5 (MCP↔API)** — Tool._apiPaths ↔ 实际 fetch 调用：防止工具声明与运行时不一致
3. **U7 (Tier-3)** — Tool._cacheKeys/_coverageKeys ↔ BOOTSTRAP_KEYS：防止 seed 数据上线但 MCP 工具漏注册

更关键的是 `mcp-tool-output-contracts.test.mjs` 把 schema 当成**回归契约**——outputSchema 不再只是 LLM 的提示，而是 CI 不可变的形状断言。这把 schema 从「文档」提升为「执行规约」。

**反证**：brief §4 显示 test/source ratio 仅 0.04，低于典型 0.15 阈值。但这只是文件计数比值，不反映测试强度——单 `mcp-tool-output-contracts.test.mjs` 就对 43 个工具做形状回归。属于指标误导，非真矛盾。

**结论**：评估驱动质量门禁是 world-monitor 最具研究价值的实践——schema 既是 LLM 上下文，也是 CI 契约，三层 parity 把「文档-实现-数据」三方锁定。

**置信度**：高 — 测试源码 + 类型定义 + brief §4 三方印证。

---

### Trace 2.4 — 匿名发现表面：为 Agent Readiness 扫描器设计的零认证路径

**问题**：MCP 协议要求 `initialize` 后才能 `tools/list`，但 `initialize` 是否需要认证？扫描器如何工作？

**证据**：
- `api/mcp/handler.ts:33-73` — `PUBLIC_MCP_METHODS` 集合：`initialize` / `notifications/initialized` / `ping` / `tools/list` / `prompts/list` / `prompts/get` / `resources/list` / `resources/templates/list` / `logging/setLevel`
- 注释 line 44-50：「The gating invariant (#4937): every capability the ANONYMOUS `initialize` advertises must be anonymously exercisable. A gated method answers HTTP 401 with JSON-RPC id:null, which an MCP SDK transport cannot correlate to the pending request — the client hangs to its 30s timeout」
- `api/mcp/resources/index.ts:78` — `PUBLIC_RESOURCE_REGISTRY` 返回仅 freshness / health metadata，**不携带 billable data**，quota-exempt
- brief §1 — `public/agents.md` / `public/llms.txt` / `public/mcp-server.md` / `public/agent-view.json` 等 agent-readiness 静态文件

**分析**：项目刻意区分两类表面：
- **匿名发现表面**（catalog-only，零数据）：`tools/list` / `prompts/list` / `resources/list` / `resources/templates/list` / `describe_tool` / `resources/read` of public resource
- **数据表面**（需认证 + 消耗 quota）：`tools/call` / `resources/read` of template instantiation

这种分离的本质是**把 MCP 协议的「capability advertisement」与「capability execution」解耦**——agent-readiness 扫描器可以零成本枚举所有能力，而所有数据访问仍走 Pro daily quota。注释 #4937 还揭示了一个**反直觉的工程教训**：在 JSON-RPC 上对 `id:null` 返回 401 会让 MCP SDK 永久 hang 到 30s timeout——这是 Claude Desktop + mcp-remote 客户的实际 bug 来源。

**反证**：未发现反证。`PUBLIC_RESOURCE_REGISTRY` 的 `read()` 函数对 cache miss 做 fail-soft（返回 `{cached_at: null, stale: true}`），明确为了「anonymous read never surfaces empty content」。

**结论**：匿名发现表面是 MCP 服务器设计的范本——同时满足 agent-readiness 扫描、quota 防泄漏、客户端不 hang 三个约束。

**置信度**：高 — handler.ts 注释极为详尽，且与 resources/index.ts 一致。

---

### Trace 2.5 — Prompt Workflow Registry：把多工具编排写成数据

**问题**：项目如何编排跨多个工具的复合 prompt？是代码还是数据？

**证据**：
- `api/mcp/prompts/index.ts:42-101` — `PROMPT_REGISTRY: McpPromptDef[]` 是数据字面量数组
- `country-briefing` prompt 编排 3 个工具：`get_country_risk` → `get_country_brief` → `get_country_macro`，每步带字面量 `jmespath` 投影 + `purpose` 说明
- `intro_substitutions` 字段（line 98-100）允许同一 prompt 在「filtered」和「global」两种 render 间切换，无需代码分支
- brief §5.5 — `prompt` 对象 16 个，分布：prompt (15) / template (5) / system (12)
- brief §3 — Tools/Prompts ratio = 1.3 → balanced prompt+tool design

**分析**：项目把 prompt workflow 也做成 registry-array，与 tool registry 同构。每个 `McpPromptStep` 是一个**声明式 tool-call**：`tool` 名 + `args`（带 `${token}` 模板变量）+ `jmespath` 字面量投影。Load-time validator（`validatePromptRegistry`）三类错误：未声明 token / 重复 prompt 名 / 重复 argument 名。Test-time 校验 jmespath 字段名是否存在于目标 tool 的 outputSchema。

这种设计的**核心收益**是 prompt 与 tool schema 的强耦合——LLM 不再需要在第一次调用 tool 时「试探」返回形状，prompt 已经预先 baked 好 jmespath 投影，把 multi-turn 探测压缩为单次调用。

**反证**：未发现反证。`mcp-prompts.test.mjs` 的存在（注释中提到）表明这套机制是测试覆盖的。

**结论**：Prompt Workflow Registry 把多工具编排从代码降维成数据，与 tool schema 强锁定，是上下文工程（context engineering）的高级模式。

**置信度**：高 — 源码 + brief §5.5 一致。

---

### Trace 2.6 — 多表面部署：单代码库 → 6 站点 + 桌面 + 4 SDK

**问题**：项目如何从单一代码库同时支持 6 个 Web 变体、桌面应用、4 个语言 SDK？

**证据**：
- `README.md:17-39` — 6 个 site variant（world / tech / finance / commodity / happy / energy）+ Tauri 桌面（macOS ARM/Intel、Windows、Linux AppImage）+ 4 SDK（npm / pip / gem / go）
- `README.md:59` — 「6 site variants from a single codebase」
- `README.md:67-76` — Support Status 表明确所有表面从同一 release process 构建
- brief §1 — 顶级目录 `api/` / `blog-site/` / `cli/` / `consumer-prices-core/` / `convex/` / `deploy/` / `docker/` / `e2e/` / `pro-test/` / `proto/` / `sdk/` / `server/`
- brief §5 — `sdk/go/` / `sdk/python/` / `sdk/ruby/` 各带独立 LICENSE + README + 语言原生 manifest（go.mod / pyproject.toml / gemspec）
- `AGENTS.md:7` — 「80+ Vercel Edge API endpoint entries, a Tauri desktop app with Node.js sidecar, and a Railway relay service」

**分析**：这是典型的 **Boring Architecture** 反模式对立面——项目刻意不拆 monorepo，而是用单一代码库承载所有表面，通过 `dev:tech` / `dev:finance` 等 npm script 切换变体。SDK 是从同一组 proto 定义（`proto/buf.yaml`）生成的多语言客户端。这种选择的权衡是：CI 复杂度上升（22 个 workflow），但跨表面一致性由代码共享天然保证。

**反证**：brief §2 显示 9 个 import cycles，其中 `api.mcp.registry.index → api.mcp.registry.rpc-tools → api.mcp.registry.index` 提示单代码库内部存在紧耦合，是多表面共享的代价。

**结论**：多表面部署通过单代码库 + 变体 script + proto 生成 SDK 实现，是工程一致性与 CI 复杂度的明确权衡。

**置信度**：高 — README + AGENTS.md + brief §1 三方一致。

---

## 3. Negative Findings

> 「未找到 X」与「找到 Y」具有同等研究价值。以下是基于源码验证的「未找到」清单。

### 3.1 未发现 agent 防无限循环机制
- **查找位置**：`api/mcp/handler.ts` / `api/mcp/dispatch.ts` / brief §3
- **未发现**：MAX_ITERATIONS / recursion_depth / loop_guard 等显式限制
- **为何重要**：brief §5.5 检测到 22 个 `agent` 对象 + 33 个 `planner` 对象，若无循环保护，prompt workflow 可能递归调用 tool
- **替代证据**：`_outputBudgetBytes`（每个 tool 必填）+ Pro daily quota 提供隐式上限，但这是 budget 而非 graph-cycle 检测
- **置信度**：中 — 仅基于静态搜索，未运行时验证

### 3.2 未发现传统测试框架
- **查找位置**：`package.json` / `tests/` / brief §4
- **未发现**：vitest / jest / mocha 配置
- **实际发现**：所有测试用 `node:test`（Node.js 原生 runner），如 `tests/mcp-bootstrap-parity.test.mjs:13` `import { describe, it } from 'node:test'`
- **为何重要**：符合「zero-dependency」哲学，但牺牲了 fixture / snapshot 等高级测试能力
- **置信度**：高 — 多个测试文件 import 路径一致

### 3.3 未发现 LICENSE 误报
- **背景**：skill 修复前曾误报无 LICENSE
- **验证**：`ref-only/worldmonitor/LICENSE` 第 9 行明确为「GNU AFFERO GENERAL PUBLIC LICENSE Version 3」
- **置信度**：高 — 直接读源

### 3.4 未发现明显的 Negative Finding 缺口
- brief §6：「无明显缺口检测到（不代表无缺口，仅表示脚本未检测到）」
- **解读**：这是 skill 的诚实声明——基于 AST + 静态分析的检测有边界，runtime 行为（如 quota race condition）需要动态验证

---

## 4. Architecture Smells

> 以下均为 **Potential**，非断言。

### 4.1 Potential Tight Coupling — 9 个 Import Cycles
- **证据**：brief §2 列出 9 个循环，最关键的是 `api.mcp.registry.index ↔ api.mcp.registry.rpc-tools`，以及 `server.worldmonitor.resilience.v1._dimension-scorers ↔ _dimension-freshness ↔ _indicator-registry` 三角循环
- **为何潜在风险**：cycle 意味着模块边界模糊，重构时改动会跨模块 ripple
- **置信度**：中 — cycle 存在是事实，但是否构成「风险」取决于团队维护习惯
- **缓解证据**：`api/mcp/types.ts:1-3` 注释明确写「Pure types only — no runtime exports — so this module is safe to import from anywhere without creating evaluation-order surprises or cycles」——团队有意识地用 type-only 模块打破 cycle

### 4.2 Potential Hidden Complexity — 单文件 16460 行 prompt
- **证据**：brief §5.5 — `scripts/seed-forecasts.mjs` 在 line 16460 检测到 prompt 对象，且 `scripts/ais-relay.cjs` 在 line 11098 检测到 system prompt
- **为何潜在风险**：单文件超过 16000 行通常意味着职责过载，难以 review
- **置信度**：中 — 文件行数是事实，但可能是合理的数据文件
- **建议调查**：第二轮研究应 Grep `scripts/seed-forecasts.mjs` 的导出结构

### 4.3 Potential Scalability Issue — Test/Source Ratio 0.04
- **证据**：brief §4 — 91 test files / 2505 modules = 0.04，低于典型 0.15 阈值
- **为何潜在风险**：表面看测试覆盖严重不足
- **置信度**：低 — 此指标有误导性。`mcp-tool-output-contracts.test.mjs` 单文件对 43 个工具做形状回归，强度高于多个浅测试文件
- **解读**：应区分「文件计数」与「断言密度」

### 4.4 Potential Over-engineering — Per-Tool _outputBudgetBytes + _apiPaths + annotations 全必填
- **证据**：`api/mcp/types.ts:44-128` — BaseToolDef 要求所有字段必填，注释反复用「Required field with NO default」「explicit deliberate authorship step」
- **为何潜在风险**：新增工具门槛高，可能阻碍贡献者快速实验
- **置信度**：中 — 是 trade-off，非缺陷。项目作者明确选择了「discipline over convenience」

---

## 5. Interesting Decisions

### 5.1 用 `structuredClone` 而非 `{...spread}` 防止 schema 污染
- **决策**：`api/mcp/registry/index.ts:69-78` — 递归 `structuredClone` 每个 property schema + universal injected schemas
- **为何有趣**：注释指出「Codex Round 2 explicitly flagged shallow `{ ...prop }` as insufficient for these shapes」——团队曾被浅拷贝坑过，nested `enum` 数组被 mutate 后污染了 module-level const
- **替代方案**：immer / immutable.js / 深层 Object.freeze
- **权衡**：`structuredClone` 是 Web Platform 标准 API（Vercel edge + Node 18+ 内置），零依赖，但每次 `tools/list` 都深拷贝 43 个工具——`TOOL_LIST_RESPONSE` 在 module load 时 precompute 缓解了这一开销

### 5.2 把 `_outputBudgetBytes` 设为 required 而非 optional
- **决策**：`api/mcp/types.ts:52` — `_outputBudgetBytes: number` 必填，无默认值
- **为何有趣**：大多数 MCP 实现把 budget 当作运维配置，world-monitor 把它上升为 schema 字段——一个新工具上线必须显式回答「最大输出多少字节？」
- **替代方案**：全局 default + per-tool override
- **权衡**：作者体验下降，但运维可预测性上升。当 `tools/call` 输出超过 budget 时返回 `_budget_exceeded` envelope 而非截断

### 5.3 `idempotentHint` 的 stricter 解读
- **决策**：`api/mcp/types.ts:88-106` — spec 定义是「environmental idempotency」，项目改用「same args → same result content over short windows」
- **为何有趣**：项目把 LLM-synthesized tools（`get_world_brief` / `analyze_situation`）和 live API reads（`get_airspace` / `search_flights`）显式标为 `idempotentHint: false`，因为它们「minute-to-minute drift」
- **替代方案**：spec 字面解读（read-only = idempotent = true）
- **权衡**：牺牲 spec 一致性，换取下游 client 的 dedup / cache / retry 决策更准确

### 5.4 把 `resources/list` 与 `resources/templates/list` 分层
- **决策**：`api/mcp/resources/index.ts:1-24` — `PUBLIC_RESOURCE_REGISTRY`（concrete URI，匿名可读）放 `resources/list`，`TEMPLATE_RESOURCE_REGISTRY`（带 `{iso2}` 占位符）放 `resources/templates/list`
- **为何有趣**：注释解释「a literal `{iso2}` URI can never resolve to data — surfacing a template in `resources/list` would break an anonymous validator's `resources/read` probe」
- **替代方案**：合并到一个 list
- **权衡**：更符合 MCP 2025-06-18 spec，且让 agent-readiness 扫描器不会因为模板 URI 失败而误判服务器不稳定

### 5.5 Iran-events domain sunset 的显式开关
- **决策**：`api/mcp/registry/cache-tools.ts:36-41` — `IRAN_EVENTS_ENABLED` 默认 `false`，注释「war ended 2026-07. Default OFF: drop the dormant conflict:iran-events:v1 key」
- **为何有趣**：项目把地缘政治事件（战争结束）作为代码注释 + env flag 留痕，而非直接删除——保留了 schema 字段以备未来恢复
- **权衡**：技术债与可追溯性的折中

---

## 6. Repository Positioning

| 维度 | 当前成熟度 | 说明 |
|------|-----------|------|
| **Planning** | Common | `PROMPT_REGISTRY` 把多工具 workflow 写成数据，但无显式 planner agent |
| **Execution** | Advanced | `dispatchToolsCall` + `_execute` + cache 路径 + per-tool budget + quota reservation 形成完整执行栈 |
| **Memory** | Emerging | Redis cache 作为事实记忆，但无显式 memory 对象（brief §5.5 未检测到 memory 类型） |
| **Evaluation** | Unique | U3 / U5 / U7 三层 parity + outputSchema 回归契约 + 118 个 eval files，是 MCP 生态罕见的评估驱动设计 |
| **Guardrails** | Advanced | `_outputBudgetBytes` + Pro daily quota + `applyAnonDiscoveryLimit` + `guardUserApiKeyValidation` + billing denial 形成多层 guard |
| **Prompt** | Advanced | 16 个 prompt 对象、3 类（prompt/template/system）、intro_substitutions 条件渲染、jmespath 预投影 |
| **Tooling** | Unique | 43 个 schema-first tools + multi-surface projection + collision guard + universal injection |
| **Observability** | Advanced | `emitTelemetry` / `emitMcpRequestEvent` / `setUsageContext` / `mcp.tools_list_emitted` / `TOOL_LIST_BYTES` precompute |

**生态定位**：world-monitor 不是「AI Agent 框架」，而是「**MCP 服务器工程化的范本**」——它把 MCP 协议的每个抽象（tools / prompts / resources / ui）都实现到 spec 上限，并用工业级 quality gate 锁定。对研究者的价值高于对最终用户的价值。

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|---------|
| **Schema-First Registry Array** | `ToolDef[]` 字面量 + discriminated union + 必填字段，无装饰器 | `api/mcp/registry/index.ts:12`、`api/mcp/types.ts:44-199` | ✅ 通用 |
| **Single Source of Truth Projection** | `buildPublicTool()` 单一函数驱动 `tools/list` + `describe_tool` | `api/mcp/registry/index.ts:56-115` | ✅ 通用 |
| **Collision Guard at Module Load** | 检测 universal injection 与手写 schema 冲突，立即抛错 | `api/mcp/registry/index.ts:27-35` | ✅ 通用 |
| **Universal Schema Injection** | `jmespath` / `summary` 在 buildPublicTool 阶段注入所有工具，避免重复声明 | `api/mcp/registry/index.ts:75-78` | ✅ 通用 |
| **Anonymous Discovery Surface** | `PUBLIC_MCP_METHODS` 集合 + 公共 resource registry，零认证枚举 | `api/mcp/handler.ts:33-73` | ✅ 通用 |
| **Three-Layer Parity Test** | U3 (Tier-4) / U5 (MCP↔API) / U7 (Tier-3) 锁定 schema-impl-data | `tests/mcp-bootstrap-parity.test.mjs:1-11`、`tests/mcp-tool-output-contracts.test.mjs:1-22` | ✅ 通用 |
| **OutputSchema as Regression Contract** | outputSchema 既是 LLM 提示，也是 CI 形状断言 | `tests/mcp-tool-output-contracts.test.mjs:1-22` | ✅ 通用 |
| **Prompt Workflow as Data** | `PROMPT_REGISTRY` 用 `McpPromptStep[]` + 字面量 jmespath 编排多工具 | `api/mcp/prompts/index.ts:42-101` | ✅ 通用 |
| **Conditional Prompt Substitution** | `intro_substitutions` 用 `when_present` / `when_absent` 切换渲染 | `api/mcp/prompts/index.ts:98-100` | ⚠ 需适配 |
| **Per-Tool Output Budget** | `_outputBudgetBytes` 必填 + `_budget_exceeded` envelope | `api/mcp/types.ts:48-52` | ⚠ 需适配 |
| **Stricter idempotentHint** | 用「content stability over short windows」替代 spec 字面解读 | `api/mcp/types.ts:88-106` | ⚠ 需适配 |
| **Resource/Data Tier Split** | `resources/list` 仅 metadata；`resources/templates/list` 走 `dispatchToolsCall` 继承 quota | `api/mcp/resources/index.ts:1-41` | ✅ 通用 |
| **structuredClone Defense** | 递归深拷贝防 schema mutate 污染 module-level const | `api/mcp/registry/index.ts:69-78` | ✅ 通用 |
| **EXCLUDED_FROM_MCP Documented Omissions** | 每个被排除的 cache key 必须带非空 reason + 分类标签 | `tests/mcp-bootstrap-parity.test.mjs:40-60` | ✅ 通用 |

---

## 8. Architecture Evolution

> 基于 Git 历史 + 代码注释中的 issue / PR 引用重建。

### 8.1 主要演进事件（从代码注释推断）
- **#3678**（`registry/index.ts:17`）— 在 cache tool schema 注入 `summary` flag，让 LLM 用 `summary: true` 控制 context budget
- **#4859**（`types.ts:18-23`）— `McpAuthContext` 引入 `user_key` 第三种 auth kind，dashboard-issued key 同时携带 raw key 和 owner userId
- **#4920**（`mcp-bootstrap-parity.test.mjs:46-50`）— 完整性测量 ops keys 进入 EXCLUDED_FROM_MCP，pipeline health 与 MCP queryable slice 分离
- **#4937**（`handler.ts:44`）— 匿名 `initialize` 必须能匿名调用所有 advertised capability，修复 Claude Desktop + mcp-remote hang
- **#5271**（`mcp-bootstrap-parity.test.mjs:49`）— China coverage verdict 进入 EXCLUDED，source content 仍通过 domain tool 暴露
- **v1.5.0**（`registry/index.ts:37`）— `buildPublicTool` 成为 single source of truth
- **v1.7.0**（`types.ts:71`）— per-tool annotations 强制要求四布尔位

### 8.2 已弃用的设计
- **`ui/resourceUri` flat alias**（`registry/index.ts:104-112`）— 同时 emit 嵌套 `ui.resourceUri` 和扁平 `ui/resourceUri`，后者标注为「deprecated legacy alias ext-apps normalizes」
- **MCP_PROTOCOL_FLOOR_2025_06_18**（`types.ts:69`）— 允许 caller pin 回 2025-03-26 legacy floor，注释指出 emit `outputSchema` 对旧 client 安全

### 8.3 历史决策痕迹
- **Codex Round 2**（`registry/index.ts:45`）— 显式记录「shallow `{ ...prop }` as insufficient」，是 AI 辅助 review 的痕迹
- **Iran war ended 2026-07**（`cache-tools.ts:36-41`）— 地缘政治事件作为代码注释留痕
- **Broad WEO retraction 2026-04**（`prompts/index.ts:71`）— IMF WEO 数据回撤作为 prompt 注释

### 8.4 架构趋势
从注释密度推断，项目经历了三个阶段：
1. **早期** — 命令式 tool 注册（推测）
2. **v1.5.0** — `buildPublicTool` 收敛为 SSOT
3. **v1.7.0+** — annotations / outputSchema / _apiPaths / _outputBudgetBytes 全部 required，进入「discipline over convenience」阶段

---

## 9. Reading Guide

> 基于改进版 brief §8 + 源码验证，按**洞察密度**（而非 PageRank 单一指标）排序。

### 30 分钟速览（5 个文件，理解核心架构）

1. **`api/mcp/types.ts`**（brief 排名 #3，in-degree 159）
   - **为何先读**：定义 ToolDef / PromptDef / ResourceDef 全部类型契约，是理解后续所有代码的钥匙
   - **重点**：`BaseToolDef` line 44-128 的注释密度极高，每个字段都说明设计理由

2. **`api/mcp/registry/index.ts`**（brief §2 高 PageRank）
   - **为何读**：120 行内展示 schema-first registry + collision guard + SSOT projection 三大模式
   - **重点**：`buildPublicTool` 函数 + `TOOL_REGISTRY` 合并 + universal injection

3. **`api/mcp/handler.ts`**（brief 未列，但洞察密度极高）
   - **为何读**：`PUBLIC_MCP_METHODS` 注释 line 33-73 揭示匿名发现表面的设计约束与 #4937 客户 bug
   - **重点**：注释比代码长，是工程决策的考古记录

4. **`api/mcp/prompts/index.ts`**（brief §3 中 prompt 16 个的源头）
   - **为何读**：理解 prompt workflow 如何用数据字面量编排多 tool
   - **重点**：`country-briefing` 3 步 workflow + `intro_substitutions` 条件渲染

5. **`tests/mcp-bootstrap-parity.test.mjs`**（brief §4 测试覆盖）
   - **为何读**：理解 U7 Tier-3 parity 如何防止 seed 与 tool 漂移
   - **重点**：`EXCLUDED_FROM_MCP` Map 的分类标签（intermediate / on-demand / cascade-mirror / deferred）

### 2 小时深入（+ 10 个文件，理解全表面与运维）

6. **`api/mcp/registry/cache-tools.ts`**（brief §3 工具样本来源）
   - 读 `get_market_data` 完整声明，理解 `cacheEnvelope()` helper 与嵌套 enum schema

7. **`api/mcp/registry/rpc-tools.ts`**（brief §3 RPC 工具来源）
   - 理解 `_execute` 签名与 `_coverageKeys` hybrid 模式

8. **`api/mcp/resources/index.ts`**（brief §2 high PageRank）
   - 理解 `PUBLIC_RESOURCE_REGISTRY` vs `TEMPLATE_RESOURCE_REGISTRY` 分层

9. **`api/mcp/utils.ts`**（brief §2 in-degree 94）
   - 理解 `compressDescription` / `utf8ByteLength` 等支持函数

10. **`server/_shared/redis.ts`**（brief 排名 #4，in-degree 212）
    - 理解 cache 层基础，所有 cache tool 的数据源

11. **`tests/mcp-tool-output-contracts.test.mjs`**（评估驱动门禁）
    - 理解 outputSchema 作为回归契约的执行机制

12. **`README.md`**（brief 排名 #2）
    - 理解多表面部署的全景与 6 site variants

13. **`AGENTS.md`**（仓库根）
    - 理解 agent-ready 设计意图与 repository map

14. **`api/mcp/ui/registry.ts`**（MCP Apps 表面）
    - 理解 `_uiResourceUri` 如何链接 tool 到 `ui://` shell

15. **`docs/mcp-overview.mdx`**（公开文档）
    - 理解对外暴露的 MCP 设计叙事，与代码注释对照

---

## 10. Open Questions

### 10.1 [high] Agent 防无限循环机制是什么？
- **问题**：22 个 agent 对象 + 33 个 planner 对象，但未发现显式 MAX_ITERATIONS 限制
- **为何重要**：MCP prompt workflow 允许 LLM 多次 `tools/call`，若无循环保护，恶意或 buggy prompt 可能递归
- **建议调查**：Grep `dispatchToolsCall` 调用链，检查是否存在 per-session call counter；运行时插桩 `McpUsage` 对象的 lifecycle

### 10.2 [high] `scripts/seed-forecasts.mjs` 16460 行单文件的内部结构？
- **问题**：brief §5.5 检测到 prompt 在 line 16460，意味着单文件超过 16000 行
- **为何重要**：可能隐藏复杂度或纯数据文件，影响可维护性判断
- **建议调查**：Read 该文件 line 1-50 + line 16400-16500，Grep `export` / `module.exports` 统计导出点

### 10.3 [medium] `consumer-prices-core` 子包的 Playwright 抓取架构？
- **问题**：brief §1 显示该子包独立，AGENTS.md 提到「per-country baskets; Railway/Docker」
- **为何重要**：理解多表面部署中「数据采集层」与「API 层」的解耦
- **建议调查**：Read `consumer-prices-core/src/api/server.ts`（brief §2 列为 server entrypoint）

### 10.4 [medium] Convex 在架构中的角色？
- **问题**：brief §2 显示 `convex/_generated/server.js` PageRank 0.0559（最高），但 Convex 通常用作后端 BaaS
- **为何重要**：理解 world-monitor 是 SPA + Edge API + Convex 三层，还是 Convex 仅承担 auth/billing
- **建议调查**：Read `convex/schema.ts` + `convex/http.ts`，Grep `convex._generated.server` 的 in-degree 来源

### 10.5 [low] `proto/` 目录的 .proto 文件数量与生成链路？
- **问题**：brief §1 显示 281 个 .proto 文件，但 SDK 是否从 proto 自动生成？
- **为何重要**：理解 4 语言 SDK 的代码生成策略
- **建议调查**：Read `proto/buf.gen.yaml`，Grep `sdk/python/` 是否含生成标记

### 10.6 [low] `_uiResourceUri` 与 MCP Apps spec 的兼容性？
- **问题**：`types.ts:120-127` 提到 `io.modelcontextprotocol/ui` extension，同时 emit 嵌套和扁平两种 `_meta` 形态
- **为何重要**：理解项目如何处理 MCP spec 演进中的 breaking change
- **建议调查**：Read `api/mcp/ui/registry.ts` + Grep `ui/resourceUri` 在 SDK 客户端中的消费点

---

## 报告元数据

- **生成时间**：2026-07-24
- **生成方式**：LLM 撰写 + 源码交叉验证
- **证据基础**：evidence-brief.md（research-repo skill 输出）+ 11 个源文件 Read + 2 次 Grep 验证
- **置信度分布**：6 个 Research Trace 中 6 个高置信度；3 个 Negative Findings 中 2 个高、1 个中；6 个 Open Questions 中 2 high / 2 medium / 2 low
- **未覆盖**：runtime 行为、性能基准、安全审计（需动态验证）
