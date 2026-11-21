use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ModelTurn {
    Final {
        content: String,
    },
    ToolCall {
        tool: String,
        #[serde(default = "empty_object")]
        arguments: Value,
    },
}

fn empty_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, Clone)]
pub struct ToolAction {
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub ok: bool,
    pub output: String,
}
