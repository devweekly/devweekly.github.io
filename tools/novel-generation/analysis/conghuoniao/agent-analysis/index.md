# 多 Agent 文本分析结果

世界：`conghuoniao`；语料：`original.txt`（118089 行）。各 Agent 的分析成稿写入对应目录，输入包与校验规则见 `PROTOCOL.md`。

| Agent | 成稿 | 字数 | 证据行号 | 语义核验 | 校验 |
|---|---|---:|---:|---|---|
| 主线剧情 Agent | [`main-plot/output.md`](./main-plot/output.md) | 1800 | 56 | 未执行 | 通过 |
| 创意剧情 Agent | [`creative/output.md`](./creative/output.md) | 1792 | 52 | 未执行 | 通过 |
| 文风 Agent | [`style/output.md`](./style/output.md) | 1778 | 52 | 未执行 | 通过 |
| 人物与关系 Agent | [`characters/output.md`](./characters/output.md) | 1795 | 33 | 未执行 | 通过 |
| 世界观与连续性 Agent | [`continuity/output.md`](./continuity/output.md) | 1783 | 83 | 未执行 | 通过 |

全部角色已交稿并通过格式、证据密度与引用行号校验。逐段语义核验可用 --evidence-review 开启；引用前仍应按行号复核。
