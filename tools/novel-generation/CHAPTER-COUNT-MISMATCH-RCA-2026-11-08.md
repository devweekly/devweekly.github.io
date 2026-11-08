# 原文目录与 novel.db 章节数量不一致：根因分析

日期：2026-11-08  
范围：`tools/novel-generation`，语料 `conghuoniao`，报错发生在 Workbench 创建独立故事宇宙时  
证据口径：本地源码、SQLite 与 JSON 文件实测，测量时间 2026-11-08；本文不引用外部产品资料，结论不外推到其他语料

## 结论

`原文目录与 novel.db 章节数量不一致，拒绝猜测章节映射。请重新导入并构建索引。` 这条报错由 `src/server.ts:749` 的防泄漏校验触发。校验本身按设计工作：当它无法确认「用户在目录里选的章节」对应知识库里的哪一行时，拒绝创建宇宙，避免新宇宙读到起点之后的剧情。触发它的不是章节切分错误，而是数据与代码两条独立失效链叠加。

第一条是数据生命周期：`ingest` 会清空 `novel.db` 的派生表，但清空后必须另跑 `index-story` 才能把章节表填回来。故障发生时 `novel_chapters` 为 0 行，而目录有 754 项，校验必然失败。第二条是代码口径：`readCanonChapters()` 从 `library/index.json` 按连续标题分组得到 754 项，`index-story` 依据 `chapter-index.json` 写入 753 行，两者本来就不相等。即使把数据补齐，这条数量校验仍会失败。

已执行 `index-story` 回填，`novel_chapters` 恢复为 753 行。这只解决了第一条失效链。报错文案建议「重新导入并构建索引」有误导性：重新执行 `ingest` 会再次触发清空，把状态退回原点。

修复代码口径会触及宇宙起点的定位边界：改错会让新宇宙包含起点之后的正文，属于不可逆的创作数据污染。已按方案 C 实施目录对齐、稳定 ID 定位、无切片章节回退及回归测试；实施细节与自动化结果记录在本文末尾。

## 故障表现与触发条件

报错来自创建独立故事宇宙的 POST 处理（`src/server.ts:697` 起）。该流程先调用 `readCanonChapters(rootSourceId)` 取得原文目录，用 `entryChapterIndex` 取出用户所选章节的标题与正文，再复制源世界目录、重绑知识库身份，随后在 `server.ts:745-751` 打开 `novel.db`，把 `novel_chapters` 的行数与目录长度比较，并用 `ORDER BY ordinal LIMIT 1 OFFSET ?` 取出 `chapter_id` 和 `ordinal`。`chapter_id` 之后传给 `restrictKnowledgeDatabaseToEntry()`，用于按起点截断整份知识快照。

触发条件只有一个：目录长度与 `novel_chapters` 行数不等。它与语料内容无关，只取决于两份数据是否同步。

## 实测证据

| 数据源 | 口径 | 实测值 |
|---|---|---|
| `analysis/conghuoniao/chapter-index.json` | `chapterCount` 字段 | 753 |
| 同上 | 17 卷 `chapters` 展开的标题数 | 753，去重后 749 |
| `worlds/conghuoniao/library/index.json` | 检索切片 `chunks` | 2594 |
| 同上 | 按连续 `chapter` 字段分组 | 754 组 |
| `worlds/conghuoniao/novel.db` | 故障时 `novel_chapters` 行数 | 0 |
| 同上 | 执行 `index-story` 后 | 753，`MIN/MAX(ordinal) = 0/753` |

多出的两组分别是「前置内容」和一段作者单章，标题为「第三卷剧情问题，啊，也没必要和读者详细说了，感觉自己应该专门写老北京一卷…」。`chapter-index.json` 的 `volumeBoundaryRule` 明确把卷间作者单章与卷末总结排除在章节数之外。`chapter-index.json` 的 753 个标题全部能在 library 分组中找到，反方向则多出上述 2 组，说明差异来自非章节文本，而不是章节漏切。

`index-story` 的输出印证了这一点：

```json
{
  "chapters": 753,
  "chunksMapped": 2594,
  "chaptersWithoutChunks": 1,
  "unmatchedLabels": ["前置内容", "第三卷剧情问题，啊，也没必要和读者详细说了…"],
  "characters": 18,
  "aliases": 18,
  "mentions": 1536
}
```

故障时库内几乎全部派生表为空：`story_analysis`、`novel_beats`、`novel_plot_threads`、`novel_relations`、`novel_characters` 均为 0 行，只有 `novel_arcs`（17 行）、`novel_character_profiles`（28 行）与 `world_meta`（1 行）保留。这个分布与 `invalidateDerivedAnalysis()` 的删除范围一致，而不是与某一次分析失败一致：该函数删除 `story_analysis`、`novel_chapters` 及 `clearNovelAnalysis()` 覆盖的七张表，但没有删除 `novel_arcs` 和 `novel_character_profiles`。

## 第一条失效链：清空与重建被拆成两个命令

`src/library.ts:181` 在导入语料时调用 `invalidateDerivedAnalysis()`。该函数（`src/database.ts:263-273`）在一个事务里执行 `DELETE FROM story_analysis; DELETE FROM novel_chapters;`，再调用 `clearNovelAnalysis()` 清空人物、提及、情节线、伏笔、事件、关系与知识库元数据。设计意图是：语料变更后，按旧文本切分出来的章节与分析结果全部作废。

重建并不在同一条命令里。`syncNovelChapters()`（`src/database.ts:505-518`）由 `indexNovelStructure()` 调用（`src/novel-kb.ts:376`），对应 CLI 命令 `index-story`。它按 `chapter-index.json` 重新写入 `novel_chapters` 并补充人物提及统计。也就是说，`ingest` 与 `index-story` 之间是一个「已清空、未重建」的中间态；只要在这个状态下创建宇宙，校验就会以 0 对 754 失败。

报错文案把用户指向「重新导入」，恰好会让流程再走一次清空。故障时库文件约 12 MB 而派生表几乎全空，符合 SQLite 删除数据后不自动收缩文件的行为。

## 第二条失效链：目录与知识库采用两套章节口径

`readCanonChapters()`（`src/server.ts:504-528`）只读 `library/index.json`，把 `chunks` 按连续相同的 `chapter` 字段切成组，每组拼接切片正文。它不读 `chapter-index.json`。`/api/worlds/:id/source-chapters`（`src/server.ts:647-655`）把这个数组直接映射成 `{ id: index, title, label }`，前端 Chapter Studio 的下拉框用 `id` 作为 `entryChapterIndex`。

知识库这一侧走的是另一条路径：`indexNovelStructure()` 先 `loadChapterCatalog()` 读取 `analysis/<world>/chapter-index.json`，`assignChapters()` 把切片指派给目录里的正式章节，再由 `syncNovelChapters()` 落库。目录里的「前置内容」与作者单章不属于正式章节，不会进入 `novel_chapters`；而 `readCanonChapters()` 没有过滤规则，仍把它们算作目录项。

于是 `server.ts:749` 比较的是两个不同集合的大小。这不是偶发的数据偏差，在 `conghuoniao` 语料上是稳定复现的 754 对 753。

`server.ts:750` 的取行方式引入另一类风险。它用 `LIMIT 1 OFFSET selectedIndex` 把下拉框的数组下标当作 `novel_chapters` 的行偏移。目录开头多了「前置内容」，中间多了一段作者单章，所以从第一处额外项之后，下标与行偏移至少错位 1，第二处之后错位 2。用户选择「第一章」时，取到的可能是相邻章节的 `chapter_id`。

`restrictKnowledgeDatabaseToEntry()` 对重复标题本来有保护（`src/source-canon-snapshot.ts:29-40`）：按标题查询时要求 `matches.length === 1`，多于一条就报错并要求稳定章节 ID；`test/source-canon-snapshot.test.ts` 中「duplicate chapter titles require a stable chapter id」等用例覆盖了这一点。但该保护只在按标题查询时生效。上游一旦通过 OFFSET 取到了一个合法但错误的 `chapter_id`，后续走的是 `chapter_id=?` 分支，查询恰好唯一，保护不会被触发，起点可能被定位到错误章节而不报错。753 个标题去重后只有 749 个，重复标题确实存在，这条路径不是纯理论风险。该推断基于静态代码阅读，未做端到端复现。

从 git 历史看，`1aebd72f`（2026-11-06，`原文分片只留 index.json，删掉库里重复的那份`）调整了切片与库的职责边界。把「重构遗留」作为这处不一致的成因属于推断：提交信息与当前代码依赖方向一致，但没有逐行比对重构前后的 diff，也没有证据表明作者当时有意让 Create Universe 继续按旧口径比较。这一点应作为推断而非事实记录。

## 已执行的缓解

执行 `node --import tsx src/cli.ts index-story --world conghuoniao` 后，`novel_chapters` 从 0 恢复为 753 行，`novel_characters` 18 行、`novel_mentions` 1536 行、`novel_kb_meta` 4 行也被写入。`story_analysis`、`novel_beats`、`novel_plot_threads`、`novel_relations` 仍为 0 行，这些表由 `analyze-story` 与后续知识构建步骤填充，不属于本次章节映射问题。

这次操作只补数据，不改代码。`server.ts:749` 的 `753 !== 754` 仍会抛错，创建宇宙依旧不可用。`worlds/conghuoniao/novel.db` 因此处于已修改、未提交状态。

## 修复方案

| 方案 | 做法 | 能解决 | 代价与风险 |
|---|---|---|---|
| A 只补数据 | 每次 ingest 后跑 `index-story` | 仅 0 对 754 的场景 | 754 对 753 仍失败；依赖人工记住顺序 |
| B 放宽校验 | 去掉数量相等判断，改按标题查 `chapter_id` | 让创建流程通过 | 标题去重后少 4 条，`matches.length === 1` 会拒绝；若强行取第一条，等于放弃防泄漏保证 |
| C 统一到目录骨架 | 以 `chapter-index.json` 为唯一章节列表，`readCanonChapters` 按目录序号取切片正文，`/source-chapters` 返回 catalog 序号，Create Universe 用序号或稳定 `chapter_id` 定位 | 数量口径、下标错位、重复标题歧义 | 需改动目录构造、API 返回语义与前端 `entryChapterIndex`；必须补回归测试 |

推荐 C。A 只能掩盖第一层，B 会把现有的起点保护降级。C 的改动集中在目录构造、切片位置对齐、`/source-chapters` 返回语义和数据库稳定 ID 定位。切片不能只按标题顺序匹配：同名章节可能跨卷重复，且某一卷可能缺少切片，因此还必须利用 `chapterStart` 与原文目录行号计算出的字符偏移进行二次确认；旧切片缺少位置证据且标题重复时必须失败关闭。

改动前需要确认两件事。一是 `chaptersWithoutChunks: 1` 指向哪一章、它是否应出现在可选起点里；二是已有宇宙的 `entryChapterIndex` 存的是旧目录下标，改语义后不能影响已创建宇宙的读取。后者可以通过不改已存字段、只在创建路径使用新序号来规避。

## 执行步骤与验收

以下是实施前的计划步骤，实际落地结果见后文「修复实施」；不能把计划中的数量断言理解为当前实现。

1. 备份 `worlds/conghuoniao/novel.db` 与 `library/index.json`，记录当前 `SELECT COUNT(*) FROM novel_chapters` 为 753。
2. 修改 `readCanonChapters()` 与 `/source-chapters`，用 `chapter-index.json` 的 `volumes[].chapters` 作为章节列表；断言新目录长度为 753，且每个标题都能在 library 分组中定位到切片。
3. 修改 `server.ts:748-750`，数量校验改为与 catalog 章节数比较，`chapter_id` 改为按 catalog 序号取；删掉 `OFFSET selectedIndex` 的用法。
4. 增加用例：目录含非章节分组、章节标题跨卷重复、知识库未回填三种情况下，创建宇宙分别应成功、使用稳定 ID、明确失败。
5. 跑 `node --import tsx --test test/source-canon-snapshot.test.ts test/universe-create.integration.test.ts test/universe-branch.test.ts`，再跑 `npm run build`。
6. 端到端验证：选卷 1 第一章创建宇宙，检查 `universe.json` 的 `entryChapterId` 对应 `novel_chapters` 中 ordinal 最小的正式章节；再选卷 3 的同名「第一章」，确认拿到的是卷 3 的 `chapter_id`，且快照中不含起点之后的章节证据。

验收后需要长期观察的信号是 `index-story` 每次输出的 `chapterCount`、`chunksMapped`、`unmatchedLabels` 与 `chaptersWithoutChunks`。任一值变化都需要重新核对 Create Universe 的映射。若 C 上线后出现起点定位错误，回滚方式是还原这三处代码并重新执行 `index-story`；已经按错误起点创建的宇宙需要废弃重建，不能靠补数据修正。

## 修复实施（2026-11-08）

按方案 C 完成实现，正式章节集合以 `analysis/<world>/chapter-index.json` 为唯一骨架：

1. 新增 `src/canon-chapters.ts`，把连续切片组按正式目录顺序对齐。前置内容、卷间作者说明等不属于目录的分组会被跳过；重复标题通过 `chapterStart` 对照原文目录行号计算出的字符偏移精确匹配，不再只凭标题或数组位置猜测。
2. 对于目录中没有检索切片的章节，保留其目录位置，并按 `line` 边界从 `original.txt` 读取正文。若正文不可用，创建流程拒绝使用空章节，不会把后续章节的切片挪给它。
3. `/api/worlds/:id/source-chapters` 返回正式目录的 0-based 序号，序号语义与 `entryChapterIndex` 保持一致。已有宇宙的 `entryChapterIndex` 不做迁移或重写。
4. Create Universe 不再用 `COUNT(*) === canonChapters.length` 作为唯一映射，也不再使用 `ORDER BY ordinal LIMIT 1 OFFSET ?`。服务端通过目录元数据计算稳定 ID（`Vxx-Cxxx`），逐条核对数据库中已有的正式章节 ID、ordinal、volume、title，再用 `WHERE chapter_id=?` 取得起点。
5. 允许数据库中存在索引流程产生的 `V00-C000` 前置内容行，但它不计入正式章节目录。若正式目录章节确实没有切片、数据库也没有对应行，且能从原文目录行边界取得正文，则只在新宇宙 staging 数据库中补建该章节目录行；源项目的 `novel.db` 不会被修改。若数据库完全没有正式章节索引，或缺失的是已有切片的章节，则明确要求执行 `index-story`。
6. 子宇宙的 library 快照同样按目录对齐后截断；不再按原始切片分组数量截断。分析目录快照直接按正式目录序号截断，不再以切片分组数量估算边界。
7. 错误提示明确要求执行 `index-story`，并提醒不要重新执行 `ingest`，避免再次清空派生索引。

新增测试覆盖：非章节分组过滤、跨卷重复标题、通过原文字符偏移匹配重复标题、缺失切片章节保留原目录位置、缺失位置证据时失败关闭、无切片章节从原文回退、稳定章节 ID 起点、源数据库不被补写、知识库快照只保留起点及之前的正式章节。测试不会用标题相等或 OFFSET 推测起点。

**重要边界：** 缺少切片的章节仅在能够从原始全文按目录行号恢复正文、且其余数据库目录行均能与正式目录精确核对时才可补入 staging 快照。重复标题必须同时具备 `chapterStart` 位置证据；旧索引缺少该字段时，不能降级为标题匹配。不能从原文恢复正文、数据库完全未建立正式章节索引、或存在无法解释的额外/错位章节 ID 时，仍然失败关闭。

## 证据边界与未验证项

本文的数据层结论来自对 SQLite、JSON 与源码的直接测量，属于可复核事实；「清空与重建被拆成两个命令」「两套章节口径」由调用链与实测数字共同支持；「重构遗留」为推断，依据 git 提交信息与依赖方向，未做逐行 diff 比对。

原始 RCA 测量没有记录 `chaptersWithoutChunks: 1` 对应的具体章节名称，因此该名称仍需通过当前语料的 `index-story` 输出或实际目录核对；实现不再依赖这个名称，而是按每个目录条目的稳定 ID 与切片是否存在逐项处理。754 与 753 仍只代表 `conghuoniao` 的测量值，不外推到其他语料。方案 C 的回归测试覆盖了合成的缺切片场景；真实 `conghuoniao` 全量目录仍需在具备该语料文件的运行环境做一次创建验收。

`src/server.ts` 在本项目里存在并发修改历史。实施 C 之前应重新读取该文件，确认 `readCanonChapters()`、数量校验与 `OFFSET` 三处仍未变化。

## 附录：核对命令与代码位置

| 用途 | 位置 |
|---|---|
| 清空派生数据 | `src/library.ts:181` → `src/database.ts:263-273`、`498-503` |
| 回填章节表 | `src/novel-kb.ts:365-376` → `src/database.ts:505-518` |
| 目录构造 | `src/server.ts:504-528`，`src/server.ts:647-655` |
| 数量校验与起点定位 | `src/server.ts:745-755` |
| 按起点截断快照 | `src/source-canon-snapshot.ts:17-40` |
| 章节目录数据 | `analysis/conghuoniao/chapter-index.json` |
| 切片数据 | `worlds/conghuoniao/library/index.json` |

复现测量：

```bash
node --import tsx src/cli.ts index-story --world conghuoniao
python3 -c "import sqlite3; print(sqlite3.connect('worlds/conghuoniao/novel.db').execute('SELECT COUNT(*) FROM novel_chapters').fetchone())"
```
