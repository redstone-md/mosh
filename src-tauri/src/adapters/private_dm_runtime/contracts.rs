use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartSessionRequest {
    pub display_name: String,
    pub listen_port: u16,
    pub static_peer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteCreated {
    pub invite_uri: String,
    pub session_id: String,
    pub mesh_id: String,
    pub fingerprint: String,
    pub listen_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptInviteRequest {
    pub invite_uri: String,
    pub display_name: String,
    pub listen_port: u16,
    pub static_peer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSnapshot {
    pub role: String,
    pub state: String,
    pub invite_uri: Option<String>,
    pub fingerprint: String,
    pub messages: Vec<ChatMessage>,
    pub mesh: Option<MeshInfo>,
    pub events: Vec<SnapshotEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotEvent {
    pub event_type: i32,
    pub event_name: String,
    pub detail_json: String,
    pub epoch_millis: u64,
}

impl SnapshotEvent {
    pub fn name_for(event_type: i32) -> &'static str {
        match event_type {
            1 => "peer_joined",
            2 => "peer_left",
            3 => "supernode_promoted",
            4 => "supernode_revoked",
            5 => "tracker_announce",
            6 => "tracker_failure",
            7 => "relay_migrated",
            _ => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MeshInfo {
    #[serde(default)]
    pub mesh_id: String,
    #[serde(default)]
    pub listen_port: i32,
    #[serde(default)]
    pub advertised_addr: String,
    #[serde(default)]
    pub peer_count: i32,
    #[serde(default)]
    pub direct_peer_count: i32,
    #[serde(default)]
    pub relayed_peer_count: i32,
    #[serde(default)]
    pub relay_capable_peer_count: i32,
    #[serde(default)]
    pub relay_session_count: i32,
    #[serde(default)]
    pub relay_route_count: i32,
    #[serde(default)]
    pub known_peer_count: i32,
    #[serde(default)]
    pub channels: Vec<String>,
    #[serde(default)]
    pub nat_type: String,
    #[serde(default)]
    pub supernode_ready: bool,
    #[serde(default)]
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub from_device: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SendMessageResult {
    pub state: String,
    pub ciphertext_bytes: usize,
}

#[derive(Debug)]
pub enum PrivateDmRuntimeError {
    Moss(String),
    OpenMls(String),
    Codec(String),
    InvalidInvite(String),
    NotReady,
    MissingSession,
}

impl std::fmt::Display for PrivateDmRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Moss(error) => write!(formatter, "Moss error: {error}"),
            Self::OpenMls(error) => write!(formatter, "OpenMLS error: {error}"),
            Self::Codec(error) => write!(formatter, "codec error: {error}"),
            Self::InvalidInvite(error) => write!(formatter, "invalid invite: {error}"),
            Self::NotReady => write!(formatter, "private DM session is not ready"),
            Self::MissingSession => write!(formatter, "private DM session is missing"),
        }
    }
}

impl std::error::Error for PrivateDmRuntimeError {}
