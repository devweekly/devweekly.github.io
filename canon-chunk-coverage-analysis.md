# 「原著切片未完整覆盖目录章节」错误根因分析

> 错误原文：`原文目录加载失败 原著切片未完整覆盖目录章节：第一章 忍·土。请重新 ingest original.txt 后执行 index-story`
> 分析范围：`tools/novel-generation/src/canon-chapters.ts`、`src/novel-kb.ts`、`src/library.ts`、`worlds/conghuoniao/library/index.json`、`analysis/conghuoniao/chapter-index.json`。
> 本报告仅分析，未修改代码。

## 1. 错误出处

`src/canon-chapters.ts:179`：

```ts
if (ordered[0]?.start !== 0 || previousEnd !== chapterText.length) {
  throw new Error("原著切片未完整覆盖目录章节：" + item.chapter.title + "。请重新 ingest original.txt 后执行 index-story。");
}
```

函数 `validateCanonChunksAgainstText(aligned, originalText, chapterStartOffsets)` 对每个章节的切片做严格校验：
- 第一块 `start` 必须为 0；
- 块序号必须连续（`chunkIndex === previousIndex + 1`）；
- 块之间不能有间隙（`chunk.start <= previousEnd`）；
- 最后一块的 `end` 必须等于该章节文本长度（`previousEnd === chapterText.length`）。

任一条件不满足即抛出上述错误（或相邻的"正文与声明位置不一致""缺少连续可验证偏移"）。

## 2. 直接触发条件（本例"第一章 忍·土"）

对 `worlds/conghuoniao/library/index.json` 中 chapter="第一章 忍·土" 的 canonical 切片做覆盖检查：

| 块 | start | end | 文本长度 |
|---|---|---|---|
| 0 | 0 | 1186 | 1186 |
| 1 | 1026 | 2219 | 1193 |
| 2 | 2063 | 3260 | 1197 |
| 3 | 3104 | **4154** | 1050 |

章节文本长度（trimmed）= **4266**，但切片只覆盖到 **4154**，尾部 112 字符未覆盖 → `previousEnd (4154) !== chapterText.length (4266)` → 抛错。

切片的 `sourceHash` 与当前 `original.txt` 完全一致（`f1ff729c…`），说明文件内容未变，但切片数据本身不完整。

## 3. 根本原因：library/index.json 中的 canonical 切片数据损坏/重复

扫描全部 canonical 切片（source 以 `original.txt` 结尾），发现 5 个章节校验失败：

| 章节 | 失败原因 | canonical 块数 |
|---|---|---|
| 第一章 结算 | 块序号不连续（0,0,1,1,2,2,3,3 — 两套重复） | 8 |
| 第八章 爻 | 块序号不连续（0,0,1,1,2,2,3,3,4） | 9 |
| 第三十七章 | 块序号不连续（0,0,1,1,2,2） | 6 |
| 第一章 忍·土 | 尾部未覆盖（pe=4154 != len=4266） | 4 |
| 第四十六章 | 块序号不连续（0,0,1,1,2,2） | 6 |

"非连续"章节的块分为两套，ID 前缀分别为 `original.txt:43:*` 与 `original.txt:267:*`（chapterIndex 不同），两套 `source` 都是 `original.txt`、`sourceHash` 都匹配当前原文。**这是多次 ingest 累积的重复 canonical 切片**，或某次不完整写入导致的截断。

关键点：`sourceHash` 只校验整本 `original.txt`，无法检测"切片生成逻辑/数据本身"是否损坏或重复。因此重复/截断的切片能通过哈希检查，却在覆盖校验阶段才暴露。

## 4. 为什么自动重建没有救火

`ensureCanonLibraryIndex`（`src/novel-kb.ts`）的流程：

1. `prepareCanonIndexInputs` → 读取 `original.txt`、校验 catalog 行号（`validateCanonCatalogAgainstText`）。
2. `alignCanonChapterGroups(catalog, prepared.chunks, chapterStartOffsets)` — `prepared.chunks` 来自 `selectCanonSourceChunks(现有 chunks)`，**即复用现有损坏切片**。
3. `validateCanonChunksAgainstText(aligned, …)` — **在重建之前就跑**，损坏切片直接抛错。
4. 只有当某章节 `chunks.length === 0`（完全缺失）时，才会进入 `rebuiltByCatalogIndex` 从 `original.txt` 重建。

结论：自动重建只处理"缺失"，不处理"存在但损坏/重复/截断"。一旦 canonical 切片损坏，每次调用都在步骤 3 抛错，永远走不到重建。错误消息引导用户手动 `ingest original.txt` + `index-story`，但即使重跑 ingest，若 `ensureCanonLibraryIndex` 仍先校验旧数据，也可能继续失败（除非先删除 `library/index.json`）。

## 5. 触发路径

该错误会在以下操作中抛出（均调用 `prepareCanonIndexInputs` / `validateCanonChunksAgainstText`）：

- `index-story` 命令（`src/cli.ts` → `indexNovelStructure`）
- `analyze` / `analyze-story` 等需要 canonical 切片的流程
- Universe 创建（`src/server.ts` `/api/worlds/:worldId/universes` → `ensureBoundedUniverseCanonAssets` → `prepareCanonIndexInputs`）
- `ensureCanonLibraryIndex` 的缓存未命中时

用户看到的"原文目录加载失败"大概率来自 Web Workbench 的 Universe 创建或 Knowledge Build 流程，或 CLI 的 `index-story`。

## 6. 根因总结

1. **数据层**：`library/index.json` 中 5 个章节的 canonical 切片损坏（4 个重复块序号、1 个尾部截断），sourceHash 仍匹配，因此哈希校验无法发现。
2. **流程层**：`validateCanonChunksAgainstText` 在自动重建之前执行，且重建只处理"缺失"不处理"损坏"，导致损坏数据无法自愈。
3. **恢复层**：错误消息建议手动 re-ingest，但若不先清空 `library/index.json`，重跑仍会先校验旧损坏数据而失败。

## 7. 建议的修复方向（未实施）

- 在 `prepareCanonIndexInputs` 中，将 `validateCanonChunksAgainstText` 移到"缺失检查"之后，或在校验失败时自动进入 rebuild 分支（把损坏章节视为 missing）。
- 在 `selectCanonSourceChunks` 或 ingest 路径中按 `(source, chapter, chunkIndex)` 去重，避免重复累积。
- 在 `ensureCanonLibraryIndex` 开头增加"canonical 切片覆盖校验失败 → 清空 canonical 重跑"的分支。
- 为 chunk 增加生成版本/时间戳或 chunker 版本号，便于检测陈旧切片（当前仅靠 sourceHash，无法感知切片逻辑变更）。
- 短期恢复：删除 `worlds/conghuoniao/library/index.json`（及 `annotations.json`/`entities.json`），重新 `ingest original.txt` + `index-story`。

> 以上为分析报告，未修改任何代码。

## 8. 自动恢复改造记录（2026-11-09）

上述分析指出的问题不应由写作者通过手工删除索引、重新 ingest 或重新运行 index-story 来处理。当前实现已增加以下自动恢复路径：

1. `ensureSourceCanonLibraryIndex()` 将缺失、部分覆盖、重复 chunk 序号、偏移错误、正文不匹配、尾部截断及旧 sourceHash 切片统一视为派生索引损坏；只要当前世界的权威 `original.txt` 可读且目录行号可验证，就从原文重建受影响章节。
2. 重建以完整章节组为单位替换，不把新切片追加到旧组；写入采用临时文件加原子 rename，保留非 canonical 用户导入。
3. 同一世界的并发修复会合并为一个 repair promise，避免 API/CLI 同时触发时互相覆盖临时文件。
4. 缺失、JSON 损坏、schema/world 不匹配或与当前原文 hash 不一致的章节目录，会调用 `analysis/build-corpus-index.mjs` 从该世界实际解析到的 `original.txt` 自动重建。历史宇宙只把自己的 bounded `original.txt` 传给构建脚本，不会读取父项目完整原著生成目录。
5. 修复缓存同时指纹化原文、章节目录、索引文件内容和 chunker 版本；相同大小且保留 mtime 的索引损坏也不会命中旧缓存。
6. 任何 canonical 索引修复都会使依赖旧 chunk 映射的派生故事分析与 annotations 失效，避免新旧数据混用。

仍然必须 fail closed 的情况只有权威输入本身无法安全恢复，例如 `original.txt` 不存在/不可读、目录标题无法在原文中验证、章节边界行号无法确定，或故事宇宙的历史起点无法证明。此时系统不能猜测正文或放宽时点隔离；错误应明确指出缺失的权威输入，而不是要求用户盲目重新 ingest。

本节记录的是代码改造范围，不代表 GitHub Actions 已通过；需要在仓库运行测试套件后确认。


## 9. 同一卷内重复同名章节导致对齐丢失（2026-11-09）

针对“离线原文切片重建后仍缺少章节：第八章 爻”的进一步检查发现，当前 `analysis/conghuoniao/chapter-index.json` 第 5 卷有两条同名记录：

| sequenceInVolume | printedNumber | title | line |
|---:|---:|---|---:|
| 8 | 8 | 第八章 爻 | 18841 |
| 9 | 8 | 第八章 爻 | 19125 |

两条记录的行号相差 284 行，目录后续章节从 sequence 10 / 第九章开始。构建器按物理标题行扫描，因此会将两个同名标题都登记为章节边界；目录验证器会在运行时逐条核对行号对应的正文标题及 sourceHash。当前 Git 仓库未跟踪 `original.txt`，所以不能仅凭仓库文件直接展示这 284 行正文；实际运行时必须以本地原文及其 hash 验证结果为准，不能擅自合并或删除其中一条目录记录。

真正导致重建后仍然丢章的代码缺陷在 `alignCanonChapterGroups()`：旧实现只按 `chunk.chapter` 标题合并相邻切片，没有把已验证的 `chapterStart` 纳入分组身份。连续出现的两个“第八章 爻”切片因此被合并成一个组；组内同时包含两个不同的原文起始偏移，随后又无法匹配任一目录项。自动重建虽然分别生成两组切片，后续对齐时仍会再次合并。

修复：分组键改为“章节标题 + 已验证的 chapterStart”。同名标题但起始偏移不同的切片保持为独立组；旧切片均没有 chapterStart 时仍保留旧的连续分组行为，并继续遵循重复标题的 fail-closed 规则。新增回归测试覆盖同一卷内连续重复同名章节、两组正文覆盖校验及后续章节对齐。

本次代码提交：
- `7f4771d8c7733e1f06d6e7509885e83a3c338151` — 修复同名章节分组。
- `3cca5f691a67baf5b18e76cf5ab43b7dd7c5ddd7` — 增加重复标题回归测试。
- ` ${tu.result.commit_sha} ` — 清理测试 fixture。

测试尚未在仓库环境执行；GitHub Actions 状态需另行确认。
