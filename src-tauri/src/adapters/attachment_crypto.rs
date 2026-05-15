use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub const ATTACHMENT_KEY_LEN: usize = 32;
pub const ATTACHMENT_NONCE_PREFIX_LEN: usize = 4;
const GCM_NONCE_LEN: usize = 12;

#[derive(Debug)]
pub enum AttachmentCryptoError {
    Encrypt(String),
    Decrypt(String),
    InvalidKey,
    InvalidNoncePrefix,
}

impl std::fmt::Display for AttachmentCryptoError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Encrypt(error) => write!(formatter, "attachment encrypt failed: {error}"),
            Self::Decrypt(error) => write!(formatter, "attachment decrypt failed: {error}"),
            Self::InvalidKey => write!(formatter, "attachment key must be 32 bytes"),
            Self::InvalidNoncePrefix => {
                write!(formatter, "attachment nonce prefix must be 4 bytes")
            }
        }
    }
}

impl std::error::Error for AttachmentCryptoError {}

pub fn random_key() -> [u8; ATTACHMENT_KEY_LEN] {
    let mut bytes = [0u8; ATTACHMENT_KEY_LEN];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn random_nonce_prefix() -> [u8; ATTACHMENT_NONCE_PREFIX_LEN] {
    let mut bytes = [0u8; ATTACHMENT_NONCE_PREFIX_LEN];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub struct Sha256Builder {
    inner: Sha256,
}

impl Sha256Builder {
    pub fn new() -> Self {
        Self {
            inner: Sha256::new(),
        }
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.inner.update(bytes);
    }

    pub fn finish_hex(self) -> String {
        self.inner
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

impl Default for Sha256Builder {
    fn default() -> Self {
        Self::new()
    }
}

pub fn encrypt_chunk(
    key: &[u8],
    nonce_prefix: &[u8],
    chunk_index: u64,
    plaintext: &[u8],
) -> Result<Vec<u8>, AttachmentCryptoError> {
    let cipher = build_cipher(key)?;
    let nonce = build_nonce(nonce_prefix, chunk_index)?;
    cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|error| AttachmentCryptoError::Encrypt(error.to_string()))
}

pub fn decrypt_chunk(
    key: &[u8],
    nonce_prefix: &[u8],
    chunk_index: u64,
    ciphertext: &[u8],
) -> Result<Vec<u8>, AttachmentCryptoError> {
    let cipher = build_cipher(key)?;
    let nonce = build_nonce(nonce_prefix, chunk_index)?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext)
        .map_err(|error| AttachmentCryptoError::Decrypt(error.to_string()))
}

fn build_cipher(key: &[u8]) -> Result<Aes256Gcm, AttachmentCryptoError> {
    if key.len() != ATTACHMENT_KEY_LEN {
        return Err(AttachmentCryptoError::InvalidKey);
    }
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)))
}

fn build_nonce(
    prefix: &[u8],
    chunk_index: u64,
) -> Result<[u8; GCM_NONCE_LEN], AttachmentCryptoError> {
    if prefix.len() != ATTACHMENT_NONCE_PREFIX_LEN {
        return Err(AttachmentCryptoError::InvalidNoncePrefix);
    }
    let mut nonce = [0u8; GCM_NONCE_LEN];
    nonce[..ATTACHMENT_NONCE_PREFIX_LEN].copy_from_slice(prefix);
    nonce[ATTACHMENT_NONCE_PREFIX_LEN..].copy_from_slice(&chunk_index.to_be_bytes());
    Ok(nonce)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_preserves_plaintext() {
        let key = random_key();
        let prefix = random_nonce_prefix();
        let body = b"some attachment chunk payload";
        let ciphertext = encrypt_chunk(&key, &prefix, 7, body).unwrap();
        let recovered = decrypt_chunk(&key, &prefix, 7, &ciphertext).unwrap();
        assert_eq!(recovered, body);
    }

    #[test]
    fn different_chunk_indexes_yield_different_ciphertext() {
        let key = random_key();
        let prefix = random_nonce_prefix();
        let body = b"identical bytes";
        let a = encrypt_chunk(&key, &prefix, 0, body).unwrap();
        let b = encrypt_chunk(&key, &prefix, 1, body).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn decrypt_rejects_wrong_index() {
        let key = random_key();
        let prefix = random_nonce_prefix();
        let ciphertext = encrypt_chunk(&key, &prefix, 4, b"payload").unwrap();
        assert!(decrypt_chunk(&key, &prefix, 5, &ciphertext).is_err());
    }

    #[test]
    fn decrypt_rejects_wrong_key() {
        let prefix = random_nonce_prefix();
        let key_a = random_key();
        let key_b = random_key();
        let ciphertext = encrypt_chunk(&key_a, &prefix, 0, b"payload").unwrap();
        assert!(decrypt_chunk(&key_b, &prefix, 0, &ciphertext).is_err());
    }

    #[test]
    fn invalid_key_size_rejected() {
        let prefix = random_nonce_prefix();
        let short = [0u8; 16];
        assert!(matches!(
            encrypt_chunk(&short, &prefix, 0, b"x"),
            Err(AttachmentCryptoError::InvalidKey)
        ));
    }

    #[test]
    fn sha256_builder_matches_one_shot() {
        let bytes = b"hello world bytes";
        let one_shot = sha256_hex(bytes);
        let mut builder = Sha256Builder::new();
        builder.update(&bytes[..5]);
        builder.update(&bytes[5..]);
        assert_eq!(builder.finish_hex(), one_shot);
    }
}
