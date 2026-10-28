# 使用 LangChain Deep Agents 查询 Snowflake Semantic View

本文演示如何让 LangChain Deep Agents 通过自定义 Python 工具查询已部署的 Snowflake Semantic View。**不需要 Snowflake Cortex Agent，也不需要把 Semantic View 转换成另一套语义模型。**

## 1. 架构与职责边界

Deep Agents 是应用侧的 Agent harness。它通过工具调用访问 Snowflake；Snowflake Semantic View 仍然是业务指标、维度和关系定义的权威来源。

~~~mermaid
flowchart TD
    U["用户：截至某估值日，各组合市值是多少？"] --> A["LangChain Deep Agent"]
    A --> T["受约束的 Python 查询工具"]
    T --> V["参数校验与查询授权"]
    V --> SQL["固定 SQL + 绑定参数"]
    SQL --> SV["Snowflake Semantic View"]
    SV --> DB["Snowflake 查询结果"]
    DB --> T
    T --> A
    A --> R["基于工具结果生成回答"]
~~~

职责边界：

- **Deep Agent**：理解问题、调用工具、解释工具返回的数据；不能自行定义金融指标。
- **Python 工具**：验证输入、限定查询类型、绑定参数、限制返回量、记录查询标识并处理异常。
- **Semantic View**：维护经审批的指标、维度、逻辑关系和计算语义。
- **Snowflake**：执行查询并通过角色、grants 和安全策略实施访问控制。
- **测试与业务审批**：验证指标口径和结果是否正确。Agent 能成功回答不等于结果已经通过业务验收。

本教程中的表、字段和指标沿用本目录的教学对象 SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW。部署前必须确认这些名字与目标环境中的实际 Semantic View 定义一致。

## 2. 运行前准备

### 2.1 先部署并验证 Semantic View

先按照本项目的主 README 完成教学表创建、Semantic View 验证和部署，并执行已有回归测试。确认下面的查询可以在 Snowflake Worksheet 中成功运行：

~~~sql
SELECT
    PORTFOLIO_NAME,
    AGG(TOTAL_MARKET_VALUE_USD) AS MARKET_VALUE_USD
FROM SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW
WHERE AS_OF_DATE = '2026-10-27'
GROUP BY PORTFOLIO_NAME
ORDER BY PORTFOLIO_NAME;
~~~

如果此查询失败，先修正 Semantic View、对象名、指标名、权限或日期数据；不要试图通过修改 Agent Prompt 掩盖数据库层的问题。

### 2.2 创建 Python 环境

建议使用 Python 3.11 或团队已验证的兼容版本，并在独立虚拟环境中安装依赖：

~~~bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install deepagents langchain langchain-openai snowflake-connector-python
~~~

若项目要长期维护，应把经测试的版本写入项目的依赖锁定文件；不要把未锁定的最新版本当成可复现的生产依赖。

### 2.3 配置认证和连接参数

交互式本地开发可以采用 Snowflake External Browser SSO。示例使用 OpenAI 模型，因此还需要配置模型提供方的 API Key：

~~~bash
export SNOWFLAKE_ACCOUNT="your-account-identifier"
export SNOWFLAKE_USER="your-user"
export SNOWFLAKE_AUTHENTICATOR="externalbrowser"
export SNOWFLAKE_WAREHOUSE="your-warehouse"
export SNOWFLAKE_ROLE="your-readonly-role"
export OPENAI_API_KEY="configure-through-your-secret-manager"
~~~

生产服务不要依赖交互式浏览器登录。应使用组织批准的工作负载身份、密钥对认证或其他受支持的非交互式方式，并通过 Secret Manager 或部署平台注入凭据。不要把真实 API Key、密码或私钥提交到 Git。

Snowflake 连接角色应仅具有查询目标 Semantic View 所需的权限，以及必要的 database/schema 使用权限。不要因为 Agent 可能需要查询，就授予它底层所有表的广泛 SELECT 权限或写入权限。

## 3. 完整代码：暴露一个受约束的查询工具

将以下代码保存为 examples/langchain_deepagents_semantic_view.py。它只开放“查询指定估值日的组合市值”这一项业务能力。模型不能传入 SQL，也不能指定任意表名、列名或 SQL 子句。

~~~python
from __future__ import annotations

import json
import os
from datetime import date
from typing import Any

import snowflake.connector
from deepagents import create_deep_agent
from deepagents.middleware import FilesystemMiddleware
from langchain.tools import tool
from langchain_openai import ChatOpenAI


SEMANTIC_VIEW = (
    "SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW"
)


def _validate_iso_date(value: str) -> str:
    """Validate a YYYY-MM-DD date and return its normalized form."""
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("as_of_date must be a valid YYYY-MM-DD date") from exc

    if parsed.isoformat() != value:
        raise ValueError("as_of_date must use YYYY-MM-DD format")

    return parsed.isoformat()


def _connect() -> snowflake.connector.SnowflakeConnection:
    """Open a Snowflake connection using environment-provided credentials."""
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        authenticator=os.getenv(
            "SNOWFLAKE_AUTHENTICATOR", "externalbrowser"
        ),
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        role=os.environ["SNOWFLAKE_ROLE"],
        database="SV_FINANCE_LAB",
        schema="MART",
        # For key-pair/workload authentication, replace this configuration
        # with the organization's approved connector settings.
    )


@tool
def get_portfolio_market_values(as_of_date: str) -> str:
    """Query each portfolio's total market value for one valuation date.

    Args:
        as_of_date: Valuation date in YYYY-MM-DD format.
    """
    valuation_date = _validate_iso_date(as_of_date)

    # SQL structure and object names are fixed in application code.
    # The model controls only a validated, bound date parameter.
    sql = f"""
        SELECT
            PORTFOLIO_NAME,
            AGG(TOTAL_MARKET_VALUE_USD) AS MARKET_VALUE_USD
        FROM {SEMANTIC_VIEW}
        WHERE AS_OF_DATE = %s
        GROUP BY PORTFOLIO_NAME
        ORDER BY PORTFOLIO_NAME
    """

    conn = None
    query_id: str | None = None

    try:
        conn = _connect()
        with conn.cursor() as cur:
            cur.execute(sql, (valuation_date,))
            query_id = cur.sfqid
            columns = [item[0] for item in cur.description]
            rows = cur.fetchmany(101)

        if len(rows) > 100:
            return json.dumps(
                {
                    "status": "too_many_rows",
                    "message": (
                        "The query returned more than 100 rows. "
                        "Narrow the query through an approved tool "
                        "rather than returning an unbounded result."
                    ),
                    "query_id": query_id,
                },
                ensure_ascii=False,
            )

        records: list[dict[str, Any]] = [
            dict(zip(columns, row)) for row in rows
        ]

        return json.dumps(
            {
                "status": "ok",
                "semantic_view": SEMANTIC_VIEW,
                "as_of_date": valuation_date,
                "query_id": query_id,
                "row_count": len(records),
                "rows": records,
            },
            ensure_ascii=False,
            default=str,
        )
    except Exception:
        # Do not return raw driver exceptions, SQL text, credentials,
        # or connection details to the model/user.
        # Send detailed exception diagnostics to access-controlled logs
        # in production, with secrets and sensitive values redacted.
        return json.dumps(
            {
                "status": "query_failed",
                "message": (
                    "Snowflake query failed. Check application logs "
                    "and Snowflake query history using the query ID "
                    "if available."
                ),
                "query_id": query_id,
            },
            ensure_ascii=False,
        )
    finally:
        if conn is not None:
            conn.close()


def main() -> None:
    model = ChatOpenAI(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1"),
        temperature=0,
    )

    agent = create_deep_agent(
        model=model,
        tools=[get_portfolio_market_values],
        system_prompt="""
You are a financial data analysis assistant.

Rules:
1. Use get_portfolio_market_values for portfolio market-value questions.
2. Never invent query results, portfolio names, dates, or metric values.
3. If the tool returns an error or no rows, explain that result explicitly.
4. Market value is a point-in-time measure. Do not add daily snapshots
   together and describe the sum as monthly or period-end assets.
5. State the valuation date and USD unit in the answer.
6. Do not claim that a result was independently verified unless a
   separate verification step actually ran.
7. If the requested analysis is not supported by an available tool,
   explain the limitation instead of inventing SQL or data.
""",
        # Deep Agents includes built-in filesystem tools. This replaces
        # the default filesystem tool surface with a read-only allowlist.
        middleware=[
            FilesystemMiddleware(tools=["read_file"]),
        ],
    )

    question = (
        "截至 2026-10-27，各投资组合的总市值是多少？"
        "请列出组合名称、市值和币种，并说明估值日期。"
    )

    result = agent.invoke(
        {"messages": [{"role": "user", "content": question}]}
    )

    messages = result.get("messages", [])
    if not messages:
        raise RuntimeError("Deep Agent returned no messages")

    final_message = messages[-1]
    print(getattr(final_message, "content", final_message))


if __name__ == "__main__":
    main()
~~~

运行：

~~~bash
python examples/langchain_deepagents_semantic_view.py
~~~

示例使用 ChatOpenAI 作为模型适配器；如果使用其他 LangChain 集成，只需替换模型初始化部分，并确认该模型支持所需的工具调用能力。create_deep_agent 的模型、工具和中间件接口应以安装版本的官方文档为准。

### 代码中的关键设计

1. **SQL 结构固定**：模型只能调用 get_portfolio_market_values，不能提交任意 SQL。代码中的 f-string 只插入源码中固定的 Semantic View 全名，不插入用户输入；日期通过 Connector 绑定参数传递。
2. **工具输入有类型和格式约束**：日期先经过 ISO 日期校验。生产环境还应限制允许查询的历史范围、频率、并发和单次执行时长。
3. **返回值是结构化结果**：包含状态、对象名、估值日、行数和 Snowflake Query ID，便于 Agent 使用结果，也便于审计和排障。
4. **异常信息分层**：示例不把驱动异常原文直接返回给模型。生产实现应将脱敏后的详细错误写入受控日志；若需要在失败响应中返回 Query ID，应在日志中保留同一关联标识。
5. **限制 Deep Agents 内置工具**：Deep Agents 默认包含文件操作工具，某些后端还支持执行工具。示例将文件工具收窄为只读 read_file；生产部署应核实所安装版本的工具清单和中间件行为，不要无意暴露文件写入或命令执行能力。
6. **Prompt 不是安全边界**：真正的访问控制由工具实现、Snowflake 角色和安全策略承担。即使模型忽略 Prompt，也不能通过这个工具指定其他表或执行 DDL/DML。

> 注意：此代码是集成示例，尚未在用户的 Snowflake 账户或具体 LangChain/Deep Agents 依赖环境中执行。运行前应先用实际安装版本验证 API 兼容性，再连接隔离开发环境完成端到端测试。

## 4. 从最小示例扩展到实际分析

建议按业务能力逐步增加工具，而不是一开始就开放任意 SQL。

| 工具 | 参数 | 允许的行为 | 关键测试 |
|---|---|---|---|
| get_portfolio_market_values | 估值日 | 返回各组合当日市值 | 日期校验、金额对账、无数据日期 |
| get_portfolio_cost_and_pnl | 估值日 | 返回成本基础与未实现盈亏 | 指标口径、币种、负值处理 |
| get_portfolio_values_by_asset_class | 估值日 | 按资产类别聚合 | 维度可达性、汇总结果对账 |
| compare_portfolio_valuation_dates | 两个估值日 | 比较两个时点的指标 | 两日期均有数据、期间变化口径、缺失值 |

每个工具都应使用固定 SQL 或经过严格解析、授权和限制的查询生成机制。不要简单地把模型生成的 SQL 字符串传给 cursor.execute()。

如果确实需要开放动态分析，可以考虑两阶段设计：模型先产生受限的结构化查询计划（允许的指标、维度、过滤器和行数上限），服务端校验该计划是否符合白名单和业务规则，再将其转换为 SQL。模型不能绕过校验直接执行 SQL。

## 5. 如何测试和评估

先测试 Python 工具，再测试 Agent 的工具选择和最终回答。推荐至少覆盖以下用例：

| 测试类别 | 输入或故障场景 | 预期行为 |
|---|---|---|
| 正常查询 | 存在数据的估值日 | 返回与独立 SQL 对账一致的组合市值 |
| 日期格式错误 | 2026/10/27、无效日期 | 在连接 Snowflake 前拒绝输入 |
| 无数据日期 | 格式正确但无记录 | 返回零行，Agent 不得编造数值 |
| SQL 注入尝试 | 日期参数中包含 SQL 片段 | 日期校验拒绝；参数不会改变 SQL 结构 |
| 无权限角色 | 撤销目标 Semantic View 的 SELECT 权限 | 查询失败，Agent 不得伪造成功结果 |
| 对象或指标重命名 | 测试环境修改 Semantic View 定义 | 测试发现工具与部署定义不一致 |
| 工具调用失败 | 连接超时或 Snowflake 错误 | 返回受控失败状态，日志保留排障信息 |
| 时点语义 | 用户要求把每日市值加总为月度资产规模 | Agent 说明该口径不成立，并请求或建议明确的期间指标定义 |
| 超出工具能力 | 用户要求一个未提供的指标 | Agent 明确说明工具不支持，不编造答案 |

建议使用固定输入、已知结果和独立 SQL 建立回归集。记录模型版本、工具版本、Semantic View 版本或 Git SHA、Snowflake Query ID、预期结果、实际结果和失败分类。评估既要看数值正确性，也要看 Agent 是否选择了正确工具、是否遵守时点语义，以及在无权限或无数据时是否诚实地失败。

## 6. 是否应该让 Deep Agent 直接生成 SQL？

不是默认的第一步。对金融数据或强审计场景，优先采用受约束的工具：

- 业务问题固定、风险较高：固定 SQL 工具，输入只包含白名单参数。
- 分析类型有限但需要灵活组合：结构化查询计划 + 服务端校验 + SQL 编译。
- 需要自然语言生成任意查询：必须额外实现 SQL AST 解析、只读语句白名单、对象/列授权、查询成本和行数限制、超时、审计与独立评估；仅检查 SQL 是否以 SELECT 开头远远不够。

不要将 Agent 生成的 SQL 直接赋予高权限角色执行。Semantic View 的价值之一是集中管理语义，但它不会自动阻止错误的分析口径，也不会替代 SQL 执行层的授权与资源控制。

## 7. 官方参考

- [LangChain Deep Agents：Overview](https://docs.langchain.com/oss/python/deepagents/overview)
- [LangChain Deep Agents：Tools](https://docs.langchain.com/oss/python/deepagents/tools)
- [Deep Agents Python API：create_deep_agent](https://reference.langchain.com/python/deepagents/graph/create_deep_agent)
- [Snowflake：Querying semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/querying)
- [Snowflake：Semantic View SQL reference](https://docs.snowflake.com/en/sql-reference/constructs/semantic_view)
