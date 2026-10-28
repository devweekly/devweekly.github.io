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
