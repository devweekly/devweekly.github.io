use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::warn;

use crate::error::AgentError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct OpenAiCompatibleProvider {
    client: Client,
    endpoint: String,
    models_endpoint: String,
    model: String,
    fallback_model: Option<String>,
    api_key: String,
}

impl OpenAiCompatibleProvider {
    pub fn new(
        base_url: String,
        model: String,
        api_key: String,
    ) -> Result<Self, AgentError> {
        Self::new_with_fallback(base_url, model, None, api_key)
    }

    pub fn new_with_fallback(
        base_url: String,
        model: String,
        fallback_model: Option<String>,
        api_key: String,
    ) -> Result<Self, AgentError> {
        let base_url = base_url.trim_end_matches('/');
        if base_url.is_empty() || model.trim().is_empty() || api_key.is_empty() {
            return Err(AgentError::InvalidProviderConfig(
                "base URL, model, and API key must be non-empty".into(),
            ));
        }
        if fallback_model.as_deref().is_some_and(|name| name.trim().is_empty()) {
            return Err(AgentError::InvalidProviderConfig(
                "fallback model must be non-empty when specified".into(),
            ));
        }

        let endpoint = format!("{base_url}/chat/completions");
        let models_endpoint = format!("{base_url}/models");
        let client = Client::builder()
            .user_agent(concat!("rust-agent/", env!("CARGO_PKG_VERSION")))
            .build()?;

        Ok(Self {
            client,
            endpoint,
            models_endpoint,
            model,
            fallback_model,
            api_key,
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn set_model(&mut self, model: String) -> Result<(), AgentError> {
        if model.trim().is_empty() {
            return Err(AgentError::InvalidProviderConfig("model must be non-empty".into()));
        }
        self.model = model;
        Ok(())
    }

    pub async fn list_models(&self) -> Result<Vec<String>, AgentError> {
        let response: Value = self.client
            .get(&self.models_endpoint)
            .bearer_auth(&self.api_key)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(parse_model_ids(&response))
    }

    pub async fn complete(&self, messages: &[ChatMessage]) -> Result<String, AgentError> {
        match self.complete_with_model(&self.model, messages).await {
            Ok(content) => Ok(content),
            Err(primary_error) => {
                let Some(fallback_model) = self.fallback_model.as_deref() else {
                    return Err(primary_error);
                };
                if !is_retryable(&primary_error) {
                    return Err(primary_error);
                }
                warn!(
                    primary_model = %self.model,
                    fallback_model,
                    "primary model failed transiently; trying fallback model"
                );
                self.complete_with_model(fallback_model, messages).await
            }
        }
    }

    async fn complete_with_model(
        &self,
        model: &str,
        messages: &[ChatMessage],
    ) -> Result<String, AgentError> {
        let body = ChatCompletionRequest {
            model,
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

fn parse_model_ids(response: &Value) -> Vec<String> {
    let mut models = response["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    models
}

fn is_retryable(error: &AgentError) -> bool {
    match error {
        AgentError::Http(error) => {
            error.is_timeout()
                || error.is_connect()
                || error.status().is_some_and(|status| {
                    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
                })
        }
        _ => false,
    }
}

#[derive(Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}


#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::parse_model_ids;

    #[test]
    fn model_listing_extracts_sorts_and_deduplicates_ids() {
        let models = parse_model_ids(&json!({
            "data": [
                {"id": "z-model"},
                {"id": "a-model"},
                {"id": "z-model"},
                {"name": "missing-id"}
            ]
        }));
        assert_eq!(models, vec!["a-model", "z-model"]);
    }

    #[test]
    fn model_listing_handles_missing_data() {
        assert!(parse_model_ids(&json!({})).is_empty());
    }
}
