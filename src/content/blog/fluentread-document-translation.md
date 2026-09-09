---
author: W
featured: false
draft: false
description: 流畅阅读如何把 11 种格式拆成「结构」与「片段」两条流，翻译后无损拼回；以及 PDF 无法替换文字、只能光栅化重绘时的取色、擦除与字号自适应
pubDatetime: 2026-09-08T08:00:00Z
title: 流畅阅读（FluentRead）的文档翻译是怎么实现的
tags:
  - fluentread
  - architecture
  - translation
  - pdf
---

翻译一段话很容易，翻译一份 PDF 很难。

难不在调模型，而在**翻完之后文件还是不是那个文件**：Markdown 的标题层级还在不在，字幕的时间轴对不对得上，Word 的页眉页脚有没有被当成正文一起翻掉，PDF 的译文能不能落在原文那个位置上。

[流畅阅读（FluentRead）][1] 是个浏览器翻译扩展，它的文档翻译模块用大约 102KB、7 个文件，覆盖了 13 种扩展名、11 种格式。读完这一块代码，最值得记下来的不是它支持了多少格式，而是它把这件事收敛成了一个极其干净的模型。

## 1. 这个模块长什么样

FluentRead 是按功能切片的，`src/features/` 下面有 19 个 feature：划词翻译、全文翻译、图片翻译、视频字幕、术语表、写作助手…… `document-translation` 是其中之一 [2]。

它内部严格分三层，边界写在每个文件的头部注释里：

| 层       | 文件                           | 职责                               | 明确不做                        |
| -------- | ------------------------------ | ---------------------------------- | ------------------------------- |
| core     | `document.ts` (28KB)           | 纯领域模型、文本格式解析、无损回填 | 不读 File、不碰二进制、不发请求 |
| core     | `preview.ts` (11KB)            | 生成安全的预览 HTML                | 不操作真实 DOM                  |
| services | `binary.ts` (32KB)             | PDF/ePub/DOCX 解析与导出           | 不调翻译服务                    |
| services | `translation.ts` (10KB)        | 批量翻译编排                       | 不解析文件、不绑 provider       |
| ui       | `pdfPreview.ts` (14KB)         | Canvas 光栅化                      | 不决定片段与文件结构            |
| ui       | [`presentation.ts`][8] (5.5KB) | 纯展示派生规则                     | 不建 DOM、不解析                |
| —        | `public.ts` (1.3KB)            | 汇总公共 API                       | 不暴露内部私有函数              |

值得注意的是 `public.ts` 的注释写得很直白：调用方**应当通过公共契约注入翻译器和 PDF rasterizer**，不要绕过 services 层直接耦合 JSZip、pdf-lib 或 pdfjs。这种"防君子也防小人"的边界声明，在一个只有 7 个文件的模块里算得上克制。

> 提醒一句：如果你之前 clone 过 FluentRead，注意本地那份可能是 fork（`dalian-ai/FluentRead`）的旧版 0.0.28 [17]，那时还没有 `src/` 目录（是 WXT 的 `entrypoints/` 结构 [15]），跟上游 main 已经不是一个代码库了。

## 2. 转轴：两条流，而不是一个数组

整个设计的支点，是 [`core/document.ts`][3] 里的 `ParsedDocument`：

```ts
export interface ParsedDocument {
  parts: readonly DocumentPart[]; // 原文骨架
  segments: readonly DocumentSegment[]; // 待翻译片段
  // ...
}

type DocumentPart = LiteralPart | SegmentPart;

interface LiteralPart {
  kind: "literal";
  value: string; // 原样输出
}

interface SegmentPart {
  kind: "segment";
  segmentIndex: number; // 指向 segments[]
  source: string;
  prefix: string; // 前导空白
  suffix: string; // 尾随空白
}
```

`parts` 是原文的完整骨架，按出现顺序排列；`literal` 承载一切**不该翻译**的东西——HTML 标签、字幕时间戳、ASS 的 `Dialogue:` 前缀、Markdown 围栏里的代码、行尾的换行符。`segment` 只是一个占位符，真正的文本在 `segments[]` 里。

回填时遍历 `parts`：

```ts
if (part.kind === "literal") {
  output.push(part.value);
  continue;
}
const translation = translations[part.segmentIndex] ?? part.source;
```

就这么简单。**"保留原格式"不是一个需要为每种格式单独实现的功能，而是这个数据结构的自然结果。** 格式之间的差异，被压缩成了"怎么切"这一件事。

翻译结果按 `segmentIndex` 落位，所以整条链路对"翻译服务"是无知的——它只看到一个 `string[]`。

## 3. 切分：11 种格式，各自的讲究

| 格式      | 怎么切                                                                | 为什么这么切                                         |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| TXT       | 按行                                                                  | —                                                    |
| Markdown  | 按行，但代码围栏整体跳过；行内代码、图片、链接、裸 URL 保护为 literal | 让受保护的语法**保持原位**不被拆散                   |
| HTML      | 手写 tokenizer，标签整体保护                                          | 见下                                                 |
| SRT / VTT | **整条 cue 作为一个翻译单元**                                         | 时间戳不送去翻译，模型才能保留 `<i>` 这类行内标签    |
| ASS       | 数到第 9 个逗号才是对白正文                                           | ASS 的 Dialogue 行是逗号分隔的定长字段               |
| LRC       | 时间标签存为 `bilingualPrefix`                                        | 双语模式下第二行重复时间轴，产物**仍是可播放的 LRC** |
| JSON      | 递归只取字符串叶节点，记下 JSON path                                  | 键名、数字、布尔、嵌套结构都不动                     |

几个值得单独说的：

**HTML 的 tokenizer 是手写的。** 没用 `DOMParser`，因为这里要的是"字符串级切分"而不是 DOM 树。`findNextHtmlToken()` 里有个细节：扫描标签时会跟踪引号状态，`href="a > b"` 里的 `>` 不会被误判成标签结束。`head/script/style/pre/code/textarea` 六个标签被整体保护——翻译 `<script>` 里的内容显然是灾难。

**Markdown 有个 `bilingualGroup`。** 一行文字里如果夹了行内代码或链接，切分后会变成多个 part。双语模式下如果各自插入译文，一行引用会被拆得七零八落。所以给每个 part 打上行号 `bilingualGroup`，渲染时按源行重新聚合，输出一条完整的双语行。

**JSON 走的是完全不同的路径。** 它不产生 `parts`，而是产生 `jsonEntries`（path + segmentIndex），回填时在**深拷贝**上 `setAtPath`，原始对象始终不变。双语模式下塞进同一个字符串：

```ts
`${entry.prefix}${original.trim()}\n${translation}${entry.suffix}`;
```

**字幕的"整条 cue 作为单元"是个有取舍的决定。** 好处是模型能看到完整上下文、能保留行内标签；代价是一段长对白无法再切细，会占满一批的字符预算。

## 4. 二进制三件套

PDF、ePub、DOCX 交给 [`services/binary.ts`][4]，产出统一塞进 `ParsedDocument.binary`（一个可辨识联合）。

### 4.1 PDF：从字符原子重建段落

pdf.js [12] 的 `getTextContent()` 给出的是一堆**字符原子**（每个字或片段带自己的坐标变换矩阵），不是文本行。FluentRead 用三级几何聚类把它还原成段落：

1. **atom → line**：按 y 坐标排序，同行的判定是 `|Δy| ≤ max(2, 行高×0.42, 原子高×0.42)`。同时丢掉旋转角 > 0.12 弧度的文本（竖排/斜排直接放弃）。合成行时还会按间距补空格——但如果前一个原子以连字符结尾、下一个以小写字母开头，就**不补空格直接拼接**，处理英文换行断词：

```ts
if (/[-‐‑]$/u.test(value) && /^[a-z]/u.test(line.text))
  return `${value.slice(0, -1)}${line.text}`;
```

2. **line → block**：这是最费笔墨的一段。判定两块是否属于同一段落，综合了间距、水平重叠率、左边缘对齐、字号比、以及"上一行以句号结尾且当前行明显缩进"（新段落）。标题行（高度 ≥ 正文行高中位数 × 1.32）不参与合并。

3. 每个 block 记下 x/y/宽/高/字号/行高中位数/行数/字体/字重/对齐方式——**这套坐标就是后面重绘 PDF 的唯一依据**。

### 4.2 ePub：zip + OPF spine

JSZip [14] 打开 → 校验 `mimetype` 必须是 `application/epub+zip` → 读 `META-INF/container.xml` 拿 OPF 路径 → 解析 OPF 的 manifest（id → path）与 spine（itemref 顺序）→ 按 spine 顺序逐章读取，每章当作 HTML 丢给 `parseDocument()`。

有 fallback：如果 spine 里找不到 XHTML，就按 manifest 顺序兜底。章节标题从 `<title>` 里取，取不到用"第 N 章"。

### 4.3 DOCX：按 `<w:p>` 切段

```ts
const DOCX_PARAGRAPH_PATTERN = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu;
```

扫描 `word/(document|header\d+|footer\d+|footnotes|endnotes).xml`，按段落切。每段还会识别**角色**：

```ts
if (/header/iu.test(path)) return "header";
if (/(?:footnotes|endnotes)/iu.test(path)) return "note";
const style = paragraph.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/iu)?.[1] || "";
if (/title/iu.test(style)) return "title";
if (/heading|标题/iu.test(style)) return "heading";
if (/<w:numPr\b/iu.test(paragraph)) return "list-item";
return "paragraph";
```

页眉页脚、脚注尾注被单独分区，UI 上可以分开校对——这是很多翻译工具会偷懒的地方（直接把页眉当正文翻一遍）。

## 5. PDF 是最难的那个：不是替换文字，是重画一页

文本类格式可以"把译文塞回原位"，PDF 不行——它里面通常没有可以按 offset 替换的文本对象。FluentRead 的解法很硬：**把整页光栅化，擦掉原文，按原坐标重新画一遍译文**（实现见 [`ui/pdfPreview.ts`][7]）。

四步：

**① 光栅化原页。** 用 pdf.js 渲染到 canvas，缩放取 `clamp(1.45, 1440/页宽, 2.4)`。

**② 采样取色。** 这一步是全篇最有意思的地方。要在别人的版式上写字，得先知道背景是什么色、原文是什么色：

- **背景色**：沿文字块的四条边各采样 8×2 个点，取**中位数**。用中位数而不是均值，是为了让边缘偶尔压到的插图/分隔线不至于带偏结果
- **前景色**：在块内按步长采样（总样本控制在 ~3200 个），挑出与背景色欧氏距离 ≥ 48 的像素，按距离排序取**最强的 22%**，再取中位数

这套"中位数 + 距离阈值 + 取最强分位"的组合，效果就是自动还原原文墨色——深色背景的 PDF 也不会糊成一团黑。

**③ 擦除原文块。** 用背景色 `fillRect` 把文字块盖掉（外扩一点 padding）。注释里写明了为什么要**先擦完所有块再统一绘制**：

```ts
// 步骤 2：先统一擦除全部原文字块，避免重叠块把已绘制的译文再次遮住。
```

**④ 按坐标写译文。** `clip()` 裁到原块矩形内再 `fillText`，这样多栏排版、图文混排都不会串位。字号自适应是个收缩循环：

```ts
while (fontSize >= 3.5) {
  context.font = `${block.fontWeight} ${fontSize}px ${family}`;
  lines = wrapCanvasText(context, translation, maxWidth);
  if (lines.length * lineHeight <= maxHeight * 1.02) break;
  fontSize -= Math.max(0.35, fontSize * 0.045); // 每次缩 4.5%
}
```

中文字体按原块 `fontFamily` 里有没有 `serif` 切两套（Noto Serif CJK SC / Noto Sans CJK SC）。

最后是导出：pdf-lib [13] 新建 PDF，双语模式下一页放两幅图——左边 `embedPage` 原页、右边 `embedPng` 译页，中间留 `clamp(8, 页宽×2.5%, 24)` 的间隙。

**代价要说清楚**：产出的 PDF 是**位图**，文字不可选中、不可搜索、放大到一定程度会糊。这是"PDF 里没有可编辑文本"这个前提决定的，不是实现偷懒。另外扫描版 PDF（无文本层）会直接报错，明确**不做 OCR**。

## 6. 翻译编排：只认接口，不认服务商

[`services/translation.ts`][5] 定义了 `DocumentTranslationGateway`：

```ts
export interface DocumentTranslationGateway {
    getGlossaryOptions?(): {...};
    waitUntilReady(): PromiseLike<unknown> | unknown;
    getDefaultService(): string;
    supportsBatch(service: string): boolean;
    translateText(source, context, options): Promise<string>;
    translateTextBatch(sources, context, options): Promise<string[]>;
}
```

**整个目录里没有任何一处 import 具体的翻译 provider。** 翻译服务、术语表、用户设置全由上层注入。好处不只是可测试——FluentRead 有十几个翻译服务（划词、全文、字幕都在用），文档翻译只要注入同一个客户端就能全部复用。

调度上的几个决定：

- **分批**：每批 ≤ 16 段且 ≤ 3500 字符，两个上限取先到
- **无批量能力的服务**：起 `Math.min(3, pending.length)` 个 worker 抢同一个 `nextIndex` 游标，而不是 `Promise.all` 一把梭
- **语言对冻结**：任务开始时快照 `sourceLanguage/targetLanguage`。注释写得很明确——"不能被设置页同步更新或用户中途改选污染后续批次"。翻到第 80 段时用户改了目标语言，前 79 段不会变成两种语言的混合体
- **上下文注入**：取前 24 段拼成 `pageContext` 一起发给模型，让术语在全篇保持一致。这比"每段独立翻译"的质量高得多
- **结果校验**：返回条数不符或有空串直接抛错，不静默降级

失败处理有个细节：`Promise.all` 首个 worker 失败就 reject，但其余在途请求还会稍后结束。所以用一个 `stopped` 标志位——失败后不再上报过期进度、也不再认领新片段，避免"已经报错了进度条还在涨"。

## 7. 「可续读」：这次重构真正改了什么

9 月 5 日的提交 `feat(document): redesign translation as a resumable reading workspace` [9] 把文档翻译从"一次性动作"改成了"可长期维护的阅读工作区"。代码里对应两处，都很小但很关键。

**其一，`initialTranslations` —— 空白驱动。**

```ts
segments.forEach(({ id }) => {
  translations[id] = options.initialTranslations?.[id] || "";
});
const pending = segments.filter(({ id }) => !translations[id].trim());
```

已有译文直接落位（包括用户手工校订过的），`pending` 只装空白的。**你在校订区改过的段落，重跑时不会被覆盖。** 这让"翻到一半关掉，明天接着翻"和"只重翻我没改过的那几段"都成立。

**其二，`createDocumentFileLoadGuard()` —— 代次而非 abort。**

PDF/ePub 的解析是 async 循环，没有真正干净的中止点。与其假装能取消，不如用代次计数器：

```ts
let generation = 0;
return {
  begin() {
    const requestGeneration = ++generation;
    return { isCurrent: () => requestGeneration === generation };
  },
  invalidate() {
    generation += 1;
  },
};
```

新文件打开或页面重置时代次 +1，旧解析仍可自然跑完（不浪费、不泄漏），但 `isCurrent()` 返回 false，**不允许把状态写进新文档**。这是个很实用的模式：凡是你无法真正中止的异步流程，都可以用"所有权代次"代替取消。

另外 8 月底还有两个提交值得一提：`0652882` [10] 审计重构回归并清理死代码，`bf32cef` [11] 给源文件补了职责注释——所以现在每个文件头都有那段"文件职责 / 主要内容 / 模块边界"，读起来省很多事。

## 8. 回填与导出：每种格式的双语策略

同一个 `renderDocument(document, translations, mode)` 入口，`mode` 是 `bilingual` 或 `translated`，各格式的表现不同：

| 格式     | 双语模式                                                            | 纯译模式              |
| -------- | ------------------------------------------------------------------- | --------------------- |
| HTML     | 原文 + `<br>` + `<span data-fluent-read-document-translation>` 译文 | 直接替换（escape 后） |
| Markdown | 原文行 + 下一行 `> 译文`（引用块）                                  | 替换                  |
| ASS      | 原文 + `\N` + 译文（ASS 的换行码）                                  | 替换                  |
| JSON     | 同一字符串内 `原文\n译文`                                           | 替换                  |
| ePub     | 逐章重新渲染写回 zip                                                | 同                    |
| DOCX     | **原段后追加一个粉色译文段落**（`#E83B6B`）                         | 原地替换 `<w:t>`      |
| PDF      | 左右并排两页                                                        | 单页译版              |

DOCX 的双语策略特意选了"追加段落"而不是"段内追加文字"——这样原文段落的所有格式属性（`w:pPr`、编号、样式）都不用碰，代价是多一个段落。

ePub 导出有个容易踩的规范细节：`mimetype` 必须用 `STORE`（不压缩）且是 zip 的第一个条目 [16]，否则很多阅读器不认：

```ts
zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
```

## 9. 安全与限额

- **预览隔离**（[`core/preview.ts`][6]）：生成的 HTML 带 CSP `default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`，并且 `stripActiveHtml()` 额外剥掉 `script/iframe/object/embed/form`、`on*` 事件属性、`meta refresh`。被翻译的网页不会在扩展里执行任何东西
- **zip bomb 防护**：≤ 4000 条目、单项 ≤ 24MB、解压后总计 ≤ 96MB，解析前后各校验一次
- **PDF 签名校验**：开头 5 字节必须是 `%PDF-`，不然报"文件可能已损坏或扩展名不正确"
- **10MB 上限**：`DOCUMENT_MAX_BYTES = 10 * 1024 * 1024` 定义在 `core/document.ts`，但这个目录内没有调用点，实际校验在上层 UI

## 10. 能抄走的四个设计

不是抄代码，是抄判断。

**一、把"不可变结构"和"可变内容"分成两条流。** 一旦这么分，"保留原格式"就不用为每种格式单独实现了。任何"处理完还得还原"的任务——代码格式化后保留注释、模板渲染后保留手写修改、i18n 提取后回填——都是同一个形状。

**二、feature 只依赖注入的接口，不依赖具体实现。** 文档翻译模块不知道自己用的是 Google 还是 DeepL，只知道有个 `translateTextBatch`。这让 11 种格式的复杂逻辑可以脱离网络、脱离扩展环境单测。

**三、无法真正中止的操作，用所有权代次代替取消。** 强行 abort 一个 async 循环只会留下半初始化状态。让旧任务自然跑完但不许它提交，是更省心的做法。

**四、在别人的版式上写字，先采样再擦除。** "取中位数当背景、取最强分位当前景、先擦完再统一画"这三步，是"往不可编辑的画布上写字"这类问题的通用解法。

---

最后说回开头那句话。翻译一段话容易，翻译一份 PDF 难——难在**你要为每种格式回答同一个问题：哪些东西不能动**。

FluentRead 的回答是：先把不能动的全挑出来放进 `literal`，剩下的才叫"内容"。

## 参考

[1]: https://github.com/FluentRead/FluentRead "FluentRead — 开源浏览器翻译扩展"
[2]: https://github.com/FluentRead/FluentRead/tree/main/src/features/document-translation "document-translation 目录"
[3]: https://github.com/FluentRead/FluentRead/blob/main/src/features/document-translation/core/document.ts "core/document.ts — 领域模型与文本格式解析"
[4]: https://github.com/FluentRead/FluentRead/blob/main/src/features/document-translation/services/binary.ts "services/binary.ts — PDF / ePub / DOCX 解析与导出"
[5]: https://github.com/FluentRead/FluentRead/blob/main/src/features/document-translation/services/translation.ts "services/translation.ts — 批量翻译编排"
[6]: https://github.com/FluentRead/FluentRead/blob/main/src/features/document-translation/core/preview.ts "core/preview.ts — 隔离预览 HTML"
[7]: https://github.com/FluentRead/FluentRead/blob/main/src/features/document-translation/ui/pdfPreview.ts "ui/pdfPreview.ts — Canvas 光栅化重绘"
[8]: https://github.com/FluentRead/FluentRead/blob/main/src/features/document-translation/ui/presentation.ts "ui/presentation.ts — 展示派生规则"
[9]: https://github.com/FluentRead/FluentRead/commit/d438eba873eccec1e74f6c0141c513cef842ad45 "feat(document): redesign translation as a resumable reading workspace（2026-09-05）"
[10]: https://github.com/FluentRead/FluentRead/commit/0652882c056246c4658c7d1b5b1d6b291f69aac5 "fix: audit refactor regressions and remove dead code（2026-08-28）"
[11]: https://github.com/FluentRead/FluentRead/commit/bf32cef1fbd85171890585f0c12cddddfa2704eb "docs: document source module responsibilities（2026-08-25）"
[12]: https://github.com/mozilla/pdf.js "pdf.js — Mozilla"
[13]: https://github.com/Hopding/pdf-lib "pdf-lib — 在任意 JS 环境创建与修改 PDF"
[14]: https://stuk.github.io/jszip/ "JSZip — 创建、读取与编辑 .zip"
[15]: https://wxt.dev "WXT — 下一代浏览器扩展开发框架"
[16]: https://www.w3.org/TR/epub-33/ "EPUB 3.3 规范"
[17]: https://github.com/dalian-ai/FluentRead "dalian-ai/FluentRead — 常见 fork（旧版 0.0.28）"
