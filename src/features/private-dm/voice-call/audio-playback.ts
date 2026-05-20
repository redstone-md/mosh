/**
 * Decodes incoming Opus frames with WebCodecs and schedules them on a
 * shared AudioContext. Pairs with the JitterBuffer used by the call view.
 */

const TARGET_SAMPLE_RATE = 48_000;

export interface VoicePlaybackHandle {
  pushFrame(frame: Uint8Array): void;
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

  let timestamp = 0;
  return {
    pushFrame(frame: Uint8Array) {
      const chunk = new EncodedAudioChunkCtor({
        type: "key",
        timestamp,
        data: frame,
      });
      timestamp += 20_000;
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
