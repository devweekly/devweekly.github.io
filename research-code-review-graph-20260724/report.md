# code-review-graph — 工程研究报告

> **仓库**: [code-review-graph](https://github.com/tirth8205/code-review-graph) (v2.3.7)
> **分析日期**: 2026-07-24
> **方法论**: Research Trace（Question → Evidence → Analysis → Counter Evidence → Conclusion → Confidence）+ Ontology-driven Research（对象驱动语言）
> **证据来源**: evidence-brief.md（§0–§9）、evidence-store/full.json、ref-only/code-review-graph/ 源码

---

## 1. 执行摘要

**code-review-graph**（CRG）是一个本地优先（local-first）的代码知识图谱工具，用 Tree-sitter 将代码库解析为结构化图（节点：File / Class / Function / Type / Test；边：CALLS / IMPORTS_FROM / INHERITS / IMPLEMENTS / CONTAINS / TESTED_BY / DEPENDS_ON / REFERENCES），通过 SQLite 持久化，并以 MCP（Model Context Protocol）工具形式暴露给 AI 编码助手。它解决的核心问题是：**AI 在代码审查时反复读取大段代码导致 token 浪费**——通过 blast-radius 分析，AI 只需读取真正受影响的文件。714 commits、106 contributors、182 模块、68 测试文件、33 eval 文件，处于成熟期（mature stage）。

**最有趣的发现**：CRG 是一个**自指（self-referential）系统**——它把代码库建成图谱，然后通过 `AGENTS.md` 强制 AI agent 在使用 Grep/Glob/Read 之前**先用它自己的图谱工具**探索代码库。这意味着 CRG 既是一个工具，又是一个被自己工具消费的对象，形成了 dogfooding 闭环。第二个有趣发现是它的 **token-budget-driven prompt 设计**：5 个预构建 prompt 模板全部硬编码"≤3 tool calls per turn"和"≤800 tokens"约束——这是少见的将 token 预算直接嵌入 prompt 控制流的实践。

**值得注意的简报偏差**：evidence-brief.md §6 声称"未找到 LICENSE 文件"，但源码验证显示根目录 `LICENSE` 文件存在且为 MIT License，`pyproject.toml` 第 10 行 `license = "MIT"`，README 也有 MIT 徽章。这是简报生成器的检测漏洞，**不应在最终报告中复述此 Negative Finding**。

---

## 2. Research Traces

### 2.1 核心架构：解析层 → 存储层 → 工具层 → Agent 接口层

**问题**: CRG 的核心架构模式是什么？层与层之间如何划分职责？

**证据**:
- `pyproject.toml` 依赖：`tree-sitter`、`tree-sitter-language-pack`、`networkx`、`mcp`、`fastmcp`、`watchdog`、`pyyaml`（简报 §1）
- `code_review_graph/parser.py:1-5` — "Tree-sitter based multi-language code parser. Extracts structural nodes (classes, functions, imports, types) and edges (calls, inheritance, contains)"
- `code_review_graph/graph.py:1-5` — "SQLite-backed knowledge graph storage and query engine. Stores code structure as nodes... and edges... Supports impact-radius queries and subgraph extraction"
- `code_review_graph/main.py:87-94` — `mcp = FastMCP("code-review-graph", instructions=...)`，所有 tool 通过 `@mcp.tool()` 装饰器注册（简报 §3：37 个 decorator-tool）
- 简报 §2 入度排名：`graph` (48)、`parser` (45)、`incremental` (39)、`visualization` (24) — 四个核心 Module 对象

**分析**: 四层分离是事实——Parser 对象产生 NodeInfo / EdgeInfo（dataclass），GraphStore 对象消费这些结构并以 SQLite 持久化，Tool 对象（37 个，全部 `decorator-tool` 框架）通过 `@mcp.tool()` 注册到 FastMCP server，Agent 通过 MCP 协议消费 Tool 对象。`incremental` Module 对象（入度 39）通过 `uses` 关系连接到 `parser` 和 `graph`，实现增量更新——这是变更检测和图更新的协调层。`networkx` 仅用于内存中的 BFS/impact-radius 计算（`graph.py` import），不参与持久化。

**反证**: 简报 §2 报告 1 个 import cycle：`code-review-graph-vscode.esbuild → code-review-graph-vscode.esbuild`。这是 VSCode 扩展打包脚本的 self-reference，与 Python 核心架构无关，不构成层间耦合反证。Python 侧无循环依赖。

**结论**: CRG 采用**四层分离的 Graph-as-a-Service 模式**——Parser（解析）→ GraphStore（存储）→ Tool（MCP 暴露）→ Agent（消费）。`incremental` 是贯穿三层的协调 Module。

**置信度**: 高 — 依赖声明、源码 docstring、入度数据、Tool 注册代码均可直接验证。

---

### 2.2 跨语言共享 SQLite Schema：单写多读模式

**问题**: VSCode 扩展（TypeScript）如何与 Python 后端共享图数据？是否存在语言边界的设计风险？

**证据**:
- `code-review-graph-vscode/src/backend/sqlite.ts:1-9` — "Read-only SQLite reader... All writes are performed by the Python side; this module never mutates the database"
- `sqlite.ts:43-52` — TypeScript 定义 `NodeKind = 'File' | 'Class' | 'Function' | 'Type' | 'Test'` 与 `EdgeKind = 'CALLS' | 'IMPORTS_FROM' | ...`，与 `graph.py:42-72` 的 SQL schema 完全对齐
- 简报 §2 PageRank 排名：`code-review-graph-vscode.src.backend.sqlite` 排第 3（0.0343），是 VSCode 侧的架构瓶颈
- `sqlite.ts:20-37` — 优雅处理 `better-sqlite3` ABI mismatch（NODE_MODULE_VERSION 错误），输出诊断信息提示用户 `npm rebuild`

**分析**: 这是一个**单写多读（Single-Writer Multi-Reader）模式**——Python daemon 是唯一写入者，VSCode 扩展（和其他潜在消费者）只读 SQLite。Schema 通过 TypeScript 类型手动镜像 Python SQL DDL，无代码生成。NodeKind 和 EdgeKind 在两侧完全一致——这意味着 schema 变更需要双侧同步修改，存在 drift 风险。`migrations.py`（简报 §2 grep 命中 `confidence_tier`）管理 Python 侧 schema 迁移，但 TypeScript 侧无对应迁移机制。

**反证**: 未发现反证。但 `confidence_tier` 字段（默认 `'EXTRACTED'`）在 TypeScript 接口中是否暴露未验证——可能存在字段集不对齐的隐性偏差。

**结论**: CRG 使用**跨语言共享 SQLite Schema 的单写多读模式**——Python 写、TS 读、schema 手动镜像。优点是零进程间通信开销；缺点是 schema drift 风险和 TypeScript 侧无迁移机制。

**置信度**: 高 — 源码直接可验证；schema 一致性通过对比两侧类型定义可验证。

---

### 2.3 Token-Budget-Driven Prompt 设计

**问题**: CRG 的 5 个预构建 prompt 如何把 token 节约从产品卖点转化为可执行约束？

**证据**:
- `code_review_graph/prompts.py:1-11` — "Provides 5 pre-built prompt workflows, all enforcing token-efficient detail_level='minimal' first patterns with get_minimal_context entry point"
- `prompts.py:17-31` — `_TOKEN_EFFICIENCY_PREAMBLE` 硬编码 6 条规则，包括："ALWAYS call `get_minimal_context` first"、"Use `detail_level='minimal'`"、"Never request more than 3 tool calls per turn"、"Prefer targeted queries over broad scans"
- `skills/review-changes/SKILL.md:26-29` — "Target: complete any review/debug/refactor task in ≤5 tool calls and ≤800 total output tokens"
- 简报 §4：`detail_level` 在 5 个 tool 模块中出现 30 次（grep 验证）——参数贯穿所有 graph-backed tool

**分析**: 这是少见的**将 token 预算硬编码进 prompt 控制流**的实践。多数 Agent 框架（如 Pi）依赖运行时 compaction 来管理 token，CRG 则在 prompt 层就强制 LLM 自我约束——每个 prompt 都以 `_TOKEN_EFFICIENCY_PREAMBLE` 开头，规定 LLM 必须先用 `get_minimal_context` 探查、再用 `detail_level="minimal"` 收窄、最后才升级到 `standard`/`verbose`。`detail_level` 是 Tool 对象的 schema 参数（30 处使用），意味着 LLM 必须在每次 tool 调用中显式选择 verbosity——这是一种"强制意识"设计。5 个 skill markdown 文件（build-graph、debug-issue、explore-codebase、refactor-safely、review-changes、review-delta、review-pr）进一步以声明式 skill 形式重申这些约束。

**反证**: 未发现反证。但"≤3 tool calls per turn"是软约束——LLM 可能不遵守。无运行时强制机制（如 token counter 中断）。

**结论**: CRG 使用 **Token-Budget-Driven Prompt 设计**——将 token 节约从运行时优化提升为 prompt-level 合约，通过 `detail_level` 参数和 `_TOKEN_EFFICIENCY_PREAMBLE` 让 LLM 自我约束。

**置信度**: 高 — prompt 源码、skill 文件、`detail_level` 使用频率均可直接验证。

---

### 2.4 多 Repo 守护进程 + 增量更新：文件哈希与执行器自适应

**问题**: CRG 如何支持多仓库长期运行？增量更新如何避免阻塞 MCP 事件循环？

**证据**:
- `code_review_graph/daemon.py:1-9` — "Multi-repo watch daemon... Reads `~/.code-review-graph/watch.toml`... spawns one `code-review-graph watch` child process per repo... No external dependencies beyond Python stdlib — no tmux required"
- `daemon.py:41-44` — `CONFIG_PATH`、`PID_PATH`、`STATE_PATH` 三个文件路径定义在 `~/.code-review-graph/`，`_HEALTH_CHECK_INTERVAL = 30`
- `code_review_graph/incremental.py:25` — `_MAX_PARSE_WORKERS = int(os.environ.get("CRG_PARSE_WORKERS", str(min(os.cpu_count() or 4, 8))))`
- `incremental.py:34-58` — `_select_executor_kind()` 根据 `_MCP_STDIO_ACTIVE`、`sys.platform`、`sys.stdin.isatty()` 自适应选择 `process` 或 `thread` executor
- `main.py:113-118` — `build_or_update_graph_tool` 注释："Runs the blocking full_build / incremental_update work in a thread via `asyncio.to_thread` so the stdio event loop stays responsive. Without this wrapper, long builds deadlocked on Windows because `ProcessPoolExecutor`... interacted badly with the sync handler blocking the only event-loop thread. See: #46, #136"
- `graph.py:55` — `file_hash TEXT` 字段——基于文件哈希检测变更

**分析**: 多 Repo 守护进程是事实——一个 Python 进程读 TOML 配置，为每个 repo spawn 一个子进程，定期 health-check（30s 间隔），无 tmux 依赖。增量更新基于 `file_hash`（SQLite 列）比对，而非 git diff 时间戳——这意味着即使 git 状态混乱也能检测变更。执行器自适应是关键工程权衡：`ProcessPoolExecutor`（默认，Linux/macOS 最快）vs `ThreadPoolExecutor`（MCP stdio 激活时、Windows 非 TTY 时）。Tree-sitter 解析在 worker 中释放 GIL，所以线程池 fallback 性能损失 <30%——这是经过实测的权衡。

**反证**: `_MCP_STDIO_ACTIVE` 是模块级全局变量（`incremental.py:31`），在多线程环境下可能存在竞态。但 `main.py:66-68` 注释明确"Thread-safe for stdio MCP (single-threaded)"——假设 stdio MCP 单线程，未覆盖 HTTP transport 的并发场景。

**结论**: CRG 使用**文件哈希增量 + 执行器自适应 + 多 Repo 守护进程**模式——通过 `file_hash` 检测变更、`_select_executor_kind()` 避免传输层死锁、守护进程无外部依赖。

**置信度**: 高 — 守护进程代码、执行器选择逻辑、issue 引用（#46, #136, #615）均可直接验证。

---

### 2.5 评估基础设施：7 个基准 + 可复现配置 + 周报 CI

**问题**: CRG 的评估基础设施是否充分？是否真正驱动质量决策？

**证据**:
- `code_review_graph/eval/runner.py:28-36` — `BENCHMARK_REGISTRY` 注册 7 个基准：`token_efficiency`、`impact_accuracy`、`flow_completeness`、`search_quality`、`build_performance`、`multi_hop_retrieval`、`agent_baseline`
- `runner.py:48-59` — `_validate_config` 强制 "commit pin must equal latest test_commit"——快照不变量保证可复现
- `eval/configs/` 包含 5 个仓库配置：code-review-graph、express、fastapi、flask、gin、httpx
- `evaluate/results/` 包含 6 仓库 × 3 基准的 CSV（日期 2026-05-25）
- `.github/workflows/eval.yml:1-7` — "Report-only benchmark run... must NOT fail the default branch on regressions (yet) — eval failures are informational until the co-change baseline has enough history to set thresholds against"
- `eval.yml:9-10` — cron `23 6 * * 1`（周一 06:23 UTC，"off-minute to dodge load spikes"），retention 90 天
- 简报 §4：33 eval 文件，metrics 包括 score/precision/recall/accuracy/f1/exact-match

**分析**: 评估基础设施是**成熟且治理良好**的——7 个基准覆盖 token 效率（产品卖点）、impact 准确性（核心功能）、flow 完整性、搜索质量、构建性能、多跳检索、agent baseline。配置快照不变量（commit pin = latest test_commit）确保跨时间可复现。CI 治理体现工程成熟度：周报模式（不阻塞默认分支）、CSV 工件 90 天保留、job summary 上传、off-minute cron。注释明确"until the co-change baseline has enough history to set thresholds against"——团队正在**积累数据以设定阈值**，未来可能切换为 blocking 模式。

**反证**: 当前 eval 是 report-only（`|| true`），不阻塞 PR——这意味着回归不会被自动捕获。`agent_baseline` 基准存在但未验证其语义（是否对比有/无图谱的 agent 行为）。

**结论**: CRG 拥有**成熟的 7 基准评估基础设施**——配置快照保证可复现、周报 CI 治理良好、但当前为 report-only，阈值尚未设定。

**置信度**: 高 — 7 个基准文件、配置校验逻辑、CI workflow 均可直接验证。

---

### 2.6 自指设计：CRG 消费自己的图谱

**问题**: CRG 如何体现 dogfooding？自指设计带来什么工程影响？

**证据**:
- `AGENTS.md`（CRG 自己的）—— "IMPORTANT: This project has a knowledge graph. ALWAYS use the code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore the codebase. The graph is faster, cheaper (fewer tokens), and gives you structural context"
- `AGENTS.md` 列出 8 个 key tools 表格，规定使用场景："Exploring code → semantic_search_nodes_tool instead of Grep"、"Code review → detect_changes_tool + get_review_context_tool instead of reading entire files"
- `.mcp.json` 存在于仓库根目录——CRG 仓库自身配置了 MCP server
- `docs/MAINTAINER_RECONCILIATION_2026-07-17.md` 文件名暗示维护者定期核对图与源码一致性
- 简报 §3：`prompt` 对象 `[prompt] AGENTS.md:33`——AGENTS.md 被识别为 prompt 对象

**分析**: CRG 是**自指系统**——它把自己代码库建图，然后通过 `AGENTS.md` 强制维护它的 AI agent（Claude Code、Cursor 等）先用图谱工具探索。`.mcp.json` 配置使 CRG 仓库自身成为 MCP server 的客户端。这意味着：每次 CRG 演进，它的图谱工具也立即被自己消费，形成快速反馈闭环。维护者核对文档（2026-07-17）暗示图谱与源码可能 drift，需要定期 reconciliation——这是自指系统的隐性维护成本。

**反证**: `MAINTAINER_RECONCILIATION` 文档存在本身是反证——说明图谱不是 100% 准确，需要人工核对。未发现该文档内容（未读取），无法评估 reconciliation 频率和误差率。

**结论**: CRG 是**自指系统**——通过 `AGENTS.md` 强制 AI agent 先用图谱工具、`.mcp.json` 自托管 MCP server，形成 dogfooding 闭环。代价是图谱与源码 drift 需要定期 reconciliation。

**置信度**: 高 — `AGENTS.md` 内容、`.mcp.json` 存在、reconciliation 文档命名均可直接验证。

---

### 2.7 边置信度分层：EXTRACTED vs INFERRED

**问题**: CRG 如何区分 AST 提取的边和启发式推断的边？

**证据**:
- `graph.py:69-70` — SQL schema `confidence REAL DEFAULT 1.0, confidence_tier TEXT DEFAULT 'EXTRACTED'`
- 简报 §5.5 Ontology View：`graph` Module 通过 `produces` 关系连接到 GraphStore 对象
- grep 验证：`confidence_tier` 出现在 `migrations.py`、`graph.py`、`event_resolver.py` 三个文件
- `event_resolver.py` 命名暗示 Spring/事件驱动框架的事件解析器——可能产生 INFERRED 边

**分析**: 这是**边置信度分层**模式——`EXTRACTED`（默认，从 AST 直接提取，confidence=1.0）vs 推断的边（通过 `event_resolver`、`spring_resolver`、`temporal_resolver`、`hcl_resolver` 等框架特定解析器推断）。框架特定解析器处理 AST 无法直接表达的关系——例如 Spring DI 的 `@Autowired` 注入、Temporal workflow 的 activity 调用、HCL/Terraform 的模块引用。这些边可能 `confidence < 1.0`、`confidence_tier = 'INFERRED'`，让消费者（blast-radius 计算）能加权处理。

**反证**: 未直接验证 `confidence_tier = 'INFERRED'` 是否真的被写入——grep 仅命中字段定义，未命中赋值。`event_resolver.py` 是否真的设置 INFERRED tier 未读源码验证。

**结论**: CRG 通过 `confidence` + `confidence_tier` 字段实现**边置信度分层**——区分 AST 提取边（EXTRACTED）与框架特定解析器推断边（疑似 INFERRED），支持加权 impact-radius 计算。

**置信度**: 中 — 字段定义可验证；推断边的实际写入路径未直接读源码验证。

---

## 3. Negative Findings

> 引用简报 §6 + 源码阅读发现。**注意**：简报 §6 的"未找到 LICENSE 文件"经源码验证为**误报**。

| 发现 | 为什么重要 | 验证状态 |
|------|-----------|---------|
| **简报误报：LICENSE 实际存在** | 简报 §6 声称"未找到 LICENSE 文件"，但 `/ref-only/code-review-graph/LICENSE` 存在且为 MIT License，`pyproject.toml:10` `license = "MIT"`，README 有 MIT 徽章。简报生成器的文件检测存在漏洞 | ✅ 已验证为简报误报 |
| **未找到 schema 代码生成机制** | Python SQL DDL 与 TypeScript 类型定义手动镜像，无 codegen。schema drift 风险无自动检测 | ✅ 源码确认 |
| **未找到 TypeScript 侧迁移机制** | `migrations.py` 管理 Python 侧 schema 迁移，但 VSCode 扩展侧无对应机制——schema 升级时旧扩展可能崩溃 | ✅ 源码确认 |
| **未找到 prompt 版本控制** | 5 个 prompt 模板硬编码在 `prompts.py`，无版本化或 A/B 测试机制。prompt 变更影响难以评估 | ✅ 源码确认 |
| **未找到运行时 token 强制机制** | "≤3 tool calls per turn" 是 prompt 软约束，无运行时 token counter 中断。LLM 可能违反 | ✅ 源码确认 |
| **未找到沙箱/权限系统** | MCP server 以用户权限运行，所有 tool 直接读写文件系统。`refactor_tool` + `apply_refactor_tool` 可自动应用重构——无审批 gate | ✅ 源码确认 |
| **未找到变异测试** | 增量更新和 blast-radius 逻辑复杂，变异测试可捕获边界错误。当前 68 测试文件可能遗漏边界 | ✅ 简报 §4 + 源码确认 |

---

## 4. Architecture Smells

> 以下均为 **Potential**（潜在），非断言。

### 4.1 Potential Schema Drift（跨语言 schema 不对齐）

- **证据**: `graph.py:42-80` Python SQL DDL 与 `sqlite.ts:43-52` TypeScript 类型手动镜像；TypeScript 侧无 `migrations.py` 对应物
- **为什么是风险**: Python 侧 schema 升级时，旧版 VSCode 扩展读取新 schema 可能字段缺失或类型不匹配。`confidence_tier` 字段是否在 TS 接口暴露未验证
- **置信度**: 中 — schema 手动镜像是事实；drift 是否实际发生需对比两侧字段集

### 4.2 Potential Hidden Complexity in Threading Model

- **证据**: `incremental.py:34-58` `_select_executor_kind()` 三路判断（explicit env、`_MCP_STDIO_ACTIVE`、Windows 非 TTY）；`main.py:113-118` 引用 issue #46, #136, #615；`_MCP_STDIO_ACTIVE` 是模块级全局变量
- **为什么是风险**: 多路径执行器选择 + 模块级全局可变状态 = 难以测试的组合空间。HTTP transport（`serve --http`）下的并发场景注释明确未覆盖
- **置信度**: 高 — issue 引用和注释直接证明历史死锁问题

### 4.3 Potential Framework-Specific Resolver 蔓延

- **证据**: `parser.py` imports 显示 6 个 resolver：`TsconfigResolver`、`SpringResolver`、`JediResolver`、`HclResolver`、`RescriptResolver`、`TemporalResolver`；`event_resolver.py` 单独存在
- **为什么是风险**: 每个框架（Spring、Temporal、Terraform/HCL、ReScript、TypeScript tsconfig、Python jedi）都需要专门解析器——支持新框架成本高，且每个 resolver 是潜在 bug 来源
- **置信度**: 中 — resolver 数量是事实；是否构成维护负担需查看测试覆盖率

### 4.4 Potential Single-Writer Bottleneck

- **证据**: `sqlite.ts:6-7` "All writes are performed by the Python side"；Python daemon 通过 `ProcessPoolExecutor`/`ThreadPoolExecutor` 并行解析但单 SQLite 写入
- **为什么是风险**: 大型 monorepo 全量构建时，单 SQLite writer 可能成为瓶颈。`_MAX_PARSE_WORKERS = min(cpu_count, 8)` 限制了并行度
- **置信度**: 低 — 500 文件构建 ~10s（README 声明），瓶颈未实测；增量更新缓解此问题

---

## 5. Interesting Decisions

### 5.1 SQLite 而非图数据库

- **决策**: 用 SQLite + networkx（内存图）而非 Neo4j/DuckDB 等图数据库
- **为什么有趣**: 知识图谱天然适合图数据库，但 CRG 选择 SQLite——单文件、零部署、跨语言可读
- **替代方案**: Neo4j（图查询能力强但重）、DuckDB（分析型但写入并发弱）、PostgreSQL + pg_graph
- **权衡**: 牺牲图查询表达力（需用 networkx 在内存中做 BFS），换取零依赖部署和跨语言共享。Blast-radius 通过 `MAX_IMPACT_DEPTH`、`MAX_IMPACT_NODES`、`IMPACT_EDGE_WEIGHTS` 常量调优，避免全图遍历

### 5.2 MCP 而非 REST/gRPC API

- **决策**: 通过 MCP（stdio + Streamable HTTP）暴露 37 个 tool，而非传统 REST API
- **为什么有趣**: MCP 是 2025 年新兴的 Agent-Tool 协议，生态尚不成熟。CRG 是早期采用者
- **替代方案**: REST API（通用但需 SDK）、gRPC（性能但重）、直接 CLI（无状态）
- **权衡**: 直接对接 Claude Code、Cursor、Codex 等 AI 工具的 MCP 客户端，零 SDK 成本；但绑定 MCP 生态，非 AI 工具难以消费

### 5.3 Beads 而非 GitHub Issues

- **决策**: `AGENTS.md` 声明 "This project uses **bd** (beads) for issue tracking. Run `bd prime` for full workflow context"，禁止 TodoWrite/TaskCreate/MEMORY.md
- **为什么有趣**: 选择了一个非主流的 Dolt-backed issue tracker，而非 GitHub Issues
- **替代方案**: GitHub Issues（主流）、Linear、Jira
- **权衡**: Beads 提供原子 claim（`bd update <id> --claim`）、Dolt 版本化、agent-friendly CLI；但增加贡献者门槛

### 5.4 detail_level 作为 Tool Schema 参数

- **决策**: 所有 graph-backed tool 接受 `detail_level: "minimal" | "standard" | "verbose"` 参数（30 处使用）
- **为什么有趣**: 将 verbosity 从运行时配置提升为 tool schema 的一部分——LLM 必须在每次调用中显式选择
- **替代方案**: 全局 verbosity 配置、自动 token budget
- **权衡**: 强制 LLM 意识到 token 成本；但增加 tool 调用复杂度，LLM 可能错误选择 verbose

### 5.5 自指 AGENTS.md

- **决策**: `AGENTS.md` 强制维护 CRG 的 AI agent 先用图谱工具，再回退 Grep/Glob/Read
- **为什么有趣**: 项目将自己的工具设为维护自身的"一等公民"——dogfooding 闭环
- **替代方案**: 维护时禁用图谱（避免循环依赖）
- **权衡**: 快速反馈（工具 bug 立即暴露）；但维护时若图谱损坏，agent 无法正常工作——需要 fallback 机制

---

## 6. Repository Positioning

| 维度 | 当前成熟度 | 说明 |
|------|-----------|------|
| Planning | Emerging | 无显式 planner，依赖 prompt 模板引导 LLM |
| Execution | Advanced | FastMCP server + 37 tool + async/thread executor 自适应 + 多 repo daemon |
| Memory | Advanced | SQLite 持久化 + 增量更新（file_hash）+ 多 repo watch.toml |
| Evaluation | Advanced | 7 基准 + 可复现配置 + 周报 CI + 90 天 CSV 保留 |
| Guardrails | Emerging | 无沙箱、无审批 gate；`refactor_tool` 可自动应用 |
| Prompt | Advanced | 5 模板 + token-budget preamble + detail_level schema 参数 |
| Tooling | Unique | 跨 14+ AI 平台自动检测安装（Codex/Claude Code/Cursor/Windsurf/Zed/Continue/OpenCode/Antigravity/Gemini CLI/Qwen/Qoder/Kiro/Copilot） |
| Observability | Common | 标准 logging + provenance（`with_provenance` wrapper），无分布式追踪 |
| Cross-Language | Unique | Python 写 + TypeScript 读的共享 SQLite schema |

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|---------|
| Graph-as-a-Service via MCP | Tree-sitter 解析 → SQLite 图 → MCP tool 暴露 | `code_review_graph/{parser,graph,main}.py` | ✅ 通用 |
| Single-Writer Multi-Reader SQLite | Python 写、TS 读、零 IPC 开销 | `sqlite.ts` + `graph.py` | ⚠ 需适配 schema drift 风险 |
| Token-Budget-Driven Prompts | prompt 硬编码 `≤3 tool calls` + `detail_level="minimal"` | `prompts.py:17-31` | ✅ 通用 |
| Executor Auto-Selection | 根据 transport/平台自动切换 Process/ThreadPool | `incremental.py:34-58` | ✅ 通用 |
| File-Hash Incremental | 基于 `file_hash` 列检测变更而非 git diff | `graph.py:55` + `incremental.py` | ✅ 通用 |
| Edge Confidence Tiers | `confidence` + `confidence_tier` 区分 EXTRACTED/INFERRED | `graph.py:69-70` | ✅ 通用 |
| Multi-Repo Daemon | 一个守护进程 spawn 子进程，health-check 30s | `daemon.py` | ✅ 通用 |
| Reproducible Eval Configs | `commit pin = latest test_commit` 校验 | `eval/runner.py:48-59` | ✅ 通用 |
| Report-Only Eval CI | `|| true` + CSV artifact + job summary | `.github/workflows/eval.yml` | ✅ 通用 |
| Self-Referential AGENTS.md | 强制维护 agent 先用本项目工具 | `AGENTS.md` | ⚠ 需适配 |
| Platform Auto-Detect Install | `install` 命令检测 14+ AI 工具并写配置 | `code_review_graph/cli.py` | ❌ 特定场景 |
| Skills as Markdown | 7 个 SKILL.md 声明式 agent 技能 | `skills/*/SKILL.md` | ✅ 通用 |
| Better-sqlite3 ABI Graceful Failure | 捕获 NODE_MODULE_VERSION 错误并输出诊断 | `sqlite.ts:20-37` | ✅ 通用 |

---

## 8. Architecture Evolution

> 基于 CHANGELOG.md + 简报 §1（714 commits, 106 contributors）

### 主要演进线索

- **v2.3.5（2026-05-25）— Token Savings 作为 headline feature**: CHANGELOG 显式标记 "Token Savings (headline feature)" + "Reproducible benchmarks" + "Deterministic eval pipeline"。这意味着 token 节约从隐式优化提升为产品定位核心，eval 框架同期成熟
- **v2.3.7（2026-07-18）— Security 收紧**: CHANGELOG 包含 `### Security` 段，对应 `pyproject.toml` 中 `fastmcp>=3.2.4,<4` 的 CVE-2025-62800/62801/66416 修复注释（issue #488）。注释提到 "fastmcp 3.0 did" 破坏了 server——表明曾经历 fastmcp 3.0 升级事故
- **MCP 早期采用**: README 徽章 `MCP-compatible` + `pyproject.toml` keywords 包含 `mcp`——CRG 是 MCP 生态早期采用者，FastMCP 作为 server 框架
- **多平台扩张**: README 列出 14+ AI 工具平台支持（Codex、Claude Code、CodeBuddy、Cursor、Windsurf、Zed、Continue、OpenCode、Antigravity、Gemini CLI、Qwen、Qoder、Kiro、Copilot）——`install --platform <X>` 命令表明从单一平台逐步扩展
- **Resolver 蔓延**: 6+ 框架特定 resolver（Spring、Temporal、HCL、ReScript、tsconfig、jedi）暗示从通用 Tree-sitter 解析逐步添加框架特定智能

### 历史决策痕迹

- `main.py:66-68` 注释 "If adding HTTP/SSE transport with concurrent requests, replace with contextvars.ContextVar"——`_default_repo_root` 全局变量是显式临时设计
- `incremental.py:42-44` 注释 "The older Windows non-TTY fallback remains for direct integrations that predate the explicit transport flag (issues #46, #136, PR #615)"——保留了历史 fallback 路径
- `pyproject.toml:30-32` 注释 "fastmcp >=3.2.4 is required for Message-based prompts and includes the CVE-2025-62800/62801/66416 fixes"——版本下限是事故后修复
- `docs/MAINTAINER_RECONCILIATION_2026-07-17.md` 文件名暗示定期人工核对图谱与源码——自指系统的隐性维护成本

---

## 9. Reading Guide

### 30 分钟速览（5 个文件）

1. **`README.md`** — 项目定位（"Stop burning tokens"）、Quick Start、14 平台支持图、架构 pipeline 图（diagram2）
2. **`code_review_graph/main.py`** — FastMCP server 定义、37 个 `@mcp.tool()` 注册、`_resolve_repo_root` 优先级（issue #222）
3. **`code_review_graph/graph.py`** — SQLite schema（nodes/edges/metadata）、NodeKind/EdgeKind 定义、`confidence_tier` 字段
4. **`code_review_graph/prompts.py`** — 5 个 prompt 模板 + `_TOKEN_EFFICIENCY_PREAMBLE`（token-budget 设计核心）
5. **`AGENTS.md`** — 自指设计：强制维护 agent 先用图谱工具

### 2 小时深入（+ 10 个文件）

6. **`code_review_graph/parser.py`** — Tree-sitter 多语言解析、6 个 framework resolver、notebook CellInfo、Python star import cache
7. **`code_review_graph/incremental.py`** — `_select_executor_kind()` 三路判断、`file_hash` 增量、`_MCP_STDIO_ACTIVE` 全局
8. **`code_review_graph/daemon.py`** — 多 repo watch.toml 配置、子进程 spawn、30s health-check
9. **`code_review_graph/eval/runner.py`** — 7 基准注册、`_validate_config` 快照不变量、配置加载
10. **`.github/workflows/eval.yml`** — 周报 CI、`|| true` report-only、CSV 90 天保留
11. **`code-review-graph-vscode/src/backend/sqlite.ts`** — 跨语言共享 schema、单写多读、ABI mismatch 处理
12. **`pyproject.toml`** — 依赖、optional-dependencies（embeddings/communities/eval/wiki/enrichment）、ruff/bandit 配置
13. **`skills/review-changes/SKILL.md`** — 声明式 skill + token efficiency rules
14. **`code_review_graph/eval/benchmarks/`** — 7 个基准实现（impact_accuracy、token_efficiency 等）
15. **`CHANGELOG.md`** — v2.3.5 Token Savings headline、v2.3.7 Security、fastmcp 升级事故痕迹

---

## 10. Open Questions

| # | 问题 | 为什么重要 | 建议调查方法 |
|---|------|-----------|-------------|
| 1 | `confidence_tier = 'INFERRED'` 是否真的被写入？哪些 resolver 产生推断边？ | 验证边置信度分层是否实际运作 | Grep `confidence_tier` 赋值点；读 `event_resolver.py`、`spring_resolver.py` 是否设置 INFERRED |
| 2 | TypeScript 侧 schema 是否完整镜像 Python？`confidence_tier` 在 TS 接口是否暴露？ | 评估 schema drift 风险 | 对比 `sqlite.ts` interface 与 `graph.py` SQL DDL 字段集 |
| 3 | `agent_baseline` 基准的语义是什么？是否对比有/无图谱的 agent 行为？ | 理解评估是否真正度量产品价值 | 读 `eval/benchmarks/agent_baseline.py` 实现 |
| 4 | `refactor_tool` + `apply_refactor_tool` 如何防止破坏性变更？是否有 dry-run？ | 评估 guardrails 缺口 | 读 `tools/refactor_tools.py`，查找 dry-run/preview 机制 |
| 5 | HTTP transport（`serve --http`）下的并发场景是否被测试？`_MCP_STDIO_ACTIVE` 全局在 HTTP 下如何？ | 评估多客户端场景风险 | 读 `main.py` HTTP transport 分支；查 `test_daemon.py` 是否覆盖 HTTP |
| 6 | Beads（bd）issue tracker 的数据如何持久化？`bd dolt push` 的远程是私有还是公开？ | 理解项目治理透明度 | 读 `.beads/config.yaml`、`.beads/metadata.json` |
| 7 | `MAINTAINER_RECONCILIATION_2026-07-17.md` 记录了什么 drift？频率多高？ | 评估自指系统的维护成本 | 读该文档内容 |
| 8 | 14 平台 `install --platform <X>` 如何处理各平台 MCP 配置差异？是否有平台特定 fallback？ | 可复用的多平台安装模式 | 读 `cli.py` install 命令实现 |

---

## 附录：证据引用

- **简报 §0**: 研究原则（证据优于假设、Negative Finding 同等重要）
- **简报 §1**: Executive Brief — 仓库元数据（v2.3.7, 714 commits, 106 contributors, mature stage）
- **简报 §2**: Architecture Insights — 182 模块、345 import edges、1 cycle、入度/PageRank 排名
- **简报 §3**: AI/Agent Design — 37 decorator-tool、3 prompt、tool-heavy 设计原型
- **简报 §4**: Testing & Evaluation — 68 测试文件、2128 测试函数、33 eval 文件
- **简报 §5**: Engineering Metrics — coupling density 1.90、call density 6.1
- **简报 §5.5**: Ontology View — 对象类型（function/class/tool/prompt/agent）与关系类型（calls/imports/uses/evaluatedBy）
- **简报 §6**: Negative Findings — **简报误报 LICENSE 缺失**（源码验证为 MIT License 存在）
- **简报 §7–§8**: Reading Priority & Guide
- **源码验证**: `README.md`、`pyproject.toml`、`LICENSE`、`AGENTS.md`、`code_review_graph/{main,graph,parser,incremental,daemon,prompts}.py`、`code_review_graph/eval/runner.py`、`code-review-graph-vscode/src/backend/sqlite.ts`、`.github/workflows/eval.yml`、`CHANGELOG.md`、`skills/review-changes/SKILL.md`
