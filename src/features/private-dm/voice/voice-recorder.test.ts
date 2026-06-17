import { afterEach, describe, expect, it, vi } from "vitest";
import { pickRecorderMimeType, VoiceRecorder } from "./voice-recorder";

describe("pickRecorderMimeType", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the first supported candidate", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type: string) => type === "audio/webm",
    });
    expect(pickRecorderMimeType()).toBe("audio/webm");
  });

  it("falls back to audio/mp4 on WebKit (no webm/ogg)", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type: string) => type.startsWith("audio/mp4"),
    });
    expect(pickRecorderMimeType()).toBe("audio/mp4;codecs=mp4a.40.2");
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

  it("is idempotent — a double stop resolves once without re-stopping the recorder", async () => {
    let stopCalls = 0;
    class MockRecorder {
      static isTypeSupported = () => true;
      state: "recording" | "inactive" = "recording";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(
        readonly stream: unknown,
        readonly opts: unknown,
      ) {}
      start() {}
      stop() {
        stopCalls += 1;
        if (this.state === "inactive") {
          // Mirrors the real MediaRecorder, which throws on a second stop.
          throw new DOMException("already inactive", "InvalidStateError");
        }
        this.state = "inactive";
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", MockRecorder);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    });

    const recorder = new VoiceRecorder();
    await recorder.start();
    const first = recorder.stop(); // e.g. onMaxDuration auto-stop
    const second = recorder.stop(); // e.g. user taps Stop

    await expect(first).resolves.toMatchObject({ mime: expect.any(String) });
    await expect(second).resolves.toMatchObject({ mime: expect.any(String) });
    expect(stopCalls).toBe(1);

    vi.unstubAllGlobals();
  });
});
