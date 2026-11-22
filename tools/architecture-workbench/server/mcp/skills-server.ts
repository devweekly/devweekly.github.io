import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { one } from "../db.js";
import { registerWorkbenchTools } from "./workbench-tools.js";
import { loadWorkbenchSkills } from "./skills-catalog.js";
import { createEntraTokenVerifier, loadEntraAuthConfig } from "./entra-auth.js";

export async function mountSkillsMcpEndpoint(app: Express): Promise<number> {
  const skills = await loadWorkbenchSkills();
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "architecture-workbench", version: "0.2.0" });
    skills.attach(server);
    registerWorkbenchTools(server, (skillName) => {
      const entry = skills.entries.find(candidate => candidate.frontmatter.name === skillName);
      if (!entry) throw new Error("The Agent profile references an unpublished Skill: " + skillName);
      return entry.uri;
    });
    return server;
  });

  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS || "").split(",").map(host => host.trim()).filter(Boolean);
  const remote = allowedHosts.length > 0;
  const authEnabledValue = String(process.env.MCP_AUTH_ENABLED || "false").trim().toLowerCase();
  if (authEnabledValue !== "true" && authEnabledValue !== "false") {
    throw new Error("MCP_AUTH_ENABLED must be either true or false.");
  }
  const entraEnabled = authEnabledValue === "true";
  const serviceToken = process.env.MCP_BEARER_TOKEN || "";
  const serviceUserId = process.env.MCP_SERVICE_USER_ID || "";

  if (entraEnabled && !remote) {
    throw new Error("MCP_AUTH_ENABLED=true requires MCP_ALLOWED_HOSTS and a remotely reachable HTTPS MCP endpoint.");
  }

  if (remote && !entraEnabled) {
    if (serviceToken.length < 32) throw new Error("Remote MCP requires MCP_BEARER_TOKEN with at least 32 characters when Entra auth is disabled.");
    if (!serviceUserId) throw new Error("Remote MCP requires MCP_SERVICE_USER_ID. Use a dedicated non-admin Agent Service Principal.");
  }

  if (remote || entraEnabled) {
    const service = one<{id:string;is_admin:number}>("SELECT id,is_admin FROM people WHERE id=?", serviceUserId);
    if (!service || service.is_admin === 1) {
      throw new Error("MCP_SERVICE_USER_ID must identify an existing non-admin Person for remote Agent execution.");
    }
  }

  const mcpApp = remote ? createMcpExpressApp({host:"0.0.0.0",allowedHosts}) : createMcpExpressApp();
  const nodeHandler = toNodeHandler(handler);
  const handleMcpRequest = (req:Request,res:Response) => {
    void nodeHandler(req,res,req.body);
  };

  if (entraEnabled) {
    const config = loadEntraAuthConfig(process.env, allowedHosts);
    const resourceMetadataUrl = new URL("/.well-known/oauth-protected-resource", config.resourceUrl.origin);
    const verifier = createEntraTokenVerifier(config);
    const auth = requireBearerAuth({
      verifier,
      requiredScopes: config.requiredScopes.map(scope => config.resourceUrl.href + "/" + scope),
      resourceMetadataUrl,
      expectedResource: config.resourceUrl,
    });

    // RFC 9728 Protected Resource Metadata. Entra remains the Authorization
    // Server; Workbench validates access tokens and never issues them.
    mcpApp.get(resourceMetadataUrl.pathname, (_req,res) => res.json({
      resource: config.resourceUrl.href,
      authorization_servers: [config.authorizationServerUrl.href.replace(/\/$/,"")],
      scopes_supported: config.requiredScopes.map(scope => config.resourceUrl.href + "/" + scope),
      bearer_methods_supported: ["header"],
    }));

    const requireMappedPrincipal = (req:Request,res:Response,next:NextFunction) => {
      const authInfo = (req as Request & {auth?:AuthInfo}).auth;
      const actor = authInfo?.extra?.workbenchActorId;
      if (typeof actor !== "string" || !actor) {
        return res.status(403).json({
          error: "The Entra identity is valid but is not linked to a Workbench Person or configured Agent Service Principal.",
        });
      }
      next();
    };
    mcpApp.all("/mcp", auth, requireMappedPrincipal, handleMcpRequest);
  } else if (remote) {
    // Legacy prototype service authentication. Do not accept a caller-supplied
    // demo identity; every remote call uses the explicitly provisioned service.
    mcpApp.all("/mcp", (req:Request,res:Response,next:NextFunction) => {
      const expected = Buffer.from("Bearer " + serviceToken, "utf8");
      const supplied = Buffer.from(String(req.headers.authorization || ""), "utf8");
      if (expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) {
        return res.status(401).json({error:"A valid MCP bearer token is required."});
      }
      req.headers["x-demo-user-id"] = serviceUserId;
      next();
    }, handleMcpRequest);
  } else {
    // Local-only prototype mode. Host validation remains enabled by the SDK.
    mcpApp.all("/mcp", handleMcpRequest);
  }

  app.use(mcpApp);
  return skills.entries.length;
}
