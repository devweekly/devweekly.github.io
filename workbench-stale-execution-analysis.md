# Workbench 任务状态不一致诊断

能判断，且不需要新增后端字段或状态。2026-11-09 明朝宇宙（`u-f3ecced6e84e42b0`）遇到的「生成按钮全灰、界面却找不到取消入口」，是前端用两套互相独立的状态源分别决定「是否阻塞写入」和「是否展示任务卡片」造成的。数据本身完整，服务端 `/api/worlds/:id/story-executions` 已经返回了那个处于 `paused` 的任务，取消接口也接受 `paused` 状态。缺的是把已有任务显示出来并挂上已有按钮。

知识构建的重启恢复还有一处独立缺陷：两条恢复路径，先执行的那条把状态写成 `failed`，后执行的那条只认 `running`/`queued` 因而永远空转。前端为「已中断（服务重启）」准备的文案因此是死代码，重启后一律显示「构建失败」，与实际发生的中断不符。

## 现场记录

以下均为磁盘与接口的实际读数。`story-executions` 等文件中存的是 UTC，表中统一换算为本地时间（UTC+8）。服务进程 `node dist/server-main.js`（PID 8228）启动于 21:58:15，父进程是 21:58:14 执行的 `npm run start:web`，两者时间吻合。

| 记录 | 状态 | 起止（本地） | 备注 |
|---|---|---|---|
| story execution `e7987e08` | `paused` | 20:10:34 → 21:58:15 | 连续章节批次，目标 5 章 |
| 其 `currentRunId` 指向的 run `44578808` | `failed` | 20:10:34 → 21:58:15 | 「服务重启前章节未完成」，Story State 已回滚到章节开始前 |
| 该 execution 的 `completedChapters` | 空数组 | — | 一章未提交 |
| knowledge build | `failed` | 19:46:04 → 21:58:15 | 5 步中前 4 步 `completed` |
| 最后一步 `character-states` | `failed` | 20:05:23 → 21:58:15 | error 为 `Workbench restarted before this step completed...` |

章节任务的产物目录 `.output/u-f3ecced6e84e42b0/chapter-44578808-.../` 里，最后写入的文件是 20:14:00 的 `01-main-plot.md`，`pipeline-manifest.json` 只登记了 `story-arc` 与 `plot` 两个已完成阶段。知识构建的最后一步从 20:05 起同样没有新产物。两条任务各自停滞到 21:58 重启：知识构建约 1 小时 53 分，章节流水线约 1 小时 44 分。停滞时长是观察事实；根因（模型调用无响应还是子进程挂起）需要单独查超时与重试配置。

接口侧复核：21:58 之后请求 `/api/worlds/u-f3ecced6e84e42b0/story-executions`，返回的 `executions[0].status` 为 `paused`。服务进程 8228 没有子进程，机器上也没有 `novel-generation` 的章节生成进程。所以「当前没有任务在执行」是确定的，界面上残留的「执行中」属于重启前的状态快照。

## 三条可机检的不一致

判断「状态已经不对了」不依赖新的埋点，现有字段足以构造判据。

| 编号 | 判据 | 现场是否命中 | 含义 |
|---|---|---|---|
| S1 | `execution.status ∈ {queued, running, paused}` 且 `currentRunId` 指向的 `run.status ∈ {failed, cancelled}` | 命中 | 检查点悬空，恢复会重跑当前章 |
| S2 | `activeStoryExecution` 非空且 `storyExecution` 为 `null` | 命中 | 写操作被阻塞，但解锁入口不可见 |
| S3 | `knowledgeBuild.status === "failed"` 且某 step 的 `error` 含 `Workbench restarted` | 命中 | 语义应为「被中断」而非「构建失败」 |

S1 与 S3 属于记录语义问题，S2 是直接造成用户困惑的那一条。三条判据都可以在前端加载完 `executions`、`runs`、`build` 之后一次算完。

## 前端为什么把阻塞和入口拆开了

`web/src/ChapterStudio.tsx` 里有两个关于执行的 state。`worldStoryExecutions`（第 49 行）在第 94 行由接口返回值整体赋值，不过滤任何范围；`storyExecution`（第 48 行）在第 95 行从 `scopedExecutions` 中挑第一个，而 `scopedExecutions` 按 `historyScope` 与 `chosen`（当前选中的故事单元 id）过滤。

阻塞判据走前者：

```ts
const activeStoryExecution = worldStoryExecutions.find(
  item => ["queued", "running", "paused"].includes(item.status));
const storyTaskBlocksWrites = Boolean(activeStoryExecution);
```

`storyTaskBlocksWrites` 随后被写进「生成下一章」「连续生成多章」「从本宇宙分叉」「归档当前宇宙」「重新推演故事设计」等按钮的 `disabled`（第 258–261、315、334 行）。

展示与操作走后者。任务卡片本身以 `storyExecution && <Card>` 为渲染条件（第 338 行），「取消任务」按钮在卡片内、条件是 `["queued","running","paused"].includes(storyExecution.status)`（第 349 行）。按钮一直存在，只是卡片没渲染。

明朝的 execution 没有 `storyUnitId`（属于 Legacy 任务），而切换世界时第 77 行把 `historyScope` 重置为 `"current"`。此时若该宇宙没有故事单元，`chosen` 为 `undefined`，第 94 行的过滤条件 `Boolean(chosen) && item.storyUnitId === chosen` 恒为假，`scopedExecutions` 为空，`storyExecution` 被置为 `null`。同时 `worldStoryExecutions` 已拿到全量列表，`activeStoryExecution` 命中那个 `paused` 任务。两边一结合，就是截图里的样子。

还有一个放大因素：第 103 行的轮询 `useEffect` 只对 `queued` 与 `running` 启动定时器。`paused` 任务既不会自动更新，刷新后也不会被轮询纠正，只能靠用户手工切到「旧版历史（Legacy）」才能看见它。这是设计上假设了「暂停任务一定处于当前可见的 scope」，而这个假设对 Legacy 任务不成立。

## 知识构建「构建失败」的来历

`src/server-main.ts` 的启动序列是：

```ts
await recoverWorkbenchRuns();     // 第 30 行
await recoverKnowledgeBuilds();   // 第 31 行
```

`recoverWorkbenchRuns()` 定义在 `src/server.ts:2505`，其中 2535–2544 行内联了一段知识构建恢复：只要落盘状态是 `queued` 或 `running`，就把它改成 `failed`，并把 `running` 的步骤标为 `failed`、附上英文错误 `Workbench restarted before this step completed...`。

`recoverKnowledgeBuilds()` 定义在 `src/server.ts:307`，做的是同一件事，但写入的状态是 `interrupted`，步骤错误文案是中文的「服务重启，构建被中断；已完成的批次缓存仍可复用」。它开头的判断是：

```ts
if (!state || (state.status !== "running" && state.status !== "queued")) return;
```

由于前一个函数已经把状态改成 `failed`，这个判断必然返回，`recoverKnowledgeBuilds()` 每次启动都是空操作。`KnowledgeBuildState` 状态枚举里保留了 `interrupted`（`server.ts:139`），前端也准备了对应文案「已中断（服务重启）」（`ChapterStudio.tsx:284`），两者都到不了。代码注释还明确写着「残留状态由 `recoverKnowledgeBuilds()` 在启动时标记为 interrupted」（`server.ts:239`、`303`），与运行结果相反。

`dist/` 里的顺序和分支与源码一致，当前运行的 `node dist/server-main.js` 确实走这条路。这不是构建产物过旧造成的。

除了文案误导，这个缺陷还影响判断成本：「构建失败」让人以为要重跑全部 13 批 `story-analysis`（上次耗时约 18 分钟），而真实情况是前 4 步产物都在磁盘上，只有 `character-states` 需要重做。

## 方案对比

| 方案 | 改动范围 | 优点 | 代价与风险 |
|---|---|---|---|
| A. 页面顶部加一条全局告警，检测到阻塞任务不可见时显示「取消任务」 | 前端新增一个组件 | 改动最小，位置醒目 | 又引入一处状态判断；卡片与告警条并存，两套 UI 表达同一件事 |
| B. 任务卡片改用 `activeStoryExecution ?? storyExecution` 渲染，取消按钮读同一对象 | 前端第 338、349 行附近，约 3 行 | 阻塞来源即展示来源，解锁入口必然可见；复用既有卡片与接口 | 会跨 `historyScope` 显示 Legacy 任务，需在卡片上标注归属 |
| C. 服务端新增 `interrupted` / `stalled` 执行状态并迁移落盘数据 | 状态枚举、恢复逻辑、前端文案、轮询 | 状态语义最准确 | 超出本次需求；`paused` 已足以表达可恢复，新增状态要处理迁移与兼容 |
| D. 合并 `worldStoryExecutions` 与 `storyExecution` 为单一派生值 | 前端状态管理、历史列表、scope 切换 | 根治双真相源 | 改动面最大，触及 `historyScope` 与故事单元的既有语义 |

推荐 B，同时删除 `recoverWorkbenchRuns` 中重复的知识构建恢复块。B 没有引入新机制，只是把「谁在阻塞」和「显示哪个任务」指向同一个值；顺带在卡片上标明「Legacy（旧版）」，就能消除跨 scope 显示任务的突兀感。删掉 2535–2544 那一段后，`recoverKnowledgeBuilds()` 恢复生效，`interrupted` 状态与「已中断（服务重启）」文案随之可用，`server.ts:239` 的注释也成立。按项目约定，重复且已被取代的恢复分支直接移除，不保留兼容层。

S1（检查点悬空）不需要新状态：在卡片里读取 `currentRunId` 对应的 run，若为 `failed`，把「从检查点恢复」的说明改为「当前章已回滚，恢复将从本章开头重跑」。这是纯展示层的补充，可随 B 一起做。

S3 还有一个可选动作：让「重新构建知识资料」跳过已完成步骤。`recoverKnowledgeBuilds` 的注释声称「已完成的批次缓存仍可复用」，但重建入口是否真的跳过缓存需要另查 `startKnowledgeBuild` 的实现，这一点尚未核实，不作为结论。

## 落地步骤与验收

改动顺序建议：先修恢复顺序（服务端，一行删除 + 顺序无需调整），再改前端卡片渲染，最后补展示说明。

验收分三层。单元层造两份 fixture：`paused` execution 配 `failed` run、以及 `running` build 经 `recoverWorkbenchRuns()` + `recoverKnowledgeBuilds()` 后的落盘状态，分别断言卡片可见、取消按钮可点、build 状态为 `interrupted`。集成层重启服务，检查知识构建文件的 `status` 与 step error 文案，并确认 `/api/worlds/:id/knowledge-build` 返回值与之一致。回归层覆盖四个场景：切换故事宇宙、`historyScope` 在 current/legacy 间切换、刷新页面、点击取消后写操作按钮恢复可用；每一步都比对 `activeStoryExecution` 与页面上可见的任务卡片是否指向同一个 id。

监控与恢复路径：现有 2 秒一次的 `knowledge-build` 轮询可以顺带承载 S1/S3 的告警，不必新增定时器；`paused` 任务的轮询缺口建议一并补上（把 `useEffect` 的条件从 `["queued","running"]` 放宽到包含 `paused`），否则用户手动在另一个标签页取消任务后，当前页仍会保持阻塞态直到刷新。若不想改轮询，至少要保证「刷新状态」按钮同时刷新 `executions` 与 `runs`，目前 `refresh()`（第 59 行起）只拉 runs 与 story arc。

## 范围与未决项

诊断止于方案设计，代码与运行中的 Workbench 进程均未改动。所引行号对应 2026-11-09 的 `main` 分支工作副本，`dist/` 已核对与源码一致。

两件事没有结论。一是两条任务分别从 20:05 与 20:14 起停滞到 21:58 的根因；`character-states` 与章节流水线 `plot` 之后那一步是否共用同一个无超时的模型调用路径，需要查 `agent-runtime` 的超时与重试配置。二是「重新构建知识资料」是否复用已完成批次的缓存，注释与实现是否一致尚未核实。在这两点查清之前，不建议点击「重新构建知识资料」或「从检查点恢复」——两个动作都可能再次长时间无产出。

若要立即解锁当前界面，无需改代码：把「章节历史」的 scope 切到「旧版历史（Legacy）」，任务卡片会出现，其中的「取消任务」可用；服务端 `POST /api/worlds/u-f3ecced6e84e42b0/story-executions/e7987e08-.../cancel` 接受 `paused` 状态并直接置为 `cancelled`，取消后 `storyTaskBlocksWrites` 转为 false，写入按钮恢复。
