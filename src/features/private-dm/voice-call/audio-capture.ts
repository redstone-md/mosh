/**
 * Microphone capture for a voice call. Uses an AudioWorklet to pull raw PCM
 * frames at the AudioContext's real sample rate, then encodes each 20 ms
 * frame to Opus with WebCodecs. Emits each encoded frame to the supplied
 * callback.
 */

export type EncodedFrame = Uint8Array;

const TARGET_SAMPLE_RATE = 48_000;
const FRAME_DURATION_MS = 20;

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
    this.buffer = new Float32Array(Math.round(sampleRate * ${FRAME_DURATION_MS} / 1000));
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

export async function startVoiceCapture(
  onFrame: (frame: EncodedFrame) => void,
): Promise<VoiceCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: TARGET_SAMPLE_RATE,
      channelCount: 1,
    },
  });
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  const sampleRate = context.sampleRate;
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
    sampleRate,
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
      sampleRate,
      numberOfChannels: 1,
      numberOfFrames: event.data.length,
      timestamp,
      data: event.data,
    });
    timestamp += (event.data.length * 1_000_000) / sampleRate;
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
