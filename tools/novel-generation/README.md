# Novel Generation

本地长篇小说创作工具，使用 CodeBuddy Agent SDK。当前提供单次生成和多阶段章节写作两种入口。

## 多阶段写作（推荐）

`write` 会依次执行章节规划、正文初稿、编辑审查、修订和故事状态更新。每个阶段的结果都会保存在独立运行目录，便于检查和恢复；章节状态写入对应世界目录的 `story-state.json`。

```bash
cd tools/novel-generation
npm install
npm run typecheck

npm run dev -- write --world conghuoniao \
  --brief "从当前故事位置展开一条新的调查线，逐步引出冲突" \
  --context ./private/continuity-summary.md \
  --max-words 3500
```

如果要基于你有权使用的文本续写，可额外传入 `--source ./private/authorized-excerpt.md`。私有原文和摘要不要提交到 Git。

每次运行生成：
- `01-plan.md`：章节计划和场景安排
- `02-draft.md`：初稿
- `03-review.md`：连续性、人物、因果和叙事质量审查
- `chapter.md`：修订后的章节
- `04-state-update.json`：更新后的故事状态

故事状态包括当前位置、事实来源、人物状态、事件、情节线和后续连续性约束。状态文件是模型提取的工作记录，不应自动视为原著正史；应定期人工校对。若状态更新失败，章节仍会保留，同时生成错误记录，必须先人工处理再继续下一章。

## 单次生成

原有 `generate` 命令仍然保留，适合快速试写：

```bash
npm run dev -- generate --world conghuoniao --mode derivative \
  --brief "一名替旧城戏院修钟的匠人，发现午夜后所有钟表都会慢十三分钟" \
  --max-words 3500 --out .output/chapter-001.md
```

续写模式：

```bash
npm run dev -- generate --mode continuation \
  --source ./private/authorized-excerpt.md \
  --context ./private/continuity-summary.md \
  --brief "从上一段结束后的第二天清晨继续" \
  --out .output/chapter-002.md
```

## 当前实现边界

- 使用 `@tencent-ai/agent-sdk` 的 `query()` 接口；模型由本机 CodeBuddy 配置决定，也可通过 `--model` 指定。
- 多阶段工作流按顺序调用模型，不代表有持久化 Agent session；中断后可查看已落盘阶段文件，但当前不会自动从中断步骤恢复。
- 故事状态采用 JSON 文件，适合单机原型；暂不支持并发写作、数据库事务或多人协作。
- 状态抽取由模型完成，需人工核验，尤其是人物别名、时间关系和未解决情节。
- 项目不保存未经授权的小说全文。仅使用用户合法提供且有权使用的材料。

## 目录

```
src/
  cli.ts
  generate.ts
  workflow.ts
  story-state.ts
worlds/
  conghuoniao/
    world-bible.md
    story-state.json  # 首次 write 时创建
.output/
  conghuoniao/
    <run-id>/
```
