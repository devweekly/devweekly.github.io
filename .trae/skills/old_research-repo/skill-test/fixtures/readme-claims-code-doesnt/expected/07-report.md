# Research Report — readme-claims-code-doesnt

## Executive Summary

该 Library/SDK 的证据非常有限，且 README 中关于分布式事务的声明未在代码或测试中找到支持。最重要的工程洞察是：不能仅根据 README 推断未实现功能，必须优先使用源码和测试作为证据。读者应优先验证 `README.md` 与 `src/` 目录内容的一致性。

## Top Claims

### Claim 1: README 声称的分布式事务能力未在代码或测试中验证

**Why it holds**:
- Evidence: `README.md line 10`
- Coverage: Doc only
- Quality: Documentation Only — 未验证

**Why it might be wrong**:
- Alternative explanation: 可能通过外部依赖或不同术语实现。
- Missing evidence: 源码中 transaction / distributed / commit / rollback / xa 关键词；相关测试；外部依赖清单。

**Why it matters**:
如果接受 README 声明为事实，会高估项目能力并导致错误的技术选型。

### Claim 2: 当前项目能力主要为 Library/SDK 基础功能，证据不足

**Why it holds**:
- Evidence: `src/` 导出声明、`tests/` 有限覆盖
- Coverage: Code + Test (limited)
- Quality: Partially Verified

**Why it might be wrong**:
- Alternative explanation: 核心功能可能通过集成测试或示例验证，但证据中未提供。
- Missing evidence: 更完整的源码与测试列表。

**Why it matters**:
证据有限时，必须诚实标注 Unknown，而不是扩大结论。

## Appendix

- **Reading Guide**: 先全局搜索 README 中所有功能声明在 `src/` 与 `tests/` 中的对应证据。
- **Open Questions**: 分布式事务是否在外部依赖中实现；项目是否处于早期开发阶段。
- **What NOT to Learn**: 不要学习如何"从 README 推断架构"，本项目明确展示了这种做法的危险。

## Quality Gate

1. **What would invalidate this report?** 如果发现源码中确实实现了分布式事务但使用了完全不同的术语。
2. **What is most likely to be disagreed with?** Claim 1 可能被认为过于严格——但文档声称未验证是更安全的立场。
3. **Is any Claim pretending to be certain when it should be Unknown?** Claim 1 已明确标注 Documentation Only；Claim 2 为 Partially Verified。
