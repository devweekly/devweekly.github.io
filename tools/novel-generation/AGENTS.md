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
| `analyze-story --world <id> [--model m] [--timeout-ms 180000]` | CodeBuddy SDK 自动分析人物小传/成长可能性、主线、伏笔与后续发展并保存 SQLite |
| `analyze-world --world <id> --phase prepare/status/collect` | 多 Agent 文本分析（文件交接） |
| `write --brief "" [--mode continuation/derivative] [--source f] [--context f] [--model m] [--max-words n] [--no-apply-state] [--resume-dir dir]` | 多阶段章节写作、自动复查与有限修复 |
| `generate --brief "" [--mode ...] [--out f]` | 单次成稿 |

`--world` 由 `safeWorldId` 校验 `^[a-z0-9][a-z0-9-]*$`；`continuation` 模式必须带 `--source`。

## 高层架构

分层流水线，读多个文件才能看清的"大图"：

- **src/cli.ts** — 唯一入口：参数解析、命令分派、worldId 校验、组装检索查询（brief + 故事当前位置 + 未结情节线 + 人物），加载 story-state / world-bible / style-profile。
- **src/library.ts** — 存储检索层：按中文章节标题正则切章 → 带重叠切片（1200 字 / 160 重叠）→ `worlds/<world>/library/index.json`（schemaVersion 1）。中文二元组 + BM25 风格打分，非向量语义检索。重复导入同一 source 会替换旧切片并使对应 annotations 失效。
- **src/analysis.ts** — 逐片段 LLM 抽取人物/事件/关系 → `annotations.json`；硬性校验 evidence 必须逐字出现在片段中；已完成 / 失败 / 可重试三态断点续跑；写文件用 tmp + rename 原子替换。
- **src/story-analysis.ts** — 自动读取 SQLite 全部已索引片段，按上下文长度分批调用 CodeBuddy Agent SDK，分析人物小传/性格矛盾/关系/成长可能性、主线情节、伏笔和后续发展；合并跨批次人物与情节线，完整成功后将结构化快照一次性保存到 SQLite `story_analysis`；每批结果写入 `.output/<world>/story-analysis/<source-hash>/`，中断后可复用已完成批次。
- **src/agent-runtime.ts** — 模型运行时：读 CodeBuddy 产品目录（明文 JSON 或 JSON→base64→gzip，来源 `ACC_PRODUCT_CONFIG_PATH` 或 `~/.codebuddy/local_storage/*.info`），偏好链 `hy4free → deepseek-v4.1-flash`，`hy4` 别名展开；检测托管会话（`CODEBUDDY_SESSION_ID` / `WORKBUDDY_CONFIG_DIR`）后用 `detachedCliOptions` 剥离宿主会话变量并加 `--port 0`；`buildQueryOptions` 禁工具、单轮、不持久化会话。
- **src/generate.ts** — 唯一调用 `@tencent-ai/agent-sdk` 的地方：`query()` + `runAgentText`（模型链超时 / 中断 / 重试），`generateStory` 单次成稿。
- **src/workflow.ts** — `writeChapter` 多阶段写作：主线架构师与创意发散并行 → 主编蓝图 → 正文 → 对白 → 叙事声音 → 结构化终审复查与最多两轮自动修复 → 运行时校验状态更新 → SQLite/JSON 自动持久化。`mergeStoryState` 按 id/name 归并状态；只有实验隔离使用 `--no-apply-state`。每个模型阶段通过 `stage-cache.ts` 按输入指纹缓存，`--resume-dir` 可从最后一个完整阶段恢复。
- **src/world-analysis.ts** — 纯文件交接、运行时不调用模型：5 个 `ANALYSIS_ROLES`（main-plot / creative / style / characters / continuity）→ `prepare` 生成各角色 `input.md` → 各 Agent 写 `output.md` → `collect` 用 `validateAnalysisOutput` 校验（≥600 字、≥6 处 `L####` 且在原文行数内、≥3 个二级标题、无占位符）→ `manifest.json` + `index.md`；只校验格式与证据密度，不判断观点。
- **src/story-state.ts** — `worlds/<world>/story-state.json`（schemaVersion 1）的加载 / 保存与空状态；人物记录区分稳定 profile 与可变剧情快照。
- **src/long-chapter.ts** — 长章节按场景蓝图逐场检索与生成；蓝图格式错误自动修正一次；先做分批审查和逐场修订，再做最终全章跨场审查；blocker/major 定位到受影响场景，最多两轮局部修复并复查；状态只从最终通过的完整章节提取并自动提交。阶段支持指纹缓存和 `--resume-dir`。
- **src/analysis.ts** — 抽取以批次为单位原子保存标注，避免每处理一个片段就重写整个增长中的 JSON 文件。

## 数据布局与边界

- `worlds/<world>/` — 正史资料（world-bible.md、characters.md、timeline.md、story-state.json、library/、chapters/），随代码提交。
- `analysis/<world>/` — 卷章索引、语料画像、多 Agent 分析工作记录，随代码提交。
- `sources/` — 语料来源与证据等级说明。
- `.output/`、`dist/`、`node_modules/`、`private/`、`original.txt`、`.env` 均被 .gitignore 排除；**私有原文绝不入库**。
- 证据纪律：结论用 `L####` 指向 `original.txt` 行号，区分「原著明确 / 作者设定 / 人物推断 / 待核实」四级；分析结论是工作记录，不等于正史。
- `library/index.json` 含全文切片，提交到公开仓库前须确认授权范围；import 与 continuation 的 `--source` / `--input` 只能用合法取得的文本。
- 当前边界：`annotations.json` 为空（全量 `analyze` 约 2594 次模型调用，尚未执行）；无跨章节实体归并 / 共指消解；Agent SDK session 不持久化，但模型阶段有本地 checkpoint，可通过 `--resume-dir` 恢复；故事状态以 SQLite 为权威存储，单机写作，不支持并发写作。

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

- Each world has `worlds/<world>/novel.db`, implemented with Node's built-in `node:sqlite`; keep database files and WAL/SHM sidecars out of Git.
- SQLite is authoritative for story state after legacy JSON migration. `story-state.json` is a readable compatibility snapshot; library/annotation JSON are rebuildable interchange snapshots.
- Update SQLite through `src/database.ts` transaction helpers; do not write tables ad hoc from CLI or agents.
- Library search keeps the existing BM25 ranking but reads chunk records from SQLite. Retrieved chunk annotations are loaded from SQLite by chunk ID.
- Do not store original novel files in SQLite; only indexed passages and structured derived data belong there.

## 全自动章节质量门禁与恢复

- `chapter-review.ts` 定义结构化审查结果；Zod 校验 JSON、严重程度、正文原文证据和多场景受影响场景编号。证据不能逐字定位、审查结构无效或状态与问题严重程度冲突时，自动重试一次；仍无效则失败关闭。
- blocker / major 触发自动修复；minor 仅记录，不因个人偏好或节奏统计值触发改写。最多两轮修复，每轮必须重新审查；仍有 blocker / major 时任务失败，不提交故事状态。
- `write-long` 最终审查必须覆盖全章；修复只作用于审查指出的场景。跨场问题需要列出所有受影响场景。
- `stage-cache.ts` 按完整 prompt、模型和阶段推理配置生成 SHA-256 指纹；输出原子写入并校验输出哈希。并行阶段更新 manifest 时串行合并，避免互相覆盖。
- `--resume-dir` 只允许指向当前 world 的 `.output/<world>/` 子目录，且普通/长章节目录类型必须匹配。每次运行保存不可变的输入故事状态快照；即使上一次进程已写入 SQLite 但在归档前中断，恢复也会从同一份初始状态重新计算，避免重复累加。
- 状态管理员输出必须通过 `parseStoryStateUpdate` 校验；`saveStoryState` 再校验完整状态后才写入 SQLite。章节未通过最终审查或状态提取/持久化失败时，不得继续下一章。

## 小说创作最高原则：文学性、文笔、艺术风格，高于其他一切！

这是项目所有分析、规划、生成和审查任务的最高优先级。人物档案、人物弧光、主线、伏笔、世界设定、连续性和数据库记录都只是辅助创作的参考，不是约束小说的规范。人物可以矛盾、反复、误判、冲动、突然转变、黑化或洗白；故事可以有意外、留白、闲笔和无法预先解释的艺术选择。不得为了分析完整、结构整齐、设定覆盖或指标达标而牺牲文学表达。只有明确妨碍读者理解或破坏故事成立的硬伤才进入自动修复。

`analyze-story` 的分析结果必须区分原文呈现、合理推断和创作可能性。人物成长方向、伏笔解释与情节建议都不是正史事实，更不能成为后续正文必须兑现的清单。分析可以大胆提出多种互相矛盾的可能性，保留未知和歧义。
