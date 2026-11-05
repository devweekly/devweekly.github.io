# Novel Generation

本地长篇小说创作工具，使用 CodeBuddy Agent SDK。当前提供文本导入、关键词检索、章节多阶段写作和故事状态维护。

## 1. 导入小说资料

只导入你合法取得且有权使用的 TXT 或 Markdown 文本。导入内容和索引保存在本地 `worlds/<world>/library/`，已加入 Git 忽略规则，不会随代码提交。

```bash
cd tools/novel-generation
npm install
npm run typecheck

npm run dev -- ingest --world conghuoniao --input ./private/novel.txt
# 也可以一次传入多个文件或目录
npm run dev -- ingest --world conghuoniao --input ./private/volume-1.txt ./private/volume-2.txt
```

导入器按常见中文章节标题切分章节，再切成带重叠区间的文本片段。未识别出多个章节标题时，会把整个文件作为一个章节处理。重复导入同一文件会按片段 ID 覆盖，不会无限追加副本。

## 2. 检索原文

```bash
npm run dev -- search --world conghuoniao --query "人物名字 某次战斗 能力限制" --limit 8
```

当前检索使用本地词项和中文字符二元组的 BM25 风格排序，不依赖向量数据库或外部服务。它适合快速定位证据，不等同于语义检索；别名、隐喻和跨段落指代仍可能漏检。

## 3. 多阶段章节写作

`write` 会自动从本地资料库检索与故事构想、前文摘要和续写材料相关的片段，再依次执行章节规划、初稿、编辑审查、修订和故事状态更新。

```bash
npm run dev -- write --world conghuoniao --mode continuation \
  --brief "从上一章结尾继续，展开一条新的调查线" \
  --source ./private/authorized-excerpt.md \
  --context ./private/continuity-summary.md \
  --retrieval-limit 6 \
  --max-words 3500
```

每次运行生成：
- `00-retrieval.md`：本次检索命中的原文证据及来源位置
- `01-plan.md`：章节目标和场景计划
- `02-draft.md`：初稿
- `03-review.md`：连续性、人物、因果和叙事质量审查
- `chapter.md`：修订后的章节
- `04-state-update.json`：更新后的故事状态

故事状态包括当前位置、事实来源、人物状态、事件、情节线和后续连续性约束。模型提取的状态是工作记录，不自动等于原著正史；应定期人工核验。

## 4. 单次生成

```bash
npm run dev -- generate --world conghuoniao --mode derivative \
  --brief "一名替旧城戏院修钟的匠人，发现午夜后所有钟表都会慢十三分钟" \
  --max-words 3500 --out .output/chapter-001.md
```

## 当前实现边界

- 使用 `@tencent-ai/agent-sdk` 的 `query()` 接口；模型由本机 CodeBuddy 配置决定，也可通过 `--model` 指定。
- 当前本地检索是词项/BM25 风格排序，不是向量检索，也没有完成实体别名解析、共指消解和事件关系抽取。
- 导入器支持 TXT/Markdown；EPUB、PDF、OCR 和网页采集不在当前范围。
- 多阶段工作流按顺序调用模型，不代表有持久化 Agent session；中断后不会自动从中断步骤恢复。
- 故事状态采用 JSON 文件，适合单机原型；暂不支持并发写作或多人协作。
- 私有原文、导入索引和生成状态均留在本地。不要将未经授权的小说全文提交到 Git。

## 目录

```
src/
  cli.ts
  generate.ts
  workflow.ts
  story-state.ts
  library.ts
worlds/
  conghuoniao/
    world-bible.md
    story-state.json       # 首次 write 时创建，本地忽略
    library/
      index.json           # ingest 创建，本地忽略
.output/
  conghuoniao/
    <run-id>/
```
