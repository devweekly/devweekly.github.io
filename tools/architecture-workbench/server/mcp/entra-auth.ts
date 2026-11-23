import type { OAuthTokenVerifier } from "@modelcontextprotocol/express";
import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { all, one, run } from "../db.js";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_TOKEN = /^[A-Za-z0-9._:-]+$/;

export interface EntraAuthConfig {
  tenantId: string;
  audience: string;
  resourceUrl: URL;
  authorizationServerUrl: URL;
  allowedClientIds: ReadonlySet<string>;
  requiredScopes: string[];
  serviceUserId: string;
  autoLinkByEmail: boolean;
  issuer: string;
  jwksUrl: URL;
}

export interface EntraPrincipal {
  tenantId: string;
  objectId: string;
  applicationOnly: boolean;
  email?: string;
}

export interface EntraActorMappingOptions {
  serviceUserId: string;
  autoLinkByEmail: boolean;
}

export function loadEntraAuthConfig(env: NodeJS.ProcessEnv, allowedHosts: string[]): EntraAuthConfig {
  const tenantId = String(env.MCP_AUTH_TENANT_ID || "").trim().toLowerCase();
  const audience = String(env.MCP_AUTH_AUDIENCE || "").trim().toLowerCase();
  const resourceValue = String(env.MCP_AUTH_RESOURCE_URL || "").trim();
  const serviceUserId = String(env.MCP_SERVICE_USER_ID || "").trim();
  const allowedClientIds = new Set(
    String(env.MCP_AUTH_ALLOWED_CLIENT_IDS || "")
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  );

  if (!GUID.test(tenantId)) throw new Error("MCP_AUTH_TENANT_ID must be a Microsoft Entra tenant GUID.");
  if (!GUID.test(audience)) throw new Error("MCP_AUTH_AUDIENCE must be the API app registration client-ID GUID.");
  if (!resourceValue) throw new Error("MCP_AUTH_RESOURCE_URL must be the canonical MCP endpoint URL.");
  if (!serviceUserId) throw new Error("MCP_SERVICE_USER_ID is required for Entra app-only Agent clients.");
  if (allowedClientIds.size === 0 || [...allowedClientIds].some(value => !GUID.test(value))) {
    throw new Error("MCP_AUTH_ALLOWED_CLIENT_IDS must contain one or more comma-separated client application GUIDs.");
  }

  let resourceUrl: URL;
  try {
    resourceUrl = new URL(resourceValue);
  } catch {
    throw new Error("MCP_AUTH_RESOURCE_URL must be an absolute HTTPS URL.");
  }
  if (
    resourceUrl.protocol !== "https:" ||
    resourceUrl.pathname !== "/mcp" ||
    resourceUrl.search ||
    resourceUrl.hash ||
    resourceUrl.href !== resourceValue
  ) {
    throw new Error("MCP_AUTH_RESOURCE_URL must be a canonical HTTPS MCP URL ending exactly in /mcp, without a trailing slash, query or fragment.");
  }
  const allowedHost = allowedHosts.some(host => {
    const normalized = host.toLowerCase();
    return normalized === resourceUrl.hostname.toLowerCase() || normalized === resourceUrl.host.toLowerCase();
  });
  if (!allowedHost) {
    throw new Error("The hostname in MCP_AUTH_RESOURCE_URL must also be present in MCP_ALLOWED_HOSTS.");
  }

  const requiredScopes = String(env.MCP_AUTH_REQUIRED_SCOPES || "mcp.access")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (requiredScopes.length === 0 || requiredScopes.some(scope => !SCOPE_TOKEN.test(scope))) {
    throw new Error("MCP_AUTH_REQUIRED_SCOPES must contain valid comma-separated OAuth scope or app-role names.");
  }

  const authorizationServerValue =
    String(env.MCP_AUTH_AUTHORIZATION_SERVER_URL || "").trim() ||
    "https://login.microsoftonline.com/" + tenantId + "/v2.0";
  let authorizationServerUrl: URL;
  try {
    authorizationServerUrl = new URL(authorizationServerValue);
  } catch {
    throw new Error("MCP_AUTH_AUTHORIZATION_SERVER_URL must be an absolute HTTPS URL.");
  }
  if (authorizationServerUrl.protocol !== "https:" || authorizationServerUrl.search || authorizationServerUrl.hash) {
    throw new Error("MCP_AUTH_AUTHORIZATION_SERVER_URL must be an HTTPS authorization-server identifier without query or fragment.");
  }

  const autoLinkValue = String(env.MCP_AUTH_AUTO_LINK_BY_EMAIL || "false").trim().toLowerCase();
  if (autoLinkValue !== "true" && autoLinkValue !== "false") {
    throw new Error("MCP_AUTH_AUTO_LINK_BY_EMAIL must be either true or false.");
  }

  return {
    tenantId,
    audience,
    resourceUrl,
    authorizationServerUrl,
    allowedClientIds,
    requiredScopes,
    serviceUserId,
    autoLinkByEmail: autoLinkValue === "true",
    issuer: "https://login.microsoftonline.com/" + tenantId + "/v2.0",
    jwksUrl: new URL("https://login.microsoftonline.com/" + tenantId + "/discovery/v2.0/keys"),
  };
}

export function resolveWorkbenchActor(
  principal: EntraPrincipal,
  options: EntraActorMappingOptions,
): string | null {
  if (principal.applicationOnly) {
    const service = one<{ id: string; is_admin: number }>(
      "SELECT id,is_admin FROM people WHERE id=?",
      options.serviceUserId,
    );
    return service && service.is_admin !== 1 ? service.id : null;
  }

  const tenantId = principal.tenantId.toLowerCase();
  const objectId = principal.objectId.toLowerCase();
  const existing = one<{ id: string }>(
    "SELECT id FROM people WHERE lower(entra_tenant_id)=? AND lower(entra_object_id)=?",
    tenantId,
    objectId,
  );
  if (existing) return existing.id;

  if (!options.autoLinkByEmail || !principal.email?.trim()) return null;
  const email = principal.email.trim().toLowerCase();
  const candidates = all<{ id: string }>(
    "SELECT id FROM people WHERE lower(trim(email))=? ORDER BY id LIMIT 2",
    email,
  );
  if (candidates.length !== 1) return null;

  run(
    "UPDATE people SET entra_tenant_id=?,entra_object_id=? WHERE id=? AND entra_tenant_id IS NULL AND entra_object_id IS NULL",
    tenantId,
    objectId,
    candidates[0].id,
  );

  return one<{ id: string }>(
    "SELECT id FROM people WHERE lower(entra_tenant_id)=? AND lower(entra_object_id)=?",
    tenantId,
    objectId,
  )?.id || null;
}

type EntraAccessTokenClaims = JWTPayload & {
  ver?: string;
  tid?: string;
  oid?: string;
  azp?: string;
  scp?: string;
  roles?: string[];
  idtyp?: string;
  email?: string;
};

function invalidToken(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

export function createEntraTokenVerifier(config: EntraAuthConfig): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(config.jwksUrl, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 60 * 60 * 1_000,
  });

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let claims: EntraAccessTokenClaims;
      try {
        const verified = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"],
          clockTolerance: 60,
        });
        claims = verified.payload as EntraAccessTokenClaims;
      } catch {
        throw invalidToken("The access token signature, issuer, audience or lifetime is invalid.");
      }

      if (claims.ver !== "2.0") throw invalidToken("Only Microsoft Entra v2.0 access tokens are accepted.");
      if (claims.tid?.toLowerCase() !== config.tenantId) throw invalidToken("The access token belongs to an untrusted tenant.");

      const clientId = claims.azp?.toLowerCase();
      if (!clientId || !config.allowedClientIds.has(clientId)) {
        throw invalidToken("The calling client application is not allowlisted.");
      }
      if (typeof claims.exp !== "number") throw invalidToken("The access token has no expiry claim.");

      const delegated = typeof claims.scp === "string" && claims.scp.trim().length > 0;
      const applicationOnly = !delegated && (claims.idtyp === "app" || Array.isArray(claims.roles));
      if (claims.idtyp === "app" && delegated) throw invalidToken("An app-only token cannot contain delegated scopes.");
      if (!delegated && !applicationOnly) {
        throw invalidToken("The access token contains neither delegated scopes nor application roles.");
      }
      if (applicationOnly && (!Array.isArray(claims.roles) || claims.roles.length === 0)) {
        throw invalidToken("An app-only MCP token must contain an application role.");
      }
      if (delegated && (!claims.oid || !GUID.test(claims.oid))) {
        throw invalidToken("A delegated MCP token must contain the user's Entra object ID.");
      }

      const permissionNames = delegated
        ? (claims.scp || "").split(/\s+/).filter(Boolean)
        : (claims.roles || []).filter((role): role is string => typeof role === "string");
      const scopes = permissionNames.map(scope => config.resourceUrl.href + "/" + scope);

      const actorId = resolveWorkbenchActor(
        {
          tenantId: config.tenantId,
          objectId: String(claims.oid || ""),
          applicationOnly,
          email: typeof claims.email === "string" ? claims.email : undefined,
        },
        {
          serviceUserId: config.serviceUserId,
          autoLinkByEmail: config.autoLinkByEmail,
        },
      );

      return {
        token,
        clientId,
        scopes,
        expiresAt: claims.exp,
        extra: {
          workbenchActorId: actorId,
          tenantId: config.tenantId,
          objectId: claims.oid || null,
          applicationOnly,
        },
      };
    },
  };
}
