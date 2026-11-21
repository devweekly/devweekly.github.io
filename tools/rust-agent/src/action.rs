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
    AskUser {
        questions: Vec<UserQuestion>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserQuestion {
    pub question: String,
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub options: Vec<UserQuestionOption>,
    #[serde(default, rename = "multi_select")]
    pub multi_select: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserQuestionOption {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
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


#[cfg(test)]
mod tests {
    use super::ModelTurn;

    #[test]
    fn parses_structured_user_questions() {
        let turn: ModelTurn = serde_json::from_str(r#"{
            "type":"ask_user",
            "questions":[{
                "question":"Which database?",
                "header":"Database",
                "options":[
                    {"label":"PostgreSQL","description":"Relational"},
                    {"label":"SQLite","description":"Embedded"}
                ],
                "multi_select":false
            }]
        }"#).expect("valid question payload");
        match turn {
            ModelTurn::AskUser { questions } => {
                assert_eq!(questions.len(), 1);
                assert_eq!(questions[0].options[0].label, "PostgreSQL");
                assert!(!questions[0].multi_select);
            }
            _ => panic!("expected ask_user"),
        }
    }
}
