//! Per-session voice-call state. Owned by `PrivateDmRuntime`; one instance
//! per private-DM session. Pure(ish) state machine plus a FIFO queue of
//! inbound encrypted Opus frames awaiting drain by the frontend.

use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallDirection {
    Caller,
    Callee,
}

impl CallDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            CallDirection::Caller => "caller",
            CallDirection::Callee => "callee",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallPhase {
    Outgoing,
    Ringing,
    Active,
}

#[derive(Debug)]
pub struct CallState {
    pub call_id: String,
    pub direction: CallDirection,
    pub phase: CallPhase,
    pub key_b64: String,
    pub nonce_prefix_b64: String,
    /// Unix millis the call entered `Active`, set when both sides have agreed.
    pub started_at_ms: u64,
    /// Counterparty device id captured on offer/accept.
    pub remote_device: String,
    inbound_frames: VecDeque<Vec<u8>>,
}

impl CallState {
    pub fn outgoing(
        call_id: String,
        key_b64: String,
        nonce_prefix_b64: String,
        remote_device: String,
    ) -> Self {
        Self {
            call_id,
            direction: CallDirection::Caller,
            phase: CallPhase::Outgoing,
            key_b64,
            nonce_prefix_b64,
            started_at_ms: 0,
            remote_device,
            inbound_frames: VecDeque::new(),
        }
    }

    pub fn ringing(
        call_id: String,
        key_b64: String,
        nonce_prefix_b64: String,
        remote_device: String,
    ) -> Self {
        Self {
            call_id,
            direction: CallDirection::Callee,
            phase: CallPhase::Ringing,
            key_b64,
            nonce_prefix_b64,
            started_at_ms: 0,
            remote_device,
            inbound_frames: VecDeque::new(),
        }
    }

    pub fn become_active(&mut self, now_ms: u64) {
        self.phase = CallPhase::Active;
        self.started_at_ms = now_ms;
    }

    pub fn push_frame(&mut self, bytes: Vec<u8>) {
        self.inbound_frames.push_back(bytes);
    }

    pub fn drain_frames(&mut self) -> Vec<Vec<u8>> {
        std::mem::take(&mut self.inbound_frames)
            .into_iter()
            .collect()
    }

    pub fn duration_ms(&self, now_ms: u64) -> u64 {
        if self.started_at_ms == 0 || now_ms < self.started_at_ms {
            0
        } else {
            now_ms - self.started_at_ms
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn become_active_records_timestamp() {
        let mut call = CallState::outgoing("c".into(), "k".into(), "n".into(), "peer".into());
        assert_eq!(call.phase, CallPhase::Outgoing);
        call.become_active(1_000);
        assert_eq!(call.phase, CallPhase::Active);
        assert_eq!(call.started_at_ms, 1_000);
    }

    #[test]
    fn drain_frames_returns_in_order_and_clears() {
        let mut call = CallState::ringing("c".into(), "k".into(), "n".into(), "peer".into());
        call.push_frame(vec![1]);
        call.push_frame(vec![2]);
        let drained = call.drain_frames();
        assert_eq!(drained, vec![vec![1], vec![2]]);
        assert!(call.drain_frames().is_empty());
    }

    #[test]
    fn duration_ms_anchors_on_started_at() {
        let mut call = CallState::outgoing("c".into(), "k".into(), "n".into(), "peer".into());
        assert_eq!(call.duration_ms(5_000), 0);
        call.become_active(2_000);
        assert_eq!(call.duration_ms(5_000), 3_000);
    }
}
