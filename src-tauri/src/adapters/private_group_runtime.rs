use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::adapters::mls_crypto::{MlsCryptoError, MlsSessionCrypto};
use crate::adapters::moss_ffi::{
    clear_event_log, drain_messages_where, snapshot_event_log, MossFfiRuntime, MossNode,
    MossNodeConfig, MossReceivedMessage,
};
use crate::adapters::private_dm_runtime::{MeshInfo, SnapshotEvent};

const CONTROL_CHANNEL_PREFIX: &str = "group-control/";
const DATA_CHANNEL_PREFIX: &str = "group-data/";
const INVITE_PREFIX: &str = "mosh://group";
const MAX_LABEL_LEN: usize = 64;
const MAX_BODY_LEN: usize = 4096;

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
        welcome_b64: String,
        commit_b64: String,
        tree_b64: String,
    },
    Commit {
        group_id: String,
        commit_b64: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct DataEnvelope {
    group_id: String,
    participant_id: String,
    from_device: String,
    from_fingerprint: String,
    ciphertext_b64: String,
}

pub struct PrivateGroupRuntime {
    moss: Arc<MossFfiRuntime>,
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
    is_admin: bool,
    invite_uri: Option<String>,
    joined: bool,
    node: MossNode,
    crypto: MlsSessionCrypto,
    messages: Vec<GroupMessage>,
    seen: Vec<String>,
    control_channel: String,
    data_channel: String,
}

impl PrivateGroupRuntime {
    pub fn new(moss: MossFfiRuntime) -> Self {
        Self::from_shared(Arc::new(moss))
    }

    pub fn from_shared(moss: Arc<MossFfiRuntime>) -> Self {
        Self {
            moss,
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
            is_admin: true,
            invite_uri: Some(invite_uri.clone()),
            joined: true,
            node,
            crypto,
            messages: Vec::new(),
            seen: Vec::new(),
            control_channel: format!("{CONTROL_CHANNEL_PREFIX}{group_id}"),
            data_channel: format!("{DATA_CHANNEL_PREFIX}{group_id}"),
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
            creator_fingerprint: invite.creator_fingerprint,
            is_admin: false,
            invite_uri: Some(request.invite_uri),
            joined: false,
            node,
            crypto,
            messages: Vec::new(),
            seen: Vec::new(),
            control_channel,
            data_channel: format!("{DATA_CHANNEL_PREFIX}{}", invite.group_id),
        };
        self.groups.insert(invite.group_id.clone(), session);
        self.poll(&invite.group_id)
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
        let mut groups: Vec<GroupSnapshot> = self
            .groups
            .values()
            .map(GroupSession::snapshot)
            .collect();
        groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
        Ok(GroupListSnapshot { groups })
    }

    pub fn close(&mut self, group_id: &str) -> Result<GroupLeaveResult, PrivateGroupError> {
        match self.groups.remove(group_id) {
            Some(_) => Ok(GroupLeaveResult {
                group_id: group_id.to_string(),
                closed: true,
            }),
            None => Err(PrivateGroupError::MissingGroup(group_id.to_string())),
        }
    }

    fn drain_inbound(&mut self) -> Result<(), PrivateGroupError> {
        let inbound = drain_messages_where(|message| {
            message.channel.starts_with(CONTROL_CHANNEL_PREFIX)
                || message.channel.starts_with(DATA_CHANNEL_PREFIX)
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
        } else {
            Ok(())
        }
    }

    fn has_seen(&mut self, message: &MossReceivedMessage) -> bool {
        let key = format!("{}:{}", message.channel, encode(&message.payload));
        if self.seen.contains(&key) {
            return true;
        }
        self.seen.push(key);
        false
    }

    fn handle_control(&mut self, payload: Vec<u8>) -> Result<(), PrivateGroupError> {
        let envelope: ControlEnvelope = decode_json(&payload)?;
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
                let outcome = self
                    .crypto
                    .add_members(&[key_package.as_slice()])?;
                let welcome_envelope = ControlEnvelope::Welcome {
                    group_id: self.group_id.clone(),
                    for_participant_id: participant_id.clone(),
                    welcome_b64: encode(&outcome.welcome_bytes),
                    commit_b64: encode(&outcome.commit_bytes),
                    tree_b64: encode(&outcome.tree_bytes),
                };
                publish_json(&self.node, &self.control_channel, &welcome_envelope)
            }
            ControlEnvelope::Welcome {
                group_id,
                for_participant_id,
                welcome_b64,
                tree_b64,
                ..
            } if !self.joined
                && !self.is_admin
                && self.group_id == group_id
                && self.participant_id == for_participant_id =>
            {
                self.crypto
                    .join_welcome(&decode(&welcome_b64)?, &decode(&tree_b64)?)?;
                self.joined = true;
                Ok(())
            }
            ControlEnvelope::Welcome {
                group_id,
                commit_b64,
                ..
            } if self.joined && !self.is_admin && self.group_id == group_id => {
                let commit = decode(&commit_b64)?;
                self.crypto.process_commit(&commit)?;
                Ok(())
            }
            ControlEnvelope::Commit {
                group_id,
                commit_b64,
            } if self.joined && !self.is_admin && self.group_id == group_id => {
                let commit = decode(&commit_b64)?;
                self.crypto.process_commit(&commit)?;
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn handle_data(&mut self, payload: Vec<u8>) -> Result<(), PrivateGroupError> {
        let envelope: DataEnvelope = decode_json(&payload)?;
        if envelope.group_id != self.group_id
            || envelope.participant_id == self.participant_id
        {
            return Ok(());
        }
        let plaintext = self.crypto.decrypt(&decode(&envelope.ciphertext_b64)?)?;
        self.messages.push(GroupMessage {
            from_device: envelope.from_device,
            from_fingerprint: envelope.from_fingerprint,
            body: String::from_utf8_lossy(&plaintext).into_owned(),
        });
        Ok(())
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
    Ok(node)
}

fn publish_json<T: Serialize>(
    node: &MossNode,
    channel: &str,
    value: &T,
) -> Result<(), PrivateGroupError> {
    let payload = serde_json::to_vec(value)
        .map_err(|error| PrivateGroupError::Codec(error.to_string()))?;
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
            "AABBCCDDEEFF0011",
            &Some("Friends".to_string()),
        );
        let parsed = ParsedGroupInvite::parse(&uri).unwrap();
        assert_eq!(parsed.mesh_id, "groupmesh-aaa");
        assert_eq!(parsed.group_id, "group-bbb");
        assert_eq!(parsed.creator_fingerprint, "AABBCCDDEEFF0011");
        assert_eq!(parsed.label.as_deref(), Some("Friends"));
    }

    #[test]
    fn invite_uri_without_label() {
        let uri = build_invite_uri("m", "g", "FFEE", &None);
        let parsed = ParsedGroupInvite::parse(&uri).unwrap();
        assert!(parsed.label.is_none());
    }

    #[test]
    fn channel_group_id_strips_prefix() {
        assert_eq!(
            channel_group_id("group-control/g-1"),
            Some("g-1")
        );
        assert_eq!(channel_group_id("group-data/g-1"), Some("g-1"));
        assert_eq!(channel_group_id("public-channel/x"), None);
    }
}
