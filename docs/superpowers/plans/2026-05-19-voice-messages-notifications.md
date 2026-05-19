# Voice Messages + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app voice-message recording/playback and OS notifications + unread badges to Mosh, across private DM, private group, and channel surfaces.

**Architecture:** Voice rides the existing chunked attachment transfer — a new optional `voice` field (`{ duration_ms, peaks_b64 }`) on the attachment manifest/descriptor carries duration and a 64-bucket waveform; non-voice attachments stay byte-identical on the wire. Notifications are a frontend layer over the existing poll loop: a per-conversation last-seen ref-map drives unread badges and OS toasts. Unread state lives in the existing `private-dm-screen.tsx` component (no Zustand).

**Tech Stack:** Tauri v2, Rust, React 19, TypeScript, Vitest, `cargo test`, `MediaRecorder` / Web Audio API, `tauri-plugin-notification`.

**Spec:** `docs/superpowers/specs/2026-05-19-voice-messages-notifications-design.md`

---

## File Structure

**New files:**
- `src/features/private-dm/voice/waveform.ts` — audio decode + 64-bucket downsample + base64 codec.
- `src/features/private-dm/voice/waveform.test.ts`
- `src/features/private-dm/voice/voice-recorder.ts` — `MediaRecorder` / `getUserMedia` wrapper.
- `src/features/private-dm/voice/voice-recorder.test.ts`
- `src/features/private-dm/voice/VoiceComposer.tsx` — 3-state mic recorder UI.
- `src/features/private-dm/voice/VoiceMessage.tsx` — inline player + waveform canvas bubble.
- `src/features/private-dm/notifications/unread.ts` — pure unread-diff logic.
- `src/features/private-dm/notifications/unread.test.ts`
- `src/features/private-dm/styles/voice.css` — voice + unread-badge styles.

**Modified files:**
- `src-tauri/src/adapters/attachment_runtime.rs` — `VoiceMeta` type, `voice` on `AttachmentManifest`, `prepare_outgoing` param.
- `src-tauri/src/adapters/private_dm_runtime/contracts.rs` — `voice` on `AttachmentDescriptor`.
- `src-tauri/src/adapters/private_dm_runtime.rs` — `send_attachment` param, `descriptor_of`, `VoiceMeta` re-export.
- `src-tauri/src/adapters/channel_runtime.rs` — `send_attachment` param, `descriptor_of`.
- `src-tauri/src/adapters/private_group_runtime.rs` — `send_attachment` param, `descriptor_of`.
- `src-tauri/src/lib.rs` — 3 `*_send_attachment` commands gain `voice`, register notification plugin.
- `src-tauri/Cargo.toml` — add `tauri-plugin-notification`.
- `src-tauri/capabilities/default.json` — add `notification:default`.
- `package.json` — add `@tauri-apps/plugin-notification`.
- `src/features/private-dm/native/native-messaging-gateway.ts` — `VoiceMeta` type, `voice` param on 3 `send*Attachment` methods.
- `src/features/private-dm/attachments.tsx` — `AttachmentCard` renders `VoiceMessage` when `descriptor.voice` is set.
- `src/features/private-dm/private-dm-screen.tsx` — voice send handler, `Composer` voice prop, poll-loop unread/toast wiring, sidebar badges.
- `src/App.css` or the relevant CSS import site — import `voice.css`.

---

## Task 1: Native `VoiceMeta` type + manifest/descriptor field

**Files:**
- Modify: `src-tauri/src/adapters/attachment_runtime.rs` (struct `AttachmentManifest`, ~line 60-73)
- Modify: `src-tauri/src/adapters/private_dm_runtime/contracts.rs` (struct `AttachmentDescriptor`, ~line 120-129)

- [ ] **Step 1: Add the failing serde test**

In `src-tauri/src/adapters/attachment_runtime.rs`, find the `#[cfg(test)] mod tests` block and add:

```rust
#[test]
fn voice_meta_roundtrips_through_json() {
    let meta = VoiceMeta {
        duration_ms: 4200,
        peaks_b64: "AAECAwQF".to_string(),
    };
    let json = serde_json::to_string(&meta).expect("serialize");
    let back: VoiceMeta = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(back.duration_ms, 4200);
    assert_eq!(back.peaks_b64, "AAECAwQF");
}

#[test]
fn manifest_without_voice_omits_the_field() {
    let manifest = AttachmentManifest {
        attachment_id: "a".into(),
        content_hash: "h".into(),
        file_name: "f".into(),
        mime: "audio/webm".into(),
        total_size: 1,
        chunk_size: 1,
        chunk_count: 1,
        key_b64: "k".into(),
        nonce_prefix_b64: "n".into(),
        thumbnail_b64: None,
        voice: None,
        from_fingerprint: "fp".into(),
    };
    let json = serde_json::to_string(&manifest).expect("serialize");
    assert!(!json.contains("voice"), "voice must be omitted when None");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml voice_meta_roundtrips manifest_without_voice`
Expected: compile error — `VoiceMeta` not found / missing field `voice`.

- [ ] **Step 3: Add `VoiceMeta` and the manifest field**

In `src-tauri/src/adapters/attachment_runtime.rs`, directly above `pub struct AttachmentManifest`, add:

```rust
/// Voice-message metadata carried alongside an audio attachment. Its presence
/// is the sole marker that an attachment is a recorded voice message rather
/// than a user-picked audio file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceMeta {
    /// Recording length in milliseconds.
    pub duration_ms: u32,
    /// 64 amplitude buckets (one byte each, 0-255), base64-encoded.
    pub peaks_b64: String,
}
```

Then add this field to `AttachmentManifest`, immediately after `thumbnail_b64`:

```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<VoiceMeta>,
```

- [ ] **Step 4: Add the `voice` field to `AttachmentDescriptor`**

In `src-tauri/src/adapters/private_dm_runtime/contracts.rs`, add the import at the top (with the other `use crate::adapters::...` lines):

```rust
use crate::adapters::attachment_runtime::VoiceMeta;
```

Then add this field to `AttachmentDescriptor`, immediately after `thumbnail_b64`:

```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<VoiceMeta>,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml voice_meta_roundtrips manifest_without_voice`
Expected: both PASS. (Other files will not yet compile — that is fixed in Task 2-4. If the whole crate fails to build, run only after Task 4. Note this and continue.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/adapters/attachment_runtime.rs src-tauri/src/adapters/private_dm_runtime/contracts.rs
git commit -m "feat(attachments): add voice metadata to manifest and descriptor"
```

---

## Task 2: Thread `voice` through `attachment_runtime::prepare_outgoing`

**Files:**
- Modify: `src-tauri/src/adapters/attachment_runtime.rs` (`prepare_outgoing`, ~line 175-209)

- [ ] **Step 1: Add the failing test**

In the `#[cfg(test)] mod tests` block of `attachment_runtime.rs`, add:

```rust
#[test]
fn prepare_outgoing_stamps_voice_onto_the_manifest() {
    let mut runtime = AttachmentRuntime::new();
    let voice = VoiceMeta {
        duration_ms: 1000,
        peaks_b64: "AAA=".to_string(),
    };
    let manifest = runtime
        .prepare_outgoing(
            "att-1".into(),
            "voice-message.webm".into(),
            "audio/webm".into(),
            "fp".into(),
            vec![1, 2, 3, 4],
            None,
            Some(voice),
        )
        .expect("prepare");
    let stamped = manifest.voice.expect("voice present");
    assert_eq!(stamped.duration_ms, 1000);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml prepare_outgoing_stamps_voice`
Expected: compile error — `prepare_outgoing` takes 6 args, not 7.

- [ ] **Step 3: Add the parameter**

In `prepare_outgoing`, add a parameter after `thumbnail_b64: Option<String>,`:

```rust
        voice: Option<VoiceMeta>,
```

In the `AttachmentManifest { ... }` literal inside that function, add after `thumbnail_b64,`:

```rust
            voice,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml prepare_outgoing_stamps_voice`
Expected: PASS (callers in other files still fail to compile — fixed next tasks).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/adapters/attachment_runtime.rs
git commit -m "feat(attachments): thread voice metadata through prepare_outgoing"
```

---

## Task 3: Thread `voice` through `private_dm_runtime`

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime.rs` (re-export ~line 8-12; public `send_attachment` ~line 216-227; private `send_attachment` ~line 579-600; `descriptor_of` ~line 815-825)

- [ ] **Step 1: Re-export `VoiceMeta`**

In `private_dm_runtime.rs`, find the `use crate::adapters::attachment_runtime::{...}` import and ensure `VoiceMeta` is included. Then add a `pub use` so channel/group runtimes can import it from `private_dm_runtime`:

```rust
pub use crate::adapters::attachment_runtime::VoiceMeta;
```

- [ ] **Step 2: Add the `voice` parameter to the public `send_attachment`**

The public `pub fn send_attachment` (the one calling `session.send_attachment(...)`): add a parameter after `thumbnail: Option<String>,`:

```rust
        voice: Option<VoiceMeta>,
```

and update the inner call:

```rust
        session.send_attachment(file_name, mime, bytes, thumbnail, voice)
```

- [ ] **Step 3: Add the `voice` parameter to the private `send_attachment`**

The private `fn send_attachment` on the session: add the same parameter after `thumbnail: Option<String>,`:

```rust
        voice: Option<VoiceMeta>,
```

and pass it into the `self.attachments.prepare_outgoing(...)` call as the new final argument (after `thumbnail,`):

```rust
            voice,
```

- [ ] **Step 4: Update `descriptor_of`**

In the `fn descriptor_of(manifest: &AttachmentManifest) -> AttachmentDescriptor` function, add to the returned struct literal after `thumbnail_b64: manifest.thumbnail_b64.clone(),`:

```rust
        voice: manifest.voice.clone(),
```

- [ ] **Step 5: Run the runtime tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib adapters::private_dm_runtime`
Expected: PASS (lib.rs caller still fails — fixed in Task 5).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/adapters/private_dm_runtime.rs
git commit -m "feat(private-dm): thread voice metadata through attachment send"
```

---

## Task 4: Thread `voice` through `channel_runtime` and `private_group_runtime`

**Files:**
- Modify: `src-tauri/src/adapters/channel_runtime.rs` (public `send_attachment` ~line 329; private `send_attachment` ~line 575; `descriptor_of` ~line 819-826)
- Modify: `src-tauri/src/adapters/private_group_runtime.rs` (public `send_attachment` ~line 411; private `send_attachment` ~line 946; `descriptor_of` ~line 1167-1174)

- [ ] **Step 1: Update `channel_runtime.rs` imports**

In the `use crate::adapters::private_dm_runtime::{...}` block, add `VoiceMeta` to the imported names.

- [ ] **Step 2: Update `channel_runtime.rs` `send_attachment` (both) + `descriptor_of`**

Public `pub fn send_attachment`: add parameter after `thumbnail: Option<String>,`:

```rust
        voice: Option<VoiceMeta>,
```

and forward `voice` into the inner private-method call as a new final argument.

Private `fn send_attachment`: add the same `voice: Option<VoiceMeta>,` parameter and pass `voice` as the new final argument of the `prepare_outgoing(...)` call (after `thumbnail,`).

`fn descriptor_of`: add to the returned struct after `thumbnail_b64: manifest.thumbnail_b64.clone(),`:

```rust
        voice: manifest.voice.clone(),
```

- [ ] **Step 3: Repeat for `private_group_runtime.rs`**

Apply the identical three changes in `private_group_runtime.rs`: add `VoiceMeta` to the `use crate::adapters::private_dm_runtime::{...}` import; add `voice: Option<VoiceMeta>,` to both the public and private `send_attachment`; forward `voice` into the private call and into `prepare_outgoing`; add `voice: manifest.voice.clone(),` to `descriptor_of`.

- [ ] **Step 4: Run the runtime tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib adapters::channel_runtime adapters::private_group_runtime`
Expected: PASS (lib.rs caller still fails — fixed in Task 5).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/adapters/channel_runtime.rs src-tauri/src/adapters/private_group_runtime.rs
git commit -m "feat(channels,groups): thread voice metadata through attachment send"
```

---

## Task 5: Tauri commands accept `voice`

**Files:**
- Modify: `src-tauri/src/lib.rs` (`private_dm_send_attachment` ~line 291-307; `channel_send_attachment` ~line 528-545; `private_group_send_attachment` ~line 663-680)

- [ ] **Step 1: Add a serde-default `voice` parameter to `private_dm_send_attachment`**

In `private_dm_send_attachment`, add a parameter after `thumbnail_base64: Option<String>,`:

```rust
    voice: Option<adapters::attachment_runtime::VoiceMeta>,
```

and pass `voice.clone()` as the new final argument of the `runtime.send_attachment(...)` call:

```rust
            .send_attachment(&session_id, file_name, mime, bytes, thumbnail_base64.clone(), voice.clone())
```

- [ ] **Step 2: Repeat for `channel_send_attachment` and `private_group_send_attachment`**

Apply the same two edits to both commands: add the `voice: Option<adapters::attachment_runtime::VoiceMeta>,` parameter after `thumbnail_base64`, and pass `voice.clone()` as the final argument of each `runtime.send_attachment(...)` call.

- [ ] **Step 3: Run the full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: the whole crate compiles; all tests PASS, including `voice_meta_roundtrips_through_json`, `manifest_without_voice_omits_the_field`, `prepare_outgoing_stamps_voice_onto_the_manifest`.

- [ ] **Step 4: Check formatting**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`
Expected: no changes needed (or apply them).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(commands): accept voice metadata in send_attachment commands"
```

---

## Task 6: Frontend gateway — `VoiceMeta` type + `voice` parameter

**Files:**
- Modify: `src/features/private-dm/native/native-messaging-gateway.ts` (`AttachmentDescriptor` ~line 109-116; `NativeMessagingGateway` interface ~line 322-347; `TauriNativeMessagingGateway` methods ~line 443-505)

- [ ] **Step 1: Add the `VoiceMeta` type and the descriptor field**

Add this interface near `AttachmentDescriptor`:

```typescript
export interface VoiceMeta {
  readonly duration_ms: number;
  /** 64 amplitude buckets (one byte each, 0-255), base64-encoded. */
  readonly peaks_b64: string;
}
```

Add to the `AttachmentDescriptor` interface, after `thumbnail_b64?: string;`:

```typescript
  readonly voice?: VoiceMeta;
```

- [ ] **Step 2: Add `voice` to the three `send*Attachment` interface signatures**

In the `NativeMessagingGateway` interface, add an optional final parameter `voice?: VoiceMeta` to `sendPrivateAttachment`, `sendGroupAttachment`, and `sendChannelAttachment` (after `thumbnailBase64?: string`).

- [ ] **Step 3: Add `voice` to the three `TauriNativeMessagingGateway` methods**

In each of the three method implementations, add the `voice?: VoiceMeta` parameter and pass `voice: voice ?? null` in the `invoke(...)` argument object. Example for `sendPrivateAttachment`:

```typescript
  async sendPrivateAttachment(
    sessionId: string,
    fileName: string,
    mime: string,
    dataBase64: string,
    thumbnailBase64?: string,
    voice?: VoiceMeta,
  ): Promise<AttachmentSendResult> {
    return invoke<AttachmentSendResult>(PRIVATE_DM_SEND_ATTACHMENT_COMMAND, {
      sessionId,
      fileName,
      mime,
      dataBase64,
      thumbnailBase64: thumbnailBase64 ?? null,
      voice: voice ?? null,
    });
  }
```

Apply the equivalent change to `sendGroupAttachment` and `sendChannelAttachment`.

- [ ] **Step 4: Run the typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/private-dm/native/native-messaging-gateway.ts
git commit -m "feat(gateway): accept voice metadata in attachment send methods"
```

---

## Task 7: `waveform.ts` — audio decode + downsample + base64 codec

**Files:**
- Create: `src/features/private-dm/voice/waveform.ts`
- Create: `src/features/private-dm/voice/waveform.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/private-dm/voice/waveform.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  WAVEFORM_BUCKETS,
  downsamplePeaks,
  peaksToBase64,
  peaksFromBase64,
} from "./waveform";

describe("downsamplePeaks", () => {
  it("produces exactly WAVEFORM_BUCKETS buckets", () => {
    const samples = new Float32Array(10_000).fill(0.5);
    const peaks = downsamplePeaks(samples);
    expect(peaks.length).toBe(WAVEFORM_BUCKETS);
  });

  it("maps a full-scale signal to 255 and silence to 0", () => {
    const loud = downsamplePeaks(new Float32Array(2_000).fill(1));
    const silent = downsamplePeaks(new Float32Array(2_000).fill(0));
    expect(Math.max(...loud)).toBe(255);
    expect(Math.max(...silent)).toBe(0);
  });

  it("handles input shorter than the bucket count", () => {
    const peaks = downsamplePeaks(new Float32Array([1, -1, 1]));
    expect(peaks.length).toBe(WAVEFORM_BUCKETS);
    expect(peaks[0]).toBe(255);
  });
});

describe("base64 codec", () => {
  it("roundtrips peaks through base64", () => {
    const peaks = new Uint8Array(WAVEFORM_BUCKETS);
    for (let i = 0; i < peaks.length; i += 1) {
      peaks[i] = i * 3;
    }
    const restored = peaksFromBase64(peaksToBase64(peaks));
    expect(Array.from(restored)).toEqual(Array.from(peaks));
  });

  it("returns a flat waveform for invalid base64", () => {
    const restored = peaksFromBase64("!!!not-base64!!!");
    expect(restored.length).toBe(WAVEFORM_BUCKETS);
    expect(Math.max(...restored)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/private-dm/voice/waveform.test.ts`
Expected: FAIL — cannot resolve `./waveform`.

- [ ] **Step 3: Write the implementation**

Create `src/features/private-dm/voice/waveform.ts`:

```typescript
/** Number of amplitude buckets in a voice-message waveform. */
export const WAVEFORM_BUCKETS = 64;

/**
 * Downsamples mono PCM samples (range -1..1) to WAVEFORM_BUCKETS peak
 * amplitudes, each a byte 0-255. Each bucket holds the maximum absolute
 * amplitude of its slice. Always returns exactly WAVEFORM_BUCKETS bytes.
 */
export function downsamplePeaks(samples: Float32Array): Uint8Array {
  const peaks = new Uint8Array(WAVEFORM_BUCKETS);
  if (samples.length === 0) {
    return peaks;
  }
  const sliceSize = samples.length / WAVEFORM_BUCKETS;
  for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket += 1) {
    const start = Math.floor(bucket * sliceSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * sliceSize));
    let peak = 0;
    for (let i = start; i < end && i < samples.length; i += 1) {
      const amplitude = Math.abs(samples[i]);
      if (amplitude > peak) {
        peak = amplitude;
      }
    }
    peaks[bucket] = Math.min(255, Math.round(peak * 255));
  }
  return peaks;
}

/** Encodes waveform peaks as a base64 string for transport. */
export function peaksToBase64(peaks: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < peaks.length; i += 1) {
    binary += String.fromCharCode(peaks[i]);
  }
  return btoa(binary);
}

/**
 * Decodes base64 waveform peaks. Returns a flat (all-zero) waveform of
 * WAVEFORM_BUCKETS bytes if the input is malformed — a bad waveform is
 * never fatal.
 */
export function peaksFromBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const peaks = new Uint8Array(WAVEFORM_BUCKETS);
    for (let i = 0; i < WAVEFORM_BUCKETS && i < binary.length; i += 1) {
      peaks[i] = binary.charCodeAt(i) & 0xff;
    }
    return peaks;
  } catch {
    return new Uint8Array(WAVEFORM_BUCKETS);
  }
}

/** Decoded analysis of a recorded audio blob. */
export interface AudioAnalysis {
  readonly durationMs: number;
  readonly peaks: Uint8Array;
}

/**
 * Decodes an audio blob with the Web Audio API and produces its duration
 * and waveform peaks. On any decode failure, resolves to a zero-duration
 * flat waveform so a send can still proceed.
 */
export async function analyzeAudio(blob: Blob): Promise<AudioAnalysis> {
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const context = new AudioCtor();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      return {
        durationMs: Math.round(buffer.duration * 1000),
        peaks: downsamplePeaks(buffer.getChannelData(0)),
      };
    } finally {
      void context.close();
    }
  } catch {
    return { durationMs: 0, peaks: new Uint8Array(WAVEFORM_BUCKETS) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/private-dm/voice/waveform.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/private-dm/voice/waveform.ts src/features/private-dm/voice/waveform.test.ts
git commit -m "feat(voice): add waveform decode and downsample helpers"
```

---

## Task 8: `voice-recorder.ts` — `MediaRecorder` wrapper

**Files:**
- Create: `src/features/private-dm/voice/voice-recorder.ts`
- Create: `src/features/private-dm/voice/voice-recorder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/private-dm/voice/voice-recorder.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickRecorderMimeType, VoiceRecorder } from "./voice-recorder";

describe("pickRecorderMimeType", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first supported candidate", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type: string) => type === "audio/webm",
    });
    expect(pickRecorderMimeType()).toBe("audio/webm");
  });

  it("returns undefined when nothing is supported", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(pickRecorderMimeType()).toBeUndefined();
  });
});

describe("VoiceRecorder", () => {
  it("reports unsupported when MediaRecorder is absent", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(VoiceRecorder.isSupported()).toBe(false);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/private-dm/voice/voice-recorder.test.ts`
Expected: FAIL — cannot resolve `./voice-recorder`.

- [ ] **Step 3: Write the implementation**

Create `src/features/private-dm/voice/voice-recorder.ts`:

```typescript
/** Maximum voice-recording length. Recording auto-stops at this point. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
];

/** Returns the first MediaRecorder MIME type the platform supports. */
export function pickRecorderMimeType(): string | undefined {
  const recorder = (
    globalThis as unknown as {
      MediaRecorder?: { isTypeSupported(type: string): boolean };
    }
  ).MediaRecorder;
  if (!recorder) {
    return undefined;
  }
  return MIME_CANDIDATES.find((type) => recorder.isTypeSupported(type));
}

/** A completed recording: the audio blob and the chosen container MIME. */
export interface Recording {
  readonly blob: Blob;
  readonly mime: string;
}

/**
 * Records a single microphone clip via getUserMedia + MediaRecorder. One
 * instance records one clip; create a fresh instance per recording.
 */
export class VoiceRecorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private mime = "";
  private autoStopTimer?: number;

  /** Whether voice recording is available in this environment. */
  static isSupported(): boolean {
    return (
      typeof MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      pickRecorderMimeType() !== undefined
    );
  }

  /** Requests the microphone and begins recording. */
  async start(): Promise<void> {
    const mime = pickRecorderMimeType();
    if (!mime) {
      throw new Error("Voice recording is not supported on this device");
    }
    this.mime = mime;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.recorder.start();
  }

  /**
   * Stops recording and resolves with the recorded clip. Releases the
   * microphone. Registers an auto-stop callback used to enforce the cap.
   */
  stop(): Promise<Recording> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) {
        reject(new Error("Recorder was not started"));
        return;
      }
      recorder.onstop = () => {
        this.releaseStream();
        resolve({ blob: new Blob(this.chunks, { type: this.mime }), mime: this.mime });
      };
      try {
        recorder.stop();
      } catch (error) {
        this.releaseStream();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.clearAutoStop();
    });
  }

  /** Aborts recording and releases the microphone without producing a clip. */
  cancel(): void {
    this.clearAutoStop();
    try {
      this.recorder?.stop();
    } catch {
      // ignore — cancelling is best-effort
    }
    this.releaseStream();
  }

  /** Registers a callback fired when MAX_RECORDING_MS is reached. */
  onMaxDuration(callback: () => void): void {
    this.clearAutoStop();
    this.autoStopTimer = window.setTimeout(callback, MAX_RECORDING_MS);
  }

  private clearAutoStop(): void {
    if (this.autoStopTimer !== undefined) {
      window.clearTimeout(this.autoStopTimer);
      this.autoStopTimer = undefined;
    }
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/private-dm/voice/voice-recorder.test.ts`
Expected: all PASS.

- [ ] **Step 5: Manually verify `getUserMedia` works in the Tauri shell**

Run: `npm run tauri dev`. When the app window opens, open the devtools console and run:
`navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { console.log("mic ok", s.id); s.getTracks().forEach(t => t.stop()); }).catch(e => console.error("mic fail", e))`
Expected: logs `mic ok ...`. If it fails with a permission error, add a WebView2 permission handler in `src-tauri/src/lib.rs` (see Risks in the spec) before continuing — record the outcome in the commit message of Task 9.

- [ ] **Step 6: Commit**

```bash
git add src/features/private-dm/voice/voice-recorder.ts src/features/private-dm/voice/voice-recorder.test.ts
git commit -m "feat(voice): add MediaRecorder-based voice recorder"
```

---

## Task 9: `VoiceComposer.tsx` — 3-state recorder UI

**Files:**
- Create: `src/features/private-dm/voice/VoiceComposer.tsx`

- [ ] **Step 1: Write the component**

Create `src/features/private-dm/voice/VoiceComposer.tsx`:

```tsx
import {
  IconMicrophone,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { analyzeAudio, peaksToBase64, type AudioAnalysis } from "./waveform";
import { Recording, VoiceRecorder } from "./voice-recorder";

/** Voice payload handed to the send callback. */
export interface VoiceSend {
  readonly blob: Blob;
  readonly mime: string;
  readonly durationMs: number;
  readonly peaksB64: string;
}

type Phase = "idle" | "recording" | "review";

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Microphone control for the composer. Tap to record, tap to stop, then
 * review (play / discard / send). Renders nothing if recording is
 * unsupported so the rest of the composer is unaffected.
 */
export function VoiceComposer({
  disabled,
  onSend,
  onError,
}: {
  disabled: boolean;
  onSend: (voice: VoiceSend) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const analysisRef = useRef<AudioAnalysis | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | undefined>(undefined);

  const supported = VoiceRecorder.isSupported();

  const clearTick = () => {
    if (tickRef.current !== undefined) {
      window.clearInterval(tickRef.current);
      tickRef.current = undefined;
    }
  };

  const revokePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = undefined;
    }
  };

  useEffect(() => {
    return () => {
      clearTick();
      revokePreview();
      recorderRef.current?.cancel();
    };
  }, []);

  const finishRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }
    clearTick();
    try {
      const recording = await recorder.stop();
      recordingRef.current = recording;
      analysisRef.current = await analyzeAudio(recording.blob);
      setPhase("review");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Recording failed");
      setPhase("idle");
    }
  };

  const startRecording = async () => {
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Could not access the microphone",
      );
      return;
    }
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    tickRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 200);
    recorder.onMaxDuration(() => void finishRecording());
  };

  const discard = () => {
    revokePreview();
    recordingRef.current = null;
    analysisRef.current = null;
    setPhase("idle");
  };

  const send = () => {
    const recording = recordingRef.current;
    const analysis = analysisRef.current;
    if (!recording || !analysis) {
      return;
    }
    onSend({
      blob: recording.blob,
      mime: recording.mime,
      durationMs: analysis.durationMs,
      peaksB64: peaksToBase64(analysis.peaks),
    });
    discard();
  };

  const playPreview = () => {
    const recording = recordingRef.current;
    if (!recording) {
      return;
    }
    revokePreview();
    previewUrlRef.current = URL.createObjectURL(recording.blob);
    if (audioRef.current) {
      audioRef.current.src = previewUrlRef.current;
      void audioRef.current.play();
    }
  };

  if (!supported) {
    return null;
  }

  if (phase === "idle") {
    return (
      <button
        type="button"
        className="composer-mic"
        aria-label="Record a voice message"
        title="Record a voice message"
        disabled={disabled}
        onClick={() => void startRecording()}
      >
        <IconMicrophone size={16} />
      </button>
    );
  }

  if (phase === "recording") {
    return (
      <div className="voice-composer voice-composer-recording" role="group">
        <span className="voice-dot" aria-hidden="true" />
        <span className="voice-timer">{formatElapsed(elapsed)}</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Discard recording"
          onClick={() => {
            clearTick();
            recorderRef.current?.cancel();
            setPhase("idle");
          }}
        >
          <IconTrash size={15} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Stop recording"
          onClick={() => void finishRecording()}
        >
          <IconPlayerStopFilled size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="voice-composer voice-composer-review" role="group">
      <audio ref={audioRef} hidden />
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Play recording"
        onClick={playPreview}
      >
        <IconPlayerPlayFilled size={15} />
      </button>
      <span className="voice-timer">
        {formatElapsed(analysisRef.current?.durationMs ?? 0)}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Discard recording"
        onClick={discard}
      >
        <IconTrash size={15} />
      </button>
      <button
        type="button"
        className="btn btn-icon voice-send"
        aria-label="Send voice message"
        onClick={send}
      >
        <IconSend size={15} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/private-dm/voice/VoiceComposer.tsx
git commit -m "feat(voice): add three-state voice composer UI"
```

---

## Task 10: `VoiceMessage.tsx` — inline player + waveform bubble

**Files:**
- Create: `src/features/private-dm/voice/VoiceMessage.tsx`

- [ ] **Step 1: Write the component**

Create `src/features/private-dm/voice/VoiceMessage.tsx`. It reuses `AttachmentDescriptor` / `AttachmentView` from the gateway and the `localFileSrc` / `streamingMediaSrc` helpers from `attachments.tsx`.

```tsx
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { localFileSrc, streamingMediaSrc } from "../attachments";
import type {
  AttachmentDescriptor,
  AttachmentView,
} from "../native/native-messaging-gateway";
import { peaksFromBase64, WAVEFORM_BUCKETS } from "./waveform";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Draws the static waveform with a played/unplayed split at `progress`. */
function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Uint8Array,
  progress: number,
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  const barWidth = width / WAVEFORM_BUCKETS;
  const playedBars = Math.round(progress * WAVEFORM_BUCKETS);
  for (let i = 0; i < WAVEFORM_BUCKETS; i += 1) {
    const amplitude = (peaks[i] ?? 0) / 255;
    const barHeight = Math.max(2, amplitude * height);
    context.fillStyle = i < playedBars ? "#4f8cff" : "#9aa3b2";
    context.fillRect(
      i * barWidth + barWidth * 0.2,
      (height - barHeight) / 2,
      barWidth * 0.6,
      barHeight,
    );
  }
}

/**
 * Inline voice-message player. Shows the waveform immediately from the
 * descriptor's peaks; plays the audio over the streaming protocol while
 * the transfer is still in progress, or from the local file once complete.
 */
export function VoiceMessage({
  descriptor,
  view,
  surface,
  host,
}: {
  descriptor: AttachmentDescriptor;
  view: AttachmentView | undefined;
  surface: "dm" | "group" | "channel";
  host: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  const durationMs = descriptor.voice?.duration_ms ?? 0;
  const peaks = peaksFromBase64(descriptor.voice?.peaks_b64 ?? "");
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  const src = view?.local_path
    ? localFileSrc(view.local_path)
    : streamingMediaSrc(surface, host, descriptor.attachment_id);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      drawWaveform(canvas, peaks, progress);
    }
  }, [peaks, progress]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const seek = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || durationMs === 0) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = (ratio * durationMs) / 1000;
  };

  return (
    <div className="voice-message">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPositionMs(0);
        }}
        onTimeUpdate={(event) =>
          setPositionMs(event.currentTarget.currentTime * 1000)
        }
      />
      <button
        type="button"
        className="voice-message-play"
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        onClick={toggle}
      >
        {playing ? (
          <IconPlayerPauseFilled size={18} />
        ) : (
          <IconPlayerPlayFilled size={18} />
        )}
      </button>
      <canvas
        ref={canvasRef}
        className="voice-message-wave"
        width={192}
        height={36}
        onClick={seek}
      />
      <span className="voice-message-time">
        {formatClock(playing || positionMs > 0 ? positionMs : durationMs)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/private-dm/voice/VoiceMessage.tsx
git commit -m "feat(voice): add inline voice-message player with waveform"
```

---

## Task 11: Wire voice into the chat screen + `AttachmentCard` branch + CSS

**Files:**
- Modify: `src/features/private-dm/attachments.tsx` (`AttachmentCard`, ~line 226-383)
- Modify: `src/features/private-dm/private-dm-screen.tsx` (`sendAttachment` ~line 372-412; the `attachments` prop bundle; `Composer` function ~line 1941-1995; `AttachmentCard` call sites ~line 1717, ~1848, ~1927)
- Create: `src/features/private-dm/styles/voice.css`
- Modify: `src/App.css` (add one `@import`)

- [ ] **Step 1: `AttachmentCard` renders `VoiceMessage` for voice attachments**

In `attachments.tsx`, add the import:

```tsx
import { VoiceMessage } from "./voice/VoiceMessage";
```

Add a `surface` + `host` prop to `AttachmentCard` so it can build a streaming URL. Change the prop type to include:

```tsx
  surface: "dm" | "group" | "channel";
  host: string;
```

At the very start of the `AttachmentCard` function body (before `const id = ...`), add:

```tsx
  if (descriptor.voice) {
    return (
      <VoiceMessage
        descriptor={descriptor}
        view={view}
        surface={surface}
        host={host}
      />
    );
  }
```

- [ ] **Step 2: Pass `surface` + `host` at the three `AttachmentCard` call sites**

In `private-dm-screen.tsx`, each `<AttachmentCard ... />` (DM ~line 1717, channel ~line 1848, group ~line 1927) gains `surface` and `host`. The host is the conversation's mesh host already used by `streamingMediaSrc` elsewhere — for DM/group use the mesh id, for channel the channel name. Add to each call:

```tsx
            surface="dm"
            host={mesh.mesh_id}
```

Use `surface="channel"` / `surface="group"` at the matching call sites, and the host value already in scope for that pane's streaming URLs. (Search the file for an existing `streamingMediaSrc(` call in each pane to copy the exact host expression; if none exists yet, use the snapshot's `mesh_id` for DM/group and the channel `name` for channel.)

- [ ] **Step 3: Add the voice send handler in the screen**

In `private-dm-screen.tsx`, add the import:

```tsx
import type { VoiceSend } from "./voice/VoiceComposer";
import { readFileAsBase64 } from "./attachments";
```

(`readFileAsBase64` is already imported — do not duplicate.) Add a `sendVoice` handler next to `sendAttachment`:

```tsx
  const sendVoice = (voice: VoiceSend) => {
    if (!active) {
      return;
    }
    const target = active;
    const fileName = voice.mime.includes("ogg")
      ? "voice-message.ogg"
      : "voice-message.webm";
    const meta = { duration_ms: voice.durationMs, peaks_b64: voice.peaksB64 };
    void run(async () => {
      const dataBase64 = await readFileAsBase64(
        new File([voice.blob], fileName, { type: voice.mime }),
      );
      if (target.type === "dm") {
        await gateway.sendPrivateAttachment(
          target.id, fileName, voice.mime, dataBase64, undefined, meta,
        );
      } else if (target.type === "channel") {
        await gateway.sendChannelAttachment(
          target.name, fileName, voice.mime, dataBase64, undefined, meta,
        );
      } else {
        await gateway.sendGroupAttachment(
          target.id, fileName, voice.mime, dataBase64, undefined, meta,
        );
      }
      await refresh(true);
    });
  };
```

- [ ] **Step 4: Thread `onSendVoice` into the `attachments` prop bundle**

Find where the `attachments` object passed to the chat panes is assembled (it carries `onSend: sendAttachment`, `onDownload`, `onCancel`, `onOpen`, `views`, `busy`). Add:

```tsx
    onSendVoice: sendVoice,
```

Update that bundle's TypeScript type to include `onSendVoice: (voice: VoiceSend) => void;`.

- [ ] **Step 5: Render `VoiceComposer` in the `Composer` component**

In `private-dm-screen.tsx`, add the import:

```tsx
import { VoiceComposer } from "./voice/VoiceComposer";
```

Extend the `Composer` props type with:

```tsx
  onSendVoice?: (voice: VoiceSend) => void;
```

Inside the `Composer` JSX, immediately after the `<AttachmentPicker ... />` block (still inside `<div className="composer-box">`), add:

```tsx
        {onSendVoice ? (
          <VoiceComposer
            disabled={disabled}
            onSend={onSendVoice}
            onError={(message) => onChange(value)}
          />
        ) : null}
```

Replace the `onError` line with the screen's real error setter — pass an `onError` prop down from the parent that calls `setError`. Concretely: add `onError?: (message: string) => void;` to the `Composer` props, render `<VoiceComposer ... onError={onError ?? (() => {})} />`, and at each of the three `<Composer ... />` call sites (~line 1409, 1461, 1538) add `onSendVoice={props.attachments.onSendVoice}` and `onError={setError}` (or the error setter already threaded into that pane — search for `setError` usage in the pane).

- [ ] **Step 6: Create the voice CSS**

Create `src/features/private-dm/styles/voice.css`:

```css
.composer-mic,
.voice-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
}

.composer-mic:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.15);
}

.voice-composer {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}

.voice-composer-recording .voice-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e5484d;
  animation: voice-pulse 1s ease-in-out infinite;
}

@keyframes voice-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.voice-timer {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  min-width: 34px;
  text-align: center;
}

.voice-send {
  color: #4f8cff;
}

.voice-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.12);
  max-width: 280px;
}

.voice-message-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: #4f8cff;
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
}

.voice-message-wave {
  cursor: pointer;
  flex: 1;
}

.voice-message-time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  opacity: 0.75;
}
```

- [ ] **Step 7: Import the CSS**

In `src/App.css`, add at the top (matching how other feature CSS is imported — if features import CSS elsewhere, follow that pattern instead):

```css
@import "./features/private-dm/styles/voice.css";
```

- [ ] **Step 8: Run typecheck, tests, and a manual smoke test**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.
Then `npm run tauri dev`, open a DM session, record a voice message, send it, and confirm the bubble shows a waveform + plays. Repeat for a group and a channel.

- [ ] **Step 9: Commit**

```bash
git add src/features/private-dm/attachments.tsx src/features/private-dm/private-dm-screen.tsx src/features/private-dm/styles/voice.css src/App.css
git commit -m "feat(voice): record and play voice messages in all chat surfaces"
```

---

## Task 12: Install and register the notification plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs` (builder, ~line 736-737)
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json`

- [ ] **Step 1: Add the Rust crate**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tauri-plugin-notification = "2"
```

- [ ] **Step 2: Register the plugin**

In `src-tauri/src/lib.rs`, in the `tauri::Builder::default()` chain, add the plugin registration right after `.plugin(tauri_plugin_opener::init())`:

```rust
        .plugin(tauri_plugin_notification::init())
```

- [ ] **Step 3: Grant the capability**

In `src-tauri/capabilities/default.json`, add `"notification:default"` to the `permissions` array (after `"opener:default"`).

- [ ] **Step 4: Add the JS package**

Run: `npm install @tauri-apps/plugin-notification@^2`
Expected: `@tauri-apps/plugin-notification` appears in `package.json` dependencies.

- [ ] **Step 5: Verify the build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml` and `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat(notifications): add the Tauri notification plugin"
```

---

## Task 13: `unread.ts` — pure unread-diff logic

**Files:**
- Create: `src/features/private-dm/notifications/unread.ts`
- Create: `src/features/private-dm/notifications/unread.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/private-dm/notifications/unread.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { diffConversations, type ConversationCount } from "./unread";

const counts = (entries: [string, number][]): ConversationCount[] =>
  entries.map(([id, messageCount]) => ({ id, messageCount }));

describe("diffConversations", () => {
  it("reports new messages for conversations whose count grew", () => {
    const lastSeen = new Map([["a", 2], ["b", 5]]);
    const result = diffConversations(
      counts([["a", 4], ["b", 5]]),
      lastSeen,
      "b",
      false,
    );
    expect(result.newMessages).toEqual([{ id: "a", delta: 2 }]);
  });

  it("does not report the active conversation while the window is focused", () => {
    const lastSeen = new Map([["a", 1]]);
    const result = diffConversations(
      counts([["a", 3]]),
      lastSeen,
      "a",
      false,
    );
    expect(result.newMessages).toEqual([]);
  });

  it("reports the active conversation when the window is unfocused", () => {
    const lastSeen = new Map([["a", 1]]);
    const result = diffConversations(
      counts([["a", 3]]),
      lastSeen,
      "a",
      true,
    );
    expect(result.newMessages).toEqual([{ id: "a", delta: 2 }]);
  });

  it("treats a first-seen conversation as having no new messages", () => {
    const result = diffConversations(counts([["a", 4]]), new Map(), null, false);
    expect(result.newMessages).toEqual([]);
    expect(result.nextLastSeen.get("a")).toBe(4);
  });

  it("advances lastSeen for every conversation", () => {
    const result = diffConversations(
      counts([["a", 7], ["b", 2]]),
      new Map([["a", 3]]),
      null,
      false,
    );
    expect(result.nextLastSeen.get("a")).toBe(7);
    expect(result.nextLastSeen.get("b")).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/private-dm/notifications/unread.test.ts`
Expected: FAIL — cannot resolve `./unread`.

- [ ] **Step 3: Write the implementation**

Create `src/features/private-dm/notifications/unread.ts`:

```typescript
/** A conversation and its current total message count. */
export interface ConversationCount {
  readonly id: string;
  readonly messageCount: number;
}

/** A conversation that gained `delta` messages since it was last seen. */
export interface NewMessages {
  readonly id: string;
  readonly delta: number;
}

/** Result of one poll diff. */
export interface UnreadDiff {
  readonly newMessages: readonly NewMessages[];
  readonly nextLastSeen: Map<string, number>;
}

/**
 * Compares the current per-conversation message counts against the
 * last-seen counts and reports which conversations gained messages worth
 * notifying about.
 *
 * A conversation reports new messages when its count grew AND it is not the
 * currently-active conversation — unless the window is unfocused, in which
 * case even the active conversation reports (the user is not looking at it).
 * A conversation seen for the first time never reports (no baseline).
 *
 * `nextLastSeen` always advances every conversation to its current count;
 * callers persist it for the next poll.
 */
export function diffConversations(
  current: readonly ConversationCount[],
  lastSeen: ReadonlyMap<string, number>,
  activeId: string | null,
  windowUnfocused: boolean,
): UnreadDiff {
  const newMessages: NewMessages[] = [];
  const nextLastSeen = new Map<string, number>();
  for (const { id, messageCount } of current) {
    nextLastSeen.set(id, messageCount);
    const previous = lastSeen.get(id);
    if (previous === undefined) {
      continue;
    }
    const delta = messageCount - previous;
    if (delta <= 0) {
      continue;
    }
    const isActive = id === activeId;
    if (isActive && !windowUnfocused) {
      continue;
    }
    newMessages.push({ id, delta });
  }
  return { newMessages, nextLastSeen };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/private-dm/notifications/unread.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/private-dm/notifications/unread.ts src/features/private-dm/notifications/unread.test.ts
git commit -m "feat(notifications): add unread-diff logic"
```

---

## Task 14: Wire notifications into the screen poll loop + sidebar badges

**Files:**
- Modify: `src/features/private-dm/private-dm-screen.tsx` (`refresh` callback ~line 156-222; sidebar conversation list rendering; `active` state)
- Modify: `src/features/private-dm/styles/voice.css` (append badge styles)

- [ ] **Step 1: Add imports and unread state to the screen**

In `private-dm-screen.tsx`, add:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { diffConversations, type ConversationCount } from "./notifications/unread";
```

Inside the component, add state and a ref:

```tsx
  const [unread, setUnread] = useState<ReadonlyMap<string, number>>(new Map());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const notifyReadyRef = useRef(false);
```

- [ ] **Step 2: Request notification permission once on mount**

Add an effect near the existing poll effect:

```tsx
  useEffect(() => {
    void (async () => {
      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      notifyReadyRef.current = granted;
    })();
  }, []);
```

- [ ] **Step 3: Compute the unread diff at the end of each successful poll**

Inside the `refresh` callback, after `setSessions(...)`, `setChannels(...)`, `setGroups(...)` and the `setActive(...)` block, add:

```tsx
        const conversationId = (target: typeof active): string | null => {
          if (!target) return null;
          return target.type === "channel" ? `channel:${target.name}` : `${target.type}:${target.id}`;
        };
        const counts: ConversationCount[] = [
          ...sessionList.sessions.map((s) => ({
            id: `dm:${s.session_id}`,
            messageCount: s.messages.length,
          })),
          ...groupList.groups.map((g) => ({
            id: `group:${g.group_id}`,
            messageCount: g.messages.length,
          })),
          ...channelList.channels.map((c) => ({
            id: `channel:${c.name}`,
            messageCount: c.messages.length,
          })),
        ];
        const focused = await getCurrentWindow().isFocused();
        const activeKey = conversationId(activeAfterPoll);
        const diff = diffConversations(counts, lastSeenRef.current, activeKey, !focused);
        lastSeenRef.current = diff.nextLastSeen;
        if (diff.newMessages.length > 0) {
          setUnread((current) => {
            const next = new Map(current);
            for (const { id, delta } of diff.newMessages) {
              if (id !== activeKey || !focused) {
                next.set(id, (next.get(id) ?? 0) + delta);
              }
            }
            return next;
          });
          if (!focused && notifyReadyRef.current) {
            for (const { id } of diff.newMessages) {
              const label = id.startsWith("channel:")
                ? `#${id.slice("channel:".length)}`
                : "New message";
              sendNotification({ title: "Mosh", body: `${label} — new message` });
            }
          }
        }
```

Note: `activeAfterPoll` must be the value `setActive` resolved to. Capture it by computing the next active value into a local `let activeAfterPoll` inside the existing `setActive` updater (return it and assign), or read it via a ref the `setActive` updater also writes. Use whichever matches the file's existing pattern; the existing `setActive` updater already computes the next value — assign that computed value to `activeAfterPoll` before returning it.

- [ ] **Step 4: Clear a conversation's unread count when it becomes active**

Find where `setActive` is called for a user-initiated conversation switch (the sidebar click handler). Wherever `active` is set to a conversation, also clear its unread:

```tsx
  const selectConversation = (next: NonNullable<typeof active>) => {
    setActive(next);
    const key =
      next.type === "channel" ? `channel:${next.name}` : `${next.type}:${next.id}`;
    setUnread((current) => {
      if (!current.has(key)) return current;
      const updated = new Map(current);
      updated.delete(key);
      return updated;
    });
    lastSeenRef.current = new Map(lastSeenRef.current);
  };
```

Replace direct `setActive(...)` calls in the sidebar list click handlers with `selectConversation(...)`.

- [ ] **Step 5: Render unread badges in the sidebar**

In each sidebar conversation list item, compute its key and render a badge when the count is positive. Inside the list-item JSX add:

```tsx
            {(() => {
              const key = item.type === "channel"
                ? `channel:${item.name}`
                : `${item.type}:${item.id}`;
              const count = unread.get(key) ?? 0;
              return count > 0 ? (
                <span className="unread-badge" aria-label={`${count} unread`}>
                  {count > 99 ? "99+" : count}
                </span>
              ) : null;
            })()}
```

Adapt `item.type` / `item.name` / `item.id` to the actual variable names used in each sidebar list (DM, group, channel lists may iterate different shapes — build the same `dm:` / `group:` / `channel:` key in each).

- [ ] **Step 6: Add badge styles**

Append to `src/features/private-dm/styles/voice.css`:

```css
.unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: auto;
  border-radius: 9px;
  background: #4f8cff;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 7: Run typecheck, tests, and a manual smoke test**

Run: `npm run typecheck && npx vitest run && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all PASS.
Then `npm run tauri dev`: with the window unfocused, have a peer send a message — confirm an OS toast appears and the sidebar shows an unread badge. Open the conversation — confirm the badge clears.

- [ ] **Step 8: Commit**

```bash
git add src/features/private-dm/private-dm-screen.tsx src/features/private-dm/styles/voice.css
git commit -m "feat(notifications): OS toasts and unread badges for new messages"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: typecheck, vitest, and `cargo test` all PASS.

- [ ] **Step 2: Check Rust formatting**

Run: `npm run format`
Expected: no formatting changes required.

- [ ] **Step 3: Full manual pass**

Run `npm run tauri dev`. Verify, on each of DM / group / channel:
- Record → review → send a voice message; bubble shows a waveform, plays, scrubs.
- The recipient side shows the waveform before download completes.
- With the window unfocused, a new message raises an OS toast and a sidebar badge; opening the conversation clears the badge.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "test: verify voice messages and notifications end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** Voice recording (Tasks 7-9, 11), voice transport A1 (Tasks 1-6), voice bubble with waveform (Task 10-11), notification plugin (Task 12), unread badges + OS toasts B1 (Tasks 13-14). All three surfaces covered (Tasks 3-5, 11, 14). Testing section covered (`waveform.test.ts`, `voice-recorder.test.ts`, `unread.test.ts`, Rust serde tests).
- **`getUserMedia` risk** is verified early (Task 8 Step 5) per the spec rollout.
- **Type consistency:** `VoiceMeta` (Rust `duration_ms`/`peaks_b64`; TS `duration_ms`/`peaks_b64`), `VoiceSend` (TS `durationMs`/`peaksB64`, camelCase, frontend-only), `WAVEFORM_BUCKETS = 64`, `diffConversations` signature consistent across `unread.ts` and its callers.
- **Known integration seam:** Task 11 Step 2 and Task 14 Steps 3-5 depend on variable names in the 2222-line `private-dm-screen.tsx` that vary per pane; each step says to match the file's existing pattern rather than assuming an exact name. The executor must read the surrounding code at those sites.
