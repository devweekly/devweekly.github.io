# 证据简报：researchstudio

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
| Repository | researchstudio |
| Manifest | package.json (javascript) |
| Version | 1.0.0 |
| Source files | 106 |
| Top languages | .md (102), .py (102), .html (26), .woff2 (24), .txt (14) |
| Top-level dirs | ResearchStudio-Idea, ResearchStudio-Reel, bin, docs |
| Commits | 49 |
| Contributors | 10 |
| CI provider | none |
| **Project stage** | growing (49 commits, 10 contributors) |
| **Ecosystem** | JavaScript/Node ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 106 | — |
| Import edges | 49 | edge/node ratio: 0.46 |
| Import cycles | 0 | no cycles — clean layering |
| Functions | 1988 | 18.8 funcs/module |
| Classes | 117 | 1.1 classes/module |

**Coupling assessment**: edge/node ratio 0.46 → low

**Most depended-upon modules** (high in-degree = core/foundation):
  - `ResearchStudio-Idea.skills.paper_search.scripts._http_runtime` (in-degree: 9)
  - `ResearchStudio-Idea.skills.idea_spark.scripts._time_guard` (in-degree: 4)
  - `ResearchStudio-Idea.skills.paper_search.scripts._env` (in-degree: 3)
  - `ResearchStudio-Idea.skills.idea_spark.scripts.extract_user_refs` (in-degree: 2)
  - `ResearchStudio-Idea.skills.idea_spark.scripts.fetch_sections` (in-degree: 2)
  - `ResearchStudio-Idea.skills.idea_spark.scripts.merge_revisions` (in-degree: 2)
  - `ResearchStudio-Idea.skills.idea_spark.scripts.phase4_skeleton` (in-degree: 2)
  - `ResearchStudio-Idea.skills.paper_search.scripts.postprocess` (in-degree: 2)
  - `ResearchStudio-Idea.skills.paper_search.scripts.search_papers` (in-degree: 2)
  - `ResearchStudio-Reel.skills.paper2assets.scripts.utils.logo_trim` (in-degree: 2)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `ResearchStudio-Idea.skills.paper_search.scripts._http_runtime` (PageRank: 0.0521)
  - `ResearchStudio-Idea.skills.idea_spark.scripts._time_guard` (PageRank: 0.0336)
  - `ResearchStudio-Reel.skills.paper2assets.scripts.utils.logo_trim` (PageRank: 0.0206)
  - `ResearchStudio-Reel.skills.paper2video.scripts.duration_planner` (PageRank: 0.0206)
  - `ResearchStudio-Reel.skills.paper2video.scripts.extract_pptx_elements` (PageRank: 0.0196)
  - `ResearchStudio-Idea.skills.paper_search.scripts.postprocess` (PageRank: 0.0174)
  - `ResearchStudio-Idea.skills.paper_search.scripts._env` (PageRank: 0.0172)
  - `ResearchStudio-Idea.skills.idea_spark.scripts.merge_revisions` (PageRank: 0.0161)
  - `ResearchStudio-Reel.skills.paper2poster.references.apply_theme` (PageRank: 0.0141)
  - `ResearchStudio-Reel.skills.paper2reel.scripts.serve_reel` (PageRank: 0.0141)

**Entry points**: 70 total (cli: 1, tool: 69)
  Sample entry points:
  - [cli] `bin/install.mjs` — file under bin/
  - [tool] `ResearchStudio-Idea/skills/idea_spark/scripts/dedup_merge.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `ResearchStudio-Idea/skills/idea_spark/scripts/extract_user_refs.py` — Python __main__ guard (AST) (deep/bundled)
  - [tool] `ResearchStudio-Idea/skills/idea_spark/scripts/fetch_sections.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `ResearchStudio-Idea/skills/idea_spark/scripts/gen_pipeline.py` — Python __main__ guard (AST) (deep/bundled)
  - [tool] `ResearchStudio-Idea/skills/idea_spark/scripts/intent.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `ResearchStudio-Idea/skills/idea_spark/scripts/pattern_summary.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `ResearchStudio-Idea/skills/idea_spark/scripts/regression_check.py` — .py function: main() (AST) (deep/bundled)

## 3. AI / Agent Design

**Prompts**: 10 detected
  By type: template (5), prompt (4), system (1)
  Sample prompts:
  - [template] `ResearchStudio-Idea/skills/idea_spark/scripts/pattern_summary.py:49` SYSTEM_TEMPLATE = """You classify a single paper into 1-3 of the 15 induced ideation patterns it EXECUTES (not merely me...
  - [prompt] `ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/auto_fix_loop.py:140` prompt = f"""You are fixing a visual-fidelity bug in an isolated COPY
of the html2pptx skill at `{copy_dir}`. You are NO...
  - [system] `ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/vision_audit.py:79` SYSTEM_PROMPT = """You are a visual-fidelity auditor. You receive two renderings of the same poster:
- IMAGE_A: ground t...
  - [template] `ResearchStudio-Reel/skills/paper2reel/scripts/build_poster_slides_view.py:26` TEMPLATE_VERSION = "attention_golden_section_modal.v1"...
  - [template] `ResearchStudio-Reel/skills/paper2reel/scripts/build_section_media_from_timeline.py:26` TEMPLATE_VERSION = "attention_golden_section_modal.v1"...

**Tools**: 68 detected
  By framework: decorator-tool (1), script-tool (67)
  Sample tools:
  - [decorator-tool] `request_with_default_timeout` — `ResearchStudio-Idea/skills/paper_search/scripts/_http_runtime.py`
  - [script-tool] `idea_spark` — `ResearchStudio-Idea/skills/idea_spark/scripts/dedup_merge.py`
  - [script-tool] `idea_spark` — `ResearchStudio-Idea/skills/idea_spark/scripts/extract_user_refs.py`
  - [script-tool] `idea_spark` — `ResearchStudio-Idea/skills/idea_spark/scripts/fetch_sections.py`
  - [script-tool] `idea_spark` — `ResearchStudio-Idea/skills/idea_spark/scripts/gen_pipeline.py`
  - [script-tool] `idea_spark` — `ResearchStudio-Idea/skills/idea_spark/scripts/intent.py`
  - [script-tool] `idea_spark` — `ResearchStudio-Idea/skills/idea_spark/scripts/pattern_summary.py`
  - [script-tool] `idea_spark` — `ResearchStudio-Idea/skills/idea_spark/scripts/regression_check.py`

**Design archetype** (derived):
  - Tools/Prompts ratio: 6.8 → tool-heavy design (capabilities primarily tool-driven)

## 4. Testing & Evaluation

**Testing**: 2 test files, 41 test functions
  Test/source ratio: 0.02 → ⚠ below typical 0.15 threshold
  Test patterns detected: corpus
  Tests by module (top 5):
    - `gates`: 38 tests
    - `canvas_clamp`: 3 tests

**Evaluation**: Detected
  Eval files: 14
    - `ResearchStudio-Idea/skills/idea_spark/scripts/fetch_sections.py`
    - `ResearchStudio-Idea/skills/idea_spark/scripts/next_step.py`
    - `ResearchStudio-Idea/skills/idea_spark/scripts/run.py`
    - `ResearchStudio-Idea/skills/paper_search/scripts/selftest_postprocess.py`
    - `ResearchStudio-Reel/skills/paper2poster/assets/mathjax/tex-svg.js`
  Metrics: metric, recall, score, precision, accuracy, bleu
  Patterns: eval, evaluation, benchmark, rubric, metric, judge, score, dataset, accuracy, golden

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 106 |
| Import edges | 49 |
| Import cycles | 0 |
| Functions indexed | 1988 |
| Call relations | 36362 |
| Test files | 2 |
| Total commits | 49 |
| Contributors | 10 |

**Derived indicators**:
  - Coupling density: 0.46 edges/module
  - Call density: 18.3 calls/function
  - Commit intensity: 5 commits/contributor
  - CI: none detected ⚠

**Architecture signal directories** (high structural importance):
  - `ResearchStudio-Idea/evaluation`
  - `ResearchStudio-Idea/evaluation/idea_quality`
  - `ResearchStudio-Idea/evaluation/idea_quality/evals`
  - `ResearchStudio-Idea/evaluation/idea_quality/evals/sample_ideas`
  - `ResearchStudio-Reel/skills/paper2blog/agents`
  - `ResearchStudio-Reel/skills/paper2poster/html2pptx/tests`
  - `ResearchStudio-Reel/skills/paper2poster/tests`
  - `docs`
  - `docs/assets`

## 5.5. Ontology View（对象视图）

> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。
> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。

### 对象类型分布

| 类型 | 数量 |
|------|------|
| function | 1268 |
| tool | 68 |
| class | 44 |
| evaluation | 28 |
| prompt | 9 |
| runner | 8 |
| planner | 8 |
| workflow | 1 |

### 关系类型分布

| 关系 | 数量 |
|------|------|
| calls | 36362 |
| imports | 819 |
| uses | 168 |
| evaluatedBy | 28 |

### 语义对象（非 function/class）

| 类型 | 名称 | 文件 | 属性 |
|------|------|------|------|
| prompt | template | ResearchStudio-Idea/skills/idea_spark/scripts/pattern_summary.py | promptType=template, variables=, line=49 |
| prompt | prompt | ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/auto_fix_loop.py | promptType=prompt, variables=, line=140 |
| prompt | system | ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/vision_audit.py | promptType=system, variables=, line=79 |
| prompt | template | ResearchStudio-Reel/skills/paper2reel/scripts/build_poster_slides_view.py | promptType=template, variables=, line=26 |
| prompt | template | ResearchStudio-Reel/skills/paper2reel/scripts/build_section_media_from_timeline.py | promptType=template, variables=, line=26 |
| prompt | prompt | ResearchStudio-Idea/skills/idea_spark/references/intent-recognition.md | promptType=prompt, variables=, line=7 |
| prompt | prompt | ResearchStudio-Reel/skills/paper2assets/SKILL.md | promptType=prompt, variables=, line=365 |
| prompt | template | ResearchStudio-Reel/skills/paper2poster/SKILL.md | promptType=template, variables=, line=492 |
| prompt | template | ResearchStudio-Reel/skills/paper2poster/references/staged_fill.md | promptType=template, variables=, line=215 |
| tool | request_with_default_timeout | ResearchStudio-Idea/skills/paper_search/scripts/_http_runtime.py | framework=decorator-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/dedup_merge.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/extract_user_refs.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/fetch_sections.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/gen_pipeline.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/intent.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/pattern_summary.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/regression_check.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/render_pdf.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/run.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/search_arxiv.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/search_openalex.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/search_openreview.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/search_semanticscholar.py | framework=script-tool, schema=null |
| tool | idea_spark | ResearchStudio-Idea/skills/idea_spark/scripts/selftest_routing.py | framework=script-tool, schema=null |
| tool | paper_search | ResearchStudio-Idea/skills/paper_search/scripts/search_papers.py | framework=script-tool, schema=null |
| tool | paper_search | ResearchStudio-Idea/skills/paper_search/scripts/search_papers_by_arxiv.py | framework=script-tool, schema=null |
| tool | paper_search | ResearchStudio-Idea/skills/paper_search/scripts/search_papers_by_crossref.py | framework=script-tool, schema=null |
| tool | paper_search | ResearchStudio-Idea/skills/paper_search/scripts/search_papers_by_dblp.py | framework=script-tool, schema=null |
| tool | paper_search | ResearchStudio-Idea/skills/paper_search/scripts/search_papers_by_google_scholar.py | framework=script-tool, schema=null |
| tool | paper_search | ResearchStudio-Idea/skills/paper_search/scripts/search_papers_by_open_alex.py | framework=script-tool, schema=null |

### 问题驱动查询示例

> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）

**查询**: Agent 使用了哪些工具和 prompt？
  Agent(check_run) → uses → tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), tool(idea_spark), prompt(template)
  证据: ResearchStudio-Idea/skills/idea_spark/scripts/regression_check.py, ResearchStudio-Idea/skills/idea_spark/scripts/dedup_merge.py, ResearchStudio-Idea/skills/idea_spark/scripts/extract_user_refs.py, ResearchStudio-Idea/skills/idea_spark/scripts/fetch_sections.py, ResearchStudio-Idea/skills/idea_spark/scripts/gen_pipeline.py, ResearchStudio-Idea/skills/idea_spark/scripts/intent.py, ResearchStudio-Idea/skills/idea_spark/scripts/pattern_summary.py, ResearchStudio-Idea/skills/idea_spark/scripts/regression_check.py, ResearchStudio-Idea/skills/idea_spark/scripts/render_pdf.py, ResearchStudio-Idea/skills/idea_spark/scripts/run.py, ResearchStudio-Idea/skills/idea_spark/scripts/search_arxiv.py, ResearchStudio-Idea/skills/idea_spark/scripts/search_openalex.py, ResearchStudio-Idea/skills/idea_spark/scripts/search_openreview.py, ResearchStudio-Idea/skills/idea_spark/scripts/search_semanticscholar.py, ResearchStudio-Idea/skills/idea_spark/scripts/selftest_routing.py, ResearchStudio-Idea/skills/idea_spark/scripts/pattern_summary.py
**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？
  Prompt 对象: 9 个

> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），
> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 未检测到 CI/CD 配置
- 未检测到 import 循环 — 模块分层清晰
- 未找到 CONTRIBUTING 指南（外部贡献流程不明）
- 未找到 CHANGELOG（版本演进缺乏结构化记录）
- 未找到 AI Agent 指令文件（AGENTS.md / CLAUDE.md 等）

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `ResearchStudio-Reel/skills/paper2assets/scripts/utils/logo_trim.py` | 120 | high in-degree (+40); high PageRank (+50); entrypoint (+30) |
| 2 | `README.md` | 90 | README (+50); important file (+40) |
| 3 | `ResearchStudio-Idea/skills/idea_spark/scripts/_time_guard.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 4 | `ResearchStudio-Idea/skills/idea_spark/scripts/merge_revisions.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 5 | `ResearchStudio-Idea/skills/paper_search/scripts/_env.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `ResearchStudio-Idea/skills/paper_search/scripts/_http_runtime.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `ResearchStudio-Idea/skills/paper_search/scripts/postprocess.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 8 | `ResearchStudio-Reel/skills/paper2poster/references/apply_theme.py` | 80 | high PageRank (+50); entrypoint (+30) |
| 9 | `ResearchStudio-Reel/skills/paper2reel/scripts/serve_reel.py` | 80 | high PageRank (+50); entrypoint (+30) |
| 10 | `ResearchStudio-Reel/skills/paper2video/scripts/extract_pptx_elements.py` | 80 | high PageRank (+50); entrypoint (+30) |
| 11 | `ResearchStudio-Idea/skills/idea_spark/scripts/extract_user_refs.py` | 70 | high in-degree (+40); entrypoint (+30) |
| 12 | `ResearchStudio-Idea/skills/idea_spark/scripts/fetch_sections.py` | 70 | high in-degree (+40); entrypoint (+30) |
| 13 | `ResearchStudio-Idea/skills/paper_search/scripts/search_papers.py` | 70 | high in-degree (+40); entrypoint (+30) |
| 14 | `ResearchStudio-Idea/README.md` | 50 | README (+50) |
| 15 | `ResearchStudio-Idea/evaluation/README.md` | 50 | README (+50) |
| 16 | `ResearchStudio-Reel/README.md` | 50 | README (+50) |
| 17 | `ResearchStudio-Reel/skills/paper2assets/README.md` | 50 | README (+50) |
| 18 | `ResearchStudio-Reel/skills/paper2blog/README.md` | 50 | README (+50) |
| 19 | `ResearchStudio-Reel/skills/paper2poster/README.md` | 50 | README (+50) |
| 20 | `ResearchStudio-Reel/skills/paper2poster/html2pptx/README.md` | 50 | README (+50) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `ResearchStudio-Reel/skills/paper2assets/scripts/utils/logo_trim.py` — high in-degree (+40); high PageRank (+50); entrypoint (+30)
2. `ResearchStudio-Idea/skills/idea_spark/scripts/_time_guard.py` — high in-degree (+40); high PageRank (+50)
3. `ResearchStudio-Idea/skills/idea_spark/scripts/merge_revisions.py` — high in-degree (+40); high PageRank (+50)
4. `ResearchStudio-Idea/skills/paper_search/scripts/_env.py` — high in-degree (+40); high PageRank (+50)
5. `ResearchStudio-Idea/skills/paper_search/scripts/_http_runtime.py` — high in-degree (+40); high PageRank (+50)

### 2 小时深入
继续阅读：

1. `ResearchStudio-Idea/skills/paper_search/scripts/postprocess.py` — high in-degree (+40); high PageRank (+50)
2. `ResearchStudio-Reel/skills/paper2poster/references/apply_theme.py` — high PageRank (+50); entrypoint (+30)
3. `ResearchStudio-Reel/skills/paper2reel/scripts/serve_reel.py` — high PageRank (+50); entrypoint (+30)
4. `ResearchStudio-Reel/skills/paper2video/scripts/extract_pptx_elements.py` — high PageRank (+50); entrypoint (+30)
5. `ResearchStudio-Idea/skills/idea_spark/scripts/extract_user_refs.py` — high in-degree (+40); entrypoint (+30)
6. `ResearchStudio-Idea/skills/idea_spark/scripts/fetch_sections.py` — high in-degree (+40); entrypoint (+30)
7. `ResearchStudio-Idea/skills/paper_search/scripts/search_papers.py` — high in-degree (+40); entrypoint (+30)
8. `ResearchStudio-Idea/README.md` — README (+50)
9. `ResearchStudio-Idea/evaluation/README.md` — README (+50)
10. `ResearchStudio-Reel/README.md` — README (+50)

> LLM 应在报告的「阅读指南」章节中复现并扩展此列表，按洞察密度排序。

## 9. Research Plan & Open Questions

### Hypotheses (from evidence)
- **✓ H1-purpose** (high): The repository purpose and target audience can be inferred from README and manifest
- **✓ H2-ai-agent** (high): This is an AI-agent / LLM-related project with prompts and/or tools
- **✓ H3-modular** (high): The codebase has a modular architecture with identifiable dependency layers
- **? H4-testing** (medium): The project relies on automated tests for correctness
- **✓ H5-entrypoints** (high): Entry points reveal the primary interfaces (CLI, server, SDK)
- **✓ H6-evaluation** (high): The project measures quality through benchmarks or evaluations
- **? H7-maturity** (medium): The project is actively maintained with a non-trivial development history

### Open Questions (from evidence gaps)
- [medium] **entrypoints**: What commands or APIs does the CLI/server expose?
- [medium] **prompts**: What role do system, assistant, and few-shot prompts play?
- [low] **prompts**: Are prompts statically defined or dynamically assembled?
- [low] **tools**: Are tools decorated, wrapped, or provided by a framework?

---

## LLM 分析指令

你是一位经验丰富的软件架构师。基于上述证据，为 **researchstudio** 撰写一份工程研究报告。
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
