# AGENTS.md

面向 CodeBuddy Code 在 tools/novel-generation 子目录工作。仓库根 AGENTS.md 的全部规则仍然适用；本文件补充本工具特有的命令、架构与数据边界。

## 环境与命令

- Node >= 22.13，ESM + TypeScript（strict、NodeNext、noUncheckedIndexedAccess）。`tsx` 直接运行 TS，`tsc` 编译 src/ → dist/。无 lint 脚本，typecheck 是主要静态检查。
- **所有命令必须在 tools/novel-generation 目录执行**：cli.ts 用 `resolve("worlds", ...)`、`resolve(".output", ...)`、`resolve("analysis", ...)` 把路径锚定到 CWD，换目录会读写到错误位置。
- npm install / npm run typecheck / npm run build / npm start（需先 build）
- npm test = `node --import tsx --test test/*.test.ts`（node:test + tsx）
- 单测文件：`node --import tsx --test test/library.test.ts`
- 按名过滤：`node --import tsx --test --test-name-pattern "<pattern>" test/<file>.test.ts`
- CLI 统一入口：`npm run dev -- <command> [flags]`（= `tsx src/cli.ts`）；`npm run dev -- models` 查看模型链解析
- 确定性语料索引：`node analysis/build-corpus-index.mjs`（只读根目录 original.txt，不调用模型）

CLI 命令（均经 `npm run dev --`）：

| 命令 | 作用 |
|---|---|
| `models` | 显示模型目录、偏好链、托管会话状态 |
| `ingest --world <id> --input <f>` | 导入 TXT/MD 建索引 |
| `search --world <id> --query "" [--limit 8]` | 检索原文片段 |
| `analyze --world <id> [--limit 20] [--model m] [--timeout-ms 60000]` | 逐片段抽取人物/事件/关系候选 |
| `distill-style --world <id> --input <f> [more files] [--out file] [--model m]` | 从授权样本提炼抽象风格候选，不覆盖正式 style-profile.md |
| `analyze-story --world <id> [--model m] [--timeout-ms 180000] [--shard i/n] [--merge-only] [--delta]` | CodeBuddy SDK 自动分析人物小传/成长可能性、主线、伏笔与后续发展并保存 SQLite；`--delta` 复用旧批次长文本，只重抽 v6 新增字段 |
| `analyze-world --world <id> --phase prepare/status/collect [--evidence-review]` | 多 Agent 文本分析（文件交接；默认确定性校验，`--evidence-review` 才调模型） |
| `analyze-arcs / index-story / story-kb / db-status / check-runtime` | 卷级梗概、章节索引入库、知识库查询（`story-kb --type graph` 可查完整 v6 原著图谱）、DB 状态、运行时自检 |
| `story-state --world <id> [--type overview/characters/events/threads/relationships/foreshadowings/macguffins/graph] [--query q]` | 只读查看续写 Story State、动态关系/伏笔/MacGuffin 记录及派生图谱 |
| `write-long --brief "" [--scenes n] [--max-words n] [--strict-model] [--no-apply-state] [--reader-experience] [--resume-dir dir]` | 万字长章节逐场生成；Reader 体验报告默认关闭 |
| `regress --world <id> --chapter n` | 单章盲写回归对照 |
| `write --brief "" [--mode continuation/derivative] [--source f] [--context f] [--model m] [--max-words n] [--strict-model] [--no-apply-state] [--reader-experience] [--resume-dir dir]` | 多阶段章节写作、自动复查与有限修复；Reader 默认关闭 |
| `generate --brief "" [--mode ...] [--out f]` | 单次成稿 |

`--world` 由 `safeWorldId` 校验 `^[a-z0-9][a-z0-9-]*$`；`continuation` 模式必须带 `--source`。

## 高层架构

分层流水线，读多个文件才能看清的"大图"：

- **src/cli.ts** — 唯一入口：参数解析、命令分派、worldId 校验、组装检索查询（brief + 故事当前位置 + 未结情节线 + 人物），加载 story-state / world-bible / style-profile。
- **src/library.ts** — 存储检索层：按中文章节标题正则切章 → 带重叠切片（1200 字 / 160 重叠）→ `worlds/<world>/library/index.json`（schemaVersion 1）。中文二元组 + BM25 风格打分，非向量语义检索。重复导入同一 source 会替换旧切片并使对应 annotations 失效。
- **src/analysis.ts** — 逐片段 LLM 抽取人物/事件/关系 → `annotations.json`；硬性校验 evidence 必须逐字出现在片段中；已完成 / 失败 / 可重试三态断点续跑；写文件用 tmp + rename 原子替换。
- **src/story-analysis.ts** — 自动读取 SQLite 全部已索引片段，按上下文长度分批调用 CodeBuddy Agent SDK，分析人物小传/性格矛盾/关系/成长可能性、主线情节、伏笔和后续发展；人物、关系、情节线、伏笔和发展可能按模型返回的 `chapterKeys` 精确关联来源；人物可保留同一角色的多条独立发展方向。缓存指纹包含模型、语料哈希、`maxChars`、实际批次章节布局和 Prompt 版本；完整成功后将结构化快照一次性保存到 SQLite `story_analysis`。
- **src/agent-runtime.ts** — 模型运行时：读 CodeBuddy 产品目录（明文 JSON 或 JSON→base64→gzip，来源 `ACC_PRODUCT_CONFIG_PATH` 或 `~/.codebuddy/local_storage/*.info`），偏好链 `deepseek-v4.1-flash → hy4free`，`hy4` 别名展开；检测托管会话（`CODEBUDDY_SESSION_ID` / `WORKBUDDY_CONFIG_DIR`）后用 `detachedCliOptions` 剥离宿主会话变量并加 `--port 0`；`buildQueryOptions` 禁工具、单轮、不持久化会话。
- **src/generate.ts** — 唯一调用 `@tencent-ai/agent-sdk` 的地方：`query()` + `runAgentText`（模型链超时 / 中断 / 重试），`generateStory` 单次成稿。
- **src/workflow.ts** — `writeChapter` 多阶段写作：主线架构师与创意发散并行 → 主编蓝图 → 正文 → 整体文学编辑 → 有问题才执行 Living Voice / Anti-AI 编辑与复核 → 结构化硬伤终审及最多两轮最小修复 → 修复后只读文风回归观察 → 可选 Reader → 状态更新与持久化。各阶段按职责构造上下文：创意阶段省略逐条原文证据，人物对白编辑只接收人物状态与相关事实，叙事声音编辑只接收风格参考和必要前情；规划、正文和终审保留事实核对所需资料。`mergeStoryState` 按 id/name 归并状态；只有实验隔离使用 `--no-apply-state`。每个模型阶段通过 `stage-cache.ts` 按输入指纹缓存，`--resume-dir` 可从最后一个完整阶段恢复。
- **src/world-analysis.ts** — 默认纯文件交接、运行时不调用模型：5 个 `ANALYSIS_ROLES`（main-plot / creative / style / characters / continuity）→ `prepare` 生成各角色 `input.md` → 各 Agent 写 `output.md` → `collect` 用 `validateAnalysisOutput` 校验（≥600 字、≥6 处 `L####` 且在原文行数内、≥3 个二级标题、无占位符），并核对 `original.txt` 行数 → `manifest.json` + `index.md`。显式 `--evidence-review` 才会逐句调用模型核验句中具体事实（数值、名称、身份、事件结果）与引用行是否一致，`--evidence-window` 控制邻行范围；概括与评价不判，创意角色的项目原创提案豁免；解析失败的批次二分重试，未通过句计入 `complete`。章节索引按 schemaVersion 2 富结构读取，只取 `totalLines` 与卷表，允许多余字段。
- **src/story-state.ts** — `worlds/<world>/story-state.json`（schemaVersion 1）的加载 / 保存与空状态；人物记录区分稳定 profile 与可变剧情快照，并保存证据支持的关系/伏笔/MacGuffin 更新日志。
- **src/story-state-graph.ts** — 从 Story State 的稳定 ID 和显式引用派生续写图谱；不做模糊实体合并，保留关系/伏笔/MacGuffin 更新历史。
- **src/character-profile.ts** — 把 `novel_characters` 的逐批观察（同一人物在不同批次被反复描述，主角可达数百条）按章节顺序采样后交给模型合并成一份档案，写明阶段变化、稳定性格、内在矛盾与可能走向；写入 `novel_character_profiles`，原始观察保留作证据。缓存按提示词版本 + 采样内容取键。
- **src/writing-brief.ts** — 把 `novel_*` 表压成写作事实包：按任务词面选相关人物、未收情节线与未回收伏笔，再附最近三章既成事实；状态与置信只是排序偏好，没有词面重合的条目不进包。上限 3k 字。
- **src/iron-laws.ts** — 读 `worlds/<world>/laws.json`，在终审前做确定性检查（越阶、超额、违背禁忌），命中转成带场景号的必改项。缺文件视为无约束，格式错直接抛错。
- **src/literary-edit.ts** — 普通章节与长章节共享 Living Voice、Anti-AI 诊断/编辑/复核、终审后只读文风回归观察和盲读 Reader 提示；诊断无问题/失败时跳过整章编辑，复核失败恢复原稿，后置观察和 Reader 失败均不阻塞成功路径。
- **src/style-distillation.ts** — 从授权样本提炼全局与场景级抽象风格，避免复刻原文独特表达；CLI 输出候选资料而不覆盖正式风格文件。
- **src/style-regression.ts** — 正式普通/长章节 Pipeline 自动读取 `style-profile.md` 和 `style-references/` 中的认可样本，成稿后输出风格观察报告；不打分、不改稿、不阻断章节。手动 CLI 仅用于专项对照。
- **src/style-references.ts**、**web/src/StyleReferencesPanel.tsx** — 管理认可样本的活动版本和归档历史；Workbench 可添加/更新/归档，替换前归档旧字节，历史目录不进入自动风格回归样本加载。
- **src/style-trend.ts** — 聚合最近的逐章/专项风格回归报告，供 `style-trend` 命令生成跨章节只读观察；不读取草稿、不打分、不触发改写。
- **src/roleplay-sandbox.ts** — 作者主动控制的多轮人物互动推演；接受/修改/补充/重演/结束，产物只保存在 `.output/`，不更新 Story State。
- **src/long-chapter.ts** — 长章节按场景蓝图逐场检索与生成；配置场景数是上限，允许蓝图按自然叙事少于上限，不能为了凑数拆分情节；不再为单场分配字数配额；按实际场景数确定连续性上下文和审查定位。每场注入相关人物当前状态，并携带本章已生成正文的滚动上下文；不再在逐场修订前执行分批审查；只在完整章节完成后执行一次跨场硬伤终审。逐场修订后执行 Anti-AI 诊断，只有发现明确问题才编辑；诊断无问题或失败时跳过整章改写。终审修复后只读检查文风回归；Reader 体验报告默认关闭，使用 `--reader-experience` 显式启用。终审失败时先在大纲层修订受影响场景再重生成，未受影响场景保持原蓝图；状态只从最终通过的完整章节提取并自动提交。阶段缓存校验结构化输出，指纹记录实际模型及回退链。
- **src/analysis.ts** — 抽取以批次为单位原子保存标注，避免每处理一个片段就重写整个增长中的 JSON 文件；`analyze --all` 以有限批次循环，持续失败时不会无限重试。`verify-world` 对照 library chunk 数、唯一证据复核完成数和 SQLite 行数检查覆盖率。
- **src/character-chapter-state.ts** — 原著人物逐章状态分析；只从章节原文提取观察，要求逐字证据；按人物 ID + 章节 ID 保存 SQLite 快照；输入指纹同时覆盖章节正文和最近前序状态，避免上游状态变化后沿用过期下游结论；可按章节分片，Workbench 人物页读取 `chapterStates` 展示历史状态。
- **novel_character_chapter_states** — 原著人物逐章状态表；不要与续写中的 Story State 动态人物状态混用。

## 数据布局与边界

- `worlds/<world>/` — 正史资料（world-bible.md、characters.md、timeline.md、story-state.json、library/、chapters/），随代码提交。
- `analysis/<world>/` — 卷章索引、语料画像、多 Agent 分析工作记录，随代码提交。
- `sources/` — 语料来源与证据等级说明。
- `.output/`、`dist/`、`node_modules/`、`private/`、`original.txt`、`.env` 均被 .gitignore 排除；**私有原文绝不入库**。
- 证据纪律：结论用 `L####` 指向 `original.txt` 行号，区分「原著明确 / 作者设定 / 人物推断 / 待核实」四级；分析结论是工作记录，不等于正史。
- `library/index.json` 含全文切片，提交到公开仓库前须确认授权范围；import 与 continuation 的 `--source` / `--input` 只能用合法取得的文本。
- 当前边界：`annotations.json` 为空（全量 `analyze` 约 2594 次模型调用，尚未执行）；`entity-registry.ts` 已实现别名归并、共指解析与实体注册表，但该抽取链路尚未产出数据，全书知识库由 `analyze-story` 落库；Agent SDK session 不持久化，但模型阶段有本地 checkpoint，可通过 `--resume-dir` 恢复；故事状态以 SQLite 为权威存储，单机写作，不支持并发写作。

## 仓库根 AGENTS.md 要点（仍适用）

- 面向资深架构师 / 工程师：关注架构、可扩展性、可维护性、可观测性、安全、性能与权衡，比较备选方案并说明取舍。
- 不维护向后兼容：废弃路径直接删除，不留兼容层 / 回退 / 迁移。采用满足当前需求的最简实现，避免无依据的抽象、配置与间接层；渐进分层构建，先端到端最小可用版本。
- 模块化、职责边界清晰；新增依赖前先评估现有依赖能力并查文档 / 类型定义，优先成熟库；决策着眼长期演进，设计前先研究成熟产品同类解法。
- 技术文章 / 研究报告：核实外部资料、区分证据类型、不写空泛最佳实践、转化为工程决策；图表只能用 `.agents/skills/diagram-design/SKILL.md` 直接产出 HTML + 独立 SVG，**禁止 Mermaid**；写回后复核链接 / 代码围栏 / 残留 Mermaid / 标题层级并跑构建。
- 交付报告前强制走 `skills/article-de-ai/SKILL.md` 去 AI 味；事实核查用 `skills/evidence-and-claim-review/SKILL.md`。


## Entity evidence and search cache

- `library.ts` stores source SHA-256 and exact chapter-relative character offsets; its BM25 token counts and document frequencies are cached per index-file version and invalidated after ingestion.
- `analysis.ts` preserves evidence spans and performs a separate fail-closed semantic evidence review. A missing verifier decision rejects that candidate.
- `entity-registry.ts` merges only explicit, unambiguous aliases. It does not use fuzzy matching; unresolved or ambiguous coreferences remain visible for later review.


## Runtime schema and report evidence review

- Zod is a direct runtime dependency. Validate persisted JSON and model-generated decisions at input boundaries; TypeScript interfaces alone do not validate runtime data.
- `world-analysis.ts` checks cited source lines against local `original.txt` and runs a separate model review over report paragraphs plus their exact cited lines. Missing source, mismatched corpus line count, malformed decisions, or unsupported claims fail collection.
- `analyze-world --phase collect` accepts `--source`, `--model`, and `--timeout-ms`; the default source path is local `original.txt` in the tool working directory.


## Model comparison experiments

- Run `node scripts/compare-models.mjs` for multi-model continuation comparisons.
- Use `--strict-model` so failed calls cannot silently fall back. Never apply candidate state proposals during the experiment.
- Keep `MODEL-MAPPING-PRIVATE.json` and logs away from blind reviewers; share only anonymized chapter text and identical context.
- Use `prompts/model-comparison-review.md`; judge continuation quality, not imitation of source phrasing.


## SQLite world database

- Each world has two SQLite files, both tracked in Git: `novel.db` (chunks, annotations, `novel_*` knowledge, story analysis — written only by ingest/analyze) and `story.db` (writing state: `story_state`, `characters`, `canon_facts`, `story_events`, `plot_threads`, `continuity_notes` — rewritten on every chapter). Keep them separate: a chapter update must not rewrite the 22MB knowledge file. Legacy state tables inside `novel.db` are adopted into `story.db` on first open and dropped. Only WAL/SHM sidecars and `original.txt` stay local. Run `VACUUM` before committing when a file grew from repeated rewrites.
- SQLite is authoritative for story state after legacy JSON migration. `story-state.json` is a readable compatibility snapshot; library/annotation JSON are rebuildable interchange snapshots.
- Update SQLite through `src/database.ts` transaction helpers; do not write tables ad hoc from CLI or agents. `story_analysis` stores the latest complete corpus-analysis snapshot separately from canonical `story_state`; per-batch resumable work files stay under `.output/`.
- Library search keeps the existing BM25 ranking but reads chunk records from SQLite. Retrieved chunk annotations are loaded from SQLite by chunk ID.
- Do not store original novel files in SQLite; only indexed passages and structured derived data belong there.

## 全自动章节质量门禁与恢复

- `chapter-review.ts` 定义结构化审查结果；Zod 校验 JSON、严重程度、正文原文证据和多场景受影响场景编号。证据不能逐字定位、审查结构无效或状态与问题严重程度冲突时，自动重试一次；仍无效则失败关闭。
- blocker / major 触发自动修复；minor 仅记录，不因个人偏好或节奏统计值触发改写。最多两轮修复，每轮必须重新审查；仍有 blocker / major 时任务失败，不提交故事状态。
- `write-long` 最终审查必须覆盖全章；修复只作用于审查指出的场景。跨场问题需要列出所有受影响场景。
- `stage-cache.ts` 按完整 prompt、实际解析模型及回退链和阶段推理配置生成 SHA-256 指纹；支持阶段级语义校验，结构化结果只有通过 schema/业务校验才可复用，哈希正确但语义无效的缓存会重新生成。输出原子写入并校验输出哈希。并行阶段更新 manifest 时串行合并，避免互相覆盖。
- 连续性备注是当前有效状态快照，不是永久追加日志；状态提取必须返回完整有效集合，已经解决或被新事实替代的备注应退出后续写作上下文。
- 对白、叙事声音和场景修订不设置“字数不得减少”或固定缩短比例门槛；只保护有效的人物互动、动作、信息和情绪落点。长度变化本身不能判定内容丢失，后续终审仍只检查真正破坏故事成立的硬伤。
- `--resume-dir` 只允许指向当前 world 的 `.output/<world>/` 子目录，且普通/长章节目录类型必须匹配。每次运行保存不可变的输入故事状态快照；即使上一次进程已写入 SQLite 但在归档前中断，恢复也会从同一份初始状态重新计算，避免重复累加。
- 状态管理员输出必须通过 `parseStoryStateUpdate` 校验；`saveStoryState` 再校验完整状态后才写入 SQLite。章节未通过最终审查或状态提取/持久化失败时，不得继续下一章。

## 小说创作最高原则：文学性、文笔、艺术风格，高于其他一切！

这是项目所有分析、规划、生成和审查任务的最高优先级。人物档案、人物弧光、主线、伏笔、世界设定、连续性和数据库记录都只是辅助创作的参考，不是约束小说的规范。人物可以矛盾、反复、误判、冲动、突然转变、黑化或洗白；故事可以有意外、留白、闲笔和无法预先解释的艺术选择。不得为了分析完整、结构整齐、设定覆盖或指标达标而牺牲文学表达。只有明确妨碍读者理解或破坏故事成立的硬伤才进入自动修复。

`analyze-story` 的分析结果必须区分原文呈现、合理推断和创作可能性。人物成长方向、伏笔解释与情节建议都不是正史事实，更不能成为后续正文必须兑现的清单。分析可以大胆提出多种互相矛盾的可能性，保留未知和歧义。


## 全文分析与写作上下文

- `analyze-story` 的 SQLite 快照只作创作参考；普通章节与长章节可按本次任务相关性选取少量内容，不得整份灌入上下文。
- 分析注入必须明确为可选素材，不是正史、人物定论、人物行为边界或情节任务；不得要求兑现每条伏笔或执行人物弧光建议。
- 故事图谱供写作和终审共同参考：写作阶段按任务检索相关节点并扩展一跳关系；终审只核对明确事实/因果硬冲突，不检查人物弧光是否按计划执行、伏笔是否按期回收或 MacGuffin 是否按分析建议推进。
- 语料重新导入必须使旧分析失效。分析不完整或无相关命中时，不注入，不阻塞写作。
- 任何筛选算法只能决定“哪些参考可能有用”，不能对创意、人物行为或正文进行硬过滤。


## 续写状态来源与全文分析数据质量

- 由本次生成章节首次引入的事实默认属于项目原创，不能因为模型将其标为 confirmed 就进入原著正史；只有已有事实 ID 才能沿用原有来源等级。事件必须记录 origin，项目原创事件标为 original。
- 人物别名必须区分明确化名/个人别称与绰号、称号、职位、传承、能力和身份。只有带原文证据的 name_alias / nickname 参与人物检索；共享别名保持歧义，不得用于自动合并人物。
- 情节线去重必须结合标题、来源章节集合和关键转折内容；数据库 ID 也必须包含这些身份信息。同名但来源范围或关键转折不同的情节线必须保留。
- 全文分析批次遇到模型输出 JSON 无法解析或 schema 不匹配时，保留原始输出并自动进行一次修复重试；仍失败则保留失败状态，后续可重跑，不得计入完整快照。
- 长章节润色以原稿精修为主。记录逐场润色前后汉字数及变化比例，仅作诊断，不设硬阈值；润色后的完整章节仍必须经过最终连续性审查。

- 状态加载时对来源明确标记为续写/续章/衍生/项目原创的旧事实执行保守迁移，降为 original 并回写 SQLite/JSON；来源不明的旧事件不推断正史属性。
- 旧版 story_analysis 快照的 analysisVersion 缺失或低于当前值（6）时不得注入写作上下文；必须重新生成当前版本快照。v6 增加关系动态与主线/支线分类；v3/v4/v5 批次缓存不能整体冒充 v6 结果：其长文本字段可由 `--delta` 复用，但 v6 新增字段必须由新提示词按原文重新抽取并通过 `assertV6DeltaFields` 校验。旧缓存保留在磁盘作为历史材料，不覆盖新结果。

- 故事核心、主线/支线、人物互动、伏笔与回收可能、MacGuffin、章级事件和人物发展可能统一进入 SQLite 故事图谱。节点与边保留原文来源引用；只允许精确人物名或唯一无歧义别名建立人物连接。
- 不增加专职人物/主线/伏笔 Agent。全文分析由现有 analyze-story 完成；普通写作、长章节写作和终审复用同一份按当前任务筛选的图谱上下文。终审只核对明确硬冲突，不检查创意是否服从分析结果。
- 故事图谱的字段、SQLite 持久化、写作/终审职责和缓存边界以 `ADR/0002-story-graph-and-review-context.md` 为准。


## Web Workbench

- Web entry: `src/server-main.ts`; Express API assembly: `src/server.ts`; local UI: `web/`; Vite config: `vite.config.ts`.
- Start from `tools/novel-generation` with `npm run dev:web`; default bind is loopback `127.0.0.1:4173`. Do not expose the local Agent service to LAN by default.
- Keep CLI and Web on shared domain services. The Web API calls `generateStoryPlan`, `loadStoryPlan`, `saveStoryPlan`, `loadStoryState`, and the existing story-analysis context builder; do not fork prompt or Story Plan schema logic.
- Story Graph Explorer uses `buildStoryStateGraph` / `filterGraph` from the shared domain module. Original graph is read only from a complete v6 `story_analysis.storyGraph`; sequel graph is derived from Story State. Do not add a second graph store or fuzzy entity joins. The visual layout is navigational only, never a semantic ranking.
- Autonomous execution is the default. Web-generated Story Plans are validated and activated automatically; the previous active version is archived under `worlds/<world>/story-plan-history/`. CLI `plan-story` also activates by default; use `--draft` only for an isolated experiment. A generated plan is a direction, not a chapter-by-chapter contract.
- Workbench run/version records live under ignored `.output/<world>/workbench/`; they are operational history, not canon. Formal Story Plan remains `worlds/<world>/story-plan.json`.
- The Workbench is for visibility, diagnostics, history and optional intervention. Do not add mandatory approval queues or human-click gates to ordinary generation. Human intervention is reserved for cases the system cannot safely resolve after bounded automatic recovery, such as irreconcilable state conflicts, corrupted authoritative data, or destructive operations.
- `npm run build` runs TypeScript compilation and Vite production build. `npm run dev` remains the existing CLI entry; `npm run dev:web` starts the Web Workbench.


## Autonomous execution policy (ADR 0003)

- Continue by default: ordinary planning, generation, review, bounded repair, state extraction and persistence run without waiting for a human. UI review is observational and optional, not a workflow state.
- Prefer automatic recovery with explicit limits, checkpoints and durable diagnostics. A failed automated run may stop safely; it must not silently convert a blocker into success or require a human approval click to resume ordinary successful work.
- Ask for human intervention only when no safe deterministic/model-assisted resolution remains, or when an operation is destructive, irreversible, security-sensitive, or changes authoritative canon in a way that cannot be reconciled automatically.
- Preserve generated versions and decisions as history. History must not become an approval queue, and a generated plan should become active automatically after schema/world validation.


## 人物自主行动与 World Situation

- 小说续写是唯一目标；不要把 D&D 的数值检定、回合制、等级、HP、任务奖励或玩家/DM 交互引入生成链路。
- 人物当前目标必须结合动机、实际知识、资源、限制和压力理解。Knowledge Boundary 防止角色全知，但不禁止人物误判、隐瞒、冲动或改变立场。
- World Situation 复用现有主线规划阶段，只针对当前章节相关人物/势力做有限推演；不模拟全世界，不要求 NPC 每章行动，不新增专职 DM Agent。
- 推演输出属于暂定创作素材，绝不直接写入 Story State。Story State 只记录最终正文实际发生的事实。
- 事件的 causes 与 relatedPlotThreads 用于表达因果关联；没有可靠依据时可以留空，不得为了字段完整编造因果。
- 详见 `ACTION-PLAN.md`；阶段状态和验收标准必须同步维护。


## World Situation implementation

- `src/world-situation.ts` is a deterministic context builder, not a simulator or persistence layer. Reuse it for both `write` and `write-long`.
- Keep its context bounded and task-scoped. Prefer characters named or surfaced by the brief, Story Plan, writing brief, retrieved passages, or analysis context; otherwise use only a few recently updated character states. Include related recent events and active plot threads, not the full history.
- The existing plot/planner call performs any optional situation reasoning. Do not add a dedicated DM/WorldSimulation agent or another model call just to restate current state.
- Distinguish recorded events from possible developments. Never persist planner speculation as Story State; only the final chapter state extractor may write facts.
- Expand event-cause IDs and related plot-thread IDs into readable summaries/titles when building context. Preserve unknown references as-is instead of inventing relationships.
- Story Plan participates in retrieval/context selection so long-term direction can surface relevant existing people, threads and foreshadowings. It remains a direction, not a chapter contract.
- See `ACTION-PLAN.md` for the implemented scope.


## Living Voice 与 Anti-AI 编辑（ADR 0004）

- 普通章节与长章节在叙事声音修订后、最终硬伤终审前复用同一 Anti-AI 编辑能力；不得建立平行写作流水线或新增常驻专职 Agent。
- Living Voice 贯穿规划、正文、对白和编辑：人物有当下目标，细节来自人物视角，性格通过选择呈现，对白承担关系动作，世界观通过行动和后果显现。
- Anti-AI 不是 AI 检测器优化。禁止以检测分数、禁词、连接词频率、句长、段落长度或统计分布单独触发正文改写。
- 原稿成立时允许零修改。不得机械删词、制造口语腔、错字、粗口、网络梗、固定口头禅或随机闲笔；不得抹平有意重复、长句、留白和文学修辞。
- 编辑不得改变剧情事实、因果、人物决定、信息揭示、叙事视角、人物关系或场景顺序，不得新增剧情事实。编辑前后版本必须保留并经过最终硬伤审查。
- Reader 体验评估是独立观察产物，不进入 blocker/major 门禁，不触发自动修复，不更新 Story State。
- 角色推演沙盘是作者主动调用的工具；所有推演均为候选创作素材，不自动成为正史。
- 详见 `ARCHITECTURE.md` 第 10 节与 `ADR/0004-living-voice-and-anti-ai-editing.md`。


## Literary workflow implementation invariants

- 普通章节与长章节的规划器和 Writer 必须注入 `CREATIVE_FREEDOM_RULES`，正文编辑继续注入 `LIVING_VOICE_RULES`。不是每个场景都必须推进主线、制造冲突、揭示信息或改变关系；不得因单场篇幅不足自动扩写。事实连续性是约束，蓝图不是逐项执行合同。
- Anti-AI 流程顺序固定为诊断 → 克制编辑 → 保守复核 → 最终硬伤审查。诊断不得判断 AI 生成概率；复核只允许 keep/restore，复核失败必须恢复编辑前正文，不得增加人工确认。
- Anti-AI 诊断报告、编辑稿和复核结果分别保存在 `06a`、`06b`、`06c` 阶段文件中，全部进入阶段缓存指纹。
- Reader 只能盲读最终正文，不得注入章节蓝图、人物档案、世界设定或创作任务；它只输出观察报告，不进入门禁、不更新 Story State。
- `distill-style` 默认生成候选文件；只有显式 `--activate` 才替换正式 `style-profile.md`，并先归档旧版。候选输出和角色推演输出只能位于 `.output/<world>/`，不能接受指向正史文件的任意 `--out`。
- Roleplay Sandbox 必须注入指定人物的动态状态、可用的长期人物观察和任务相关故事图谱；推演记录只属于候选素材，不写入 Story State。
- `style-regress` 可对任意已认可参考章节与候选章节做专项观察；正式 `write` / `write-long` 已在每章终审通过后自动生成只读风格回归报告。尚未实现的是跨章节自动批量趋势分析、CI 风格门禁和样本版本工作台。


## Style Profile and regression workflow

- `worlds/<world>/style-profile.md` 是正式写作的活动风格资料。CLI 必须在每次 `write` / `write-long` 时自动加载，并注入规划、正文、对白和叙事声音相关阶段；不得要求作者每章手工指定。
- 可选的认可样本放在 `worlds/<world>/style-references/`，每次正式写作自动读取最多四个 Markdown/TXT 样本，作为风格回归观察的对照材料。
- 普通章节和长章节在终审通过后自动生成 `11-style-regression.md`。没有参考样本时，以活动 Style Profile 做有限观察并明确证据不足。
- 风格回归是只读诊断，不是写作门禁或自动修订指令；报告失败不得影响成稿、Reader 或 Story State 提交。
- Story State 的 `foreshadowingUpdates` / `macguffinUpdates` / `relationshipUpdates` 是续写动态生命周期与关系变化日志，只能记录最终正文明确发生的变化并附逐字证据；按稳定 ID 幂等追加，不得将分析猜测写成事实。
- 后续规划和终审只读取与当前任务相关的最新生命周期/关系状态；不要求每章埋设/回收伏笔或推进 MacGuffin，不能把未推进判为质量问题。关系可以自然变化，不得因历史关系标签限制人物选择。
- `style-regress` 是任意文件专项对照命令，不是正式 Pipeline 的必要步骤。

## 叙事力度与蓝图边界（ADR 0004 补充）

- 章节蓝图只描述必要事实、自然起点和少量不可丢失的锚点；欲望/压力、信息差、冲突、选择和后果只有在场景确实需要时才记录。允许日常、闲谈、过渡和没有明确结果的场景；不得编排停顿时长、逐帧微动作、手势顺序、句子、比喻或心理解释。
- 正文 Agent 不得把蓝图当作舞台调度表。可合并、替换或省略非必要动作，保留戏剧功能和事实连续性。
- 锋利不等于短句、冷峻、含蓄或诗意。重点是准确选择、具体利害、信息差、因果压力、人物判断和行动后果。
- 诊断必须检查全章累积效果：动作逐帧拆解、机械停顿、重复否定式收束、短句/断行堆叠、画面后的解释性旁白。区分有意复沓与机械复沓。
- 编辑可合并重复动作、压缩解释、重组句子和段落；复核保护的是信息、因果、人物选择、人物声音和有效情绪，不是逐字保留。
- 没有真实认可参考样本时，Style Regression 不能判断与原著的距离，也不能得出“没有风格漂移”的结论。


- Knowledge build is never a chapter-generation prerequisite. `novel.db` (analysis) and `story.db` (chapter state) are separate; do not reintroduce a whole-build lock on writing.
- Historical universe reuse must remain chapter-bounded: only reuse source Story Analysis records whose complete chapter provenance is at or before the branch entry; discard unbounded whole-book aggregates and future-touching records.
- Legacy universes must backfill a missing bounded v6 Story Analysis from their `sourceWorldId` before the first chapter is launched; apply the same cutoff filter and never copy the source snapshot verbatim.

- Historical universe creation must pass a stable chapter index and resolve it to the exact `novel_chapters.chapter_id` plus ordinal. Never use a chapter title as a unique key; repeated titles, catalog/database count mismatches, missing IDs, or unresolved boundaries must fail closed before publishing the universe. Persist `entryChapterId`, `entryChapterIndex`, and `entryOrdinal` through forks.
- For bounded v6 analysis reuse, prefer complete cached analysis batches whose every chapter is at or before the entry ordinal. Never reuse a batch crossing the cutoff. Fall back to conservative merged-snapshot filtering only when safe batch reuse is unavailable; never retain unbounded `storyCore` text or count marker-only/empty snapshots as reusable.
