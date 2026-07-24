# 证据简报：buzz-workspace

> 生成时间：2026-07-23，由 research-repo skill（确定性分析）生成。
> 本简报是 LLM 报告生成的**输入**，并非最终报告。
> LLM 应阅读本简报，然后按照最后一节的提示撰写 `report.md`。

## 0. 研究原则

LLM 在撰写报告时必须遵循以下原则：

- **证据优于假设** — 每个结论必须引用具体证据（文件路径、指标、简报章节）。
- **多个弱信号优于一个强信号** — 交叉验证，避免单一来源偏差。
- **区分事实与解读** — 事实是「代码中存在 X」，解读是「这意味着 Y」。
- **显式声明不确定性** — 证据不足时说「未知」，不要默认「有」。
- **分离观察与结论** — 观察是「检测到 X」，结论是「因此 Y」。
- **不要仅从命名推断架构** — 函数名不等于功能，需查看调用链。
- **测试是一等证据** — 测试代码揭示真实意图和使用方式。
- **示例是可执行文档** — example/ 目录的价值不低于 README。
- **关注可复用模式而非实现细节** — 提取模式，不陷于细节。
- **Negative Finding 同样重要** — 「未找到 X」与「找到 Y」具有同等研究价值。

## 1. Executive Brief

| Dimension | Value |
|-----------|-------|
| Repository | buzz-workspace |
| Manifest | package.json (javascript) |
| Version | unknown |
| Source files | 2409 |
| Top languages | .ts (770), .rs (531), .tsx (528), .mjs (332), .dart (207) |
| Top-level dirs | .agents, .cargo, .claude, .codex, .github, .goose, .intersect, admin-web, benchmarks, bin |
| Commits | 1802 |
| Contributors | 50 |
| CI provider | github-actions |
| **Project stage** | mature (1802 commits, 50 contributors) |
| **Ecosystem** | JavaScript/Node ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 2409 | — |
| Import edges | 5600 | edge/node ratio: 2.32 |
| Import cycles | 5 | ⚠ tight coupling detected |
| Functions | 17175 | 7.1 funcs/module |
| Classes | 64 | 0.0 classes/module |

**Coupling assessment**: edge/node ratio 2.32 → high — tightly coupled, changes ripple widely

**Import cycles** (potential design issues):
  - `web.src.shared.ui.sonner → web.src.shared.ui.sonner`
  - `web.src.features.repos.mock-repos → web.src.features.repos.use-repos → web.src.features.repos.mock-repos`
  - `desktop.src.features.channels.ui.useChannelAgentSessions → desktop.src.features.channels.ui.agentSessionSelection → desktop.src.features.channels.ui.useChannelAgentSessions`
  - `desktop.src.features.notifications.hooks → desktop.src.features.notifications.use-feed-desktop-notifications → desktop.src.features.notifications.hooks`
  - `desktop.src.features.pulse.ui.PulseView → desktop.src.features.pulse.ui.PulseTabBar → desktop.src.features.pulse.ui.PulseView`

**Most depended-upon modules** (high in-degree = core/foundation):
  - `admin-web.src.types` (in-degree: 397)
  - `desktop.src.shared.api.hooks` (in-degree: 299)
  - `web.src.shared.lib.cn` (in-degree: 239)
  - `web.src.shared.ui.button` (in-degree: 177)
  - `desktop.src.shared.api.tauri.test` (in-degree: 141)
  - `desktop.src.shared.api.tauri` (in-degree: 118)
  - `desktop.tests.helpers.bridge` (in-degree: 118)
  - `web.src.shared.lib.pubkey` (in-degree: 111)
  - `desktop.src-tauri.src.commands.identity` (in-degree: 74)
  - `web.src.shared.ui.sonner` (in-degree: 71)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `admin-web.src.types` (PageRank: 0.0590)
  - `web.src.shared.lib.cn` (PageRank: 0.0384)
  - `desktop.src.shared.api.tauri.test` (PageRank: 0.0206)
  - `desktop.src.shared.api.tauri` (PageRank: 0.0199)
  - `desktop.src.shared.api.hooks` (PageRank: 0.0095)
  - `desktop.src.shared.api.relayRateLimitGate` (PageRank: 0.0094)
  - `desktop.tests.helpers.bridge` (PageRank: 0.0093)
  - `desktop.src.shared.api.tauriIdentity` (PageRank: 0.0091)
  - `web.src.shared.ui.button` (PageRank: 0.0087)
  - `web.src.shared.lib.pubkey` (PageRank: 0.0085)

**Entry points**: 108 total (tool: 49, cli: 49, example: 10)
  Sample entry points:
  - [tool] `crates/buzz-acp/src/main.rs` — main entrypoint file (deep/bundled)
  - [tool] `crates/buzz-admin/src/main.rs` — main entrypoint file (deep/bundled)
  - [tool] `crates/buzz-agent/src/main.rs` — main entrypoint file (deep/bundled)
  - [tool] `crates/buzz-cli/src/main.rs` — main entrypoint file (deep/bundled)
  - [tool] `crates/buzz-dev-mcp/src/main.rs` — main entrypoint file (deep/bundled)
  - [tool] `crates/buzz-pair-relay/src/main.rs` — main entrypoint file (deep/bundled)
  - [tool] `crates/buzz-pairing-cli/src/main.rs` — main entrypoint file (deep/bundled)
  - [tool] `crates/buzz-push-gateway/src/main.rs` — main entrypoint file (deep/bundled)

## 3. AI / Agent Design

**Prompts**: 440 detected
  By type: prompt (87), system (345), template (8)
  Sample prompts:
  - [prompt] `benchmarks/harbor-buzz-orchestra/src/harbor_buzz_orchestra/container_runtime.py:32` REMOTE_PROMPTS = f"{REMOTE_ROOT}/prompts"...
  - [prompt] `benchmarks/harbor-buzz-orchestra/src/harbor_buzz_orchestra/container_runtime.py:303` remote_prompt = f"{REMOTE_PROMPTS}/{credential.agent_id}.system-prompt.md"...
  - [system] `desktop/src/features/onboarding/welcomeGuide.ts:28` LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT =
  "You are Kit, Sprout's friendly welcome guide. Help new users understand the comm...
  - [template] `desktop/src/features/projects/ui/ProjectsContributionGraph.tsx:104` gridTemplateColumns = `repeat(${weeks.length}, minmax(0, 1fr))`...
  - [prompt] `desktop/src/features/search/ui/SearchPromptPlaceholder.tsx:18` SEARCH_PROMPT_Y_OFFSET = "0.5rem"...

**Tools**: 3 detected
  By framework: schema-first (3)
  Sample tools:
  - [schema-first] `dev__view_image` — `crates/buzz-agent/src/llm.rs`
  - [schema-first] `dev__shell` — `crates/buzz-agent/src/llm.rs`
  - [schema-first] `t` — `crates/buzz-agent/src/llm.rs`

**Design archetype** (derived):
  - Tools/Prompts ratio: 0.0 → prompt-heavy design (capabilities primarily instruction-driven)

## 4. Testing & Evaluation

**Testing**: 125 test files, 908 test functions
  Test/source ratio: 0.05 → ⚠ below typical 0.15 threshold
  Test patterns detected: benchmark, corpus, snapshot, integration
  Tests by module (top 5):
    - `channels`: 63 tests
    - `onboarding`: 58 tests
    - `mentions`: 49 tests
    - `messaging`: 35 tests
    - `channel-browser`: 29 tests

**Evaluation**: Detected
  Eval files: 42
    - `benchmarks/harbor-buzz-orchestra/forwarder/relay_forwarder.rs`
    - `benchmarks/harbor-buzz-orchestra/scripts/benchmark.py`
    - `benchmarks/harbor-buzz-orchestra/scripts/run_leaderboard.py`
    - `benchmarks/harbor-buzz-orchestra/src/harbor_buzz_orchestra/__init__.py`
    - `benchmarks/harbor-buzz-orchestra/src/harbor_buzz_orchestra/agent.py`
  Metrics: f1, metric, precision, score, exact-match, accuracy, recall
  Patterns: benchmark, dataset, leaderboard, eval, evaluation, metric, golden, score, accuracy

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 2409 |
| Import edges | 5600 |
| Import cycles | 5 |
| Functions indexed | 17175 |
| Call relations | 109024 |
| Test files | 125 |
| Total commits | 1802 |
| Contributors | 50 |

**Derived indicators**:
  - Coupling density: 2.32 edges/module
  - Cycle count: 5 — ⚠ multiple cycles suggest architectural debt
  - Call density: 6.3 calls/function
  - Commit intensity: 36 commits/contributor
  - CI: github-actions with 10 workflow(s)

**Architecture signal directories** (high structural importance):
  - `admin-web/src`
  - `admin-web/tests`
  - `benchmarks`
  - `benchmarks/harbor-buzz-orchestra`
  - `benchmarks/harbor-buzz-orchestra/forwarder`
  - `benchmarks/harbor-buzz-orchestra/manifests`
  - `benchmarks/harbor-buzz-orchestra/personas`
  - `benchmarks/harbor-buzz-orchestra/scripts`
  - `benchmarks/harbor-buzz-orchestra/src`
  - `benchmarks/harbor-buzz-orchestra/src/harbor_buzz_orchestra`

## 5.5. Ontology View（对象视图）

> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。
> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。

### 对象类型分布

| 类型 | 数量 |
|------|------|
| function | 15710 |
| agent | 911 |
| workflow | 194 |
| evaluation | 118 |
| prompt | 106 |
| runner | 88 |
| class | 59 |
| planner | 15 |
| tool | 3 |

### 关系类型分布

| 关系 | 数量 |
|------|------|
| calls | 109024 |
| imports | 11510 |
| uses | 3670 |
| evaluatedBy | 118 |

### 语义对象（非 function/class）

| 类型 | 名称 | 文件 | 属性 |
|------|------|------|------|
| prompt | prompt | benchmarks/harbor-buzz-orchestra/src/harbor_buzz_orchestra/container_runtime.py | promptType=prompt, variables=, line=32 |
| prompt | system | desktop/src/features/onboarding/welcomeGuide.ts | promptType=system, variables=, line=28 |
| prompt | template | desktop/src/features/projects/ui/ProjectsContributionGraph.tsx | promptType=template, variables=, line=104 |
| prompt | prompt | desktop/src/features/search/ui/SearchPromptPlaceholder.tsx | promptType=prompt, variables=, line=18 |
| prompt | system | CHANGELOG.md | promptType=system, variables=, line=950 |
| prompt | prompt | benchmarks/harbor-buzz-orchestra/README.md | promptType=prompt, variables=, line=25 |
| prompt | prompt | crates/buzz-acp/README.md | promptType=prompt, variables=, line=189 |
| prompt | system | crates/buzz-acp/src/acp.rs | promptType=system, variables=, line=555 |
| prompt | prompt | crates/buzz-acp/src/acp.rs | promptType=prompt, variables=, line=2212 |
| prompt | system | crates/buzz-acp/src/config.rs | promptType=system, variables=, line=282 |
| prompt | system | crates/buzz-acp/src/lib.rs | promptType=system, variables=, line=1537 |
| prompt | prompt | crates/buzz-acp/src/lib.rs | promptType=prompt, variables=, line=3046 |
| prompt | prompt | crates/buzz-acp/src/pool.rs | promptType=prompt, variables=, line=188 |
| prompt | system | crates/buzz-acp/src/pool.rs | promptType=system, variables=, line=492 |
| prompt | system | crates/buzz-acp/src/queue.rs | promptType=system, variables=, line=1358 |
| prompt | prompt | crates/buzz-acp/src/queue.rs | promptType=prompt, variables=, line=1802 |
| prompt | system | crates/buzz-agent/src/agent.rs | promptType=system, variables=, line=30 |
| prompt | prompt | crates/buzz-agent/src/agent.rs | promptType=prompt, variables=, line=66 |
| prompt | system | crates/buzz-agent/src/config.rs | promptType=system, variables=, line=689 |
| prompt | prompt | crates/buzz-agent/src/handoff.rs | promptType=prompt, variables=, line=42 |
| prompt | system | crates/buzz-agent/src/lib.rs | promptType=system, variables=, line=362 |
| prompt | prompt | crates/buzz-agent/src/lib.rs | promptType=prompt, variables=, line=369 |
| prompt | system | crates/buzz-agent/src/llm.rs | promptType=system, variables=, line=70 |
| prompt | system | crates/buzz-agent/src/wire.rs | promptType=system, variables=, line=53 |
| prompt | prompt | crates/buzz-agent/src/wire.rs | promptType=prompt, variables=, line=60 |
| prompt | system | crates/buzz-agent/tests/fake_llm.rs | promptType=system, variables=, line=416 |
| prompt | prompt | crates/buzz-agent/tests/hints_integration.rs | promptType=prompt, variables=, line=288 |
| prompt | prompt | crates/buzz-agent/tests/regressions.rs | promptType=prompt, variables=, line=975 |
| prompt | system | crates/buzz-cli/src/agent_management.rs | promptType=system, variables=, line=18 |
| prompt | system | crates/buzz-cli/src/commands/agents.rs | promptType=system, variables=, line=17 |

### 问题驱动查询示例

> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）

**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？
  Prompt 对象: 106 个

> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），
> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 无明显缺口检测到（不代表无缺口，仅表示脚本未检测到）

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `examples/README.md` | 110 | README (+50); examples (+30); entrypoint (+30) |
| 2 | `examples/countdown-bot/README.md` | 110 | README (+50); examples (+30); entrypoint (+30) |
| 3 | `examples/meadow-core/README.md` | 110 | README (+50); examples (+30); entrypoint (+30) |
| 4 | `README.md` | 90 | README (+50); important file (+40) |
| 5 | `admin-web/src/types.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `desktop/src/shared/api/hooks.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `desktop/src/shared/api/tauri.test.mjs` | 90 | high in-degree (+40); high PageRank (+50) |
| 8 | `desktop/src/shared/api/tauri.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 9 | `desktop/tests/helpers/bridge.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 10 | `web/src/shared/lib/cn.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 11 | `web/src/shared/lib/pubkey.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 12 | `web/src/shared/ui/button.tsx` | 90 | high in-degree (+40); high PageRank (+50) |
| 13 | `scripts/cutover/README.md` | 80 | README (+50); entrypoint (+30) |
| 14 | `docs/admin/README.md` | 70 | README (+50); docs (+20) |
| 15 | `crates/buzz-relay/examples/mesh_admission_smoke.rs` | 60 | examples (+30); entrypoint (+30) |
| 16 | `crates/buzz-relay/examples/mesh_agent_e2e.rs` | 60 | examples (+30); entrypoint (+30) |
| 17 | `crates/buzz-relay/examples/mesh_serve_client_smoke.rs` | 60 | examples (+30); entrypoint (+30) |
| 18 | `crates/buzz-relay/examples/mesh_serve_smoke.rs` | 60 | examples (+30); entrypoint (+30) |
| 19 | `crates/buzz-relay/examples/mesh_stack_smoke.rs` | 60 | examples (+30); entrypoint (+30) |
| 20 | `crates/buzz-sdk/examples/compute_auth_tag.rs` | 60 | examples (+30); entrypoint (+30) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `admin-web/src/types.ts` — high in-degree (+40); high PageRank (+50)
2. `desktop/src/shared/api/hooks.ts` — high in-degree (+40); high PageRank (+50)
3. `desktop/src/shared/api/tauri.ts` — high in-degree (+40); high PageRank (+50)
4. `desktop/tests/helpers/bridge.ts` — high in-degree (+40); high PageRank (+50)
5. `web/src/shared/lib/cn.ts` — high in-degree (+40); high PageRank (+50)

### 2 小时深入
继续阅读：

1. `examples/README.md` — README (+50); examples (+30); entrypoint (+30)
2. `examples/countdown-bot/README.md` — README (+50); examples (+30); entrypoint (+30)
3. `examples/meadow-core/README.md` — README (+50); examples (+30); entrypoint (+30)
4. `web/src/shared/lib/pubkey.ts` — high in-degree (+40); high PageRank (+50)
5. `web/src/shared/ui/button.tsx` — high in-degree (+40); high PageRank (+50)
6. `scripts/cutover/README.md` — README (+50); entrypoint (+30)
7. `docs/admin/README.md` — README (+50); docs (+20)
8. `crates/buzz-relay/examples/mesh_admission_smoke.rs` — examples (+30); entrypoint (+30)
9. `crates/buzz-relay/examples/mesh_agent_e2e.rs` — examples (+30); entrypoint (+30)
10. `crates/buzz-relay/examples/mesh_serve_client_smoke.rs` — examples (+30); entrypoint (+30)

> LLM 应在报告的「阅读指南」章节中复现并扩展此列表，按洞察密度排序。

## 9. Research Plan & Open Questions

### Hypotheses (from evidence)
- **✓ H1-purpose** (high): The repository purpose and target audience can be inferred from README and manifest
- **✓ H2-ai-agent** (high): This is an AI-agent / LLM-related project with prompts and/or tools
- **✓ H3-modular** (high): The codebase has a modular architecture with identifiable dependency layers
- **✓ H4-testing** (high): The project relies on automated tests for correctness
- **✓ H5-entrypoints** (high): Entry points reveal the primary interfaces (CLI, server, SDK)
- **✓ H6-evaluation** (high): The project measures quality through benchmarks or evaluations
- **✓ H7-maturity** (high): The project is actively maintained with a non-trivial development history

### Open Questions (from evidence gaps)
- [medium] **architecture**: How is responsibility divided among the top modules, and where are the dependency boundaries?
- [medium] **entrypoints**: What commands or APIs does the CLI/server expose?
- [medium] **prompts**: What role do system, assistant, and few-shot prompts play?
- [low] **prompts**: Are prompts statically defined or dynamically assembled?
- [low] **tools**: Are tools decorated, wrapped, or provided by a framework?

---

## LLM 分析指令

你是一位经验丰富的软件架构师。基于上述证据，为 **buzz-workspace** 撰写一份工程研究报告。
请将报告保存为工作目录下的 `report.md`。

### 核心方法论：Ontology-driven Research（对象驱动研究）

将仓库视为工程对象图（简报 §5.5），而非文件集合。每个重要概念是一个 Object（Agent、Tool、Prompt、Test 等），
Object 之间有语义关系（uses、testedBy、configuredBy 等）。

Research Trace 应使用对象驱动语言：
- ❌「agent.ts 导入了 tool.ts」
- ✅「Agent 对象通过 uses 关系连接到 Tool 对象」

查询路径：Question → Object → Relationship → Evidence → Answer

### 核心方法论：Research Trace

**每个重要结论必须展示完整推导链条**，而非仅给出结论。格式如下：

```markdown
### [结论标题]

**问题**: 这个结论回答了什么问题？

**证据**:
- 证据1（文件路径 + 简报章节）
- 证据2（指标 + 解读）
- 证据3（交叉验证来源）

**分析**: 基于证据的推理过程。区分事实与解读。

**反证**: 是否有矛盾证据？如无，说明「未发现反证」。

**结论**: 推导出的结论。

**置信度**: 高/中/低 — 说明为何这个置信度。
```

### 报告结构

1. **执行摘要** — 这是什么项目？最有趣的发现是什么？（不超过 3 段）

2. **Research Traces** — 对 5-8 个核心发现，每个使用上述 Research Trace 格式。
   选择最有研究价值的发现，而非面面俱到。例如：
   - 核心架构模式是什么？
   - Agent 如何防止无限循环？
   - 上下文工程策略是什么？
   - 测试策略是否充分？
   - 是否有评估基础设施？

3. **Negative Findings** — 明确列出「未找到什么」。这些不是缺陷，而是研究边界。
   - 引用简报 §6 的发现
   - 补充你在阅读源码时发现的「未找到」
   - 每条说明：为什么这个缺失重要？

4. **Architecture Smells** — 潜在的设计风险。注意：都是「Potential」，不是断言。
   - Potential Tight Coupling（引用循环数据）
   - Potential Over-engineering
   - Potential Hidden Complexity
   - Potential Scalability Issues
   每条说明：为什么这是潜在风险？证据是什么？置信度如何？

5. **Interesting Decisions** — 几个「看起来奇怪但可能很聪明」的设计决策。
   每条包含：决策内容 / 为什么有趣 / 替代方案 / 权衡。

6. **Repository Positioning** — 生态定位（不是 Feature Matrix）。
   | 维度 | 当前成熟度 | 说明 |
   维度包括：Planning, Execution, Memory, Evaluation, Guardrails, Prompt, Tooling, Observability
   成熟度：Emerging / Common / Advanced / Unique

7. **Reusable Pattern Catalog** — 可复用模式目录（结构化表格）。
   | 模式 | 描述 | 位置 | 可复用性 |
   可复用性：✅ 通用 / ⚠ 需适配 / ❌ 特定场景

8. **Architecture Evolution** — 架构演进（基于 Git 历史）。
   - 主要重构事件
   - 已移除的设计
   - 已弃用的 API
   - 历史决策的痕迹

9. **Reading Guide** — 阅读指南（基于简报 §8 扩展）。
   - 30 分钟速览：最关键的 5 个文件
   - 2 小时深入：+ 10 个文件
   - 按洞察密度排序，说明每个文件为什么值得读

10. **Open Questions** — 待解决问题（用于第二轮研究）。
    每条包含：问题 / 为什么重要 / 建议的调查方法。

### 规则

- 遵循简报 §0 的研究原则。
- 每个论断必须引用证据（文件路径、简报章节、指标）。
- 对主要结论使用高/中/低置信度标签，并说明原因。
- 没有证据时说「未知」，不要默认「存在」。
- 不要只复述数字 — 解释它们对工程决策意味着什么。
- Negative Findings 与正面发现同等重要。
- Architecture Smells 使用「Potential」而非断言。
- Interesting Decisions 关注「为什么有趣」而非「好不好」。

### 用于深入调查的证据文件

以下 JSON 文件包含完整证据（如需更多细节请阅读）：
- `evidence-store/full.json` — 完整分析输出
- `evidence-store/symbols.json` — 函数/类/导入/调用索引
- `evidence-store/architecture.json` — 依赖图 + 中心性
- `evidence-store/interesting_files.json` — 排序后的文件阅读优先级
