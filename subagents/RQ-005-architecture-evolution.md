<!-- Target output: RQ-005-architecture-evolution.md -->
<!-- Repo: pi | Lang: zh -->

# RQ-005: 架构演化路径 — pi

**Research Question**: pi 的架构是如何演化的？有哪些关键的重构节点？

你的首要目标是**验证或推翻** `01-hypotheses.md` 中与架构演化相关的假设。

必读输入：
- `01-hypotheses.md`
- `02-ontology.md`
- `evidence-brief.md`
- `evidence-store/git_history.json`
- `evidence-store/full.json`（architecture、dependencySmell、stability 章节）

**Evidence Budget**：最多 50 个文件 / 200 个符号

输出结构同 RQ-001。

重点关注：
- 提交量、贡献者、主要重构节点
- 模块增长方式：monolith → split？新增产品形态？
- 循环依赖、hub modules、不稳定依赖的演化趋势
- 测试/eval 基础设施是早期还是后期加入