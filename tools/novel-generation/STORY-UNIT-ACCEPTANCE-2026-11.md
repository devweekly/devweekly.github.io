# Story Unit / Long-form Execution Acceptance

Date: 2026-11-08

This document records the acceptance surface for multi-Story-Unit continuation. Story Unit chapter counts are dynamic; there is no fixed chapter target or upper bound for complete-story execution. Literary quality remains the highest priority.

## Scope and invariants

1. A Story Unit is an independent continuation universe inside one World.
2. Its Story State SQLite database, JSON mirror, rolling Story Arc, design record, execution history and chapter Run history must not leak into another Story Unit.
3. World Bible, source-canon material and read-only source character dossiers remain shared World knowledge.
4. Legacy means records without a Story Unit identity. Legacy history must never be silently assigned to a newly created Story Unit.
5. A chapter becomes a durable checkpoint only after the existing quality gate passes and Story State is committed.
6. A complete story ends through natural narrative closure, not a chapter count.
7. A fixed batch ends after its requested count and does not mean the complete story has ended.

## Automated acceptance matrix

| Area | Coverage | Test / implementation |
|---|---|---|
| Story Unit persistence | Multiple units, identity, world ownership, atomic writes | story-unit-store.test.ts |
| Legacy migration | Lazy migration preserves original story-unit.json and stable ID | story-unit-store.test.ts |
| Story Unit versions | Immutable snapshot before rethinking; list and retrieve; ownership validation | story-unit-store.test.ts |
| Version restore API | Restore a prior design while archiving the current design; reject missing unit/version | story-unit-api.integration.test.ts |
| Run ownership | Unit A, Unit B and Legacy history are filtered independently | workbench-store.test.ts, story-execution.test.ts |
| Chapter selection | Previous completed chapter is selected only from exact Story Unit scope | story-execution.test.ts |
| Graph / character API | Requested Story Unit state only; Legacy is separate | story-unit-api.integration.test.ts |
| Worker interleaving | A → B → A fixed batches; A's second chapter continues A's first; Story State and Story Arc remain separate | story-unit-worker.integration.test.ts |
| Restart recovery | In-flight executions become resumable; checkpoint Run ownership and paths are checked | story-execution.test.ts and server recovery logic |
| Rollback reconciliation | Startup's persisted Chinese rollback message and worker's English rollback marker are both recognized; missing current Run fails closed | story-execution.test.ts and server recovery logic |
| UI type/build | Workbench, Graph Explorer and Characters Panel compile and bundle | Novel generation checks workflow |

## Deterministic Worker integration scenario

The Worker integration test uses a fake CLI only for the model-backed chapter pipeline. It does not mock the Express API, Worker orchestration, Run persistence, Story Execution persistence, checkpoint logic, Story State database, or Story Unit storage.

1. Create Story Unit A and Story Unit B in one World.
2. Execute one fixed-batch chapter for A.
3. Execute one fixed-batch chapter for B.
4. Execute another fixed-batch chapter for A.
5. Verify A's second Run uses A's first chapter as previousChapterPath.
6. Verify A has two generated character/event state entries while B has one.
7. Verify A and B have distinct rolling Story Arc files and contents.

This validates the key cross-unit isolation path without requiring external model credentials.

## Browser acceptance checklist

Run against the deployed Workbench with at least two Story Units in the same World.

- [ ] Switch Story Unit A → B → A; selected design, Story Arc, chapters, Runs and execution history follow the selected unit.
- [ ] Switch chapter history to Legacy; this changes only the viewed history scope, not the active generation target.
- [ ] Open a chapter, rapidly select another chapter; the older preview must not overwrite the newer selection.
- [ ] Switch World while a character-state or chapter-preview request is in flight; no old World data remains visible.
- [ ] In Graph Explorer, switch sequel graph between A, B and Legacy; source-canon graph remains shared and unchanged.
- [ ] In Characters Panel, source character dossiers remain shared while continuation state changes with the selected Story Unit.
- [ ] Start a fixed batch, pause at a chapter boundary, resume, and verify it continues from the last committed checkpoint.
- [ ] Start a complete-story task, refresh or close the browser, reopen and verify the server-side task continues.
- [ ] Regenerate a Story Unit design; verify the previous design appears in version history.
- [ ] Restore a previous design; verify the current design is first archived as another version.
- [ ] Verify completed Story Spine beats remain completed after rolling replanning, and replaced beats are visibly distinguished.
- [ ] Verify task timeline, current Run, error state and chapter history remain consistent after a World / Story Unit switch.

## Real-model acceptance (credentials required)

The deterministic integration test cannot evaluate writing quality. In an environment with a configured model provider:

1. Create a Story Unit with a real setting, social life, folklore, cast, conflict and natural ending.
2. Run several chapters through the real chapter pipeline.
3. Inspect the actual chapter prose for continuity, style, character agency and narrative movement. Do not treat schema completeness as literary success.
4. Confirm each chapter passes the quality gate before Story State changes.
5. Interrupt the service during a chapter and restart it. Confirm pre-chapter state is restored and the task resumes from the last committed checkpoint.
6. Confirm Story Spine is revised from actual events and the task does not stop at an arbitrary chapter count.
7. Confirm natural completion only occurs when required remaining story work is empty and the ending is narratively earned.

Real-model quality and deployed-browser interaction remain environment-dependent acceptance activities; they are not claimed as completed merely because CI passes.
