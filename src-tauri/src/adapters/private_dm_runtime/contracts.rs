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
