#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr, env, cwd } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@tencent-ai/agent-sdk";

const hostDir = dirname(fileURLToPath(import.meta.url));
const rustAgentDir = resolve(hostDir, "../");
const defaultWorkspace = cwd();
const TOOL_NAMES = [
  "mcp__rust_workspace__read_file",
  "mcp__rust_workspace__list_dir",
  "mcp__rust_workspace__search_files",
  "mcp__rust_workspace__write_file"
];

function parseArgs(argv) {
  const result = {
    workspace: defaultWorkspace,
    model: undefined,
    fallbackModel: undefined,
    effort: undefined,
    thinking: undefined,
    maxTurns: 30,
    permissionMode: "default",
    sessionId: undefined,
    continueSession: false,
    forkSession: false,
    persistSession: true,
    settingSources: [],
    agentsFile: undefined,
    auditFile: undefined
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].split(/=(.*)/s, 2);
    const value = inline ?? argv[++index];
    if (key === "--help" || key === "-h") {
      console.log(`Usage: npm start -- [options]

Session:
  --session-id ID       Resume a specific CodeBuddy session
  --continue            Continue the most recent CodeBuddy session
  --fork                Fork the selected session before continuing
  --no-persist          Do not persist the CodeBuddy transcript

Model:
  --model ID            Model identifier
  --fallback-model ID   Fallback model identifier
  --effort LEVEL        low | medium | high | xhigh
  --thinking MODE       adaptive | disabled | enabled:N
  --max-turns N         Maximum Agent turns [default: 30]

Policy and configuration:
  --permission-mode M   default | plan | acceptEdits (writes still require host approval)
  --setting-source S    Explicitly load user, project, or local CodeBuddy settings (repeatable)
  --agents-file PATH    Explicit JSON file containing custom Agent definitions
  --audit-file PATH     Append lifecycle and tool audit events to this file

General:
  --workspace PATH     Workspace accessible to Rust tools [default: current directory]`);
      process.exit(0);
    }
    if (key === "--workspace") result.workspace = resolve(value);
    else if (key === "--model") result.model = value;
    else if (key === "--fallback-model") result.fallbackModel = value;
    else if (key === "--effort") result.effort = value;
    else if (key === "--thinking") result.thinking = value;
    else if (key === "--max-turns") result.maxTurns = Number(value);
    else if (key === "--permission-mode") result.permissionMode = value;
    else if (key === "--session-id") result.sessionId = value;
    else if (key === "--continue") result.continueSession = true;
    else if (key === "--fork") result.forkSession = true;
    else if (key === "--no-persist") result.persistSession = false;
    else if (key === "--setting-source") result.settingSources.push(value);
    else if (key === "--agents-file") result.agentsFile = resolve(value);
    else if (key === "--audit-file") result.auditFile = resolve(value);
    else throw new Error(`Unknown argument: ${key}`);
  }

  if (!Number.isInteger(result.maxTurns) || result.maxTurns < 1) {
    throw new Error("--max-turns must be a positive integer");
  }
  if (!["default", "plan", "acceptEdits"].includes(result.permissionMode)) {
    throw new Error("--permission-mode must be default, plan, or acceptEdits");
  }
  if (result.effort && !["low", "medium", "high", "xhigh"].includes(result.effort)) {
    throw new Error("--effort must be low, medium, high, or xhigh");
  }
  if (result.thinking && !["adaptive", "disabled"].includes(result.thinking)
      && !/^enabled:[1-9][0-9]*$/.test(result.thinking)) {
    throw new Error("--thinking must be adaptive, disabled, or enabled:<budgetTokens>");
  }
  if (result.sessionId && result.continueSession) {
    throw new Error("--session-id and --continue are mutually exclusive");
  }
  if (result.forkSession && !result.sessionId && !result.continueSession) {
    throw new Error("--fork requires --session-id or --continue");
  }
  for (const source of result.settingSources) {
    if (!["user", "project", "local"].includes(source)) {
      throw new Error(`Unsupported setting source: ${source}`);
    }
  }
  result.settingSources = [...new Set(result.settingSources)];
  return result;
}

function rustServerConfig(workspace, approvalToken) {
  const binary = env.RUST_AGENT_MCP_BIN ? resolve(env.RUST_AGENT_MCP_BIN) : undefined;
  const command = binary || "cargo";
  const args = binary
    ? ["--workspace", workspace]
    : [
        "run", "--quiet",
        "--manifest-path", resolve(rustAgentDir, "Cargo.toml"),
        "--bin", "rust-agent-mcp", "--",
        "--workspace", workspace
      ];

  const childEnv = { RUST_AGENT_APPROVAL_TOKEN: approvalToken };
  for (const key of ["PATH", "HOME", "CARGO_HOME", "RUSTUP_HOME"]) {
    if (env[key]) childEnv[key] = env[key];
  }
  return { type: "stdio", command, args, env: childEnv };
}

function readAgents(file) {
  if (!file) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--agents-file must contain a JSON object");
  }
  for (const [name, definition] of Object.entries(parsed)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)
        || !definition || typeof definition.description !== "string"
        || typeof definition.prompt !== "string") {
      throw new Error(`Invalid Agent definition: ${name}`);
    }
    if (definition.tools && (!Array.isArray(definition.tools)
        || definition.tools.some((tool) => !TOOL_NAMES.includes(tool)))) {
      throw new Error(`Agent ${name} may only use the Rust workspace tools`);
    }
    if (definition.disallowedTools?.some((tool) => TOOL_NAMES.includes(tool))) {
      throw new Error(`Agent ${name} cannot override the Rust tool boundary`);
    }
  }
  return parsed;
}

function createAuditWriter(file) {
  if (!file) return () => {};
  mkdirSync(dirname(file), { recursive: true });
  return (event, details = {}) => {
    const record = {
      timestamp: new Date().toISOString(),
      event,
      ...details
    };
    appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  };
}

function saveSession(file, session) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

function textBlocks(message) {
  const content = message?.message?.content ?? message?.content ?? [];
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block?.type === "text" && typeof block.text === "string");
}

function hookConfig(audit) {
  const events = [
    "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse",
    "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStart",
    "SubagentStop", "PreCompact", "PostCompact", "PermissionRequest"
  ];
  const hooks = {};
  for (const event of events) {
    hooks[event] = [{
      hooks: [async (input, toolUseID) => {
        const details = { toolUseID };
        if (typeof input?.tool_name === "string") details.tool = input.tool_name;
        if (typeof input?.toolName === "string") details.tool = input.toolName;
        if (typeof input?.session_id === "string") details.sessionId = input.session_id;
        if (typeof input?.prompt === "string") details.promptLength = input.prompt.length;
        if (typeof input?.agent_id === "string") details.agentId = input.agent_id;
        audit(`hook.${event}`, details);
        return { continue: true };
      }]
    }];
  }
  return hooks;
}

function buildOptions(args, workspace, approvalToken, audit, agents, sessionState) {
  const options = {
    cwd: workspace,
    maxTurns: args.maxTurns,
    permissionMode: args.permissionMode,
    settingSources: args.settingSources,
    persistSession: args.persistSession,
    allowedTools: agents ? [...TOOL_NAMES, "Agent"] : TOOL_NAMES,
    mcpServers: {
      rust_workspace: rustServerConfig(workspace, approvalToken)
    },
    hooks: hookConfig(audit),
    canUseTool: async (toolName, input, permissionOptions) => {
      const toolUseID = permissionOptions.toolUseID;
      if (toolName.endsWith("__read_file")
          || toolName.endsWith("__list_dir")
          || toolName.endsWith("__search_files")) {
        audit("permission.allow", { tool: toolName, toolUseID, agentId: permissionOptions.agentID });
        return { behavior: "allow", updatedInput: input, toolUseID };
      }

      if (toolName.endsWith("__write_file")) {
        const path = typeof input.path === "string" ? input.path : "<invalid path>";
        stdout.write(`\nRequested write operation:\n${JSON.stringify({ path, content: input.content }, null, 2)}\n`);
        const answer = (await sessionState.rl.question(
          `Approve this exact write to "${path}"? Type yes: `
        )).trim().toLowerCase();

        if (answer === "yes") {
          audit("permission.approve", { tool: toolName, path, toolUseID, agentId: permissionOptions.agentID });
          return {
            behavior: "allow",
            updatedInput: { ...input, _approval_token: approvalToken },
            toolUseID
          };
        }
        audit("permission.deny", { tool: toolName, path, toolUseID, agentId: permissionOptions.agentID });
        return {
          behavior: "deny",
          message: "User denied this write operation.",
          toolUseID
        };
      }

      audit("permission.deny", { tool: toolName, toolUseID, agentId: permissionOptions.agentID, reason: "not in Rust tool allow-list" });
      return {
        behavior: "deny",
        message: `Tool is not permitted by the Rust Agent host: ${toolName}`,
        toolUseID
      };
    }
  };

  if (args.model) options.model = args.model;
  if (args.fallbackModel) options.fallbackModel = args.fallbackModel;
  if (args.effort) options.effort = args.effort;
  if (args.thinking) {
    options.thinking = args.thinking.startsWith("enabled:")
      ? { type: "enabled", budgetTokens: Number(args.thinking.slice(8)) }
      : { type: args.thinking };
  }
  if (agents) options.agents = agents;
  if (args.sessionId) options.resume = args.sessionId;
  else if (args.continueSession || sessionState.sessionId) {
    options.resume = sessionState.sessionId;
  }
  if (args.forkSession) options.forkSession = true;
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspace = resolve(args.workspace);
  const approvalToken = randomBytes(32).toString("hex");
  const rl = createInterface({ input: stdin, output: stdout });
  const sessionFile = resolve(workspace, ".rust-agent", "session.json");
  const auditFile = args.auditFile ?? resolve(workspace, ".rust-agent", "audit.jsonl");
  const audit = createAuditWriter(auditFile);
  const agents = readAgents(args.agentsFile);
  let sessionId = args.sessionId;

  if (!sessionId && !args.continueSession) {
    try {
      const previous = JSON.parse(readFileSync(sessionFile, "utf8"));
      if (previous.workspace === workspace && typeof previous.sessionId === "string") {
        sessionId = previous.sessionId;
      }
    } catch {
      // A missing or invalid local session pointer starts a new session.
    }
  }

  const sessionState = { rl, sessionId };
  console.log("Rust Agent + CodeBuddy");
  console.log(`Workspace: ${workspace}`);
  console.log(`Audit: ${auditFile}`);
  console.log("CodeBuddy manages model orchestration; Rust enforces local tool policy.");
  console.log("Commands: /exit, /new, /session, /resume <id>, /fork, /model <id>, /mode <default|plan|acceptEdits>");
  if (sessionId) console.log(`Resuming session: ${sessionId}`);

  let activeSessionId = sessionId;
  let currentModel = args.model;
  let permissionMode = args.permissionMode;
  let hasSession = Boolean(sessionId || args.continueSession);
  audit("host.start", { workspace, sessionId: activeSessionId, model: currentModel });

  try {
    while (true) {
      const prompt = (await rl.question("you> ")).trim();
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;
      if (prompt === "/new") {
        activeSessionId = undefined;
        sessionState.sessionId = undefined;
        hasSession = false;
        args.sessionId = undefined;
        args.continueSession = false;
        args.forkSession = false;
        try { unlinkSync(sessionFile); } catch {}
        console.log("Started a new session on the next prompt.");
        continue;
      }
      if (prompt === "/session") {
        console.log(activeSessionId ? `Session: ${activeSessionId}` : "No session ID received yet.");
        continue;
      }
      if (prompt.startsWith("/resume ")) {
        const requestedSessionId = prompt.slice(8).trim();
        if (!requestedSessionId) {
          console.log("Usage: /resume <session-id>");
        } else {
          activeSessionId = requestedSessionId;
          sessionState.sessionId = requestedSessionId;
          hasSession = true;
          args.continueSession = false;
          args.forkSession = false;
          console.log(`Will resume session ${requestedSessionId} on the next turn.`);
        }
        continue;
      }
      if (prompt === "/fork") {
        if (!activeSessionId) console.log("There is no active session to fork.");
        else {
          args.forkSession = true;
          console.log("The next turn will fork the active session.");
        }
        continue;
      }
      if (prompt.startsWith("/model ")) {
        currentModel = prompt.slice(7).trim() || undefined;
        console.log(`Model for next turn: ${currentModel ?? "SDK default"}`);
        continue;
      }
      if (prompt.startsWith("/mode ")) {
        const mode = prompt.slice(6).trim();
        if (!["default", "plan", "acceptEdits"].includes(mode)) {
          console.log("Mode must be default, plan, or acceptEdits.");
        } else {
          permissionMode = mode;
          console.log(`Permission mode for next turn: ${mode} (Rust write approval remains mandatory).`);
        }
        continue;
      }

      audit("prompt.submit", { promptLength: prompt.length, sessionId: activeSessionId });
      const turnArgs = { ...args, model: currentModel, permissionMode, sessionId: activeSessionId };
      const options = buildOptions(turnArgs, workspace, approvalToken, audit, agents, {
        ...sessionState,
        sessionId: activeSessionId
      });
      if (hasSession && activeSessionId && !args.sessionId) {
        options.resume = activeSessionId;
        options.continue = false;
      } else if (hasSession && args.continueSession && !activeSessionId) {
        options.continue = true;
      }

      try {
        const stream = query({ prompt, options });
        let printedAssistant = false;
        for await (const message of stream) {
          if (message?.type === "system" && message.subtype === "init"
              && typeof message.session_id === "string") {
            activeSessionId = message.session_id;
            sessionState.sessionId = activeSessionId;
            saveSession(sessionFile, { workspace, sessionId: activeSessionId, updatedAt: new Date().toISOString() });
            audit("session.initialized", { sessionId: activeSessionId, model: message.model });
            console.log(`[session] ${activeSessionId}`);
          } else if (message?.type === "assistant") {
            for (const block of textBlocks(message)) {
              if (!printedAssistant) {
                stdout.write("agent> ");
                printedAssistant = true;
              }
              stdout.write(block.text);
            }
          } else if (message?.type === "tool_use") {
            stderr.write(`[tool] ${message.name}\n`);
          } else if (message?.type === "tool_result" && message.is_error) {
            stderr.write(`[tool error] ${JSON.stringify(message.content)}\n`);
          } else if (message?.type === "result") {
            audit("turn.result", {
              sessionId: message.session_id ?? activeSessionId,
              subtype: message.subtype,
              isError: message.is_error,
              turns: message.num_turns,
              durationMs: message.duration_ms,
              usage: message.usage,
              totalCostUsd: message.total_cost_usd
            });
            if (message.session_id) activeSessionId = message.session_id;
            if (message.subtype !== "success") {
              stderr.write(`[turn] ${message.subtype}\n`);
            }
          } else if (message?.type === "system" && message.subtype?.startsWith("task_")) {
            audit(`task.${message.subtype}`, {
              sessionId: message.session_id ?? activeSessionId,
              taskId: message.task_id,
              status: message.status,
              taskType: message.task_type
            });
          }
        }
        if (printedAssistant) stdout.write("\n");
        hasSession = true;
        if (activeSessionId) {
          sessionState.sessionId = activeSessionId;
          saveSession(sessionFile, { workspace, sessionId: activeSessionId, updatedAt: new Date().toISOString() });
        }
      } catch (error) {
        audit("turn.error", { sessionId: activeSessionId, message: error instanceof Error ? error.message : String(error) });
        stderr.write(`CodeBuddy request failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    audit("host.stop", { sessionId: activeSessionId });
    rl.close();
  }
}

main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
