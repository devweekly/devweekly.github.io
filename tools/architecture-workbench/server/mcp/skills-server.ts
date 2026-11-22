import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { one } from "../db.js";
import { registerWorkbenchTools } from "./workbench-tools.js";
import { loadWorkbenchSkills } from "./skills-catalog.js";

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
  const serviceToken = process.env.MCP_BEARER_TOKEN || "";
  const serviceUserId = process.env.MCP_SERVICE_USER_ID || "";

  if (remote) {
    if (serviceToken.length < 32) throw new Error("Remote MCP requires MCP_BEARER_TOKEN with at least 32 characters.");
    if (!serviceUserId) throw new Error("Remote MCP requires MCP_SERVICE_USER_ID. Use a dedicated non-admin Agent Service Principal.");
    const service = one<{id:string;is_admin:number}>("SELECT id,is_admin FROM people WHERE id=?", serviceUserId);
    if (!service || service.is_admin === 1) throw new Error("MCP_SERVICE_USER_ID must identify an existing non-admin Person/Service Principal.");
  }

  const mcpApp = remote ? createMcpExpressApp({host:"0.0.0.0",allowedHosts}) : createMcpExpressApp();
  const nodeHandler = toNodeHandler(handler);
  mcpApp.all("/mcp", (req:Request,res:Response,next:NextFunction) => {
    if (remote) {
      const expected = Buffer.from("Bearer " + serviceToken, "utf8");
      const supplied = Buffer.from(String(req.headers.authorization || ""), "utf8");
      if (expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) {
        return res.status(401).json({error:"A valid MCP bearer token is required."});
      }
      // Never accept a caller-supplied demo identity in remote mode.
      req.headers["x-demo-user-id"] = serviceUserId;
    }
    next();
  }, (req,res) => { void nodeHandler(req,res,req.body); });
  app.use(mcpApp);
  return skills.entries.length;
}
