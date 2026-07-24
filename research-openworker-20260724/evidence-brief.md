# 证据简报：coworker

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
| Repository | coworker |
| Manifest | pyproject.toml (python) |
| Version | 0.0.0 |
| Source files | 355 |
| Top languages | .py (200), .ts (83), .tsx (66), .png (20), .svg (13) |
| Top-level dirs | .github, coworker, docs, packaging, stt, surfaces, tests, ui-mocks |
| Commits | 46 |
| Contributors | 4 |
| CI provider | github-actions |
| **Project stage** | growing (46 commits, 4 contributors) |
| **Ecosystem** | Python ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 355 | — |
| Import edges | 854 | edge/node ratio: 2.41 |
| Import cycles | 9 | ⚠ tight coupling detected |
| Functions | 3304 | 9.3 funcs/module |
| Classes | 208 | 0.6 classes/module |

**Coupling assessment**: edge/node ratio 2.41 → high — tightly coupled, changes ripple widely

**Import cycles** (potential design issues):
  - `coworker.tui.app → coworker.tui.app`
  - `surfaces.gui.src.types → surfaces.gui.src.api → surfaces.gui.src.types`
  - `surfaces.gui.src.humanize → surfaces.gui.src.components.ApprovalCard → surfaces.gui.src.humanize`
  - `surfaces.gui.src.components.connectors.ConnectorsSection → surfaces.gui.src.components.connectors.AccountsDetail → surfaces.gui.src.components.connectors.ConnectorsSection`
  - `surfaces.gui.src.components.connectors.ConnectorsSection → surfaces.gui.src.components.connectors.CalendarDetail → surfaces.gui.src.components.connectors.ConnectorsSection`
  - ... and 4 more

**Most depended-upon modules** (high in-degree = core/foundation):
  - `surfaces.gui.e2e.fixtures` (in-degree: 53)
  - `coworker.server.manager` (in-degree: 52)
  - `surfaces.gui.src.streamGate.test` (in-degree: 48)
  - `surfaces.gui.src.api` (in-degree: 45)
  - `coworker.web.providers` (in-degree: 44)
  - `surfaces.gui.src.types` (in-degree: 34)
  - `surfaces.gui.src.components.Icon` (in-degree: 26)
  - `coworker.cloud` (in-degree: 24)
  - `coworker.secrets` (in-degree: 22)
  - `coworker.testing.fake_slack.server` (in-degree: 19)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `surfaces.gui.src.types` (PageRank: 0.2222)
  - `surfaces.gui.src.api` (PageRank: 0.2052)
  - `surfaces.gui.src.streamGate.test` (PageRank: 0.0472)
  - `surfaces.gui.e2e.fixtures` (PageRank: 0.0283)
  - `surfaces.gui.src.streamGate` (PageRank: 0.0210)
  - `surfaces.gui.src.components.Icon` (PageRank: 0.0132)
  - `coworker.tui.app` (PageRank: 0.0090)
  - `coworker.web.providers` (PageRank: 0.0074)
  - `coworker.server.manager` (PageRank: 0.0074)
  - `coworker.cloud` (PageRank: 0.0072)

**Entry points**: 15 total (cli: 9, server: 2, tool: 4)
  Sample entry points:
  - [cli] `coworker/cli.py` — cli entrypoint file
  - [cli] `coworker/connectors/cli.py` — cli entrypoint file
  - [server] `coworker/server/app.py` — app entrypoint file
  - [tool] `coworker/testing/fake_slack/__main__.py` — Python __main__ entrypoint (deep/bundled)
  - [tool] `coworker/testing/fake_slack/server.py` — server entrypoint file (deep/bundled)
  - [server] `coworker/tui/app.py` — app entrypoint file
  - [tool] `surfaces/gui/src-tauri/src/main.rs` — main entrypoint file (deep/bundled)
  - [cli] `coworker/automation/scheduler.py` — .py function: start() (AST)

## 3. AI / Agent Design

**Prompts**: 15 detected
  By type: few-shot (9), assistant (2), prompt (4)
  Sample prompts:
  - [few-shot] `coworker/agent.py:241` instructions = f"{agent.system_prompt}\n\n{_NARRATION_GUIDANCE}"...
  - [few-shot] `coworker/agent.py:243` instructions = f"{instructions}\n\n{environment_context(ws)}"...
  - [few-shot] `coworker/agent.py:246` instructions = f"{instructions}\n\n{conventions}"...
  - [few-shot] `coworker/agent.py:252` instructions = f"{instructions}\n\n{_MEMORY_GUIDANCE}"...
  - [few-shot] `coworker/agent.py:258` instructions = f"{instructions}\n\n{block}"...

**Tools**: 5 detected
  By framework: decorator-tool (5)
  Sample tools:
  - [decorator-tool] `mcp_tools` — `coworker/server/app.py`
  - [decorator-tool] `connector_tools_patch` — `coworker/server/app.py`
  - [decorator-tool] `test_complete_maps_stop_reasons` — `tests/test_anthropic_provider.py`
  - [decorator-tool] `test_invalid_manifests_rejected` — `tests/test_persona_manifest.py`
  - [decorator-tool] `test_invalid_recommends_rejected` — `tests/test_persona_manifest.py`

**Design archetype** (derived):
  - Tools/Prompts ratio: 0.3 → balanced prompt+tool design

## 4. Testing & Evaluation

**Testing**: 148 test files, 1009 test functions
  Test/source ratio: 0.42 → adequate coverage
  Test patterns detected: corpus, e2e
  Tests by module (top 5):
    - `connectors`: 50 tests
    - `provider_router`: 34 tests
    - `server`: 34 tests
    - `anthropic_provider`: 32 tests
    - `gemini_provider`: 32 tests

**Evaluation**: No evaluation/benchmark artifacts detected.
  The LLM should investigate whether evaluation is done externally or is absent.

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 355 |
| Import edges | 854 |
| Import cycles | 9 |
| Functions indexed | 3304 |
| Call relations | 24900 |
| Test files | 148 |
| Total commits | 46 |
| Contributors | 4 |

**Derived indicators**:
  - Coupling density: 2.41 edges/module
  - Cycle count: 9 — ⚠ multiple cycles suggest architectural debt
  - Call density: 7.5 calls/function
  - Commit intensity: 12 commits/contributor
  - CI: github-actions with 2 workflow(s)

**Architecture signal directories** (high structural importance):
  - `coworker/agents`
  - `coworker/memory`
  - `coworker/tools`
  - `docs`
  - `docs/assets`
  - `stt/src`
  - `surfaces/gui/src`
  - `surfaces/gui/src/components`
  - `surfaces/gui/src/components/connectors`
  - `surfaces/gui/src/connectors`

## 5.5. Ontology View（对象视图）

> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。
> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。

### 对象类型分布

| 类型 | 数量 |
|------|------|
| function | 3068 |
| class | 193 |
| runner | 38 |
| agent | 28 |
| planner | 19 |
| prompt | 7 |
| tool | 5 |
| workflow | 2 |
| evaluation | 1 |

### 关系类型分布

| 关系 | 数量 |
|------|------|
| calls | 24900 |
| imports | 2066 |
| uses | 168 |
| evaluatedBy | 1 |

### 语义对象（非 function/class）

| 类型 | 名称 | 文件 | 属性 |
|------|------|------|------|
| prompt | few-shot | coworker/agent.py | promptType=few-shot, variables=, line=241 |
| prompt | few-shot | coworker/agents/code.py | promptType=few-shot, variables=, line=11 |
| prompt | assistant | coworker/events.py | promptType=assistant, variables=, line=16 |
| prompt | few-shot | coworker/skills/base.py | promptType=few-shot, variables=, line=23 |
| prompt | few-shot | coworker/tools/subagent.py | promptType=few-shot, variables=, line=30 |
| prompt | prompt | surfaces/gui/e2e-live/fib.spec.ts | promptType=prompt, variables=, line=10 |
| prompt | prompt | surfaces/gui/src/components/SessionIntro.tsx | promptType=prompt, variables=, line=17 |
| tool | mcp_tools | coworker/server/app.py | framework=decorator-tool, schema=null |
| tool | connector_tools_patch | coworker/server/app.py | framework=decorator-tool, schema=null |
| tool | test_complete_maps_stop_reasons | tests/test_anthropic_provider.py | framework=decorator-tool, schema=null |
| tool | test_invalid_manifests_rejected | tests/test_persona_manifest.py | framework=decorator-tool, schema=null |
| tool | test_invalid_recommends_rejected | tests/test_persona_manifest.py | framework=decorator-tool, schema=null |
| workflow | ci.yml | .github/workflows/ci.yml | triggers=push,pull_request, jobs=pytest,gui-unit,gui-e2e |
| workflow | release.yml | .github/workflows/release.yml | triggers=push,workflow_dispatch, jobs=build,release |
| agent | chat_agent | coworker/agents/chat.py | line=15, params=, exported=false |
| agent | code_agent | coworker/agents/code.py | line=66, params=, exported=false |
| agent | cowork_agent | coworker/agents/cowork.py | line=46, params=, exported=false |
| agent | myhelper_agent | coworker/agents/myhelper.py | line=30, params=, exported=false |
| agent | get_agent | coworker/agents/registry.py | line=15, params=name, exported=false |
| agent | list_agents | coworker/agents/registry.py | line=24, params=, exported=false |
| runner | _loop | coworker/automation/scheduler.py | line=63, params=self, exported=false |
| runner | compute_next_run | coworker/automation/store.py | line=22, params=task, exported=false |
| runner | add_run | coworker/automation/store.py | line=142, params=self,run, exported=false |
| runner | find_run | coworker/automation/store.py | line=151, params=self,run_id, exported=false |
| runner | run | coworker/connectors/browser_automation.py | line=199, params=, exported=false |
| runner | _run | coworker/connectors/relay_client.py | line=128, params=self, exported=false |
| runner | run | coworker/engine.py | line=156, params=self,user_input, exported=false |
| runner | _loop | coworker/engine.py | line=294, params=self, exported=false |
| planner | _handle_plan_proposal | coworker/engine.py | line=704, params=self,tool_call, exported=false |
| planner | add_plan | coworker/inbox.py | line=234, params=self,session_id,title, exported=false |

### 问题驱动查询示例

> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）

**查询**: Agent 使用了哪些工具和 prompt？
  Agent(chat_agent) → uses → prompt(few-shot)
  证据: coworker/agents/chat.py, coworker/agents/code.py
**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？
  Prompt 对象: 7 个

> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），
> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 未找到评估/基准测试基础设施
- 未找到 CONTRIBUTING 指南（外部贡献流程不明）
- 未找到 SECURITY 策略（漏洞报告流程不明）
- 未找到 CHANGELOG（版本演进缺乏结构化记录）
- 未找到 AI Agent 指令文件（AGENTS.md / CLAUDE.md 等）

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `surfaces/gui/src/streamGate.test.ts` | 110 | test (+20); high in-degree (+40); high PageRank (+50) |
| 2 | `README.md` | 90 | README (+50); important file (+40) |
| 3 | `coworker/cloud.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 4 | `coworker/server/manager.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 5 | `coworker/web/providers.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `surfaces/gui/e2e/fixtures.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `surfaces/gui/src/api.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 8 | `surfaces/gui/src/components/Icon.tsx` | 90 | high in-degree (+40); high PageRank (+50) |
| 9 | `surfaces/gui/src/types.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 10 | `coworker/tui/app.py` | 80 | high PageRank (+50); entrypoint (+30) |
| 11 | `coworker/testing/fake_slack/server.py` | 70 | high in-degree (+40); entrypoint (+30) |
| 12 | `surfaces/gui/README.md` | 50 | README (+50) |
| 13 | `surfaces/gui/e2e/README.md` | 50 | README (+50) |
| 14 | `surfaces/gui/src/streamGate.ts` | 50 | high PageRank (+50) |
| 15 | `LICENSE` | 40 | important file (+40) |
| 16 | `coworker/secrets.py` | 40 | high in-degree (+40) |
| 17 | `coworker/automation/scheduler.py` | 30 | entrypoint (+30) |
| 18 | `coworker/cli.py` | 30 | entrypoint (+30) |
| 19 | `coworker/connectors/cli.py` | 30 | entrypoint (+30) |
| 20 | `coworker/connectors/gateway.py` | 30 | entrypoint (+30) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `LICENSE` — important file (+40)
2. `coworker/cloud.py` — high in-degree (+40); high PageRank (+50)
3. `coworker/server/manager.py` — high in-degree (+40); high PageRank (+50)
4. `coworker/web/providers.py` — high in-degree (+40); high PageRank (+50)
5. `surfaces/gui/e2e/fixtures.ts` — high in-degree (+40); high PageRank (+50)

### 2 小时深入
继续阅读：

1. `surfaces/gui/src/api.ts` — high in-degree (+40); high PageRank (+50)
2. `surfaces/gui/src/components/Icon.tsx` — high in-degree (+40); high PageRank (+50)
3. `surfaces/gui/src/types.ts` — high in-degree (+40); high PageRank (+50)
4. `coworker/tui/app.py` — high PageRank (+50); entrypoint (+30)
5. `coworker/testing/fake_slack/server.py` — high in-degree (+40); entrypoint (+30)
6. `surfaces/gui/README.md` — README (+50)
7. `surfaces/gui/e2e/README.md` — README (+50)
8. `surfaces/gui/src/streamGate.ts` — high PageRank (+50)
9. `coworker/secrets.py` — high in-degree (+40)
10. `coworker/automation/scheduler.py` — entrypoint (+30)

> LLM 应在报告的「阅读指南」章节中复现并扩展此列表，按洞察密度排序。

## 9. Research Plan & Open Questions

### Hypotheses (from evidence)
- **✓ H1-purpose** (high): The repository purpose and target audience can be inferred from README and manifest
- **✓ H2-ai-agent** (high): This is an AI-agent / LLM-related project with prompts and/or tools
- **✓ H3-modular** (high): The codebase has a modular architecture with identifiable dependency layers
- **✓ H4-testing** (high): The project relies on automated tests for correctness
- **✓ H5-entrypoints** (high): Entry points reveal the primary interfaces (CLI, server, SDK)
- **⚠ H6-evaluation** (low): The project measures quality through benchmarks or evaluations
  - Gaps: No evaluation or benchmark artifacts detected
- **? H7-maturity** (medium): The project is actively maintained with a non-trivial development history

### Open Questions (from evidence gaps)
- [medium] **architecture**: How is responsibility divided among the top modules, and where are the dependency boundaries?
- [medium] **entrypoints**: What commands or APIs does the CLI/server expose?
- [medium] **evaluation**: What metrics, datasets, or judges are used for evaluation?
- [medium] **prompts**: What role do system, assistant, and few-shot prompts play?
- [low] **prompts**: Are prompts statically defined or dynamically assembled?
- [low] **tools**: Are tools decorated, wrapped, or provided by a framework?

---

## LLM 分析指令

你是一位经验丰富的软件架构师。基于上述证据，为 **coworker** 撰写一份工程研究报告。
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
