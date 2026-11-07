# 从火鸟续写流水线：2026-11-07 运行与产物分析

分析对象是今天（11 月 7 日）实际发生的两次章节生成运行、它们写入的数据库与仓库状态，以及为支撑生成而做的语料导入。结论来自本机 `.output/`、`worlds/`、`git` 历史和源码的当前内容，未使用测试数据或推测性复现。凡是需要进一步确认的动机和意图，文末单独列出。

## 结论先说

三件事需要优先处理，其中第一件与小说本身无关但风险最高。第二次运行另有一个流程卡点：状态提取失败退出，见"第三十章"一节。

`worlds/conghuoniao/library/index.json` 装着 2594 个切片、2,665,573 个汉字的原著全文，已被 Git 跟踪，而远端 `devweekly/devweekly.github.io` 的可见性是 PUBLIC，`origin/main` 与本地 `main` 完全同步。AGENTS.md 自己写明"提交到公开仓库前须确认授权"，这一步没有留下任何确认记录。

第二件是今天 10:42 的一次重新导入把全书知识分析从 `novel.db` 里清掉了，并且随 commit `4cf0be3d`（10:58）一起推送到了 GitHub。清掉的内容包括唯一的完整快照（`analysisVersion=4`、196 批、`analyzedAt=2026-11-05T16:27:30Z`）、753 章的章节表和全部派生表。这次重新导入在内容上是空操作——新旧索引的 2594 个 chunk ID 与文本逐条相同。

第三件是今天两章的终审都只跑了一轮就判 pass，而 Anti-AI 诊断在同一批段落里明确点出了时间锚点冲突和人物在场冲突，这两处至今原样留在正文里。诊断、编辑、终审三段之间没有信息通路，诊断产出在编辑被回退后整体作废。

## 一次内容未变的重新导入，删掉了 196 批分析

`src/library.ts:181` 在导入函数末尾无条件调用 `invalidateDerivedAnalysis`，它位于"过滤旧标注"那段条件逻辑之外，只要跑 `ingest` 就必然执行。`src/database.ts:265-269` 的实现是 `DELETE FROM story_analysis; DELETE FROM novel_chapters;` 再调 `clearNovelAnalysis`（`src/database.ts:499-502`）清空 `novel_characters`、`novel_mentions`、`novel_plot_threads`、`novel_foreshadowings`、`novel_beats`、`novel_relations`、`novel_kb_meta`。

代价是否划算，取决于语料是否真的变了。用 `git show` 取出导入前后的两份 `library/index.json` 逐条比对，结果是 chunk ID 序列完全一致、2594 条 `text` 字段零差异。commit `4cf0be3d` 里 `chapter-index.json` 的 diff 只有一行 `generatedAt` 时间戳，`corpus-profile.json` 同样只有时间戳，索引文件本身 13,988 行变化来自 JSON 序列化字节（同一内容的不同换行/转义写法），`original.txt` 的 mtime 仍停在 11 月 5 日 17:24。

删库前后的行数对照：

```
commit 5008279f (11-06 14:56)  novel_chapters 753  novel_characters 544  story_analysis 1 (v4/196批)
commit 4cf0be3d (11-07 10:58)  0                    0                      0
```

`novel.db` 现在 3,010 页里 2,914 页是空闲页，`integrity_check` 为 ok，文件却仍占 12.3MB——这是一次纯 DELETE，没有 VACUUM，也没有备份。README 第 314 行原本约定"novel.db 的提交应集中在数据更新的那一次"，实际发生的是把 12MB 空洞推到了公开仓库。

## 数据库现在处于半清空状态，比它看起来更空

`db-status` 的输出会误导判断：

```
novelArcs: 17        novelCharacterProfiles: 28
novelChapters: 0     novelCharacters: 0    novelMentions: 0
novelThreads: 0      novelForeshadowings: 0  novelBeats: 0
novelRelations: 0    storyAnalysis: 0      annotations: 0
```

`clearNovelAnalysis` 的删除清单里没有 `novel_arcs` 和 `novel_character_profiles`，这两张表在 11 月 6 日由 `analyze-arcs` 和 `analyze-profiles` 产出，内容是基于那 753 章和 544 个人物算出来的。现在被引用的对象全部不存在，28 份人物档案成了悬空记录，而 `db-status` 把它们算作"有数据"。同一份输出里的 `annotations: 0` 和 `entities: 0` 不算今天的损失，删除前的库里这两项也是 0，属于 AGENTS.md 写明的已知边界（全量 `analyze` 从未执行）；今天新增的损失是 `story_analysis`、`novel_chapters` 和 `novel_mentions`（6,402 行归零）。

`novel_chapters` 至今仍是 0。这张表由 `index-story` 写入（`src/novel-kb.ts:376` 的 `syncNovelChapters`），重新导入之后没有人再跑过它，所以库里连"第几卷第几章"的书目都不存在，`story-kb --type chapters/beats` 当前查不到任何行。检索链路看起来正常，是因为 BM25 直接读 `library/index.json`，不经过这些表。

缓存这一侧没有跟着作废。`analyze-story` 的缓存键（`src/story-analysis.ts:529-535`）由 `version + promptTag + model + maxChars + batchLayout + sourceHash` 求 SHA-256，其中 `sourceHash` 取的是按章去重后的正文拼接。正文逐字未变，所以昨天 20:00–22:00 产出的 191 个 delta 批次今天仍然命中，恢复不必重跑 196 次模型调用。

## 图谱不可用的原因不止一个：版本不达标，今天又丢了快照

`src/cli.ts:441-443` 要求 `analysisVersion === 6 && complete === true` 才返回图谱，缺任何一条就抛错并提示 `--delta --merge-only`。今天实测该命令停在 `Cannot merge: 5 batch(es) missing from cache`，缺批次号 #67、#85、#97、#117、#147。

因果顺序和提示信息给的暗示不完全一致。11 月 6 日库里那份完整快照是 v4，本来也过不了 v6 这道门，所以图谱在删库之前同样不可用。今天的变化是连 v4 快照也没了，写作链路的分析注入从"版本不达标被拒绝"变成"没有任何数据可注入"。

这一点直接影响今天两章的成稿过程。`AGENTS.md` 与 ADR-0002 的设定是规划阶段按任务检索图谱节点、终审用图谱核对明确的事实硬冲突，`analysisVersion` 低于 6 时不注入也不阻塞。运行目录里的实际情况与之吻合：`chapter-15c433cb…/00-retrieval.md` 全文只有 BM25 命中的原著片段和 Story State 摘要，没有任何图谱、人物档案、情节线或 MacGuffin 区块，`01-main-plot.md` 和 `00-world-situation-context.md` 里也搜不到相关字样。两章是在只依赖原文检索和本章事实的前提下写完的。

## 两章的门禁都只走了一轮，且 Anti-AI 阶段对成品零贡献

今天完成的两章是《第二十九章 空船》（`.output/conghuoniao/chapter-15c433cb…`，13:42–13:52，2,736 字）和《第三十章 补账》（`chapter-76466e6b…`，13:53–14:02，3,001 字）。两章的 `09-quality-summary.json` 完全同构：

```
status passed · repairRounds 0 · reviews[0].status pass
summary "未发现读者会认定不可能的硬伤" · issues []
```

`07-continuity-review.md` 全文 88 字节，只有状态和这一句结论。按 ADR-0003 和"文学性优先"的既定原则，终审只抓真正妨碍读者理解的硬伤，允许放行，这个设计本身没问题。

同一运行里的 `06a-anti-ai-diagnosis.md` 第 3 条和第 4 条给出的是具体定位：第 3 条指出正文第 43 行"册子是第二天晌午才从一具尸首怀里抠出来的"之后没有新的日期分界，到第 125 行突然出现"三天过去"，读者无法判断起点是风暴当夜还是拿到册子之时，若是后者则与"第二天"直接冲突；第 4 条指出第 163 行"人散尽了，郑秀才从外面进来"把屋里清空了，而结尾第 199 行"阿细最后一个出来"要求他一直留在屋内听完郑秀那段话，这个在场状态全文没有交代。两处都在最终 `chapter.md` 里原样存在。

第 5 条针对的是代词归属：`chapter.md` 第 179 行的"自己"紧跟在另一个人物名之后，诊断的原文判断是"第一读容易落成李阎的屋子"，并给出两种处理方式——要么写清归属，要么把这层安排的意思写出来，而它认为当前文本两者都没做。终审的 `issues` 数组为空，说明这一类指代歧义不在当前门禁的处理范围内。按"只抓读者会认定不可能的必改项"的标准，这是合理取舍；后果是这条观察只存在于诊断文件里，编辑稿被 restore 之后就再也没有下游记录。

诊断报告本身也承认这个边界——它把第 3、6、7 条标为"取决于你认为那份模糊是有意留白还是失手"，没有以硬伤自居。但流水线里没有任何机制把这份判断递交给终审或修复阶段。

```
workflow.ts:273-274  诊断只作为 antiAiEditPrompt 的输入
workflow.ts:287      decision === "restore" 时 antiAiDraft = voiceDraft
workflow.ts:300      终审只拿到 initialChapter: antiAiDraft
```

于是链路是这样断的：编辑稿一旦被复核判 restore，诊断里所有条目连同编辑稿一起丢弃，终审拿到的正文与叙事声音稿逐字节相同（实测两章 `chapter.md.strip() == 06-voice-edited.md.strip()`）。两章连续出现 restore，Anti-AI 阶段实际消耗了诊断、编辑、复核三次模型调用，对成品的净改动为零。

复核的判断本身是有依据的，甚至能挡住一次真正的破坏。第 29 章的 `06c` 理由写得很具体：编辑把"还有第二个缘故，他没往深处想"改成"他心里清楚"，会把人物不去深究的处理方式改成明确的利害盘算。这个保守倾向符合"文学表达优先于统计指标"。但它和同一章诊断的第 6 条正面冲突——诊断认为"他没往深处想"这个标签与其后完整的利益推演不符，要么承认他想清楚了只是不说，要么把话停在"他要的是一个能签字的龙头"之前。两个 Agent 对同一句话给出相反判断，一个要求删掉这层自我掩饰，一个要求保护这层自我掩饰，流程里没有仲裁，结果由复核单独决定。第 30 章的 restore 理由同样落在"抹去核心意象"与"抢在下一轮问答前说出信息"这类文学判断上。

## 第三十章正文写完、终审通过，但状态提交失败

《第三十章 补账》的 `pipeline-manifest.json` 停在 `reader-experience`，没有 `state-update` 条目，目录里取而代之的是 `08-state-update-error.txt`，进程随后退出。错误记录了两轮：

```
First attempt: Character arc evidence is not present in the final chapter: 李阎 / M-LIYAN-01
Retry: foreshadowingUpdates[0].status / [1].status 不在 8 个枚举值之内
```

第一条来自 `src/story-state.ts:121-126`：状态提取提出的每个人物弧光里程碑，其 `evidence` 必须是最终正文的字面子串，`M-LIYAN-01` 这条不是。第二条是模型返回了提示词里已经逐条列出的枚举（`src/workflow.ts:419` 明确写了 8 个允许值）之外的取值，重试没有修正。

失败处理本身是对的——按子目录 AGENTS.md 的约定，状态提取或持久化失败时不得继续下一章，库里因此仍停留在 12 条事件、`currentPosition` 仍是"卷 17 第二十九章"，没有写入半条状态。代价是这一章现在是一篇孤儿正文：3,001 字通过了终审、生成了 Reader 与风格回归报告，但 Story State 完全不知道它存在。紧接着再跑一次续写，新章节会从第二十九章的状态出发，和已经写好的第三十章分叉，而且两次都会得到同一个 `00-input-story-state.json`。

这里还有一个复盘障碍：成功路径会同时保存 `08-state-update-raw.json` 和 `08-state-update.json`，失败路径只留下那段错误字符串，模型原始返回没有落盘。现在无法判断那两个 `status` 字段模型究竟写了什么，也无法判断 `M-LIYAN-01` 的证据是引用了正文之外的句子、还是把正文的句子改写了几个字。同样的信息在第 29 章的运行里是齐的，因为那一章成功了。

## 成稿没有落到正史目录，章节编号已经撞车

`workflow.ts` 的写入目标只有两处：`writeFile(resolve(dir, name))` 的输出目录（即 `.output/<run>/`）和 `saveStoryState`。没有任何代码把终审通过的正文写进 `worlds/<world>/chapters/`。

`chapters/` 目录里现在是 `chapter-001.md`（第二十八章 此土佛法不足言（下））和 `chapter-002.md`（第二十九章 搬空大屿山），最后一次改动来自较早的 commit `7c195fd5`。今天新写的《第二十九章 空船》和《第三十章 补账》只存在于被文档声明为"应排除"的 `.output/` 里。结果是一个编号冲突：正史目录已经用掉"第二十九章"，今天又产出一个"第二十九章"，`story-state.json` 的 `currentPosition` 只写了"卷 17 第二十九章：暴风雨后滩头清理……"，无法区分两者。

Story State 本身是自洽的：12 条事件里 E008–E012 精确对应《空船》的五个场景，人物 8、情线 5、备注 16，事件字段用 `position` 而不是章号。问题在正文这一侧没有权威落点，只靠 `.output/` 里的一次性目录保存。

## 仓库卫生与文档边界已经不一致

`tools/novel-generation/.gitignore` 只排除 `original.txt`、`dist/`、`node_modules/`、`.output/*/workbench/` 和 SQLite sidecar，注释还专门写着"原始语料：唯一不入库的内容"。同一子目录的 AGENTS.md 却声明 `.output/` 均被 gitignore 排除、私有原文绝不入库。以 `.gitignore` 为准的事实是：`.output/` 下已有 614 个文件被 Git 跟踪，其中包括 6 份 `00-retrieval.md`——每份都是原著长段原文的逐字摘录。今天这两章的正文、检索上下文和全部中间稿也因此进了版本库。

提交信息是另一个信号。最近的 commit 里出现了 `ddddd`、`dddddd`、`ddddd` 三条（`44e65ca7`、`6fd15c1e`、`4cf0be3d`），内容差别极大：`44e65ca7` 给 31 个源文件各加了 2–5 行文件头注释，`6fd15c1e` 提交了一批 `.output/` 中间产物，`4cf0be3d` 提交了一次会清空全书知识库的重新导入。三件事在 git 历史里没有任何可辨识的区别，也没有留下重导入的前提说明；要判断"是谁在什么条件下决定重跑 ingest"，现在只能靠文件 mtime 和 blob 大小倒推。

## 恢复路径

按依赖顺序执行，全部在 `tools/novel-generation` 目录下（`cli.ts` 用 `resolve` 把 `worlds/`、`.output/`、`analysis/` 锚定到 CWD）。

0. 先处理第三十章的孤儿正文：`npm run dev -- write --world conghuoniao --brief "<原 brief>" --max-words 3000 --resume-dir .output/conghuoniao/chapter-76466e6b-3106-4a69-a6f2-1ce51d32d982`。该运行的 `pipeline-manifest.json` 缺 `state-update` 条目，前面 12 个阶段的输入指纹未变会全部命中缓存，实际只会重试失败的状态提取。这一步我没有执行，也无法保证模型这次一定返回合规的 `status` 值；如果连续两轮同样失败，需要人工读一遍 `chapter.md` 判断证据字符串的问题在哪。恢复运行读取的是运行目录里保存的输入状态快照，即使中途崩溃也不会重复累加，这一点由 `run-info.json` 与 `00-input-story-state.json` 的机制保证。
1. 补完 5 个缺失批次并合并：`npm run dev -- analyze-story --world conghuoniao --delta`。不要带 `--shard` 或 `--limit`（`assertMergeOptions` 会拒绝），也不要改 `--model` / `--max-chars`（缓存键含这两项，换了就等于 196 批全重跑）。5 次模型调用后代码会自行走到合并，通过 `assertV6DeltaFields` 才写 `analysisVersion=6`。
2. 恢复书目与提及统计：`npm run dev -- index-story --world conghuoniao`。`indexNovelStructure` 只调 `syncNovelChapters`、`upsertSeedCharacters`、`syncNovelMentions`，不含 `clearNovelAnalysis`，所以放在合并之后跑是安全的。放之后跑的理由是 `syncNovelMentions` 里那条 `UPDATE novel_characters` 依赖人物表已有数据，才能重算 `chapters_seen` / `mention_total` / `first_chapter` / `last_chapter`。
3. 验证：`npm run dev -- db-status --world conghuoniao` 应看到 `novelChapters 753`、`novelMentions` 回到六千余行、`storyAnalysis 1`、`originalStoryGraph.complete: true`；再用 `npm run dev -- story-kb --world conghuoniao --type graph --query 李阎` 抽查图谱可读，用 `npm run dev -- verify-world --world conghuoniao` 核对 chunk 数、复核完成数与库内行数是否一致。现存 28 份人物档案会不会继续悬空，取决于键生成方式：实测 28 条 `character_id` 全部等于 `"ch_" + sha1(人物名)` 前 12 位（`character_id` 与 `name` 两列逐条重算比对通过），而 `src/story-analysis.ts:808` 合并人物时用的正是同一个式子，因此只要某个名字在 v6 批次里仍然出现，它的档案就会自动接上；名字在合并结果里落选时档案仍然悬空，需要单独重跑 `analyze-profiles`。
4. 提交前 `VACUUM`：现在 96% 的页是空闲页，直接提交等于把 12MB 空洞推上公开仓库。README 第 318 行已经写过这条约定。
5. 决定语料边界：`library/index.json` 和 `.output/` 下的原文摘录要不要继续留在 PUBLIC 仓库，需要先有授权结论。可选方向是把 `tools/novel-generation/.gitignore` 的排除范围真正覆盖到 `.output/` 与 `library/index.json`，并从历史里移除；也可以把整个工具迁到私有仓库。这一步涉及历史重写和对外可见状态，不适合由工具自动完成。

流程侧还有三项值得单独排期，但都属于设计判断而非故障：`invalidateDerivedAnalysis` 是否应该在语料哈希未变时跳过删除；`06a` 诊断结论是否应该作为独立观察产物保留（现在它随 restore 一起失效，读者看不到"编辑被拦下、但诊断确实提过这两处"这条记录）；终审通过的正文是否应该按 AGENTS.md 里 `chapters/` 属于正史资料的定位写回目录，并让 `currentPosition` 记录可区分的章节标识。

## 尚未确认

- 今天 10:42 为什么要重新导入 `original.txt`。文件 mtime 未变，索引内容未变，git 历史里的提交信息是 `ddddd`，没有找到能说明动机的记录。如果是为了验证导入器改动，那它顺带删掉了全书分析；如果是有意的数据重置，`analyze-story` 的缓存保留反而说明预期不是彻底作废。
- 第 29、30 章的编号是否与既定规划一致。`story-plan.json` 与 `chapters/chapter-002.md` 的"第二十九章"关系没有权威说明，只能看出与 `currentPosition` 不匹配。
- 分析注入缺失对成品质量的实际影响。两章在没有图谱、没有合并人物档案的条件下通过了终审，`10-reader-experience.md` 给出的反馈是正向的（愿意往下读、四个钩子具体），但这是单章盲读观察，不构成"不需要图谱"的证据。
- 第 30 章状态提取里那两个被判非法的 `status` 值具体是什么，以及 `M-LIYAN-01` 的证据字符串与正文差在哪一处。失败路径不保存模型原始返回（`08-state-update-raw.json` 只在成功时写），当前无法复盘，只能靠下一次运行验证。
- 三次 `ddddd` 提交分别想提交什么。三者内容跨度很大（源文件注释、运行中间产物、清空知识库的重导入），但提交信息完全相同。
