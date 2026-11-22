import type { AgentKey } from "./coordinator.js";

/**
 * Execution contract between Workbench's coordinator and an Agent Host.
 * The current implementation is pull-based over MCP: the Host claims a queued
 * run, loads the declared Skill and uses Workbench tools to produce its result.
 * Model/provider SDKs remain outside the Workbench server.
 */
export interface AgentExecutionRequest {
  runId: string;
  workItemId: string;
  agentKey: AgentKey;
  skillName: string;
  objective: string;
  taskId: string | null;
}

export interface AgentRuntimeAdapter {
  readonly kind: string;
  describe(): {
    mode: "pull";
    capabilities: readonly string[];
    providerOwnedByHost: true;
  };
}

export class McpHostRuntimeAdapter implements AgentRuntimeAdapter {
  readonly kind = "mcp-host";

  describe() {
    return {
      mode: "pull" as const,
      capabilities: ["claim-run", "read-context", "create-draft-artifact", "human-handoff", "complete-run"],
      providerOwnedByHost: true as const
    };
  }
}

export const agentRuntimeAdapter = new McpHostRuntimeAdapter();
