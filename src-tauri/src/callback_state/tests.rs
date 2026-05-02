use super::{valid_webrtc_signal, MAX_WEBRTC_SIGNAL_DATA_BYTES};
use crate::chat_protocol::ChatPayload;

fn signal(signal_type: &str, signal_data: &str) -> ChatPayload {
    ChatPayload {
        kind: "webrtc_signal".to_string(),
        call_id: "voice:lobby".to_string(),
        signal_type: signal_type.to_string(),
        signal_data: signal_data.to_string(),
        ..ChatPayload::default()
    }
}

#[test]
fn webrtc_signal_validation_accepts_supported_json_payloads() {
    assert!(valid_webrtc_signal(&signal(
        "offer",
        r#"{"type":"offer","sdp":"v=0"}"#
    )));
}

#[test]
fn webrtc_signal_validation_rejects_bad_type_json_and_size() {
    assert!(!valid_webrtc_signal(&signal("renegotiate", "{}")));
    assert!(!valid_webrtc_signal(&signal("offer", "{")));
    assert!(!valid_webrtc_signal(&signal(
        "offer",
        &"x".repeat(MAX_WEBRTC_SIGNAL_DATA_BYTES + 1)
    )));
}
