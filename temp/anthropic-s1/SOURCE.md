# Anthropic, PBC — Form S-1（来源与校验）

| 项 | 值 |
| --- | --- |
| Registrant | Anthropic, PBC（Delaware，CIK 0002130357） |
| Form | S-1（Securities Act of 1933 注册声明） |
| Filed | 2026-10-26 |
| Accession No. | 0001628280-26-067168 |
| 主文档 | `anthropicpbc-sx1.htm` |
| 大小 | 14,169,253 bytes（14 MB，HTML） |
| SHA-256 | `120dbe284a74480da170c5af8b6b77d5ed91e22b8225c942e3f0b3a8964e79b3` |
| 下载时间 | 2026-10-30 12:46 GMT+8 |

## 官方地址

- 文件清单页（87 个文档，后续 S-1/A 会追加在此）：https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/0001628280-26-067168-index.htm
- 正文（本目录 `anthropicpbc-sx1.htm`）：https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm
- 完整提交包（224 MB，含全部附件与图表）：https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/0001628280-26-067168.txt

## 本目录产物

| 文件 | 说明 |
| --- | --- |
| `anthropicpbc-sx1.htm` | SEC 原文（HTML，14 MB） |
| `index.htm` | EDGAR 文件清单页快照 |
| `images/` | 原文内嵌的 42 张 JPG（156 MB），含封面与各章节整页大图 |
| `anthropic-s1.en.md` | HTML 转出的英文 Markdown（1,364,665 字符 / 238,410 词 / 24 个 `##`、521 个 `###` 标题 / 1,464 表格行 / 43 张图引用） |
| `anthropic-s1.zh.md` | 中文全译（469,614 字符 / 317,310 汉字 / 32 章）；实质章节逐段全译，未译税务后果与 Part II 附件 |
| `zh/` | 分章中文版（32 个文件）、`_STYLE.md` 体例与术语表、`README.md` 清单 |
| `convert.py` | HTML→Markdown 转换器（段落重建 + 加粗/斜体还原 + 表格 + 图片） |
| `split.py` | 按 6 万字符把英文稿切成译制单元 |

转换方式：自定义 DOM 解析器重建段落。SEC 用绝对定位 `<div>` 逐行排版，每个视觉行是一个 div，
通用转换器（pandoc）会把段落全部断在视觉行边界上，并把加粗的小标题并进正文。这里按 `top` 的行距
判断段落（段内行距 ≈ 字号 × 1.2，段间明显更大），按 `<font>` 的 `font-weight`/`font-style` 还原
`**`/`*`，两个 font 之间是否要空格由 `left + width` 的几何间隙决定（否则 `selected` 会被拆成 `se lected`）。
表格转为 GFM 管道表并丢弃全空对齐列，图片重写为 `![](images/…)`。

## 读取说明

- SEC 原生格式是 HTML，**没有官方 PDF**。用浏览器打开后「打印 → 存为 PDF」即可离线保存（14 MB，打印预览需等十几秒）。
- 封面仍是 `Subject To Completion`：发行股数、价格区间、承销折扣均留空，这些数字要等 **S-1/A 修正文件**。
- 本目录 `index.htm` 是文件清单页快照，可用于核对附件清单。
- 抓取时需带可识别的 User-Agent，否则 SEC 返回 403。
