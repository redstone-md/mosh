//! Organization runtime (spec §3): one moss node per joined org, roster
//! gossip on `org-control/<mesh_id>`, and the member side of the join flow.
//! The org itself is a signed document, not a server — this runtime only
//! verifies and reacts; all authority lives in the roster signature.

use std::collections::HashMap;
use std::sync::Arc;

use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};

use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, MossFfiRuntime, MossNode, MossNodeConfig,
};
use crate::adapters::org_envelope::{self, OrgContext, OrgSigned};
use crate::adapters::org_roster::{self, Roster, RosterError};
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
pub struct OrgGroupOfferView {
    pub offer_id: String,
    pub from_peer_id: String,
    pub from_name: String,
    pub group_label: Option<String>,
    pub group_invite_uri: String,
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
    pub group_offers: Vec<OrgGroupOfferView>,
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
    /// Roster-driven DM bootstrap (spec §4): carries a regular DM invite URI
    /// so both sides land in the existing create/accept machinery. Accepted
    /// only from verified roster members, accept-once by `offer_id`.
    DmOffer {
        offer_id: String,
        target_peer_id: String,
        from_name: String,
        invite_uri: String,
    },
    /// Invitation into an org-bound group (spec §5): only roster members
    /// receive offers; the invite URI feeds the normal group join flow.
    GroupOffer {
        offer_id: String,
        target_peer_id: String,
        from_name: String,
        group_label: Option<String>,
        group_invite_uri: String,
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
    listen_port: u16,
    static_peer: Option<String>,
    node: MossNode,
    control_channel: String,
    signer: SigningKey,
    own_peer_id: String,
    roster: Option<Roster>,
    /// The exact verified bytes behind `roster` — republished verbatim so
    /// the org signature stays valid (re-serializing could reorder fields).
    roster_bytes: Option<Vec<u8>>,
    dm_offers: Vec<OrgDmOfferView>,
    group_offers: Vec<OrgGroupOfferView>,
    dm_links: Vec<OrgDmLink>,
    seen_offer_ids: std::collections::HashSet<String>,
    pending_removals: Vec<String>,
    #[cfg(test)]
    roster_publishes: u32,
}

impl OrgSession {
    fn to_record(&self) -> PersistedOrgRecord {
        PersistedOrgRecord {
            org_pubkey: self.org_pubkey.clone(),
            org_name: self.org_name.clone(),
            mesh_id: self.mesh_id.clone(),
            display_name: self.display_name.clone(),
            listen_port: self.listen_port,
            static_peer: self.static_peer.clone(),
            dm_links: self.dm_links.clone(),
        }
    }

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
            group_offers: self.group_offers.clone(),
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

    /// Broadcast our verified roster bytes verbatim (self-authenticating,
    /// travels bare — ADR 0007). Serves newcomers and lagging peers.
    fn publish_roster(&mut self) {
        #[cfg(test)]
        {
            self.roster_publishes += 1;
        }
        let Some(bytes) = self.roster_bytes.as_ref() else {
            return;
        };
        let wire = OrgWire::Roster {
            roster_b64: encode(bytes),
        };
        let Ok(payload) = serde_json::to_vec(&wire) else {
            return;
        };
        if let Err(error) = self.node.publish(&self.control_channel, &payload) {
            eprintln!("org roster publish failed for {}: {error}", self.org_pubkey);
        }
    }

    /// One inbound frame from `org-control/<mesh_id>`. Never fails the
    /// caller: bad frames are logged and dropped (spec Error handling).
    fn ingest_payload(&mut self, persistence: Option<&Persistence>, payload: &[u8]) {
        let wire: OrgWire = match serde_json::from_slice(payload) {
            Ok(wire) => wire,
            Err(_) => return,
        };
        match wire {
            OrgWire::Roster { roster_b64 } => {
                let Ok(bytes) = decode(&roster_b64) else {
                    return;
                };
                self.absorb_roster_bytes(persistence, &bytes);
            }
            OrgWire::Signed {
                payload_b64,
                peer_id,
                sig_b64,
            } => {
                let (Ok(inner), Ok(sig)) = (decode(&payload_b64), decode(&sig_b64)) else {
                    return;
                };
                let env = OrgSigned {
                    payload: inner,
                    peer_id,
                    sig,
                };
                if org_envelope::verify(&env, &self.ctx()).is_err() {
                    eprintln!("org envelope verify failed on {}", self.control_channel);
                    return;
                }
                let message: OrgMessage = match serde_json::from_slice(&env.payload) {
                    Ok(message) => message,
                    Err(_) => return,
                };
                self.handle_message(&env.peer_id, message);
            }
        }
    }

    /// Sender-auth rule: `Hello` is exempt from the roster gate (it is by
    /// definition sent by not-yet-members; the envelope still proves key
    /// possession, and the membership decision is the admin CLI's). Every
    /// other message requires the verified sender to be a roster member.
    fn handle_message(&mut self, sender_peer_id: &str, message: OrgMessage) {
        match message {
            OrgMessage::Hello { .. } => {
                if sender_peer_id != self.own_peer_id {
                    // Serve the roster to whoever just arrived.
                    self.publish_roster();
                }
            }
            OrgMessage::DmOffer {
                offer_id,
                target_peer_id,
                from_name,
                invite_uri,
            } => {
                if target_peer_id != self.own_peer_id {
                    return;
                }
                if !self.sender_in_roster(sender_peer_id) {
                    eprintln!("org dm offer from non-member dropped: {sender_peer_id}");
                    return;
                }
                // Accept-once: gossip redelivers, and a replayed offer must
                // not resurface after accept/dismiss (spec replay handling).
                if !self.seen_offer_ids.insert(offer_id.clone()) {
                    return;
                }
                self.dm_offers.push(OrgDmOfferView {
                    offer_id,
                    from_peer_id: sender_peer_id.to_string(),
                    from_name,
                    invite_uri,
                });
            }
            OrgMessage::GroupOffer {
                offer_id,
                target_peer_id,
                from_name,
                group_label,
                group_invite_uri,
            } => {
                if target_peer_id != self.own_peer_id {
                    return;
                }
                if !self.sender_in_roster(sender_peer_id) {
                    eprintln!("org group offer from non-member dropped: {sender_peer_id}");
                    return;
                }
                if !self.seen_offer_ids.insert(offer_id.clone()) {
                    return;
                }
                self.group_offers.push(OrgGroupOfferView {
                    offer_id,
                    from_peer_id: sender_peer_id.to_string(),
                    from_name,
                    group_label,
                    group_invite_uri,
                });
            }
        }
    }

    fn sender_in_roster(&self, sender_peer_id: &str) -> bool {
        self.roster
            .as_ref()
            .is_some_and(|r| r.members.iter().any(|m| m.moss_peer_id == sender_peer_id))
    }

    fn absorb_roster_bytes(&mut self, persistence: Option<&Persistence>, bytes: &[u8]) {
        let stored_version = self.roster.as_ref().map(|r| r.version);
        match org_roster::verify(bytes, &self.org_pubkey, stored_version) {
            Ok(roster) => {
                let removed: Vec<String> = org_roster::diff(self.roster.as_ref(), &roster)
                    .removed
                    .into_iter()
                    .map(|m| m.moss_peer_id)
                    .collect();
                self.pending_removals.extend(removed);
                if let Some(p) = persistence {
                    if let Err(error) = p.put_org_roster(&self.org_pubkey, bytes) {
                        eprintln!("org roster persist failed: {error}");
                    }
                }
                self.roster = Some(roster);
                self.roster_bytes = Some(bytes.to_vec());
            }
            Err(RosterError::Rollback { stored, received }) if received < stored => {
                // The sender is behind — serve them our newer roster.
                // `received == stored` is a plain duplicate broadcast and is
                // dropped silently to avoid re-broadcast ping-pong.
                self.publish_roster();
            }
            Err(RosterError::Rollback { .. }) => {}
            Err(error) => {
                eprintln!("org roster rejected for {}: {error}", self.org_pubkey);
            }
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

fn decode(encoded: &str) -> Result<Vec<u8>, OrgError> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| OrgError::Codec(e.to_string()))
}

fn random_id() -> Result<String, OrgError> {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| OrgError::Codec(e.to_string()))?;
    Ok(hex::encode(bytes))
}

fn upsert_link(links: &mut Vec<OrgDmLink>, peer_id: &str, session_id: Option<String>) {
    if let Some(link) = links.iter_mut().find(|link| link.peer_id == peer_id) {
        // Never downgrade a known session id back to None on a re-offer.
        if session_id.is_some() {
            link.session_id = session_id;
        }
        return;
    }
    links.push(OrgDmLink {
        peer_id: peer_id.to_string(),
        session_id,
    });
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
        self.drain_inbound();
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
        self.drain_inbound();
        let mut out: Vec<OrgSnapshot> = self.orgs.values().map(OrgSession::snapshot).collect();
        out.sort_by(|a, b| a.org_name.cmp(&b.org_name));
        out
    }

    /// Offer a DM to a roster member: lib.rs creates the invite via the DM
    /// runtime first, then routes the URI here. The link is recorded
    /// immediately so the sender's UI can navigate before the session id is
    /// known; `link_dm` fills it in.
    pub fn send_dm_offer(
        &mut self,
        org_pubkey: &str,
        target_peer_id: &str,
        invite_uri: &str,
    ) -> Result<(), OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        let message = OrgMessage::DmOffer {
            offer_id: random_id()?,
            target_peer_id: target_peer_id.to_string(),
            from_name: session.display_name.clone(),
            invite_uri: invite_uri.to_string(),
        };
        publish_signed(session, &message)?;
        upsert_link(&mut session.dm_links, target_peer_id, None);
        let record = session.to_record();
        self.persist_record(&record)
    }

    /// Consume a pending offer; the returned view carries the invite URI
    /// for the DM runtime's accept path and the peer to link afterwards.
    pub fn accept_dm_offer(
        &mut self,
        org_pubkey: &str,
        offer_id: &str,
    ) -> Result<OrgDmOfferView, OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        let position = session
            .dm_offers
            .iter()
            .position(|offer| offer.offer_id == offer_id)
            .ok_or_else(|| OrgError::Codec(format!("unknown dm offer {offer_id}")))?;
        let offer = session.dm_offers.remove(position);
        upsert_link(&mut session.dm_links, &offer.from_peer_id, None);
        let record = session.to_record();
        self.persist_record(&record)?;
        Ok(offer)
    }

    /// Offer an org-bound group to a roster member over org-control.
    pub fn send_group_offer(
        &mut self,
        org_pubkey: &str,
        target_peer_id: &str,
        group_invite_uri: &str,
        group_label: Option<String>,
    ) -> Result<(), OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        let message = OrgMessage::GroupOffer {
            offer_id: random_id()?,
            target_peer_id: target_peer_id.to_string(),
            from_name: session.display_name.clone(),
            group_label,
            group_invite_uri: group_invite_uri.to_string(),
        };
        publish_signed(session, &message)
    }

    /// Consume a pending group offer; the view carries the invite URI for
    /// the group runtime's join path.
    pub fn accept_group_offer(
        &mut self,
        org_pubkey: &str,
        offer_id: &str,
    ) -> Result<OrgGroupOfferView, OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        let position = session
            .group_offers
            .iter()
            .position(|offer| offer.offer_id == offer_id)
            .ok_or_else(|| OrgError::Codec(format!("unknown group offer {offer_id}")))?;
        Ok(session.group_offers.remove(position))
    }

    pub fn dismiss_group_offer(
        &mut self,
        org_pubkey: &str,
        offer_id: &str,
    ) -> Result<(), OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        session
            .group_offers
            .retain(|offer| offer.offer_id != offer_id);
        Ok(())
    }

    pub fn dismiss_dm_offer(&mut self, org_pubkey: &str, offer_id: &str) -> Result<(), OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        session.dm_offers.retain(|offer| offer.offer_id != offer_id);
        Ok(())
    }

    /// Attach the DM session id to an org link once the DM runtime created
    /// or accepted the session. Links are never deleted on revocation — the
    /// DM outlives org membership (spec §6), the UI just badges it.
    pub fn link_dm(
        &mut self,
        org_pubkey: &str,
        peer_id: &str,
        session_id: &str,
    ) -> Result<(), OrgError> {
        let session = self
            .orgs
            .get_mut(org_pubkey)
            .ok_or_else(|| OrgError::NotJoined(org_pubkey.to_string()))?;
        upsert_link(&mut session.dm_links, peer_id, Some(session_id.to_string()));
        let record = session.to_record();
        self.persist_record(&record)
    }

    /// Peer-ids removed by roster updates since the last call — the caller
    /// (lib.rs) feeds these to the group runtime for the crypto kick
    /// (ADR 0008); draining keeps the kick one-shot per removal.
    pub fn take_pending_removals(&mut self, org_pubkey: &str) -> Vec<String> {
        self.orgs
            .get_mut(org_pubkey)
            .map(|s| std::mem::take(&mut s.pending_removals))
            .unwrap_or_default()
    }

    fn drain_inbound(&mut self) {
        let inbound =
            drain_messages_where(|message| message.channel.starts_with(ORG_CONTROL_PREFIX));
        for message in inbound {
            let persistence = self.persistence.clone();
            if let Some(session) = self
                .orgs
                .values_mut()
                .find(|s| s.control_channel == message.channel)
            {
                session.ingest_payload(persistence.as_deref(), &message.payload);
            }
        }
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
        let (roster, roster_bytes) = self
            .load_roster(&record.org_pubkey)
            .map(|(r, b)| (Some(r), Some(b)))
            .unwrap_or((None, None));
        OrgSession {
            control_channel: format!("{ORG_CONTROL_PREFIX}{}", record.mesh_id),
            org_pubkey: record.org_pubkey,
            org_name: record.org_name,
            mesh_id: record.mesh_id,
            display_name: record.display_name,
            listen_port: record.listen_port,
            static_peer: record.static_peer,
            node,
            signer,
            own_peer_id,
            roster,
            roster_bytes,
            dm_offers: Vec::new(),
            group_offers: Vec::new(),
            dm_links: record.dm_links,
            seen_offer_ids: std::collections::HashSet::new(),
            pending_removals: Vec::new(),
            #[cfg(test)]
            roster_publishes: 0,
        }
    }

    /// Re-verify the self-stored roster bytes. `stored_version: None` because
    /// the stored copy IS the reference version.
    fn load_roster(&self, org_pubkey: &str) -> Option<(Roster, Vec<u8>)> {
        let p = self.persistence.as_ref()?;
        let bytes = p.get_org_roster(org_pubkey).ok()??;
        let roster = org_roster::verify(&bytes, org_pubkey, None).ok()?;
        Some((roster, bytes))
    }

    fn signing_key(&self) -> Result<SigningKey, OrgError> {
        let p = self
            .persistence
            .as_ref()
            .ok_or(OrgError::IdentityUnavailable)?;
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

    /// Deterministic inbound injection for tests — same code path as
    /// `drain_inbound` without depending on gossip delivery timing.
    #[cfg(test)]
    fn ingest_for_test(&mut self, org_pubkey: &str, payload: &[u8]) {
        let persistence = self.persistence.clone();
        if let Some(session) = self.orgs.get_mut(org_pubkey) {
            session.ingest_payload(persistence.as_deref(), payload);
        }
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
#[path = "org_runtime_tests.rs"]
mod tests;
