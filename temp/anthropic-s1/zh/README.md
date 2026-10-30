# S-1 中文全译（分章）

`../anthropic-s1.zh.md` 是合并后的单文件全译；本目录保留分章版本，便于单独引用与维护。

## 体例

见 `_STYLE.md`。要点：原文一段对译文一段，不合并、不概括；数字原样；`$` 后为空处标注“（原文留白）”；
译名统一用「本公司」指 we/us/our；引号用中文双引号。

## 规模

| 项 | 值 |
| --- | --- |
| 英文原文 | 1,364,665 字符 / 238,410 词 / 7,565 行 |
| 中文全译 | 496,413 字符 / 333,351 汉字 / 7,244 行 |
| 章节 | 36 章 / 424 小节 / 1,597 表格行 |
| 覆盖 | 英文源 7,565 行全覆盖，无遗漏区间 |

## 单元清单

| 文件 | 内容 |
| --- | --- |
| `00-front-matter.md` | 封面、S-1 表格注册声明抬头、招股书封面、目录表 |
| `defined-terms.md` | 若干定义术语 |
| `prospectus-summary.md` | 招股说明书摘要 |
| `governance-summary.md` | 本公司的治理结构及其目标（摘要部分） |
| `risk-factors-1.md` … `risk-factors-5.md` | 风险因素 |
| `forward-and-market.md` | 前瞻性陈述、行业与市场数据 |
| `capitalization.md` | 募集资金用途、股利政策、资本化、摊薄 |
| `mdna-1.md` … `mdna-3.md` | 管理层对财务状况与经营成果的讨论与分析 |
| `business-1.md` … `business-4.md` | 业务 |
| `governance.md` | 本公司的治理结构及其目标 |
| `management.md` | 管理层 |
| `exec-compensation-1.md` … `exec-compensation-2.md` | 高管薪酬 |
| `related-party.md` | 关联方交易 |
| `principal-stockholders.md` | 主要股东与售股股东 |
| `capital-stock-1.md` … `capital-stock-2.md` | 股本说明 |
| `shares-eligible.md` | 未来可出售股份 |
| `tax.md` | 对美国境外持有人的重大美国联邦所得税后果 |
| `underwriting-1.md` … `underwriting-2.md` | 承销 |
| `financials-1.md` … `financials-4.md` | 合并财务报表及附注（含“其他信息的获取途径”） |
| `18-back-matter.md` | 法律事项、独立会计师变更、专家 |
| `19-part-ii.md` | Part II：诉讼、发行费用、赔偿条款、展品清单、签字页 |

## 重新生成

```bash
python3 convert.py anthropicpbc-sx1.htm anthropic-s1.en.md   # HTML → Markdown
python3 split.py                                             # 按章切到 zh/_src/
python3 assemble.py                                          # 合并成 anthropic-s1.zh.md
pandoc anthropic-s1.zh.md -f gfm -t html5 -s \
  --metadata title="Anthropic S-1 中文全译" -o preview.html   # 带图片的 HTML 预览
```

`_src/` 是从 `anthropic-s1.en.md` 切出来的中间产物，不入库。

## 图片

原文 42 张设计版式页（封面、章节隔页、图版跨页），5100×6600、300 DPI，共 156 MB。
正文引用一律指向 `images/` 下的原图，不做压缩与缩放。

原图体积超过仓库承受范围，故未入库；可由 `SOURCE.md` 里的 EDGAR 索引页重新下载，
或在本地打开 `preview.html` 查看。
