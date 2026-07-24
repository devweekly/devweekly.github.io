# Auto-Empirical Research Skills (AERS) — 工程研究报告

> **仓库**: [Auto-Empirical-Research-Skills](https://github.com/brycewang-stanford/Auto-Empirical-Research-Skills)（Stanford REAP × CoPaper.AI）
> **分析日期**: 2026-07-24
> **方法论**: Research Trace（Question → Evidence → Analysis → Counter Evidence → Conclusion → Confidence） + Ontology-driven Research（对象 + 关系）

---

## 1. 执行摘要

AERS 是一个面向**社会科学实证研究全流程**的 Claude/Codex 技能目录仓库：1,151 个 skill、70 个合集、9 阶段流水线（选题 → 综述 → 数据 → 识别 → 估计 → 稳健性 → 表图 → 写作 → 投稿）。它不是单一 Agent，而是一个 **skill catalog + root router** 架构——通过根 `SKILL.md` 路由器把用户请求分类，再加载单个子 skill 的 `SKILL.md`，避免一次性灌入 1,151 个 skill 触发 token 爆炸。

**最有趣的发现**：AERS 构建了一套**双层经验评估基础设施**——`benchmark/` 用真实数据集（LaLonde、Card IV、staggered DiD、RDD）的已知答案做数值回收测试，`eval-harness/` 用 rubric（机器可检 + 人工/LLM judge）做行为属性测试。两者都是 stdlib-only、零 `pip install`，并通过 CI 棘轮（ratchet）逐步抬高门槛（11 → 13 → 15 方法族；24+ 场景 / 116+ 自动检查）。这在"prompt-only skill"仓库中极为罕见——大多数同类项目只能靠"看起来对"判断质量。

**次要发现**：项目实际是 Bryce Wang 的个人项目（189/208 commits ≈ 91%），3.5 个月内迅速生长（2026-04-02 首提交 → 2026-07-20 末提交），但已建立 OpenSSF Scorecard、6 locale README、rigor-coverage badge、CHANGELOG 等"成年项目"基础设施。

---

## 2. Research Traces

### 2.1 核心架构：Skill Catalog + Root Router 模式

**问题**: 一个仓库 1,151 个 skill，如何避免 IDE 自动加载时 token 爆炸？

**证据**:
- `SKILL.md`（仓库根）的 frontmatter `description` 明确写道："Route empirical-research requests through the Auto-Empirical Research Skills catalog ... without reading the entire repository at once"（`SKILL.md:3`）
- `agents/README.md:30-37` 显式解释路由模式："The catalog ships 1,150+ skills. Most IDEs auto-load *every* `SKILL.md` they find, which would blow past token budgets the moment a chat opens ... The root `SKILL.md` does the routing: it classifies the user request and points at the one or two child SKILL.md files needed."
- `SKILL.md:14-21` 的 Workflow 定义 5 步：分类 → 加载单个 child SKILL.md → 必要时查 `catalog/skills.json` → 安装指南 → 子模块处理
- 简报 §5.5：Agent 对象 `parse_agent_yaml` 通过 `uses` 关系连接到 7 个 Tool 对象（`skills/50-brycewang-aer-skills/scripts/`）

**分析**: 对象图视角下，AERS 的核心抽象是 **Skill Object**（带 frontmatter 的 `SKILL.md`），Root Router 是一个特殊 Skill Object，通过 `orchestrates` 关系连接到 1,151 个 Child Skill Object。`agents/*.yaml` 是 5 个 Runtime Adapter 对象（OpenAI / Anthropic / Cursor / Aider / CodeBuddy），通过 `configuredBy` 关系把 Router 注册到不同 IDE。这是"目录即数据"模式——`catalog/skills.json` 是单一事实源，`build-catalog.py` 等脚本生成 derived view（enriched、provenance、audit）。

**反证**: `SKILL.md:80` 承认存在 92 个 bare `name` 冲突（如 `data-analysis`、`lit-review`），需要 `qualified_name`（`<collection>::<name>`）消歧。这说明 Router 模式并非完美——平铺注册会冲突。

**结论**: AERS 采用 **Skill Catalog + Root Router 模式**——通过分层加载控制 token 预算，用 `qualified_name` 解决命名冲突，把"1,151 个 skill"降维为"1 个路由 + 按需加载"。

**置信度**: 高 — Router 逻辑、agents/ 适配器、catalog JSON 三处证据交叉验证。

---

### 2.2 双层评估基础设施：Numeric Benchmark + Rubric Eval

**问题**: 对 prompt-only skill，如何建立"行为正确"的可验证证据？

**证据**:
- `benchmark/README.md:1-5`："A small, reproducible, dependency-free benchmark of empirical-research agent behavior. Where `eval-harness/` checks *properties of an agent's prose*, the benchmark checks *numbers*"
- `benchmark/README.md:9-26` LaLonde 任务：naive ATT = −$635（陷阱），regression-adjusted ATT = +$1,548，experimental benchmark ≈ +$1,794
- `eval-harness/README.md:1-5`："A lightweight, dependency-free evaluation harness for the flagship skills ... *do these skills make an agent produce correct, referee-proof empirical work — or just plausible-looking text?*"
- `eval-harness/README.md:28-44` Rubric 双类型：machine-checkable（无 API key）+ manual（emit judge prompt）。"deliberately a *necessary-not-sufficient* gate ... failing a required one proves it is wrong"
- 简报 §4：99 个 eval 文件，metrics 包括 score/precision/accuracy/f1/recall/bleu/rouge/pass_rate
- `.github/workflows/quality-evals.yml:47-51`：CI 跑 `benchmark/check_benchmark.py --strict --fail-on-partial --fail-on-orphan-results`

**分析**: 对象图视角下存在两个 Eval Object 类型：(1) `Benchmark` Object（17 个，每个绑定真实数据集 + 已知答案 + 陷阱）；(2) `Rubric` Object（37 场景 × 183 items，machine-checkable + manual）。Skill Object 通过 `evaluatedBy` 关系连接到这两个 Eval Object（简报 §5.5：evaluatedBy = 152）。设计哲学是**非对称验证**：通过不证明对，但失败证明错——这是廉价 CI 门控的最佳形态。Bench Object 数据集（LaLonde、Card、sim-staggered-did 等）是 `benchmark/data/*.csv`，每个都包含 `y0` 反事实列，让 checker 能重算真实值。

**反证**: Rubric 中的 `manual` 项仍需 LLM judge 或人工，无法纯 CI 自动判定。但 harness 设计为"emits a ready-to-paste judge prompt"——把人/LLM 介入成本降到最低。

**结论**: AERS 的**双层经验评估**是 prompt-skill 仓库中罕见的工程化质量基础设施——数值 benchmark 用真实数据钉死事实，rubric eval 用属性检查钉死行为，CI 棘轮强制覆盖率只升不降。

**置信度**: 高 — benchmark/eval-harness 两个 README、CI workflow、CHANGELOG 三处交叉验证。

---

### 2.3 CI 棘轮模式：覆盖率只升不降

**问题**: AERS 如何防止评估覆盖率随重构漂移下降？

**证据**:
- `.github/workflows/quality-evals.yml:37-42`：`run_evals.py --min-scenarios 24 --min-auto-checks 116 --expect-categories causal-identification,reproducibility,citation-hygiene,runtime-safety,research-integrity,writing-compliance,writing-style`
- `eval-harness/README.md:64-67`：`--min-scenarios 18 --min-auto-checks 86`（README 中的旧阈值）
- `CHANGELOG.md:34-48`：v2026.07 后扩展到 15 method families，"Eval/CI ratchet floors raised to lock in the coverage (28 scenarios / 132 auto-checks, 15 benchmark tasks)"
- `CHANGELOG.md:71-73`：v2026.07 时是 26 scenarios / 122 auto-checks / 13 benchmark tasks
- `scripts/build-coverage-map.py`、`docs/RIGOR_COVERAGE.md` 存在（简报 §2 entrypoints）

**分析**: 对象图视角下，CI Workflow Object 通过 `validates` 关系连接到 Eval Object 与 Benchmark Object。`--min-scenarios` / `--min-auto-checks` 是**单向棘轮**——只能上调。每次新增方法族（CATE/QTE/Bartik/mediation），CHANGELOG 显式记录新阈值。`--expect-categories` 强制类目完整性，防止"删场景来降低门槛"。`--fail-on-orphans --fail-on-partial` 防止结果与场景脱钩。这是教科书式的"覆盖率即资产"实践。

**反证**: 棘轮只能阻止下降，不能保证场景质量——理论上可加 10 个无意义场景把阈值抬到 34。但 `validate_root_skill_stats`（`scripts/validate-repo.py`）和 `build-coverage-map.py` 的 METHOD_ORDER 提供了类目交叉校验。

**结论**: AERS 用**CI 棘轮 + 类目完整性检查**锁定评估覆盖率，确保每一次方法族扩展都伴随 eval/benchmark 同步增长，且无回退空间。

**置信度**: 高 — workflow 文件、CHANGELOG、README 三处阈值数据可交叉验证演进轨迹。

---

### 2.4 Stdlib-only 兼容性策略：toml_compat.py 的设计智慧

**问题**: AERS 如何在 macOS 系统 Python 3.9 上无 `pip install` 跑通完整质量门？

**证据**:
- `scripts/toml_compat.py:1-15` 文档字符串："The repo's local gate also needs to run on the macOS system Python 3.9 without third-party dependencies, so this module falls back to a deliberately small parser for the TOML subset used by benchmark tasks and eval scenarios"
- `scripts/toml_compat.py:24-32`：try `tomllib` (3.11+) → try `tomli` → fallback `_loads_fallback`
- `.github/workflows/quality-evals.yml:21`：CI 矩阵 `python-version: ["3.9", "3.12"]`
- `benchmark/README.md:1-3`、`eval-harness/README.md:1-3` 均强调 "**dependency-free**"
- 简报 §7：`scripts/toml_compat.py` 排名第 1（in-degree +40，PageRank +50，entrypoint +30）

**分析**: 对象图视角下，`toml_compat` Module Object 通过 `imports` 关系被 `benchmark/check_benchmark.py`、`eval-harness/run_evals.py` 等多个 Tool Object 消费（这是其 in-degree 4 但 PageRank 极高的原因——它是基础工具层）。设计是**优雅降级**：优先用 stdlib（3.11+ 自带），次选用 `tomli`，最后用内置的 ~150 行小子集解析器（仅支持 `[[array_of_tables]]` + 基本类型，够覆盖 TOML task/scenario 文件）。这让 CI 在 Ubuntu 3.12 上跑原生 tomllib，在开发者 macOS 3.9 上跑 fallback，**零外部依赖**。

**反证**: 简报 §2 显示 `toml_compat` in-degree 只有 4，不像 `parsers`（in-degree 58）那样的 god module——这反而是好事，说明 fallback 解析器职责单一。

**结论**: `toml_compat.py` 是**优雅降级模式**的范本——用 ~150 行代码换得"零依赖 + 跨 Python 3.9/3.12 + macOS/Linux 一致运行"的特性，是 AERS 整个 stdlib-only 质量门的基石。

**置信度**: 高 — 源码、CI 矩阵、README 三处直接证据。

---

### 2.5 Submodule 与 Sync 双轨制：第一方 skill 的版本治理

**问题**: 7 个 ⭐ 旗舰 skill 与社区 skill 的版本更新机制有何不同？

**证据**:
- `SKILL.md:72`："`skills/69-Paper-WorkFlow/` is a **git submodule**. If its folder is empty, the copy or clone skipped submodules"
- `scripts/sync-statspai-skill.sh`、`scripts/sync-aer-skills.sh` 存在（简报 §2 entrypoints）
- `.github/workflows/sync-aer-skills.yml`、`sync-statspai-skill.yml` 两个 CI workflow
- `README.md:128-140`：7 个 Stanford REAP × CoPaper.AI 自研 skill（00/00.1/00.2/00.3/48/50/69）
- `.gitmodules` 文件存在（LS 顶层目录）

**分析**: 对象图视角下，第一方 Skill Object 与社区 Skill Object 的 `registeredBy` 关系不同：
- **Paper-WorkFlow**（69）= git submodule（独立 repo，主仓持有引用）
- **StatsPAI**（00）= 定期 `sync-statspai-skill.sh` 从 upstream 拉取（vendored but synced）
- **AER-skills**（50）= 同样通过 `sync-aer-skills.sh` 同步
- 其余 67 个合集 = 一次性 vendor，通过 `README-original.md` 保留上游痕迹

两种机制各有利弊：submodule 保持独立 git 历史但克隆需 `--recursive`；sync 脚本保持主仓自包含但需 CI 守护同步。AERS 同时用两种——submodule 给 Paper-WorkFlow（最复杂、最频繁演进），sync 脚本给 StatsPAI/AER-skills（稳定但需追上游）。

**反证**: 简报 §1 显示 `agentFiles: []`——没有把 submodule 视为 agent 文件。CHANGELOG 提到 2026-06-26 起 `validate-catalog` 因 Paper-WorkFlow demo gate 红了——submodule 模式确实带来过 CI 痛点。

**结论**: AERS 用 **submodule + sync 脚本双轨制** 治理第一方 skill：复杂演进的用 submodule（Paper-WorkFlow），稳定追上游的用 sync 脚本（StatsPAI、AER-skills），社区 skill 一次性 vendor。

**置信度**: 高 — `.gitmodules`、两个 sync workflow、两个 sync 脚本、`SKILL.md` 显式声明四处交叉验证。

---

### 2.6 Catalog 即数据：多视图派生模式

**问题**: 1,151 个 skill 的元数据如何管理与查询？

**证据**:
- `catalog/skills.json`（~1 MB / 20k 行，`SKILL.md:23`）
- `catalog/skills-enriched.json`（添加 tags、quality_score、license、commercial_use）
- `catalog/provenance.json`、`catalog/skill-audit.json`
- 5 个 `scripts/build-catalog*.py` 脚本：`build-catalog.py`、`build-catalog-enrich.py`、`build-provenance.py`、`build-skill-audit.py`、`build-coverage-map.py`
- `scripts/build-catalog.py:23-33`：`SkillEntry` dataclass 含 `name / description / path / collection / line_count / frontmatter_fields / has_frontmatter / has_name / has_description`
- `SKILL.md:23-29`：建议用 `python3 -c "..."` 或 `grep` 查询 catalog，**不要整读**

**分析**: 对象图视角下，Catalog 是一个 **Data Object**（不是 Code Object），通过 `produces` 关系被多个 Build Script Object 衍生出 4 个 View Object（skills / enriched / provenance / audit）。这是典型的"单一事实源 + 多派生视图"模式——`skills.json` 是 canonical，其余 view 通过确定性脚本生成。`build-coverage-map.py` 的 METHOD_ORDER 常量被 CHANGELOG 提及为 rigor-coverage badge 的源头，说明 view 之间有显式依赖。`scripts/build-catalog-enrich.py --check` 在 CI 中做 freshness 检查（`quality-evals.yml:31-32`），确保派生视图不漂移。

**反证**: 4 个 JSON 文件均为构建产物却提交到仓库——这违反了一般"不要 commit 生成物"的最佳实践。但 AERS 这样做是为了让 IDE 在不跑 build 的情况下也能直接读 catalog，是**读路径优化**的权衡。

**结论**: AERS 把 skill 元数据当作**数据资产**管理：单一事实源（`skills.json`）+ 4 个确定性派生视图 + CI freshness 检查，牺牲"不提交生成物"原则换取 IDE 即用性。

**置信度**: 高 — 5 个 build 脚本、4 个 catalog 文件、CI freshness 检查三处证据。

---

### 2.7 God Module 风险：parsers.py 的入度异常

**问题**: 简报显示 `parsers` 模块入度 58、PageRank 0.1878（全库最高），是否构成架构风险？

**证据**:
- 简报 §2：`skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.parsers`（in-degree 58，PageRank 0.1878）
- 简报 §2：`pdf_parser`（PageRank 0.1638）+ `scholar_eval`（PageRank 0.0177）+ `scoring_model`（PageRank 0.0170）同属 skill 35
- 简报 §2 检测到 2 个 import 循环，**全部在 skill 35 内部**：`parsers ↔ pdf_parser`、`scholar_eval ↔ scoring_model`
- 简报 §5.5：`skills.35-bahayonghang-academic-writing-skills.skills.paper-audit.scripts.literature_search`（in-degree 3）

**分析**: 对象图视角下，`parsers` Module Object 通过 `imports` 关系被 58 个 Module Object 依赖——这是典型的 God Module 信号。但需要注意：skill 35 是**vendored 第三方合集**（`bahayonghang-academic-writing-skills`，非 ⭐ 旗舰），其内部循环不影响第一方代码。简报 §5 的整体 edge/node ratio 0.68 仍属低耦合，因为 268 个模块中绝大多数是相互独立的 vendored skill。

**反证**: 没有证据表明第一方代码（`scripts/`、`benchmark/`、`eval-harness/`、`catalog/`）有循环依赖。`tests._helpers`（in-degree 17）和 `benchmark.lib.lalonde`（in-degree 10）的高入度是合理的——前者是测试工具，后者是 benchmark 共享数据加载器。

**结论**: `parsers` God Module 风险**局限于 vendored 第三方 skill 35**，不影响第一方架构。但若 skill 35 频繁更新，其循环依赖可能导致维护负担。

**置信度**: 中 — 入度/PageRank 数据确定，但"是否构成实际维护负担"需观察 skill 35 的更新频率。

---

## 3. Negative Findings

> 引用简报 §6 + 源码阅读发现。简报 §6 仅列"未找到 LICENSE"，但实际仓库根 LICENSE 存在（CC BY-SA 4.0），下面是更完整的"未找到"清单。

| 发现 | 为什么重要 |
|------|-----------|
| **简报 §6 称"未找到 LICENSE"，但 `LICENSE` 实际存在为 CC BY-SA 4.0** | 简报的 analyzer 可能未识别 CC-BY-SA 文本模式。这是简报的**事实错误**，应在引用时校正——AERS 有明确许可证，且要求衍生作品同协议共享 |
| **未找到传统单元测试框架（pytest/unittest 在 `tests/` 仅 19 文件 / 329 函数，test/source ratio 0.07）** | 简报 §4 显示低于 0.15 阈值。但 AERS 的"测试"主要在 `benchmark/`（123 tests）和 `eval-harness/`（37 scenarios），传统单元测试覆盖的是 catalog/scripts 工具链，而非 skill 本身——这是 prompt-skill 仓库的固有特性 |
| **未找到 LLM judge 的自动化实现** | `eval-harness/README.md:33-36` 明确 manual rubric 项"needs a human or an LLM judge"，但 harness 只"emits a ready-to-paste judge prompt"，不在 CI 内自动调 LLM。这意味着 manual 项仍是人工负担 |
| **未找到 prompt 版本控制或 A/B 测试机制** | 简报 §3 检测到 490 个 prompt，但无 prompt 版本化、无 A/B 框架。skill 的 `SKILL.md` 改动通过 git 跟踪，但无 prompt 级别的回归保护 |
| **未找到 Agent 沙箱或权限隔离** | `agents/*.yaml` 是部署清单，不是运行时沙箱。Skill 在 IDE 进程内执行，与 AERS 本身无关——但 README 强调"32 条 deny rule"（skill 17 DAAF）属于 prompt-level guardrail，非 OS-level 隔离 |
| **未找到对 vendored skill 的自动安全扫描** | `SECURITY-SCAN-REPORT.md` 存在，但 `sync-aer-skills.sh` / `sync-statspai-skill.sh` 同步上游时是否重跑扫描未在 CI 中显式声明 |
| **未找到第一方代码的 import 循环** | 简报 §2 的 2 个循环全在 skill 35（vendored），第一方 `scripts/`、`benchmark/`、`eval-harness/` 无循环——这是好事，但简报未显式区分 |

---

## 4. Architecture Smells

> 以下均为 **Potential**（潜在），非断言。

### 4.1 Potential God Module in Vendored Skill（潜在 God Module）

- **证据**: `skills/35-bahayonghang-academic-writing-skills/skills/paper-audit/scripts/parsers.py` 入度 58、PageRank 0.1878（简报 §2）
- **为什么是风险**: 58 个依赖方意味着对该模块的任何改动触发大面积级联。结合 `parsers ↔ pdf_parser` 循环（简报 §2），可能产生难以复现的导入顺序 bug
- **置信度**: 中 — 风险客观存在但局限于 vendored skill，第一方代码不受影响

### 4.2 Potential Catalog Drift（潜在 catalog 漂移）

- **证据**: 4 个 catalog JSON 是构建产物却提交到仓库（`skills.json` / `skills-enriched.json` / `provenance.json` / `skill-audit.json`）；`quality-evals.yml:31-32` 跑 `build-catalog-enrich.py --check` 做 freshness
- **为什么是风险**: 若 `--check` 失败被忽略或绕过，`skills.json` 与 `skills/` 实际内容会漂移，Router 路由到不存在的 skill
- **置信度**: 低 — CI 已显式 freshness 检查，且 `validate_root_skill_stats`（CHANGELOG Unreleased）交叉校验根 SKILL.md 的硬编码数字

### 4.3 Potential Submodule Fragility（潜在 submodule 脆弱性）

- **证据**: `skills/69-Paper-WorkFlow/` 是 git submodule（`SKILL.md:72`）；CHANGELOG 提到 2026-06-26 起 `validate-catalog` 因 Paper-WorkFlow demo gate 红了
- **为什么是风险**: submodule 克隆需 `--recursive`，IDE 安装时若忘记则 router 路由到空目录。`SKILL.md:72` 不得不显式 fallback 到 `skills/00.*`
- **置信度**: 中 — 历史已发生过 CI 红灯，但已有 fallback 兜底

### 4.4 Potential Bus Factor 1（潜在单点依赖）

- **证据**: Bryce Wang 个人贡献 189/208 commits（91%），其余 14 人共 19 commits（简报 §git：Bryce Wang 161 + brycew6m 19 + brycew6m 5 + Bryce Wang 2 + brycewang-stanford 2 + brycewang 1）
- **为什么是风险**: 项目 3.5 个月快速生长，但维护责任高度集中。Bryce 离开则项目停摆
- **置信度**: 高 — git history 直接可验证

### 4.5 Potential Naming Collision at Scale（潜在大规模命名冲突）

- **证据**: `SKILL.md:80`："the catalog contains 92 bare `name`s shared across collections (e.g. `data-analysis`, `lit-review`, `proofread`)"
- **为什么是风险**: 平铺注册到 IDE 时冲突，需用 `qualified_name`（`<collection>::<name>`）消歧，增加用户认知负担
- **置信度**: 中 — 冲突数量确定，但 IDE 实际行为因 runtime 而异

---

## 5. Interesting Decisions

### 5.1 Root SKILL.md 作为路由器，而非 skill 本身

- **决策**: 根 `SKILL.md` 不做实际工作，只做请求分类与子 skill 路由
- **为什么有趣**: 大多数 skill 仓库的根 SKILL.md 是"主入口"，承担实际功能。AERS 把它降级为 router，把 1,151 个 skill 的 token 成本从 O(N) 降到 O(1) + O(1)（router + 单个 child）
- **替代方案**: 让 IDE 递归发现所有 SKILL.md（README 明确反对："would blow past token budgets the moment a chat opens"）
- **权衡**: 牺牲了"IDE 自动发现全部能力"，换取"单次会话 token 可控"。需要 router 分类准确——这是 LLM 行为，无确定性保证

### 5.2 把生成产物（catalog JSON）提交到仓库

- **决策**: `catalog/*.json` 是 `scripts/build-catalog*.py` 的产物，但提交到 git
- **为什么有趣**: 违反"不要 commit 生成物"的常规最佳实践
- **替代方案**: CI 动态生成、不提交
- **权衡**: 牺牲 git 历史整洁度，换取 IDE 在不跑 build 的情况下直接读 catalog 的便利。对"catalog 即数据"模式合理

### 5.3 用 TOML 而非 YAML 写 benchmark/eval 配置

- **决策**: `benchmark/tasks/*.toml`、`eval-harness/scenarios/*.toml` 用 TOML；schema 用 JSON（`schema/scenario.schema.json`）
- **为什么有趣**: YAML 是 CI 配置事实标准；TOML 在 Python 生态外不常见。但 TOML 的 `[[array_of_tables]]` 比 YAML 的 list-of-dict 更显式
- **替代方案**: YAML 或 JSON
- **权衡**: TOML 强类型 + 多行字符串友好，但需 `toml_compat.py` 兼容 Python 3.9。YAML 反而无需兼容层但缩进敏感

### 5.4 双层 eval（benchmark + rubric）而非单层

- **决策**: 数值 benchmark（17 任务）+ rubric eval（37 场景）并行，且 `benchmark/README.md:1-5` 显式声明职责分离
- **为什么有趣**: 大多数项目只做一种。AERS 认为数值对错和 prose 属性是两个独立维度，需不同工具链
- **替代方案**: 合并为单一 eval 框架
- **权衡**: 维护两套基础设施成本高，但能覆盖"数字对"和"看起来对"两类失败模式

### 5.5 中文 README 内容迁出到 `docs/CONTENT_ZH.md`

- **决策**: `README.md:1-5` 宣布"中文版已迁出本文件"，根 README 只保留 banner + badges + 入口
- **为什么有趣**: 大多数中文项目把完整内容放 README.md。AERS 把 GitHub 默认渲染的 README 当 landing page，正文放 docs/
- **替代方案**: 多 README 文件并列（README.md / README.zh-CN.md）
- **权衡**: 减少 README 长度（提升 GitHub 浏览体验），但增加跳转成本。AERS 还有 6 个 locale README（en/zh-CN/zh-TW/ja/ko），P2.2 重构把中文唯一权威正文集中到 CONTENT_ZH.md

---

## 6. Repository Positioning

| 维度 | 当前成熟度 | 说明 |
|------|-----------|------|
| Planning | Emerging | Root Router 做 stage 分类，但无显式 planner agent；`skills/69-Paper-WorkFlow/` 做元编排 |
| Execution | Advanced | 1,151 个 skill 覆盖 9 阶段流水线；多 runtime 适配（Claude/Codex/Cursor/Aider/CodeBuddy） |
| Memory | Emerging | 无统一 memory 层；个别 skill（如 33 claude-scholar 的 obsidian-project-memory）有局部 memory |
| Evaluation | Unique | 双层 eval（numeric benchmark + rubric eval-harness）+ CI 棘轮，prompt-skill 仓库中罕见 |
| Guardrails | Common | DAAF（skill 17）的 32 条 deny rule；runtime-safety eval 场景；但无 OS-level 沙箱 |
| Prompt | Advanced | 490 个 prompt（template 245 / prompt 215 / system 10 / few-shot 20）；progressive disclosure 模式 |
| Tooling | Unique | Catalog 即数据 + 多视图派生 + stdlib-only 兼容层 + 5 个 build 脚本 |
| Observability | Common | OpenSSF Scorecard + 6 locale README rigor-stats gate；无分布式追踪 |

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|---------|
| Skill Catalog + Root Router | 根 SKILL.md 分类请求，加载单个 child skill | `SKILL.md` + `agents/README.md` | ✅ 通用 |
| Numeric Benchmark with Trap | 真实数据集 + 已知答案 + naive 陷阱（如 LaLonde −$635） | `benchmark/README.md` + `benchmark/tasks/*.toml` | ✅ 通用 |
| Rubric Eval（necessary-not-sufficient） | machine-checkable + manual 双类型；failing 证明错，passing 不证明对 | `eval-harness/README.md` + `eval-harness/lib/checks.py` | ✅ 通用 |
| CI Ratchet Floor | `--min-scenarios N --min-auto-checks M` 单向棘轮 | `.github/workflows/quality-evals.yml:37-42` | ✅ 通用 |
| Graceful TOML Fallback | `tomllib` → `tomli` → 自带小子集解析器 | `scripts/toml_compat.py` | ✅ 通用 |
| Catalog as Data | 单一事实源 + 多派生视图 + CI freshness 检查 | `catalog/skills.json` + `scripts/build-catalog*.py` | ✅ 通用 |
| Submodule + Sync 双轨制 | 复杂演进用 submodule，稳定追上游用 sync 脚本 | `skills/69-Paper-WorkFlow/` + `scripts/sync-*.sh` | ⚠ 需适配 |
| Method Family Coverage Map | METHOD_ORDER 常量 + rigor-coverage badge + CHANGELOG 锁定 | `scripts/build-coverage-map.py` + `docs/RIGOR_COVERAGE.md` | ✅ 通用 |
| Multi-runtime Adapter YAML | 一个 `agents/<vendor>.yaml` per IDE runtime | `agents/{openai,anthropic,cursor,aider,codebuddy}.yaml` | ✅ 通用 |
| Progressive Disclosure SKILL.md | frontmatter → body → references/ → scripts/ 渐进加载 | `SKILL.md:14-21` Workflow | ✅ 通用 |
| 6-locale README Consistency Gate | `check-readme-stats.py` 强制 6 个 locale README 数字一致 | `scripts/check-readme-stats.py` | ⚠ 需适配 |
| God Module in Vendored Skill（反模式） | 入度 58 + 2 个 import 循环 | `skills/35-.../paper-audit/scripts/parsers.py` | ❌ 应避免 |

---

## 8. Architecture Evolution

> 基于 Git 历史（208 commits，15 contributors，2026-04-02 → 2026-07-20，3.5 个月）

### 主要演进线索

- **2026-04-02 首提交**: subject "Initial release: Awesome Agent Skills for Empirical Research"——项目最初定位是 "Awesome list" 形态的 skill 合集
- **方法族棘轮扩张**（CHANGELOG）: 11 → 13（v2026.07，2026-07-02，加 CATE/QTE）→ 15（Unreleased，加 Bartik/mediation）。每次扩张伴随 CI ratchet 上调
- **catalog 元数据深化**: 从单一 `skills.json` 扩展到 4 个派生视图（enriched / provenance / audit / coverage-map），`build-coverage-map.py` 引入 METHOD_ORDER 常量
- **README P2.2 重构**: 中文正文从根 README 迁出到 `docs/CONTENT_ZH.md`，根 README 降级为 banner+badges+入口；同步产生 6 locale README 一致性 gate
- **rigor-coverage badge 上线**: `docs/badges/rigor-coverage.json` + shields.io endpoint，所有 6 个 locale README 同步嵌入
- **Router 加固**: Unreleased 版本添加 `validate_root_skill_stats` 校验根 SKILL.md 的硬编码数字（"N skills across M collections" / duplicate bare-name count / legacy-collections list）

### 历史决策痕迹

- `README-original.md` 在多个 vendored skill 子目录中保留——是上游 README 的"快照"，证明这些 skill 是一次性 vendor 而非持续 sync
- `scripts/toml_compat.py` 的存在本身是历史决策痕迹——若最初选 YAML 配置则无需兼容层；选 TOML 后被迫写 fallback
- `agents/` 目录从"agent 文件"被重新定义为"runtime 部署清单"（`agents/README.md:8-15` 的 "What this directory is — and what it is not"）——这是命名与含义的对齐修正
- 简报 §git 显示 `skills/` 目录 commits 高达 4036（远超总 208 commits），说明 vendored skill 内部 git history 通过 subtree merge 保留

---

## 9. Reading Guide

### 30 分钟速览（按洞察密度排序）

1. **`SKILL.md`**（仓库根）— Root Router 路由表与 Workflow 定义；理解 AERS 如何把 1,151 个 skill 降维为 O(1) 加载
2. **`README.md`** — 9 阶段流水线 + 74 合集总表；理解项目定位与旗舰 skill
3. **`benchmark/README.md`** — LaLonde/Card/DiD/RD 任务设计；理解"trap"模式的精妙
4. **`eval-harness/README.md`** — rubric necessary-not-sufficient 哲学；理解 prompt-skill 如何被评估
5. **`agents/README.md`** — 5 个 runtime 适配器 + Router 模式原理；理解多 IDE 部署

### 2 小时深入

6. **`scripts/toml_compat.py`** — 优雅降级范本；理解 stdlib-only CI 的基石
7. **`.github/workflows/quality-evals.yml`** — CI 棘轮实现；理解覆盖率如何被锁定
8. **`CHANGELOG.md`** — 演进轨迹；理解方法族扩张与 ratchet 节奏
9. **`skills/50-brycewang-aer-skills/`** — 旗舰 skill 内部结构（scripts/ + templates/ + skills/）；理解第一方 skill 的工程化标准
10. **`catalog/skills.json`**（用 `grep` 或 `python3 -c` 查询，**不要整读**） — Catalog 数据 schema；理解 skill 元数据模型
11. **`scripts/build-catalog.py`** — Catalog 生成逻辑；理解 `SkillEntry` dataclass 与确定性
12. **`benchmark/lib/lalonde.py`** — LaLonde benchmark 实现；理解数值回收测试代码
13. **`eval-harness/lib/checks.py`** — machine-checkable rubric 原语；理解哪些属性可自动检查
14. **`docs/RIGOR_COVERAGE.md`** — 15 方法族 × 3 层（taxonomy + eval + benchmark）覆盖矩阵
15. **`skills/00-Full-empirical-analysis-skill_StatsPAI/SKILL.md`** — 旗舰 StatsPAI skill；理解 `sp.causal(...)` 一行跑闭环的设计

---

## 10. Open Questions

| # | 问题 | 为什么重要 | 建议调查方法 |
|---|------|-----------|-------------|
| 1 | Root Router 的分类准确率如何？是否有回归测试？ | Router 是 LLM 驱动的请求分类，分类错误会路由到错误 skill。当前无 router-level eval | 设计 router 评测集：构造 N 个用户请求 + 期望 child skill，跑 router 分类，统计 accuracy/recall |
| 2 | `eval-harness` 的 `manual` rubric 项实际如何被 judge？人工还是 LLM？ | 37 场景 × 183 rubric items 中 manual 比例未明；若是人工，则 CI 不真正 enforce | 阅读 `eval-harness/run_evals.py` 的 `--grade` 逻辑，统计 manual 项数量，访谈维护者 |
| 3 | `skills/69-Paper-WorkFlow/` submodule 的"29/29 executable gates"是什么？ | CHANGELOG 提及"competitive-rigor layer (29/29 executable gates)"，但 submodule 内容未在简报中展开 | 进入 submodule 目录，读其 README 与 gate 定义 |
| 4 | 92 个 bare name 冲突在不同 IDE runtime 下的实际行为？ | `SKILL.md:80` 警告平铺注册冲突，但 5 个 runtime 的实际行为差异未文档化 | 在 Claude Code / Cursor / Codex 实测同名 skill 注册，观察 disambiguation 行为 |
| 5 | `skills.json` 的 `quality_score` 字段如何计算？ | `catalog/skills-enriched.json` 添加了 `quality_score`，但简报未展示其算法 | 阅读 `scripts/build-catalog-enrich.py`，追踪 quality_score 来源 |
| 6 | vendored skill 的"一次性 vendor"假设是否被破坏？ | `README-original.md` 暗示一次性快照，但 `sync-aer-skills.sh` 又暗示持续同步——哪些 skill 真正 sync、哪些只 vendor 一次？ | 对比 `catalog/provenance.json` 与 `git log skills/<collection>/` 历史 |
| 7 | Bryce Wang 之外的 14 个 contributor 的贡献分布？ | Bus factor 1 风险客观存在；了解其他 contributor 是否在核心代码（非 README/docs）有贡献 | `git log --format='%an' --author!='Bryce'` 按 path 分类统计 |

---

## 附录：证据引用

- **简报 §0**: 研究原则
- **简报 §1**: Executive Brief — 268 源文件、3037 .md、262 .py、208 commits、15 contributors
- **简报 §2**: Architecture Insights — 268 模块、181 边、2 循环、`parsers` 入度 58、PageRank 0.1878
- **简报 §3**: AI/Agent Design — 490 prompts、154 tools、balanced prompt+tool design
- **简报 §4**: Testing & Evaluation — 19 测试文件、329 测试函数、99 eval 文件、metrics 含 pass_rate
- **简报 §5**: Engineering Metrics — coupling density 0.68、call density 11.4、commit intensity 14
- **简报 §5.5**: Ontology View — 2177 function / 244 prompt / 178 class / 154 tool / 152 evaluation / 21 workflow / 15 runner / 11 planner / 2 agent
- **简报 §6**: Negative Findings — "未找到 LICENSE 文件"（与实际仓库 LICENSE 存在矛盾，已在 §3 校正）
- **简报 §7**: Reading Priority — `toml_compat.py` 排名第 1（120 分）
- **简报 §8**: Reading Guide — 30 分钟 / 2 小时阅读计划
- **简报 §9**: Research Plan — 7 个 high 置信度假设全部成立
- **源码**: `README.md`、`SKILL.md`、`LICENSE`、`CHANGELOG.md`、`scripts/toml_compat.py`、`benchmark/README.md`、`eval-harness/README.md`、`agents/README.md`、`.github/workflows/quality-evals.yml`、`.github/workflows/scorecard.yml`、`scripts/build-catalog.py`
- **简报 §git**: Bryce Wang 161+19+5+2+1+1=189 commits（91%）；首提交 2026-04-02；末提交 2026-07-20
