use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::adapters::attachment_crypto::sha256_hex;
use crate::adapters::attachment_runtime::{
    AttachmentManifest, AttachmentRuntime, ChunkFrame, ChunkOutcome, ChunkRequest,
    OutgoingAttachment, StreamRange, CHUNK_SIZE,
};
use crate::adapters::attachment_store::AttachmentStore;
use crate::adapters::message_id::MessageIdGen;
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

const TOPIC_PREFIX: &str = "public-channel/";
const BLOB_PREFIX: &str = "channel-blob/";
const MESH_PREFIX: &str = "channel/";
const MAX_NAME_LEN: usize = 64;
const MAX_BODY_LEN: usize = 4096;
const DEDUP_BUFFER_CAP: usize = 4096;
const OUTBOUND_SCOPE_CHANNEL: &str = "channel";

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn apply_delivery(
    message: &mut ChannelMessage,
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
pub struct JoinChannelRequest {
    pub name: String,
    pub display_name: String,
    pub listen_port: u16,
    pub static_peer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMessage {
    pub from_device: String,
    pub from_fingerprint: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
pub struct ChannelSnapshot {
    pub name: String,
    pub topic: String,
    pub mesh_id: String,
    pub display_name: String,
    pub device_fingerprint: String,
    pub messages: Vec<ChannelMessage>,
    pub attachments: Vec<AttachmentView>,
    pub dm_offers: Vec<DmOffer>,
    pub mesh: Option<MeshInfo>,
    pub events: Vec<SnapshotEvent>,
}

/// Blob-channel traffic for public channels. There is no MLS layer here,
/// so the manifest (and its AES key) travels in the clear: a public
/// channel offers integrity, not confidentiality. Chunk payloads are
/// still AES-GCM sealed by the attachment runtime.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ChannelBlobEnvelope {
    Manifest {
        from_device: String,
        from_fingerprint: String,
        manifest: AttachmentManifest,
    },
    Request {
        from_fingerprint: String,
        request: ChunkRequest,
    },
    Chunk {
        from_fingerprint: String,
        frame: ChunkFrame,
    },
    /// A private-DM invitation aimed at one channel member.
    DmOffer { offer: DmOffer },
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
struct PersistedChannelMessage {
    conversation_id: String,
    sent_at_ms: u64,
    message_id: String,
    message: ChannelMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedChannelSession {
    name: String,
    topic: String,
    blob_topic: String,
    mesh_id: String,
    display_name: String,
    device_fingerprint: String,
    listen_port: u16,
    static_peer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelListSnapshot {
    pub channels: Vec<ChannelSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelSendResult {
    pub name: String,
    pub bytes: usize,
    pub message_id: String,
    pub sent_at_ms: u64,
    pub delivery_status: MessageDeliveryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelLeaveResult {
    pub name: String,
    pub closed: bool,
}

#[derive(Debug)]
pub enum ChannelRuntimeError {
    Moss(String),
    Codec(String),
    InvalidName(String),
    BodyTooLarge,
    MissingChannel(String),
    MissingMessage(String),
    DuplicateChannel(String),
    Attachment(String),
    MissingAttachment(String),
}

impl std::fmt::Display for ChannelRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Moss(error) => write!(formatter, "Moss error: {error}"),
            Self::Codec(error) => write!(formatter, "codec error: {error}"),
            Self::InvalidName(name) => write!(formatter, "invalid channel name: {name}"),
            Self::BodyTooLarge => write!(formatter, "channel message too large"),
            Self::MissingChannel(name) => write!(formatter, "channel not joined: {name}"),
            Self::MissingMessage(id) => write!(formatter, "channel message missing: {id}"),
            Self::DuplicateChannel(name) => write!(formatter, "already joined channel: {name}"),
            Self::Attachment(error) => write!(formatter, "attachment error: {error}"),
            Self::MissingAttachment(id) => write!(formatter, "attachment not found: {id}"),
        }
    }
}

impl std::error::Error for ChannelRuntimeError {}

impl From<crate::adapters::attachment_runtime::AttachmentRuntimeError> for ChannelRuntimeError {
    fn from(error: crate::adapters::attachment_runtime::AttachmentRuntimeError) -> Self {
        Self::Attachment(error.to_string())
    }
}

impl From<crate::adapters::attachment_store::AttachmentStoreError> for ChannelRuntimeError {
    fn from(error: crate::adapters::attachment_store::AttachmentStoreError) -> Self {
        Self::Attachment(error.to_string())
    }
}

pub struct ChannelRuntime {
    moss: Arc<MossFfiRuntime>,
    attachment_store: Arc<AttachmentStore>,
    persistence: Option<Arc<Persistence>>,
    persisted_counts: HashMap<String, usize>,
    channels: HashMap<String, ChannelSession>,
}

struct ChannelSession {
    name: String,
    topic: String,
    blob_topic: String,
    mesh_id: String,
    display_name: String,
    device_fingerprint: String,
    listen_port: u16,
    static_peer: Option<String>,
    node: MossNode,
    messages: Vec<ChannelMessage>,
    message_ids: MessageIdGen,
    seen_set: HashSet<String>,
    seen_order: VecDeque<String>,
    attachment_store: Arc<AttachmentStore>,
    attachments: AttachmentRuntime,
    attachment_slots: HashMap<String, AttachmentSlot>,
    outbound_attempts: HashMap<String, OutboundAttemptRecord>,
    dm_offers: Vec<DmOffer>,
}

impl ChannelRuntime {
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
            channels: HashMap::new(),
        }
    }

    /// Restore joined public channels and local scrollback from encrypted disk.
    pub fn rehydrate(&mut self) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let rows = match p.list_channels() {
            Ok(rows) => rows,
            Err(_) => return,
        };
        for row in rows {
            let rec: PersistedChannelSession = match serde_json::from_slice(&row) {
                Ok(record) => record,
                Err(error) => {
                    eprintln!("channel rehydrate: bad channel row: {error}");
                    continue;
                }
            };
            let node = match start_channel_node(
                &self.moss,
                &rec.mesh_id,
                &rec.topic,
                &rec.blob_topic,
                rec.listen_port,
                rec.static_peer.clone(),
            ) {
                Ok(node) => node,
                Err(error) => {
                    eprintln!(
                        "channel rehydrate: node start failed for {}: {error}",
                        rec.name
                    );
                    continue;
                }
            };
            let mut session = ChannelSession {
                name: rec.name.clone(),
                topic: rec.topic.clone(),
                blob_topic: rec.blob_topic.clone(),
                mesh_id: rec.mesh_id.clone(),
                display_name: rec.display_name.clone(),
                device_fingerprint: node
                    .public_key_hex()
                    .unwrap_or_else(|| rec.device_fingerprint.clone()),
                listen_port: rec.listen_port,
                static_peer: rec.static_peer.clone(),
                node,
                messages: Vec::new(),
                message_ids: MessageIdGen::default(),
                seen_set: HashSet::new(),
                seen_order: VecDeque::new(),
                attachment_store: Arc::clone(&self.attachment_store),
                attachments: AttachmentRuntime::new(),
                attachment_slots: HashMap::new(),
                outbound_attempts: HashMap::new(),
                dm_offers: Vec::new(),
            };
            if let Ok(messages) = p.list_channel_messages(&rec.name) {
                for row in messages {
                    if let Ok(persisted) = serde_json::from_slice::<PersistedChannelMessage>(&row) {
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
            if let Ok(rows) = p.list_outbound_attempts(OUTBOUND_SCOPE_CHANNEL, &rec.name) {
                for row in rows {
                    let Ok(attempt) = serde_json::from_slice::<OutboundAttemptRecord>(&row) else {
                        continue;
                    };
                    let Ok(mut message) =
                        serde_json::from_str::<ChannelMessage>(&attempt.message_json)
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
                .insert(rec.name.clone(), session.messages.len());
            self.channels.insert(rec.name, session);
        }
    }

    pub fn join(
        &mut self,
        request: JoinChannelRequest,
    ) -> Result<ChannelSnapshot, ChannelRuntimeError> {
        let normalized = normalize_name(&request.name)?;
        if self.channels.contains_key(&normalized) {
            return Err(ChannelRuntimeError::DuplicateChannel(normalized));
        }
        let listen_port = request.listen_port;
        let static_peer = request.static_peer.clone();

        let mesh_id = format!("{MESH_PREFIX}{normalized}");
        let topic = format!("{TOPIC_PREFIX}{normalized}");
        let blob_topic = format!("{BLOB_PREFIX}{normalized}");
        let node = start_channel_node(
            &self.moss,
            &mesh_id,
            &topic,
            &blob_topic,
            listen_port,
            static_peer.clone(),
        )?;
        let device_fingerprint = node
            .public_key_hex()
            .ok_or_else(|| ChannelRuntimeError::Moss("public key unavailable".to_string()))?;

        let session = ChannelSession {
            name: normalized.clone(),
            topic,
            blob_topic,
            mesh_id,
            display_name: request.display_name,
            device_fingerprint,
            listen_port,
            static_peer,
            node,
            messages: Vec::new(),
            message_ids: MessageIdGen::default(),
            seen_set: HashSet::new(),
            seen_order: VecDeque::new(),
            attachment_store: Arc::clone(&self.attachment_store),
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
            outbound_attempts: HashMap::new(),
            dm_offers: Vec::new(),
        };

        self.channels.insert(normalized.clone(), session);
        self.persist_channel_tail();
        self.poll(&normalized)
    }

    /// Publishes a private-DM invitation aimed at one channel member.
    pub fn send_dm_offer(
        &mut self,
        name: &str,
        target_fingerprint: String,
        invite_uri: String,
    ) -> Result<(), ChannelRuntimeError> {
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        let offer = DmOffer {
            offer_id: format!("offer-{}", &sha256_hex(invite_uri.as_bytes())[..16]),
            from_device: session.display_name.clone(),
            from_fingerprint: session.device_fingerprint.clone(),
            target_fingerprint,
            invite_uri,
        };
        publish_json(
            &session.node,
            &session.blob_topic,
            &ChannelBlobEnvelope::DmOffer { offer },
        )
    }

    pub fn dismiss_dm_offer(
        &mut self,
        name: &str,
        offer_id: &str,
    ) -> Result<(), ChannelRuntimeError> {
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        session.dm_offers.retain(|offer| offer.offer_id != offer_id);
        Ok(())
    }

    pub fn leave(&mut self, name: &str) -> Result<ChannelLeaveResult, ChannelRuntimeError> {
        let normalized = normalize_name(name)?;
        match self.channels.remove(&normalized) {
            Some(_) => {
                self.persisted_counts.remove(&normalized);
                if let Some(p) = self.persistence.as_ref() {
                    if let Err(error) = p.delete_channel(&normalized) {
                        eprintln!("failed to delete persisted channel {normalized}: {error}");
                    }
                }
                Ok(ChannelLeaveResult {
                    name: normalized,
                    closed: true,
                })
            }
            None => Err(ChannelRuntimeError::MissingChannel(normalized)),
        }
    }

    pub fn send(
        &mut self,
        name: &str,
        body: String,
    ) -> Result<ChannelSendResult, ChannelRuntimeError> {
        if body.len() > MAX_BODY_LEN {
            return Err(ChannelRuntimeError::BodyTooLarge);
        }
        self.drain_inbound()?;
        let normalized = normalize_name(name)?;
        let (channel_name, topic, message_id, sent_at_ms, payload_len, payload) = {
            let session = self
                .channels
                .get_mut(&normalized)
                .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
            let mut message = session.stamp_message(ChannelMessage {
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
            let payload = serde_json::to_vec(&session.publishable_message(&message))
                .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
            let attempt = OutboundAttemptRecord {
                conversation_id: session.name.clone(),
                message_id: message_id.clone(),
                sent_at_ms,
                ciphertext_bytes: payload.len(),
                message_json: serde_json::to_string(&message)
                    .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?,
                publish_payload_b64: encode(&payload),
                delivery_status: MessageDeliveryStatus::Pending,
                delivery_error: None,
                retry_count: 0,
                // Channels have no DeliveryAck flow; the resend fields are
                // inert here.
                auto_resends: 0,
                last_send_ms: sent_at_ms,
            };
            session.upsert_message(message);
            session
                .outbound_attempts
                .insert(message_id.clone(), attempt);
            (
                session.name.clone(),
                session.topic.clone(),
                message_id,
                sent_at_ms,
                payload.len(),
                payload,
            )
        };
        self.persist_outbound_state(&normalized, &message_id);
        let publish = {
            let session = self
                .channels
                .get(&normalized)
                .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
            session
                .node
                .publish(&topic, &payload)
                .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))
        };
        let result = match publish {
            Ok(()) => {
                let session = self
                    .channels
                    .get_mut(&normalized)
                    .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
                session.mark_delivery(&message_id, MessageDeliveryStatus::Sent, None, 0)?;
                session.outbound_attempts.remove(&message_id);
                ChannelSendResult {
                    name: channel_name,
                    bytes: payload_len,
                    message_id: message_id.clone(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Sent,
                    delivery_error: None,
                }
            }
            Err(error) => {
                let error_text = error.to_string();
                let session = self
                    .channels
                    .get_mut(&normalized)
                    .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
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
                ChannelSendResult {
                    name: channel_name,
                    bytes: payload_len,
                    message_id: message_id.clone(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Failed,
                    delivery_error: Some(error_text),
                }
            }
        };
        self.persist_outbound_state(&normalized, &message_id);
        self.persist_channel_tail();
        Ok(result)
    }

    pub fn retry_message(
        &mut self,
        name: &str,
        message_id: &str,
    ) -> Result<ChannelSendResult, ChannelRuntimeError> {
        self.drain_inbound()?;
        let normalized = normalize_name(name)?;
        let (channel_name, topic, sent_at_ms, payload_len, retry_count, payload) = {
            let session = self
                .channels
                .get_mut(&normalized)
                .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
            let (payload_b64, sent_at_ms, payload_len) = {
                let attempt = session
                    .outbound_attempts
                    .get_mut(message_id)
                    .ok_or_else(|| ChannelRuntimeError::MissingMessage(message_id.to_string()))?;
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
                session.name.clone(),
                session.topic.clone(),
                sent_at_ms,
                payload_len,
                retry_count,
                payload,
            )
        };
        self.persist_outbound_state(&normalized, message_id);
        let publish = {
            let session = self
                .channels
                .get(&normalized)
                .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
            session
                .node
                .publish(&topic, &payload)
                .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))
        };
        let result = match publish {
            Ok(()) => {
                let session = self
                    .channels
                    .get_mut(&normalized)
                    .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
                session.mark_delivery(
                    message_id,
                    MessageDeliveryStatus::Sent,
                    None,
                    retry_count,
                )?;
                session.outbound_attempts.remove(message_id);
                ChannelSendResult {
                    name: channel_name,
                    bytes: payload_len,
                    message_id: message_id.to_string(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Sent,
                    delivery_error: None,
                }
            }
            Err(error) => {
                let error_text = error.to_string();
                let session = self
                    .channels
                    .get_mut(&normalized)
                    .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
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
                ChannelSendResult {
                    name: channel_name,
                    bytes: payload_len,
                    message_id: message_id.to_string(),
                    sent_at_ms,
                    delivery_status: MessageDeliveryStatus::Failed,
                    delivery_error: Some(error_text),
                }
            }
        };
        self.persist_outbound_state(&normalized, message_id);
        self.persist_channel_tail();
        Ok(result)
    }

    /// Encrypts a file, stores the sender's copy, and broadcasts the manifest
    /// on the channel's plaintext blob topic.
    pub fn send_attachment(
        &mut self,
        name: &str,
        file_name: String,
        mime: String,
        bytes: Vec<u8>,
        thumbnail: Option<String>,
        voice: Option<VoiceMeta>,
    ) -> Result<AttachmentSendResult, ChannelRuntimeError> {
        self.drain_inbound()?;
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        let result = session.send_attachment(file_name, mime, bytes, thumbnail, voice)?;
        self.persist_channel_tail();
        Ok(result)
    }

    pub fn download_attachment(
        &mut self,
        name: &str,
        attachment_id: &str,
    ) -> Result<(), ChannelRuntimeError> {
        self.drain_inbound()?;
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        session.start_attachment_download(attachment_id)?;
        session.pump_attachment_requests();
        Ok(())
    }

    pub fn cancel_attachment(
        &mut self,
        name: &str,
        attachment_id: &str,
    ) -> Result<(), ChannelRuntimeError> {
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        session.cancel_attachment(attachment_id)
    }

    /// Serves a byte range for streaming playback of a channel attachment.
    pub fn stream_attachment_range(
        &mut self,
        name: &str,
        attachment_id: &str,
        start: u64,
        end: u64,
    ) -> Result<StreamRange, ChannelRuntimeError> {
        self.drain_inbound()?;
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        if let Some(slot) = session.attachment_slots.get_mut(attachment_id) {
            slot.download_requested = true;
            slot.cancelled = false;
        }
        let _ = session.attachments.start_download(attachment_id);
        let outcome = session.attachments.stream_range(attachment_id, start, end);
        session.pump_attachment_requests();
        Ok(outcome)
    }

    pub fn poll(&mut self, name: &str) -> Result<ChannelSnapshot, ChannelRuntimeError> {
        self.drain_inbound()?;
        self.persist_channel_tail();
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        Ok(session.snapshot())
    }

    pub fn list(&mut self) -> Result<ChannelListSnapshot, ChannelRuntimeError> {
        self.drain_inbound()?;
        self.persist_channel_tail();
        let mut channels: Vec<ChannelSnapshot> = self
            .channels
            .values()
            .map(ChannelSession::snapshot)
            .collect();
        channels.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(ChannelListSnapshot { channels })
    }

    pub fn drain_inbound(&mut self) -> Result<(), ChannelRuntimeError> {
        let inbound = drain_messages_where(|message| {
            channel_name_from_topic(&message.channel).is_some()
                || channel_name_from_blob(&message.channel).is_some()
        });
        for message in inbound {
            let name = channel_name_from_topic(&message.channel)
                .or_else(|| channel_name_from_blob(&message.channel))
                .map(|value| value.to_string());
            let Some(name) = name else {
                continue;
            };
            if let Some(session) = self.channels.get_mut(&name) {
                session.handle_message(message)?;
            }
        }
        for session in self.channels.values_mut() {
            session.pump_attachment_requests();
        }
        Ok(())
    }

    fn persist_channel_tail(&mut self) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        for session in self.channels.values() {
            let start = self
                .persisted_counts
                .get(&session.name)
                .copied()
                .unwrap_or(0);
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
                let record = PersistedChannelMessage {
                    conversation_id: session.name.clone(),
                    sent_at_ms,
                    message_id: message_id.clone(),
                    message,
                };
                if let Ok(json) = serde_json::to_vec(&record) {
                    let _ = p.append_channel_message(&session.name, sent_at_ms, &message_id, &json);
                }
            }
            if let Ok(json) = serde_json::to_vec(&session.to_persisted_record()) {
                let _ = p.put_channel(&session.name, &json);
            }
        }
        let new_counts: Vec<(String, usize)> = self
            .channels
            .values()
            .map(|channel| (channel.name.clone(), channel.messages.len()))
            .collect();
        for (name, count) in new_counts {
            self.persisted_counts.insert(name, count);
        }
    }

    fn persist_outbound_state(&mut self, name: &str, message_id: &str) {
        let Some(p) = self.persistence.as_ref().cloned() else {
            return;
        };
        let (channel_row, message_row, attempt_row, sent_at_ms) = {
            let Some(session) = self.channels.get(name) else {
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
            let message_row = serde_json::to_vec(&PersistedChannelMessage {
                conversation_id: session.name.clone(),
                sent_at_ms,
                message_id: message_id.to_string(),
                message: message.clone(),
            })
            .ok();
            let channel_row = serde_json::to_vec(&session.to_persisted_record()).ok();
            let attempt_row = session
                .outbound_attempts
                .get(message_id)
                .and_then(|attempt| serde_json::to_vec(attempt).ok());
            (channel_row, message_row, attempt_row, sent_at_ms)
        };

        if let Some(row) = message_row {
            let _ = p.append_channel_message(name, sent_at_ms, message_id, &row);
        }
        match attempt_row {
            Some(row) => {
                let _ = p.put_outbound_attempt(OUTBOUND_SCOPE_CHANNEL, name, message_id, &row);
            }
            None => {
                let _ = p.delete_outbound_attempt(OUTBOUND_SCOPE_CHANNEL, name, message_id);
            }
        }
        if let Some(row) = channel_row {
            let _ = p.put_channel(name, &row);
        }
    }
}

impl ChannelSession {
    fn stamp_message(&self, mut message: ChannelMessage) -> ChannelMessage {
        let sent_at_ms = message.sent_at_ms.unwrap_or_else(now_ms);
        message.sent_at_ms = Some(sent_at_ms);
        if message.message_id.as_deref().unwrap_or_default().is_empty() {
            message.message_id = Some(self.message_ids.next(sent_at_ms));
        }
        message
    }

    fn publishable_message(&self, message: &ChannelMessage) -> ChannelMessage {
        let mut publishable = message.clone();
        publishable.delivery_status = None;
        publishable.delivery_error = None;
        publishable.retryable = None;
        publishable.retry_count = None;
        publishable
    }

    fn upsert_message(&mut self, message: ChannelMessage) {
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

    fn find_message_mut(&mut self, message_id: &str) -> Option<&mut ChannelMessage> {
        self.messages
            .iter_mut()
            .find(|message| message.message_id.as_deref() == Some(message_id))
    }

    fn mark_delivery(
        &mut self,
        message_id: &str,
        status: MessageDeliveryStatus,
        error: Option<String>,
        retry_count: u32,
    ) -> Result<(), ChannelRuntimeError> {
        let message = self
            .find_message_mut(message_id)
            .ok_or_else(|| ChannelRuntimeError::MissingMessage(message_id.to_string()))?;
        apply_delivery(message, status, error, retry_count);
        Ok(())
    }

    fn sync_attempt_message_json(&mut self, message_id: &str) -> Result<(), ChannelRuntimeError> {
        let message_json = self
            .messages
            .iter()
            .find(|message| message.message_id.as_deref() == Some(message_id))
            .ok_or_else(|| ChannelRuntimeError::MissingMessage(message_id.to_string()))
            .and_then(|message| {
                serde_json::to_string(message)
                    .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))
            })?;
        if let Some(attempt) = self.outbound_attempts.get_mut(message_id) {
            attempt.message_json = message_json;
        }
        Ok(())
    }

    fn to_persisted_record(&self) -> PersistedChannelSession {
        PersistedChannelSession {
            name: self.name.clone(),
            topic: self.topic.clone(),
            blob_topic: self.blob_topic.clone(),
            mesh_id: self.mesh_id.clone(),
            display_name: self.display_name.clone(),
            device_fingerprint: self.device_fingerprint.clone(),
            listen_port: self.listen_port,
            static_peer: self.static_peer.clone(),
        }
    }

    fn handle_message(&mut self, message: MossReceivedMessage) -> Result<(), ChannelRuntimeError> {
        if self.has_seen(&message) {
            return Ok(());
        }
        if message.channel == self.topic {
            let envelope: ChannelMessage = serde_json::from_slice(&message.payload)
                .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
            if self.has_message(&envelope) {
                return Ok(());
            }
            if envelope.from_fingerprint == self.device_fingerprint {
                return Ok(());
            }
            self.messages.push(self.stamp_message(envelope));
            Ok(())
        } else if message.channel == self.blob_topic {
            self.handle_blob(message.payload)
        } else {
            Ok(())
        }
    }

    fn handle_blob(&mut self, payload: Vec<u8>) -> Result<(), ChannelRuntimeError> {
        let envelope: ChannelBlobEnvelope = serde_json::from_slice(&payload)
            .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
        match envelope {
            ChannelBlobEnvelope::Manifest {
                from_device,
                from_fingerprint,
                manifest,
            } if from_fingerprint != self.device_fingerprint => {
                self.accept_incoming_manifest(from_device, from_fingerprint, manifest)
            }
            ChannelBlobEnvelope::Request {
                from_fingerprint,
                request,
            } if from_fingerprint != self.device_fingerprint => {
                let frames = match self.attachments.serve_chunks(&request) {
                    Ok(frames) => frames,
                    Err(_) => return Ok(()),
                };
                for frame in frames {
                    let chunk = ChannelBlobEnvelope::Chunk {
                        from_fingerprint: self.device_fingerprint.clone(),
                        frame,
                    };
                    publish_json(&self.node, &self.blob_topic, &chunk)?;
                }
                Ok(())
            }
            ChannelBlobEnvelope::DmOffer { offer }
                if offer.target_fingerprint == self.device_fingerprint
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
            ChannelBlobEnvelope::Chunk {
                from_fingerprint,
                frame,
            } if from_fingerprint != self.device_fingerprint => {
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
    ) -> Result<(), ChannelRuntimeError> {
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
        let message = self.stamp_message(ChannelMessage {
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
    ) -> Result<AttachmentSendResult, ChannelRuntimeError> {
        let attachment_id = format!("attachment-{}", &sha256_hex(&bytes)[..16]);
        if self.attachment_slots.contains_key(&attachment_id) {
            return Err(ChannelRuntimeError::Attachment(
                "attachment already shared on this channel".to_string(),
            ));
        }
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
        let envelope = ChannelBlobEnvelope::Manifest {
            from_device: self.display_name.clone(),
            from_fingerprint: self.device_fingerprint.clone(),
            manifest: manifest.clone(),
        };
        publish_json(&self.node, &self.blob_topic, &envelope)?;

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
        let message = self.stamp_message(ChannelMessage {
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
            session_id: self.name.clone(),
            attachment_id,
            content_hash: manifest.content_hash,
        })
    }

    fn start_attachment_download(
        &mut self,
        attachment_id: &str,
    ) -> Result<(), ChannelRuntimeError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| ChannelRuntimeError::MissingAttachment(attachment_id.to_string()))?;
        if slot.direction != AttachmentDirection::Incoming {
            return Err(ChannelRuntimeError::Attachment(
                "cannot download an outgoing attachment".to_string(),
            ));
        }
        slot.download_requested = true;
        slot.failed = false;
        slot.cancelled = false;
        self.attachments.start_download(attachment_id)?;
        Ok(())
    }

    fn cancel_attachment(&mut self, attachment_id: &str) -> Result<(), ChannelRuntimeError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| ChannelRuntimeError::MissingAttachment(attachment_id.to_string()))?;
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
                let envelope = ChannelBlobEnvelope::Request {
                    from_fingerprint: self.device_fingerprint.clone(),
                    request,
                };
                let _ = publish_json(&self.node, &self.blob_topic, &envelope);
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

    fn has_seen(&mut self, message: &MossReceivedMessage) -> bool {
        let key = format!("{}:{}", message.channel, sha256_hex(&message.payload));
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

    fn has_message(&self, candidate: &ChannelMessage) -> bool {
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

    fn snapshot(&self) -> ChannelSnapshot {
        ChannelSnapshot {
            name: self.name.clone(),
            topic: self.topic.clone(),
            mesh_id: self.mesh_id.clone(),
            display_name: self.display_name.clone(),
            device_fingerprint: self.device_fingerprint.clone(),
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
}

fn start_channel_node(
    runtime: &Arc<MossFfiRuntime>,
    mesh_id: &str,
    topic: &str,
    blob_topic: &str,
    listen_port: u16,
    static_peer: Option<String>,
) -> Result<MossNode, ChannelRuntimeError> {
    let node = runtime
        .init_default_node(
            mesh_id,
            &MossNodeConfig {
                listen_port,
                static_peer,
                bind_interface: None,
            },
        )
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))?;
    node.set_message_callback()
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))?;
    node.set_event_callback()
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))?;
    clear_event_log();
    node.start()
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))?;
    node.subscribe(topic)
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))?;
    node.subscribe(blob_topic)
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))?;
    Ok(node)
}

pub fn normalize_name(raw: &str) -> Result<String, ChannelRuntimeError> {
    let trimmed = raw.trim().trim_start_matches('#').trim_start_matches('@');
    if trimmed.is_empty() || trimmed.len() > MAX_NAME_LEN {
        return Err(ChannelRuntimeError::InvalidName(raw.to_string()));
    }
    let normalized: String = trimmed.chars().map(|c| c.to_ascii_lowercase()).collect();
    if !normalized
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ChannelRuntimeError::InvalidName(raw.to_string()));
    }
    Ok(normalized)
}

fn channel_name_from_topic(topic: &str) -> Option<&str> {
    topic.strip_prefix(TOPIC_PREFIX)
}

fn channel_name_from_blob(topic: &str) -> Option<&str> {
    topic.strip_prefix(BLOB_PREFIX)
}

fn publish_json<T: Serialize>(
    node: &MossNode,
    topic: &str,
    value: &T,
) -> Result<(), ChannelRuntimeError> {
    let payload =
        serde_json::to_vec(value).map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
    node.publish(topic, &payload)
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))
}

fn encode(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

fn decode(encoded: &str) -> Result<Vec<u8>, ChannelRuntimeError> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))
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
            "mosh-channel-attachments-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Arc::new(AttachmentStore::new(&path).expect("attachment store should init"))
    }

    #[test]
    fn normalize_strips_prefix_and_lowercases() {
        assert_eq!(normalize_name("@MOSH-DEV").unwrap(), "mosh-dev");
        assert_eq!(normalize_name("#general_chat").unwrap(), "general_chat");
        assert_eq!(normalize_name("  spaced  ").unwrap(), "spaced");
    }

    #[test]
    fn normalize_rejects_invalid_input() {
        assert!(normalize_name("").is_err());
        assert!(normalize_name("with spaces").is_err());
        assert!(normalize_name("emoji😀").is_err());
        assert!(normalize_name(&"a".repeat(MAX_NAME_LEN + 1)).is_err());
    }

    #[test]
    fn channel_name_strips_topic_prefix() {
        assert_eq!(
            channel_name_from_topic("public-channel/mosh-dev"),
            Some("mosh-dev")
        );
        assert_eq!(channel_name_from_topic("mls-control/sid"), None);
    }

    #[test]
    fn channel_history_survives_restart_without_duplicate_tail() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drain_received_messages();

        let mut db_path: PathBuf = std::env::temp_dir();
        db_path.push(format!(
            "mosh-channel-rehydrate-{}.redb",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [16u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        {
            let mut channels = ChannelRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            channels
                .join(JoinChannelRequest {
                    name: "restart-channel".to_string(),
                    display_name: "Alice".to_string(),
                    listen_port: 42340,
                    static_peer: None,
                })
                .expect("channel should join");
            channels
                .send("restart-channel", "hello after channel restart".to_string())
                .expect("channel message should send");
        }

        let mut revived = ChannelRuntime::from_shared(
            Arc::clone(&runtime),
            temp_store(),
            Some(persistence.clone()),
        );
        revived.rehydrate();

        let listing = revived.list().expect("listing should pass");
        let channel = listing
            .channels
            .iter()
            .find(|channel| channel.name == "restart-channel")
            .expect("rehydrated channel should be present");
        assert!(
            channel
                .messages
                .iter()
                .any(|message| message.body == "hello after channel restart"),
            "rehydrated channel message missing: {:?}",
            channel.messages
        );

        let listing2 = revived.list().expect("second listing should pass");
        let channel2 = listing2
            .channels
            .iter()
            .find(|channel| channel.name == "restart-channel")
            .expect("channel should still be present");
        let matching = channel2
            .messages
            .iter()
            .filter(|message| message.body == "hello after channel restart")
            .count();
        assert_eq!(matching, 1, "persist tail duplicated the channel message");

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
            "mosh-channel-failed-send-{}.redb",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [17u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let message_id = {
            let mut channels = ChannelRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            channels
                .join(JoinChannelRequest {
                    name: "retry-channel".to_string(),
                    display_name: "Alice".to_string(),
                    listen_port: 42341,
                    static_peer: None,
                })
                .expect("channel should join");
            let _publish_fail = fail_next_test_publish("simulated publish failure");
            let result = channels
                .send("retry-channel", "hello failed channel".to_string())
                .expect("send should return failed result");
            assert_eq!(result.delivery_status, MessageDeliveryStatus::Failed);
            assert_eq!(
                result.delivery_error.as_deref(),
                Some("Moss error: simulated publish failure")
            );

            let live = channels
                .poll("retry-channel")
                .expect("poll should surface failed message");
            let failed = live
                .messages
                .iter()
                .find(|message| message.message_id.as_deref() == Some(result.message_id.as_str()))
                .expect("failed message should be recorded");
            assert_eq!(failed.delivery_status, Some(MessageDeliveryStatus::Failed));
            assert_eq!(failed.retryable, Some(true));

            result.message_id
        };

        let mut revived =
            ChannelRuntime::from_shared(Arc::clone(&runtime), temp_store(), Some(persistence));
        revived.rehydrate();
        let listing = revived.list().expect("listing should pass");
        let channel = listing
            .channels
            .iter()
            .find(|channel| channel.name == "retry-channel")
            .expect("rehydrated channel should be present");
        let failed = channel
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
        db_path.push(format!("mosh-channel-retry-{}.redb", std::process::id()));
        let _ = std::fs::remove_file(&db_path);

        let persistence =
            Arc::new(Persistence::open_with_dek(&db_path, [18u8; 32]).expect("store should open"));
        let runtime = Arc::new(MossFfiRuntime::load_default().expect("Moss runtime should load"));

        let failed_message_id = {
            let mut channels = ChannelRuntime::from_shared(
                Arc::clone(&runtime),
                temp_store(),
                Some(persistence.clone()),
            );
            channels
                .join(JoinChannelRequest {
                    name: "retry-channel".to_string(),
                    display_name: "Alice".to_string(),
                    listen_port: 42342,
                    static_peer: None,
                })
                .expect("channel should join");
            let _publish_fail = fail_next_test_publish("simulated publish failure");
            let failed = channels
                .send("retry-channel", "retry this channel message".to_string())
                .expect("failed send should still return a result");

            let retried = channels
                .retry_message("retry-channel", &failed.message_id)
                .expect("retry should succeed");
            assert_eq!(retried.message_id, failed.message_id);
            assert_eq!(retried.delivery_status, MessageDeliveryStatus::Sent);

            let snapshot = channels.poll("retry-channel").expect("poll should pass");
            let matching: Vec<&ChannelMessage> = snapshot
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

            failed.message_id
        };

        let stored_attempt = persistence
            .get_outbound_attempt("channel", "retry-channel", &failed_message_id)
            .expect("lookup should pass");
        assert!(stored_attempt.is_none());

        let _ = std::fs::remove_file(&db_path);
    }
}
