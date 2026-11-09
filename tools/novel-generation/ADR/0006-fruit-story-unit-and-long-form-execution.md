# ADR 0006：果实故事单元、长篇故事执行与章节历史导航

- 状态：Accepted（第一版服务端执行闭环已落地；持续完善与端到端验证中）
- 日期：2026-11-08
- 相关决策：ADR 0001（文学性优先）、ADR 0002（故事图谱）、ADR 0003（自主执行）、ADR 0004（滚动式多章节规划）、ADR 0005（独立故事宇宙）

## 背景与问题

当前 Workbench 的主交互仍然是“生成下一章”。Story Plan 是长期方向，Story Arc 是滚动的中期规划（通常 5–8 章），两者都不等于一个完整、可独立阅读、从开端发展到结局的故事。尤其在《从姑获鸟开始》式的创作中，一个果实/副本通常包含独特的地方社会、历史处境、文化民俗、怪谈规则、人物群像和多条相互作用的事件线。只维护“下一章”会使创作缺少完整的故事目标和人物发展空间。

用户提出的“30 章”仅为规模示例，不是固定章节数、默认值或上限。系统必须根据故事复杂度和自然叙事节奏决定篇幅。一个完整故事可能由十几章、几十章或更多章节组成。

此外，Workbench 目前只显示最近一次章节运行。新章节生成后，之前的正文从当前视图消失，缺少章节前进、后退和直接跳转。

## 决策

### 1. 将完整故事作为一等创作单元（Story Unit）

在长期 Story Plan 与滚动 Story Arc 之间，增加完整故事单元层。一个 Story Unit 可以围绕一个果实、一个场景/地域、一段历史事件、一次人物旅程或其他独立故事核心展开；不把“果实”写死为唯一类型。

Story Unit 至少包含以下可演进资料：

- **故事核心**：故事命题、核心矛盾、主要悬念、读者体验、开端状态、最终收束状态。
- **果实/世界情境**：能力或超自然规则、代价与边界、历史和社会环境、地方地理、生产生活、权力关系。
- **文化与民俗**：地方习俗、仪式、禁忌、传说、怪谈、口耳相传的版本差异，以及这些内容如何进入人物日常和冲突。不得只堆砌设定名词。
- **人物群像**：已出场人物在该故事中的位置、动机、认知、关系和可发展空间；新人物的社会身份、欲望、秘密、利益关系及其与既有人物的交集。
- **故事推进**：主要事件链、支线、人物选择与后果、冲突升级、信息揭示、转折、高潮、结局和余韵。
- **人物发展**：人物关系变化、弧光可能性、反复与矛盾、意料之外但有内在依据的选择、高光时刻、背叛/转向/救赎等可能。所有发展方向都是创作可能性，不是必须兑现的任务。
- **开放问题**：有意保留的未知、可替代解释和后续创作空间。

### 2. 规划不是固定章节清单

Story Unit 先建立完整故事的因果骨架和结局方向，再按叙事需要拆解为若干 Story Arc；每个 Arc 再滚动细化为 Chapter Plan 和 Scene。章节数由情节自然复杂度决定，不使用固定 30 章模板，也不把模型输出的初始章数当作硬上限。

完整故事规划必须覆盖从开端到收尾的结构完整性，但不预先规定每章的句子、动作和情绪。实际写作可以发现更好的方向：已发生事实和已完成正文不可被计划覆盖，未执行部分允许自动修订。可以新增、合并、拆分、延后或放弃章节，只要故事最终仍然获得真实的叙事收束。

### 3. 长篇执行模式

提供三种明确不同的写作操作：

- **单章生成**：只执行下一章。
- **连续生成若干章**：用户指定本次执行数量；服务端逐章串行运行，每章必须以前一章已通过终审且已提交的正文和状态为基础。失败时停止后续章节，保存已完成章节和失败 checkpoint，可恢复。
- **完成整个故事**：以一个 Story Unit 为目标，自动规划/修订后续 Arc 和章节，持续执行，直到故事规划和实际叙事均达到自然收束。不得以固定章节数或“生成了 N 章”作为完成条件。每章完成后评估故事是否真正结束；若尚未结束，继续扩展未完成的因果链。若规划与正文冲突，先尊重正文，再修订未来计划。

“完成整个故事”是长任务，必须有服务端持久化的任务记录、逐章进度、当前 Arc/章节、恢复点、停止原因和最终完成判定；浏览器关闭或服务重启不能丢失任务状态。不能只用前端循环多次调用单章 API 来冒充完整故事执行。

### 4. 章节历史导航

- 章节运行记录是章节历史的索引；每个已完成章节都可独立打开。
- 提供上一章、下一章、章节列表/跳转；生成新章只切换当前选中章节，不覆盖历史正文。
- 历史章节正文、对应 Story Arc/Chapter Plan、运行状态和诊断产物均可查看。
- 导航顺序必须稳定，优先使用明确的故事顺序/前序关系；不得单纯依赖异步完成时间推断章节顺序。
- 正在生成的章节可以查看实时预览，但不能被误认为已完成章节。

### 5. 数据与执行边界

- Story Unit、Story Arc、Chapter Plan 和执行任务必须有稳定 ID、版本、状态、时间戳及明确的所属 world/universe。
- 计划与运行记录是创作控制资料，不等同于正史。只有最终正文实际发生的事实才能进入 Story State。
- 故事单元内的角色、事件、伏笔、MacGuffin 与已有 Story Graph 通过稳定 ID/明确实体关联；不另建重复图数据库。
- 计划可持久化为结构化 JSON/SQLite，但正文仍作为独立章节文件保存。运行状态与进度应能检查、恢复。
- 多章节任务严格串行，不并发写同一份 Story State；每章通过现有质量门禁并成功提交状态后才可继续。
- 失败、取消或中断不得把未完成任务标为成功；已完成章节不得回滚或丢失。

### 6. 文学性优先

“文学性、文笔、艺术风格，高于其他一切”仍是最高原则。Story Unit 是帮助作者构思完整故事的活资料，不是剧情合同或任务清单。民俗与怪谈要融入生活、人物选择和具体场景；人物不能沦为功能角色；不得为满足结构、角色弧光、伏笔回收率或章节数量牺牲文笔。结尾可以开放、含蓄或带余韵，只要核心故事获得有意义的收束，不强迫所有问题解释清楚。

## 实施顺序

1. 章节历史导航：先修复生成新章后旧正文不可见的问题。
2. 多章连续生成：提供显式数量、服务端持久化批次任务、逐章串行和失败恢复。
3. Story Unit 规划：建立完整果实/场景/故事蓝图及人物群像、文化民俗和怪谈资料，并在 Workbench 可查看、可持续修订。
4. 完整故事执行：将 Story Unit 与滚动 Story Arc、单章 pipeline 连接，增加故事完成判定、动态扩展和可恢复执行。
5. 验收与记录：为规划 schema、任务状态机、顺序、恢复、完成判定和前端导航补充测试。

## 验收标准

1. 创建一个故事单元时，能形成可读的完整故事构思，覆盖世界/果实、文化民俗、怪谈、人物群像、主要事件链和自然结局。
2. 已出场人物与新人物都能进入故事规划；人物发展是开放可能性，不是强制弧光。
3. 故事单元能拆解为多个 Story Arc 和动态数量的章节；不存在 30 章固定上限或模板。
4. 完整故事执行从开端推进至自然收尾；不以达到预设章数宣告完成。
5. 多章任务逐章执行，上一章未通过终审/状态提交时不得开始下一章。
6. 浏览器刷新或服务重启后，长任务可查看状态并从最后一个有效 checkpoint 恢复。
7. 新章生成后，用户仍能通过上一章/下一章/列表查看所有历史章节。
8. 文学表达优先于规划完整度；任何计划都不能反向强迫正文服从。


## 当前实施状态（2026-11-08）

- 已落地 Story Unit 结构化 Schema、生成与文件持久化；其中保存执行状态、已完成章节 ID、未解决核心线和下一步方向。
- 已落地服务端 Story Execution 任务记录与 API。任务状态包含 queued/running/paused/completed/failed/cancelled/stalled，章节检查点保存已通过现有终审且 Story State 已提交的正文路径。
- 长篇执行在服务端逐章串行调用现有 CLI 写作 pipeline。每章完成后读取实际正文与已提交 Story State，重新判断故事阶段和下一步方向；不按固定章节数完成。
- 指定数量连续生成同样由服务端持久化 fixed-batch 任务执行，数量由用户输入，不设 30 章硬上限。批次只在目标数量完成时结束，不修改完整故事的自然收束判定。
- 完成判定要求核心冲突已解决、结尾自然、判断置信度高、无未解决核心线，并且 Story Spine 的重要阶段已发生或被正文中更好的发展自然替代。世界谜团与有意留白不要求全部解释。
- 完整故事任务与指定数量批次任务均支持暂停、恢复、取消。服务重启后，running/queued 任务恢复为 paused；已完成章节不回滚，可从最近有效章节继续。
- 连续四章没有推动故事方向或改变未解决核心线时标记 stalled，防止无意义循环；stalled 不等于故事完成。
- Workbench 已增加完整故事执行入口、任务状态、进度、最近判断与控制操作。
- 仍待完善：Story Unit 的阶段/章节拆分可视化、独立故事单元多版本管理、Story Execution 任务的更细粒度当前章节日志，以及真实模型端到端验收。当前完整故事执行已具备第一版服务端闭环，但不能宣称这些后续能力已经完成。


### 检查点恢复与完成判定补充（2026-11-08）

代码审查发现两个需要明确的安全条件，作为本 ADR 的补充约束：

1. **自然收束必须清空必需的剩余工作**：即使模型判断核心冲突已解决、结尾自然、未解决核心线和未兑现主阶段均为空，只要 `remainingStoryWork` 仍列有本故事必须完成的叙事工作，就不能标记 completed。可留白的世界谜团不属于必需剩余工作，应由评估 Agent 明确区分。
2. **恢复必须以任务自己的检查点为准**：恢复任务时优先使用 Story Execution 中最后一个已完成章节路径，不得仅按全局最新章节记录推断续写位置。任务持久化的 `currentRunId` 用于覆盖“章节运行已完成、任务检查点尚未写入”这一崩溃窗口：恢复时查询该确切运行记录，若已完成则补写检查点；若未完成则回退到上一个有效检查点。
3. **检查点正文必须属于当前 World 输出目录**：评估或恢复前验证路径归属，拒绝跨宇宙、越界或外部文件路径，避免错误续写和状态串线。
4. **检查点恢复异常必须进入任务失败状态**：不能因恢复逻辑在主执行 try/catch 之外抛错而留下无法解释的 paused 任务。
5. **批次最后一章的崩溃窗口**：若服务在最后一章已完成、但批次任务尚未写入 completed 时退出，恢复时补齐最后一个章节检查点后必须重新判断目标数量并将批次标记 completed，不能留下没有后续章节可执行的 running 任务。

对应实现已补充到 Story Unit 完成门禁、Story Execution 持久化恢复与服务端执行逻辑，并增加剩余工作判定和 currentRunId 持久化测试。


### 滚动重规划与执行可观测性补充（2026-11-08）

- 每章通过终审并提交 Story State 后，不仅评估是否自然收束，还要重新审视完整 Story Spine。阶段状态为 planned / in_progress / completed / replaced；模型可以根据实际正文替换未发生的阶段、补入更符合因果的新阶段，但不得覆盖已发生事实。已标记 completed 的阶段在后续重规划中保持完成状态。
- 人物发展评估只记录正文与 Story State 能够支持的变化，并将观察结果、所属章节及开放的后续可能写入 Story Unit 执行历史。人物弧光仍是创作可能性，不是必须兑现的任务。
- Story Execution 持久化有界事件时间线，记录任务创建/恢复、章节开始/完成、故事评估、暂停、停滞、失败、取消和自然收束。Workbench 可以展开查看事件时间、说明及关联 Run ID。事件历史最多保留最近 500 条，避免任务长期运行造成无界增长。
- 事件时间线是诊断与审计辅助，不替代章节正文、终审结果和 Story State。


### 多 Story Unit 存储基础（2026-11-08）

为支持同一 World 内多个独立故事单元，新增 `.story-units/index.json` 与 `.story-units/<storyUnitId>.json` 的文件存储约定。Story Unit 增加稳定 UUID identity；索引只保存 ID、标题和更新时间，完整设计保存在独立 JSON 文件。读取时对旧版 `story-unit.json` 做惰性迁移：生成一个稳定的新 ID、写入新存储，同时保留旧文件不做破坏性改写。存储层拒绝跨 World 读写，并以临时文件 + rename 原子替换。

已提供存储模块、列表/读取/生成 API，以及两个单元互不覆盖和 legacy 惰性迁移测试。Story Execution schema 已增加可选的 `storyUnitId` 字段，为旧任务保留兼容性。

**尚未完成的执行隔离，不得误认为多故事端到端已经可用：**

- 当前长篇 worker 仍使用 legacy `story-unit.json` 路径；创建的新 Story Unit 尚未成为可独立执行的任务目标。
- 章节 Run、Story State、Story Arc、人物状态与章节导航仍主要以 World 为边界。仅给 Story Execution 写入 storyUnitId 不足以阻止跨故事污染。
- Workbench 尚未提供完整的多 Story Unit 切换与执行界面。
- 在章节、状态和 Arc 均完成 storyUnitId 过滤/隔离，并验证同一 World 下交替执行与恢复互不串线之前，不得开放多个 Story Unit 的并行执行入口。

下一阶段必须先让章节运行记录携带 Story Unit identity，并让写作 pipeline 的 Story State 读取/提交及 Arc 上下文限定到当前单元；随后再接入 worker 的创建、暂停、恢复和重规划。多个单元可以在同一 World 下保存，但在隔离链路完成前只能作为独立设计资料管理。


### Story Unit 执行记录隔离的基础补充（2026-11-08）

- `WorkbenchRun` 增加可选 `storyUnitId`，章节运行记录具备明确归属字段；旧记录保持兼容。
- `listStoryExecutions(worldId, storyUnitId?)` 支持按 Story Unit 过滤，并增加同一 World 两个 Story Unit 的隔离查询测试。
- 这只是执行记录的数据模型与查询基础，不代表 worker 已经完成隔离。当前长篇 worker 仍通过旧 `story-unit.json` 读写单一故事设计，章节 CLI 仍共享 World 级 Story State；创建任务的 API/UI 也尚未贯通所选 Story Unit。
- 因此当前版本仍不得将多 Story Unit 描述为可独立执行。下一阶段必须先把 `storyUnitId` 贯穿任务创建、worker、章节 Run、检查点恢复和 Story State 持久化，再开放 Workbench 多单元切换入口。

### Story Unit 执行链路隔离（2026-11-08，第二阶段）

本阶段把 storyUnitId 从任务元数据推进到实际章节生成链路：

- 长篇 Worker 和固定章节批次 Worker 按任务的 storyUnitId 加载、更新对应 .story-units/{id}.json，不再默认读写 story-unit.json。
- 章节 Run 写入 storyUnitId；长篇 Worker 选择上一章时只考虑同一 Story Unit 的章节。
- 恢复时，currentRunId 指向的 Run 必须与任务的 storyUnitId 一致；不匹配时不会将该章节补入当前任务检查点。
- 章节 CLI 的 write 命令增加 --state-file 和 --story-unit-file 参数。长篇 Worker 为每个 Story Unit 使用独立的 .story-units/{id}/story-state.json。该目录也作为 Story State SQLite 的根目录，避免多个单元共享同一份 SQLite 状态。
- 进度评估读取当前 Story Unit 自己的 Story State。世界 Bible、原著语料、检索索引仍是 World 共享知识，不应与故事单元自己的剧情进度混为一谈。
- Story Execution 列表 API 支持 ?storyUnitId= 过滤；创建完整故事和批量章节任务 API 接受 storyUnitId。

**仍未完成：** Workbench 尚未提供 Story Unit 选择和切换 UI；单章生成、旧版 /story-unit API、部分世界级分析/卷级 Arc 仍保留旧路径或 World 级语义。当前 Worker 按 Story Unit 隔离的是长篇/批量执行路径，不应扩大解释为整个 Workbench 已完成多单元隔离。并发执行仍按 World 串行，避免共享知识构建和现有 World 级写操作互相竞争。

### Workbench 多 Story Unit 入口与滚动故事阶段隔离（2026-11-08，第三阶段）

- Workbench 增加当前 Story Unit 选择器和新建入口；切换时重新加载该单元的故事设计、执行任务和章节历史。
- 完整故事与批量章节请求显式携带 storyUnitId；执行列表按当前单元过滤。
- Story Unit 的滚动 Story Arc 改为 .story-units/{id}/story-arc.md；CLI 可通过 --story-arc-file 指定上下文文件，避免将另一个故事单元的滚动阶段作为当前故事的写作依据。
- /story-arc API 支持 storyUnitId 查询，Workbench 显示当前单元的滚动阶段。
- 原著卷级梗概和 World Bible 仍是 World 共享的原著知识，不属于 Story Unit 的剧情进度；不复制、不改写原著事实。

注意：旧版单章生成入口仍使用 World 级路径，尚未完整接入 Story Unit；切换单元后应优先使用完整故事执行或批量章节执行。Story Arc 仅完成上下文读取隔离，卷级原著 Arc 仍然是共享资料。需要继续完成单章生成入口、人物/伏笔图谱写入边界及跨单元暂停恢复集成测试。

- Workbench 选中 Story Unit 时禁用旧版 World 级「生成下一章」按钮，避免用户从旧入口写入共享状态；使用单元级完整故事或连续章节执行。未选择单元时保留旧版兼容入口。

### 单章生成与章节历史的 Story Unit 归属（2026-11-08，第四阶段）

- `POST /api/worlds/:worldId/chapters/generate` 接受 `storyUnitId`，并校验该单元确实属于当前 World。
- 单章 Run 写入 `storyUnitId`；上一章选择、活跃章节冲突检测均限制在同一 Story Unit 内。
- 单章 CLI 与长篇 Worker 一致，传入单元级 `--state-file`、`--story-unit-file`、`--story-arc-file`，避免单章入口绕过隔离。
- `/runs` API 支持 `storyUnitId` 过滤；`storyUnitId=legacy` 查询尚未归属 Story Unit 的旧记录。存储层 `listRuns(worldId, storyUnitId)` 提供同样的过滤语义。
- Workbench 单章续写按钮现在可以在选中单元时使用，并向 API 传递当前 `storyUnitId`。
- 增加 Workbench Store 测试，验证 Unit A、Unit B 和 legacy 运行历史互不混淆。

说明：World 级任务锁仍然串行化同一 World 的写入；这是为了保护共享原著索引、World Bible 等资料，不代表不同 Story Unit 共用故事状态。


### 执行历史 legacy 边界与恢复归属校验（2026-11-08，第五阶段）

- Story Execution 列表过滤现在区分三种查询：不传 `storyUnitId` 表示全部；传具体 UUID 只返回该单元；传 `storyUnitId=legacy` 只返回未归属单元的旧任务。旧任务不会被默认并入新建 Story Unit。
- 检查点 Run 归属比较抽为显式规则：两个 ID 相同才属于同一单元；两个值都缺失时仅视为 legacy 对 legacy；一个缺失、一个存在，或两个不同 UUID，均不匹配。恢复流程不得把其他单元的已完成章节补入当前任务。
- Story Execution API 增加 legacy 查询入口，与章节 Run 历史保持一致。
- 新增测试覆盖 Unit A、Unit B、legacy 三类任务列表，以及同单元、跨单元、legacy/新单元之间的检查点归属判断。
- Story State SQLite 按传入的 state-file 所在目录打开；Story Unit 的 state-file 位于各自 `.story-units/{id}/` 目录，因此人物当前状态、关系变化、剧情事件、伏笔与 MacGuffin 更新，以及由该状态构建的 Story State Graph，均随单元数据库隔离。原著人物档案、原著人物逐章状态、原著卷级梗概仍保留在 World 共享的 `novel.db`，不得把原著知识误认为某个续写单元的状态。
- 这一步没有把 World 级原著分析表复制到每个单元，也没有将其改造成 Story Unit 私有数据。后续若新增跨单元衍生分析，必须显式标注数据来源与作用域，不能把不同单元的生成事实合并进原著语料或共享知识库。


### Service / Workbench 闭环补齐（2026-11-08，第六阶段）

- 续写动态图谱 API 支持 `storyUnitId`，从对应单元目录的 Story State 派生图谱；`storyUnitId=legacy` 只读取旧 World 根目录状态。指定 UUID 必须先验证属于当前 World，不能通过任意路径读取。
- 新增 Story Unit 状态只读 API，向人物工作台提供该单元已提交的人物状态、人物弧光里程碑、关系变化、剧情事件、伏笔和 MacGuffin；原著人物档案仍由共享原著数据库提供，两者在 UI 中分开展示。
- 图谱工作台在查看续写动态状态时提供 Story Unit 选择器和 legacy 入口；原著全文图谱仍然是 World 共享知识，不受 Story Unit 选择器影响。
- 章节工作台移除重复的 Story Unit 选择器，并提供明确的当前单元 / legacy 章节历史切换。legacy 任务历史与当前单元执行状态分别查询，查看旧记录不会改变当前创作目标。
- 批量章节执行的上一章选择必须按 Story Unit 过滤，与完整故事执行保持一致，不能从同一 World 的其他单元继承最近章节。
- 人物工作台同时展示共享原著人物档案和所选 Story Unit 的续写人物快照、人物弧光及近期事件；切换单元时取消迟到响应，避免旧请求覆盖当前视图。


### 端到端恢复与工作台收尾（2026-11-08，第七阶段）

- 连续章节批次与完整故事执行均使用精确 Story Unit 归属判断；指定的 Story Unit 不存在时返回 404，不得静默回退到 Legacy。
- 恢复任务的 POST 在读取和更新任务前同步占用 World 级 reservation，防止并发双击恢复产生两个 Worker，或任务被写成 queued 却没有 Worker 接管。
- Worker 开始执行时重新读取持久化的 pause/cancel 标志，避免任务刚入队时用户立即暂停或取消，却被 Worker 初始化逻辑覆盖。
- 每章执行前对该 Story Unit 的权威 SQLite（story.db）、WAL/SHM、JSON 状态镜像、滚动 Story Arc 和 Story Unit 记录建立快照。章节只有通过终审并完成 Story State 提交后才保留新状态；失败章节恢复快照。
- 服务重启时，先恢复所有中断章节的前置状态，再将 Run 和 Story Execution 标记为可恢复状态。若快照归属不匹配或回滚失败，停止自动续写并保留错误，不允许带着不确定状态继续生成。
- 恢复 Story Execution 前逐一核对已提交检查点对应的 Run：必须是 completed chapter、属于同一个 Story Unit（Legacy 只匹配 Legacy），章节路径一致且位于当前 World 输出目录。
- Workbench 任务历史增加可选任务列表；可查看同一 Story Unit 或 Legacy 的历史任务。任务显示选择与 World 级执行互斥分开，查看旧任务不会错误覆盖当前活动任务锁。
- 切换 World、Story Unit 或 Legacy 历史范围时清理过期 UI 状态；人物面板在切换 World 时清除旧 Story Unit 选择和加载状态。
- 补充启动恢复测试和队列立即暂停/取消控制标志测试。


### 单章执行与长篇任务互斥闭环（2026-11-08，补充）

- 普通「生成下一章」入口也使用同一套 Story State 快照、终审后提交、失败回滚和服务重启恢复机制；不再出现长篇 Worker 有回滚保护、单章入口却直接改写 SQLite 的双轨行为。
- 单章任务启动期间设置 World 级 reservation；完整故事、批量任务和恢复任务不能在单章 Run 尚未持久化时抢先启动。长篇任务启动期间也阻止新的单章任务。
- 长篇 Worker 启动前检查 World 内所有活动章节 Run，避免在另一个 Story Unit 的单章任务尚未完成时启动 World 级长篇 Worker。
- Story Unit 设计重推演在章节或长篇任务运行期间被拒绝，避免正在写作时覆盖 Worker 正在使用的 Story Unit 设定。
- UI 的活动任务锁从当前 World 的全部执行记录计算，而不是从用户当前选中的历史任务计算；因此切换到 Legacy 或查看旧任务不会错误释放或永久占用 World 级写入锁。


- 对部署事务快照功能之前遗留的中断 Run，不伪造“状态已恢复”的结论：如果当前检查点没有前置快照，恢复流程会停止自动续写并明确提示核对 Story State，避免把可能已部分提交的章节重复生成。
- Story Unit 的 `completedChapterIds` 在恢复时从已验证的 Story Execution 检查点幂等补齐；普通单章成功后也登记 Run ID。完整故事自然收束后，单章和批量入口均拒绝继续写入该单元。
- 归档、分叉、Story Unit 设计重推演和恢复操作都检查 World 级未结束任务；暂停中的任务同样占用逻辑写入锁，避免任务暂停期间改写它的创作上下文。


### 最终补齐记录（2026-11-08，第八阶段；本节覆盖并更新前文的阶段性“仍未完成”说明）

前文第三至第七阶段中的“仍未完成”描述是当时的阶段记录，不能作为当前状态。后续实现以本节及 STORY-UNIT-ACCEPTANCE-2026-11.md 为准。

- **Story Unit 设计版本**：每次重推演前，将当前完整设计作为不可变快照写入 .story-units/{id}/versions/{versionId}.json；新增版本列表 API、版本读取和恢复 API。恢复旧版前会先归档当前版本，因此恢复操作本身也可逆。版本读取同时校验 World 与 Story Unit identity。
- **重推演上下文边界**：重推演已有 Story Unit 时，使用该单元自己的 .story-units/{id}/story-state.json，不再误读 World 根目录的 Legacy Story State。新建 Story Unit 才以 World/Legacy 状态作为初始上下文。
- **阶段可视化**：Story Spine 在 Workbench 展示 planned / in_progress / completed / replaced 状态；同时展示最近评估、下一步方向和有证据的人物发展记录。章节数量仍由故事实际发展决定。
- **人物状态视图**：按 Story State schema 展示人物动机、目标、压力、弧光转折及证据、剧情事件后果、关系变化、伏笔、MacGuffin 和主要情节线。切换 Story Unit 或 World 时先清除旧视图，再加载新状态。
- **异步 UI 请求**：章节正文预览增加独立请求序号；快速切换章节时，旧预览不能覆盖新选择。World 切换时清理旧 Story Unit、版本列表、章节和预览状态。GraphExplorer、人物状态和章节执行轮询均使用取消/代次保护。
- **恢复回滚标记修复**：启动恢复将 Run 标记为已回滚时使用中文说明；任务恢复原先只识别英文回滚标记，会将已成功回滚的章节误判为缺少事务快照。现在统一识别两种标记。若 currentRunId 指向的 Run 已不存在，恢复会失败关闭，不再静默清除指针。
- **真实 Worker 集成覆盖**：新增确定性 fake CLI 的 Service 集成测试，仍执行真实 Express API、批量 Worker、Run Store、Story Execution、Story State SQLite/JSON 持久化及检查点逻辑。按 A → B → A 顺序交替执行，验证 A 的第二章只接续 A 的第一章，A/B 人物状态和滚动 Story Arc 不串线。该测试替代模型调用，不评价真实模型的文学质量。

**自动化与人工验收边界：**

- 自动化覆盖 API 隔离、版本归档/恢复、Story Unit 存储迁移、Worker A/B/A 交替执行、Run 前章选择、状态隔离、执行检查点及恢复标记。
- CI 的 typecheck、test、build 通过只能证明代码和确定性执行路径通过，不代表真实模型生成质量或真实浏览器视觉交互已经验收。
- 真实模型端到端仍需在具备模型凭证的运行环境执行至少一次完整故事和一次中断恢复；应检查正文终审、Story State 提交、Story Spine 滚动重规划和自然收束。
- 浏览器交互需按验收文档检查 World / Story Unit / Legacy 切换、章节预览、任务暂停恢复、版本恢复和人物面板。当前仓库没有引入 Playwright 浏览器测试依赖，不把 TypeScript 构建冒充浏览器 E2E。



### 原著章节目录与宇宙起点稳定映射（2026-11-08）

- `chapter-index.json` 是正式章节列表的唯一权威来源；`library/index.json` 仅提供章节正文切片，不再通过切片分组数量定义章节目录。
- 只允许 `original.txt` 对应的切片参与原著章节对齐；优先用完整原文 SHA-256 与切片 `sourceHash` 精确筛选，旧索引无 hash 时才接受明确指向 `original.txt` 的 source 路径。其他辅助导入文件不能混入原著正文快照。
- `index-story` 与分析单元构建必须复用同一原文来源筛选和 `chapterStart` 位置校验；不能只在创建故事宇宙时做防错。未出现在正式目录中的前置说明、卷间作者说明等分组必须从章节正文和分析文本中排除，不能附加到前一个正式章节。
- 如果完整 `original.txt` 存放在项目目录之外，Create Universe 仍可使用 `library/index.json` 中明确标记为 `original.txt` 的原文切片；不能因为本地全文文件缺席，就把所有带 `sourceHash` 的原文切片全部过滤掉。若全文文件可读取，则仍必须校验 SHA-256；无全文时，重复标题仍必须有 `chapterStart` 证据，不能退化为标题猜测。辅助文件路径始终排除。
- 切片分组按正式目录顺序对齐，跳过前置内容和作者说明等非章节分组。重复章节标题必须用 `chapterStart` 与原文目录行号计算出的字符偏移确认卷与章节位置；仅凭标题或分组顺序不足以证明归属。旧索引缺少位置元数据且存在重复标题时失败关闭，不得猜测。不能使用标题 Map 去重，也不能将切片组下标作为数据库 OFFSET。
- 对于目录中存在、但没有检索切片的正式章节，优先按目录行号从原始全文恢复正文。创建宇宙时通过目录元数据计算稳定 `chapter_id`，并用 `WHERE chapter_id=?` 精确定位。
- 数据库中已有章节行必须逐项核对稳定 ID、ordinal、volume 和 title。允许 `V00-C000` 前置内容行作为索引内部记录，但它不属于正式章节集合。
- 如果正式章节没有切片且数据库也没有该章节行，只有在原始全文能够恢复正文时，才在宇宙 staging 数据库中补建对应章节目录行，并用标准 chunker 将正文重建为子宇宙 library 切片；不修改源项目数据库。这样人物/事件分析、检索和后续写作不会继续丢失该章。缺失的是已有切片的章节、数据库没有任何正式章节索引、或出现无法解释的额外 ID 时，必须失败关闭并提示执行 `index-story`。不得建议重新 `ingest`，因为 ingest 会清空派生索引。
- 子宇宙的检索切片快照和分析目录快照都按正式目录序号截断，不能再次使用原始切片组数估算边界。既有宇宙保存的 `entryChapterIndex` 不迁移、不重写。
- 创建历史宇宙前，必须确认从原著第一章到所选起点的每一章都有可验证正文（切片或原文行号回退）。不能只检查所选章节；缺少任何前情章节都应拒绝创建，避免以不完整的过去启动新故事。
- 若旧 `library/index.json` 缺少 `chapterStart`，而目录存在重复标题，创建入口必须拒绝猜测。修复旧数据时先备份 `novel.db` 与 library 索引，再重建原文切片以补齐 `sourceHash` / `chapterStart`，随后执行 `index-story` 并重建受影响的派生分析；不能把重新 ingest 当成无副作用的修复。
- 回归测试覆盖非章节分组、跨卷同名章节、缺少切片的目录章节、原文行号回退、稳定 ID 定位和边界快照。

本规则是历史宇宙防止未来剧情泄漏的安全边界。任何目录映射失败都应终止创建，不能通过放宽标题唯一性或退回 OFFSET 方式“修复”。

### 原文项目根目录语料解析与派生索引恢复（2026-11-09）

- 原文项目的 canonical corpus 按项目约定位于 `original.txt`，不要求复制到 `worlds/<world>/original.txt`。服务端原文路径解析优先读取项目根目录全文，并兼容旧 world-local 布局。
- 子宇宙是例外：它必须使用自己的 `worlds/<universe>/original.txt` bounded copy，绝不能因为项目根目录存在全文而回退读取全书，避免未来剧情泄漏。
- `library/index.json` 是检索派生缓存，不是章节目录存在的前提。缺失时允许用 `analysis/<world>/chapter-index.json` 的正式目录和原文行号重建章节正文与 bounded chunks；损坏的 JSON 或不一致的位置证据仍应报错，不做静默猜测。
- Workbench 必须区分“目录为空”和“目录 API 加载失败”。加载错误要展示实际错误信息，且不能因章节接口失败清空已成功加载的宇宙列表。
- 回归测试覆盖根目录原文文件存在、world-local 原文和 library index 均不存在的章节目录加载场景。

### 原文离线资产的统一路径、时点截断与旧宇宙迁移（2026-11-09）

- 原文项目的 canonical corpus 位于项目根目录 `original.txt`；旧布局 `worlds/<world>/original.txt` 仅作为兼容回退。服务端、`index-story`、分析单元、回归和引用核验必须使用同一解析规则，不能有的入口读项目根目录、有的入口只读 world-local 文件。
- 历史宇宙必须使用自己的 `worlds/<universe>/original.txt` bounded copy。该文件缺失时，普通解析不得回退读取项目根目录完整原著。旧宇宙修复只能显式读取来源原著，在内部计算起点边界后写入 bounded prefix。
- Create Universe 将全文截断到所选章节之后的下一正式章节标题行之前；若存在下一章但其目录行号缺失或超出全文范围，必须失败关闭。选中原著最后一章时保留全文，因为目录中不存在更晚章节。
- Fork 先验证/修复父宇宙本地原文边界，再从父宇宙 bounded copy 派生子副本；若父宇宙副本缺失，可从来源原文重新物化同一边界的 bounded prefix。任何路径都不能把完整源文件复制进子宇宙。
- 子宇宙 library 的所有原文切片都必须将 `source` 重绑定为本地 `worlds/<universe>/original.txt`，将 `sourceHash` 重算为 bounded 文件 SHA-256；章节内字符偏移和 `chapterStart` 保持前缀位置不变。旧库迁移时按原文目录和 `chapterStart` 重新对齐，只保留起点及之前章节，辅助来源与未来章节切片不得保留。
- 子宇宙 `analysis/<universe>/chapter-index.json` 的章节集合必须按起点截断，`totalLines` 与 bounded `original.txt` 的实际行数一致，最后保留卷的 `endLine` 不得越过该边界。
- 旧版本创建的宇宙可能曾将完整 `original.txt` 复制到本地，且 library hash 仍指向完整原文。本次增加幂等迁移：在解析 bounded retrieval library 前先修复原文、library provenance 和 bounded catalog；缺少本地副本时只从来源全文重建 bounded prefix；起点身份、行号或 hash 无法验证时失败关闭。
- `index-story` / `buildAnalysisUnits` 在加载 library chunks 之前执行上述迁移，避免先读入旧 hash、后截断文件导致内存中的旧切片全部被过滤。CLI 的 `analyze-world collect` 与 `regress` 也必须读取宇宙本地 bounded 原文；历史宇宙不能通过 `--source` 覆盖为完整原著。
- 回归测试覆盖：根目录原文且 world-local 原文/library index 缺失；新宇宙原文与切片均只到起点；切片 source/hash 与本地 bounded 文件一致；`buildAnalysisUnits` 能在截断后重建；旧宇宙完整副本迁移与缺失副本重建；重复迁移幂等；历史宇宙缺少本地副本时绝不静默回退完整原著。

### 私有导入资料与可提交知识库隔离（2026-11-09）

- `private/` 路径下的导入文件，以及项目根目录之外的导入文件，按本机私有资料处理。其切片只写入被 Git 忽略的 `worlds/<world>/private-library/index.json`；不能混入可提交的 `library/index.json`。
- 运行时 `searchLibrary` 将公共索引与本机 private-library 合并检索，因此私有资料仍可辅助写作；`loadLibraryChunks`、`index-story`、`analyze`、`analyze-story` 和 Story Unit 正史分析只读取公共索引，不把私有文件写入共享章节目录、人物图谱或知识库。
- 私有切片不生成公共 `annotations.json`、`entities.json` 或 `novel.db` 标注/实体证据。私有索引不参与 Create/Fork 继承，子宇宙不会继承父世界本机私有资料。
- 旧版本可能把 `private/` 或外部路径的切片写入公共 library，并把引文证据写入 `annotations.json`、`entities.json` 和 `novel.db`。首次启动 Workbench、解析 library 或导入文件时执行迁移：将私有切片移入 private-library，从公共 index 删除，并清除可能混入私有引文的标注/实体 JSON 与 SQLite 表。公共标注可重新运行 `analyze`。
- `private-library/` 目录必须被 `.gitignore` 排除；不得因创建宇宙、分叉或打包审核资料而复制。

### 离线语料文件生命周期与故事宇宙隔离（2026-11-09）

**决定：** 将原著全文视为唯一 canonical source；章节目录、检索切片、SQLite 章节目录和故事宇宙快照均为有明确来源指纹的派生资产。派生资产可从 canonical source 重建，但不得反向覆盖或伪装成原始文本。

- Source project 使用项目根目录 `original.txt`，兼容历史 world-local 文件；`original.txt` 不提交 Git。章节目录保存全文 SHA-256；旧目录只在行数、标题和位置验证通过后自动补写指纹。
- `library/index.json` 缺失或 JSON 损坏时可以从全文和目录重建；损坏原文件先保留诊断备份。hashless 旧切片不再信任；hash 不一致时禁止混合新旧文本。
- 重建章节切片必须按 catalog 顺序插入，不能把缺失中间章追加到数组尾部后再按重复标题猜测。所有正式目录章节必须在 `novel_chapters` 中有稳定 ID，即使该章当前没有检索切片。
- 创建宇宙时，先复制并截断原文，再写入 bounded catalog / Library；SQLite 数据库如缺失或不完整，只能在 staging 副本中从 bounded 资产重建。不得为了创建一个分支而改写源项目数据库。
- 故事宇宙保存创建时完整源语料的 `sourceCanonHash`，分叉继承。根原文版本变化后，旧宇宙不能被静默改写；旧宇宙缺少本地 bounded 副本且没有源指纹时必须失败关闭。
- 宇宙 staging 使用显式文件 allow-list，只复制 checkpoint 后的 `novel.db`。根目录全文必须经 bounded-copy 专用路径写入；未知文件、私人笔记、全书派生文档不随目录复制。
- 故事宇宙自己的 `original.txt`、`chapter-index.json`、`library/index.json` 必须互相匹配同一个 bounded hash。任何检索、分析和续写路径都必须使用当前 world 的本地 bounded 资产，不得回退到根目录全书。

- 离线目录生成器必须对原始 `original.txt` 计算 SHA-256，并将其写入 `chapter-index.json`。生成器的脚本级回归测试必须真实执行脚本，而不是只测试章节解析函数；这样可以捕获输出组装阶段的未定义变量、路径错误和文件写入失败。目录缺失或损坏不能仅凭全文存在就伪造目录成功，必须运行可验证的目录构建流程并校验章节行号。

- Workbench 读取 source-chapters 时，若派生 `chapter-index.json` 缺失、损坏或为空，而 canonical `original.txt` 存在，则自动执行离线目录生成器；并发请求共享单一构建任务，损坏文件保留诊断副本。目录生成器按 `NOVEL_WORLD_ID` 写入对应 world，不能将语料 ID 固定在生成脚本中。
- Universe staging 内重建的 Library provenance 必须指向 rename 后的最终路径 `worlds/<universeId>/original.txt`，禁止把 `.staging-<id>` 写入持久索引。
- Novel DB schema v9 为旧版 `novel_chapters` 补齐稳定章节目录和来源字段。若数据库文件不存在，可在 staging 中从 bounded canon 重建；若数据库文件存在但正式章节行全部缺失，必须失败关闭并要求对源项目执行 `index-story`。
