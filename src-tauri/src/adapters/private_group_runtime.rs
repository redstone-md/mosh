use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::adapters::attachment_runtime::{
    AttachmentManifest, AttachmentRuntime, ChunkFrame, ChunkOutcome, ChunkRequest,
    OutgoingAttachment, StreamRange, CHUNK_SIZE,
};
use crate::adapters::attachment_store::AttachmentStore;
use crate::adapters::commit_sequencer::{CommitSequencer, Disposition};
use crate::adapters::message_id::MessageIdGen;
use crate::adapters::mls_crypto::{MlsCryptoError, MlsSessionCrypto};
use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};
use crate::adapters::outbound_delivery::{MessageDeliveryStatus, OutboundAttemptRecord};
use crate::adapters::persistence::Persistence;
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
const OUTBOUND_SCOPE_PRIVATE_GROUP: &str = "private_group";

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn apply_delivery(
    message: &mut GroupMessage,
    status: MessageDeliveryStatus,
    error: Option<String>,
    retry_count: u32,
) {
    message.delivery_status = Some(status);
    message.delivery_error = error;
    message.retry_count = Some(retry_count);
    message.retryable = Some(matches!(status, MessageDeliveryStatus::Failed));
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMessage {
    pub from_device: String,
    pub from_fingerprint: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<AttachmentDescriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_status: Option<MessageDeliveryStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_count: Option<u32>,
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
    pub message_id: String,
    pub sent_at_ms: u64,
    pub delivery_status: MessageDeliveryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
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
    MissingMessage(String),
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
            Self::MissingMessage(id) => write!(formatter, "group message missing: {id}"),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sent_at_ms: Option<u64>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedGroupMessage {
    conversation_id: String,
    sent_at_ms: u64,
    message_id: String,
    message: GroupMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedGroupSession {
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
    signer_public: Vec<u8>,
    mls_group_id: Vec<u8>,
    listen_port: u16,
    static_peer: Option<String>,
}

pub struct PrivateGroupRuntime {
    moss: Arc<MossFfiRuntime>,
    attachment_store: Arc<AttachmentStore>,
    persistence: Option<Arc<Persistence>>,
    persisted_counts: HashMap<String, usize>,
    finalized_group_records: HashSet<String>,
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
    listen_port: u16,
    static_peer: Option<String>,
    node: MossNode,
    crypto: MlsSessionCrypto,
    messages: Vec<GroupMessage>,
    message_ids: MessageIdGen,
    seen_set: HashSet<String>,
    seen_order: VecDeque<String>,
    // Epoch-ordered commit admission: dedups gossip duplicates and the
    // joiner's Welcome-carried admission commit, buffers out-of-order commits,
    // reports gaps for resync. Unbounded like its predecessor set — commits
    // only fire on membership change (rare).
    sequencer: CommitSequencer,
    // Clone of the runtime's store: applied/produced commits land in
    // group_commit_log so the admin can serve ResyncRequests.
    persistence: Option<Arc<Persistence>>,
    // Set when a commit gap could not be bridged by resync; surfaced to the
    // UI ("rejoin needed") instead of silently desyncing.
    needs_rejoin: bool,
    control_channel: String,
    data_channel: String,
    blob_channel: String,
    attachment_store: Arc<AttachmentStore>,
    attachments: AttachmentRuntime,
    attachment_slots: HashMap<String, AttachmentSlot>,
    outbound_attempts: HashMap<String, OutboundAttemptRecord>,
    dm_offers: Vec<DmOffer>,
}

impl PrivateGroupRuntime {
    pub fn new(moss: MossFfiRuntime, attachment_store: Arc<AttachmentStore>) -> Self {
        Self::from_shared(Arc::new(moss), attachment_store, None)
    }

    pub fn from_shared(
        moss: Arc<MossFfiRuntime>,
        attachment_store: Arc<AttachmentStore>,
        persistence: Option<Arc<Persistence>>,
    ) -> Self {
        Self {
            moss,
            attachment_store,
            persistence,
            persisted_counts: HashMap::new(),
            finalized_group_records: HashSet::new(),
            groups: HashMap::new(),
        }
    }

    /// Rebuild private groups + history from the encrypted store. Best-effort:
    /// a corrupt group row is skipped so one bad record does not block startup.
    pub fn rehydrate(&mut self) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let rows = match p.list_groups() {
            Ok(rows) => rows,
            Err(_) => return,
        };
        for row in rows {
            let rec: PersistedGroupSession = match serde_json::from_slice(&row) {
                Ok(record) => record,
                Err(error) => {
                    eprintln!("group rehydrate: bad group row: {error}");
                    continue;
                }
            };
            let snapshot = match p.get_group_mls_snapshot(&rec.group_id) {
                Ok(Some(snapshot)) => snapshot,
                _ => {
                    eprintln!("group rehydrate: missing MLS snapshot for {}", rec.group_id);
                    continue;
                }
            };
            let crypto = match MlsSessionCrypto::restore(
                &rec.display_name,
                &rec.signer_public,
                &snapshot,
                &rec.mls_group_id,
            ) {
                Ok(crypto) => crypto,
                Err(error) => {
                    eprintln!(
                        "group rehydrate: crypto restore failed for {}: {error}",
                        rec.group_id
                    );
                    continue;
                }
            };
            let node = match start_node(
                &self.moss,
                &rec.mesh_id,
                &rec.group_id,
                rec.listen_port,
                rec.static_peer.clone(),
            ) {
                Ok(node) => node,
                Err(error) => {
                    eprintln!(
                        "group rehydrate: node start failed for {}: {error}",
                        rec.group_id
                    );
                    continue;
                }
            };
            let mut session = GroupSession {
                group_id: rec.group_id.clone(),
                mesh_id: rec.mesh_id.clone(),
                label: rec.label.clone(),
                display_name: rec.display_name.clone(),
                participant_id: rec.participant_id.clone(),
                device_fingerprint: node
                    .public_key_hex()
                    .unwrap_or_else(|| rec.device_fingerprint.clone()),
                creator_fingerprint: rec.creator_fingerprint.clone(),
                current_admin_fingerprint: rec.current_admin_fingerprint.clone(),
                is_admin: rec.is_admin,
                invite_uri: rec.invite_uri.clone(),
                joined: rec.joined,
                listen_port: rec.listen_port,
                static_peer: rec.static_peer.clone(),
                node,
                crypto,
                messages: Vec::new(),
                message_ids: MessageIdGen::default(),
                seen_set: HashSet::new(),
                seen_order: VecDeque::new(),
                sequencer: CommitSequencer::new(),
                persistence: self.persistence.clone(),
                needs_rejoin: false,
                control_channel: format!("{CONTROL_CHANNEL_PREFIX}{}", rec.group_id),
                data_channel: format!("{DATA_CHANNEL_PREFIX}{}", rec.group_id),
                blob_channel: format!("{BLOB_CHANNEL_PREFIX}{}", rec.group_id),
                attachment_store: Arc::clone(&self.attachment_store),
                attachments: AttachmentRuntime::new(),
                attachment_slots: HashMap::new(),
                outbound_attempts: HashMap::new(),
                dm_offers: Vec::new(),
            };
            if let Ok(messages) = p.list_group_messages(&rec.group_id) {
                for row in messages {
                    if let Ok(persisted) = serde_json::from_slice::<PersistedGroupMessage>(&row) {
                        let mut message = persisted.message;
                        if message.message_id.is_none() {
                            message.message_id = Some(persisted.message_id.clone());
                        }
                        if message.sent_at_ms.is_none() {
                            message.sent_at_ms = Some(persisted.sent_at_ms);
                        }
                        if let Some(desc) = message.attachment.as_ref() {
                            if self
                                .attachment_store
                                .exists(&desc.content_hash, &desc.file_name)
                                .unwrap_or(false)
                            {
                                if let Ok(path) = self
                                    .attachment_store
                                    .path_for(&desc.content_hash, &desc.file_name)
                                {
                                    let direction =
                                        if message.from_fingerprint == rec.device_fingerprint {
                                            AttachmentDirection::Outgoing
                                        } else {
                                            AttachmentDirection::Incoming
                                        };
                                    session.attachment_slots.insert(
                                        desc.attachment_id.clone(),
                                        AttachmentSlot {
                                            descriptor: desc.clone(),
                                            direction,
                                            local_path: Some(path.to_string_lossy().into_owned()),
                                            download_requested: false,
                                            failed: false,
                                            cancelled: false,
                                        },
                                    );
                                }
                            }
                        }
                        session.upsert_message(message);
                    }
                }
            }
            if let Ok(rows) = p.list_outbound_attempts(OUTBOUND_SCOPE_PRIVATE_GROUP, &rec.group_id)
            {
                for row in rows {
                    let Ok(attempt) = serde_json::from_slice::<OutboundAttemptRecord>(&row) else {
                        continue;
                    };
                    let Ok(mut message) =
                        serde_json::from_str::<GroupMessage>(&attempt.message_json)
                    else {
                        continue;
                    };
                    if message.message_id.is_none() {
                        message.message_id = Some(attempt.message_id.clone());
                    }
                    if message.sent_at_ms.is_none() {
                        message.sent_at_ms = Some(attempt.sent_at_ms);
                    }
                    apply_delivery(
                        &mut message,
                        attempt.delivery_status,
                        attempt.delivery_error.clone(),
                        attempt.retry_count,
                    );
                    session.upsert_message(message);
                    session
                        .outbound_attempts
                        .insert(attempt.message_id.clone(), attempt);
                }
            }
            self.persisted_counts
                .insert(rec.group_id.clone(), session.messages.len());
            self.finalized_group_records.insert(rec.group_id.clone());
            self.groups.insert(rec.group_id, session);
        }
    }

    pub fn create_group(
        &mut self,
        request: CreateGroupRequest,
    ) -> Result<GroupCreated, PrivateGroupError> {
        let label = sanitize_label(request.label)?;
        let listen_port = request.listen_port;
        let static_peer = request.static_peer.clone();
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
            listen_port,
            static_peer.clone(),
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
            listen_port,
            static_peer,
            node,
            crypto,
            messages: Vec::new(),
            message_ids: MessageIdGen::default(),
            seen_set: HashSet::new(),
            seen_order: VecDeque::new(),
            sequencer: CommitSequencer::new(),
            persistence: self.persistence.clone(),
            needs_rejoin: false,
            control_channel: format!("{CONTROL_CHANNEL_PREFIX}{group_id}"),
            data_channel: format!("{DATA_CHANNEL_PREFIX}{group_id}"),
            blob_channel: format!("{BLOB_CHANNEL_PREFIX}{group_id}"),
            attachment_store: Arc::clone(&self.attachment_store),
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
            outbound_attempts: HashMap::new(),
            dm_offers: Vec::new(),
        };

        self.groups.insert(group_id.clone(), session);
        self.persist_group_tail();
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
        let listen_port = request.listen_port;
        let static_peer = request.static_peer.clone();
        let mut crypto = MlsSessionCrypto::new(&request.display_name)?;
        let participant_id = crypto.random_token("participant")?;
        let key_package = crypto.key_package_bytes()?;
        let node = start_node(
            &self.moss,
            &invite.mesh_id,
            &invite.group_id,
            listen_port,
            static_peer.clone(),
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
            listen_port,
            static_peer,
            node,
            crypto,
            messages: Vec::new(),
            message_ids: MessageIdGen::default(),
            seen_set: HashSet::new(),
            seen_order: VecDeque::new(),
            sequencer: CommitSequencer::new(),
            persistence: self.persistence.clone(),
            needs_rejoin: false,
            control_channel,
            data_channel: format!("{DATA_CHANNEL_PREFIX}{}", invite.group_id),
            blob_channel: format!("{BLOB_CHANNEL_PREFIX}{}", invite.group_id),
            attachment_store: Arc::clone(&self.attachment_store),
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
            outbound_attempts: HashMap::new(),
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
        let result = session.send_attachment(file_name, mime, bytes, thumbnail, voice)?;
        self.persist_group_tail();
        Ok(result)
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
        let (group_id_owned, data_channel, message_id, sent_at_ms, ciphertext_bytes, payload) = {
            let session = self
                .groups
                .get_mut(group_id)
                .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
            if !session.joined {
                return Err(PrivateGroupError::NotReady);
            }
            let ciphertext = session.crypto.encrypt(body.as_bytes())?;
            let mut message = session.stamp_message(GroupMessage {
                from_device: session.display_name.clone(),
                from_fingerprint: session.device_fingerprint.clone(),
                body,
                message_id: None,
                sent_at_ms: None,
                attachment: None,
                delivery_status: Some(MessageDeliveryStatus::Pending),
                delivery_error: None,
                retryable: None,
                retry_count: Some(0),
            });
            let message_id = message.message_id.clone().unwrap_or_default();
            let sent_at_ms = message.sent_at_ms.unwrap_or_else(now_ms);
            message.message_id = Some(message_id.clone());
            message.sent_at_ms = Some(sent_at_ms);
            let envelope = DataEnvelope {
                group_id: session.group_id.clone(),
                participant_id: session.participant_id.clone(),
                from_device: session.display_name.clone(),
                from_fingerprint: session.device_fingerprint.clone(),
                message_id: Some(message_id.clone()),
                sent_at_ms: Some(sent_at_ms),
                ciphertext_b64: encode(&ciphertext),
            };
            let payload = serde_json::to_vec(&envelope)
                .map_err(|error| PrivateGroupError::Codec(error.to_string()))?;
            let attempt = OutboundAttemptRecord {
                conversation_id: session.group_id.clone(),
                message_id: message_id.clone(),
                sent_at_ms,
                ciphertext_bytes: ciphertext.len(),
                message_json: serde_json::to_string(&message)
                    .map_err(|error| PrivateGroupError::Codec(error.to_string()))?,
                publish_payload_b64: encode(&payload),
                delivery_status: MessageDeliveryStatus::Pending,
                delivery_error: None,
                retry_count: 0,
            };
            session.upsert_message(message);
            session
                .outbound_attempts
                .insert(message_id.clone(), attempt);
            (
                session.group_id.clone(),
                session.data_channel.clone(),
                message_id,
                sent_at_ms,
                ciphertext.len(),
                payload,
            )
        };
        self.persist_outbound_state(group_id, &message_id, true);
        let publish = {
            let session = self
                .groups
                .get(group_id)
                .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
            session
                .node
                .publish(&data_channel, &payload)
                .map_err(|error| PrivateGroupError::Moss(error.to_string()))
        };
        let result = match publish {
            Ok(()) => {
                let session = self
                    .groups
                    .get_mut(group_id)
                    .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
                session.mark_delivery(&message_id, MessageDeliveryStatus::Sent, None, 0)?;
                session.outbound_attempts.remove(&message_id);
                GroupSendResult {
                    group_id: group_id_owned,
                    bytes: ciphertext_bytes,
                    message_id: message_id.clone(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Sent,
                    delivery_error: None,
                }
            }
            Err(error) => {
                let error_text = error.to_string();
                let session = self
                    .groups
                    .get_mut(group_id)
                    .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
                let retry_count =
                    if let Some(attempt) = session.outbound_attempts.get_mut(&message_id) {
                        attempt.delivery_status = MessageDeliveryStatus::Failed;
                        attempt.delivery_error = Some(error_text.clone());
                        attempt.retry_count
                    } else {
                        0
                    };
                session.mark_delivery(
                    &message_id,
                    MessageDeliveryStatus::Failed,
                    Some(error_text.clone()),
                    retry_count,
                )?;
                session.sync_attempt_message_json(&message_id)?;
                GroupSendResult {
                    group_id: group_id_owned,
                    bytes: ciphertext_bytes,
                    message_id: message_id.clone(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Failed,
                    delivery_error: Some(error_text),
                }
            }
        };
        self.persist_outbound_state(group_id, &message_id, false);
        self.persist_group_tail();
        Ok(result)
    }

    pub fn retry_message(
        &mut self,
        group_id: &str,
        message_id: &str,
    ) -> Result<GroupSendResult, PrivateGroupError> {
        self.drain_inbound()?;
        let (group_id_owned, data_channel, sent_at_ms, ciphertext_bytes, retry_count, payload) = {
            let session = self
                .groups
                .get_mut(group_id)
                .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
            let (payload_b64, sent_at_ms, ciphertext_bytes) = {
                let attempt = session
                    .outbound_attempts
                    .get_mut(message_id)
                    .ok_or_else(|| PrivateGroupError::MissingMessage(message_id.to_string()))?;
                attempt.retry_count = attempt.retry_count.saturating_add(1);
                attempt.delivery_status = MessageDeliveryStatus::Pending;
                attempt.delivery_error = None;
                (
                    attempt.publish_payload_b64.clone(),
                    attempt.sent_at_ms,
                    attempt.ciphertext_bytes,
                )
            };
            let payload = decode(&payload_b64)?;
            let retry_count = session
                .outbound_attempts
                .get(message_id)
                .map(|attempt| attempt.retry_count)
                .unwrap_or(0);
            session.mark_delivery(
                message_id,
                MessageDeliveryStatus::Pending,
                None,
                retry_count,
            )?;
            session.sync_attempt_message_json(message_id)?;
            (
                session.group_id.clone(),
                session.data_channel.clone(),
                sent_at_ms,
                ciphertext_bytes,
                retry_count,
                payload,
            )
        };
        self.persist_outbound_state(group_id, message_id, false);
        let publish = {
            let session = self
                .groups
                .get(group_id)
                .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
            session
                .node
                .publish(&data_channel, &payload)
                .map_err(|error| PrivateGroupError::Moss(error.to_string()))
        };
        let result = match publish {
            Ok(()) => {
                let session = self
                    .groups
                    .get_mut(group_id)
                    .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
                session.mark_delivery(
                    message_id,
                    MessageDeliveryStatus::Sent,
                    None,
                    retry_count,
                )?;
                session.outbound_attempts.remove(message_id);
                GroupSendResult {
                    group_id: group_id_owned,
                    bytes: ciphertext_bytes,
                    message_id: message_id.to_string(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Sent,
                    delivery_error: None,
                }
            }
            Err(error) => {
                let error_text = error.to_string();
                let session = self
                    .groups
                    .get_mut(group_id)
                    .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
                if let Some(attempt) = session.outbound_attempts.get_mut(message_id) {
                    attempt.delivery_status = MessageDeliveryStatus::Failed;
                    attempt.delivery_error = Some(error_text.clone());
                }
                session.mark_delivery(
                    message_id,
                    MessageDeliveryStatus::Failed,
                    Some(error_text.clone()),
                    retry_count,
                )?;
                session.sync_attempt_message_json(message_id)?;
                GroupSendResult {
                    group_id: group_id_owned,
                    bytes: ciphertext_bytes,
                    message_id: message_id.to_string(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Failed,
                    delivery_error: Some(error_text),
                }
            }
        };
        self.persist_outbound_state(group_id, message_id, false);
        Ok(result)
    }

    pub fn poll(&mut self, group_id: &str) -> Result<GroupSnapshot, PrivateGroupError> {
        self.drain_inbound()?;
        self.persist_group_tail();
        let session = self
            .groups
            .get(group_id)
            .ok_or_else(|| PrivateGroupError::MissingGroup(group_id.to_string()))?;
        Ok(session.snapshot())
    }

    pub fn list(&mut self) -> Result<GroupListSnapshot, PrivateGroupError> {
        self.drain_inbound()?;
        self.persist_group_tail();
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
        self.persisted_counts.remove(group_id);
        self.finalized_group_records.remove(group_id);
        if let Some(p) = self.persistence.as_ref() {
            if let Err(error) = p.delete_group(group_id) {
                eprintln!("failed to delete persisted group {group_id}: {error}");
            }
        }
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
                // A single bad inbound frame must never abort the drain — it
                // would also fail the caller (send/poll/list drain first). After
                // a restart the in-memory dedup set is empty, so the mesh
                // re-delivers already-consumed MLS messages whose decrypt fails
                // ("secret deleted for forward secrecy"); drop and keep going,
                // mirroring the DM runtime.
                if let Err(error) = session.handle_moss_message(message) {
                    eprintln!("dropping inbound group frame for {group_id}: {error}");
                }
            }
        }
        for session in self.groups.values_mut() {
            session.pump_attachment_requests();
        }
        Ok(())
    }

    fn persist_group_tail(&mut self) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let mut pending_records: Vec<(String, Vec<u8>)> = Vec::new();
        for session in self.groups.values() {
            let start = self
                .persisted_counts
                .get(&session.group_id)
                .copied()
                .unwrap_or(0);
            let has_new_messages = session.messages.len() > start;
            for (idx, msg) in session.messages.iter().enumerate().skip(start) {
                let sent_at_ms = msg.sent_at_ms.unwrap_or_else(now_ms);
                let message_id = msg
                    .message_id
                    .clone()
                    .unwrap_or_else(|| format!("{sent_at_ms}-{idx:06}"));
                let mut message = msg.clone();
                if message.sent_at_ms.is_none() {
                    message.sent_at_ms = Some(sent_at_ms);
                }
                if message.message_id.is_none() {
                    message.message_id = Some(message_id.clone());
                }
                let record = PersistedGroupMessage {
                    conversation_id: session.group_id.clone(),
                    sent_at_ms,
                    message_id: message_id.clone(),
                    message,
                };
                if let Ok(json) = serde_json::to_vec(&record) {
                    let _ =
                        p.append_group_message(&session.group_id, sent_at_ms, &message_id, &json);
                }
            }

            let needs_record_refresh = !self.finalized_group_records.contains(&session.group_id)
                && session.crypto.group_id_bytes().is_some();

            if has_new_messages || needs_record_refresh {
                let _ = p.put_group_mls_snapshot(&session.group_id, &session.crypto.snapshot());
            }

            if needs_record_refresh {
                if let Ok(json) = serde_json::to_vec(&session.to_persisted_record()) {
                    pending_records.push((session.group_id.clone(), json));
                }
            }
        }
        for (group_id, json) in pending_records {
            let _ = p.put_group(&group_id, &json);
            self.finalized_group_records.insert(group_id);
        }
        let new_counts: Vec<(String, usize)> = self
            .groups
            .values()
            .map(|group| (group.group_id.clone(), group.messages.len()))
            .collect();
        for (group_id, count) in new_counts {
            self.persisted_counts.insert(group_id, count);
        }
    }

    fn persist_outbound_state(&mut self, group_id: &str, message_id: &str, persist_snapshot: bool) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let (sent_at_ms, message_row, attempt_row, snapshot, group_row, needs_record_refresh) = {
            let Some(session) = self.groups.get(group_id) else {
                return;
            };
            let Some(message) = session
                .messages
                .iter()
                .find(|message| message.message_id.as_deref() == Some(message_id))
            else {
                return;
            };
            let sent_at_ms = message.sent_at_ms.unwrap_or_else(now_ms);
            let message_row = serde_json::to_vec(&PersistedGroupMessage {
                conversation_id: session.group_id.clone(),
                sent_at_ms,
                message_id: message_id.to_string(),
                message: message.clone(),
            })
            .ok();
            let attempt_row = session
                .outbound_attempts
                .get(message_id)
                .and_then(|attempt| serde_json::to_vec(attempt).ok());
            let snapshot = persist_snapshot.then(|| session.crypto.snapshot());
            let needs_record_refresh = !self.finalized_group_records.contains(group_id)
                && session.crypto.group_id_bytes().is_some();
            let group_row = needs_record_refresh
                .then(|| serde_json::to_vec(&session.to_persisted_record()).ok())
                .flatten();
            (
                sent_at_ms,
                message_row,
                attempt_row,
                snapshot,
                group_row,
                needs_record_refresh,
            )
        };

        if let Some(row) = message_row {
            let _ = p.append_group_message(group_id, sent_at_ms, message_id, &row);
        }
        if let Some(snapshot) = snapshot {
            let _ = p.put_group_mls_snapshot(group_id, &snapshot);
        }
        match attempt_row {
            Some(row) => {
                let _ = p.put_outbound_attempt(
                    OUTBOUND_SCOPE_PRIVATE_GROUP,
                    group_id,
                    message_id,
                    &row,
                );
            }
            None => {
                let _ =
                    p.delete_outbound_attempt(OUTBOUND_SCOPE_PRIVATE_GROUP, group_id, message_id);
            }
        }
        if let Some(row) = group_row {
            let _ = p.put_group(group_id, &row);
            if needs_record_refresh {
                self.finalized_group_records.insert(group_id.to_string());
            }
        }
    }
}

#[derive(Debug, PartialEq)]
enum SequenceOutcome {
    Done,
    /// A buffered commit exists that cannot be applied yet — the caller
    /// should request a resync.
    Gapped,
}

/// Node-free core of commit sequencing: classify by wire epoch, apply in
/// order, persist applied commits, drain any buffered successors.
fn sequence_commit(
    crypto: &mut MlsSessionCrypto,
    sequencer: &mut CommitSequencer,
    persistence: Option<&Persistence>,
    group_id: &str,
    commit_b64: &str,
) -> Result<SequenceOutcome, PrivateGroupError> {
    let Some(current) = crypto.epoch() else {
        return Ok(SequenceOutcome::Done);
    };
    let commit_bytes = decode(commit_b64)?;
    let wire_epoch = MlsSessionCrypto::commit_epoch(&commit_bytes)?;
    match sequencer.offer(current, wire_epoch, commit_b64) {
        Disposition::AlreadySeen => return Ok(SequenceOutcome::Done),
        Disposition::Buffered => {
            return Ok(if sequencer.gap(current) {
                SequenceOutcome::Gapped
            } else {
                SequenceOutcome::Done
            });
        }
        Disposition::Apply => {}
    }
    crypto.process_commit(&commit_bytes)?;
    log_group_commit(persistence, group_id, wire_epoch, &commit_bytes);
    // Buffered successors may be applicable now.
    while let Some(current) = crypto.epoch() {
        let Some(next_b64) = sequencer.drain_ready(current) else {
            break;
        };
        let next_bytes = decode(&next_b64)?;
        crypto.process_commit(&next_bytes)?;
        log_group_commit(persistence, group_id, current, &next_bytes);
    }
    Ok(SequenceOutcome::Done)
}

fn log_group_commit(
    persistence: Option<&Persistence>,
    group_id: &str,
    epoch: u64,
    commit_bytes: &[u8],
) {
    if let Some(p) = persistence {
        if let Err(e) = p.append_group_commit(group_id, epoch, commit_bytes) {
            eprintln!("group {group_id}: commit log write failed: {e}");
        }
    }
}

impl GroupSession {
    fn stamp_message(&self, mut message: GroupMessage) -> GroupMessage {
        let sent_at_ms = message.sent_at_ms.unwrap_or_else(now_ms);
        message.sent_at_ms = Some(sent_at_ms);
        if message.message_id.as_deref().unwrap_or_default().is_empty() {
            message.message_id = Some(self.message_ids.next(sent_at_ms));
        }
        message
    }

    fn upsert_message(&mut self, message: GroupMessage) {
        if let Some(message_id) = message.message_id.as_deref() {
            if let Some(existing) = self
                .messages
                .iter_mut()
                .find(|existing| existing.message_id.as_deref() == Some(message_id))
            {
                *existing = message;
                return;
            }
        }
        self.messages.push(message);
    }

    fn find_message_mut(&mut self, message_id: &str) -> Option<&mut GroupMessage> {
        self.messages
            .iter_mut()
            .find(|message| message.message_id.as_deref() == Some(message_id))
    }

    fn has_message(&self, candidate: &GroupMessage) -> bool {
        self.messages.iter().any(|existing| {
            existing.from_fingerprint == candidate.from_fingerprint
                && match (
                    existing.message_id.as_deref(),
                    candidate.message_id.as_deref(),
                ) {
                    (Some(left), Some(right)) if !left.is_empty() && !right.is_empty() => {
                        left == right
                    }
                    _ => {
                        existing.sent_at_ms == candidate.sent_at_ms
                            && existing.body == candidate.body
                    }
                }
        })
    }

    fn mark_delivery(
        &mut self,
        message_id: &str,
        status: MessageDeliveryStatus,
        error: Option<String>,
        retry_count: u32,
    ) -> Result<(), PrivateGroupError> {
        let message = self
            .find_message_mut(message_id)
            .ok_or_else(|| PrivateGroupError::MissingMessage(message_id.to_string()))?;
        apply_delivery(message, status, error, retry_count);
        Ok(())
    }

    fn sync_attempt_message_json(&mut self, message_id: &str) -> Result<(), PrivateGroupError> {
        let message_json = self
            .messages
            .iter()
            .find(|message| message.message_id.as_deref() == Some(message_id))
            .ok_or_else(|| PrivateGroupError::MissingMessage(message_id.to_string()))
            .and_then(|message| {
                serde_json::to_string(message)
                    .map_err(|error| PrivateGroupError::Codec(error.to_string()))
            })?;
        if let Some(attempt) = self.outbound_attempts.get_mut(message_id) {
            attempt.message_json = message_json;
        }
        Ok(())
    }

    fn to_persisted_record(&self) -> PersistedGroupSession {
        PersistedGroupSession {
            group_id: self.group_id.clone(),
            mesh_id: self.mesh_id.clone(),
            label: self.label.clone(),
            display_name: self.display_name.clone(),
            participant_id: self.participant_id.clone(),
            device_fingerprint: self.device_fingerprint.clone(),
            creator_fingerprint: self.creator_fingerprint.clone(),
            current_admin_fingerprint: self.current_admin_fingerprint.clone(),
            is_admin: self.is_admin,
            invite_uri: self.invite_uri.clone(),
            joined: self.joined,
            signer_public: self.crypto.signer_public(),
            mls_group_id: self.crypto.group_id_bytes().unwrap_or_default(),
            listen_port: self.listen_port,
            static_peer: self.static_peer.clone(),
        }
    }

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

    /// Merge a control-channel commit in epoch order. Duplicates and stale
    /// replays are no-ops; future commits are buffered and drained once their
    /// epoch is reached; an unreachable buffered commit triggers a resync
    /// request (spec §7).
    fn apply_commit_sequenced(&mut self, commit_b64: String) -> Result<(), PrivateGroupError> {
        let outcome = sequence_commit(
            &mut self.crypto,
            &mut self.sequencer,
            self.persistence.as_deref(),
            &self.group_id,
            &commit_b64,
        )?;
        match outcome {
            SequenceOutcome::Done => Ok(()),
            SequenceOutcome::Gapped => self.request_resync_if_gapped(),
        }
    }

    fn request_resync_if_gapped(&mut self) -> Result<(), PrivateGroupError> {
        // Filled in by the resync protocol (next commit in this branch).
        Ok(())
    }

    fn log_commit(&self, epoch: u64, commit_bytes: &[u8]) {
        log_group_commit(
            self.persistence.as_deref(),
            &self.group_id,
            epoch,
            commit_bytes,
        );
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
                let pre_epoch = self.crypto.epoch();
                let outcome = self.crypto.add_members(&[key_package.as_slice()])?;
                if let Some(epoch) = pre_epoch {
                    self.log_commit(epoch, &outcome.commit_bytes);
                }
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
                commit_b64,
            } if !self.joined
                && !self.is_admin
                && self.group_id == group_id
                && self.participant_id == for_participant_id
                && from_fingerprint == self.current_admin_fingerprint =>
            {
                self.crypto
                    .join_welcome(&decode(&welcome_b64)?, &decode(&tree_b64)?)?;
                self.joined = true;
                // The Welcome already carries the admission commit's state. The
                // admin also broadcasts that same commit on the control channel
                // for existing members, so mark it processed to skip re-applying
                // it to ourselves (which would error on the already-merged epoch).
                self.sequencer.mark_seen(commit_b64);
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
                self.apply_commit_sequenced(commit_b64)
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
                self.apply_commit_sequenced(commit_b64)
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
                let pre_epoch = self.crypto.epoch();
                let commit_bytes = self.crypto.commit_pending()?;
                if let Some(epoch) = pre_epoch {
                    self.log_commit(epoch, &commit_bytes);
                }
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
        let message = self.stamp_message(GroupMessage {
            from_device: envelope.from_device,
            from_fingerprint: envelope.from_fingerprint,
            body: String::from_utf8_lossy(&plaintext).into_owned(),
            message_id: envelope.message_id,
            sent_at_ms: envelope.sent_at_ms,
            attachment: None,
            delivery_status: None,
            delivery_error: None,
            retryable: None,
            retry_count: None,
        });
        if self.has_message(&message) {
            return Ok(());
        }
        self.messages.push(message);
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
        let message = self.stamp_message(GroupMessage {
            from_device,
            from_fingerprint,
            body: String::new(),
            message_id: None,
            sent_at_ms: None,
            attachment: Some(descriptor),
            delivery_status: None,
            delivery_error: None,
            retryable: None,
            retry_count: None,
        });
        self.messages.push(message);
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
        let manifest = self.attachments.prepare_outgoing(OutgoingAttachment {
            attachment_id: attachment_id.clone(),
            file_name,
            mime,
            from_fingerprint: self.device_fingerprint.clone(),
            bytes: bytes.clone(),
            thumbnail_b64: thumbnail,
            voice,
        })?;
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
        let message = self.stamp_message(GroupMessage {
            from_device: self.display_name.clone(),
            from_fingerprint: self.device_fingerprint.clone(),
            body: String::new(),
            message_id: None,
            sent_at_ms: None,
            attachment: Some(descriptor),
            delivery_status: None,
            delivery_error: None,
            retryable: None,
            retry_count: None,
        });
        self.messages.push(message);
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
                bind_interface: None,
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
    use crate::adapters::moss_ffi::{
        drain_received_messages, fail_next_test_publish, MossFfiRuntime, MOSS_TEST_LOCK,
    };
    use crate::adapters::persistence::Persistence;
    use std::path::PathBuf;

    fn temp_store() -> Arc<AttachmentStore> {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "mosh-group-attachments-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Arc::new(AttachmentStore::new(&path).expect("attachment store should init"))
    }

    #[test]
    fn sequence_commit_handles_out_of_order_duplicates_and_logs() {
        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!("mosh-seq-commit-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);
        let p = Persistence::open_with_dek(&db_path, [17u8; 32]).expect("store should open");

        // Admin + member, crypto only — no moss node involved.
        let mut admin = MlsSessionCrypto::new("admin").unwrap();
        admin.create_group().unwrap();
        let mut member = MlsSessionCrypto::new("member").unwrap();
        let kp = member.key_package_bytes().unwrap();
        let (welcome, tree) = admin.add_peer(&kp).unwrap();
        member.join_welcome(&welcome, &tree).unwrap();

        // Two successive membership commits the member has not seen yet.
        let mut dave = MlsSessionCrypto::new("dave").unwrap();
        let kp_d = dave.key_package_bytes().unwrap();
        let c1 = admin.add_members(&[kp_d.as_slice()]).unwrap();
        let mut erin = MlsSessionCrypto::new("erin").unwrap();
        let kp_e = erin.key_package_bytes().unwrap();
        let c2 = admin.add_members(&[kp_e.as_slice()]).unwrap();
        let c1_b64 = encode(&c1.commit_bytes);
        let c2_b64 = encode(&c2.commit_bytes);

        let mut seq = CommitSequencer::new();
        // Reordered delivery: the later commit first -> buffered + gap.
        let out = sequence_commit(&mut member, &mut seq, Some(&p), "g-seq", &c2_b64).unwrap();
        assert_eq!(out, SequenceOutcome::Gapped);
        assert_eq!(member.member_count(), 2, "future commit must not apply");
        // The missing commit arrives -> both apply, in order.
        let out = sequence_commit(&mut member, &mut seq, Some(&p), "g-seq", &c1_b64).unwrap();
        assert_eq!(out, SequenceOutcome::Done);
        assert_eq!(member.member_count(), 4);
        // Duplicate re-delivery is a no-op.
        let out = sequence_commit(&mut member, &mut seq, Some(&p), "g-seq", &c1_b64).unwrap();
        assert_eq!(out, SequenceOutcome::Done);
        assert_eq!(member.member_count(), 4);
        // Both applied commits landed in the log, ascending by epoch.
        let logged = p.list_group_commits_from("g-seq", 0).unwrap();
        assert_eq!(logged.len(), 2);
        assert!(logged[0].0 < logged[1].0);

        let _ = std::fs::remove_file(&db_path);
    }

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

    #[test]
    fn group_history_and_session_survive_restart() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!("mosh-group-rehydrate-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [13u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let group_id = {
            let mut groups = PrivateGroupRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let created = groups
                .create_group(CreateGroupRequest {
                    label: Some("Restart Club".to_string()),
                    display_name: "Alice".to_string(),
                    listen_port: 42240,
                    static_peer: None,
                })
                .expect("group should be created");
            groups
                .send(&created.group_id, "hello after group restart".to_string())
                .expect("group message should send");
            created.group_id
        };

        let mut revived = PrivateGroupRuntime::from_shared(
            Arc::clone(&runtime),
            temp_store(),
            Some(persistence.clone()),
        );
        revived.rehydrate();

        let listing = revived.list().expect("listing should pass");
        let group = listing
            .groups
            .iter()
            .find(|group| group.group_id == group_id)
            .expect("rehydrated group should be present");
        assert_eq!(group.label.as_deref(), Some("Restart Club"));
        assert!(
            group
                .messages
                .iter()
                .any(|message| message.body == "hello after group restart"),
            "rehydrated group message missing: {:?}",
            group.messages
        );

        let listing2 = revived.list().expect("second listing should pass");
        let group2 = listing2
            .groups
            .iter()
            .find(|group| group.group_id == group_id)
            .expect("group should still be present");
        let matching = group2
            .messages
            .iter()
            .filter(|message| message.body == "hello after group restart")
            .count();
        assert_eq!(matching, 1, "persist tail duplicated the group message");

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn failed_send_rehydrates_as_retryable_message() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!(
            "mosh-group-failed-send-{}.redb",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [21u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let (group_id, message_id) = {
            let mut groups = PrivateGroupRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let created = groups
                .create_group(CreateGroupRequest {
                    label: Some("Retry Club".to_string()),
                    display_name: "Alice".to_string(),
                    listen_port: 42241,
                    static_peer: None,
                })
                .expect("group should be created");
            let _publish_fail = fail_next_test_publish("simulated publish failure");
            let result = groups
                .send(&created.group_id, "hello failed group".to_string())
                .expect("send should return failed result");
            assert_eq!(result.delivery_status, MessageDeliveryStatus::Failed);
            assert_eq!(
                result.delivery_error.as_deref(),
                Some("Moss error: simulated publish failure")
            );

            let live = groups
                .poll(&created.group_id)
                .expect("poll should surface failed message");
            let failed = live
                .messages
                .iter()
                .find(|message| message.message_id.as_deref() == Some(result.message_id.as_str()))
                .expect("failed message should be recorded");
            assert_eq!(failed.delivery_status, Some(MessageDeliveryStatus::Failed));
            assert_eq!(failed.retryable, Some(true));

            (created.group_id, result.message_id)
        };

        let mut revived =
            PrivateGroupRuntime::from_shared(Arc::clone(&runtime), temp_store(), Some(persistence));
        revived.rehydrate();
        let listing = revived.list().expect("listing should pass");
        let group = listing
            .groups
            .iter()
            .find(|group| group.group_id == group_id)
            .expect("rehydrated group should be present");
        let failed = group
            .messages
            .iter()
            .find(|message| message.message_id.as_deref() == Some(message_id.as_str()))
            .expect("failed message should rehydrate");
        assert_eq!(failed.delivery_status, Some(MessageDeliveryStatus::Failed));
        assert_eq!(failed.retryable, Some(true));

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn retry_message_reuses_message_id_and_clears_failed_attempt() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!("mosh-group-retry-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [22u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let (group_id, failed_message_id) = {
            let mut groups = PrivateGroupRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            let created = groups
                .create_group(CreateGroupRequest {
                    label: Some("Retry Club".to_string()),
                    display_name: "Alice".to_string(),
                    listen_port: 42242,
                    static_peer: None,
                })
                .expect("group should be created");
            let _publish_fail = fail_next_test_publish("simulated publish failure");
            let failed = groups
                .send(&created.group_id, "retry this group message".to_string())
                .expect("failed send should still return a result");

            let retried = groups
                .retry_message(&created.group_id, &failed.message_id)
                .expect("retry should succeed");
            assert_eq!(retried.message_id, failed.message_id);
            assert_eq!(retried.delivery_status, MessageDeliveryStatus::Sent);

            let snapshot = groups.poll(&created.group_id).expect("poll should pass");
            let matching: Vec<&GroupMessage> = snapshot
                .messages
                .iter()
                .filter(|message| message.message_id.as_deref() == Some(failed.message_id.as_str()))
                .collect();
            assert_eq!(
                matching.len(),
                1,
                "retry should update, not duplicate, the row"
            );
            assert_eq!(
                matching[0].delivery_status,
                Some(MessageDeliveryStatus::Sent)
            );
            assert_eq!(matching[0].retry_count, Some(1));

            (created.group_id, failed.message_id)
        };

        let stored_attempt = persistence
            .get_outbound_attempt("private_group", &group_id, &failed_message_id)
            .expect("lookup should pass");
        assert!(stored_attempt.is_none());

        let _ = std::fs::remove_file(&db_path);
    }
}
