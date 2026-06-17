import { describe, expect, it, vi } from "vitest";
import { drainCallFrames } from "./call-drain";
import {
  CALLEE_DIRECTION_BIT,
  bytesToBase64,
  importCallKey,
  sealFrame,
} from "./frame-crypto";
import { JitterBuffer } from "./jitter-buffer";

const KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const PREFIX_B64 = "AAAAAA==";

describe("drainCallFrames", () => {
  it("decrypts drained frames and plays them in seq order", async () => {
    const key = await importCallKey(KEY_B64);
    const f1 = await sealFrame(key, PREFIX_B64, 1n, CALLEE_DIRECTION_BIT, new Uint8Array([10]));
    const f2 = await sealFrame(key, PREFIX_B64, 2n, CALLEE_DIRECTION_BIT, new Uint8Array([20]));
    // Delivered out of order — the jitter buffer must reorder them.
    const source = {
      callDrainFrames: vi.fn().mockResolvedValue([bytesToBase64(f2), bytesToBase64(f1)]),
    };
    const played: number[] = [];

    await drainCallFrames(source, "s", "c", key, PREFIX_B64, new JitterBuffer(), {
      pushFrame: (_seq, p) => played.push(p[0]),
    });

    expect(played).toEqual([10, 20]);
  });

  it("skips an undecryptable frame without throwing", async () => {
    const key = await importCallKey(KEY_B64);
    const good = await sealFrame(key, PREFIX_B64, 1n, CALLEE_DIRECTION_BIT, new Uint8Array([42]));
    const bad = await sealFrame(key, PREFIX_B64, 2n, CALLEE_DIRECTION_BIT, new Uint8Array([99]));
    bad[bad.length - 1] ^= 0xff; // tamper → openFrame returns null
    const source = {
      callDrainFrames: vi.fn().mockResolvedValue([bytesToBase64(good), bytesToBase64(bad)]),
    };
    const played: number[] = [];

    await drainCallFrames(source, "s", "c", key, PREFIX_B64, new JitterBuffer(), {
      pushFrame: (_seq, p) => played.push(p[0]),
    });

    expect(played).toEqual([42]);
  });
});
