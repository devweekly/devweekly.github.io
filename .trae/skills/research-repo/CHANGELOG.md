# CHANGELOG.md — research-repo 演进历史

> 本文档记录 research-repo skill 的版本演进。Breaking Change 和重大功能变更记录在此。

---

## 2026-07-27 — 文档职责分离

### Breaking Change
- **SKILL.md 重写**：从 1043 行重写为 878 行，删除所有 "v3 相对 v2"、"t.md 第X建议"、"v3 新增" 等演进历史和设计理由。SKILL.md 现在只包含 Workflow / Output / Constraints / Rules。
- **新增 DESIGN.md**：15 条设计决策的理由（Why Opponent / Why Bayesian / Why Ontology / Why Evidence Graph 等）从 SKILL.md 迁移到 DESIGN.md。
- **新增 CHANGELOG.md**：版本演进历史从 SKILL.md 迁移到本文档。

### 理由
Skill 应该像"操作系统"而不是"论文"——它应该描述**当前规范**（What to do），而不是**演化历史**（How it evolved）或**设计讨论**（Why we changed it）。Agent 不会因为看到"这是 v3"就做得更好，它真正需要的是"每个 Finding 必须包含 Counter Evidence"这样的可执行规则。

---

## 2026-07-27 — 模块化拆分

### Breaking Change
- `research-repo.mjs`（10,900 行 / 449KB）拆分为 12 个聚焦模块：
  - `config.mjs` (290 行) — 配置常量
  - `utils.mjs` (1,616 行) — 共享工具
  - `context.mjs` (236 行) — RepositoryContext
  - `base-analyzer.mjs` (41 行) — BaseAnalyzer
  - `analyzers-fact.mjs` (1,940 行) — 11 个 Fact Extractor
  - `analyzers-inference.mjs` (2,495 行) — 11 个 Inference Engine
  - `evidence-store.mjs` (783 行) — EvidenceStore + ObjectClassifier + RelationshipBuilder
  - `research-engine.mjs` (1,753 行) — ResearchPlanner + QuestionGenerator + FindingsGenerator + VerificationLoop + EvidenceSynthesizer
  - `report-generator.mjs` (1,612 行) — ReportGenerator
  - `pipeline.mjs` (280 行) — AnalyzerPipeline + ANALYZERS
  - `research-repo.mjs` (359 行) — CLI 入口
  - `subagent-prompts.mjs` (749 行) — 未改动

### Bug 修复
- 6 个缺失导入 bug 在端到端测试中发现并修复（utils.mjs 语法错误、context.mjs 类闭合、analyzers-fact.mjs 缺 ARCHITECTURE_SIGNAL_DIRS/countByExtension/PROJECT_DISCOVERY_RULES、analyzers-inference.mjs 缺 isTestPath/pathToModuleId/git、evidence-store.mjs 缺 isTestPath）

---

## 2026-07-27 — 中文优先

### Breaking Change
- `subagent-prompts.mjs` 移除英文（en）语言分支，从 1432 行缩减到 750 行。`subagent-prompts` 命令始终生成中文 prompt。
- `lang` 参数从所有 factory 函数和 `writeSubagentPrompts` 中移除。
- `--lang` 标志仍为 `report`/`all` 命令解析（evidence-brief 仍支持双语）。

---

## 2026-07-27 — t.md 13 条建议实施

### 新增
- **§3 Engineering Decisions**：报告新增 Engineering Decisions 章节（Palantir 风格 Decision Report），每个 Decision 包含 Decision/Why/Evidence/Tradeoff/Alternative/Status/Learning。
- **§6 Architecture Fitness**：报告新增 Architecture Fitness 章节，按 7 维评分（Modularity/Extensibility/Testability/Observability/Evolution/Performance/Developer Experience）。
- **§7 Architecture Compression**：报告新增 Architecture Compression 章节，300/100/30 字三级摘要。
- **§10 What NOT to Learn**：报告新增 What NOT to Learn 章节，区分"值得学"和"不要抄"。
- 报告从 10 章扩展为 13 章，定位从 "Architecture Report" 升级为 "Decision Report"。

### 已有（确认实施）
- 00-question-planner 已有 5 维打分（Impact/Novelty/Evidence Rich/Transferable/Controversial）
- 01-hypothesis 已有 Competing Hypothesis 字段
- 02-ontology 已有 Decision Ontology（Decision/Policy/Constraint/Observation/Resolution）
- 07-report-writer Research Trace 格式已有 Investigation/Turning Point/Resolution
- Finding 结构已分离 Importance 与 Confidence

---

## 2026-07-27 — v3 Pipeline

### 新增
- **动态 Research Question Planner**（Stage 0）：替代固定 RQ 模板。不同项目产生不同的问题。
- **Bayesian Hypothesis**（Stage 1）：假设包含置信度演进历史（Prior → Posterior）。
- **Behavior Ontology**（Stage 2）：Ontology 包含静态对象 + Execution Graph + Decision Ontology。
- **Opponent Agent**（Stage 4）：对每个 Finding 进行攻击。
- **Evidence Graph**（Stage 5）：统一证据关系图。
- **Research Trace 格式**（Stage 7）：Question → Investigation → Turning Point → Resolution。
- **Importance 与 Confidence 分离**：Finding 结构增加 Importance 字段。
- **Anti-Fabrication Constraints**：7 条反伪造约束防止 LLM 伪造 Finding 引用。
- **多阶段 LLM Subagent 工作流**：7 个 Stage 的 subagent 派发。

### 移除
- `research-repo.mjs` 中的 `_llmPrompt()` 方法（617 行 v2 Phase 1-5 LLM 指令）——与 v3 多 subagent 工作流冲突。
- evidence-brief.md 中的 LLM 指令——v3 LLM 指令由 `subagents/*.md` 提供。

---

## 2026-07-25 — Architecture Knowledge Layer

### 新增
- **DecisionAnalyzer**：6 类决策（structural/modular/capability/integration/quality/negative）。
- **ConstraintAnalyzer**：5 类约束源（manifest/code/config/pattern/entrypoint）。
- **AssumptionAnalyzer**：7 类假设（availability/input/runtime/storage/memory/network/determinism）。
- 新增 Research Questions Q9（决策）/ Q10（约束）/ Q11（假设）。

---

## 2026-07-26 — Evidence Quality Layer

### 新增
- **ConsistencyAnalyzer**：6 条跨分析器规则（C1-C4 矛盾，C5-C6 警告）。
- **EvidenceMeta**：4 个推理引擎的 `_meta` 块（source/strength/assumptions/limitations/possibleFalsePositives/checkedLocations/coverage）。

---

## 2026-07-26 — v2 Pipeline

### 新增
- **FindingsGenerator**：8 个标准研究问题（Q1-Q8），每个 Finding 绑定到一个 Question。
- **VerificationLoop**：3 条验证规则（V1 降级 / V2 拒绝 / V3 负面验证）。
- **4 阶段 LLM Pipeline**：Planning → Validation → Reasoning → Reporting。

---

## 2026-07-25 — 报告质量优化

### 新增
- §0 研究原则：Trace density over coverage + 统一 Confidence 标准。
- Research Trace 格式：Importance / Fact vs Interpretation / Why-it-matters / 4 级 Confidence。
- Executive Summary 压缩为 Identity / Key Discovery / Recommendation（3 句话）。
- Research Traces 上限 5 条（从 5-8 条压缩）。

---

## 2026-07-25 — Anti-Fabrication Layer

### 新增
- LLM Prompt 新增 7 条反伪造约束（ID 完整性 / 置信度逐字引用 / 状态不得反转 / 数字完整性 / 内容不得伪造 / 先引用再批判 / 矛盾双向检查）。
- ArchitecturePatternAnalyzer：Java Eclipse plugin packaging guard。
- EvaluationsAnalyzer：isTestPath() + bundle/minified 文件过滤。
- CHANGELOG 检测：扩展前缀（changes./history./news./releases./whatsnew.）。

---

## 2026-07-25 — 5 仓库审计驱动修复

### Bug 修复
- ResponsibilityAnalyzer：符号匹配从 substring 改为 CamelCase token-prefix。
- ResponsibilityAnalyzer：min score 从 >0 改为 ≥2。
- ArchitecturePatternAnalyzer：dir-signal 匹配从 substring 改为 path-segment exact match。
- CapabilityOntologyAnalyzer：AI-context gate + Tool 检测精度。
- LLM_NAME_RE：收紧到 provider names only。

---

## 2026-07-25 — 架构语义层

### 新增
- 7 个推理分析器：Pattern / Responsibility / Stability A/I / ChangeCoupling / InformationFlow / DependencySmell / CapabilityOntology。

---

## 2026-07-25 — Java/JVM 支持

### 新增
- pom.xml / build.gradle 解析。
- Java imports AST+regex。
- .java module ID normalization。

---

## 2026-07-22 — AST 分析器管道

### 新增
- web-tree-sitter / tree-sitter-wasms / graphology 核心依赖。
- Semantic Index（symbols 命令）。
- 11 个 Fact Extractor 分析器。
