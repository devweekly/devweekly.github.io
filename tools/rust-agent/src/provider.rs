use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::warn;
use std::time::Instant;

use crate::error::AgentError;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompletionUsage {
    #[serde(default)] pub prompt_tokens: Option<u64>,
    #[serde(default)] pub completion_tokens: Option<u64>,
    #[serde(default)] pub total_tokens: Option<u64>,
}
#[derive(Debug, Clone)]
pub struct CompletionResult {
    pub content: String,
    pub model: String,
    pub usage: CompletionUsage,
    pub duration_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    client: Client,
    endpoint: String,
    models_endpoint: String,
    model: String,
    fallback_model: Option<String>,
    api_key: String,
}

impl OpenAiCompatibleProvider {
    pub fn new(base_url: String, model: String, api_key: String) -> Result<Self, AgentError> {
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
        self.complete_with_usage(messages).await.map(|result| result.content)
    }

    pub async fn complete_with_usage(&self, messages: &[ChatMessage]) -> Result<CompletionResult, AgentError> {
        let started = Instant::now();
        let (model, (content, usage)) = match self.complete_with_model(&self.model, messages).await {
            Ok(result) => (self.model.clone(), result),
            Err(error) => {
                let Some(fallback) = self.fallback_model.as_deref() else { return Err(error); };
                if !is_retryable(&error) { return Err(error); }
                warn!(primary_model = %self.model, fallback_model = fallback, "primary model failed transiently; trying fallback model");
                (fallback.to_owned(), self.complete_with_model(fallback, messages).await?)
            }
        };
        Ok(CompletionResult { content, model, usage, duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64 })
    }

    /// Streams content deltas from an OpenAI-compatible SSE Chat Completions endpoint.
    /// The callback receives fragments of the model's structured response, not user-facing text.
    /// Fallback is attempted only if the primary model fails before emitting any content.
    pub async fn complete_streaming<F>(&self, messages: &[ChatMessage], on_delta: F) -> Result<String, AgentError>
    where F: FnMut(&str) {
        self.complete_streaming_with_usage(messages, on_delta).await.map(|result| result.content)
    }

    pub async fn complete_streaming_with_usage<F>(&self, messages: &[ChatMessage], mut on_delta: F) -> Result<CompletionResult, AgentError>
    where F: FnMut(&str) {
        let started = Instant::now();
        let (model, (content, usage)) = match self.complete_streaming_with_model(&self.model, messages, &mut on_delta).await {
            Ok(result) => (self.model.clone(), result),
            Err((error, false)) => {
                let Some(fallback) = self.fallback_model.as_deref() else { return Err(error); };
                if !is_retryable(&error) { return Err(error); }
                warn!(primary_model = %self.model, fallback_model = fallback, "primary streaming model failed before output; trying fallback model");
                (fallback.to_owned(), self.complete_streaming_with_model(fallback, messages, &mut on_delta).await.map_err(|(e, _)| e)?)
            }
            Err((error, true)) => return Err(error),
        };
        Ok(CompletionResult { content, model, usage, duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64 })
    }

    async fn complete_streaming_with_model<F>(
        &self,
        model: &str,
        messages: &[ChatMessage],
        on_delta: &mut F,
    ) -> Result<(String, CompletionUsage), (AgentError, bool)>
    where
        F: FnMut(&str),
    {
        let body = ChatCompletionRequest { model, messages, stream: true, stream_options: Some(StreamOptions { include_usage: true }) };
        let response = self.client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| (AgentError::Http(error), false))?
            .error_for_status()
            .map_err(|error| (AgentError::Http(error), false))?;

        let mut response = response;
        let mut pending = Vec::<u8>::new();
        let mut content = String::new();
        let mut emitted = false;
        let mut usage = CompletionUsage::default();

        loop {
            let chunk = response.chunk().await
                .map_err(|error| (AgentError::Http(error), emitted))?;
            let Some(chunk) = chunk else { break };
            pending.extend_from_slice(&chunk);

            while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                let mut line = pending.drain(..=newline).collect::<Vec<_>>();
                line.pop();
                if line.last() == Some(&b'\r') { line.pop(); }
                if let Some(event_usage) = extract_sse_usage(&line) { usage = event_usage; }
                if let Some(delta) = extract_sse_delta(&line) {
                    if !delta.is_empty() {
                        emitted = true;
                        content.push_str(&delta);
                        on_delta(&delta);
                    }
                }
            }
        }

        if !pending.is_empty() {
            if let Some(event_usage) = extract_sse_usage(&pending) { usage = event_usage; }
            if let Some(delta) = extract_sse_delta(&pending) {
                if !delta.is_empty() {
                    emitted = true;
                    content.push_str(&delta);
                    on_delta(&delta);
                }
            }
        }

        if content.is_empty() {
            return Err((AgentError::InvalidProviderResponse, emitted));
        }
        Ok((content, usage))
    }

    async fn complete_with_model(
        &self,
        model: &str,
        messages: &[ChatMessage],
    ) -> Result<(String, CompletionUsage), AgentError> {
        let body = ChatCompletionRequest { model, messages, stream: false, stream_options: None };
        let response: Value = self.client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let content = response["choices"][0]["message"]["content"].as_str()
            .map(ToOwned::to_owned).ok_or(AgentError::InvalidProviderResponse)?;
        Ok((content, parse_usage(&response["usage"])))
    }
}

fn extract_sse_delta(line: &[u8]) -> Option<String> {
    let line = std::str::from_utf8(line).ok()?.trim();
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let event: Value = serde_json::from_str(data).ok()?;
    event["choices"][0]["delta"]["content"].as_str().map(ToOwned::to_owned)
}

fn parse_usage(value: &Value) -> CompletionUsage {
    let prompt_tokens = value["prompt_tokens"].as_u64();
    let completion_tokens = value["completion_tokens"].as_u64();
    let total_tokens = value["total_tokens"].as_u64().or_else(|| prompt_tokens.zip(completion_tokens).map(|(prompt, completion)| prompt.saturating_add(completion)));
    CompletionUsage { prompt_tokens, completion_tokens, total_tokens }
}

fn extract_sse_usage(line: &[u8]) -> Option<CompletionUsage> {
    let line = std::str::from_utf8(line).ok()?.trim();
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() || data == "[DONE]" { return None; }
    let event: Value = serde_json::from_str(data).ok()?;
    event.get("usage").filter(|v| v.is_object()).map(parse_usage)
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
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
}
#[derive(Serialize)]
struct StreamOptions { include_usage: bool }

#[cfg(test)]
mod tests {
    use serde_json::json;
    use super::{extract_sse_delta, parse_model_ids};

    #[test]
    fn usage_parser_reads_token_counts_and_tolerates_missing_fields() {
        let usage = super::parse_usage(&json!({
            "prompt_tokens": 21,
            "completion_tokens": 8,
            "total_tokens": 29
        }));
        assert_eq!(usage.prompt_tokens, Some(21));
        assert_eq!(usage.completion_tokens, Some(8));
        assert_eq!(usage.total_tokens, Some(29));
        assert_eq!(super::parse_usage(&json!({})), super::CompletionUsage::default());
    }

    #[test]
    fn streaming_usage_parser_reads_usage_only_sse_frames() {
        let line = br#"data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}"#;
        let usage = super::extract_sse_usage(line).expect("usage frame should parse");
        assert_eq!(usage.total_tokens, Some(7));
    }

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

    #[test]
    fn sse_parser_extracts_content_delta() {
        let line = br#"data: {"choices":[{"delta":{"content":"{\"type\":"}}]}"#;
        assert_eq!(extract_sse_delta(line).as_deref(), Some("{\"type\":"));
    }

    #[test]
    fn sse_parser_ignores_done_and_non_content_events() {
        assert!(extract_sse_delta(b"data: [DONE]").is_none());
        assert!(extract_sse_delta(br#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#).is_none());
    }
}
