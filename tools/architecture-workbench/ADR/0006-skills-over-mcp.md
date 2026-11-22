# ADR-0006: Publish Role Skills over MCP

- Status: Accepted
- Date: 2026-11-22

## Context

Workbench needs a shared way to distribute role-specific working methods to different Agent Hosts. Duplicating role instructions in each Agent's system prompt or deployment creates drift, while a private Skill API would make the catalog difficult to reuse across MCP-compatible Hosts.

The Workbench already owns the business Work Item model, participation permissions, workflow lifecycle and human decision boundaries. It does not yet contain an Agent Runtime. Skill distribution must not be mistaken for Agent orchestration or business authorization.

## Decision

Adopt the official MCP Skills Extension `io.modelcontextprotocol/skills` (SEP-2640) using the official MCP TypeScript SDK v2 Skills implementation. Serve the catalog over Streamable HTTP at `/mcp`.

The version-controlled `skills/` directory is the source of truth. Each Skill is a directory containing a `SKILL.md` with Agent Skills YAML frontmatter; supporting references and examples may be added under the same directory. Initial Skills cover business analysis, solution architecture, data architecture, security review, architecture review, decision preparation and request coordination.

The server loads the catalog once during startup in strict validation mode and attaches the same catalog to the per-request MCP server factory. The SDK implements the extension's discovery, manifest, resource-read, digest and paging behavior. The application does not hand-roll the protocol methods or register custom resources under `skill://`.

The MCP endpoint exposes only static Skill content. It does not currently expose Work Item, Task, Artifact, Review or Decision tools. Business operations continue through existing application services and REST APIs, with existing participation and workflow checks.

## Responsibilities and security

- The MCP Server publishes Skill files and manifests; it does not execute or activate a Skill.
- The Agent Host is responsible for discovery, integrity verification, any required approval, loading/activation, context management and selecting the Agent that uses a Skill.
- A Skill describes a working method. It does not grant `read`, `contribute`, `review`, `decide` or `manage` permissions and cannot bypass Workbench authorization.
- Human Review Outcome, formal Decision, risk acceptance and closure remain subject to the existing Human-first Workflow Engine rules.
- The catalog must not contain credentials, user-specific information or private business context. The endpoint is localhost-only by default; remote deployments must configure an explicit Host allowlist. This prototype does not yet provide OAuth authentication for MCP.
- Changes to Skills are deployed as code and become active after application restart. Runtime editing and tenant-specific catalogs are deferred until identity, ownership, versioning and approval rules exist.

## Consequences

- Role instructions can be discovered and reused by MCP-compatible Agent Hosts without coupling Workbench to one Agent framework.
- Skill content and its digests are deployed and reviewed with the application source.
- Hosts that do not implement SEP-2640 will not get native Skill discovery; the application does not add a proprietary fallback protocol.
- The endpoint is a content-distribution capability, not an Agent Runtime. MCP business tools, Task dispatch, multi-Agent coordination, execution tracing and human handoff remain separate future capabilities.
- The official SDK extension is experimental at the SDK API level; keep its usage isolated in `server/mcp/` to simplify later upgrades.

## References

- [SEP-2640: Skills Extension](https://modelcontextprotocol.io/seps/2640-skills-extension)
- [Skills Extension overview](https://skills.extensions.modelcontextprotocol.io/)
- [MCP TypeScript SDK v2 Skills](https://ts.sdk.modelcontextprotocol.io/v2/servers/skills)
- [Agent Skills specification](https://agentskills.io/specification)
