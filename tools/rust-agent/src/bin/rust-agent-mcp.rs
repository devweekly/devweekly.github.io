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
            "capabilities": { "tools": { "listChanged": false }, "resources": { "listChanged": false }, "prompts": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "resources/list" => Ok(json!({ "resources": resource_definitions() })),
        "resources/read" => read_resource(request.get("params").unwrap_or(&Value::Null)),
        "prompts/list" => Ok(json!({ "prompts": prompt_definitions() })),
        "prompts/get" => get_prompt(request.get("params").unwrap_or(&Value::Null)),
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

fn resource_definitions() -> Value {
    json!([
        {
            "uri": "rust-agent://policy",
            "name": "Rust Agent security policy",
            "description": "The enforced tool allow-list and workspace boundary.",
            "mimeType": "text/plain"
        }
    ])
}

fn read_resource(params: &Value) -> Result<Value, String> {
    let uri = params.get("uri").and_then(Value::as_str)
        .ok_or_else(|| "resources/read requires a resource URI".to_string())?;
    if uri != "rust-agent://policy" {
        return Err(format!("resource not found: {uri}"));
    }
    Ok(json!({
        "contents": [{
            "uri": uri,
            "mimeType": "text/plain",
            "text": "Rust Agent policy: read_file, list_dir, and search_files are allowed within the configured workspace. write_file requires explicit host approval for each call. Unknown tools are denied. No shell, process execution, arbitrary network, or workspace-external file access is exposed. These application-level checks are not an OS sandbox."
        }]
    }))
}

fn prompt_definitions() -> Value {
    json!([
        {
            "name": "inspect_workspace",
            "description": "Inspect the workspace structure and identify the relevant implementation areas.",
            "arguments": [{ "name": "focus", "description": "Optional area to focus on", "required": false }]
        },
        {
            "name": "review_file",
            "description": "Review one workspace file for correctness, security, and maintainability.",
            "arguments": [{ "name": "path", "description": "Workspace-relative file path", "required": true }]
        },
        {
            "name": "implement_change",
            "description": "Plan and implement a bounded change using only the Rust workspace tools.",
            "arguments": [{ "name": "task", "description": "Change to implement", "required": true }]
        }
    ])
}

fn get_prompt(params: &Value) -> Result<Value, String> {
    let name = params.get("name").and_then(Value::as_str)
        .ok_or_else(|| "prompts/get requires a prompt name".to_string())?;
    let arguments = params.get("arguments").unwrap_or(&Value::Null);
    let prompt_text = match name {
        "inspect_workspace" => {
            let focus = arguments.get("focus").and_then(Value::as_str).unwrap_or("overall architecture");
            format!("Inspect the configured workspace with read-only tools. Focus on {focus}. First map the relevant directories and files, then summarize the current design, important dependencies, and concrete risks. Do not modify files.")
        }
        "review_file" => {
            let path = arguments.get("path").and_then(Value::as_str)
                .ok_or_else(|| "review_file requires the path argument".to_string())?;
            format!("Review the workspace file {path}. Read the file and directly relevant local context. Identify correctness, security, performance, and maintainability issues. Report findings with severity and exact locations. Do not modify files.")
        }
        "implement_change" => {
            let task = arguments.get("task").and_then(Value::as_str)
                .ok_or_else(|| "implement_change requires the task argument".to_string())?;
            format!("Implement this bounded task in the configured workspace: {task}\nFirst inspect the relevant code and explain the intended change briefly. Make the smallest coherent modification. Use only the Rust workspace tools. Every write requires explicit user approval. After editing, reread changed files and report validation limitations.")
        }
        _ => return Err(format!("prompt not found: {name}")),
    };
    Ok(json!({
        "description": format!("Built-in Rust Agent prompt: {name}"),
        "messages": [{ "role": "user", "content": { "type": "text", "text": prompt_text } }]
    }))
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
            "name": "read_attachment",
            "description": "Read a UTF-8 text attachment supplied by the embedding Host.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"],
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

    use super::{call_tool, get_prompt, handle_request, prompt_definitions, read_resource, resource_definitions, tool_definitions};
    use rust_agent::tools::ToolExecutor;

    #[test]
    fn advertises_workspace_tools_and_attachment_reader() {
        let tools = tool_definitions();
        assert_eq!(tools.as_array().map(Vec::len), Some(5));
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
        assert_eq!(response["result"]["capabilities"]["resources"]["listChanged"], false);
        assert_eq!(response["result"]["capabilities"]["prompts"]["listChanged"], false);
    }

    #[test]
    fn advertises_read_only_policy_resource_and_builtin_prompts() {
        assert_eq!(resource_definitions().as_array().map(Vec::len), Some(1));
        assert_eq!(prompt_definitions().as_array().map(Vec::len), Some(3));
        assert!(read_resource(&json!({ "uri": "rust-agent://policy" })).is_ok());
        assert!(get_prompt(&json!({
            "name": "review_file",
            "arguments": { "path": "src/main.rs" }
        })).is_ok());
    }

    #[test]
    fn rejects_unknown_resources_and_prompts() {
        assert!(read_resource(&json!({ "uri": "rust-agent://unknown" })).is_err());
        assert!(get_prompt(&json!({ "name": "unknown" })).is_err());
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
