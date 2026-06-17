import { bytesFromBase64, openFrame } from "./frame-crypto";
import type { JitterBuffer } from "./jitter-buffer";

/** Pulls pending wire frames for a call (the only gateway method this needs). */
export interface CallFrameSource {
  callDrainFrames(sessionId: string, callId: string): Promise<readonly string[]>;
}

/** Where decoded, reordered frames go (the playback handle, narrowed). */
export interface CallFrameSink {
  pushFrame(payload: Uint8Array): void;
}

/**
 * Drains pending wire frames, decrypts each (skipping any that fail auth),
 * reorders them through the jitter buffer, and feeds the ready ones to playback.
 * Pure of React/Tauri so it is unit-testable and so the poll loop can guard it.
 */
export async function drainCallFrames(
  source: CallFrameSource,
  sessionId: string,
  callId: string,
  key: CryptoKey,
  noncePrefix: string,
  jitter: JitterBuffer,
  playback: CallFrameSink,
): Promise<void> {
  const frames = await source.callDrainFrames(sessionId, callId);
  if (frames.length === 0) {
    return;
  }
  for (const frameB64 of frames) {
    const opened = await openFrame(key, noncePrefix, bytesFromBase64(frameB64));
    if (opened) {
      jitter.push({ seq: opened.seq, payload: opened.payload });
    }
  }
  for (const buffered of jitter.drainReady()) {
    playback.pushFrame(buffered.payload);
  }
}
