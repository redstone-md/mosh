# Voice Calls — Design

Date: 2026-05-19
Status: Approved
Branch: `feat/voice-calls` (based on `feat/voice-messages-notifications`)

## Summary

Add real-time 1:1 voice calls inside an existing private DM session. Signaling
rides the DM's MLS-protected control channel. Media flows as AES-GCM-encrypted
Opus frames on a dedicated Moss pub/sub channel, `voice-call/<call_id>`. No
WebRTC, no STUN, no new transport. An incoming call surfaces as a full-window
ringing modal plus an OS toast (when the app is unfocused) plus a short looping
ringtone, with a 30-second auto-decline.

## Goals

- Place and receive a 1:1 voice call inside an open DM session.
- Reuse the existing MLS control channel for signaling and the existing Moss
  transport for media.
- Per-call symmetric AES-GCM encryption; the key is delivered inside the
  MLS-protected offer.
- Production-feeling ring UX: modal + OS toast + ringtone + 30 s auto-decline,
  with missed and completed calls logged into the DM chat history.
- Build the right primitives so later slices (group calls, video, screen share)
  reuse them.

## Non-Goals

- Group calls. Channel calls. Video. Screen share. (Future slices.)
- ICE/STUN/TURN. No WebRTC stack — native or browser `RTCPeerConnection`.
- ECDH-derived per-call keys. MLS forward secrecy on the key delivery is
  sufficient for the MVP.
- A native Rust audio path. All capture/encode/decode/playback happens in the
  WebView.
- Persistent call recordings.

## Context

This branch builds on `feat/voice-messages-notifications`, which already adds:
the microphone permission flow, an `OS notification` plugin, a desktop
overlay UI patterns, and a chunked attachment transfer (irrelevant to media here
but exercises Moss publish from the runtime).

The wider mosh app:

- **Transport.** Moss exposes `publish(channel, payload)` and `subscribe(channel)`.
  Delivery rides a GossipSub-flavored mesh; established DM peers are direct.
- **Signaling.** `ControlEnvelope` enums in `private_dm_runtime/wire.rs` already
  carry MLS-encrypted application messages (welcome, attachment manifests).
  Adding new variants is the natural extension.
- **MLS.** The DM session's MLS group provides forward-secret encryption for
  the control channel; we use it to deliver a per-call symmetric key.
- **WebView.** Tauri v2 with WebView2 on Windows (Chromium 121+ in 2026). This
  ships `WebCodecs` (`AudioEncoder`/`AudioDecoder`) and `AudioWorklet`.

## Architecture

```
Caller                         MLS control                Callee
  │  CallOffer{call_id,key} ──────────────────────────────▶│
  │                                                        │   Ring modal + toast
  │                                                        │   + ringtone (30 s)
  │  ◀──────────────────────────────── CallAccept           │
  │                                                        │
  │  ── opus frames (AES-GCM) on voice-call/<call_id> ─────────────────▶
  │  ◀─ opus frames (AES-GCM) on voice-call/<call_id> ─────────────────
  │                                                        │
  │  CallEnd ─────────────────────────────────────────────▶│
```

Call states: `Idle → Outgoing → (Active|Cancelled) → Ended` on the caller,
`Idle → Ringing → (Active|Declined|Missed) → Ended` on the callee. The state
machine is a pure module on the frontend, validated by tests.

## Component Design

### Native — `adapters/voice_call_runtime.rs` (new)

Per private-DM session, the runtime tracks one optional active call. New
`ControlEnvelope` variants in `private_dm_runtime/wire.rs`:

```rust
CallOffer {
    session_id: String,
    participant_id: String,
    from_device: String,
    call_id: String,
    key_b64: String,         // 32 bytes
    nonce_prefix_b64: String,// 4 bytes
}
CallAccept  { session_id, participant_id, call_id }
CallDecline { session_id, participant_id, call_id, reason: String }
CallEnd     { session_id, participant_id, call_id, reason: String }
```

`PrivateDmRuntime` gains:

- `pub fn call_start(session_id) -> CallStarted` — generates `call_id` + key +
  nonce prefix, sends `CallOffer`, subscribes to `voice-call/<call_id>`,
  records `Outgoing` state.
- `pub fn call_accept(session_id, call_id)` — sends `CallAccept`, subscribes
  to the media channel, transitions to `Active`.
- `pub fn call_decline(session_id, call_id, reason)` — sends `CallDecline`,
  appends a missed-call log entry on the callee.
- `pub fn call_end(session_id, call_id, reason)` — sends `CallEnd`,
  unsubscribes, appends a completed-call log entry on both sides with the call's
  duration computed from `Active`-state timestamp.
- `pub fn call_send_frame(session_id, call_id, frame_bytes)` —
  `publish("voice-call/<call_id>", frame_bytes)`.
- `pub fn call_drain_frames(session_id, call_id) -> Vec<frame_bytes>` —
  hands the WebView every frame received on that channel since the last
  drain; FIFO, never blocks.

`call_drain_frames` is the MVP delivery primitive. A later iteration replaces
it with a Tauri `emit` push to shave the ~10–20 ms of polling latency.

Snapshots gain `pending_call: Option<PendingCall>` and `active_call:
Option<ActiveCall>` so the frontend can render ringing and overlay states
without extra commands. Completed and missed calls land in
`SessionSnapshot.messages` as a new `ChatMessage.call_event: Option<CallEvent>`
field with `{ kind: "missed" | "completed", duration_ms }` (skipped on the wire
when `None`, just like `attachment`).

### Native — Tauri commands (lib.rs)

```
private_dm_call_start(session_id) -> CallStarted
private_dm_call_accept(session_id, call_id) -> ()
private_dm_call_decline(session_id, call_id, reason) -> ()
private_dm_call_end(session_id, call_id, reason) -> ()
private_dm_call_send_frame(session_id, call_id, frame_b64) -> ()
private_dm_call_drain_frames(session_id, call_id) -> Vec<String>  // base64 frames, FIFO
```

### Frontend — `src/features/private-dm/voice-call/`

- **`frame-crypto.ts`** — `encryptFrame(key, noncePrefix, seq, opus): Uint8Array`
  using `crypto.subtle` AES-GCM (12-byte nonce = 4-byte prefix ‖ 8-byte BE seq).
  `decryptFrame` mirrors. On any decrypt failure, returns `null` — the caller
  drops the frame silently.
- **`audio-capture.ts`** — `getUserMedia({ audio: { echoCancellation: true,
  noiseSuppression: true, autoGainControl: true } })` → `AudioContext` →
  `AudioWorklet` that pulls 20 ms PCM frames (16 kHz mono) → `WebCodecs
  AudioEncoder` (opus, bitrate 24 kbps). Emits each frame to a callback.
- **`audio-playback.ts`** — A small jitter buffer (target 60 ms, max 200 ms)
  keyed by seq number: drops late frames, fills gaps with the previous frame
  played at -6 dB (cheap PLC). Decodes via `WebCodecs AudioDecoder`, schedules
  `AudioBufferSourceNode`s on a shared playback `AudioContext`.
- **`call-state.ts`** — Pure state-machine module: types for `Idle | Outgoing
  | Ringing | Active | Ended`, transition helpers, no-answer timeout helper.
  Easy to unit-test.
- **`ringtone.ts`** — Plays a short looping ringtone via a Web Audio
  `OscillatorNode` pattern (no asset to ship). `stop()` cleanly tears it down.
- **`CallOverlay.tsx`** — Full-window overlay while a call is active: peer
  name, running timer, mute toggle, hang up button.
- **`IncomingCallModal.tsx`** — Full-window modal while a call is ringing:
  caller name, Accept and Decline. Starts the ringtone on mount; stops on
  unmount. 30 s auto-decline.
- Wiring in `private-dm-screen.tsx`:
  - A Call button (phone icon) in the DM header. Disabled when WebCodecs is
    absent (tooltip: "Calls require a newer WebView"). Disabled while a call is
    already in flight.
  - When the active DM snapshot has `active_call`, render `CallOverlay`.
  - When **any** DM snapshot has a `pending_call`, render
    `IncomingCallModal` (and fire an OS toast if the window is unfocused).
  - On accept, the frontend opens the capture + playback pipelines and starts
    a fast frame-drain loop (`setInterval`, 20 ms) calling
    `private_dm_call_drain_frames`.
  - In the chat log, a `call_event` `ChatMessage` renders as a `CallLogEntry`
    pill ("Call ended · 2:34" / "Missed call").

### Gateway (`native-messaging-gateway.ts`)

Six new methods mirroring the Tauri commands above. Types for `CallStarted`,
`PendingCall`, `ActiveCall`, and `CallEvent` exported.

## Wire Format

```
on-wire opus frame = [seq:u64 BE] [aes_gcm_ciphertext_with_tag]
   where aes_gcm = AES-GCM(key, nonce_prefix ‖ seq, opus_payload)
```

`seq` starts at `0` per direction. Receiver tracks the highest accepted seq and
drops frames at or below it (replay protection).

The Moss media channel `voice-call/<call_id>` carries these byte blobs
directly. Frames are at most a few hundred bytes each (24 kbps Opus, 20 ms ≈
60 bytes plus 16 bytes GCM tag plus the 8-byte seq header).

## Encryption

Per call:

- Caller generates a fresh 32-byte AES-GCM key and a fresh 4-byte nonce prefix.
- Both travel inside `CallOffer`, which the MLS group encrypts in transit.
- Both sides use the same key for both directions of media; the 8-byte seq is
  per-direction so nonces never collide (caller uses prefix‖seq; callee uses
  prefix‖(MSB-set seq)). Concretely: the high bit of the seq is `0` for the
  caller and `1` for the callee — gives a 2^63 cap, far beyond a call's
  lifetime.
- Forward secrecy of the media key comes from MLS forward secrecy on the
  CallOffer envelope.

## Latency Budget

| Stage                        | Target     |
|------------------------------|------------|
| Capture frame (20 ms)        | 20 ms      |
| Opus encode                  | ~5 ms      |
| Moss publish (direct peer)   | 20–80 ms   |
| Jitter buffer hold           | 60 ms      |
| Opus decode + schedule       | ~5 ms      |
| **Mouth-to-ear**             | 110–170 ms |

Acceptable for conversation. Relayed peers may exceed; flagged as a known
limitation, not a release blocker.

## Error Handling

- WebCodecs absent → Call button disabled with tooltip; the rest of the app
  unaffected.
- Microphone denied → modal closes, error toast, no call started.
- No CallAccept within 30 s → caller sends `CallEnd{reason: "no_answer"}`,
  appends a missed-call log entry on the callee, a completed `0:00` entry on
  the caller.
- 5 s of empty jitter buffer → overlay shows "Reconnecting…"; 30 s → auto-end
  with `CallEnd{reason: "lost"}`.
- Decrypt failure on a frame → silently drop. Never surface to the attacker.

## Testing

- `frame-crypto.test.ts` — encrypt/decrypt roundtrip; tampered ciphertext
  rejected; replay (same seq) rejected.
- `jitter-buffer.test.ts` — out-of-order frames drain in order; frames below
  the cursor drop; gaps fall through to PLC.
- `call-state.test.ts` — every transition; no-answer timeout fires; double-end
  is idempotent.
- Rust: `ControlEnvelope::Call*` serde roundtrip; runtime state-machine
  transitions; snapshot exposes `pending_call` / `active_call` correctly.

## Rollout

Tracer bullet order:

1. Native `ControlEnvelope::Call*` variants + serde tests.
2. Native call state machine + snapshot fields + Tauri commands (no real
   audio yet — exercise signaling end-to-end with empty frames).
3. Frontend `frame-crypto` + `jitter-buffer` + `call-state` pure modules with
   tests.
4. Frontend `audio-capture` + `audio-playback` wired through the gateway,
   verified locally between two app instances.
5. `IncomingCallModal` + `CallOverlay` + ring UX + chat-log entries.
6. Hardening: no-answer / lost-call timeouts, OS toast for ringing.

## Risks

- **WebCodecs API in WebView2.** Verified first; a feature-detect gate keeps
  Calls disabled on older WebView2 builds rather than crashing.
- **Moss latency on relayed paths.** Direct-peer DMs are the supported case;
  document the relayed-path caveat in the spec.
- **Frame-poll loop at ~50 Hz** is acceptable for an MVP but burns CPU; the
  follow-up swaps it for a Tauri `emit` push channel.
- **Microphone permission re-prompt** across app sessions — same shape as
  voice messages; same mitigation.
