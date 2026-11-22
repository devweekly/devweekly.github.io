import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { McpServer } from "@modelcontextprotocol/server";
import { loadWorkbenchSkills } from "./skills-catalog.js";

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

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = new McpServer({
  name: "architecture-workbench-skills-check",
  version: "0.1.0"
});
catalog.attach(server);

const client = new Client({
  name: "architecture-workbench-skills-check",
  version: "0.1.0"
});

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const host = new SkillsClient(client);
  const listed = await host.list();
  const actualNames = listed.skills.map((entry) => entry.frontmatter.name).sort();

  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("Unexpected Skills list: "+actualNames.join(", "));
  }

  for (const entry of listed.skills) {
    const fetched = await host.get(entry.uri);
    if (fetched.skill.frontmatter.name !== entry.frontmatter.name) {
      throw new Error("skills/get returned mismatched metadata for "+entry.uri);
    }

    const manifest = await host.read(entry);
    if (!manifest.verified || manifest.frontmatter.name !== entry.frontmatter.name || !manifest.body.trim()) {
      throw new Error("Skill resource verification failed for "+entry.uri);
    }
  }

  console.log("MCP Skills smoke test passed: skills/list, skills/get and verified resources/read for "+listed.skills.length+" Skills.");
} finally {
  await client.close();
  await server.close();
}
