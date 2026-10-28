#!/usr/bin/env python3
"""Validate and deploy a native Snowflake Semantic View from YAML."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml

from snowflake_common import connect_from_env, qualified_schema


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")


def load_definition(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.read_text(encoding="utf-8")
    try:
        model = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError(f"YAML cannot be parsed: {exc}") from exc

    if not isinstance(model, dict):
        raise ValueError("The YAML root must be a mapping.")
    name = model.get("name")
    if not isinstance(name, str) or not IDENTIFIER.fullmatch(name):
        raise ValueError("The YAML name must be a valid unquoted Snowflake identifier.")

    tables = model.get("tables")
    if not isinstance(tables, list) or not tables:
        raise ValueError("Define at least one logical table.")
    if not model.get("relationships"):
        raise ValueError("Define and review at least one relationship for this lab.")
    table_names = [table.get("name") for table in tables if isinstance(table, dict)]
    if len(table_names) != len(tables) or len(set(table_names)) != len(table_names):
        raise ValueError("Logical table names must be present and unique.")

    metrics = [
        metric.get("name")
        for table in tables
        for metric in (table.get("metrics") or [])
        if isinstance(metric, dict)
    ]
    if not metrics:
        raise ValueError("Define at least one metric.")
    return model, raw


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--file",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "position_analytics.yaml",
        help="Path to semantic view YAML (default: this lab's position_analytics.yaml)",
    )
    parser.add_argument(
        "--target-schema",
        default=None,
        help="Target DB.SCHEMA; defaults to SV_TARGET_SCHEMA or SV_FINANCE_LAB.MART",
    )
    parser.add_argument(
        "--deploy",
        action="store_true",
        help="After verify_only succeeds, deploy with CREATE OR ALTER semantics",
    )
    args = parser.parse_args()

    try:
        schema = qualified_schema(
            args.target_schema
            or __import__("os").environ.get("SV_TARGET_SCHEMA", "SV_FINANCE_LAB.MART")
        )
        model, yaml_text = load_definition(args.file)
        view_name = model["name"]
        if not IDENTIFIER.fullmatch(view_name):
            raise ValueError("Invalid semantic view name.")

        print(f"Definition: {args.file}")
        print(f"Target: {schema}.{view_name}")
        print("Static checks passed. Connecting to Snowflake for verify_only...")

        conn = connect_from_env()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(%s, %s, TRUE)",
                    (schema, yaml_text),
                )
                verification = cur.fetchone()
                print(f"Snowflake verify_only: {verification[0] if verification else 'OK'}")

                if not args.deploy:
                    print("Verification only; no object was created or changed.")
                    return 0

                cur.execute(
                    "CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(%s, %s, FALSE, TRUE)",
                    (schema, yaml_text),
                )
                deployment = cur.fetchone()
                print(f"Deployment: {deployment[0] if deployment else 'OK'}")

                # The target identifiers were validated before interpolation.
                cur.execute(f"DESCRIBE SEMANTIC VIEW {schema}.{view_name}")
                described = cur.fetchall()
                if not described:
                    raise RuntimeError("DESCRIBE returned no metadata after deployment.")
                print(f"DESCRIBE returned {len(described)} metadata rows.")
                print("Deployment complete. Run sql/20_smoke_tests.sql and the regression test.")
        finally:
            conn.close()
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
