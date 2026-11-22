# ADR-0004: External Context References, Not Source-System Connectors

- Status: Accepted
- Date: 2026-11-22

## Context

A Request may relate to multiple Jira Stories, Confluence Pages, GitHub repositories, and LeanIX factsheets such as Applications and Interfaces. The same external object can be relevant to several Requests. These relationships provide context and knowledge to architecture analysis; they do not make the Workbench the owner of those systems' data.

## Decision

The Workbench stores external resource references and their many-to-many associations with Work Items. The stored data is limited to provider, resource type, external identifier/key, title, URL, relation type and optional Confluence Page Template key/name.

The Workbench backend does not implement Jira, Confluence, GitHub or LeanIX connectors. It does not call their APIs, poll or synchronize their records, cache their content, or store their credentials.

If a native Workbench Agent is enabled in the future, that Agent owns its MCP/API tool connections. It resolves the references when analysis needs current source content, under the access control of the source system and the Agent's tool identity. The actual Confluence Template definition is also retrieved by the Agent when needed; the Workbench stores only the Template reference.

Context Capsules carry references, not snapshots of remote content. Agent analysis must identify source resources and retrieval time. Retrieved facts remain evidence for human review; they do not grant the Agent permission to create a formal Review Outcome, Decision or risk acceptance.

## Consequences

- The Workbench has no source-system connector configuration, synchronization scheduler, external credential store or remote-content cache.
- External references are small, stable domain records and can be linked many-to-many to Requests and other Work Items.
- The Workbench remains usable without any Agent or external MCP/API connection.
- An Agent may fail to resolve a reference because of missing credentials, missing access or source-system unavailability; this must be reported as missing context, not silently inferred.
- A future Agent/tool integration needs its own identity, delegation, audit and source authorization design.
