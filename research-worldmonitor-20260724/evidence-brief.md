# 证据简报：world-monitor

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
| Repository | world-monitor |
| Manifest | package.json (javascript) |
| Version | 2.10.0 |
| Source files | 2505 |
| Top languages | .ts (1362), .mjs (972), .mts (380), .md (285), .proto (281) |
| Top-level dirs | .github, .husky, api, blog-site, cli, consumer-prices-core, convex, data, deploy, docker |
| Commits | 4958 |
| Contributors | 117 |
| CI provider | github-actions |
| **Project stage** | mature (4958 commits, 117 contributors) |
| **Ecosystem** | JavaScript/Node ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 2505 | — |
| Import edges | 5438 | edge/node ratio: 2.17 |
| Import cycles | 9 | ⚠ tight coupling detected |
| Functions | 14570 | 5.8 funcs/module |
| Classes | 510 | 0.2 classes/module |

**Coupling assessment**: edge/node ratio 2.17 → high — tightly coupled, changes ripple widely

**Import cycles** (potential design issues):
  - `api.mcp.jmespath → api.mcp.jmespath`
  - `api.mcp.registry.index → api.mcp.registry.rpc-tools → api.mcp.registry.index`
  - `server.worldmonitor.resilience.v1._dimension-scorers → server.worldmonitor.resilience.v1._dimension-freshness → server.worldmonitor.resilience.v1._dimension-scorers`
  - `server.worldmonitor.resilience.v1._dimension-scorers → server.worldmonitor.resilience.v1._dimension-freshness → server.worldmonitor.resilience.v1._indicator-registry → server.worldmonitor.resilience.v1._dimension-scorers`
  - `server.worldmonitor.resilience.v1._dimension-scorers → server.worldmonitor.resilience.v1._source-failure → server.worldmonitor.resilience.v1._dimension-scorers`
  - ... and 4 more

**Most depended-upon modules** (high in-degree = core/foundation):
  - `server._shared.redis` (in-degree: 212)
  - `scripts._seed-utils` (in-degree: 193)
  - `api.mcp.types` (in-degree: 159)
  - `pro-test.src.i18n` (in-degree: 154)
  - `src.generated.client.worldmonitor.news.v1.service_client` (in-degree: 132)
  - `src.utils.sanitize` (in-degree: 124)
  - `src.components.Panel` (in-degree: 102)
  - `src.utils.dom-utils` (in-degree: 98)
  - `api.mcp.utils` (in-degree: 94)
  - `src.services.generated-rpc-clients` (in-degree: 76)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `convex._generated.server` (PageRank: 0.0559)
  - `scripts._seed-utils` (PageRank: 0.0314)
  - `server._shared.redis` (PageRank: 0.0282)
  - `api.mcp.types` (PageRank: 0.0139)
  - `scripts._seed-envelope-source` (PageRank: 0.0138)
  - `server._shared.entitlement-check` (PageRank: 0.0134)
  - `scripts.lib.llm-telemetry` (PageRank: 0.0096)
  - `scripts._seed-contract` (PageRank: 0.0093)
  - `server._shared.seed-envelope` (PageRank: 0.0086)
  - `server._shared.usage` (PageRank: 0.0085)

**Entry points**: 577 total (tool: 40, server: 1, sdk: 62, cli: 474)
  Sample entry points:
  - [tool] `api/mcp/prompts/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `api/mcp/registry/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `api/mcp/resources/index.ts` — package index entrypoint (deep/bundled)
  - [tool] `consumer-prices-core/src/api/server.ts` — server entrypoint file (deep/bundled)
  - [server] `convex/_generated/server.js` — server entrypoint file
  - [sdk] `src/app/index.ts` — package index entrypoint
  - [sdk] `src/components/index.ts` — package index entrypoint
  - [sdk] `src/config/index.ts` — package index entrypoint

## 3. AI / Agent Design

**Prompts**: 32 detected
  By type: prompt (15), template (5), system (12)
  Sample prompts:
  - [prompt] `consumer-prices-core/src/acquisition/exa.ts:57` prompt = `Extract the following fields from this product page: ${Object.entries(schema.fields)
      .map(([k, v]) => `$...
  - [prompt] `e2e/widget-builder.spec.ts:11` createPrompt = "Show me today's crude oil price versus gold"...
  - [prompt] `e2e/widget-builder.spec.ts:12` modifyPrompt = 'Turn this into a flight delay summary instead'...
  - [template] `scripts/regional-snapshot/transmission-templates.mjs:6` TEMPLATE_VERSION = '1.0.0'...
  - [system] `scripts/seed-forecasts.mjs:2936` CRITICAL_SIGNAL_SYSTEM_PROMPT = `You extract urgent world-state event frames for simulation input.

Return ONLY a JSON a...

**Tools**: 43 detected
  By framework: schema-first (43)
  Sample tools:
  - [schema-first] `get_market_data` — `api/mcp/registry/cache-tools.ts`
  - [schema-first] `get_conflict_events` — `api/mcp/registry/cache-tools.ts`
  - [schema-first] `get_aviation_status` — `api/mcp/registry/cache-tools.ts`
  - [schema-first] `get_news_intelligence` — `api/mcp/registry/cache-tools.ts`
  - [schema-first] `get_natural_disasters` — `api/mcp/registry/cache-tools.ts`
  - [schema-first] `get_military_posture` — `api/mcp/registry/cache-tools.ts`
  - [schema-first] `get_cyber_threats` — `api/mcp/registry/cache-tools.ts`
  - [schema-first] `get_economic_data` — `api/mcp/registry/cache-tools.ts`

**Design archetype** (derived):
  - Tools/Prompts ratio: 1.3 → balanced prompt+tool design

## 4. Testing & Evaluation

**Testing**: 91 test files, 1235 test functions
  Test/source ratio: 0.04 → ⚠ below typical 0.15 threshold
  Test patterns detected: corpus
  Tests by module (top 5):
    - `billing`: 132 tests
    - `followed-countries-mutations`: 71 tests
    - `waveRuns`: 60 tests
    - `rampRunner`: 42 tests
    - `mcpProTokens`: 39 tests

**Evaluation**: Detected
  Eval files: 118
    - `api/health.js`
    - `api/internal/brief-why-matters.ts`
    - `api/mcp/prompts/index.ts`
    - `api/mcp/registry/cache-tools.ts`
    - `api/seed-health.js`
  Metrics: score, exact-match, recall, accuracy, f1, metric, precision, rouge, bleu
  Patterns: score, eval, dataset, benchmark, evaluation, accuracy, metric, golden, judge

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 2505 |
| Import edges | 5438 |
| Import cycles | 9 |
| Functions indexed | 14570 |
| Call relations | 246917 |
| Test files | 91 |
| Total commits | 4958 |
| Contributors | 117 |

**Derived indicators**:
  - Coupling density: 2.17 edges/module
  - Cycle count: 9 — ⚠ multiple cycles suggest architectural debt
  - Call density: 16.9 calls/function
  - Commit intensity: 42 commits/contributor
  - CI: github-actions with 22 workflow(s)

**Architecture signal directories** (high structural importance):
  - `api/internal`
  - `api/mcp/prompts`
  - `blog-site/src`
  - `blog-site/src/content`
  - `blog-site/src/content/blog`
  - `blog-site/src/data`
  - `blog-site/src/layouts`
  - `blog-site/src/lib`
  - `blog-site/src/pages`
  - `blog-site/src/pages/authors`

## 5.5. Ontology View（对象视图）

> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。
> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。

### 对象类型分布

| 类型 | 数量 |
|------|------|
| function | 12810 |
| evaluation | 397 |
| class | 318 |
| workflow | 89 |
| runner | 57 |
| tool | 43 |
| planner | 33 |
| agent | 22 |
| prompt | 16 |

### 关系类型分布

| 关系 | 数量 |
|------|------|
| calls | 246917 |
| imports | 8415 |
| evaluatedBy | 397 |
| uses | 333 |

### 语义对象（非 function/class）

| 类型 | 名称 | 文件 | 属性 |
|------|------|------|------|
| prompt | prompt | consumer-prices-core/src/acquisition/exa.ts | promptType=prompt, variables=, line=57 |
| prompt | prompt | e2e/widget-builder.spec.ts | promptType=prompt, variables=, line=11 |
| prompt | template | scripts/regional-snapshot/transmission-templates.mjs | promptType=template, variables=, line=6 |
| prompt | system | scripts/seed-forecasts.mjs | promptType=system, variables=, line=2936 |
| prompt | prompt | scripts/seed-forecasts.mjs | promptType=prompt, variables=, line=16460 |
| prompt | prompt | scripts/translate-locales.mjs | promptType=prompt, variables=, line=101 |
| prompt | prompt | server/worldmonitor/intelligence/v1/classify-event.ts | promptType=prompt, variables=, line=50 |
| prompt | prompt | server/worldmonitor/intelligence/v1/get-country-intel-brief.ts | promptType=prompt, variables=, line=167 |
| prompt | prompt | src/components/McpDataPanel.ts | promptType=prompt, variables=, line=186 |
| prompt | template | tests/completeness-measurement.test.mjs | promptType=template, variables=, line=225 |
| prompt | template | tests/email-summary-html.test.mjs | promptType=template, variables=, line=15 |
| prompt | template | blog-site/src/content/blog/geopolitical-risk-alerts-slack-teams-worldmonitor-api.md | promptType=template, variables=, line=166 |
| prompt | prompt | scripts/ais-relay.cjs | promptType=prompt, variables=, line=3746 |
| prompt | system | scripts/ais-relay.cjs | promptType=system, variables=, line=11098 |
| prompt | system | scripts/lib/llm-chain.cjs | promptType=system, variables=, line=61 |
| prompt | system | scripts/notification-relay.cjs | promptType=system, variables=, line=1078 |
| tool | get_market_data | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_conflict_events | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_aviation_status | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_news_intelligence | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_natural_disasters | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_military_posture | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_cyber_threats | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_economic_data | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_country_macro | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_eu_housing_cycle | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_eu_quarterly_gov_debt | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_eu_industrial_production | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_prediction_markets | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |
| tool | get_sanctions_data | api/mcp/registry/cache-tools.ts | framework=schema-first, schema=null |

### 问题驱动查询示例

> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）

**查询**: Agent 使用了哪些工具和 prompt？
  Agent(installWidgetAgentMocks) → uses → prompt(prompt)
  证据: e2e/widget-builder.spec.ts, e2e/widget-builder.spec.ts
**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？
  Prompt 对象: 16 个

> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），
> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 无明显缺口检测到（不代表无缺口，仅表示脚本未检测到）

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `scripts/_seed-utils.mjs` | 120 | high in-degree (+40); high PageRank (+50); entrypoint (+30) |
| 2 | `README.md` | 90 | README (+50); important file (+40) |
| 3 | `api/mcp/types.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 4 | `server/_shared/redis.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 5 | `convex/_generated/server.js` | 80 | high PageRank (+50); entrypoint (+30) |
| 6 | `scripts/_seed-contract.mjs` | 80 | high PageRank (+50); entrypoint (+30) |
| 7 | `scripts/_seed-envelope-source.mjs` | 80 | high PageRank (+50); entrypoint (+30) |
| 8 | `scripts/lib/llm-telemetry.cjs` | 80 | high PageRank (+50); entrypoint (+30) |
| 9 | `docs/Docs_To_Review/README.md` | 70 | README (+50); docs (+20) |
| 10 | `docs/methodology/country-resilience-index/reference-edition/2026/README.md` | 70 | README (+50); docs (+20) |
| 11 | `blog-site/README.md` | 50 | README (+50) |
| 12 | `cli/README.md` | 50 | README (+50) |
| 13 | `pro-test/README.md` | 50 | README (+50) |
| 14 | `public/data/README.md` | 50 | README (+50) |
| 15 | `sdk/go/README.md` | 50 | README (+50) |
| 16 | `sdk/python/README.md` | 50 | README (+50) |
| 17 | `sdk/python/tests/test_client.py` | 50 | test (+20); entrypoint (+30) |
| 18 | `sdk/ruby/README.md` | 50 | README (+50) |
| 19 | `server/_shared/entitlement-check.ts` | 50 | high PageRank (+50) |
| 20 | `server/_shared/seed-envelope.ts` | 50 | high PageRank (+50) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `api/mcp/types.ts` — high in-degree (+40); high PageRank (+50)
2. `server/_shared/redis.ts` — high in-degree (+40); high PageRank (+50)
3. `convex/_generated/server.js` — high PageRank (+50); entrypoint (+30)
4. `sdk/python/tests/test_client.py` — test (+20); entrypoint (+30)
5. `server/_shared/entitlement-check.ts` — high PageRank (+50)

### 2 小时深入
继续阅读：

1. `docs/Docs_To_Review/README.md` — README (+50); docs (+20)
2. `docs/methodology/country-resilience-index/reference-edition/2026/README.md` — README (+50); docs (+20)
3. `blog-site/README.md` — README (+50)
4. `cli/README.md` — README (+50)
5. `pro-test/README.md` — README (+50)
6. `public/data/README.md` — README (+50)
7. `sdk/go/README.md` — README (+50)
8. `sdk/python/README.md` — README (+50)
9. `sdk/ruby/README.md` — README (+50)
10. `server/_shared/seed-envelope.ts` — high PageRank (+50)

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
- [low] **architecture**: What design patterns or conventions explain the module organization?

---

## LLM 分析指令

你是一位经验丰富的软件架构师。基于上述证据，为 **world-monitor** 撰写一份工程研究报告。
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
