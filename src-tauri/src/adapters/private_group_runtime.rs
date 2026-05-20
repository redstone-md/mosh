use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::adapters::attachment_runtime::{
    AttachmentManifest, AttachmentRuntime, ChunkFrame, ChunkOutcome, ChunkRequest, StreamRange,
    CHUNK_SIZE,
};
use crate::adapters::attachment_store::AttachmentStore;
use crate::adapters::mls_crypto::{MlsCryptoError, MlsSessionCrypto};
use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};
use crate::adapters::private_dm_runtime::{
    AttachmentDescriptor, AttachmentSendResult, AttachmentState, AttachmentView, DmOffer, MeshInfo,
    SnapshotEvent, VoiceMeta,
};

const CONTROL_CHANNEL_PREFIX: &str = "group-control/";
const DATA_CHANNEL_PREFIX: &str = "group-data/";
const BLOB_CHANNEL_PREFIX: &str = "group-blob/";
const INVITE_PREFIX: &str = "mosh://group";
const MAX_LABEL_LEN: usize = 64;
const MAX_BODY_LEN: usize = 4096;
const DEDUP_BUFFER_CAP: usize = 4096;
const INVITE_FINGERPRINT_LEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGroupRequest {
    pub label: Option<String>,
    pub display_name: String,
    pub listen_port: u16,
    pub static_peer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinGroupRequest {
    pub invite_uri: String,
    pub display_name: String,
    pub listen_port: u16,
    pub static_peer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupCreated {
    pub group_id: String,
    pub mesh_id: String,
    pub invite_uri: String,
    pub fingerprint: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupMessage {
    pub from_device: String,
    pub from_fingerprint: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<AttachmentDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupSnapshot {
    pub group_id: String,
    pub mesh_id: String,
    pub label: Option<String>,
    pub display_name: String,
    pub device_fingerprint: String,
    pub creator_fingerprint: String,
    pub is_admin: bool,
    pub state: String,
    pub member_count: usize,
    pub invite_uri: Option<String>,
    pub messages: Vec<GroupMessage>,
    pub attachments: Vec<AttachmentView>,
    pub dm_offers: Vec<DmOffer>,
    pub mesh: Option<MeshInfo>,
    pub events: Vec<SnapshotEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupListSnapshot {
    pub groups: Vec<GroupSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupSendResult {
    pub group_id: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupLeaveResult {
    pub group_id: String,
    pub closed: bool,
}

#[derive(Debug)]
pub enum PrivateGroupError {
    Moss(String),
    Codec(String),
    OpenMls(String),
    InvalidInvite(String),
    BodyTooLarge,
    MissingGroup(String),
    DuplicateGroup(String),
    NotReady,
    Attachment(String),
    MissingAttachment(String),
}

impl std::fmt::Display for PrivateGroupError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Moss(error) => write!(formatter, "Moss error: {error}"),
            Self::Codec(error) => write!(formatter, "codec error: {error}"),
            Self::OpenMls(error) => write!(formatter, "OpenMLS error: {error}"),
            Self::InvalidInvite(error) => write!(formatter, "invalid group invite: {error}"),
            Self::BodyTooLarge => write!(formatter, "group message too large"),
            Self::MissingGroup(id) => write!(formatter, "group not joined: {id}"),
            Self::DuplicateGroup(id) => write!(formatter, "already joined group: {id}"),
            Self::NotReady => write!(formatter, "group not ready"),
            Self::Attachment(error) => write!(formatter, "attachment error: {error}"),
            Self::MissingAttachment(id) => write!(formatter, "attachment not found: {id}"),
        }
    }
}

impl std::error::Error for PrivateGroupError {}

impl From<MlsCryptoError> for PrivateGroupError {
    fn from(error: MlsCryptoError) -> Self {
        match error {
            MlsCryptoError::OpenMls(message) => Self::OpenMls(message),
            MlsCryptoError::Codec(message) => Self::Codec(message),
            MlsCryptoError::NotReady => Self::NotReady,
        }
    }
}

impl From<crate::adapters::attachment_runtime::AttachmentRuntimeError> for PrivateGroupError {
    fn from(error: crate::adapters::attachment_runtime::AttachmentRuntimeError) -> Self {
        Self::Attachment(error.to_string())
    }
}

impl From<crate::adapters::attachment_store::AttachmentStoreError> for PrivateGroupError {
    fn from(error: crate::adapters::attachment_store::AttachmentStoreError) -> Self {
        Self::Attachment(error.to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ControlEnvelope {
    KeyPackage {
        group_id: String,
        participant_id: String,
        from_device: String,
        from_fingerprint: String,
        key_package_b64: String,
    },
    Welcome {
        group_id: String,
        for_participant_id: String,
        from_fingerprint: String,
        welcome_b64: String,
        commit_b64: String,
        tree_b64: String,
    },
    Commit {
        group_id: String,
        from_fingerprint: String,
        commit_b64: String,
    },
    AdminHandoff {
        group_id: String,
        from_fingerprint: String,
        next_admin_fingerprint: String,
    },
    SelfRemove {
        group_id: String,
        from_fingerprint: String,
        proposal_b64: String,
    },
    /// AttachmentManifest encrypted as an MLS application message, broadcast
    /// to every member so they can later request the chunks.
    AttachmentManifest {
        group_id: String,
        participant_id: String,
        from_device: String,
        from_fingerprint: String,
        manifest_ciphertext_b64: String,
    },
    /// A private-DM invitation aimed at one group member.
    DmOffer { group_id: String, offer: DmOffer },
}

#[derive(Debug, Serialize, Deserialize)]
struct DataEnvelope {
    group_id: String,
    participant_id: String,
    from_device: String,
    from_fingerprint: String,
    ciphertext_b64: String,
}

/// Blob channel traffic. Chunk payloads are AES-GCM sealed by the
/// attachment runtime, so this envelope is plain routing metadata.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum BlobEnvelope {
    Request {
        participant_id: String,
        request: ChunkRequest,
    },
    Chunk {
        participant_id: String,
        frame: ChunkFrame,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AttachmentDirection {
    Outgoing,
    Incoming,
}

struct AttachmentSlot {
    descriptor: AttachmentDescriptor,
    direction: AttachmentDirection,
    local_path: Option<String>,
    download_requested: bool,
    failed: bool,
    cancelled: bool,
}

pub struct PrivateGroupRuntime {
    moss: Arc<MossFfiRuntime>,
    attachment_store: Arc<AttachmentStore>,
    groups: HashMap<String, GroupSession>,
}

struct GroupSession {
    group_id: String,
    mesh_id: String,
    label: Option<String>,
    display_name: String,
    participant_id: String,
    device_fingerprint: String,
    creator_fingerprint: String,
    current_admin_fingerprint: String,
    is_admin: bool,
    invite_uri: Option<String>,
    joined: bool,
    node: MossNode,
    crypto: MlsSessionCrypto,
    messages: Vec<GroupMessage>,
    seen_set: HashSet<String>,
    seen_order: VecDeque<String>,
    control_channel: String,
    data_channel: String,
    blob_channel: String,
    attachment_store: Arc<AttachmentStore>,
    attachments: AttachmentRuntime,
    attachment_slots: HashMap<String, AttachmentSlot>,
    dm_offers: Vec<DmOffer>,
}

impl PrivateGroupRuntime {
    pub fn new(moss: MossFfiRuntime, attachment_store: Arc<AttachmentStore>) -> Self {
        Self::from_shared(Arc::new(moss), attachment_store)
    }

    pub fn from_shared(moss: Arc<MossFfiRuntime>, attachment_store: Arc<AttachmentStore>) -> Self {
        Self {
            moss,
            attachment_store,
            groups: HashMap::new(),
        }
    }

    pub fn create_group(
        &mut self,
        request: CreateGroupRequest,
    ) -> Result<GroupCreated, PrivateGroupError> {
        let label = sanitize_label(request.label)?;
        let mut crypto = MlsSessionCrypto::new(&request.display_name)?;
        crypto.create_group()?;
        let group_id = crypto.random_token("group")?;
        let mesh_id = crypto.random_token("groupmesh")?;
        let participant_id = crypto.random_token("participant")?;
        let creator_fingerprint = crypto.fingerprint();
        let node = start_node(
            &self.moss,
            &mesh_id,
            &group_id,
            request.listen_port,
            request.static_peer,
        )?;
        let device_fingerprint = node
            .public_key_hex()
            .ok_or_else(|| PrivateGroupError::Moss("public key unavailable".to_string()))?;
        let invite_uri = build_invite_uri(&mesh_id, &group_id, &creator_fingerprint, &label);

        let session = GroupSession {
            group_id: group_id.clone(),
            mesh_id: mesh_id.clone(),
            label: label.clone(),
            display_name: request.display_name,
            participant_id,
            device_fingerprint,
            creator_fingerprint: creator_fingerprint.clone(),
            current_admin_fingerprint: creator_fingerprint.clone(),
            is_admin: true,
            invite_uri: Some(invite_uri.clone()),
            joined: true,
            node,
            crypto,
            messages: Vec::new(),
            seen_set: HashSet::new(),
            seen_order: VecDeque::new(),
            control_channel: format!("{CONTROL_CHANNEL_PREFIX}{group_id}"),
            data_channel: format!("{DATA_CHANNEL_PREFIX}{group_id}"),
            blob_channel: format!("{BLOB_CHANNEL_PREFIX}{group_id}"),
            attachment_store: Arc::clone(&self.attachment_store),
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
            dm_offers: Vec::new(),
        };

        self.groups.insert(group_id.clone(), session);
        Ok(GroupCreated {
            group_id,
            mesh_id,
            invite_uri,
            fingerprint: creator_fingerprint,
            label,
        })
    }

    pub fn join_group(
        &mut self,
        request: JoinGroupRequest,
    ) -> Result<GroupSnapshot, PrivateGroupError> {
        let invite = ParsedGroupInvite::parse(&request.invite_uri)?;
        if self.groups.contains_key(&invite.group_id) {
            return Err(PrivateGroupError::DuplicateGroup(invite.group_id));
        }
        let mut crypto = MlsSessionCrypto::new(&request.display_name)?;
        let participant_id = crypto.random_token("participant")?;
        let key_package = crypto.key_package_bytes()?;
        let node = start_node(
            &self.moss,
            &invite.mesh_id,
            &invite.group_id,
            request.listen_port,
            request.static_peer,
        )?;
        let device_fingerprint = node
            .public_key_hex()
            .ok_or_else(|| PrivateGroupError::Moss("public key unavailable".to_string()))?;
        let envelope = ControlEnvelope::KeyPackage {
            group_id: invite.group_id.clone(),
            participant_id: participant_id.clone(),
            from_device: request.display_name.clone(),
            from_fingerprint: device_fingerprint.clone(),
            key_package_b64: encode(&key_package),
        };
        let control_channel = format!("{CONTROL_CHANNEL_PREFIX}{}", invite.group_id);
        publish_json(&node, &control_channel, &envelope)?;
        let session = GroupSession {
            group_id: invite.group_id.clone(),
            mesh_id: invite.mesh_id,
            label: invite.label.clone(),
            display_name: request.display_name,
            participant_id,
            device_fingerprint,
            creator_fingerprint: invite.creator_fingerprint.clone(),
            current_admin_fingerprint: invite.creator_fingerprint,
            is_admin: false,
            invite_uri: Some(request.invite_uri),
            joined: false,
            node,
            crypto,
            messages: Vec::new(),
            seen_set: HashSet::new(),
            seen_order: VecDeque::new(),
            control_channel,
            data_channel: format!("{DATA_CHANNEL_PREFIX}{}", invite.group_id),
            blob_channel: format!("{BLOB_CHANNEL_PREFIX}{}", invite.group_id),
            attachment_store: Arc::clone(&self.attachment_store),
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
            dm_offers: Vec::new(),
        };
        self.groups.insert(invite.group_id.clone(), session);
        self.poll(&invite.group_id)
    }

    /// Encrypts a file, stores the sender's copy, and broadcasts the manifest
    /// to every group member over the MLS-protected control channel.
    pub fn send_attachment(
        &mut self,
        group_id: &str,
        file_name: String,
        mime: String,
        bytes: Vec<u8>,
        thumbnail: Option<String>,
        voice: Option<VoiceMeta>,
    ) -> Result<AttachmentSendResult, PrivateGroupError> {
        self.drain_inbound()?;
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        session.send_attachment(file_name, mime, bytes, thumbnail, voice)
    }

    pub fn download_attachment(
        &mut self,
        group_id: &str,
        attachment_id: &str,
    ) -> Result<(), PrivateGroupError> {
        self.drain_inbound()?;
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        session.start_attachment_download(attachment_id)?;
        session.pump_attachment_requests();
        Ok(())
    }

    pub fn cancel_attachment(
        &mut self,
        group_id: &str,
        attachment_id: &str,
    ) -> Result<(), PrivateGroupError> {
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        session.cancel_attachment(attachment_id)
    }

    /// Publishes a private-DM invitation aimed at one group member.
    pub fn send_dm_offer(
        &mut self,
        group_id: &str,
        target_fingerprint: String,
        invite_uri: String,
    ) -> Result<(), PrivateGroupError> {
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        let offer = DmOffer {
            offer_id: format!(
                "offer-{}",
                &crate::adapters::attachment_crypto::sha256_hex(invite_uri.as_bytes())[..16]
            ),
            from_device: session.display_name.clone(),
            from_fingerprint: session.device_fingerprint.clone(),
            target_fingerprint,
            invite_uri,
        };
        publish_json(
            &session.node,
            &session.control_channel,
            &ControlEnvelope::DmOffer {
                group_id: session.group_id.clone(),
                offer,
            },
        )
    }

    pub fn dismiss_dm_offer(
        &mut self,
        group_id: &str,
        offer_id: &str,
    ) -> Result<(), PrivateGroupError> {
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        session.dm_offers.retain(|offer| offer.offer_id != offer_id);
        Ok(())
    }

    /// Serves a byte range for streaming playback of a group attachment.
    pub fn stream_attachment_range(
        &mut self,
        group_id: &str,
        attachment_id: &str,
        start: u64,
        end: u64,
    ) -> Result<StreamRange, PrivateGroupError> {
        self.drain_inbound()?;
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        if let Some(slot) = session.attachment_slots.get_mut(attachment_id) {
            slot.download_requested = true;
            slot.cancelled = false;
        }
        let _ = session.attachments.start_download(attachment_id);
        let outcome = session.attachments.stream_range(attachment_id, start, end);
        session.pump_attachment_requests();
        Ok(outcome)
    }

    pub fn send(
        &mut self,
        group_id: &str,
        body: String,
    ) -> Result<GroupSendResult, PrivateGroupError> {
        if body.len() > MAX_BODY_LEN {
            return Err(PrivateGroupError::BodyTooLarge);
        }
        self.drain_inbound()?;
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        if !session.joined {
            return Err(PrivateGroupError::NotReady);
        }
        let ciphertext = session.crypto.encrypt(body.as_bytes())?;
        let envelope = DataEnvelope {
            group_id: session.group_id.clone(),
            participant_id: session.participant_id.clone(),
            from_device: session.display_name.clone(),
            from_fingerprint: session.device_fingerprint.clone(),
            ciphertext_b64: encode(&ciphertext),
        };
        publish_json(&session.node, &session.data_channel, &envelope)?;
        session.messages.push(GroupMessage {
            from_device: session.display_name.clone(),
            from_fingerprint: session.device_fingerprint.clone(),
            body,
            attachment: None,
        });
        Ok(GroupSendResult {
            group_id: session.group_id.clone(),
            bytes: ciphertext.len(),
        })
    }

    pub fn poll(&mut self, group_id: &str) -> Result<GroupSnapshot, PrivateGroupError> {
        self.drain_inbound()?;
        let session = self
            .groups
            .get(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        Ok(session.snapshot())
    }

    pub fn list(&mut self) -> Result<GroupListSnapshot, PrivateGroupError> {
        self.drain_inbound()?;
        let mut groups: Vec<GroupSnapshot> =
            self.groups.values().map(GroupSession::snapshot).collect();
        groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
        Ok(GroupListSnapshot { groups })
    }

    pub fn close(&mut self, group_id: &str) -> Result<GroupLeaveResult, PrivateGroupError> {
        let session = self
            .groups
            .get_mut(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;

        if session.joined {
            let own_fp = session.crypto.fingerprint();
            if session.is_admin {
                // Drop the admin's own MLS leaf first so the remaining members
                // do not carry a ghost entry after the handoff.
                let successor = session
                    .crypto
                    .member_fingerprints()
                    .into_iter()
                    .filter(|fp| fp != &own_fp)
                    .min();
                if let Some(next_admin) = successor {
                    let commit_bytes = session.crypto.remove_self_commit()?;
                    let commit_envelope = ControlEnvelope::Commit {
                        group_id: session.group_id.clone(),
                        from_fingerprint: own_fp.clone(),
                        commit_b64: encode(&commit_bytes),
                    };
                    publish_json(&session.node, &session.control_channel, &commit_envelope)?;
                    let handoff = ControlEnvelope::AdminHandoff {
                        group_id: session.group_id.clone(),
                        from_fingerprint: own_fp,
                        next_admin_fingerprint: next_admin,
                    };
                    publish_json(&session.node, &session.control_channel, &handoff)?;
                }
            } else {
                // Non-admin emits a self-Remove proposal so the current admin
                // can commit it and the roster stays in sync.
                let proposal_bytes = session.crypto.leave_proposal_bytes()?;
                let envelope = ControlEnvelope::SelfRemove {
                    group_id: session.group_id.clone(),
                    from_fingerprint: own_fp,
                    proposal_b64: encode(&proposal_bytes),
                };
                publish_json(&session.node, &session.control_channel, &envelope)?;
            }
        }

        self.groups.remove(group_id);
        Ok(GroupLeaveResult {
            group_id: group_id.to_string(),
            closed: true,
        })
    }

    fn drain_inbound(&mut self) -> Result<(), PrivateGroupError> {
        let inbound = drain_messages_where(|message| {
            message.channel.starts_with(CONTROL_CHANNEL_PREFIX)
                || message.channel.starts_with(DATA_CHANNEL_PREFIX)
                || message.channel.starts_with(BLOB_CHANNEL_PREFIX)
        });
        for message in inbound {
            let group_id = match channel_group_id(&message.channel) {
                Some(gid) => gid.to_string(),
                None => continue,
            };
            if let Some(session) = self.groups.get_mut(&group_id) {
                session.handle_moss_message(message)?;
            }
        }
        for session in self.groups.values_mut() {
            session.pump_attachment_requests();
        }
        Ok(())
    }
}

impl GroupSession {
    fn handle_moss_message(
        &mut self,
        message: MossReceivedMessage,
    ) -> Result<(), PrivateGroupError> {
        if self.has_seen(&message) {
            return Ok(());
        }
        if message.channel == self.control_channel {
            self.handle_control(message.payload)
        } else if message.channel == self.data_channel {
            self.handle_data(message.payload)
        } else if message.channel == self.blob_channel {
            self.handle_blob(message.payload)
        } else {
            Ok(())
        }
    }

    fn has_seen(&mut self, message: &MossReceivedMessage) -> bool {
        let key = format!(
            "{}:{}",
            message.channel,
            crate::adapters::attachment_crypto::sha256_hex(&message.payload)
        );
        if !self.seen_set.insert(key.clone()) {
            return true;
        }
        self.seen_order.push_back(key);
        if self.seen_order.len() > DEDUP_BUFFER_CAP {
            if let Some(evicted) = self.seen_order.pop_front() {
                self.seen_set.remove(&evicted);
            }
        }
        false
    }

    fn handle_control(&mut self, payload: Vec<u8>) -> Result<(), PrivateGroupError> {
        let envelope: ControlEnvelope = decode_json(&payload)?;
        let own_fp = self.crypto.fingerprint();
        match envelope {
            ControlEnvelope::KeyPackage {
                group_id,
                participant_id,
                key_package_b64,
                ..
            } if self.is_admin
                && self.group_id == group_id
                && self.participant_id != participant_id =>
            {
                let key_package = decode(&key_package_b64)?;
                // Drop replays / rogue duplicate admit attempts whose MLS
                // signer is already covered by the roster.
                if self.crypto.key_package_signer_is_member(&key_package)? {
                    return Ok(());
                }
                let outcome = self.crypto.add_members(&[key_package.as_slice()])?;
                let commit_b64 = encode(&outcome.commit_bytes);
                let welcome_envelope = ControlEnvelope::Welcome {
                    group_id: self.group_id.clone(),
                    for_participant_id: participant_id.clone(),
                    from_fingerprint: own_fp.clone(),
                    welcome_b64: encode(&outcome.welcome_bytes),
                    commit_b64: commit_b64.clone(),
                    tree_b64: encode(&outcome.tree_bytes),
                };
                publish_json(&self.node, &self.control_channel, &welcome_envelope)?;
                // Existing members need the Commit on the control channel so
                // their MLS tree advances; the Welcome above is consumed only
                // by the new joiner.
                let commit_envelope = ControlEnvelope::Commit {
                    group_id: self.group_id.clone(),
                    from_fingerprint: own_fp,
                    commit_b64,
                };
                publish_json(&self.node, &self.control_channel, &commit_envelope)
            }
            ControlEnvelope::Welcome {
                group_id,
                for_participant_id,
                from_fingerprint,
                welcome_b64,
                tree_b64,
                ..
            } if !self.joined
                && !self.is_admin
                && self.group_id == group_id
                && self.participant_id == for_participant_id
                && from_fingerprint == self.current_admin_fingerprint =>
            {
                self.crypto
                    .join_welcome(&decode(&welcome_b64)?, &decode(&tree_b64)?)?;
                self.joined = true;
                Ok(())
            }
            ControlEnvelope::Welcome {
                group_id,
                from_fingerprint,
                commit_b64,
                ..
            } if self.joined
                && !self.is_admin
                && self.group_id == group_id
                && from_fingerprint == self.current_admin_fingerprint =>
            {
                let commit = decode(&commit_b64)?;
                self.crypto.process_commit(&commit)?;
                Ok(())
            }
            ControlEnvelope::Commit {
                group_id,
                from_fingerprint,
                commit_b64,
            } if self.joined
                && !self.is_admin
                && self.group_id == group_id
                && from_fingerprint == self.current_admin_fingerprint =>
            {
                let commit = decode(&commit_b64)?;
                self.crypto.process_commit(&commit)?;
                Ok(())
            }
            ControlEnvelope::AdminHandoff {
                group_id,
                from_fingerprint,
                next_admin_fingerprint,
            } if self.group_id == group_id
                && from_fingerprint == self.current_admin_fingerprint
                && from_fingerprint != next_admin_fingerprint =>
            {
                self.current_admin_fingerprint = next_admin_fingerprint.clone();
                if next_admin_fingerprint == own_fp {
                    self.is_admin = true;
                }
                Ok(())
            }
            ControlEnvelope::SelfRemove {
                group_id,
                from_fingerprint,
                proposal_b64,
            } if self.is_admin && self.group_id == group_id && from_fingerprint != own_fp => {
                let proposal = decode(&proposal_b64)?;
                self.crypto.queue_remote_proposal(&proposal)?;
                let commit_bytes = self.crypto.commit_pending()?;
                let commit_envelope = ControlEnvelope::Commit {
                    group_id: self.group_id.clone(),
                    from_fingerprint: own_fp,
                    commit_b64: encode(&commit_bytes),
                };
                publish_json(&self.node, &self.control_channel, &commit_envelope)
            }
            ControlEnvelope::AttachmentManifest {
                group_id,
                participant_id,
                from_device,
                from_fingerprint,
                manifest_ciphertext_b64,
            } if self.joined
                && self.group_id == group_id
                && participant_id != self.participant_id =>
            {
                let manifest_json = self.crypto.decrypt(&decode(&manifest_ciphertext_b64)?)?;
                let manifest: AttachmentManifest = decode_json(&manifest_json)?;
                self.accept_incoming_manifest(from_device, from_fingerprint, manifest)
            }
            ControlEnvelope::DmOffer { group_id, offer }
                if self.group_id == group_id
                    && offer.target_fingerprint == self.device_fingerprint
                    && offer.from_fingerprint != self.device_fingerprint =>
            {
                if !self
                    .dm_offers
                    .iter()
                    .any(|existing| existing.offer_id == offer.offer_id)
                {
                    self.dm_offers.push(offer);
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn handle_data(&mut self, payload: Vec<u8>) -> Result<(), PrivateGroupError> {
        let envelope: DataEnvelope = decode_json(&payload)?;
        if envelope.group_id != self.group_id || envelope.participant_id == self.participant_id {
            return Ok(());
        }
        let plaintext = self.crypto.decrypt(&decode(&envelope.ciphertext_b64)?)?;
        self.messages.push(GroupMessage {
            from_device: envelope.from_device,
            from_fingerprint: envelope.from_fingerprint,
            body: String::from_utf8_lossy(&plaintext).into_owned(),
            attachment: None,
        });
        Ok(())
    }

    fn handle_blob(&mut self, payload: Vec<u8>) -> Result<(), PrivateGroupError> {
        let envelope: BlobEnvelope = decode_json(&payload)?;
        match envelope {
            BlobEnvelope::Request {
                participant_id,
                request,
            } if participant_id != self.participant_id => {
                // Only the original sender holds the outgoing transfer;
                // every other member simply has nothing to serve.
                let frames = match self.attachments.serve_chunks(&request) {
                    Ok(frames) => frames,
                    Err(_) => return Ok(()),
                };
                for frame in frames {
                    let chunk = BlobEnvelope::Chunk {
                        participant_id: self.participant_id.clone(),
                        frame,
                    };
                    publish_json(&self.node, &self.blob_channel, &chunk)?;
                }
                Ok(())
            }
            BlobEnvelope::Chunk {
                participant_id,
                frame,
            } if participant_id != self.participant_id => {
                let attachment_id = frame.attachment_id.clone();
                let file_name = self
                    .attachment_slots
                    .get(&attachment_id)
                    .map(|slot| slot.descriptor.file_name.clone())
                    .unwrap_or_else(|| "file".to_string());
                match self.attachments.ingest_chunk(&frame) {
                    Ok(ChunkOutcome::Complete {
                        content_hash,
                        bytes,
                        ..
                    }) => {
                        let path =
                            self.attachment_store
                                .write_blob(&content_hash, &file_name, &bytes)?;
                        if let Some(slot) = self.attachment_slots.get_mut(&attachment_id) {
                            slot.local_path = Some(path.to_string_lossy().into_owned());
                            slot.failed = false;
                        }
                        Ok(())
                    }
                    Ok(_) => Ok(()),
                    Err(_) => {
                        if let Some(slot) = self.attachment_slots.get_mut(&attachment_id) {
                            slot.failed = true;
                        }
                        Ok(())
                    }
                }
            }
            _ => Ok(()),
        }
    }

    fn accept_incoming_manifest(
        &mut self,
        from_device: String,
        from_fingerprint: String,
        manifest: AttachmentManifest,
    ) -> Result<(), PrivateGroupError> {
        let attachment_id = manifest.attachment_id.clone();
        if self.attachment_slots.contains_key(&attachment_id) {
            return Ok(());
        }
        let descriptor = descriptor_of(&manifest);
        self.attachments.register_incoming(manifest)?;
        self.attachment_slots.insert(
            attachment_id,
            AttachmentSlot {
                descriptor: descriptor.clone(),
                direction: AttachmentDirection::Incoming,
                local_path: None,
                download_requested: false,
                failed: false,
                cancelled: false,
            },
        );
        self.messages.push(GroupMessage {
            from_device,
            from_fingerprint,
            body: String::new(),
            attachment: Some(descriptor),
        });
        Ok(())
    }

    fn send_attachment(
        &mut self,
        file_name: String,
        mime: String,
        bytes: Vec<u8>,
        thumbnail: Option<String>,
        voice: Option<VoiceMeta>,
    ) -> Result<AttachmentSendResult, PrivateGroupError> {
        if !self.joined || !self.crypto.is_ready() {
            return Err(PrivateGroupError::NotReady);
        }
        let attachment_id = self.crypto.random_token("attachment")?;
        let manifest = self.attachments.prepare_outgoing(
            attachment_id.clone(),
            file_name,
            mime,
            self.device_fingerprint.clone(),
            bytes.clone(),
            thumbnail,
            voice,
        )?;
        let stored = self.attachment_store.write_blob(
            &manifest.content_hash,
            &manifest.file_name,
            &bytes,
        )?;
        let manifest_json = serde_json::to_vec(&manifest)
            .map_err(|error| PrivateGroupError::Codec(error.to_string()))?;
        let ciphertext = self.crypto.encrypt(&manifest_json)?;
        let envelope = ControlEnvelope::AttachmentManifest {
            group_id: self.group_id.clone(),
            participant_id: self.participant_id.clone(),
            from_device: self.display_name.clone(),
            from_fingerprint: self.device_fingerprint.clone(),
            manifest_ciphertext_b64: encode(&ciphertext),
        };
        publish_json(&self.node, &self.control_channel, &envelope)?;

        let descriptor = descriptor_of(&manifest);
        self.attachment_slots.insert(
            attachment_id.clone(),
            AttachmentSlot {
                descriptor: descriptor.clone(),
                direction: AttachmentDirection::Outgoing,
                local_path: Some(stored.to_string_lossy().into_owned()),
                download_requested: false,
                failed: false,
                cancelled: false,
            },
        );
        self.messages.push(GroupMessage {
            from_device: self.display_name.clone(),
            from_fingerprint: self.device_fingerprint.clone(),
            body: String::new(),
            attachment: Some(descriptor),
        });
        Ok(AttachmentSendResult {
            session_id: self.group_id.clone(),
            attachment_id,
            content_hash: manifest.content_hash,
        })
    }

    fn start_attachment_download(&mut self, attachment_id: &str) -> Result<(), PrivateGroupError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| PrivateGroupError::MissingAttachment(attachment_id.to_string()))?;
        if slot.direction != AttachmentDirection::Incoming {
            return Err(PrivateGroupError::Attachment(
                "cannot download an outgoing attachment".to_string(),
            ));
        }
        slot.download_requested = true;
        slot.failed = false;
        slot.cancelled = false;
        self.attachments.start_download(attachment_id)?;
        Ok(())
    }

    fn cancel_attachment(&mut self, attachment_id: &str) -> Result<(), PrivateGroupError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| PrivateGroupError::MissingAttachment(attachment_id.to_string()))?;
        slot.cancelled = true;
        slot.download_requested = false;
        self.attachments.cancel(attachment_id);
        Ok(())
    }

    fn pump_attachment_requests(&mut self) {
        let active: Vec<String> = self
            .attachment_slots
            .iter()
            .filter(|(_, slot)| {
                slot.direction == AttachmentDirection::Incoming
                    && slot.download_requested
                    && slot.local_path.is_none()
                    && !slot.cancelled
            })
            .map(|(id, _)| id.clone())
            .collect();
        for attachment_id in active {
            if let Some(request) = self.attachments.next_chunk_request(&attachment_id) {
                let envelope = BlobEnvelope::Request {
                    participant_id: self.participant_id.clone(),
                    request,
                };
                let _ = publish_json(&self.node, &self.blob_channel, &envelope);
            }
        }
    }

    fn attachment_views(&self) -> Vec<AttachmentView> {
        let mut views: Vec<AttachmentView> = self
            .attachment_slots
            .values()
            .map(|slot| slot.view(&self.attachments))
            .collect();
        views.sort_by(|a, b| a.attachment_id.cmp(&b.attachment_id));
        views
    }

    fn snapshot(&self) -> GroupSnapshot {
        GroupSnapshot {
            group_id: self.group_id.clone(),
            mesh_id: self.mesh_id.clone(),
            label: self.label.clone(),
            display_name: self.display_name.clone(),
            device_fingerprint: self.device_fingerprint.clone(),
            creator_fingerprint: self.creator_fingerprint.clone(),
            is_admin: self.is_admin,
            state: self.state(),
            member_count: self.crypto.member_count(),
            invite_uri: self.invite_uri.clone(),
            messages: self.messages.clone(),
            attachments: self.attachment_views(),
            dm_offers: self.dm_offers.clone(),
            mesh: self.mesh_info(),
            events: snapshot_event_log()
                .into_iter()
                .map(|event| SnapshotEvent {
                    event_type: event.event_type,
                    event_name: SnapshotEvent::name_for(event.event_type).to_string(),
                    detail_json: event.detail_json,
                    epoch_millis: event.epoch_millis,
                })
                .collect(),
        }
    }

    fn mesh_info(&self) -> Option<MeshInfo> {
        let raw = self.node.mesh_info_json()?;
        let mut info: MeshInfo = serde_json::from_str(&raw).ok()?;
        if info.nat_type.is_empty() {
            if let Some(nat) = self.node.nat_type() {
                info.nat_type = nat;
            }
        }
        Some(info)
    }

    fn state(&self) -> String {
        if self.joined && self.crypto.is_ready() {
            "ready".to_string()
        } else {
            "waiting".to_string()
        }
    }
}

impl AttachmentSlot {
    fn view(&self, attachments: &AttachmentRuntime) -> AttachmentView {
        let chunk_count = self
            .descriptor
            .total_size
            .div_ceil(u64::from(CHUNK_SIZE))
            .max(1);
        let (direction, progress) = match self.direction {
            AttachmentDirection::Outgoing => (
                "outgoing",
                attachments.outgoing_progress(&self.descriptor.attachment_id),
            ),
            AttachmentDirection::Incoming => (
                "incoming",
                attachments.incoming_progress(&self.descriptor.attachment_id),
            ),
        };
        let completed_chunks = progress
            .as_ref()
            .map(|value| value.completed_chunks)
            .unwrap_or(0);
        let state = if self.cancelled {
            AttachmentState::Cancelled
        } else if self.failed {
            AttachmentState::Failed
        } else if self.local_path.is_some() {
            AttachmentState::Available
        } else if self.download_requested {
            AttachmentState::Downloading
        } else {
            AttachmentState::Offered
        };
        AttachmentView {
            attachment_id: self.descriptor.attachment_id.clone(),
            direction: direction.to_string(),
            state,
            completed_chunks,
            chunk_count,
            local_path: self.local_path.clone(),
        }
    }
}

fn descriptor_of(manifest: &AttachmentManifest) -> AttachmentDescriptor {
    AttachmentDescriptor {
        attachment_id: manifest.attachment_id.clone(),
        content_hash: manifest.content_hash.clone(),
        file_name: manifest.file_name.clone(),
        mime: manifest.mime.clone(),
        total_size: manifest.total_size,
        thumbnail_b64: manifest.thumbnail_b64.clone(),
        voice: manifest.voice.clone(),
    }
}

struct ParsedGroupInvite {
    mesh_id: String,
    group_id: String,
    creator_fingerprint: String,
    label: Option<String>,
}

impl ParsedGroupInvite {
    fn parse(raw: &str) -> Result<Self, PrivateGroupError> {
        let url = url::Url::parse(raw)
            .map_err(|error| PrivateGroupError::InvalidInvite(error.to_string()))?;
        if url.scheme() != "mosh" || url.host_str() != Some("group") {
            return Err(PrivateGroupError::InvalidInvite("wrong scheme".to_string()));
        }
        let mesh = query(&url, "mesh")?;
        let group = query(&url, "group")?;
        let fingerprint = url.fragment().unwrap_or_default().replace("fp=", "");
        if fingerprint.is_empty() {
            return Err(PrivateGroupError::InvalidInvite(
                "missing creator fingerprint".to_string(),
            ));
        }
        if fingerprint.len() != INVITE_FINGERPRINT_LEN
            || !fingerprint.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err(PrivateGroupError::InvalidInvite(
                "fingerprint must be 32 hex chars".to_string(),
            ));
        }
        let fingerprint = fingerprint.to_ascii_uppercase();
        let label = optional_query(&url, "name");
        Ok(Self {
            mesh_id: mesh,
            group_id: group,
            creator_fingerprint: fingerprint,
            label: label.and_then(sanitize_label_str),
        })
    }
}

fn build_invite_uri(
    mesh_id: &str,
    group_id: &str,
    fingerprint: &str,
    label: &Option<String>,
) -> String {
    match label.as_ref().and_then(|value| {
        let encoded = url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>();
        if encoded.is_empty() {
            None
        } else {
            Some(encoded)
        }
    }) {
        Some(encoded) => format!(
            "{INVITE_PREFIX}?mesh={mesh_id}&group={group_id}&name={encoded}#fp={fingerprint}"
        ),
        None => format!("{INVITE_PREFIX}?mesh={mesh_id}&group={group_id}#fp={fingerprint}"),
    }
}

fn sanitize_label(raw: Option<String>) -> Result<Option<String>, PrivateGroupError> {
    Ok(raw.and_then(sanitize_label_str))
}

fn sanitize_label_str(raw: String) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let truncated: String = trimmed.chars().take(MAX_LABEL_LEN).collect();
    Some(truncated)
}

fn channel_group_id(channel: &str) -> Option<&str> {
    channel
        .strip_prefix(CONTROL_CHANNEL_PREFIX)
        .or_else(|| channel.strip_prefix(DATA_CHANNEL_PREFIX))
        .or_else(|| channel.strip_prefix(BLOB_CHANNEL_PREFIX))
}

fn start_node(
    runtime: &Arc<MossFfiRuntime>,
    mesh_id: &str,
    group_id: &str,
    listen_port: u16,
    static_peer: Option<String>,
) -> Result<MossNode, PrivateGroupError> {
    let node = runtime
        .init_default_node(
            mesh_id,
            &MossNodeConfig {
                listen_port,
                static_peer,
            },
        )
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))?;
    node.set_message_callback()
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))?;
    node.set_event_callback()
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))?;
    clear_event_log();
    node.start()
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))?;
    node.subscribe(&format!("{CONTROL_CHANNEL_PREFIX}{group_id}"))
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))?;
    node.subscribe(&format!("{DATA_CHANNEL_PREFIX}{group_id}"))
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))?;
    node.subscribe(&format!("{BLOB_CHANNEL_PREFIX}{group_id}"))
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))?;
    Ok(node)
}

fn publish_json<T: Serialize>(
    node: &MossNode,
    channel: &str,
    value: &T,
) -> Result<(), PrivateGroupError> {
    let payload =
        serde_json::to_vec(value).map_err(|error| PrivateGroupError::Codec(error.to_string()))?;
    node.publish(channel, &payload)
        .map_err(|error| PrivateGroupError::Moss(error.to_string()))
}

fn decode_json<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, PrivateGroupError> {
    serde_json::from_slice(bytes).map_err(|error| PrivateGroupError::Codec(error.to_string()))
}

fn encode(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

fn decode(encoded: &str) -> Result<Vec<u8>, PrivateGroupError> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|error| PrivateGroupError::Codec(error.to_string()))
}

fn query(url: &url::Url, key: &str) -> Result<String, PrivateGroupError> {
    optional_query(url, key)
        .ok_or_else(|| PrivateGroupError::InvalidInvite(format!("missing {key}")))
}

fn optional_query(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invite_uri_round_trips() {
        let uri = build_invite_uri(
            "groupmesh-aaa",
            "group-bbb",
            "AABBCCDDEEFF00112233445566778899",
            &Some("Friends".to_string()),
        );
        let parsed = ParsedGroupInvite::parse(&uri).unwrap();
        assert_eq!(parsed.mesh_id, "groupmesh-aaa");
        assert_eq!(parsed.group_id, "group-bbb");
        assert_eq!(
            parsed.creator_fingerprint,
            "AABBCCDDEEFF00112233445566778899"
        );
        assert_eq!(parsed.label.as_deref(), Some("Friends"));
    }

    #[test]
    fn invite_uri_without_label() {
        let uri = build_invite_uri("m", "g", "00112233445566778899AABBCCDDEEFF", &None);
        let parsed = ParsedGroupInvite::parse(&uri).unwrap();
        assert!(parsed.label.is_none());
    }

    #[test]
    fn invite_uri_rejects_malformed_fingerprint() {
        let short = format!("{INVITE_PREFIX}?mesh=m&group=g#fp=ABCD");
        assert!(matches!(
            ParsedGroupInvite::parse(&short),
            Err(PrivateGroupError::InvalidInvite(_))
        ));
        let non_hex = format!("{INVITE_PREFIX}?mesh=m&group=g#fp=ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");
        assert!(matches!(
            ParsedGroupInvite::parse(&non_hex),
            Err(PrivateGroupError::InvalidInvite(_))
        ));
    }

    #[test]
    fn channel_group_id_strips_prefix() {
        assert_eq!(channel_group_id("group-control/g-1"), Some("g-1"));
        assert_eq!(channel_group_id("group-data/g-1"), Some("g-1"));
        assert_eq!(channel_group_id("public-channel/x"), None);
    }
}
