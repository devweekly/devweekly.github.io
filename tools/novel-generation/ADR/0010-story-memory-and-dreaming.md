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
