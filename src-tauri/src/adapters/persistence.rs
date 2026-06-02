use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;
use redb::{Database, ReadableTable, TableDefinition};

use crate::adapters::secure_storage::{OsSecureSecretStore, SecureSecretStore};

const NONCE_LEN: usize = 12;

#[derive(Debug)]
pub enum PersistenceError {
    Crypto(String),
    Io(String),
    Db(String),
    Json(String),
    Keychain(String),
}

impl std::fmt::Display for PersistenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Crypto(e) => write!(f, "persistence crypto error: {e}"),
            Self::Io(e) => write!(f, "persistence io error: {e}"),
            Self::Db(e) => write!(f, "persistence db error: {e}"),
            Self::Json(e) => write!(f, "persistence json error: {e}"),
            Self::Keychain(e) => write!(f, "persistence keychain error: {e}"),
        }
    }
}
impl std::error::Error for PersistenceError {}

/// AES-256-GCM. Output layout: [12-byte nonce][ciphertext+tag].
pub fn encrypt_blob(dek: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, PersistenceError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(dek));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| PersistenceError::Crypto(e.to_string()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt_blob(dek: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, PersistenceError> {
    if blob.len() < NONCE_LEN {
        return Err(PersistenceError::Crypto("blob shorter than nonce".into()));
    }
    let (nonce_bytes, ct) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(dek));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|e| PersistenceError::Crypto(e.to_string()))
}

const DEK_KEY: &str = "history-dek-v1";
const MLS_SNAPSHOT: TableDefinition<&str, &[u8]> = TableDefinition::new("mls_snapshot");
const MESSAGES: TableDefinition<&str, &[u8]> = TableDefinition::new("messages");
const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("sessions");

pub struct Persistence {
    db: Database,
    dek: [u8; 32],
}

impl Persistence {
    /// Open (or create) the encrypted DB at `path`, loading the DEK from the OS
    /// keychain (creating + storing a new random DEK on first run).
    pub fn open(path: &Path) -> Result<Self, PersistenceError> {
        let store = OsSecureSecretStore;
        let dek = match store.load_secret(DEK_KEY) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut d = [0u8; 32];
                d.copy_from_slice(&bytes);
                d
            }
            _ => {
                let mut d = [0u8; 32];
                rand::rngs::OsRng.fill_bytes(&mut d);
                store
                    .save_secret(DEK_KEY, &d)
                    .map_err(|e| PersistenceError::Keychain(e.to_string()))?;
                d
            }
        };
        let db = Database::create(path).map_err(|e| PersistenceError::Db(e.to_string()))?;
        let wtx = db.begin_write().map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            wtx.open_table(MLS_SNAPSHOT).map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(MESSAGES).map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(SESSIONS).map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        wtx.commit().map_err(|e| PersistenceError::Db(e.to_string()))?;
        Ok(Self { db, dek })
    }

    fn put(&self, table: TableDefinition<&str, &[u8]>, key: &str, plaintext: &[u8]) -> Result<(), PersistenceError> {
        let blob = encrypt_blob(&self.dek, plaintext)?;
        let wtx = self.db.begin_write().map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            let mut t = wtx.open_table(table).map_err(|e| PersistenceError::Db(e.to_string()))?;
            t.insert(key, blob.as_slice()).map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        wtx.commit().map_err(|e| PersistenceError::Db(e.to_string()))
    }

    fn get(&self, table: TableDefinition<&str, &[u8]>, key: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        let rtx = self.db.begin_read().map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx.open_table(table).map_err(|e| PersistenceError::Db(e.to_string()))?;
        match t.get(key).map_err(|e| PersistenceError::Db(e.to_string()))? {
            Some(g) => Ok(Some(decrypt_blob(&self.dek, g.value())?)),
            None => Ok(None),
        }
    }

    fn range_prefix(&self, table: TableDefinition<&str, &[u8]>, prefix: &str) -> Result<Vec<Vec<u8>>, PersistenceError> {
        let lo = format!("{prefix}\u{0001}");
        let hi = format!("{prefix}\u{0002}");
        let rtx = self.db.begin_read().map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx.open_table(table).map_err(|e| PersistenceError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for item in t.range(lo.as_str()..hi.as_str()).map_err(|e| PersistenceError::Db(e.to_string()))? {
            let (_k, v) = item.map_err(|e| PersistenceError::Db(e.to_string()))?;
            out.push(decrypt_blob(&self.dek, v.value())?);
        }
        Ok(out)
    }

    pub fn put_mls_snapshot(&self, session_id: &str, snapshot: &[u8]) -> Result<(), PersistenceError> {
        self.put(MLS_SNAPSHOT, session_id, snapshot)
    }
    pub fn get_mls_snapshot(&self, session_id: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        self.get(MLS_SNAPSHOT, session_id)
    }

    pub fn put_session(&self, session_id: &str, json: &[u8]) -> Result<(), PersistenceError> {
        self.put(SESSIONS, session_id, json)
    }
    pub fn list_sessions(&self) -> Result<Vec<Vec<u8>>, PersistenceError> {
        let rtx = self.db.begin_read().map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx.open_table(SESSIONS).map_err(|e| PersistenceError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for item in t.iter().map_err(|e| PersistenceError::Db(e.to_string()))? {
            let (_k, v) = item.map_err(|e| PersistenceError::Db(e.to_string()))?;
            out.push(decrypt_blob(&self.dek, v.value())?);
        }
        Ok(out)
    }

    pub fn append_message(&self, conversation_id: &str, sent_at_ms: u64, message_id: &str, json: &[u8]) -> Result<(), PersistenceError> {
        let key = format!("{conversation_id}\u{0001}{sent_at_ms:020}\u{0001}{message_id}");
        self.put(MESSAGES, &key, json)
    }
    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<Vec<u8>>, PersistenceError> {
        self.range_prefix(MESSAGES, conversation_id)
    }
}

#[cfg(test)]
impl Persistence {
    pub fn open_with_dek(path: &Path, dek: [u8; 32]) -> Result<Self, PersistenceError> {
        let db = Database::create(path).map_err(|e| PersistenceError::Db(e.to_string()))?;
        let wtx = db.begin_write().map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            wtx.open_table(MLS_SNAPSHOT).map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(MESSAGES).map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(SESSIONS).map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        wtx.commit().map_err(|e| PersistenceError::Db(e.to_string()))?;
        Ok(Self { db, dek })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_round_trips() {
        let dek = [7u8; 32];
        let blob = encrypt_blob(&dek, b"hello history").unwrap();
        assert_ne!(&blob[12..], b"hello history");
        assert_eq!(decrypt_blob(&dek, &blob).unwrap(), b"hello history");
    }

    #[test]
    fn tamper_fails() {
        let dek = [7u8; 32];
        let mut blob = encrypt_blob(&dek, b"secret").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xFF;
        assert!(decrypt_blob(&dek, &blob).is_err());
    }

    #[test]
    fn messages_round_trip_in_time_order() {
        let dir = std::env::temp_dir().join(format!("mosh-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("msgs.redb");
        let _ = std::fs::remove_file(&path);
        let p = Persistence::open_with_dek(&path, [3u8; 32]).unwrap();

        p.append_message("conv-A", 200, "m2", b"second").unwrap();
        p.append_message("conv-A", 100, "m1", b"first").unwrap();
        p.append_message("conv-B", 150, "x", b"other").unwrap();

        let msgs = p.list_messages("conv-A").unwrap();
        assert_eq!(msgs, vec![b"first".to_vec(), b"second".to_vec()]);
        std::fs::remove_file(&path).ok();
    }
}
