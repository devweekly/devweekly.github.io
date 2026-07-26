<!-- Target output: RQ-001-architecture-pattern.md -->
<!-- Repo: pi | Lang: zh -->

# RQ-001: 核心架构模式 — pi

**Research Question**: pi 采用什么核心架构模式？它是如何在规划与执行之间实现分离的？

你是一位软件架构师。你的首要目标**不是**总结架构，而是**验证或推翻** `01-hypotheses.md` 中与架构相关的假设。

必读输入：
- `01-hypotheses.md`（找到与架构相关的假设）
- `02-ontology.md`（共享语义层，引用其中的 Component/Interface/Relation）
- `evidence-brief.md`
- `evidence-store/full.json`（architecture、responsibility、stability 章节）
- `evidence-store/interesting_files.json` 中排名前 20 的文件

**Evidence Budget**：
- 最多读取 **50 个文件**
- 最多读取 **200 个符号**（函数/类）
- 当置信度稳定时停止（不要为了凑数而过度阅读）

输出结构：

## Research Question

pi 采用什么核心架构模式？它是如何在规划与执行之间实现分离的？

## Hypothesis Evaluation

| 假设 | 状态 | 证据 |
|------|------|------|
| H-XXX: ... | 支持 / 反驳 / 证据不足 | ... |

## Findings

### Finding 1: {标题}
- **Conclusion**: ...
- **Evidence**: `file.py:L10-L30`, 或简报 §X
- **Counter Evidence**: 哪些证据与这个结论矛盾？（例如：没有测试验证、没有运行时注册等）
- **Alternative Interpretation**: 还有什么其他解释？（例如：可能只是 wrapper 而非真正的抽象）
- **Confidence**: High / Medium / Low
- **Unknowns**: 还需要哪些源码验证？

## Shared Findings

如果你发现了其他 Research Question 可能关心的发现，列在这里供后续 Agent 引用：

- **SF-001**: {简述} — 详见 `shared-findings.md`

## RQ Status

- [x] Investigating
- [ ] Validated
- [ ] Rejected
- [ ] Needs Evidence

约束：
- 每个 Finding 必须引用至少一个证据源。
- 不要从命名推断功能；必须查看调用链或实现。
- 区分事实与解读。
- **必须**包含 Counter Evidence 和 Alternative Interpretation。