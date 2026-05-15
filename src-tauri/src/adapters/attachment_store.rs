use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::adapters::attachment_crypto::{sha256_hex, Sha256Builder};

const ATTACHMENT_DIR_NAME: &str = "attachments";

#[derive(Debug)]
pub enum AttachmentStoreError {
    Io(String),
    HashMismatch { expected: String, actual: String },
    InvalidHash(String),
}

impl std::fmt::Display for AttachmentStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "attachment store io: {error}"),
            Self::HashMismatch { expected, actual } => write!(
                formatter,
                "attachment hash mismatch: expected {expected}, got {actual}"
            ),
            Self::InvalidHash(value) => {
                write!(formatter, "invalid attachment hash: {value}")
            }
        }
    }
}

impl std::error::Error for AttachmentStoreError {}

impl From<std::io::Error> for AttachmentStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

pub struct AttachmentStore {
    root: PathBuf,
}

impl AttachmentStore {
    pub fn new(app_data_dir: impl AsRef<Path>) -> Result<Self, AttachmentStoreError> {
        let root = app_data_dir.as_ref().join(ATTACHMENT_DIR_NAME);
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn path_for(&self, content_hash: &str) -> Result<PathBuf, AttachmentStoreError> {
        validate_hash(content_hash)?;
        Ok(self.root.join(content_hash))
    }

    pub fn exists(&self, content_hash: &str) -> Result<bool, AttachmentStoreError> {
        Ok(self.path_for(content_hash)?.is_file())
    }

    pub fn write_blob(
        &self,
        content_hash: &str,
        bytes: &[u8],
    ) -> Result<PathBuf, AttachmentStoreError> {
        let computed = sha256_hex(bytes);
        if computed != content_hash.to_ascii_lowercase() {
            return Err(AttachmentStoreError::HashMismatch {
                expected: content_hash.to_string(),
                actual: computed,
            });
        }
        let path = self.path_for(content_hash)?;
        write_atomic(&path, bytes)?;
        Ok(path)
    }

    pub fn open_writer(
        &self,
        content_hash: &str,
    ) -> Result<AttachmentWriter, AttachmentStoreError> {
        let final_path = self.path_for(content_hash)?;
        let temp_path = temp_path_for(&final_path);
        let file = fs::File::create(&temp_path)?;
        Ok(AttachmentWriter {
            expected_hash: content_hash.to_ascii_lowercase(),
            final_path,
            temp_path,
            file,
            hasher: Sha256Builder::new(),
        })
    }

    pub fn read_blob(&self, content_hash: &str) -> Result<Vec<u8>, AttachmentStoreError> {
        let path = self.path_for(content_hash)?;
        let mut buffer = Vec::new();
        let mut file = fs::File::open(&path)?;
        file.read_to_end(&mut buffer)?;
        Ok(buffer)
    }
}

pub struct AttachmentWriter {
    expected_hash: String,
    final_path: PathBuf,
    temp_path: PathBuf,
    file: fs::File,
    hasher: Sha256Builder,
}

impl AttachmentWriter {
    pub fn write_chunk(&mut self, bytes: &[u8]) -> Result<(), AttachmentStoreError> {
        self.file.write_all(bytes)?;
        self.hasher.update(bytes);
        Ok(())
    }

    pub fn finalize(self) -> Result<PathBuf, AttachmentStoreError> {
        self.file.sync_all()?;
        drop(self.file);
        let actual = self.hasher.finish_hex();
        if actual != self.expected_hash {
            let _ = fs::remove_file(&self.temp_path);
            return Err(AttachmentStoreError::HashMismatch {
                expected: self.expected_hash,
                actual,
            });
        }
        fs::rename(&self.temp_path, &self.final_path)?;
        Ok(self.final_path)
    }

    pub fn abort(self) -> Result<(), AttachmentStoreError> {
        drop(self.file);
        if self.temp_path.exists() {
            fs::remove_file(&self.temp_path)?;
        }
        Ok(())
    }
}

fn validate_hash(hash: &str) -> Result<(), AttachmentStoreError> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AttachmentStoreError::InvalidHash(hash.to_string()));
    }
    Ok(())
}

fn temp_path_for(final_path: &Path) -> PathBuf {
    let mut suffix = final_path.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    suffix.push(".partial");
    let mut path = final_path.to_path_buf();
    path.set_file_name(suffix);
    path
}

fn write_atomic(final_path: &Path, bytes: &[u8]) -> Result<(), AttachmentStoreError> {
    let temp = temp_path_for(final_path);
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&temp, final_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tempdir() -> PathBuf {
        let mut path = env::temp_dir();
        path.push(format!(
            "mosh-attachment-test-{}",
            std::process::id()
        ));
        path.push(format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        path
    }

    #[test]
    fn write_blob_persists_bytes_under_content_hash() {
        let dir = tempdir();
        let store = AttachmentStore::new(&dir).unwrap();
        let payload = b"hello attachment";
        let hash = sha256_hex(payload);
        let path = store.write_blob(&hash, payload).unwrap();
        assert!(path.is_file());
        assert!(store.exists(&hash).unwrap());
        assert_eq!(store.read_blob(&hash).unwrap(), payload);
    }

    #[test]
    fn write_blob_rejects_hash_mismatch() {
        let dir = tempdir();
        let store = AttachmentStore::new(&dir).unwrap();
        let bogus_hash = "0".repeat(64);
        let err = store.write_blob(&bogus_hash, b"different").unwrap_err();
        assert!(matches!(err, AttachmentStoreError::HashMismatch { .. }));
    }

    #[test]
    fn writer_assembles_chunks_and_validates_hash() {
        let dir = tempdir();
        let store = AttachmentStore::new(&dir).unwrap();
        let payload: Vec<u8> = (0u8..=200).cycle().take(4096).collect();
        let hash = sha256_hex(&payload);
        let mut writer = store.open_writer(&hash).unwrap();
        for chunk in payload.chunks(64) {
            writer.write_chunk(chunk).unwrap();
        }
        let path = writer.finalize().unwrap();
        assert!(path.is_file());
        assert_eq!(store.read_blob(&hash).unwrap(), payload);
    }

    #[test]
    fn writer_rejects_when_assembled_hash_drifts() {
        let dir = tempdir();
        let store = AttachmentStore::new(&dir).unwrap();
        let expected = sha256_hex(b"expected payload");
        let mut writer = store.open_writer(&expected).unwrap();
        writer.write_chunk(b"different payload").unwrap();
        assert!(matches!(
            writer.finalize(),
            Err(AttachmentStoreError::HashMismatch { .. })
        ));
        // .partial cleanup happened so re-open works.
        let mut writer = store.open_writer(&expected).unwrap();
        writer.write_chunk(b"expected payload").unwrap();
        writer.finalize().unwrap();
    }

    #[test]
    fn invalid_hash_rejected() {
        let dir = tempdir();
        let store = AttachmentStore::new(&dir).unwrap();
        assert!(matches!(
            store.path_for("not-a-hash"),
            Err(AttachmentStoreError::InvalidHash(_))
        ));
    }
}
