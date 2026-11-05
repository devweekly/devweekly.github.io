# Novel Generation

本地长篇小说创作工具，使用 CodeBuddy Agent SDK。当前提供小说文本导入、原文检索、人物/事件/关系候选抽取，以及多阶段章节写作。

## 1. 导入小说资料

只导入你合法取得且有权使用的 TXT 或 Markdown 文本。导入内容和索引保存在本地 `worlds/<world>/library/`，已加入 Git 忽略规则，不会随代码提交。

```bash
cd tools/novel-generation
npm install
npm run typecheck
npm test

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
npm run dev -- analyze --world conghuoniao --limit 20 --model <model-name>
```

结果保存在本地 `worlds/<world>/library/annotations.json`。重新导入发生变化的源文件时，对应旧标注会自动失效。当前还没有跨章节人物别名归并、共指消解和事件去重；抽取结果是候选证据，不等同于已确认正史。

## 4. 多阶段章节写作

`write` 会结合当前故事位置、未解决情节线和人物名单，从本地资料库检索相关片段；如果已经运行 `analyze`，也会把命中片段对应的人物、事件和关系标注一并交给写作流程。随后由主线剧情 Agent 与创意发散 Agent 并行提出方案，主编 Agent 选定章节蓝图；场景小说家生成正文，人物对话 Agent 修整对白，叙事声音 Agent 统一全章表达，连续性 Agent 审查，主编 Agent 终审并更新故事状态。各 Agent 通过独立阶段文件交接，不并发改写同一份正文。

```bash
npm run dev -- write --world conghuoniao --mode continuation \
  --brief "从上一章结尾继续，展开一条新的调查线" \
  --source ./private/authorized-excerpt.md \
  --context ./private/continuity-summary.md \
  --retrieval-limit 6 \
  --max-words 3500
```

每次运行生成：
- `00-retrieval.md`：命中的原文片段、来源位置和抽取标注
- `01-plan.md`：章节目标和场景计划
- `02-draft.md`：初稿
- `03-review.md`：连续性、人物、因果和叙事质量审查
- `chapter.md`：修订后的章节
- `04-state-update.json`：更新后的故事状态

故事状态包括当前位置、事实来源、人物状态、事件、情节线和后续连续性约束。模型提取的状态是工作记录，不自动等于原著正史；应定期人工核验。

## 5. 单次生成

```bash
npm run dev -- generate --world conghuoniao --mode derivative \
  --brief "一名替旧城戏院修钟的匠人，发现午夜后所有钟表都会慢十三分钟" \
  --max-words 3500 --out .output/chapter-001.md
```

## 当前实现边界

- 使用 `@tencent-ai/agent-sdk` 的 `query()` 接口；模型由本机 CodeBuddy 配置决定，也可通过 `--model` 指定。
- 本地检索是词项/BM25 风格排序，不是向量语义检索。
- 文本抽取按片段进行，已有证据校验和断点续跑；尚未实现跨章节实体归并、共指消解、人物状态时间序列和伏笔生命周期分析。
- 导入器支持 TXT/Markdown；EPUB、PDF、OCR 和网页采集不在当前范围。
- 多阶段工作流按顺序调用模型，不代表有持久化 Agent session；中断后不会自动从写作步骤恢复。
- 故事状态采用 JSON 文件，适合单机原型；暂不支持并发写作或多人协作。
- 私有原文、导入索引、抽取标注和生成状态均留在本地。不要将未经授权的小说全文提交到 Git。

## 目录

```
src/
  cli.ts
  generate.ts
  workflow.ts
  story-state.ts
  library.ts
  analysis.ts
test/
  library.test.ts
worlds/
  conghuoniao/
    world-bible.md
    story-state.json
    library/
      index.json
      annotations.json
.output/
  conghuoniao/
    <run-id>/
```
\n\n## 多 Agent 写作职责\n\n| Agent | 职责 | 修改范围 |\n|---|---|---|\n| 主线剧情架构师 | 推进主线、控制因果和长期情节 | 输出剧情方案 |\n| 创意发散 Agent | 提供冲突、转折和备选方向 | 输出候选点子，不写入正史 |\n| 主编 Agent | 取舍创意、确定章节蓝图、终审 | 决定最终正文 |\n| 场景小说家 | 把蓝图写成完整场景 | 生成初稿 |\n| 人物对话编辑 | 校准角色语气、潜台词和知识边界 | 修订对白 |\n| 叙事声音编辑 | 统一视角、节奏、句式和描写比例 | 修订叙述表达 |\n| 连续性审查 Agent | 检查人物、设定、时间线、因果和伏笔 | 只提交问题清单 |\n| 状态管理员 | 从最终稿提取人物、事件和情节线变化 | 更新结构化状态 |\n\n可在 `worlds/<world>/style-profile.md` 中维护抽象叙事约束，例如视角、叙述距离、句长变化、对白密度、动作/环境描写比例和悬念节奏。不要把某位作者的原文或标志性句式作为风格模板。该文件可不创建；缺省时使用通用叙事约束。\n