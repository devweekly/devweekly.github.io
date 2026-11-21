use crate::action::ToolAction;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    RequireApproval,
    Deny,
}

/// Deterministic allow-list policy. Model-supplied risk labels are never trusted.
pub fn evaluate(action: &ToolAction) -> PolicyDecision {
    match action.name.as_str() {
        "read_file" | "list_dir" => PolicyDecision::Allow,
        "write_file" => PolicyDecision::RequireApproval,
        _ => PolicyDecision::Deny,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{evaluate, PolicyDecision};
    use crate::action::ToolAction;

    #[test]
    fn reads_are_allowed_and_writes_require_approval() {
        let read = ToolAction {
            name: "read_file".into(),
            arguments: json!({"path": "README.md"}),
        };
        let write = ToolAction {
            name: "write_file".into(),
            arguments: json!({"path": "notes.txt", "content": "hello"}),
        };

        assert_eq!(evaluate(&read), PolicyDecision::Allow);
        assert_eq!(evaluate(&write), PolicyDecision::RequireApproval);
    }

    #[test]
    fn unknown_tools_are_denied() {
        let action = ToolAction {
            name: "shell".into(),
            arguments: json!({"command": "whoami"}),
        };
        assert_eq!(evaluate(&action), PolicyDecision::Deny);
    }
}
