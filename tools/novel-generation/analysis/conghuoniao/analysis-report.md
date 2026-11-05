# 《从姑获鸟开始》全文分析报告

基于用户提供的本地全文 `original.txt` 完成结构分析、设定提取与世界资料生成。语料、证据口径和版权边界见 `sources/local-corpus-analysis.md`，规则与人物细节分别落在 `worlds/conghuoniao/` 下的五份文档。

## 分析结果

全文 118,089 行、去除空白后 1,915,796 字，按章号重置切分为 17 卷、753 章。第一卷 42 章与公开目录一致；公开平台检索索引称全书 787 章，本地文本末卷停在「第二十八章 此土佛法不足言（上）」，两者差异不能用来推算缺失章节。30 个章节标题带行首缩进，若按行首严格匹配会并入前一章，章节正则与导入器已同步调整。

卷的结构呈现事件与回归交替：长卷进入果实世界，短卷回到 `天·甲子九` 做结算、规则说明与组织协商。卷 1、3、5、7、9、11、13、15、17 承载主要事件，其中卷 11 是卷 3 果实的七年后再入，卷 17 是卷 7 南洋线的六年后再入。把每个短卷当成独立果实会与原文冲突。

设定提取收敛为六组可核对的规则：果实编址与命名、事件结算与评价、传承与位阶、行走之间的关系、十主与思凡两套秩序、忍土与身份维持。证据主要来自结算报告、系统面板、人物对话和 L12187 的作者单章「本书力量体系和身份划分」。人物在对话里对五仙五虫路线、果实序列和宇宙论的归纳都标为人物推断，未升级为正史。

## 产出

| 文件 | 内容 |
|---|---|
| `analysis/build-corpus-index.mjs` | 可复跑的卷章索引与语料画像生成器 |
| `analysis/conghuoniao/chapter-index.json` | 17 卷 753 章的标题、行号、字数与公开调查差异 |
| `analysis/conghuoniao/corpus-profile.json` | 字数分布、术语频次、果实编号频次、卷间插入段 |
| `analysis/conghuoniao/volumes.md` | 卷结构对照表 |
| `worlds/conghuoniao/world-bible.md` | 世界参考，替换只依赖公开资料的启动版索引 |
| `worlds/conghuoniao/yanfu-system.md` | 阎浮体系规则表，含数值、身份划分与现实约束 |
| `worlds/conghuoniao/fruit-worlds.md` | 17 卷的果实映射与主要世界规则差异 |
| `worlds/conghuoniao/characters.md` | 人物身份、面板数值与关系结构 |
| `worlds/conghuoniao/timeline.md` | 卷序事件线、时间跨度与连续性约束 |
| `worlds/conghuoniao/style-profile.md` | 抽象叙事特征，不复制原句与标志性表达 |
| `worlds/conghuoniao/story-state.json` | 写作状态初始化，止于卷 17 未完结处 |
| `sources/local-corpus-analysis.md` | 语料来源、切分方法、证据等级与使用边界 |

`original.txt` 已加入 `.gitignore`，与 `worlds/*/library/`、`worlds/*/story-state.json`、`private/` 一起留在本地，不进入版本库。表中的 `story-state.json` 因此是本机工作文件，不是随代码交付的内容。

## 工具链状态

`tsconfig.json` 补上 `"types": ["node"]`，TypeScript 7 下 `npm run typecheck` 不再报找不到 `process` 与 Node 命名空间。`src/library.ts` 的章节标题正则允许行首缩进，重新导入得到 2,594 个检索片段。`test/library.test.ts` 中「旧线索」的断言改为检查旧片段确实被移除：中文二元组是近似匹配，「线索」命中「新线索」属正常召回，原断言把检索器行为误当成数据残留。三项测试现全部通过。

`npm run dev -- analyze` 在限时 90 秒的试跑中没有返回抽取结果，也未写出 `annotations.json`。逐片段模型抽取涉及 2,594 次调用，本轮改用确定性结构分析加关键章节精读，实体、事件、关系的候选标注仍为空。跨章节别名归并、共指消解、人物状态时间序列和伏笔生命周期分析因此没有完成，设定文档里相关位置标为待核实。

## 验证

`npm run typecheck` 无错误，`npm test` 3/3 通过，`ingest` 与 `search` 可用。章节索引与导入索引分别按 753 章和 2,594 片段生成，行号与卷范围互相吻合；世界文档中的 `L####` 证据已按行号抽查结算报告、作者单章、位阶说明和果实编号段落。设定文档只保留短引文与行号，不复制章节正文。

本次改动都在 `tools/novel-generation/` 内，Astro 站点源码没有修改，未运行站点构建。

## 待核实

全书是否完结及末卷之后的情节；十主与思凡八苦的完整名单及更替；十类传承各自的能力边界；三清、四御的评定条件；卷 11 中 `鳞·丁寅二十四` 与 `鳞·丁酉二十四` 是否同一果实；卷 15 香港属于 `天·甲子九` 还是 `地·甲子二百五十九`；白叔的身份与结局。上述条目在本地全文中找不到足以定论的表述，未补写。
