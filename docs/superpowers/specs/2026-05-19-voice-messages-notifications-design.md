# Voice Messages + Notifications — Design

Date: 2026-05-19
Status: Approved
Branch: `feat/voice-messages-notifications`

## Summary

Add two features to Mosh, both reusing existing pipelines:

1. **Voice messages** — record microphone audio in-app and send it as a voice
   attachment. Tap mic to start, tap to stop, review (play / re-record /
   cancel), then send. Renders in the chat bubble as an inline player with a
   waveform.
2. **Notifications** — OS-native toast when a new message arrives while the app
   window is unfocused, plus unread-count badges on conversations in the
   sidebar.

Both apply to all three surfaces: private DM, private group, channel.

## Goals

- Voice recording and playback that feels like a standard messenger, with a
  waveform visible before the audio is downloaded.
- No new transport or runtime: voice rides the existing chunked attachment
  transfer; notifications are a frontend layer over the existing poll loop.
- Unread state stays inside the existing screen component (no new dependency).

## Non-Goals

- Hold-to-record. Recording is tap-to-start / tap-to-stop with a review step.
- Voice transcription / speech-to-text.
- Per-conversation deep-linking from a toast click is best-effort, not a goal.
- A separate voice-message runtime or message type.

## Context

Mosh is a Tauri v2 desktop messenger (React + TypeScript frontend, Rust
backend). Relevant existing machinery:

- **Attachment transport.** `AttachmentDescriptor` is immutable attachment
  metadata stamped on the message log and carried in the `AttachmentManifest`
  to the recipient: `attachment_id, content_hash, file_name, mime, total_size,
  thumbnail_b64?`. Mutable transfer state lives in `AttachmentView`.
- Audio MIME types are already viewable and **streamable** — `isStreamableMedia`
  returns true for `audio/`, and partially-downloaded audio plays over the
  `moshmedia://` protocol.
- Three Tauri command sets (`private_dm_*`, `private_group_*`, `channel_*`),
  each with a `send_attachment` / `download_attachment` / `cancel_attachment`
  trio, fronted by `TauriNativeMessagingGateway` in
  `native/native-messaging-gateway.ts`.
- `private-dm-screen.tsx` (~2222 lines) is the whole app shell. It polls DM +
  groups + channels on one interval (`AUTO_POLL_MS`) and holds every
  conversation's state in component-local `useState` / `useRef`.
- No Tauri notification plugin is installed yet. No Zustand in the repo.

## Architecture

```
Voice send:   mic -> MediaRecorder -> Blob(webm/opus)
              -> Web Audio decode -> { duration_ms, peaks[64] }
              -> existing send_attachment(+ voice meta) -> chunked transfer

Voice recv:   AttachmentDescriptor.voice present -> VoiceMessage bubble
              -> waveform from peaks (instant) + play via moshmedia:// stream

Notify:       poll snapshot -> diff vs lastSeen -> unread badges (always)
              + OS toast (when window unfocused)
```

The presence of the `voice` field on a descriptor is the sole marker that an
attachment is a voice message (versus a user-picked audio file). No MIME hack.

## Component Design

### 1. Voice recording (frontend)

New module `src/features/private-dm/voice/`:

- **`voice-recorder.ts`** — wraps `getUserMedia({ audio: true })` and
  `MediaRecorder`. Exposes start / stop, enforces a 5-minute cap, returns the
  recorded `Blob`. Picks the first supported MIME of
  `audio/webm;codecs=opus`, `audio/ogg;codecs=opus`, `audio/webm`. Releases the
  media stream tracks on stop / cancel.
- **`waveform.ts`** — decodes an audio `Blob` with `AudioContext.decodeAudioData`,
  downsamples the first channel to 64 amplitude buckets as a `Uint8Array`
  (0–255), and returns `{ durationMs, peaks }`. Helpers `peaksToBase64` /
  `peaksFromBase64`. A decode failure yields a flat (all-zero) waveform — never
  fatal, mirroring the existing thumbnail "missing is never fatal" rule.
- **`VoiceComposer.tsx`** — a mic button placed beside `AttachmentPicker` in the
  composer. Three states:
  - **idle** — mic button.
  - **recording** — elapsed timer, stop button, cancel button.
  - **review** — waveform preview, play/pause, re-record, cancel, send.

  Send routes through the existing gateway `send*Attachment` call with the new
  `voice` argument. File name is `voice-message.webm` (extension follows the
  chosen container).

### 2. Voice transport (native)

- `VoiceMeta` struct: `{ duration_ms: u32, peaks_b64: String }`.
  `peaks` is 64 bytes, base64 ≈ 88 chars.
- `AttachmentDescriptor` and `AttachmentManifest` gain
  `voice: Option<VoiceMeta>` with `#[serde(skip_serializing_if = "Option::is_none")]`.
  Non-voice attachments are byte-identical on the wire.
- `send_attachment` in `private_dm_runtime`, `private_group_runtime`, and
  `channel_runtime` gains a `voice: Option<VoiceMeta>` parameter, threaded into
  the manifest exactly as `thumbnail` already is.
- `descriptor_of` copies `voice` from the manifest.
- The three `*_send_attachment` Tauri commands and the matching
  `TauriNativeMessagingGateway` methods gain the `voice` parameter.

### 3. Voice bubble rendering

New `VoiceMessage.tsx`:

- Inline play/pause button, duration label, a draggable progress bar, and a
  `<canvas>` waveform drawn from `descriptor.voice.peaks_b64`. The waveform
  renders immediately, before any download.
- Audio source: `localFileSrc` once the attachment is fully downloaded,
  otherwise `streamingMediaSrc` (audio already streams over `moshmedia://`).
- `AttachmentCard` renders `VoiceMessage` instead of the file/media card when
  `descriptor.voice` is set — a single branch, no duplicated transfer controls.

### 4. Notifications

- **Tauri plugin.** Add the `tauri-plugin-notification` crate and the
  `@tauri-apps/plugin-notification` package, register the plugin in `lib.rs`,
  and add `notification:default` to `src-tauri/capabilities/default.json`.
- **Unread tracking.** New `notifications/unread.ts` holds the pure diff logic;
  wiring lives in `private-dm-screen.tsx`. A `lastSeenCount` ref-map keyed by
  conversation id is compared against each poll snapshot's per-conversation
  `messages.length`:
  - Conversation not currently open → increment its sidebar unread badge.
  - New **incoming** message (not the user's own) AND window unfocused
    (`getCurrentWindow().isFocused()`) → fire an OS toast: title
    `"<sender> · <surface>"`, body the message text, or `"Voice message"` for a
    voice attachment.
  - Opening or focusing a conversation clears its unread count and resets
    `lastSeen` to the current message count.
- **Toast click.** Focuses the app window. Per-conversation deep-linking is
  best-effort via notification action events; the unread badge is the
  guaranteed fallback.

## Data Flow

1. User taps mic → `voice-recorder` captures a `Blob`.
2. On stop, `waveform.ts` decodes the `Blob` into `{ durationMs, peaks }`; the
   review UI shows the waveform and a play control.
3. On send, the frontend base64-encodes the audio bytes and calls the gateway
   `send*Attachment` with `voice = { duration_ms, peaks_b64 }`.
4. Native `send_attachment` stamps `voice` into the manifest; the chunked
   transfer proceeds unchanged.
5. The recipient's poll snapshot carries `AttachmentDescriptor.voice`;
   `AttachmentCard` renders `VoiceMessage`, waveform visible immediately.
6. Playback streams over `moshmedia://` while downloading, then plays the local
   file once complete.
7. Independently, each poll diffs message counts → unread badges + OS toasts.

## Error Handling

- `getUserMedia` denied or unavailable → recording disabled with an inline
  message; the rest of the composer is unaffected.
- Unsupported `MediaRecorder` MIME → fall back through the candidate list; if
  none work, voice recording is disabled (file attachments still work).
- `decodeAudioData` failure → flat waveform; send still proceeds.
- Notification permission denied → unread badges still work; OS toasts are
  silently skipped.
- A voice attachment transfer failure reuses the existing attachment
  retry / cancel controls.

## Testing

- `waveform.test.ts` — downsample to 64 buckets; `peaksToBase64` /
  `peaksFromBase64` roundtrip; decode-failure yields a flat waveform.
- `unread.test.ts` — diff logic: new incoming versus the user's own messages,
  suppression while a conversation is open, badge clear on open.
- `voice-recorder` — `MediaRecorder` / `getUserMedia` mocked under jsdom.
- Rust — `VoiceMeta` serde roundtrip; `skip_serializing_if` keeps a non-voice
  `AttachmentDescriptor` byte-identical to today.

## Risks

- **`getUserMedia` in Tauri WebView2** — may need a webview permission handler
  on Windows. Verified first, as the tracer bullet's opening step.
- **Opus codec support** — `MediaRecorder` MIME availability varies; mitigated
  by the candidate-list fallback.
- **Toast deep-link** — per-conversation click target is best-effort across
  operating systems; the unread badge is the reliable fallback.

## Rollout

Tracer bullet order:

1. Verify `getUserMedia` works in the Tauri WebView2 shell on Windows.
2. Native `voice` field end-to-end (serde, manifest, one surface).
3. Voice recording + send for private DM.
4. `VoiceMessage` bubble with waveform.
5. Extend voice to group + channel.
6. Notification plugin + unread badges + OS toasts.
