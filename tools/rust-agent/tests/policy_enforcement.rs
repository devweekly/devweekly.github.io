use rust_agent::{
    action::ToolAction,
    policy::{evaluate, PolicyDecision},
};
use serde_json::json;

#[test]
fn policy_defaults_to_deny_for_unregistered_tools() {
    let action = ToolAction {
        name: "run_shell".into(),
        arguments: json!({"command": "rm -rf /"}),
    };
    assert_eq!(evaluate(&action), PolicyDecision::Deny);
}

#[test]
fn file_writes_are_never_implicitly_allowed() {
    let action = ToolAction {
        name: "write_file".into(),
        arguments: json!({"path": "notes.txt", "content": "data"}),
    };
    assert_eq!(evaluate(&action), PolicyDecision::RequireApproval);
}
