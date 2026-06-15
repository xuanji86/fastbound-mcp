/**
 * Token-bucket rate limiter for FastBound's 60 requests/minute/key limit.
 *
 * Allows bursting up to `capacity` then refills at a steady rate. We default to a
 * conservative 58/min to absorb clock skew against the server's window. The clock
 * and sleep are injectable so the limiter is unit-testable with a fake clock.
 */

export interface ThrottleOptions {
  capacity?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class Throttle {
  private readonly capacity: number;
  private readonly ratePerMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private tokens: number;
  private lastRefill: number;
  /** Serialises reservations so concurrent callers get distinct slots. */
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: ThrottleOptions = {}) {
    this.capacity = opts.capacity ?? 58;
    const windowMs = opts.windowMs ?? 60_000;
    this.ratePerMs = this.capacity / windowMs;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  /**
   * Compute the delay (ms) before a request may be sent and consume one token.
   * Pure with respect to the injected clock — the caller is responsible for sleeping.
   * Exposed for testing; production code uses {@link acquire}.
   */
  reserve(): number {
    const now = this.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerMs);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    // Wait until one token is available, then consume it.
    const wait = Math.ceil((1 - this.tokens) / this.ratePerMs);
    this.tokens = 0;
    this.lastRefill = now + wait;
    return wait;
  }

  /** Block until a request slot is available. Reservations are serialised. */
  async acquire(): Promise<void> {
    const run = this.chain.then(async () => {
      const wait = this.reserve();
      if (wait > 0) await this.sleep(wait);
    });
    // Keep the chain alive even if one link rejects.
    this.chain = run.catch(() => undefined);
    return run;
  }
}
