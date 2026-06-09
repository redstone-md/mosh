use serde::{Deserialize, Serialize};

use super::contracts::PrivateDmRuntimeError;
use crate::adapters::attachment_runtime::{ChunkFrame, ChunkRequest};
use crate::adapters::moss_ffi::MossNode;

pub const CONTROL_CHANNEL_PREFIX: &str = "mls-control/";
pub const DATA_CHANNEL_PREFIX: &str = "mls-data/";
pub const BLOB_CHANNEL_PREFIX: &str = "mls-blob/";
pub const VOICE_CALL_CHANNEL_PREFIX: &str = "voice-call/";

pub fn control_channel(session_id: &str) -> String {
    format!("{CONTROL_CHANNEL_PREFIX}{session_id}")
}

pub fn data_channel(session_id: &str) -> String {
    format!("{DATA_CHANNEL_PREFIX}{session_id}")
}

pub fn blob_channel(session_id: &str) -> String {
    format!("{BLOB_CHANNEL_PREFIX}{session_id}")
}

pub fn voice_call_channel(call_id: &str) -> String {
    format!("{VOICE_CALL_CHANNEL_PREFIX}{call_id}")
}

pub fn channel_session_id(channel: &str) -> Option<&str> {
    channel
        .strip_prefix(CONTROL_CHANNEL_PREFIX)
        .or_else(|| channel.strip_prefix(DATA_CHANNEL_PREFIX))
        .or_else(|| channel.strip_prefix(BLOB_CHANNEL_PREFIX))
}

pub fn channel_call_id(channel: &str) -> Option<&str> {
    channel.strip_prefix(VOICE_CALL_CHANNEL_PREFIX)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ControlEnvelope {
    KeyPackage {
        session_id: String,
        participant_id: String,
        from_device: String,
        key_package_b64: String,
    },
    Welcome {
        session_id: String,
        participant_id: String,
        from_device: String,
        welcome_b64: String,
        ratchet_tree_b64: String,
    },
    /// Carries an AttachmentManifest encrypted as an MLS application message,
    /// so the per-attachment AES key never crosses the wire in the clear.
    AttachmentManifest {
        session_id: String,
        participant_id: String,
        from_device: String,
        manifest_ciphertext_b64: String,
    },
    /// Initiates a 1:1 voice call. The body — a JSON object carrying the
    /// per-call AES-GCM key and the 4-byte nonce prefix — is encrypted as an
    /// MLS application message so the key never crosses the wire in the
    /// clear.
    CallOffer {
        session_id: String,
        participant_id: String,
        from_device: String,
        call_id: String,
        offer_ciphertext_b64: String,
    },
    CallAccept {
        session_id: String,
        participant_id: String,
        call_id: String,
    },
    CallDecline {
        session_id: String,
        participant_id: String,
        call_id: String,
        reason: String,
    },
    CallEnd {
        session_id: String,
        participant_id: String,
        call_id: String,
        reason: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DataEnvelope {
    pub session_id: String,
    pub participant_id: String,
    pub from_device: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at_ms: Option<u64>,
    pub ciphertext_b64: String,
}

/// Traffic on the dedicated blob channel. Chunk payloads are already
/// AES-GCM encrypted by the attachment runtime, so this envelope stays
/// plaintext and only routes requests and ciphertext chunks.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BlobEnvelope {
    Request {
        participant_id: String,
        request: ChunkRequest,
    },
    Chunk {
        participant_id: String,
        frame: ChunkFrame,
    },
}

pub fn publish_json<T: Serialize>(
    node: &MossNode,
    channel: &str,
    value: &T,
) -> Result<(), PrivateDmRuntimeError> {
    let payload = serde_json::to_vec(value)
        .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))?;

    node.publish(channel, &payload)
        .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))
}

pub fn decode_json<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, PrivateDmRuntimeError> {
    serde_json::from_slice(bytes).map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))
}

pub fn encode(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

pub fn decode(encoded: &str) -> Result<Vec<u8>, PrivateDmRuntimeError> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|error| PrivateDmRuntimeError::Codec(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn call_offer_roundtrip() {
        let envelope = ControlEnvelope::CallOffer {
            session_id: "s".into(),
            participant_id: "p".into(),
            from_device: "d".into(),
            call_id: "c".into(),
            offer_ciphertext_b64: "Y2lwaGVy".into(),
        };
        let json = serde_json::to_string(&envelope).expect("ser");
        let back: ControlEnvelope = serde_json::from_str(&json).expect("de");
        match back {
            ControlEnvelope::CallOffer {
                call_id,
                offer_ciphertext_b64,
                ..
            } => {
                assert_eq!(call_id, "c");
                assert_eq!(offer_ciphertext_b64, "Y2lwaGVy");
            }
            _ => panic!("expected CallOffer"),
        }
    }

    #[test]
    fn call_lifecycle_variants_roundtrip() {
        let accept = ControlEnvelope::CallAccept {
            session_id: "s".into(),
            participant_id: "p".into(),
            call_id: "c".into(),
        };
        let bytes = serde_json::to_vec(&accept).unwrap();
        assert!(matches!(
            serde_json::from_slice::<ControlEnvelope>(&bytes).unwrap(),
            ControlEnvelope::CallAccept { .. }
        ));

        let decline = ControlEnvelope::CallDecline {
            session_id: "s".into(),
            participant_id: "p".into(),
            call_id: "c".into(),
            reason: "busy".into(),
        };
        let bytes = serde_json::to_vec(&decline).unwrap();
        assert!(matches!(
            serde_json::from_slice::<ControlEnvelope>(&bytes).unwrap(),
            ControlEnvelope::CallDecline { .. }
        ));

        let end = ControlEnvelope::CallEnd {
            session_id: "s".into(),
            participant_id: "p".into(),
            call_id: "c".into(),
            reason: "hangup".into(),
        };
        let bytes = serde_json::to_vec(&end).unwrap();
        assert!(matches!(
            serde_json::from_slice::<ControlEnvelope>(&bytes).unwrap(),
            ControlEnvelope::CallEnd { .. }
        ));
    }

    #[test]
    fn voice_call_channel_uses_a_distinct_prefix() {
        let channel = voice_call_channel("call-xyz");
        assert_eq!(channel, "voice-call/call-xyz");
        assert_eq!(channel_call_id(&channel), Some("call-xyz"));
        assert!(channel_session_id(&channel).is_none());
        assert!(channel_call_id(&control_channel("s")).is_none());
        assert!(channel_call_id(&data_channel("s")).is_none());
        assert!(channel_call_id(&blob_channel("s")).is_none());
    }
}
