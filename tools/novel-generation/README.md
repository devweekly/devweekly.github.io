# Novel Generation

使用 CodeBuddy Agent SDK 的本地小说创作工具。首个世界参考为《从姑获鸟开始》，当前实现以原创衍生章节为默认路径。

## 当前范围

- 通过 @tencent-ai/agent-sdk 的 query() 接口生成内容。
- 按世界维护独立的 world-bible.md。
- 两种模式：原创衍生；基于用户提供且有权使用的文本续写。
- 可传入前文或摘要文件，避免每次把整本书放入 Prompt。
- 输出 Markdown 章节，默认保存在 .output/，不进入 Git。

不复刻作者的具体文风，也不复制原著段落。默认采用原创人物和新事件，在高层世界规则范围内展开故事。原著角色和关键情节只在确有必要且事实已核实的情况下引用。

## 环境

要求 Node.js >= 22.13；已安装并登录 CodeBuddy CLI，或按 CodeBuddy SDK 文档配置 API Key。

```bash
cd tools/novel-generation
npm install
npm run typecheck
```

## 生成原创衍生章节

```bash
npm run dev -- generate --world conghuoniao --mode derivative \
  --brief "一名替旧城戏院修钟的匠人，发现午夜后所有钟表都会慢十三分钟" \
  --max-words 3500 --out .output/chapter-001.md
```

## 基于用户材料续写

仅将你有权使用的原文片段或自己的草稿作为续写依据：

```bash
npm run dev -- generate --mode continuation \
  --source ./private/authorized-excerpt.md \
  --context ./private/continuity-summary.md \
  --brief "从上一段结束后的第二天清晨继续" \
  --out .output/chapter-002.md
```

私有材料不要提交到仓库。建议使用章节摘要、人物状态和未解决伏笔，而不是反复输入大量原文。

## 目录结构

```
tools/novel-generation/
  src/
    cli.ts
    generate.ts
  worlds/
    conghuoniao/
      world-bible.md
  .output/
```

## 后续迭代

1. 为世界设定建立可追溯的事实记录，区分原著事实、用户材料、推断和原创设定。
2. 增加人物档案、关系图谱、时间线、地点和能力规则。
3. 将长篇上下文拆成章节摘要、人物状态、事件状态和伏笔状态，按章节检索。
4. 加入章节计划、初稿、连续性审查和修订流程，每阶段保存中间结果。
5. 持久化 CodeBuddy session、生成任务状态和模型用量，支持中断恢复与多轮编辑。

当前版本是可运行的最小 CLI 原型，不是完整的长篇小说管理平台。模型名称由本机 CodeBuddy 配置决定，也可通过 --model 显式指定。

CodeBuddy 文档：https://www.codebuddy.ai/docs/cli/sdk
