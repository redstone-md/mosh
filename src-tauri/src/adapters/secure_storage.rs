use keyring_core::Entry;
use std::sync::OnceLock;

const SERVICE_NAME: &str = "app.mosh.desktop";
const BACKEND_NAME: &str = "os-keychain";
const NATIVE_STORE_ERROR: &str = "native secure store is unavailable";

pub trait SecureSecretStore {
    fn load_secret(&self, key: &str) -> Result<Vec<u8>, SecureStorageError>;
    fn save_secret(&self, key: &str, value: &[u8]) -> Result<(), SecureStorageError>;
    fn delete_secret(&self, key: &str) -> Result<(), SecureStorageError>;
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SecureStorageStatus {
    pub backend: &'static str,
    pub service: &'static str,
    pub available: bool,
}

#[derive(Debug)]
pub enum SecureStorageError {
    Entry(String),
    Backend(String),
}

impl std::fmt::Display for SecureStorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Entry(error) => write!(formatter, "secure storage entry error: {error}"),
            Self::Backend(error) => write!(formatter, "secure storage backend error: {error}"),
        }
    }
}

impl std::error::Error for SecureStorageError {}

pub struct OsSecureSecretStore;

impl OsSecureSecretStore {
    pub fn status() -> SecureStorageStatus {
        let store = Self;

        storage_status_for(&store)
    }

    fn entry(key: &str) -> Result<Entry, SecureStorageError> {
        ensure_native_store()?;

        Entry::new(SERVICE_NAME, key).map_err(|error| SecureStorageError::Entry(error.to_string()))
    }
}

pub fn storage_status_for(_store: &dyn SecureSecretStore) -> SecureStorageStatus {
    SecureStorageStatus {
        backend: BACKEND_NAME,
        service: SERVICE_NAME,
        available: ensure_native_store().is_ok(),
    }
}

impl SecureSecretStore for OsSecureSecretStore {
    fn load_secret(&self, key: &str) -> Result<Vec<u8>, SecureStorageError> {
        Self::entry(key)?
            .get_secret()
            .map_err(|error| SecureStorageError::Backend(error.to_string()))
    }

    fn save_secret(&self, key: &str, value: &[u8]) -> Result<(), SecureStorageError> {
        Self::entry(key)?
            .set_secret(value)
            .map_err(|error| SecureStorageError::Backend(error.to_string()))
    }

    fn delete_secret(&self, key: &str) -> Result<(), SecureStorageError> {
        Self::entry(key)?
            .delete_credential()
            .map_err(|error| SecureStorageError::Backend(error.to_string()))
    }
}

/// Runs `init` and caches a `()` marker only on success. A failure is returned
/// without being memoized, so a transient error (locked keychain at boot) is
/// retried on the next call instead of poisoning the store for the process.
fn cache_on_success<E>(
    cell: &OnceLock<()>,
    init: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    if cell.get().is_some() {
        return Ok(());
    }
    let result = init();
    if result.is_ok() {
        let _ = cell.set(());
    }
    result
}

fn ensure_native_store() -> Result<(), SecureStorageError> {
    static NATIVE_STORE: OnceLock<()> = OnceLock::new();

    cache_on_success(&NATIVE_STORE, || {
        keyring::use_native_store(false).map_err(|error| {
            SecureStorageError::Backend(format!("{NATIVE_STORE_ERROR}: {error}"))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SECRET_KEY: &str = "adapter-contract-test-secret";

    #[test]
    fn native_store_roundtrip_preserves_secret_bytes() {
        let store = OsSecureSecretStore;
        let secret = [0, 1, 2, 15, 16, 255];

        store
            .save_secret(TEST_SECRET_KEY, &secret)
            .expect("native store should save secret");
        let loaded = store
            .load_secret(TEST_SECRET_KEY)
            .expect("native store should load secret");
        store
            .delete_secret(TEST_SECRET_KEY)
            .expect("native store should delete secret");

        assert_eq!(loaded, secret);
    }

    #[test]
    fn cache_on_success_retries_after_error_then_caches() {
        static CELL: OnceLock<()> = OnceLock::new();
        // A transient failure must NOT be memoized.
        assert!(cache_on_success(&CELL, || Err::<(), &str>("transient")).is_err());
        // A later success caches the result.
        assert!(cache_on_success(&CELL, || Ok::<(), &str>(())).is_ok());
        // Once cached, the init closure is never run again.
        assert!(
            cache_on_success(&CELL, || -> Result<(), &str> {
                panic!("init must not run once cached")
            })
            .is_ok()
        );
    }

    #[test]
    fn status_describes_native_backend() {
        let status = OsSecureSecretStore::status();

        assert_eq!(status.backend, BACKEND_NAME);
        assert_eq!(status.service, SERVICE_NAME);
        assert!(status.available);
    }
}
