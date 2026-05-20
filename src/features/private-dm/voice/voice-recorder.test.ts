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
