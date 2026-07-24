# 证据简报：code-review-graph

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
| Repository | code-review-graph |
| Manifest | pyproject.toml (python) |
| Version | 2.3.7 |
| Source files | 182 |
| Top languages | .py (140), .md (47), .ts (26), .csv (18), .yml (15) |
| Top-level dirs | .beads, .github, .serena, code-review-graph-vscode, code_review_graph, diagrams, docs, evaluate, hooks, scripts |
| Commits | 714 |
| Contributors | 106 |
| CI provider | github-actions |
| **Project stage** | mature (714 commits, 106 contributors) |
| **Ecosystem** | Python ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 182 | — |
| Import edges | 345 | edge/node ratio: 1.90 |
| Import cycles | 1 | ⚠ tight coupling detected |
| Functions | 3379 | 18.6 funcs/module |
| Classes | 277 | 1.5 classes/module |

**Coupling assessment**: edge/node ratio 1.90 → moderate — typical for mid-size projects

**Import cycles** (potential design issues):
  - `code-review-graph-vscode.esbuild → code-review-graph-vscode.esbuild`

**Most depended-upon modules** (high in-degree = core/foundation):
  - `code_review_graph.graph` (in-degree: 48)
  - `code_review_graph.parser` (in-degree: 45)
  - `code_review_graph.incremental` (in-degree: 39)
  - `code_review_graph.visualization` (in-degree: 24)
  - `code_review_graph.flows` (in-degree: 16)
  - `code_review_graph.daemon` (in-degree: 14)
  - `code_review_graph.communities` (in-degree: 13)
  - `code-review-graph-vscode.src.backend.sqlite` (in-degree: 12)
  - `code_review_graph.daemon_cli` (in-degree: 12)
  - `code_review_graph.search` (in-degree: 12)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `code_review_graph.parser` (PageRank: 0.0514)
  - `code_review_graph.graph` (PageRank: 0.0429)
  - `code-review-graph-vscode.src.backend.sqlite` (PageRank: 0.0343)
  - `code-review-graph-vscode.esbuild` (PageRank: 0.0245)
  - `code_review_graph.incremental` (PageRank: 0.0218)
  - `code_review_graph.flows` (PageRank: 0.0185)
  - `tests.fixtures.sample_typescript` (PageRank: 0.0183)
  - `code_review_graph.search` (PageRank: 0.0156)
  - `code_review_graph.communities` (PageRank: 0.0135)
  - `code_review_graph.tools.query` (PageRank: 0.0122)

**Entry points**: 11 total (tool: 2, cli: 9)
  Sample entry points:
  - [tool] `code-review-graph-vscode/src/backend/cli.ts` — cli entrypoint file (deep/bundled)
  - [cli] `code_review_graph/__main__.py` — Python __main__ entrypoint
  - [cli] `code_review_graph/cli.py` — cli entrypoint file
  - [cli] `code_review_graph/main.py` — main entrypoint file
  - [cli] `scripts/diagnose_pypi_connectivity.py` — file under scripts/
  - [cli] `scripts/render_pr_comment.py` — file under scripts/
  - [cli] `code-review-graph-vscode/esbuild.mjs` — .mjs function: main() (AST)
  - [cli] `code_review_graph/daemon.py` — .py function: start() (AST)

## 3. AI / Agent Design

**Prompts**: 3 detected
  By type: template (2), prompt (1)
  Sample prompts:
  - [template] `code_review_graph/visualization.py:421` _HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width...
  - [template] `code_review_graph/visualization.py:1454` _AGGREGATED_HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" con...
  - [prompt] `AGENTS.md:33` **Other commands that may prompt:**...

**Tools**: 37 detected
  By framework: decorator-tool (37)
  Sample tools:
  - [decorator-tool] `build_or_update_graph_tool` — `code_review_graph/main.py`
  - [decorator-tool] `run_postprocess_tool` — `code_review_graph/main.py`
  - [decorator-tool] `get_minimal_context_tool` — `code_review_graph/main.py`
  - [decorator-tool] `get_impact_radius_tool` — `code_review_graph/main.py`
  - [decorator-tool] `query_graph_tool` — `code_review_graph/main.py`
  - [decorator-tool] `get_review_context_tool` — `code_review_graph/main.py`
  - [decorator-tool] `semantic_search_nodes_tool` — `code_review_graph/main.py`
  - [decorator-tool] `embed_graph_tool` — `code_review_graph/main.py`

**Design archetype** (derived):
  - Tools/Prompts ratio: 12.3 → tool-heavy design (capabilities primarily tool-driven)

## 4. Testing & Evaluation

**Testing**: 68 test files, 2128 test functions
  Test/source ratio: 0.37 → adequate coverage
  Test patterns detected: corpus, integration
  Tests by module (top 5):
    - `multilang`: 454 tests
    - `skills`: 202 tests
    - `tools`: 128 tests
    - `embeddings`: 110 tests
    - `parser`: 109 tests

**Evaluation**: Detected
  Eval files: 19
    - `code_review_graph/cli.py`
    - `code_review_graph/embeddings.py`
    - `code_review_graph/eval/__init__.py`
    - `code_review_graph/eval/benchmarks/__init__.py`
    - `code_review_graph/eval/benchmarks/agent_baseline.py`
  Metrics: score, precision, recall, accuracy, f1, metric, exact-match
  Patterns: score, eval, evaluation, benchmark, accuracy, metric, dataset

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 182 |
| Import edges | 345 |
| Import cycles | 1 |
| Functions indexed | 3379 |
| Call relations | 20609 |
| Test files | 68 |
| Total commits | 714 |
| Contributors | 106 |

**Derived indicators**:
  - Coupling density: 1.90 edges/module
  - Cycle count: 1 — minor coupling issues
  - Call density: 6.1 calls/function
  - Commit intensity: 7 commits/contributor
  - CI: github-actions with 5 workflow(s)

**Architecture signal directories** (high structural importance):
  - `code-review-graph-vscode/src`
  - `code-review-graph-vscode/src/backend`
  - `code-review-graph-vscode/src/features`
  - `code-review-graph-vscode/src/onboarding`
  - `code-review-graph-vscode/src/views`
  - `code-review-graph-vscode/src/webview`
  - `code_review_graph/eval`
  - `code_review_graph/eval/benchmarks`
  - `code_review_graph/eval/configs`
  - `code_review_graph/tools`

## 5.5. Ontology View（对象视图）

> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。
> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。

### 对象类型分布

| 类型 | 数量 |
|------|------|
| function | 2982 |
| class | 273 |
| evaluation | 45 |
| tool | 37 |
| runner | 34 |
| workflow | 18 |
| agent | 10 |
| prompt | 2 |

### 关系类型分布

| 关系 | 数量 |
|------|------|
| calls | 20609 |
| imports | 1235 |
| uses | 360 |
| evaluatedBy | 45 |

### 语义对象（非 function/class）

| 类型 | 名称 | 文件 | 属性 |
|------|------|------|------|
| prompt | template | code_review_graph/visualization.py | promptType=template, variables=, line=421 |
| prompt | prompt | AGENTS.md | promptType=prompt, variables=, line=33 |
| tool | build_or_update_graph_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | run_postprocess_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_minimal_context_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_impact_radius_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | query_graph_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_review_context_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | semantic_search_nodes_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | embed_graph_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | list_graph_stats_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_docs_section_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | find_large_functions_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | list_flows_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_flow_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_affected_flows_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | list_communities_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_community_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_architecture_overview_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | detect_changes_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | refactor_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | apply_refactor_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | generate_wiki_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_wiki_page_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_hub_nodes_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_bridge_nodes_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_knowledge_gaps_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_surprising_connections_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | get_suggested_questions_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |
| tool | traverse_graph_tool | code_review_graph/main.py | framework=decorator-tool, schema=null |

### 问题驱动查询示例

> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）

**查询**: Agent 使用了哪些工具和 prompt？
  Agent(test_embed_sends_user_agent_header) → uses → tool(test_tool_command_forwards_typed_arguments_as_json), tool(test_provenance_sqlite_read_runs_off_event_loop), tool(test_every_graph_backed_tool_category_attaches_provenance), tool(test_non_single_repository_tools_do_not_claim_one_graph), tool(test_store_closed_on_success), tool(test_store_closed_when_analysis_raises)
  证据: tests/test_embeddings.py, tests/test_cli_tool_commands.py, tests/test_main.py, tests/test_main.py, tests/test_main.py, tests/test_tools.py, tests/test_tools.py
**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？
  Prompt 对象: 2 个

> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），
> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 无明显缺口检测到（不代表无缺口，仅表示脚本未检测到）

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `README.md` | 90 | README (+50); important file (+40) |
| 2 | `code-review-graph-vscode/src/backend/sqlite.ts` | 90 | high in-degree (+40); high PageRank (+50) |
| 3 | `code_review_graph/communities.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 4 | `code_review_graph/flows.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 5 | `code_review_graph/graph.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `code_review_graph/incremental.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `code_review_graph/parser.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 8 | `code_review_graph/search.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 9 | `code-review-graph-vscode/esbuild.mjs` | 80 | high PageRank (+50); entrypoint (+30) |
| 10 | `code_review_graph/daemon.py` | 70 | high in-degree (+40); entrypoint (+30) |
| 11 | `code_review_graph/daemon_cli.py` | 70 | high in-degree (+40); entrypoint (+30) |
| 12 | `.beads/README.md` | 50 | README (+50) |
| 13 | `code-review-graph-vscode/README.md` | 50 | README (+50) |
| 14 | `code_review_graph/tools/query.py` | 50 | high PageRank (+50) |
| 15 | `tests/fixtures/sample_typescript.ts` | 50 | high PageRank (+50) |
| 16 | `.github/copilot-instructions.md` | 40 | important file (+40) |
| 17 | `AGENTS.md` | 40 | important file (+40) |
| 18 | `CHANGELOG.md` | 40 | important file (+40) |
| 19 | `CLAUDE.md` | 40 | important file (+40) |
| 20 | `CONTRIBUTING.md` | 40 | important file (+40) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `AGENTS.md` — important file (+40)
2. `CLAUDE.md` — important file (+40)
3. `code-review-graph-vscode/src/backend/sqlite.ts` — high in-degree (+40); high PageRank (+50)
4. `code_review_graph/communities.py` — high in-degree (+40); high PageRank (+50)
5. `code_review_graph/flows.py` — high in-degree (+40); high PageRank (+50)

### 2 小时深入
继续阅读：

1. `code_review_graph/graph.py` — high in-degree (+40); high PageRank (+50)
2. `code_review_graph/incremental.py` — high in-degree (+40); high PageRank (+50)
3. `code_review_graph/parser.py` — high in-degree (+40); high PageRank (+50)
4. `code_review_graph/search.py` — high in-degree (+40); high PageRank (+50)
5. `code_review_graph/daemon.py` — high in-degree (+40); entrypoint (+30)
6. `code_review_graph/daemon_cli.py` — high in-degree (+40); entrypoint (+30)
7. `.beads/README.md` — README (+50)
8. `code-review-graph-vscode/README.md` — README (+50)
9. `code_review_graph/tools/query.py` — high PageRank (+50)
10. `tests/fixtures/sample_typescript.ts` — high PageRank (+50)

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

你是一位经验丰富的软件架构师。基于上述证据，为 **code-review-graph** 撰写一份工程研究报告。
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
