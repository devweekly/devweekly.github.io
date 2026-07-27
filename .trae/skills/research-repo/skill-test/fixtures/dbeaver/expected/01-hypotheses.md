# Hypotheses — dbeaver

### H1: DBeaver 使用 Eclipse extension point 实现数据库驱动的声明式扩展
- **先验置信度**: 50%
- **支持证据**: `plugins/org.jkiss.dbeaver.ui/plugin.xml`、`DriverDescriptor.java`
- **若成立，意味着什么**: 新增数据库支持主要通过插件声明，无需修改核心 UI。
- **若不成立，意味着什么**: 驱动注册通过运行时动态发现完成。
- **如何验证**: 阅读 plugin.xml 中 driver 相关 extension point 与 DriverDescriptor 解析逻辑。

| 证据来源 | 置信度变化 | 原因 |
|----------|------------|------|
| 先验 | 50% | 目录与 plugin.xml 命名 |
| plugin.xml | 75% | 存在 extension point 声明 |
| DriverDescriptor.java | 85% | 驱动描述符类存在 |

### Competing Hypothesis
- **陈述**: 驱动支持通过运行时扫描 classpath 中的 JDBC jar 动态完成。
- **先验置信度**: 30%
- **置信度**: 20%
- **为何不如主假设**: plugin.xml 与 DriverDescriptor 暗示声明式注册。
- **如何证伪竞争假设**: 找到启动时扫描 jar 并构建 driver catalog 的代码。
