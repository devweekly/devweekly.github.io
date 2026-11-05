# Novel Generation

本地长篇小说创作工具，使用 CodeBuddy Agent SDK。当前提供小说文本导入、原文检索、人物/事件/关系候选抽取、多 Agent 文本分析、多阶段章节写作，以及模型与执行链路自检。

续写架构、流程图与实现差距审计见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。续写默认全自动：章节完成后自动提取并提交故事状态；只有模型对照实验等隔离场景才使用 `--no-apply-state`。

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
npm run dev -- analyze-world --world conghuoniao --phase collect   # 校验并汇总
```

输入包由本地检索库按角色查询词生成，含卷结构、建议精读行号区间与证据规范；成稿要求带 `L####` 行号、区分四级证据、不复制原文。`collect` 只校验格式、字数与证据密度，输出 `manifest.json` 和 `index.md`，不判断观点对错。结果保存在 `analysis/<world>/agent-analysis/`，与主世界设定分开，属工作记录。

## 5. 多阶段章节写作

`write` 会结合当前故事位置、未解决情节线和人物名单，从本地资料库检索相关片段；如果已经运行 `analyze`，也会把命中片段对应的人物、事件和关系标注一并交给写作流程。随后由主线剧情 Agent 与创意发散 Agent 并行提出方案，主编 Agent 选定章节蓝图；场景小说家生成正文，人物对话 Agent 修整对白，叙事声音 Agent 统一全章表达，最终审查 Agent 对正文执行结构化连续性与剧情检查，主编按证据修复 blocker/major，最多两轮，每轮修复后重新审查；minor 和主观风格偏好只记录，不触发重写。各 Agent 通过独立阶段文件交接，不并发改写同一份正文。只有最终复查通过，状态管理员才提取并校验故事状态，默认自动写入 SQLite 和兼容快照 `story-state.json`。

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

每次运行生成：
- `00-retrieval.md`：命中的原文片段、来源位置和抽取标注
- `01-main-plot.md`、`02-creative-options.md`：主线方案与创意备选
- `03-chapter-plan.md`：主编确定的章节蓝图
- `04-scene-draft.md`、`05-dialogue-edited.md`、`06-voice-edited.md`：正文、对白修订和叙事声音统一
- `07-continuity-review.md`：连续性审查
- `chapter.md`：最终复查通过后的章节
- `08-state-update.json`：合并后的下一章状态（默认已自动持久化）
- `07-review-round-*.json`、`09-quality-summary.json`：结构化复查结果和自动修复轮数

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

流程：生成 N 场蓝图（格式错误自动修正一次）→ 按场检索 → 逐场成文与必要补写 → 分批审查 → 逐场对白/文风修订 → 全章跨场终审 → 对 blocker/major 定位到受影响场景并最多自动修复两轮，每轮重新复查 → 最终章节与节奏指标 → 从最终完整正文提取并校验状态 → SQLite 和 JSON 自动持久化。最终复查未通过或状态提取/保存失败时命令失败，不会提交未通过章节的故事状态。仅隔离实验使用 `--no-apply-state`。

文风复核见 `analysis/conghuoniao/style-rhythm.md`：原书抽样平均句长 22 字、长句 25.3%、超长句 4.7%，而成稿 `chapter-001.md` 平均 14.7 字、长句 8%、超长句 0%。量化观察项会随成文与修订提示提供参考；`06-rhythm-metrics.json` 用同一口径统计成稿，偏离用于定位节奏问题，不会单独触发机械回滚或强制改写。

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

`thinking` 与 `effort` 按阶段分配，取舍同参考项目 `taskProfiles.ts`：判断类任务多想，纯抽取与终审不被推理痕迹带偏。规划、创意发散、正文成文 `adaptive/medium`，主编蓝图与连续性审查 `adaptive/high`，对白、文风、终审与状态提取 `disabled/low`。`novel-generation.config.json` 的 `taskProfiles` 可逐阶段覆盖（`thinkingMode` 取 disabled/adaptive/enabled，`effort` 取 low/medium/high，另可给 `thinkingBudgetTokens`），`npm run dev -- models` 打印当前档案。

三个实现细节会直接影响效果：

- `adaptive` 与 `enabled` 都映射为 `--settings alwaysThinkingEnabled=true`，`enabled` 另设 `MAX_THINKING_TOKENS`；`disabled` 映射为 `alwaysThinkingEnabled=false`。
- `--effort` 只在思考开启时下发。SDK 在 `thinking.type === "disabled"` 时跳过这个参数，所以「disabled/low」里的 low 并没有生效，写 low 只是保持档案完整。
- 开启思考后，CLI 的默认 Agent 人格会先探查工作区、调用工具；工具被禁用时，部分模型把工具调用语法（`DSML`）当成正文吐出来，整章作废。现在所有纯文本调用都注入专用 system prompt，调用层检测到这类输出会关掉思考重试同一模型。

回归实验（卷 1 第十三章，原文 2730 字）：关闭思考那版盲写后平均句长 16.9、强调标点 1.6/千字，偏差 20%，句法修订后反而升到 40%；`adaptive/high` 那版修订后偏差 12%，句长中位数、p90 与超长句占比基本命中原文。推理强度影响的是修订执行精度，不能替代「段落即一拍、标点承担语气」这类具体约束。

## 8. 回归对照

```bash
npm run dev -- regress --world conghuoniao --chapter 13 \
  --model deepseek-v4.1-flash --review-model glm-5.3-flash \
  --brief "本章任务：用白描写清这一章发生了什么，不给原文句子"
```

取原文中的一章做盲写：只把前 `--context-lines` 行（默认 90）、本章任务和风格文档交给写作 Agent，不给原文任何一句。同一提示跑两版推理配置：A 用配置文件里的 `scene` 档案，B 固定 `adaptive/high`。两版各自统计句长、段落、对白、标点密度，指标不达标时做一次句法修订，修订后偏差没有下降就退回原稿。最后由另一个模型的评审 Agent 对照原文判断哪版更近、差在句式还是段落组织。

`.output/regression/<run-id>/` 存原文、两版原稿与修订稿、评审全文；`analysis/<world>/regression/chapter-XXX/` 存 `metrics.json`、`review.md` 与实验说明，随代码提交。`--no-repair` 跳过修订，`--max-words` 控制篇幅（默认与原章同长）。已有实验见 `analysis/conghuoniao/regression/chapter-013/`。

## 当前实现边界

- 使用 `@tencent-ai/agent-sdk` 的 `query()`。默认 `deepseek-v4.1-flash`、回退 `hy4free`；目录来自 `ACC_PRODUCT_CONFIG_PATH` 或 `~/.codebuddy/local_storage/*.info`（前者解析不出模型时仍会扫缓存），再叠加 user/project `models.json`。`--model`、环境变量与配置文件可覆盖，详见第 7 节。逐条消息竞速超时并主动中断，超时、无文本或执行失败时换链中下一个模型。
- 被 IDE/Agent 托管时（存在 `CODEBUDDY_SESSION_ID` / `WORKBUDDY_CONFIG_DIR`），SDK fork 的 CLI 会继承宿主服务端口并撞上主进程。`buildQueryOptions` 会清掉子进程的宿主会话变量，并加 `--port 0` 让 CLI 自选端口；托管会话内可直接运行 `analyze` / `write` / `generate`。`analyze` 可用 `--timeout-ms` 控制单片段上限。
- `analyze-world` 走文件交接，不调用模型；输入包与成稿随代码提交，便于复核每个结论的依据。
- 本地检索是词项/BM25 风格排序，不是向量语义检索。倒排统计与片段词频在进程内按索引文件版本缓存；索引更新后自动失效。Zod 是直接运行时依赖，用于校验故事状态、章节索引和模型证据审查输出。
- 回归对照只做写法比较：情节不同是预期的，评审 Agent 不据此扣分。指标由确定性函数统计，评审结论属于模型判断，两者分开记录。
- 文本抽取按片段进行，带独立证据审查、来源哈希/章节偏移、显式别名注册表和有证据门槛的共指解析；人物状态时间序列和伏笔生命周期分析仍未实现。全量 `analyze` 涉及 2,594 次模型调用，尚未执行，`annotations.json` 为空。
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
4. 先看 blocker/major 硬伤，再看加权分。分差小于 3 分不宣布可靠胜者。
5. 需要判断稳定性时设 \`--repetitions 2\` 或 \`3\`；单次胜出不等于稳定胜出。
6. 评审完成后再打开私有映射文件，将候选映射回模型，记录结果和下一轮改进。

### 实验控制边界
- 固定 brief、source、context、world-bible、story-state、style-profile、style-rhythm、task-profiles、篇幅和检索设置。
- \`--strict-model\` 禁止自动 fallback；脚本顺序执行，避免并发负载差异。
- 评审不提供模型名、耗时、credits 或生成日志，避免身份和速度偏见。
- 原章节用于理解上下文和核实事实，不是续写的标准答案。评价重点是新章节是否成立、人物是否可信、故事是否推进，不是模仿原文句子。
- 不把一次评审意见直接固化成永久规则；先确认问题在重复测试中出现，再决定改 prompt 或 workflow。


## SQLite 世界数据库

每个世界使用独立的 `worlds/<world>/novel.db`，使用 Node 22.13+ 内置 `node:sqlite`，不引入原生 npm 扩展。数据库启用 WAL、外键、事务和 schema version，保存章节片段、抽取标注、实体/实体提及，以及人物、正史事实、事件、情节线和连续性备注。章节检索从 SQLite 读取片段，再沿用现有 BM25 排序；续写上下文按命中的 chunk ID 从 SQLite 读取标注。

首次访问会自动把已有 `library/index.json`、`annotations.json` 和 `story-state.json` 导入数据库。此后故事状态以 SQLite 为权威存储，`story-state.json` 保留为可读兼容快照；库索引和标注 JSON 继续作为可重建/交换快照。重新导入源文件会在事务中替换 SQLite 片段索引并清理对应过期标注。数据库不存原始小说全文文件，只存索引片段及结构化信息。

查看数据库状态（会先尝试迁移已有 JSON 快照）：

```bash
npm run dev -- db-status --world conghuoniao
```

SQLite 文件及 WAL/SHM sidecar 已加入本地忽略规则。需要迁移或重建时先保留 JSON 快照，再删除数据库；下一次运行会从快照重新导入。

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
| 叙事声音编辑 | 统一视角、节奏、句式和描写比例 | 修订叙述表达 |
| 连续性审查 Agent | 检查人物、设定、时间线、因果和伏笔 | 只提交问题清单 |
| 状态管理员 | 从最终稿提取人物、事件和情节线变化 | 更新结构化状态 |
| 评审 Agent（回归用） | 对照原文与盲写成稿，判断节奏、段落与信息承载的差距 | 只出报告，不改稿 |

评审 Agent 用独立模型（默认 `glm-5.3-flash`），与写作 Agent 分开配置：写的人不评自己的稿。评审拿到的是原文、两版成稿和一份确定性指标表，指标由代码算，判断由评审给，两者不混在同一份结论里。

可在 `worlds/<world>/style-profile.md` 中维护抽象叙事约束，例如视角、叙述距离、句长变化、对白密度、动作/环境描写比例和悬念节奏。不要把某位作者的原文或标志性句式作为风格模板。该文件可不创建；缺省时使用通用叙事约束。

## 原创阎浮果实世界提案

为续写设计新果实世界时，先阅读 [`original-fruit-world-concepts.md`](./original-fruit-world-concepts.md)。该文档包含六个项目原创候选世界，以及历史背景、经济结构、风俗民俗、日常生活、异常规律、事件入口和人物冲突。所有内容均与原著正史分开；正式使用前需对照 `world-bible.md`、`yanfu-system.md` 和 `fruit-worlds.md`，不得把工作设定误写成原著规则。
