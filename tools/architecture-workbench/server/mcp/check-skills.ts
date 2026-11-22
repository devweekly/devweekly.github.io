import express from "express";
import { createServer } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { loadWorkbenchSkills } from "./skills-catalog.js";
import { mountSkillsMcpEndpoint } from "./skills-server.js";

const catalog = await loadWorkbenchSkills();
const expectedNames = [
  "architecture-review",
  "business-analysis",
  "data-architecture",
  "decision-preparation",
  "request-coordination",
  "security-review",
  "solution-architecture"
];

if (catalog.entries.length !== expectedNames.length) {
  throw new Error("Expected "+expectedNames.length+" Skills, found "+catalog.entries.length+".");
}

const app = express();
const publishedCount = await mountSkillsMcpEndpoint(app);
if (publishedCount !== expectedNames.length) {
  throw new Error("MCP endpoint published "+publishedCount+" Skills.");
}

const httpServer = createServer(app);
let listening = false;
let client: Client | undefined;

try {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", onError);
      listening = true;
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve the local MCP test server address.");
  }

  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1:"+address.port+"/mcp")
  );
  client = new Client({
    name: "architecture-workbench-skills-check",
    version: "0.1.0"
  });
  await client.connect(transport);

  const host = new SkillsClient(client);
  const listed = await host.list();
  const actualNames = listed.skills.map((entry) => entry.frontmatter.name).sort();

  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("Unexpected Skills list: "+actualNames.join(", "));
  }

  for (const entry of listed.skills) {
    const fetched = await host.get(entry.uri);
    if (!fetched.skill || fetched.skill.frontmatter.name !== entry.frontmatter.name) {
      throw new Error("skills/get returned mismatched metadata for "+entry.uri);
    }

    const manifest = await host.read(entry);
    if (!manifest.verified || !manifest.frontmatter || manifest.frontmatter.name !== entry.frontmatter.name || typeof manifest.body !== "string" || !manifest.body.trim()) {
      throw new Error("Skill resource verification failed for "+entry.uri);
    }
  }

  console.log("MCP Skills HTTP smoke test passed: skills/list, skills/get and verified resources/read for "+listed.skills.length+" Skills.");
} finally {
  if (client) await client.close();
  if (listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });
  }
}
