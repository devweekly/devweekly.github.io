# ADR 0007：保守的局部文学编辑与审核链路减负

- 状态：Accepted
- 日期：2026-11-10
- 范围：`tools/novel-generation`
- 取代：ADR 0004 中关于常规章节每章执行 Anti-AI 诊断/整章编辑/整章复核、每章自动 Style Regression，以及后置文风观察的默认流水线决策；ADR 0004 的文学优先、Living Voice、Reader 隔离等原则继续有效。

## 背景

最近一次实际生成显示，Writer 初稿中的“他站着，没动，也没人跟他说话。”比文学编辑后的“他站着，等眼睛从暗里缓过来。湿气从领口往里钻，衣服很快贴在身上。”更有叙事力量。初稿通过人物静止和无人交谈形成孤立感与悬置；编辑器却把留白误判为描写不足，主动增加常见的感官动作和环境描写。

根因不是单个模型或某句 Prompt，而是阶段职责重叠：整章文学编辑先重写全文，Anti-AI 诊断再找问题，Anti-AI 编辑再次重写全文，独立复核又只能整章 keep/restore。后置 Style Regression 和 Post-review Literary Check 只产出观察报告，不改变正文或验收结果，却持续增加模型调用。终审还允许两轮自动修复，可能让同一硬伤多次进入模型。

此外，新宇宙创建会后台构建知识资料，章节生成此前可与其并行。第一章可能在 Style Profile、人物档案、人物状态和 as-of dossier 尚未就绪时启动，形成知识准备竞态。

## 决策

### 1. 文学编辑默认保留原稿

文学编辑不是第二个 Writer。初稿已经成立时，输出 `decision=preserve` 和空 edits 是成功结果，不需要制造编辑差异。

必须保护有效留白、沉默、停顿、短句、长句、口语、粗粝表达、闲笔、有意重复、人物判断和自然段落收束。不得把“不描写”当成缺陷，不得主动补充动作、心理、环境、气味、湿度、光线、声音、比喻或拟人来证明编辑工作。

### 2. 整章重写改为精确 Patch

普通章节和长章节统一调用一次文学 Patch 编辑器。返回 JSON：
- `decision`: `preserve` 或 `edit`
- `reason`: 整体判断
- `edits[]`: `before`、`after`、`reason`

每个 `before` 必须是当前正文中逐字连续且唯一的锚点。应用器只接受唯一、非重叠锚点；缺失、重复或重叠的 Patch 单独拒绝。Patch 不能定位时不得猜测，不得扩大范围。拒绝一个 Patch 不影响其他 Patch，也不触发整章回滚。原稿、Patch 原始 JSON、应用结果分别保留。

### 3. 删除重复的常规文风审核

从常规章节生成链路中删除：
- 整章 Literary Rewrite；
- Anti-AI 全章诊断；
- Anti-AI 全章改写；
- 独立全章 keep/restore 复核；
- 每章只读 Style Regression；
- 硬伤修复后的 Post-review Literary Check。

Style Regression 保留为显式专项评估工具；Reader 保留为可选盲读观察。两者均不参与常规章节门禁。

### 4. 保留必要的硬伤与技术检查

硬伤终审只检查会让故事无法成立或读者无法理解的明确问题：事实冲突、因果断裂、人物知识越界、能力/世界规则冲突、人物位置和时间线矛盾。文风偏好、人物弧光是否按计划推进、伏笔是否回收、节奏是否符合模板不得进入硬伤门禁。

普通章节和长章节最多执行一轮自动修复，之后复查一次。未解决的明确硬伤仍安全阻止 Story State 提交。状态提取的 schema 校验、必要的格式修复重试、Story State 持久化验证和确定性 Iron Laws 检查保留；这些是数据完整性边界，不是重复文学审核。

### 5. 新宇宙最低知识准备自动就绪

新宇宙的章节生成任务可以先排队，但 CLI 写作进程必须等待以下最低上下文准备完成：
- `style-profile`
- `character-profiles`
- `character-states`
- `as-of-dossier`

服务器启动或恢复知识构建任务后，立即返回任务状态；等待发生在后台 CLI 子进程内，不要求用户手动等待或点击。可选的 `corpus-craft` 与 Vane 索引不阻塞写作。若必需步骤未完成则安全停止，保留已有阶段缓存；重新触发知识构建时复用已完成步骤，不得把空上下文视为准备成功。

### 6. 阶段产物与缓存

阶段产物不得通过后续阶段写入而覆盖原始生成结果。Patch 原始响应、Patch 应用记录和应用后正文分别保存。阶段缓存必须继续按完整 Prompt、模型与阶段配置生成指纹，并以实际输出哈希校验；任何后处理都不得静默覆盖已缓存的原始输出文件。

## 预期流水线

普通章节：

`Story Arc / Plot / Ideas → Chapter Plan → Writer Draft → Literary Patch (preserve by default) → One Hard-issue Review → At most One Repair + Re-review → State Extraction / Validation / Commit`

长章节：

`Scene Blueprint → Scene Writing / Scene Polish → Literary Patch (preserve by default) → One Cross-scene Hard-issue Review → At most One Targeted Repair + Re-review → State Extraction / Validation / Commit`

## 验收标准

1. 本次留白回归样例默认返回 preserve，不新增“等眼睛适应”或环境感官描写。
2. 文学编辑输出局部 Patch JSON，不输出整章正文。
3. Patch 应用器只接受唯一、精确、非重叠锚点；无效 Patch 独立拒绝。
4. 普通章节与长章节均不再执行重复的 Anti-AI 诊断/整章改写/整章复核。
5. 常规章节不自动执行只读 Style Regression 和 Post-review Literary Check。
6. 硬伤终审最多一轮修复，未解决的明确硬伤仍阻止状态提交。
7. 新宇宙首章在最低知识上下文就绪前保持排队；失败时安全停止并保留缓存，不能在空上下文下写作。
8. Reader 仍可显式启用，但不参与门禁。
9. 原始草稿、Patch、应用记录、终审与状态提取产物可独立追溯。
