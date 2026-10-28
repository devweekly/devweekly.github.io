#!/usr/bin/env python3
"""Offline structural checks for the Semantic View YAML (not a Snowflake validator)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


DEFAULT_FILE = Path(__file__).resolve().parents[1] / "position_analytics.yaml"


def names(items: Any, key: str = "name") -> list[str]:
    if not isinstance(items, list):
        return []
    return [
        item[key]
        for item in items
        if isinstance(item, dict) and isinstance(item.get(key), str)
    ]


def validate(path: Path) -> list[str]:
    issues: list[str] = []
    try:
        model = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        return [f"Cannot read/parse YAML: {exc}"]

    if not isinstance(model, dict):
        return ["YAML root must be a mapping."]
    if not isinstance(model.get("name"), str) or not model["name"].strip():
        issues.append("Top-level name is required.")
    if not isinstance(model.get("description"), str) or not model["description"].strip():
        issues.append("Top-level description is required.")

    tables = model.get("tables")
    if not isinstance(tables, list) or not tables:
        return issues + ["At least one logical table is required."]

    table_names = names(tables)
    if len(table_names) != len(tables):
        issues.append("Every logical table must have a name.")
    if len(set(table_names)) != len(table_names):
        issues.append("Logical table names must be unique.")

    columns_by_table: dict[str, set[str]] = {}
    metrics: list[str] = []
    for table in tables:
        if not isinstance(table, dict):
            continue
        table_name = table.get("name")
        if not isinstance(table_name, str):
            continue
        base = table.get("base_table")
        if not isinstance(base, dict):
            issues.append(f"{table_name}: base_table must be a mapping.")
        elif not all(base.get(k) for k in ("database", "schema", "table")) and not base.get("definition"):
            issues.append(f"{table_name}: base_table must identify a physical table or SQL definition.")

        primary_key = table.get("primary_key", {}).get("columns", [])
        if not isinstance(primary_key, list) or not primary_key:
            issues.append(f"{table_name}: primary_key.columns is required by this lab convention.")
            primary_key = []

        column_names: set[str] = set()
        for group_name in ("dimensions", "time_dimensions", "facts"):
            group = table.get(group_name, []) or []
            if not isinstance(group, list):
                issues.append(f"{table_name}: {group_name} must be a list.")
                continue
            for item in group:
                if not isinstance(item, dict) or not item.get("name") or not item.get("expr"):
                    issues.append(f"{table_name}: each {group_name} entry needs name and expr.")
                    continue
                column_names.add(item["name"])
        missing_keys = sorted(set(primary_key) - column_names)
        if missing_keys:
            issues.append(f"{table_name}: primary key columns not exposed as logical columns: {missing_keys}")
        columns_by_table[table_name] = column_names

        table_metrics = table.get("metrics", []) or []
        if not isinstance(table_metrics, list):
            issues.append(f"{table_name}: metrics must be a list.")
            continue
        for metric in table_metrics:
            if not isinstance(metric, dict) or not metric.get("name") or not metric.get("expr"):
                issues.append(f"{table_name}: each metric needs name and expr.")
                continue
            metrics.append(metric["name"])

    if not metrics:
        issues.append("At least one metric is required.")
    if not isinstance(model.get("relationships"), list) or not model["relationships"]:
        issues.append("At least one reviewed relationship is required by this lab.")

    for relationship in model.get("relationships", []) or []:
        if not isinstance(relationship, dict):
            issues.append("Each relationship must be a mapping.")
            continue
        left = relationship.get("left_table")
        right = relationship.get("right_table")
        if left not in columns_by_table or right not in columns_by_table:
            issues.append(f"Relationship {relationship.get('name')}: left/right table name is unknown.")
            continue
        columns = relationship.get("relationship_columns", [])
        if not isinstance(columns, list) or not columns:
            issues.append(f"Relationship {relationship.get('name')}: relationship_columns is required.")
            continue
        for pair in columns:
            if not isinstance(pair, dict):
                issues.append(f"Relationship {relationship.get('name')}: each column pair must be a mapping.")
                continue
            if pair.get("left_column") not in columns_by_table[left]:
                issues.append(f"Relationship {relationship.get('name')}: unknown left column {pair.get('left_column')}.")
            if pair.get("right_column") not in columns_by_table[right]:
                issues.append(f"Relationship {relationship.get('name')}: unknown right column {pair.get('right_column')}.")

    return issues


def main() -> int:
    path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_FILE
    issues = validate(path)
    if issues:
        print(f"FAILED: {path}")
        for issue in issues:
            print(f"- {issue}")
        return 1
    model = yaml.safe_load(path.read_text(encoding="utf-8"))
    print(f"PASS: {path}")
    print(f"  semantic view: {model['name']}")
    print(f"  logical tables: {len(model['tables'])}")
    print(f"  relationships: {len(model.get('relationships', []))}")
    print("  Note: this is an offline structural check; Snowflake verify_only is still required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
