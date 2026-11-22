import { Client } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import type { AgentKey } from "./coordinator.js";

type McpContent = { type:string; text?:string };

export interface HostAgentRun {
  id:string;
  work_item_id:string;
  task_id:string|null;
  plan_id:string|null;
  node_key:string;
  agent_key:AgentKey;
  skill_name:string;
  objective:string;
  status:string;
  claim_token:string;
  lease_expires_at:string;
  lease_duration_ms:number;
  attempt_count:number;
  max_attempts:number;
}

export interface VerifiedSkill {
  uri:string;
  frontmatter:Record<string,unknown> & {name:string;description:string};
  body:string;
  verified:true;
}

export interface AgentExecutionContext {
  run:HostAgentRun;
  skill:VerifiedSkill;
  contextCapsule:Record<string,unknown>;
  planContext?:Record<string,unknown>;
  signal:AbortSignal;
  readArtifact(artifactId:string):Promise<Record<string,unknown>>;
}

export type AgentExecutionResult =
  | {
      kind:"completed";
      artifact:{
        title:string;
        type:"analysis"|"architecture"|"adr"|"data_architecture"|"security_review"|"review_report"|"decision_brief"|"diagram"|"other";
        code?:string;
        summary?:string;
        content:string;
      };
    }
  | {
      kind:"human_handoff";
      reason:string;
      questions?:string[];
      recommendedActions?:string[];
    };

export interface AgentExecutor {
  execute(context:AgentExecutionContext):Promise<AgentExecutionResult>;
}

export type AgentExecutorRegistry = Partial<Record<AgentKey,AgentExecutor>>;

type ClaimedRun = {
  run:HostAgentRun;
  skillUri:string;
};

type LeaseHeartbeat = {
  signal:AbortSignal;
  assertHealthy():void;
  stop():Promise<void>;
};

function parseToolResult<T>(result:{content?:McpContent[];isError?:boolean}):T {
  const text=result.content?.find(item=>item.type==="text")?.text || "";
  if (result.isError) throw new Error(text || "Workbench MCP Tool failed.");
  if (!text) throw new Error("Workbench MCP Tool returned an empty result.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Workbench MCP Tool returned invalid JSON.");
  }
}

/**
 * Provider-neutral Agent Host. It pulls Run nodes from Workbench, verifies the
 * mapped Skill, obtains participant-scoped context, and dispatches to a
 * provider-specific AgentExecutor supplied by the deployment.
 */
export class McpAgentHost {
  private readonly skills:SkillsClient;

  constructor(
    private readonly client:Client,
    private readonly executors:AgentExecutorRegistry,
    private readonly pollIntervalMs=3000
  ) {
    this.skills=new SkillsClient(client);
  }

  private async call<T>(name:string,args:Record<string,unknown>):Promise<T> {
    const result=await this.client.callTool({name,arguments:args});
    return parseToolResult<T>(result);
  }

  private startLeaseHeartbeat(run:HostAgentRun):LeaseHeartbeat {
    const controller=new AbortController();
    const intervalMs=Math.max(1_000,Math.floor((run.lease_duration_ms || 60_000)/3));
    let failure:unknown;
    let inFlight:Promise<void>|undefined;
    let stopped=false;
    const timer=setInterval(()=>{
      if (stopped || failure || inFlight) return;
      inFlight=this.call("agent_heartbeat_run",{
        runId:run.id,
        claimToken:run.claim_token
      }).then(()=>undefined).catch(error=>{
        failure=error;
        controller.abort();
      }).finally(()=>{
        inFlight=undefined;
      });
    },intervalMs);
    timer.unref?.();
    return {
      signal:controller.signal,
      assertHealthy:()=>{
        if (failure) throw new Error("Agent Run lease heartbeat failed: "+(failure instanceof Error ? failure.message : String(failure)));
      },
      stop:async()=>{
        if (stopped) return;
        stopped=true;
        clearInterval(timer);
        if (inFlight) await inFlight;
      }
    };
  }

  async runOnce(agentKey:AgentKey):Promise<"idle"|"completed"|"human_handoff"|"failed"> {
    let claimed:ClaimedRun|null=null;
    let heartbeat:LeaseHeartbeat|undefined;
    try {
      claimed=await this.call<ClaimedRun|null>("agent_claim_next_run",{agentKey});
      if (!claimed?.run) return "idle";
      heartbeat=this.startLeaseHeartbeat(claimed.run);

      const executor=this.executors[agentKey];
      if (!executor) throw new Error("No AgentExecutor is registered for profile: "+agentKey);

      const listed=await this.skills.list();
      const skillEntry=listed.skills.find(entry=>entry.uri===claimed!.skillUri);
      if (!skillEntry) throw new Error("The required Skill is not published: "+claimed.skillUri);
      const skill=await this.skills.read(skillEntry);
      if (!skill.verified || !skill.frontmatter || typeof skill.body!=="string") {
        throw new Error("Skill integrity verification failed: "+claimed.skillUri);
      }

      const contextCapsule=await this.call<Record<string,unknown>>(
        "workbench_get_context_capsule",
        {workItemId:claimed.run.work_item_id}
      );
      const planContext=claimed.run.plan_id && claimed.run.node_key==="synthesis"
        ? await this.call<Record<string,unknown>>("agent_get_plan_context",{runId:claimed.run.id,claimToken:claimed.run.claim_token})
        : undefined;

      const execution=await executor.execute({
        run:claimed.run,
        skill:{
          uri:claimed.skillUri,
          frontmatter:skill.frontmatter as VerifiedSkill["frontmatter"],
          body:skill.body,
          verified:true
        },
        contextCapsule,
        planContext,
        signal:heartbeat.signal,
        readArtifact:(artifactId)=>this.call<Record<string,unknown>>(
          "workbench_get_artifact",
          {artifactId}
        )
      });
      heartbeat.assertHealthy();

      if (execution.kind==="human_handoff") {
        await this.call("agent_request_human_handoff",{
          runId:claimed.run.id,
          claimToken:claimed.run.claim_token,
          reason:execution.reason,
          questions:execution.questions || [],
          recommendedActions:execution.recommendedActions || []
        });
        return "human_handoff";
      }

      await this.call("agent_complete_run",{
        runId:claimed.run.id,
        claimToken:claimed.run.claim_token,
        artifactTitle:execution.artifact.title,
        artifactType:execution.artifact.type,
        artifactCode:execution.artifact.code,
        summary:execution.artifact.summary,
        content:execution.artifact.content
      });
      return "completed";
    } catch (error) {
      await heartbeat?.stop();
      if (claimed?.run?.id) {
        try {
          await this.call("agent_fail_run",{
            runId:claimed.run.id,
            claimToken:claimed.run.claim_token,
            errorMessage:error instanceof Error ? error.message : "Agent execution failed."
          });
        } catch {
          // Preserve the original failure. The server-side run remains inspectable.
        }
      }
      return "failed";
    } finally {
      await heartbeat?.stop();
    }
  }

  async run(agentKeys:AgentKey[],signal:AbortSignal,workersPerProfile=1):Promise<void> {
    const worker=async(agentKey:AgentKey)=>{
      while (!signal.aborted) {
        const result=await this.runOnce(agentKey);
        if (result==="idle") {
          await new Promise<void>(resolve=>{
            const onAbort=()=>{
              clearTimeout(timer);
              signal.removeEventListener("abort",onAbort);
              resolve();
            };
            const timer=setTimeout(()=>{
              signal.removeEventListener("abort",onAbort);
              resolve();
            },this.pollIntervalMs);
            signal.addEventListener("abort",onAbort,{once:true});
          });
        }
      }
    };
    const loops:Promise<void>[]=[];
    for (const agentKey of agentKeys) {
      for (let index=0;index<Math.max(1,Math.min(workersPerProfile,4));index++) loops.push(worker(agentKey));
    }
    await Promise.all(loops);
  }
}
