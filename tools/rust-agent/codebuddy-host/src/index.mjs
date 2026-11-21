#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr, env, cwd } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@tencent-ai/agent-sdk";

const hostDir = dirname(fileURLToPath(import.meta.url));
const rustAgentDir = resolve(hostDir, "../");
const defaultWorkspace = cwd();

function parseArgs(argv) {
  const result = { workspace: defaultWorkspace, model: undefined, maxTurns: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].split(/=(.*)/s, 2);
    const value = inline ?? argv[++index];
    if (key === "--help" || key === "-h") {
      console.log("Usage: npm start -- [--workspace PATH] [--model MODEL] [--max-turns N]");
      process.exit(0);
    }
    if (key === "--workspace") result.workspace = resolve(value);
    else if (key === "--model") result.model = value;
    else if (key === "--max-turns") result.maxTurns = Number(value);
    else throw new Error(\`Unknown argument: \${key}\`);
  }
  if (!Number.isInteger(result.maxTurns) || result.maxTurns < 1) {
    throw new Error("--max-turns must be a positive integer");
  }
  return result;
}

function rustServerConfig(workspace, approvalToken) {
  const binary = env.RUST_AGENT_MCP_BIN;
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

function textBlocks(message) {
  const content = message?.message?.content ?? message?.content ?? [];
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block?.type === "text" && typeof block.text === "string");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspace = resolve(args.workspace);
  const approvalToken = randomBytes(32).toString("hex");
  const rl = createInterface({ input: stdin, output: stdout });

  console.log("Rust Agent + CodeBuddy");
  console.log(\`Workspace: \${workspace}\`);
  console.log("CodeBuddy manages the Agent session; Rust enforces local tool policy.");
  console.log("Type /exit to quit.");

  let hasSession = false;
  try {
    while (true) {
      const prompt = (await rl.question("you> ")).trim();
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;

      const options = {
        cwd: workspace,
        maxTurns: args.maxTurns,
        permissionMode: "default",
        settingSources: [],
        allowedTools: [
          "mcp__rust_workspace__read_file",
          "mcp__rust_workspace__list_dir",
          "mcp__rust_workspace__search_files",
          "mcp__rust_workspace__write_file"
        ],
        mcpServers: {
          rust_workspace: rustServerConfig(workspace, approvalToken)
        },
        canUseTool: async (toolName, input, permissionOptions) => {
          if (toolName.endsWith("__read_file")
              || toolName.endsWith("__list_dir")
              || toolName.endsWith("__search_files")) {
            return {
              behavior: "allow",
              updatedInput: input,
              toolUseID: permissionOptions.toolUseID
            };
          }

          if (toolName.endsWith("__write_file")) {
            const path = typeof input.path === "string" ? input.path : "<invalid path>";
            const answer = (await rl.question(
              \`Approve write_file to "\${path}" with \${String(input.content ?? "").length} characters? Type yes: \`
            )).trim().toLowerCase();

            if (answer === "yes") {
              return {
                behavior: "allow",
                updatedInput: { ...input, _approval_token: approvalToken },
                toolUseID: permissionOptions.toolUseID
              };
            }
            return {
              behavior: "deny",
              message: "User denied this write operation.",
              toolUseID: permissionOptions.toolUseID
            };
          }

          return {
            behavior: "deny",
            message: \`Tool is not permitted by the Rust Agent host: \${toolName}\`,
            toolUseID: permissionOptions.toolUseID
          };
        }
      };
      if (args.model) options.model = args.model;
      if (hasSession) options.continue = true;

      try {
        const stream = query({ prompt, options });
        let printedAssistant = false;
        for await (const message of stream) {
          if (message?.type === "assistant") {
            for (const block of textBlocks(message)) {
              if (!printedAssistant) {
                stdout.write("agent> ");
                printedAssistant = true;
              }
              stdout.write(block.text);
            }
          } else if (message?.type === "tool_use") {
            stderr.write(\`[tool] \${message.name}\n\`);
          } else if (message?.type === "tool_result" && message.is_error) {
            stderr.write(\`[tool error] \${JSON.stringify(message.content)}\n\`);
          }
        }
        if (printedAssistant) stdout.write("\n");
        hasSession = true;
      } catch (error) {
        stderr.write(\`CodeBuddy request failed: \${error instanceof Error ? error.message : String(error)}\n\`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  stderr.write(\`\${error instanceof Error ? error.message : String(error)}\n\`);
  process.exitCode = 1;
});
