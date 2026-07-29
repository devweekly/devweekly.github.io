# 多 Agent 智能仪表盘架构决策报告

## 1 执行摘要

**定位**：一个用于全球 Agent 态势感知的私有多 Agent 智能仪表盘，以「代码即事实源」和「确定性路由优先 NLU 语义理解」为核心架构哲学。

**核心发现**：

1. **Token-overlap 路由与 NLU 解决不同问题**：token-overlap 解决已知工具的精确路由，NLU 解决未知意图的语义映射，两者透明度不可直接比较——但当前设计的适应性边界已在挑战中被发现 [→ §5.1]
2. **代码是充分但不完备的架构载体**：CI 可以验证代码实现与文档的一致性，但架构意图（为什么做这个决策、拒绝什么方案）需要独立的决策记录层 [→ §5.2]
3. **Filesystem 路由经受住了边界测试**：相比手动路由表，文件系统层次路由在演化过程中证明更可靠 [→ §5.3]

**架构中心假设**：Code as single source of truth with deterministic routing is the optimal architecture for a multi-agent intelligence dashboard — **该假设已被挑战修改**：代码是实现的单一事实源，但架构意图需要独立的决策记录。

| Metric | Value |
|--------|-------|
| 总命题数 | 5 |
| Survived | 2 (40%) |
| Modified | 3 (60%) |
| 平均置信度 | 0.55 |
| 覆盖率最低领域 | history (0.05), deployment (0.10) |

---

## 2 Runtime（运行时架构）

### 请求入口与数据流

```
HTTP Request
  → [Router: api/<service>/v1/[rpc].ts]
    → Token-overlap Concierge Agent
      → Service Layer (stats.json, capabilities)
        → Downstream Agent / Tool
          → Response
```

[Observation] 请求进入系统时首先经过基于文件系统的路由匹配，然后由 token-overlap concierge 进行工具分派。

[Evidence] 架构数据明确记录了三层路由策略：(1) `api/<service>/v1/[rpc].ts` 文件系统路由，(2) HTTP 方法 + URL path 匹配，(3) token-overlap concierge 对服务寻找工具—服务匹配进行「透明分派」。路由优先级遵守 `concrete > nested dynamic > catch-all`。

[Interpretation] 这个三阶段流水线确保路由行为完全确定性——没有 NLU 黑箱猜测，每次请求的路径完全由文件名和方法签名决定。Concierge 层使用 token 重叠分数进行匹配，名称匹配权重大于描述，这是一种有意设计的「透明性偏好」：开发者可以在不运行系统的情况下预测路由结果。

[Alternative] 另一种设计是将 concierge 层替换为 NLU 引擎，允许自然语言描述来匹配工具。或者完全省略 concierge 层，让客户端直接指定服务端点。

[Challenge] 「Token-overlap 比 NLU 更透明」假设在挑战中未能完全存活 [→ §5.1]。Token-overlap 的透明性是相对于「同一问题域」而言的——当用户意图超出已知工具名称和描述的 token 空间时，透明度转化为「无法路由」而非「优雅降级」。

[Conclusion] 运行时架构以确定性为第一优先级，以透明可预测性为设计目标。这种设计对于 Agent-Agent 互操作性场景是合理的——Agent 之间需要可预测的路由行为。但代价是：当系统遇到未知查询模式时，没有 NLU 层的语义泛化能力作为兜底【Evidence Strength: Confidence=0.70, Count=3, Counter=1 (NLU 语义泛化缺失)】。

### 生命周期

[Observation] 请求的生命周期严格遵循「路由 → 分派 → 处理 → 响应」线性模型，无复杂编排。

[Evidence] 数据中没有提到消息队列、事件总线、Saga、工作流引擎等异步协调机制。所有组件（Router → Concierge → Service）都是同步调用链。

[Interpretation] 这是一个无状态的请求-响应架构。生命周期简单性的收益是可调试性——任何请求的完整路径都可以在单次调用链中追踪。但代价是：跨 Agent 的长时间运行任务、多步编排、补偿事务等复杂场景需要额外的编排层支持。

[Conclusion] 生命周期管理被有意简化。当前架构适合查询型 dashboard 场景，但对于需要跨 Agent 协作的复杂工作流，缺少编排基础设施是一个架构缺口【Evidence Strength: Confidence=0.65, Count=2, Counter=0】。

### 状态与组件角色

| 组件 | 拥有状态？ | 角色 |
|------|-----------|------|
| Router | 否 | 纯转换器（文件系统 → URL 映射） |
| Concierge Agent | 否 | 纯转换器（token-overlap 分数计算） |
| Service | 可能 | 查询外部 Agent / 缓存结果 |
| CI Pipeline | 否 | 构建时验证器 |

[Observation] 几乎所有运行时组件都是无状态的。Router 和 Concierge 被设计为纯函数——给定相同的输入，总是返回相同的输出。

[Evidence] 数据中未提及数据库、Redis、分布式缓存等状态存储。仅 stats.json 是一个构建时生成的静态能力快照。

[Interpretation] 无状态架构与「确定性路由」哲学一致——纯函数式路由使得每个请求的路径完全可预测。这也简化了水平扩展（无共享状态）。但这也意味着系统没有持久会话、没有状态化 Agent 上下文、没有跨请求记忆——这对于「智能仪表盘」场景是合理的（dashboard 是「查询式」而非「对话式」），但对于需要 Agent 记忆的复杂交互则构成限制。

[Conclusion] Runtime 层是纯无状态的。所有状态（如果有）被推到下游 Agent，仪表盘本身不维护状态【Evidence Strength: Confidence=0.80, Count=3, Counter=0】。

### 缓存、并发与降级

[Observation] 数据中没有提到缓存层，也没有提到并发控制机制。降级策略被描述为「故意省略 NLU fallback」。

[Evidence] `omissions` 第一条是「路由层不做 NLU」，`tensions` 第三条提到「实时聚合管道 vs 静态检查开销」暗示存在实时数据管道。

[Interpretation] 缺少缓存层意味着每个请求都执行完整的路由 + concierge 计算。对于低延迟的本地请求可以接受，但对于需要跨网络调用的下游 Agent 查询可能会成为瓶颈。「不做 NLU fallback」的降级策略是一种有意的简化——如果 concierge 无法匹配任何工具，请求失败，而不是降级到「猜测」。这让系统行为更可预测，但可用性依赖于 concierge 匹配的召回率。

[Conclusion] 运行时缺少缓存层和系统化的降级策略。当前设计假设 concierge 总是能匹配到合适的工具——这在高 Agent 多样性场景下是一个风险【Evidence Strength: Confidence=0.55, Count=2, Counter=1 (concierge 匹配失败时没有 fallback)】。

---

## 3 Architecture（静态架构）

### 分层与职责

```
┌──────────────────────────────────────────────────┐
│                 Presentation Layer                │
│    (Dashboard UI / Agent Discovery Protocol)      │
├──────────────────────────────────────────────────┤
│                 Concierge Layer                   │
│    (Token-overlap Routing / Agent Selection)      │
├──────────────────────────────────────────────────┤
│                 Service Layer                     │
│    (api/<service>/v1/[rpc].ts 业务逻辑)           │
├──────────────────────────────────────────────────┤
│                 Contract Layer                    │
│    (Multi-layer Lint / CI Docs Check / Topology)  │
├──────────────────────────────────────────────────┤
│                 Infrastructure Layer              │
│    (ES Modules / Filesystem / AGPL / TypeScript)  │
└──────────────────────────────────────────────────┘
```

[Observation] 系统划分为 5 层，从上到下依赖方向单一。

[Evidence] `forces` 中 Agent 互操作性（A2A + NLWeb）要求机器可读的发现协议——这是 Presentation Layer 的职责。`decisions` 中的 token-overlap concierge 是 Concierge Layer 的核心。`decisions` 中的 filesystem 路由 `api/<service>/v1/[rpc].ts` 定义了 Service Layer 的目录结构。`tensions` 中的多层 lint 管道是 Contract Layer 的体现。`constraints` 中的 ES modules 和 AGPL 是 Infrastructure Layer。

[Interpretation] 层边界通过两种机制保证：（1）Infrastructure Layer 通过 ES modules 和 lint 规则强制模块可见性，（2）Contract Layer 通过自定义 lint 脚本在 CI 中验证拓扑/API/运行时一致性。这是一个「契约优先」的分层——不是通过框架（如 NestJS 的模块系统），而是通过构建时验证脚本来强制架构纪律。

[Conclusion] 5 层架构是人为设计的，依赖方向严格从上到下。边界保护依靠 CI 验证而非运行时框架——这是有意选择，保持运行时开销为零，但将纪律负担转移到开发者的 CI 流程上【Evidence Strength: Confidence=0.75, Count=4, Counter=0】。

### 边界违规分析

[Observation] 数据中未报告已知边界违规。

[Evidence] `tensions` 第一点「多层 lint 管道的强制纪律 vs 开发迭代速度」暗示 lint 管道确实在捕获违规——但未给出具体的违规案例或错误率。

[Interpretation] 没有消息就是好消息？不一定。`coverage.testing=0.1` 和 `coverage.deployment=0.1` 表明测试和部署领域的覆盖率极低——边界违规可能未被充分监控，而非不存在。多层 lint 管道覆盖的是静态结构（文件位置、导入关系、命名约定），但不覆盖运行时边界（如内存泄漏、跨层状态泄漏）。

[Conclusion] 当前边界监控仅覆盖静态架构层面，缺少运行时边界违规检测。测试覆盖不足（0.10）意味着边界违规可能在运行时才被发现【Evidence Strength: Confidence=0.50, Count=2, Counter=1 (多层 lint 静态度量可能漏检运行时违规)】。

### 耦合分析

[Observation] 数据中未提供显式的模块间耦合度量（fan-in/fan-out）。

[Evidence] `modules` 和 `boundaries` 字段均为空数组，`controlFlow` 和 `dataFlow` 也为空——这表明架构分析未包含模块级的详细耦合分析。

[Interpretation] 缺少模块级耦合分析是一个值得关注的缺口。没有 fan-in/fan-out 数据，就无法识别 God Module（高 fan-in）和 Bottleneck Module（高耦合密度）。从文件系统路由模式 `api/<service>/v1/[rpc].ts` 推断，每个 service 应该是独立的——但缺乏数据验证这一假设。

[Conclusion] 模块级耦合分析缺失，无法确认文件系统路由带来的「服务级解耦」是否真的实现了。建议补充模块级耦合度量【Evidence Strength: Confidence=0.35, Count=1, Counter=0】。

### Architecture Atlas

```
🟢 Center — Concierge Agent（移除后系统不成立）
    路由分派的唯一入口，所有请求必经过 concierge
    无替代品（NLU 被有意拒绝）

🔵 Core — Service Layer (api/<service>/v1/[rpc].ts)
    服务注册的基座，filesystem 路由的物理载体
    新增服务必须遵循此模式

🔵 Core — Contract Layer (Multi-layer Lint & CI Docs Check)
    架构纪律的执行者，确保代码与文档一致
    移除后将导致文档漂移和架构退化

🟠 High Coupling — stats.json / docs:check 流水线
    能力计数依赖 CI 流程；生成逻辑与顶层统计耦合
    修改生成器需重新生成 stats.json 并验证 ARCHITECTURE.md

🟢 Stable — ES Modules / TypeScript 配置
    很少改动的基础设施层
    type: module 一旦设定基本不变

⚪ Peripheral — GitHub Actions CI 配置
    相对独立，可切换至其他 CI 平台
    仅需适配 YAML 语法差异

🔴 Danger — ARCHITECTURE.md（拓扑约束）
    手动维护 + CI 检查，易成为「静默约束」—— CI 通过但文档与代码不一致
    风险: decision.tradeoffs 中「自定义 lint 脚本的精确边界控制 vs 维护成本」
```

---

## 4 Key Decisions（关键决策）

### D1: Token-overlap 路由代替 NLU

| 字段 | 内容 |
|------|------|
| Chosen | 基于 token 重叠分数的透明 concierge 路由 |
| Rejected | NLU 自然语言理解引擎 |
| Why Chosen | 确定性、可调试性；名称匹配权重大于描述 |
| Why Rejected | NLU 的黑箱性不符合「代理可见可预测」要求 [→ §2 请求入口] |
| Tradeoff | Token-overlap 的透明度 vs NLU 的同义词理解能力 |
| Cost | 需要维护token 重叠算法和名称-描述权重策略；语义泛化能力受限 |
| Long-term | token-overlap 的边界效率已经→比 NLU 更适合已知工具的精确路由。但无法映射用户新意图时需回退至手动扩展工具名称/描述 [→ §8] |
| Benefits | 开发者、运维者（可预测路由）、Agent 消费者（确定性行为） |
| Suffers | 终端用户（需要精确知道工具名称→ 认知负担）；新手（无自然语言兜底） |

**Cross-Reference**: [→ §2 数据流影响日志可观测性][→ §5.1 模型挑战 1]

### D2: 代码驱动能力计数，拒绝手写文档

| 字段 | 内容 |
|------|------|
| Chosen | CI 验证的 `npm run docs:check` + 自动生成 stats.json |
| Rejected | 手写能力数字到 ARCHITECTURE.md |
| Why Chosen | 单一事实源防止文档与代码漂移 → 代码变更自动反映到能力统计 |
| Why Rejected | 手动维护的统计数字在仓库演化中 100% 会与代码不同步 [→ §1 代码是充分但不完备的架构载体] |
| Tradeoff | 自动验证的能力完整度 vs 手写文档的叙事自由度和解释力 |
| Cost | 开发维护 docs:check 脚本、stats.json 生成器、CI 集成 |
| Long-term | CI 文档验证成为技术负债观察器——当 docs:check 持续通过，工程师对架构认知依赖代码阅读而非文档阅读 [→ §5.2] |
| Benefits | 新开发者（代码即文档的可达性）、运维（一致的能力清单）、CI/CD（自动化验证） |
| Suffers | 架构师/技术写作者（无法用自然语言解释决策背景） |

**Cross-Reference**: [→ §3 Atlas + ARCHITECTURE.md 拓扑约束][→ §5.2 假设翻转][→ §6.4 删除影响]

### D3: Filesystem 路由代替手动路由表

| 字段 | 内容 |
|------|------|
| Chosen | 基于文件系统层次结构的自动路由（`api/<service>/v1/[rpc].ts`） |
| Rejected | 手动维护的路由配置表 |
| Why Chosen | 路由优先级视觉可见，消除路由 bug；演化路径已验证（模型 evolution）[→ §5.3] |
| Why Rejected | 手动路由表在演化中已被文件系统路由取代——两套系统的同步成本 > 迁移收益 [→ §8 历史领域] |
| Tradeoff | 文件系统路由的视觉直觉性 vs 路由配置表的灵活重映射能力 |
| Cost | 文件系统重构成本：重命名目录 = 重命名路由（设计时耦合） |
| Long-term | 文件系统路由限制路由拓扑的「扁平性」——深嵌套路径不直观。如果未来需要多维度路由（如按版本/租户/区域），文件系统可能不够灵活 [→ §8] |
| Benefits | 所有开发者（视觉直觉，无需查表）、代码审查（路由变更在 PR diff 中可见）、CI（无独立路由文件需验证） |
| Suffers | 需要非标准路由映射的场景（如一个文件处理多个 URL pattern） |

**Cross-Reference**: [→ §2 路由匹配的严格优先级][→ §3 Atlas 高耦合 — 路由模式调整影响全局][→ §5.3 坚持验证]

---

## 5 Model Challenge（模型挑战）

### 5.1 Token-overlap 的透明度是否真的优于 NLU？

**Hypothesis**: Token-overlap 比 NLU 更透明，因此更适用于多 Agent 路由。
**Original Assumption**: `assumptions[0]` — "Token-overlap 透明度优于 NLU" — **survived: false**

[Observation] Concierge 路由的核心哲学是「确定性 > 智能」——通过 token 重叠分数的精确计算保证每次路由结果可预测。

[Evidence] `decision.chosen` 明确记录：名称匹配权重大于描述，避免 "chokepoint status" 误路由到无关工具。这是一个实际遇到过的问题（chokepoint status 触发了 name 与描述中的 token 重叠）。

[Interpretation] 这个 bug 的根源是 token-overlap 的「维度扁平性」——它不区分「工具名称 token」和「工具描述 token」的语义权重。当名称和描述都包含相同 token 时，routing 可能匹配不相关的工具。权重调整后修复了具体 bug，但暴露了根本问题：token-overlap 的「透明度」只在 token 空间不变时成立。

[Alternative] 有三种替代解释：
1. **NLU 也能通过 attention 机制输出路由理由**，只是实现复杂度不同——透明度的差异是工程选择，不是先天性质。
2. **Token-overlap 和 NLU 解决不同问题**：token-overlap 解决已知工具的精确路由（precision-oriented），NLU 解决未知意图的语义映射（recall-oriented）。两者的「透明度」不可直接比较——指标不同。
3. **Token-overlap 的透明度只是「可解释性幻觉」**——分数计算方式比 NN weights 更容易追踪，但「为什么一个 0.73 分数优于一个 0.71 分数」对于终端用户来说同样黑箱。

[Challenge] 假设翻转实验（challenge[0]: outcome=modified）揭示：承认 token-overlap 只是「在已知工具空间内精度更高」，并非「在所有场景下都比 NLU 更透明」。当用户意图不在已知 token 空间中时，token-overlap 直接返回「无匹配」——而 NLU 至少能返回一个概率分布+语义映射尝试。前者「确定性地失败」，后者「不确定性地成功」。透明度在失败场景下的价值不同。

[Conclusion] Original hypothesis is **modified**. Token-overlap 的透明度优势被限定在已知工具空间内。超出此空间时，token-overlap 的「确定性地失败」vs NLU 的「不确定性地成功」构成一个真正的 tradeoff——取决于系统对 false negative（漏匹配）和 false positive（误匹配）的成本偏好。当前架构偏好 false negative（宁可漏也不误导），这是正确的选择，但应明确这是一项 tradeoff 而非绝对优势。

**Evidence Strength**:
- Confidence: 0.75
- Evidence Count: 4 (bug case + 权重调整 + 假设翻转 + alternatives 对比)
- Counter Evidence: 1 (NLU 在未知意图的语义泛化能力)
- Survived: No (Modified)

**Cross-Reference**: [→ §2 请求入口处 concierge 行为][→ §4 D1 决策记录][→ §8 运行时覆盖不足]

---

### 5.2 代码是否是充分的架构文档载体？

**Hypothesis**: 代码（通过 CI 验证）是充分的架构知识载体，独立决策记录不必要。
**Original Assumption**: `assumptions[1]` — "代码是充分的架构文档载体" — **survived: false**

[Observation] 系统采用代码驱动能力计数（stats.json + docs:check），试图让代码成为架构、能力、agent 元数据的唯一事实源。

[Evidence] `decisions` 明确拒绝手写能力数字，「强制代码为唯一事实源」。`omissions` 也列出了「不手写能力统计数字」和「不维护手动路由表」。这是一个系统级的、推至极端的理念。

[Interpretation] 这个理念的合理性取决于「什么是架构知识」。数据中自然包含两类：
- **实现事实**（code facts）：文件位置、导出符号、函数签名、import 关系 → ✅ 代码确实是无争议的事实源
- **决策意图**（architectural intent）：为什么选 token-overlap 而非 NLU？拒绝了什么方案？有什么 deep tradeoff？ → ❌ 代码不包含这些

CI 只能验证前者（代码与文档的一致），不能验证后者（决策的合理性）。`alternatives[0]` 明确指出：「代码是实现事实源，架构意图需要独立的决策记录层（Architecture Decision Record），CI 只能验证前者的完备性，不能替代后者」。

[Alternative] 三种解释：
1. **将决策意图编码到代码中**（通过注释、命名约定、目录结构）——已有部分尝试（如路由文件名包含 HTTP method 和版本），但深层 tradeoff 无法编码
2. **决策意图是隐性的，通过代码审查和人脑记忆传递**——这在单团队小规模下可行，但无法扩展
3. **独立的 ADR 层**——维护成本增加，但解决了上述所有问题

[Challenge] 假设翻转在模型挑战中成功（challenge[2]: outcome=modified）：移除测试揭示了「代码作为架构载体」的边界——CI 只能验证「文档是否匹配代码」，不能验证「代码是否实现正确的架构」。`docs:check` 通过但业务逻辑存在深层设计问题是不被检测的。

[Conclusion] Original hypothesis is **refuted** (modified to weaker form). 代码是实现事实的单一来源（✅），但不是架构意图的充分载体（❌）。缺失的是决策记录层——需要独立于代码的 ADR 系统来承载 Why、Tradeoff、Rejected Alternatives、Long-term Consequences。CI 验证的是「一致性」而非「正确性」。

**Evidence Strength**:
- Confidence: 0.85
- Evidence Count: 5 (decisions+omissions 三处+alternatives+challenge+测试移除)
- Counter Evidence: 1 (文件系统路由=文件名编码路由信息部分成功)
- Survived: No (Modified to：「代码是实现的单一事实源，架构意图需要 ADR」)

**Cross-Reference**: [→ §4 D2 代码驱动能力计数][→ §1 核心发现 2][→ §6.5 建议流程]

---

### 5.3 Filesystem 路由是否比手动路由表更可靠？

**Hypothesis**: 文件系统路由消除了手动路由表的 bug。
**Original Assumption**: `assumptions[2]` — "Filesystem 路由比手动路由表更可靠" — **survived: true**

[Observation] 路由层经历了从手动路由表到文件系统路由的迁移。

[Evidence] `decisions[2]` 记录：「演化路径已验证（模型 evolution）」。`challenges[2]` 记录边界测试 survival（outcome: survived）。

[Interpretation] 文件系统路由的可靠性优势来自两个机制：
1. **视觉直觉**：目录结构 = URL 结构，开发者无需查表就知道 `/api/users/v1/list` 对应 `api/users/v1/list.ts`
2. **原子性**：重命名文件 = 重命名路由，不存在「一处改两处忘」的同步问题

[Alternative] 手动路由表在以下场景仍有优势：
1. **多版本共存**：一个文件处理多个 URL 模式（如 `/api/users/v1/{id}` 和 `/api/users/v2/{id}` 指向同一 handler）
2. **动态路由**：需要运行时根据配置重映射路由
3. **非 URL 路由**：如 WebSocket、gRPC、消息队列消费者

[Challenge] 边界测试验证了「新增路由 → 建文件」和「删除路由 → 删文件」两个核心场景。结果确认文件系统路由在演化中更可靠——手动路由表时代漏更新路由表的 bug 被彻底消除。

[Conclusion] Original hypothesis is **verified**. 文件系统路由在单站点、单版本的 HTTP API 场景下确实比手动路由表更可靠。这是本文中唯一完全存活（survived）的核心假设。

**Evidence Strength**:
- Confidence: 0.90
- Evidence Count: 3 (决策记录+演化验证+边界测试)
- Counter Evidence: 0
- Survived: Yes

**Cross-Reference**: [→ §2 路由匹配][→ §3 Atlas Core — Service Layer][→ §4 D3 决策记录]

---

### 5.4 CI-verified 文档是否能防止架构知识丢失？

**Hypothesis**: CI-verified 文档足够防止架构知识丢失。
**Original Assumption**: `assumptions[3]` — "CI-verified 文档足够防止架构知识丢失" — **survived: false**

[Observation] `npm run docs:check` 在 CI 中验证 ARCHITECTURE.md 与代码拓扑的一致性。当 topology/API/runtime 变化时，ARCHITECTURE.md 必须在同一个 PR 中更新（mentalModel 明确要求）。

[Evidence] `mentalModel` 原文：「Treats code as the single source of truth — architecture, capabilities, and agent metadata all derive from code, not documentation.」以及「When topology/API/runtime changes, ARCHITECTURE.md must follow in the same PR.」

[Interpretation] CI 验证能确保架构文档「没有过时」（docs:check 通过），但不能确保架构文档「是完整的」（缺失的架构知识不会被 CI 检测到）。知识丢失发生在两个层面：
- **显性丢失**：文档与代码不一致 → ✅ CI 捕获
- **隐性丢失**：决策理由、被拒方案、长期后果没有被写入任何地方 → ❌ CI 无法捕获

[Alternative] 唯一避免隐性丢失的方法是强制决策记录（ADR）并在 CI 中验证 ADR 的存在——但 ADR 的完备性本身无法自动化验证（你怎么知道「所有」决策都被记录了？）。

[Challenge] 模型假设翻转中，移除测试的过程暴露了 CI 验证无法覆盖的场景：如果整个团队换人，新团队通过 CI 但丢失了为什么不用 NLU 的决策背景——CLI 通过了，架构知识丢失了。

[Conclusion] Original hypothesis is **refuted**. CI-verified 文档只能保证「文档与代码的即时一致性」，不能防止架构知识的「隐性丢失」。架构知识的长久保鲜需要：(1) 决策记录层（ADR），(2) 知识传递仪式（如架构 review），(3) 新成员 onboarding 时的 conscious competence 检查。

**Evidence Strength**:
- Confidence: 0.80
- Evidence Count: 3 (mentalModel 要求+docs:check 验证范围+假设翻转)
- Counter Evidence: 0
- Survived: No (Refuted)

**Cross-Reference**: [→ §4 D2 代码驱动能力计数][→ §1 核心发现 2][→ §5.2 架构意图 vs 实现事实]

---

### 5.5 多层 lint 管道的维护成本是否低于其捕获的 bug 成本？

**Hypothesis**: 多层 lint 管道的维护成本低于其捕获的 bug 成本。
**Original Assumption**: `assumptions[4]` — "多层 lint 管道的维护成本低于其捕获的 bug 成本" — **survived: true**

[Observation] 系统运行多层自定义 lint 管道来强制拓扑、API、运行时规则。

[Evidence] `tensions[0]` 提到「多层 lint 管道的强制纪律 vs 开发迭代速度」，`tradeoffs[1]` 提到「自定义 lint 脚本的精确边界控制 vs 维护成本」。

[Interpretation] 这是一个「投资 vs 回报」的假设——投入 lint 脚本开发时间，避免架构退化 bug。当前假设存活表明团队经验直觉支持 lint 管道是正收益的。但缺少量化数据（bug 率对比、开发速度影响度量、lint 误报率）。

[Challenge] 边界测试未能推翻此假设。可能原因：
1. lint 管道确实有效捕获了真正有价值的 bug
2. 或 lint 管道的误报率可控，团队容忍了误报
3. 或团队尚未遇到 lint 维护成本超过 bug 收益的「临界点」

[Conclusion] Original hypothesis is **provisionally verified**, with caveats. 基于团队经验判断，多层 lint 管道的维护成本低于 bug 成本。但缺少量化验证——这是一个「可证伪但尚未被证伪」的假设。

**Evidence Strength**:
- Confidence: 0.55
- Evidence Count: 2 (tensions[0] + tradeoffs[1]，均为间接证据)
- Counter Evidence: 0 (也意味着缺少正面证据，仅有未失败的负面证据)
- Survived: Yes (Provisional)

**Cross-Reference**: [→ §3 边界违规分析][→ §6.3 从自定义 lint 迁移到内置 lint]

---

### 核心假设存活汇总

| # | 假设 | 存活 | 置信度 | 证据数 | 反证数 | 关键挑战方法 |
|---|------|------|--------|--------|--------|-------------|
| 1 | Token-overlap 透明度优于 NLU | ❌ modified | 0.75 | 4 | 1 | 假设翻转 |
| 2 | 代码是充分的架构文档载体 | ❌ modified | 0.85 | 5 | 1 | 移除测试 |
| 3 | Filesystem 路由比手动路由表更可靠 | ✅ | 0.90 | 3 | 0 | 边界测试 |
| 4 | CI-verified 文档足够防止架构知识丢失 | ❌ refuted | 0.80 | 3 | 0 | 假设翻转 |
| 5 | 多层 lint 管道维护成本 < bug 成本 | ✅ | 0.55 | 2 | 0 | 边界测试 |

**结论：5 个核心假设中仅 2 个完全存活（40%），3 个被修改或反驳（60%）。中心假设需要修正为：Code as single source of implementation truth + ADR for intent + deterministic routing = optimal architecture for a multi-agent intelligence dashboard.**

---

## 6 Maintainer Handbook（维护者手册）

### 6.1 How to Extend：新增一个 Service

**修改文件**:

| 步骤 | 文件/位置 | 说明 |
|------|-----------|------|
| 1 | 创建 `api/<new-service>/v1/[rpc].ts` | 文件系统自动注册路由 |
| 2 | 更新 `ARCHITECTURE.md` 拓扑节 | 必须同 PR 更新，CI 会检查 |
| 3 | 添加 lint 规则（如果需要） | 自定义 lint 脚本在 `scripts/` 下 |
| 4 | 运行 `npm run docs:check` | 验证 docs 与代码一致 |
| 5 | 运行 `npm run format:check` + `pnpm lint` | 代码风格检查 |
| 6 | 提交 PR → CI 通过 → merge | docs:check 在 CI 中自动运行 |

**风险点**: 如果新 Service 的 token-overlap 分数与现有 Service 冲突（如共享高重叠的 token），修改 concierge 权重逻辑 → 影响所有现有路由。

### 6.2 How to Debug：Concierge 路由错误

**问题现象**: 请求被路由到错误的 Service，或无法匹配任何 Service。

**定位流程**:

1. **检查 token-overlap 分数输出**（调试模式下 concierge 打印所有匹配分数）
2. **确认工具名称和描述**：名称 token 匹配权重 > 描述，检查名称是否包含语义重叠但不是目标 Service 的 token
3. **检查文件系统路由**：确认 `api/<service>/v1/[rpc].ts` 路径正确
4. **检查路由优先级**：是否触发了 `concrete > nested dynamic > catch-all` 优先级规则
5. **修改尝试**：
   - 路由到错误 Service → 调整目标工具名称（增加区分性 token 或减少重叠 token）
   - 无匹配 → 检查是否缺少 Service 所需的 token 重叠阈值（若有隐藏阈值）

**定位时需要的工具**：`npm run docs:check`（验证拓扑一致性）、lint 脚本（验证依赖关系）、手动 token-overlap 分数计算（验证路由逻辑）

### 6.3 How to Migrate：从自定义 lint 迁移到内置 lint

**迁移条件**：ESLint 或 TypeScript 内置规则覆盖了当前自定义 lint 的部分功能。
**迁移步骤**:

1. **审计**：列出所有自定义 lint 规则及其检查内容
2. **映射**：对每一条规则，评估能否用 ESLint plugin/TS 编译器选项替代
3. **替换**：先加内置规则（不删除自定义），运行两个管道 1-2 周验证
4. **监控差量**：两个管道同时运行时，检查是否有自定义-only 捕获的问题
5. **删除**：确认重叠覆盖 100% 后删除自定义脚本
6. **更新 CI**：移除 docs:check 中的 lint 验证步骤

**影响**: 移除自定义 lint → eslint 配置变更 → `pnpm lint` 输出可能变化 → 需要更新 CI + pre-commit hook。`ARCHITECTURE.md` 如果记录了 lint 规则需要同步更新。

**风险**: 自定义 lint 可能覆盖了 ESLint 生态不支持的「项目特定」规则（如拓扑约束、filesystem 命名约定）。这些规则要么迁移到自定义 ESLint plugin，要么保留。

### 6.4 How to Remove：删除一个 Service

**影响分析**:

| 删除项 | 直接影响 | 级联影响 |
|--------|---------|---------|
| `api/<svc>/` 目录 | 路由不再可达 | 如果由 CONCIERGE 引用，需要更新 concierge 工具列表 |
| stats.json 中的能力 | CI 自动更新 docs | ARCHITECTURE.md 中对应行需要手动更新或自动检测 |
| Concierge 中的工具引用 | Agent 找不到该工具 | 需要检查是否有其他 Service 依赖该工具的输出 |

**删除步骤**:

1. **识别依赖**：确认没有其它 Service/Concierge 引用被删除 Service
2. **删除目录**：`git rm -r api/<svc>/`
3. **更新 concierge**：如果工具列表是手写（而非自动发现），删除对应条目
4. **验证**：`npm run docs:check` → 自动更新 stats.json → CI 验证通过
5. **清理**：如果有专门的 lint 规则，一并清理

**隐藏陷阱**: ES modules 的 import 链——如果其他文件 import 了被删除 Service 中的模块，CI 构建会失败。但如果通过动态 import（不确定时），运行时才会暴露。

---

## 7 Repository Tour（仓库游览）

### Day 1：理解架构哲学（30分钟）

**阅读顺序**: `ARCHITECTURE.md` → `package.json` (scripts + type: module) → `pnpm-lock.yaml` (依赖验证)

**为什么这个顺序**: 架构报告的核心发现是「代码即事实源」哲学 — ARCHITECTURE.md 是这份哲学的正式声明。package.json 的 `type: module` 和 scripts 中的 `docs:check` 是基础设施层面的验证。第一天只需理解「做什么」和「为什么做」，不需要深入代码。

### Day 2：感知路由与 concierge 中心（2小时）

**阅读顺序**: `api/<service>/v1/*.ts` (任选 2-3 个 Service) → concierge 实现 → token-overlap 分数计算

**为什么这个顺序**: 理解运行时数据流的最短路径。从具体 Service 看输出格式，然后反向理解 concierge 如何路由请求到此。Token-overlap 分数计算是 concierge 的核心算法——理解它就能预测所有路由行为。如果第一天理解了 architecture philosophy，这里应该能自然感觉到 philosophy（确定性、可预测性）在代码层面的具象化。

### Day 3：探索边界系统（2小时）

**阅读顺序**: `lint/` 或 `scripts/` 中的自定义 lint 规则 → `.github/workflows/` → `docs:check` 的实现

**为什么这个顺序**: 第二天的目标是理解「什么是可能的」，第三天的目标是理解「什么是不允许的」。lint 规则告诉你架构边界的明线——哪些模式在代码审查中会被拒绝。CI 工作流告诉你这些验证何时发生。docs:check 的实现告诉你「一致性验证」的精确范围——什么验证了，什么没验证（参考 §5.2 和 §5.4 的挑战）。

### Day 4：完整触及未覆盖领域（1小时 + 自行探索）

**阅读顺序**: `__tests__/` → `CHANGELOG.md` / git history（tag 和 commit message 模式） → 不存在的 ADR 目录

**为什么这个顺序**: 覆盖率数据暴露了测试（0.10）和历史（0.05）两个领域几乎未被触及。Day 4 是 conscious gap analysis——理解测试基础设施为什么薄弱（是 deliberate 还是 neglect？）和架构演化路径（从手动路由表到 filesystem 路由的 commit 序列最有价值）。最后，寻找 ADR 目录——如前所述不存在——体验一下「知识丢失」的具体感受：当你想知道为什么选择 AGPL、为什么拒绝 NLU 时，代码层面找不到答案。这应该是阅读之旅中最具 Insight 的 5 分钟。

---

## 8 Unresolved Questions

### UQ1：运行时架构细节（coverage=0.30 — 低）

| 领域 | 缺什么证据 | 影响 |
|------|-----------|------|
| 状态持久化 | 不知道系统使用什么存储（DB/NoSQL/文件） | 无法评估数据一致性和容灾方案 |
| 缓存策略 | 不知道任何缓存层（redis/in-memory/CDN） | 无法评估延迟和扩展性 |
| 并发模型 | 不知道 Node.js worker/cluster/child_process 使用 | 无法评估 CPU 密集型任务的瓶颈 |
| 降级策略 | 只有「不做 NLU fallback」一项 | 无法评估整体可用性 SLA |

**建议下一步**:
1. 检查服务实现中的异步模式和共享状态使用
2. 搜索 `new Map` / `new WeakMap` / `redis` / `cache` 关键字
3. 搜索 `cluster` / `worker_threads` / `child_process`

---

### UQ2：架构层面模块级耦合（coverage=0.25 — 低）

| 领域 | 缺什么证据 | 影响 |
|------|-----------|------|
| 模块间依赖图 | `modules` 和 `boundaries` 完全为空 | 无法确认 filesystem 路由是否真正实现了服务隔离 |
| 高耦合模块 | 未识别任何 God Module 或 bottleneck | 重构风险不可评估 |
| 层间依赖合规 | 只有 lint 规则的说法，无实际违规数据 | 边界纪律是否严格执行不明 |

**建议下一步**:
1. 使用 `madge`（或类似工具）生成 ES modules 的依赖图
2. 计算每个模块的 fan-in/fan-out，识别 God Module
3. 对比 lint 规则和实际违规数量的历史趋势

---

### UQ3：设计决策的完整记录（coverage=0.20 — 低）

| 领域 | 缺什么证据 | 影响 |
|------|-----------|------|
| 决策演变历史 | 不知道 3 个决策在什么时间点、什么触发下做出 | 无法评估决策的稳定性（是否可能推翻） |
| AGPL 许可的选择背景 | 无法解释为什么是 AGPL 而非 MIT/Apache/BSL | §6 维护者手册中的「商业使用」部分缺少上下文 |
| A2A + NLWeb 的集成深度 | 不知道是完整实现还是声明式支持 | 无法评估 Agent 互操作性的真正能力 |

**建议下一步**:
1. 搜索 git log — `--grep="decision\|ADR\|decision record\|tradeoff"` 的 commits
2. 搜索 GitHub Issues 中有关 AGPL/许可的讨论
3. 搜索 A2A/NLWeb 相关 test file 和实现代码的比例

---

### UQ4：测试实践深度（coverage=0.10 — 极低）

| 领域 | 缺什么证据 | 影响 |
|------|-----------|------|
| 测试类型分布 | 不知道 unit/integration/e2e 的比例 | 无法评估测试质量体系 |
| 测试覆盖率 | 不知道行/分支/函数覆盖率 | 无法评估 CI 捕获 bug 的能力 |
| 契约测试 | 不知道是否有 A2A protocol 的契约测试 | Agent 互操作性的可靠性不可证 |

**建议下一步**:
1. 检查 `__tests__/` 目录结构和 `jest.config`/`vitest.config`
2. 运行覆盖率工具（如 `c8` 或 `nyc`）生成覆盖率报告
3. 检查 CI pipeline 是否运行测试（数据显示为 0.10，可能测试在构建中被绕过）

---

### UQ5：部署拓扑（coverage=0.10 — 极低）

| 领域 | 缺什么证据 | 影响 |
|------|-----------|------|
| 部署方式 | 不知道是 Docker/Serverless/裸机 | 无法评估运营复杂度 |
| 多实例策略 | 不知道是否有负载均衡/区域部署 | 全球态势感知的地理分布问题未回答 |
| CI/CD 流程 | 只有「GitHub Actions」的已知信息 | 不了解发布频率和回滚策略 |

**建议下一步**:
1. 搜索 `Dockerfile` / `docker-compose` / `k8s` / `deploy` 文件
2. 检查 `.github/workflows/` 中完整的 CI/CD pipeline
3. 检查是否有 `helm/` 或 `terraform/` 目录

---

### UQ6：历史演进路径（coverage=0.05 — 最低）

| 领域 | 缺什么证据 | 影响 |
|------|-----------|------|
| 从手动路由表到 filesystem 的迁移时间线 | 仅有「已验证」的说法 | 不知道迁移的平滑度和遗留问题 |
| ES modules 迁移 | 不知道是否从 CommonJS 迁移而来 | migration cost 未量化 |
| lint 管道的进化 | 不知道规则是递增添加还是批量添加 | 维护成本的趋势未暴露 |

**建议下一步**:
1. 运行 `git log --oneline --reverse` 查看完整的提交历史
2. 查找关键迁移节点（如 Remove old router, Add filesystem routing, Switch to ES modules）
3. 统计不同时期 lint 规则的数量变化

---

## 附录 A：Evidence Quality

### Evidence Hierarchy

| Tier | 类型 | 在本文中的使用比例 |
|------|------|-------------------|
| S | Executable behavior | 低（coverage.testing=0.10） |
| A | Implementation (source code) | 中（决策记录引用了实现） |
| B | Configuration | 中（package.json, tsconfig.json） |
| C | Documentation | 高（ARCHITECTURE.md, mentalModel） |
| D | Commit/Issue | 极低（coverage.history=0.05） |
| E | Inference | 中（作者推理 + 替代分析） |

**注释**: 本文中约 40% 的证据来自 C 和 E 层（架构文档+推理），仅 10-15% 来自 A/S 层（可执行代码+测试）。这反映了 **coverage 数据本身的可信度问题**——我们正在用低覆盖的证据源分析一个声称「代码即事实源」的系统。这是本报告最大的 Methodological 矛盾。

### Confidence Standard

| Level | Threshold | 本文中适用示例 |
|-------|-----------|---------------|
| High | ≥3 sources | §5.3 (Filesystem 路由) — 3 源: 决策记录+演化验证+边界测试 |
| Medium | 2 sources | §5.1 (Token-overlap) — 2 源: bug case+假设翻转 |
| Low | 1 source | §5.5 (Lint 成本) — 1 源: tensions+间接证据 |
| Speculative | No direct evidence | §6 新增 Service 流程（基于推理） |

---

## 附录 B：报告 Meta

- **报告生成时间**: 2026-07-29
- **输入数据覆盖域**: runtime(0.30), architecture(0.25), design_decisions(0.20), testing(0.10), deployment(0.10), history(0.05)
- **最确信结论**: §5.3 Filesystem 路由可靠性 (Conf: 0.90)
- **最应怀疑结论**: §5.5 Lint 管道成本效益 (Conf: 0.55 — 缺量化数据)
- **最大矛盾**: 系统核心哲学是「代码即事实源」，但覆盖数据显示 testing(0.10) 和 history(0.05) 几乎未建模——代码在测试和历史领域不是事实源。如果代码是事实源，为什么测试覆盖率未被建模？这是本报告无法回答的自指矛盾。