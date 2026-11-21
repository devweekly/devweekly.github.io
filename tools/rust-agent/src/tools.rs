use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde_json::Value;

use crate::{
    action::{ToolAction, ToolResult},
    error::AgentError,
    policy::{self, PolicyDecision},
};

const DEFAULT_SEARCH_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 1_000;
const MAX_READ_FILE_BYTES: u64 = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 2_000;
const MAX_SEARCH_FILES: usize = 10_000;
const MAX_SEARCH_FILE_BYTES: u64 = 1024 * 1024;
const MAX_MATCH_LINE_BYTES: usize = 4 * 1024;
const MAX_TOOL_OUTPUT_BYTES: usize = 256 * 1024;

#[derive(Clone)]
pub struct ToolExecutor {
    workspace: PathBuf,
}

impl ToolExecutor {
    pub fn new(workspace: PathBuf) -> Self {
        Self { workspace }
    }

    /// Execute only operations allowed without an interactive approval.
    pub fn execute(&self, action: &ToolAction) -> Result<ToolResult, AgentError> {
        match policy::evaluate(action) {
            PolicyDecision::Allow => self.execute_action(action),
            PolicyDecision::RequireApproval => Err(AgentError::InvalidAction(
                "write_file requires the AgentRuntime approval path".into(),
            )),
            PolicyDecision::Deny => Err(AgentError::InvalidAction(
                "tool is denied by the local policy".into(),
            )),
        }
    }

    pub(crate) fn execute_approved(&self, action: &ToolAction) -> Result<ToolResult, AgentError> {
        if !matches!(policy::evaluate(action), PolicyDecision::RequireApproval) {
            return Err(AgentError::InvalidAction(
                "approved execution is only available for tools requiring approval".into(),
            ));
        }
        self.execute_action(action)
    }

    fn execute_action(&self, action: &ToolAction) -> Result<ToolResult, AgentError> {
        match action.name.as_str() {
            "read_file" => self.read_file(required_string(&action.arguments, "path")?),
            "read_attachment" => self.read_attachment(required_string(&action.arguments, "id")?),
            "list_dir" => self.list_dir(required_string(&action.arguments, "path")?),
            "write_file" => self.write_file(
                required_string(&action.arguments, "path")?,
                required_string(&action.arguments, "content")?,
            ),
            "search_files" => self.search_files(action),
            other => Err(AgentError::InvalidAction(format!("tool is not registered: {other}"))),
        }
    }

    fn read_attachment(&self, id: &str) -> Result<ToolResult, AgentError> {
        if id.is_empty() || id.len() > 64 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
            return Err(AgentError::InvalidAction("invalid attachment ID".into()));
        }
        let directory = self.workspace.join(".rust-agent").join("attachments");
        let dir_meta = fs::symlink_metadata(&directory)?;
        if dir_meta.file_type().is_symlink() || !dir_meta.is_dir() {
            return Err(AgentError::InvalidAction("attachment storage must be a real directory".into()));
        }
        let directory = directory.canonicalize()?;
        if !directory.starts_with(&self.workspace) {
            return Err(AgentError::InvalidAction("attachment storage resolves outside the workspace".into()));
        }
        let path = directory.join(format!("{id}.bin"));
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 256 * 1024 {
            return Err(AgentError::InvalidAction("attachment is invalid or exceeds the 256 KiB text inspection limit".into()));
        }
        let content = fs::read_to_string(path).map_err(|error| AgentError::InvalidAction(format!("attachment is not UTF-8 text: {error}")))?;
        Ok(ToolResult { ok: true, output: content })
    }

    fn read_file(&self, relative: &str) -> Result<ToolResult, AgentError> {
        let path = self.resolve_existing(relative)?;
        if !path.is_file() {
            return Err(AgentError::InvalidAction("read_file target is not a regular file".into()));
        }
        let file = fs::File::open(path)?;
        let mut content = String::new();
        file.take(MAX_READ_FILE_BYTES + 1).read_to_string(&mut content)?;
        if content.len() as u64 > MAX_READ_FILE_BYTES {
            return Err(AgentError::InvalidAction(format!(
                "read_file is limited to {MAX_READ_FILE_BYTES} bytes"
            )));
        }
        Ok(ToolResult { ok: true, output: content })
    }

    fn list_dir(&self, relative: &str) -> Result<ToolResult, AgentError> {
        let path = self.resolve_existing(relative)?;
        if !path.is_dir() {
            return Err(AgentError::InvalidAction("list_dir target is not a directory".into()));
        }

        let mut entries = Vec::new();
        let mut output_bytes = 0usize;
        let mut truncated = false;
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let kind = if entry.file_type()?.is_dir() { "dir" } else { "file" };
            let line = format!("{kind}\t{}", entry.file_name().to_string_lossy());
            if entries.len() >= MAX_DIRECTORY_ENTRIES
                || output_bytes.saturating_add(line.len()).saturating_add(1) > MAX_TOOL_OUTPUT_BYTES
            {
                truncated = true;
                break;
            }
            output_bytes = output_bytes.saturating_add(line.len()).saturating_add(1);
            entries.push(line);
        }
        entries.sort();
        let mut output = entries.join("\n");
        if truncated {
            output.push_str("\n[truncated: directory listing limit reached]");
        }
        Ok(ToolResult { ok: true, output })
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

    /// Search files using native Rust code; no external grep/rg process is spawned.
    fn search_files(&self, action: &ToolAction) -> Result<ToolResult, AgentError> {
        let relative = required_string(&action.arguments, "path")?;
        let query = required_string(&action.arguments, "query")?;
        if query.is_empty() {
            return Err(AgentError::InvalidAction("search_files query must not be empty".into()));
        }

        let regex_mode = optional_bool(&action.arguments, "regex", false)?;
        let case_sensitive = optional_bool(&action.arguments, "case_sensitive", true)?;
        let max_results = optional_usize(&action.arguments, "max_results", DEFAULT_SEARCH_LIMIT)?
            .clamp(1, MAX_SEARCH_LIMIT);
        let glob = optional_string(&action.arguments, "glob")?;

        let matcher = if regex_mode {
            RegexBuilder::new(query)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|error| AgentError::InvalidAction(format!("invalid search regex: {error}")))?
        } else {
            RegexBuilder::new(&regex::escape(query))
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|error| AgentError::InvalidAction(format!("invalid search query: {error}")))?
        };

        let search_root = self.resolve_existing(relative)?;
        let files = self.collect_search_files(&search_root, glob)?;
        let mut matches = Vec::new();
        for path in &files {
            if matches.len() >= max_results { break; }
            let remaining = max_results.saturating_sub(matches.len());
            matches.extend(search_one_file(path, &self.workspace, &matcher, remaining));
        }
        matches.sort_by(|left, right| {
            left.path.cmp(&right.path).then(left.line_number.cmp(&right.line_number))
        });

        let mut output = if matches.is_empty() {
            "No matches found.".to_string()
        } else {
            matches
                .into_iter()
                .map(|item| format!("{}:{}: {}", item.path, item.line_number, item.line))
                .collect::<Vec<_>>()
                .join("\n")
        };
        if output.len() > MAX_TOOL_OUTPUT_BYTES {
            let mut end = MAX_TOOL_OUTPUT_BYTES;
            while !output.is_char_boundary(end) { end -= 1; }
            output.truncate(end);
            output.push_str("\n[truncated: search output limit reached]");
        }
        Ok(ToolResult { ok: true, output })
    }

    fn collect_search_files(&self, root: &Path, glob: Option<&str>) -> Result<Vec<PathBuf>, AgentError> {
        if root.is_file() {
            return Ok(vec![root.to_path_buf()]);
        }
        if !root.is_dir() {
            return Err(AgentError::InvalidAction("search_files path must be a file or directory".into()));
        }

        let mut builder = WalkBuilder::new(root);
        builder
            .hidden(true)
            .git_ignore(true)
            .git_exclude(true)
            .ignore(true)
            .parents(true)
            .follow_links(false);

        if let Some(pattern) = glob {
            builder.add_custom_ignore_filename(".agentignore");
            builder
                .overrides( ignore::overrides::OverrideBuilder::new(root)
                    .add(pattern)
                    .map_err(|error| AgentError::InvalidAction(format!("invalid file glob: {error}")))?
                    .build()
                    .map_err(|error| AgentError::InvalidAction(format!("invalid file glob: {error}")))? );
        }

        let mut files = Vec::new();
        for entry in builder.build() {
            let entry = entry.map_err(|error| AgentError::InvalidAction(format!("directory traversal failed: {error}")))?;
            if entry.file_type().is_some_and(|kind| kind.is_file()) {
                let path = entry.into_path();
                if path.starts_with(&self.workspace) {
                    files.push(path);
                    if files.len() >= MAX_SEARCH_FILES {
                        break;
                    }
                }
            }
        }
        files.sort();
        Ok(files)
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

struct SearchMatch {
    path: String,
    line_number: usize,
    line: String,
}

fn search_one_file(path: &Path, workspace: &Path, matcher: &Regex, limit: usize) -> Vec<SearchMatch> {
    let Ok(metadata) = fs::metadata(path) else { return Vec::new(); };
    if metadata.len() > MAX_SEARCH_FILE_BYTES || limit == 0 {
        return Vec::new();
    }
    let Ok(file) = fs::File::open(path) else { return Vec::new(); };
    let mut content = String::new();
    if file.take(MAX_SEARCH_FILE_BYTES).read_to_string(&mut content).is_err() {
        // Binary, invalid UTF-8, and unreadable files are intentionally skipped.
        return Vec::new();
    }
    let relative = path.strip_prefix(workspace).unwrap_or(path).to_string_lossy().into_owned();
    let mut matches = Vec::new();
    for (index, line) in content.lines().enumerate() {
        if matcher.is_match(line) {
            let mut clipped = line.to_owned();
            if clipped.len() > MAX_MATCH_LINE_BYTES {
                let mut end = MAX_MATCH_LINE_BYTES;
                while !clipped.is_char_boundary(end) { end -= 1; }
                clipped.truncate(end);
                clipped.push_str("…[line truncated]");
            }
            matches.push(SearchMatch {
                path: relative.clone(),
                line_number: index + 1,
                line: clipped,
            });
            if matches.len() >= limit { break; }
        }
    }
    matches
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

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AgentError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| AgentError::InvalidAction(format!("missing string argument: {key}")))
}

fn optional_string<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, AgentError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        _ => Err(AgentError::InvalidAction(format!("{key} must be a string"))),
    }
}

fn optional_bool(value: &Value, key: &str, default: bool) -> Result<bool, AgentError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        _ => Err(AgentError::InvalidAction(format!("{key} must be a boolean"))),
    }
}

fn optional_usize(value: &Value, key: &str, default: usize) -> Result<usize, AgentError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|number| usize::try_from(number).ok())
            .ok_or_else(|| AgentError::InvalidAction(format!("{key} must be a non-negative integer"))),
        _ => Err(AgentError::InvalidAction(format!("{key} must be an integer"))),
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_relative_path, ToolExecutor};
    use crate::action::ToolAction;
    use serde_json::json;
    use std::{fs, path::PathBuf, sync::atomic::{AtomicU64, Ordering}};

    fn workspace() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let path = std::env::temp_dir().join(format!(
            "rust-agent-tools-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

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

    #[test]
    fn low_level_tool_executor_cannot_bypass_write_approval() {
        let root = workspace();
        let executor = ToolExecutor::new(root.clone());
        let action = ToolAction {
            name: "write_file".into(),
            arguments: json!({"path":"must-not-exist.txt","content":"blocked"}),
        };
        assert!(executor.execute(&action).is_err());
        assert!(!root.join("must-not-exist.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_file_enforces_a_hard_byte_limit() {
        let root = workspace();
        let content = vec![b'a'; 1024 * 1024 + 1];
        fs::write(root.join("large.txt"), content).unwrap();
        let executor = ToolExecutor::new(root.clone());
        let action = ToolAction {
            name: "read_file".into(),
            arguments: json!({"path":"large.txt"}),
        };
        assert!(executor.execute(&action).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
