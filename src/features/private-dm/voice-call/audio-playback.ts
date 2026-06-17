/**
 * Decodes incoming Opus frames with WebCodecs and schedules them on a
 * shared AudioContext. Pairs with the JitterBuffer used by the call view.
 */

const TARGET_SAMPLE_RATE = 48_000;
// If scheduling has drifted more than this far ahead of the wall clock (e.g.
// after a network stall buffered a backlog), resync to now instead of letting
// playback latency grow without bound for the rest of the call.
const PLAYBACK_RESYNC_S = 0.2;

import { SEQ_VALUE_MASK } from "./frame-crypto";

const FRAME_DURATION_US = 20_000;

export interface VoicePlaybackHandle {
  pushFrame(seq: bigint, frame: Uint8Array): void;
  stop(): Promise<void>;
}

export async function startVoicePlayback(): Promise<VoicePlaybackHandle> {
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
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
      const sampleRate = data.sampleRate || context.sampleRate;
      const buffer = context.createBuffer(channels, length, sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const target = buffer.getChannelData(channel);
        data.copyTo(target, { planeIndex: channel });
      }
      data.close();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      let start = Math.max(context.currentTime, nextStart);
      if (start - context.currentTime > PLAYBACK_RESYNC_S) {
        start = context.currentTime;
      }
      source.start(start);
      nextStart = start + buffer.duration;
    },
    error: (error) => {
      console.warn("[voice-call] decoder error", error);
    },
  });
  decoder.configure({
    codec: "opus",
    sampleRate: context.sampleRate,
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

  return {
    pushFrame(seq: bigint, frame: Uint8Array) {
      // Derive the timestamp from the real seq (dropping the direction bit) so
      // gaps left by dropped/force-skipped frames are preserved; a fixed
      // increment would tell the decoder lost frames were contiguous.
      const timestamp = Number((seq & SEQ_VALUE_MASK) * BigInt(FRAME_DURATION_US));
      const chunk = new EncodedAudioChunkCtor({
        type: "key",
        timestamp,
        data: frame,
      });
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
