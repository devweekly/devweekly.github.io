# 本地模型与 DeepSeek 离线分析对比

在原著已完成 ingest、章节索引，且 LM Studio 已启动并加载 Writer 模型的机器上执行：

```bash
cd tools/novel-generation
lms server start --port 1234
npm run compare-models -- --local-model "qwen3.8-9b-distill-slerp-f451-pro-writer-uncensored"
```

默认均匀抽取 6 个章节。脚本默认 `max_tokens=12000`（可用 `--max-tokens` 调整，范围 1000-20000）。请先在 LM Studio 的模型加载设置中将 Writer 模型 Context Length 调整到至少 16384；4096 通常不足以容纳分析 Prompt 和完整输出。`max_tokens` 是输出预算，Context Length 是输入与输出共享的上下文窗口，两者都要留足。脚本不会单独缩短某一模型的输入，保证两边使用同一份 Prompt。若 LM Studio 当前有多个模型，使用 API 返回的模型 ID 指定目标：

```bash
npm run compare-models -- --local-model "LM Studio model id"
npm run compare-models -- --chapters 8 --max-chars 12000 --max-tokens 12000
npm run compare-models -- --chapter-ids V01-C001,V02-C005,V04-C010
npm run compare-models -- --deepseek-model deepseek-v4.1-flash --timeout-ms 300000
```

环境变量：LM_STUDIO_BASE_URL（默认 http://127.0.0.1:1234/v1）、LM_STUDIO_MODEL、LM_API_TOKEN（仅当 LM Studio 开启鉴权时）。DeepSeek 通过项目现有 CodeBuddy SDK 登录和模型目录调用，不在命令行或诊断包中保存密钥。

输出位于 .output/<world>/model-comparison/<run-id>/，自动生成 ZIP。每章 JSON 包含原文摘录、相同 prompt、两个模型的原始输出、耗时、LM Studio usage、finish_reason、响应结构摘要和失败时的响应诊断。对于 reasoning-only、`finish_reason=length`、空最终文本等情况，会分类记录失败原因；`reasoning_content` 只作为诊断信息，绝不作为最终分析结果。若有文本但 `finish_reason=length`，会标记 `incomplete_generation`。LM Studio 兼容 string content、text block 数组及常见 output_text 响应；空响应会保留响应结构与截断后的原始响应正文。HTTP 400 上下文错误会记录 prompt tokens/context tokens，并给出调整建议。诊断包不包含完整原著、数据库或密钥，但包含被抽样章节摘录以便复核 evidence。

自动检查验证 JSON 是否可解析，并逐条检查所有 evidence（包括少于 4 个字符的短引用）是否为输入文本中的逐字连续片段；每条不匹配引用都会记录 JSON 路径、原文和失败原因。它不是分析质量评分。人工重点是人物理解、因果判断、伏笔克制、关系变化、世界细节和文学风格洞察。文学性高于字段覆盖，分析只为续写服务，不成为人物和剧情的硬约束。

LM Studio 调用设置 temperature=0.2；现有 CodeBuddy SDK 封装不暴露等价 temperature 参数，因此采样参数并非完全相同。模型调用失败会记录在对应章节中，不会伪装为成功。
