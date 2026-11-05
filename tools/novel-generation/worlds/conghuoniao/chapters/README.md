# 续写成稿归档

本目录存放 `write` 流水线跑出的章节正文，全部是**项目原创续写**，不是《从姑获鸟开始》原著正文，也不进入 `canonFacts` 正史索引。章节标题沿用原文末卷第二十八章的上下篇标记，用于定位接续点，不代表该章由原作者所写。

## 001 · 此土佛法不足言（下）

- 运行时间：2026-11-05；运行目录 `.output/conghuoniao/2026-11-05T11-04-51-440Z/`
- 命令：`npm run dev -- write --world conghuoniao --mode continuation --brief "..." --source ./private/continuation-excerpt.md --context ./private/continuity-summary.md --max-words 3000 --retrieval-limit 6`
- 模型链：`hy4free` → `deepseek-v4.1-flash`；阶段文件与终审正文均在 `.output/` 的运行目录里，不随代码提交（含原文检索片段）
- 接续点：卷 17 末，联合舰队被暴风雨与旋涡瓦解、天保仔被天母带走（L118031、L118037）

| 文件 | 内容 |
|---|---|
| `chapter-001.md` | 终审正文，约 1400 字；查小刀在龙头空缺后压下异心、红旗帮五路按期拔营前往婆罗州 |
| `continuity-review-001.md` | 连续性 Agent 的问题清单与最小修复建议 |
| `state-proposal-001.json` | 状态管理员提取的合并后状态，未应用 |

连续性审查判定无 blocker，一处 major（胡百灵提前知道查小刀试探会话的频次）与两处 minor 已由终审修订处理；正文里对应句子已改为不带确认的写法和「岸上传来的话说」。审查还逐条核对了秀儿果实编号、神庭之路状态、卷 14「太岁」指丹娘、脱落两说、与共者惩罚不触发等硬约束。

`state-proposal-001.json` 只作提案：`write` 默认不覆盖 `story-state.json`，正史状态仍停在卷 17 末并保留 `L####` 证据。核对提案后再决定是否用 `--apply-state` 推进状态。
