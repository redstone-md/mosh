use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};
use crate::adapters::private_dm_runtime::{MeshInfo, SnapshotEvent};

const TOPIC_PREFIX: &str = "public-channel/";
const MESH_PREFIX: &str = "channel/";
const MAX_NAME_LEN: usize = 64;
const MAX_BODY_LEN: usize = 4096;
const DEDUP_BUFFER_CAP: usize = 256;

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
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelSnapshot {
    pub name: String,
    pub topic: String,
    pub mesh_id: String,
    pub display_name: String,
    pub device_fingerprint: String,
    pub messages: Vec<ChannelMessage>,
    pub mesh: Option<MeshInfo>,
    pub events: Vec<SnapshotEvent>,
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
        }
    }
}

impl std::error::Error for ChannelRuntimeError {}

pub struct ChannelRuntime {
    moss: Arc<MossFfiRuntime>,
    channels: HashMap<String, ChannelSession>,
}

struct ChannelSession {
    name: String,
    topic: String,
    mesh_id: String,
    display_name: String,
    device_fingerprint: String,
    node: MossNode,
    messages: Vec<ChannelMessage>,
    seen_set: HashSet<String>,
    seen_order: VecDeque<String>,
}

impl ChannelRuntime {
    pub fn new(moss: MossFfiRuntime) -> Self {
        Self::from_shared(Arc::new(moss))
    }

    pub fn from_shared(moss: Arc<MossFfiRuntime>) -> Self {
        Self {
            moss,
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
        let node = start_channel_node(
            &self.moss,
            &mesh_id,
            &topic,
            request.listen_port,
            request.static_peer,
        )?;
        let device_fingerprint = node
            .public_key_hex()
            .ok_or_else(|| ChannelRuntimeError::Moss("public key unavailable".to_string()))?;

        let session = ChannelSession {
            name: normalized.clone(),
            topic,
            mesh_id,
            display_name: request.display_name,
            device_fingerprint,
            node,
            messages: Vec::new(),
            seen_set: HashSet::new(),
            seen_order: VecDeque::new(),
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
        let inbound =
            drain_messages_where(|message| channel_name_from_topic(&message.channel).is_some());
        for message in inbound {
            let name = match channel_name_from_topic(&message.channel) {
                Some(name) => name.to_string(),
                None => continue,
            };
            if let Some(session) = self.channels.get_mut(&name) {
                session.handle_message(message)?;
            }
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
        if message.channel != self.topic {
            return Ok(());
        }
        let envelope: ChannelMessage = serde_json::from_slice(&message.payload)
            .map_err(|error| ChannelRuntimeError::Codec(error.to_string()))?;
        if envelope.from_fingerprint == self.device_fingerprint {
            return Ok(());
        }
        self.messages.push(envelope);
        Ok(())
    }

    fn has_seen(&mut self, message: &MossReceivedMessage) -> bool {
        // Encoded payload already embeds the sender's fingerprint via the
        // ChannelMessage envelope, so it disambiguates per-peer publishes.
        let key = format!(
            "{}:{}",
            message.channel,
            base64_payload(&message.payload)
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

    fn snapshot(&self) -> ChannelSnapshot {
        ChannelSnapshot {
            name: self.name.clone(),
            topic: self.topic.clone(),
            mesh_id: self.mesh_id.clone(),
            display_name: self.display_name.clone(),
            device_fingerprint: self.device_fingerprint.clone(),
            messages: self.messages.clone(),
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

fn base64_payload(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
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
