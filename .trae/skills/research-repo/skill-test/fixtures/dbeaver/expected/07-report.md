# Research Report — dbeaver

## Executive Summary

DBeaver 是一个基于 Eclipse RCP 的通用数据库工具。它最重要的工程洞察是：通过插件架构与数据源抽象层，把 UI、驱动管理与数据库方言差异解耦，从而支持多种数据库而不让核心代码爆炸。读者应优先阅读 `plugins/org.jkiss.dbeaver.ui/plugin.xml` 与 `DBPDataSource.java`。

## Top Claims

### Claim 1: 数据库驱动通过 Eclipse extension point 声明式注册

**Why it holds**:
- Evidence: `plugins/org.jkiss.dbeaver.ui/plugin.xml`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Alternative explanation: extension point 只是元数据，实际注册仍依赖运行时扫描。
- Missing evidence: DriverDescriptor 初始化完整调用链。

**Why it matters**:
没有这个洞察，读者会误以为需要修改核心代码才能支持新数据库。

### Claim 2: DBPDataSource 抽象层隔离 JDBC 方言差异

**Why it holds**:
- Evidence: `DBPDataSource.java`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Missing evidence: 具体实现类与方言特化代码。

**Why it matters**:
统一抽象是 DBeaver 能同时支持 MySQL/PostgreSQL/Oracle 等多样数据库的基础。

### Claim 3: Model 层与 UI 层分离，使核心逻辑可独立测试

**Why it holds**:
- Evidence: `plugins/org.jkiss.dbeaver.model/` 与 `plugins/org.jkiss.dbeaver.ui/` 目录边界
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Alternative explanation: 目录分离仅为 Maven 模块组织，实际存在循环依赖。

**Why it matters**:
边界清晰是 IDE 类大型 Java 项目长期可维护的关键。

## Appendix

- **Reading Guide**: 先读 `plugin.xml` extension points，再读 `DBPDataSource.java`，最后读 `DriverDescriptor.java`。
- **Open Questions**: Eclipse RCP 启动顺序对连接池的影响；headless 模式是否存在。
- **What NOT to Learn**: 不要寻找 LLM Prompt 或 Agent lifecycle，DBeaver 不是 AI 项目。

## Quality Gate

1. **What would invalidate this report?** 如果发现驱动注册完全通过运行时扫描而非 extension point。
2. **What is most likely to be disagreed with?** Claim 1 关于声明式注册的结论，因为缺少完整调用链。
3. **Is any Claim pretending to be certain when it should be Unknown?** 所有 Claim 均为 Partially Verified，已诚实标注。
