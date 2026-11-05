# 多 Agent 文本分析协议

分析对象是本地全文 `original.txt` 与已入库的检索库。每个 Agent 只负责一个视角，读取自己的 `input.md`，把成稿写入同目录的 `output.md`，不改写其他 Agent 的文件，也不改写 `worlds/` 下的正史资料。

| Agent | 目录 | 职责 |
|---|---|---|
| 主线剧情 Agent | `main-plot/` | 梳理全书主线推进、卷间因果与长期情节线，判断结构如何变化。不写正文，不新增设定。 |
| 创意剧情 Agent | `creative/` | 基于原文未展开的边角，提出可写的衍生与续写方向，标明证据、冲突、代价和风险。不写正文，不把建议写成已发生的正史。 |
| 文风 Agent | `style/` | 分析叙事方式与语言节奏，产出可检查的抽象写作约束。不复制原句，不要求模仿特定作者的标志性表达。 |
| 人物与关系 Agent | `characters/` | 分析人物动机、信息边界、关系代价与声音差异，核对能力面板和身份变化。 |
| 世界观与连续性 Agent | `continuity/` | 核对果实规则、数值、时间线与证据口径的一致性，产出续写必须遵守的硬约束清单。 |

执行顺序：先运行 `prepare` 生成输入包，再由各 Agent 独立分析并写入 `output.md`，最后运行 `collect` 校验并汇总。`status` 可随时查看哪些角色尚未交稿。
collect 默认读取本地 original.txt，核对引用行是否真实存在且非空，只做确定性校验；缺失原文或行数不一致时该角色不通过。加 --evidence-review 才会用独立模型逐段判断引用原文是否支持结论，模型调用失败或任一段不支持时该角色不通过。

```bash
npm run dev -- analyze-world --world conghuoniao --phase prepare
npm run dev -- analyze-world --world conghuoniao --phase status
npm run dev -- analyze-world --world conghuoniao --phase collect
```

输入包与输出文档都随代码提交，便于复核每个结论的依据。分析结论是工作记录，不自动等于原著正史；`collect` 只做格式与证据密度校验，不判断观点对错。
