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
| `analyze --world <id> [--limit 20] [--model m] [--timeout-ms 60000]` | 逐片段抽取人物/事件/关系 |
| `analyze-world --world <id> --phase prepare/status/collect` | 多 Agent 文本分析（文件交接） |
| `write --brief "" [--mode continuation/derivative] [--source f] [--context f] [--model m] [--max-words n] [--apply-state]` | 多阶段章节写作 |
| `generate --brief "" [--mode ...] [--out f]` | 单次成稿 |

`--world` 由 `safeWorldId` 校验 `^[a-z0-9][a-z0-9-]*$`；`continuation` 模式必须带 `--source`。

## 高层架构

分层流水线，读多个文件才能看清的"大图"：

- **src/cli.ts** — 唯一入口：参数解析、命令分派、worldId 校验、组装检索查询（brief + 故事当前位置 + 未结情节线 + 人物），加载 story-state / world-bible / style-profile。
- **src/library.ts** — 存储检索层：按中文章节标题正则切章 → 带重叠切片（1200 字 / 160 重叠）→ `worlds/<world>/library/index.json`（schemaVersion 1）。中文二元组 + BM25 风格打分，非向量语义检索。重复导入同一 source 会替换旧切片并使对应 annotations 失效。
- **src/analysis.ts** — 逐片段 LLM 抽取人物/事件/关系 → `annotations.json`；硬性校验 evidence 必须逐字出现在片段中；已完成 / 失败 / 可重试三态断点续跑；写文件用 tmp + rename 原子替换。
- **src/agent-runtime.ts** — 模型运行时：读 CodeBuddy 产品目录（明文 JSON 或 JSON→base64→gzip，来源 `ACC_PRODUCT_CONFIG_PATH` 或 `~/.codebuddy/local_storage/*.info`），偏好链 `hy4free → deepseek-v4.1-flash`，`hy4` 别名展开；检测托管会话（`CODEBUDDY_SESSION_ID` / `WORKBUDDY_CONFIG_DIR`）后用 `detachedCliOptions` 剥离宿主会话变量并加 `--port 0`；`buildQueryOptions` 禁工具、单轮、不持久化会话。
- **src/generate.ts** — 唯一调用 `@tencent-ai/agent-sdk` 的地方：`query()` + `runAgentText`（模型链超时 / 中断 / 重试），`generateStory` 单次成稿。
- **src/workflow.ts** — `writeChapter` 多阶段写作：主线架构师与创意发散并行（Promise.all）→ 主编蓝图 → 场景初稿 → 对白 → 叙事声音 → 连续性审查 → 主编终审 → 状态提取；每阶段落盘 `00-`…`08-` 文件到 `.output/<world>/<run-id>/`。`mergeState` 按 id/name 归并状态；**默认只写 `08-state-update.json` 提案，仅 `--apply-state` 才覆盖正史 `story-state.json`**。
- **src/world-analysis.ts** — 纯文件交接、运行时不调用模型：5 个 `ANALYSIS_ROLES`（main-plot / creative / style / characters / continuity）→ `prepare` 生成各角色 `input.md` → 各 Agent 写 `output.md` → `collect` 用 `validateAnalysisOutput` 校验（≥600 字、≥6 处 `L####` 且在原文行数内、≥3 个二级标题、无占位符）→ `manifest.json` + `index.md`；只校验格式与证据密度，不判断观点。
- **src/story-state.ts** — `worlds/<world>/story-state.json`（schemaVersion 1）的加载 / 保存与空状态。

## 数据布局与边界

- `worlds/<world>/` — 正史资料（world-bible.md、characters.md、timeline.md、story-state.json、library/、chapters/），随代码提交。
- `analysis/<world>/` — 卷章索引、语料画像、多 Agent 分析工作记录，随代码提交。
- `sources/` — 语料来源与证据等级说明。
- `.output/`、`dist/`、`node_modules/`、`private/`、`original.txt`、`.env` 均被 .gitignore 排除；**私有原文绝不入库**。
- 证据纪律：结论用 `L####` 指向 `original.txt` 行号，区分「原著明确 / 作者设定 / 人物推断 / 待核实」四级；分析结论是工作记录，不等于正史。
- `library/index.json` 含全文切片，提交到公开仓库前须确认授权范围；import 与 continuation 的 `--source` / `--input` 只能用合法取得的文本。
- 当前边界：`annotations.json` 为空（全量 `analyze` 约 2594 次模型调用，尚未执行）；无跨章节实体归并 / 共指消解；无持久化 Agent session，中断不会自动恢复；故事状态为单机 JSON 文件，不支持并发写作。

## 仓库根 AGENTS.md 要点（仍适用）

- 面向资深架构师 / 工程师：关注架构、可扩展性、可维护性、可观测性、安全、性能与权衡，比较备选方案并说明取舍。
- 不维护向后兼容：废弃路径直接删除，不留兼容层 / 回退 / 迁移。采用满足当前需求的最简实现，避免无依据的抽象、配置与间接层；渐进分层构建，先端到端最小可用版本。
- 模块化、职责边界清晰；新增依赖前先评估现有依赖能力并查文档 / 类型定义，优先成熟库；决策着眼长期演进，设计前先研究成熟产品同类解法。
- 技术文章 / 研究报告：核实外部资料、区分证据类型、不写空泛最佳实践、转化为工程决策；图表只能用 `.agents/skills/diagram-design/SKILL.md` 直接产出 HTML + 独立 SVG，**禁止 Mermaid**；写回后复核链接 / 代码围栏 / 残留 Mermaid / 标题层级并跑构建。
- 交付报告前强制走 `skills/article-de-ai/SKILL.md` 去 AI 味；事实核查用 `skills/evidence-and-claim-review/SKILL.md`。
