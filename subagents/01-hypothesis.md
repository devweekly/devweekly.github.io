<!-- Target output: 01-hypotheses.md -->
<!-- Repo: pi | Lang: zh -->

# 假设生成器 — pi

你是一位软件架构研究员。请阅读当前 working folder 中的以下证据，为 pi 生成 **3-5 个可检验的架构级假设**：

- `evidence-brief.md`（§0 研究原则、§1-§5 分析摘要、§9 研究计划与开放问题）
- `evidence-store/full.json` 中的摘要字段（discovery、architecture、capabilityOntology、entrypoints）
- `evidence-store/interesting_files.json`（阅读优先级前 20）

每个假设必须包含：
1. **假设陈述**（一句话，可证伪）
2. **支持证据**（引用具体文件路径或简报章节）
3. **若成立，意味着什么**（对架构理解的影响）
4. **若不成立，意味着什么**（替代解释）
5. **如何验证**（需要查看哪些源码/测试/文档）

输出到 `01-hypotheses.md`。只写假设，不写无关总结。