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

## 002 · 搬空大屿山

- 运行时间：2026-11-05；运行目录 `.output/conghuoniao/long-2026-11-05T13-04-56-213Z/`
- 命令：`NOVEL_AGENT_CONFIG=./private/kimi.config.json npm run dev -- write-long --world conghuoniao --mode continuation --model kimi-k3.1-pro --max-words 8000 --scenes 8 --timeout-ms 420000 --source ./private/continuation-excerpt.md --context ./private/continuity-summary.md --brief "..."`
- 模型：`kimi-k3.1-pro`（credits 0.97）全程写作；计划、成文、审查、修订都用这一路模型，推理档由 `private/kimi.config.json` 单独设定（plan/scene/review 为 adaptive/medium）
- 接续点同上：卷 17 末，天保仔被天母带走、联合舰队被暴风雨与旋涡瓦解

| 文件 | 内容 |
|---|---|
| `chapter-002.md` | 八场正文拼章，约 9,860 字；龙头空缺后头三天，红旗帮清点船粮、压住异心、定下南下路线与澳门火药线 |
| `continuity-review-002.md` | 连续性 Agent 对八场正文的问题清单，3 处 major、若干 minor |

八场逐场生成，每场约 1,150 字目标。修订阶段（逐场对白与文风）跑到第 1 场就停了：修订把单场字数从 1,032 翻到 2,052，照此下去整章会到一万九千字，与 8,000 字的目标不符。因此本章交付的是八场原稿拼合，没有经过文风统一。

这份审查由旧的逐维度契约生成（61 条、9,136 字，其中 75% 是「通过项」），仅作记录；终审契约已改为只报读者会认定「不可能」的硬伤，最多 3 条，其余不报，见项目 README 第 5 节。审查提出的 3 处 major 已按最小修复改在正文里：会话次数补明「半个月每日一次、到岛三日三次」；查小刀说出的澳门切口补上来源（缴来旧船契背面）；阮七夺仓动刀时由郑秀当场下令格杀，把「杀头领不得自专」的例外写清。另有一处时间指代（「白日发的是假时刻」）改成「白日说二更开仓，你们提前两个时辰来」。

节奏指标（同一口径，全书抽样为均长 22.0、短句 31.9%、长句 25.3%、超长句 4.7%、对白行 25.4%、句均逗号 1.16）：本章均长 26.5 字、短句 28.2%、长句 32.3%、超长句 9.7%、对白行 36.5%、句均逗号 1.99、问号感叹号每千字 16.2。和此前 deepseek 的成稿相反，这一版不是短句堆叠，而是长句偏多、逗号串联偏密，均长比全书高 4.5 字。
