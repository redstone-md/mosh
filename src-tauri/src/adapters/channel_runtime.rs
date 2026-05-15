use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::adapters::attachment_crypto::sha256_hex;
use crate::adapters::attachment_runtime::{
    AttachmentManifest, AttachmentRuntime, ChunkFrame, ChunkOutcome, ChunkRequest, CHUNK_SIZE,
};
use crate::adapters::attachment_store::AttachmentStore;
use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};
use crate::adapters::private_dm_runtime::{
    AttachmentDescriptor, AttachmentSendResult, AttachmentState, AttachmentView, MeshInfo,
    SnapshotEvent,
};

const TOPIC_PREFIX: &str = "public-channel/";
const BLOB_PREFIX: &str = "channel-blob/";
const MESH_PREFIX: &str = "channel/";
const MAX_NAME_LEN: usize = 64;
const MAX_BODY_LEN: usize = 4096;
const DEDUP_BUFFER_CAP: usize = 4096;

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
    pub attachment: Option<AttachmentDescriptor>,
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

#[derive(Debug, Clone, Serialize)]
pub struct ChannelListSnapshot {
    pub channels: Vec<ChannelSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelSendResult {
    pub name: String,
    pub bytes: usize,
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
    channels: HashMap<String, ChannelSession>,
}

struct ChannelSession {
    name: String,
    topic: String,
    blob_topic: String,
    mesh_id: String,
    display_name: String,
    device_fingerprint: String,
    node: MossNode,
    messages: Vec<ChannelMessage>,
    seen_set: HashSet<String>,
    seen_order: VecDeque<String>,
    attachment_store: Arc<AttachmentStore>,
    attachments: AttachmentRuntime,
    attachment_slots: HashMap<String, AttachmentSlot>,
}

impl ChannelRuntime {
    pub fn new(moss: MossFfiRuntime, attachment_store: Arc<AttachmentStore>) -> Self {
        Self::from_shared(Arc::new(moss), attachment_store)
    }

    pub fn from_shared(
        moss: Arc<MossFfiRuntime>,
        attachment_store: Arc<AttachmentStore>,
    ) -> Self {
        Self {
            moss,
            attachment_store,
            channels: HashMap::new(),
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

        let mesh_id = format!("{MESH_PREFIX}{normalized}");
        let topic = format!("{TOPIC_PREFIX}{normalized}");
        let blob_topic = format!("{BLOB_PREFIX}{normalized}");
        let node = start_channel_node(
            &self.moss,
            &mesh_id,
            &topic,
            &blob_topic,
            request.listen_port,
            request.static_peer,
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
            node,
            messages: Vec::new(),
            seen_set: HashSet::new(),
            seen_order: VecDeque::new(),
            attachment_store: Arc::clone(&self.attachment_store),
            attachments: AttachmentRuntime::new(),
            attachment_slots: HashMap::new(),
        };

        self.channels.insert(normalized.clone(), session);
        self.poll(&normalized)
    }

    pub fn leave(&mut self, name: &str) -> Result<ChannelLeaveResult, ChannelRuntimeError> {
        let normalized = normalize_name(name)?;
        match self.channels.remove(&normalized) {
            Some(_) => Ok(ChannelLeaveResult {
                name: normalized,
                closed: true,
            }),
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
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        let envelope = ChannelMessage {
            from_device: session.display_name.clone(),
            from_fingerprint: session.device_fingerprint.clone(),
            body: body.clone(),
            attachment: None,
        };
        let payload = serde_json::to_vec(&envelope)
            .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
        session
            .node
            .publish(&session.topic, &payload)
            .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))?;
        session.messages.push(envelope);

        Ok(ChannelSendResult {
            name: normalized,
            bytes: payload.len(),
        })
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
    ) -> Result<AttachmentSendResult, ChannelRuntimeError> {
        self.drain_inbound()?;
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get_mut(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        session.send_attachment(file_name, mime, bytes, thumbnail)
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

    pub fn poll(&mut self, name: &str) -> Result<ChannelSnapshot, ChannelRuntimeError> {
        self.drain_inbound()?;
        let normalized = normalize_name(name)?;
        let session = self
            .channels
            .get(&normalized)
            .ok_or_else(|| ChannelRuntimeError::MissingChannel(normalized.clone()))?;
        Ok(session.snapshot())
    }

    pub fn list(&mut self) -> Result<ChannelListSnapshot, ChannelRuntimeError> {
        self.drain_inbound()?;
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
}

impl ChannelSession {
    fn handle_message(
        &mut self,
        message: MossReceivedMessage,
    ) -> Result<(), ChannelRuntimeError> {
        if self.has_seen(&message) {
            return Ok(());
        }
        if message.channel == self.topic {
            let envelope: ChannelMessage = serde_json::from_slice(&message.payload)
                .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
            if envelope.from_fingerprint == self.device_fingerprint {
                return Ok(());
            }
            self.messages.push(envelope);
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
            ChannelBlobEnvelope::Chunk {
                from_fingerprint,
                frame,
            } if from_fingerprint != self.device_fingerprint => {
                let attachment_id = frame.attachment_id.clone();
                match self.attachments.ingest_chunk(&frame) {
                    Ok(ChunkOutcome::Complete {
                        content_hash, bytes, ..
                    }) => {
                        let path = self
                            .attachment_store
                            .write_blob(&content_hash, &bytes)?;
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
        self.messages.push(ChannelMessage {
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
    ) -> Result<AttachmentSendResult, ChannelRuntimeError> {
        let attachment_id = format!("attachment-{}", &sha256_hex(&bytes)[..16]);
        if self.attachment_slots.contains_key(&attachment_id) {
            return Err(ChannelRuntimeError::Attachment(
                "attachment already shared on this channel".to_string(),
            ));
        }
        let manifest = self.attachments.prepare_outgoing(
            attachment_id.clone(),
            file_name,
            mime,
            self.device_fingerprint.clone(),
            bytes.clone(),
            thumbnail,
        )?;
        let stored = self
            .attachment_store
            .write_blob(&manifest.content_hash, &bytes)?;
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
        self.messages.push(ChannelMessage {
            from_device: self.display_name.clone(),
            from_fingerprint: self.device_fingerprint.clone(),
            body: String::new(),
            attachment: Some(descriptor),
        });
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
            .ok_or_else(|| {
                ChannelRuntimeError::MissingAttachment(attachment_id.to_string())
            })?;
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

    fn cancel_attachment(
        &mut self,
        attachment_id: &str,
    ) -> Result<(), ChannelRuntimeError> {
        let slot = self
            .attachment_slots
            .get_mut(attachment_id)
            .ok_or_else(|| {
                ChannelRuntimeError::MissingAttachment(attachment_id.to_string())
            })?;
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

    fn snapshot(&self) -> ChannelSnapshot {
        ChannelSnapshot {
            name: self.name.clone(),
            topic: self.topic.clone(),
            mesh_id: self.mesh_id.clone(),
            display_name: self.display_name.clone(),
            device_fingerprint: self.device_fingerprint.clone(),
            messages: self.messages.clone(),
            attachments: self.attachment_views(),
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
    let normalized: String = trimmed
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .collect();
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
    let payload = serde_json::to_vec(value)
        .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
    node.publish(topic, &payload)
        .map_err(|error| ChannelRuntimeError::Moss(error.to_string()))
}

fn descriptor_of(manifest: &AttachmentManifest) -> AttachmentDescriptor {
    AttachmentDescriptor {
        attachment_id: manifest.attachment_id.clone(),
        content_hash: manifest.content_hash.clone(),
        file_name: manifest.file_name.clone(),
        mime: manifest.mime.clone(),
        total_size: manifest.total_size,
        thumbnail_b64: manifest.thumbnail_b64.clone(),
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
}
