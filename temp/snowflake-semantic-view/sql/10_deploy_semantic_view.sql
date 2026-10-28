-- Canonical definition is ../position_analytics.yaml.
-- Prefer scripts/deploy_semantic_view.py so YAML is read from one source
-- rather than copied into a second, manually maintained SQL definition.
--
-- Manual workflow:
-- 1. Copy the complete YAML text into the dollar-quoted placeholder below.
-- 2. Run the verify_only call first (third argument TRUE).
-- 3. Inspect the success message, then run the deployment call (FALSE, TRUE).
-- 4. Verify with SHOW / DESCRIBE and execute sql/20_smoke_tests.sql.
--
-- Verify only; this must not create or replace a semantic view:
CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(
  'SV_FINANCE_LAB.MART',
  $$PASTE_COMPLETE_POSITION_ANALYTICS_YAML_HERE$$,
  TRUE
);

-- Deploy only after verification and approval. create_or_alter=TRUE requests
-- CREATE OR ALTER semantics and can preserve unaffected materializations.
-- Do not run until the placeholder has been replaced by the complete YAML.
CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(
  'SV_FINANCE_LAB.MART',
  $$PASTE_COMPLETE_POSITION_ANALYTICS_YAML_HERE$$,
  FALSE,
  TRUE
);
