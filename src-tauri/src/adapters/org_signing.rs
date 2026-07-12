use ed25519_dalek::SigningKey;

const IDENTITY_VERSION: u8 = 1;
// moss/internal/crypto/keys.go layout, frozen by the version byte:
// [1][ed25519 private 64 = seed||pub][noise private 32][noise public 32]
const IDENTITY_LEN: usize = 129;

#[derive(Debug)]
pub enum OrgSigningError {
    BadBlob(&'static str),
}

impl std::fmt::Display for OrgSigningError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadBlob(what) => write!(f, "moss identity blob invalid: {what}"),
        }
    }
}

impl std::error::Error for OrgSigningError {}

/// Reconstruct the node's Ed25519 signing key from the persisted moss
/// identity blob. The seed alone rebuilds the key; the embedded public half
/// is cross-checked so a corrupted blob fails closed instead of signing
/// under a wrong identity.
pub fn signing_key_from_identity(blob: &[u8]) -> Result<SigningKey, OrgSigningError> {
    if blob.len() != IDENTITY_LEN {
        return Err(OrgSigningError::BadBlob("length"));
    }
    if blob[0] != IDENTITY_VERSION {
        return Err(OrgSigningError::BadBlob("version"));
    }
    let seed: [u8; 32] = blob[1..33].try_into().expect("slice length checked");
    let key = SigningKey::from_bytes(&seed);
    if key.verifying_key().to_bytes() != blob[33..65] {
        return Err(OrgSigningError::BadBlob("pubkey mismatch"));
    }
    Ok(key)
}

/// The moss peer-id IS the node's Ed25519 public key, hex-encoded.
pub fn peer_id_hex(key: &SigningKey) -> String {
    hex::encode(key.verifying_key().to_bytes())
}

/// Join-flow verification code the member dictates to the admin over the
/// trusted channel: first 12 hex of the peer-id, chunked by 4 (spec §10).
pub fn confirmation_code(peer_id_hex: &str) -> String {
    let head: String = peer_id_hex.chars().take(12).collect();
    head.as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob_for_seed(seed: [u8; 32]) -> Vec<u8> {
        let key = SigningKey::from_bytes(&seed);
        let mut blob = vec![IDENTITY_VERSION];
        blob.extend_from_slice(&seed);
        blob.extend_from_slice(&key.verifying_key().to_bytes());
        blob.extend_from_slice(&[0u8; 64]);
        blob
    }

    #[test]
    fn extracts_signing_key_and_peer_id() {
        let seed = [7u8; 32];
        let expected = SigningKey::from_bytes(&seed);
        let extracted = signing_key_from_identity(&blob_for_seed(seed)).unwrap();
        assert_eq!(
            peer_id_hex(&extracted),
            hex::encode(expected.verifying_key().to_bytes())
        );
    }

    #[test]
    fn rejects_wrong_version_or_length() {
        assert!(signing_key_from_identity(&[0u8; IDENTITY_LEN]).is_err());
        assert!(signing_key_from_identity(&[1u8; 64]).is_err());
    }

    #[test]
    fn rejects_mismatched_embedded_pubkey() {
        let mut blob = blob_for_seed([7u8; 32]);
        blob[33] ^= 0xff;
        assert!(signing_key_from_identity(&blob).is_err());
    }

    #[test]
    fn confirmation_code_chunks_first_12_hex() {
        assert_eq!(confirmation_code("a1b2c3d4e5f6ffff"), "a1b2-c3d4-e5f6");
    }
}
