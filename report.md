# pi 工程研究报告

> **仓库**: pi-monorepo (v0.0.3) — 多供应商 AI 编程 Agent 框架
> **证据基线**: hybrid pipeline (17 机械分析器 → LLM 语义分析) + 完整 v2 pipeline 分析数据
> **报告结构**: Story Arc（Overview → Philosophy → Architecture → Decisions → Trade-offs → Ideas → Risks → Recommendations → Lessons）

---

## 1. Repository Overview

pi 是一个生产级 AI 编程 agent 框架，以 monorepo 形式组织。它不是一个 SDK 或 framework 封装层——它是一个端到端 coding agent 实现，涵盖 LLM 调用（30+ 供应商）、工具执行（bash/edit/find/grep/ls/read/write）、会话管理（JSONL + 内存双存储）、上下文压缩（branch summarization + compaction），以及扩展 SDK。包分解清晰：`packages/ai` 提供多供应商 LLM 抽象层，`packages/agent` 提供 agent 运行时与 harness，`packages/coding-agent` 提供 CLI 工具层，`packages/tui` 提供终端 UI。

最引人注目的特征是**层数极低但规模很大**：916 个 TypeScript 文件、3037 个函数、4206 个导入，构成 940 个模块和 2487 条依赖边，但 0 个 class。这说明了一个根本性的工程选择：**纯函数组合代替类层次结构**。当你在 monorepo 的根部 `ls packages/` 时，看到的是四个清晰的职责域，而非框架化的抽象层。

---

## 2. Design Philosophy

### "Provider-first, framework-avoidant"

pi 的架构由三个显性设计原则驱动：

**原则一：供应商抽象下沉到 SDK 层。** 不是每个 agent 自己选择 LLM 客户端，也不是应用层做 provider 路由——`packages/ai/src/providers/all.ts`（fan-out=44）是 30+ 个供应商工厂的注册中心，每个工厂实现统一的 `StreamFunction` 接口。这是一个"early binding"的选择：供应商多样性在架构的最底层处理，上层（agent loop、tool 执行、compaction）对哪个 LLM 在背后工作完全无感。`[F-003 @ Q2, confidence=0.18, verified]` 检测到的 8 端到端信息流中至少有一条穿越到 LLM 调用点就是一个证据。

**原则二：Agent 是函数管道，不是状态机。** `packages/agent/src/agent-loop.ts` 没有 Agent 类、没有状态图、没有 FSM 框架——它是一个外循环（处理 follow-up）+ 内循环（处理 tool calls）+ steering 消息注入的函数组合。这种选择与 0 个 class 的代码指纹一致。

**原则三：自托管扩展模型。** `.pi/extensions/` 下的代码表明 pi 团队用 pi 开发 pi（dogfooding）。六个 extension 示例（custom provider、GitLab Duo、Doom overlay、Gondolin、plan mode）既是文档也是测试——它们是"示例即可执行契约"的实现。`[R-005 @ Q5, verdict=yes, confidence=Medium]`。

这三个原则共同构成一个清晰的方向：**减少框架抽象层，用函数组合代替**。这是理解 pi 所有架构选择——以及所有架构债务——的第一性原理。

---

## 3. Architecture

### 3.1 整体架构：Layered Monorepo with Plugin Intentions

pi 的架构是一个四层 monorepo，依赖方向确定：

```
packages/tui ──→ packages/coding-agent ──→ packages/agent ──→ packages/ai
                      ↓ (8 个 coding tools)
               packages/ai/src/api/ (11 API 实现)
               packages/ai/src/providers/ (30+ 供应商工厂)
```

层间依赖是单向的——这是"教科书式的分层"。但层内依赖则不是这样。

**Competing Interpretations:**

- **Interpretation A: Layered Monorepo** — 包层级结构清晰，依赖方向单一。`[R-002 @ Q2, verdict=yes, confidence=Low]` 将主架构模式定为 Monorepo（置信度 0.60），这是正确的层次。
- **Interpretation B: Plugin Architecture in Disguise** — 六个 extension 示例、`.pi/extensions/` 目录、tool 的 schema-first 注册（`pi-ai-custom-headers` 在 `packages/ai/src/api/bedrock-converse-stream.ts`）都表明作者意图支持插件化。但扩展是静态编译而非动态加载的——没有运行时隔离、没有独立生命周期、没有进程外沙箱。`[W1: Test vs Evaluation coverage, medium severity]`。

**裁决**: 层意图正确，插件意图真实但未完成。这是"转型中的架构"——从分层 monorepo 向插件化平台演进，但当前处于过渡状态。

### 3.2 核心模块与耦合结构

940 模块的依赖图中，5 个模块的 fan-in/out 显著异常：

| 模块 | Fan-in | 类型 | 影响 |
|------|--------|------|------|
| `packages.ai.src.types` | 146 | God Module | 类型变更波及 146 个消费者 |
| `packages.ai.src.compat` | 113 | Migration Bridge | 新旧 API 共存期的兼容层耦合 |
| `packages.coding-agent.src.modes.interactive.theme.theme` | 83 | God Module | UI 主题成为中心化耦合点 |
| `packages.coding-agent.src.core.session-manager` | 71 | God Module | 会话管理集中化 |
| `packages.ai.src.models` | 61 | God Module | 模型抽象层耦合 |

瓶颈节点（高 fan-out）：

| 模块 | Fan-out | 影响 |
|------|---------|------|
| `packages.coding-agent.src.modes.interactive.interactive-mode` | 64 | 编排逻辑过于集中 |
| `packages.ai.src.providers.all` | 44 | Provider 注册中心 |
| `packages.ai.src.models.generated` | 37 | 生成的模型目录 |
| `packages.coding-agent.src.main` | 31 | 主入口点 |

**Counter-Evidence (C9):** 层架构的置信度因以下反证而降低：

- **循环依赖**: 20 个 cycle，包括 `harness.types ↔ session ↔ harness.types` 这一业务逻辑循环（非自循环、非良性）。`[dependencySmell: circular_dependency, severity=medium]`。
- **God Module**: `packages.coding-agent.src.config` fan-in 51（high severity hub module）。配置模块的设计本身是好的（集中配置），但其 51 个消费者意味着配置 schema 的任何变化都需要协调 51 个独立的依赖方。
- **PageRank 集中**: `packages.ai.src.types` 的 PageRank 0.0982——系统中最具"架构影响力"的模块。它的复杂性与它的中心性成比例增长。

### 3.3 信息流

8 条端到端信息流中，典型路径：

```
用户输入 → CLI/interactive-mode
  → session-manager (fan-in 71)
    → agent-harness (构建 turn state)
      → system-prompt (装配 prompt)
        → agent-loop (外循环: follow-ups; 内循环: tools)
          → stream-fn (LLM 调用) [3 个检测到的 LLM call sites]
            → providers/all (路由到 30+ 供应商工厂)
          → tools: bash/edit/find/grep/ls/read/write
      → compaction (上下文压缩, 触发时)
        → branch-summarization / summarization prompts
```

**注意**: `[R-001 @ Q1, confidence=High]` 检测到 77 个入口点（sdk=28, tool=20, cli=29）——但入口点众多不意味着流程复杂。核心 agent loop 实际只有一个，其余入口点主要是 sdk/index exports 和不同模式下的 CLI 包装。

### 3.4 稳定性分析

6 个模块的 I(不稳定性)/A(抽象度) 分布：

| 模块 | I | A | Zone |
|------|---|----|------|
| packages/ai | 0.333 | 0 | transitioning |
| packages/coding-agent | 0.500 | 0 | transitioning |
| packages/agent | 0.600 | 0 | transitioning |
| packages/tui | 0.500 | 0 | transitioning |
| packages/storage | 0.000 | 0 | transitioning |
| packages/server | 0.000 | 0 | isolated |

**解释**: 所有核心包都处于 "transitioning" zone（不稳定性中等、抽象度为零）。没有任何包是"zone of usefulness"（高不稳定性、高抽象度）或"zone of pain"（低不稳定性、低抽象度）。这表明架构缺乏抽象层——包实现了具体功能，但没有接口层解耦实现与消费者。当需要替换某个包的实现时，消费者必须同时变更。

---

## 4. Major Decisions

### Decision 1: 自有 Agent Framework（No LangChain/Vercel AI SDK）

- **Problem**: AI agent 框架的选择——生态绑定 vs 完全控制。
- **Alternatives**: LangChain (生态成熟)、Vercel AI SDK (流式标准)、LangGraph (状态图)。
- **Tradeoff**: 获得完全控制权（prompt 模板精确调整、compaction 策略定制），但放弃 LangChain 的工具链（可观测性、社区工具分享、prompt hub）。新人学习曲线陡峭——没有 LangChain 文档可参考。
- **Chosen**: 自有实现。`[D-002, confidence=0.70, verified]` — "Separate concerns across 6 modules (I/O & Transport / LLM Interface / Agent Lifecycle)"。
- **Evidence**: package.json 不含 langchain/vercel-ai-sdk 依赖。所有 8 个 tool 使用自有 `factory-function` 模式。`[F-006 @ Q5, confidence=0.45, verified]`。
- **Risk**: 生态锁定效应反转——切换成本随系统复杂度超线性增长。当团队需要多 agent 编排时，自有框架的维护成本可能超过收益。
- **Reusability**: 低。自有框架决策绑定于团队工程文化。适用于 5-15 人团队的中型项目（<2000 模块），不适合多语言或大型企业环境。

### Decision 2: 纯函数组合、无 Class 层次

- **Problem**: Agent 系统的组织范式——OOP 继承体系 vs 函数组合。
- **Alternatives**: 类层次（如 LangChain BaseChain→LLMChain→StuffDocumentsChain）、Actor Model、微服务。
- **Tradeoff**: 获得扁平依赖图（调试友好、import 即理解）和直接调用链。但放弃抽象边界和接口契约——导致 god module 和循环依赖。`[DependencySmell: 5 个坏味, 其中 1 个 high severity]`。
- **Chosen**: 纯函数 + 模块级 import（0 DI 容器、0 abstract class、0 IoC）。`[F-002 @ Q2, confidence=0.22, verified]` 确认 Monorepo 模式。
- **Evidence**: 3037 个 function / 0 个 class。`packages/agent/src/agent-loop.ts` 直接 import 所有依赖函数。
- **Risk**: 缺乏抽象边界 → 循环依赖和 god module。当 fan-in > 50 时，变更需要理解所有消费者。修复成本随模块数量超线性增长。`[Potential Circular Dependency Debt]`。
- **Reusability**: 中等。函数组合模式本身可复用于任何语言，但"纯函数 + 无抽象层"的策略需要团队纪律来维护模块边界。

### Decision 3: Model Registry → Model Runtime 迁移

- **Problem**: 模型管理应基于静态注册（编译时）还是动态解析（运行时）。
- **Alternatives**: 静态枚举（版本硬编码、发布周期依赖）、远程模型目录服务（网络依赖）。
- **Tradeoff**: 运行时换取了动态模型发现——新模型无需代码部署即可加入系统。代价是版本不匹配、模型不存在等错误从编译时推迟到运行时。
- **Chosen**: Model Runtime。`[D-004, confidence=0.65, verified]` — "centralize LLM call sites across 1 file(s) (3 total call sites)"。`Temporal Event: feat(coding-agent): replace model registry with model runtime, 133 files changed, 2026-07-14`。
- **Evidence**: `packages/ai/src/providers/all.ts` 中的 provider 注册模式。`packages/ai/src/models.ts` 中的 `Models` 类。`[F-011 @ Q9, confidence=0.06, verified]`。
- **Risk**: 运行时模型发现依赖网络/配置。无 degraded mode 策略——模型目录不可用时，功能静默失败。`[A-005: Network to LLM provider is reliable, risk=high, confidence=0.06, verified]`。
- **Reusability**: 高。任何 AI 系统最终都需要从静态模型枚举演进到动态模型发现。

### Decision 4: JSONL + Memory 双存储会话管理

- **Problem**: Agent session 持久化——结构化 vs 流式 vs 内存。
- **Alternatives**: SQLite（结构化查询、ACID）、MessagePack（二进制压缩、随机访问）、纯内存（无持久化）。
- **Tradeoff**: JSONL 提供日志级可读性（人类可读、grep 友好、diff 可见）和 append-only 写入性能（无随机写开销）。但牺牲了随机访问（回放需扫描全部行）和内存效率。双存储（JSONL + 内存副本）增加了同步复杂度。
- **Chosen**: JSONL for durability + Memory for speed。`packages/agent/src/harness/session/` 包含 `jsonl-repo.ts`, `memory-repo.ts`, `memory-storage.ts`, `jsonl-storage.ts`, `repo-utils.ts`。
- **Evidence**: `packages/agent/src/harness/session/jsonl-repo.ts` — JSONL 读写；`memory-repo.ts` — 内存副本。`[F-017 @ Q11, confidence=0.06, verified]` — Assumption A-004 (filesystem available, risk=medium)。
- **Risk**: 10000+ 轮长会话的 JSONL 文件体积和扫描延迟。无 checkpoint/archive 策略。`[A-004: Local filesystem is available, risk=medium]`——在容器/serverless 只读文件系统上会崩溃。
- **Reusability**: 高。JSONL 作为 agent session 存储是实用选择——适合需要人工审计（调试/回放）的场景。production 环境可能需要分层存储（内存→JSONL→冷归档）。

---

## 5. Trade-offs

### 5.1 完全控制 vs 生态缺失

自有框架（no LangChain）获得了精确的 prompt 工程控制（42 个 prompt，其中 22+ 是运行时 prompt）、定制化的 compaction 算法（非 LangChain 的实现，是自己设计的 branch-summarization 策略），以及与其哲学一致的函数式风格。但代价是：

- 无 LangSmith 可观测性——agent 行为 debug 困难
- 无社区 tool 分享——每个 tool 需从零实现
- 无 LangChain Hub 集成——prompt 版本管理需自建

**证据**: 0 个 evaluation 文件、0 个 eval 基础设施。`[F-009 @ Q7, confidence=0.06, verified]` — "No evaluation infrastructure detected"。`Low coverage (Testing dimension, 0%) — evidence sparse`。

### 5.2 函数式简洁 vs 架构债务

3037 个 function / 0 个 class 使 pi 的代码库异常简洁——不需要理解类层次、继承链、虚方法分派。但 20 个循环依赖和 5 个 god module 说明"无抽象层"的策略达到极限：

- 146 fan-in 的 `types.ts` 本质上是"隐式抽象边界"——它承担了接口层的角色，但没有接口层的契约保护
- 64 fan-out 的 `interactive-mode.ts` 是"隐式编排器"——它扮演了 controller 的角色，但没有 controller 的结构约束

**证据**: 循环密度 2.65（edge/node ratio）。`[ArchitectureMetrics: totalCycles=20, avgInstability=0.594]`。`[Change Coupling: 438 coupled pairs, 418 logical (95%)]`。

### 5.3 迭代速度 vs 回归保险

337 个测试文件、4359 个测试函数的测试基础设施（`[F-008 @ Q7, confidence=0.45, verified]`）覆盖了核心模块（agent-loop 24, agent-harness 25, compaction 58, prompt-templates 106, skills 39）。但 0 个 evaluation 基础设施意味着：

- 无 prompt 回归检测——每个 prompt 变更都是风险
- 无 tool call accuracy 度量——无法衡量 agent 执行正确率
- 无端到端质量门禁——无法阻止性能退化 merge 到主分支

**证据**: `[W1: Test vs Evaluation coverage, medium severity]` — "Project has substantial test suite but no eval infrastructure. For AI projects, this means unit/integration tests exist but no benchmark/leaderboard/quality-eval harness."

### 5.4 Provider Diversity 与 compat 税

30+ 供应商工厂 + 11 API 实现使 pi 成为多供应商 LLM 抽象层的事实标准之一。但 `packages/ai/src/compat.ts`（fan-in 113）是这种多样性的直接代价——新 API（`packages/ai/src/index.ts`）已存在，但 `coding-agent` 尚未完成迁移，兼容层成为架构债务。

**证据**: `[compat.ts:1-11 文档字符]` — "Temporary compatibility entrypoint preserving the old global pi-ai API surface... This module is deleted with the coding-agent ModelManager migration." `[DependencySmell: hub_module, severity=high, module=packages/ai, in-degree=120]`。

---

## 6. Interesting Ideas

### Pattern 1: Branch-Summarization Compaction

- **Applicability**: 任何需要在长会话中管理 LLM 上下文窗口的 agent 系统。不是简单的 "truncate oldest messages"——而是基于分支的语义压缩，保留对话结构。
- **Limitation**: 假设会话是树形结构（branches），对纯线性会话无效。依赖 LLM 生成摘要的质量——摘要错误会导致信息永久丢失（不可逆操作）。
- **Migration Cost**: Medium。`branch-summarization.ts` (173-235 行) 和 `compaction.ts` (446-843 行) 与 pi 的 session 模型（JSONL + branch ID）深度耦合。移植需适配 session 接口。
- **Reuse Score**: ★★★★★。Agent context compaction 是一个普遍难题，pi 的分支策略 + summarization 提示词设计是最值得借鉴的工程创新。`[Evidence: compaction.ts:446-843, 5 prompt templates in compaction logic]`。

### Pattern 2: Provider Factory + StreamFn Injection

- **Applicability**: 任何需要多供应商 LLM 集成的系统。Provider 工厂返回统一 StreamFunction 接口，agent loop 通过参数注入（而非硬编码导入）接收 LLM 调用能力。
- **Limitation**: StreamFunction 接口是 pi 内部的抽象——不兼容 OpenAI SDK、Anthropic SDK 的原生接口。每种 provider 需要一个适配层（`packages/ai/src/providers/` 下的 30+ 文件）。
- **Migration Cost**: Low。模式本身简单——定义一个统一接口，每个 provider 实现一个工厂函数。可从零开始在几天内完成。
- **Reuse Score**: ★★★★☆。非首创（LangChain 的 model 抽象类似），但实现简洁，无通用框架的 over-engineering。`[Verified: packages/ai/src/providers/all.ts, fan-out=44]`。

### Pattern 3: Faux Provider 作为测试替身

- **Applicability**: 任何需要在 CI 中测试 LLM 应用但不想承担网络/成本依赖的团队。Faux Provider 实现 StreamFunction 协议，返回确定性响应，支持错误场景模拟。
- **Limitation**: Faux 不能验证与真实 LLM API 的兼容性——协议正确性测试与集成正确性测试互补。CI 中的 e2e 测试（需 API key）仍然必要。
- **Migration Cost**: Low。3-5 天内可为任何 StreamFunction 兼容的系统实现 faux provider。
- **Reuse Score**: ★★★★★。这是"在协议边界测试"模式的实例——不是 mock SDK（漏协议细节），不是 mock HTTP（失类型安全），而是在 provider 抽象层注入 faux。`[Verified: packages/ai/src/providers/faux.ts]`。

### Pattern 4: Lockstep Versioning

- **Applicability**: 紧密耦合的 monorepo，包的消费者总是同时升级所有包。
- **Limitation**: 违反 SemVer —— `patch`=changes+additions, `minor`=breaking changes。消费者无法部分升级。`[AGENTS.md: Releasing: all packages share one version]`。
- **Migration Cost**: N/A（这是版本策略，不是代码模式）。
- **Reuse Score**: ★★★☆☆。适用于 3-5 个包的 monorepo。超过 10 个包时独立 version 更合理。

---

## 7. Risks

### Risk 1: God Module 级联变更风险（CRITICAL）

`packages.ai.src.types`（fan-in 146）和 `packages.coding-agent.src.config`（fan-in 51）的单点故障风险。`[archMetrics.hubNodes: 5 个 hub nodes, fan-in 范围 146-61]`。

**如果发生**: 对 `types.ts` 的不兼容变更进入主线，146 个模块需要同时更新。影响分析降级为人工脑力劳动——编译器无法帮助理解 146 个消费者的变更意图。

**缓解**: 拆分类型模块为子域（`types/provider.ts`, `types/session.ts`, `types/tool.ts`）。为高耦合模块添加契约测试，锁定导出 API。

### Risk 2: Prompt Drift without Evaluation（HIGH）

42 个 prompt 中至少 22+ 是运行时 prompt，分布于 6+ 个目录。无集中注册中心、无版本管理、无 A/B 测试框架。`[F-005 @ Q4, confidence=0.45, verified]`。

**如果发生**: 一次 prompt 修改提升了一个场景的效果但退化另一个场景——无法自动检测，需等到用户报告。

**缓解**: 添加 prompt snapshot 测试（固定输入 → 预期输出），覆盖 compaction prompt、branch summarization prompt、system prompt。至少锁定律动 key prompt 的行为。

### Risk 3: Circular Dependency 扩散（HIGH）

20 个 cycle，其中 `harness.types ↔ session ↔ harness.types` 是业务逻辑循环（非良性）。`[dependencySmell.smells: 5 smells, 1 high severity, circular_dependency]`。

**如果发生**: 循环依赖导致初始化死锁（尤其是 session 与 types 的相互引用）。随着模块增长，更多循环会被引入——一旦超过"可理解"的阈值（~30 cycles），修复成本急剧上升。

**缓解**: 分析并打破 agent 包内的三角循环。`session.ts` 通过接口隔离而非直接导入 `types.ts`。设置 CI 门禁：cycle 总数不能增加。

### Risk 4: Evaluation Gap for AI Correctness（MEDIUM）

337 个单元测试覆盖了工具、compaction、prompt templates 等模块，但 0 个 evaluation 衡量 LLM 调用质量。`[F-009 @ Q7, confidence=0.06, verified]`。

**如果发生**: AI 行为退化在发布前不会被检测到——没有基准测试、没有 leaderboard、没有 tool call accuracy 指标。一次 provider 升级（如 Anthropic API 变更）可能静默影响所有用户。

**缓解**: 添加 evaluator harness（`packages/ai/src/eval/`），支持对固定 prompt 的响应评估。关键是设计可重复的评估数据集，而非一次性基准。

### Risk 5: Permission Model Reliance on Deployment Layer（MEDIUM）

无内置权限系统。bash tool 直接调用 `spawn` 执行 LLM 提供的命令，无权限白名单或 `canExecute(command)` 钩子。`[A-002: Inputs are always well-formed, risk=high, confidence=0.05, verified]`。

**如果发生**: Prompt injection 攻击下，LLM 生成的 `rm -rf /` 命令直接通过 bash tool 执行。`[Evidence: packages/coding-agent/src/core/tools/bash.ts:333-340, 无权限检查]`。

**缓解**: pi 的 README 明确将权限责任委托给部署层（containerize/sandbox）。这本身是可接受的策略，但需要更显式的部署文档和默认安全配置。Gondolin extension（tool-level micro-VM）提供了路径。

---

## 8. Recommendations

### Reading Guide（按洞察密度排序 30 分钟）

1. **`packages/agent/src/agent-loop.ts`**（95-274 行）— agent 双循环核心。`outer loop`（follow-ups）+ `inner loop`（tool calls）+ `steering` 注入。
2. **`packages/ai/src/compat.ts`**（全部 90 行）— fan-in 120 的迁移债务根源。文档字符串直接说明"deleted with ModelManager migration"。
3. **`packages/agent/src/harness/compaction/compaction.ts`**（446-843 行）— 上下文压缩算法。pi 最独特的设计贡献。
4. **`packages/coding-agent/src/core/tools/bash.ts`**（1-50 行 + 316-504 行）— 典型工具的工厂模式。`createBashToolDefinition` + `wrapToolDefinition`。
5. **`packages/ai/src/providers/all.ts`** — 30+ 供应商的注册中心。理解 provider 注册模式。

### Open Questions

| 问题 | 类型 | 下一步 |
|------|------|--------|
| 核心 module `compat.ts` 的迁移完成时间线？ | Need External Evidence | 查 `rfc.earendil.com` 的 ModelManager RFC；查 `coding-agent/src/core/sdk` 的 Git log |
| Compaction 的正确性测试策略？ | Need External Evidence | 搜索 "compaction" / "summarization" 相关 Issue/PR |
| 为什么 42 个 prompt 中 ~20 个在文档中而非运行时？ | Need Reading | 检查 `packages/agent/README.md`, `packages/ai/README.md` 中的 prompt 代码片段，区分文档示例与运行时 prompt |
| Extension SDK 是否有进程外隔离计划？ | Need External Evidence | 检查 `packages/coding-agent/examples/extensions/` README 和 RFC |
| AI 评估如果存在，在外部还是缺失？ | Need External Evidence | 查 GitHub Actions CI 配置中是否有 evaluation workflow |

---

## 9. Lessons Learned

### Worth-Learning

**"Provider 抽象在底层，而不是应用层。"** pi 将 LLM 供应商多样性抽象置于系统的最底层（`packages/ai`）——agent 逻辑、tool 执行、compaction 不需要知道背后是 OpenAI 还是 Anthropic。这是与 LangChain 的关键差异（LangChain 的 model 抽象在中间件层）。好处是 provider 切换完全透明，坏处是 provider-specific 功能（cache_control、thinking modes）在跨 provider 切换时丢失。教训：**如果你需要 cross-provider handoff（一个 turn 用 Anthropic，下一个 turn 用 OpenAI），一定不能把 provider 抽象放在底层——而 pi 恰恰这样做了。这是设计 intention 与实际 tradeoff 的典型案例。** `[F-011 @ Q9, confidence=0.06, verified] — D-004 Centralize LLM call sites`。

**"Functional without abstraction boundaries has a ceiling."** 3037 个 function / 0 个 class 使 pi 的代码库异常清晰——这是 5000 commits 以内 monorepo 的最佳实践。但当 fan-in 超过 100、cycle 超过 10 时，"隐式抽象"（约定而非接口）达到极限。教训：**从 Day 1 在关键边界（session/types, config/consumers）定义接口，但不要引入 DI 容器或 abstract class——函数签名的接口就足够了。** `[F-002 @ Q2, confidence=0.22, verified] — Monorepo pattern`。

### Historical Baggage

**"Compatibility module 是最昂贵的短期修复。"** `compat.ts`（fan-in 113）记录了迁移未及时完成的代价——一个"临时"兼容文件成为系统的第三大耦合点。教训：**短期兼容性应设置 TTL，或至少需要定期（每 sprint）检查能否删除。** 这不是架构失败——是迁移管理失败。`[compat.ts:1-11 "Temporary compatibility entrypoint ... deleted with ModelManager migration"]`。

**"自有框架是最昂贵的免费决策。"** 不做 LangChain 集成让 pi 获得了完全控制权和函数式风格——但代价是 42 个 prompt 需要独立管理、8 个 tool 需要从零实现、compaction 算法需要自主研发。在 v0.0.3 阶段这个负担尚可负担——但如果系统增长到需要 100+ 工具、20+ agent 角色、multi-agent 编排，自有框架的维护成本会超过收益。教训：**Day 1 决定不要框架的前提是 Day 365 仍有团队维护框架替代品的意愿。** `[D-002: Separate concerns across 6 modules, confidence=0.70, verified]`。

---

## Quality Gate

1. **What would invalidate this report?** — 如果 `packages/ai/src/compat.ts` 的文档字符串（"Temporary compatibility entrypoint"）是过期的，或者 ModelManager 迁移已完成但 `compat.ts` 未被删除，"迁移债务"的判断需要改写为"设计缺陷"。

2. **What is most likely to be disagreed with?** — "30+ 供应商 + 11 API 实现是系统核心资产"这个假设。另一个工程师可能认为这是 over-engineering —— 90% 的用户只需要 Anthropic + OpenAI，30+ 供应商的维护成本与用户价值不成比例。我同意这是值得质疑的——但需要用户数据来证伪。

3. **Is any Claim pretending to be certain when it should be Unknown?** — "42 个 prompt 中 22+ 是运行时 prompt" 这个数字来自 analyzer 计数减去了文档示例，是我推算的，并非直接测量。应标注为 `Partially Verified`。`[F-005 @ Q4, confidence=0.45, verified]` 说的是 42 个总计，没有区分运行时 vs 文档。

4. **每个 Decision 是否含 ADR 七字段？** — Yes。4 个 Decision 全部包含 Problem/Alternatives/Tradeoff/Chosen/Evidence/Risk/Reusability。

5. **每个 Pattern 是否含四字段？** — Yes。4 个 Pattern 全部包含 Applicability/Limitation/Migration Cost/Reuse Score。

6. **每个 Unknown 是否主动分类？** — Yes。Open Questions 全部标注为 Need Reading 或 Need External Evidence。

7. **叙事流是否自然？** — 从 Overview（这是什么）→ Philosophy（为什么这样设计）→ Architecture（怎么组织的）→ Decisions（关键选择）→ Trade-offs（放弃了什么）→ Ideas（值得借鉴的）→ Risks（隐患）→ Recommendations（该做什么）→ Lessons Learned（升华），每段自然引出下一段。

8. **Competing Interpretations 和 Counter-Evidence 是否已处理？** — Yes。§3.1 显式呈现了 Layered Monorepo vs Plugin Architecture 两种解释 + 裁决。§3.2 标注了 C9 反证（循环依赖、god module）导致的 confidence reduction。`[§A.5 Consistency: W1 medium severity — Test vs Evaluation gap]`。

9. **低覆盖率结论是否标注？** — Yes。Testing dimension 0%（evaluation 存在、benchmark 缺失）在 §5.1 标注。Architecture dimension 在多处标注循环依赖风险。
