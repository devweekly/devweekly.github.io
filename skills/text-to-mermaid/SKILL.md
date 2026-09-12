---
name: text-to-mermaid
version: 1.0.0
description: 把 Markdown 文章里的 ASCII 伪图（text 代码块画的流程、堆叠、树）转换成真正的 mermaid flowchart 图。适用于 text 伪图难读、希望全站统一为可渲染图的文章。
---

# Text 伪图转 Mermaid

## Goal

消灭 ` ```text ` 画的伪图，换成可渲染的 ` ```mermaid flowchart ` 图（或 markdown 表格，见规则 5）。

> **只换表达形式，不增删节点语义，不改正文、标题、表格、引用、链接。**

`yaml` / `json` 块（契约、配置、数据）原样保留，不属于“图”。

## 前置检查

页面上的 copy-code 按钮脚本不得向 `pre.mermaid` 内注入按钮文本，否则 mermaid 会把按钮文字（如 "Copy"）当成节点解析，导致全站性 `Parse error ... got 'NODE_STRING'`。copy 按钮的选择器必须是 `pre:not(.mermaid)`。

参考修复：`src/layouts/PostDetails.astro` 的 `attachCopyButtons()`。

## 映射规则

1. 纵向 `↓` 链 / 横向 `→` 链 → `flowchart TD` / `LR`，箭头写 `-->`，节点文字原样保留。
2. `+` 堆叠的成分罗列 → `flowchart TB/LR` 并列节点，每个成分一个节点，不加边（声明即显示）。原文没有总概念就不要创造；表示“组成”时可用无向边 `---` 连到总节点。
3. 缩进树（`├─` `└─`）→ 父节点 `-->` 每个子节点。
4. Before / After、两种做法对比 → 一个图里的两个 `subgraph`（如 `subgraph BEFORE` / `AFTER`），或保留正文中的“不要 / 正确方式”，只转链本身。
5. ASCII 对仗矩阵（含 `─` `│` `┌` 等制表符、多列对齐对照）→ 不要硬转 mermaid，改成 markdown 表格，内容逐字保留。转图会丢失对仗信息，反而更难懂。
6. 单行 `X → Y` → `flowchart LR` 双节点图。
7. 只有 1–2 个词、无任何连接符的极简块 → 单节点或双节点小图，不要删除。

行内注释如 `← 基本单元` → 转成 mermaid 注释行 `%% 基本单元`，不许留在标签里。

## 小屏布局规则（所有节点挤在一行时必须处理）

mermaid 会把无边节点集、长 LR 链、同级多子扇出排成一行，小屏上被压到无法阅读。按以下三条纵排化（已验证可行）：

- R1 无边节点集（≥2 个节点、零边）：方向用 TD，把声明按文档顺序用隐形边 `~~~` 串起来，附在块末尾（如 `A ~~~ B`），渲染为纵向一列。
- R2 长 LR 链（>4 个节点）：方向改 TD，原边结构不动，链条自然变纵向。≤4 节点的短 LR 保持不动。
- R3 多子扇出（同一父节点 ≥5 个子节点）：保留真实边，把子节点按文档顺序用 `~~~` 串起来（如 `C1 ~~~ C2`），子节点级联纵排；≤4 个子的扇出保持不动。
- `~~~` 隐形边只影响布局、不改变语义；追加在块末尾顶层即可（即使节点在 subgraph 内也合法）；已有 `~~~` 的块跳过。

## Mermaid 语法铁律（mermaid v11，违反则渲染失败）

- 每个图第一行是方向声明（`flowchart TD` 或 `LR`），全站统一只用 flowchart，不用 mindmap / sequenceDiagram / classDiagram。
- 所有节点标签一律用双引号：`A["中文 / English (括号) ?"]`；原文含双引号的改成单引号。
- 节点 ID 用 `A B C …`，同一图内唯一；不同图可重复。
- 标签里不许出现 `<>`（如 `<model>@<version>` 改写成 `model@version`）、不许出现 `-->`；`→` `↓` `←` 不许出现在标签里（方向只用图的边表达）。
- 边标签 `|Approve|`、`|needs approval|` 原样保留。
- 菱形条件节点用 `D{"xxx?"}` 形式。
- `<br/>` 可用于标签内换行；`/` `()` `?` `:` `=` `,` 在引号内安全。

## 大文件策略

超过约 1500 行时，按行号切成多块（块边界不得切断 fenced 代码块），多块并行转换后按顺序拼接。

## 校验（写回后必须执行）

1. 残留 ` ```text ` 数量为 0（允许转为表格的个案）；`yaml` / `json` 块数量不变。
2. 标题逐字同序（同 article-de-ai 校验第 1 条）。
3. 全量渲染验证：dev 预览页统计 `pre.mermaid` 总数 = 渲染出 `svg` 的数量，且 0 parse error。注意 mermaid 是客户端渐进渲染，需等待数秒后复数一次。
4. `astro build` 通过。

注意：Node 直调 `mermaid.parse()` 在无 DOM 环境下会报 `DOMPurify.addHook is not a function`（即使图合法），该方法不可用，以浏览器实测为准。
