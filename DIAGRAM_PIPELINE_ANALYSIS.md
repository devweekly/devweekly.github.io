# diagram-design：生成链路、gate 与风格控制

这个仓库里没有生成器。

没有模板引擎，没有 AST，没有把数据画成 SVG 的运行时。`skills/diagram-design/scripts/` 下只有六个 Python 文件：三个导入提取器、两个导出器、一个输出自检器。真正把图"画出来"的是被装了这套 skill 的 agent，它读 Markdown 指令、复制一份 HTML 模板、手写出 `<svg>` 内容。仓库自己能执行的东西几乎全是检查器。

所以整份代码要按"文档即程序"来读：`SKILL.md` 是入口和路由器，`references/*.md` 是按路由加载的模块，`assets/*.html` 是编译产物兼回归样本，`scripts/*.py` 是测试。`style-guide.md` 比较特殊，它既是给人看的规范，也是被 `lint-skin.py` 和 `verify-contrast.py` 当配置文件解析的数据源。

理解这一点，后面那些看起来过度设计的同步检查才讲得通：既然控制流写在自然语言里，机器能验证的只剩"文件之间是否还自洽"。

---

## 一、仓库骨架与几个数字

| 项 | 数量 / 值 | 位置 |
|---|---|---|
| 视觉类型 | 45 | `references/type-*.md` 实际文件数 |
| 已发布示例 | 213 | `assets/example-*.html` |
| 模板 | 5 + gallery 入口 | `template.html` / `-dark` / `-full` / `-motion` / `-terminal`，另 `index.html` |
| 语义模式 | 9 | `references/semantic-patterns.md` |
| 仓库级 verifier | 35 | `scripts/verify-*.py` |
| 对抗测试 | 32 | `scripts/test-verify-*.py` |
| 维护者本地 gate 命令 | 86 | `.maintainer-policy.json` → `gates.local_commands` |
| ADR | 18 份，编号到 0017（0015 有两份） | `docs/adr/` |
| `SKILL.md` 体积 | 30,874 字节 | 上限 `MAX_SKILL_BYTES = 40_000` |

`SKILL.md` 的 40,000 字节上限来自 `scripts/verify-semantic-motion.py:30`，不是随口写的规定。ADR 0004 记录了原因：这个文件每次调用都会被塞进 agent 上下文，早先为了压到 35,000 字节，把 frontmatter `description` 里的类型名删了，结果 "make me a flowchart" 不再触发 skill。现在的规则是 description 必须逐个留下 45 个类型的词汇钩子（`verify-docs-sync.py:75` 的 `AGENT_SKILLS_DESCRIPTION_MAX = 1024`，插件 manifest 另限 500），要瘦身只能把正文搬到 `references/`。2026-09-27 那次拆分把 39,530 字节压到 28,869：`primitives-core.md` 接走 SVG 标记和六条连线规则全文，`layout-budget.md` 接走 4px 网格表、各类型预算、页面布局和 summary card。

`SKILL.md` 剩下的 §0–§12 是每次运行都必需的部分：首次设置门、选择表、反模式、语义角色、六条连线规则的一行摘要、复杂度上限、§9 检查清单、导入路由、输出契约。它是一张路由表，不是手册。

触发面有三处：frontmatter `description`（宿主自动匹配）、`commands/` 下 6 个斜杠命令、`prompts/` 下 5 个 Pi 模板。两者内容刻意做成薄封装，每份都写着"把对应 reference 当作 source of truth，别在这里重新实现逻辑"。有个小缺口：`commands/import-drawio.md` 存在，`prompts/` 里没有对应文件；`verify-doctor.py` 的 `ROUTING_SURFACES`（11 条）也是按这个不对称写的，属于当前实现而非疏漏。

---

## 二、一次生成的完整链路

```
触发（description / command / prompt / 自然语言）
  │
  ├─ §0 风格门：解析 .diagram-design marker → 选定 effective style guide
  │            未定制且无 marker → 停下来问用户
  │
  ├─ §3 选择：行为是否承重？
  │     是 → semantic-patterns.md 选 1 个主模式 → 映射到最近的视觉类型
  │     否 → 直接选视觉类型
  │     生成前用一句话报出 类型 / 模式 / size / 要砍掉什么
  │
  ├─ 按需加载 references：type-*.md、primitives-core.md、layout-budget.md、
  │                       style-guide.md、output-spec.md（导入时再加 import-*.md）
  │
  ├─ §10 复制最接近的 template*.html → 替换 eyebrow / h1 / [diagram-slug] /
  │                                    <title> / <desc> / SVG body
  │      占位符 {ink}、{ink @ 0.40}、{node-name} 由 agent 解析成当前 hex / 字体
  │
  ├─ §6 / §7 写作约束：4px 网格、六条连线规则、9 节点 / 12 箭头 /
  │                    2 个 accent / 2 个 callout
  │
  ├─ §9 taste gate（38 条 checkbox，纯人工核对，无脚本）
  │      唯一实际执行：python3 <skill-dir>/scripts/self_check.py <file>
  │
  └─ §12 单个自包含 .html；svg / png 只在用户明确要求时经 export.md 导出
```

导入是同一条链路上多出来的一段前置分支：`.drawio` / Mermaid / `.excalidraw` 先跑对应提取器拿 digest，再按四个 dial 决定重画规格，最后必须交一份 fidelity ledger（合并了什么、折叠了什么、丢了什么）。四个 dial 的默认值是 `html` / `doc-inline` / `balanced` / `mixed`，`doc-inline` 对应 `viewBox 0 0 960 600`。

三条导入路径共同遵守 "extract, don't render" 和 "redraw, never convert"：源文件的坐标、配色、字体、渲染器布局全部丢弃，只留组件、关系、分组、方向。三个提取器输出同一个 analysis 字典形状（`nodes_total` / `nodes_drawable` / `containers` / `leaves` / `edges_total` / `edges_labeled` / `edges_dangling` / `max_depth` / `shapes` / `has_cycle` / `hubs` / `entry_points` / `terminals` / `orphans` / `type_candidates` / `collapsible_groups` / `over_node_budget` / `over_edge_budget`），退出码 2 表示拒绝输入，命令要求把消息原样报给用户并停下。

安全边界做得比一般文档工具硬：draw.io 侧 `MAX_INPUT_BYTES = 32 MiB`、`MAX_XML_BYTES = 64 MiB`、`MAX_PAGES = 100`、`MAX_CELLS_PER_PAGE = 10000`，见 `<!DOCTYPE` / `<!ENTITY` 直接拒绝，`zlib` 解压带上限分块；Mermaid 侧 `MAX_SOURCE_BYTES = 4 MiB`、`MAX_NODES = 2000`、`MAX_EDGES = 5000`、`MAX_STATEMENT_CHARS = 4096`，`style` / `classDef` / `click` / `%%{init}%%` 只计数后丢弃；Excalidraw 侧 `MAX_ELEMENTS = 10000`、`image` / `embeddable` / `link` / `freedraw` 一律计入 `discarded` 而不解码。三者对标签都做白名单清洗和 Markdown 元字符转义，digest 里的文字永远不会被当指令执行。

一个容易忽略的分叉：agent 在用户项目里生成的文件，和仓库里那 213 个 shipped example，处在两个不同的校验世界。`self_check.py` 随 skill 打包，是生成后唯一被要求跑的检查；`lint-skin.py`、`verify-geometry.py`、`verify-motion.py` 属于仓库 checkout，`SKILL.md` §9 里写的是"From a repository checkout"才能跑。`CONTRIBUTING.md` 也把 `self_check.py` 称作 "distilled subset"，明说仓库 gate 才是贡献场景的权威。这个落差后面还会提到。

---

## 三、gate 分成几层，各管什么

| 层 | 执行者 | 对象 | 代表 |
|---|---|---|---|
| 意图 | agent 自己 | 该不该画、删没删干净、焦点选对没 | §1 哲学、§4 反模式、§9 taste gate |
| 安装态 | 生成结束时 | 刚写出来的那个 HTML | `self_check.py`，`--offline` 变体 |
| 源码态 | 贡献者 / CI | shipped example 与 template | `lint-skin.py`、35 个 `verify-*.py`、`lint-render.py` |
| 反向验证 | CI | 检查器本身 | 32 个 `test-verify-*.py` |
| 打包与发布 | CI / 维护者 | manifest、截图、README、版本号 | `verify-plugin-package.py`、`verify-screenshot-freshness.py`、`auto-bump.yml` |
| 人工 | maintainer | 优先级、scope、合并授权 | `.maintainer-policy.json` 的 6 项 `human_gates`、Greptile 评分 ≥4 |

### 安装态：`self_check.py`

34KB，零第三方依赖，`html.parser` + 正则。八类检查：

- 文档完整性：必须以 `</html>` 收尾（容忍尾部注释和空白）；出现 U+FFFD 直接判 mojibake 并报首个行号；`PAIRED_CONTAINER_TAGS`（title/desc/div/svg/g/text/tspan…）开合计数必须相等；`BalanceParser` 单独处理 `<title>` 的 RCDATA，避免把 `<title>Using <span> labels</title>` 里的 span 当成真标签。这是为了抓住"写文件写到一半被截断"这类其它检查全都发现不了的缺陷。
- 单文件安全：禁 `on*` 事件属性、`srcdoc`、`javascript:` / `data:text/html`、`base` / `embed` / `object` / `iframe`；远程引用只允许一个解析后 hostname 恰为 `fonts.googleapis.com`、path 恰为 `/css2`、scheme 为 https 的 stylesheet（`is_approved_google_fonts_stylesheet()`）；CSS 里 `@import`、非 fragment 的 `url()`、`image-set()` 全禁。
- 可访问 SVG：`role="img"`、`<title>` 是首个子元素、title/desc 非空且 ID 带文件 slug 前缀（不许裸 `title` / `desc`）、`aria-labelledby` 严格等于 `[title_id, desc_id]`、`aria-hidden="true"` 的装饰 SVG 豁免但整份文件至少得有一个非装饰 SVG。
- viewBox 边界：`VIEWBOX_TOLERANCE = 2.0`，把 rect/line/circle/ellipse/polygon/text 的绘制点加上父级 `translate()` 偏移后与 viewBox 比较。遇到 CSS 会移动或裁剪元素的规则，检查器主动放弃判断（`child_offset()` 返回 None）——宁可漏报也不误报。
- 脚本：至多一个 `<script>`，属性名只能是 `data-diagram-controls`，正文与 `assets/template-motion.html` 里的控制器逐字相同（换行归一化后比较）。
- 动效结构：`data-motion-mode ∈ {none, reveal, step, loop}`、步数 1..8、`data-motion-item` ≤12、同一步最多 2 个语义项、语义步必须连续 1..N、受控模式要有 5 个控件和 `role=status` + `aria-live=polite` + `aria-atomic=true`、有脚本时必须有 `prefers-reduced-motion`、`@media print` 和 `<noscript>`。
- `--offline` 额外拒绝 Google Fonts `<link>`。

它不检查颜色、字体族名、几何连线、数值编码。这几项全部留给仓库侧。

### 源码态：皮肤、几何、数值、渲染

`lint-skin.py`（791 行）是风格控制的主执行点，下面单独展开。`lint-render.py` 是唯一以像素为 oracle 的检查器，其余 verifier 都读源码文本。

数值/几何类 verifier 的共同套路值得单独说，因为它是这套 gate 里最有想法的部分：**让图自己声明它想表达的数，再重算一遍图形坐标**。声明写在 `data-*` 上，图形坐标从 `<rect>` / `<path>` / `<line>` 属性里读，两边对不上就是"图在撒谎"。

具体绑定契约举例：

| verifier | 声明 | 检查 |
|---|---|---|
| `verify-treemap.py` | `data-share` | 面积占比相对误差 > `AREA_TOLERANCE = 8.0`% 即失败；`share_total` 必须在 99–101 |
| `verify-waterfall.py` | `data-role` / `data-value` / `data-name` / `data-carry` | 用 `Fraction` 做运行总和守恒，声明值零容差；几何 `GEOMETRY_TOLERANCE = 0.75` |
| `verify-polar.py` | `data-polar-value` / `data-polar-radius` / `data-polar-min/max` | `TOLERANCE = 0.75`，且实际容差取 `min(0.75, radius/20)` |
| `verify-exploded.py` | `data-rect` / `data-z` / `data-t` / `data-level` | 等轴投影 `iso(x,y,z) = [x-y, (x+y)/2 - z]` 反算轮廓 |
| `verify-block-registry.py` | `data-block-id` / `-name` / `-parent` | ID 唯一、parent 可解析、链无环 |

误差策略不是一刀切：面积类用相对误差（绝对值会让最容易画错的小格子轻松通过），守恒类用 `Fraction` / `Decimal` 零容差（"Declared values are data, so there is no tolerance"），几何类给 0.5–2px 的舍入空间。多个脚本还专门防 `float("nan")` 绕过所有 `abs(x) > tolerance` 比较。

解析器只有两种：标准库 `HTMLParser`（`convert_charrefs=True`，属性名 casefold，重复属性取第一个）和 `re`。没有 lxml、没有 BeautifulSoup。所有属性位置判定都要求用裸 `x/y/width/height`，CSS `transform` / inline `style` / `<style>` 规则里摆位置一律不接受——`verify-beeswarm.py`、`verify-box-plot.py`、`verify-marimekko.py` 都把这一点写进了 docstring。原因是 CSS 定位无法静态重算，放开就等于放弃检查。

`verify-geometry.py` 判据很巧妙：只报"label mask 与**文档中后声明**的节点重叠"，因为绘制顺序是 background → zones → arrows → labels → nodes，后画的节点 fill 会盖掉标签。同一脚本还拦对角斜线、贴着节点边框的连线、距节点角 8px 内的端点、同一条边上间距 <12px（短边 <48px 时 8px）的端口、以及与另一条连线叠在同一条直线上的段。ADR 0005 记录了它诞生的原因：9 个已发布示例、跨 architecture 和 swimlane 两个类型，全都带着标签被节点裁掉的缺陷，三个变体同时过审，而当时所有 gate 全绿——`lint-skin.py` 不看坐标，`self_check.py` 不看坐标，人也没看出来。这条 ADR 是理解整个 gate 体系动机的钥匙。

`lint-render.py` 走另一条路：它明确拒绝用 `getBoundingClientRect()` 判断裁切，因为那测的是几何而不是 paint，既漏掉 stroke/marker/filter 的溢出，又把 `clip-path` 和 `overflow: visible` 下的安全内容误判为溢出。做法是同一 SVG 截两次图，第二次逐层释放 `overflow`，做像素 diff，多出来的墨就是被裁掉的内容。释放是分级的（先 SVG 自己，再逐级释放最近的裁剪祖先），否则释放祖先会把 SVG 边缘的溢出一起吞掉。常量：`CHANNEL_THRESHOLD = 16`（每通道差值）、`MIN_DIFF_PIXELS = 8`、`EDGE_GUARD = 2`、`DIFF_SCALES = (1, 0.25)`、`MAX_ANCESTOR_STAGES = 4`。网络在浏览器 resolver 层用 `MAP * ~NOTFOUND` 掐断，比请求路由更彻底，`--fonts` 只放行 `fonts.googleapis.com` / `fonts.gstatic.com` 且必须 HTTPS。`--self-test` 的 23 个用例里超过一半是"不该被报"的情况，并断言测完之后 DOM 逐字节不变。

默认断网带来一个副作用，文档里直言不讳：CI 跑的是 fallback 字体的排版，也就是 system-font 模式的样子；要看真实 Instrument Serif / Geist 是否撑得下盒子，得本地跑 `--fonts --all`。

### 反向验证

`test-verify-*.py` 成对出现，每个都要求两个极性：shipped 变体必须全部通过，注入的错误必须失败且报错文本点名那个谎言。手法是在 `tempfile.TemporaryDirectory()` 里对**真实发布文件**做单点最小变异，或拼最小 HTML/SVG。

几个能说明设计意图的例子：

- `scripts/fixtures/waterfall-plausible-wrong.html`：一张完整可渲染的瀑布图，末端印着 236，按签名贡献走出来是 238。另有 `data-carry="240000000.1"` 改成 `240000000.11` 的"一分钱"变异，验证 `Fraction` 不是碰巧认得那组整数。
- `test-verify-contrast.py`：把 `accent` 换回早年被淘汰的 atomic-tangerine `#eb6c36`，要求 gate 精确报出 `light: accent as non-text is 2.86:1`，同时确认未改动的 dark accent / light link 不被误报。
- `test-verify-geometry.py`：同一缺陷用单引号属性再演一遍，再注入 `data-note="x='10' y='10'"` 这种"看起来像坐标的属性文本"，确认正则不会把它当真坐标。
- `test-verify-semantic-motion.py`：把 `SKILL.md` 填到 40,000 / 40,001 字节，用 LF、CRLF、混合行尾各测一次，确认字节上限按 LF 归一化计数且不会因 checkout 换行转换松动（`.gitattributes` 把 SKILL.md 钉成 `text eol=lf`）。

35 个 verifier 对 32 个 `test-verify-*` 的差不是漏配：`verify-mermaid-import.py` 把对抗 fixture（`sample-adversarial.mmd`）和资源上限、命名失败都写在自己内部，`verify-plugin-package.py` 则由 `test-plugin-package.py` 覆盖。`test-maintainer-policy.py` 会检查每个 verifier 及其对抗测试是否都进了 `.maintainer-policy.json` 的 CI 命令清单，防止新检查器接了线却没被测。

### 文档同步与计数

`verify-docs-sync.py` 的 docstring 自称覆盖 "Seventeen drift classes"，`main()` 里串了二十多个 check：description 词汇钩子、manifest 描述、gallery 可达性、README 文件树、相对链接、打包支持路径、命令/prompt 路由、字体链接一致性、导出面一致性、标题回退顺序、SKILL.md 拆分路由……

其中 `45` 这个数字被钉得很死：

- 代码里 `VISUAL_TYPE_COUNT = 45`（`verify-docs-sync.py:74`、`verify-semantic-motion.py:31`），`verify-screenshot-freshness.py` 和 `render-canonical-screenshots.py` 里还有硬编码的 45；
- `COUNT_SURFACES` 列了 8 份文档，前 3 份 import 命令**禁止出现任何硬编码计数**（要指向 SKILL.md §3），后 5 份读者文档若写了数字必须等于 `type-*.md` 实际数量；
- `ADR 0002` 的 Amendments 是修订记录，最后一条的标题必须写着当前的 "the count is N"；
- gallery 每种类型占一个 01..N 编号，同类型的其它示例紧跟其后作字母变体（`04a`）并带 `data-parent-type`。

`DESCRIPTION_ALIASES`（10 项）解决的是命名不一致：选择表里叫 "bar chart"，frontmatter 里写 "bar"，还有 "exploded axonometric"→"exploded"、"database schema"→"schema" 等。加一个新类型，如果选择表名和 description 用词不同，就得补一条别名。AGENTS.md 把新增类型的完整清单列了出来——两个脚本的常量、两个脚本的硬编码计数、README/CONTRIBUTING/SKILL/onboarding/semantic-patterns 的计数、ADR 0002 新修订、四个插件 manifest 的 description 和 keywords、README 缩略图与文件树、layout-budget 的新行。这是把"控制流写在文档里"付出的直接代价。

### CI 与发布

`.github/workflows/ci.yml` 三个 job：`plugin-package`（Ubuntu，Python 3.12 + Node 22，校验四个 manifest 版本在 PR 中未被改动，跑 `claude plugin validate . --strict`）、`python39-compat`（Ubuntu，Python 3.9）、`validate`（3 OS × 2 Python = 6 legs，`fail-fast: false`）。像素相关 gate（render linter 的 self-test 与 `--all`、README 缩略图、export-wait）只在 Ubuntu + 3.12 那条腿跑，注释写清了理由：抗锯齿和字体回退在各 OS 不同，阈值是按 Linux Chromium 标定的。依赖用 uv lock 精确锁定 `playwright==1.62.0` / `pillow==12.1.1`，Chromium 版本由 Playwright 的 pin 决定，Node 侧锁 `@anthropic-ai/claude-code 2.1.229`。

版本号不在 PR 里改。`auto-bump.yml` 在 push 到 main 后，从上次 bump 起遍历合并的 PR 标签决定 patch/minor/major，生成只允许改四个 `plugin.json`（可含 SKILL.md）的 patch；`prepare` 和 `publish` 两个 job 各自独立校验，直到最后一步才引入有写权限的 token。`.maintainer-policy.json` 另有 6 项 `human_gates`、Greptile 评分 ≥4、`require_same_head` 等合并条件。

---

## 四、风格控制：一个文件同时是规范、配置和白名单

### 三层落地

`style-guide.md` 自称 "single source of truth"，这句话在这套代码里是字面成立的。

第一层是语义角色。`paper` / `paper-2` / `ink` / `ink-strong` / `muted` / `soft` / `rule` / `rule-solid` / `accent` / `accent-tint` / `link`，外加 5 个只给多系列图表用的 `series-*`，以及一套独立的 terminal skin。所有 `type-*.md` 只写 `{ink}`、`{ink @ 0.40}`、`{node-name}`、`{eyebrow}` 这样的占位符，不出现 hex。agent 生成时查当前 `style-guide.md` 把占位符解析成实际值。

第二层是产物。`template.html` 在 `:root` 里放 `--color-paper: #f5f5f5` 等 CSS 变量，页面外壳用 `var(--...)`；但 SVG 内部大量使用硬编码 hex，例如 `template.html` 和 `example-loop.html` 的箭头 marker 都是 `fill="#4f5d75"`、`fill="#bf4520"` 这样的字面量。`example-loop.html` 里 `var(--` 出现 14 次，同时有 6 种硬编码 hex。`type-*.md` 里的占位符由 agent 解析后写死进 SVG，运行时没有色板注入机制。

第三层是校验，也是最巧的一层：`lint-skin.py` 的 `allowed_colors()` 每次运行都去读 `style-guide.md`，用 `table_hexes()` 定位 `### Semantic roles` / `### Series palette` / `### Terminal skin` 三张表，抓出表里的 hex 当白名单（再加 `#fff` / `#ffffff`），然后把每个 6 位 hex 转成 RGB 三元组，用来校验 `rgba()` 是否派生自合法颜色。`style_guide_families()` 同样从 `## Typography` 表的 Family 列抽字体，与硬编码的 `ALLOWED_FONTS`（28 项）取并集，再加 Google Fonts `<link>` 里解析出的 family。`verify-contrast.py` 的 `parse_tokens()` 用 `ROW_RE` 读的还是这张 Semantic roles 表。

于是改 `style-guide.md` 里一个 hex，会同时改变三件事：agent 后续生成时解析出的占位符值、所有 HTML 里合法颜色的集合、WCAG 对比度计算的输入。文档不是"描述"配置，它就是配置。

代价也在这里：shipped example 里全是硬编码 hex，仓库级的 palette 改动会让一百多个文件立刻 lint 失败，除非同步重刷。`lint-skin-baseline.txt` 里 20 个 pre-2.0 遗留文件豁免颜色/字体/资源检查（但仍跑 a11y），`CONTRIBUTING.md` 明确禁止再往里加新文件。`onboarding.md` Step 5 只说"建议跑 /regenerate-examples 流程（如果存在）或重建一个示例"，仓库里并没有这样的批量重刷工具。

### 硬约束清单

- 颜色：hex 必须在 `style-guide.md` 三张表的并集内；`rgba()` 的 RGB 三元组必须来自允许的 hex；`#000000` 与 `rgb(0,0,0)` 单独列为 `pure-black` 禁止（纯黑会把编辑感压平）。
- 字体：`ALLOWED_FONTS ∪ style_guide_families() ∪ link 中的 family`；`var(--...)` 和 CSS 关键字放行。文档层的约束更细：serif + sans + mono 三个族，标题 Instrument Serif，节点名 Geist 600，端口/命令/URL 这类技术内容才用 Geist Mono，注释用 italic Instrument Serif，明令禁止把 JetBrains Mono 当"开发者字体"铺满全图。
- 外部资源：只允许 `https://fonts.googleapis.com/css2` 的 stylesheet（hostname、path、port、fragment 逐个校验）；`@import`、非 fragment `url()`、`srcdoc`、`on*`、`<base>`、远程 `<script src>` 全禁；`self_check.py` 与 `lint-skin.py` 各实现一遍这套规则，措辞都写着 fail-closed。
- 脚本：至多一个 inline controller，属性只有 `data-diagram-controls`，正文与 `template-motion.html` 逐字一致（`lint-skin.py` 用 sha256，`self_check.py` 用归一化字符串比较）。ADR 0001 的决定就是"静态默认 + 唯一被审过的控制器"，改控制器要同时改模板、示例、文档和 adversarial 测试。
- 可访问性：`role="img"`、`<title>` 首子、`<title>` ≤60 字符、`<desc>` 非空、ID 必须是 `<slug>-title` / `<slug>-desc`、viewBox 四个有限正数、装饰 SVG 用 `aria-hidden="true"`。模板里允许 `[diagram-slug]-title` 占位符，其它文件不允许。
- 对比度：`THRESHOLDS = {"text": 4.5, "large-text": 3.0, "non-text": 3.0}`，`relative_luminance()` 用 0.2126/0.7152/0.0722，半透明先 `composite()` 到 paper 再算，`ink-strong` 单独对 0.85 的 accent 填充测。当前 light 皮肤下 accent 4.71:1、soft 5.34:1、link 6.13:1、muted 6.11:1。品牌原始的 atomic-tangerine 在 paper 上只有 2.86:1，所以默认 accent 用的是压暗到 4.5:1 以上的 `#bf4520`——这个改动本身就是被 gate 逼出来的。
- 布局：4px 网格（坐标、宽高、间距、padding 都能被 4 整除）、圆角 4/6/8、描边 0.8/1/1.2、六条连线规则、≤9 节点、≤12 箭头、≤2 accent、≤2 callout。

### 连文案方向都要验证

`verify-skin-polarity.py` 是这个仓库里最反直觉的一个 gate。它读 `<text|desc|p|h1..h4|li|figcaption>` 的正文，用 `CLAIM_RE` 解析 `<tone> is/means/represents <magnitude>` 这类断言，再从 `data-share` / `data-value` / `data-size` 拿到 ramp 的等级，把每个半透明成员合成到该文件的 paper 上，分别测亮度轴和对比度轴的方向，最后比对"文案说的方向"和"实际画的方向"。

背景是 light/dark 反转：`ink` 是角色不是颜色，同一组 opacity 在浅色纸上越强越暗，在深色纸上越强越亮。所以 "darker is larger" 这句话在暗色皮肤的示例里直接变成谎话（`example-treemap-dark.html` 的旧 legend 就是这个缺陷）。修复方案不是给暗色文件换一句反话，而是所有变体统一写 `stronger contrast is larger`——按与纸面的对比度命名，换肤也成立。

它还有一条 fail-closed：`MIN_RAMP_MEMBERS = 3`、等级不严格递增、两条轴测得 flat、paper 解析不到、fill-opacity 不可读，或者出现"tone 词与 magnitude 词相距六词以内却没有任何受支持句式能绑定"的措辞，一律报错。"无法验证的断言等同于没被验证的断言"，这个判断被写进了检查器。没有方向性措辞的文件直接通过。

### 换肤怎么走

`SKILL.md` §0 是一道生成前的门，不是配置读取。流程在 `profiles.md`：

- 项目根目录的 `.diagram-design` marker 只接受 `profile: <slug>` 一行，slug 必须匹配 `[a-z0-9][a-z0-9-]{0,63}`，多余内容、注释、路径、非法 slug 一律整体忽略并说明原因，绝不执行 marker 内容。
- marker 有效时直接读 `~/.diagram-design/profiles/<slug>.md` 作为本次生成的 effective guide，**不改写安装目录**。ADR 0006 说清了为什么：把 profile 复制到安装目录会在并行工作区之间产生竞态，插件更新还会覆盖它；中心化的"项目路径→profile"索引在机器间不可移植。
- 无 marker 时读安装目录的 working copy：有合法 profile header 就是 active profile；没 header 但语义角色/字体族/`Font source` 与出厂默认值有任一差异，判为 `custom-unsaved` 并提供保存；全默认才触发首次设置询问。
- 每次生成都重新解析，不跨项目缓存。读到旧 schema 的 profile 时，只从当前出厂默认补齐缺失行，值差异算定制不算错误，并把补了哪些行告诉用户。
- `default.md` 是 pristine 出厂快照，写入前要验证它确实还是默认值；绝不把已定制的 guide 误存成 default。

`onboarding.md` 给的是从来源提取 token 的七步流程（URL / 已安装 skill / 本地文件夹，或手贴 token / 保持默认）。URL 路径要求先做信任确认再发任何网络请求，抓回来的 HTML、注释、alt、metadata 全按不可信数据对待。有个 "exact-font gate" 很能说明这个项目的取向：不许为了"文件零依赖"把品牌字体偷偷换成 `serif` / `system-ui` / `ui-monospace`，自定义托管或付费字体如果无法进入单文件白名单，就明确标注 `fallback` 而不是假装精确匹配；写完还要用 `getComputedStyle` 确认字体真的加载了。写 token 前的 constraint check 包括 4.5:1、`accent` 必须是饱和度最高的那个、paper 不能是纯白（`#ffffff` 回退到 `#fafaf7`）。diff 预览要附 "brand fidelity receipt"：采样 URL、六个检测值、三个字体族及来源、每个角色是 exact 还是 fallback。

`Font source: web | system` 也是皮肤设置，跟着 profile 一起存。`system` 模式下省略 font `<link>` 和导出时的 `@import`，保留所有 `font-family` 栈（每个都以通用族结尾），导出用 `--system-fonts`，验证用 `self_check.py --offline`。非拉丁标签（韩文、繁中、简中、西里尔）在 `style-guide.md` 里有逐字符宽度预算、12px 字号下限和 register 切换规则；`verify-treemap.py` 真的按这套预算检查格子标签，其它类型则是作者自己守。

### 意图层：项目自己怎么定义"AI 味"

`SKILL.md` §4 直接把标题写成 "These mark AI slop schematics of any type"，列了十条：暗色 + 青紫辉光、把 JetBrains Mono 当通用"技术感"字体、所有节点一个样式、图例浮在图内、箭头标签没有遮罩、竖排文字、三张等宽 summary card、任何阴影、`rounded-2xl` 式大圆角、每个"重要"节点都涂 coral、照抄 Mermaid 渲染器布局、以及任何违反六条连线规则。

§1 更直白："The highest-quality move is usually deletion." 目标密度 4/10，超过 9 个节点大概就该拆成两张图；`accent` 是编辑性强调，不是状态标记，一张图最多 1–2 处，涂 5 处等于没有焦点。§2 还有个前置判断：如果三列表格或一段话能讲清，就别画图。

这些约束里，能被机器验证的只有一小部分：颜色白名单、字体白名单、纯黑、圆角其实没被检查、a11y、数值编码、几何、文案方向。"是否删掉了可以删的节点"、"coral 是不是只给了真正的主角"、"该不该画这张图"全靠 §9 那份 checkbox。这不是疏忽，是这套体系承认的边界——`CONTRIBUTING.md` 在讲数值 verifier 时把话说明白了：

> The current type checkers verify **internal consistency** of the chart and its declarations. They cannot prove that a correctly drawn number matches an external budget, spreadsheet, or API.

同一段还写了一条未实现的路径：为生成图保留独立源数据文件、让类型 verifier 比对声明、把 verifier 打包进 skill、由 `self_check.py` 调用；在此之前只能显式跑仓库 verifier，且不得把源数据描述成"已验证"。

---

## 五、没被管住的地方

几处值得留意的缺口，按影响排：

1. **生成态和仓库态之间隔着一道墙。** 用户拿到的图只过 `self_check.py`，而颜色、字体、几何、数值编码这些最能暴露"图画错了"的检查全部在仓库侧，且 `verify-*.py` 的输入约定（命名变体、`data-*` 契约、相对误差阈值）是围绕 shipped example 设计的。要让生成图享受同等校验，得把 verifier 打包进 skill 并接到 `self_check.py`，`CONTRIBUTING.md` 承认这条路径目前只对"独立源数据"开放。

2. **taste gate 没有执行体。** 约 30 条 checkbox 全是自然语言，agent 可以跳过任何一条而不触发任何失败。ADR 0005 里那 9 个带缺陷的示例、三个变体、所有 gate 全绿，正是这个空档的实证。仓库的应对方式是"每发现一类肉眼可见的缺陷，就补一个专门的 verifier"——`verify-geometry.py` 和 `verify-skin-polarity.py` 都是这么来的。这是归纳式补漏，不是完备覆盖。

3. **像素 gate 的已知上限写得很诚实。** ≤2px 的溢出、超出 0.25x 取景框的溢出、滚动祖先里的 SVG 直接报 `unmeasurable` 而非静默通过；只在 Linux 一条腿跑，CRLF checkout、PNG 摘要、字体 fallback 都靠锁版本控制。

4. **45 这个数字的同步成本。** 四处代码常量、八份文档、ADR 修订记录、四个插件 manifest、README 缩略图与文件树、layout budget 表、外部三处（GitHub About、维护者 profile README、diagramdesign.dev，CI 管不到）。AGENTS.md 专门写了"agent 容易漏掉的部分"，本身就是这条复杂度的产物。

5. **语义层不被验证。** `verify-block-registry.py` 的文档自己写了 "the checker mirrors the source rather than validating semantics, so a passing file is only as correct as the IDs and parents actually authored on it"。语义模式的九个路由、每个模式的 `Required primitives` / `Complexity budget` / `Static fallback`，`verify-semantic-motion.py --markdown-only` 只验证它们在文档里存在且字段齐全，不验证某张图是否真的按模式画了。

6. **风格里"好不好看"这件事没有 oracle。** 这套体系能严格保证颜色合法、字体合法、对比度达标、图形和标注数字一致、标签不被裁切、换肤后文案不说反话。它无法判定一张图是否拥挤、层级是否清楚、是否该拆成两张。`lint-render.py` 把浏览器当 oracle 只解决了"画出来有没有被切掉"，审美判断始终留在 §9 和人手里。这大概也是这个仓库把 `style-guide.md` 写成手册、把 §1 写成设计主张，却把绝大部分代码投给一致性检查的原因：一致性可以编译，品味不能。
