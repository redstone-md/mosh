import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVoicePlayback } from "./audio-playback";
import { CALLEE_DIRECTION_BIT } from "./frame-crypto";
import {
  FakeAudioContext,
  FakeAudioDecoder,
  installFakeAudioGlobals,
} from "./fake-web-audio";

describe("startVoicePlayback", () => {
  beforeEach(() => {
    installFakeAudioGlobals(vi.stubGlobal);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("caps scheduling latency instead of growing nextStart unbounded after a stall", async () => {
    const handle = await startVoicePlayback();
    const ctx = FakeAudioContext.instances[0];
    ctx.currentTime = 0; // wall clock frozen — simulate a stall while frames pile in

    for (let i = 0; i < 100; i += 1) {
      handle.pushFrame(BigInt(i) | CALLEE_DIRECTION_BIT, new Uint8Array([1]));
    }

    // Each decoded buffer is 20 ms; with no resync the 100th frame would be
    // scheduled ~2 s ahead of the (frozen) clock. The resync must bound it.
    const lastStart = ctx.sources[ctx.sources.length - 1].startedAt ?? 0;
    expect(lastStart).toBeLessThanOrEqual(0.5);
  });

  it("derives decoder timestamps from seq so a gap survives packet loss", async () => {
    const handle = await startVoicePlayback();
    const decoder = FakeAudioDecoder.instances[0];

    // Frames 5 then 8 (a 3-frame gap, as the jitter buffer would force-skip).
    handle.pushFrame(5n | CALLEE_DIRECTION_BIT, new Uint8Array([1]));
    handle.pushFrame(8n | CALLEE_DIRECTION_BIT, new Uint8Array([2]));

    // Timestamps must reflect the real seq (µs = seq * 20_000), keeping the gap,
    // not a fixed +20_000 that pretends the frames were contiguous.
    expect(decoder.chunks[0].timestamp).toBe(5 * 20_000);
    expect(decoder.chunks[1].timestamp).toBe(8 * 20_000);
  });
});
