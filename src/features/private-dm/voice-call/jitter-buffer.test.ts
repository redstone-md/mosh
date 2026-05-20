import { describe, expect, it } from "vitest";
import { JitterBuffer } from "./jitter-buffer";

describe("JitterBuffer", () => {
  it("drains frames in seq order", () => {
    const buf = new JitterBuffer();
    buf.push({ seq: 2n, payload: new Uint8Array([2]) });
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    buf.push({ seq: 3n, payload: new Uint8Array([3]) });
    expect(buf.drainReady().map((f) => Number(f.seq))).toEqual([1, 2, 3]);
  });

  it("drops frames at or below the cursor", () => {
    const buf = new JitterBuffer();
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    buf.drainReady();
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    expect(buf.drainReady()).toEqual([]);
  });

  it("does not drain a gap until the missing frame arrives", () => {
    const buf = new JitterBuffer();
    buf.push({ seq: 1n, payload: new Uint8Array([1]) });
    buf.push({ seq: 3n, payload: new Uint8Array([3]) });
    expect(buf.drainReady().map((f) => Number(f.seq))).toEqual([1]);
    buf.push({ seq: 2n, payload: new Uint8Array([2]) });
    expect(buf.drainReady().map((f) => Number(f.seq))).toEqual([2, 3]);
  });

  it("force-skips a gap after the cap and resumes", () => {
    const buf = new JitterBuffer(8);
    for (let i = 2; i <= 12; i += 1) {
      buf.push({ seq: BigInt(i), payload: new Uint8Array([i]) });
    }
    const drained = buf.drainReady().map((f) => Number(f.seq));
    expect(drained[0]).toBe(2);
    expect(drained[drained.length - 1]).toBe(12);
  });
});
