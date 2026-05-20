# Voice Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time 1:1 voice calls inside an existing private DM session, signaling over the MLS control channel and AES-GCM-encrypted Opus media over a dedicated Moss pub/sub channel.

**Architecture:** A new `voice_call_runtime` per private-DM session manages call state and exchanges new `ControlEnvelope::Call*` variants on the existing MLS-protected control channel. Media flows as Opus frames AES-GCM-encrypted with a per-call symmetric key delivered in the offer, published on `voice-call/<call_id>` Moss channels. The frontend captures via AudioWorklet + WebCodecs `AudioEncoder`, plays via a small jitter buffer + `AudioDecoder`. No WebRTC, no STUN.

**Tech Stack:** Tauri v2, Rust, React 19, TypeScript, WebCodecs (`AudioEncoder`/`AudioDecoder`), `AudioWorklet`, Web Crypto API (AES-GCM), Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-05-19-voice-calls-design.md`

**Base branch:** `feat/voice-messages-notifications` (so voice-messages infrastructure — notification plugin, mic capture style — is available).

---

## File Structure

**New files (Rust):**
- `src-tauri/src/adapters/voice_call_runtime.rs` — per-session call state machine helper (pure-ish, called from `PrivateDmRuntime`).

**Modified (Rust):**
- `src-tauri/src/adapters/private_dm_runtime/wire.rs` — 4 new `ControlEnvelope` variants + `voice_call_channel(call_id)` helper.
- `src-tauri/src/adapters/private_dm_runtime/contracts.rs` — `PendingCall`, `ActiveCall`, `CallEvent` types; `call_event` on `ChatMessage`; `pending_call` / `active_call` on `SessionSnapshot`; `CallStarted` result type.
- `src-tauri/src/adapters/private_dm_runtime.rs` — per-session call state field, control-envelope branches, public `call_*` methods.
- `src-tauri/src/lib.rs` — 6 new Tauri commands + handler registration.

**New files (frontend):**
- `src/features/private-dm/voice-call/frame-crypto.ts` + test
- `src/features/private-dm/voice-call/jitter-buffer.ts` + test
- `src/features/private-dm/voice-call/call-state.ts` + test
- `src/features/private-dm/voice-call/audio-capture.ts`
- `src/features/private-dm/voice-call/audio-playback.ts`
- `src/features/private-dm/voice-call/ringtone.ts`
- `src/features/private-dm/voice-call/IncomingCallModal.tsx`
- `src/features/private-dm/voice-call/CallOverlay.tsx`
- `src/features/private-dm/voice-call/CallLogEntry.tsx`
- `src/features/private-dm/styles/call.css`

**Modified (frontend):**
- `src/features/private-dm/native/native-messaging-gateway.ts` — types + 6 methods.
- `src/features/private-dm/private-dm-screen.tsx` — Call button in DM header, mount modal/overlay, frame poll loop, render call-log entries.
- `src/App.css` — `@import` the new CSS.

---

## Task 1: Native — `ControlEnvelope::Call*` variants + media channel helper

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime/wire.rs`

- [ ] **Step 1: Add the failing serde test**

In `wire.rs`, add at the bottom (inside or after a new `#[cfg(test)] mod tests`):

```rust
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
            key_b64: "k".into(),
            nonce_prefix_b64: "n".into(),
        };
        let json = serde_json::to_string(&envelope).expect("ser");
        let back: ControlEnvelope = serde_json::from_str(&json).expect("de");
        match back {
            ControlEnvelope::CallOffer { call_id, key_b64, .. } => {
                assert_eq!(call_id, "c");
                assert_eq!(key_b64, "k");
            }
            _ => panic!("expected CallOffer"),
        }
    }

    #[test]
    fn voice_call_channel_uses_a_distinct_prefix() {
        let channel = voice_call_channel("call-abc");
        assert!(channel.starts_with(VOICE_CALL_CHANNEL_PREFIX));
        assert_eq!(channel, "voice-call/call-abc");
        assert_eq!(channel_call_id(&channel), Some("call-abc"));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib wire::tests`
Expected: compile errors — variants and helpers don't exist.

- [ ] **Step 3: Add the variants and channel helper**

In `wire.rs`, add to the `pub enum ControlEnvelope` (after `AttachmentManifest`):

```rust
    /// Initiates a 1:1 voice call. The per-call AES-GCM key and the 4-byte
    /// nonce prefix are delivered inside this MLS-protected envelope.
    CallOffer {
        session_id: String,
        participant_id: String,
        from_device: String,
        call_id: String,
        key_b64: String,
        nonce_prefix_b64: String,
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
```

Add the media-channel helpers at the top of the file alongside the other channel prefixes:

```rust
pub const VOICE_CALL_CHANNEL_PREFIX: &str = "voice-call/";

pub fn voice_call_channel(call_id: &str) -> String {
    format!("{VOICE_CALL_CHANNEL_PREFIX}{call_id}")
}

pub fn channel_call_id(channel: &str) -> Option<&str> {
    channel.strip_prefix(VOICE_CALL_CHANNEL_PREFIX)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib wire::tests`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/adapters/private_dm_runtime/wire.rs
git commit -m "feat(voice-call): add ControlEnvelope Call* variants and media channel helper"
```

---

## Task 2: Native — contract types (`PendingCall`, `ActiveCall`, `CallEvent`, `CallStarted`)

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime/contracts.rs`

- [ ] **Step 1: Add the types and the `call_event` field on `ChatMessage`**

In `contracts.rs`, add near the other small Serialize types (after `SnapshotEvent`):

```rust
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
```

Then extend `ChatMessage`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub from_device: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<AttachmentDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_event: Option<CallEvent>,
}
```

And extend `SessionSnapshot`:

```rust
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
```

- [ ] **Step 2: Run the crate's existing tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: any test that constructs `ChatMessage` or `SessionSnapshot` directly will now fail to compile. The next step fixes them.

- [ ] **Step 3: Add `call_event: None` and `pending_call: None, active_call: None` to every existing struct literal that fails**

Search the crate for `ChatMessage {` and `SessionSnapshot {` and add the new field(s) defaulted to `None` at every construction site:

```bash
grep -rn 'ChatMessage {\|SessionSnapshot {' src-tauri/src
```

Mechanically add `call_event: None,` to every `ChatMessage { ... }` literal and `pending_call: None, active_call: None,` to every `SessionSnapshot { ... }` literal.

- [ ] **Step 4: Run the test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/adapters/private_dm_runtime/contracts.rs src-tauri/src/adapters/private_dm_runtime.rs
git commit -m "feat(voice-call): add PendingCall/ActiveCall/CallEvent contract types"
```

---

## Task 3: Native — `voice_call_runtime` helper module

**Files:**
- Create: `src-tauri/src/adapters/voice_call_runtime.rs`
- Modify: `src-tauri/src/adapters/mod.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/adapters/voice_call_runtime.rs`:

```rust
//! Per-session voice-call state. Owned by `PrivateDmRuntime`; one instance
//! per private-DM session. Pure(ish) state machine plus a FIFO queue of
//! inbound encrypted Opus frames awaiting drain by the frontend.

use std::collections::VecDeque;

/// Direction of the local participant for this call.
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
        std::mem::take(&mut self.inbound_frames).into_iter().collect()
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
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/adapters/mod.rs`, add at the end:

```rust
pub mod voice_call_runtime;
```

- [ ] **Step 3: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib voice_call_runtime`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/adapters/voice_call_runtime.rs src-tauri/src/adapters/mod.rs
git commit -m "feat(voice-call): add per-session call state helper"
```

---

## Task 4: Native — wire `CallState` into `PrivateDmRuntime`

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime.rs`

- [ ] **Step 1: Imports + per-session field**

In `private_dm_runtime.rs`, near the existing `use crate::adapters::attachment_*` imports, add:

```rust
use crate::adapters::voice_call_runtime::{CallDirection, CallPhase, CallState};
```

In the `wire::{...}` use block, add `voice_call_channel`:

```rust
use wire::{
    blob_channel, channel_session_id, control_channel, data_channel, decode, decode_json, encode,
    publish_json, voice_call_channel, BlobEnvelope, ControlEnvelope, DataEnvelope,
};
```

In the `PrivateDmSession` struct add a new field (next to `attachment_slots`):

```rust
    call: Option<CallState>,
```

In the session constructor (`Self { ... }` literal), add:

```rust
            call: None,
```

- [ ] **Step 2: Handle the four new `ControlEnvelope` variants**

In `handle_control`, add four new arms before the final `_ => Ok(())`:

```rust
            ControlEnvelope::CallOffer {
                session_id,
                participant_id,
                from_device,
                call_id,
                key_b64,
                nonce_prefix_b64,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                // Ignore offers while a call is already in flight.
                if self.call.is_some() {
                    return Ok(());
                }
                self.call = Some(CallState::ringing(
                    call_id,
                    key_b64,
                    nonce_prefix_b64,
                    from_device,
                ));
                self.node.subscribe(&voice_call_channel(
                    &self.call.as_ref().expect("call set above").call_id,
                ))?;
                Ok(())
            }
            ControlEnvelope::CallAccept {
                session_id,
                participant_id,
                call_id,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                if let Some(call) = self.call.as_mut() {
                    if call.call_id == call_id && call.phase == CallPhase::Outgoing {
                        call.become_active(now_ms());
                    }
                }
                Ok(())
            }
            ControlEnvelope::CallDecline {
                session_id,
                participant_id,
                call_id,
                reason: _,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                if let Some(call) = self.call.as_ref() {
                    if call.call_id == call_id {
                        let _ = self
                            .node
                            .unsubscribe_voice_call(&call.call_id);
                        self.append_call_event_message(call, "missed", 0);
                        self.call = None;
                    }
                }
                Ok(())
            }
            ControlEnvelope::CallEnd {
                session_id,
                participant_id,
                call_id,
                reason,
            } if session_id == self.session_id
                && participant_id != self.participant_id =>
            {
                if let Some(call) = self.call.as_ref() {
                    if call.call_id == call_id {
                        let duration = call.duration_ms(now_ms());
                        let kind = if duration == 0 && reason == "no_answer" {
                            "missed"
                        } else {
                            "completed"
                        };
                        let _ = self.node.unsubscribe_voice_call(&call.call_id);
                        self.append_call_event_message(call, kind, duration);
                        self.call = None;
                    }
                }
                Ok(())
            }
```

Add the helper at the bottom of `impl PrivateDmSession`:

```rust
    fn append_call_event_message(&mut self, call: &CallState, kind: &str, duration_ms: u64) {
        self.messages.push(ChatMessage {
            from_device: call.remote_device.clone(),
            body: String::new(),
            attachment: None,
            call_event: Some(crate::adapters::private_dm_runtime::CallEvent {
                kind: kind.to_string(),
                duration_ms,
                call_id: call.call_id.clone(),
            }),
        });
    }
```

Add the time helper at the module top (under the other `use` statements):

```rust
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
```

- [ ] **Step 3: Route voice-call channel messages into the session**

In `handle_moss_message`, after the existing channel matches, add:

```rust
        else if wire::channel_call_id(&message.channel).is_some() {
            self.handle_voice_call_frame(&message.channel, message.payload)
        }
```

Adjust the existing `else { Ok(()) }` accordingly (chain via `else if`). Add the handler:

```rust
    fn handle_voice_call_frame(
        &mut self,
        channel: &str,
        payload: Vec<u8>,
    ) -> Result<(), PrivateDmRuntimeError> {
        let Some(call_id) = wire::channel_call_id(channel) else {
            return Ok(());
        };
        if let Some(call) = self.call.as_mut() {
            if call.call_id == call_id {
                call.push_frame(payload);
            }
        }
        Ok(())
    }
```

Add a thin helper on `MossNode` for unsubscribe by call-id — see Step 4.

- [ ] **Step 4: Add `MossNode::unsubscribe_voice_call` helper**

In `src-tauri/src/adapters/moss_ffi.rs`, find the existing `pub fn subscribe(...)` method on `MossNode`. Below it, add:

```rust
    /// Best-effort unsubscribe — Moss FFI does not yet expose an unsubscribe
    /// call, so we drop the in-process record. This is enough to stop the
    /// runtime from routing frames to a closed call.
    pub fn unsubscribe_voice_call(&self, _call_id: &str) -> Result<(), MossFfiError> {
        // No-op until the Moss FFI gains an explicit unsubscribe. Frames for a
        // call without an active state are dropped by `handle_voice_call_frame`.
        Ok(())
    }
```

If the FFI does expose unsubscribe, wire the real call instead. The runtime relies only on the existence of the method; the frame drop is enforced in `handle_voice_call_frame` when `self.call` is `None` or has a different `call_id`.

- [ ] **Step 5: Run the crate tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/adapters/private_dm_runtime.rs src-tauri/src/adapters/moss_ffi.rs
git commit -m "feat(voice-call): handle Call* envelopes and route media frames"
```

---

## Task 5: Native — public call methods on `PrivateDmRuntime`

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime.rs`

- [ ] **Step 1: Add the helpers + methods**

Add at the top of the file alongside other small helpers:

```rust
fn random_b64(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)
}
```

(`rand` and `base64` are already in `Cargo.toml`.)

On `PrivateDmRuntime`, add:

```rust
    pub fn call_start(
        &mut self,
        session_id: &str,
    ) -> Result<CallStarted, PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_start()
    }

    pub fn call_accept(
        &mut self,
        session_id: &str,
        call_id: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_accept(call_id)
    }

    pub fn call_decline(
        &mut self,
        session_id: &str,
        call_id: &str,
        reason: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_decline(call_id, reason)
    }

    pub fn call_end(
        &mut self,
        session_id: &str,
        call_id: &str,
        reason: &str,
    ) -> Result<(), PrivateDmRuntimeError> {
        self.drain_inbound()?;
        let session = self.session_mut(session_id)?;
        session.call_end(call_id, reason)
    }

    pub fn call_send_frame(
        &mut self,
        session_id: &str,
        call_id: &str,
        frame: Vec<u8>,
    ) -> Result<(), PrivateDmRuntimeError> {
        let session = self.session_mut(session_id)?;
        session.call_send_frame(call_id, frame)
    }

    pub fn call_drain_frames(
        &mut self,
        session_id: &str,
        call_id: &str,
    ) -> Result<Vec<Vec<u8>>, PrivateDmRuntimeError> {
        let session = self.session_mut(session_id)?;
        Ok(session.call_drain_frames(call_id))
    }
```

On `PrivateDmSession`, add:

```rust
    fn call_start(&mut self) -> Result<CallStarted, PrivateDmRuntimeError> {
        if !self.peer_joined || !self.crypto.is_ready() {
            return Err(PrivateDmRuntimeError::NotReady);
        }
        if self.call.is_some() {
            return Err(PrivateDmRuntimeError::Attachment(
                "another call is already in flight".to_string(),
            ));
        }
        let call_id = self.crypto.random_token("call")?;
        let key_b64 = random_b64(32);
        let nonce_prefix_b64 = random_b64(4);
        self.call = Some(CallState::outgoing(
            call_id.clone(),
            key_b64.clone(),
            nonce_prefix_b64.clone(),
            String::new(),
        ));
        self.node.subscribe(&voice_call_channel(&call_id))?;
        let envelope = ControlEnvelope::CallOffer {
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            from_device: self.device_id.clone(),
            call_id: call_id.clone(),
            key_b64: key_b64.clone(),
            nonce_prefix_b64: nonce_prefix_b64.clone(),
        };
        publish_json(&self.node, &self.control_channel, &envelope)?;
        Ok(CallStarted {
            session_id: self.session_id.clone(),
            call_id,
            key_b64,
            nonce_prefix_b64,
        })
    }

    fn call_accept(&mut self, call_id: &str) -> Result<(), PrivateDmRuntimeError> {
        let Some(call) = self.call.as_mut() else {
            return Err(PrivateDmRuntimeError::MissingSession);
        };
        if call.call_id != call_id || call.phase != CallPhase::Ringing {
            return Err(PrivateDmRuntimeError::MissingSession);
        }
        call.become_active(now_ms());
        let envelope = ControlEnvelope::CallAccept {
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            call_id: call_id.to_string(),
        };
        publish_json(&self.node, &self.control_channel, &envelope)
    }

    fn call_decline(&mut self, call_id: &str, reason: &str) -> Result<(), PrivateDmRuntimeError> {
        if let Some(call) = self.call.take() {
            if call.call_id == call_id {
                let _ = self.node.unsubscribe_voice_call(&call.call_id);
                self.append_call_event_message(&call, "missed", 0);
                let envelope = ControlEnvelope::CallDecline {
                    session_id: self.session_id.clone(),
                    participant_id: self.participant_id.clone(),
                    call_id: call_id.to_string(),
                    reason: reason.to_string(),
                };
                publish_json(&self.node, &self.control_channel, &envelope)?;
            } else {
                self.call = Some(call);
            }
        }
        Ok(())
    }

    fn call_end(&mut self, call_id: &str, reason: &str) -> Result<(), PrivateDmRuntimeError> {
        let Some(call) = self.call.take() else {
            return Ok(());
        };
        if call.call_id != call_id {
            self.call = Some(call);
            return Ok(());
        }
        let duration = call.duration_ms(now_ms());
        let _ = self.node.unsubscribe_voice_call(&call.call_id);
        let kind = if call.phase != CallPhase::Active {
            "missed"
        } else {
            "completed"
        };
        self.append_call_event_message(&call, kind, duration);
        let envelope = ControlEnvelope::CallEnd {
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            call_id: call_id.to_string(),
            reason: reason.to_string(),
        };
        publish_json(&self.node, &self.control_channel, &envelope)
    }

    fn call_send_frame(&mut self, call_id: &str, frame: Vec<u8>) -> Result<(), PrivateDmRuntimeError> {
        let Some(call) = self.call.as_ref() else {
            return Ok(());
        };
        if call.call_id != call_id || call.phase != CallPhase::Active {
            return Ok(());
        }
        self.node
            .publish(&voice_call_channel(call_id), &frame)
            .map_err(|error| PrivateDmRuntimeError::Moss(error.to_string()))
    }

    fn call_drain_frames(&mut self, call_id: &str) -> Vec<Vec<u8>> {
        let Some(call) = self.call.as_mut() else {
            return Vec::new();
        };
        if call.call_id != call_id {
            return Vec::new();
        }
        call.drain_frames()
    }
```

- [ ] **Step 2: Expose `pending_call` / `active_call` in the session snapshot**

Find `fn snapshot(&self) -> SessionSnapshot` and add to the returned literal:

```rust
            pending_call: self.call.as_ref().and_then(|call| {
                if call.phase == CallPhase::Ringing {
                    Some(PendingCall {
                        call_id: call.call_id.clone(),
                        from_device: call.remote_device.clone(),
                    })
                } else {
                    None
                }
            }),
            active_call: self.call.as_ref().and_then(|call| {
                if call.phase == CallPhase::Active {
                    Some(ActiveCall {
                        call_id: call.call_id.clone(),
                        direction: call.direction.as_str().to_string(),
                        key_b64: call.key_b64.clone(),
                        nonce_prefix_b64: call.nonce_prefix_b64.clone(),
                        started_at_ms: call.started_at_ms,
                    })
                } else {
                    None
                }
            }),
```

Add the matching imports at the top of the file:

```rust
pub use contracts::{
    AcceptInviteRequest, ActiveCall, AttachmentDescriptor, AttachmentSendResult, AttachmentState,
    AttachmentView, CallEvent, CallStarted, ChatMessage, CloseSessionResult, DmOffer, InviteCreated,
    MeshInfo, PendingCall, PrivateDmRuntimeError, SendMessageResult, SessionListSnapshot,
    SessionSnapshot, SnapshotEvent, StartSessionRequest,
};
```

- [ ] **Step 3: Run the crate tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/adapters/private_dm_runtime.rs
git commit -m "feat(voice-call): public call_start/accept/decline/end and frame I/O"
```

---

## Task 6: Native — Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the commands**

At the bottom of the existing `private_dm_*` command block in `lib.rs`, add:

```rust
#[tauri::command]
fn private_dm_call_start(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
) -> Result<adapters::private_dm_runtime::CallStarted, String> {
    state.with_runtime(|runtime| {
        runtime.call_start(&session_id).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_accept(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .call_accept(&session_id, &call_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_decline(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
    reason: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .call_decline(&session_id, &call_id, &reason)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_end(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
    reason: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .call_end(&session_id, &call_id, &reason)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_send_frame(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
    frame_b64: String,
) -> Result<(), String> {
    let bytes = decode_base64(&frame_b64)?;
    state.with_runtime(|runtime| {
        runtime
            .call_send_frame(&session_id, &call_id, bytes)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_drain_frames(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
) -> Result<Vec<String>, String> {
    state.with_runtime(|runtime| {
        let frames = runtime
            .call_drain_frames(&session_id, &call_id)
            .map_err(|error| error.to_string())?;
        Ok(frames
            .into_iter()
            .map(|bytes| {
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
            })
            .collect())
    })
}
```

- [ ] **Step 2: Register the commands in the handler**

In `tauri::generate_handler![...]` (the `pub fn run()` builder), add the six new commands alongside the other `private_dm_*`:

```rust
            private_dm_call_start,
            private_dm_call_accept,
            private_dm_call_decline,
            private_dm_call_end,
            private_dm_call_send_frame,
            private_dm_call_drain_frames,
```

- [ ] **Step 3: Build and test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(voice-call): Tauri commands for call lifecycle and frames"
```

---

## Task 7: Frontend gateway — types + 6 methods

**Files:**
- Modify: `src/features/private-dm/native/native-messaging-gateway.ts`

- [ ] **Step 1: Add types**

Near the other interfaces, add:

```typescript
export interface PendingCall {
  readonly call_id: string;
  readonly from_device: string;
}

export interface ActiveCall {
  readonly call_id: string;
  readonly direction: "caller" | "callee";
  readonly key_b64: string;
  readonly nonce_prefix_b64: string;
  readonly started_at_ms: number;
}

export interface CallEvent {
  readonly kind: "completed" | "missed";
  readonly duration_ms: number;
  readonly call_id: string;
}

export interface CallStarted {
  readonly session_id: string;
  readonly call_id: string;
  readonly key_b64: string;
  readonly nonce_prefix_b64: string;
}
```

Extend `ChatMessage` and `SessionSnapshot`:

```typescript
export interface ChatMessage {
  readonly from_device: string;
  readonly body: string;
  readonly attachment?: AttachmentDescriptor;
  readonly call_event?: CallEvent;
}

// inside SessionSnapshot interface:
  readonly pending_call?: PendingCall;
  readonly active_call?: ActiveCall;
```

- [ ] **Step 2: Add 6 methods to the interface and impl**

Add to `NativeMessagingGateway`:

```typescript
  callStart(sessionId: string): Promise<CallStarted>;
  callAccept(sessionId: string, callId: string): Promise<void>;
  callDecline(sessionId: string, callId: string, reason: string): Promise<void>;
  callEnd(sessionId: string, callId: string, reason: string): Promise<void>;
  callSendFrame(sessionId: string, callId: string, frameBase64: string): Promise<void>;
  callDrainFrames(sessionId: string, callId: string): Promise<readonly string[]>;
```

Add to `TauriNativeMessagingGateway`:

```typescript
  async callStart(sessionId: string): Promise<CallStarted> {
    return invoke<CallStarted>("private_dm_call_start", { sessionId });
  }
  async callAccept(sessionId: string, callId: string): Promise<void> {
    await invoke("private_dm_call_accept", { sessionId, callId });
  }
  async callDecline(sessionId: string, callId: string, reason: string): Promise<void> {
    await invoke("private_dm_call_decline", { sessionId, callId, reason });
  }
  async callEnd(sessionId: string, callId: string, reason: string): Promise<void> {
    await invoke("private_dm_call_end", { sessionId, callId, reason });
  }
  async callSendFrame(
    sessionId: string,
    callId: string,
    frameBase64: string,
  ): Promise<void> {
    await invoke("private_dm_call_send_frame", {
      sessionId,
      callId,
      frameB64: frameBase64,
    });
  }
  async callDrainFrames(
    sessionId: string,
    callId: string,
  ): Promise<readonly string[]> {
    return invoke<readonly string[]>("private_dm_call_drain_frames", {
      sessionId,
      callId,
    });
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/private-dm/native/native-messaging-gateway.ts
git commit -m "feat(voice-call): gateway types and call lifecycle methods"
```

---

## Task 8: Frontend — `frame-crypto.ts` (AES-GCM frame seal)

**Files:**
- Create: `src/features/private-dm/voice-call/frame-crypto.ts`
- Create: `src/features/private-dm/voice-call/frame-crypto.test.ts`

- [ ] **Step 1: Failing test**

Create `frame-crypto.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  CALLEE_DIRECTION_BIT,
  CALLER_DIRECTION_BIT,
  buildFrame,
  importCallKey,
  parseFrame,
  sealFrame,
  openFrame,
} from "./frame-crypto";

const KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const PREFIX_B64 = "AAAAAA==";

describe("frame-crypto", () => {
  it("seals and opens a frame with the same key", async () => {
    const key = await importCallKey(KEY_B64);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const sealed = await sealFrame(key, PREFIX_B64, 7n, CALLER_DIRECTION_BIT, payload);
    const opened = await openFrame(key, PREFIX_B64, sealed);
    expect(opened).not.toBeNull();
    expect(Array.from(opened!.payload)).toEqual([1, 2, 3, 4, 5]);
    expect(opened!.seq).toBe(7n);
  });

  it("rejects a tampered frame", async () => {
    const key = await importCallKey(KEY_B64);
    const sealed = await sealFrame(
      key,
      PREFIX_B64,
      1n,
      CALLER_DIRECTION_BIT,
      new Uint8Array([9, 9, 9]),
    );
    sealed[sealed.length - 1] ^= 0xff;
    const opened = await openFrame(key, PREFIX_B64, sealed);
    expect(opened).toBeNull();
  });

  it("buildFrame and parseFrame roundtrip the seq", () => {
    const cipher = new Uint8Array([1, 2, 3]);
    const wire = buildFrame(42n, cipher);
    const parsed = parseFrame(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.seq).toBe(42n);
    expect(Array.from(parsed!.ciphertext)).toEqual([1, 2, 3]);
  });

  it("CALLER and CALLEE direction bits differ", () => {
    expect(CALLER_DIRECTION_BIT).not.toBe(CALLEE_DIRECTION_BIT);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/private-dm/voice-call/frame-crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementation**

Create `frame-crypto.ts`:

```typescript
/**
 * AES-GCM frame seal / open for a 1:1 voice call. The wire frame is
 * `[seq:u64 BE][ciphertext-with-tag]`; AES-GCM nonce = `[nonce_prefix (4)] [seq (8)]`.
 * The high bit of `seq` distinguishes direction so the two participants never
 * collide nonces while sharing one key.
 */

export const CALLER_DIRECTION_BIT = 0n;
export const CALLEE_DIRECTION_BIT = 1n << 63n;
const SEQ_VALUE_MASK = (1n << 63n) - 1n;

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function bytesFromBase64(value: string): Uint8Array {
  return b64ToBytes(value);
}

export function bytesToBase64(value: Uint8Array): string {
  return bytesToB64(value);
}

/** Imports the 32-byte call key from its base64 form. */
export async function importCallKey(keyBase64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(keyBase64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function buildNonce(prefixBase64: string, seq: bigint): Uint8Array {
  const prefix = b64ToBytes(prefixBase64);
  if (prefix.length !== 4) {
    throw new Error("nonce prefix must be 4 bytes");
  }
  const nonce = new Uint8Array(12);
  nonce.set(prefix, 0);
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  view.setBigUint64(4, seq, false);
  return nonce;
}

function seqToBytes(seq: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, seq, false);
  return out;
}

function bytesToSeq(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false);
}

/** Builds the on-wire frame: 8-byte BE seq prefix + ciphertext (which already
 *  contains the AES-GCM auth tag). */
export function buildFrame(seq: bigint, ciphertext: Uint8Array): Uint8Array {
  const header = seqToBytes(seq);
  const out = new Uint8Array(header.length + ciphertext.length);
  out.set(header, 0);
  out.set(ciphertext, header.length);
  return out;
}

/** Parses the on-wire frame. Returns null when the buffer is too short. */
export function parseFrame(
  bytes: Uint8Array,
): { seq: bigint; ciphertext: Uint8Array } | null {
  if (bytes.length < 9) {
    return null;
  }
  return {
    seq: bytesToSeq(bytes, 0),
    ciphertext: bytes.slice(8),
  };
}

/**
 * Encrypts an Opus payload into a wire frame. `seqValue` is a 63-bit
 * monotonic counter; the direction bit OR-merges it into the full 64-bit
 * seq so the two sides never collide nonces.
 */
export async function sealFrame(
  key: CryptoKey,
  noncePrefixBase64: string,
  seqValue: bigint,
  directionBit: bigint,
  payload: Uint8Array,
): Promise<Uint8Array> {
  const seq = (seqValue & SEQ_VALUE_MASK) | directionBit;
  const nonce = buildNonce(noncePrefixBase64, seq);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    payload,
  );
  return buildFrame(seq, new Uint8Array(cipherBuffer));
}

/**
 * Opens a wire frame. Returns null when the frame is malformed or
 * authentication fails — callers drop those silently.
 */
export async function openFrame(
  key: CryptoKey,
  noncePrefixBase64: string,
  frame: Uint8Array,
): Promise<{ seq: bigint; payload: Uint8Array } | null> {
  const parsed = parseFrame(frame);
  if (!parsed) {
    return null;
  }
  const nonce = buildNonce(noncePrefixBase64, parsed.seq);
  try {
    const buffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      parsed.ciphertext,
    );
    return { seq: parsed.seq, payload: new Uint8Array(buffer) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/private-dm/voice-call/frame-crypto.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/private-dm/voice-call/frame-crypto.ts src/features/private-dm/voice-call/frame-crypto.test.ts
git commit -m "feat(voice-call): AES-GCM frame seal and open"
```

---

## Task 9: Frontend — `jitter-buffer.ts`

**Files:**
- Create: `src/features/private-dm/voice-call/jitter-buffer.ts`
- Create: `src/features/private-dm/voice-call/jitter-buffer.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { JitterBuffer } from "./jitter-buffer";

describe("JitterBuffer", () => {
  it("drains frames in seq order", () => {
    const buf = new JitterBuffer();
    buf.push({ seq: 2n, payload: new Uint8Array([2]) });
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    buf.push({ seq: 3n, payload: new Uint8Array([3]) });
    expect(buf.drainReady().map((f) => Number(f.seq))).toEqual([1, 2, 3]);
  });

  it("drops frames at or below the cursor", () => {
    const buf = new JitterBuffer();
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    buf.drainReady();
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    expect(buf.drainReady()).toEqual([]);
  });

  it("does not drain a gap until the missing frame arrives", () => {
    const buf = new JitterBuffer();
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    buf.push({ seq: 3n, payload: new Uint8Array([3]) });
    expect(buf.drainReady().map((f) => Number(f.seq))).toEqual([1]);
    buf.push({ seq: 2n, payload: new Uint8Array([2]) });
    expect(buf.drainReady().map((f) => Number(f.seq))).toEqual([2, 3]);
  });

  it("force-skips a gap after the cap and resumes", () => {
    const buf = new JitterBuffer(8);
    for (let i = 2; i <= 12; i += 1) {
      buf.push({ seq: BigInt(i), payload: new Uint8Array([i]) });
    }
    const drained = buf.drainReady().map((f) => Number(f.seq));
    expect(drained[0]).toBe(2);
    expect(drained[drained.length - 1]).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/private-dm/voice-call/jitter-buffer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementation**

Create `jitter-buffer.ts`:

```typescript
export interface BufferedFrame {
  readonly seq: bigint;
  readonly payload: Uint8Array;
}

/**
 * Small in-memory reorder buffer for received voice-call frames. Drains in
 * seq order; pauses on a gap; once the buffered backlog exceeds `gapCap`
 * frames it force-skips the missing seq and resumes (cheap PLC).
 *
 * The buffer is direction-agnostic: callers pass it the seq value as the
 * direction bit is already part of the on-wire seq. A receiver runs one
 * instance per remote direction (in 1:1, exactly one).
 */
export class JitterBuffer {
  private pending = new Map<bigint, Uint8Array>();
  private cursor: bigint | null = null;
  private readonly gapCap: number;

  constructor(gapCap = 8) {
    this.gapCap = gapCap;
  }

  push(frame: BufferedFrame): void {
    if (this.cursor !== null && frame.seq <= this.cursor) {
      return;
    }
    this.pending.set(frame.seq, frame.payload);
  }

  /**
   * Returns every frame that is now ready to play, in seq order. If a gap
   * persists across more than `gapCap` queued frames, force-skip to the next
   * available seq.
   */
  drainReady(): BufferedFrame[] {
    const out: BufferedFrame[] = [];
    if (this.pending.size === 0) {
      return out;
    }
    const seqs = [...this.pending.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let next = this.cursor === null ? seqs[0] : this.cursor + 1n;
    for (;;) {
      if (this.pending.has(next)) {
        out.push({ seq: next, payload: this.pending.get(next)! });
        this.pending.delete(next);
        this.cursor = next;
        next = next + 1n;
        continue;
      }
      if (this.pending.size > this.gapCap) {
        const remaining = [...this.pending.keys()].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
        next = remaining[0];
        continue;
      }
      break;
    }
    return out;
  }
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/features/private-dm/voice-call/jitter-buffer.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/private-dm/voice-call/jitter-buffer.ts src/features/private-dm/voice-call/jitter-buffer.test.ts
git commit -m "feat(voice-call): jitter buffer with seq-ordered drain"
```

---

## Task 10: Frontend — `call-state.ts` pure module

**Files:**
- Create: `src/features/private-dm/voice-call/call-state.ts`
- Create: `src/features/private-dm/voice-call/call-state.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { NO_ANSWER_TIMEOUT_MS, hasNoAnswerTimedOut, nextCallPhase } from "./call-state";

describe("call-state", () => {
  it("idle -> outgoing on local dial", () => {
    expect(nextCallPhase("idle", { kind: "local_dial" })).toBe("outgoing");
  });

  it("ringing -> active on local accept", () => {
    expect(nextCallPhase("ringing", { kind: "local_accept" })).toBe("active");
  });

  it("outgoing -> active on remote accept", () => {
    expect(nextCallPhase("outgoing", { kind: "remote_accept" })).toBe("active");
  });

  it("any phase -> ended on local_end / remote_end / decline / no_answer", () => {
    expect(nextCallPhase("outgoing", { kind: "local_end" })).toBe("ended");
    expect(nextCallPhase("ringing", { kind: "local_decline" })).toBe("ended");
    expect(nextCallPhase("active", { kind: "remote_end" })).toBe("ended");
    expect(nextCallPhase("outgoing", { kind: "no_answer" })).toBe("ended");
  });

  it("hasNoAnswerTimedOut fires only after the timeout from dial", () => {
    const dialAt = 1_000;
    expect(hasNoAnswerTimedOut(dialAt, dialAt + NO_ANSWER_TIMEOUT_MS - 1)).toBe(false);
    expect(hasNoAnswerTimedOut(dialAt, dialAt + NO_ANSWER_TIMEOUT_MS)).toBe(true);
  });
});
```

- [ ] **Step 2: Failing**

Run: `npx vitest run src/features/private-dm/voice-call/call-state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementation**

Create `call-state.ts`:

```typescript
export type CallPhase = "idle" | "outgoing" | "ringing" | "active" | "ended";

export type CallEvent =
  | { kind: "local_dial" }
  | { kind: "local_accept" }
  | { kind: "local_decline" }
  | { kind: "local_end" }
  | { kind: "remote_offer" }
  | { kind: "remote_accept" }
  | { kind: "remote_decline" }
  | { kind: "remote_end" }
  | { kind: "no_answer" };

/** How long the caller waits for the remote `CallAccept` before giving up. */
export const NO_ANSWER_TIMEOUT_MS = 30_000;

/**
 * Pure state-machine step. Unknown transitions return the current phase
 * unchanged — the caller decides whether that is an error.
 */
export function nextCallPhase(phase: CallPhase, event: CallEvent): CallPhase {
  if (event.kind === "local_dial" && phase === "idle") {
    return "outgoing";
  }
  if (event.kind === "remote_offer" && phase === "idle") {
    return "ringing";
  }
  if (event.kind === "local_accept" && phase === "ringing") {
    return "active";
  }
  if (event.kind === "remote_accept" && phase === "outgoing") {
    return "active";
  }
  if (
    event.kind === "local_decline" ||
    event.kind === "local_end" ||
    event.kind === "remote_decline" ||
    event.kind === "remote_end" ||
    event.kind === "no_answer"
  ) {
    return "ended";
  }
  return phase;
}

export function hasNoAnswerTimedOut(dialAtMs: number, nowMs: number): boolean {
  return nowMs - dialAtMs >= NO_ANSWER_TIMEOUT_MS;
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/features/private-dm/voice-call/call-state.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/private-dm/voice-call/call-state.ts src/features/private-dm/voice-call/call-state.test.ts
git commit -m "feat(voice-call): pure call-state machine"
```

---

## Task 11: Frontend — `audio-capture.ts`

**Files:**
- Create: `src/features/private-dm/voice-call/audio-capture.ts`

- [ ] **Step 1: Write the capture module**

```typescript
/**
 * Microphone capture for a voice call. Uses an AudioWorklet to pull raw PCM
 * frames at 16 kHz mono, then encodes each 20 ms frame to Opus with
 * WebCodecs. Emits each encoded frame to the supplied callback.
 *
 * The encoder/decoder are guarded by `isCallAudioSupported()` so callers can
 * disable the Call button in environments that lack WebCodecs.
 */

export type EncodedFrame = Uint8Array;

const SAMPLE_RATE = 16_000;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000;

export function isCallAudioSupported(): boolean {
  return (
    typeof AudioWorkletNode !== "undefined" &&
    typeof (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder !==
      "undefined" &&
    typeof (globalThis as unknown as { AudioDecoder?: unknown }).AudioDecoder !==
      "undefined"
  );
}

const WORKLET_SOURCE = `
class CallCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${SAMPLES_PER_FRAME});
    this.fill = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const take = Math.min(this.buffer.length - this.fill, channel.length - i);
      this.buffer.set(channel.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === this.buffer.length) {
        this.port.postMessage(this.buffer.slice());
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor("call-capture", CallCaptureProcessor);
`;

export interface VoiceCaptureHandle {
  stop(): Promise<void>;
}

/**
 * Starts microphone capture and pushes Opus-encoded 20 ms frames to
 * `onFrame`. The returned handle stops capture and releases the mic.
 */
export async function startVoiceCapture(
  onFrame: (frame: EncodedFrame) => void,
): Promise<VoiceCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: SAMPLE_RATE,
      channelCount: 1,
    },
  });
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
  const workletUrl = URL.createObjectURL(blob);
  try {
    await context.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "call-capture");
  source.connect(node);
  // Workaround: AudioWorkletNode needs a downstream node to actually pull.
  // A muted gain to the destination is the conventional sink.
  const sink = context.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(context.destination);

  const AudioEncoderCtor = (
    globalThis as unknown as {
      AudioEncoder: new (init: {
        output: (chunk: EncodedAudioChunk) => void;
        error: (error: Error) => void;
      }) => {
        configure(config: AudioEncoderConfig): void;
        encode(data: AudioData): void;
        close(): void;
      };
    }
  ).AudioEncoder;

  const encoder = new AudioEncoderCtor({
    output: (chunk) => {
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(new Uint8Array(buffer));
      onFrame(new Uint8Array(buffer));
    },
    error: (error) => {
      console.warn("[voice-call] encoder error", error);
    },
  });
  encoder.configure({
    codec: "opus",
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: 24_000,
  });

  let timestamp = 0;
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const data = new (
      globalThis as unknown as {
        AudioData: new (init: {
          format: AudioSampleFormat;
          sampleRate: number;
          numberOfChannels: number;
          numberOfFrames: number;
          timestamp: number;
          data: BufferSource;
        }) => AudioData;
      }
    ).AudioData({
      format: "f32-planar",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      numberOfFrames: event.data.length,
      timestamp,
      data: event.data,
    });
    timestamp += (event.data.length * 1_000_000) / SAMPLE_RATE;
    encoder.encode(data);
    data.close();
  };

  return {
    async stop() {
      try {
        encoder.close();
      } catch {
        // ignore
      }
      try {
        node.disconnect();
        source.disconnect();
      } catch {
        // ignore
      }
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/private-dm/voice-call/audio-capture.ts
git commit -m "feat(voice-call): mic capture and Opus encoding"
```

---

## Task 12: Frontend — `audio-playback.ts`

**Files:**
- Create: `src/features/private-dm/voice-call/audio-playback.ts`

- [ ] **Step 1: Write the playback module**

```typescript
/**
 * Decodes incoming Opus frames with WebCodecs and schedules them on a
 * shared AudioContext. Pairs with the JitterBuffer used by the call view.
 */

const SAMPLE_RATE = 16_000;

export interface VoicePlaybackHandle {
  /** Push a decrypted Opus frame. The seq is informational only — the jitter
   *  buffer in the caller handles ordering. */
  pushFrame(frame: Uint8Array): void;
  stop(): Promise<void>;
}

export async function startVoicePlayback(): Promise<VoicePlaybackHandle> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  // Resume requires a user gesture on some platforms — the call accept click
  // satisfies that.
  await context.resume();
  let nextStart = context.currentTime;

  const AudioDecoderCtor = (
    globalThis as unknown as {
      AudioDecoder: new (init: {
        output: (data: AudioData) => void;
        error: (error: Error) => void;
      }) => {
        configure(config: AudioDecoderConfig): void;
        decode(chunk: EncodedAudioChunk): void;
        close(): void;
      };
    }
  ).AudioDecoder;

  const decoder = new AudioDecoderCtor({
    output: (data) => {
      const channels = data.numberOfChannels;
      const length = data.numberOfFrames;
      const buffer = context.createBuffer(channels, length, SAMPLE_RATE);
      for (let channel = 0; channel < channels; channel += 1) {
        const target = buffer.getChannelData(channel);
        data.copyTo(target, { planeIndex: channel });
      }
      data.close();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const start = Math.max(context.currentTime, nextStart);
      source.start(start);
      nextStart = start + buffer.duration;
    },
    error: (error) => {
      console.warn("[voice-call] decoder error", error);
    },
  });
  decoder.configure({
    codec: "opus",
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
  });

  const EncodedAudioChunkCtor = (
    globalThis as unknown as {
      EncodedAudioChunk: new (init: {
        type: EncodedAudioChunkType;
        timestamp: number;
        data: BufferSource;
      }) => EncodedAudioChunk;
    }
  ).EncodedAudioChunk;

  let timestamp = 0;
  return {
    pushFrame(frame: Uint8Array) {
      const chunk = new EncodedAudioChunkCtor({
        type: "key",
        timestamp,
        data: frame,
      });
      timestamp += 20_000; // 20 ms in microseconds
      try {
        decoder.decode(chunk);
      } catch (error) {
        console.warn("[voice-call] decode failed", error);
      }
    },
    async stop() {
      try {
        decoder.close();
      } catch {
        // ignore
      }
      await context.close();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/private-dm/voice-call/audio-playback.ts
git commit -m "feat(voice-call): Opus playback with WebCodecs decoder"
```

---

## Task 13: Frontend — `ringtone.ts`

**Files:**
- Create: `src/features/private-dm/voice-call/ringtone.ts`

- [ ] **Step 1: Write**

```typescript
/**
 * Lightweight call ringtone synthesised with Web Audio — no assets to ship.
 * Pattern: two-tone trill, 0.4 s on / 0.6 s off, repeated.
 */

export interface RingtoneHandle {
  stop(): void;
}

export function startRingtone(): RingtoneHandle {
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  gain.connect(context.destination);

  const osc1 = context.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 440;
  const osc2 = context.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 480;
  osc1.connect(gain);
  osc2.connect(gain);
  osc1.start();
  osc2.start();

  // Schedule the ring-quiet pattern for 30 s, then stop.
  const start = context.currentTime;
  for (let beat = 0; beat < 30; beat += 1) {
    const ringStart = start + beat * 1.0;
    gain.gain.setValueAtTime(0.0001, ringStart);
    gain.gain.exponentialRampToValueAtTime(0.15, ringStart + 0.05);
    gain.gain.setValueAtTime(0.15, ringStart + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, ringStart + 0.45);
  }

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      osc1.stop();
      osc2.stop();
    } catch {
      // already stopped
    }
    void context.close();
  };

  return { stop };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/features/private-dm/voice-call/ringtone.ts
git commit -m "feat(voice-call): synthesised ringtone"
```

---

## Task 14: Frontend — `IncomingCallModal.tsx`

**Files:**
- Create: `src/features/private-dm/voice-call/IncomingCallModal.tsx`

- [ ] **Step 1: Write**

```tsx
import { IconPhone, IconPhoneOff } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import type { PendingCall } from "../native/native-messaging-gateway";
import { NO_ANSWER_TIMEOUT_MS } from "./call-state";
import { startRingtone, type RingtoneHandle } from "./ringtone";

/**
 * Full-window modal shown while a 1:1 call is ringing on the callee. Plays
 * the synthesised ringtone for its lifetime; auto-declines after
 * NO_ANSWER_TIMEOUT_MS.
 */
export function IncomingCallModal({
  pending,
  peerLabel,
  onAccept,
  onDecline,
}: {
  pending: PendingCall;
  peerLabel: string;
  onAccept: () => void;
  onDecline: (reason: string) => void;
}) {
  const ringtoneRef = useRef<RingtoneHandle | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    ringtoneRef.current = startRingtone();
    timerRef.current = window.setTimeout(
      () => onDecline("no_answer"),
      NO_ANSWER_TIMEOUT_MS,
    );
    return () => {
      ringtoneRef.current?.stop();
      ringtoneRef.current = null;
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
    };
    // pending.call_id is the identity of this ring instance.
  }, [pending.call_id, onDecline]);

  return (
    <div className="call-modal" role="dialog" aria-modal="true" aria-label="Incoming call">
      <div className="call-modal-card">
        <strong className="call-modal-peer">{peerLabel}</strong>
        <span className="call-modal-status">Incoming voice call…</span>
        <div className="call-modal-actions">
          <button
            type="button"
            className="call-btn call-btn-decline"
            aria-label="Decline call"
            onClick={() => onDecline("declined")}
          >
            <IconPhoneOff size={20} />
          </button>
          <button
            type="button"
            className="call-btn call-btn-accept"
            aria-label="Accept call"
            onClick={onAccept}
          >
            <IconPhone size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/features/private-dm/voice-call/IncomingCallModal.tsx
git commit -m "feat(voice-call): incoming-call ringing modal"
```

---

## Task 15: Frontend — `CallOverlay.tsx`

**Files:**
- Create: `src/features/private-dm/voice-call/CallOverlay.tsx`

- [ ] **Step 1: Write**

```tsx
import { IconMicrophone, IconMicrophoneOff, IconPhoneOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ActiveCall } from "../native/native-messaging-gateway";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Full-window overlay shown while a call is active. Renders a running timer
 * anchored on `active.started_at_ms`, mute toggle, and hang-up button.
 */
export function CallOverlay({
  active,
  peerLabel,
  muted,
  onToggleMute,
  onHangUp,
}: {
  active: ActiveCall;
  peerLabel: string;
  muted: boolean;
  onToggleMute: () => void;
  onHangUp: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - active.started_at_ms);

  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Active call">
      <div className="call-overlay-card">
        <strong className="call-overlay-peer">{peerLabel}</strong>
        <span className="call-overlay-timer">{formatClock(elapsed)}</span>
        <div className="call-overlay-actions">
          <button
            type="button"
            className={`call-btn ${muted ? "call-btn-muted" : ""}`}
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={onToggleMute}
          >
            {muted ? <IconMicrophoneOff size={18} /> : <IconMicrophone size={18} />}
          </button>
          <button
            type="button"
            className="call-btn call-btn-decline"
            aria-label="Hang up"
            onClick={onHangUp}
          >
            <IconPhoneOff size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/features/private-dm/voice-call/CallOverlay.tsx
git commit -m "feat(voice-call): active-call overlay"
```

---

## Task 16: Frontend — `CallLogEntry.tsx` + DM chat list integration

**Files:**
- Create: `src/features/private-dm/voice-call/CallLogEntry.tsx`
- Modify: `src/features/private-dm/private-dm-screen.tsx` (DM chat list rendering of `ChatMessage`, around the existing `message.attachment ? <AttachmentCard /> : null` block)

- [ ] **Step 1: Write the component**

```tsx
import { IconPhone, IconPhoneOff } from "@tabler/icons-react";
import type { CallEvent } from "../native/native-messaging-gateway";

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total === 0) {
    return "";
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Pill rendered inside a DM message bubble to represent a call event. */
export function CallLogEntry({ event }: { event: CallEvent }) {
  const missed = event.kind === "missed";
  const duration = formatDuration(event.duration_ms);
  return (
    <span className={`call-log-entry ${missed ? "call-log-missed" : ""}`}>
      {missed ? <IconPhoneOff size={14} /> : <IconPhone size={14} />}
      <span>
        {missed ? "Missed call" : "Call ended"}
        {duration ? ` · ${duration}` : ""}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Render `CallLogEntry` in the DM chat list**

In `private-dm-screen.tsx`, find the DM message rendering block (`message.attachment ? <AttachmentCard ... /> : null`). Immediately after that block, render the call-event branch:

```tsx
        {message.call_event ? <CallLogEntry event={message.call_event} /> : null}
```

Add the import near the other `voice-call` imports (added in Task 17).

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/features/private-dm/voice-call/CallLogEntry.tsx src/features/private-dm/private-dm-screen.tsx
git commit -m "feat(voice-call): render call events in the DM message log"
```

---

## Task 17: Frontend — wire Call button + modal + overlay + frame loop into the screen

**Files:**
- Modify: `src/features/private-dm/private-dm-screen.tsx`

- [ ] **Step 1: Imports**

Add to the existing `./voice-call`-grouped imports (create the group if absent):

```tsx
import { IncomingCallModal } from "./voice-call/IncomingCallModal";
import { CallOverlay } from "./voice-call/CallOverlay";
import { CallLogEntry } from "./voice-call/CallLogEntry";
import {
  CALLEE_DIRECTION_BIT,
  CALLER_DIRECTION_BIT,
  bytesFromBase64,
  bytesToBase64,
  importCallKey,
  openFrame,
  sealFrame,
} from "./voice-call/frame-crypto";
import { JitterBuffer } from "./voice-call/jitter-buffer";
import {
  isCallAudioSupported,
  startVoiceCapture,
  type VoiceCaptureHandle,
} from "./voice-call/audio-capture";
import { startVoicePlayback, type VoicePlaybackHandle } from "./voice-call/audio-playback";
import { IconPhone } from "@tabler/icons-react";
```

- [ ] **Step 2: Local refs for the active call pipeline**

Inside the component, add:

```tsx
  const callCaptureRef = useRef<VoiceCaptureHandle | null>(null);
  const callPlaybackRef = useRef<VoicePlaybackHandle | null>(null);
  const callKeyRef = useRef<CryptoKey | null>(null);
  const callSeqRef = useRef<bigint>(0n);
  const callJitterRef = useRef<JitterBuffer | null>(null);
  const callPollRef = useRef<number | undefined>(undefined);
  const callMutedRef = useRef(false);
  const [callMuted, setCallMuted] = useState(false);
  const callSupported = isCallAudioSupported();
```

- [ ] **Step 3: Pending-call surfacing across all DM sessions**

Add a derived value:

```tsx
  const pendingCallSession = sessions.find((session) => session.pending_call);
```

Add a memoised handler set:

```tsx
  const acceptCall = useCallback(
    (sessionId: string, callId: string) => {
      void (async () => {
        try {
          await gateway.callAccept(sessionId, callId);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not accept call");
        }
      })();
    },
    [gateway],
  );
  const declineCall = useCallback(
    (sessionId: string, callId: string, reason: string) => {
      void gateway.callDecline(sessionId, callId, reason).catch((error) => {
        setError(error instanceof Error ? error.message : "Could not decline call");
      });
    },
    [gateway],
  );
  const endCall = useCallback(
    (sessionId: string, callId: string, reason: string) => {
      void gateway.callEnd(sessionId, callId, reason).catch((error) => {
        setError(error instanceof Error ? error.message : "Could not end call");
      });
    },
    [gateway],
  );
```

- [ ] **Step 4: Open / close the audio pipeline on `active_call` transitions**

Add an effect keyed on the active DM session's `active_call.call_id`:

```tsx
  const activeDmSession =
    active?.type === "dm" ? sessions.find((s) => s.session_id === active.id) : null;
  const activeCall = activeDmSession?.active_call ?? null;
  const activeSessionId = activeDmSession?.session_id ?? null;

  useEffect(() => {
    if (!activeCall || !activeSessionId) {
      return;
    }
    let cancelled = false;
    const direction =
      activeCall.direction === "caller" ? CALLER_DIRECTION_BIT : CALLEE_DIRECTION_BIT;
    void (async () => {
      try {
        callKeyRef.current = await importCallKey(activeCall.key_b64);
        callSeqRef.current = 0n;
        callJitterRef.current = new JitterBuffer();
        callPlaybackRef.current = await startVoicePlayback();
        callCaptureRef.current = await startVoiceCapture((frame) => {
          if (cancelled || !callKeyRef.current || callMutedRef.current) {
            return;
          }
          void (async () => {
            const seal = await sealFrame(
              callKeyRef.current!,
              activeCall.nonce_prefix_b64,
              callSeqRef.current,
              direction,
              frame,
            );
            callSeqRef.current += 1n;
            try {
              await gateway.callSendFrame(activeSessionId, activeCall.call_id, bytesToBase64(seal));
            } catch (error) {
              console.warn("[voice-call] send failed", error);
            }
          })();
        });

        callPollRef.current = window.setInterval(() => {
          void (async () => {
            try {
              const frames = await gateway.callDrainFrames(activeSessionId, activeCall.call_id);
              if (frames.length === 0 || !callKeyRef.current) {
                return;
              }
              for (const frameB64 of frames) {
                const opened = await openFrame(
                  callKeyRef.current,
                  activeCall.nonce_prefix_b64,
                  bytesFromBase64(frameB64),
                );
                if (opened) {
                  callJitterRef.current?.push({ seq: opened.seq, payload: opened.payload });
                }
              }
              const ready = callJitterRef.current?.drainReady() ?? [];
              for (const buffered of ready) {
                callPlaybackRef.current?.pushFrame(buffered.payload);
              }
            } catch (error) {
              console.warn("[voice-call] poll failed", error);
            }
          })();
        }, 20);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Voice call setup failed",
        );
        if (activeSessionId && activeCall) {
          endCall(activeSessionId, activeCall.call_id, "setup_failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (callPollRef.current !== undefined) {
        window.clearInterval(callPollRef.current);
        callPollRef.current = undefined;
      }
      void callCaptureRef.current?.stop();
      void callPlaybackRef.current?.stop();
      callCaptureRef.current = null;
      callPlaybackRef.current = null;
      callKeyRef.current = null;
      callJitterRef.current = null;
      setCallMuted(false);
      callMutedRef.current = false;
    };
  }, [activeCall?.call_id, activeSessionId, endCall, gateway]);
```

- [ ] **Step 5: Add a Call button to the active DM header**

Find the DM header in `private-dm-screen.tsx` (search for `activeSession` rendering). Next to the existing controls, add:

```tsx
                {active?.type === "dm" ? (
                  <button
                    type="button"
                    className="composer-mic"
                    aria-label="Start voice call"
                    title={
                      callSupported
                        ? "Start voice call"
                        : "Voice calls require a newer WebView"
                    }
                    disabled={
                      !callSupported || !!activeDmSession?.active_call || busy
                    }
                    onClick={() => {
                      if (!activeSessionId) return;
                      void (async () => {
                        try {
                          await gateway.callStart(activeSessionId);
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : "Could not start call",
                          );
                        }
                      })();
                    }}
                  >
                    <IconPhone size={16} />
                  </button>
                ) : null}
```

(Place near the existing close/leave button in the DM header.)

- [ ] **Step 6: Render the modal and overlay**

After the existing `<MediaViewer ...>` rendering (or wherever app-level dialogs sit), add:

```tsx
      {pendingCallSession?.pending_call ? (
        <IncomingCallModal
          pending={pendingCallSession.pending_call}
          peerLabel={pendingCallSession.display_name}
          onAccept={() =>
            acceptCall(
              pendingCallSession.session_id,
              pendingCallSession.pending_call!.call_id,
            )
          }
          onDecline={(reason) =>
            declineCall(
              pendingCallSession.session_id,
              pendingCallSession.pending_call!.call_id,
              reason,
            )
          }
        />
      ) : null}
      {activeCall && activeSessionId && activeDmSession ? (
        <CallOverlay
          active={activeCall}
          peerLabel={activeDmSession.display_name}
          muted={callMuted}
          onToggleMute={() => {
            const next = !callMuted;
            setCallMuted(next);
            callMutedRef.current = next;
          }}
          onHangUp={() => endCall(activeSessionId, activeCall.call_id, "hangup")}
        />
      ) : null}
```

- [ ] **Step 7: OS toast for incoming calls when the window is unfocused**

In the existing notification effect (the one that fires `sendNotification` for new messages), add a separate small effect right after it that watches `pendingCallSession`:

```tsx
  useEffect(() => {
    if (!pendingCallSession) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const focused = await (
          await import("@tauri-apps/api/window")
        )
          .getCurrentWindow()
          .isFocused();
        if (cancelled || focused || !notifyReadyRef.current) {
          return;
        }
        const { sendNotification } = await import(
          "@tauri-apps/plugin-notification"
        );
        sendNotification({
          title: "Mosh",
          body: `Incoming call from ${pendingCallSession.display_name}`,
        });
      } catch {
        // Notification host unavailable; the in-app modal is the user's signal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingCallSession?.session_id, pendingCallSession?.pending_call?.call_id]);
```

- [ ] **Step 8: Typecheck + tests + commit**

```bash
npm run typecheck && npx vitest run
git add src/features/private-dm/private-dm-screen.tsx
git commit -m "feat(voice-call): wire Call button, modal, overlay, and frame loop"
```

Expected: PASS.

---

## Task 18: Frontend — CSS for the call surfaces

**Files:**
- Create: `src/features/private-dm/styles/call.css`
- Modify: `src/App.css`

- [ ] **Step 1: Write the CSS**

Create `call.css`:

```css
.call-modal,
.call-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
}

.call-modal-card,
.call-overlay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 32px 36px;
  border-radius: 14px;
  background: #1d1f24;
  color: #fff;
  min-width: 280px;
}

.call-modal-peer,
.call-overlay-peer {
  font-size: 18px;
}

.call-modal-status,
.call-overlay-timer {
  font-size: 14px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.call-modal-actions,
.call-overlay-actions {
  display: flex;
  gap: 16px;
}

.call-btn {
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: #2a2d33;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.call-btn-accept {
  background: #2ea043;
}

.call-btn-decline {
  background: #e5484d;
}

.call-btn-muted {
  background: #4f8cff;
}

.call-log-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.15);
  font-size: 12px;
}

.call-log-missed {
  color: #e5484d;
}
```

- [ ] **Step 2: Import the CSS**

Add to `src/App.css`:

```css
@import "./features/private-dm/styles/call.css";
```

- [ ] **Step 3: Commit**

```bash
git add src/features/private-dm/styles/call.css src/App.css
git commit -m "style(voice-call): styles for modal, overlay, and call log"
```

---

## Task 19: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: typecheck + vitest + cargo test all PASS.

- [ ] **Step 2: Manual smoke (interactive)**

`npm run tauri dev`. With two app instances in a DM session:
- Caller presses the Call button; callee sees the ringing modal + OS toast (if unfocused).
- Callee accepts; both sides hear each other for ≥ 30 s.
- Caller hangs up; both bubbles show "Call ended · M:SS".
- Repeat with decline → "Missed call" entry.
- Repeat with no-answer (let it ring past 30 s) → "Missed call" entry.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "test: end-to-end verification of voice calls"
```

---

## Self-Review Notes

- **Spec coverage:** Signaling envelopes (Task 1), state machine (Tasks 3-4), public methods (Task 5), Tauri commands (Task 6), gateway (Task 7), frame crypto (Task 8), jitter buffer (Task 9), call-state UI logic (Task 10), capture (Task 11), playback (Task 12), ringtone (Task 13), ringing modal (Task 14), overlay (Task 15), call log (Task 16), screen wiring + Call button + OS toast (Task 17), styles (Task 18). All sections of the spec map to a task.
- **Placeholder scan:** None. Every step shows the full code or exact target.
- **Type consistency:**
  - Native: `ControlEnvelope::Call*` variants match those used in `handle_control` arms (Task 1 → Task 4).
  - Native: `CallState::become_active`, `push_frame`, `drain_frames`, `duration_ms` consistent across Tasks 3, 4, 5.
  - Native: `PendingCall { call_id, from_device }` and `ActiveCall { call_id, direction, key_b64, nonce_prefix_b64, started_at_ms }` used the same way in Tasks 2, 5, 7.
  - Frontend: `CALLER_DIRECTION_BIT`, `CALLEE_DIRECTION_BIT`, `sealFrame`, `openFrame`, `buildFrame`, `parseFrame`, `importCallKey`, `bytesFromBase64`, `bytesToBase64` consistent between Task 8 (definitions) and Task 17 (call site).
  - Frontend: `JitterBuffer.push({seq, payload})` / `drainReady()` consistent between Tasks 9 and 17.
  - Frontend: `startVoiceCapture(onFrame)` returns a `VoiceCaptureHandle` with `stop()`; consistent between Task 11 and Task 17.
- **Known integration seams:** Task 16 step 2 and Task 17 step 5 reference the existing DM chat list + header; the executor should match the file's existing pattern at those sites — the surrounding code may have shifted slightly when this branch's voice-messages work landed.
