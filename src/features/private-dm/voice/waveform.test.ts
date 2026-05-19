import { describe, expect, it } from "vitest";
import {
  WAVEFORM_BUCKETS,
  downsamplePeaks,
  peaksToBase64,
  peaksFromBase64,
} from "./waveform";

describe("downsamplePeaks", () => {
  it("produces exactly WAVEFORM_BUCKETS buckets", () => {
    const samples = new Float32Array(10_000).fill(0.5);
    const peaks = downsamplePeaks(samples);
    expect(peaks.length).toBe(WAVEFORM_BUCKETS);
  });

  it("maps a full-scale signal to 255 and silence to 0", () => {
    const loud = downsamplePeaks(new Float32Array(2_000).fill(1));
    const silent = downsamplePeaks(new Float32Array(2_000).fill(0));
    expect(Math.max(...loud)).toBe(255);
    expect(Math.max(...silent)).toBe(0);
  });

  it("handles input shorter than the bucket count", () => {
    const peaks = downsamplePeaks(new Float32Array([1, -1, 1]));
    expect(peaks.length).toBe(WAVEFORM_BUCKETS);
    expect(peaks[0]).toBe(255);
  });
});

describe("base64 codec", () => {
  it("roundtrips peaks through base64", () => {
    const peaks = new Uint8Array(WAVEFORM_BUCKETS);
    for (let i = 0; i < peaks.length; i += 1) {
      peaks[i] = i * 3;
    }
    const restored = peaksFromBase64(peaksToBase64(peaks));
    expect(Array.from(restored)).toEqual(Array.from(peaks));
  });

  it("returns a flat waveform for invalid base64", () => {
    const restored = peaksFromBase64("!!!not-base64!!!");
    expect(restored.length).toBe(WAVEFORM_BUCKETS);
    expect(Math.max(...restored)).toBe(0);
  });
});
