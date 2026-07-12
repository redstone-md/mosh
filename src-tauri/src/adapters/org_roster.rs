use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RosterMember {
    pub moss_peer_id: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Roster {
    pub org_pubkey: String,
    pub org_name: String,
    pub version: u64,
    pub members: Vec<RosterMember>,
}

#[derive(Debug)]
pub enum RosterError {
    Json(String),
    Field(&'static str),
    Signature,
    WrongOrg,
    Rollback { stored: u64, received: u64 },
}

impl std::fmt::Display for RosterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Json(e) => write!(f, "roster json error: {e}"),
            Self::Field(name) => write!(f, "roster field missing or invalid: {name}"),
            Self::Signature => write!(f, "roster signature invalid"),
            Self::WrongOrg => write!(f, "roster org_pubkey does not match expected org"),
            Self::Rollback { stored, received } => {
                write!(f, "roster rollback: stored v{stored}, received v{received}")
            }
        }
    }
}

impl std::error::Error for RosterError {}

/// Canonical roster bytes: compact JSON with object keys sorted. Relies on
/// serde_json WITHOUT the `preserve_order` feature (its Map is a BTreeMap,
/// so keys iterate sorted). Guarded by tests; enabling preserve_order
/// anywhere in the workspace breaks the roster wire format.
pub fn canonical_bytes(doc: &Value) -> Result<Vec<u8>, RosterError> {
    serde_json::to_vec(doc).map_err(|e| RosterError::Json(e.to_string()))
}

/// Sign a roster document in place (inserts `sig`) and return the full
/// serialized bytes. Contract shared with the admin CLI: the signature is
/// Ed25519 over `canonical_bytes` of the document with `sig` absent.
pub fn sign_roster(doc: &mut Value, key: &SigningKey) -> Result<Vec<u8>, RosterError> {
    let obj = doc.as_object_mut().ok_or(RosterError::Field("document"))?;
    obj.remove("sig");
    let unsigned = Value::Object(obj.clone());
    let sig = key.sign(&canonical_bytes(&unsigned)?);
    obj.insert("sig".into(), Value::String(hex::encode(sig.to_bytes())));
    canonical_bytes(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn test_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn sample_doc(version: u64) -> serde_json::Value {
        serde_json::json!({
            "org_pubkey": hex::encode(test_key().verifying_key().to_bytes()),
            "org_name": "acme",
            "version": version,
            "members": [
                { "moss_peer_id": "aa".repeat(32), "name": "alice", "role": "admin" },
                { "moss_peer_id": "bb".repeat(32), "name": "bob",   "role": "member" }
            ]
        })
    }

    #[test]
    fn canonical_bytes_are_key_order_independent() {
        // Same document, keys written in different order, must canonicalize
        // to identical bytes (serde_json without preserve_order sorts keys).
        let a: serde_json::Value =
            serde_json::from_str(r#"{"b":1,"a":{"y":2,"x":3}}"#).unwrap();
        let b: serde_json::Value =
            serde_json::from_str(r#"{"a":{"x":3,"y":2},"b":1}"#).unwrap();
        assert_eq!(canonical_bytes(&a).unwrap(), canonical_bytes(&b).unwrap());
    }

    #[test]
    fn canonical_bytes_frozen_vector() {
        // Freezes the canonical encoding. If this test ever breaks, the
        // roster wire format changed and the admin CLI contract is broken.
        let doc: serde_json::Value =
            serde_json::from_str(r#"{"version":1,"org_name":"acme"}"#).unwrap();
        assert_eq!(
            canonical_bytes(&doc).unwrap(),
            br#"{"org_name":"acme","version":1}"#.to_vec()
        );
    }

    #[test]
    fn sign_roster_inserts_sig_and_serializes() {
        let mut doc = sample_doc(1);
        let bytes = sign_roster(&mut doc, &test_key()).unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(parsed.get("sig").and_then(|v| v.as_str()).is_some());
    }
}
