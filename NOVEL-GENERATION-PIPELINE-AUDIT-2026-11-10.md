# 小说生成流水线问题审计

核查日期 2026-11-10，基线提交 `fdc8e424`（`Fix Workbench pipeline cancellation and recovery`）。范围限定 `tools/novel-generation/` 的章节生成主链路：`src/cli.ts` 的 `write` / `write-long` 入口、`src/server.ts` 的 Workbench 路由与知识构建状态机、`src/workflow.ts` 与 `src/long-chapter.ts` 两条流水线、`src/chapter-review.ts` 终审、以及 README、ARCHITECTURE、AGENTS、ADR 和 `docs/` 下的声明。

审计方法是逐文件对照实现与文档，并用本地只读命令核对可复现的事实：类型检查与构建、单并发全量测试、真实 `.output` 运行产物的哈希、`worlds/conghuoniao/` 下 SQLite 表行数。基线结果是 `npm run build` 通过、`node --import tsx --test --test-concurrency=1 test/*.test.ts` 为 300/300 通过、工作区无未合并冲突。测试全绿只说明现有断言没有覆盖以下问题，下文每条都给出可复查的文件行号或实测输出。

| 级别 | 问题 | 主要位置 |
| --- | --- | --- |
| 数据污染 | 失败运行仍改写 Story Arc；两条流水线处理不一致 | `workflow.ts:268`、`long-chapter.ts` |
| 静默失败 | 分析批次失败不设退出码；构建无超时；重试状态误判 | `cli.ts:899`、`server.ts:223`、`server.ts:344` |
| 文档相反 | 知识准备前置条件、已删除阶段、终审证据规则、图表规则 | `server.ts:2331`、`README.md:106`、`chapter-review.ts:1` |
| 路径分叉 | `write-long` 绕过等待与共享解析器，状态路径写死 | `cli.ts:938`、`cli.ts:1022` |
| 可维护性 | 常量未接入、字面 `\n`、空转产物 | `cli.ts:188`、`workflow.ts:261` |

## 一、失败运行会留下已改写的世界状态

`src/workflow.ts:268` 在生成 Story Arc 之后立刻把结果写进 `worlds/<id>/story-arc.md`。此时终审尚未开始（`workflow.ts:334` 才调用 `reviewAndRepair`），故事状态也远未提交（`workflow.ts:501`）。终审阻断时 `onFailure` 只落盘 `chapter-blocked.md` 与 `09-quality-summary.json`（`workflow.ts:361-367`），状态提取失败时抛错（`workflow.ts:493-495`），代码给出的承诺是「本次运行安全失败，故事状态未更新」，README 第 100 行也这样写。但磁盘上的 `story-arc.md` 已经被这一章的推演改写，下一章读取 `--story-arc-file` 时会拿到一份基于未通过章节的中期规划，而 `state.currentPosition` 仍是旧值。规划和状态因此错开，且没有任何产物记录这次错开。

这还直接违背项目自己的决策。`ADR/0004-rolling-multi-chapter-story-arc.md` 的「运行闭环」第 7 步写明「终审通过后自动提取并提交 Story State、人物变化、事件、伏笔/MacGuffin 状态和 Story Arc 进度」；把 Story Arc 的提交放在终审之前，与这一步的顺序要求相反。

同一处写入也不受 `applyState` 约束。README 第 16 行与第 114 行把 `--no-apply-state` 限定为模型对照、盲测等「需要候选互相隔离」的场景，实际上它只跳过 `workflow.ts:501` 的状态提交，仍会改写世界目录里的 Story Arc。隔离实验因此会污染下一轮实验的输入。

`write-long` 是另一个极端：`src/long-chapter.ts` 全文没有 `storyArc` 或 `story-arc.md` 的读写，`src/cli.ts:1024` 也只拼接 story plan 与 story unit。同一份 ADR 把 Story Arc 列为三层规划里的中间层，并要求在闭环里维护进度，但长章节路径既不读也不写它。选择 `write` 还是 `write-long` 会改变世界状态里是否留下中期规划，这个差异在 ADR 和 README 里都没有交代。

修复方向是把 Story Arc 的持久化移到状态提交之后，与 `saveStoryState` 一起纳入同一个成功出口；`write-long` 需要明确选择接入滚动规划，或从 ADR 与 README 中撤回对它的全局声明。

## 二、会让流程静默通过或永久挂住的三处判定

`src/cli.ts:899-917` 的 `analyze-story` 把 `result.failed`、`result.pending`、`result.skipped` 打印进 JSON 后直接 `return`，没有设置 `process.exitCode`。服务端 `src/server.ts:339` 用 `classifyKnowledgeBuildStepResult` 判定步骤结果，该函数只看退出码和 stdout 里的 `skipped` 标记。批次失败而进程正常退出时，`story-analysis` 会被记为 `completed`，知识构建可以继续往下跑，最终状态甚至可能是 `completed`。本地实测 `worlds/conghuoniao/novel.db` 的 `story_analysis`、`novel_beats`、`novel_characters` 都是 0 行，`novel_chapters` 为 753 行；`src/story-analysis-context.ts:99` 要求 `analysisVersion >= 6` 且 `complete === true` 才注入分析参考。当前数据下写作的分析参考为空，而状态机有能力把这个情况显示成准备完成，这与 ADR 0007 第 59 行「不得把空上下文视为准备成功」冲突。能确认的是退出码契约缺失和本地表为空；两者叠加导致误报属于推断，需要一次真实失败批次来复现。

`src/server.ts:223-253` 的 `runKnowledgeBuildStep` 给用户取消准备了 `AbortController`，取消时按进程组发 `SIGTERM`，5 秒后 `SIGKILL`。但没有任何自动超时：模型调用或 CLI 卡住时子进程不会自己结束，`knowledgeBuilds` 这个内存 Set 会一直占着，归档和分叉的 409 检查（`server.ts:964`、`server.ts:1146`）会持续生效。与之相对，`src/cli.ts:188` 给写作侧设了 `30 * 60 * 1000` 的硬上限，每 1000ms 轮询一次知识构建状态文件，超时即抛错（`cli.ts:211`）。两侧的时长不对等：写作子进程等 30 分钟后失败退出，构建可能仍在运行，用户看到的是一次无明确原因的写作失败。合适的处理是给构建步骤加「若干分钟无 stdout 就终止进程组」的心跳超时，不要用固定总时长：全量分析的批次数随语料规模变化，固定阈值会误杀合法长任务。

`src/server.ts:281-283` 在重试时把上次 `completed/skipped` 的步骤记录留在 `state.steps` 里，循环里用 `reusableSteps` 跳过它们（`server.ts:306`）。失败计数 `failed` 只累加本次真正执行的步骤（`server.ts:340`），但最终判定写的是 `failed === state.steps.length`（`server.ts:344`），分母包含复用的旧记录。假设上次有 5 步成功、本次 3 步全失败，`failed = 3` 而 `state.steps.length = 8`，结果被判为 `partial` 而不是 `failed`。前端把 `partial` 显示为「部分完成」，与全部重试失败的实际情况不符。分母应取本次执行步骤数。

## 三、文档与实现给出相反指令

`src/server.ts:2331-2332` 保留着「They can run concurrently, so analysis completion is never a writing prerequisite」的注释，而 `src/cli.ts:938` 对 `write` 命令强制 `await waitForWritingKnowledgeReadiness(worldId)`，四个准备步骤未就绪就抛错（`cli.ts:203-207`）。ADR 0007 第 14 行把这个竞态列为背景，第 53 行的决策是「CLI 写作进程必须等待以下最低上下文准备完成」，第 59 行还要求「不得把空上下文视为准备成功」。服务端注释属于决策变更前的遗留文字，却被留在唯一描述该端点的位置，读代码的人会得出相反结论。

`src/server.ts:2427` 的 `ensureWritingKnowledgeBuildStarted` 在每次 `chapters/generate` 时补启动未就绪的构建，对应 ADR 0007 第 59 行「服务器启动或恢复知识构建任务后，立即返回任务状态」。界面文案与这个行为脱节：创建弹窗的勾选说明写「取消勾选可稍后手动启动」，实际取消后首次写作会由服务端自动补启动，CLI 随即进入最长 30 分钟的等待。用户按文案理解为「先创建、以后自己点构建」，得到的是「首次写作被自动构建阻塞」。README 没有解释这个推迟行为。

README 第 106-107 行把 `05-dialogue-edited.md`、`06-voice-edited.md` 描述为「对白修订和叙事声音统一」，并把 `06b-anti-ai-edited.md` 列为文学编辑后的正文。`src/workflow.ts:328-331` 实际把同一个 `literaryDraft` 写进三个不同名字的文件，随后 `antiAiDraft = literaryDraft` 只是变量别名；`06b-anti-ai-edited.md` 在 `write` 路径根本不产生。实测两个真实运行目录可以确认这一空转：

```
.output/u-f3ecced6e84e42b0/chapter-6a9b1c4f-.../  三份文件 MD5 均为 3d53adcb7ea21022e718c60de8871881
.output/conghuoniao/chapter-c24b5f62-.../          三份文件 MD5 均为 53b7f55d4c1ab94588cae8f9bba282a4
```

`src/long-chapter.ts:331` 虽然写了 `06b-anti-ai-edited.md`，内容也只是 `applyLiteraryPatches` 的结果，文件名与 ADR 0007 已废除的「整章 Anti-AI 编辑」阶段同名。ARCHITECTURE 第 115-121 行同样停留在旧流水线：写「执行共享的 Living Voice / Anti-AI 诊断」「最多两轮局部修复」「发生修复时追加只读文风回归观察」，而 `workflow.ts:336` 传入 `maxRepairRounds: 1`，`workflow.ts:380-382` 无条件写 `11-style-regression-skipped.json`，从不追加观察。ADR 0007 状态为 Accepted 并声明取代这些默认决策，文档却没有跟着变：ARCHITECTURE.md 的最后修改时间是 11-09 08:41，早于该 ADR；README.md 与 ADR 0007 同为 11-10 07:11，仍保留旧产物清单。

`src/chapter-review.ts:1-3` 的文件头写着「证据不能逐字定位或结构与严重程度冲突时自动重试一次，仍无效则失败关闭」，同一文件第 51-53 行和第 68-70 行实现的规则是「证据只用于定位，不要求逐字命中；定位不到时加注，不判整份审查无效」。两条说明方向相反，文件头是旧版失败关闭策略的残留。

项目规则层面还有两处不一致。`docs/PIPELINE-STATE-MANAGEMENT.md` 含一段 `mermaid stateDiagram-v2` 代码块，而根 `AGENTS.md` 明确禁止使用 Mermaid 生成、渲染、导入或交付任何 diagram，要求经 diagram-design skill 产出独立 SVG 与同名 HTML。ADR 目录里 `0004-corpus-craft-and-vane-retrieval.md`、`0004-living-voice-and-anti-ai-editing.md`、`0004-rolling-multi-chapter-story-arc.md` 三个文件共用 0004 编号，ADR 0007 写「取代 ADR 0004 中关于常规章节每章执行 Anti-AI 诊断……」时无法确定指向哪一份。

## 四、两条写入路径的隐性分叉

`src/cli.ts:938` 的判断只在 `command === "write"` 时调用知识等待，`write-long` 完全没有这道检查。新建宇宙后直接跑长章节，会在知识资料未就绪时开始写作，正是 ADR 0007 要消除的竞态，只是换了入口。

同样的分叉出现在 JSON 解析和状态文件上：`write` 用共享的 `parseJsonDocument`（`cli.ts:962`），`write-long` 用裸 `JSON.parse`（`cli.ts:1024`）；`write` 接受 `--state-file`（`cli.ts:952`），`write-long` 把 `statePath` 固定为 `worlds/<id>/story-state.json`（`cli.ts:1022`）。Workbench 的 Story Unit 隔离依赖 `--state-file` 指向 `.story-units/<id>/story-state.json`，因此长章节在 Story Unit 场景下会读写错误的状态文件。README 第 129 行的 `write-long` 流程说明没有提到以上任何一条限制。

准备步骤的名单也被复制了两份：`src/server.ts:181` 定义 `WRITING_READINESS_STEPS`，`src/cli.ts:187` 定义同名语义的 `required` 数组，两边都是 `style-profile`、`character-profiles`、`character-states`、`as-of-dossier` 四个字符串。`src/server.ts:1-3` 的文件头要求「领域逻辑全部走共享 domain service，不得在路由层复制 prompt 或 schema 逻辑」，这两处一旦有一边增删步骤，服务端「是否启动构建」与 CLI「是否可以开始写作」会给出不同答案。

## 五、常量、转义与产物命名

`src/constants.ts` 已经集中了大量策略常量，但调用点仍有未接入的字面量。`cli.ts:958-959` 用字面 `1` 和 `20` 校验 `--retrieval-limit`，`cli.ts:1049` 用 `1` 和 `12`，而 `MAX_WRITE_RETRIEVAL_LIMIT = 20`、`MAX_WRITE_LONG_RETRIEVAL_LIMIT = 12` 就在常量文件第 120、122 行。`cli.ts:670-671` 给 `regress` 硬编码 `deepseek-v4.1-flash` 和 `glm-5.3-flash`，绕过 `DEFAULT_MODEL_ID` 与 README 第 145-150 行声明的四级模型优先链。`chapter-review.ts` 把「上限 3 条」（第 40、77 行）和「引用不超过 15 字」（第 107、115 行）直接写进 Prompt 文本与注释，对应的 `MAX_REVIEW_ISSUES = 3`、`REVIEW_EVIDENCE_MAX_CHARS = 15` 改了也不会影响发给模型的指令。`cli.ts:188` 的 `30 * 60 * 1000` 和 `cli.ts:209` 的 `1000` 同样没有常量。这类脱钩的风险很具体：调整策略时只改常量文件，校验边界和模型收到的规则保持原值，代码读起来却像已经统一。

`src/workflow.ts:261` 的字符串写成 `"跨章人物弧光回顾（仅供创意启发）：\\n"`，其中 `\\n` 是转义后的反斜杠加 n，不是换行符，Story Arc 的 Prompt 会收到一段字面反斜杠文本。`workflow.ts:494` 写 `08-state-update-error.txt` 时同样用 `\\nRetry: ` 和 `\\n\\n` 拼接，两次失败诊断与原始输出挤在同一行，排查状态提取故障时更难读。这是纯转义疏漏，与项目里先前修过的同类问题相同。

产物命名制造了不存在的审计痕迹。除前面提到的三份同内容文件外，`workflow.ts:380-382` 和 `long-chapter.ts:422` 都会写 `11-style-regression-skipped.json`，内容固定为 `{"skipped": true, ...}`。一个从未执行的阶段持续产出「已跳过」文件，而 README 第 102-113 行的产物清单把同目录文件逐项列为真实阶段。运行诊断目录因此同时包含真实中间产物、内容相同的占位副本和纯说明文件，事后无法从文件名判断某一章到底跑了哪些模型阶段。

## 验证边界

本次执行了后端 `tsc -p tsconfig.json --noEmit`、`npm run build`（脚本内含前端 `tsc -p web/tsconfig.json` 与 vite 构建）与单并发全量测试（300/300 通过，耗时约 131 秒），并核对了工作区状态、真实运行产物的 MD5、SQLite 表行数、文档与 ADR 的对应段落。没有执行真实模型生成，也没有验证模型运行时是否可用。涉及批次失败退出码、构建卡住后的恢复、`--no-apply-state` 的实际污染范围等结论来自静态阅读，属于需要一次真实运行才能确认的推断，前文已分别标明。

报告中所有行号对应基线 `fdc8e424`。仓库近期有并发写入方，后续提交可能使行号失效；引用时应回到对应文件的当前版本复核。未验证的还包括：`write-long` 是否通过 Workbench 以外的入口被实际调用、`docs/PIPELINE-STATE-MANAGEMENT.md` 是否被构建或文档站消费、以及 `worlds/u-*/` 下历史宇宙的产物是否也受 Story Arc 提前落盘影响。
