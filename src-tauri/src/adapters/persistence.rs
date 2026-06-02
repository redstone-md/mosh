use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;

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
}
