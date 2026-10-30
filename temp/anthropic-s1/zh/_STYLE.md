# 翻译体例（S-1 中文版）

本目录是 `temp/anthropic-s1/anthropicpbc-sx1.htm`（Anthropic, PBC Form S-1，2026-10-26 提交）的简体中文全译。
源文本是 `../anthropic-s1.en.md`，按单元切分在 `_src/`。

## 硬性要求

1. **逐段对应**：原文一段，译文一段。不合并、不拆分、不概括、不省略、不补充。
2. **保留结构**：`#`/`##`/`###` 标题层级原样保留（标题也要译）；GFM 表格保留管道结构，只译文字单元格。
3. **保留数字**：金额、百分比、日期、股数、页码一律照抄，不做换算、不做四舍五入。原文写作 `$525 million` 就写 `5.25 亿美元` 或 `$525 million`？——统一用 **`5.25 亿美元`**，但表格内保持 `$525` 原样。
4. **留白标注**：原文 `$` 后为空（`Subject To Completion` 未填数字）时，写 `$（原文留白）`，不要猜。
5. **图片**：`![](../images/xxx.jpg)` 原样保留，不加图注。
6. **强调**：`**加粗**`、`*斜体*` 保留在对应的译词上。
7. **不加译者注**：不写「注：」「按：」，不解释背景，不评价。

## 语言

- 招股书语体：书面、克制、陈述句。不用「我们」，用「**本公司**」指 we/us/our；`you` 译作「**投资者**」。
- 长句可拆，但**不得改变命题**：条件、限定、否定、程度词必须逐一落地（"materially", "could", "may", "believes", "expects" 都要译出来）。
- 不用口语词（「搞定」「其实」「基本上」）；不用感叹号。
- 专有名词首次出现时「中文（英文）」，之后只用中文；产品名与人名保留英文。

## 术语表

| 英文 | 中文 |
| --- | --- |
| Anthropic, PBC | Anthropic, PBC（不译） |
| Class A / N / T / F / E common stock | A 类 / N 类 / T 类 / F 类 / E 类普通股 |
| Long-Term Benefit Trust (LTBT) | 长期利益信托（LTBT） |
| Founder LLC | 创始人 LLC |
| public benefit corporation | 公益公司 |
| controlled company | 受控公司 |
| the offering | 本次发行 |
| prospectus | 招股说明书 |
| selling stockholders | 售股股东 |
| underwriters | 承销商 |
| beneficial ownership | 实益所有权 |
| board of directors | 董事会 |
| Class T directors | T 类董事 |
| trustee | 受托人 |
| RSU | 限制性股票单位（RSU） |
| stock option | 股票期权 |
| Non-GAAP | 非 GAAP |
| Net Revenue Retention | 净收入留存率 |
| Annualized Revenue Run-rate | 年化收入运行率 |
| compute | 算力 |
| frontier AI | 前沿 AI |
| inference | 推理 |
| enterprise | 企业客户 / 企业级（按语境） |
| go-to-market | 市场推广 |
| total addressable market | 潜在市场总额 |
| Claude Platform / Claude Code / Claude Cowork | 保留英文 |

## 交付

- 输出到 `zh/<单元名>.md`，单元名与 `_src/<单元名>.md` 一致。
- 文件首行加一级标题（章名），例如 `# 风险因素`。**若源文件开头本身有一节标题（如 `## Risk Factors`），译完会与这个一级标题重复，删掉重复的那一个。**
- 引号统一用中文双引号 `“”`，不用 `「」`。
- 译完自查：段落数与源文件一致；表格行数一致；没有整段漏译。
