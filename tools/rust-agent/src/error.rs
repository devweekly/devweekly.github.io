use std::{error::Error, fmt};

#[derive(Debug)]
pub enum AgentError {
    Http(reqwest::Error),
    Io(std::io::Error),
    Json(serde_json::Error),
    InvalidProviderResponse,
    InvalidProviderConfig(String),
    InvalidAction(String),
}

impl fmt::Display for AgentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(error) => write!(formatter, "HTTP request failed: {error}"),
            Self::Io(error) => write!(formatter, "I/O operation failed: {error}"),
            Self::Json(error) => write!(formatter, "JSON encoding or decoding failed: {error}"),
            Self::InvalidProviderResponse => {
                formatter.write_str("provider response did not contain choices[0].message.content")
            }
            Self::InvalidProviderConfig(message) => {
                write!(formatter, "provider configuration is invalid: {message}")
            }
            Self::InvalidAction(message) => {
                write!(formatter, "model returned an unsupported action: {message}")
            }
        }
    }
}

impl Error for AgentError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Http(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::InvalidProviderResponse
            | Self::InvalidProviderConfig(_)
            | Self::InvalidAction(_) => None,
        }
    }
}

impl From<reqwest::Error> for AgentError {
    fn from(error: reqwest::Error) -> Self {
        Self::Http(error)
    }
}

impl From<std::io::Error> for AgentError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for AgentError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}
