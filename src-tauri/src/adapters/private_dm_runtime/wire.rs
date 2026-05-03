use serde::{Deserialize, Serialize};

use super::contracts::PrivateDmRuntimeError;
use crate::adapters::moss_ffi::MossNode;

pub const CONTROL_CHANNEL: &str = "mls-control";
pub const DATA_CHANNEL: &str = "mls-data";

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ControlEnvelope {
    KeyPackage {
        session_id: String,
        from_device: String,
        key_package_b64: String,
    },
    Welcome {
        session_id: String,
        from_device: String,
        welcome_b64: String,
        ratchet_tree_b64: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DataEnvelope {
    pub session_id: String,
    pub from_device: String,
    pub ciphertext_b64: String,
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
