<!-- Target output: RQ-002-llm-provider-isolation.md -->
<!-- Repo: pi | Lang: zh -->

# RQ-002: LLM Provider 隔离机制 — pi

**Research Question**: pi 如何隔离 LLM Provider？它是真正的抽象还是仅仅是 wrapper？

你的首要目标是**验证或推翻** `01-hypotheses.md` 中与 LLM 集成相关的假设。

必读输入：
- `01-hypotheses.md`
- `02-ontology.md`（查找 LLMProvider Interface 及其 Implemented By）
- `evidence-brief.md`
- `evidence-store/full.json`（capabilityOntology、informationFlow 章节）
- 关键源码（LLM 调用点、Provider 注册、Adapter 实现）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001：Research Question → Hypothesis Evaluation → Findings（含 Counter Evidence / Alternative / Unknowns）→ Shared Findings → RQ Status

约束：
- 如果 `02-ontology.md` 中已定义 LLMProvider Interface，直接引用。
- 必须查看实际调用链，不要仅从类名推断。
- 如果没有找到 LLM 隔离机制，明确记录为 Negative Finding。