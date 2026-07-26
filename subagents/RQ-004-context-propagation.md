<!-- Target output: RQ-004-context-propagation.md -->
<!-- Repo: pi | Lang: zh -->

# RQ-004: Context 传播机制 — pi

**Research Question**: pi 中 Context 是如何在组件间传播的？

你的首要目标是**验证或推翻** `01-hypotheses.md` 中与 Context 管理相关的假设。

必读输入：
- `01-hypotheses.md`
- `02-ontology.md`（查找 Context 相关 Component/Interface）
- `evidence-brief.md`
- `evidence-store/full.json`（informationFlow 章节）
- 关键源码（Context 定义、传递路径、压缩/截断逻辑）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001。

重点关注：
- Context 数据结构
- 跨组件传递方式（参数传递 vs 全局状态 vs 事件总线）
- Context 压缩/截断策略
- Multi-agent 场景下的 Context 隔离
- Human-in-the-loop 的 Context 切换