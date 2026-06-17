import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext, resetFakeAudio } from "./fake-web-audio";
import { startRingtone } from "./ringtone";

describe("startRingtone", () => {
  beforeEach(() => {
    resetFakeAudio();
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("schedules a future oscillator stop as a leak backstop", () => {
    startRingtone();
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.oscillators).toHaveLength(2);
    for (const osc of ctx.oscillators) {
      // A scheduled future stop, not null (never) and not -1 (stop-now).
      expect(osc.stoppedAt).toBeGreaterThan(0);
    }
  });

  it("closes the AudioContext when the ring finishes on its own", () => {
    startRingtone();
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.closed).toBe(false);
    ctx.oscillators[1].onended?.();
    expect(ctx.closed).toBe(true);
  });

  it("closes the context once when stopped early", () => {
    const handle = startRingtone();
    const ctx = FakeAudioContext.instances[0];
    handle.stop();
    handle.stop(); // idempotent
    expect(ctx.closed).toBe(true);
  });
});
