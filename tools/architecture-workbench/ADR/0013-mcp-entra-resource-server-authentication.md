# ADR-0013: MCP Entra OAuth Resource Server Authentication

- Status: Accepted
- Date: 2026-11-23
- Related: ADR-0003, ADR-0007, ADR-0008, ADR-0012

## Context

Architecture Workbench exposes business Tools and Skills over Streamable HTTP at \`/mcp\`. Its original remote prototype accepted one static bearer secret and mapped every caller to a fixed service Person. That proves basic transport protection, but it does not identify a human user, distinguish calling applications, or provide per-user Work Item authorization.

The MCP endpoint must authenticate independent MCP clients without coupling the Workbench to a specific Agent Host or model provider. The existing Participation model remains the source of business authorization.

## Decision

### 1. Workbench is an OAuth Resource Server

Microsoft Entra ID is the Authorization Server and identity provider. It handles user authentication / SSO, client authentication, consent and token issuance. The Workbench does not implement login pages, issue tokens, store client secrets or act as an OAuth Authorization Server.

The MCP HTTP endpoint uses the official MCP SDK \`requireBearerAuth\` middleware and publishes RFC 9728 Protected Resource Metadata. Missing or invalid access tokens receive a 401 challenge; valid tokens without required scopes or app roles receive 403.

### 2. Accept only configured Entra v2 access tokens

The verifier validates:

- JWT signature using the tenant-specific Entra JWKS.
- Exact v2 issuer and configured tenant.
- API application audience (the resource app registration's client-ID GUID).
- Expiry and v2 token version.
- Caller application ID from \`azp\` against \`MCP_AUTH_ALLOWED_CLIENT_IDS\`.
- Required delegated scopes (\`scp\`) or application roles (\`roles\`).

A token signed by Entra is not sufficient by itself. The token must be issued for this MCP resource, by the configured tenant, to an explicitly allowed client, with the configured permission.

### 3. Separate delegated users from app-only Agent clients

For a delegated user token, the immutable identity key is \`tid + oid\`. The existing \`people\` record stores these values in \`entra_tenant_id\` and \`entra_object_id\`. Email is not a persistent subject identifier.

Email-based first-time linking is disabled by default. If explicitly enabled, Workbench links only when exactly one Person matches the email claim and the Person has no existing Entra mapping.

For an app-only token, the caller's \`azp\` must still be allowlisted and an application role must be present. The Workbench maps the call to the configured non-admin \`MCP_SERVICE_USER_ID\`. This identity must be explicitly added to each Work Item with least-privilege Participation permissions.

### 4. Keep authentication and business authorization separate

The verified MCP AuthInfo carries the resolved Workbench actor. Each business Tool continues to call the existing Participation / workflow authorization functions at operation time. Identity does not grant a Work Item role; an Entra scope or app role does not replace \`read\`, \`contribute\`, \`comment\`, \`review\`, \`decide\` or \`manage\` Participation checks.

### 5. Preserve local and prototype compatibility

- Local-only MCP remains localhost-bound and uses \`x-demo-user-id\` for development.
- Remote production deployments should set \`MCP_AUTH_ENABLED=true\` and complete Entra configuration.
- The previous static bearer token mode remains available only when Entra mode is explicitly disabled. It continues to map every remote request to one non-admin service Person and is not equivalent to delegated OAuth.

The authentication implementation is provider-neutral at the Agent Host boundary. It does not add Copilot SDK, CodeBuddy, model runtime or source-system connector dependencies.

## Configuration

The Entra mode is enabled by \`MCP_AUTH_ENABLED=true\` and requires:

- \`MCP_ALLOWED_HOSTS\`
- \`MCP_AUTH_TENANT_ID\`
- \`MCP_AUTH_AUDIENCE\`
- \`MCP_AUTH_RESOURCE_URL\`
- \`MCP_AUTH_ALLOWED_CLIENT_IDS\`
- \`MCP_SERVICE_USER_ID\` for app-only calls
- Optional \`MCP_AUTH_REQUIRED_SCOPES\`, \`MCP_AUTH_AUTHORIZATION_SERVER_URL\` and \`MCP_AUTH_AUTO_LINK_BY_EMAIL\`

The resource URL must be the exact HTTPS MCP endpoint registered as the Entra API Application ID URI, such as \`https://workbench.example.com/mcp\`. The v2 token audience is the API app's client-ID GUID, not the resource URL.

## Consequences

- Human MCP clients can retain their Entra user identity through the Workbench and receive the same resource-level Participation checks as UI users.
- Background Agent clients can use client credentials and application roles without impersonating a human.
- The application stores only the Entra tenant/object mapping; access and refresh tokens stay with the MCP client.
- Entra client applications must be registered and allowlisted in advance. Dynamic Client Registration is not implemented by this resource-server integration.
- REST API's prototype \`x-demo-user-id\` authentication is unchanged and must not be exposed as production human authentication.
