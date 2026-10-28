#!/usr/bin/env python3
"""Reconcile Semantic View metrics with source SQL and fixed lab expectations."""

from __future__ import annotations

import os
import sys
from decimal import Decimal
from typing import Any

from snowflake_common import connect_from_env, qualified_schema


AS_OF_DATE = "2026-10-27"
EXPECTED = {
    "Core Fixed Income": {
        "market_value": Decimal("11660.00"),
        "cost_basis": Decimal("11200.00"),
        "unrealized_pnl": Decimal("460.00"),
        "position_count": 2,
    },
    "US Equity Growth": {
        "market_value": Decimal("12450.00"),
        "cost_basis": Decimal("11300.00"),
        "unrealized_pnl": Decimal("1150.00"),
        "position_count": 3,
    },
}


def money(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def assert_equal(label: str, actual: Any, expected: Any) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main() -> int:
    try:
        schema = qualified_schema(
            os.environ.get("SV_TARGET_SCHEMA", "SV_FINANCE_LAB.MART")
        )
        view_name = "INVESTMENT_PORTFOLIO_OVERVIEW"
        view_sql = f"{schema}.{view_name}"

        conn = connect_from_env()
        try:
            with conn.cursor() as cur:
                semantic_sql = f"""
                    SELECT PORTFOLIO_NAME,
                           AS_OF_DATE,
                           AGG(TOTAL_MARKET_VALUE_USD) AS MARKET_VALUE_USD,
                           AGG(TOTAL_COST_BASIS_USD) AS COST_BASIS_USD,
                           AGG(TOTAL_UNREALIZED_PNL_USD) AS UNREALIZED_PNL_USD,
                           AGG(POSITION_COUNT) AS POSITION_COUNT
                    FROM {view_sql}
                    WHERE AS_OF_DATE = %s
                    GROUP BY PORTFOLIO_NAME, AS_OF_DATE
                    ORDER BY PORTFOLIO_NAME
                """
                cur.execute(semantic_sql, (AS_OF_DATE,))
                semantic_rows = cur.fetchall()
                semantic = {
                    row[0]: {
                        "as_of_date": str(row[1]),
                        "market_value": money(row[2]),
                        "cost_basis": money(row[3]),
                        "unrealized_pnl": money(row[4]),
                        "position_count": int(row[5]),
                    }
                    for row in semantic_rows
                }

                source_sql = f"""
                    SELECT p.PORTFOLIO_NAME,
                           f.AS_OF_DATE,
                           SUM(f.MARKET_VALUE_USD),
                           SUM(f.COST_BASIS_USD),
                           SUM(f.UNREALIZED_PNL_USD),
                           COUNT(*)
                    FROM {schema}.FACT_POSITION_DAILY f
                    JOIN {schema}.DIM_PORTFOLIO p
                      ON p.PORTFOLIO_ID = f.PORTFOLIO_ID
                    WHERE f.AS_OF_DATE = %s
                    GROUP BY p.PORTFOLIO_NAME, f.AS_OF_DATE
                    ORDER BY p.PORTFOLIO_NAME
                """
                cur.execute(source_sql, (AS_OF_DATE,))
                source_rows = cur.fetchall()
                source = {
                    row[0]: {
                        "as_of_date": str(row[1]),
                        "market_value": money(row[2]),
                        "cost_basis": money(row[3]),
                        "unrealized_pnl": money(row[4]),
                        "position_count": int(row[5]),
                    }
                    for row in source_rows
                }

                assert_equal("Semantic View portfolio set", set(semantic), set(EXPECTED))
                assert_equal("Source portfolio set", set(source), set(EXPECTED))
                assert_equal("Semantic View vs source aggregation", semantic, source)

                for portfolio, expected in EXPECTED.items():
                    for key in ("market_value", "cost_basis", "unrealized_pnl", "position_count"):
                        assert_equal(f"{portfolio}.{key}", semantic[portfolio][key], expected[key])

                print(f"PASS: {len(EXPECTED)} portfolios reconciled for as-of date {AS_OF_DATE}.")
                for portfolio, row in semantic.items():
                    print(
                        f"  {portfolio}: market_value={row['market_value']}, "
                        f"cost_basis={row['cost_basis']}, "
                        f"unrealized_pnl={row['unrealized_pnl']}, "
                        f"position_count={row['position_count']}"
                    )
        finally:
            conn.close()
        return 0
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
