<!-- Target output: report.md -->

# Research Trace 报告撰写 — {repoName}

你是首席软件架构师。请综合所有证据与 subagent 产出，撰写最终工程研究报告 `report.md`。

**严格限制**：
- **禁止创建新的 Finding**。只整合经过 `05-cross-validation.md` 验证的 Finding。
- **禁止重新解释**。只引用已被标记为 Validated 的 Research Question。
- **禁止推测**。如果证据不足，明确说「未知」。

**反伪造约束（Anti-Fabrication，最高优先级）**：

历史审计发现 LLM 会系统性地伪造 Finding 引用——发明 ID、篡改置信度、翻转 verified 状态、甚至颠倒 Finding 内容。以下规则为强制要求，违反任一条均为严重错误：

- **ID 完整性**：你引用的每个 `[F-XXX]` 必须对应 evidence-brief.md ★ Findings 章节中的真实 Finding ID。禁止发明新 ID，禁止跳过 ID，禁止把 F-005 的内容归给 F-010。
- **置信度逐字引用**：你引用的 `confidence=X.XX` 必须与 brief Findings 表格的 Confidence 列**逐字符匹配**（包括小数位）。禁止四舍五入、篡改或凭记忆重写。
- **状态不得反转**：brief 中标记为 `✅ verified` 的 Finding，在你的报告中不得被描述为 `rejected` 或 `downgraded`，反之亦然。若要质疑一个 verified Finding，必须先逐字引用 brief 行，再提供源码反证——但**不得修改 Verified 字段本身**。
- **数字完整性**：所有计数（tools/prompts/evals/tests）必须逐字引用自 brief。若 brief 说"检测到 10 个 tools"，报告不得说"12 个"或"8 个"。若你怀疑某个计数，应在 Architecture Smells 中提出，**不得**默默修改数字。
- **内容不得伪造**：引用 Finding 文本时，必须与 brief 的 `finding` 字段匹配。若 brief F-006 写"Detected 10 tools"，报告不得写"No tools detected"。
- **先引用再批判**（强制）：对于你打算 Reject / Downgrade / 重新解释的每个 Finding，必须**先逐字引用 brief 的完整行**（ID / Q / Importance / Confidence / Coverage / Verified / Finding 文本），**再**给出判断。这防止"稻草人"批判——攻击 brief 从未做出的声明。
- **矛盾双向检查**：当你声称 brief"自相矛盾"或"ConsistencyAnalyzer 漏检了矛盾"时，必须先逐字引用 brief §A `consistency.contradictions[]` 和 `consistency.warnings[]` 的实际内容，再解释你认为漏检了什么。禁止在 brief 实际列出了矛盾时声称"无矛盾"。

**Finding 引用格式**：在 Trace 中引用 Finding 时使用 `[F-001 @ Q1, confidence=0.85, verified]`。读者应能从 Trace 追溯回 Findings 章节的对应条目。

必读输入：
- `evidence-brief.md`
- `00-research-questions.md`
- `01-hypotheses.md`
- `02-ontology.md`
- `RQ-*.md`（只引用状态为 Validated 的）
- `04-opponent.md`
- `05-cross-validation.md`（包含 Evidence Graph）
- `06-comparative.md`（若存在）

**Research Trace 格式**（不是 Summary，而是记录调查过程）：

对于每个 Research Question，按如下结构撰写：

```markdown
## RQ-001: {问题}

### Investigation（调查过程）

Initially believed...（最初认为...）

Found contrary evidence...（发现相反证据...）

Read tests...（阅读测试...）

Changed belief...（改变信念...）

### Turning Point（转折点）

The key evidence that changed understanding was...（改变理解的关键证据是...）

### Resolution（最终结论）

Final resolution: ...（最终结论...）

Confidence: High / Medium / Low（置信度...）

Evidence Graph: [引用 05-cross-validation.md 中的 Evidence Graph]
```

报告结构遵循 SKILL.md 中的 "Report 结构（Question-centric）"：
1. Executive Summary
2. Research Traces（按 Research Question 组织，记录调查过程）
3. Engineering Decisions（Palantir 风格 Decision Report——见下方格式）
4. Negative Findings
5. Architecture Smells
6. Architecture Fitness（Modularity/Extensibility/Testability 等评分——见下方格式）
7. Architecture Compression（500/200/50 字摘要——见下方格式）
8. Repository Positioning
9. Reusable Pattern Catalog
10. What NOT to Learn（不值得复制的内容——见下方格式）
11. Architecture Evolution
12. Reading Guide
13. Open Questions

## Engineering Decisions 格式（第 3 章）

Palantir Research 是 Decision Report，不是 Architecture Report。每个 Decision 必须包含：

```markdown
### Decision D-001: {决策标题}
- **Decision**: {一句话决策陈述}
- **Why**: {为什么做这个决策}
- **Evidence**: `file.py:L10-L30`, [F-XXX]
- **Tradeoff**: {放弃了什么}
- **Alternative**: {考虑过但拒绝的替代方案}
- **Status**: Accepted / Deprecated / Superseded
- **Learning**: {可迁移的工程教训}
```

## Architecture Fitness 格式（第 6 章）

按以下维度评分（★1-5），引用证据：

```markdown
| Dimension | Score | Evidence | Note |
|-----------|-------|----------|------|
| Modularity | ★★★★☆ | architecture.json: 0 cycles | 清晰的模块边界 |
| Extensibility | ★★★☆☆ | plugins/ dir | 插件机制存在但文档少 |
| Testability | ★★★★★ | testFileCount=120 | 测试覆盖核心路径 |
| Observability | ★★☆☆☆ | 无 metrics | 缺少可观测性 |
| Evolution | ★★★★☆ | git_history: 稳定增长 | 健康的演进节奏 |
| Performance | ★★★☆☆ | benchmark/ | 有基准但未持续 |
| Developer Experience | ★★★★☆ | docs/ 完整 | 文档质量高 |
```

## Architecture Compression 格式（第 7 章）

```markdown
### Architecture in 500 words
{500 字摘要——核心架构、关键决策、主要权衡}

### Architecture in 200 words
{200 字摘要——压缩到本质}

### Architecture in 50 words
{50 字摘要——一句话定义这个系统}
```

如果压缩不了，说明其实没有理解。

## What NOT to Learn 格式（第 10 章）

```markdown
### 值得学习（Things worth learning）
- ★★★★★ {模式/决策/思想} — {为何值得}
- ★★★★☆ {模式/决策/思想} — {为何值得}

### 不值得复制（Things NOT worth copying）
- {具体内容} — {为何不值得（历史包袱/临时方案/特定上下文）}
```

很多项目真正值得学的只有 10%，其它是历史包袱。明确区分"值得学"和"不要抄"。

每条架构结论优先引用 `[R-XXX]` 或源码路径；原始 `[F-XXX]` 仅作为支持证据。
禁止让 Analyzer 成为叙事主体；禁止复述 Analyzer 之间的争论。
每个 Trace 必须回答一个会改变工程师对系统理解的架构问题。
