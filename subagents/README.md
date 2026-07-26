# Subagent 执行顺序（v2: Question-centric Pipeline）

请按以下顺序派发 subagent（可用 Task 工具并行执行无依赖的阶段）：

## Stage 1 — 假设生成
- prompt: `subagents/01-hypothesis.md`
- output: `01-hypotheses.md`

## Stage 2 — Ontology Mapper（共享语义层）
- prompt: `subagents/02-ontology.md`
- output: `02-ontology.md`

## Stage 3 — Research Question Agents（并行）
- `subagents/RQ-001-architecture-pattern.md` → `RQ-001-architecture-pattern.md`
- `subagents/RQ-002-llm-provider-isolation.md` → `RQ-002-llm-provider-isolation.md`
- `subagents/RQ-003-tool-determinism.md` → `RQ-003-tool-determinism.md`
- `subagents/RQ-004-context-propagation.md` → `RQ-004-context-propagation.md`
- `subagents/RQ-005-architecture-evolution.md` → `RQ-005-architecture-evolution.md`

每个 RQ Agent 会：
1. 读取 `01-hypotheses.md` 和 `02-ontology.md`
2. 验证或推翻相关假设
3. 输出 Findings（含 Counter Evidence / Alternative Interpretation / Unknowns）
4. 更新 RQ 状态（Open → Investigating → Validated / Rejected / Needs Evidence）
5. 将跨 RQ 共享的发现写入 `shared-findings.md`

## Stage 4 — 交叉验证
- prompt: `subagents/03-cross-validation.md`
- output: `03-cross-validation.md`
- 任务：更新 RQ 状态、验证假设、识别冲突、校准置信度

## Stage 5 — 对比分析（可选）
- prompt: `subagents/04-comparative.md`
- output: `04-comparative.md`
- 限制：只允许对比显式列出的项目（OpenAI Agents SDK / LangGraph / Claude Code / Codex / AutoGen / CrewAI / MCP）

## Stage 6 — 最终报告
- prompt: `subagents/05-report-writer.md`
- output: `report.md`
- 限制：禁止创建新 Finding；只整合 Validated 的 RQ
