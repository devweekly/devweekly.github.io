# Generation Trace and Local Artifact Audit

Last reviewed: 2026-11-11

## One recording boundary for model calls

All production novel-generation LLM text calls use `src/generate.ts` `runAgentText()`. Every invocation now writes a durable record before the SDK request begins:

`.output/agent-calls/<callId>/`

- `run.json`: status, timestamps, requested/resolved model, fallback chain, timeout, task profile, effective thinking/effort, SDK tool/session policy, caller stack, process/runtime metadata and optional parent run context.
- `prompt.txt`: exact task prompt sent to the model.
- `system-prompt.txt`: exact shared system prompt used by the text-only runtime.
- `model-trace.json`: ordered model attempts, normal/thinking-disabled retry mode, effective task profile, fallback model, timing, status and error.
- `response.txt`: final assistant text returned to the caller.
- `failure.txt`: terminal error when the call fails or is interrupted.
- `attempt-NN/attempt.json`: per-attempt model, mode, profile, timing and outcome.
- `attempt-NN/events.jsonl`: SDK event type/subtype, assistant text deltas, result usage/cost/timing metadata and errors.
- `attempt-NN/partial-response.txt`: text received before timeout, interruption or SDK failure.
- `attempt-NN/raw-response.txt`: complete assistant text for a successful attempt.

Trace persistence is part of the call path. If the local trace cannot be initialized or streamed to disk, the model call is not allowed to proceed as an unrecorded generation. A failed model attempt is recorded before the fallback is tried.

CLI and Workbench startup scan this directory, check the recorded PID, and mark only orphaned records left in `running` as `interrupted`, including their in-flight attempt records. A second live Workbench instance will not invalidate another instance's active calls. This closes the process-kill/restart gap; it does not attempt to resume a model request.

## Parent-run correlation

- Normal chapter stages: `worldId`, chapter run ID, output directory and stage key.
- Long-chapter stages: `worldId`, long-chapter run ID, output directory and stage key.
- Story Unit design: Story Unit generation run ID and its dedicated output directory.
- Story Plan: Workbench run ID and its dedicated output directory.
- Story progress assessment: completed chapter run ID and its output directory.

Story Unit and Story Plan runs also retain their input snapshots and parsed result artifacts beside the run record. Story progress assessments are saved as `story-progress-assessment.json` beside the chapter output.

## Stage cache and pipeline artifacts

The ordinary and long-chapter pipelines already save stage outputs, retrieval context, story-state snapshots, review reports, repairs and quality summaries. The stage cache now additionally writes:

- `stage-<key>.input.txt`: exact prompt/config fingerprint, including the full prompt.
- `stage-events.jsonl`: cache hit/miss/corruption/validation result, stage start, completion and failure, with input/output hashes.

Thus a cache hit is distinguishable from a new model call, and its exact input fingerprint remains available even when no new request is sent.

## Other generation and analysis entry points

Because they use `runAgentText()`, the central trace also covers Story Unit progress evaluation, Story Plan generation, annotation extraction/evidence review, original-story analysis, world analysis evidence review, character profiles and chapter states, volume arcs, corpus craft, style profile reconstruction, rhythm repair, roleplay turns, regression writing/review, and CLI generation commands.

The local-model benchmark and model-comparison script use direct LM Studio HTTP requests rather than the Agent SDK. They save prompts/source excerpts/results/errors and persist in-flight rows before each request. Benchmark embedding inputs and per-model progress are saved separately.

Vane embedding calls also bypass the Agent SDK. Each indexing or query-embedding operation now writes `.output/<worldId>/vane-embedding-runs/<runId>/`, including exact input texts and IDs, sanitized endpoint/model/timeout metadata, per-batch state, returned vectors/usage, and failure details. The Vane index itself continues to store the vectors used for retrieval.

## Boundaries

- SDK event logs intentionally retain event metadata and assistant text, not arbitrary raw SDK objects, tool payloads, credentials or environment secrets. The runtime is configured with `tools: []` and `maxTurns: 1`.
- `check-runtime` is a diagnostic probe, not a novel-generation stage; it remains a separate direct SDK request and reports its result to the CLI.
- External/manual multi-agent handoffs in `analyze-world` are file-based. Their input/output handoff files and collection manifest remain the durable record; there is no hidden SDK call in that workflow.
- Existing historical outputs created before this change cannot be retroactively given their original prompts or raw responses. New calls are recorded automatically.
