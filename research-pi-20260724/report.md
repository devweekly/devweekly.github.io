# Pi Agent Harness — 工程研究报告

> **仓库**: pi-monorepo (v0.0.3, 5 个 npm workspace 包)
> **分析日期**: 2026-07-24
> **方法论**: Research Trace（Question → Evidence → Analysis → Counter Evidence → Conclusion → Confidence）+ Ontology-driven Research（对象/关系图）
> **证据基础**: evidence-brief.md（确定性分析）+ ref-only/pi/ 源码交叉验证

---

## 1. 执行摘要

Pi 是一个以 MIT 许可证发布的开源 AI Agent harness monorepo（5080 commits、287 contributors、940 源文件、5 个 workspace 包）。它不是一个编码助手——而是一个**自扩展 Agent 运行时平台**：`agent` 包提供通用 tool-calling Agent 抽象，`coding-agent` 只是这一抽象的一个消费者，`server` 是最新加入的实验性 RPC 包装。

**最有趣的发现**：Pi 把"Agent 操作系统"理念推到极致——核心刻意保持 minimal（CONTRIBUTING.md 第 7 行明确写道 "pi's core is minimal"），所有能力（工具、命令、UI、provider、prompt 模板、skill）通过 Extension 在运行时注册；同时通过 `.pi/` 目录约定（prompts/skills/extensions）让仓库自身成为 Agent 可读的指令图。其上下文 compaction 系统保留文件操作语义、支持树状会话分支摘要，是开源 Agent 中最先进的实现之一。

**与旧报告的关键修正**：旧报告的 "未找到 LICENSE" 是误报——仓库根目录存在 MIT LICENSE（Copyright 2025 Mario Zechner）；旧报告称 "4 个包"，实际有 5 个（含实验性 `packages/server`）；旧报告未识别 AGENTS.md / CONTRIBUTING.md / SECURITY.md / 每包 CHANGELOG.md / `.pi/` 指令目录这些工程治理资产。

---

## 2. Research Traces

### 2.1 核心架构模式：分层 Agent Harness + 横向 Server 扩展

**问题**: Pi 的核心架构模式是什么？包之间的职责与依赖边界如何划分？

**证据**:
- `package.json` workspaces 列出 5 个包：`agent`、`ai`、`coding-agent`、`tui`、`server`（简报 §1）
- `packages/server/package.json` 第 2 行：`"@earendil-works/pi-server"`，`"description": "experimental server package for pi"`，第 43 行依赖 `"@earendil-works/pi-coding-agent": "^0.81.1"`（源码验证）
- `README.md` 第 13 行：「Pi Agent Harness … including our self extensible coding agent」（源码验证）
- 简报 §2：940 模块、2487 import 边、edge/node ratio 2.65
- 简报 §2：`packages.ai.src.types`（in-degree 147, PageRank 0.0982）、`packages.ai.src.compat`（in-degree 120）、`packages.coding-agent.src.config`（in-degree 51）为核心节点

**分析**: 架构是事实上的**三层纵向分离 + 一层横向包装**——`ai`（LLM 抽象层）← `agent`（Agent 运行时层）← `coding-agent`（应用层）← `server`（RPC 包装层）。`tui` 是被 `coding-agent` 复用的终端 UI 库。`server` 通过依赖 `coding-agent` 而非 `agent`，证明它复用整套应用而非裸 Agent。`ai` 包不向上导入，`agent` 不导入 `coding-agent`——这是事实（简报 §2 的 import edges 未列出反向依赖）。

**反证**: `compat.ts`（in-degree 120）通过 `export *` 重新导出 `types.ts`，引入 20 个 import 循环（简报 §2），其中包括 `compat → types → anthropic-messages → coding-agent.sdk → compat` 的传递循环。层间分离并非完美——`compat` 兼容层是当前迁移期的临时破例。

**结论**: Pi 采用 **5 包分层 Agent Harness 模式**：纵向 `ai → agent → coding-agent → server`，横向 `tui` 复用；`server` 是实验性新增的 RPC 入口，未在 README 主表列出。

**置信度**: 高 — workspace 列表、依赖方向、循环检测均可通过 analyzer 与 package.json 直接验证。

---

### 2.2 上下文工程：LLM 驱动的结构化 Compaction + 文件操作保留

**问题**: Pi 如何管理上下文窗口？compaction 策略保留了哪些语义？

**证据**:
- `packages/agent/src/harness/agent-harness.ts` 第 23 行导入 `compact, DEFAULT_COMPACTION_SETTINGS, prepareCompaction`（源码验证）
- `packages/agent/src/harness/compaction/compaction.ts:446` 定义 `SUMMARIZATION_SYSTEM_PROMPT`：`"You are a context summarization assistant… ONLY output the structured summary"`（源码验证）
- `compaction.ts:450` 定义 `SUMMARIZATION_PROMPT`，要求 LLM 输出 `## Goal / ## Constraints / ## Progress (Done/In Progress/Blocked)` 结构化 checkpoint（源码验证）
- 简报 §3：`branch-summarization.ts:173` 定义 `BRANCH_SUMMARY_PROMPT`，用于返回先前探索分支时恢复上下文
- 简报 §2：`packages.agent.src.harness.compaction` 被列为 architecture signal directory

**分析**: Compaction 是 LLM 驱动的事实——Pi 不是简单截断或滑动窗口，而是：(1) 序列化对话；(2) 用 LLM 生成结构化 checkpoint；(3) 在 session 树中创建 compaction entry；(4) 用 checkpoint 替换旧消息。`CompactionDetails` 接口（旧报告已识别）保留 `readFiles[]`/`modifiedFiles[]`——文件操作语义跨 compaction 边界保留，agent 不会重复读已读文件。分支摘要（`branch-summarization.ts`）允许在树状会话中跨分支恢复上下文。

**反证**: `DEFAULT_COMPACTION_SETTINGS` 的具体 token 阈值未在简报中展开；compaction 失败时的回退策略未在证据中体现。

**结论**: Pi 使用 **LLM 驱动的结构化 Compaction 模式**，保留文件操作语义与会话分支上下文——开源 Agent 中最先进的上下文工程实现之一。

**置信度**: 高 — Prompt 定义、调用链、接口定义均通过源码验证。

---

### 2.3 多 Provider 抽象：Lazy Loading + 类型代数

**问题**: Pi 如何支持 40+ provider 而不膨胀 bundle 与类型系统？

**证据**:
- 简报 §2：`packages/ai/src/api/` 下每个 API 都有 `.lazy.ts` wrapper（`anthropic-messages.lazy.ts`、`google-generative-ai.lazy.ts`、`bedrock-converse-stream.lazy.ts` 等）
- 简报 §2：`KnownApi` 联合类型涵盖 10 种 API 协议
- 简报 §2：`packages/ai/src/providers/` 下 40+ provider 文件，含中国生态（`zai-coding-cn`、`moonshotai-cn`、`qwen-token-plan-cn`、`xiaomi-token-plan-cn`）
- `.pi/skills/add-llm-provider.md` 第 10-23 行规定新增 provider 的 7 步流程：核心类型 → provider 实现 → lazy 注册 → 模型生成 → 测试矩阵 → coding-agent 接线 → 文档（源码验证）
- 简报 §2：`packages.ai.src.types`（in-degree 147, PageRank 0.0982）是全库最高中心性节点

**分析**: Lazy loading 是事实——每个 API 包装在 lazy 模块中通过 `import()` 动态加载，使用 Anthropic 的 coding agent 不会加载 Google/Bedrock 代码。Provider 添加有标准化流程（`.pi/skills/add-llm-provider.md` 是 skill 文档，可被 Agent 自身读取执行）。但 `types.ts` 的 147 入度表明类型代数高度集中——`Api` 联合类型、`ApiOptionsMap`、`KnownProvider` 都在此文件，任何 provider 增改都触发 15% 代码库的级联类型检查。

**反证**: `compat.ts` 通过 `export *` 重新导出 lazy wrapper，可能使 tree-shaking 失效。但这是迁移期临时问题，`compat.ts` 头部声明 "deleted with the coding-agent ModelManager migration"。

**结论**: Pi 使用 **Lazy API Loading + 集中类型代数** 模式：运行时按需加载保持 bundle 小，类型层集中化保持类型安全，但代价是 `types.ts` 成为 god module。

**置信度**: 高 — lazy wrapper 文件、skill 文档、入度数据均通过源码与简报验证。

---

### 2.4 自扩展 Extension 系统与 `.pi/` 指令图

**问题**: Pi 的 Extension 系统能扩展什么？仓库自身如何被 Agent 读取？

**证据**:
- 简报 §7：`packages/coding-agent/examples/extensions/` 下 8+ extension 示例（`custom-provider-anthropic`、`doom-overlay`、`plan-mode`、`subagent`、`dynamic-tools`、`gondolin`、`sandbox` 等）
- 源码验证：`ref-only/pi/.pi/` 目录包含三个子目录——`prompts/`（cl.md, is.md, pr.md, sa.md, wr.md，即 `/cl` `/is` `/pr` `/sa` `/wr` slash 命令）、`skills/`（add-llm-provider.md）、`extensions/`（import-repro.ts、prompt-url-widget.ts、redraws.ts、tps.ts）
- `ref-only/pi/AGENTS.md` 第 1 行：`# Development Rules`，详列代码质量、依赖安全、git 流程、发布流程、tmux 测试等规则（源码验证）
- `ref-only/pi/CONTRIBUTING.md` 第 7 行：`"pi's core is minimal"`，第 9 行：`"PRs that bloat the core will likely be rejected"`（源码验证）
- `ref-only/pi/SECURITY.md` 第 5-9 行：明确 Pi 在用户权限边界内运行，安全责任委托给外部容器（源码验证）

**分析**: Pi 把"自扩展"做到双重极致。第一层是 **Extension 系统**——TypeScript 模块运行时注册工具、命令、UI、provider、prompt 模板，无需重编译；`gondolin` 与 `sandbox` 两个 extension 示例专门演示如何把工具调用路由到 Linux micro-VM 或沙箱。第二层是 **仓库即指令图**——`.pi/prompts/`、`.pi/skills/`、`.pi/extensions/` 三个目录约定让仓库自带 slash 命令、可执行 skill 文档、内置 extension；`AGENTS.md` 给出 200+ 行硬性开发规则（"no inline imports"、"erasable TypeScript syntax only"、"lockstep versioning"）。Extension 对象通过 `registeredBy` 关系连接到 AgentHarness，Prompt 对象通过 `triggers` 关系连接到 slash 命令。

**反证**: 未检测到 extension 沙箱机制——extension 在进程内运行。但 SECURITY.md 显式声明这是设计选择：Pi 把自身权限等同于用户权限，沙箱责任委托给 Docker/Gondolin/OpenShell 三种外部方案（README 第 41-45 行）。

**结论**: Pi 是 **双层自扩展 Agent 平台**：(1) Extension 系统在运行时注册能力；(2) `.pi/` 目录 + AGENTS.md 让仓库自身成为 Agent 可读的指令图。这是 "Agent OS" 理念的最完整实现之一。

**置信度**: 高 — `.pi/` 子目录、AGENTS.md、CONTRIBUTING.md、SECURITY.md 均通过源码直接验证。

---

### 2.5 测试策略：Faux Provider + 多模式覆盖

**问题**: Pi 的测试策略是否充分？如何避免 LLM API 调用成本？

**证据**:
- 简报 §4：337 测试文件、4359 测试函数、test/source ratio 0.36
- 简报 §4：测试模式 e2e、replay、corpus、regression
- 简报 §4：Top 测试模块 `editor`(200)、`stream`(183)、`package-manager`(138)、`tools`(112)、`prompt-templates`(106)
- `ref-only/pi/AGENTS.md` 第 38-43 行：`"For packages/coding-agent/test/suite/, use test/suite/harness.ts + the faux provider. No real provider APIs, keys, or paid tokens."`（源码验证）
- `ref-only/pi/AGENTS.md` 第 41 行：`"Put issue-specific regressions under packages/coding-agent/test/suite/regressions/ named <issue-number>-<short-slug>.test.ts"`（源码验证）
- 简报 §4：仅 1 个 eval 文件 `scripts/profile-coding-agent-node.mjs`，metrics 包含 metric/score/f1

**分析**: 测试策略是多模式的事实——e2e 测端到端、replay 重放录制、corpus 基于语料库、regression 针对_issue。Faux provider 是核心设计：模拟 LLM 响应使测试确定性且免费，AGENTS.md 把它列为强制规则。对 `stream`(183) 和 `tools`(112) 的高覆盖是恰当的——这是网络 I/O 与副作用最高风险模块。但 `editor`(200) 超过 `tools` 令人意外，说明 TUI 文本编辑是工程化重点。

**反证**: 评估基础设施单薄——仅 1 个 eval 文件且更像性能 profile（`profile-coding-agent-node.mjs`）而非编码任务基准。对成熟编码 Agent，缺自动化任务基准是质量度量缺口。

**结论**: Pi 的测试策略**充分且多模式**——Faux provider 实现免费确定性测试，issue-driven regression 流程化；但评估基础设施是明显短板。

**置信度**: 高 — 测试数、模式、AGENTS.md 规则均通过源码验证。

---

### 2.6 God Module 反模式：types.ts 的 147 入度

**问题**: `types.ts` 的高入度是否构成架构风险？

**证据**:
- 简报 §2：`packages.ai.src.types` in-degree 147、PageRank 0.0982——均为全库最高
- 简报 §2：940 模块中 147 个（15.6%）直接依赖 `types.ts`
- 简报 §2：`packages.ai.src.compat` in-degree 120，通过 `export *` 重新导出 `types.ts`
- 简报 §2：20 个 import 循环全部流经 `compat.ts`
- `.pi/skills/add-llm-provider.md` 第 10 行：`"Add API identifier to Api type union"`、第 14 行：`"Add provider name to KnownProvider type union"`——任何 provider 增改都需修改 `types.ts`（源码验证）

**分析**: 147 入度意味着 `types.ts` 任何改动触发 15% 代码库级联类型检查。`compat.ts` 的 `export *` 模式使情况恶化，创建 `compat → types → anthropic-messages → coding-agent.sdk → compat` 的传递循环。但这是**设计张力而非纯缺陷**——Pi 选择集中类型代数（`Api` union、`ApiOptionsMap`、`KnownProvider`）换取 provider 类型安全与可发现性；分散类型会破坏 `KnownApi` 的穷举性。`.pi/skills/add-llm-provider.md` 把"修改 types.ts"列为 provider 添加第一步，说明团队接受这一耦合作为有意识的工程权衡。

**反证**: 迁移完成后 `compat.ts` 删除可消除 20 个循环，但 `types.ts` 的 147 入度不会因迁移减少。

**结论**: `types.ts` 是**有意识的 God Module**——以集中类型代数换取 provider 类型安全与添加流程标准化，代价是高耦合与编译时级联。这是 Pi 当前最大的架构债。

**置信度**: 高 — 入度、PageRank、循环数、skill 文档均通过 analyzer 与源码验证。

---

### 2.7 供应链加固：多层防御 + Lockstep 版本

**问题**: Pi 如何防御 npm 供应链攻击？发布策略是什么？

**证据**:
- `ref-only/pi/package.json` 第 49-60 行：所有 devDependencies 固定到精确版本（如 `"typescript": "5.9.3"`、`"@biomejs/biome": "2.3.5"`）（源码验证）
- `ref-only/pi/README.md` 第 79 行：`".npmrc sets save-exact=true and min-release-age=2"`（源码验证）
- `ref-only/pi/package.json` 第 20 行：`"check:pinned-deps": "node scripts/check-pinned-deps.mjs"`（源码验证）
- `ref-only/pi/AGENTS.md` 第 71-78 行：详列依赖安全规则——`npm install --ignore-scripts`、`npm ci --ignore-scripts`、`PI_ALLOW_LOCKFILE_CHANGE=1` 才能 commit lockfile（源码验证）
- `ref-only/pi/AGENTS.md` 第 99 行：`"Lockstep versioning: all packages share one version; every release updates all together. patch = fixes + additions, minor = breaking changes. No major releases."`（源码验证）
- `ref-only/pi/packages/server/package.json` 第 3 行：`"version": "0.81.1"`——与 `coding-agent` 同步（源码验证）

**分析**: 供应链加固是多层的事实——(1) 精确版本固定防止意外升级；(2) `min-release-age=2` 给 2 天审查窗口；(3) `coding-agent` 用 npm-shrinkwrap 锁定传递依赖；(4) pre-commit hook 阻止意外 lockfile 变更；(5) CI `check-pinned-deps.mjs` 自动验证。Lockstep 版本是反 npm workspace 惯例的决策——5 个包同步升级，patch 含新增、minor 含 breaking、明确禁用 major。这简化发布但牺牲了独立 bugfix 发布能力。

**反证**: `min-release-age=2` 在紧急安全补丁时会延迟 2 天——但 AGENTS.md 第 113 行规定发布时用 `npm_config_min_release_age=0` 临时绕过。

**结论**: Pi 实施 **5 层供应链加固 + Lockstep 版本**——精确版本 + min-release-age + shrinkwrap + pre-commit hook + CI 检查；Lockstep 简化发布但限制独立升级。

**置信度**: 高 — package.json、README、AGENTS.md 直接可验证。

---

## 3. Negative Findings

> 引用简报 §6 + 源码交叉验证。**修正旧报告的 LICENSE 误报**。

| 发现 | 为什么重要 | 验证方式 |
|------|-----------|---------|
| **未找到根级 CHANGELOG.md**（每包有，但仓库根无统一 CHANGELOG） | 跨包演进需对照 5 个 CHANGELOG；但每包 CHANGELOG.md 存在且 AGENTS.md 第 117-130 行规定 `[Unreleased]` 段格式——这是事实上的工程治理替代 | Glob `packages/*/CHANGELOG.md` 命中 5 个 |
| **未检测到 extension 进程内沙箱** | Extension 与核心共享权限。但 SECURITY.md 第 5-9 行显式声明这是设计选择，沙箱责任委托给 Gondolin/Docker/OpenShell | 源码 + SECURITY.md 验证 |
| **未找到自动化编码任务基准** | 仅 `scripts/profile-coding-agent-node.mjs`（性能 profile，非编码质量基准）。对成熟编码 Agent，这是质量度量缺口 | 简报 §4 |
| **未检测到变异测试** | Compaction 与 session 树状态机复杂，变异测试可捕获边界 bug。当前 4359 测试可能遗漏边界 | 简报 §4 + 工具检测 |
| **未找到 TUI 视觉回归测试** | `editor`(200 测试) 与 `tui` 模块无视觉回归——终端 UI 渲染测试的已知难题 | 简报 §4 测试模式未含 visual |
| **未检测到 prompt 版本化或 A/B 机制** | `.pi/prompts/` 与 66 个 prompt 对象存在，但无版本号或 A/B 框架。prompt 变更影响难以量化 | 源码 + 简报 §3 |
| **未找到根级 LICENSE 误报的修正** | **MIT LICENSE 存在于仓库根**（`ref-only/pi/LICENSE` 第 1 行：`"MIT License"`，Copyright 2025 Mario Zechner）——旧报告此条 Negative Finding 错误，应删除 | 源码直接验证 |

---

## 4. Architecture Smells

> 以下均为 **Potential**（潜在风险），非断言。

### 4.1 Potential Tight Coupling

- **证据**: edge/node ratio 2.65（简报 §5），20 个 import 循环（简报 §2）
- **为什么是风险**: 高耦合密度使模块变更影响范围大；循环依赖使依赖分析不可靠，IDE 跳转与重构工具失灵
- **置信度**: 中 — 循环通过 `compat.ts` 临时兼容层产生，迁移后可能消失；但 2.65 的 ratio 是结构性问题

### 4.2 Potential God Module

- **证据**: `types.ts` in-degree 147（15.6% 模块依赖它）、PageRank 0.0982（简报 §2）
- **为什么是风险**: 任何类型变更触发大面积级联编译；难以并行开发；新增 provider 必须修改此文件
- **置信度**: 高 — 入度数据直接可验证。但这是有意识权衡（见 §2.6）

### 4.3 Potential Hidden Complexity in Compaction

- **证据**: compaction 涉及 LLM 调用 + 文件操作提取 + session 树修改 + 分支摘要，4 个子系统交互（简报 §2 + 源码验证 `compaction.ts`、`branch-summarization.ts`）
- **为什么是风险**: 复杂状态转换可能产生难复现 bug；compaction 错误会丢失上下文，影响 agent 后续决策
- **置信度**: 中 — 复杂性是事实；是否产生 bug 取决于回归测试覆盖率

### 4.4 Potential Provider 维护负担

- **证据**: 40+ provider 文件（`packages/ai/src/providers/`，含 5 个中国市场 provider）、10 种 API 协议（简报 §2）
- **为什么是风险**: 每个 API 协议变更需更新所有适配器；中国 provider 的合规与可用性变化难以从外部感知
- **置信度**: 低 — 多 Provider 是产品需求；`.pi/skills/add-llm-provider.md` 显示流程已文档化

---

## 5. Interesting Decisions

### 5.1 无内置权限系统 + 显式安全委托

- **决策**: Pi 不限制文件/进程/网络访问，以用户权限运行（README 第 39 行 + SECURITY.md 第 5-9 行）
- **为什么有趣**: 大多数 Agent（Claude Code、Cursor）内置工具审批。Pi 选择完全不审批，并把决策写入 SECURITY.md 作为正式安全边界声明
- **替代方案**: 内置沙箱/权限提示
- **权衡**: 简化核心、避免"权限疲劳"；安全责任完全转嫁给用户/容器；提供 3 种容器化方案（Gondolin micro-VM / Docker / OpenShell）作为可选升级路径

### 5.2 仅可擦除 TypeScript 语法

- **决策**: AGENTS.md 第 31 行：`"Use only erasable TypeScript syntax (Node strip-only mode)… no parameter properties, enum, namespace/module, import =, export ="`
- **为什么有趣**: 放弃 TS 部分表达能力换取零编译启动（Node 22 直接 strip 类型）
- **替代方案**: 用 `tsc` 编译或 `tsx` 运行时
- **权衡**: 启动更快、工具链更简单；代码更冗长（构造函数需显式赋值）；与现代 TS 习惯（enum、parameter property）相悖

### 5.3 Session 即树 + 分支摘要

- **决策**: 会话历史是树结构而非线性列表，支持分支探索；`branch-summarization.ts` 在返回分支时生成恢复摘要
- **为什么有趣**: 大多数 Agent 会话是线性的。树结构允许"回到岔路口走另一条路"——这是探索性编码的核心需求
- **替代方案**: 线性会话 + 手动重置
- **权衡**: 灵活探索 vs. session 管理复杂度；需要 `defaultContextEntryTransform` 把树投影为线性消息列表给 LLM

### 5.4 Lockstep 版本 + 无 Major 发布

- **决策**: AGENTS.md 第 99 行：5 个包共享单一版本号；`patch` = fixes + additions，`minor` = breaking changes，**No major releases**
- **为什么有趣**: 反 npm workspace 独立版本惯例；禁用 major 释放意味着 breaking change 走 minor
- **替代方案**: 每包独立版本 + semver major
- **权衡**: 简化发布、强制跨包一致性；无法只发布单包 bugfix；consumer 升级时无法跳过 breaking

### 5.5 `.pi/` 目录作为 Agent 指令图

- **决策**: 仓库内置 `.pi/prompts/`（slash 命令）、`.pi/skills/`（Agent 可执行 skill 文档）、`.pi/extensions/`（内置 extension）三个约定目录
- **为什么有趣**: 把"Agent 操作系统"理念延伸到仓库层——仓库自身是 Agent 可读的指令图，slash 命令、skill、extension 作为一等公民
- **替代方案**: 仅靠 README 文档约定
- **权衡**: Agent 可自动发现能力；用户可项目级定制；但增加新约定层、与 AGENTS.md/Wiki 等已有约定有重叠风险

---

## 6. Repository Positioning

| 维度 | 当前成熟度 | 说明 |
|------|-----------|------|
| Planning | Emerging | 无显式 planner，agent loop 即兴执行；`plan-mode` 是 extension 而非核心 |
| Execution | Advanced | AgentHarness + tool registry + parallel execution + 树状 session |
| Memory | Advanced | 树结构 session + compaction + 文件操作保留 + 分支摘要 |
| Evaluation | Emerging | 仅 `profile-coding-agent-node.mjs` 性能 profile，无编码任务基准 |
| Guardrails | Emerging（设计性） | 无内置权限——SECURITY.md 显式声明为设计选择，委托外部容器 |
| Prompt | Advanced | 66 prompt 对象 + `.pi/prompts/` slash 命令 + 动态组装 + compaction prompt |
| Tooling | Unique | 自扩展 Extension 系统 + 11 schema-first / 3 script-tool 工具 + runtime 注册 |
| Observability | Common | 事件总线 + log（简报 §2）；无分布式追踪 |
| Governance | Advanced | AGENTS.md + CONTRIBUTING.md + SECURITY.md + 5 个 CHANGELOG + `.pi/` 指令图 + lockstep 发布 |

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|---------|
| Lazy API Loading | 每个 LLM API 包装在 `.lazy.ts` 中按需 `import()` | `packages/ai/src/api/*.lazy.ts` | ✅ 通用 |
| LLM-driven Compaction w/ File Op Preservation | compaction 时用 LLM 生成结构化 checkpoint，保留 readFiles/modifiedFiles | `packages/agent/src/harness/compaction/compaction.ts` | ✅ 通用 |
| Session as Tree + Branch Summary | 树状会话 + 分支摘要支持探索性编码 | `packages/agent/src/harness/session/session.ts`、`branch-summarization.ts` | ✅ 通用 |
| Extension Event Bus | Extension 通过类型化事件总线订阅生命周期 | `packages/coding-agent/src/core/event-bus.ts` | ✅ 通用 |
| Faux Provider Testing | 模拟 LLM 响应实现免费确定性测试 | `packages/coding-agent/test/suite/harness.ts` | ✅ 通用 |
| `.pi/` Instruction Map | 仓库内 prompts/skills/extensions 三目录约定，Agent 自动发现 | `ref-only/pi/.pi/` | ✅ 通用 |
| Skill Document Format | YAML frontmatter（name/description）+ 步骤化 Markdown，Agent 可执行 | `.pi/skills/add-llm-provider.md` | ✅ 通用 |
| Supply-Chain Hardening | 精确版本 + min-release-age + shrinkwrap + pre-commit + CI 检查 | `package.json` + `scripts/check-pinned-deps.mjs` + AGENTS.md | ✅ 通用 |
| Lockstep Versioning | 多包共享版本号，patch 含新增、minor 含 breaking、无 major | AGENTS.md §Releasing | ⚠ 需适配 |
| Compat Layer Migration | 临时 `export *` 兼容层支持增量 API 迁移 | `packages/ai/src/compat.ts` | ⚠ 需适配 |
| God Module (anti-pattern) | 单一类型文件承载全库类型代数 | `packages/ai/src/types.ts` | ❌ 应避免 |

---

## 8. Architecture Evolution

> 基于 Git 历史（5080 commits、287 contributors）+ 源码痕迹

### 主要演进线索

- **从静态目录到动态工厂**: `compat.ts` 头部声明 "deleted with the coding-agent ModelManager migration"——从 `getModel`/`getModels` 静态 API 迁移到 `createModels()` 工厂模式。当前最大架构迁移。
- **Extension 系统的引入与扩张**: `examples/extensions/` 下 8+ 示例（含 `gondolin`、`sandbox` 两个安全方案）表明 Extension 系统正在积极扩展能力边界，安全方案也外部化为 extension 而非内置。
- **`server` 包的加入**: `packages/server/package.json` 描述 "experimental server package for pi"——Pi 正在从 CLI/TUI 工具扩展为可远程调用的 Agent 服务。这是 v0.0.3 之后的新方向。
- **多 Provider 全球化**: 40+ provider 含 5 个中国市场（`zai-coding-cn`、`moonshotai-cn`、`qwen-token-plan-cn`、`xiaomi-token-plan-cn`、`minimax-cn`），显示 Pi 从单一 provider 逐步扩张为全球多 provider。
- **`.pi/` 指令图约定**: AGENTS.md 详尽的开发规则 + `.pi/prompts|skills|extensions/` 表明 Pi 经历了"工具 → 平台 → Agent 可读仓库"三阶段演进。

### 历史决策痕迹

- `compat.ts` 的存在本身是迁移期痕迹——旧 API 接口仍在迁移中
- `DEFAULT_COMPACTION_SETTINGS` 命名暗示 compaction 参数曾经硬编码，后提取为配置
- `legacy-api-aliases.ts`（简报 §2 architecture 目录）保留旧 API 别名
- `coding-agent/docs/` 下 22 篇文档（含 `containerization.md`、`extensions.md`、`prompt-templates.md`、`skills.md`、`session-format.md`）显示文档体系随能力扩张逐步成形

---

## 9. Reading Guide

> 基于简报 §8 + 源码验证。**优先源文件而非 README**——简报 Reading Priority Top 5 全为源码。

### 30 分钟速览（5 个高密度源文件）

按简报 §8 排序，优先读 PageRank/in-degree 双高的源文件，因为它们揭示核心抽象：

1. **`packages/ai/src/types.ts`** — 全库最高中心性（in-degree 147, PageRank 0.0982）。读懂 `Api` union、`KnownProvider`、`ApiOptionsMap`，就理解了 Pi 的类型代数骨架
2. **`packages/ai/src/models.ts`** — in-degree 61、PageRank 0.0111。模型注册与查询的入口
3. **`packages/ai/src/compat.ts`** — in-degree 120、PageRank 0.0150。临时兼容层，理解 20 个循环的来源与迁移方向
4. **`packages/coding-agent/src/config.ts`** — in-degree 51、PageRank 0.0228。应用层配置聚合点
5. **`packages/coding-agent/src/modes/interactive/theme/theme.ts`** — in-degree 83、PageRank 0.0156。意外的高中心性——TUI 主题被广泛依赖，揭示 TUI 是核心子系统

### 2 小时深入（+ 10 个文件）

6. **`packages/agent/src/harness/agent-harness.ts`** — AgentHarness 类，agent 包核心
7. **`packages/agent/src/harness/compaction/compaction.ts`** — Compaction 系统（含 `SUMMARIZATION_PROMPT`）
8. **`packages/agent/src/harness/compaction/branch-summarization.ts`** — 分支摘要生成
9. **`packages/agent/src/harness/session/session.ts`** — 树状会话管理
10. **`packages/agent/src/agent-loop.ts`** — Agent loop：prompt → LLM → tools → repeat
11. **`packages/coding-agent/src/core/extensions/types.ts`** — Extension 系统契约
12. **`packages/coding-agent/src/core/system-prompt.ts`** — 动态 system prompt 组装
13. **`packages/ai/src/api/anthropic-messages.lazy.ts`** — Lazy loading 模式示例
14. **`.pi/skills/add-llm-provider.md`** — Skill 文档格式 + provider 添加 7 步流程
15. **`AGENTS.md`** — 200+ 行开发规则，理解 Pi 的工程治理哲学

### 治理文档（按需阅读）

- **`CONTRIBUTING.md`** — 贡献门（`lgtm`/`lgtmi` 自动批准机制）
- **`SECURITY.md`** — 信任边界声明与漏洞报告流程
- **`packages/*/CHANGELOG.md`** — 5 个包的演进记录（`[Unreleased]` + 已发布版本段）
- **`.pi/prompts/{cl,is,pr,sa,wr}.md`** — 5 个 slash 命令的 prompt 模板

---

## 10. Open Questions

| # | 问题 | 为什么重要 | 建议调查方法 |
|---|------|-----------|-------------|
| 1 | Extension loader 如何在运行时发现并加载 extension？是否有依赖管理？ | 理解自扩展机制的核心，判断 extension 间冲突可能性 | 阅读 `packages/coding-agent/src/core/extensions/` loader 代码，追踪 `import()` 调用与注册顺序 |
| 2 | Compaction 的 token 阈值与失败回退策略是什么？ | 理解上下文管理触发条件与容错 | 分析 `DEFAULT_COMPACTION_SETTINGS` 常量与 compaction 错误处理路径 |
| 3 | `packages/server` 的 RPC API 设计是什么？与 coding-agent CLI 的关系？ | 理解 Pi 从 CLI 到服务的演进方向 | 阅读 `packages/server/src/cli.ts` 与 `index.ts`，对比 coding-agent 入口 |
| 4 | 从 `compat.ts` 到 `createModels()` 的迁移计划与时间表？ | 理解当前最大架构迁移的完成路径 | git log `compat.ts` 相关 commit；搜索 RFC 文档；查看 `[Unreleased]` CHANGELOG |
| 5 | Faux provider 如何模拟流式响应与 tool-call？ | 可复用于其他 Agent 测试框架 | 阅读 `packages/ai/src/providers/faux.ts` 与 `test/suite/harness.ts` |
| 6 | `.pi/prompts/` 5 个 slash 命令（cl/is/pr/sa/wr）的具体功能与触发条件？ | 理解 Pi 内置 slash 命令体系 | 阅读每个 `.md` 文件，追踪 prompt-template 调用路径 |
| 7 | `coding-agent` 的 npm-shrinkwrap 与 root `package-lock.json` 如何协同？ | 理解供应链加固的具体实现 | 对比两份 lockfile，分析 `scripts/generate-coding-agent-shrinkwrap.mjs` |
| 8 | 树状 session 持久化格式（jsonl-repo vs sqlite）的选择标准？ | 理解 session 存储的工程权衡 | 阅读 `packages/agent/src/harness/session/jsonl-repo.ts` 与 `sqlite-node.test.ts` |

---

## 附录：证据引用

- **简报 §1**: Executive Brief — 仓库元数据、5 个 workspace、项目阶段
- **简报 §2**: Architecture Insights — 模块、边、循环、中心性、entry points
- **简报 §3**: AI/Agent Design — 66 prompts、14 tools（11 schema-first + 3 script-tool）、prompt-heavy archetype
- **简报 §4**: Testing & Evaluation — 337 测试文件、4359 函数、4 种测试模式、1 eval 文件
- **简报 §5**: Engineering Metrics — coupling density 2.65、cycle count 20、call density 25.1
- **简报 §5.5**: Ontology View — 2975 function / 36 prompt / 36 agent / 14 tool / 10 workflow 对象
- **简报 §6**: Negative Findings — 旧报告误报已修正
- **简报 §7-8**: Reading Priority & Guide — 优先源文件
- **源码验证**: `LICENSE`、`README.md`、`package.json`、`AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md`、`.pi/` 子目录、`packages/server/package.json`、`packages/agent/src/harness/agent-harness.ts`、`packages/agent/src/harness/compaction/compaction.ts`、`.pi/skills/add-llm-provider.md`
