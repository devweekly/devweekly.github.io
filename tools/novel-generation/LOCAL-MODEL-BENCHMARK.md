# 本地模型能力测试

测试 LM Studio 中实际加载的本地模型，不再把整章多维度原著分析当作本地模型唯一能力测试。

## 候选模型

- Chat：qwen3.8-9b-distill-slerp-f451-pro-writer-uncensored
- Chat：sparkmuse-4b
- Embedding：text-embedding-nomic-embed-text-v1.5
- Embedding：text-embedding-qwen3-embedding-0.6b

LM Studio 的 OpenAI-compatible /v1/models 通常只列出当前加载的模型。建议每次加载一个模型后单独运行。未加载模型会标记为 not_loaded，不会把“未加载”误判成“模型不支持任务”。

## 运行

在 tools/novel-generation 目录：

```bash
npm install
lms server start --port 1234
npm run benchmark-local-models
```

分别测试各模型：

```bash
npm run benchmark-local-models -- --chat-models "qwen3.8-9b-distill-slerp-f451-pro-writer-uncensored" --embedding-models ""
npm run benchmark-local-models -- --chat-models "sparkmuse-4b" --embedding-models ""
npm run benchmark-local-models -- --chat-models "" --embedding-models "text-embedding-nomic-embed-text-v1.5"
npm run benchmark-local-models -- --chat-models "" --embedding-models "text-embedding-qwen3-embedding-0.6b"
```

参数：

- --world：默认 conghuoniao
- --chat-models：逗号分隔的 Chat 模型 ID
- --embedding-models：逗号分隔的 Embedding 模型 ID
- --chapters：抽样章节数，默认 4
- --max-chars：每章输入字符数，默认 3500
- --max-tokens：Chat 输出 token 上限，默认 3000
- --timeout-ms：单次调用超时，默认 180000
- --tasks：任务列表，默认 extraction,summary,dialogue,writing,editing,style

可通过 LM_STUDIO_BASE_URL、LM_API_TOKEN 覆盖服务地址和鉴权。

## 任务和评价

| 任务 | 测试内容 | 自动评价 | 人工评价 |
|---|---|---|---|
| Extraction | 人物、行为、关系、事件、场景提取 | JSON 有效性、证据逐字命中率 | 漏项、误识别、证据是否支持结论 |
| Summary | 章节摘要、因果和未解决问题 | 调用耗时、输出长度 | 信息保留、因果准确性、推测是否冒充事实 |
| Dialogue | 人物声音差异与对白续写 | 调用耗时、输出长度 | 人物辨识度、潜台词、自然度 |
| Writing | 场景续写 | 调用耗时、输出长度 | 文学性、节奏、人物选择、情节推进 |
| Editing | 局部文学编辑 | 调用耗时、输出长度 | 是否保留事实、语言节奏是否改善、有无过度修饰 |
| Style | 叙述风格分析 | 调用耗时、输出长度 | 是否抓住具体叙事特征，能否区分稳定风格与偶然现象 |
| Embedding | 章节片段向量化与自检索 | 维度、耗时、Top-1、Recall@3、MRR | 另需人工标注相关段落才能评价真实语义检索质量 |

Embedding 当前使用原文片段前缀作为查询、完整片段作为候选。这只验证模型、维度和检索链路的基本行为，不等同于人工标注的语义检索 benchmark。若要严谨比较中文小说语义检索质量，后续应建立人工标注的“问题—相关段落—困难负例”数据集。

## 输出

结果保存在 .output/<world>/local-model-benchmark/<run-id>/：

- REPORT.md：模型任务成功率、耗时和 Embedding 自检摘要
- manifest.json：模型清单、测试设置、章节样本
- chat-results.json：每个任务的 Prompt、原文摘录、输出、usage 和失败原因
- embedding-results.json：向量维度、耗时、排序明细

本测试与正式 pipeline 隔离，不会将模型输出写入 Story Graph、Story State、corpus-craft 或续写流程。文学质量不做伪精确的自动打分，保留相同输入下的模型输出供并排阅读。
