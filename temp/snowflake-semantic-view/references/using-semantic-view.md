# 如何使用 Snowflake Semantic View

## 1. 必须使用 Snowflake Cortex Agent 吗？

**不需要。Semantic View 是 Snowflake 数据库中的语义对象，不是 Agent 专属的数据源。** 创建并部署后，可以直接使用 SQL 查询，也可以让 BI 工具或应用通过 Snowflake 驱动执行 SQL。如果需要自然语言问答，可以选择 Cortex Agent；对于某些既有集成，也可以直接调用 Cortex Analyst REST API。Snowflake 官方文档列出了 SQL、Cortex Agents 和 Cortex Analyst REST API 等使用方式。

参考：[Using semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/using)、[Querying semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/querying)、[Cortex Analyst REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api)。

| 使用方式 | 是否需要 Cortex Agent | 适合场景 |
|---|---|---|
| Snowsight Worksheet / SQL 客户端 | 否 | 开发、审计、固定报表、排障 |
| Python、JDBC、ODBC、Snowflake SQL API | 否 | 应用后端、批处理、确定性数据管道 |
| BI 工具 | 否 | 仪表盘和常规分析；需确认具体连接器的兼容方式 |
| Cortex Analyst REST API | 不一定 | 既有应用直接调用自然语言分析能力 |
| Cortex Agent | 需要 Agent | 多轮对话、自然语言分析、需要 Agent 协调其他工具的应用 |

Snowflake 当前文档建议向 Cortex Agents 迁移以获得更完整的 Agent 工作流；这不代表所有 Semantic View 查询都必须经过 Agent。对于固定、可审计的报表或 API，直接 SQL 往往更简单、更可控。

## 为什么 Semantic View 能帮助 Natural Language Query（NLQ）

**Semantic View 本身不是自然语言模型，也不会自动把一句话变成 SQL。** 它的价值在于为 NLQ 系统提供一份可查询、可治理的业务语义契约，让 LLM 不必只凭列名、数据库注释或 Prompt 猜测“用户说的业务概念对应哪张表、哪个字段、怎样计算、如何关联”。

Snowflake 官方将 Semantic View 定义为数据库中的业务语义对象：它集中定义逻辑表、维度、事实、指标和关系；AI 应用可以结合这些规则与 LLM 推理，生成更符合业务定义的查询。参考 [Semantic View overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview) 和 [Semantic View YAML specification](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)。

### 没有 Semantic View 时，NLQ 必须自己猜什么？

假设业务用户问：

> 截至 2026-10-27，各投资组合的市值是多少？按资产类别拆分，并显示未实现盈亏。

只给 LLM 物理 schema 时，它可能看到 `FACT_POSITION_DAILY`、`DIM_PORTFOLIO`、`DIM_SECURITY` 和诸如 `MARKET_VALUE_USD` 的列名，但仍需自行推断：

- “市值”应该用哪一列？是单证券市值、组合总市值，还是其他估值字段？
- 应该用 `SUM`、`AVG` 还是其他聚合？组合 + 证券 + 估值日的行粒度是什么？
- 组合名称与资产类别分别来自哪里？要通过哪些键关联？
- “截至某日”表示只取这个估值日，还是累积该日期以前的记录？
- 未实现盈亏是否以 USD 表示？它与市值是否使用一致的口径？
- 是否允许把多天的持仓快照加总？

LLM 即使生成了语法正确的 SQL，也可能在指标、连接路径、粒度或时间语义上犯错。单靠更长的 Prompt，无法保证所有应用都采用同一口径。

### Semantic View 如何提供约束

本项目的 `position_analytics.yaml` 展示了几种直接帮助 NLQ 的机制：

| Semantic View 元素 | 在 NLQ 中的作用 | 本项目中的例子 |
|---|---|---|
| 指标（metrics）及表达式 | 告诉系统业务指标的权威计算方式，避免每次重新推导聚合公式 | `TOTAL_MARKET_VALUE_USD = SUM(MARKET_VALUE_USD)` |
| 同义词（synonyms） | 把用户的业务用词连接到已定义的语义元素 | “market value”“total portfolio market value”“assets under management by position” |
| 描述（description） | 解释指标、维度和字段的业务含义与使用限制 | 市值是指定估值日的 USD 持仓快照，不应跨日期相加 |
| 维度（dimensions / time_dimensions） | 指明可用于分组、过滤的业务属性 | `PORTFOLIO_NAME`、`ASSET_CLASS`、`AS_OF_DATE` |
| 逻辑表和关系（logical tables / relationships） | 规定可用实体及其关联键，减少模型猜测 join 的空间 | `POSITION_DAILY` 关联 `PORTFOLIO` 和 `SECURITY` |
| 粒度、主键和非可加性说明 | 提醒系统哪些组合与聚合有业务意义，尤其是时点指标 | 每行是组合 + 证券 + 估值日；市值按估值日非可加 |
| 已验证问题（verified queries，如定义中配置） | 为常见问题提供已审核的问法与 SQL 示例，作为相似问题的参考和回归样本 | “截至某估值日各组合的总市值是多少？” |

这些元数据将“业务人员说的话”与“数据库中的物理实现”之间的映射从每次临时推断，变成可版本化、可评审和可复用的定义。具体哪些字段可用、哪些同义词和 verified queries 会被某个 NLQ 引擎读取，取决于该引擎及其集成方式；不能假设任意 LLM 自动读取 Snowflake 中的 Semantic View。

### 从自然语言到查询的实际链路

以问题“截至 2026-10-27，各组合按资产类别的总市值是多少？”为例，NLQ 系统需要完成以下工作：

~~~mermaid
flowchart TD
    Q["自然语言问题"] --> I["识别意图：市值、估值日、组合、资产类别"]
    I --> G["从 Semantic View 语义定义中匹配指标、维度、同义词和关系"]
    G --> P["构造受约束的查询计划"]
    P --> V["校验元素存在、关系可达、时间和粒度规则"]
    V --> SQL["生成 Semantic SQL / SQL"]
    SQL --> DB["Snowflake 执行"]
    DB --> E["检查结果、错误和查询证据"]
    E --> A["用自然语言解释结果"]
~~~

关键是：Semantic View 提供可被 NLQ 系统使用的业务定义，NLQ 引擎负责理解用户问题并选择语义元素，查询执行层负责运行查询。三者不是同一个组件。

### Semantic View 能改善什么，不能保证什么？

它通常可以减少指标公式不一致、物理字段猜测、连接路径不一致和业务术语不匹配；如果正确建模，还可以明确时点指标的非可加性、维度含义和数据关系。它不能自动保证：

- 语义定义本身是正确的，或与最新业务政策一致；
- 模型正确理解了用户含糊的意图，或正确选择了所有指标和过滤条件；
- 所有 NLQ 框架都会自动发现、读取或遵守 Semantic View；
- 生成的 SQL 没有错误，结果已经与独立基准核对；
- 数据权限仅靠语义描述就能得到保护。

因此，生产级 NLQ 仍需要受限查询计划、服务端验证、Snowflake 权限控制、Verified Query/已知答案回归，以及对歧义问题的澄清策略。

### 在 LangChain Deep Agents 中尤其要注意

Semantic View 不会因为 Deep Agent 使用了 Snowflake Connector 就自动进入模型上下文。应用必须明确选择一种集成方式：

1. **固定查询工具**：把常见业务问题封装为参数化工具。实现简单、风险较低，但只支持预先定义的查询形态。
2. **语义目录 + 受限查询计划**：把允许的指标、维度、同义词、关系和使用规则提供给 Agent；Agent 输出结构化计划，服务端验证后再编译为查询。这更适合可控范围内的 NLQ。
3. **调用 Snowflake 的 NLQ 服务**：例如在适用场景下使用 Cortex Analyst API，或通过 Cortex Agent 组织自然语言分析。这样由对应的 Snowflake 服务处理其支持的语义上下文和 NLQ 流程。

本项目的 [Deep Agents 示例](langchain-deepagents-semantic-view.md) 当前采用第一种方式：模型选择并调用一个固定的“指定估值日组合市值”工具。它展示了如何安全地消费 Semantic View，但**不是通用的自然语言到 SQL 引擎**，也没有自动读取 YAML 的所有指标、维度或关系。若目标是让用户自由提问“按策略、资产类别、国家、两个估值日比较”等问题，需要继续实现第二种方式或集成受支持的 NLQ 服务；不能只把 Prompt 改成“请使用 Semantic View”就认为完成了。

参考：[Semantic View overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)、[Semantic View YAML specification](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec)。

## 2. 方式一：直接用 SQL 查询 Semantic View

本实验室的对象为：

**SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW**

先确认对象已部署：

~~~sql
SHOW SEMANTIC VIEWS IN SCHEMA SV_FINANCE_LAB.MART;

DESCRIBE SEMANTIC VIEW
  SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW;
~~~

### 2.1 按一个估值日查询组合指标

~~~sql
SELECT
    PORTFOLIO_NAME,
    AS_OF_DATE,
    AGG(TOTAL_MARKET_VALUE_USD) AS MARKET_VALUE_USD,
    AGG(TOTAL_COST_BASIS_USD) AS COST_BASIS_USD,
    AGG(TOTAL_UNREALIZED_PNL_USD) AS UNREALIZED_PNL_USD,
    AGG(POSITION_COUNT) AS POSITION_COUNT
FROM SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW
WHERE AS_OF_DATE = '2026-10-27'
GROUP BY PORTFOLIO_NAME, AS_OF_DATE
ORDER BY PORTFOLIO_NAME;
~~~

这条 SQL 使用 Semantic View 中已定义的指标和维度，而不是在查询时重新实现底层事实表连接和指标公式。AGG() 用于在 Semantic View 查询语境中引用已定义的指标。实际列名、指标名和对象名必须与部署后的定义一致。

示例日期和金额属于本仓库的教学 fixture。接入真实数据后，应使用业务认可的估值日，并用独立 SQL/已知预期结果对账。

### 2.2 显式指定本次查询所需的指标和维度

Snowflake 也支持在 FROM 子句中使用 SEMANTIC_VIEW(...)，显式声明本次查询需要的语义元素：

~~~sql
SELECT *
FROM SEMANTIC_VIEW(
    SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW
    METRICS POSITION_DAILY.TOTAL_MARKET_VALUE_USD
    DIMENSIONS PORTFOLIO.PORTFOLIO_NAME, POSITION_DAILY.AS_OF_DATE
)
WHERE AS_OF_DATE = '2026-10-27'
ORDER BY PORTFOLIO_NAME;
~~~

这里的 POSITION_DAILY、PORTFOLIO 是 YAML 中定义的逻辑表名，TOTAL_MARKET_VALUE_USD 是指标名。若目标环境的已部署定义使用不同别名或命名，应以实际定义为准。此写法适合明确指定本次查询的语义元素；另一种方式是像 2.1 一样直接引用 Semantic View 对象。

查询中选择的维度与指标必须存在有效关系。复杂模型中若存在多条可用关系路径，应按官方语法显式消除歧义。SQL 能解析不代表连接结果或指标口径一定正确。

### 2.3 金融指标为什么通常要筛选估值日

本例中的持仓表粒度是“组合 + 证券 + 估值日”。总市值、总成本基础和未实现盈亏都是时点指标，不能把每天的快照直接相加并称为月度资产规模。查询某日组合总额时应筛选该估值日；月末值、月平均值或期间变化需要单独定义业务口径与指标。

~~~sql
SELECT
    PORTFOLIO_NAME,
    AGG(TOTAL_MARKET_VALUE_USD) AS MARKET_VALUE_USD
FROM SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW
WHERE AS_OF_DATE = '2026-10-27'
GROUP BY PORTFOLIO_NAME;
~~~

不要简单移除日期过滤，再把多日每日市值相加后称为“月度资产规模”。

## 3. 方式二：应用代码查询，不使用 Agent

对于固定报表、定时任务或应用 API，可以让应用执行参数化 SQL。以下为 Python Snowflake Connector 示例：

~~~python
import os
import snowflake.connector

conn = snowflake.connector.connect(
    account=os.environ["SNOWFLAKE_ACCOUNT"],
    user=os.environ["SNOWFLAKE_USER"],
    authenticator=os.getenv("SNOWFLAKE_AUTHENTICATOR", "externalbrowser"),
    warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
    database="SV_FINANCE_LAB",
    schema="MART",
    role=os.environ["SNOWFLAKE_ROLE"],
)

try:
    sql = """
        SELECT
            PORTFOLIO_NAME,
            AGG(TOTAL_MARKET_VALUE_USD) AS MARKET_VALUE_USD
        FROM SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW
        WHERE AS_OF_DATE = %s
        GROUP BY PORTFOLIO_NAME
        ORDER BY PORTFOLIO_NAME
    """
    with conn.cursor() as cur:
        cur.execute(sql, ("2026-10-27",))
        for row in cur:
            print(row)
finally:
    conn.close()
~~~

示例通过绑定参数传入日期，避免直接拼接用户输入。生产服务应使用组织批准的非交互认证方式、秘密管理和连接池，并记录 SQL、参数、Query ID、执行时间与调用方；不要在源码中保存密码或 Token。

如果业务问题和查询结构固定，直接 SQL 的优点是确定性高、易测试、易审计。Semantic View 仍然提供统一的指标定义，不要求每个应用重新实现指标公式。

## 4. 方式三：Cortex Analyst REST API

如果应用需要用户输入自然语言问题，但不需要 Agent 协调其他工具，可以评估直接调用 Cortex Analyst REST API。请求中指定 Semantic View 和用户问题，API 返回分析响应，其中可能包含生成的 SQL 等内容。应用还需要处理身份认证、API 错误、结果呈现，以及 SQL 执行和结果安全策略。

Snowflake 当前 API 文档建议向 Cortex Agents 迁移。因此，新建、需要多轮对话或工具协调的应用应比较 Agent 方案；但这不等于 Semantic View 只能通过 Agent 使用。

参考：[Cortex Analyst REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api)。

## 5. 方式四：通过 Cortex Agent 进行自然语言分析

当用户需要自然语言问答、多轮追问，或希望一个 Agent 同时使用语义分析和其他受支持工具时，可以将 Semantic View 配置为 Agent 可用的工具。一般步骤如下：

1. 先完成 Semantic View 建模、服务端验证、部署和业务回归。Agent 不会自动修复错误的指标定义。
2. 在当前账户支持的 Agent 配置界面或 API 中创建/更新 Agent，将目标 Semantic View 添加为语义分析工具。具体配置以当前 Snowflake 官方文档和账户支持情况为准。
3. 为 Agent 提供清晰的使用说明：指标适用粒度、默认时间范围、时点指标限制、币种定义、禁止的推断，以及需要向用户澄清的问题。
4. 建立固定评估问题，例如：
   - 截至 2026-10-27，每个投资组合的总市值是多少？
   - 同一估值日，各组合的成本基础和未实现盈亏分别是多少？
   - 按资产类别汇总某日市值。
   - 比较两个估值日的市值变化。只有模型和指标定义支持明确的跨期比较口径时，才允许回答。
5. 对每个问题检查生成 SQL、执行结果和业务预期；记录错误类型、Query ID、Agent 配置版本和回归结果。尤其要测试时点指标、连接关系和安全边界。
6. 评估通过、权限确认和发布审批完成后，再向业务用户开放 Agent。

Agent 的工具、模型和配置能力会随账户、区域、权限及产品版本变化。不要假设每个账户都能看到相同的配置选项。

参考：[Using semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/using)、[Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents)。

## 6. 权限与安全

Snowflake 文档说明：对于非对象 owner 的角色，查询 Semantic View 需要该 Semantic View 的 SELECT 权限；查询者不需要仅仅因为使用 Semantic View，就同时获得其底层源表的 SELECT 权限。数据库和 schema 的访问仍须符合相应的权限要求。

Semantic View 可以成为受控的业务语义访问层，但它不会自动替代完整的安全策略。部署前应分别验证：

- 哪些角色可以看到和查询 Semantic View；
- Agent 或应用实际使用什么 Snowflake 身份/角色执行查询；
- 行级访问、列级脱敏和数据共享要求是否由适当的 grants 与安全策略实现；
- 低权限角色是否无法访问不应暴露的数据；
- 日志是否记录调用者、Query ID、对象和执行状态，同时避免记录敏感数据。

不要仅靠字段描述、Prompt、Agent 指令或隐藏 UI 控件实现访问控制。

## 8. 使用 LangChain Deep Agents 查询 Semantic View

如果应用使用 LangChain Deep Agents，而不是 Snowflake Cortex Agent，可以在应用侧注册一个 Python 工具，由工具通过 Snowflake Connector 执行固定 SQL 并查询 Semantic View。Semantic View 不需要转换成 LangChain 专属格式，也不要求部署 Cortex Agent。

详细操作步骤、完整 Python 示例、最小权限设计、工具限制、回归测试清单和从固定查询扩展到受限动态分析的方案，见 [references/langchain-deepagents-semantic-view.md](langchain-deepagents-semantic-view.md)。

推荐从固定 SQL 工具开始，不要把模型生成的任意 SQL 直接交给高权限 Snowflake 角色执行。Deep Agents 的内置工具也应按实际安装版本检查并收窄；Prompt 不能替代工具层校验和 Snowflake 权限控制。

## 7. 如何选择

- **固定报表、可重复查询、强审计：** 直接 SQL + Semantic View。
- **后端服务或批处理：** Python/JDBC/ODBC/SQL API + 参数化 SQL。
- **自然语言转 SQL，但不需要工具编排：** 评估 Cortex Analyst REST API，并考虑 Snowflake 对 Cortex Agents 的迁移建议。
- **多轮自然语言交互或多个工具协作：** 将 Semantic View 配置为 Cortex Agent 的工具。
- **业务自助分析：** 可以结合 BI 工具或 Agent，但要分别评估连接器能力、权限传递、SQL 质量和业务回归。

无论选择哪种入口，Semantic View 都是统一业务语义的基础。它不会自动保证业务定义正确、SQL 结果正确或 Agent 回答可靠；这些仍依赖经过审批的指标定义、权限配置、测试集和持续回归。
