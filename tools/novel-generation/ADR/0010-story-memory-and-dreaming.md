# ADR-0010：Story Memory & Dreaming

- 状态：Accepted（分阶段实施）
- 日期：2026-11-11
- 范围：`tools/novel-generation`
- 参考：Anthropic, [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory)

## 背景

项目已经具备完整生成轨迹、原文检索、Story State、人物档案、Story Graph、伏笔与关系历史，以及章节审核和修改记录。当前缺少的是从长期创作经历中提炼少量可复用经验，并在后续任务中按需调用的能力。

本 ADR 不建立第二套故事事实库，也不把章节摘要、日志或人物当前状态复制成长期记忆。

## 不可妥协的设计原则

1. **不需要记下所有细节。** Transcript、正文、原文和审核产物负责完整留痕；Memory 只保存未来创作不容易从原始材料直接恢复、且有长期价值的经验。
2. **只记隐性规则，不记易变事实。** 人物当前状态、地点、装备、关系快照、事件结果、伏笔状态和时间线属于 Canon / Story State，按需检索；Memory 只保留跨场景可复用的行为倾向、叙事经验、创意启发和经过验证的工作经验。
3. **别用死板的 Prompt 限制模型。** Memory 是灵感和参考，不是规则、清单、人物模板或验收标准。模型可以忽略、改造、反驳或突破记忆，不得为了体现记忆而牺牲当前创作。
4. **文学性、文笔、艺术风格，高于其他一切。** 连续性和记忆准确性服务于小说，不得把创作变成数据库字段的执行。

## 决策

### 1. 原始记录、Canon 与 Memory 分层

- Transcript：现有 `.output/agent-calls`、章节运行目录、审核和修订产物，作为可追溯原始记录。
- Canon / Story State：现有 `novel.db`、`story.db`、Story Graph、原文索引和章节正文，作为故事事实来源。
- Memory：仅保存隐性、可复用的创作经验。不得复制完整事实、章节摘要或当前状态。

不新增独立数据库或图数据库。Memory 存入每个故事宇宙自己的 `story.db`，遵守现有 world 隔离和事务写入约束。

### 2. 记忆类型

- Narrative：人物行为/互动的复杂模式、叙事节奏、信息揭示、有效场景处理等经验。
- Creative：尚未使用但值得保留的创意方向、可能的组合与探索线索；不得自动升级为剧情计划或 Canon。
- Operational：有生成/审核证据支持的 Agent 工作经验。

类型只是检索元数据，不代表额外创建多个 Agent 或数据库。

### 3. Dreaming 生命周期

在完整故事单元或合适的创作节点结束后，Dreaming 读取已完成章节及相关审核/修订记录，提出最多少量候选经验。

- 每条记忆必须关联可回查的原始证据。
- 证据必须能在来源材料中逐字定位。
- 没有长期价值就不创建记忆。
- 相同经验需要来自不同运行记录的独立证据，才可进入常规检索上下文。
- 记忆保留来源、出现次数、状态和更新时间；允许后续淘汰或修订。
- Dreaming 不得直接修改 Canon、Story State、人物档案或 Story Graph。

### 4. 动态上下文组装

Context Builder 根据当前创作任务，从已被独立证据重复支持的记忆中选择少量相关条目。只将其作为可选启发注入，不加载全部记忆，不设置人物行为硬约束，不创建固定文风指标。

Canon 事实仍由现有 writing brief、Story State、Graph 和原文检索提供；Memory 不承担事实检索职责。

### 5. 持久化与一致性

复用 `story.db`，增加轻量 `story_memories` 表。写入统一经 `database.ts` 事务函数；以 worldId 隔离；证据按 runId 去重；不在章节状态整体替换时删除 Memory。

### 6. 质量验证

验证记忆是否帮助后续创作，而不是统计记忆数量。重点观察人物是否更立体、互动是否更自然、叙事是否减少重复、语言是否更有力量，以及模型是否仍然保有意外性和突破旧经验的自由。

## 分阶段实施

- Phase 1：Story DB 记忆表、证据关联、Dreaming 候选提取、重复证据晋级。
- Phase 2：将动态 Memory Context Builder 接入普通章节和长章节写作。
- Phase 3：完整故事单元自然收束后自动触发一次 Dreaming（跨章节聚合，不对每章单独调用）；Workbench API 支持查看证据、修订内容及淘汰/恢复记忆。生成质量对照评估仍作为下一阶段。

## 明确不做

- 不保存所有细节或每章摘要作为长期记忆。
- 不把易变事实、人物当前状态和剧情状态写进隐性经验记忆。
- 不自动把单次模型推断当成长期规律。
- 不用固定 Prompt 规定人物行为、剧情走向或文风。
- 不增加专职 Memory Agent 群，不引入新数据库服务。
- 不让 Memory 成为写作门禁，不因记忆缺失阻断生成。

**最终目标：让系统从长期创作中积累少量真正有用的隐性经验，并在未来创作中灵活运用，而不是让模型服从一套越来越庞大的规则。**


## Phase 3 实施补充（2026-11-11）

- 只有 `complete_story` 模式经过故事进展评估、自然收束并进入 `completed` 后，才自动触发一次 Dreaming；固定数量批次、暂停、失败和停滞均不触发。
- Dreaming 聚合该故事执行已完成章节的正文及有限审核材料，在一个故事单元结束时调用一次，不增加逐章 LLM 开销。
- 通过 `.output/<world>/story-memory-dreaming/<execution-id>.json` 保存执行结果/失败状态；同一执行恢复时可识别已处理记录。Dreaming 失败只留下诊断，不影响已经完成的故事。
- Workbench API：`GET /api/worlds/:worldId/story-memories?status=all|candidate|active`；`PATCH /api/worlds/:worldId/story-memories/:memoryId` 支持修订内容/范围以及 candidate、active、superseded、rejected 状态。来源证据与原始引用不可由编辑接口覆盖。


## Phase 4 实施补充：成对盲测（2026-11-11）

- 新增 `evaluate-story-memory` 成对实验脚本：使用相同 world、Story State、brief、来源材料、检索参数和模型，分别执行 Memory On / Off 两次完整写作 pipeline。
- 两臂都使用 `--no-apply-state`，不提交 Canon / Story State / Story Arc，不污染后续生成；唯一计划变量是是否注入长期 Story Memory 上下文。
- 执行顺序和 A/B 标签分别随机化；盲评材料与 assignment key 分开保存，避免评审者先知道哪版注入记忆。
- 评估维度聚焦人物复杂度、互动张力、叙事节奏、语言力量、创意意外性和整体文学完成度；保留具体段落证据和反证检查。
- 不使用同一个模型自动给自己评分，不把一次实验结果自动写回记忆库。应在不同故事任务上重复实验，只有稳定改善文学质量且没有明显损害意外性时，才认为记忆机制有效。
- 实验产物和两臂完整原始日志保存在 `.output/<world>/story-memory-evaluation/<run-id>/`；A/B 正文位于 `blind/`，映射密钥单独存放。

## Phase 5 实施补充：检索与记忆治理（2026-11-11）

- 检索评分使用归一化的内容重合度，并把适用范围纳入相关性计算，避免长记忆仅因字符数量多而占优；流程类任务对 operational 经验给予轻量相关性加权。仍只取少量条目，Memory 不成为事实检索层。
- Dreaming 对长章节使用开头、中段、结尾代表性摘录供模型判断，但证据定位始终在完整原始文件上验证；避免只检查章节前 5000 字而漏掉后段的重要经验。
- 新候选与既有同类型记忆进行保守的字符片段相似度匹配；高相似候选复用既有记忆 ID，累积独立证据，避免模型措辞略有变化就制造永远无法晋级的近重复条目。相似度不足时不自动合并。
- 来源证据不再只保留最近 8 条；所有独立执行的证据与原始引用持续保留，避免旧 run ID 被截断后再次执行时重复计数。
- Workbench 支持按 candidate、active、superseded、rejected 分别筛选，证据可查看，内容/范围可修订，记忆可淘汰或恢复；恢复 active 仍需至少两次独立执行证据。
- 不设置简单的按时间自动过期：隐性经验不是人物当前状态，不能因为久未调用就判定失效。若经验被新证据推翻，应在 Workbench 标记为 superseded/rejected；当前尚不自动推断语义矛盾，避免错误地删除仍有价值的经验。
- 章节状态快照替换不影响记忆表；记忆的晋级、修订、淘汰和证据保留均独立于 Canon / Story State。


## Phase 6 实施补充：文学经验综合与 Creative Compass（2026-11-11）

- Dreaming 在提炼新经验时同时读取少量既有 active memories，尝试跨故事单元发现语言气质、人物复杂性、叙事张力和创意潜力；保留情境差异与表面矛盾，不把不同经验平均成固定套路。
- 同一轮 Dreaming 可生成一个不超过 1200 字的 creative-compass.md，保存于 worlds/<world>/story-memory/。它是由原始创作材料和既有记忆派生的轻量创作方向摘要，不是 Canon、事实源或强制 Style Rules；缺失或生成失败不影响章节写作。
- 普通章节和长章节通过现有 Memory Context Builder 读取 Creative Compass，与相关 active memories 一起作为可选启发注入；继续遵守原有上下文预算，不增加 Agent、数据库表或审核阶段。
- 检索根据当前 brief 中的对白、冲突、动作、情绪转折、信息揭示、场景转换、环境氛围等线索补充少量意图词，帮助 scope 匹配当前戏剧情境；不引入新向量服务。
- 明确允许 Dreaming 提出只出现一次、但有强原文证据和文学启发价值的 creative candidate。它仍然遵守原有候选/晋级机制，不会因一次出现直接成为 active。
- 不引入自动风格打分、句式配额、人物行为模板、创作门禁或自动淘汰旧记忆。


## Phase 7 实施补充：风格锚定、创意火花与记忆可追溯（2026-11-11）

- Dreaming 读取当前 world 已激活的 `style-profile.md` 与最多三个活动 Style Reference 样本。它们是风格判断的首要参考；生成章节只用于观察本次执行表现，不能成为唯一风格来源，更不能把模型模仿偏差沉淀为“原作者风格”。
- 风格资料只作为 Dreaming 的输入锚点，不复制独特句式、不把抽象特征转成硬性指标；没有正式资料时明确不臆造风格结论。
- 场景相关检索可纳入最多两条相关的 creative candidate，权重低于 active memory，并明确标注“未验证创意火花”。它们只用于启发，不成为事实、剧情要求或写作规则；candidate 的双独立执行晋级机制保持不变。
- Dreaming 的章节样本保留故事开头、中段和结尾，并利用已有 review/reader/literary/revision 记录中的亮点、人物互动变化、创意和叙事张力信号选择额外代表章节。仍限制最多五章，不增加评估 Agent。
- Creative Compass 更新前先保存旧版本到 `story-memory/.history/`，再通过临时文件原子替换当前版本。Workbench 的创作记忆页只读展示当前 Compass 和历史版本元数据；历史版本不进入写作上下文。
- 不增加 Agent、数据库表、审核 gate 或新风格评分流程；文学性、文笔、艺术风格仍优先于记忆复现。
