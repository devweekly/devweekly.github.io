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

1. Run `scripts/export_semantic_metadata.py` against the actual target source tables; stop if the connection or export fails.
2. Parse the mapping manifest and ensure its structure is valid.
3. Run `scripts/validate_semantic_mapping.py --mapping .work/semantic_mapping.json --metadata .work/metadata_snapshot.json`; require human approval and zero open questions.
4. Generate YAML only after that gate passes.
5. Run `scripts/validate_semantic_view_yaml.py <yaml-path>` and rerun `scripts/validate_semantic_mapping.py` with `--yaml <yaml-path>`; both must pass.
6. Review relationship keys, expected cardinality, fact-table grain, and fan-out/fan-trap risks; existence checks alone are insufficient.
7. Run `scripts/deploy_semantic_view.py --file <yaml-path>` in its default verify-only mode against non-production Snowflake.
8. Deploy only to an explicitly approved isolated development schema, then run `scripts/test_semantic_view.py`, `sql/20_smoke_tests.sql`, and approved reference SQL/known-answer comparisons.
9. Require review and explicit release approval before production promotion.

Follow the exact command sequence and failure behavior in **Mandatory script integration** below. Never replace script execution with a prose-only statement that the checks should be run.

A successful deterministic check only proves the properties it actually checks. It does not prove that the business mapping is correct.



## Mandatory script integration

**The scripts are part of this Skill's execution path, not optional documentation.** Do not stop after writing a mapping or a validation plan. Run the applicable commands when a shell/runtime is available. If execution is unavailable or Snowflake credentials are missing, report each skipped command as NOT RUN with the reason; never claim it passed.

All paths below are relative to the repository root. The lab root is `temp/snowflake-semantic-view/`. Do not resolve `examples/` or `scripts/` relative to the nested Skill directory.

### 1. Prepare the environment

Check `temp/snowflake-semantic-view/requirements.txt` and the Python environment first. Install the lab requirements in an isolated virtual environment if needed. Do not print or inspect secret values in logs. Create a local work directory for generated files; do not commit real-environment snapshots by default.

```bash
cd temp/snowflake-semantic-view
mkdir -p .work
python -m pip install -r requirements.txt
```

If dependencies are already installed, do not reinstall them unnecessarily.

### 2. Export real metadata before proposing physical mappings

When a configured, authorized Snowflake connection is available, run `scripts/export_semantic_metadata.py` against every source table identified in the design. The example tables below are only for this lab; replace them with actual design candidates.

```bash
python scripts/export_semantic_metadata.py \
  --table SV_FINANCE_LAB.MART.FACT_POSITION_DAILY \
  --table SV_FINANCE_LAB.MART.DIM_PORTFOLIO \
  --table SV_FINANCE_LAB.MART.DIM_SECURITY \
  --output .work/metadata_snapshot.json
```

Read the resulting `.work/metadata_snapshot.json` and use it as the physical-object allowlist. If the command fails, metadata is incomplete, or a source table cannot be inspected, stop physical mapping and report the exact blocker. Never substitute `examples/metadata_snapshot.example.json` for live metadata; it is a fixture only.

### 3. Create and approve the mapping manifest

Save the proposed mapping to `.work/semantic_mapping.json`, following `examples/semantic_mapping.example.json`. Populate it from the design and actual metadata. Do not set `approval_status` or individual `decision_status` to `approved` on behalf of a human. If approvals have not been supplied, retain the pending status and stop before deployable YAML generation.

### 4. Run the deterministic mapping gate

After the required owners have approved the manifest and all blocking questions are resolved, run:

```bash
python scripts/validate_semantic_mapping.py \
  --mapping .work/semantic_mapping.json \
  --metadata .work/metadata_snapshot.json
```

A non-zero exit code is a blocker. Read and report every error, fix the design/mapping or refresh metadata as appropriate, and rerun the command. Do not edit the generated YAML to conceal a mapping failure.

### 5. Generate YAML, then run both local validators

Generate the YAML only after the mapping gate passes. Run the structural validator and the mapping validator with the YAML included:

```bash
python scripts/validate_semantic_view_yaml.py position_analytics.yaml
python scripts/validate_semantic_mapping.py \
  --mapping .work/semantic_mapping.json \
  --metadata .work/metadata_snapshot.json \
  --yaml position_analytics.yaml
```

Replace `position_analytics.yaml` with the actual output path. Both commands must pass. The mapping validator currently checks the manifest's physical references and YAML name/base tables; it does **not** prove that every YAML expression's column references match the mapping manifest. Never describe it as expression-level validation.

### 6. Run Snowflake verification and development regression

Only after both local validators pass, and only against an authorized non-production target:

```bash
python scripts/deploy_semantic_view.py --file position_analytics.yaml
```

The default mode is verify-only. Do not add `--deploy` unless deployment to the explicitly approved isolated development schema is requested and all gates passed. After deployment, run `python scripts/test_semantic_view.py`, execute the approved SQL checks in `sql/20_smoke_tests.sql`, and compare important metrics with approved reference SQL/known answers. These checks require the demo tables and Semantic View to exist in the target development environment.

### 7. Report the actual run status

For every run, report the command, PASS/FAIL/NOT RUN, exit code if available, target environment (without secrets), and any follow-up action. Distinguish fixture-based CI checks from live Snowflake verification. A fixture-only CI pass is not evidence that live metadata or the target Snowflake service was checked.


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

## Drift detection and Git release workflow

**Git is the approved desired state; Snowflake is the observed runtime state.** A commit or YAML diff alone does not prove that an environment matches the approved definition. For detailed procedures, use the reference guide at references/drift-detection-and-git-workflow.md. Follow these mandatory gates whenever changing an existing Semantic View or its source tables.

1. **Establish the baseline before claiming drift detection is enabled.** Record the clean Git commit SHA, exact Snowflake environment and fully qualified object name. Export real source-table metadata with scripts/export_semantic_metadata.py; read back the deployed Semantic View definition using a supported official Snowflake mechanism; retain raw exports for audit and create a normalized comparison copy. Verify mapping, dependencies, key relationships and known-answer tests. Have the data engineer and business owner approve the baseline.
2. **Track approved artifacts in Git.** Version the design, approved mapping manifest, Semantic View YAML, dependency/test definitions and sanitized validation/release report. Metadata snapshots may be committed only if policy permits and they contain metadata only; otherwise keep them in controlled artifact storage and version their fingerprint/export instructions. Never commit credentials, customer rows or transient .work outputs.
3. **On each relevant PR, run deterministic local gates.** Validate JSON/YAML and mapping; compare dependency manifests; detect added, removed and changed source columns; ensure critical mappings have tests. Explicitly report expression references that the current validator cannot inspect. A check that only verifies base tables exist is not a complete dependency check.
4. **Run live verification in a controlled non-production environment.** Confirm the connected account, role and schema before querying. Re-export metadata instead of trusting an old snapshot; compare it with the environment's approved baseline; run Snowflake verify-only; deploy only with explicit authorization; then run smoke tests, relationship/grain checks and independent known-answer/reference-SQL comparisons. Missing credentials or unavailable live checks must be NOT RUN, never PASS.
5. **Compare the deployed object after deployment.** Read back the actual definition and compare its normalized semantic content with the YAML at the released commit. Compare base tables, logical tables, relationships, keys, dimensions, facts, metrics, filters, descriptions and synonyms. Preserve unknown fields; do not treat formatting-only differences as semantic drift, and do not discard descriptions or filters as normalization noise.
6. **Schedule drift detection outside PRs.** A daily or post-upstream-schema-change job should read metadata and deployed definitions using a read-only service identity, compare them with the last approved release baseline for that environment (not blindly with repository HEAD), save a sanitized report and notify owners. This catches manual Snowflake changes after merge.
7. **Classify and respond; never auto-import unknown production changes into Git.** BLOCKER includes missing referenced columns, wrong target environment, unapproved mapping, material result mismatch or unexpected security-policy change. HIGH includes incompatible types, changed grain/join keys or deployed definition mismatch. Preserve evidence, trace each change to affected YAML paths/metrics/tests, update design and mapping first, regenerate YAML, rerun affected gates, and submit a reviewed PR. If Snowflake was modified without approval, restore from the approved commit only after confirming impact and rollback safety.
8. **Record the release chain.** Every release report must connect Git commit SHA → target environment/object → verify-only result → deployed-definition comparison → regression result → approver and rollback version. Rolling back the semantic definition does not automatically roll back upstream table/data changes; those require a separate recovery plan.

Do not call drift detection automated until executable metadata-diff and deployed-definition comparison checks, fixture tests and failure cases exist. Until then, report which steps are manual or NOT RUN. The detailed guide defines the recommended M1–M5 implementation sequence and severity rules.

## Important limitation

This Skill coordinates the reasoning and workflow. It is not itself a security boundary and cannot reliably enforce every prohibition. The scripts must independently check facts that can be checked mechanically; Snowflake must validate server-side syntax and object references; data tests and business owners must validate meaning.
