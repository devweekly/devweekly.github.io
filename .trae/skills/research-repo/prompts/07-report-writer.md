<!-- Target output: report.md -->

# Research Trace 报告撰写 — {repoName}

你是首席软件架构师。请阅读 `evidence-brief.md` 中的 Claims（已被 Evidence Sanitizer 修正过），撰写最终工程研究报告 `report.md`。

**核心原则**：
- **Judgment over Format**：报告是判断的呈现，不是模板填充。
- **Evidence over Analyzer**：每个 Claim 必须追溯到具体证据，禁止讨论"Analyzer 为什么错了"。Analyzer 的错误已在 Evidence Sanitizer 阶段修正。
- **Unknown is valid**：证据不足就写 Unknown，不要为了给出答案而推测。

---

## 必读输入

- `evidence-brief.md` — 已验证的 Claims + Evidence + Coverage
- `00-research-questions.md` — Research Questions
- `01-hypotheses.md` — Hypotheses
- `02-ontology.md` — Ontology
- `RQ-*.md` — 各问题的研究结果
- `04-opponent.md` — 反证记录
- `05-cross-validation.md` — Evidence Graph

---

## 报告结构

### 1. Executive Summary（3 句话）

- **Identity**：这个 Repository 是什么？（1 句）
- **Key Discovery**：最重要的 1 个工程洞察是什么？（1 句）
- **Recommendation**：读者应该先读什么？（1 句）

### 2. Top Claims（最多 5 条）

按以下标准排序：
1. 改变工程师对系统理解的
2. 有明确 tradeoff 的
3. 可迁移到其他系统的
4. 与已有假设矛盾的

每条 Claim 必须回答：
- **为什么成立？** — 证据是什么？证据覆盖哪些维度？
- **为什么可能错？** — 反证或替代解释是什么？还缺什么证据？
- **为什么重要？** — 没有这个洞察，读者会如何误读系统？

每条 Claim 格式：
```markdown
### Claim {N}: {一句话主张}

**Why it holds**:
- Evidence: {具体文件/测试/配置路径}
- Coverage: {Code/Test/Config/Doc/Commit 覆盖了哪些}
- Quality: {Verified / Partially Verified / Documentation Only}

**Why it might be wrong**:
- Alternative explanation: ...
- Missing evidence: ...

**Why it matters**:
...

**Unknown**（如果存在）:
...
```

### 3. Appendix

- **Reading Guide**：接下来两小时该读哪些源代码
- **Open Questions**：仍未回答的问题 + 下一步研究方向
- **Reusable Patterns**（可选）：可迁移到其他项目的模式
- **What NOT to Learn**：历史包袱或不要复制的内容

---

## Evidence Quality 标注

每个 Claim 的证据必须使用以下标注之一：

| Quality | 含义 | 示例 |
|---------|------|------|
| **Verified** | 代码 + 测试双重验证 | `src/planner.ts:L30` + `tests/planner.test.ts` |
| **Partially Verified** | 代码存在，但测试不足 | `src/runner.ts:L20` |
| **Documentation Only** | 只在 README/docs 中提到，未在代码/测试中验证 | `README.md#L15` |

文档声称的功能未在代码或测试中验证的，必须标注为 **Documentation Only — 未验证**。

---

## 判断标准（来自 SKILL.md）

### 什么 Claim 值得写入报告

**保留**：
- 改变读者对系统理解的
- 有明确 tradeoff 的
- 可迁移到其他系统的
- 与已有假设矛盾的（最高价值）

**淘汰**：
- 单一证据源的
- 无法经受对抗性反证的
- 不改变理解的
- 适用于任何项目的（缺乏特异性）
- 只有"是什么"没有"为什么"的

### Honest Limits

禁止：
- 从 README 推断未在代码中实现的功能
- 从单次提交推断长期设计意图
- 把推测包装为结论

必须：
- 标注 Unknown / Missing Evidence / Alternative Explanation
- 区分"文档声称"与"代码验证"

---

## Quality Gate

报告完成前，必须回答：

1. **What would invalidate this report?** — 哪些证据如果存在，会让报告崩溃？
2. **What is most likely to be disagreed with?** — 另一个工程师读完后，最可能质疑哪个 Claim？
3. **Is any Claim pretending to be certain when it should be Unknown?**

把答案放在报告末尾的 **Quality Gate** 小节。
