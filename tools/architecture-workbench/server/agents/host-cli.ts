import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { agentProfiles, type AgentKey } from "./coordinator.js";
import { McpAgentHost, type AgentExecutorRegistry } from "./host.js";

type ExecutorModule = {
  createAgentExecutors?:()=>AgentExecutorRegistry|Promise<AgentExecutorRegistry>;
};

function configuredProfiles():AgentKey[] {
  const configured=(process.env.AGENT_HOST_PROFILES || agentProfiles.map(profile=>profile.key).join(","))
    .split(",").map(value=>value.trim()).filter(Boolean);
  const valid=new Set<string>(agentProfiles.map(profile=>profile.key));
  const invalid=configured.filter(profile=>!valid.has(profile));
  if (invalid.length) throw new Error("Unknown Agent Host profiles: "+invalid.join(", "));
  return [...new Set(configured)] as AgentKey[];
}

async function main() {
  const mcpUrl=process.env.MCP_URL || "http://127.0.0.1:4000/mcp";
  const executorModulePath=process.env.AGENT_EXECUTOR_MODULE;
  if (!executorModulePath) throw new Error("AGENT_EXECUTOR_MODULE must point to a module that exports createAgentExecutors().");

  const imported=await import(pathToFileURL(resolve(executorModulePath)).href) as ExecutorModule;
  if (typeof imported.createAgentExecutors!=="function") {
    throw new Error("AGENT_EXECUTOR_MODULE must export createAgentExecutors().");
  }
  const executors=await imported.createAgentExecutors();
  const profiles=configuredProfiles();
  for (const profile of profiles) {
    if (!executors[profile]) throw new Error("No AgentExecutor registered for configured profile: "+profile);
  }

  const headers:Record<string,string>={};
  if (process.env.MCP_BEARER_TOKEN) {
    headers.Authorization="Bearer "+process.env.MCP_BEARER_TOKEN;
  } else {
    headers["x-demo-user-id"]=process.env.MCP_DEMO_USER_ID || "u-agent";
  }

  const transport=new StreamableHTTPClientTransport(new URL(mcpUrl),{
    requestInit:{headers}
  });
  const client=new Client({name:"architecture-workbench-agent-host",version:"0.1.0"});
  await client.connect(transport);

  const controller=new AbortController();
  process.once("SIGINT",()=>controller.abort());
  process.once("SIGTERM",()=>controller.abort());

  const concurrency=Number(process.env.AGENT_HOST_WORKERS_PER_PROFILE || 1);
  const pollInterval=Number(process.env.AGENT_HOST_POLL_INTERVAL_MS || 3000);
  console.log("Workbench Agent Host connected to "+mcpUrl);
  console.log("Profiles: "+profiles.join(", "));
  console.log("Workers per profile: "+Math.max(1,Math.min(concurrency,4)));

  try {
    const host=new McpAgentHost(client,executors,pollInterval);
    await host.run(profiles,controller.signal,concurrency);
  } finally {
    await client.close();
  }
}

main().catch(error=>{
  console.error(error instanceof Error ? error.message : error);
  process.exitCode=1;
});
