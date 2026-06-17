use std::{fs::OpenOptions, io::Write, path::PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};

const STORE_FILE_NAME: &str = "ciphertext-history.jsonl";

pub trait CiphertextHistoryStore {
    fn append(&self, record: CiphertextRecord) -> Result<(), CiphertextStoreError>;
    fn list_for_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<CiphertextRecord>, CiphertextStoreError>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CiphertextRecord {
    pub message_id: String,
    pub conversation_id: String,
    pub sender_device_id: String,
    pub sent_at_ms: u64,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct PersistedCiphertextRecord {
    message_id: String,
    conversation_id: String,
    sender_device_id: String,
    sent_at_ms: u64,
    ciphertext_b64: String,
}

#[derive(Debug)]
pub enum CiphertextStoreError {
    Io(String),
    Json(String),
    Decode(String),
}

impl std::fmt::Display for CiphertextStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "ciphertext store IO error: {error}"),
            Self::Json(error) => write!(formatter, "ciphertext store JSON error: {error}"),
            Self::Decode(error) => write!(formatter, "ciphertext decode error: {error}"),
        }
    }
}

impl std::error::Error for CiphertextStoreError {}

pub struct JsonlCiphertextHistoryStore {
    path: PathBuf,
}

impl JsonlCiphertextHistoryStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            path: root.join(STORE_FILE_NAME),
        }
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl CiphertextHistoryStore for JsonlCiphertextHistoryStore {
    fn append(&self, record: CiphertextRecord) -> Result<(), CiphertextStoreError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(to_io_error)?;
        }

        let persisted = PersistedCiphertextRecord::from(record);
        let line = serde_json::to_string(&persisted).map_err(to_json_error)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(to_io_error)?;

        writeln!(file, "{line}").map_err(to_io_error)
    }

    fn list_for_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<CiphertextRecord>, CiphertextStoreError> {
        let contents = match std::fs::read_to_string(&self.path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(to_io_error(error)),
        };

        // Skip unparseable lines instead of failing the whole read: a torn
        // append after a crash must not brick the entire conversation history.
        // The bytes are authenticated MLS ciphertext, so a dropped record is
        // recoverable, an unreadable history is not.
        Ok(contents
            .lines()
            .filter_map(|line| match parse_record(line) {
                Ok(record) if record.conversation_id == conversation_id => Some(record),
                Ok(_) => None,
                Err(error) => {
                    eprintln!("skipping unparseable ciphertext history line: {error}");
                    None
                }
            })
            .collect())
    }
}

impl From<CiphertextRecord> for PersistedCiphertextRecord {
    fn from(record: CiphertextRecord) -> Self {
        Self {
            message_id: record.message_id,
            conversation_id: record.conversation_id,
            sender_device_id: record.sender_device_id,
            sent_at_ms: record.sent_at_ms,
            ciphertext_b64: STANDARD.encode(record.ciphertext),
        }
    }
}

impl TryFrom<PersistedCiphertextRecord> for CiphertextRecord {
    type Error = CiphertextStoreError;

    fn try_from(record: PersistedCiphertextRecord) -> Result<Self, Self::Error> {
        let ciphertext = STANDARD
            .decode(record.ciphertext_b64)
            .map_err(|error| CiphertextStoreError::Decode(error.to_string()))?;

        Ok(Self {
            message_id: record.message_id,
            conversation_id: record.conversation_id,
            sender_device_id: record.sender_device_id,
            sent_at_ms: record.sent_at_ms,
            ciphertext,
        })
    }
}

fn parse_record(line: &str) -> Result<CiphertextRecord, CiphertextStoreError> {
    let persisted: PersistedCiphertextRecord = serde_json::from_str(line).map_err(to_json_error)?;

    persisted.try_into()
}

fn to_io_error(error: std::io::Error) -> CiphertextStoreError {
    CiphertextStoreError::Io(error.to_string())
}

fn to_json_error(error: serde_json::Error) -> CiphertextStoreError {
    CiphertextStoreError::Json(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONVERSATION_A: &str = "dm-alice-bob";
    const CONVERSATION_B: &str = "dm-alice-chris";

    #[test]
    fn ciphertext_store_indexes_minimal_metadata() {
        let store = JsonlCiphertextHistoryStore::new(test_root());
        cleanup_store(&store);
        let first = record("msg-1", CONVERSATION_A, b"ciphertext-one");
        let second = record("msg-2", CONVERSATION_B, b"ciphertext-two");
        let third = record("msg-3", CONVERSATION_A, b"ciphertext-three");

        store
            .append(first.clone())
            .expect("first append should pass");
        store.append(second).expect("second append should pass");
        store
            .append(third.clone())
            .expect("third append should pass");

        let records = store
            .list_for_conversation(CONVERSATION_A)
            .expect("list should pass");

        assert_eq!(records, vec![first, third]);
        assert!(std::fs::read_to_string(store.path())
            .expect("history should be readable")
            .contains("ciphertext_b64"));
    }

    #[test]
    fn list_skips_unparseable_lines_instead_of_failing() {
        // Own directory — this test writes a garbage line and must not pollute
        // the file the other (parallel) tests read.
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("ciphertext-store-skip-test");
        let store = JsonlCiphertextHistoryStore::new(root);
        cleanup_store(&store);
        store
            .append(record("msg-1", CONVERSATION_A, b"one"))
            .expect("first append should pass");
        // Simulate a torn/corrupt append between two good records.
        {
            let mut file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(store.path())
                .expect("open for corrupt write");
            writeln!(file, "{{ this is not valid json").expect("write corrupt line");
        }
        store
            .append(record("msg-2", CONVERSATION_A, b"two"))
            .expect("second append should pass");

        let records = store
            .list_for_conversation(CONVERSATION_A)
            .expect("a corrupt line must not brick the whole history");
        let ids: Vec<String> = records.into_iter().map(|r| r.message_id).collect();
        assert_eq!(ids, vec!["msg-1", "msg-2"]);
    }

    #[test]
    fn ciphertext_store_returns_empty_for_missing_history() {
        let store = JsonlCiphertextHistoryStore::new(test_root());
        cleanup_store(&store);

        let records = store
            .list_for_conversation(CONVERSATION_A)
            .expect("missing history should be empty");

        assert!(records.is_empty());
    }

    fn record(message_id: &str, conversation_id: &str, ciphertext: &[u8]) -> CiphertextRecord {
        CiphertextRecord {
            message_id: message_id.to_string(),
            conversation_id: conversation_id.to_string(),
            sender_device_id: "device-alice".to_string(),
            sent_at_ms: 1_700_000_000_000,
            ciphertext: ciphertext.to_vec(),
        }
    }

    fn test_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("ciphertext-store-test")
    }

    fn cleanup_store(store: &JsonlCiphertextHistoryStore) {
        let _ = std::fs::remove_file(store.path());
    }
}
