# Python 操作 Excel 库比较分析报告

**报告日期：2026-10-15**  
**范围：** Excel 工作簿读写、数据处理、格式化与图表、公式、性能、内存、部署限制及生产选型。  
**信息来源：** 官方文档、PyPI 发布记录和公开基准。版本号按截至报告日期可核实的发布信息记录；正式项目应在锁定依赖前再次核对包版本、Python 版本兼容性与许可证。

---

## 1. 执行摘要

Python 的 Excel 生态并没有一个“全场景最优”的单一库。第一步应区分你要做的是**操作 Excel 文件结构**、**将表格数据载入 DataFrame 做分析**，还是**调用 Excel 本身来计算公式/执行宏**。

- **一般 XLSX/XLSM 工作簿读写、改单元格和样式、修改既有文件：首选评估 `openpyxl`。** 功能面广、纯 Python、适合逐单元格处理；代价是大型工作簿可能较慢、内存占用较大，而且它不是 Excel 计算引擎。
- **从零生成格式复杂的 XLSX 报表：首选评估 `XlsxWriter`。** 图表、条件格式、数据验证、图片、打印设置等能力成熟，支持低内存写入模式；但不能读取或修改已有工作簿。
- **Excel 作为数据源，重点是筛选、聚合、联表与统计：用 `pandas` 或 `Polars`。** pandas 生态最成熟；Polars 的查询执行和内存效率对大批量数据很有吸引力。二者是数据分析层，不应被当作完整的 Excel 文件编辑器。
- **只读导入、大批量工作簿读取：优先测试 `python-calamine` / `fastexcel`。** Rust Calamine 引擎被 Polars 官方文档推荐为其 Excel 读取路径中最快的选项；读取速度快不意味着能够保留格式或修改工作簿。
- **必须由真实 Excel 引擎执行公式、VBA 宏或依赖 Excel 特有行为：评估 `xlwings`。** 传统开源模式要求安装 Microsoft Excel，主要支持 Windows/macOS；这与无桌面依赖的 Linux 服务是不同的架构选择。
- **遗留格式 `.xls`：使用 `xlrd` 读取；`.xlsb` 则优先评估 pandas + Calamine。** `xlrd` 仅支持旧式 `.xls`，`pyxlsb` 只提供有限的 `.xlsb` 读取能力，不适合作为新项目的通用 Excel 引擎。
- **Excel 公式求值是独立问题。** `openpyxl`、`XlsxWriter`、pandas 和 Polars 都不会完整模拟 Excel 计算引擎。第三方公式解释器只覆盖部分函数；关键财务模型若要求和 Excel 结果一致，应使用 Excel 或经过验证的兼容计算引擎，并做回归验证。

**推荐组合：** `openpyxl` 负责需要编辑/检查的工作簿，`XlsxWriter` 负责新建报表，`pandas`/`Polars` 负责数据分析，`python-calamine` 作为高速只读导入候选；只有确实需要 Excel 兼容计算或宏自动化时，再引入 `xlwings` 或受控的 Office 自动化方案。

## 2. 本报告比较的库与版本快照

| 库 | 截至报告日期可核实的版本/状态 | 主要职责 | 读文件 | 写文件 | 修改既有工作簿 |
|---|---|---|---:|---:|---:|
| [openpyxl](https://pypi.org/project/openpyxl/) | 3.1.5；PyPI 发布记录显示 2024-06-28 | XLSX/XLSM 工作簿对象模型 | 是 | 是 | 是 |
| [XlsxWriter](https://pypi.org/project/XlsxWriter/) | 3.2.9；PyPI 发布记录显示 2025-09-16 | 创建 XLSX 报表 | 否 | 是 | 否 |
| [pandas](https://pypi.org/project/pandas/) | 3.0.6；PyPI 上传记录显示 2026-09-17 | DataFrame 数据分析与 Excel I/O 引擎封装 | 是 | 是 | 不适合做保真式修改 |
| [Polars](https://pypi.org/project/polars/) | 2.0.0；PyPI 上传记录显示 2026-10-06 | 高性能 DataFrame 查询引擎 | 是（通过外部引擎） | 是（依赖 XlsxWriter） | 不适合做保真式修改 |
| [python-calamine](https://pypi.org/project/python-calamine/) | 0.8.3；PyPI 上传记录显示 2026-10-09 | Rust Calamine 的 Python 绑定，偏只读 | 是 | 否 | 否 |
| [xlwings](https://pypi.org/project/xlwings/) | 本次检索可见版本为 0.36.7；请在部署前重新确认 | 驱动桌面 Excel/工作簿自动化 | 是 | 是 | 是（经 Excel 对象模型） |
| [xlrd](https://pypi.org/project/xlrd/) | 2.0.2；PyPI 发布记录显示 2025-06-14 | 旧式 `.xls` 读取 | 仅 `.xls` | 否 | 否 |
| [pyxlsb](https://pypi.org/project/pyxlsb/) | 1.0.10；PyPI 发布记录显示 2022-10-14 | `.xlsb` 基础读取 | 是 | 否 | 否 |
| [formulas](https://pypi.org/project/formulas/) | 1.3.4；PyPI 发布记录显示 2026-03-11 | Excel 公式解析/求值的一种实现 | 非主要职责 | 非主要职责 | 非工作簿编辑引擎 |

版本来源：各库 PyPI 页面与官方文档。`xlwings` 版本快照来自当前检索到的发布信息，不代表版本号在未来不会变化。版本数字不是成熟度排名；版本发布频率较低也不等于项目必然不可靠，应结合维护活跃度、issue 处理和自身测试评估。

## 3. 核心能力矩阵

符号说明：**强** = 适合该类主要工作；**有限** = 可做基础操作或依赖额外引擎；**不适用** = 不是该工具定位。

| 能力 | openpyxl | XlsxWriter | pandas | Polars | python-calamine | xlwings | xlrd / pyxlsb |
|---|---|---|---|---|---|---|---|
| 读取单元格值 | 强 | 不适用 | 强 | 强（经引擎） | 强 | 强 | 仅对应旧格式 |
| 写入单元格值 | 强 | 强 | 强（DataFrame 导出） | 强（DataFrame 导出） | 不适用 | 强 | 不适用 |
| 修改既有工作簿 | 强 | 不支持 | 有限，不保证其他工作簿功能保真 | 有限，不保证其他工作簿功能保真 | 不支持 | 强（通过 Excel） | 不支持 |
| 样式/字体/边框/格式 | 强 | 新建时强 | 主要通过底层 writer 间接设置 | 基础/报表格式化能力 | 不负责写样式 | 强（由 Excel 执行） | 读取能力有限，不写 |
| 图表/图片/条件格式/数据验证 | 常见能力可用，需检查具体对象保真 | 新建文件能力强 | 依赖 writer，不是核心抽象 | 写入依赖 XlsxWriter | 不支持写入 | 可使用 Excel 对象模型 | 不支持写入 |
| 公式文本 | 可读取/写入公式字符串 | 可写入公式 | 可导入公式或缓存值，取决于 engine/参数 | 读入后通常作为数据值处理 | 读取公式信息依赖接口/文件 | 可获取公式和结果 | 格式及 API 有限 |
| 计算公式 | 不计算 | 不计算 | 不计算 | 不计算 | 不计算 | 由 Excel 计算 | 不计算 |
| 运行 VBA 宏 | 不执行；可在特定设置下保留 VBA 二进制 | 不执行 | 不执行 | 不执行 | 不执行 | 可以通过 Excel 自动化触发 | 不执行 |
| `.xlsx` | 是 | 写入 | 是 | 是 | 是 | 是 | xlrd 不支持；pyxlsb 不支持 |
| `.xlsm` | 读写，须注意 VBA 保留设置与对象兼容 | 不读取模板；不用于保留宏模板 | 读取依赖引擎，写出需谨慎 | 读取依赖引擎，写出需谨慎 | 支持读取（底层格式支持范围见文档） | 通过 Excel 支持 | 不支持 |
| `.xls` | 否 | 否 | 需选择支持的 engine | 需确认 engine 支持 | 是（读取） | 可由 Excel 打开 | xlrd 支持读取 |
| `.xlsb` | 否 | 否 | Calamine 或 pyxlsb 读取 | Calamine 引擎支持读取 | 是（读取） | 可由 Excel 打开 | pyxlsb 支持有限读取 |
| 大文件流式/低内存 | read-only / write-only 模式 | `constant_memory` 写入模式 | 需分块、挑列或换引擎，Excel I/O 本身仍有限制 | 面向大数据分析更合适，但读 Excel 仍需解析整文件/表格 | 可作为低开销批量读取候选 | 受 Excel 进程与对象模型影响 | 适合基础提取，不适合复杂编辑 |
| 适合服务端无桌面依赖 | 是 | 是 | 是 | 是 | 是 | 传统开源模式不适合 Linux 无 Excel 场景 | 是 |

能力矩阵是用途层面的概括，不是完整的 OOXML 兼容性承诺。对于复杂模板，尤其含有宏、切片器、透视表、外部链接、嵌入对象、数字签名、自定义 XML 或特殊扩展的工作簿，必须通过目标版本 Excel 实测保存前后差异。

## 4. 逐库分析：优势、限制与使用边界

### 4.1 openpyxl：一般工作簿读写的默认候选

**适用场景**：读取和修改 `.xlsx`/`.xlsm` 中的单元格、工作表、样式、合并单元格、名称区域、数据验证、条件格式、超链接、注释和常见图表；脚本按单元格坐标进行处理；不要求真正执行 Excel 公式。

**优势**

- 对工作簿提供比较直观的 Python 对象模型，读、写和修改代码容易维护。
- 支持普通模式以及 `read_only=True`、`write_only=True` 优化模式。官方文档说明优化模式可将内存使用降至接近常量级，但这需要接受功能限制和顺序访问模式。
- 不依赖安装 Microsoft Excel，适用于 Linux 容器和批处理服务。

**限制与风险**

- 性能和内存开销是主要取舍。普通模式会建立大量 Python 对象，大型工作簿可能消耗远高于压缩后 XLSX 文件大小的内存。
- read-only 模式是惰性读取且不可修改，使用后需显式 `close()`；还依赖原始文件中的 worksheet dimension 元数据，若文件记录不准确，需要检查或重置维度。
- 它不计算公式。`data_only=True` 读取的是文件里已有的缓存结果；若文件没有更新缓存，读取到的结果可能为空或过时。
- 打开并重存文件时，对未被库支持的 OOXML 扩展/特定高级对象需谨慎，不能把“可打开”当作“无损往返”。含宏文件需要显式考虑 `keep_vba=True` 等参数，且这不等于执行宏。
- 官方 PyPI 页面提示默认情况下不防护某些 XML 扩展实体/资源耗尽攻击。对不可信输入要使用 `defusedxml`，并设置压缩文件大小、行列和处理时间限制。

文档：[openpyxl 首页与项目说明](https://pypi.org/project/openpyxl/)；[优化模式](https://openpyxl.readthedocs.io/en/stable/optimized.html)。

### 4.2 XlsxWriter：高质量的新建报表

**适用场景**：从零生成周报、财务报表、数据导出、图表和格式要求高的 XLSX 文件。

**优势**

- 专门面向写文件，支持多工作表、格式、公式、超链接、合并单元格、图表、图片、自动筛选、条件格式、数据验证、打印布局等。
- 文档强调新建文件的 Excel 兼容性和功能覆盖；通过 `constant_memory` 可显著降低大文件写入时的内存压力。
- 不需要安装 Excel，适合无桌面环境里的报表生成服务。

**限制与风险**

- 它是 writer，不是编辑器：不能读取或修改已有 `.xlsx` 文件，也不能把现有文件当模板接着写。
- 不会在 Python 生成阶段计算公式，通常将公式和用于展示/兼容的缓存结果写入工作簿，并要求 Excel 或其他电子表格引擎打开时重算。某些不重算公式的预览器可能显示缓存的零值或旧结果。
- `constant_memory` 要求按行顺序写入，并减少/限制部分高级能力。要在内存和功能间作选择，必须用实际报表验证。

文档：[XlsxWriter 功能介绍](https://xlsxwriter.readthedocs.io/introduction.html)、[内存与性能](https://xlsxwriter.readthedocs.io/working_with_memory.html)、[FAQ：无法读取或修改已有文件](https://xlsxwriter.readthedocs.io/faq.html)。

### 4.3 pandas：Excel 是输入输出格式，DataFrame 才是核心

**适用场景**：将 sheet 读成二维数据集后做类型转换、缺失值处理、筛选、聚合、连接、统计、时间序列分析，再导出到 Excel/CSV/Parquet。

**优势**

- 数据清洗和分析生态成熟，和 NumPy、数据库 connector、Jupyter、统计库及可视化工具衔接好。
- `read_excel`、`ExcelFile` 和 `ExcelWriter` 提供较高层的多工作表读写接口。
- 现代 pandas 支持通过不同 engine 读不同格式；当前文档涵盖 `openpyxl`、`calamine`、`odf`、`pyxlsb`、`xlrd` 等。对于 `.xlsx/.xlsm`，可显式指定 engine，避免依赖默认值随版本变化。

**限制与风险**

- pandas 并不是完整的工作簿对象模型。将 Excel 读入 DataFrame 会把单元格结构映射到列/行与数据类型；样式、绘图对象、控件、宏等不是典型 DataFrame 数据，导出时不应指望原样保留。
- 自动推断类型有可能改变业务上重要的表示形式，例如前导零的账号/邮编、长数字编码、混合类型列、日期、空白和错误值。应显式指定 `dtype`、`converters`、日期解析和 NA 策略，并对关键字段做校验。
- 读 Excel 常常由底层引擎完成，性能瓶颈可能在解压、XML/二进制解析以及将结果组装为 DataFrame；不能只因为后续 pandas 操作快，就认为读 Excel 也快。
- pandas 3.x 的版本升级可能包含类型语义和依赖变化，需锁定版本并覆盖兼容性测试。

文档：[pandas Excel I/O](https://pandas.pydata.org/pandas-docs/stable/user_guide/io.html#excel-files)、[`read_excel` API](https://pandas.pydata.org/pandas-docs/stable/reference/api/pandas.read_excel.html)。

### 4.4 Polars：大批量数据变换与查询

**适用场景**：读入 Excel 中的表格数据后做列式计算、过滤、分组聚合、连接和多文件分析，尤其关注吞吐、内存与多核执行。

**优势**

- 核心数据引擎以 Rust 实现，擅长表达式化的数据变换与查询优化。
- 官方 Excel 指南推荐默认 `fastexcel` 读取引擎（基于 Rust Calamine）；文档将其描述为可用读取引擎中速度最快的一类。Polars 的写 Excel 能力通过 `xlsxwriter` 依赖实现。
- 读取多个文件/工作表并转成 DataFrame 有专门接口，适合数据导入与分析管道。

**限制与风险**

- Polars 没有自己的原生 Excel 文件解析器；Excel I/O 性能及兼容性依赖外部 engine。复杂文件若使用 Calamine 不能满足需求，可测试 openpyxl 或 xlsx2csv 后备路径。
- 数据模型强调列式数据，不是保留所有 workbook 细节的编辑模型。不要用 `read_excel -> DataFrame -> write_excel` 来“无损修改”一个含复杂样式、图表、宏或控件的模板。
- 官方建议：若可选择数据交换格式，性能上优先考虑 Parquet 或 CSV，而不是 Excel。Excel 更适合人类消费和交付，不适合当大型数据仓库格式。
- Polars 2.0.0 是近期的主版本变化；应阅读升级指南，尤其是生产系统的 API 和执行结果兼容性测试。

文档：[Polars Excel I/O 指南](https://docs.pola.rs/user-guide/io/excel/)、[Polars 2.0 升级指南](https://docs.pola.rs/user-guide/upgrade/2/)。

### 4.5 python-calamine / fastexcel：高速读取路线

**适用场景**：批量读取 `.xlsx`、`.xlsm`、`.xls`、`.xlsb` 或 ODS 中的表格数据，目标是提取值并送入数据处理流程，而不是编辑工作簿。

**优势**

- `python-calamine` 是 Rust Calamine 引擎的 Python binding；Polars 通过 `fastexcel` 使用 Calamine 来解析 Excel，并建议将其作为默认读取路径。
- 在大量文件、服务端导入和只读数据抽取场景里，值得优先纳入性能 PoC。
- 最新检索到的 python-calamine 0.8.3 发布于 2026-10-09，PyPI 标示 MIT 许可、Python >= 3.10，并显示 beta 开发状态。对需要强长期稳定性的系统，应加上兼容性测试和版本锁定。

**限制与风险**

- 这是读取器，不是工作簿编辑库；不能用它保留/修改样式、图表或写回文件。
- 快速导入意味着按库的数据模型交付数据，不等于完整保留 Excel 的空行空列、格式、公式语义或其他 workbook 元数据。Calamine 默认会跳过数据区域前后的空白行列，具体行为需显式测试。
- 如果业务需要公式计算结果，确认读取的是公式表达式还是文件已有缓存值，并用 Excel 输出结果做对照。

文档：[python-calamine PyPI](https://pypi.org/project/python-calamine/)、[fastexcel 文档与 benchmark 说明](https://docs.rs/crate/fastexcel/latest/source/README.md)、[Polars 的 engine 建议](https://docs.pola.rs/user-guide/io/excel/)。

### 4.6 xlwings：调用真实 Excel 引擎

**适用场景**：必须调用 Excel 公式计算、Excel 对象模型、VBA 宏、特殊插件或 Excel 自身才可复现的工作簿行为。

**优势**

- 不是自己重新实现 Excel 文件格式，而是自动化真实 Excel 应用。对于依赖 Excel 计算引擎的工作流，这与纯文件库有本质差别。
- 可操纵工作簿、工作表、区域、公式与应用对象，适合与既有 Excel 模型集成。

**限制与风险**

- xlwings 传统开源模式要求安装 Microsoft Excel，主要支持 Windows 和 macOS；它不是 Linux 服务器中纯 Python 的无头文件处理器。官方文档提到的 PRO / Server 产品具有不同能力和授权模型，应单独评估。
- Excel 是有状态的桌面应用，进程启动、计算链、弹窗、加载项、文件锁、用户会话和并发隔离都会成为运行时问题。不能简单按照普通 stateless Python worker 的方式水平扩缩容。
- Excel 自动化在服务器场景中需要专门处理挂起、进程回收、超时、临时文件清理与许可证；高并发批量数据导入通常不应依靠启动 Excel 实例完成。
- 若通过 Excel 计算公式，仍然要明确宏安全策略、外部链接、数据连接、插件版本和是否允许访问外部资源。

文档：[xlwings 安装与平台要求](https://github.com/xlwings/xlwings/blob/main/docs/installation.md)、[xlwings Server](https://server.xlwings.org/en/latest/)。

### 4.7 xlrd 与 pyxlsb：遗留格式的专用读取工具

- `xlrd` 现在只读取历史 `.xls` 格式，不支持 `.xlsx`。项目说明明确指出，图表、图片、宏、嵌入对象及 VBA 模块等并非它要保留的内容。适合兼容旧文件，不应作为新 XLSX 系统的通用依赖。
- `pyxlsb` 是 `.xlsb` 读取器，项目描述称其功能非常有限，但足以进行基本数据抽取；当前 PyPI 可见发布较旧。若只是读 XLSB，建议先评估 pandas 的 `calamine` engine，再对 pyxlsb 做兼容性比较。
- 对旧格式应把“能读出单元格值”与“能完整保留工作簿语义”分开验收。不要让遗留格式解析器承担编辑和再保存的任务。

资料：[xlrd 项目说明](https://pypi.org/project/xlrd/)、[pyxlsb 项目说明](https://pypi.org/project/pyxlsb/)、[pandas 对 Excel engine 的说明](https://pandas.pydata.org/pandas-docs/stable/user_guide/io.html#excel-files)。

### 4.8 formulas：公式解释/计算并不等于 Excel

`formulas` 可解析工作簿公式并尝试求值，适用于需要 Python 内部公式解析、依赖分析或特定公式子集计算的场景。PyPI 的 1.3.4 页面列出 536 个跟踪函数中的 483 个已实现，覆盖率为 90.1%；这说明它有实用价值，同时也说明覆盖并非百分之百。

函数覆盖率不能简单等同于与 Excel 的兼容率：同名函数还可能涉及错误值传播、动态数组、隐式交叉、区域引用、外部链接、日期系统、迭代计算和版本差异。对金融、会计或监管关键模型，必须构建真实工作簿回归集，与目标 Excel 版本逐单元格比对。

资料：[formulas PyPI 与函数覆盖率](https://pypi.org/project/formulas/1.3.4/)。

## 5. 性能：能证明什么，不能证明什么

### 5.1 公开基准快照

2026-04-29 发布的 [ExcelBench 性能报告](https://github.com/SynthGL/ExcelBench/blob/master/results-release-2026-04-28/perf/README.md) 给出了 macOS Darwin-arm64、Python 3.12.3、预热 3 次、固定 25 次迭代的 XLSX 基准。它的指标是 `p50 wall time`，报告中的表格标注为毫秒。对 Tier 0 “基础单元格值”场景，公开结果包含：

| 路径 | 读/写 | p50（ms，按基准报告） | 解读 |
|---|---|---:|---|
| openpyxl | 读取 | 1.36 | 完整工作簿模型，但不是读取最快路线 |
| openpyxl | 写入 | 1.42 | 创建/写入基础值 |
| openpyxl read-only | 读取 | 5.00 | 此微型测试中并不更快；主要价值是控制大文件内存 |
| pandas | 读取 | 1.79 | 包含 DataFrame 转换路径的测量结果 |
| pandas | 写入 | 1.79 | 包含 DataFrame 导出路径的测量结果 |
| Polars | 读取 | 0.33 | 对该基准里的基础值读取很快 |
| python-calamine | 读取 | 0.93 | 专用读取路径 |
| XlsxWriter | 写入 | 1.90 | 专门写入路线；功能和性能测试不是同一件事 |
| XlsxWriter constant-memory | 写入 | 1.85 | 此小场景没显出大差距，低内存收益主要应在大文件验证 |

**重要限制：** 这个结果只说明该 benchmark 配置下的相对表现，不能推导任意 Excel 文件的实际耗时。尤其是小型 fixture 的毫秒级结果、文件结构复杂度、工作表数量、公式和样式数量，与数百 MB 文件或生产任务差别巨大。公开页面没有在汇总表中完整呈现所有文件的规模、对象复杂度、版本和内存条件，因此不应把它当作普适的库排名。

同一 ExcelBench 的 [保真度面板](https://github.com/SynthGL/ExcelBench/blob/master/results-release-2026-04-28/DASHBOARD.md) 声称其测试集中的 openpyxl 通过了 18/18 个所测功能，而只读/数据框路径的通过项明显较少；XlsxWriter 常规写模式为 15/18，constant-memory 为 12/18。该分数属于特定 benchmark 的功能集和判定规则，不是所有 Excel 特性的正式兼容性认证。它对架构设计的价值在于提醒我们：**性能、内存与文件保真度必须分别测量。**

### 5.2 为什么不同 benchmark 常常得出不同结论

1. **读与写不是同一种工作负载。** XlsxWriter 不能读文件，拿它与读写库比较“全流程速度”没有意义。
2. **只读与可编辑模式的目标不同。** openpyxl read-only 用惰性访问减少内存对象，不保证比普通模式更适合每个小文件；constant-memory 写入通过按行写入换取低内存。
3. **格式保真度有成本。** 读取大量样式、边框、合并区域、公式、图片、图表或外部链接，比只提取值更贵。
4. **数据转换本身有成本。** pandas/Polars 还需要把表格转为列式/行式数据结构；计时要说明是否包含 DataFrame 构造、类型推断和后处理。
5. **运行环境影响结果。** SSD、CPU、Python 版本、Rust wheel、冷/热缓存、并发、文件压缩率及文件系统都可能改变排序。
6. **内存不能只看耗时。** 建议同时测 RSS 峰值、分配量、输出文件大小和进程稳定性。

### 5.3 生产性能验收建议

建立自己的基准样本集，至少包括：

- 纯数据表（10 万、100 万行级别，按业务实际列数）；
- 多 sheet、样式密集型模板；
- 大量公式、名称区域、合并单元格和数据验证；
- 含图表、图片、外部链接或宏的真实模板；
- 结构异常但业务允许读取的文件；
- `.xls` 和 `.xlsb` 遗留输入。

对每个方案记录冷启动和热启动耗时、P50/P95、峰值 RSS、吞吐（行/秒或文件/分钟）、读取/写入的正确性，以及重新打开输出文件后的功能差异。性能测试应分别运行“只读取值”“读取公式”“修改一小块区域并重存”“新建格式化报表”“公式重算”等场景，不能合并成一个总分。

## 6. 公式、格式、模板与数据正确性风险

### 6.1 公式值与公式表达式必须区分

XLSX 文件里的公式与缓存结果是不同的信息。读取公式时可能得到类似 `=SUM(A1:A10)` 的表达式；读取缓存值则获取文件上次保存时记录的结果。纯文件库通常不会完整运行 Excel 公式计算引擎。若使用 `data_only=True`，不能据此推断公式会被重新计算。

对于重要输出，选择以下其中一种明确策略：

- 交给用户打开 Excel 后重算，并确认客户端会触发重算；
- 由 xlwings 调用受控的 Excel 实例重算；
- 评估公式解释器或 LibreOffice Calc 等替代计算引擎，但要用真实模型比较公式覆盖率和计算语义。

### 6.2 既有工作簿不要默认无损往返

“读取—保存”可能影响第三方工具添加的扩展对象、特殊图表、切片器、透视表、外部连接、签名或宏周边结构。对于业务模板，保存前后应在副本上测试，并在 Excel 中重新打开、重算和验证关键区域。需要极高保真度时，应考虑让 Excel 本身修改文件，或通过 OOXML ZIP 包的定点修改实现小范围更改（但直接修改 OOXML 复杂且易破坏关系引用，必须有严格测试）。

### 6.3 类型转换风险

对业务代码，以下数据要考虑以字符串读入或使用显式 converter：账号、邮编、交易号、客户号、长数字 ID、带前导零的编码、混合日期列、百分比和货币。浮点数在 Excel、Python 与 CSV 之间的表示可能不同；对货币和精确数量应明确定点数/decimal 策略。

### 6.4 不可信文件与资源控制

XLSX 本质上是 ZIP 容器和一组 XML/关系文件。对用户上传文件，要限制压缩包展开体积、工作表数量、最大行列、解析时间和内存；防护恶意 XML 和压缩炸弹；在隔离进程中处理，不要只依赖库本身的默认设置。

## 7. 许可、维护与部署维度

| 库 | 许可/生态提示 | 部署注意事项 |
|---|---|---|
| openpyxl | MIT；成熟、使用广泛 | 纯 Python 易部署；不可信 XML 文件需额外安全措施 |
| XlsxWriter | BSD-2-Clause；文档和测试完善 | 纯 Python；适合服务端生成新文件 |
| pandas | BSD-3-Clause | Excel engine 需作为依赖管理；要处理类型语义升级 |
| Polars | MIT/Apache-2.0 双许可（核实所用发行包） | native Rust wheels、版本升级与 CPU/内存配置应纳入测试 |
| python-calamine | PyPI 当前页标示 MIT；当前状态标示 Beta | 依赖 native wheel；部署时确认操作系统/Python ABI 的 wheel 可用性 |
| xlwings | 开源版与 PRO/Server 产品的授权和能力需分开核实 | Excel 安装、进程管理、并发控制、桌面会话和自动化策略是主要风险 |
| xlrd | BSD 风格许可（以发行物 metadata 为准） | 仅用于 `.xls`，不要期待新格式支持 |
| pyxlsb | MIT（以发行物 metadata 为准） | 功能较有限且发布较久，需评估维护与格式边界 |
| formulas | EUPL-1.1 | 注意许可证兼容性与公式函数覆盖率 |

合规建议：在实际交付中，以锁定的 wheel/sdist、依赖树和软件物料清单（SBOM）为准审核许可；本表是技术筛选起点，不替代法律审查。

## 8. 场景化选型建议

| 业务目标 | 首选方案 | 备选/组合 | 不建议的做法 |
|---|---|---|---|
| 修改现有 XLSX 的单元格和值，保留常见样式 | openpyxl | 复杂工作簿可评估 xlwings | 用 DataFrame 重建整个文件，期待格式无损 |
| 从零生成样式复杂、包含图表和条件格式的报表 | XlsxWriter | pandas + XlsxWriter | 用 openpyxl 强行承担所有报表生成需求而不做对比 |
| 读取数据、清洗、聚合和分析 | pandas | Polars | 为每个单元格手工建模再重新实现分析能力 |
| 大量 XLSX/XLSB 文件只读导入 | python-calamine/FastExcel | pandas engine='calamine'；Polars | 因为原始文件有 Excel 样式就强制用工作簿对象读取全部对象 |
| 大文件流式写出 | XlsxWriter `constant_memory` | openpyxl `write_only` | 先把整个数据集构造成大量单元格对象再写出 |
| 必须运行真实 Excel 公式或宏 | xlwings + 受控 Excel 实例 | 评估兼容计算引擎 | 认为 openpyxl/XlsxWriter 写公式后即可得到正确计算结果 |
| 处理旧 `.xls` | xlrd 读取 | pandas 对应 engine，迁移后转为 XLSX/Parquet | 试图用 openpyxl 打开 `.xls` |
| 处理 `.xlsb` | 先测试 Calamine engine | pyxlsb 作为兼容候选 | 默认假定 pyxlsb 支持写入或保真修改 |
| 高吞吐内部数据交换 | Parquet/Arrow/数据库 | CSV（需谨慎处理类型） | 将 Excel 作为大型数据平台的长期存储层 |

## 9. 建议的 PoC 实施计划

### 第一阶段：确定语义要求

先回答四个问题：输入文件是什么格式？是否要修改既有工作簿？是否依赖公式/宏/图表？系统是否能安装 Excel？这些约束通常比微基准速度更能决定技术路线。

### 第二阶段：选出两到三个候选

- 工作簿修改：openpyxl 与 xlwings（如果确实可安装 Excel）对比。
- 新建报表：XlsxWriter 与 openpyxl 对比。
- 只读分析：pandas + openpyxl、pandas + calamine、Polars + fastexcel 对比。
- 遗留文件：只对相关格式加入 xlrd/pyxlsb。

### 第三阶段：统一测试与验收

固定相同机器、Python 版本、输入文件副本与计时方式；每次测试前关闭或重置缓存影响；记录实际库版本、engine、参数、文件大小、行列数、公式/样式/图表数量。所有输出必须重新打开验证，比较关键单元格、公式、样式、合并区域、图表、名称、宏与外部链接等。

验收指标建议至少有：

- **正确性**：必需字段一致率、日期/精度正确率、错误值与空值行为；
- **文件保真度**：保存前后需要保留的 workbook 功能逐项通过；
- **性能**：P50/P95 耗时、文件/分钟、行/秒；
- **资源**：峰值 RSS、CPU 使用率、输出文件体积；
- **韧性**：损坏文件、错误维度、超大 ZIP 条目、超时和进程崩溃能否可控失败；
- **运维**：版本升级兼容性、native wheel、许可证、日志与失败恢复。

## 10. 最终推荐

对多数 Python 企业应用，可将工具分成三层而不是互相替代：

1. **文件编辑层：** 以 openpyxl 为默认候选；对需要保留 Excel 独有行为的工作簿，转为 Excel 自动化路线，不做未经验证的无损承诺。
2. **报表生成层：** 用 XlsxWriter 生成新文件；对大文件写出评估 constant-memory 模式，并按行顺序写入。
3. **数据处理层：** pandas 用于生态广泛、表达方式成熟的分析；Polars 用于大批量列式转换/查询；Calamine/FastExcel 用于高速读取数据源。

**最重要的工程判断：** 不要把 Excel 库的性能等同于 Excel 工作簿处理能力。真正的选型指标是：在业务实际文件上，工具能否正确表达需要的语义、是否会损坏原有对象、能否满足吞吐和内存预算，以及部署与许可是否可接受。性能差距应通过同一批真实文件进行基准测试，而不是从通用排行榜直接决定。

## 11. 参考资料

### 官方文档与发布信息

1. [openpyxl — PyPI](https://pypi.org/project/openpyxl/)；[Optimised Modes](https://openpyxl.readthedocs.io/en/stable/optimized.html)
2. [XlsxWriter — PyPI](https://pypi.org/project/XlsxWriter/)；[Introduction](https://xlsxwriter.readthedocs.io/introduction.html)；[Memory and Performance](https://xlsxwriter.readthedocs.io/working_with_memory.html)；[FAQ](https://xlsxwriter.readthedocs.io/faq.html)
3. [pandas — PyPI](https://pypi.org/project/pandas/)；[Excel I/O User Guide](https://pandas.pydata.org/pandas-docs/stable/user_guide/io.html#excel-files)；[`read_excel` API](https://pandas.pydata.org/pandas-docs/stable/reference/api/pandas.read_excel.html)
4. [Polars — PyPI](https://pypi.org/project/polars/)；[Excel User Guide](https://docs.pola.rs/user-guide/io/excel/)；[2.0 Upgrade Guide](https://docs.pola.rs/user-guide/upgrade/2/)
5. [python-calamine — PyPI](https://pypi.org/project/python-calamine/)；[fastexcel README](https://docs.rs/crate/fastexcel/latest/source/README.md)
6. [xlwings — PyPI](https://pypi.org/project/xlwings/)；[Installation and Prerequisites](https://github.com/xlwings/xlwings/blob/main/docs/installation.md)；[xlwings Server](https://server.xlwings.org/en/latest/)
7. [xlrd — PyPI](https://pypi.org/project/xlrd/)；[pyxlsb — PyPI](https://pypi.org/project/pyxlsb/)
8. [formulas — PyPI 1.3.4](https://pypi.org/project/formulas/1.3.4/)

### 公开 benchmark

9. [ExcelBench Performance Results, release 2026-04-28](https://github.com/SynthGL/ExcelBench/blob/master/results-release-2026-04-28/perf/README.md)
10. [ExcelBench Dashboard: capability/fidelity results](https://github.com/SynthGL/ExcelBench/blob/master/results-release-2026-04-28/DASHBOARD.md)

> **来源与结论的边界：** 官方文档适合确认支持范围和使用限制；项目自有 benchmark 反映其指定环境；第三方 benchmark 反映其指定测试集。本文未把任何单一来源视为通用的性能排名，也未在本次报告中运行本地同机基准。
