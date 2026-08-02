# Research Questions — dbeaver

## Archetype

Developer Tool — 基于 hasPlugin/hasSQL/hasDB 信号，以及 plugin.xml / DBPDataSource / DriverDescriptor 等 Eclipse RCP 源码证据。

## Top 5 Questions

### Q1: 为什么 DBeaver 选择 Eclipse RCP 作为插件平台？
- **Why it matters**: RCP 决定了启动成本、UI 框架依赖与扩展机制。
- **Expected Evidence**: `plugins/org.jkiss.dbeaver.ui/plugin.xml`
- **Hypothesis**: Eclipse RCP 提供成熟的 workbench、extension point 与跨平台 SWT。
- **Alternative**: 自研 UI 框架可能更轻量但失去生态。

### Q2: Plugin Architecture 如何通过 extension point 支持新数据库？
- **Why it matters**: DBeaver 的核心价值是连接多种数据库，扩展机制是产品生命线。
- **Expected Evidence**: plugin.xml extension points、`DriverDescriptor.java`
- **Hypothesis**: 新数据库驱动通过声明式 extension point 注册，无需修改核心。
- **Alternative**: 可能通过运行时动态加载 jar 完成扩展。

### Q3: 数据库驱动抽象层 DBPDataSource 隐藏了哪些 JDBC 差异？
- **Why it matters**: 统一的数据源抽象让 UI 层无需感知具体数据库方言。
- **Expected Evidence**: `DBPDataSource.java` 及其实现类
- **Hypothesis**: DBPDataSource 封装连接、元数据与方言差异。
- **Alternative**: 方言逻辑可能分散在 UI 层。

### Q4: 为什么配置模型（connection / driver / preference）与 UI 分离？
- **Why it matters**: 分离使 headless 测试、CLI 与 UI 独立演进成为可能。
- **Expected Evidence**: model 插件与 ui 插件目录边界
- **Hypothesis**: model 层独立可测试，ui 层只负责展示。
- **Alternative**: 可能只是为了 Maven 模块划分，没有严格边界。

### Q5: Eclipse plugin 生命周期（start / stop / activate）如何影响连接管理？
- **Why it matters**: IDE 长生命周期中，插件启停顺序可能泄漏连接或资源。
- **Expected Evidence**: plugin activator 类、连接池相关代码
- **Hypothesis**: Activator 管理插件级资源，DataSource 管理连接级资源。
- **Alternative**: 可能完全依赖 OSGi 容器管理生命周期。

## Filtered Out

- "Agent lifecycle 如何设计？" — DBeaver 不是 AI Agent，已过滤。
- "LLM Prompt 如何管理？" — 无 LLM 证据，已过滤。
