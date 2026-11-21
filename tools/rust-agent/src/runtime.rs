use std::{
    io::{self, Write},
    path::{Path, PathBuf},
};

use serde_json::json;
use tracing::{info, warn};

use crate::{
    action::{ModelTurn, ToolAction},
    error::AgentError,
    policy::{self, PolicyDecision},
    provider::{ChatMessage, OpenAiCompatibleProvider},
    tools::ToolExecutor,
};

const SYSTEM_PROMPT: &str = r#"You are a local coding and research assistant. You can use only the tools listed below.
Return exactly one JSON object, without Markdown fences:
{"type":"final","content":"..."}
or
{"type":"tool_call","tool":"read_file","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"list_dir","arguments":{"path":"relative/path"}}
or
{"type":"tool_call","tool":"write_file","arguments":{"path":"relative/path","content":"..."}}

Tool rules:
- Paths are relative to the configured workspace.
- read_file and list_dir are read-only.
- write_file changes a workspace file and always requires explicit user approval.
- There is no shell, process execution, arbitrary network tool, or access outside the workspace.
- Never claim a tool succeeded unless its result says it succeeded.
- If a task cannot be completed with these tools, explain the limitation."#;

pub struct AgentRuntime {
    provider: OpenAiCompatibleProvider,
    workspace: PathBuf,
    executor: ToolExecutor,
    messages: Vec<ChatMessage>,
}

impl AgentRuntime {
    pub fn new(provider: OpenAiCompatibleProvider, workspace: PathBuf) -> Self {
        let executor = ToolExecutor::new(workspace.clone());
        Self {
            provider,
            workspace,
            executor,
            messages: vec![ChatMessage {
                role: "system".into(),
                content: SYSTEM_PROMPT.into(),
            }],
        }
    }

    pub fn workspace(&self) -> &Path {
        &self.workspace
    }

    pub async fn run_turn(&mut self, input: &str) -> Result<String, AgentError> {
        self.messages.push(ChatMessage {
            role: "user".into(),
            content: input.to_owned(),
        });

        // Bound tool loops so a malformed model response cannot run indefinitely.
        for _ in 0..8 {
            let raw = self.provider.complete(&self.messages).await?;
            self.messages.push(ChatMessage {
                role: "assistant".into(),
                content: raw.clone(),
            });

            let turn = match serde_json::from_str::<ModelTurn>(&raw) {
                Ok(turn) => turn,
                Err(_) => {
                    warn!("model response was not valid action JSON; returning it as text");
                    return Ok(raw);
                }
            };

            match turn {
                ModelTurn::Final { content } => return Ok(content),
                ModelTurn::ToolCall { tool, arguments } => {
                    let action = ToolAction { name: tool, arguments };
                    match policy::evaluate(&action) {
                        PolicyDecision::Deny => {
                            warn!(tool = %action.name, "tool call denied by policy");
                            self.push_tool_result(false, "Denied by local policy");
                        }
                        PolicyDecision::RequireApproval => {
                            if self.request_approval(&action)? {
                                self.execute_and_record(&action);
                            } else {
                                self.push_tool_result(false, "User declined the operation");
                            }
                        }
                        PolicyDecision::Allow => self.execute_and_record(&action),
                    }
                }
            }
        }

        Ok("Stopped after reaching the per-turn tool-call limit (8).".into())
    }

    fn execute_and_record(&mut self, action: &ToolAction) {
        match self.executor.execute(action) {
            Ok(result) => {
                info!(tool = %action.name, ok = result.ok, "tool execution completed");
                self.push_tool_result(result.ok, &result.output);
            }
            Err(error) => {
                warn!(tool = %action.name, error = %error, "tool execution failed");
                self.push_tool_result(false, &error.to_string());
            }
        }
    }

    fn push_tool_result(&mut self, ok: bool, output: &str) {
        self.messages.push(ChatMessage {
            role: "user".into(),
            content: format!(
                "Tool result (ok={ok}):\n{}",
                serde_json::to_string(&json!({"ok": ok, "output": output}))
                    .unwrap_or_else(|_| output.to_owned())
            ),
        });
    }

    fn request_approval(&self, action: &ToolAction) -> Result<bool, AgentError> {
        let path = action.arguments.get("path").and_then(|value| value.as_str()).unwrap_or("<invalid path>");
        print!("Approve write_file to '{path}'? Type 'yes' to continue: ");
        io::stdout().flush()?;

        let mut answer = String::new();
        io::stdin().read_line(&mut answer)?;
        Ok(answer.trim().eq_ignore_ascii_case("yes"))
    }
}
