use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("I/O operation failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON encoding or decoding failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("provider response did not contain choices[0].message.content")]
    InvalidProviderResponse,

    #[error("provider configuration is invalid: {0}")]
    InvalidProviderConfig(String),

    #[error("model returned an unsupported action: {0}")]
    InvalidAction(String),
}
