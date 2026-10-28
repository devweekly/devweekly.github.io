#!/usr/bin/env python3
"""Export actual Snowflake table/column metadata for semantic-model mapping checks."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from snowflake_common import connect_from_env


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")


def parse_table(value: str) -> tuple[str, str, str]:
    parts = value.split(".")
    if len(parts) != 3 or not all(IDENTIFIER.fullmatch(part) for part in parts):
        raise ValueError(
            f"Invalid table identifier {value!r}; use unquoted DATABASE.SCHEMA.TABLE identifiers."
        )
    return parts[0], parts[1], parts[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--table",
        action="append",
        required=True,
        help="Fully qualified table to inspect; repeat for each source table (DATABASE.SCHEMA.TABLE).",
    )
    parser.add_argument("--output", type=Path, required=True, help="Output JSON metadata snapshot.")
    args = parser.parse_args()

    try:
        tables = [parse_table(item) for item in args.table]
        conn = connect_from_env()
        records = []
        try:
            with conn.cursor() as cur:
                for database, schema, table in tables:
                    qualified = f"{database}.{schema}.{table}"
                    cur.execute(f"DESCRIBE TABLE {qualified}")
                    columns = []
                    for row in cur.fetchall():
                        # Snowflake DESCRIBE TABLE returns column name and type in the first two columns.
                        name, data_type = row[0], row[1]
                        if name:
                            columns.append({"name": str(name), "data_type": str(data_type)})
                    if not columns:
                        raise RuntimeError(
                            f"No columns returned for {qualified}; check object existence and privileges."
                        )
                    records.append({
                        "database": database,
                        "schema": schema,
                        "table": table,
                        "columns": columns,
                    })
        finally:
            conn.close()

        output = {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "source": "Snowflake DESCRIBE TABLE; this file contains metadata only, not table data.",
            "tables": records,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
        print(f"Exported metadata for {len(records)} table(s) to {args.output}")
        print("Review the snapshot timestamp and target account/schema before using it as a mapping allowlist.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
