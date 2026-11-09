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
