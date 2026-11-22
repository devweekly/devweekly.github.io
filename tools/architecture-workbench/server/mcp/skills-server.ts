import type { Express } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { loadWorkbenchSkills } from "./skills-catalog.js";

export async function mountSkillsMcpEndpoint(app: Express): Promise<number> {
  const skills = await loadWorkbenchSkills();
  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: "architecture-workbench",
      version: "0.1.0"
    });
    skills.attach(server);
    return server;
  });

  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  // Keep localhost-only protection unless an explicit deployment allowlist is supplied.
  const mcpApp = allowedHosts.length > 0
    ? createMcpExpressApp({ host: "0.0.0.0", allowedHosts })
    : createMcpExpressApp();

  const nodeHandler = toNodeHandler(handler);
  mcpApp.all("/mcp", (req, res) => {
    void nodeHandler(req, res, req.body);
  });
  app.use(mcpApp);

  return skills.entries.length;
}
