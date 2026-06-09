use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDeliveryStatus {
    Pending,
    Sent,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct MessageDeliveryMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_status: Option<MessageDeliveryStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_count: Option<u32>,
}

impl MessageDeliveryMeta {
    pub fn pending(retry_count: u32) -> Self {
        Self {
            delivery_status: Some(MessageDeliveryStatus::Pending),
            delivery_error: None,
            retryable: None,
            retry_count: Some(retry_count),
        }
    }

    pub fn sent(retry_count: u32) -> Self {
        Self {
            delivery_status: Some(MessageDeliveryStatus::Sent),
            delivery_error: None,
            retryable: None,
            retry_count: Some(retry_count),
        }
    }

    pub fn failed(error: impl Into<String>, retry_count: u32) -> Self {
        Self {
            delivery_status: Some(MessageDeliveryStatus::Failed),
            delivery_error: Some(error.into()),
            retryable: Some(true),
            retry_count: Some(retry_count),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundAttemptRecord {
    pub conversation_id: String,
    pub message_id: String,
    pub sent_at_ms: u64,
    pub ciphertext_bytes: usize,
    pub message_json: String,
    pub publish_payload_b64: String,
    pub delivery_status: MessageDeliveryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
    #[serde(default)]
    pub retry_count: u32,
}
