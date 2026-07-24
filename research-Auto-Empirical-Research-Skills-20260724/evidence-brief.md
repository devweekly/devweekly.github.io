# 证据简报：Auto-Empirical-Research-Skills

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
| Repository | Auto-Empirical-Research-Skills |
| Manifest | requirements.txt (python) |
| Version | unknown |
| Source files | 268 |
| Top languages | .md (3037), .py (262), .do (149), .tex (123), .json (113) |
| Top-level dirs | .claude-plugin, .github, agents, benchmark, catalog, demo-StatsPAI-skill, demo-notebooks, docs, ecosystem, eval-harness |
| Commits | 208 |
| Contributors | 15 |
| CI provider | github-actions |
| **Project stage** | growing (208 commits, 15 contributors) |
| **Ecosystem** | Python ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 268 | — |
| Import edges | 181 | edge/node ratio: 0.68 |
| Import cycles | 2 | ⚠ tight coupling detected |
| Functions | 2355 | 8.8 funcs/module |
| Classes | 186 | 0.7 classes/module |

**Coupling assessment**: edge/node ratio 0.68 → low

**Import cycles** (potential design issues):
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.parsers → skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.pdf_parser → skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.parsers`
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.scholar_eval → skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.scoring_model → skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.scholar_eval`

**Most depended-upon modules** (high in-degree = core/foundation):
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.parsers` (in-degree: 58)
  - `tests._helpers` (in-degree: 17)
  - `benchmark.lib.lalonde` (in-degree: 10)
  - `skills.67-econfin-workflow-toolkit.skill-creator.scripts.utils` (in-degree: 6)
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.scholar_eval` (in-degree: 5)
  - `skills.50-brycewang-aer-skills.templates.python.setup` (in-degree: 5)
  - `scripts.toml_compat` (in-degree: 4)
  - `skills.33-Galaxy-Dawn-claude-scholar.skills.obsidian-project-memory.scripts.project_kb` (in-degree: 3)
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.literature_search` (in-degree: 3)
  - `skills.35-bahayonghang-academic-writing-skills.skills.typst-paper.scripts.online_bib_verify` (in-degree: 3)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.parsers` (PageRank: 0.1878)
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.pdf_parser` (PageRank: 0.1638)
  - `tests._helpers` (PageRank: 0.0300)
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.scholar_eval` (PageRank: 0.0177)
  - `skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.scoring_model` (PageRank: 0.0170)
  - `benchmark.lib.lalonde` (PageRank: 0.0167)
  - `skills.67-econfin-workflow-toolkit.skill-creator.scripts.utils` (PageRank: 0.0108)
  - `skills.50-brycewang-aer-skills.templates.python.setup` (PageRank: 0.0095)
  - `scripts.toml_compat` (PageRank: 0.0077)
  - `skills.33-Galaxy-Dawn-claude-scholar.skills.obsidian-project-memory.scripts.project_kb` (PageRank: 0.0069)

**Entry points**: 219 total (tool: 188, cli: 31)
  Sample entry points:
  - [tool] `skills/23-Learning-Bayesian-Statistics-baygent-skills/bayesian-workflow/main.py` — main entrypoint file (deep/bundled)
  - [cli] `scripts/build-benchmark-scoreboard.py` — file under scripts/
  - [cli] `scripts/build-catalog-enrich.py` — file under scripts/
  - [cli] `scripts/build-catalog.py` — file under scripts/
  - [cli] `scripts/build-coverage-map.py` — file under scripts/
  - [cli] `scripts/build-evals.py` — file under scripts/
  - [cli] `scripts/build-link-triage.py` — file under scripts/
  - [cli] `scripts/build-provenance.py` — file under scripts/

## 3. AI / Agent Design

**Prompts**: 490 detected
  By type: template (245), prompt (215), system (10), few-shot (20)
  Sample prompts:
  - [template] `skills/33-Galaxy-Dawn-claude-scholar/skills/zotero-obsidian-bridge/scripts/verify_paper_notes.py:32` FIELD_RE_TEMPLATE = r'^{}:\s*'...
  - [template] `skills/35-bahayonghang-academic-writing-skills/skills/latex-thesis-zh/scripts/detect_template.py:38` template_id = "ctexbook"...
  - [prompt] `skills/67-econfin-workflow-toolkit/skill-creator/eval-viewer/generate_review.py:87` prompt = ""...
  - [prompt] `skills/67-econfin-workflow-toolkit/skill-creator/eval-viewer/generate_review.py:117` prompt = "(No prompt found)"...
  - [prompt] `skills/67-econfin-workflow-toolkit/skill-creator/scripts/improve_description.py:79` prompt = f"""You are optimizing a skill description for a Claude Code skill called "{skill_name}". A "skill" is sort of ...

**Tools**: 154 detected
  By framework: script-tool (154)
  Sample tools:
  - [script-tool] `bayesian-workflow` — `skills/23-Learning-Bayesian-Statistics-baygent-skills/bayesian-workflow/main.py`
  - [script-tool] `context-monitor` — `skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/hooks/context-monitor.py`
  - [script-tool] `log-reminder` — `skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/hooks/log-reminder.py`
  - [script-tool] `post-compact-restore` — `skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/hooks/post-compact-restore.py`
  - [script-tool] `pre-compact` — `skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/hooks/pre-compact.py`
  - [script-tool] `verify-reminder` — `skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/hooks/verify-reminder.py`
  - [script-tool] `log-reminder` — `skills/14-luischanci-claude-code-research-starter/dot-claude/hooks/log-reminder.py`
  - [script-tool] `15-Felpix-Studios-social-science-research` — `skills/15-Felpix-Studios-social-science-research/hooks/post-compact-restore.py`

**Design archetype** (derived):
  - Tools/Prompts ratio: 0.3 → balanced prompt+tool design

## 4. Testing & Evaluation

**Testing**: 19 test files, 329 test functions
  Test/source ratio: 0.07 → ⚠ below typical 0.15 threshold
  Test patterns detected: benchmark, corpus
  Tests by module (top 5):
    - `benchmark`: 123 tests
    - `eval_scenarios`: 37 tests
    - `repo_tools`: 36 tests
    - `eval_checks`: 19 tests
    - `build_catalog`: 18 tests

**Evaluation**: Detected
  Eval files: 62
    - `benchmark/check_benchmark.py`
    - `benchmark/lib/badcontrol.py`
    - `benchmark/lib/bartik.py`
    - `benchmark/lib/bayesian.py`
    - `benchmark/lib/bunching.py`
  Metrics: score, precision, metric, accuracy, f1, recall, bleu, rouge, pass_rate
  Patterns: benchmark, dataset, score, eval, evaluation, judge, rubric, metric, accuracy, pass_rate, golden

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 268 |
| Import edges | 181 |
| Import cycles | 2 |
| Functions indexed | 2355 |
| Call relations | 26963 |
| Test files | 19 |
| Total commits | 208 |
| Contributors | 15 |

**Derived indicators**:
  - Coupling density: 0.68 edges/module
  - Cycle count: 2 — minor coupling issues
  - Call density: 11.4 calls/function
  - Commit intensity: 14 commits/contributor
  - CI: github-actions with 7 workflow(s)

**Architecture signal directories** (high structural importance):
  - `agents`
  - `benchmark`
  - `benchmark/candidates`
  - `benchmark/candidates/reference-badcontrol`
  - `benchmark/candidates/reference-bartik`
  - `benchmark/candidates/reference-bayesian`
  - `benchmark/candidates/reference-bunching`
  - `benchmark/candidates/reference-cate`
  - `benchmark/candidates/reference-did`
  - `benchmark/candidates/reference-dml`

## 5.5. Ontology View（对象视图）

> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。
> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。

### 对象类型分布

| 类型 | 数量 |
|------|------|
| function | 2177 |
| prompt | 244 |
| class | 178 |
| tool | 154 |
| evaluation | 115 |
| workflow | 21 |
| runner | 15 |
| planner | 11 |
| agent | 2 |

### 关系类型分布

| 关系 | 数量 |
|------|------|
| calls | 26963 |
| imports | 1479 |
| evaluatedBy | 115 |
| uses | 69 |

### 语义对象（非 function/class）

| 类型 | 名称 | 文件 | 属性 |
|------|------|------|------|
| prompt | template | skills/33-Galaxy-Dawn-claude-scholar/skills/zotero-obsidian-bridge/scripts/verify_paper_notes.py | promptType=template, variables=, line=32 |
| prompt | template | skills/35-bahayonghang-academic-writing-skills/skills/latex-thesis-zh/scripts/detect_template.py | promptType=template, variables=, line=38 |
| prompt | prompt | skills/67-econfin-workflow-toolkit/skill-creator/eval-viewer/generate_review.py | promptType=prompt, variables=, line=87 |
| prompt | prompt | skills/67-econfin-workflow-toolkit/skill-creator/scripts/improve_description.py | promptType=prompt, variables=, line=79 |
| prompt | prompt | skills/68-research-productivity-skills/skill-creator/eval-viewer/generate_review.py | promptType=prompt, variables=, line=87 |
| prompt | prompt | skills/68-research-productivity-skills/skill-creator/scripts/improve_description.py | promptType=prompt, variables=, line=79 |
| prompt | template | docs/en/09-replication-and-reproducible-research.md | promptType=template, variables=, line=119 |
| prompt | prompt | eval-harness/README.md | promptType=prompt, variables=, line=112 |
| prompt | template | skills/00-Full-empirical-analysis-skill_StatsPAI/README.md | promptType=template, variables=, line=84 |
| prompt | template | skills/00-Full-empirical-analysis-skill_StatsPAI/SKILL.md | promptType=template, variables=, line=124 |
| prompt | prompt | skills/02-luwill-research-skills/paper-slide-deck/SKILL.md | promptType=prompt, variables=, line=260 |
| prompt | template | skills/02-luwill-research-skills/research-proposal/SKILL.md | promptType=template, variables=, line=508 |
| prompt | template | skills/03-K-Dense-AI-claude-scientific-skills/literature-review/SKILL.md | promptType=template, variables=, line=217 |
| prompt | template | skills/04-K-Dense-AI-claude-scientific-writer/literature-review/SKILL.md | promptType=template, variables=, line=214 |
| prompt | template | skills/06-fuhaoda-stats-paper-writing/stat-writing/references/50-review-report.md | promptType=template, variables=, line=70 |
| prompt | prompt | skills/07-Orchestra-Research-AI-Research-SKILLs/academic-plotting/SKILL.md | promptType=prompt, variables=, line=211 |
| prompt | template | skills/07-Orchestra-Research-AI-Research-SKILLs/academic-plotting/references/style-guide.md | promptType=template, variables=, line=39 |
| prompt | template | skills/08-ndpvt-web-latex-document-skill/SKILL.md | promptType=template, variables=, line=115 |
| prompt | template | skills/09-meleantonio-awesome-econ-ai-stuff/README-original.md | promptType=template, variables=, line=120 |
| prompt | template | skills/11-James-Traina-compound-science/agents/workflow/reproducibility-auditor.md | promptType=template, variables=, line=276 |
| prompt | template | skills/11-James-Traina-compound-science/skills/bayesian-estimation/references/diagnostics-guide.md | promptType=template, variables=, line=151 |
| prompt | prompt | skills/11-James-Traina-compound-science/skills/slfg/references/orchestration-patterns.md | promptType=prompt, variables=, line=18 |
| prompt | template | skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/agents/domain-reviewer.md | promptType=template, variables=, line=9 |
| prompt | template | skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/rules/plan-first-workflow.md | promptType=template, variables=, line=43 |
| prompt | template | skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/rules/session-logging.md | promptType=template, variables=, line=4 |
| prompt | template | skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/skills/data-analysis/SKILL.md | promptType=template, variables=, line=87 |
| prompt | template | skills/14-luischanci-claude-code-research-starter/dot-claude/rules/session-logging.md | promptType=template, variables=, line=4 |
| prompt | template | skills/14-luischanci-claude-code-research-starter/dot-claude/skills/stata/packages/estout.md | promptType=template, variables=, line=493 |
| prompt | template | skills/14-luischanci-claude-code-research-starter/dot-claude/skills/stata/packages/tabout.md | promptType=template, variables=, line=340 |
| prompt | template | skills/15-Felpix-Studios-social-science-research/CLAUDE.md | promptType=template, variables=, line=285 |

### 问题驱动查询示例

> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）

**查询**: Agent 使用了哪些工具和 prompt？
  Agent(parse_agent_yaml) → uses → tool(50-brycewang-aer-skills), tool(50-brycewang-aer-skills), tool(50-brycewang-aer-skills), tool(50-brycewang-aer-skills), tool(50-brycewang-aer-skills), tool(50-brycewang-aer-skills), tool(50-brycewang-aer-skills)
  证据: skills/50-brycewang-aer-skills/scripts/validate_repo.py, skills/50-brycewang-aer-skills/scripts/install_skills.py, skills/50-brycewang-aer-skills/scripts/run_example_smoke.py, skills/50-brycewang-aer-skills/scripts/run_skillopt_gate.py, skills/50-brycewang-aer-skills/scripts/scaffold_project.py, skills/50-brycewang-aer-skills/scripts/skill_audit.py, skills/50-brycewang-aer-skills/scripts/validate_repo.py, skills/50-brycewang-aer-skills/scripts/verify_citations.py
**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？
  Prompt 对象: 244 个

> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），
> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 未找到 AI Agent 指令文件（AGENTS.md / CLAUDE.md 等）

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `scripts/toml_compat.py` | 120 | high in-degree (+40); high PageRank (+50); entrypoint (+30) |
| 2 | `skills/33-Galaxy-Dawn-claude-scholar/skills/obsidian-project-memory/scripts/project_kb.py` | 120 | high in-degree (+40); high PageRank (+50); entrypoint (+30) |
| 3 | `skills/35-bahayonghang-academic-writing-skills/skills/paper-audit/scripts/scholar_eval.py` | 120 | high in-degree (+40); high PageRank (+50); entrypoint (+30) |
| 4 | `README.md` | 90 | README (+50); important file (+40) |
| 5 | `benchmark/lib/lalonde.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `skills/35-bahayonghang-academic-writing-skills/skills/paper-audit/scripts/parsers.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `skills/50-brycewang-aer-skills/templates/python/setup.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 8 | `skills/67-econfin-workflow-toolkit/skill-creator/scripts/utils.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 9 | `tests/_helpers.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 10 | `skills/50-brycewang-aer-skills/examples/README.md` | 80 | README (+50); examples (+30) |
| 11 | `skills/50-brycewang-aer-skills/examples/few-clusters-demo/README.md` | 80 | README (+50); examples (+30) |
| 12 | `skills/50-brycewang-aer-skills/examples/iv-weak-instrument-demo/README.md` | 80 | README (+50); examples (+30) |
| 13 | `skills/50-brycewang-aer-skills/examples/multiple-testing-demo/README.md` | 80 | README (+50); examples (+30) |
| 14 | `skills/50-brycewang-aer-skills/examples/rdd-polynomial-demo/README.md` | 80 | README (+50); examples (+30) |
| 15 | `skills/50-brycewang-aer-skills/examples/replication-package-skeleton/README.md` | 80 | README (+50); examples (+30) |
| 16 | `skills/50-brycewang-aer-skills/examples/shift-share-demo/README.md` | 80 | README (+50); examples (+30) |
| 17 | `skills/50-brycewang-aer-skills/examples/staggered-did-demo/README.md` | 80 | README (+50); examples (+30) |
| 18 | `skills/50-brycewang-aer-skills/examples/synthetic-control-demo/README.md` | 80 | README (+50); examples (+30) |
| 19 | `docs/demos/README.md` | 70 | README (+50); docs (+20) |
| 20 | `docs/en/README.md` | 70 | README (+50); docs (+20) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `scripts/toml_compat.py` — high in-degree (+40); high PageRank (+50); entrypoint (+30)
2. `skills/33-Galaxy-Dawn-claude-scholar/skills/obsidian-project-memory/scripts/project_kb.py` — high in-degree (+40); high PageRank (+50); entrypoint (+30)
3. `skills/35-bahayonghang-academic-writing-skills/skills/paper-audit/scripts/scholar_eval.py` — high in-degree (+40); high PageRank (+50); entrypoint (+30)
4. `benchmark/lib/lalonde.py` — high in-degree (+40); high PageRank (+50)
5. `skills/35-bahayonghang-academic-writing-skills/skills/paper-audit/scripts/parsers.py` — high in-degree (+40); high PageRank (+50)

### 2 小时深入
继续阅读：

1. `skills/50-brycewang-aer-skills/templates/python/setup.py` — high in-degree (+40); high PageRank (+50)
2. `skills/67-econfin-workflow-toolkit/skill-creator/scripts/utils.py` — high in-degree (+40); high PageRank (+50)
3. `tests/_helpers.py` — high in-degree (+40); high PageRank (+50)
4. `skills/50-brycewang-aer-skills/examples/README.md` — README (+50); examples (+30)
5. `skills/50-brycewang-aer-skills/examples/few-clusters-demo/README.md` — README (+50); examples (+30)
6. `skills/50-brycewang-aer-skills/examples/iv-weak-instrument-demo/README.md` — README (+50); examples (+30)
7. `skills/50-brycewang-aer-skills/examples/multiple-testing-demo/README.md` — README (+50); examples (+30)
8. `skills/50-brycewang-aer-skills/examples/rdd-polynomial-demo/README.md` — README (+50); examples (+30)
9. `skills/50-brycewang-aer-skills/examples/replication-package-skeleton/README.md` — README (+50); examples (+30)
10. `skills/50-brycewang-aer-skills/examples/shift-share-demo/README.md` — README (+50); examples (+30)

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

你是一位经验丰富的软件架构师。基于上述证据，为 **Auto-Empirical-Research-Skills** 撰写一份工程研究报告。
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
