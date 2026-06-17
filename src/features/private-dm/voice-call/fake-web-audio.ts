/**
 * Minimal Web Audio / WebCodecs test doubles. jsdom ships none of these, so
 * tests stub the globals with these fakes and inspect what the code scheduled.
 * Not imported by production code.
 */

export class FakeParam {
  value = 0;
  readonly events: Array<{ kind: "set" | "ramp"; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number): void {
    this.events.push({ kind: "set", value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push({ kind: "ramp", value, time });
  }
}

export class FakeOscillator {
  type = "sine";
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  /** null = never stopped, -1 = stop() with no time (now), else scheduled time. */
  stoppedAt: number | null = null;
  connect(): void {}
  start(time = 0): void {
    this.startedAt = time;
  }
  stop(time?: number): void {
    this.stoppedAt = time ?? -1;
  }
}

export class FakeGain {
  gain = new FakeParam();
  connect(): void {}
}

export class FakeBufferSource {
  buffer: FakeAudioBuffer | null = null;
  startedAt: number | null = null;
  connect(): void {}
  start(time = 0): void {
    this.startedAt = time;
  }
}

export class FakeAudioBuffer {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate = 48_000;
  destination = {};
  closed = false;
  readonly oscillators: FakeOscillator[] = [];
  readonly sources: FakeBufferSource[] = [];

  constructor(options?: { sampleRate?: number }) {
    if (options?.sampleRate) {
      this.sampleRate = options.sampleRate;
    }
    FakeAudioContext.instances.push(this);
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

export class FakeAudioData {
  constructor(
    readonly numberOfChannels = 1,
    readonly numberOfFrames = 960, // 20 ms @ 48 kHz
    readonly sampleRate = 48_000,
  ) {}
  copyTo(): void {}
  close(): void {}
}

export class FakeEncodedAudioChunk {
  readonly timestamp: number;
  constructor(init: { timestamp: number }) {
    this.timestamp = init.timestamp;
  }
}

export class FakeAudioDecoder {
  static instances: FakeAudioDecoder[] = [];
  closed = false;
  readonly chunks: FakeEncodedAudioChunk[] = [];
  constructor(
    readonly init: { output: (data: FakeAudioData) => void; error: (e: Error) => void },
  ) {
    FakeAudioDecoder.instances.push(this);
  }
  configure(): void {}
  /** Synchronously emits one decoded frame per chunk so tests stay deterministic. */
  decode(chunk: FakeEncodedAudioChunk): void {
    this.chunks.push(chunk);
    this.init.output(new FakeAudioData());
  }
  close(): void {
    this.closed = true;
  }
}

/** Stubs every Web Audio / WebCodecs global the playback path touches. */
export function installFakeAudioGlobals(stub: (name: string, value: unknown) => void): void {
  resetFakeAudio();
  stub("AudioContext", FakeAudioContext);
  stub("AudioDecoder", FakeAudioDecoder);
  stub("EncodedAudioChunk", FakeEncodedAudioChunk);
}

/** Resets captured instances; call in beforeEach. */
export function resetFakeAudio(): void {
  FakeAudioContext.instances.length = 0;
  FakeAudioDecoder.instances.length = 0;
}
