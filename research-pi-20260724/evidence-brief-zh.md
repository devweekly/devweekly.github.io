# 证据简报：pi-monorepo

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
| Repository | pi-monorepo |
| Manifest | package.json (javascript) |
| Version | 0.0.3 |
| Source files | 940 |
| Top languages | .ts (916), .md (89), .json (36), .mjs (21), (no ext) (17) |
| Top-level dirs | .github, .husky, .pi, packages, scripts |
| Commits | 5080 |
| Contributors | 287 |
| CI provider | github-actions |
| **Project stage** | mature (5080 commits, 287 contributors) |
| **Ecosystem** | JavaScript/Node ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 940 | — |
| Import edges | 2487 | edge/node ratio: 2.65 |
| Import cycles | 20 | ⚠ tight coupling detected |
| Functions | 3037 | 3.2 funcs/module |
| Classes | 0 | N/A |

**Coupling assessment**: edge/node ratio 2.65 → high — tightly coupled, changes ripple widely

**Import cycles** (potential design issues):
  - `packages.agent.src.harness.types → packages.agent.src.harness.session.session → packages.agent.src.harness.types`
  - `packages.coding-agent.src.modes.interactive.components.diff → packages.coding-agent.src.modes.interactive.components.diff`
  - `packages.ai.src.compat → packages.ai.src.api.anthropic-messages.lazy → packages.ai.src.types → packages.ai.src.api.anthropic-messages → packages.coding-agent.src.core.sdk → packages.ai.src.compat`
  - `packages.ai.src.compat → packages.ai.src.api.anthropic-messages.lazy → packages.ai.src.types → packages.ai.src.api.anthropic-messages → packages.coding-agent.src.core.sdk → packages.coding-agent.src.core.agent-session → packages.ai.src.compat`
  - `packages.coding-agent.src.core.bash-executor → packages.coding-agent.src.core.tools.bash → packages.coding-agent.src.core.extensions.types → packages.coding-agent.src.core.bash-executor`
  - ... and 15 more

**Most depended-upon modules** (high in-degree = core/foundation):
  - `packages.ai.src.types` (in-degree: 147)
  - `packages.ai.src.compat` (in-degree: 120)
  - `packages.coding-agent.src.modes.interactive.theme.theme` (in-degree: 83)
  - `packages.coding-agent.src.core.session-manager` (in-degree: 71)
  - `packages.ai.src.models` (in-degree: 61)
  - `packages.coding-agent.src.config` (in-degree: 51)
  - `packages.coding-agent.src.core.settings-manager` (in-degree: 49)
  - `packages.agent.src.harness.types` (in-degree: 39)
  - `packages.coding-agent.src.utils.json` (in-degree: 39)
  - `packages.ai.src.model-catalog` (in-degree: 37)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `packages.ai.src.types` (PageRank: 0.0982)
  - `packages.coding-agent.src.utils.child-process` (PageRank: 0.0294)
  - `packages.coding-agent.src.config` (PageRank: 0.0228)
  - `packages.coding-agent.src.utils.paths` (PageRank: 0.0204)
  - `packages.ai.src.utils.event-stream` (PageRank: 0.0182)
  - `packages.coding-agent.src.modes.interactive.theme.theme` (PageRank: 0.0156)
  - `packages.ai.src.compat` (PageRank: 0.0150)
  - `packages.ai.src.auth.types` (PageRank: 0.0129)
  - `packages.ai.src.models` (PageRank: 0.0111)
  - `packages.ai.vitest.config` (PageRank: 0.0109)

**Entry points**: 82 total (tool: 52, cli: 29, sdk: 1)
  Sample entry points:
  - [tool] `packages/agent/src/harness/tools/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/agent/src/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/ai/src/cli.ts` — cli entrypoint file (deep/bundled)
  - [tool] `packages/ai/src/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/doom-overlay/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `packages/coding-agent/examples/extensions/dynamic-resources/index.ts` — package index entrypoint (deep/bundled)

## 3. AI / Agent Design

**Prompts**: 66 detected
  By type: prompt (33), system (24), assistant (1), template (7), few-shot (1)
  Sample prompts:
  - [prompt] `packages/agent/src/harness/agent-harness.ts:363` systemPrompt = "You are a helpful assistant."...
  - [prompt] `packages/agent/src/harness/compaction/branch-summarization.ts:173` BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use ...
  - [prompt] `packages/agent/src/harness/compaction/branch-summarization.ts:235` promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`...
  - [system] `packages/agent/src/harness/compaction/compaction.ts:446` SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a ...
  - [prompt] `packages/agent/src/harness/compaction/compaction.ts:450` SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summa...

**Tools**: 3 detected
  By framework: script-tool (3)
  Sample tools:
  - [script-tool] `index` — `packages/agent/src/harness/tools/index.ts`
  - [script-tool] `index` — `packages/agent/src/index.ts`
  - [script-tool] `index` — `packages/coding-agent/src/core/tools/index.ts`

**Design archetype** (derived):
  - Tools/Prompts ratio: 0.0 → prompt-heavy design (capabilities primarily instruction-driven)

## 4. Testing & Evaluation

**Testing**: 337 test files, 4359 test functions
  Test/source ratio: 0.36 → adequate coverage
  Test patterns detected: e2e, replay, corpus, regression
  Tests by module (top 5):
    - `editor`: 200 tests
    - `stream`: 183 tests
    - `package-manager`: 138 tests
    - `tools`: 112 tests
    - `prompt-templates`: 106 tests

**Evaluation**: Detected
  Eval files: 1
    - `scripts/profile-coding-agent-node.mjs`
  Metrics: metric, score, f1
  Patterns: evaluation, metric, benchmark, eval, score, dataset

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 940 |
| Import edges | 2487 |
| Import cycles | 20 |
| Functions indexed | 3037 |
| Call relations | 76173 |
| Test files | 337 |
| Total commits | 5080 |
| Contributors | 287 |

**Derived indicators**:
  - Coupling density: 2.65 edges/module
  - Cycle count: 20 — ⚠ multiple cycles suggest architectural debt
  - Call density: 25.1 calls/function
  - Commit intensity: 18 commits/contributor
  - CI: github-actions with 10 workflow(s)

**Architecture signal directories** (high structural importance):
  - `.pi/prompts`
  - `packages/agent`
  - `packages/agent/docs`
  - `packages/agent/src`
  - `packages/agent/src/harness`
  - `packages/agent/src/harness/compaction`
  - `packages/agent/src/harness/session`
  - `packages/agent/src/harness/tools`
  - `packages/agent/src/harness/utils`
  - `packages/agent/test`

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 未找到 LICENSE 文件

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `README.md` | 90 | README (+50); important file (+40) |
| 2 | `packages/ai/src/compat.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 3 | `packages/ai/src/models.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 4 | `packages/ai/src/types.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 5 | `packages/coding-agent/src/config.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `packages/coding-agent/src/modes/interactive/theme/theme.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `packages/coding-agent/examples/README.md` | 80 | README (+50); examples (+30) |
| 8 | `packages/coding-agent/examples/extensions/README.md` | 80 | README (+50); examples (+30) |
| 9 | `packages/coding-agent/examples/extensions/doom-overlay/README.md` | 80 | README (+50); examples (+30) |
| 10 | `packages/coding-agent/examples/extensions/plan-mode/README.md` | 80 | README (+50); examples (+30) |
| 11 | `packages/coding-agent/examples/extensions/subagent/README.md` | 80 | README (+50); examples (+30) |
| 12 | `packages/coding-agent/examples/sdk/README.md` | 80 | README (+50); examples (+30) |
| 13 | `packages/coding-agent/examples/extensions/claude-rules.ts` | 60 | examples (+30); entrypoint (+30) |
| 14 | `packages/coding-agent/examples/extensions/commands.ts` | 60 | examples (+30); entrypoint (+30) |
| 15 | `packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 16 | `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 17 | `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/test.ts` | 60 | examples (+30); entrypoint (+30) |
| 18 | `packages/coding-agent/examples/extensions/doom-overlay/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 19 | `packages/coding-agent/examples/extensions/dynamic-resources/index.ts` | 60 | examples (+30); entrypoint (+30) |
| 20 | `packages/coding-agent/examples/extensions/dynamic-tools.ts` | 60 | examples (+30); entrypoint (+30) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `README.md` — README (+50); important file (+40)
2. `packages/coding-agent/examples/README.md` — README (+50); examples (+30)
3. `packages/coding-agent/examples/extensions/README.md` — README (+50); examples (+30)
4. `packages/coding-agent/examples/extensions/doom-overlay/README.md` — README (+50); examples (+30)
5. `packages/coding-agent/examples/extensions/plan-mode/README.md` — README (+50); examples (+30)

### 2 小时深入
继续阅读：

1. `packages/ai/src/compat.ts` — high in-degree (+40); high PageRank (+50)
2. `packages/ai/src/models.ts` — high in-degree (+40); high PageRank (+50)
3. `packages/ai/src/types.ts` — high in-degree (+40); high PageRank (+50)
4. `packages/coding-agent/src/config.ts` — high in-degree (+40); high PageRank (+50)
5. `packages/coding-agent/src/modes/interactive/theme/theme.ts` — high in-degree (+40); high PageRank (+50)
6. `packages/coding-agent/examples/extensions/subagent/README.md` — README (+50); examples (+30)
7. `packages/coding-agent/examples/sdk/README.md` — README (+50); examples (+30)
8. `packages/coding-agent/examples/extensions/claude-rules.ts` — examples (+30); entrypoint (+30)
9. `packages/coding-agent/examples/extensions/commands.ts` — examples (+30); entrypoint (+30)
10. `packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts` — examples (+30); entrypoint (+30)

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
- [low] **architecture**: What design patterns or conventions explain the module organization?

---

## LLM 分析指令

你是一位经验丰富的软件架构师。基于上述证据，为 **pi-monorepo** 撰写一份工程研究报告。
请将报告保存为工作目录下的 `report.md`。

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
