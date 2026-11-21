use std::{
    env,
    io::{self, BufRead, Write},
    path::PathBuf,
};

use rust_agent::{
    action::ToolAction,
    policy::{self, PolicyDecision},
    tools::ToolExecutor,
};
use serde_json::{json, Value};

const SERVER_NAME: &str = "rust-agent";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let workspace = parse_workspace()?;
    let approval_token = env::var("RUST_AGENT_APPROVAL_TOKEN").unwrap_or_default();
    let executor = ToolExecutor::new(workspace);

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => handle_request(&request, &executor, &approval_token),
            Err(error) => Some(json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": format!("Parse error: {error}") }
            })),
        };

        if let Some(response) = response {
            serde_json::to_writer(&mut stdout, &response)?;
            stdout.write_all(b"\n")?;
            stdout.flush()?;
        }
    }
    Ok(())
}

fn parse_workspace() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let mut workspace = PathBuf::from(".");
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--workspace" => {
                workspace = PathBuf::from(args.next().ok_or("--workspace requires a path")?);
            }
            "--help" | "-h" => {
                println!("rust-agent-mcp [--workspace PATH]");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}").into()),
        }
    }

    let workspace = workspace.canonicalize()?;
    if !workspace.is_dir() {
        return Err(format!("workspace is not a directory: {}", workspace.display()).into());
    }
    Ok(workspace)
}

fn handle_request(
    request: &Value,
    executor: &ToolExecutor,
    approval_token: &str,
) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(Value::as_str).unwrap_or_default();

    if id.is_none() {
        return None;
    }
    let id = id.unwrap_or(Value::Null);

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => call_tool(request.get("params").unwrap_or(&Value::Null), executor, approval_token),
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("Method not found: {method}") }
            }));
        }
    };

    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32000, "message": error }
        }),
    })
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "read_file",
            "description": "Read a UTF-8 file inside the configured workspace.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Workspace-relative file path" } },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "list_dir",
            "description": "List entries in a directory inside the configured workspace.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Workspace-relative directory path" } },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "search_files",
            "description": "Search workspace files natively, respecting ignore rules. Supports literal or regex matching.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "query": { "type": "string" },
                    "regex": { "type": "boolean", "default": false },
                    "case_sensitive": { "type": "boolean", "default": true },
                    "glob": { "type": "string" },
                    "max_results": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 200 }
                },
                "required": ["path", "query"],
                "additionalProperties": false
            }
        },
        {
            "name": "write_file",
            "description": "Write a UTF-8 file inside the workspace. Requires explicit CodeBuddy user approval for each call.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }
        }
    ])
}

fn call_tool(
    params: &Value,
    executor: &ToolExecutor,
    approval_token: &str,
) -> Result<Value, String> {
    let name = params.get("name").and_then(Value::as_str)
        .ok_or_else(|| "tools/call requires a tool name".to_string())?;
    let mut arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    if !arguments.is_object() {
        return Err("tool arguments must be a JSON object".into());
    }

    let supplied_token = arguments.as_object_mut()
        .and_then(|object| object.remove("_approval_token"))
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default();

    let action = ToolAction { name: name.to_owned(), arguments };
    match policy::evaluate(&action) {
        PolicyDecision::Allow => {}
        PolicyDecision::RequireApproval => {
            if approval_token.is_empty() || supplied_token != approval_token {
                return Err("write_file requires a per-action approval from the CodeBuddy host".into());
            }
        }
        PolicyDecision::Deny => return Err(format!("policy denied tool: {name}")),
    }

    let result = executor.execute(&action).map_err(|error| error.to_string())?;
    Ok(json!({
        "content": [{ "type": "text", "text": result.output }],
        "isError": !result.ok
    }))
}


#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{call_tool, handle_request, tool_definitions};
    use rust_agent::tools::ToolExecutor;

    #[test]
    fn advertises_only_the_four_workspace_tools() {
        let tools = tool_definitions();
        assert_eq!(tools.as_array().map(Vec::len), Some(4));
    }

    #[test]
    fn initialize_returns_mcp_server_metadata() {
        let executor = ToolExecutor::new(std::env::current_dir().expect("current directory"));
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2024-11-05" }
        });

        let response = handle_request(&request, &executor, "").expect("request response");
        assert_eq!(response["result"]["serverInfo"]["name"], "rust-agent");
        assert_eq!(response["result"]["capabilities"]["tools"]["listChanged"], false);
    }

    #[test]
    fn write_is_rejected_without_a_host_approval_token() {
        let executor = ToolExecutor::new(std::env::current_dir().expect("current directory"));
        let params = json!({
            "name": "write_file",
            "arguments": { "path": "must-not-be-created.txt", "content": "blocked" }
        });

        let result = call_tool(&params, &executor, "");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("per-action approval"));
    }

    #[test]
    fn unknown_tools_are_rejected_by_the_rust_policy() {
        let executor = ToolExecutor::new(std::env::current_dir().expect("current directory"));
        let params = json!({
            "name": "run_shell",
            "arguments": { "command": "whoami" }
        });

        let result = call_tool(&params, &executor, "not-used");
        assert!(result.unwrap_err().contains("policy denied"));
    }
}
