use std::{fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}, time::{SystemTime, UNIX_EPOCH}};
use serde::{Deserialize, Serialize};
use crate::error::AgentError;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_ATTACHMENT_TOTAL_BYTES: u64 = 200 * 1024 * 1024;
pub const MAX_ATTACHMENT_COUNT: usize = 1_000;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachmentMetadata { pub id: String, pub filename: String, pub content_type: String, pub size_bytes: usize }
#[derive(Clone)]
pub struct AttachmentStore { directory: PathBuf }
impl AttachmentStore {
    pub const MAX_BYTES: u64 = MAX_ATTACHMENT_BYTES as u64;
    pub fn new(workspace: PathBuf) -> Result<Self, AgentError> {
        let state = workspace.join(".rust-agent"); ensure_real_directory(&state)?;
        let directory = state.join("attachments"); ensure_real_directory(&directory)?;
        let canonical = directory.canonicalize()?; let workspace = workspace.canonicalize()?;
        if !canonical.starts_with(&workspace) { return Err(AgentError::InvalidAction("attachment directory resolves outside the workspace".into())); }
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?; }
        Ok(Self { directory: canonical })
    }
    pub fn store(&self, filename: &str, content_type: &str, bytes: &[u8]) -> Result<AttachmentMetadata, AgentError> {
        if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES { return Err(AgentError::InvalidAction(format!("attachment size must be between 1 and {} bytes", MAX_ATTACHMENT_BYTES))); }
        let filename = Path::new(filename).file_name().and_then(|name| name.to_str()).filter(|name| !name.is_empty() && name.len() <= 255).ok_or_else(|| AgentError::InvalidAction("attachment filename must be a valid basename of at most 255 bytes".into()))?;
        if content_type.is_empty() || content_type.len() > 128 || content_type.chars().any(char::is_control) { return Err(AgentError::InvalidAction("attachment content type must contain 1–128 printable bytes".into())); }
        let quota_lock_path = self.directory.join(".quota.lock");
        match fs::symlink_metadata(&quota_lock_path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(AgentError::InvalidAction("attachment quota lock must be a regular file".into()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let mut lock_options = OpenOptions::new();
        lock_options.create(true).read(true).write(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            lock_options.mode(0o600);
        }
        let quota_lock = lock_options.open(&quota_lock_path)?;
        quota_lock.lock()?;

        let mut attachment_count = 0usize;
        let mut stored_bytes = 0u64;
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_symlink() {
                return Err(AgentError::InvalidAction("attachment directory contains an unexpected symbolic link".into()));
            }
            if !kind.is_file() || entry.path().extension().and_then(|value| value.to_str()) != Some("bin") {
                continue;
            }
            attachment_count += 1;
            stored_bytes = stored_bytes.saturating_add(entry.metadata()?.len());
        }
        if attachment_count >= MAX_ATTACHMENT_COUNT {
            return Err(AgentError::InvalidAction(format!(
                "attachment store reached the {MAX_ATTACHMENT_COUNT} file limit"
            )));
        }
        if stored_bytes.saturating_add(bytes.len() as u64) > MAX_ATTACHMENT_TOTAL_BYTES {
            return Err(AgentError::InvalidAction(format!(
                "attachment store is limited to {} MiB in total",
                MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024)
            )));
        }
        let id = format!("att-{:x}-{:x}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(), NEXT_ID.fetch_add(1, Ordering::Relaxed));
        let item = AttachmentMetadata { id: id.clone(), filename: filename.to_owned(), content_type: content_type.to_owned(), size_bytes: bytes.len() };
        let data_path = self.directory.join(format!("{id}.bin")); let metadata_path = self.directory.join(format!("{id}.json"));
        let mut options = OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&data_path)?;
        if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) { let _ = fs::remove_file(&data_path); return Err(error.into()); }
        let encoded = serde_json::to_vec_pretty(&item)?;
        let mut metadata_options = OpenOptions::new(); metadata_options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; metadata_options.mode(0o600); }
        if let Err(error) = metadata_options.open(&metadata_path).and_then(|mut file| { file.write_all(&encoded)?; file.sync_all() }) {
            let _ = fs::remove_file(&data_path); let _ = fs::remove_file(&metadata_path); return Err(error.into());
        }
        quota_lock.unlock()?;
        Ok(item)
    }
}
fn ensure_real_directory(path: &Path) -> Result<(), AgentError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(AgentError::InvalidAction(format!("attachment storage path must be a real directory: {}", path.display()))),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => { fs::create_dir(path)?; Ok(()) },
        Err(error) => Err(error.into()),
    }
}
#[cfg(test)]
mod tests {
    use super::{AttachmentStore, MAX_ATTACHMENT_BYTES};
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};
    fn workspace() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("rust-agent-upload-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&path).unwrap(); path
    }
    #[test] fn stores_upload_with_generated_id_and_metadata() {
        let root = workspace(); let store = AttachmentStore::new(root.clone()).unwrap();
        let item = store.store("../notes.txt", "text/plain", b"hello").unwrap();
        assert_eq!(item.filename, "notes.txt");
        assert_eq!(fs::read(root.join(".rust-agent/attachments").join(format!("{}.bin", item.id))).unwrap(), b"hello");
        assert!(root.join(".rust-agent/attachments").join(format!("{}.json", item.id)).is_file());
        let _ = fs::remove_dir_all(root);
    }
    #[test] fn rejects_empty_and_oversized_uploads() {
        let root = workspace(); let store = AttachmentStore::new(root.clone()).unwrap();
        assert!(store.store("empty.txt", "text/plain", b"").is_err());
        assert!(store.store("large.bin", "application/octet-stream", &vec![0; MAX_ATTACHMENT_BYTES + 1]).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
