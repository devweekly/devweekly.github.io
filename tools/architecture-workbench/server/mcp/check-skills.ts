import express from "express";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";

const databasePath=resolve("data/architecture-workbench.mcp-smoke.sqlite");
mkdirSync(resolve("data"),{recursive:true});
for (const suffix of ["","-wal","-shm"]) rmSync(databasePath+suffix,{force:true});
process.env.DATABASE_PATH=databasePath;
process.env.MCP_ALLOWED_HOSTS="";
delete process.env.MCP_BEARER_TOKEN;
delete process.env.MCP_SERVICE_USER_ID;

const [{seed},{db,all,run,id,now},{mountSkillsMcpEndpoint}]=await Promise.all([
  import("../seed.js"),
  import("../db.js"),
  import("./skills-server.js")
]);

function assert(condition:unknown,message:string):asserts condition {
  if (!condition) throw new Error(message);
}

function parseToolResult(result:{content:Array<{type:string;text?:string}>;isError?:boolean}):any {
  const text=result.content.find(item=>item.type==="text")?.text || "";
  if (result.isError) throw new Error("MCP tool returned an error: "+text);
  return text ? JSON.parse(text) as Record<string,any> : {};
}

async function startMcpServer() {
  const app=express();
  app.use(express.json({limit:"2mb"}));
  const count=await mountSkillsMcpEndpoint(app);
  const httpServer=createServer(app);
  await new Promise<void>((resolveListen,reject)=>{
    httpServer.once("error",reject);
    httpServer.listen(0,"127.0.0.1",()=>resolveListen());
  });
  const address=httpServer.address();
  if (!address || typeof address==="string") throw new Error("Could not resolve MCP test server address.");
  return {httpServer,url:"http://127.0.0.1:"+address.port+"/mcp",skillCount:count};
}

async function connect(url:string,headers:Record<string,string>) {
  const client=new Client({name:"architecture-workbench-smoke-test",version:"0.2.0"});
  const transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers}});
  await client.connect(transport);
  return client;
}

async function closeServer(server:ReturnType<typeof createServer>) {
  await new Promise<void>((resolveClose,reject)=>{
    server.close(error=>error?reject(error):resolveClose());
  });
}

seed();
const workItem=all<{id:string;code:string}>("SELECT id,code FROM work_items WHERE type<>'technical_debt' AND owner_id='u-sa' ORDER BY created_at LIMIT 1")[0];
assert(workItem,"Seed data must contain a Work Item owned by u-sa.");

let localServer:Awaited<ReturnType<typeof startMcpServer>>|undefined;
let localClient:Client|undefined;
let remoteServer:Awaited<ReturnType<typeof startMcpServer>>|undefined;
let remoteClient:Client|undefined;

try {
  localServer=await startMcpServer();
  assert(localServer.skillCount===7,"Expected seven published Skills.");
  localClient=await connect(localServer.url,{"x-demo-user-id":"u-sa"});

  const skillsHost=new SkillsClient(localClient);
  const listed=await skillsHost.list();
  const expectedSkills=["architecture-review","business-analysis","data-architecture","decision-preparation","request-coordination","security-review","solution-architecture"];
  const actualSkills=listed.skills.map(entry=>entry.frontmatter.name).sort();
  assert(JSON.stringify(actualSkills)===JSON.stringify(expectedSkills),"Skills discovery returned an unexpected catalog.");
  for (const entry of listed.skills) {
    const fetched=await skillsHost.get(entry.uri);
    assert(fetched.skill.frontmatter.name===entry.frontmatter.name,"skills/get returned mismatched metadata.");
    const resource=await skillsHost.read(entry);
    assert(resource.verified && resource.frontmatter?.name===entry.frontmatter.name,"Skill resource digest verification failed.");
  }

  const tools=await localClient.listTools();
  const toolNames=tools.tools.map(tool=>tool.name);
  const requiredTools=[
    "workbench_search_work_items","workbench_get_work_item","workbench_get_artifact","workbench_get_context_capsule",
    "workbench_get_workflow_state","workbench_list_my_tasks","workbench_create_task",
    "workbench_update_task","workbench_create_artifact_draft","workbench_add_comment",
    "agent_list_profiles","agent_request_run","agent_claim_run","agent_claim_next_run","agent_complete_run",
    "agent_request_human_handoff","agent_fail_run","agent_resume_run","agent_list_runs","agent_get_run_events"
  ];
  for (const name of requiredTools) assert(toolNames.includes(name),"Missing MCP Tool: "+name);
  assert(!toolNames.some(name=>name.includes("record_decision")||name.includes("submit_review")),"Agents must not receive formal Decision or Review tools.");

  const search=parseToolResult(await localClient.callTool({name:"workbench_search_work_items",arguments:{query:workItem.code}}));
  assert(Array.isArray(search) && search.some((item:any)=>item.id===workItem.id),"Work Item search failed.");
  const detail=parseToolResult(await localClient.callTool({name:"workbench_get_work_item",arguments:{workItemId:workItem.id}}));
  assert(detail.workItem.id===workItem.id && Array.isArray(detail.artifacts),"Work Item detail was incomplete.");
  const seededArtifact=detail.artifacts[0];
  const fullArtifact=parseToolResult(await localClient.callTool({name:"workbench_get_artifact",arguments:{artifactId:seededArtifact.id}}));
  assert(fullArtifact.id===seededArtifact.id && typeof fullArtifact.content==="string","Artifact content lookup failed.");
  const capsule=parseToolResult(await localClient.callTool({name:"workbench_get_context_capsule",arguments:{workItemId:workItem.id}}));
  assert(capsule.workItem.id===workItem.id && Array.isArray(capsule.externalResources),"Context Capsule did not expose external resource references.");
  const workflow=parseToolResult(await localClient.callTool({name:"workbench_get_workflow_state",arguments:{workItemId:workItem.id}}));
  assert(typeof workflow.status==="string","Workflow state was not returned.");

  const task=parseToolResult(await localClient.callTool({
    name:"workbench_create_task",
    arguments:{workItemId:workItem.id,title:"MCP smoke-test task",kind:"analysis",assigneeId:"u-sa"}
  }));
  assert(task.id,"Task creation failed.");
  const taskUpdate=parseToolResult(await localClient.callTool({
    name:"workbench_update_task",arguments:{taskId:task.id,status:"in_progress"}
  }));
  assert(taskUpdate.status==="in_progress","Task update failed.");

  const draft=parseToolResult(await localClient.callTool({
    name:"workbench_create_artifact_draft",
    arguments:{workItemId:workItem.id,title:"MCP Smoke Draft",type:"analysis",code:"MCP-SMOKE",summary:"Protocol test",content:"Smoke test artifact content."}
  }));
  assert(draft.id && draft.status==="draft" && draft.contentHash.length===64,"Draft Artifact creation failed.");
  const comment=parseToolResult(await localClient.callTool({
    name:"workbench_add_comment",arguments:{workItemId:workItem.id,body:"MCP smoke-test discussion note."}
  }));
  assert(comment.id,"Comment creation failed.");

  const profiles=parseToolResult(await localClient.callTool({name:"agent_list_profiles",arguments:{}}));
  assert(profiles.profiles.length===7 && profiles.runtime.mode==="pull","Agent profile registry or runtime adapter is missing.");

  const requested=parseToolResult(await localClient.callTool({
    name:"agent_request_run",
    arguments:{workItemId:workItem.id,agentKey:"business-analyst",objective:"Analyse the Request and produce traceable acceptance criteria."}
  }));
  const runId=requested.run.id;
  assert(runId && requested.skillUri.includes("business-analysis"),"Coordinator failed to queue the requested Agent run.");

  const claimNext=parseToolResult(await localClient.callTool({name:"agent_claim_next_run",arguments:{agentKey:"business-analyst"}}));
  const claimed=claimNext.run;
  assert(claimNext.skillUri.includes("business-analysis"),"Claim-next did not return the required Skill URI.");
  assert(claimed.id===runId,"Claim-next selected a different run.");
  assert(claimed.status==="running" && claimed.claimed_by==="u-sa","Agent run claim failed.");

  const completed=parseToolResult(await localClient.callTool({
    name:"agent_complete_run",
    arguments:{runId,artifactTitle:"Business Analysis Draft",artifactType:"analysis",artifactCode:"BUS-ANALYSIS",summary:"Draft result",content:"Objective, stakeholders, requirements and acceptance criteria."}
  }));
  assert(completed.run.status==="completed" && completed.artifact.status==="draft","Agent completion did not persist a draft Artifact.");

  const listedRuns=parseToolResult(await localClient.callTool({
    name:"agent_list_runs",arguments:{workItemId:workItem.id}
  }));
  assert(listedRuns.some((item:any)=>item.id===runId && item.status==="completed"),"Agent run listing did not include the completed run.");

  const handoffRequest=parseToolResult(await localClient.callTool({
    name:"agent_request_run",
    arguments:{workItemId:workItem.id,agentKey:"security-reviewer",objective:"Review the current security boundaries."}
  }));
  const handoffRunId=handoffRequest.run.id;
  await localClient.callTool({name:"agent_claim_run",arguments:{runId:handoffRunId,agentKey:"security-reviewer"}});
  const waiting=parseToolResult(await localClient.callTool({
    name:"agent_request_human_handoff",
    arguments:{runId:handoffRunId,reason:"The data classification is not documented.",questions:["Which customer fields are restricted?"],recommendedActions:["Ask the data owner to confirm classification."]}
  }));
  assert(waiting.status==="waiting_for_human","Human hand-off did not pause the Agent run.");

  const resumed=parseToolResult(await localClient.callTool({
    name:"agent_resume_run",arguments:{runId:handoffRunId,additionalContext:"Data owner confirmed the classification in the Request discussion."}
  }));
  assert(resumed.status==="queued","Human resume did not requeue the Agent run.");
  await localClient.callTool({name:"agent_claim_run",arguments:{runId:handoffRunId,agentKey:"security-reviewer"}});
  const failed=parseToolResult(await localClient.callTool({
    name:"agent_fail_run",arguments:{runId:handoffRunId,errorMessage:"Smoke-test simulated failure."}
  }));
  assert(failed.status==="failed","Agent failure state was not persisted.");

  const events=parseToolResult(await localClient.callTool({
    name:"agent_get_run_events",arguments:{runId:handoffRunId}
  }));
  assert(events.length>=5,"Agent run event history is incomplete.");

  const readOnlyClient=await connect(localServer.url,{"x-demo-user-id":"u-sec"});
  try {
    const denied=await readOnlyClient.callTool({
      name:"workbench_create_artifact_draft",
      arguments:{workItemId:workItem.id,title:"Should be denied",type:"analysis",content:"Must not be persisted."}
    });
    assert(denied.isError===true,"A read-only reviewer unexpectedly created a draft Artifact.");
  } finally {
    await readOnlyClient.close();
  }

  await localClient.close();
  localClient=undefined;
  await closeServer(localServer.httpServer);
  localServer=undefined;

  // Remote mode ignores caller-selected demo identity and uses one explicitly provisioned principal.
  run("INSERT OR IGNORE INTO participations(id,work_item_id,person_id,role_key,role_label,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",
    id("part"),workItem.id,"u-agent","agent_service","Agent Service Principal",JSON.stringify(["read","contribute","comment"]),now());
  process.env.MCP_ALLOWED_HOSTS="127.0.0.1";
  process.env.MCP_BEARER_TOKEN="workbench-mcp-smoke-token-with-more-than-32-chars";
  process.env.MCP_SERVICE_USER_ID="u-agent";

  remoteServer=await startMcpServer();
  remoteClient=await connect(remoteServer.url,{
    "Authorization":"Bearer "+process.env.MCP_BEARER_TOKEN,
    "x-demo-user-id":"u-admin"
  });
  const remoteDetail=parseToolResult(await remoteClient.callTool({
    name:"workbench_get_work_item",arguments:{workItemId:workItem.id}
  }));
  assert(remoteDetail.permissions.includes("contribute"),"Remote Agent Service Principal was not resolved.");
  assert(!remoteDetail.permissions.includes("decide") && !remoteDetail.permissions.includes("manage"),"Remote service principal was granted elevated permissions.");
  const remoteDraft=parseToolResult(await remoteClient.callTool({name:"workbench_create_artifact_draft",arguments:{workItemId:workItem.id,title:"Remote Agent Draft",type:"analysis",code:"REMOTE-SMOKE",content:"Written through the fixed remote service principal."}}));
  const remoteAuthor=all<{submitted_by:string}>("SELECT submitted_by FROM artifacts WHERE id=?",remoteDraft.id)[0]?.submitted_by;
  assert(remoteAuthor==="u-agent","Remote MCP accepted the caller-supplied demo identity instead of the configured service principal.");

  console.log("Workbench MCP smoke test passed: 7 Skills; 20 Tools; permission enforcement; draft Artifact and Task writes; queued/running/completed/failed/human-handoff Agent lifecycle; remote bearer authentication and fixed service identity.");
} finally {
  if (remoteClient) await remoteClient.close();
  if (remoteServer) await closeServer(remoteServer.httpServer);
  if (localClient) await localClient.close();
  if (localServer) await closeServer(localServer.httpServer);
  db.close();
  for (const suffix of ["","-wal","-shm"]) rmSync(databasePath+suffix,{force:true});
}
