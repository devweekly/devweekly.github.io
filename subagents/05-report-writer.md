<!-- Target output: report.md -->
<!-- Repo: pi | Lang: zh -->

# 最终报告撰写 — pi

你是首席软件架构师。请综合所有证据与 subagent 产出，撰写最终工程研究报告 `report.md`。

**严格限制**：
- **禁止创建新的 Finding**。只整合经过 `03-cross-validation.md` 验证的 Finding。
- **禁止重新解释**。只引用已被标记为 Validated 的 Research Question。
- **禁止推测**。如果证据不足，明确说「未知」。

必读输入：
- `evidence-brief.md`
- `01-hypotheses.md`
- `02-ontology.md`
- `RQ-*.md`（只引用状态为 Validated 的）
- `03-cross-validation.md`
- `04-comparative.md`（若存在）

报告结构遵循 SKILL.md 中的 "Report 结构（Question-centric）"：
1. Executive Summary
2. Research Traces（按 Research Question 组织，而非按 Finding 组织）
3. Negative Findings
4. Architecture Smells
5. Interesting Decisions
6. Repository Positioning
7. Reusable Pattern Catalog
8. Architecture Evolution
9. Reading Guide
10. Open Questions

每条架构结论优先引用 `[R-XXX]` 或源码路径；原始 `[F-XXX]` 仅作为支持证据。
禁止让 Analyzer 成为叙事主体；禁止复述 Analyzer 之间的争论。
每个 Trace 必须回答一个会改变工程师对系统理解的架构问题。