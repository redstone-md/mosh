use serde::{Deserialize, Serialize};

use crate::adapters::attachment_runtime::VoiceMeta;
use crate::adapters::mls_crypto::MlsCryptoError;

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
    pub session_id: String,
    pub mesh_id: String,
    pub role: String,
    pub display_name: String,
    pub state: String,
    pub invite_uri: Option<String>,
    pub fingerprint: String,
    pub messages: Vec<ChatMessage>,
    pub attachments: Vec<AttachmentView>,
    pub mesh: Option<MeshInfo>,
    pub events: Vec<SnapshotEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_call: Option<PendingCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_call: Option<ActiveCall>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionListSnapshot {
    pub sessions: Vec<SessionSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CloseSessionResult {
    pub session_id: String,
    pub closed: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<AttachmentDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_event: Option<CallEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingCall {
    pub call_id: String,
    pub from_device: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActiveCall {
    pub call_id: String,
    /// "caller" or "callee" — drives the nonce direction bit on the frontend.
    pub direction: String,
    pub key_b64: String,
    pub nonce_prefix_b64: String,
    /// Unix millis when the call became Active. The frontend renders the
    /// running timer from this anchor.
    pub started_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallEvent {
    /// "completed" or "missed".
    pub kind: String,
    pub duration_ms: u64,
    pub call_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CallStarted {
    pub session_id: String,
    pub call_id: String,
    pub key_b64: String,
    pub nonce_prefix_b64: String,
}

/// Body of an MLS-encrypted CallOffer. Never crosses the wire in the clear:
/// the runtime serialises it to JSON, encrypts via the session's MLS
/// application-message key, and ships the ciphertext in
/// `ControlEnvelope::CallOffer::offer_ciphertext_b64`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallOfferBody {
    pub key_b64: String,
    pub nonce_prefix_b64: String,
}

/// Immutable attachment metadata stamped onto the message log. Mutable
/// transfer state is reported separately through AttachmentView.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentDescriptor {
    pub attachment_id: String,
    pub content_hash: String,
    pub file_name: String,
    pub mime: String,
    pub total_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<VoiceMeta>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentState {
    /// Bytes are on disk locally (sender's own file, or a finished download).
    Available,
    /// Manifest known, download not started yet.
    Offered,
    /// Chunks are in flight.
    Downloading,
    /// Transfer or verification failed; a retry is possible.
    Failed,
    /// Either side cancelled the transfer.
    Cancelled,
}

/// Live transfer state for one attachment, recomputed on every snapshot.
#[derive(Debug, Clone, Serialize)]
pub struct AttachmentView {
    pub attachment_id: String,
    pub direction: String,
    pub state: AttachmentState,
    pub completed_chunks: u64,
    pub chunk_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentSendResult {
    pub session_id: String,
    pub attachment_id: String,
    pub content_hash: String,
}

/// A request to start a private DM, surfaced inside a channel or group. The
/// initiator publishes it; the targeted member accepts the carried invite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmOffer {
    pub offer_id: String,
    pub from_device: String,
    pub from_fingerprint: String,
    pub target_fingerprint: String,
    pub invite_uri: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SendMessageResult {
    pub session_id: String,
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
    DuplicateSession(String),
    Attachment(String),
    MissingAttachment(String),
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
            Self::DuplicateSession(id) => {
                write!(formatter, "private DM session already exists: {id}")
            }
            Self::Attachment(error) => write!(formatter, "attachment error: {error}"),
            Self::MissingAttachment(id) => {
                write!(formatter, "attachment not found: {id}")
            }
        }
    }
}

impl std::error::Error for PrivateDmRuntimeError {}

impl From<MlsCryptoError> for PrivateDmRuntimeError {
    fn from(error: MlsCryptoError) -> Self {
        match error {
            MlsCryptoError::OpenMls(message) => Self::OpenMls(message),
            MlsCryptoError::Codec(message) => Self::Codec(message),
            MlsCryptoError::NotReady => Self::NotReady,
        }
    }
}

impl From<crate::adapters::attachment_runtime::AttachmentRuntimeError> for PrivateDmRuntimeError {
    fn from(error: crate::adapters::attachment_runtime::AttachmentRuntimeError) -> Self {
        Self::Attachment(error.to_string())
    }
}

impl From<crate::adapters::attachment_store::AttachmentStoreError> for PrivateDmRuntimeError {
    fn from(error: crate::adapters::attachment_store::AttachmentStoreError) -> Self {
        Self::Attachment(error.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedMessage {
    pub conversation_id: String,
    pub sent_at_ms: u64,
    pub message_id: String,
    pub from_device: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSession {
    pub role_is_alice: bool,
    pub display_name: String,
    pub participant_id: String,
    pub session_id: String,
    pub mesh_id: String,
    pub fingerprint: String,
    pub invite_uri: Option<String>,
    pub signer_public: Vec<u8>,
    pub group_id: Vec<u8>,
    pub listen_port: u16,
    pub static_peer: Option<String>,
}
