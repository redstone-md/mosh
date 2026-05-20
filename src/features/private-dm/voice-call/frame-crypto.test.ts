import { describe, expect, it } from "vitest";
import {
  CALLEE_DIRECTION_BIT,
  CALLER_DIRECTION_BIT,
  buildFrame,
  importCallKey,
  parseFrame,
  sealFrame,
  openFrame,
} from "./frame-crypto";

const KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const PREFIX_B64 = "AAAAAA==";

describe("frame-crypto", () => {
  it("seals and opens a frame with the same key", async () => {
    const key = await importCallKey(KEY_B64);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const sealed = await sealFrame(key, PREFIX_B64, 7n, CALLER_DIRECTION_BIT, payload);
    const opened = await openFrame(key, PREFIX_B64, sealed);
    expect(opened).not.toBeNull();
    expect(Array.from(opened!.payload)).toEqual([1, 2, 3, 4, 5]);
    expect(opened!.seq).toBe(7n);
  });

  it("rejects a tampered frame", async () => {
    const key = await importCallKey(KEY_B64);
    const sealed = await sealFrame(
      key,
      PREFIX_B64,
      1n,
      CALLER_DIRECTION_BIT,
      new Uint8Array([9, 9, 9]),
    );
    sealed[sealed.length - 1] ^= 0xff;
    const opened = await openFrame(key, PREFIX_B64, sealed);
    expect(opened).toBeNull();
  });

  it("buildFrame and parseFrame roundtrip the seq", () => {
    const cipher = new Uint8Array([1, 2, 3]);
    const wire = buildFrame(42n, cipher);
    const parsed = parseFrame(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.seq).toBe(42n);
    expect(Array.from(parsed!.ciphertext)).toEqual([1, 2, 3]);
  });

  it("CALLER and CALLEE direction bits differ", () => {
    expect(CALLER_DIRECTION_BIT).not.toBe(CALLEE_DIRECTION_BIT);
  });
});
