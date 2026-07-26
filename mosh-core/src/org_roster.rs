use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
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

/// Canonical roster bytes. The contract (shared with the admin CLI) is
/// deliberately NOT RFC 8785 JCS — it is exactly "serde_json compact output
/// with object keys byte-sorted": relies on serde_json WITHOUT the
/// `preserve_order` feature (its Map is a BTreeMap), and rosters must only
/// contain integers (no floats — serde_json and JCS re-serialize numbers
/// differently). Guarded by the frozen-vector test; enabling preserve_order
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

fn decode_key32(hex64: &str) -> Result<[u8; 32], RosterError> {
    let bytes = hex::decode(hex64).map_err(|_| RosterError::Field("hex"))?;
    bytes
        .try_into()
        .map_err(|_| RosterError::Field("key length"))
}

/// Verify a received roster document. `stored_version = None` means "no
/// roster stored yet for this org" (first receipt). Unknown fields are
/// covered by the signature (canonical bytes of the whole document sans
/// `sig`) and otherwise ignored.
pub fn verify(
    bytes: &[u8],
    expected_org_pubkey: &str,
    stored_version: Option<u64>,
) -> Result<Roster, RosterError> {
    let mut doc: Value =
        serde_json::from_slice(bytes).map_err(|e| RosterError::Json(e.to_string()))?;
    let obj = doc.as_object_mut().ok_or(RosterError::Field("document"))?;

    let sig_hex = match obj.remove("sig") {
        Some(Value::String(s)) => s,
        _ => return Err(RosterError::Field("sig")),
    };
    let org_pubkey = obj
        .get("org_pubkey")
        .and_then(Value::as_str)
        .ok_or(RosterError::Field("org_pubkey"))?
        .to_string();
    if org_pubkey != expected_org_pubkey {
        return Err(RosterError::WrongOrg);
    }
    let version = obj
        .get("version")
        .and_then(Value::as_u64)
        .ok_or(RosterError::Field("version"))?;
    if let Some(stored) = stored_version {
        if version <= stored {
            return Err(RosterError::Rollback {
                stored,
                received: version,
            });
        }
    }

    let key = VerifyingKey::from_bytes(&decode_key32(&org_pubkey)?)
        .map_err(|_| RosterError::Field("org_pubkey"))?;
    let sig_bytes = hex::decode(&sig_hex).map_err(|_| RosterError::Field("sig"))?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| RosterError::Field("sig"))?;
    key.verify_strict(&canonical_bytes(&Value::Object(obj.clone()))?, &sig)
        .map_err(|_| RosterError::Signature)?;

    let org_name = obj
        .get("org_name")
        .and_then(Value::as_str)
        .ok_or(RosterError::Field("org_name"))?
        .to_string();
    let members: Vec<RosterMember> = serde_json::from_value(
        obj.get("members")
            .cloned()
            .ok_or(RosterError::Field("members"))?,
    )
    .map_err(|e| RosterError::Json(e.to_string()))?;
    // Duplicate peer-ids would fan out duplicate member_added events.
    let mut seen = std::collections::HashSet::new();
    if !members.iter().all(|m| seen.insert(m.moss_peer_id.as_str())) {
        return Err(RosterError::Field("members: duplicate moss_peer_id"));
    }

    Ok(Roster {
        org_pubkey,
        org_name,
        version,
        members,
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct RosterDiff {
    pub added: Vec<RosterMember>,
    pub removed: Vec<RosterMember>,
}

/// Membership delta keyed by moss_peer_id. Renames and role changes emit
/// nothing: authority checks read the live roster and the UI re-reads the
/// whole roster on any update (spec §1).
pub fn diff(old: Option<&Roster>, new: &Roster) -> RosterDiff {
    let old_ids: std::collections::HashSet<&str> = old
        .map(|r| r.members.iter().map(|m| m.moss_peer_id.as_str()).collect())
        .unwrap_or_default();
    let new_ids: std::collections::HashSet<&str> = new
        .members
        .iter()
        .map(|m| m.moss_peer_id.as_str())
        .collect();
    RosterDiff {
        added: new
            .members
            .iter()
            .filter(|m| !old_ids.contains(m.moss_peer_id.as_str()))
            .cloned()
            .collect(),
        removed: old
            .map(|r| {
                r.members
                    .iter()
                    .filter(|m| !new_ids.contains(m.moss_peer_id.as_str()))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default(),
    }
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
        let a: serde_json::Value = serde_json::from_str(r#"{"b":1,"a":{"y":2,"x":3}}"#).unwrap();
        let b: serde_json::Value = serde_json::from_str(r#"{"a":{"x":3,"y":2},"b":1}"#).unwrap();
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

    fn signed_sample(version: u64) -> Vec<u8> {
        sign_roster(&mut sample_doc(version), &test_key()).unwrap()
    }

    fn org_hex() -> String {
        hex::encode(test_key().verifying_key().to_bytes())
    }

    #[test]
    fn verify_accepts_valid_roster() {
        let roster = verify(&signed_sample(3), &org_hex(), Some(2)).unwrap();
        assert_eq!(roster.version, 3);
        assert_eq!(roster.members.len(), 2);
        assert_eq!(roster.members[0].role, "admin");
    }

    #[test]
    fn verify_rejects_tampered_payload() {
        let bytes = signed_sample(3);
        let tampered = String::from_utf8(bytes)
            .unwrap()
            .replace("alice", "mallory");
        assert!(matches!(
            verify(tampered.as_bytes(), &org_hex(), None),
            Err(RosterError::Signature)
        ));
    }

    #[test]
    fn verify_rejects_rollback_and_replay() {
        // Strictly greater: same version is a replay, lower is a rollback.
        assert!(matches!(
            verify(&signed_sample(3), &org_hex(), Some(3)),
            Err(RosterError::Rollback {
                stored: 3,
                received: 3
            })
        ));
        assert!(matches!(
            verify(&signed_sample(2), &org_hex(), Some(3)),
            Err(RosterError::Rollback { .. })
        ));
    }

    #[test]
    fn verify_rejects_wrong_org() {
        let other = hex::encode(
            SigningKey::from_bytes(&[9u8; 32])
                .verifying_key()
                .to_bytes(),
        );
        assert!(matches!(
            verify(&signed_sample(1), &other, None),
            Err(RosterError::WrongOrg)
        ));
    }

    #[test]
    fn verify_covers_unknown_fields_and_ignores_them() {
        // Forward-compat: unknown field is signed (tamper breaks sig) but
        // semantically ignored (verify succeeds, Roster has no trace of it).
        let mut doc = sample_doc(5);
        doc.as_object_mut().unwrap().insert(
            "successor_org_pubkey".into(),
            serde_json::json!("00".repeat(32)),
        );
        let bytes = sign_roster(&mut doc, &test_key()).unwrap();
        assert!(verify(&bytes, &org_hex(), None).is_ok());

        let tampered = String::from_utf8(bytes)
            .unwrap()
            .replace(&"00".repeat(32), &"11".repeat(32));
        assert!(matches!(
            verify(tampered.as_bytes(), &org_hex(), None),
            Err(RosterError::Signature)
        ));
    }

    #[test]
    fn verify_rejects_duplicate_peer_ids() {
        let mut doc = sample_doc(1);
        let dup = serde_json::json!(
            { "moss_peer_id": "aa".repeat(32), "name": "alice-2", "role": "member" }
        );
        doc["members"].as_array_mut().unwrap().push(dup);
        let bytes = sign_roster(&mut doc, &test_key()).unwrap();
        assert!(matches!(
            verify(&bytes, &org_hex(), None),
            Err(RosterError::Field(_))
        ));
    }

    fn roster_with(members: &[(&str, &str, &str)]) -> Roster {
        Roster {
            org_pubkey: org_hex(),
            org_name: "acme".into(),
            version: 1,
            members: members
                .iter()
                .map(|(id, name, role)| RosterMember {
                    moss_peer_id: id.repeat(32),
                    name: (*name).into(),
                    role: (*role).into(),
                })
                .collect(),
        }
    }

    #[test]
    fn diff_detects_add_remove_and_replace() {
        let old = roster_with(&[("aa", "alice", "admin"), ("bb", "bob", "member")]);
        // bob's device replaced (new peer-id, same name) + carol added
        let new = roster_with(&[
            ("aa", "alice", "admin"),
            ("cc", "bob", "member"),
            ("dd", "carol", "member"),
        ]);
        let d = diff(Some(&old), &new);
        let added: Vec<_> = d.added.iter().map(|m| m.moss_peer_id.clone()).collect();
        let removed: Vec<_> = d.removed.iter().map(|m| m.moss_peer_id.clone()).collect();
        assert_eq!(added, vec!["cc".repeat(32), "dd".repeat(32)]);
        assert_eq!(removed, vec!["bb".repeat(32)]);
    }

    #[test]
    fn diff_from_none_adds_everyone() {
        let new = roster_with(&[("aa", "alice", "admin")]);
        let d = diff(None, &new);
        assert_eq!(d.added.len(), 1);
        assert!(d.removed.is_empty());
    }

    #[test]
    fn diff_ignores_rename_and_role_change() {
        let old = roster_with(&[("aa", "alice", "member")]);
        let new = roster_with(&[("aa", "alice-2", "admin")]);
        let d = diff(Some(&old), &new);
        assert!(d.added.is_empty() && d.removed.is_empty());
    }
}
