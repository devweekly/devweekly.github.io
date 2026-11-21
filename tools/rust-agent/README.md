# Rust Agent

Rust Agent 将 CodeBuddy Agent SDK 与本机 Rust 工具执行层组合起来。CodeBuddy 负责模型交互、Agent Loop、上下文和多轮会话；Rust 负责 Workspace 文件工具、最终 Policy Gate 和写操作执行。两者通过 MCP stdio 通信。

## Architecture

\`\`\`mermaid
flowchart TB
    USER["Terminal / Desktop UI"] --> HOST["CodeBuddy SDK Host"]
    HOST --> SDK["CodeBuddy Agent / Session"]
    SDK <--> MCP["Rust MCP Server (stdio)"]
    MCP --> POLICY["Rust Policy Gate"]
    POLICY --> TOOLS["Native Rust Workspace Tools"]
    TOOLS --> WS["Configured Workspace"]
    HOST --> APPROVAL["Per-write user approval"]
    APPROVAL -->|"one-call approval token"| MCP
\`\`\`

CodeBuddy SDK 默认不加载用户或项目的本地配置；Host 显式使用空的 \`settingSources\`，只开放 Rust MCP 工具，避免 CodeBuddy 自带文件或 Shell 工具绕过 Rust 工具边界。Host 使用 CodeBuddy 已有登录态或 SDK 支持的认证方式，不在项目中保存 API Key。

## Requirements

- Rust toolchain matching the workspace \`rust-toolchain.toml\` (or a compatible stable toolchain).
- Node.js 18.20 or later.
- CodeBuddy CLI installed and authenticated, or another supported SDK authentication configuration.
- npm.

## Build and run

\`\`\`bash
cd tools/rust-agent
cargo build --release --bin rust-agent-mcp

cd codebuddy-host
npm install
npm start -- --workspace /absolute/path/to/workspace
\`\`\`

Optional model selection:

\`\`\`bash
npm start -- --workspace /path/to/workspace --model <codebuddy-model-id>
\`\`\`

If the MCP binary has been built elsewhere, set \`RUST_AGENT_MCP_BIN\` to its absolute path. Otherwise the host launches it through \`cargo run\`.

The host uses CodeBuddy's \`query()\` streaming API. Subsequent prompts request continuation of the most recent session. The SDK and CLI versions should be kept compatible; MCP integration requires CodeBuddy Agent SDK v0.1.24 or later.

## Tools and policy

| Tool | Rust policy | Host behavior |
|---|---|---|
| \`read_file\` | Allow | Allow |
| \`list_dir\` | Allow | Allow |
| \`search_files\` | Allow | Allow |
| \`write_file\` | Require approval | Prompt for every call, then inject a one-call approval token |
| Unknown tool | Deny | Deny |

The approval token is generated in the host process for each run, passed only to the Rust MCP child process through its environment, and injected into the approved tool input by the SDK permission callback. The Rust server removes the token before validating and executing the action. A model-generated parameter alone cannot satisfy the approval check. This is an application-level control, not protection against a compromised host process or same-user malware.

No Shell, process execution, arbitrary network tool, or workspace-external file tool is exposed. File operations remain subject to the existing application-level path checks; this is not an OS sandbox and does not eliminate filesystem TOCTOU risks.

## Standalone Rust CLI

The original OpenAI-compatible Rust CLI remains available:

\`\`\`bash
export OPENAI_API_KEY="..."
cargo run -- --model <model-id> --workspace /path/to/workspace
\`\`\`

The CodeBuddy path does not use the Rust OpenAI-compatible Agent Loop. It uses CodeBuddy's Agent Loop and the Rust binary only as an MCP tool server.

## Current limitations

- MCP transport is stdio and implements the initialize, ping, tools/list, and tools/call methods needed by this host.
- Session continuation uses the SDK's \`continue\` option; explicit session-ID selection and durable application-level session metadata are not implemented.
- Approval is interactive terminal approval. A GUI host will need an approval UI and a secure host-to-tool approval channel.
- Audit persistence, isolated Worker processes, OS sandboxing, and cancellation propagation into an already-running filesystem operation are not implemented.
- The SDK is currently documented as Preview; pin and validate the SDK/CLI pair in the deployment environment.
