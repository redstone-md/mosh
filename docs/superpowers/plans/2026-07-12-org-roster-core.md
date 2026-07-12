# Org Roster Core Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure foundations for the org roster feature — roster verification/diff, signed envelope crypto, persistence tables, and the MLS remove/replace operations — all closed by `cargo test`, no runtime wiring.

**Architecture:** Two new pure modules (`org_roster`, `org_envelope`) beside the existing adapters, two new redb tables in `persistence.rs`, and three new methods on `MlsSessionCrypto`. Implements build-order steps 1–3 of `docs/superpowers/specs/2026-07-12-org-roster-design.md` (ADRs 0004–0007). Plan 2 = resync (step 4), Plan 3 = org runtime + UI (steps 5–7).

**Tech Stack:** Rust (src-tauri), OpenMLS, ed25519-dalek 2, serde_json, redb.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-org-roster-design.md`. Glossary: `CONTEXT.md`.
- Roster canonical form: JSON with `sig` removed, serialized by serde_json **without** `preserve_order` (keys iterate sorted — this is load-bearing; a test guards it). Unknown fields are covered by the signature and semantically ignored (forward-compat).
- Envelope domain context: `"mosh-org-v1"` + length-prefixed fields (see Task 4). Never sign a bare payload.
- Peer-ids and org pubkeys are 64-char lowercase hex of 32-byte Ed25519 public keys.
- All work on branch `feat/org-roster-core`; PR at the end (code gets PR+CI; only doc-only changes go straight to main).
- Run tests with: `cargo test --manifest-path src-tauri/Cargo.toml <filter>` (PowerShell).
- No `ponytail:`-branded comments in committed source — plain comments only.

---

### Task 1: Roster types + canonicalization + signing helper

**Files:**
- Modify: `src-tauri/Cargo.toml` (add deps)
- Create: `src-tauri/src/adapters/org_roster.rs`
- Modify: `src-tauri/src/adapters/mod.rs` (register module)

**Interfaces:**
- Produces: `Roster { org_pubkey: String, org_name: String, version: u64, members: Vec<RosterMember> }`, `RosterMember { moss_peer_id: String, name: String, role: String }`, `RosterError`, `canonical_bytes(&Value) -> Result<Vec<u8>, RosterError>`, `sign_roster(doc: &mut serde_json::Value, key: &ed25519_dalek::SigningKey) -> Result<Vec<u8>, RosterError>` (test/CLI-contract helper: inserts `sig` hex, returns full serialized roster bytes).

- [ ] **Step 1: Create branch**

```powershell
git checkout -b feat/org-roster-core
```

- [ ] **Step 2: Add dependencies**

In `src-tauri/Cargo.toml` under `[dependencies]` (both already in Cargo.lock transitively — no new supply chain):

```toml
ed25519-dalek = { version = "2", features = ["rand_core"] }
hex = "0.4"
```

Verify serde_json has no `preserve_order` feature enabled anywhere:

Run: `Select-String -Path src-tauri/Cargo.toml,src-tauri/Cargo.lock -Pattern "preserve_order"`
Expected: no matches (empty output).

- [ ] **Step 3: Write the failing test**

Create `src-tauri/src/adapters/org_roster.rs` with the test module only:

```rust
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_roster -- --nocapture`
Expected: compile FAIL — `canonical_bytes`, `sign_roster` not found. (First register the module: add `pub mod org_roster;` to `src-tauri/src/adapters/mod.rs`, keep the list alphabetical — after `network_inventory`, before `openmls_crypto`.)

- [ ] **Step 5: Write minimal implementation**

Prepend to `src-tauri/src/adapters/org_roster.rs`:

```rust
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_roster`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/adapters/org_roster.rs src-tauri/src/adapters/mod.rs
git commit -m "feat(org): roster types, canonical encoding, signing helper"
```

---

### Task 2: Roster verification (signature, anti-rollback, forward-compat)

**Files:**
- Modify: `src-tauri/src/adapters/org_roster.rs`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `verify(bytes: &[u8], expected_org_pubkey: &str, stored_version: Option<u64>) -> Result<Roster, RosterError>`.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
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
        let tampered = String::from_utf8(bytes).unwrap().replace("alice", "mallory");
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
            Err(RosterError::Rollback { stored: 3, received: 3 })
        ));
        assert!(matches!(
            verify(&signed_sample(2), &org_hex(), Some(3)),
            Err(RosterError::Rollback { .. })
        ));
    }

    #[test]
    fn verify_rejects_wrong_org() {
        let other = hex::encode(SigningKey::from_bytes(&[9u8; 32]).verifying_key().to_bytes());
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
        doc.as_object_mut()
            .unwrap()
            .insert("successor_org_pubkey".into(), serde_json::json!("00".repeat(32)));
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_roster`
Expected: compile FAIL — `verify` not found.

- [ ] **Step 3: Write the implementation**

Append to the module (above `#[cfg(test)]`):

```rust
fn decode_key32(hex64: &str) -> Result<[u8; 32], RosterError> {
    let bytes = hex::decode(hex64).map_err(|_| RosterError::Field("hex"))?;
    bytes.try_into().map_err(|_| RosterError::Field("key length"))
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
    key.verify(&canonical_bytes(&Value::Object(obj.clone()))?, &sig)
        .map_err(|_| RosterError::Signature)?;

    let org_name = obj
        .get("org_name")
        .and_then(Value::as_str)
        .ok_or(RosterError::Field("org_name"))?
        .to_string();
    let members: Vec<RosterMember> = serde_json::from_value(
        obj.get("members").cloned().ok_or(RosterError::Field("members"))?,
    )
    .map_err(|e| RosterError::Json(e.to_string()))?;

    Ok(Roster {
        org_pubkey,
        org_name,
        version,
        members,
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_roster`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/adapters/org_roster.rs
git commit -m "feat(org): roster verification with anti-rollback and forward-compat"
```

---

### Task 3: Roster diff

**Files:**
- Modify: `src-tauri/src/adapters/org_roster.rs`

**Interfaces:**
- Consumes: `Roster`, `RosterMember` from Task 1.
- Produces: `RosterDiff { added: Vec<RosterMember>, removed: Vec<RosterMember> }`, `diff(old: Option<&Roster>, new: &Roster) -> RosterDiff`. Membership is keyed by `moss_peer_id` only (a renamed member is neither added nor removed; a device replace shows as one removed + one added).

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_roster::tests::diff`
Expected: compile FAIL — `diff`, `RosterDiff` not found.

- [ ] **Step 3: Write the implementation**

```rust
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
    let new_ids: std::collections::HashSet<&str> =
        new.members.iter().map(|m| m.moss_peer_id.as_str()).collect();
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_roster`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/adapters/org_roster.rs
git commit -m "feat(org): roster diff keyed by peer-id"
```

---

### Task 4: Signed envelope core (ADR 0007)

**Files:**
- Create: `src-tauri/src/adapters/org_envelope.rs`
- Modify: `src-tauri/src/adapters/mod.rs` (add `pub mod org_envelope;` after `org_roster`... alphabetical: `org_envelope` BEFORE `org_roster`)

**Interfaces:**
- Produces:
  - `OrgContext<'a> { org_pubkey: &'a str, mesh_id: &'a str, channel_kind: &'a str }`
  - `OrgSigned { payload: Vec<u8>, peer_id: String, sig: Vec<u8> }` (serde-derived; wire encoding is Plan 3's concern)
  - `sign(key: &ed25519_dalek::SigningKey, ctx: &OrgContext, payload: &[u8]) -> OrgSigned` (peer_id = hex of the verifying key)
  - `verify(env: &OrgSigned, ctx: &OrgContext) -> Result<(), EnvelopeError>`
- Signing input (length-prefixed to kill field-boundary ambiguity): `"mosh-org-v1"` then for each of [org_pubkey (utf8), mesh_id (utf8), channel_kind (utf8), payload]: u32-LE length + bytes.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/adapters/org_envelope.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[3u8; 32])
    }

    fn ctx<'a>() -> OrgContext<'a> {
        OrgContext {
            org_pubkey: "aa11",
            mesh_id: "org/acme-mesh",
            channel_kind: "org-control",
        }
    }

    #[test]
    fn sign_verify_roundtrip() {
        let env = sign(&key(), &ctx(), b"hello");
        assert_eq!(env.peer_id, hex::encode(key().verifying_key().to_bytes()));
        assert!(verify(&env, &ctx()).is_ok());
    }

    #[test]
    fn tampered_payload_fails() {
        let mut env = sign(&key(), &ctx(), b"hello");
        env.payload = b"hijack".to_vec();
        assert!(verify(&env, &ctx()).is_err());
    }

    #[test]
    fn claimed_peer_id_must_match_signer() {
        let mut env = sign(&key(), &ctx(), b"hello");
        env.peer_id = hex::encode(SigningKey::from_bytes(&[4u8; 32]).verifying_key().to_bytes());
        assert!(verify(&env, &ctx()).is_err());
    }

    #[test]
    fn cross_org_replay_fails() {
        let env = sign(&key(), &ctx(), b"join me");
        let other_org = OrgContext { org_pubkey: "bb22", ..ctx() };
        assert!(verify(&env, &other_org).is_err());
        let other_mesh = OrgContext { mesh_id: "org/evil-mesh", ..ctx() };
        assert!(verify(&env, &other_mesh).is_err());
        let other_channel = OrgContext { channel_kind: "org-blob", ..ctx() };
        assert!(verify(&env, &other_channel).is_err());
    }

    #[test]
    fn field_boundary_shift_fails() {
        // ("ab", "c") and ("a", "bc") must not produce the same signing input.
        let a = sign(&key(), &OrgContext { org_pubkey: "ab", mesh_id: "c", channel_kind: "k" }, b"p");
        let shifted = OrgContext { org_pubkey: "a", mesh_id: "bc", channel_kind: "k" };
        assert!(verify(&a, &shifted).is_err());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_envelope`
Expected: compile FAIL after adding `pub mod org_envelope;` to `mod.rs` — types not found.

- [ ] **Step 3: Write the implementation**

Prepend:

```rust
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

const DOMAIN: &[u8] = b"mosh-org-v1";

#[derive(Debug, Clone, Copy)]
pub struct OrgContext<'a> {
    pub org_pubkey: &'a str,
    pub mesh_id: &'a str,
    pub channel_kind: &'a str,
}

/// App-level sender authentication over the unauthenticated gossip path
/// (ADR 0007). The moss node key signs; its public key IS the peer-id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgSigned {
    pub payload: Vec<u8>,
    pub peer_id: String,
    pub sig: Vec<u8>,
}

#[derive(Debug)]
pub enum EnvelopeError {
    BadPeerId,
    BadSignature,
}

impl std::fmt::Display for EnvelopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadPeerId => write!(f, "envelope peer_id is not a valid ed25519 key"),
            Self::BadSignature => write!(f, "envelope signature invalid for context"),
        }
    }
}

impl std::error::Error for EnvelopeError {}

fn signing_input(ctx: &OrgContext, payload: &[u8]) -> Vec<u8> {
    let parts: [&[u8]; 4] = [
        ctx.org_pubkey.as_bytes(),
        ctx.mesh_id.as_bytes(),
        ctx.channel_kind.as_bytes(),
        payload,
    ];
    let mut out = Vec::with_capacity(
        DOMAIN.len() + parts.iter().map(|p| 4 + p.len()).sum::<usize>(),
    );
    out.extend_from_slice(DOMAIN);
    for part in parts {
        out.extend_from_slice(&(part.len() as u32).to_le_bytes());
        out.extend_from_slice(part);
    }
    out
}

pub fn sign(key: &SigningKey, ctx: &OrgContext, payload: &[u8]) -> OrgSigned {
    let sig = key.sign(&signing_input(ctx, payload));
    OrgSigned {
        payload: payload.to_vec(),
        peer_id: hex::encode(key.verifying_key().to_bytes()),
        sig: sig.to_bytes().to_vec(),
    }
}

pub fn verify(env: &OrgSigned, ctx: &OrgContext) -> Result<(), EnvelopeError> {
    let key_bytes: [u8; 32] = hex::decode(&env.peer_id)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or(EnvelopeError::BadPeerId)?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| EnvelopeError::BadPeerId)?;
    let sig = Signature::from_slice(&env.sig).map_err(|_| EnvelopeError::BadSignature)?;
    key.verify(&signing_input(ctx, &env.payload), &sig)
        .map_err(|_| EnvelopeError::BadSignature)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml org_envelope`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/adapters/org_envelope.rs src-tauri/src/adapters/mod.rs
git commit -m "feat(org): signed envelope with domain separation (ADR 0007)"
```

---

### Task 5: Persistence tables (org rosters + group commit log)

**Files:**
- Modify: `src-tauri/src/adapters/persistence.rs`

**Interfaces:**
- Consumes: existing `Persistence`, `put`/`get` internals, `encrypt_blob`/`decrypt_blob`.
- Produces:
  - `put_org_roster(&self, org_pubkey: &str, roster_bytes: &[u8]) -> Result<(), PersistenceError>`
  - `get_org_roster(&self, org_pubkey: &str) -> Result<Option<Vec<u8>>, PersistenceError>`
  - `list_org_rosters(&self) -> Result<Vec<(String, Vec<u8>)>, PersistenceError>` (key = org_pubkey hex, multi-org)
  - `append_group_commit(&self, group_id: &str, epoch: u64, commit: &[u8]) -> Result<(), PersistenceError>`
  - `list_group_commits_from(&self, group_id: &str, from_epoch: u64) -> Result<Vec<(u64, Vec<u8>)>, PersistenceError>` (ascending epoch order; used by Plan 2 resync). No pruning — spec Non-goals.

- [ ] **Step 1: Write the failing test**

Append to the existing `#[cfg(test)]` test module in `persistence.rs` (it uses `open_with_dek`):

```rust
    #[test]
    fn org_roster_roundtrip_multi_org() {
        let dir = tempfile::tempdir().unwrap();
        let p = Persistence::open_with_dek(&dir.path().join("t.redb"), [1u8; 32]).unwrap();
        p.put_org_roster("aa11", b"roster-a-v1").unwrap();
        p.put_org_roster("bb22", b"roster-b-v1").unwrap();
        p.put_org_roster("aa11", b"roster-a-v2").unwrap(); // overwrite = latest wins
        assert_eq!(p.get_org_roster("aa11").unwrap().unwrap(), b"roster-a-v2");
        assert_eq!(p.get_org_roster("none").unwrap(), None);
        let all = p.list_org_rosters().unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|(k, v)| k == "bb22" && v == b"roster-b-v1"));
    }

    #[test]
    fn group_commit_log_ordered_range() {
        let dir = tempfile::tempdir().unwrap();
        let p = Persistence::open_with_dek(&dir.path().join("t.redb"), [1u8; 32]).unwrap();
        p.append_group_commit("g1", 2, b"c2").unwrap();
        p.append_group_commit("g1", 10, b"c10").unwrap();
        p.append_group_commit("g1", 3, b"c3").unwrap();
        p.append_group_commit("g2", 1, b"other").unwrap();
        let commits = p.list_group_commits_from("g1", 3).unwrap();
        assert_eq!(
            commits,
            vec![(3, b"c3".to_vec()), (10, b"c10".to_vec())]
        );
        assert!(p.list_group_commits_from("g3", 0).unwrap().is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml persistence::tests::org_roster`
Expected: compile FAIL — methods not found.

- [ ] **Step 3: Write the implementation**

Add table definitions next to the existing ones (after `MOSS_IDENTITY_KEY`, `persistence.rs:72`):

```rust
const ORG_ROSTERS: TableDefinition<&str, &[u8]> = TableDefinition::new("org_rosters");
// Key: "<group_id>/<epoch:020>" — zero-padded so lexicographic order == numeric.
const GROUP_COMMIT_LOG: TableDefinition<&str, &[u8]> = TableDefinition::new("group_commit_log");
```

Open both tables in **both** constructors — `open()` (after the `MOSS_IDENTITY` line, ~`persistence.rs:138`) and `open_with_dek()` (same list in the `#[cfg(test)]` impl):

```rust
            wtx.open_table(ORG_ROSTERS)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
            wtx.open_table(GROUP_COMMIT_LOG)
                .map_err(|e| PersistenceError::Db(e.to_string()))?;
```

Add methods to `impl Persistence` (following the `put`/`get` helper style used by `put_mls_snapshot` etc.):

```rust
    pub fn put_org_roster(
        &self,
        org_pubkey: &str,
        roster_bytes: &[u8],
    ) -> Result<(), PersistenceError> {
        self.put(ORG_ROSTERS, org_pubkey, roster_bytes)
    }

    pub fn get_org_roster(&self, org_pubkey: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        self.get(ORG_ROSTERS, org_pubkey)
    }

    pub fn list_org_rosters(&self) -> Result<Vec<(String, Vec<u8>)>, PersistenceError> {
        let rtx = self
            .db
            .begin_read()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let table = rtx
            .open_table(ORG_ROSTERS)
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let mut out = Vec::new();
        for entry in table
            .iter()
            .map_err(|e| PersistenceError::Db(e.to_string()))?
        {
            let (key, value) = entry.map_err(|e| PersistenceError::Db(e.to_string()))?;
            out.push((
                key.value().to_string(),
                decrypt_blob(&self.dek, value.value())?,
            ));
        }
        Ok(out)
    }

    fn commit_log_key(group_id: &str, epoch: u64) -> String {
        format!("{group_id}/{epoch:020}")
    }

    pub fn append_group_commit(
        &self,
        group_id: &str,
        epoch: u64,
        commit: &[u8],
    ) -> Result<(), PersistenceError> {
        self.put(GROUP_COMMIT_LOG, &Self::commit_log_key(group_id, epoch), commit)
    }

    /// Commits for `group_id` with epoch >= from_epoch, ascending. Backing
    /// store for the resync path (spec §7). Never pruned in v1.
    pub fn list_group_commits_from(
        &self,
        group_id: &str,
        from_epoch: u64,
    ) -> Result<Vec<(u64, Vec<u8>)>, PersistenceError> {
        let rtx = self
            .db
            .begin_read()
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let table = rtx
            .open_table(GROUP_COMMIT_LOG)
            .map_err(|e| PersistenceError::Db(e.to_string()))?;
        let start = Self::commit_log_key(group_id, from_epoch);
        let end = format!("{group_id}/{}", "9".repeat(21)); // beyond any 20-digit epoch
        let mut out = Vec::new();
        for entry in table
            .range(start.as_str()..end.as_str())
            .map_err(|e| PersistenceError::Db(e.to_string()))?
        {
            let (key, value) = entry.map_err(|e| PersistenceError::Db(e.to_string()))?;
            let key = key.value();
            let Some(epoch_str) = key.strip_prefix(&format!("{group_id}/")) else {
                continue;
            };
            let epoch: u64 = epoch_str
                .parse()
                .map_err(|_| PersistenceError::Db(format!("bad commit log key: {key}")))?;
            out.push((epoch, decrypt_blob(&self.dek, value.value())?));
        }
        Ok(out)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml persistence`
Expected: all persistence tests pass, including the two new ones.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/adapters/persistence.rs
git commit -m "feat(org): org_rosters and group_commit_log tables"
```

---

### Task 6: MLS — identity helpers + remove by credential identity (ADR 0004)

**Files:**
- Modify: `src-tauri/src/adapters/mls_crypto.rs`

**Interfaces:**
- Consumes: existing `MlsSessionCrypto` (`new(identity)` already accepts an arbitrary string — org contexts pass the 64-hex peer-id as identity; no constructor change).
- Produces:
  - `member_identities(&self) -> Vec<String>` (utf8 of each leaf's BasicCredential identity)
  - `remove_members_by_identity(&mut self, identity: &str) -> Result<Vec<u8>, MlsCryptoError>` — removes ALL matching leaves in one commit, returns commit bytes; error if none match.

- [ ] **Step 1: Write the failing test**

Append inside `mod tests` in `mls_crypto.rs`:

```rust
    // Org groups use the moss peer-id as the credential identity (ADR 0004);
    // these tests use short fake ids — identity is an opaque string here.
    fn three_party() -> (MlsSessionCrypto, MlsSessionCrypto, MlsSessionCrypto) {
        let mut admin = MlsSessionCrypto::new("peer-admin").unwrap();
        admin.create_group().unwrap();
        let mut bob = MlsSessionCrypto::new("peer-bob").unwrap();
        let mut carol = MlsSessionCrypto::new("peer-carol").unwrap();
        let bob_kp = bob.key_package_bytes().unwrap();
        let outcome = admin.add_members(&[bob_kp.as_slice()]).unwrap();
        bob.join_welcome(&outcome.welcome_bytes, &outcome.tree_bytes)
            .unwrap();
        let carol_kp = carol.key_package_bytes().unwrap();
        let outcome = admin.add_members(&[carol_kp.as_slice()]).unwrap();
        bob.process_commit(&outcome.commit_bytes).unwrap();
        carol
            .join_welcome(&outcome.welcome_bytes, &outcome.tree_bytes)
            .unwrap();
        (admin, bob, carol)
    }

    #[test]
    fn member_identities_lists_credentials() {
        let (admin, _bob, _carol) = three_party();
        let mut ids = admin.member_identities();
        ids.sort();
        assert_eq!(ids, vec!["peer-admin", "peer-bob", "peer-carol"]);
    }

    #[test]
    fn remove_by_identity_kicks_and_advances_epoch() {
        let (mut admin, mut bob, mut carol) = three_party();
        let commit = admin.remove_members_by_identity("peer-bob").unwrap();
        carol.process_commit(&commit).unwrap();
        assert_eq!(admin.member_count(), 2);
        assert!(!admin.member_identities().contains(&"peer-bob".to_string()));

        // Post-kick traffic: carol still reads, bob cannot.
        let ct = admin.encrypt(b"after kick").unwrap();
        assert_eq!(carol.decrypt(&ct).unwrap(), b"after kick");
        assert!(bob.decrypt(&ct).is_err());
    }

    #[test]
    fn remove_by_identity_errors_when_absent() {
        let (mut admin, _bob, _carol) = three_party();
        assert!(admin.remove_members_by_identity("peer-nobody").is_err());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mls_crypto`
Expected: compile FAIL — `member_identities`, `remove_members_by_identity` not found.

- [ ] **Step 3: Write the implementation**

Add to `impl MlsSessionCrypto` (near `member_fingerprints`, `mls_crypto.rs:313`):

```rust
    fn credential_identity(credential: &Credential) -> Option<String> {
        BasicCredential::try_from(credential.clone())
            .ok()
            .map(|basic| String::from_utf8_lossy(basic.identity()).into_owned())
    }

    /// Leaf credential identities. In org contexts the identity is the moss
    /// peer-id (ADR 0004), making leaf -> member lookup direct.
    pub fn member_identities(&self) -> Vec<String> {
        let Some(group) = self.group.as_ref() else {
            return Vec::new();
        };
        group
            .members()
            .filter_map(|member| Self::credential_identity(&member.credential))
            .collect()
    }

    fn leaf_indices_matching(group: &MlsGroup, identity: &str) -> Vec<LeafNodeIndex> {
        group
            .members()
            .filter(|member| {
                Self::credential_identity(&member.credential).as_deref() == Some(identity)
            })
            .map(|member| member.index)
            .collect()
    }

    /// Remove EVERY leaf whose credential identity matches, in one commit
    /// (duplicates are legal: a rejoin can leave a stale leaf, ADR 0004).
    /// Returns the commit for broadcast to remaining members.
    pub fn remove_members_by_identity(
        &mut self,
        identity: &str,
    ) -> Result<Vec<u8>, MlsCryptoError> {
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        let targets = Self::leaf_indices_matching(group, identity);
        if targets.is_empty() {
            return Err(MlsCryptoError::OpenMls(format!(
                "no member with identity {identity}"
            )));
        }
        let (commit, _welcome, _info) = group
            .remove_members(&self.provider, &self.signer, &targets)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        commit
            .to_bytes()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))
    }
```

Note: `LeafNodeIndex` comes from `openmls::prelude::*` (already glob-imported). If `BasicCredential::try_from(Credential)` is not available in the pinned OpenMLS version, the equivalent accessor is `credential.serialized_content()` — adjust `credential_identity` only; tests stay identical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mls_crypto`
Expected: all pass (2 existing + 3 new).

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/adapters/mls_crypto.rs
git commit -m "feat(mls): remove members by credential identity (ADR 0004)"
```

---

### Task 7: MLS — replace member (Remove+Add, one commit)

**Files:**
- Modify: `src-tauri/src/adapters/mls_crypto.rs`

**Interfaces:**
- Consumes: Task 6 helpers (`leaf_indices_matching`), existing `AddOutcome`, `decode_key_package`.
- Produces: `replace_member(&mut self, identity: &str, key_package_bytes: &[u8]) -> Result<AddOutcome, MlsCryptoError>` — proposes Remove for every leaf matching `identity` plus Add of the new KeyPackage, commits once. Powers device replace (spec §8) and stale-leaf dedup at add-time (ADR 0004). If no leaf matches, it degrades to a plain Add (valid: dedup path where no stale leaf exists).

- [ ] **Step 1: Write the failing test**

Append inside `mod tests`:

```rust
    #[test]
    fn replace_member_swaps_device_in_one_commit() {
        let (mut admin, mut bob_old, mut carol) = three_party();
        // Same identity, fresh device/keys — same string as the roster entry.
        let mut bob_new = MlsSessionCrypto::new("peer-bob").unwrap();
        let kp = bob_new.key_package_bytes().unwrap();

        let outcome = admin.replace_member("peer-bob", &kp).unwrap();
        carol.process_commit(&outcome.commit_bytes).unwrap();
        bob_new
            .join_welcome(&outcome.welcome_bytes, &outcome.tree_bytes)
            .unwrap();

        // Still exactly one peer-bob leaf; group size unchanged.
        assert_eq!(admin.member_count(), 3);
        let bobs = admin
            .member_identities()
            .into_iter()
            .filter(|id| id == "peer-bob")
            .count();
        assert_eq!(bobs, 1);

        // New device sends, everyone reads; old device is dead.
        let ct = bob_new.encrypt(b"new laptop").unwrap();
        assert_eq!(admin.decrypt(&ct).unwrap(), b"new laptop");
        let ct2 = admin.encrypt(b"welcome back").unwrap();
        assert!(bob_old.decrypt(&ct2).is_err());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mls_crypto::tests::replace_member`
Expected: compile FAIL — `replace_member` not found.

- [ ] **Step 3: Write the implementation**

```rust
    /// Remove every leaf matching `identity` and add the replacement
    /// KeyPackage in a single commit (spec §8 device replace; ADR 0004
    /// add-time dedup). With no matching leaf this is a plain Add.
    pub fn replace_member(
        &mut self,
        identity: &str,
        key_package_bytes: &[u8],
    ) -> Result<AddOutcome, MlsCryptoError> {
        let key_package = self.decode_key_package(key_package_bytes)?;
        let group = self.group.as_mut().ok_or(MlsCryptoError::NotReady)?;
        for index in Self::leaf_indices_matching(group, identity) {
            group
                .propose_remove_member(&self.provider, &self.signer, index)
                .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        }
        group
            .propose_add_member(&self.provider, &self.signer, &key_package)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        let (commit, welcome, _info) = group
            .commit_to_pending_proposals(&self.provider, &self.signer)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|error| MlsCryptoError::OpenMls(error.to_string()))?;
        let welcome = welcome.ok_or_else(|| {
            MlsCryptoError::OpenMls("commit with Add produced no welcome".to_string())
        })?;
        Ok(AddOutcome {
            commit_bytes: commit
                .to_bytes()
                .map_err(|error| MlsCryptoError::Codec(error.to_string()))?,
            welcome_bytes: welcome
                .to_bytes()
                .map_err(|error| MlsCryptoError::Codec(error.to_string()))?,
            tree_bytes: group
                .export_ratchet_tree()
                .tls_serialize_detached()
                .map_err(|error| MlsCryptoError::Codec(error.to_string()))?,
        })
    }
```

Note: `propose_remove_member` / `propose_add_member` return `(MlsMessageOut, ProposalRef)` — both ignored here because the proposals are local and committed immediately by `commit_to_pending_proposals`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mls_crypto`
Expected: all pass.

- [ ] **Step 5: Full suite + push + PR**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green.

```powershell
git add src-tauri/src/adapters/mls_crypto.rs
git commit -m "feat(mls): replace member via multi-proposal Remove+Add commit"
git push -u origin feat/org-roster-core
gh pr create --title "feat(org): roster core, signed envelope, MLS kick/replace" --body "Build-order steps 1-3 of docs/superpowers/specs/2026-07-12-org-roster-design.md (ADRs 0004-0007). Pure modules + persistence tables + MLS ops; no runtime wiring yet."
```

---

## Deferred to Plan 2 (resync) and Plan 3 (runtime + UI)

- Plan 2: commit-log capture wiring in `private_group_runtime.rs`, `ResyncRequest`/`ResyncResponse`, out-of-order epoch buffer, roster-version commit buffer (ADR 0005), fresh-state rejoin fallback.
- Plan 3: `org_runtime.rs` (mesh, bundle URI, roster gossip, join flow, confirmation-code UI), DM bootstrap, org-group binding, manual-add/auto-kick wiring (ADR 0008), UI, `moss_identity` key extraction for envelope signing (or `Moss_Sign` FFI fallback).
