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
const GROUP_MLS_SNAPSHOT: TableDefinition<&str, &[u8]> = TableDefinition::new("group_mls_snapshot");
const GROUP_MESSAGES: TableDefinition<&str, &[u8]> = TableDefinition::new("group_messages");
const GROUPS: TableDefinition<&str, &[u8]> = TableDefinition::new("groups");
const CHANNEL_MESSAGES: TableDefinition<&str, &[u8]> = TableDefinition::new("channel_messages");
const CHANNELS: TableDefinition<&str, &[u8]> = TableDefinition::new("channels");
const MOSS_IDENTITY: TableDefinition<&str, &[u8]> = TableDefinition::new("moss_identity");
// Single-row table: the device's stable Moss transport identity (libp2p key).
const MOSS_IDENTITY_KEY: &str = "node-identity-v1";

pub struct Persistence {
    db: Database,
    dek: [u8; 32],
}

impl Persistence {
    /// Open (or create) the encrypted DB at `path`, loading the DEK from the OS
    /// keychain (creating + storing a new random DEK on first run).
    pub fn open(path: &Path) -> Result<Self, PersistenceError> {
        let store = OsSecureSecretStore;
        let db_exists = path.exists();
        let dek = match store.load_secret(DEK_KEY) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut d = [0u8; 32];
                d.copy_from_slice(&bytes);
                d
            }
            Ok(_) => {
                // Key present but wrong size = corrupt; fail closed, never overwrite.
                return Err(PersistenceError::Keychain(
                    "stored DEK has unexpected length".into(),
                ));
            }
            Err(e) => {
                if db_exists {
                    // Existing database but DEK unavailable: fail closed. Minting a new
                    // key here would permanently orphan all persisted history.
                    return Err(PersistenceError::Keychain(format!(
                        "DEK unavailable but database exists: {e}"
                    )));
                }
                // Genuine first run: mint and store a fresh DEK.
                let mut d = [0u8; 32];
                rand::rngs::OsRng.fill_bytes(&mut d);
                store
                    .save_secret(DEK_KEY, &d)
                    .map_err(|err| PersistenceError::Keychain(err.to_string()))?;
                d
            }
        };
        let db = Database::create(path).map_err(|e| PersistenceError::Db(e.to_string()))?;
        let wtx = db
            .begin_write()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            wtx.open_table(MLS_SNAPSHOT)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(SESSIONS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(GROUP_MLS_SNAPSHOT)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(GROUP_MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(GROUPS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(CHANNEL_MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(CHANNELS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(MOSS_IDENTITY)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        wtx.commit()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        Ok(Self { db, dek })
    }

    fn put(
        &self,
        table: TableDefinition<&str, &[u8]>,
        key: &str,
        plaintext: &[u8],
    ) -> Result<(), PersistenceError> {
        let blob = encrypt_blob(&self.dek, plaintext)?;
        let wtx = self
            .db
            .begin_write()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            let mut t = wtx
                .open_table(table)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            t.insert(key, blob.as_slice())
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        wtx.commit()
            .map_err(|e| PersistenceError::Db(e.to_string()))
    }

    fn get(
        &self,
        table: TableDefinition<&str, &[u8]>,
        key: &str,
    ) -> Result<Option<Vec<u8>>, PersistenceError> {
        let rtx = self
            .db
            .begin_read()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx
            .open_table(table)
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        match t
            .get(key)
            .map_err(|e| PersistenceError::Db(e.to_string()))?
        {
            Some(g) => Ok(Some(decrypt_blob(&self.dek, g.value())?)),
            None => Ok(None),
        }
    }

    fn range_prefix(
        &self,
        table: TableDefinition<&str, &[u8]>,
        prefix: &str,
    ) -> Result<Vec<Vec<u8>>, PersistenceError> {
        let lo = format!("{prefix}\u{0001}");
        let hi = format!("{prefix}\u{0002}");
        let rtx = self
            .db
            .begin_read()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx
            .open_table(table)
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for item in t
            .range(lo.as_str()..hi.as_str())
            .map_err(|e| PersistenceError::Db(e.to_string()))?
        {
            let (_k, v) = item.map_err(|e| PersistenceError::Db(e.to_string()))?;
            out.push(decrypt_blob(&self.dek, v.value())?);
        }
        Ok(out)
    }

    pub fn put_mls_snapshot(
        &self,
        session_id: &str,
        snapshot: &[u8],
    ) -> Result<(), PersistenceError> {
        self.put(MLS_SNAPSHOT, session_id, snapshot)
    }
    pub fn get_mls_snapshot(&self, session_id: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        self.get(MLS_SNAPSHOT, session_id)
    }

    pub fn put_session(&self, session_id: &str, json: &[u8]) -> Result<(), PersistenceError> {
        self.put(SESSIONS, session_id, json)
    }
    pub fn list_sessions(&self) -> Result<Vec<Vec<u8>>, PersistenceError> {
        let rtx = self
            .db
            .begin_read()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx
            .open_table(SESSIONS)
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for item in t.iter().map_err(|e| PersistenceError::Db(e.to_string()))? {
            let (k, v) = item.map_err(|e| PersistenceError::Db(e.to_string()))?;
            match decrypt_blob(&self.dek, v.value()) {
                Ok(plain) => out.push(plain),
                Err(e) => eprintln!("skipping undecryptable session row {}: {e}", k.value()),
            }
        }
        Ok(out)
    }

    pub fn append_message(
        &self,
        conversation_id: &str,
        sent_at_ms: u64,
        message_id: &str,
        json: &[u8],
    ) -> Result<(), PersistenceError> {
        let key = format!("{conversation_id}\u{0001}{sent_at_ms:020}\u{0001}{message_id}");
        self.put(MESSAGES, &key, json)
    }
    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<Vec<u8>>, PersistenceError> {
        self.range_prefix(MESSAGES, conversation_id)
    }

    /// Permanently remove a conversation: its session record, MLS snapshot and
    /// every persisted message. Used when the user deletes a chat so it does
    /// not return on the next launch.
    pub fn delete_session(&self, session_id: &str) -> Result<(), PersistenceError> {
        let wtx = self
            .db
            .begin_write()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            let mut sessions = wtx
                .open_table(SESSIONS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            sessions
                .remove(session_id)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        {
            let mut snapshot = wtx
                .open_table(MLS_SNAPSHOT)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            snapshot
                .remove(session_id)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        {
            let lo = format!("{session_id}\u{0001}");
            let hi = format!("{session_id}\u{0002}");
            let mut messages = wtx
                .open_table(MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            let keys: Vec<String> = messages
                .range(lo.as_str()..hi.as_str())
                .map_err(|e| PersistenceError::Db(e.to_string()))?
                .map(|item| {
                    item.map(|(k, _)| k.value().to_string())
                        .map_err(|e| PersistenceError::Db(e.to_string()))
                })
                .collect::<Result<_, _>>()?;
            for key in keys {
                messages
                    .remove(key.as_str())
                    .map_err(|e| PersistenceError::Db(e.to_string()))?;
            }
        }
        wtx.commit()
            .map_err(|e| PersistenceError::Db(e.to_string()))
    }

    pub fn put_group_mls_snapshot(
        &self,
        group_id: &str,
        snapshot: &[u8],
    ) -> Result<(), PersistenceError> {
        self.put(GROUP_MLS_SNAPSHOT, group_id, snapshot)
    }

    pub fn get_group_mls_snapshot(
        &self,
        group_id: &str,
    ) -> Result<Option<Vec<u8>>, PersistenceError> {
        self.get(GROUP_MLS_SNAPSHOT, group_id)
    }

    pub fn put_group(&self, group_id: &str, json: &[u8]) -> Result<(), PersistenceError> {
        self.put(GROUPS, group_id, json)
    }

    pub fn list_groups(&self) -> Result<Vec<Vec<u8>>, PersistenceError> {
        let rtx = self
            .db
            .begin_read()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx
            .open_table(GROUPS)
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for item in t.iter().map_err(|e| PersistenceError::Db(e.to_string()))? {
            let (k, v) = item.map_err(|e| PersistenceError::Db(e.to_string()))?;
            match decrypt_blob(&self.dek, v.value()) {
                Ok(plain) => out.push(plain),
                Err(e) => eprintln!("skipping undecryptable group row {}: {e}", k.value()),
            }
        }
        Ok(out)
    }

    pub fn append_group_message(
        &self,
        group_id: &str,
        sent_at_ms: u64,
        message_id: &str,
        json: &[u8],
    ) -> Result<(), PersistenceError> {
        let key = format!("{group_id}\u{0001}{sent_at_ms:020}\u{0001}{message_id}");
        self.put(GROUP_MESSAGES, &key, json)
    }

    pub fn list_group_messages(&self, group_id: &str) -> Result<Vec<Vec<u8>>, PersistenceError> {
        self.range_prefix(GROUP_MESSAGES, group_id)
    }

    /// Permanently remove a private group: its group record, MLS snapshot and
    /// every persisted message.
    pub fn delete_group(&self, group_id: &str) -> Result<(), PersistenceError> {
        let wtx = self
            .db
            .begin_write()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            let mut groups = wtx
                .open_table(GROUPS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            groups
                .remove(group_id)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        {
            let mut snapshot = wtx
                .open_table(GROUP_MLS_SNAPSHOT)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            snapshot
                .remove(group_id)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        {
            let lo = format!("{group_id}\u{0001}");
            let hi = format!("{group_id}\u{0002}");
            let mut messages = wtx
                .open_table(GROUP_MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            let keys: Vec<String> = messages
                .range(lo.as_str()..hi.as_str())
                .map_err(|e| PersistenceError::Db(e.to_string()))?
                .map(|item| {
                    item.map(|(k, _)| k.value().to_string())
                        .map_err(|e| PersistenceError::Db(e.to_string()))
                })
                .collect::<Result<_, _>>()?;
            for key in keys {
                messages
                    .remove(key.as_str())
                    .map_err(|e| PersistenceError::Db(e.to_string()))?;
            }
        }
        wtx.commit()
            .map_err(|e| PersistenceError::Db(e.to_string()))
    }

    pub fn put_channel(&self, name: &str, json: &[u8]) -> Result<(), PersistenceError> {
        self.put(CHANNELS, name, json)
    }

    pub fn list_channels(&self) -> Result<Vec<Vec<u8>>, PersistenceError> {
        let rtx = self
            .db
            .begin_read()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let t = rtx
            .open_table(CHANNELS)
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for item in t.iter().map_err(|e| PersistenceError::Db(e.to_string()))? {
            let (k, v) = item.map_err(|e| PersistenceError::Db(e.to_string()))?;
            match decrypt_blob(&self.dek, v.value()) {
                Ok(plain) => out.push(plain),
                Err(e) => eprintln!("skipping undecryptable channel row {}: {e}", k.value()),
            }
        }
        Ok(out)
    }

    pub fn append_channel_message(
        &self,
        name: &str,
        sent_at_ms: u64,
        message_id: &str,
        json: &[u8],
    ) -> Result<(), PersistenceError> {
        let key = format!("{name}\u{0001}{sent_at_ms:020}\u{0001}{message_id}");
        self.put(CHANNEL_MESSAGES, &key, json)
    }

    pub fn list_channel_messages(&self, name: &str) -> Result<Vec<Vec<u8>>, PersistenceError> {
        self.range_prefix(CHANNEL_MESSAGES, name)
    }

    pub fn delete_channel(&self, name: &str) -> Result<(), PersistenceError> {
        let wtx = self
            .db
            .begin_write()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            let mut channels = wtx
                .open_table(CHANNELS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            channels
                .remove(name)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        {
            let lo = format!("{name}\u{0001}");
            let hi = format!("{name}\u{0002}");
            let mut messages = wtx
                .open_table(CHANNEL_MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            let keys: Vec<String> = messages
                .range(lo.as_str()..hi.as_str())
                .map_err(|e| PersistenceError::Db(e.to_string()))?
                .map(|item| {
                    item.map(|(k, _)| k.value().to_string())
                        .map_err(|e| PersistenceError::Db(e.to_string()))
                })
                .collect::<Result<_, _>>()?;
            for key in keys {
                messages
                    .remove(key.as_str())
                    .map_err(|e| PersistenceError::Db(e.to_string()))?;
            }
        }
        wtx.commit()
            .map_err(|e| PersistenceError::Db(e.to_string()))
    }

    /// The device's stable Moss transport identity (encrypted like everything
    /// else). Persisting it keeps the node's peer-id constant across restarts,
    /// which is required for peers to re-establish a connection instead of
    /// flapping.
    pub fn put_moss_identity(&self, raw: &[u8]) -> Result<(), PersistenceError> {
        self.put(MOSS_IDENTITY, MOSS_IDENTITY_KEY, raw)
    }
    pub fn get_moss_identity(&self) -> Result<Option<Vec<u8>>, PersistenceError> {
        self.get(MOSS_IDENTITY, MOSS_IDENTITY_KEY)
    }
}

impl crate::adapters::moss_ffi::MossKeyStore for Persistence {
    fn load_identity(&self) -> Option<Vec<u8>> {
        match self.get_moss_identity() {
            Ok(value) => value,
            Err(e) => {
                eprintln!("moss identity load failed: {e}");
                None
            }
        }
    }

    fn save_identity(&self, bytes: &[u8]) {
        if let Err(e) = self.put_moss_identity(bytes) {
            eprintln!("moss identity save failed: {e}");
        }
    }
}

#[cfg(test)]
impl Persistence {
    pub fn open_with_dek(path: &Path, dek: [u8; 32]) -> Result<Self, PersistenceError> {
        let db = Database::create(path).map_err(|e| PersistenceError::Db(e.to_string()))?;
        let wtx = db
            .begin_write()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        {
            wtx.open_table(MLS_SNAPSHOT)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(SESSIONS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(GROUP_MLS_SNAPSHOT)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(GROUP_MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(GROUPS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(CHANNEL_MESSAGES)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(CHANNELS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(MOSS_IDENTITY)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
        }
        wtx.commit()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
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
    fn moss_identity_round_trips() {
        let path = std::env::temp_dir().join(format!("mosh-moss-id-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = Persistence::open_with_dek(&path, [3u8; 32]).unwrap();

        assert!(p.get_moss_identity().unwrap().is_none());
        let identity = vec![9u8; 129];
        p.put_moss_identity(&identity).unwrap();
        assert_eq!(p.get_moss_identity().unwrap(), Some(identity));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn delete_session_removes_record_snapshot_and_messages() {
        let path = std::env::temp_dir().join(format!("mosh-del-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = Persistence::open_with_dek(&path, [5u8; 32]).unwrap();

        p.put_session("s1", b"rec").unwrap();
        p.put_mls_snapshot("s1", b"snap").unwrap();
        p.append_message("s1", 1, "m1", b"hi").unwrap();
        p.append_message("s1", 2, "m2", b"yo").unwrap();
        // Unrelated conversation must survive.
        p.put_session("s2", b"rec2").unwrap();
        p.append_message("s2", 1, "x", b"keep").unwrap();

        p.delete_session("s1").unwrap();

        assert!(p.get_mls_snapshot("s1").unwrap().is_none());
        assert!(p.list_messages("s1").unwrap().is_empty());
        assert_eq!(p.list_sessions().unwrap().len(), 1);
        assert_eq!(p.list_messages("s2").unwrap().len(), 1);

        let _ = std::fs::remove_file(&path);
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

    #[test]
    fn messages_ordered_within_same_millisecond_batch() {
        let dir = std::env::temp_dir().join(format!("mosh-ms-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ms-batch.redb");
        let _ = std::fs::remove_file(&path);
        let p = Persistence::open_with_dek(&path, [5u8; 32]).unwrap();

        let ts = 1_700_000_000_000u64;
        // Insert 12 messages in the SAME millisecond, ids built like the runtime
        // does after FIX 2 (zero-padded index), out of natural insertion order.
        for i in (0..12u32).rev() {
            let id = format!("{ts}-{i:06}");
            let body = format!("m{i}");
            p.append_message("conv", ts, &id, body.as_bytes()).unwrap();
        }
        let got: Vec<String> = p
            .list_messages("conv")
            .unwrap()
            .into_iter()
            .map(|b| String::from_utf8(b).unwrap())
            .collect();
        let want: Vec<String> = (0..12).map(|i| format!("m{i}")).collect();
        assert_eq!(got, want, "same-ms messages must come back in index order");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn group_records_messages_and_snapshot_round_trip_then_delete() {
        let dir = std::env::temp_dir().join(format!("mosh-groups-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("groups.redb");
        let _ = std::fs::remove_file(&path);
        let p = Persistence::open_with_dek(&path, [11u8; 32]).unwrap();

        p.put_group("g1", br#"{"group_id":"g1"}"#).unwrap();
        p.put_group_mls_snapshot("g1", b"group-snapshot").unwrap();
        p.append_group_message("g1", 20, "m2", br#"{"body":"second"}"#)
            .unwrap();
        p.append_group_message("g1", 10, "m1", br#"{"body":"first"}"#)
            .unwrap();

        assert_eq!(p.list_groups().unwrap().len(), 1);
        assert_eq!(
            p.get_group_mls_snapshot("g1").unwrap().unwrap(),
            b"group-snapshot"
        );
        let rows = p.list_group_messages("g1").unwrap();
        assert_eq!(rows[0], br#"{"body":"first"}"#);
        assert_eq!(rows[1], br#"{"body":"second"}"#);

        p.delete_group("g1").unwrap();
        assert!(p.list_groups().unwrap().is_empty());
        assert!(p.get_group_mls_snapshot("g1").unwrap().is_none());
        assert!(p.list_group_messages("g1").unwrap().is_empty());

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn channel_records_and_messages_round_trip_then_delete() {
        let dir = std::env::temp_dir().join(format!("mosh-channels-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("channels.redb");
        let _ = std::fs::remove_file(&path);
        let p = Persistence::open_with_dek(&path, [15u8; 32]).unwrap();

        p.put_channel("general", br#"{"name":"general"}"#).unwrap();
        p.append_channel_message("general", 20, "m2", br#"{"body":"second"}"#)
            .unwrap();
        p.append_channel_message("general", 10, "m1", br#"{"body":"first"}"#)
            .unwrap();

        assert_eq!(p.list_channels().unwrap().len(), 1);
        let rows = p.list_channel_messages("general").unwrap();
        assert_eq!(rows[0], br#"{"body":"first"}"#);
        assert_eq!(rows[1], br#"{"body":"second"}"#);

        p.delete_channel("general").unwrap();
        assert!(p.list_channels().unwrap().is_empty());
        assert!(p.list_channel_messages("general").unwrap().is_empty());

        std::fs::remove_file(&path).ok();
    }
}
