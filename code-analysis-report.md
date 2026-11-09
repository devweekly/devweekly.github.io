# 代码审查报告（tools/novel-generation）

> 基于当前代码（merge 后 HEAD `d6a85559`，typecheck + 274 测试全绿）。以下按严重程度列出可确认的问题，含文件:行号。本报告仅分析，未修改代码。

## 一、高优先级（并发/流程 correctness）

### 1. `server.ts` `serializeWorld` 队列不隔离前序拒绝
- **位置**：`src/server.ts:336-350`
- **问题**：`tail = previous.then(() => current)`。若前一个任务抛错，`tail` 会拒绝，下一个调用者 `await previous` 直接抛出——即使它自己的任务从未执行。一个失败的 world mutation 会把后续所有同 world 的串行操作全部拖挂。
- **修法**：`previous.catch(() => undefined).then(() => current)` 或 `previous.then(() => current, () => current)`。
- **影响**：高并发/异常下，world 级操作可能出现"无原因失败"链。

### 2. 同一资源存在两套独立锁
- **位置**：`src/server.ts:132`（`worldMutationLocks` Set）与 `:336`（`worldQueues` Map promise 链）。
- **问题**：`serializeWorld`（promise 队列）与 `acquireWorldMutation`（Set 锁）并存，锁语义不统一。Universe 创建/归档/分叉路由里两者混用，release 时机分散在 `finally`，存在"队列锁已释放但 Set 锁未释放"或反之的窗口。
- **影响**：并发创建宇宙时可能绕过互斥，或死等。

### 3. `transaction()` 不对 work() 做 busy 重试
- **位置**：`src/database.ts:31-46`
- **问题**：仅 `BEGIN IMMEDIATE` 与 `COMMIT` 走 `retryBusy`，`work()` 本体在 SQLITE_BUSY 时直接抛错回滚。高并发写入下事务失败率偏高，调用方通常不重试。
- **影响**：中等（单机 SQLite 负载不高时不易触发）。

## 二、中优先级（健壮性/可维护性）

### 4. 未受保护的 `JSON.parse`（崩溃风险）
- `src/novel-kb.ts:54` `loadChapterCatalogDocument`：文件损坏直接抛，与 `loadChapterCatalog` 的容错不一致。
- `src/story-arcs.ts:98-99`：对 DB 行 `key_turns_json`/`characters_json` 直接 parse，坏行崩溃。
- `src/cli.ts:923,985`：`validateStoryUnit(JSON.parse(raw), worldId)` 在 `.then` 内，文件损坏导致 CLI 进程崩溃而非友好报错。
- **修法**：统一包 try/catch，损坏时返回 undefined/抛带上下文的错误。

### 5. 静默吞错的 empty catch
- `src/story-execution.ts:73` `catch { return undefined; }`：列表枚举时解析失败完全静默，可能掩盖数据损坏。
- `src/universe-library.ts:38`、`src/source-canon-snapshot.ts:9`、`src/novel-kb.ts:646`、`src/character-chapter-state.ts:155`、`src/character-profile.ts:257`、`src/stage-cache.ts:80`、`src/story-arcs.ts:129`。
- 大部分是刻意的缓存/文件缺失处理，但建议至少 `console.warn` 留痕，便于定位"为什么缓存没命中"。

### 6. Anti-AI 产物与最终稿不一致
- **位置**：`src/workflow.ts` Anti-AI 段落 + `src/literary-edit.ts`
- **问题**：复核决策 `restore` 时，`06b-anti-ai-edited.md` 仍保存了被拒绝的编辑稿，而 `chapter.md` 使用原稿。调试时文件名与内容语义不符，容易误判。
- **修法**：restore 时将 `06b` 重命名为 `06b-anti-ai-edited-rejected.md` 或写入 `06c` 的 decision 引用。

### 7. `workflow.ts` 长链 `.then` 嵌套
- **位置**：`src/workflow.ts:378`、`src/long-chapter.ts:375`
- **问题**：`parseChapterReview(...).then(raw => { parseChapterReview(raw, candidate); ... })` 双重解析，且 `.then` 内再次 `parseChapterReview`。逻辑正确但冗余；review 回调返回值类型混杂（string vs object）。
- **修法**：拆成 async 函数，消除双重 parse。

### 8. 连续性备注无上限增长
- **位置**：`src/story-state.ts` + `src/workflow.ts` 状态提取
- **问题**：`continuityNotes` 只追加不裁剪（18 条/章已出现）。长期运行后写作上下文膨胀；`mergeStoryState` 按 id/name 归并但无去重/过期淘汰。
- **修法**：在 `saveStoryState` 前按"仍有效"过滤，或设上限。

### 9. `canonFacts` 来源标记不完整
- **位置**：`src/story-state.ts` + `src/workflow.ts` 状态提取
- **问题**：续写章节新增事实应标 `origin: original`（per ADR），但提取输出的 `canonFacts` 条目未明确携带 origin。`saveStoryState` 的迁移逻辑对"来源不明的旧事件不推断正史属性"——新事实的来源链需确认。
- **修法**：在状态提取 prompt/schema 中强制 `origin` 字段，save 时校验。

## 三、低优先级（性能/可读性）

### 10. `long-chapter.ts` 600+ 行单文件
- 混合场景规划、生成、审查、状态提取、日志。建议按职责拆分（scene-plan / scene-generate / review / state）。

### 11. 同步 I/O 在异步路径
- `src/iron-laws.ts:1` `readFileSync`、`src/runtime-check.ts` 等。单次读小文件，影响有限，但阻塞事件循环。

### 12. `server.ts` `listWorlds` 串行读取
- 每个世界读 bible + story plan 串行；world 数多时启动慢。可并行化。

### 13. `console.error` 作正常进度输出
- `src/long-chapter.ts` 多处用 `console.error` 输出正常进度（汉字数、场景编号）。应使用 stdout 或结构化日志，避免与真实错误混淆。

### 14. `writing-brief` 事实包空缺
- 本章运行显示"事实包 0 字"。`writing-brief.ts` 的词面匹配可能过于严格，导致 continuity 保障完全依赖分析参考。建议观察多章后决定是否调整匹配策略（非代码 bug，但影响生成质量）。

### 15. `worldMutationLocks` Set 与 promise 队列的双重锁
- 同问题 2，建议统一为单一锁实现。

## 四、未发现问题的领域

- Typecheck（src + web）通过，274 测试全绿。
- SQL 注入风险低：表名均来自 allow-list 或 PRAGMA，参数化查询用于值。
- 路径逃逸有双重防护（worldId 正则 + `assertInsideWorld`）。
- 证据纪律（L#### 引用、逐字 evidence）在 `analysis.ts`/`world-analysis.ts` 有确定性校验 + fail-closed 语义审查。
- `stage-cache.ts` manifest 队列正确使用 `.catch(() => undefined).then(...)` 模式（与 `serializeWorld` 形成对比）。

## 建议优先处理顺序

1. **P1** 修复 `serializeWorld` 队列的拒绝传播（一行改动，高影响）。
2. **P2** 统一 world mutation 锁（消除双重锁）。
3. **P3** 为 3 处未保护 `JSON.parse` 加 try/catch。
4. **P4** Anti-AI 产物命名对齐 + 连续性备注上限。
5. **P5** 其余可读性/性能改进按需推进。

> 以上为分析报告，未修改任何代码。


---

## 五、修复实施记录（2026-11-09）

本节按当前 `main` 的实现核对原报告。原报告基于 `d6a85559`，行号和部分判断已过时；以下是本轮实际修改结果，而不是把原建议全部照单全收。

### 已修复

| 原报告项 | 当前处理 | 结果 |
|---|---|---|
| 1. world 队列拒绝传播 | 队列前序 Promise 增加 rejection isolation。补充说明：当前队列 tail 实际代表 release gate，不直接承接 task rejection，因此原报告描述的失败传播路径在当前实现中并未复现；防御性隔离仍保留。 | 已处理 |
| 2 / 15. 双重 world mutation 锁 | 删除 `worldMutationLocks` Set、`acquireWorldMutation` / `releaseWorldMutation`。归档、创建、分叉统一使用同一 `serializeWorld` 队列，不再维护两套互斥状态。 | 已处理 |
| 4. 未保护 JSON.parse | 章节目录损坏错误带文件路径；故事单元 CLI JSON 解析带路径上下文；卷级情节的数据库 JSON 数组校验带 volume/column；损坏缓存有明确诊断。 | 已处理 |
| 5. 静默吞错 | 执行记录、人物档案、人物章节状态缓存、阶段缓存、卷级情节缓存记录损坏原因；bounded library 区分文件缺失与访问错误。移除不安全知识库失败清理的静默 catch：删除失败必须中止，不能继续使用可能包含未来剧情的数据库。 | 已处理 |
| 6. Anti-AI 产物与最终稿不一致 | 当前普通章节和长章节均在复核决策完成后，把最终选用的稿件写回 `06b-anti-ai-edited.md`；restore 时该文件已经是恢复后的正文。该问题在本轮前已由后续代码修复，本轮核对确认，无需重复修改。 | 已解决 |
| 7. review 双重解析 | 普通章节和长章节改为 async review callback，在缓存校验时解析一次并复用解析结果。 | 已处理 |
| 8. 连续性备注增长 | 保留已有去重逻辑；增加 `MAX_ACTIVE_CONTINUITY_NOTES = 40`，只保留最近 40 条有效备注。新增 55 条输入的边界回归测试。 | 已处理 |
| 9. canonFacts 来源标记 | 当前已使用 `confidence: confirmed / inferred / original` 表达来源等级；状态合并会把续写新增事实强制标为 `original`，已有回归测试覆盖模型误报 confirmed 的情况。无需再添加重复的 `origin` 字段。 | 已解决 |
| 12. listWorlds 串行读取 | 世界目录元数据改为 `Promise.all` 并行读取；单个目录损坏只跳过该目录并留下日志。 | 已处理 |
| 13. 正常进度使用 stderr | 长章节的场景、修订、蓝图修订和成稿统计改为 stdout；真正的错误仍走 stderr。 | 已处理 |

### 经核查不应按原建议直接修改

1. **SQLite transaction work() 不做原地 busy retry。** `BEGIN IMMEDIATE` 先获取写保留锁；如果 work callback 已经执行了部分 SQL，直接在同一事务里重放 callback 可能重复执行写入或闭包副作用。当前只对 BEGIN/COMMIT 做 busy retry，work 失败时整体 rollback。已在代码中明确该重试边界。若未来需要业务级重试，应重试整个幂等事务，而不是在打开的事务里重放 callback。
2. **canonFacts 不需要额外 origin 字段。** 当前 `confidence=original` 已是写作状态事实的来源标记，且有迁移和测试保障；事件则使用独立的 `origin` 字段。增加第二个来源字段会制造双重事实来源。
3. **Anti-AI 文件名问题已经修复。** 两条写作流水线都在复核后保存最终选用稿，未再保留“文件名像编辑稿、内容实际是恢复稿”的状态。
4. **writing-brief 事实包为空不能仅凭一次运行改词面匹配。** 它取决于当前知识库是否有可用人物档案、情节线、伏笔和章节事件，以及这些内容是否与本次任务相关。扩大匹配会把无关资料塞入写作上下文，不能为追求非零字数而牺牲相关性。应结合知识库数据和多章运行记录再决定是否调整。

### 暂缓的低优先级重构

- `long-chapter.ts` 当前约 620 行。它确实混合场景规划、生成、审查和状态更新，但本轮先修正跨两条流水线的共享问题；大规模拆分会扩大回归面，且不直接改善当前功能正确性。后续应以明确的模块接口逐步提取，而不是机械按行数拆文件。
- `iron-laws.ts` / `runtime-check.ts` 的同步小文件 I/O 目前不是已证实的性能瓶颈；将其异步化会扩散到调用接口，暂不值得。
- 不改变 writing-brief 的相关性算法，直到有真实多章样本证明它系统性漏掉应注入的事实。

### 验证

- 最新提交：`8f1eec66196567f0d41d148caf6110ea2e650378`
- `npm run typecheck`：通过
- `npm test`：283 / 283 通过
- `npm run build`：通过
- GitHub Actions：Novel generation checks 成功

CI：<https://github.com/devweekly/devweekly.github.io/actions/runs/42580045392>
