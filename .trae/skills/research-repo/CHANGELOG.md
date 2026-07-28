# CHANGELOG.md — research-repo 演进历史

> 本文档记录 research-repo skill 的版本演进。Breaking Change 和重大功能变更记录在此。

---

## 2026-07-29 — Pipeline v2：Knowledge Graph + Semantic Findings + Fingerprint

### 核心升级：4 层分层推理 Pipeline

从 `Evidence → LLM(1 call) → Report` 升级为 **3 层 LLM + 1 层规则生成** 的分层推理：

```
Mechanical Evidence (事实层)
    ↓
Knowledge Graph (事实层 — Entity/Relationship/Attributes)
    ↓ Stage 1: Knowledge Modeling (LLM call 1)
Semantic Findings (解释层 — 统一 Finding 对象)
    ↓ Stage 2: Interpretation (LLM call 2)
Repository Fingerprint (浓缩层 — 规则生成，无 LLM)
    ↓ Stage 3: buildFingerprint() (规则)
Narrative Report (展示层 — 只是 Renderer)
    ↓ Stage 4: Narrative (LLM call 3)
```

### 四种核心数据结构

1. **Knowledge Graph (KG)** — 事实层，只描述 Entity/Relationship/Attributes/Evolution，不掺杂评价。Entity 使用 capability 名（如 "LLM Integration"），不使用 package 路径。
2. **Semantic Findings** — 解释层，统一采用 `Finding` 对象，通过 `type` 字段区分（constraint / decision / tension / omission / leverage / mental_model）。所有 Finding 必须引用 KG 实体。
3. **Repository Fingerprint** — 浓缩层，由 `buildFingerprint(kg, findings)` 规则生成，不单独消耗 LLM。包含 7 个字段（style/architecture/evolution/domain/maturity/complexity/engineering_taste）。
4. **EvidenceRef** — 统一证据引用格式（id / kind / path / symbol / commit / excerpt / score），替代旧的 `{source, detail}` 异构格式。

### 关键设计决策

- **Leverage 不在 KG 中** — Leverage 是评估，不是事实，移到 Semantic Findings 的 `type: "leverage"` Finding
- **Evolution 降级为 KG metadata** — 不是顶级 entity，是图的元信息
- **Intent 合并到 Decision** — 不单独 Schema，Intent 是 Decision 的字段（`intent` + `time_horizon`）
- **Mental Model 输出 concepts 而非 layers** — `{concept, owns, responsibility, boundary}` 结构
- **统一 Finding 对象** — 新增 Security / Performance / Reliability 只需新增一种 Finding type
- **Finding 引用 KG** — `entity_refs` / `relationship_refs` 让 Finding 关联到 KG 实体，形成知识图谱
- **Fingerprint 不单独 LLM** — `engineering_taste` 在 Interpretation stage 顺带生成，其余字段规则计算
- **Schema 带 version** — 避免 future 升级时所有 prompt 一起坏掉

### 新增文件

- `schemas.mjs` — 4 种核心数据结构定义 + 验证函数（`validateKG` / `validateFindings` / `validateFingerprint` / `validateEvidenceRef`）
- `prompts/01-modeling.md` — Knowledge Modeling prompt（Capability Graph 建模，禁止推断意图）
- `prompts/02-interpretation.md` — Interpretation prompt（6 种 Finding 类型，允许推断意图，必须基于 KG）
- `__tests__/schemas.test.mjs` — 36 个 schema 验证测试
- `__tests__/fingerprint.test.mjs` — 22 个 buildFingerprint 规则生成测试
- `__tests__/pipeline-stages.test.mjs` — 12 个 stage runner 测试（mock LLM）

### 修改文件

- `hybrid-pipeline.mjs` — 新增 `discoverDocuments()` / `runModelingStage()` / `runInterpretationStage()` / `buildFingerprint()` / `runNarrativeStage()` / `runPipelineV2()`
- `research-repo.mjs` — 新增 `pipeline-v2` / `modeling` / `interpretation` / `fingerprint` CLI 命令；修复 `hybrid` / `hybrid-json` 命令支持 `outputDir` 参数
- `prompts/07-report-writer.md` — 完全重写，从 13 章节固定模板改为基于 KG + Findings + Fingerprint 的 12 章节叙事结构；删除所有对已删除章节/文件的引用

### Document Discovery

新增 `discoverDocuments(repoPath)` 函数，按优先级搜索设计文档：
1. `adr/` / `docs/adr/` — Architecture Decision Records（priority 1）
2. `rfc/` / `docs/rfc/` — Request for Comments（priority 2）
3. `architecture.md` / `docs/architecture.md` — 架构文档（priority 3）
4. `docs/design/` — 设计文档目录（priority 4）
5. `README.md` — 最后才看 README（priority 5）

### CLI 新命令

```bash
# Pipeline v2（4-stage 全流程）
node research-repo.mjs pipeline-v2 <repoPath> [outputDir] [--model=...] [--stage=all|modeling|interpretation|fingerprint]

# 单独运行某个 stage
node research-repo.mjs modeling <repoPath>          # Stage 1: Knowledge Graph
node research-repo.mjs interpretation <repoPath>    # Stage 2: Semantic Findings
node research-repo.mjs fingerprint <repoPath>       # Stage 3: Fingerprint (规则生成)

# Hybrid 命令支持 outputDir
node research-repo.mjs hybrid <repoPath> [outputDir]  # 写入 report.md + evidence-brief.json
```

### 测试

- `pnpm test`：153/153 通过（原 69 + 新增 84）
- `pnpm test:skill`：185/185 通过（6 层全通过 0 回归）

---

## 2026-07-29 — DeepSeek V4 Flash Free 默认模型 + 语义代码精简

### 默认模型
- 将默认 LLM 从 `gpt-5` 统一切换为 `opencode/deepseek-v4-flash-free`。
- 更新位置：`llm-runner.mjs` 的 `DEFAULT_LLM_OPTIONS.model`、`hybrid-pipeline.mjs` 的 `DEFAULT_HYBRID_OPTIONS.model`、`research-repo.mjs` 的 `hybrid` / `hybrid-json` 命令默认值。
- `hybrid` 命令 usage 提示同步显示默认模型名称。

### 代码精简
- **删除语义分析器**：从 `analyzers-inference.mjs` 移除 `ArchitecturePatternAnalyzer`、`ResponsibilityAnalyzer`、`CapabilityOntologyAnalyzer`、`DecisionAnalyzer`、`ConstraintAnalyzer`、`AssumptionAnalyzer`、`DesignPatternAnalyzer`、`ConsistencyAnalyzer`。
- **删除已废弃平台/引擎模块**：`brain.mjs`、`knowledge-base.mjs`、`research-engine.mjs`、`report-generator.mjs`。
- **删除旧 subagent prompt 模板**：`00-question-planner.md`、`01-hypothesis.md`、`02-ontology.md`、`03-research-agent.md`、`04-opponent.md`、`05-cross-validation.md`、`06-comparative.md`、`08-knowledge-extraction.md`、`09-brain-update.md`；仅保留 `07-report-writer.md` 作为 Hybrid Pipeline 的 report prompt。
- **简化 CLI 入口**：`research-repo.mjs` 移除 Brain 相关命令（`brain-init` / `brain-brief` / `brain-query` / `brain-summary` / `brain-update`）和 `ResearchPlanner` / `ReportGenerator` 导入；新增轻量 `renderMarkdownBrief()` 直接渲染机械证据摘要。
- **精简配置**：`config.mjs` 移除 Brain 相关常量（`BRAIN_DIR`、`KNOWLEDGE_TYPES`、`CONFIDENCE_INCREMENT` 等）。

### 测试修复
- 更新 `skill-test` 测试套件，使其适配新的机械分析器输出：
  - `new-analyzers.test.mjs`：移除 `DesignPatternAnalyzer` / `DecisionAnalyzer` 测试，新增 `StabilityAnalyzer`、`ArchitectureMetricsAnalyzer`、`TemporalAnalyzer` 机械分析器测试。
  - `lifecycle.test.mjs`：验证机械证据存储结构，不再检查语义输出（`findings` / `decisions`）。
  - `archetype-behavior.test.mjs`：改为验证不同 archetype 的机械信号差异。
  - `analyzer-runner.mjs`：质量指标从语义指标（`evidenceDensity`、`decisionQuality`）切换为机械指标（`cycleCount`、`smellCount`、`couplingDensity`、`avgInstability`）。
  - `pipeline-e2e.test.mjs` / `generate-golden.mjs`：生成的 deterministic report 补齐 `Top Claims` 与 `Quality Gate` 章节。
  - `verify-directory.mjs`：移除对已删除的 `designPatterns` key 的强制检查。
- 重新生成 `baseline-metrics.json` 与 4 个 Golden fixtures。

### 额外修复（测试收尾）
- 删除过时的 LLM-driven 示例 fixtures：`ai-agent-research`、`database-research`（代表已移除的 10-stage 旧流程，无法复现）。
- 修复 `run-e2e-live.mjs`：无参数时默认使用 synthetic agent repo；deterministic report stub 至少生成 2 个 Claims；不再把 archetype 误判为 "Unknown"。

### ref-only 真实仓库验证与修复
- 对 `ref-only/` 下全部 23 个真实仓库运行 mechanical analyzer。
- 发现 `code-review-graph` 和 `open-design` 因 graphology 重复节点 ID 崩溃：`Graph.addNode: the "..." node already exist in the graph`。
- 修复 `analyzers-inference.mjs` 的 `buildArchGraph()`：添加节点前检查 `graph.hasNode(n.id)`，对 ArchitectureAnalyzer 可能产生的重复 module id 进行去重。
- 验证：全部 23 个 ref-only 仓库 `all` 命令通过。

### 证据摘要格式
- `renderMarkdownBrief()` 输出包含 `Archetype Hints`、`Key Evidence`、`Design Decisions`、`Symbols`、`Architecture Graph`、`Structural Metrics`、`Limits` 等章节，满足 E2E stage checks 与 verify 要求。

### 测试结果
- `pnpm test`: 69/69 通过。
- `pnpm test:skill`: 180/180 通过（UNIT 45 / PROMPT 3 / BEHAVIOR 25 / MUTATION 16 / REGRESSION 68 / E2E 23）。
- `pnpm test:e2e`: 112/112 stage checks 通过（4 个 golden fixtures）。
- `pnpm test:e2e:live`: 通过（默认 synthetic agent repo）。

### 文档更新
- `CHANGELOG.md` 新增本条目。
- `DESIGN.md` 新增 §34（默认模型选择）与 §35（代码精简与职责边界）。
- `AGENTS.md` Maintenance Log 追加本次变更。

---

## 2026-07-28（续 2）— Hybrid Architecture（Script Mechanical Truth + LLM Semantic Truth）

### 新增功能

#### Hybrid Pipeline（Script 不思考，LLM 不算指标）
- 新增 `llm-runner.mjs`（183 行）：基于 research-cli.js 的统一 LLM 调用入口。
  - `detectCLI()` 自动检测 OpenCode CLI → Copilot CLI 降级。
  - `invokeLLM(prompt, options)` 支持系统提示 + JSON 模式 + 环境变量覆盖。
  - `invokeLLMJSON(prompt, options)` 自动解析 JSON 响应，剥离 markdown 代码块。
  - `renderPrompt(template, vars)` 模板占位符替换。
  - 支持 `RESEARCH_REPO_LLM_CMD` 环境变量用于测试（无需真实 CLI）。
- 新增 `hybrid-pipeline.mjs`（480 行）：Hybrid Pipeline 编排器。
  - `runHybridPipeline(repoPath, options)` 端到端流程：Mechanical Analyzers → JSON Evidence Brief → Skill Prompt → LLM → Report。
  - `MECHANICAL_ANALYZER_NAMES`（17 个分析器）：保留事实提取器 + 图算法 + git 历史。
  - 跳过 8 个 Semantic Analyzers（ArchitecturePattern/Responsibility/CapabilityOntology/Decision/Constraint/Assumption/DesignPattern/Consistency），由 LLM 替代。
  - `buildJSONEvidenceBrief()` 输出 14 个结构化事实章节（repository/files/symbols/architecture/entrypoints/prompts/tools/tests/evaluations/git/ci/dependencySmell/archMetrics/archetypeHints）。
  - 与现有 Script-heavy Pipeline 并存，不替换。

#### CLI 新增命令
- `hybrid <repoPath>` — Hybrid Pipeline（Markdown 输出）
- `hybrid-json <repoPath>` — Hybrid Pipeline（JSON 输出）
- `hybrid-analyzers` — 查看 Mechanical/Semantic 分析器分类
- Flags: `--skill=<prompt-file>` / `--model=<model>` / `--format=<markdown|json>` / `--brief=<true|false>`

#### 测试新增
- `__tests__/hybrid-pipeline.test.mjs`（220 行）：24 个测试。
  - llm-runner（8 个）：options / invoke / jsonMode / systemPrompt / fence-stripping / error-handling / renderPrompt。
  - 分析器分类（5 个）：17 mechanical / 8 semantic / 25 total / 无重叠 / defaults。
  - 端到端 Pipeline（11 个）：4 archetypes / evidence brief sections / archetype hints / dependency smell / arch metrics / repoName / JSON output。
  - 全部通过，使用 `cat` 作为 mock LLM（无需真实 OpenCode CLI）。

### 架构原则（来自用户反馈）
> "Script 不负责思考。Script 负责 Mechanical Truth。LLM 负责 Semantic Truth。"
> "Analyzer 不要直接输出 Markdown。而输出 Knowledge Graph (Entity / Relationship / Evidence)。最后 Report Generator 再渲染。"
> "让 OpenCode 替代所有需要自然语言推理的代码。"

### 职责划分
| 功能 | Script (Mechanical) | LLM (Semantic) |
|------|---------------------|----------------|
| AST / Import Graph / Call Graph | ✅ | ❌ |
| Metrics (Fan-in/Fan-out/Coupling) | ✅ | ❌ |
| Evidence Extraction (file/line/symbol) | ✅ | ❌ |
| Repository Index / File Ranking | ✅ | ❌ |
| Pattern Detection (Plugin/Layered/EDA) | ❌ | ✅ |
| Responsibility Analysis | ❌ | ✅ |
| Decision/Constraint/Assumption | ❌ | ✅ |
| Trade-off Analysis | ❌ | ✅ |
| Consistency/Contradiction Detection | ❌ | ✅ |
| Final Report Generation | ❌ | ✅ |

### 真实 OpenCode CLI 验证（2026-07-28 后续修复）
- 使用 `opencode/deepseek-v4-flash-free` 免费模型真实跑通 Hybrid Pipeline。
- 修复 4 个真实 CLI 问题：
  1. `llm-runner.mjs`: OpenCode CLI 参数修正——`--json` 改为 `--format json`；模型格式支持 `provider/model`（如 `opencode/deepseek-v4-flash-free`）。
  2. `llm-runner.mjs`: 修复 `aggregateOpenCodeOutput()` 解析 OpenCode v1.18+ 真实事件格式 `{ type: "text", part: { text: "..." } }`（之前只处理了旧版 `event.content`）。
  3. `llm-runner.mjs`: 修复 `run()` 处理长 prompt 的 stdin backpressure（监听 `drain` 事件再 `end()`）。
  4. `hybrid-pipeline.mjs`: 在 LLM 输入顶部注入 anti-tool 系统指令（`DO NOT use any tools...`），阻止 OpenCode CLI 默认 Agent mode 调用 glob/search 等工具（真实运行时因 prompt 提到文件路径而触发工具调用，导致返回空文本）。
- 真实运行输出：在 synthetic agent repo 上生成 7735 字符报告，包含 Overview / Philosophy / Architecture / Decisions / Trade-offs / Risks / Recommendations / Lessons 叙事流。

### 测试结果
- `pnpm test`: 79/79 通过（原 55，新增 24 个 hybrid-pipeline 测试）。
- `pnpm test:skill`: 239/239 通过（6 层全通过，0 回归）。

### 文档更新
- DESIGN.md 新增 §33（Hybrid Architecture）。
- CHANGELOG.md 新增本条目。

---

## 2026-07-28（续）— Negative Evidence + Core Ontology + Research Coverage + Report Narrative

### 新增功能

#### Negative Evidence (C9) + Contradiction Detection (C10)
- ConsistencyAnalyzer 新增 C9 规则：对检测到的架构模式（Plugin/Microservices/Layered/Event-Driven）主动搜索反证信号（循环依赖、层违规、高耦合密度、God Module、同步调用链）。
- ConsistencyAnalyzer 新增 C10 规则：检测互斥架构模式对（Monolith vs Microservices / Layered vs Event-Driven / MVC vs Event-Driven / Plugin vs Monolith），生成 "Competing Interpretations" 矛盾。
- C9 矛盾记录包含 `counterEvidence` 数组（signal / detail / impact 三字段）。
- 报告撰写 prompt 强制处理 C9/C10：C9 → "Confidence reduced" + 反证引用；C10 → "Competing Interpretations" + 双方案证据。

#### Core Ontology（8 核心类型 + 8 统一关系动词）
- 新增 `CORE_ONTOLOGY_TYPES`：Entity / Module / API / Capability / Concept / Artifact / Decision / Pattern。
- 新增 `CORE_RELATIONSHIP_TYPES`：implements / depends_on / owns / creates / uses / contains / exposes / replaces。
- 新增 `toCoreType()` / `toCoreRelationship()` 多对一投影函数，将实现层类型（agent/planner/runner/tool 等）投影到 8 核心类型。
- 新增 `projectToCoreTypeDistribution()` / `projectToCoreRelDistribution()` 分布统计函数。
- 报告新增 `_coreOntologyView()` 章节（§5.5b），展示核心类型分布 + 关系分布 + 渲染就绪说明。
- 设计原则：实现层类型继续保留（分析器零改动），Core Ontology 是渲染层投影。这是迈向 "Analyzer 输出 Knowledge Graph" 的第一步——未来可生成 Mermaid 图、HTML 交互式图谱、Neo4j 图数据库导出。

#### Research Coverage（按维度量化证据充分性）
- 新增 `computeResearchCoverage(findings)` 函数，将 Research Questions (Q1-Q11) 映射到 5 个研究维度（Architecture / AI-Capability / Testing-Quality / Documentation / Decisions）。
- 每个维度输出：coverage (0-1) / confidence (high/medium/low) / findingCount / verifiedCount / avgConfidence / gap (描述性文字)。
- 报告新增 `_researchCoverage()` 章节（§A.4），展示维度覆盖率表 + 摘要 + 低置信度警告。
- 报告撰写 prompt 新增 Quality Gate 第 9 条："低覆盖率结论是否标注？"

#### Report Narrative（从章节模板到叙事弧线）
- 重写 `prompts/07-report-writer.md`，从 5 章节固定模板改为 9 段叙事弧线：
  Repository Overview → Design Philosophy → Architecture → Major Decisions → Trade-offs → Interesting Ideas → Risks → Recommendations → Lessons Learned。
- 新增第一原则 "Story over Section"：报告是叙事，不是章节填充。读起来应像 Martin Fowler 的文章。
- 整合 C9（Counter-Evidence）和 C10（Competing Interpretations）到 Architecture 章节。
- 新增 3 个 Quality Gate 问题（叙事流 / C9-C10 处理 / 低覆盖率标注）。

### 测试改进

#### 新增单元测试（14 个）
- `computeResearchCoverage`：5 个测试（空输入 / 按维度计算 / 置信度标签 / 最弱最强维度 / 缺口消息）。
- Core Ontology 投影：9 个测试（toCoreType 全类型 / toCoreRelationship 全动词 / fallback 行为 / 分布统计 / 多对一性质 / 类型/动词数量不变式）。
- 单元测试总数：41 → 55。

#### 测试基线更新
- `baseline-metrics.json` 重新生成（briefLength 增长 ~2500-2900 字符，因新增 Research Coverage + Core Ontology View 章节）。
- 4 个 Golden fixtures 重新生成（agent / database / tool / readme-claims）。

### 测试结果
- 全部 6 层 239/239 通过（100%）。
- UNIT 93/93 / PROMPT 12/12 / BEHAVIOR 25/25 / MUTATION 18/18 / REGRESSION 68/68 / E2E 23/23。

### 文档更新
- DESIGN.md 新增 §33-§36（4 条设计决策）。
- CHANGELOG.md 新增本条目。

---

## 2026-07-28 — Research Object Model + 新分析器 + 测试体系 async 化

### 新增功能

#### Research Object Model（多类型研究对象 + 关系图）
- 新增 `ResearchObjectRegistry`（evidence-store.mjs），将现有分析器输出注册为多类型研究对象（Pattern/Decision/Constraint/Tradeoff/Assumption/Hypothesis/Evidence/Issue/Risk/Unknown）。
- 新增 `store.researchObjects`（含 objects[] + relations[]）和 `store.researchObjectsSummary`。
- 报告新增 "Research Object Graph" 章节，展示对象间关系（implemented_by / supported_by / conflicts_with / caused_by）。

#### Claim Lifecycle（状态迁移）
- 为 Finding 增加 `lifecycle` 字段：`candidate → hypothesis → supported → verified → decision → reusable_pattern`。
- 新增 `lifecycleHistory` 记录迁移轨迹（from/to/reason/timestamp）。
- `_promoteVerifiedFindings` 将 Q9 verified Finding 提升为 `decision`，Q1 verified 提升为 `reusable_pattern`。
- 状态迁移单调化（只前进不后退）。

#### Evidence Provenance（可追溯性）
- 为每个 evidence support item 注入 `who: "analyzer"` 和 `when: <commit-hash>`。
- 新增 `provenanceCoverage` 质量指标，量化追溯覆盖率。

#### Decision Record ADR 7 字段
- `_finalizeDecision` 为每个决策注入 `problem` / `risk` / `reusability`。
- 决策现在包含完整 ADR 结构：problem / alternatives / tradeoff / chosen / evidence / risk / reusability。
- `reusability` 为 0-1 分数，按 category 量化可复用性。

#### Unknown 主动分类
- `_classifyUnknown` 将 Unknown 分为三类：`need_reading` / `need_external_evidence` / `impossible_to_verify`。
- 每个 Unknown Finding 携带 `unknownType` + `unknownReason`。
- 报告在 Findings 概览展示 Unknown 分类分布，在详情展示类型和原因。

#### DesignPatternAnalyzer（代码级设计模式检测）
- 新增分析器，检测 12 种 GoF 模式：Factory / Singleton / Builder / Strategy / Observer / Adapter / Decorator / Repository / DI / Plugin / Command / Chain of Responsibility。
- 每个模式输出：instances / confidence / evidence[] + Reusability 4 字段（applicability / limitation / migrationCost / reuseScore）。
- 修复 JS/TS 类方法提取：`method_definition` 节点 + `property_identifier` 查找。
- 修复 Factory/Singleton 误判：从 Factory 匹配中移除 `getInstance`。

#### ArchitectureMetricsAnalyzer（架构指标）
- 新增分析器，计算 Fan-in / Fan-out / Coupling / hubNodes / bottleneckNodes。
- 从 import graph 构建有向图，输出 `store.archMetrics`（summary + fanIn + fanOut + coupling）。

#### TemporalAnalyzer（仓库演进分析）
- 新增分析器，从 git 历史检测 4 类演进事件：major_rewrite / architecture_pivot / deprecated_pattern / historical_tradeoff。
- 无 git 时输出 `{ skipped: true }`，不阻塞 pipeline。
- 输出 `store.temporal`（summary + events[]）。

### 测试体系改进

#### 测试 Runner 升级为 async 兼容
- `runSuite` 从 sync 改为 async，支持 async 测试函数。
- `skill-test.mjs` 的 `runLayer` / `main` 改为 async，`runAnalyzerOutputTests` 改为 async + await。
- 不影响现有 sync 测试（await sync 函数立即 resolve）。

#### 新增单元测试（new-analyzers.test.mjs）
- DesignPatternAnalyzer：7 个测试（Factory/Singleton/Observer/Repository 检测 + 非误判 + confidence 范围）。
- ArchitectureMetricsAnalyzer：5 个测试（output / Fan-in/Fan-out / coupling / hub nodes / summary）。
- TemporalAnalyzer：3 个测试（output / events / commit count，无 git 时 skip）。
- Decision Record ADR 7 字段：通过 crafted store 直接单元测试（不依赖合成仓库触发信号）。
- Pattern Reusability 4 字段：验证 applicability / limitation / migrationCost / reuseScore。
- 总计 64 个 sub-tests。

#### 测试结果
- 全部 6 层 239/239 通过（100%）。
- UNIT 93/93 / PROMPT 12/12 / BEHAVIOR 25/25 / MUTATION 18/18 / REGRESSION 68/68 / E2E 23/23。

### 文档更新
- DESIGN.md 新增 §24-§31（8 条设计决策）。
- CHANGELOG.md 新增本条目。

---

## 2026-07-28（续）— graphology 替代手写图基础设施 + 删除 ts-morph 死依赖

### 原则
> "Script 应该写 Research Logic，不要写 Infrastructure Logic。"
> 如果一个库已有几千个项目在用且维护活跃，就不要自己重新实现。

### 变更

#### graphology 激活（已安装未使用 → 启用）
- graphology ^0.26.0 于 2026-07-22 添加为依赖，但从未被 import。
- 新增 `buildArchGraph(arch)` 共享 helper（analyzers-inference.mjs）：从 ArchitectureAnalyzer 的 nodes/edges 构建 graphology DirectedGraph。
- **ArchitectureMetricsAnalyzer**：`fanInMap` / `fanOutMap`（Map + 手写 counting loop）→ `graph.inDegree(id)` / `graph.outDegree(id)`。删除 8 行手写 degree counting 代码。
- **`_aggregateFan`** 签名变更：`countMap: Map` → `degreeFn: (id) => number`，更通用。
- **DependencySmellAnalyzer**：hub module 检测的手写 `inDegree` Map → `buildArchGraph` + `graph.inDegree()`。删除 5 行手写 in-degree counting 代码。

#### ts-morph 删除（死依赖）
- `ts-morph` ^28.0.0 从 package.json 移除。
- 原因：已安装但从未被 import（grep 确认零引用）；且只支持 TS/JS，与 web-tree-sitter 的多语言（Python/Java/Go/Rust）支持冲突。

#### 不改动的部分（研究逻辑，非基础设施）
- **InformationFlowAnalyzer BFS**：带 depth tracking / path recording / LLM detection，是研究逻辑。
- **RelationshipBuilder**：关系推断引擎（testedBy / configuredBy / documentedBy），是 domain logic。
- **ArchitecturePatternAnalyzer 模块级 stability**：模块级图（非节点级），包含 abstractness / zone of pain 等研究逻辑。

### 评估的其他库（不采用）
- `ts-morph` 替代 AST：不适用（只支持 TS/JS，与多语言需求冲突）。
- `dependency-cruiser` / `Madge`：不适用（JS/TS only）。
- `DuckDB` / `SQLite`：不适用（重原生依赖，IDE 沙箱不支持）。
- `json-rules-engine`：不适用（业务规则引擎，非代码分析）。
- `p-queue` / `p-map`：不适用（Analyzer 顺序执行，无并发需求）。

### 测试结果
- 全部 6 层 239/239 通过（100%），无回归。
- DESIGN.md 新增 §32。

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
