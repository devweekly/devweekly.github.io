# ADR-0009: Server-owned Agent Run Claim Lease and Crash Recovery

- Status: Accepted
- Date: 2026-11-22
- Extends: ADR-0007, ADR-0008

## Context

A pull-based Host can terminate after claiming a Run but before writing a result. Without an expiry mechanism, the Run remains in `running` indefinitely and blocks its DAG descendants. Recovery cannot be delegated to the Host because the process that needs recovery may no longer exist.

Claim ownership therefore needs a server-enforced time boundary. Multiple Hosts may use the same non-admin Service Principal, so principal identity alone is insufficient to distinguish the current worker from a process that continued after its lease was superseded.

## Decision

The Workbench Server owns the Claim Lease and is the sole authority for deciding whether a Run is actively claimed.

A successful claim:
- Generates a cryptographically random one-time Claim Token.
- Sets `heartbeat_at` and `lease_expires_at`.
- Increments `attempt_count`.
- Returns the server-configured lease duration to the Host.
- Keeps the existing DAG prerequisite and Participation checks.

The default lease is 60 seconds. `AGENT_RUN_LEASE_MS` configures it within a bounded 15-second to 5-minute range. The Host renews the lease through `agent_heartbeat_run` at approximately one-third of the lease duration. Every heartbeat revalidates the Work Item's current Participation, Run ownership, status, token and unexpired lease. A heartbeat cannot revive an expired lease.

The server runs a periodic reaper, configured by `AGENT_RUN_LEASE_SWEEP_MS`, and also scans for expired claims before assigning new work. A row with a missing lease is treated as expired, which recovers pre-lease `running` rows during upgrade. Recovery atomically:
- Invalidates the old Claim Token and clears the previous claimant and lease timestamps.
- Requeues the Run for another authorized Host when attempts remain.
- Marks it `failed` when the configured row-level `max_attempts` has been exhausted (default: three claims).
- Appends an immutable `lease_expired` Run event and a Work Item activity record.
- Recomputes its parent Agent Plan status.

A subsequent claim always issues a new token. Heartbeat, completion, failure and hand-off operations require the current token and an unexpired lease. Artifact creation and Run completion execute in one database transaction, so a rejected stale completion cannot leave an orphan Artifact.

The Host performs heartbeats throughout Skill/context preparation and Executor execution. If a heartbeat fails, its execution context's AbortSignal is triggered. Executor plugins should propagate that signal into cancellable model and tool operations. The Host still treats the server response as authoritative; a late completion from a superseded worker is rejected.

## Consequences

- A crashed Host no longer strands a Run indefinitely.
- Multiple Hosts can safely compete for recovered work, including Hosts sharing a Service Principal.
- A stale process cannot renew or complete a Run after the server has reissued its claim.
- Repeated crashes do not create an infinite retry loop; the Run becomes inspectable in `failed` state.
- Lease expiry cannot undo arbitrary side effects that an Executor already performed against external systems. Deployment-specific Executors must make such actions idempotent or independently fenced.
- Lease expiry is a liveness mechanism, not proof that a worker is dead. A paused or partitioned worker may continue computing after losing its lease; Workbench writes remain fenced by the new token.

## Validation

The MCP-over-HTTP smoke test verifies:
- Lease metadata is established on claim.
- Heartbeats extend a still-valid lease.
- Expired claims are automatically requeued and logged.
- A stale token cannot heartbeat or complete after recovery.
- A replacement Host receives a different token and can complete the Run.
- Repeated lease expiry reaches the bounded terminal failure state.
- The provider-neutral Host uses the heartbeat tool during execution.

## Configuration

- `AGENT_RUN_LEASE_MS`: server-side lease duration; default 60000 ms, bounded to 15000–300000 ms.
- `AGENT_RUN_LEASE_SWEEP_MS`: server-side reaper interval; default 10000 ms, bounded to 1000–60000 ms.
- `max_attempts`: persisted per Run; default three claim attempts.

## References

- [ADR-0007: Business MCP Tools and Pull-based Agent Coordination](0007-business-mcp-tools-and-agent-coordinator.md)
- [ADR-0008: DAG-based Multi-Agent Plans and Provider-neutral MCP Host](0008-dag-based-agent-plans-and-provider-neutral-host.md)
