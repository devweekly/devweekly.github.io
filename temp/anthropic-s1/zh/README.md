# S-1 中文全译（分章）

`../anthropic-s1.zh.md` 是合并后的单文件全译；本目录保留分章版本，便于单独引用与维护。

## 体例

见 `_STYLE.md`。要点：原文一段对译文一段，不合并、不概括；数字原样；`$` 后为空处标注“（原文留白）”；
译名统一用「本公司」指 we/us/our；引号用中文双引号。

## 规模

| 项 | 值 |
| --- | --- |
| 英文原文 | 1,364,665 字符 / 238,410 词 |
| 中文全译 | 469,614 字符 / 317,310 汉字 / 6,737 行 |
| 章节单元 | 32 个文件 |
| 覆盖 | 实质章节逐段全译 |
| 未译 | 税务后果、未来可售股份的分销安排细则、Part II 附件与展品清单、承销协议全文附录 |

## 单元清单

| 文件 | 内容 |
| --- | --- |
| `defined-terms.md` | 若干定义术语 |
| `prospectus-summary.md` | 招股说明书摘要 |
| `governance-summary.md` | 本公司治理结构及其目标（摘要部分） |
| `risk-factors-1.md` … `risk-factors-5.md` | 风险因素 |
| `forward-and-market.md` | 前瞻性陈述、行业与市场数据等 |
| `capitalization.md` | 募集资金用途、股利政策、资本化、摊薄 |
| `mdna-1.md` … `mdna-3.md` | 管理层对财务状况与经营成果的讨论与分析 |
| `business-1.md` … `business-4.md` | 业务 |
| `governance.md` | 本公司治理结构及其目标 |
| `management.md` | 管理层 |
| `exec-compensation-1.md` … `exec-compensation-2.md` | 高管薪酬 |
| `related-party.md` | 关联方交易 |
| `principal-stockholders.md` | 主要股东与售股股东 |
| `capital-stock-1.md` … `capital-stock-2.md` | 股本说明 |
| `shares-eligible.md` | 未来可售股份 |
| `underwriting-1.md` … `underwriting-2.md` | 承销 |
| `financials-1.md` … `financials-4.md` | 合并财务报表及附注 |

## 重新生成

```bash
python3 convert.py anthropicpbc-sx1.htm anthropic-s1.en.md   # HTML → Markdown
python3 split.py                                             # 按章切到 zh/_src/
```

`_src/` 是从 `anthropic-s1.en.md` 切出来的中间产物，不入库。
