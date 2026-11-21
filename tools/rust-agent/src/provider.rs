use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AgentError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct OpenAiCompatibleProvider {
    client: Client,
    endpoint: String,
    model: String,
    api_key: String,
}

impl OpenAiCompatibleProvider {
    pub fn new(
        base_url: String,
        model: String,
        api_key: String,
    ) -> Result<Self, AgentError> {
        let base_url = base_url.trim_end_matches('/');
        if base_url.is_empty() || model.trim().is_empty() || api_key.is_empty() {
            return Err(AgentError::InvalidProviderConfig(
                "base URL, model, and API key must be non-empty".into(),
            ));
        }

        let endpoint = format!("{base_url}/chat/completions");
        let client = Client::builder()
            .user_agent(concat!("rust-agent/", env!("CARGO_PKG_VERSION")))
            .build()?;

        Ok(Self {
            client,
            endpoint,
            model,
            api_key,
        })
    }

    pub async fn complete(&self, messages: &[ChatMessage]) -> Result<String, AgentError> {
        let body = ChatCompletionRequest {
            model: &self.model,
            messages,
            stream: false,
        };

        let response: Value = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        response["choices"][0]["message"]["content"]
            .as_str()
            .map(ToOwned::to_owned)
            .ok_or(AgentError::InvalidProviderResponse)
    }
}

#[derive(Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}
