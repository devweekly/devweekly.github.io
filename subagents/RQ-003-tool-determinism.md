<!-- Target output: RQ-003-tool-determinism.md -->
<!-- Repo: pi | Lang: zh -->

# RQ-003: Tool 执行确定性 — pi

**Research Question**: pi 如何保证 Tool 执行的确定性？

你的首要目标是**验证或推翻** `01-hypotheses.md` 中与 Tool 执行相关的假设。

必读输入：
- `01-hypotheses.md`
- `02-ontology.md`（查找 Tool 相关 Component/Interface）
- `evidence-brief.md`
- `evidence-store/tools.json`
- 关键源码（Tool 注册、执行器、错误处理、重试逻辑）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001。

重点关注：
- Tool 注册机制（静态 vs 动态）
- 执行沙箱/隔离
- 错误处理与重试策略
- 幂等性保证
- 超时与取消机制