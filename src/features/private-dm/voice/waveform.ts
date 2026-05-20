/** Number of amplitude buckets in a voice-message waveform. */
export const WAVEFORM_BUCKETS = 64;

/**
 * Downsamples mono PCM samples (range -1..1) to WAVEFORM_BUCKETS peak
 * amplitudes, each a byte 0-255. Each bucket holds the maximum absolute
 * amplitude of its slice. Always returns exactly WAVEFORM_BUCKETS bytes.
 */
export function downsamplePeaks(samples: Float32Array): Uint8Array {
  const peaks = new Uint8Array(WAVEFORM_BUCKETS);
  if (samples.length === 0) {
    return peaks;
  }
  const sliceSize = samples.length / WAVEFORM_BUCKETS;
  for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket += 1) {
    const start = Math.floor(bucket * sliceSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * sliceSize));
    let peak = 0;
    for (let i = start; i < end && i < samples.length; i += 1) {
      const amplitude = Math.abs(samples[i]);
      if (amplitude > peak) {
        peak = amplitude;
      }
    }
    peaks[bucket] = Math.min(255, Math.round(peak * 255));
  }
  return peaks;
}

/** Encodes waveform peaks as a base64 string for transport. */
export function peaksToBase64(peaks: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < peaks.length; i += 1) {
    binary += String.fromCharCode(peaks[i]);
  }
  return btoa(binary);
}

/**
 * Decodes base64 waveform peaks. Returns a flat (all-zero) waveform of
 * WAVEFORM_BUCKETS bytes if the input is malformed — a bad waveform is
 * never fatal.
 */
export function peaksFromBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const peaks = new Uint8Array(WAVEFORM_BUCKETS);
    for (let i = 0; i < WAVEFORM_BUCKETS && i < binary.length; i += 1) {
      peaks[i] = binary.charCodeAt(i) & 0xff;
    }
    return peaks;
  } catch {
    return new Uint8Array(WAVEFORM_BUCKETS);
  }
}

/** Decoded analysis of a recorded audio blob. */
export interface AudioAnalysis {
  readonly durationMs: number;
  readonly peaks: Uint8Array;
}

/**
 * Decodes an audio blob with the Web Audio API and produces its duration
 * and waveform peaks. On any decode failure, resolves to a zero-duration
 * flat waveform so a send can still proceed.
 */
export async function analyzeAudio(blob: Blob): Promise<AudioAnalysis> {
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const context = new AudioCtor();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      return {
        durationMs: Math.round(buffer.duration * 1000),
        peaks: downsamplePeaks(buffer.getChannelData(0)),
      };
    } finally {
      void context.close();
    }
  } catch {
    return { durationMs: 0, peaks: new Uint8Array(WAVEFORM_BUCKETS) };
  }
}
