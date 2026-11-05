# Novel Generation

本地长篇小说创作工具，使用 CodeBuddy Agent SDK。当前提供小说文本导入、原文检索、人物/事件/关系候选抽取、多 Agent 文本分析、多阶段章节写作，以及模型与执行链路自检。

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

结果保存在本地 `worlds/<world>/library/annotations.json`。重新导入发生变化的源文件时，对应旧标注会自动失效。当前还没有跨章节人物别名归并、共指消解和事件去重；抽取结果是候选证据，不等同于已确认正史。

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
npm run dev -- analyze-world --world conghuoniao --phase collect   # 校验并汇总
```

输入包由本地检索库按角色查询词生成，含卷结构、建议精读行号区间与证据规范；成稿要求带 `L####` 行号、区分四级证据、不复制原文。`collect` 只校验格式、字数与证据密度，输出 `manifest.json` 和 `index.md`，不判断观点对错。结果保存在 `analysis/<world>/agent-analysis/`，与主世界设定分开，属工作记录。

## 5. 多阶段章节写作

`write` 会结合当前故事位置、未解决情节线和人物名单，从本地资料库检索相关片段；如果已经运行 `analyze`，也会把命中片段对应的人物、事件和关系标注一并交给写作流程。随后由主线剧情 Agent 与创意发散 Agent 并行提出方案，主编 Agent 选定章节蓝图；场景小说家生成正文，人物对话 Agent 修整对白，叙事声音 Agent 统一全章表达，连续性 Agent 审查，主编 Agent 终审。各 Agent 通过独立阶段文件交接，不并发改写同一份正文。终审后另由状态管理员提出状态变更，默认只写入本次运行的 `08-state-update.json`，不覆盖 `story-state.json`。

```bash
npm run dev -- write --world conghuoniao --mode continuation \
  --brief "从上一章结尾继续，展开一条新的调查线" \
  --source ./private/authorized-excerpt.md \
  --context ./private/continuity-summary.md \
  --retrieval-limit 6 \
  --max-words 3500 \
  --apply-state
```

每次运行生成：
- `00-retrieval.md`：命中的原文片段、来源位置和抽取标注
- `01-main-plot.md`、`02-creative-options.md`：主线方案与创意备选
- `03-chapter-plan.md`：主编确定的章节蓝图
- `04-scene-draft.md`、`05-dialogue-edited.md`、`06-voice-edited.md`：正文、对白修订和叙事声音统一
- `07-continuity-review.md`：连续性审查
- `chapter.md`：终审后的章节
- `08-state-update.json`：状态变更提案（合并后的完整状态）

`--apply-state` 是显式开关：核对提案后才用它替换 `worlds/<world>/story-state.json`。不加这个开关，正史状态保持不变，`write` 可以反复试写而不污染已核实的事实与 `L####` 证据。`continuation` 模式的 `--source` 必须是你提供或有权使用的文本，本地 `private/` 不入库。

已跑通的续写成稿归档在 `worlds/conghuoniao/chapters/`，含正文、连续性审查和状态提案；该目录随代码提交，阶段文件仍留在 `.output/<world>/<run-id>/`。

### 万字章节：write-long

`write` 的单次正文调用适合两三千字以内的章节；一万字用 `write-long` 拆成多个场景逐场生成，避免单次输出截断：

```bash
npm run dev -- write-long --world conghuoniao --mode continuation \
  --brief "..." --source ./private/continuation-excerpt.md \
  --context ./private/continuity-summary.md \
  --max-words 10000 --scenes 8 --timeout-ms 180000
```

流程：一次生成 N 场蓝图（`01-scene-blueprint.md`）→ 逐场成文（`02-scene-XX.md`，字数不足自动补写一次，场间传入上一场结尾）→ 拼接初稿（`03-draft.md`）→ 分两批连续性审查（`04-continuity-review.md`）→ 逐场对白与文风修订（`05-polish-XX.md`）→ `chapter.md`、`06-rhythm-metrics.json` 与状态提案 `07-state-update.json`。`--apply-state` 才写回正史状态。各阶段产物全部落盘，可逐场复核或重跑。

文风复核见 `analysis/conghuoniao/style-rhythm.md`：原书抽样平均句长 22 字、长句 25.3%、超长句 4.7%，而成稿 `chapter-001.md` 平均 14.7 字、长句 8%、超长句 0%。量化约束已写进 `style-profile.md` 和成文、修订、审查三处提示；`06-rhythm-metrics.json` 用同一口径统计成稿，偏离就回到文风阶段。

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

`thinking` 与 `effort` 已按阶段分配，取舍与参考项目 `taskProfiles.ts` 一致：判断类任务多想，成文类任务快且不被推理痕迹带偏。规划与创意发散 `adaptive/medium`，主编蓝图与连续性审查 `adaptive/high`，正文、对白、文风、终审和状态提取 `disabled/low`。`novel-generation.config.json` 的 `taskProfiles` 可逐阶段覆盖（`thinkingMode` 取 disabled/adaptive/enabled，`effort` 取 low/medium/high，另可给 `thinkingBudgetTokens`）；`npm run dev -- models` 打印当前档案。三种思考模式与推理档位都在本机 CLI 实测可用，`enabled` 才使用预算。

**未引入会话池**。参考项目的 `WorkbuddySessionPool` 用 `unstable_v2_createSession` 复用 CLI 进程、按 scope 隔离、用满轮数重建，解决的是高频短文本翻译的冷启动开销；它自己也规定「需要显式思考深度或 effort 的任务改走 `query()`」。本项目一次 `write` 只有九次调用、各阶段角色不同、每轮 prompt 带全量世界设定与不同阶段产物。复用会话会让审校读到别的角色的历史、上下文随轮数膨胀，并把可复核的 `00`–`08` 阶段文件交接变成不可见的对话记忆。长章节改用**显式场景交接**：每场传入上一场原文结尾与已确认事实清单，全部落盘、可逐场重跑。将来若要摊薄冷启动，也只在同一角色的连续场景生成上做有界复用，不跨角色共享。

## 当前实现边界

- 使用 `@tencent-ai/agent-sdk` 的 `query()`。默认 `deepseek-v4.1-flash`、回退 `hy4free`；目录来自 `ACC_PRODUCT_CONFIG_PATH` 或 `~/.codebuddy/local_storage/*.info`（前者解析不出模型时仍会扫缓存），再叠加 user/project `models.json`。`--model`、环境变量与配置文件可覆盖，详见第 7 节。逐条消息竞速超时并主动中断，超时、无文本或执行失败时换链中下一个模型。
- 被 IDE/Agent 托管时（存在 `CODEBUDDY_SESSION_ID` / `WORKBUDDY_CONFIG_DIR`），SDK fork 的 CLI 会继承宿主服务端口并撞上主进程。`buildQueryOptions` 会清掉子进程的宿主会话变量，并加 `--port 0` 让 CLI 自选端口；托管会话内可直接运行 `analyze` / `write` / `generate`。`analyze` 可用 `--timeout-ms` 控制单片段上限。
- `analyze-world` 走文件交接，不调用模型；输入包与成稿随代码提交，便于复核每个结论的依据。
- 本地检索是词项/BM25 风格排序，不是向量语义检索。
- 文本抽取按片段进行，已有证据校验和断点续跑；尚未实现跨章节实体归并、共指消解、人物状态时间序列和伏笔生命周期分析。全量 `analyze` 涉及 2,594 次模型调用，尚未执行，`annotations.json` 为空。
- `analysis/build-corpus-index.mjs` 只做确定性结构解析，不调用模型；卷边界由章号重置判定，作者单章与卷末总结单独记录，不做语义归并。
- 导入器支持 TXT/Markdown；EPUB、PDF、OCR 和网页采集不在当前范围。
- 多 Agent 通过独立模型调用协作；主线规划与创意发散并行，其余阶段按依赖顺序执行。当前没有持久化 Agent session，中断后不会自动从写作步骤恢复。
- 状态提取仍从模型返回的文本里解析 JSON；参考项目用的 `outputFormat: json_schema` 与 StructuredOutput 工具在 `deepseek-v4.1-flash` 上尚未验证支持，暂不启用。
- 故事状态采用 JSON 文件，适合单机原型；暂不支持并发写作或多人协作。
- 私有原文 `original.txt` 与 `private/` 留在本地，不提交到 Git。导入索引、抽取标注与故事状态随代码提交；`library/index.json` 保存全文切片，公开仓库需自行确认授权。

## 目录

```
src/
  cli.ts
  generate.ts
  workflow.ts
  story-state.ts
  library.ts
  analysis.ts
  agent-runtime.ts
  world-analysis.ts
  runtime-check.ts
  task-profiles.ts
  long-chapter.ts
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
sources/
  public-chapter-sources.md
  local-corpus-analysis.md
test/
  library.test.ts
  world-analysis.test.ts
  agent-runtime.test.ts
  agent-stream.test.ts
  task-profiles.test.ts
  long-chapter.test.ts
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
| 叙事声音编辑 | 统一视角、节奏、句式和描写比例 | 修订叙述表达 |
| 连续性审查 Agent | 检查人物、设定、时间线、因果和伏笔 | 只提交问题清单 |
| 状态管理员 | 从最终稿提取人物、事件和情节线变化 | 更新结构化状态 |

可在 `worlds/<world>/style-profile.md` 中维护抽象叙事约束，例如视角、叙述距离、句长变化、对白密度、动作/环境描写比例和悬念节奏。不要把某位作者的原文或标志性句式作为风格模板。该文件可不创建；缺省时使用通用叙事约束。
