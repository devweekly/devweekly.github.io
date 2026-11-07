# Novel Generation

本地长篇小说创作工具，使用 CodeBuddy Agent SDK。当前提供小说文本导入、原文检索、人物/事件/关系候选抽取、多 Agent 文本分析、多阶段章节写作，以及模型与执行链路自检。全文人物与情节分析通过 `analyze-story` 直接调用 CodeBuddy SDK，并将完整分析快照保存到 SQLite。

Web 工作台：在本目录运行 `npm run dev:web`，默认打开 `http://127.0.0.1:4173`。当前提供 World Dashboard、Story Plan 自动生成并激活、规划版本追溯、运行记录、人物档案与交互式故事图谱。故事图谱页面可切换原著全文图谱和续写动态关系图，支持搜索节点及一跳关联；原著图谱要求本地 SQLite 已合并完整 v6 快照。生成结果经 schema 校验后立即更新正式 `story-plan.json`，旧版本自动归档；工作台不设置人工审批门禁。

```bash
npm install
npm run dev:web       # 本地开发服务，默认 127.0.0.1:4173
npm run typecheck     # 后端与前端 TypeScript 检查
npm test
npm run build        # TypeScript + Vite 生产构建
npm run start:web     # 启动生产 Web 服务
```

续写架构与实现差距审计见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。 小说创作的最高原则及全文分析设计决策见 [`ADR-0001`](./ADR/0001-literary-priority-and-corpus-analysis.md)。续写默认全自动：章节完成后自动提取并提交故事状态；只有模型对照实验等隔离场景才使用 `--no-apply-state`。

## 1. 导入小说资料

只导入你合法取得且有权使用的 TXT 或 Markdown 文本。导入索引保存在 `worlds/<world>/library/`，故事状态保存在 `worlds/<world>/story-state.json`，两者随代码提交，检出后无需重新导入即可检索与续写。原始文件 `original.txt` 和 `private/` 目录不入库。`library/index.json` 含带重叠的全文片段，提交到公开仓库前需确认授权范围。

```bash
cd tools/novel-generation
npm install
npm run typecheck
npm test
npm run dev -- models
npm run dev -- check-runtime

npm run dev -- ingest --world conghuoniao --input ./original.txt
npm run dev -- ingest --world conghuoniao --input ./private/novel.txt
npm run dev -- ingest --world conghuoniao --input ./private/volume-1.txt ./private/volume-2.txt
```

导入器按常见中文章节标题切分章节，再切成带重叠区间的文本片段。未识别出章节标题时，会把整个文件作为一个章节处理。重复导入同一文件会替换该文件旧片段，并使其旧标注失效。

## 2. 检索原文

```bash
npm run dev -- search --world conghuoniao --query "人物名字 某次战斗 能力限制" --limit 8
```

当前检索使用本地词项和中文字符二元组的 BM25 风格排序，不依赖向量数据库或外部服务。它适合快速定位证据，不等同于语义检索；别名、隐喻和跨段落指代仍可能漏检。

## 3. 抽取人物、事件和关系

导入后可以分批调用模型分析文本片段，抽取人物、组织、地点、物品、能力、概念，以及事件参与者、时间表达、因果结果和明确关系。每条抽取结果必须附带原文证据；证据无法在原文片段中逐字匹配的条目会被丢弃。

```bash
npm run dev -- analyze --world conghuoniao --limit 20
# 继续处理下一批；已完成片段会跳过，失败片段会重试
npm run dev -- analyze --world conghuoniao --limit 20 --model <model-name> --timeout-ms 60000
```

结果保存在本地 `worlds/<world>/library/annotations.json`。重新导入发生变化的源文件时，对应旧标注会自动失效。抽取后会进行独立证据审查：模型逐条判断引文是否真正支持实体、事件、关系与共指结论，审查缺项或格式异常时按不支持处理。`analyze-world --phase collect` 还会读取本地原文，检查报告引用行是否存在、非空，并用独立模型核验每段结论是否被引用行支持；未提供原文或审查失败时不会标记通过。每条保留来源文件哈希、章节内字符偏移和原文引文；实体注册表只按原文出现且无歧义的显式别名归并，不做模糊匹配。共指仅在片段证据足以支持且目标人物可唯一映射到实体时解析，其余保留为待核实。抽取与审查结果仍是候选证据，不自动等同于已确认正史。

`analyze` 需要逐片段调用模型。全文规模下片段数以千计，全量抽取耗时和成本都高，可以先用确定性结构分析建立世界骨架：

```bash
node analysis/build-corpus-index.mjs
```

脚本读取根目录 `original.txt`，输出 `analysis/<world>/` 下的卷章索引、语料画像和卷结构表；`conghuoniao` 世界的分析结果见 `analysis/conghuoniao/analysis-report.md`，世界设定见 `worlds/conghuoniao/world-bible.md` 及同目录的 `yanfu-system.md`、`fruit-worlds.md`、`characters.md`、`timeline.md`。语料来源、证据等级和使用边界记在 `sources/local-corpus-analysis.md`。

## 4. 多 Agent 文本分析

`analyze-world` 用文件交接方式组织多个分析 Agent，不依赖 SDK 连通性。角色包括主线剧情、创意剧情、文风、人物与关系、世界观与连续性；各角色读取自己的输入包，成稿写入同目录 `output.md`，互不改写。

```bash
npm run dev -- analyze-world --world conghuoniao --phase prepare   # 生成输入包与协议
npm run dev -- analyze-world --world conghuoniao --phase status    # 查看交稿状态
npm run dev -- analyze-world --world conghuoniao --phase collect   # 校验并汇总（确定性，不调模型）
npm run dev -- analyze-world --world conghuoniao --phase collect --evidence-review  # 逐句事实核验（调模型）
```

输入包由本地检索库按角色查询词生成，含卷结构、建议精读行号区间与证据规范；成稿要求带 `L####` 行号、区分四级证据、不复制原文。`collect` 默认只校验格式、字数、证据密度与引用行号，输出 `manifest.json` 和 `index.md`，不判断观点对错。加 `--evidence-review` 才会让模型逐句核验：句中的数值、名称、身份与事件结果是否与该句引用的原文行一致（默认还看 ±2 邻行，`--evidence-window` 可调）。概括、评价、因果判断不参与判定；创意角色的项目原创提案整体豁免。未通过项计入 `complete`。章节索引按 schemaVersion 2 富结构读取。结果保存在 `analysis/<world>/agent-analysis/`，与主世界设定分开，属工作记录。

## 5. 多阶段章节写作

`write` 会结合当前故事位置、未解决情节线和人物名单，从本地资料库检索相关片段；如果已经运行 `analyze`，也会把命中片段对应的人物、事件和关系标注一并交给写作流程。随后由主线剧情 Agent 与创意发散 Agent 并行提出方案，主编 Agent 选定章节蓝图；场景小说家生成正文，人物对话 Agent 修整对白，叙事声音 Agent 统一全章表达，最终审查 Agent 只挑读者会认定「不可能」的硬伤：人物知道了没有渠道知道的信息、用了没有的能力、出现在不可能的位置，世界规则被打破，或时间因果断裂到读不懂。其余问题——措辞、用字、称谓、节奏、伏笔、偏好、需要复算或对照文档才能确认的疑点——一律不报。主编按必改项修复，最多两轮，每轮修复后重新审查。各 Agent 通过独立阶段文件交接，不并发改写同一份正文。只有最终复查通过，状态管理员才提取并校验故事状态，默认自动写入 SQLite 和兼容快照 `story-state.json`。

```bash
npm run dev -- write --world conghuoniao --mode continuation \
  --brief "从上一章结尾继续，展开一条新的调查线" \
  --source ./private/authorized-excerpt.md \
  --context ./private/continuity-summary.md \
  --retrieval-limit 6 \
  --max-words 3500

# 运行中断后，使用原目录恢复；已完成且输入未变化的阶段会直接复用
npm run dev -- write --world conghuoniao --mode continuation \
  --brief "从上一章结尾继续，展开一条新的调查线" \
  --source ./private/authorized-excerpt.md \
  --context ./private/continuity-summary.md \
  --resume-dir .output/conghuoniao/<原 run-id>
```

终审两轮后仍有必改项时，本次运行安全失败：最新成稿保留为 `chapter-blocked.md`，诊断写入质量摘要（状态为 `blocked`），故事状态不更新。系统不会提供人工批准绕过硬伤的开关；修复输入或问题后可从 checkpoint 恢复或重新运行。`--strict-model` 禁止失败时回退到备用模型，保证成稿模型来源可追踪。

每次运行生成：
- `00-retrieval.md`：命中的原文片段、来源位置和抽取标注
- `01-main-plot.md`、`02-creative-options.md`：主线方案与创意备选
- `03-chapter-plan.md`：主编确定的章节蓝图
- `04-scene-draft.md`、`05-dialogue-edited.md`、`06-voice-edited.md`：正文、对白修订和叙事声音统一
- `06a-anti-ai-diagnosis.md`、`06b-anti-ai-edited.md`、`06c-anti-ai-verification.json`：Anti-AI 证据诊断、编辑稿与保守复核
- `07-continuity-review.md`：终审必改清单；没有必改项时只有一行结论
- `chapter.md`：最终复查通过后的章节
- `08-state-update.json`：合并后的下一章状态（默认已自动持久化）
- `07-review-round-*-raw.txt`、`07-continuity-review-round-N.json`、`09-quality-summary.json`：终审原始输出、结构化复查结果与修复轮数
- `chapter-blocked.md`：终审两轮后仍有明确硬伤时保留的最新成稿；本次运行失败且故事状态不更新

章节生成成功后，状态管理员会提取人物、事件、正史事实和情节线变化，并自动写入 SQLite 权威状态及兼容 JSON 快照，供下一章直接使用。只有模型对照、盲测等需要候选互相隔离的场景才传 `--no-apply-state`；普通续写不要使用该参数。状态提取或持久化失败会使本次命令失败，不能把状态未更新的章节当作可继续写作的成功结果。`continuation` 模式的 `--source` 必须是你提供或有权使用的文本，本地 `private/` 不入库。

已跑通的续写成稿归档在 `worlds/conghuoniao/chapters/`，含正文、连续性审查和状态更新记录；该目录随代码提交，阶段文件仍留在 `.output/<world>/<run-id>/`。

### 万字章节：write-long

`write` 的单次正文调用适合两三千字以内的章节；一万字用 `write-long` 拆成多个场景逐场生成，避免单次输出截断：

```bash
npm run dev -- write-long --world conghuoniao --mode continuation \
  --brief "..." --source ./private/continuation-excerpt.md \
  --context ./private/continuity-summary.md \
  --max-words 10000 --scenes 8 --retrieval-limit 4 --timeout-ms 180000
```

流程：按情节自然需要生成场景蓝图，`--scenes` 是场景数量上限而非必须凑齐的配额；不会为了满足数字拆开连贯情节。格式错误自动修正一次 → 按场检索并注入相关人物当前状态 → 逐场成文，后续场景携带本章已生成正文的滚动上下文 → 分批终审（使用全章场景编号，结构错误自动重试）→ 逐场对白/文风修订 → 全章跨场终审 → 对必改项定位到受影响场景并最多自动修复两轮，每轮重新复查 → 最终章节与节奏指标 → 从最终完整正文提取并校验状态 → SQLite 和 JSON 自动持久化。最终复查未通过或状态提取/保存失败时命令失败，不会提交未通过章节的故事状态。仅隔离实验使用 `--no-apply-state`。

`analysis/conghuoniao/style-rhythm.md` 是离线语料观察资料，不是续写目标。正式写作不要求接近原著句长、段落或对白统计，也不会根据这些数字自动改写正文。`06-rhythm-metrics.json` 只保存诊断数据，供事后观察；不能据此判断小说好坏。

## 6. 单次生成

```bash
npm run dev -- generate --world conghuoniao --mode derivative \
  --brief "一名替旧城戏院修钟的匠人，发现午夜后所有钟表都会慢十三分钟" \
  --max-words 3500 --out .output/chapter-001.md
```

## 7. 模型与执行链路自检

默认模型是 `deepseek-v4.1-flash`，本机产品目录里 credits=0.11，会产生计费；免费的 `hy4free` 只作为失败回退。模型按以下顺序选择：

| 顺序 | 来源 | 写法 |
|---|---|---|
| 1 | `--model` | `npm run dev -- generate --model hy4free --brief "..."` |
| 2 | 环境变量 | `NOVEL_AGENT_MODEL=hy4free npm run dev -- write ...`（也认 `CODEBUDDY_DEFAULT_MODEL`） |
| 3 | 配置文件 | `novel-generation.config.json` 的 `model` 字段，可用 `NOVEL_AGENT_CONFIG` 指向别处 |
| 4 | 代码默认 | `DEFAULT_MODEL_ID = "deepseek-v4.1-flash"` |

`auto` 与空值视为未配置，会继续往下一层找；`hy4` 按别名展开为目录里的免费 `hy4free`。调用失败时按 `deepseek-v4.1-flash → hy4free` 换模型重试。

```bash
npm run dev -- models
npm run dev -- check-runtime
npm run dev -- check-runtime --model hy4free --timeout-ms 60000
```

`models` 显示目录、费率、当前模型链与来源。`check-runtime` 按参考项目的自检脚本拆成配置 → 目录 → CLI → 最小调用 → 日志核对：配置文件写了什么不算证据，CLI 日志里 `Sending request ... model=` 才能证明 `--model` 真的传到了子进程；日志按 cwd 目录名匹配 `~/.codebuddy/logs/YYYY-MM-DD/<cwd>__*.log`。

SDK 用法参照 `vocal-saga/local-agent-service`：模型目录合并产品配置、本地缓存与 user/project `models.json`，`auto` 不当模型 id；`query()` 禁工具、单轮、关闭宿主设置与会话持久化；调用方逐条消息与超时竞速，超时或异常时 `interrupt()` 并停止本地消费，`result.subtype` 非 success 时把 CLI 错误抛出来，不误报成空输出。本机 CLI 收到 `--request-timeout-ms` 会直接退出，超时完全由本地控制。

### 思考、推理强度与会话

`thinking` 与 `effort` 按阶段分配，取舍同参考项目 `taskProfiles.ts`。代码默认除 `plan`（`adaptive/high`）与 `state`（`disabled/low`）外全部为 `adaptive/medium`；`novel-generation.config.json` 又把 `plan` 与 `review` 覆盖为 `adaptive/high`。`taskProfiles` 可逐阶段覆盖（`thinkingMode` 取 disabled/adaptive/enabled，`effort` 取 low/medium/high，另可给 `thinkingBudgetTokens`），`npm run dev -- models` 打印当前档案。

三个实现细节会直接影响效果：

- 档案通过 SDK 的 `thinking` 对象下发：`disabled` → `{ type: "disabled" }`，`adaptive` → `{ type: "adaptive" }`，`enabled` → `{ type: "enabled", budgetTokens }`；`effort` 作为独立参数传给 `query()`。不使用已弃用的 `maxThinkingTokens`。
- `effort` 只在思考开启时生效；SDK 在 `thinking.type === "disabled"` 时跳过该参数，所以 `state` 阶段的 `low` 只是保持档案完整。
- 开启思考后，CLI 的默认 Agent 人格会先探查工作区、调用工具；工具被禁用时，部分模型把工具调用语法（`DSML`）当成正文吐出来，整章作废。现在所有纯文本调用都注入专用 system prompt，调用层检测到这类输出会关掉思考重试同一模型。

历史回归实验（卷 1 第十三章）曾尝试按原文统计值自动修订句法，但这只能说明模型在特定样本上的统计差异，不能证明更接近原文就更好看。该实验保留作研究记录，不作为正式写作策略；当前默认关闭指标驱动修订。

## 8. 回归对照

```bash
npm run dev -- regress --world conghuoniao --chapter 13 \
  --model deepseek-v4.1-flash --review-model glm-5.3-flash \
  --brief "本章任务：用白描写清这一章发生了什么，不给原文句子"
```

取原文中的一章做盲写：只把前 `--context-lines` 行（默认 90）、本章任务和风格参考交给写作 Agent，不给原文任何一句。同一提示跑两版推理配置：A 用配置文件里的 `scene` 档案，B 固定 `adaptive/high`。两版统计句长、段落、对白和标点密度，作为观察材料；默认不自动修订。只有显式启用 `--repair` 才会做一次实验性句法修订，用于研究指标变化，不代表文学质量提升。最后由另一个模型的评审 Agent 对照原文，结合具体段落判断哪版更自然、更有感染力；统计接近程度只是辅助信息。

`.output/regression/<run-id>/` 存原文、两版原稿与修订稿、评审全文；`analysis/<world>/regression/chapter-XXX/` 存 `metrics.json`、`review.md` 与实验说明，随代码提交。默认只统计节奏指标，不按数字自动改稿；只有显式传 `--repair` 才运行实验性的句法修订。该修订只适合对照实验，不建议用于正式小说成稿。`--max-words` 控制篇幅（默认与原章同长）。已有实验见 `analysis/conghuoniao/regression/chapter-013/`。

## 查看续写动态故事状态

原著成书知识库通过 `story-kb` 查询；续写过程中产生的人物状态、事件、关系变化、伏笔生命周期和 MacGuffin 变化保存在独立的 Story State 中。使用只读命令查看当前状态：

```bash
npm run dev -- story-state --world conghuoniao --type overview
npm run dev -- story-state --world conghuoniao --type relationships --query 李阎
npm run dev -- story-state --world conghuoniao --type foreshadowings --query 天母
npm run dev -- story-state --world conghuoniao --type macguffins --query 铜匣
npm run dev -- story-kb --world conghuoniao --type graph --query 李阎
npm run dev -- story-state --world conghuoniao --type graph --query 李阎
```

`--type` 支持 `overview`、`characters`、`events`、`threads`、`relationships`、`foreshadowings`、`macguffins`、`graph`；原著全文图谱在完整 v6 分析合并后，通过 `story-kb --type graph --query 人物名` 查询，续写动态关系图谱通过 `story-state --type graph --query 人物名` 查询，两者分开保存、分开展示。若 v6 的 delta 批次缓存已经齐备，可运行 `npm run dev -- analyze-story --world conghuoniao --delta --merge-only` 将快照合并进本地 `novel.db`；缺少批次时命令会报告 pending，不会重新调用模型。`--query` 做文本筛选，`--limit` 控制返回数量。`--type graph` 会从 Story State 的稳定 ID 和显式引用派生节点/边，并保留关系、伏笔和 MacGuffin 的更新历史；不做模糊实体合并。该命令不触发模型分析、不修改已有记录；若该 world 尚未初始化状态，首次读取会按既有 loader 逻辑创建空状态存储。

## 续写中的伏笔与 MacGuffin 生命周期

每章终审通过后，状态管理员会从最终正文中提取本章确实发生的伏笔、关键目标/物件/信息以及重要人物关系变化，分别追加到 Story State 的 `foreshadowingUpdates`、`macguffinUpdates` 与 `relationshipUpdates`。每条更新包含稳定对象 ID、章节、变化说明和正文逐字证据；伏笔与 MacGuffin 还可关联情节线；同一运行恢复时按更新 ID 幂等合并。没有自然发生变化时返回空数组，不要求每章必须埋设或回收伏笔，也不把分析建议变成剧情任务。

后续普通章节和长章节会从这些记录中按本次任务检索最近状态；终审可据此核对明确的线索状态、关键物件持有者/位置、人物关系变化和因果冲突，但不因伏笔尚未回收或 MacGuffin 没有推进而判定失败。原著成书知识库与续写动态状态分开保存，避免续写内容污染原著分析。

## 当前实现边界

- 使用 `@tencent-ai/agent-sdk` 的 `query()`。默认 `deepseek-v4.1-flash`、回退 `hy4free`；目录来自 `ACC_PRODUCT_CONFIG_PATH` 或 `~/.codebuddy/local_storage/*.info`（前者解析不出模型时仍会扫缓存），再叠加 user/project `models.json`。`--model`、环境变量与配置文件可覆盖，详见第 7 节。逐条消息竞速超时并主动中断，超时、无文本或执行失败时换链中下一个模型。
- 被 IDE/Agent 托管时（存在 `CODEBUDDY_SESSION_ID` / `WORKBUDDY_CONFIG_DIR`），SDK fork 的 CLI 会继承宿主服务端口并撞上主进程。`buildQueryOptions` 会清掉子进程的宿主会话变量，并加 `--port 0` 让 CLI 自选端口；托管会话内可直接运行 `analyze` / `write` / `generate`。`analyze` 可用 `--timeout-ms` 控制单片段上限。
- `analyze-world` 默认走文件交接，不调用模型；输入包与成稿随代码提交，便于复核每个结论的依据。`--evidence-review` 会额外调用模型逐句核验句中具体事实与引用行是否一致；解析失败的批次二分重试，不整片作废。
- 本地检索是词项/BM25 风格排序，不是向量语义检索。倒排统计与片段词频在进程内按索引文件版本缓存；索引更新后自动失效。Zod 是直接运行时依赖，用于校验故事状态、章节索引和模型证据审查输出。
- 回归对照只做写法比较：情节不同是预期的，评审 Agent 不据此扣分。指标由确定性函数统计，评审结论属于模型判断，两者分开记录。
- 文本抽取按片段进行，带独立证据审查、来源哈希/章节偏移、显式别名注册表和有证据门槛的共指解析；原著人物出场/事件时间线与人物 Profile 已进入成书知识库。续写 Story State 另行追加有正文逐字证据的 `arcMilestones`、`relationshipUpdates`、`foreshadowingUpdates` 和 `macguffinUpdates`，并在后续章节规划/终审上下文中按任务相关性读取；这些记录不反向改写原著分析快照。完整原著人物状态逐章重建、跨章节实体自动消歧仍有边界。\n- `analyze-story` 的 v6 全文图谱分析与 `analyze` 的逐片段 annotations 是两条独立流程：前者生成 `story_analysis` 快照，必须确认 `analysisVersion=6` 且 `complete=true`；后者涉及约 2,594 次模型调用，属于额外的逐片段证据标注，不是 Story Graph 的前置条件。仓库中能看到 v6 delta 批次缓存，但仅凭缓存文件不能确认当前 world 的 `novel.db` 是否已经合并到 v6；必须执行 `npm run dev -- analyze-story --world <world> --delta --merge-only` 验证；缺批次时会报告 pending。
- `analysis/build-corpus-index.mjs` 只做确定性结构解析，不调用模型；卷边界由章号重置判定，作者单章与卷末总结单独记录，不做语义归并。
- 导入器支持 TXT/Markdown；EPUB、PDF、OCR 和网页采集不在当前范围。
- 多 Agent 通过独立模型调用协作；主线规划与创意发散并行，其余阶段按依赖顺序执行。Agent SDK session 不持久化，但每个模型阶段有 SHA-256 输入指纹、输出哈希和原子 checkpoint。中断后使用 `--resume-dir` 指向原 `.output/<world>/<run-id>`（长章节为 `long-<run-id>`）恢复；只复用 prompt、模型与阶段配置完全一致且输出哈希未变化的阶段。运行目录保存初始故事状态快照，避免数据库提交后中断造成重复累加。
- 状态提取仍从模型返回的文本里解析 JSON；参考项目用的 `outputFormat: json_schema` 与 StructuredOutput 工具在 `deepseek-v4.1-flash` 上尚未验证支持，暂不启用。
- 故事状态采用 JSON 文件，适合单机原型；人物记录区分相对稳定的 `profile`（性格底色、价值观、内在矛盾、语言习惯、行为边界与弧光）和随剧情变化的当前状态（位置、知识、目标、关系等）。状态合并按人物/事件/情节线 ID 更新快照，不再把旧目标、旧关系无限累加。暂不支持并发写作或多人协作。
- 私有原文 `original.txt` 与 `private/` 留在本地，不提交到 Git。导入索引、抽取标注与故事状态随代码提交；`library/index.json` 保存全文切片，公开仓库需自行确认授权。


## 多模型续写对照实验

固定同一份前文、故事状态、续写任务、世界设定、风格约束和目标篇幅，让各模型分别运行完整写作流水线，再匿名盲评正文。

先检查模型目录和登录状态：

\`\`\`bash
npm run dev -- models
npm run dev -- check-runtime --model deepseek-v4.1-flash
npm run dev -- check-runtime --model glm-5.3-flash
\`\`\`

准备本地文件：\`private/previous-chapter.txt\` 是续写起点（上一章或其结尾，不能包含待生成章节）；\`private/context.md\` 可选，放所有模型共用的前情摘要、人物状态和未回收线索。

运行：

\`\`\`bash
node scripts/compare-models.mjs \
  --world conghuoniao \
  --source ./private/previous-chapter.txt \
  --context ./private/context.md \
  --brief "承接上一章结尾，明确本章目标、主要冲突、必须出现的人物和不可改变的事实；不要预先规定每个场景的具体写法。" \
  --models deepseek-v4.1-flash,glm-5.3-flash \
  --max-words 3000 \
  --repetitions 1
\`\`\`

脚本顺序运行现有 \`write\` 多 Agent 流水线，并启用 \`--strict-model\`：模型调用失败直接失败，不允许静默切换到其他模型。脚本显式传 `--no-apply-state`，确保所有候选读取同一份故事状态，彼此不会污染。模型参数请使用 \`models\` 输出的完整 ID，不用别名。

结果在 \`.output/model-comparison/<run-id>/\`：\`candidate-XX/\` 保存正文及各阶段产物；\`candidate-XX.log\` 保存日志；\`MODEL-MAPPING-PRIVATE.json\` 保存候选与模型映射。**盲评前不要把映射文件或日志交给评审模型。**

### 盲评步骤
1. 只取每个候选的 \`chapter.md\`，复制到独立评审会话，改名 Candidate A/B/C 并随机打乱顺序。
2. 同时提供相同的前文、world-bible、必要的人物状态/连续性材料，以及 \`prompts/model-comparison-review.md\`。
3. 评审模型必须与写作模型分开；最好再用第二个独立评审模型复核排名和重大问题。
4. 先看必改硬伤，再看加权分。分差小于 3 分不宣布可靠胜者。
5. 需要判断稳定性时设 \`--repetitions 2\` 或 \`3\`；单次胜出不等于稳定胜出。
6. 评审完成后再打开私有映射文件，将候选映射回模型，记录结果和下一轮改进。

### 实验控制边界
- 固定 brief、source、context、world-bible、story-state、style-profile、style-rhythm、task-profiles、篇幅和检索设置。
- \`--strict-model\` 禁止自动 fallback；脚本顺序执行，避免并发负载差异。
- 评审不提供模型名、耗时、credits 或生成日志，避免身份和速度偏见。
- 原章节用于理解上下文和核实事实，不是续写的标准答案。评价重点是新章节是否成立、人物是否可信、故事是否推进，不是模仿原文句子。
- 不把一次评审意见直接固化成永久规则；先确认问题在重复测试中出现，再决定改 prompt 或 workflow。


## SQLite 世界数据库

每个世界有两个 SQLite 文件，都用 Node 22.13+ 内置 `node:sqlite`，不引入原生 npm 扩展。

| 文件 | 内容 | 写入时机 | 体积 |
|---|---|---|---|
| `worlds/<world>/novel.db` | 抽取标注、实体/实体提及、全书分析结果（`novel_*`、`story_analysis`） | `analyze`、`index-story`、`analyze-story`、`analyze-arcs` | 约 12MB |
| `worlds/<world>/story.db` | 写作状态：`story_state`、`characters`、`canon_facts`、`story_events`、`plot_threads`、`continuity_notes` | 每写一章 | 约 68KB |

原文分片只存在 `worlds/<world>/library/index.json` 里，检索与章节映射都直接读它，库里不再留第二份文本。

分开的理由是写入频率差了三个数量级：写一章会把人物、事件、情节线、连续性备注整批重写，而知识库几周才动一次。放在同一个文件里，每次章节更新都会让 12MB 的二进制重新落一份进 Git；分开之后，日常提交只碰 68KB 的状态库。两个文件各自有 `user_version`，可以独立演进。

章节检索从知识库读取片段，再沿用现有 BM25 排序；续写上下文按命中的 chunk ID 读取标注；写作状态一律从 `story.db` 读。

首次访问会自动把已有 `library/index.json`、`annotations.json` 和 `story-state.json` 导入数据库。此后故事状态以 SQLite 为权威存储，`story-state.json` 保留为可读兼容快照；库索引和标注 JSON 继续作为可重建/交换快照。重新导入源文件会在事务中替换 SQLite 片段索引并清理对应过期标注。数据库不存原始小说全文文件，只存索引片段及结构化信息。

查看数据库状态（会先尝试迁移已有 JSON 快照）：

```bash
npm run dev -- db-status --world conghuoniao
```

schema v3 增加一组 `novel_*` 表，用来存放**成书知识库**，与写作状态（`characters`、`story_state`、`story_events`）分开：`novel_chapters`（753 章的卷序、行号、字数）、`novel_characters`、`novel_mentions`（人物×章出场次数）、`novel_plot_threads`、`novel_foreshadowings`、`novel_beats`（章级事件）、`novel_relations`。写作状态描述「这一章之后接下来怎么写」，`novel_*` 描述「全书已经写了什么」，两者不互相覆盖。

schema v6 删掉 `library_chunks`：它存的是 `library/index.json` 里同一批分片的副本，检索、章节映射、写作都直接读 JSON，库里不再保留第二份原文。

```bash
npm run dev -- index-story  --world conghuoniao        # 章节结构 + 人物出场统计（不调用模型）
npm run dev -- analyze-arcs --world conghuoniao        # 卷级主线梗概（依赖章级事件）
npm run dev -- analyze-profiles --world conghuoniao     # 主要人物合并档案（逐批观察 → 一份画像）
npm run dev -- story-kb     --world conghuoniao --type overview
npm run dev -- story-kb     --world conghuoniao --type characters --query 李阎
npm run dev -- story-kb     --world conghuoniao --type threads --status 进行中
npm run dev -- story-kb     --world conghuoniao --type foreshadowings --status 已回收
npm run dev -- story-kb     --world conghuoniao --type beats --from 1 --to 60
npm run dev -- story-kb     --world conghuoniao --type arcs
npm run dev -- story-kb     --world conghuoniao --type export   # 导出不含原文的快照
```

当前 `conghuoniao` 库的规模：753 章、544 人（6,402 条人物×章出场记录）、1,314 条章级事件（覆盖 738/753 章）、862 条局部情节线、1,535 条伏笔线索、1,649 条人物关系、17 篇卷级梗概。

`novel_characters` 的 `personality`/`desires`/`contradictions`/`arc` 是**逐批观察**，不是去重后的画像：每一批只看几章，同一个人会被反复描述。主角尤其明显——李阎有 193 条性格、194 条矛盾、380 条走向，实测两两相似度都低于 0.6，纯文本去重一条也去不掉。`analyze-profiles` 把它们按章节顺序采样后交给模型合并，写入 `novel_character_profiles`：一份 150–250 字画像、3–5 条阶段变化、3–6 条性格与矛盾、3–5 条可能走向。写作事实包和 `story-kb --type characters` 优先用合并档案，原始观察保留作证据。

`novel.db` 与 `story.db` 随仓库提交，换机器后不必重跑 196 次模型调用。`novel.db` 重跑 `analyze-story` 会整文件重写（约 12MB），所以它的提交应集中在数据更新的那一次；`story.db` 每次章节落地都会变，但只有几十 KB。`story-kb --type export` 写出的 `story-kb.json` 是 `novel_*` 表的文本副本，随时可重出，因此不入库。

`index-story` 按 `analysis/<world>/chapter-index.json` 的行号顺序把 2,594 个检索片段映射回 753 章。检索片段之间带约 160 字重叠（为检索保留上下文），统计和送模型前会先去重，否则人物出现次数会虚高约 12%。

WAL/SHM sidecar 仍忽略，它们随进程变化。需要迁移或重建时先保留 JSON 快照，再删掉对应文件；下一次运行会从快照重新导入。改动前后体积差异明显时用 `VACUUM` 收一下（例如 `novel.db` 22MB → 12MB），避免把空闲页也提交进去。

旧版本的写作状态存在 `novel.db` 里。首次打开 `story.db` 时会自动把这几张表搬过去并从 `novel.db` 删除；迁移失败只在日志里告警，不会阻塞写作。

## 写作前的注入顺序与硬约束

写作分两层给模型看世界：**事实**和**启发**。事实来自 `novel_*` 表与 `story-state.json`，用来约束本章；启发来自 `story_analysis` 分析快照，只是素材。

```text
world-bible.md        世界索引（9KB）
story-state.json      当前处境：位置、能力、知情、目标、关系
writing-brief.ts      全书知识库：相关人物画像、未收情节线、未回收伏笔、最近三章既成事实（≤3k 字）
story-analysis 快照   交叉批次分析：人物画像、情节线、伏笔、后续构想（≤6k 字，标注为可选素材）
检索片段              BM25 命中的原文段落
```

前三项是事实，后两项是参考。`write` / `write-long` 启动时会打印各段注入字符数，长度异常可以直接看到。

硬约束写在 `worlds/<world>/laws.json`，只登记能机器判定的部分（位阶天花板、数值上限、身份禁忌）。`src/iron-laws.ts` 在终审前扫描正文，命中项带场景号并入必改清单，和模型审查结果一起进入修复流程。规则写错会直接报错，不会静默跳过；文件不存在表示这个世界没有登记硬约束。

万字流水线在终审失败时先改蓝图：把必改项映射到场景，只重写受影响场景的目标、信息差与代价，其余场景保持原蓝图，再生成这些场景的正文。蓝图修订格式不合规或改了场景数时退回原蓝图，不会拖垮整章。

## 打包审核材料

把数据库样本、分析请求/响应、生成的章节与运行日志打成一个压缩包，交给其他模型或同事审阅：

```bash
npm run package-review
npm run package-review -- --out /tmp/review.zip --max-mb 6 --batches 5
```

打包原则是**已经入库的不重复打包**：分析结果、生成章节都在仓库里，包里只给概要、样例和出处。

- `01-database/`：schema、统计、质量问题清单，每张表 1–6 条示例（人物数组只留前几条，真实条数写在 `arrayCounts`）
- `02-analysis-calls/`：默认 3 组重建的请求体，加上缓存里实际存在的响应
- `03-writing/`：万字流水线产物、两份早期章节
- `04-logs/`：运行日志
- `REFERENCES.md`：完整数据与产物的仓库路径和查询命令

当前约 500KB 未压缩 / 236KB 压缩，54 个文件。原文全文与 12MB 的 `novel.db` 不进包。

- 请求体由 `buildAnalysisPrompt` 对同一批章节重建，与线上一致；响应体直接取调用缓存。SDK 不落盘 token 与耗时，包里没有这两项。
- `--max-mb` 是未压缩体积上限，超限时按固定顺序丢弃可选文件（润色稿、检索上下文、草稿、状态、日志、多余批次），丢弃项写进 `manifest.json` 和 `README.md`。
- 包内 `README.md` 列了建议审查的优先级和已知局限，`manifest.json` 给出每个文件的字节数与 sha256。

## 目录

```
src/
  cli.ts
  generate.ts
  workflow.ts
  story-state.ts
  library.ts
  analysis.ts
  entity-registry.ts
  agent-runtime.ts
  world-analysis.ts
  runtime-check.ts
  task-profiles.ts
  long-chapter.ts
  regression.ts
  rhythm.ts
  database.ts
  novel-kb.ts
  story-analysis.ts
  story-analysis-context.ts
  story-arcs.ts
  chapter-review.ts
  writing-brief.ts       # 从 novel_* 表生成写作事实包（相关人物/未收线/未回收伏笔/最近既成事实）
  iron-laws.ts           # laws.json 的确定性检查：位阶天花板、数值上限、身份禁忌
  stage-cache.ts
  model-json.ts          # 共享 JSON 提取：平衡括号截取 + 控制字符/尾逗号修复
novel-generation.config.json
analysis/
  build-corpus-index.mjs
  conghuoniao/
    analysis-report.md
    style-rhythm.md
    chapter-index.json
    corpus-profile.json
    volumes.md
    agent-analysis/
      PROTOCOL.md
      index.md
      manifest.json
      <role>/input.md
      <role>/output.md
    regression/
      chapter-XXX/
        metrics.json
        review.md
        README.md
sources/
  public-chapter-sources.md
  local-corpus-analysis.md
test/
  entity-registry.test.ts
  library.test.ts
  world-analysis.test.ts
  agent-runtime.test.ts
  agent-stream.test.ts
  task-profiles.test.ts
  long-chapter.test.ts
  regression.test.ts
  rhythm.test.ts
worlds/
  conghuoniao/
    world-bible.md
    yanfu-system.md
    fruit-worlds.md
    characters.md
    timeline.md
    style-profile.md
    story-state.json
    library/
      index.json
      annotations.json
    chapters/
      README.md
      chapter-001.md
      continuity-review-001.md
      state-proposal-001.json
.output/
  conghuoniao/
    <run-id>/
```


## 多 Agent 写作职责

| Agent | 职责 | 修改范围 |
|---|---|---|
| 主线剧情架构师 | 推进主线、控制因果和长期情节 | 输出剧情方案 |
| 创意发散 Agent | 提供冲突、转折和备选方向 | 输出候选点子，不写入正史 |
| 主编 Agent | 取舍创意、确定章节蓝图、终审 | 决定最终正文 |
| 场景小说家 | 把蓝图写成完整场景 | 生成初稿 |
| 人物对话编辑 | 校准角色语气、潜台词和知识边界 | 修订对白 |
| 叙事声音编辑 | 提升语言自然度、画面感、情绪、人物声音和阅读节奏 | 修订叙述表达；不按统计指标改稿 |
| 终审 Agent | 只判断有没有读者会认定「不可能」的硬伤 | 最多 3 条；其余问题不报 |
| 状态管理员 | 从最终稿提取人物、事件和情节线变化 | 更新结构化状态 |
| 评审 Agent（回归用） | 对照原文与盲写成稿，判断节奏、段落与信息承载的差距 | 只出报告，不改稿 |

上表对应 `write`。`write-long` 把人物对话编辑与叙事声音编辑合并为一次逐场修订调用，其余职责相同。

评审 Agent 用独立模型（默认 `glm-5.3-flash`），与写作 Agent 分开配置：写的人不评自己的稿。评审拿到的是原文、两版成稿和一份确定性指标表，指标由代码算，判断由评审给，两者不混在同一份结论里。

可在 `worlds/<world>/style-profile.md` 中维护抽象叙事参考，例如视角、叙述距离、句式变化、对白声音、动作/环境描写和悬念节奏。它是帮助写作的参考，不是必须逐项执行的约束；人物和文学表达优先于统计相似度。不要把某位作者的原文或标志性句式作为风格模板。该文件可不创建；缺省时使用通用叙事约束。

## 原创阎浮果实世界提案

为续写设计新果实世界时，先阅读 [`original-fruit-world-concepts.md`](./original-fruit-world-concepts.md)。该文档包含六个项目原创候选世界，以及历史背景、经济结构、风俗民俗、日常生活、异常规律、事件入口和人物冲突。所有内容均与原著正史分开；正式使用前需对照 `world-bible.md`、`yanfu-system.md` 和 `fruit-worlds.md`，不得把工作设定误写成原著规则。

## 9. 自动分析人物与故事发展

`analyze-story` 会读取已经导入 SQLite 的全部小说片段，直接通过项目现有 CodeBuddy Agent SDK 分批调用 LLM。它自动梳理人物小传、故事作用、性格与内在矛盾、欲望和关系、文本中已呈现的变化及可能的成长/反转方向，以及主线情节、支线、未解问题、可能伏笔、章级事件和后续发展构想。

```bash
npm run dev -- analyze-story --world conghuoniao
npm run dev -- analyze-story --world conghuoniao --model <model-name> --timeout-ms 180000
npm run dev -- analyze-story --world conghuoniao --limit 1          # 冒烟：只跑第一批，不合并
npm run dev -- analyze-story --world conghuoniao --shard 0/4        # 并发分片
npm run dev -- analyze-story --world conghuoniao --merge-only       # 全部缓存齐后合并入库
npm run dev -- analyze-story --world conghuoniao --delta --shard 0/4  # 增量补齐 v6 字段
npm run dev -- db-status --world conghuoniao
```

`--delta` 用于把旧版快照升级到 `analysisVersion=6`：它复用磁盘上已有的旧批次长文本分析（人物小传、情节线摘要、伏笔、章级事件等），只对每批重新抽取 v6 新增字段——故事核心观察、MacGuffin、情节线主线/支线分类与关联人物、关系动态与互动时刻、伏笔关联情节线、别名分类与原文证据。章节原文仍需重新喂给模型，因为新增字段要带 `chapterKeys` 才能回查；省的是输出，不是输入。旧条目没有 `chapterKeys`，升级时补成本批章节集合，保持旧版原有的「整批来源」粒度，不伪装成逐条精确引用。

增量缓存用独立指纹 `story-analysis-delta-v1`，不覆盖旧批次缓存。命令会打印它选用的旧缓存目录。只有全部 196 批成功、且确实产出了 v4 不可能有的新字段时，才写入 `analysisVersion=6`；否则抛错并保持原快照不变，避免「填空数组 + 改版本号」式的伪造升级。分片跑完后用 `--delta --merge-only` 合并（合并时不带 `--shard`）。

分析单元是**章**，不是检索片段：每章文本先去重叠，再按约 14,000 字装箱，一章不跨批拆开。提示词用 `chapterKey`（如 `V11-C045`）标注每章，模型返回的章级事件必须带上同一个 key，写入时用它对齐 `novel_chapters`，出处因此是「第几卷第几章」而不是片段 ID。全书约 196 批。

每批结果缓存到 `.output/<world>/story-analysis/<cache-key>/`，中断后重跑会跳过已完成批次；`--shard i/n` 让多个进程各跑一片，互不写同一文件。全部批次成功后才合并写入 `worlds/<world>/novel.db`：`story_analysis` 保留完整快照供写作上下文检索，`novel_characters`、`novel_plot_threads`、`novel_foreshadowings`、`novel_beats`、`novel_relations` 存规范化结果供查询。中途失败不会用半成品覆盖上一次完整结果；单批失败会记录并继续，其余批次仍会入缓存；JSON/schema 解析失败会保留原始响应并自动做一次结构修复重试，仍失败的批次不会写入成功缓存，后续可重跑。

跨批人物只按规范姓名合并；带原文证据的个人化名/别称可作为检索别名，但不用于自动合并人物。称号、职位、传承、能力和身份分别分类；共享别名不参与人物关系解析。姓名不合中文人名形态（含虚词、泛称、超长短语）的条目会被丢弃。章级事件按 `chapterKey + 摘要` 去重；情节线与伏笔的 `status` 归一为「进行中 / 已收束 / 悬置」和「埋设 / 已回收 / 未判断」，便于按状态查询。每项分析附带其来源章的键，便于回到原文核对；这是上下文来源范围，不表示批内每章都直接支持该项。

分析不是文学审判。人物小传不是性格定型，成长方向不是人物必须完成的弧光，伏笔也可能只是偶然细节；后续发展建议可以互相矛盾、出人意料，且明确标记为创作可能性。**文学性、文笔、艺术风格，高于其他一切！** 不得为了让数据库条目完整或让情节分析自洽而牺牲小说本身。


### 将全文分析用于续写

运行 `analyze-story` 后，普通 `write` 与 `write-long` 会从 SQLite 读取最近一次完整分析快照，按本次任务、前文摘要、当前位置、未结情节线和人物名称做轻量相关性筛选，只把少量相关人物、情节、可能伏笔和发展选项作为可选参考注入写作上下文。没有相关项或分析尚未完成时，不注入内容。重新导入语料会自动使旧分析快照失效，需要重新运行 `analyze-story`。

这些资料不是正史、人物定论或必须兑现的情节清单。写作 Agent 可以采用、改造、组合或舍弃；当分析与本次创作意图、正文自然性或文学表达冲突时，以文学表达为准。该上下文会参与阶段输入指纹，恢复任务时不会误用旧提示词结果。


### 数据来源与润色诊断

新章节首次引入的事实会在状态合并时强制标记为项目原创（`original`），只有已有事实 ID 才保留原有正史来源等级；事件记录 `origin`。人物别名按 `name_alias / nickname / title / role / inheritance / ability / identity` 分类，只有带原文证据的本名/化名/个人绰号参与检索，别名不会触发人物自动合并。情节线去重同时看标题、来源章节集合和关键转折内容；同名不同阶段或关键转折不同的记录保留独立 ID。

`write-long` 每场润色会保存 `05-polish-diagnostics.json`，记录修改前后汉字数与变化比例。这只是发现异常扩写/精简的诊断数据，不是字数门槛；润色后的完整章节仍经过最终连续性审查。连续性备注只做格式级去重，不以语义相似度合并可能不同的事实。

旧状态加载时会把来源明确包含“续写/续章/衍生/项目原创”的事实降为 `original`，并自动回写 SQLite 与兼容 JSON。`analysisVersion` 缺失或低于当前版本（6）的快照一律不注入写作上下文；完成 `analyze-story` 或 `analyze-story --delta` 并生成 v6 快照后才重新启用人物、情节与伏笔参考。

旧批次缓存不会自动迁移成新版本：v3/v4/v5 缺少 v6 字段语义，直接复用会产出残缺图谱。`--delta` 是受控的升级通道——保留旧长文本，但 v6 新增字段必须由新提示词按原文重新抽取。


### 自主运行与人工介入

普通写作和主线规划默认自主完成，不等待人工 review 或批准。Web Workbench 中生成的 Story Plan 在 schema 与 World ID 校验通过后立即生效，旧版本自动归档；CLI 的 `plan-story` 也默认激活，只有明确使用 `--draft` 才保存隔离草稿。工作台中的版本记录用于事后检查，不是待审批队列。

章节终审发现明确硬伤时会先进行有限轮自动修复。达到上限仍未解决，当前运行安全失败、不提交 Story State，并保留正文和诊断材料供定位；这不是必须人工点击批准的常规流程。只有无法安全自动恢复、权威状态冲突或不可逆/安全敏感操作才需要人工介入。详见 [ADR 0003](./ADR/0003-autonomous-execution.md)。


## 后续改造计划

D&D Campaign 的借鉴仅限世界设定、人物自主行动、有限局势推演和长期连续性，不引入游戏规则或跑团交互。实施阶段和验收标准见 [ACTION-PLAN.md](./ACTION-PLAN.md)。


## Living Voice、Anti-AI 与读者体验

普通章节和万字章节在叙事声音修订后，都会执行共享的 Living Voice / Anti-AI 编辑。它只处理真正损害阅读体验的模板化表达，不以 AI 检测分数、禁词、连接词频率、句长或段落长度驱动改写。原稿成立时可以零修改；编辑不得改变剧情事实、人物决定、信息揭示、视角和场景顺序。

写作、对白、叙事声音和编辑阶段共享 Living Voice 原则。Anti-AI 阶段依次生成 `06a-anti-ai-diagnosis.md`、`06b-anti-ai-edited.md` 和 `06c-anti-ai-verification.json`：诊断只报告有具体文本证据的阅读问题，不判断文本是否由 AI 生成；独立复核只有确认编辑有明确收益且没有损害原文时才保留编辑稿，否则恢复原稿。诊断失败不阻断编辑，编辑失败或复核失败均保留安全的上一阶段正文并继续终审。最终终审通过后，Reader 以不读取人物档案、蓝图和剧情摘要的盲读方式生成 `10-reader-experience.md`。Reader 不负责硬伤审查、不输出必改项、不触发自动修复，也不影响章节通过和状态提交。相关设计见 [ARCHITECTURE.md 第 10 节](./ARCHITECTURE.md) 与 [ADR 0004](./ADR/0004-living-voice-and-anti-ai-editing.md)。


### 提炼项目风格资料

可用授权的 TXT/Markdown 样本生成新的风格资料候选，不会自动覆盖正式的 `worlds/<world>/style-profile.md`：

```bash
npm run dev -- distill-style --world conghuoniao \
  --input ./private/style-sample-1.txt ./private/style-sample-2.md \
  --out .output/conghuoniao/style-profile-candidate.md

# 检查候选后，显式激活为正式项目风格资料
npm run dev -- distill-style --world conghuoniao \
  --input ./private/style-sample-1.txt ./private/style-sample-2.md --activate
```

`--out` 只能写入当前 world 的 `.output/<world>/`，避免误覆盖正史或项目文件。默认样本总量上限为 80,000 字符，可通过 `--max-sample-chars` 调整（最高 160,000）。提炼结果描述叙事距离、节奏、视角、对白、意象、情绪表达和场景差异等抽象特征，不输出长段原文或可直接套用的句式模板。候选文件需要作者自行检查。显式使用 `--activate` 才会更新 `worlds/<world>/style-profile.md`；旧版本会先归档到 `.output/<world>/style-profile-history/`。正式写作自动读取激活后的风格资料，并把抽象风格资料注入剧情规划、正文写作、对白与叙事声音编辑等相关阶段。

**正式小说生成 Pipeline 会自动执行风格回归观察**，不需要每章手动运行。普通章节和长章节通过终审后，自动读取激活的 `style-profile.md`，并尝试读取 `worlds/<world>/style-references/` 下最多 4 个经认可的 `.md` / `.txt` 样本，生成 `11-style-regression.md`。参考样本只需维护一次，后续每次写作自动使用。没有参考样本时，仍以 Style Profile 做有限观察，并明确标记证据不足。

认可样本通过 CLI 管理，替换和移除都会保留历史版本，历史目录不会被正式写作读取：

```bash
npm run dev -- style-reference --world conghuoniao --list
npm run dev -- style-reference --world conghuoniao --history
npm run dev -- style-reference --world conghuoniao --add ./samples/dialogue.md ./samples/narration.txt
npm run dev -- style-reference --world conghuoniao --remove dialogue.md
```

```text
worlds/<world>/
  style-profile.md             # 激活的抽象风格资料，自动注入写作阶段
  style-references/
    dialogue.md                # 可选：认可的对白样本
    narration.md               # 可选：认可的叙述样本
```

风格回归只生成观察报告，不打分、不改稿、不影响章节通过。报告中的差异不会自动变成改写指令，也不能要求模型把新章节改成参考文本的句式或节奏。

手动 `style-regress` 命令仍保留，用于对任意参考/候选文件做一次性对照实验，不是正常写作流程的必需步骤。

跨章节趋势观察可运行：

```bash
npm run dev -- style-trend --world conghuoniao --limit 30
```

逐章状态快照与全量 annotations 是两个独立任务：

```bash
# 原著逐章人物状态；默认处理所有有明确人物候选的章节，逐章写入 SQLite，可中断后重复运行
npm run dev -- analyze-character-states --world conghuoniao

# 大语料可分片执行；由于后续章节会参考前序人物状态，建议按 shard 序号顺序运行；若并行执行，前序 shard 完成后需重跑后续 shard 以刷新状态差异
npm run dev -- analyze-character-states --world conghuoniao --shard 0/4
npm run dev -- analyze-character-states --world conghuoniao --shard 1/4

# 小范围试跑或指定人物
npm run dev -- analyze-character-states --world conghuoniao --limit 5
npm run dev -- analyze-character-states --world conghuoniao --names 李阎,查小刀

# 查询人物逐章状态
npm run dev -- story-kb --world conghuoniao --type character-states --query 李阎 --limit 500

# 查看当前知识库和状态库的表行数/Schema 版本
npm run dev -- db-status --world conghuoniao

# 一次性核验 v6 原著图谱合并、annotations 覆盖率、人物逐章状态行数，并输出缺失项的下一条命令
npm run dev -- verify-world --world conghuoniao

# 全量逐片段 annotations；每批落盘，失败记录保留，重新执行会继续未完成项并在无进展时停止
npm run dev -- analyze --world conghuoniao --all --batch-size 20
```

逐章状态只记录原文支持的观察；证据必须是本章原文的逐字连续片段。没有证据的模型输出不会进入数据库。每章会参考该人物最近一条前序状态；正文或前序状态变化时，下游章节会重新分析。人物状态不是角色设定的强约束。

该命令聚合最近最多 30 份已完成的章节回归报告和专项回归报告，输出到 `.output/<world>/style-regression-trend/`。它只总结持续特征、变化迹象和场景差异，不读取章节草稿、不打分、不设置门槛，也不会触发正文修改。Workbench 的“文风样本”页面可添加、更新和归档认可样本，并查看历史版本；更新会先保存旧版本。历史版本不会进入正式写作回归上下文。

### 人物互动推演沙盘（作者主动调用）

需要探索人物在某个场景中的互动时，可以启动独立的交互式沙盘。它读取当前 Story State 中指定人物的动态状态、成书知识库中的人物长期观察，以及任务相关的故事图谱（人物互动、情节线、伏笔和关系边）；所有推演都只是候选创作素材，不会写入正史或 Story State：

```bash
npm run dev -- roleplay-sandbox --world conghuoniao \
  --brief "两名旧友在雨夜重逢，彼此都隐瞒了一件事" \
  --characters 人物甲,人物乙
```

每轮输出后，作者可以直接接受并继续、修改方向、补充场景信息、重演本轮或结束。推演记录默认保存在 `.output/<world>/roleplay-sandbox/`；自定义 `--out` 也必须位于该 world 的 `.output/` 内，避免覆盖正史文件。它不属于每章自动流水线，不会强迫 NPC 每章行动，也不引入 D&D 数值、回合制或任务机制。

### 原文创作素材分析（Scene / Voice / Causality）

在现有全文人物/情节分析之外，可运行增量离线素材分析。它重点整理实际场景、对白原句、人物表达观察、事件因果、角色知识边界、世界日常细节和叙事手法。每条分析保留原文逐字证据；没有证据的条目不会进入素材库。

```bash
# 先确保已完成 ingest，并已有 analysis/<world>/chapter-index.json
npm run dev -- analyze-corpus-craft --world conghuoniao --limit 20
npm run dev -- analyze-corpus-craft --world conghuoniao
# 大语料可分片；corpus-craft 各章独立，可并行
npm run dev -- analyze-corpus-craft --world conghuoniao --shard 0/4
npm run dev -- analyze-corpus-craft --world conghuoniao --shard 1/4
```

输出位于 analysis/<world>/corpus-craft/chapters/。每章以正文哈希和分析提示版本做增量缓存；失败章节可在下次运行重试。它与原有 analyze-story、analyze-character-states 并行互补，不覆盖原有 SQLite 知识图谱。

### 可选 Vane 混合检索

Vane 仅是第二检索索引，不是 SQLite 替代品，也不是必需运行时。按需安装 Node binding：

```bash
npm install --no-save @vane-rs/node@0.4.1
npm run dev -- vane-index --world conghuoniao
```

默认不配置 embedding 时，Vane 使用中文 jieba BM25；需要语义混合检索时，设置 OpenAI-compatible embedding endpoint：

```bash
export VANE_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
export VANE_EMBEDDING_MODEL=<embedding-model>
export VANE_EMBEDDING_DIM=<embedding-dimension>
# 如果服务需要 key，再设置 VANE_EMBEDDING_API_KEY
npm run dev -- vane-index --world conghuoniao
```

Vane 索引位于 worlds/<world>/vane-index/，每个 world 独立。普通章节和长章节会自动尝试检索 Vane；未安装、未建索引或检索失败时，原有 BM25/SQLite 路径继续工作。重新导入或重做离线分析后，重新执行 vane-index 更新索引。

离线分析资料会自动进入普通 write 和 write-long 的写作上下文，按当前任务选取少量相关素材；它们是创作参考，不是剧情清单、人物行为规范或风格验收指标。


## 本地模型与 DeepSeek 分析质量对比

见 [MODEL-COMPARISON.md](./MODEL-COMPARISON.md)。运行 `npm run compare-models` 可使用相同章节和提示词比较 LM Studio 本地模型与 DeepSeek，并自动生成 ZIP 诊断包。

## 6. 本地模型能力测试

测试 LM Studio 中的 Chat 与 Embedding 模型：人物/事件/场景抽取、章节摘要、对白续写、场景创作、文学编辑，以及 Embedding 检索自检。完整说明见 [LOCAL-MODEL-BENCHMARK.md](./LOCAL-MODEL-BENCHMARK.md)。

```bash
npm run benchmark-local-models
```

建议在 LM Studio 中每次只加载一个模型，分别运行并比较结果；未加载模型会标记为 not_loaded，不会当成模型能力失败。

## 故事宇宙的历史起点隔离

创建新宇宙或从历史章节 fork 时，系统使用宇宙本地的截断原文索引，并对原著 SQLite 知识库执行章节截止过滤。无法证明按章节安全的全书聚合表、未知表会被排除。

同样重要的是，历史分支不会复制可能包含全书未来剧情的根级汇总文件（包括 world-bible、人物、时间线、世界设定汇总和 style profile），也不会复制 analysis、Corpus Craft、Vane 与 Style Reference 派生目录。这是保守隔离策略：在按起点重建这些资料之前，部分背景资料可能暂时不可用，但不会为了资料完整而把后续剧情泄漏进历史宇宙。原文章节正文仍通过 bounded library 和起点前情上下文提供。

当前已增加真实 SQLite 快照测试、Create/Fork API + 文件系统集成测试、连续分叉回归，以及按起点过滤的 universe-local chapter catalog。Workbench 已提供后台知识重建入口和逐步骤状态；Create/Fork 默认异步启动八步时点知识重建。新增 `export-asof-dossier`，在完整 `analyze-story` 后把人物、主线、伏笔、MacGuffin、故事核心和发展可能性从当前宇宙 SQLite 快照导出到 `worlds/<world>/as-of-analysis/`；不复制父宇宙资料，且再次分叉时明确排除该目录。写作检索路径统一使用 fail-closed 的 universe-local bounded index，Vane manifest 也必须与当前 worldId 匹配；集成测试实际执行章节单元构建、SQLite 分析上下文、Corpus Craft 与 Writing Brief 的历史 marker 泄漏检查。仍需在具体原著语料上做 LLM 生成结果抽样与并发故障注入压力验收。


### 故事宇宙的后台知识重建

新建或 fork 的历史宇宙使用独立的截断 SQLite 与 bounded library。需要补齐起点之前的人物、关系、主线、伏笔和章节素材时，可通过 Workbench API 启动后台重建；它不阻塞写作，失败也不会阻止继续生成章节：

```http
POST /api/worlds/<universe-id>/knowledge-build
GET  /api/worlds/<universe-id>/knowledge-build
```

任务按顺序复用 `analyze-story`、`analyze-arcs`、`ensure-style-profile`、`analyze-profiles`、`analyze-character-states`、`analyze-corpus-craft` 和 `vane-index`。`ensure-style-profile` 只在当前宇宙缺少 Style Profile 时，从本宇宙按起点截断的章节样本重建，不覆盖用户已有的人工风格资料。Create/Fork 默认自动启动该后台任务，创建接口可通过 `buildKnowledge:false` 显式关闭；任务与章节生成互斥。状态与各步骤日志摘要保存在 `.output/<world>/workbench/knowledge-build.json`。任务重启中断会被标记为失败，可重新触发。Vane 未安装或 embedding 服务不可用时会显示对应步骤失败；这不影响 SQLite/BM25 写作路径。

Chapter Studio 已提供显式构建入口和逐步骤状态面板，并每 2 秒轮询任务状态。构建不是创建宇宙时自动触发的：人物逐章状态分析会写入 novel.db，必须避免与章节写作并发。服务端会串行协调构建请求，并拒绝在章节运行中启动构建；构建期间也会拒绝启动章节生成、归档或分叉。归档宇宙不能启动构建。


历史宇宙不会复制原文项目的全书 world-bible.md。Create/Fork 会为每个宇宙生成自己的最小 world-bible.md，记录原文起点、父宇宙/分叉信息、正史边界和创作方向，并明确指向本地截断后的 universe-entry.md 与 universe-origin-context.md。这样既避免全书设定中的未来剧情泄漏，也满足章节生成流程对 world-bible.md 的运行要求。
