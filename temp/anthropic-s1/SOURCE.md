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
| `anthropic-s1.en.md` | HTML 转出的英文 Markdown（约 1.6 MB / 7,800 行 / 33 个章节标题 / 1,400+ 表格行） |
| `anthropic-s1.zh.md` | 中文版（精译 + 结构化整理，非逐字全文；覆盖范围见文件开头表格） |

转换方式：自定义 DOM 解析器重建段落（SEC 用绝对定位 `<div>` 逐行排版，通用转换器会输出满屏 `::: {style=...}`），
表格转为 GFM 管道表并对齐数值列，图片重写为 `![](images/…)`。

## 读取说明

- SEC 原生格式是 HTML，**没有官方 PDF**。用浏览器打开后「打印 → 存为 PDF」即可离线保存（14 MB，打印预览需等十几秒）。
- 封面仍是 `Subject To Completion`：发行股数、价格区间、承销折扣均留空，这些数字要等 **S-1/A 修正文件**。
- 本目录 `index.htm` 是文件清单页快照，可用于核对附件清单。
- 抓取时需带可识别的 User-Agent，否则 SEC 返回 403。
