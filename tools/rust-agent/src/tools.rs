use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde_json::Value;

use crate::{
    action::{ToolAction, ToolResult},
    error::AgentError,
};

pub struct ToolExecutor {
    workspace: PathBuf,
}

impl ToolExecutor {
    pub fn new(workspace: PathBuf) -> Self {
        Self { workspace }
    }

    pub fn execute(&self, action: &ToolAction) -> Result<ToolResult, AgentError> {
        match action.name.as_str() {
            "read_file" => self.read_file(&required_string(&action.arguments, "path")?),
            "list_dir" => self.list_dir(&required_string(&action.arguments, "path")?),
            "write_file" => self.write_file(
                &required_string(&action.arguments, "path")?,
                &required_string(&action.arguments, "content")?,
            ),
            other => Err(AgentError::InvalidAction(format!("tool is not registered: {other}"))),
        }
    }

    fn read_file(&self, relative: &str) -> Result<ToolResult, AgentError> {
        let path = self.resolve_existing(relative)?;
        if !path.is_file() {
            return Err(AgentError::InvalidAction("read_file target is not a regular file".into()));
        }
        let content = fs::read_to_string(path)?;
        Ok(ToolResult { ok: true, output: content })
    }

    fn list_dir(&self, relative: &str) -> Result<ToolResult, AgentError> {
        let path = self.resolve_existing(relative)?;
        if !path.is_dir() {
            return Err(AgentError::InvalidAction("list_dir target is not a directory".into()));
        }

        let mut entries = fs::read_dir(path)?
            .map(|entry| {
                let entry = entry?;
                let kind = if entry.file_type()?.is_dir() { "dir" } else { "file" };
                Ok(format!("{kind}\t{}", entry.file_name().to_string_lossy()))
            })
            .collect::<Result<Vec<_>, std::io::Error>>()?;
        entries.sort();

        Ok(ToolResult { ok: true, output: entries.join("\n") })
    }

    fn write_file(&self, relative: &str, content: &str) -> Result<ToolResult, AgentError> {
        let relative_path = validate_relative_path(relative)?;
        let file_name = relative_path
            .file_name()
            .ok_or_else(|| AgentError::InvalidAction("write_file requires a file path".into()))?;
        let parent = relative_path.parent().unwrap_or_else(|| Path::new(""));
        let parent_path = self.workspace.join(parent).canonicalize()?;
        self.ensure_inside_workspace(&parent_path)?;

        let target = parent_path.join(file_name);
        if let Ok(metadata) = fs::symlink_metadata(&target) {
            if metadata.file_type().is_symlink() {
                return Err(AgentError::InvalidAction(
                    "refusing to write through a symbolic link".into(),
                ));
            }
            if !metadata.is_file() {
                return Err(AgentError::InvalidAction(
                    "write_file target exists and is not a regular file".into(),
                ));
            }
        }

        fs::write(&target, content)?;
        Ok(ToolResult {
            ok: true,
            output: format!("Wrote {} bytes to {}", content.len(), target.strip_prefix(&self.workspace).unwrap_or(&target).display()),
        })
    }

    fn resolve_existing(&self, relative: &str) -> Result<PathBuf, AgentError> {
        let relative_path = validate_relative_path(relative)?;
        let resolved = self.workspace.join(relative_path).canonicalize()?;
        self.ensure_inside_workspace(&resolved)?;
        Ok(resolved)
    }

    fn ensure_inside_workspace(&self, path: &Path) -> Result<(), AgentError> {
        if !path.starts_with(&self.workspace) {
            return Err(AgentError::InvalidAction(
                "path resolves outside the configured workspace".into(),
            ));
        }
        Ok(())
    }
}

fn validate_relative_path(input: &str) -> Result<&Path, AgentError> {
    let path = Path::new(input);
    if input.is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        })
    {
        return Err(AgentError::InvalidAction(
            "path must be a non-empty relative path without parent traversal".into(),
        ));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::validate_relative_path;

    #[test]
    fn rejects_parent_traversal_and_absolute_paths() {
        assert!(validate_relative_path("../outside.txt").is_err());
        assert!(validate_relative_path("/etc/passwd").is_err());
        assert!(validate_relative_path("").is_err());
    }

    #[test]
    fn accepts_workspace_relative_paths() {
        assert!(validate_relative_path("docs/architecture.md").is_ok());
        assert!(validate_relative_path("./README.md").is_ok());
    }
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AgentError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| AgentError::InvalidAction(format!("missing string argument: {key}")))
}
