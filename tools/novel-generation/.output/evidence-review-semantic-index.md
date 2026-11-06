# 多 Agent 文本分析结果

世界：`conghuoniao`；语料：`original.txt`（118089 行）。各 Agent 的分析成稿写入对应目录，输入包与校验规则见 `PROTOCOL.md`。

| Agent | 成稿 | 字数 | 证据行号 | 语义核验 | 校验 |
|---|---|---:|---:|---|---|
| 主线剧情 Agent | [`main-plot/output.md`](./main-plot/output.md) | 1800 | 56 | 0/6 通过 | 6 段结论未通过原文证据核验 |
| 创意剧情 Agent | [`creative/output.md`](./creative/output.md) | 1792 | 52 | 0/6 通过 | 6 段结论未通过原文证据核验 |
| 文风 Agent | [`style/output.md`](./style/output.md) | 1778 | 52 | 0/4 通过 | 4 段结论未通过原文证据核验 |
| 人物与关系 Agent | [`characters/output.md`](./characters/output.md) | 1795 | 33 | 0/5 通过 | 5 段结论未通过原文证据核验 |
| 世界观与连续性 Agent | [`continuity/output.md`](./continuity/output.md) | 1783 | 83 | 3/10 通过 | 7 段结论未通过原文证据核验 |

存在未通过项，见上表；补齐后重新运行 `collect`。
