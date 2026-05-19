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
   * microphone.
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
        resolve({
          blob: new Blob(this.chunks, { type: this.mime }),
          mime: this.mime,
        });
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
