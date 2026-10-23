/**
 * Lazily-computed simulated clock. Real time still advances it (scaled by `speed`),
 * but `advance()` lets tests and the demo fast-forward it explicitly.
 */
export class SimClock {
  private simMillis: number;
  private lastRealMs: number;
  private speed: number; // simulated ms elapsed per real ms elapsed

  constructor(speed = 60, startAt = Date.now()) {
    this.simMillis = startAt;
    this.lastRealMs = Date.now();
    this.speed = speed;
  }

  now(): number {
    const realNow = Date.now();
    const elapsedReal = realNow - this.lastRealMs;
    if (elapsedReal > 0) {
      this.simMillis += elapsedReal * this.speed;
      this.lastRealMs = realNow;
    }
    return this.simMillis;
  }

  /** Return to real time, e.g. after a demo fast-forward. */
  reset(at: number = Date.now()): number {
    this.simMillis = at;
    this.lastRealMs = Date.now();
    return this.simMillis;
  }

  /** Jump the simulated clock forward without waiting real time (tests + demo fast-forward). */
  advance(ms: number): number {
    this.now(); // settle any pending real-time drift first
    this.simMillis += ms;
    return this.simMillis;
  }
}
