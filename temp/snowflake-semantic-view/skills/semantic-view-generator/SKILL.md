---
name: snowflake-semantic-view-generator
description: Turn an approved semantic-model design into a traceable Snowflake Semantic View YAML draft, using real Snowflake metadata and deterministic validation. Never invent schema objects or business definitions.
---

# Snowflake Semantic View Generator

## Purpose and boundary

Use this workflow when converting a semantic-model design written in Markdown into a Snowflake Semantic View YAML definition. The output is a reviewed, testable deployment artifact, not an autonomous production change.

The workflow is deliberately split into four responsibilities:

- **Business owner:** approves meaning, grain, metric formulas, units, time semantics, null handling, and aggregation rules.
- **Data engineer:** confirms source tables/columns, types, keys, join cardinality, and data-quality assumptions.
- **LLM/this Skill:** extracts requirements, proposes evidence-backed mappings, drafts YAML only after blockers are resolved, and explains traceability.
- **Scripts and Snowflake:** enforce deterministic checks, validate the definition against the target service, and run data/semantic regression tests.

Do not ask a human to copy every Markdown statement into YAML manually. Do not treat a model-generated YAML file as trusted merely because it looks plausible.

## Required inputs

Before generating a deployable YAML, obtain all of the following:

1. The reviewed Markdown design, including grain, business questions, metric definitions, units, time rules, relationship expectations, null/late-arriving-data behavior, and explicit exclusions.
2. A metadata snapshot exported from the actual target Snowflake environment. It must include fully qualified table names and real column names/types. Metadata must come from Snowflake or an approved catalog, never be invented by the model.
3. The current official Snowflake Semantic View YAML specification for the account's supported feature set.
4. A team-approved YAML example and naming conventions.
5. The mapping manifest format described in `examples/semantic_mapping.example.json`.
6. Known-answer questions or approved reference SQL for important metrics, where available.
7. For complex joins, multi-fact models, time-sensitive measures, or access-control concerns, consult `references/upstream-guidance.md` and the relevant Snowflake Labs pattern. Treat official Snowflake documentation as the syntax/product authority; community Skills are advisory only.

If required inputs are missing, state exactly what is missing. Do not pretend to have inspected a Snowflake account that was not connected.

## Hard prohibitions

- Never invent a database, schema, table, column, data type, key, relationship, constraint, or verified query.
- Never infer that a column is USD-normalized, unique, current-state, historically effective, or business-approved from its name alone.
- Never infer join cardinality from matching column names. Require evidence such as constraints, profiling, or owner confirmation.
- Never silently choose among ambiguous candidate fields. List candidates and request a decision.
- Never turn an unresolved business question into a definitive metric formula.
- Never claim that a primary-key declaration enforces uniqueness in the underlying data.
- Never claim that YAML parsing or Snowflake verify_only proves business correctness.
- Never deploy to production, change grants, or replace an existing object unless the user explicitly requested that action and the release gates passed.
- Never edit only the generated YAML to fix a business-definition problem. Update the design/mapping first, then regenerate.
- Do not put credentials, tokens, customer data, or production extracts in the repository.

## Workflow

### Phase 1 — Extract requirements

Produce a structured inventory of:
- business questions and intended users;
- grain of every source/logic table;
- dimensions and time dimensions;
- facts and metric formulas;
- units/currency and conversion rules;
- time-window and semi-additive rules;
- null, duplicate, late-arriving and missing-reference behavior;
- joins, expected cardinality and fan-out risks;
- source owners, exclusions and unresolved decisions.

Label each item as confirmed, proposed, or blocked. A model suggestion is not a confirmed decision.

### Phase 2 — Map against real metadata

For every proposed semantic element, produce a mapping row with:
- business concept and design-document evidence;
- fully qualified source object and exact column names, or a documented expression;
- observed source data type;
- proposed YAML location;
- mapping status and evidence;
- tests required to support the mapping.

Use the metadata snapshot as the allowlist. If a table or column cannot be found, mark it MISSING and stop before generating deployable YAML. If multiple candidates exist, mark it AMBIGUOUS and ask for a human decision.

For derived metrics, list every underlying source field and the approved formula. For relationships, record both sides of the join and the evidence for cardinality. Do not invent primary keys because the YAML format permits a primary_key section.

### Phase 3 — Human approval gate

Require the data engineer to approve physical mappings, types, grain, keys and relationships. Require the business owner to approve formulas, currency, time behavior, null semantics and aggregation limits.

Any open question that could change a metric value, join result, or interpretation is a blocker. The model must return a blocker list rather than a deployable YAML when such questions remain.

### Phase 4 — Generate YAML with traceability

Only after blockers are resolved:
- generate YAML using the supplied official specification and approved examples;
- use exact names from metadata;
- include descriptions that state the business meaning and important limitations;
- produce a traceability table mapping each design decision to the YAML path and its validation test;
- report assumptions explicitly instead of hiding them in descriptions.

Do not add semantic elements merely because columns exist. A physical column becomes a semantic dimension/fact only when it is in scope and its meaning has been confirmed.

### Phase 5 — Deterministic validation

Run checks in this order:

1. Parse the mapping manifest and ensure its structure is valid.
2. Confirm every source table and column referenced by the mapping exists in the metadata snapshot.
3. Fail if any mapping is not approved, any required evidence is absent, or any blocking question remains.
4. Parse the YAML and check its declared view name.
5. Confirm every base table declared by the YAML exists in the same metadata snapshot.
6. Run the repository's additional YAML structural checks.
7. Review relationship keys, expected cardinality, fact-table grain, and fan-out/fan-trap risks; existence checks alone are insufficient.
8. Connect to a non-production Snowflake environment and run `SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(..., TRUE)` / the repository's verify-only command.
9. Deploy only to an isolated development schema, then run data-quality and semantic regression tests, including known-answer SQL comparisons for important metrics.
10. Require review and explicit release approval before production promotion.

A successful deterministic check only proves the properties it actually checks. It does not prove that the business mapping is correct.

## Required outputs

Keep these artifacts together in version control:

- design Markdown: approved business contract;
- metadata snapshot or reproducible metadata-export instructions, with no sensitive data;
- mapping manifest: source of traceability between business terms and physical fields;
- Semantic View YAML: generated deployment definition;
- validation report: checks run, results, blockers and tool/environment versions;
- known-answer queries/reference SQL and regression results;
- change record: reviewer, commit, target environment and deployment outcome.

Do not commit transient credentials or raw customer-level data.

## Stop conditions

Stop before generating deployable YAML if:
- the source metadata is unavailable or stale;
- a referenced table/column is missing;
- multiple source fields are plausible and no owner has chosen one;
- grain or join cardinality is unknown and affects correctness;
- a metric formula, unit, currency conversion, time behavior or null rule is unresolved;
- the requested YAML feature is not confirmed by the supplied Snowflake specification.

When stopping, return a concise list of the exact decision needed, why it matters, and who should decide. Do not fill gaps with guesses.

## Upstream guidance

Use `references/upstream-guidance.md` for the reviewed upstream references and pattern checklist. Prioritize official Snowflake documentation for current syntax and account-supported capabilities. Do not copy third-party Skill instructions or high-privilege demo snippets blindly.

## Important limitation

This Skill coordinates the reasoning and workflow. It is not itself a security boundary and cannot reliably enforce every prohibition. The scripts must independently check facts that can be checked mechanically; Snowflake must validate server-side syntax and object references; data tests and business owners must validate meaning.
