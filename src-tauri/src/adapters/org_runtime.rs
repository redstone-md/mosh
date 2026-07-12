//! Organization runtime (spec §3): one moss node per joined org, roster
//! gossip on `org-control/<mesh_id>`, and the member side of the join flow.
//! The org itself is a signed document, not a server — this runtime only
//! verifies and reacts; all authority lives in the roster signature.

use std::collections::HashMap;
use std::sync::Arc;

use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};

use crate::adapters::moss_ffi::{clear_event_log, MossFfiRuntime, MossNode, MossNodeConfig};
use crate::adapters::org_envelope::{self, OrgContext};
use crate::adapters::org_roster::Roster;
use crate::adapters::org_signing;
use crate::adapters::persistence::Persistence;

const ORG_CONTROL_PREFIX: &str = "org-control/";
const ORG_CHANNEL_KIND: &str = "org-control";
const ORG_BUNDLE_PREFIX: &str = "mosh://org";

#[derive(Debug, Clone, Deserialize)]
pub struct JoinOrgRequest {
    pub bundle_uri: String,
    pub display_name: String,
    pub listen_port: u16,
    pub static_peer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrgMemberView {
    pub moss_peer_id: String,
    pub name: String,
    pub role: String,
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrgDmOfferView {
    pub offer_id: String,
    pub from_peer_id: String,
    pub from_name: String,
    pub invite_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgDmLink {
    pub peer_id: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrgSnapshot {
    pub org_pubkey: String,
    pub org_name: String,
    pub mesh_id: String,
    pub own_peer_id: String,
    pub confirmation_code: String,
    pub in_roster: bool,
    pub roster_version: Option<u64>,
    pub members: Vec<OrgMemberView>,
    pub dm_offers: Vec<OrgDmOfferView>,
    pub dm_links: Vec<OrgDmLink>,
}

#[derive(Debug)]
pub enum OrgError {
    InvalidBundle(String),
    Duplicate(String),
    NotJoined(String),
    IdentityUnavailable,
    Moss(String),
    Persistence(String),
    Codec(String),
}

impl std::fmt::Display for OrgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidBundle(why) => write!(f, "invalid org bundle: {why}"),
            Self::Duplicate(org) => write!(f, "already joined org {org}"),
            Self::NotJoined(org) => write!(f, "not joined to org {org}"),
            Self::IdentityUnavailable => {
                write!(f, "moss identity unavailable; cannot sign org messages")
            }
            Self::Moss(e) => write!(f, "moss error: {e}"),
            Self::Persistence(e) => write!(f, "persistence error: {e}"),
            Self::Codec(e) => write!(f, "codec error: {e}"),
        }
    }
}

impl std::error::Error for OrgError {}

/// `mosh://org?mesh=<org_mesh_id>&name=<label>#org=<org_pubkey_64hex>`.
/// The fragment carries the trust anchor, the query only routing — same
/// split as DM invites, so a logged/leaked URL without its fragment does
/// not identify the org key.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedOrgBundle {
    pub org_pubkey: String,
    pub org_name: String,
    pub mesh_id: String,
}

impl ParsedOrgBundle {
    pub fn parse(uri: &str) -> Result<Self, OrgError> {
        if !uri.starts_with(ORG_BUNDLE_PREFIX) {
            return Err(OrgError::InvalidBundle("not a mosh://org URI".into()));
        }
        let url =
            url::Url::parse(uri).map_err(|e| OrgError::InvalidBundle(format!("parse: {e}")))?;
        let mesh_id = query(&url, "mesh")?;
        let org_name = query(&url, "name")?;
        let fragment = url
            .fragment()
            .ok_or_else(|| OrgError::InvalidBundle("missing #org fragment".into()))?;
        let org_pubkey = fragment
            .strip_prefix("org=")
            .ok_or_else(|| OrgError::InvalidBundle("fragment is not org=<pubkey>".into()))?
            .to_ascii_lowercase();
        if org_pubkey.len() != 64 || !org_pubkey.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(OrgError::InvalidBundle(
                "org pubkey must be 64 hex chars".into(),
            ));
        }
        Ok(Self {
            org_pubkey,
            org_name,
            mesh_id,
        })
    }
}

fn query(url: &url::Url, key: &str) -> Result<String, OrgError> {
    url.query_pairs()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| OrgError::InvalidBundle(format!("missing {key}")))
}

/// Everything on the org control channel. `Roster` travels bare — it is
/// self-authenticating (org signature + anti-rollback). Every other message
/// rides inside `OrgSigned` (ADR 0007).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum OrgWire {
    Roster {
        roster_b64: String,
    },
    Signed {
        payload_b64: String,
        peer_id: String,
        sig_b64: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
enum OrgMessage {
    Hello {
        moss_peer_id: String,
        display_name: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedOrgRecord {
    org_pubkey: String,
    org_name: String,
    mesh_id: String,
    display_name: String,
    listen_port: u16,
    static_peer: Option<String>,
    #[serde(default)]
    dm_links: Vec<OrgDmLink>,
}

struct OrgSession {
    org_pubkey: String,
    org_name: String,
    mesh_id: String,
    display_name: String,
    node: MossNode,
    control_channel: String,
    signer: SigningKey,
    own_peer_id: String,
    roster: Option<Roster>,
    dm_offers: Vec<OrgDmOfferView>,
    dm_links: Vec<OrgDmLink>,
    pending_removals: Vec<String>,
}

impl OrgSession {
    fn in_roster(&self) -> bool {
        self.roster
            .as_ref()
            .is_some_and(|r| r.members.iter().any(|m| m.moss_peer_id == self.own_peer_id))
    }

    fn snapshot(&self) -> OrgSnapshot {
        OrgSnapshot {
            org_pubkey: self.org_pubkey.clone(),
            org_name: self.org_name.clone(),
            mesh_id: self.mesh_id.clone(),
            own_peer_id: self.own_peer_id.clone(),
            confirmation_code: org_signing::confirmation_code(&self.own_peer_id),
            in_roster: self.in_roster(),
            roster_version: self.roster.as_ref().map(|r| r.version),
            members: self
                .roster
                .as_ref()
                .map(|r| {
                    r.members
                        .iter()
                        .map(|m| OrgMemberView {
                            moss_peer_id: m.moss_peer_id.clone(),
                            name: m.name.clone(),
                            role: m.role.clone(),
                            is_self: m.moss_peer_id == self.own_peer_id,
                        })
                        .collect()
                })
                .unwrap_or_default(),
            dm_offers: self.dm_offers.clone(),
            dm_links: self.dm_links.clone(),
        }
    }

    fn ctx(&self) -> OrgContext<'_> {
        OrgContext {
            org_pubkey: &self.org_pubkey,
            mesh_id: &self.mesh_id,
            channel_kind: ORG_CHANNEL_KIND,
        }
    }

    /// Announce ourselves to whoever holds the roster. Failures are
    /// non-fatal: the hello re-fires on every poll until we appear in the
    /// roster, which doubles as the retry loop.
    fn publish_hello(&self) {
        let message = OrgMessage::Hello {
            moss_peer_id: self.own_peer_id.clone(),
            display_name: self.display_name.clone(),
        };
        if let Err(error) = publish_signed(self, &message) {
            eprintln!("org hello publish failed for {}: {error}", self.org_pubkey);
        }
    }
}

fn publish_signed(session: &OrgSession, message: &OrgMessage) -> Result<(), OrgError> {
    let payload = serde_json::to_vec(message).map_err(|e| OrgError::Codec(e.to_string()))?;
    let env = org_envelope::sign(&session.signer, &session.ctx(), &payload);
    let wire = OrgWire::Signed {
        payload_b64: encode(&env.payload),
        peer_id: env.peer_id,
        sig_b64: encode(&env.sig),
    };
    let bytes = serde_json::to_vec(&wire).map_err(|e| OrgError::Codec(e.to_string()))?;
    session
        .node
        .publish(&session.control_channel, &bytes)
        .map_err(|e| OrgError::Moss(e.to_string()))
}

fn encode(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

pub struct OrgRuntime {
    moss: Arc<MossFfiRuntime>,
    persistence: Option<Arc<Persistence>>,
    orgs: HashMap<String, OrgSession>,
}

impl OrgRuntime {
    pub fn from_shared(moss: Arc<MossFfiRuntime>, persistence: Option<Arc<Persistence>>) -> Self {
        Self {
            moss,
            persistence,
            orgs: HashMap::new(),
        }
    }

    pub fn join_org(&mut self, request: JoinOrgRequest) -> Result<OrgSnapshot, OrgError> {
        let bundle = ParsedOrgBundle::parse(&request.bundle_uri)?;
        if self.orgs.contains_key(&bundle.org_pubkey) {
            return Err(OrgError::Duplicate(bundle.org_pubkey));
        }
        let node = self.start_node(&bundle.mesh_id, request.listen_port, &request.static_peer)?;
        // Read AFTER node start: on a truly fresh install the keystore only
        // receives the identity when the first node comes up.
        let signer = self.signing_key()?;
        let record = PersistedOrgRecord {
            org_pubkey: bundle.org_pubkey.clone(),
            org_name: bundle.org_name.clone(),
            mesh_id: bundle.mesh_id.clone(),
            display_name: request.display_name.clone(),
            listen_port: request.listen_port,
            static_peer: request.static_peer.clone(),
            dm_links: Vec::new(),
        };
        self.persist_record(&record)?;
        let session = self.build_session(record, node, signer);
        session.publish_hello();
        let snapshot = session.snapshot();
        self.orgs.insert(session.org_pubkey.clone(), session);
        Ok(snapshot)
    }

    pub fn leave_org(&mut self, org_pubkey: &str) -> Result<(), OrgError> {
        self.orgs
            .remove(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        if let Some(p) = self.persistence.as_ref() {
            p.delete_org(org_pubkey)
                .map_err(|e| OrgError::Persistence(e.to_string()))?;
        }
        Ok(())
    }

    pub fn poll(&mut self, org_pubkey: &str) -> Result<OrgSnapshot, OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        if !session.in_roster() {
            session.publish_hello();
        }
        Ok(session.snapshot())
    }

    pub fn list(&mut self) -> Vec<OrgSnapshot> {
        let mut out: Vec<OrgSnapshot> = self.orgs.values().map(OrgSession::snapshot).collect();
        out.sort_by(|a, b| a.org_name.cmp(&b.org_name));
        out
    }

    /// Restart sessions for every persisted org record. Individual failures
    /// (e.g. a port in use) skip that org rather than aborting startup.
    pub fn rehydrate(&mut self) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let rows = match p.list_org_records() {
            Ok(rows) => rows,
            Err(_) => return,
        };
        for (_key, bytes) in rows {
            let record: PersistedOrgRecord = match serde_json::from_slice(&bytes) {
                Ok(record) => record,
                Err(_) => continue,
            };
            if self.orgs.contains_key(&record.org_pubkey) {
                continue;
            }
            let Ok(node) =
                self.start_node(&record.mesh_id, record.listen_port, &record.static_peer)
            else {
                continue;
            };
            let Ok(signer) = self.signing_key() else {
                continue;
            };
            let session = self.build_session(record, node, signer);
            self.orgs.insert(session.org_pubkey.clone(), session);
        }
    }

    fn build_session(
        &self,
        record: PersistedOrgRecord,
        node: MossNode,
        signer: SigningKey,
    ) -> OrgSession {
        let own_peer_id = org_signing::peer_id_hex(&signer);
        let roster = self.load_roster(&record.org_pubkey);
        OrgSession {
            control_channel: format!("{ORG_CONTROL_PREFIX}{}", record.mesh_id),
            org_pubkey: record.org_pubkey,
            org_name: record.org_name,
            mesh_id: record.mesh_id,
            display_name: record.display_name,
            node,
            signer,
            own_peer_id,
            roster,
            dm_offers: Vec::new(),
            dm_links: record.dm_links,
            pending_removals: Vec::new(),
        }
    }

    /// Re-verify the self-stored roster bytes. `stored_version: None` because
    /// the stored copy IS the reference version.
    fn load_roster(&self, org_pubkey: &str) -> Option<Roster> {
        let p = self.persistence.as_ref()?;
        let bytes = p.get_org_roster(org_pubkey).ok()??;
        crate::adapters::org_roster::verify(&bytes, org_pubkey, None).ok()
    }

    fn signing_key(&self) -> Result<SigningKey, OrgError> {
        let p = self.persistence.as_ref().ok_or(OrgError::IdentityUnavailable)?;
        let blob = p
            .get_moss_identity()
            .map_err(|e| OrgError::Persistence(e.to_string()))?
            .ok_or(OrgError::IdentityUnavailable)?;
        org_signing::signing_key_from_identity(&blob).map_err(|_| OrgError::IdentityUnavailable)
    }

    fn persist_record(&self, record: &PersistedOrgRecord) -> Result<(), OrgError> {
        let Some(p) = self.persistence.as_ref() else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(record).map_err(|e| OrgError::Codec(e.to_string()))?;
        p.put_org_record(&record.org_pubkey, &bytes)
            .map_err(|e| OrgError::Persistence(e.to_string()))
    }

    fn start_node(
        &self,
        mesh_id: &str,
        listen_port: u16,
        static_peer: &Option<String>,
    ) -> Result<MossNode, OrgError> {
        let node = self
            .moss
            .init_default_node(
                mesh_id,
                &MossNodeConfig {
                    listen_port,
                    static_peer: static_peer.clone(),
                    bind_interface: None,
                },
            )
            .map_err(|e| OrgError::Moss(e.to_string()))?;
        node.set_message_callback()
            .map_err(|e| OrgError::Moss(e.to_string()))?;
        node.set_event_callback()
            .map_err(|e| OrgError::Moss(e.to_string()))?;
        clear_event_log();
        node.start().map_err(|e| OrgError::Moss(e.to_string()))?;
        node.subscribe(&format!("{ORG_CONTROL_PREFIX}{mesh_id}"))
            .map_err(|e| OrgError::Moss(e.to_string()))?;
        Ok(node)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::moss_ffi::{drain_received_messages, MOSS_TEST_LOCK};
    use std::path::PathBuf;

    const ORG_KEY_HEX: &str =
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn bundle(mesh: &str) -> String {
        format!("mosh://org?mesh={mesh}&name=acme#org={ORG_KEY_HEX}")
    }

    fn identity_blob(seed: [u8; 32]) -> Vec<u8> {
        let key = SigningKey::from_bytes(&seed);
        let mut blob = vec![1u8];
        blob.extend_from_slice(&seed);
        blob.extend_from_slice(&key.verifying_key().to_bytes());
        blob.extend_from_slice(&[0u8; 64]);
        blob
    }

    fn temp_persistence(tag: &str, seed: [u8; 32]) -> (Arc<Persistence>, PathBuf) {
        let mut path = std::env::temp_dir();
        path.push(format!("mosh-org-rt-{tag}-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = Persistence::open_with_dek(&path, [9u8; 32]).expect("store should open");
        p.put_moss_identity(&identity_blob(seed)).unwrap();
        (Arc::new(p), path)
    }

    #[test]
    fn parses_bundle_uri() {
        let parsed = ParsedOrgBundle::parse(&bundle("orgmesh-1")).unwrap();
        assert_eq!(parsed.mesh_id, "orgmesh-1");
        assert_eq!(parsed.org_name, "acme");
        assert_eq!(parsed.org_pubkey, ORG_KEY_HEX);
    }

    #[test]
    fn rejects_bad_bundles() {
        for bad in [
            "mosh://org?mesh=m&name=x#org=zz",
            &format!("mosh://org?name=x#org={ORG_KEY_HEX}"),
            &format!("mosh://org?mesh=m#org={ORG_KEY_HEX}"),
            &format!("https://org?mesh=m&name=x#org={ORG_KEY_HEX}"),
            "mosh://org?mesh=m&name=x",
            &format!("mosh://org?mesh=m&name=x#{ORG_KEY_HEX}"),
        ] {
            assert!(ParsedOrgBundle::parse(bad).is_err(), "accepted: {bad}");
        }
    }

    #[test]
    fn join_persists_record_and_reports_confirmation_code() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let seed = [42u8; 32];
        let (persistence, path) = temp_persistence("join", seed);
        let moss = Arc::new(MossFfiRuntime::load_default().expect("moss should load"));
        let mut runtime = OrgRuntime::from_shared(Arc::clone(&moss), Some(persistence.clone()));

        let snapshot = runtime
            .join_org(JoinOrgRequest {
                bundle_uri: bundle("orgmesh-join"),
                display_name: "Alice".into(),
                listen_port: 42310,
                static_peer: None,
            })
            .expect("join should succeed");

        let expected_peer = org_signing::peer_id_hex(&SigningKey::from_bytes(&seed));
        assert_eq!(snapshot.own_peer_id, expected_peer);
        assert_eq!(
            snapshot.confirmation_code,
            org_signing::confirmation_code(&expected_peer)
        );
        assert!(!snapshot.in_roster);
        assert!(snapshot.members.is_empty());
        assert!(persistence.get_org_record(ORG_KEY_HEX).unwrap().is_some());

        // Same org twice = duplicate.
        assert!(matches!(
            runtime.join_org(JoinOrgRequest {
                bundle_uri: bundle("orgmesh-join"),
                display_name: "Alice".into(),
                listen_port: 42311,
                static_peer: None,
            }),
            Err(OrgError::Duplicate(_))
        ));

        runtime.leave_org(ORG_KEY_HEX).expect("leave should work");
        assert!(persistence.get_org_record(ORG_KEY_HEX).unwrap().is_none());
        assert!(matches!(
            runtime.poll(ORG_KEY_HEX),
            Err(OrgError::NotJoined(_))
        ));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rehydrate_restores_sessions_from_records() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let (persistence, path) = temp_persistence("rehydrate", [43u8; 32]);
        let moss = Arc::new(MossFfiRuntime::load_default().expect("moss should load"));
        {
            let mut runtime =
                OrgRuntime::from_shared(Arc::clone(&moss), Some(persistence.clone()));
            runtime
                .join_org(JoinOrgRequest {
                    bundle_uri: bundle("orgmesh-re"),
                    display_name: "Alice".into(),
                    listen_port: 42320,
                    static_peer: None,
                })
                .expect("join should succeed");
        }

        let mut revived = OrgRuntime::from_shared(moss, Some(persistence));
        revived.rehydrate();
        let listing = revived.list();
        assert_eq!(listing.len(), 1);
        assert_eq!(listing[0].org_pubkey, ORG_KEY_HEX);
        assert_eq!(listing[0].org_name, "acme");

        let _ = std::fs::remove_file(&path);
    }
}
