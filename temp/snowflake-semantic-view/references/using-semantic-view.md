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

## 7. 如何选择

- **固定报表、可重复查询、强审计：** 直接 SQL + Semantic View。
- **后端服务或批处理：** Python/JDBC/ODBC/SQL API + 参数化 SQL。
- **自然语言转 SQL，但不需要工具编排：** 评估 Cortex Analyst REST API，并考虑 Snowflake 对 Cortex Agents 的迁移建议。
- **多轮自然语言交互或多个工具协作：** 将 Semantic View 配置为 Cortex Agent 的工具。
- **业务自助分析：** 可以结合 BI 工具或 Agent，但要分别评估连接器能力、权限传递、SQL 质量和业务回归。

无论选择哪种入口，Semantic View 都是统一业务语义的基础。它不会自动保证业务定义正确、SQL 结果正确或 Agent 回答可靠；这些仍依赖经过审批的指标定义、权限配置、测试集和持续回归。
