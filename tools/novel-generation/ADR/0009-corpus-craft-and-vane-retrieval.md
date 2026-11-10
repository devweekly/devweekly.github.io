# ADR-0009：面向小说续写的离线创作素材分析与可选 Vane 检索

- 状态：Accepted
- 日期：2026-11-07
- 范围：tools/novel-generation

## 背景与目标

本项目交付的是小说续写正文。当前首先续写《从姑获鸟开始》，以后可能导入其他小说。已有 analyze-story、Story Graph、人物逐章状态、风格参考和 Story State 已覆盖大量人物/剧情连续性问题，但生成阶段仍较难直接找回具体场景、对白原句、人物在当时掌握的信息、事件因果和世界日常细节。

新增离线分析的目标不是增加文学分析报告，而是把原文中对下一章创作有用的素材变成可检索、可追溯的上下文。

## 决策

### 1. 分析单元与输出

复用现有 novel-kb 的去重章节文本与章节目录；每章独立分析、缓存和重试。输出位于 analysis/<world>/corpus-craft/chapters/<chapterId>.json，不新增 SQLite 表，不复制现有 Story Graph 的实体/事件/关系主数据。

素材类型：
- scenes：场景与叙事节拍，包括人物、地点/时间、视角、冲突、转折、结果和情绪变化。
- dialogueExemplars / voiceObservations：人物真实对白范例和可观察的表达方式。
- causalLinks：事件因果、动机、条件与时间先后的区别。
- knowledgeStates：人物在当时知道什么、通过什么渠道知道。
- worldDetails：称谓、习俗、阶层、组织、交易、器物、民俗和世界规则在日常生活中的表现。
- narrativeObservations：视角、信息揭示、悬念、节奏和留白等叙事手法观察。

每条记录必须带 evidence，且 evidence 必须是当前章节原文的连续逐字子串；不匹配条目直接丢弃。按正文 SHA-256 和 prompt version 增量跳过，支持 limit、shard、force。失败章节不覆盖成功缓存。

### 2. 写作时使用

普通 write 与 write-long 在 CLI 组装本次任务检索查询后，自动从离线素材中选取少量相关章节素材，并附加到现有 storyAnalysisContext。分析资料只用于找回原文场景、对白、因果、人物知识和世界细节，不是正史、行为约束、剧情清单或验收门禁。

不新增 Agent，不新增每章必跑的模型调用，不要求每章兑现伏笔/人物弧光，也不让分析字段覆盖作者的创作方向。文学性、文笔、艺术风格高于其他一切。

### 3. Vane 作为可选检索后端

Vane 是第二检索索引，不是 SQLite 替代品：
- SQLite / Story Graph：结构化事实与当前续写状态的权威来源。
- library/index.json 与 corpus-craft JSON：可重建原始/派生素材。
- Vane：可选的中文 BM25 或 embedding + BM25 混合检索索引。

Node binding @vane-rs/node 按需安装，不成为默认必需依赖。vane-index 重建每个 world 独立的 worlds/<world>/vane-index。没有 embedding endpoint 时使用文本检索；配置 OpenAI-compatible embeddings endpoint 后启用 hybrid。Vane 当前 Node binding 不暴露 metadata filter，因此不依赖查询过滤，world 隔离通过独立索引目录完成。

Vane 未安装、索引缺失或查询失败时，写作必须继续使用现有 SQLite/BM25 路径；不得因为可选检索基础设施不可用而阻断小说生成。

## 不做

- 不用分析指标评价小说质量，不生成固定句长、段落、对白比例目标。
- 不把人物声音简化成几个性格标签，不要求人物永远保持同一种说话方式。
- 不把先后发生当作因果，不把推断升级为正史。
- 不增加向量数据库服务、独立图数据库或新的 Agent 运行时。
- 不将 Vane 设为 SQLite 或现有 BM25 的唯一依赖。

## 验收与运行

1. 完成 ingest 和 chapter-index 后，analyze-corpus-craft 可按章节增量分析、断点续跑。
2. 不含逐字证据的分析项不会进入缓存。
3. 普通 write 和 write-long 自动读取相关素材，注入量有上限。
4. Vane 未安装时写作仍可正常运行；安装并构建索引后可返回原文/离线素材命中。
5. 重新导入原文或更新分析后可重建 Vane 索引。
6. 在本机语料环境运行 npm run typecheck、npm test、npm run build，并用实际续写任务对照启用前后的素材召回与正文质量。

代码提交不等同于本机原文分析完成；完整离线分析与 Vane 索引构建需在拥有本机语料和 embedding 服务的环境执行。
