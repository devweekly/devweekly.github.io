#!/usr/bin/env python3
"""Validate a semantic mapping manifest against exported Snowflake metadata."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml


def norm(value: Any) -> str:
    return str(value or "").strip().upper()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path}: root must be a JSON object")
    return value


def metadata_index(metadata: dict[str, Any]) -> dict[tuple[str, str, str], set[str]]:
    tables = metadata.get("tables")
    if not isinstance(tables, list):
        raise ValueError("Metadata must contain a 'tables' array")
    index: dict[tuple[str, str, str], set[str]] = {}
    for item in tables:
        if not isinstance(item, dict):
            raise ValueError("Each metadata table must be an object")
        key = (norm(item.get("database")), norm(item.get("schema")), norm(item.get("table")))
        if not all(key):
            raise ValueError(f"Metadata table is missing database/schema/table: {item}")
        columns = item.get("columns")
        if not isinstance(columns, list):
            raise ValueError(f"Metadata table {'.'.join(key)} must contain a columns array")
        names = set()
        for col in columns:
            name = norm(col.get("name")) if isinstance(col, dict) else ""
            if not name:
                raise ValueError(f"Metadata table {'.'.join(key)} has a column without a name")
            names.add(name)
        index[key] = names
    return index


def check_mapping(mapping: dict[str, Any], index: dict[tuple[str, str, str], set[str]]) -> list[str]:
    errors: list[str] = []
    if not mapping.get("model_name"):
        errors.append("Mapping manifest must specify model_name.")
    if norm(mapping.get("approval_status")) != "APPROVED":
        errors.append("Manifest approval_status must be 'approved' before YAML generation/deployment.")
    questions = mapping.get("open_questions", [])
    if not isinstance(questions, list):
        errors.append("open_questions must be an array.")
    elif questions:
        errors.append(f"There are {len(questions)} open question(s); resolve them before release.")

    rows = mapping.get("mappings")
    if not isinstance(rows, list) or not rows:
        errors.append("Manifest must contain a non-empty mappings array.")
        return errors

    for i, row in enumerate(rows, start=1):
        label = f"mappings[{i}]"
        if not isinstance(row, dict):
            errors.append(f"{label} must be an object.")
            continue
        for required in ("business_concept", "design_reference", "semantic_kind", "yaml_path", "evidence"):
            if not str(row.get(required, "")).strip():
                errors.append(f"{label}: missing required field '{required}'.")
        if norm(row.get("decision_status")) != "APPROVED":
            errors.append(f"{label}: decision_status must be 'approved'; do not treat AI proposals as approved decisions.")
        refs = row.get("source_refs")
        if not isinstance(refs, list) or not refs:
            errors.append(f"{label}: source_refs must list real source fields; derived expressions must list all underlying fields.")
            continue
        for j, ref in enumerate(refs, start=1):
            ref_label = f"{label}.source_refs[{j}]"
            if not isinstance(ref, dict):
                errors.append(f"{ref_label} must be an object.")
                continue
            key = (norm(ref.get("database")), norm(ref.get("schema")), norm(ref.get("table")))
            column = norm(ref.get("column"))
            if not all(key) or not column:
                errors.append(f"{ref_label}: database, schema, table and column are all required.")
                continue
            if key not in index:
                errors.append(f"{ref_label}: table {'.'.join(key)} does not exist in the supplied metadata snapshot.")
            elif column not in index[key]:
                errors.append(f"{ref_label}: column {'.'.join(key)}.{column} does not exist in the supplied metadata snapshot.")
        tests = row.get("required_tests")
        if not isinstance(tests, list) or not tests or any(not str(t).strip() for t in tests):
            errors.append(f"{label}: add at least one non-empty required_tests entry.")
    return errors


def check_yaml(path: Path, model_name: str, index: dict[tuple[str, str, str], set[str]]) -> list[str]:
    errors: list[str] = []
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        return [f"Cannot parse YAML {path}: {exc}"]
    if not isinstance(document, dict):
        return [f"YAML {path}: root must be a mapping."]
    if norm(document.get("name")) != norm(model_name):
        errors.append(f"YAML name '{document.get('name')}' does not match manifest model_name '{model_name}'.")
    tables = document.get("tables")
    if not isinstance(tables, list) or not tables:
        errors.append("YAML must contain a non-empty tables array.")
        return errors
    for i, logical_table in enumerate(tables, start=1):
        if not isinstance(logical_table, dict):
            errors.append(f"YAML tables[{i}] must be an object.")
            continue
        base = logical_table.get("base_table")
        if not isinstance(base, dict):
            errors.append(f"YAML tables[{i}] is missing base_table.")
            continue
        key = (norm(base.get("database")), norm(base.get("schema")), norm(base.get("table")))
        if not all(key):
            errors.append(f"YAML tables[{i}].base_table must specify database, schema and table.")
        elif key not in index:
            errors.append(f"YAML base table {'.'.join(key)} does not exist in the supplied metadata snapshot.")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", type=Path, required=True, help="Approved semantic mapping JSON")
    parser.add_argument("--metadata", type=Path, required=True, help="JSON snapshot exported from the target Snowflake environment")
    parser.add_argument("--yaml", dest="yaml_path", type=Path, help="Optional generated Semantic View YAML to check")
    args = parser.parse_args()

    try:
        mapping = load_json(args.mapping)
        metadata = load_json(args.metadata)
        index = metadata_index(metadata)
        errors = check_mapping(mapping, index)
        if args.yaml_path:
            errors.extend(check_yaml(args.yaml_path, str(mapping.get("model_name", "")), index))
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if errors:
        print("VALIDATION FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Mapping manifest passed deterministic checks: {args.mapping}")
    if args.yaml_path:
        print(f"YAML parsed; declared base tables exist in metadata: {args.yaml_path}")
    print("This does not prove business correctness. Continue with Snowflake verify_only, data tests, independent SQL reconciliation, and human review.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
