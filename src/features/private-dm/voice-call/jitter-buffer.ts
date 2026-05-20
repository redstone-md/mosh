export interface BufferedFrame {
  readonly seq: bigint;
  readonly payload: Uint8Array;
}

/**
 * Small in-memory reorder buffer for received voice-call frames. Drains in
 * seq order; pauses on a gap; once the buffered backlog exceeds `gapCap`
 * frames it force-skips the missing seq and resumes (cheap PLC).
 */
export class JitterBuffer {
  private pending = new Map<bigint, Uint8Array>();
  private cursor: bigint | null = null;
  private readonly gapCap: number;

  constructor(gapCap = 8) {
    this.gapCap = gapCap;
  }

  push(frame: BufferedFrame): void {
    if (this.cursor !== null && frame.seq <= this.cursor) {
      return;
    }
    this.pending.set(frame.seq, frame.payload);
  }

  drainReady(): BufferedFrame[] {
    const out: BufferedFrame[] = [];
    if (this.pending.size === 0) {
      return out;
    }
    const seqs = [...this.pending.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    let next = this.cursor === null ? seqs[0] : this.cursor + 1n;
    for (;;) {
      if (this.pending.has(next)) {
        out.push({ seq: next, payload: this.pending.get(next)! });
        this.pending.delete(next);
        this.cursor = next;
        next = next + 1n;
        continue;
      }
      if (this.pending.size > this.gapCap) {
        const remaining = [...this.pending.keys()].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
        next = remaining[0];
        continue;
      }
      break;
    }
    return out;
  }
}
